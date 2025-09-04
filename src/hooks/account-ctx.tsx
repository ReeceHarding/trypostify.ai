import { createContext, useContext, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Icons } from '@/components/icons'
import { Account } from '@/server/routers/settings-router'
import { motion } from 'framer-motion'
import Image from 'next/image'

// export interface ConnectedAccount {
//   name: string
//   handle: string
//   avatarFallback: string
//   avatar?: string
//   verified?: boolean
// }

const AccountContext = createContext<{
  account: Account | null
  isLoading: boolean
  refreshAccount: () => void
} | null>(null)

export function mapToConnectedAccount(raw: Account): Account {
  return {
    id: raw.id,
    name: raw?.name || '',
    username: raw?.username || '',
    profile_image_url: raw?.profile_image_url || '',
    verified: raw?.verified ?? false,
  }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  // Simple timestamp helper for structured logs with millisecond precision
  const ts = () => new Date().toISOString()

  // Development auth bypass - mock account for testing
  const shouldSkipAuth = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
  const mockAccount: Account = {
    id: 'mock-dev-user',
    name: 'Dev User',
    username: 'devuser',
    profile_image_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
    verified: true,
  }

  // Hydrate from localStorage immediately to avoid initial network delay
  const storageKey = 'active-account-cache-v1'
const initialAccount: Account | null =
    typeof window !== 'undefined'
      ? (() => {
          // Return mock account immediately if auth is bypassed
          if (shouldSkipAuth) {
            console.log(`[AccountProvider ${ts()}] SKIP_AUTH enabled, using mock account for development testing`)
            return mockAccount
          }
          
          try {
            const raw = window.localStorage.getItem(storageKey)
            if (!raw) {
              console.log(`[AccountProvider ${ts()}] no cached account in localStorage under key`, storageKey)
              return null
            }
            const parsed = JSON.parse(raw) as { account: Account; ts: number }
            console.log(`[AccountProvider ${ts()}] loaded cached account`, {
              id: parsed?.account?.id,
              username: parsed?.account?.username,
              cachedAt: parsed?.ts,
            })
            // Opportunistically preload avatar image from cache
            if (parsed?.account?.profile_image_url) {
              const img = new window.Image()
              img.src = parsed.account.profile_image_url
            }
            return parsed?.account ?? null
          } catch (err) {
            console.log(`[AccountProvider ${ts()}] failed to parse cached account`, err)
            return null
          }
        })()
      : shouldSkipAuth ? mockAccount : null

  const { data, isPending, refetch } = useQuery({
    queryKey: ['get-active-account'],
    queryFn: async () => {
      // Skip API call and return mock account in development mode
      if (shouldSkipAuth) {
        console.log(`[AccountProvider ${ts()}] SKIP_AUTH enabled, returning mock account without API call`)
        return mockAccount
      }

      const startedAt = Date.now()
      console.log(`[AccountProvider ${ts()}] fetching active account from API: client.settings.active_account`)

      const res = await client.settings.active_account.$get()
      const { account } = await res.json()

      // Preload the profile image asynchronously
      if (account?.profile_image_url) {
        const img = new window.Image()
        img.src = account.profile_image_url
      }

      const mapped = account ? mapToConnectedAccount(account) : null

      // Write-through cache to localStorage
      try {
        if (typeof window !== 'undefined') {
          if (mapped) {
            window.localStorage.setItem(
              storageKey,
              JSON.stringify({ account: mapped, ts: Date.now() }),
            )
          } else {
            window.localStorage.removeItem(storageKey)
          }
          console.log(`[AccountProvider ${ts()}] cached active account to localStorage`, {
            id: mapped?.id,
            username: mapped?.username,
            durationMs: Date.now() - startedAt,
          })
        }
      } catch (err) {
        console.log(`[AccountProvider ${ts()}] failed to cache active account`, err)
      }

      return mapped
    },
    staleTime: Infinity, // Account data virtually never changes - cache forever
    gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours in memory
    refetchOnWindowFocus: false, // Never refetch on focus
    refetchOnMount: false, // Never refetch on mount - use cache
    refetchOnReconnect: false, // Don't refetch when internet reconnects
    retry: 1, // Reduce retry attempts for faster failure
    retryDelay: 500, // Faster retry
    enabled: !shouldSkipAuth, // Disable query when auth is bypassed
    initialData: initialAccount, // Use localStorage cache as initial data
  })

  const refreshAccount = () => {
    console.log(`[AccountProvider ${ts()}] Manual account refresh triggered`)
    refetch()
  }

  return (
    <AccountContext.Provider value={{ 
      account: shouldSkipAuth ? mockAccount : (data ?? initialAccount), 
      isLoading: shouldSkipAuth ? false : isPending,
      refreshAccount
    }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}

export function AccountAvatar({ className }: { className?: string }) {
  const { account, isLoading } = useAccount()
  const [imageError, setImageError] = useState(false)
  const [isClient, setIsClient] = useState(false)
  
  // Ensure consistent rendering between server and client
  useEffect(() => {
    setIsClient(true)
  }, [])
  
  // Always show skeleton during SSR and initial client render to avoid hydration mismatch
  if (!isClient || isLoading || !account) {
    return <Skeleton className={cn('h-10 w-10 rounded-full', className)} />
  }
  
  // Extract size from className if provided
  const sizeMatch = className?.match(/(?:size|h|w)-(\d+)/)
  const size = sizeMatch ? parseInt(sizeMatch[1] || '10') * 4 : 40 // Default 40px (h-10)
  
  // Only render if we have a profile image - hide placeholder fallback
  if (!account.profile_image_url || imageError) {
    return null
  }

  return (
    <div className={cn('relative overflow-hidden rounded-full hidden sm:block', className)}>
      <Image
        src={account.profile_image_url}
        alt={account.username}
        width={size}
        height={size}
        className="size-full object-cover"
        loading="eager" // Load immediately for avatars
        priority // High priority for above-the-fold content
        unoptimized // Skip Next.js optimization for external images
        onError={() => setImageError(true)}
      />
    </div>
  )
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
}

export function AccountName({
  className,
  animate = false,
}: {
  className?: string
  animate?: boolean
}) {
  const { account, isLoading } = useAccount()

  if (isLoading || !account) {
    return <Skeleton className={cn('h-4 w-24 rounded', className)} />
  }

  const renderBadge = () => {
    if (animate)
      return (
        <motion.div
          variants={isLoading ? itemVariants : undefined}
          initial={isLoading ? { scale: 0, rotate: -180 } : false}
          animate={
            isLoading
              ? {
                  scale: 1,
                  rotate: 0,
                  transition: {
          
                    duration: 0.8,
          
                    delay: 0.5,
                  },
                }
              : false
          }
        >
          <Icons.verificationBadge className="size-4" />
        </motion.div>
      )
    else return <Icons.verificationBadge className="size-4" />
  }

  return (
    <span className={cn('font-semibold inline-flex items-center gap-1', className)}>
      {account.name}
      {account.verified && renderBadge()}
    </span>
  )
}

export function AccountHandle({ className }: { className?: string }) {
  const { account, isLoading } = useAccount()
  if (isLoading || !account) {
    return <Skeleton className={cn('h-4 w-16 rounded', className)} />
  }
  return <span className={cn('text-neutral-400', className)}>@{account.username}</span>
}

export function AccountVerifiedBadge({ className }: { className?: string }) {
  const { account, isLoading } = useAccount()
  if (isLoading || !account) {
    return <Skeleton className={cn('inline-block h-4 w-4 rounded', className)} />
  }
  if (!account.verified) return null
  return <Icons.verificationBadge className={cn('h-4 w-4', className)} />
}
