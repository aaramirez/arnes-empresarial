import { stat } from "node:fs/promises";
import type {
  AplicarPatchPort,
  BarridoWorktreePort,
  WorktreePort,
} from "../../core/agents/worktree-contract.js";
import type { GitConfig, WorktreeConfig } from "./config.js";
import { defaultGitExecFile, type GitExecFileFn } from "./git-cli.js";
import {
  abrirWorktree,
  aplicarPatch as ejecutarAplicarPatch,
  capturarDiff,
  cerrarWorktree,
  verificarPatch,
  type WorktreeRunnerDeps,
} from "./worktree.js";
import { barrerHuerfanos, type BarridoRunnerDeps, type StatFn } from "./barrido.js";

/**
 * Facade for the git adapter (Hito 5.1, tarea 9, ADR 62, design.md §6.1) —
 * the only file in `src/adapters/git/` the composition root (`src/main.ts`)
 * imports. Wires the five pieces built by tareas 1-8
 * (`worktree-contract.ts`, `config.ts`, `git-cli.ts`, `worktree.ts`,
 * `barrido.ts`) into the three ports `src/core/agents/worktree-contract.ts`
 * defines — `WorktreePort`, `AplicarPatchPort`, `BarridoWorktreePort` —
 * molde literal de `createKnowledgeAdapter`
 * (`src/adapters/knowledge/index.ts`).
 *
 * Only `bin`/`timeoutMs` (from `GitConfig`) and `worktreeRoot` (from
 * `WorktreeConfig`) reach `WorktreeRunnerDeps`/`BarridoRunnerDeps` — `ttlMs`
 * is NOT part of that shape because `BarridoWorktreePort.barrerHuerfanos`
 * already takes it as a call-time argument (never a wiring-time dependency),
 * same as `ahoraMs`.
 */
export type GitAdapterConfig = GitConfig & Pick<WorktreeConfig, "worktreeRoot">;

export interface GitAdapter {
  readonly worktree: WorktreePort;
  readonly aplicarPatch: AplicarPatchPort;
  readonly barrido: BarridoWorktreePort;
}

/**
 * Real `StatFn` (never injected through `createGitAdapter`'s own signature,
 * unlike `execFileFn`): the facade always wires the real `node:fs/promises`
 * `stat` into `barrido.ts` — only `barrido.test.ts` (which drives
 * `barrerHuerfanos` directly, not through this facade) needs a fake one to
 * fabricate old/recent mtimes without touching disk.
 */
const defaultStatFn: StatFn = async (ruta) => {
  const stats = await stat(ruta);
  return { mtimeMs: stats.mtimeMs };
};

/**
 * Builds a `GitAdapter`: the three ports `WorktreePort`, `AplicarPatchPort`
 * and `BarridoWorktreePort` implemented over `worktree.ts`/`barrido.ts`
 * (tareas 7-8), which in turn implement themselves over the ten named argv
 * constructors of `git-cli.ts` (tarea 3) — never a generic `git(args)`
 * (ADR 62). `execFileFn` defaults to the real subprocess runner
 * (`defaultGitExecFile`); tests inject their own fake to avoid ever touching
 * the actual `git` binary.
 */
export function createGitAdapter(deps: {
  readonly config: GitAdapterConfig;
  readonly repoRoot: string;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly execFileFn?: GitExecFileFn;
}): GitAdapter {
  const execFileFn = deps.execFileFn ?? defaultGitExecFile;

  const runnerDeps: WorktreeRunnerDeps = {
    repoRoot: deps.repoRoot,
    worktreeRoot: deps.config.worktreeRoot,
    bin: deps.config.bin,
    timeoutMs: deps.config.timeoutMs,
    execFileFn,
    logEvent: deps.logEvent,
  };

  const barridoDeps: BarridoRunnerDeps = {
    ...runnerDeps,
    statFn: defaultStatFn,
  };

  const worktree: WorktreePort = {
    abrir: (input) => abrirWorktree(input, runnerDeps),
    capturarDiff: (worktreeAbierto) => capturarDiff(worktreeAbierto, runnerDeps),
    cerrar: (worktreeAbierto) => cerrarWorktree(worktreeAbierto, runnerDeps),
  };

  const aplicarPatch: AplicarPatchPort = {
    verificar: (patch) => verificarPatch(patch, runnerDeps),
    aplicar: (patch) => ejecutarAplicarPatch(patch, runnerDeps),
  };

  const barrido: BarridoWorktreePort = {
    barrerHuerfanos: (input) => barrerHuerfanos(input, barridoDeps),
  };

  return { worktree, aplicarPatch, barrido };
}
