import { resolve } from "node:path";
import "../../core/config/env.js";

/**
 * Typed configuration for `src/adapters/test-runner/` (Hito 5.1, tarea 21,
 * ADR 61 pto 7, design.md §6.2).
 *
 * The side-effect import above loads `.env` via `src/core/config/env.ts`,
 * the repo's single dotenv loading point, so this module (and any future
 * entrypoint that imports it) does not depend on `main.ts` remembering to
 * import `env.js` first — same pattern as `src/adapters/git/config.ts` and
 * `src/adapters/knowledge/config.ts`.
 *
 * `vitestEntrypoint` has NO env var (see design.md §6.2's table: `—` in the
 * env-var column): it is always `resolve(repoRoot, "node_modules/vitest/vitest.mjs")`,
 * never overridable — same reasoning as `git/config.ts`'s `repoRoot`, fixed
 * by the composition root, not by the environment.
 */
export interface TestRunnerConfig {
  readonly timeoutMs: number;
  readonly vitestEntrypoint: string;
}

export const DEFAULT_TEST_TIMEOUT_MS = 300_000;
/** Relative to `repoRoot` — where the local `vitest` binary/entrypoint lives once installed as a dependency. */
export const VITEST_ENTRYPOINT_RELATIVE = "node_modules/vitest/vitest.mjs";
/** Margen sobre `timeoutMs` para el timeout de tool-call de MCP (espejo de `MCP_TIMEOUT_MARGIN_MS`, `knowledge/config.ts`). No configurable por env, a propósito. */
export const TEST_MCP_TIMEOUT_MARGIN_MS = 5_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, not finite, or not strictly
 * greater than zero. Never throws — this adapter's configuration is
 * best-effort by design (see design.md §6.2), same contract as
 * `resolvePositiveNumber` in `src/adapters/git/config.ts`.
 *
 * The finiteness check rejects `Infinity`/`-Infinity` — e.g.
 * `HARNESS_WORKTREE_TEST_TIMEOUT_MS=Infinity` or `=1e400` (which `Number()`
 * also parses to `Infinity`) would otherwise pass and reach
 * `execFile(..., {timeout: Infinity})`, which Node rejects synchronously at
 * runtime, breaking this module's "never throws" contract.
 *
 * DELIBERATELY duplicated across adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic — `src/core/` shouldn't gain a
 * dependency just to serve adapter convenience — and AGENTS.md's
 * non-negotiable rule forbids one adapter importing from another. Same
 * accepted-duplication call as `git/config.ts`/`knowledge/config.ts`.
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
 * Resolves the test-runner configuration. `repoRoot` is a required parameter
 * (fixed by the composition root, same as `WorktreeRunnerDeps.repoRoot` in
 * `src/adapters/git/worktree.ts`) — it decides where `vitestEntrypoint`
 * points, and, unlike `env`, has no sensible process-wide default. `env`
 * defaults to `process.env` so tests can pass a literal object instead of
 * mutating the global process env.
 *
 * | Env var | Field | Default |
 * |---|---|---|
 * | `HARNESS_WORKTREE_TEST_TIMEOUT_MS` | `timeoutMs` (numeric) | `DEFAULT_TEST_TIMEOUT_MS` |
 * | — | `vitestEntrypoint` | `resolve(repoRoot, VITEST_ENTRYPOINT_RELATIVE)` |
 */
export function resolveTestRunnerConfig(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): TestRunnerConfig {
  return {
    timeoutMs: resolvePositiveNumber(env.HARNESS_WORKTREE_TEST_TIMEOUT_MS, DEFAULT_TEST_TIMEOUT_MS),
    vitestEntrypoint: resolve(repoRoot, VITEST_ENTRYPOINT_RELATIVE),
  };
}
