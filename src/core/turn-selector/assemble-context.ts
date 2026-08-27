/**
 * Ensamblador de Contexto (arc42 Caja Blanca Bloque de Construcción 1.2) —
 * read-only slice for Hito 1, tarea 8.
 *
 * Resolves, via I3 (Adaptador de Memoria Compartida), the `caso` and the
 * SDK session to resume for the agent handling this turn — before the
 * Invocador del Modelo (Hito 1, tarea 9) calls the model. This is the
 * literal sequence from the arc42 Escenario de ejecución 1: "El Ensamblador
 * de Contexto resuelve, vía I3..., el caso y la sesión del SDK a retomar" —
 * and the Escenario de calidad 2 ("Corrección funcional multi-turno"):
 * "el Ensamblador de Contexto resuelve vía I3 la sesión del SDK a retomar
 * (options.resume), que aporta el historial completo de ese agente; el
 * contexto de un agente no se mezcla con el de otro que haya participado
 * en el mismo caso."
 *
 * Nota de alcance — solo lectura (tarea 8): this module does NOT create a
 * `caso`. `tasks.md` marks this task explicitly "— lectura"; creating the
 * first `caso` of a session belongs to an earlier layer (Secuencia de
 * arranque, tarea 13, or the end-to-end Integración, tarea 15 — neither
 * implemented yet). By the time `assembleContext` runs, a `caso` for
 * `casoId` MUST already exist — see `CasoNotResolvedError` below for what
 * happens when that invariant is violated.
 *
 * Nota de alcance — conocimiento (I2) fuera de alcance: the arc42 describes
 * this block as also combining base-de-conocimiento results (I2) into the
 * context (Escenario de ejecución 2). That is out of scope for this hito:
 * the only agent registered (`CONVERSATIONAL_AGENT`,
 * `src/core/agents/definitions.ts`) has `allowedTools: []`, so there is
 * never a knowledge result to combine. This module only assembles the I3
 * half of the block's responsibility.
 *
 * Design decision — I3 as an injected port, not a direct adapter import:
 * AGENTS.md ("Reglas técnicas no negociables") states `src/core/` never
 * imports anything from `src/adapters/*`. Unlike the ModelProvider port
 * (I5), which the arc42 explicitly names "puerto ModelProvider" and
 * abstracts on purpose even with a single (Claude) adapter today, I3 does
 * not get that same explicit "puerto" framing in the arc42 — its format is
 * described simply as "consultas SQL sobre el archivo SQLite local". Still,
 * the non-negotiable import rule applies to every adapter, not only A2A/I4,
 * so this module defines `MemoryContextPort` locally instead of importing
 * `getCasoById` / `getLatestSesionAgente` from
 * `src/adapters/memory/repository.ts` directly. The port's method
 * signatures are structurally identical to those two functions (each
 * already bound to a concrete `db` handle by the caller) minus the `db`
 * parameter — so the wiring layer (Hito 1, tarea 13/15, not implemented
 * yet) plugs in the real adapter with a one-line closure per method, with
 * no logic duplicated, exactly as tarea 8's instructions ask ("no
 * reimplementes nada de eso"). The test file exercises this port against
 * the real adapter + a real in-memory SQLite `db`, not a hand-written
 * stub, so the contract is verified against actual I3 behavior.
 */

/**
 * Case snapshot this block needs. Structurally identical to `Caso` from
 * the Memory Adapter (`src/adapters/memory/repository.ts`) — the real
 * `getCasoById` result satisfies this shape as-is, no mapping required at
 * the wiring layer.
 */
export interface CasoSnapshot {
  readonly id: string;
  readonly tipo: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The I3 read operations this block depends on. See the module doc above
 * for why this is an injected port instead of a direct import from
 * `src/adapters/memory/repository.ts`.
 */
export interface MemoryContextPort {
  /** Reads a `caso` by id. Returns `undefined` if it does not exist. */
  getCasoById(casoId: string): CasoSnapshot | undefined;
  /**
   * Resolves the current `sesion_agente` for `casoId` + `agentId`. Returns
   * `undefined` when this agent has not participated in this case yet —
   * a legitimate outcome, not an error (see `assembleContext` below).
   * Only `sdkSessionId` is required from the result; a richer value (e.g.
   * the real `SesionAgente`) is accepted too, since it structurally
   * satisfies this narrower shape.
   */
  getLatestSesionAgente(
    casoId: string,
    agentId: string,
  ): { readonly sdkSessionId: string } | undefined;
}

/**
 * Result the Invocador del Modelo (Hito 1, tarea 9) consumes: the resolved
 * `caso` and the SDK session id to pass as `options.resume`, if any.
 */
export interface AssembledContext {
  readonly caso: CasoSnapshot;
  /**
   * The SDK session to resume for this agent in this case. `undefined`
   * means this agent has no prior session in this case — the Invocador del
   * Modelo starts a fresh SDK session for it (no `options.resume`), which
   * is exactly the isolation the arc42 Escenario de calidad 2 requires:
   * "el contexto de un agente no se mezcla con el de otro que haya
   * participado en el mismo caso".
   */
  readonly resumeSessionId: string | undefined;
}

/**
 * Thrown when `casoId` does not resolve to an existing `caso`. Unlike a
 * missing `sesion_agente` (an expected "this agent hasn't spoken in this
 * case yet" outcome), a missing `caso` at this stage is an invariant
 * violation: by tarea 8's scope ("— lectura"), `assembleContext` never
 * creates a `caso` — something upstream (Secuencia de arranque / la
 * integración end-to-end) must have created it before routing a turn here.
 *
 * A distinct error type from the Memory Adapter's `CasoNotFoundError`
 * (`src/adapters/memory/repository.ts`) on purpose: that one reports a
 * stale id on a direct read/update call against the adapter; this one
 * reports a pipeline ordering bug (a turn reached context assembly for a
 * `caso` nothing ever created) — a different failure to diagnose, at a
 * different layer. Importing the adapter's error class here would also
 * violate the same "core never imports adapters" rule the port above is
 * designed around.
 */
export class CasoNotResolvedError extends Error {
  constructor(casoId: string) {
    super(
      `Ensamblador de Contexto: no caso found for id "${casoId}" — it must be created before a turn is routed to context assembly`,
    );
    this.name = "CasoNotResolvedError";
  }
}

/**
 * Resolves the `caso` and the SDK session to resume for `agentId` within
 * `casoId`, via the injected `memory` port (I3) — before the Invocador del
 * Modelo (tarea 9) calls the model, per the arc42 Escenario de ejecución 1.
 *
 * Throws `CasoNotResolvedError` if `casoId` does not resolve to an existing
 * `caso` (see the error's doc for why this is a thrown invariant violation,
 * not an `undefined` return, unlike the `sesion_agente` lookup below).
 *
 * `resumeSessionId` is `undefined` when `agentId` has no prior session in
 * this `caso` — a legitimate first turn for this agent, even if the `caso`
 * already has history from a different agent. That per-agent isolation is
 * the exact contract the arc42 Escenario de calidad 2 asks for.
 */
export function assembleContext(
  memory: MemoryContextPort,
  casoId: string,
  agentId: string,
): AssembledContext {
  const caso = memory.getCasoById(casoId);
  if (!caso) {
    throw new CasoNotResolvedError(casoId);
  }

  const sesionAgente = memory.getLatestSesionAgente(casoId, agentId);

  return {
    caso,
    resumeSessionId: sesionAgente?.sdkSessionId,
  };
}
