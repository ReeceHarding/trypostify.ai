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
import { useEffect, useState } from 'react'

const Page = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [oauthOnboarding, setOauthOnboarding] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const { account, isLoading } = useAccount()
  
  const editTweetId = searchParams?.get('edit')
  const isEditMode = Boolean(editTweetId)
  
  // Debug logs to trace edit flow (only log once per change)
  useEffect(() => {
    if (typeof window !== 'undefined' && editTweetId) {
      console.log('[StudioPage] editTweetId found in URL', {
        editTweetId,
        href: window.location.href,
        ts: new Date().toISOString(),
      })
    }
  }, [editTweetId])

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
    // If we have the account and came back with account_connected=true, show completion once
    if (searchParams?.get('account_connected') === 'true' && account && !isLoading) {
      console.log('[StudioPage] Account connected and loaded, showing completion')
      setOauthOnboarding(true)
      setIsOpen(true)
      const timer = setTimeout(() => {
        setIsOpen(false)
        setOauthOnboarding(false)
        router.replace('/studio', { scroll: false })
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [searchParams, account, isLoading, router])

  useEffect(() => {
    // Log the current state for debugging
    console.log('[StudioPage] Onboarding state check:', {
      hasAccount: Boolean(account),
      isLoading,
      isEditMode,
      oauthOnboarding,
      timestamp: new Date().toISOString()
    })
    
    // Only open onboarding if no account exists AND we're not coming from Twitter connection
    // Guard against the OAuth redirect race by not opening when account_connected flag is present
    const cameFromOAuth = searchParams?.get('account_connected') === 'true'
    if (!Boolean(account) && !Boolean(isLoading) && !isEditMode && !oauthOnboarding && !cameFromOAuth) {
      console.log('[StudioPage] No account found, opening onboarding modal')
      setIsOpen(true)
    }
  }, [account, isLoading, isEditMode, oauthOnboarding, searchParams])

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
        />
      ) : null}
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <ThreadTweetEditor editMode={isEditMode} editTweetId={editTweetId} />
      </div>
    </>
  )
}

export default Page
