'use client'

import { PropsWithChildren } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { LeftSidebar } from '@/components/context-sidebar'
import { AppSidebarInset } from '@/components/providers/app-sidebar-inset'
import { DashboardProviders } from '@/components/providers/dashboard-providers'
import { SidebarProvider } from '@/components/ui/sidebar'
import { MultiSidebarProvider, Sidebar } from '@/components/ui/multi-sidebar-provider'
import { LexicalComposer } from '@lexical/react/LexicalComposer'

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
      <MultiSidebarProvider 
        defaultLeftOpen={false}
        defaultRightOpen={defaultOpen}
      >
        <div className="flex">
          <Sidebar side="left" className="w-fit">
            <LeftSidebar />
          </Sidebar>

          <Sidebar side="right" variant="sidebar">
            {hideAppSidebar ? (
              <AppSidebarInset>{children}</AppSidebarInset>
            ) : (
              <LexicalComposer initialConfig={initialConfig}>
                <AppSidebar>
                  <AppSidebarInset>{children}</AppSidebarInset>
                </AppSidebar>
              </LexicalComposer>
            )}
          </Sidebar>
        </div>
      </MultiSidebarProvider>
    </DashboardProviders>
  )
}
