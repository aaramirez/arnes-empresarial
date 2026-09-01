# Hito 2 (v1.1) — Consulta de conocimiento: evidencia de cierre

**Entregable funcional**: el agente responde una consulta de política interna citando `src`/`loc` del vault (arc42, Escenario de ejecución 2), los 3 casos de uso del plan se demuestran con el mismo adaptador, y la degradación ante fallas del subproceso `graphify` ocurre sin excepción no capturada.

**Tareas**: [`openspec/changes/hito-1.1-consulta-conocimiento/tasks.md`](../../../openspec/changes/hito-1.1-consulta-conocimiento/tasks.md) (12/12 — tareas 1-11 con commit propio `(Hito 2, tarea N)`, tarea 3 `chore` por ser una sola línea en `package.json`, tarea 12 verificación manual).

## Checklist de cierre (`AGENTS.md`)

- [x] Reviewer aprobó explícitamente (`sdd-verify`, sin hallazgos bloqueantes) — ver [`verify-report.md`](../../../openspec/changes/hito-1.1-consulta-conocimiento/verify-report.md).
- [x] `code-review` complementario — corrido (nivel alto), sin hallazgos bloqueantes. Detalle abajo.
- [x] Entregable funcional demostrado de punta a punta — evidencia técnica de `data/harness.log` de esta misma sesión (abajo), con dos de los cinco escenarios confirmados también de forma independiente por el humano.
- [x] Esta carpeta (`docs/progreso/v1.1-consulta-conocimiento/`).
- [ ] Tag `v1.1.0` — pendiente, se crea después del merge a `main`.

## Evidencia técnica del Escenario 2 (consulta de conocimiento)

Extractos reales de `data/harness.log` (gitignoreado, no versionado — se copian los fragmentos relevantes acá), uno por escenario, todos correlacionados por `casoId`. El log registra `questionLength` y conteo de `nodes` (no la pregunta ni los labels citados — decisión de diseño §9, por privacidad); el texto de las citas (`src`/`loc`) que el modelo puso en pantalla viene de la transcripción de cada corrida, no del log, y se documenta por separado sin mezclar ambas fuentes.

### 1. Política interna

Pregunta: *"¿Qué convención de commits usa este proyecto según AGENTS.md?"*. El agente citó `AGENTS.md` con `loc=L75`, `L89`, `L114`, aclarando honestamente que el vault le da ubicación de nodos pero no el texto completo — no inventó contenido.

```json
{"questionLength":61,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:51:40.239Z"}
{"durationMs":402,"nodes":7,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-consulta-ok","timestamp":"2026-09-01T01:51:40.641Z"}
{"agentId":"agente-conversacional","sdkSessionId":"ad2544e6-7704-4845-92c4-bb954aff9bf3","casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"turno-completado","timestamp":"2026-09-01T01:51:49.107Z"}
{"nodes":8,"casoId":"56019f78-bb43-4dc2-9cba-f751989df9a0","event":"conocimiento-guardado","timestamp":"2026-09-01T01:51:49.277Z"}
```

### 2. Consulta gerencial con historial (2 turnos, misma sesión)

Turno 1: cuántos hitos tiene planificados el proyecto. Turno 2: *"¿Y en qué consiste el segundo de esos hitos?"* — el agente respondió sobre el Hito 2 citando `src=openspec/changes/hito-1.1-consulta-conocimiento/proposal.md, loc=L1` y `src=.../tasks.md, loc=L1`, demostrando que mantuvo el contexto del turno anterior ("esos hitos").

```json
{"agentId":"agente-conversacional","sdkSessionId":"a27dde47-ecf6-4685-9537-49ce042f9f59","casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"turno-completado","timestamp":"2026-09-01T01:44:32.050Z"}
{"nodes":6,"casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"conocimiento-guardado","timestamp":"2026-09-01T01:44:32.243Z"}
{"agentId":"agente-conversacional","sdkSessionId":"a27dde47-ecf6-4685-9537-49ce042f9f59","casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"turno-completado","timestamp":"2026-09-01T01:45:23.838Z"}
{"nodes":20,"casoId":"dfd46c10-176b-4c2f-a461-14ad6ce27510","event":"conocimiento-guardado","timestamp":"2026-09-01T01:45:24.016Z"}
```

Mismo `sdkSessionId` en ambos turnos (memoria de sesión, Hito 1 intacta) — dos `turno-completado`, dos `conocimiento-guardado`.

### 3. Onboarding

Pregunta: *"Soy nuevo en el equipo, ¿podés explicarme qué es la arquitectura hexagonal...?"*. Citó `src=README.md loc=L19`.

```json
{"agentId":"agente-conversacional","sdkSessionId":"c4c35ae4-da3c-44a7-be66-0d284958d8bb","casoId":"0db13d07-d059-41c1-b888-215593965b10","event":"turno-completado","timestamp":"2026-09-01T01:45:57.902Z"}
{"nodes":8,"casoId":"0db13d07-d059-41c1-b888-215593965b10","event":"conocimiento-guardado","timestamp":"2026-09-01T01:45:58.088Z"}
```

**Confirmado también por el humano de forma independiente**, en una corrida separada con la misma pregunta: citó `README.md`, línea 19, con el mismo comportamiento honesto.

### 4. Degradación — `GRAPHIFY_BIN` inexistente

```json
{"questionLength":76,"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:46:29.648Z"}
{"reason":"not-found","durationMs":4,"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-consulta-error","timestamp":"2026-09-01T01:46:29.653Z"}
{"agentId":"agente-conversacional","sdkSessionId":"ef01b46b-a130-4ea7-b9cc-3e4caf0b6067","casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"turno-completado","timestamp":"2026-09-01T01:46:34.416Z"}
{"casoId":"e1f5f547-aac6-4584-9841-470eafdf1533","event":"conocimiento-sin-consulta","timestamp":"2026-09-01T01:46:34.417Z"}
```

`reason: "not-found"` (binario ausente, `ENOENT`). Respuesta en pantalla sin stack trace, aclarando que no pudo consultar la base — turno igual completa.

### 5. Degradación — `GRAPHIFY_GRAPH_PATH` inexistente

```json
{"questionLength":78,"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-consulta-inicio","timestamp":"2026-09-01T01:47:15.770Z"}
{"reason":"exit-code","durationMs":362,"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-consulta-error","timestamp":"2026-09-01T01:47:16.133Z"}
{"agentId":"agente-conversacional","sdkSessionId":"a6964541-4daf-4b6a-848a-b1fa8cbc3b8e","casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"turno-completado","timestamp":"2026-09-01T01:47:19.596Z"}
{"casoId":"418ee748-e8b3-4cb9-9b19-c96a420e130f","event":"conocimiento-sin-consulta","timestamp":"2026-09-01T01:47:19.597Z"}
```

`reason: "exit-code"` — distinto de `"not-found"` del caso 4, confirmando que `graphify-cli.ts` clasifica correctamente ambos modos de falla. **Confirmado también por el humano de forma independiente**: una env var `GRAPHIFY_GRAPH_PATH=ruta/inexistente.json` que quedó pisada en su propia sesión de PowerShell produjo la misma degradación sin stack trace, sin inventar el número de hitos — evidencia real e independiente de la misma clasificación de error.

## Veredicto del Reviewer

**`sdd-verify`** (auditoría completa de las 11 tareas de código + regla hexagonal + tarea 12): **PASS**. `rm -rf dist && npm run typecheck && npm test && npm run build` limpio — 25 archivos, 211 tests. Sin imports cruzados entre `core`/adaptadores ni entre adaptadores; solo `main.ts`/`build-on-submit.ts` importan `src/adapters/knowledge/` (regla de frontera específica de este hito, `design.md` §6). Reporte completo: [`verify-report.md`](../../../openspec/changes/hito-1.1-consulta-conocimiento/verify-report.md).

Un WARNING no bloqueante (`logEvent` fuera de `try/catch` en una rama puntual de `index.ts`), documentado como nota para el próximo hito.

**`code-review`** (nivel alto, con verificación por sub-agentes sobre cada hallazgo candidato): 10 hallazgos confirmados, ninguno CRITICAL. Se corrigieron los 5 de lógica en un ciclo Implementer→Reviewer adicional (commit `93363af`, mismo checklist de TDD rojo→verde por bug):

1. `handle-turn.ts` — citas de un turno fallido se drenaban recién en el próximo turno exitoso (contaminación cruzada). Fix: `discardPendingCitations()` en el `catch`.
2. `handle-turn.ts` — `saveTurnResult` sin `try/catch` propio pese al contrato "nunca rechaza" del port. Fix: envuelto defensivamente.
3. `graphify-cli.ts` — pregunta libre sin separador `--`, riesgo de interpretarse como flag si empieza con `-`. Fix: `--` agregado antes del argumento.
4. `index.ts` — truncado de respuesta con `slice()` plano podía partir un par subrogado (emoji) a la mitad. Fix: truncado seguro por code point.
5. `cited-nodes.ts` — regex de fallback podía colar corchetes en el label. Fix: excluidos `[` y `]` de la clase de caracteres.

Los otros 5 hallazgos (limpieza/diseño: extender `HookPoint` con etapa post-cierre en vez de campo bespoke, `cause` de `GraphifyCliError` vía `super()` nativo, ternario de clasificación de error duplicado en dos archivos, campo `casoId` no usado en `KnowledgeToolDeps`, falta de memoización de `runGraphifyQuery` por turno) quedan documentados como deuda técnica no bloqueante para el próximo hito — ninguno afecta el entregable funcional de este.
