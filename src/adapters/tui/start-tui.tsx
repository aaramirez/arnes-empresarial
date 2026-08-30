/**
 * Arranque del Adaptador TUI (I1) — Hito 1, tarea 14.
 *
 * `startTui` is this adapter's single public entry point: it mounts `App`
 * (`App.tsx`) — where all of I1's actual behavior lives — with the given
 * `onSubmit` (`SubmitPromptHandler`, `tui-port.ts`) as its I1 handler.
 *
 * Nota de alcance — actualizado por tarea 15: `startTui`'s real production
 * caller is now `src/main.ts` (the composition root — deliberately outside
 * `src/adapters/tui/` itself; see that file's own module doc for why),
 * which builds the real `onSubmit` around `handleTurn`
 * (`src/core/turn-selector/handle-turn.ts`) and calls `startTui(onSubmit)`.
 * This module (`start-tui.tsx`) itself is unchanged by that wiring — it
 * still has no default `onSubmit` of its own, on purpose.
 *
 * Design decision — `renderTui` as an injectable parameter, same DI pattern
 * as `queryFn` in `invoke-model.ts` and `listAgents`/`hooks` in
 * `bootstrap.ts`: real Ink's `render()` mounts against `process.stdin`/
 * `process.stdout` by default and enables raw mode, neither of which is
 * meaningful to exercise from a unit test. `RenderTui` narrows real Ink's
 * `render` down to only the shape this module actually consumes back
 * (`unmount`/`waitUntilExit`) — real `render`'s `Instance` satisfies it
 * structurally, so production callers omit the parameter and get real
 * behavior, while tests inject a plain fake. `App.tsx`'s own test suite
 * (`App.test.tsx`), via `ink-testing-library`, is what actually exercises
 * rendered behavior — this module has nothing left to verify beyond "did it
 * mount `App` with the right prop", which is what its test checks.
 *
 * Alternate screen buffer note (post-Hito 1.0 addition, decided by the Spec
 * Author role and approved at the human checkpoint, choosing "alternate
 * screen" over "just clear the screen on startup"): `startTui` wraps the TUI
 * lifecycle with the standard ANSI sequences that switch the terminal into
 * its alternate screen buffer on entry (`ENTER_ALT_SCREEN`) and back to the
 * original buffer on exit (`EXIT_ALT_SCREEN`) — the same mechanism
 * `vim`/`htop` use: the app gets its own screen, and when it exits the
 * terminal is restored exactly to what it showed before, with none of the
 * TUI's own output left in scrollback. This is terminal control around the
 * TUI's lifecycle, so it belongs in this adapter (I1), not in the
 * composition root (`src/main.ts`) — `main.ts` shouldn't need to know
 * anything about ANSI sequences. Ink already owns showing/hiding the cursor
 * (`\x1B[?25l`/`\x1B[?25h`) on its own; this only adds the screen-buffer
 * switch, which Ink does not do.
 *
 * Cursor-home note (bugfix, reported by the user after trying the alternate
 * screen buffer live: the banner rendered mid-screen instead of at the top).
 * `ENTER_ALT_SCREEN` (`\x1B[?1049h`) is not enough on its own: switching into
 * the alternate screen buffer does not guarantee the cursor lands at the
 * terminal's top-left corner on every terminal emulator — some preserve
 * whatever row the cursor was on in the previous buffer when they switch.
 * Ink's first frame draws assuming "wherever the cursor is right now" is its
 * own row 0; if the cursor is left mid-screen when the alternate buffer is
 * entered, that first frame (the banner) starts there instead of at the top.
 * `CLEAR_AND_HOME` (`\x1B[2J\x1B[H`) fixes this explicitly: `\x1B[2J` clears
 * the (now-alternate) screen and `\x1B[H` moves the cursor to row 1, column 1
 * — so Ink's row 0 is always the terminal's actual top row, regardless of
 * what the previous buffer's cursor position was.
 *
 * `writeToTerminal` is injectable for the same reason `renderTui` is (see
 * above), same DI pattern as `now`/`write` in `turn-logger.ts` and `queryFn`
 * in `invoke-model.ts` — the real default writes to `process.stdout`, which
 * isn't meaningful to assert on in a unit test.
 *
 * The exit sequence is written from `waitUntilExit()`'s `.finally(...)`, not
 * `.then(...)`, so that whatever `waitUntilExit()` itself resolves or
 * rejects with keeps propagating unchanged to the caller — same criterion
 * already applied in `main.ts`'s `try`/`finally` around `db.close()`. The
 * `writeToTerminal(EXIT_ALT_SCREEN)` call inside that `finally` is itself
 * wrapped in its own `try`/`catch` (Reviewer finding, WARNING, post-first
 * version of this file): `Promise.prototype.finally`'s callback throwing
 * REPLACES whatever the original promise resolved or rejected with — a
 * `writeToTerminal` failure (e.g. `process.stdout` already torn down during
 * process exit) would silently mask the real `waitUntilExit()` outcome
 * instead of just failing to restore the screen buffer. Same
 * "cleanup must never mask the real result" criterion `turn-logger.ts`'s
 * `createFileLogWriter` and `main.ts`'s own `db.close()` catch already
 * apply.
 *
 * Entry-path crash guard (Reviewer finding, `code-review`, post-`CLEAR_AND_HOME`
 * version of this file): `renderTui(...)` itself is now wrapped in its own
 * `try`/`catch`. Before this, if `renderTui` threw synchronously (a
 * React/Ink reconciler error), `instance` was never assigned, so the
 * `EXIT_ALT_SCREEN` write — which only happens from the wrapped
 * `waitUntilExit()` built around `instance` — could never run either,
 * leaving the terminal stuck on the alternate screen with no way to recover
 * short of `reset`/`tput rmcup`. The `catch` here writes `EXIT_ALT_SCREEN`
 * (itself in its own best-effort `try`/`catch`, same criterion as the exit
 * path above) and rethrows the original error unchanged.
 *
 * `waitUntilExit()` idempotency (Reviewer finding, `code-review`, same
 * round): real Ink's `waitUntilExit()` memoizes its promise
 * (`this.exitPromise ||= new Promise(...)`, verified against
 * `ink/build/ink.js`) — calling it more than once returns the exact same
 * promise, which is part of `Instance`'s real contract. The wrapper here
 * does the same via a closed-over `exitPromise` variable populated on first
 * call; without it, each call to the wrapped `waitUntilExit()` would attach
 * a fresh `.finally(...)` to the same underlying promise and write
 * `EXIT_ALT_SCREEN` again — harmless today (`main.ts` only calls it once)
 * but a silent break of `TuiInstance`'s contract for any future caller that
 * relies on Ink's real idempotent semantics.
 */

import { render, type Instance } from "ink";
import type { ReactElement } from "react";
import { App } from "./App.js";
import type { SubmitPromptHandler } from "./tui-port.js";

/** ANSI sequence that switches the terminal into the alternate screen buffer. */
const ENTER_ALT_SCREEN = "\x1B[?1049h";

/** ANSI sequence that restores the terminal's original screen buffer. */
const EXIT_ALT_SCREEN = "\x1B[?1049l";

/**
 * ANSI sequence that clears the screen (`\x1B[2J`) and moves the cursor to
 * the top-left corner (`\x1B[H`). See the module doc's "Cursor-home note"
 * for why this is needed in addition to `ENTER_ALT_SCREEN`.
 */
const CLEAR_AND_HOME = "\x1B[2J\x1B[H";

/**
 * The slice of Ink's `Instance` this module actually depends on. See the
 * module doc's "`renderTui` as an injectable parameter" note for why this
 * is narrower than `Instance` itself.
 */
export type TuiInstance = Pick<Instance, "unmount" | "waitUntilExit">;

/** The slice of `typeof render`'s shape this module actually depends on. */
export type RenderTui = (tree: ReactElement) => TuiInstance;

/**
 * Writes raw data to the terminal. See the module doc's "Alternate screen
 * buffer note" for why this is injectable and what it's used for here.
 */
export type WriteToTerminal = (data: string) => void;

/**
 * Mounts the TUI (`App`) with `onSubmit` as its I1 handler for submitted
 * prompts, switching the terminal into its alternate screen buffer and then
 * clearing it and homing the cursor before rendering — see the module doc's
 * "Alternate screen buffer note" and "Cursor-home note" for why — and back
 * to the original buffer on exit. Returns the mounted instance, wrapping
 * `waitUntilExit` so the exit sequence is written once it settles, either
 * way.
 *
 * `renderTui` defaults to the real Ink `render` export, `writeToTerminal`
 * defaults to writing to `process.stdout` — see the module doc's DI notes
 * for why. Production callers (the future end-to-end integration, Hito 1
 * tarea 15) omit both.
 */
export function startTui(
  onSubmit: SubmitPromptHandler,
  renderTui: RenderTui = render,
  writeToTerminal: WriteToTerminal = (data) => process.stdout.write(data),
): TuiInstance {
  writeToTerminal(ENTER_ALT_SCREEN);
  writeToTerminal(CLEAR_AND_HOME);

  let instance: TuiInstance;
  try {
    instance = renderTui(<App onSubmit={onSubmit} />);
  } catch (error) {
    // `renderTui` throwing synchronously (a React/Ink reconciler error) means
    // `instance` never gets created — and since the exit sequence is
    // normally only written from the wrapped `waitUntilExit()` built around
    // `instance` below, that write would otherwise never happen, leaving the
    // user's terminal stuck on the alternate screen. Same best-effort
    // "cleanup must never mask the real result" criterion as the `finally`
    // block below: restore the screen buffer here too, then rethrow the
    // original error unchanged.
    try {
      writeToTerminal(EXIT_ALT_SCREEN);
    } catch {
      // Best-effort — see above.
    }
    throw error;
  }

  // Memoized so the wrapper stays idempotent like Ink's own `waitUntilExit`
  // (verified against `ink`'s implementation: it caches its exit promise via
  // `this.exitPromise ||= new Promise(...)` and returns the same promise on
  // repeated calls). Without this, each call would attach a new `.finally`
  // to the same underlying promise, writing `EXIT_ALT_SCREEN` once per call
  // instead of once per exit.
  let exitPromise: ReturnType<TuiInstance["waitUntilExit"]> | undefined;

  return {
    unmount: (...args) => instance.unmount(...args),
    waitUntilExit: () =>
      (exitPromise ??= instance.waitUntilExit().finally(() => {
        try {
          writeToTerminal(EXIT_ALT_SCREEN);
        } catch {
          // Best-effort — see the module doc's note on why this must never
          // mask the real resolve/reject of `waitUntilExit()`.
        }
      })),
  };
}
