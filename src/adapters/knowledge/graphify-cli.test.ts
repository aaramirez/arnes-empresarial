import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { GraphifyConfig } from "./config.js";
import { SAVE_RESULT_TIMEOUT_MS } from "./config.js";
import {
  buildQueryArgs,
  buildSaveResultArgs,
  defaultExecFile,
  GraphifyCliError,
  runGraphifyQuery,
  runGraphifySaveResult,
  type ExecFileFn,
} from "./graphify-cli.js";

/**
 * Whether the real `graphify` binary is reachable in this environment.
 * Checked once at module load (synchronously, `it.skipIf` needs the boolean
 * up front) so the one test below that exercises the *real* CLI —
 * deliberately not mocked, see that test's own doc comment for why a mock
 * cannot catch an argv-shape regression like the `--` one this file
 * regression-tests above — degrades to a skip instead of a hard failure on
 * a machine/CI without `graphify` installed.
 */
function isGraphifyBinaryAvailable(): boolean {
  try {
    execFileSync("graphify", ["--version"], { windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const GRAPHIFY_AVAILABLE = isGraphifyBinaryAvailable();

function makeConfig(overrides: Partial<GraphifyConfig> = {}): GraphifyConfig {
  return {
    bin: "graphify",
    graphPath: "graphify-out/graph.json",
    budget: 200,
    queryTimeoutMs: 15_000,
    ...overrides,
  };
}

describe("buildQueryArgs", () => {
  it("builds argv with the question and interpolated graphPath/budget", () => {
    const config = makeConfig({ graphPath: "graphify-out/graph.json", budget: 200 });

    expect(buildQueryArgs("¿Cuál es la política de vacaciones?", config)).toEqual([
      "query",
      "¿Cuál es la política de vacaciones?",
      "--graph",
      "graphify-out/graph.json",
      "--budget",
      "200",
    ]);
  });

  it("interpolates a different graphPath and budget from config", () => {
    const config = makeConfig({ graphPath: "custom/other-graph.json", budget: 500 });

    expect(buildQueryArgs("otra pregunta", config)).toEqual([
      "query",
      "otra pregunta",
      "--graph",
      "custom/other-graph.json",
      "--budget",
      "500",
    ]);
  });

  /**
   * Regression guard for a code-review finding that was itself wrong: an
   * earlier revision of `buildQueryArgs` inserted a `--` end-of-options
   * separator before `question`, reasoning that a leading-dash question
   * could otherwise be misread as a flag. Verified against the real
   * `graphify` binary (`graphify --version` → 0.8.44, not a mock — see
   * `buildQueryArgs`'s own doc comment for the exact commands run): `query`
   * does not support `--` at all, and adding it broke every real query
   * ("No matching nodes found." on a question that returns results without
   * it), while a leading-dash question is already handled correctly with no
   * `--` needed. This test locks in the correct (no `--`) shape so that
   * "theoretical" argv-safety fix cannot silently return.
   */
  it("never inserts a -- separator, and puts the question as the first positional argument right after 'query' (graphify 0.8.44 has no -- support)", () => {
    const config = makeConfig();
    const question = "-y esto que convencion de commits usa";

    const args = buildQueryArgs(question, config);

    expect(args).not.toContain("--");
    expect(args[0]).toBe("query");
    expect(args[1]).toBe(question);
  });
});

describe("buildSaveResultArgs", () => {
  it("builds argv with question, answer, and multiple nodes", () => {
    const argv = buildSaveResultArgs({
      question: "¿Cuál es la política de vacaciones?",
      answer: "Según el manual, ...",
      nodes: ["Política de Vacaciones", "Manual del Empleado"],
    });

    expect(argv).toEqual([
      "save-result",
      "--question",
      "¿Cuál es la política de vacaciones?",
      "--answer",
      "Según el manual, ...",
      "--nodes",
      "Política de Vacaciones",
      "Manual del Empleado",
    ]);
  });

  it("omits --nodes values but keeps the flag when nodes is empty", () => {
    const argv = buildSaveResultArgs({
      question: "pregunta",
      answer: "respuesta",
      nodes: [],
    });

    expect(argv).toEqual(["save-result", "--question", "pregunta", "--answer", "respuesta", "--nodes"]);
  });
});

describe("runGraphifyQuery", () => {
  it("invokes execFileFn with config.bin, the query argv, and config.queryTimeoutMs as timeout", async () => {
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: "NODE foo", stderr: "" });
    const config = makeConfig({ bin: "/opt/graphify", queryTimeoutMs: 12_345 });

    const stdout = await runGraphifyQuery("pregunta", config, execFileFn);

    expect(stdout).toBe("NODE foo");
    expect(execFileFn).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileFn.mock.calls[0]!;
    expect(file).toBe("/opt/graphify");
    expect(args).toEqual(buildQueryArgs("pregunta", config));
    expect(options).toEqual({ timeout: 12_345 });
  });

  it.each([
    ["ENOENT code", { code: "ENOENT" }, "not-found"],
    ["killed flag", { killed: true }, "timeout"],
    ["SIGTERM signal", { signal: "SIGTERM" }, "timeout"],
    ["non-zero exit code", { code: 1 }, "exit-code"],
    ["unrecognized shape", { message: "boom" }, "unknown"],
  ] as const)("classifies a rejection with %s as reason %s", async (_label, rawError, expectedReason) => {
    const execFileFn = vi.fn<ExecFileFn>().mockRejectedValue(rawError);
    const config = makeConfig();

    const promise = runGraphifyQuery("pregunta", config, execFileFn);

    await expect(promise).rejects.toBeInstanceOf(GraphifyCliError);
    await promise.catch((error: GraphifyCliError) => {
      expect(error.reason).toBe(expectedReason);
      expect(error.cause).toBe(rawError);
    });
  });

  it("never passes shell: true to execFileFn", async () => {
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
    const config = makeConfig();

    await runGraphifyQuery("pregunta", config, execFileFn);

    const [, , options] = execFileFn.mock.calls[0]!;
    expect(options).not.toHaveProperty("shell");
  });

  /**
   * Real-CLI integration guard, deliberately NOT mocked: a mocked
   * `execFileFn` (every other test in this file) can only ever confirm that
   * `runGraphifyQuery` calls `execFileFn` with the argv `buildQueryArgs`
   * built — it cannot tell whether `graphify` itself accepts that exact
   * argv shape. That gap is exactly how the `--` regression this file
   * regression-tests above shipped once already (every mocked test passed
   * with `--` in the argv; only running the real binary caught that it broke
   * every query). This test runs `runGraphifyQuery` with `defaultExecFile`
   * against the real `graphify-out/graph.json` in this repo, using a
   * leading-dash question — the exact case the retired `--`-separator fix
   * was meant to protect — and asserts real results come back, not the
   * "No matching nodes found." failure mode `--` produced.
   *
   * Skips (rather than fails) when `graphify` is not on PATH — e.g. a CI
   * runner without the binary installed.
   */
  it.skipIf(!GRAPHIFY_AVAILABLE)(
    "[real graphify binary] returns real results for a leading-dash question, with no -- in the argv",
    async () => {
      const config: GraphifyConfig = {
        bin: "graphify",
        graphPath: "graphify-out/graph.json",
        budget: 200,
        queryTimeoutMs: 15_000,
      };

      const stdout = await runGraphifyQuery(
        "-y esto que convencion de commits usa",
        config,
        defaultExecFile,
      );

      expect(stdout).not.toContain("No matching nodes found.");
      expect(stdout).toContain("NODE");
    },
    20_000,
  );
});

describe("runGraphifySaveResult", () => {
  it("invokes execFileFn with config.bin, the save-result argv, and SAVE_RESULT_TIMEOUT_MS as timeout (not queryTimeoutMs)", async () => {
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
    const config = makeConfig({ bin: "/opt/graphify", queryTimeoutMs: 99_999 });
    const input = { question: "q", answer: "a", nodes: ["N1", "N2"] };

    await runGraphifySaveResult(input, config, execFileFn);

    expect(execFileFn).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileFn.mock.calls[0]!;
    expect(file).toBe("/opt/graphify");
    expect(args).toEqual(buildSaveResultArgs(input));
    expect(options).toEqual({ timeout: SAVE_RESULT_TIMEOUT_MS });
  });

  it.each([
    ["ENOENT code", { code: "ENOENT" }, "not-found"],
    ["killed flag", { killed: true }, "timeout"],
    ["SIGTERM signal", { signal: "SIGTERM" }, "timeout"],
    ["non-zero exit code", { code: 1 }, "exit-code"],
    ["unrecognized shape", { message: "boom" }, "unknown"],
  ] as const)("classifies a rejection with %s as reason %s", async (_label, rawError, expectedReason) => {
    const execFileFn = vi.fn<ExecFileFn>().mockRejectedValue(rawError);
    const config = makeConfig();

    const promise = runGraphifySaveResult({ question: "q", answer: "a", nodes: [] }, config, execFileFn);

    await expect(promise).rejects.toBeInstanceOf(GraphifyCliError);
    await promise.catch((error: GraphifyCliError) => {
      expect(error.reason).toBe(expectedReason);
      expect(error.cause).toBe(rawError);
    });
  });

  it("never passes shell: true to execFileFn", async () => {
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: "", stderr: "" });
    const config = makeConfig();

    await runGraphifySaveResult({ question: "q", answer: "a", nodes: [] }, config, execFileFn);

    const [, , options] = execFileFn.mock.calls[0]!;
    expect(options).not.toHaveProperty("shell");
  });

  it("resolves even when execFileFn throws synchronously instead of rejecting", async () => {
    const execFileFn = vi.fn(() => {
      throw { code: "ENOENT" };
    }) as unknown as ExecFileFn;
    const config = makeConfig();

    await expect(
      runGraphifySaveResult({ question: "q", answer: "a", nodes: [] }, config, execFileFn),
    ).rejects.toBeInstanceOf(GraphifyCliError);
  });
});
