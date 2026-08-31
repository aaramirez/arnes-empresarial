import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  KNOWLEDGE_MCP_SERVER_NAME,
  KNOWLEDGE_TOOL_NAME,
  type KnowledgeFeedbackPort,
} from "../../core/knowledge/knowledge-contract.js";
import { resolveGraphifyConfig, MCP_TIMEOUT_MARGIN_MS, type GraphifyConfig } from "./config.js";
import { createCitedNodesRecorder } from "./cited-nodes.js";
import {
  defaultExecFile,
  runGraphifyQuery,
  runGraphifySaveResult,
  GraphifyCliError,
  type ExecFileFn,
} from "./graphify-cli.js";
import { handleKnowledgeQuery, type KnowledgeToolDeps, type KnowledgeToolTextResult } from "./knowledge-tool.js";

/**
 * Facade for the knowledge adapter (I2, Hito 2 tarea 7) — the only file in
 * `src/adapters/knowledge/` the composition root (`src/main.ts`) imports.
 * Wires the pure/framework-free pieces built by tareas 2, 4, 5, 6
 * (`config.ts`, `graphify-cli.ts`, `cited-nodes.ts`, `knowledge-tool.ts`)
 * into the two shapes the core actually consumes: `Options["mcpServers"]`
 * (registered by `invokeModel`, tarea 8) and `KnowledgeFeedbackPort`
 * (invoked by `handleTurn` after `closeTurn`, tarea 9).
 *
 * The key design point is a single `CitedNodesRecorder` shared between the
 * MCP tool handler and `feedback`: the tool records what it cited while
 * answering, `feedback.saveTurnResult` drains that same recorder once the
 * turn closes. Nothing else in this module coordinates the two — the shared
 * closure variable *is* the coordination (design.md §3.2).
 */

/**
 * Cap on `answer` length before it goes into `graphify save-result --answer`.
 * Windows' ~32 KB hard limit on total command-line length makes a long
 * answer plus many `--nodes` labels a real (if intermittent) failure mode
 * otherwise — same rationale as `MAX_CITED_NODES` in `cited-nodes.ts`
 * (design.md §3.2).
 */
const MAX_ANSWER_CHARS = 4_000;

/**
 * `tool()`'s handler type expects the SDK's own (mutable) `CallToolResult`
 * shape, while `KnowledgeToolTextResult` (tarea 6) deliberately keeps its
 * fields `readonly` — this repo's convention for framework-free return
 * types. Rebuilding a fresh, plain-mutable literal here is cheaper than
 * loosening that type, and keeps `knowledge-tool.ts` free of any SDK import.
 */
function toCallToolResult(result: KnowledgeToolTextResult): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: result.content[0].text }] };
}

export interface KnowledgeAdapter {
  /** Listo para `HandleTurnDeps.mcpServers` / `options.mcpServers`. */
  readonly mcpServers: NonNullable<Options["mcpServers"]>;
  readonly feedback: KnowledgeFeedbackPort;
}

/**
 * Builds a `KnowledgeAdapter`: an in-process MCP server exposing the
 * `query_knowledge_base` tool, plus the `feedback` port `handleTurn` calls
 * after closing a turn. `config`/`execFileFn` default to the real
 * environment-derived config and the real subprocess runner; tests inject
 * both to avoid ever touching the actual `graphify` binary.
 */
export function createKnowledgeAdapter(deps: {
  readonly casoId: string;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly config?: GraphifyConfig;
  readonly execFileFn?: ExecFileFn;
}): KnowledgeAdapter {
  const config = deps.config ?? resolveGraphifyConfig();
  const execFileFn = deps.execFileFn ?? defaultExecFile;
  const recorder = createCitedNodesRecorder();

  const toolDeps: KnowledgeToolDeps = {
    casoId: deps.casoId,
    config,
    recorder,
    runQuery: (question, queryConfig) => runGraphifyQuery(question, queryConfig, execFileFn),
    logEvent: deps.logEvent,
  };

  const mcpServer = createSdkMcpServer({
    name: KNOWLEDGE_MCP_SERVER_NAME,
    version: "1.0.0",
    timeout: config.queryTimeoutMs + MCP_TIMEOUT_MARGIN_MS,
    tools: [
      tool(
        KNOWLEDGE_TOOL_NAME,
        "Consulta la base de conocimiento interna (vault) de la empresa. Usala siempre " +
          "que la pregunta del empleado involucre políticas, procesos o documentación " +
          "propia de la organización, en vez de responder de memoria. Devuelve los " +
          "resultados citables con su fuente (src) y, cuando exista, su ubicación " +
          "(loc); si no hay coincidencias o la consulta falla, lo indica explícitamente " +
          "en vez de que inventes una respuesta.",
        {
          question: z
            .string()
            .describe(
              "La pregunta a responder, en lenguaje natural, tal como la formuló el empleado.",
            ),
        },
        (args) => handleKnowledgeQuery(args.question, toolDeps).then(toCallToolResult),
      ),
    ],
  });

  const feedback: KnowledgeFeedbackPort = {
    async saveTurnResult(input) {
      // Siempre primero: un turno no puede heredar los nodos del anterior
      // (design.md §3.2, algoritmo exacto de `saveTurnResult`).
      const nodes = recorder.drain();

      if (nodes.length === 0) {
        deps.logEvent("conocimiento-sin-consulta");
        return;
      }

      const answer =
        input.answer.length > MAX_ANSWER_CHARS ? input.answer.slice(0, MAX_ANSWER_CHARS) : input.answer;

      try {
        await runGraphifySaveResult({ question: input.question, answer, nodes }, config, execFileFn);
        deps.logEvent("conocimiento-guardado", { nodes: nodes.length });
      } catch (error) {
        const reason = error instanceof GraphifyCliError ? error.reason : "unknown";
        deps.logEvent("conocimiento-guardado-fallido", { reason });
      }
    },
  };

  return {
    mcpServers: { [KNOWLEDGE_MCP_SERVER_NAME]: mcpServer },
    feedback,
  };
}
