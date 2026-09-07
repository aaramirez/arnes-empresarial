import { describe, expect, it, vi } from "vitest";
import { classifyGitFailure, GitCliError, type GitExecFileFn } from "./git-cli.js";

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
