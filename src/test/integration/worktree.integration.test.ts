import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGitExecFile } from "../../adapters/git/git-cli.js";
import {
  abrirWorktree,
  capturarDiff,
  cerrarWorktree,
  verificarPatch,
  type WorktreeRunnerDeps,
} from "../../adapters/git/worktree.js";

/**
 * Integration test for the disposable `git worktree` lifecycle (Hito 5.1,
 * tarea 10) against the REAL `git` binary — first file of this repo's new
 * "integración contra `git` real" category (design.md §10.C / §11): unlike
 * `worktree.test.ts` (unit, `GitExecFileFn` faked), `deps.execFileFn` here
 * is `defaultGitExecFile`, the production subprocess runner.
 *
 * Scope, deliberately narrow (spec `escritura-aislada-worktree`):
 *  - Requirement "Ciclo `abrir → invocar Developer → capturarDiff →
 *    cerrar`, con contrato asimétrico": `abrir` creates the worktree
 *    directory and its `harness/caso-*` branch for real; `cerrar` leaves
 *    `git worktree list` with a single entry (the main checkout) and the
 *    branch deleted.
 *  - Requirement "El worktree vive dentro del repo" — scenario "La tool de
 *    tests resuelve `node_modules` del checkout principal" (R5): this file
 *    does NOT invoke the real test-runner tool — that is tarea 25's job,
 *    against the repo's REAL `node_modules` (a fabricated `os.tmpdir()`
 *    repo has none to resolve). What this file verifies, structurally and
 *    NOT assumed, is the invariant that makes that resolution possible in
 *    production: `worktree.ruta` is nested INSIDE `repoRoot`, never a path
 *    that escapes it — Node's module resolution walks UP parent
 *    directories, so nesting is the actual mechanism R5 depends on.
 *  - Requirement "La captura del diff incluye archivos nuevos (untracked)":
 *    a file the Developer creates fresh inside the worktree comes back
 *    from `capturarDiff` as an added file WITH its full content — the
 *    exact scenario a mocked `GitExecFileFn` (as in `worktree.test.ts`)
 *    cannot prove; only a real two-command `git` sequence
 *    (`add --intent-to-add --all` then `diff --binary`) demonstrates it.
 *  - The captured patch passes `git apply --check` — exercised via
 *    `verificarPatch`, the same production function
 *    `/aplicar-propuesta`'s dispatcher calls (ADR 64) — against the temp
 *    repo, proving it is a well-formed patch a real `git apply` accepts,
 *    not merely a string a fake test double happened to accept.
 *
 * RD-5 (proposal.md), RD-18 (design.md §13 — `node_modules` resolution
 * risk; closed for real by tarea 25's real-`vitest` run, not by this file).
 *
 * `git init`/`worktree add`/`branch -D`/etc. run for REAL, but always
 * against a disposable repo fabricated fresh per test under `os.tmpdir()`
 * — never against this repo's own checkout. `HARNESS_WORKTREE_ROOT`
 * (design.md §6.1) is not needed here: `deps.repoRoot` already IS the
 * fabricated temp repo, so this category never touches the real `.harness/`.
 *
 * `describe.skipIf` degrades to a skip (not a failure) when `git` is not on
 * `PATH` — same molde as `graphify-cli.test.ts`'s
 * `isGraphifyBinaryAvailable`/`GRAPHIFY_AVAILABLE`.
 */
function isGitBinaryAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const GIT_AVAILABLE = isGitBinaryAvailable();

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

type LogEventFn = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

describe.skipIf(!GIT_AVAILABLE)("worktree.ts (integration against real git)", () => {
  let repoRoot: string;
  let deps: WorktreeRunnerDeps;
  let logEvent: ReturnType<typeof vi.fn<LogEventFn>>;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "worktree-integration-"));
    runGit(["init"], repoRoot);
    runGit(["config", "user.email", "worktree-integration@example.com"], repoRoot);
    runGit(["config", "user.name", "Worktree Integration Test"], repoRoot);
    runGit(["config", "core.autocrlf", "false"], repoRoot);
    await writeFile(join(repoRoot, "README.md"), "repo temporal de integracion\n", "utf8");
    runGit(["add", "."], repoRoot);
    runGit(["commit", "-m", "initial"], repoRoot);

    logEvent = vi.fn<LogEventFn>();
    deps = {
      repoRoot,
      worktreeRoot: ".harness/worktrees",
      bin: "git",
      timeoutMs: 30_000,
      execFileFn: defaultGitExecFile,
      logEvent,
    };
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("abrir crea el directorio del worktree y su rama harness/caso-*, anidado dentro del repo (R5, verificado no supuesto)", async () => {
    const worktree = await abrirWorktree({ casoId: "caso-integ", id: "abrir-1" }, deps);

    const dirStat = await stat(worktree.ruta);
    expect(dirStat.isDirectory()).toBe(true);

    const ramaListada = runGit(["branch", "--list", worktree.rama], repoRoot);
    expect(ramaListada).toContain(worktree.rama);

    // R5, verificado no supuesto: `worktree.ruta` queda ANIDADO dentro de
    // `repoRoot` — la ruta relativa nunca sube ("..") ni es absoluta —
    // que es la relación de directorios de la que depende la resolución
    // de `node_modules` subiendo por directorios padre.
    const relativa = relative(repoRoot, worktree.ruta);
    expect(isAbsolute(relativa)).toBe(false);
    expect(relativa.startsWith("..")).toBe(false);

    await cerrarWorktree(worktree, deps);
  });

  it("un archivo nuevo creado en el worktree aparece en el patch como agregado con contenido completo, y ese patch pasa git apply --check contra el repo temporal", async () => {
    const worktree = await abrirWorktree({ casoId: "caso-integ", id: "capturar-1" }, deps);

    const contenido = 'export const HOLA = "mundo";\n';
    await writeFile(join(worktree.ruta, "nuevo-archivo.ts"), contenido, "utf8");

    const patch = await capturarDiff(worktree, deps);

    expect(patch).toContain("nuevo-archivo.ts");
    expect(patch).toContain("new file mode");
    expect(patch).toContain('+export const HOLA = "mundo";');

    const verificacion = await verificarPatch(patch, deps);
    expect(verificacion).toEqual({ ok: true });

    await cerrarWorktree(worktree, deps);
  });

  it("cerrar deja git worktree list con una sola entrada (la principal) y la rama borrada", async () => {
    const worktree = await abrirWorktree({ casoId: "caso-integ", id: "cerrar-1" }, deps);

    await cerrarWorktree(worktree, deps);

    const listado = runGit(["worktree", "list", "--porcelain"], repoRoot);
    const entradas = listado.split("\n").filter((linea) => linea.startsWith("worktree "));
    expect(entradas).toHaveLength(1);

    const ramaTrasCierre = runGit(["branch", "--list", worktree.rama], repoRoot).trim();
    expect(ramaTrasCierre).toBe("");
    expect(logEvent).not.toHaveBeenCalledWith("worktree-cierre-fallido", expect.anything());
  });
});
