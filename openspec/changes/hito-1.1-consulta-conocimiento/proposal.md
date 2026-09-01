# Propuesta: Hito 2 — Consulta de conocimiento (v1.1.0)

**Origen**: [Plan de Implementación, Hito 2](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-2-consulta-de-conocimiento) · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Negra 3, I2, Escenario de ejecución 2 · [exploration.md](exploration.md).

## Intent

Hoy `CONVERSATIONAL_AGENT` tiene `tools: []` y su system prompt declara explícitamente que no accede a base de conocimiento: el arnés conversa y recuerda (Hito 1), pero no puede responder una política interna ni citar de dónde salió la respuesta. Este hito habilita I2 — el único punto del sistema donde se adjunta la **fuente citada** — y con eso hace medible la Meta 3 (Observabilidad): el 100% de las respuestas que consultan I2 incluyen la referencia a la fuente en el texto renderizado.

## Scope

### In Scope

- Adaptador de Conocimiento en `src/adapters/knowledge/`: servidor MCP `knowledge` **in-process** con la tool `query_knowledge_base`, envolviendo la CLI de Graphify.
- Wrapper del subproceso `graphify query` con `execFn` inyectable, timeout explícito y degradación sin excepción.
- Registro del servidor en `options.mcpServers` desde `toQueryOptions` (`src/core/turn-selector/invoke-model.ts`), inyectado desde el composition root.
- Habilitar `mcp__knowledge__query_knowledge_base` en el toolset de `CONVERSATIONAL_AGENT` y corregir su system prompt (hoy afirma lo contrario).
- Cierre del loop con `graphify save-result` post-respuesta, best-effort.
- Configuración del adaptador por el punto único de env ya existente (`GRAPHIFY_BIN`, `GRAPHIFY_GRAPH_PATH`, `GRAPHIFY_BUDGET`, `GRAPHIFY_TIMEOUT_MS`).
- Extensión de `logTurnEvent` con eventos del subproceso Graphify, correlacionados por `casoId`.
- Los 3 casos de uso del plan (política interna, consulta gerencial con historial, onboarding) — **mismo adaptador, distinto dominio de pregunta**: no hay código por caso de uso, se verifican como escenarios de aceptación.

### Out of Scope

- Tabla SQLite nueva o migración: el estado del conocimiento vive en `graphify-out/`, fuera de nuestra base (fijado por el plan).
- Ingesta/actualización del vault (`graphify update`, `graphify build`) y todo lo relativo a mantener el grafo.
- Segundo agente, ruteo multi-agente, A2A, subagentes (v2+).
- Nueva `TurnStage` en `turn-error.ts`: la consulta ocurre *dentro* de la etapa `"model"`, como tool call.
- `@modelcontextprotocol/sdk` como dependencia directa en `package.json`.
- Cambios de renderizado en la TUI: la cita la emite el modelo como texto.

## Capabilities

### New Capabilities

- `knowledge-query`: consulta a la base de conocimiento vía tool MCP con fuente citable, degradación ante Graphify no disponible, y cierre del loop de feedback.

### Modified Capabilities

- None (`openspec/specs/` aún no tiene specs consolidadas; el cambio de toolset y system prompt de `CONVERSATIONAL_AGENT` se especifica dentro de `knowledge-query`).

## Decisión de arquitectura confirmada — servidor MCP in-process

**Se confirma el Approach 2 de la exploración**: `createSdkMcpServer()` + `tool()` (ya re-exportados por `@anthropic-ai/claude-agent-sdk`), registrados en `options.mcpServers['knowledge']` como `McpSdkServerConfigWithInstance`. Se descarta `McpStdioServerConfig`.

| Criterio | In-process (elegido) | Stdio separado |
|---|---|---|
| Dependencias | ninguna nueva | `@modelcontextprotocol/sdk` directa |
| Límites de proceso por consulta | 1 (`graphify`) | 2 (server MCP + `graphify`) |
| Testabilidad con TDD estricto | handler = `async (args) => CallToolResult`, test directo en Vitest | exige protocolo por stdio o duplicar lógica |
| Consistencia con Hito 1 | mismo patrón DI (`queryFn`, `MemoryContextPort`, `LogTurnEventDeps`) | ciclo de vida spawn/kill nuevo |

El arc42 (I2) exige "un servidor MCP propio que envuelve la CLI de Graphify"; **no especifica transporte ni proceso de SO separado**. La decisión no reabre ninguna regla no negociable de `AGENTS.md`. El aislamiento que se pierde se compensa con `try/catch` total en el handler (mismo criterio que `createFileLogWriter`). Amerita ADR en `sdd-design`.

## Approach

**Contrato de la tool** (nombre calificado visible al modelo: `mcp__knowledge__query_knowledge_base`):

- **Input**: `{ question: string }` únicamente. `budget`, ruta del grafo y binario salen de configuración, no del modelo — superficie mínima y comportamiento determinista.
- **Output**: `CallToolResult` con un solo bloque `text` = stdout crudo de `graphify query` (líneas `NODE <nombre> [src=... loc=... community=...]`), precedido por una línea de instrucción que obliga a citar `src` (y `loc` cuando exista) en la respuesta al empleado. **No se parsea a JSON** — el plan ya fija que el texto se devuelve tal cual.
- La cita viaja como texto en la respuesta del agente; I2 no impone formato estructurado de salida.

**Toolset — se extiende `CONVERSATIONAL_AGENT`, no se crea un agente nuevo.** Los 3 casos de uso son el mismo adaptador con distinto dominio de pregunta: un segundo `AgentDefinition` anticiparía ruteo multi-agente, que pertenece a v2 (swarm) y mantendría trivial-pero-bifurcado el Selector de Turno sin ganancia funcional en este hito. La restricción real sigue siendo `options.agents[id].tools` (patrón ya resuelto en Hito 1), no `allowedTools` top-level.

**Cierre del loop.** `graphify save-result --question --answer --nodes <labels citados>` se invoca **después** de que el modelo produjo la respuesta, en el cierre de turno (junto a la escritura I3 / hooks post-turno), no dentro del handler de la tool — dentro no existe todavía la respuesta. El handler registra los labels devueltos para ese `casoId`; si el turno no consultó conocimiento, no se invoca. Es **best-effort**: su falla se loguea y nunca afecta el turno ni la respuesta ya entregada. El core no importa el adaptador: la función se inyecta desde el composition root, igual que `MemoryContextPort`.

**Errores y degradación.** Binario ausente, `graph.json` inexistente, exit code ≠ 0 o timeout se capturan **dentro del handler** y se traducen a un `CallToolResult` de texto del tipo "no hay conocimiento disponible: <motivo>", para que el modelo responda igual aclarando que no pudo consultar el vault. Nunca escapa una excepción no capturada al loop de `queryFn` ni se rompe el turno. Error propio del adaptador (`KnowledgeQueryError` o similar), sin tocar el union `TurnStage`. El timeout se fija explícito y configurable, no se delega al default de MCP.

**Logging.** Se reusa `logTurnEvent(casoId, event, fields, deps)` — no se crea un logger nuevo. Eventos nuevos: inicio, fin con duración y cantidad de nodos, error/timeout, y el resultado de `save-result`. Mantiene la correlación por `casoId` que el arc42 exige para que la trazabilidad sea real (Deuda 5).

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/adapters/knowledge/` | New | Servidor MCP in-process, tool handler, wrapper de subproceso |
| `src/core/turn-selector/invoke-model.ts` | Modified | `toQueryOptions` acepta y registra `mcpServers` |
| `src/core/agents/definitions.ts` | Modified | Toolset + system prompt de `CONVERSATIONAL_AGENT` |
| `src/core/logging/turn-logger.ts` | Modified | Eventos del adaptador de conocimiento |
| `src/core/config/env.ts` | Modified | Variables `GRAPHIFY_*` en el punto único de carga |
| `src/main.ts`, `build-on-submit.ts` | Modified | Composition root: construcción y wiring del server + `save-result` |
| cierre de turno (I3/hooks) | Modified | Disparo best-effort de `save-result` |

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| Timeout MCP corta consultas legítimas (`graph.json` grande) | Med | Timeout explícito y configurable; medir en la verificación manual |
| Tests acoplados a `graphify` instalado / `graph.json` en CI | Med | `execFn` inyectable obligatorio, fake en tests (TDD estricto) |
| Forma exacta de `graphify save-result` no reverificada en vivo | Med | `sdd-design` la confirma antes de implementar; el loop es best-effort |
| El modelo no cita la fuente aunque la reciba | Med | Instrucción en el output de la tool + system prompt; criterio de aceptación explícito |
| `mcpServers` altera el comportamiento del turno de Hito 1 | Baja | Sin tool habilitada el turno es idéntico; regresión cubierta por los tests existentes |

## Rollback Plan

El cambio es aditivo y sin migración de datos. Revertir = quitar `mcp__knowledge__query_knowledge_base` del toolset de `CONVERSATIONAL_AGENT` (vuelve a `[]`) y no pasar `mcpServers` en `toQueryOptions`; el comportamiento vuelve exacto al de Hito 1 sin tocar SQLite ni `graphify-out/`. A nivel git: revertir los commits de la rama `hito/v1.1-consulta-conocimiento` antes del merge a `main`.

## Dependencies

- Binario `graphify` instalado y `graphify-out/graph.json` generado en el entorno de demo (no requerido en CI, por el `execFn` inyectable).
- Hito 1 cerrado (`v1.0.0`) — ya lo está.
- Checkpoint humano de `AGENTS.md` aprobando spec + diseño + tareas antes de crear la rama del hito.

## Success Criteria

- [ ] El agente responde una consulta de política interna **citando `src`/`loc`** del vault (Escenario de ejecución 2 del arc42) — entregable funcional del hito.
- [ ] Los 3 casos de uso del plan se demuestran con el mismo adaptador; el gerencial combina conocimiento (I2) e historial (I3).
- [ ] Con `graphify` ausente o `graph.json` inexistente, el turno completa con una respuesta de "no hay conocimiento disponible" y **sin excepción no capturada**.
- [ ] `graphify save-result` se invoca tras responder y su falla no afecta el turno.
- [ ] Los logs del subproceso Graphify salen por `logTurnEvent` correlacionados por `casoId`.
- [ ] `npm test` y `npm run typecheck` en verde; tests del handler MCP sin tocar el binario real.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v1.1-consulta-conocimiento/` con evidencia, tag `v1.1.0`.
