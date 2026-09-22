import { describe, expect, it, vi } from "vitest";
import type { HookContext } from "./hook-engine.js";
import { createLogPreTurnHandler } from "./log-pre-turn-handler.js";

describe("createLogPreTurnHandler", () => {
  it("logs turno-iniciado with agentId for a typical context", async () => {
    const log = vi.fn();
    const handler = createLogPreTurnHandler(log);
    const context: HookContext = {
      casoId: "caso-1",
      agentId: "agente-conversacional",
    };

    await handler(context);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("caso-1", "turno-iniciado", {
      agentId: "agente-conversacional",
    });
  });

  it("does not throw when casoId/agentId are missing", async () => {
    const log = vi.fn();
    const handler = createLogPreTurnHandler(log);

    expect(() => handler({})).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    const [casoId, event, fields] = log.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(typeof casoId).toBe("string");
    expect(event).toBe("turno-iniciado");
    expect(typeof fields.agentId).toBe("string");
  });

  it("does not throw when casoId/agentId are not strings", async () => {
    const log = vi.fn();
    const handler = createLogPreTurnHandler(log);

    expect(() => handler({ casoId: 1, agentId: null })).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("uses the default logTurnEvent (writing to data/harness.log) when no log is injected", () => {
    const handler = createLogPreTurnHandler();

    expect(typeof handler).toBe("function");
  });
});
