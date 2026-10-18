// Contenido del menú de ayuda (?). Fuente: docs/USER_GUIDE.md.
// Es un módulo de datos puro (sin React ni Astro) para poder probarlo y reutilizarlo en el PDF de la Fase B.
// Redacción: español es-CO, frases cortas, verbos de acción y sin jerga técnica.
import type { AppRole } from "./types";

export const HELP_ROLES: readonly AppRole[] = ["OPERATOR", "ADMINISTRATOR", "VIEWER", "ROOT"] as const;

export type HelpImage = { src: string; alt: string };

export type HelpTask = {
  id: string;
  title: string;
  /** Una frase que dice para qué sirve. */
  summary: string;
  /** Roles que ven esta tarea. */
  roles: AppRole[];
  steps: string[];
  /** Consejo o ejemplo opcional. */
  tip?: string;
  /** Lista de «Bueno saber»: datos cortos, uno por línea. */
  notes?: string[];
  /** Qué NO puede hacer cada rol en esta tarea (solo se muestra el aviso del rol de quien lee). */
  notAllowed?: Partial<Record<AppRole, string>>;
  /** Captura de pantalla (solo si el archivo existe en public/ayuda/). */
  image?: HelpImage;
};

export type HelpFirstSteps = { title: string; intro: string; steps: string[] };

export type HelpProblem = { message: string; action: string; roles: AppRole[] };

export const ROLE_HELP_LABEL: Record<AppRole, string> = {
  OPERATOR: "Operario",
  ADMINISTRATOR: "Coordinador",
  VIEWER: "Auditor",
  ROOT: "Administrador raíz",
};

const MANAGERS: AppRole[] = ["ADMINISTRATOR", "ROOT"];
const ALL: AppRole[] = ["OPERATOR", "ADMINISTRATOR", "VIEWER", "ROOT"];
const READERS: AppRole[] = ["ADMINISTRATOR", "VIEWER", "ROOT"];

export const firstSteps: Record<AppRole, HelpFirstSteps> = {
  OPERATOR: {
    title: "Primeros pasos del operario",
    intro: "Tu trabajo es llenar el reporte de tu máquina durante el turno. Todo se hace en la pantalla Turno.",
    steps: [
      "Entra con tu usuario y tu contraseña.",
      "En Turno, elige tu máquina y pulsa «Iniciar reporte».",
      "Si la máquina se detiene, pulsa «Iniciar parada». Cuando arranque, pulsa «Cerrar parada».",
      "Si cambia algo en la producción (producto, formato o lote), anótalo en «Cambios».",
      "Llena los «Datos de producción».",
      "Al terminar el turno, pulsa «Enviar reporte».",
      "Para ir al dashboard pulsa «Volver al dashboard» (necesita internet): tu reporte sigue activo y lo que escribías se guarda. Desde el dashboard vuelves con «Continuar turno».",
      "Para cerrar sesión, abre el menú de tu perfil (el círculo con tus iniciales, arriba a la derecha) y elige «Cerrar sesión». Si tienes datos sin subir, te pedirá confirmación.",
    ],
  },
  ADMINISTRATOR: {
    title: "Primeros pasos del coordinador",
    intro: "Tú revisas los reportes que envían los operarios, los apruebas y administras la planta.",
    steps: [
      "Entra con tu usuario y tu contraseña.",
      "En Dashboard ves los reportes y las máquinas detenidas, al momento.",
      "En Reportes busca el reporte que quieres revisar y pulsa «Abrir».",
      "Si está completo, pulsa «Aprobar y cerrar».",
      "En Administración creas usuarios, máquinas y catálogos.",
      "Cuando necesites un archivo, usa «Exportar Excel».",
    ],
  },
  VIEWER: {
    title: "Primeros pasos del auditor",
    intro: "Tú consultas los reportes y su historial. Solo puedes mirar y descargar; no puedes cambiar nada.",
    steps: [
      "Entra con tu usuario y tu contraseña.",
      "En Dashboard ves cómo va la planta, al momento.",
      "En Reportes usa los filtros para encontrar lo que buscas y pulsa «Abrir».",
      "Dentro del reporte, baja hasta el historial para ver quién cambió qué y cuándo.",
      "Si necesitas los datos en un archivo, usa «Exportar Excel».",
    ],
  },
  ROOT: {
    title: "Primeros pasos del administrador raíz",
    intro: "Puedes hacer todo lo que hace el coordinador. Además, administras coordinadores y auditores y ves el historial administrativo.",
    steps: [
      "Entra con tu usuario y tu contraseña.",
      "En Dashboard ves los reportes y las máquinas detenidas, al momento.",
      "En Administración > Usuarios creas coordinadores y auditores, y restableces contraseñas.",
      "En Reportes apruebas o corriges reportes, siempre con un motivo cuando corriges.",
      "En Administración > Historial administrativo ves quién hizo cada cambio en la plataforma.",
    ],
  },
};

export const helpTasks: HelpTask[] = [
  // --- Para todos ---
  {
    id: "entrar",
    title: "Entrar a la plataforma",
    summary: "Usa tu usuario y tu contraseña. Cada persona usa solo su cuenta.",
    roles: ALL,
    steps: [
      "Abre «Iniciar sesión».",
      "Escribe tu usuario. Es el nombre que te dio tu coordinador.",
      "Escribe tu contraseña.",
      "Pulsa «Iniciar sesión».",
    ],
    tip: "Si te equivocas 5 veces seguidas, la cuenta se bloquea 15 minutos. No hay recuperación por correo: pide una contraseña nueva a tu coordinador (operarios) o al administrador raíz (coordinadores y auditores).",
    image: { src: "/ayuda/login.png", alt: "Pantalla para iniciar sesión con usuario y contraseña" },
  },
  {
    id: "mi-cuenta",
    title: "Elegir el formato de hora (24 h o a. m./p. m.)",
    summary: "Cada persona elige cómo ve las horas en el selector de fecha y hora. Solo cambia cómo se ve, no lo que se guarda.",
    roles: ALL,
    steps: [
      "Abre el menú de tu nombre y pulsa «Mi cuenta».",
      "En «Formato de hora» elige «24 horas» o «12 horas (a. m. / p. m.)».",
      "Verás «Preferencia guardada». Desde ahora el selector usa ese formato.",
    ],
    tip: "Con 12 horas aparece un botón «a. m.» / «p. m.» junto a la hora. La preferencia es solo tuya y también funciona sin conexión en este dispositivo. Para cambiar la contraseña usa «Cambiar contraseña» en la misma página.",
  },

  // --- Operario ---
  {
    id: "iniciar-reporte",
    title: "Iniciar un reporte",
    summary: "El reporte es la hoja de tu turno. Empieza uno cada vez que arrancas con una máquina.",
    roles: ["OPERATOR"],
    steps: [
      "Entra a Turno.",
      "En «Máquina asignada», elige tu máquina (si tiene ubicación, la verás junto al nombre).",
      "Pulsa «Iniciar reporte».",
    ],
    tip: "El turno y la fecha los pone el sistema. No los escribes. Solo puedes tener un reporte abierto a la vez: para empezar otro, primero envía o cancela el que tienes. Si ves «Solicita una asignación a tu coordinador», todavía no tienes máquina en este turno.",
    notAllowed: { OPERATOR: "Solo puedes trabajar con las máquinas que te asignaron. No puedes ver ni editar los reportes de otros operarios." },
    image: { src: "/ayuda/turno-iniciar.png", alt: "Pantalla Turno con la lista de máquinas y el botón Iniciar reporte" },
  },
  {
    id: "paradas",
    title: "Paradas de máquina",
    summary: "Una parada es cuando la máquina está detenida. El sistema mide cuánto dura.",
    roles: ["OPERATOR"],
    steps: [
      "Cuando la máquina se detenga, pulsa «Iniciar parada». Es de un solo toque.",
      "Si ya sabes la causa, puedes elegirla antes de pulsar. Si no, déjala para después.",
      "Cuando la máquina arranque otra vez, elige la «Categoría de la parada».",
      "Pulsa «Cerrar parada».",
    ],
    tip: "La categoría es obligatoria para cerrar la parada. Si iniciaste una parada por error, pulsa «Cancelar parada» y escribe el motivo: esa parada no cuenta en los totales. No puedes tener dos paradas abiertas al mismo tiempo.",
    notAllowed: { OPERATOR: "No puedes enviar el reporte si hay una parada abierta o una parada sin categoría." },
    image: { src: "/ayuda/turno-paradas.png", alt: "Sección Paradas de máquina con el botón Iniciar parada" },
  },
  {
    id: "datos-produccion",
    title: "Datos de producción",
    summary: "Aquí escribes lo que se produjo: producto, lote, unidades y desperdicio.",
    roles: ["OPERATOR"],
    steps: [
      "Baja hasta «Datos de producción».",
      "Llena todos los campos. Solo «Observaciones» es opcional.",
      "Revisa los números antes de enviar.",
    ],
    tip: "Los datos se guardan solos mientras escribes. No hay botón de guardar. Los campos que falten se marcan en rojo cuando intentas enviar.",
    image: { src: "/ayuda/turno-datos.png", alt: "Sección Datos de producción con los campos del reporte" },
  },
  {
    id: "cambios",
    title: "Cambios: anota cada cambio de producción",
    summary: "Un cambio es algo que cambia en tu turno: por ejemplo, de producto, de formato o de lote. Aquí dejas constancia de cada uno.",
    roles: ["OPERATOR"],
    steps: [
      "Cuando ocurra el cambio, baja hasta la sección «Cambios».",
      "En «Tipo de cambio», elige de la lista el que corresponde (producto, formato, lote u otro).",
      "En «Descripción», escribe qué cambió. Ejemplo: «de lote 120 a lote 121».",
      "Pulsa «Registrar cambio». El botón está apagado hasta que elijas el tipo y escribas la descripción.",
      "El cambio aparece en la lista, con su hora. Repite estos pasos por cada cambio nuevo.",
    ],
    tip: "Ejemplos de descripción: «de lote 120 a lote 121», «de bolsa de 500 g a bolsa de 1 kg», «de arroz a lentejas».",
    notes: [
      "La hora la pone el sistema con el reloj de tu dispositivo y no se puede editar. Revisa que la hora de tu tableta o celular esté bien.",
      "Sin conexión también funciona: el cambio se guarda en el dispositivo y se sube cuando tú lo confirmes.",
      "El cambio se ve en el detalle del reporte, en el historial y en la hoja CAMBIOS del Excel.",
      "No es lo mismo que una parada. Parada: la máquina está detenida y se mide cuánto dura. Cambio: algo que cambió y solo se anota.",
      "Un cambio registrado no se puede borrar ni editar. Si te equivocaste, explícalo en «Observaciones» y avisa a tu coordinador.",
    ],
    notAllowed: { OPERATOR: "Una vez registrado, no puedes borrar ni editar el cambio ni su hora. Si te equivocaste, explícalo en «Observaciones» y avisa a tu coordinador." },
    image: { src: "/ayuda/turno-cambios.png", alt: "Sección Cambios con Tipo de cambio, Descripción y el botón Registrar cambio" },
  },
  {
    id: "enviar-reporte",
    title: "Enviar el reporte",
    summary: "Envíalo cuando termines el turno para que el coordinador lo revise.",
    roles: ["OPERATOR"],
    steps: [
      "Revisa que no haya ninguna parada abierta.",
      "Revisa que todas las paradas tengan categoría.",
      "Revisa que los datos de producción estén completos.",
      "Pulsa «Enviar reporte» y confirma.",
    ],
    tip: "Si falta algo, la pantalla te marca lo que falta. Si el reporte no sirve, pulsa «Cancelar reporte» y escribe el motivo. Después de enviarlo ya no lo puedes cambiar: si algo quedó mal, avisa a tu coordinador.",
    notAllowed: { OPERATOR: "Después de enviar, no puedes editar el reporte. Tampoco puedes aprobarlo: eso lo hace el coordinador." },
    image: { src: "/ayuda/turno-enviar.png", alt: "Botones Cancelar reporte y Enviar reporte al final de la pantalla Turno" },
  },
  {
    id: "sin-conexion",
    title: "Trabajar sin conexión y «Confirmar y subir»",
    summary: "Si se va el internet, sigue trabajando. Tu trabajo no se pierde.",
    roles: ["OPERATOR"],
    steps: [
      "Arriba verás «Sin conexión». Es normal: sigue llenando el reporte.",
      "Todo se guarda en la tableta, aunque la cierres o se apague.",
      "Cuando vuelva el internet, aparece el resumen de lo pendiente.",
      "Revisa el resumen y pulsa «Confirmar y subir».",
    ],
    tip: "Nada se sube hasta que tú lo confirmes. Si no quieres subirlo todavía, pulsa «Posponer»: todo se conserva y te lo vuelven a ofrecer. Si el internet se corta a la mitad, lo que ya subió queda subido y el resto sigue pendiente; nada se repite. Para entrar sin conexión, tienes que haber entrado con internet en esta misma tableta en los últimos 7 días. Cuando vuelva el internet, entra otra vez con conexión antes de subir. No dejes datos sin subir por muchos días.",
    notAllowed: { OPERATOR: "Sin conexión no puedes ver los reportes de otros ni usar el Excel. Si algo se rechaza al subir, el coordinador lo revisa." },
    image: { src: "/ayuda/turno-sin-conexion.png", alt: "Pantalla Turno con el indicador «Sin conexión» arriba y el panel «¿Necesitas ayuda?» abierto con consejos cortos" },
  },

  // --- Coordinador y raíz ---
  {
    id: "supervisar",
    title: "Ver cómo va la planta",
    summary: "El Dashboard se actualiza solo, sin recargar la página.",
    roles: MANAGERS,
    steps: [
      "Entra a Dashboard.",
      "Mira las tarjetas: en curso, enviados, cerrados, en parada y abiertos fuera de turno.",
      "Pulsa una tarjeta para ver la lista de esos reportes.",
      "Revisa «Máquinas en parada» y «Conflictos» para saber qué atender primero.",
    ],
    tip: "«En línea» de un operario es solo una guía. No lo uses para tomar decisiones.",
    image: { src: "/ayuda/dashboard-coord.png", alt: "Dashboard del coordinador con las tarjetas de reportes" },
  },
  {
    id: "aprobar",
    title: "Aprobar un reporte",
    summary: "Aprueba los reportes que el operario ya envió.",
    roles: MANAGERS,
    steps: [
      "Entra a Reportes y filtra por estado «Enviado».",
      "Pulsa «Abrir» en el reporte.",
      "Revisa los datos, las paradas y los cambios.",
      "Pulsa «Aprobar y cerrar» y confirma.",
    ],
    tip: "El reporte queda cerrado con tu nombre y la fecha. No se puede aprobar un reporte que sigue activo, que está cancelado o que tiene datos en conflicto sin resolver: la pantalla te dice por qué. Para aprobar necesitas conexión.",
    notAllowed: { ADMINISTRATOR: "No puedes editar un reporte que sigue activo: solo lo edita su operario.", ROOT: "No puedes editar un reporte que sigue activo: solo lo edita su operario." },
    image: { src: "/ayuda/reporte-detalle-coord.png", alt: "Detalle de un reporte con el botón Aprobar y cerrar" },
  },
  {
    id: "corregir",
    title: "Corregir un reporte (con motivo)",
    summary: "Corrige datos de un reporte enviado o cerrado. Siempre queda escrito quién y por qué.",
    roles: MANAGERS,
    steps: [
      "Abre un reporte que esté Enviado o Cerrado.",
      "Cambia el dato que está mal y guarda.",
      "En «Corregir reporte», escribe el motivo. Mínimo 5 letras.",
      "Confirma.",
    ],
    tip: "El historial guarda el valor de antes, el de ahora, tu nombre, la fecha y el motivo. Nadie puede borrar ese historial. Para corregir necesitas conexión.",
    notAllowed: { ADMINISTRATOR: "No puedes corregir sin escribir el motivo.", ROOT: "No puedes corregir sin escribir el motivo." },
  },
  {
    id: "conflictos",
    title: "Resolver datos en conflicto",
    summary: "A veces un dato que el operario anotó sin conexión no se puede aplicar. Queda en revisión.",
    roles: MANAGERS,
    steps: [
      "Abre el reporte que tiene el aviso de conflicto.",
      "Lee qué dato quedó en revisión y revisa las horas con criterio.",
      "Pulsa «Marcar revisado» si el dato del servidor está bien.",
      "O pulsa «Aplicar con motivo» si el dato del operario es el correcto, y escribe el motivo.",
    ],
    tip: "No puedes aprobar el reporte mientras haya conflictos sin resolver. Las horas vienen del reloj del dispositivo del operario.",
    notAllowed: { ADMINISTRATOR: "Aplicar con motivo solo funciona en reportes enviados o cerrados.", ROOT: "Aplicar con motivo solo funciona en reportes enviados o cerrados." },
  },
  {
    id: "fuera-de-turno",
    title: "Reporte abierto fuera de turno",
    summary: "Un reporte que sigue activo 2 horas después de terminar el turno aparece como «Abierto fuera de turno».",
    roles: MANAGERS,
    steps: [
      "Busca el reporte en Reportes con el filtro «Abiertos fuera de turno».",
      "Pregunta al operario si todavía lo está llenando.",
      "Si hay que anularlo, pulsa «Cancelar (abierto fuera de turno)» y escribe el motivo.",
    ],
    tip: "Antes de las 2 horas, solo el operario puede cancelar su reporte.",
  },
  {
    id: "administrar",
    title: "Administrar usuarios, máquinas y catálogos",
    summary: "En Administración creas y editas lo que usa la planta.",
    roles: MANAGERS,
    steps: [
      "Entra a Administración.",
      "Elige la sección: Usuarios, Máquinas, Productos, Categorías de parada, Tipos de cambio y las demás.",
      "En Máquinas puedes indicar la ubicación de cada una (por ejemplo, «Planta 2, línea norte»).",
      "Pulsa para crear uno nuevo o edita uno existente.",
      "Para un operario, asígnale sus máquinas por turno. Sin asignación no puede iniciar reporte.",
      "Para una contraseña olvidada, usa «Restablecer contraseña» y dale la nueva al usuario.",
    ],
    tip: "Los «Tipos de cambio» son la lista que ve el operario en la sección Cambios. Si falta uno, créalo aquí. Es mejor desactivar que eliminar: así se conserva el historial. No puedes desactivar a un operario que tiene un reporte activo o datos sin subir. El administrador raíz sí puede forzarlo, pero debe escribir un motivo de al menos 10 caracteres.",
    notAllowed: { ADMINISTRATOR: "No puedes crear ni administrar coordinadores, auditores ni ver el historial administrativo: eso lo hace el administrador raíz." },
    image: { src: "/ayuda/usuarios-coord.png", alt: "Pantalla de Administración, sección Usuarios" },
  },
  {
    id: "exportar",
    title: "Exportar a Excel",
    summary: "Descarga los reportes en un archivo de Excel.",
    roles: READERS,
    steps: [
      "Entra a Reportes.",
      "Pon los filtros que necesitas: fechas, máquina, turno, operario o estado.",
      "Pulsa «Exportar Excel».",
      "Abre el archivo descargado.",
    ],
    tip: "El archivo respeta exactamente los filtros que pusiste. Trae las hojas SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL y CATÁLOGO PARADAS. Si no hay reportes con ese filtro, no se crea el archivo. Si el archivo sale muy grande, la pantalla te pide elegir un período más corto. Para exportar necesitas conexión.",
    image: { src: "/ayuda/reportes-coord.png", alt: "Lista de reportes con filtros y el botón Exportar Excel" },
  },
  {
    id: "consulta-sin-conexion",
    title: "Consultar sin conexión",
    summary: "Sin internet puedes mirar el último resumen que se descargó.",
    roles: READERS,
    steps: [
      "Abre la aplicación aunque no haya conexión.",
      "Entra a «Consulta sin conexión».",
      "Mira la hora que dice «Datos de HH:MM»: así sabes qué tan reciente es.",
    ],
    tip: "Solo puedes leer. Exportar, aprobar, corregir y administrar necesitan conexión y aparecen apagados.",
    notAllowed: { ADMINISTRATOR: "Sin conexión no puedes aprobar, corregir, cancelar ni administrar.", ROOT: "Sin conexión no puedes aprobar, corregir, cancelar ni administrar.", VIEWER: "Sin conexión solo puedes leer. Tampoco puedes exportar." },
    image: { src: "/ayuda/consulta-offline.png", alt: "Pantalla Consulta sin conexión con la hora del último resumen" },
  },

  // --- Auditor ---
  {
    id: "consultar-reportes",
    title: "Consultar reportes",
    summary: "Mira todos los reportes: activos, enviados, cerrados y cancelados.",
    roles: ["VIEWER"],
    steps: [
      "Entra a Reportes.",
      "Usa los filtros: fechas, máquina, turno, operario y estado. Los atajos «Día», «Semana» y «Mes» llenan las fechas por ti.",
      "Pulsa «Abrir» en el reporte que quieres ver.",
      "Baja hasta el historial de cambios: ahí ves quién, cuándo, qué campo, el valor de antes y el de ahora, y el motivo.",
    ],
    tip: "Si alguien modifica el reporte mientras lo miras, el historial se actualiza solo.",
    notAllowed: { VIEWER: "No puedes aprobar, corregir, cancelar ni cambiar nada. Si lo intentas, el sistema lo rechaza." },
    image: { src: "/ayuda/reporte-detalle-auditor.png", alt: "Detalle de un reporte visto por el auditor, sin botones de edición" },
  },

  // --- Raíz ---
  {
    id: "administrar-raiz",
    title: "Administrar coordinadores y auditores",
    summary: "Solo el administrador raíz crea y administra coordinadores y auditores.",
    roles: ["ROOT"],
    steps: [
      "Entra a Administración > Usuarios.",
      "Pulsa para crear un usuario nuevo y elige su rol: Coordinador o Auditor.",
      "Escribe su usuario y una contraseña inicial, y entrégasela en persona.",
      "Para una contraseña olvidada, usa «Restablecer contraseña».",
    ],
    tip: "No puedes desactivar ni retirar tu propia cuenta.",
  },
  {
    id: "historial-admin",
    title: "Historial administrativo",
    summary: "Es el registro de todo lo que se hace en Administración. Solo lo ve el administrador raíz.",
    roles: ["ROOT"],
    steps: [
      "Entra a Administración > Historial administrativo.",
      "Filtra por fecha, por autor o por acción.",
      "Revisa quién creó, editó, desactivó o eliminó cada cosa.",
    ],
    tip: "También aparecen los inicios de sesión sin conexión, cuando llegan con la primera conexión. Nadie puede editar ni borrar este historial, ni siquiera el raíz.",
    notAllowed: { ROOT: "El historial solo se puede mirar y filtrar. Nadie puede editarlo ni borrarlo." },
    image: { src: "/ayuda/historial-root.png", alt: "Pantalla del historial administrativo" },
  },
];

/** Tabla de la sección 12 del manual, en lenguaje sencillo. */
export const helpProblems: HelpProblem[] = [
  { message: "«Usuario o contraseña incorrectos»", action: "Revisa tu usuario y tu contraseña. Si fallas 5 veces seguidas, espera 15 minutos o pide una contraseña nueva.", roles: ALL },
  { message: "«Solicita una asignación a tu coordinador»", action: "No tienes máquina asignada en este turno. Avisa a tu coordinador.", roles: ["OPERATOR"] },
  { message: "«Ya tienes un reporte activo»", action: "Envía o cancela el reporte que tienes abierto antes de empezar otro.", roles: ["OPERATOR"] },
  { message: "No puedo enviar el reporte", action: "Cierra o cancela la parada abierta, ponle categoría a todas las paradas y llena los campos obligatorios.", roles: ["OPERATOR"] },
  { message: "«Necesitas conexión para entrar»", action: "Entra una vez con internet en esta misma tableta. Después podrás entrar sin conexión.", roles: ALL },
  { message: "«Inicia sesión en línea para subir»", action: "Entra con internet para poder pulsar «Confirmar y subir».", roles: ["OPERATOR"] },
  { message: "No puedo exportar a Excel", action: "Revisa que tu rol lo permita y que haya internet. Pon un período más corto y lee el mensaje que aparece.", roles: READERS },
  { message: "No puedo desactivar a un operario", action: "Ese operario tiene un reporte activo o datos sin subir. Espera a que termine y suba todo.", roles: MANAGERS },
];

/** Reglas de qué ve cada rol: tareas propias, con el aviso «qué NO puedes hacer» ya resuelto para ese rol. */
export type HelpTaskView = Omit<HelpTask, "roles" | "notAllowed"> & { limit?: string };

export function problemsForRole(role: AppRole): HelpProblem[] {
  return helpProblems.filter((problem) => problem.roles.includes(role));
}

export function tasksForRole(role: AppRole): HelpTaskView[] {
  return helpTasks
    .filter((task) => task.roles.includes(role))
    .map(({ roles: _roles, notAllowed, ...task }) => ({ ...task, limit: notAllowed?.[role] }));
}

export function firstStepsForRole(role: AppRole): HelpFirstSteps {
  return firstSteps[role];
}

/** Imágenes que usa el contenido de un rol (para el script de capturas y para el PDF). */
export function imagesForRole(role: AppRole): HelpImage[] {
  return tasksForRole(role).flatMap((task) => (task.image ? [task.image] : []));
}
