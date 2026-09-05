import "../../core/config/env.js";

/**
 * El side-effect import de arriba carga `.env` vía el punto único del repo
 * (`src/core/config/env.ts`), mismo criterio que
 * `src/adapters/board/config.ts` y `src/adapters/webhooks/config.ts` ya
 * siguen hoy.
 */
export interface NotificacionesConfig {
  /** `""` = adaptador DESHABILITADO → no-op que loguea el link (spec `venta-confirmacion`). */
  readonly apiKey: string;
  readonly from: string;
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
}

/** Resend. Un segundo proveedor cambia esta URL Y la forma del cuerpo — ver ADR 18, punto 3. */
export const DEFAULT_EMAIL_API_URL = "https://api.resend.com/emails";
export const DEFAULT_EMAIL_TIMEOUT_MS = 10_000;
export const DEFAULT_EMAIL_FROM = "arnes@localhost";

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws — this adapter's configuration is best-effort by
 * design, same criterion as `src/adapters/board/config.ts`.
 */
function resolvePositiveNumber(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveBoardConfig`, para que los tests pasen un objeto literal en
 * vez de mutar el env global.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `EMAIL_API_KEY` | `apiKey` | `""` (deshabilitado) |
 * | `EMAIL_FROM` | `from` | `DEFAULT_EMAIL_FROM` |
 * | `EMAIL_API_URL` | `apiUrl` | `DEFAULT_EMAIL_API_URL` |
 * | `EMAIL_TIMEOUT_MS` | `requestTimeoutMs` | `DEFAULT_EMAIL_TIMEOUT_MS` |
 *
 * Pura, nunca lanza, numéricos inválidos al default — mismas reglas que
 * `resolveBoardConfig`.
 */
export function resolveNotificacionesConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificacionesConfig {
  return {
    apiKey: env.EMAIL_API_KEY ?? "",
    from: env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    apiUrl: env.EMAIL_API_URL ?? DEFAULT_EMAIL_API_URL,
    requestTimeoutMs: resolvePositiveNumber(env.EMAIL_TIMEOUT_MS, DEFAULT_EMAIL_TIMEOUT_MS),
  };
}

/** `config.apiKey.trim() !== ""`. Único gate. */
export function isNotificacionesEnabled(config: NotificacionesConfig): boolean {
  return config.apiKey.trim() !== "";
}
