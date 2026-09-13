> Nota de proceso: sin herramienta de shell disponible, mismo criterio de `proposal.md`. Delta sobre `openspec/changes/comando-cancelar-solicitud/specs/solicitud-interna-hitl/spec.md` — versión vigente confirmada por `proposal.md` ("ya modificada por `comando-cancelar-solicitud`"), no la de `hito-2.0-delegacion-subagentes`. Se copia COMPLETO el requirement afectado (todos sus escenarios) y se edita, workflow MODIFIED. El chequeo de dueño de `/cancelar-solicitud` (self-service, `esAccionAutoservicio`) NO se toca — sigue siendo una pregunta distinta de "¿puede resolver lo ajeno?" (ADR 154 pto 4, confirmado contra el texto vigente de `cancelacion-solicitud-interna`, que no requiere delta). Se agrega además la prohibición de autoaprobación (ADR 155), independiente del gate de rol.

# Delta for Solicitud Interna con HITL

## MODIFIED Requirements

### Requirement: Cualquier empleado autenticado puede resolver (sin jerarquía de aprobación) — excepto retirar la propia solicitud, ni ver el listado ajeno al retirarla, y excepto resolver la ajena sin rol elevado

El sistema SHALL permitir que cualquier empleado con sesión vigente **y rol elevado** (capability `autorizacion-empleado`) resuelva (`/aprobar-solicitud`/`/rechazar-solicitud`) cualquier solicitud pendiente, sin verificar jerarquía ni relación con el solicitante más allá de esa pertenencia de rol. Un empleado con rol base que intente resolver una solicitud SHALL recibir un rechazo por autorización, sin exponer el `detalle` de la solicitud ajena. El listado sigue igual: `/aprobar-solicitud`/`/rechazar-solicitud` sin id SHALL seguir devolviendo el listado global de solicitudes pendientes de toda la organización, con `solicitante`/`detalle` completos, sin filtro de dueño ni de rol — ver la solicitud no requiere rol elevado, sólo resolverla. Como excepción de autoservicio, el sistema SHALL exigir que `/cancelar-solicitud` sólo lo ejecute el propio solicitante (`solicitud.solicitanteId === sesion.empleadoId`), con rol base o elevado indistintamente (capability `cancelacion-solicitud-interna`, no modificada por este change — el gate de rol no aplica a acciones de autoservicio, ADR 154 pto 4). El sistema SHALL NOT expresar el rechazo por rol insuficiente como un miembro nuevo de `MotivoNoAplicableHitl` — se modela localmente en el resultado de este dominio, mismo criterio que el rechazo de dueño (ADR 126).

(Previously: cualquier empleado con sesión vigente podía resolver `aprobar`/`rechazar` sin ninguna verificación de rol — la única restricción existente era la de dueño para `/cancelar-solicitud`. Esta versión agrega la condición de rol elevado para `aprobar`/`rechazar`, sin tocar la excepción de autoservicio de `/cancelar-solicitud` ni el listado global de aprobar/rechazar.)

#### Scenario: Un empleado con rol elevado, distinto del solicitante, puede aprobar
- GIVEN una solicitud creada por el empleado A
- WHEN el empleado B, con sesión vigente propia y rol elevado, confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona a `resuelto`

#### Scenario: Un empleado con rol base no puede aprobar ni rechazar, aunque no sea el solicitante
- GIVEN una solicitud creada por el empleado A, y un empleado B con rol base y sesión vigente
- WHEN B confirma `/aprobar-solicitud <id>`
- THEN la acción se rechaza por autorización, sin exponer el `detalle` de la solicitud, y sin transicionar su estado

#### Scenario: Un empleado distinto del solicitante NO puede cancelar
- GIVEN una solicitud `pendiente_aprobacion_humana` creada por el empleado A
- WHEN el empleado B, con sesión vigente propia, ejecuta `/cancelar-solicitud <id>`
- THEN el comando se rechaza sin transicionar la solicitud, sin armar `confirmacionPendiente`, y sin exponer el `detalle` de la solicitud ajena en la respuesta

#### Scenario: El rol base sí puede cancelar su propia solicitud — el gate de rol no aplica a autoservicio
- GIVEN una solicitud propia `pendiente_aprobacion_humana` de un empleado con rol base
- WHEN ese mismo empleado ejecuta `/cancelar-solicitud <id>` con confirmación
- THEN la solicitud transiciona a `cancelada` con normalidad, sin que el gate de rol la bloquee

#### Scenario: `hitl-contract.ts` no gana un motivo nuevo por el rechazo de rol
- GIVEN el rechazo de `/aprobar-solicitud` a un empleado con rol base
- WHEN se inspecciona `MotivoNoAplicableHitl` en `hitl-contract.ts`
- THEN conserva exactamente los mismos miembros que antes de este change

#### Scenario: `/aprobar-solicitud`/`/rechazar-solicitud` sin id siguen listando toda la organización, sin filtro de dueño ni de rol
- GIVEN hay solicitudes pendientes de varios empleados distintos
- WHEN un empleado con sesión vigente, con cualquier rol, ejecuta `/aprobar-solicitud` o `/rechazar-solicitud` sin id
- THEN el listado devuelto incluye solicitudes de cualquier solicitante, con `solicitante` y `detalle` completos, igual que antes de este change

## ADDED Requirements

### Requirement: Prohibición de autoaprobación, independiente del rol

`aprobar`/`rechazar` una solicitud interna con `solicitud.solicitanteId === sesion.empleadoId` SHALL rechazarse **incluso si el empleado tiene rol elevado**. Esta prohibición SHALL evaluarse con independencia del resultado del gate de rol descrito arriba, y SHALL NOT aplicarse a `/cancelar-solicitud` (que ya exige exactamente esa igualdad para ejecutarse).

#### Scenario: Rol elevado no habilita aprobar la propia solicitud
- GIVEN un empleado con rol elevado que es el `solicitante_id` de una solicitud propia pendiente
- WHEN intenta confirmar `/aprobar-solicitud` sobre esa misma solicitud
- THEN la acción se rechaza, pese a tener rol elevado

#### Scenario: Un administrador aprueba la de otro sin problema
- GIVEN un empleado con rol elevado y una solicitud ajena pendiente
- WHEN confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona a `resuelto` con normalidad
