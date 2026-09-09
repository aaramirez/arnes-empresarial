import { timingSafeEqual } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { esAutorizado, leerCuerpoConTope, pathFromUrl, type A2ARequest, type A2AResponse } from "./server.js";

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
