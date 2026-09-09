import { timingSafeEqual } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { construirAgentCard } from "./agent-card.js";
import {
  A2A_SERVER_LOG_CORRELATION_ID,
  JSONRPC_INTERNAL_ERROR,
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
  type A2ARequest,
  type A2AResponse,
  type A2AServerDeps,
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

  it.each([[METODO_SEND_MESSAGE], [METODO_GET_TASK], [METODO_CANCEL_TASK]])(
    "responds the interim -32603 for the known method '%s' (placeholder until task 12)",
    async (method) => {
      const deps = makeDeps();

      const { res } = postJsonRpc(
        deps,
        jsonBody({ jsonrpc: "2.0", method, id: "req-1", params: { cualquiera: true } }),
      );
      await esperarRespuesta(res);

      expect(res.statusCode).toBe(200);
      const sobre = parsedBody(res);
      expect(sobre.id).toBe("req-1");
      expect(sobre.error.code).toBe(JSONRPC_INTERNAL_ERROR);
    },
  );

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
