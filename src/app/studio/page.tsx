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
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [oauthOnboarding, setOauthOnboarding] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const { account, isLoading } = useAccount()
  
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

  const [showDiscard, setShowDiscard] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    // Check for ?account_connected=true in URL
    if (searchParams?.get('account_connected') === 'true') {
      setOauthOnboarding(true)
      setIsOpen(true)
      setOnboardingLoading(true)
      // Optionally, you could poll or refetch until onboarding is complete
      const check = async () => {
        queryClient.invalidateQueries({ queryKey: ['get-active-account'] })
        setOnboardingLoading(false)
      }
      check()
      router.replace('/studio', { scroll: false })
    }
  }, [searchParams, queryClient, router])

  useEffect(() => {
    if (!Boolean(account) && !Boolean(isLoading) && !isEditMode) setIsOpen(true)
  }, [account, isLoading, isEditMode])

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
                router.push(target)
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
