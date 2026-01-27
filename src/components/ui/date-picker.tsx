"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

import { Button } from "./button"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { useIsMobile } from "../../hooks/useIsMobile"

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface DatePickerProps {
  date?: Date
  onDateChange?: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  fromYear?: number
  toYear?: number
}

export function DatePicker({
  date,
  onDateChange,
  placeholder = "Pick a date",
  disabled = false,
  fromYear = 1900,
  toYear = new Date().getFullYear(),
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()

  const handleSelect = (selectedDate: Date | undefined) => {
    onDateChange?.(selectedDate)
    setOpen(false)
  }

  // Mobile-specific classNames for larger touch targets (using v9 class names)
  const mobileClassNames = isMobile ? {
    weekday: "text-foreground/50 rounded-md w-10 font-normal text-[0.8rem] text-center",
    week: "flex w-full mt-2",
    day: cn(
      "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
      "h-10 w-10",
      "[&:has([aria-selected])]:bg-primary/10 [&:has([aria-selected])]:rounded-md"
    ),
    day_button: cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:pointer-events-none disabled:opacity-50",
      "hover:bg-black/5 hover:text-foreground",
      "h-10 w-10 p-0 font-normal aria-selected:opacity-100"
    ),
  } : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-11 rounded-xl border border-black/5 bg-black/[0.03] px-3 py-2 text-sm shadow-sm hover:bg-black/[0.05]",
            !date && "text-foreground/30"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 bg-white border border-black/5 rounded-xl shadow-lg"
        align={isMobile ? "center" : "start"}
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions={true}
      >
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          disabled={disabled}
          captionLayout="dropdown"
          fromYear={fromYear}
          toYear={toYear}
          initialFocus
          classNames={mobileClassNames}
        />
      </PopoverContent>
    </Popover>
  )
}
