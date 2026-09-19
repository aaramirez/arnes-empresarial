> **Nota de proceso**: fase `sdd-tasks` ejecutada sin shell (`Read`/`Grep`/`Glob`/`Write`), así que **no pudo correrse `graphify query`** pese al hook del repo (misma nota que `proposal.md` y `design.md`). Re-verificado por `Read`/`Grep` en esta fase: `makeBaseDeps` en `src/build-on-operaciones-empleado.test.ts:186-200`, test a invertir en `:265-280`, doc de módulo del test `:9-11`; `BuildOnOperacionesEmpleadoDeps` `:89-109`, destructuring `:163`, `createCaso` `:228-234`, `mcpServers` `:270`, doc-comment R3 `:25-34`; doble de `KnowledgeAdapter` en `src/build-on-a2a-entrante.test.ts:470-473`; `src/main.ts:501-512` (`createKnowledge` en scope desde `:269`); patrón de `src/main.test.ts:66-74,137-145`; `allowedTools` en `definitions.ts:158,258`. Recomendado: `graphify update .` después de `sdd-apply`.
>
> **Formato de commit**: `<tipo>(<scope>): <descripcion> (conocimiento-chat-empleado, tarea N)`. Diverge de `openspec/config.yaml` (`(Hito X.Y, tarea N)`) en un punto: este change **no es un hito numerado del Plan**, mismo criterio que `ergonomia-canal-empleado` y `devolucion-sin-token-dos-personas`. Scope `root` para `src/build-on-*.ts` y `src/main.ts`, precedente de `operaciones-negocio-conversacionales` (tareas 5 y 10) y `chat-web-empleado` (tarea 3); no está en la lista de `AGENTS.md` porque esos archivos no son `core` ni `adapters/*`.

# Tasks: El chat web del empleado alcanza la base de conocimiento interna

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 234-236, R1-R8) · [`design.md`](design.md) (§0.1-0.5, §2, §6 RD-112, §10, §12 RD-113, R9-R12) · spec: [`turno-empleado-autenticado`](specs/turno-empleado-autenticado/spec.md) (delta: 5 requirements ADDED + 1 MODIFIED).

**Rama**: `hito/v3.13-conocimiento-chat-empleado`, creada por el humano **después** del checkpoint y **desde `main` tras el merge y tag de v3.12** (R5). Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md). **No es hito completo hasta la tarea 9**: cada commit propuesto lleva la aclaración *"No es hito completo — faltan las tareas [N+1..9] y la aprobación del Reviewer"*.

**Metodología**: TDD estricto. Ciclo **rojo (2-3) → verde (4-5) → dientes del test de seguridad (6) → refactor/doc (7)**. Excepciones explícitas de AGENTS.md: tarea 1 y 8, verificación manual sin ciclo rojo-verde. **El commit del rojo va separado del verde** (Success Criteria de la propuesta).

**Decisiones ya cerradas, no se reabren**: ADR 234-236, RD-112 (`createKnowledge` REQUERIDO, sin default; doble copiado verbatim del molde A2A), RD-113 (delta ya escrito). Sin `try/catch` alrededor de `createKnowledge` (§0.4). `knowledgeFeedback` ausente (clave no presente, no `undefined`).

**Fuera de alcance, sin tarea**: `src/core/**`, migraciones (`0015` sigue libre), `package.json`, `OPERACIONES_NEGOCIO` (sigue con diez), tool `consultas` (queda colgante a propósito), `server.ts`, `allowedTools`, prompts, skill `citar-conocimiento`, `guia-verificacion-casos-de-uso.md` (caso 8b: sólo si el checkpoint lo pide, §14).

---

## Cadena de dependencia y paralelismo

Todo es **secuencial**: un solo módulo de producción más su composition root, y el rojo debe preceder al verde.

- 1 → 2 obligatorio (R10): capturar el "antes" **antes del rojo**, o se pierde.
- 2 y 3 son independientes entre sí (archivos distintos); se ordenan 2→3 por lectura. Ambas preceden a 4-5.
- 4 → 5: el campo requerido de la tarea 4 rompe `npm run typecheck` **sólo en `main.ts`** hasta la tarea 5. Es esperado y es la propiedad que compra el campo requerido (§11 pto 5). Bisectabilidad: el estado 4 tiene typecheck rojo y tests del módulo verdes.
- 6 depende de 4 (necesita la variable `knowledge` para mutar). 7 depende de 4. 8 depende de 1-7.

---

## Fase 0 — Evidencia previa (R1, R10)

1. [ ] **Captura del "antes" en el chat web, sin escribir ni una línea de código.** *Excepción TDD: verificación manual.* Con el árbol en el estado de la base (sin tareas 2-7), levantar el arnés, autenticarse en el chat web (`POST /operaciones`, **no la TUI**) y preguntar *"¿cuál es la política de reembolsos de la empresa?"*. Registrar: respuesta textual, `casoId`, si trae cita `src`/`loc`, y el conteo de archivos de `graphify-out/memory/` (baseline; 39 al escribir el diseño, recontar). Archivo nuevo `docs/progreso/v3.13-conocimiento-chat-empleado/verificacion-manual-antes.md` (molde `v3.12-…/verificacion-manual-tarea-27.md`, incluida su §0 de método).
   **Aceptación**: existe la captura textual con `casoId` y el conteo baseline; **o** consta por escrito que el entorno no tiene `ANTHROPIC_API_KEY` (la evidencia de v3.12 tuvo esa limitación) y el humano capturó el "antes" por su cuenta. **Sin una de las dos, no se arranca la tarea 2** (R10: después del wiring el comportamiento previo no se puede reobservar). **Si el comportamiento contradice la hipótesis** (p. ej. error visible al empleado en vez de respuesta de memoria sin cita), **STOP: vuelve al Spec Author** para corregir el diagnóstico (R11); el fix sigue siendo correcto pero el delta y la propuesta cambian.
   Commit (rama `hito/v3.13-conocimiento-chat-empleado`): `docs: evidencia del comportamiento previo del chat de empleado sin servidor de conocimiento (conocimiento-chat-empleado, tarea 1)` → *No es hito completo — faltan las tareas 2-9.*

---

## Fase 1 — ROJO (test-first)

2. [x] ★ **`src/build-on-operaciones-empleado.test.ts` — fixture, inversión del test vigente y tests nuevos.** *Test-first.* Un solo archivo, un solo commit:
   - **Fixture (RD-112)**: imports de `KNOWLEDGE_MCP_SERVER_NAME` (`./core/knowledge/knowledge-contract.js`), `KNOWLEDGE_TOOL_QUALIFIED_NAME` (mismo módulo), `CONSULTAS_MCP_SERVER_NAME` (`./core/agents/consultas-negocio-tool.js`) y `type KnowledgeAdapter` (`./adapters/knowledge/index.js`); `fakeKnowledge()` copiado **verbatim** de `build-on-a2a-entrante.test.ts:470-473` (nunca invoca `createKnowledgeAdapter`, ningún test toca el binario `graphify`; `feedback` completo con `saveTurnResult`/`discardPendingCitations` como `vi.fn()`); `BaseDepsOverrides.createKnowledge?` (`:178-184`); una línea en `makeBaseDeps` (`:186-200`): `createKnowledge: overrides.createKnowledge ?? (() => fakeKnowledge())`. Cubre los 21 sitios de llamada, todos pasan por ese helper.
   - **Invertir `:265-280`** (y el doc de módulo `:9-11`, que hoy afirma *"nunca la de conocimiento"*, en el mismo commit): `Object.keys(deps.mcpServers).sort()` `toEqual` `[KNOWLEDGE_MCP_SERVER_NAME, OPERACIONES_MCP_SERVER_NAME].sort()` (igualdad de conjunto, nunca `toContain`, molde `build-on-a2a-entrante.test.ts:498-502`) **y** `expect(deps.mcpServers).not.toHaveProperty(CONSULTAS_MCP_SERVER_NAME)` contra la constante real, nunca literal.
   - **Nuevos rojos** (escenarios del delta): (i) la tool listada es alcanzable: el segmento de servidor de `KNOWLEDGE_TOOL_QUALIFIED_NAME` (derivado de la constante, `mcp__<server>__<tool>`) es clave de `mcpServers`; (ii) una instancia por turno: `createKnowledge` espiado con `vi.fn()` y `newId: makeCounterNewId("caso")`, **una** llamada por invocación, con `"caso-1"`, **exactamente un argumento** (`mock.calls[0]` de longitud 1); dos invocaciones ⇒ dos llamadas con `casoId` distintos; (iii) mismo conjunto de `mcpServers` para dos sesiones con `empleadoId` distintos (o uno sin rol registrado), sin filtrado por rol; (iv) `createKnowledge` lanza un `Error` conocido ⇒ el handler rechaza con **ese mismo error** (`rejects.toBe`), `handleTurn` **no** llamado (`mockedHandleTurn` sin llamadas) y `conversacion.registrarTurno` **no** llamado.
   - **Nacen VERDES** (invariantes negativos del ADR 235; no son el rojo, ver §10.2.1): (v) `expect(mockedHandleTurn.mock.calls[0]?.[2]).not.toHaveProperty("knowledgeFeedback")`, con `expect(deps).toBeDefined()` antes, nunca `toBeUndefined` ni lectura del texto del archivo; (vi) `saveTurnResult` y `discardPendingCitations` del doble **no** invocados, con turno exitoso **y** con `handleTurn` rechazado (`mockRejectedValueOnce`).
   **Aceptación (rojo declarado con los dos comandos)**: `npm test -- build-on-operaciones-empleado` falla **exactamente** en el `it` invertido (unión/`consultas`), (i), (ii), (iii) y (iv); (v) y (vi) pasan; los tests preexistentes (`:208-263`, `:282-297`) siguen verdes. `npm run typecheck` **falla** porque `createKnowledge` no existe en `BuildOnOperacionesEmpleadoDeps` (rojo de compilación: prueba que el campo es requerido). Pegar ambas salidas en el mensaje del commit.
   Commit: `test(root): invierte el test de mcpServers del turno de empleado y agrega los tests de conocimiento sin feedback (conocimiento-chat-empleado, tarea 2)` → *No es hito completo — faltan las tareas 3-9.*

3. [x] **`src/main.test.ts` — test de wiring de composición (R12).** *Test-first.* Test corto, sin mocks nuevos, dentro del `describe` existente (usa el `vi.mock` de `buildOnOperacionesEmpleado` ya en `:71-74`, `vi.resetModules` y `clearAllMocks` del `beforeEach`), molde del test de `credenciales` (`:137-145`): `await import("./main.js")`; `buildOnOperacionesEmpleado` llamado 1 vez; `calls[0]?.[0].createKnowledge` `toBeDefined()`. **Variante fuerte** (`toBe` contra la fábrica de `buildOnSoporte`, +4 líneas de `vi.mock`): **no se incluye**, recomendación del diseño §10.3; queda a decisión del checkpoint.
   **Aceptación**: `npm test -- main` falla sólo en este `it` (hoy `createKnowledge` es `undefined` en `main.ts:501-512`); typecheck falla también en este archivo (propiedad inexistente en el tipo) hasta la tarea 4.
   Commit: `test(root): exige que main pase createKnowledge a buildOnOperacionesEmpleado (conocimiento-chat-empleado, tarea 3)` → *No es hito completo — faltan las tareas 4-9.*

---

## Fase 2 — VERDE (implementación mínima)

4. [x] **`src/build-on-operaciones-empleado.ts` — registrar el servidor de conocimiento, sin feedback.** Exactamente el diff de `design.md` §2.3, **sin improvisar**: (a) `import type { KnowledgeAdapter } from "./adapters/knowledge/index.js"` (molde `build-on-soporte.ts:39`); (b) campo **requerido** `readonly createKnowledge: (casoId: string) => KnowledgeAdapter` en `BuildOnOperacionesEmpleadoDeps` inmediatamente después de `hooks` (`:92`), con su doc (misma fábrica por `casoId`; se consume **sólo** `mcpServers`, `feedback` NO se cablea, ADR 235); (c) `createKnowledge` en el destructuring de `:163`; (d) `const knowledge = createKnowledge(casoId);` dentro del handler, **después** de `createCaso` (`:228-234`) y junto a `prompt`/`candidateAgents` (`:237-238`), **sin `try/catch`** (§0.4); (e) `mcpServers: { ...knowledge.mcpServers, ...operacionesAdapter.mcpServers }` en `:270`, conocimiento primero (molde `build-on-a2a-entrante.ts:185`); (f) **ningún** `knowledgeFeedback` ni referencia a `knowledge.feedback`. **No tocar** el doc-comment `:25-34` (tarea 7) ni ninguna otra línea: cualquier otro cambio en este archivo es alcance filtrado.
   **Aceptación**: `npm test -- build-on-operaciones-empleado` en verde, incluidos (v) y (vi) de la tarea 2; `npm run typecheck` falla **únicamente** en `src/main.ts` (falta `createKnowledge` en `:501`) y en `src/main.test.ts` por el mismo motivo; `git diff --stat main -- src/core/` vacío.
   Commit: `feat(root): registra el servidor de conocimiento en el turno del chat de empleado sin cablear knowledgeFeedback (conocimiento-chat-empleado, tarea 4)` → *No es hito completo — faltan las tareas 5-9.*

5. [x] **`src/main.ts` — pasar `createKnowledge` a `buildOnOperacionesEmpleado`.** Agregar `createKnowledge,` al objeto de `:501-512` (variable ya en scope desde `:269`, misma fábrica que `onSoporte` `:406` y `a2aEntrante` `:683`), con 2-3 líneas de comentario: sólo `mcpServers`, el feedback NO se cablea en este canal (ADR 235). Cero otras líneas.
   **Aceptación**: el test de la tarea 3 pasa a verde; `npm test` completo, `npm run typecheck` y `npm run build` en verde. Estado de partida de la reversión parcial: revertir sólo esta tarea vuelve a fallar el typecheck, no el runtime (§11 pto 5).
   Commit: `feat(root): cablea createKnowledge hacia buildOnOperacionesEmpleado en main (conocimiento-chat-empleado, tarea 5)` → *No es hito completo — faltan las tareas 6-9.*

---

## Fase 3 — Los dientes del test de seguridad (R9)

6. [x] ★ **Verificación por mutación manual del invariante del ADR 235.** *Sin ciclo rojo-verde propio: el test (v) nació verde y esto lo prueba.* Sobre el árbol con 4-5 aplicadas: (a) agregar **temporalmente** `knowledgeFeedback: knowledge.feedback` al `handleTurn` de `build-on-operaciones-empleado.ts`; (b) correr `npm test -- build-on-operaciones-empleado`: **deben fallar (v)** y **(vi) en la rama exitosa** o, al menos, (v); guardar la salida en rojo; (c) revertir la mutación restaurando el archivo al estado de la tarea 4 y confirmar `git diff -- src/build-on-operaciones-empleado.ts` vacío; (d) repetir `npm test` en verde. Segunda mutación opcional: cambiar el índice a `calls[0]?.[1]` en una copia del test y ver que **no** falla (documenta por qué se usa `[2]`).
   **Aceptación**: `docs/progreso/v3.13-conocimiento-chat-empleado/verificacion-mutacion-knowledgefeedback.md` con la salida en rojo, la salida en verde tras revertir y la confirmación de `git diff` vacío. **Sin este archivo el criterio de seguridad del change NO está demostrado** (instrucción al Reviewer).
   Commit: `docs: evidencia de verificacion por mutacion del invariante de knowledgeFeedback en el chat de empleado (conocimiento-chat-empleado, tarea 6)` → *No es hito completo — faltan las tareas 7-9.*

---

## Fase 4 — REFACTOR y documentación

7. [x] **`src/build-on-operaciones-empleado.ts` — doc-comment R3 (obligatorio, no cosmético).** Reemplazar **literalmente** `:25-34` por el texto de `design.md` §2.4 (unión exacta de dos servidores; "gap conocido R3" **cerrado**; `mcp__consultas__consultar_negocio` sigue listada y sin servidor; `knowledgeFeedback` no se pasa y por qué; recorder por instancia). **Adición de esta fase, no listada en §2.4**: el doc de secuencia de la función (`:139-153`) queda desactualizado: el paso 6 dice `mcpServers: operacionesAdapter.mcpServers` y no existe el paso de conocimiento; actualizarlo (paso nuevo entre 5 y 6, `mcpServers` como unión). Refactor de tests, sólo si hay duplicación real entre los `it` de la tarea 2 (helper local en el mismo archivo); **no** extraer `fakeKnowledge` a un helper compartido con `build-on-a2a-entrante.test.ts` (alcance filtrado).
   **Aceptación**: verificado leyendo, no asumido: `Grep` de `inalcanzable` y de `NO recibe \`createKnowledge\`` en el archivo sin coincidencias que afirmen lo viejo; el doc menciona ADR 234/235; `npm test`, `typecheck` y `build` en verde; diff **sólo comentarios** (cero líneas ejecutables).
   Commit: `docs(root): reescribe el doc-comment R3 de build-on-operaciones-empleado, cierra el gap de conocimiento (conocimiento-chat-empleado, tarea 7)` → *No es hito completo — faltan las tareas 8-9.*

---

## Fase 5 — Verificación manual final y cierre

8. [x] ★ **Verificación manual "después" + guardas de alcance.** *Excepción TDD: verificación manual de un entregable end-to-end.* Con las tareas 1-7 cerradas, en el **mismo canal** (chat web) y con la **misma pregunta** que la tarea 1. Archivo nuevo `docs/progreso/v3.13-conocimiento-chat-empleado/verificacion-manual-tarea-8.md`, molde `verificacion-manual-tarea-27.md`. Debe contener:
   - **(a) El "después"**: respuesta que **cita `src` real** (y `loc` si existe) en formato de la skill `citar-conocimiento`, con `casoId`; comparada lado a lado con el "antes" de la tarea 1. **Criterio (R2): "la tool es alcanzable y cita una fuente real", no "la respuesta es buena"**; si la cita aparece con contenido pobre, el change está cumplido.
   - **(b) Prueba en vivo del ADR 235**: `graphify-out/memory/` con **el mismo conteo antes y después** del turno (mismo baseline de la tarea 1); el log del turno **no** contiene `conocimiento-guardado`, `conocimiento-sin-consulta` **ni** `conocimiento-guardado-fallido` (los **tres** eventos del feedback, `adapters/knowledge/index.ts:123,131,134`; el diseño §4 pto 6 menciona sólo dos) y **sí** contiene `operaciones-caso-creado` y `turno-completado`.
   - **(c) Guardas de alcance** (`git diff main`, salida pegada): **cero** cambios en `src/core/**`; **cero** migraciones (próxima libre sigue `0015`); `src/adapters/web/server.ts`, `src/adapters/knowledge/**`, `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts`, `adapters/operaciones/index.ts` **sin tocar**; `operaciones-contract.test.ts` **sin tocar** (`OPERACIONES_NEGOCIO` con diez); `package.json` **sin dependencias nuevas**; `definitions.ts` y `soporte-prompt.ts` sin tocar; y `src/core/` sin imports de `src/adapters/*`.
   - **(d) Suite**: `npm test`, `npm run typecheck` y `npm run build` en verde (limpiar `dist/` antes: `vitest` duplica el conteo con `dist/` stale, ver memoria del repo).
   - **(e)** Verificado leyendo: el doc-comment R3 ya no afirma que la tool es inalcanzable.
   **Aceptación**: los cinco bloques presentes. **Si la respuesta no cita y el log no muestra la tool invocada**, no cerrar: volver al Spec Author (R11). Si el entorno no tiene `ANTHROPIC_API_KEY`, el humano ejecuta (a)-(b) y este archivo lo declara igual que la tarea 27 de v3.12.
   Commit: `docs: evidencia de verificacion manual del conocimiento en el chat de empleado (conocimiento-chat-empleado, tarea 8)` → *No es hito completo — falta la tarea 9 (Reviewer, tag).*

9. [x] **Checklist de cierre (AGENTS.md) — sin código; commit, push, merge y tag los ejecuta el HUMANO.**
   - [ ] Reviewer aprobó (`sdd-verify` + `code-review` sin hallazgos bloqueantes), con atención a: **evidencia de la mutación de la tarea 6** (sin ella, rechazar), el commit rojo separado del verde, y que el diff **no** borre el test invertido sino que lo invierta.
   - [ ] Entregable funcional demostrado de punta a punta: consulta de conocimiento por el chat web con cita real (tarea 8a).
   - [ ] `docs/progreso/v3.13-conocimiento-chat-empleado/` contiene: `verificacion-manual-antes.md`, `verificacion-mutacion-knowledgefeedback.md`, `verificacion-manual-tarea-8.md`.
   - [ ] Tag `v3.13.0` creado sobre `main` **tras** el merge de `hito/v3.13-conocimiento-chat-empleado` (numeración confirmada por el checkpoint).
   - [ ] Guardas de alcance de la tarea 8c confirmadas por el Reviewer, no sólo por el Implementer.
   Commit de cierre sólo si queda algo pendiente en la carpeta de progreso (p. ej. un índice); si todo ya está commiteado, el cierre es merge + tag. Mensaje sugerido: `docs: cierra v3.13 - conocimiento en el chat de empleado` · Rama destino: `main` → *Es hito completo sólo con las cuatro casillas de AGENTS.md marcadas: Reviewer aprobado, entregable demostrado, docs/progreso/ creado, listo para tag v3.13.0.*

---

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~345 (rango 300-390), `additions + deletions`, **sin** los artefactos de `openspec/changes/conocimiento-chat-empleado/` |
| Desglose | Producción ejecutable ~14 · doc-comments ~40 (tarea 4 ~6, tarea 7 ~34 con borrados) · tests ~130 (tarea 2 ~120, tarea 3 ~10) · evidencia en `docs/progreso/` ~165 (tarea 1 ~40, 6 ~35, 8 ~90) |
| 400-line budget risk | Medium (conteo bruto cerca del tope; carga real de review baja: ~14 líneas ejecutables en dos archivos, resto tests confirmatorios y evidencia) |
| Chained PRs recommended | No |
| Suggested split | Una sola PR |
| Delivery strategy | No recibida en el prompt de esta fase; se asume `ask-on-risk` para el guard, el orquestador la resuelve |
| Chain strategy | n/a (una sola PR) |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: n/a (single-pr)
400-line budget risk: Medium
```

**Discrepancia con `design.md` §9** (~200 líneas, ~31 de producción): el diseño no contaba las **tres** evidencias (`antes`, `mutación`, `después`, ~165) ni cuatro escenarios de spec (alcanzable, un argumento, roles, `createKnowledge` lanza, ~30 líneas de test), y usaba adiciones netas, no `additions + deletions`. Estimación honesta: ~345, todavía bajo 400.

**Condición para que "Decision needed: No" siga valiendo**: los artefactos de `openspec/changes/conocimiento-chat-empleado/` (proposal ~290 líneas, design ~500, spec ~100, tasks ~250) están sin trackear. Si el humano los commitea **dentro de la misma PR de código**, el conteo bruto pasa de ~1.500 y el guard pasaría a `Decision needed: Yes` (`size:exception`). **Recomendación: commitearlos aparte, antes de abrir la rama de implementación** (mismo consejo que R6 para `ergonomia-canal-empleado`).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Chat de empleado con servidor de conocimiento, sin feedback, con evidencia antes/después y mutación | PR 1 | Base: `main` tras merge y tag de v3.12. Tests, doc-comment y evidencia incluidos; revertible con un `git revert` (ADR 234 rollback) |

**Nota para el orquestador**: si al implementar aparece cualquier archivo de la lista "Fuera de alcance" en el diff (sobre todo `src/core/`, `server.ts`, `operaciones-contract.ts`), el alcance se filtró: el humano se detiene y vuelve al Spec Author.

## Reconciliación de tests contra el spec

| Escenario del delta | Tarea | Estado inicial |
|---|---|---|
| Igualdad de conjunto de `mcpServers` | 2 | Rojo |
| La tool de conocimiento listada es alcanzable | 2 | Rojo |
| Un adaptador por turno, con el `casoId` del turno | 2 | Rojo |
| `handleTurn` no recibe `knowledgeFeedback` | 2, dientes en 6 | Verde |
| El handler nunca toca el puerto de feedback | 2 | Verde |
| Verificación manual: el vault no crece | 8b | Manual |
| El conteo de `OPERACIONES_NEGOCIO` no cambia | 8c (guarda, sin test nuevo) | Verde, sin tocar |
| La fábrica sólo recibe el `casoId` | 2 | Rojo |
| Dos empleados con roles distintos, mismo conjunto | 2 | Rojo |
| `createKnowledge` lanza | 2 | Rojo |
| La consulta al vault falla pero el turno no | Ninguna: ya cubierto por `knowledge-tool.test.ts` vigente, el change no lo altera | Verde, sin tocar |
| MODIFIED `allowedTools` base 3 / variante 4 | Ninguna: `definitions.test.ts:108-131` vigente cubre el estado real; el delta sólo corrige el texto de la spec | Verde, sin tocar |
| Verificación manual de wiring en `main.ts` (R12) | 3 | Rojo |
