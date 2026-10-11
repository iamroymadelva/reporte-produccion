import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Clases compartidas por Input, Textarea y NativeSelect: un solo aspecto para todos los
 * campos de formulario (48 px de alto para uso táctil en planta).
 */
const fieldControlClass = cn(
  "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-4 py-2 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground dark:bg-input/30",
  "hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 read-only:bg-muted/50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
)

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldControlClass,
        type === "number" && "font-mono tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldControlClass }
