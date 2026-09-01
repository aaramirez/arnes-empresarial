import { describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_MCP_SERVER_NAME,
  KNOWLEDGE_TOOL_NAME,
} from "../../core/knowledge/knowledge-contract.js";
import { MCP_TIMEOUT_MARGIN_MS, SAVE_RESULT_TIMEOUT_MS, type GraphifyConfig } from "./config.js";
import type { ExecFileFn } from "./graphify-cli.js";
import { createKnowledgeAdapter } from "./index.js";

function makeConfig(overrides: Partial<GraphifyConfig> = {}): GraphifyConfig {
  return {
    bin: "graphify",
    graphPath: "graphify-out/graph.json",
    budget: 200,
    queryTimeoutMs: 15_000,
    ...overrides,
  };
}

/**
 * Invokes the real `query_knowledge_base` tool handler, bypassing the MCP
 * wire protocol. `tool()` (from the installed `@anthropic-ai/claude-agent-sdk`)
 * exposes the handler directly on the `SdkMcpToolDefinition` it returns, but
 * `createSdkMcpServer` only hands back the built `McpServer` instance, not
 * that definition — the instance stores it in `_registeredTools[name].handler`
 * (confirmed at runtime against the installed SDK version; verified by
 * calling `tool()` and `createSdkMcpServer()` directly in a scratch script
 * before writing this test). This is an undocumented internal of the
 * installed SDK, used narrowly and deliberately here: it is the only way to
 * drive the shared recorder through the *real* wiring `createKnowledgeAdapter`
 * assembles, instead of re-testing `handleKnowledgeQuery`'s own branch logic
 * — that is already fully covered by `knowledge-tool.test.ts` (tarea 6) and
 * is not duplicated here. If a future SDK bump removes `_registeredTools`,
 * this helper (and only this helper) needs updating.
 */
async function invokeKnowledgeTool(
  adapter: ReturnType<typeof createKnowledgeAdapter>,
  question: string,
): Promise<void> {
  const server = adapter.mcpServers[KNOWLEDGE_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly _registeredTools: Record<
        string,
        { readonly handler: (args: unknown, extra: unknown) => Promise<unknown> }
      >;
    };
  };
  const registeredTool = server.instance._registeredTools[KNOWLEDGE_TOOL_NAME];
  if (registeredTool === undefined) {
    throw new Error(`test setup error: tool "${KNOWLEDGE_TOOL_NAME}" was not registered`);
  }
  await registeredTool.handler({ question }, {});
}

const CITED_STDOUT = [
  "NODE Política de Vacaciones [src=docs/politicas.md loc=L10 community=1]",
  "NODE Manual del Empleado [src=docs/manual.md loc=L20 community=1]",
].join("\n");

describe("createKnowledgeAdapter — mcpServers", () => {
  it("registers the MCP server under the exact KNOWLEDGE_MCP_SERVER_NAME key and name", () => {
    const adapter = createKnowledgeAdapter({
      casoId: "caso-1",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn: vi.fn() as unknown as ExecFileFn,
    });

    expect(Object.keys(adapter.mcpServers)).toEqual([KNOWLEDGE_MCP_SERVER_NAME]);
    const server = adapter.mcpServers[KNOWLEDGE_MCP_SERVER_NAME] as unknown as { name: string };
    expect(server.name).toBe(KNOWLEDGE_MCP_SERVER_NAME);
  });

  it("sets the MCP server timeout to config.queryTimeoutMs + MCP_TIMEOUT_MARGIN_MS", () => {
    const config = makeConfig({ queryTimeoutMs: 12_345 });
    const adapter = createKnowledgeAdapter({
      casoId: "caso-1",
      logEvent: vi.fn(),
      config,
      execFileFn: vi.fn() as unknown as ExecFileFn,
    });

    const server = adapter.mcpServers[KNOWLEDGE_MCP_SERVER_NAME] as unknown as { timeout: number };
    expect(server.timeout).toBe(12_345 + MCP_TIMEOUT_MARGIN_MS);
  });
});

describe("createKnowledgeAdapter — feedback.saveTurnResult", () => {
  it("does not call execFileFn when the recorder is empty (the tool was never invoked this turn)", async () => {
    const execFileFn = vi.fn<ExecFileFn>();
    const logEvent = vi.fn();
    const adapter = createKnowledgeAdapter({
      casoId: "caso-1",
      logEvent,
      config: makeConfig(),
      execFileFn,
    });

    await adapter.feedback.saveTurnResult({ casoId: "caso-1", question: "hola", answer: "buenas" });

    expect(execFileFn).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith("conocimiento-sin-consulta");
  });

  it("drains the shared recorder and calls the CLI with the expected save-result argv when the tool cited nodes", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: CITED_STDOUT, stderr: "" });
    const logEvent = vi.fn();
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent, config, execFileFn });

    await invokeKnowledgeTool(adapter, "¿Cuál es la política de vacaciones?");
    execFileFn.mockClear();
    execFileFn.mockResolvedValue({ stdout: "", stderr: "" });

    await adapter.feedback.saveTurnResult({
      casoId: "caso-1",
      question: "¿Cuál es la política de vacaciones?",
      answer: "Según el manual, el empleado tiene derecho a...",
    });

    expect(execFileFn).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileFn.mock.calls[0]!;
    expect(file).toBe(config.bin);
    expect(args).toEqual([
      "save-result",
      "--question",
      "¿Cuál es la política de vacaciones?",
      "--answer",
      "Según el manual, el empleado tiene derecho a...",
      "--nodes",
      "Política de Vacaciones",
      "Manual del Empleado",
    ]);
    expect(options).toEqual({ timeout: SAVE_RESULT_TIMEOUT_MS });
    expect(logEvent).toHaveBeenCalledWith("conocimiento-guardado", { nodes: 2 });
  });

  it("truncates a long answer to MAX_ANSWER_CHARS (4000) before it reaches the save-result argv", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: CITED_STDOUT, stderr: "" });
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent: vi.fn(), config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta");
    execFileFn.mockClear();
    execFileFn.mockResolvedValue({ stdout: "", stderr: "" });

    const longAnswer = "a".repeat(5_000);
    await adapter.feedback.saveTurnResult({ casoId: "caso-1", question: "pregunta", answer: longAnswer });

    const [, args] = execFileFn.mock.calls[0]!;
    const answerIndex = args.indexOf("--answer") + 1;
    expect(args[answerIndex]).toHaveLength(4_000);
    expect(args[answerIndex]).toBe("a".repeat(4_000));
  });

  it("truncates safely across a surrogate-pair boundary, never leaving a lone surrogate in the argv", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: CITED_STDOUT, stderr: "" });
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent: vi.fn(), config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta");
    execFileFn.mockClear();
    execFileFn.mockResolvedValue({ stdout: "", stderr: "" });

    // MAX_ANSWER_CHARS is 4000. Build a string of length 4001 whose emoji
    // (a surrogate pair, 2 UTF-16 code units) straddles the cut boundary: the
    // emoji's high surrogate lands exactly at index 3999 (the last index a
    // plain `slice(0, 4000)` would keep), so a naive slice would keep the
    // high surrogate but drop its low surrogate, leaving a lone surrogate.
    const longAnswer = `${"a".repeat(3_999)}😀`;
    expect(longAnswer.length).toBe(4_001);

    await adapter.feedback.saveTurnResult({ casoId: "caso-1", question: "pregunta", answer: longAnswer });

    const [, args] = execFileFn.mock.calls[0]!;
    const answerIndex = args.indexOf("--answer") + 1;
    const truncated = args[answerIndex] as string;

    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(truncated).not.toMatch(LONE_SURROGATE);
  });

  it("resolves even when the CLI rejects, and logs conocimiento-guardado-fallido with the classified reason", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>();
    execFileFn.mockResolvedValueOnce({ stdout: CITED_STDOUT, stderr: "" }); // the tool's `query` call
    execFileFn.mockRejectedValueOnce({ code: 1 }); // the `save-result` call
    const logEvent = vi.fn();
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent, config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta");

    await expect(
      adapter.feedback.saveTurnResult({ casoId: "caso-1", question: "pregunta", answer: "respuesta" }),
    ).resolves.toBeUndefined();

    const failedCall = logEvent.mock.calls.find((call) => call[0] === "conocimiento-guardado-fallido");
    expect(failedCall).toBeDefined();
    expect(failedCall![1]).toEqual({ reason: "exit-code" });
  });

  it("drains the recorder even when the save fails, so a later saveTurnResult sees it empty", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>();
    execFileFn.mockResolvedValueOnce({ stdout: CITED_STDOUT, stderr: "" }); // query
    execFileFn.mockRejectedValueOnce({ code: 1 }); // first save-result fails
    const logEvent = vi.fn();
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent, config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta");
    await adapter.feedback.saveTurnResult({ casoId: "caso-1", question: "pregunta", answer: "respuesta" });

    logEvent.mockClear();
    execFileFn.mockClear();

    await adapter.feedback.saveTurnResult({
      casoId: "caso-1",
      question: "otra pregunta",
      answer: "otra respuesta",
    });

    expect(execFileFn).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith("conocimiento-sin-consulta");
  });
});

describe("createKnowledgeAdapter — feedback.discardPendingCitations", () => {
  it("drains the shared recorder without ever invoking execFileFn (never persists to graphify)", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: CITED_STDOUT, stderr: "" });
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent: vi.fn(), config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta");
    execFileFn.mockClear();

    adapter.feedback.discardPendingCitations();

    expect(execFileFn).not.toHaveBeenCalled();
  });

  it("leaves the recorder empty for the next saveTurnResult call, same as a normal drain", async () => {
    const config = makeConfig();
    const execFileFn = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: CITED_STDOUT, stderr: "" });
    const logEvent = vi.fn();
    const adapter = createKnowledgeAdapter({ casoId: "caso-1", logEvent, config, execFileFn });

    await invokeKnowledgeTool(adapter, "pregunta que falló");
    adapter.feedback.discardPendingCitations();

    execFileFn.mockClear();
    logEvent.mockClear();

    await adapter.feedback.saveTurnResult({
      casoId: "caso-1",
      question: "siguiente pregunta",
      answer: "siguiente respuesta",
    });

    expect(execFileFn).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith("conocimiento-sin-consulta");
  });
});
