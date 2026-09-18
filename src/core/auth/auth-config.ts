/**
 * Configuración de AUTENTICACIÓN (`tui-canal-empleado`, ADR 31). Mismo
 * criterio que `ventas-config.ts`: no importa `env.js`, no tiene default
 * `= process.env`, no lanza, acumula todos los errores — y reusa de ahí
 * `resolveNumeroValidado`, el helper genérico de validación numérica
 * (fix de review, hallazgo de duplicación).
 */
import { resolveNumeroValidado } from "../ventas/ventas-config.js";

export interface AuthConfig {
  /**
   * Minutos. Tope ABSOLUTO desde el login, NO se renueva nunca (ADR 31 punto 2,
   * significado INTACTO). `0` = SIN expiración — mismo interruptor que
   * `VENTA_TOKEN_TTL_HORAS=0`. Default 480 (8 h, ADR 231 pto 6).
   */
  readonly sesionTtlMinutos: number;
  /**
   * ★ NUEVO (ADR 231). Minutos. Vencimiento por INACTIVIDAD, se RENUEVA con
   * cada uso (ver `renovarSesion` en `sesion.ts`). `0` = SIN expiración por
   * inactividad, independiente de `sesionTtlMinutos`. Default 30 — la sesión
   * ociosa muere exactamente cuando muere hoy (R8 sin empeorar).
   */
  readonly sesionInactividadMinutos: number;
}

/** ★ ADR 231 pto 6: pasa de 30 a 480 — significado INTACTO, sólo cambia el default (tope absoluto). */
export const DEFAULT_SESION_TTL_MINUTOS = 480;

/** ★ NUEVO (ADR 231 pto 6): la sesión ociosa muere exactamente cuando muere hoy (R8 sin empeorar). */
export const DEFAULT_SESION_INACTIVIDAD_MINUTOS = 30;

/**
 * Tope superior de `SESION_TTL_MINUTOS` (fix de review, hallazgo fuera de
 * tarea numerada: `calcularExpiraEn`, en `sesion.ts`, no tenía techo). Sin
 * este tope, `ttlMinutos * 60_000` puede exceder el rango válido de `Date`
 * (~±8.64e15 ms desde epoch) y `new Date(...).toISOString()` lanza un
 * `RangeError` sin capturar dentro de la cadena de `/login`, tumbando el
 * request. 10 años en minutos (365 días/año) × 60_000 ms ≈ 3.15e14 ms, un
 * factor ~27x (no ~4 órdenes de magnitud) por debajo de ese límite — margen
 * real y muy por encima de cualquier TTL de sesión legítimo.
 */
export const MAX_SESION_TTL_MINUTOS = 5_256_000;

export type ResolveAuthConfigResult =
  | { readonly ok: true; readonly config: AuthConfig }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * | Env var | Campo | Default | Validación | Inválido |
 * |---|---|---|---|---|
 * | `SESION_TTL_MINUTOS` | `sesionTtlMinutos` | `480` | entero finito, `>= 0`, `<= MAX_SESION_TTL_MINUTOS` | **ABORTA** |
 * | `SESION_INACTIVIDAD_MINUTOS` | `sesionInactividadMinutos` | `30` | entero finito, `>= 0`, `<= MAX_SESION_TTL_MINUTOS` | **ABORTA** |
 *
 * Ausente o vacía → default. Presente pero inválida → error con el nombre
 * de la variable y el valor recibido, ACUMULADO junto con el de la otra
 * variable si las dos son inválidas a la vez. Clase "aborta" (ADR 17 de
 * Hito 4): un TTL de sesión mal escrito que caiga en silencio a su default
 * es una sesión que dura otra cosa que la que el operador cree — y un TTL
 * desmesurado (fuera del rango válido de `Date`) es peor: tumba `/login` en
 * tiempo de request en vez de fallar acá, en el arranque. Las dos variables
 * son independientes: `0` en una no afecta el significado de la otra (ADR
 * 231 pto 6).
 */
export function resolveAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
): ResolveAuthConfigResult {
  const errores: string[] = [];

  const sesionTtlMinutos = resolveNumeroValidado(
    "SESION_TTL_MINUTOS",
    env.SESION_TTL_MINUTOS,
    DEFAULT_SESION_TTL_MINUTOS,
    (parsed) => Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SESION_TTL_MINUTOS,
    `un entero finito entre 0 y ${MAX_SESION_TTL_MINUTOS}`,
    errores,
  );

  const sesionInactividadMinutos = resolveNumeroValidado(
    "SESION_INACTIVIDAD_MINUTOS",
    env.SESION_INACTIVIDAD_MINUTOS,
    DEFAULT_SESION_INACTIVIDAD_MINUTOS,
    (parsed) => Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SESION_TTL_MINUTOS,
    `un entero finito entre 0 y ${MAX_SESION_TTL_MINUTOS}`,
    errores,
  );

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  return { ok: true, config: { sesionTtlMinutos, sesionInactividadMinutos } };
}
