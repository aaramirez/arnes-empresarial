import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../agents/definitions.js";
import { CONVERSATIONAL_AGENT_ID, DEFAULT_AGENT_MODEL } from "../agents/definitions.js";
import { NoAgentAvailableError, resolveTurn } from "./resolve-turn.js";

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    systemPrompt: `system prompt for ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

describe("resolveTurn", () => {
  it("resolves the real agent registry's single agent when no candidates are given", () => {
    const agent = resolveTurn("hola, necesito ayuda");

    expect(agent.id).toBe(CONVERSATIONAL_AGENT_ID);
  });

  it("resolves the only candidate when exactly one is given explicitly", () => {
    const onlyAgent = makeAgent("agente-unico");

    const agent = resolveTurn("cualquier prompt", [onlyAgent]);

    expect(agent).toBe(onlyAgent);
  });

  it("resolves the first candidate when more than one agent is registered (future multi-agent contract)", () => {
    const firstAgent = makeAgent("agente-a");
    const secondAgent = makeAgent("agente-b");

    const agent = resolveTurn("cualquier prompt", [firstAgent, secondAgent]);

    expect(agent).toBe(firstAgent);
  });

  it("throws NoAgentAvailableError when no candidates are registered", () => {
    expect(() => resolveTurn("cualquier prompt", [])).toThrow(NoAgentAvailableError);
    expect(() => resolveTurn("cualquier prompt", [])).toThrow(
      "No agent is registered to handle any turn",
    );
  });
});
