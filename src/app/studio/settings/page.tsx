'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import DuolingoBadge from '@/components/ui/duolingo-badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { UpgradeDialog } from '@/components/upgrade-drawer'
import { authClient } from '@/lib/auth-client'
import { client } from '@/lib/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isToday, isTomorrow } from 'date-fns'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Trash2, Clock } from 'lucide-react'
import { useUser } from '@/hooks/use-user'
import { Skeleton } from '@/components/ui/skeleton'

const Page = () => {
  const router = useRouter()
  const { data } = authClient.useSession()
  const queryClient = useQueryClient()
  const { user, isLoading: isUserLoading } = useUser()

  const searchParams = useSearchParams()
  const status = searchParams.get('s')

  const handleLogout = async () => {
    // Clear any cached active account when signing out
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('active-account-cache-v1')
      }
    } catch {}

    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/')
        },
      },
    })
  }

  const { data: subscription } = useQuery({
    queryKey: ['get-subscription'],
    queryFn: async () => {
      const res = await client.stripe.subscription.$get()
      const data = await res.json()
      return data
    },
    refetchInterval(query) {
      if (query.state.data?.status === 'active') {
        return false
      }

      return 2500
    },
    enabled: status === 'processing',
  })

  const { data: limit, isLoading: isLimitLoading } = useQuery({
    queryKey: ['chat-limit'],
    queryFn: async () => {
      const res = await client.settings.limit.$get()
      return res.json()
    },
    enabled: !isUserLoading && user?.plan !== 'pro',
  })

  useEffect(() => {
    if (status) {
      if (status === 'cancelled') {
        router.push('/studio/settings')
        return
      }

      if (status === 'processing') {
        if (data?.user.plan === 'pro') {
          toast.success('Upgraded to pro.')
          router.push('/studio/settings')
          return
        }

        return
      }
    }
  }, [data])

  const { mutate: createBillingPortalUrl, isPending: isCreatingBillingPortalUrl } =
    useMutation({
      mutationFn: async () => {
        const res = await client.stripe.billing_portal.$get()
        const data = await res.json()
        return data
      },
      onSuccess: ({ url }) => {
        router.push(url)
      },
      onError: (error) => {
        console.error(error)
        toast.error('Something went wrong, please try again.')
      },
    })

  const { mutate: deleteUser, isPending: isDeletingUser } = useMutation({
    mutationFn: async () => {
      const res = await client.settings.delete_user.$post()
      return await res.json()
    },
    onSuccess: async () => {
      toast.success('Your account has been deleted')
      // Clear any cached active account to avoid stale auto-selection
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('active-account-cache-v1')
        }
      } catch {}
      // Sign out the session and redirect home
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('/')
          },
        },
      })
    },
    onError: (error) => {
      console.error(error)
      toast.error('Failed to delete account, please try again')
    },
  })

  // Posting window settings state
  const [postingWindowStart, setPostingWindowStart] = useState<number>(8)
  const [postingWindowEnd, setPostingWindowEnd] = useState<number>(18)

  // Fetch posting window settings
  const { data: postingWindow } = useQuery({
    queryKey: ['posting-window'],
    queryFn: async () => {
      console.log('[SETTINGS] Fetching posting window...')
      const res = await client.settings.getPostingWindow.$get()
      const data = await res.json()
      console.log('[SETTINGS] Posting window fetched:', data)
      return data
    },
  })

  // Update local state when data is fetched
  useEffect(() => {
    if (postingWindow) {
      setPostingWindowStart(postingWindow.start)
      setPostingWindowEnd(postingWindow.end)
    }
  }, [postingWindow])

  // Update posting window mutation
  const { mutate: updatePostingWindow, isPending: isUpdatingPostingWindow } = useMutation({
    mutationFn: async (data: { start: number; end: number }) => {
      console.log('[SETTINGS] Updating posting window:', data)
      const res = await client.settings.updatePostingWindow.$post(data)
      const result = await res.json()
      return result
    },
    onSuccess: () => {
      console.log('[SETTINGS] Posting window updated successfully')
      // Invalidate the posting window cache to refresh the display
      queryClient.invalidateQueries({ queryKey: ['posting-window'] })
      toast.success('Posting window updated successfully!')
    },
    onError: (error) => {
      console.error('[SETTINGS] Failed to update posting window:', error)
      toast.error('Failed to update posting window')
    },
  })

  const handlePostingWindowUpdate = () => {
    if (postingWindowStart >= postingWindowEnd) {
      toast.error('Start time must be before end time')
      return
    }
    updatePostingWindow({ start: postingWindowStart, end: postingWindowEnd })
  }

  const formatHour = (hour: number) => {
    if (hour === 0) return '12:00 AM'
    if (hour === 12) return '12:00 PM'
    if (hour < 12) return `${hour}:00 AM`
    return `${hour - 12}:00 PM`
  }

  return (
    <div className="relative w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
      <div className="relative w-full flex  flex-col gap-6 bg-white/90 shadow-xl rounded-2xl z-10 py-10 px-6 md:px-12">
        <div className="flex flex-col items-center w-full gap-6 bg-light-gray rounded-lg p-5">
          {/* user card */}
          <div className="flex flex-col gap-2 items-center">
            {/* <div className="mb-4">
              <Avatar className="w-24 h-24 border-4 border-white shadow-md">
                <AvatarImage
                  src={data?.user.image ?? undefined}
                  alt={data?.user.name ?? 'Profile'}
                />
                <AvatarFallback className="bg-gradient-to-br from-indigo-300 to-indigo-400 text-white text-3xl">
                  {data?.user.name?.charAt(0) ?? null}
                </AvatarFallback>
              </Avatar>
            </div> */}
            <div className="mb-1 flex flex-col items-center">
              <p className="text-2xl font-semibold text-neutral-900">{data?.user.name}</p>
              <p className="text-sm text-neutral-500">{data?.user.email}</p>
            </div>
            {isUserLoading ? (
              <Skeleton className="h-6 w-20 mb-6" />
            ) : user?.plan === 'pro' ? (
              <DuolingoBadge className="mb-6 px-3">Pro Plan</DuolingoBadge>
            ) : (
              <DuolingoBadge variant="gray" className="mb-6 px-3">Free Plan</DuolingoBadge>
            )}
          </div>

          {/* usage card */}
          <div className="bg-white shadow-sm rounded-xl p-3 w-full">
            {isUserLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : user?.plan === 'pro' ? (
              <div className="flex flex-col items-center justify-center gap-2">
                <p className="text-sm opacity-60">
                  You have unlimited access to all features!
                </p>
                
                {/* Show cancellation info if subscription is set to cancel */}
                {subscription?.subscription?.cancel_at_period_end && subscription?.subscription?.current_period_end && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 w-full mb-2">
                    <div className="flex items-center gap-2 text-yellow-800">
                      <Clock className="size-4" />
                      <div className="text-sm">
                        <p className="font-medium">Subscription Ending</p>
                        <p>
                          Your Pro plan will end on{' '}
                          <span className="font-semibold">
                            {format(new Date(subscription.subscription.current_period_end * 1000), 'MMMM d, yyyy')}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                <Button
                  variant="duolingo-primary"
                  onClick={() => createBillingPortalUrl()}
                  loading={isCreatingBillingPortalUrl}
                >
                  Manage plan
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="w-full text-center">
                  <p className="font-medium text-neutral-900">Daily Message Limit</p>
                  {isLimitLoading ? (
                    <Skeleton className="h-4 w-24 mx-auto mt-1" />
                  ) : (
                    <p className="text-sm text-neutral-600">
                      {limit?.remaining ?? 20}/20 remaining
                    </p>
                  )}
                </div>
                <UpgradeDialog />
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-center mt-4">
          <p
            onClick={handleLogout}
            className="underline cursor-pointer underline-offset-2 text-neutral-600 hover:text-neutral-800"
          >
            Sign out
          </p>
        </div>

        {/* Posting Window Settings */}
        <Separator className="my-6" />
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-semibold text-neutral-900">Daily Posting Window</p>
                  <p className="text-sm text-neutral-600 mt-1">
                    Set the hours when you want your posts to be automatically queued. Posts will only be scheduled within this time window.
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Start Time
                  </label>
                  <select
                    value={postingWindowStart}
                    onChange={(e) => setPostingWindowStart(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {formatHour(i)}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    End Time
                  </label>
                  <select
                    value={postingWindowEnd}
                    onChange={(e) => setPostingWindowEnd(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {formatHour(i)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-neutral-600">
                  Current window: {formatHour(postingWindowStart)} - {formatHour(postingWindowEnd)}
                </div>
                <Button
                  variant="duolingo-primary"
                  size="duolingo-sm"
                  onClick={handlePostingWindowUpdate}
                  disabled={isUpdatingPostingWindow || postingWindowStart >= postingWindowEnd}
                >
                  {isUpdatingPostingWindow ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Window'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <Separator className="my-6" />
        <div className="bg-white border border-error-100 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-neutral-900">Delete Account</p>
              <p className="text-sm text-neutral-600 mt-1">
                Permanently delete your account, connected social accounts, queued content, knowledge, and media. This action cannot be undone.
              </p>
            </div>
            <Button
              variant="duolingo-destructive"
              size="duolingo-sm"
              className="w-fit"
              onClick={() => {
                const ok = window.confirm('This will erase all your data. Are you sure?')
                if (ok) deleteUser()
              }}
              disabled={isDeletingUser}
            >
              {isDeletingUser ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Page
