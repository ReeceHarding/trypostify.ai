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
