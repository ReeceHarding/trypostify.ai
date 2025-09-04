'use client'

import { SidebarInset } from '../ui/sidebar'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Menu, PanelRight, ArrowRightFromLine, ArrowLeftFromLine } from 'lucide-react'
import { Button } from '../ui/button'
import { useSidebar } from '../ui/sidebar'
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
import { Icons } from '../icons'
import Link from 'next/link'

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
        <Button
          variant="duolingo-secondary"
          size="duolingo-icon"
          className="h-10 w-10"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
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
  
  // Function to toggle the right sidebar via custom event
  const toggleRightSidebar = () => {
    console.log('[AppSidebarInset] Toggling right sidebar via custom event at', new Date().toISOString())
    // Dispatch a custom event that the right sidebar can listen to
    window.dispatchEvent(new CustomEvent('toggleRightSidebar'))
  }
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'

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
          
          {/* Postify Logo - Always show in center */}
          <div className="flex-1 flex justify-center">
            <Link 
              href="/studio" 
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Icons.logo className="size-6" />
              <span className="font-semibold text-lg text-neutral-800">Postify</span>
            </Link>
          </div>
          
          {/* Spacer for desktop when no mobile menu */}
          {!isMobile && <div />}
          
          {/* Right Sidebar Toggle Button - Always show on right side */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={toggleRightSidebar}
                  size="duolingo-icon"
                  variant="duolingo-secondary"
                  className="aspect-square group/toggle-button"
                >
                  <PanelRight className="size-4 transition-all duration-200 group-hover/toggle-button:opacity-0 group-hover/toggle-button:scale-75" />
                  <div className="absolute transition-all duration-200 opacity-0 scale-75 group-hover/toggle-button:opacity-100 group-hover/toggle-button:scale-100">
                    <ArrowRightFromLine className="size-4" />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="space-y-1">
                  <p>Toggle Assistant</p>
                  {!isMobile && <p className="text-xs text-neutral-400">{metaKey} + \</p>}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

        </div>
      </header>
      {children}
    </SidebarInset>
  )
}
