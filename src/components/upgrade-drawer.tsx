'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { client } from '@/lib/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, Dot, Gem, Loader } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type Stripe from 'stripe'

type Subscription = {
  name: string
  description: string | null
  features: Stripe.Product.MarketingFeature[]
  price: Stripe.Price
  enableTrial: boolean
}

export const UpgradeDialog = () => {
  const router = useRouter()

  const [subscription, setSubscription] = useState<Subscription | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ['upgrade-drawer-fetch-product'],
    queryFn: async () => {
      const res = await client.stripe.subscription_product.$get()
      return await res.json()
    },
  })

  useEffect(() => {
    if (data) {
      if ('error' in data) {
        toast.error(data.error)
        return
      }

      setSubscription(data.subscription)
    }
  }, [data])

  const { mutate: handleSubscribe, isPending } = useMutation({
    mutationFn: async () => {
      const res = await client.stripe.checkout_session.$get({ trial: false })
      const data = await res.json()
      return data
    },
    onSuccess: ({ url }) => {
      if (!url) {
        toast.error('No checkout session could be created')
        return
      }

      router.push(url)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  return (
    <>
      {isLoading ? (
        <Button disabled>
          <Loader className="animate-spin size-4" /> Loading
        </Button>
      ) : subscription ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="duolingo-primary" size="duolingo-sm" className="w-full gap-1.5">
              Get Pro
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-2xl font-semibold">
                Postify Pro
              </DialogTitle>
              <DialogDescription className="text-base text-pretty">
                Join 400+ technical founders growing their business with Postify
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex flex-col gap-6 py-4">
              <div className="flex flex-col gap-2">
                <ul>
                  {subscription.features.length > 0 ? (
                    subscription.features.map((feature, i) => (
                      <li key={i} className="flex items-center justify-start gap-1.5">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-primary-500"
                        >
                          <circle cx="4" cy="4" r="4" fill="currentColor" />
                        </svg>
                        <p className='text-neutral-700'>{feature.name}</p>
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground text-sm">No features</li>
                  )}
                </ul>
              </div>

              <div className="flex gap-x-2">
                <h2 className="text-3xl flex gap-x-8 text-text-primary">
                  {subscription.price?.currency === 'usd' ? '$' : null}
                  {subscription.price?.unit_amount ? (subscription.price.unit_amount / 100).toFixed(0) : '0'}
                </h2>
                <div className="gap-y-2 flex flex-col justify-center">
                  <h3 className="text-xs leading-[0.7] opacity-60">
                    {subscription.price?.recurring?.interval === 'year' ? 'per year' : 'per month'}
                  </h3>
                  <h3 className="text-xs leading-[0.7] opacity-60">
                    {subscription.price?.recurring?.interval === 'year' ? 'billed yearly' : 'billed monthly'}
                  </h3>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="duolingo-primary"
                size="duolingo-sm"
                className="h-12 w-full"
                loading={isPending}
                onClick={() => handleSubscribe()}
              >
                Get Pro
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Button disabled>
          <Gem className="size-4" /> Upgrade
        </Button>
      )}
    </>
  )
}
