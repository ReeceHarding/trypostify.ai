'use client'

import { authClient } from '@/lib/auth-client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import posthog from 'posthog-js'
import { useRouter } from 'next/navigation'

const LoginPage = () => {
  const router = useRouter()
  const [hasInitialized, setHasInitialized] = useState(false)

  const checkIfLoggedIn = async () => {
    const { data } = await authClient.getSession()
    return !!data?.session.id
  }
  const handleAccess = async () => {
    const { data, error } = await authClient.signIn.social({ provider: 'google' })

    if (error) {
      console.error(error)
      posthog.captureException(error)

      toast.error(
        error.message ?? 'An error occurred, please DM @joshtriedcoding on twitter!',
      )
    }
  }

  useEffect(() => {
    // Prevent multiple initializations
    if (hasInitialized) return
    setHasInitialized(true)

    // Skip auth in development when SKIP_AUTH is enabled - redirect directly to studio
    const shouldSkipAuth = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
    
    if (shouldSkipAuth) {
      console.log('[LoginPage] SKIP_AUTH enabled, redirecting directly to studio')
      router.push('/studio')
      return
    }

    checkIfLoggedIn().then((isLoggedIn) => {
      if (isLoggedIn) {
        console.log('[LoginPage] User already logged in, redirecting to studio')
        router.push('/studio')
      } else {
        console.log('[LoginPage] User not logged in, starting Google auth')
        handleAccess()
      }
    })
  }, [hasInitialized])

  return null
}

export default LoginPage
