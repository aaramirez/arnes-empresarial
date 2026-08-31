import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { startTui, type ClearScreen, type RenderTui } from "./start-tui.js";
import type { SubmitPromptHandler } from "./tui-port.js";

describe("startTui", () => {
  it("calls clearScreen before renderTui is called", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const calls: string[] = [];
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      calls.push("renderTui");
      return fakeInstance;
    });
    const clearScreen: ClearScreen = vi.fn().mockImplementation(() => {
      calls.push("clearScreen");
    });

    startTui(onSubmit, renderTui, clearScreen);

    expect(calls).toEqual(["clearScreen", "renderTui"]);
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

  it("lets a synchronous renderTui error propagate unchanged, without calling anything else", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const renderCrash = new Error("reconciler blew up");
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      throw renderCrash;
    });
    const clearScreen: ClearScreen = vi.fn();

    // `toThrow(renderCrash)` alone only compares `.message` (confirmed
    // against Vitest's own matcher — same as Jest's), so it would not catch
    // a future `try`/`catch` wrapper that reconstructs a new `Error` with
    // the same message instead of truly propagating this one. `startTui`
    // has no such wrapper today (the error just propagates via normal JS
    // exception semantics), but asserting on the caught object's identity
    // directly is what actually proves that, not just the message matching.
    let caught: unknown;
    try {
      startTui(onSubmit, renderTui, clearScreen);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(renderCrash);

    expect(clearScreen).toHaveBeenCalledTimes(1);
  });
});
