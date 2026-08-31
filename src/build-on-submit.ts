/**
 * Builds `main.ts`'s `onSubmit` (I1, `SubmitPromptHandler`) — extracted out
 * of `main.ts` itself so this wiring has its own test file
 * (`build-on-submit.test.ts`), instead of living only as inline code inside
 * a composition root that runs module-level side effects
 * (`bootstrapHarness()`, a real `openDatabase()` against SQLite, a real
 * `createCaso()`, and a top-level `await`) and so cannot be imported from a
 * test at all — importing it would trigger all of that for real. See
 * `main.ts`'s own module doc, "Ubicación" section, for why THAT file lives
 * at `src/` root (same level as `core/`/`adapters/`, above both) instead of
 * inside either adapter folder: this module is the same kind of
 * composition-root wiring, for the same reason, so it lives at that same
 * level too, not inside `src/core/` (it imports from `src/adapters/tui/`,
 * which `src/core/*` may never do) nor inside `src/adapters/tui/` (it also
 * imports `handleTurn`/`resolveTurn` straight from `src/core/`, and per
 * AGENTS.md's non-negotiable rule "Ningún adaptador se comunica directamente
 * con otro adaptador — todo pasa por el núcleo", a file that wires the TUI
 * adapter directly to core turn-handling logic cannot live inside the TUI
 * adapter's own folder without that becoming, structurally, one adapter
 * reaching into the core on the adapter layer's behalf in a way that reads
 * exactly like the forbidden adapter-to-adapter shape).
 *
 * `resolveTurn(prompt, agents)` is called here TOO, redundantly, before
 * `handleTurn` — moved from `main.ts`'s own former inline comment at this
 * call site, because this is where the reasoning now lives. Done so the TUI
 * can show which agent is handling a turn (`onAgentResolved`, the second
 * optional parameter of `SubmitPromptHandler`, `tui-port.ts`) synchronously,
 * before the promise `handleTurn` returns even starts resolving. This does
 * NOT duplicate real business logic: `handleTurn` (`handle-turn.ts`,
 * deliberately not touched by this change — already reviewed and stable)
 * calls `resolveTurn(prompt, candidateAgents)` synchronously as its own
 * first step, before any `await`, and `resolveTurn` (`resolve-turn.ts`) is a
 * PURE, deterministic function — given the same `prompt` and the same
 * `agents` list, it always returns the same agent. Calling it here with
 * those same arguments only repeats a trivial, side-effect-free lookup, not
 * a re-implementation of turn selection; there is no risk of the two calls
 * returning different agents. The alternative — changing `handleTurn`'s
 * contract so it exposes the resolved agent via a callback — would touch an
 * already-reviewed, stable module, which this change deliberately avoids.
 */
import { resolveTurn } from "./core/turn-selector/resolve-turn.js";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { SubmitPromptHandler } from "./adapters/tui/tui-port.js";

/**
 * Closes over `casoId`/`memory`/`hooks`/`agents` and returns the
 * `SubmitPromptHandler` the TUI adapter invokes per submitted prompt — see
 * this module's own doc for the full reasoning behind the
 * `resolveTurn`-before-`handleTurn` call order.
 *
 * `logDeps` is optional and forwarded as-is to `handleTurn`'s own `logDeps`
 * parameter — same DI pattern `HandleTurnDeps.logDeps` (`handle-turn.ts`)
 * already establishes: production (`main.ts`) omits it, so `handleTurn`
 * falls back to its real default (a file writer against
 * `data/harness.log`), exactly as if `buildOnSubmit` were not in between.
 * Tests inject a fake writer instead — this is what keeps
 * `build-on-submit.test.ts` (Reviewer finding, WARNING) from appending real
 * lines to `data/harness.log` on every run, same reasoning
 * `handle-turn.test.ts`'s own `fakeLogDeps()` already documents.
 */
export function buildOnSubmit(
  casoId: string,
  memory: MemoryPort,
  hooks: ReturnType<typeof bootstrapHarness>["hooks"],
  agents: ReturnType<typeof bootstrapHarness>["agents"],
  logDeps?: LogTurnEventDeps,
): SubmitPromptHandler {
  return (prompt, onAgentResolved) => {
    const agent = resolveTurn(prompt, agents);
    onAgentResolved?.(agent.id);
    // `logDeps` is spread in only when actually provided — `HandleTurnDeps`
    // declares it as an optional property (`logDeps?:`), which under this
    // project's `exactOptionalPropertyTypes: true` means "may be absent",
    // not "may be present with value `undefined`"; always including the key
    // (even as `undefined`) fails typecheck for that reason.
    return handleTurn(casoId, prompt, {
      memory,
      hooks,
      candidateAgents: agents,
      ...(logDeps ? { logDeps } : {}),
    });
  };
}
