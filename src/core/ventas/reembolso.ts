/**
 * Evaluación determinista de una solicitud de devolución (Hito 4, tarea 4,
 * §3.3). Función pura, sin dependencias, sin invocar al modelo — spec
 * `reembolso-evaluacion`, Requirement "Evaluación determinista del
 * reembolso, sin invocar al modelo".
 */

export const RESULTADO_REEMBOLSO_AUTO_APROBADO = "auto_aprobado";
export const RESULTADO_REEMBOLSO_ESCALADO = "escalado";
export type ResultadoReembolso =
  | typeof RESULTADO_REEMBOLSO_AUTO_APROBADO
  | typeof RESULTADO_REEMBOLSO_ESCALADO;

/**
 * La regla completa del spec `reembolso-evaluacion`, en una comparación:
 *
 *   monto  <  umbral  → auto_aprobado   (venta → 'reembolsada')
 *   monto >=  umbral  → escalado        (venta → 'reembolso_pendiente')
 *
 * El BORDE ESTÁ EN EL `>=`, no en el `>`: el spec dice "estrictamente menor"
 * para auto-aprobar y "mayor o igual" para escalar, así que `monto ===
 * umbral` ESCALA. Test dedicado para esa celda exacta — es el único lugar
 * del hito donde un `<=` en vez de un `<` cambia una decisión de plata.
 *
 * `monto` es SIEMPRE `venta.monto` completo: el reembolso es todo-o-nada
 * (spec, fuera de alcance del parcial).
 */
export function evaluarReembolso(monto: number, umbral: number): ResultadoReembolso {
  return monto < umbral ? RESULTADO_REEMBOLSO_AUTO_APROBADO : RESULTADO_REEMBOLSO_ESCALADO;
}
