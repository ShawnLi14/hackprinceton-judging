import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-transparent bg-muted/70 px-4 py-2 text-base shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-[background-color,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-ring/10 focus-visible:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_1px_rgba(220,38,38,0.3),0_0_0_4px_rgba(220,38,38,0.08)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
