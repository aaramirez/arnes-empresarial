import type { GraphifyConfig } from "./config.js";
import { type CitedNodesRecorder, parseNodeLabels } from "./cited-nodes.js";
import { GraphifyCliError, type GraphifyFailureReason } from "./graphify-cli.js";

/**
 * Framework-free logic behind the `query_knowledge_base` MCP tool (Hito 2,
 * tarea 6). `index.ts` (tarea 7) wraps `handleKnowledgeQuery` with
 * `createSdkMcpServer`/`tool()`; nothing here imports the MCP SDK — the
 * return shape structurally satisfies `CallToolResult` (design.md ADR 3.1).
 *
 * CONTRATO NO NEGOCIABLE: `handleKnowledgeQuery` never throws and never
 * rejects, on any code path — including a synchronous throw from
 * `deps.runQuery` (design.md §7, "tres eslabones"). Every failure is
 * translated into a degraded text result instead.
 */

export interface KnowledgeToolTextResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
}

export interface KnowledgeToolDeps {
  /** Correlación (Concepto Transversal 3). El composition root ya lo conoce. */
  readonly casoId: string;
  readonly config: GraphifyConfig;
  readonly recorder: CitedNodesRecorder;
  readonly runQuery: (question: string, config: GraphifyConfig) => Promise<string>;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

const CITE_INSTRUCTION =
  "INSTRUCCIÓN: respondé usando solo estos resultados del vault y CITÁ la fuente (src, y loc cuando exista) de cada dato que uses. Si no alcanzan para responder, decilo.";

const NO_RESULTS_TEXT =
  "SIN RESULTADOS: la base de conocimiento no devolvió coincidencias. Decíselo al empleado en vez de inventar una respuesta.";

/** Human-readable `motivo` for each `GraphifyFailureReason` (design.md §3.2, "<motivo legible>"). */
function describeFailureReason(reason: GraphifyFailureReason): string {
  switch (reason) {
    case "not-found":
      return "el binario de consulta no está disponible";
    case "timeout":
      return "la consulta tardó demasiado";
    case "exit-code":
      return "la consulta falló";
    case "unknown":
      return "error desconocido";
  }
}

function toTextResult(text: string): KnowledgeToolTextResult {
  return { content: [{ type: "text", text }] };
}

function degradedResult(reason: GraphifyFailureReason): KnowledgeToolTextResult {
  return toTextResult(
    `NO HAY CONOCIMIENTO DISPONIBLE: ${describeFailureReason(reason)}. Respondé con lo que tengas de la conversación y aclará explícitamente que no pudiste consultar la base de conocimiento.`,
  );
}

/**
 * NUNCA lanza ni rechaza. Toda falla se traduce a texto degradado.
 *
 * `deps.runQuery` is invoked inside a `try/catch` (not just a `.catch()` on
 * the returned promise) so a synchronous throw from a misbehaving
 * implementation is caught the same way a rejected promise would be — the
 * case the contract cares about most (design.md §10).
 */
export async function handleKnowledgeQuery(
  question: string,
  deps: KnowledgeToolDeps,
): Promise<KnowledgeToolTextResult> {
  const { config, recorder, runQuery, logEvent } = deps;

  logEvent("conocimiento-consulta-inicio", { questionLength: question.length });

  const startedAt = Date.now();
  let stdout: string;
  try {
    stdout = await runQuery(question, config);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const reason: GraphifyFailureReason = error instanceof GraphifyCliError ? error.reason : "unknown";
    logEvent("conocimiento-consulta-error", { reason, durationMs });
    return degradedResult(reason);
  }
  const durationMs = Date.now() - startedAt;

  const labels = parseNodeLabels(stdout);
  if (labels.length === 0) {
    logEvent("conocimiento-consulta-vacia", { durationMs });
    return toTextResult(NO_RESULTS_TEXT);
  }

  recorder.record(labels);
  logEvent("conocimiento-consulta-ok", { durationMs, nodes: labels.length });
  return toTextResult(`${CITE_INSTRUCTION}\n\n${stdout}`);
}
