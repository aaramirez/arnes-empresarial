import { describe, expect, it } from "vitest";
import { KNOWLEDGE_TOOL_QUALIFIED_NAME } from "../knowledge/knowledge-contract.js";
import { OPERACIONES_TOOL_QUALIFIED_NAME } from "../operaciones/operaciones-contract.js";
import { CONSULTAS_TOOL_QUALIFIED_NAME } from "./consultas-negocio-tool.js";
import {
  CONVERSATIONAL_AGENT_ID,
  construirAgenteEmpleadoOperaciones,
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
    expect(agent?.allowedTools).toEqual([
      KNOWLEDGE_TOOL_QUALIFIED_NAME,
      "Skill",
      CONSULTAS_TOOL_QUALIFIED_NAME,
    ]);
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

    expect(agent?.allowedTools).toEqual([
      KNOWLEDGE_TOOL_QUALIFIED_NAME,
      "Skill",
      CONSULTAS_TOOL_QUALIFIED_NAME,
    ]);
    expect(agent?.systemPrompt).toMatch(/no tenés delegación a otros agentes/);
  });
});

describe("construirAgenteEmpleadoOperaciones (operaciones-negocio-conversacionales, ADR 164, tarea 6)", () => {
  it("devuelve un AgentDefinition con allowedTools de CUATRO entradas: conocimiento, Skill, consultas de negocio y la tool de operaciones (consultas-negocio-a2a-entrante, tarea 9)", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.allowedTools).toHaveLength(4);
    expect(agente.allowedTools).toEqual([
      KNOWLEDGE_TOOL_QUALIFIED_NAME,
      "Skill",
      CONSULTAS_TOOL_QUALIFIED_NAME,
      OPERACIONES_TOOL_QUALIFIED_NAME,
    ]);
  });

  it("NO muta CONVERSATIONAL_AGENT.allowedTools — sigue en TRES entradas, nunca gana la tool de operaciones (regresión R1)", () => {
    construirAgenteEmpleadoOperaciones();

    const conversacional = getAgentDefinition(CONVERSATIONAL_AGENT_ID);
    expect(conversacional?.allowedTools).toHaveLength(3);
    expect(conversacional?.allowedTools).toEqual([
      KNOWLEDGE_TOOL_QUALIFIED_NAME,
      "Skill",
      CONSULTAS_TOOL_QUALIFIED_NAME,
    ]);
    expect(conversacional?.allowedTools).not.toContain(OPERACIONES_TOOL_QUALIFIED_NAME);
  });

  it("AGENT_REGISTRY/listAgentDefinitions() no cambian — sigue habiendo UN solo agente de primer nivel", () => {
    construirAgenteEmpleadoOperaciones();

    const agentes = listAgentDefinitions();
    expect(agentes).toHaveLength(1);
    expect(agentes[0]?.id).toBe(CONVERSATIONAL_AGENT_ID);
  });

  it("el systemPrompt extiende el de CONVERSATIONAL_AGENT, sin reemplazarlo", () => {
    const conversacional = getAgentDefinition(CONVERSATIONAL_AGENT_ID);
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt.startsWith(conversacional?.systemPrompt ?? "")).toBe(true);
    expect(agente.systemPrompt).toContain(OPERACIONES_TOOL_QUALIFIED_NAME);
    expect(agente.systemPrompt.length).toBeGreaterThan(conversacional?.systemPrompt.length ?? 0);
  });

  it("instruye a nunca calcular un monto/porcentaje/veredicto, y a esperar confirmación explícita en un mensaje nuevo", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt.toLowerCase()).toContain("nunca calcul");
    expect(agente.systemPrompt.toLowerCase()).toContain("confirmación");
  });

  it("conserva id, description y model de CONVERSATIONAL_AGENT (spread, no reconstrucción)", () => {
    const conversacional = getAgentDefinition(CONVERSATIONAL_AGENT_ID);
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.id).toBe(conversacional?.id);
    expect(agente.description).toBe(conversacional?.description);
    expect(agente.model).toBe(conversacional?.model);
  });

  it("cada invocación devuelve un objeto nuevo (spread, nunca comparte referencia mutable)", () => {
    const primero = construirAgenteEmpleadoOperaciones();
    const segundo = construirAgenteEmpleadoOperaciones();

    expect(primero).not.toBe(segundo);
    expect(primero).toEqual(segundo);
  });
});

describe("construirAgenteEmpleadoOperaciones — instrucción de accion inequívoca (aprobacion-conversacional-hitl, tarea 15, ADR 220 pto 2)", () => {
  /** Texto literal de ADR 220 pto 2 — compartido, sin refactor, por las tres superficies de prompt. */
  const TEXTO_ACCION_INEQUIVOCA =
    "Cuando el empleado te pida resolver una solicitud (`aprobar` o `rechazar`) o un reembolso (`aprobar`, `rechazar` o " +
    "`reabrir`), la acción tiene que salir de una frase inequívoca del empleado. " +
    "Si dice algo ambiguo " +
    "—'resolvelo', 'dale', 'hacé lo que corresponda', 'fijate vos'— preguntá " +
    "cuál de las acciones quiere en vez de elegir una. Nunca elegís vos la " +
    "acción, ni la deducís del contexto, ni del dictamen, ni de lo que parezca " +
    "más razonable.";

  it("el systemPrompt incluye el texto exacto de ADR 220 pto 2, con 'reabrir' scoped solo a reembolso", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain(TEXTO_ACCION_INEQUIVOCA);
  });

  it("suma la enumeración de resolver escalaciones de reembolso y solicitudes internas", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain(
      "resolver escalaciones de reembolso y solicitudes internas que te toque validar",
    );
  });

  it("regresión: la frase de confirmación original NO cambió ni una letra", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain(
      'Si la herramienta te devuelve un pedido de confirmación, comunicáselo tal cual al empleado y esperá su respuesta explícita en un mensaje siguiente antes de volver a invocar la misma operación: nunca decidas vos que "ya quedó confirmado".',
    );
  });
});

describe("construirAgenteEmpleadoOperaciones — instrucción de solicitar_devolucion sin token (devolucion-sin-token-dos-personas, tarea 24, ADR 233 pto 3-5, RD-109)", () => {
  /** Texto literal de ADR 233 pto 3-5 — duplicado a propósito en `buildOperacionesEmpleadoPrompt` (`soporte-prompt.ts`). */
  const TEXTO_DEVOLUCION_SIN_TOKEN =
    "Cuando la herramienta te confirme que una devolución sin token quedó " +
    "iniciada (`solicitar_devolucion`), decíselo al empleado sin prometer " +
    "plazos: la venta quedó pendiente de reembolso y la tiene que aprobar un " +
    "administrador distinto — no vos, y no el que la vendió. No digas que la " +
    "plata se devolvió, porque no se devolvió. Repetí el eco del primer turno " +
    "tal cual te lo dio la herramienta, sin resumirlo ni redondearlo — incluye " +
    "`ventaId`, `clienteId`, `monto`, `estado` y `planNuevo`. Si el empleado no " +
    "te dio un `motivo`, pedíselo y esperá su respuesta: nunca lo escribas vos " +
    "ni lo deduzcas de la conversación.";

  it("incluye el texto exacto de que la devolución NO está hecha, sin prometer plazos", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain(TEXTO_DEVOLUCION_SIN_TOKEN);
  });

  it("nunca dice que la plata ya se devolvió al iniciar (solo escala/queda pendiente)", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain("No digas que la plata se devolvió, porque no se devolvió.");
  });

  it("instruye a repetir el eco del primer turno tal cual, sin resumir, con los cinco campos", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain("sin resumirlo ni redondearlo");
    for (const campo of ["`ventaId`", "`clienteId`", "`monto`", "`estado`", "`planNuevo`"]) {
      expect(agente.systemPrompt).toContain(campo);
    }
  });

  it("instruye a pedir el motivo sin sugerirlo ni deducirlo de la conversación", () => {
    const agente = construirAgenteEmpleadoOperaciones();

    expect(agente.systemPrompt).toContain("nunca lo escribas vos ni lo deduzcas de la conversación");
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

  it("el validador-solicitudes sabe que decide una persona autorizada distinta del solicitante y no da pasos (ADR 303)", () => {
    const validador = getSubagentDefinition(VALIDADOR_SOLICITUDES_AGENT_ID);
    const prompt = validador?.systemPrompt ?? "";

    expect(prompt).toContain("No aprobás ni rechazás");
    expect(prompt).toContain("persona autorizada");
    expect(prompt).toContain("distinta de quien la pidió");
    expect(prompt).toContain("no indiques comandos, herramientas ni pasos");
    expect(prompt).not.toContain("/aprobar-solicitud");
    expect(prompt).not.toContain("/rechazar-solicitud");
    expect(prompt).not.toContain("resolver_solicitud");
    expect(prompt).not.toContain("empleado autenticado");
    // El rol no cambia (spec solicitud-interna-hitl, "El rol del validador no cambia").
    expect(validador?.description).toBe(
      "Evalúa si una solicitud interna (vacaciones o gasto) está completa y " +
        "cumple las reglas conocidas, y emite un dictamen. No aprueba ni " +
        "rechaza.",
    );
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
