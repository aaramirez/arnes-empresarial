import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestRunnerConfig } from "../../adapters/test-runner/config.js";
import { runVitest } from "../../adapters/test-runner/test-runner-cli.js";
import { defaultGitExecFile } from "../../adapters/git/git-cli.js";
import {
  abrirWorktree,
  cerrarWorktree,
  type WorktreeRunnerDeps,
} from "../../adapters/git/worktree.js";
import type { WorktreeAbierto } from "../../core/agents/worktree-contract.js";

/**
 * Integration test for the test-runner adapter (Hito 5.1, tarea 25) against
 * BOTH the REAL `git` binary AND the REAL `vitest` binary — segunda mitad de
 * la categoría "integración contra `git`/`vitest` real" (design.md §10.C /
 * §11), mismo `skip` que `worktree.integration.test.ts` (tarea 10) y
 * `barrido.integration.test.ts` (tarea 11).
 *
 * Unlike tareas 10-11, this file does NOT fabricate a disposable repo under
 * `os.tmpdir()`: `deps.repoRoot` here is THIS repo's own real checkout
 * (`REPO_ROOT`, resolved from `import.meta.url`, never `process.cwd()`
 * assumed). That is deliberate, not a shortcut — it is the only way to make
 * R5 ("resuelve `node_modules/vitest` del checkout principal desde dentro
 * del worktree") a REAL, verified mechanism instead of path arithmetic:
 *
 *  - `resolveTestRunnerConfig(REPO_ROOT)` builds `vitestEntrypoint` as an
 *    ABSOLUTE path (`resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs")`).
 *    Launching that absolute path never needs module resolution by itself.
 *  - But `vitest.mjs`, once running with `cwd` fixed to the worktree, needs
 *    to resolve `vitest.config.ts` (checked out INSIDE the worktree, since
 *    it is a tracked file) — and THAT file's own `import { ... } from
 *    "vitest/config"` resolves relative to ITS location, walking up parent
 *    directories to find a `node_modules`. A worktree fabricated under
 *    `os.tmpdir()` (task 10's molde) has no ancestor `node_modules` to find.
 *    A worktree nested inside `REPO_ROOT/.harness/worktrees/<id>/` does:
 *    walking up from there reaches `REPO_ROOT/node_modules`, which has
 *    `vitest` installed. That walk is the exact mechanism spec
 *    `escritura-aislada-worktree`'s requirement "El worktree vive dentro del
 *    repo... porque la resolución de módulos de Node necesita encontrar
 *    `<repo>/node_modules` subiendo por directorios padre" describes — this
 *    file exercises it for real instead of asserting path nesting alone (as
 *    tarea 10 already did, explicitly deferring the real run to this task).
 *
 * `worktree.ruta` still contains the FULL tree checked out at `HEAD`
 * (`git worktree` has no sparse mode used here) — including this repo's own
 * ~90 test files. Running `vitest run` unfiltered against that tree would
 * re-run the whole suite twice (once per scenario below), which is both slow
 * and beside the point of this test. Both scenarios below delete the
 * checked-out `src/` inside the worktree right after `abrirWorktree` and
 * replace it with a single, purpose-built `*.test.ts` file — a real
 * suite, just a minimal one, exactly as the task text asks for ("una suite
 * mínima"). This mutation only ever touches the WORKTREE's own working
 * copy on disk; it never touches this repo's real `src/`, its git index, or
 * its history.
 *
 * `runVitest` is called directly (not through `createTestRunnerAdapter`'s
 * MCP wrapping, nor `handleRunTests`'s truncation) — same layering choice
 * tarea 10 made by calling `capturarDiff`/`verificarPatch` directly instead
 * of via `createGitAdapter`: this category proves the underlying `git`/
 * `vitest` mechanics work end-to-end; the MCP/truncation wrapping around
 * `runVitest` is already unit-tested (tareas 23-24) with a faked
 * `TestExecFileFn`. `execFileFn` is deliberately OMITTED here so `runVitest`
 * falls back to its real default (`defaultTestExecFile`) — using a fake here
 * would defeat the entire purpose of this integration category.
 *
 * `describe.skipIf` degrades to a skip (not a failure) when `git` is not on
 * `PATH` — same molde as tareas 10-11's `isGitBinaryAvailable`/`GIT_AVAILABLE`.
 *
 * Cubre spec `escritura-aislada-worktree`, escenario "La suite corre dentro
 * del worktree y devuelve resultado real". RD-18.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `src/test/integration/` → repo root, three levels up. Never `process.cwd()`: this file's own location is the one ground truth for where `node_modules/vitest` actually lives. */
const REPO_ROOT = resolve(__dirname, "../../..");

type LogEventFn = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

const SUITE_TIMEOUT_MS = 60_000;

describe.skipIf(!GIT_AVAILABLE)("test-runner (integration against real git + real vitest)", () => {
  let worktree: WorktreeAbierto | undefined;
  let deps: WorktreeRunnerDeps;
  let logEvent: ReturnType<typeof vi.fn<LogEventFn>>;

  afterEach(async () => {
    if (worktree !== undefined) {
      await cerrarWorktree(worktree, deps);
      worktree = undefined;
    }
  });

  it(
    "resuelve vitestEntrypoint del checkout principal (R5, verificado no supuesto) y devuelve exitCode 0 con una suite minima en verde",
    async () => {
      logEvent = vi.fn<LogEventFn>();
      deps = {
        repoRoot: REPO_ROOT,
        worktreeRoot: ".harness/worktrees",
        bin: "git",
        timeoutMs: 30_000,
        execFileFn: defaultGitExecFile,
        logEvent,
      };

      worktree = await abrirWorktree({ casoId: "caso-run-tests", id: "verde" }, deps);

      // R5, verificado no supuesto: el entrypoint de vitest vive en el
      // node_modules del checkout PRINCIPAL, nunca dentro del worktree — el
      // worktree recién abierto ni siquiera tiene su propio node_modules
      // (git worktree sólo trae archivos versionados; node_modules está
      // gitignoreado).
      const config = resolveTestRunnerConfig(REPO_ROOT);
      expect(existsSync(config.vitestEntrypoint)).toBe(true);
      expect(config.vitestEntrypoint.startsWith(worktree.ruta)).toBe(false);
      expect(existsSync(resolve(worktree.ruta, "node_modules"))).toBe(false);

      // Poda el árbol completo (~90 archivos de test reales) que `git
      // worktree` trajo por venir de HEAD, y lo reemplaza por una suite de
      // un solo archivo — real, mínima, sin fixtures ni dobles.
      await rm(resolve(worktree.ruta, "src"), { recursive: true, force: true });
      await writeFile(
        resolve(worktree.ruta, "sample.test.ts"),
        [
          'import { describe, expect, it } from "vitest";',
          "",
          'describe("sample suite (verde)", () => {',
          '  it("passes", () => {',
          "    expect(1).toBe(1);",
          "  });",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const resultado = await runVitest(config, worktree.ruta);

      expect(resultado.exitCode).toBe(0);
      expect(resultado.durationMs).toBeGreaterThanOrEqual(0);
    },
    SUITE_TIMEOUT_MS,
  );

  it(
    "devuelve exitCode distinto de 0 con una suite rota, corriendo dentro del cwd del worktree",
    async () => {
      logEvent = vi.fn<LogEventFn>();
      deps = {
        repoRoot: REPO_ROOT,
        worktreeRoot: ".harness/worktrees",
        bin: "git",
        timeoutMs: 30_000,
        execFileFn: defaultGitExecFile,
        logEvent,
      };

      worktree = await abrirWorktree({ casoId: "caso-run-tests", id: "rota" }, deps);

      const config = resolveTestRunnerConfig(REPO_ROOT);

      await rm(resolve(worktree.ruta, "src"), { recursive: true, force: true });
      await writeFile(
        resolve(worktree.ruta, "sample.test.ts"),
        [
          'import { describe, expect, it } from "vitest";',
          "",
          'describe("sample suite (rota)", () => {',
          '  it("fails", () => {',
          "    expect(1).toBe(2);",
          "  });",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const resultado = await runVitest(config, worktree.ruta);

      expect(resultado.exitCode).not.toBe(0);
    },
    SUITE_TIMEOUT_MS,
  );
});
