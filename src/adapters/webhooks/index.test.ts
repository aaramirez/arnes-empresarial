import { describe, expect, it, vi } from "vitest";
import type { IncomingActivityEvent } from "../../core/activity/activity-contract.js";
import { WEBHOOK_LOG_CORRELATION_ID, type WebhookConfig } from "./config.js";
import * as serverModule from "./server.js";
import type { CreateServerFn, HttpServerLike } from "./server.js";
import { startWebhookServer } from "./index.js";

const DISABLED_CONFIG: WebhookConfig = {
  secret: "",
  port: 8787,
  path: "/webhooks/github",
  maxBodyBytes: 1_048_576,
};

const ENABLED_CONFIG: WebhookConfig = {
  secret: "test-secret",
  port: 9999,
  path: "/webhooks/custom",
  maxBodyBytes: 1_048_576,
};

function makeDeps(overrides: {
  onEvent?: (evento: IncomingActivityEvent) => Promise<void>;
  logEvent?: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} = {}): {
  onEvent: (evento: IncomingActivityEvent) => Promise<void>;
  logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} {
  return {
    onEvent: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn(),
    ...overrides,
  };
}

/** Doble de `HttpServerLike` cuyo `listen` llama al callback de éxito sincrónicamente. */
function makeSuccessfulServer(): { createServer: CreateServerFn; fakeServer: HttpServerLike } {
  const fakeServer: HttpServerLike = {
    listen: vi.fn((_port: number, callback: () => void) => {
      callback();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn(),
  };
  const createServer = vi.fn(() => fakeServer) as unknown as CreateServerFn;
  return { createServer, fakeServer };
}

/**
 * Doble de `HttpServerLike` que simula un `listen` que rechaza (p. ej.
 * `EADDRINUSE`): igual que `startServer` hace en producción, dispara el
 * listener de `"error"` en vez de llamar al callback de éxito de `listen`.
 * Mismo mecanismo estructural que ya ejercita `server.test.ts`.
 */
function makeFailingServer(error: Error): { createServer: CreateServerFn } {
  let errorListener: ((error: Error) => void) | undefined;
  const fakeServer: HttpServerLike = {
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
  const createServer = vi.fn(() => fakeServer) as unknown as CreateServerFn;
  return { createServer };
}

describe("startWebhookServer", () => {
  it("returns undefined, never calls createServer, and logs webhook-deshabilitado when no secret is configured", async () => {
    const logEvent = vi.fn();
    const createServer = vi.fn() as unknown as CreateServerFn;
    const deps = makeDeps({ logEvent });

    const adapter = await startWebhookServer({
      ...deps,
      config: DISABLED_CONFIG,
      createServer,
    });

    expect(adapter).toBeUndefined();
    expect(createServer).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(WEBHOOK_LOG_CORRELATION_ID, "webhook-deshabilitado");
  });

  it("returns a WebhookAdapter with the configured port/path when a secret is set and listen succeeds", async () => {
    const { createServer, fakeServer } = makeSuccessfulServer();
    const deps = makeDeps();

    const adapter = await startWebhookServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
    });

    expect(adapter).toBeDefined();
    expect(adapter?.port).toBe(ENABLED_CONFIG.port);
    expect(adapter?.path).toBe(ENABLED_CONFIG.path);
    expect(typeof adapter?.close).toBe("function");
    expect(fakeServer.listen).toHaveBeenCalledWith(ENABLED_CONFIG.port, expect.any(Function));

    await adapter?.close();

    expect(fakeServer.close).toHaveBeenCalled();
  });

  it("logs webhook-escuchando with the real port/path once the server is listening", async () => {
    const { createServer } = makeSuccessfulServer();
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });

    await startWebhookServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
    });

    expect(logEvent).toHaveBeenCalledWith(WEBHOOK_LOG_CORRELATION_ID, "webhook-escuchando", {
      port: ENABLED_CONFIG.port,
      path: ENABLED_CONFIG.path,
    });
  });

  it("forwards botLogin to serverDeps (startServer) when passed to startWebhookServer", async () => {
    const { createServer } = makeSuccessfulServer();
    const startServerSpy = vi.spyOn(serverModule, "startServer");
    const deps = makeDeps();

    await startWebhookServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
      botLogin: "arnes-empresarial-bot",
    });

    expect(startServerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ botLogin: "arnes-empresarial-bot" }),
      createServer,
    );

    startServerSpy.mockRestore();
  });

  it("does not include botLogin in serverDeps when not provided (undefined, no spread crash)", async () => {
    const { createServer } = makeSuccessfulServer();
    const startServerSpy = vi.spyOn(serverModule, "startServer");
    const deps = makeDeps();

    await startWebhookServer({
      ...deps,
      config: ENABLED_CONFIG,
      createServer,
    });

    const [serverDeps] = startServerSpy.mock.calls[0] as unknown as [{ botLogin?: string }];
    expect(serverDeps.botLogin).toBeUndefined();

    startServerSpy.mockRestore();
  });

  it("propagates a rejected listen (e.g. EADDRINUSE) instead of swallowing it or logging webhook-arranque-fallido", async () => {
    const error = new Error("listen EADDRINUSE: address already in use :::9999");
    const { createServer } = makeFailingServer(error);
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });

    await expect(
      startWebhookServer({
        ...deps,
        config: ENABLED_CONFIG,
        createServer,
      }),
    ).rejects.toThrow(error);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-arranque-fallido",
      expect.anything(),
    );
  });
});
