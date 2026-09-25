# Hito v3.21 — `reembolso-resta-monto-vendido-en-reporte`: el reporte de comisiones es neto de reembolsos aplicados

> **ESTADO: VERIFICACIÓN MANUAL COMPLETA (tarea 5.2).** Los pasos (1)-(3) los hizo el Implementer por CLI sobre COPIAS de `data/harness.db`. Los pasos (a) y (b) los hizo el humano en la TUI real el 2026-09-24 (ver "(a)/(b) Verificación en la TUI"). No es hito completo hasta el Reviewer, el tag y el cierre (Fase 7).

Rama: `hito/v3.21-reembolso-resta-monto-vendido-en-reporte`. Preparación y verificación: 2026-09-24.

## Qué cambia

Antes, el reporte mensual de comisiones (`agruparReporteMensual`/`formatearReporteMensual`) sumaba monto y comisión de **toda** venta del periodo, sin importar su estado — una venta `reembolsada` seguía contando como vendida. Ahora (ADR 301), "Monto vendido" y "Total comisionado" son **netos**: sólo suman ventas cuyo estado actual ≠ `reembolsada`. `reembolso_pendiente` y `reembolso_rechazado` **no restan**. La fila TOTAL imprime el monto neto y una leyenda de dos líneas lo explica. La tabla `comisiones` **no se toca** — sigue con la comisión originalmente generada; el reporte es derivado al leer. Ver [`mutaciones.md`](mutaciones.md) para la evidencia automatizada de que el neto, el orden y la leyenda realmente hacen su trabajo (checks de mutación M1-M5, tarea 5.1).

## ⚠️ Hallazgo durante la preparación: `/aprobar-reembolso` ya no es un comando de la TUI

La tarea `tasks.md` 5.2 (paso 4) pide *"En la copia: `/aprobar-reembolso` sobre la venta pendiente de Hito36"*, como si fuera un comando `/` de la TUI. **Ya no lo es.** Desde v3.10.0 (`aprobacion-conversacional-hitl`, ADR 151 EJECUTADO — ver `README.md` raíz, sección "Resolución de solicitudes internas y escalaciones de reembolso"), `/aprobar-reembolso` (y sus hermanos `/rechazar-reembolso`/`/reabrir-reembolso`) **se dieron de baja de la TUI**. Hoy se resuelven **por conversación**, vía la operación `resolver_reembolso` (`accion: "aprobar"`) de la herramienta `operaciones` (ADR 206), que además exige un paso de **confirmación** (dos turnos: pedido + confirmar) según `ejecutar-operacion.ts`/`ejecutar-operacion.test.ts` (bloque "resolver_reembolso", ADR 206-207, ADR 211, ADR 216, ADR 218).

**Qué tiene que hacer el humano en el paso (b)** (ver más abajo): loguearse como `administrador` y, en un turno conversacional normal (sin `/`), pedirle al agente que apruebe el reembolso pendiente de la venta `a6e574b8-4bed-47a1-9415-ec3b5898c967` (vendedor "Vendedor Prueba Hito36", caso `9343de80-a350-476b-83c1-24961e2018dd`) — por ejemplo: *"Aprobá el reembolso pendiente de la venta a6e574b8-4bed-47a1-9415-ec3b5898c967"* — y confirmar cuando el agente lo pida. El resultado esperado en `ventas`/`comisiones` es el mismo (CAS `reembolso_pendiente → reembolsada`, tabla `comisiones` intacta); sólo cambia el canal (conversación en vez de un comando `/`).

## Cómo apuntar la TUI/CLI a una copia (nunca a `data/harness.db`)

Mecanismo real (`src/adapters/memory/config.ts`, `resolveDbPath`): la variable de entorno **`HARNESS_DB_PATH`** (default `data/harness.db` si está ausente/vacía). La usan tanto `main.ts` (TUI, vía `empleados.ts`/composition root) como `src/reporte-mensual.ts` (CLI) — **el mismo resolver**. `openDatabase` aplica migraciones al abrir, así que cualquier apertura (TUI o CLI) sobre una copia es segura: sólo migra/escribe la copia, nunca el archivo real.

Copias preparadas (`.backup` de `sqlite3`, consistente con el WAL activo), con `PRAGMA integrity_check` = `ok` en las tres:

| Copia | Uso |
| --- | --- |
| `harness-copia.db` | Paso (2)/(3): CLI "after" + verificación SQL + paso (a) de la TUI |
| `harness-copia-cli-before.db` | Paso (1): CLI "before" sobre `main` |
| `harness-copia-aprobar.db` | Paso (4)/(b): aprobar el reembolso de Hito36, aislado de las otras dos |

Comandos para el humano (Git Bash, PowerShell usa `$env:HARNESS_DB_PATH="..."`):

```sh
# TUI, paso (a) — sobre harness-copia.db (misma que el CLI "after"):
HARNESS_DB_PATH="<ruta-a>/harness-copia.db" npm run dev

# TUI, paso (b) — sobre harness-copia-aprobar.db (aislada):
HARNESS_DB_PATH="<ruta-a>/harness-copia-aprobar.db" npm run dev

# CLI, para contrastar cualquiera de las dos:
HARNESS_DB_PATH="<ruta-a>/harness-copia.db" npm run reporte:mensual -- --periodo 2026-09
```

Las tres copias están en el scratchpad de esta sesión (no en el repo): `C:\Users\Windows\AppData\Local\Temp\claude\C--Users-Windows-Documents-UCAB-11-intensivo-agosto-2026-Pasantia-arnes-empresarial\1a390956-e4a2-4a93-80e4-11dd05c0e3f3\scratchpad\v3.21-phase5\`. El humano debe copiarlas a una ruta estable antes de la sesión de TUI si el scratchpad puede limpiarse.

## Periodo real usado

`2026-09` — es el único periodo con datos en `data/harness.db` a la fecha de esta preparación (`SELECT substr(confirmed_at,1,7)... GROUP BY periodo` ⇒ un solo grupo, 11 filas). Los seis vendedores y los importes de `tasks.md` 5.2 (paso 3) **coinciden exactamente** con los datos reales de esta base — no hizo falta recalcular a mano.

## (1) Antes — CLI sobre `main`, vía `git worktree`

`git worktree add --detach <scratchpad>/main-wt main` (HEAD `b891645`) + copia rápida de `node_modules` ya compilado (`robocopy /E /MT:16`, evita recompilar el binario nativo de `better-sqlite3` con `npm ci`, que falló por un problema de MSBuild en este entorno — documentado como hallazgo, no bloqueante). Corrido sobre `harness-copia-cli-before.db`, luego el worktree se eliminó (`git worktree remove --force`); `git status` del repo principal quedó limpio.

```
Reporte de comisiones - periodo 2026-09

Vendedor                 Ventas Monto vendido Total comisionado Con reembolso
-----------------------------------------------------------------------------
Vendedor Prueba Hito36        1      15000.00           1500.00             1
Vendedor Prueba V39           1       5000.00            500.00             0
Rick                          1       4000.00            400.00             0
Beto                          3       3700.00            370.00             2
Ana Vendedora                 4       3700.00            370.00             3
Tom                           1       3000.00            300.00             0
-----------------------------------------------------------------------------
TOTAL                                                   3440.00

Reembolsos pendientes de aprobación
...
- venta a6e574b8-4bed-47a1-9415-ec3b5898c967 | vendedor Vendedor Prueba Hito36 | ...
```

Bruto: Beto y Ana muestran su comisión **con** lo reembolsado sumado (Beto 370.00 = 300 + 70; Ana 370.00 = 120 + 250, exactamente el ejemplo del `design.md` R1: "Ana: 120.00 vs 370.00"). TOTAL 3440.00 = `SUM(comisiones.monto)` sin excluir nada.

## (2)/(3) Después — CLI sobre esta rama + verificación SQL

Mismo periodo, `harness-copia.db` (rama actual, HEAD `411bc7a`):

```
Reporte de comisiones - periodo 2026-09

Vendedor                 Ventas Monto vendido Total comisionado Con reembolso
-----------------------------------------------------------------------------
Vendedor Prueba Hito36        1      15000.00           1500.00             1
Vendedor Prueba V39           1       5000.00            500.00             0
Rick                          1       4000.00            400.00             0
Beto                          3       3000.00            300.00             2
Tom                           1       3000.00            300.00             0
Ana Vendedora                 4       1200.00            120.00             3
-----------------------------------------------------------------------------
TOTAL                                31200.00           3120.00

Nota: monto y comisión netos de reembolsos aplicados (estado reembolsada).
"Con reembolso" cuenta también los pendientes, que todavía no restan.

Reembolsos pendientes de aprobación
...
```

**Contraste contra `tasks.md` 5.2 paso 3** (todo coincide exacto, sin recalcular):

| Vendedor | Esperado (tasks.md) | Observado |
| --- | --- | --- |
| Ana (`v1`) | 1200.00 / 120.00, 4 ventas / 3 con reembolso | ✅ igual |
| Beto (`beto`) | 3000.00 / 300.00, 3 / 2 | ✅ igual |
| Hito36 (`test-verificacion-hito36`) | 15000.00 / 1500.00 (pendiente, sin cambio), 1 / 1 | ✅ igual |
| V39 (`verif-chat-v39`) | 5000.00 / 500.00 | ✅ igual |
| Rick (`jimmy`) | 4000.00 / 400.00 | ✅ igual |
| Tom (`tom`) | 3000.00 / 300.00 | ✅ igual |
| **TOTAL** | **31200.00 / 3120.00** | ✅ igual |
| Orden | Hito36, V39, Rick, Beto, Tom, Ana (desempate `beto` < `tom`) | ✅ igual |
| Comisión 10 % exacta por venta reembolsada | Ana 250.00 (100+1200+1200 → comisión 10+120+120), Beto 70.00 (200+500 → 20+50) | ✅ igual (ver detalle fila por fila abajo) |

Ana tiene 3 ventas `reembolsada` que suman 2500.00 de monto (comisión 250.00: 10.00+120.00+120.00) y Beto tiene 2 que suman 700.00 (comisión 70.00: 20.00+50.00) — exactamente los montos que cita `tasks.md`.

**Ancho ≤ 77**: verificado con `awk '{print length}'` sobre el bloque de tabla+TOTAL+leyenda — máximo observado **77** (encabezado, separador y filas), TOTAL **63**, leyenda **75**/**71**. La sección libre "Reembolsos pendientes de aprobación" es prosa, no tabla de ancho fijo (diseño intencional, ADR 26) — no está sujeta al límite de 77.

**SQL de contraste** (readonly, sobre `harness-copia.db`, ANTES y DESPUÉS de correr el CLI):

```
sqlite3 -readonly harness-copia.db "SELECT COUNT(*), SUM(monto) FROM comisiones;"
→ 11|3440.0   (igual antes y después de correr el reporte — la tabla comisiones nunca se toca al leer)
```

## (a)/(b) Verificación en la TUI (humano, 2026-09-24)

**Esperado** (recalculado a mano sobre esta base real, no el genérico de `tasks.md`): Hito36 pasa de `reembolso_pendiente` a `reembolsada` ⇒ su fila queda **0.00 / 0.00** (última, con `totalComisionado` neto = 0, pierde el primer lugar) y ya no aparece en "Reembolsos pendientes de aprobación"; el resto de las filas no cambia. Nuevo TOTAL = 31200.00 − 15000.00 = **16200.00** / 3120.00 − 1500.00 = **1620.00**. `SELECT COUNT(*), SUM(monto) FROM comisiones` en `harness-copia-aprobar.db` debe seguir en **11 | 3440.00** (la tabla no se toca).

### (a) `/reporte-comisiones` en la TUI con los datos reales

El humano corrió `/login jimmy` y `/reporte-comisiones` en la TUI (22:45, `harness.log`: `login-exitoso`, `comando-empleado-recibido` `reporte_comisiones`, `accion-empleado-registrada` `atendida`) y observó a Beto pasar de 3700.00 (bruto, reporte de `main`) a **3000.00** (neto), como se esperaba. **Incidente de proceso**: esa sesión corrió contra `data/harness.db` y no contra `harness-copia.db`, porque `HARNESS_DB_PATH` no quedó definida en la terminal que lanzó `npm run dev`. Como `/reporte-comisiones` es de sólo lectura, la base real sólo registró la sesión de login y la auditoría de los comandos; la venta de Hito36 siguió en `reembolso_pendiente` y `comisiones` en 11 | 3440.00 (`sqlite3 -readonly`, verificado después). La comparación byte a byte TUI = CLI se hizo en el paso (b).

### (b) Reembolso aprobado en vivo, sobre `harness-copia-aprobar.db`

Transcripción de la TUI (la clave aparece enmascarada por el ADR 300):

```
[22:48:29] Vos: /login jimmy ****
sistema: Sesión abierta como jimmy. Vence 2026-09-25T10:48:29.113Z.
[22:48:31] Vos: Aprobá el reembolso pendiente de la venta a6e574b8-4bed-47a1-9415-ec3b5898c967
agente-conversacional: Antes de resolverlo, la herramienta me pide confirmación:
> Vas a aprobar el reembolso de la venta a6e574b8-4bed-47a1-9415-ec3b5898c967 (monto 15000). Confirmá
pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[22:49:00] Vos: confirmado
agente-conversacional: Listo, quedó resuelto:
- Venta a6e574b8-4bed-47a1-9415-ec3b5898c967: estado reembolsada
- Caso de escalación 9343de80-a350-476b-83c1-24961e2018dd: estado resuelto
[22:49:14] Vos: /reporte-comisiones
sistema: Reporte de comisiones - periodo 2026-09

Vendedor                 Ventas Monto vendido Total comisionado Con reembolso
-----------------------------------------------------------------------------
Vendedor Prueba V39           1       5000.00            500.00             0
Rick                          1       4000.00            400.00             0
Beto                          3       3000.00            300.00             2
Tom                           1       3000.00            300.00             0
Ana Vendedora                 4       1200.00            120.00             3
Vendedor Prueba Hito36        1          0.00              0.00             1
-----------------------------------------------------------------------------
TOTAL                                16200.00           1620.00

Nota: monto y comisión netos de reembolsos aplicados (estado reembolsada).
"Con reembolso" cuenta también los pendientes, que todavía no restan.

Reembolsos pendientes de aprobación
...
(sin reembolsos pendientes)
```

**TUI = CLI**: `HARNESS_DB_PATH=<copia>/harness-copia-aprobar.db npm run reporte:mensual -- --periodo 2026-09`, corrido después de la sesión, produce una tabla (encabezado, filas, TOTAL y leyenda) idéntica línea por línea a la de la TUI (`diff` sin diferencias).

**SQL de contraste** (`sqlite3 -readonly`, después de la sesión):

```
harness-copia-aprobar.db → ventas a6e574b8…: reembolsada · comisiones: 11|3440.0
data/harness.db          → ventas a6e574b8…: reembolso_pendiente · comisiones: 11|3440.0
```

| # | Paso | Resultado esperado | Resultado observado |
| --- | --- | --- | --- |
| a | `/reporte-comisiones` en la TUI logueado | Neto de reembolsos aplicados (Beto 3700.00 → 3000.00) | ✅ Beto 3000.00. Corrió sobre `data/harness.db` (sólo lectura del reporte; ver incidente) |
| b | Aprobar (conversacional, con confirmación) el reembolso de Hito36 sobre `harness-copia-aprobar.db`, luego `/reporte-comisiones` | Hito36 `0.00 / 0.00` en la última fila; TOTAL `16200.00 / 1620.00`; `comisiones` sigue en 11/3440.00; TUI = CLI | ✅ todo igual; `diff` TUI vs CLI vacío |

### Hallazgo fuera de alcance: nota obsoleta en la sección de reembolsos pendientes

`src/core/ventas/reporte.ts:242` todavía imprime *"estas escalaciones se resuelven con /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso desde la TUI"*, pero esos comandos se dieron de baja en v3.10.0 (ADR 210 pto 1, tarea 14; hoy se resuelven por conversación vía `resolver_reembolso`). Es texto preexistente y no lo toca este change (el alcance de `reporte.ts` es la tabla neta). Queda como deuda para un change aparte.

**Resuelto en la Fase 5b (ADR 302)**.

### Fase 5b — enmienda: nota de escalaciones conversacional (ADR 302)

Tarea `tasks.md` 5b.4. La nota nueva (sin comandos retirados, canales TUI local + chat web) queda fijada por `reporte.test.ts:577-...` y por la guarda A3 (`COMANDOS`) — ver `mutaciones.md`, sección M6/M7, para la evidencia de mutación.

**Evidencia manual (humano, 2026-09-24/25)**

1. **CLI sobre una copia** (`harness-copia-5b.db`, `.backup` de `data/harness.db` con `PRAGMA integrity_check` = `ok`, venta de Hito36 todavía en `reembolso_pendiente`): `HARNESS_DB_PATH=<copia> npm run reporte:mensual -- --periodo 2026-09` imprime en la sección "Reembolsos pendientes de aprobación" la nota nueva, idéntica al texto de `design.md` §11.2, seguida de la venta pendiente de Hito36:

   ```
   Nota: estas escalaciones se resuelven por conversación con el asistente, en el texto libre de la TUI local de empleados (tras /login) o en el chat web (tras iniciar sesión): se pide aprobar, rechazar o reabrir el reembolso y se confirma en un turno aparte. La contraseña se verifica localmente contra la misma base de datos que este proceso escribe.

   - venta a6e574b8-4bed-47a1-9415-ec3b5898c967 | vendedor Vendedor Prueba Hito36 | cliente cliente-prueba-001 | monto 15000.00 | caso 9343de80-a350-476b-83c1-24961e2018dd | confirmada 2026-09-13T12:38:00.995Z
   ```

2. **TUI**: el humano corrió `/login` y `/reporte-comisiones` (`harness.log`, 03:30Z: `login-exitoso`, `reporte_comisiones` `atendida`) y observó la nota nueva, sin comandos retirados. La TUI y el CLI la imprimen desde la misma constante (`formatearReporteMensual`), y la igualdad byte a byte TUI = CLI del reporte ya quedó demostrada en el paso (b) de la tarea 5.2. **Incidente repetido**: esta sesión también corrió contra `data/harness.db` y no contra la copia (la copia quedó sin tocar, la base real registró la sesión). Como `/reporte-comisiones` es de sólo lectura, sólo se escribieron la sesión de login y la auditoría; la venta de Hito36 sigue en `reembolso_pendiente` y `comisiones` en 11 | 3440.00 (`sqlite3 -readonly`, verificado después). La causa de que `HARNESS_DB_PATH` no se aplique en la TUI no se investigó en este change.

3. **`/aprobar-reembolso` y consulta conversacional del reporte**: el humano declara que los probó y que el comando retirado no volvió a aparecer, ni en la nota ni en la respuesta del asistente. **No hay salida pegada ni rastro en el extracto de `harness.log` revisado**, así que queda como observación declarada del humano, no como evidencia reproducible. La cobertura automatizada de este punto son el test de la nota, la guarda A3 contra `COMANDOS` y las mutaciones M6/M7.

## Residuales declarados (`design.md` §8)

| # | Residual | Estado |
| --- | --- | --- |
| **R1** ★ | El reporte diverge de la tabla `comisiones` / de lo efectivamente liquidado — visible en esta misma evidencia: Ana muestra 120.00 neto en el reporte, pero `comisiones` sigue con 370.00 de comisión generada en total para ella. Un clawback real (ajustar/anular la fila de `comisiones`) queda fuera de alcance — **deuda B6** | Aceptado, declarado en el ADR 301 pto 4 y en la leyenda de la tabla |
| **R3** / **B4** | Un reembolso aprobado tarde cambia el reporte del mes de `confirmed_at` de la venta, aunque ese mes ya se haya "cerrado" (no existe `refunded_at` para anclar el reembolso a su propio mes) | Aceptado, declarado en el ADR 301 pto 5; deuda B4 |
| **R4** | Reportes ya exportados (CLI, A2A) no se recalculan: si el mismo periodo se vuelve a pedir después de un reembolso nuevo, el número cambia — el reporte nunca fue un documento persistido | Aceptado, consecuencia declarada del ADR 301; "formato de salida como archivo persistido" está fuera de alcance del spec |

## Evidencia automatizada ya disponible

- Unitarios del núcleo: `src/core/ventas/reporte.test.ts` (U1-U7, F1-F2, golden neto).
- Consumidor A2A: `src/core/agents/consultas-negocio-tool.test.ts` (C1).
- Consumidor TUI/CLI con SQLite real: `src/build-on-comando-empleado.test.ts` (C2, `aprobarReembolso` real).
- Mutación (tarea 5.1): [`mutaciones.md`](mutaciones.md) — M1-M5, con salida roja y verde de cada una.

## Enlaces

- Propuesta: [`../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/proposal.md`](../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/proposal.md)
- Diseño (ADR 301, residuales R1-R8): [`../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/design.md`](../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/design.md)
- Tareas: [`../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/tasks.md`](../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/tasks.md)
- Mutación: [`mutaciones.md`](mutaciones.md)
