/**
 * Resolución de Turno (arc42 Caja Blanca Bloque de Construcción 1.1).
 *
 * Given the incoming prompt, decides which `AgentDefinition` handles the
 * turn — the first step of the core, before the Ensamblador de Contexto
 * (Hito 1, tarea 8) and the Invocador del Modelo (Hito 1, tarea 9), per the
 * arc42 Escenario de ejecución 1 sequence.
 *
 * Design decisions for this hito (single agent registered):
 *
 * - **Candidate list as a parameter, not a hardcoded registry read**:
 *   `resolveTurn` takes `candidates` explicitly, defaulting to
 *   `listAgentDefinitions()` (the real registry from
 *   `src/core/agents/definitions.ts`). Production callers never pass it —
 *   the default covers them — but this keeps the function pure and lets
 *   tests exercise "more than one agent" or "no agents" without mutating
 *   the real registry, which today hardcodes exactly one agent. This is
 *   the part of the contract meant to survive a second agent being added:
 *   no caller signature changes, only the registry's contents grow.
 *
 * - **Empty candidate list throws `NoAgentAvailableError`, not
 *   `undefined`**: this mirrors the split already established by the
 *   Memory Adapter (`src/adapters/memory/repository.ts`) and the Agent
 *   Registry (`src/core/agents/definitions.ts`) — `undefined` return is
 *   reserved for an ordinary lookup that may or may not find a match by
 *   id (`getAgentDefinition`); a thrown domain error is reserved for an
 *   invariant violation (`CasoNotFoundError`, `CasoAlreadyExistsError`).
 *   An empty `candidates` list is not "no agent matched this prompt" —
 *   `resolveTurn` never searches by id or content in this hito — it means
 *   the harness itself has nothing registered to route to, which is a
 *   structural misconfiguration the caller cannot recover from by trying
 *   a different id. Today this is unreachable in production (the real
 *   registry always has `agente-conversacional`), but the contract must
 *   still define the behavior for when `candidates` is empty.
 *
 * - **No prompt validation here**: `prompt` is not inspected or
 *   validated. Sanitizing/validating raw user input is the Adaptador TUI's
 *   (I1) responsibility as the entry point for that input, not this core
 *   function's — `resolveTurn` only decides which agent handles whatever
 *   prompt it is given. Nothing in this hito's scope (tarea 7) asks for
 *   prompt validation, so none is added.
 *
 * - **No content-based routing**: with one agent registered the
 *   resolution is trivial, and the task explicitly does not ask for a
 *   routing algorithm. This implementation returns the first candidate.
 *   `prompt` is still a required parameter (unused today) so the contract
 *   already matches the shape a future routing implementation needs,
 *   instead of having to add it later and touch every caller.
 */

import { type AgentDefinition, listAgentDefinitions } from "../agents/definitions.js";

/**
 * Thrown when `resolveTurn` is given no candidate agents to choose from —
 * a structural misconfiguration of the harness, not a per-request lookup
 * miss. See the module doc above for why this is a thrown error instead of
 * an `undefined` return.
 */
export class NoAgentAvailableError extends Error {
  constructor() {
    super("No agent is registered to handle any turn");
    this.name = "NoAgentAvailableError";
  }
}

/**
 * Resolves which `AgentDefinition` handles `prompt`.
 *
 * `candidates` defaults to the real Agent Registry
 * (`listAgentDefinitions()`) — production callers omit it. Tests can pass
 * an explicit list to exercise multi-agent or zero-agent scenarios the
 * real registry does not have yet in this hito.
 *
 * Throws `NoAgentAvailableError` if `candidates` is empty.
 */
export function resolveTurn(
  prompt: string,
  candidates: readonly AgentDefinition[] = listAgentDefinitions(),
): AgentDefinition {
  const [firstCandidate] = candidates;
  if (!firstCandidate) {
    throw new NoAgentAvailableError();
  }

  // Hito 1 scope: a single registered agent makes this trivial by design —
  // no content-based routing over `prompt` yet (not asked for by tarea 7).
  // `prompt` stays a required parameter so the contract already matches
  // the shape a future routing implementation needs.
  return firstCandidate;
}
