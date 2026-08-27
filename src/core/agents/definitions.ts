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
 */

/** Configuration for a single first-level agent, independent of any SDK. */
export interface AgentDefinition {
  /** Stable identifier used across the harness (e.g. `sesiones_agente.agent_id`). */
  readonly id: string;
  /** Instructions that define the agent's role and behavior for the model. */
  readonly systemPrompt: string;
  /**
   * Tool names the agent is allowed to invoke. Empty means the agent can
   * only converse — see the scope note on `CONVERSATIONAL_AGENT` below for
   * why the MVP agent starts with no tools.
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
 * The only agent defined for Hito 1 (esqueleto conversacional).
 *
 * Nota de alcance — herramientas: `allowedTools` is intentionally empty.
 * This hito does not exercise the knowledge base (I2), A2A (I4) is not
 * active yet, and Comandos/Skills are not exercised in this hito either
 * (see `openspec/changes/hito-1.0-esqueleto-conversacional/tasks.md`,
 * tarea 13's scope note). Granting tool access (Bash, Write, etc.) without
 * a real use case is a security decision that should not be made ahead of
 * need — it belongs to whichever future hito introduces the business
 * capability that actually requires it.
 */
const CONVERSATIONAL_AGENT: AgentDefinition = {
  id: CONVERSATIONAL_AGENT_ID,
  systemPrompt:
    "Sos el agente conversacional de un arnés empresarial. Tu rol en este " +
    "hito es sostener una conversación clara y coherente con el empleado, " +
    "manteniendo el contexto de la sesión en curso. Todavía no tenés acceso " +
    "a herramientas, base de conocimiento ni delegación a otros agentes " +
    "— respondé únicamente con lo que la conversación te da. Si el pedido " +
    "requiere una capacidad que no tenés disponible, decilo explícitamente " +
    "en vez de inventar una respuesta.",
  allowedTools: [],
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
