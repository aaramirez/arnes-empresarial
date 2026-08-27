import { describe, expect, it } from "vitest";
import {
  CONVERSATIONAL_AGENT_ID,
  DEFAULT_AGENT_MODEL,
  getAgentDefinition,
  listAgentDefinitions,
} from "./definitions.js";

describe("agent registry", () => {
  it("resolves the conversational agent by its id", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent).toBeDefined();
    expect(agent?.id).toBe(CONVERSATIONAL_AGENT_ID);
    expect(agent?.model).toBe(DEFAULT_AGENT_MODEL);
    expect(agent?.systemPrompt.length).toBeGreaterThan(0);
    expect(agent?.allowedTools).toEqual([]);
  });

  it("returns undefined for an unknown agent id", () => {
    expect(getAgentDefinition("agente-inexistente")).toBeUndefined();
  });

  it("lists exactly the MVP's single agent", () => {
    const agents = listAgentDefinitions();

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(CONVERSATIONAL_AGENT_ID);
  });
});
