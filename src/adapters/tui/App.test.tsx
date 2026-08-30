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
// Raw byte for Ctrl+J (linefeed, `\n`) — distinct from `ENTER`'s `\r`. See
// `App.tsx`'s module doc for why Ctrl+J, and not Shift+Enter, is the
// multiline-insert trigger.
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
    const onSubmit = vi.fn();

    const { lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    expect(lastFrame()).toContain("arnés empresarial de IA");
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

  it("inserts a line break into the draft on Ctrl+J instead of submitting", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("linea1");
    stdin.write(CTRL_J);
    stdin.write("linea2");

    expect(lastFrame()).toContain("> linea1\nlinea2");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a multiline draft on Enter with the embedded line break intact", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ responseText: "ok", agentLabel: "Agente" });
    const { stdin } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("linea1");
    stdin.write(CTRL_J);
    stdin.write("linea2");
    stdin.write(ENTER);

    expect(onSubmit).toHaveBeenCalledWith("linea1\nlinea2");
  });

  it("ignores Ctrl+J while a submission is still pending", async () => {
    const { promise } = deferred<TuiTurnResult>();
    const onSubmit = vi.fn().mockReturnValue(promise);
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("primero");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Line count right before Ctrl+J, not the frame's exact text: the
    // pending indicator's spinner (`ink-spinner`) redraws its glyph on its
    // own timer independent of these writes, so comparing full frame
    // equality would be flaky. A leaked `\n` — the exact regression this
    // test guards against, see the Reviewer finding this test was added
    // for — would still grow the frame by one line (the draft's empty
    // prompt line splitting in two), which the spinner's own redraws never
    // do.
    const lineCountBeforeCtrlJ = (lastFrame() ?? "").split("\n").length;

    stdin.write(CTRL_J);
    stdin.write("segundo");

    // Not enough to check "segundo" never appears: the guard must also
    // block the raw `\n` byte itself, or a leaked line break would slip
    // into the draft silently while every literal character after it is
    // still (correctly) rejected — see this file's module doc note and
    // `App.tsx`'s own module doc on why the Ctrl+J branch sits before this
    // guard. Mutation-confirmed: moving that branch ahead of the
    // `pendingRef` check leaves the `not.toContain("segundo")` assertion
    // alone green, but grows the line count below.
    expect(lastFrame()).not.toContain("segundo");
    expect((lastFrame() ?? "").split("\n").length).toBe(lineCountBeforeCtrlJ);
  });

  it("does not call onSubmit when Enter is pressed on a draft containing only line breaks", async () => {
    const onSubmit = vi.fn();
    const { stdin } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write(CTRL_J);
    stdin.write(CTRL_J);
    stdin.write(ENTER);

    // A draft made up entirely of line breaks is still whitespace-only —
    // `submitDraft`'s existing `.trim()` guard (the same one that already
    // covers a blank draft) must treat it as an empty submission, same as
    // pressing Enter with nothing typed at all.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("removes exactly the line break on backspace after Ctrl+J", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    stdin.write("linea1");
    stdin.write(CTRL_J);
    stdin.write(BACKSPACE);

    // The draft line itself (not the whole frame, which also contains the
    // multiline banner) must be back to a single line with no embedded `\n`.
    expect((lastFrame() ?? "").trimEnd().endsWith("> linea1")).toBe(true);
    expect(lastFrame()).not.toContain("> linea1\n");
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

  it("recalls a multiline entry from history and resubmits it with the embedded line break intact", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ responseText: "ok", agentLabel: "Agente" });
    const { stdin, lastFrame } = await renderApp(<App onSubmit={onSubmit} />);

    // Send a multiline draft first (same mechanism as the "Multiline
    // input" tests above), so it lands in `promptHistoryRef` with its `\n`
    // intact.
    stdin.write("linea1");
    stdin.write(CTRL_J);
    stdin.write("linea2");
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenNthCalledWith(1, "linea1\nlinea2");
    // Must wait for the turn to settle (clearing `pendingRef`) before the
    // next raw input — see the earlier tests' comment on why arrow-up
    // right after an unsettled submit gets silently dropped by the
    // still-pending guard.
    await waitFor(() => (lastFrame() ?? "").includes("Agente: ok"));

    // Recall it from history and resend it as-is — the generic history
    // mechanism and the multiline mechanism are both exercised by earlier
    // tests separately, but not together: this is the one test that proves
    // recalling a multiline entry does not truncate or otherwise mangle the
    // embedded `\n` before it reaches `onSubmit` again.
    stdin.write(ARROW_UP);
    stdin.write(ENTER);
    expect(onSubmit).toHaveBeenNthCalledWith(2, "linea1\nlinea2");
  });
});
