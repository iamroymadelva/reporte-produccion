import * as React from "react"
import { cn } from "@/lib/utils"
import { fieldControlClass } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControlClass, "h-auto min-h-24 py-3", className)}
      {...props}
    />
  )
}

export { Textarea }
