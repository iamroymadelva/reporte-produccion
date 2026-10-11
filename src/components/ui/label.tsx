import * as React from "react"
import { cn } from "@/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "block text-sm leading-normal font-normal text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/**
 * Rótulo visible de un campo. Conserva la clase `field-label` (los tests y la maquetación
 * la usan para localizar y ordenar las etiquetas). Va dentro de un <Label> que envuelve al control.
 */
function FieldLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("field-label mb-2 block text-sm font-semibold text-foreground", className)}
      {...props}
    />
  )
}

export { Label, FieldLabel }
