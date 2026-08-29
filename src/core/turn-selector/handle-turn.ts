/**
 * Manejador de Turno — composición end-to-end del Selector de Turno (arc42
 * Caja Blanca bloque de construcción 1), Hito 1, tarea 15.
 *
 * This is the piece every earlier task in this hito's Selector de Turno
 * left for the integration to wire together: `resolveTurn` (tarea 7),
 * `assembleContext` (tarea 8), `invokeModel` (tarea 9), `closeTurn`
 * (tarea 10), `runTurnStage` (tarea 11), and `logTurnEvent` (tarea 12), in
 * the exact sequence the arc42 Escenario de ejecución 1 describes:
 * resolve → assemble context (I3 read) → invoke model (I5) → close turn
 * (I3 write) → respond. It lives in `src/core/` (not an adapter): it only
 * imports from other `src/core/*` modules, never from `src/adapters/*` —
 * same non-negotiable rule `assemble-context.ts` and `close-turn.ts`
 * already document for their own `MemoryContextPort`/`MemoryWritePort`.
 * The real adapters are wired in by the process entrypoint (`src/main.ts`,
 * this same tarea) — deliberately outside `src/adapters/tui/` and
 * `src/adapters/memory/`: AGENTS.md's non-negotiable rule "Ningún
 * adaptador se comunica directamente con otro adaptador — todo pasa por
 * el núcleo" would be violated by a composition root that lives inside
 * either adapter folder and imports the other directly. `src/main.ts`
 * sits at the same level as `core/`/`adapters/`, above both, which is
 * exactly the layer whose job is to know about and wire concrete
 * adapters together.
 *
 * Design decision — `resolveTurn` runs outside `runTurnStage`: `TurnStage`
 * (`turn-error.ts`, tarea 11) is `"context" | "model" | "close"` — no
 * `"resolve"` entry, and that is not an oversight. `bootstrapHarness`
 * (tarea 13) already validates at startup that `agents.length > 0`, so by
 * the time `handleTurn` runs (always after a successful bootstrap — see
 * `main.ts`), `resolveTurn`'s only failure mode, `NoAgentAvailableError`,
 * is structurally unreachable. Adding a `"resolve"` stage to `TurnStage`
 * to wrap an error that can never fire would reopen an already-settled
 * type for no behavioral gain.
 *
 * Design decision — `deps` object, not positional parameters, for the
 * injectable collaborators: unlike `resolveTurn`/`assembleContext`/
 * `invokeModel`/`closeTurn` (each with one or two injectable
 * dependencies, so a positional parameter reads fine), this function has
 * several unrelated collaborators (`memory`, `hooks`, `candidateAgents`,
 * `queryFn`) that are always supplied together by the same caller
 * (`main.ts`) and never partially defaulted in production — a `deps`
 * object groups them without forcing every call site to remember a fixed
 * positional order for several same-ish-looking values. None of them has
 * a hidden default that reaches real I/O: production `main.ts` always
 * builds and passes `memory`/`hooks`/`candidateAgents` explicitly
 * (`openDatabase` closures for `memory`, the `HookEngine` and `agents`
 * `bootstrapHarness` already resolved) and omits `queryFn` (see its own
 * note below for why that is the one deliberate exception) — there is no
 * bare call anywhere that silently talks to a real database. `casoId` and
 * `prompt` stay positional (mirroring `assembleContext(memory, casoId,
 * agentId)`'s own `casoId` parameter): they are per-call data, not shared
 * collaborators, so grouping them into `deps` would blur that distinction
 * for no benefit.
 *
 * Design decision — `queryFn` forwarded through `HandleTurnDeps`, not
 * dropped at this layer: `invokeModel` (tarea 9) already exposes `queryFn`
 * as an injectable parameter defaulting to the real SDK `query` export —
 * the same DI pattern `resolveTurn`'s `candidates` and `closeTurn`'s
 * `deps` use. `HandleTurnDeps.queryFn` is optional and forwarded as-is to
 * `invokeModel`; passing `undefined` (the production/omitted case) lets
 * `invokeModel`'s own default parameter apply exactly as if `handleTurn`
 * had not been in between at all. This keeps `handle-turn.test.ts` able to
 * inject a typed fake generator, consistent with every other test in this
 * hito, instead of being the one test file that has to `vi.mock` a
 * third-party module to avoid a real network call.
 *
 * `candidateAgents` is required from the caller (the agents
 * `bootstrapHarness` already resolved at startup), never a fresh
 * `listAgentDefinitions()` call made here — `resolveTurn`'s own default
 * parameter does exactly that already, but reusing it here would mean
 * `handleTurn` and `bootstrapHarness` could each observe a different
 * registry snapshot (today identical in practice, since the registry is a
 * static `Map`, but the dependency this way is explicit instead of
 * incidental) and would bypass the fixed startup order tarea 13 exists to
 * establish ("Registro de Agentes... antes que la integración end-to-end,
 * tarea 15, no después").
 *
 * Design decision — `estado` is a module-level constant
 * (`CASO_ESTADO_ACTIVO`), not a `handleTurn` parameter: Hito 1 defines no
 * business state machine for `casos.tipo = 'conversacion'` (`close-turn.ts`'s
 * own module doc already establishes this — "Hito 1 no define una máquina
 * de estados de negocio... inventar un valor acá sería una decisión de
 * negocio fuera de alcance"). That doc settles the *value* is arbitrary;
 * it does not settle *where* that single value should live. Since exactly
 * one process-wide value is reused for the entire run (both the initial
 * `caso` `main.ts` creates before mounting the TUI, and every `closeTurn`
 * call this module makes afterwards — see `main.ts`'s own module doc), a
 * shared named constant in the one module that actually calls `closeTurn`
 * is the single source of truth `main.ts` imports from, instead of a
 * string literal duplicated (and possibly drifting) across two files, or
 * a `handleTurn` parameter every call site would have to thread through
 * identically anyway.
 *
 * Design decision — the returned shape is this module's own
 * `HandleTurnResult`, not an import of the TUI adapter's `TuiTurnResult`
 * (`src/adapters/tui/tui-port.ts`): `src/core/` never imports from
 * `src/adapters/*`, full stop — even a type-only import would violate
 * that rule. `HandleTurnResult` is structurally identical
 * (`responseText`/`agentLabel`, both `string`), so `main.ts`'s `onSubmit`
 * (typed as `SubmitPromptHandler`, whose return type is
 * `Promise<TuiTurnResult>`) can return `handleTurn(...)`'s result as-is —
 * TypeScript's structural typing accepts it with no adapter/mapping code
 * needed at the wiring layer, exactly like `QueryFn`'s narrower shape
 * already accepts the real SDK `query` export in `invoke-model.ts`.
 * `agentLabel` is `agent.id` — the only human-facing identifier an
 * `AgentDefinition` carries in this hito (see `definitions.ts`); it is
 * also literally the "estado del agente" the arc42 Interfase 1 asks I1 to
 * transport on its output side (`tui-port.ts`'s own module doc quotes
 * this).
 *
 * Design decision — logging: `logTurnEvent` fires unconditionally on
 * success (`"turno-completado"`), and also (deliberately, though the
 * tarea 15 instructions leave this optional) in the `catch` block when the
 * caught error is a `TurnFailedError` (`"turno-fallido"`, tagged with
 * `error.stage`) — before that error is re-thrown, never swallowed. A
 * turn that fails partway through (e.g. the model answered but the I3
 * close-write failed) is exactly the kind of event Concepto Transversal 3
 * (Observabilidad, tarea 12's own scope) exists to make traceable by
 * `casoId`; logging only the happy path would leave every failure
 * invisible in the structured log stream tarea 12 established. A
 * `NoAgentAvailableError` from `resolveTurn` (structurally unreachable
 * post-bootstrap, per the note above) is not a `TurnFailedError`, so it
 * is not logged here — it propagates unwrapped, same as it would from any
 * other caller.
 */

import type { AgentDefinition } from "../agents/definitions.js";
import type { HookEngine } from "../hooks/hook-engine.js";
import { logTurnEvent } from "../logging/turn-logger.js";
import { assembleContext, type MemoryContextPort } from "./assemble-context.js";
import { closeTurn, type MemoryWritePort } from "./close-turn.js";
import { invokeModel, type QueryFn } from "./invoke-model.js";
import { resolveTurn } from "./resolve-turn.js";
import { runTurnStage, TurnFailedError } from "./turn-error.js";

/**
 * Single `casos.estado` value this hito reuses for the whole process run —
 * see the module doc's "`estado` es una constante de módulo" note for why
 * this lives here instead of being invented ad hoc by `main.ts` or passed
 * as a `handleTurn` parameter. `main.ts` imports this same constant for the
 * initial `caso` it creates before mounting the TUI, so the value used at
 * creation and the value every `closeTurn` call writes back are always the
 * same literal, by construction — not just by convention.
 */
export const CASO_ESTADO_ACTIVO = "activo";

/**
 * The I3 read + write ports `handleTurn` needs — the union of
 * `MemoryContextPort` (`assemble-context.ts`) and `MemoryWritePort`
 * (`close-turn.ts`). A single object so `main.ts` builds one set of
 * one-line closures around the real `repository.ts` functions and passes
 * it once, instead of two structurally-overlapping-but-separate port
 * objects.
 */
export type MemoryPort = MemoryContextPort & MemoryWritePort;

/** Collaborators `handleTurn` needs beyond the per-call `casoId`/`prompt`. See the module doc's "`deps` object" note for why these are grouped here. */
export interface HandleTurnDeps {
  readonly memory: MemoryPort;
  readonly hooks: HookEngine;
  /** The agents `bootstrapHarness` (tarea 13) already resolved at startup — never a fresh registry read here. */
  readonly candidateAgents: readonly AgentDefinition[];
  /**
   * Forwarded as-is to `invokeModel`'s own `queryFn` parameter. Omit in
   * production — `invokeModel` defaults it to the real SDK `query` export.
   * See the module doc's "`queryFn` forwarded through `HandleTurnDeps`"
   * note for why this exists instead of always relying on `invokeModel`'s
   * default directly.
   */
  readonly queryFn?: QueryFn;
}

/**
 * What a completed turn renders. Structurally identical to the TUI
 * adapter's `TuiTurnResult` on purpose — see the module doc's "returned
 * shape" note for why this module defines its own type instead of
 * importing that one.
 */
export interface HandleTurnResult {
  /** Final assistant response text for this turn. */
  readonly responseText: string;
  /** Which agent produced `responseText` (`AgentDefinition.id`). */
  readonly agentLabel: string;
}

/**
 * Runs one full turn: resolves the agent, assembles context via I3
 * (tarea 8), invokes the model via I5 and fires `POST_TURN` (tarea 9),
 * closes the turn via I3 (tarea 10) — each of the three I/O-touching
 * stages wrapped by `runTurnStage` (tarea 11) so any failure surfaces as a
 * `TurnFailedError` tagged with the stage that failed — and logs the
 * outcome (tarea 12) keyed by `casoId`.
 *
 * Lets `TurnFailedError` (and, per the module doc's "resolveTurn runs
 * outside runTurnStage" note, the structurally-unreachable
 * `NoAgentAvailableError`) propagate to the caller after logging; never
 * swallows a failure.
 */
export async function handleTurn(
  casoId: string,
  prompt: string,
  deps: HandleTurnDeps,
): Promise<HandleTurnResult> {
  const { memory, hooks, candidateAgents, queryFn } = deps;

  const agent = resolveTurn(prompt, candidateAgents);

  try {
    const context = await runTurnStage("context", () => assembleContext(memory, casoId, agent.id));
    const result = await runTurnStage("model", () => invokeModel(agent, context, prompt, hooks, queryFn));
    await runTurnStage("close", () => closeTurn(memory, context, agent, result, CASO_ESTADO_ACTIVO));

    logTurnEvent(casoId, "turno-completado", {
      agentId: agent.id,
      sdkSessionId: result.sdkSessionId,
    });

    return { responseText: result.responseText, agentLabel: agent.id };
  } catch (error) {
    if (error instanceof TurnFailedError) {
      logTurnEvent(casoId, "turno-fallido", {
        agentId: agent.id,
        stage: error.stage,
        message: error.message,
      });
    }
    throw error;
  }
}
