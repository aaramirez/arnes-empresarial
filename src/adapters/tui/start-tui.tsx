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
 * `clearScreen` is injectable for the same reason `renderTui` is (see
 * above), same DI pattern as `now`/`write` in `turn-logger.ts` and `queryFn`
 * in `invoke-model.ts` — the real default (`defaultClearScreen`) writes to
 * `process.stdout` via `node:readline`, which isn't meaningful to assert on
 * in a unit test.
 *
 * Alternate screen buffer removal note (post-Hito 1.0 change, decided with
 * the user after a live bug report: the banner "dragged" down the screen on
 * every prompt, and the mouse wheel could not scroll up to see earlier
 * messages or full long responses). Root cause: the alternate screen buffer
 * (`\x1B[?1049h`/`\x1B[?1049l`, this module's previous approach) is, by
 * standard terminal convention — the same reason `vim`/`htop` use it — a
 * FIXED-SIZE buffer with no scrollback of its own. `<Static>` (`App.tsx`,
 * see that module's own doc for the full explanation of what it needs and
 * why) relies on genuine terminal scrollback to keep already-rendered
 * content around; inside the alternate buffer, anything `<Static>` writes
 * past that fixed height has nowhere to go and gets overwritten/lost, no
 * matter how correctly it is implemented. That explains both symptoms. This
 * module no longer enters the alternate screen buffer at all — it stays on
 * the terminal's NORMAL buffer, where `<Static>` gets real, native,
 * mouse-wheel scrollback with no artificial limit.
 *
 * Clearing the screen and homing the cursor is still needed even without the
 * alternate screen buffer, for the same original reason: so Ink's first
 * frame (the banner) starts at the terminal's actual top row instead of
 * wherever the shell's cursor happened to be left.
 *
 * Raw ANSI (`\x1B[2J\x1B[H`, this module's previous approach) was replaced
 * by `node:readline`'s `cursorTo`/`clearScreenDown`, after a live bug report
 * from the user (screenshot attached) confirmed the raw sequence does not
 * reliably clear the screen in the Windows legacy console host
 * (`conhost.exe`, no ConPTY — confirmed with the user, not Windows
 * Terminal): running `npm run dev` there left the PowerShell/`tsx` lines
 * visible above the banner instead of being cleared. Root cause: that
 * legacy console does not interpret raw VT/ANSI escape sequences reliably —
 * a known conhost compatibility gap. `readline.cursorTo`/`clearScreenDown`
 * is the fix because it is the exact mechanism Node's own `console.clear()`
 * uses internally — it is built specifically to behave correctly
 * cross-platform, including on that legacy console, instead of writing raw
 * escape codes by hand. Like the raw `\x1B[2J` before it, this only clears
 * what is currently VISIBLE — it does not touch scrollback — so any prior
 * shell output remains reachable by scrolling up, it just is not shown on
 * startup, which is the visual effect that was originally requested.
 *
 * Accepted trade-off, confirmed with the user (not a code gap): dropping the
 * alternate screen buffer also means exiting the TUI no longer restores the
 * terminal to its exact pre-launch state — commit `31ab5c8` had made that
 * restoration a deliberate, human-checkpoint-approved requirement, which
 * this change knowingly reverses. The full conversation (banner included)
 * now remains genuine scrollback in the user's real terminal after exit,
 * the same way any normal command's stdout does — traded for being able to
 * scroll back through conversation history at all, which the alternate
 * buffer had been silently breaking.
 *
 * No instance wrapping: `renderTui`'s real return value (`Instance`) already
 * satisfies `TuiInstance` structurally, so it is returned as-is.
 *
 * No crash guard, on purpose, and for the same reason as the exit trade-off
 * above rather than because there is truly nothing to consider: unlike the
 * removed alternate-screen version, a synchronous `renderTui` throw here
 * cannot be followed by any restorative write — `clearScreen` has already
 * cleared the visible screen by that point, and there is no alternate buffer
 * left to swap back to. The crash therefore surfaces over a screen that
 * looks blank rather than over the shell's pre-launch content; the original
 * content is not lost (same scrollback note above still applies), just not
 * immediately visible. The error itself is left to propagate unchanged —
 * `main.ts` already handles that from its own `try` around this call (see
 * that file's module doc).
 */

import { render, type Instance } from "ink";
import { clearScreenDown, cursorTo } from "node:readline";
import type { ReactElement } from "react";
import { App } from "./App.js";
import type { SubmitPromptHandler } from "./tui-port.js";

/**
 * The slice of Ink's `Instance` this module actually depends on. See the
 * module doc's "`renderTui` as an injectable parameter" note for why this
 * is narrower than `Instance` itself.
 */
export type TuiInstance = Pick<Instance, "unmount" | "waitUntilExit">;

/** The slice of `typeof render`'s shape this module actually depends on. */
export type RenderTui = (tree: ReactElement) => TuiInstance;

/**
 * Clears the terminal screen and homes the cursor. See the module doc for
 * why this is injectable and why it uses `node:readline` instead of raw
 * ANSI.
 */
export type ClearScreen = () => void;

/**
 * Real default for `ClearScreen`: homes the cursor and clears everything
 * below it on `process.stdout`, via `node:readline` — the same mechanism
 * Node's own `console.clear()` uses internally. See the module doc for why
 * this replaced raw ANSI escape sequences.
 */
function defaultClearScreen(): void {
  cursorTo(process.stdout, 0, 0);
  clearScreenDown(process.stdout);
}

/**
 * Mounts the TUI (`App`) with `onSubmit` as its I1 handler for submitted
 * prompts, clearing the (normal) screen and homing the cursor first — see
 * the module doc for why — and returns the mounted instance as-is.
 *
 * `renderTui` defaults to the real Ink `render` export, `clearScreen`
 * defaults to `defaultClearScreen` (real `node:readline` calls against
 * `process.stdout`) — see the module doc's DI notes for why. Production
 * callers (`src/main.ts`) omit both.
 */
export function startTui(
  onSubmit: SubmitPromptHandler,
  renderTui: RenderTui = render,
  clearScreen: ClearScreen = defaultClearScreen,
): TuiInstance {
  clearScreen();
  return renderTui(<App onSubmit={onSubmit} />);
}
