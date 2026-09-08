import { truncateTail } from "../../core/text/truncate-safely.js";
import type { TestRunnerConfig } from "./config.js";
import { TestRunnerCliError, type TestRunFailureReason, type TestRunResult } from "./test-runner-cli.js";

/**
 * Framework-free logic behind the `mcp__worktree__run_tests` MCP tool (Hito
 * 5.1, tarea 23, design.md §6.2). `index.ts` (tarea 24) wraps `handleRunTests`
 * with `createSdkMcpServer`/`tool()`; nothing here imports the MCP SDK — the
 * return shape structurally satisfies `CallToolResult`, same convention as
 * `knowledge-tool.ts`'s `KnowledgeToolTextResult`.
 *
 * CONTRATO NO NEGOCIABLE: `handleRunTests` never throws and never rejects, on
 * any code path — including a synchronous throw from `deps.runTests` (design.md
 * §6.2, molde literal de `handleKnowledgeQuery`). Every failure is translated
 * into a degraded text result instead.
 */

/**
 * `TEST_OUTPUT_MAX_CHARS` es una constante DELIBERADAMENTE separada de
 * `TAREA_DELEGADA_MAX_CHARS` (`src/core/agents/subagents.ts`), no una
 * importación de esa — ambas valen `8_000` hoy, pero son invariantes
 * independientes de dominios distintos: `TAREA_DELEGADA_MAX_CHARS` acota el
 * material que se ensambla para delegar una tarea a un subagente (Hito 2.0,
 * conserva la CABEZA), mientras que este tope acota la salida de `vitest run`
 * que la tool le devuelve al Developer (conserva la COLA, ADR 61 pto 6).
 * design.md §6.2 fija `TEST_OUTPUT_MAX_CHARS` como constante propia de este
 * archivo — no una reexportación — para que ninguno de los dos dominios
 * arrastre al otro si algún día cambian de valor por separado. Mismo criterio
 * de duplicación deliberada, documentada con doc-comment, ya usado en
 * `resolvePositiveNumber` (`git/config.ts`, `test-runner/config.ts`) y en
 * `ResumenPatch` (tarea 18).
 */
export const TEST_OUTPUT_MAX_CHARS = 8_000;

/** Marcador antepuesto cuando la salida se trunca (design.md §6.2, literal). */
export const SALIDA_TRUNCADA_PREFIJO = "[…salida truncada: se conserva el final…]\n";

/**
 * Al REVÉS que `construirTareaDelegada` (que conserva la CABEZA): en
 * `vitest run` el resumen de fallas está al FINAL, así que truncar el final
 * es tirar exactamente lo que el Developer necesita (ADR 61 pto 6).
 *
 * El corte crudo (evitar arrancar en medio de un par surrogate) vive en
 * `truncateTail` (`src/core/text/truncate-safely.ts`, Reviewer finding,
 * reuse) — espejo de `truncateHead` (usado por `board/index.ts` y
 * `knowledge/index.ts`), que corta desde el otro lado. El prefijo de marca
 * y la resta del presupuesto son específicos de este caller, así que quedan
 * acá en vez de mudarse al helper compartido.
 */
export function truncarConservandoCola(salida: string, maxChars = TEST_OUTPUT_MAX_CHARS): string {
  if (salida.length <= maxChars) {
    return salida;
  }
  const presupuesto = maxChars - SALIDA_TRUNCADA_PREFIJO.length; // > 0 por construcción
  return SALIDA_TRUNCADA_PREFIJO + truncateTail(salida, presupuesto);
}

export interface TestRunnerToolTextResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
}

export interface TestRunnerToolDeps {
  /** Correlación (Concepto Transversal 3). El composition root ya lo conoce. */
  readonly casoId: string;
  readonly config: TestRunnerConfig;
  /** Ruta del worktree — nunca el checkout principal. */
  readonly cwd: string;
  readonly runTests: (config: TestRunnerConfig, cwd: string) => Promise<TestRunResult>;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/** Human-readable `motivo` for each `TestRunFailureReason` (design.md §6.2, molde de `describeFailureReason`). */
function describeFailureReason(reason: TestRunFailureReason): string {
  switch (reason) {
    case "not-found":
      return "el binario/entrypoint de vitest no está disponible";
    case "timeout":
      return "la corrida de tests tardó demasiado";
    case "output-too-large":
      return "la salida de la corrida superó el límite de buffer permitido";
    case "unknown":
      return "error desconocido";
  }
}

function toTextResult(text: string): TestRunnerToolTextResult {
  return { content: [{ type: "text", text }] };
}

function degradedResult(reason: TestRunFailureReason): TestRunnerToolTextResult {
  return toTextResult(
    `NO SE PUDIERON CORRER LOS TESTS: ${describeFailureReason(reason)}. Decilo explícitamente en tu resultado en vez de afirmar que pasan.`,
  );
}

/**
 * NUNCA lanza ni rechaza. Toda falla se traduce a texto degradado.
 *
 * `deps.runTests` is invoked inside a `try/catch` (not just a `.catch()` on
 * the returned promise) so a synchronous throw from a misbehaving
 * implementation is caught the same way a rejected promise would be — the
 * case the contract cares about most (design.md §6.2, molde de
 * `handleKnowledgeQuery`).
 *
 * SIN PARÁMETROS: corre TODA la suite. El esquema zod de `index.ts` (tarea 24)
 * es `{}`, así que cualquier argumento que el modelo mande se descarta antes
 * de llegar acá (ADR 61 pto 4).
 */
export async function handleRunTests(deps: TestRunnerToolDeps): Promise<TestRunnerToolTextResult> {
  const { config, cwd, runTests, logEvent } = deps;

  logEvent("test-runner-inicio", { cwd });

  const startedAt = Date.now();
  let resultado: TestRunResult;
  try {
    resultado = await runTests(config, cwd);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const reason: TestRunFailureReason = error instanceof TestRunnerCliError ? error.reason : "unknown";
    logEvent("test-runner-error", { reason, durationMs });
    return degradedResult(reason);
  }

  const { exitCode, output, durationMs } = resultado;
  const salidaTruncada = truncarConservandoCola(output);

  if (exitCode === 0) {
    logEvent("test-runner-verde", { exitCode, durationMs });
    return toTextResult(`TESTS EN VERDE (exit ${exitCode}, ${durationMs} ms).\n\n${salidaTruncada}`);
  }

  logEvent("test-runner-rojo", { exitCode, durationMs });
  return toTextResult(
    `TESTS EN ROJO (exit ${exitCode}, ${durationMs} ms). Arreglá lo que falla antes de dar por terminado tu trabajo.\n\n${salidaTruncada}`,
  );
}
