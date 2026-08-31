# Hito 2 — Consulta de conocimiento: desglose de tareas

**Spec y diseño de origen** (no se duplican acá): [`specs/knowledge/spec.md`](specs/knowledge/spec.md), [`design.md`](design.md) (ADR 3, ADR 3.1, ADR 4).

**Entregable funcional a demostrar**: el agente responde una consulta de política interna citando `src`/`loc` del vault (Escenario de ejecución 2 del arc42); los 3 casos de uso del plan se demuestran con el mismo adaptador; degradación sin excepción no capturada.

**Metodología**: TDD estricto en toda tarea con lógica de negocio (1, 2, 4, 5, 6, 7, 8, 9, 10, 11) — el commit de cada tarea incluye su test, escrito antes que la implementación. Excepciones: tarea 3 (una línea en `package.json`), tarea 12 (verificación manual).

**Nota de precedencia**: los nombres de archivo, firmas, constantes y argv de esta lista provienen literal de `design.md` — no se reinterpretan.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1250 (12 tasks, 5 archivos nuevos de adaptador + 4 archivos de núcleo modificados) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 6 unidades de trabajo (ver tabla abajo) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — ver nota AGENTS.md abajo |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

**Nota para la decisión de `chain_strategy`**: `AGENTS.md` fija que todo el hito vive en una sola rama (`hito/v1.1-consulta-conocimiento`) y que solo el humano mergea esa rama a `main` una vez, al cierre. Esto favorece **`feature-branch-chain`** (PRs de revisión encadenados contra la rama del hito, un solo merge final a `main`) sobre `stacked-to-main` (que asume merges intermedios a `main`). Queda como recomendación, no decisión — el humano confirma.

### Suggested Work Units

| Unit | Goal | Tasks | Est. lines | Base branch |
|------|------|-------|-----------|-------------|
| 1 | Contrato de núcleo + config + dependencia | 1–3 | ~150 | `hito/v1.1-consulta-conocimiento` |
| 2 | Wrapper CLI de Graphify | 4 | ~280 | Unit 1 |
| 3 | Parseo de nodos + handler MCP | 5–6 | ~340 | Unit 2 |
| 4 | Fachada del adaptador (`index.ts`) | 7 | ~180 | Unit 3 |
| 5 | Wiring del núcleo (invoke-model, handle-turn, definitions) | 8–10 | ~245 | Unit 4 |
| 6 | Composition root + verificación manual | 11–12 | ~70 | Unit 5 |

## Tareas

1. **`src/core/knowledge/knowledge-contract.ts`** (nuevo). Test primero: `knowledge-contract.test.ts` asserts `KNOWLEDGE_MCP_SERVER_NAME === "knowledge"`, `KNOWLEDGE_TOOL_NAME === "query_knowledge_base"`, `KNOWLEDGE_TOOL_QUALIFIED_NAME === "mcp__knowledge__query_knowledge_base"`, y que `KnowledgeFeedbackPort` compila sin imports de SDK/Node/adapters. Hecho: archivo sin imports, constantes + interfaz exportadas, test verde. Commit: `feat(core): agrega contrato de conocimiento con constantes y KnowledgeFeedbackPort (Hito 2, tarea 1)`.

2. **`src/adapters/knowledge/config.ts`**. Test primero: `config.test.ts` — defaults con env vacío, override por cada var (`GRAPHIFY_BIN`, `GRAPHIFY_GRAPH_PATH`, `GRAPHIFY_BUDGET`, `GRAPHIFY_TIMEOUT_MS`), valor numérico inválido/vacío/≤0 cae a default. Hecho: `resolveGraphifyConfig(env = process.env)` pura, `import "../../core/config/env.js"` de efecto lateral presente, todos los casos verdes. Commit: `feat(adapters/knowledge): agrega resolveGraphifyConfig con defaults y overrides por env (Hito 2, tarea 2)`.

3. **`package.json`** — agregar `"zod": "^4.4.3"` a `dependencies` (ADR 3.1). Hecho: `npm install` sin diff de `node_modules` (ya estaba como peer), `npm run typecheck` verde. Commit: `chore(adapters/knowledge): declara zod como dependencia directa (Hito 2, tarea 3)`.

4. **`src/adapters/knowledge/graphify-cli.ts`**. Antes de fijar el test: correr `graphify save-result --help` en vivo y confirmar/ajustar `buildSaveResultArgs` contra R1 del diseño (el argv de `query` ya está confirmado). Test primero: `graphify-cli.test.ts` — argv exacto de `buildQueryArgs`/`buildSaveResultArgs`, `timeout` propagado a `execFileFn`, clasificación `ENOENT→not-found`, `killed→timeout`, `code≠0→exit-code`, resto→`unknown`, y assert de que nunca se pasa `shell: true`. Hecho: `runGraphifyQuery`/`runGraphifySaveResult` lanzan `GraphifyCliError` tipado en todo fallo, `defaultExecFile` usa `execFile` con array de args. Commit: `feat(adapters/knowledge): agrega wrapper de subproceso graphify con clasificacion de errores (Hito 2, tarea 4)`.

5. **`src/adapters/knowledge/cited-nodes.ts`**. Test primero: `cited-nodes.test.ts` con el fixture real de stdout que verificó la exploración — parseo de `NODE ... [src=... loc=...]`, línea sin bloque de metadatos, dedupe, corte en `MAX_CITED_NODES`, `drain()` idempotente. Hecho: `parseNodeLabels` y `createCitedNodesRecorder` puros, sin I/O. Commit: `feat(adapters/knowledge): agrega parseo de labels citados y recorder por turno (Hito 2, tarea 5)`.

6. **`src/adapters/knowledge/knowledge-tool.ts`**. Test primero: `knowledge-tool.test.ts` — rama con resultados (instrucción + stdout intacto + recorder cargado), rama vacía (0 líneas `NODE`), rama degradada por cada `reason` de `GraphifyCliError`, `execFn` que lanza síncrono resuelve igual, eventos logueados con `casoId`. Hecho: `handleKnowledgeQuery` nunca lanza ni rechaza en ningún camino. Commit: `feat(adapters/knowledge): agrega handleKnowledgeQuery con degradacion sin excepcion (Hito 2, tarea 6)`.

7. **`src/adapters/knowledge/index.ts`**. Test primero: `index.test.ts` — nombre del server = `KNOWLEDGE_MCP_SERVER_NAME`, `timeout = queryTimeoutMs + MCP_TIMEOUT_MARGIN_MS`, `feedback` con recorder vacío no llama la CLI, con nodos llama con el argv esperado, CLI que rechaza resuelve igual, drena aunque falle. Hecho: `createKnowledgeAdapter` registra `createSdkMcpServer` + `tool()` compartiendo un único recorder. Commit: `feat(adapters/knowledge): agrega fachada createKnowledgeAdapter (Hito 2, tarea 7)`.

8. **`src/core/turn-selector/invoke-model.ts`**. Test primero (agrega casos a `invoke-model.test.ts`): sin `mcpServers` → `options` idéntico a Hito 1 (regresión), con `mcpServers` → aparece en `options.mcpServers`, `allowedTools` poblado desde `agent.allowedTools` (ADR 4) y omitido si vacío. Hecho: parámetro `mcpServers` opcional al final de la firma, construcción incremental de `options`. Commit: `feat(core): agrega mcpServers y allowedTools a toQueryOptions (Hito 2, tarea 8)`.

9. **`src/core/turn-selector/handle-turn.ts`**. Test primero (agrega casos a `handle-turn.test.ts`): `knowledgeFeedback.saveTurnResult` se llama después de `closeTurn` con `question`=prompt, `answer`=responseText; omitido → turno idéntico a Hito 1; turno fallido antes del cierre no lo llama. Hecho: `HandleTurnDeps.mcpServers`/`knowledgeFeedback` opcionales, invocación fuera de `runTurnStage`. Commit: `feat(core): invoca knowledgeFeedback tras el cierre de turno (Hito 2, tarea 9)`.

10. **`src/core/agents/definitions.ts`**. Test primero (agrega casos a `definitions.test.ts`): `allowedTools` contiene `KNOWLEDGE_TOOL_QUALIFIED_NAME`, system prompt ya no afirma ausencia de base de conocimiento, menciona la instrucción de citar. Hecho: import de la constante (no literal), module doc actualizado. Commit: `feat(core): habilita mcp__knowledge__query_knowledge_base en CONVERSATIONAL_AGENT (Hito 2, tarea 10)`.

11. **`src/main.ts` y `src/build-on-submit.ts`** — wiring del composition root. Test primero: casos en `build-on-submit.test.ts` — `knowledge` omitido → `handleTurn` recibe deps sin las claves nuevas, presente → recibe `mcpServers` y `knowledgeFeedback` juntos. Hecho: `createKnowledgeAdapter` se llama una única vez por corrida en `startHarness()`, tras crear `caso`; `main.ts` mantiene el import de `env.js` como primero. Commit: `feat(adapters/knowledge): conecta createKnowledgeAdapter en el composition root (Hito 2, tarea 11)`.

12. **Verificación manual end-to-end** (sin código de producción, cierre del hito). Cubre: los 3 casos de uso del plan citando `src`/`loc`; `GRAPHIFY_BIN` inexistente → degradación sin stack trace; `GRAPHIFY_GRAPH_PATH` inexistente → degradación con `reason: exit-code`; `data/harness.log` con eventos de §9 del diseño correlacionados por `casoId`. Commit: no aplica (evidencia va a `docs/progreso/v1.1-consulta-conocimiento/` al cierre, según `AGENTS.md`).

## Después de la tarea 12

- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este documento, `spec.md` y `design.md`.
- Si aprueba: checklist de cierre de hito en `AGENTS.md`, tag `v1.1.0`, carpeta `docs/progreso/v1.1-consulta-conocimiento/`.
