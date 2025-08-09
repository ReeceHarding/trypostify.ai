'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DuolingoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?:
    | 'primary'
    | 'secondary'
    | 'disabled'
    | 'icon'
    | 'destructive'
    | 'dashedOutline'
    | 'emerald'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  className?: string
  loading?: boolean
}

export const baseStyles =
  'font-semibold w-full rounded-lg relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center'

export const variantStyles = {
  primary:
    'bg-primary text-white border bg-clip-padding border-b-2 border-primary hover:bg-primary/90 shadow-[0_3px_0_hsl(var(--primary))] focus:ring-primary',
  secondary:
    'bg-white border bg-clip-padding text-neutral-700 border-b-2 border-neutral-300 hover:bg-neutral-50 shadow-[0_3px_0_hsl(var(--neutral-300))] focus:ring-neutral-300',
  disabled:
    'bg-neutral-200 text-neutral-400 border-b-2 border-neutral-300 cursor-not-allowed shadow-[0_3px_0_hsl(var(--neutral-300))]',
  icon: 'bg-primary text-white border-b-2 border-primary hover:bg-primary/90 shadow-[0_3px_0_hsl(var(--primary))] focus:ring-primary p-0 flex items-center justify-center',
  destructive:
    'bg-error-500 text-white border-b-2 border-error-600 hover:bg-error-600 shadow-[0_3px_0_hsl(var(--error-600))] focus:ring-error-500',
  dashedOutline:
    'bg-white text-neutral-600 border-2 bg-clip-padding border-dashed border-neutral-300 border-b-[4px] hover:bg-neutral-50 focus:ring-neutral-400',
  emerald:
    'bg-success-600 text-white border bg-clip-padding border-b-2 border-success-700 hover:bg-success-500 shadow-[0_3px_0_hsl(var(--success-700))] focus:ring-success-600',
}

export const sizeStyles = {
  sm: 'text-sm py-2 px-4',
  md: 'text-base py-3 px-6',
  lg: 'text-lg py-4 px-8',
  icon: 'h-10 w-10',
}

export default function DuolingoButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  loading = false,
  ...props
}: DuolingoButtonProps) {
  const variantStyle =
    disabled || loading ? variantStyles.disabled : variantStyles[variant]
  const sizeStyle = sizeStyles[size]

  return (
    <button
      className={cn(baseStyles, variantStyle, sizeStyle, className)}
      disabled={disabled || loading || variant === 'disabled'}
      {...props}
    >
      {loading ? (
        <div className="flex items-center justify-center">
          <LoadingSpinner variant={variant} />
          {size !== 'icon' && <span className="ml-2 opacity-80">Loading...</span>}
        </div>
      ) : (
        children
      )}
    </button>
  )
}

export function LoadingSpinner({ variant }: { variant: string }) {
  const spinnerColor =
    variant === 'secondary' || variant === 'dashedOutline'
      ? 'text-gray-300'
      : 'text-white'

  return (
    <svg
      className={`animate-spin h-5 w-5 ${spinnerColor}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  )
}
