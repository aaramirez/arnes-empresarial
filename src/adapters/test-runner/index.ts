import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import {
  WORKTREE_MCP_SERVER_NAME,
  WORKTREE_TEST_TOOL_NAME,
} from "../../core/agents/worktree-contract.js";
import { resolveTestRunnerConfig, TEST_MCP_TIMEOUT_MARGIN_MS, type TestRunnerConfig } from "./config.js";
import { defaultTestExecFile, runVitest, type TestExecFileFn } from "./test-runner-cli.js";
import { handleRunTests, type TestRunnerToolDeps, type TestRunnerToolTextResult } from "./test-runner-tool.js";

/**
 * Facade for the test-runner adapter (Hito 5.1, tarea 24, ADR 61 pto 3/4/9,
 * design.md §6.2) — molde literal de `createGitAdapter`
 * (`src/adapters/git/index.ts`) y `createKnowledgeAdapter`
 * (`src/adapters/knowledge/index.ts`). Wires the three pieces built by
 * tareas 21-23 (`config.ts`, `test-runner-cli.ts`, `test-runner-tool.ts`)
 * into a single in-process MCP server exposing exactly one tool,
 * `mcp__worktree__run_tests` — no other shape (no `feedback` port, unlike
 * `createKnowledgeAdapter`: this adapter has nothing to report back after a
 * turn closes).
 *
 * ADR 61 pto 9 — CERO CONTACTO con `src/adapters/git/`: this file, and every
 * file it imports transitively (`config.ts`/`test-runner-cli.ts`/
 * `test-runner-tool.ts`), never imports anything from `../git/`. The
 * composition root (`build-on-activity.ts`) is the only place that knows
 * about both adapters — it passes `worktree.ruta` (opened by the git
 * adapter) as this facade's `cwd`, exactly the boundary `AGENTS.md` protects.
 */
function toCallToolResult(result: TestRunnerToolTextResult): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: result.content[0].text }] };
}

export interface TestRunnerAdapter {
  /** Listo para `options.mcpServers` (registrado junto al de `worktree.abrir`'s Developer, ADR 67). */
  readonly mcpServers: NonNullable<Options["mcpServers"]>;
}

/**
 * Builds a `TestRunnerAdapter`: an in-process MCP server named
 * `WORKTREE_MCP_SERVER_NAME` ("worktree") exposing a single tool,
 * `WORKTREE_TEST_TOOL_NAME` ("run_tests"), whose qualified name
 * (`mcp__worktree__run_tests`) is exactly `WORKTREE_TEST_TOOL_QUALIFIED_NAME`
 * (`src/core/agents/worktree-contract.ts`) — the literal string
 * `construirDeveloperConEscritura` (tarea 26) grants in `allowedTools`.
 *
 * `config` defaults to `resolveTestRunnerConfig(process.cwd())` when
 * omitted: unlike `createGitAdapter`, this facade takes no `repoRoot`
 * parameter of its own (`deps.cwd` is the WORKTREE path, wired straight into
 * `execFile`'s `cwd` — it is never where `vitestEntrypoint` should resolve
 * from). `process.cwd()` is the same repo-root assumption the composition
 * root already makes explicit for `createGitAdapter` (design.md §6.1: `—
 * | repoRoot | process.cwd()`); this facade just makes that same call
 * itself, since its own signature — `{casoId, cwd, logEvent, config?,
 * execFileFn?}` (design.md §6.2, literal) — has no room for a separate
 * `repoRoot` field. `execFileFn` defaults to the real subprocess runner
 * (`defaultTestExecFile`); tests inject their own fake to avoid ever
 * touching the actual `vitest` binary.
 */
export function createTestRunnerAdapter(deps: {
  readonly casoId: string;
  /** Ruta ABSOLUTA del worktree — nunca el checkout principal. */
  readonly cwd: string;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly config?: TestRunnerConfig;
  readonly execFileFn?: TestExecFileFn;
}): TestRunnerAdapter {
  const config = deps.config ?? resolveTestRunnerConfig(process.cwd());
  const execFileFn = deps.execFileFn ?? defaultTestExecFile;

  const toolDeps: TestRunnerToolDeps = {
    casoId: deps.casoId,
    config,
    cwd: deps.cwd,
    runTests: (runConfig, runCwd) => runVitest(runConfig, runCwd, execFileFn),
    logEvent: deps.logEvent,
  };

  const mcpServer = createSdkMcpServer({
    name: WORKTREE_MCP_SERVER_NAME,
    version: "1.0.0",
    timeout: config.timeoutMs + TEST_MCP_TIMEOUT_MARGIN_MS,
    tools: [
      tool(
        WORKTREE_TEST_TOOL_NAME,
        "Corre la suite de tests completa (`vitest run`) dentro del worktree aislado del Developer. " +
          "No acepta ningún parámetro: no se puede filtrar por archivo, patrón ni test individual — " +
          "siempre corre TODA la suite. Devuelve el resultado real (verde o rojo) con la salida de " +
          "vitest; si la corrida no se pudo ejecutar, lo indica explícitamente en vez de afirmar que " +
          "los tests pasan.",
        {},
        // SIN PARÁMETROS a propósito (ADR 61 pto 4): el callback ignora
        // cualquier argumento que reciba — el esquema zod vacío ya lo
        // descarta antes de llegar acá, y aunque no lo hiciera, esta función
        // ni siquiera lo mira. Molde literal de design.md §6.2.
        () => handleRunTests(toolDeps).then(toCallToolResult),
      ),
    ],
  });

  return { mcpServers: { [WORKTREE_MCP_SERVER_NAME]: mcpServer } };
}
