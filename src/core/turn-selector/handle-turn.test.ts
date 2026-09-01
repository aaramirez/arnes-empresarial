import { describe, expect, it, vi } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "../agents/definitions.js";
import { DEFAULT_AGENT_MODEL } from "../agents/definitions.js";
import { createHookEngine } from "../hooks/hook-engine.js";
import type { KnowledgeFeedbackPort } from "../knowledge/knowledge-contract.js";
import { TurnFailedError } from "./turn-error.js";
import { handleTurn, CASO_ESTADO_ACTIVO, type MemoryPort } from "./handle-turn.js";
import type { QueryFn } from "./invoke-model.js";
import type { LogTurnEventDeps } from "../logging/turn-logger.js";

/**
 * Fake `queryFn` fixtures, same shape `invoke-model.test.ts` already
 * establishes for `SDKMessage`. `handleTurn` forwards `HandleTurnDeps.queryFn`
 * as-is to `invokeModel`'s own injectable `queryFn` parameter (see
 * `handle-turn.ts`'s module doc), so these tests inject a typed fake instead
 * of mocking the `@anthropic-ai/claude-agent-sdk` module itself — keeping
 * this test file consistent with every other DI-based test in this hito.
 */
function fakeSystemInitMessage(sessionId: string): SDKMessage {
  return { type: "system", subtype: "init", session_id: sessionId } as unknown as SDKMessage;
}

function fakeResultSuccessMessage(resultText: string, sessionId: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result: resultText,
    is_error: false,
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function fakeQueryFn(messages: readonly SDKMessage[], onCalled?: () => void) {
  return vi.fn(async function* (_params: { readonly prompt: string; readonly options?: Options }) {
    onCalled?.();
    for (const message of messages) {
      yield message;
    }
  }) satisfies QueryFn;
}

function throwingQueryFn(error: unknown) {
  return vi.fn(async function* (
    _params: { readonly prompt: string; readonly options?: Options },
  ): AsyncGenerator<SDKMessage> {
    throw error;
    // eslint-disable-next-line no-unreachable
    yield fakeSystemInitMessage("unreachable");
  }) satisfies QueryFn;
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agente-conversacional",
    systemPrompt: "system prompt",
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
    ...overrides,
  };
}

function makeCasoRow(casoId: string) {
  return {
    id: casoId,
    tipo: "conversacion",
    estado: CASO_ESTADO_ACTIVO,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

/**
 * `handleTurn`'s own `logDeps` default (`turn-logger.ts`'s
 * `DEFAULT_LOG_TURN_EVENT_DEPS`) writes to a real file
 * (`data/harness.log`) — every test below injects this fake instead, both
 * to assert on logged content and, just as importantly, so this file never
 * touches the real filesystem on a plain `npm test` run (same reasoning
 * `fakeQueryFn`/`throwingQueryFn` already apply to avoid a real network
 * call).
 */
function fakeLogDeps(): { readonly deps: LogTurnEventDeps; readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      now: () => "2026-08-29T00:00:00.000Z",
      write: (line) => {
        lines.push(line);
      },
    },
  };
}

/**
 * Fake `KnowledgeFeedbackPort` fixture. `callOrder` (when passed) lets tests
 * assert `saveTurnResult` fires strictly after `closeTurn`'s own writes
 * (`updateCaso`/`createSesionAgente`), matching tarea 9's "después de
 * `closeTurn` y fuera de `runTurnStage`" requirement.
 */
function fakeKnowledgeFeedback(
  callOrder?: string[],
): { readonly port: KnowledgeFeedbackPort; readonly calls: Array<{ casoId: string; question: string; answer: string }> } {
  const calls: Array<{ casoId: string; question: string; answer: string }> = [];
  return {
    calls,
    port: {
      saveTurnResult: vi.fn(async (input) => {
        callOrder?.push("saveTurnResult");
        calls.push({ ...input });
      }),
    },
  };
}

describe("handleTurn", () => {

  it("runs context -> model -> close in order, then returns responseText/agentLabel", async () => {
    const callOrder: string[] = [];
    const casoId = "caso-1";
    const agent = makeAgent();

    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => {
        callOrder.push("getCasoById");
        return makeCasoRow(id);
      }),
      getLatestSesionAgente: vi.fn(() => {
        callOrder.push("getLatestSesionAgente");
        return undefined;
      }),
      updateCaso: vi.fn(() => {
        callOrder.push("updateCaso");
      }),
      createSesionAgente: vi.fn(() => {
        callOrder.push("createSesionAgente");
      }),
    };

    const queryFn = fakeQueryFn(
      [
        fakeSystemInitMessage("sdk-session-1"),
        fakeResultSuccessMessage("hola, ¿en qué te ayudo?", "sdk-session-1"),
      ],
      () => callOrder.push("query"),
    );

    const hooks = createHookEngine();
    const log = fakeLogDeps();

    const result = await handleTurn(casoId, "hola", {
      memory,
      hooks,
      candidateAgents: [agent],
      queryFn,
      logDeps: log.deps,
    });

    expect(callOrder).toEqual([
      "getCasoById",
      "getLatestSesionAgente",
      "query",
      "updateCaso",
      "createSesionAgente",
    ]);
    expect(result).toEqual({
      responseText: "hola, ¿en qué te ayudo?",
      agentLabel: "agente-conversacional",
    });

    // Success path must also log via logTurnEvent (tarea 12) — the module
    // doc says this fires unconditionally, not only on the failure path
    // already covered by the "turno-fallido" test below.
    expect(log.lines).toHaveLength(1);
    const line = log.lines[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      casoId: "caso-1",
      event: "turno-completado",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
    });
  });

  it("propagates a context-stage failure as TurnFailedError with stage 'context'", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn(() => undefined), // no caso -> CasoNotResolvedError
      getLatestSesionAgente: vi.fn(),
      updateCaso: vi.fn(),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();

    await expect(
      handleTurn("caso-inexistente", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        logDeps: fakeLogDeps().deps,
      }),
    ).rejects.toMatchObject({ name: "TurnFailedError", stage: "context" });
  });

  it("propagates a model-stage failure as TurnFailedError with stage 'model'", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();
    const boom = new Error("network boom");
    const queryFn = throwingQueryFn(boom);

    await expect(
      handleTurn("caso-1", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        queryFn,
        logDeps: fakeLogDeps().deps,
      }),
    ).rejects.toMatchObject({ name: "TurnFailedError", stage: "model", cause: boom });
  });

  it("propagates a close-stage failure as TurnFailedError with stage 'close'", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(() => {
        throw new Error("fallo de escritura simulado");
      }),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-close-fail"),
      fakeResultSuccessMessage("respuesta", "sdk-session-close-fail"),
    ]);

    await expect(
      handleTurn("caso-1", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        queryFn,
        logDeps: fakeLogDeps().deps,
      }),
    ).rejects.toMatchObject({ name: "TurnFailedError", stage: "close" });
  });

  it("logs a 'turno-fallido' event (via logTurnEvent) before re-throwing on failure", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn(() => undefined),
      getLatestSesionAgente: vi.fn(),
      updateCaso: vi.fn(),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();
    const log = fakeLogDeps();

    await expect(
      handleTurn("caso-1", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        logDeps: log.deps,
      }),
    ).rejects.toBeInstanceOf(TurnFailedError);

    expect(log.lines).toHaveLength(1);
    const line = log.lines[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      casoId: "caso-1",
      event: "turno-fallido",
      stage: "context",
    });
  });

  it("calls knowledgeFeedback.saveTurnResult after closeTurn with question=prompt and answer=responseText", async () => {
    const callOrder: string[] = [];
    const casoId = "caso-1";
    const agent = makeAgent();

    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(() => {
        callOrder.push("updateCaso");
      }),
      createSesionAgente: vi.fn(() => {
        callOrder.push("createSesionAgente");
      }),
    };

    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-feedback"),
      fakeResultSuccessMessage("respuesta con cita", "sdk-session-feedback"),
    ]);

    const hooks = createHookEngine();
    const log = fakeLogDeps();
    const knowledgeFeedback = fakeKnowledgeFeedback(callOrder);

    const result = await handleTurn(casoId, "¿cuál es la política?", {
      memory,
      hooks,
      candidateAgents: [agent],
      queryFn,
      logDeps: log.deps,
      knowledgeFeedback: knowledgeFeedback.port,
    });

    // closeTurn's own writes (updateCaso/createSesionAgente) must precede
    // saveTurnResult — tarea 9 requires the call to happen "después de
    // closeTurn y fuera de runTurnStage".
    expect(callOrder.indexOf("saveTurnResult")).toBeGreaterThan(callOrder.indexOf("updateCaso"));
    expect(callOrder.indexOf("saveTurnResult")).toBeGreaterThan(callOrder.indexOf("createSesionAgente"));

    expect(knowledgeFeedback.calls).toEqual([
      { casoId: "caso-1", question: "¿cuál es la política?", answer: "respuesta con cita" },
    ]);
    expect(result.responseText).toBe("respuesta con cita");
  });

  it("omitting knowledgeFeedback leaves the turn identical to Hito 1 (no new call, nothing breaks)", async () => {
    const casoId = "caso-1";
    const agent = makeAgent();

    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(),
      createSesionAgente: vi.fn(),
    };

    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-no-feedback"),
      fakeResultSuccessMessage("respuesta sin conocimiento", "sdk-session-no-feedback"),
    ]);

    const hooks = createHookEngine();
    const log = fakeLogDeps();

    // No `knowledgeFeedback`, no `mcpServers` in deps — Hito 1 shape.
    const result = await handleTurn(casoId, "hola", {
      memory,
      hooks,
      candidateAgents: [agent],
      queryFn,
      logDeps: log.deps,
    });

    expect(result).toEqual({
      responseText: "respuesta sin conocimiento",
      agentLabel: "agente-conversacional",
    });
    expect(log.lines).toHaveLength(1);
  });

  it("does not call saveTurnResult when the turn fails before reaching close (model-stage failure)", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();
    const queryFn = throwingQueryFn(new Error("network boom"));
    const knowledgeFeedback = fakeKnowledgeFeedback();

    await expect(
      handleTurn("caso-1", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        queryFn,
        logDeps: fakeLogDeps().deps,
        knowledgeFeedback: knowledgeFeedback.port,
      }),
    ).rejects.toMatchObject({ name: "TurnFailedError", stage: "model" });

    expect(knowledgeFeedback.port.saveTurnResult).not.toHaveBeenCalled();
  });

  it("does not call saveTurnResult when the turn fails at the close stage", async () => {
    const memory: MemoryPort = {
      getCasoById: vi.fn((id: string) => makeCasoRow(id)),
      getLatestSesionAgente: vi.fn(() => undefined),
      updateCaso: vi.fn(() => {
        throw new Error("fallo de escritura simulado");
      }),
      createSesionAgente: vi.fn(),
    };
    const hooks = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-close-fail-2"),
      fakeResultSuccessMessage("respuesta", "sdk-session-close-fail-2"),
    ]);
    const knowledgeFeedback = fakeKnowledgeFeedback();

    await expect(
      handleTurn("caso-1", "hola", {
        memory,
        hooks,
        candidateAgents: [makeAgent()],
        queryFn,
        logDeps: fakeLogDeps().deps,
        knowledgeFeedback: knowledgeFeedback.port,
      }),
    ).rejects.toMatchObject({ name: "TurnFailedError", stage: "close" });

    expect(knowledgeFeedback.port.saveTurnResult).not.toHaveBeenCalled();
  });
});
