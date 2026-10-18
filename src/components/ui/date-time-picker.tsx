import * as React from "react"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { fieldControlClass, Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  displayLocalDateTime,
  formatLocalDateTime,
  parseLocalDateTime,
  periodLabel,
  to12Hour,
  to24Hour,
  type DayPeriod,
  type TimeFormat,
} from "@/lib/local-datetime"
import { useTimeFormat } from "@/lib/time-format"

type DateTimePickerProps = Omit<
  React.ComponentProps<"button">,
  "value" | "onChange" | "type" | "name" | "children"
> & {
  /** `YYYY-MM-DDTHH:mm` local (siempre 24 h, sea cual sea el formato mostrado) o cadena vacía. */
  value: string
  onChange: (value: string) => void
  /** Nombre accesible del campo, p. ej. «Hora inicio». */
  label: string
  /** Si se indica, se emite un `<input type="hidden">` con el mismo valor para formularios. */
  name?: string
  /** Límites inclusivos en el mismo formato `YYYY-MM-DDTHH:mm`. */
  min?: string
  max?: string
  required?: boolean
  placeholder?: string
  /** Persona dueña de la preferencia de hora (por defecto, la de la página: `<body data-user-id>`). */
  userId?: string | null
  /** Fuerza el formato de hora (pruebas); normalmente se lee la preferencia del usuario. */
  timeFormat?: TimeFormat
}

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 2)
const two = (value: number) => String(value).padStart(2, "0")

/**
 * Selector de fecha y hora (patrón «Date and Time Picker» de shadcn/ui): Popover + Calendar +
 * campo de hora en 24 h o en 12 h con a. m./p. m. según la preferencia del usuario. El valor emitido
 * es SIEMPRE el texto local `YYYY-MM-DDTHH:mm` en 24 h (igual que `datetime-local`), así que la lógica de
 * guardado y sincronización no cambia. Funciona sin conexión (no hace peticiones).
 */
function DateTimePicker({
  value,
  onChange,
  label,
  name,
  min,
  max,
  required,
  placeholder = "Seleccionar fecha y hora",
  userId,
  timeFormat,
  disabled,
  className,
  ...buttonProps
}: DateTimePickerProps) {
  const preferred = useTimeFormat(userId)
  const format: TimeFormat = timeFormat ?? preferred
  const is12 = format === "12h"
  const parsed = parseLocalDateTime(value)
  const shownHour = (hours24: number) => two(is12 ? to12Hour(hours24).hour : hours24)
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date>(() => parsed?.date ?? new Date())
  const [hh, setHh] = React.useState(parsed ? shownHour(parsed.hours) : "")
  const [mm, setMm] = React.useState(parsed ? two(parsed.minutes) : "")
  const [period, setPeriod] = React.useState<DayPeriod>(() => to12Hour(parsed?.hours ?? new Date().getHours()).period)
  const [rangeError, setRangeError] = React.useState("")
  const minParts = parseLocalDateTime(min)
  const maxParts = parseLocalDateTime(max)

  // Sincroniza los campos de hora con el valor externo (cambio desde fuera, borrar, abrir, cambio de formato).
  React.useEffect(() => {
    const next = parseLocalDateTime(value)
    const hourText = (hours24: number) => two(format === "12h" ? to12Hour(hours24).hour : hours24)
    // No pisa lo que la persona está escribiendo si ya equivale al valor (p. ej. «7» vs «07»).
    setHh((prev) => (next && prev !== "" && Number(prev) === Number(hourText(next.hours)) ? prev : next ? hourText(next.hours) : ""))
    setMm((prev) => (next && prev !== "" && Number(prev) === next.minutes ? prev : next ? two(next.minutes) : ""))
    if (next) {
      setMonth(next.date)
      setPeriod(to12Hour(next.hours).period)
    }
  }, [value, open, format])

  const commit = (date: Date, hours: number, minutes: number) => {
    const next = formatLocalDateTime(date, hours, minutes)
    if (minParts && min && next < min) {
      setRangeError(`Debe ser igual o posterior a ${displayLocalDateTime(min, format)}.`)
      return
    }
    if (maxParts && max && next > max) {
      setRangeError(`Debe ser igual o anterior a ${displayLocalDateTime(max, format)}.`)
      return
    }
    setRangeError("")
    if (next !== value) onChange(next)
  }

  const currentTime = () => {
    if (parsed) return { hours: parsed.hours, minutes: parsed.minutes }
    const now = new Date()
    return { hours: now.getHours(), minutes: now.getMinutes() }
  }

  /** Texto de los campos → hora de 24 h (la única que se emite). 12 h: 1-12 + periodo; 24 h: 0-23. */
  const timeFrom = (h: string, m: string, complete = true, dayPeriod: DayPeriod = period) => {
    if (!h || !m || (complete && (h.length < 2 || m.length < 2))) return null
    const typedHour = Number(h)
    const minutes = Number(m)
    if (minutes > 59) return null
    if (is12) return typedHour >= 1 && typedHour <= 12 ? { hours: to24Hour(typedHour, dayPeriod), minutes } : null
    return typedHour <= 23 ? { hours: typedHour, minutes } : null
  }

  const onTime = (nextH: string, nextM: string, dayPeriod: DayPeriod = period) => {
    setHh(nextH)
    setMm(nextM)
    const time = timeFrom(nextH, nextM, true, dayPeriod)
    if (time) commit(parsed?.date ?? new Date(), time.hours, time.minutes)
  }

  const changePeriod = (next: DayPeriod) => {
    setPeriod(next)
    onTime(hh, mm, next)
  }

  const normalizeOnBlur = () => {
    const time = timeFrom(hh, mm, false)
    if (time) {
      setHh(is12 ? two(to12Hour(time.hours).hour) : two(time.hours))
      setMm(two(time.minutes))
      commit(parsed?.date ?? new Date(), time.hours, time.minutes)
    } else {
      // Valor incompleto o fuera de rango: vuelve al último valor válido.
      setHh(parsed ? shownHour(parsed.hours) : "")
      setMm(parsed ? two(parsed.minutes) : "")
    }
  }

  const step = (event: React.KeyboardEvent<HTMLInputElement>, field: "h" | "m") => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const delta = event.key === "ArrowUp" ? 1 : -1
    if (field === "h") {
      // 24 h: 00-23. 12 h: 01-12 (12 → 01 y 01 → 12); el periodo no cambia.
      const base = Number(hh || (is12 ? 12 : 0))
      const next = is12 ? ((base - 1 + delta + 12) % 12) + 1 : (base + delta + 24) % 24
      onTime(two(next), mm || "00")
    } else {
      onTime(hh || (is12 ? "12" : "00"), two((Number(mm || 0) + delta + 60) % 60))
    }
  }

  const today = () => {
    const time = currentTime()
    const now = new Date()
    setMonth(now)
    commit(now, time.hours, time.minutes)
  }

  const clear = () => {
    setRangeError("")
    setHh("")
    setMm("")
    onChange("")
    setOpen(false)
  }

  const shown = displayLocalDateTime(value, format)
  const disabledDays = [
    ...(minParts ? [{ before: minParts.date }] : []),
    ...(maxParts ? [{ after: maxParts.date }] : []),
  ]
  const hourInvalid = hh !== "" && (is12 ? Number(hh) < 1 || Number(hh) > 12 : Number(hh) > 23)
  // Control táctil de 44 px; en escritorio con puntero fino (md+) se compacta a 36 px.
  const compactControl = "md:pointer-fine:h-9"

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
            data-slot="date-time-picker"
            data-time-format={format}
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
          {/* Solo esta zona se desplaza; la barra de acciones de abajo queda siempre alcanzable. */}
          <div data-slot="date-time-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Calendar
              mode="single"
              selected={parsed?.date}
              month={month}
              onMonthChange={setMonth}
              disabled={disabledDays.length ? disabledDays : undefined}
              onSelect={(day) => {
                if (!day) return
                const time = currentTime()
                commit(day, time.hours, time.minutes)
              }}
            />
            <div className="space-y-3 border-t p-3">
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={is12 ? "Hora en formato de 12 horas" : "Hora en formato de 24 horas"}
              >
                <span className="text-sm font-medium">{is12 ? "Hora (12 h)" : "Hora (24 h)"}</span>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  aria-label={is12 ? "Horas, de 01 a 12" : "Horas, de 00 a 23"}
                  placeholder="HH"
                  value={hh}
                  aria-invalid={hourInvalid ? true : undefined}
                  className={cn("h-11 w-16 px-2 text-center font-mono tabular-nums", compactControl)}
                  onChange={(event) => onTime(digits(event.target.value), mm)}
                  onBlur={normalizeOnBlur}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => step(event, "h")}
                />
                <span aria-hidden="true" className="font-semibold">:</span>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  aria-label="Minutos, de 00 a 59"
                  placeholder="mm"
                  value={mm}
                  aria-invalid={mm !== "" && Number(mm) > 59 ? true : undefined}
                  className={cn("h-11 w-16 px-2 text-center font-mono tabular-nums", compactControl)}
                  onChange={(event) => onTime(hh, digits(event.target.value))}
                  onBlur={normalizeOnBlur}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => step(event, "m")}
                />
                {is12 ? (
                  <div role="radiogroup" aria-label="a. m. o p. m." className="flex gap-1" data-slot="day-period">
                    {(["AM", "PM"] as const).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={period === option}
                        variant={period === option ? "default" : "outline"}
                        className="min-h-11 px-3 md:pointer-fine:min-h-9"
                        onClick={() => changePeriod(option)}
                      >
                        {periodLabel(option)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              {rangeError ? (
                <p role="alert" className="text-sm font-semibold text-destructive">{rangeError}</p>
              ) : null}
            </div>
          </div>
          <div data-slot="date-time-actions" className="flex shrink-0 gap-2 border-t bg-popover p-3">
            <Button type="button" variant="outline" className="min-h-11 flex-1 md:pointer-fine:min-h-9" onClick={today}>Hoy</Button>
            <Button type="button" variant="outline" className="min-h-11 flex-1 md:pointer-fine:min-h-9" onClick={clear}>Borrar</Button>
            <Button type="button" className="min-h-11 flex-1 md:pointer-fine:min-h-9" onClick={() => setOpen(false)}>Listo</Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

export { DateTimePicker }
