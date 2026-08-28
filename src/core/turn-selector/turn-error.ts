/**
 * Manejo de errores base (Concepto transversal 1, Hito 1 tarea 11).
 *
 * The Núcleo depends on external systems that can fail — Memoria compartida
 * (I3, backed by SQLite via `src/adapters/memory/repository.ts`) and the
 * ModelProvider (I5, backed by `@anthropic-ai/claude-agent-sdk`). Without a
 * single convention, each block would decide independently whether to
 * retry, abort, or degrade — inconsistent and untraceable. This module is
 * that convention for Hito 1.
 *
 * Policy (already decided, not reopened here):
 * - No automatic retries: no existing adapter distinguishes a transient
 *   failure from a permanent one, so a blind retry is speculative
 *   complexity out of this hito's scope.
 * - The turn aborts on any failure: no degradation/fallback-response logic
 *   is defined in Hito 1.
 * - A single domain error type at the Selector de Turno boundary,
 *   `TurnFailedError`, wraps the original cause and tags which turn stage
 *   failed. This gives the future TUI Adapter (Hito 1 tarea 14, not
 *   implemented yet) one error type to handle instead of having to know
 *   every module's internal exception types (`CasoNotFoundError`,
 *   `CasoAlreadyExistsError`, `SesionAgenteAlreadyExistsError`,
 *   `SesionAgenteInvalidCasoError`, `CasoNotResolvedError`,
 *   `ModelResponseIncompleteError`, or any raw exception from
 *   `better-sqlite3`/`@anthropic-ai/claude-agent-sdk`) — the same
 *   encapsulation principle `src/adapters/memory/repository.ts` already
 *   applies one layer below (translating raw SQLite errors into domain
 *   errors).
 *
 * This module is standalone and generic: it does not import anything from
 * `assemble-context.ts`, `invoke-model.ts`, or `close-turn.ts`. Those
 * modules currently let their own errors propagate unwrapped (see their
 * "manejo de errores diferido a tarea 11" module doc notes) — wiring
 * `runTurnStage` around each of their calls is the end-to-end integration's
 * job (Hito 1 tarea 15, not implemented yet), not this task's.
 *
 * `cause` is declared as this class's own `readonly` field, not left to rely
 * solely on the inherited `Error.prototype.cause`: with `target`/`lib`
 * `ES2022` (see `tsconfig.json`), TypeScript's `lib.es2022.error.d.ts`
 * already types `Error`'s native `cause` — but as `cause?: unknown`
 * (optional), because the platform allows constructing an `Error` without
 * ever passing `{ cause }`. This class always receives a cause, so it also
 * passes it through the native `super(message, { cause })` (for
 * interoperability with anything that reads `Error.prototype.cause`, e.g.
 * console/log formatting) and redeclares its own `readonly cause: unknown`
 * (required, not optional) so callers reading `error.cause` on a
 * `TurnFailedError` don't have to narrow away `undefined` themselves.
 */

export type TurnStage = "context" | "model" | "close";

export class TurnFailedError extends Error {
  readonly stage: TurnStage;
  readonly cause: unknown;

  constructor(stage: TurnStage, cause: unknown) {
    super(`Turno falló en la etapa "${stage}": ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = "TurnFailedError";
    this.stage = stage;
    this.cause = cause;
  }
}

/**
 * Runs one stage of a turn, catching any error `fn` throws or its returned
 * promise rejects with, and re-throwing it wrapped in a `TurnFailedError`
 * tagged with `stage`. The intended reusable piece for the end-to-end
 * integration (Hito 1 tarea 15) to wrap each turn call:
 * `runTurnStage("context", () => assembleContext(...))`,
 * `runTurnStage("model", () => invokeModel(...))`,
 * `runTurnStage("close", () => closeTurn(...))`.
 */
export async function runTurnStage<T>(stage: TurnStage, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new TurnFailedError(stage, error);
  }
}
