# Manual de Administración

## 1. Alcance del Administrador

El Administrador consulta todos los reportes visibles para su rol, gestiona usuarios y asignaciones, mantiene los catálogos operativos, realiza las correcciones de reportes que están soportadas y genera exportaciones. La interfaz no reemplaza los controles de autorización y de integridad de la base de datos.

## 2. Gestión de usuarios

### Invitar usuario

En **Administración > Usuarios y asignaciones**, seleccione **Nuevo usuario** e indique:

- Correo electrónico.
- Nombre.
- Rol.

La persona recibe una invitación y configura su propia contraseña. El Administrador no asigna ni conoce esa contraseña. Si el correo ya pertenece a un usuario activo, no se crea otro. Si pertenece a una identidad retirada, debe reactivarse la existente.

### Roles

- **Administrador:** reportes, exportación y administración.
- **Operario:** reportes propios de máquinas asignadas y flujo operativo.
- **Consulta:** lectura de reportes enviados y exportación autorizada.

### Editar usuario

La edición permite actualizar nombre, correo, cargo, rol, estado y asignaciones de máquinas. Un cambio de correo conserva el mismo UUID de Supabase Auth; no crea una identidad de reemplazo. El correo debe estar disponible para esa identidad.

Las máquinas asignadas determinan en cuáles puede crear reportes un Operario. Los demás roles no requieren asignaciones operativas activas.

### Protección de la propia cuenta

El Administrador autenticado no puede degradar su propio rol ni desactivar su propia cuenta mediante este flujo. Estas protecciones reducen el riesgo de perder accidentalmente el acceso administrativo actual.

### Retirar usuario

**Retirar usuario**:

- Conserva el UUID, perfil e historial.
- Bloquea el acceso en Supabase Auth mediante una prohibición.
- Desactiva sus asignaciones.
- Marca el perfil como **Retirado** con metadatos de retiro.
- Registra `REMOVE_USER` en la auditoría administrativa.

No elimina reportes ni sustituye la identidad histórica.

### Reactivar usuario

**Reactivar usuario** utiliza la misma identidad, UUID, correo, contraseña e historial. No envía una nueva invitación ni restablece automáticamente la contraseña. El sistema elimina la prohibición de Auth y limpia el estado formal de retiro.

Para un Operario, seleccione explícitamente las máquinas activas que deben quedar asignadas; las asignaciones anteriores no se restauran automáticamente. La implementación actual permite confirmar sin seleccionar máquinas, por lo que debe revisar esta selección de acuerdo con la operación. Para otros roles no se activan asignaciones de máquina.

## 3. Gestión de máquinas

**Máquinas** permite crear, editar, desactivar, reactivar y solicitar eliminación. Código y nombre no pueden duplicarse bajo las reglas de normalización. Una máquina referenciada por reportes no se elimina. Cuando una eliminación es segura, se retiran sus asignaciones asociadas.

## 4. Productos

**Productos frecuentes** permite crear, editar, desactivar, reactivar y eliminar cuando no existen referencias que lo impidan. Los reportes conservan el nombre de producto registrado como dato histórico.

## 5. Clientes

**Clientes frecuentes** sigue las mismas acciones de catálogo. Los reportes conservan el nombre de cliente registrado como dato histórico.

## 6. Áreas/Líneas

**Áreas / Líneas** clasifica el lugar operativo del reporte. Se puede crear, editar, desactivar, reactivar o eliminar si las referencias históricas lo permiten.

## 7. Tipos de dosificador

**Tipos de dosificador** mantiene los tipos disponibles para el reporte. Admite las acciones comunes de catálogo y respeta referencias históricas.

## 8. Turnos

**Turnos** mantiene nombre y horas de inicio y fin. Admite crear, editar, desactivar, reactivar y eliminar cuando sea válido.

## 9. Categorías de parada

**Categorías de parada** mantiene código numérico, nombre, descripción y estado. El código alimenta las columnas `P-{código}` de la exportación. El código y el nombre no pueden duplicarse; valores como `1` y `01` representan el mismo código numérico.

## 10. Desactivar vs eliminar

**Desactivar** conserva el registro y su identidad para la historia, pero evita su uso normal en nuevas operaciones. **Reactivar** vuelve a habilitar ese mismo registro y no crea uno nuevo.

**Eliminar** intenta retirar físicamente un registro. Las referencias de reportes u otros datos pueden bloquear esta acción. Cuando el registro tiene historia, prefiera desactivar. Nunca recree una variante para evadir una referencia o una restricción de duplicado.

## 11. Prevención de duplicados

La comparación de nombres y códigos:

- Ignora mayúsculas y minúsculas.
- Ignora espacios al principio y al final.
- Conserva espacios internos.
- Conserva diferencias de acentos.
- Incluye registros inactivos.

Por ejemplo, un registro desactivado sigue reservando su nombre y código. Use **Reactivar** en lugar de crear un duplicado. El nombre completo de un usuario no tiene esta restricción; el correo es responsabilidad de la identidad de Supabase Auth.

## 12. Correcciones administrativas de reportes

El Administrador puede abrir los reportes y realizar las correcciones que la pantalla y las reglas actuales permiten. La base de datos protege folio, creador, estados y demás campos inmutables. Las correcciones de campos soportados en reportes **Enviados** o **Cancelados** se registran en `report_audit_log`. El Administrador no crea reportes y la interfaz no ofrece el flujo operativo START/STOP para alterar paradas.

## 13. Auditoría disponible

La auditoría implementada actualmente cubre:

- Cambios administrativos soportados en campos de reportes finalizados, con valor anterior, nuevo, actor y fecha.
- Eliminaciones exitosas de catálogos.
- Retiro de usuario (`REMOVE_USER`).
- Reactivación de usuario (`REACTIVATE_USER`).

No existe evidencia en el repositorio de auditoría completa para inicios de sesión, exportaciones, intentos fallidos, creación/edición/desactivación/reactivación de catálogos, invitaciones, edición normal de usuarios o asignaciones, ni cada acción operativa de reportes. Tampoco existe una pantalla administrativa dedicada para consultar todos los registros de auditoría. No interprete esta cobertura como un historial integral de actividad.
