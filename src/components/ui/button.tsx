import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center focus:ring-2 focus:ring-offset-2 gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-stone-600 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary-700 text-primary-foreground shadow-xs hover:bg-primary-800",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-dashed bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Duolingo-style variants with 3D pressed effect
        "duolingo-primary":
          "bg-primary text-white border bg-clip-padding border-b-2 border-primary hover:bg-primary/90 shadow-[0_3px_0_hsl(var(--primary))] active:translate-y-0.5 active:shadow-none focus:ring-primary",
        "duolingo-secondary":
          "bg-white border bg-clip-padding text-neutral-700 border-b-2 border-neutral-300 hover:bg-neutral-50 shadow-[0_3px_0_hsl(var(--neutral-300))] active:translate-y-0.5 active:shadow-none focus:ring-neutral-300",
        "duolingo-destructive":
          "bg-error-500 text-white border-b-2 border-error-600 hover:bg-error-600 shadow-[0_3px_0_hsl(var(--error-600))] active:translate-y-0.5 active:shadow-none focus:ring-error-500",
        "duolingo-dashedOutline":
          "bg-white text-neutral-600 border-2 bg-clip-padding border-dashed border-neutral-300 border-b-[4px] hover:bg-neutral-50 focus:ring-neutral-400 active:translate-y-0.5 active:shadow-none",
        "duolingo-emerald":
          "bg-success-600 text-white border bg-clip-padding border-b-2 border-success-700 hover:bg-success-500 shadow-[0_3px_0_hsl(var(--success-700))] active:translate-y-0.5 active:shadow-none focus:ring-success-600",
        "duolingo-disabled":
          "bg-neutral-200 text-neutral-400 border-b-2 border-neutral-300 cursor-not-allowed shadow-[0_3px_0_hsl(var(--neutral-300))]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        // Duolingo sizes
        "duolingo-sm": "text-sm py-2 px-4",
        "duolingo-md": "text-base py-3 px-6",
        "duolingo-lg": "text-lg py-4 px-8",
        "duolingo-icon": "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Loading spinner component
function LoadingSpinner({ variant }: { variant?: string }) {
  const spinnerColor =
    variant === 'duolingo-secondary' || variant === 'duolingo-dashedOutline'
      ? 'text-neutral-300'
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

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  // If loading, override variant to disabled for Duolingo styles
  const effectiveVariant = loading && variant?.startsWith('duolingo-') ? 'duolingo-disabled' : variant

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant: effectiveVariant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="flex items-center justify-center">
          <LoadingSpinner variant={variant} />
          {size !== 'icon' && size !== 'duolingo-icon' && <span className="ml-2 opacity-80">Loading...</span>}
        </div>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants, LoadingSpinner }
