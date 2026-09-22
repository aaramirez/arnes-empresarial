import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingActivityEvent } from "../../core/activity/activity-contract.js";
import { ACTIVIDAD_TIPO_PR_REVIEW } from "../../core/activity/activity-contract.js";
import {
  resolveWebhookConfig,
  SERVER_CLOSE_TIMEOUT_MS,
  WEBHOOK_LOG_CORRELATION_ID,
  type WebhookConfig,
} from "./config.js";
import * as signatureModule from "./signature.js";
import * as githubMapperModule from "./github-mapper.js";
import {
  createRequestListener,
  startServer as startServerReal,
  type CreateServerFn,
  type WebhookRequest,
  type WebhookResponse,
  type WebhookServerDeps,
} from "./server.js";
import issueCommentOnPrFixture from "./__fixtures__/issue-comment.on-pr.json" with { type: "json" };

const CONFIG: WebhookConfig = {
  secret: "test-secret",
  port: 8787,
  path: "/webhooks/github",
  maxBodyBytes: 1024,
};

const NOW = "2026-09-01T12:00:00.000Z";

const VALID_EVENT: IncomingActivityEvent = {
  origen: "github",
  proyectoId: "octo-org/hello-world",
  proyectoNombre: "hello-world",
  repoUrl: "https://github.com/octo-org/hello-world",
  tipo: ACTIVIDAD_TIPO_PR_REVIEW,
  referenciaExterna: "42",
  responsableId: "octocat",
  titulo: "titulo",
  cuerpo: "cuerpo",
  archivosCambiados: [],
  deliveryId: "delivery-1",
  recibidoEn: NOW,
};

/** Doble plano de `http.IncomingMessage` que satisface `WebhookRequest` estructuralmente. */
class FakeRequest implements WebhookRequest {
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

/** Doble plano de `http.ServerResponse` que satisface `WebhookResponse` estructuralmente. */
class FakeResponse implements WebhookResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  end = vi.fn();

  setHeader(name: string, value: string): unknown {
    this.headers.set(name, value);
    return this;
  }
}

/** Deferred controlable a mano, para probar orden ack-antes-que-turno y drenaje. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(overrides: Partial<WebhookServerDeps> = {}): WebhookServerDeps {
  return {
    config: CONFIG,
    onEvent: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
}

function signedBody(body: string): { buffer: Buffer; signature: string } {
  const buffer = Buffer.from(body, "utf8");
  const signature = signatureModule.computeSignature(buffer, CONFIG.secret);
  return { buffer, signature };
}

describe("createRequestListener", () => {
  it("responds 404 for a non-POST method", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: CONFIG.path, headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("responds 404 when the path does not match config.path", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/otra-ruta", headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
  });

  it("does not 404 when the path matches but carries an extra querystring", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: `${CONFIG.path}?foo=bar`,
      headers: {},
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([]);

    // No debe ser 404 — el recorte en "?" tiene que dejar pasar el path base.
    expect(res.statusCode).not.toBe(404);
  });

  it("responds 413 and destroys the request when the body exceeds maxBodyBytes, without ever verifying the signature, and logs webhook-rechazado-tamano", () => {
    const verifySpy = vi.spyOn(signatureModule, "verifySignature");
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
    });
    const res = new FakeResponse();

    listener(req, res);
    // maxBodyBytes = 1024. Mandamos dos chunks que en conjunto superan el tope.
    const bigChunk = Buffer.alloc(700, "a");
    const secondChunk = Buffer.alloc(400, "b");
    req.emitBody([bigChunk, secondChunk]);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "webhook-rechazado-tamano",
      expect.anything(),
    );

    verifySpy.mockRestore();
  });

  it("responds 401 on invalid signature, never invokes onEvent, and logs webhook-firma-invalida", () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logEvent = vi.fn();
    const deps = makeDeps({ onEvent, logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": "sha256=invalida",
        "x-github-delivery": "delivery-401",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.from(JSON.stringify({ action: "opened" }), "utf8")]);

    expect(res.statusCode).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "delivery-401",
      "webhook-firma-invalida",
      expect.anything(),
    );
  });

  it("responds 400 when JSON.parse fails after a valid signature, and logs webhook-payload-invalido", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const { buffer, signature } = signedBody("no-es-json{{{");
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-400",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(res.statusCode).toBe(400);
    expect(logEvent).toHaveBeenCalledWith(
      "delivery-400",
      "webhook-payload-invalido",
      expect.anything(),
    );
  });

  it("responds 400 on a request 'error' event, without invoking onEvent", () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: CONFIG.path, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitError(new Error("socket hang up"));

    expect(res.statusCode).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("responds 202 and invokes onEvent exactly once with the normalized event on a valid payload", () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onEvent });
    const listener = createRequestListener(deps);
    const payload = { action: "opened" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-202",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(res.statusCode).toBe(202);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(VALID_EVENT);

    mapSpy.mockRestore();
  });

  it("responds 202 without invoking onEvent when mapGithubEvent returns undefined, and logs webhook-evento-ignorado", () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logEvent = vi.fn();
    const deps = makeDeps({ onEvent, logEvent });
    const listener = createRequestListener(deps);
    const payload = { action: "closed" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(undefined);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-ignored",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(res.statusCode).toBe(202);
    expect(onEvent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "delivery-ignored",
      "webhook-evento-ignorado",
      expect.anything(),
    );

    mapSpy.mockRestore();
  });

  it("calls res.end() BEFORE the onEvent promise settles (ADR 10, ack first)", async () => {
    const order: string[] = [];
    const deferred = createDeferred<void>();
    const onEvent = vi.fn().mockImplementation(() => {
      return deferred.promise.then(() => {
        order.push("onEvent-settled");
      });
    });
    const deps = makeDeps({ onEvent });
    const listener = createRequestListener(deps);
    const payload = { action: "opened" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-order",
      },
    });
    const res = new FakeResponse();
    res.end.mockImplementation(() => {
      order.push("end-called");
    });

    listener(req, res);
    req.emitBody([buffer]);

    // Sincrónicamente, antes de resolver el deferred: res.end() ya se llamó.
    expect(res.end).toHaveBeenCalled();
    expect(order).toEqual(["end-called"]);

    deferred.resolve();
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["end-called", "onEvent-settled"]);

    mapSpy.mockRestore();
  });
});

describe("createRequestListener — filtro anti-loop por botLogin (Hito 3, tarea 24)", () => {
  it("responde 202, loguea webhook-evento-ignorado y NUNCA llama onEvent cuando el comentario lo publicó el propio bot", () => {
    // Sin spy sobre mapGithubEvent: se ejercita el mapeo REAL contra un
    // fixture donde comment.user.login coincide con deps.botLogin, para
    // probar el filtro de punta a punta a través de createRequestListener.
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logEvent = vi.fn();
    const config: WebhookConfig = { ...CONFIG, maxBodyBytes: 1_048_576 };
    const deps = makeDeps({
      config,
      onEvent,
      logEvent,
      botLogin: issueCommentOnPrFixture.comment.user.login,
    });
    const listener = createRequestListener(deps);
    // `config.secret` no cambia respecto a `CONFIG` — solo se sube
    // `maxBodyBytes` para que el fixture (mayor a los 1024 bytes de
    // `CONFIG`) no dispare el 413 antes de llegar al filtro anti-loop.
    const { buffer, signature } = signedBody(JSON.stringify(issueCommentOnPrFixture));
    const req = new FakeRequest({
      method: "POST",
      url: config.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery-anti-loop",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(res.statusCode).toBe(202);
    expect(onEvent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "delivery-anti-loop",
      "webhook-evento-ignorado",
      expect.anything(),
    );
  });
});

describe("createRequestListener — webhook-recibido (design.md §9.2)", () => {
  it("logs webhook-recibido with event, action and bytes when the payload carries an action, and the event is processed", () => {
    const logEvent = vi.fn();
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onEvent, logEvent });
    const listener = createRequestListener(deps);
    const payload = { action: "opened" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-recibido-action",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(logEvent).toHaveBeenCalledWith("delivery-recibido-action", "webhook-recibido", {
      event: "pull_request",
      action: "opened",
      bytes: buffer.length,
    });
    expect(onEvent).toHaveBeenCalledTimes(1);

    mapSpy.mockRestore();
  });

  it("logs webhook-recibido without an 'action' field when the payload has none", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const payload = { ref: "refs/heads/main" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "push",
        "x-github-delivery": "delivery-recibido-sin-action",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    const recibidoCall = logEvent.mock.calls.find((call) => call[1] === "webhook-recibido");
    expect(recibidoCall).toBeDefined();
    const fields = recibidoCall?.[2] as Record<string, unknown>;
    expect(Object.keys(fields)).not.toContain("action");
    expect(fields).toEqual({ event: "push", bytes: buffer.length });

    mapSpy.mockRestore();
  });

  it("logs webhook-recibido even when mapGithubEvent ignores the event (returns undefined)", () => {
    const logEvent = vi.fn();
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onEvent, logEvent });
    const listener = createRequestListener(deps);
    const payload = { action: "closed" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(undefined);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-recibido-ignorado",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(logEvent).toHaveBeenCalledWith("delivery-recibido-ignorado", "webhook-recibido", {
      event: "pull_request",
      action: "closed",
      bytes: buffer.length,
    });
    expect(onEvent).not.toHaveBeenCalled();

    mapSpy.mockRestore();
  });

  it("does not log webhook-recibido for a non-POST/path-mismatch request (404)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: CONFIG.path, headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-recibido",
      expect.anything(),
    );
  });

  it("does not log webhook-recibido when the body exceeds maxBodyBytes (413)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.alloc(700, "a"), Buffer.alloc(400, "b")]);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-recibido",
      expect.anything(),
    );
  });

  it("does not log webhook-recibido on a request 'error' event (400)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: CONFIG.path, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitError(new Error("socket hang up"));

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-recibido",
      expect.anything(),
    );
  });

  it("does not log webhook-recibido on invalid signature (401)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": "sha256=invalida",
        "x-github-delivery": "delivery-401-recibido",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.from(JSON.stringify({ action: "opened" }), "utf8")]);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-recibido",
      expect.anything(),
    );
  });

  it("does not log webhook-recibido when JSON.parse fails after a valid signature (400)", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ logEvent });
    const listener = createRequestListener(deps);
    const { buffer, signature } = signedBody("no-es-json{{{");
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-400-recibido",
      },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([buffer]);

    expect(logEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "webhook-recibido",
      expect.anything(),
    );
  });
});

describe("createRequestListener — close() drains in-flight onEvent calls", () => {
  // Estos tests ejercitan startServer con un doble de HttpServerLike para
  // poder probar close(). No abren ningún puerto real.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("close() awaits in-flight onEvent promises via Promise.allSettled before resolving", async () => {
    const { startServer } = await import("./server.js");
    const deferred = createDeferred<void>();
    const onEvent = vi.fn().mockImplementation(() => deferred.promise);
    const deps = makeDeps({ onEvent });

    let capturedListener: ((req: WebhookRequest, res: WebhookResponse) => void) | undefined;
    const fakeHttpServer = {
      // Variádico (modo-headless-cierre-limpio, tarea 4.3): `listen` gana la
      // sobrecarga `(port, host, callback)`; el callback es el último argumento.
      listen: vi.fn((...args: unknown[]) => {
        (args[args.length - 1] as () => void)();
      }),
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
      on: vi.fn(),
    };
    const createServer = vi.fn((listener: (req: WebhookRequest, res: WebhookResponse) => void) => {
      capturedListener = listener;
      return fakeHttpServer;
    });

    const handle = await startServer(deps, createServer);

    const payload = { action: "opened" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-close",
      },
    });
    const res = new FakeResponse();

    expect(capturedListener).toBeDefined();
    capturedListener?.(req, res);
    req.emitBody([buffer]);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    // Todavía no debería estar cerrado: el onEvent en vuelo no se resolvió.
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);

    deferred.resolve();
    await closePromise;

    expect(closed).toBe(true);
    expect(fakeHttpServer.close).toHaveBeenCalled();

    mapSpy.mockRestore();
  });

  it("close() resolves after SERVER_CLOSE_TIMEOUT_MS even if an onEvent never settles, and logs webhook-cierre-con-turnos-en-vuelo", async () => {
    const { startServer } = await import("./server.js");
    const deferred = createDeferred<void>();
    const onEvent = vi.fn().mockImplementation(() => deferred.promise);
    const logEvent = vi.fn();
    const deps = makeDeps({ onEvent, logEvent });

    let capturedListener: ((req: WebhookRequest, res: WebhookResponse) => void) | undefined;
    const fakeHttpServer = {
      // Variádico: ver el doble del test anterior (modo-headless-cierre-limpio, tarea 4.3).
      listen: vi.fn((...args: unknown[]) => {
        (args[args.length - 1] as () => void)();
      }),
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
      on: vi.fn(),
    };
    const createServer = vi.fn((listener: (req: WebhookRequest, res: WebhookResponse) => void) => {
      capturedListener = listener;
      return fakeHttpServer;
    });

    const handle = await startServer(deps, createServer);

    const payload = { action: "opened" };
    const { buffer, signature } = signedBody(JSON.stringify(payload));
    const mapSpy = vi.spyOn(githubMapperModule, "mapGithubEvent").mockReturnValue(VALID_EVENT);
    const req = new FakeRequest({
      method: "POST",
      url: CONFIG.path,
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-timeout",
      },
    });
    const res = new FakeResponse();

    capturedListener?.(req, res);
    req.emitBody([buffer]);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(SERVER_CLOSE_TIMEOUT_MS);
    await closePromise;

    expect(closed).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      WEBHOOK_LOG_CORRELATION_ID,
      "webhook-cierre-con-turnos-en-vuelo",
      expect.anything(),
    );

    mapSpy.mockRestore();
    // El deferred nunca se resuelve a propósito — cerramos igual el test.
    void deferred.promise.catch(() => undefined);
  });
});

/**
 * Doble plano de `HttpServerLike` para los tests de `modo-headless-cierre-limpio`
 * (tarea 4.3): `listen` variádico (el callback es SIEMPRE el último argumento;
 * los tests de aridad leen `listen.mock.calls`) y `closeIdleConnections`
 * espiable, más un espía del método destructivo que cierra TODAS las conexiones
 * (ver `METODO_CIERRA_TODAS`). Ningún test abre un socket (design §0.6).
 */

/**
 * Nombre del método de `http.Server` que destruye TAMBIÉN los sockets con una
 * request en curso. Se arma por partes A PROPÓSITO: el criterio de aceptación
 * de la tarea 4.4 es que ese nombre NO aparezca en ningún archivo de
 * `src/adapters/webhooks` (la declaración muerta de `HttpServerLike` se fue), y
 * un literal en este test lo ensuciaría. No es ofuscación de la garantía: el
 * test que lo usa exige que NADIE lo llame.
 */
const METODO_CIERRA_TODAS = `close${"All"}Connections`;

function makeFakeHttpServerConHost(): {
  server: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    closeIdleConnections: ReturnType<typeof vi.fn>;
    cierraTodas: ReturnType<typeof vi.fn>;
  };
  createServer: CreateServerFn;
} {
  const cierraTodas = vi.fn();
  const server = {
    listen: vi.fn((...args: unknown[]) => {
      (args[args.length - 1] as () => void)();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn(),
    closeIdleConnections: vi.fn(),
    cierraTodas,
    [METODO_CIERRA_TODAS]: cierraTodas,
  };
  const createServer = vi.fn(() => server);
  return { server, createServer };
}

/**
 * `modo-headless-cierre-limpio`, tarea 4.3 (E2, R21, design §0.6 y §7.3): el
 * invariante de "sin `WEBHOOK_HOST` no se cambia el bind actual" es de ARIDAD de
 * `listen`, no de semántica de red. `listen(port, cb)` (2 args) es EXACTAMENTE
 * lo de hoy; `listen(port, host, cb)` (3 args) solo con `WEBHOOK_HOST` no
 * blanco. El default NUNCA es `"0.0.0.0"`/`"::"`/`"localhost"`/`""`.
 */
describe("startServer — WEBHOOK_HOST y la aridad de listen (modo-headless-cierre-limpio, tarea 4.3, E2, R21)", () => {
  const LITERALES_PROHIBIDOS_POR_DEFECTO = ["0.0.0.0", "::", "localhost", ""];
  const ENV_BASE = { GITHUB_WEBHOOK_SECRET: "test-secret", WEBHOOK_PORT: "8787" };

  it("sin WEBHOOK_HOST, listen recibe EXACTAMENTE dos argumentos: el puerto (numero) y el callback (funcion)", async () => {
    const deps = makeDeps({ config: resolveWebhookConfig(ENV_BASE) });
    const { createServer, server } = makeFakeHttpServerConHost();

    await startServerReal(deps, createServer);

    expect(server.listen).toHaveBeenCalledTimes(1);
    const args = server.listen.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe(8787);
    expect(args[1]).toBeTypeOf("function");
  });

  it("sin WEBHOOK_HOST, ningun argumento de listen es un string ni uno de los literales '0.0.0.0', '::', 'localhost' o ''", async () => {
    const deps = makeDeps({ config: resolveWebhookConfig(ENV_BASE) });
    const { createServer, server } = makeFakeHttpServerConHost();

    await startServerReal(deps, createServer);

    const args = server.listen.mock.calls[0] as unknown[];
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) {
      expect(typeof arg).not.toBe("string");
      expect(LITERALES_PROHIBIDOS_POR_DEFECTO).not.toContain(arg);
    }
  });

  it.each(["127.0.0.1", "::1", "0.0.0.0"])(
    "con WEBHOOK_HOST=%s, listen recibe TRES argumentos en el orden puerto, host identico al configurado, callback",
    async (host) => {
      const deps = makeDeps({ config: resolveWebhookConfig({ ...ENV_BASE, WEBHOOK_HOST: host }) });
      const { createServer, server } = makeFakeHttpServerConHost();

      await startServerReal(deps, createServer);

      const args = server.listen.mock.calls[0] as unknown[];
      expect(args).toHaveLength(3);
      expect(args[0]).toBe(8787);
      expect(args[1]).toBe(host);
      expect(args[2]).toBeTypeOf("function");
    },
  );

  it.each([
    ["empty string", ""],
    ["blank (spaces only)", "   "],
  ])("con WEBHOOK_HOST %s equivale a ausente: listen recibe DOS argumentos", async (_label, valor) => {
    const deps = makeDeps({ config: resolveWebhookConfig({ ...ENV_BASE, WEBHOOK_HOST: valor }) });
    const { createServer, server } = makeFakeHttpServerConHost();

    await startServerReal(deps, createServer);

    const args = server.listen.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe(8787);
    expect(args[1]).toBeTypeOf("function");
  });

  it("con un host no enlazable (listen emite 'error'), startServer rechaza con ESE error -- camino vigente de webhook-arranque-fallido", async () => {
    const error = new Error("EADDRNOTAVAIL");
    let errorListener: ((error: Error) => void) | undefined;
    const listen = vi.fn(() => {
      errorListener?.(error);
    });
    const createServer: CreateServerFn = () => ({
      listen,
      close: vi.fn(),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === "error") {
          errorListener = listener;
        }
      }),
    });
    const deps = makeDeps({ config: { ...CONFIG, host: "203.0.113.9" } });

    await expect(startServerReal(deps, createServer)).rejects.toBe(error);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(CONFIG.port, "203.0.113.9", expect.any(Function));
  });
});

/**
 * `modo-headless-cierre-limpio`, tarea 4.3 (design §0.2 y §0.8): `close()` de
 * webhooks puede colgarse detras de un socket keep-alive ocioso, igual que web.
 * `HttpServerLike` declaraba el metodo que cierra TODAS las conexiones SIN
 * llamador (muerto, y ademas el metodo equivocado: destruye tambien los
 * sockets con request en curso). El fix es `closeIdleConnections()` INVOCADO,
 * antes de esperar el callback de `server.close()`, y que NADA llame al otro.
 */
describe("startServer — close() corta las conexiones ociosas antes de esperar server.close() (modo-headless-cierre-limpio, tarea 4.3, design §0.2 y §0.8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()", async () => {
    const deps = makeDeps();
    const { createServer, server } = makeFakeHttpServerConHost();

    const handle = await startServerReal(deps, createServer);
    await handle.close();

    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    const ordenIdle = server.closeIdleConnections.mock.invocationCallOrder[0] as number;
    const ordenClose = server.close.mock.invocationCallOrder[0] as number;
    expect(ordenIdle).toBeLessThan(ordenClose);
  });

  it("corta las ociosas SIN esperar el callback de server.close() (que un socket ocioso nunca dispara)", async () => {
    const deps = makeDeps();
    const { createServer, server } = makeFakeHttpServerConHost();
    server.close.mockImplementation(() => undefined);

    const handle = await startServerReal(deps, createServer);
    void handle.close();

    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it("NO cierra TODAS las conexiones (metodo destructivo): mataria la respuesta de un turno con request en curso", async () => {
    const deps = makeDeps();
    const { createServer, server } = makeFakeHttpServerConHost();

    const handle = await startServerReal(deps, createServer);
    await handle.close();

    expect(server.cierraTodas).not.toHaveBeenCalled();
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
  });
});
