> **Nota de proceso**: fase `sdd-tasks` sin shell, así que **no pudo correrse `graphify query`** pese al hook (misma nota que `proposal.md` y `design.md`). Los anclajes `archivo:línea` se re-verificaron con `Read`/`Grep` sobre `main` (`2195a17`): `comando-empleado.ts:113,202,360,434,531`; `App.tsx:183,284,345,402,579,586`; `comandos-administracion-empleados/design.md:256`. `sdd-apply` **debe re-`Grep`ear cada uno** antes de tocar.
>
> **Formato de commit**: `<tipo>(<scope>): <descripcion> (Hito vX.Y, tarea N)`. Scopes: `core` (helper), `adapters/tui` (App), `root` (evidencia y docs), `spec` (deltas). `N` es el id jerárquico. Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md).
>
> **Por qué `vX.Y` queda sin resolver**: **no es un hito del Plan** y `v3.20` ya lo reserva `respaldo-y-durabilidad-sqlite` (`proposal.md:5`). El número lo fija el checkpoint (recomendado: el próximo minor libre al mergear, `v3.21` **sólo si** respaldo conserva `v3.20`). Rama prevista: `hito/vX.Y-enmascarar-password-en-tui` (`vX.Y` a definir en el checkpoint), creada por el humano **después** del checkpoint. Se reemplaza el placeholder en los commits, en la rama y en `docs/progreso/vX.Y-enmascarar-password-en-tui/`.

# Tasks: `enmascarar-password-en-tui` — la clave de `/login` y `/crear-empleado` deja de verse en la TUI

**Origen**: [`proposal.md`](proposal.md) · [`design.md`](design.md) (ADR 300, RD-172, U1-U7, T1-T8, R1-R14) · specs: [`comando-empleado-tui`](specs/comando-empleado-tui/spec.md), [`autenticacion-empleado-tui`](specs/autenticacion-empleado-tui/spec.md), [`administracion-empleados-tui`](specs/administracion-empleados-tui/spec.md).

**Metodología**: TDD estricto (`strict_tdd: true`). ROJO (`test`) antes del VERDE (`feat`), en commits separados; el rojo se declara con `npm test` **y** `npm run typecheck`, con la salida en el cuerpo del commit. **Nacen verdes (declararlo)**: T2, T6 y T7 (describen comportamiento vigente; sus dientes se prueban por mutación en 5.1). **Sin commit**: verificaciones 3.3, 4.1 y 6.x. **Ningún test existente se edita** (design §7.2; ver Inconsistencia I3). **Fuera del diff**: `tui-port.ts`, `start-tui.tsx`, `build-on-comando-empleado.ts`, `main.ts`, `src/adapters/web/**`, `src/empleados.ts`.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **~260-350** (`additions + deletions`): helper +35-45, tests core +70-90, `App.tsx` +20-35, tests TUI +80-110, arc42 +25-35, nota +2-4, evidencia +20-30. Sin contar `openspec/changes/enmascarar-password-en-tui/` |
| 400-line budget risk | **Medium** (el techo ~350 deja ~50 líneas de margen; el design dice Low con 250-350) |
| Chained PRs recommended | No |
| Suggested split | **Una sola PR**. Corte opcional si se acerca a 400: PR #1 = 1.1-1.4 (helper inerte, `feat(core)`) → PR #2 = 2.1-5.2 |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | pending |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium
```

**"No" vale sólo para el presupuesto de review.** Antes de `sdd-apply` sigue el **checkpoint humano** (G0): número de hito, decisiones I1-I2 y las preguntas abiertas de `design.md` §10.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Helper `enmascararSecreto`/`contieneSecreto` (1.1-1.4) | PR única | Aditivo e **inerte** (nadie lo importa aún). Rollback = `git revert` |
| 2 | `PromptInput` + `submitDraft` (2.1-3.3) | PR única | Reverter sólo `App.tsx` devuelve la conducta anterior |
| 3 | Mutación, evidencia manual y docs (4.1-5.3) | PR única | Sólo `docs/`, `openspec/` |
| 4 | Cierre post-Reviewer (7.1-7.2) | Commit de cierre | ADR 300 + arc42, sólo tras el Reviewer |

---

## Inconsistencias detectadas para el checkpoint

No se resolvieron aquí. La tarea 0.1 queda **condicionada** a la decisión.

- **I1 — Predicado del historial**: `design.md` §3.1/§4 elige `contieneSecreto` (estructural). El spec `autenticacion-empleado-tui` (requirement ADDED) dice *"para todo texto que la función de enmascarado transforme"*. Difieren en `/login ana ***` (clave de sólo `*`): el design lo excluye del historial, el spec lo guardaría. `design.md` §10 ya lo marca. **Las tareas 1.x y 3.x siguen el design.**
- **I2 — T5 contra el spec**: T5 del design afirma *"ningún frame posterior al ↑ contiene `/login ana`"*, pero el eco `Vos: /login ana *******` queda en `<Static>` y aparece en `frames` (design §7.2). El scenario del spec (*"en ningún momento se muestra `/login ana secreto` ni su versión enmascarada"*) es igual de ambiguo. Igual para T1 (*"ni un prefijo suyo"*: `s` aparece en otras palabras). **Tareas 2.1/3.1 afirman sólo sobre la línea del prompt** (`> …`), no sobre el frame entero.
- **I3 — Tests existentes**: el pedido dice *"ajustar los tests existentes de `App.test.tsx` que cambian"*. El design (§7.2) y la propuesta (R5) dicen **ninguno cambia**. **Se sigue el design**: 3.3 lo verifica y, si alguno rompe, se **detiene** y se escala.
- **I4 — Cuándo se edita el arc42**: `design.md` §2 dice *"cuando el Reviewer cierre"*; §9 dice *"en el apply"*; §10 lo lista como commit 5. **Se planifica como cierre (Fase 7)**, tras el Reviewer. La nota de reemplazo de `comandos-administracion-empleados/design.md:256` **sí** va en el apply (5.3).

---

## Gate G0 — Precondiciones (sin commit)

- [ ] Checkpoint humano aprobó spec, diseño y tareas, ratificó ADR 300 / RD-172 (D2 (a), D3 longitud real, D4 no guardar, punto 5 rotación *recomendada*), aceptó R2 y R10, resolvió I1-I4 y fijó `vX.Y`. Rama creada por el humano desde `main`.
- [ ] `delivery_strategy` decidida (Forecast).
- [ ] Línea base verde: `npm test`, `npm run typecheck`, `npm run build` (borrar `dist/` antes: `vitest` duplica el conteo con `dist/` stale).
- [ ] Re-`Grep` de los anclajes de la nota de proceso.
- [ ] Si el hermano `reembolso-resta-monto-vendido-en-reporte` ya tiene carpeta: reverificar que no reclamó el ADR 300 / RD-172 (R8).

## Phase 0: Alinear spec con design (condicionada a I1/I2)

- [x] **0.1** *Sólo si el checkpoint mantiene `contieneSecreto`.* Editar `specs/autenticacion-empleado-tui/spec.md`: (a) en el requirement *"La contraseña tipeada no aparece en ningún frame de la TUI"*, cambiar *"que la función de enmascarado … transforme"* por *"que tenga tramo secreto no vacío (`contieneSecreto`)"*; (b) acotar los scenarios de borrador e historial a **la línea del prompt**; (c) agregar un scenario para `/login ana ***`. Si el checkpoint elige el predicado `!==`, se invierte: se ajusta el design (§3.1, §4 #3) y U6/T5.
*Aceptación*: `rg "transforme" openspec/changes/enmascarar-password-en-tui/specs` sin coincidencias; `git diff` sólo toca ese archivo.
Commit: `docs(spec): alinea el requirement de historial con contieneSecreto y acota los frames a la linea del prompt (Hito vX.Y, tarea 0.1)`

> **Progreso (Spec Author, tarea 0.1, 2026-09-24)**: checkpoint humano confirmó I1 = `contieneSecreto` (estructural, ya implementado en `App.tsx` commit `bbd6491`). Se editó sólo `specs/autenticacion-empleado-tui/spec.md`: (a) requirement reescrito con "que tenga tramo secreto no vacío (`contieneSecreto`)"; (b) scenarios "Borrador enmascarado mientras se tipea" y "Las líneas con clave no entran al historial de flechas" acotados a la línea del prompt (`> …`), aclarando que el eco `Vos: /login ana *******` en `<Static>` queda fuera y no cuenta (I2); (c) nuevo scenario "Clave hecha sólo de asteriscos igual queda fuera del historial" para `/login ana ***`. `rg "transforme" openspec/changes/enmascarar-password-en-tui/specs` sin coincidencias; `git diff --stat` sólo toca este archivo (más este registro en `tasks.md`).

---

## Phase 1: Helper puro (`src/core/commands/comando-empleado.ts` + `comando-empleado.test.ts`)

- [x] **1.1** ROJO — `describe` nuevo en `src/core/commands/comando-empleado.test.ts` (sólo agregar), tabla de contrato. **U1** (`it.each` de los scenarios literales: `/login ana s3cret`→`/login ana ******`, `/login ana s3cr et`→7 `*`, `/crear-empleado bob abc`→`***`, `  /login  ana  pw`→`  /login  ana ***`). **U2** (intactos: `/login`, `/login ana`, `/login ana `, `/crear-empleado bob`, `/estado-bot-prs`, `/soporte ayuda con mi clave`, `hola /login x y`, `""`). **U3** (residual R2 fijado: `/logni ana secreto`, `/Login ana secreto`, `/login\tana secreto` intactos). **U6** (`contieneSecreto`: `true` para U1 y `/login ana ***`; `false` para U2 y U3). Spec: `comando-empleado-tui` (scenarios de función pura, no-secretos y typo).
*Aceptación (rojo)*: `npm run typecheck` falla (los dos exports no existen) y `npm test -- comando-empleado` falla; suite vigente verde; `git diff` = sólo adiciones. Pegar ambas salidas. **Abre la ventana de typecheck rojo `1.1→1.3`.**
Commit: `test(core): exige la tabla de casos de enmascararSecreto y contieneSecreto, incluido el residual del typo, rojo de tipo (Hito vX.Y, tarea 1.1)`

- [x] **1.2** ROJO — mismo `describe`. **U4 (paridad, R1)**: por cada descriptor de `COMANDOS.filter(d => d.secreto)` × variantes de espaciado (simple, al inicio, dobles, internos, de cola, `\t` tras el separador, clave de 1 carácter): si `parsearComando(t)` devuelve `password`, entonces `m = enmascararSecreto(t)` cumple `m.length === t.length`, coincide con `t` hasta el primer `*`, desde ahí es `/^\*+$/`, y el tramo `[t.trimEnd().length - password.length, t.trimEnd().length)` cae dentro de los `*`. Si un descriptor secreto **no** produce `password`, el test **falla con mensaje explícito** (un secreto futuro con otro nombre obliga a revisar). **U5** (tecla a tecla: para cada prefijo de `/login ana s3cr et` y `/crear-empleado bob secreto-largo-123`, lo que sigue a `"<cmd> <id> "` es sólo `*`). **U7** (idempotencia, `.length` igual y un emoji en la clave produce 2 `*`, ADR 300 pto 4). No editar `comando-empleado.test.ts:556-558`.
*Aceptación (rojo)*: typecheck sigue rojo por 1.1; los tres `it` fallan; `git diff` = sólo adiciones.
Commit: `test(core): exige la paridad de la mascara con parsearComando sobre todos los descriptores secretos y el tecleo tecla a tecla, rojo (Hito vX.Y, tarea 1.2)`

- [x] **1.3** VERDE — `src/core/commands/comando-empleado.ts`: `NOMBRES_SECRETOS` (`Set` calculado una vez desde `DESCRIPTORES.filter(d => d.secreto)`), `inicioTramoSecreto` (privada; mismo `trimStart` `:531`, mismo corte `indexOf(" ")`, id y separador según design §3.2) y los **únicos dos exports nuevos**, `enmascararSecreto` (puro, misma longitud, idempotente) y `contieneSecreto`. Cero imports nuevos; `DESCRIPTORES`, `Forma` y `splitPrimerEspacio` siguen privados.
*Aceptación*: 1.1 y 1.2 en verde; `npm run typecheck` verde (**cierra `1.1→1.3`**); `npm test` y `npm run build` verdes; `rg "^import" src/core/commands/comando-empleado.ts` sin líneas nuevas.
Commit: `feat(core): agrega enmascararSecreto y contieneSecreto derivados del flag secreto y del parser (Hito vX.Y, tarea 1.3)`

- [x] **1.4** REFACTOR — `comando-empleado.ts:113`: el comentario *"`true` SOLO para `/login`"* pasa a *"`/login` y `/crear-empleado`; lo consume además la máscara de la TUI (ADR 300)"*. Doc-comments de los dos exports. Sin cambio de comportamiento.
*Aceptación*: `rg "SOLO para" src/core/commands/comando-empleado.ts` sin coincidencias en `:113`; suite verde sin tocar tests.
Commit: `refactor(core): corrige el comentario del flag secreto y documenta la mascara (Hito vX.Y, tarea 1.4)`

> **Progreso (sdd-apply, Phase 1, 2026-09-24)**: 1.1-1.4 hechas, **sin commitear** (rama `main`; el humano crea `hito/vX.Y-enmascarar-password-en-tui`). ROJO 1.1: typecheck TS2305 x2 y 34 tests rojos (`... is not a function`); ROJO 1.2: 41 rojos en total (+7). VERDE 1.3: `comando-empleado.test.ts` 168/168, typecheck y build verdes, cero imports nuevos. Un `it` de U4 nace verde a propósito (guarda anti-bucle-vacío, sólo lee `COMANDOS`). Longitud en unidades UTF-16 (design §3.1 y ADR 300 pto 4): un emoji = 2 `*`. Faltan Phase 0 (condicionada a I1), 2-6 y el Reviewer.

## Phase 2: `PromptInput` enmascara el borrador (`src/adapters/tui/App.tsx` + `App.test.tsx`)

- [x] **2.1** ROJO — `describe("secret masking (ADR 300)")` nuevo en `src/adapters/tui/App.test.tsx` (sólo agregar; reusar `renderApp`, `waitFor`, `ENTER`, `BACKSPACE`). **T8** (`PromptInput({ draft: "/login ana pw" })` → `<Text>` es `> /login ana **`; molde `:1031-1048`). **T1** (`stdin.write` carácter a carácter de `/login ana secreto`; `lastFrame()` contiene `> /login ana *******` y **ningún** elemento de `frames` tiene, **en la línea del prompt**, algo distinto de `*` tras `/login ana `; I2). **T4** (backspace: `> /login ana ******`; al enviar, `onSubmit` recibe `/login ana secret`). **T7** (`/logni ana secreto` visible: residual R2; **nace verde**, declararlo).
*Aceptación (rojo)*: `npm test -- App` falla en T8, T1 y T4; typecheck verde; los tests existentes (`PromptInput({ draft: "hola" })`, `:1033`) siguen verdes.
Commit: `test(adapters/tui): exige que el borrador de /login y /crear-empleado se dibuje enmascarado y conserve el feedback de longitud, rojo (Hito 3.20, tarea 2.1)`

- [x] **2.2** VERDE — `App.tsx`: import de `enmascararSecreto` desde `../../core/commands/comando-empleado.js` (**primer import de `core` en `src/adapters/tui`**, H5) y `PromptInput` (`:402`) dibuja `` `> ${enmascararSecreto(draft)}` ``. La prop `draft`, `draftRef` y `draft` siguen siendo el texto **real**. Actualizar el comentario de `PromptInput`.
*Aceptación*: 2.1 en verde; `npm test`, `npm run typecheck`, `npm run build` verdes; `rg "core/" src/adapters/tui/App.tsx` = un solo import; `rg "adapters" src/core` sin coincidencias nuevas.
Commit: `feat(adapters/tui): dibuja el borrador enmascarado con enmascararSecreto dentro de PromptInput (Hito 3.20, tarea 2.2)`

> **Progreso (sdd-apply, Phase 2, 2026-09-24)**: 2.1-2.2 hechas, **sin commitear** (rama `hito/v3.20-enmascarar-password-en-tui`; el humano commitea). ROJO 2.1: `npm test -- App` 3 rojos (T8, T1, T4) y 37 verdes (incluido T7 nacido verde); `npm run typecheck` verde. VERDE 2.2: `App.tsx` importa `enmascararSecreto` (primer import de `core` en `src/adapters/tui`, único import nuevo) y `PromptInput` dibuja `` `> ${enmascararSecreto(draft)}` ``; `draft`/`draftRef` sin cambios. `npm test` 3302/3302 (162 archivos, 2 skip preexistentes), `npm run typecheck` y `npm run build` verdes; `rg "core/" src/adapters/tui/App.tsx` = un import; `rg "adapters" src/core` sin `import` nuevo (sólo doc-comments preexistentes). Faltan Phase 0 (condicionada a I1), 3-6 y el Reviewer.

## Phase 3: Eco del turno e historial (`App.tsx` + `App.test.tsx`)

- [x] **3.1** ROJO — mismo `describe`. **T2** (`onSubmit` recibe `"/login ana secreto"` intacto, R6; **nace verde**, declararlo). **T3** (`onSubmit` con `deferred()`: el turno pendiente muestra `Vos: /crear-empleado ana *****************` (17 `*`); al resolver y esperar con `waitFor`, `frames.every(f => !f.includes("secreto-largo-123"))`). **T5** (se envían `hola` y `/login ana secreto`; `ARROW_UP` ⇒ el prompt muestra `> hola`; **la línea del prompt** de los frames posteriores nunca contiene `/login ana`, ver I2). **T6** (`hola`, `/estado-bot-prs` y `/login ana` sin cambios en borrador y eco, y los tres se recuperan con ↑; **nace verde**).
*Aceptación (rojo)*: T3 y T5 fallan; T2 y T6 pasan (declarado); `git diff` = sólo adiciones.
Commit: `test(adapters/tui): exige que el eco del turno no muestre la clave, que onSubmit reciba el texto real y que el historial omita las lineas con secreto, rojo (Hito vX.Y, tarea 3.1)`

- [x] **3.2** VERDE — `submitDraft` (`:579-600`): `const visible = enmascararSecreto(prompt)` sobre el prompt **ya recortado** (H3); `TurnRecord` con `prompt: visible`; `if (!contieneSecreto(prompt)) promptHistoryRef.current.push(prompt)` (`:586`) con `historyIndexRef.current = null` **siempre**; `onSubmit(prompt, …)` recibe el real. `TurnPrompt` **no** enmascara al renderizar. Doc-comments: párrafo *"Secret masking (ADR 300)"* en el módulo, reescritura de `:183-189` (*"always appends"* → *"except lines with a secret"*) y del comentario de `TurnRecord` (`:284`).
*Aceptación*: 3.1 en verde; `npm test`, `npm run typecheck`, `npm run build` verdes; `rg "always appends" src/adapters/tui/App.tsx` sin coincidencias.
Commit: `feat(adapters/tui): guarda el turno ya enmascarado y excluye del historial las lineas con secreto (Hito vX.Y, tarea 3.2)`

- [x] **3.3** *(sin commit)* Guarda de tests existentes: `git diff main -- src/adapters/tui/App.test.tsx` **sólo adiciones** (las ~27 referencias a `TurnPrompt`/`PromptInput`/historial siguen verdes sin editar; I3). Si alguna rompe, **detener y escalar**.

- [x] **3.4** *(human-approved)* **T5b**, mismo `describe("secret masking (ADR 300)")`, mismo estilo que T5: se envían `hola` y luego `/login ana ***` (clave de sólo `*`); `ARROW_UP` con el prompt vacío ⇒ el prompt muestra `> hola`, y la línea del prompt de los frames posteriores nunca contiene `/login ana`. Cubre el scenario del spec *"Clave hecha sólo de asteriscos igual queda fuera del historial"*. **Nace verde** (declararlo; la conducta ya la implementa la guarda `contieneSecreto` de 3.2), y sus dientes se prueban por mutación: cambiar temporalmente la guarda en `App.tsx` al predicado rechazado `enmascararSecreto(prompt) !== prompt` ⇒ T5b debe fallar, luego revertir `App.tsx` exactamente (`git diff -- src/adapters/tui/App.tsx` vacío). Se agrega también la mutación **M5** (`!==` en vez de `contieneSecreto` ⇒ T5b falla) a la lista de mutaciones de 5.1.
*Aceptación*: T5b nace verde (declarado); mutación M5 falla con el predicado `!==` y pasa revertido; `git diff -- src/adapters/tui/App.tsx` vacío tras revertir; `npm test`, `npm run typecheck` verdes; `git diff` de `App.test.tsx` = sólo adiciones (I3).
Commit: `test(adapters/tui): exige que una clave hecha solo de asteriscos tampoco entre al historial de flechas (Hito 3.20, tarea 3.4)`

> **Progreso (sdd-apply, Phase 3, 2026-09-24)**: 3.1-3.3 hechas, **sin commitear** (rama `hito/v3.20-enmascarar-password-en-tui`; el humano commitea). ROJO 3.1: se agregaron T2, T3, T5, T6 al mismo `describe("secret masking (ADR 300)")` (sólo adiciones); `npx vitest run -- App` dio 2 rojos (T3, T5) y T2/T6 nacieron verdes (declarado); `npm run typecheck` verde. VERDE 3.2: `submitDraft` ahora calcula `const visible = enmascararSecreto(prompt)` sobre el prompt ya recortado y guarda `TurnRecord.prompt: visible`; el push a `promptHistoryRef` quedó condicionado a `!contieneSecreto(prompt)` y `historyIndexRef.current = null` se sigue ejecutando siempre; `onSubmit(prompt, …)` no cambió (sigue recibiendo el texto real). Se extendió el import existente de `core` a `{ contieneSecreto, enmascararSecreto }` (sigue siendo un solo import de `core` en `adapters/tui`). Se reescribió el doc-comment del módulo (`:183-189`, "always appends" → "except lines with a secret", más un párrafo nuevo "Secret masking (ADR 300)") y se agregó el comentario de `TurnRecord.prompt` (ya enmascarado). `npm test` 3306/3306 (162 archivos, 2 skip preexistentes, `dist/` limpio antes de correr), `npm run typecheck` y `npm run build` verdes; `rg "always appends" src/adapters/tui/App.tsx` sin coincidencias. Guarda 3.3: `git diff 89506e5 -- src/adapters/tui/App.test.tsx` = sólo líneas `+` (0 líneas `-`); ningún test existente se tocó. Faltan Phase 0 (condicionada a I1), 4-6 y el Reviewer.

## Phase 4: No regresión de logs y auditoría (sin commit)

> **Progreso (sdd-apply, 3.4 + Phase 4, 2026-09-24)**: **3.4** hecha, **sin commitear** (rama `hito/v3.20-enmascarar-password-en-tui`; el humano commitea). Se agregó T5b al mismo `describe("secret masking (ADR 300)")` (sólo adición), mirror de T5 con `/login ana ***` (clave de sólo `*`); nació verde (`npx vitest run -- App` → 45 tests en el describe file, 1 archivo, T5b entre ellos, todos verdes; `npm test` completo 3307/3312, 5 skips preexistentes, `dist/` limpio antes de correr). Mutación M5: se cambió temporalmente la guarda de `submitDraft` (`App.tsx:620`) de `if (!contieneSecreto(prompt))` a `if (enmascararSecreto(prompt) === prompt)` (predicado rechazado `!==` invertido) ⇒ sólo T5b falló (`> /login ana ***` recuperado en vez de `> hola`); se revirtió `App.tsx` exactamente y `git diff -- src/adapters/tui/App.tsx` quedó vacío; se agregó M5 a la lista de mutaciones de 5.1. `npm run typecheck` verde antes y después. **4.1** verificada (sólo verificación, sin commit): se re-`Grep`earon los anchors — `build-on-comando-empleado.test.ts:568-569` y `:2670-2671` (ambos dentro de asserts `JSON.stringify(...).not.toContain(PASSWORD)`) y `comando-empleado.test.ts:394-396` (test "★ test de fuga ★") coinciden con lo esperado y pasan sin edición (`npx vitest run` de ambos archivos: 281/281 verdes). `git diff main -- src/build-on-comando-empleado.ts src/build-on-comando-empleado.test.ts` vacío: el enmascarado no toca el dispatcher. Faltan Phase 0 (condicionada a I1), 5-6 y el Reviewer.

- [x] **4.1** Fijar, no reescribir: `build-on-comando-empleado.test.ts:568-569` y `:2670-2671` y `comando-empleado.test.ts:394-396` pasan **sin edición**. `git diff main -- src/build-on-comando-empleado.ts src/build-on-comando-empleado.test.ts` **vacío**: el enmascarado no se aplica en el dispatcher (spec `autenticacion-empleado-tui`, requirement de no-regresión; design §7.3). Re-`Grep` de las líneas antes de citarlas.

## Phase 5: Mutación, evidencia manual y docs (excepciones TDD)

- [ ] **5.1** Checks de mutación (sobre un respaldo, restaurado por copia). **M1** `TurnRecord.prompt` = `prompt` real ⇒ T3 falla. **M2** push al historial siempre ⇒ T5 falla. **M3** `PromptInput` sin máscara ⇒ T8/T1 fallan. **M4** helper sin enmascarar los espacios de cola u off-by-one en el id ⇒ U1/U4 fallan. **M5** guarda del historial cambiada al predicado rechazado `enmascararSecreto(prompt) !== prompt` (en vez de `contieneSecreto`) ⇒ T5b falla (3.4). Cada uno: rojo con la mutación, verde revertido (`git diff -- src` vacío). Evidencia en `docs/progreso/vX.Y-enmascarar-password-en-tui/mutaciones.md`.
*Aceptación*: los tests nombrados fallan con su mutación y pasan sin ella; el commit toca sólo `docs/`.
Commit: `docs(root): registra los checks de mutacion de la mascara, el eco y el historial con la salida roja y verde (Hito vX.Y, tarea 5.1)`

- [ ] **5.2** Verificación manual end-to-end (excepción TDD, **entregable funcional**), en la TUI real (Windows Terminal): (1) tipear `/login`, borrar con backspace, enviar y apretar ↑; (2) repetir `/crear-empleado` como `administrador`; (3) `/logni ana secreto` visible (R2); (4) **R10 / H1**: tipear una clave **mientras el turno está pendiente** (*"Pensando..."*) y registrar qué eco hace la tty (raw mode apagado, `App.tsx:709`; **fuera de alcance**, sólo se documenta). Registrar `docs/progreso/vX.Y-enmascarar-password-en-tui/README.md` con capturas o logs y los residuales R2, R7, R9 y R10.
*Aceptación*: los cuatro pasos documentados con evidencia; el login funciona igual que antes.
Commit: `docs(root): agrega la evidencia manual del enmascarado de la clave en la TUI, incluido el eco durante un turno pendiente (Hito vX.Y, tarea 5.2)` · *No es hito completo hasta el Reviewer, el tag y el cierre.*

- [ ] **5.3** Nota de reemplazo (no reescritura) junto a `openspec/changes/comandos-administracion-empleados/design.md:256`: *"Reemplazado por ADR 300 (`enmascarar-password-en-tui`): la contraseña ya no se ve en el transcripto; la rotación pasa de obligatoria a recomendada, porque el administrador sigue conociendo la clave inicial (R9)"*. Citar *RD-81 (comandos-administracion-empleados)* con prefijo (H7).
*Aceptación*: `git diff` de ese archivo = ~2-4 líneas agregadas y **ninguna** borrada.
Commit: `docs(root): agrega la nota de reemplazo de la rotacion obligatoria por el ADR 300 (Hito vX.Y, tarea 5.3)`

## Phase 6: Verificación final (sin commit)

- [ ] **6.1** `npm run typecheck` en verde.
- [ ] **6.2** `npm test` en verde (con `dist/` limpio).
- [ ] **6.3** `npm run build` en verde.
- [ ] **6.4** Guarda de alcance: `git diff main --stat` sólo lista `comando-empleado.ts` (+test), `App.tsx` (+test), `docs/progreso/vX.Y-enmascarar-password-en-tui/`, `comandos-administracion-empleados/design.md` y los artefactos del change; `git diff main -- tui-port.ts start-tui.tsx src/build-on-comando-empleado.ts src/main.ts src/adapters/web src/empleados.ts package.json` **vacío** (localizar las rutas reales con `Glob` antes).

## Phase 7: Cierre (sólo tras la aprobación del Reviewer; no es tarea del Implementer)

- [ ] **7.1** `docs/ARC42_Harness_Empresarial.md`: agregar el **ADR 300** (texto de `design.md` §2, copiado tal cual) y reescribir el Riesgo 5 (R1), `:792-800` (título, descripción, mitigación *"recomendada"*, condición de disparo *"cumplida por ADR 300"*). Reverificar el techo de ADR/RD (R8, I4).
*Aceptación*: `rg "ADR 300" docs/ARC42_Harness_Empresarial.md` presente; el Riesgo 5 ya no dice *"visible en el transcripto"* como residual aceptado (spec `administracion-empleados-tui`).
Commit: `docs(arc42): registra el ADR 300 y reescribe el Riesgo 5 tras el enmascarado de la clave en la TUI (Hito vX.Y, tarea 7.1)`

- [ ] **7.2** Checklist de cierre de AGENTS.md (lo ejecuta el humano): Reviewer aprobó (`sdd-verify` + `code-review` sin bloqueantes), entregable demostrado (5.2), `docs/progreso/vX.Y-enmascarar-password-en-tui/` creada, tag `vX.Y.Z`. En `sdd-archive`, fusionar (no pisar) el delta de `autenticacion-empleado-tui` con los de `operaciones-negocio-tui` y `sesiones-web-persistentes` (R11).

---

## Dependencias entre tareas

- **Secuencial**: `0.1` (si aplica) → G0 → `1.1 → 1.2 → 1.3 → 1.4` → `2.1 → 2.2` → `3.1 → 3.2 → 3.3` → `4.1` → `5.1` y `5.2` → `6.x` → Reviewer → `7.1 → 7.2`. `2.1/2.2/3.1/3.2` comparten `App.tsx` y `App.test.tsx`, así que no se paralelizan.
- **Bloqueo**: `2.x` exige `1.3` (el import). `5.1` exige `1.3` y `3.2`. `5.2` exige `3.2`.
- **Paralelizables**: `0.1` (spec, otro rol) con `1.1-1.2` si el checkpoint ya decidió I1. `5.3` es independiente de `1.x-3.x` (sólo depende de G0) y se puede hacer en cualquier momento antes de `6.4`. `4.1` puede correrse tras `1.3`.
- **Cuello de botella**: el checkpoint (I1-I4 y `vX.Y`) y el Reviewer antes de `7.x`.
