import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { startTui, type RenderTui } from "./start-tui.js";
import type { SubmitPromptHandler } from "./tui-port.js";

const ENTER_ALT_SCREEN = "\x1B[?1049h";
const EXIT_ALT_SCREEN = "\x1B[?1049l";
const CLEAR_AND_HOME = "\x1B[2J\x1B[H";

describe("startTui", () => {
  it("renders <App onSubmit={onSubmit} /> via the injected renderer and its instance delegates unmount/waitUntilExit to the fake", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);

    const instance = startTui(onSubmit, renderTui, vi.fn());

    expect(renderTui).toHaveBeenCalledTimes(1);
    const [tree] = vi.mocked(renderTui).mock.calls[0]!;
    expect(tree.type).toBe(App);
    expect(tree.props.onSubmit).toBe(onSubmit);

    instance.unmount();
    expect(fakeInstance.unmount).toHaveBeenCalledTimes(1);

    await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    expect(fakeInstance.waitUntilExit).toHaveBeenCalledTimes(1);
  });

  it("writes the alt-screen enter sequence and the clear+home sequence before renderTui is called, enter sequence first", () => {
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

    expect(writeToTerminal).toHaveBeenCalledWith(ENTER_ALT_SCREEN);
    expect(writeToTerminal).toHaveBeenCalledWith(CLEAR_AND_HOME);
    // Both terminal writes happen before renderTui, and ENTER_ALT_SCREEN
    // must come before CLEAR_AND_HOME: reversing the order would clear and
    // home the cursor in the user's ORIGINAL buffer (the one active before
    // the TUI started), not the alternate one — corrupting the exact buffer
    // the module doc promises to restore untouched on exit.
    expect(calls).toEqual([`write:${ENTER_ALT_SCREEN}`, `write:${CLEAR_AND_HOME}`, "renderTui"]);
  });

  it("writes the alt-screen exit sequence after waitUntilExit resolves", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);
    const writeToTerminal = vi.fn();

    const instance = startTui(onSubmit, renderTui, writeToTerminal);
    await instance.waitUntilExit();

    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("writes the alt-screen exit sequence and still propagates the rejection when waitUntilExit rejects", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const rejection = new Error("render crashed");
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockRejectedValue(rejection) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);
    const writeToTerminal = vi.fn();

    const instance = startTui(onSubmit, renderTui, writeToTerminal);

    await expect(instance.waitUntilExit()).rejects.toBe(rejection);
    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("still resolves waitUntilExit with the original result when writing the exit sequence itself throws", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);
    const writeToTerminal = vi.fn().mockImplementation((data: string) => {
      if (data === EXIT_ALT_SCREEN) {
        throw new Error("stdout already torn down");
      }
    });

    const instance = startTui(onSubmit, renderTui, writeToTerminal);

    await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("still rejects waitUntilExit with the original rejection when writing the exit sequence itself throws", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const rejection = new Error("render crashed");
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockRejectedValue(rejection) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);
    const writeToTerminal = vi.fn().mockImplementation((data: string) => {
      if (data === EXIT_ALT_SCREEN) {
        throw new Error("stdout already torn down");
      }
    });

    const instance = startTui(onSubmit, renderTui, writeToTerminal);

    await expect(instance.waitUntilExit()).rejects.toBe(rejection);
    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("writes the alt-screen exit sequence and rethrows the original error when renderTui throws synchronously", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const renderCrash = new Error("reconciler blew up");
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      throw renderCrash;
    });
    const writeToTerminal = vi.fn();

    expect(() => startTui(onSubmit, renderTui, writeToTerminal)).toThrow(renderCrash);
    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("rethrows the exact same error object renderTui threw, not a reconstructed one — Vitest's toThrow(errorInstance) only compares message, so identity needs its own assertion", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    class ReconcilerError extends Error {
      readonly componentStack = "<App><Banner>";
    }
    const renderCrash = new ReconcilerError("reconciler blew up");
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      throw renderCrash;
    });
    const writeToTerminal = vi.fn();

    let caught: unknown;
    try {
      startTui(onSubmit, renderTui, writeToTerminal);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(renderCrash);
  });

  it("rethrows the original renderTui error even when writing the exit sequence itself throws", () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const renderCrash = new Error("reconciler blew up");
    const renderTui: RenderTui = vi.fn().mockImplementation(() => {
      throw renderCrash;
    });
    const writeToTerminal = vi.fn().mockImplementation((data: string) => {
      if (data === EXIT_ALT_SCREEN) {
        throw new Error("stdout already torn down");
      }
    });

    expect(() => startTui(onSubmit, renderTui, writeToTerminal)).toThrow(renderCrash);
    expect(writeToTerminal).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
  });

  it("returns the same waitUntilExit promise on repeated calls, matching Ink's own idempotent contract", async () => {
    const onSubmit: SubmitPromptHandler = vi.fn();
    const fakeInstance = { unmount: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    const renderTui: RenderTui = vi.fn().mockReturnValue(fakeInstance);
    const writeToTerminal = vi.fn();

    const instance = startTui(onSubmit, renderTui, writeToTerminal);

    const first = instance.waitUntilExit();
    const second = instance.waitUntilExit();

    expect(first).toBe(second);
    await first;
    expect(writeToTerminal).toHaveBeenCalledTimes(3); // ENTER_ALT_SCREEN, CLEAR_AND_HOME, EXIT_ALT_SCREEN
    expect(writeToTerminal.mock.calls.filter(([data]) => data === EXIT_ALT_SCREEN)).toHaveLength(1);
  });
});
