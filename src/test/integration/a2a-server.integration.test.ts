/**
 * Integration test for the Servidor A2A entrante (Hito 7, tarea 17, design.md
 * §10.D) — el ÚNICO archivo del suite por defecto que abre un puerto real
 * (regla del change, design.md §10, `webhooks/server.ts:249`). A diferencia
 * de `a2a-client.integration.test.ts` (Hito 6), acá cliente Y servidor son
 * AMBOS nuestros — `delegarTarea` de `client.ts` contra `startA2AServer` en
 * un puerto efímero — así que este archivo corre siempre en CI, sin
 * `describe.skipIf` y sin degradar nunca a `skip`.
 *
 * `handleTurn` se sustituye por un doble a nivel del composition root
 * (`vi.mock` de `handle-turn.js`, molde EXACTO de
 * `build-on-a2a-entrante.test.ts`): lo que este archivo prueba es el
 * PROTOCOLO — el `Task` que arma `server.ts` es realmente el que
 * `client.ts` sabe parsear, con un socket TCP real en el medio y el loop de
 * `GetTask` corriendo con timers reales (no con reloj inyectado) — no el
 * comportamiento del modelo.
 *
 * **Puerto efímero y `publicUrl`** (decisión de esta fase, no del diseño):
 * `startA2AServer` arma el Agent Card con `config.publicUrl` — fijo en el
 * momento de construir la config — y el Cliente A2A del Hito 6 seguirá,
 * literal, la URL que ese card declara para el `POST` de los tres métodos
 * JSON-RPC (`extraerEndpointJsonRpc`, `client.ts:194-212`). Con `port: 0`
 * puro, el puerto real sólo se conoce DESPUÉS de `listen()` (ADR 101), pero
 * `publicUrl` tiene que estar listo ANTES de esa llamada para que el card
 * declare la URL correcta — un verdadero orden-de-dependencia circular si se
 * intenta resolver en un solo paso. `obtenerPuertoEfimero` lo resuelve en
 * DOS pasos, mismo truco que usan `get-port`/`supertest`: abre un socket TCP
 * descartable en el puerto `0` (el SO asigna uno libre), lee `address().port`,
 * lo cierra, y ese mismo número —ya no `0`— se pasa como `config.port` al
 * servidor real. `startServer` (`server.ts:751-825`) sigue leyendo el puerto
 * EFECTIVO de `server.address()` en ambos casos (ADR 101 no distingue si el
 * valor configurado era `0` o no — siempre confía en `address()`, nunca en
 * `deps.config.port` salvo que el doble de test no implemente `address()`),
 * así que el camino de producción que este test ejercita es exactamente el
 * mismo. Ninguna línea de `src/adapters/a2a/` se tocó para esto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import { startA2AServer, type A2AServerAdapter } from "../../adapters/a2a/server-index.js";
import {
  DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES,
  DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO,
  RUTA_JSONRPC,
  JSONRPC_METHOD_NOT_FOUND,
  type A2AServerConfig,
} from "../../adapters/a2a/server-config.js";
import { type A2AClientDeps, type FetchFn, delegarTarea } from "../../adapters/a2a/client.js";
import type { A2AConfig, DestinoA2AConfig } from "../../adapters/a2a/config.js";
import {
  DESTINO_A2A_RIESGO_CREDITO,
  TASK_STATE_COMPLETED,
  TASK_STATE_SUBMITTED,
  type ResultadoA2A,
} from "../../core/agents/a2a-contract.js";
import { buildOnA2AEntrante } from "../../build-on-a2a-entrante.js";
import { buildOnActivity } from "../../build-on-activity.js";
import {
  ACTIVIDAD_TIPO_PR_REVIEW,
  type ActivityBoardPort,
  type IncomingActivityEvent,
} from "../../core/activity/activity-contract.js";
import { createKeyedQueue } from "../../core/concurrency/keyed-queue.js";
import { createHookEngine } from "../../core/hooks/hook-engine.js";
import { DEFAULT_AGENT_MODEL, type AgentDefinition } from "../../core/agents/definitions.js";
import type { MemoryPort, HandleTurnResult } from "../../core/turn-selector/handle-turn.js";
import type { KnowledgeAdapter } from "../../adapters/knowledge/index.js";

vi.mock("../../core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

import { handleTurn } from "../../core/turn-selector/handle-turn.js";

const mockedHandleTurn = vi.mocked(handleTurn);

const TOKEN = "test-token";

function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn(),
    getLatestSesionAgente: vi.fn(),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

function makeAgent(): AgentDefinition {
  return {
    id: "agente-conversacional",
    description: "agente de prueba",
    systemPrompt: "system prompt de prueba",
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

function makeFakeKnowledge(): (casoId: string) => KnowledgeAdapter {
  return vi.fn(
    (): KnowledgeAdapter => ({
      mcpServers: {},
      feedback: {
        saveTurnResult: vi.fn().mockResolvedValue(undefined),
        discardPendingCitations: vi.fn(),
      },
    }),
  );
}

/**
 * PASO 1 del truco de dos pasos (ver module doc): abre un socket TCP en el
 * puerto `0`, deja que el SO asigne uno libre, lo lee y lo cierra de
 * inmediato — el mismo número se reusa como `config.port` real un instante
 * después, en el mismo proceso, sin que nada más lo tome en el medio.
 */
async function obtenerPuertoEfimero(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sonda = createNetServer();
    sonda.once("error", reject);
    sonda.listen(0, "127.0.0.1", () => {
      const direccion = sonda.address();
      sonda.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (typeof direccion === "object" && direccion !== null) {
          resolve(direccion.port);
        } else {
          reject(new Error("no se pudo obtener un puerto efimero de prueba"));
        }
      });
    });
  });
}

interface ServidorDePrueba {
  readonly servidor: A2AServerAdapter;
  readonly db: Database.Database;
}

/** Servidores/bases abiertos por el test en curso — `afterEach` los cierra a todos, en cualquier orden de fallo. */
const activos: ServidorDePrueba[] = [];

async function iniciarServidorDePrueba(
  overrides: Partial<A2AServerConfig> = {},
): Promise<ServidorDePrueba> {
  const db = openDatabase(":memory:");
  const port = overrides.port ?? (await obtenerPuertoEfimero());
  const publicUrl = overrides.publicUrl ?? `http://127.0.0.1:${port}`;

  const handlers = buildOnA2AEntrante({
    db,
    memory: fakeMemory(),
    hooks: createHookEngine(),
    agents: [makeAgent()],
    createKnowledge: makeFakeKnowledge(),
  });

  const config: A2AServerConfig = {
    token: TOKEN,
    port,
    publicUrl,
    maxBodyBytes: DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES,
    maxEnVuelo: DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO,
    ...overrides,
  };

  const servidor = await startA2AServer({ ...handlers, config, logEvent: () => {} });
  if (servidor === undefined) {
    db.close();
    throw new Error("se esperaba un Servidor A2A real (token no vacío) — startA2AServer devolvió undefined");
  }

  const registro: ServidorDePrueba = { servidor, db };
  activos.push(registro);
  return registro;
}

/** Deps del Cliente A2A del Hito 6 con timers REALES (ADR 81 default), sólo con intervalos acortados para que el test sea rápido. */
function clientDeps(overrides: Partial<A2AConfig> = {}): A2AClientDeps {
  const config: A2AConfig = {
    requestTimeoutMs: overrides.requestTimeoutMs ?? 5_000,
    pollIntervalMs: overrides.pollIntervalMs ?? 20,
    taskTimeoutMs: overrides.taskTimeoutMs ?? 4_000,
    destinos: { "riesgo-credito": undefined, "kpi-incidente": undefined },
  };
  return {
    config,
    fetchFn: globalThis.fetch as FetchFn,
    logEvent: () => {},
    ahoraMs: () => Date.now(),
    dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newMessageId: () => randomUUID(),
  };
}

function destinoDe(servidor: A2AServerAdapter, authToken = TOKEN): DestinoA2AConfig {
  return { baseUrl: `http://127.0.0.1:${servidor.port}`, authToken };
}

beforeEach(() => {
  mockedHandleTurn.mockReset();
});

afterEach(async () => {
  while (activos.length > 0) {
    const registro = activos.pop();
    if (registro === undefined) {
      continue;
    }
    await registro.servidor.close();
    registro.db.close();
  }
});

describe("Servidor A2A entrante — integración real contra el Cliente A2A del Hito 6 (Hito 7, tarea 17, design.md §10.D)", () => {
  it(
    "ciclo completo: GET del card (implícito) -> SendMessage -> loop REAL de GetTask (timers reales) -> TASK_STATE_COMPLETED con el texto",
    async () => {
      const { servidor } = await iniciarServidorDePrueba();
      const textoResultado = "respuesta del arnés vía A2A entrante";
      mockedHandleTurn.mockImplementationOnce(
        () =>
          new Promise<HandleTurnResult>((resolve) => {
            // Delay real (no reloj inyectado): fuerza al menos una vuelta
            // genuina del loop de `GetTask` contra el socket, no una
            // resolución instantánea que nunca ejercite el polling.
            setTimeout(() => resolve({ responseText: textoResultado, agentLabel: "agente-conversacional" }), 40);
          }),
      );

      const resultado = await delegarTarea(
        {
          destino: destinoDe(servidor),
          // `DESTINOS_A2A` no se toca (verificado en client.ts): `clave` sólo
          // se usa para logging del lado cliente, nunca para resolver `destino`.
          clave: DESTINO_A2A_RIESGO_CREDITO,
          tarea: "¿cuál es el estado del pedido 123?",
          casoId: "caso-test-integracion-ciclo-completo",
        },
        clientDeps(),
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) {
        throw new Error(`se esperaba éxito, se obtuvo: ${JSON.stringify(resultado)}`);
      }
      expect(resultado.estado).toBe(TASK_STATE_COMPLETED);
      expect(resultado.resultado).toBe(textoResultado);
      expect(typeof resultado.a2aTaskId).toBe("string");
    },
    10_000,
  );

  it("token equivocado ⇒ reason: 'transporte' (401 en SendMessage; el card se sirve igual, sin auth)", async () => {
    const { servidor } = await iniciarServidorDePrueba();

    const resultado = await delegarTarea(
      {
        destino: destinoDe(servidor, "token-incorrecto"),
        clave: DESTINO_A2A_RIESGO_CREDITO,
        tarea: "no debería llegar a ningún lado",
        casoId: "caso-test-integracion-token-malo",
      },
      clientDeps(),
    );

    expect(resultado.ok).toBe(false);
    if (resultado.ok) {
      throw new Error("unreachable");
    }
    expect(resultado.reason).toBe("transporte");
    expect(mockedHandleTurn).not.toHaveBeenCalled();
  });

  it("tope de turnos en vuelo superado ⇒ el segundo SendMessage llega a reason: 'rejected' sin una línea nueva del lado cliente", async () => {
    const { servidor } = await iniciarServidorDePrueba({ maxEnVuelo: 1 });
    let liberarTurno: (() => void) | undefined;
    mockedHandleTurn.mockImplementationOnce(
      () =>
        new Promise<HandleTurnResult>((resolve) => {
          liberarTurno = () => resolve({ responseText: "no importa", agentLabel: "agente-conversacional" });
        }),
    );

    // Primer `SendMessage`, con `fetch` crudo: ocupa el único cupo, SIN
    // esperar a que el turno termine (`handleTurn` queda colgado a propósito).
    const primeraRespuesta = await fetch(`${destinoDe(servidor).baseUrl}${RUTA_JSONRPC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: { message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: "ocupa el único cupo" }] } },
      }),
    });
    // `SendMessage` responde `result: { task: Task }` — el `oneof` REAL del
    // protocolo (`respondJsonRpcSendMessageResult`, `server.ts`), a
    // diferencia de `GetTask`/`CancelTask`, que traen el `Task` directo.
    const primerSobre = (await primeraRespuesta.json()) as {
      readonly result: { readonly task: { readonly status: { readonly state: string } } };
    };
    expect(primerSobre.result.task.status.state).toBe(TASK_STATE_SUBMITTED);

    // Segundo, vía el Cliente A2A REAL del Hito 6: sin cupo, `REJECTED` ya
    // viene en la respuesta del `SendMessage` — `delegarTarea` lo reconoce
    // como terminal de fracaso desde el primer chequeo, sin poll-ear ni una
    // vez (`esTerminalDeFracaso`, `client.ts:618-622`) — ninguna línea nueva
    // del lado cliente para este caso.
    const resultado = await delegarTarea(
      {
        destino: destinoDe(servidor),
        clave: DESTINO_A2A_RIESGO_CREDITO,
        tarea: "no hay cupo para esta",
        casoId: "caso-test-integracion-sin-cupo",
      },
      clientDeps(),
    );

    expect(resultado.ok).toBe(false);
    if (resultado.ok) {
      throw new Error("unreachable");
    }
    expect(resultado.reason).toBe("rejected");

    // Deja asentar el primer turno antes de que `afterEach` cierre el
    // servidor — evita depender del drenaje con techo (`A2A_CLOSE_TIMEOUT_MS`)
    // sólo para la higiene del test.
    liberarTurno?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("method inválido enviado con fetch crudo ⇒ -32601 (JSONRPC_METHOD_NOT_FOUND), status HTTP 200", async () => {
    const { servidor } = await iniciarServidorDePrueba();

    const respuesta = await fetch(`${destinoDe(servidor).baseUrl}${RUTA_JSONRPC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ListTasks", params: {} }),
    });

    expect(respuesta.status).toBe(200);
    const sobre = (await respuesta.json()) as { readonly error: { readonly code: number } };
    expect(sobre.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });
});

describe("Servidor A2A entrante — concurrencia real: N SendMessage + un turno de actividad de webhook sobre el mismo proyectoId (Riesgo 2, ADR 90 pto 7)", () => {
  const previoRoles = process.env.HARNESS_DELEGACION_ROLES;
  const previoEscritura = process.env.HARNESS_ESCRITURA_DELEGADA;

  beforeEach(() => {
    // Molde de `build-on-activity.test.ts`: ambos interruptores en "off" para
    // que `buildOnActivity` use el `handleTurn` único de v1.4.0 (mockeado,
    // igual que del lado A2A) y NUNCA toque `git` real vía `createGitAdapter`.
    process.env.HARNESS_DELEGACION_ROLES = "off";
    process.env.HARNESS_ESCRITURA_DELEGADA = "off";
  });

  afterEach(() => {
    if (previoRoles === undefined) {
      delete process.env.HARNESS_DELEGACION_ROLES;
    } else {
      process.env.HARNESS_DELEGACION_ROLES = previoRoles;
    }
    if (previoEscritura === undefined) {
      delete process.env.HARNESS_ESCRITURA_DELEGADA;
    } else {
      process.env.HARNESS_ESCRITURA_DELEGADA = previoEscritura;
    }
  });

  it(
    "3 SendMessage concurrentes + 1 turno de actividad de webhook sobre el mismo proyectoId: ninguna fila inconsistente, ninguna fuente bloquea a la otra",
    async () => {
      const { servidor, db } = await iniciarServidorDePrueba();
      const N = 3;
      const DELAY_MS = 120;

      // Mismo `handleTurn` mockeado (mismo módulo, `vi.mock` único de arriba)
      // sirve a las DOS fuentes: el turno A2A entrante (`build-on-a2a-entrante.ts`)
      // y el turno de actividad del webhook (`build-on-activity.ts`, con los
      // roles apagados). Un delay real e idéntico para ambas fuentes es lo
      // que hace que el tiempo total sea evidencia de entrelazado real y no
      // sólo del resultado final (design.md §10.C).
      mockedHandleTurn.mockImplementation(
        (casoId: string) =>
          new Promise<HandleTurnResult>((resolve) => {
            setTimeout(() => resolve({ responseText: `respuesta-${casoId}`, agentLabel: "agente-conversacional" }), DELAY_MS);
          }),
      );

      const board: ActivityBoardPort = {
        leerMetadatos: vi.fn(async () => undefined),
        publicarRevision: vi.fn(async () => undefined),
        mirrorEstado: vi.fn(async () => undefined),
      };
      const activityHandler = buildOnActivity({
        db,
        memory: fakeMemory(),
        hooks: createHookEngine(),
        agents: [makeAgent()],
        board,
        queue: createKeyedQueue(),
      });

      const evento: IncomingActivityEvent = {
        origen: "github",
        proyectoId: "acme/repo-concurrencia-a2a",
        proyectoNombre: "repo-concurrencia-a2a",
        repoUrl: "https://github.com/acme/repo-concurrencia-a2a",
        tipo: ACTIVIDAD_TIPO_PR_REVIEW,
        referenciaExterna: "42",
        responsableId: "octocat",
        titulo: "PR concurrente con A2A entrante",
        cuerpo: "descripción de prueba",
        archivosCambiados: ["src/a.ts"],
        deliveryId: "delivery-concurrencia-a2a-1",
        recibidoEn: new Date().toISOString(),
      };

      const inicio = Date.now();
      const resultados = await Promise.all([
        ...Array.from({ length: N }, (_unused, indice) =>
          delegarTarea(
            {
              destino: destinoDe(servidor),
              clave: DESTINO_A2A_RIESGO_CREDITO,
              tarea: `consulta concurrente ${indice}`,
              casoId: `caso-concurrencia-${indice}`,
            },
            clientDeps(),
          ),
        ),
        activityHandler(evento),
      ]);
      const elapsedMs = Date.now() - inicio;

      // Evidencia del ADR 90 pto 7 / Riesgo 2 — no sólo el resultado final: si
      // el turno de actividad (bajo `KeyedQueue` por `proyectoId`) bloqueara
      // a los turnos A2A entrantes (o viceversa), el total se acercaría a la
      // suma secuencial de las 4 invocaciones a `handleTurn`
      // ((N + 1) * DELAY_MS = 480ms). Entrelazadas — que es la garantía de
      // "sin KeyedQueue" del lado A2A —, el total queda muy por debajo de esa
      // suma.
      expect(elapsedMs).toBeLessThan(N * DELAY_MS);

      const resultadosA2A = resultados.slice(0, N) as readonly ResultadoA2A[];
      for (const resultado of resultadosA2A) {
        expect(resultado.ok).toBe(true);
      }

      const filasA2A = db
        .prepare("SELECT estado, caso_id FROM solicitudes_a2a_entrantes")
        .all() as { readonly estado: string; readonly caso_id: string | null }[];
      expect(filasA2A).toHaveLength(N);
      expect(filasA2A.every((fila) => fila.estado === "TASK_STATE_COMPLETED" && fila.caso_id !== null)).toBe(true);

      const filasActividad = db
        .prepare("SELECT id FROM actividades WHERE proyecto_id = ?")
        .all(evento.proyectoId) as { readonly id: string }[];
      expect(filasActividad).toHaveLength(1);

      const totalCasos = db.prepare("SELECT COUNT(*) as c FROM casos").get() as { readonly c: number };
      // N casos del lado A2A entrante + 1 caso del lado actividad — ninguna
      // fila cruzada, ninguna perdida.
      expect(totalCasos.c).toBe(N + 1);
    },
    15_000,
  );
});
