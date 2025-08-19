'use client'

import { AccountProvider } from '@/hooks/account-ctx'
import { AttachmentsProvider } from '@/hooks/use-attachments'
import { ChatProvider } from '@/hooks/use-chat'
import { EditorProvider } from '@/hooks/use-editors'
import { TweetProvider } from '@/hooks/use-tweets'
import { authClient } from '@/lib/auth-client'
import { ConfettiProvider } from '@/hooks/use-confetti'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { posthog } from 'posthog-js'
import { ReactNode, useEffect, useRef } from 'react'

interface ProvidersProps {
  children: ReactNode
}

export function DashboardProviders({ children }: ProvidersProps) {
  // Skip session check in development when SKIP_AUTH is enabled
  const shouldSkipAuth = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
  const session = shouldSkipAuth ? { data: null } : authClient.useSession()
  const isIdentifiedRef = useRef(false)

  useEffect(() => {
    if (shouldSkipAuth) {
      console.log('[DASHBOARD_PROVIDERS] SKIP_AUTH enabled, bypassing PostHog user identification')
      return
    }

    if (isIdentifiedRef.current) return

    if (session.data?.user) {
      console.log('[DASHBOARD_PROVIDERS] Identifying user with PostHog:', session.data.user.id)
      
      // Only identify user, don't capture session_started to reduce events
      posthog.identify(session.data?.user.id, {
        email: session.data.user.email,
        plan: session.data.user.plan,
      })

      isIdentifiedRef.current = true
      console.log('[DASHBOARD_PROVIDERS] User identified successfully')
    }
  }, [session, shouldSkipAuth])

  return (
    <ConfettiProvider>
      <NuqsAdapter>
        <AccountProvider>
          <EditorProvider>
            <TweetProvider>
              <AttachmentsProvider>
                <ChatProvider>{children}</ChatProvider>
              </AttachmentsProvider>
            </TweetProvider>
          </EditorProvider>
        </AccountProvider>
      </NuqsAdapter>
    </ConfettiProvider>
  )
}
