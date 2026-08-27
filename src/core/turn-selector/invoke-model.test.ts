import { describe, expect, it, vi } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "../agents/definitions.js";
import { DEFAULT_AGENT_MODEL } from "../agents/definitions.js";
import type { AssembledContext, CasoSnapshot } from "./assemble-context.js";
import { createHookEngine } from "../hooks/hook-engine.js";
import {
  invokeModel,
  ModelResponseIncompleteError,
  toMainThreadAgentDescription,
} from "./invoke-model.js";

/**
 * Fake SDK message fixtures for `queryFn` — see `invoke-model.ts` module doc
 * for why `invokeModel` takes `queryFn` as an injectable parameter instead
 * of always calling the real `@anthropic-ai/claude-agent-sdk` `query()`.
 *
 * Cast via `as unknown as SDKMessage`: `SDKSystemMessage` in particular
 * carries many required fields (`apiKeySource`, `cwd`, `tools`,
 * `mcp_servers`, `permissionMode`, `slash_commands`, `output_style`,
 * `skills`, `plugins`, `uuid`, ...) that `invokeModel` never reads. Filling
 * every one in every fixture would only pad the test file without adding
 * coverage — the cast narrows the fixture to exactly the fields the
 * production code under test actually consumes, matching the real field
 * names confirmed against the installed `.d.ts` (see the module doc in
 * `invoke-model.ts`).
 */
function fakeSystemInitMessage(sessionId: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function fakeAssistantTextMessage(text: string, sessionId: string): SDKMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function fakeResultSuccessMessage(
  resultText: string,
  sessionId: string,
  isError = false,
): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result: resultText,
    is_error: isError,
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function fakeResultErrorMessage(sessionId: string): SDKMessage {
  return {
    type: "result",
    subtype: "error_max_turns",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

/**
 * Builds a `queryFn` fake that yields exactly `messages`, regardless of its
 * call arguments. Declares the `params` parameter explicitly (even though
 * unused) so `vi.fn`'s inferred mock type records `{ prompt, options }` as
 * the call argument shape — tests that assert `queryFn.mock.calls[0][0]`
 * (e.g. to check the mapped `options`) need that shape to type-check.
 */
function fakeQueryFn(messages: readonly SDKMessage[]) {
  return vi.fn(async function* (_params: { readonly prompt: string; readonly options?: Options }) {
    for (const message of messages) {
      yield message;
    }
  });
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

function makeCaso(overrides: Partial<CasoSnapshot> = {}): CasoSnapshot {
  return {
    id: "caso-1",
    tipo: "conversacion",
    estado: "abierto",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    caso: makeCaso(),
    resumeSessionId: undefined,
    ...overrides,
  };
}

describe("invokeModel", () => {
  it("returns the final response text and sdk session id from a plain-text turn (Escenario 1, no tool calls)", async () => {
    const agent = makeAgent();
    const context = makeContext();
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-abc"),
      fakeAssistantTextMessage("Hola, ¿en qué te ayudo?", "sdk-session-abc"),
      fakeResultSuccessMessage("Hola, ¿en qué te ayudo?", "sdk-session-abc"),
    ]);

    const result = await invokeModel(agent, context, "hola", hookEngine, queryFn);

    expect(result).toEqual({
      responseText: "Hola, ¿en qué te ayudo?",
      sdkSessionId: "sdk-session-abc",
    });
  });

  it("registers the agent under options.agents[id] with real tool restriction (options.tools, not options.allowedTools) and selects it via options.agent for the main thread (Fix 1)", async () => {
    const agent = makeAgent({
      id: "agente-conversacional",
      systemPrompt: "sos un agente de prueba",
      allowedTools: ["Read", "Grep"],
      model: "sonnet",
    });
    const context = makeContext();
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-1"),
      fakeResultSuccessMessage("ok", "sdk-session-1"),
    ]);

    await invokeModel(agent, context, "prompt de prueba", hookEngine, queryFn);

    expect(queryFn).toHaveBeenCalledWith({
      prompt: "prompt de prueba",
      options: {
        agent: "agente-conversacional",
        agents: {
          "agente-conversacional": {
            description: toMainThreadAgentDescription("agente-conversacional"),
            prompt: "sos un agente de prueba",
            tools: ["Read", "Grep"],
            model: "sonnet",
          },
        },
      },
    });
  });

  it("restricts the agent to an empty toolset when allowedTools is empty, instead of leaving the SDK's default toolset available (Fix 1 regression guard)", async () => {
    const agent = makeAgent({ id: "agente-conversacional", allowedTools: [] });
    const context = makeContext();
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-notools"),
      fakeResultSuccessMessage("ok", "sdk-session-notools"),
    ]);

    await invokeModel(agent, context, "hola", hookEngine, queryFn);

    const callArgs = queryFn.mock.calls[0]?.[0];
    const registeredAgent = callArgs?.options?.agents?.["agente-conversacional"];
    expect(registeredAgent?.tools).toEqual([]);
    expect(callArgs?.options).not.toHaveProperty("allowedTools");
  });

  it("passes options.resume when the assembled context has a resumeSessionId", async () => {
    const agent = makeAgent();
    const context = makeContext({ resumeSessionId: "sdk-session-previo" });
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-previo"),
      fakeResultSuccessMessage("segunda respuesta", "sdk-session-previo"),
    ]);

    await invokeModel(agent, context, "segundo prompt", hookEngine, queryFn);

    const callArgs = queryFn.mock.calls[0]?.[0];
    expect(callArgs?.options).toMatchObject({ resume: "sdk-session-previo" });
  });

  it("omits options.resume entirely (not resume: undefined) when the assembled context has no prior session", async () => {
    const agent = makeAgent();
    const context = makeContext({ resumeSessionId: undefined });
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-nuevo"),
      fakeResultSuccessMessage("primera respuesta", "sdk-session-nuevo"),
    ]);

    await invokeModel(agent, context, "primer prompt", hookEngine, queryFn);

    const callArgs = queryFn.mock.calls[0]?.[0];
    expect(callArgs?.options).not.toHaveProperty("resume");
  });

  it("triggers the POST_TURN hook exactly once, after the turn completes, with the response context", async () => {
    const agent = makeAgent({ id: "agente-conversacional" });
    const context = makeContext({ caso: makeCaso({ id: "caso-42" }) });
    const hookEngine = createHookEngine();
    const postTurnHandler = vi.fn();
    hookEngine.registerHook("POST_TURN", postTurnHandler);
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-hook"),
      fakeResultSuccessMessage("respuesta con hook", "sdk-session-hook"),
    ]);

    await invokeModel(agent, context, "hola", hookEngine, queryFn);

    expect(postTurnHandler).toHaveBeenCalledTimes(1);
    expect(postTurnHandler).toHaveBeenCalledWith({
      casoId: "caso-42",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-hook",
      responseText: "respuesta con hook",
    });
  });

  it("does not trigger the POST_TURN hook before the turn's messages have been fully consumed", async () => {
    const agent = makeAgent();
    const context = makeContext();
    const hookEngine = createHookEngine();
    const calls: string[] = [];
    hookEngine.registerHook("POST_TURN", () => {
      calls.push("hook");
    });
    const queryFn = vi.fn(async function* () {
      calls.push("system");
      yield fakeSystemInitMessage("sdk-session-order");
      calls.push("result");
      yield fakeResultSuccessMessage("respuesta", "sdk-session-order");
    });

    await invokeModel(agent, context, "hola", hookEngine, queryFn);

    expect(calls).toEqual(["system", "result", "hook"]);
  });

  it("throws ModelResponseIncompleteError when the turn ends without a successful result message", async () => {
    const agent = makeAgent();
    const context = makeContext();
    const hookEngine = createHookEngine();
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-error"),
      fakeResultErrorMessage("sdk-session-error"),
    ]);

    await expect(invokeModel(agent, context, "hola", hookEngine, queryFn)).rejects.toThrow(
      ModelResponseIncompleteError,
    );
  });

  it("throws ModelResponseIncompleteError when the result message has subtype success but is_error: true (Fix 2 — API error masquerading as success)", async () => {
    const agent = makeAgent();
    const context = makeContext();
    const hookEngine = createHookEngine();
    const postTurnHandler = vi.fn();
    hookEngine.registerHook("POST_TURN", postTurnHandler);
    const queryFn = fakeQueryFn([
      fakeSystemInitMessage("sdk-session-apierror"),
      fakeResultSuccessMessage("rate limit exceeded", "sdk-session-apierror", true),
    ]);

    await expect(invokeModel(agent, context, "hola", hookEngine, queryFn)).rejects.toThrow(
      ModelResponseIncompleteError,
    );
    // The error text must never reach POST_TURN as if it were a real answer.
    expect(postTurnHandler).not.toHaveBeenCalled();
  });

  it("lets a queryFn rejection propagate unwrapped (error policy deferred to Hito 1, tarea 11)", async () => {
    const agent = makeAgent();
    const context = makeContext();
    const hookEngine = createHookEngine();
    const boom = new Error("network boom");
    const queryFn = vi.fn(async function* (): AsyncGenerator<SDKMessage> {
      throw boom;
      // eslint-disable-next-line no-unreachable
      yield fakeSystemInitMessage("unreachable");
    });

    await expect(invokeModel(agent, context, "hola", hookEngine, queryFn)).rejects.toBe(boom);
  });
});
