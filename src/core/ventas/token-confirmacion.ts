/**
 * Validación del token de confirmación y cálculo de su vencimiento
 * (Hito 4, tarea 5, §3.3). Dos funciones puras, sin dependencias — `ahora`
 * SIEMPRE llega inyectado por parámetro, nunca `Date.now()` adentro (spec
 * `venta-confirmacion`, mismo criterio que el resto de las funciones puras
 * de este hito).
 */

import { VENTA_ESTADO_PENDIENTE_CONFIRMACION, type Venta } from "./ventas-contract.js";

export const MOTIVO_TOKEN_INEXISTENTE = "inexistente";
export const MOTIVO_TOKEN_ESTADO_INVALIDO = "estado_invalido";
export const MOTIVO_TOKEN_VENCIDO = "vencido";
export type MotivoTokenInvalido =
  | typeof MOTIVO_TOKEN_INEXISTENTE
  | typeof MOTIVO_TOKEN_ESTADO_INVALIDO
  | typeof MOTIVO_TOKEN_VENCIDO;

export type ValidacionToken =
  | { readonly valido: true; readonly venta: Venta }
  | { readonly valido: false; readonly motivo: MotivoTokenInvalido };

/**
 * Las tres guardas del ADR 10 de la propuesta, en una función pura con
 * `ahora` INYECTADO — nunca `Date.now()` adentro (spec `venta-confirmacion`).
 *
 *  1. `venta === undefined`            → `inexistente`
 *  2. `venta.estado !== 'pendiente_confirmacion'` → `estado_invalido`
 *     (cubre reuso, doble click y venta ya rechazada — ADR 15)
 *  3. `expiresAt !== undefined && expiresAt <= ahora` → `vencido`
 *     Comparación LEXICOGRÁFICA de strings, correcta solo porque ambos son
 *     ISO-8601 UTC de ancho fijo (ADR 16, regla 3). `undefined` = sin
 *     vencimiento, y pasa.
 *
 * El `motivo` existe para el LOG, no para la respuesta: el spec exige que un
 * token vencido y uno inexistente produzcan una respuesta INDISTINGUIBLE
 * (R6). El handler HTTP descarta el motivo al renderizar y lo conserva al
 * loguear (§4.4, §9.2).
 *
 * La guarda 2 se REPITE dentro del `UPDATE` (ADR 15). No es redundancia
 * ociosa: acá decide la respuesta, allá garantiza la atomicidad. Se les pasa
 * el mismo `ahora`, así que no pueden discrepar.
 */
export function validarTokenConfirmacion(venta: Venta | undefined, ahora: string): ValidacionToken {
  if (venta === undefined) {
    return { valido: false, motivo: MOTIVO_TOKEN_INEXISTENTE };
  }

  if (venta.estado !== VENTA_ESTADO_PENDIENTE_CONFIRMACION) {
    return { valido: false, motivo: MOTIVO_TOKEN_ESTADO_INVALIDO };
  }

  if (venta.expiresAt !== undefined && venta.expiresAt <= ahora) {
    return { valido: false, motivo: MOTIVO_TOKEN_VENCIDO };
  }

  return { valido: true, venta };
}

/**
 * `createdAt + ttlHoras` como ISO-8601 UTC, o `undefined` si `ttlHoras === 0`
 * (sin vencimiento — el interruptor de configuración del ADR 10 de la
 * propuesta, que evita tener que migrar para desactivar la guarda).
 *
 * Mismo algoritmo que `calcularExpiraEn` (`../auth/sesion.ts`), con
 * duplicación INTENCIONAL: `sesion.ts` tiene el invariante testeado de no
 * tener ninguna declaración `import`, así que no puede consumir un helper
 * compartido. Ver la nota en `calcularExpiraEn` para el detalle.
 */
export function calcularExpiresAt(createdAt: string, ttlHoras: number): string | undefined {
  if (ttlHoras === 0) {
    return undefined;
  }

  return new Date(Date.parse(createdAt) + ttlHoras * 3_600_000).toISOString();
}
