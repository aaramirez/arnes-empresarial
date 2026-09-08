import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  WORKTREE_RAMA_PREFIJO,
  MOTIVO_PATCH_CONFLICTO,
  MOTIVO_PATCH_ERROR_GIT,
  type WorktreeAbierto,
  type ResultadoPatch,
  type MotivoPatchNoAplicable,
} from "../../core/agents/worktree-contract.js";
import {
  buildApplyArgs,
  buildApplyCheckArgs,
  buildBranchDeleteArgs,
  buildDiffArgs,
  buildIntentToAddArgs,
  buildRevParseHeadArgs,
  buildWorktreeAddArgs,
  buildWorktreeRemoveArgs,
  classifyGitFailure,
  GitCliError,
  type GitExecFileFn,
} from "./git-cli.js";

/**
 * Real cycle of the disposable `git worktree` (Hito 5.1, tarea 7, ADR 57 pto
 * 5-6, ADR 62, ADR 64, design.md §6.1). Implements `WorktreePort` and
 * `AplicarPatchPort` (`src/core/agents/worktree-contract.ts`) as five
 * standalone named functions — `index.ts` (tarea 9) is the only file that
 * wires them into those two port shapes; this module has no factory of its
 * own (ADR 62's table).
 *
 * ASYMMETRY, same contract the ports document: `abrirWorktree` and
 * `capturarDiff` let `GitCliError` propagate uncaught — a worktree that
 * couldn't open, or a diff that couldn't be captured, is lost work that must
 * surface, not vanish. `cerrarWorktree`, `verificarPatch` and `aplicarPatch`
 * NEVER reject: they degrade to an event (`cerrarWorktree`, invoked from a
 * `finally`) or a tagged `ResultadoPatch` (`verificarPatch`/`aplicarPatch`,
 * whose failure — "the base moved" — is a normal outcome, not an exception,
 * per `AplicarPatchPort`'s doc-comment and ADR 64 pto 3).
 */
export interface WorktreeRunnerDeps {
  /** Root of the real checkout — where `abrir`/`cerrar` run `git`, since the worktree doesn't exist yet (`abrir`) or is being torn down (`cerrar`). */
  readonly repoRoot: string;
  /** Relative to `repoRoot` — where new worktrees are created (`resolveWorktreeConfig`, `config.ts`). */
  readonly worktreeRoot: string;
  readonly bin: string;
  readonly timeoutMs: number;
  readonly execFileFn: GitExecFileFn;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * Private boundary-crossing helper: invokes `deps.execFileFn`, and on
 * rejection classifies + wraps the raw error into `GitCliError` before
 * rethrowing — same sequence `git-cli.test.ts`'s "boundary crossing with a
 * fake GitExecFileFn" describe block drives at the unit level, now the real
 * implementation. NOT exported: `git-cli.ts`'s `SHALL NOT` (a generic
 * function receiving a `git` subcommand) is about the *public* surface of
 * the adapter — every call site below still only ever hands this a fixed
 * argv built by one of the ten named constructors, never a caller-controlled
 * subcommand.
 */
async function runGit(
  argv: readonly string[],
  command: string,
  cwd: string,
  deps: Pick<WorktreeRunnerDeps, "bin" | "timeoutMs" | "execFileFn">,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await deps.execFileFn(deps.bin, argv, { timeout: deps.timeoutMs, cwd });
  } catch (error) {
    throw new GitCliError(classifyGitFailure(error), command, error);
  }
}

/**
 * `rev-parse HEAD` (captures `baseCommit`, without which a failed `apply`
 * later is undiagnosable, R13) runs BEFORE `worktree add` — both scoped to
 * `deps.repoRoot`, because the worktree directory doesn't exist until the
 * second call succeeds. Neither call is caught here: `abrir` fails loudly
 * (`WorktreePort`'s doc-comment).
 */
export async function abrirWorktree(
  input: { readonly casoId: string; readonly id: string },
  deps: WorktreeRunnerDeps,
): Promise<WorktreeAbierto> {
  const rama = `${WORKTREE_RAMA_PREFIJO}${input.casoId}-${input.id}`;
  const ruta = resolve(deps.repoRoot, deps.worktreeRoot, `${input.casoId}-${input.id}`);

  const revParse = await runGit(buildRevParseHeadArgs(), "rev-parse HEAD", deps.repoRoot, deps);
  const baseCommit = revParse.stdout.trim();

  await runGit(buildWorktreeAddArgs(rama, ruta), "worktree add", deps.repoRoot, deps);

  return { casoId: input.casoId, ruta, rama, baseCommit };
}

/**
 * `add --intent-to-add --all` runs BEFORE `diff --binary`, both scoped to
 * `worktree.ruta` — which has its OWN index, separate from the real
 * checkout's, so `--intent-to-add` never touches the human's staged changes
 * (spec `escritura-aislada-worktree`, scenario "`--intent-to-add` no altera
 * el índice del checkout real"). Without the first call, untracked files the
 * Developer created would be invisible to `git diff` alone (spec scenario
 * "Un archivo nuevo creado por el Developer aparece en el patch"). Neither
 * call is caught here: `capturarDiff` fails loudly, same reasoning as
 * `abrirWorktree` — a diff that couldn't be captured must never turn into a
 * silently empty or corrupt proposal.
 */
export async function capturarDiff(worktree: WorktreeAbierto, deps: WorktreeRunnerDeps): Promise<string> {
  await runGit(buildIntentToAddArgs(), "add --intent-to-add --all", worktree.ruta, deps);
  const diff = await runGit(buildDiffArgs(), "diff --binary --no-color --no-ext-diff", worktree.ruta, deps);
  return diff.stdout;
}

/**
 * `worktree remove --force` then `branch -D`, both scoped to `deps.repoRoot`
 * (the worktree's own directory is being deleted, so it can't be the `cwd`
 * of the second call either) — each call in its OWN `try/catch` (code review,
 * Hito 5.1, code-review hito completo: a shared try/catch made a `branch -D`
 * failure AFTER a successful `worktree remove` indistinguishable from the
 * FIRST call failing, and dropped `worktree.rama` from the log entirely.
 * Once `worktree remove` succeeds, the directory is gone from
 * `git worktree list --porcelain`, so `barrerHuerfanos`'s candidate list can
 * never rediscover that branch again — losing the name here means it leaks
 * forever, with no way for an operator to `git branch -D <rama>` by hand).
 * NEVER rejects, under any circumstance: called from a `finally` by the
 * future cadena de revisión (tarea 30), and a `finally` that throws masks
 * whatever real error the surrounding `try` raised. Degrades to
 * `worktree-cierre-fallido` (the worktree itself couldn't be removed) or
 * `worktree-rama-huerfana` (the worktree IS gone, but its branch is now
 * orphaned) — two distinct events on purpose, so a human/log consumer can
 * tell which case happened without decoding a shared shape.
 */
export async function cerrarWorktree(worktree: WorktreeAbierto, deps: WorktreeRunnerDeps): Promise<void> {
  try {
    await runGit(buildWorktreeRemoveArgs(worktree.ruta), "worktree remove --force", deps.repoRoot, deps);
  } catch (error) {
    const reason = error instanceof GitCliError ? error.reason : "unknown";
    deps.logEvent("worktree-cierre-fallido", { casoId: worktree.casoId, ruta: worktree.ruta, rama: worktree.rama, reason });
    return;
  }

  try {
    await runGit(buildBranchDeleteArgs(worktree.rama), "branch -D", deps.repoRoot, deps);
  } catch (error) {
    const reason = error instanceof GitCliError ? error.reason : "unknown";
    deps.logEvent("worktree-rama-huerfana", { casoId: worktree.casoId, ruta: worktree.ruta, rama: worktree.rama, reason });
  }
}

/**
 * Shared implementation of `verificarPatch`/`aplicarPatch` (ADR 64 pto 3-4).
 * `git apply`/`git apply --check` read a file path, not stdin — `GitExecFileFn`
 * has no stdin in its signature by design (keeps every test double a plain
 * function, never a simulated `ChildProcess`) — so the patch text is written
 * to a scratch file under `<repoRoot>/.harness/patches/` first, and removed
 * in a `finally` that itself never rejects. `.harness/` is already
 * `.gitignore`d (tarea 6) and excluded from vitest's discovery (tarea 5).
 *
 * The scratch filename is a fresh `randomUUID()`, not `<propuestaId>.patch`
 * as design.md §6.1's ADR 64 pto 4 illustrates: `AplicarPatchPort.verificar`/
 * `.aplicar` (the contract this function implements, fixed by tarea 1) take
 * only `patch: string` — no `propuestaId` reaches this layer. A random name
 * still satisfies the actual constraint (a real file path for `git apply` to
 * read, cleaned up after use); the caller that DOES know the `propuestaId`
 * is `build-on-comando-empleado.ts` (tarea 32), one layer up.
 *
 * NEVER rejects: a non-zero exit from `git apply --check`/`git apply` is the
 * NORMAL "the base moved" outcome (R13), not a bug to throw over.
 * `classifyGitFailure`'s `"exit-code"` reason maps to `MOTIVO_PATCH_CONFLICTO`
 * for exactly that reason; every other reason (`git` missing, timeout,
 * unknown) maps to `MOTIVO_PATCH_ERROR_GIT` — a failure of the tool itself,
 * not of the patch against the tree.
 */
async function ejecutarAplicarPatch(
  patch: string,
  buildArgs: (rutaPatch: string) => readonly string[],
  command: string,
  deps: WorktreeRunnerDeps,
): Promise<ResultadoPatch> {
  const rutaPatch = resolve(deps.repoRoot, ".harness", "patches", `${randomUUID()}.patch`);
  try {
    await mkdir(dirname(rutaPatch), { recursive: true });
    await writeFile(rutaPatch, patch, "utf8");
    await runGit(buildArgs(rutaPatch), command, deps.repoRoot, deps);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof GitCliError ? error.reason : "unknown";
    const motivo: MotivoPatchNoAplicable = reason === "exit-code" ? MOTIVO_PATCH_CONFLICTO : MOTIVO_PATCH_ERROR_GIT;
    const detalle = error instanceof Error ? error.message : undefined;
    return detalle === undefined ? { ok: false, motivo } : { ok: false, motivo, detalle };
  } finally {
    await rm(rutaPatch, { force: true }).catch(() => {
      // Best-effort cleanup — a leftover scratch file under the gitignored
      // `.harness/patches/` is a cosmetic nuisance, never a reason for
      // `verificarPatch`/`aplicarPatch` to reject (same "never rejects"
      // contract this whole function already honors).
    });
  }
}

export async function verificarPatch(patch: string, deps: WorktreeRunnerDeps): Promise<ResultadoPatch> {
  return ejecutarAplicarPatch(patch, buildApplyCheckArgs, "apply --check", deps);
}

export async function aplicarPatch(patch: string, deps: WorktreeRunnerDeps): Promise<ResultadoPatch> {
  return ejecutarAplicarPatch(patch, buildApplyArgs, "apply", deps);
}
