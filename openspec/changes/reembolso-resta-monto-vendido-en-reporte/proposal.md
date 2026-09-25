# Propuesta: el reembolso aplicado resta el "Monto vendido" y el "Total comisionado" en el reporte de comisiones

**Origen**: pedido del usuario, mirando `/reporte-comisiones`: *"cuando quiero aplicar el reembolso, se debe de reflejar el reembolso en el monto vendido total, o sea aplicar una resta al monto vendido total"*.

**Rama prevista**: `hito/v3.XX-reembolso-resta-monto-vendido-en-reporte`. `v3.20` lo reserva `respaldo-y-durabilidad-sqlite` y el hermano `enmascarar-password-en-tui` propone `v3.21`. El número sale del checkpoint (punto 7). La rama se crea **después** del checkpoint (AGENTS.md).

**No es un hito del Plan.** **Revierte en el reporte** una deuda declarada (R5 de `hito-1.3-ventas-comisiones`).

**Decisión del humano (2026-09-24)**: **B1 = (ii)**. Un reembolso aplicado resta del vendedor el monto **y** la comisión, derivado al leer.

> **Nota de proceso**: este ejecutor no tiene shell, así que no pudo correr `graphify query` ni `sqlite3 -readonly data/harness.db`. El código se verificó con `Read`/`Grep`. Los datos por vendedor vienen de la exploración. Las sumas se recalcularon a mano y cuadran con el total de hoy (3440.00). **La comisión de cada venta reembolsada (10 %) se confirma contra la base en `sdd-spec`.**

**Numeración**: el techo sigue en **ADR 300 / RD-172**, que reserva el hermano (`enmascarar-password-en-tui/design.md:252`). Hasta hoy nadie cita el 301 o más, salvo este change y esa misma línea. Este change abre el **ADR 301** (y la RD-173 si design la necesita). **Reverificar en `sdd-design`.**

---

## Intent

**Qué pasa hoy**: `agruparReporteMensual` suma `ventaMonto` y `comisionMonto` de **todas** las comisiones del periodo, sin mirar el estado de la venta (`src/core/ventas/reporte.ts:163-164`). Un reembolso aprobado no descuenta nada. Además, la fila TOTAL deja vacía la celda de "Monto vendido" (`:243-248`).

Impacto con los datos reales (comisión del 10 %, monto / comisión):

| Vendedor | Ventas | Reembolso | Hoy | Esperado |
|---|---|---|---|---|
| Ana Vendedora | 4 | 3 `reembolsada` por 2500.00 | 3700.00 / 370.00 | **1200.00 / 120.00** |
| Beto | 3 | 2 `reembolsada` por 700.00 | 3700.00 / 370.00 | **3000.00 / 300.00** |
| Vendedor Prueba Hito36 | 1 | 1 `reembolso_pendiente` por 15000.00 | 15000.00 / 1500.00 | sin cambio (no está aprobado) |
| V39 / Rick / Tom | — | ninguno | 5000.00 / 500.00, 4000.00 / 400.00, 3000.00 / 300.00 | sin cambio |
| **TOTAL** | | | (vacío) / 3440.00 | **31200.00 / 3120.00** |

**Por qué es deuda y no un bug accidental**: R5 (*"un reembolso deja viva la comisión ya pagada"*) está declarado en `hito-1.3-ventas-comisiones/proposal.md:34,194,232`, en `design.md:2082` y en `reembolso-evaluacion/spec.md:9`. También está comentado en `reporte.ts:39,60`. No lo declaró ningún ADR, sólo la tabla de riesgos. La reversión se difirió hasta *"decidir el modelo contable"*. **El humano lo decidió: (ii).** Este change revierte R5 **en el reporte**. La tabla `comisiones` no cambia.

**Éxito**: "Monto vendido" y "Total comisionado" son netos de los reembolsos **aplicados** (`reembolsada`) en los cuatro consumidores, y la fila TOTAL suma los dos.

---

## Scope

### In Scope

- `agruparReporteMensual`: para las ventas `reembolsada`, `montoVendido` resta su `ventaMonto` y `totalComisionado` resta su `comisionMonto`. `reembolso_pendiente` y `reembolso_rechazado` **no** restan nada.
- `FilaVendedor.montoReembolsado` y `FilaVendedor.comisionRevertida`: campos nuevos que **no se imprimen** (B7).
- `ReporteMensual`: se agrega el total de monto vendido neto. La fila TOTAL imprime el monto neto y la comisión neta.
- El orden sigue siendo `totalComisionado` DESC y `vendedorId` ASC (`reporte.ts:181`), pero ahora sobre la comisión **neta**.
- Una fila con todas sus ventas reembolsadas queda en 0.00 / 0.00 y **se imprime**.
- Leyenda bajo la tabla: el reporte es neto de reembolsos aplicados, y "Con reembolso" incluye pendientes que todavía no restan (texto final en design).
- **ADR 301 (obligatorio)**: declara R5 *superseded* para el reporte mensual y fija su nuevo sentido contable (ver Approach).
- Deltas de spec (ver Capabilities) y tests en TDD estricto.

### Out of Scope

- **SQL, repositorio y migraciones**. `listComisionesPorPeriodo` ya trae `v.estado AS venta_estado` y `venta_monto` (`src/adapters/memory/repository.ts:1241-1262`).
- **Reembolso parcial**. El reembolso es todo-o-nada (`reembolso-evaluacion/spec.md:65`).
- **Columna `refunded_at`** (B4).
- **Tocar la tabla `comisiones`** o hacer un *clawback* real (B6). La tabla sigue registrando la comisión originalmente generada.
- **Consultas KPI y web**: no leen `ventaMonto` (verificado con grep).
- **Evidencia histórica** (`docs/progreso/v3.2-*`, `v3.8-*`): registra el pasado y no se reescribe.
- **El change hermano `enmascarar-password-en-tui`.**

---

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

| Capability | Última versión vigente | Qué cambia |
|---|---|---|
| `reporte-comisiones-mensual` | `hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual/spec.md:23-30`. Deltas posteriores: `tui-canal-empleado` (ADDED *"Una venta `reembolso_rechazado` no cuenta como reembolso en el reporte"*, `:17`), `comando-reporte-comisiones` y `consultas-negocio-a2a-entrante` (estos dos sólo tocan el requirement de disparo) | Se modifica el requirement *"Agregación pura por vendedor y periodo"*: monto y comisión son netos de `reembolsada`, los pendientes no restan, la fila TOTAL suma los dos netos y el orden usa la comisión neta. Tiene que ser coherente con `:17`: el rechazado no cuenta y tampoco resta. **Ningún requirement actual fija que el monto o la comisión sean brutos**, así que el delta agrega la regla en lugar de contradecir otra |
| `consultas-negocio-a2a` | `consultas-negocio-a2a-entrante/specs/consultas-negocio-a2a/spec.md:47` | Un scenario nuevo: `Monto vendido` y `Total comisionado` del agregado `reporte_comisiones` son netos. Los hereda sin cambiar código: suma `montoVendido` por fila y usa `reporte.totalComisionado` (`consultas-negocio-tool.ts:276,284`) |
| `reembolso-evaluacion` | Hoy vale `tui-canal-empleado/specs/reembolso-evaluacion/spec.md`, sobre `hito-1.3.../spec.md:63-70` | **Obligatorio**. Aclara que el reporte descuenta la comisión de forma derivada. La tabla `comisiones` sigue intacta, así que el SHALL NOT de `:65` se cumple |

★ `operaciones-negocio-conversacionales/specs/herramienta-operaciones-negocio/spec.md:81` dice *"Este change SHALL NOT modificar… `agruparReporteMensual`"*. Tiene alcance de ese change, pero **sdd-spec debe confirmar** que no quedó como prohibición permanente de la capability.

---

## Approach

Es un cambio puro dentro de `src/core/ventas/reporte.ts`. En el bucle de `:153-170`, si `ventaEstado === VENTA_ESTADO_REEMBOLSADA`, se acumulan `montoReembolsado` y `comisionRevertida`, y cada fila guarda el neto (bruto menos lo revertido). El redondeo es el de siempre (ADR 16). No hay divisiones, así que una fila en 0.00 no rompe nada. La TUI (`build-on-comando-empleado.ts:1371-1374`), la vía conversacional (`ejecutar-operacion.ts:792-794`), el CLI (`reporte-mensual.ts:99-100`) y A2A (`consultas-negocio-tool.ts:312`) pasan todos por esta función: **un solo punto de cambio** y ningún adapter se toca. El cálculo es derivado al leer, así que es retroactivo sólo sobre lo que ya está `reembolsada`.

**Sentido contable que fija el ADR 301**: el reporte mensual muestra lo **neto** de los reembolsos aplicados. La tabla `comisiones` sigue registrando la comisión **originalmente generada** y **no** es un libro de lo efectivamente pagado. R5 queda *superseded* sólo para el reporte.

**Alternativas descartadas por el humano (2026-09-24)**:
- **(i) Sólo el monto**: la comisión dejaba de ser el 10 % del neto y una fila 100 % reembolsada mostraba comisión con 0.00 vendido.
- **(iii) Columnas bruto / reembolsado / neto**: el ancho pasaba de 77 a ~91, cambiaban todos los golden y era más de lo pedido.

| # | Decisión | Opciones y tradeoffs | Recomendación |
|---|---|---|---|
| **B2** | Fila TOTAL | Sumar los netos o dejar vacía la celda del monto, como hoy | Sumar monto neto y comisión neta |
| **B3** | "Ventas" y "Con reembolso" | Conservar los conteos brutos y agregar una leyenda: *"Con reembolso"* incluye pendientes y sólo los `reembolsada` restan. La alternativa es separar aplicados de pendientes: agrega una columna y el mismo costo de ancho que (iii) | Conservar y agregar la leyenda |
| **B4** | Meses cerrados | El periodo es el mes de `confirmed_at` y no hay fecha de reembolso: un reembolso aprobado en octubre cambia el reporte de septiembre. Se puede aceptar y documentar, o agregar `refunded_at` (migración, fuera de alcance) | Aceptar y documentar |
| **B5** | Semántica visible para consumidores externos | A2A y la vía conversacional pasan a ver monto y comisión netos con las mismas etiquetas. Ningún spec fija el bruto (verificado), así que alcanza con los deltas de la tabla de arriba | Deltas y ADR 301 |

**Reorden con los datos reales**: hoy es Hito36, V39, Rick, Ana y Beto (empatados en 370.00) y después Tom. Queda así: Hito36 (1500.00), V39 (500.00), Rick (400.00), después Beto y Tom (empatados en 300.00, **desempate por `vendedorId`**, que se confirma contra la base) y **Ana (120.00) al final**.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/ventas/reporte.ts` | Modified | Acumulador, `FilaVendedor`, `ReporteMensual`, fila TOTAL, leyenda y los comentarios de R5 (`:39,60`) |
| `src/core/ventas/reporte.test.ts` | Modified | Tests nuevos. El golden de `:221-238` **cambia a propósito**: "Ana Gomez" (`reembolsada`, 1500 / 225) pasa a 0.00 / 0.00 y queda **debajo** de Juan Perez, TOTAL imprime 1000.00 / 100.00 y aparece la leyenda. Los demás tests no usan `reembolsada` con montos fijados (el de `:152` sólo mira conteos) |
| `src/core/agents/consultas-negocio-tool.test.ts` | Modified | Un test nuevo del agregado neto (monto y comisión). Los existentes usan `confirmada` o `reembolso_pendiente` (`:197,206`) y siguen verdes. `consultas-negocio-tool.ts` no cambia |
| `openspec/changes/reembolso-resta-monto-vendido-en-reporte/specs/*` | New | Deltas |
| `docs/ARC42_Harness_Empresarial.md` | Modified | ADR 301 |
| Repositorio, migraciones, `build-on-comando-empleado.ts`, `ejecutar-operacion.ts`, `reporte-mensual.ts`, TUI, web | **Sin cambios** | Si aparecen en el diff, el change se salió del alcance |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | **El reporte y la tabla `comisiones` (o lo efectivamente liquidado) divergen**: el reporte muestra 120.00 para Ana, pero la tabla sigue con 370.00 y nadie cobró la diferencia | Cierta | ADR 301 lo declara y la leyenda dice "neto". El *clawback* real queda abierto (B6) |
| R2 | Restar también `reembolso_pendiente` (Hito36) por error | Media | Test por estado: `confirmada`, `reembolsada`, `reembolso_pendiente` y `reembolso_rechazado` |
| R2b | Cambia el orden de las filas (se ordena por comisión) y una fila 100 % reembolsada desaparece o se filtra por quedar en 0.00 | Cierta / Baja | Test de orden con comisión neta y test de fila en 0.00 / 0.00 que sigue impresa |
| R2c | `herramienta-operaciones-negocio/spec.md:81` prohíbe modificar `agruparReporteMensual` | Baja | Parece con alcance de ese change. **`sdd-spec` confirma** que no quedó como prohibición permanente de la capability |
| R3 | Los reportes de meses cerrados cambian después del cierre (B4) | Cierta | Documentarlo en el ADR 301 y en la leyenda o la ayuda |
| R4 | Un consumidor externo (A2A) espera el bruto | Baja | No hay spec que lo fije. Delta en `consultas-negocio-a2a` |
| R5' | Test de igualdad byte a byte (`build-on-comando-empleado.test.ts:1623`) | Baja | Compara contra las mismas funciones puras, así que sigue verde sin editarlo |
| R6 | Choque de ADR, hito o arc42 con el hermano | Media | ADR 301 y reverificación en design. El orden de merge se decide en el checkpoint |

## Rollback Plan

1. `git revert` de los commits del change. **No hay migración, datos ni configuración**: `listComisionesPorPeriodo` ya trae `venta_estado`, `venta_monto` y `comision_monto` (`repository.ts:1241-1262`), el cálculo es derivado al leer y la tabla `comisiones` no se toca. Después del revert, el reporte vuelve a mostrar el bruto sobre la misma base.
2. El ADR 301 queda marcado *revertido* en el arc42 y R5 vuelve a su estado previo.

## Dependencies

- B1 ya está decidido (2026-09-24). El checkpoint humano (AGENTS.md) sigue gateando spec, design y tasks antes del Implementer.
- Sin dependencias npm nuevas.

## Success Criteria

- [ ] Con los datos reales: Ana Vendedora **1200.00 / 120.00**, Beto **3000.00 / 300.00**, Hito36 **15000.00 / 1500.00**, V39 5000.00 / 500.00, Rick 4000.00 / 400.00 y Tom 3000.00 / 300.00 (los cuatro últimos sin cambio).
- [ ] La fila TOTAL imprime **31200.00 / 3120.00**.
- [ ] Ana queda última. El empate Beto/Tom lo resuelve `vendedorId` ASC.
- [ ] Una fila con todas sus ventas `reembolsada` se imprime en 0.00 / 0.00.
- [ ] `reembolso_pendiente` y `reembolso_rechazado` no restan. Hay un test por estado.
- [ ] "Ventas" y "Con reembolso" no cambian (Ana 4/3, Beto 3/2, Hito36 1/1).
- [ ] El A2A `reporte_comisiones` devuelve `Monto vendido` y `Total comisionado` netos sin cambios en su código.
- [ ] El ADR 301 declara R5 *superseded* para el reporte y dice que la tabla `comisiones` no es un libro de lo pagado.
- [ ] El diff no toca las áreas marcadas como *Sin cambios*.
- [ ] `npm test` y `npm run typecheck` pasan. **Strict TDD**: el Implementer escribe primero el test que falla.

## Estimación vs presupuesto de review (400 líneas)

| Bloque | Líneas est. |
|---|---|
| `reporte.ts` (monto, comisión, total, leyenda) | ≈ 25-40 |
| Tests (por estado, orden, fila en 0.00, golden y A2A) | ≈ 55-90 |
| Deltas de spec (tres capabilities) y ADR 301 | ≈ 30-50 |
| **Total** | **≈ 110-180** |

**Riesgo de superar las 400: Bajo.** Entra en un solo PR.

## Decisiones abiertas para el checkpoint

1. **B2**: ¿la fila TOTAL suma el monto neto y la comisión neta? Recomendado: **sí**.
2. **B3**: ¿conservar los conteos brutos y agregar una leyenda? Recomendado: **sí**.
3. **B4**: ¿aceptás que un reembolso tardío cambie el reporte de un mes cerrado? Recomendado: **aceptar y documentar**.
4. **B5**: ¿alcanzan los deltas de las tres capabilities? ¿La leyenda se imprime también en el agregado A2A? Recomendado: **sí, y la leyenda sólo en la tabla**.
5. **B6, clawback real y libro de comisiones pagadas**: queda fuera de alcance. ¿Se abre un change futuro? Recomendado: **registrarlo como deuda en el ADR 301**.
6. **B7, columna "Reembolsado"**: ¿se muestra aparte el monto reembolsado? Recomendado: **no imprimirla**, pero exponer `montoReembolsado` y `comisionRevertida` en `FilaVendedor` por si se pide después.
7. **B8, numeración y hito**: ADR 301 / RD-173 tras el ADR 300 / RD-172 del hermano, número de hito y orden de merge frente a `enmascarar-password-en-tui` y `respaldo-y-durabilidad-sqlite`.
