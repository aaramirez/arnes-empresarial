import "../../core/config/env.js";

/**
 * Typed configuration for the Graphify CLI wrapper (I2, Hito 2 tarea 2).
 *
 * The side-effect import above loads `.env` via `src/core/config/env.ts`,
 * the repo's single dotenv loading point, so this module (and any future
 * entrypoint that imports it) does not depend on `main.ts` remembering to
 * import `env.js` first.
 */
export interface GraphifyConfig {
  readonly bin: string;
  readonly graphPath: string;
  readonly budget: number;
  readonly queryTimeoutMs: number;
}

export const DEFAULT_GRAPHIFY_BIN = "graphify";
export const DEFAULT_GRAPH_PATH = "graphify-out/graph.json";
export const DEFAULT_BUDGET = 200;
export const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
/** Ver §8 del design. No configurable por env, a propósito. */
export const SAVE_RESULT_TIMEOUT_MS = 5_000;
/** Margen sobre `queryTimeoutMs` para el timeout de tool-call de MCP. Ver §8 del design. */
export const MCP_TIMEOUT_MARGIN_MS = 5_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws — this adapter's configuration is best-effort by
 * design (see design.md §8).
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
 * Resolves the Graphify CLI configuration from environment variables. Pure:
 * receives `env` as a parameter (default `process.env`) so tests can pass a
 * literal object instead of mutating the global process env.
 *
 * | Env var | Field | Default |
 * |---|---|---|
 * | `GRAPHIFY_BIN` | `bin` | `DEFAULT_GRAPHIFY_BIN` |
 * | `GRAPHIFY_GRAPH_PATH` | `graphPath` | `DEFAULT_GRAPH_PATH` |
 * | `GRAPHIFY_BUDGET` | `budget` (numeric) | `DEFAULT_BUDGET` |
 * | `GRAPHIFY_TIMEOUT_MS` | `queryTimeoutMs` (numeric) | `DEFAULT_QUERY_TIMEOUT_MS` |
 */
export function resolveGraphifyConfig(
  env: NodeJS.ProcessEnv = process.env,
): GraphifyConfig {
  return {
    bin: env.GRAPHIFY_BIN ?? DEFAULT_GRAPHIFY_BIN,
    graphPath: env.GRAPHIFY_GRAPH_PATH ?? DEFAULT_GRAPH_PATH,
    budget: resolvePositiveNumber(env.GRAPHIFY_BUDGET, DEFAULT_BUDGET),
    queryTimeoutMs: resolvePositiveNumber(env.GRAPHIFY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS),
  };
}
