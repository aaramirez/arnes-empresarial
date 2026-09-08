import { describe, expect, it } from "vitest";
import { KNOWLEDGE_TOOL_QUALIFIED_NAME } from "../knowledge/knowledge-contract.js";
import {
  CONVERSATIONAL_AGENT_ID,
  construirDeveloperConEscritura,
  DEFAULT_AGENT_MODEL,
  DEVELOPER_AGENT_ID,
  getAgentDefinition,
  getSubagentDefinition,
  listAgentDefinitions,
  listSubagentDefinitions,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  VALIDADOR_SOLICITUDES_AGENT_ID,
} from "./definitions.js";
import { WORKTREE_TEST_TOOL_QUALIFIED_NAME, type WorktreeAbierto } from "./worktree-contract.js";

/** Fabrica un `WorktreeAbierto` de prueba — nadie más que `WorktreePort.abrir` lo produce en producción. */
function fakeWorktreeAbierto(overrides: Partial<WorktreeAbierto> = {}): WorktreeAbierto {
  return {
    casoId: "caso-1",
    ruta: "C:/repo/.harness/worktrees/caso-1-uuid",
    rama: "harness/caso-caso-1-uuid",
    baseCommit: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

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

  it("requires a non-empty description on the conversational agent (Hito 5, tarea 4)", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.description).toBe(
      "Agente conversacional del arnés: sostiene el diálogo con el empleado y consulta la base de conocimiento interna.",
    );
  });

  it("keeps systemPrompt and allowedTools unchanged after adding description", () => {
    const agent = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agent?.allowedTools).toEqual([KNOWLEDGE_TOOL_QUALIFIED_NAME]);
    expect(agent?.systemPrompt).toMatch(/no tenés delegación a otros agentes/);
  });
});

describe("SUBAGENT_REGISTRY (Hito 5, tarea 5, ADR 44/51/52)", () => {
  const SUBAGENT_IDS = [
    PLANNER_AGENT_ID,
    DEVELOPER_AGENT_ID,
    REVIEWER_AGENT_ID,
    VALIDADOR_SOLICITUDES_AGENT_ID,
  ];
  const FORBIDDEN_TOOLS = ["Agent", "Task", "Write", "Edit", "Bash"];

  it("registers exactly the four subagent roles, each with a non-empty description", () => {
    for (const id of SUBAGENT_IDS) {
      const subagent = getSubagentDefinition(id);

      expect(subagent).toBeDefined();
      expect(subagent?.id).toBe(id);
      expect(subagent?.description.length).toBeGreaterThan(0);
    }

    expect(listSubagentDefinitions()).toHaveLength(4);
  });

  it("gives the reviewer a different allowedTools set than the developer (ADR 44 punto 2)", () => {
    const developer = getSubagentDefinition(DEVELOPER_AGENT_ID);
    const reviewer = getSubagentDefinition(REVIEWER_AGENT_ID);

    expect(reviewer?.allowedTools).not.toEqual(developer?.allowedTools);
  });

  it("never grants Agent/Task/Write/Edit/Bash to any of the four roles (un solo nivel de profundidad, sin escritura)", () => {
    for (const id of SUBAGENT_IDS) {
      const subagent = getSubagentDefinition(id);

      for (const forbidden of FORBIDDEN_TOOLS) {
        expect(subagent?.allowedTools).not.toContain(forbidden);
      }
    }
  });

  it("grants the validador-solicitudes role zero tools (§5.2)", () => {
    const validador = getSubagentDefinition(VALIDADOR_SOLICITUDES_AGENT_ID);

    expect(validador?.allowedTools).toEqual([]);
  });

  it("keeps AGENT_REGISTRY (first-level agents) at exactly one entry — regresión de RD-2 / ADR 51", () => {
    const agents = listAgentDefinitions();

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(CONVERSATIONAL_AGENT_ID);
  });
});

describe("construirDeveloperConEscritura (Hito 5.1, tarea 26, ADR 61 pto 1-2, ADR 67)", () => {
  const SUBAGENT_IDS = [
    PLANNER_AGENT_ID,
    DEVELOPER_AGENT_ID,
    REVIEWER_AGENT_ID,
    VALIDADOR_SOLICITUDES_AGENT_ID,
  ];
  const FORBIDDEN_TOOLS = ["Agent", "Task", "Write", "Edit", "Bash"];

  it("el test estrella: agrega Write+Edit+mcp__worktree__run_tests a allowedTools y fija cwd === wt.ruta", () => {
    const wt = fakeWorktreeAbierto();

    const { agent, cwd } = construirDeveloperConEscritura(wt);

    expect(agent.allowedTools).toContain("Write");
    expect(agent.allowedTools).toContain("Edit");
    expect(agent.allowedTools).toContain(WORKTREE_TEST_TOOL_QUALIFIED_NAME);
    expect(cwd).toBe(wt.ruta);
  });

  it("no cambia SUBAGENT_REGISTRY.developer.allowedTools respecto de v2.0.0 (no lo muta, construye uno nuevo)", () => {
    const antes = getSubagentDefinition(DEVELOPER_AGENT_ID);
    expect(antes?.allowedTools).toEqual(["Read", "Glob", "Grep"]);

    construirDeveloperConEscritura(fakeWorktreeAbierto());

    const despues = getSubagentDefinition(DEVELOPER_AGENT_ID);
    expect(despues?.allowedTools).toEqual(["Read", "Glob", "Grep"]);
  });

  it("ninguna de las cuatro definiciones del registro trae Write/Edit/Bash/Agent/Task, con el interruptor en cualquier estado", () => {
    // "Interruptor apagado": el registro tal cual, sin invocar el constructor de escritura.
    for (const id of SUBAGENT_IDS) {
      const subagent = getSubagentDefinition(id);
      for (const forbidden of FORBIDDEN_TOOLS) {
        expect(subagent?.allowedTools).not.toContain(forbidden);
      }
    }

    // "Interruptor prendido": invocar el constructor de escritura para el Developer
    // no debe filtrar Write/Edit/Bash/Agent/Task hacia los otros tres roles del registro.
    construirDeveloperConEscritura(fakeWorktreeAbierto());
    for (const id of SUBAGENT_IDS) {
      const subagent = getSubagentDefinition(id);
      for (const forbidden of FORBIDDEN_TOOLS) {
        expect(subagent?.allowedTools).not.toContain(forbidden);
      }
    }
  });

  it("el único parámetro de la función es un WorktreeAbierto: aridad 1, sin default, sin sobrecarga", () => {
    expect(construirDeveloperConEscritura.length).toBe(1);
  });

  // Chequeo de tipos en tiempo de compilación, no una prueba de comportamiento:
  // esta función nunca se invoca. La garantía la da `tsc --noEmit` al fallar
  // si el `@ts-expect-error` de abajo deja de ser necesario (o si no lo fuera
  // y hiciera falta). El único parámetro de construirDeveloperConEscritura es
  // un WorktreeAbierto (ADR 67 pto 2); no acepta un string.
  function _chequeoDeTipos_noAceptaStringEnLugarDeWorktreeAbierto(): void {
    // @ts-expect-error — un string no es un WorktreeAbierto.
    construirDeveloperConEscritura("no-es-un-worktree");
  }
});
