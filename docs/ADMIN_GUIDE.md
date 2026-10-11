# Manual de Administración

## 1. Alcance de los roles de gestión

Hay dos roles de gestión:

- **Administrador raíz (ROOT):** puede hacer todo lo del coordinador y, además, crear, editar, desactivar y reactivar **coordinadores y auditores**, restablecer la contraseña de cualquier usuario, consultar el **historial administrativo** y **forzar** la desactivación de un usuario con datos pendientes. Siempre debe existir al menos un raíz activo; la plataforma impide desactivar al último.
- **Coordinador (ADMINISTRATOR):** gestiona **operarios**, máquinas, asignaciones por turno y catálogos; revisa, aprueba y corrige reportes; cancela reportes abiertos fuera de turno; revisa la cuarentena de sincronización y exporta. **No** puede crear ni editar coordinadores, auditores ni al raíz (la interfaz oculta las acciones y la solicitud directa recibe 403), ni forzar desactivaciones, ni ver el historial administrativo.

La interfaz no reemplaza los controles de autorización y de integridad de la base de datos.

## 2. Gestión de usuarios

En **Administración > Usuarios** seleccione **Nuevo usuario**.

### Alta con contraseña inicial

Indique:

- **Nombre de usuario** (3 a 32 caracteres: letras minúsculas, números, punto, guion y guion bajo). Es único, **no se puede cambiar** y es lo que la persona escribe para iniciar sesión. No hay correo electrónico, invitación ni recuperación por correo.
- Nombre completo y cargo.
- Rol (el coordinador solo ofrece **Operario**).
- **Contraseña inicial** (mínimo 8 caracteres) y su confirmación. Comuníquela a la persona por un canal seguro; el sistema no la guarda en el historial.
- Para un operario: sus **asignaciones** de máquina **por turno**, con vigencia opcional (desde/hasta).

Si el nombre de usuario ya existe, incluso en una cuenta retirada, no se crea otro: reactive la existente. El alta queda en el historial administrativo (`USER_CREATED`).

### Editar usuario

Permite actualizar nombre, cargo, rol (según la matriz), estado y asignaciones. El nombre de usuario no se edita. Al guardar, las asignaciones de máquinas o turnos que ya estén inactivos se desactivan porque no aparecen en el formulario. Las fechas de vigencia de las asignaciones que se conservan no cambian salvo que marque **Aplicar esta vigencia a todas las asignaciones**. Los cambios quedan en el historial administrativo (`UPDATE`, `ASSIGNMENTS_CHANGED`).

### Restablecer contraseña

**Restablecer contraseña** asigna una contraseña nueva (mínimo 8 caracteres). Queda `PASSWORD_RESET` en el historial sin guardar la contraseña. Un coordinador solo puede hacerlo a operarios.

### Asignaciones por turno

Un operario solo puede iniciar reportes para las máquinas que tenga asignadas **en el turno vigente** y dentro de la vigencia de la asignación. Si no tiene ninguna, verá "Solicita una asignación a tu coordinador". Las asignaciones se editan en el formulario del usuario.

### Protección de la propia cuenta

No puede degradar su propio rol ni desactivar su propia cuenta.

### Desactivar o retirar con datos pendientes (FR-005a)

El diálogo muestra **Último contacto**, los pendientes informados por los dispositivos y si el usuario tiene un reporte activo.

- Con un **reporte activo** o **pendientes sin subir** la acción está **bloqueada**: "El usuario tiene datos pendientes de subir o un reporte activo". Espere a que el operario envíe o cancele y suba sus datos.
- Sin reporte activo ni pendientes, debe marcar la advertencia de que pueden existir datos en dispositivos sin conexión.
- Solo el **administrador raíz** puede **Forzar de todos modos**, indicando un motivo (mínimo 10 caracteres). El usuario queda marcado **Posibles datos sin subir** y la acción queda en el historial (`FORCE_DEACTIVATE`).
- Si un dispositivo que nunca reconectó conserva datos de un usuario ya desactivado, al reconectar se cierra la sesión y los datos quedan en el dispositivo. Reactive temporalmente al usuario para que él mismo inicie sesión y suba sus datos (quedarán marcados para revisión); nadie más puede subirlos.

### Retirar y reactivar

**Retirar usuario** conserva UUID, perfil e historial, bloquea el acceso, desactiva las asignaciones, marca el perfil como **Retirado** y registra `REMOVE_USER`. **Reactivar usuario** usa la misma identidad y exige elegir explícitamente las asignaciones que se habilitan (las anteriores no se restauran). Registra `REACTIVATE_USER`.

## 3. Gestión de máquinas

**Máquinas** permite crear, editar, desactivar, reactivar y eliminar. Código y nombre no pueden duplicarse bajo las reglas de normalización. Una máquina con reportes o referencias no se elimina: se **desactiva**.

## 4. Catálogos

Productos, clientes, líneas (áreas), tipos de dosificador, turnos, categorías de parada y **tipos de cambio** siguen las mismas acciones. Los operarios solo pueden **elegir** elementos activos; no crean ni modifican catálogos.

- **Categorías de parada:** código numérico (alimenta las columnas `P-{código}` del Excel), nombre, descripción y estado. `1` y `01` son el mismo código.
- **Tipos de cambio:** vienen sembrados Producto, Formato, Lote y Otro.
- **Turnos:** nombre y horas de inicio y fin; el turno vigente y la fecha operativa de cada reporte se calculan con ellos (un turno que cruza la medianoche pertenece al día en que empieza).

## 5. Eliminar vs. desactivar

**Eliminar** consulta primero el uso: si el elemento está referenciado por reportes u otros datos, se **desactiva** (deja de ofrecerse en reportes nuevos y los históricos conservan su valor); si no tiene uso, se elimina de forma definitiva **tras una confirmación explícita**. **Reactivar** devuelve el mismo registro a uso. Nunca recree una variante para evadir una referencia o un duplicado.

La comparación de nombres y códigos ignora mayúsculas y espacios externos, conserva acentos e incluye registros inactivos.

## 6. Supervisión de reportes

- **Dashboard:** KPI por estado (en curso, enviados, cerrados, cancelados, en parada, abiertos fuera de turno), máquinas en parada, reportes recientes y conflictos de sincronización. Se actualiza **sin recargar**; si el tiempo real no está disponible verá "Actualización automática cada 8 s".
- **Operarios en línea:** "En línea", "En línea con pendientes" o "Sin conexión" (con la última vez). Es **solo indicativo**: un operario podría falsearlo desde su navegador y no se usa para decidir permisos ni desactivaciones.
- **Reportes:** filtros por rango de fechas operativas, máquina, turno, operario y estado, más "Con parada activa" y "Abiertos fuera de turno". Un reporte **Activo** solo se puede ver: lo edita únicamente su operario.

## 7. Aprobación

Un reporte **Enviado** muestra **Aprobar y cerrar**. Al confirmar pasa a **Cerrado (aprobado)** con su aprobador y la fecha y hora, visibles para todos los roles y en el Excel. No se puede aprobar un reporte activo, cancelado o con **conflictos de sincronización abiertos**; la pantalla indica el motivo. La aprobación requiere conexión.

## 8. Correcciones

En un reporte **Enviado** o **Cerrado** puede modificar campos, paradas y cambios; al guardar se abre **Corregir reporte** con el resumen y el **motivo obligatorio** (mínimo 5 caracteres). Cada campo corregido queda en el historial con valor anterior, valor nuevo, autor, rol, fecha y motivo. Las correcciones requieren conexión.

## 9. Reportes abiertos fuera de turno

Un reporte que sigue **Activo** 2 horas después del fin de su turno (margen configurable en `app_settings.off_shift_grace`) aparece como **Abierto fuera de turno** en el dashboard y la lista. Solo entonces el coordinador o el raíz ve **Cancelar (abierto fuera de turno)**, que exige un motivo y cancela también las paradas abiertas. Antes de ese plazo solo puede cancelarlo su operario. Si el operario tenía datos pendientes sin subir, la cancelación se respeta y esos datos llegan después a la cuarentena.

## 10. Cuarentena de sincronización

Los datos capturados sin conexión que no se pueden aplicar (reporte cancelado en el servidor, asignación revocada, dos dispositivos del mismo operario, hora del dispositivo desajustada) se conservan en el reporte como **capturados sin conexión, en revisión** y el coordinador recibe una notificación. En el detalle del reporte:

- **Marcar revisado:** conserva el valor del servidor y libera la aprobación (nota opcional).
- **Aplicar con motivo:** aplica los datos como una corrección (motivo mínimo 5 caracteres; solo reportes enviados o cerrados).

Revise las horas con criterio: provienen del reloj del dispositivo del operario.

## 11. Auditoría disponible

- **Historial del reporte** (coordinador, raíz y auditor): toda creación y modificación de reportes, paradas y cambios por cualquier rol, con autor, rol, fecha, campo, valores, motivo y marca de captura sin conexión (con la hora real de llegada).
- **Historial administrativo** (solo raíz, **Administración > Historial administrativo**, con filtros por fecha, autor y acción): altas, ediciones, desactivaciones, reactivaciones y eliminaciones de usuarios, restablecimientos de contraseña, roles, máquinas, asignaciones, catálogos y ajustes; además `FORCE_DEACTIVATE`, `BOOTSTRAP_ROOT` y los inicios de sesión sin conexión (`OFFLINE_LOGIN`, que llegan en la primera página con conexión, máximo 20 por usuario y hora).
- Nadie, incluido el raíz, puede editar o borrar el historial.

No existe auditoría de lecturas, exportaciones, inicios de sesión en línea ni intentos fallidos.

## 12. Exportación

Raíz, coordinador y auditor pueden **Descargar Excel** con los mismos filtros de la lista. El archivo incluye las hojas SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL y CATÁLOGO PARADAS, con las columnas de aprobación. Si ningún reporte cumple el filtro se informa en lugar de generar un archivo vacío; si se superan los límites (1 000 reportes, 10 000 paradas, 50 000 filas de historial) se pide un período más corto.

## 13. Consulta sin conexión

Sin conexión, coordinadores y auditores ven **Consulta sin conexión** con el último resumen descargado y su hora ("Datos de HH:MM"). Exportar, corregir, aprobar, cancelar y administrar requieren conexión.

## 14. Primer administrador raíz

En un entorno nuevo no existe ningún raíz hasta ejecutar `supabase/bootstrap-root.sql` (ver `DEPLOYMENT.md`). Los administradores anteriores pasan a ser coordinadores al migrar.
