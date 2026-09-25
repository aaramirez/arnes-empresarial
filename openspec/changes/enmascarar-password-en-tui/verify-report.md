# Verify Report: `enmascarar-password-en-tui`

**Role**: Reviewer (AGENTS.md) . **Fecha**: 2026-09-24 . **HEAD verificado**: `6864d67` (branch `hito/v3.20-enmascarar-password-en-tui`) . **Base (`main`)**: `5dfd44f0c9cec28b35fbb5d2cdb2f80b0d9d2186` (merge-base = `main`, no se movio) . **Diff scope**: `git diff main`

## Veredicto: **REJECT**

No por fallas de implementacion o de tests -- el codigo, la cobertura y el TDD estan solidos -- sino por **un CRITICAL de proceso sin resolver**: la colision de numeracion de hito/tag `v3.20` contra `respaldo-y-durabilidad-sqlite`, que el propio checkpoint dijo que se resolveria con `v3.21` y no se resolvio. Esto no se arregla escribiendo codigo nuevo; vuelve al **checkpoint humano / Spec Author** (decision de numeracion), no al Implementer.

---

## 1. Comandos ejecutados y resultados

| Comando | Resultado |
|---|---|
| `rm -rf dist && npm run typecheck` | Verde, sin salida (`tsc --noEmit`) |
| `npm test` (con `dist/` limpio) | Verde: 162 archivos passed, 2 skipped (164) . 3307 tests passed, 5 skipped (3312) -- 22.63s |
| `npm run build` (con `dist/` limpio antes y despues) | Verde, sin salida (`tsc -p tsconfig.build.json`) |
| `npx vitest run comando-empleado.test.ts -t "enmascararSecreto y contieneSecreto"` | 42 passed / 126 skipped (168) |
| `npx vitest run App.test.tsx -t "secret masking"` | 9 passed / 36 skipped (45) |
| `npx vitest run build-on-comando-empleado.test.ts comando-empleado.test.ts -t "fuga"` | 2 passed / 279 skipped (281) |
| `npx vitest run src/main.test.ts` x3 | 87/87 verde las 3 corridas -- el flake reportado en la nota de apply-progress no se reprodujo |

`git log main..HEAD --oneline`: confirma orden ROJO -> VERDE estricto: `test(core)` 1.1 -> `test(core)` 1.2 -> `feat(core)` 1.3 -> `refactor(core)` 1.4 -> `test(adapters/tui)` 2.1 -> `feat(adapters/tui)` 2.2 -> `test(adapters/tui)` 3.1 -> `feat(adapters/tui)` 3.2 -> `docs(spec)` 0.1 -> `test(adapters/tui)` 3.4 -> `docs(root)` 5.1/5.3/5.2 -> `docs(spec)` 6.x. TDD estricto respetado.

`git diff main -- src/core/commands/comando-empleado.test.ts src/adapters/tui/App.test.tsx | grep -c` de lineas removidas = 0 -> confirma I3: ningun test existente fue tocado, solo adiciones.

---

## 2. Traceability (spec -> test/evidencia)

### `comando-empleado-tui` (ADDED)

| Requirement/Scenario | Test | Estado |
|---|---|---|
| Helper puro, misma normalizacion que `parsearComando` | `comando-empleado.ts` `inicioTramoSecreto`/`enmascararSecreto` | Cubierto |
| `/login` con clave | U1 (`it.each`) | PASS |
| Clave con espacios internos (7 asteriscos) | U1 | PASS |
| `/crear-empleado` con clave | U1 | PASS |
| Espacios extra alrededor de tokens | U1 | PASS |
| Todavia no hay clave | U2 | PASS |
| Comandos no secretos / texto libre | U2 | PASS |
| Typo/mayuscula no matchea (R2) | U3 | PASS |
| No diverge del parser (paridad) | U4 | PASS -- ver hallazgo CRITICAL-2 abajo sobre alcance real de U4 |

### `autenticacion-empleado-tui` (MODIFIED + ADDED)

| Requirement/Scenario | Test/Evidencia | Estado |
|---|---|---|
| Fuera de alcance ya no incluye enmascarado TUI | Delta de spec (texto), sin test automatizado (parrafo documental) | Documentado, no aplica test |
| Alta de credencial no persiste en claro (extendido a `/crear-empleado`) | `build-on-comando-empleado.test.ts:568-569`, `:2670-2671` (no editados) | PASS, sin edicion |
| Borrador enmascarado mientras se tipea | T1 | PASS |
| `onSubmit` recibe texto real | T2 (nace verde, declarado) | PASS |
| Eco del turno nunca muestra la clave | T3 | PASS |
| Backspace conserva feedback de longitud | T4 | PASS |
| Lineas con clave no entran al historial | T5 | PASS |
| Clave hecha solo de asteriscos queda fuera del historial | T5b (3.4, human-approved) | PASS + mutacion M5 dirigida |
| Texto libre / comandos sin secreto no cambian | T6 (nace verde, declarado) | PASS |
| Comando mal tipeado visible (residual) | T7 (nace verde) | PASS |
| No-regresion logs/auditoria/respuesta | `build-on-comando-empleado.test.ts` + `comando-empleado.test.ts:394-396` (test de fuga), sin edicion | PASS |

### `administracion-empleados-tui` (MODIFIED)

| Requirement/Scenario | Test/Evidencia | Estado |
|---|---|---|
| Residuales documentados no ocultos | `mutaciones.md` + `README.md` + nota de reemplazo en `comandos-administracion-empleados/design.md` | Documental, verificado por lectura (2 lineas agregadas, 0 borradas, confirmado por `git diff`) |
| Contrasena de alta no se ve en la TUI | Cubierto transitivamente por T3/T1 (mismo helper, mismo `App.tsx`) -- no hay un test dedicado a `/crear-empleado bob abc` -> `/crear-empleado bob ***` exacto en `App.test.tsx` (T3 usa `secreto-largo-123`) | WARNING -- ver hallazgo abajo |

Cobertura global: de los ~24 scenarios entre las 3 specs, todos menos los puramente documentales (parrafo Fuera de alcance, tabla de residuales) tienen un test automatizado que paso en ejecucion real. La unica laguna concreta es el scenario literal `/crear-empleado bob abc` -> `bob ***` de `administracion-empleados-tui` (no hay ese caso exacto en `App.test.tsx`, aunque `comando-empleado.test.ts` U1 si lo cubre a nivel de helper).

---

## 3. Design conformance

| Punto del design | Verificado | Estado |
|---|---|---|
| Helper en `core`, sin imports nuevos en `comando-empleado.ts` | `git diff` del archivo: solo agrega funciones/const, cero `import` nuevo | OK |
| Exactamente un import de `core` en `App.tsx` | `import { contieneSecreto, enmascararSecreto } from "../../core/commands/comando-empleado.js"` -- un solo import de core | OK |
| `src/core` no importa nada de adapters | Confirmado por lectura del diff (sin cambios de imports en `core`) | OK |
| Masking en `PromptInput` y en `TurnRecord` via `submitDraft` | `PromptInput` dibuja `enmascararSecreto(draft)`; `submitDraft` computa `visible = enmascararSecreto(prompt)` y lo usa en `setHistory` | OK |
| `onSubmit` recibe texto real | `onSubmit(prompt, ...)` sin cambios, `prompt` es el real | OK, T2 lo fija |
| Guarda de historial con `contieneSecreto` | `if (!contieneSecreto(prompt)) promptHistoryRef.current.push(prompt)` | OK |
| `historyIndexRef` se resetea siempre | `historyIndexRef.current = null;` fuera del `if` | OK |
| Dispatcher (`build-on-comando-empleado.*`) sin tocar | No aparece en la lista de 10 archivos de `git diff main --stat` | OK |

Diseno conforme en su totalidad.

---

## 4. Hallazgos

### CRITICAL-1 -- Colision de numeracion v3.20 sin resolver, contradice la decision del propio checkpoint

`proposal.md:5` y `design.md:5` dejan explicito que `v3.20` ya esta reservado por `respaldo-y-durabilidad-sqlite` (confirmado leyendo `openspec/changes/respaldo-y-durabilidad-sqlite/proposal.md:5`: "Rama prevista: hito/v3.20-respaldo-y-durabilidad-sqlite . Tag: v3.20.0"). `tasks.md:57` deja como precondicion de gate G0 que el checkpoint "fijo vX.Y", con la recomendacion explicita: "v3.21 solo si respaldo-y-durabilidad-sqlite conserva v3.20".

En la practica, la rama real es `hito/v3.20-enmascarar-password-en-tui` y todos los commits usan literalmente "Hito 3.20" (ver `git log`: "Hito 3.20, tarea 1.1", etc.), y `docs/progreso/v3.20-enmascarar-password-en-tui/README.md` titula "Hito v3.20". Esto no es el placeholder `vX.Y` sin resolver que `tasks.md` dice que debia quedar pendiente -- es una decision de numeracion ya tomada y ya materializada en nombres de rama, commits y carpetas, y coincide exactamente con el numero reservado por el otro change. Si ambos changes mergean, hay dos "hito v3.20" reales compitiendo por el mismo tag `v3.20.0` y por la misma carpeta `docs/progreso/v3.20-*`.

Esto es un CRITICAL porque:
1. Viola la propia gate G0 de `tasks.md` ("Checkpoint humano... fijo vX.Y") -- no hay evidencia de que el checkpoint efectivamente haya fijado v3.20 para este change sabiendo que colisiona; el placeholder debia resolverse a v3.21 segun la recomendacion del propio diseno, y no fue asi.
2. Es un problema de release/tagging, no de codigo: si se tagea v3.20.0 para este change y luego respaldo-y-durabilidad-sqlite tambien reclama v3.20.0, el segundo en mergear rompe.

A quien vuelve: al checkpoint humano / Spec Author -- hay que fijar el numero de hito real (renombrar rama/commits a v3.21 o coordinar el orden de merge explicitamente con respaldo-y-durabilidad-sqlite) antes de aprobar. No es un bug de implementacion: el Implementer siguio instrucciones de nombres de rama y commit que ya traian el numero equivocado.

### WARNING-1 -- U4 no detecta el off-by-one real que M4 introdujo (design decia U1/U4, en la practica solo U1 lo atrapa)

Confirmado leyendo `mutaciones.md` seccion M4: la mutacion que corta el indice del id en uno hace fallar los 4 casos literales de U1, pero los 3 `it` de U4 (paridad con el parser) siguieron en verde. La propia evidencia lo documenta honestamente ("hallazgo no pedido por la tarea"), pero no se abrio una tarea de refuerzo -- queda como nota para "un change futuro". El design (tabla U4, seccion 10) presenta a U4 como una de las defensas contra R1 (desalineacion con el parser) junto a U1, y en este caso concreto no cumplio ese rol: es un oraculo de "no sub-enmascarar", no de "posicion exacta". Esto reduce la garantia real de R1 frente a lo que el design prometia, aunque U1 si atrapo la mutacion en este caso.

A quien vuelve: al Implementer/Spec Author en un change de seguimiento -- no bloquea este merge porque U1 si cubre el caso actual, pero el gap de U4 deberia convertirse en una tarea explicita, no quedar solo anotado en un doc de mutacion.

### WARNING-2 -- Verificacion manual 5.2, pasos 2-4 sin evidencia independiente, solo "reportado por el desarrollador"

`README.md` documenta el paso 1 con una captura real (`captura-login-enmascarado.png`) y resultado detallado. Los pasos 2, 3 y 4 (incluido el residual R10, el hallazgo mas delicado del design, H1) estan marcados "reportado por el desarrollador" sin captura ni log adicional, salvo que la captura del paso 1 tambien sirve parcialmente para el paso 2 (muestra el borrador de `/crear-empleado`, no el resto del flujo). Es una excepcion TDD legitima (5.2 esta marcada como tal en tasks.md), pero la evidencia es mas debil que lo que el propio README promete en su tabla (columna "Captura/log").

A quien vuelve: no bloquea por si solo (el Reviewer puede aceptar el residual con esta evidencia), pero si se quiere cerrar sin reservas falta al menos una captura del paso 4 (el mas importante: confirma H1/R10).

### WARNING-3 -- Gap de cobertura literal en administracion-empleados-tui

El scenario "La contrasena de alta no se ve en la TUI" pide literalmente `/crear-empleado bob abc` -> `/crear-empleado bob ***` visible en la TUI (borrador y eco). `App.test.tsx` no tiene un test que use exactamente esos literales para `/crear-empleado` en el borrador (T3 usa `secreto-largo-123`, T1/T4/T5/T8 usan `/login`). La cobertura es real mediante U1 (helper, si testea `bob abc` -> `bob ***`) y T3 (TUI, con otro secreto), pero no hay un test de integracion TUI que reproduzca el string exacto del scenario. Bajo riesgo porque el helper es la unica logica de mascara y ya esta probado con esos literales.

A quien vuelve: SUGGESTION mas que bloqueante -- dejarlo anotado para el Implementer en un ajuste menor, no repetir el ciclo completo.

### SUGGESTION-1 -- Flake de src/main.test.ts no reproducido

Corrido 3 veces de forma aislada: 87/87 verde en las tres. Coincide con lo que ya documento apply-progress (no reproducible en aislamiento). No bloquea, pero si vuelve a aparecer en CI conviene loguearlo con seed/orden de vitest para diagnosticarlo, no descartarlo silenciosamente como "flake conocido".

---

## 5. Resumen de hexagonal / AGENTS.md

- Direccion de import: adapters/tui -> core permitida y es la primera vez que ocurre (H5 del design, confirmado con lectura del diff: cero imports de adapters en core).
- Ningun archivo "Sin cambios" del design (`tui-port.ts`, `start-tui.tsx`, `build-on-comando-empleado.ts`, `main.ts`, `src/adapters/web/**`, `src/empleados.ts`, `package.json`) aparece en el diff (`git diff main --stat` lista exactamente 10 archivos, todos dentro del alcance esperado).
- Ningun agente toco el indice de git (add/commit/reset/stash/checkout) durante esta verificacion.

---

## 6. Conteos finales

- `npm run typecheck`: 0 errores.
- `npm test`: 3307 passed / 5 skipped, 162 archivos passed / 2 skipped, 0 fallas.
- `npm run build`: 0 errores.
- `git diff main --stat`: 10 archivos, +743/-35 lineas -- dentro del presupuesto de 400 lineas de revision por PR de codigo de produccion (el total incluye 191 lineas de `mutaciones.md` y 58 de `tasks.md` que son overhead documental).

---

## 7. Que falta para volver a verify

1. Resolver CRITICAL-1: fijar el numero de hito real (recomendado v3.21 si respaldo-y-durabilidad-sqlite conserva v3.20, o coordinar explicitamente el orden de merge y aceptar la colision con una decision documentada del checkpoint). Actualizar rama y carpetas de progreso, o aceptar y documentar formalmente la decision de proceso (no es competencia del Implementer).
2. Recomendado no bloqueante: reforzar U4 con asercion de posicion exacta (WARNING-1), completar evidencia del paso 4 de 5.2 (WARNING-2), agregar el scenario literal de `/crear-empleado` a `App.test.tsx` (WARNING-3).

**skill_resolution**: paths-injected (sdd-verify/SKILL.md y _shared/sdd-phase-common.md leidos por ruta exacta antes de trabajar).

---

## Round 2 (2026-09-24)

**Role**: Reviewer (AGENTS.md), re-verificacion. **HEAD**: `61f0d26` (branch `hito/v3.20-enmascarar-password-en-tui`). **Contexto**: entre Round 1 y Round 2 hubo un checkpoint humano que ratifico explicitamente la decision de numeracion y la registro por escrito en `tasks.md` (nota "Resuelto en el checkpoint humano") y en `respaldo-y-durabilidad-sqlite/proposal.md` (nota post-linea 5).

### Veredicto: **APPROVE**

### 1. Resolucion de CRITICAL-1 (colision v3.20)

Evidencia verificada directamente en git y en los archivos:

- `git tag -l "v3.*"` -> ultimo tag real es `v3.19.0`. No existe `v3.20.0` en ningun lado del repo todavia (ni para este change ni para `respaldo-y-durabilidad-sqlite`).
- `git branch -a` -> unica rama con `v3.20` es `hito/v3.20-enmascarar-password-en-tui` (la de este change, `HEAD` actual). No existe `hito/v3.20-respaldo-y-durabilidad-sqlite` como rama real -- la carpeta `openspec/changes/respaldo-y-durabilidad-sqlite/` completa esta **untracked** (`??` en `git status`), nunca se commiteo, no tiene rama ni tag. Confirma que la "reserva" de `respaldo` sobre `v3.20` era solo texto de propuesta, nunca un artefacto de git real.
- `openspec/changes/enmascarar-password-en-tui/tasks.md` (linea inmediatamente despues de la 5) registra la resolucion del checkpoint humano fechada 2026-09-24: `v3.20` se fija para este change; la reserva de `respaldo` era tentativa y no fijada; ultimo tag libre es `v3.19.0`, por lo que `v3.20` es el proximo minor libre.
- `openspec/changes/respaldo-y-durabilidad-sqlite/proposal.md:7` (nota agregada tras la linea 5) confirma la contraparte: "`v3.20` lo tomo `enmascarar-password-en-tui`... Este change pasa a `v3.21` tentativo".

Conclusion: no hay colision real en git (no hay dos ramas ni dos tags `v3.20` compitiendo -- solo una rama y cero tags `v3.20` existen). La colision de Round 1 era entre dos *propuestas de texto*, no entre artefactos de git; el checkpoint humano la resolvio explicitamente y la resolucion quedo escrita en ambos lados (`tasks.md` del change ganador y `proposal.md` del change que cede el numero). **CRITICAL-1 queda resuelto.** No es competencia de este Reviewer exigir que `respaldo-y-durabilidad-sqlite` termine de renumerar su propio documento a `v3.21` en todas sus menciones -- eso es trabajo de su propio Spec Author en su propio checkpoint, tal como la nota del checkpoint lo delega explicitamente.

### 2. Confirmacion de que src/ no cambio desde Round 1

- `git diff 6864d67 HEAD -- src` -> vacio.
- `git status --short src` -> vacio.
- Sanity check igualmente ejecutado (no reutilizado ciegamente): `rm -rf dist && npm run typecheck` -> verde, sin errores. `npm test` -> 162 archivos passed, 2 skipped (164); 3307 tests passed, 5 skipped (3312); 0 fallas. Resultados identicos en sustancia a Round 1 (misma cantidad de tests/archivos), consistente con "sin cambios en src".

### 3. Estado de WARNING-1/2/3 y nota nueva sobre `reembolso-resta-monto-vendido-en-reporte`

- **WARNING-1** (U4 no atrapa M4, solo U1 lo hace): sigue **no bloqueante**. No hubo cambios en `mutaciones.md` ni en los tests de mutacion desde Round 1; el gap sigue documentado como nota para change futuro, no como tarea abierta de este change. Se mantiene como WARNING para seguimiento, no bloquea Round 2.
- **WARNING-2** (evidencia manual 5.2, pasos 2-4 "reportado por el desarrollador", una sola captura): sigue **no bloqueante**. No se agrego evidencia adicional entre rondas (no hay commits nuevos de `docs(root)` para 5.2 en el rango `6864d67..HEAD`), pero como en Round 1, es una excepcion TDD ya declarada en `tasks.md` y el Reviewer puede aceptar el residual con la evidencia existente.
- **WARNING-3** (sin test literal `/crear-empleado bob abc` -> `bob ***` en `App.test.tsx`): sigue **no bloqueante**, sin cambios; cobertura real vigente via helper (U1) y TUI con otro secreto (T3).
- **Nuevo hallazgo -- `reembolso-resta-monto-vendido-en-reporte/proposal.md:5`**: todavia dice literalmente "`v3.20` lo reserva `respaldo-y-durabilidad-sqlite` y el hermano `enmascarar-password-en-tui` propone `v3.21`" -- texto que quedo desactualizado por la resolucion del checkpoint (es al reves: `enmascarar` se quedo con `v3.20`, `respaldo` pasa a `v3.21` tentativo). Esto es un **SUGGESTION**, no un CRITICAL ni un WARNING de este change: `reembolso-resta-monto-vendido-en-reporte` es un change ajeno, no tiene rama ni tag creados, y su propio parrafo linea 9 ya dice "El numero sale del checkpoint (punto 7)" -- es decir, su Spec Author sabe que el numero esta pendiente de checkpoint propio. Corresponde que ese checkpoint actualice la referencia cuando le toque, no bloquea la aprobacion de `enmascarar-password-en-tui`.

### 4. Comandos ejecutados (Round 2)

| Comando | Resultado |
|---|---|
| `git tag -l "v3.*"` | ultimo tag `v3.19.0`, ningun `v3.20*` existe |
| `git branch -a` | unica rama `v3.20`: `hito/v3.20-enmascarar-password-en-tui` (actual) |
| `git diff 6864d67 HEAD -- src` | vacio |
| `git status --short src` | vacio |
| `rm -rf dist && npm run typecheck` | verde, 0 errores |
| `npm test` | 162 archivos passed, 2 skipped (164); 3307 passed, 5 skipped (3312); 0 fallas |

### 5. Veredicto final

**APPROVE.** El unico CRITICAL de Round 1 fue un problema de coordinacion entre propuestas (texto), no de artefactos git reales, y quedo resuelto por escrito en un checkpoint humano explicito y verificable en ambos changes involucrados. `src/` no cambio desde Round 1 y las pruebas de sanidad (typecheck + test suite completa) siguen en verde. Los tres WARNINGS de Round 1 se mantienen como no bloqueantes para seguimiento futuro (no se resolvieron, pero tampoco se exigio que lo estuvieran para este merge). El hallazgo nuevo sobre `reembolso-resta-monto-vendido-en-reporte/proposal.md:5` es una nota de texto desactualizada en un change ajeno, clasificada SUGGESTION, sin efecto sobre este veredicto.

**skill_resolution**: paths-injected (instrucciones del Reviewer recibidas explicitamente en el prompt de re-verificacion; graphify-out/graph.json disponible pero no aplicable -- esta ronda no involucro exploracion de codigo fuente, solo verificacion de git y docs de proceso).
