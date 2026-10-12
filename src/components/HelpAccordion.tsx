import { useId, useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HelpTaskView } from "@/lib/help-content";

/**
 * Acordeón de tareas de la página /ayuda. Cada título es un botón con aria-expanded; el panel se oculta con `hidden`
 * (el contenido sigue en el HTML renderizado por el servidor).
 */
export default function HelpAccordion({ tasks, defaultOpenId }: { tasks: HelpTaskView[]; defaultOpenId?: string }) {
  const base = useId();
  const [open, setOpen] = useState<string | null>(defaultOpenId ?? null);

  return <div className="space-y-3" data-testid="help-accordion">
    {tasks.map((task) => {
      const expanded = open === task.id;
      const buttonId = `${base}-${task.id}-btn`;
      const panelId = `${base}-${task.id}-panel`;
      return <section key={task.id} data-task={task.id} className="rounded-2xl border bg-card text-card-foreground shadow-sm">
        <h3>
          <button
            type="button"
            id={buttonId}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setOpen(expanded ? null : task.id)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <span className="min-w-0">
              <span className="block text-base font-bold leading-snug">{task.title}</span>
              <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{task.summary}</span>
            </span>
            <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
        </h3>
        <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="space-y-4 border-t px-4 py-4">
          <ol className="list-decimal space-y-2 pl-6 text-base marker:font-bold marker:text-primary">
            {task.steps.map((step) => <li key={step} className="pl-1">{step}</li>)}
          </ol>
          {task.tip && <p className="rounded-xl bg-muted p-3 text-sm"><span className="font-semibold">Ten en cuenta: </span>{task.tip}</p>}
          {task.notes && task.notes.length > 0 && <div>
            <p className="text-sm font-semibold">Bueno saber</p>
            <ul className="mt-1 list-disc space-y-1 pl-6 text-sm">
              {task.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>}
          {task.limit && <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text" data-testid="help-limit">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span><span className="font-semibold">Lo que no puedes hacer: </span>{task.limit}</span>
          </p>}
          {task.image && <figure>
            <img src={task.image.src} alt={task.image.alt} loading="lazy" decoding="async" className="mx-auto h-auto w-full max-w-[18rem] rounded-xl border" />
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">{task.image.alt}</figcaption>
          </figure>}
        </div>
      </section>;
    })}
  </div>;
}
