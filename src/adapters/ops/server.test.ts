import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUERPO_VIVO,
  OPS_CLOSE_TIMEOUT_MS,
  OPS_LOG_CORRELATION_ID,
  RUTA_LISTO,
  RUTA_VIVO,
  type OpsConfig,
} from "./config.js";
import type { CreateOpsServerFn, OpsHttpServerLike, OpsRequest, OpsResponse } from "./http.js";
import { startServer, type OpsServerDeps, type OpsServerHandle, type OpsSaludPort } from "./server.js";

/**
 * S7 (ADR 257 §5.4): el vocabulario de TODO cuerpo que la suite produce debe
 * pertenecer a este conjunto — sin dígitos, `/` ni `:`. El barrido corre al
 * final del archivo (test mecánico) sobre lo que las demás `it` acumularon.
 */
const CUERPOS_PERMITIDOS = new Set(["vivo", "listo", "cerrando", "base", "listener", ""]);
const HEADERS_PERMITIDOS = new Set(["content-type", "cache-control", "connection"]);
const cuerposObservados: string[] = [];
const nombresDeHeaderObservados: string[] = [];

/**
 * Doble plano de `OpsResponse` (S6/S7): registra `statusCode`, cada
 * `setHeader` y el argumento de `end()`, y alimenta los barridos globales de
 * vocabulario/headers de todo el archivo — cero sockets, cero `node:http`.
 */
class FakeOpsResponse implements OpsResponse {
  statusCode = 0;
  cuerpoFinal: string | undefined;
  private readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): unknown {
    this.headers.set(name.toLowerCase(), value);
    nombresDeHeaderObservados.push(name.toLowerCase());
    return this;
  }

  end(body?: string): unknown {
    this.cuerpoFinal = body;
    cuerposObservados.push(body ?? "");
    return this;
  }

  header(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  headerNames(): string[] {
    return [...this.headers.keys()];
  }
}

function makeSaludPort(overrides: Partial<Record<keyof OpsSaludPort, ReturnType<typeof vi.fn>>> = {}): OpsSaludPort {
  return {
    estaCerrando: vi.fn(() => false),
    baseUtilizable: vi.fn(() => true),
    listenersCaidos: vi.fn(() => 0),
    ...overrides,
  } as unknown as OpsSaludPort;
}

function makeDeps(overrides: Partial<OpsServerDeps> = {}): OpsServerDeps {
  return {
    config: { port: 8788 } satisfies OpsConfig,
    salud: makeSaludPort(),
    logEvent: vi.fn(),
    ...overrides,
  };
}

/**
 * Doble de `OpsHttpServerLike` (molde `webhooks/server.test.ts`,
 * `makeFakeHttpServerConHost`): `listen` variádico (el callback es SIEMPRE el
 * último argumento), `close(cb)` controlable, `on` y `closeIdleConnections`
 * espiables. `createServer` captura el `listener` real que `startServer`
 * monta, así los tests lo invocan directo con dobles planos de request/response.
 */
function makeFakeOpsHttpServer(): {
  server: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    closeIdleConnections: ReturnType<typeof vi.fn>;
  };
  createServer: CreateOpsServerFn;
  capturarListener: () => (req: OpsRequest, res: OpsResponse) => void;
} {
  let listenerCapturado: ((req: OpsRequest, res: OpsResponse) => void) | undefined;
  const server = {
    listen: vi.fn((...args: unknown[]) => {
      (args[args.length - 1] as () => void)();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn(),
    closeIdleConnections: vi.fn(),
  };
  const createServer: CreateOpsServerFn = (listener) => {
    listenerCapturado = listener;
    return server as unknown as OpsHttpServerLike;
  };
  return {
    server,
    createServer,
    capturarListener: () => {
      if (listenerCapturado === undefined) {
        throw new Error("listener no capturado: createServer no fue invocado");
      }
      return listenerCapturado;
    },
  };
}

async function montar(deps: OpsServerDeps = makeDeps()): Promise<{
  listener: (req: OpsRequest, res: OpsResponse) => void;
  handle: OpsServerHandle;
}> {
  const { createServer, capturarListener } = makeFakeOpsHttpServer();
  const handle = await startServer(deps, createServer);
  return { listener: capturarListener(), handle };
}

describe("startServer — GET/HEAD /salud/vivo responde 200 constante sin consultar el PUERTO (S6)", () => {
  it("GET /salud/vivo responde 200, text/plain; charset=utf-8 y el cuerpo vivo", async () => {
    const { listener } = await montar();
    const res = new FakeOpsResponse();

    listener({ method: "GET", url: RUTA_VIVO }, res);

    expect(res.statusCode).toBe(200);
    expect(res.header("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.cuerpoFinal).toBe(CUERPO_VIVO);
  });

  it("HEAD /salud/vivo responde 200 sin cuerpo (end() sin argumento)", async () => {
    const { listener } = await montar();
    const res = new FakeOpsResponse();

    listener({ method: "HEAD", url: RUTA_VIVO }, res);

    expect(res.statusCode).toBe(200);
    expect(res.cuerpoFinal).toBeUndefined();
  });

  it("liveness NO invoca ninguna funcion del PUERTO, ni siquiera si las tres lanzan", async () => {
    const salud = makeSaludPort({
      estaCerrando: vi.fn(() => {
        throw new Error("boom");
      }),
      baseUtilizable: vi.fn(() => {
        throw new Error("boom");
      }),
      listenersCaidos: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const { listener } = await montar(makeDeps({ salud }));
    const res = new FakeOpsResponse();

    expect(() => listener({ method: "GET", url: RUTA_VIVO }, res)).not.toThrow();
    expect(res.statusCode).toBe(200);
    expect(res.cuerpoFinal).toBe(CUERPO_VIVO);
    expect(salud.estaCerrando).not.toHaveBeenCalled();
    expect(salud.baseUtilizable).not.toHaveBeenCalled();
    expect(salud.listenersCaidos).not.toHaveBeenCalled();
  });

  it("liveness responde 200 aunque el proceso este cerrando y la base caida", async () => {
    const salud = makeSaludPort({
      estaCerrando: vi.fn(() => true),
      baseUtilizable: vi.fn(() => false),
      listenersCaidos: vi.fn(() => 3),
    });
    const { listener } = await montar(makeDeps({ salud }));
    const res = new FakeOpsResponse();

    listener({ method: "GET", url: RUTA_VIVO }, res);

    expect(res.statusCode).toBe(200);
    expect(res.cuerpoFinal).toBe(CUERPO_VIVO);
  });
});

describe("startServer — cualquier otro metodo+ruta responde 404 sin cuerpo (S7)", () => {
  it.each([
    ["POST", RUTA_VIVO],
    ["PUT", RUTA_LISTO],
    ["GET", "/salud"],
    ["GET", "/"],
    ["GET", `${RUTA_VIVO}/`],
    ["GET", `${RUTA_VIVO}?x=1`],
    ["GET", "/metrics"],
    ["HEAD", "/otra"],
    [undefined, RUTA_VIVO],
  ])("metodo %s en %s responde 404, cuerpo vacio y 0 llamadas al PUERTO", async (method, url) => {
    const salud = makeSaludPort();
    const { listener } = await montar(makeDeps({ salud }));
    const res = new FakeOpsResponse();

    listener({ method, url }, res);

    expect(res.statusCode).toBe(404);
    expect(res.cuerpoFinal ?? "").toBe("");
    expect(salud.estaCerrando).not.toHaveBeenCalled();
    expect(salud.baseUtilizable).not.toHaveBeenCalled();
    expect(salud.listenersCaidos).not.toHaveBeenCalled();
  });

  it("GET /salud/listo responde 404 en este PR (rojo inicial legitimo del slice D, S15 llega en 4.3-4.4)", async () => {
    const { listener } = await montar();
    const res = new FakeOpsResponse();

    listener({ method: "GET", url: RUTA_LISTO }, res);

    expect(res.statusCode).toBe(404);
    expect(res.cuerpoFinal ?? "").toBe("");
  });

  it("toda respuesta fija Cache-Control: no-store y Connection: close; Content-Type solo en 200", async () => {
    const { listener } = await montar();
    const resVivo = new FakeOpsResponse();
    const resHeadVivo = new FakeOpsResponse();
    const res404 = new FakeOpsResponse();

    listener({ method: "GET", url: RUTA_VIVO }, resVivo);
    listener({ method: "HEAD", url: RUTA_VIVO }, resHeadVivo);
    listener({ method: "GET", url: "/otra" }, res404);

    for (const res of [resVivo, resHeadVivo, res404]) {
      expect(res.header("Cache-Control")).toBe("no-store");
      expect(res.header("Connection")).toBe("close");
    }
    expect(resVivo.header("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(resHeadVivo.header("Content-Type")).toBe("text/plain; charset=utf-8");
  });
});

describe("startServer — OPS_HOST y la aridad de listen (S3)", () => {
  it("sin host, listen recibe EXACTAMENTE 2 argumentos: el puerto (numero) y el callback (funcion)", async () => {
    const { createServer, server } = makeFakeOpsHttpServer();

    await startServer(makeDeps({ config: { port: 8788 } }), createServer);

    expect(server.listen).toHaveBeenCalledTimes(1);
    const args = server.listen.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe(8788);
    expect(args[1]).toBeTypeOf("function");
  });

  it("sin host, ningun argumento de listen es 0.0.0.0, ::, localhost ni cadena vacia", async () => {
    const { createServer, server } = makeFakeOpsHttpServer();

    await startServer(makeDeps({ config: { port: 8788 } }), createServer);

    const args = server.listen.mock.calls[0] as unknown[];
    for (const arg of args) {
      expect(["0.0.0.0", "::", "localhost", ""]).not.toContain(arg);
    }
  });

  it.each(["127.0.0.1", "::1", "0.0.0.0"])(
    "con host=%s, listen recibe EXACTAMENTE 3 argumentos: puerto, host identico y callback",
    async (host) => {
      const { createServer, server } = makeFakeOpsHttpServer();

      await startServer(makeDeps({ config: { port: 8788, host } }), createServer);

      const args = server.listen.mock.calls[0] as unknown[];
      expect(args).toHaveLength(3);
      expect(args[0]).toBe(8788);
      expect(args[1]).toBe(host);
      expect(args[2]).toBeTypeOf("function");
    },
  );
});

describe("startServer — un fallo de listen rechaza (S8, camino vigente)", () => {
  it("on('error') con EADDRINUSE antes de completar listen hace que startServer rechace con ese error", async () => {
    const error = new Error("EADDRINUSE");
    let errorListener: ((error: Error) => void) | undefined;
    const listen = vi.fn(() => {
      errorListener?.(error);
    });
    const createServer: CreateOpsServerFn = () =>
      ({
        listen,
        close: vi.fn(),
        on: vi.fn((event: string, listener: (error: Error) => void) => {
          if (event === "error") {
            errorListener = listener;
          }
        }),
        closeIdleConnections: vi.fn(),
      }) as unknown as OpsHttpServerLike;

    await expect(startServer(makeDeps(), createServer)).rejects.toBe(error);
  });
});

/**
 * S8 (design.md §0.4/§4.4, `[SUPUESTO DE SPEC]` S-c): el techo de
 * `OPS_CLOSE_TIMEOUT_MS` envuelve `server.close()` ENTERO, no solo su
 * callback — divergencia DELIBERADA del molde de `web/server.ts`,
 * `webhooks/server.ts:301-321` y `a2a/server.ts:877-902`, donde el race
 * corre DENTRO del callback para acotar el drenaje de un `Set<Promise>` de
 * turnos huérfanos. `ops` no tiene turnos (sus dos handlers son síncronos),
 * así que lo único que puede colgar es el callback de `server.close()`
 * mismo. Con el molde de los otros tres (race adentro), el test "el techo
 * corta un close que nunca vuelve" de abajo NO terminaría.
 */
describe("startServer — close() corta ociosas y acota server.close() ENTERO a 5000 ms (S8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closeIdleConnections se llama 1 vez y ANTES que close", async () => {
    const { createServer, server } = makeFakeOpsHttpServer();
    const handle = await startServer(makeDeps(), createServer);

    await handle.close();

    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    const ordenIdle = server.closeIdleConnections.mock.invocationCallOrder[0] as number;
    const ordenClose = server.close.mock.invocationCallOrder[0] as number;
    expect(ordenIdle).toBeLessThan(ordenClose);
  });

  it("el techo corta un server.close() cuyo callback NUNCA llega (prueba de la divergencia deliberada)", async () => {
    const logEvent = vi.fn();
    const { createServer, server } = makeFakeOpsHttpServer();
    server.close.mockImplementation(() => {
      // El callback de `server.close()` NUNCA se invoca a propósito.
    });
    const handle = await startServer(makeDeps({ logEvent }), createServer);

    let resuelto = false;
    const closePromise = handle.close().then(() => {
      resuelto = true;
    });

    await vi.advanceTimersByTimeAsync(OPS_CLOSE_TIMEOUT_MS - 1);
    expect(resuelto).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await closePromise;

    expect(resuelto).toBe(true);
    const llamadasForzadas = logEvent.mock.calls.filter(
      (llamada) => llamada[1] === "ops-cierre-forzado",
    );
    expect(llamadasForzadas).toHaveLength(1);
    expect(llamadasForzadas[0]?.[0]).toBe(OPS_LOG_CORRELATION_ID);
    expect(llamadasForzadas[0]?.[2]).toEqual({ techoMs: OPS_CLOSE_TIMEOUT_MS });
  });

  it("un cierre normal (callback en t=100) resuelve sin forzar nada y sin timers vivos", async () => {
    const logEvent = vi.fn();
    const { createServer, server } = makeFakeOpsHttpServer();
    server.close.mockImplementation((callback: (error?: Error) => void) => {
      setTimeout(() => callback(), 100);
    });
    const handle = await startServer(makeDeps({ logEvent }), createServer);

    let resuelto = false;
    const closePromise = handle.close().then(() => {
      resuelto = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    await closePromise;

    expect(resuelto).toBe(true);
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "ops-cierre-forzado",
      expect.anything(),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("nunca rechaza, ni cuando el callback de close recibe un Error", async () => {
    const logEvent = vi.fn();
    const { createServer, server } = makeFakeOpsHttpServer();
    server.close.mockImplementation((callback: (error?: Error) => void) => {
      callback(new Error("not running"));
    });
    const handle = await startServer(makeDeps({ logEvent }), createServer);

    await expect(handle.close()).resolves.toBeUndefined();
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "ops-cierre-forzado",
      expect.anything(),
    );
  });
});

describe("server.test.ts — barrido mecanico de vocabulario cerrado y headers (S7)", () => {
  it("todo cuerpo producido por la suite pertenece al vocabulario cerrado, sin digitos, '/' ni ':'", () => {
    expect(cuerposObservados.length).toBeGreaterThan(0);
    for (const cuerpo of cuerposObservados) {
      expect(CUERPOS_PERMITIDOS.has(cuerpo)).toBe(true);
      expect(/\d/.test(cuerpo)).toBe(false);
      expect(cuerpo.includes("/")).toBe(false);
      expect(cuerpo.includes(":")).toBe(false);
    }
  });

  it("ningun header fuera de {content-type, cache-control, connection}, sin x-request-id", () => {
    expect(nombresDeHeaderObservados.length).toBeGreaterThan(0);
    for (const nombre of nombresDeHeaderObservados) {
      expect(HEADERS_PERMITIDOS.has(nombre)).toBe(true);
    }
    expect(nombresDeHeaderObservados).not.toContain("x-request-id");
  });
});
