import * as React from "react"
import { cn } from "@/lib/utils"
import { fieldControlClass } from "@/components/ui/input"

/**
 * <select> nativo con el aspecto de Input. Se usa en lugar del Select de Radix en los
 * formularios que dependen del comportamiento nativo (móvil, tests, envío de formularios).
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(fieldControlClass, "cursor-pointer pr-10", className)}
      {...props}
    />
  )
}

export { NativeSelect }
