import { Stripe } from 'stripe'

// Initialize Stripe client only if API key is available
const stripeSecretKey = process.env.STRIPE_SECRET_KEY
let stripe: Stripe | null = null

if (stripeSecretKey && stripeSecretKey.trim()) {
  console.log('[STRIPE] Initializing Stripe client...', new Date().toISOString())
  stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2025-07-30.basil',
    typescript: true,
  })
  console.log('[STRIPE] Stripe client initialized successfully')
} else {
  console.log('[STRIPE] Stripe secret key not found, skipping client initialization')
}

// Export a proxy that will throw an error if Stripe is used without initialization
export { stripe }
