import { describe, expect, it, vi } from "vitest";
import {
  WORKTREE_MCP_SERVER_NAME,
  WORKTREE_TEST_TOOL_NAME,
  WORKTREE_TEST_TOOL_QUALIFIED_NAME,
} from "../../core/agents/worktree-contract.js";
import * as configModule from "./config.js";
import { TEST_MCP_TIMEOUT_MARGIN_MS, type TestRunnerConfig } from "./config.js";
import * as testRunnerCliModule from "./test-runner-cli.js";
import type { TestExecFileFn } from "./test-runner-cli.js";
import { createTestRunnerAdapter } from "./index.js";

/**
 * Test primero (RED confirmado antes de crear `index.ts`, Hito 5.1 tarea 24,
 * ADR 61 pto 3/4/9, design.md §6.2): `TestExecFileFn` fake, mismo molde que
 * `test-runner-cli.test.ts`/`test-runner-tool.test.ts`. Este archivo es la
 * fachada — molde literal de `createKnowledgeAdapter`
 * (`src/adapters/knowledge/index.ts`) y `createGitAdapter`
 * (`src/adapters/git/index.ts`) — así que sus tests prueban que el wiring
 * conecta las piezas reales de `config.ts`/`test-runner-cli.ts`/
 * `test-runner-tool.ts` (tareas 21-23), no re-testear la lógica de esos tres
 * módulos (ya cubierta en sus propios `*.test.ts`).
 */
function makeConfig(overrides: Partial<TestRunnerConfig> = {}): TestRunnerConfig {
  return {
    timeoutMs: 300_000,
    vitestEntrypoint: "/repo/node_modules/vitest/vitest.mjs",
    ...overrides,
  };
}

/**
 * Invoca el handler crudo (SIN pasar por la capa zod del SDK) — mismo truco
 * indocumentado que `invokeKnowledgeTool` (`knowledge/index.test.ts`):
 * `createSdkMcpServer` sólo devuelve el `McpServer` construido, que guarda el
 * handler crudo en `_registeredTools[name].handler`. Suficiente para probar
 * el wiring que hace `createTestRunnerAdapter`; la capa de validación zod del
 * SDK (`@modelcontextprotocol/sdk`) ya tiene su propia cobertura, no se
 * re-testea acá.
 */
function getRegisteredTool(adapter: ReturnType<typeof createTestRunnerAdapter>): {
  readonly handler: (args: unknown, extra: unknown) => Promise<unknown>;
  readonly inputSchema: { readonly safeParse: (data: unknown) => { readonly success: boolean; readonly data?: unknown } };
} {
  const server = adapter.mcpServers[WORKTREE_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly _registeredTools: Record<
        string,
        {
          readonly handler: (args: unknown, extra: unknown) => Promise<unknown>;
          readonly inputSchema: {
            readonly safeParse: (data: unknown) => { readonly success: boolean; readonly data?: unknown };
          };
        }
      >;
    };
  };
  const registeredTool = server.instance._registeredTools[WORKTREE_TEST_TOOL_NAME];
  if (registeredTool === undefined) {
    throw new Error(`test setup error: tool "${WORKTREE_TEST_TOOL_NAME}" was not registered`);
  }
  return registeredTool;
}

describe("createTestRunnerAdapter — mcpServers", () => {
  it("registers the MCP server under the exact WORKTREE_MCP_SERVER_NAME key and name", () => {
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    expect(Object.keys(adapter.mcpServers)).toEqual([WORKTREE_MCP_SERVER_NAME]);
    const server = adapter.mcpServers[WORKTREE_MCP_SERVER_NAME] as unknown as { name: string };
    expect(server.name).toBe(WORKTREE_MCP_SERVER_NAME);
  });

  it("sets the MCP server timeout to config.timeoutMs + TEST_MCP_TIMEOUT_MARGIN_MS", () => {
    const config = makeConfig({ timeoutMs: 12_345 });
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config,
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    const server = adapter.mcpServers[WORKTREE_MCP_SERVER_NAME] as unknown as { timeout: number };
    expect(server.timeout).toBe(12_345 + TEST_MCP_TIMEOUT_MARGIN_MS);
  });

  it("registers exactly one tool, run_tests, whose server+tool name compose WORKTREE_TEST_TOOL_QUALIFIED_NAME", () => {
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    const server = adapter.mcpServers[WORKTREE_MCP_SERVER_NAME] as unknown as {
      readonly name: string;
      readonly instance: { readonly _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual([WORKTREE_TEST_TOOL_NAME]);
    expect(`mcp__${server.name}__${WORKTREE_TEST_TOOL_NAME}`).toBe(WORKTREE_TEST_TOOL_QUALIFIED_NAME);
  });
});

describe("createTestRunnerAdapter — run_tests input schema (esquema zod vacío)", () => {
  it("accepts an arbitrary model-supplied argument at the schema level and strips it before it would reach the handler", () => {
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    const { inputSchema } = getRegisteredTool(adapter);
    const parsed = inputSchema.safeParse({ pattern: "foo.test.ts", filtro: "bar" });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({});
  });
});

describe("createTestRunnerAdapter — run_tests handler wiring", () => {
  it("wires the handler through handleRunTests/runVitest, never forwarding an arbitrary caller argument into the exec argv", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockResolvedValue({ stdout: "1 passed", stderr: "" });
    const config = makeConfig();
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config,
      execFileFn,
    });

    const { handler } = getRegisteredTool(adapter);
    const result = (await handler({ pattern: "foo.test.ts", filtro: "bar" }, {})) as {
      readonly content: readonly [{ readonly type: "text"; readonly text: string }];
    };

    expect(result.content[0].text).toContain("TESTS EN VERDE");
    expect(execFileFn).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileFn.mock.calls[0]!;
    expect(file).toBe(process.execPath);
    expect(args).toEqual([config.vitestEntrypoint, "run", "--reporter=basic"]);
    expect(options).toEqual({ timeout: config.timeoutMs, cwd: "/repo/.harness/worktrees/caso-1-uuid" });
    // ninguno de los argumentos arbitrarios del llamador llega al argv real:
    expect(args).not.toContain("foo.test.ts");
    expect(args).not.toContain("bar");
  });

  it("reports a red run through the same wiring, unaffected by caller-supplied arguments", async () => {
    const execFileFn = vi.fn<TestExecFileFn>().mockRejectedValue({ code: 1, stdout: "1 failed", stderr: "" });
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn,
    });

    const { handler } = getRegisteredTool(adapter);
    const result = (await handler({ archivo: "no-existe.test.ts" }, {})) as {
      readonly content: readonly [{ readonly type: "text"; readonly text: string }];
    };

    expect(result.content[0].text).toContain("TESTS EN ROJO");
  });
});

describe("createTestRunnerAdapter — default config/execFileFn resolution", () => {
  it("resolves config via resolveTestRunnerConfig(process.cwd()) when config is omitted", () => {
    const fakeConfig = makeConfig({ timeoutMs: 42_000 });
    const spy = vi.spyOn(configModule, "resolveTestRunnerConfig").mockReturnValue(fakeConfig);

    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    expect(spy).toHaveBeenCalledWith(process.cwd());
    const server = adapter.mcpServers[WORKTREE_MCP_SERVER_NAME] as unknown as { timeout: number };
    expect(server.timeout).toBe(42_000 + TEST_MCP_TIMEOUT_MARGIN_MS);

    spy.mockRestore();
  });

  it("uses test-runner-cli.ts's real defaultTestExecFile when execFileFn is not provided", async () => {
    const spy = vi
      .spyOn(testRunnerCliModule, "defaultTestExecFile")
      .mockResolvedValue({ stdout: "ok", stderr: "" });
    const config = makeConfig();
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config,
    });

    const { handler } = getRegisteredTool(adapter);
    await handler({}, {});

    expect(spy).toHaveBeenCalled();
    const [file, args, options] = spy.mock.calls[0]!;
    expect(file).toBe(process.execPath);
    expect(args).toEqual([config.vitestEntrypoint, "run", "--reporter=basic"]);
    expect(options).toEqual({ timeout: config.timeoutMs, cwd: "/repo/.harness/worktrees/caso-1-uuid" });

    spy.mockRestore();
  });
});

describe("createTestRunnerAdapter — ADR 61 pto 9 (cero contacto con git/)", () => {
  it("never touches the WorktreePort/git adapter — only casoId/cwd/logEvent/config/execFileFn are accepted", () => {
    const adapter = createTestRunnerAdapter({
      casoId: "caso-1",
      cwd: "/repo/.harness/worktrees/caso-1-uuid",
      logEvent: vi.fn(),
      config: makeConfig(),
      execFileFn: vi.fn() as unknown as TestExecFileFn,
    });

    expect(Object.keys(adapter)).toEqual(["mcpServers"]);
  });
});
