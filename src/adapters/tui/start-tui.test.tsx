import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { startTui, type RenderTui } from "./start-tui.js";
import type { SubmitPromptHandler } from "./tui-port.js";

const CLEAR_AND_HOME = "\x1B[2J\x1B[H";

describe("startTui", () => {
  it("writes CLEAR_AND_HOME before renderTui is called", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const calls: string[] = [];
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      calls.push("renderTui");
      return fakeInstance;
    });
    const writeToTerminal = vi.fn().mockImplementation((data: string) => {
      calls.push(`write:${data}`);
    });

    startTui(onSubmit, renderTui, writeToTerminal);

    expect(calls).toEqual([`write:${CLEAR_AND_HOME}`, "renderTui"]);
  });

  it("renders <App onSubmit={onSubmit} /> via the injected renderer", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);

    startTui(onSubmit, renderTui, vi.fn());

    expect(renderTui).toHaveBeenCalledTimes(1);
    const [tree] = vi.mocked(renderTui).mock.calls[0]!;
    expect(tree.type).toBe(App);
    expect(tree.props.onSubmit).toBe(onSubmit);
  });

  it("returns the exact instance renderTui returned, with no wrapping", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);

    const instance = startTui(onSubmit, renderTui, vi.fn());

    expect(instance).toBe(fakeInstance);
    expect(instance.unmount).toBe(fakeInstance.unmount);
    expect(instance.waitUntilExit).toBe(fakeInstance.waitUntilExit);
  });

  it("lets a synchronous renderTui error propagate unchanged, without writing anything else", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const renderCrash = new Error("reconciler blew up");
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      throw renderCrash;
    });
    const writeToTerminal = vi.fn();

    // `toThrow(renderCrash)` alone only compares `.message` (confirmed
    // against Vitest's own matcher — same as Jest's), so it would not catch
    // a future `try`/`catch` wrapper that reconstructs a new `Error` with
    // the same message instead of truly propagating this one. `startTui`
    // has no such wrapper today (the error just propagates via normal JS
    // exception semantics), but asserting on the caught object's identity
    // directly is what actually proves that, not just the message matching.
    let caught: unknown;
    try {
      startTui(onSubmit, renderTui, writeToTerminal);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(renderCrash);

    expect(writeToTerminal).toHaveBeenCalledTimes(1);
    expect(writeToTerminal).toHaveBeenCalledWith(CLEAR_AND_HOME);
  });
});
