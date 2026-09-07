import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGitExecFile } from "../../adapters/git/git-cli.js";
import { abrirWorktree, cerrarWorktree, type WorktreeRunnerDeps } from "../../adapters/git/worktree.js";
import { barrerHuerfanos, type BarridoRunnerDeps, type StatFn } from "../../adapters/git/barrido.js";

/**
 * Integration test for `barrerHuerfanos` (Hito 5.1, tarea 11) against the
 * REAL `git` binary — segunda mitad de la categoría "integración contra
 * `git` real" (design.md §10.C / §11), mismo `skip` que
 * `worktree.integration.test.ts` (tarea 10). Unlike `barrido.test.ts`/
 * `index.test.ts` (unit, `GitExecFileFn` fake — `index.test.ts` incluso usa
 * el `StatFn` real, pero SIEMPRE con porcelain fabricado a mano), acá
 * `deps.execFileFn` es `defaultGitExecFile` y las rutas que el doble filtro
 * compara vienen de la salida REAL de `git worktree list --porcelain`.
 *
 * Hallazgo real de este archivo (RED→GREEN, documentado en `barrido.ts`):
 * en Windows, `git worktree list --porcelain` reporta rutas con `/` sin
 * importar el SO, mientras que `resolve()` de Node en Windows devuelve `\`.
 * Sin normalizar, el doble filtro de `esCandidato` (`registro.ruta.startsWith(worktreeRootAbsoluto)`)
 * nunca matchea contra la salida real de `git` en Windows — ningún test
 * unitario anterior podía detectarlo porque fabrican su propio porcelain
 * con el mismo separador que la comparación. Este archivo es, por
 * construcción, el primero que ejercita esa comparación con dos strings de
 * origen distinto (`git` real vs `resolve()`), y por eso es el que la
 * expone. Fix aplicado en `barrido.ts`: `normalizarSeparadores` (no-op en
 * POSIX).
 *
 * Cubre spec `escritura-aislada-worktree`, requirement "Barrido de
 * huérfanos al arranque, con TTL configurable, no bloqueante": los tres
 * escenarios ("Un worktree viejo se borra al arrancar", "Un worktree
 * reciente no se toca", "Un fallo de `git` durante el barrido no tumba el
 * arranque" — acá provocado apuntando `bin` a un binario inexistente, en vez
 * de al `git worktree prune` específico del GIVEN del spec, que ya cubre
 * `barrido.test.ts` a nivel unitario). RD-14.
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

/** Real `StatFn` — mismo wiring que `defaultStatFn` de `index.ts`, pero acá inyectado a mano porque el test ejercita `barrerHuerfanos` directamente, no a través de la fachada. */
const realStatFn: StatFn = async (ruta) => {
  const stats = await stat(ruta);
  return { mtimeMs: stats.mtimeMs };
};

describe.skipIf(!GIT_AVAILABLE)("barrido.ts (integration against real git)", () => {
  let repoRoot: string;
  let worktreeDeps: WorktreeRunnerDeps;
  let logEvent: ReturnType<typeof vi.fn<LogEventFn>>;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "barrido-integration-"));
    runGit(["init"], repoRoot);
    runGit(["config", "user.email", "barrido-integration@example.com"], repoRoot);
    runGit(["config", "user.name", "Barrido Integration Test"], repoRoot);
    runGit(["config", "core.autocrlf", "false"], repoRoot);
    await writeFile(join(repoRoot, "README.md"), "repo temporal de integracion\n", "utf8");
    runGit(["add", "."], repoRoot);
    runGit(["commit", "-m", "initial"], repoRoot);

    logEvent = vi.fn<LogEventFn>();
    worktreeDeps = {
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

  it("borra un worktree real viejo (mtime forzado al pasado) y deja intacto uno reciente", async () => {
    const viejo = await abrirWorktree({ casoId: "caso-viejo", id: "1" }, worktreeDeps);
    const reciente = await abrirWorktree({ casoId: "caso-reciente", id: "2" }, worktreeDeps);

    const ttlMs = 60_000;
    const pastDate = new Date(Date.now() - ttlMs - 60_000);
    await utimes(viejo.ruta, pastDate, pastDate);

    const barridoDeps: BarridoRunnerDeps = {
      repoRoot,
      worktreeRoot: ".harness/worktrees",
      bin: "git",
      timeoutMs: 30_000,
      execFileFn: defaultGitExecFile,
      statFn: realStatFn,
      logEvent,
    };

    const resumen = await barrerHuerfanos({ ttlMs, ahoraMs: Date.now() }, barridoDeps);

    expect(resumen).toEqual({ examinados: 2, borrados: 1, fallidos: 0 });
    expect(logEvent).toHaveBeenCalledWith(
      "worktree-barrido-ok",
      expect.objectContaining({ examinados: 2, borrados: 1, fallidos: 0 }),
    );

    // El worktree viejo desapareció del disco y su rama fue borrada.
    await expect(stat(viejo.ruta)).rejects.toThrow();
    const ramaViejaListada = runGit(["branch", "--list", viejo.rama], repoRoot).trim();
    expect(ramaViejaListada).toBe("");

    // El worktree reciente sigue intacto: en disco y listado por git.
    const dirRecienteStat = await stat(reciente.ruta);
    expect(dirRecienteStat.isDirectory()).toBe(true);
    const listado = runGit(["worktree", "list", "--porcelain"], repoRoot);
    expect(listado).toContain(reciente.rama);

    await cerrarWorktree(reciente, worktreeDeps);
  });

  it("con git apuntado a un binario inexistente, el barrido devuelve un resumen degradado en vez de tirar", async () => {
    const binInexistente = resolve(repoRoot, "bin-inexistente", "git");
    const barridoDeps: BarridoRunnerDeps = {
      repoRoot,
      worktreeRoot: ".harness/worktrees",
      bin: binInexistente,
      timeoutMs: 30_000,
      execFileFn: defaultGitExecFile,
      statFn: realStatFn,
      logEvent,
    };

    await expect(barrerHuerfanos({ ttlMs: 60_000, ahoraMs: Date.now() }, barridoDeps)).resolves.toEqual({
      examinados: 0,
      borrados: 0,
      fallidos: 0,
    });

    expect(logEvent).toHaveBeenCalledWith(
      "worktree-barrido-fallido",
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(logEvent).not.toHaveBeenCalledWith("worktree-barrido-ok", expect.anything());
  });
});
