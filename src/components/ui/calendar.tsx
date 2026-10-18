import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"
import { es } from "react-day-picker/locale"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

/**
 * Calendario estilo shadcn/ui sobre react-day-picker. Español (es-CO), semana desde el lunes y
 * celdas de 44 px (táctil y móvil) y de 36 px en escritorio con puntero fino. Todo vive en el bundle: no hace ninguna petición de red.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      locale={es}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-popover p-3 [--cell-size:2.75rem] md:pointer-fine:[--cell-size:2.25rem]",
        className
      )}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        caption_label: cn(
          "text-sm font-semibold capitalize select-none",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 text-center text-xs font-medium text-muted-foreground capitalize select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn(
          "group/day relative size-(--cell-size) shrink-0 p-0 text-center select-none",
          defaultClassNames.day
        ),
        day_button: cn(
          "size-(--cell-size) rounded-md text-sm font-normal text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/60",
          defaultClassNames.day_button
        ),
        selected:
          "[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90",
        today: "[&>button]:border [&>button]:border-primary [&>button]:font-semibold",
        outside: "[&>button]:text-muted-foreground",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: iconClass, orientation }) => {
          const Icon =
            orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : ChevronDown
          return <Icon className={cn("size-5", iconClass)} aria-hidden="true" />
        },
        ...components,
      }}
      {...props}
    />
  )
}

export { Calendar }
