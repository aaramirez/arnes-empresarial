> Nota de proceso: delta sobre `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md` — versión vigente de estos dos requirements, no tocados por el delta de `comando-visibilidad-a2a-entrante` (que modificó "Cero archivos existentes de `src/core/` modificados en comportamiento", un requirement distinto). Se copiaron COMPLETOS ambos requirements afectados (`### Requirement:` + todos sus escenarios), verificados línea por línea contra `hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md:15-27` y `:81-93`, y se editaron. Cubre la reformulación anunciada en `proposal.md` (ADR 174, 176): "ausencia de dependencias" pasa a "ausencia de escrituras".

# Delta for Solicitud A2A Entrante

## MODIFIED Requirements

### Requirement: La solicitud entrante usa el mismo Selector de Turno que el Empleado, la TUI y `/soporte` — sin camino de código paralelo

El sistema SHALL traducir una solicitud `SendMessage` aceptada a un turno mediante el mismo `handleTurn(casoId, prompt, deps)` que ya invocan `build-on-submit.ts`, `build-on-activity.ts` y `build-on-soporte.ts`. El sistema SHALL NOT introducir un segundo mecanismo de resolución de turno para solicitudes A2A entrantes. Componer un `mcpServers` con más de un servidor (conocimiento + consultas de negocio, ADR 176) para ese mismo `handleTurn` NO constituye un mecanismo paralelo: sigue siendo una única invocación de `handleTurn` con un `mcpServers` más rico (ADR 91, ADR 176).

(Previously: no distinguía explícitamente que sumar un segundo servidor MCP al `mcpServers` de una misma llamada a `handleTurn` no es un "segundo mecanismo de resolución de turno" — ambigüedad que este change, al introducir el primer caso real de `mcpServers` compuesto, deja resuelta por escrito.)

#### Scenario: El turno entrante se resuelve con `handleTurn`, no con un mecanismo propio
- GIVEN una solicitud A2A entrante aceptada, con su `caso` ya creado
- WHEN el sistema resuelve su turno
- THEN invoca la misma función `handleTurn(casoId, prompt, deps)` que usan los demás puntos de entrada del arnés

#### Scenario: `handle-turn.ts` no gana una rama exclusiva para A2A entrante
- GIVEN el código de `src/core/turn-selector/handle-turn.ts`
- WHEN se inspecciona en busca de una rama condicional específica para solicitudes A2A entrantes
- THEN no existe ninguna — el archivo permanece intacto

#### Scenario: Componer dos servidores MCP no crea una segunda llamada a `handleTurn`
- GIVEN un turno A2A entrante cuyo `mcpServers` combina el servidor de conocimiento y el de consultas de negocio
- WHEN se inspecciona cuántas veces se invoca `handleTurn` para esa solicitud
- THEN es exactamente una vez, con el `mcpServers` compuesto pasado como parte de sus `deps`

### Requirement: El turno entrante es de lectura — no escribe en ningún dominio del arnés, invariante verificable por firma

El composition root de la solicitud entrante SHALL NOT recibir entre sus dependencias ningún puerto de **escritura** del dominio (`board`, store de `actividades`, `escritura`/worktree, `ClienteA2APort` de delegación saliente, `VentaStorePort`, `SolicitudStorePort`, `notifier`, `KeyedQueue`). El invariante se define por la **ausencia de puertos de escritura**, no por un conteo fijo de campos: un noveno campo de sólo lectura (`createConsultas`, ADR 174) es compatible con este requirement sin excepción ni matiz. El turno entrante SHALL NOT crear ni modificar `actividades`, SHALL NOT espejar al tablero, SHALL NOT correr `runActivityTurn`, SHALL NOT despachar la cadena Planner→Developer→Reviewer, y SHALL NOT disparar una delegación A2A saliente (ADR 90 punto 3, ADR 174, ADR 177).

(Previously: la firma se describía implícitamente como fija en ocho campos ["ninguna es un puerto de escritura... [enumeración]"], sin distinguir explícitamente invariante de mecanismo. Esta versión deja escrito que el invariante es la ausencia de escritura, no el conteo de campos — el conteo pasa a nueve, y el invariante se conserva íntegro, ADR 174.)

#### Scenario: Las dependencias del composition root no incluyen puertos de escritura
- GIVEN la firma de `BuildOnA2AEntranteDeps` con sus nueve campos vigentes
- WHEN se inspeccionan sus campos
- THEN ninguno es un puerto de escritura de `actividades`, del tablero, de worktree, de ventas, de solicitudes, `notifier`, `KeyedQueue`, ni un `ClienteA2APort` de delegación saliente

#### Scenario: Un turno entrante no crea actividades ni despacha delegaciones
- GIVEN un turno entrante que completa exitosamente, incluida una invocación exitosa de `consultar_negocio`
- WHEN se inspecciona el estado del dominio después
- THEN no existe ninguna fila nueva en `actividades`, ninguna delegación disparada, ninguna fila nueva ni modificada en `ventas` o `solicitudes_internas`, y el tablero no cambió

#### Scenario: El noveno campo de sólo lectura no reabre el invariante
- GIVEN `BuildOnA2AEntranteDeps` con su noveno campo `createConsultas`
- WHEN se verifica el invariante de este requirement
- THEN sigue siendo verdadero sin excepción — `createConsultas` no es un puerto de escritura
