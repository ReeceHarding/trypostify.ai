'use client'

import { PropsWithChildren } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { LeftSidebar } from '@/components/context-sidebar'
import { AppSidebarInset } from '@/components/providers/app-sidebar-inset'
import { DashboardProviders } from '@/components/providers/dashboard-providers'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useIsMobile } from '@/hooks/use-mobile'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LayoutProps extends PropsWithChildren {
  hideAppSidebar?: boolean
  width: any
  state: any
}

const initialConfig = {
  namespace: 'chat-input',
  theme: {
    text: {
      bold: 'font-bold',
      italic: 'italic',
      underline: 'underline',
    },
  },
  onError: (error: Error) => {
    console.error('[Chat Editor Error]', error)
  },
  nodes: [],
}

// Mobile Header Component
function MobileHeader() {
  const isMobile = useIsMobile()
  
  if (!isMobile) return null

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:hidden">
      <SidebarTrigger>
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle Navigation</span>
      </SidebarTrigger>
      <div className="flex-1">
        <h1 className="text-lg font-semibold">Postify</h1>
      </div>
    </header>
  )
}

export default function ClientLayout({
  children,
  width,
  state,
  hideAppSidebar,
}: LayoutProps) {
  let defaultOpen = true

  if (state) {
    defaultOpen = state && state.value === 'true'
  }

  return (
    <DashboardProviders>
      <div className="flex">
        <SidebarProvider className="w-fit" defaultOpen={false}>
          <LeftSidebar />
          <div className="flex flex-1 flex-col">
            <MobileHeader />
            <div className="flex flex-1">
              <SidebarProvider defaultOpen={defaultOpen} defaultWidth={width?.value || '32rem'}>
                {hideAppSidebar ? (
                  <AppSidebarInset>{children}</AppSidebarInset>
                ) : (
                  <LexicalComposer initialConfig={initialConfig}>
                    <AppSidebar>
                      <AppSidebarInset>{children}</AppSidebarInset>
                    </AppSidebar>
                  </LexicalComposer>
                )}
              </SidebarProvider>
            </div>
          </div>
        </SidebarProvider>
      </div>
    </DashboardProviders>
  )
}
