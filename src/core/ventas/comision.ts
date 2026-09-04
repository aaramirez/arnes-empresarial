/**
 * Aritmética del dinero y del período de una comisión (Hito 4, tarea 3,
 * ADR 16). Dos funciones puras, sin dependencias, testeadas con casos
 * borde de punto flotante y de zona horaria.
 */

/**
 * `monto × porcentaje`, redondeado a 2 decimales (ADR 16, regla 1).
 *
 * `Math.round((monto * porcentaje) * 100) / 100`, NO `toFixed` (devuelve
 * string y arrastra la representación del literal) ni `Intl` (formato, no
 * aritmética). `Math.round` sobre el producto escalado es la forma con el
 * error acotado y el comportamiento más fácil de fijar con casos borde en
 * un test (`0.005` sube).
 *
 * PRECONDICIONES, garantizadas por quien llama y no re-chequeadas acá:
 * `monto > 0` (lo valida el parseo del payload, §4.5) y `porcentaje ∈ (0, 1]`
 * (lo valida `resolveVentasConfig`, §3.2). Esta función no defiende contra
 * `NaN`: si llegara uno, la configuración inválida ya habría abortado el
 * arranque — que es exactamente lo que el spec pide en vez de un `NaN`
 * silencioso en una fila de comisiones.
 */
export function calcularComision(monto: number, porcentaje: number): number {
  return Math.round(monto * porcentaje * 100) / 100;
}

/**
 * `'YYYY-MM'` a partir de un ISO-8601 UTC — `confirmedAt.slice(0, 7)`.
 *
 * Deliberadamente un `slice` y no `new Date(...).getMonth()`: `getMonth`
 * aplica la zona horaria de la máquina, así que una venta confirmada a las
 * 22:00 del 31 de enero caería en enero o en febrero según dónde corra el
 * proceso. Todos los timestamps de este repo son `new Date().toISOString()`
 * (UTC, ancho fijo), invariante que ADR 16 documenta y que esta función
 * asume.
 *
 * Se llama con `confirmed_at`, NUNCA con `created_at` (spec + ADR 16).
 */
export function periodoDeConfirmacion(confirmedAt: string): string {
  return confirmedAt.slice(0, 7);
}
