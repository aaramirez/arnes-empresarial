> **Nota de proceso (hook de graphify)**: ejecutor sin herramienta de shell disponible (solo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que `proposal.md` y `design.md` de este mismo change. Este documento no reabre ninguna decisión: cada tarea desglosa una pieza ya fijada por `design.md` §5 (cambios de archivo) y §9 (forecast), sus ADR 121-124, y los requirements de las tres specs (`reporte-comisiones-mensual` delta, `comando-reporte-comisiones` nueva, `comando-empleado-tui` delta — las tres ya escritas en `specs/` por la fase anterior, no se recrean acá). Se recomienda `graphify update .` tras persistir este archivo.

# Tasks: `/reporte-comisiones [periodo]` — cableado del Registro de Comandos (v3.2.0)

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 116-120) · [`design.md`](design.md) §2-9 (ADR 121-124) · specs: [`reporte-comisiones-mensual`](specs/reporte-comisiones-mensual/spec.md) (delta, 1 requirement), [`comando-reporte-comisiones`](specs/comando-reporte-comisiones/spec.md) (nueva, 6 requirements), [`comando-empleado-tui`](specs/comando-empleado-tui/spec.md) (delta, 2 requirements — ya resuelve la pregunta 3 del checkpoint con `DESCRIPTORES.length`, no en prosa).

**No es un Hito numerado del Plan** (mismo tratamiento que `tui-canal-empleado` y `definicion-skills`) — los commits usan `(comando-reporte-comisiones, tarea N)` en vez de `(Hito X.Y, tarea N)`.

**Metodología**: TDD estricto (`strict_tdd: true`) en toda tarea con lógica de negocio (1-4). **Tres excepciones explícitas**: tarea 5 (`README.md`, documentación), tarea 6 (`docs/ARC42_*.md`, documentación), tarea 7 (verificación manual, sin código de producción). Las tareas de las specs delta (`reporte-comisiones-mensual`, `comando-empleado-tui`) **ya están escritas** en `specs/` desde la fase de spec — no llevan tarea propia de implementación, se commitean junto al resto del PR.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~383 (`design.md` §9, prod+test+docs+spec) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr (fijado por `design.md` §9, forecast por debajo de 400 con margen angosto) |
| Chain strategy | pending (no aplica — no hay corte en PRs) |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium
```

**Sin ajuste al estimado de `design.md` §9**: el desglose en 7 tareas de abajo suma exactamente los ~383 líneas ya estimadas por archivo — no mueve una sola línea, sólo lo baja a granularidad de tarea. Ver la tabla de reconciliación al final de este archivo.

### Suggested Work Units

| Unit | Goal | Tasks | Est. lines | Base branch |
|---|---|---|---|---|
| 1 (único) | Comando completo: núcleo puro, parser, handler, docs, verificación | 1-7 | ~383 | `main` |

Un solo PR es viable (`design.md` §9): si `build-on-comando-empleado.test.ts` (tarea 4) crece más de lo estimado, la salida de menor fricción es separar `README.md` + `docs/ARC42_*.md` (tareas 5-6, ~40 líneas, cero riesgo de romper nada) en un PR de documentación aparte — no hace falta encadenamiento con dependencia secuencial, es un corte por tipo de contenido, decidible en `sdd-apply` si el diff real lo pide.

## Tareas

1. [x] **`src/core/ventas/reporte-contract.ts`** (nuevo, `design.md` §3, ADR 121 pto 2) — **TDD exception** (interfaz de solo tipos, cero comportamiento en runtime, nada que asertar). `ReporteStorePort` con `listComisionesPorPeriodo(periodo): readonly ComisionConVenta[]` y `listVentasEnReembolsoPendiente(): readonly VentaPendienteReembolso[]`, importando los dos tipos desde `./reporte.js` (nunca al revés — `reporte.ts` no gana un import nuevo). Se ejercita indirectamente por la tarea 4 (el wiring real del puerto) y por la tarea 2 (el consumidor puro). Sin comando de test propio — verificado por `npm run typecheck`. Commit: `feat(core): agrega ReporteStorePort como contrato de lectura del reporte (comando-reporte-comisiones, tarea 1)`.

2. [x] **`src/core/ventas/reporte.ts`** (aditivo, `design.md` §3, ADR 121 pto 3, ADR 123) — `PERIODO_REGEX` local (duplicado literal de `reporte-mensual.ts:51`, **no importado** — ADR 118 prohíbe tocar ese archivo), `ResolverPeriodoReporteResult`, `resolverPeriodoReporte(argumento, ahora)`: sin argumento ⇒ `{ok:true, periodo: ahora.slice(0,7)}`; formato inválido ⇒ `{ok:false, mensaje:"Periodo inválido. Formato esperado: YYYY-MM."}`; válido ⇒ `{ok:true, periodo:argumento}`. `agruparReporteMensual`/`formatearReporteMensual` **sin tocar**. Test primero: extiende `reporte.test.ts` — default con reloj fijo (`"2026-09-10T12:00:00Z"` ⇒ `"2026-09"`); `"2026-08"` válido ⇒ `ok:true`; `"2026-13"`, `"26-08"`, `""` ⇒ `ok:false` con el mensaje exacto; **test de equivalencia (R6)**: un `describe.each` sobre la misma tabla de strings alimentada a `parsePeriodo` (importado de `reporte-mensual.ts`) y a `resolverPeriodoReporte`, afirmando mismo veredicto ok/mensaje en ambas. Sin fixture (puro, reloj inyectado). Cubre spec `comando-reporte-comisiones` req "`periodo` ausente resuelve al mes corriente con reloj inyectado" (los 2 escenarios). ADR 121, 123. Comando: `npm test -- reporte`. Commit: `feat(core): agrega resolverPeriodoReporte con validacion YYYY-MM duplicada de parsePeriodo (comando-reporte-comisiones, tarea 2)`.

3. [x] **`src/core/commands/comando-empleado.ts`** + **`src/core/commands/registro-acciones-contract.ts`** (ambos modificados, `design.md` §3, ADR 117, 119 — un solo bloque conceptual, mismo molde que la tarea 19 de `hito-2.2-a2a-cliente`) — `Forma` gana `"id_opcional_periodo"`; `ComandoEmpleado` gana `{ tipo: "reporte_comisiones"; periodo?: string }`; descriptor `/reporte-comisiones [periodo]` en `DESCRIPTORES` (antes de `/ayuda`, que sigue último), `privilegiado: true` (ADR 117), `forma: "id_opcional_periodo"`; rama nueva en `parsearComando` calcada de `id_opcional_propuesta` — pasa `periodo` TAL CUAL, sin validar formato (ADR 123 pto 1); `COMANDO_REPORTE_COMISIONES = "/reporte-comisiones"` en `registro-acciones-contract.ts`, **cero** `RESULTADO_*` nuevo (ADR 122, se reusa `RESULTADO_ATENDIDA`). Test primero: extiende `comando-empleado.test.ts` — `/reporte-comisiones 2026-08` ⇒ `{tipo:"reporte_comisiones", periodo:"2026-08"}`; `/reporte-comisiones` sin argumento ⇒ `{tipo:"reporte_comisiones"}` sin campo `periodo`, sin consultar ningún reloj; `esComandoPrivilegiado("reporte_comisiones") === true`; `DESCRIPTORES` tiene **dieciséis** con `/ayuda` último; `formatearAyuda()` incluye la línea nueva (tests existentes que cuentan descriptores se actualizan en este mismo commit). Sin fixture (puro). Cubre spec `comando-reporte-comisiones` req "Descriptor... forma `id_opcional_periodo`" (los 2 escenarios) y spec `comando-empleado-tui` delta req "Reconocimiento y ruteo de todos los comandos del Registro" (escenario de conteo). ADR 117, 119, 121 pto 1. Comando: `npm test -- comando-empleado`. Commit: `feat(core): agrega descriptor y parseo de /reporte-comisiones con forma id_opcional_periodo (comando-reporte-comisiones, tarea 3)`.

4. [x] **`src/build-on-comando-empleado.ts`** (modificado, `design.md` §3, ADR 121 pto 1, 123, 124) — `BuildOnComandoEmpleadoDeps.reporteStore?: ReporteStorePort`; wiring inline junto a `credenciales`/`registro` (closures directos sobre `db`, sin `createXStore`, RD-55 resuelto); `manejarReporteComisiones(comando, ahora)`: `resolverPeriodoReporte` ⇒ si inválido, `sistema(mensaje)` **sin fila** (ADR 123 pto 4); si válido, dos lecturas por `reporteStore`, `agruparReporteMensual` + `formatearReporteMensual` sin envolver el string (ADR 124), `registrar({comando: COMANDO_REPORTE_COMISIONES, resultado: RESULTADO_ATENDIDA}, ahora)`; rama `case "reporte_comisiones"` en el `switch` de ruteo. Test primero: extiende `build-on-comando-empleado.test.ts` — **sin sesión** ⇒ pide `/login`, evento `comando-privilegiado-sin-sesion`, **cero** lecturas (spy en `reporteStore`), **cero** fila; **con sesión y período inválido** ⇒ mensaje de uso, **cero** fila; **con sesión y período válido** ⇒ fila `COMANDO_REPORTE_COMISIONES`/`RESULTADO_ATENDIDA` con `venta_id`/`caso_id` `NULL`; `ventas`/`comisiones`/`casos` idénticas antes/después en cualquier desenlace; `confirmacionPendiente` no gana rama (verificable leyendo el tipo); **igualdad byte a byte**: misma fixture de DB alimenta `manejarReporteComisiones` (vía `onSubmit`) y la llamada directa a `agruparReporteMensual`+`formatearReporteMensual` — un solo `expect(...).toBe(...)` sobre las dos salidas completas, no dos aserciones separadas (Success Criteria de `proposal.md:227`); sin argumento ⇒ reporta el mes corriente con reloj inyectado. **Fixture**: SQLite `:memory:` real, mismo patrón que el resto del archivo. Cubre spec `comando-reporte-comisiones` completa (6 requirements, 11 escenarios). ADR 117, 121, 123, 124. Comando: `npm test -- build-on-comando-empleado`. Commit: `feat(root): agrega manejarReporteComisiones con lectura de solo lectura y fila de auditoria (comando-reporte-comisiones, tarea 4)`.

5. [ ] **`README.md`** (modificado, `design.md` §2/ADR 124) — **TDD exception** (documentación) — documenta las dos vías al reporte (`npm run reporte:mensual` sin sesión, `/reporte-comisiones [periodo]` con `/login`) y cuándo usar cada una (ADR 118), más la nota de ancho mínimo recomendado (≥80 columnas, ADR 124: *"El reporte usa un layout de 77 columnas fijas; en terminales más angostas Ink lo envuelve línea por línea"*). Commit: `docs: documenta las dos vias al reporte y el ancho minimo recomendado en README (comando-reporte-comisiones, tarea 5)`.

6. [ ] **`docs/ARC42_Harness_Empresarial.md`** (modificado, `design.md` §5) — **TDD exception** (documentación) — actualiza la Caja Blanca del Registro de Comandos: quince → dieciséis comandos, agrega `/reporte-comisiones` a la enumeración, y anota que el reporte deja de ser el único flujo de negocio fuera de la TUI (consecuencia del ADR 116). Commit: `docs: actualiza la caja blanca del registro de comandos a dieciseis con reporte-comisiones (comando-reporte-comisiones, tarea 6)`.

7. [x] **Verificación manual del entregable** — **TDD exception** (sin código de producción) — con sesión vigente, `/reporte-comisiones 2026-08` en la TUI real y comparación byte a byte contra `npm run reporte:mensual -- --periodo 2026-08` sobre la misma base; sin sesión, `/reporte-comisiones` pide `/login` sin lecturas; `/reporte-comisiones` con período malformado (`"2026-13"`) responde el mensaje de uso; `/reporte-comisiones` sin argumento reporta el mes corriente real; fila en `registro_acciones_empleado` confirmada por consulta directa a `data/harness.db`; `npm run reporte:mensual` corrido en una terminal separada sin sesión, sin tocar código, con sus tests actuales en verde; **medición de ancho (R2)**: la tabla renderizada en una terminal de ≥80 columnas (legible) y en una angosta (<80, wrap documentado) — evidencia de las dos; `rg 'id_opcional_periodo' src/` confirma que la Forma se usa en un solo lugar del parser; `git diff --stat main -- src/adapters/` vacío (cero archivos de `adapters/` tocados, confirmando el Resumen de arquitectura de `design.md` §1); `npm test` y `npm run typecheck` en verde, incluidos `reporte-mensual.test.ts` sin modificar. Evidencia completa en `docs/progreso/v3.2-comando-reporte-comisiones/`. Commit: `docs: evidencia de verificacion manual del entregable reporte-comisiones (comando-reporte-comisiones, tarea 7)`.

## Reconciliación con el forecast de `design.md` §9

| Tarea | Archivo(s) | Líneas est. (`design.md`) |
|---|---|---|
| 1 | `reporte-contract.ts` (nuevo) | ~18 |
| 2 | `reporte.ts` + `reporte.test.ts` | ~25 + ~45 = ~70 |
| 3 | `comando-empleado.ts` + `registro-acciones-contract.ts` + `comando-empleado.test.ts` | ~28 + ~2 + ~30 = ~60 |
| 4 | `build-on-comando-empleado.ts` + `build-on-comando-empleado.test.ts` | ~45 + ~130 = ~175 |
| 5 | `README.md` | ~22 |
| 6 | `docs/ARC42_Harness_Empresarial.md` | ~18 |
| — | `specs/reporte-comisiones-mensual/spec.md` (delta, ya escrita) | ~20 |
| **Total** | | **~383** |

Coincide exactamente con el subtotal de `design.md` §9 (~178 implementación+docs+spec + ~205 tests = ~383) — no hizo falta ajustar el corte de líneas al bajar a granularidad de tarea. La tarea 7 (verificación manual) no suma al forecast, igual que en `definicion-skills/tasks.md`.

## Después de la tarea 7

- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este documento, las 3 specs y `design.md`, con atención especial a: **ADR 117** (`privilegiado: true` — verificable leyendo `esComandoPrivilegiado`), **ADR 118** (`src/reporte-mensual.ts` sin una sola línea tocada — `git diff --stat` debe estar vacío para ese archivo), **ADR 123 pto 4** (sin fila cuando el período es inválido — corte ANTES de cualquier lectura), y **ADR 124** (la igualdad byte a byte del `responseText`, no una comparación relajada).
- Si aprueba: checklist de cierre de `AGENTS.md` (Reviewer aprobado, entregable funcional demostrado, `docs/progreso/v3.2-comando-reporte-comisiones/` completo con la medición de ancho de R2), tag `v3.2.0` (numeración a confirmar por el checkpoint si `definicion-skills` no cierra primero como `v3.1.0`).

---

**Nota de formato**: mismo criterio que `definicion-skills/tasks.md` — se sigue el formato extenso ya establecido por `proposal.md`, las 3 `specs/` y `design.md` de este mismo change (archivo objetivo, requirement de origen, comando exacto y mensaje de commit por tarea, tal como `AGENTS.md` exige para el proceso de construcción paso a paso), en vez del tope de 530 palabras de la skill `sdd-tasks`.
