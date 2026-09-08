import { mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTIVO_PATCH_CONFLICTO } from "../../core/agents/worktree-contract.js";
import * as gitCliModule from "./git-cli.js";
import type { GitExecFileFn } from "./git-cli.js";
import { createGitAdapter, type GitAdapterConfig } from "./index.js";

/**
 * Test primero (RED confirmado antes de crear `index.ts`, Hito 5.1 tarea 9,
 * ADR 62, design.md §6.1): `GitExecFileFn` fake, mismo molde que
 * `worktree.test.ts`/`barrido.test.ts`/`git-cli.test.ts`. `deps.repoRoot`
 * apunta a un directorio temporal REAL (creado con `mkdtemp`), porque el
 * barrido usa el `StatFn` REAL por defecto (`node:fs/promises` `stat`) — este
 * archivo es la fachada, así que sus tests deben probar que el default
 * conecta con las piezas reales de `worktree.ts`/`barrido.ts`/`git-cli.ts`,
 * no re-testear la lógica de esos tres módulos (ya cubierta en sus propios
 * `*.test.ts`). Ningún test invoca `git` de verdad (esa es la categoría
 * separada de las tareas 10-11).
 */
describe("createGitAdapter", () => {
  let repoRoot: string;

  function makeConfig(overrides: Partial<GitAdapterConfig> = {}): GitAdapterConfig {
    return {
      bin: "git",
      timeoutMs: 30_000,
      worktreeRoot: ".harness/worktrees",
      ...overrides,
    };
  }

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "git-adapter-test-"));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe("worktree", () => {
    it("wires worktree.abrir() through worktree.ts's abrirWorktree using config.bin/timeoutMs and deps.repoRoot", async () => {
      const execFileFn = vi.fn<GitExecFileFn>();
      execFileFn.mockResolvedValueOnce({ stdout: "abc123\n", stderr: "" }); // rev-parse HEAD
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree add
      const logEvent = vi.fn();
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent, execFileFn });

      const resultado = await adapter.worktree.abrir({ casoId: "caso-1", id: "uuid-1" });

      expect(execFileFn).toHaveBeenNthCalledWith(1, "git", ["rev-parse", "HEAD"], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(resultado.baseCommit).toBe("abc123");
      expect(resultado.rama).toBe("harness/caso-caso-1-uuid-1");
      expect(resultado.ruta).toContain("caso-1-uuid-1");
    });

    it("wires worktree.cerrar() through worktree.ts's cerrarWorktree, which never rejects", async () => {
      const execFileFn = vi.fn<GitExecFileFn>();
      execFileFn.mockRejectedValueOnce({ code: "ENOENT" }); // worktree remove --force fails
      const logEvent = vi.fn();
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent, execFileFn });

      await expect(
        adapter.worktree.cerrar({
          casoId: "caso-1",
          ruta: join(repoRoot, "caso-1-uuid-1"),
          rama: "harness/caso-caso-1-uuid-1",
          baseCommit: "abc123",
        }),
      ).resolves.toBeUndefined();

      expect(logEvent).toHaveBeenCalledWith(
        "worktree-cierre-fallido",
        expect.objectContaining({ casoId: "caso-1", reason: "not-found" }),
      );
    });
  });

  describe("aplicarPatch", () => {
    it("wires aplicarPatch.verificar() through worktree.ts's verificarPatch (git apply --check)", async () => {
      const execFileFn = vi.fn<GitExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn(), execFileFn });

      const resultado = await adapter.aplicarPatch.verificar("diff --git a/x b/x\n");

      expect(resultado).toEqual({ ok: true });
      expect(execFileFn).toHaveBeenCalledTimes(1);
      const [file, args, options] = execFileFn.mock.calls[0]!;
      expect(file).toBe("git");
      expect(args[0]).toBe("apply");
      expect(args).toContain("--check");
      expect(options).toEqual({ timeout: 30_000, cwd: repoRoot });
    });

    it("wires aplicarPatch.aplicar() through worktree.ts's aplicarPatch (git apply, sin --check)", async () => {
      const execFileFn = vi.fn<GitExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn(), execFileFn });

      const resultado = await adapter.aplicarPatch.aplicar("diff --git a/x b/x\n");

      expect(resultado).toEqual({ ok: true });
      const [, args] = execFileFn.mock.calls[0]!;
      expect(args[0]).toBe("apply");
      expect(args).not.toContain("--check");
    });

    it("degrades a rejected git apply --check to a tagged ResultadoPatch instead of throwing", async () => {
      const execFileFn = vi.fn<GitExecFileFn>().mockRejectedValue({ code: 1 });
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn(), execFileFn });

      const resultado = await adapter.aplicarPatch.verificar("diff --git a/x b/x\n");

      expect(resultado).toEqual({
        ok: false,
        motivo: MOTIVO_PATCH_CONFLICTO,
        detalle: "git apply --check failed: exit-code",
      });
    });
  });

  describe("barrido", () => {
    function porcelain(ruta: string, rama: string): string {
      return `worktree ${ruta}\nbranch refs/heads/${rama}\n`;
    }

    it("wires barrido.barrerHuerfanos() through barrido.ts using the real default statFn — keeps a worktree within TTL", async () => {
      const worktreeAbsPath = join(repoRoot, ".harness", "worktrees", "caso-1-abc");
      await mkdir(worktreeAbsPath, { recursive: true });
      const execFileFn = vi.fn<GitExecFileFn>();
      execFileFn.mockResolvedValueOnce({
        stdout: porcelain(worktreeAbsPath, "harness/caso-caso-1-abc"),
        stderr: "",
      }); // worktree list --porcelain
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree prune
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn(), execFileFn });

      const resumen = await adapter.barrido.barrerHuerfanos({ ttlMs: 300_000, ahoraMs: Date.now() });

      expect(resumen).toEqual({ examinados: 1, borrados: 0, fallidos: 0 });
      expect(execFileFn).toHaveBeenCalledTimes(2); // list + prune, ningún remove/branch -D
    });

    it("wires barrido.barrerHuerfanos() through barrido.ts using the real default statFn — removes a worktree past TTL", async () => {
      const worktreeAbsPath = join(repoRoot, ".harness", "worktrees", "caso-2-def");
      await mkdir(worktreeAbsPath, { recursive: true });
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h atrás
      await utimes(worktreeAbsPath, oldDate, oldDate);

      const execFileFn = vi.fn<GitExecFileFn>();
      execFileFn.mockResolvedValueOnce({
        stdout: porcelain(worktreeAbsPath, "harness/caso-caso-2-def"),
        stderr: "",
      }); // worktree list --porcelain
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove --force
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // branch -D
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree prune
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn(), execFileFn });

      const resumen = await adapter.barrido.barrerHuerfanos({ ttlMs: 1_000, ahoraMs: Date.now() });

      expect(resumen).toEqual({ examinados: 1, borrados: 1, fallidos: 0 });
      expect(execFileFn).toHaveBeenCalledTimes(4);
    });
  });

  describe("default execFileFn", () => {
    it("uses git-cli.ts's real defaultGitExecFile when execFileFn is not provided", async () => {
      const spy = vi
        .spyOn(gitCliModule, "defaultGitExecFile")
        .mockResolvedValue({ stdout: "abc123\n", stderr: "" });
      const adapter = createGitAdapter({ config: makeConfig(), repoRoot, logEvent: vi.fn() });

      await adapter.worktree.abrir({ casoId: "caso-1", id: "uuid-1" });

      expect(spy).toHaveBeenCalled();
      const [file, args, options] = spy.mock.calls[0]!;
      expect(file).toBe("git");
      expect(args).toEqual(["rev-parse", "HEAD"]);
      expect(options).toEqual({ timeout: 30_000, cwd: repoRoot });

      spy.mockRestore();
    });
  });
});
