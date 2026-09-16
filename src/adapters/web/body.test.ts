import { describe, expect, it, vi } from "vitest";
import type { WebRequest } from "./http.js";
import { leerBody, parseFormBody, parseJsonBody } from "./body.js";

/** Doble plano de `http.IncomingMessage` que satisface `WebRequest` estructuralmente. */
class FakeRequest implements WebRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  destroy = vi.fn();
  resume = vi.fn();

  private listeners: {
    data: Array<(chunk: Buffer) => void>;
    end: Array<() => void>;
    error: Array<(error: Error) => void>;
  } = { data: [], end: [], error: [] };

  constructor(init: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> } = {}) {
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

describe("leerBody", () => {
  it("resuelve ok:true con el body acumulado cuando no supera el tope", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 1024);

    req.emitBody([Buffer.from("hola "), Buffer.from("mundo")]);

    await expect(promise).resolves.toEqual({ ok: true, body: Buffer.from("hola mundo") });
  });

  it("resuelve ok:false motivo:tamano cuando el body supera el tope, sin guardar el chunk que lo supera", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 5);

    req.emitBody([Buffer.from("123456")]);

    await expect(promise).resolves.toEqual({ ok: false, motivo: "tamano" });
  });

  it("no llama req.destroy() al cortar por tamano (lo decide el ruteador, despues de escribir la respuesta)", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 5);

    req.emitBody([Buffer.from("123456")]);
    await promise;

    expect(req.destroy).not.toHaveBeenCalled();
  });

  it("no escribe ninguna respuesta al cortar por tamano (deja la decision al ruteador)", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 5);

    req.emitBody([Buffer.from("123456")]);
    const resultado = await promise;

    expect(resultado).toEqual({ ok: false, motivo: "tamano" });
    expect((req as unknown as { statusCode?: number }).statusCode).toBeUndefined();
  });

  it("corta exactamente en el tope: el chunk que lo supera no se guarda, solo los previos", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 3);

    // "abc" (3 bytes, dentro del tope) seguido de "de" (2 bytes, supera el tope)
    req.emitBody([Buffer.from("abc"), Buffer.from("de")]);

    await expect(promise).resolves.toEqual({ ok: false, motivo: "tamano" });
  });

  it("resuelve ok:false motivo:error-transporte cuando el request emite error", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 1024);

    req.emitError(new Error("socket hang up"));

    await expect(promise).resolves.toEqual({ ok: false, motivo: "error-transporte" });
  });

  it("ignora data/end posteriores a un error ya resuelto", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 1024);

    req.emitError(new Error("socket hang up"));
    req.emitBody([Buffer.from("tarde")]);

    await expect(promise).resolves.toEqual({ ok: false, motivo: "error-transporte" });
  });

  it("acepta un body vacio como exito", async () => {
    const req = new FakeRequest();
    const promise = leerBody(req, 1024);

    req.emitBody([]);

    await expect(promise).resolves.toEqual({ ok: true, body: Buffer.alloc(0) });
  });
});

describe("parseJsonBody", () => {
  it("parsea un Buffer JSON valido y devuelve ok:true con el valor", () => {
    const resultado = parseJsonBody(Buffer.from('{"a":1,"b":"dos"}'));

    expect(resultado).toEqual({ ok: true, valor: { a: 1, b: "dos" } });
  });

  it("parsea un string JSON valido", () => {
    const resultado = parseJsonBody('{"ok":true}');

    expect(resultado).toEqual({ ok: true, valor: { ok: true } });
  });

  it("devuelve ok:false con motivo estable cuando el JSON esta roto", () => {
    const resultado = parseJsonBody("{no es json");

    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({ ok: false, motivo: expect.any(String) });
  });

  it("devuelve ok:false para un body vacio", () => {
    const resultado = parseJsonBody(Buffer.alloc(0));

    expect(resultado.ok).toBe(false);
  });
});

describe("parseFormBody", () => {
  it("decodifica pares clave=valor separados por &", () => {
    const resultado = parseFormBody(Buffer.from("decision=confirmar&token=abc123"));

    expect(resultado).toEqual({
      ok: true,
      valor: { decision: "confirmar", token: "abc123" },
    });
  });

  it("decodifica caracteres percent-encoded y +", () => {
    const resultado = parseFormBody("motivo=no+me+gusto&nota=%C3%A1%C3%A9%C3%AD");

    expect(resultado).toEqual({
      ok: true,
      valor: { motivo: "no me gusto", nota: "áéí" },
    });
  });

  it("acepta un string en vez de Buffer", () => {
    const resultado = parseFormBody("a=1&b=2");

    expect(resultado).toEqual({ ok: true, valor: { a: "1", b: "2" } });
  });

  it("devuelve un objeto vacio para un body vacio", () => {
    const resultado = parseFormBody("");

    expect(resultado).toEqual({ ok: true, valor: {} });
  });
});
