import { describe, expect, it, vi } from "vitest";
import type { NotificacionesConfig } from "./config.js";
import type { FetchFn, FetchResponseLike } from "./email-client.js";
import { createNoopNotificador, createNotificadorAdapter } from "./index.js";

const CASO_ID = "caso-1";
const CLIENTE_EMAIL = "cliente-secreto@example.com";
const LINK = "https://arnes.local/ventas/confirmar/tok_abc123";

function makeConfig(overrides: Partial<NotificacionesConfig> = {}): NotificacionesConfig {
  return {
    apiKey: "re_super-secreto-123",
    from: "arnes@localhost",
    apiUrl: "https://api.resend.com/emails",
    requestTimeoutMs: 10_000,
    ...overrides,
  };
}

function makeInput(overrides: Partial<Parameters<ReturnType<typeof createNoopNotificador>["notificarLinkConfirmacion"]>[0]> = {}) {
  return {
    clienteEmail: CLIENTE_EMAIL,
    linkConfirmacion: LINK,
    planNuevo: "plan-premium",
    monto: 4999,
    casoId: CASO_ID,
    ...overrides,
  };
}

function okResponse(): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve("{}"),
  };
}

interface LoggedCall {
  readonly casoId: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

function makeLogEvent(): {
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly calls: LoggedCall[];
} {
  const calls: LoggedCall[] = [];
  return {
    logEvent: (casoId, event, fields) => {
      calls.push({ casoId, event, fields });
    },
    calls,
  };
}

/** Ningun campo logueado (ni el propio evento serializado) puede contener el email del cliente — PII. */
function assertNoPiiInCalls(calls: readonly LoggedCall[]): void {
  for (const call of calls) {
    expect(JSON.stringify(call)).not.toContain(CLIENTE_EMAIL);
  }
}

describe("createNoopNotificador (sin EMAIL_API_KEY)", () => {
  it("fetchFn nunca se llama, loguea email-omitido con el link completo, devuelve sin-api-key", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn();

    const notificador = createNotificadorAdapter({ config: makeConfig({ apiKey: "" }), fetchFn, logEvent });

    const resultado = await notificador.notificarLinkConfirmacion(makeInput());

    expect(fetchFn).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: false, motivo: "sin-api-key" });

    const omitido = calls.find((call) => call.event === "email-omitido");
    expect(omitido).toBeDefined();
    expect(omitido?.casoId).toBe(CASO_ID);
    expect(omitido?.fields?.linkConfirmacion).toBe(LINK);
  });

  it("createNoopNotificador directo: mismo comportamiento sin pasar por createNotificadorAdapter", async () => {
    const { logEvent, calls } = makeLogEvent();
    const notificador = createNoopNotificador(logEvent);

    const resultado = await notificador.notificarLinkConfirmacion(makeInput());

    expect(resultado).toEqual({ enviado: false, motivo: "sin-api-key" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      casoId: CASO_ID,
      event: "email-omitido",
      fields: { linkConfirmacion: LINK },
    });
  });

  it("clienteEmail nunca aparece en los logs del no-op", async () => {
    const { logEvent, calls } = makeLogEvent();
    const notificador = createNoopNotificador(logEvent);

    await notificador.notificarLinkConfirmacion(makeInput());

    assertNoPiiInCalls(calls);
  });
});

describe("createNotificadorAdapter — contrato 'nunca rechaza, nunca lanza'", () => {
  it("fetchFn que rechaza (red caida) resuelve con enviado:false y loguea email-fallido con reason", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const notificador = createNotificadorAdapter({ config: makeConfig(), fetchFn, logEvent });

    await expect(notificador.notificarLinkConfirmacion(makeInput())).resolves.toEqual({
      enviado: false,
      motivo: "network",
    });

    const fallo = calls.find((call) => call.event === "email-fallido");
    expect(fallo).toBeDefined();
    expect(fallo?.fields?.reason).toBe("network");
  });

  it("fetchFn que responde !ok (error http del proveedor) resuelve con enviado:false, motivo:http y status en el log", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("boom"),
    });

    const notificador = createNotificadorAdapter({ config: makeConfig(), fetchFn, logEvent });

    const resultado = await notificador.notificarLinkConfirmacion(makeInput());

    expect(resultado).toEqual({ enviado: false, motivo: "http" });
    const fallo = calls.find((call) => call.event === "email-fallido");
    expect(fallo).toBeDefined();
    expect(fallo?.fields?.reason).toBe("http");
    expect(fallo?.fields?.status).toBe(500);
  });

  it("camino feliz: llama a fetchFn una vez y devuelve enviado:true", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse());

    const notificador = createNotificadorAdapter({ config: makeConfig(), fetchFn, logEvent });

    const resultado = await notificador.notificarLinkConfirmacion(makeInput());

    expect(resultado).toEqual({ enviado: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body?: string }];
    const body = JSON.parse(init.body ?? "{}") as { to: string; subject: string; html: string };
    expect(body.to).toBe(CLIENTE_EMAIL);
    expect(body.html).toContain(LINK);
  });

  it("clienteEmail vacio: enviado:false, motivo:sin-destinatario, sin llamar a fetchFn", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn();

    const notificador = createNotificadorAdapter({ config: makeConfig(), fetchFn, logEvent });

    const resultado = await notificador.notificarLinkConfirmacion(makeInput({ clienteEmail: "" }));

    expect(resultado).toEqual({ enviado: false, motivo: "sin-destinatario" });
    expect(fetchFn).not.toHaveBeenCalled();

    const fallo = calls.find((call) => call.event === "email-fallido");
    expect(fallo).toBeDefined();
    expect(fallo?.fields?.reason).toBe("sin-destinatario");
  });

  it("clienteEmail nunca aparece en ningun log, ni en el camino feliz ni en fallas", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse());

    const notificador = createNotificadorAdapter({ config: makeConfig(), fetchFn, logEvent });
    await notificador.notificarLinkConfirmacion(makeInput());

    const fetchFnFalla: FetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const notificadorFalla = createNotificadorAdapter({ config: makeConfig(), fetchFn: fetchFnFalla, logEvent });
    await notificadorFalla.notificarLinkConfirmacion(makeInput());

    assertNoPiiInCalls(calls);
  });

  it("config deshabilitada (apiKey vacio) delega en el no-op incluso llamando a createNotificadorAdapter directamente", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn();

    const notificador = createNotificadorAdapter({ config: makeConfig({ apiKey: "" }), fetchFn, logEvent });
    await notificador.notificarLinkConfirmacion(makeInput());

    expect(fetchFn).not.toHaveBeenCalled();
    expect(calls.some((call) => call.event === "email-omitido")).toBe(true);
  });
});
