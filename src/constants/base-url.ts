export const getBaseUrl = () => {
  if (typeof window !== 'undefined') return window.location.origin
  // Prefer explicitly configured public site URL to avoid ephemeral Vercel URLs breaking OAuth callbacks
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:3000`
}
