'use client'

import { SidebarInset } from '../ui/sidebar'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Menu } from 'lucide-react'
import DuolingoButton from '../ui/duolingo-button'
import { useIsMobile } from '@/hooks/use-mobile'
import { useState } from 'react'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '../ui/dropdown-menu'
import { useRouter, usePathname } from 'next/navigation'
import { 
  Home, 
  Database, 
  Calendar, 
  FileText, 
  Users, 
  Settings 
} from 'lucide-react'

// Mobile Navigation Menu Component
function MobileNavigationMenu() {
  const router = useRouter()
  const pathname = usePathname()
  
  const navigationItems = [
    {
      icon: Home,
      label: 'Studio',
      href: '/studio',
      active: pathname === '/studio'
    },
    {
      icon: Database,
      label: 'Knowledge',
      href: '/studio/knowledge',
      active: pathname.startsWith('/studio/knowledge')
    },
    {
      icon: Calendar,
      label: 'Scheduled',
      href: '/studio/scheduled',
      active: pathname === '/studio/scheduled'
    },
    {
      icon: FileText,
      label: 'Posted',
      href: '/studio/posted',
      active: pathname === '/studio/posted'
    },
    {
      icon: Users,
      label: 'Accounts',
      href: '/studio/accounts',
      active: pathname === '/studio/accounts'
    },
    {
      icon: Settings,
      label: 'Settings',
      href: '/studio/settings',
      active: pathname === '/studio/settings'
    }
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DuolingoButton
          variant="secondary"
          size="icon"
          className="h-10 w-10"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </DuolingoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="start" 
        className="w-56 bg-white border border-neutral-200 shadow-lg"
      >
        {navigationItems.map((item) => {
          const IconComponent = item.icon
          return (
            <DropdownMenuItem
              key={item.href}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-neutral-50 ${
                item.active ? 'bg-neutral-100' : ''
              }`}
              onClick={() => router.push(item.href)}
            >
              <IconComponent className="h-4 w-4" />
              <span className="font-medium">{item.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebarInset({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()

  return (
    <SidebarInset className="w-full flex-1 overflow-x-hidden bg-neutral-100 border border-neutral-200">
      {/* Dot Pattern Background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 10px rgba(0, 0, 0, 0.03)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle, hsl(var(--neutral-300)) 1.5px, transparent 1.5px)`,
            backgroundSize: '20px 20px',
            opacity: 0.5,
          }}
        />
      </div>

      <header className="relative z-10 flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 justify-between">
        <div className="flex w-full justify-between items-center gap-2 px-4">
          {/* Mobile Navigation Menu - Only show on mobile */}
          {isMobile && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <MobileNavigationMenu />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-neutral-800 text-white">
                  Navigation Menu
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          

        </div>
      </header>
      {children}
    </SidebarInset>
  )
}
