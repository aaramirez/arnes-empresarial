/**
 * Agregación y formato del reporte mensual de comisiones (Hito 4, tarea 9,
 * §3.5, ADR 9 de la propuesta). Dos funciones puras — sin base de datos, sin
 * red, sin reloj — cubren spec `reporte-comisiones-mensual`, requerimientos
 * "Agregación pura por vendedor y periodo" y "Listado de reembolsos
 * pendientes de aprobación". El único import es `./ventas-contract.js`
 * (vocabulario de estados) y `./comision.js` (reuso del redondeo, ADR 16) —
 * mismo criterio de `AGENTS.md` que el resto de `src/core/`.
 *
 * NOTA DE DISEÑO (a revisar por el Reviewer): `design.md` §3.5 fija las
 * firmas, los campos y las reglas de negocio de `agruparReporteMensual` y
 * `formatearReporteMensual` literalmente, pero NO fija el formato de texto
 * carácter a carácter ("Reporte a texto plano de ancho fijo" es la única
 * instrucción). El layout de columnas (anchos, separadores, orden de
 * secciones) de abajo es una decisión de esta tarea, no del diseño. Detalle:
 *  - Tabla comparativa: 5 columnas visibles (nombre, ventas confirmadas,
 *    monto vendido, total comisionado, ventas con reembolso) — `vendedorId`
 *    NO se imprime, solo se usa como clave interna y como criterio de
 *    desempate del orden (coincide con "las 5 columnas de FilaVendedor" de
 *    §3.5, que tiene 6 campos pero uno es la clave, no una columna visible).
 *  - Anchos fijos elegidos: nombre 24, ventas 6, monto 13, comisión 17,
 *    reembolso 13 (cada uno ajustado al texto del encabezado más largo).
 *  - El listado de reembolsos pendientes NO se reordena: se imprime en el
 *    mismo orden en que `agruparReporteMensual` lo recibió ("pasa TAL CUAL").
 */
import {
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
} from "./ventas-contract.js";
import { calcularComision } from "./comision.js";

/** Fila de comisión ya cruzada con su venta, tal como la lectura SQL la entrega (§6.2). */
export interface ComisionConVenta {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly comisionMonto: number;
  readonly ventaMonto: number;
  /** Estado ACTUAL de la venta — hace visible R5 (comisión viva sobre una venta reembolsada) en vez de esconderla. */
  readonly ventaEstado: string;
  readonly periodo: string;
}

export interface VentaPendienteReembolso {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  readonly monto: number;
  readonly casoId: string;
  readonly confirmedAt?: string;
}

export interface FilaVendedor {
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly ventasConfirmadas: number;
  readonly montoVendido: number;
  readonly totalComisionado: number;
  /** Cuántas de esas ventas están hoy `reembolsada` o `reembolso_pendiente` — la columna que hace medible R5. */
  readonly ventasConReembolso: number;
}

export interface ReporteMensual {
  readonly periodo: string;
  readonly filas: readonly FilaVendedor[];
  readonly totalComisionado: number;
  readonly reembolsosPendientes: readonly VentaPendienteReembolso[];
}

/**
 * Redondea a 2 decimales con la MISMA regla que `calcularComision` (ADR 16):
 * `calcularComision(x, 1) === Math.round(x * 1 * 100) / 100 === Math.round(x
 * * 100) / 100`. Reuso literal de la función ya testeada en vez de reimplementar
 * `Math.round(... * 100) / 100` acá (instrucción explícita de la tarea: "no
 * reinventes").
 */
function redondearComoComision(monto: number): number {
  return calcularComision(monto, 1);
}

/**
 * Agrupa por `vendedor_id` dentro de un `periodo`. PURA (spec
 * `reporte-comisiones-mensual`, "testeable sin base de datos ni red").
 *
 * Reglas (§3.5):
 *  - Solo entran comisiones cuyo `periodo` coincide con el pedido.
 *  - `totalComisionado` (por fila y total general) se redondea a 2 decimales
 *    con el mismo criterio de `calcularComision` (ADR 16).
 *  - Orden: `totalComisionado` DESC, desempate por `vendedorId` ASC —
 *    determinista, para que el string completo sea afirmable en un test.
 *  - `reembolsosPendientes` pasa TAL CUAL, sin filtrar por `periodo`: el spec
 *    lo pide explícitamente.
 */
export function agruparReporteMensual(input: {
  readonly periodo: string;
  readonly comisiones: readonly ComisionConVenta[];
  readonly reembolsosPendientes: readonly VentaPendienteReembolso[];
}): ReporteMensual {
  const { periodo, comisiones, reembolsosPendientes } = input;

  const filtradas = comisiones.filter((c) => c.periodo === periodo);

  interface Acumulador {
    vendedorNombre: string;
    ventasConfirmadas: number;
    montoVendido: number;
    totalComisionado: number;
    ventasConReembolso: number;
  }

  const porVendedor = new Map<string, Acumulador>();

  for (const c of filtradas) {
    const acc: Acumulador = porVendedor.get(c.vendedorId) ?? {
      vendedorNombre: c.vendedorNombre,
      ventasConfirmadas: 0,
      montoVendido: 0,
      totalComisionado: 0,
      ventasConReembolso: 0,
    };

    acc.ventasConfirmadas += 1;
    acc.montoVendido += c.ventaMonto;
    acc.totalComisionado += c.comisionMonto;
    if (c.ventaEstado === VENTA_ESTADO_REEMBOLSADA || c.ventaEstado === VENTA_ESTADO_REEMBOLSO_PENDIENTE) {
      acc.ventasConReembolso += 1;
    }

    porVendedor.set(c.vendedorId, acc);
  }

  const filas: FilaVendedor[] = [...porVendedor.entries()]
    .map(([vendedorId, acc]) => ({
      vendedorId,
      vendedorNombre: acc.vendedorNombre,
      ventasConfirmadas: acc.ventasConfirmadas,
      montoVendido: redondearComoComision(acc.montoVendido),
      totalComisionado: redondearComoComision(acc.totalComisionado),
      ventasConReembolso: acc.ventasConReembolso,
    }))
    .sort((a, b) => b.totalComisionado - a.totalComisionado || a.vendedorId.localeCompare(b.vendedorId));

  const totalComisionado = redondearComoComision(filas.reduce((sum, f) => sum + f.totalComisionado, 0));

  return { periodo, filas, totalComisionado, reembolsosPendientes };
}

/* ── formatearReporteMensual: layout de tabla, ver nota de diseño arriba ── */

const NOMBRE_WIDTH = 24;
const VENTAS_WIDTH = 6;
const MONTO_WIDTH = 13;
const COMISION_WIDTH = 17;
const REEMBOLSO_WIDTH = 13;
const SEPARADOR_WIDTH = NOMBRE_WIDTH + 1 + VENTAS_WIDTH + 1 + MONTO_WIDTH + 1 + COMISION_WIDTH + 1 + REEMBOLSO_WIDTH;

const NOTA_ESCALACION_FUERA_DE_BANDA =
  "Nota: este hito no ofrece ninguna vía de producto (endpoint, pantalla o notificación) para aprobar o rechazar estas escalaciones. La resolución es fuera de banda (SQL manual) hasta que el Hito 5 implemente el cierre (ADR 11 punto 5).";

function formatMoney(monto: number): string {
  return monto.toFixed(2);
}

function filaTabla(nombre: string, ventas: string, monto: string, comision: string, reembolso: string): string {
  return [
    nombre.padEnd(NOMBRE_WIDTH),
    ventas.padStart(VENTAS_WIDTH),
    monto.padStart(MONTO_WIDTH),
    comision.padStart(COMISION_WIDTH),
    reembolso.padStart(REEMBOLSO_WIDTH),
  ].join(" ");
}

function formatearTablaComparativa(filas: readonly FilaVendedor[], totalComisionado: number): string {
  if (filas.length === 0) {
    // Spec + §3.5: nunca una tabla vacía sin explicación.
    return "sin comisiones en el periodo";
  }

  const encabezado = filaTabla("Vendedor", "Ventas", "Monto vendido", "Total comisionado", "Con reembolso");
  const separador = "-".repeat(SEPARADOR_WIDTH);
  const lineas = filas.map((f) =>
    filaTabla(
      f.vendedorNombre,
      String(f.ventasConfirmadas),
      formatMoney(f.montoVendido),
      formatMoney(f.totalComisionado),
      String(f.ventasConReembolso),
    ),
  );
  const filaTotal = [
    "TOTAL".padEnd(NOMBRE_WIDTH),
    "".padStart(VENTAS_WIDTH),
    "".padStart(MONTO_WIDTH),
    formatMoney(totalComisionado).padStart(COMISION_WIDTH),
  ].join(" ");

  return [encabezado, separador, ...lineas, separador, filaTotal].join("\n");
}

function formatearLineaReembolso(v: VentaPendienteReembolso): string {
  const base = `- venta ${v.ventaId} | vendedor ${v.vendedorNombre} | cliente ${v.clienteId} | monto ${formatMoney(
    v.monto,
  )} | caso ${v.casoId}`;
  return v.confirmedAt === undefined ? base : `${base} | confirmada ${v.confirmedAt}`;
}

function formatearSeccionReembolsos(reembolsosPendientes: readonly VentaPendienteReembolso[]): string {
  const cuerpo =
    reembolsosPendientes.length === 0
      ? "(sin reembolsos pendientes)"
      : reembolsosPendientes.map(formatearLineaReembolso).join("\n");

  return ["Reembolsos pendientes de aprobación", "", NOTA_ESCALACION_FUERA_DE_BANDA, "", cuerpo].join("\n");
}

/**
 * Reporte a texto plano de ancho fijo. PURA — `string` adentro, `string`
 * afuera; quien lo imprime es `src/reporte-mensual.ts` (§6.6).
 *
 * Tres bloques, en este orden (§3.5):
 *  1. Encabezado con el `periodo`.
 *  2. Tabla comparativa por vendedor, o "sin comisiones en el periodo" si
 *     `filas` está vacío.
 *  3. Reembolsos pendientes de aprobación — con la nota literal de que este
 *     hito no expone camino de producto para cerrarlos (ADR 11 punto 5, R3):
 *     el reporte SOLO lista, no ofrece ninguna acción de aprobación/rechazo.
 *     Esta sección aparece SIEMPRE, incluso sin comisiones en el periodo,
 *     porque `reembolsosPendientes` no depende del `periodo` (§3.5).
 */
export function formatearReporteMensual(reporte: ReporteMensual): string {
  return [
    `Reporte de comisiones - periodo ${reporte.periodo}`,
    formatearTablaComparativa(reporte.filas, reporte.totalComisionado),
    formatearSeccionReembolsos(reporte.reembolsosPendientes),
  ].join("\n\n");
}
