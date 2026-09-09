import { describe, expect, it, vi } from "vitest";
import type { A2AConfig, DestinoA2AConfig } from "./config.js";
import { type A2AClientDeps, type FetchFn, type FetchResponseLike, delegarTarea } from "./client.js";

/**
 * Fixture de este change (Hito 6, tarea 4, design.md §6.2 parte 1): `FetchFn`
 * fake, mismo molde que `github-client.test.ts`/`email-client.test.ts`. Sin
 * reloj/sueño inyectados todavía porque acá no hay loop (tarea 5 los agrega).
 */
function agentCardResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function errorResponse(status: number, bodyText: string): FetchResponseLike {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(bodyText),
  };
}

/** Respuesta mínima de un `SendMessage` exitoso — el `Task` en sí no se inspecciona en esta tarea (tarea 5). */
function okSendMessageResponse(): FetchResponseLike {
  return agentCardResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { id: "task-1", status: { state: "TASK_STATE_SUBMITTED" } },
  });
}

function makeConfig(overrides: Partial<A2AConfig> = {}): A2AConfig {
  return {
    requestTimeoutMs: 10_000,
    pollIntervalMs: 1_500,
    taskTimeoutMs: 120_000,
    destinos: { "riesgo-credito": undefined, "kpi-incidente": undefined },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<A2AClientDeps> = {}): A2AClientDeps {
  return {
    config: makeConfig(),
    fetchFn: vi.fn(),
    logEvent: vi.fn(),
    ahoraMs: () => 0,
    dormir: () => Promise.resolve(),
    newMessageId: () => "uuid-fijo",
    ...overrides,
  };
}

const DESTINO: DestinoA2AConfig = { baseUrl: "https://agente.example.com" };

const ENTRADA_JSONRPC = {
  url: "https://agente.example.com/a2a/v1",
  protocolBinding: "JSONRPC",
  protocolVersion: "1.0",
} as const;

const ENTRADA_GRPC = {
  url: "https://agente.example.com/a2a/grpc",
  protocolBinding: "GRPC",
  protocolVersion: "1.0",
} as const;

describe("delegarTarea — Agent Card", () => {
  it("busca el Agent Card en la URL bien conocida exacta", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [] }));

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "verificar riesgo", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://agente.example.com/.well-known/agent-card.json",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("usa el url de la primera entrada JSONRPC del Agent Card como endpoint del SendMessage POST", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(okSendMessageResponse());

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "verificar riesgo", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      ENTRADA_JSONRPC.url,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("usa la entrada JSONRPC aunque no sea la primera del array", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_GRPC, ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(okSendMessageResponse());

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "verificar riesgo", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      ENTRADA_JSONRPC.url,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("dos delegaciones consecutivas hacen DOS GET del Agent Card, sin caché", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [] }));
    const deps = makeDeps({ fetchFn });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t1", casoId: "caso-1" }, deps);
    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t2", casoId: "caso-2" }, deps);

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const getCalls = mockFetch.mock.calls.filter(
      ([, init]) => (init as { method: string }).method === "GET",
    );
    expect(getCalls).toHaveLength(2);
  });

  it("red caída en el GET del Agent Card ⇒ reason: 'transporte', sin ningún POST", async () => {
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "transporte" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("Agent Card inaccesible (!response.ok) ⇒ reason: 'transporte', sin ningún POST", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(errorResponse(500, "internal error"));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "transporte" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("card sin supportedInterfaces ⇒ reason: 'protocolo', sin SendMessage", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({}));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "protocolo" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("supportedInterfaces sin ninguna entrada JSONRPC ⇒ reason: 'protocolo', sin SendMessage", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [ENTRADA_GRPC] }));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "protocolo" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("delegarTarea — SendMessage", () => {
  it("el sobre tiene method exactamente 'SendMessage', sin prefijo 'a2a/'", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(okSendMessageResponse());

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "verificar riesgo del caso 1", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const [, init] = mockFetch.mock.calls[1] as [string, { body?: string }];
    const sentBody = JSON.parse(init.body ?? "{}") as {
      readonly jsonrpc: string;
      readonly method: string;
      readonly params: {
        readonly message: {
          readonly messageId: string;
          readonly role: string;
          readonly parts: readonly { readonly text: string }[];
        };
      };
    };

    expect(sentBody.jsonrpc).toBe("2.0");
    expect(sentBody.method).toBe("SendMessage");
    expect(sentBody.params.message.role).toBe("ROLE_USER");
    expect(sentBody.params.message.parts).toEqual([{ text: "verificar riesgo del caso 1" }]);
    expect(sentBody.params.message.messageId).toBe("uuid-fijo");
  });

  it("red caída en el POST de SendMessage ⇒ reason: 'transporte', con el endpoint efectivo", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockRejectedValueOnce(new Error("fetch failed"));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "transporte", endpoint: ENTRADA_JSONRPC.url });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("!response.ok en el POST de SendMessage ⇒ reason: 'transporte', con el endpoint efectivo", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(errorResponse(503, "service unavailable"));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "transporte", endpoint: ENTRADA_JSONRPC.url });
  });

  it("con authToken configurado, el header Authorization sale en el POST de SendMessage", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(okSendMessageResponse());

    await delegarTarea(
      {
        destino: { baseUrl: DESTINO.baseUrl, authToken: "token-secreto" },
        clave: "riesgo-credito",
        tarea: "t",
        casoId: "caso-1",
      },
      makeDeps({ fetchFn }),
    );

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const [, init] = mockFetch.mock.calls[1] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe("Bearer token-secreto");
  });
});
