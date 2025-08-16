'use client'

import * as React from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
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
}

export const Calendar20 = ({
  className,
  classNames,
  showOutsideDays = true,
  onSchedule,
  isPending,
  initialScheduledTime,
  editMode,
  ...props
}: CalendarProps) => {
  const today = new Date()
  const currentHour = today.getHours()
  const currentMinute = today.getMinutes()

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

  // Generate time slots based on user's posting window (default: 9 AM - 6 PM if no settings)
  const generateTimeSlots = (): string[] => {
    const startHour = postingWindow?.start ?? 9 // Default 9 AM
    const endHour = postingWindow?.end ?? 18 // Default 6 PM
    
    console.log('[DatePicker] Generating time slots from', startHour, 'to', endHour)
    
    const slots: string[] = []
    // Generate 15-minute intervals within the posting window
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
      }
    }
    
    console.log('[DatePicker] Generated', slots.length, 'time slots:', slots.slice(0, 5), '...')
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
    return initialScheduledTime ? new Date(initialScheduledTime) : new Date()
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

  const isTimeSlotDisabled = (timeString: string) => {
    if (!date || date.toDateString() !== today.toDateString()) {
      return false
    }

    const timeParts = timeString.split(':').map(Number)
    const hour = timeParts[0] ?? 0
    const minute = timeParts[1] ?? 0
    const slotTime = hour * 60 + minute
    const currentTime = currentHour * 60 + currentMinute

    return slotTime <= currentTime
  }

  const isPastDate = (date: Date) => {
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return dateOnly < todayOnly
  }

  return (
    <Card className="w-full gap-0 p-0 max-h-[80vh] overflow-hidden flex flex-col">
      <CardContent className="relative p-0 md:pr-48 flex-1 overflow-y-auto">
        {/* Calendar Section */}
        <div className="p-5">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            defaultMonth={date}
            disabled={isPastDate}
            showOutsideDays={false}
            startMonth={today}
            className="p-0 [--cell-size:--spacing(10)] max-[480px]:[--cell-size:--spacing(8)]"
            formatters={{
              formatWeekdayName: (date) => {
                return date.toLocaleString('en-US', { weekday: 'short' })
              },
            }}
            classNames={{
              day: 'size-10 rounded-lg max-[480px]:size-8 max-[480px]:text-xs',
              selected: 'z-10 rounded-md',
              [UI.Months]: 'relative',
              [UI.Month]: 'space-y-4 ml-0',
              [UI.MonthCaption]: 'flex w-full justify-center items-center h-7',
              [UI.CaptionLabel]: 'text-sm font-medium max-[480px]:text-xs',
              [UI.PreviousMonthButton]: cn(
                buttonVariants({ variant: 'outline' }),
                'absolute left-1 top-0 size-7 bg-transparent p-0 opacity-50 hover:opacity-100 max-[480px]:size-6',
              ),
              [UI.NextMonthButton]: cn(
                buttonVariants({ variant: 'outline' }),
                'absolute right-1 top-0 size-7 bg-transparent p-0 opacity-50 hover:opacity-100 max-[480px]:size-6',
              ),
              [UI.MonthGrid]: 'w-full border-collapse space-y-1',
              [UI.Weekdays]: 'flex',
              [UI.Weekday]:
                'text-muted-foreground rounded-md w-10 font-normal text-[0.8rem] max-[480px]:w-8 max-[480px]:text-[0.7rem]',
              [UI.Week]: 'flex w-full mt-2',
              [DayFlag.outside]:
                'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
              [DayFlag.disabled]: 'text-muted-foreground opacity-50',
              [DayFlag.hidden]: 'invisible',
              ...classNames,
            }}
          />
        </div>
        
        {/* Time Slots Section - Mobile First Design */}
        <div className="flex w-full flex-col border-t p-4 md:absolute md:inset-y-0 md:right-0 md:w-48 md:border-l md:border-t-0 md:p-6 md:max-h-full">
          <h3 className="mb-3 text-sm font-medium text-neutral-700 md:hidden">Select Time</h3>
          <div className="no-scrollbar flex max-h-[30vh] md:max-h-none flex-col gap-2 overflow-y-auto scroll-pb-4">
            <div className="grid grid-cols-1 gap-2 min-[481px]:grid-cols-3 md:grid-cols-1">
              {timeSlots
                .filter((time) => !isTimeSlotDisabled(time))
                .map((time) => (
                  <Button
                    key={time}
                    variant={selectedTime === time ? 'default' : 'outline'}
                    onClick={() => setSelectedTime(time)}
                    className={cn(
                      'h-10 text-sm shadow-none min-[481px]:h-8 min-[481px]:text-xs md:h-9 md:text-sm md:w-full touch-manipulation',
                      selectedTime === time && 'text-success-600'
                    )}
                  >
                    {formatHHmmTo12h(time)}
                  </Button>
                ))}
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-4 border-t px-6 !py-5 md:flex-row flex-shrink-0">
        <div className="text-sm">
          {date && selectedTime ? (
            <>
              {editMode ? 'Rescheduled for' : 'Scheduled for'}{' '}
              <span className="font-medium">
                {' '}
                {date?.toLocaleDateString('en-US', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}{' '}
              </span>
              at <span className="font-medium">{formatHHmmTo12h(selectedTime)}</span>.
            </>
          ) : (
            <>Select a date and time for your meeting.</>
          )}
        </div>
        <DuolingoButton
          loading={isPending}
          size="sm"
          disabled={!date || !selectedTime}
          className="w-full md:ml-auto md:w-auto"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            
            if (date && selectedTime && onSchedule) {
              onSchedule(date, selectedTime)
            }
          }}
        >
          {editMode ? 'Reschedule' : 'Schedule'}
        </DuolingoButton>
      </CardFooter>
    </Card>
  )
}
