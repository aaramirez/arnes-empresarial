# Diseño técnico: `reembolso-resta-monto-vendido-en-reporte` — el reporte de comisiones es neto de reembolsos aplicados

**Change**: `reembolso-resta-monto-vendido-en-reporte` · **Propuesta**: `proposal.md` (B1 = (ii) decidido por el humano el 2026-09-24; B2-B8 recomendados) · **Specs delta** (ya escritos, este diseño se alinea con ellos): `specs/reporte-comisiones-mensual`, `specs/consultas-negocio-a2a`, `specs/reembolso-evaluacion`, `specs/herramienta-operaciones-negocio`.

**Numeración (B8)**: este diseño **abre ADR 301 y RD-173**. Techo reverificado con `Grep` sobre todo el repo (sin `node_modules`) **en esta fase**: el ADR más alto mergeado es **299** y la RD más alta **RD-171** (`operaciones-negocio-tui`). `ADR 3xx`/`RD-17[2-9]` sólo aparecen en `enmascarar-password-en-tui` (reserva **ADR 300 / RD-172**, su `design.md:5,252`) y en la propuesta de este change. Ningún otro change sin mergear (`respaldo-y-durabilidad-sqlite`, `salud-operativa`, etc.) usa el rango 300+. **Coordinación**: si este change mergea **antes** que el hermano, igual conserva 301 (el 300 queda reservado, no se "compacta"); si el checkpoint descarta al hermano, el 300 queda como hueco documentado, no se renumera.

> **Nota de proceso**: este ejecutor no tiene shell, así que no pudo correr `graphify query` pese al hook. Todo `archivo:línea` de abajo se verificó con `Read`/`Grep` en esta fase sobre `main` (`2195a17`).

**Dependencia de checkpoint**: las decisiones marcadas **[CP]** son las *recomendadas* de la propuesta (B2-B7). Este diseño se apoya en ellas (RD-173); si el checkpoint elige otra, cambia la sección indicada.

---

## 0. Hallazgos de esta fase

| # | Hallazgo | Consecuencia de diseño |
|---|---|---|
| **H1** | Los cuatro consumidores llaman a `agruparReporteMensual` y ninguno recalcula importes: TUI `build-on-comando-empleado.ts:1369-1374`, conversacional `ejecutar-operacion.ts:790-794`, CLI `reporte-mensual.ts:99-100`, A2A `consultas-negocio-tool.ts:312`. El A2A **sí suma** `f.montoVendido` por fila (`:276`) pero sobre el valor que ya entrega la función; `totalComisionado` lo toma tal cual (`:284`) | Un único punto de cambio (`src/core/ventas/reporte.ts`). Ningún consumidor se toca |
| **H2** | `listComisionesPorPeriodo` (`repository.ts:1241-1262`) ya trae `v.estado AS venta_estado` (estado **actual**), `v.monto AS venta_monto` y `c.monto AS comision_monto`. Nada más en `src/` lee `comisiones.monto` para reportar (los otros `FROM comisiones` son escrituras, KPI por conteo o tests) | Sin SQL, sin migración, sin tocar el adapter |
| **H3** | El redondeo existente es `Math.round(x * 100) / 100` aplicado **una sola vez** sobre el acumulado de sumas no negativas (`reporte.ts:117-119,177-178,183`), y hay un test que lo fija (`reporte.test.ts:126-139`, `0.1 + 0.2 → 0.3`) | El neto se calcula **sumando sólo lo no reembolsado**, no restando (§3.1). Mantiene la misma y única ruta aritmética ya testeada |
| **H4** | La fila TOTAL omite a propósito la última columna para no dejar espacios de cola (`reporte.ts:243-248`, 4 elementos, no `filaTabla`) | El TOTAL nuevo sigue con 4 elementos: sólo se llena la celda de monto |
| **H5** | Tests que fijan salida con `reembolsada`: **sólo** el golden `reporte.test.ts:221-238`. `consultas-negocio-tool.test.ts:187-220` usa `confirmada` + `reembolso_pendiente` (sigue en `150.00`). `ejecutar-operacion.test.ts:1223` y `build-on-comando-empleado.test.ts:772,1559-1560,1582` usan `toContain` del encabezado. `build-on-comando-empleado.test.ts:1623-1673` compara TUI contra las mismas funciones puras (se mantiene verde). Las demás menciones de `reembolsada` en tests (~59, en 12 archivos) son de transiciones de estado, no del reporte | Un solo test existente cambia a propósito (§6.2) |
| **H6** | El golden del periodo vacío (`reporte.test.ts:241-264`) fija el texto completo sin tabla | La leyenda se imprime **sólo** cuando hay filas; así ese golden no cambia (coincide con el spec: "no hay fila TOTAL ni leyenda") |
| **H7** | "R5" es un rótulo **colisionado**: en el arc42, "Riesgo 7 (R5)" es la evicción de `Map`s (`ARC42:784`); el R5 de este change es el de `hito-1.3-ventas-comisiones` (`proposal.md:34,194,232`, `design.md:1944,2082`). El arc42 **no** menciona la comisión viva | El ADR 301 lo cita siempre con prefijo, *R5 (hito-1.3-ventas-comisiones)*, como pide la Deuda 11 del arc42 |
| **H8** | Reembolso parcial no existe: `reembolso-evaluacion` (`hito-1.3.../spec.md:65`) fija todo-o-nada y el esquema no tiene monto reembolsado | Por venta, "reembolsada" resta el `ventaMonto` completo; no hay caso intermedio que diseñar |

---

## 1. Enfoque técnico

Cambio puro en `src/core/ventas/reporte.ts` (núcleo, sin imports nuevos):

1. `agruparReporteMensual` acumula, por vendedor y en una sola pasada, cuatro sumas **independientes**: neto (ventas ≠ `reembolsada`) y revertido (ventas `reembolsada`), para monto y comisión. Los conteos no cambian.
2. `FilaVendedor` expone `montoReembolsado` y `comisionRevertida` (no se imprimen, B7). `montoVendido`/`totalComisionado` conservan el nombre y pasan a significar **neto**.
3. `ReporteMensual` suma `totalMontoVendido` (neto).
4. `formatearReporteMensual` llena la celda de monto del TOTAL e imprime una leyenda de dos líneas bajo la tabla.

Sin cambios: repositorio, migraciones, `build-on-comando-empleado.ts`, `ejecutar-operacion.ts`, `reporte-mensual.ts`, `consultas-negocio-tool.ts`, TUI, web.

---

## 2. ADR 301 — El reporte mensual de comisiones es neto de reembolsos aplicados

> Redactado para copiarse tal cual al arc42 (sección *Decisiones de Diseño*) cuando el Reviewer cierre. **No se edita el arc42 en esta fase.**

**Reemplaza a**: *R5 (hito-1.3-ventas-comisiones)* — *"un reembolso deja viva la comisión ya pagada"* (`hito-1.3-ventas-comisiones/proposal.md:34,194,232`, `design.md:1944,2082`) — **sólo en lo que respecta al reporte mensual**. En la tabla `comisiones`, R5 **sigue vigente**: el reembolso no la toca (spec `reembolso-evaluacion`, SHALL NOT de `:65`, intacto).

**Contexto.** Hito 1.3 difirió la reversión de la comisión hasta *"decidir el modelo contable"* y, mientras tanto, hizo la inconsistencia **visible** en el reporte (`ventaEstado`, columna "Con reembolso"). El reporte sumaba monto y comisión de toda venta del periodo, reembolsada o no. El usuario pidió que un reembolso aplicado reste el monto vendido; el humano decidió el 2026-09-24 (B1 = (ii)) que reste **monto y comisión**.

**Decisión.**

1. En el reporte mensual (`agruparReporteMensual`), "Monto vendido" y "Total comisionado" son **netos**: suman sólo las ventas cuyo estado actual ≠ `reembolsada`. `reembolso_pendiente` y `reembolso_rechazado` **no restan**.
2. "Ventas" y "Con reembolso" conservan el conteo **bruto** (`reembolsada` + `reembolso_pendiente`, sin `reembolso_rechazado`) **[CP B3]**. Una leyenda bajo la tabla lo explica.
3. La fila TOTAL imprime monto neto y comisión neta **[CP B2]**. El orden usa la comisión **neta**.
4. El cálculo es **derivado al leer**. La tabla `comisiones` conserva la comisión **originalmente generada** y **no es un libro de lo efectivamente pagado**. Ningún consumidor debe leer `comisiones.monto` como "lo que se le debe/pagó al vendedor".
5. Un reembolso aprobado tarde cambia el reporte del mes de `confirmed_at` de la venta, aunque ese mes ya se haya "cerrado" **[CP B4]**. No existe `refunded_at`.

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **(ii) Neto de monto y comisión, derivado al leer** | Diverge de la tabla `comisiones` (R1); cero migración | ★ **Elegida por el humano** |
| (i) Sólo restar el monto | La comisión deja de ser el % del neto; fila con 0.00 vendido y comisión > 0 | Rechazada por el humano |
| (iii) Columnas bruto / reembolsado / neto | Ancho 77 → ~91, cambian todos los golden; más de lo pedido | Rechazada por el humano |
| Clawback persistido (fila de ajuste negativo o anulación en `comisiones`) | Libro contable real, pero exige migración y decidir el modelo contable | Fuera de alcance, **deuda B6** |

**Consecuencias.**

- TUI, conversacional, CLI y A2A pasan a mostrar netos con las mismas etiquetas, sin cambiar su código.
- Los reportes ya exportados (salidas del CLI, respuestas A2A) no se recalculan: un reembolso posterior hace que el mismo periodo dé otro número.
- **Deuda declarada**: B6 (clawback real / libro de comisiones pagadas) y B4 (`refunded_at`). Se anotan como Deuda nueva del arc42 al copiar el ADR.
- **Reversible**: `git revert`, sin migración ni datos.

---

## 3. `agruparReporteMensual` (`reporte.ts:134-186`)

### 3.1 Decisiones

| Tema | Opción | Tradeoff | Veredicto |
|---|---|---|---|
| **Aritmética del neto** | **Sumar sólo lo no reembolsado** en un acumulador neto, y lo reembolsado en otro | Cada acumulador sólo recibe sumandos ≥ 0 y se redondea **una vez**, igual que hoy (H3). Una fila 100 % reembolsada vale `0` **exacto** por construcción (nunca recibió sumandos) | ★ **Elegida** |
| | Bruto − reembolsado | Resta de flotantes: `0.3 - 0.1 = 0.19999999999999998` (sin redondeo final, `toBe(0.2)` falla), y una diferencia que debería ser 0 puede dar `-2e-13` → redondea a **`-0`**: `formatMoney(-0)` imprime `"0.00"`, pero `expect(x).toBe(0)` **falla** (vitest usa `Object.is`). Agrega un modo de error que hoy no existe | Rechazada |
| **Nombres de campos netos** | **Conservar `montoVendido`/`totalComisionado`** y redefinir su semántica (doc-comment) | El A2A lee `f.montoVendido` y `reporte.totalComisionado` y hereda el neto sin cambio (spec `consultas-negocio-a2a`) | ★ **Elegida** |
| | Renombrar a `montoVendidoNeto`/`comisionNeta` | Más explícito, pero obliga a tocar `consultas-negocio-tool.ts` y rompe la regla "ningún consumidor se toca" | Rechazada |
| **Total de monto** | **`ReporteMensual.totalMontoVendido`**, `redondear(Σ filas.montoVendido)` (mismo molde que `totalComisionado`, `:183`) | Un campo más; el A2A sigue sumando por su cuenta (`:276`) y da el mismo texto (`toFixed(2)` sobre sumas de valores ya redondeados) | ★ **Elegida**. Migrar el A2A a `totalMontoVendido` queda como mejora opcional fuera de alcance |
| **Totales de lo revertido** en `ReporteMensual` | No agregarlos | B7 sólo pide los campos por fila; YAGNI | ★ Sin totales revertidos |

**Invariante (documentado, no forzado)**: por fila, `montoVendido + montoReembolsado` = bruto con error ≤ 0.01 (cada término se redondea por separado). No se testea igualdad exacta contra el bruto.

### 3.2 Contrato

```ts
export interface FilaVendedor {
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  /** Conteo BRUTO: todas las comisiones del periodo del vendedor (ADR 301 pto 2). */
  readonly ventasConfirmadas: number;
  /** NETO de reembolsos aplicados: Σ ventaMonto de ventas con estado ≠ `reembolsada` (ADR 301). */
  readonly montoVendido: number;
  /** NETO: Σ comisionMonto de ventas con estado ≠ `reembolsada`. Criterio de orden (ADR 301 pto 3). */
  readonly totalComisionado: number;
  /** Conteo BRUTO: `reembolsada` + `reembolso_pendiente` (sin `reembolso_rechazado`, ADR 23 tui-canal-empleado). */
  readonly ventasConReembolso: number;
  /** Σ ventaMonto de ventas `reembolsada`. NO se imprime (B7). */
  readonly montoReembolsado: number;
  /** Σ comisionMonto de ventas `reembolsada`. NO se imprime (B7). La tabla `comisiones` no cambia. */
  readonly comisionRevertida: number;
}

export interface ReporteMensual {
  readonly periodo: string;
  readonly filas: readonly FilaVendedor[];
  /** NETO: redondear(Σ filas.totalComisionado). */
  readonly totalComisionado: number;
  /** NETO: redondear(Σ filas.montoVendido). Nuevo (ADR 301 pto 3). */
  readonly totalMontoVendido: number;
  readonly reembolsosPendientes: readonly VentaPendienteReembolso[];
}
```

### 3.3 Algoritmo (una pasada)

```ts
interface Acumulador {
  vendedorNombre: string;
  ventasConfirmadas: number;
  montoVendido: number;       // neto
  totalComisionado: number;   // neto
  ventasConReembolso: number;
  montoReembolsado: number;
  comisionRevertida: number;
}
// por cada c del periodo:
acc.ventasConfirmadas += 1;
if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA) {
  acc.montoReembolsado += c.ventaMonto;
  acc.comisionRevertida += c.comisionMonto;
} else {
  acc.montoVendido += c.ventaMonto;
  acc.totalComisionado += c.comisionMonto;
}
if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA || c.ventaEstado === VENTA_ESTADO_REEMBOLSO_PENDIENTE) {
  acc.ventasConReembolso += 1;               // sin cambios (:165-167)
}
```

- Al mapear a `FilaVendedor`, los **cuatro** importes pasan por `redondearComoComision` (ADR 16).
- Orden **sin cambios de código** (`:181`): `b.totalComisionado - a.totalComisionado || a.vendedorId.localeCompare(b.vendedorId)`, ahora sobre el neto redondeado.
- `totalComisionado` y `totalMontoVendido`: `redondearComoComision(filas.reduce(...))`.
- Fila en 0.00 / 0.00: no hay divisiones ni filtros; la fila existe porque tiene comisiones en el periodo y se imprime.
- Comentarios a actualizar en el mismo commit: `:39` (`ventaEstado` ya no "hace visible R5": decide qué resta), `:60` y el doc de `:121-133` (reglas nuevas, cita ADR 301).

---

## 4. `formatearReporteMensual` (`reporte.ts:226-251`)

### 4.1 Fila TOTAL **[CP B2]**

```ts
const filaTotal = [
  "TOTAL".padEnd(NOMBRE_WIDTH),
  "".padStart(VENTAS_WIDTH),
  formatMoney(totalMontoVendido).padStart(MONTO_WIDTH),
  formatMoney(totalComisionado).padStart(COMISION_WIDTH),
].join(" ");
```

`formatearTablaComparativa` pasa a recibir el `ReporteMensual` (o `totalMontoVendido` como 3er parámetro; es privada, sin impacto externo). Anchos **sin cambios**: `MONTO_WIDTH = 13` alcanza hasta `9999999999.99`; los datos reales (31200.00) usan 8. Ventas totales en el TOTAL: se deja vacía (no pedido).

### 4.2 Leyenda **[CP B3]**

Dos constantes nuevas, cada línea ≤ 77 (`SEPARADOR_WIDTH`) para no romper el ancho:

```ts
const LEYENDA_NETO: readonly string[] = [
  "Nota: monto y comisión netos de reembolsos aplicados (estado reembolsada).", // 74
  "\"Con reembolso\" cuenta también los pendientes, que todavía no restan.",      // 69
];
```

Se imprime **dentro** de `formatearTablaComparativa`, después del TOTAL y de una línea en blanco: `[encabezado, sep, ...lineas, sep, filaTotal, "", ...LEYENDA_NETO]`. **Sólo con filas**: el periodo vacío sigue devolviendo `"sin comisiones en el periodo"` (H6). No contiene ninguna frase prohibida por el test `reporte.test.ts:279-301` (`SQL manual`, `irreversible`, `configuración`, `auditoría`).

---

## 5. Consumidores y conflicto de specs

| Consumidor | Cómo llega el neto | ¿Cambia código? | ¿Ve la leyenda? |
|---|---|---|---|
| TUI `/reporte-comisiones` (`build-on-comando-empleado.ts:1369-1374`) | `formatearReporteMensual` literal (ADR 124) | No | Sí |
| Conversacional `consultar_reporte_comisiones` (`ejecutar-operacion.ts:790-794`) | Idem | No | Sí |
| CLI `npm run reporte:mensual` (`reporte-mensual.ts:99-100`) | Idem; igualdad byte a byte con la TUI se mantiene | No | Sí |
| A2A `reporte_comisiones` (`consultas-negocio-tool.ts:270-287,312`) | `Σ f.montoVendido` + `reporte.totalComisionado`; etiquetas `Monto vendido:`, `Total comisionado:`, `Ventas confirmadas:` (bruto), `Ventas con reembolso:` (bruto) | No | **No** [CP B5] |

**Fork B5 (leyenda en el A2A)**:

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **No imprimirla** | El agente remoto recibe "Monto vendido" neto sin aclaración; el spec delta lo fija como neto (contrato explícito). El formato del agregado lo fijó el ADR 186 | ★ **Recomendada** (spec `consultas-negocio-a2a` ya la excluye: *"ni leyenda de la tabla"*) |
| Agregar una línea `Importes netos de reembolsos aplicados.` | Autoexplicativo para el consumidor, pero toca `consultas-negocio-tool.ts` y el formato del ADR 186 | Alternativa si el checkpoint la pide; +1 línea de código y +1 test |

**Conflicto `herramienta-operaciones-negocio/spec.md:81,86`**: el texto dice *"**Este change** SHALL NOT modificar... `agruparReporteMensual`"* y su scenario mide *"el `git diff` completo del change"*. Es una restricción **de alcance de `operaciones-negocio-conversacionales`**, no un invariante de la capability; el comportamiento permanente es el de `:58` (delegar **exclusivamente** en las funciones puras, sin recalcular), que este change **refuerza**. Como `openspec/specs/` está vacío y al archivar ese texto quedaría como prohibición permanente, el delta `specs/herramienta-operaciones-negocio` lo acota con un MODIFIED (ya escrito). Este diseño lo avala; el checkpoint lo confirma.

**`tui-canal-empleado/.../reporte-comisiones-mensual/spec.md:17-19`** (rechazado no cuenta): compatible. El rechazo no cuenta en "Con reembolso" y **tampoco resta** (en un rechazo no se devolvió plata); lo fija el test U1.

---

## 6. Estrategia de tests (TDD estricto, `vitest`, `npm test`)

Cada test se escribe **en rojo antes** que el código que lo pone en verde.

### 6.1 Nuevos — `src/core/ventas/reporte.test.ts`

| # | Caso | Assert |
|---|---|---|
| U1 | Un vendedor por estado (`confirmada`, `reembolsada`, `reembolso_pendiente`, `reembolso_rechazado`), cada uno 1000 / 100 | 1000/100, **0/0**, 1000/100, 1000/100; "Con reembolso" 0,1,1,0; `montoReembolsado`/`comisionRevertida` = 1000/100 sólo en `reembolsada`, 0 en los demás |
| U2 | Mezcla en un vendedor: 1 `confirmada` + 1 `reembolsada` + 1 `reembolso_pendiente` | neto = confirmada + pendiente; `ventasConfirmadas` 3, `ventasConReembolso` 2 |
| U3 | Todo reembolsado: 2 `reembolsada` | fila presente, `montoVendido` y `totalComisionado` `toBe(0)` (sin `-0`), conteos 2/2 |
| U4 | Flotantes: `confirmada` 0.1 y 0.2 + `reembolsada` 0.3 | `totalComisionado` `toBe(0.3)`, `comisionRevertida` `toBe(0.3)` |
| U5 | **Regresión con datos reales** (ids `hito36`, `v39`, `rick`, `beto`, `tom`, `ana`; comisión 10 %; los montos individuales de Ana/Beto se reparten a gusto con las mismas sumas: Ana 1200 confirmada + 3 `reembolsada` que suman 2500; Beto 3000 confirmada + 2 `reembolsada` que suman 700; Hito36 15000 `reembolso_pendiente`) | orden `["hito36","v39","rick","beto","tom","ana"]`; Ana 1200/120 (4/3), Beto 3000/300 (3/2), Hito36 15000/1500 (1/1); `totalMontoVendido` 31200, `totalComisionado` 3120 |
| U6 | Orden por neto: A bruto 500 con 400 reembolsado vs B 200 confirmada | B antes que A (el bruto habría ordenado al revés) |
| U7 | `totalMontoVendido` en periodo vacío | `toBe(0)` (extiende `:172-181`) |
| F1 | `formatearReporteMensual`: sólo `reembolso_pendiente` o sólo `reembolso_rechazado` | TOTAL = suma bruta |
| F2 | Leyenda | presente con filas, cada línea de la tabla y de la leyenda ≤ 77 caracteres; ausente en periodo vacío (el golden `:241-264` queda como está) |

### 6.2 Existente que cambia a propósito — golden `reporte.test.ts:221-238`

Mismo fixture (Juan `confirmada` 1000/100, Ana Gomez `reembolsada` 1500/225). Líneas nuevas (el orden se invierte: Ana queda en 0.00):

```
"Vendedor                 Ventas Monto vendido Total comisionado Con reembolso",
"-----------------------------------------------------------------------------",
"Juan Perez                    1       1000.00            100.00             0",
"Ana Gomez                     1          0.00              0.00             1",
"-----------------------------------------------------------------------------",
"TOTAL                                 1000.00            100.00",
"",
"Nota: monto y comisión netos de reembolsos aplicados (estado reembolsada).",
"\"Con reembolso\" cuenta también los pendientes, que todavía no restan.",
```

(El literal es referencia; lo definitivo es el `padStart` de §4. El nombre del test se actualiza para decir "neto".) Ningún otro test existente se edita (H5).

### 6.3 Consumidores

| # | Dónde | Caso |
|---|---|---|
| C1 | `src/core/agents/consultas-negocio-tool.test.ts` (`describe` de `:186`) | Scenarios del spec `consultas-negocio-a2a`: confirmada 1000/100 + reembolsada 1500/225 → `Monto vendido: 1000.00`, `Total comisionado: 100.00`, `Ventas confirmadas: 2`, `Ventas con reembolso: 1`, `Vendedores con ventas: 2`; pendiente 15000 + rechazado 1000 → `16000.00` / `1600.00`; sin la leyenda |
| C2 | `src/build-on-comando-empleado.test.ts` (junto a `:1623`) | Con SQLite `:memory:`: `seedComisionConfirmada` + `aprobarReembolso(db, …)` (camino real a `reembolsada`) + otra venta confirmada; `/reporte-comisiones` contiene el TOTAL neto y la leyenda, y **la fila de `comisiones` sigue con su monto original** (`SELECT monto FROM comisiones`), cubre el scenario *"La tabla `comisiones` no se altera"* por SQL real |

No se agrega test en `ejecutar-operacion.test.ts`: usa dobles y delega en la misma función (H1); C2 cubre el camino SQL.

### 6.4 Evidencia manual (`docs/progreso/v3.XX-reembolso-resta-monto-vendido-en-reporte/`)

`/reporte-comisiones <periodo real>` en la TUI real sobre la base de trabajo: capturar la tabla y verificar U5 contra los datos (incluido el desempate **real** Beto/Tom por `vendedorId`, que la propuesta no verificó contra la base) y que `npm run reporte:mensual` da el mismo texto.

---

## 7. Archivos

| Archivo | Acción | Detalle | Líneas est. |
|---|---|---|---|
| `src/core/ventas/reporte.ts` | Modificar | §3 y §4; comentarios `:39,60,121-133` | +35-50 |
| `src/core/ventas/reporte.test.ts` | Modificar | U1-U7, F1-F2; golden `:221-238` | +110-150 |
| `src/core/agents/consultas-negocio-tool.test.ts` | Modificar (agregar) | C1 | +40-55 |
| `src/build-on-comando-empleado.test.ts` | Modificar (agregar) | C2 | +35-45 |
| `docs/ARC42_Harness_Empresarial.md` | Modificar | ADR 301 (§2) + Deuda B6/B4 | +25-35 |
| `README.md` | Modificar | Una línea junto a `:198`/`:246`: el reporte es neto de reembolsos aplicados (ADR 301) | +2-4 |
| `openspec/changes/hito-1.3-ventas-comisiones/design.md` | Modificar | Nota de reemplazo junto a `:2082` (no se reescribe): *"Superseded en el reporte por ADR 301 (`reembolso-resta-monto-vendido-en-reporte`); la tabla `comisiones` sigue intacta"* | +1-2 |
| `docs/progreso/v3.XX-…/` | Crear | §6.4 | +20-30 |
| `repository.ts`, migraciones, `build-on-comando-empleado.ts`, `ejecutar-operacion.ts`, `reporte-mensual.ts`, `consultas-negocio-tool.ts`, TUI, web | **Sin cambio** | Si aparecen en el diff, el change se salió del alcance | 0 |

**Total ≈ 270-380 líneas** (≈ 60-90 sin tests). Más que la propuesta (110-180) porque la propuesta no contaba C2 ni la evidencia; sigue **< 400**: **un solo PR**. `400-line budget risk: Low-Medium` (el techo toca 380 si los tests salen verbosos; `it.each` en U1 lo contiene). El comentario de `repository.ts:1232-1234` ("hace visible R5") queda levemente desactualizado: **no** se toca para respetar el guardarraíl; se registra en el ADR.

---

## 8. Riesgos y residuales

| # | Riesgo | Prob. | Mitigación / estado |
|---|---|---|---|
| R1 ★ | Reporte ≠ tabla `comisiones` / lo liquidado (Ana: 120.00 vs 370.00) | Cierta | ADR 301 pto 4 + leyenda. Clawback real: **deuda B6**, fuera de alcance |
| R2 | Restar `reembolso_pendiente` o `reembolso_rechazado` por error | Media → Baja | U1 (un vendedor por estado), F1, C1 |
| R2b | Reorden y fila en 0.00 que desaparece | Cierta / Baja | U3, U5, U6, golden §6.2 |
| R3 | Un reembolso tardío cambia el reporte de un mes cerrado (B4, sin `refunded_at`) | Cierta | ADR 301 pto 5; deuda B4 |
| R4 | Reportes ya exportados (CLI, A2A) dejan de coincidir con un recálculo posterior | Cierta | Consecuencia declarada en el ADR 301; el reporte nunca fue un documento persistido (spec: "formato de salida como archivo persistido" fuera de alcance) |
| R5' | Deriva flotante (`1200.0000000000002`, `-0`) | Baja | §3.1: sólo sumas ≥ 0 y un redondeo; U3 con `toBe(0)`, U4 |
| R6 | Choque de numeración con `enmascarar-password-en-tui` | Media | 301/173 reservados aquí, 300/172 allá; sin renumerar al mergear en cualquier orden |
| R7 | El spec de `herramienta-operaciones-negocio:81` archivado como prohibición permanente | Baja | Delta MODIFIED ya escrito; `sdd-archive` debe aplicarlo |
| R8 | Un consumidor futuro lee `comisiones.monto` como "comisión pagada" | Baja | ADR 301 pto 4 lo prohíbe explícitamente; `comisionRevertida` queda disponible |

---

## 9. Despliegue, documentación y rollback

**Sin migración**, sin variables de entorno, sin dependencias npm. El efecto es inmediato y retroactivo sobre toda venta que **ya** esté `reembolsada`.

Documentación a actualizar **en el apply**, no ahora: comentarios de `reporte.ts` (§3.3), ADR 301 + deudas B4/B6 en el arc42, línea del README, nota de reemplazo en `hito-1.3-ventas-comisiones/design.md:2082`. La evidencia histórica (`docs/progreso/v3.2-*`, `v3.8-*`) **no** se reescribe. Las guías sin commitear (`docs/Guia-*.md`, `docs/progreso/guia-*.md`) no describen los importes: no requieren cambio.

**Rollback**: `git revert` de los commits del change. Sin datos que restaurar: el reporte vuelve a mostrar el bruto sobre la misma base. El ADR 301 queda marcado *revertido* y R5 (hito-1.3) vuelve a regir en el reporte.

---

## 10. Secuencia sugerida, decisiones asumidas y preguntas abiertas

| # | Unidad | Commit | Autónoma |
|---|---|---|---|
| 1 | U1-U7 en rojo → acumuladores netos, campos B7, `totalMontoVendido`, comentarios | `feat(core)` | Sí. Ojo: el golden `:221-238` ya se rompe en esta unidad (Ana pasa a 0.00 y cambia el orden), así que sus filas, su orden y la comisión del TOTAL (325.00 → 100.00) se ajustan acá; el monto del TOTAL y la leyenda, en la unidad 2 |
| 2 | F1-F2 + golden §6.2 en rojo → TOTAL con monto y leyenda | `feat(core)` | Sí |
| 3 | C1 y C2 (deberían nacer verdes: documentan la herencia; si alguno nace verde se deja constancia en apply-progress, no se fuerza un rojo artificial) | `test(core)` / `test(root)` | Sí |
| 4 | ADR 301, deudas, README, nota en hito-1.3 | `docs(arc42)` | Sí |
| 5 | Evidencia manual | `docs(root)` | — |

**RD-173**: se asumen los defaults recomendados de la propuesta: B2 (TOTAL suma ambos netos), B3 (conteos brutos + leyenda), B4 (aceptar y documentar), B5 (deltas + leyenda sólo en la tabla), B6 (deuda en el ADR), B7 (campos sin imprimir). Si el checkpoint elige separar aplicados/pendientes (B3 alternativa), cambian §3.2, §4 y el ancho (vuelve el costo de (iii)). Si pide la leyenda en el A2A (B5), se suma el cambio de §5 y un assert en C1.

**Preguntas abiertas**:

- [ ] **Checkpoint**: ratificar ADR 301 / RD-173, número de hito (`v3.20` reservado por respaldo, `v3.21` propuesto por el hermano → este sería `v3.22` o el que toque) y orden de merge.
- [ ] **Checkpoint**: confirmar el MODIFIED de `herramienta-operaciones-negocio` (§5).
- [ ] **Checkpoint**: ¿leyenda también en el A2A? Recomendado: no.
- [ ] **Apply/evidencia**: verificar contra la base real que el desempate Beto/Tom por `vendedorId` da Beto primero y que cada comisión reembolsada es exactamente el 10 % (la propuesta lo dejó pendiente).

---

## 11. Enmienda post-5.2: la nota de escalaciones apunta a la resolución conversacional (ADR 302)

> Fue pedida por el humano después de la tarea 5.2 (ver `proposal.md`, sección *Enmienda*). §1-§10 no se reescriben. Anclajes verificados con `Read`/`Grep` sobre la rama (`9b56836`). Sin shell, así que tampoco hubo `graphify query`.

### 11.1 Hallazgos

| # | Hallazgo | Consecuencia |
|---|---|---|
| **H9** | La nota (`reporte.ts:241-242`) nombra tres comandos dados de baja en v3.10.0 (ADR 210 pto 1, tarea 14). `aprobacion-conversacional-hitl` no tiene delta ni tarea sobre la nota | Se viola el ADR 26 (`tui-canal-empleado/proposal.md:198-210`), que pide que la nota sea verdadera el día del merge |
| **H10** | La resolución conversacional existe en **dos** canales: el texto libre autenticado de la TUI (`operacionesTui`, ADR 297-299, `main.ts:577-589`) y el chat web (`POST /operaciones`, `server.test.ts:653`). Los dos usan el mismo `onOperacionesEmpleado`, cada uno con su propio store de confirmación | La nota nombra los dos canales. `Guia-Demostracion-Pasantia.md:436` (*"solo en el chat web"*) está desactualizada, pero no está versionada: residual |
| **H11** | Consumidores de la nota: los tres que llaman a `formatearReporteMensual` (`build-on-comando-empleado.ts:1374`, `reporte-mensual.ts:100`, `ejecutar-operacion.ts:794`). El A2A **no**: `reporte_comisiones` no imprime la sección (`consultas-negocio-tool.ts:267-268`) y `reembolsos_pendientes` arma su propio texto sin nota (`:385-389`) | Un único punto de cambio. Ningún consumidor se toca |
| **H12** | Tests que fijan la nota: sólo `reporte.test.ts` (la línea de la nota en el golden `:485` y en el golden vacío `:557`, y el test `:577-600`). `rg "escalaciones se resuelven" src` no encuentra otros. `build-on-comando-empleado.test.ts:1623` (TUI = funciones puras) y C2 no fijan la nota literal | Tres puntos de test editados a propósito. El resto queda verde sin tocarlo |
| **H13** | Las prohibiciones del test `:593-599` vienen del ADR 26 rev. 2 y rev. 3. El motivo escrito para *"roles o permisos"* era *"que no existen"*, y quedó viejo: `autorizacion-empleado` los introdujo (`resolver_reembolso` exige rol elevado y prohíbe la autoaprobación, ADR 211) | Se conserva la prohibición y se cambia el motivo (§11.3, A2) |
| **H14** | El doc de `formatearReporteMensual` (`reporte.ts:331-335`) todavía dice *"este hito no expone camino de producto para cerrarlos"* | Se corrige en el REFACTOR. La parte *"el reporte SOLO lista"* sigue siendo cierta |

### 11.2 Texto nuevo (una sola línea de prosa)

```ts
const NOTA_ESCALACION_FUERA_DE_BANDA =
  "Nota: estas escalaciones se resuelven por conversación con el asistente, en el texto libre de la TUI local de empleados (tras /login) o en el chat web (tras iniciar sesión): se pide aprobar, rechazar o reabrir el reembolso y se confirma en un turno aparte. La contraseña se verifica localmente contra la misma base de datos que este proceso escribe.";
```

- **Es prosa, no está atada al ancho de 77**, igual que hoy: F2 sólo mide las líneas de la tabla y de la leyenda. El ADR 26 nunca fijó un ancho para la nota.
- Conserva *"TUI local"*, *"/login"* y la segunda oración (R16) **al pie de la letra**. El único token `/` es `/login`, que está vigente en `COMANDOS`.
- **No fija una frase para el LLM**: *"se pide aprobar, rechazar o reabrir"* describe la intención y no un comando. El nombre interno `resolver_reembolso` no aparece, porque es vocabulario del sistema y no del empleado.
- No contiene ninguna frase prohibida (`SQL manual`, `irreversible`, `configuración`, `auditoría`/`registro_acciones_empleado`, `\brol(es)?\b`, `permisos?`). Se verificó a mano contra las regex de `:595-599`.
- En `consultar_reporte_comisiones`, el LLM lee *"por conversación con el asistente"* y puede ofrecer la resolución. Es verdad: tiene `resolver_reembolso`, con su gate de rol.

### 11.3 Decisiones

| # | Tema | Opciones y tradeoffs | Veredicto |
|---|---|---|---|
| **A1** | Dónde se registra | **ADR 302 nuevo** que enmienda el ADR 26 de `tui-canal-empleado`: una decisión por ADR y revertible por separado. La alternativa, un apéndice al ADR 301, mezcla contabilidad (neto) con un texto de canal que no tiene nada que ver y ensucia el rollback | ★ **ADR 302 + RD-174** |
| **A2** | Prohibición de *"rol/permisos"* | **Conservarla**. La nota no duplica la política de autorización, que vive en `ejecutar-operacion.ts` y puede cambiar, y el agente ya explica el rechazo (*no_autorizado*, autoaprobación). La alternativa es levantarla y agregar *"requiere rol administrador"*: más informativo, pero contradice el test `:599`, F2 (`reporte.test.ts:532`) y el ADR 26 rev. 3, y vuelve a atar el texto a una política móvil | ★ Conservar y actualizar el **motivo** en el doc-comment (H13) |
| **A3** | Guarda anti-deriva | **Test**: todo token `/comando` del reporte existe en `COMANDOS` (`comando-empleado.ts:360`). Es un import test-only de `core/ventas` a `core/commands`, sin dependencia de producción. La alternativa, sólo `not.toContain` de los tres comandos, no detecta la próxima baja | ★ Guarda contra `COMANDOS` |
| **A4** | Nombre de la constante | `FUERA_DE_BANDA` ya es impreciso, pero el spec base y el delta lo nombran. Renombrarlo sólo agrega churn | Se mantiene |

**ADR 302 (para el arc42, Fase 7)**. *Enmienda al ADR 26 (`tui-canal-empleado`)*. La nota de escalaciones del reporte apunta a la resolución conversacional (ADR 206, ADR 210 pto 1) en los dos canales, texto libre de la TUI (ADR 297-299) y chat web, y no nombra comandos retirados. Se conservan la salvedad R16 y las prohibiciones del ADR 26 rev. 2 y 3, esta última con el motivo nuevo de A2. **Regla**: todo change que baje un comando o cambie un canal de resolución revisa `NOTA_ESCALACION_FUERA_DE_BANDA` en el mismo change. La guarda A3 automatiza la mitad de esa regla (los comandos). Los canales siguen dependiendo de la revisión humana. **RD-174**: registra las decisiones A1-A3 del checkpoint de la enmienda.

**Numeración**. Techo reverificado con `Grep` sobre todo el repo (sin `node_modules`): `ADR[ -]?(30[2-9]|3[1-9]\d|[4-9]\d\d)` → **0 coincidencias**. `RD-(17[4-9]|1[89]\d|[2-9]\d\d)` → **0**. Los changes sin mergear (`respaldo-y-durabilidad-sqlite`, `operabilidad-produccion`, etc.) reservan números menores que 300: ADR 246-262, RD-120-135. El 300/RD-172 es de `enmascarar-password-en-tui` y el 301/RD-173 de este change.

### 11.4 Impacto en tests

| Test | Cambio |
|---|---|
| `reporte.test.ts:577-600` | **Se edita a propósito**. Cambia de nombre. Los tres `toContain("/aprobar-reembolso"…)` pasan a `not.toMatch(/\/(aprobar\|rechazar\|reabrir)-reembolso/)`. Se agregan anclas positivas: `"por conversación"`, `"TUI local"`, `"/login"`, `"chat web"`, `"aprobar, rechazar o reabrir"`, `"turno aparte"` y `"misma base de datos"`. Las **cinco** prohibiciones quedan intactas |
| Golden `:485` y golden vacío `:557` | Cambia sólo la línea de la nota |
| Nuevo (A3) | Guarda contra `COMANDOS` sobre dos reportes, con pendientes y vacío |
| `build-on-comando-empleado.test.ts:1623`, C2, `ejecutar-operacion.test.ts:1223` | Verdes sin editar (H12) |

**Mutación M6** (5b.4): volver a poner `/aprobar-reembolso` en la nota ⇒ fallan 5b.1 y la guarda A3. **M7**: quitar *"chat web"* ⇒ falla 5b.1.

### 11.5 Riesgos y archivos

| # | Riesgo | Mitigación |
|---|---|---|
| R9 | La nota vuelve a envejecer por un cambio de canal | Regla del ADR 302 y guarda A3 (sólo cubre comandos) |
| R10 | El LLM parafrasea la nota de otra forma | La nota no fija una frase. La resolución real está gateada por `ejecutar-operacion` |
| R11 | El merge por nombre del requirement falla en `sdd-archive` si alguien lo renombra | El delta conserva el nombre exacto. La nota para el archive está en el spec |

Archivos agregados a §7: `reporte.ts` (+12/−10), `reporte.test.ts` (+30/−12), `tui-canal-empleado/proposal.md` (+1-2, nota de reemplazo junto a `:210`), `docs/progreso/v3.21-…/README.md` y `mutaciones.md` (+15-25), arc42 en la Fase 7 (+12-18). **Sin cambio**: `comando-empleado.ts`, los tres consumidores y los adapters.
