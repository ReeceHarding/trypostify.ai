'use client'

import { buttonVariants } from '@/components/ui/button'
import { useChatContext } from '@/hooks/use-chat'
import { cn } from '@/lib/utils'
import { ArrowLeftFromLine, ArrowRightFromLine, PanelLeft, Settings, Crown, Bell, Video, Clock, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSerializer, parseAsString } from 'nuqs'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { useHotkeyFeedback } from './ui/hotkey-feedback'
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
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { authClient } from '@/lib/auth-client'
import { useUser } from '@/hooks/use-user'
import { UpgradeDrawer } from '@/components/upgrade-drawer'

const searchParams = {
  tweetId: parseAsString,
  chatId: parseAsString,
}

const serialize = createSerializer(searchParams)

export const LeftSidebar = () => {
  const { state } = useSidebar()
  const session = authClient.useSession()
  const { user, isLoading: isUserLoading } = useUser()

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

  // Use the same unified query as all other components - SINGLE SOURCE OF TRUTH
  const { data: activeJobs, isLoading: jobsLoading, error: jobsError } = useQuery({
    queryKey: ['active-video-jobs'], // Same key as other components for data sharing
    queryFn: async () => {
      console.log('[LeftSidebar] 🔍 Fetching active jobs from database...')
      try {
        // Check for processing jobs
        const processingRes = await client.videoJob.listVideoJobs.$post({ 
          status: 'processing' as const, 
          limit: 50, 
          offset: 0 
        })
        
        // Check for pending jobs  
        const pendingRes = await client.videoJob.listVideoJobs.$post({ 
          status: 'pending' as const, 
          limit: 50, 
          offset: 0 
        })
        
        const processingData = await processingRes.json()
        const pendingData = await pendingRes.json()
        
        const allActiveJobs = [...(processingData.jobs || []), ...(pendingData.jobs || [])]
        
        console.log('[LeftSidebar] ✅ Found', allActiveJobs.length, 'active jobs:', {
          processingJobs: processingData.jobs?.length || 0,
          pendingJobs: pendingData.jobs?.length || 0,
          jobs: allActiveJobs.map(j => ({
            id: j.id?.substring(0, 8),
            status: j.status,
            platform: j.platform,
            createdAt: j.createdAt
          }))
        })
        
        return allActiveJobs
      } catch (error) {
        console.error('[LeftSidebar] ❌ Error fetching jobs:', error)
        
        // If unauthorized, user is not logged in - return empty array silently
        if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))) {
          console.log('[LeftSidebar] 🔒 User not authenticated - skipping video job polling')
          return []
        }
        
        // For other errors, still return empty array to prevent crash
        return []
      }
    },
    refetchInterval: (query) => {
      // Don't poll if there was an auth error
      if (query.state.error && query.state.error.message?.includes('Unauthorized')) {
        console.log('[LeftSidebar] 🔒 Stopping polling due to auth error')
        return false
      }
      
      // Poll every 5 seconds if there are active jobs, otherwise stop polling
      const data = query.state.data
      return data && Array.isArray(data) && data.length > 0 ? 5000 : false
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: 'always', // Always fetch when component mounts
    refetchOnWindowFocus: true, // Fetch when user returns to tab
    retry: (failureCount, error) => {
      // Don't retry unauthorized errors
      if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))) {
        console.log('[LeftSidebar] 🔒 Not retrying unauthorized error')
        return false
      }
      // Retry other errors up to 3 times
      return failureCount < 3
    },
    enabled: true, // Always enabled - will show real database state
  })
  
  // Use database state only - no client-side optimistic updates
  const hasActiveProcesses = activeJobs && activeJobs.length > 0
  const totalActiveCount = activeJobs?.length || 0
  
  // Show loading state when checking database after page refresh
  const isCheckingDatabase = jobsLoading && !activeJobs
  
  // Transform active jobs for popover display
  const allProcesses = activeJobs?.map(job => ({
    id: job.id,
    type: 'video-processing' as const,
    description: `Processing video from ${job.platform || 'social media'}`,
    startedAt: new Date(job.createdAt || Date.now()).getTime(),
    isBackendJob: true,
    jobId: job.id,
    status: job.status
  })) || []

  console.log('[LeftSidebar] 🔔 Notification status:', {
    hasActiveProcesses,
    totalActiveCount,
    isCheckingDatabase,
    jobsFromDatabase: totalActiveCount
  })

  // State for notification popover
  const [notificationOpen, setNotificationOpen] = useState(false)

  // Notification status: ${hasActiveProcesses ? totalActiveCount + ' active' : 'none'}

  // Component lifecycle tracking
  useEffect(() => {
    // Component mounted - keyboard shortcuts initialized
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
          const pathName = pathNames[index]
          if (pathName) {
            showNavigation(pathName)
          }
          
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

  // Format time ago for processes
  const formatTimeAgo = (startedAt: number) => {
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  // Get process type icon
  const getProcessIcon = (type: string) => {
    switch (type) {
      case 'video-processing':
        return <Video className="w-4 h-4" />
      case 'posting':
        return <Settings className="w-4 h-4" />
      case 'queueing':
        return <Clock className="w-4 h-4" />
      default:
        return <Settings className="w-4 h-4" />
    }
  }

  // Backend jobs cannot be dismissed from frontend
  const handleDismissProcess = (processId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[LeftSidebar] Backend jobs cannot be dismissed from frontend:', processId)
  }

  // Notification Popover Component
  const NotificationPopover = () => (
    <Popover open={notificationOpen} onOpenChange={setNotificationOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-3 w-3 p-0 rounded-full relative bg-error-500 hover:bg-error-600 text-white shadow-lg border border-white text-[8px] font-bold flex items-center justify-center",
            hasActiveProcesses ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[LeftSidebar] Notification bell clicked at', new Date().toISOString())
            setNotificationOpen(!notificationOpen)
          }}
        >
          <span className="text-[8px] font-bold leading-none">
            {totalActiveCount > 9 ? '9+' : totalActiveCount}
          </span>
          <span className="sr-only">View active processes</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        side="right" 
        align="start" 
        sideOffset={12}
        className="w-80 max-h-96 overflow-y-auto"
      >
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Active Processes ({allProcesses.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {allProcesses.length === 0 ? (
              <p className="text-sm text-neutral-500">No active processes</p>
            ) : (
              allProcesses.map((process) => (
                <div
                  key={process.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-neutral-50 border border-neutral-200"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {getProcessIcon(process.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-neutral-900 capitalize">
                          {process.type.replace('-', ' ')}
                        </p>
                        <p className="text-xs text-neutral-600 mt-1">
                          {process.description}
                        </p>
                        <p className="text-xs text-neutral-500 mt-1">
                          Started {formatTimeAgo(process.startedAt)}
                        </p>
                      </div>
                      {/* Backend jobs cannot be dismissed from frontend */}
                    </div>
                  </div>
                </div>
              ))
            )}
            {allProcesses.length > 0 && (
              <div className="pt-2 border-t border-neutral-200">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setNotificationOpen(false)
                    const searchString = id ? serialize({ chatId: id }) : ''
                    const url = searchString ? `/studio/scheduled?${searchString}` : '/studio/scheduled'
                    router.push(url)
                  }}
                >
                  View All in Schedule
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  )

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
                          <div className="absolute -top-1 -right-1 z-10">
                            <NotificationPopover />
                          </div>
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
            {/* Upgrade button for free users */}
            {!isUserLoading && user?.plan !== 'pro' && (
              <div className="mb-2">
                <UpgradeDrawer />
              </div>
            )}
            
            {session.data?.user ? (
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
                    src={session.data.user.image || undefined}
                    alt={session.data.user.name ?? 'Profile'}
                  />
                  <AvatarFallback>{session.data.user.name?.charAt(0) ?? null}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start min-w-0">
                  <span className="truncate text-sm font-medium text-neutral-800">
                    {session.data.user.name ?? 'Account'}
                  </span>

                  <span className="truncate text-xs text-muted-foreground flex items-center gap-1">
                    <Crown className="size-3" />
                    {isUserLoading ? 'Loading...' : user?.plan === 'pro' ? 'Pro' : 'Free'}
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
