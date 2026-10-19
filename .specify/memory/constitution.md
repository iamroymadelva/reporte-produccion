<!--
Sync Impact Report
- Version change: (template, unratified) → 1.0.0
- Principles defined (first ratification):
  - [PRINCIPLE_1_NAME] → I. Autorización en el servidor (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Trazabilidad e integridad de los datos de producción
  - [PRINCIPLE_3_NAME] → III. Offline seguro y con confirmación explícita
  - [PRINCIPLE_4_NAME] → IV. Pruebas como evidencia
  - [PRINCIPLE_5_NAME] → V. Simplicidad sobre el stack existente
- Added sections: "Restricciones de plataforma y producto", "Flujo de desarrollo y puertas de calidad"
- Removed sections: none
- Templates:
  - ✅ .specify/templates/tasks-template.md — tests are mandatory for rule changes (Principle IV)
  - ✅ .specify/templates/plan-template.md — Constitution Check references principles I–V
  - ✅ .specify/templates/spec-template.md — no change required (no new mandatory sections)
  - ✅ specs/001-offline-production-reports/plan.md — Constitution Check re-mapped to I–V
  - ⚠ .specify/templates/commands/*.md — directory not present in this project; nothing to check
  - ⚠ docs/SECURITY_AND_ABUSE.md — still describes the current 3-role model and the 5-draft limit;
    update when feature 001 phase F2 lands (not a constitution change)
- Deferred TODOs: none
-->

# reporte-produccion Constitution

## Core Principles

### I. Autorización en el servidor (NON-NEGOTIABLE)

- Toda regla de acceso y de negocio que proteja datos MUST aplicarse en la base de datos (RLS,
  grants, restricciones y triggers) y MUST volver a validarse en la ruta de API correspondiente.
- La interfaz MAY ocultar acciones no permitidas, pero ocultarlas MUST NOT considerarse un control
  de seguridad: cualquier acción prohibida para un rol MUST rechazarse también por solicitud
  directa a la API o a PostgREST.
- La clave `service_role` MUST usarse solo en el servidor y solo para lo que el usuario no puede
  hacer con su propia sesión (Auth Admin, por ejemplo). Sus grants MUST ser los mínimos necesarios.
- Todo lo que llega desde un dispositivo offline MUST pasar por las mismas reglas de RLS y triggers
  que una acción online.

**Justificación**: Los usuarios de planta comparten dispositivos y se puede llamar a la API
saltándose la UI. La base de datos es el único punto que no se puede evitar.

### II. Trazabilidad e integridad de los datos de producción

- Toda creación o modificación de reportes, paradas, cambios y datos administrativos MUST quedar en
  un historial inalterable con autor, rol, fecha, valor anterior y nuevo, y motivo cuando aplique.
  Ningún rol, incluido el administrador raíz, MAY editar ni borrar el historial.
- Los datos con historial MUST NOT borrarse físicamente: se desactivan, se cancelan con motivo o se
  corrigen con motivo.
- La identidad histórica (folio, creador, aprobador) MUST ser inmutable.
- Las horas de los eventos MUST conservar la hora del dispositivo en que ocurrieron, junto con la
  hora de llegada al servidor.

**Justificación**: El auditor y la gerencia dependen de reconstruir quién hizo qué y cuándo. Un dato
que se puede reescribir sin rastro invalida los reportes.

### III. Offline seguro y con confirmación explícita

- Ningún dato capturado sin conexión MAY subirse al servidor sin una confirmación explícita de su
  autor.
- La subida MUST ser idempotente (identificadores generados en el cliente y registro de
  operaciones) y MUST tolerar interrupciones sin duplicar ni perder datos.
- Los datos locales MUST aislarse por usuario y MUST NOT borrarse automáticamente mientras estén
  pendientes.
- El HTML y los datos autenticados MUST NOT guardarse en Cache Storage. La UI offline MUST servirse
  desde shells sin datos más almacenamiento local por usuario.
- Las contraseñas MUST NOT guardarse legibles en el dispositivo.

**Justificación**: La conectividad en planta no es confiable, y la subida sin control o los datos
mezclados entre usuarios de un mismo dispositivo comprometerían la confianza en la plataforma.

### IV. Pruebas como evidencia

- Todo cambio en una regla de acceso, transición de estado, auditoría o sincronización MUST venir
  con pruebas automáticas que la verifiquen: pgTAP para las reglas de base de datos y `bun test`
  para la lógica de cliente y de API. Las pruebas de rechazo por rol MUST cubrir también las
  solicitudes directas.
- Una entrega MUST NOT considerarse completa sin evidencia en verde de `bun test`,
  `bun run db:test`, `astro check` y `bun run build`, más la validación descrita en el quickstart de
  la feature.
- Las pruebas que fallen MUST reportarse tal cual; MUST NOT desactivarse para obtener un verde.

**Justificación**: Las reglas críticas viven en SQL y en la sincronización offline, donde los
errores son silenciosos. Solo las pruebas demuestran que se cumplen.

### V. Simplicidad sobre el stack existente

- El stack es Astro SSR con islas React, Supabase (Auth, PostgREST, PostgreSQL, Realtime), ExcelJS
  y Tailwind/shadcn. Una nueva dependencia de runtime o un nuevo servicio MUST justificarse en el
  plan (research.md) con las alternativas descartadas.
- Los cambios de esquema MUST hacerse con migraciones versionadas y reproducibles con
  `bun run db:reset`. Un `ALTER TYPE ... ADD VALUE` MUST ir en una migración separada de su primer
  uso. Las migraciones de datos MUST preservar los registros existentes.
- Se prefiere la solución más simple que cumpla la spec (YAGNI). Toda complejidad adicional MUST
  registrarse en "Complexity Tracking" del plan.

**Justificación**: Un equipo pequeño mantiene esta plataforma. Cada pieza nueva aumenta el costo de
operación y de seguridad.

## Restricciones de plataforma y producto

- La interfaz MUST estar en español (`es-CO`), con fechas y horas en `America/Bogota`. Los
  reportes se agrupan por fecha operativa (fecha de inicio del turno).
- El despliegue es Vercel (serverless). Las funciones de tiempo real MUST usar Supabase Realtime y
  MUST NOT depender de conexiones largas servidas desde Vercel.
- La UI MUST ser usable en tabletas y teléfonos de planta (ancho móvil sin scroll horizontal,
  objetivos táctiles adecuados) y MUST seguir los criterios de accesibilidad de
  `docs/UI_UX_QA.md`.
- Los roles son administrador raíz, coordinador, operario y auditor, con la matriz de permisos
  definida en la spec vigente. Un cambio en esa matriz MUST pasar por la spec antes que por el
  código.

## Flujo de desarrollo y puertas de calidad

- El trabajo sigue Spec Kit: `specify` → `clarify` → `plan` → `tasks` → `implement`. La
  implementación MUST NOT empezar sin una spec aclarada y un plan que pase el Constitution Check.
- Roles de trabajo: Opus planifica, coordina y revisa; el agente `executor` (Sonnet) implementa; el
  agente `explorer` (Haiku) solo explora. Quien implementa MUST NOT revisar ni aprobar su propio
  trabajo.
- Cada fase o tarea se cierra solo con un **GO** explícito tras revisar el diff real y la evidencia
  del Principio IV. Un **NO-GO** devuelve correcciones concretas y se repite la ejecución.
- Los commits y los push se hacen solo cuando el usuario los pide, nunca en `main` directamente, y
  sin saltarse hooks ni firmas.

## Governance

- Esta constitución prevalece sobre otras prácticas del proyecto. En caso de conflicto, gana la
  constitución hasta que se enmiende.
- **Enmiendas**: se proponen con `/speckit-constitution`, documentando el motivo y el impacto en el
  Sync Impact Report. Requieren la aprobación del responsable del proyecto y la propagación a las
  plantillas afectadas en el mismo cambio.
- **Versionado** (SemVer):
  - MAJOR: eliminar o redefinir un principio de forma incompatible.
  - MINOR: añadir un principio o sección, o ampliar materialmente una guía.
  - PATCH: aclaraciones y redacción.
- **Cumplimiento**: cada `plan.md` MUST incluir un Constitution Check contra los principios I–V, y
  cada revisión GO/NO-GO MUST verificarlos. Las desviaciones se justifican en "Complexity Tracking"
  o se corrigen antes del GO.
- La guía operativa del día a día está en `CLAUDE.md` (raíz del proyecto) y en `docs/`.

**Version**: 1.0.0 | **Ratified**: 2026-10-09 | **Last Amended**: 2026-10-09
