# Feature Specification: Plataforma de reportes de producción con operación offline y roles separados

**Feature Branch**: `redesign/ui-ux` (sin rama dedicada; el hook `speckit.git.feature` requiere invocación manual)
**Created**: 2026-10-08
**Status**: Draft
**Input**: User description: "El problema es que en una empresa de manufactura y empacado de productos necesita automatizar tareas de reportes de produccion. Los usuarios son el coordinador de produccion, los operarios de produccion y un revisor o auditor de produccion. como coordinador quiero poder ver en tiempo real los reportes activos, enviados, cerrados, de los operarios en linea, descargar reportes en excel, filtrar por rango de fechas, crear, editar, eliminar modificar categorias, usuarios, etc. Como Operario quiero poder iniciar un reporte de produccion de la maquina que tengo asignada en mi turno, paradas y cambios durante el mismo. Como auditor quiero pdoer revisar en tiempo real los reportes y cambios a los reportes que hacen tanto los operarios como los coordinadores. como criterios de aceptacion: la plataforma debe funcionar offline y online. Cuando funcione offline, debe almacenar la informacion y pedir confirmacion antes de subir los datros al servidor cuando vuelva a tener conexion. debe pedir usuario y contraseña al iniciar sesion, los roles deben estar bien definidos y separados: los operarios solo pueden generar reportes. Los coordinadores son administradores en la plataforma, pero debe haber un administrador raiz. Los auditores solo pueden visualizar yd escargar reportes, nunca editar nada."

## Contexto

Una empresa de manufactura y empacado registra la producción de cada máquina por turno. Hoy la
plataforma ya digitaliza parte del proceso, pero no cubre de forma completa tres necesidades del
negocio: (1) que el operario pueda trabajar todo su turno aunque se pierda la conexión en planta,
(2) que exista una jerarquía de administración con un administrador raíz por encima de los
coordinadores, y (3) que el auditor pueda seguir en tiempo real no solo los reportes, sino cada
cambio que hacen operarios y coordinadores. Esta especificación describe el comportamiento completo
esperado de la plataforma para los cuatro roles.

### Roles

| Rol | Puede | Nunca puede |
| --- | --- | --- |
| **Administrador raíz** | Todo lo que puede un coordinador, más crear, editar, desactivar y reactivar coordinadores y auditores, y consultar el historial administrativo. | Ser desactivado o degradado por un coordinador. |
| **Coordinador** | Ver en tiempo real todos los reportes; corregir reportes enviados o cerrados (nunca activos: un reporte activo solo lo ve; únicamente puede cancelarlo, con motivo, si quedó "abierto fuera de turno"); administrar operarios, máquinas, asignaciones y catálogos (categorías); exportar a Excel. | Crear, modificar o desactivar al administrador raíz u otros coordinadores. |
| **Operario** | Iniciar, completar, enviar o cancelar reportes de la máquina que tiene asignada en su turno; registrar paradas y cambios. | Ver reportes de otros operarios, administrar nada, editar reportes ya enviados o cerrados. |
| **Auditor** | Ver en tiempo real todos los reportes y su historial de cambios; descargar reportes en Excel. | Crear, editar, cancelar o eliminar cualquier dato. |

## Clarifications

### Session 2026-10-09

- Q: ¿Modelo de inicio de sesión: nombre de usuario sin correo, mixto o solo correo? → A: Nombre de
  usuario sin correo para todos los roles. El administrador crea la cuenta con usuario y contraseña
  inicial; el restablecimiento de contraseña lo hace un usuario con permiso de administración sobre
  esa cuenta. No hay invitación ni recuperación de contraseña por correo.
- Q: ¿El operario puede crear clientes o productos nuevos desde el reporte? → A: No. El operario solo
  selecciona elementos activos de los catálogos; crear o modificar elementos de catálogo es exclusivo
  del coordinador y del administrador raíz.
- Q: ¿Qué hora es la válida para paradas y cambios: la del servidor o la del dispositivo? → A: La del
  dispositivo en el momento en que el operario registra el evento, tanto online como offline. Además se
  guarda la hora real de llegada al servidor. Si un evento capturado con conexión difiere más de
  5 minutos de su hora de llegada, se marca para revisión del coordinador. El operario no edita
  manualmente esas horas.
- Q: ¿Cuántas máquinas puede operar un operario por turno? → A: Puede tener varias máquinas asignadas
  para su turno, pero solo puede operar una a la vez: como máximo un reporte activo por operario. Al
  enviar o cancelar ese reporte puede iniciar otro, en el mismo turno, para cualquier otra máquina que
  tenga asignada. Una máquina tiene como máximo un reporte activo.
- Q: ¿Qué alcance offline se entrega en esta versión? → A: El alcance completo de la spec, entregado
  en dos fases. Fase 1: un operario con sesión ya iniciada trabaja todo su turno sin conexión
  (FR-012 a FR-019: iniciar, producción, paradas, cambios, enviar y cancelar), con resumen y
  confirmación o aplazamiento de la subida. Fase 2: inicio de sesión sin conexión (FR-006 a FR-006c)
  y consulta offline para coordinadores y auditores (FR-020). La versión se acepta cuando ambas fases
  están completas.
- Q: ¿Quién puede cancelar un reporte? → A: El operario autor, sobre su propio reporte activo y con
  motivo. El coordinador y el administrador raíz no pueden modificar un reporte activo, solo verlo, y
  solo pueden cancelarlo si quedó "abierto fuera de turno" (ver siguiente aclaración). Los reportes enviados o cerrados nunca se cancelan; solo se corrigen.
- Q: ¿Cómo se resuelve un conflicto entre cambios locales del operario y cambios en el servidor? → A:
  Se evita por diseño: mientras un reporte está activo, solo su operario lo modifica (incluida la
  cancelación); coordinador y administrador raíz solo lo visualizan en tiempo real y pueden corregirlo
  únicamente cuando el envío del operario ya llegó al servidor. No existen conflictos de edición
  concurrente sobre un reporte activo.
- Q: ¿Qué pasa con un reporte que su operario deja activo al terminar el turno (abandonado)? → A: Un
  reporte que sigue activo 2 horas después del fin de su turno (margen configurable) queda marcado
  como "abierto fuera de turno".
  Solo su autor o el coordinador (o el administrador raíz) pueden cancelarlo, con motivo obligatorio.
  Esta es la única excepción a que el coordinador no cancele reportes activos; nunca puede editarlos.
- Q: ¿A qué fecha pertenece un reporte para filtros, tablero y Excel? → A: A su fecha operativa, que
  es la fecha en que empieza el turno del reporte; se calcula automáticamente al iniciar el reporte (el
  operario no la escribe). Un turno nocturno del día 9 al 10 pertenece al día 9.
- Q: ¿Quién puede consultar el historial administrativo? → A: Solo el administrador raíz. Coordinadores
  y auditores no lo ven; el auditor ve únicamente el historial de cambios de los reportes.
- Q: ¿Qué pasa si se desactiva un usuario con datos pendientes de subir? → A: No debe poder
  desactivarse. La plataforma bloquea la desactivación si el usuario tiene un reporte activo o si el
  último estado de pendientes informado por alguno de sus dispositivos es mayor que cero. Como el
  servidor no puede conocer dispositivos que nunca reconectaron, antes de desactivar se muestra la
  hora del último contacto del usuario y se exige confirmación; si aun así quedaran datos en un
  dispositivo, el coordinador reactiva temporalmente al usuario y es el propio autor quien los sube.
- Q: ¿Qué pasa si un dispositivo informó pendientes y nunca vuelve a conectarse, bloqueando la
  desactivación del usuario? → A: El administrador raíz puede forzar la desactivación con motivo
  obligatorio; queda auditado y el usuario marcado como "posibles datos sin subir". El coordinador
  sigue bloqueado.
- Q: ¿Desde qué momento un reporte activo cuenta como "abierto fuera de turno"? → A: 2 horas después
  del fin de su turno (margen configurable), para dar tiempo a sincronizar a quien trabajó sin señal.
- Q: ¿Cuándo indica el operario la categoría de una parada? → A: Es opcional al iniciarla y
  obligatoria al cerrarla; no se puede enviar un reporte con paradas sin categoría.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operario registra su turno de producción, incluso sin conexión (Priority: P1)

El operario inicia sesión con su usuario y contraseña, ve la máquina que tiene asignada para su turno
e inicia un reporte de producción. Durante el turno registra la producción, las paradas (inicio,
fin y categoría) y los cambios (por ejemplo, cambio de producto o formato). Si la conexión se pierde,
sigue trabajando con normalidad: todo queda guardado en su dispositivo. Al volver la conexión, la
plataforma le muestra un resumen de lo pendiente y le pide confirmación antes de subirlo.

**Why this priority**: Es la fuente de todos los datos. Sin captura confiable en planta, ningún otro
rol tiene información que revisar, exportar o auditar. La conectividad en planta no es confiable,
por lo que el trabajo offline es parte del flujo principal y no un caso excepcional.

**Independent Test**: Con un usuario operario con máquina asignada, iniciar un reporte, registrar dos
paradas y un cambio, desconectar el dispositivo, registrar una parada más y enviar el reporte,
reconectar, confirmar la subida y verificar que el servidor contiene exactamente esos datos.

**Acceptance Scenarios**:

1. **Given** un operario con sesión iniciada y una máquina asignada en su turno actual, **When** pulsa
   "Iniciar reporte", **Then** se crea un reporte activo para esa máquina y ese turno con fecha/hora
   de inicio y el operario como autor.
2. **Given** un operario sin máquina asignada en su turno actual, **When** intenta iniciar un reporte,
   **Then** la plataforma no lo permite y le indica que debe solicitar una asignación a su coordinador.
3. **Given** un reporte activo, **When** el operario registra una parada con hora de inicio y luego la
   cierra con hora de fin y categoría, **Then** la parada queda registrada con su duración y no puede
   solaparse con otra parada del mismo reporte.
4. **Given** un reporte activo, **When** el operario registra un cambio (de producto, formato u otro
   tipo de cambio de catálogo), **Then** el cambio queda registrado con su hora, tipo y descripción.
5. **Given** un reporte activo y el dispositivo sin conexión, **When** el operario registra producción,
   paradas o cambios, **Then** los datos se guardan en el dispositivo, la pantalla indica claramente
   "Sin conexión — guardado en este dispositivo" y el operario puede seguir trabajando sin bloqueos.
6. **Given** un operario sin conexión, **When** inicia un reporte nuevo para su máquina asignada,
   **Then** el reporte se crea localmente y queda marcado como pendiente de subir.
7. **Given** datos pendientes en el dispositivo y la conexión restablecida, **When** la plataforma
   detecta la conexión, **Then** muestra un resumen de lo pendiente (reportes, paradas, cambios y
   envíos) y no sube nada hasta que el operario pulse "Confirmar y subir".
8. **Given** el resumen de datos pendientes, **When** el operario confirma, **Then** los datos se suben,
   cada elemento se marca como sincronizado y el operario recibe confirmación del resultado.
9. **Given** el resumen de datos pendientes, **When** el operario pospone la subida, **Then** los datos
   permanecen en el dispositivo y la plataforma vuelve a ofrecer la subida más tarde sin perderlos.
10. **Given** un reporte completo, **When** el operario lo envía, **Then** el reporte pasa a estado
    "Enviado" y el operario ya no puede editarlo.

---

### User Story 2 - Coordinador supervisa la operación en tiempo real (Priority: P1)

El coordinador abre un tablero donde ve, sin recargar la página, todos los reportes agrupados por
estado (activos, enviados, cerrados), qué operarios están en línea y qué máquinas están en parada en
ese momento. Puede filtrar por rango de fechas, máquina, turno, operario y estado, abrir un reporte
para ver su detalle y descargar el resultado filtrado en Excel.

**Why this priority**: Es el principal valor para la gerencia: visibilidad inmediata de la planta y
eliminación del trabajo manual de consolidar reportes en hojas de cálculo.

**Independent Test**: Con un coordinador y un operario conectados en paralelo, el operario inicia un
reporte y registra una parada; el coordinador ve ambos eventos aparecer en su tablero sin recargar,
filtra por la fecha de hoy y descarga un Excel que contiene ese reporte.

**Acceptance Scenarios**:

1. **Given** un coordinador en el tablero, **When** un operario inicia, actualiza, envía o cancela un
   reporte, **Then** el cambio se refleja en el tablero del coordinador sin recargar la página.
2. **Given** un coordinador en el tablero, **When** observa la sección de operarios, **Then** ve qué
   operarios tienen sesión activa y conexión en este momento, y cuáles están sin conexión con datos
   pendientes de subir (cuando esa información ya llegó al servidor).
3. **Given** un coordinador, **When** filtra por un rango de fechas (y opcionalmente máquina, turno,
   operario o estado), **Then** solo ve los reportes que cumplen todos los filtros.
4. **Given** una lista filtrada, **When** el coordinador pulsa "Descargar Excel", **Then** obtiene un
   archivo con los reportes, sus paradas, cambios e indicadores de producción que respetan exactamente
   los filtros aplicados.
5. **Given** un reporte enviado, **When** el coordinador lo revisa y pulsa "Aprobar y cerrar",
   **Then** el reporte pasa a estado "Cerrado (aprobado)", queda protegido contra ediciones
   ordinarias y muestra a todos los roles quién lo aprobó y en qué fecha y hora.
6. **Given** un reporte activo, cancelado o con datos en conflicto sin resolver, **When** el
   coordinador intenta aprobarlo, **Then** la plataforma no lo permite e indica el motivo.
7. **Given** un reporte enviado o cerrado con un error, **When** el coordinador lo corrige indicando
   un motivo, **Then** la corrección se guarda y queda registrada en el historial de cambios con el
   valor anterior, el nuevo valor, el autor, la fecha y el motivo.

---

### User Story 3 - Auditor revisa reportes y su historial de cambios (Priority: P2)

El auditor inicia sesión y ve en tiempo real todos los reportes y, para cada uno, una línea de
tiempo con cada cambio hecho por operarios y coordinadores: quién, cuándo, qué campo, valor anterior,
valor nuevo y, si aplica, el motivo y si el dato fue capturado sin conexión. Puede filtrar y
descargar en Excel, pero ningún control de edición está disponible para él.

**Why this priority**: Da trazabilidad y confianza en los datos; depende de que existan reportes
(US1) y correcciones (US2).

**Independent Test**: Con un auditor conectado, un coordinador corrige un reporte; el auditor ve la
corrección aparecer en el historial sin recargar, descarga el Excel y verifica que cualquier intento
de modificación (desde la interfaz o mediante solicitudes directas) es rechazado.

**Acceptance Scenarios**:

1. **Given** un auditor, **When** abre cualquier reporte, **Then** ve su detalle completo y su historial
   de cambios en orden cronológico.
2. **Given** un auditor viendo un reporte, **When** un operario o coordinador modifica ese reporte,
   **Then** el nuevo cambio aparece en el historial del auditor sin recargar la página.
3. **Given** un auditor, **When** filtra por rango de fechas y descarga Excel, **Then** obtiene el
   archivo con los reportes filtrados y, en una hoja aparte, el historial de cambios de esos reportes.
4. **Given** un auditor, **When** intenta crear, editar, cancelar, cerrar o eliminar cualquier dato por
   cualquier vía, **Then** la plataforma rechaza la acción y no se modifica nada.

---

### User Story 4 - Administración de usuarios, máquinas y catálogos con jerarquía raíz (Priority: P2)

El administrador raíz gestiona a coordinadores y auditores. Los coordinadores gestionan operarios,
máquinas, asignaciones de máquina por turno y catálogos (categorías de parada, tipos de cambio,
productos, clientes, turnos, etc.). Los elementos en uso no se borran físicamente: se desactivan
para conservar el histórico.

**Why this priority**: Necesario para operar, pero los catálogos y usuarios cambian con poca
frecuencia y ya existe una base de administración.

**Independent Test**: El administrador raíz crea un coordinador; ese coordinador crea un operario, le
asigna una máquina y un turno, crea una categoría de parada nueva y desactiva otra; el operario ve la
categoría nueva y deja de ver la desactivada; el coordinador no puede modificar al administrador raíz.

**Acceptance Scenarios**:

1. **Given** el administrador raíz, **When** crea un coordinador o auditor con usuario y contraseña
   inicial, **Then** esa persona puede iniciar sesión con el rol asignado.
2. **Given** un coordinador, **When** intenta crear, editar o desactivar un coordinador, un auditor o
   el administrador raíz, **Then** la acción es rechazada.
3. **Given** un coordinador, **When** crea, edita o desactiva un operario, máquina, asignación o
   elemento de catálogo, **Then** el cambio se aplica y queda en el historial administrativo.
4. **Given** una categoría usada por reportes existentes, **When** el coordinador la elimina,
   **Then** la categoría se desactiva (deja de ofrecerse en reportes nuevos) y los reportes históricos
   conservan su valor original.
5. **Given** una categoría sin uso, **When** el coordinador la elimina, **Then** se elimina de forma
   definitiva tras una confirmación explícita.
6. **Given** un usuario desactivado, **When** intenta iniciar sesión, **Then** el acceso es denegado.

---

### User Story 5 - Inicio de sesión seguro y separación estricta de roles (Priority: P1)

Toda persona debe iniciar sesión con usuario y contraseña. Cada rol solo ve las pantallas y
acciones que le corresponden, y las restricciones se aplican también si alguien intenta saltarse la
interfaz.

**Why this priority**: Es un requisito transversal de aceptación; sin él, ninguna historia anterior es
aceptable.

**Independent Test**: Para cada uno de los cuatro roles, iniciar sesión y verificar la lista de
pantallas y acciones disponibles contra la tabla de roles; luego intentar cada acción prohibida de
forma directa y verificar que es rechazada.

**Acceptance Scenarios**:

1. **Given** una persona sin sesión, **When** abre cualquier pantalla de la plataforma, **Then** es
   dirigida al inicio de sesión.
2. **Given** credenciales incorrectas, **When** se intenta iniciar sesión, **Then** se muestra un
   mensaje genérico (sin revelar si el usuario existe) y, tras 5 intentos fallidos seguidos, el
   usuario queda bloqueado temporalmente 15 minutos.
3. **Given** un operario, **When** intenta acceder a administración, a reportes de otros operarios o a
   la exportación a Excel, **Then** el acceso es denegado.
4. **Given** cualquier rol, **When** intenta una acción no permitida para su rol mediante una solicitud
   directa (sin usar la interfaz), **Then** la acción es rechazada y no se modifica ningún dato.

---

### Edge Cases

- **Reporte activo mientras el operario está offline**: nadie más puede modificar el reporte
  (FR-025a), por lo que al reconectar sus datos se suben sin conflicto con cambios de otros roles.
- **Reporte "abierto fuera de turno" cancelado por el coordinador mientras el operario tenía datos
  pendientes**: la cancelación se respeta; al confirmar la subida, los datos pendientes se conservan
  adjuntos al reporte cancelado, marcados "capturado sin conexión, en revisión", sin reactivarlo, y el
  coordinador recibe una notificación.
- **Mismo operario en dos dispositivos**: si el operario modifica el mismo reporte activo desde dos
  dispositivos y ambos tienen datos pendientes, la versión del servidor no se sobrescribe; el operario
  ve un aviso de conflicto con sus datos locales conservados y el coordinador recibe una notificación
  para revisarlo.
- **Asignación revocada durante el offline**: si la asignación de máquina del operario cambia mientras
  está sin conexión, los datos capturados de su turno original se suben igualmente al confirmar,
  marcados como "capturado sin conexión", y el coordinador los ve señalados para revisión.
- **Desactivar un usuario con datos pendientes**: no se permite si el usuario tiene un reporte activo
  o si alguno de sus dispositivos informó pendientes (FR-005a). Si un dispositivo que nunca reconectó
  conserva datos de un usuario ya desactivado, al reconectar se cierra la sesión y los datos quedan
  en el dispositivo sin subirse; el coordinador puede reactivar temporalmente al usuario para que él
  mismo inicie sesión y confirme la subida, que queda marcada para revisión. Nadie más puede subirlos
  (FR-019).
- **Contraseña cambiada mientras el dispositivo estaba offline**: al reconectar, la plataforma revalida
  la identidad; el usuario debe iniciar sesión con la nueva contraseña antes de confirmar la subida.
- **Inicio de sesión offline sin habilitación previa**: un usuario que nunca inició sesión con conexión
  en ese dispositivo, o cuya habilitación offline caducó, recibe un mensaje claro de que necesita
  conexión para entrar.
- **Sesión expirada al volver la conexión**: los datos pendientes se conservan en el dispositivo; el
  operario debe volver a iniciar sesión y luego confirmar la subida. Nunca se pierden por expiración.
- **Dispositivo compartido**: los datos pendientes de un operario no son visibles ni subibles por otro
  usuario que inicie sesión en el mismo dispositivo.
- **Cierre de sesión con datos pendientes**: la plataforma advierte que hay datos sin subir y pide
  confirmación explícita antes de cerrar sesión; los datos permanecen asociados a su autor.
- **Subida parcialmente fallida**: si la conexión cae a mitad de la subida, los elementos ya aceptados
  quedan como sincronizados y el resto sigue pendiente; nunca se duplica un reporte, parada o cambio.
- **Parada abierta al terminar el turno**: no se puede enviar un reporte con una parada sin hora de fin
  ni con paradas sin categoría.
- **Paradas solapadas o con hora de fin anterior a la de inicio**: se rechazan con un mensaje claro,
  tanto online como offline.
- **Reloj del dispositivo desajustado**: las horas registradas offline se conservan tal como las
  capturó el operario, y la hora real de llegada al servidor también queda registrada para auditoría.
- **Datos pendientes de antigüedad excesiva**: si hay datos sin subir con más de 7 días, la plataforma
  muestra un aviso persistente al operario en cada inicio de sesión.
- **Exportación sin resultados**: si el filtro no devuelve reportes, se informa en lugar de generar un
  archivo vacío.
- **Último administrador raíz**: no puede existir la plataforma sin al menos un administrador raíz
  activo; la plataforma impide desactivarlo.

## Requirements *(mandatory)*

### Functional Requirements

#### Autenticación y roles

- **FR-001**: La plataforma MUST exigir usuario y contraseña para acceder a cualquier pantalla o dato.
  El identificador de acceso es un nombre de usuario único asignado por un administrador; ningún rol
  necesita correo electrónico.
- **FR-001a**: La plataforma MUST NOT ofrecer invitación ni recuperación de contraseña por correo; el
  alta (con contraseña inicial) y el restablecimiento de contraseña los realiza un usuario con permiso
  de administración sobre esa cuenta, y quedan registrados en el historial administrativo.
- **FR-002**: La plataforma MUST soportar exactamente cuatro roles: administrador raíz, coordinador,
  operario y auditor, con los permisos definidos en la tabla de roles.
- **FR-003**: La plataforma MUST aplicar los permisos de cada rol en el servidor, de modo que una
  acción no permitida sea rechazada aunque se intente sin usar la interfaz.
- **FR-004**: La plataforma MUST bloquear temporalmente (15 minutos) un usuario tras 5 intentos de
  inicio de sesión fallidos seguidos y mostrar mensajes de error que no revelen si el usuario existe.
- **FR-005**: La plataforma MUST garantizar que siempre exista al menos un administrador raíz activo.
- **FR-005a**: La plataforma MUST impedir desactivar o retirar a un usuario que tenga un reporte activo
  o cuyo último estado informado por cualquiera de sus dispositivos indique datos pendientes de subir.
  Cada dispositivo MUST informar al servidor su número de pendientes y la hora cada vez que tenga
  conexión. Antes de desactivar, la plataforma MUST mostrar la hora del último contacto del usuario y
  exigir una confirmación explícita que advierta que pueden existir datos en dispositivos sin conexión.
  Solo el administrador raíz MAY forzar la desactivación o el retiro pese a ese bloqueo, indicando un
  motivo obligatorio; la acción MUST quedar en el historial administrativo y el usuario MUST quedar
  marcado como "posibles datos sin subir". Los coordinadores MUST NOT poder forzarla.
- **FR-006**: La plataforma MUST permitir iniciar sesión sin conexión con usuario y contraseña a
  cualquier usuario activo que haya iniciado sesión con conexión en ese mismo dispositivo dentro de
  los últimos 7 días. El primer inicio de sesión en un dispositivo MUST requerir conexión.
- **FR-006a**: La verificación offline MUST usar las mismas credenciales que el inicio de sesión
  normal, MUST aplicar también el bloqueo de FR-004 y MUST NOT dejar la contraseña legible en el
  dispositivo.
- **FR-006b**: Al recuperar la conexión, la plataforma MUST revalidar la identidad, el estado activo y
  el rol del usuario antes de ofrecer la subida de datos pendientes; si la revalidación falla, MUST
  cerrar la sesión y conservar los datos pendientes según los casos límite.
- **FR-006c**: Una sesión iniciada sin conexión MUST otorgar únicamente los permisos del rol que tenía
  el usuario en su última verificación con conexión, y MUST quedar registrada como "inicio de sesión
  sin conexión" en el historial de auditoría al sincronizar.

#### Reportes de producción (operario)

- **FR-007**: Los operarios MUST poder iniciar un reporte únicamente para una máquina que tengan
  asignada en su turno vigente.
- **FR-007b**: Al iniciar un reporte, la plataforma MUST asignarle automáticamente el turno vigente en
  ese momento y su fecha operativa (la fecha en que empezó ese turno; p. ej. un turno de 22:00 a 06:00
  iniciado el día 9 pertenece al día 9), también cuando se inicia sin conexión. El operario MUST NOT
  escribir ni modificar la fecha operativa.
- **FR-007a**: Un operario MUST tener como máximo un reporte activo a la vez y una máquina MUST tener
  como máximo un reporte activo. Mientras tenga un reporte activo, el operario MUST NOT poder iniciar
  otro; tras enviarlo o cancelarlo MAY iniciar un nuevo reporte, en el mismo turno, para cualquier
  máquina que tenga asignada. Esta regla MUST aplicarse también a los reportes iniciados sin conexión.
- **FR-008**: Los operarios MUST poder registrar, en un reporte activo, los datos de producción, las
  paradas (hora de inicio, hora de fin, categoría y observación) y los cambios (hora, tipo y
  descripción). La categoría de una parada MAY indicarse al iniciarla y MUST indicarse a más tardar al
  cerrarla; un reporte MUST NOT enviarse con paradas sin categoría.
- **FR-008a**: La hora de inicio y fin de cada parada y la hora de cada cambio MUST ser la del
  dispositivo en el momento en que el operario registra el evento (online u offline); la plataforma
  MUST guardar también la hora de llegada al servidor, MUST marcar para revisión los eventos
  capturados con conexión cuya diferencia con la hora de llegada supere 5 minutos, y el operario
  MUST NOT poder editar manualmente esas horas.
- **FR-009**: La plataforma MUST impedir paradas solapadas, paradas con fin anterior al inicio y el
  envío de un reporte con una parada abierta.
- **FR-010**: Los operarios MUST poder enviar o cancelar (con motivo) sus propios reportes activos, y
  MUST NOT poder editar reportes enviados, cerrados o cancelados.
- **FR-010a**: Un reporte activo MUST poder cancelarlo su operario autor en cualquier momento, con
  motivo. Un reporte que sigue activo 2 horas después del fin de su turno (margen configurable) MUST
  marcarse como "abierto fuera de turno", visible para coordinadores y auditores; solo en ese estado MUST poder cancelarlo también un
  coordinador o el administrador raíz, con motivo obligatorio, con conexión y quedando en el historial
  de cambios. Los auditores MUST NOT cancelar reportes, y los reportes enviados o cerrados MUST NOT
  poder cancelarse por ningún rol.
- **FR-011**: Los operarios MUST ver únicamente sus propios reportes.
- **FR-011a**: En un reporte, los operarios MUST seleccionar cliente, producto y demás valores de
  catálogo únicamente entre los elementos activos, y MUST NOT poder crear ni modificar elementos de
  catálogo por ninguna vía.

#### Operación sin conexión

- **FR-012**: Los operarios MUST poder realizar sin conexión todas las acciones de FR-007 a FR-010
  (iniciar, registrar producción, paradas y cambios, enviar y cancelar) sobre su máquina asignada.
- **FR-013**: La plataforma MUST guardar en el dispositivo cada dato capturado sin conexión de forma
  que sobreviva al cierre de la aplicación, al reinicio del dispositivo y a la expiración de la sesión.
- **FR-014**: La plataforma MUST mostrar en todo momento el estado de conexión y el número de
  elementos pendientes de subir.
- **FR-015**: Al recuperar la conexión, la plataforma MUST mostrar un resumen de los datos pendientes
  y MUST NOT subir nada al servidor hasta que el autor de esos datos confirme explícitamente.
- **FR-016**: El operario MUST poder posponer la subida; los datos pendientes MUST conservarse y la
  plataforma MUST volver a ofrecer la subida.
- **FR-017**: La subida MUST ser segura ante repeticiones e interrupciones: ningún reporte, parada o
  cambio puede duplicarse ni perderse.
- **FR-018**: Si un dato pendiente entra en conflicto con cambios ya presentes en el servidor (solo
  posible cuando el mismo operario usó dos dispositivos, ver FR-025a), la plataforma MUST conservar la
  versión del servidor, conservar la versión local, avisar al operario y notificar al coordinador para
  su revisión.
- **FR-019**: Los datos pendientes de un usuario MUST NOT ser visibles ni subibles por otro usuario en
  el mismo dispositivo.
- **FR-020**: Coordinadores y auditores MUST poder consultar sin conexión la última información
  descargada, claramente marcada con la hora de su última actualización; las acciones de
  administración, corrección, cierre y exportación MUST requerir conexión.

#### Supervisión y gestión (coordinador)

- **FR-021**: Los coordinadores MUST ver todos los reportes agrupados por estado (activo, enviado,
  cerrado, cancelado) con actualización automática sin recargar la página.
- **FR-022**: Los coordinadores MUST ver qué operarios están conectados y qué máquinas están en
  parada en este momento.
- **FR-023**: Los coordinadores y auditores MUST poder filtrar reportes por rango de fechas, máquina,
  turno, operario y estado. Los filtros de fecha, el tablero y la exportación MUST usar la fecha
  operativa del reporte (FR-007b).
- **FR-024**: Los coordinadores (y el administrador raíz) MUST poder aprobar un reporte enviado tras
  revisarlo; aprobarlo lo deja en estado "Cerrado (aprobado)". El flujo de estados es
  Activo → Enviado → Cerrado (aprobado), además de Cancelado.
- **FR-024a**: Un reporte cerrado MUST mostrar en su detalle, en los listados y en el Excel el nombre
  de quien lo aprobó y la fecha y hora de la aprobación.
- **FR-024b**: Solo MUST poder aprobarse reportes en estado Enviado y sin conflictos de sincronización
  pendientes; la aprobación MUST requerir conexión.
- **FR-025**: Los coordinadores MUST poder corregir reportes enviados o cerrados indicando un motivo
  obligatorio.
- **FR-025a**: Un reporte activo (datos, paradas y cambios) MUST poder editarlo únicamente su operario
  autor; coordinadores y administrador raíz MUST NOT editarlo y solo pueden visualizarlo en tiempo real. Un
  reporte enviado sin conexión sigue siendo activo para el servidor hasta que su envío se sube.
- **FR-026**: Los coordinadores MUST poder crear, editar, desactivar, reactivar y eliminar operarios,
  máquinas, asignaciones de máquina por turno y elementos de catálogo (categorías de parada, tipos de
  cambio, productos, clientes, turnos y demás catálogos operativos).
- **FR-027**: Los elementos con historial (usados en algún reporte) MUST desactivarse en lugar de
  eliminarse; los elementos sin uso MAY eliminarse definitivamente tras confirmación explícita.
- **FR-028**: Solo el administrador raíz MUST poder crear, editar, desactivar y reactivar
  coordinadores y auditores.

#### Auditoría (auditor)

- **FR-029**: La plataforma MUST registrar cada creación y modificación de reportes, paradas y cambios,
  y cada acción administrativa, con autor, rol, fecha y hora, campo, valor anterior, valor nuevo,
  motivo (si aplica) e indicador de captura sin conexión con la hora real de llegada al servidor.
- **FR-029a**: El historial administrativo (usuarios, contraseñas, roles, máquinas, asignaciones y
  catálogos) MUST poder consultarlo únicamente el administrador raíz, con filtros por fecha, autor y
  tipo de acción. Coordinadores, operarios y auditores MUST NOT acceder a él por ninguna vía.
- **FR-030**: El historial de cambios MUST ser inalterable: nadie, incluido el administrador raíz,
  puede editarlo ni borrarlo.
- **FR-031**: Los auditores MUST ver todos los reportes y su historial de cambios con actualización
  automática sin recargar la página.
- **FR-032**: Los auditores MUST NOT poder crear, editar, cerrar, cancelar ni eliminar ningún dato.

#### Exportación

- **FR-033**: Coordinadores, administrador raíz y auditores MUST poder descargar en Excel los reportes
  que cumplen los filtros aplicados, incluyendo paradas, cambios e indicadores de producción, y una
  hoja con el historial de cambios de esos reportes.
- **FR-034**: Los operarios MUST NOT poder exportar reportes.

### Key Entities

- **Usuario**: persona con acceso; nombre de usuario único, nombre completo, rol, estado
  (activo/desactivado), fecha de alta y quién lo creó.
- **Máquina**: equipo de producción o empacado; identificador, nombre, área y estado.
- **Turno**: franja horaria de trabajo (por ejemplo, mañana, tarde, noche) con hora de inicio y fin.
- **Asignación**: vincula a un operario con una máquina para un turno y un periodo de vigencia.
- **Reporte de producción**: registro de una máquina en un turno; folio, autor, máquina, turno, fecha
  operativa (fecha de inicio del turno, calculada automáticamente), estado
  (activo, enviado, cerrado/aprobado, cancelado), datos de producción, horas de inicio/fin, origen
  (online/offline), estado de sincronización, y aprobador con fecha y hora de aprobación.
- **Parada**: interrupción dentro de un reporte; hora de inicio, hora de fin, categoría, observación.
- **Cambio**: evento de cambio dentro de un reporte (producto, formato, lote u otro tipo de catálogo);
  hora, tipo, descripción.
- **Catálogo**: listas administrables (categorías de parada, tipos de cambio, productos, clientes,
  turnos); nombre único, estado activo/inactivo.
- **Registro de auditoría**: entrada inalterable por cada cambio sobre reportes o administración.
- **Elemento pendiente de subir**: dato capturado sin conexión en un dispositivo; autor, tipo,
  contenido, hora de captura y estado (pendiente, subido, en conflicto).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un operario puede iniciar un reporte para su máquina asignada en menos de 30 segundos
  desde que inicia sesión.
- **SC-002**: Un operario puede registrar una parada completa (inicio, fin y categoría) en menos de
  20 segundos.
- **SC-003**: El 100 % de los datos capturados sin conexión durante un turno completo (hasta 12 horas)
  se suben al servidor tras la confirmación, sin pérdidas ni duplicados.
- **SC-004**: Ningún dato capturado sin conexión llega al servidor sin una confirmación explícita de
  su autor (0 subidas no confirmadas en pruebas).
- **SC-005**: Los cambios hechos por un operario o coordinador aparecen en el tablero del coordinador
  y en la vista del auditor en menos de 10 segundos cuando ambos tienen conexión.
- **SC-006**: Un coordinador obtiene el Excel de un mes completo de reportes filtrados en menos de
  30 segundos.
- **SC-007**: El 100 % de las acciones prohibidas para cada rol (según la tabla de roles) son
  rechazadas en pruebas, tanto desde la interfaz como mediante solicitudes directas.
- **SC-008**: El 100 % de las modificaciones a reportes y a la administración aparecen en el historial
  de auditoría con autor, fecha, valor anterior y valor nuevo.
- **SC-009**: El tiempo que dedica el coordinador a consolidar los reportes del día se reduce al
  menos un 80 % respecto al proceso actual.
- **SC-010**: Al menos el 90 % de los operarios completa su primer reporte sin ayuda tras una
  capacitación de 15 minutos.
- **SC-011**: El 100 % de los reportes cerrados muestra quién los aprobó y cuándo, en pantalla y en
  el Excel.
- **SC-012**: Un usuario habilitado inicia sesión sin conexión en menos de 15 segundos, y el 100 % de
  los intentos offline de usuarios no habilitados o con credenciales incorrectas es rechazado.

## Assumptions

- La plataforma existente se amplía; se conservan sus capacidades actuales (reportes por máquina,
  paradas, catálogos, exportación a Excel e historial de auditoría) y se ajustan a esta especificación.
- Los roles actuales se corresponden así: "Administrador" → coordinador, "Consulta" → auditor,
  "Operario" → operario. El administrador raíz es un rol nuevo; la primera cuenta raíz se crea durante
  la instalación de la plataforma.
- "Cambios durante el turno" se interpreta como eventos operativos (cambio de producto, formato,
  lote, etc.) registrados dentro del reporte, distintos de las paradas.
- "Eliminar" usuarios significa desactivarlos; los usuarios nunca se borran físicamente, para
  conservar la autoría del histórico.
- El inicio de sesión usa un nombre de usuario asignado por el administrador; los operarios no
  necesitan correo electrónico. El restablecimiento de contraseña lo hace un usuario con permiso de
  administración sobre esa cuenta.
- Un operario puede tener varias máquinas asignadas por turno, pero opera una a la vez: como máximo un
  reporte activo por operario y uno por máquina (ver FR-007a).
- "En tiempo real" significa actualización automática en menos de 10 segundos, sin recargar.
- "Operarios en línea" significa operarios con sesión activa y conexión reciente con el servidor; la
  plataforma no puede conocer el estado de un dispositivo sin conexión hasta que este se reconecta.
- Los dispositivos de planta son tabletas o teléfonos con navegador moderno, posiblemente compartidos
  entre turnos.
- El historial de auditoría y los reportes se conservan indefinidamente (sin política de borrado en
  esta versión).
- La ventana de 7 días para iniciar sesión sin conexión es un valor por defecto configurable; el
  usuario pidió priorizar el acceso offline "en lo posible", y la forma técnica de lograrlo se
  definirá en la fase de planificación.
- Integraciones con otros sistemas (ERP, MES, sensores de máquina) quedan fuera del alcance.
