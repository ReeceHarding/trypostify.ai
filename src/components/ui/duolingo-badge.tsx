"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface DuolingoBadgeProps {
  children: ReactNode
  variant?: "achievement" | "streak" | "level" | "xp" | "notification" | "gray" | "green" | "amber"
  size?: "sm" | "md" | "lg"
  className?: string
}

export default function DuolingoBadge({
  children,
  variant = "achievement",
  size = "md",
  className,
}: DuolingoBadgeProps) {
  const baseStyles =
    "font-semibold inline-flex items-center justify-center relative"

  const variantStyles = {
    achievement:
      "bg-gradient-to-b from-primary to-primary text-white border-2 border-primary shadow-[0_2px_0_hsl(var(--primary)),0_4px_6px_-1px_hsl(var(--primary)/0.3)]",
    streak:
      "bg-gradient-to-b from-warning-500 to-warning-600 text-white border-2 border-warning-500 shadow-[0_2px_0_hsl(var(--warning-600)),0_4px_6px_-1px_hsl(var(--warning-500)/0.3)]",
    level:
      "bg-gradient-to-b from-success-500 to-success-600 text-white border-2 border-success-500 shadow-[0_2px_0_hsl(var(--success-600)),0_4px_6px_-1px_hsl(var(--success-500)/0.3)]",
    xp: "bg-gradient-to-b from-primary to-primary text-white border-2 border-primary shadow-[0_2px_0_hsl(var(--primary)),0_4px_6px_-1px_hsl(var(--primary)/0.3)]",
    notification:
      "bg-gradient-to-b from-error-500 to-error-600 text-white border-2 border-error-500 shadow-[0_2px_0_hsl(var(--error-600)),0_4px_6px_-1px_hsl(var(--error-500)/0.3)]",
    gray:
      "bg-gradient-to-b from-neutral-400 to-neutral-500 text-white border-2 border-neutral-300 shadow-[0_2px_0_hsl(var(--neutral-600)),0_4px_6px_-1px_hsl(var(--neutral-500)/0.3)]",
    green:
      "bg-gradient-to-b from-success-500 to-success-600 text-white border-2 border-success-500 shadow-[0_2px_0_hsl(var(--success-600)),0_4px_6px_-1px_hsl(var(--success-500)/0.3)]",
    amber:
      "bg-gradient-to-b from-warning-500 to-warning-600 text-white border-2 border-warning-500 shadow-[0_2px_0_hsl(var(--warning-600)),0_4px_6px_-1px_hsl(var(--warning-500)/0.3)]",
  }

  const sizeStyles = {
    sm: "text-xs h-5 min-w-5 px-1 rounded-full",
    md: "text-sm h-7 min-w-7 px-1.5 rounded-full",
    lg: "text-base h-9 min-w-9 px-2 rounded-full",
  }

  return (
    <span
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  )
}
