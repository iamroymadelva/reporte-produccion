import { useId } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FieldLabel, Label } from "@/components/ui/label";

interface PasswordFieldProps {
  /** Rótulo visible del campo. */
  label: string;
  name: string;
  /** Id único del input; si falta se genera uno. El botón de ojo apunta a él con aria-controls. */
  id?: string;
  minLength?: number;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}

/**
 * Campo de contraseña con botón de ojo (mismo patrón que LoginCard: botón de 44 px, Eye/EyeOff, aria-label,
 * aria-pressed, aria-controls). Se renderiza solo en el servidor; la alternancia la hace
 * `installPasswordVisibility` (src/lib/password-visibility.ts) por delegación de eventos, así que funciona
 * también dentro de los <template> de los diálogos de administración.
 */
export default function PasswordField({ label, name, id, minLength, placeholder, required = true, autoComplete = "new-password" }: PasswordFieldProps) {
  const generated = useId();
  const inputId = id ?? `password-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div>
      <Label htmlFor={inputId}><FieldLabel>{label}</FieldLabel></Label>
      <div className="relative">
        <Input id={inputId} className="pr-14" type="password" name={name} autoComplete={autoComplete} minLength={minLength} placeholder={placeholder} required={required} />
        <button
          id={`${inputId}-toggle`}
          data-password-toggle=""
          className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          type="button"
          aria-label="Mostrar contraseña"
          aria-controls={inputId}
          aria-pressed="false"
          title="Mostrar contraseña"
        >
          <Eye data-password-hidden-icon="" className="pointer-events-none size-5" aria-hidden="true" />
          <EyeOff data-password-visible-icon="" className="pointer-events-none hidden size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
