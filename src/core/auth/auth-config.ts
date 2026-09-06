/**
 * Configuración de AUTENTICACIÓN (`tui-canal-empleado`, ADR 31). Molde
 * EXACTO de `ventas-config.ts` (verificado línea por línea): no importa
 * `env.js`, no tiene default `= process.env`, no lanza, acumula todos los
 * errores.
 */
export interface AuthConfig {
  /** Minutos. `0` = SIN expiración — mismo interruptor que `VENTA_TOKEN_TTL_HORAS=0`. Default 30. */
  readonly sesionTtlMinutos: number;
}

export const DEFAULT_SESION_TTL_MINUTOS = 30;

export type ResolveAuthConfigResult =
  | { readonly ok: true; readonly config: AuthConfig }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * | Env var | Campo | Default | Validación | Inválido |
 * |---|---|---|---|---|
 * | `SESION_TTL_MINUTOS` | `sesionTtlMinutos` | `30` | entero finito, `>= 0` | **ABORTA** |
 *
 * Ausente o vacía → default. Presente pero inválida → error con el nombre
 * de la variable y el valor recibido. Clase "aborta" (ADR 17 de Hito 4): un
 * TTL de sesión mal escrito que caiga en silencio a 30 min es una sesión
 * que dura otra cosa que la que el operador cree.
 */
export function resolveAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
): ResolveAuthConfigResult {
  const raw = env.SESION_TTL_MINUTOS;

  if (raw === undefined || raw.trim() === "") {
    return { ok: true, config: { sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS } };
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return { ok: true, config: { sesionTtlMinutos: parsed } };
  }

  return {
    ok: false,
    errores: [`SESION_TTL_MINUTOS inválido: "${raw}" (debe ser un entero finito >= 0)`],
  };
}
