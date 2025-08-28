'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import DuolingoBadge from '@/components/ui/duolingo-badge'
import { Button } from '@/components/ui/button'
import DuolingoInput from '@/components/ui/duolingo-input'
import DuolingoTextarea from '@/components/ui/duolingo-textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AccountAvatar, mapToConnectedAccount, useAccount } from '@/hooks/account-ctx'
import { authClient } from '@/lib/auth-client'
import { client } from '@/lib/client'
import type { Account } from '@/server/routers/settings-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Link as LinkIcon,
  Loader2,
  Lock,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import posthog from 'posthog-js'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

interface TweetCard {
  src?: string
  username: string
  name: string
  text?: string
}

const TweetCard = ({ name, username, src, text }: TweetCard) => {
  return (
    <div className="w-full">
      <div className="text-left rounded-lg bg-white border border-dashed border-neutral-200 shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 p-6">
          <Avatar className="h-10 w-10 rounded-full border border-border/30">
            <AvatarImage src={src} alt={`@${username}`} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm/6">
              {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">{name}</span>
              <span className="text-sm/6 text-muted-foreground">@{username}</span>
            </div>
            <div className="mt-1 text-base whitespace-pre-line">{text}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const PostsPerDaySettings = () => {
  const [selectedFrequency, setSelectedFrequency] = useState<number>(3)
  const queryClient = useQueryClient()

  // Fetch current frequency setting
  const { data: frequencyData, isPending: isLoadingFrequency } = useQuery({
    queryKey: ['user-frequency'],
    queryFn: async () => {
      const res = await client.settings.getFrequency.$get()
      return await res.json()
    },
  })

  // Update frequency mutation
  const { mutate: updateFrequency, isPending: isUpdatingFrequency } = useMutation({
    mutationFn: async (frequency: number) => {
      const res = await client.settings.updateFrequency.$post({ frequency })
      return await res.json()
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['user-frequency'], data)
      toast.success(`Updated to ${data.frequency} posts per day`, { duration: 4000 })
      console.log('[ACCOUNTS] Frequency updated successfully:', data.frequency, 'posts per day')
    },
    onError: (error: HTTPException) => {
      toast.error(error.message || 'Failed to update frequency')
      console.error('[ACCOUNTS] Failed to update frequency:', error)
    },
  })

  // Set initial frequency when data loads
  useEffect(() => {
    if (frequencyData?.frequency) {
      setSelectedFrequency(frequencyData.frequency)
      console.log('[ACCOUNTS] Loaded current frequency:', frequencyData.frequency, 'posts per day')
    }
  }, [frequencyData])

  const handleFrequencyChange = (frequency: number) => {
    console.log('[ACCOUNTS] Changing frequency from', selectedFrequency, 'to', frequency, 'posts per day')
    setSelectedFrequency(frequency)
    updateFrequency(frequency)
  }

  const getSlotDescription = (freq: number) => {
    if (freq === 1) return 'Noon (12pm)'
    if (freq === 2) return '10am, 12pm'
    return '10am, 12pm, 2pm'
  }

  if (isLoadingFrequency) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-800">
            Posts Per Day
          </h3>
          <p className="text-sm text-neutral-600">
            Choose how many posts you want to schedule per day. This affects your queue slot allocation.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((freq) => (
            <button
              key={freq}
              onClick={() => handleFrequencyChange(freq)}
              disabled={isUpdatingFrequency}
              className={`
                relative p-4 rounded-lg border-2 transition-all duration-200
                ${selectedFrequency === freq
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-neutral-200 hover:border-neutral-300 text-neutral-700'
                }
                ${isUpdatingFrequency ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02]'}
              `}
            >
              {isUpdatingFrequency && selectedFrequency === freq && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg">
                  <Loader2 className="size-4 animate-spin text-primary" />
                </div>
              )}
              
              <div className="text-center space-y-2">
                <div className="text-2xl font-bold">{freq}</div>
                <div className="text-sm font-medium">
                  {freq === 1 ? 'Post' : 'Posts'} per day
                </div>
                <div className="text-xs opacity-70">
                  {getSlotDescription(freq)}
                </div>
              </div>

              {selectedFrequency === freq && (
                <div className="absolute -top-2 -right-2 size-6 bg-primary rounded-full flex items-center justify-center">
                  <Check className="size-4 text-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="text-xs text-neutral-500 bg-neutral-50 p-3 rounded-lg">
          <strong>How it works:</strong> When you click "Queue", your posts will be scheduled to the preset time slots based on your selection. 
          Once all slots for a day are filled, posts will be scheduled for the next day.
        </div>
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const [tweetLink, setTweetLink] = useState('')
  const [prompt, setPrompt] = useState('')
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [isStyleSettingsOpen, setIsStyleSettingsOpen] = useState(false)
  const [skipPostConfirmation, setSkipPostConfirmation] = useState(false)
  const { account } = useAccount()
  const { data } = authClient.useSession()
  const queryClient = useQueryClient()

  useEffect(() => {
    const stored = localStorage.getItem('skipPostConfirmation')
    if (stored !== null) {
      setSkipPostConfirmation(stored === 'true')
    }
  }, [])

  const handleSkipConfirmationToggle = (checked: boolean) => {
    setSkipPostConfirmation(checked)
    localStorage.setItem('skipPostConfirmation', checked.toString())
    toast.success(checked ? 'Post confirmation disabled' : 'Post confirmation enabled', { duration: 3000 })
  }

  const { mutate: createOAuthLink, isPending: isCreatingOAuthLink } = useMutation({
    mutationFn: async (action: 'onboarding' | 'add-account') => {
      const res = await client.auth_router.createTwitterLink.$get({ action })
      return await res.json()
    },
    onError: (error: HTTPException | any) => {
      // Surface backend message (e.g., upgrade required) instead of a generic error
      const msg = error?.message || 'Error, please try again'
      toast.error(msg)
    },
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })

  const { mutate: createInviteLink, isPending: isCreatingInviteLink } = useMutation({
    mutationFn: async () => {
      const res = await client.auth_router.createInviteLink.$get()
      return await res.json()
    },
    onMutate: () => {
      setShowInviteDialog(true)
    },
    onError: () => {
      toast.error('Error creating invite link')
    },
    onSuccess: ({ url }) => {
      setInviteLink(url)
    },
  })

  const { data: accounts, isPending: isLoadingAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await client.settings.list_accounts.$get()
      return await res.json()
    },
  })

  const {
    mutate: switchAccount,
    isPending: isSwitching,
    variables: switchAccountVariables,
  } = useMutation({
    mutationFn: async ({ accountId }: { accountId: string }) => {
      const res = await client.settings.switch_account.$post({ accountId })
      return await res.json()
    },
    onSuccess: ({ account }) => {
      posthog.capture('account_switched', {
        accountId: account.id,
        accountName: account.name,
        accountUsername: account.username,
      })

      queryClient.setQueryData(['get-active-account'], mapToConnectedAccount(account))

      queryClient.setQueryData(['accounts'], (oldData: any) => {
        if (!oldData?.accounts) return oldData
        return {
          ...oldData,
          accounts: oldData.accounts.map((acc: Account) => ({
            ...acc,
            isActive: acc.id === account.id,
          })),
        }
      })

      toast.success(`Switched to ${account.name}`, { duration: 4000 })
    },
    onError: (error: HTTPException) => {
      toast.error(error.message)
    },
  })

  const {
    mutate: deleteAccount,
    isPending: isDeletingAccount,
    variables: deleteAccountVariables,
  } = useMutation({
    mutationFn: async ({ accountId }: { accountId: string }) => {
      await client.settings.delete_account.$post({ accountId })
    },
    onMutate: async ({ accountId }) => {
      await queryClient.cancelQueries({ queryKey: ['accounts'] })
      const previousAccounts = queryClient.getQueryData(['accounts'])

      queryClient.setQueryData(['accounts'], (oldData: any) => {
        if (!oldData?.accounts) return oldData
        return {
          ...oldData,
          accounts: oldData.accounts.filter((acc: Account) => acc.id !== accountId),
        }
      })

      return { previousAccounts }
    },
    onSuccess: () => {
      toast.success('Account deleted successfully', { duration: 3000 })
    },
    onError: (error: HTTPException, _, context) => {
      queryClient.setQueryData(['accounts'], context?.previousAccounts)
      toast.error(error.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const { mutate: importTweets, isPending: isImporting } = useMutation({
    mutationFn: async ({ link }: { link: string }) => {
      if (!account) return

      await client.style.import.$post({ link })
    },
    onSuccess: () => {
      setTweetLink('')
      refetchStyle()
      toast.success('Post imported successfully', { duration: 3000 })
    },
    onError: (error: HTTPException) => {
      toast.error(error.message)
    },
  })

  const {
    mutate: deleteTweet,
    isPending: isDeleting,
    variables: deleteVariables,
  } = useMutation({
    mutationFn: async ({ tweetId }: { tweetId: string }) => {
      if (!account) return

      await client.style.delete.$post({ tweetId })
    },
    onError: (error: HTTPException) => {
      toast.error(error.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['account-style'] })
    },
  })

  const { mutate: savePrompt, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      await client.style.save.$post({ prompt })
    },
    onSuccess: () => {
      refetchStyle()
      toast.success('Style saved', { duration: 3000 })
    },
    onError: (error: HTTPException) => {
      toast.error(error.message)
    },
  })

  const { data: style, refetch: refetchStyle } = useQuery({
    queryKey: ['account-style', account?.id],
    queryFn: async () => {
      const res = await client.style.get.$get()
      const style = await res.json()

      console.log('STYLE PROMPT', style.prompt)

      if (typeof style.prompt === 'string') setPrompt(style.prompt)

      return style
    },
  })

  return (
    <div className="relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-900">Account Management</h1>
        <p className="text-neutral-600">
          Manage your connected accounts, writing style, and preferences
        </p>
      </div>

      {/* Connected Accounts Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-800">
              All Connected Accounts
            </h2>
            <p className="text-neutral-600 text-sm">
              Your personal accounts and accounts delegated to you
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="duolingo-primary" size="duolingo-sm" className="w-auto relative z-20">
                <Plus className="size-4 mr-2" />
                <span className="whitespace-nowrap">Add Account</span>
                <ChevronDown className="size-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-3 border-2 shadow-xl">
              <div className="space-y-2">
                <DropdownMenuItem asChild>
                  <button
                    onClick={() => setShowConnectDialog(true)}
                    className="flex items-center gap-4 p-4 rounded-xl hover:bg-twitter-50 transition-all cursor-pointer border-0 w-full group hover:shadow-sm"
                  >
                    <div className="flex-shrink-0 size-10 bg-neutral-100 border border-neutral-900 border-opacity-10 bg-clip-padding shadow-sm rounded-md flex items-center justify-center transition-all">
                      <Plus className="size-5 text-neutral-600 transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <h4 className="font-semibold text-neutral-900 group-hover:text-twitter-900 transition-colors">
                        Personal Account
                      </h4>
                      <p className="text-sm opacity-60 leading-relaxed">
                        Add a personal Twitter account
                      </p>
                    </div>
                  </button>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <button
                    onClick={() => createInviteLink()}
                    disabled={isCreatingInviteLink}
                    className="flex items-center gap-4 p-4 rounded-xl hover:bg-primary-50 transition-all cursor-pointer border-0 w-full group hover:shadow-sm disabled:opacity-50"
                  >
                    <div className="flex-shrink-0 size-10 bg-neutral-100 border border-neutral-900 border-opacity-10 bg-clip-padding shadow-sm rounded-md flex items-center justify-center transition-all">
                      <UserPlus className="size-5 text-neutral-600 transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <h4 className="font-semibold text-neutral-900 group-hover:text-twitter-900 transition-colors">
                        Delegate Access
                      </h4>
                      <p className="text-sm opacity-60 leading-relaxed">
                        Add a client/brand account
                      </p>
                    </div>
                  </button>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isLoadingAccounts ? (
          <div className="bg-white">
            {[1].map((index) => (
              <div key={index}>
                <div className="rounded-lg p-4">
                  <div className="w-full flex items-center justify-between">
                    <div className="w-full flex items-center gap-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16 rounded-md" />
                  </div>
                </div>
                {index === 1 && <Separator />}
              </div>
            ))}
          </div>
        ) : accounts?.accounts?.length ? (
          <div className="bg-white">
            {accounts.accounts.map((acc, i) => (
              <div key={acc.id}>
                <div className="rounded-lg p-4">
                  <div className="group w-full flex items-center justify-between gap-3">
                    <div className="w-full flex items-center gap-3">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Avatar className="size-10">
                            <AvatarImage
                              src={acc.profile_image_url}
                              alt={`@${acc.username}`}
                            />
                            <AvatarFallback className="bg-primary/10 text-primary text-sm/6">
                              {acc.name?.slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{acc.name}</p>
                          </div>
                          <p className="text-sm opacity-60">@{acc.username}</p>
                        </div>
                      </div>
                      {acc.isActive ? (
                        <div className="flex items-end flex-col w-full flex-1">
                          <div className="flex items-center gap-2">
                            <DuolingoBadge variant="achievement" className="text-xs px-2">
                              <Check className="size-3 mr-1" />
                              Active
                            </DuolingoBadge>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {acc.isActive ? (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <Button
                          onClick={() => createOAuthLink('onboarding')}
                          variant="duolingo-secondary"
                          size="duolingo-sm"
                          className="w-fit"
                          loading={isCreatingOAuthLink}
                        >
                          <LinkIcon className="size-4 mr-1" />
                          Reconnect
                        </Button>
                      </div>
                    ) : (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <Button
                          onClick={() => switchAccount({ accountId: acc.id })}
                          variant="duolingo-secondary"
                          size="duolingo-sm"
                          className="w-fit"
                          loading={
                            isSwitching && switchAccountVariables?.accountId === acc.id
                          }
                        >
                          Switch
                        </Button>
                        <Button
                          onClick={() => createOAuthLink('onboarding')}
                          variant="duolingo-secondary"
                          size="duolingo-sm"
                          className="w-fit"
                          loading={isCreatingOAuthLink}
                        >
                          <LinkIcon className="size-4 mr-1" />
                          Reconnect
                        </Button>
                        <Button
                          onClick={() => deleteAccount({ accountId: acc.id })}
                          variant="duolingo-destructive"
                          size="duolingo-icon"
                          loading={
                            isDeletingAccount &&
                            deleteAccountVariables?.accountId === acc.id
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {i < accounts.accounts.length - 1 && <Separator />}
              </div>
            ))}
          </div>
            ) : (
          <div className="rounded-lg bg-white border border-dashed border-neutral-300 p-8 text-center space-y-4">
            <p className="text-neutral-600">No accounts connected yet</p>
            <Button
              variant="duolingo-primary"
              size="duolingo-sm"
              onClick={() => setShowConnectDialog(true)}
              className="w-fit"
            >
              <Plus className="size-4 mr-2" />
              Connect account
            </Button>
          </div>
        )}
      </div>

      <Separator />

      {/* Post Settings Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Post Settings</h2>
          <p className="text-neutral-600 mt-1">Configure posting behavior and preferences</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-neutral-800">
                Skip Post Confirmation
              </h3>
              <p className="text-sm text-neutral-600">
                When enabled, posts will be sent immediately without showing a confirmation modal
              </p>
            </div>
            <Switch
              checked={skipPostConfirmation}
              onCheckedChange={handleSkipConfirmationToggle}
            />
          </div>
        </div>

        <PostsPerDaySettings />
      </div>

      <Separator />

      {/* Style Settings Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Style Settings</h2>
          <p className="text-neutral-600 mt-1">Customize AI assistant output</p>
        </div>

        <Collapsible open={isStyleSettingsOpen} onOpenChange={setIsStyleSettingsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full group">
              <div className="flex items-center justify-between p-4 rounded-t-lg border border-neutral-200 bg-white hover:bg-neutral-50 transition-colors">
                <div className="flex items-center gap-3">
                  {account && <AccountAvatar className="size-10" />}
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-neutral-800">
                        Writing Style & References
                      </h3>
                      {/* <DuolingoBadge variant="gray" className="px-3 text-xs">
                        Optional
                      </DuolingoBadge> */}
                    </div>
                    {account && (
                      <p className="text-sm opacity-60">For @{account.username}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isStyleSettingsOpen ? (
                    <ChevronDown className="size-5 text-neutral-500 transition-transform" />
                  ) : (
                    <ChevronRight className="size-5 text-neutral-500 transition-transform" />
                  )}
                </div>
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="bg-white border border-t-0 border-neutral-200 rounded-b-lg space-y-6 pt-4 pb-4">
            {/* Fine-Tune Writing Style */}
            <div className="px-4 space-y-4">
              <div>
                <h4 className="text-base font-semibold text-neutral-800">
                  Fine-Tune Writing Style
                </h4>
                <p className="opacity-60 text-sm">
                  Describe your writing preferences, tone, and style patterns
                </p>
              </div>

              <DuolingoTextarea
                fullWidth
                className="min-h-32"
                placeholder="My posts always use this symbol (◆) for bullet points and usually consist of a short, catchy intro hook and three bullet points. I love expressing excitement and celebration"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />

              <Button
                onClick={() => savePrompt()}
                variant="duolingo-primary"
                size="duolingo-sm"
                disabled={isSaving}
                className="w-fit"
              >
                <Save className="mr-2 size-4" />
                Save Writing Style
              </Button>
            </div>

            <Separator className="mx-4" />

            {/* Style Reference Tweets */}
            <div className="px-4 space-y-4">
              <div>
                <h4 className="text-base font-semibold text-neutral-800">
                  Style Reference Tweets
                </h4>
                <p className="opacity-60 text-sm">
                  Import tweets that exemplify your desired writing style
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <DuolingoInput
                  fullWidth
                  value={tweetLink}
                  onChange={(e) => setTweetLink(e.target.value)}
                  className="flex-1"
                  type="text"
                  placeholder="https://x.com/username/status/1234567890123456789"
                />
                <Button
                  onClick={() => importTweets({ link: tweetLink })}
                  disabled={isImporting || !tweetLink.trim()}
                  variant="duolingo-secondary"
                  size="duolingo-sm"
                  className="w-fit"
                >
                  Import
                </Button>
              </div>

              <div className="">
                {style?.tweets?.length ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-neutral-700">
                      {style.tweets.length} reference tweet
                      {style.tweets.length > 1 ? 's' : ''}
                    </p>
                    <div className="space-y-3">
                      {style.tweets.map((tweet, index) => (
                        <div className="relative" key={index}>
                          <Button
                            variant="duolingo-destructive"
                            className="absolute top-3 right-3 w-fit p-1.5 text-white aspect-square z-10"
                            onClick={() => deleteTweet({ tweetId: tweet.id })}
                            disabled={isDeleting && deleteVariables?.tweetId === tweet.id}
                          >
                            {isDeleting && deleteVariables?.tweetId === tweet.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <X className="size-4" />
                            )}
                          </Button>
                          <TweetCard
                            username={tweet.author.username}
                            name={tweet.author.name}
                            src={tweet.author.profile_image_url}
                            text={tweet.text}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Sparkles className="w-10 h-10 text-neutral-300 mb-3" />
                    <p className="text-sm font-medium text-neutral-700">
                      No imported posts yet
                    </p>
                    <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                      Import posts that match your desired writing style
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Before connecting:</DialogTitle>
            <DialogDescription>
              Make sure you are signed in to the Twitter/X account you wish to connect.
              <br />
              <br />
              You may need to{' '}
              <a
                href="https://x.com/account/switch"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline underline-offset-2 hover:underline"
              >
                switch accounts
              </a>{' '}
              before authenticating.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row">
            <Button
              variant="duolingo-secondary"
              size="duolingo-sm"
              onClick={() => setShowConnectDialog(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                createOAuthLink('add-account')
                setShowConnectDialog(false)
              }}
              variant="duolingo-primary"
              size="duolingo-sm"
              disabled={isCreatingOAuthLink}
              className="w-full sm:w-auto"
            >
              {isCreatingOAuthLink ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isCreatingInviteLink
                ? 'Creating Access Link...'
                : 'Secure Access Link Created'}
            </DialogTitle>
            <DialogDescription>
              Send this invite to the account owner (client, brand, company). Once
              accepted, the brand/client account will appear in your dashboard with
              posting permissions.
            </DialogDescription>
          </DialogHeader>

          {isCreatingInviteLink ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-neutral-500" />
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex items-center space-x-2 p-3 bg-neutral-50 rounded-lg border">
                  <LinkIcon className="size-4 text-neutral-500 flex-shrink-0" />
                  <input
                    type="text"
                    value={inviteLink}
                    readOnly
                    className="flex-1 bg-transparent text-sm text-neutral-700 outline-none"
                  />
                  <Button
                    variant="duolingo-secondary"
                    size="duolingo-sm"
                    className="w-fit p-2"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink)
                      toast.success('Link copied to clipboard', { duration: 2000 })
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-neutral-600">This link is valid for 24 hours.</p>
              </div>

              <DialogFooter>
                <Button
                  variant="duolingo-primary"
                  size="duolingo-sm"
                  onClick={() => setShowInviteDialog(false)}
                  className="w-full"
                >
                  Got it
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
