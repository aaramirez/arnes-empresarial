/**
 * Componente raíz del Adaptador TUI (I1) — Hito 1, tarea 14.
 *
 * Renders the employee's conversation with the harness: a one-time product
 * banner (`Banner.tsx` — "Light" ASCII art plus a tagline) above everything
 * else, a scrollback of prompt/response turns accumulated within this
 * process's session, and a single input line at the bottom. `onSubmit` (I1's
 * `SubmitPromptHandler`, `tui-port.ts`) is injected — this component has no
 * idea what is on the other side of I1, on purpose: wiring a real Núcleo
 * handler is Hito 1 tarea 15's job, not this one's (see `tui-port.ts`'s
 * module doc).
 *
 * The pending-turn indicator combines an animated `ink-spinner` glyph with
 * the literal text "Pensando..." — the text is what carries the semantics
 * (and what this module's own tests assert on; the spinner's specific
 * animation frame at any instant is not asserted, to avoid coupling tests to
 * `ink-spinner`'s internal timer).
 *
 * Design decision — turns accumulate in React state, not just render the
 * latest one: the arc42 Escenario de calidad 2 ("un segundo prompt en la
 * misma sesión debe recuperar el contexto del primero") is only
 * demonstrable end-to-end once tarea 15 wires real memory. `tasks.md`'s own
 * entry for tarea 14 is a single line ("Adaptador TUI (I1): entrada/salida
 * por terminal con Ink.") — it does not itself spell out a render
 * requirement. Rendering more than one accumulated turn is this component's
 * own preparation for that later scenario: showing only the latest turn
 * would work for tarea 14 in isolation, but would force a rework once tarea
 * 15 wires real memory and the second-prompt-recalls-history scenario needs
 * somewhere to actually display that recovered history.
 *
 * Design decision — one turn in flight at a time: `useInput`'s `isActive`
 * option is tied to `pending`, so raw mode input is entirely ignored (not
 * just Enter) while a previous turn's `onSubmit` promise has not settled
 * yet. Nothing in this hito's scope asks for a queued/concurrent-turns UX,
 * and allowing a second `onSubmit` call to start before the first resolves
 * would risk two in-flight turns racing to update `history` for what is
 * conceptually a single sequential conversation — simpler to disallow it at
 * the input layer than to reconcile overlapping async updates.
 *
 * `pendingRef` (a ref, not just the `pending` state) backs the guard inside
 * the input handler itself, in addition to `isActive`: React (re-)runs
 * `useInput`'s internal `useEffect` — the one that subscribes/unsubscribes
 * the raw stdin listener when `isActive` flips — asynchronously, not in the
 * same synchronous tick as the `setPending(true)` call that requests it.
 * Relying on `isActive` alone would leave a real (if narrow) window where a
 * still-attached listener from before that flip fires with a stale closure
 * that still sees `pending === false`. `pendingRef.current` is written
 * synchronously in `submitDraft`, so the guard is correct immediately, and
 * `isActive` stays as the mechanism that actually tears down raw mode
 * shortly after — belt and suspenders, not a redundant duplicate.
 *
 * `draftRef` (mirroring the `draft` state, same reasoning as `pendingRef`
 * above) is what `submitDraft` actually reads, instead of the `draft` state
 * variable directly: `useInput` only replaces its subscribed listener via a
 * `useEffect` — deferred, same as the `isActive` resubscription — every
 * keystroke's handler is a fresh closure over that render's `draft`, but
 * which closure is *currently subscribed* lags one render behind by
 * construction. Two raw stdin writes issued back-to-back with no tick in
 * between (unrealistic for a human typing, but not for a fast paste
 * immediately followed by Enter, or for driving this component
 * programmatically) can both land on the *same*, now-stale, listener — if
 * `submitDraft` read the `draft` variable directly, it would send whatever
 * `draft` was at the time *that* listener's render happened, not the
 * characters a later, not-yet-subscribed keystroke already appended to
 * state. Reading `draftRef.current` instead sidesteps that lag entirely:
 * every append/backspace/submit writes it synchronously before scheduling
 * the matching `setDraft` (which only exists to trigger the re-render that
 * shows it), so whichever listener instance happens to be attached always
 * sees the true current draft, not a snapshot of its own render.
 *
 * Design decision — empty submissions are a no-op: pressing Enter on a
 * blank (or all-whitespace) draft neither calls `onSubmit` nor appends a
 * turn. Not asked for explicitly, but submitting nothing is not a
 * meaningful prompt to send to the Núcleo, and letting it through would
 * clutter the accumulated history with empty turns.
 *
 * Design decision — errors render inline, they do not crash the process:
 * `onSubmit` rejecting (network/model failure, out of this adapter's
 * control) is caught at the call site and stored on the offending turn's
 * record as `status: "error"`, rendered as `Error: <message>` instead of
 * letting the rejection become an unhandled promise rejection. This is
 * deliberately not a sophisticated policy (tarea 14 does not ask for
 * retry/backoff) — just "do not leave the process in a broken state without
 * visible feedback", per this task's instructions.
 *
 * That same guarantee has to hold for a *synchronous* throw from `onSubmit`
 * too, not only a rejected promise — `SubmitPromptHandler`'s type promises a
 * `Promise<TuiTurnResult>` return, but nothing stops a real implementation
 * from throwing before it ever returns one (e.g. a non-`async` handler with
 * a validation bug). `submitDraft` wraps the `onSubmit(prompt)` call itself
 * in `try`/`catch`, routing a synchronous throw into the same `settleTurn`
 * error path the rejection handler below already uses — instead of letting
 * it propagate out of `submitDraft`, out of the `useInput` callback, and
 * become an uncaught exception on the underlying stdin `EventEmitter`, which
 * would crash the process in a real terminal, and separately leave
 * `pendingRef`/`pending` stuck at `true` forever (the `settleTurn` call that
 * resets them would never run), permanently blocking all further input via
 * the guard below. Deliberately `try`/`catch` around a direct, synchronous
 * `onSubmit(prompt)` call, not `Promise.resolve().then(() =>
 * onSubmit(prompt))` (an earlier version of this fix, which also catches the
 * throw): that alternative defers the call itself to a microtask, changing
 * `onSubmit` from being invoked synchronously within the same keystroke's
 * `useInput` callback — relied upon elsewhere, e.g. by this module's own
 * test suite asserting `onSubmit` was called immediately after a raw Enter
 * keypress with no `await` in between — to one microtask later. Fixed
 * post-review (Reviewer finding, CRITICAL) — the first version of this
 * module called `onSubmit(prompt).then(...)` with no `try`/`catch` around it
 * at all and had exactly this bug.
 *
 * Backspace handling checks both `key.backspace` and `key.delete`: Ink's own
 * `parse-keypress.js` maps the raw byte a real terminal sends for the
 * Backspace key (`\x7f`, i.e. DEL) to `key.name === "delete"`, not
 * `"backspace"` (`\b`/`\x08` is what maps to `"backspace"`, rarely sent by
 * real terminals for that key) — checking only one of the two would make
 * Backspace not work in a real terminal despite passing a naive test.
 */

import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Banner } from "./Banner.js";
import type { SubmitPromptHandler, TuiTurnResult } from "./tui-port.js";

type TurnStatus = "pending" | "done" | "error";

interface TurnRecord {
  readonly id: number;
  readonly prompt: string;
  readonly status: TurnStatus;
  readonly responseText?: string;
  readonly agentLabel?: string;
  readonly errorMessage?: string;
}

export interface AppProps {
  readonly onSubmit: SubmitPromptHandler;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App({ onSubmit }: AppProps): ReactElement {
  const [history, setHistory] = useState<readonly TurnRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const nextTurnId = useRef(0);
  // Synchronous mirror of `pending` — see the module doc's note on why the
  // input handler guards on this ref instead of (or as well as) `isActive`.
  const pendingRef = useRef(false);
  // Synchronous mirror of `draft` — see the module doc's note on why
  // `submitDraft` reads this instead of the `draft` state variable.
  const draftRef = useRef("");

  function settleTurn(id: number, outcome: Pick<TurnRecord, "status" | "responseText" | "agentLabel" | "errorMessage">) {
    setHistory((previous) =>
      previous.map((turn) => (turn.id === id ? { ...turn, ...outcome } : turn)),
    );
    pendingRef.current = false;
    setPending(false);
  }

  function submitDraft() {
    const prompt = draftRef.current.trim();
    if (prompt.length === 0) {
      return;
    }

    const id = nextTurnId.current;
    nextTurnId.current += 1;

    setHistory((previous) => [...previous, { id, prompt, status: "pending" }]);
    draftRef.current = "";
    setDraft("");
    pendingRef.current = true;
    setPending(true);

    // `onSubmit(prompt)` itself is wrapped in try/catch — see the module
    // doc's note on synchronous throws for why: a throw there hits `catch`
    // and routes into the same `settleTurn` error path a rejected `onSubmit`
    // promise already uses below, instead of propagating out of
    // `submitDraft` uncaught. Deliberately not `Promise.resolve().then(() =>
    // onSubmit(prompt))` (an earlier version of this fix) — that alternative
    // also catches a synchronous throw, but defers the *call itself* to a
    // microtask, which would change `onSubmit` from being invoked
    // synchronously within this same keystroke's `useInput` callback (relied
    // upon elsewhere, e.g. by tests asserting `onSubmit` was called
    // immediately after a raw Enter keypress) to one microtask later.
    try {
      onSubmit(prompt).then(
        (result: TuiTurnResult) => {
          settleTurn(id, {
            status: "done",
            responseText: result.responseText,
            agentLabel: result.agentLabel,
          });
        },
        (error: unknown) => {
          settleTurn(id, { status: "error", errorMessage: toErrorMessage(error) });
        },
      );
    } catch (error) {
      settleTurn(id, { status: "error", errorMessage: toErrorMessage(error) });
    }
  }

  useInput(
    (input, key) => {
      // Synchronous safety net — see the module doc's note on `pendingRef`
      // for why this cannot rely solely on `isActive` below.
      if (pendingRef.current) {
        return;
      }

      if (key.return) {
        submitDraft();
        return;
      }

      if (key.backspace || key.delete) {
        draftRef.current = draftRef.current.slice(0, -1);
        setDraft(draftRef.current);
        return;
      }

      // Ignore other control/navigation keys (arrows, tab, escape, ctrl
      // combos) — this hito's input is a single-line draft with no cursor
      // movement or history navigation.
      if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) {
        return;
      }

      draftRef.current = draftRef.current + input;
      setDraft(draftRef.current);
    },
    { isActive: !pending },
  );

  return (
    <Box flexDirection="column">
      <Banner />
      {history.map((turn) => (
        <Box key={turn.id} flexDirection="column">
          <Text>Vos: {turn.prompt}</Text>
          {turn.status === "pending" && (
            <Text dimColor>
              <Spinner type="dots" /> Pensando...
            </Text>
          )}
          {turn.status === "done" && (
            <Text>
              {turn.agentLabel}: {turn.responseText}
            </Text>
          )}
          {turn.status === "error" && <Text color="red">Error: {turn.errorMessage}</Text>}
        </Box>
      ))}
      <Text>{`> ${draft}`}</Text>
    </Box>
  );
}
