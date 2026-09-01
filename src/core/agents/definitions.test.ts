import { describe, expect, it } from "vitest";
import { KNOWLEDGE_TOOL_QUALIFIED_NAME } from "../knowledge/knowledge-contract.js";
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
    expect(agent?.allowedTools).toEqual([KNOWLEDGE_TOOL_QUALIFIED_NAME]);
  });

  it("returns undefined for an unknown agent id", () => {
    expect(getAgentDefinition("agente-inexistente")).toBeUndefined();
  });

  it("lists exactly the MVP's single agent", () => {
    const agents = listAgentDefinitions();

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(CONVERSATIONAL_AGENT_ID);
  });

  it("grants the knowledge query tool via the shared contract constant (Hito 2, tarea 10)", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.allowedTools).toContain(KNOWLEDGE_TOOL_QUALIFIED_NAME);
  });

  it("no longer claims the agent lacks a knowledge base", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.systemPrompt).not.toMatch(
      /Todavía no tenés acceso a herramientas, base de conocimiento/,
    );
    expect(agent?.systemPrompt).toContain(KNOWLEDGE_TOOL_QUALIFIED_NAME);
  });

  it("instructs the agent to always cite src/loc when using the knowledge tool", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.systemPrompt).toMatch(/CITÁ SIEMPRE la fuente/);
    expect(agent?.systemPrompt).toContain("`src`");
    expect(agent?.systemPrompt).toContain("`loc`");
  });

  it("still states there is no delegation to other agents", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.systemPrompt).toMatch(/no tenés delegación a otros agentes/);
  });
});
