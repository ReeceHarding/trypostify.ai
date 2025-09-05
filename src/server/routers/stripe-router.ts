/**
 * stripeRouter handles Stripe subscription and billing portal flows.
 *
 * - checkout_session: create/retrieve a Stripe Customer for the current user,
 *   persist the customer.id on the user record in the database, and
 *   return a Checkout Session URL for subscription purchase.
 *
 * - billing_portal: create/retrieve a Stripe Customer for the current user,
 *   persist the customer.id on the user record if needed, and
 *   return a Billing Portal session URL for managing existing subscriptions.
 */

import { STRIPE_SUBSCRIPTION_DATA } from '@/constants/stripe-subscription'
import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { stripe } from '@/lib/stripe/client'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'
import { getBaseUrl } from '@/constants/base-url'

export const stripeRouter = j.router({
  /**
   * Initiate a Stripe Checkout Session for subscription purchase.
   * Ensures a Customer exists (creates one and updates user.stripeId in DB if missing).
   * @returns JSON with { url: string | null } for redirecting to Stripe Checkout.
   */
  checkout_session: privateProcedure
    .input(
      z.object({
        trial: z.boolean().optional(),
      }),
    )
    .query(
      async ({
        c,
        ctx: {
          user: { id, email, name, stripeId, hadTrial },
        },
        input: { trial },
      }) => {
        let customer: Stripe.Customer | undefined

        if (stripeId) {
          customer = (await stripe.customers.retrieve(stripeId)) as Stripe.Customer
        } else {
          const customerSearch = await stripe.customers.search({
            query: `email: "${email}"`,
          })
          customer = customerSearch.data[0] as Stripe.Customer | undefined
        }

        if (!customer) {
          customer = await stripe.customers.create({ name: name, email: email })

          await db
            .update(user)
            .set({
              stripeId: customer.id,
            })
            .where(eq(user.id, id))
        } else {
          await db.update(user).set({ stripeId: customer.id }).where(eq(user.id, id))
        }

        const checkout = await stripe.checkout.sessions.create({
          mode: 'subscription',
          billing_address_collection: 'auto',
          line_items: [{ price: STRIPE_SUBSCRIPTION_DATA.priceId!, quantity: 1 }],
          customer: customer.id,
          success_url: `${getBaseUrl()}/studio/settings?s=processing`,
          cancel_url: `${getBaseUrl()}/studio/settings?s=cancelled`,
          payment_method_types: ['card', 'link'],
          adaptive_pricing: {
            enabled: true,
          },
          currency: 'usd',
          allow_promotion_codes: true,
          consent_collection: {
            payment_method_reuse_agreement: {
              position: 'auto',
            },
          },
          payment_method_collection: 'if_required',
          // only include trial settings if the user requests a trial and hasn't had one before
          // ...(trial &&
          //   !hadTrial && {
          //     subscription_data: {
          //       trial_period_days: 7,
          //       trial_settings: {
          //         end_behavior: {
          //           missing_payment_method: 'pause',
          //         },
          //       },
          //     },
          //   }),
        })
        return c.json({ url: checkout.url ?? null })
      },
    ),

  /**
   * Create a Stripe Billing Portal session to allow the user to manage their subscription.
   * Ensures a Customer exists (creates one and updates user.stripeId in DB if missing).
   * @returns JSON with { url: string | null } for redirecting to Stripe Billing Portal.
   */
  billing_portal: privateProcedure.query(
    async ({
      c,
      ctx: {
        user: { id, name, email, stripeId },
      },
    }) => {
      let customer: Stripe.Customer | undefined

      if (stripeId) {
        customer = (await stripe.customers.retrieve(stripeId)) as Stripe.Customer
      } else {
        const customerSearch = await stripe.customers.search({
          query: `email: "${email}"`,
        })
        customer = customerSearch.data[0] as Stripe.Customer | undefined
      }

      if (!customer) {
        customer = await stripe.customers.create({ name: name, email: email })

        await db
          .update(user)
          .set({
            stripeId: customer.id,
          })
          .where(eq(user.id, id))
      } else {
        await db.update(user).set({ stripeId: customer.id }).where(eq(user.id, id))
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${getBaseUrl()}/studio/settings`,
      })

      return c.json({ url: portal.url })
    },
  ),

  subscription_product: privateProcedure.query(
    async ({
      c,
      ctx: {
        user: { hadTrial },
      },
    }) => {
      try {
        const product = await stripe.products.retrieve(STRIPE_SUBSCRIPTION_DATA.id!, {
          expand: ['default_price'],
        })
        if (!product || !product.active) {
          return c.json({ error: 'No subscription available' })
        }

        // Get price - use default_price if available, otherwise use configured priceId
        let price: Stripe.Price | null = product.default_price as Stripe.Price
        if (!price && STRIPE_SUBSCRIPTION_DATA.priceId) {
          console.log('[STRIPE_ROUTER] No default price found, fetching configured price:', STRIPE_SUBSCRIPTION_DATA.priceId)
          price = await stripe.prices.retrieve(STRIPE_SUBSCRIPTION_DATA.priceId)
        }

        if (!price) {
          console.error('[STRIPE_ROUTER] No price found for product:', product.id)
          return c.json({ error: 'No pricing available for subscription' })
        }

        const offerTrial = true
        const enableTrial: boolean = offerTrial && !hadTrial

        return c.json({
          subscription: {
            name: product.name,
            description: product.description,
            features: product.marketing_features,
            price: price,
            enableTrial,
          },
        })
      } catch (error) {
        console.error('Error fetching subscription product:', error)
        const message = error instanceof Error ? error.message : 'Unknown error occurred'
        return c.json({ error: message })
      }
    },
  ),

  subscription: privateProcedure.query(async ({ c, ctx }) => {
    const { user } = ctx
    const { stripeId } = user

    console.log(`[STRIPE_ROUTER] Checking subscription status for user: ${user.email}, stripeId: ${stripeId}`)

    if (!stripeId || !stripe) {
      console.log(`[STRIPE_ROUTER] No stripeId or stripe client, returning free status`)
      return c.json({ status: 'free' })
    }

    try {
      console.log(`[STRIPE_ROUTER] Fetching subscriptions from Stripe for customer: ${stripeId}`)
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeId,
        limit: 1,
        status: 'all',
      })

      const sub = subscriptions.data[0]
      const status = sub?.status ?? 'free'

      console.log(`[STRIPE_ROUTER] Stripe subscription status: ${status}`)
      
      // Log detailed subscription info for debugging
      if (sub) {
        console.log(`[STRIPE_ROUTER] Subscription details:`, {
          id: sub.id,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
          current_period_end: (sub as any).current_period_end,
          canceled_at: sub.canceled_at,
        })
      }

      // Sync our database with Stripe's status
      const newPlan = (status === 'active' || status === 'trialing') ? 'pro' : 'free'
      console.log(`[STRIPE_ROUTER] Updating user plan to: ${newPlan}`)
      
      await db.update(user).set({ plan: newPlan }).where(eq(user.stripeId, stripeId))

      // Return detailed subscription information
      return c.json({ 
        status,
        subscription: sub ? {
          id: sub.id,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
          current_period_end: (sub as any).current_period_end,
          canceled_at: sub.canceled_at,
          current_period_start: (sub as any).current_period_start,
        } : null
      })
    } catch (error) {
      console.error('[STRIPE_ROUTER] Error fetching subscription status:', error)
      // If Stripe fails, trust our DB for a moment but default to free if unsure
      const dbUser = await db.query.user.findFirst({ where: eq(user.stripeId, stripeId) })
      const fallbackStatus = dbUser?.plan ?? 'free'
      console.log(`[STRIPE_ROUTER] Using fallback status from database: ${fallbackStatus}`)
      return c.json({ 
        status: fallbackStatus,
        subscription: null,
        error: 'Failed to fetch from Stripe, using database fallback'
      })
    }
  }),
})
