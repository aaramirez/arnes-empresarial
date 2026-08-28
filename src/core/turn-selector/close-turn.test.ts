import { describe, expect, it, vi } from "vitest";
import { CONVERSATIONAL_AGENT_ID, DEFAULT_AGENT_MODEL } from "../agents/definitions.js";
import type { AgentDefinition } from "../agents/definitions.js";
import type { AssembledContext } from "./assemble-context.js";
import type { InvokeModelResult } from "./invoke-model.js";
import { closeTurn, type MemoryWritePort } from "./close-turn.js";

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    systemPrompt: `system prompt for ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

function makeContext(casoId: string): AssembledContext {
  return {
    caso: {
      id: casoId,
      tipo: "conversacion",
      estado: "abierto",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
    resumeSessionId: undefined,
  };
}

function makeResult(sdkSessionId: string): InvokeModelResult {
  return { responseText: "respuesta del modelo", sdkSessionId };
}

function makeMemoryPort(): MemoryWritePort {
  return {
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

describe("closeTurn", () => {
  it("updates the caso's estado via memory.updateCaso using the injected now()", () => {
    const memory = makeMemoryPort();
    const context = makeContext("caso-1");
    const agent = makeAgent(CONVERSATIONAL_AGENT_ID);
    const result = makeResult("sdk-session-abc");

    closeTurn(memory, context, agent, result, "en-progreso", {
      now: () => "2026-08-27T01:00:00.000Z",
      generateSesionId: () => "sesion-fija",
    });

    expect(memory.updateCaso).toHaveBeenCalledWith("caso-1", {
      estado: "en-progreso",
      updatedAt: "2026-08-27T01:00:00.000Z",
    });
  });

  it("creates a new sesion_agente row via memory.createSesionAgente using the injected deps", () => {
    const memory = makeMemoryPort();
    const context = makeContext("caso-1");
    const agent = makeAgent(CONVERSATIONAL_AGENT_ID);
    const result = makeResult("sdk-session-abc");

    closeTurn(memory, context, agent, result, "en-progreso", {
      now: () => "2026-08-27T01:00:00.000Z",
      generateSesionId: () => "sesion-fija",
    });

    expect(memory.createSesionAgente).toHaveBeenCalledWith({
      id: "sesion-fija",
      casoId: "caso-1",
      agentId: CONVERSATIONAL_AGENT_ID,
      sdkSessionId: "sdk-session-abc",
      createdAt: "2026-08-27T01:00:00.000Z",
    });
  });

  it("uses different casoId/agentId/sdkSessionId/estado when the inputs differ (triangulation)", () => {
    const memory = makeMemoryPort();
    const context = makeContext("caso-2");
    const agent = makeAgent("otro-agente");
    const result = makeResult("sdk-session-xyz");

    closeTurn(memory, context, agent, result, "cerrado", {
      now: () => "2026-08-28T09:30:00.000Z",
      generateSesionId: () => "sesion-otra",
    });

    expect(memory.updateCaso).toHaveBeenCalledWith("caso-2", {
      estado: "cerrado",
      updatedAt: "2026-08-28T09:30:00.000Z",
    });
    expect(memory.createSesionAgente).toHaveBeenCalledWith({
      id: "sesion-otra",
      casoId: "caso-2",
      agentId: "otro-agente",
      sdkSessionId: "sdk-session-xyz",
      createdAt: "2026-08-28T09:30:00.000Z",
    });
  });

  it("does not use the real clock or crypto.randomUUID when deps are injected", () => {
    const memory = makeMemoryPort();
    const context = makeContext("caso-1");
    const agent = makeAgent(CONVERSATIONAL_AGENT_ID);
    const result = makeResult("sdk-session-abc");
    const now = vi.fn(() => "2026-08-27T01:00:00.000Z");
    const generateSesionId = vi.fn(() => "sesion-fija");

    closeTurn(memory, context, agent, result, "en-progreso", { now, generateSesionId });

    expect(now).toHaveBeenCalledTimes(2);
    expect(generateSesionId).toHaveBeenCalledTimes(1);
  });

  it("uses the real default deps (node:crypto randomUUID + Date) when deps is omitted", () => {
    const memory = makeMemoryPort();
    const context = makeContext("caso-1");
    const agent = makeAgent(CONVERSATIONAL_AGENT_ID);
    const result = makeResult("sdk-session-abc");

    closeTurn(memory, context, agent, result, "en-progreso");

    expect(memory.createSesionAgente).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      }),
    );
  });
});
