"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        // Container classes
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",

        // Caption/header classes (v9 names)
        month_caption: "flex justify-center pt-1 relative items-center h-10",
        caption_label: "text-sm font-medium hidden",

        // Navigation classes (v9 names)
        nav: "flex items-center gap-1 absolute right-1 top-1",
        button_previous: cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "border border-black/5 bg-transparent shadow-sm hover:bg-black/5 hover:text-foreground",
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        button_next: cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "border border-black/5 bg-transparent shadow-sm hover:bg-black/5 hover:text-foreground",
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),

        // Grid classes (v9 names)
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-foreground/50 rounded-md w-9 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "h-9 w-9",
          "[&:has([aria-selected])]:bg-primary/10",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day_button: cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "hover:bg-black/5 hover:text-foreground",
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),

        // State classes (v9 names)
        range_start: "day-range-start",
        range_end: "day-range-end",
        selected: "bg-primary text-white hover:bg-primary hover:text-white focus:bg-primary focus:text-white rounded-md",
        today: "bg-black/5 text-foreground rounded-md",
        outside: "text-foreground/30 aria-selected:bg-primary/5 aria-selected:text-foreground/50",
        disabled: "text-foreground/30",
        range_middle: "aria-selected:bg-primary/10 aria-selected:text-foreground",
        hidden: "invisible",

        // Dropdown classes (v9 names)
        dropdowns: "flex gap-2 justify-center items-center",
        dropdown: "bg-transparent font-medium text-sm",

        // Merge with passed classNames
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight
          return <Icon className="h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
