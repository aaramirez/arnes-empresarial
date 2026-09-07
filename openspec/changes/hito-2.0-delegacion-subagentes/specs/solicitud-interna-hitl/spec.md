> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `despacho-delegacion/spec.md`. Este spec se apoya en `proposal.md` (ADR 42, 43) y en `src/core/commands/comando-empleado.ts`, `src/core/ventas/resolver-escalacion-reembolso.ts` (molde de two-step confirm + CAS) como código real verificado, usados como molde de patrón, no como código heredado.

# Solicitud Interna con HITL Specification

## Purpose

Capability nueva. Cubre el entregable B del hito: alta de una solicitud interna (vacaciones o gasto) por el canal TUI de empleado, validación automática por un subagente, y resolución final (aprobar/rechazar) por un humano autenticado, con confirmación en dos pasos y auditoría append-only. Reusa `parsearComando`, `SesionEmpleado`, el patrón de confirmación en dos pasos con eco y `RegistroAccionesEmpleadoPort` de `v1.4.0`, sin construir un adaptador nuevo. Persiste en tabla propia `solicitudes_internas` (migración `0008`), no en `actividades`.

**Fuera de alcance de este spec**: cualquier adaptador de entrada distinto de la TUI (webhook, formulario web); ejercitar `ACTIVIDAD_TIPO_SOLICITUD_INTERNA` sobre `actividades`; política de quién puede aprobar qué, jerarquía de aprobadores o montos por rol (cualquier empleado autenticado puede resolver, igual que ADR 28 de `v1.4.0`); reintentos del subagente validador; el vocabulario y la forma genérica del resultado HITL (capability `hitl-generico`); reembolsos/R3/ADR 11 (cerrado por `v1.4.0`, no es parte de este hito).

## Requirements

### Requirement: `/solicitar` crea `caso` y `solicitud_interna` en una transacción, con sesión vigente

`/solicitar <tipo> <detalle>` SHALL exigir una `SesionEmpleado` vigente. Un alta válida SHALL crear, en una única transacción, un `caso` y una fila en `solicitudes_internas` (con su propio `caso_id`, sin FK a `proyectos`).

#### Scenario: Alta válida crea caso y solicitud
- GIVEN un empleado con sesión vigente ejecuta `/solicitar vacaciones "una semana en marzo"`
- WHEN el comando se procesa
- THEN se crea un `caso` y una fila `solicitudes_internas` en una única transacción
- AND la fila no requiere ninguna fila de `proyectos`

#### Scenario: `/solicitar` sin sesión vigente se rechaza
- GIVEN no hay sesión vigente en el canal
- WHEN se ejecuta `/solicitar vacaciones "una semana en marzo"`
- THEN el comando se rechaza sin crear `caso` ni `solicitud_interna`

### Requirement: El subagente validador emite un dictamen sin transicionar automáticamente

Tras el alta, el Despachador SHALL delegar al subagente validador (rol dedicado, invocado in-process vía `delegacion-subagentes`) para evaluar si la solicitud está completa y cumple las reglas conocidas. El dictamen del validador SHALL adjuntarse a la solicitud. El sistema SHALL NOT transicionar la solicitud a un estado resuelto de forma automática a partir de ese dictamen.

#### Scenario: La solicitud queda pendiente de aprobación humana tras la validación
- GIVEN una solicitud recién creada
- WHEN el subagente validador emite su dictamen
- THEN la solicitud queda en el estado `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` (`hitl-contract.ts`)
- AND el dictamen del validador queda adjunto, sin que la solicitud pase a `resuelto` por sí sola

#### Scenario: El subagente validador no ve el historial de otras solicitudes
- GIVEN el subagente validador se invoca para una solicitud
- WHEN se construye su `tarea_delegada`
- THEN contiene solo el detalle de esa solicitud, sin el historial de sesión del empleado ni de otras solicitudes

### Requirement: `/aprobar-solicitud` y `/rechazar-solicitud` exigen sesión y confirmación en dos pasos

`/aprobar-solicitud <id>` y `/rechazar-solicitud <id>` SHALL ser comandos privilegiados: exigen `SesionEmpleado` vigente y confirmación en dos pasos con eco, mismo patrón que `/aprobar-reembolso`/`/rechazar-reembolso` de `v1.4.0`. Sin confirmación, el comando SHALL mostrar el eco de lo que se va a aplicar y SHALL NOT escribir ningún cambio de estado.

#### Scenario: Primer paso muestra eco sin aplicar cambios
- GIVEN una solicitud `pendiente_aprobacion_humana` con id conocido
- WHEN un empleado con sesión vigente ejecuta `/aprobar-solicitud <id>` sin confirmación previa
- THEN se muestra el eco de la solicitud a aprobar
- AND no se escribe ningún cambio de estado ni fila de registro

#### Scenario: Confirmación aplica el CAS y deja registro en la misma transacción
- GIVEN el paso anterior de eco ya se mostró
- WHEN el empleado confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona a `CASO_ESTADO_RESUELTO` y se crea una fila en `registro_acciones_empleado`, ambas en la misma transacción

#### Scenario: `/rechazar-solicitud` sin sesión vigente se rechaza
- GIVEN no hay sesión vigente en el canal
- WHEN se ejecuta `/rechazar-solicitud <id>`
- THEN el comando se rechaza, sin listar ni aplicar ningún cambio

### Requirement: Tabla propia `solicitudes_internas`, sin reusar `actividades`

El sistema SHALL persistir la solicitud interna en una tabla propia (`solicitudes_internas`, migración `0008`), no en `actividades`. El sistema SHALL NOT requerir una fila fantasma en `proyectos` para satisfacer una FK de solicitud interna.

#### Scenario: Una solicitud de vacaciones no requiere proyecto
- GIVEN una solicitud de vacaciones sin ningún proyecto asociado
- WHEN se persiste
- THEN la fila en `solicitudes_internas` se crea sin ninguna referencia a `proyectos`

### Requirement: Cualquier empleado autenticado puede resolver (sin jerarquía de aprobación)

El sistema SHALL permitir que cualquier empleado con sesión vigente resuelva (`/aprobar-solicitud`/`/rechazar-solicitud`) cualquier solicitud pendiente, sin verificar jerarquía, rol de aprobador ni relación con el solicitante — misma limitación aceptada por ADR 28 de `v1.4.0`.

#### Scenario: Un empleado distinto del solicitante puede aprobar
- GIVEN una solicitud creada por el empleado A
- WHEN el empleado B, con sesión vigente propia, confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona a `resuelto` sin verificación adicional de jerarquía
