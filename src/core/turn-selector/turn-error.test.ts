import { describe, expect, it } from "vitest";
import { runTurnStage, TurnFailedError, type TurnStage } from "./turn-error.js";

describe("runTurnStage", () => {
  it("resolves with the value returned synchronously by fn when there is no error", async () => {
    const result = await runTurnStage("context", () => "valor síncrono");

    expect(result).toBe("valor síncrono");
  });

  it("resolves with the value fn's returned promise resolves to when there is no error", async () => {
    const result = await runTurnStage("model", () => Promise.resolve({ ok: true }));

    expect(result).toEqual({ ok: true });
  });

  it("wraps a synchronous exception thrown by fn in a TurnFailedError with the correct stage and cause", async () => {
    const original = new Error("fallo de memoria");

    await expect(
      runTurnStage("context", () => {
        throw original;
      }),
    ).rejects.toMatchObject({
      name: "TurnFailedError",
      stage: "context",
      cause: original,
    });
  });

  it("wraps an async rejection from fn's returned promise in a TurnFailedError with the correct stage and cause", async () => {
    const original = new Error("fallo del modelo");

    await expect(runTurnStage("model", () => Promise.reject(original))).rejects.toMatchObject({
      name: "TurnFailedError",
      stage: "model",
      cause: original,
    });
  });

  it.each<TurnStage>(["context", "model", "close"])(
    "preserves the stage %s when fn fails",
    async (stage) => {
      const original = new Error(`fallo en ${stage}`);

      await expect(
        runTurnStage(stage, () => {
          throw original;
        }),
      ).rejects.toMatchObject({ stage });
    },
  );

  it("includes the original error's message in TurnFailedError's own message when cause is an Error instance", async () => {
    const original = new Error("la memoria compartida no respondió");

    await expect(runTurnStage("close", () => Promise.reject(original))).rejects.toThrow(
      /la memoria compartida no respondió/,
    );
  });
});

describe("TurnFailedError", () => {
  it("falls back to String(cause) in its message when the cause is not an Error instance", () => {
    const error = new TurnFailedError("context", "cadena de error cruda");

    expect(error.message).toContain("cadena de error cruda");
    expect(error.stage).toBe("context");
    expect(error.cause).toBe("cadena de error cruda");
  });
});
