import { describe, expect, it, vi } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "../agents/definitions.js";
import { DEFAULT_AGENT_MODEL, listSubagentDefinitions } from "../agents/definitions.js";
import type { AssembledContext, CasoSnapshot } from "./assemble-context.js";
import { createHookEngine } from "../hooks/hook-engine.js";
import { invokeModel, ModelResponseIncompleteError } from "./invoke-model.js";

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

function fakeAssistantTextMessage(
  text: string,
  sessionId: string,
  parentToolUseId: string | null = null,
): SDKMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    session_id: sessionId,
    parent_tool_use_id: parentToolUseId,
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
    description: "agente de prueba",
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
      description: "descripcion de prueba, forwarded verbatim",
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

    // subagentes: [] — isolates this test's exact-match assertion from the
    // Hito 5 tarea 9 default (listSubagentDefinitions()), which is covered
    // by its own dedicated tests below.
    await invokeModel(agent, context, "prompt de prueba", hookEngine, queryFn, undefined, []);

    expect(queryFn).toHaveBeenCalledWith({
      prompt: "prompt de prueba",
      options: {
        agent: "agente-conversacional",
        agents: {
          "agente-conversacional": {
            // Hito 5, tarea 9: forwarded verbatim, no longer synthesized
            // (toMainThreadAgentDescription was retired).
            description: "descripcion de prueba, forwarded verbatim",
            prompt: "sos un agente de prueba",
            tools: ["Read", "Grep"],
            model: "sonnet",
          },
        },
        // Hito 2, tarea 8 (ADR 4): a non-empty allowedTools now also
        // populates top-level options.allowedTools (auto-approval),
        // distinct from agents[id].tools (Fix 1's restriction mechanism)
        // asserted above.
        allowedTools: ["Read", "Grep"],
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

  // Hito 2, tarea 8 — mcpServers + allowedTools (ADR 4) added to
  // toQueryOptions. See design.md §5.1.
  describe("mcpServers and allowedTools (Hito 2, tarea 8)", () => {
    it("omits options.mcpServers entirely when the caller passes none (Hito 1 regression guard)", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-nomcp"),
        fakeResultSuccessMessage("respuesta", "sdk-session-nomcp"),
      ]);

      // No mcpServers argument passed — same call shape as every Hito 1 site.
      await invokeModel(agent, context, "hola", hookEngine, queryFn);

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options).not.toHaveProperty("mcpServers");
    });

    it("passes mcpServers through to options.mcpServers verbatim when provided", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const mcpServers: NonNullable<Options["mcpServers"]> = {
        knowledge: { type: "stdio", command: "graphify" },
      };
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-mcp"),
        fakeResultSuccessMessage("respuesta", "sdk-session-mcp"),
      ]);

      await invokeModel(agent, context, "hola", hookEngine, queryFn, mcpServers);

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options?.mcpServers).toBe(mcpServers);
    });

    it("populates options.allowedTools from agent.allowedTools as a new array when non-empty (ADR 4 — granting is auto-approving)", async () => {
      const agent = makeAgent({ allowedTools: ["mcp__knowledge__query_knowledge_base"] });
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-allowed"),
        fakeResultSuccessMessage("respuesta", "sdk-session-allowed"),
      ]);

      await invokeModel(agent, context, "hola", hookEngine, queryFn);

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options?.allowedTools).toEqual(agent.allowedTools);
      expect(callArgs?.options?.allowedTools).not.toBe(agent.allowedTools);
    });

    // The "omitted when empty" case is already covered strictly (not just
    // toBeUndefined) by the existing "restricts the agent to an empty
    // toolset..." test above (line ~161), which asserts
    // `not.toHaveProperty("allowedTools")` for an agent with
    // `allowedTools: []` — same criterion tasks.md tarea 8 asks for, so it
    // is not duplicated here.
  });

  // Hito 5, tarea 9 — toQueryOptions registers multiple agents
  // (options.agents[parent] + options.agents[each subagent role]) and
  // toMainThreadAgentDescription is retired. See design.md §5.8.
  describe("subagentes en options.agents (Hito 5, tarea 9)", () => {
    it("registers the parent agent and the four subagent roles in options.agents by default, each with its own description, and still selects the parent via options.agent", async () => {
      const agent = makeAgent({
        id: "agente-conversacional",
        description: "descripcion del agente principal",
      });
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-subagentes"),
        fakeResultSuccessMessage("ok", "sdk-session-subagentes"),
      ]);

      // No subagentes argument — production omits it too (DI default,
      // same pattern as `candidates` in resolve-turn.ts / `queryFn` here).
      await invokeModel(agent, context, "hola", hookEngine, queryFn);

      const callArgs = queryFn.mock.calls[0]?.[0];
      const registeredAgents = callArgs?.options?.agents ?? {};

      expect(callArgs?.options?.agent).toBe("agente-conversacional");
      expect(Object.keys(registeredAgents)).toHaveLength(5);
      expect(registeredAgents["agente-conversacional"]?.description).toBe(
        "descripcion del agente principal",
      );
      for (const subagente of listSubagentDefinitions()) {
        expect(registeredAgents[subagente.id]?.description).toBe(subagente.description);
      }
    });

    it("forwards agent.description verbatim into options.agents[id].description, with no synthesis (toSdkAgentDefinition, toMainThreadAgentDescription retired)", async () => {
      const agent = makeAgent({
        id: "agente-conversacional",
        description: "Descripción literal fijada por definitions.ts, sin sintetizar.",
      });
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-desc"),
        fakeResultSuccessMessage("ok", "sdk-session-desc"),
      ]);

      await invokeModel(agent, context, "hola", hookEngine, queryFn, undefined, []);

      const callArgs = queryFn.mock.calls[0]?.[0];
      const registeredAgent = callArgs?.options?.agents?.["agente-conversacional"];
      expect(registeredAgent?.description).toBe(
        "Descripción literal fijada por definitions.ts, sin sintetizar.",
      );
    });

    it("does not widen options.allowedTools with a registered-but-not-invoked subagent's tools — CONVERSATIONAL_AGENT gains no delegation allowedTools", async () => {
      const agent = makeAgent({ id: "agente-conversacional", allowedTools: [] });
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-noauto"),
        fakeResultSuccessMessage("ok", "sdk-session-noauto"),
      ]);

      // Real subagentes DO have non-empty allowedTools (planner/developer
      // have Read/Glob/Grep) — proves the assertion below isn't vacuous.
      expect(listSubagentDefinitions().some((s) => s.allowedTools.length > 0)).toBe(true);

      await invokeModel(agent, context, "hola", hookEngine, queryFn);

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options).not.toHaveProperty("allowedTools");
    });
  });

  // Hito 5.1, tarea 28 — cwd as a trailing optional parameter (ADR 67 pto 4,
  // segunda mitad de la propagación hasta el SDK). Added after `subagentes`
  // (not as invoke-model.ts's literal "7th" parameter as design.md §5.3
  // sketched before `subagentes` existed — see toQueryOptions' doc-comment
  // for why): the non-negotiable constraint is that no existing call site
  // may break, and `subagentes` already occupies that position.
  describe("cwd (Hito 5.1, tarea 28, ADR 67 pto 4)", () => {
    it("omits options.cwd entirely when the caller passes none (regression guard, identical to pre-tarea-28 behavior)", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-nocwd"),
        fakeResultSuccessMessage("respuesta", "sdk-session-nocwd"),
      ]);

      // No cwd argument passed — same call shape as every pre-tarea-28 site.
      await invokeModel(agent, context, "hola", hookEngine, queryFn);

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options).not.toHaveProperty("cwd");
    });

    it("passes cwd through to options.cwd verbatim when provided as the trailing parameter", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-cwd"),
        fakeResultSuccessMessage("respuesta", "sdk-session-cwd"),
      ]);

      await invokeModel(
        agent,
        context,
        "hola",
        hookEngine,
        queryFn,
        undefined,
        [],
        "/tmp/harness/worktrees/wt-1",
      );

      const callArgs = queryFn.mock.calls[0]?.[0];
      expect(callArgs?.options?.cwd).toBe("/tmp/harness/worktrees/wt-1");
    });
  });

  // Hito 5, tarea 9 — InvokeModelResult.parentToolUseId, optional and
  // additive: read off an assistant message's parent_tool_use_id when
  // present, absent when no message carries one.
  describe("parentToolUseId (Hito 5, tarea 9)", () => {
    it("returns a result without parentToolUseId when no message carries one, without breaking the turn", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-sinparent"),
        fakeAssistantTextMessage("respuesta", "sdk-session-sinparent", null),
        fakeResultSuccessMessage("respuesta", "sdk-session-sinparent"),
      ]);

      const result = await invokeModel(agent, context, "hola", hookEngine, queryFn);

      expect(result.parentToolUseId).toBeUndefined();
      // toEqual ignores undefined-valued keys, so this also confirms the
      // shape stays backwards-compatible for every existing caller.
      expect(result).toEqual({
        responseText: "respuesta",
        sdkSessionId: "sdk-session-sinparent",
      });
    });

    it("captures parentToolUseId from an assistant message that carries one", async () => {
      const agent = makeAgent();
      const context = makeContext();
      const hookEngine = createHookEngine();
      const queryFn = fakeQueryFn([
        fakeSystemInitMessage("sdk-session-conparent"),
        fakeAssistantTextMessage("respuesta", "sdk-session-conparent", "tool-use-123"),
        fakeResultSuccessMessage("respuesta", "sdk-session-conparent"),
      ]);

      const result = await invokeModel(agent, context, "hola", hookEngine, queryFn);

      expect(result.parentToolUseId).toBe("tool-use-123");
    });
  });
});
