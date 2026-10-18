import * as React from "react"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { fieldControlClass } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { displayLocalDate, formatLocalDate, parseLocalDate } from "@/lib/local-datetime"
import { getBogotaDateKey } from "@/lib/format"

type DatePickerProps = Omit<
  React.ComponentProps<"button">,
  "value" | "onChange" | "type" | "name" | "children"
> & {
  /** `YYYY-MM-DD` o cadena vacía. */
  value: string
  onChange: (value: string) => void
  /** Nombre accesible del campo, p. ej. «Desde». */
  label: string
  /** Si se indica, se emite un `<input type="hidden">` con el mismo valor para formularios. */
  name?: string
  /** Límites inclusivos `YYYY-MM-DD`. Los días fuera de rango se deshabilitan. */
  min?: string
  max?: string
  required?: boolean
  placeholder?: string
}

/**
 * Selector de fecha (patrón «Date Picker» de shadcn/ui): Popover + Calendar, solo día, sin hora.
 * Valor `YYYY-MM-DD`, mostrado como dd/MM/yyyy. «Hoy» usa la fecha operativa de America/Bogota.
 */
function DatePicker({
  value,
  onChange,
  label,
  name,
  min,
  max,
  required,
  placeholder = "Seleccionar fecha",
  disabled,
  className,
  ...buttonProps
}: DatePickerProps) {
  const selected = parseLocalDate(value) ?? undefined
  const minDate = parseLocalDate(min)
  const maxDate = parseLocalDate(max)
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date>(() => selected ?? parseLocalDate(getBogotaDateKey()) ?? new Date())

  // Mantiene el mes visible en sincronía con el valor externo y al abrir.
  React.useEffect(() => {
    const next = parseLocalDate(value)
    if (next) setMonth(next)
  }, [value, open])

  const shown = displayLocalDate(value)
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  const choose = (key: string) => {
    if (key !== value) onChange(key)
    setOpen(false)
  }
  const todayKey = getBogotaDateKey()
  const todayDisabled = (!!min && todayKey < min) || (!!max && todayKey > max)

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${label}: ${shown || "sin seleccionar"}`}
            aria-required={required || undefined}
            data-slot="date-picker"
            data-empty={shown ? undefined : "true"}
            className={cn(
              fieldControlClass,
              "flex items-center justify-between gap-2 text-left font-normal data-[empty=true]:text-muted-foreground",
              className
            )}
            {...buttonProps}
          >
            <span className="truncate font-mono tabular-nums">{shown || placeholder}</span>
            <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          avoidCollisions
          collisionPadding={8}
          aria-label={`Seleccionar ${label}`}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
        >
          {/* Solo esta zona se desplaza; la barra de acciones queda siempre alcanzable. */}
          <div data-slot="date-picker-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Calendar
              mode="single"
              selected={selected}
              month={month}
              onMonthChange={setMonth}
              disabled={disabledDays.length ? disabledDays : undefined}
              onSelect={(day) => {
                if (day) choose(formatLocalDate(day))
              }}
            />
          </div>
          <div data-slot="date-picker-actions" className="flex shrink-0 gap-2 border-t bg-popover p-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 md:pointer-fine:min-h-9"
              disabled={todayDisabled}
              onClick={() => choose(todayKey)}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 md:pointer-fine:min-h-9"
              onClick={() => choose("")}
            >
              Borrar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

export { DatePicker }
