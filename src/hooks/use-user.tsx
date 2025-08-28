import { authClient } from '@/lib/auth-client'

// User hook to access user session data including hasXPremium
export function useUser() {
  const session = authClient.useSession()
  return {
    user: session.data?.user,
    isLoading: session.isPending,
    hasXPremium: session.data?.user?.hasXPremium || false,
    getCharacterLimit: () => session.data?.user?.hasXPremium ? 25000 : 280,
  }
}
