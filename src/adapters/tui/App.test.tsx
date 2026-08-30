import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
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

describe("App", () => {
  it("renders an empty input line and does not call onSubmit on first render", async () => {
    const onSubmit = vi.fn();

    const { lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    expect(lastFrame()).toContain(">");
    expect(onSubmit).not.toHaveBeenCalled();
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

    expect(onSubmit).toHaveBeenCalledWith("hola agente");
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
    expect(onSubmit).toHaveBeenNthCalledWith(2, "otro prompt");

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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> linea1 linea");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe(">");
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

    expect(onSubmit).toHaveBeenCalledWith("linea1 linea2");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe(">");

    // Also proves `historyIndexRef` was NOT flipped into "navigating" mode
    // by the arrow-up above (which the rendered draft alone cannot show,
    // since it stays empty either way): typing, then arrow-down, must
    // behave as ordinary un-navigated input — if the empty-history guard
    // were missing, arrow-down would instead treat this as "past the newest
    // recalled entry" and wipe the typed text back to the (empty) snapshot
    // taken before the arrow-up.
    stdin.write("x");
    stdin.write(ARROW_DOWN);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> x");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundo");

    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");

    // Third arrow-up: already at the oldest entry, must stay clamped there
    // instead of wrapping around.
    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe(">");

    // Also confirms it did not silently enter navigation mode either: an
    // unmodified arrow-up right after must behave as the *first* arrow-up
    // (recalling the newest entry), not as a second step already inside
    // navigation.
    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundo");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundo");
    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");

    stdin.write(ARROW_DOWN);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundo");

    stdin.write(ARROW_DOWN);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> borrador sin enviar");
  });

  it("does nothing on arrow-down when history navigation was never entered", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("algo escrito");
    stdin.write(ARROW_DOWN);

    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> algo escrito");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundo");

    // Edit the recalled entry in place — this must NOT be persisted back
    // into `promptHistoryRef`, and must NOT reset `historyIndexRef` either
    // (see `App.tsx`'s new module-doc note on history navigation).
    stdin.write("X");
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> segundoX");

    // Navigating again must jump to the previous entry ("primero"), not to
    // the edited text — this is what would break if `historyIndexRef` got
    // reset by the character-append branch above.
    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");
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
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");

    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenNthCalledWith(2, "primero");
    // See earlier tests' comment on why this waits for settled text instead
    // of `onSubmit.mock.calls.length`.
    await waitFor(() => (lastFrame() ?? "").includes("respuesta 2"));

    // Submitting reset navigation back to the present and appended "primero"
    // again as the newest entry — one arrow-up must recall it once more.
    stdin.write(ARROW_UP);
    expect((lastFrame() ?? "").split("\n").at(-1)).toBe("> primero");
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
});
