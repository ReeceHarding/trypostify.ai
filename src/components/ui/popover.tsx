"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { useIsMobile } from "@/hooks/use-mobile"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const isMobile = useIsMobile()
  
  // Add diagnostic logging for popover positioning
  React.useEffect(() => {
    console.log('[PopoverContent] Popover content mounted with responsive behavior:', {
      isMobile,
      align: isMobile ? 'center' : align,
      sideOffset: isMobile ? 0 : sideOffset,
      positioning: isMobile ? 'centered modal' : 'relative to trigger',
      avoidCollisions: !isMobile,
      updatePositionStrategy: isMobile ? 'optimized' : 'always',
      timestamp: new Date().toISOString()
    })
  }, [align, sideOffset, isMobile])

  if (isMobile) {
    // Mobile: Use centered modal approach
    return (
      <PopoverPrimitive.Portal>
        <>
          {/* Mobile backdrop overlay */}
          <div className="fixed inset-0 z-40 bg-neutral-950/50 backdrop-blur-[1px]" />
          <PopoverPrimitive.Content
            data-slot="popover-content"
            side="bottom"
            align="center"
            sideOffset={0}
            /* On mobile, disable collision avoidance and use fixed centering */
            avoidCollisions={false}
            updatePositionStrategy="optimized"
            ref={(element) => {
              if (element) {
                console.log('[PopoverContent] Mobile centered modal positioned:', {
                  elementRect: element.getBoundingClientRect(),
                  elementStyles: window.getComputedStyle(element),
                  childrenCount: element.children.length,
                  firstChildRect: element.children[0]?.getBoundingClientRect(),
                  isMobile: true,
                  positioning: 'centered modal',
                  timestamp: new Date().toISOString()
                })
              }
            }}
            className={cn(
              // Mobile: Fixed center positioning with full backdrop and proper content display
              // Override any positioning classes from parent components for mobile
              "!fixed !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !z-50 !w-[calc(100vw-2rem)] !max-w-[28rem] !max-h-[calc(100vh-4rem)] !bg-popover !text-popover-foreground !rounded-md !border !shadow-lg !outline-hidden !flex !flex-col !p-0",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              // Don't apply the className prop on mobile to avoid conflicts
              isMobile ? "" : className
            )}
            {...props}
          >
            {/* Ensure children render properly in mobile modal */}
            <div className="w-full h-full flex flex-col min-h-0">
              {props.children}
            </div>
          </PopoverPrimitive.Content>
        </>
      </PopoverPrimitive.Portal>
    )
  }

  // Desktop: Use relative positioning to trigger
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        /* Desktop: Ensure the popover continually repositions as its content height changes
           (e.g., when the calendar/time list renders), preventing it from being
           pushed off-screen on smaller viewports. */
        updatePositionStrategy="always"
        avoidCollisions
        collisionPadding={{ top: 16, bottom: 16, left: 8, right: 8 }}
        ref={(element) => {
          if (element) {
            console.log('[PopoverContent] Desktop relative positioning applied:', {
              elementRect: element.getBoundingClientRect(),
              isMobile: false,
              positioning: 'relative to trigger',
              timestamp: new Date().toISOString()
            })
          }
        }}
        className={cn(
          // Desktop: Relative positioning with backdrop pseudo-element
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 max-w-[min(100dvw-1rem,28rem)] max-h-[min(90dvh,calc(100dvh-4rem))] origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden before:fixed before:inset-0 before:z-[-1] before:bg-neutral-950/50 before:backdrop-blur-[1px]",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
