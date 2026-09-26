> Base verificada: `openspec/specs/` sólo tiene `.gitkeep`. El requirement modificado se copió de `hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md:28-41`. Ningún delta posterior lo toca: `comando-cancelar-solicitud`, `autorizacion-empleado` y `aprobacion-conversacional-hitl` sólo modifican los requirements de resolución, de cancelación y de autoaprobación (`rg "Requirement:" openspec/changes/*/specs/solicitud-interna-hitl`). **Para `sdd-archive`**: fusionar este MODIFIED sobre la base de hito-2.0, conservando el nombre exacto del requirement para que el merge por nombre funcione, y sin perder los MODIFIED de `aprobacion-conversacional-hitl` (versión vigente de los otros dos requirements). Sin shell ni `graphify query` en este ejecutor.

# Delta for Solicitud Interna con HITL

## MODIFIED Requirements

### Requirement: El subagente validador emite un dictamen sin transicionar automáticamente

Tras el alta, el Despachador SHALL delegar al subagente validador (rol dedicado, invocado in-process vía `delegacion-subagentes`) para evaluar si la solicitud está completa y cumple las reglas conocidas. El dictamen del validador SHALL adjuntarse a la solicitud. El sistema SHALL NOT transicionar la solicitud a un estado resuelto de forma automática a partir de ese dictamen. El texto que recibe el validador (su `systemPrompt` y la instrucción de su `tarea_delegada`) SHALL decir que el validador no aprueba ni rechaza, y que esa decisión la toma después una persona autorizada, distinta de quien pidió la solicitud. Ese texto SHALL pedirle que el dictamen no indique comandos, herramientas ni pasos para resolver la solicitud. Ese texto SHALL NOT nombrar ningún comando de la TUI que no esté en el registro de comandos vigente; en particular SHALL NOT nombrar `/aprobar-solicitud` ni `/rechazar-solicitud`, dados de baja por `aprobacion-conversacional-hitl` (ADR 210 pto 1). SHALL NOT nombrar la operación interna `resolver_solicitud` ni un canal concreto. El validador SHALL conservar `allowedTools` vacío y su `description`.
(Previously: no fijaba el texto que recibe el validador. En la práctica, su `systemPrompt` decía que la decisión la tomaba "un empleado autenticado mediante `/aprobar-solicitud` o `/rechazar-solicitud`", dos comandos dados de baja en v3.10.0, y la instrucción de delegación decía "un empleado autenticado", falso desde `autorizacion-empleado`.)

#### Scenario: La solicitud queda pendiente de aprobación humana tras la validación
- GIVEN una solicitud recién creada
- WHEN el subagente validador emite su dictamen
- THEN la solicitud queda en el estado `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` (`hitl-contract.ts`)
- AND el dictamen del validador queda adjunto, sin que la solicitud pase a `resuelto` por sí sola

#### Scenario: El subagente validador no ve el historial de otras solicitudes
- GIVEN el subagente validador se invoca para una solicitud
- WHEN se construye su `tarea_delegada`
- THEN contiene solo el detalle de esa solicitud, sin el historial de sesión del empleado ni de otras solicitudes

#### Scenario: Lo que recibe el validador no nombra comandos retirados
- GIVEN un alta válida de una solicitud de vacaciones
- WHEN el Despachador invoca al validador
- THEN ni el `systemPrompt` del `AgentDefinition` invocado ni la `tarea_delegada` contienen `/aprobar-solicitud` ni `/rechazar-solicitud`
- AND todo token con forma `/comando` de esos dos textos es el `nombre` de algún descriptor de `COMANDOS`

#### Scenario: El validador sabe quién decide y que no debe dar pasos
- GIVEN el `AgentDefinition` del validador (`validador-solicitudes`)
- WHEN se lee su `systemPrompt`
- THEN dice que no aprueba ni rechaza la solicitud
- AND dice que la decisión la toma una persona autorizada, distinta de quien la pidió
- AND le pide que el dictamen no indique comandos, herramientas ni pasos para resolverla
- AND no contiene `resolver_solicitud` ni "empleado autenticado"

#### Scenario: El rol del validador no cambia
- GIVEN el registro de subagentes después de este change
- WHEN se resuelve `validador-solicitudes`
- THEN su `allowedTools` sigue vacío
- AND su `description` es la misma que antes de este change
