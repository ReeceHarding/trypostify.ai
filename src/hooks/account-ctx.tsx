import { createContext, useContext, useState } from 'react'
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
  const { data, isPending } = useQuery({
    queryKey: ['get-active-account'],
    queryFn: async () => {
      const res = await client.settings.active_account.$get()
      const { account } = await res.json()
      
      // Preload the profile image
      if (account?.profile_image_url) {
        const img = new window.Image()
        img.src = account.profile_image_url
      }
      
      return account ? mapToConnectedAccount(account) : null
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
  })

  return (
    <AccountContext.Provider value={{ account: data ?? null, isLoading: isPending }}>
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
  
  if (isLoading || !account) {
    return <Skeleton className={cn('h-10 w-10 rounded-full', className)} />
  }
  
  // Extract size from className if provided
  const sizeMatch = className?.match(/(?:size|h|w)-(\d+)/)
  const size = sizeMatch ? parseInt(sizeMatch[1] || '10') * 4 : 40 // Default 40px (h-10)
  
  return (
    <div className={cn('relative overflow-hidden rounded-full', className)}>
      {account.profile_image_url && !imageError ? (
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
      ) : (
        <div className="flex size-full items-center justify-center bg-stone-200 text-stone-600 font-semibold">
          {(account?.name?.[0] || account?.username?.[0] || '?').toUpperCase()}
        </div>
      )}
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
  return <span className={cn('text-stone-400', className)}>@{account.username}</span>
}

export function AccountVerifiedBadge({ className }: { className?: string }) {
  const { account, isLoading } = useAccount()
  if (isLoading || !account) {
    return <Skeleton className={cn('inline-block h-4 w-4 rounded', className)} />
  }
  if (!account.verified) return null
  return <Icons.verificationBadge className={cn('h-4 w-4', className)} />
}
