import { describe, expect, it, vi } from "vitest";
import type { GraphifyConfig } from "./config.js";
import { SAVE_RESULT_TIMEOUT_MS } from "./config.js";
import {
  buildQueryArgs,
  buildSaveResultArgs,
  GraphifyCliError,
  runGraphifyQuery,
  runGraphifySaveResult,
  type ExecFileFn,
} from "./graphify-cli.js";

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
