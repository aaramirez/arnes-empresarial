import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Shape of a subprocess runner narrow enough to be faked in tests without
 * touching the real `git` binary. `defaultGitExecFile` is the production
 * implementation; tests inject their own fake (Hito 5.1, tarea 3, design.md
 * §6.1).
 *
 * `cwd` is part of the required shape, not an optional extra — design.md
 * §6.1 calls this out explicitly ("Diferencia real con el molde, no
 * cosmética"): every `git` call this adapter makes is scoped to a
 * worktree's own checkout, never to the process's cwd (the real repo). A
 * caller that forgets to pass `cwd` doesn't get a chance to run against the
 * real checkout by accident — the type makes that inexpressible instead of
 * relying on a convention to remember.
 */
export type GitExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly cwd: string },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const execFileAsync = promisify(execFile);

/**
 * Production `GitExecFileFn`. Uses `execFile` (array argv, `shell` never
 * set) — never `exec` — same discipline `knowledge/graphify-cli.ts`'s
 * `defaultExecFile` applies: AGENTS.md's non-negotiable rule that this
 * adapter never exposes a function that receives a `git` subcommand as a
 * caller-controlled parameter (ADR 62) only holds if the runner underneath
 * it never hands anything to a shell either. `maxBuffer` is raised from
 * Node's 1 MB default because `git diff --binary` on a sizeable patch can
 * exceed it, and the failure mode would otherwise be an opaque `ENOBUFS`.
 * `windowsHide` avoids a flashing console window on Windows.
 */
export const defaultGitExecFile: GitExecFileFn = (file, args, options) =>
  execFileAsync(file, args as string[], {
    timeout: options.timeout,
    cwd: options.cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

export type GitFailureReason = "not-found" | "timeout" | "exit-code" | "unknown";

/**
 * Typed error crossing the adapter boundary in place of whatever
 * `execFile`/`node:child_process` raised. Same pattern `graphify-cli.ts`'s
 * `GraphifyCliError` applies (and, further back, `repository.ts`'s
 * `isSqliteConstraintError`): the raw driver error (`cause`) never leaks
 * past this module's callers unclassified — only a `reason` they can
 * branch on.
 */
export class GitCliError extends Error {
  readonly reason: GitFailureReason;
  readonly cause: unknown;

  constructor(reason: GitFailureReason, command: string, cause: unknown) {
    super(`git ${command} failed: ${reason}`);
    this.name = "GitCliError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Classifies a raw error from `execFile` into a `GitFailureReason` — the
 * table design.md §6.1 fixes: `ENOENT` → binary not found, `killed`/
 * `SIGTERM` → timed out, a numeric non-zero `code` → the process ran and
 * exited with failure, anything else → unknown (safety net).
 *
 * Exported — unlike its `graphify-cli.ts` sibling `classifyFailure`, kept
 * private there — because the code that wraps this in a `GitCliError` lives
 * in a *different* file. This module has no generic `run`-style wrapper of
 * its own by design (ADR 62: the adapter never exposes a function that
 * receives a `git` subcommand as a parameter, only the ten named argv
 * builders of §6.1 parte 2, tarea 4); the actual `execFileFn` call +
 * try/catch + wrap sequence lives in `worktree.ts`/`barrido.ts` (tarea 7-8),
 * which import this function to do it.
 */
export function classifyGitFailure(error: unknown): GitFailureReason {
  if (typeof error === "object" && error !== null) {
    const err = error as { code?: unknown; killed?: unknown; signal?: unknown };
    if (err.code === "ENOENT") {
      return "not-found";
    }
    if (err.killed === true || err.signal === "SIGTERM") {
      return "timeout";
    }
    if (typeof err.code === "number" && err.code !== 0) {
      return "exit-code";
    }
  }
  return "unknown";
}

/**
 * The ten named argv builders (design.md §6.1 parte 2, ADR 62, Hito 5.1
 * tarea 4). Each one has a fixed subcommand literal at position 0; the only
 * thing a caller controls is a branch name or a filesystem path, and only
 * at positions >= 1. There is no `git(args: string[])` — a caller cannot
 * hand this module a subcommand at all, which is what makes AGENTS.md's
 * rule ("el adaptador expone funciones nombradas, nunca un `git(args)`
 * genérico") true by construction rather than by convention: `commit`,
 * `push`, `remote`, and `tag` are not "something this module chooses not
 * to do" — they are something there is no parameter to write into.
 */
export function buildRevParseHeadArgs(): readonly string[] {
  return ["rev-parse", "HEAD"];
}

export function buildWorktreeAddArgs(rama: string, ruta: string): readonly string[] {
  return ["worktree", "add", "-b", rama, ruta, "HEAD"];
}

export function buildIntentToAddArgs(): readonly string[] {
  return ["add", "--intent-to-add", "--all"];
}

export function buildDiffArgs(): readonly string[] {
  return ["diff", "--binary", "--no-color", "--no-ext-diff"];
}

export function buildWorktreeRemoveArgs(ruta: string): readonly string[] {
  return ["worktree", "remove", "--force", ruta];
}

export function buildBranchDeleteArgs(rama: string): readonly string[] {
  return ["branch", "-D", rama];
}

export function buildWorktreeListArgs(): readonly string[] {
  return ["worktree", "list", "--porcelain"];
}

export function buildWorktreePruneArgs(): readonly string[] {
  return ["worktree", "prune"];
}

export function buildApplyCheckArgs(rutaPatch: string): readonly string[] {
  return ["apply", "--check", "--whitespace=nowarn", rutaPatch];
}

export function buildApplyArgs(rutaPatch: string): readonly string[] {
  return ["apply", "--whitespace=nowarn", rutaPatch];
}

/**
 * The set of subcommand literals any of the ten builders above can ever
 * place at `argv[0]`. Used by `git-cli.test.ts`'s adversarial-input test —
 * the check that makes "no builder can emit `commit`, `push`, `remote`, or
 * `tag`" a verifiable property of the code instead of a documentation-only
 * claim (design.md §10.A).
 */
export const SUBCOMANDOS_PERMITIDOS = ["rev-parse", "worktree", "add", "diff", "branch", "apply"] as const;

/**
 * The ten builders, gathered so the test for design.md §10.A can iterate
 * them generically instead of hand-listing each one (and silently missing
 * a future eleventh builder someone adds without updating the test).
 */
export const CONSTRUCTORES_ARGV: readonly ((...args: never[]) => readonly string[])[] = [
  buildRevParseHeadArgs,
  buildWorktreeAddArgs,
  buildIntentToAddArgs,
  buildDiffArgs,
  buildWorktreeRemoveArgs,
  buildBranchDeleteArgs,
  buildWorktreeListArgs,
  buildWorktreePruneArgs,
  buildApplyCheckArgs,
  buildApplyArgs,
];
