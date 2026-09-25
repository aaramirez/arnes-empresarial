> **Nota de proceso**: fase `sdd-tasks` sin shell, así que **no pudo correrse `graphify query`** pese al hook (misma nota que `proposal.md` y `design.md`). Los anclajes `archivo:línea` se re-verificaron con `Read`/`Grep` sobre `main` (`2195a17`): `reporte.ts:37-39,59-60,117,127-133,153-185,226-248,286`; `reporte.test.ts:126-139,152,221-238,241-264,279-301`; `build-on-comando-empleado.test.ts:82-91,1453-1505,1623-1673`; `consultas-negocio-tool.test.ts:187-220`; `repository.ts:1131,1233`; `hito-1.3-ventas-comisiones/design.md:2082`. `sdd-apply` **debe re-`Grep`ear cada uno** antes de tocar.
>
> **Formato de commit**: `<tipo>(<scope>): <descripcion> (Hito vX.Y, tarea N)`. Scopes: `core` (`reporte.ts` y sus tests, `consultas-negocio-tool.test.ts`), `root` (`build-on-comando-empleado.test.ts`, README, evidencia), `spec` (deltas, `hito-1.3/design.md`), `arc42`. `N` es el id jerárquico. Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md).
>
> **`vX.Y` queda sin resolver a propósito**: **no es un hito del Plan**; `v3.20` lo reserva `respaldo-y-durabilidad-sqlite` y el hermano `enmascarar-password-en-tui` deja su propio placeholder. El número lo fija el checkpoint. Rama prevista `hito/vX.Y-reembolso-resta-monto-vendido-en-reporte`, creada por el humano **después** del checkpoint. Se reemplaza el placeholder en commits, rama y `docs/progreso/vX.Y-reembolso-resta-monto-vendido-en-reporte/`.

# Tasks: `reembolso-resta-monto-vendido-en-reporte` — el reporte de comisiones es neto de reembolsos aplicados

**Origen**: [`proposal.md`](proposal.md) · [`design.md`](design.md) (ADR 301, RD-173, U1-U7, F1-F2, C1-C2) · specs delta: [`reporte-comisiones-mensual`](specs/reporte-comisiones-mensual/spec.md), [`consultas-negocio-a2a`](specs/consultas-negocio-a2a/spec.md), [`reembolso-evaluacion`](specs/reembolso-evaluacion/spec.md), [`herramienta-operaciones-negocio`](specs/herramienta-operaciones-negocio/spec.md).

**Metodología**: TDD estricto (`strict_tdd: true`). RED (`test`) → GREEN (`feat`) → REFACTOR (`refactor`), commits separados; el rojo se declara con `npm test` **y** `npm run typecheck`, salida en el cuerpo del commit. **Nacen verdes (declararlo, sin forzar un rojo artificial)**: C1 y C2 (3.1, 3.2); sus dientes se prueban por mutación en 5.1. **Sin commit**: 3.4 y 6.x. **Único test existente que cambia, a propósito**: el golden `reporte.test.ts:221-238` (se edita en dos pasos, 1.3 y 2.1; ver I6). Se verificó con `rg "TOTAL|Total comisionado|Monto vendido|1500\.00|225\.00"` sobre `src/**/*.test.ts`: ningún otro test fija esos importes. **Fuera del diff de código**: `repository.ts` (incluido el comentario `:1233`), migraciones, `build-on-comando-empleado.ts`, `ejecutar-operacion.ts`, `reporte-mensual.ts`, `consultas-negocio-tool.ts`, `src/adapters/tui`, `src/adapters/web`, `package.json`.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **~290-390** (`additions + deletions`): `reporte.ts` +35-50, `reporte.test.ts` +110-150 (incluye ~20 de churn del golden en dos pasos), `consultas-negocio-tool.test.ts` +40-55, `build-on-comando-empleado.test.ts` +35-45, README +2-4, `hito-1.3/design.md` +1-2, evidencia +20-30, arc42 (Fase 7) +25-35. Sin contar `openspec/changes/reembolso-resta-monto-vendido-en-reporte/`. La propuesta estimaba 110-180: no contaba C1, C2 ni la evidencia (I1) |
| Tamaño real hasta 4.2 (`git diff main --numstat`, código + docs, sin `tasks.md`, sin Fase 5+) | **523** (`additions + deletions`, exacto): `reporte.ts` +67/-13, `reporte.test.ts` +301/-3, `consultas-negocio-tool.test.ts` +77/-0, `build-on-comando-empleado.test.ts` +56/-0, README +4/-0, `hito-1.3/design.md` +2/-0. `tasks.md` (living doc del propio change, fuera del código shippeado) no se cuenta acá. Supera el estimado de 290-390 y el techo de 400: falta Fase 5 (mutación + evidencia manual) y Fase 7 (arc42) |
| 400-line budget risk | **Alto — ya superado.** Ver decisión de checkpoint abajo |
| Chained PRs recommended | No (decidido por el checkpoint: PR única con excepción) |
| Suggested split | **Una sola PR**. Corte opcional si se acerca a 400: PR #1 = 1.1-2.3 (código + tests de `reporte`) → PR #2 = 3.1-5.2 (consumidores, docs, evidencia) |
| Delivery strategy | `ask-on-risk` → **decidido en el checkpoint: PR única con `size:exception`** (ver abajo) |
| Chain strategy | N/A — no aplica, no hay PRs encadenadas |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium
```

**"No" vale sólo para el presupuesto de review.** Antes de `sdd-apply` sigue el **checkpoint humano** (G0): número de hito, I1-I7 y las preguntas abiertas de `design.md` §10.

**Decisión de checkpoint (post-Fase 3, ratificada antes de la Fase 4)**: el tamaño real (~543-549 líneas hasta 4.2, sin contar Fase 5/7) superó el estimado de 290-390 y el techo de 400 del Review Workload Forecast. El checkpoint decidió **entregar en una sola PR con `size:exception`** — no se corta en PRs encadenadas (el `Suggested split` de arriba queda como opción no tomada). El Reviewer debe tratar el tamaño como excepción explícitamente aceptada, no como un hallazgo nuevo.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Agregación neta (1.1-1.5) | PR única | Cambia el comportamiento en todos los consumidores a la vez; el TOTAL/leyenda llegan en la unidad 2. Rollback = `git revert` |
| 2 | TOTAL con monto y leyenda (2.1-2.3) | PR única | Toca sólo `formatearTablaComparativa` |
| 3 | Consumidores y docs (3.1-4.2) | PR única | C1/C2 nacen verdes; sin código de producción |
| 4 | Mutación y evidencia (5.1-5.2) | PR única | Sólo `docs/` |
| 5 | Cierre post-Reviewer (7.1-7.2) | Commit de cierre | ADR 301 + arc42, sólo tras el Reviewer |

---

## Coordinación con el hermano y orden de merge

- **Numeración**: `enmascarar-password-en-tui` reserva **ADR 300 / RD-172**; este change usa **ADR 301 / RD-173**. Ninguno se renumera al mergear en cualquier orden (el 300 queda como hueco documentado si el hermano se descarta).
- **Sin conflicto de código**: el hermano toca `comando-empleado.ts` y `App.tsx`; este toca `reporte.ts`. El único punto de fricción textual es el arc42 (Fase 7 de ambos, agregan un ADR en la misma sección) y `docs/progreso/`.
- **Orden recomendado (a ratificar en el checkpoint)**: `respaldo-y-durabilidad-sqlite` (`v3.20`) → `enmascarar-password-en-tui` (ADR 300) → este change (ADR 301), para que los ADR queden ascendentes en el arc42. Como no hay dependencia, este puede ir antes sin costo; el segundo en mergear reconcilia el arc42 y **reverifica el techo** (R6).

---

## Inconsistencias detectadas para el checkpoint

No se resolvieron aquí. La tarea 0.1 queda **condicionada** a I4.

- **I1 — Tamaño**: propuesta 110-180 líneas, design 270-380. Este documento usa **290-390** (Medium). No hay que decidir nada salvo aceptar la cifra.
- **I2 — Base de `reembolso-evaluacion`**: la propuesta cita `tui-canal-empleado/specs/reembolso-evaluacion/spec.md`; el delta ya escrito parte de `hito-1.3-ventas-comisiones/specs/reembolso-evaluacion/spec.md:63-70` (el otro spec no contiene ese requirement). La propuesta queda desactualizada; `sdd-archive` debe fusionar contra la base de hito-1.3 (7.2).
- **I3 — 4ª capability**: la propuesta lista tres capabilities; existe un delta `herramienta-operaciones-negocio` (MODIFIED de `:79-86`, que acota la prohibición a ese change). Proposal (B5) y `design.md` §5 dicen "tres". Requiere ratificación; si se rechaza, se elimina el delta y R7 del design queda abierto.
- **I4 — ¿Leyenda también en el A2A?** Propuesta y design: **no** (el delta `consultas-negocio-a2a` la excluye: *"ni leyenda de la tabla"*). Si el checkpoint dice **sí**, hay que reescribir ese scenario (0.1) y agregar 3.3 (+1 línea en `consultas-negocio-tool.ts`, que hoy está en "Sin cambios").
- **I5 — Cuándo se edita el arc42**: `design.md` §2 dice *"cuando el Reviewer cierre"*; §7, §9 y §10 (unidad 4, `docs(arc42)`) dicen *"en el apply"*. **Se planifica el ADR 301 como cierre (7.1)**, tras el Reviewer. README (4.1) y la nota de `hito-1.3/design.md` (4.2) sí van en el apply.
- **I6 — Golden en dos pasos**: `design.md` §10 sitúa el golden roto en la unidad 1 (Ana baja a 0.00, el TOTAL de comisión pasa a 100.00) y el monto del TOTAL más la leyenda en la unidad 2. Se sigue el design: 1.3 lo edita a la forma intermedia y 2.1 a la final. Alternativa (un solo golden final en 1.3 y suite roja hasta 2.2) rompe la regla *"cada GREEN deja la suite verde"*.
- **I7 — Alcance en la propuesta**: su tabla *Affected Areas* no lista `build-on-comando-empleado.test.ts` (C2), README, `hito-1.3/design.md` ni la evidencia; el design sí. Ninguno toca código de producción. Se sigue el design.
- **I8 — `repository.ts:1232-1234`**: el comentario *"hace visible R5"* queda algo desactualizado. El design decide **no tocarlo** (guardarraíl); se registra en el ADR 301. 6.4 verifica que `repository.ts` no aparece en el diff.

---

## Gate G0 — Precondiciones (sin commit)

- [ ] Checkpoint humano aprobó spec, diseño y tareas, ratificó ADR 301 / RD-173 (B2-B7 recomendadas), resolvió I3-I5, aceptó la cifra de I1, confirmó orden de merge y fijó `vX.Y`. Rama creada por el humano desde `main`.
- [ ] `delivery_strategy` decidida (Forecast).
- [ ] Línea base verde: `npm test`, `npm run typecheck`, `npm run build` (borrar `dist/` antes: `vitest` duplica el conteo con `dist/` stale).
- [ ] Re-`Grep` de los anclajes de la nota de proceso.
- [ ] Reverificar el techo de ADR/RD sobre todo el repo (sin `node_modules`): no debe haber 301+/RD-173+ reclamados por otro change (R6).

## Phase 0: Alinear spec con el checkpoint (condicionada a I4)

- [~] **0.1** OMITIDA — checkpoint decidió **I4 = NO** (sin leyenda en el A2A). El spec delta `consultas-negocio-a2a` queda tal cual (ya excluye la leyenda). *Sólo si el checkpoint pide la leyenda en el A2A.* Editar `specs/consultas-negocio-a2a/spec.md`: cambiar el scenario *"El agregado sigue recortado"* (quita *"ni leyenda de la tabla"*) y agregar la línea exigida (`Importes netos de reembolsos aplicados.`); alinear `design.md` §5. Si el checkpoint mantiene "no", **esta tarea y 3.3 se omiten**.
*Aceptación*: `rg "leyenda" openspec/changes/reembolso-resta-monto-vendido-en-reporte/specs/consultas-negocio-a2a` coherente con la decisión; `git diff` sólo toca ese spec y el design.
Commit: `docs(spec): alinea el agregado A2A con la decision de leyenda del checkpoint (Hito vX.Y, tarea 0.1)`

---

## Phase 1: Agregación neta (`src/core/ventas/reporte.ts` + `reporte.test.ts`)

- [x] **1.1** RED — en `describe("agruparReporteMensual")` de `src/core/ventas/reporte.test.ts` (sólo agregar; helper `comision()` `:20`). **U1** (`it.each`: un vendedor por estado `confirmada`/`reembolsada`/`reembolso_pendiente`/`reembolso_rechazado`, cada uno 1000/100 → 1000/100, **0/0**, 1000/100, 1000/100; "Con reembolso" 0,1,1,0; `montoReembolsado`/`comisionRevertida` 1000/100 sólo en `reembolsada`). **U2** (mezcla: `confirmada` + `reembolsada` + `reembolso_pendiente` → neto = confirmada + pendiente; `ventasConfirmadas` 3, `ventasConReembolso` 2). **U3** (2 `reembolsada`: fila presente, `montoVendido` y `totalComisionado` con `toBe(0)`, conteos 2/2). **U4** (flotantes: `confirmada` 0.1 y 0.2 + `reembolsada` 0.3 → `totalComisionado` `toBe(0.3)`, `comisionRevertida` `toBe(0.3)`). Spec: `reporte-comisiones-mensual` (scenarios *"Sólo el estado `reembolsada` resta"*, *"Fila con todas sus ventas reembolsadas"*); design §3.1, §6.1.
*Aceptación (rojo)*: `npm test -- reporte` falla en U1-U4; los tests vigentes (`:126-139`, `:152`) siguen verdes; `git diff` = sólo adiciones. Pegar la salida. **Abre la ventana de typecheck rojo `1.1→1.4`** (los campos nuevos no existen).
Commit: `test(core): exige que solo la venta reembolsada reste monto y comision, incluida la fila en cero y los flotantes, rojo (Hito vX.Y, tarea 1.1)`

- [x] **1.2** RED — mismo `describe`. **U5** (regresión con datos reales: ids `hito36`, `v39`, `rick`, `beto`, `tom`, `ana`; comisión 10 %; Ana 1200 `confirmada` + 3 `reembolsada` que suman 2500 (comisión 250.00); Beto 3000 `confirmada` + 2 `reembolsada` que suman 700 (comisión 70.00); Hito36 15000 `reembolso_pendiente`; V39 5000, Rick 4000, Tom 3000 `confirmada` → orden `["hito36","v39","rick","beto","tom","ana"]`; Ana 1200/120 (4/3), Beto 3000/300 (3/2), Hito36 15000/1500 (1/1); `totalMontoVendido` 31200, `totalComisionado` 3120). **U6** (orden por neto: A bruto 500 con 400 reembolsado vs B 200 confirmada → B antes que A). **U7** (`totalMontoVendido` `toBe(0)` en periodo vacío; extiende `:172-181`).
*Aceptación (rojo)*: U5-U7 fallan; typecheck sigue rojo por 1.1; `git diff` = sólo adiciones.
Commit: `test(core): exige la regresion con los datos reales, el orden por comision neta y el total de monto vendido, rojo (Hito vX.Y, tarea 1.2)`

- [x] **1.3** RED — **golden intermedio** `reporte.test.ts:221-238` (fixture Juan `confirmada` 1000/100, Ana Gomez `reembolsada` 1500/225): pasa a la forma que sólo depende de la agregación: Juan primero, `Ana Gomez … 1 0.00 0.00 1`, TOTAL con celda de monto **vacía** y comisión `100.00`, **sin** leyenda. Actualizar el nombre del `it` ("neto"). Spec: *"Venta reembolsada baja al final con 0.00"*; design §6.2, §10 unidad 1; I6.
*Aceptación (rojo)*: ese `it` falla contra el código vigente (Ana primera con 225.00); es el **único** test existente editado; `git diff` de esa región = reemplazo de las filas de datos y del TOTAL.
Commit: `test(core): ajusta a proposito el golden del reporte al neto de la agregacion, rojo (Hito vX.Y, tarea 1.3)`

- [x] **1.4** GREEN — `src/core/ventas/reporte.ts`: `Acumulador` con `montoReembolsado`/`comisionRevertida` (`:145-160`); en el bucle (`:163-167`) `if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA)` acumula lo revertido, `else` acumula el neto (design §3.3: **sumar sólo lo no reembolsado**, sin restas); `FilaVendedor` +2 campos (no se imprimen, B7); `ReporteMensual.totalMontoVendido = redondearComoComision(Σ filas.montoVendido)` (`:183`); los cuatro importes por fila pasan por `redondearComoComision`. **No** se toca `formatearTablaComparativa` ni el orden (`:181`). Cero imports nuevos.
*Aceptación*: 1.1-1.3 en verde; `npm test` y `npm run typecheck` verdes (**cierra `1.1→1.4`**); `npm run build` verde; `rg "^import" src/core/ventas/reporte.ts` sin líneas nuevas.
Commit: `feat(core): resta del reporte mensual el monto y la comision de las ventas reembolsadas, derivado al leer (Hito vX.Y, tarea 1.4)`

- [x] **1.5** REFACTOR — comentarios de `reporte.ts`: `:39` (`ventaEstado` ya no *"hace visible R5"*: decide qué resta), `:60` (`ventasConReembolso`: conteo bruto), doc de `:121-133` (reglas nuevas, cita **ADR 301** y *R5 (hito-1.3-ventas-comisiones)* con prefijo, H7) y doc de `FilaVendedor`/`ReporteMensual` (design §3.2). Sin cambio de comportamiento.
*Aceptación*: `rg "hace visible R5|hace medible R5" src/core/ventas/reporte.ts` sin coincidencias; suite verde sin tocar tests.
Commit: `refactor(core): actualiza los comentarios de R5 en el reporte al neto de reembolsos y cita el ADR 301 (Hito vX.Y, tarea 1.5)`

## Phase 2: Fila TOTAL y leyenda (`reporte.ts` + `reporte.test.ts`)

- [x] **2.1** RED — `describe("formatearReporteMensual")`. Golden `:221-238` a su **forma final** (design §6.2: Ana `0.00 0.00`, TOTAL `1000.00 100.00` con `padStart`, línea en blanco y las dos líneas de leyenda). **F1** (sólo `reembolso_pendiente`, y sólo `reembolso_rechazado`: TOTAL = suma bruta). **F2** (con filas: la leyenda aparece y **cada** línea de tabla y de leyenda mide ≤ 77; la salida con filas **no** cumple `/SQL manual|irreversible|configuraci[oó]n|auditor[ií]a|\brol(es)?\b|permisos?/i`, porque el test `:279-301` sólo la mide en periodo vacío; periodo vacío: sin leyenda, golden `:241-264` **intacto**). Spec: *"Fila TOTAL, orden y leyenda del reporte neto"*.
*Aceptación (rojo)*: golden final, F1 y F2 fallan (TOTAL sin monto, sin leyenda); `:241-264` y `:279-301` siguen verdes.
Commit: `test(core): exige el monto neto en la fila TOTAL y la leyenda de neto solo cuando hay filas, rojo (Hito vX.Y, tarea 2.1)`

- [x] **2.2** GREEN — `reporte.ts`: `formatearTablaComparativa` (`:226`) recibe `totalMontoVendido` (privada, sin impacto externo); `filaTotal` sigue con **4 elementos** (H4) y llena la celda de monto; constante `LEYENDA_NETO` (design §4.2, dos líneas ≤ 77); la tabla devuelve `[encabezado, sep, ...filas, sep, filaTotal, "", ...LEYENDA_NETO]`. Llamada en `:286` con `reporte.totalMontoVendido`. Anchos sin cambios; periodo vacío intacto (H6).
*Aceptación*: 2.1 en verde; `npm test`, `npm run typecheck`, `npm run build` verdes; `git diff` de `reporte.test.ts` en esta tarea = vacío.
Commit: `feat(core): imprime el monto neto en la fila TOTAL y la leyenda de neto bajo la tabla del reporte (Hito vX.Y, tarea 2.2)`

- [x] **2.3** REFACTOR — doc-comments de `formatearTablaComparativa` y `LEYENDA_NETO` (cita ADR 301, B2/B3); confirmar que no quedan literales duplicados de ancho. Sin cambio de comportamiento.
*Aceptación*: suite verde sin tocar tests; `rg "\.padStart\(" src/core/ventas/reporte.ts` sin anchos mágicos nuevos.
Commit: `refactor(core): documenta la fila TOTAL neta y la leyenda del reporte (Hito vX.Y, tarea 2.3)`

## Phase 3: Consumidores (sólo tests; no se toca código de producción)

- [x] **3.1** C1 — `src/core/agents/consultas-negocio-tool.test.ts`, junto al `describe` de `:186` (sólo agregar; **nace verde**, declararlo): `confirmada` 1000/100 + `reembolsada` 1500/225 → `Monto vendido: 1000.00`, `Total comisionado: 100.00`, `Ventas confirmadas: 2`, `Ventas con reembolso: 1`, `Vendedores con ventas: 2`; `reembolso_pendiente` 15000/1500 + `reembolso_rechazado` 1000/100 → `16000.00` / `1600.00`; el texto no contiene `vendedor_nombre` ni la leyenda. Spec: `consultas-negocio-a2a` (tres scenarios).
*Aceptación*: verde sin tocar `consultas-negocio-tool.ts`; los tests `:187-220` (`150.00`) y `:538` siguen verdes sin edición; `git diff` = sólo adiciones.
Commit: `test(core): fija que el agregado A2A del reporte hereda el monto y la comision netos de reembolsos (Hito vX.Y, tarea 3.1)`

- [x] **3.2** C2 — `src/build-on-comando-empleado.test.ts`: agregar `aprobarReembolso` al import de `repository.js` (`:82-91`, hoy sólo existe como `vi.fn` en `:150`) y un `it` dentro del `describe` de `:1453` (usa `seedComisionConfirmada` `:1455`, **nace verde**, declararlo). Con SQLite `:memory:`: vendedor A con venta `confirmada` (1000/100) llevada a `reembolsada` con `aprobarReembolso(db, { ventaId, ahora })` (camino real, `repository.ts:1131`) + vendedor B con otra `confirmada`; `/reporte-comisiones 2026-08` contiene TOTAL neto y la leyenda; `SELECT monto FROM comisiones` de la venta reembolsada sigue en su valor original y `SELECT COUNT(*) FROM comisiones` no cambia. Molde de sesión: `:1623-1673`. Spec: `reporte-comisiones-mensual` (*"La tabla `comisiones` no se altera"*), `reembolso-evaluacion` (*"El reporte descuenta sin tocar la tabla"*).
*Aceptación*: verde; el test de igualdad byte a byte `:1623` sigue verde **sin editarse**; `git diff` = un import y adiciones.
Commit: `test(root): fija con SQLite real que un reembolso aprobado resta del reporte sin alterar la tabla comisiones (Hito vX.Y, tarea 3.2)`

- [~] **3.3** OMITIDA — checkpoint decidió **I4 = NO** (junto con 0.1). *Condicionada a I4 (leyenda en el A2A = sí; si no, se omite junto con 0.1).* RED `consultas-negocio-tool.test.ts` (assert de la línea) → GREEN `consultas-negocio-tool.ts:270-287` (+1 línea). Dos commits (`test(core)` y `feat(core)`), tareas `3.3a`/`3.3b`.

- [x] **3.4** *(sin commit)* No regresión de consumidores: `npm test -- ejecutar-operacion build-on-comando-empleado consultas-negocio reporte-mensual` verde **sin editar** esas suites (`ejecutar-operacion.test.ts:1223`, `build-on-comando-empleado.test.ts:772,1559-1560,1582` sólo hacen `toContain` del encabezado). `git diff main -- src/build-on-comando-empleado.ts src/core/operaciones/ejecutar-operacion.ts src/reporte-mensual.ts src/core/agents/consultas-negocio-tool.ts` **vacío**.

## Phase 4: Documentación del apply (excepción TDD)

- [x] **4.1** `README.md`: 1-2 líneas de prosa (el README **no** contiene la tabla ni la cadena "Monto vendido"): junto a `:198` (el agregado A2A informa `totalComisionado` neto de reembolsos aplicados) y a `:246-250` (`/reporte-comisiones` y `npm run reporte:mensual` son netos de reembolsos aplicados; ver ADR 301). Sin reescribir texto existente.
*Aceptación*: `git diff README.md` = ~2-4 líneas agregadas y **ninguna** borrada.
Commit: `docs(root): aclara en el README que el reporte de comisiones es neto de reembolsos aplicados (Hito vX.Y, tarea 4.1)`

- [x] **4.2** Nota de reemplazo (no reescritura) junto a `openspec/changes/hito-1.3-ventas-comisiones/design.md:2082` (fila R5): *"Superseded en el reporte por ADR 301 (`reembolso-resta-monto-vendido-en-reporte`); la tabla `comisiones` sigue intacta"*. Citar *R5 (hito-1.3-ventas-comisiones)* con prefijo (H7). La evidencia histórica `docs/progreso/v3.2-*` y `v3.8-*` **no** se toca.
*Aceptación*: `git diff` de ese archivo = ~1-2 líneas agregadas y **ninguna** borrada.
Commit: `docs(spec): agrega la nota de reemplazo de R5 en el reporte por el ADR 301 (Hito vX.Y, tarea 4.2)`

## Phase 5: Mutación y evidencia manual (excepciones TDD)

- [x] **5.1** Checks de mutación (sobre un respaldo, restaurado por copia). **M1** restar también `reembolso_pendiente` ⇒ U1/U5/C1 fallan. **M2** restar también `reembolso_rechazado` ⇒ U1/F1/C1 fallan. **M3** ordenar por comisión bruta ⇒ U5/U6 fallan. **M4** TOTAL sin monto o leyenda siempre visible ⇒ 2.1 (golden, F2) falla. **M5** que `aprobarReembolso` haga `UPDATE comisiones` ⇒ C2 falla. Cada uno: rojo con la mutación, verde revertido (`git diff -- src` vacío). Evidencia en `docs/progreso/vX.Y-reembolso-resta-monto-vendido-en-reporte/mutaciones.md`.
*Aceptación*: los tests nombrados fallan con su mutación y pasan sin ella; el commit toca sólo `docs/`.
Commit: `docs(root): registra los checks de mutacion del reporte neto con la salida roja y verde (Hito vX.Y, tarea 5.1)`

- [x] **5.2** Verificación manual end-to-end (excepción TDD, **entregable funcional**), en la TUI real. **Nunca sobre `data/harness.db` en escritura: usar una COPIA para el paso 4.** (1) **Antes**: sobre `main` (worktree o `git stash`), `npm run reporte:mensual -- --periodo <periodo real>` y guardar la salida. (2) **Después**: sobre la rama, `/reporte-comisiones <periodo>` en la TUI y el mismo comando por CLI; ambos textos **idénticos** y tabla ≤ 77 columnas. (3) Contrastar con la base (`sqlite3 -readonly`): Ana 1200.00/120.00, Beto 3000.00/300.00, Hito36 15000.00/1500.00 (pendiente, sin cambio), V39 5000.00/500.00, Rick 4000.00/400.00, Tom 3000.00/300.00, **TOTAL 31200.00/3120.00**; orden Hito36, V39, Rick, Beto, Tom, Ana (desempate `beto` < `tom`); "Ventas"/"Con reembolso" Ana 4/3, Beto 3/2, Hito36 1/1; comisión 10 % exacta por venta reembolsada (Ana 250.00, Beto 70.00); `SELECT COUNT(*), SUM(monto) FROM comisiones` **igual antes y después** (3440.00 hoy). (4) En la copia: `/aprobar-reembolso` sobre la venta pendiente de Hito36 y repetir: esperado Hito36 0.00/0.00 (última fila, se imprime), TOTAL 16200.00/1620.00. Si los datos cambiaron desde la exploración, recalcular a mano y documentarlo. Registrar `docs/progreso/vX.Y-reembolso-resta-monto-vendido-en-reporte/README.md` con las capturas antes/después y los residuales R1 (reporte ≠ tabla), R3/B4 (mes cerrado) y R4 (reportes ya exportados). *Hecho (v3.21): el paso (4) se hizo por conversación porque `/aprobar-reembolso` se dio de baja en v3.10.0; la comparación TUI = CLI se hizo en el paso (b). Ver `docs/progreso/v3.21-reembolso-resta-monto-vendido-en-reporte/README.md`.*
*Aceptación*: los cuatro pasos documentados con evidencia; el reporte de `main` y el de la rama difieren sólo en lo esperado.
Commit: `docs(root): agrega la evidencia manual del reporte neto de reembolsos con la tabla antes y despues (Hito vX.Y, tarea 5.2)` · *No es hito completo hasta el Reviewer, el tag y el cierre.*

## Phase 6: Verificación final (sin commit)

- [ ] **6.1** `npm run typecheck` en verde.
- [ ] **6.2** `npm test` en verde (con `dist/` limpio).
- [ ] **6.3** `npm run build` en verde.
- [ ] **6.4** Guarda de alcance: `git diff main --stat` sólo lista `reporte.ts` (+test), `consultas-negocio-tool.test.ts`, `build-on-comando-empleado.test.ts`, `README.md`, `hito-1.3-ventas-comisiones/design.md`, `docs/progreso/vX.Y-reembolso-resta-monto-vendido-en-reporte/` y los artefactos del change; `git diff main -- src/adapters src/build-on-comando-empleado.ts src/core/operaciones src/reporte-mensual.ts src/core/agents/consultas-negocio-tool.ts package.json` **vacío** (localizar rutas reales con `Glob`; sin migraciones). Si aparece cualquiera de esos, el change se salió de alcance.

## Phase 7: Cierre (sólo tras la aprobación del Reviewer; no es tarea del Implementer)

- [ ] **7.1** `docs/ARC42_Harness_Empresarial.md`: agregar el **ADR 301** (texto de `design.md` §2, copiado tal cual, citando *R5 (hito-1.3-ventas-comisiones)* con prefijo), **RD-173** y las deudas **B6** (clawback real / libro de comisiones pagadas) y **B4** (`refunded_at`); anotar el comentario obsoleto de `repository.ts:1233` (I8). Reverificar el techo de ADR/RD (R6, I5).
*Aceptación*: `rg "ADR 301" docs/ARC42_Harness_Empresarial.md` presente; el ADR dice que la tabla `comisiones` no es un libro de lo pagado y que R5 queda *superseded* sólo para el reporte.
Commit: `docs(arc42): registra el ADR 301 y las deudas B4 y B6 tras el reporte neto de reembolsos (Hito vX.Y, tarea 7.1)`

- [ ] **7.2** Checklist de cierre de AGENTS.md (lo ejecuta el humano): Reviewer aprobó (`sdd-verify` + `code-review` sin bloqueantes), entregable demostrado (5.2), `docs/progreso/vX.Y-reembolso-resta-monto-vendido-en-reporte/` creada, tag `vX.Y.Z`. En `sdd-archive`: **fusionar (no pisar)** los cuatro deltas (`openspec/specs/` está vacío): `reporte-comisiones-mensual` sobre la base de hito-1.3 (`:23-30`) sin perder los ADDED de `tui-canal-empleado` (`:17`), `comando-reporte-comisiones` y `consultas-negocio-a2a-entrante`; `reembolso-evaluacion` sobre `hito-1.3-ventas-comisiones/specs/reembolso-evaluacion/spec.md:63-70` (I2); `consultas-negocio-a2a` (ADDED) sobre `consultas-negocio-a2a-entrante`; `herramienta-operaciones-negocio` (MODIFIED, I3) para que `:81` no quede como prohibición permanente. Advertir antes de fusionar deltas destructivos (`config.yaml`).

---

## Dependencias entre tareas

- **Secuencial**: `0.1` (si aplica) → G0 → `1.1 → 1.2 → 1.3 → 1.4 → 1.5` → `2.1 → 2.2 → 2.3` → `3.1`, `3.2` (y `3.3` si aplica) → `3.4` → `5.1` → `5.2` → `6.x` → Reviewer → `7.1 → 7.2`. `1.x` y `2.x` comparten `reporte.ts` y `reporte.test.ts`: no se paralelizan.
- **Bloqueo**: `2.1` exige `1.4` (el TOTAL final parte del neto). `3.1` exige `1.4`; `3.2` exige `2.2` (afirma la leyenda). `5.1` exige `2.2`, `3.1` y `3.2`. `5.2` exige `2.2` y la rama.
- **Paralelizables (por archivo, un solo escritor salvo worktrees aislados)**: `3.1` con `2.1-2.3` (sólo depende de `1.4`); `3.1` con `3.2` (archivos distintos). `4.1` y `4.2` sólo dependen de G0 y del texto final de `1.4`; pueden hacerse en cualquier momento antes de `6.4`.
- **Cuello de botella**: el checkpoint (`vX.Y`, I3-I5, orden de merge) y el Reviewer antes de `7.x`. `5.2` depende de disponer de la base de trabajo con reembolsos reales.
