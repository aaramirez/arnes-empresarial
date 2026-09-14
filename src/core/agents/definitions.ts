/**
 * Agent Registry (arc42 Caja Blanca Bloque de Construcción 2 / 2.1).
 *
 * Declares the configuration of every first-level agent available in the
 * harness (id, system prompt, allowed tools, model) and exposes a way to
 * resolve that configuration by id. Resolución de Turno (Hito 1, tarea 7)
 * is the intended consumer of `getAgentDefinition` / `listAgentDefinitions`.
 *
 * SDK-agnostic by design: this module does NOT import
 * `@anthropic-ai/claude-agent-sdk` — that package is not even a project
 * dependency yet. `AgentDefinition` is a domain type of this core module,
 * decoupled from SDK infrastructure, consistent with the hexagonal rule
 * that `src/core/` never depends on adapter/SDK concerns. Invocador del
 * Modelo (Hito 1, tarea 9) is the piece that eventually maps an
 * `AgentDefinition` to the real `options.agents[id]` shape the SDK's
 * `query()` expects (`description`/`prompt` required, `tools`/`model`
 * optional) — field names here favor core readability (`systemPrompt` over
 * `prompt`) over a 1:1 match with that external shape.
 *
 * `KNOWLEDGE_TOOL_QUALIFIED_NAME` is imported from
 * `src/core/knowledge/knowledge-contract.ts` (Hito 2, tarea 1), a
 * dependency-free core module — importing it does not violate the
 * SDK-agnostic rule above, it is still core talking to core.
 */
import { KNOWLEDGE_TOOL_QUALIFIED_NAME } from "../knowledge/knowledge-contract.js";
import { OPERACIONES_TOOL_QUALIFIED_NAME } from "../operaciones/operaciones-contract.js";
import { CONSULTAS_TOOL_QUALIFIED_NAME } from "./consultas-negocio-tool.js";
import {
  WORKTREE_TEST_TOOL_QUALIFIED_NAME,
  type WorktreeAbierto,
} from "./worktree-contract.js";

/** Configuration for a single first-level agent, independent of any SDK. */
export interface AgentDefinition {
  /** Stable identifier used across the harness (e.g. `sesiones_agente.agent_id`). */
  readonly id: string;
  /**
   * Human-readable summary of the agent's role, forwarded verbatim into the
   * SDK's `options.agents[id].description` (Invocador del Modelo, Hito 5
   * tarea 9) so the model can route delegations by role. Mandatory —
   * required for both the first-level agent and every subagent (Hito 5,
   * design.md §5.2).
   */
  readonly description: string;
  /** Instructions that define the agent's role and behavior for the model. */
  readonly systemPrompt: string;
  /**
   * Tool names the agent is allowed to invoke. See the scope note on
   * `CONVERSATIONAL_AGENT` below for the current toolset and the security
   * consequence of adding an entry here.
   */
  readonly allowedTools: readonly string[];
  /** Claude model identifier this agent is invoked with. */
  readonly model: string;
}

/**
 * Initial MVP model choice. Not mandated by the arc42/plan documents — this
 * is a reasonable current default, kept as a single named constant so it
 * can be changed later without hunting for hardcoded strings across the
 * codebase.
 *
 * Uses the SDK's short model alias (`"sonnet"`) instead of a dated
 * snapshot id on purpose: the SDK resolves the alias to whichever Sonnet
 * generation is current on its side, so this constant does not go stale
 * the moment Anthropic ships a newer model — no re-pinning this file every
 * release.
 */
export const DEFAULT_AGENT_MODEL = "sonnet";

/** Id of the single MVP agent. Matches `agent_id` used by the memory adapter tests. */
export const CONVERSATIONAL_AGENT_ID = "agente-conversacional";

/**
 * The only agent defined for the harness so far — Hito 1 (esqueleto
 * conversacional) plus the Hito 2 knowledge-query capability (I2) layered
 * on top.
 *
 * Nota de alcance — herramientas: `allowedTools` grants exactly one tool,
 * `KNOWLEDGE_TOOL_QUALIFIED_NAME` (`mcp__knowledge__query_knowledge_base`),
 * because I2 (consulta de conocimiento) is an active business capability of
 * Hito 2 — the agent must answer questions about company policy, process,
 * or internal documentation from the real knowledge base instead of
 * guessing. This note is scoped to `CONVERSATIONAL_AGENT` alone — it does
 * NOT mean A2A/Comandos/Skills are inactive or that this is the only agent
 * whose `allowedTools` matters when reasoning about tool exposure (a claim
 * this comment used to make, corrected in `definicion-skills`, tarea 7, ADR
 * 114): A2A (I4) has been active since `hito-3.0-a2a-servidor`, Comandos
 * since `v1.4.0`, and Skills since `definicion-skills` itself. `PLANNER_AGENT`,
 * `DEVELOPER_AGENT`, and `REVIEWER_AGENT` below all carry a static `Read` in
 * their own `allowedTools`, not an empty set — and, per that same ADR 114,
 * the three of them sometimes run as the *main* agent (not only as
 * delegated subagents: `build-on-activity.ts`/`build-on-comando-empleado.ts`
 * pass them as `invokeModel`'s first argument), so `Options.skills` reaches
 * them too. What every agent shares without exception is that none of them
 * has `Bash` in `allowedTools`.
 *
 * Consecuencia de seguridad (ADR 4): listing a tool in `allowedTools`
 * auto-approves every call the model makes to it — there is no per-call
 * human-in-the-loop confirmation. `toQueryOptions`
 * (`src/core/turn-selector/invoke-model.ts`, Hito 2 tarea 8) already
 * forwards `allowedTools` straight into the SDK's `options.allowedTools`,
 * so granting a tool here is the actual authorization decision, not a
 * formality — it should stay reserved for capabilities with a real,
 * demonstrated use case (as intentional gating still applies to Bash,
 * Write, etc.).
 *
 * Excepción acotada (Hito 5.1, tarea 26, ADR 61 pto 1-2, ADR 67) — ya no es
 * cierto sin matiz que ningún rol gana herramientas de escritura: el único
 * constructor `construirDeveloperConEscritura` (más abajo en este archivo)
 * SÍ le agrega `Write`/`Edit` al Developer, pero solo como par indivisible
 * junto con el `cwd` de un `WorktreeAbierto` ya abierto — nunca por default
 * y nunca a ningún otro rol. `CONVERSATIONAL_AGENT` (este agente) y las
 * cuatro entradas de `SUBAGENT_REGISTRY` (más abajo) siguen sin `Write`/
 * `Edit`/`Bash` en su `allowedTools` estático, con el interruptor en
 * cualquier estado — la excepción vive enteramente fuera del registro, en
 * un `AgentDefinition` nuevo construido por spread, nunca mutando el
 * original.
 */
const CONVERSATIONAL_AGENT: AgentDefinition = {
  id: CONVERSATIONAL_AGENT_ID,
  description:
    "Agente conversacional del arnés: sostiene el diálogo con el empleado y " +
    "consulta la base de conocimiento interna.",
  systemPrompt:
    "Sos el agente conversacional de un arnés empresarial. Tu rol es sostener " +
    "una conversación clara y coherente con el empleado, manteniendo el " +
    "contexto de la sesión en curso. Tenés acceso a la base de conocimiento " +
    "interna de la empresa mediante la herramienta " +
    `\`${KNOWLEDGE_TOOL_QUALIFIED_NAME}\`: usala siempre que la pregunta ` +
    "involucre políticas, procesos, documentación o cualquier dato propio de " +
    "la organización, en vez de responder de memoria. Cuando la uses, CITÁ " +
    "SIEMPRE la fuente (el `src` del resultado, y el `loc` cuando exista) " +
    "dentro de tu respuesta. Si la herramienta no devuelve conocimiento " +
    "disponible, decíselo explícitamente al empleado en vez de inventar una " +
    "respuesta. Todavía no tenés delegación a otros agentes. Además tenés " +
    "disponibles skills — procedimientos empaquetados, cada uno con su " +
    "propia descripción — invocá la que corresponda cuando su descripción " +
    "coincida con lo que te piden.",
  // "Skill" acá adentro (fix de verificación manual, post-v3.1.0): el
  // `.d.ts` del SDK marca pasar 'Skill' en este campo como deprecated a
  // favor de `AgentDefinition.skills` — pero verificado en vivo contra este
  // SDK instalado, cuando `tools` restringe a una whitelist explícita (no
  // se omite), la tool `Skill` queda afuera si no se la lista acá, sin
  // importar qué tenga `skills`. Sin esta entrada, `citar-conocimiento`
  // (y cualquier skill futura) nunca se invoca para este agente.
  //
  // `CONSULTAS_TOOL_QUALIFIED_NAME` (`consultas-negocio-a2a-entrante`, tarea
  // 9, ADR 174/176): a diferencia de `OPERACIONES_TOOL_QUALIFIED_NAME` —que
  // sólo entra al `AgentDefinition` construido por
  // `construirAgenteEmpleadoOperaciones`, nunca acá—, la tool de consultas
  // de sólo lectura SÍ entra directo a `CONVERSATIONAL_AGENT`, porque los
  // CUATRO turnos que comparten este registro (TUI, `/soporte`, webhook y
  // A2A entrante) la necesitan por igual. Que figure en `allowedTools` no la
  // vuelve alcanzable: la frontera real es `mcpServers` por turno (ADR 176,
  // Aclaración 2 de `proposal.md`) — un turno sin el servidor `consultas` en
  // su `mcpServers` no puede invocarla aunque esté en esta lista.
  allowedTools: [KNOWLEDGE_TOOL_QUALIFIED_NAME, "Skill", CONSULTAS_TOOL_QUALIFIED_NAME],
  model: DEFAULT_AGENT_MODEL,
};

/**
 * Registry of all first-level agents, keyed by id. A `Map` (not a plain
 * object) so the public query functions below don't leak an object-literal
 * shape that would need to change if a second agent is added later.
 */
const AGENT_REGISTRY: ReadonlyMap<string, AgentDefinition> = new Map([
  [CONVERSATIONAL_AGENT.id, CONVERSATIONAL_AGENT],
]);

/**
 * Resolves an `AgentDefinition` by id. Returns `undefined` if no agent is
 * registered under that id — callers (e.g. Resolución de Turno) decide how
 * to handle an unknown agent id, this module does not throw on lookup.
 */
export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.get(agentId);
}

/**
 * Lists every registered agent definition. Useful for startup wiring
 * (Hito 1, tarea 13 — Secuencia de arranque) and future multi-agent
 * resolution logic that needs to enumerate candidates.
 */
export function listAgentDefinitions(): readonly AgentDefinition[] {
  return Array.from(AGENT_REGISTRY.values());
}

// ---------------------------------------------------------------------------
// Turno de empleado con operaciones de negocio (`operaciones-negocio-conversacionales`,
// ADR 164). Construido por spread, NUNCA registrado en `AGENT_REGISTRY`.
// ---------------------------------------------------------------------------

/**
 * Texto agregado al `systemPrompt` de `CONVERSATIONAL_AGENT` cuando se
 * construye la variante de empleado con operaciones (ADR 164, design.md §3).
 * Es PROMPT, no garantía — la garantía real es que la tool sólo llega a
 * `allowedTools` de este `AgentDefinition` construido, nunca al de
 * `CONVERSATIONAL_AGENT` (R1, riesgo dominante de la propuesta).
 */
const INSTRUCCION_OPERACIONES_EMPLEADO =
  "Además tenés disponible una herramienta de operaciones de negocio " +
  `(\`${OPERACIONES_TOOL_QUALIFIED_NAME}\`) para resolver decisiones de venta, ` +
  "devoluciones, solicitudes internas propias, altas de venta ya pactadas con el " +
  "cliente y consultas del reporte de comisiones que te pida el empleado. Nunca " +
  "calculás ni proponés un monto, porcentaje o veredicto vos mismo — eso lo hace " +
  "la herramienta. Si la herramienta te devuelve un pedido de confirmación, " +
  "comunicáselo tal cual al empleado y esperá su respuesta explícita en un " +
  "mensaje siguiente antes de volver a invocar la misma operación: nunca " +
  'decidas vos que "ya quedó confirmado".';

/**
 * Construye el `AgentDefinition` del turno de empleado autenticado con
 * operaciones de negocio habilitadas (ADR 164, design.md §3). Molde EXACTO
 * de `construirDeveloperConEscritura`: spread de `CONVERSATIONAL_AGENT`,
 * nunca lo muta, nunca hay una función que devuelva "solo la parte
 * insegura". `CONVERSATIONAL_AGENT` y `AGENT_REGISTRY` NO se tocan — el
 * candidato que devuelve esta función se pasa como `candidateAgents: [...]`
 * (lista de UN elemento) a `handleTurn`, nunca se registra globalmente
 * (mismo mecanismo que `buildOnSoporte` ya usa para pasar `agents` como
 * lista explícita en vez de leer `AGENT_REGISTRY`).
 */
export function construirAgenteEmpleadoOperaciones(): AgentDefinition {
  return {
    ...CONVERSATIONAL_AGENT,
    allowedTools: [...CONVERSATIONAL_AGENT.allowedTools, OPERACIONES_TOOL_QUALIFIED_NAME],
    systemPrompt: `${CONVERSATIONAL_AGENT.systemPrompt}\n\n${INSTRUCCION_OPERACIONES_EMPLEADO}`,
  };
}

// ---------------------------------------------------------------------------
// Subagentes (Hito 5, §5.2, ADR 44/51/52).
// ---------------------------------------------------------------------------

/** Id del subagente que arma el plan de revisión de un PR (bloque 2.1). */
export const PLANNER_AGENT_ID = "planner";
/** Id del subagente que rastrea impacto y produce hallazgos concretos. */
export const DEVELOPER_AGENT_ID = "developer";
/** Id del subagente que emite el veredicto final de una revisión de PR. */
export const REVIEWER_AGENT_ID = "reviewer";
/** Id del subagente que dictamina sobre una solicitud interna (ADR 52). */
export const VALIDADOR_SOLICITUDES_AGENT_ID = "validador-solicitudes";

const PLANNER_AGENT: AgentDefinition = {
  id: PLANNER_AGENT_ID,
  description:
    "Analiza el cambio de un PR y produce el plan de revisión: qué revisar, " +
    "en qué archivos y con qué criterio. No emite veredicto.",
  systemPrompt:
    "Sos el Planner de una cadena de revisión de PRs. Analizás el cambio de " +
    "un PR y producís el plan de revisión: qué revisar, en qué archivos y " +
    "con qué criterio. No emitís veredicto — esa es tarea exclusiva del " +
    "Reviewer, más adelante en la cadena.",
  allowedTools: ["Read", "Glob"],
  model: DEFAULT_AGENT_MODEL,
};

const DEVELOPER_AGENT: AgentDefinition = {
  id: DEVELOPER_AGENT_ID,
  description:
    "Ejecuta el plan de revisión sobre el código: rastrea impacto y " +
    "produce hallazgos concretos. No emite veredicto.",
  systemPrompt:
    "Sos el Developer de una cadena de revisión de PRs. Ejecutás el plan de " +
    "revisión que te llega sobre el código: rastreás el impacto de cada " +
    "ítem del plan (call sites, propagación) y producís hallazgos " +
    "concretos. No emitís veredicto — esa es tarea exclusiva del Reviewer, " +
    "más adelante en la cadena.",
  allowedTools: ["Read", "Glob", "Grep"],
  model: DEFAULT_AGENT_MODEL,
};

const REVIEWER_AGENT: AgentDefinition = {
  id: REVIEWER_AGENT_ID,
  description:
    "Emite el veredicto final de una revisión de PR en una única línea " +
    "VEREDICTO: aprobado|observado|resuelto.",
  systemPrompt:
    "Sos el Reviewer de una cadena de revisión de PRs. Juzgás los hallazgos " +
    "que te llegan del Developer y emitís el veredicto final de la " +
    "revisión en una única línea `VEREDICTO: aprobado|observado|resuelto`. " +
    "No re-investigás el código por tu cuenta — tu rol es emitir el " +
    "veredicto sobre lo que ya te llegó en la cadena, no sustituirla.",
  allowedTools: ["Read"],
  model: DEFAULT_AGENT_MODEL,
};

const VALIDADOR_SOLICITUDES_AGENT: AgentDefinition = {
  id: VALIDADOR_SOLICITUDES_AGENT_ID,
  description:
    "Evalúa si una solicitud interna (vacaciones o gasto) está completa y " +
    "cumple las reglas conocidas, y emite un dictamen. No aprueba ni " +
    "rechaza.",
  systemPrompt:
    "Sos el validador de solicitudes internas del arnés. Evaluás si una " +
    "solicitud interna (vacaciones o gasto) está completa y cumple las " +
    "reglas conocidas, y emitís un dictamen sobre eso. No aprobás ni " +
    "rechazás la solicitud — esa decisión la toma un empleado autenticado " +
    "mediante `/aprobar-solicitud` o `/rechazar-solicitud`.",
  allowedTools: [],
  model: DEFAULT_AGENT_MODEL,
};

/**
 * Registro de los cuatro subagentes delegables (ADR 51, ADR 52). Deliberadamente
 * un `Map` separado de `AGENT_REGISTRY`, no una fusión con un campo
 * `delegable: boolean`: `resolveTurn`/`bootstrapHarness` recorren
 * `listAgentDefinitions()` y toman `candidates[0]` para el turno
 * conversacional (`resolve-turn.ts:93`), así que agregar estos cuatro roles
 * ahí haría depender ese camino del orden de inserción de un `Map` — el
 * arnés le contestaría al empleado con el system prompt de un rol de PR si
 * ese orden cambiara. Ninguno de los cuatro roles agrega `Agent`/`Task` a su
 * `allowedTools`: es lo que hace estructuralmente imposible que un
 * subagente delegue a su vez (un solo nivel de profundidad de delegación).
 */
const SUBAGENT_REGISTRY: ReadonlyMap<string, AgentDefinition> = new Map([
  [PLANNER_AGENT.id, PLANNER_AGENT],
  [DEVELOPER_AGENT.id, DEVELOPER_AGENT],
  [REVIEWER_AGENT.id, REVIEWER_AGENT],
  [VALIDADOR_SOLICITUDES_AGENT.id, VALIDADOR_SOLICITUDES_AGENT],
]);

/**
 * Resuelve un subagente por id. Misma forma pública que `getAgentDefinition`,
 * pero contra `SUBAGENT_REGISTRY` — nunca contra `AGENT_REGISTRY` (ADR 51).
 */
export function getSubagentDefinition(agentId: string): AgentDefinition | undefined {
  return SUBAGENT_REGISTRY.get(agentId);
}

/**
 * Lista los cuatro subagentes delegables. Consumido por `toQueryOptions`
 * (Hito 5, tarea 9) para registrar cada rol en `options.agents` junto al
 * agente que corre el turno, sin tocar `AGENT_REGISTRY`.
 */
export function listSubagentDefinitions(): readonly AgentDefinition[] {
  return Array.from(SUBAGENT_REGISTRY.values());
}

// ---------------------------------------------------------------------------
// Developer con escritura delegada (Hito 5.1, tarea 26, ADR 61 pto 1-2, ADR 67).
// ---------------------------------------------------------------------------

/**
 * Texto agregado al `systemPrompt` del Developer cuando gana escritura (ADR
 * 61 pto 2, ADR 67, design.md §5.2). Es PROMPT, no garantía — la garantía
 * real es la topología del worktree aislado (R2): esto solo reduce el
 * intento de escribir fuera del `cwd` asignado, no lo previene por sí solo.
 */
const INSTRUCCION_ESCRITURA_WORKTREE =
  "Para esta tarea tenés escritura habilitada (`Write`/`Edit`), pero " +
  "SOLO dentro de una copia descartable y aislada del repositorio: todo lo " +
  "que escribas fuera de tu directorio de trabajo actual se descarta y no " +
  "llega a ningún lado. Corré `mcp__worktree__run_tests` antes de dar por " +
  "terminada la tarea. No tenés, ni vas a tener, acceso a una shell.";

/**
 * El PAR indivisible que devuelve `construirDeveloperConEscritura` (ADR 67
 * pto 1). No existe una función que devuelva sólo el `agent`: así no hay
 * forma de que un `Write`/`Edit` viaje sin su `cwd` de worktree acompañándolo.
 */
export interface InvocacionDeveloperEscritura {
  readonly agent: AgentDefinition;
  /** Ruta ABSOLUTA del worktree — nunca opcional, nunca vacía. */
  readonly cwd: string;
}

/**
 * ÚNICO constructor de la variante de escritura del Developer (ADR 61 pto 2,
 * ADR 67, design.md §5.2). Los literales `"Write"` y `"Edit"` aparecen UNA
 * sola vez en todo este repo: acá adentro. `SUBAGENT_REGISTRY.developer` no
 * se toca — esta función construye un `AgentDefinition` nuevo a partir de
 * él, nunca lo muta ni lo reemplaza en el registro.
 *
 * Su único parámetro es un `WorktreeAbierto` — tipo que sólo
 * `WorktreePort.abrir` (adaptador, `src/adapters/git/`) produce — así que no
 * existe una vía de código que le dé `Write`/`Edit` al Developer sin un
 * worktree ya abierto: no acepta un `string`, no tiene valor por default, no
 * tiene sobrecarga.
 *
 * Con `HARNESS_ESCRITURA_DELEGADA=off` el composition root simplemente no
 * llama a esta función: el Developer vuelve a ser, byte por byte, el de
 * `v2.0.0` (`SUBAGENT_REGISTRY.developer`, sin cambios).
 */
export function construirDeveloperConEscritura(
  worktree: WorktreeAbierto,
): InvocacionDeveloperEscritura {
  return {
    agent: {
      ...DEVELOPER_AGENT,
      allowedTools: [
        ...DEVELOPER_AGENT.allowedTools,
        "Write",
        "Edit",
        WORKTREE_TEST_TOOL_QUALIFIED_NAME,
      ],
      systemPrompt: `${DEVELOPER_AGENT.systemPrompt}\n\n${INSTRUCCION_ESCRITURA_WORKTREE}`,
    },
    cwd: worktree.ruta,
  };
}
