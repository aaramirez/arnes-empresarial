import "../../core/config/env.js";

/**
 * El side-effect import de arriba carga `.env` vía el punto único del repo
 * (`src/core/config/env.ts`), mismo criterio que
 * `src/adapters/webhooks/config.ts` ya sigue hoy.
 */
export interface BoardConfig {
  /** `""` = adaptador DESHABILITADO → puerto no-op que loguea. */
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly userAgent: string;
}

export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
export const DEFAULT_BOARD_TIMEOUT_MS = 10_000;
export const DEFAULT_BOARD_USER_AGENT = "arnes-empresarial";
/** Tope de archivos que se piden y se pasan al prompt (§7). Sin paginación — fuera de alcance. */
export const MAX_CHANGED_FILES = 50;
/** El límite real de un comentario de GitHub es 65 536 caracteres; se corta antes con margen. */
export const MAX_COMMENT_CHARS = 60_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws — this adapter's configuration is best-effort by
 * design, same criterion as `src/adapters/webhooks/config.ts`.
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
 * que `resolveWebhookConfig`, para que los tests pasen un objeto literal en
 * vez de mutar el env global.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `GITHUB_TOKEN` | `token` | `""` (deshabilitado) |
 * | `GITHUB_API_BASE_URL` | `apiBaseUrl` | `DEFAULT_GITHUB_API_BASE_URL` |
 * | `BOARD_TIMEOUT_MS` | `requestTimeoutMs` | `DEFAULT_BOARD_TIMEOUT_MS` |
 *
 * `userAgent` NO es configurable por env: siempre vale
 * `DEFAULT_BOARD_USER_AGENT`. Mismas reglas que `resolveWebhookConfig`: pura,
 * nunca lanza, numéricos inválidos caen al default.
 */
export function resolveBoardConfig(env: NodeJS.ProcessEnv = process.env): BoardConfig {
  return {
    token: env.GITHUB_TOKEN ?? "",
    apiBaseUrl: env.GITHUB_API_BASE_URL ?? DEFAULT_GITHUB_API_BASE_URL,
    requestTimeoutMs: resolvePositiveNumber(env.BOARD_TIMEOUT_MS, DEFAULT_BOARD_TIMEOUT_MS),
    userAgent: DEFAULT_BOARD_USER_AGENT,
  };
}

/** `config.token.trim() !== ""`. Único gate del adaptador. */
export function isBoardEnabled(config: BoardConfig): boolean {
  return config.token.trim() !== "";
}
