import { describe, expect, it } from "vitest";
import {
  DEFAULT_A2A_POLL_INTERVAL_MS,
  DEFAULT_A2A_REQUEST_TIMEOUT_MS,
  DEFAULT_A2A_TASK_TIMEOUT_MS,
  claveAVariableEntorno,
  isA2ASalienteEnabled,
  resolveA2AConfig,
} from "./config.js";
import { OPERACIONES_TIMEOUT_MS } from "../web/config.js";
import {
  A2A_POLL_INTERVAL_CHAT_MS,
  A2A_REQUEST_TIMEOUT_CHAT_MS,
  A2A_TASK_TIMEOUT_CHAT_MS,
  type A2AConfig,
  configParaCanalConversacional,
  esperaTotalMaximaMs,
} from "./config.js";

describe("claveAVariableEntorno", () => {
  it.each([
    ["riesgo-credito", "ENDPOINT", "HARNESS_A2A_ENDPOINT_RIESGO_CREDITO"],
    ["riesgo-credito", "TOKEN", "HARNESS_A2A_TOKEN_RIESGO_CREDITO"],
    ["kpi-incidente", "ENDPOINT", "HARNESS_A2A_ENDPOINT_KPI_INCIDENTE"],
    ["kpi-incidente", "TOKEN", "HARNESS_A2A_TOKEN_KPI_INCIDENTE"],
  ] as const)("mapea (%s, %s) a %s", (clave, campo, esperado) => {
    expect(claveAVariableEntorno(clave, campo)).toBe(esperado);
  });
});

describe("resolveA2AConfig", () => {
  it("devuelve defaults y ambos destinos undefined con env vacío", () => {
    expect(resolveA2AConfig({})).toEqual({
      requestTimeoutMs: DEFAULT_A2A_REQUEST_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_A2A_POLL_INTERVAL_MS,
      taskTimeoutMs: DEFAULT_A2A_TASK_TIMEOUT_MS,
      destinos: {
        "riesgo-credito": undefined,
        "kpi-incidente": undefined,
      },
    });
  });

  it("resuelve baseUrl y authToken de ambos destinos con valores válidos", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://riesgo.example.com",
      HARNESS_A2A_TOKEN_RIESGO_CREDITO: "token-riesgo",
      HARNESS_A2A_ENDPOINT_KPI_INCIDENTE: "https://kpi.example.com",
      HARNESS_A2A_TOKEN_KPI_INCIDENTE: "token-kpi",
      HARNESS_A2A_REQUEST_TIMEOUT_MS: "5000",
      HARNESS_A2A_POLL_INTERVAL_MS: "500",
      HARNESS_A2A_TASK_TIMEOUT_MS: "60000",
    });

    expect(config).toEqual({
      requestTimeoutMs: 5000,
      pollIntervalMs: 500,
      taskTimeoutMs: 60000,
      destinos: {
        "riesgo-credito": {
          baseUrl: "https://riesgo.example.com",
          authToken: "token-riesgo",
        },
        "kpi-incidente": {
          baseUrl: "https://kpi.example.com",
          authToken: "token-kpi",
        },
      },
    });
  });

  it("un destino configurado y el otro no ⇒ undefined sólo en el que falta", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://riesgo.example.com",
    });

    expect(config.destinos["riesgo-credito"]).toEqual({
      baseUrl: "https://riesgo.example.com",
      authToken: undefined,
    });
    expect(config.destinos["kpi-incidente"]).toBeUndefined();
  });

  it("un destino sin authToken configurado resuelve authToken undefined", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_KPI_INCIDENTE: "https://kpi.example.com",
    });

    expect(config.destinos["kpi-incidente"]).toEqual({
      baseUrl: "https://kpi.example.com",
      authToken: undefined,
    });
  });

  it("baseUrl con una barra final se normaliza sin ella (code-review, hallazgo 1 — evita doble barra en el GET del Agent Card)", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://riesgo.example.com/",
    });

    expect(config.destinos["riesgo-credito"]?.baseUrl).toBe("https://riesgo.example.com");
  });

  it("baseUrl con varias barras finales se normaliza sin ninguna", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://riesgo.example.com///",
    });

    expect(config.destinos["riesgo-credito"]?.baseUrl).toBe("https://riesgo.example.com");
  });

  it("baseUrl sin barra final queda sin cambios", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://riesgo.example.com",
    });

    expect(config.destinos["riesgo-credito"]?.baseUrl).toBe("https://riesgo.example.com");
  });

  it.each([
    ["igual", "5000", "5000"],
    ["mayor", "60000", "5000"],
  ])(
    "pollIntervalMs %s a taskTimeoutMs ⇒ cae a los defaults de AMBOS campos (code-review, hallazgo — sin esto el timeout efectivo queda gobernado por pollIntervalMs, no por taskTimeoutMs)",
    (_label, pollIntervalMs, taskTimeoutMs) => {
      const config = resolveA2AConfig({
        HARNESS_A2A_POLL_INTERVAL_MS: pollIntervalMs,
        HARNESS_A2A_TASK_TIMEOUT_MS: taskTimeoutMs,
      });

      expect(config.pollIntervalMs).toBe(DEFAULT_A2A_POLL_INTERVAL_MS);
      expect(config.taskTimeoutMs).toBe(DEFAULT_A2A_TASK_TIMEOUT_MS);
    },
  );

  it("pollIntervalMs menor que taskTimeoutMs (combinación válida) se respeta tal cual", () => {
    const config = resolveA2AConfig({
      HARNESS_A2A_POLL_INTERVAL_MS: "1000",
      HARNESS_A2A_TASK_TIMEOUT_MS: "5000",
    });

    expect(config.pollIntervalMs).toBe(1000);
    expect(config.taskTimeoutMs).toBe(5000);
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-1"],
    ["Infinity", "Infinity"],
    ["overflow that parses to Infinity", "1e400"],
    ["blank", "   "],
  ])(
    "siempre cae a los defaults numéricos cuando los tres campos numéricos son %s, y nunca lanza",
    (_label, value) => {
      const env = {
        HARNESS_A2A_REQUEST_TIMEOUT_MS: value,
        HARNESS_A2A_POLL_INTERVAL_MS: value,
        HARNESS_A2A_TASK_TIMEOUT_MS: value,
      };

      expect(() => resolveA2AConfig(env)).not.toThrow();

      const config = resolveA2AConfig(env);

      expect(config.requestTimeoutMs).toBe(DEFAULT_A2A_REQUEST_TIMEOUT_MS);
      expect(config.pollIntervalMs).toBe(DEFAULT_A2A_POLL_INTERVAL_MS);
      expect(config.taskTimeoutMs).toBe(DEFAULT_A2A_TASK_TIMEOUT_MS);
    },
  );

  it("nunca lanza con un env completamente inválido", () => {
    expect(() =>
      resolveA2AConfig({
        HARNESS_A2A_REQUEST_TIMEOUT_MS: "not-a-number",
        HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "",
      }),
    ).not.toThrow();
  });
});

describe("isA2ASalienteEnabled", () => {
  it.each([
    ["on", true],
    ["ON", true],
    [" on ", true],
    ["off", false],
    ["true", false],
    ["1", false],
    [undefined, false],
  ] as const)("con HARNESS_A2A_SALIENTE=%s devuelve %s", (valor, esperado) => {
    const env = valor === undefined ? {} : { HARNESS_A2A_SALIENTE: valor };

    expect(isA2ASalienteEnabled(env)).toBe(esperado);
  });
});

function baseConfig(overrides: Partial<A2AConfig> = {}): A2AConfig {
  return { ...resolveA2AConfig({}), ...overrides };
}

describe("configParaCanalConversacional (consulta-kpi-a2a-chat, ADR 245)", () => {
  it("fija los valores de los tres techos, para que cambiarlos sea una edicion consciente", () => {
    expect(A2A_REQUEST_TIMEOUT_CHAT_MS).toBe(8_000);
    expect(A2A_POLL_INTERVAL_CHAT_MS).toBe(1_500);
    expect(A2A_TASK_TIMEOUT_CHAT_MS).toBe(30_000);
  });

  it("con la base en defaults aplica los tres techos del canal", () => {
    const derivada = configParaCanalConversacional(baseConfig());

    expect(derivada.requestTimeoutMs).toBe(A2A_REQUEST_TIMEOUT_CHAT_MS);
    expect(derivada.pollIntervalMs).toBe(A2A_POLL_INTERVAL_CHAT_MS);
    expect(derivada.taskTimeoutMs).toBe(A2A_TASK_TIMEOUT_CHAT_MS);
  });

  it("nunca afloja: una base ya apretada queda con campos identicos", () => {
    const derivada = configParaCanalConversacional(
      baseConfig({ requestTimeoutMs: 5_000, pollIntervalMs: 500, taskTimeoutMs: 10_000 }),
    );

    expect(derivada.requestTimeoutMs).toBe(5_000);
    expect(derivada.pollIntervalMs).toBe(500);
    expect(derivada.taskTimeoutMs).toBe(10_000);
  });

  it("con una base mixta toma el minimo campo a campo", () => {
    const derivada = configParaCanalConversacional(
      baseConfig({ requestTimeoutMs: 3_000, pollIntervalMs: 1_000, taskTimeoutMs: 90_000 }),
    );

    expect(derivada.requestTimeoutMs).toBe(3_000);
    expect(derivada.pollIntervalMs).toBe(1_000);
    expect(derivada.taskTimeoutMs).toBe(A2A_TASK_TIMEOUT_CHAT_MS);
  });

  it("conserva destinos por la misma referencia y no muta la base", () => {
    const base = baseConfig();
    const copiaAntes = { ...base };

    const derivada = configParaCanalConversacional(base);

    expect(derivada.destinos).toBe(base.destinos);
    expect(base).toEqual(copiaAntes);
  });

  it("test 2: la espera total del canal cabe en la mitad del plazo HTTP, con defaults y con la base a mano de 2b", () => {
    const baseDefaults = baseConfig();
    const baseAMano = baseConfig({ pollIntervalMs: 2_000, taskTimeoutMs: 1_500 });

    for (const base of [baseDefaults, baseAMano]) {
      expect(esperaTotalMaximaMs(configParaCanalConversacional(base))).toBeLessThanOrEqual(
        OPERACIONES_TIMEOUT_MS / 2,
      );
    }
  });

  it("test 2: esperaTotalMaximaMs es la formula 3*request + task + poll, no un numero fijo", () => {
    const arbitraria = baseConfig({ requestTimeoutMs: 1_000, pollIntervalMs: 100, taskTimeoutMs: 5_000 });

    expect(esperaTotalMaximaMs(arbitraria)).toBe(8_100);

    const derivada = configParaCanalConversacional(baseConfig());
    expect(esperaTotalMaximaMs(derivada)).toBe(
      3 * derivada.requestTimeoutMs + derivada.taskTimeoutMs + derivada.pollIntervalMs,
    );
  });

  it("test 2b: una config a mano con poll >= task dispara la guarda y cae a los techos del CANAL, no a los defaults", () => {
    const invalida = baseConfig({ pollIntervalMs: 2_000, taskTimeoutMs: 1_500 });

    const derivada = configParaCanalConversacional(invalida);

    expect(derivada.requestTimeoutMs).toBe(A2A_REQUEST_TIMEOUT_CHAT_MS);
    expect(derivada.pollIntervalMs).toBe(A2A_POLL_INTERVAL_CHAT_MS);
    expect(derivada.taskTimeoutMs).toBe(A2A_TASK_TIMEOUT_CHAT_MS);
    expect(derivada.taskTimeoutMs).not.toBe(DEFAULT_A2A_TASK_TIMEOUT_MS);
  });
});
