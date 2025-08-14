'use client'

import { SidebarInset } from '../ui/multi-sidebar-provider'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArrowLeftFromLine, ArrowRightFromLine, PanelLeft, Menu } from 'lucide-react'
import DuolingoButton from '../ui/duolingo-button'
import { useMultiSidebar, SidebarTrigger } from '../ui/multi-sidebar-provider'
import { useIsMobile } from '@/hooks/use-mobile'

export function AppSidebarInset({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  
  // Access both sidebars from multi-sidebar context
  const { leftSidebar, rightSidebar } = useMultiSidebar()
  const { state, toggleSidebar } = rightSidebar
  const isCollapsed = state === 'collapsed'

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
          {/* Left side - Mobile navigation trigger for left sidebar */}
          <div className="flex items-center gap-2">
            {isMobile && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger 
                      side="left"
                      className="group/toggle-button h-8 w-8"
                    >
                      <Menu className="h-4 w-4" />
                    </SidebarTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-neutral-800 text-white">
                    Open Navigation
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          
          {/* Right side - Right sidebar toggle (chat/AI sidebar) */}
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DuolingoButton
                    variant="secondary"
                    size="icon"
                    onClick={toggleSidebar}
                    className="group/toggle-button"
                  >
                    <PanelLeft className="h-4 w-4 transition-all duration-200 group-hover/toggle-button:opacity-0 group-hover/toggle-button:scale-75" />
                    <div className="absolute transition-all duration-200 opacity-0 scale-75 group-hover/toggle-button:opacity-100 group-hover/toggle-button:scale-100">
                      {isCollapsed ? (
                        <ArrowLeftFromLine className="h-4 w-4" />
                      ) : (
                        <ArrowRightFromLine className="h-4 w-4" />
                      )}
                    </div>
                  </DuolingoButton>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-neutral-800 text-white ">
                  Toggle Sidebar
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </header>
      {children}
    </SidebarInset>
  )
}
