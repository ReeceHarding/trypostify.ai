'use client'

import { buttonVariants } from '@/components/ui/button'
import { useChatContext } from '@/hooks/use-chat'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { ArrowLeftFromLine, ArrowRightFromLine, PanelLeft, Settings, Crown } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSerializer, parseAsString } from 'nuqs'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { useEffect } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { useHotkeyFeedback } from './ui/hotkey-feedback'
import { useBackgroundProcessStore } from '@/stores/background-process-store'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Loader2, Video, Clock } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  useSidebar,
} from './ui/sidebar'
import { Icons } from './icons'

const searchParams = {
  tweetId: parseAsString,
  chatId: parseAsString,
}

const serialize = createSerializer(searchParams)

export const LeftSidebar = () => {
  const { state } = useSidebar()
  const { data } = authClient.useSession()

  const pathname = usePathname()

  const { id } = useChatContext()

  const isCollapsed = state === 'collapsed'

  const { toggleSidebar } = useSidebar()
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'
  
  const router = useRouter()
  
  // Global hotkey feedback
  const { showNavigation } = useHotkeyFeedback()

  // Use the same store as the other indicators for consistency
  const { getActiveProcesses } = useBackgroundProcessStore()
  const activeProcesses = getActiveProcesses()
  const hasActiveProcesses = activeProcesses.length > 0

  console.log('[LeftSidebar] Notification bell status:', {
    activeProcessCount: activeProcesses.length,
    hasActiveProcesses,
    processes: activeProcesses.map(p => ({
      id: p.id.substring(0, 8),
      type: p.type,
      age: Math.round((Date.now() - p.startedAt) / 1000) + 's'
    }))
  })

  // Fetch real backend status for notification popover (same logic as BackgroundProcessIndicator)
  const { data: activeJobs } = useQuery({
    queryKey: ['notification-active-jobs'],
    queryFn: async () => {
      try {
        console.log('[LeftSidebar] Fetching backend status for notification bell')
        // Check for processing jobs
        const processingRes = await client.videoJob.listVideoJobs.mutate({ 
          status: 'processing' as const, 
          limit: 50, 
          offset: 0 
        })
        
        // Check for pending jobs  
        const pendingRes = await client.videoJob.listVideoJobs.mutate({ 
          status: 'pending' as const, 
          limit: 50, 
          offset: 0 
        })
        
        const allActiveJobs = [...(processingRes.jobs || []), ...(pendingRes.jobs || [])]
        
        console.log('[LeftSidebar] Backend status for notification:', {
          processingJobs: processingRes.jobs?.length || 0,
          pendingJobs: pendingRes.jobs?.length || 0,
          totalActiveJobs: allActiveJobs.length,
          jobs: allActiveJobs.map(j => ({
            id: j.id?.substring(0, 8),
            status: j.status,
            platform: j.platform,
            createdAt: j.createdAt
          }))
        })
        
        return allActiveJobs
      } catch (error) {
        console.error('[LeftSidebar] Error fetching backend status:', error)
        return []
      }
    },
    refetchInterval: hasActiveProcesses ? 3000 : false, // Only refetch when there are active processes
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: hasActiveProcesses, // Only run query when there are active processes
  })

  // Get process info for popover display
  const getProcessInfo = () => {
    const backendJobCount = activeJobs?.length || 0
    const totalCount = Math.max(activeProcesses.length, backendJobCount)
    
    if (totalCount > 0) {
      return {
        icon: <Video className="w-4 h-4" />,
        text: totalCount === 1 ? 'Processing video' : `Processing ${totalCount} videos`,
        description: 'Videos will be posted automatically when ready',
        count: totalCount
      }
    }

    return {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      text: 'Background processing',
      description: 'Operations running in background',
      count: 0
    }
  }

  // Log component mount
  useEffect(() => {
    console.log('[LeftSidebar] Component mounted at', new Date().toISOString())
    console.log('[LeftSidebar] State:', { state, isCollapsed, isMac, metaKey })
    return () => {
      console.log('[LeftSidebar] Component unmounting at', new Date().toISOString())
    }
  }, [])

  // Keyboard shortcuts for navigation and custom event listener for right sidebar toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

      // Navigation shortcuts: Cmd/Ctrl + 1-5 (cross-platform safe, avoids all browser conflicts)
      if (actualMetaKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        e.stopPropagation() // Prevent other listeners from handling this event
        console.log(`[LeftSidebar] Navigation shortcut detected: ${metaKey}+${e.key} at ${new Date().toISOString()}`)
        
        const paths = [
          '/studio',
          '/studio/knowledge',
          '/studio/scheduled',
          '/studio/posted',
          '/studio/accounts',
        ]
        const pathNames = [
          'Studio',
          'Knowledge Base',
          'Schedule',
          'Posted',
          'Accounts',
        ]
        const index = parseInt(e.key) - 1
        if (paths[index]) {
          console.log(`[LeftSidebar] Navigation shortcut triggered: ${pathNames[index]} (${metaKey}+${e.key}) at ${new Date().toISOString()}`)
          
          // Immediate visual feedback
          showNavigation(pathNames[index])
          
          const searchString = id ? serialize({ chatId: id }) : ''
          const url = searchString ? `${paths[index]}?${searchString}` : paths[index]
          
          // Use Promise.resolve to ensure immediate UI update
          Promise.resolve().then(() => {
            router.push(url)
          })
        }
      }
      // Toggle left sidebar: Cmd/Ctrl + \
      else if (actualMetaKey && e.key === '\\') {
        e.preventDefault()
        e.stopPropagation() // Prevent other listeners from handling this event
        console.log(`[LeftSidebar] Toggle sidebar shortcut triggered (${metaKey}+\\) at ${new Date().toISOString()}`)
        toggleSidebar()
      }
    }

    // Custom event listener for toggle from right sidebar
    const handleToggleFromRightSidebar = () => {
      console.log('[LeftSidebar] Received toggle event from right sidebar at', new Date().toISOString())
      toggleSidebar()
    }

    // Use capture phase to ensure we get events before other listeners
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('toggleLeftSidebar', handleToggleFromRightSidebar)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('toggleLeftSidebar', handleToggleFromRightSidebar)
    }
  }, [isMac, router, id, toggleSidebar, showNavigation])

  return (
    <Sidebar collapsible="icon" side="left" className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40 p-4">
        <div className="flex items-center justify-start gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="h-8 w-8 rounded-md hover:bg-accent/50 transition-colors flex items-center justify-center group/toggle-button flex-shrink-0"
                >
                  <PanelLeft className="h-4 w-4 transition-all duration-200 group-hover/toggle-button:opacity-0 group-hover/toggle-button:scale-75" />
                  <div className="absolute transition-all duration-200 opacity-0 scale-75 group-hover/toggle-button:opacity-100 group-hover/toggle-button:scale-100">
                    {isCollapsed ? (
                      <ArrowRightFromLine className="h-4 w-4" />
                    ) : (
                      <ArrowLeftFromLine className="h-4 w-4" />
                    )}
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="space-y-1">
                  <p>Toggle navigation</p>
                  <p className="text-xs text-neutral-400">{metaKey} + \</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div
            className={cn(
              'flex items-center gap-1 transition-all duration-200 ease-out',
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
            )}
          >
            {/* <Icons.logo className="size-4" /> */}
            <p className={cn('text-sm/6 text-neutral-800 ')}>Postify</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Create Group */}
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              'transition-all duration-200 ease-out px-3',
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
            )}
          >
            Create
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={{
                      pathname: '/studio',
                      search: serialize({ chatId: id }),
                    }}
                    className={cn(
                      buttonVariants({
                        variant: 'ghost',
                        className: 'w-full justify-start gap-2 px-3 py-2',
                      }),
                      pathname === '/studio' &&
                        'bg-neutral-200 hover:bg-neutral-200 text-accent-foreground',
                    )}
                  >
                    <div className="size-6 flex items-center justify-center flex-shrink-0">
                      <span aria-hidden="true" className="text-base">📝</span>
                    </div>
                    <span
                      className={cn(
                        'transition-all opacity-0 duration-200 ease-out delay-200',
                        isCollapsed ? 'opacity-0 w-0 overflow-hidden hidden' : 'opacity-100',
                      )}
                    >
                      Studio
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="space-y-1">
                    <p>Studio</p>
                    <p className="text-xs text-neutral-400">{metaKey} + 1</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Content Group */}
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              'transition-all duration-200 ease-out px-3',
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
            )}
          >
            Manage
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-col gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={{
                        pathname: '/studio/knowledge',
                        search: serialize({ chatId: id }),
                      }}
                      className={cn(
                        buttonVariants({
                          variant: 'ghost',
                          className: 'justify-start gap-2 px-3 py-2',
                        }),
                        pathname.includes('/studio/knowledge') &&
                          'bg-neutral-200 hover:bg-neutral-200 text-accent-foreground',
                      )}
                    >
                      <div className="size-6 flex items-center justify-center flex-shrink-0">
                        <span aria-hidden="true" className="text-base">🧠</span>
                      </div>
                      <span
                        className={cn(
                          'transition-all duration-200 ease-out',
                          isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                        )}
                      >
                        Knowledge Base
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                                      <div className="space-y-1">
                    <p>Knowledge Base</p>
                    <p className="text-xs text-neutral-400">{metaKey} + 2</p>
                  </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={{
                        pathname: '/studio/scheduled',
                        search: serialize({ chatId: id }),
                      }}
                      className={cn(
                        buttonVariants({
                          variant: 'ghost',
                          className: 'justify-start gap-2 px-3 py-2',
                        }),
                        pathname === '/studio/scheduled' &&
                          'bg-neutral-200 hover:bg-neutral-200 text-accent-foreground',
                      )}
                    >
                      <div className="size-6 flex items-center justify-center flex-shrink-0 relative">
                        <span aria-hidden="true" className="text-base">🗓️</span>
                        {hasActiveProcesses && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className="absolute -top-1 -right-1 size-3 bg-primary rounded-full flex items-center justify-center animate-pulse hover:bg-primary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                                aria-label="View background processes"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  console.log('[LeftSidebar] Notification bell clicked at', new Date().toISOString())
                                }}
                              >
                                <span className="text-[8px]">🔔</span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent 
                              side="right" 
                              align="start" 
                              sideOffset={8}
                              className="w-80 p-0 max-h-96 overflow-y-auto"
                              onOpenAutoFocus={(e) => e.preventDefault()}
                            >
                              <div className="p-4">
                                <div className="flex items-start gap-3 mb-4">
                                  <div className="text-primary animate-pulse flex-shrink-0">
                                    {getProcessInfo().icon}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-neutral-900 text-sm">
                                      {getProcessInfo().text}
                                    </div>
                                    <div className="text-xs text-neutral-600 mt-1">
                                      {getProcessInfo().description}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Show active jobs if any */}
                                {activeJobs && activeJobs.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="text-xs font-medium text-neutral-700 mb-2">
                                      Active Jobs:
                                    </div>
                                    {activeJobs.slice(0, 5).map((job, index) => (
                                      <div key={job.id || index} className="flex items-center gap-2 p-2 bg-neutral-50 rounded-md">
                                        <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-medium text-neutral-800 truncate">
                                            {job.platform} Video
                                          </div>
                                          <div className="text-xs text-neutral-600">
                                            Status: {job.status}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {activeJobs.length > 5 && (
                                      <div className="text-xs text-neutral-500 text-center py-1">
                                        +{activeJobs.length - 5} more jobs
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Show local processes if any */}
                                {activeProcesses.length > 0 && (
                                  <div className="space-y-2 mt-4">
                                    <div className="text-xs font-medium text-neutral-700 mb-2">
                                      Local Processes:
                                    </div>
                                    {activeProcesses.map((process) => (
                                      <div key={process.id} className="flex items-center gap-2 p-2 bg-neutral-50 rounded-md">
                                        <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-medium text-neutral-800 truncate">
                                            {process.description}
                                          </div>
                                          <div className="text-xs text-neutral-600">
                                            {Math.round((Date.now() - process.startedAt) / 1000)}s ago
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center gap-1 mt-4 pt-3 border-t border-neutral-200 text-xs text-neutral-500">
                                  <Clock className="w-3 h-3" />
                                  Updates every 3 seconds
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                      <span
                        className={cn(
                          'transition-all duration-200 ease-out',
                          isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                        )}
                      >
                        Schedule
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                                      <div className="space-y-1">
                    <p>Schedule</p>
                    <p className="text-xs text-neutral-400">{metaKey} + 3</p>
                  </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={{
                        pathname: '/studio/posted',
                        search: serialize({ chatId: id }),
                      }}
                      className={cn(
                        buttonVariants({
                          variant: 'ghost',
                          className: 'justify-start gap-2 px-3 py-2',
                        }),
                        pathname === '/studio/posted' &&
                          'bg-neutral-200 hover:bg-neutral-200 text-accent-foreground',
                      )}
                    >
                      <div className="size-6 flex items-center justify-center flex-shrink-0">
                        <span aria-hidden="true" className="text-base">📤</span>
                      </div>
                      <span
                        className={cn(
                          'transition-all duration-200 ease-out',
                          isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                        )}
                      >
                        Posted
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                                      <div className="space-y-1">
                    <p>Posted</p>
                    <p className="text-xs text-neutral-400">{metaKey} + 4</p>
                  </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Account Group */}
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              'transition-all duration-200 ease-out px-3',
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
            )}
          >
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={{
                      pathname: '/studio/accounts',
                      search: serialize({ chatId: id }),
                    }}
                    className={cn(
                      buttonVariants({
                        variant: 'ghost',
                        className: 'w-full justify-start gap-2 px-3 py-2',
                      }),
                      pathname.includes('/studio/accounts') &&
                        'bg-neutral-200 hover:bg-neutral-200 text-accent-foreground',
                    )}
                  >
                    <div className="size-6 flex items-center justify-center flex-shrink-0">
                      <span aria-hidden="true" className="text-base">👤</span>
                    </div>
                    <span
                      className={cn(
                        'transition-all duration-200 ease-out',
                        isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                      )}
                    >
                      Accounts
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="space-y-1">
                    <p>Accounts</p>
                    <p className="text-xs text-neutral-400">{metaKey} + 5</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40 p-4">
        <div
          className={cn(
            'transition-all duration-200 ease-out overflow-hidden',
            isCollapsed ? 'opacity-0 max-h-0' : 'opacity-100 max-h-[1000px]',
          )}
        >
          <div className="flex flex-col gap-2">
            {data?.user ? (
              <Link
                href={{
                  pathname: `/studio/settings`,
                  search: id ? `?chatId=${id}` : undefined,
                }}
                className={cn(
                  buttonVariants({
                    variant: 'outline',
                    className: 'flex items-center gap-2 justify-start px-3 py-2',
                  }),
                  'h-16',
                )}
              >
                <Avatar className="size-9 border-2 border-white shadow-md">
                  <AvatarImage
                    src={data.user.image || undefined}
                    alt={data.user.name ?? 'Profile'}
                  />
                  <AvatarFallback>{data.user.name?.charAt(0) ?? null}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start min-w-0">
                  <span className="truncate text-sm font-medium text-neutral-800">
                    {data.user.name ?? 'Account'}
                  </span>

                  <span className="truncate text-xs text-muted-foreground flex items-center gap-1">
                    <Crown className="size-3" />
                    Pro
                  </span>
                </div>
              </Link>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'transition-all duration-0 ease-out overflow-hidden',
            isCollapsed ? 'opacity-100 max-h-[1000px]' : 'opacity-0 max-h-0',
          )}
        >
          <div className="flex flex-col gap-2">
            <Link
              href={{
                pathname: `/studio/settings`,
                search: id ? `?chatId=${id}` : undefined,
              }}
              className={buttonVariants({
                variant: 'ghost',
                className: 'text-muted-foreground hover:text-foreground',
              })}
            >
              <Settings className="size-5" />
            </Link>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
