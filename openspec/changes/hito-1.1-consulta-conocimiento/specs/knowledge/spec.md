# Knowledge Specification

## Purpose

Habilita I2 (Núcleo ↔ Adaptador de Conocimiento): `CONVERSATIONAL_AGENT` consulta el vault de Obsidian vía Graphify a través de una tool MCP in-process, citando la fuente en la respuesta. Cubre los 3 casos de uso de Hito 2 (política interna, consulta gerencial con historial, onboarding) con el mismo mecanismo — el comportamiento observable difiere solo por el dominio de la pregunta, no por código distinto.

**Fuera de alcance**: tabla SQLite nueva para conocimiento, ingesta/actualización del vault (`graphify update`/`build`), segundo agente o ruteo multi-agente, transporte MCP distinto de in-process (sin `McpStdioServerConfig`), nueva `TurnStage` en `turn-error.ts`, `@modelcontextprotocol/sdk` como dependencia directa, cambios de renderizado en la TUI (la cita es texto del modelo).

## Requirements

### Requirement: Contrato de la tool `query_knowledge_base`

El servidor MCP in-process `knowledge` SHALL exponer la tool `query_knowledge_base` con input `{ question: string }` únicamente. La tool SHALL devolver un `CallToolResult` con un único bloque `text`: el stdout crudo de `graphify query "<question>" --graph <ruta> --budget <N>` (líneas `NODE <nombre> [src=... loc=... community=...]`), precedido por una instrucción que obliga a citar `src`/`loc` en la respuesta al empleado. La tool SHALL NOT parsear el output a JSON.

#### Scenario: Consulta con resultados

- GIVEN el vault tiene nodos relevantes a la pregunta
- WHEN el modelo invoca `query_knowledge_base` con `{ question }`
- THEN el `CallToolResult` incluye al menos una línea `NODE ... [src=... loc=...]`
- AND el texto incluye la instrucción de citar la fuente

#### Scenario: Consulta sin resultados relevantes

- GIVEN `graphify query` ejecuta correctamente pero no encuentra nodos relevantes
- WHEN el modelo invoca `query_knowledge_base`
- THEN el `CallToolResult` indica explícitamente que no hay coincidencias relevantes (sin líneas `NODE`)
- AND el turno completa sin excepción

### Requirement: Citación de fuente en la respuesta

Cuando la respuesta del agente se basa en un nodo devuelto por `query_knowledge_base`, el texto de la respuesta MUST incluir el `src` (y `loc` cuando exista) del nodo citado (Meta 3, Escenario de ejecución 2 del arc42).

#### Scenario: Consulta de política interna

- GIVEN un empleado pregunta por una política interna cubierta por el vault
- WHEN `CONVERSATIONAL_AGENT` responde usando un nodo del resultado de `query_knowledge_base`
- THEN la respuesta renderizada en la TUI incluye `src` (y `loc` si el nodo lo trae)

#### Scenario: Consulta gerencial combinando conocimiento e historial

- GIVEN un gerente con turnos previos en la misma sesión pregunta "¿cómo van las ventas?"
- WHEN el turno recupera historial vía I3 y conocimiento vía I2
- THEN la respuesta combina ambas fuentes y cita `src`/`loc` del nodo de conocimiento usado

#### Scenario: Onboarding de empleado nuevo

- GIVEN un empleado nuevo pregunta por el manual de onboarding o políticas de RRHH
- WHEN `CONVERSATIONAL_AGENT` responde usando `query_knowledge_base`
- THEN la respuesta cita `src`/`loc` igual que en los otros dos escenarios, sin código específico de caso de uso

### Requirement: Toolset y system prompt de `CONVERSATIONAL_AGENT`

`CONVERSATIONAL_AGENT` SHALL incluir `mcp__knowledge__query_knowledge_base` en su lista de tools (`options.agents[id].tools`) y su system prompt MUST NOT afirmar que carece de acceso a base de conocimiento.

#### Scenario: Agente habilitado para consultar conocimiento

- GIVEN `CONVERSATIONAL_AGENT` está registrado con el toolset actualizado
- WHEN se arma `Options` vía `toQueryOptions`
- THEN `options.agents[CONVERSATIONAL_AGENT.id].tools` contiene `mcp__knowledge__query_knowledge_base`
- AND `options.mcpServers.knowledge` está registrado

### Requirement: Degradación ante falla del subproceso Graphify

El handler de `query_knowledge_base` SHALL capturar internamente cualquier falla del subproceso `graphify` (binario ausente, `graph.json` inexistente, timeout configurable, exit code ≠ 0) y traducirla a un `CallToolResult` de texto tipo "no hay conocimiento disponible: <motivo>". El handler MUST NOT dejar escapar una excepción no capturada; el turno SHALL completar con una respuesta explícita en vez de fallar.

#### Scenario: Binario `graphify` ausente

- GIVEN `GRAPHIFY_BIN` no resuelve a un ejecutable
- WHEN el modelo invoca `query_knowledge_base`
- THEN el `CallToolResult` indica "no hay conocimiento disponible" con el motivo
- AND el turno se completa y el error queda logueado

#### Scenario: Timeout del subproceso

- GIVEN `graphify query` no responde dentro de `GRAPHIFY_TIMEOUT_MS`
- WHEN el modelo invoca `query_knowledge_base`
- THEN el handler corta la espera, devuelve degradación explícita, y no propaga excepción

### Requirement: Cierre del loop con `graphify save-result`

Al cierre del turno, si se consultó conocimiento, el sistema SHALL invocar `graphify save-result` con los labels de nodos citados, de forma best-effort. Una falla en `save-result` MUST NOT afectar el turno ni alterar la respuesta ya entregada. SHALL NOT invocarse si el turno no consultó conocimiento.

#### Scenario: `save-result` falla tras responder

- GIVEN el turno ya generó y entregó su respuesta citando conocimiento
- WHEN la invocación de `graphify save-result` falla (proceso, timeout, o exit code ≠ 0)
- THEN la falla se loguea y el turno permanece exitoso

### Requirement: Logging correlacionado por `casoId`

Todo intento de consulta a Graphify (inicio, fin con duración y cantidad de nodos, error/timeout, resultado de `save-result`) SHALL loguearse vía `logTurnEvent`, correlacionado por `casoId`.

#### Scenario: Traza de una consulta exitosa

- GIVEN un turno con `casoId` conocido invoca `query_knowledge_base`
- WHEN la consulta a Graphify concluye
- THEN el log registra inicio y fin con duración y cantidad de nodos, ambos bajo el mismo `casoId`
