import { describe, expect, it, vi } from "vitest";
import { OPS_LOG_CORRELATION_ID, RUTA_LISTO, RUTA_VIVO, type OpsConfig } from "./config.js";
import type { CreateOpsServerFn, OpsHttpServerLike, OpsRequest, OpsResponse } from "./http.js";
import type { OpsSaludPort } from "./server.js";
import { startOpsServer } from "./index.js";

function makeSaludPort(): OpsSaludPort {
  return {
    estaCerrando: vi.fn(() => false),
    baseUtilizable: vi.fn(() => true),
    listenersCaidos: vi.fn(() => 0),
  };
}

type LogEventFn = (
  correlationId: string,
  event: string,
  fields?: Readonly<Record<string, unknown>>,
) => void;

function makeDeps(overrides: {
  readonly config?: OpsConfig;
  readonly createServer?: CreateOpsServerFn;
  readonly logEvent?: ReturnType<typeof vi.fn<LogEventFn>>;
} = {}): {
  readonly salud: OpsSaludPort;
  readonly logEvent: ReturnType<typeof vi.fn<LogEventFn>>;
  readonly config?: OpsConfig;
  readonly createServer?: CreateOpsServerFn;
} {
  return {
    salud: makeSaludPort(),
    logEvent: overrides.logEvent ?? vi.fn<LogEventFn>(),
    ...(overrides.config !== undefined ? { config: overrides.config } : {}),
    ...(overrides.createServer !== undefined ? { createServer: overrides.createServer } : {}),
  };
}

/**
 * Doble de `OpsHttpServerLike` cuyo `listen` llama al callback de éxito
 * sincrónicamente (molde `makeSuccessfulServer` de `webhooks/index.test.ts`)
 * y captura el `listener` real que `startServer` monta, así el test de las
 * 100 requests mezcladas (P5) puede invocarlo directo sin abrir ningún
 * puerto real.
 */
function makeSuccessfulServer(): {
  readonly createServer: CreateOpsServerFn;
  readonly fakeServer: {
    readonly listen: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
    readonly on: ReturnType<typeof vi.fn>;
    readonly closeIdleConnections: ReturnType<typeof vi.fn>;
  };
  readonly capturarListener: () => (req: OpsRequest, res: OpsResponse) => void;
} {
  let listenerCapturado: ((req: OpsRequest, res: OpsResponse) => void) | undefined;
  const fakeServer = {
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
    return fakeServer as unknown as OpsHttpServerLike;
  };
  return {
    createServer,
    fakeServer,
    capturarListener: () => {
      if (listenerCapturado === undefined) {
        throw new Error("test setup error: createServer no fue invocado");
      }
      return listenerCapturado;
    },
  };
}

/**
 * Doble cuyo `listen` dispara el listener de `"error"` en vez de completar
 * (molde `makeFailingServer` de `webhooks/index.test.ts`).
 */
function makeFailingServer(error: Error): { readonly createServer: CreateOpsServerFn } {
  let errorListener: ((error: Error) => void) | undefined;
  const fakeServer = {
    listen: vi.fn((..._args: unknown[]) => {
      errorListener?.(error);
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === "error") {
        errorListener = listener;
      }
    }),
    closeIdleConnections: vi.fn(),
  };
  const createServer: CreateOpsServerFn = () => fakeServer as unknown as OpsHttpServerLike;
  return { createServer };
}

describe("startOpsServer — S9: gate de la fachada, molde webhooks/index.ts:51-88", () => {
  it("sin OPS_PORT devuelve undefined, createServer 0 llamadas, LOG exactamente 1 ops-deshabilitado y sin ops-puerto-invalido", async () => {
    const logEvent = vi.fn();
    const createServer = vi.fn() as unknown as CreateOpsServerFn;
    const deps = makeDeps({ config: { port: 0 }, createServer, logEvent });

    const adapter = await startOpsServer(deps);

    expect(adapter).toBeUndefined();
    expect(createServer).not.toHaveBeenCalled();
    const llamadas = logEvent.mock.calls.filter((llamada) => llamada[0] === OPS_LOG_CORRELATION_ID);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.[1]).toBe("ops-deshabilitado");
    expect(logEvent).not.toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-puerto-invalido", expect.anything());
  });

  it("con OPS_PORT='puerto' (inválido) emite 1 ops-puerto-invalido{raw} Y 1 ops-deshabilitado", async () => {
    const logEvent = vi.fn();
    const createServer = vi.fn() as unknown as CreateOpsServerFn;
    const deps = makeDeps({ config: { port: 0, puertoInvalido: "puerto" }, createServer, logEvent });

    const adapter = await startOpsServer(deps);

    expect(adapter).toBeUndefined();
    expect(createServer).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-puerto-invalido", { raw: "puerto" });
    expect(logEvent).toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-deshabilitado");
  });

  it.each([{ port: 0 }, { port: 0 }])(
    "sin puertoInvalido en la config (ausente/blanco ya resuelto por config.ts) NO emite ops-puerto-invalido",
    async (config) => {
      const logEvent = vi.fn();
      const createServer = vi.fn() as unknown as CreateOpsServerFn;

      await startOpsServer(makeDeps({ config, createServer, logEvent }));

      expect(logEvent).not.toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-puerto-invalido", expect.anything());
    },
  );

  it("con OPS_PORT='8788' y listen que completa, devuelve el adaptador con port 8788, 1 ops-escuchando{port}, sin ops-deshabilitado y createServer 1 llamada", async () => {
    const { createServer, fakeServer } = makeSuccessfulServer();
    const logEvent = vi.fn();

    const adapter = await startOpsServer(makeDeps({ config: { port: 8788 }, createServer, logEvent }));

    expect(adapter).toBeDefined();
    expect(adapter?.port).toBe(8788);
    expect(typeof adapter?.close).toBe("function");
    expect(fakeServer.listen).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-escuchando", { port: 8788 });
    expect(logEvent).not.toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-deshabilitado");

    await adapter?.close();
    expect(fakeServer.close).toHaveBeenCalled();
  });

  it("un listen que falla con EADDRINUSE hace que startOpsServer rechace, sin loguear ops-escuchando", async () => {
    const error = new Error("listen EADDRINUSE: address already in use :::8788");
    const { createServer } = makeFailingServer(error);
    const logEvent = vi.fn();

    await expect(startOpsServer(makeDeps({ config: { port: 8788 }, createServer, logEvent }))).rejects.toThrow(
      error,
    );

    expect(logEvent).not.toHaveBeenCalledWith(OPS_LOG_CORRELATION_ID, "ops-escuchando", expect.anything());
  });

  it("P5: 100 requests mezcladas (vivo GET/HEAD, listo, 404) no agregan ningún evento al LOG mas alla de ops-escuchando", async () => {
    const { createServer, capturarListener } = makeSuccessfulServer();
    const logEvent = vi.fn();

    await startOpsServer(makeDeps({ config: { port: 8788 }, createServer, logEvent }));
    const llamadasTrasArranque = logEvent.mock.calls.length;
    const listener = capturarListener();

    const pedidos: readonly [string, string][] = [
      ["GET", RUTA_VIVO],
      ["HEAD", RUTA_VIVO],
      ["GET", RUTA_LISTO],
      ["GET", "/otra"],
    ];
    for (let vez = 0; vez < 25; vez += 1) {
      for (const [method, url] of pedidos) {
        const res: OpsResponse = {
          statusCode: 0,
          setHeader: () => res,
          end: () => res,
        };
        listener({ method, url }, res);
      }
    }

    expect(logEvent.mock.calls.length).toBe(llamadasTrasArranque);
  });
});
