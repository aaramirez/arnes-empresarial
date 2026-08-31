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
 * a validation bug). `submitDraft` wraps the `onSubmit(prompt, onAgentResolved)`
 * call itself in `try`/`catch`, routing a synchronous throw into the same `settleTurn`
 * error path the rejection handler below already uses — instead of letting
 * it propagate out of `submitDraft`, out of the `useInput` callback, and
 * become an uncaught exception on the underlying stdin `EventEmitter`, which
 * would crash the process in a real terminal, and separately leave
 * `pendingRef`/`pending` stuck at `true` forever (the `settleTurn` call that
 * resets them would never run), permanently blocking all further input via
 * the guard below. Deliberately `try`/`catch` around a direct, synchronous
 * `onSubmit(prompt, onAgentResolved)` call, not `Promise.resolve().then(() =>
 * onSubmit(prompt, onAgentResolved))` (an earlier version of this fix, which also catches the
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
 *
 * Single-line input — the draft can never contain a literal embedded line
 * break, from ANY input source, Enter still submits: this used to be the
 * multiline-insert trigger (Ctrl+J, raw byte `\n`), deliberately removed as
 * a product decision. The guarantee is enforced inside the generic
 * append-character branch itself, near the bottom of this handler, not via
 * a dedicated `input === "\n"` early-return branch (an earlier version of
 * this fix, which only covered a lone Ctrl+J keystroke): Ink's own
 * `use-input.js` module doc states plainly that "if user pastes text and
 * it's more than one character, the callback will be called only once and
 * the whole string will be passed as `input`" — a pasted multi-line blob
 * (e.g. `"linea1\nlinea2"`) therefore arrives as ONE `useInput` invocation
 * with `input` set to the entire pasted string, embedded `\n` (or, for a
 * Windows-style `\r\n` blob, `\r` too) included. An exact-match guard
 * (`input === "\n"`) is `false` for that pasted string — it only ever
 * catches a lone Ctrl+J keystroke in isolation — so the embedded newline
 * would fall straight through, unguarded, into the very append branch that
 * guard was meant to protect. Confirmed directly against
 * `parse-keypress.js`: neither a lone `\n` (`key.name === "enter"`) nor the
 * embedded `\n` inside a longer paste (which matches none of
 * `parseKeypress`'s branches, leaving `key.name === ""`) is in
 * `use-input.js`'s exported `nonAlphanumericKeys` list, so `input` is left
 * holding the raw byte(s) in both cases — no `key.*` flag this handler
 * checks ever sees either one.
 *
 * That embedded `\r`/`\n` is REPLACED with a single space right before
 * `input` is appended to `draftRef`, not deleted outright (an earlier
 * version of this fix): a product decision that a pasted multi-line blob
 * should stay readable as space-joined text (`"linea1\nlinea2"` →
 * `"linea1 linea2"`) instead of having its lines silently smashed together
 * with no separator at all. The regex collapses one-or-more consecutive
 * `\r`/`\n` characters into exactly ONE space (`/[\r\n]+/g`, not
 * `/[\r\n]/g`), so a Windows-style `\r\n` pair — two characters, one logical
 * line break — produces a single space, not two. One consequence,
 * deliberately not special-cased: a LONE Ctrl+J keystroke is matched by this
 * same regex on this same branch (see above — `input`/`key` give no way to
 * tell it apart from a `\n` embedded inside a longer paste), so it now also
 * inserts a single space into the draft instead of being swallowed entirely
 * as it was before this change. This closes both the single-keystroke and
 * the pasted-blob path with one mechanism, instead of layering a second,
 * narrower guard in front of it that only ever handled the single-keystroke
 * case.
 *
 * Command history navigation — arrow-up/down walk `promptHistoryRef` the
 * same way `bash`/`readline` walk their own history: `historyIndexRef` is
 * `null` while the draft shown is the live, in-progress one (the
 * "present"); pressing arrow-up for the first time snapshots that
 * in-progress draft into `draftBeforeHistoryRef` *before* overwriting
 * `draftRef` with a recalled entry, so it can be given back verbatim later.
 * Repeated arrow-up walks strictly older entries and clamps at index 0
 * (does not wrap around); arrow-down walks back towards the present and,
 * once past the newest recalled entry, restores `draftBeforeHistoryRef`
 * instead of whatever the recalled entry now reads.
 *
 * Editing a recalled entry (typing a character, backspace) does
 * NOT persist the edit back into `promptHistoryRef`, and deliberately does
 * NOT reset `historyIndexRef` either — those branches mutate `draftRef`
 * exactly like they already did before this feature existed, unaware
 * history navigation is even active. The practical effect (same as `bash`):
 * editing a recalled line and then pressing arrow-up again discards that
 * edit and jumps to the *previous* history entry, not to the edited text.
 * This is not an oversight to "fix" later — it is the same mental model
 * `readline` users already have, and avoiding it would require actively
 * writing the edited draft back into `promptHistoryRef[historyIndexRef]` on
 * every keystroke, which is both more code and a different (unrequested)
 * UX.
 *
 * `submitDraft` always appends the sent prompt to `promptHistoryRef` and
 * resets `historyIndexRef` to `null` — sending a prompt (whether freshly
 * typed or recalled from history) always returns the user to the present,
 * and the just-sent prompt becomes the newest entry for the next
 * arrow-up, same as `bash`. No deduplication against the previous entry:
 * out of scope for this hito, same reasoning as the rest of this module's
 * deliberately-simple choices.
 *
 * The `key.upArrow`/`key.downArrow` branches only fire when none of
 * `key.ctrl`/`key.meta`/`key.shift` is set — a modified arrow (Ctrl+Up,
 * Shift+Down, etc.) falls through to the generic ignore branch below
 * instead, same as it did before history navigation existed. Ink's
 * `parse-keypress.js` sets `key.name` (and therefore `key.upArrow`) from the
 * CSI sequence's final letter independently of the modifier bit — a CSI
 * sequence like `\x1b[1;5A` (Ctrl+Up) parses to `key.name === "up"` AND
 * `key.ctrl === true` simultaneously (see `use-input.js`'s `handleData`,
 * which builds `key.upArrow` and `key.ctrl` from the same `parseKeypress`
 * call without one excluding the other) — checking `key.upArrow` alone would
 * make every modified arrow combination navigate history too, which is not
 * something this hito asked for and silently regresses the pre-existing
 * "any control combo is a no-op" behavior for arrows specifically.
 */

import { Box, Static, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Banner, BANNER_LINE_COUNT } from "./Banner.js";
import type { SubmitPromptHandler, TuiTurnResult } from "./tui-port.js";

// Settled turns render via Ink's `<Static>`, not a fixed visible-turn
// window: a fixed window (e.g. "only the last N turns") would just
// reintroduce, by construction, the exact problem this design avoids — old
// or long responses becoming unreachable/corrupted once the conversation
// outgrows the terminal's live-redraw region. Root cause, verified directly
// against Ink's source (`node_modules/ink/build/log-update.js`, `ink.js`):
// every render, Ink erases and rewrites its ENTIRE live output region via
// relative-cursor escape codes, on the assumption that region is still
// exactly where it left it. Once that region's total height exceeds the
// real terminal height, the terminal itself scrolls the overflow into
// scrollback — content Ink can no longer reach or safely rewrite, but keeps
// trying to, on every subsequent render. `<Static>` (`ink`'s own export)
// sidesteps this: per `ink.js` (~lines 118-131), on any render with new
// static content, Ink calls `this.log.clear()` (clears only the current
// live region), `stdout.write(staticOutput)` (writes the new static content
// straight to the real stream ONCE, permanently — never touched again), then
// `this.log(output)` (redraws the now-smaller live region). Once a turn is
// flushed into `<Static>` it becomes genuine terminal scrollback, exactly
// like a normal `console.log` line — outside Ink's redraw cycle for good,
// with no count limit.
//
// This drastically shrinks the corruption-risk surface, but does not erase
// it entirely: the live region (`<Banner />` plus, at most, one pending
// turn below) still goes through that same erase-and-redraw cycle every
// render. An unusually tall banner combined with a long pending prompt that
// wraps across several terminal rows, on a small enough terminal, could
// still in principle overflow that live region before the turn settles and
// flushes into `<Static>`. Far
// less likely than a design where the live region held several turns at
// once (it is now banner + at most one turn), but not structurally
// impossible — out of scope to fully close here.
//
// A turn can only enter `<Static>` once its `status` is `"done"` or
// `"error"` — never while `"pending"`: `<Static>`'s contract (see
// `node_modules/ink/build/components/Static.js`) is that an item, once
// flushed (tracked via an internal `index` cursor), is NEVER re-rendered.
// A pending turn's content still changes (spinner frame, then the final
// response text once it settles) — flushing it early would freeze whatever
// it looked like at that instant, permanently, the very corruption this
// design avoids for settled turns.
//
// `<Banner />` is the FIRST item of this same `<Static>`, not a separate
// live element rendered alongside it (as an earlier version of this module
// did) — two independent bugs, verified directly against Ink's source,
// rule that alternative out:
//
// 1. A `<Banner />` left in the live region gets rewritten on every render
//    that also flushes new static content — `ink.js` (~lines 118-131) does
//    `stdout.write(staticOutput)` (the newly settled turn, permanent) THEN
//    `this.log(output)` (redraws the live region, banner included) on that
//    same render pass. Repeated once per settled turn, this makes the
//    banner's own redraw always land visually AFTER whatever static content
//    the terminal already accumulated — i.e. it silently "drags" further
//    down the screen with every new prompt instead of staying fixed at the
//    top, exactly the bug this comment is warning against.
// 2. A second, banner-only `<Static>` cannot fix it either: `ink`'s own
//    reconciler (`node_modules/ink/build/reconciler.js:150-154`) tracks
//    static content via `rootNode.staticNode = node` — a single field
//    assignment, not a list/set. Mounting two `<Static>` elements in the
//    same tree makes the second one silently overwrite the first's
//    reference; only one `<Static>` can ever be live per app.
//
// Folding the banner into this `<Static>`'s own item list, first, sidesteps
// both problems at once: it flushes to the real stream exactly once, before
// any turn, and — being genuinely static content from Ink's perspective —
// is never touched by the live-region redraw cycle again.

type TurnStatus = "pending" | "done" | "error";

interface TurnRecord {
  readonly id: number;
  readonly prompt: string;
  readonly status: TurnStatus;
  readonly responseText?: string;
  readonly agentLabel?: string;
  readonly errorMessage?: string;
}

// Discriminated union for `<Static>`'s item list — see the module doc above
// ("A turn can only enter `<Static>`...") for why `<Banner />` has to be
// item 0 here instead of a separately rendered live element.
type StaticItem =
  | { readonly kind: "banner" }
  | { readonly kind: "filler"; readonly lines: number }
  | { readonly kind: "turn"; readonly turn: TurnRecord };

export interface AppProps {
  readonly onSubmit: SubmitPromptHandler;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Shared by both the `<Static>` (settled turns) and pending-turn render
// paths below — a turn's prompt echo must look identical regardless of
// which of those two paths renders it. `color="cyan"` distinguishes the
// employee's own prompt from the agent's response (`AgentResponse` below,
// left uncolored on purpose — see its own comment) and from the error branch
// (red, untouched) — exported so this module's own test suite can call it
// directly as a plain function instead of going through Ink's render
// pipeline (see `App.test.tsx`'s "role color differentiation" describe block
// for why: Chalk, which Ink uses internally to color `<Text>`, detects "no
// color support" in this test environment, so `lastFrame()` never carries
// color codes to assert on).
export function TurnPrompt({ prompt }: { readonly prompt: string }): ReactElement {
  return <Text color="cyan">Vos: {prompt}</Text>;
}

// Renders a settled turn's agent response line — extracted from what used to
// be inline JSX inside the `<Static>` render below, same pattern as
// `TurnPrompt` above (a single hook-free `<Text>`), for the same reason:
// exported so the test suite can call it directly and inspect its props
// without relying on `lastFrame()`, which cannot observe color in this test
// environment (see `TurnPrompt`'s comment above). Deliberately no `color`
// prop (plain/default foreground) — an explicit `color="white"` would look
// wrong on a light-background terminal (white-on-white), so "leave it
// uncolored" is the portable choice, distinguishing it from the employee's
// own prompt (cyan) and the error branch (red) without assuming a dark
// background.
export function AgentResponse({
  agentLabel,
  responseText,
}: {
  readonly agentLabel?: string | undefined;
  readonly responseText?: string | undefined;
}): ReactElement {
  return (
    <Text>
      {agentLabel}: {responseText}
    </Text>
  );
}

// Frames the input line with a blue single-line border, top and bottom —
// same reason this is its own exported, hook-free function component as
// `TurnPrompt`/`AgentResponse` above: `borderColor="blue"` is invisible to
// `lastFrame()` in this test environment (Chalk, which Ink uses internally
// for both `color` and `borderColor`, detects "no color support" here), so
// the test suite calls this directly and asserts `.props.borderColor`
// instead. `borderStyle="single"` draws the frame using Ink's native Unicode
// box-drawing support (`node_modules/ink/build/styles.js`) — no manual
// character math needed. `width="100%"` (a string, not a number) is also
// resolved natively by Ink's underlying Yoga layout as a percentage of the
// available width, so this does not need to read `process.stdout.columns`
// either.
//
// Shrinks (does not remove) an already-accepted residual risk (Reviewer
// finding, WARNING — see `start-tui.tsx`'s module doc for the original
// "not structurally impossible" note this refers to): the live region's
// input line used to cost exactly 1 row; framed, it costs 3+ (top border +
// content + bottom border) on every single render, unconditionally. A
// pending prompt long/wide enough to wrap can now push the live region past
// the terminal's height two rows sooner than before. Out of scope to close
// here — same as the prior note — just worth naming precisely, since this
// component is what actually shrank that margin.
export function PromptInput({ draft }: { readonly draft: string }): ReactElement {
  return (
    <Box borderStyle="single" borderColor="blue" width="100%">
      <Text>{`> ${draft}`}</Text>
    </Box>
  );
}

// Rows `PromptInput` itself costs — top border + content + bottom border,
// for a draft short enough not to wrap. See `PromptInput`'s own comment
// ("costs 3+ rows") for where this number comes from. Exported so tests can
// compute expected filler counts against the same constant `computeFillerLines`
// itself uses, instead of a second hardcoded `3` that could silently drift.
export const PROMPT_INPUT_ROWS = 3;

// Design decision — pad up to the terminal height on mount, as a STATIC
// item (flushed once, alongside the banner, never touched again): requested
// after the human saw a reference screenshot of a similar tool where the
// bordered input sits low in the terminal even on a fresh, empty session,
// rather than right under the banner with a large gap of blank space below
// it down to the terminal's bottom edge (this file's default flow layout,
// unpadded).
//
// Computed ONCE, from whatever `stdout.rows` reads at mount, and frozen from
// then on (see `App`'s `fillerLines` state below) — deliberately NOT
// recomputed from live state on every render gated by e.g. "has no turns
// yet". An earlier version of this feature did exactly that (`hasHistory`
// flipping the padding on/off), and it produced a real, reported bug: the
// instant the first prompt was submitted, `hasHistory` flipped true and the
// filler amount collapsed from a potentially large number straight to 0 in
// a single render. Because that filler lived in the LIVE region (redrawn via
// Ink's own erase-and-rewrite cycle every render — see the module doc above
// on why only settled turns are safe from this), the live region's rendered
// height dropped by that same large amount in one frame, and Ink erased
// that many rows via cursor-up escapes to redraw the now-shorter region —
// visually, the whole screen appeared to "snap" back upward the moment a
// prompt was sent. Freezing the value and flushing it as a `<Static>` item
// (this file's own established mechanism for "written once, permanent,
// never redrawn") sidesteps the entire class of bug: nothing ever has to
// erase it, because it is never rewritten, exactly like the banner it sits
// next to.
//
// Not "always keep padding to fill the screen as the conversation grows",
// either: once real turns exist, `<Static>`-flushed content becomes genuine
// terminal scrollback outside Ink's own reach (see the module doc above), so
// there is no reliable way to know how many rows that flushed content will
// eventually occupy — it depends on terminal width wrapping for arbitrary
// prompt/response text, which nothing here tracks. A conversation that has
// grown enough to fill or exceed the terminal already gets the "input glued
// to the bottom" look for free, for a different reason: the terminal's own
// auto-scroll keeps the most recently written line (the live region, i.e.
// this input) at the bottom of the visible viewport once total output
// exceeds the terminal's height. A fixed, one-time filler is the right size
// for exactly the case it targets (a fresh, still-empty session) and simply
// stops mattering once real content grows past it.
//
// Exported as a standalone pure function (same reasoning as `PromptInput`/
// `TurnPrompt`/`AgentResponse` above: directly unit-testable without
// depending on Ink's rendering pipeline or a real/faked terminal size).
// `terminalRows` is `number | undefined` because `ink-testing-library`'s
// fake `stdout` (used by nearly every other test in this file) exposes no
// `rows` property at all — only a real terminal, or this file's own
// `FakeInkStdout` (used by the "banner placement" describe block), does.
export function computeFillerLines(terminalRows: number | undefined): number {
  if (terminalRows === undefined) {
    return 0;
  }

  return Math.max(0, terminalRows - BANNER_LINE_COUNT - PROMPT_INPUT_ROWS);
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
  // Sent-prompt history (via `submitDraft`, most recent last) — see the
  // module doc's "Command history navigation" note.
  const promptHistoryRef = useRef<string[]>([]);
  // `null` = viewing the live draft (the "present"); a non-null index
  // points into `promptHistoryRef.current`.
  const historyIndexRef = useRef<number | null>(null);
  // `draftRef.current` as it was right before the *first* arrow-up that
  // entered navigation mode — not overwritten again while still navigating.
  const draftBeforeHistoryRef = useRef("");

  // Frozen at mount, via a lazy `useState` initializer — see
  // `computeFillerLines`'s comment above for why this must NOT be
  // recomputed later (that was the actual bug: a live-recomputed filler
  // collapsing to 0 mid-session caused the whole screen to visibly snap
  // upward). No resize tracking after mount is intentional for the same
  // reason: once this value is flushed into `<Static>` (below), a later
  // change to it would never be seen anyway — `<Static>`'s own contract is
  // that a flushed item is never re-rendered.
  const { stdout } = useStdout();
  const [fillerLines] = useState(() => computeFillerLines(stdout.rows));

  // Shared walk/clamp/commit logic for both arrow-up ("older") and
  // arrow-down ("newer") — see the module doc's "Command history
  // navigation" note. Extracted so a future fix to the walk/clamp rules
  // only has to be made once instead of being applied to one direction and
  // forgotten in the other.
  function navigateHistory(direction: "older" | "newer") {
    const entries = promptHistoryRef.current;

    if (direction === "older") {
      if (entries.length === 0) {
        return;
      }

      let nextIndex: number;
      if (historyIndexRef.current === null) {
        draftBeforeHistoryRef.current = draftRef.current;
        nextIndex = entries.length - 1;
      } else if (historyIndexRef.current > 0) {
        nextIndex = historyIndexRef.current - 1;
      } else {
        // Already at the oldest entry — clamp, do not wrap around.
        return;
      }

      historyIndexRef.current = nextIndex;
      // Safe: `nextIndex` is always derived from a range check above
      // (either `entries.length - 1` or a decrement/increment bounded by
      // it), never an arbitrary index — the `noUncheckedIndexedAccess`
      // `string | undefined` this would otherwise produce cannot actually
      // be `undefined` here.
      draftRef.current = entries[nextIndex]!;
    } else {
      if (historyIndexRef.current === null) {
        // Already viewing the present — nothing to walk back to.
        return;
      }

      if (historyIndexRef.current < entries.length - 1) {
        const nextIndex = historyIndexRef.current + 1;
        historyIndexRef.current = nextIndex;
        draftRef.current = entries[nextIndex]!;
      } else {
        // Past the newest recalled entry — back to the live draft.
        historyIndexRef.current = null;
        draftRef.current = draftBeforeHistoryRef.current;
      }
    }

    setDraft(draftRef.current);
  }

  // Shared by `settleTurn` (below) and `onAgentResolved` (inside
  // `submitDraft`) — both patch a single turn by `id` inside `history`, the
  // former on settlement, the latter as soon as the agent is known. One
  // helper instead of two copies of the same `setHistory((previous) =>
  // previous.map(...))` means a future guard (e.g. ignoring a late
  // `onAgentResolved` call for a turn that already settled — see
  // `tui-port.ts`'s note on why `onAgentResolved` is expected to fire
  // synchronously) only has one place to be added, not two to remember to
  // keep in sync.
  function updateTurn(
    id: number,
    patch: Partial<Pick<TurnRecord, "status" | "responseText" | "agentLabel" | "errorMessage">>,
  ) {
    setHistory((previous) => previous.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }

  function settleTurn(id: number, outcome: Pick<TurnRecord, "status" | "responseText" | "agentLabel" | "errorMessage">) {
    updateTurn(id, outcome);
    pendingRef.current = false;
    setPending(false);
  }

  function submitDraft() {
    const prompt = draftRef.current.trim();
    if (prompt.length === 0) {
      return;
    }

    // Sending always returns to the present — see the module doc's
    // "Command history navigation" note.
    promptHistoryRef.current.push(prompt);
    historyIndexRef.current = null;

    const id = nextTurnId.current;
    nextTurnId.current += 1;

    setHistory((previous) => [...previous, { id, prompt, status: "pending" }]);
    draftRef.current = "";
    setDraft("");
    pendingRef.current = true;
    setPending(true);

    // `onAgentResolved` is `onSubmit`'s optional second argument
    // (`SubmitPromptHandler`, `tui-port.ts`) — called synchronously, before
    // `onSubmit`'s promise settles, so the pending indicator can show which
    // agent is handling this turn while it is still in flight. Uses the same
    // `updateTurn` helper `settleTurn` does above, touching only
    // `agentLabel` — the turn stays `"pending"`.
    function onAgentResolved(agentLabel: string) {
      updateTurn(id, { agentLabel });
    }

    // `onSubmit(prompt, onAgentResolved)` itself is wrapped in try/catch —
    // see the module doc's note on synchronous throws for why: a throw
    // there hits `catch` and routes into the same `settleTurn` error path a
    // rejected `onSubmit` promise already uses below, instead of
    // propagating out of `submitDraft` uncaught. Deliberately not
    // `Promise.resolve().then(() => onSubmit(prompt, onAgentResolved))` (an
    // earlier version of this fix) — that alternative also catches a
    // synchronous throw, but defers the *call itself* to a microtask, which
    // would change `onSubmit` from being invoked synchronously within this
    // same keystroke's `useInput` callback (relied upon elsewhere, e.g. by
    // tests asserting `onSubmit` was called immediately after a raw Enter
    // keypress) to one microtask later.
    try {
      onSubmit(prompt, onAgentResolved).then(
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

      // Arrow-up recalls older sent prompts, arrow-down walks back towards
      // the present — see the module doc's "Command history navigation"
      // note for the full model. Only fire on an *unmodified* arrow: a
      // modified one (Ctrl+Up, Shift+Down, etc.) falls through to the
      // generic ignore branch below instead, same as before this feature
      // existed — see the module doc's paragraph on why `key.upArrow`/
      // `key.downArrow` alone is not a sufficient guard.
      if (key.upArrow && !key.ctrl && !key.meta && !key.shift) {
        navigateHistory("older");
        return;
      }

      if (key.downArrow && !key.ctrl && !key.meta && !key.shift) {
        navigateHistory("newer");
        return;
      }

      // Ignore other control/navigation keys (tab, escape, ctrl combos,
      // left/right/page, and any *modified* arrow) — this hito's input is a
      // single-line draft with no cursor movement; unmodified arrow-up/down
      // are handled explicitly above instead.
      if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) {
        return;
      }

      // Replaces (does not delete) any embedded `\r`/`\n` before appending
      // — see the module doc's "Single-line input" note for why this, not
      // an exact `input === "\n"` match, is the mechanism that keeps the
      // draft free of a literal line break regardless of whether `input` is
      // a single keystroke or an entire pasted multi-line string delivered
      // in one `useInput` call. `+` (one-or-more), not a bare character
      // class, so a run of consecutive `\r`/`\n` (e.g. a Windows-style
      // `\r\n` pair, still one logical line break) collapses into exactly
      // ONE space, not one space per character.
      //
      // Consequence, deliberately not special-cased: a LONE Ctrl+J keystroke
      // (raw byte `\n`) now also inserts a single space instead of being
      // swallowed entirely, because it is matched by this same regex on this
      // same branch — there is no reliable way to tell "a `\n` that arrived
      // by itself" apart from "a `\n` embedded inside a longer paste" using
      // only `input`/`key` (both cases leave `key.name === ""`, see the
      // module doc's "Single-line input" note), and the product decision
      // behind this change was expressed as one regex change to this one
      // branch, not a paste-only special case requiring that distinction.
      const sanitizedInput = input.replace(/[\r\n]+/g, " ");
      draftRef.current = draftRef.current + sanitizedInput;
      setDraft(draftRef.current);
    },
    { isActive: !pending },
  );

  // Split by settlement — see the module doc above for why only settled
  // turns can flush into `<Static>`. At most one `pendingTurn` exists at a
  // time: this module's own "one turn in flight at a time" design decision
  // (see the module doc) already guarantees it, no re-check needed here.
  //
  // Computed in a single `useMemo` pass over `history`, keyed only on
  // `history` itself — not recomputed on renders `history` didn't cause
  // (e.g. every keystroke, which only changes `draft`). `history` is
  // deliberately never capped (see the module doc above), so redoing this
  // scan on every render regardless of what changed would get steadily more
  // wasteful as a session's turn count grows; gating on `history`'s own
  // reference identity (only changed by `setHistory`) makes keystroke-only
  // renders skip it entirely.
  // `Static`'s own type declares `items` as a mutable array (not
  // `readonly`), unlike the rest of this module's props/state — the
  // mismatch is purely a typing artifact of `ink`'s declaration, not a real
  // mutability concern here (this array is never mutated after being built).
  //
  // The filler item (if any) sits right after the banner, item index 1 —
  // both flush together on the very first render, before any turn exists,
  // so the padded gap appears above the still-empty live region exactly
  // once, permanently, same as the banner itself. See `computeFillerLines`'s
  // comment above for why this has to be a `<Static>` item and not a
  // conditionally-rendered live element.
  const { staticItems, pendingTurn } = useMemo(() => {
    const items: StaticItem[] = [{ kind: "banner" }];
    if (fillerLines > 0) {
      items.push({ kind: "filler", lines: fillerLines });
    }
    let pending: TurnRecord | undefined;

    for (const turn of history) {
      if (turn.status === "pending") {
        pending = turn;
      } else {
        items.push({ kind: "turn", turn });
      }
    }

    return { staticItems: items, pendingTurn: pending };
  }, [history, fillerLines]);

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) => {
          if (item.kind === "banner") {
            return <Banner key="banner" />;
          }

          if (item.kind === "filler") {
            return <Box key="filler" height={item.lines} />;
          }

          const { turn } = item;
          return (
            <Box key={`turn-${turn.id}`} flexDirection="column">
              <TurnPrompt prompt={turn.prompt} />
              {turn.status === "done" && (
                <AgentResponse agentLabel={turn.agentLabel} responseText={turn.responseText} />
              )}
              {turn.status === "error" && <Text color="red">Error: {turn.errorMessage}</Text>}
            </Box>
          );
        }}
      </Static>
      {pendingTurn && (
        <Box flexDirection="column">
          <TurnPrompt prompt={pendingTurn.prompt} />
          <Text dimColor>
            {pendingTurn.agentLabel ? `${pendingTurn.agentLabel}: ` : ""}
            <Spinner type="dots" /> Pensando...
          </Text>
        </Box>
      )}
      <PromptInput draft={draft} />
    </Box>
  );
}
