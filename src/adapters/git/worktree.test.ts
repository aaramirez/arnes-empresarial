import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeAbierto } from "../../core/agents/worktree-contract.js";
import { abrirWorktree, capturarDiff, cerrarWorktree, verificarPatch, aplicarPatch, type WorktreeRunnerDeps } from "./worktree.js";
import type { GitExecFileFn } from "./git-cli.js";

/**
 * Test primero (RED confirmado antes de crear `worktree.ts`): `GitExecFileFn`
 * fake, mismo molde que `git-cli.test.ts`. `deps.repoRoot` apunta a un
 * directorio temporal REAL (creado con `mkdtemp`, no fabricado) porque
 * `verificarPatch`/`aplicarPatch` escriben el patch a un archivo temporal
 * bajo `<repoRoot>/.harness/patches/` (design.md §6.1, ADR 64 pto 4) antes de
 * invocar `git apply` — el `execFileFn` está faseado, pero esa escritura de
 * archivo es real. No es la categoría "integración contra git real" (eso son
 * las tareas 10-11): acá `git` nunca se invoca de verdad, solo se escribe un
 * archivo de scratch en un directorio descartable.
 */
describe("worktree.ts", () => {
  type LogEventFn = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

  let repoRoot: string;
  let execFileFn: ReturnType<typeof vi.fn<GitExecFileFn>>;
  let logEvent: ReturnType<typeof vi.fn<LogEventFn>>;
  let deps: WorktreeRunnerDeps;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "worktree-test-"));
    execFileFn = vi.fn<GitExecFileFn>();
    logEvent = vi.fn<LogEventFn>();
    deps = {
      repoRoot,
      worktreeRoot: ".harness/worktrees",
      bin: "git",
      timeoutMs: 30_000,
      execFileFn,
      logEvent,
    };
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe("abrirWorktree", () => {
    it("calls rev-parse HEAD before worktree add, both with cwd = repoRoot, and returns baseCommit", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "abc123\n", stderr: "" }); // rev-parse HEAD
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree add

      const resultado = await abrirWorktree({ casoId: "caso-1", id: "uuid-1" }, deps);

      expect(execFileFn).toHaveBeenNthCalledWith(1, "git", ["rev-parse", "HEAD"], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(execFileFn).toHaveBeenNthCalledWith(
        2,
        "git",
        ["worktree", "add", "-b", "harness/caso-caso-1-uuid-1", expect.stringContaining("caso-1-uuid-1"), "HEAD"],
        { timeout: 30_000, cwd: repoRoot },
      );
      expect(resultado.baseCommit).toBe("abc123");
      expect(resultado.casoId).toBe("caso-1");
      expect(resultado.rama).toBe("harness/caso-caso-1-uuid-1");
      expect(resultado.ruta).toContain("caso-1-uuid-1");
    });

    it("propagates the error and never calls worktree add when rev-parse HEAD fails", async () => {
      execFileFn.mockRejectedValueOnce({ code: "ENOENT" });

      await expect(abrirWorktree({ casoId: "caso-1", id: "uuid-1" }, deps)).rejects.toMatchObject({
        name: "GitCliError",
        reason: "not-found",
      });
      expect(execFileFn).toHaveBeenCalledTimes(1);
    });

    it("propagates the error when worktree add fails after a successful rev-parse HEAD", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "abc123\n", stderr: "" });
      execFileFn.mockRejectedValueOnce({ code: 128 });

      await expect(abrirWorktree({ casoId: "caso-1", id: "uuid-1" }, deps)).rejects.toMatchObject({
        name: "GitCliError",
        reason: "exit-code",
      });
    });
  });

  describe("capturarDiff", () => {
    const worktree: WorktreeAbierto = {
      casoId: "caso-1",
      ruta: "/repo/.harness/worktrees/caso-1-uuid-1",
      rama: "harness/caso-caso-1-uuid-1",
      baseCommit: "abc123",
    };

    it("calls add --intent-to-add --all before diff --binary, both with cwd = worktree.ruta", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // add --intent-to-add
      execFileFn.mockResolvedValueOnce({ stdout: "diff --git a/x b/x\n", stderr: "" }); // diff

      const patch = await capturarDiff(worktree, deps);

      expect(execFileFn).toHaveBeenNthCalledWith(1, "git", ["add", "--intent-to-add", "--all"], {
        timeout: 30_000,
        cwd: worktree.ruta,
      });
      expect(execFileFn).toHaveBeenNthCalledWith(
        2,
        "git",
        ["diff", "--binary", "--no-color", "--no-ext-diff"],
        { timeout: 30_000, cwd: worktree.ruta },
      );
      expect(patch).toBe("diff --git a/x b/x\n");
    });

    it("propagates the error and never calls diff when add --intent-to-add fails", async () => {
      execFileFn.mockRejectedValueOnce({ killed: true, signal: "SIGTERM" });

      await expect(capturarDiff(worktree, deps)).rejects.toMatchObject({
        name: "GitCliError",
        reason: "timeout",
      });
      expect(execFileFn).toHaveBeenCalledTimes(1);
    });

    it("propagates the error when diff fails after a successful intent-to-add", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" });
      execFileFn.mockRejectedValueOnce({ message: "boom" });

      await expect(capturarDiff(worktree, deps)).rejects.toMatchObject({
        name: "GitCliError",
        reason: "unknown",
      });
    });
  });

  describe("cerrarWorktree", () => {
    const worktree: WorktreeAbierto = {
      casoId: "caso-1",
      ruta: "/repo/.harness/worktrees/caso-1-uuid-1",
      rama: "harness/caso-caso-1-uuid-1",
      baseCommit: "abc123",
    };

    it("resolves without rejecting when both worktree remove and branch -D succeed", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // branch -D

      await expect(cerrarWorktree(worktree, deps)).resolves.toBeUndefined();

      expect(execFileFn).toHaveBeenNthCalledWith(1, "git", ["worktree", "remove", "--force", worktree.ruta], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(execFileFn).toHaveBeenNthCalledWith(2, "git", ["branch", "-D", worktree.rama], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it("never rejects even when both git calls fail, and degrades to a worktree-cierre-fallido event", async () => {
      execFileFn.mockRejectedValue({ code: "ENOENT" });

      await expect(cerrarWorktree(worktree, deps)).resolves.toBeUndefined();

      expect(logEvent).toHaveBeenCalledWith(
        "worktree-cierre-fallido",
        expect.objectContaining({ casoId: worktree.casoId, reason: "not-found" }),
      );
    });

    it("never rejects when only branch -D fails after a successful worktree remove, and logs a distinguishable orphaned-branch event carrying the branch name", async () => {
      // Code review (Hito 5.1, code-review hito completo): the original single
      // try/catch swallowed this into the SAME "worktree-cierre-fallido" event
      // as a fully-failed close, without `worktree.rama` — once the worktree
      // directory is gone, `barrerHuerfanos` can never rediscover the branch
      // from `git worktree list --porcelain` again, so losing the branch name
      // here means the branch leaks forever with no way for an operator to
      // clean it up by hand.
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove succeeds
      execFileFn.mockRejectedValueOnce({ code: 128 }); // branch -D fails

      await expect(cerrarWorktree(worktree, deps)).resolves.toBeUndefined();

      expect(logEvent).toHaveBeenCalledWith(
        "worktree-rama-huerfana",
        expect.objectContaining({ casoId: worktree.casoId, ruta: worktree.ruta, rama: worktree.rama, reason: "exit-code" }),
      );
      // Must NOT be reported under the generic "close failed entirely" shape —
      // the worktree really is gone, only the branch delete failed.
      expect(logEvent).not.toHaveBeenCalledWith("worktree-cierre-fallido", expect.anything());
    });
  });

  describe("verificarPatch / aplicarPatch", () => {
    const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hola\n";

    it("verificarPatch returns { ok: true } when git apply --check succeeds", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const resultado = await verificarPatch(patch, deps);

      expect(resultado).toEqual({ ok: true });
      const [, args, options] = execFileFn.mock.calls[0]!;
      expect(args[0]).toBe("apply");
      expect(args).toContain("--check");
      expect((options as { cwd: string }).cwd).toBe(repoRoot);
    });

    it("verificarPatch never rejects and returns { ok: false, motivo: 'conflicto' } on a non-zero exit code", async () => {
      execFileFn.mockRejectedValueOnce({ code: 1 });

      await expect(verificarPatch(patch, deps)).resolves.toEqual(
        expect.objectContaining({ ok: false, motivo: "conflicto" }),
      );
    });

    it("verificarPatch never rejects and returns { ok: false, motivo: 'error_git' } when git itself fails", async () => {
      execFileFn.mockRejectedValueOnce({ code: "ENOENT" });

      await expect(verificarPatch(patch, deps)).resolves.toEqual(
        expect.objectContaining({ ok: false, motivo: "error_git" }),
      );
    });

    it("aplicarPatch returns { ok: true } when git apply succeeds", async () => {
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const resultado = await aplicarPatch(patch, deps);

      expect(resultado).toEqual({ ok: true });
      const [, args] = execFileFn.mock.calls[0]!;
      expect(args[0]).toBe("apply");
      expect(args).not.toContain("--check");
    });

    it("aplicarPatch never rejects and returns { ok: false, motivo: 'error_git' } on timeout", async () => {
      execFileFn.mockRejectedValueOnce({ killed: true, signal: "SIGTERM" });

      await expect(aplicarPatch(patch, deps)).resolves.toEqual(
        expect.objectContaining({ ok: false, motivo: "error_git" }),
      );
    });
  });
});
