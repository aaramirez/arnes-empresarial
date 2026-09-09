import "../../core/config/env.js";
import { DESTINOS_A2A, type DestinoA2AClave } from "../../core/agents/a2a-contract.js";

/**
 * Typed configuration for `src/adapters/a2a/` (Hito 6, tarea 2, ADR 72 pto
 * 1-3, ADR 82, design.md §6.1).
 *
 * The side-effect import above loads `.env` via `src/core/config/env.ts`,
 * the repo's single dotenv loading point — same pattern as
 * `src/adapters/git/config.ts` and `src/adapters/knowledge/config.ts`.
 */
export interface DestinoA2AConfig {
  readonly baseUrl: string;
  /** `Authorization: Bearer <token>` opcional. NUNCA aparece en un mensaje ni en un log. */
  readonly authToken?: string;
}

export interface A2AConfig {
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly taskTimeoutMs: number;
  /** Una entrada por clave del registro; `undefined` = destino NO disponible (ADR 72 pto 3). */
  readonly destinos: Readonly<Record<DestinoA2AClave, DestinoA2AConfig | undefined>>;
}

export const DEFAULT_A2A_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_A2A_POLL_INTERVAL_MS = 1_500;
export const DEFAULT_A2A_TASK_TIMEOUT_MS = 120_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, not finite, or not strictly
 * greater than zero. Never throws — this adapter's configuration is
 * best-effort by design (see design.md §6.1), same contract as
 * `resolvePositiveNumber` in `src/adapters/git/config.ts`.
 *
 * The finiteness check rejects `Infinity`/`-Infinity` — e.g.
 * `HARNESS_A2A_TASK_TIMEOUT_MS=Infinity` or `=1e400` (which `Number()` also
 * parses to `Infinity`) would otherwise pass and defeat the purpose of
 * having a timeout at all.
 *
 * DELIBERATELY duplicated across adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic — `src/core/` shouldn't gain a
 * dependency just to serve adapter convenience — and AGENTS.md's
 * non-negotiable rule forbids one adapter importing from another. Same
 * accepted-duplication call as `git/config.ts:57-66`.
 */
function resolvePositiveNumber(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Falls back to `defaultValue` when the raw env var is missing or blank
 * (post-trim empty string) — same "absent or blank means default" rule as
 * `resolvePositiveNumber`, but for string fields where any non-blank value
 * is otherwise valid as-is. Same accepted-duplication call as
 * `resolveNonBlankString` in `git/config.ts:79-85`.
 */
function resolveNonBlankString(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * PURA. `("riesgo-credito", "ENDPOINT")` → `"HARNESS_A2A_ENDPOINT_RIESGO_CREDITO"`.
 * Los guiones de la clave NO son expresables en un nombre de variable de
 * entorno; esa traducción es exactamente el detalle que se rompe en silencio,
 * así que es una función con test dedicado y no un literal escrito dos veces
 * (ADR 72 pto 2).
 */
export function claveAVariableEntorno(
  clave: DestinoA2AClave,
  campo: "ENDPOINT" | "TOKEN",
): string {
  return `HARNESS_A2A_${campo}_${clave.toUpperCase().replaceAll("-", "_")}`;
}

function resolveDestinoA2AConfig(
  clave: DestinoA2AClave,
  env: NodeJS.ProcessEnv,
): DestinoA2AConfig | undefined {
  const baseUrl = resolveNonBlankString(env[claveAVariableEntorno(clave, "ENDPOINT")]);
  if (baseUrl === undefined) {
    return undefined;
  }
  const authToken = resolveNonBlankString(env[claveAVariableEntorno(clave, "TOKEN")]);
  return {
    baseUrl,
    ...(authToken !== undefined ? { authToken } : {}),
  };
}

/**
 * PURA, recibe `env` como parámetro, NUNCA lanza — molde literal de
 * `resolveGitConfig`/`resolveWorktreeConfig`. Una clave sin
 * `HARNESS_A2A_ENDPOINT_*` NO es un error de arranque: el destino queda
 * `undefined` y sólo falla — tipado — quien intente delegar hacia él.
 *
 * | Env var | Field | Default |
 * |---|---|---|
 * | `HARNESS_A2A_REQUEST_TIMEOUT_MS` | `requestTimeoutMs` (numeric) | `DEFAULT_A2A_REQUEST_TIMEOUT_MS` |
 * | `HARNESS_A2A_POLL_INTERVAL_MS` | `pollIntervalMs` (numeric) | `DEFAULT_A2A_POLL_INTERVAL_MS` |
 * | `HARNESS_A2A_TASK_TIMEOUT_MS` | `taskTimeoutMs` (numeric) | `DEFAULT_A2A_TASK_TIMEOUT_MS` |
 * | `HARNESS_A2A_ENDPOINT_<CLAVE>` | `destinos[clave].baseUrl` | — (undefined) |
 * | `HARNESS_A2A_TOKEN_<CLAVE>` | `destinos[clave].authToken` | — (undefined) |
 */
export function resolveA2AConfig(env: NodeJS.ProcessEnv = process.env): A2AConfig {
  const destinos = Object.fromEntries(
    DESTINOS_A2A.map((clave) => [clave, resolveDestinoA2AConfig(clave, env)]),
  ) as Readonly<Record<DestinoA2AClave, DestinoA2AConfig | undefined>>;

  return {
    requestTimeoutMs: resolvePositiveNumber(
      env.HARNESS_A2A_REQUEST_TIMEOUT_MS,
      DEFAULT_A2A_REQUEST_TIMEOUT_MS,
    ),
    pollIntervalMs: resolvePositiveNumber(
      env.HARNESS_A2A_POLL_INTERVAL_MS,
      DEFAULT_A2A_POLL_INTERVAL_MS,
    ),
    taskTimeoutMs: resolvePositiveNumber(
      env.HARNESS_A2A_TASK_TIMEOUT_MS,
      DEFAULT_A2A_TASK_TIMEOUT_MS,
    ),
    destinos,
  };
}

/**
 * `on` explícito y nada más (ADR 82 pto 1). Ausente, vacío o cualquier otro
 * valor ⇒ `false`. Interruptor **opt-in** — al revés que
 * `HARNESS_DELEGACION_ROLES`/`HARNESS_ESCRITURA_DELEGADA`, que están activos
 * por default y se apagan con `"off"`.
 */
export function isA2ASalienteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HARNESS_A2A_SALIENTE ?? "").trim().toLowerCase() === "on";
}
