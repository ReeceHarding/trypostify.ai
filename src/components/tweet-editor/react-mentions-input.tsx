'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface ReactMentionsInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  onPaste?: (event: React.ClipboardEvent<Element>) => void
}

const ReactMentionsInput = React.forwardRef<any, ReactMentionsInputProps>(({
  value,
  onChange,
  placeholder = "What's happening?",
  className,
  disabled = false,
  onPaste,
}, ref) => {
  const safeValue = value ?? ''

  return (
    <div className={cn('w-full', className)}>
      <textarea
        ref={ref}
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onPaste={onPaste}
        className="w-full min-h-16 resize-none text-base leading-relaxed text-neutral-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
      />
    </div>
  )
})

ReactMentionsInput.displayName = 'ReactMentionsInput'

export default ReactMentionsInput
