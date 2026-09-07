import { describe, expect, it, vi } from "vitest";
import {
  buildApplyArgs,
  buildApplyCheckArgs,
  buildBranchDeleteArgs,
  buildDiffArgs,
  buildIntentToAddArgs,
  buildRevParseHeadArgs,
  buildWorktreeAddArgs,
  buildWorktreeListArgs,
  buildWorktreePruneArgs,
  buildWorktreeRemoveArgs,
  classifyGitFailure,
  CONSTRUCTORES_ARGV,
  GitCliError,
  SUBCOMANDOS_PERMITIDOS,
  type GitExecFileFn,
} from "./git-cli.js";

describe("classifyGitFailure", () => {
  it.each([
    ["ENOENT code", { code: "ENOENT" }, "not-found"],
    ["killed flag", { killed: true }, "timeout"],
    ["SIGTERM signal", { signal: "SIGTERM" }, "timeout"],
    ["non-zero numeric exit code", { code: 1 }, "exit-code"],
    ["zero exit code (not a failure code, falls through)", { code: 0 }, "unknown"],
    ["unrecognized shape", { message: "boom" }, "unknown"],
  ] as const)("classifies a rejection with %s as reason %s", (_label, rawError, expectedReason) => {
    expect(classifyGitFailure(rawError)).toBe(expectedReason);
  });

  it.each([
    ["a string", "boom"],
    ["undefined", undefined],
    ["null", null],
  ] as const)("returns unknown for a non-object error (%s)", (_label, rawError) => {
    expect(classifyGitFailure(rawError)).toBe("unknown");
  });
});

describe("GitCliError", () => {
  it("carries the classified reason, the original cause, and a descriptive message", () => {
    const rawError = { code: "ENOENT" };

    const error = new GitCliError(classifyGitFailure(rawError), "rev-parse", rawError);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GitCliError");
    expect(error.reason).toBe("not-found");
    expect(error.cause).toBe(rawError);
    expect(error.message).toBe("git rev-parse failed: not-found");
  });

  it("carries a different reason/command pair for an exit-code failure", () => {
    const rawError = { code: 128 };

    const error = new GitCliError(classifyGitFailure(rawError), "worktree add", rawError);

    expect(error.reason).toBe("exit-code");
    expect(error.message).toBe("git worktree add failed: exit-code");
  });
});

/**
 * Fixture: `GitExecFileFn` fake, same mold as `graphify-cli.test.ts`. There is
 * no `run`-style wrapper in `git-cli.ts` yet (that lives in `worktree.ts`,
 * §6.1 parte 2 / tarea 7) — these tests drive the exact boundary-crossing
 * sequence a future caller performs: invoke the injected runner, catch its
 * rejection, classify it, and wrap it in `GitCliError`. This is what makes
 * spec `escritura-aislada-worktree`'s scenario "Un fallo de `git` no
 * encontrado se clasifica, no se propaga crudo" true at this layer already.
 */
describe("boundary crossing with a fake GitExecFileFn", () => {
  it("classifies a fake 'git not on PATH' rejection as not-found without leaking the native error", async () => {
    const rawEnoent = { code: "ENOENT", errno: -2, syscall: "spawn git", path: "git" };
    const execFileFn = vi.fn<GitExecFileFn>().mockRejectedValue(rawEnoent);

    let caught: unknown;
    try {
      await execFileFn("git", ["rev-parse", "HEAD"], { timeout: 30_000, cwd: "/tmp/repo" });
    } catch (error) {
      caught = new GitCliError(classifyGitFailure(error), "rev-parse", error);
    }

    expect(execFileFn).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], {
      timeout: 30_000,
      cwd: "/tmp/repo",
    });
    expect(caught).toBeInstanceOf(GitCliError);
    expect((caught as GitCliError).reason).toBe("not-found");
    expect((caught as GitCliError).cause).toBe(rawEnoent);
    expect(caught).not.toBe(rawEnoent);
  });

  it("classifies a fake killed process (timeout) rejection as timeout", async () => {
    const rawKilled = { killed: true, signal: "SIGTERM" };
    const execFileFn = vi.fn<GitExecFileFn>().mockRejectedValue(rawKilled);

    let caught: unknown;
    try {
      await execFileFn("git", ["diff", "--binary"], { timeout: 5_000, cwd: "/tmp/repo" });
    } catch (error) {
      caught = new GitCliError(classifyGitFailure(error), "diff", error);
    }

    expect(caught).toBeInstanceOf(GitCliError);
    expect((caught as GitCliError).reason).toBe("timeout");
  });
});

/**
 * Test primero (RED confirmado antes de agregar los constructores a
 * git-cli.ts): sin fixture, puro — itera `CONSTRUCTORES_ARGV`, design.md
 * §6.1 parte 2 / §10.A. Es el test que hace la prohibición de AGENTS.md
 * línea 78 ("ningún agente corre `git commit` ni `git push` por su cuenta")
 * verificable a nivel de código: el SUBCOMANDO ejecutado (`argv[0]`) nunca
 * puede ser `commit`/`push`/`remote`/`tag`, ni siquiera cuando el llamador
 * pasa esas mismas palabras (o un intento de inyección de flag/shell) como
 * argumento — porque no hay parámetro que escriba en la posición 0 (ADR 62).
 *
 * Invariante verificado: es POSICIONAL — `argv[0] ∈ SUBCOMANDOS_PERMITIDOS`
 * — nunca "ningún elemento del array completo". Resuelto por checkpoint
 * humano (tarea 4 de `tasks.md`, Hito 5.1): que un valor del llamador
 * (`rama`/`ruta`/`rutaPatch`) coincida literalmente con una palabra
 * prohibida en una posición >= 1 del argv NO es una vulnerabilidad — `git`
 * ya fijó qué subcomando ejecuta leyendo únicamente la posición 0 antes de
 * interpretar el resto del argv, así que ese string nunca se interpreta
 * como subcomando. Por eso los constructores no sanitizan ni rechazan
 * `rama`/`ruta`/`rutaPatch` — no hace falta más garantía que la que se
 * verifica abajo (posición 0, para los diez constructores × las cinco
 * entradas adversariales).
 */
describe("CONSTRUCTORES_ARGV", () => {
  const SUBCOMANDOS_PROHIBIDOS = ["commit", "push", "remote", "tag"] as const;

  /**
   * Entradas adversariales fijadas por design.md §10.A. Se prueban contra
   * TODOS los constructores, sin importar la aridad real de cada uno: los
   * de aridad 0 simplemente ignoran los argumentos extra (comportamiento
   * estándar de JS), los de aridad 1 usan solo el primero, y
   * `buildWorktreeAddArgs` usa los dos que necesita.
   */
  const ENTRADAS_ADVERSARIALES = ["commit", "push", "--exec=x", "; rm -rf /", "--upload-pack=x"] as const;

  /**
   * Los tres únicos que sí pueden probarse contra el array COMPLETO de
   * argv sin chocar con el bloqueo de arriba: ninguno de estos tres
   * strings es igual, literal, a una palabra de `SUBCOMANDOS_PROHIBIDOS`
   * — así que si aparecieran en el argv devuelto, seguirían sin
   * "ser" `commit`/`push`/`remote`/`tag`.
   */
  const ENTRADAS_ADVERSARIALES_SIN_COLISION = ["--exec=x", "; rm -rf /", "--upload-pack=x"] as const;

  it("expone exactamente diez constructores", () => {
    expect(CONSTRUCTORES_ARGV).toHaveLength(10);
  });

  it("SUBCOMANDOS_PERMITIDOS es la lista cerrada fijada por design.md §6.1", () => {
    expect(SUBCOMANDOS_PERMITIDOS).toEqual(["rev-parse", "worktree", "add", "diff", "branch", "apply"]);
  });

  it.each(CONSTRUCTORES_ARGV.map((constructor, indice) => [indice, constructor] as const))(
    "constructor #%i: argv[0] esta en SUBCOMANDOS_PERMITIDOS con entradas normales",
    (_indice, constructor) => {
      const argv = (constructor as (...args: readonly string[]) => readonly string[])(
        "harness/caso-abc",
        "/tmp/harness/worktrees/caso-abc",
      );

      expect(argv.length).toBeGreaterThan(0);
      expect(SUBCOMANDOS_PERMITIDOS).toContain(argv[0]);
    },
  );

  for (const entrada of ENTRADAS_ADVERSARIALES) {
    it.each(CONSTRUCTORES_ARGV.map((constructor, indice) => [indice, constructor] as const))(
      `constructor #%i: argv[0] (el subcomando ejecutado) esta en SUBCOMANDOS_PERMITIDOS con entrada adversarial ${JSON.stringify(entrada)}`,
      (_indice, constructor) => {
        const argv = (constructor as (...args: readonly string[]) => readonly string[])(entrada, entrada);

        expect(argv.length).toBeGreaterThan(0);
        expect(SUBCOMANDOS_PERMITIDOS).toContain(argv[0]);
      },
    );
  }

  for (const entrada of ENTRADAS_ADVERSARIALES_SIN_COLISION) {
    it.each(CONSTRUCTORES_ARGV.map((constructor, indice) => [indice, constructor] as const))(
      `constructor #%i: ningun elemento del argv es commit/push/remote/tag con entrada adversarial ${JSON.stringify(entrada)}`,
      (_indice, constructor) => {
        const argv = (constructor as (...args: readonly string[]) => readonly string[])(entrada, entrada);

        for (const elemento of argv) {
          expect(SUBCOMANDOS_PROHIBIDOS).not.toContain(elemento);
        }
      },
    );
  }
});

describe("named argv builders", () => {
  it("buildRevParseHeadArgs returns the fixed rev-parse HEAD argv", () => {
    expect(buildRevParseHeadArgs()).toEqual(["rev-parse", "HEAD"]);
  });

  it("buildWorktreeAddArgs places the caller-controlled branch/path only at positions >= 1", () => {
    expect(buildWorktreeAddArgs("harness/caso-x", "/tmp/wt")).toEqual([
      "worktree",
      "add",
      "-b",
      "harness/caso-x",
      "/tmp/wt",
      "HEAD",
    ]);
  });

  it("buildIntentToAddArgs returns the fixed add --intent-to-add --all argv", () => {
    expect(buildIntentToAddArgs()).toEqual(["add", "--intent-to-add", "--all"]);
  });

  it("buildDiffArgs returns the fixed diff argv", () => {
    expect(buildDiffArgs()).toEqual(["diff", "--binary", "--no-color", "--no-ext-diff"]);
  });

  it("buildWorktreeRemoveArgs places the caller-controlled path only at the last position", () => {
    expect(buildWorktreeRemoveArgs("/tmp/wt")).toEqual(["worktree", "remove", "--force", "/tmp/wt"]);
  });

  it("buildBranchDeleteArgs places the caller-controlled branch only at the last position", () => {
    expect(buildBranchDeleteArgs("harness/caso-x")).toEqual(["branch", "-D", "harness/caso-x"]);
  });

  it("buildWorktreeListArgs returns the fixed worktree list argv", () => {
    expect(buildWorktreeListArgs()).toEqual(["worktree", "list", "--porcelain"]);
  });

  it("buildWorktreePruneArgs returns the fixed worktree prune argv", () => {
    expect(buildWorktreePruneArgs()).toEqual(["worktree", "prune"]);
  });

  it("buildApplyCheckArgs places the caller-controlled patch path only at the last position", () => {
    expect(buildApplyCheckArgs("/tmp/patch.diff")).toEqual([
      "apply",
      "--check",
      "--whitespace=nowarn",
      "/tmp/patch.diff",
    ]);
  });

  it("buildApplyArgs places the caller-controlled patch path only at the last position", () => {
    expect(buildApplyArgs("/tmp/patch.diff")).toEqual(["apply", "--whitespace=nowarn", "/tmp/patch.diff"]);
  });
});
