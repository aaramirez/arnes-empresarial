import { describe, expect, it } from "vitest";
import {
  A2A_CLOSE_TIMEOUT_MS,
  A2A_ERROR_TASK_NOT_CANCELABLE,
  A2A_ERROR_TASK_NOT_FOUND,
  A2A_SERVER_LOG_CORRELATION_ID,
  DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES,
  DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO,
  DEFAULT_A2A_ENTRANTE_PORT,
  DEFAULT_A2A_ENTRANTE_PUBLIC_URL,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  METODO_CANCEL_TASK,
  METODO_GET_TASK,
  METODO_SEND_MESSAGE,
  RUTA_AGENT_CARD,
  RUTA_JSONRPC,
  isA2AServerEnabled,
  resolveA2AServerConfig,
} from "./server-config.js";

describe("resolveA2AServerConfig", () => {
  it("devuelve los cinco defaults con env vacío", () => {
    expect(resolveA2AServerConfig({})).toEqual({
      token: "",
      port: DEFAULT_A2A_ENTRANTE_PORT,
      publicUrl: DEFAULT_A2A_ENTRANTE_PUBLIC_URL,
      maxBodyBytes: DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES,
      maxEnVuelo: DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO,
    });
  });

  it("resuelve los cinco campos desde las env vars correspondientes", () => {
    const config = resolveA2AServerConfig({
      HARNESS_A2A_ENTRANTE_TOKEN: "secreto",
      HARNESS_A2A_ENTRANTE_PORT: "9999",
      HARNESS_A2A_ENTRANTE_PUBLIC_URL: "https://a2a.example.com",
      HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES: "1024",
      HARNESS_A2A_ENTRANTE_MAX_EN_VUELO: "2",
    });

    expect(config).toEqual({
      token: "secreto",
      port: 9999,
      publicUrl: "https://a2a.example.com",
      maxBodyBytes: 1024,
      maxEnVuelo: 2,
    });
  });

  it("publicUrl con una barra final se normaliza sin ella", () => {
    const config = resolveA2AServerConfig({
      HARNESS_A2A_ENTRANTE_PUBLIC_URL: "https://a2a.example.com/",
    });

    expect(config.publicUrl).toBe("https://a2a.example.com");
  });

  it("publicUrl con varias barras finales se normaliza sin ninguna", () => {
    const config = resolveA2AServerConfig({
      HARNESS_A2A_ENTRANTE_PUBLIC_URL: "https://a2a.example.com///",
    });

    expect(config.publicUrl).toBe("https://a2a.example.com");
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
    "port/maxBodyBytes/maxEnVuelo siempre caen a sus defaults cuando el valor es %s, y nunca lanza",
    (_label, value) => {
      const env = {
        HARNESS_A2A_ENTRANTE_PORT: value,
        HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES: value,
        HARNESS_A2A_ENTRANTE_MAX_EN_VUELO: value,
      };

      expect(() => resolveA2AServerConfig(env)).not.toThrow();

      const config = resolveA2AServerConfig(env);

      expect(config.port).toBe(DEFAULT_A2A_ENTRANTE_PORT);
      expect(config.maxBodyBytes).toBe(DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES);
      expect(config.maxEnVuelo).toBe(DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO);
    },
  );

  it("nunca lanza con un env completamente inválido", () => {
    expect(() =>
      resolveA2AServerConfig({
        HARNESS_A2A_ENTRANTE_PORT: "not-a-number",
        HARNESS_A2A_ENTRANTE_TOKEN: undefined,
      }),
    ).not.toThrow();
  });
});

describe("isA2AServerEnabled", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["secreto", true],
    [" secreto ", true],
  ] as const)("con token=%j devuelve %s", (token, esperado) => {
    const config = resolveA2AServerConfig({ HARNESS_A2A_ENTRANTE_TOKEN: token });

    expect(isA2AServerEnabled(config)).toBe(esperado);
  });
});

describe("rutas y métodos JSON-RPC", () => {
  it("RUTA_AGENT_CARD y RUTA_JSONRPC son los literales definidos", () => {
    expect(RUTA_AGENT_CARD).toBe("/.well-known/agent-card.json");
    expect(RUTA_JSONRPC).toBe("/a2a");
  });

  it("los tres métodos JSON-RPC son los literales definidos", () => {
    expect(METODO_SEND_MESSAGE).toBe("SendMessage");
    expect(METODO_GET_TASK).toBe("GetTask");
    expect(METODO_CANCEL_TASK).toBe("CancelTask");
  });
});

describe("códigos de error JSON-RPC", () => {
  it("los cinco códigos base son exactamente los de JSON-RPC 2.0", () => {
    expect(JSONRPC_PARSE_ERROR).toBe(-32700);
    expect(JSONRPC_INVALID_REQUEST).toBe(-32600);
    expect(JSONRPC_METHOD_NOT_FOUND).toBe(-32601);
    expect(JSONRPC_INVALID_PARAMS).toBe(-32602);
    expect(JSONRPC_INTERNAL_ERROR).toBe(-32603);
  });

  it("las dos constantes A2A-específicas están definidas y son números distintos entre sí y de los cinco base", () => {
    const codigosBase = [
      JSONRPC_PARSE_ERROR,
      JSONRPC_INVALID_REQUEST,
      JSONRPC_METHOD_NOT_FOUND,
      JSONRPC_INVALID_PARAMS,
      JSONRPC_INTERNAL_ERROR,
    ];

    expect(typeof A2A_ERROR_TASK_NOT_FOUND).toBe("number");
    expect(typeof A2A_ERROR_TASK_NOT_CANCELABLE).toBe("number");
    expect(A2A_ERROR_TASK_NOT_FOUND).not.toBe(A2A_ERROR_TASK_NOT_CANCELABLE);
    expect(codigosBase).not.toContain(A2A_ERROR_TASK_NOT_FOUND);
    expect(codigosBase).not.toContain(A2A_ERROR_TASK_NOT_CANCELABLE);
  });

  it("las dos constantes A2A-específicas son los valores literales de docs/specification.md v1.0.0 (TaskNotFoundError/TaskNotCancelableError, RD-37)", () => {
    expect(A2A_ERROR_TASK_NOT_FOUND).toBe(-32001);
    expect(A2A_ERROR_TASK_NOT_CANCELABLE).toBe(-32002);
  });
});

describe("otras constantes", () => {
  it("A2A_CLOSE_TIMEOUT_MS es 5_000", () => {
    expect(A2A_CLOSE_TIMEOUT_MS).toBe(5_000);
  });

  it("A2A_SERVER_LOG_CORRELATION_ID está definida como string no vacío", () => {
    expect(typeof A2A_SERVER_LOG_CORRELATION_ID).toBe("string");
    expect(A2A_SERVER_LOG_CORRELATION_ID.trim()).not.toBe("");
  });
});
