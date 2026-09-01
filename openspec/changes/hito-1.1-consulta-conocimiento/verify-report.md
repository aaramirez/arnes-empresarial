# Verification Report

Verificación holística del Hito 2 (v1.1 — Consulta de conocimiento), corrida "Después de la tarea 12" según pide `tasks.md`. Las 11 tareas de código ya pasaron su propio ciclo Implementer→Reviewer individual; este reporte confirma que lo committeado en `hito/v1.1-consulta-conocimiento` coincide con eso, corre limpio en conjunto, y documenta la verificación manual end-to-end de la tarea 12.

Comando ejecutado en secuencia, `dist/` limpio primero (obligatorio, si no Vitest duplica conteos):

```
rm -rf dist && npm run typecheck && npm test && npm run build
```

- `typecheck` (`tsc --noEmit`): PASS, sin salida (sin errores).
- `test` (`vitest run`): PASS — 25 test files, 211 tests, 0 fallos. (Hito 1.0 cerró en 19 archivos / 132 tests; el Hito 2 agrega 6 archivos nuevos — `knowledge-contract.test.ts`, `config.test.ts`, `graphify-cli.test.ts`, `cited-nodes.test.ts`, `knowledge-tool.test.ts`, `index.test.ts` — más casos agregados a `invoke-model.test.ts`, `definitions.test.ts`, `handle-turn.test.ts` y `build-on-submit.test.ts`, consistente con lo que `design.md` §10 pedía.)
- `build` (`tsc -p tsconfig.json`): PASS, sin salida (sin errores).

## Regla no negociable de arquitectura hexagonal

Grep real (no de memoria), sobre el árbol actual de `src/`:

- `from ".*adapters` dentro de `src/core/**` → **0 resultados**. `src/core/` (incluido el nuevo `src/core/knowledge/`) no importa nada de `src/adapters/*`.
- `from ".*(tui|memory)` dentro de `src/adapters/knowledge/**` → **0 resultados**. El adaptador de conocimiento no importa a los otros dos adaptadores.
- `from ".*knowledge` dentro de `src/adapters/tui/**` → **0 resultados**.
- `from ".*knowledge` dentro de `src/adapters/memory/**` → **0 resultados**.
- `from ".*(tui|memory)` dentro de `src/adapters/memory/**` y `src/adapters/tui/**` (cruzados entre sí) → **0 resultados**, igual que en el cierre de Hito 1.0.
- **Regla de fronteras específica de este hito** (design.md §6: "`src/main.ts` y `src/build-on-submit.ts` son los únicos archivos que importan `src/adapters/knowledge/`"): grep de la cadena literal `adapters/knowledge` en todo `src/**/*.ts` da 4 coincidencias — `src/main.ts:69` (`import { createKnowledgeAdapter, type KnowledgeAdapter } from "./adapters/knowledge/index.js"`), `src/build-on-submit.ts:46` (`import type { KnowledgeAdapter } from "./adapters/knowledge/index.js"`), y dos falsos positivos de comentario JSDoc (`src/core/knowledge/knowledge-contract.ts:10,31` y `src/adapters/knowledge/index.ts:21`, ambos texto de documentación mencionando la ruta, no un `import`). Confirmado leyendo esas líneas: **ningún import real** fuera de `main.ts`/`build-on-submit.ts`.

Veredicto de esta regla: **CUMPLE**, en todo el código actual, no solo en lo tocado en este hito.

## Checklist de las 11 tareas de código

Cada tarea ya fue aprobada individualmente por un Reviewer en su propio ciclo — este checklist confirma que lo committeado en la rama coincide con eso, contra el criterio literal de `tasks.md`.

### 1. `src/core/knowledge/knowledge-contract.ts` — PASS
Exporta `KNOWLEDGE_MCP_SERVER_NAME = "knowledge"`, `KNOWLEDGE_TOOL_NAME = "query_knowledge_base"`, `KNOWLEDGE_TOOL_QUALIFIED_NAME = "mcp__knowledge__query_knowledge_base"` (template literal, verificado) e interfaz `KnowledgeFeedbackPort`. Archivo sin imports (confirmado leyéndolo — module doc explícito: "Este archivo no importa nada"). Commit `53fc847`.

### 2. `src/adapters/knowledge/config.ts` — PASS
`resolveGraphifyConfig(env = process.env)` pura, con `import "../../core/config/env.js"` de efecto lateral como primera línea. `resolvePositiveNumber` cae a default ante valor ausente, vacío, no numérico o ≤ 0 — verificado en el código, cubierto por `config.test.ts`. Commit `46a9279`.

### 3. `package.json` — PASS
`"zod": "^4.4.3"` presente en `dependencies` (confirmado con grep directo sobre `package.json`); `@modelcontextprotocol/sdk` **no** está declarado (grep da 0 coincidencias), consistente con ADR 3.1. `npm run typecheck` verde (ver arriba). Commit `c772ba3` (`chore`, tal como marca `tasks.md`, único commit de código de las 11 tareas que no es `feat`).

### 4. `src/adapters/knowledge/graphify-cli.ts` — PASS
`buildQueryArgs`/`buildSaveResultArgs` producen el argv exacto de §3.2 del diseño. `runGraphifyQuery`/`runGraphifySaveResult` envuelven todo fallo en `GraphifyCliError` tipado (`not-found`/`timeout`/`exit-code`/`unknown`, clasificación por `ENOENT`/`killed`+`SIGTERM`/`code` numérico). `defaultExecFile` usa `execFile` con array de args (`shell` nunca seteado) — confirmado leyendo el código, ningún `exec`/`shell: true` en el archivo. Commit `fbe32ae`.

### 5. `src/adapters/knowledge/cited-nodes.ts` — PASS
`parseNodeLabels` con patrón principal `NODE ... [` y fallback sin metadatos, dedupe por `Set`, corte en `MAX_CITED_NODES = 20`. `createCitedNodesRecorder` con `record`/`drain`, `drain()` limpia el estado interno (idempotente por construcción: segunda llamada sin `record()` devuelve `[]`). Sin I/O — confirmado, solo transforma strings. Commit `73672f9`.

### 6. `src/adapters/knowledge/knowledge-tool.ts` — PASS
`handleKnowledgeQuery` con las tres ramas exactas del diseño (resultados / sin resultados / degradado), instrucción de citar solo en la rama 1, `recorder.record` solo ahí también. `deps.runQuery` invocado dentro de un `try/catch` explícito (no `.catch()` sobre la promesa) — el comentario in-line documenta por qué: cubre también un throw síncrono. `logEvent` inyectado, nunca decide destino del log. Commit `86ef516`.

### 7. `src/adapters/knowledge/index.ts` — PASS
`createKnowledgeAdapter` registra `createSdkMcpServer({ name: KNOWLEDGE_MCP_SERVER_NAME, timeout: config.queryTimeoutMs + MCP_TIMEOUT_MARGIN_MS, tools: [tool(...)] })` y construye `feedback` compartiendo un único `CitedNodesRecorder` cerrado por closure entre la tool y el feedback — ningún estado global. `saveTurnResult` drena el recorder **siempre primero** (línea 115, antes de cualquier `return` temprano), trunca `answer` a `MAX_ANSWER_CHARS = 4000`, y su único subproceso corre dentro de `try/catch` propio. Commit `c2142f8`.

### 8. `src/core/turn-selector/invoke-model.ts` — PASS
`toQueryOptions` y `invokeModel` reciben `mcpServers?: Options["mcpServers"]` como parámetro final opcional. Construcción incremental confirmada: `options.allowedTools` se puebla desde `agent.allowedTools` solo si no está vacío (ADR 4), `options.mcpServers` se asigna solo si `mcpServers !== undefined` — sin `mcpServers`, `options` queda idéntico a Hito 1 (regresión cubierta por test). Commit `b16a25a`.

### 9. `src/core/turn-selector/handle-turn.ts` — PASS
`HandleTurnDeps` gana `mcpServers?` y `knowledgeFeedback?`, ambos opcionales. En el cuerpo, `knowledgeFeedback.saveTurnResult({ casoId, question: prompt, answer: result.responseText })` se llama **después** de `closeTurn` y **fuera** de `runTurnStage` (confirmado leyendo el orden real: `runTurnStage("model", ...)` → `runTurnStage("close", ...)` → bloque `if (knowledgeFeedback !== undefined)` sin `runTurnStage` envolviéndolo). Un turno fallido antes del cierre no llega a ese bloque. Commit `45b37a2`.

### 10. `src/core/agents/definitions.ts` — PASS
`allowedTools: [KNOWLEDGE_TOOL_QUALIFIED_NAME]` (vía import de la constante, no literal — confirmado). El system prompt ya no afirma ausencia de base de conocimiento: menciona explícitamente la tool por su nombre calificado y la instrucción de citar `src`/`loc`. El comentario "Todavía no tenés delegación a otros agentes" es la única negación restante, y es correcta (A2A sigue fuera de alcance). Commit `dd2d4d4`.

### 11. `src/main.ts` y `src/build-on-submit.ts` — PASS
`createKnowledgeAdapter` se llama una única vez dentro de `startHarness()`, después de crear `caso` (usa `caso.id`) — confirmado en el orden real del archivo. `buildOnSubmit` gana el parámetro `knowledge?: KnowledgeAdapter` y lo reenvía como una sola unidad (`{ mcpServers: knowledge.mcpServers, knowledgeFeedback: knowledge.feedback }`) solo cuando está presente, mismo patrón de spread condicional que `logDeps`. `main.ts` mantiene `import "./core/config/env.js"` como su primer import (confirmado, línea 53). Esta es también la tarea que resuelve la frontera de importación exclusiva verificada arriba. Commit `f4b72e8`.

Los 10 commits de código de la rama (tareas 1–11, con la 3 como `chore`) coinciden literalmente, mensaje por mensaje, con lo que pide `tasks.md` — confirmado con `git log --oneline hito/v1.1-consulta-conocimiento`.

## Tarea 12 — Verificación manual end-to-end

Contexto: el MVP usa el propio `graphify-out/graph.json` de este repo como "vault" de conocimiento — demo autorreferencial. La TUI de Ink exige raw mode real, así que las corridas del agente se hicieron con un driver `node-pty`; los fragmentos de `data/harness.log` de abajo se leyeron directamente de ese archivo (gitignoreado, no versionado) en esta misma sesión de verificación — no se asumieron por el enunciado.

**Nota de honestidad sobre el alcance de esta evidencia**: `data/harness.log` registra `questionLength` (no la pregunta) y `nodes` (un conteo, no los labels) — decisión de diseño §9, por privacidad. El log confirma que la secuencia de eventos ocurrió, con qué duración y con cuántos nodos, correlacionado por `casoId`, pero **no contiene el texto de la cita** (`src`/`loc`) que el modelo efectivamente puso en pantalla. Esa parte de la evidencia (la cita textual de `AGENTS.md loc=L75/L89/L114`, `proposal.md`/`tasks.md loc=L1`, `README.md loc=L19`) proviene de la transcripción de la corrida automatizada y, en dos de los cuatro casos, de una repetición manual independiente del humano — no del log. Se documenta así, sin mezclar ambas fuentes como si fueran la misma evidencia.

### 1. Consulta de política interna

Pregunta (2do intento en la sesión): "¿Qué convención de commits usa este proyecto según AGENTS.md?". El agente citó `AGENTS.md` con `loc=L75`, `L89`, `L114`, aclarando honestamente que el vault le da ubicación de nodos pero no el texto completo — no inventó contenido.

Log confirmado, `casoId 56019f78-bb43-4dc2-9cba-f751989df9a0`:

```json
{"questionLength":61,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:51:40.239Z"}
{"durationMs":402,"nodes":7,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-ok","timestamp":"2026-09-01T01:51:40.641Z"}
{"questionLength":80,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:51:43.277Z"}
{"durationMs":387,"nodes":7,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-ok","timestamp":"2026-09-01T01:51:43.664Z"}
{"agentId":"agente-conversacional","sdkSessionId":"ad2544e6-7704-4845-92c4-bb954aff9bf3","casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"turno-completado","timestamp":"2026-09-01T01:51:49.107Z"}
{"nodes":8,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-guardado","timestamp":"2026-09-01T01:51:49.277Z"}
```

Dos ciclos `conocimiento-consulta-inicio`→`conocimiento-consulta-ok` (dos tool calls dentro del mismo turno) → `turno-completado` → `conocimiento-guardado` con `nodes:8`, todos bajo el mismo `casoId`. Coincide con lo reportado.

### 2. Consulta gerencial con historial (2 turnos, misma sesión)

Turno 1: cuántos hitos tiene el plan. Turno 2: "¿Y en qué consiste el segundo de esos hitos?" — el agente respondió sobre el Hito 2 citando `src=openspec/changes/hito-1.1-consulta-conocimiento/proposal.md, loc=L1` y `src=.../tasks.md, loc=L1`, demostrando que mantuvo el contexto del turno anterior ("esos hitos").

Log confirmado, `casoId dfd46c10-176b-4c2f-a461-14ad6ce27510` — dos `turno-completado` (mismo `sdkSessionId a27dde47-...`, confirmando resumen de sesión entre ambos turnos), cada uno con sus propios ciclos `conocimiento-consulta-inicio/ok`, y dos `conocimiento-guardado`:

```json
{"agentId":"agente-conversacional","sdkSessionId":"a27dde47-ecf6-4685-9537-49ce042f9f59","casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"turno-completado","timestamp":"2026-09-01T01:44:32.050Z"}
{"nodes":6,"casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"conocimiento-guardado","timestamp":"2026-09-01T01:44:32.243Z"}
...
{"agentId":"agente-conversacional","sdkSessionId":"a27dde47-ecf6-4685-9537-49ce042f9f59","casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"turno-completado","timestamp":"2026-09-01T01:45:23.838Z"}
{"nodes":20,"casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"conocimiento-guardado","timestamp":"2026-09-01T01:45:24.016Z"}
```

`nodes:6` en el primer `conocimiento-guardado` y `nodes:20` en el segundo (tope de `MAX_CITED_NODES`, el segundo turno consultó varias veces — 6 ciclos `inicio/ok` visibles en el log completo, cada uno con hasta 8 nodos, deduplicados y cortados a 20 por el recorder). Coincide con lo reportado.

### 3. Onboarding

Pregunta: "Soy nuevo en el equipo, ¿podés explicarme qué es la arquitectura hexagonal...?". Citó `src=README.md loc=L19`.

Log confirmado, `casoId 0db13d07-d059-41c1-b888-215593965b10`:

```json
{"agentId":"agente-conversacional","sdkSessionId":"c4c35ae4-da3c-44a7-be66-0d284958d8bb","casoId":"0db13d07-d059-41c1-b888-215593965b10","event":"turno-completado","timestamp":"2026-09-01T01:45:57.902Z"}
{"nodes":8,"casoId":"0db13d07-d059-41c1-b888-215593965b10","event":"conocimiento-guardado","timestamp":"2026-09-01T01:45:58.088Z"}
```

`conocimiento-guardado` con `nodes:8`, coincide con lo reportado. **Confirmado también por el humano de forma independiente**, en una corrida real separada de este mismo repo con la misma pregunta: citó `README.md`, línea 19, con el mismo comportamiento honesto (aclara que no tiene el texto completo, solo la ubicación).

### 4. Degradación — `GRAPHIFY_BIN` inexistente

Log confirmado, `casoId e1f5f547-aac6-4584-9841-470eafdf1533`:

```json
{"questionLength":76,"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:46:29.648Z"}
{"reason":"not-found","durationMs":4,"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-consulta-error","timestamp":"2026-09-01T01:46:29.653Z"}
{"agentId":"agente-conversacional","sdkSessionId":"ef01b46b-a130-4ea7-b9cc-3e4caf0b6067","casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"turno-completado","timestamp":"2026-09-01T01:46:34.416Z"}
{"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-sin-consulta","timestamp":"2026-09-01T01:46:34.417Z"}
```

`reason: "not-found"` (clasificación correcta de `ENOENT`, `graphify-cli.ts`), seguido de `turno-completado` y `conocimiento-sin-consulta` (el recorder quedó vacío, `feedback.saveTurnResult` no llamó a `save-result`, tal como pide el spec). Respuesta en pantalla sin stack trace, aclarando que no pudo consultar la base. Coincide con lo reportado.

### 5. Degradación — `GRAPHIFY_GRAPH_PATH` inexistente

Log confirmado, `casoId 418ee748-e8b3-4cb9-9b19-c96a420e130f`:

```json
{"questionLength":78,"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:47:15.770Z"}
{"reason":"exit-code","durationMs":362,"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-consulta-error","timestamp":"2026-09-01T01:47:16.133Z"}
{"agentId":"agente-conversacional","sdkSessionId":"a6964541-4daf-4b6a-848a-b1fa8cbc3b8e","casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"turno-completado","timestamp":"2026-09-01T01:47:19.596Z"}
{"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-sin-consulta","timestamp":"2026-09-01T01:47:19.597Z"}
```

`reason: "exit-code"` — distinto de `"not-found"` del caso 4, confirmando que `graphify-cli.ts` clasifica correctamente ambos modos de falla (binario ausente vs. proceso que corre y sale con código ≠ 0 porque el grafo no existe). **Confirmado también por el humano de forma independiente**: dejó `GRAPHIFY_GRAPH_PATH=ruta/inexistente.json` seteado en su propia sesión de PowerShell (efecto colateral de repetir la prueba) y una consulta posterior ("¿Cuántos hitos tiene planificados...?") devolvió la misma degradación sin stack trace, sin inventar el número de hitos — evidencia real e independiente de la misma clasificación de error.

### Conclusión de la tarea 12

Los 5 escenarios de evidencia (3 casos de uso + 2 degradaciones) están confirmados en `data/harness.log`, con `casoId`, eventos y `reason`/`nodes` exactamente como se reportaron. La cadena de tres garantías de `design.md` §7 (`runGraphifyQuery` clasifica, `handleKnowledgeQuery` nunca lanza, `feedback.saveTurnResult` nunca rechaza) se sostiene en la práctica: ningún `TurnFailedError`, ningún crash, en ninguno de los 5 casos — todos terminan en `turno-completado`.

## Issues encontrados

**CRITICAL: Ninguno.**

**WARNING:**
- `src/adapters/knowledge/index.ts`, líneas 117–120: dentro de `saveTurnResult`, el `logEvent("conocimiento-sin-consulta")` de la rama de recorder vacío corre **fuera** del `try/catch` que sí envuelve la rama con nodos (líneas 125–131). Un Reviewer de tarea anterior dejó esto anotado como detalle no bloqueante. Confirmado con ojo fresco en esta verificación consolidada: **se mantiene como no bloqueante**, por la misma razón que ya vale para el resto del adaptador — `logEvent` es la función inyectada por el composition root (`(event, fields) => logTurnEvent(caso.id, event, fields)`), y `logTurnEvent`/`createFileLogWriter` (Hito 1) ya tienen su propio contrato de "nunca lanza ante fallo de escritura" documentado y testeado en su propio módulo. Si ese contrato se rompiera algún día, sí propagaría una excepción no capturada en esta rama puntual — vale la pena una nota en el module doc de `index.ts` para el próximo hito, pero no amerita devolver este hito al Implementer.

**SUGGESTION:**
- Ninguna nueva que amerite bloquear el cierre.

**Riesgos residuales ya documentados en `design.md` §11 (contexto, no hallazgos nuevos de esta verificación):** R1 (forma de `save-result` asumida — mitigado, ya implementado y confirmado en la evidencia manual con `conocimiento-guardado` exitoso), R2 (binarios `.cmd` en Windows — la demo corrió con `graphify` resuelto correctamente, sin síntoma de `EINVAL`), R3 (citación depende del modelo — confirmado que citó en los 3 casos de uso), R4 (recorder asume turnos secuenciales — sigue siendo cierto, sin cambios), R5 (zod como dependencia nueva — aceptado, ver tarea 3), R6 (`allowedTools` cambia postura de seguridad — ADR 4 documentado, sin incidentes en la demo), R7 (`save-result` en camino crítico, hasta 5 s — no se midió el retraso exacto en la demo, pero ningún turno mostró degradación visible de UX en los logs, `save-result` corrió después de `turno-completado`).

## Estado del checklist de cierre de hito según AGENTS.md

- [x] El Reviewer aprueba explícitamente en este reporte `sdd-verify`, sin hallazgos bloqueantes. Falta `code-review` complementario si el proceso lo exige como paso separado — no ejecutado en esta sesión (esta verificación cubrió el rol Reviewer vía `sdd-verify`; `code-review` como skill separada queda pendiente si el humano lo pide explícitamente).
- [x] El entregable funcional del hito — el agente responde citando `src`/`loc` en los 3 casos de uso del plan, con degradación sin excepción no capturada — está demostrado de punta a punta con evidencia real de log, confirmada línea por línea en esta sesión.
- [ ] `docs/progreso/v1.1-consulta-conocimiento/` **no existe todavía** — pendiente de creación por el humano tras esta aprobación.
- [ ] Tag semántico `v1.1.0` **no existe todavía** (`git tag -l` solo muestra `v1.0.0`) — pendiente del humano.

## Veredicto final

**PASS.** El código del hito, tal como está en `hito/v1.1-consulta-conocimiento`, cumple las 11 tareas de código de `tasks.md` contra sus criterios de aceptación literales y contra `specs/knowledge/spec.md`; la regla no negociable de arquitectura hexagonal se sostiene en todo el árbol `src/`, incluida la regla de frontera específica de este hito (solo `main.ts`/`build-on-submit.ts` importan `src/adapters/knowledge/`); el ciclo `typecheck`, `test` y `build` corre limpio — 0 errores, 211 de 211 tests, con `dist/` limpiado antes de correr; y la tarea 12 (verificación manual end-to-end) está confirmada con evidencia real de `data/harness.log`, correlacionada por `casoId`, para los 3 casos de uso del plan y las 2 degradaciones exigidas.

No hay hallazgos bloqueantes que devuelvan esto al Implementer. El único WARNING (logEvent fuera de try/catch en una rama puntual de `index.ts`) es una nota para el próximo hito, no un defecto de este.

**Lo que le falta al humano para cerrar el hito** (no son hallazgos de código, son pasos del checklist de `AGENTS.md` que le corresponden a él):

1. Correr `code-review` como paso complementario, si el proceso lo exige como skill separada de `sdd-verify`.
2. Crear `docs/progreso/v1.1-consulta-conocimiento/` con la evidencia de este entregable (los fragmentos de `data/harness.log` de este reporte son un buen punto de partida).
3. Mergear `hito/v1.1-consulta-conocimiento` a `main`.
4. Crear el tag `v1.1.0` sobre `main`.
5. Commit final de cierre: `docs: cierra Hito 1.1 - consulta de conocimiento`, recién con las 4 casillas del checklist marcadas.
