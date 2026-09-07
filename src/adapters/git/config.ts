import "../../core/config/env.js";

/**
 * Typed configuration for `src/adapters/git/` (Hito 5.1, tarea 2, ADR 57 pto
 * 1 y 7, ADR 62, design.md §6.1).
 *
 * The side-effect import above loads `.env` via `src/core/config/env.ts`,
 * the repo's single dotenv loading point, so this module (and any future
 * entrypoint that imports it) does not depend on `main.ts` remembering to
 * import `env.js` first — same pattern as `src/adapters/knowledge/config.ts`
 * and `src/adapters/webhooks/config.ts`.
 *
 * Split in two resolvers, not one, because each serves a different
 * consumer: `GitConfig` is what `git-cli.ts`'s runner needs (binary +
 * per-call timeout); `WorktreeConfig` is what `worktree.ts`/`barrido.ts`
 * need (where worktrees live + how long an idle one is allowed to survive
 * before the sweep reclaims it). `repoRoot` is deliberately NOT here: per
 * design.md §6.1 it is a parameter fixed by the composition root
 * (`process.cwd()`), not an env var — a caller can't override the repo it
 * is running against via the environment.
 */
export interface GitConfig {
  readonly bin: string;
  readonly timeoutMs: number;
}

export interface WorktreeConfig {
  readonly worktreeRoot: string;
  readonly ttlMs: number;
}

export const DEFAULT_GIT_BIN = "git";
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_WORKTREE_ROOT = ".harness/worktrees";
/** 2 h (ADR 57 pto 7) — holgadamente mayor que un turno de modelo + una corrida de suite, holgadamente menor que una jornada. */
export const DEFAULT_WORKTREE_TTL_MS = 7_200_000;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws — this adapter's configuration is best-effort by
 * design (see design.md §6.1).
 *
 * DELIBERATELY duplicated across adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic — `src/core/` shouldn't gain a
 * dependency just to serve adapter convenience — and AGENTS.md's
 * non-negotiable rule forbids one adapter importing from another. Same
 * accepted-duplication call as `knowledge/config.ts`/`webhooks/config.ts`.
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
 * Resolves the `git` CLI runner configuration from environment variables.
 * Pure: receives `env` as a parameter (default `process.env`) so tests can
 * pass a literal object instead of mutating the global process env.
 *
 * | Env var | Field | Default |
 * |---|---|---|
 * | `HARNESS_GIT_BIN` | `bin` | `DEFAULT_GIT_BIN` |
 * | `HARNESS_GIT_TIMEOUT_MS` | `timeoutMs` (numeric) | `DEFAULT_GIT_TIMEOUT_MS` |
 */
export function resolveGitConfig(env: NodeJS.ProcessEnv = process.env): GitConfig {
  return {
    bin: env.HARNESS_GIT_BIN ?? DEFAULT_GIT_BIN,
    timeoutMs: resolvePositiveNumber(env.HARNESS_GIT_TIMEOUT_MS, DEFAULT_GIT_TIMEOUT_MS),
  };
}

/**
 * Resolves the worktree lifecycle configuration from environment variables.
 * Pure, same parameter pattern as `resolveGitConfig`.
 *
 * | Env var | Field | Default |
 * |---|---|---|
 * | `HARNESS_WORKTREE_ROOT` | `worktreeRoot` | `DEFAULT_WORKTREE_ROOT` |
 * | `HARNESS_WORKTREE_TTL_MS` | `ttlMs` (numeric) | `DEFAULT_WORKTREE_TTL_MS` |
 *
 * `HARNESS_WORKTREE_ROOT` is not in `proposal.md` and was added deliberately
 * (design.md §6.1): the integration test against real `git` needs its own
 * worktree root under a temp repo, without this variable that test would
 * have to dirty the real repo's `.harness/`.
 */
export function resolveWorktreeConfig(env: NodeJS.ProcessEnv = process.env): WorktreeConfig {
  return {
    worktreeRoot: env.HARNESS_WORKTREE_ROOT ?? DEFAULT_WORKTREE_ROOT,
    ttlMs: resolvePositiveNumber(env.HARNESS_WORKTREE_TTL_MS, DEFAULT_WORKTREE_TTL_MS),
  };
}
