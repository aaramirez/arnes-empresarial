import { afterEach, describe, expect, it, vi } from "vitest";
import { logTurnEvent } from "./turn-logger.js";

describe("logTurnEvent", () => {
  it("writes a JSON line with casoId, event, the injected timestamp, and the extra fields", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { agentId: "agente-conversacional" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
      agentId: "agente-conversacional",
    });
  });

  it("writes casoId/event/timestamp without extra fields when fields is omitted", () => {
    const write = vi.fn();

    logTurnEvent("caso-1", "turno-iniciado", undefined, {
      now: () => "2026-08-28T00:00:00.000Z",
      write,
    });

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  it("keeps the positional casoId when fields includes a different casoId key", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { casoId: "caso-suplantado" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  it("keeps the injected now() timestamp when fields includes a different timestamp key", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { timestamp: "2000-01-01T00:00:00.000Z" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  describe("default deps", () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    afterEach(() => {
      consoleLogSpy.mockClear();
    });

    it("writes a parseable JSON line to console.log with the expected casoId when deps is omitted", () => {
      logTurnEvent("caso-1", "turno-iniciado");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const line = consoleLogSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toMatchObject({ casoId: "caso-1", event: "turno-iniciado" });
      expect(typeof parsed.timestamp).toBe("string");
    });
  });
});
