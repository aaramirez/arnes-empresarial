import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TestRunnerConfig } from "./config.js";
import { TestRunnerCliError, type TestRunResult } from "./test-runner-cli.js";
import {
  handleRunTests,
  SALIDA_TRUNCADA_PREFIJO,
  TEST_OUTPUT_MAX_CHARS,
  truncarConservandoCola,
  type TestRunnerToolDeps,
} from "./test-runner-tool.js";

const CONFIG: TestRunnerConfig = {
  timeoutMs: 300_000,
  vitestEntrypoint: resolve("/repo/node_modules/vitest/vitest.mjs"),
};
const CWD = "/tmp/harness/worktrees/caso-abc";

function makeDeps(overrides: Partial<TestRunnerToolDeps> = {}): TestRunnerToolDeps {
  return {
    casoId: "caso-1",
    config: CONFIG,
    cwd: CWD,
    runTests: vi.fn(),
    logEvent: vi.fn(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return { exitCode: 0, output: "12 passed\n", durationMs: 42, ...overrides };
}

describe("truncarConservandoCola", () => {
  it("returns short output intact, with no marker", () => {
    const salida = "12 passed\n";

    const resultado = truncarConservandoCola(salida);

    expect(resultado).toBe(salida);
    expect(resultado).not.toContain(SALIDA_TRUNCADA_PREFIJO);
  });

  it("returns output exactly at the limit intact, with no marker", () => {
    const salida = "x".repeat(TEST_OUTPUT_MAX_CHARS);

    const resultado = truncarConservandoCola(salida);

    expect(resultado).toBe(salida);
    expect(resultado).not.toContain(SALIDA_TRUNCADA_PREFIJO);
  });

  it("truncates long output to <= TEST_OUTPUT_MAX_CHARS, starting with the marker and ending exactly like the original", () => {
    const cola = "FAIL src/foo.test.ts\n1 failed, 999 passed\n";
    const salida = "x".repeat(TEST_OUTPUT_MAX_CHARS + 500) + cola;

    const resultado = truncarConservandoCola(salida);

    expect(resultado.length).toBeLessThanOrEqual(TEST_OUTPUT_MAX_CHARS);
    expect(resultado.startsWith(SALIDA_TRUNCADA_PREFIJO)).toBe(true);
    expect(resultado.endsWith(cola)).toBe(true);
    expect(salida.endsWith(resultado.slice(SALIDA_TRUNCADA_PREFIJO.length))).toBe(true);
  });

  it("never splits a surrogate pair sitting exactly at the naive truncation boundary", () => {
    // U+1F600 GRINNING FACE — a valid surrogate pair (high 0xD83D, low 0xDE00).
    const emoji = "\u{1F600}";
    const presupuesto = TEST_OUTPUT_MAX_CHARS - SALIDA_TRUNCADA_PREFIJO.length;
    // Construct salida = relleno + emoji + cola such that the naive cut point
    // (salida.length - presupuesto) lands exactly on the emoji's LOW surrogate:
    // for ANY relleno length R, that holds when cola.length === presupuesto - 1
    // (algebra: naive = R + 2 + cola.length - presupuesto = R + 1 = low-surrogate index).
    const relleno = "y".repeat(50);
    const cola = "z".repeat(presupuesto - 1 - "COLA-FIN".length) + "COLA-FIN";
    const salida = relleno + emoji + cola;
    const lowSurrogateIndex = relleno.length + 1;
    expect(salida.length - presupuesto).toBe(lowSurrogateIndex); // sanity-check the construction itself

    const resultado = truncarConservandoCola(salida);

    // No lone surrogate anywhere in the result (JSON.stringify would blow up on one).
    expect(() => JSON.stringify(resultado)).not.toThrow();
    for (let i = 0; i < resultado.length; i += 1) {
      const code = resultado.charCodeAt(i);
      const isLow = code >= 0xdc00 && code <= 0xdfff;
      if (isLow) {
        // A low surrogate must always be immediately preceded by its high surrogate.
        expect(resultado.charCodeAt(i - 1)).toBeGreaterThanOrEqual(0xd800);
        expect(resultado.charCodeAt(i - 1)).toBeLessThanOrEqual(0xdbff);
      }
    }
    expect(resultado.startsWith(SALIDA_TRUNCADA_PREFIJO)).toBe(true);
    expect(resultado.endsWith(cola)).toBe(true);
    expect(resultado.endsWith("COLA-FIN")).toBe(true);
    expect(resultado.length).toBeLessThanOrEqual(TEST_OUTPUT_MAX_CHARS);
  });

  it("respects a custom maxChars argument (bigger than the marker itself)", () => {
    const maxChars = SALIDA_TRUNCADA_PREFIJO.length + 8;
    const salida = "X".repeat(100) + "TAILEND"; // longer than maxChars, distinctive tail

    const resultado = truncarConservandoCola(salida, maxChars);

    expect(resultado.length).toBeLessThanOrEqual(maxChars);
    expect(resultado.startsWith(SALIDA_TRUNCADA_PREFIJO)).toBe(true);
    expect(resultado.endsWith("TAILEND")).toBe(true);
  });
});

describe("handleRunTests — TESTS EN VERDE", () => {
  it("returns the exact green text with exitCode and durationMs, output untouched when short", async () => {
    const runTests = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, output: "12 passed\n", durationMs: 123 }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("TESTS EN VERDE (exit 0, 123 ms).\n\n12 passed\n");
  });

  it("truncates a long green output while keeping the exit/duration header intact", async () => {
    const largo = "x".repeat(TEST_OUTPUT_MAX_CHARS + 500) + "cola-final";
    const runTests = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, output: largo, durationMs: 7 }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text.startsWith("TESTS EN VERDE (exit 0, 7 ms).\n\n")).toBe(true);
    expect(result.content[0].text).toContain(SALIDA_TRUNCADA_PREFIJO);
    expect(result.content[0].text.endsWith("cola-final")).toBe(true);
  });
});

describe("handleRunTests — TESTS EN ROJO", () => {
  it("returns the exact red text with the non-zero exitCode and durationMs", async () => {
    const runTests = vi
      .fn()
      .mockResolvedValue(makeResult({ exitCode: 1, output: "1 failed, 11 passed\n", durationMs: 456 }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text).toBe(
      "TESTS EN ROJO (exit 1, 456 ms). Arreglá lo que falla antes de dar por terminado tu trabajo.\n\n1 failed, 11 passed\n",
    );
  });
});

describe("handleRunTests — rama degradada (nunca lanza)", () => {
  it("returns a degraded text mentioning the reason when runTests rejects with TestRunnerCliError('not-found')", async () => {
    const runTests = vi.fn().mockRejectedValue(new TestRunnerCliError("not-found", { code: "ENOENT" }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text).toBe(
      "NO SE PUDIERON CORRER LOS TESTS: el binario/entrypoint de vitest no está disponible. Decilo explícitamente en tu resultado en vez de afirmar que pasan.",
    );
  });

  it("returns a degraded text mentioning the reason when runTests rejects with TestRunnerCliError('timeout')", async () => {
    const runTests = vi.fn().mockRejectedValue(new TestRunnerCliError("timeout", { killed: true }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text).toBe(
      "NO SE PUDIERON CORRER LOS TESTS: la corrida de tests tardó demasiado. Decilo explícitamente en tu resultado en vez de afirmar que pasan.",
    );
  });

  it("treats a rejection that is not a TestRunnerCliError as reason unknown, without throwing", async () => {
    const runTests = vi.fn().mockRejectedValue(new Error("boom"));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text).toBe(
      "NO SE PUDIERON CORRER LOS TESTS: error desconocido. Decilo explícitamente en tu resultado en vez de afirmar que pasan.",
    );
  });

  it("never rejects, even when runTests throws SYNCHRONOUSLY instead of returning a rejected promise", async () => {
    const runTests = vi.fn(() => {
      throw new TestRunnerCliError("timeout", { killed: true });
    }) as unknown as TestRunnerToolDeps["runTests"];
    const deps = makeDeps({ runTests });

    await expect(handleRunTests(deps)).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "NO SE PUDIERON CORRER LOS TESTS: la corrida de tests tardó demasiado. Decilo explícitamente en tu resultado en vez de afirmar que pasan.",
        },
      ],
    });
  });

  it("never rejects on a synchronous throw that is not a TestRunnerCliError either", async () => {
    const runTests = vi.fn(() => {
      throw new Error("unexpected synchronous failure");
    }) as unknown as TestRunnerToolDeps["runTests"];
    const deps = makeDeps({ runTests });

    await expect(handleRunTests(deps)).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("NO SE PUDIERON CORRER LOS TESTS") }],
    });
  });

  it("logs the failure with the classified reason and a numeric durationMs", async () => {
    const runTests = vi.fn().mockRejectedValue(new TestRunnerCliError("not-found", { code: "ENOENT" }));
    const logEvent = vi.fn();
    const deps = makeDeps({ runTests, logEvent });

    await handleRunTests(deps);

    const errorCall = logEvent.mock.calls.find((call) => call[0] === "test-runner-error");
    expect(errorCall).toBeDefined();
    const fields = errorCall![1] as { reason: string; durationMs: number };
    expect(fields.reason).toBe("not-found");
    expect(typeof fields.durationMs).toBe("number");
  });
});

describe("handleRunTests — exitCode y duración siempre presentes (verde/rojo)", () => {
  it.each([
    [0, 10],
    [1, 20],
    [2, 30],
  ])("includes exit %i and duration %i ms in the returned text regardless of truncation", async (exitCode, durationMs) => {
    const runTests = vi.fn().mockResolvedValue(makeResult({ exitCode, output: "salida\n", durationMs }));
    const deps = makeDeps({ runTests });

    const result = await handleRunTests(deps);

    expect(result.content[0].text).toContain(`exit ${exitCode}`);
    expect(result.content[0].text).toContain(`${durationMs} ms`);
  });

  it("logs exitCode and durationMs on the green path", async () => {
    const runTests = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, output: "ok\n", durationMs: 99 }));
    const logEvent = vi.fn();
    const deps = makeDeps({ runTests, logEvent });

    await handleRunTests(deps);

    const okCall = logEvent.mock.calls.find((call) => call[0] === "test-runner-verde");
    expect(okCall).toBeDefined();
    expect(okCall![1]).toMatchObject({ exitCode: 0, durationMs: 99 });
  });

  it("logs exitCode and durationMs on the red path", async () => {
    const runTests = vi.fn().mockResolvedValue(makeResult({ exitCode: 3, output: "fail\n", durationMs: 7 }));
    const logEvent = vi.fn();
    const deps = makeDeps({ runTests, logEvent });

    await handleRunTests(deps);

    const redCall = logEvent.mock.calls.find((call) => call[0] === "test-runner-rojo");
    expect(redCall).toBeDefined();
    expect(redCall![1]).toMatchObject({ exitCode: 3, durationMs: 7 });
  });
});
