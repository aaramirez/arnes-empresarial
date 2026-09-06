import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUTA_CONFIRMAR_PREFIJO,
  RUTA_DEVOLUCION,
  RUTA_SOPORTE,
  RUTA_VENTAS,
  SOPORTE_TIMEOUT_MS,
  WEB_CLOSE_TIMEOUT_MS,
  WEB_LOG_CORRELATION_ID,
  type WebConfig,
} from "./config.js";
import type { CreateWebServerFn, WebRequest, WebResponse } from "./http.js";
import { createRequestListener, startServer, type SoporteResult, type WebServerDeps } from "./server.js";
import type { RegistrarVentaResult } from "../../core/ventas/registrar-venta.js";
import type { VentaPublica } from "../../core/ventas/ventas-contract.js";

const CONFIG: WebConfig = {
  port: 8080,
  publicUrl: "http://localhost:8080",
  ventasApiToken: "secreto-de-prueba",
  maxBodyBytes: 1024,
};

const REQUEST_ID = "req-1";

/** Doble plano de `http.IncomingMessage` que satisface `WebRequest` estructuralmente. */
class FakeRequest implements WebRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
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
  }) {
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers ?? {};
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

/** Doble plano de `http.ServerResponse` que satisface `WebResponse` estructuralmente. */
class FakeResponse implements WebResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  end = vi.fn();

  setHeader(name: string, value: string): unknown {
    this.headers.set(name, value);
    return this;
  }
}

/**
 * Espera a que la respuesta se haya completado. NO se usa `res.statusCode`
 * como condición de espera: `FakeResponse.statusCode` arranca en `200`
 * (mismo default que `http.ServerResponse`), así que esperar
 * `statusCode === 200` o `statusCode > 0` sería una condición trivialmente
 * verdadera desde el arranque y el test avanzaría ANTES de que el handler
 * async terminara. `res.end` haber sido invocado es la única señal
 * confiable de que la respuesta terminó.
 */
async function esperarRespuesta(res: FakeResponse): Promise<void> {
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
}

function makeDeps(overrides: Partial<WebServerDeps> = {}): WebServerDeps {
  return {
    config: CONFIG,
    onAltaVenta: vi.fn(),
    onConsultaVenta: vi.fn(),
    onDecisionVenta: vi.fn(),
    onDevolucion: vi.fn(),
    onSoporte: vi.fn(),
    logEvent: vi.fn(),
    newRequestId: () => REQUEST_ID,
    ...overrides,
  };
}

function jsonBody(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

const VENTA_PAYLOAD_VALIDO = {
  vendedorId: "vend-1",
  vendedorNombre: "Ana",
  clienteId: "cli-1",
  clienteEmail: "cliente@example.com",
  planNuevo: "pro",
  monto: 1000,
};

const REGISTRAR_VENTA_RESULT: RegistrarVentaResult = {
  ventaId: "venta-1",
  casoId: "caso-1",
  linkConfirmacion: "http://localhost:8080/confirmar/token-1",
  notificado: true,
};

const VENTA_PUBLICA: VentaPublica = {
  planNuevo: "pro",
  monto: 1000,
};

const SOPORTE_RESULT: SoporteResult = {
  casoId: "caso-soporte-1",
  respuesta: "respuesta del bot",
};

function authHeader(token = CONFIG.ventasApiToken): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("createRequestListener — ruteo", () => {
  it("responds 404 (empty body) for an unrecognized path", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: "/no-existe", headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it("responds 404 (empty body) for a recognized path with the wrong method (GET /ventas)", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: RUTA_VENTAS, headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
    expect(deps.onAltaVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /ventas", () => {
  it("responds 401 without calling the handler when VENTAS_API_TOKEN is empty ('' never open by default)", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta, config: { ...CONFIG, ventasApiToken: "" } });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_VENTAS,
      headers: authHeader("cualquier-cosa"),
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-no-autorizado", expect.anything());
  });

  it("responds 401 without calling the handler when the Authorization header is missing", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
  });

  it("responds 401 (not a thrown RangeError) when the header has a different length than expected", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_VENTAS,
      headers: authHeader("corto"),
    });
    const res = new FakeResponse();

    expect(() => {
      listener(req, res);
      req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    }).not.toThrow();

    await esperarRespuesta(res);
    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
  });

  it("responds 413, destroys the request, and never calls the handler when the body exceeds maxBodyBytes", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    const bigChunk = Buffer.alloc(CONFIG.maxBodyBytes + 1, "a");
    req.emitBody([bigChunk]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(onAltaVenta).not.toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(
      REQUEST_ID,
      "web-rechazado-tamano",
      expect.objectContaining({ ruta: RUTA_VENTAS }),
    );
  });

  it("responds 400 with a broken JSON body", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.from("no-es-json{{{", "utf8")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-payload-invalido", expect.anything());
  });

  it("responds 400 with an invalid payload (missing required field)", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ ...VENTA_PAYLOAD_VALIDO, monto: undefined })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
  });

  it("responds 201 with the created sale on a valid payload, and calls the handler with the parsed input", async () => {
    const onAltaVenta = vi.fn().mockResolvedValue(REGISTRAR_VENTA_RESULT);
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(201);
    expect(onAltaVenta).toHaveBeenCalledWith(VENTA_PAYLOAD_VALIDO);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(REGISTRAR_VENTA_RESULT));
  });

  it("responds 500 with a generic error and logs web-handler-fallido when the handler throws", async () => {
    const onAltaVenta = vi.fn().mockRejectedValue(new Error("store rompió"));
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(500);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-handler-fallido", expect.anything());
    const body = JSON.parse(res.end.mock.calls[0]![0] as string) as { error: string };
    expect(body.error).not.toContain("store rompió");
  });
});

describe("createRequestListener — GET /confirmar/:token", () => {
  it("responds 200 with the confirmation form when the token resolves to a pending sale", async () => {
    const onConsultaVenta = vi.fn().mockResolvedValue(VENTA_PUBLICA);
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(onConsultaVenta).toHaveBeenCalledWith("token-1");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Request-Id")).toBe(REQUEST_ID);
  });

  it("responds 404 with the generic page when onConsultaVenta returns undefined", async () => {
    const onConsultaVenta = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}vencido`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
  });

  it.each([
    ["empty token", ""],
    ["token containing a slash", "abc/def"],
    ["token exceeding 200 characters", "a".repeat(201)],
  ])("responds 404 with the generic page for an invalid token (%s), without calling the handler", async (_label, token) => {
    const onConsultaVenta = vi.fn();
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}${token}`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onConsultaVenta).not.toHaveBeenCalled();
  });

  it("falls into the same generic page (no throw) when the token has an invalid % escape sequence", async () => {
    const onConsultaVenta = vi.fn();
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}%E0%A4%A`, headers: {} });
    const res = new FakeResponse();

    expect(() => listener(req, res)).not.toThrow();
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onConsultaVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /confirmar/:token", () => {
  function formBody(decision: string): Buffer {
    return Buffer.from(`decision=${decision}`, "utf8");
  }

  it("responds 200 'confirmada' when decision=confirmar and the CAS applied", async () => {
    const onDecisionVenta = vi
      .fn()
      .mockResolvedValue({ resultado: "confirmada", comisionMonto: 100, periodo: "2026-09" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("confirmar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(onDecisionVenta).toHaveBeenCalledWith({ token: "token-1", decision: "confirmar" });
    const body = res.end.mock.calls[0]![0] as string;
    expect(body).toContain("confirmada");
  });

  it("responds 200 'rechazada' when decision=rechazar and the CAS applied", async () => {
    const onDecisionVenta = vi.fn().mockResolvedValue({ resultado: "rechazada" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("rechazar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    const body = res.end.mock.calls[0]![0] as string;
    expect(body).toContain("rechazada");
  });

  it("responds 404 with the generic page for an invalid decision value, without calling the handler", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("lo-que-sea")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });

  it("responds 404 with the generic page when the CAS did not apply (resultado: no_aplicable)", async () => {
    const onDecisionVenta = vi.fn().mockResolvedValue({ resultado: "no_aplicable", motivo: "carrera" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("confirmar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
  });

  it("responds 404 with the generic page for an invalid token, without reading the body", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });

  it("responds 413 and destroys the request when the form body exceeds maxBodyBytes", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.alloc(CONFIG.maxBodyBytes + 1, "a")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — indistinguishability (R6) across the 404/generic-page rows", () => {
  it("produces byte-for-byte identical HTML responses for GET-undefined, GET-invalid-token, POST-invalid-decision, and POST-no_aplicable", async () => {
    const respuestas: Array<{ status: number; body: string; contentType: string | undefined }> = [];

    async function capturar(setup: (req: FakeRequest) => void, deps: WebServerDeps): Promise<void> {
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}token-x`, headers: {} });
      setup(req);
      const res = new FakeResponse();
      listener(req, res);
      req.emitBody([]);
      await esperarRespuesta(res);
      respuestas.push({
        status: res.statusCode,
        body: res.end.mock.calls[0]![0] as string,
        contentType: res.headers.get("Content-Type"),
      });
    }

    await capturar(
      (req) => {
        req.method = "GET";
      },
      makeDeps({ onConsultaVenta: vi.fn().mockResolvedValue(undefined) }),
    );
    await capturar(
      (req) => {
        req.method = "GET";
        req.url = `${RUTA_CONFIRMAR_PREFIJO}`;
      },
      makeDeps({ onConsultaVenta: vi.fn() }),
    );
    await capturar(
      (req) => {
        req.method = "POST";
      },
      makeDeps({ onDecisionVenta: vi.fn().mockResolvedValue({ resultado: "no_aplicable", motivo: "carrera" }) }),
    );
    await capturar(
      (req) => {
        req.method = "POST";
      },
      makeDeps({ onDecisionVenta: vi.fn() }),
    );

    const [primero, ...resto] = respuestas;
    if (primero === undefined) {
      throw new Error("no se capturó ninguna respuesta");
    }
    for (const respuesta of resto) {
      expect(respuesta.status).toBe(primero.status);
      expect(respuesta.body).toBe(primero.body);
      expect(respuesta.contentType).toBe(primero.contentType);
    }
    expect(primero.status).toBe(404);
  });

  it("produces byte-for-byte identical JSON responses for /devolucion unknown-token and wrong-state", async () => {
    async function capturar(onDevolucion: WebServerDeps["onDevolucion"]): Promise<{ status: number; body: string }> {
      const deps = makeDeps({ onDevolucion });
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
      const res = new FakeResponse();
      listener(req, res);
      req.emitBody([jsonBody({ token: "token-x" })]);
      await esperarRespuesta(res);
      return { status: res.statusCode, body: res.end.mock.calls[0]![0] as string };
    }

    const desconocido = await capturar(vi.fn().mockResolvedValue({ resultado: "no_aplicable" }));
    const estadoInvalido = await capturar(vi.fn().mockResolvedValue({ resultado: "no_aplicable" }));

    expect(desconocido.status).toBe(404);
    expect(desconocido).toEqual(estadoInvalido);
  });
});

describe("createRequestListener — POST /devolucion", () => {
  it("responds 200 {resultado: 'reembolsada'} below the threshold", async () => {
    const onDevolucion = vi.fn().mockResolvedValue({ resultado: "reembolsada" });
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ token: "token-1" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ resultado: "reembolsada" }));
  });

  it("responds 200 {resultado: 'escalada'} at or above the threshold", async () => {
    const onDevolucion = vi.fn().mockResolvedValue({ resultado: "escalada" });
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ token: "token-1" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ resultado: "escalada" }));
  });

  it("responds 400 with an invalid payload (missing token)", async () => {
    const onDevolucion = vi.fn();
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({})]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(onDevolucion).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /soporte", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds 200 with {casoId, respuesta} when the turn resolves before the timeout", async () => {
    const onSoporte = vi.fn().mockResolvedValue(SOPORTE_RESULT);
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(SOPORTE_RESULT));
  });

  it("responds 400 with an invalid payload (missing consulta)", async () => {
    const onSoporte = vi.fn();
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({})]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(400);
    expect(onSoporte).not.toHaveBeenCalled();
  });

  it("responds 504 and logs soporte-timeout when the handler takes longer than SOPORTE_TIMEOUT_MS", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onSoporte = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    await vi.advanceTimersByTimeAsync(SOPORTE_TIMEOUT_MS);

    expect(res.statusCode).toBe(504);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "soporte-timeout", expect.anything());

    resolverTurno(SOPORTE_RESULT);
  });

  it("responds 502 and logs soporte-turno-fallido when the handler rejects", async () => {
    const onSoporte = vi.fn().mockRejectedValue(new Error("el modelo rechazó"));
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(502);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "soporte-turno-fallido", expect.anything());
  });
});

describe("startServer — close() drains in-flight /soporte turns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFakeHttpServer(): {
    server: { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
    createServer: CreateWebServerFn;
    getListener: () => (req: WebRequest, res: WebResponse) => void;
  } {
    let capturedListener: ((req: WebRequest, res: WebResponse) => void) | undefined;
    const server = {
      listen: vi.fn((_port: number, callback: () => void) => {
        callback();
      }),
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
      on: vi.fn(),
    };
    const createServer = vi.fn((listener: (req: WebRequest, res: WebResponse) => void) => {
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

  it("close() awaits the in-flight /soporte turn via Promise.allSettled before resolving", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onSoporte = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const deps = makeDeps({ onSoporte });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    // Deja avanzar la cola de microtareas para que `handleSoporte` alcance
    // a llamar `onSoporte` (a través del wrapper de drenaje de
    // `startServer`) ANTES de tomar la foto de `enVuelo` en `close()` —
    // si no, `close()` vería el `Set` todavía vacío.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);

    resolverTurno(SOPORTE_RESULT);
    await closePromise;

    expect(closed).toBe(true);
  });

  it("close() resolves after WEB_CLOSE_TIMEOUT_MS even if a turn never settles, and logs web-cierre-con-turnos-en-vuelo", async () => {
    const onSoporte = vi.fn().mockImplementation(() => new Promise<SoporteResult>(() => {}));
    const logEvent = vi.fn();
    const deps = makeDeps({ onSoporte, logEvent });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    // Mismo motivo que en el test anterior: dejar que `onSoporte` quede
    // registrado en `enVuelo` antes de llamar `close()`.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(WEB_CLOSE_TIMEOUT_MS);
    await closePromise;

    expect(closed).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      WEB_LOG_CORRELATION_ID,
      "web-cierre-con-turnos-en-vuelo",
      expect.anything(),
    );
  });
});
