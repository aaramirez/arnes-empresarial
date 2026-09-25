# Checks de mutación — reporte de comisiones neto de reembolsos (tarea 5.1)

Tarea `openspec/changes/reembolso-resta-monto-vendido-en-reporte/tasks.md` 5.1. Fecha: 2026-09-24. Rama `hito/v3.21-reembolso-resta-monto-vendido-en-reporte`. Cubre M1-M5 del design (ADR 301 §3, §4) y de la propia tarea 5.1.

## Procedimiento (igual para las cinco)

1. Copia de respaldo del archivo fuera del repo (`sha256sum` del original antes de mutar).
2. Mutación de una sola línea con `Edit` (nunca reescritura completa del archivo).
3. Test dirigido con `npx vitest run <archivo> -t "<filtro>"` sobre el archivo mutado (salida roja, abajo).
4. Restauración copiando el respaldo sobre el archivo (`cp`, no `git checkout`).
5. `sha256sum` del archivo restaurado = igual al original; `git diff -- src` vacío; test dirigido de nuevo en verde.

Todas las mutaciones se probaron **una a la vez**: nunca hubo dos archivos mutados a la vez. Al final de las cinco, `git diff -- src` vacío y `npm run typecheck` verde (ver Cierre).

---

## M1 — también resta `reembolso_pendiente`

**Archivo:línea**: `src/core/ventas/reporte.ts:187` (dentro de `agruparReporteMensual`).

**Código mutado**:

```diff
-    if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA) {
+    if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA || c.ventaEstado === VENTA_ESTADO_REEMBOLSO_PENDIENTE) {
```

**Comando**: `npx vitest run src/core/ventas/reporte.test.ts -t "U1"` (más `-t "U5"` y `src/core/agents/consultas-negocio-tool.test.ts -t "C1"`).

**Salida roja (extracto, U1)**:

```
FAIL … estado reembolso_pendiente: sólo `reembolsada` resta monto y comisión (U1)
AssertionError: expected { vendedorId: 'vend-1', …(7) } to match object { montoVendido: 1000, …(4) }
- "montoVendido": 1000,
- "totalComisionado": 100,
+ "montoVendido": 0,
+ "totalComisionado": 0,
Tests  1 failed | 3 passed | 31 skipped (35)
```

**Salida roja (extracto, U5 — orden)**:

```
FAIL … regresión con datos reales: el orden y los netos por vendedor (U5)
AssertionError: expected [ 'hito36', 'v39', …(4) ] to deeply equal [ 'hito36', 'v39', …(4) ]
- Expected: […, "beto", "tom", "ana"]
+ Received: […, "ana", "beto", "tom"]   (Hito36, con reembolso_pendiente, deja de sumar y ya no lidera)
Tests  1 failed | 34 skipped (35)
```

**Salida roja (extracto, C1)**:

```
FAIL … reporte_comisiones: reembolso_pendiente y reembolso_rechazado NO restan del agregado (ADR 301, C1)
AssertionError: expected '...' to contain 'Monto vendido: 16000.00'
- Monto vendido: 16000.00
+ Monto vendido: 1000.00
Tests  1 failed | 1 passed | 40 skipped (42)
```

U1, U5 y C1 fallan: una venta `reembolso_pendiente` deja de sumar monto y comisión cuando el spec exige que sólo `reembolsada` reste (ADR 301 pto 1).

**Restauración**: `sha256sum` idéntico al original (`e0ba0253…`); `git diff -- src` vacío; los tres targeted en verde de nuevo.

---

## M2 — también resta `reembolso_rechazado`

**Archivo:línea**: `src/core/ventas/reporte.ts:187`.

**Código mutado** (literal `"reembolso_rechazado"`, sin agregar import — el módulo no importa esa constante):

```diff
-    if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA) {
+    if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA || c.ventaEstado === "reembolso_rechazado") {
```

**Comando**: `npx vitest run src/core/ventas/reporte.test.ts -t "U1"` (más `-t "F1"` y `src/core/agents/consultas-negocio-tool.test.ts -t "C1"`).

**Salida roja (extracto, U1)**:

```
FAIL … estado reembolso_rechazado: sólo `reembolsada` resta monto y comisión (U1)
AssertionError: expected { vendedorId: 'vend-1', …(7) } to match object { montoVendido: 1000, …(4) }
- "montoVendido": 1000,
- "totalComisionado": 100,
+ "montoVendido": 0,
+ "totalComisionado": 0,
Tests  1 failed | 3 passed | 31 skipped (35)
```

**Salida roja (extracto, F1 — sólo `reembolso_rechazado`, TOTAL debía ser bruto)**:

```
FAIL … sólo reembolso_rechazado: el TOTAL es la suma bruta, ninguno resta (F1)
AssertionError: expected '...' to contain 'TOTAL                                 1000.00            100.00'
+ TOTAL                                    0.00              0.00
Tests  1 failed | 1 passed | 33 skipped (35)
```

**Salida roja (extracto, C1)**:

```
FAIL … reporte_comisiones: reembolso_pendiente y reembolso_rechazado NO restan del agregado (ADR 301, C1)
AssertionError: expected '...' to contain 'Monto vendido: 16000.00'
- Monto vendido: 16000.00
+ Monto vendido: 15000.00
Tests  1 failed | 1 passed | 40 skipped (42)
```

U1, F1 y C1 fallan: un `reembolso_rechazado` (venta que en los hechos sigue confirmada, el reembolso fue denegado) no debe restar — el ADR 301 pto 1 sólo excluye `reembolsada`.

**Restauración**: `sha256sum` idéntico al original; `git diff -- src` vacío; los tres targeted en verde de nuevo.

---

## M3 — ordena por comisión bruta, no neta

**Archivo:línea**: `src/core/ventas/reporte.ts:212` (el `.sort(...)` de `agruparReporteMensual`).

**Código mutado**:

```diff
-    .sort((a, b) => b.totalComisionado - a.totalComisionado || a.vendedorId.localeCompare(b.vendedorId));
+    .sort(
+      (a, b) =>
+        b.totalComisionado + b.comisionRevertida - (a.totalComisionado + a.comisionRevertida) ||
+        a.vendedorId.localeCompare(b.vendedorId),
+    );
```

**Comando**: `npx vitest run src/core/ventas/reporte.test.ts -t "U5|U6"`

**Salida roja (extracto)**:

```
FAIL … regresión con datos reales: el orden y los netos por vendedor (U5)
AssertionError: expected [ 'hito36', 'v39', …(4) ] to deeply equal [ 'hito36', 'v39', …(4) ]

FAIL … ordena por comisión neta, no bruta (U6)
AssertionError: expected [ 'vend-a', 'vend-b' ] to deeply equal [ 'vend-b', 'vend-a' ]
- Expected: ["vend-b", "vend-a"]
+ Received: ["vend-a", "vend-b"]   (A con 400 revertido "gana" por su comisión bruta, aunque su neto sea menor)

Tests  2 failed | 33 skipped (35)
```

U5 y U6 fallan: el orden vuelve a favorecer al vendedor con más comisión **bruta** (confirmada + revertida), en vez del neto — exactamente el caso que motivó el diseño (ADR 301 pto 3: "el orden usa la comisión neta").

**Restauración**: `sha256sum` idéntico al original; `git diff -- src` vacío; U5/U6 en verde de nuevo.

---

## M4 — la fila TOTAL vuelve a imprimir el monto vacío

**Archivo:línea**: `src/core/ventas/reporte.ts:300` (`filaTotal`, dentro de `formatearTablaComparativa`).

**Código mutado** (revierte la celda de monto del TOTAL a vacía, como antes del ADR 301 pto 3):

```diff
   const filaTotal = [
     "TOTAL".padEnd(NOMBRE_WIDTH),
     "".padStart(VENTAS_WIDTH),
-    formatMoney(totalMontoVendido).padStart(MONTO_WIDTH),
+    "".padStart(MONTO_WIDTH),
     formatMoney(totalComisionado).padStart(COMISION_WIDTH),
   ].join(" ");
```

**Comando**: `npx vitest run src/core/ventas/reporte.test.ts -t "neto\)"` (golden de la tarea 2.1)

**Salida roja (extracto)**:

```
FAIL … devuelve el string completo y determinista para un periodo con comisiones y reembolsos pendientes (neto)
AssertionError: expected '...' to be '...'
- TOTAL                                 1000.00            100.00
+ TOTAL                                                    100.00
Tests  1 failed | 34 skipped (35)
```

El golden (tarea 2.1) atrapa la mutación: la celda de monto del TOTAL queda vacía en vez de mostrar el neto.

**Hallazgo no pedido por la tarea, documentado igual**: **F2** (leyenda + anchos ≤ 77) siguió en **verde** con esta mutación (`1 passed | 34 skipped`). F2 verifica la presencia de la leyenda y el largo de cada línea, no el contenido numérico de la celda de monto — es un oráculo distinto del golden. La detección real de "TOTAL sin monto" la hace el golden de 2.1, no F2. Queda registrado por si el Reviewer quiere reforzar F2 con una aserción sobre el valor de la celda de monto en un change futuro.

**Restauración**: `sha256sum` idéntico al original; `git diff -- src` vacío; golden y F2 en verde de nuevo.

---

## M5 — `aprobarReembolso` también actualiza `comisiones`

**Archivo:línea**: `src/adapters/memory/repository.ts:1131` (`aprobarReembolso`).

**Código mutado** (agrega un `UPDATE comisiones` tras el CAS de `ventas`, violando el spec *"la comisión ya pagada permanece"* / *"el reporte descuenta sin tocar la tabla"*):

```diff
   const row = db
     .prepare(
       `UPDATE ventas
           SET estado = 'reembolsada'
         WHERE id = @ventaId
           AND estado = 'confirmada'
        RETURNING ${VENTA_SELECT_COLUMNS}`,
     )
     .get(input) as VentaSqlRow | undefined;
+  if (row) {
+    db.prepare(`UPDATE comisiones SET monto = 0 WHERE venta_id = @ventaId`).run(input);
+  }
   return row ? rowToVenta(row) : undefined;
```

**Comando**: `npx vitest run src/build-on-comando-empleado.test.ts -t "C2"`

**Salida roja (extracto)**:

```
FAIL … un reembolso aprobado resta del reporte neto sin tocar la tabla comisiones (ADR 301, C2)
AssertionError: expected +0 to be 100 // Object.is equality
- Expected: 100
+ Received: 0
Tests  1 failed | 113 skipped (114)
```

C2 falla: `SELECT monto FROM comisiones WHERE id = 'comision-venta-c2-1'` cambia de 100 a 0 tras `aprobarReembolso`, violando el invariante de que la tabla `comisiones` nunca se toca (ADR 301 pto 4, R5 de `hito-1.3-ventas-comisiones` sigue vigente en la tabla).

**Restauración**: `sha256sum` idéntico al original (`8590e451…`); `git diff -- src` vacío; C2 en verde de nuevo.

---

## Cierre

- Las cinco mutaciones (M1-M5) fueron atrapadas por sus tests nombrados (`tasks.md` 5.1); ninguna otra prueba de `reporte.test.ts`/`consultas-negocio-tool.test.ts`/`build-on-comando-empleado.test.ts` se vio afectada durante la mutación (los `it.each`/tests no filtrados quedaron `skipped`, no rojos).
- Tras restaurar la última mutación: `git diff -- src` vacío, `npm run typecheck` verde.
- `npm test` completo (con `dist/` limpio antes de correr, por la duplicación de conteo conocida): **162 archivos, 2 skipped; 3323 tests, 5 skipped** — todo verde. `npm run build` verde.

## Enlaces

- Tareas: [`../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/tasks.md`](../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/tasks.md)
- Diseño (ADR 301, §3, §4): [`../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/design.md`](../../../openspec/changes/reembolso-resta-monto-vendido-en-reporte/design.md)
- Evidencia manual (5.2, en preparación): [`README.md`](README.md)
