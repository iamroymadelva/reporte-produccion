# Feature Specification: Tablero de Indicadores de Producción

**Feature Branch**: `002-indicators-dashboard` (rama no creada: el hook `speckit.git.feature` no puede ser invocado por el asistente; ejecutarlo manualmente si se desea)  
**Created**: 2026-10-19  
**Status**: Draft  
**Input**: User description: "Tablero de indicadores de producción para la demo con la gerente del cliente. Nueva página «Indicadores» para coordinadores, auditores y administrador raíz, con filtro de rango de fechas, cuatro tarjetas de resumen, gráfica de área de horas de parada por día, barras horizontales por máquina y dona por categoría de parada."

## Clarifications

### Session 2026-10-19

- Q: ¿A qué fecha pertenece una parada (incluida la que cruza la medianoche)? → A: Cuenta completa en la fecha operativa de su reporte; no se reparte entre días.
- Q: ¿Qué reportes cuentan en «Reportes del periodo» y en el porcentaje de aprobados? → A: Solo los enviados y los aprobados; los activos (borradores) y los cancelados quedan fuera de las tarjetas de reportes.
- Q: ¿Cuentan las paradas de reportes activos (borradores) en las horas de parada? → A: No; solo cuentan las paradas de reportes enviados y aprobados, igual que las tarjetas de reportes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver el resumen del periodo en tarjetas (Priority: P1)

Un coordinador, auditor o administrador raíz entra a «Indicadores» desde el menú y ve de inmediato, para los últimos 30 días, cuatro números: reportes del periodo, porcentaje de reportes aprobados, tiempo promedio desde el fin del turno hasta la aprobación (en horas) y horas totales de parada. Puede cambiar el rango a «Últimos 7 días» o «Últimos 3 meses» y todo se actualiza.

**Why this priority**: Es el mensaje central de la demo con la gerente: medir los resultados del piloto (qué tan rápido se aprueban los reportes y cuánto se para). Por sí sola ya entrega valor.

**Independent Test**: Con datos de prueba conocidos, abrir la página como coordinador, verificar los cuatro valores contra un cálculo manual y repetir con cada rango.

**Acceptance Scenarios**:

1. **Given** un coordinador con sesión iniciada, **When** abre «Indicadores», **Then** el filtro muestra «Últimos 30 días» seleccionado y las cuatro tarjetas muestran los valores de ese periodo.
2. **Given** la página abierta, **When** elige «Últimos 7 días», **Then** las tarjetas y todas las gráficas se recalculan para ese rango.
3. **Given** un periodo con reportes aprobados, enviados, activos (borradores) y cancelados, **When** se ven las tarjetas, **Then** los activos y los cancelados no cuentan en «Reportes del periodo» ni en el porcentaje de aprobados.
4. **Given** reportes aprobados en el periodo, **When** se ve el tiempo promedio, **Then** es el promedio de horas entre el fin del turno y la aprobación de cada reporte aprobado.

---

### User Story 2 - Entender dónde y cuándo se para (Priority: P2)

El usuario ve una gráfica de área con las horas de parada por día a lo largo de todo el rango, y una gráfica de barras horizontales con las horas de parada por máquina, ordenadas de mayor a menor, con un máximo de 10 máquinas.

**Why this priority**: Responde «cuándo» y «en qué máquinas» se concentran las paradas; complementa las tarjetas pero depende de ellas para el contexto.

**Independent Test**: Con paradas conocidas en varias máquinas y días, verificar que cada punto/barra coincide con la suma manual y que el orden y el tope de 10 se respetan.

**Acceptance Scenarios**:

1. **Given** un rango elegido, **When** se ve la gráfica de área, **Then** la línea de tiempo cubre todos los días del rango, y los días sin paradas aparecen con 0 horas.
2. **Given** más de 10 máquinas con paradas, **When** se ve la gráfica de barras, **Then** solo aparecen las 10 con más horas, ordenadas de mayor a menor.
3. **Given** el cursor sobre (o un toque en) un punto o barra, **When** se interactúa, **Then** se muestra el valor exacto de horas y la etiqueta (día o máquina).

---

### User Story 3 - Ver la distribución de paradas por categoría (Priority: P3)

El usuario ve una gráfica de dona con el reparto del tiempo de parada por categoría. Las paradas sin categoría aparecen como «Sin categoría». Si hay más de 6 categorías, las de menor tiempo se agrupan en «Otras».

**Why this priority**: Aporta el «por qué» de las paradas; es valiosa pero secundaria frente a las anteriores.

**Independent Test**: Con paradas en 8 categorías más algunas sin categoría, verificar que se muestran 6 segmentos incluyendo «Otras» con la suma de las menores, y que «Sin categoría» aparece correctamente.

**Acceptance Scenarios**:

1. **Given** paradas sin categoría en el periodo, **When** se ve la dona, **Then** su tiempo aparece en un segmento llamado «Sin categoría».
2. **Given** más de 6 categorías con tiempo, **When** se ve la dona, **Then** se muestran las categorías de mayor tiempo y las restantes agrupadas en «Otras», sumando el 100 % del tiempo de parada.
3. **Given** el cursor sobre (o un toque en) un segmento, **When** se interactúa, **Then** se muestra el valor exacto en horas y su porcentaje.

---

### User Story 4 - Acceso restringido y datos según permisos (Priority: P1)

Solo coordinadores, auditores y el administrador raíz ven la opción «Indicadores» en el menú y pueden abrir la página. Los operarios no la ven ni pueden acceder escribiendo la dirección. Cada usuario ve únicamente cifras construidas con los reportes que sus permisos actuales le permiten ver.

**Why this priority**: Es un requisito de seguridad y de coherencia de las cifras; sin esto no se puede mostrar el tablero.

**Independent Test**: Iniciar sesión con cada rol y comprobar visibilidad del menú, acceso directo por dirección y que los totales coinciden con los reportes visibles para ese usuario.

**Acceptance Scenarios**:

1. **Given** un operario, **When** revisa el menú o intenta abrir la dirección de «Indicadores», **Then** no ve la opción y el acceso es denegado.
2. **Given** dos usuarios con alcance de datos distinto, **When** cada uno abre el tablero, **Then** cada cifra refleja solo los reportes visibles para ese usuario.
3. **Given** un usuario cuyos permisos cambian, **When** recarga el tablero, **Then** las cifras reflejan sus permisos actuales.

---

### Edge Cases

- Rango sin ningún reporte: cada gráfica muestra un mensaje claro de «sin datos» y las tarjetas muestran 0 (o «—» para el tiempo promedio si no hay reportes aprobados), nunca valores vacíos o «NaN».
- Reportes en el periodo pero ninguno aprobado: el porcentaje es 0 % y el tiempo promedio muestra «—» (no aplica).
- Paradas abiertas (sin cierre): no se suman hasta que se cierren; al cerrarse, entran al periodo de su reporte.
- Reportes o paradas cancelados: se excluyen de todas las cifras y gráficas.
- Reportes activos (borradores): ni ellos ni sus paradas aparecen en ninguna cifra o gráfica hasta que se envían.
- Reporte cerca de medianoche: el día se determina por la fecha operativa del reporte en hora de Bogotá, no por la hora de registro ni por la zona horaria del navegador.
- Más de 10 máquinas o más de 6 categorías: se aplican el tope y la agrupación «Otras» descritos.
- Parada que cruza la medianoche: se atribuye completa a la fecha operativa de su reporte.
- Pantalla de 375 px de ancho: ninguna gráfica ni tarjeta se desborda ni obliga a desplazarse horizontalmente; las etiquetas siguen siendo legibles.
- Cambio de rango mientras se cargan datos: se indica que está cargando y no se mezclan cifras de rangos distintos.
- Falla al obtener los datos: se muestra un mensaje de error en español con opción de reintentar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST ofrecer una página «Indicadores» accesible desde el menú principal.
- **FR-002**: El sistema MUST mostrar la opción y permitir el acceso solo a coordinadores, auditores y administrador raíz; los operarios MUST NOT verla ni poder abrirla por dirección directa.
- **FR-003**: El sistema MUST ofrecer un filtro de rango con exactamente tres opciones: «Últimos 7 días», «Últimos 30 días» (por defecto) y «Últimos 3 meses», y TODO el contenido de la página MUST responder a él.
- **FR-004**: El sistema MUST mostrar la tarjeta «Reportes del periodo» con el conteo de reportes enviados y aprobados del rango (sin activos/borradores ni cancelados).
- **FR-005**: El sistema MUST mostrar la tarjeta de porcentaje de reportes aprobados: reportes aprobados ÷ reportes del periodo (enviados y aprobados).
- **FR-006**: El sistema MUST mostrar la tarjeta de tiempo promedio, en horas, desde el fin del turno hasta la aprobación del reporte, calculado solo sobre reportes aprobados del periodo.
- **FR-007**: El sistema MUST mostrar la tarjeta de horas totales de parada del periodo.
- **FR-008**: El sistema MUST mostrar una gráfica de área con las horas de parada por día, cubriendo todos los días del rango (los días sin paradas con 0).
- **FR-009**: El sistema MUST mostrar una gráfica de barras horizontales con las horas de parada por máquina, de mayor a menor, con máximo 10 máquinas.
- **FR-010**: El sistema MUST mostrar una gráfica de dona con la distribución del tiempo de parada por categoría, rotulando las paradas sin categoría como «Sin categoría» y agrupando las categorías menores en «Otras» cuando haya más de 6.
- **FR-011**: El sistema MUST agrupar los días y determinar el rango según la fecha operativa del reporte, en hora de Bogotá.
- **FR-012**: El sistema MUST excluir de todas las cifras los reportes cancelados y las paradas canceladas.
- **FR-013**: El sistema MUST excluir las paradas abiertas hasta que se cierren.
- **FR-013b**: El sistema MUST calcular las horas de parada (tarjeta y gráficas) solo con paradas de reportes enviados y aprobados; las paradas de reportes activos (borradores) no cuentan.
- **FR-013a**: El sistema MUST atribuir cada parada completa a la fecha operativa de su reporte, sin repartirla entre días aunque cruce la medianoche.
- **FR-014**: El sistema MUST calcular todas las cifras solo con los datos que los permisos actuales del usuario le permiten ver, sin revelar información de reportes fuera de su alcance.
- **FR-015**: Al pasar el cursor o tocar un elemento de cualquier gráfica, el sistema MUST mostrar su valor exacto.
- **FR-016**: Cuando una gráfica no tenga datos en el rango, el sistema MUST mostrar un mensaje claro en español en lugar de un área vacía.
- **FR-017**: Todo el texto MUST estar en español y los números en formato colombiano (separador de miles con punto, decimales con coma).
- **FR-018**: La página MUST ser usable en 375 px de ancho y en escritorio, en modo claro y oscuro, sin desplazamiento horizontal.
- **FR-019**: El sistema MUST mostrar estados de carga y de error comprensibles al obtener los datos.
- **FR-020**: Quedan fuera de alcance: exportar gráficas, filtros por máquina o turno, actualización en tiempo real y el cálculo de eficiencia de máquinas.

### Key Entities *(include if feature involves data)*

- **Reporte de producción**: registro de un turno con fecha operativa, fin de turno, estado (incluye aprobado y cancelado) y fecha/hora de aprobación; pertenece a una máquina.
- **Parada de máquina**: interrupción dentro de un reporte, con duración, estado (abierta, cerrada, cancelada), máquina y categoría opcional.
- **Categoría de parada**: clasificación opcional de una parada; las paradas sin categoría se agrupan como «Sin categoría».
- **Máquina**: equipo al que pertenecen reportes y paradas; base de la gráfica de barras.
- **Rango de fechas**: una de tres opciones predefinidas, calculada hasta la fecha actual en hora de Bogotá.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario autorizado ve las cuatro tarjetas y las tres gráficas completas en menos de 3 segundos tras abrir la página o cambiar el rango, con volúmenes del piloto.
- **SC-002**: El 100 % de las cifras mostradas coincide con un cálculo manual sobre los mismos datos en una verificación con al menos un conjunto de datos de prueba por rango.
- **SC-003**: El 100 % de los operarios que intenta acceder al tablero (por menú o por dirección directa) es rechazado.
- **SC-004**: En una prueba con dos usuarios de alcance distinto, ningún dato fuera del alcance de cada uno aparece en sus cifras.
- **SC-005**: En la demo, la gerente puede responder «¿qué tan rápido se aprueban los reportes?» y «¿en qué máquina y por qué categoría se pierde más tiempo?» en menos de un minuto, sin ayuda técnica.
- **SC-006**: La página se ve completa y legible, sin desplazamiento horizontal, a 375 px y en escritorio, en modo claro y oscuro.
- **SC-007**: Con un rango sin datos, el 100 % de las gráficas muestra un mensaje explicativo y ninguna queda en blanco.

## Assumptions

- «Últimos 7 días», «Últimos 30 días» y «Últimos 3 meses» incluyen el día actual en hora de Bogotá; «3 meses» equivale a 90 días.
- «Aprobado» corresponde al estado final de aprobación ya existente en el sistema; el tiempo de aprobación usa el fin del turno y la fecha/hora de aprobación ya registrados.
- El porcentaje de aprobados se calcula sobre los reportes enviados y aprobados del periodo; se muestra con formato colombiano y hasta un decimal. Horas con hasta un decimal.
- Una parada abierta o cancelada no aporta horas; una parada cerrada se atribuye a la fecha operativa de su reporte.
- «Coordinadores, auditores y administrador raíz» corresponden a roles ya existentes; los permisos de visibilidad de datos son los ya definidos en el sistema y el tablero los respeta sin ampliarlos.
- Los datos se obtienen al abrir la página o al cambiar el rango (sin actualización automática); el modo sin conexión no aplica a este tablero y no se almacenan datos autenticados en caché.
- Volumen esperado: el del piloto (pocas decenas de máquinas y miles de reportes como máximo en 3 meses).
