import * as React from "react"
import { Check } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Checkbox({ className, checked, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <div 
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-gray-300 transition-all cursor-pointer",
        checked ? "bg-[#a23b67] border-[#a23b67]" : "bg-white hover:border-gray-400",
        className
      )}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {checked && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
    </div>
  )
}
