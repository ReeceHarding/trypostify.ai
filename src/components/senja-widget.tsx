'use client'

import { cn } from '@/lib/utils'
import { useEffect } from 'react'

export const SenjaWidget = ({ className }: { className?: string }) => {
  useEffect(() => {
    const script = document.createElement('script')
    script.src =
      'https://widget.senja.io/widget/01600cf0-5fa6-455a-9364-d3f7bf7b7ef9/platform.js'
    script.async = true
    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  return (
    <div
      data-id="01600cf0-5fa6-455a-9364-d3f7bf7b7ef9"
      data-mode="shadow"
      data-lazyload="false"
      className={cn('senja-embed block w-full', className)}
    />
  )
}
