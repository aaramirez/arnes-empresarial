> Nota de proceso: sin shell ni `graphify query`. Delta escrito contra `openspec/changes/operaciones-negocio-conversacionales/specs/herramienta-operaciones-negocio/spec.md` (Purpose `:5-11`). **Evaluado y resuelto**: el Purpose dice "habilitado únicamente en el turno de empleado autenticado" sin nombrar el canal web, así que **no se modifica**; sólo se AGREGAN el alcance TUI y D6 (ADR 235). Ni `permisos-granulares` ni `sesiones-web-persistentes` tienen delta sobre esta capability: sin solape. Otros deltas previos de la capability (`aprobacion-conversacional-hitl`, `ergonomia-canal-empleado`, `consulta-kpi-a2a-chat`, etc.) se apilan sin tocar estos requirements. `[SUPUESTO — pendiente de checkpoint]`: D6 acepta la pérdida de `knowledgeFeedback` en turnos TUI autenticados (R6, RD-171, ADR 235).

# Delta for Herramienta Operaciones Negocio

## ADDED Requirements

### Requirement: El servidor `operaciones` se registra en el turno autenticado de la TUI con la misma sesión-por-turno que el chat web

El turno de operaciones de un empleado autenticado en la TUI SHALL usar el mismo handler que el chat web (`buildOnOperacionesEmpleado`), sin cambios a ese handler, con `sesion` cerrada por closure desde la sesión de la TUI (ADR 147 pto 1-2) y un `casoId` nuevo por turno. El servidor `operaciones` SHALL registrarse únicamente en turnos con sesión vigente; en un turno sin sesión SHALL NOT existir, ni por `mcpServers` ni por `allowedTools`.

#### Scenario: El pedido de operaciones desde la TUI ejecuta la tool
- GIVEN un empleado con `/login` vigente en la TUI
- WHEN pide "listá las solicitudes para aprobar" (skill `resolver-solicitud`)
- THEN el turno tiene `mcp__operaciones__operacion_negocio` disponible y la operación se ejecuta

#### Scenario: Sin sesión, la tool no está registrada
- GIVEN una TUI sin sesión vigente
- WHEN se envía el mismo texto
- THEN el turno lo resuelve `onSubmit` sin servidor `operaciones` y sin `OPERACIONES_TOOL_QUALIFIED_NAME` en `allowedTools`

### Requirement: Los turnos de operaciones de la TUI no escriben `knowledgeFeedback`

El turno de operaciones de la TUI SHALL NOT cablear `knowledgeFeedback` (ADR 235). En consecuencia, los turnos TUI autenticados SHALL NOT escribir en `graphify-out/memory`, a diferencia de los turnos sin sesión resueltos por `onSubmit`.

#### Scenario: Turno autenticado no deja feedback
- GIVEN una sesión vigente y un turno de operaciones completado
- WHEN se inspecciona `graphify-out/memory`
- THEN no hay una entrada nueva escrita por ese turno

#### Scenario: Turno sin sesión conserva su comportamiento de feedback
- GIVEN una TUI sin sesión y un turno resuelto por `onSubmit`
- WHEN el turno termina
- THEN el feedback se comporta igual que antes de este change
