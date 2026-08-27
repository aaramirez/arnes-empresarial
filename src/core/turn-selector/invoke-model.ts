/**
 * Invocador del Modelo (arc42 Caja Blanca Bloque de Construcción 1.3).
 *
 * Calls the *ModelProvider* port (I5) with the assembled context; for this
 * hito the model returns plain text with no delegation tool calls (arc42
 * Escenario de ejecución 1: "El modelo devuelve una respuesta en texto, sin
 * tool calls de delegación"), so this module does not process `tool_use`
 * blocks — that belongs to the Despachador de Delegación (Hito posterior,
 * Caja Blanca 1.4). After the turn completes, it fires the post-turn hooks
 * (Motor de Hooks, Hito 1 tarea 6), exactly as the same scenario states:
 * "Invocador del Modelo dispara los hooks de post-turno correspondientes".
 *
 * Design decision — no `ModelProvider` port/adapter split in v1: unlike I3
 * (Adaptador de Memoria), which `assemble-context.ts` deliberately puts
 * behind an injected `MemoryContextPort` interface (see that module's doc),
 * this module imports `@anthropic-ai/claude-agent-sdk` directly. AGENTS.md
 * ("Reglas técnicas no negociables") states plainly: "Motor de agentes:
 * Claude Agent SDK — sin abstracción de proveedor de modelo en el MVP"; the
 * arc42's Vista de Decisiones de Diseño adds that the ModelProvider port is
 * named in the Vista de Bloques only to not block a *future* extension,
 * "aunque solo se implemente un adaptador (Claude) por ahora". This is an
 * already-settled decision (not reopened here), and importing the SDK
 * package directly does not violate the "`src/core/` nunca importa nada de
 * `src/adapters/*`" rule — that rule scopes this repo's own `src/adapters/`
 * tree, not third-party npm packages.
 *
 * Design decision — `queryFn` as an injectable parameter: the real `query()`
 * hits the live Anthropic API over the network, which is unusable in tests
 * (no network, no guaranteed `ANTHROPIC_API_KEY`) and unrelated to what this
 * module is responsible for (mapping `AgentDefinition`/`AssembledContext`
 * into SDK options, extracting the final response, firing hooks). Same
 * dependency-injection pattern already used by `resolveTurn` (`candidates`
 * parameter, `src/core/turn-selector/resolve-turn.ts`) and `assembleContext`
 * (`MemoryContextPort` parameter, `./assemble-context.ts`): the parameter
 * defaults to the real SDK export, so production callers omit it and get
 * real behavior, while tests inject a fake async generator.
 *
 * `queryFn`'s type (`QueryFn` below) is narrower than `typeof query`: the
 * real `query()` returns `Query`, an interface that extends
 * `AsyncGenerator<SDKMessage, void>` with ~25 additional control methods
 * (`interrupt`, `setPermissionMode`, `setModel`, ...) this module never
 * calls. Typing the parameter as `typeof query` would force every test fake
 * to implement all of those just to satisfy the type. `QueryFn` instead
 * asks only for what this module actually consumes — a function returning
 * `AsyncIterable<SDKMessage>` — which `query` still satisfies structurally
 * (an async generator function is assignable to that narrower return type),
 * so the real export remains a valid default with no wrapping needed.
 *
 * Design decision — extracting response text from the `result` message, not
 * by concatenating `assistant` message text blocks: the real installed
 * `.d.ts` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) documents
 * that a streamed turn can emit *multiple* `assistant` messages, one per
 * completed content block, so naively concatenating them is fragile against
 * that framing. The same `.d.ts` documents `SDKResultMessage`
 * (`type: "result"`) as "the outcome of a turn... emit[ted] exactly one
 * result message per turn"; its `subtype: "success"` variant
 * (`SDKResultSuccess`) carries the authoritative final text on its `result`
 * field ("subtype 'success' carries the final assistant text in result").
 * That is a more robust source of truth than re-deriving it from
 * `assistant` message content blocks, so this module reads `result` instead
 * — a deliberate improvement over the block-concatenation approach sketched
 * ahead of reading the real types, kept here as a documented deviation.
 *
 * Design decision — sdk session id from the `system`/`init` message: the
 * same `.d.ts` documents `SDKSystemMessage` (`subtype: "init"`) as "Session
 * metadata the CLI emits at the start of each turn, normally ahead of every
 * other message of that turn: session_id, ...". This module reads
 * `sdkSessionId` from that message, which is also the shape suggested
 * ahead of reading the real types and confirmed to hold up against them.
 *
 * Design decision — post-turn hook dispatch, not SDK native `options.hooks`:
 * per `hook-engine.ts`'s module doc, the Motor de Hooks (Hito 1 tarea 6) is
 * a standalone in-process engine, deliberately decoupled from the SDK's own
 * native hook system. This module calls `hookEngine.triggerHook("POST_TURN",
 * ...)` as a plain function call once the turn's messages have been fully
 * consumed — it does not register anything under `options.hooks`. There is
 * no real use case for the SDK's native hooks yet (the only registered
 * agent has `allowedTools: []`, so there is nothing to intercept around a
 * tool call), so wiring that integration now would be speculative.
 *
 * Design decision — error handling deferred: same criterion already applied
 * by `hook-engine.ts` and `assemble-context.ts` — Manejo de errores base
 * (Hito 1, tarea 11) has not run yet. If `queryFn` throws or its returned
 * generator rejects, this module lets that exception propagate unwrapped;
 * see `ModelResponseIncompleteError` below for the one error this module
 * does define itself (a turn that ends without ever producing a successful
 * result), which is a distinct case from a `queryFn` failure.
 *
 * Fix 1 (post-tarea-9 Reviewer finding, CRITICAL) — tool restriction via
 * `options.agent` + `options.agents[id]`, not `options.allowedTools`: the
 * first version of this module mapped `agent.allowedTools` to
 * `Options.allowedTools`. The real `.d.ts` documents that field as only a
 * list of tools "auto-allowed without prompting" — it does NOT restrict the
 * available toolset — with an explicit pointer: "To restrict which tools
 * are available, use the `tools` option instead." With
 * `CONVERSATIONAL_AGENT.allowedTools: []` (whose own doc in `definitions.ts`
 * claims "the agent can only converse"), that bug meant the agent likely
 * kept the SDK's full default toolset (Bash, Read, Write, Edit, ...)
 * against the real API — a real security gap, not a naming nitpick.
 *
 * Two real restriction mechanisms exist in the `.d.ts`: the top-level
 * `Options.tools` field (line ~1496, restricts the base built-in toolset
 * directly), and `Options.agent` (singular, line ~1416) + `Options.agents`
 * (plural, line ~1432). This module uses the second: `Options.agent`'s own
 * doc comment says "Agent name for the main thread. When specified, the
 * agent's system prompt, tool restrictions, and model will be applied to
 * the main conversation" — i.e. it is the SDK's mechanism for configuring
 * THE single top-level agent driving the main conversation, which is
 * exactly this hito's shape (one MVP agent, no subagents yet). It is also
 * the mapping `definitions.ts` (Hito 1, tarea 5, already approved) already
 * anticipated in its own module doc: "Invocador del Modelo (Hito 1, tarea
 * 9) is the piece that eventually maps an `AgentDefinition` to the real
 * `options.agents[id]` shape the SDK's `query()` expects (`description`/
 * `prompt` required, `tools`/`model` optional)". `Options.agents` (plural)
 * is documented as "Programmatically define custom subagents that can be
 * invoked via the Agent tool" — the *registry* of agent configs — while
 * `Options.agent` (singular) is what *selects* one of those registry
 * entries to run as the main thread, instead of as a subagent invoked by
 * the `Agent` tool. Using the top-level `Options.tools` field instead would
 * have fixed the restriction bug too, but would keep `systemPrompt`/`model`
 * on three separate top-level fields instead of one bundled per-agent
 * config — less coherent with the multi-agent shape `definitions.ts`
 * already designed its comment around, and with where a second agent
 * (a future hito) would naturally add its own `agents[id]` entry.
 *
 * `Options.agents[id]` requires a `description` field (this SDK's own
 * `AgentDefinition` type, re-exported here as `SdkAgentDefinition` to avoid
 * a name clash with this repo's core `AgentDefinition`) that the core
 * `AgentDefinition` type does not carry — see `toMainThreadAgentDescription`
 * below for how this module derives one without adding a new required
 * field to `definitions.ts` (already approved, out of scope to reopen for
 * this fix).
 *
 * Fix 2 (post-tarea-9 Reviewer finding) — `is_error` on `result/success` was
 * ignored: `SDKResultSuccess` (`subtype: "success"`) carries an `is_error:
 * boolean` field that can be `true` even on the "success" subtype — the
 * `.d.ts` documents this as "with is_error true, the error text when the
 * turn ended on an API error". The first version of this module accepted
 * any `subtype: "success"` message as a valid final answer, so a transient
 * API error surfaced this way would have its error text captured as
 * `responseText`, fired through `POST_TURN`, and returned to the caller as
 * if it were a real model response — silently persisting an error as
 * conversation. This module now also requires `is_error === false`; a
 * `subtype: "success"` message with `is_error: true` is treated the same as
 * "no successful result arrived" (see `ModelResponseIncompleteError` below),
 * reusing that existing error instead of introducing a second error type for
 * what is, from this module's contract, the same outcome: the turn did not
 * produce a usable answer.
 */

import {
  query,
  type AgentDefinition as SdkAgentDefinition,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "../agents/definitions.js";
import type { HookContext, HookEngine } from "../hooks/hook-engine.js";
import type { AssembledContext } from "./assemble-context.js";

/**
 * The slice of `typeof query`'s shape this module actually depends on. See
 * the module doc's "`queryFn` as an injectable parameter" note for why this
 * is narrower than `typeof query` itself.
 */
export type QueryFn = (params: {
  readonly prompt: string;
  readonly options?: Options;
}) => AsyncIterable<SDKMessage>;

/** Result the Invocador del Modelo produces for a completed turn. */
export interface InvokeModelResult {
  /** Final assistant response text for this turn (from the SDK's `result` message). */
  readonly responseText: string;
  /**
   * The SDK session id this turn ran under. The caller (Escritura de cierre
   * de turno, Hito 1, tarea 10) is the intended consumer that persists this
   * into `sesiones_agente.sdk_session_id` so a later turn in the same
   * `caso` can resume it via `AssembledContext.resumeSessionId`.
   */
  readonly sdkSessionId: string;
}

/**
 * Thrown when `queryFn`'s async generator completes without ever producing
 * both a `system`/`init` message (session id) and a *genuinely successful*
 * `result`/`success` message (response text). A distinct failure from a
 * `queryFn` rejection (see the module doc's "error handling deferred"
 * note): this is not the SDK/network failing, it is the SDK completing
 * normally but the turn not resolving into a usable answer. Three cases
 * fall under this: the turn ended on a terminal `result` subtype other than
 * `success` (e.g. `error_max_turns`); it never produced a `result` message
 * at all; or it produced a `result/success` message with `is_error: true`
 * (see the module doc's "Fix 2" note — that flag means the "success" text
 * is actually API error text, not a real model answer, so it is treated the
 * same as no successful result). Turn 1's happy path (Escenario de
 * ejecución 1) never exercises any of these, but the contract still has to
 * define a behavior for them instead of silently returning an incomplete or
 * incorrect result.
 */
export class ModelResponseIncompleteError extends Error {
  constructor(missing: { readonly sdkSessionId: boolean; readonly responseText: boolean }) {
    const parts: string[] = [];
    if (missing.sdkSessionId) parts.push("no se recibió session_id (mensaje system/init)");
    if (missing.responseText) parts.push("no se recibió texto de respuesta (mensaje result/success)");
    super(`Invocador del Modelo: turno incompleto — ${parts.join("; ")}`);
    this.name = "ModelResponseIncompleteError";
  }
}

/**
 * Derives the `description` the SDK's `AgentDefinition` requires for every
 * entry in `options.agents` (see the module doc's "Fix 1" note). The core
 * `AgentDefinition` type (`definitions.ts`, already approved) has no
 * description field to reuse, so this synthesizes a stable one from the
 * agent's id instead of adding a new required field to that module.
 *
 * This is a low-stakes placeholder on purpose: `description` only matters
 * for subagent routing via the SDK's `Agent` tool (it tells a delegating
 * agent "when to use this agent"). This hito's single agent has
 * `allowedTools: []` and is selected directly via `options.agent` (not
 * discovered/routed to via the `Agent` tool), so no code path ever reads
 * this string to make a routing decision. Exported so the test suite
 * asserts against the same derivation instead of duplicating its wording.
 */
export function toMainThreadAgentDescription(agentId: string): string {
  return `Agente principal del Hito 1 (registro: ${agentId})`;
}

/**
 * Maps a core `AgentDefinition` into the SDK's own `AgentDefinition` shape
 * (`SdkAgentDefinition`) for `options.agents[agent.id]`. `tools` (not
 * `allowedTools` — see the module doc's "Fix 1" note) is what actually
 * restricts the agent's available toolset.
 */
function toSdkAgentDefinition(agent: AgentDefinition): SdkAgentDefinition {
  return {
    description: toMainThreadAgentDescription(agent.id),
    prompt: agent.systemPrompt,
    tools: [...agent.allowedTools],
    model: agent.model,
  };
}

/**
 * Maps `agent` + `context` into the SDK's `Options` shape. Registers
 * `agent` under `options.agents[agent.id]` and selects it as the main
 * thread's agent via `options.agent` (see the module doc's "Fix 1" note for
 * why this replaces the earlier direct `systemPrompt`/`allowedTools`/`model`
 * top-level mapping). `resume` is set only when `context.resumeSessionId`
 * is defined — with `exactOptionalPropertyTypes: true` (see
 * `tsconfig.json`), assigning `resume: undefined` explicitly is a distinct
 * type error from omitting the property, so this builds the object
 * incrementally instead of always including the key.
 */
function toQueryOptions(agent: AgentDefinition, context: AssembledContext): Options {
  const options: Options = {
    agent: agent.id,
    agents: { [agent.id]: toSdkAgentDefinition(agent) },
  };

  if (context.resumeSessionId !== undefined) {
    options.resume = context.resumeSessionId;
  }

  return options;
}

/**
 * Calls the model via the SDK's `query()` (I5) with `agent`'s configuration
 * and `context`'s resumed session (if any), consumes the turn's messages,
 * and fires the `POST_TURN` hook once the turn is fully resolved.
 *
 * `queryFn` defaults to the real SDK `query` export — see the module doc's
 * "`queryFn` as an injectable parameter" note for why. Production callers
 * (the future end-to-end integration, Hito 1 tarea 15) omit it.
 *
 * Throws `ModelResponseIncompleteError` if the turn ends without a usable
 * session id + response text. Lets any `queryFn` rejection propagate
 * unwrapped (error policy deferred to Hito 1, tarea 11).
 */
export async function invokeModel(
  agent: AgentDefinition,
  context: AssembledContext,
  prompt: string,
  hookEngine: HookEngine,
  queryFn: QueryFn = query,
): Promise<InvokeModelResult> {
  const options = toQueryOptions(agent, context);

  let sdkSessionId: string | undefined;
  let responseText: string | undefined;

  for await (const message of queryFn({ prompt, options })) {
    if (message.type === "system" && message.subtype === "init") {
      sdkSessionId = message.session_id;
    } else if (message.type === "result" && message.subtype === "success" && !message.is_error) {
      // `is_error: true` on a "success" subtype means `.result` is API
      // error text, not a real answer — see the module doc's "Fix 2" note.
      // Leaving `responseText` unset here routes this turn into the same
      // `ModelResponseIncompleteError` path as any other non-answer.
      responseText = message.result;
    }
  }

  if (sdkSessionId === undefined || responseText === undefined) {
    throw new ModelResponseIncompleteError({
      sdkSessionId: sdkSessionId === undefined,
      responseText: responseText === undefined,
    });
  }

  const hookContext: HookContext = {
    casoId: context.caso.id,
    agentId: agent.id,
    sdkSessionId,
    responseText,
  };
  await hookEngine.triggerHook("POST_TURN", hookContext);

  return { responseText, sdkSessionId };
}
