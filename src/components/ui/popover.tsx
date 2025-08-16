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
  // Check if we're on mobile to apply different positioning
  const [isMobile, setIsMobile] = React.useState(false)
  
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (isMobile && className?.includes('max-w-[min(100vw-1rem,28rem)]')) {
    // For mobile date picker specifically, use modal-like centering
    return (
      <PopoverPrimitive.Portal>
        <>
          {/* Dimmed background overlay when popover is open. */}
          <div className="fixed inset-0 z-40 bg-neutral-950/50 backdrop-blur-[1px]" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              data-slot="popover-content"
              className={cn(
                "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 w-full max-w-[min(100vw-1rem,28rem)] max-h-[min(90vh,calc(100vh-4rem))] rounded-md border shadow-md outline-hidden overflow-hidden",
                className?.replace('max-w-[min(100vw-1rem,28rem)]', '').replace('max-h-[min(90vh,calc(100vh-4rem))]', '').replace('overflow-hidden', '').replace(/max-md:[^\s]*/g, '').replace(/md:[^\s]*/g, '').trim()
              )}
              {...props}
            />
          </div>
        </>
      </PopoverPrimitive.Portal>
    )
  }

  return (
    <PopoverPrimitive.Portal>
      <>
        {/* Dimmed background overlay when popover is open. */}
        <div className="fixed inset-0 z-40 bg-neutral-950/50 backdrop-blur-[1px]" />
        <PopoverPrimitive.Content
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
            className
          )}
          {...props}
        />
      </>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
