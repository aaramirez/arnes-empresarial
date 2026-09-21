import { describe, expect, it, vi } from "vitest";
import { type A2AConfig, type DestinoA2AConfig, resolveA2AConfig } from "./config.js";
import { OPERACIONES_TIMEOUT_MS } from "../web/config.js";
import { configParaCanalConversacional } from "./config.js";
import { createA2AAdapter } from "./index.js";
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

/**
 * `SendMessageResponse` envuelve el `Task` bajo `result.task` — el `oneof
 * payload { Task task = 1; Message message = 2; }` REAL del protocolo
 * (verificado contra `specification/a2a.proto` del tag `v1.0.0` de
 * `a2aproject/A2A`, encontrado en la verificación manual de la tarea 23,
 * `docs/progreso/v2.2-a2a-cliente/verificacion-manual-tarea-23.md` §2.2). Esto
 * es DISTINTO de `taskResponse` (más abajo), que arma la respuesta de
 * `GetTask`/`CancelTask` — esos SÍ devuelven el `Task` plano en `result`,
 * confirmado con `curl` real contra el sample en el mismo reporte.
 */
function sendMessageTaskResponse(task: unknown): FetchResponseLike {
  return agentCardResponse({ jsonrpc: "2.0", id: 1, result: { task } });
}

/** Respuesta mínima de un `SendMessage` exitoso — el `Task` en sí no se inspecciona en esta tarea (tarea 5). */
function okSendMessageResponse(): FetchResponseLike {
  return sendMessageTaskResponse({ id: "task-1", status: { state: "TASK_STATE_SUBMITTED" } });
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

  it("baseUrl con barra final (normalizada por resolveA2AConfig, code-review hallazgo 1) NO produce doble barra en el GET del Agent Card", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [] }));
    const config = resolveA2AConfig({
      HARNESS_A2A_ENDPOINT_RIESGO_CREDITO: "https://agente.example.com/",
    });
    const destino = config.destinos["riesgo-credito"] as DestinoA2AConfig;

    await delegarTarea(
      { destino, clave: "riesgo-credito", tarea: "verificar riesgo", casoId: "caso-1" },
      makeDeps({ fetchFn, config }),
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

  it("con authToken configurado, el header Authorization sale también en el GET del Agent Card", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [] }));

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
    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe("Bearer token-secreto");
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

    expect(resultado).toEqual({
      ok: false,
      reason: "transporte",
      endpoint: ENTRADA_JSONRPC.url,
      detalle: "service unavailable",
    });
  });

  it("!response.ok en el POST de SendMessage con cuerpo largo trunca el detalle a ERROR_BODY_MAX_CHARS, igual que GetTask/CancelTask (code-review, hallazgo 2)", async () => {
    const cuerpoLargo = "x".repeat(600);
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(errorResponse(500, cuerpoLargo));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado.ok).toBe(false);
    const detalle = !resultado.ok ? resultado.detalle : undefined;
    expect(detalle).toBeDefined();
    expect(detalle?.length).toBe(503); // 500 + "..."
    expect(detalle?.startsWith("x".repeat(500))).toBe(true);
  });

  it("response.text() que rechaza en un SendMessage exitoso ⇒ reason: 'transporte', delegarTarea nunca rechaza", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.reject(new Error("stream cortado")) });

    await expect(
      delegarTarea(
        { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
        makeDeps({ fetchFn }),
      ),
    ).resolves.toEqual({ ok: false, reason: "transporte", endpoint: ENTRADA_JSONRPC.url });
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

  it("una respuesta real de SendMessage (result.task, no un Task plano en result) parsea correctamente y llega a COMPLETED sin necesitar ningún GetTask (verificación manual tarea 23 §2.2 — el bug real: antes de este fix, idDeTarea leía .id de {task:{...}} y devolvía undefined)", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC], name: "Agente de Riesgo" }),
      )
      .mockResolvedValueOnce(
        sendMessageTaskResponse({
          id: "task-1",
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [{ parts: [{ text: "listo" }] }],
        }),
      );

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({
      ok: true,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED",
      resultado: "listo",
      agenteNombre: "Agente de Riesgo",
      endpoint: ENTRADA_JSONRPC.url,
    });
    // Ningún GetTask: sólo Agent Card + SendMessage (2 llamadas).
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("result.message en vez de result.task (la otra rama real del oneof — agente sincrónico sin Task) ⇒ reason: 'protocolo', sin crashear, sin llegar al loop de polling (verificación manual tarea 23 §2.4)", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(
        agentCardResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            message: { messageId: "m-agente-1", role: "ROLE_AGENT", parts: [{ text: "respuesta directa" }] },
          },
        }),
      );

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.reason).toBe("protocolo");
    expect(!resultado.ok && resultado.endpoint).toBe(ENTRADA_JSONRPC.url);
    // Ningún GetTask: sólo Agent Card + SendMessage (2 llamadas) — nunca hay Task que trackear.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["cadena vacía", ""],
    ["sólo espacios", "   "],
  ])(
    "task.id: %j (código %s) ⇒ mismo resultado que task.id ausente: reason 'protocolo', sin a2aTaskId, sin llegar al loop de polling (code-review, hallazgo 3 — idDeTarea no debe aceptar un id en blanco como válido)",
    async (_label, idEnBlanco) => {
      const fetchFn: FetchFn = vi
        .fn()
        .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
        .mockResolvedValueOnce(
          sendMessageTaskResponse({ id: idEnBlanco, status: { state: "TASK_STATE_SUBMITTED" } }),
        );

      const resultado = await delegarTarea(
        { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
        makeDeps({ fetchFn }),
      );

      expect(resultado).toEqual({ ok: false, reason: "protocolo", endpoint: ENTRADA_JSONRPC.url });
      // Ningún GetTask: id inválido corta antes de entrar al loop de polling.
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );

  it("task.id ausente (sin campo id) ⇒ mismo resultado que task.id vacío, para comparación directa", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(sendMessageTaskResponse({ status: { state: "TASK_STATE_SUBMITTED" } }));

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    expect(resultado).toEqual({ ok: false, reason: "protocolo", endpoint: ENTRADA_JSONRPC.url });
  });
});

describe("delegarTarea — header A2A-Version (verificación manual tarea 23 §2.2 — a2a-sdk exige este header, ausente rompe con VERSION_NOT_SUPPORTED)", () => {
  it("el GET del Agent Card lleva A2A-Version: 1.0", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(agentCardResponse({ supportedInterfaces: [] }));

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers["A2A-Version"]).toBe("1.0");
  });

  it("el POST de SendMessage lleva A2A-Version: 1.0", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC] }))
      .mockResolvedValueOnce(okSendMessageResponse());

    await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      makeDeps({ fetchFn }),
    );

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const [, init] = mockFetch.mock.calls[1] as [string, { headers: Record<string, string> }];
    expect(init.headers["A2A-Version"]).toBe("1.0");
  });
});

/**
 * Fixture de esta tarea (Hito 6, tarea 5, design.md §6.2 parte 2): reloj y
 * sueño inyectados con **cero tiempo real** — `dormir` avanza un contador en
 * vez de esperar de verdad (ADR 81).
 */
function makeRelojFake(): { readonly ahoraMs: () => number; readonly dormir: (ms: number) => Promise<void> } {
  let ahora = 0;
  return {
    ahoraMs: () => ahora,
    dormir: (ms: number) => {
      ahora += ms;
      return Promise.resolve();
    },
  };
}

/** Respuesta de `GetTask`/`CancelTask`: el `Task` PLANO en `result` (sin envoltorio — a diferencia de `sendMessageTaskResponse`). */
function taskResponse(task: unknown): FetchResponseLike {
  return agentCardResponse({ jsonrpc: "2.0", id: 1, result: task });
}

function errorEnvelopeResponse(): FetchResponseLike {
  return agentCardResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "fallo del agente" } });
}

/** `error: null` explícito (algunos frameworks no estrictos serializan ambos campos) — sigue siendo éxito. */
function errorNuloEnvelopeResponse(task: unknown): FetchResponseLike {
  return agentCardResponse({ jsonrpc: "2.0", id: 1, result: task, error: null });
}

function taskSubmitted(): unknown {
  return { id: "task-1", status: { state: "TASK_STATE_SUBMITTED" } };
}

function taskWorking(): unknown {
  return { id: "task-1", status: { state: "TASK_STATE_WORKING" } };
}

function taskCompleted(overrides: Record<string, unknown> = {}): unknown {
  return { id: "task-1", status: { state: "TASK_STATE_COMPLETED" }, ...overrides };
}

/** Secuencia fija de respuestas para `fetchFn`: agent card, SendMessage, y N GetTask/CancelTask. */
function secuenciaFetch(respuestas: readonly FetchResponseLike[]): FetchFn {
  const mock = vi.fn();
  for (const respuesta of respuestas) {
    mock.mockResolvedValueOnce(respuesta);
  }
  return mock as unknown as FetchFn;
}

const CARD_JSONRPC = agentCardResponse({ supportedInterfaces: [ENTRADA_JSONRPC], name: "Agente de Riesgo" });

describe("delegarTarea — header A2A-Version, GetTask y CancelTask", () => {
  it("el POST de GetTask lleva A2A-Version: 1.0", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskCompleted()),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps);

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const getTaskCall = mockFetch.mock.calls.find(([, init]) => {
      const body = JSON.parse((init as { body?: string }).body ?? "{}") as { method?: string };
      return body.method === "GetTask";
    }) as [string, { headers: Record<string, string> }] | undefined;
    expect(getTaskCall?.[1].headers["A2A-Version"]).toBe("1.0");
  });

  it("el POST de CancelTask lleva A2A-Version: 1.0", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskWorking()),
      taskResponse(taskCompleted()), // respuesta de CancelTask
    ]);
    const deps = makeDeps({ fetchFn, config, ...reloj });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps);

    const mockFetch = fetchFn as ReturnType<typeof vi.fn>;
    const buscarCancelCall = () =>
      mockFetch.mock.calls.find(([, init]) => {
        const body = JSON.parse((init as { body?: string }).body ?? "{}") as { method?: string };
        return body.method === "CancelTask";
      });
    await vi.waitFor(() => {
      expect(buscarCancelCall()).toBeDefined();
    });
    const cancelCall = buscarCancelCall() as [string, { headers: Record<string, string> }] | undefined;
    expect(cancelCall?.[1].headers["A2A-Version"]).toBe("1.0");
  });
});

describe("delegarTarea — loop de GetTask", () => {
  it("SendMessage se envía una sola vez, sin importar cuántos GetTask se hagan", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskCompleted()),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps);

    const sendMessageCalls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => {
      const body = JSON.parse((init as { body?: string }).body ?? "{}") as { method?: string };
      return body.method === "SendMessage";
    });
    expect(sendMessageCalls).toHaveLength(1);
  });

  it("el intervalo entre cada GetTask sucesivo es exactamente pollIntervalMs, sin tiempo real", async () => {
    const reloj = makeRelojFake();
    const marcasDeTiempo: number[] = [];
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskWorking()),
      taskResponse(taskCompleted()),
    ]);
    const fetchFnConMarca: FetchFn = (url, init) => {
      const body = JSON.parse((init as { body?: string }).body ?? "{}") as { method?: string };
      if (body.method === "GetTask") {
        marcasDeTiempo.push(reloj.ahoraMs());
      }
      return (fetchFn as FetchFn)(url, init);
    };
    const deps = makeDeps({ fetchFn: fetchFnConMarca, ...reloj });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps);

    expect(marcasDeTiempo).toEqual([1_500, 3_000]);
  });

  it("estado terminal (COMPLETED) en la 3ª consulta corta el loop — no hay 4ª", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskSubmitted()),
      taskResponse(taskWorking()),
      taskResponse(taskCompleted({ artifacts: [{ parts: [{ text: "listo" }] }] })),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado).toEqual({
      ok: true,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED",
      resultado: "listo",
      agenteNombre: "Agente de Riesgo",
      endpoint: ENTRADA_JSONRPC.url,
    });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
  });

  it("nunca alcanza estado terminal ⇒ agota el timeout total, intenta CancelTask una vez, y reporta el último estado conocido", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 3_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(500, "GetTask caído"),
      errorResponse(500, "GetTask caído"),
      errorResponse(500, "GetTask caído"),
      taskResponse(taskCompleted()), // respuesta a CancelTask (no afecta el desenlace)
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      reason: "timeout",
      estado: "TASK_STATE_SUBMITTED",
      a2aTaskId: "task-1",
      endpoint: ENTRADA_JSONRPC.url,
      // Último `detalle` truncado de los tres polls fallidos por transporte —
      // ya no muere en el `logEvent`, llega hasta el `ResultadoA2A` final
      // (post-review PR2, Hallazgo 2).
      detalle: "GetTask caído",
    });
    // `CancelTask` ahora se dispara sin esperarlo (Hallazgo 4) — la llamada a
    // `fetchFn` ocurre síncronamente dentro de `intentarCancelTask` antes de
    // su primer `await`, así que ya está registrada acá.
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6);

    // El `logEvent("a2a-cancel-intentado", ...)` sólo se dispara DESPUÉS de
    // que `consultarOControlarTarea` resuelve — como ya no se espera antes de
    // retornar, hace falta flushear microtasks (Hallazgo 4).
    await vi.waitFor(() => {
      expect(logEvent.mock.calls.some(([, evento]) => evento === "a2a-cancel-intentado")).toBe(true);
    });
    const cancelCall = logEvent.mock.calls.find(([, evento]) => evento === "a2a-cancel-intentado");
    expect(cancelCall?.[2]).toEqual({ a2aTaskId: "task-1", ok: true });

    const pollFallidoCalls = logEvent.mock.calls.filter(([, evento]) => evento === "a2a-poll-fallido");
    expect(pollFallidoCalls).toHaveLength(3);
  });

  it("un GetTask que falla por transporte no corta el loop y sigue hasta el deadline", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(503, "temporal"), // GetTask #1 falla por transporte
      taskResponse(taskWorking()), // GetTask #2 responde bien — el loop siguió
      taskResponse(taskCompleted({ artifacts: [{ parts: [{ text: "ok" }] }] })), // GetTask #3
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado.ok).toBe(true);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
  });

  it("response.text() que rechaza en un GetTask exitoso (response.ok) no corta el loop y delegarTarea nunca rechaza", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      { ok: true, status: 200, text: () => Promise.reject(new Error("stream cortado")) }, // GetTask #1
      taskResponse(taskCompleted({ artifacts: [{ parts: [{ text: "ok" }] }] })), // GetTask #2
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    await expect(
      delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps),
    ).resolves.toEqual({
      ok: true,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED",
      resultado: "ok",
      agenteNombre: "Agente de Riesgo",
      endpoint: ENTRADA_JSONRPC.url,
    });
  });

  it("sobre JSON-RPC con 'error' en GetTask clasifica como protocolo y corta el loop", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([CARD_JSONRPC, sendMessageTaskResponse(taskSubmitted()), errorEnvelopeResponse()]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      reason: "protocolo",
      endpoint: ENTRADA_JSONRPC.url,
      a2aTaskId: "task-1",
    });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("sobre JSON-RPC con 'error: null' explícito clasifica como éxito, no como protocolo", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorNuloEnvelopeResponse(taskCompleted()),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado.ok).toBe(true);
  });

  it.each(["ESTADO_INVENTADO", "TASK_STATE_UNSPECIFIED"])(
    "status.state desconocido (%s) clasifica como protocolo, sin excepción",
    async (estadoDesconocido) => {
      const reloj = makeRelojFake();
      const fetchFn = secuenciaFetch([
        CARD_JSONRPC,
        sendMessageTaskResponse(taskSubmitted()),
        taskResponse({ id: "task-1", status: { state: estadoDesconocido } }),
      ]);
      const deps = makeDeps({ fetchFn, ...reloj });

      const resultado = await delegarTarea(
        { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
        deps,
      );

      expect(resultado).toEqual({
        ok: false,
        reason: "protocolo",
        endpoint: ENTRADA_JSONRPC.url,
        a2aTaskId: "task-1",
      });
    },
  );

  it("campos extra desconocidos junto a un status.state válido se ignoran y el loop sigue", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse({ id: "task-1", status: { state: "TASK_STATE_SUBMITTED" }, campoExtraDesconocido: { x: 1 } }),
      taskResponse(taskCompleted()),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado.ok).toBe(true);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it("cuerpo de error de un GetTask con más de 500 caracteres se trunca y sobrevive en el resultado final de timeout, pero NUNCA se loguea crudo en a2a-poll-fallido (code-review, hallazgo 3)", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const cuerpoLargo = "x".repeat(600);
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(500, cuerpoLargo),
      taskResponse(taskCompleted()), // respuesta de CancelTask
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    const pollFallido = logEvent.mock.calls.find(([, evento]) => evento === "a2a-poll-fallido");
    expect(pollFallido).toBeDefined();
    expect(pollFallido?.[2]).not.toHaveProperty("detalle");

    expect(resultado.ok).toBe(false);
    const detalle = !resultado.ok ? resultado.detalle : undefined;
    expect(detalle).toBeDefined();
    expect(detalle?.length).toBe(503); // 500 + "..."
    expect(detalle?.startsWith("x".repeat(500))).toBe(true);
  });

  it("cuerpo de error de un GetTask con menos de 500 caracteres sobrevive completo en el resultado final, pero NUNCA se loguea en a2a-poll-fallido (code-review, hallazgo 3)", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const cuerpoCorto = "detalle corto del error";
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(500, cuerpoCorto),
      taskResponse(taskCompleted()), // respuesta de CancelTask
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    const pollFallido = logEvent.mock.calls.find(([, evento]) => evento === "a2a-poll-fallido");
    expect(pollFallido).toBeDefined();
    expect(pollFallido?.[2]).not.toHaveProperty("detalle");

    expect(resultado.ok).toBe(false);
    const detalle = !resultado.ok ? resultado.detalle : undefined;
    expect(detalle).toBe(cuerpoCorto);
  });

  it("un cuerpo de error del GetTask con contenido sensible NUNCA aparece en el evento a2a-poll-fallido, ni siquiera cuando el loop se recupera después (code-review, hallazgo 3)", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 5_000 });
    const cuerpoSensible = "Authorization: Bearer secreto-super-sensible-no-debe-loguearse";
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(500, cuerpoSensible), // GetTask #1 falla por transporte, cuerpo sensible
      taskResponse(taskWorking()), // GetTask #2 — el loop se recupera
      taskResponse(taskCompleted({ artifacts: [{ parts: [{ text: "ok" }] }] })), // GetTask #3
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    await delegarTarea({ destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" }, deps);

    const pollFallido = logEvent.mock.calls.find(([, evento]) => evento === "a2a-poll-fallido");
    expect(pollFallido).toBeDefined();
    expect(pollFallido?.[2]).not.toHaveProperty("detalle");
    expect(pollFallido?.[2]).toEqual({ a2aTaskId: "task-1", reason: "transporte", intento: 1 });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("secreto-super-sensible");
  });
});

describe("delegarTarea — extracción del texto de resultado", () => {
  it("concatena las partes 'text' de artifacts[*].parts[*]", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(
        taskCompleted({
          artifacts: [{ parts: [{ text: "Resultado: " }, { text: "todo bien" }] }],
        }),
      ),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.resultado).toBe("Resultado: todo bien");
  });

  it("sin artifacts, cae al último Message de status.message", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse({
        id: "task-1",
        status: { state: "TASK_STATE_COMPLETED", message: { parts: [{ text: "mensaje final" }] } },
      }),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.resultado).toBe("mensaje final");
  });

  it("sin artifacts y sin Message ⇒ resultado vacío, y el desenlace sigue siendo éxito", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskCompleted()),
    ]);
    const deps = makeDeps({ fetchFn, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    expect(resultado).toEqual({
      ok: true,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED",
      resultado: "",
      agenteNombre: "Agente de Riesgo",
      endpoint: ENTRADA_JSONRPC.url,
    });
  });
});

describe("delegarTarea — el Authorization nunca aparece en un mensaje, detalle o logEvent", () => {
  const TOKEN = "token-secreto";
  const DESTINO_CON_TOKEN: DestinoA2AConfig = { baseUrl: DESTINO.baseUrl, authToken: TOKEN };

  function assertSinFuga(resultado: unknown, fetchFn: FetchFn, logEvent: ReturnType<typeof vi.fn>): void {
    const llamadas = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const llamadasConHeaders = llamadas.filter(([, init]) => (init as { headers?: Record<string, string> }).headers);
    for (const [, init] of llamadasConHeaders) {
      const headers = (init as { headers: Record<string, string> }).headers;
      if (headers.Authorization !== undefined) {
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      }
    }
    expect(JSON.stringify(resultado)).not.toContain(TOKEN);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(TOKEN);
  }

  it("forma 1: GetTask falla por red (transporte) hasta agotar el timeout", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskCompleted()),
    ]);
    const fetchFnQueRechaza = vi.fn(async (url: string, init: Parameters<FetchFn>[1]) => {
      const body = JSON.parse(init.body ?? "{}") as { method?: string };
      if (body.method === "GetTask") {
        throw new Error("fetch failed");
      }
      return (fetchFn as FetchFn)(url, init);
    }) as unknown as FetchFn;
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn: fetchFnQueRechaza, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFnQueRechaza, logEvent);
  });

  it("forma 2: GetTask responde !response.ok con cuerpo de error", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      errorResponse(500, "el agente no responde"),
      taskResponse(taskCompleted()),
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFn, logEvent);
  });

  it("forma 3: sobre JSON-RPC de GetTask con 'error' ⇒ protocolo", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([CARD_JSONRPC, sendMessageTaskResponse(taskSubmitted()), errorEnvelopeResponse()]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFn, logEvent);
  });

  it("forma 4: status.state desconocido en GetTask ⇒ protocolo", async () => {
    const reloj = makeRelojFake();
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse({ id: "task-1", status: { state: "ESTADO_INVENTADO" } }),
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFn, logEvent);
  });

  it("forma 5: timeout total agotado con CancelTask exitoso", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskWorking()),
      taskResponse(taskCompleted()), // respuesta de CancelTask (best-effort, éxito)
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFn, logEvent);
  });

  it("forma 6: timeout total agotado con CancelTask fallido", async () => {
    const reloj = makeRelojFake();
    const config = makeConfig({ pollIntervalMs: 1_000, taskTimeoutMs: 1_000 });
    const fetchFn = secuenciaFetch([
      CARD_JSONRPC,
      sendMessageTaskResponse(taskSubmitted()),
      taskResponse(taskWorking()),
      errorResponse(500, "no se pudo cancelar"), // CancelTask falla
    ]);
    const logEvent = vi.fn();
    const deps = makeDeps({ fetchFn, config, logEvent, ...reloj });

    const resultado = await delegarTarea(
      { destino: DESTINO_CON_TOKEN, clave: "riesgo-credito", tarea: "t", casoId: "caso-1" },
      deps,
    );

    assertSinFuga(resultado, fetchFn, logEvent);
    expect(resultado).toEqual({
      ok: false,
      reason: "timeout",
      estado: "TASK_STATE_WORKING",
      a2aTaskId: "task-1",
      endpoint: ENTRADA_JSONRPC.url,
    });
  });
});

describe("createA2AAdapter con configParaCanalConversacional — test 2c (consulta-kpi-a2a-chat, ADR 245)", () => {
  it("un agente que responde WORKING para siempre resuelve timeout UNA vez, en tiempo virtual acotado a la mitad del plazo HTTP", async () => {
    const reloj = makeRelojFake();
    const base = resolveA2AConfig({ HARNESS_A2A_ENDPOINT_KPI_INCIDENTE: "https://agente.example.com" });
    const fetchFn = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { method?: string };
      if (body.method === "SendMessage") {
        return sendMessageTaskResponse(taskSubmitted());
      }
      if (body.method === "GetTask" || body.method === "CancelTask") {
        return taskResponse(taskWorking());
      }
      return CARD_JSONRPC;
    }) as unknown as FetchFn;
    const cliente = createA2AAdapter({
      config: configParaCanalConversacional(base),
      fetchFn,
      ahoraMs: reloj.ahoraMs,
      dormir: reloj.dormir,
      logEvent: vi.fn(),
    });

    let resoluciones = 0;
    const resultado = await cliente
      .delegar({ clave: "kpi-incidente", tarea: "t", casoId: "caso-1" })
      .then((r) => {
        resoluciones += 1;
        return r;
      });
    await Promise.resolve();

    expect(resultado).toMatchObject({ ok: false, reason: "timeout" });
    expect(resoluciones).toBe(1);
    expect(reloj.ahoraMs()).toBeGreaterThan(0);
    expect(reloj.ahoraMs()).toBeLessThanOrEqual(OPERACIONES_TIMEOUT_MS / 2);
  });
});
