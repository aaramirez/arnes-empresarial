import { describe, expect, it, vi } from "vitest";
import { A2A_SERVER_LOG_CORRELATION_ID, type A2AServerConfig } from "./server-config.js";
import * as serverModule from "./server.js";
import type {
  A2AHttpServerLike,
  A2ARequest,
  A2AResponse,
  CancelacionA2AResultado,
  CreateA2AServerFn,
  SolicitudA2AAceptada,
  SolicitudA2AEntranteVista,
} from "./server.js";
import { startA2AServer } from "./server-index.js";

const DISABLED_CONFIG: A2AServerConfig = {
  token: "",
  port: 8888,
  publicUrl: "http://localhost:8888",
  maxBodyBytes: 65_536,
  maxEnVuelo: 4,
};

const ENABLED_CONFIG: A2AServerConfig = {
  token: "test-token",
  port: 4321,
  publicUrl: "http://localhost:4321",
  maxBodyBytes: 65_536,
  maxEnVuelo: 4,
};

function makeDeps(overrides: {
  logEvent?: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} = {}): {
  onSolicitudA2A: (input: {
    readonly a2aTaskId: string;
    readonly texto: string;
    readonly origenTransporte: string;
    readonly hayCupo: boolean;
  }) => Promise<SolicitudA2AAceptada>;
  onConsultarTarea: (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined;
  onCancelarTarea: (a2aTaskId: string) => CancelacionA2AResultado;
  logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} {
  return {
    onSolicitudA2A: vi.fn().mockRejectedValue(new Error("not used")),
    onConsultarTarea: vi.fn().mockReturnValue(undefined),
    onCancelarTarea: vi.fn().mockReturnValue({ resultado: "no-encontrada" }),
    logEvent: vi.fn(),
    ...overrides,
  };
}

/** Doble de `A2AHttpServerLike` cuyo `listen` llama al callback de éxito sincrónicamente. */
function makeSuccessfulServer(): { createServer: CreateA2AServerFn; fakeServer: A2AHttpServerLike } {
  const fakeServer: A2AHttpServerLike = {
    listen: vi.fn((_port: number, callback: () => void) => {
      callback();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    address: vi.fn(() => ({ port: ENABLED_CONFIG.port })),
    on: vi.fn(),
  };
  const createServer = vi.fn(
    (_listener: (req: A2ARequest, res: A2AResponse) => void) => fakeServer,
  ) as unknown as CreateA2AServerFn;
  return { createServer, fakeServer };
}

/**
 * Doble cuyo `listen` simula un `EADDRINUSE`: dispara el listener de
 * `"error"` en vez de llamar al callback de éxito de `listen` — mismo
 * mecanismo estructural que `webhooks/index.test.ts`/`web/index.test.ts`.
 */
function makeFailingServer(error: Error): { createServer: CreateA2AServerFn } {
  let errorListener: ((error: Error) => void) | undefined;
  const fakeServer: A2AHttpServerLike = {
    listen: vi.fn((_port: number, _callback: () => void) => {
      errorListener?.(error);
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    address: vi.fn(() => null),
    on: vi.fn((event: "error", listener: (error: Error) => void) => {
      if (event === "error") {
        errorListener = listener;
      }
    }),
  };
  const createServer = vi.fn(
    (_listener: (req: A2ARequest, res: A2AResponse) => void) => fakeServer,
  ) as unknown as CreateA2AServerFn;
  return { createServer };
}

describe("startA2AServer", () => {
  it("returns undefined, never calls createServer, and logs a2a-servidor-deshabilitado when HARNESS_A2A_ENTRANTE_TOKEN is not configured", async () => {
    const logEvent = vi.fn();
    const createServer = vi.fn() as unknown as CreateA2AServerFn;
    const deps = makeDeps({ logEvent });

    const adapter = await startA2AServer({
      ...deps,
      config: DISABLED_CONFIG,
      createServer,
    });

    expect(adapter).toBeUndefined();
    expect(createServer).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-deshabilitado");
  });

  it("wires the full config into startServer exactly once, returns an A2AServerAdapter, and logs a2a-servidor-escuchando when a token is set and listen succeeds", async () => {
    const { createServer, fakeServer } = makeSuccessfulServer();
    const startServerSpy = vi.spyOn(serverModule, "startServer");
    const deps = makeDeps();

    const adapter = await startA2AServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
    });

    expect(startServerSpy).toHaveBeenCalledTimes(1);
    expect(startServerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        config: ENABLED_CONFIG,
        onSolicitudA2A: deps.onSolicitudA2A,
        onConsultarTarea: deps.onConsultarTarea,
        onCancelarTarea: deps.onCancelarTarea,
        logEvent: deps.logEvent,
      }),
      createServer,
    );

    expect(adapter).toBeDefined();
    expect(adapter?.port).toBe(ENABLED_CONFIG.port);
    expect(adapter?.publicUrl).toBe(ENABLED_CONFIG.publicUrl);
    expect(typeof adapter?.close).toBe("function");
    expect(deps.logEvent).toHaveBeenCalledWith(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-escuchando", {
      port: ENABLED_CONFIG.port,
      publicUrl: ENABLED_CONFIG.publicUrl,
    });

    await adapter?.close();

    expect(fakeServer.close).toHaveBeenCalled();

    startServerSpy.mockRestore();
  });

  it("propagates a rejected listen (e.g. EADDRINUSE) instead of swallowing it", async () => {
    const error = new Error("listen EADDRINUSE: address already in use :::4321");
    const { createServer } = makeFailingServer(error);
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });

    await expect(
      startA2AServer({
        ...deps,
        config: ENABLED_CONFIG,
        createServer,
      }),
    ).rejects.toThrow(error);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "a2a-servidor-escuchando",
      expect.anything(),
    );
  });
});
