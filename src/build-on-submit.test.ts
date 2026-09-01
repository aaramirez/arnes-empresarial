/**
 * Tests for `buildOnSubmit` — see `build-on-submit.ts`'s module doc for what
 * this wiring does and why it was extracted out of `main.ts` for testing.
 *
 * SDK boundary note: `buildOnSubmit`'s signature deliberately matches
 * `main.ts`'s own production wiring 1:1 (see that module's doc) — it does
 * NOT forward a `queryFn`/`logDeps` injection point to `handleTurn`, because
 * production never needs one. That means the ONLY way to let a real
 * `handleTurn` call complete without reaching the real network (and, per
 * this SDK, a real local CLI subprocess) is to fake the third-party
 * `@anthropic-ai/claude-agent-sdk` module boundary itself, the same
 * `system`/`init` + `result`/`success` message shapes
 * `handle-turn.test.ts` already establishes for its own `queryFn` fakes.
 * This is a different kind of mock than mocking `handleTurn`: it fakes an
 * external system `invoke-model.ts` already documents as unmockable any
 * other way at this layer (its own module doc: "the real `query()` hits the
 * live Anthropic API over the network, which is unusable in tests").
 *
 * `handleTurn` itself IS additionally spied on (Hito 2, tarea 11) — but only
 * as a thin `vi.fn(actual.handleTurn)` wrapper that still delegates to the
 * real implementation. This is needed for the `knowledge` wiring cases
 * below: the only way to assert that `HandleTurnDeps` does/doesn't carry the
 * `mcpServers`/`knowledgeFeedback` keys is to inspect the exact object
 * `buildOnSubmit` passes to `handleTurn`, not an effect several layers
 * downstream of it.
 */
import { describe, expect, it, vi } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Fakes the SDK's `query()` export itself — same `system`/`init` +
 * `result`/`success` message shapes `handle-turn.test.ts` already
 * establishes for its own `queryFn` fakes, just wired via `vi.mock` instead
 * of DI (see this file's module doc for why `buildOnSubmit` leaves no other
 * seam here). Defined as a standalone function (not a closure over
 * describe/it-scoped variables) so it stays safe under `vi.mock`'s factory
 * hoisting.
 */
function fakeQueryGenerator() {
  return vi.fn(async function* (_params: { readonly prompt: string; readonly options?: Options }) {
    yield {
      type: "system",
      subtype: "init",
      session_id: "sdk-session-fake",
    } as unknown as SDKMessage;
    yield {
      type: "result",
      subtype: "success",
      result: "hola desde el agente",
      is_error: false,
      session_id: "sdk-session-fake",
    } as unknown as SDKMessage;
  });
}

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: fakeQueryGenerator() };
});

/**
 * Thin spy on the REAL `handleTurn` (Hito 2, tarea 11) — see this file's
 * module doc. `vi.fn(actual.handleTurn)` still delegates every call to the
 * real implementation, so every pre-existing test below keeps observing real
 * `handleTurn` behavior; only the two `knowledge` wiring tests read
 * `handleTurn`'s mock.calls to inspect the exact `HandleTurnDeps` object
 * `buildOnSubmit` built for that one call.
 */
vi.mock("./core/turn-selector/handle-turn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/turn-selector/handle-turn.js")>();
  return { ...actual, handleTurn: vi.fn(actual.handleTurn) };
});

import { buildOnSubmit } from "./build-on-submit.js";
import { CASO_ESTADO_ACTIVO, handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import { DEFAULT_AGENT_MODEL, type AgentDefinition } from "./core/agents/definitions.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";

/**
 * Same fake `LogTurnEventDeps` shape/reasoning `handle-turn.test.ts`'s own
 * `fakeLogDeps()` already establishes: `handleTurn`'s real default writes to
 * `data/harness.log` on the real filesystem — every `buildOnSubmit(...)`
 * call below injects this instead, so a plain `npm test` run never touches
 * it (Reviewer finding, WARNING — the first version of this file omitted
 * this and appended real lines to that log on every run).
 */
function fakeLogDeps(): LogTurnEventDeps {
  return {
    now: () => "2026-08-30T00:00:00.000Z",
    write: () => {
      // Discarded — no test here asserts on logged content, only on
      // `handleTurn`'s real filesystem write being avoided.
    },
  };
}

function makeCasoRow(casoId: string) {
  return {
    id: casoId,
    tipo: "conversacion",
    estado: CASO_ESTADO_ACTIVO,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

/** Same fake `MemoryPort` shape `handle-turn.test.ts` already establishes. */
function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn((id: string) => makeCasoRow(id)),
    getLatestSesionAgente: vi.fn(() => undefined),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    systemPrompt: `system prompt de ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

describe("buildOnSubmit", () => {
  it(
    "calls onAgentResolved with the FIRST agent's id before handleTurn reaches memory (context stage)",
    async () => {
      // `resolveTurn` always returns the first candidate (see
      // `resolve-turn.ts`) — two distinct agents here so this test actually
      // proves *which* id was threaded through, not a trivial single-agent
      // case.
      const callOrder: string[] = [];
      const memory: MemoryPort = {
        getCasoById: vi.fn((id: string) => {
          callOrder.push("getCasoById");
          return makeCasoRow(id);
        }),
        getLatestSesionAgente: vi.fn(() => undefined),
        updateCaso: vi.fn(),
        createSesionAgente: vi.fn(),
      };
      const hooks = createHookEngine();
      const agents = [makeAgent("agente-uno"), makeAgent("agente-dos")];
      const onSubmit = buildOnSubmit("caso-1", memory, hooks, agents, fakeLogDeps());

      const onAgentResolved = vi.fn((agentLabel: string) => {
        callOrder.push(`resolved:${agentLabel}`);
      });

      const promise = onSubmit("hola", onAgentResolved);
      await promise;

      // `onAgentResolved` must have already fired — with the FIRST agent's
      // id — before `handleTurn`'s context stage ever reaches `memory`.
      // `handleTurn`/`runTurnStage`/`assembleContext` call `getCasoById`
      // synchronously (no `await` precedes that call — see
      // `turn-error.ts`'s `runTurnStage`), so this ordering is a REAL signal
      // of source-line order inside `buildOnSubmit`'s closure, not an
      // artificial timing assumption. A version that called `handleTurn`
      // before `onAgentResolved` would flip this order: `getCasoById` would
      // land first in `callOrder`.
      expect(callOrder[0]).toBe("resolved:agente-uno");
      expect(callOrder).toContain("getCasoById");
      expect(onAgentResolved).toHaveBeenCalledTimes(1);
      expect(onAgentResolved).toHaveBeenCalledWith("agente-uno");
    },
  );

  it("resolves with the same responseText/agentLabel handleTurn itself produces", async () => {
    const memory = fakeMemory();
    const hooks = createHookEngine();
    const agents = [makeAgent("agente-uno"), makeAgent("agente-dos")];
    const onSubmit = buildOnSubmit("caso-1", memory, hooks, agents, fakeLogDeps());

    const result = await onSubmit("hola", () => {});

    expect(result).toEqual({
      responseText: "hola desde el agente",
      agentLabel: "agente-uno",
    });
  });

  it("does not throw when onAgentResolved is omitted (optional ?.() call)", async () => {
    const memory = fakeMemory();
    const hooks = createHookEngine();
    const agents = [makeAgent("agente-uno"), makeAgent("agente-dos")];
    const onSubmit = buildOnSubmit("caso-1", memory, hooks, agents, fakeLogDeps());

    await expect(onSubmit("hola")).resolves.toMatchObject({
      responseText: "hola desde el agente",
      agentLabel: "agente-uno",
    });
  });

  it("omits mcpServers/knowledgeFeedback from handleTurn's deps when knowledge is omitted", async () => {
    const memory = fakeMemory();
    const hooks = createHookEngine();
    const agents = [makeAgent("agente-uno"), makeAgent("agente-dos")];
    // `knowledge` deliberately not passed — same as production's Hito 1
    // callers, before this wiring existed.
    const onSubmit = buildOnSubmit("caso-1", memory, hooks, agents, fakeLogDeps());

    await onSubmit("hola", () => {});

    const deps = vi.mocked(handleTurn).mock.calls.at(-1)?.[2];
    expect(deps).toBeDefined();
    // `exactOptionalPropertyTypes` distinguishes "key absent" from "key
    // present with value `undefined`" — `not.toHaveProperty` is the strict
    // check for the former, `toBeUndefined()` would also pass for the
    // latter and so would hide a bug where the key leaks in as `undefined`.
    expect(deps).not.toHaveProperty("mcpServers");
    expect(deps).not.toHaveProperty("knowledgeFeedback");
  });

  it("forwards mcpServers and knowledgeFeedback together, from the same knowledge adapter, when knowledge is present", async () => {
    const memory = fakeMemory();
    const hooks = createHookEngine();
    const agents = [makeAgent("agente-uno"), makeAgent("agente-dos")];
    const fakeMcpServers: NonNullable<Options["mcpServers"]> = {
      knowledge: { type: "stdio", command: "graphify" },
    };
    const fakeFeedback = { saveTurnResult: vi.fn().mockResolvedValue(undefined) };
    const fakeKnowledge = { mcpServers: fakeMcpServers, feedback: fakeFeedback };
    const onSubmit = buildOnSubmit("caso-1", memory, hooks, agents, fakeLogDeps(), fakeKnowledge);

    await onSubmit("hola", () => {});

    const deps = vi.mocked(handleTurn).mock.calls.at(-1)?.[2];
    expect(deps).toBeDefined();
    // Both keys land TOGETHER, taken from the SAME `knowledge` adapter — not
    // two independently-sourced values that could drift apart.
    expect(deps).toHaveProperty("mcpServers", fakeKnowledge.mcpServers);
    expect(deps).toHaveProperty("knowledgeFeedback", fakeKnowledge.feedback);
  });
});
