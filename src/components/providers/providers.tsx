'use client'

import { ConfettiProvider } from '@/hooks/use-confetti'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import { ReactNode, useState } from 'react'
import toast from 'react-hot-toast'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError(error, query) {
            if (error instanceof HTTPException) {
              // Skip 401 redirects in development when SKIP_AUTH is enabled
              const shouldSkipAuth = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
              
              if (error.status === 401 && window.location.pathname !== '/login' && !shouldSkipAuth) {
                window.location.href = '/login'
              } else if (error.status !== 401 || !shouldSkipAuth) {
                toast.error(error.message)
              }
            }
          },
        }),
        defaultOptions: {
          queries: {
            retry(_, error) {
              if (error instanceof HTTPException) {
                if (error.status === 401) {
                  return false
                }
              }

              return true
            },
          },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
