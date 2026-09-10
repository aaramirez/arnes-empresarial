import { timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { construirAgentCard } from "./agent-card.js";
import {
  A2A_CLOSE_TIMEOUT_MS,
  A2A_ERROR_TASK_NOT_CANCELABLE,
  A2A_ERROR_TASK_NOT_FOUND,
  A2A_SERVER_LOG_CORRELATION_ID,
  A2A_TURNO_EN_VUELO_MAX_MS,
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
  type A2AServerConfig,
} from "./server-config.js";
import {
  construirTask,
  createRequestListener,
  esAutorizado,
  leerCuerpoConTope,
  pathFromUrl,
  startServer,
  type A2ARequest,
  type A2AResponse,
  type A2AServerDeps,
  type A2AServerHandle,
  type CancelacionA2AResultado,
  type CreateA2AServerFn,
  type SolicitudA2AAceptada,
  type SolicitudA2AEntrada,
  type SolicitudA2AEntranteVista,
} from "./server.js";

/**
 * `node:crypto` es un módulo ESM cuyo namespace no es reconfigurable — un
 * `vi.spyOn` directo sobre el import falla con "Module namespace is not
 * configurable in ESM" (verificado en esta sesión). Se mockea parcialmente,
 * conservando el comportamiento real de `timingSafeEqual` (envuelto en
 * `vi.fn`) para poder afirmar CERO invocaciones sin perder la semántica real
 * del resto de los tests (prefijo `Bearer`, largo de buffers, etc.).
 */
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const TOKEN = "token-de-prueba";

/** Doble plano de `http.IncomingMessage` que satisface `A2ARequest` estructuralmente. */
class FakeA2ARequest implements A2ARequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  socket?: { readonly remoteAddress?: string | undefined } | undefined;
  destroy = vi.fn();

  private listeners: {
    data: Array<(chunk: Buffer) => void>;
    end: Array<() => void>;
    error: Array<(error: Error) => void>;
  } = { data: [], end: [], error: [] };

  constructor(init: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    socket?: { readonly remoteAddress?: string | undefined };
  } = {}) {
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers ?? {};
    this.socket = init.socket;
  }

  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "data" | "end" | "error", listener: (...args: never[]) => unknown): unknown {
    if (event === "data") {
      this.listeners.data.push(listener as (chunk: Buffer) => void);
    } else if (event === "end") {
      this.listeners.end.push(listener as () => void);
    } else {
      this.listeners.error.push(listener as (error: Error) => void);
    }
    return this;
  }

  /** Simula la llegada de chunks y el cierre normal del body. */
  emitBody(chunks: Buffer[]): void {
    for (const chunk of chunks) {
      for (const listener of this.listeners.data) {
        listener(chunk);
      }
    }
    for (const listener of this.listeners.end) {
      listener();
    }
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.error) {
      listener(error);
    }
  }
}

/** Doble plano de `http.ServerResponse` que satisface `A2AResponse` estructuralmente. */
class FakeA2AResponse implements A2AResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  end = vi.fn();

  setHeader(name: string, value: string): unknown {
    this.headers.set(name, value);
    return this;
  }
}

function authHeader(token = TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Molde de `esperarRespuesta` de `web/server.test.ts:103-105`: espera a que la ruta `async` termine. */
async function esperarRespuesta(res: FakeA2AResponse): Promise<void> {
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
}

function jsonBody(valor: unknown): Buffer {
  return Buffer.from(JSON.stringify(valor), "utf8");
}

/** Molde de `makeDeps` de `webhooks/server.test.ts`, adaptado a `A2AServerDeps`. */
function makeConfig(overrides: Partial<A2AServerConfig> = {}): A2AServerConfig {
  return {
    token: TOKEN,
    port: 8888,
    publicUrl: "http://localhost:8888",
    maxBodyBytes: 65_536,
    maxEnVuelo: 4,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<A2AServerDeps> = {}): A2AServerDeps {
  return {
    config: makeConfig(),
    logEvent: vi.fn(),
    onSolicitudA2A: vi.fn(),
    onConsultarTarea: vi.fn(),
    onCancelarTarea: vi.fn(),
    ...overrides,
  };
}

describe("pathFromUrl", () => {
  it("returns the url as-is when there is no querystring", () => {
    expect(pathFromUrl("/a2a")).toBe("/a2a");
  });

  it("strips everything from the first '?' onward", () => {
    expect(pathFromUrl("/a2a?foo=bar&baz=qux")).toBe("/a2a");
  });

  it("returns an empty string when url is undefined", () => {
    expect(pathFromUrl(undefined)).toBe("");
  });
});

describe("esAutorizado", () => {
  it("returns false without invoking timingSafeEqual when token is ''", () => {
    vi.mocked(timingSafeEqual).mockClear();
    const req = new FakeA2ARequest({ headers: authHeader("cualquier-cosa") });

    const resultado = esAutorizado(req, "");

    expect(resultado).toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it("returns false (not a thrown RangeError) when the header has a different length than the expected token", () => {
    const req = new FakeA2ARequest({ headers: authHeader("corto") });

    let resultado: boolean | undefined;
    expect(() => {
      resultado = esAutorizado(req, TOKEN);
    }).not.toThrow();

    expect(resultado).toBe(false);
  });

  it("returns false when the Authorization header is missing", () => {
    const req = new FakeA2ARequest({ headers: {} });

    expect(esAutorizado(req, TOKEN)).toBe(false);
  });

  it("uses the first value when the Authorization header arrives as an array", () => {
    const req = new FakeA2ARequest({
      headers: { authorization: [`Bearer ${TOKEN}`, "Bearer otro-token"] },
    });

    expect(esAutorizado(req, TOKEN)).toBe(true);
  });

  it("requires the exact 'Bearer ' prefix — missing prefix returns false", () => {
    const req = new FakeA2ARequest({ headers: { authorization: TOKEN } });

    expect(esAutorizado(req, TOKEN)).toBe(false);
  });

  it("requires the exact 'Bearer ' prefix — a different prefix returns false", () => {
    const req = new FakeA2ARequest({ headers: { authorization: `Basic ${TOKEN}` } });

    expect(esAutorizado(req, TOKEN)).toBe(false);
  });

  it("returns true with the correct 'Bearer <token>' header", () => {
    const req = new FakeA2ARequest({ headers: authHeader(TOKEN) });

    expect(esAutorizado(req, TOKEN)).toBe(true);
  });
});

describe("leerCuerpoConTope", () => {
  // Nota: `createRequestListener` (ruteo completo por método+ruta) llega en
  // la tarea 9 — acá se testea la función de tope de body en aislamiento,
  // sin depender del ruteo todavía inexistente.
  it("responds 413 with end() called BEFORE destroy(), and never calls any business callback, when the body exceeds maxBodyBytes", async () => {
    const onSolicitudA2A = vi.fn();
    const maxBodyBytes = 16;

    const req = new FakeA2ARequest({ method: "POST", url: "/a2a", headers: authHeader() });
    const res = new FakeA2AResponse();

    const order: string[] = [];
    res.end.mockImplementation(() => {
      order.push("end");
    });
    req.destroy.mockImplementation(() => {
      order.push("destroy");
    });

    const promesa = leerCuerpoConTope(req, res, maxBodyBytes);
    const bigChunk = Buffer.alloc(maxBodyBytes + 1, "a");
    req.emitBody([bigChunk]);
    const resultado = await promesa;

    expect(res.statusCode).toBe(413);
    expect(order).toEqual(["end", "destroy"]);
    expect(resultado.ok).toBe(false);
    expect(onSolicitudA2A).toHaveBeenCalledTimes(0);
  });

  it("resolves ok with the accumulated body when it stays within maxBodyBytes", async () => {
    const maxBodyBytes = 1024;

    const req = new FakeA2ARequest({ method: "POST", url: "/a2a", headers: authHeader() });
    const res = new FakeA2AResponse();

    const promesa = leerCuerpoConTope(req, res, maxBodyBytes);
    req.emitBody([Buffer.from("hola", "utf8")]);
    const resultado = await promesa;

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.body.toString("utf8")).toBe("hola");
    }
    expect(res.end).not.toHaveBeenCalled();
    expect(req.destroy).not.toHaveBeenCalled();
  });

  it("resolves ok:false with motivo 'error-transporte' on a transport error, without touching res", async () => {
    const maxBodyBytes = 1024;

    const req = new FakeA2ARequest({ method: "POST", url: "/a2a", headers: authHeader() });
    const res = new FakeA2AResponse();

    const promesa = leerCuerpoConTope(req, res, maxBodyBytes);
    req.emitError(new Error("ECONNRESET"));
    const resultado = await promesa;

    expect(resultado).toEqual({ ok: false, motivo: "error-transporte" });
    expect(res.end).not.toHaveBeenCalled();
    expect(req.destroy).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — ruteo por método+ruta y Agent Card (Hito 7, tarea 9, design.md §6.3)", () => {
  it("responds 200 with the full Agent Card on GET RUTA_AGENT_CARD without an Authorization header — confirms it is NOT 401", () => {
    const config = makeConfig();
    const deps = makeDeps({ config });
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "GET", url: RUTA_AGENT_CARD, headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.statusCode).not.toBe(401);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(construirAgentCard(config)));
  });

  it("responds 404 with an empty body for an unrecognized route (GET /no-existe)", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "GET", url: "/no-existe", headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it("responds 404 with an empty body for a recognized route with an unrecognized method (DELETE on RUTA_AGENT_CARD)", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "DELETE", url: RUTA_AGENT_CARD, headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it("logs a2a-card-servido with origenTransporte taken from req.socket.remoteAddress when the card is served", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({
      method: "GET",
      url: RUTA_AGENT_CARD,
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(logEvent).toHaveBeenCalledWith(A2A_SERVER_LOG_CORRELATION_ID, "a2a-card-servido", {
      origenTransporte: "127.0.0.1",
    });
  });

  it("logs a2a-card-servido with origenTransporte 'desconocido' when the request has no socket.remoteAddress", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "GET", url: RUTA_AGENT_CARD, headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(logEvent).toHaveBeenCalledWith(A2A_SERVER_LOG_CORRELATION_ID, "a2a-card-servido", {
      origenTransporte: "desconocido",
    });
  });

  it("does not log a2a-card-servido for an unrecognized method+route (404)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "GET", url: "/no-existe", headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);

    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST RUTA_JSONRPC, sobre JSON-RPC y errores base (Hito 7, tarea 10, design.md §6.3)", () => {
  function postJsonRpc(
    deps: A2AServerDeps,
    body: Buffer,
  ): { req: FakeA2ARequest; res: FakeA2AResponse } {
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
    const res = new FakeA2AResponse();

    listener(req, res);
    req.emitBody([body]);

    return { req, res };
  }

  function parsedBody(res: FakeA2AResponse): { jsonrpc: string; id: unknown; error: { code: number; message: string } } {
    const call = res.end.mock.calls[0]?.[0] as string | undefined;
    expect(call).toBeDefined();
    return JSON.parse(call as string) as {
      jsonrpc: string;
      id: unknown;
      error: { code: number; message: string };
    };
  }

  it("responds -32700 with id: null when JSON.parse fails on the body", async () => {
    const deps = makeDeps();

    const { res } = postJsonRpc(deps, Buffer.from("no-es-json{{{", "utf8"));
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    const sobre = parsedBody(res);
    expect(sobre.id).toBeNull();
    expect(sobre.error.code).toBe(JSONRPC_PARSE_ERROR);
  });

  it.each([
    ["a non-object string", jsonBody("un string")],
    ["a bare number", jsonBody(42)],
    ["null", jsonBody(null)],
    ["an array", jsonBody([])],
  ])("responds -32600 with id: null when the parsed body is %s", async (_label, body) => {
    const deps = makeDeps();

    const { res } = postJsonRpc(deps, body);
    await esperarRespuesta(res);

    const sobre = parsedBody(res);
    expect(sobre.id).toBeNull();
    expect(sobre.error.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  it("responds -32600 with id: null when jsonrpc is '1.0' instead of '2.0'", async () => {
    const deps = makeDeps();

    const { res } = postJsonRpc(
      deps,
      jsonBody({ jsonrpc: "1.0", method: METODO_GET_TASK, id: 1, params: {} }),
    );
    await esperarRespuesta(res);

    const sobre = parsedBody(res);
    expect(sobre.id).toBeNull();
    expect(sobre.error.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  it("responds -32600 with id: null when jsonrpc is absent", async () => {
    const deps = makeDeps();

    const { res } = postJsonRpc(deps, jsonBody({ method: METODO_GET_TASK, id: 1, params: {} }));
    await esperarRespuesta(res);

    const sobre = parsedBody(res);
    expect(sobre.id).toBeNull();
    expect(sobre.error.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  it("responds -32600 with id: null when method is not a string", async () => {
    const deps = makeDeps();

    const { res } = postJsonRpc(deps, jsonBody({ jsonrpc: "2.0", method: 123, id: 1 }));
    await esperarRespuesta(res);

    const sobre = parsedBody(res);
    expect(sobre.id).toBeNull();
    expect(sobre.error.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  it.each([["ListTasks"], ["SendStreamingMessage"]])(
    "responds -32601 with the original request id and HTTP 200 (not 500) for the unsupported method '%s'",
    async (method) => {
      const deps = makeDeps();

      const { res } = postJsonRpc(deps, jsonBody({ jsonrpc: "2.0", method, id: "req-7", params: {} }));
      await esperarRespuesta(res);

      expect(res.statusCode).toBe(200);
      const sobre = parsedBody(res);
      expect(sobre.id).toBe("req-7");
      expect(sobre.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
    },
  );

  it("logs a2a-metodo-no-soportado with the unsupported method name", async () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });

    const { res } = postJsonRpc(deps, jsonBody({ jsonrpc: "2.0", method: "ListTasks", id: 1 }));
    await esperarRespuesta(res);

    expect(logEvent).toHaveBeenCalledWith(A2A_SERVER_LOG_CORRELATION_ID, "a2a-metodo-no-soportado", {
      method: "ListTasks",
    });
  });

  it("does not fail parsing when the envelope carries an unknown extra field", async () => {
    const deps = makeDeps();

    const { res } = postJsonRpc(
      deps,
      jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: 1, params: {}, campoRaro: true }),
    );
    await esperarRespuesta(res);

    const sobre = parsedBody(res);
    expect(sobre.error.code).not.toBe(JSONRPC_INVALID_REQUEST);
    expect(sobre.error.code).not.toBe(JSONRPC_PARSE_ERROR);
  });

  it("responds 401 without parsing the body when Authorization is missing (order: AUTH before parse)", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: {} });
    const res = new FakeA2AResponse();

    listener(req, res);
    req.emitBody([jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: 1, params: {} })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(deps.logEvent).toHaveBeenCalledWith(
      A2A_SERVER_LOG_CORRELATION_ID,
      "a2a-solicitud-no-autorizada",
      expect.anything(),
    );
  });

  it("responds 413 with end() called before destroy(), without parsing the body, when it exceeds maxBodyBytes", async () => {
    const config = makeConfig({ maxBodyBytes: 16 });
    const deps = makeDeps({ config });
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
    const res = new FakeA2AResponse();

    listener(req, res);
    req.emitBody([Buffer.alloc(config.maxBodyBytes + 1, "a")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(
      A2A_SERVER_LOG_CORRELATION_ID,
      "a2a-solicitud-rechazada-tamano",
      { origenTransporte: "desconocido", maxBodyBytes: config.maxBodyBytes },
    );
  });

  it("responds 400 with an empty body on a transport error while reading the body", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
    const res = new FakeA2AResponse();

    listener(req, res);
    req.emitError(new Error("ECONNRESET"));
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(res.end).toHaveBeenCalledWith();
  });
});

describe("createRequestListener — despacho real de SendMessage, GetTask y CancelTask (Hito 7, tarea 12, design.md ADR 94, ADR 100)", () => {
  function postJsonRpc(
    deps: A2AServerDeps,
    body: Buffer,
  ): { req: FakeA2ARequest; res: FakeA2AResponse } {
    const listener = createRequestListener(deps);
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
    const res = new FakeA2AResponse();

    listener(req, res);
    req.emitBody([body]);

    return { req, res };
  }

  function parsedResult(
    res: FakeA2AResponse,
  ): { jsonrpc: string; id: unknown; result: { id: string; contextId: string; status: { state: string } } } {
    const call = res.end.mock.calls[0]?.[0] as string | undefined;
    expect(call).toBeDefined();
    return JSON.parse(call as string) as {
      jsonrpc: string;
      id: unknown;
      result: { id: string; contextId: string; status: { state: string } };
    };
  }

  function parsedError(res: FakeA2AResponse): { jsonrpc: string; id: unknown; error: { code: number; message: string } } {
    const call = res.end.mock.calls[0]?.[0] as string | undefined;
    expect(call).toBeDefined();
    return JSON.parse(call as string) as {
      jsonrpc: string;
      id: unknown;
      error: { code: number; message: string };
    };
  }

  const SUBMITTED_ACEPTADA: SolicitudA2AAceptada = {
    estado: "TASK_STATE_SUBMITTED",
    contextId: "caso-1",
    updatedAt: "2026-09-09T00:00:00.000Z",
    turno: Promise.resolve(),
  };

  describe("SendMessage", () => {
    it("responds 200 with a Task in TASK_STATE_SUBMITTED and a non-empty id when onSolicitudA2A accepts", async () => {
      const onSolicitudA2A = vi.fn().mockResolvedValue(SUBMITTED_ACEPTADA);
      const deps = makeDeps({ onSolicitudA2A });

      const { res } = postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_SEND_MESSAGE,
          id: "req-1",
          params: { message: { parts: [{ text: "hola arnes" }] } },
        }),
      );
      await esperarRespuesta(res);

      expect(res.statusCode).toBe(200);
      // `SendMessage` responde `result: { task: Task }` — el `oneof` REAL del
      // protocolo (`respondJsonRpcSendMessageResult`), a diferencia de
      // `GetTask`/`CancelTask` (`parsedResult` de este mismo describe, que sí
      // trae el `Task` directo en `result` — ver el doc-comment de
      // `JsonRpcSendMessageResultEnvelope` en `server.ts`).
      const sobre = JSON.parse(res.end.mock.calls[0]?.[0] as string) as {
        readonly result: { readonly task: { readonly id: string; readonly status: { readonly state: string } } };
      };
      expect(sobre.result.task.status.state).toBe("TASK_STATE_SUBMITTED");
      expect(sobre.result.task.id).not.toBe("");

      expect(onSolicitudA2A).toHaveBeenCalledTimes(1);
      const [input] = onSolicitudA2A.mock.calls[0] as [
        { texto: string; origenTransporte: string; a2aTaskId: string; hayCupo: boolean },
      ];
      expect(input.texto).toBe("hola arnes");
      expect(input.a2aTaskId).not.toBe("");
    });

    it("concatenates multiple parts[*].text before invoking onSolicitudA2A", async () => {
      const onSolicitudA2A = vi.fn().mockResolvedValue(SUBMITTED_ACEPTADA);
      const deps = makeDeps({ onSolicitudA2A });

      postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_SEND_MESSAGE,
          id: "req-2",
          params: { message: { parts: [{ text: "hola " }, { text: "mundo" }] } },
        }),
      );
      await vi.waitFor(() => expect(onSolicitudA2A).toHaveBeenCalled());

      const [input] = onSolicitudA2A.mock.calls[0] as [{ texto: string }];
      expect(input.texto).toBe("hola mundo");
    });

    it("responds -32602 without invoking onSolicitudA2A when message.parts[*].text is missing", async () => {
      const onSolicitudA2A = vi.fn();
      const deps = makeDeps({ onSolicitudA2A });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_SEND_MESSAGE, id: "req-3", params: {} }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INVALID_PARAMS);
      expect(onSolicitudA2A).toHaveBeenCalledTimes(0);
    });

    it("responds -32602 without invoking onSolicitudA2A when parts[*].text is present but empty", async () => {
      const onSolicitudA2A = vi.fn();
      const deps = makeDeps({ onSolicitudA2A });

      const { res } = postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_SEND_MESSAGE,
          id: "req-4",
          params: { message: { parts: [{ text: "" }] } },
        }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INVALID_PARAMS);
      expect(onSolicitudA2A).toHaveBeenCalledTimes(0);
    });

    it("responds -32603 without a stack trace in the body when onSolicitudA2A rejects", async () => {
      const onSolicitudA2A = vi.fn().mockRejectedValue(new Error("boom en el composition root"));
      const logEvent = vi.fn();
      const deps = makeDeps({ onSolicitudA2A, logEvent });

      const { res } = postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_SEND_MESSAGE,
          id: "req-5",
          params: { message: { parts: [{ text: "hola" }] } },
        }),
      );
      await esperarRespuesta(res);

      expect(res.statusCode).toBe(200);
      const cuerpo = res.end.mock.calls[0]?.[0] as string;
      expect(cuerpo).not.toContain("boom en el composition root");
      expect(cuerpo).not.toMatch(/at .*:\d+:\d+/);
      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INTERNAL_ERROR);
      expect(logEvent).toHaveBeenCalledWith(
        A2A_SERVER_LOG_CORRELATION_ID,
        "a2a-handler-fallido",
        expect.anything(),
      );
    });
  });

  describe("GetTask", () => {
    const VISTA_WORKING: SolicitudA2AEntranteVista = {
      a2aTaskId: "task-1",
      contextId: "caso-1",
      estado: "TASK_STATE_WORKING",
      updatedAt: "2026-09-09T00:00:00.000Z",
    };

    it("responds 200 with the Task built from the row when the id exists", async () => {
      const onConsultarTarea = vi.fn().mockReturnValue(VISTA_WORKING);
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-6", params: { id: "task-1" } }),
      );
      await esperarRespuesta(res);

      expect(onConsultarTarea).toHaveBeenCalledWith("task-1");
      const sobre = parsedResult(res);
      expect(sobre.result).toEqual(construirTask(VISTA_WORKING));
    });

    it("responds A2A_ERROR_TASK_NOT_FOUND when the id does not exist", async () => {
      const onConsultarTarea = vi.fn().mockReturnValue(undefined);
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-7", params: { id: "no-existe" } }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(A2A_ERROR_TASK_NOT_FOUND);
    });

    it("responds -32602 without invoking onConsultarTarea when params.id is missing", async () => {
      const onConsultarTarea = vi.fn();
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-8", params: {} }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INVALID_PARAMS);
      expect(onConsultarTarea).toHaveBeenCalledTimes(0);
    });

    it("responds -32602 without invoking onConsultarTarea when params.id is a blank string", async () => {
      const onConsultarTarea = vi.fn();
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-9", params: { id: "  " } }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INVALID_PARAMS);
      expect(onConsultarTarea).toHaveBeenCalledTimes(0);
    });

    it("responds -32603 without a stack trace in the body when onConsultarTarea throws", async () => {
      const onConsultarTarea = vi.fn(() => {
        throw new Error("boom sincrono");
      });
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-10", params: { id: "task-1" } }),
      );
      await esperarRespuesta(res);

      const cuerpo = res.end.mock.calls[0]?.[0] as string;
      expect(cuerpo).not.toContain("boom sincrono");
      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INTERNAL_ERROR);
    });

    it("passes params.id trimmed to onConsultarTarea when it has incidental surrounding whitespace (Hallazgo 3 Reviewer, Hito 7)", async () => {
      const onConsultarTarea = vi.fn().mockReturnValue(VISTA_WORKING);
      const deps = makeDeps({ onConsultarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_GET_TASK,
          id: "req-12",
          params: { id: " task-1 " },
        }),
      );
      await esperarRespuesta(res);

      expect(onConsultarTarea).toHaveBeenCalledWith("task-1");
    });

    it("never awaits: a single microtask flush after the body settles is enough to reach res.end — onConsultarTarea is synchronous (ADR 100, mechanical check, no vi.waitFor polling)", async () => {
      const onConsultarTarea = vi.fn().mockReturnValue(VISTA_WORKING);
      const deps = makeDeps({ onConsultarTarea });
      const listener = createRequestListener(deps);
      const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
      const res = new FakeA2AResponse();

      listener(req, res);
      req.emitBody([
        jsonBody({ jsonrpc: "2.0", method: METODO_GET_TASK, id: "req-11", params: { id: "task-1" } }),
      ]);

      // Todavía no corrió ningún microtask: la promesa de `leerCuerpoConTope`
      // recién resolvió sincrónicamente dentro de `emitBody`, pero su
      // continuación `await` está en cola, sin ejecutar.
      expect(res.end).not.toHaveBeenCalled();

      // UN solo microtask tick alcanza para llegar a `res.end()`: auth,
      // parseo del sobre y el despacho de `GetTask` son sincrónicos de punta
      // a punta (ADR 100) — si `onConsultarTarea` se awaiteara, haría falta
      // un segundo tick.
      await Promise.resolve();

      expect(onConsultarTarea).toHaveBeenCalledTimes(1);
      expect(res.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("CancelTask", () => {
    const VISTA_CANCELED: SolicitudA2AEntranteVista = {
      a2aTaskId: "task-2",
      contextId: "caso-2",
      estado: "TASK_STATE_CANCELED",
      updatedAt: "2026-09-09T00:00:00.000Z",
    };

    it.each<[string, CancelacionA2AResultado]>([
      ["cancelada", { resultado: "cancelada", vista: VISTA_CANCELED }],
      ["ya-cancelada", { resultado: "ya-cancelada", vista: VISTA_CANCELED }],
    ])("responds 200 with the Task from the vista for resultado '%s'", async (_label, resultado) => {
      const onCancelarTarea = vi.fn().mockReturnValue(resultado);
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_CANCEL_TASK, id: "req-12", params: { id: "task-2" } }),
      );
      await esperarRespuesta(res);

      const sobre = parsedResult(res);
      expect(sobre.result).toEqual(construirTask(VISTA_CANCELED));
    });

    it("responds A2A_ERROR_TASK_NOT_CANCELABLE and does not touch the row for resultado 'no-cancelable'", async () => {
      const resultado = {
        resultado: "no-cancelable",
        vista: VISTA_CANCELED,
      } satisfies CancelacionA2AResultado;
      const onCancelarTarea = vi.fn().mockReturnValue(resultado);
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_CANCEL_TASK, id: "req-13", params: { id: "task-2" } }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(A2A_ERROR_TASK_NOT_CANCELABLE);
      // El único punto de contacto es `onCancelarTarea`: se invoca una sola
      // vez, y no hay ningún otro método de escritura del repositorio
      // (el doble) llamado en esta rama.
      expect(onCancelarTarea).toHaveBeenCalledTimes(1);
    });

    it("responds A2A_ERROR_TASK_NOT_FOUND for resultado 'no-encontrada'", async () => {
      const resultado = { resultado: "no-encontrada" } satisfies CancelacionA2AResultado;
      const onCancelarTarea = vi.fn().mockReturnValue(resultado);
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_CANCEL_TASK, id: "req-14", params: { id: "no-existe" } }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(A2A_ERROR_TASK_NOT_FOUND);
      expect(onCancelarTarea).toHaveBeenCalledTimes(1);
    });

    it("responds -32602 without invoking onCancelarTarea when params.id is missing", async () => {
      const onCancelarTarea = vi.fn();
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_CANCEL_TASK, id: "req-15", params: {} }),
      );
      await esperarRespuesta(res);

      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INVALID_PARAMS);
      expect(onCancelarTarea).toHaveBeenCalledTimes(0);
    });

    it("passes params.id trimmed to onCancelarTarea when it has incidental surrounding whitespace (Hallazgo 3 Reviewer, Hito 7)", async () => {
      const onCancelarTarea = vi.fn().mockReturnValue({ resultado: "no-encontrada" });
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({
          jsonrpc: "2.0",
          method: METODO_CANCEL_TASK,
          id: "req-17",
          params: { id: " task-2 " },
        }),
      );
      await esperarRespuesta(res);

      expect(onCancelarTarea).toHaveBeenCalledWith("task-2");
    });

    it("responds -32603 without a stack trace in the body when onCancelarTarea throws", async () => {
      const onCancelarTarea = vi.fn(() => {
        throw new Error("boom sincrono cancel");
      });
      const deps = makeDeps({ onCancelarTarea });

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method: METODO_CANCEL_TASK, id: "req-16", params: { id: "task-2" } }),
      );
      await esperarRespuesta(res);

      const cuerpo = res.end.mock.calls[0]?.[0] as string;
      expect(cuerpo).not.toContain("boom sincrono cancel");
      const sobre = parsedError(res);
      expect(sobre.error.code).toBe(JSONRPC_INTERNAL_ERROR);
    });
  });
});

describe("startServer — tope de turnos en vuelo, drenaje y puerto efectivo (Hito 7, tarea 13, design.md ADR 99, ADR 101)", () => {
  const NOW = "2026-09-09T00:00:00.000Z";

  interface TurnoControlable {
    readonly promise: Promise<void>;
    readonly resolver: () => void;
    readonly rechazar: (error: Error) => void;
  }

  function turnoControlable(): TurnoControlable {
    let resolver!: () => void;
    let rechazar!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolver = resolve;
      rechazar = reject;
    });
    // Evita `unhandledRejection` cuando el test rechaza el turno pero nadie
    // más lo espera todavía en ese instante — el mismo `.catch(() => {})`
    // mudo que cualquier promesa "observada tarde" necesita.
    promise.catch(() => {});
    return { promise, resolver, rechazar };
  }

  /** Doble de `A2AHttpServerLike` — molde de `makeFakeHttpServer` (`web/server.test.ts:701-730`). */
  function makeFakeA2AHttpServer(direccion: { readonly port: number } | string | null = { port: 54_321 }): {
    server: {
      listen: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      address: ReturnType<typeof vi.fn>;
      closeIdleConnections: ReturnType<typeof vi.fn>;
    };
    createServer: CreateA2AServerFn;
    getListener: () => (req: A2ARequest, res: A2AResponse) => void;
  } {
    let capturedListener: ((req: A2ARequest, res: A2AResponse) => void) | undefined;
    const server = {
      listen: vi.fn((_port: number, callback: () => void) => {
        callback();
      }),
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
      on: vi.fn(),
      address: vi.fn(() => direccion),
      closeIdleConnections: vi.fn(),
    };
    const createServer = vi.fn((listener: (req: A2ARequest, res: A2AResponse) => void) => {
      capturedListener = listener;
      return server;
    });
    return {
      server,
      createServer,
      getListener: () => {
        if (capturedListener === undefined) {
          throw new Error("listener not captured yet");
        }
        return capturedListener;
      },
    };
  }

  function postSendMessage(
    listener: (req: A2ARequest, res: A2AResponse) => void,
    id: string,
    texto = "hola",
  ): { req: FakeA2ARequest; res: FakeA2AResponse } {
    const req = new FakeA2ARequest({ method: "POST", url: RUTA_JSONRPC, headers: authHeader() });
    const res = new FakeA2AResponse();
    listener(req, res);
    req.emitBody([
      jsonBody({
        jsonrpc: "2.0",
        method: METODO_SEND_MESSAGE,
        id,
        params: { message: { parts: [{ text: texto }] } },
      }),
    ]);
    return { req, res };
  }

  /** `postSendMessage` responde `result: { task: Task }` (ver `JsonRpcSendMessageResultEnvelope` en `server.ts`). */
  function resultState(res: FakeA2AResponse): string {
    const call = res.end.mock.calls[0]?.[0] as string;
    const sobre = JSON.parse(call) as { result: { task: { status: { state: string } } } };
    return sobre.result.task.status.state;
  }

  describe("puerto efectivo (ADR 101)", () => {
    it("A2AServerHandle.port is server.address().port with listen(0), not the configured 0", async () => {
      const config = makeConfig({ port: 0 });
      const deps = makeDeps({ config, onSolicitudA2A: vi.fn() });
      const { createServer } = makeFakeA2AHttpServer({ port: 54_321 });

      const handle: A2AServerHandle = await startServer(deps, createServer);

      expect(handle.port).toBe(54_321);
      expect(handle.port).not.toBe(0);
    });

    it("falls back to deps.config.port when the double does not implement address()", async () => {
      const config = makeConfig({ port: 8888 });
      const deps = makeDeps({ config, onSolicitudA2A: vi.fn() });
      const { createServer } = makeFakeA2AHttpServer(null);

      const handle: A2AServerHandle = await startServer(deps, createServer);

      expect(handle.port).toBe(8888);
    });

    it("rejects when the underlying server emits an 'error' event (e.g. EADDRINUSE)", async () => {
      const deps = makeDeps({ onSolicitudA2A: vi.fn() });
      const error = new Error("EADDRINUSE");
      const createServer: CreateA2AServerFn = () => ({
        listen: vi.fn(),
        close: vi.fn(),
        address: vi.fn(() => null),
        on: vi.fn((event: string, listener: (error: Error) => void) => {
          if (event === "error") {
            listener(error);
          }
        }),
        closeIdleConnections: vi.fn(),
      });

      await expect(startServer(deps, createServer)).rejects.toBe(error);
    });
  });

  describe("tope de turnos en vuelo (ADR 99)", () => {
    it("with maxEnVuelo: 2, a third SendMessage with in-flight (non-resolving) turns gets hayCupo: false and REJECTED", async () => {
      const config = makeConfig({ maxEnVuelo: 2 });
      const turnos: TurnoControlable[] = [];
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => {
          if (!input.hayCupo) {
            return { estado: "TASK_STATE_REJECTED", contextId: input.a2aTaskId, updatedAt: NOW };
          }
          const turno = turnoControlable();
          turnos.push(turno);
          return { estado: "TASK_STATE_SUBMITTED", contextId: input.a2aTaskId, updatedAt: NOW, turno: turno.promise };
        },
      );
      const deps = makeDeps({ config, onSolicitudA2A });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      await startServer(deps, createServer);
      const listener = getListener();

      const { res: res1 } = postSendMessage(listener, "req-1");
      await esperarRespuesta(res1);
      const { res: res2 } = postSendMessage(listener, "req-2");
      await esperarRespuesta(res2);
      const { res: res3 } = postSendMessage(listener, "req-3");
      await esperarRespuesta(res3);

      expect(onSolicitudA2A).toHaveBeenCalledTimes(3);
      const [input1] = onSolicitudA2A.mock.calls[0] as [SolicitudA2AEntrada];
      const [input2] = onSolicitudA2A.mock.calls[1] as [SolicitudA2AEntrada];
      const [input3] = onSolicitudA2A.mock.calls[2] as [SolicitudA2AEntrada];
      expect(input1.hayCupo).toBe(true);
      expect(input2.hayCupo).toBe(true);
      expect(input3.hayCupo).toBe(false);

      expect(resultState(res1)).toBe("TASK_STATE_SUBMITTED");
      expect(resultState(res2)).toBe("TASK_STATE_SUBMITTED");
      expect(resultState(res3)).toBe("TASK_STATE_REJECTED");
      expect(turnos).toHaveLength(2);
    });

    it("regains cupo (hayCupo: true) for the next SendMessage once an in-flight turn resolves", async () => {
      const config = makeConfig({ maxEnVuelo: 2 });
      const turnos: TurnoControlable[] = [];
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => {
          if (!input.hayCupo) {
            return { estado: "TASK_STATE_REJECTED", contextId: input.a2aTaskId, updatedAt: NOW };
          }
          const turno = turnoControlable();
          turnos.push(turno);
          return { estado: "TASK_STATE_SUBMITTED", contextId: input.a2aTaskId, updatedAt: NOW, turno: turno.promise };
        },
      );
      const deps = makeDeps({ config, onSolicitudA2A });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      await startServer(deps, createServer);
      const listener = getListener();

      await esperarRespuesta(postSendMessage(listener, "req-1").res);
      await esperarRespuesta(postSendMessage(listener, "req-2").res);
      const { res: res3 } = postSendMessage(listener, "req-3");
      await esperarRespuesta(res3);
      expect(resultState(res3)).toBe("TASK_STATE_REJECTED");

      // Libera un cupo: el primer turno resuelve, y la desregistración del
      // `Set` de `enVuelo` (`.then(olvidar, olvidar)`) corre antes de que
      // esta promesa propia resuelva, porque se registró primero.
      const [primero] = turnos;
      primero?.resolver();
      await primero?.promise;

      const { res: res4 } = postSendMessage(listener, "req-4");
      await esperarRespuesta(res4);

      expect(resultState(res4)).toBe("TASK_STATE_SUBMITTED");
      const [, , , input4] = onSolicitudA2A.mock.calls.map(
        (call) => (call as [SolicitudA2AEntrada])[0],
      );
      expect(input4?.hayCupo).toBe(true);
    });
  });

  describe("drenaje al cerrar (ADR 99, ADR 101)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("close() with a pending turn does not resolve until the turn resolves", async () => {
      const config = makeConfig({ maxEnVuelo: 4 });
      const turno = turnoControlable();
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => ({
          estado: "TASK_STATE_SUBMITTED",
          contextId: input.a2aTaskId,
          updatedAt: NOW,
          turno: turno.promise,
        }),
      );
      const deps = makeDeps({ config, onSolicitudA2A });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      const handle = await startServer(deps, createServer);
      postSendMessage(getListener(), "req-1");
      // Deja avanzar la cola de microtareas para que `onSolicitudA2A`
      // resuelva y el turno quede registrado en `enVuelo` antes de llamar
      // `close()` — mismo motivo que `web/server.test.ts:750-754`.
      await vi.advanceTimersByTimeAsync(0);

      let closed = false;
      const closePromise = handle.close().then(() => {
        closed = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(closed).toBe(false);

      turno.resolver();
      await closePromise;

      expect(closed).toBe(true);
    });

    it("close() resolves after A2A_CLOSE_TIMEOUT_MS even if a turn never settles, and logs a2a-servidor-cierre-con-turnos-en-vuelo — never rejects", async () => {
      const config = makeConfig({ maxEnVuelo: 4 });
      const turno = turnoControlable();
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => ({
          estado: "TASK_STATE_SUBMITTED",
          contextId: input.a2aTaskId,
          updatedAt: NOW,
          turno: turno.promise,
        }),
      );
      const logEvent = vi.fn();
      const deps = makeDeps({ config, onSolicitudA2A, logEvent });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      const handle = await startServer(deps, createServer);
      postSendMessage(getListener(), "req-1");
      await vi.advanceTimersByTimeAsync(0);

      let closed = false;
      const closePromise = handle.close().then(() => {
        closed = true;
      });

      await vi.advanceTimersByTimeAsync(A2A_CLOSE_TIMEOUT_MS);
      await closePromise;

      expect(closed).toBe(true);
      expect(logEvent).toHaveBeenCalledWith(
        A2A_SERVER_LOG_CORRELATION_ID,
        "a2a-servidor-cierre-con-turnos-en-vuelo",
        expect.objectContaining({ enVuelo: 1 }),
      );
    });

    it("close() never rejects, even when the in-flight turn itself rejects", async () => {
      const config = makeConfig({ maxEnVuelo: 4 });
      const turno = turnoControlable();
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => ({
          estado: "TASK_STATE_SUBMITTED",
          contextId: input.a2aTaskId,
          updatedAt: NOW,
          turno: turno.promise,
        }),
      );
      const deps = makeDeps({ config, onSolicitudA2A });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      const handle = await startServer(deps, createServer);
      postSendMessage(getListener(), "req-1");
      await vi.advanceTimersByTimeAsync(0);

      let rechazoRecibido = false;
      const closePromise = handle.close().catch(() => {
        rechazoRecibido = true;
      });

      turno.rechazar(new Error("el turno se cayo"));
      await vi.advanceTimersByTimeAsync(0);
      await closePromise;

      expect(rechazoRecibido).toBe(false);
    });

    it("close() invokes server.closeIdleConnections() before waiting on the server.close() callback (Hallazgo 5 Reviewer, Hito 7)", async () => {
      const deps = makeDeps({ onSolicitudA2A: vi.fn() });
      const { createServer, server } = makeFakeA2AHttpServer();

      const handle = await startServer(deps, createServer);
      await handle.close();

      expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    });
  });

  describe("desalojo de enVuelo por timeout (Hallazgo 2 Reviewer, Hito 7)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("un turno que nunca resuelve libera su slot tras A2A_TURNO_EN_VUELO_MAX_MS (hayCupo vuelve a true), sin cancelar la promesa real, y logea a2a-turno-en-vuelo-desalojado-por-timeout", async () => {
      const config = makeConfig({ maxEnVuelo: 1 });
      const turno = turnoControlable();
      const onSolicitudA2A = vi.fn(
        async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => {
          if (!input.hayCupo) {
            return { estado: "TASK_STATE_REJECTED", contextId: input.a2aTaskId, updatedAt: NOW };
          }
          return {
            estado: "TASK_STATE_SUBMITTED",
            contextId: input.a2aTaskId,
            updatedAt: NOW,
            turno: turno.promise,
          };
        },
      );
      const logEvent = vi.fn();
      const deps = makeDeps({ config, onSolicitudA2A, logEvent });
      const { createServer, getListener } = makeFakeA2AHttpServer();

      await startServer(deps, createServer);
      const listener = getListener();

      const { res: res1 } = postSendMessage(listener, "req-1");
      await esperarRespuesta(res1);
      expect(resultState(res1)).toBe("TASK_STATE_SUBMITTED");
      const [inputRegistrado] = onSolicitudA2A.mock.calls[0] as [SolicitudA2AEntrada];

      // `maxEnVuelo: 1` y el turno del `req-1` nunca resuelve: sin el
      // desalojo, este segundo `SendMessage` vería `hayCupo: false` para
      // siempre — el síntoma exacto del Hallazgo 2.
      const { res: res2 } = postSendMessage(listener, "req-2");
      await esperarRespuesta(res2);
      expect(resultState(res2)).toBe("TASK_STATE_REJECTED");

      let turnoResuelto = false;
      void turno.promise.then(() => {
        turnoResuelto = true;
      });

      await vi.advanceTimersByTimeAsync(A2A_TURNO_EN_VUELO_MAX_MS);

      expect(logEvent).toHaveBeenCalledWith(
        A2A_SERVER_LOG_CORRELATION_ID,
        "a2a-turno-en-vuelo-desalojado-por-timeout",
        expect.objectContaining({ a2aTaskId: inputRegistrado.a2aTaskId }),
      );
      // El desalojo NO cancela ni resuelve la promesa real del turno.
      expect(turnoResuelto).toBe(false);

      const { res: res3 } = postSendMessage(listener, "req-3");
      await esperarRespuesta(res3);
      expect(resultState(res3)).toBe("TASK_STATE_SUBMITTED");
    });
  });
});

describe("construirTask (Hito 7, tarea 11, design.md ADR 93 — el test estrella)", () => {
  const A2A_TASK_ID = "task-abc-1";
  const UPDATED_AT = "2026-09-09T12:00:00.000Z";

  function vista(overrides: Partial<SolicitudA2AEntranteVista> = {}): SolicitudA2AEntranteVista {
    return {
      a2aTaskId: A2A_TASK_ID,
      contextId: A2A_TASK_ID,
      estado: "TASK_STATE_SUBMITTED",
      updatedAt: UPDATED_AT,
      ...overrides,
    };
  }

  it("TASK_STATE_COMPLETED with resultado present -> artifacts with the exact shape, no status.message", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_COMPLETED", resultado: "la respuesta del turno" }));

    expect(task.artifacts).toEqual([
      { artifactId: `${A2A_TASK_ID}-0`, name: "respuesta", parts: [{ text: "la respuesta del turno" }] },
    ]);
    expect(task.status.message).toBeUndefined();
  });

  it("TASK_STATE_FAILED -> status.message with the fixed text, no artifacts", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_FAILED" }));

    expect(task.status.message).toEqual({
      messageId: `${A2A_TASK_ID}-msg`,
      parts: [{ text: "El turno del arnés no pudo completarse." }],
    });
    expect(task.artifacts).toBeUndefined();
  });

  it("TASK_STATE_CANCELED -> status.message with the fixed text, no artifacts", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_CANCELED" }));

    expect(task.status.message).toEqual({
      messageId: `${A2A_TASK_ID}-msg`,
      parts: [{ text: "La tarea fue cancelada por el llamador." }],
    });
    expect(task.artifacts).toBeUndefined();
  });

  it("TASK_STATE_REJECTED -> status.message with the fixed text, no artifacts", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_REJECTED" }));

    expect(task.status.message).toEqual({
      messageId: `${A2A_TASK_ID}-msg`,
      parts: [{ text: "El arnés está al máximo de solicitudes en curso. Reintentá más tarde." }],
    });
    expect(task.artifacts).toBeUndefined();
  });

  it("TASK_STATE_SUBMITTED -> neither artifacts nor status.message", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_SUBMITTED" }));

    expect(task.artifacts).toBeUndefined();
    expect(task.status.message).toBeUndefined();
  });

  it("TASK_STATE_WORKING -> neither artifacts nor status.message", () => {
    const task = construirTask(vista({ estado: "TASK_STATE_WORKING" }));

    expect(task.artifacts).toBeUndefined();
    expect(task.status.message).toBeUndefined();
  });

  it("TASK_STATE_COMPLETED without resultado (no real path produces it, but the function is total) -> does not throw, artifacts absent", () => {
    let task: ReturnType<typeof construirTask> | undefined;

    expect(() => {
      task = construirTask(vista({ estado: "TASK_STATE_COMPLETED" }));
    }).not.toThrow();

    expect(task?.artifacts).toBeUndefined();
    expect(task?.status.message).toBeUndefined();
  });

  it("status.timestamp is exactly vista.updatedAt, with no transformation", () => {
    const task = construirTask(vista({ updatedAt: "2020-01-01T00:00:00.000Z" }));

    expect(task.status.timestamp).toBe("2020-01-01T00:00:00.000Z");
  });

  it("contextId is copied as-is from vista.contextId, regardless of where the value came from", () => {
    const conCasoId = construirTask(vista({ contextId: "caso-42" }));
    expect(conCasoId.contextId).toBe("caso-42");

    const conA2ATaskId = construirTask(vista({ contextId: A2A_TASK_ID }));
    expect(conA2ATaskId.contextId).toBe(A2A_TASK_ID);
  });

  it("artifactId and messageId are derived deterministically from a2aTaskId — no randomUUID, pure function", () => {
    const primeraLlamada = construirTask(
      vista({ estado: "TASK_STATE_COMPLETED", resultado: "x" }),
    );
    const segundaLlamada = construirTask(
      vista({ estado: "TASK_STATE_COMPLETED", resultado: "x" }),
    );

    expect(primeraLlamada).toEqual(segundaLlamada);
    expect(primeraLlamada.artifacts?.[0]?.artifactId).toBe(`${A2A_TASK_ID}-0`);

    const conMensaje = construirTask(vista({ estado: "TASK_STATE_FAILED" }));
    expect(conMensaje.status.message?.messageId).toBe(`${A2A_TASK_ID}-msg`);
  });

  it.each([
    ["TASK_STATE_COMPLETED", "con resultado"],
    ["TASK_STATE_FAILED", undefined],
    ["TASK_STATE_CANCELED", undefined],
    ["TASK_STATE_REJECTED", undefined],
    ["TASK_STATE_SUBMITTED", undefined],
    ["TASK_STATE_WORKING", undefined],
    ["TASK_STATE_COMPLETED", undefined],
  ])("is total — never throws for estado '%s' (resultado: %s)", (estado, resultado) => {
    expect(() => construirTask(vista({ estado, resultado }))).not.toThrow();
  });
});
