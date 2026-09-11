> Nota de proceso: mismo hook de graphify sin herramienta de shell disponible en este ejecutor (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md`. Se leyó completo `src/core/commands/comando-empleado.ts` (444 líneas — el molde literal de `forma: "id_opcional_propuesta"`, líneas 360-368, y el guard `esComandoPrivilegiado`) y se hizo `grep` de `COMANDO_CONSULTAR_KPI`/`RESULTADO_ATENDIDA`/`comando-privilegiado-sin-sesion` sobre `src/` para confirmar el patrón de auditoría y de guard que sigue este spec. Molde de formato: `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md`.
>
> No hay spec previa de esta capability — es un spec completo, no una delta. La agregación pura del reporte (`agruparReporteMensual`, `formatearReporteMensual`) y el listado de reembolsos pendientes son comportamiento de la capability `reporte-comisiones-mensual`, que este comando invoca sin reimplementar — fuera de alcance de este spec. También fuera de alcance: el guard genérico de privilegio y el ciclo de `/login`/`/logout` (capability `autenticacion-empleado-tui`), el formato exacto del texto del reporte (columnas, anchos, nota de escalación), scheduler/cron (prohibido, ver delta de `reporte-comisiones-mensual`), scoping por vendedor (ADR 120) y modelo de roles (ADR 120, no existe).
>
> **Resolución de la omisión del `periodo`, confirmada contra `comando-empleado.ts`, no asumida**: los comandos `id_opcional*` existentes (`/aprobar-reembolso`, `/aprobar-solicitud`, `/ver-propuesta`) resuelven la omisión del id **listando** las entidades pendientes — pero esa es una decisión del *handler* de cada uno (hay algo que listar: reembolsos/solicitudes/propuestas pendientes), no una regla del parser. El parser, para los tres, hace exactamente lo mismo ante la ausencia (`ventaId`/`solicitudId`/`propuestaId` quedan `undefined` en el retorno, líneas 333-368). `/reporte-comisiones` sigue el mismo parseo (`forma: "id_opcional_periodo"`, `periodo` ausente si no hay resto) pero el handler **no lista periodos** — no hay un conjunto de "periodos pendientes" análogo a reembolsos/solicitudes/propuestas pendientes. ADR 119 punto 3 de `proposal.md` ya fija esto: el handler resuelve `periodo` ausente al mes corriente vía `now().slice(0, 7)`, con `now()` inyectado del dispatcher — no con `new Date()` dentro del parser puro.

# Comando Reporte Comisiones Specification

## Purpose

Capability nueva. Expone el reporte mensual de comisiones (capability `reporte-comisiones-mensual`) como un comando `/reporte-comisiones [periodo]` del Registro de Comandos de la TUI (`comando-empleado-tui`), privilegiado, de solo lectura y sin confirmación en dos pasos. Cubre ADR 116 (la reversión de la condición del ADR 9), ADR 117 (`privilegiado: true` y la fila de auditoría), ADR 119 (la forma `id_opcional_periodo`, el default de periodo y la ausencia de confirmación en dos pasos) de `proposal.md`.

## Requirements

### Requirement: Descriptor `/reporte-comisiones [periodo]` en el Registro, forma `id_opcional_periodo`

El sistema SHALL declarar en `DESCRIPTORES` un descriptor `/reporte-comisiones [periodo]` con `forma: "id_opcional_periodo"` y `privilegiado: true`. `parsearComando` SHALL parsear `periodo` como el primer token del resto de la línea, o ausente si no hay resto — mismo patrón que `id_opcional_propuesta`, sin validar el formato del valor en el parser.

#### Scenario: `/reporte-comisiones 2026-08` se reconoce con el periodo explícito
- GIVEN el texto `/reporte-comisiones 2026-08`
- WHEN `parsearComando` lo procesa
- THEN devuelve `{ tipo: "reporte_comisiones", periodo: "2026-08" }`

#### Scenario: `/reporte-comisiones` sin argumento se reconoce sin periodo
- GIVEN el texto `/reporte-comisiones`
- WHEN `parsearComando` lo procesa
- THEN devuelve `{ tipo: "reporte_comisiones" }`, sin campo `periodo`
- AND `parsearComando` no consulta ningún reloj para producir ese resultado

### Requirement: Comando privilegiado — exige sesión vigente, sin excepción

`/reporte-comisiones` SHALL exigir una `SesionEmpleado` vigente. Sin sesión, el sistema SHALL rechazar el comando antes de cualquier lectura de negocio.

#### Scenario: Sin sesión, el comando se rechaza sin leer nada
- GIVEN no hay sesión vigente
- WHEN se ejecuta `/reporte-comisiones` o `/reporte-comisiones 2026-08`
- THEN la respuesta indica que hace falta `/login`
- AND se registra el evento `comando-privilegiado-sin-sesion`
- AND no se ejecuta ninguna lectura de `ventas`, `comisiones` ni `reembolso_pendiente`, y no se escribe ninguna fila en `registro_acciones_empleado`

### Requirement: Con sesión y periodo explícito, la salida es idéntica a `npm run reporte:mensual`

Con sesión vigente y un `periodo` dado, `/reporte-comisiones periodo` SHALL producir el mismo `responseText` que `npm run reporte:mensual -- --periodo periodo` sobre la misma base, reusando sin transformación `agruparReporteMensual` y `formatearReporteMensual`.

#### Scenario: Mismo periodo, mismo texto que el script
- GIVEN una base con ventas y comisiones de un `periodo` dado, y una sesión vigente
- WHEN se ejecuta `/reporte-comisiones periodo` y, por separado, `npm run reporte:mensual -- --periodo periodo`
- THEN los dos producen exactamente el mismo texto, incluida la sección de reembolsos pendientes

#### Scenario: Periodo sin datos responde con el mismo texto explicativo que el script
- GIVEN un `periodo` sin ventas confirmadas
- WHEN se ejecuta `/reporte-comisiones periodo` con sesión vigente
- THEN la respuesta incluye el mismo texto de "sin comisiones en el periodo" que produce el script, no una tabla vacía sin explicación

### Requirement: `periodo` ausente resuelve al mes corriente con reloj inyectado, no lista periodos disponibles

Si `periodo` está ausente, el handler SHALL resolverlo al mes corriente con `now().slice(0, 7)`, usando el `now()` inyectado del dispatcher. El sistema SHALL NOT invocar `new Date()` para esta resolución, y SHALL NOT responder con un listado de periodos disponibles — a diferencia de `/aprobar-reembolso` u otros `id_opcional*`, no existe un conjunto de "periodos pendientes" que listar.

#### Scenario: Sin argumento, reporta el mes corriente
- GIVEN sesión vigente y un reloj inyectado fijo en `2026-09-10T12:00:00Z`
- WHEN se ejecuta `/reporte-comisiones` sin argumento
- THEN la respuesta es el reporte del periodo `"2026-09"`, calculado con el reloj inyectado

#### Scenario: El default no depende del reloj real del sistema
- GIVEN un test con reloj inyectado distinto del reloj real de la máquina
- WHEN se ejecuta `/reporte-comisiones` sin argumento
- THEN el periodo resuelto corresponde al reloj inyectado, no al reloj real del proceso

### Requirement: El comando no escribe en el núcleo y no gana confirmación en dos pasos

`/reporte-comisiones`, en cualquier desenlace, SHALL NOT modificar `ventas`, `comisiones`, `casos` ni ninguna otra tabla de negocio. El sistema SHALL NOT exigir un segundo paso de confirmación para este comando — es una consulta, no una escritura irreversible.

#### Scenario: Ejecutarlo no cambia ningún dato de negocio
- GIVEN un estado inicial de `ventas`, `comisiones` y `casos`
- WHEN se ejecuta `/reporte-comisiones` con sesión vigente, con o sin `periodo`
- THEN `ventas`, `comisiones` y `casos` quedan idénticas a antes de ejecutarlo

#### Scenario: Un solo mensaje resuelve el comando, sin eco de confirmación previo
- GIVEN sesión vigente
- WHEN se ejecuta `/reporte-comisiones 2026-08`
- THEN la respuesta con el reporte llega en el mismo turno, sin un paso previo que pida confirmar
- AND `confirmacionPendiente` no se activa para este comando

### Requirement: Fila de auditoría en `registro_acciones_empleado`, alineada con `/consultar-kpi`

Toda ejecución exitosa de `/reporte-comisiones` con sesión vigente SHALL dejar una fila en `registro_acciones_empleado` con `comando = COMANDO_REPORTE_COMISIONES` y el `empleado_id` de la sesión, sin requerir migración de esquema. El sistema SHALL alinearse con el comando privilegiado de solo lectura que sí registra (`/consultar-kpi`), no con el que no registra (`/ver-propuesta`).

#### Scenario: Ejecución exitosa deja fila de auditoría
- GIVEN sesión vigente de un `empleadoId` conocido
- WHEN se ejecuta `/reporte-comisiones 2026-08` y produce una respuesta
- THEN existe una fila en `registro_acciones_empleado` con `comando = COMANDO_REPORTE_COMISIONES` y ese `empleado_id`
- AND `venta_id` y `caso_id` de esa fila son `NULL`

#### Scenario: Sin sesión, no hay fila de auditoría (redundante con el guard de privilegio, verificado de nuevo)
- GIVEN no hay sesión vigente
- WHEN se intenta `/reporte-comisiones`
- THEN no se escribe ninguna fila en `registro_acciones_empleado`
