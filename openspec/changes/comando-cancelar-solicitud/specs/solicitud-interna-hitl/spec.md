> Nota de proceso: mismo criterio sin herramienta de shell documentado en `proposal.md` de este change (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`). Delta copia-completa-y-edita sobre `openspec/changes/hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md:43-61` y `:72-79`, verificado línea por línea. Cubre ADR 125, 126, 127 y 128 de `proposal.md`. Molde de formato: `openspec/changes/comando-reporte-comisiones/specs/comando-empleado-tui/spec.md` (mismo patrón copia-completa-y-edita).
>
> El chequeo de dueño y la restricción a `PENDIENTE` se especifican en detalle en la capability nueva `cancelacion-solicitud-interna` — este delta sólo acota los dos requirements existentes que dejan de ser literalmente ciertos, y agrega el cuarto valor de `SolicitudEstado` (superficie de vocabulario, no de implementación).

# Delta for Solicitud Interna con HITL

## ADDED Requirements

### Requirement: `SolicitudEstado` incorpora `cancelada` como cuarto valor terminal, distinto de `rechazada`

El sistema SHALL extender `SolicitudEstado` con un cuarto valor terminal `SOLICITUD_ESTADO_CANCELADA` ("cancelada"), alcanzable únicamente desde `pendiente_aprobacion_humana`. El sistema SHALL mantener la distinción de auditoría entre una solicitud rechazada por un tercero (`rechazada`, `resuelta_por` = el tercero) y una solicitud retirada por su propio autor (`cancelada`) — SHALL NOT reusar `rechazada` para el segundo caso.

#### Scenario: `cancelada` es un valor válido de `SolicitudEstado`
- GIVEN el tipo `SolicitudEstado`
- WHEN se inspeccionan sus valores posibles
- THEN incluye `"cancelada"` junto a `"pendiente_aprobacion_humana"`, `"aprobada"` y `"rechazada"`

#### Scenario: Una solicitud cancelada se distingue de una rechazada en la auditoría
- GIVEN dos solicitudes, una rechazada por un tercero y otra cancelada por su propio autor
- WHEN se inspeccionan sus filas
- THEN sus valores de `estado` son distintos (`rechazada` vs. `cancelada`), y ninguna reusa la otra

## MODIFIED Requirements

### Requirement: Cualquier empleado autenticado puede resolver (sin jerarquía de aprobación) — excepto retirar la propia solicitud

El sistema SHALL permitir que cualquier empleado con sesión vigente resuelva (`/aprobar-solicitud`/`/rechazar-solicitud`) cualquier solicitud pendiente, sin verificar jerarquía, rol de aprobador ni relación con el solicitante — misma limitación aceptada por ADR 28 de `v1.4.0`. Como única excepción, el sistema SHALL exigir que `/cancelar-solicitud` sólo lo ejecute el propio solicitante (`solicitud.solicitanteId === sesion.empleadoId`); un intento de un empleado distinto SHALL rechazarse sin transicionar la solicitud. El sistema SHALL NOT expresar ese rechazo como un miembro nuevo de `MotivoNoAplicableHitl` (el vocabulario HITL compartido) — se modela localmente en el resultado de este dominio (ADR 126).

(Previously: "sin verificar jerarquía, rol de aprobador ni relación con el solicitante", sin excepción alguna. Esta versión acota la regla — sigue valiendo tal cual para `/aprobar-solicitud`/`/rechazar-solicitud` — y agrega la primera verificación de relación autor↔actor del sistema, sólo para `/cancelar-solicitud`.)

#### Scenario: Un empleado distinto del solicitante puede aprobar
- GIVEN una solicitud creada por el empleado A
- WHEN el empleado B, con sesión vigente propia, confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona a `resuelto` sin verificación adicional de jerarquía

#### Scenario: Un empleado distinto del solicitante NO puede cancelar
- GIVEN una solicitud `pendiente_aprobacion_humana` creada por el empleado A
- WHEN el empleado B, con sesión vigente propia, ejecuta `/cancelar-solicitud <id>`
- THEN el comando se rechaza sin transicionar la solicitud, sin armar `confirmacionPendiente`, y sin exponer el `detalle` de la solicitud ajena en la respuesta

#### Scenario: `hitl-contract.ts` no gana un motivo nuevo por este rechazo
- GIVEN el rechazo de `/cancelar-solicitud` a un empleado que no es el dueño
- WHEN se inspecciona `MotivoNoAplicableHitl` en `hitl-contract.ts`
- THEN conserva exactamente los mismos miembros que antes de este change

### Requirement: Comandos privilegiados de resolución exigen sesión y confirmación en dos pasos — ahora tres comandos

`/aprobar-solicitud <id>`, `/rechazar-solicitud <id>` y `/cancelar-solicitud <id>` SHALL ser comandos privilegiados: exigen `SesionEmpleado` vigente y confirmación en dos pasos con eco, mismo patrón que `/aprobar-reembolso`/`/rechazar-reembolso` de `v1.4.0`. Sin confirmación, cada comando SHALL mostrar el eco de lo que se va a aplicar y SHALL NOT escribir ningún cambio de estado. A diferencia de los otros dos, `/cancelar-solicitud` SHALL sólo poder confirmarse por el propio solicitante.

(Previously: sólo `/aprobar-solicitud` y `/rechazar-solicitud`, sin mención de un sujeto autorizado distinto. Esta versión suma `/cancelar-solicitud` con el mismo patrón de confirmación, pero restringido al dueño.)

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

#### Scenario: El dueño cancela con confirmación en dos pasos, igual que aprobar/rechazar
- GIVEN una solicitud `pendiente_aprobacion_humana` del propio solicitante
- WHEN ejecuta `/cancelar-solicitud <id>` sin confirmación, y luego confirma
- THEN el primer paso muestra el eco sin escribir nada, y la confirmación transiciona la solicitud a `cancelada` con una fila en `registro_acciones_empleado`, ambas en la misma transacción
