import { useState } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { FieldLabel, Label } from "@/components/ui/label"

/**
 * Campos «Desde» / «Hasta» del filtro de reportes. Emiten los mismos parámetros GET `from` / `to`
 * (`YYYY-MM-DD`) mediante inputs ocultos; «Hasta» no admite días anteriores a «Desde» (el servidor ya lo exige).
 */
export default function ReportDateRange({ initialFrom = "", initialTo = "" }: { initialFrom?: string; initialTo?: string }) {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  return (
    <>
      <Label className="min-w-0">
        <FieldLabel>Desde</FieldLabel>
        <DatePicker label="Desde" name="from" value={from} onChange={setFrom} max={to || undefined} />
      </Label>
      <Label className="min-w-0">
        <FieldLabel>Hasta</FieldLabel>
        <DatePicker label="Hasta" name="to" value={to} onChange={setTo} min={from || undefined} />
      </Label>
    </>
  )
}
