import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative grid w-full grid-cols-[calc(var(--spacing)*4)_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border px-4 py-3 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive-text *:data-[slot=alert-description]:text-current",
        success:
          "border-success/30 bg-success/10 text-success-text *:data-[slot=alert-description]:text-current",
        warning:
          "border-warning/30 bg-warning/10 text-warning-text *:data-[slot=alert-description]:text-current",
        info:
          "border-info/30 bg-info/10 text-info-text *:data-[slot=alert-description]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const alertIcons = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
} as const

function Alert({
  className,
  variant = "default",
  role,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = alertIcons[variant ?? "default"]
  // Mensajes de éxito e información son avisos pasivos; el resto interrumpe al lector de pantalla.
  const defaultRole = variant === "success" || variant === "info" || variant === "warning" ? "status" : "alert"
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={role ?? defaultRole}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-h-4 font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
