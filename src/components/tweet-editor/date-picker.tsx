'use client'

import * as React from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DayFlag, DayPicker, SelectionState, UI } from 'react-day-picker'
import { cn } from '@/lib/utils'
import DuolingoButton from '../ui/duolingo-button'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'


export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  onSchedule?: (date: Date, time: string) => void
  isPending?: boolean
  initialScheduledTime?: Date
  editMode?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const Calendar20 = ({
  className,
  classNames,
  showOutsideDays = true,
  onSchedule,
  isPending,
  initialScheduledTime,
  editMode,
  open,
  onOpenChange,
  ...props
}: CalendarProps) => {
  const today = new Date()
  const currentHour = today.getHours()
  const currentMinute = today.getMinutes()
  
  console.log('[DatePicker] Current time:', today.toISOString())
  console.log('[DatePicker] Current local time:', today.toLocaleString())
  console.log('[DatePicker] Current hour:', currentHour, 'Current minute:', currentMinute)

  // Fetch user's posting window settings
  const { data: postingWindow } = useQuery({
    queryKey: ['posting-window'],
    queryFn: async () => {
      console.log('[DatePicker] Fetching posting window for time slots...')
      const res = await client.settings.getPostingWindow.$get()
      const data = await res.json()
      console.log('[DatePicker] Retrieved posting window:', data)
      return data
    },
  })

  // Helper to format a "HH:mm" string into a 12-hour time label like "1:30 PM"
  const formatHHmmTo12h = (hhmm: string | null): string => {
    if (!hhmm) return ''
    const [hStr, mStr] = hhmm.split(':')
    const hours24 = Number(hStr || 0)
    const minutes = Number(mStr || 0)
    const hours12 = ((hours24 + 11) % 12) + 1
    const ampm = hours24 >= 12 ? 'PM' : 'AM'
    return `${hours12}:${mStr?.padStart(2, '0')} ${ampm}`
  }

  // Generate time slots using the same preset slots as the queue system
  const generateTimeSlots = (): string[] => {
    // Use the same preset slots as the queue system: 10am, 12pm, 2pm
    const PRESET_SLOTS = [10, 12, 14] // 10am, 12pm (noon), 2pm
    
    console.log('[DatePicker] Using preset queue slots:', PRESET_SLOTS)
    console.log('[DatePicker] postingWindow object (for reference):', postingWindow)
    
    const slots: string[] = []
    
    // Convert preset hours to HH:mm format
    PRESET_SLOTS.forEach(hour => {
      slots.push(`${hour.toString().padStart(2, '0')}:00`)
    })
    
    // Add some additional popular times for manual scheduling flexibility
    const additionalSlots = [8, 9, 11, 13, 15, 16, 17, 18] // 8am, 9am, 11am, 1pm, 3pm, 4pm, 5pm, 6pm
    additionalSlots.forEach(hour => {
      slots.push(`${hour.toString().padStart(2, '0')}:00`)
    })
    
    // Sort slots by time
    slots.sort()
    
    console.log('[DatePicker] Generated', slots.length, 'preset time slots:', slots)
    return slots
  }

  const timeSlots = generateTimeSlots()

  const getNextAvailableTime = (): string => {
    const currentTime = currentHour * 60 + currentMinute
    return (
      timeSlots.find((timeSlot) => {
        const timeParts = timeSlot.split(':').map(Number)
        const hour = timeParts[0] ?? 0
        const minute = timeParts[1] ?? 0
        const slotTime = hour * 60 + minute
        return slotTime > currentTime
      }) ??
      timeSlots[0] ??
      '10:00'
    )
  }

  const getInitialDate = (): Date => {
    if (initialScheduledTime) {
      return new Date(initialScheduledTime)
    }
    
    // If all today's time slots are in the past, start with tomorrow
    const hasAvailableSlots = timeSlots.some(timeSlot => {
      const timeParts = timeSlot.split(':').map(Number)
      const hour = timeParts[0] ?? 0
      const minute = timeParts[1] ?? 0
      const slotTime = hour * 60 + minute
      const currentTime = currentHour * 60 + currentMinute
      return slotTime > currentTime
    })
    
    if (!hasAvailableSlots) {
      console.log('[DatePicker] All today\'s slots are past, defaulting to tomorrow')
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      return tomorrow
    }
    
    return new Date()
  }

  const getInitialTime = (): string => {
    if (initialScheduledTime) {
      const scheduledDate = new Date(initialScheduledTime)
      const hour = scheduledDate.getHours().toString().padStart(2, '0')
      const minute = scheduledDate.getMinutes().toString().padStart(2, '0')
      return `${hour}:${minute}`
    }
    return getNextAvailableTime()
  }

  const [date, setDate] = React.useState<Date | undefined>(getInitialDate())
  const [selectedTime, setSelectedTime] = React.useState<string | null>(
    getInitialTime(),
  )
  
  // Debug logging after state initialization
  console.log('[DatePicker] Component state - date:', date, 'selectedTime:', selectedTime)
  console.log('[DatePicker] postingWindow:', postingWindow)
  console.log('[DatePicker] Current date state:', date)
  console.log('[DatePicker] Today:', today.toDateString())
  console.log('[DatePicker] Time slots array length:', timeSlots.length)
  console.log('[DatePicker] First few time slots:', timeSlots.slice(0, 5))
  
  // Fallback: if no time slots are generated, create some default ones using preset slots
  if (timeSlots.length === 0) {
    console.log('[DatePicker] No time slots generated, using fallback with preset queue slots')
    const fallbackSlots = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']
    return (
      <Card className="w-full gap-0 p-0 max-h-[80dvh] overflow-hidden flex flex-col">
        <CardContent className="relative p-0 md:pr-56 flex-1 min-h-0 overflow-y-auto">
          <div className="p-5">
            <p>Error: No time slots available. Using fallback times.</p>
          </div>
          <div className="flex w-full flex-col border-t p-4 md:absolute md:inset-y-0 md:right-0 md:w-56 md:border-l md:border-t-0 md:p-6 md:max-h-full md:z-10 bg-background">
            <h3 className="mb-3 text-sm font-medium text-neutral-700 md:hidden">Select Time</h3>
            <div className="no-scrollbar flex max-h-[30dvh] md:max-h-[calc(100%-2rem)] flex-col gap-2 overflow-y-auto scroll-pb-4">
              <div className="grid grid-cols-1 gap-2 min-[481px]:grid-cols-3 md:grid-cols-1 md:pr-1">
                {fallbackSlots.map((time) => (
                  <Button
                    key={time}
                    variant={selectedTime === time ? 'default' : 'outline'}
                    onClick={() => setSelectedTime(time)}
                    className="h-10 text-sm shadow-none min-[481px]:h-8 min-[481px]:text-xs md:h-9 md:text-sm md:w-full touch-manipulation"
                  >
                    {formatHHmmTo12h(time)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isTimeSlotDisabled = (timeString: string) => {
    if (!date || date.toDateString() !== today.toDateString()) {
      console.log('[DatePicker] isTimeSlotDisabled - not today, returning false for:', timeString)
      return false
    }

    const timeParts = timeString.split(':').map(Number)
    const hour = timeParts[0] ?? 0
    const minute = timeParts[1] ?? 0
    const slotTime = hour * 60 + minute
    const currentTime = currentHour * 60 + currentMinute
    
    const isDisabled = slotTime <= currentTime
    console.log('[DatePicker] isTimeSlotDisabled -', timeString, 'slotTime:', slotTime, 'currentTime:', currentTime, 'disabled:', isDisabled)

    return isDisabled
  }

  const isPastDate = (date: Date) => {
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return dateOnly < todayOnly
  }

  // Content component for centered popup
  const CalendarContent = () => (
    <div className="flex flex-col h-full">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Calendar Section */}
        <div className="p-6 pb-4">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            defaultMonth={date}
            disabled={isPastDate}
            showOutsideDays={false}
            startMonth={today}
            className="w-fit mx-auto p-0 [--cell-size:--spacing(9)]"
            formatters={{
              formatWeekdayName: (date) => {
                return date.toLocaleString('en-US', { weekday: 'short' })
              },
            }}
            classNames={{
              day: 'size-9 rounded-lg text-sm',
              selected: 'rounded-md',
              [UI.Months]: 'relative',
              [UI.Month]: 'space-y-4 ml-0',
              [UI.MonthCaption]: 'flex w-full justify-center items-center h-7',
              [UI.CaptionLabel]: 'text-sm font-medium',
              [UI.PreviousMonthButton]: cn(
                buttonVariants({ variant: 'outline' }),
                'absolute left-1 top-0 size-7 bg-transparent p-0 opacity-50 hover:opacity-100',
              ),
              [UI.NextMonthButton]: cn(
                buttonVariants({ variant: 'outline' }),
                'absolute right-1 top-0 size-7 bg-transparent p-0 opacity-50 hover:opacity-100',
              ),
              [UI.MonthGrid]: 'w-full border-collapse space-y-1',
              [UI.Weekdays]: 'flex',
              [UI.Weekday]:
                'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
              [UI.Week]: 'flex w-full mt-2',
              [DayFlag.outside]:
                'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
              [DayFlag.disabled]: 'text-muted-foreground opacity-50',
              [DayFlag.hidden]: 'invisible',
              ...classNames,
            }}
          />
        </div>
        
        {/* Time Slots Section */}
        <div className="p-6 pt-2 border-t">
          <h3 className="mb-4 text-sm font-medium text-neutral-700">Select Time</h3>
          <div className="max-h-32 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.map((time) => {
                console.log('[DatePicker] Processing time slot:', time)
                const isDisabled = isTimeSlotDisabled(time)
                console.log('[DatePicker] Rendering time slot button:', time, 'disabled:', isDisabled)
                return (
                  <Button
                    key={time}
                    variant={selectedTime === time ? 'default' : 'outline'}
                    disabled={isDisabled}
                    onClick={() => setSelectedTime(time)}
                    className={cn(
                      'h-9 text-sm shadow-none touch-manipulation',
                      selectedTime === time && 'text-success-600',
                      isDisabled && 'opacity-50'
                    )}
                  >
                    {formatHHmmTo12h(time)}
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      
      {/* Fixed Footer Section */}
      <div className="flex-shrink-0 flex flex-col gap-4 border-t p-6 bg-background">
        <div className="text-sm text-center">
          {date && selectedTime ? (
            <>
              {editMode ? 'Rescheduled for' : 'Scheduled for'}{' '}
              <span className="font-medium">
                {date?.toLocaleDateString('en-US', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </span>
              {' '}at <span className="font-medium">{formatHHmmTo12h(selectedTime)}</span>.
            </>
          ) : (
            <>Select a date and time for your meeting.</>
          )}
        </div>
        <DuolingoButton
          loading={isPending}
          size="sm"
          disabled={!date || !selectedTime}
          className="w-full"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            
            if (date && selectedTime && onSchedule) {
              console.log('[DatePicker] Schedule button clicked, closing modal')
              onSchedule(date, selectedTime)
              onOpenChange(false)
            }
          }}
        >
          {editMode ? 'Reschedule' : 'Schedule'}
        </DuolingoButton>
      </div>
    </div>
  )

  // Always use centered dialog popup for both mobile and desktop
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[90vw] max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-6 pb-0 flex-shrink-0">
          <DialogTitle className="text-center">
            {editMode ? 'Reschedule Post' : 'Schedule Post'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          <CalendarContent />
        </div>
      </DialogContent>
    </Dialog>
  )
}
