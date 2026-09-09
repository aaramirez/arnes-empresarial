import { describe, expect, it } from "vitest";
import {
  DEFAULT_A2A_POLL_INTERVAL_MS,
  DEFAULT_A2A_REQUEST_TIMEOUT_MS,
  DEFAULT_A2A_TASK_TIMEOUT_MS,
  claveAVariableEntorno,
  isA2ASalienteEnabled,
  resolveA2AConfig,
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
