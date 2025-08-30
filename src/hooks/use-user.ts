import { authClient } from '@/lib/auth-client'

/**
 * User hook to access user session data including hasXPremium status
 * 
 * This hook provides:
 * - user: Current user object from session
 * - isLoading: Whether the session is still loading
 * - hasXPremium: Boolean indicating if user has premium Twitter/X features
 * - getCharacterLimit: Function that returns character limit based on premium status
 */
export function useUser() {
  const session = authClient.useSession()
  return {
    user: session.data?.user,
    isLoading: session.isPending,
    hasXPremium: session.data?.user?.hasXPremium || false,
    getCharacterLimit: () => (session.data?.user?.hasXPremium ? 25000 : 280),
  }
}
