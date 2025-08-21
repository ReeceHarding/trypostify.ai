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
  
  return (
    <PopoverPrimitive.Portal>
      {/* Backdrop - only show on mobile */}
      {isMobile && <div className="fixed inset-0 z-40 bg-neutral-950/50 backdrop-blur-[1px]" />}
      
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        updatePositionStrategy="always"
        avoidCollisions={!isMobile}
        collisionPadding={{ top: 16, bottom: 16, left: 8, right: 8 }}
        className={cn(
          // Base styles
          "bg-popover text-popover-foreground rounded-md border shadow-md outline-hidden z-50",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          
          // Mobile: centered modal
          isMobile && "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[28rem] max-h-[calc(100vh-4rem)]",
          
          // Desktop: relative positioning with backdrop
          !isMobile && "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-72 max-w-[min(100dvw-1rem,28rem)] max-h-[min(90dvh,calc(100dvh-4rem))] origin-(--radix-popover-content-transform-origin) p-4 before:fixed before:inset-0 before:z-[-1] before:bg-neutral-950/50 before:backdrop-blur-[1px]",
          
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
