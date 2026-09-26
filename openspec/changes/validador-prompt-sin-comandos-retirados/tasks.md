# Tasks: `validador-prompt-sin-comandos-retirados` — el prompt del validador deja de nombrar comandos retirados, con una guarda sobre todos los textos de agente

**Origen**: [`proposal.md`](proposal.md) · [`design.md`](design.md) (ADR 303, RD-175, C1-C6, H1-H8) · specs delta: [`solicitud-interna-hitl`](specs/solicitud-interna-hitl/spec.md), [`delegacion-subagentes`](specs/delegacion-subagentes/spec.md).

**Metodología**: TDD estricto (`strict_tdd: true`). RED (`test`) → GREEN (`fix`/`feat`) → REFACTOR (`refactor`), commits separados. El rojo se declara con `npm test` **y** `npm run typecheck`, salida pegada en el cuerpo del commit. **Nace verde (declararlo, sin forzar un rojo artificial)**: el test del conteo del inventario (2.1 b); su diente se prueba por mutación (M6). **Sin commit**: G0 y Fase 6. **Único test existente que se edita, a propósito**: la guarda A3 de `reporte.test.ts:610-625` (sólo en el REFACTOR 4.2, sin cambiar su intención). El resto son adiciones.

**Fuera del diff de código** (si aparecen, el change se salió de alcance): `comando-empleado.ts`, `registro-acciones-contract.ts`, `ejecutar-operacion.ts`, `resolver-solicitud-interna.ts`, `dispatch-delegation.ts`, `soporte-prompt.ts`, `a2a-entrante-prompt.ts`, `activity-prompt.ts`, `src/adapters/**`, migraciones, `.claude/skills/**`, `package.json`.

**Formato de commit**: `<tipo>(<scope>): <descripción> (Hito v3.22, tarea N)`. Scopes (según `git log` de cada archivo): `test` (`src/test/`), `agents` (`definitions.ts`, la guarda), `core` (`crear-solicitud-interna.ts`, `reporte.test.ts`), `root` (evidencia en `docs/progreso/`), `spec` (nota en otro change), `arc42`. Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md).

**Gotcha de Git Bash**: un patrón de `rg` que empieza con `/` se reescribe como ruta de Windows y devuelve 0 coincidencias. Usar `MSYS_NO_PATHCONV=1` en todas las búsquedas de esta lista.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **≈ 230-345** (`additions + deletions`, detalle en `design.md` §7). Producción: ≈ 12-20 |
| 400-line budget risk | **Low** |
| Chained PRs recommended | No |
| Suggested split | Una sola PR |
| Delivery strategy | `ask-on-risk` → no dispara (riesgo bajo) |
| Chain strategy | N/A |
| Tamaño real hasta 6.4 (`git diff bd34360 HEAD --stat -- . ":(exclude)openspec"`) | **427** (420 inserciones + 7 borrados): `src` ≈ 239 (producción ≈ 21: dos literales y doc-comments; el resto tests), `docs/progreso/` 188 (`mutaciones.md` 123, más detallado que lo estimado). Supera el estimado (230-345) y el umbral de 400, sin contar el arc42 de 7.1 (≈ 20-30). WARNING del Reviewer (6.5): no se re-evaluó la estrategia al cruzar el umbral. **Decidido (2026-09-26): PR única con `size:exception`** (registrado en RD-175) |

```text
Decision needed before apply: Yes (checkpoint humano: C1-C6, ver "Checkpoint needed")
Chained PRs recommended: No
Chain strategy: N/A
400-line budget risk: Low
```

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Helper del token (1.1-1.2) | PR única | Test-only, excluido del build |
| 2 | Guarda + tests de contenido + textos nuevos (2.1-3.2) | PR única | Único cambio de producción: dos literales |
| 3 | Refactor de comentarios y guarda del v3.21 (4.1-4.2) | PR única | Sin cambio de comportamiento |
| 4 | Mutación y evidencia (5.1-5.2) | PR única | Sólo `docs/` |
| 5 | Cierre post-Reviewer (7.1-7.3) | Commit de cierre | ADR 303 al arc42 |

---

## Checkpoint needed

Decisiones que toma el humano antes de 1.1. Todas con recomendación del Spec Author.

**Decidido (2026-09-26)**: C1-C6 aprobadas tal cual las recomendó el Spec Author. `Decision needed before apply` pasa a **No**.

1. **C1, quién decide**: ¿el prompt dice *"persona autorizada, distinta de quien la pidió"* o *"administrador"*? Recomendado: **"persona autorizada"**. No duplica la política de `autorizacion-resolucion.ts` y sobrevive a `permisos-granulares`.
2. **C2, instrucción de delegación**: ¿se alinea también `crear-solicitud-interna.ts:133` (hoy *"un empleado autenticado"*, falso desde `autorizacion-empleado`)? Recomendado: **sí**; son 2 líneas y evita que el modelo reciba dos versiones de quién decide.
3. **C3, alcance de la guarda**: ¿las diez fuentes de `design.md` §4.2 (siete agentes + soporte + operaciones-empleado + A2A), dejando skills, descripciones de tools y `buildActivityPrompt` en la Deuda 14? Recomendado: **sí**.
4. **C4, registro**: ¿ADR 303 + RD-175 nuevos o extender el ADR 302? Recomendado: **ADR 303 + RD-175** (regla transversal distinta de la enmienda al ADR 26; revert aislado). El 302 recibe sólo una nota *"Generalizado por ADR 303"*.
5. **C5, guarda del v3.21**: ¿se migra al helper (arregla el corte de `/ver-solicitudes-a2a`)? Recomendado: **sí**, en el REFACTOR.
6. **C6, dictámenes persistidos**: ¿se reescriben los que ya nombren los comandos? Recomendado: **no**; son registro histórico de la salida del modelo. Se cuentan en la evidencia.

---

## Gate G0 — Precondiciones (sin commit)

- [x] **G0.1** Checkpoint aprobado (bloque de arriba), con la respuesta registrada en este archivo. *(2026-09-26)*
- [ ] **G0.2** El humano crea la rama `hito/v3.22-validador-prompt-sin-comandos-retirados` desde `main`. *(Pendiente: la Fase 1 se escribió en el working tree de `main` sin commit; `git switch -c` se lleva los cambios.)*
- [x] **G0.3** *(2026-09-26, anclajes y techo re-verificados en la fase design de la misma sesión)* Re-verificar anclajes con `rg`/`Read`: `definitions.ts:320-334` (validador), `crear-solicitud-interna.ts:127-141`, `dispatch-delegation.ts:216,234`, `reporte.test.ts:610-625`, `comando-empleado.ts:360` (`COMANDOS`), `tsconfig.build.json:3`. Re-verificar el techo con los dos comandos de `design.md` §2 (ambos deben dar 0).
- [x] **G0.4** *(2026-09-26: 162 archivos pasan, 2 skipped; 3324 tests pasan, 5 skipped; typecheck verde)* Línea base: `npm test` y `npm run typecheck` verdes con `dist/` limpio (si hay `dist/` viejo, vitest duplica el conteo). Anotar el conteo de archivos y tests.

## Phase 1: Helper del token (`src/test/comandos-en-texto.ts`)

- [x] **1.1** *(2026-09-26: rojo por `Cannot find module './comandos-en-texto.js'` en vitest y en typecheck, TS2307)* RED — `src/test/comandos-en-texto.test.ts` (nuevo). Tabla de `design.md` §5 T3: (a) `src/core/agents`, `./activity-contract.js`, `../commands`, `https://example.com/aprobar`, `y/o`, `` `Write`/`Edit` ``, `~/datos`, `año/mes` → `[]`; (b) `usá /ver-solicitudes-a2a para verlas` → `["/ver-solicitudes-a2a"]`; (c) `(/login)`, `«/ayuda»`, `"\n/soporte"` reconocidos; (d) dos llamadas seguidas sobre el mismo texto dan el mismo resultado; (e) `tokensComandoInexistentes("usá /aprobar-solicitud o /login", new Set(["/login"]))` → `["/aprobar-solicitud"]`. Spec: `delegacion-subagentes`, scenarios 4 y 5.
*Aceptación (rojo)*: falla por import inexistente. Typecheck rojo por el mismo motivo. `git diff` sólo toca el archivo nuevo.
Commit: `test(test): define la tabla de tokens con forma de comando que distingue rutas y urls, rojo (Hito v3.22, tarea 1.1)`

- [x] **1.2** *(2026-09-26: 14/14 verdes; suite 163 archivos, 3338 tests, 5 skipped; typecheck y build verdes; `dist/test/` no existe)* GREEN — `src/test/comandos-en-texto.ts` (nuevo): `PATRON_TOKEN_COMANDO`, `extraerTokensComando`, `tokensComandoInexistentes`, exactamente como `design.md` §4.1. Doc-comment con la regex pieza por pieza y los límites conocidos (mayúsculas, tilde, guion final: se reformula el texto, no se afloja la regex).
*Aceptación*: 1.1 verde; `npm test`, `npm run typecheck` verdes; `npm run build` verde y `dist/` **no** contiene `test/comandos-en-texto.js`.
Commit: `feat(test): agrega el extractor compartido de tokens de comando para las guardas de texto al modelo (Hito v3.22, tarea 1.2)`

## Phase 2: Guarda sobre el inventario y tests de contenido (RED)

- [x] **2.1** *(2026-09-26: (a) rojo con `validador-solicitudes:systemPrompt` → `/aprobar-solicitud`, `/rechazar-solicitud`; (b) nace verde)* RED — `src/core/agents/textos-modelo-sin-comandos.test.ts` (nuevo), inventario de `design.md` §4.2 con `WorktreeAbierto` falso. (a) *"ningún texto de agente del núcleo nombra un comando que no existe"*: rojo, reporta `validador-solicitudes:systemPrompt` con `/aprobar-solicitud` y `/rechazar-solicitud`. (b) *"el inventario no es vacío"*: 10 fuentes con id distinto, 17 textos no vacíos; **nace verde** (declararlo). Spec: `delegacion-subagentes`, scenarios 1-3.
- [x] **2.2** *(2026-09-26: rojo, falta "persona autorizada")* RED — `src/core/agents/definitions.test.ts`: nuevo `it` T4 de `design.md` §5 (frases requeridas, frases prohibidas, `description` igual al literal actual, `allowedTools` vacío). Spec: `solicitud-interna-hitl`, scenarios *"El validador sabe quién decide…"* y *"El rol del validador no cambia"*.
- [x] **2.3** *(2026-09-26: rojo, la `tareaDelegada` dice "un empleado autenticado"; suite: 3 failed / 3339 passed / 5 skipped, typecheck verde)* RED — `src/core/solicitudes/crear-solicitud-interna.test.ts`: nuevo `it` T5 (inspecciona la llamada a `invocar`: `agent.id`, `agent.systemPrompt`, `tareaDelegada`). Spec: `solicitud-interna-hitl`, scenario *"Lo que recibe el validador no nombra comandos retirados"*.
*Aceptación (rojo, las tres juntas)*: fallan 2.1 (a), 2.2 y 2.3; 2.1 (b) y el resto de la suite verdes. Typecheck verde. `git diff` sólo toca esos tres archivos de test. Pegar la salida.
Commit: `test(agents): exige que el validador y todo texto de agente del nucleo nombren solo comandos vigentes, rojo (Hito v3.22, tarea 2)`

## Phase 3: Textos nuevos (GREEN)

- [x] **3.1** *(2026-09-26: 2.1 (a) y 2.2 verdes; sólo 2.3 rojo, estable en 3 corridas. Una 1.ª corrida mostró un 2.º rojo intermitente no reproducido, ajeno al diff)* GREEN — `src/core/agents/definitions.ts:326-331`: reemplazar el `systemPrompt` del validador por el texto **exacto** de `design.md` §3.1. `id`, `description`, `allowedTools` y `model` no cambian.
*Aceptación*: 2.1 (a) y 2.2 verdes; 2.3 sigue rojo **sólo** por la aserción de `tareaDelegada`.
Commit: `fix(agents): el prompt del validador deja de nombrar los comandos de resolucion dados de baja en v3.10.0 (Hito v3.22, tarea 3.1)`

- [x] **3.2** *(2026-09-26: suite 164 archivos, 3342 tests, 5 skipped; typecheck y build verdes; el `rg` residual sólo matchea `definitions.ts:245`, doc del agente de operaciones, uso correcto de "empleado autenticado")* GREEN — `src/core/solicitudes/crear-solicitud-interna.ts:133`: reemplazar `instruccion` por el texto **exacto** de `design.md` §3.2. `material` no cambia. (Condicionada a C2; si C2 = no, se elimina la aserción de `tareaDelegada` de 2.3 antes de 2.x y esta tarea no existe.)
*Aceptación*: suite completa verde; `npm run typecheck` y `npm run build` verdes. `MSYS_NO_PATHCONV=1 rg -n 'aprobar-solicitud|rechazar-solicitud|empleado autenticado' src/core/agents/definitions.ts src/core/solicitudes/crear-solicitud-interna.ts` sólo matchea comentarios (los limpia 4.1).
Commit: `fix(core): la instruccion de delegacion al validador dice que decide una persona autorizada distinta del solicitante (Hito v3.22, tarea 3.2)`

## Phase 4: Refactor (sin cambio de comportamiento)

- [x] **4.1** *(2026-09-26: +13 líneas, sólo comentarios; suite 164 archivos / 3342 tests verde)* REFACTOR — doc-comment de `VALIDADOR_SOLICITUDES_AGENT` en `definitions.ts` (agregar si no hay): por qué el texto no nombra comandos, canales ni `resolver_solicitud` (el dictamen se muestra tal cual al solicitante y al administrador), cita ADR 303 y la regla *"quien baje un comando corre la guarda de `textos-modelo-sin-comandos.test.ts`"*. Comentario junto a la `instruccion` de `crear-solicitud-interna.ts` apuntando al mismo ADR.
*Aceptación*: suite verde sin tocar tests; `git diff` de esta tarea sólo en comentarios.
Commit: `refactor(agents): documenta por que el validador no nombra comandos ni canales (Hito v3.22, tarea 4.1)`

- [x] **4.2** *(2026-09-26: `reporte.test.ts` 36/36; suite 164 archivos / 3342 tests verde; `rg` de la regex vieja sin coincidencias)* REFACTOR — `src/core/ventas/reporte.test.ts:617-622`: la guarda A3 usa `tokensComandoInexistentes` en vez de su regex inline. Mismo nombre del `it`, misma intención (condicionada a C5).
*Aceptación*: suite verde antes y después; `rg -n 'a-z\]\[a-z-\]' src/core/ventas/reporte.test.ts` sin coincidencias.
Commit: `refactor(core): la guarda de la nota del reporte usa el extractor compartido de tokens de comando (Hito v3.22, tarea 4.2)`

## Phase 5: Mutación y evidencia manual (excepciones TDD, sólo `docs/`)

- [x] **5.1** *(2026-09-26: M1-M6 rojas con la mutación, verdes revertidas, sha igual, `git status --short src` vacío; ver `mutaciones.md`)* Mutaciones en `docs/progreso/v3.22-validador-prompt-sin-comandos-retirados/mutaciones.md`. Cada una: rojo con la mutación, verde revertida, `git diff -- src` vacío tras el revert.
  - **M1**: volver a poner `` `/aprobar-solicitud` `` en el prompt del validador ⇒ fallan 2.1 (a) y 2.2.
  - **M2**: quitar *"distinta de quien la pidió"* del prompt ⇒ falla 2.2.
  - **M3**: volver a poner *"un empleado autenticado"* en la `instruccion` ⇒ falla 2.3.
  - **M4**: regex del helper con `[a-z][a-z-]*` ⇒ falla 1.1 (b).
  - **M5**: quitar `.` del lookbehind ⇒ falla 1.1 (a) (`./activity-contract.js`).
  - **M6**: sacar `buildSolicitudA2APrompt` del inventario ⇒ falla 2.1 (b).
- [ ] **5.2** *(PARCIAL 2026-09-26: README con pasos, comandos y tablas `_pendiente_`, más los conteos automáticos. Faltan los pasos 2-4, que ejecuta el humano sobre la copia)* Evidencia manual en `docs/progreso/v3.22-validador-prompt-sin-comandos-retirados/README.md`. **Nunca sobre `data/harness.db`**; la ejecuta el humano (un agente no lee la base real):
  1. Copia: `cp data/harness.db "$TMP/harness-v3.22.db"` y exportar `HARNESS_DB_PATH` a esa copia en la terminal que arranca el arnés.
  2. Conteo previo de dictámenes viejos (C6), sobre la copia: `sqlite3 -readonly "$TMP/harness-v3.22.db" "SELECT COUNT(*), SUM(dictamen LIKE '%aprobar-solicitud%' OR dictamen LIKE '%rechazar-solicitud%') FROM solicitudes_internas;"`. Registrar los dos números.
  3. Arrancar el chat web como indica `docs/Guia-Demostracion-Pasantia.md`, con `HARNESS_DB_PATH` apuntando a la copia; iniciar sesión como un empleado no administrador y crear **tres** solicitudes (vacaciones completa, gasto sin monto, otro trámite ambiguo).
  4. Pegar los tres textos *"Solicitud X creada … Dictamen: …"* y registrar, como **observación** (no assert), si alguno nombra un comando, una herramienta o un paso de resolución. Esperado: no.
  5. Registrar el resultado de `npm test` con el conteo de la línea base (G0.4) + los tests nuevos.
*Aceptación*: `git diff --stat` de 5.x sólo toca `docs/progreso/v3.22-…/`.
Commit: `docs(root): registra las mutaciones y la evidencia del prompt del validador sin comandos retirados (Hito v3.22, tarea 5)`

## Phase 6: Verificación final (sin commit)

- [x] **6.1** *(2026-09-26)* `npm run typecheck` verde.
- [x] **6.2** *(2026-09-26: dos corridas, 164 archivos / 3342 tests / 5 skipped; el intermitente de 3.1 no reapareció)* `npm test` verde con `dist/` limpio; conteo = línea base + nuevos.
- [x] **6.3** *(2026-09-26)* `npm run build` verde.
- [x] **6.4** *(2026-09-26, contra merge-base bd34360: sólo los archivos listados; fuera de alcance vacío. origin/main avanzó a ed494de (PR #36, sólo evaluacion/): merge-tree limpio, techo ADR/RD intacto)* Guarda de alcance: `git diff main --stat` sólo lista `definitions.ts` (+test), `crear-solicitud-interna.ts` (+test), `src/test/comandos-en-texto.ts` (+test), `textos-modelo-sin-comandos.test.ts`, `reporte.test.ts`, `docs/progreso/v3.22-…/` y los artefactos del change. `git diff main --` sobre la lista *"Fuera del diff de código"* de arriba, **vacío**.
- [x] **6.5** *(2026-09-26, Reviewer fresco (sdd-verify): VEREDICTO aprobado. 0 CRITICAL, 1 WARNING (tamaño real 427 > 400 sin re-evaluar la estrategia; ver forecast), 0 SUGGESTION. Textos exactos a design §3.1/§3.2, cada scenario con test, inventario 10/17 confirmado sin constructores faltantes, alcance limpio, suite 164/3342 dos veces)* Revisión fresca (Reviewer). Sin su aprobación no arranca la Fase 7.

## Phase 7: Cierre (sólo tras la aprobación del Reviewer; no es tarea del Implementer)

- [x] **7.1** *(2026-09-26: +40/-0 en el arc42: nota bajo ADR 302, Concepto 14, ADR 303, RD-175 (con la decisión size:exception), Deuda 14; techo re-verificado en origin/main; suite 3342 verde)* `docs/ARC42_Harness_Empresarial.md`: Concepto 14 (v3.22), **ADR 303** con el texto de `design.md` §10, **RD-175** (C1-C6 como se decidieron), **Deuda 14** (`design.md` §8). Bajo el ADR 302, una línea *"Generalizado por ADR 303 (v3.22)"* sin reescribirlo. Reverificar el techo antes de escribir (otro change pudo tomar el 303 mientras tanto).
Commit: `docs(arc42): registra el ADR 303, la RD-175 y la deuda 14 tras la guarda de comandos en textos de agente (Hito v3.22, tarea 7.1)`
- [ ] **7.2** *(BLOQUEADA: requiere el checklist de cierre de AGENTS.md, en particular el entregable demostrado = 5.2. Precedente: el v3.21 tampoco corrió sdd-archive y `openspec/specs/` sigue vacío)* `sdd-archive`: fusionar `solicitud-interna-hitl` (MODIFIED) sobre `hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md:28-41`, por nombre exacto del requirement y sin perder los MODIFIED de `aprobacion-conversacional-hitl`; y `delegacion-subagentes` (ADDED) sobre hito-2.0 + el MODIFIED de `hito-2.1-escritura-delegada`. Ver las notas de base al inicio de cada delta.
- [x] **7.3** *(2026-09-26, memoria del proyecto actualizada)* Engram / memoria: estado de v3.22 cerrado.

## Dependencias entre tareas

```text
G0 → 1.1 → 1.2 → 2.1+2.2+2.3 (un commit) → 3.1 → 3.2 → 4.1 → 4.2 → 5.1 → 5.2 → 6.x → Reviewer → 7.1 → 7.2 → 7.3
```

2.x depende de 1.2 (importa el helper). 4.2 depende de 1.2. 5.1 depende de 4.2 (M4/M5 se miden sobre el helper final).
