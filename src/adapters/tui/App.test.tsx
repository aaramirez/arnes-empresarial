import { EventEmitter } from "node:events";
import { render as renderInkDirect } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentResponse, App, computeFillerLines, PromptInput, PROMPT_INPUT_ROWS, TurnPrompt } from "./App.js";
import { BANNER_LINE_COUNT } from "./Banner.js";
import type { TuiTurnResult } from "./tui-port.js";

/**
 * Every instance `renderApp` has produced in the current test, unmounted in
 * `afterEach` below. Needed because of `<Spinner>` (`ink-spinner`), rendered
 * while a turn is `pending`: it starts a real `setInterval` internally, and
 * Ink/React only clears it via the effect cleanup that runs on unmount (or
 * on the component re-rendering without `<Spinner>`, e.g. once a turn
 * settles). Most tests here resolve/reject the turn before finishing, which
 * already triggers that cleanup — but at least one test (see "ignores
 * further input while a submission is still pending") deliberately never
 * resolves its turn, leaving a live timer if nothing unmounts it. Unmounting
 * unconditionally in `afterEach`, rather than only in that one test, keeps
 * this safe against future tests that leave a turn pending too.
 */
let renderedInstances: Array<ReturnType<typeof render>> = [];

afterEach(() => {
  for (const instance of renderedInstances) {
    instance.unmount();
  }
  renderedInstances = [];
});

/**
 * Deferred promise helper — lets a test control exactly when a fake
 * `onSubmit` resolves/rejects, so assertions can be made both while a turn
 * is still pending and after it settles.
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Polls `predicate` on macrotask boundaries (real timers, not React's own
 * microtask/scheduler internals) until it returns `true`, instead of
 * trusting a single fixed tick to always be enough for a promise
 * continuation + React re-render to settle. Throws with a clear message if
 * `predicate` never becomes true within `timeoutMs`, so a genuine
 * regression still fails loudly instead of a flaky pass/hang.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition did not become true within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Multi-tick settle, used where there is no single observable condition to
 * poll for (e.g. "has Ink's `useInput` effect subscribed its raw-stdin
 * listener yet" has no external signal until something is actually typed).
 * Several real ticks instead of one reduces flakiness under a loaded event
 * loop without depending on a specific number of internal scheduler passes.
 */
async function settle(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Extracts the input line's own text (the "> draft" content, border
 * characters stripped) from a rendered frame. Needed since `PromptInput`
 * (`App.tsx`) now wraps the input line in a bordered `<Box>`: the frame's
 * LAST line is the border's bottom edge (`└───...───┘`), not the input line
 * itself anymore, so this file's previous `.split("\n").at(-1)` pattern no
 * longer reaches it. Locates the line by its `"│>"` prefix — `│` is the
 * border's left edge, immediately followed by the "> " prompt itself, since
 * `PromptInput` applies no left padding — instead of assuming a fixed
 * position in the frame.
 *
 * Searches from the END of the frame (`.reverse().find(...)` — `.findLast`
 * would read cleaner but this project's configured `lib` predates ES2023),
 * not `.find(...)` from the start (Reviewer finding, WARNING): `.find`
 * takes the FIRST matching line top-to-bottom — if an already-settled
 * historical prompt (rendered above, inside `<Static>`) happened to wrap in
 * a way where a continuation line's first two characters coincided with
 * `"│>"`, `.find` would match that wrong line instead of the real input
 * box. `PromptInput` is always the LAST element in the live region (see
 * `App.tsx`'s `return`), so searching from the end is what actually
 * guarantees hitting the real input box regardless of what any earlier
 * content happens to contain.
 *
 * Strips the left `│` (via `.slice(1)`) and the right `│` plus the box's own
 * right-padding spaces (via the trailing `replace`, single pass — the `\s*`
 * before `│` absorbs what a separate `.trimEnd()` would otherwise have to
 * clean up afterward), matching the exact trimmed strings this file's
 * assertions already expected before the border existed (an empty draft
 * renders as literal `"> "` inside the box, which becomes bare `">"` once
 * trailing whitespace is stripped — same end result Ink's own line-trimming
 * produced pre-border).
 */
function inputLineText(frame: string): string {
  const line = frame.split("\n").reverse().find((candidate) => candidate.startsWith("│>"));
  if (line === undefined) {
    throw new Error('inputLineText: no line starting with the input border+prompt ("│>") found in frame');
  }
  return line.slice(1).replace(/\s*│\s*$/, "");
}

/**
 * Builds a fake `onSubmit` queued to resolve `count` turns in submission
 * order, each with a distinct `responseText` (`"respuesta 1"`, `"respuesta
 * 2"`, ...) — same `mockResolvedValueOnce`-per-turn pattern the history-
 * navigation tests above already use, so each turn can be `waitFor`-ed
 * individually instead of racing on `onSubmit.mock.calls.length` (see this
 * file's other comments on why that race exists).
 */
function buildOnSubmit(count: number): ReturnType<typeof vi.fn<(prompt: string) => Promise<TuiTurnResult>>> {
  const mock = vi.fn<(prompt: string) => Promise<TuiTurnResult>>();
  for (let i = 1; i <= count; i += 1) {
    mock.mockResolvedValueOnce({ responseText: `respuesta ${i}`, agentLabel: "Agente" });
  }
  return mock;
}

/**
 * Renders `tree` via `ink-testing-library` and settles before returning.
 * Necessary because `useInput`'s raw-stdin subscription is set up in a
 * `useEffect`, which React runs asynchronously after the initial mount —
 * writing to `stdin` synchronously right after `render()` (as a real
 * terminal session never does, since a human cannot type before the process
 * finishes booting) races that effect and is silently dropped.
 */
async function renderApp(tree: ReactElement): Promise<ReturnType<typeof render>> {
  const instance = render(tree);
  renderedInstances.push(instance);
  await settle();
  return instance;
}

const ENTER = "\r";
const BACKSPACE = "\x7f";
// Raw byte for Ctrl+J (linefeed, `\n`) — distinct from `ENTER`'s `\r`. Used
// to prove the draft can never receive an embedded line break from a lone
// keystroke — see `App.tsx`'s module doc's "Single-line input" note for why
// this is enforced by stripping `\n`/`\r` inside the generic
// append-character branch itself, not via a dedicated `input === "\n"`
// guard branch.
const CTRL_J = "\n";
// Standard xterm CSI sequences for the arrow keys — same pattern as the
// other raw-byte constants above.
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
// Ctrl+Up: xterm's modified-key CSI form (`\x1b[1;5A`, modifier `5` = ctrl
// bit set). Ink's `parse-keypress.js` parses this to `key.name === "up"`
// (so `key.upArrow === true`) AND `key.ctrl === true` at the same time —
// see `App.tsx`'s module doc for why history navigation must check for
// that combination explicitly instead of trusting `key.upArrow` alone.
const CTRL_UP = "\x1b[1;5A";

/**
 * Minimal fake `stdin`/`stdout`/`stderr` for driving `ink`'s own `render`
 * directly (not via `ink-testing-library`) — see the "banner placement —
 * real (non-debug) Ink render path" `describe` block below for why this
 * exists at all.
 *
 * `FakeInkStdin` mirrors `ink-testing-library`'s own internal `Stdin` class
 * (`node_modules/ink-testing-library/build/index.js`) byte-for-byte in
 * shape — same `isTTY`/`write`/`setEncoding`/`setRawMode`/`resume`/`pause`/
 * `ref`/`unref`/`read` surface — so it satisfies exactly what `ink`'s
 * `useStdin`/`useInput` (and `App.js`'s `handleSetRawMode`/`handleReadable`)
 * actually call, without pulling in `ink-testing-library` itself.
 */
class FakeInkStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;

  write = (data: string) => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };

  setEncoding() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  setRawMode() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  resume() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  pause() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  ref() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  unref() {
    // Do nothing — matches ink-testing-library's own no-op.
  }

  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

/**
 * Records every raw `stdout.write(chunk)` call, in order, instead of only
 * exposing a single `lastFrame()` like `ink-testing-library`'s own fake
 * does — the whole point of this fake is to observe the *sequence* of
 * writes `ink.js`'s real (non-debug) `onRender` produces, which is exactly
 * what the debug-mode shortcut collapses away. `columns`/`rows` are set to
 * plausible terminal dimensions so `ink.js`'s `outputHeight >=
 * this.options.stdout.rows` branch (the "clear + redraw everything" escape
 * hatch for content taller than the terminal) is not accidentally
 * triggered by this test's small output.
 */
class FakeInkStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  readonly writes: string[] = [];

  write = (chunk: string) => {
    this.writes.push(chunk);
  };
}

/** Same recording shape as `FakeInkStdout`, for the (unused by this test,
 * but required by `ink`'s `render` options) `stderr` stream. */
class FakeInkStderr extends EventEmitter {
  readonly writes: string[] = [];

  write = (chunk: string) => {
    this.writes.push(chunk);
  };
}

describe("App", () => {
  it("renders an empty input line and does not call onSubmit on first render", async () => {
    const onSubmit = vi.fn();

    const { lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    expect(lastFrame()).toContain(">");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows which agent is answering as soon as onSubmit resolves it, before the turn's promise settles", async () => {
    const { promise } = deferred<TuiTurnResult>();
    const onSubmit = vi.fn((_prompt: string, onAgentResolved?: (agentLabel: string) => void) => {
      // Simulates `main.ts` calling `resolveTurn` synchronously, before
      // `handleTurn`'s promise starts resolving — see `tui-port.ts`'s module
      // doc for why this callback fires before the promise settles.
      onAgentResolved?.("Agente Conversacional");
      return promise;
    });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("hola agente");
    stdin.write(ENTER);

    // The agent label must already be visible in the pending indicator —
    // the promise has NOT been resolved yet at this point in the test.
    expect(lastFrame()).toContain("Agente Conversacional: ");
    expect(lastFrame()).toContain("Pensando");
  });

  it("renders the product banner once, above the conversation", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ responseText: "hola humano", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    expect(lastFrame()).toContain("arnés empresarial de IA");

    stdin.write("hola agente");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("hola humano"));

    // Not just "the banner is somewhere in the frame" — it must sit BEFORE
    // the first turn's "Vos:" line, i.e. above the conversation, not below
    // it. `indexOf` on the flattened frame string is enough here (both
    // substrings are single-line-unique at this point in the test) without
    // needing a line-by-line walk.
    const frame = lastFrame() ?? "";
    const bannerIndex = frame.indexOf("arnés empresarial de IA");
    const firstTurnIndex = frame.indexOf("Vos:");
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(firstTurnIndex).toBeGreaterThanOrEqual(0);
    expect(bannerIndex).toBeLessThan(firstTurnIndex);
  });

  it("keeps the banner rendered exactly once, above every turn, as more turns accumulate", async () => {
    const onSubmit = buildOnSubmit(3);
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    stdin.write("tercero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 3"));

    // Guards directly against the bug this test was added for: the banner
    // being rewritten below each newly flushed `<Static>` block on every
    // turn instead of staying fixed as the first item — i.e. "arrastrarse"
    // (dragging) further down with every new prompt.
    const frame = lastFrame() ?? "";
    const bannerOccurrences = frame.split("arnés empresarial de IA").length - 1;
    expect(bannerOccurrences).toBe(1);

    const bannerIndex = frame.indexOf("arnés empresarial de IA");
    const firstTurnIndex = frame.indexOf("Vos: primero");
    const lastTurnIndex = frame.indexOf("Vos: tercero");
    expect(bannerIndex).toBeLessThan(firstTurnIndex);
    expect(bannerIndex).toBeLessThan(lastTurnIndex);
  });

  it("echoes typed characters into the input line", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("hola");

    expect(lastFrame()).toContain("> hola");
  });

  it("frames the input line with a horizontal border above and below it", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("hola");

    // Unicode box-drawing characters (`─`/`│`/etc.), unlike `borderColor`,
    // are literal characters, not color — Chalk's "no color support"
    // detection in this test environment (see the "role color
    // differentiation" describe block below) does not touch them, so this
    // IS a valid `lastFrame()` assertion. Checks the line right above and
    // right below the one holding "> hola" both carry a horizontal border
    // glyph, i.e. the input line is actually framed top and bottom, not
    // just "a border exists somewhere in the frame".
    const lines = (lastFrame() ?? "").split("\n");
    const inputLineIndex = lines.findIndex((line) => line.includes("> hola"));

    expect(inputLineIndex).toBeGreaterThan(0);
    expect(lines[inputLineIndex - 1] ?? "").toContain("─");
    expect(lines[inputLineIndex + 1] ?? "").toContain("─");
  });

  it("inputLineText preserves a │ character embedded in the draft, stripping only the real trailing border", async () => {
    // Regression test for a Reviewer-found mutation-testing gap: the
    // `inputLineText` helper's stripping regex (`/\s*│\s*$/`) relies on its
    // trailing `$` anchor to only ever touch the box's own right border, not
    // any `│` the user's draft itself might contain. Removing that anchor
    // passed all other tests in this file untouched (nothing else exercises
    // an embedded `│`) — this test exists specifically to catch that
    // mutation: a draft containing `"│"` mid-content must come back intact,
    // not truncated or corrupted at that character.
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("ab│cd");

    expect(inputLineText(lastFrame() ?? "")).toBe("> ab│cd");
  });

  it("removes the last typed character on backspace", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("hola");
    stdin.write(BACKSPACE);

    expect(lastFrame()).toContain("> hol");
    expect(lastFrame()).not.toContain("> hola");
  });

  it("does not call onSubmit when Enter is pressed on an empty draft", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write(ENTER);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain("Pensando");
  });

  it("submits the draft on Enter, clears it, and shows a pending indicator while onSubmit resolves", async () => {
    const { promise, resolve } = deferred<TuiTurnResult>();
    const onSubmit = vi.fn().mockReturnValue(promise);
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("hola agente");
    stdin.write(ENTER);

    // Second argument is `onAgentResolved` (`SubmitPromptHandler`'s optional
    // second parameter, `tui-port.ts`) — `submitDraft` always passes a
    // function there, so this asserts the prompt exactly and the second
    // argument's shape only, not its identity.
    expect(onSubmit).toHaveBeenCalledWith("hola agente", expect.any(Function));
    expect(lastFrame()).toContain("Vos: hola agente");
    expect(lastFrame()).toContain("Pensando");
    expect(lastFrame()).not.toContain("> hola agente");

    resolve({ responseText: "hola humano", agentLabel: "Agente Conversacional" });
    await waitFor(() => (lastFrame() ?? "").includes("Agente Conversacional: hola humano"));

    expect(lastFrame()).not.toContain("Pensando");
  });

  it("shows an error message instead of crashing when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("prompt roto");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("Error: boom"));

    expect(lastFrame()).not.toContain("Pensando");
  });

  it("shows an error message instead of crashing when onSubmit throws synchronously, and recovers pending state for the next turn", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockResolvedValueOnce({ responseText: "recuperado", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    // (a) the synchronous throw must not propagate out of the input
    // handler / crash the test process.
    expect(() => {
      stdin.write("prompt roto");
      stdin.write(ENTER);
    }).not.toThrow();

    // (b) it renders inline instead.
    await waitFor(() => (lastFrame() ?? "").includes("Error: sync boom"));
    expect(lastFrame()).not.toContain("Pensando");

    // (c) pending state was reset — the next submission is not blocked by
    // the input-ignoring guard that stays active while a turn is pending.
    stdin.write("otro prompt");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(2, "otro prompt", expect.any(Function));

    await waitFor(() => (lastFrame() ?? "").includes("Agente: recuperado"));
  });

  it("accumulates more than one turn in the same session", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primer prompt");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo prompt");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    const frame = lastFrame();
    expect(frame).toContain("Vos: primer prompt");
    expect(frame).toContain("respuesta 1");
    expect(frame).toContain("Vos: segundo prompt");
    expect(frame).toContain("respuesta 2");
  });

  describe("turn timestamp (AppProps.now DI, same pattern as LogTurnEventDeps.now)", () => {
    it("stamps a submitted turn with the injected now(), visible both while pending and after it settles", async () => {
      const { promise, resolve } = deferred<TuiTurnResult>();
      const onSubmit = vi.fn().mockReturnValue(promise);
      // Fixed, deterministic clock — see `AppProps.now`'s comment in
      // `App.tsx` for why this is injectable at all instead of relying on
      // the real clock (`() => new Date()`), which no test can assert an
      // exact value against without flaking.
      const fixedNow = () => new Date("2026-08-30T14:05:09");
      const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} now={fixedNow} />);

      stdin.write("hola agente");
      stdin.write(ENTER);

      // Pending turn — timestamp is fixed at submission, not recomputed
      // while "Pensando..." is showing.
      expect(lastFrame()).toContain("[14:05:09] Vos: hola agente");

      resolve({ responseText: "hola humano", agentLabel: "Agente" });
      await waitFor(() => (lastFrame() ?? "").includes("Agente: hola humano"));

      // Same timestamp survives the turn's move into `<Static>` once
      // settled — it was never re-derived from a fresh `now()` call.
      expect(lastFrame()).toContain("[14:05:09] Vos: hola agente");
    });

    it("does not crash when now is omitted, falling back to the real clock", async () => {
      const onSubmit = vi.fn().mockResolvedValue({ responseText: "ok", agentLabel: "Agente" });
      const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

      expect(() => {
        stdin.write("hola");
        stdin.write(ENTER);
      }).not.toThrow();

      await waitFor(() => (lastFrame() ?? "").includes("Agente: ok"));
      // Exact value is the real clock's — not asserted, only that SOME
      // well-formed HH:MM:SS timestamp was rendered.
      expect(lastFrame()).toMatch(/\[\d{2}:\d{2}:\d{2}\] Vos: hola/);
    });
  });

  it("ignores further input while a submission is still pending", async () => {
    const { promise } = deferred<TuiTurnResult>();
    const onSubmit = vi.fn().mockReturnValue(promise);
    const { stdin } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    stdin.write("segundo");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("treats Ctrl+J as inserting a single space, not a line break, on the draft in idle state", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("linea1");
    stdin.write(CTRL_J);
    stdin.write("linea2");

    // No literal line break, and Ctrl+J is no longer swallowed entirely: the
    // human's product decision (see `App.tsx`'s "Single-line input" module
    // doc note) replaces embedded `\r`/`\n` with a space rather than
    // deleting them, applied uniformly inside the single generic
    // append-character branch — there is no reliable way to distinguish a
    // lone Ctrl+J keystroke from a `\n` embedded inside a longer paste using
    // `input`/`key` alone (both arrive as `key.name === ""`), so this test's
    // old "Ctrl+J contributes nothing" premise no longer holds: a lone
    // Ctrl+J now inserts one real space character into the draft, same as
    // it would for any newline arriving via a paste.
    expect(lastFrame()).toContain("> linea1 linea2");
    expect(onSubmit).not.toHaveBeenCalled();

    stdin.write(BACKSPACE);
    // Backspace removes the last real character typed ("2") — the space
    // Ctrl+J inserted is now a real character in the draft (unlike before,
    // when Ctrl+J contributed nothing), so it stays put; only "2" is
    // removed.
    expect(inputLineText(lastFrame() ?? "")).toBe("> linea1 linea");
  });

  it("treats Ctrl+J as a no-op while a submission is still pending", async () => {
    const { promise } = deferred<TuiTurnResult>();
    const onSubmit = vi.fn().mockReturnValue(promise);
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain("Pensando");

    // While pending, `isActive`/`pendingRef` already ignore all input — this
    // proves Ctrl+J specifically does not sneak past that guard and leave
    // any trace (a stray line break, a stray character, or a second
    // `onSubmit` call) once the turn is in flight.
    stdin.write(CTRL_J);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain("Pensando");
    expect(inputLineText(lastFrame() ?? "")).toBe(">");
  });

  it("replaces an embedded newline from a single pasted write with a space, keeping the draft (and the submitted prompt) single-line", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ responseText: "ok", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    // Simulates a real terminal paste, reproduced exactly as Ink's own
    // `useInput` delivers it: ONE `stdin.write` call carrying the entire
    // pasted string, embedded `\n` included, not one keystroke at a time —
    // see `App.tsx`'s module doc ("Single-line input") for why an exact
    // `input === "\n"` guard cannot catch this. The embedded `\n` becomes a
    // single space (not deleted outright) so pasted multi-line text stays
    // readable instead of having its lines smashed together.
    stdin.write("linea1\nlinea2");

    expect(lastFrame()).toContain("> linea1 linea2");

    stdin.write(ENTER);

    expect(onSubmit).toHaveBeenCalledWith("linea1 linea2", expect.any(Function));
  });

  it("does nothing on arrow-up when no prompt has been submitted yet", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    expect(() => {
      stdin.write(ARROW_UP);
    }).not.toThrow();

    // Draft line stays exactly the empty prompt — no stray content from the
    // (non-existent) history and no crash. Ink's frame trims the trailing
    // space of an empty draft line, so the expected value is ">" and not
    // "> ".
    expect(inputLineText(lastFrame() ?? "")).toBe(">");

    // Also proves `historyIndexRef` was NOT flipped into "navigating" mode
    // by the arrow-up above (which the rendered draft alone cannot show,
    // since it stays empty either way): typing, then arrow-down, must
    // behave as ordinary un-navigated input — if the empty-history guard
    // were missing, arrow-down would instead treat this as "past the newest
    // recalled entry" and wipe the typed text back to the (empty) snapshot
    // taken before the arrow-up.
    stdin.write("x");
    stdin.write(ARROW_DOWN);
    expect(inputLineText(lastFrame() ?? "")).toBe("> x");
  });

  it("walks older entries on repeated arrow-up and clamps at the oldest one", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo");
    stdin.write(ENTER);
    // Waits for the *settled* second turn, not merely for `onSubmit` to have
    // been called — `mock.calls.length` flips to 2 synchronously on the
    // Enter keypress itself, well before the promise resolves and
    // `pendingRef` clears, which would otherwise make the very next
    // `stdin.write(ARROW_UP)` below get silently dropped by the
    // still-pending guard.
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundo");

    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");

    // Third arrow-up: already at the oldest entry, must stay clamped there
    // instead of wrapping around.
    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");
  });

  it("does not navigate history on a modified arrow (Ctrl+Up), same as before this feature existed", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    // History is loaded ("primero", "segundo") and the draft is currently
    // empty (cleared by the last submit) — Ctrl+Up must leave it exactly
    // as-is, not recall "segundo". Regression guard: before this feature,
    // `key.upArrow` alone in the generic ignore branch made every arrow —
    // modified or not — inert; a fix for Ctrl+Up that merely re-adds
    // `key.upArrow` to that branch without also excluding modified arrows
    // from the new navigation branch would still navigate here.
    stdin.write(CTRL_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe(">");

    // Also confirms it did not silently enter navigation mode either: an
    // unmodified arrow-up right after must behave as the *first* arrow-up
    // (recalling the newest entry), not as a second step already inside
    // navigation.
    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundo");
  });

  it("walks back down to the in-progress draft the user had before navigating history", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo");
    stdin.write(ENTER);
    // See the previous test's comment on why this waits for settled text
    // instead of `onSubmit.mock.calls.length`.
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    // Non-empty draft written before touching history at all — needed so
    // the final assertion is unambiguous (a restored "" could otherwise be
    // confused with "nothing happened").
    stdin.write("borrador sin enviar");

    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundo");
    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");

    stdin.write(ARROW_DOWN);
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundo");

    stdin.write(ARROW_DOWN);
    expect(inputLineText(lastFrame() ?? "")).toBe("> borrador sin enviar");
  });

  it("does nothing on arrow-down when history navigation was never entered", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("algo escrito");
    stdin.write(ARROW_DOWN);

    expect(inputLineText(lastFrame() ?? "")).toBe("> algo escrito");
  });

  it("discards an in-place edit of a recalled entry once arrow-up navigates away from it", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write("segundo");
    stdin.write(ENTER);
    // See the earlier tests' comment on why this waits for settled text
    // instead of `onSubmit.mock.calls.length`.
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundo");

    // Edit the recalled entry in place — this must NOT be persisted back
    // into `promptHistoryRef`, and must NOT reset `historyIndexRef` either
    // (see `App.tsx`'s new module-doc note on history navigation).
    stdin.write("X");
    expect(inputLineText(lastFrame() ?? "")).toBe("> segundoX");

    // Navigating again must jump to the previous entry ("primero"), not to
    // the edited text — this is what would break if `historyIndexRef` got
    // reset by the character-append branch above.
    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");
  });

  it("submits a recalled history entry and re-adds it as the newest entry", async () => {
    const onSubmit = vi
      .fn<(prompt: string) => Promise<TuiTurnResult>>()
      .mockResolvedValueOnce({ responseText: "respuesta 1", agentLabel: "Agente" })
      .mockResolvedValueOnce({ responseText: "respuesta 2", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 1"));

    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");

    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenNthCalledWith(2, "primero", expect.any(Function));
    // See earlier tests' comment on why this waits for settled text instead
    // of `onSubmit.mock.calls.length`.
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    // Submitting reset navigation back to the present and appended "primero"
    // again as the newest entry — one arrow-up must recall it once more.
    stdin.write(ARROW_UP);
    expect(inputLineText(lastFrame() ?? "")).toBe("> primero");
  });

  // Settled turns render via `<Static>` (Ink) instead of a fixed
  // visible-turn window — see `App.tsx`'s module doc for the full design
  // rationale. This test cannot prove "no limit whatsoever" (any fixed
  // `turnCount` is itself a bound a mutation could sneak under), so it
  // deliberately sends a generous 30 turns: high enough that any reasonably
  // sized fixed window someone might reintroduce later (8, 15, 20, ...)
  // would have to also cover 30 to pass unnoticed, which is not a
  // "reasonably sized" window anymore. What it actually asserts: the first
  // and last turns of a long conversation are both still present in the
  // rendered frame, with no hidden-turns indicator — i.e. nothing was
  // dropped from render.
  it("keeps both the first and last turn of a long conversation reachable, with no hidden-turns indicator", async () => {
    const turnCount = 30;
    const onSubmit = buildOnSubmit(turnCount);
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    for (let i = 1; i <= turnCount; i += 1) {
      stdin.write(`prompt ${i}`);
      stdin.write(ENTER);
      await waitFor(() => (lastFrame() ?? "").includes(`respuesta ${i}`));
    }

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Vos: prompt 1");
    expect(frame).toContain(`Vos: prompt ${turnCount}`);
    expect(frame).not.toContain("oculto");
  });

  /**
   * `ink-testing-library`'s `render` (used by every other test in this
   * file, via the module-level `render` import) always calls `ink`'s own
   * `render` with `debug: true` hardcoded — see
   * `node_modules/ink-testing-library/build/index.js:74` — with no option
   * to turn it off. In debug mode, `ink.js`'s `onRender`
   * (`node_modules/ink/build/ink.js`, ~lines 104-109) takes a completely
   * different branch than production: it accumulates ALL static output
   * ever produced into `this.fullStaticOutput` and does a single
   * `stdout.write(this.fullStaticOutput + output)` per render — one fresh,
   * fully-reassembled string every time, built directly from the current
   * React tree's child order. It never exercises the real, non-debug path
   * (~lines 118-131: `this.log.clear()` → `stdout.write(staticOutput)` →
   * `this.log(output)`) where this bug actually lived — the one where a
   * live `<Banner />` gets its own redraw written to the real stream
   * *after* each newly flushed static turn.
   *
   * Consequence: since a broken `<Banner />` (live, outside `<Static>`) is
   * still the first JSX child in both the buggy and fixed versions of
   * `App.tsx`, `lastFrame()` shows it "above" the conversation in BOTH
   * cases — debug mode's single reassembled string is ordered by JSX
   * position, not by write order over time. No assertion built on
   * `lastFrame()`/`ink-testing-library` can ever tell these two versions
   * apart, regardless of what it checks. This is a real gap, empirically
   * confirmed (`git stash` on `App.tsx` alone left every `ink-testing-
   * library`-based test in this file green, including the two banner-
   * ordering tests above), not a theoretical one.
   *
   * This block bypasses `ink-testing-library` and drives `ink`'s own
   * `render` directly, with `debug: false`, against fake `stdin`/`stdout`/
   * `stderr` streams that record every raw `stdout.write` call in order —
   * the same production code path a real terminal session takes, and the
   * only way to actually observe whether the banner is written to the
   * stream once, before the conversation, and never again.
   */
  describe("banner placement — real (non-debug) Ink render path", () => {
    it("flushes the banner to the real stdout stream exactly once, before the first completed turn, and never again afterwards", async () => {
      const onSubmit = vi
        .fn<(prompt: string) => Promise<TuiTurnResult>>()
        .mockResolvedValueOnce({ responseText: "respuesta uno", agentLabel: "Agente" })
        .mockResolvedValueOnce({ responseText: "respuesta dos", agentLabel: "Agente" });

      const stdin = new FakeInkStdin();
      const stdout = new FakeInkStdout();
      const stderr = new FakeInkStderr();

      const instance = renderInkDirect(<App onSubmit={onSubmit} />, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: stderr as unknown as NodeJS.WriteStream,
        debug: false,
        exitOnCtrlC: false,
        patchConsole: false,
      });

      try {
        // Same reasoning as `renderApp`'s own `settle()` call above: the
        // raw-stdin subscription is wired up in a `useEffect`, which React
        // only runs asynchronously after the initial mount.
        await settle();

        stdin.write("primer turno");
        stdin.write(ENTER);
        await waitFor(() => stdout.writes.some((chunk) => chunk.includes("respuesta uno")));

        const bannerIndex = stdout.writes.findIndex((chunk) => chunk.includes("arnés empresarial de IA"));
        const firstTurnIndex = stdout.writes.findIndex((chunk) => chunk.includes("respuesta uno"));
        expect(bannerIndex).toBeGreaterThanOrEqual(0);
        expect(firstTurnIndex).toBeGreaterThanOrEqual(0);
        // The real ordering assertion this describe block exists for: the
        // banner's write must precede the first completed turn's write in
        // the actual stream write sequence, not merely in a single
        // reassembled debug-mode string.
        expect(bannerIndex).toBeLessThan(firstTurnIndex);

        stdin.write("segundo turno");
        stdin.write(ENTER);
        await waitFor(() => stdout.writes.some((chunk) => chunk.includes("respuesta dos")));

        // The regression this bug actually was: the banner getting
        // rewritten to the stream again (and again) as more turns settle,
        // dragging it further down. Once flushed, it must never appear in
        // any later write.
        const laterBannerWrites = stdout.writes
          .slice(bannerIndex + 1)
          .filter((chunk) => chunk.includes("arnés empresarial de IA"));
        expect(laterBannerWrites).toHaveLength(0);
      } finally {
        instance.unmount();
        instance.cleanup();
      }
    });
  });

  /**
   * Role color differentiation ("Vos:" en cian, la respuesta del agente sin
   * color/por defecto) is asserted here by calling `TurnPrompt`/
   * `AgentResponse` directly as plain functions — NOT via JSX/`lastFrame()`
   * like the rest of this file. Both are hook-free function components (a
   * single `<Text>` each), so calling them directly returns the raw React
   * element with its `.props` inspectable straight away, bypassing Ink's
   * render pipeline entirely. This matters because `ink-testing-library`'s
   * `lastFrame()` does not carry color at all in this test environment: Ink
   * colors via Chalk internally, and Chalk detects "no color support" here,
   * so `color="cyan"` never shows up as an ANSI code in the returned string —
   * empirically confirmed, not a theoretical gap. Asserting on `.props.color`
   * directly is the only reliable way to test this.
   */
  describe("role color differentiation (props, not lastFrame)", () => {
    it("TurnPrompt renders in cyan, prefixed with '[timestamp]', and keeps the 'Vos:' echo content", () => {
      const element = TurnPrompt({ prompt: "hola", timestamp: "14:05:09" });

      expect(element.props.color).toBe("cyan");
      expect(element.props.children).toEqual(["[", "14:05:09", "] Vos: ", "hola"]);
      expect((element.props.children as string[]).join("")).toBe("[14:05:09] Vos: hola");
    });

    it("AgentResponse renders uncolored (no color prop) and keeps the agent label/response content", () => {
      const element = AgentResponse({ agentLabel: "Agente", responseText: "respuesta" });

      expect(element.props.color).toBeUndefined();
      expect(element.props.children).toEqual(["Agente", ": ", "respuesta"]);
    });
  });

  /**
   * PromptInput's blue border is asserted the same way `TurnPrompt`/
   * `AgentResponse` above assert their color: calling the function directly
   * and inspecting `.props`, not via JSX/`lastFrame()`. Same underlying
   * reason — Chalk (which Ink uses internally for `borderColor`, same as
   * `color`) detects "no color support" in this test environment, so
   * `borderColor="blue"` never shows up as an ANSI code in `lastFrame()`.
   * `borderStyle`/`width`, unlike `borderColor`, are not color, but are
   * asserted here too for the same reason `TurnPrompt` above asserts
   * `.props.children` directly instead of relying on `lastFrame()`: a
   * simpler, more direct assertion than reaching into a rendered frame's
   * Unicode box-drawing characters for something that is not itself about
   * visual output. The border's actual on-screen appearance (the `─` glyphs
   * it produces) is covered separately by the "frames the input line..."
   * `lastFrame()`-based test above, in the main `App` describe block, since
   * those glyphs ARE literal characters, not color.
   */
  describe("PromptInput framing (props, not lastFrame for color)", () => {
    it("renders a single-line blue border spanning the full width, and keeps the '> draft' content", () => {
      const element = PromptInput({ draft: "hola" });

      expect(element.props.borderStyle).toBe("single");
      expect(element.props.borderColor).toBe("blue");
      expect(element.props.width).toBe("100%");
      expect(element.props.children.props.children).toBe("> hola");
    });
  });

  /**
   * `computeFillerLines` is a pure function specifically so this logic can
   * be exhaustively tested without any Ink rendering at all — see its own
   * comment in `App.tsx` for why: `ink-testing-library`'s fake `stdout` (used
   * by nearly every other test in this file) has no `rows` property, so a
   * full-render assertion could never exercise the "generous terminal"
   * branch in the first place.
   */
  describe("computeFillerLines (pure)", () => {
    it("pads up to the terminal height when the terminal is generously tall", () => {
      const rows = BANNER_LINE_COUNT + PROMPT_INPUT_ROWS + 10;

      expect(computeFillerLines(rows)).toBe(10);
    });

    it("clamps to zero instead of going negative when the terminal is shorter than banner + input alone", () => {
      const rows = BANNER_LINE_COUNT + PROMPT_INPUT_ROWS - 1;

      expect(computeFillerLines(rows)).toBe(0);
    });

    it("returns zero when the terminal's row count is unknown (e.g. ink-testing-library's fake stdout)", () => {
      expect(computeFillerLines(undefined)).toBe(0);
    });
  });

  /**
   * End-to-end confirmation that `computeFillerLines`'s output actually
   * reaches the real terminal as blank rows, AND — the actual regression
   * this describe block exists for — that it never has to be taken back.
   * Same `FakeInkStdout` + `renderInkDirect` pattern as the "banner
   * placement" describe block above, for the same reason: `ink-testing-
   * library`'s fake `stdout` has no controllable `rows`, so only a real (or
   * realistically faked) Ink render path can exercise this at all. Uses
   * `debug: true` (unlike the banner-placement tests above, which use
   * `debug: false`) specifically to get the same accumulated-full-frame
   * writes `ink-testing-library` itself relies on internally — these tests
   * care about total line COUNT of the final rendered frame, which needs
   * the whole frame reassembled, not the incremental raw write sequence the
   * banner-placement tests inspect instead.
   */
  describe("bottom padding on an empty session (real Ink render path)", () => {
    it("pads the initial frame so an empty session's total rendered line count reaches the terminal's row count", async () => {
      const onSubmit = vi.fn();
      const rows = BANNER_LINE_COUNT + PROMPT_INPUT_ROWS + 7;

      const stdin = new FakeInkStdin();
      const stdout = new FakeInkStdout();
      stdout.rows = rows;
      const stderr = new FakeInkStderr();

      const instance = renderInkDirect(<App onSubmit={onSubmit} />, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: stderr as unknown as NodeJS.WriteStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      });

      try {
        await settle();

        const lastWrite = stdout.writes.at(-1) ?? "";
        // `debug: true` accumulates the full frame on every write (same
        // mechanism `ink-testing-library`'s own `lastFrame()` relies on) —
        // the last write is therefore the complete, final rendered frame.
        const lineCount = lastWrite.split("\n").length;

        expect(lineCount).toBe(rows);
      } finally {
        instance.unmount();
        instance.cleanup();
      }
    });

    // Regression test for the actual bug report: submitting a prompt on a
    // freshly padded, empty session made the whole screen visibly "jump"
    // back upward. Root cause (see `computeFillerLines`'s module doc for
    // the full account): an earlier version recomputed the filler from
    // live state, gated on "no turns yet" — the instant a prompt was sent,
    // that gate flipped and the filler collapsed to 0 in the same render as
    // a LIVE (redrawable) element, so Ink erased that many rows via
    // cursor-up escapes. Fixed by freezing the filler once and flushing it
    // as a `<Static>` item instead (same file, same fix) — this test proves
    // that fix holds by checking the one thing that actually matters: the
    // rendered line count must never DECREASE across a submit, only grow or
    // stay the same, however many turns are sent.
    it("never shrinks the total rendered line count when a prompt is submitted on a padded, empty session", async () => {
      const onSubmit = vi.fn().mockResolvedValue({ responseText: "respuesta", agentLabel: "Agente" });
      const rows = BANNER_LINE_COUNT + PROMPT_INPUT_ROWS + 12;

      const stdin = new FakeInkStdin();
      const stdout = new FakeInkStdout();
      stdout.rows = rows;
      const stderr = new FakeInkStderr();

      const instance = renderInkDirect(<App onSubmit={onSubmit} />, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: stderr as unknown as NodeJS.WriteStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      });

      try {
        await settle();

        const lineCountBeforeSubmit = (stdout.writes.at(-1) ?? "").split("\n").length;
        expect(lineCountBeforeSubmit).toBe(rows);

        stdin.write("primer prompt");
        stdin.write(ENTER);

        // Immediately after submit, while the turn is still pending — the
        // exact instant the original bug's collapse happened.
        const lineCountWhilePending = (stdout.writes.at(-1) ?? "").split("\n").length;
        expect(lineCountWhilePending).toBeGreaterThanOrEqual(lineCountBeforeSubmit);

        await waitFor(() => (stdout.writes.at(-1) ?? "").includes("respuesta"));

        // And once the turn settles (flushes into `<Static>`, replacing the
        // pending indicator) — the other point where a naive fix could
        // still shrink things.
        const lineCountAfterSettle = (stdout.writes.at(-1) ?? "").split("\n").length;
        expect(lineCountAfterSettle).toBeGreaterThanOrEqual(lineCountBeforeSubmit);
      } finally {
        instance.unmount();
        instance.cleanup();
      }
    });
  });
});
