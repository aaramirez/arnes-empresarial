/**
 * Configuración de AUTENTICACIÓN (`tui-canal-empleado`, ADR 31). Mismo
 * criterio que `ventas-config.ts`: no importa `env.js`, no tiene default
 * `= process.env`, no lanza, acumula todos los errores — y reusa de ahí
 * `resolveNumeroValidado`, el helper genérico de validación numérica
 * (fix de review, hallazgo de duplicación).
 */
import { resolveNumeroValidado } from "../ventas/ventas-config.js";

export interface AuthConfig {
  /** Minutos. `0` = SIN expiración — mismo interruptor que `VENTA_TOKEN_TTL_HORAS=0`. Default 30. */
  readonly sesionTtlMinutos: number;
}

export const DEFAULT_SESION_TTL_MINUTOS = 30;

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
 * | `SESION_TTL_MINUTOS` | `sesionTtlMinutos` | `30` | entero finito, `>= 0`, `<= MAX_SESION_TTL_MINUTOS` | **ABORTA** |
 *
 * Ausente o vacía → default. Presente pero inválida → error con el nombre
 * de la variable y el valor recibido. Clase "aborta" (ADR 17 de Hito 4): un
 * TTL de sesión mal escrito que caiga en silencio a 30 min es una sesión
 * que dura otra cosa que la que el operador cree — y un TTL desmesurado
 * (fuera del rango válido de `Date`) es peor: tumba `/login` en tiempo de
 * request en vez de fallar acá, en el arranque.
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

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  return { ok: true, config: { sesionTtlMinutos } };
}
