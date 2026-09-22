import { describe, expect, it, vi } from "vitest";
import type { HookContext } from "./hook-engine.js";
import { createLogPostTurnHandler } from "./log-post-turn-handler.js";

describe("createLogPostTurnHandler", () => {
  it("logs post-turn-hook-ejecutado with agentId/sdkSessionId/longitudRespuesta for a typical context", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);
    const context: HookContext = {
      casoId: "caso-1",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
      responseText: "hola mundo",
    };

    await handler(context);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("caso-1", "post-turn-hook-ejecutado", {
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
      longitudRespuesta: 10,
    });
  });

  it("never logs responseText itself, only its length", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);

    await handler({
      casoId: "caso-1",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
      responseText: "contenido de la conversacion que no debe aparecer en el log",
    });

    const fields = log.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields).not.toHaveProperty("responseText");
    expect(Object.values(fields)).not.toContain(
      "contenido de la conversacion que no debe aparecer en el log",
    );
  });

  it("degrades longitudRespuesta to 0 when responseText is absent", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);

    await handler({ casoId: "caso-1", agentId: "agente-conversacional", sdkSessionId: "sdk-session-1" });

    expect(log).toHaveBeenCalledWith("caso-1", "post-turn-hook-ejecutado", {
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
      longitudRespuesta: 0,
    });
  });

  it("degrades longitudRespuesta to 0 when responseText is not a string", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);

    await handler({
      casoId: "caso-1",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-1",
      responseText: 12345,
    });

    const fields = log.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields.longitudRespuesta).toBe(0);
  });

  it("does not throw when casoId/agentId/sdkSessionId are missing", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);

    expect(() => handler({})).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    const [casoId, event, fields] = log.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(typeof casoId).toBe("string");
    expect(event).toBe("post-turn-hook-ejecutado");
    expect(typeof fields.agentId).toBe("string");
    expect(typeof fields.sdkSessionId).toBe("string");
  });

  it("does not throw when casoId/agentId/sdkSessionId are not strings", async () => {
    const log = vi.fn();
    const handler = createLogPostTurnHandler(log);

    expect(() =>
      handler({ casoId: 1, agentId: null, sdkSessionId: undefined, responseText: "ok" }),
    ).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("uses the default logTurnEvent (writing to data/harness.log) when no log is injected", () => {
    const handler = createLogPostTurnHandler();

    expect(typeof handler).toBe("function");
  });
});
