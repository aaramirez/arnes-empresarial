import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TestRunnerConfig } from "./config.js";
import { runVitest, TestRunnerCliError, type TestExecFileFn } from "./test-runner-cli.js";

const CONFIG: TestRunnerConfig = {
  timeoutMs: 300_000,
  vitestEntrypoint: resolve("/repo/node_modules/vitest/vitest.mjs"),
};
const CWD = "/tmp/harness/worktrees/caso-abc";

/**
 * ADR 66's core scenario: a numeric, non-zero `code` on the rejection from
 * `execFile` is NOT routed through `TestRunnerCliError` — it is the NORMAL,
 * successful outcome of "the suite ran and has red tests" (design.md §6.2,
 * ADR 66). This is the opposite of `classifyGitFailure`'s `"exit-code"`
 * branch (git-cli.ts) — the entire point of this module existing separately.
 */
describe("runVitest — ADR 66: non-zero exitCode with stdout is a valid result, not an error", () => {
  it("resolves with exitCode 0 and the merged stdout+stderr when execFileFn resolves (green suite)", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockResolvedValue({
      stdout: "12 passed\n",
      stderr: "",
    });

    const result = await runVitest(CONFIG, CWD, execFileFn);

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("12 passed\n");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with the non-zero exitCode and merged output — the suite ran and has red tests, this is NOT an error", async () => {
    const rawRejection = {
      code: 1,
      killed: false,
      signal: null,
      stdout: "FAIL src/foo.test.ts\n1 failed, 11 passed\n",
      stderr: "some stderr noise\n",
    };
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue(rawRejection);

    const result = await runVitest(CONFIG, CWD, execFileFn);

    expect(result).toEqual({
      exitCode: 1,
      output: "FAIL src/foo.test.ts\n1 failed, 11 passed\nsome stderr noise\n",
      durationMs: expect.any(Number),
    });
  });

  it("merges stdout and stderr in that order (stdout first, stderr second) for a non-zero exitCode", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({
      code: 2,
      stdout: "HEAD",
      stderr: "TAIL",
    });

    const result = await runVitest(CONFIG, CWD, execFileFn);

    expect(result.output).toBe("HEADTAIL");
  });

  it("tolerates a rejection with a numeric code but no stdout/stderr fields", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ code: 1 });

    const result = await runVitest(CONFIG, CWD, execFileFn);

    expect(result).toEqual({ exitCode: 1, output: "", durationMs: expect.any(Number) });
  });
});

describe("runVitest — error classification (ADR 66's decision tree)", () => {
  it("wraps an ENOENT rejection (vitest entrypoint missing) as TestRunnerCliError('not-found')", async () => {
    const rawEnoent = { code: "ENOENT", errno: -2, syscall: "spawn", path: CONFIG.vitestEntrypoint };
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue(rawEnoent);

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(TestRunnerCliError);
    expect((caught as TestRunnerCliError).reason).toBe("not-found");
    expect((caught as TestRunnerCliError).cause).toBe(rawEnoent);
    expect(caught).not.toBe(rawEnoent);
  });

  it("wraps a killed rejection as TestRunnerCliError('timeout')", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ killed: true, signal: "SIGTERM" });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(TestRunnerCliError);
    expect((caught as TestRunnerCliError).reason).toBe("timeout");
  });

  it("wraps a SIGTERM-signal-only rejection (no killed flag) as TestRunnerCliError('timeout')", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ signal: "SIGTERM" });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as TestRunnerCliError).reason).toBe("timeout");
  });

  it("wraps an unrecognized rejection shape as TestRunnerCliError('unknown')", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ message: "boom" });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as TestRunnerCliError).reason).toBe("unknown");
  });

  it("wraps a non-object rejection as TestRunnerCliError('unknown')", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue("boom");

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as TestRunnerCliError).reason).toBe("unknown");
  });

  it("carries a descriptive message built from the reason", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ code: "ENOENT" });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as Error).name).toBe("TestRunnerCliError");
    expect((caught as Error).message).toContain("not-found");
  });

  /**
   * Ordering test #1 (design.md §6.2, ADR 66, literal): ENOENT must be
   * checked BEFORE treating `code` as a numeric exit code, because `code`
   * can be the STRING `"ENOENT"` — `typeof "ENOENT" === "number"` is false,
   * so this would already fall through correctly, but the branch order in
   * the implementation must still put the ENOENT check first (a regression
   * that swaps the order would only be caught by a case where BOTH the
   * ENOENT and killed/numeric checks could plausibly match — this test and
   * the next pin the required order explicitly).
   */
  it("classifies ENOENT as not-found even though a numeric-exit-code branch also exists in the classifier", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({
      code: "ENOENT",
      killed: false,
      signal: null,
      stdout: "",
      stderr: "",
    });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as TestRunnerCliError).reason).toBe("not-found");
  });

  /**
   * Ordering test #2: a process killed by timeout ALSO carries a numeric
   * `code` in some Node versions/platforms — `killed`/`SIGTERM` must be
   * checked BEFORE the numeric-code branch, or a timeout would be
   * misreported as a successful (if red) test run.
   */
  it("classifies a killed process as timeout even though it also carries a numeric code", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({
      code: 1,
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    });

    let caught: unknown;
    await runVitest(CONFIG, CWD, execFileFn).catch((error: unknown) => {
      caught = error;
    });

    expect((caught as TestRunnerCliError).reason).toBe("timeout");
  });
});

describe("runVitest — argv and cwd construction", () => {
  it("calls execFileFn with argv [vitestEntrypoint, 'run', '--reporter=basic'] and the given cwd/timeout", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });

    await runVitest(CONFIG, CWD, execFileFn);

    expect(execFileFn).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileFn.mock.calls[0]!;
    expect(args).toEqual([CONFIG.vitestEntrypoint, "run", "--reporter=basic"]);
    expect(options).toEqual({ timeout: CONFIG.timeoutMs, cwd: CWD });
    // ADR 61 / R6: never `npm` anywhere — neither as the file nor inside argv.
    expect(file).not.toBe("npm");
    expect(file).not.toMatch(/npm/i);
    expect(args).not.toContain("npm");
  });

  it("never contains the literal string 'npm' anywhere in the call, across several cwd/config values", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
    const otherConfig: TestRunnerConfig = {
      timeoutMs: 60_000,
      vitestEntrypoint: resolve("/otro/repo/node_modules/vitest/vitest.mjs"),
    };

    await runVitest(CONFIG, CWD, execFileFn);
    await runVitest(otherConfig, "/tmp/harness/worktrees/caso-xyz", execFileFn);

    for (const call of execFileFn.mock.calls) {
      const [file, args] = call;
      expect(file).not.toBe("npm");
      expect(JSON.stringify(args)).not.toMatch(/\bnpm\b/i);
    }
  });

  it("uses the worktree's own cwd, not a hardcoded/default one", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });

    await runVitest(CONFIG, "/tmp/harness/worktrees/caso-unico", execFileFn);

    const [, , options] = execFileFn.mock.calls[0]!;
    expect(options.cwd).toBe("/tmp/harness/worktrees/caso-unico");
  });
});
