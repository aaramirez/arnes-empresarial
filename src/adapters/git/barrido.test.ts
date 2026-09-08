import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WORKTREE_RAMA_PREFIJO } from "../../core/agents/worktree-contract.js";
import { barrerHuerfanos, type BarridoRunnerDeps, type StatFn } from "./barrido.js";
import type { GitExecFileFn } from "./git-cli.js";

/**
 * Test primero (RED confirmado antes de crear `barrido.ts`): `GitExecFileFn`
 * fake, mismo molde que `worktree.test.ts`/`git-cli.test.ts`, más un
 * `StatFn` fake inyectado (design.md §6.1) — el algoritmo mide mtime, y el
 * test necesita fijar mtimes viejos/recientes sin tocar el filesystem real.
 * Ningún test de este archivo invoca `git` de verdad (esa es la categoría
 * separada de las tareas 10-11).
 */
describe("barrido.ts", () => {
  type LogEventFn = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

  const repoRoot = resolve("C:/repo");
  const worktreeRoot = ".harness/worktrees";
  const worktreeRootAbsoluto = resolve(repoRoot, worktreeRoot);
  const ttlMs = 7_200_000;
  const ahoraMs = 1_700_000_000_000;

  function porcelainRecord(ruta: string, rama?: string): string {
    const branchLine = rama === undefined ? "detached" : `branch refs/heads/${rama}`;
    return `worktree ${ruta}\nHEAD abcd1234abcd1234abcd1234abcd1234abcd1234\n${branchLine}`;
  }

  function porcelain(...records: readonly string[]): string {
    return records.length === 0 ? "" : `${records.join("\n\n")}\n`;
  }

  function makeDeps(overrides: Partial<BarridoRunnerDeps> = {}): {
    readonly deps: BarridoRunnerDeps;
    readonly execFileFn: ReturnType<typeof vi.fn<GitExecFileFn>>;
    readonly statFn: ReturnType<typeof vi.fn<StatFn>>;
    readonly logEvent: ReturnType<typeof vi.fn<LogEventFn>>;
  } {
    const execFileFn = vi.fn<GitExecFileFn>();
    const statFn = vi.fn<StatFn>();
    const logEvent = vi.fn<LogEventFn>();
    const deps: BarridoRunnerDeps = {
      repoRoot,
      worktreeRoot,
      bin: "git",
      timeoutMs: 30_000,
      execFileFn,
      statFn,
      logEvent,
      ...overrides,
    };
    return { deps, execFileFn, statFn, logEvent };
  }

  describe("doble filtro", () => {
    it("no toca un candidato cuya ruta está fuera de .harness/worktrees/ aunque su rama tenga el prefijo correcto", async () => {
      const rutaFuera = join(resolve(repoRoot, "otra-carpeta"), "caso-1-abc");
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(rutaFuera, rama)), stderr: "" });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 0, borrados: 0, fallidos: 0 });
      expect(statFn).not.toHaveBeenCalled();
      expect(execFileFn).toHaveBeenCalledTimes(2); // list + prune, sin remove/branch -D
    });

    it("no toca un candidato cuya ruta es un directorio HERMANO con prefijo compartido (.harness/worktrees-manual/), aunque su rama tenga el prefijo correcto", async () => {
      // Bug real (code-review post tarea 11): un `startsWith` sin boundary check
      // matchea ".harness/worktrees-manual/..." contra la raíz ".harness/worktrees"
      // por coincidencia textual del PREFIJO, aunque el hermano esté FUERA de la
      // raíz real del doble filtro.
      const rutaHermana = `${worktreeRootAbsoluto.replaceAll("\\", "/")}-manual/caso-1-abc`;
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(rutaHermana, rama)), stderr: "" });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 0, borrados: 0, fallidos: 0 });
      expect(statFn).not.toHaveBeenCalled();
      expect(execFileFn).toHaveBeenCalledTimes(2); // list + prune, sin remove/branch -D
    });

    it("normaliza separadores antes de comparar: matchea un candidato cuya ruta viene con '/' literales de git aunque el root resuelto use '\\\\' (Windows)", async () => {
      // Regresión del hallazgo de la tarea 11: `git worktree list --porcelain`
      // siempre reporta con '/', incluso en Windows. Se fabrica la ruta candidata
      // forzando '/' (como la salida real de git), sin pasar por join()/resolve()
      // (que en Windows normalizarían a '\\' y ocultarían el bug).
      const rutaConSlash = `${worktreeRootAbsoluto.replaceAll("\\", "/")}/caso-1-abc`;
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(rutaConSlash, rama)), stderr: "" });
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - 1_000 }); // dentro del TTL
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 1, borrados: 0, fallidos: 0 });
      expect(statFn).toHaveBeenCalledWith(rutaConSlash);
    });

    it("no toca un candidato bajo .harness/worktrees/ cuya rama no tiene el prefijo correcto", async () => {
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, "main")), stderr: "" });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 0, borrados: 0, fallidos: 0 });
      expect(statFn).not.toHaveBeenCalled();
      expect(execFileFn).toHaveBeenCalledTimes(2);
    });

    it("no toca un worktree detached (sin rama) aunque su ruta esté bajo .harness/worktrees/", async () => {
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, undefined)), stderr: "" });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 0, borrados: 0, fallidos: 0 });
      expect(statFn).not.toHaveBeenCalled();
    });
  });

  describe("TTL", () => {
    it("borra un candidato con mtime más viejo que el TTL: worktree remove --force seguido de branch -D", async () => {
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, rama)), stderr: "" }); // list
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - ttlMs - 1 }); // más viejo que el TTL
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // branch -D
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 1, borrados: 1, fallidos: 0 });
      expect(execFileFn).toHaveBeenNthCalledWith(2, "git", ["worktree", "remove", "--force", ruta], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(execFileFn).toHaveBeenNthCalledWith(3, "git", ["branch", "-D", rama], {
        timeout: 30_000,
        cwd: repoRoot,
      });
    });

    it("deja intacto un candidato con mtime dentro del TTL: ni worktree remove ni branch -D", async () => {
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, rama)), stderr: "" }); // list
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - 1_000 }); // muy reciente
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 1, borrados: 0, fallidos: 0 });
      expect(execFileFn).toHaveBeenCalledTimes(2); // list + prune únicamente
    });
  });

  describe("resiliencia", () => {
    it("un stat que falla en un candidato no aborta el resto del barrido", async () => {
      const rutaFallida = join(worktreeRootAbsoluto, "caso-1-abc");
      const ramaFallida = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const rutaOk = join(worktreeRootAbsoluto, "caso-2-def");
      const ramaOk = `${WORKTREE_RAMA_PREFIJO}caso-2-def`;
      const { deps, execFileFn, statFn, logEvent } = makeDeps();
      execFileFn.mockResolvedValueOnce({
        stdout: porcelain(porcelainRecord(rutaFallida, ramaFallida), porcelainRecord(rutaOk, ramaOk)),
        stderr: "",
      }); // list
      statFn.mockRejectedValueOnce(new Error("ENOENT: no such file or directory"));
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - ttlMs - 1 });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove (candidato 2)
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // branch -D (candidato 2)
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 2, borrados: 1, fallidos: 1 });
      expect(execFileFn).toHaveBeenNthCalledWith(2, "git", ["worktree", "remove", "--force", rutaOk], {
        timeout: 30_000,
        cwd: repoRoot,
      });
      expect(logEvent).toHaveBeenCalledWith("worktree-barrido-ok", expect.objectContaining(resumen));
    });

    it("cuenta como borrado (no fallido) un candidato cuyo worktree remove tuvo éxito pero branch -D falló, y registra la rama huérfana con su nombre", async () => {
      // Code review (Hito 5.1, code-review hito completo): mismo bug de clase
      // que cerrarWorktree — antes del fix, este caso caía al `catch` genérico
      // del loop y se contaba como `fallidos`, aunque el worktree SÍ se borró
      // del disco (telemetría engañosa), y la rama huérfana quedaba sin
      // nombre en ningún evento, invisible para siempre a barridos futuros.
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn, logEvent } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, rama)), stderr: "" }); // list
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - ttlMs - 1 }); // más viejo que el TTL
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // worktree remove: éxito
      execFileFn.mockRejectedValueOnce({ code: 128 }); // branch -D: falla
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 1, borrados: 1, fallidos: 0 });
      expect(logEvent).toHaveBeenCalledWith(
        "worktree-barrido-rama-huerfana",
        expect.objectContaining({ ruta, rama, reason: "exit-code" }),
      );
    });

    it("un fallo de git al listar los worktrees devuelve {0,0,0} sin rechazar y degrada a worktree-barrido-fallido", async () => {
      const { deps, execFileFn, statFn, logEvent } = makeDeps();
      execFileFn.mockRejectedValueOnce({ code: "ENOENT" }); // git worktree list --porcelain

      await expect(barrerHuerfanos({ ttlMs, ahoraMs }, deps)).resolves.toEqual({
        examinados: 0,
        borrados: 0,
        fallidos: 0,
      });

      expect(execFileFn).toHaveBeenCalledTimes(1); // nunca llega a stat ni a prune
      expect(statFn).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith("worktree-barrido-fallido", expect.objectContaining({ message: expect.any(String) }));
      expect(logEvent).not.toHaveBeenCalledWith("worktree-barrido-ok", expect.anything());
    });

    it("un fallo de git worktree prune no rechaza, devuelve el resumen ya calculado y degrada a worktree-barrido-fallido", async () => {
      const { deps, execFileFn, logEvent } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(), stderr: "" }); // list vacío
      execFileFn.mockRejectedValueOnce({ code: 128 }); // worktree prune falla

      await expect(barrerHuerfanos({ ttlMs, ahoraMs }, deps)).resolves.toEqual({
        examinados: 0,
        borrados: 0,
        fallidos: 0,
      });

      expect(logEvent).toHaveBeenCalledWith("worktree-barrido-fallido", expect.objectContaining({ message: expect.any(String) }));
      expect(logEvent).not.toHaveBeenCalledWith("worktree-barrido-ok", expect.anything());
    });
  });

  describe("evento de éxito", () => {
    it("registra worktree-barrido-ok con examinados, borrados, fallidos y ttlMs en una corrida limpia", async () => {
      const ruta = join(worktreeRootAbsoluto, "caso-1-abc");
      const rama = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const { deps, execFileFn, statFn, logEvent } = makeDeps();
      execFileFn.mockResolvedValueOnce({ stdout: porcelain(porcelainRecord(ruta, rama)), stderr: "" });
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - 1_000 });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(logEvent).toHaveBeenCalledWith("worktree-barrido-ok", { examinados: 1, borrados: 0, fallidos: 0, ttlMs });
    });
  });

  describe("parseo de git worktree list --porcelain", () => {
    it("parsea múltiples registros separados por línea en blanco y sólo procesa los que pasan el doble filtro", async () => {
      const rutaCandidata = join(worktreeRootAbsoluto, "caso-1-abc");
      const ramaCandidata = `${WORKTREE_RAMA_PREFIJO}caso-1-abc`;
      const rutaPrincipal = repoRoot;
      const { deps, execFileFn, statFn } = makeDeps();
      execFileFn.mockResolvedValueOnce({
        stdout: porcelain(porcelainRecord(rutaPrincipal, "main"), porcelainRecord(rutaCandidata, ramaCandidata)),
        stderr: "",
      });
      statFn.mockResolvedValueOnce({ mtimeMs: ahoraMs - 1_000 });
      execFileFn.mockResolvedValueOnce({ stdout: "", stderr: "" }); // prune

      const resumen = await barrerHuerfanos({ ttlMs, ahoraMs }, deps);

      expect(resumen).toEqual({ examinados: 1, borrados: 0, fallidos: 0 });
      expect(statFn).toHaveBeenCalledTimes(1);
      expect(statFn).toHaveBeenCalledWith(rutaCandidata);
    });
  });
});
