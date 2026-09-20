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
 * Ceilings for the conversational channel (consulta-kpi-a2a-chat, ADR 245,
 * design §9). NONE of them changes the `DEFAULT_*` values above: the TUI keeps
 * 30 s / 1.5 s / 120 s untouched.
 */
export const A2A_REQUEST_TIMEOUT_CHAT_MS = 8_000;
export const A2A_POLL_INTERVAL_CHAT_MS = 1_500;
export const A2A_TASK_TIMEOUT_CHAT_MS = 30_000;

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
 * Normaliza `baseUrl` quitando toda barra final (code-review, hallazgo 1).
 * Resuelto ACÁ — el único punto donde `HARNESS_A2A_ENDPOINT_*` se convierte
 * en `DestinoA2AConfig.baseUrl` — y no en `client.ts` (su único consumidor
 * hoy, `resolverEndpointJsonRpc`): mismo criterio "normalizar una vez en el
 * origen" que ya usan `resolvePositiveNumber`/`resolveNonBlankString` en este
 * archivo, así CUALQUIER consumidor futuro de `baseUrl` hereda la garantía
 * sin tener que acordarse de normalizar de nuevo. Sin esto, un operador con
 * `HARNESS_A2A_ENDPOINT_*=http://host:9001/` (barra final) produce
 * `.../agent-card.json` con doble barra (`//`), que un servidor A2A real
 * (incluido `a2a-sdk`, la referencia que exige el propio `README.md`) puede
 * rechazar con 404.
 */
function normalizarBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
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
  const baseUrlCrudo = resolveNonBlankString(env[claveAVariableEntorno(clave, "ENDPOINT")]);
  if (baseUrlCrudo === undefined) {
    return undefined;
  }
  const authToken = resolveNonBlankString(env[claveAVariableEntorno(clave, "TOKEN")]);
  return {
    baseUrl: normalizarBaseUrl(baseUrlCrudo),
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

  const requestTimeoutMs = resolvePositiveNumber(
    env.HARNESS_A2A_REQUEST_TIMEOUT_MS,
    DEFAULT_A2A_REQUEST_TIMEOUT_MS,
  );
  let pollIntervalMs = resolvePositiveNumber(
    env.HARNESS_A2A_POLL_INTERVAL_MS,
    DEFAULT_A2A_POLL_INTERVAL_MS,
  );
  let taskTimeoutMs = resolvePositiveNumber(
    env.HARNESS_A2A_TASK_TIMEOUT_MS,
    DEFAULT_A2A_TASK_TIMEOUT_MS,
  );

  // Validación cruzada (code-review, hallazgo): `pollIntervalMs >=
  // taskTimeoutMs` es una combinación que no tiene sentido y rompe el loop de
  // `GetTask` de `client.ts` en la práctica — ese loop sólo chequea el
  // deadline AL PRINCIPIO de cada iteración, nunca durante el propio
  // `dormir(pollIntervalMs)`; con `pollIntervalMs >= taskTimeoutMs` el primer
  // chequeo pasa (el timeout aún no venció) y el loop duerme el
  // `pollIntervalMs` COMPLETO antes de volver a chequear — el timeout
  // efectivo termina gobernado por `pollIntervalMs`, no por el
  // `taskTimeoutMs` configurado (p. ej. `pollIntervalMs=60000` con
  // `taskTimeoutMs=5000` da un timeout efectivo de ~60s, no 5s). Cae a los
  // defaults de AMBOS campos — no sólo al del "culpable" — porque una
  // combinación inválida no permite saber cuál de los dos valores era el
  // error de configuración real; mismo criterio "nunca lanza, siempre un
  // default sano" que ya usa `resolvePositiveNumber` en esta función.
  if (pollIntervalMs >= taskTimeoutMs) {
    pollIntervalMs = DEFAULT_A2A_POLL_INTERVAL_MS;
    taskTimeoutMs = DEFAULT_A2A_TASK_TIMEOUT_MS;
  }

  return {
    requestTimeoutMs,
    pollIntervalMs,
    taskTimeoutMs,
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

/**
 * PURE. Worst-case wait of `delegarTarea` end to end, derived from `client.ts`:
 *
 *   3 x requestTimeoutMs + taskTimeoutMs + pollIntervalMs
 *
 * The three request timeouts are the Agent Card fetch, the SendMessage and the
 * GetTask that starts right before the deadline and runs to completion (the
 * deadline guard runs before the sleep and the GetTask). `taskTimeoutMs` is the
 * polling window and `pollIntervalMs` the last sleep. `CancelTask` adds
 * nothing: it is fired without `await`.
 *
 * It does NOT compare against `OPERACIONES_TIMEOUT_MS` here: that would make
 * this adapter import another adapter (forbidden by AGENTS.md). The
 * comparison lives in the test, which may import both.
 */
export function esperaTotalMaximaMs(config: A2AConfig): number {
  return 3 * config.requestTimeoutMs + config.taskTimeoutMs + config.pollIntervalMs;
}

/**
 * Derives the conversational-channel config from an already resolved one. Each
 * field is `Math.min(base, ceiling)`: it never loosens what the operator
 * already tightened via env, it only tightens. `destinos` is passed through by
 * reference.
 *
 * Then it RE-APPLIES the `pollIntervalMs >= taskTimeoutMs` guard. On a config
 * produced by `resolveA2AConfig` the guard cannot fire (the resolver already
 * guarantees `poll < task` and `Math.min` preserves the order with ceilings
 * 1 500 < 30 000); it is a safety net for a hand-built `A2AConfig`. When it
 * fires it falls back to the CHANNEL ceilings, never to the adapter defaults:
 * `DEFAULT_A2A_TASK_TIMEOUT_MS` (120 000) would give 3x8 + 120 + 1.5 = 145.5 s
 * and break the bound.
 *
 * Postcondition: `esperaTotalMaximaMs(result)` <= 55 500 ms, that is
 * <= `OPERACIONES_TIMEOUT_MS / 2`, on every path.
 */
export function configParaCanalConversacional(base: A2AConfig): A2AConfig {
  let requestTimeoutMs = Math.min(base.requestTimeoutMs, A2A_REQUEST_TIMEOUT_CHAT_MS);
  let pollIntervalMs = Math.min(base.pollIntervalMs, A2A_POLL_INTERVAL_CHAT_MS);
  let taskTimeoutMs = Math.min(base.taskTimeoutMs, A2A_TASK_TIMEOUT_CHAT_MS);

  if (pollIntervalMs >= taskTimeoutMs) {
    requestTimeoutMs = A2A_REQUEST_TIMEOUT_CHAT_MS;
    pollIntervalMs = A2A_POLL_INTERVAL_CHAT_MS;
    taskTimeoutMs = A2A_TASK_TIMEOUT_CHAT_MS;
  }

  return { requestTimeoutMs, pollIntervalMs, taskTimeoutMs, destinos: base.destinos };
}
