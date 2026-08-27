import { describe, expect, it, vi } from "vitest";
import { createHookEngine } from "./hook-engine.js";

describe("hook engine", () => {
  it("resolves without error when triggering a point with no registered handlers (Hito 1 empty-registry case)", async () => {
    const engine = createHookEngine();

    await expect(engine.triggerHook("POST_TURN")).resolves.toBeUndefined();
  });

  it("calls a registered handler with the given context when its point fires", async () => {
    const engine = createHookEngine();
    const handler = vi.fn();

    engine.registerHook("POST_TURN", handler);
    await engine.triggerHook("POST_TURN", { caseId: "caso-1" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ caseId: "caso-1" });
  });

  it("does not call a handler registered for a different point", async () => {
    const engine = createHookEngine();
    const preTurnHandler = vi.fn();
    const postTurnHandler = vi.fn();

    engine.registerHook("PRE_TURN", preTurnHandler);
    engine.registerHook("POST_TURN", postTurnHandler);
    await engine.triggerHook("POST_TURN", { caseId: "caso-2" });

    expect(postTurnHandler).toHaveBeenCalledTimes(1);
    expect(preTurnHandler).not.toHaveBeenCalled();
  });

  it("calls multiple handlers for the same point in registration order", async () => {
    const engine = createHookEngine();
    const calls: string[] = [];

    engine.registerHook("POST_TURN", () => {
      calls.push("first");
    });
    engine.registerHook("POST_TURN", () => {
      calls.push("second");
    });
    await engine.triggerHook("POST_TURN");

    expect(calls).toEqual(["first", "second"]);
  });

  it("awaits async handlers before the trigger promise resolves", async () => {
    const engine = createHookEngine();
    const calls: string[] = [];

    engine.registerHook("POST_TURN", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push("async-handler-done");
    });

    await engine.triggerHook("POST_TURN");

    expect(calls).toEqual(["async-handler-done"]);
  });

  it("keeps separate handler registries across independently created engines", async () => {
    const engineA = createHookEngine();
    const engineB = createHookEngine();
    const handlerA = vi.fn();

    engineA.registerHook("POST_TURN", handlerA);
    await engineB.triggerHook("POST_TURN");

    expect(handlerA).not.toHaveBeenCalled();
  });

  it("waits for an earlier async handler to finish before running the next one (proves sequential, not concurrent, execution)", async () => {
    const engine = createHookEngine();
    const calls: string[] = [];

    engine.registerHook("POST_TURN", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      calls.push("first");
    });
    engine.registerHook("POST_TURN", () => {
      calls.push("second");
    });
    await engine.triggerHook("POST_TURN");

    // With Promise.all-style concurrent execution the sync handler would
    // finish first, producing ["second", "first"] — only a true
    // for...of + await sequence produces this exact order.
    expect(calls).toEqual(["first", "second"]);
  });

  it("propagates a handler's error and skips the remaining handlers for that point", async () => {
    const engine = createHookEngine();
    let thirdHandlerRan = false;

    engine.registerHook("POST_TURN", () => {
      /* first handler: no-op */
    });
    engine.registerHook("POST_TURN", () => {
      throw new Error("boom");
    });
    engine.registerHook("POST_TURN", () => {
      thirdHandlerRan = true;
    });

    await expect(engine.triggerHook("POST_TURN")).rejects.toThrow("boom");
    expect(thirdHandlerRan).toBe(false);
  });
});
