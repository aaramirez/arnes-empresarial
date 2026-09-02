import "../../core/config/env.js";

/**
 * El side-effect import de arriba carga `.env` vía el punto único del repo
 * (`src/core/config/env.ts`), igual que `src/adapters/knowledge/config.ts`
 * ya hace hoy (verificado). Así este módulo es correcto sin depender de que
 * `main.ts` se acuerde de importar `env.js` primero.
 */
export interface WebhookConfig {
  /** `""` (o solo espacios) = adaptador DESHABILITADO: no se abre ningún puerto (ADR 5, punto 5). */
  readonly secret: string;
  readonly port: number;
  readonly path: string;
  readonly maxBodyBytes: number;
}

export const DEFAULT_WEBHOOK_PORT = 8787;
export const DEFAULT_WEBHOOK_PATH = "/webhooks/github";
/** 1 MiB. Ver ADR 9. */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;
/** Techo del drenaje de turnos en vuelo al cerrar. Constante, NO env var (es un presupuesto de UX, no un hecho del entorno). Ver ADR 10. */
export const SERVER_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws — this adapter's configuration is best-effort by
 * design, same criterion as `src/adapters/knowledge/config.ts`.
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

/** Ensures `path` starts with a leading `/`, without introducing a double slash. */
function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveGraphifyConfig`, para que los tests pasen un objeto literal en
 * vez de mutar el env global.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `GITHUB_WEBHOOK_SECRET` | `secret` | `""` (deshabilitado) |
 * | `WEBHOOK_PORT` | `port` | `DEFAULT_WEBHOOK_PORT` |
 * | `WEBHOOK_PATH` | `path` | `DEFAULT_WEBHOOK_PATH` |
 * | `WEBHOOK_MAX_BODY_BYTES` | `maxBodyBytes` | `DEFAULT_MAX_BODY_BYTES` |
 *
 * Un numérico ausente, vacío, no numérico o ≤ 0 cae al default en silencio.
 * `path` se normaliza a que empiece con `/`. NUNCA lanza: un secreto ausente
 * es un modo de operación válido, no un error de arranque.
 */
export function resolveWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  return {
    secret: env.GITHUB_WEBHOOK_SECRET ?? "",
    port: resolvePositiveNumber(env.WEBHOOK_PORT, DEFAULT_WEBHOOK_PORT),
    path: normalizePath(env.WEBHOOK_PATH ?? DEFAULT_WEBHOOK_PATH),
    maxBodyBytes: resolvePositiveNumber(env.WEBHOOK_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
  };
}

/** `config.secret.trim() !== ""`. Único gate del listener. */
export function isWebhookEnabled(config: WebhookConfig): boolean {
  return config.secret.trim() !== "";
}
