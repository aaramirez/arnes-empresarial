# Exploration: Hito 2 — Consulta de conocimiento (Adaptador de Conocimiento / I2)

## Current State

- Hito 1 está completo e implementado end-to-end (`src/main.ts` wirea `bootstrapHarness` → `openDatabase` → `buildOnSubmit`/`handleTurn` → `startTui`). El único agente registrado, `CONVERSATIONAL_AGENT` (`src/core/agents/definitions.ts`), tiene `allowedTools: []` — a propósito, "no tiene acceso a base de conocimiento" está escrito en su propio system prompt.
- `assemble-context.ts` documenta explícitamente que I2 está fuera de alcance de Hito 1 ("Nota de alcance — conocimiento (I2) fuera de alcance").
- El punto de integración real del SDK es `src/core/turn-selector/invoke-model.ts::toQueryOptions(agent, context)` — hoy construye un `Options` (`@anthropic-ai/claude-agent-sdk`) con solo `agent`, `agents[id]`, y `resume` opcional. No conoce `mcpServers` todavía.
- `Options.mcpServers?: Record<string, McpServerConfig>` (confirmado en `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1793`). `McpServerConfig` acepta 4 formas: `McpStdioServerConfig` (subprocess separado por stdio), `McpSSEServerConfig`, `McpHttpServerConfig`, o `McpSdkServerConfigWithInstance` (servidor **in-process**).
- **Hallazgo clave**: el SDK ya expone `createSdkMcpServer()` y `tool()` directamente (`sdk.d.ts:506` y `:8234`), re-exportados desde `@anthropic-ai/claude-agent-sdk` (que a su vez depende de `@modelcontextprotocol/sdk`, ya presente en `node_modules` transitivamente pero **no** en `package.json`). Un MCP server "propio" puede vivir en el mismo proceso Node, sin spawnear un segundo proceso servidor — solo el `graphify query`/`save-result` real sería subprocess.
- Nombre de tool visible para el modelo: `mcp__<serverName>__<toolName>` (confirmado, `sdk.d.ts:48,3865`). Con server `"knowledge"` y tool `"query_knowledge_base"` → `mcp__knowledge__query_knowledge_base`, exactamente lo que iría en `AgentDefinition`/`SdkAgentDefinition.tools`.
- El patrón de restricción de herramientas ya está resuelto por Hito 1 (`invoke-model.ts`): `Options.agents[id].tools` (no `allowedTools` top-level) restringe de verdad el toolset del agente.
- `@modelcontextprotocol/sdk` **no** está en `package.json` (solo dependencia transitiva).
- **Formato real de `graphify query` — CONFIRMADO en vivo contra este repo** (`graphify query "adaptador de conocimiento" --graph graphify-out/graph.json --budget 200`):
  ```
  NODE <nombre> [src=<archivo> loc=<ubicación> community=<id>]
  ```
  El plan (`docs/Plan_Implementacion_Harness_Empresarial.md:144`) tenía razón: sí incluye `community=`. (La referencia estática del skill `graphify` usada por una corrida sin `Bash` de esta misma exploración sugería lo contrario — quedó descartada por esta verificación en vivo.)
- `graphify save-result --question "..." --answer "..." --nodes NODE1 NODE2 [--type ...]` — coincide con lo que el plan asume (no re-verificado en vivo en esta pasada, pendiente de confirmar su forma exacta en `sdd-design` si hace falta).
- Logging: `src/core/logging/turn-logger.ts::logTurnEvent(casoId, event, fields, deps)` es el punto de extensión ya existente (Concepto Transversal 3, correlación por `casoId`), con `deps` inyectable (mismo patrón DI de todo el código). Punto natural para loguear inicio/fin/error del subproceso Graphify.
- Manejo de errores: `src/core/turn-selector/turn-error.ts::TurnFailedError`/`runTurnStage` solo envuelve las 3 etapas del turno (`"context" | "model" | "close"`). La consulta a Graphify **no es una etapa nueva** — ocurre *dentro* de `"model"`, como tool call que el modelo dispara durante el loop de `queryFn`. El error handling del subproceso Graphify debe resolverse dentro del handler de la tool MCP (mismo criterio que `repository.ts` traduciendo errores de SQLite, o `createFileLogWriter` tragando fallas no-responsabilidad-suya).
- Patrón de adaptador ya establecido: `src/adapters/memory/repository.ts` expone funciones concretas, el core define su puerto local (`MemoryContextPort`); `src/adapters/tui/tui-port.ts` define un contrato explícito porque ahí el "puerto" es cómo el adaptador *es llamado*. El Adaptador de Conocimiento se parece más al segundo caso, pero como la conexión es vía `options.mcpServers`, el "puerto" real es el contrato MCP mismo (nombre de tool + schema), no un `interface` TS adicional.
- DI/testing: todo Hito 1 sigue el mismo patrón — parámetro inyectable con default real (`queryFn`, `MemoryContextPort`, `LogTurnEventDeps`, `CloseTurnDeps`). El handler de la tool MCP y la función que invoca `graphify` como subprocess deben seguir el mismo criterio: función `runGraphifyQuery`/`execFn` inyectable, default real con `node:child_process`, tests inyectan un fake — sin pegarle a un binario `graphify` real ni depender de que `graphify-out/graph.json` exista en CI.

## Affected Areas

- `src/core/turn-selector/invoke-model.ts` — `toQueryOptions` necesita crecer para aceptar/registrar `options.mcpServers`; posible cambio de firma de `invokeModel`/`toQueryOptions` para recibir el/los `McpServerConfig` inyectados.
- `src/core/agents/definitions.ts` — `CONVERSATIONAL_AGENT.allowedTools` (hoy `[]`) necesita el nombre MCP calificado (`mcp__knowledge__query_knowledge_base`), o se define un segundo `AgentDefinition` con conocimiento habilitado.
- `src/adapters/knowledge/` (nueva carpeta, confirmada inexistente vía `Glob src/**`) — servidor MCP propio (`createSdkMcpServer` + `tool()`) y wrapper del subproceso `graphify`.
- `package.json` — evaluar si agregar `@modelcontextprotocol/sdk` como dependencia directa es necesario (probablemente no, ver Approaches).
- `src/core/logging/turn-logger.ts` — reusar `logTurnEvent`/`LogTurnEventDeps` para instrumentar el subproceso Graphify.
- `src/core/turn-selector/turn-error.ts` — probablemente necesita un tipo de error propio del adaptador de conocimiento (análogo a `CasoNotFoundError`), no una etapa nueva de `TurnStage`.
- `src/main.ts` / `build-on-submit.ts` — composition root: dónde se construye el `McpServerConfig` (una vez, al arrancar) y cómo llega hasta `invokeModel`.
- `docs/ARC42_Harness_Empresarial.md` (Caja Negra 3, I2, Escenario 2) y `docs/Plan_Implementacion_Harness_Empresarial.md` (Hito 2) — ya tienen el contrato de alto nivel; el "Hallazgo" documentado en el plan (línea 138) ya anticipa que Graphify no habla MCP nativo.

## Approaches

### 1. Servidor MCP separado por stdio (`McpStdioServerConfig`)

Lectura literal de "servidor MCP propio" como proceso independiente, con su propio transporte stdio.

- **Pros**: aislamiento total de proceso; encaja con una lectura literal del arc42.
- **Cons**: doble subprocess por consulta (el server MCP + el `graphify query` que dispara adentro); requiere entrypoint nuevo y gestión de ciclo de vida (spawn/kill); testear el handler exige pasar por el protocolo MCP por stdio incluso en unit tests, o duplicar lógica aparte igual; agrega `@modelcontextprotocol/sdk` como dependencia directa nueva.
- **Effort**: Medium-High

### 2. Servidor MCP in-process (`createSdkMcpServer` + `tool()`) — **recomendado**

Registrado en `options.mcpServers['knowledge']` como `McpSdkServerConfigWithInstance`.

- **Pros**: sin dependencia nueva en `package.json`; un solo límite de proceso real (solo `graphify query`/`save-result` es subprocess); el handler de la tool es una función `async (args) => CallToolResult` normal, testeable directo con Vitest sin protocolo MCP de por medio; sigue el mismo patrón DI ya consistente en todo el repo.
- **Cons**: menos aislamiento físico (mitigable con try/catch interno, mismo criterio que `createFileLogWriter`); requiere justificar ante el Spec Author que "servidor MCP propio" del arc42 no exige un proceso de SO separado — el arc42 no especifica transporte.
- **Effort**: Low-Medium

## Recommendation

Approach 2 (in-process vía `createSdkMcpServer`). Más simple, sin dependencias nuevas, directamente testeable sin tocar un subproceso real (crítico con TDD estricto activo), y respeta el patrón DI uniforme de Hito 1. El arc42 (I2: "servidor MCP propio que envuelve la CLI de Graphify") no exige transporte stdio ni proceso separado. **Decisión de arquitectura real — el Spec Author debe confirmarla explícitamente en la propuesta, no asumirla implícita.**

## Risks

- **Latencia de subproceso dentro de una tool MCP**: `graphify query` puede tardar (carga `graph.json`). El timeout de tool-call MCP (`options.mcpServers[...].timeout`, o `MCP_TOOL_TIMEOUT`) es hard wall-clock sin extensión por progreso — hay que fijar un valor explícito o el default puede cortar consultas legítimas en corpora grandes.
- **`graphify` no instalado / `graph.json` inexistente**: el handler de la tool debe degradar (responder que no hay conocimiento disponible) en vez de tirar una excepción no capturada que rompa el turno completo — mismo criterio que el resto del Núcleo ya fija para manejo de errores.
- **Testing sin pegarle al subproceso real**: requiere el mismo patrón DI ya usado en todo el repo (`execFn`/`runGraphifyQuery` inyectable) — si el Implementer no lo sigue, los tests unitarios de la tool MCP quedan acoplados a que `graphify` esté instalado y `graphify-out/graph.json` exista en CI, rompiendo TDD estricto.
- **`TurnStage`/`TurnFailedError` no cubre la etapa de conocimiento** — hay que decidir explícitamente si se extiende el union type, se define un error propio del adaptador (`KnowledgeQueryError` o similar) manejado dentro del handler MCP, o ambas cosas.
- `graphify save-result` no fue re-verificado en vivo en esta pasada (solo `graphify query`) — confirmar su forma exacta si `sdd-design` lo necesita en detalle.

## Ready for Proposal

Sí. Una sola pregunta abierta real para `sdd-propose`: confirmar la decisión de arquitectura in-process vs. stdio separado (recomendado: in-process). El formato de `graphify query` ya quedó confirmado en vivo en esta pasada (incluye `community=`).
