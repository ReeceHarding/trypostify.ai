'use client'

import ThreadTweetEditor from '@/components/tweet-editor/thread-tweet-editor'
import { OnboardingModal } from '@/frontend/studio/components/onboarding-modal'
import {
  Dialog as DiscardDialog,
  DialogContent as DiscardContent,
  DialogFooter as DiscardFooter,
  DialogHeader as DiscardHeader,
  DialogTitle as DiscardTitle,
} from '@/components/ui/dialog'
import { useAccount } from '@/hooks/account-ctx'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const Page = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [oauthOnboarding, setOauthOnboarding] = useState(false)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const { account, isLoading } = useAccount()
  // Prevent handling account_connected flow multiple times on the same mount
  const handledAccountConnectedRef = useRef(false)

  
  const editTweetId = searchParams?.get('edit')
  // Debug logs to trace edit flow
  if (typeof window !== 'undefined' && editTweetId) {
    try {
      console.log('[StudioPage] editTweetId found in URL', {
        editTweetId,
        href: window.location.href,
        ts: new Date().toISOString(),
      })
    } catch {}
  }
  const isEditMode = Boolean(editTweetId)

  const [showDiscard, setShowDiscard] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  // Intercept clicks on the global "Create" link when in edit mode
  useEffect(() => {
    const onOpen = (e: any) => {
      console.log('[StudioPage] open-discard-confirm event received', {
        isEditMode,
        existingPromptOpen: showDiscard,
        href: e?.detail?.href,
        ts: new Date().toISOString(),
      })
      if (!isEditMode) return
      setShowDiscard(true)
      setPendingHref(e?.detail?.href || '/studio')
    }
    window.addEventListener('open-discard-confirm', onOpen as any)
    return () => window.removeEventListener('open-discard-confirm', onOpen as any)
  }, [isEditMode, showDiscard])


  useEffect(() => {
    // Check for ?account_connected=true in URL
    if (searchParams?.get('account_connected') === 'true' && !handledAccountConnectedRef.current) {
      handledAccountConnectedRef.current = true
      console.log('[StudioPage] Account connected, showing completion')
      // Mark as completed immediately to prevent modal from reopening
      setHasCompletedOnboarding(true)

      // Wait a bit for account data to load before showing modal
      const timer = setTimeout(async () => {
        // Invalidate and wait for the query to actually refetch
        await queryClient.invalidateQueries({ queryKey: ['get-active-account'] })

        // Force a refetch and wait for it to complete
        try {
          const accountData = await queryClient.fetchQuery({
            queryKey: ['get-active-account'],
          })

          console.log('[StudioPage] Account data after refetch:', accountData)

          if (accountData) {
            setOauthOnboarding(true)
            setIsOpen(true)
            setOnboardingLoading(true)
            // Close modal after showing success, then clean URL
            setTimeout(() => {
              setIsOpen(false)
              setOauthOnboarding(false)
              setOnboardingLoading(false)
              router.replace('/studio', { scroll: false })
            }, 3000)
          }
        } catch (error) {
          console.error('[StudioPage] Error fetching account after connection:', error)
        }
      }, 1000) // Wait 1 second for Redis to be ready

      return () => clearTimeout(timer)
    }
  }, [searchParams, queryClient, router])

  useEffect(() => {
    // Log the current state for debugging
    console.log('[StudioPage] Onboarding state check:', {
      hasAccount: Boolean(account),
      isLoading,
      isEditMode,
      oauthOnboarding,
      hasCompletedOnboarding,
      timestamp: new Date().toISOString()
    })
    
    // Only open onboarding if no account exists AND we're not coming from Twitter connection
    if (!Boolean(account) && !Boolean(isLoading) && !isEditMode && !oauthOnboarding && !hasCompletedOnboarding) {
      console.log('[StudioPage] No account found, opening onboarding modal')
      setIsOpen(true)
    }
  }, [account, isLoading, isEditMode, oauthOnboarding, hasCompletedOnboarding])

  return (
    <>
      {/* Discard confirmation when attempting to leave edit mode */}
      <DiscardDialog open={showDiscard} onOpenChange={(o) => {
        console.log('[StudioPage] discard dialog onOpenChange', { open: o })
        setShowDiscard(o)
      }}>
        <DiscardContent className="bg-white rounded-2xl p-6 max-w-md">
          <DiscardHeader>
            <DiscardTitle>Discard changes?</DiscardTitle>
          </DiscardHeader>
          <p className="text-sm text-neutral-600">You have unsaved changes in this thread. Are you sure you want to discard them?</p>
          <DiscardFooter>
            <button
              className="font-semibold rounded-lg relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-white border bg-clip-padding text-neutral-700 border-b-2 border-neutral-300 hover:bg-neutral-50 shadow-[0_3px_0_hsl(var(--neutral-300))] focus:ring-neutral-300 text-sm py-2 px-4"
              onClick={() => {
                console.log('[StudioPage] discard canceled')
                setShowDiscard(false)
              }}
            >
              Cancel
            </button>
            <button
              className="font-semibold rounded-lg relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-error-600 border bg-clip-padding text-white border-b-2 border-error-700 hover:bg-error-700 shadow-[0_3px_0_hsl(var(--error-700))] focus:ring-error-300 text-sm py-2 px-4"
              onClick={() => {
                console.log('[StudioPage] discard confirmed, navigating', { href: pendingHref })
                setShowDiscard(false)
                const target = pendingHref || '/studio'
                setPendingHref(null)
                // Clear editor state by removing ?edit and pushing to create page
                const url = new URL(target, window.location.origin)
                url.searchParams.delete('edit')
                router.push(url.pathname + (url.search ? `?${url.searchParams}` : ''))
              }}
            >
              Discard
            </button>
          </DiscardFooter>
        </DiscardContent>
      </DiscardDialog>
      {isOpen ? (
        <OnboardingModal
          onOpenChange={setIsOpen}
          oauthOnboarding={oauthOnboarding}
          loading={onboardingLoading}
        />
      ) : null}
      <div className="max-w-xl w-full mx-auto">
        <ThreadTweetEditor editMode={isEditMode} editTweetId={editTweetId} />
      </div>
    </>
  )
}

export default Page
