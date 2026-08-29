/**
 * Arranque del Adaptador TUI (I1) — Hito 1, tarea 14.
 *
 * `startTui` is this adapter's single public entry point: it mounts `App`
 * (`App.tsx`) — where all of I1's actual behavior lives — with the given
 * `onSubmit` (`SubmitPromptHandler`, `tui-port.ts`) as its I1 handler.
 *
 * Nota de alcance — sin caller de producción todavía: nothing in this repo
 * calls `startTui` yet, and there is no default `onSubmit` that reaches a
 * real Núcleo — that wiring, plus the real process entry point
 * (`package.json`'s `dev` script already points at
 * `src/adapters/tui/main.ts`, which does not exist yet), is Hito 1 tarea
 * 15's job (Integración end-to-end), not this task's.
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
 */

import { render, type Instance } from "ink";
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
 * Mounts the TUI (`App`) with `onSubmit` as its I1 handler for submitted
 * prompts, and returns the mounted instance.
 *
 * `renderTui` defaults to the real Ink `render` export — see the module
 * doc's "`renderTui` as an injectable parameter" note for why. Production
 * callers (the future end-to-end integration, Hito 1 tarea 15) omit it.
 */
export function startTui(onSubmit: SubmitPromptHandler, renderTui: RenderTui = render): TuiInstance {
  return renderTui(<App onSubmit={onSubmit} />);
}
