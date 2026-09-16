import { describe, expect, it, vi } from "vitest";
import { WEB_LOG_CORRELATION_ID, type WebConfig } from "./config.js";
import type { CreateWebServerFn, WebRequest, WebResponse } from "./http.js";
import { startWebServer } from "./index.js";

const DISABLED_CONFIG: WebConfig = {
  port: 0,
  publicUrl: "http://localhost:8080",
  ventasApiToken: "",
  maxBodyBytes: 65_536,
};

const ENABLED_CONFIG: WebConfig = {
  port: 4321,
  publicUrl: "http://localhost:4321",
  ventasApiToken: "test-token",
  maxBodyBytes: 65_536,
};

interface FakeHttpServer {
  listen: (port: number, callback: () => void) => void;
  close: (callback: (error?: Error) => void) => void;
  on: (event: "error", listener: (error: Error) => void) => void;
}

function makeDeps(overrides: { logEvent?: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void } = {}): {
  onAltaVenta: () => Promise<never>;
  onConsultaVenta: () => Promise<undefined>;
  onDecisionVenta: () => Promise<never>;
  onDevolucion: () => Promise<never>;
  onSoporte: () => Promise<never>;
  onLogin: () => Promise<never>;
  onOperacionesEmpleado: () => Promise<never>;
  sesionStore: {
    crear: () => string;
    buscar: () => undefined;
    eliminar: () => void;
    otraSesionVigente: () => boolean;
  };
  confirmacionOperacionesStore: { paraEmpleado: () => never; limpiarEmpleado: () => void };
  conversacionStore: { paraSesion: () => never; eliminar: () => void };
  logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} {
  return {
    onAltaVenta: vi.fn().mockRejectedValue(new Error("not used")),
    onConsultaVenta: vi.fn().mockResolvedValue(undefined),
    onDecisionVenta: vi.fn().mockRejectedValue(new Error("not used")),
    onDevolucion: vi.fn().mockRejectedValue(new Error("not used")),
    onSoporte: vi.fn().mockRejectedValue(new Error("not used")),
    onLogin: vi.fn().mockRejectedValue(new Error("not used")),
    onOperacionesEmpleado: vi.fn().mockRejectedValue(new Error("not used")),
    sesionStore: {
      crear: vi.fn().mockReturnValue("token"),
      buscar: vi.fn().mockReturnValue(undefined),
      eliminar: vi.fn(),
      otraSesionVigente: vi.fn().mockReturnValue(false),
    },
    confirmacionOperacionesStore: {
      paraEmpleado: (): never => {
        throw new Error("not used");
      },
      limpiarEmpleado: vi.fn(),
    },
    conversacionStore: {
      paraSesion: (): never => {
        throw new Error("not used");
      },
      eliminar: vi.fn(),
    },
    logEvent: vi.fn(),
    ...overrides,
  };
}

/** Doble de servidor HTTP cuyo `listen` llama al callback de éxito sincrónicamente. */
function makeSuccessfulServer(): { createServer: CreateWebServerFn; fakeServer: FakeHttpServer } {
  const fakeServer: FakeHttpServer = {
    listen: vi.fn((_port: number, callback: () => void) => {
      callback();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn(),
  };
  const createServer = vi.fn(
    (_listener: (req: WebRequest, res: WebResponse) => void) => fakeServer,
  ) as unknown as CreateWebServerFn;
  return { createServer, fakeServer };
}

/**
 * Doble cuyo `listen` simula un `EADDRINUSE`: dispara el listener de
 * `"error"` en vez de llamar al callback de éxito de `listen` — mismo
 * mecanismo estructural que `webhooks/index.test.ts`.
 */
function makeFailingServer(error: Error): { createServer: CreateWebServerFn } {
  let errorListener: ((error: Error) => void) | undefined;
  const fakeServer: FakeHttpServer = {
    listen: vi.fn((_port: number, _callback: () => void) => {
      errorListener?.(error);
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn((event: "error", listener: (error: Error) => void) => {
      if (event === "error") {
        errorListener = listener;
      }
    }),
  };
  const createServer = vi.fn(
    (_listener: (req: WebRequest, res: WebResponse) => void) => fakeServer,
  ) as unknown as CreateWebServerFn;
  return { createServer };
}

describe("startWebServer", () => {
  it("returns undefined, never calls createServer, and logs web-deshabilitado when WEB_PORT is not configured", async () => {
    const logEvent = vi.fn();
    const createServer = vi.fn() as unknown as CreateWebServerFn;
    const deps = makeDeps({ logEvent });

    const adapter = await startWebServer({
      ...deps,
      config: DISABLED_CONFIG,
      createServer,
    });

    expect(adapter).toBeUndefined();
    expect(createServer).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(WEB_LOG_CORRELATION_ID, "web-deshabilitado");
  });

  it("returns a WebAdapter with the configured port when WEB_PORT is set and listen succeeds", async () => {
    const { createServer, fakeServer } = makeSuccessfulServer();
    const deps = makeDeps();

    const adapter = await startWebServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
    });

    expect(adapter).toBeDefined();
    expect(adapter?.port).toBe(ENABLED_CONFIG.port);
    expect(typeof adapter?.close).toBe("function");
    expect(fakeServer.listen).toHaveBeenCalledWith(ENABLED_CONFIG.port, expect.any(Function));

    await adapter?.close();

    expect(fakeServer.close).toHaveBeenCalled();
  });

  it("propagates a rejected listen (e.g. EADDRINUSE) instead of swallowing it or returning a degraded adapter", async () => {
    const error = new Error("listen EADDRINUSE: address already in use :::4321");
    const { createServer } = makeFailingServer(error);
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });

    await expect(
      startWebServer({
        ...deps,
        config: ENABLED_CONFIG,
        createServer,
      }),
    ).rejects.toThrow(error);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "web-arranque-fallido",
      expect.anything(),
    );
  });
});
