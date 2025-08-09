import { cn } from "@/lib/utils"
import { LucideIcon } from "lucide-react"
import { ReactNode } from "react"

interface SettingsSectionProps {
  children: ReactNode
  className?: string
  icon?: LucideIcon
  title: string
}

export function SettingsSection({ children, className, icon: Icon, title }: SettingsSectionProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-neutral-500" />}
        <h3 className="text-lg font-medium text-neutral-900">{title}</h3>
      </div>
      {children}
    </div>
  )
} 