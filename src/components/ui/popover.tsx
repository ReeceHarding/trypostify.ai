"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

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
  // Temporary logging to debug positioning
  React.useEffect(() => {
    console.log('[PopoverContent Debug] Props received:', {
      align,
      sideOffset,
      side: props.side,
      avoidCollisions: props.avoidCollisions,
      collisionPadding: props.collisionPadding,
      updatePositionStrategy: props.updatePositionStrategy,
      className,
      hasChildren: !!props.children
    })
  }, [align, sideOffset, props.side, props.avoidCollisions, props.collisionPadding, className])
  
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        ref={(el) => {
          if (el) {
            // Log actual positioning after Radix UI places it
            const rect = el.getBoundingClientRect()
            const trigger = document.querySelector('[data-state="open"][data-slot="popover-trigger"]')
            const triggerRect = trigger?.getBoundingClientRect()
            console.log('[PopoverContent Debug] Actual positioning:', {
              popover: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
              trigger: triggerRect ? { top: triggerRect.top, left: triggerRect.left, width: triggerRect.width, height: triggerRect.height } : null,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              dataAttributes: {
                side: el.getAttribute('data-side'),
                align: el.getAttribute('data-align'),
                state: el.getAttribute('data-state')
              }
            })
          }
        }}
        className={cn(
          "z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
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
