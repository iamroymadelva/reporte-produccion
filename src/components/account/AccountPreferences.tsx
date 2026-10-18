import { useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { normalizeTimeFormat, storeTimeFormat, type TimeFormat } from "@/lib/time-format";

const options: Array<{ value: TimeFormat; label: string; example: string }> = [
  { value: "24h", label: "24 horas", example: "Ejemplo: 18:37" },
  { value: "12h", label: "12 horas (a. m. / p. m.)", example: "Ejemplo: 06:37 p. m." },
];

type Props = { userId: string; initialTimeFormat: string | null };

/** «Mi cuenta»: preferencia de formato de hora (solo presentación) y acceso a cambiar la contraseña. */
export default function AccountPreferences({ userId, initialTimeFormat }: Props) {
  const [format, setFormat] = useState<TimeFormat>(normalizeTimeFormat(initialTimeFormat));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const choose = async (next: string) => {
    const value = normalizeTimeFormat(next);
    const previous = format;
    setFormat(value);
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/account/preferences", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ time_format: value }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "No fue posible guardar la preferencia.");
      }
      await storeTimeFormat(userId, value); // copia local: el selector la lee también sin conexión
      setState("saved");
      setMessage("Preferencia guardada.");
    } catch (error) {
      setFormat(previous);
      setState("error");
      setMessage(error instanceof TypeError ? "Sin conexión: conéctate para cambiar esta preferencia." : (error as Error).message);
    }
  };

  return <div className="grid gap-5 md:grid-cols-2">
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Formato de hora</CardTitle>
        <CardDescription>Cómo ves las horas al elegir fecha y hora en los reportes. Solo cambia la presentación: los datos guardados no cambian.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup value={format} onValueChange={(next) => void choose(next)} aria-label="Formato de hora" disabled={state === "saving"}>
          {options.map((option) => <div key={option.value} className="flex min-h-11 items-center gap-3 rounded-md border p-3">
            <RadioGroupItem value={option.value} id={`time-format-${option.value}`} />
            <Label htmlFor={`time-format-${option.value}`} className="flex-1 cursor-pointer">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-sm text-muted-foreground">{option.example}</span>
            </Label>
          </div>)}
        </RadioGroup>
        <p role={state === "error" ? "alert" : "status"} className={state === "error" ? "text-sm font-semibold text-destructive" : "flex min-h-5 items-center gap-1 text-sm text-muted-foreground"}>
          {state === "saved" && <Check className="size-4" aria-hidden="true" />}{message}
        </p>
      </CardContent>
    </Card>
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Contraseña</CardTitle>
        <CardDescription>Usa al menos 8 caracteres para proteger tu cuenta.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="min-h-11"><a href="/configurar-contrasena"><KeyRound className="size-4" aria-hidden="true" /> Cambiar contraseña</a></Button>
      </CardContent>
    </Card>
  </div>;
}
