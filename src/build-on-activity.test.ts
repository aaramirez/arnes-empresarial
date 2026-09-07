/**
 * Tests for `buildOnActivity`/`createActivityStore` — see
 * `build-on-activity.ts`'s module doc for what this wiring does and why it
 * lives at `src/` (same level as `build-on-submit.ts`).
 *
 * `handle-turn.js` is mocked WHOLESALE (not a spy over the real
 * implementation, unlike `build-on-submit.test.ts`): `buildOnActivity`
 * imports `handleTurn` directly (it is not an injectable dependency — see
 * the contract), so the only seam available to control its outcome from a
 * test is `vi.mock`. Nothing here needs `handleTurn`'s real behavior
 * (turn selection, context assembly, the SDK) — every test below is about
 * the WIRING around it: the queue key, the full-cycle boundary, the
 * per-`casoId` knowledge factory, and the never-rejects contract.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { buildOnActivity, createActivityStore, createDelegacionStore } from "./build-on-activity.js";
import {
  ACTIVIDAD_TIPO_PR_REVIEW,
  ESTADO_PENDIENTE_REVISION,
  VEREDICTO_PREFIX,
  type Actividad,
  type ActivityBoardPort,
  type ActivityStorePort,
  type CreateCasoConActividadInput,
  type IncomingActivityEvent,
} from "./core/activity/activity-contract.js";
import { createKeyedQueue, type KeyedQueue } from "./core/concurrency/keyed-queue.js";
import { TurnFailedError } from "./core/turn-selector/turn-error.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import {
  DEFAULT_AGENT_MODEL,
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  type AgentDefinition,
} from "./core/agents/definitions.js";
import { openDatabase } from "./adapters/memory/db.js";
import { listDelegacionesPorCaso } from "./adapters/memory/repository.js";
import * as repositoryModule from "./adapters/memory/repository.js";
import type { MemoryPort } from "./core/turn-selector/handle-turn.js";
import type { AssembledContext } from "./core/turn-selector/assemble-context.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";

vi.mock("./core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

vi.mock("./core/turn-selector/invoke-model.js", () => ({
  invokeModel: vi.fn(),
}));

import { handleTurn } from "./core/turn-selector/handle-turn.js";
import { invokeModel } from "./core/turn-selector/invoke-model.js";

const mockedHandleTurn = vi.mocked(handleTurn);
const mockedInvokeModel = vi.mocked(invokeModel);

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function makeEvento(overrides: Partial<IncomingActivityEvent> = {}): IncomingActivityEvent {
  return {
    origen: "github",
    proyectoId: "acme/repo",
    proyectoNombre: "repo",
    repoUrl: "https://github.com/acme/repo",
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: "1",
    responsableId: "octocat",
    titulo: "Agrega feature X",
    cuerpo: "Descripción del PR",
    archivosCambiados: ["src/a.ts"],
    deliveryId: "delivery-1",
    recibidoEn: TIMESTAMP,
    ...overrides,
  };
}

function makeActividad(overrides: Partial<Actividad> = {}): Actividad {
  return {
    id: "actividad-1",
    proyectoId: "acme/repo",
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: "1",
    responsableId: "octocat",
    casoId: "caso-1",
    estado: ESTADO_PENDIENTE_REVISION,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

/** Same shape a real store would return for `createCasoConActividad`, given its own input — mirrors `run-activity-turn.test.ts`'s helper. */
function actividadDesdeCreateInput(input: CreateCasoConActividadInput): Actividad {
  return {
    id: input.actividad.id,
    proyectoId: input.proyecto.id,
    tipo: input.actividad.tipo,
    referenciaExterna: input.actividad.referenciaExterna,
    ...(input.responsable !== undefined ? { responsableId: input.responsable.id } : {}),
    casoId: input.caso.id,
    estado: input.actividad.estado,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function makeStore(overrides: Partial<ActivityStorePort> = {}): ActivityStorePort {
  return {
    findActividadPorReferencia: vi.fn(() => undefined),
    createCasoConActividad: vi.fn((input: CreateCasoConActividadInput) => actividadDesdeCreateInput(input)),
    updateActividadEstado: vi.fn((input) => ({
      ...makeActividad(),
      id: input.actividadId,
      estado: input.estado,
      updatedAt: input.updatedAt,
    })),
    ...overrides,
  };
}

function makeBoard(overrides: Partial<ActivityBoardPort> = {}): ActivityBoardPort {
  return {
    leerMetadatos: vi.fn(async () => undefined),
    publicarRevision: vi.fn(async () => undefined),
    mirrorEstado: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    description: "agente de prueba",
    systemPrompt: `system prompt de ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

/** Never actually dereferenced in these tests: `store` is always injected, so `buildOnActivity`'s `deps.store ?? createActivityStore(db)` never evaluates the fallback. */
function fakeDb(): Database.Database {
  return {} as unknown as Database.Database;
}

function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn(),
    getLatestSesionAgente: vi.fn(),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

/** Captures written lines instead of touching the real filesystem — same reasoning `build-on-submit.test.ts`'s `fakeLogDeps` documents. */
function fakeLogDeps(): LogTurnEventDeps & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    now: () => TIMESTAMP,
    write: (line) => {
      lines.push(line);
    },
    lines,
  };
}

function parseLastLine(lines: readonly string[]): Record<string, unknown> {
  const last = lines.at(-1);
  expect(last).toBeDefined();
  return JSON.parse(last as string) as Record<string, unknown>;
}

const outcomeAprobado = { responseText: `Todo listo.\n${VEREDICTO_PREFIX} aprobado`, agentLabel: "agente-x" };

interface BaseDepsOverrides {
  readonly store?: ActivityStorePort;
  readonly board?: ActivityBoardPort;
  readonly queue?: KeyedQueue;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
  readonly createKnowledge?: (casoId: string) => KnowledgeAdapter;
}

function makeBaseDeps(overrides: BaseDepsOverrides = {}) {
  return {
    db: fakeDb(),
    memory: fakeMemory(),
    hooks: createHookEngine(),
    agents: [makeAgent("agente-x")],
    board: overrides.board ?? makeBoard(),
    queue: overrides.queue ?? createKeyedQueue(),
    ...(overrides.newId ? { newId: overrides.newId } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.logDeps ? { logDeps: overrides.logDeps } : {}),
    ...(overrides.createKnowledge ? { createKnowledge: overrides.createKnowledge } : {}),
    ...(overrides.store ? { store: overrides.store } : {}),
  };
}

function makeCounterNewId(prefix = "id"): () => string {
  let contador = 0;
  return () => `${prefix}-${++contador}`;
}

/**
 * `now()` monótono creciente en vez de un `TIMESTAMP` fijo — necesario para
 * los tests de la tarea 14 que verifican `ORDER BY created_at` de
 * `listDelegacionesPorCaso`: con un `now()` fijo el orden de filas con el
 * mismo `created_at` no está garantizado por SQL.
 */
function makeCounterNow(prefix = "2026-02-01T00:00:00."): () => string {
  let contador = 0;
  return () => `${prefix}${String(++contador).padStart(3, "0")}Z`;
}

/** Abre una base `:memory:` real (con migraciones aplicadas) para un test async, y la cierra al terminar. */
async function withDbAsync<T>(fn: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = openDatabase(":memory:");
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/** Respuesta fake de `invokeModel` para un rol — solo el Reviewer trae `VEREDICTO_PREFIX` (mismo criterio que `cadena-revision.ts`). */
function respuestaSubagente(agentId: string): { responseText: string; sdkSessionId: string } {
  return {
    responseText:
      agentId === REVIEWER_AGENT_ID
        ? `Revisión completa.\n${VEREDICTO_PREFIX} aprobado`
        : `Salida de ${agentId}`,
    sdkSessionId: `sdk-${agentId}`,
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

beforeEach(() => {
  mockedHandleTurn.mockReset();
  mockedHandleTurn.mockResolvedValue(outcomeAprobado);
  mockedInvokeModel.mockReset();
  // Hito 5, tarea 14: TODO el describe("buildOnActivity", ...) de abajo
  // ejercita el camino de v1.4.0/Hito 3 (mockea `handleTurn` directamente) —
  // fuerza el interruptor a "off" acá para que siga probando exactamente lo
  // mismo que antes de esta tarea. El describe dedicado al interruptor, más
  // abajo, pisa esta variable explícitamente en cada test.
  process.env.HARNESS_DELEGACION_ROLES = "off";
});

afterEach(() => {
  delete process.env.HARNESS_DELEGACION_ROLES;
});

describe("buildOnActivity", () => {
  it("nunca rechaza aunque runActivityTurn termine lanzando (forzado vía store.findActividadPorReferencia)", async () => {
    const logDeps = fakeLogDeps();
    const store = makeStore({
      findActividadPorReferencia: vi.fn(() => {
        throw new Error("boom de store");
      }),
    });
    const handler = buildOnActivity(makeBaseDeps({ store, logDeps }));

    await expect(handler(makeEvento())).resolves.toBeUndefined();

    const logged = parseLastLine(logDeps.lines);
    expect(logged.event).toBe("actividad-turno-fallido");
    // `casoId` posicional de `logTurnEvent` es `evento.deliveryId` acá — el
    // fallo ocurrió antes de que exista cualquier `casoId` de actividad.
    expect(logged.casoId).toBe("delivery-1");
    expect(logged.proyectoId).toBe("acme/repo");
    expect(logged.referenciaExterna).toBe("1");
    expect(logged.message).toBe("boom de store");
    expect(logged).not.toHaveProperty("stage");
  });

  it("incluye `stage` en el log cuando el error es un TurnFailedError real", async () => {
    const logDeps = fakeLogDeps();
    mockedHandleTurn.mockRejectedValueOnce(new TurnFailedError("model", new Error("el modelo falló")));
    const handler = buildOnActivity(makeBaseDeps({ store: makeStore(), logDeps }));

    await expect(handler(makeEvento())).resolves.toBeUndefined();

    const logged = parseLastLine(logDeps.lines);
    expect(logged.event).toBe("actividad-turno-fallido");
    expect(logged.stage).toBe("model");
  });

  it("invoca queue.run con evento.proyectoId exacto", async () => {
    const runSpy = vi.fn((_key: string, task: () => Promise<unknown>) => task());
    const queue: KeyedQueue = {
      run: (key, task) => runSpy(key, task) as ReturnType<typeof task>,
      size: 0,
    };
    const handler = buildOnActivity(makeBaseDeps({ store: makeStore(), queue, logDeps: fakeLogDeps() }));

    await handler(makeEvento({ proyectoId: "acme/otro-repo" }));

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0]?.[0]).toBe("acme/otro-repo");
  });

  it("queue.run envuelve el ciclo COMPLETO — nada corre antes de que la tarea encolada se invoque", async () => {
    const order: string[] = [];
    const store = makeStore({
      findActividadPorReferencia: vi.fn(() => {
        order.push("store-read");
        return undefined;
      }),
      createCasoConActividad: vi.fn((input: CreateCasoConActividadInput) => {
        order.push("store-create");
        return actividadDesdeCreateInput(input);
      }),
      updateActividadEstado: vi.fn((input) => {
        order.push("store-write");
        return { ...makeActividad(), id: input.actividadId, estado: input.estado, updatedAt: input.updatedAt };
      }),
    });
    mockedHandleTurn.mockImplementation(async () => {
      order.push("handleTurn");
      return outcomeAprobado;
    });

    let capturedTask: (() => Promise<unknown>) | undefined;
    const queue: KeyedQueue = {
      run: (key, task) => {
        order.push(`queue-run:${key}`);
        capturedTask = task;
        return new Promise(() => {
          // Nunca se asienta por sí sola — el test controla cuándo corre
          // `capturedTask` para probar que NADA pasa antes de eso.
        });
      },
      size: 0,
    };

    const handler = buildOnActivity(makeBaseDeps({ store, queue, logDeps: fakeLogDeps() }));
    void handler(makeEvento());

    // El handler ya devolvió (síncronamente encoló en `queue.run`), pero
    // como nuestro `queue` doble no ejecuta la tarea, nada del ciclo debe
    // haber corrido todavía.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["queue-run:acme/repo"]);

    await capturedTask?.();

    expect(order).toEqual(["queue-run:acme/repo", "store-read", "store-create", "handleTurn", "store-write"]);
  });

  it("createKnowledge(casoId) se invoca UNA VEZ por turno, con el casoId real que runActivityTurn creó", async () => {
    const newId = makeCounterNewId("caso-nuevo");
    const createKnowledge = makeFakeKnowledge();
    const handler = buildOnActivity(
      makeBaseDeps({ store: makeStore(), newId, createKnowledge, logDeps: fakeLogDeps() }),
    );

    await handler(makeEvento());

    // `runActivityTurn` llama `newId()` dos veces cuando crea (casoId,
    // luego actividadId) — el PRIMER valor es el `casoId`.
    const casoIdEsperado = "caso-nuevo-1";
    expect(createKnowledge).toHaveBeenCalledTimes(1);
    expect(createKnowledge).toHaveBeenCalledWith(casoIdEsperado);

    // Cruzado: `handleTurn` debe haber recibido ese mismo `casoId` como
    // primer argumento posicional — confirma que es EL MISMO turno.
    expect(mockedHandleTurn.mock.calls[0]?.[0]).toBe(casoIdEsperado);
  });

  it("serializa dos eventos del mismo proyectoId (KeyedQueue real) — el segundo no arranca hasta que el primero se asienta", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let callIndex = 0;
    mockedHandleTurn.mockImplementation(async () => {
      callIndex += 1;
      const idx = callIndex;
      order.push(`start-${idx}`);
      if (idx === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      order.push(`end-${idx}`);
      return outcomeAprobado;
    });

    const queue = createKeyedQueue();
    const handler = buildOnActivity(
      makeBaseDeps({ store: makeStore(), queue, newId: makeCounterNewId(), logDeps: fakeLogDeps() }),
    );

    const p1 = handler(makeEvento({ referenciaExterna: "1" }));
    const p2 = handler(makeEvento({ referenciaExterna: "2" }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start-1"]);

    releaseFirst?.();
    await p1;
    await p2;

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("NO serializa eventos de proyectoId distintos — ambos pueden estar en vuelo a la vez", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let callIndex = 0;
    mockedHandleTurn.mockImplementation(async () => {
      callIndex += 1;
      const idx = callIndex;
      order.push(`start-${idx}`);
      if (idx === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      order.push(`end-${idx}`);
      return outcomeAprobado;
    });

    const queue = createKeyedQueue();
    const logDeps = fakeLogDeps();
    const handler = buildOnActivity(
      makeBaseDeps({ store: makeStore(), queue, newId: makeCounterNewId(), logDeps }),
    );

    const p1 = handler(makeEvento({ proyectoId: "acme/repo-a", referenciaExterna: "1" }));
    const p2 = handler(makeEvento({ proyectoId: "acme/repo-b", referenciaExterna: "1" }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Ambos arrancaron — proyecto-b NO esperó a proyecto-a. "end-1" todavía
    // no ocurrió (sigue bloqueado en `releaseFirst`).
    expect(order).toContain("start-1");
    expect(order).toContain("start-2");
    expect(order).not.toContain("end-1");

    releaseFirst?.();
    await p1;
    await p2;

    // La prueba real de "no serializado": proyecto-b arrancó ANTES de que
    // proyecto-a terminara — si estuvieran serializados por la misma clave,
    // "start-2" solo podría aparecer después de "end-1".
    expect(order.indexOf("start-2")).toBeLessThan(order.indexOf("end-1"));
    expect(order).toContain("end-1");
    expect(order).toContain("end-2");
  });

  it("aislamiento de citas: dos turnos con casoId distintos, cada uno con su propio createKnowledge — ningún nodo cruza (spec knowledge-query)", async () => {
    const savedNodesByCasoId: Record<string, string[]> = {};
    const nodosDelCaso: Record<string, string[]> = {
      "caso-a": ["nodo-a1", "nodo-a2"],
      "caso-b": ["nodo-b1"],
    };

    const createKnowledge = vi.fn((casoId: string): KnowledgeAdapter => {
      // Simula que el modelo citó los nodos DE ESTE caso durante el turno,
      // antes de que `saveTurnResult` los drene — cada instancia tiene su
      // propio estado, como un `CitedNodesRecorder` real por casoId.
      const pendientes = [...(nodosDelCaso[casoId] ?? [])];
      return {
        mcpServers: {},
        feedback: {
          saveTurnResult: vi.fn(async () => {
            savedNodesByCasoId[casoId] = pendientes.splice(0, pendientes.length);
          }),
          discardPendingCitations: vi.fn(() => {
            pendientes.length = 0;
          }),
        },
      };
    });

    mockedHandleTurn.mockImplementation(async (casoId, _prompt, deps) => {
      await deps.knowledgeFeedback?.saveTurnResult({ casoId, question: "q", answer: "a" });
      return outcomeAprobado;
    });

    const actividadA = makeActividad({ referenciaExterna: "1", casoId: "caso-a" });
    const actividadB = makeActividad({ referenciaExterna: "2", casoId: "caso-b" });
    const store = makeStore({
      findActividadPorReferencia: vi.fn((input) => {
        if (input.referenciaExterna === "1") return actividadA;
        if (input.referenciaExterna === "2") return actividadB;
        return undefined;
      }),
    });

    const queue = createKeyedQueue();
    const logDeps = fakeLogDeps();
    const handler = buildOnActivity(makeBaseDeps({ store, queue, createKnowledge, logDeps }));

    // proyectoId distinto → corren efectivamente concurrentes, no solo
    // "uno después del otro" por la cola.
    await Promise.all([
      handler(makeEvento({ proyectoId: "acme/repo-a", referenciaExterna: "1" })),
      handler(makeEvento({ proyectoId: "acme/repo-b", referenciaExterna: "2" })),
    ]);

    expect(createKnowledge).toHaveBeenCalledTimes(2);
    expect(createKnowledge).toHaveBeenCalledWith("caso-a");
    expect(createKnowledge).toHaveBeenCalledWith("caso-b");

    expect(savedNodesByCasoId["caso-a"]).toEqual(["nodo-a1", "nodo-a2"]);
    expect(savedNodesByCasoId["caso-b"]).toEqual(["nodo-b1"]);
    expect(savedNodesByCasoId["caso-a"]).not.toEqual(expect.arrayContaining(["nodo-b1"]));
    expect(savedNodesByCasoId["caso-b"]).not.toEqual(expect.arrayContaining(["nodo-a1", "nodo-a2"]));
  });
});

describe("createActivityStore", () => {
  function withDb<T>(fn: (db: Database.Database) => T): T {
    const db = openDatabase(":memory:");
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  it("findActividadPorReferencia: traduce el objeto único del puerto a los dos parámetros posicionales de repository.ts, undefined si no existe", () => {
    withDb((db) => {
      const store = createActivityStore(db);
      expect(
        store.findActividadPorReferencia({ proyectoId: "acme/repo", referenciaExterna: "1" }),
      ).toBeUndefined();
    });
  });

  it("createCasoConActividad: completa createdAt/updatedAt de caso y actividad con `timestamp`, y devuelve SOLO `.actividad`", () => {
    withDb((db) => {
      const store = createActivityStore(db);
      const actividad = store.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });

      expect(actividad).toMatchObject({
        id: "actividad-1",
        casoId: "caso-1",
        estado: ESTADO_PENDIENTE_REVISION,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      });
      expect(actividad).not.toHaveProperty("caso");
      expect(actividad).not.toHaveProperty("actividad");

      const encontrada = store.findActividadPorReferencia({
        proyectoId: "acme/repo",
        referenciaExterna: "1",
      });
      expect(encontrada?.id).toBe("actividad-1");
    });
  });

  it("updateActividadEstado: mapea a repository.updateActividad con estado/responsableId/updatedAt", () => {
    withDb((db) => {
      const store = createActivityStore(db);
      store.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        responsable: { id: "octocat" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });

      const actualizada = store.updateActividadEstado({
        actividadId: "actividad-1",
        estado: "aprobado",
        responsableId: "octocat",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });

      expect(actualizada.estado).toBe("aprobado");
      expect(actualizada.responsableId).toBe("octocat");
      expect(actualizada.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    });
  });

  it("findActividadPorReferencia: lanza si `tipo` en la fila no está en ACTIVIDAD_TIPOS (corrupción de datos)", () => {
    withDb((db) => {
      const store = createActivityStore(db);
      store.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });
      // Simula corrupción real: `actividades.tipo` es TEXT sin CHECK (por
      // diseño de `repository.ts`), así que escribir directo por SQL es la
      // única forma de producir un valor inválido sin pasar por ninguna
      // validación de escritura que lo bloquearía antes de llegar acá.
      db.prepare("UPDATE actividades SET tipo = ? WHERE id = ?").run("tipo_invalido", "actividad-1");

      expect(() =>
        store.findActividadPorReferencia({ proyectoId: "acme/repo", referenciaExterna: "1" }),
      ).toThrowError(/actividad-1.*tipo_invalido/s);
    });
  });

  it("findActividadPorReferencia: lanza si `estado` en la fila no está en ACTIVIDAD_ESTADOS (corrupción de datos)", () => {
    withDb((db) => {
      const store = createActivityStore(db);
      store.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });
      db.prepare("UPDATE actividades SET estado = ? WHERE id = ?").run("estado_invalido", "actividad-1");

      expect(() =>
        store.findActividadPorReferencia({ proyectoId: "acme/repo", referenciaExterna: "1" }),
      ).toThrowError(/actividad-1.*estado_invalido/s);
    });
  });
});

/**
 * Interruptor `HARNESS_DELEGACION_ROLES` (Hito 5, tarea 14, §6.4, ADR
 * 53/54). Usa un `db` REAL (`:memory:`, migrado) sin override de `store`
 * — la única forma de que `createDelegacionStore(db)` escriba filas de
 * `delegaciones` reales con `caso_id` cumpliendo la FK contra una fila de
 * `casos` real (mismo motivo por el que `createActivityStore` de arriba usa
 * `withDb` en vez de un doble). `handleTurn` sigue mockeado globalmente
 * (arriba del archivo); `invokeModel` se mockea acá — mismo criterio,
 * ninguno de los dos debe pegarle al SDK real.
 */
describe("buildOnActivity — interruptor HARNESS_DELEGACION_ROLES (Hito 5, tarea 14, ADR 53/54)", () => {
  it.each([
    ["ausente", undefined],
    ["cualquier otro valor", "on"],
  ])(
    "%s ⇒ despacha la cadena Planner→Developer→Reviewer (despacharRevisionPorRoles), NO invoca handleTurn, y persiste tres delegaciones encadenadas",
    async (_label, valor) => {
      if (valor === undefined) {
        delete process.env.HARNESS_DELEGACION_ROLES;
      } else {
        process.env.HARNESS_DELEGACION_ROLES = valor;
      }
      mockedInvokeModel.mockImplementation(async (agent) => respuestaSubagente(agent.id));
      const createKnowledge = makeFakeKnowledge();

      await withDbAsync(async (db) => {
        const handler = buildOnActivity({
          db,
          memory: fakeMemory(),
          hooks: createHookEngine(),
          agents: [makeAgent("agente-x")],
          board: makeBoard(),
          queue: createKeyedQueue(),
          newId: makeCounterNewId("id"),
          now: makeCounterNow(),
          createKnowledge,
          logDeps: fakeLogDeps(),
        });

        await handler(makeEvento());

        expect(mockedHandleTurn).not.toHaveBeenCalled();
        expect(createKnowledge).not.toHaveBeenCalled();

        expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
        const idsInvocados = mockedInvokeModel.mock.calls.map((call) => (call[0] as AgentDefinition).id);
        expect(idsInvocados).toEqual([PLANNER_AGENT_ID, DEVELOPER_AGENT_ID, REVIEWER_AGENT_ID]);

        // `newId()` es un contador compartido entre `runActivityTurn` y
        // `delegacionDeps`: el PRIMER valor emitido es siempre el `casoId`
        // (mismo criterio que el test de `createKnowledge` de arriba).
        const filas = listDelegacionesPorCaso(db, "id-1");
        expect(filas).toHaveLength(3);
        expect(filas.map((f) => f.agentId)).toEqual([PLANNER_AGENT_ID, DEVELOPER_AGENT_ID, REVIEWER_AGENT_ID]);
        expect(filas[0]?.sesionPadreId).toBeUndefined();
        expect(filas[1]?.sesionPadreId).toBe(filas[0]?.sesionSubagenteId);
        expect(filas[2]?.sesionPadreId).toBe(filas[1]?.sesionSubagenteId);
        expect(filas.every((f) => f.resultado !== undefined)).toBe(true);
      });
    },
  );

  it('HARNESS_DELEGACION_ROLES="off" bindea el handleTurn único de v1.4.0 — NUNCA invoca invokeModel ni crea delegaciones', async () => {
    process.env.HARNESS_DELEGACION_ROLES = "off";

    await withDbAsync(async (db) => {
      const handler = buildOnActivity({
        db,
        memory: fakeMemory(),
        hooks: createHookEngine(),
        agents: [makeAgent("agente-x")],
        board: makeBoard(),
        queue: createKeyedQueue(),
        newId: makeCounterNewId("id"),
        now: makeCounterNow(),
        logDeps: fakeLogDeps(),
      });

      await handler(makeEvento());

      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
      expect(mockedInvokeModel).not.toHaveBeenCalled();
      expect(listDelegacionesPorCaso(db, "id-1")).toHaveLength(0);
    });
  });

  it("el closure `invocar` cierra invokeModel con resumeSessionId: undefined EXPLÍCITO y NUNCA llama a memory.getLatestSesionAgente (ADR 53, cierra RD-5)", async () => {
    delete process.env.HARNESS_DELEGACION_ROLES;
    mockedInvokeModel.mockImplementation(async (agent) => respuestaSubagente(agent.id));
    const memory = fakeMemory();

    await withDbAsync(async (db) => {
      const handler = buildOnActivity({
        db,
        memory,
        hooks: createHookEngine(),
        agents: [makeAgent("agente-x")],
        board: makeBoard(),
        queue: createKeyedQueue(),
        newId: makeCounterNewId("id"),
        now: makeCounterNow(),
        logDeps: fakeLogDeps(),
      });

      await handler(makeEvento());

      expect(memory.getLatestSesionAgente).not.toHaveBeenCalled();
      expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
      for (const call of mockedInvokeModel.mock.calls) {
        const context = call[1] as AssembledContext;
        expect(context.resumeSessionId).toBeUndefined();
        expect(Object.hasOwn(context, "resumeSessionId")).toBe(true);
      }
    });
  });

  it("el `caso` que recibe el subagente delegado es el CasoSnapshot REAL del caso padre — leído vía getCasoById, no un placeholder sintético", async () => {
    delete process.env.HARNESS_DELEGACION_ROLES;
    mockedInvokeModel.mockImplementation(async (agent) => respuestaSubagente(agent.id));

    await withDbAsync(async (db) => {
      // Inserta el caso padre "a mano", con `tipo`/`estado` reconocibles y
      // deliberadamente DISTINTOS de lo que el placeholder viejo fabricaba
      // (`tipo: "delegacion"`, `estado: "activo"`) — si `invocar` todavía
      // fabricara ese placeholder en vez de leer la fila real, el assert de
      // abajo fallaría.
      const activityStore = createActivityStore(db);
      const actividad = activityStore.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        caso: { id: "caso-real-1", tipo: "tipo-reconocible", estado: "estado-reconocible" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });
      expect(actividad.casoId).toBe("caso-real-1");

      const handler = buildOnActivity({
        db,
        memory: fakeMemory(),
        hooks: createHookEngine(),
        agents: [makeAgent("agente-x")],
        board: makeBoard(),
        queue: createKeyedQueue(),
        newId: makeCounterNewId("id"),
        now: makeCounterNow(),
        logDeps: fakeLogDeps(),
      });

      // `referenciaExterna: "1"` coincide con la actividad ya creada arriba
      // ⇒ `runActivityTurn` la REUSA vía `findActividadPorReferencia` (no
      // crea un caso nuevo): `actividad.casoId` sigue siendo "caso-real-1",
      // el caso insertado a mano.
      await handler(makeEvento({ referenciaExterna: "1" }));

      expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
      for (const call of mockedInvokeModel.mock.calls) {
        const context = call[1] as AssembledContext;
        expect(context.caso).toMatchObject({
          id: "caso-real-1",
          tipo: "tipo-reconocible",
          estado: "estado-reconocible",
        });
      }
    });
  });

  it("`invocar` lanza CasoNotFoundError si getCasoById no encuentra el caso padre — corrupción de estado, no alcanzable por el flujo normal (fila ya creada por createCasoConActividad antes de despacharRevision)", async () => {
    delete process.env.HARNESS_DELEGACION_ROLES;

    await withDbAsync(async (db) => {
      const logDeps = fakeLogDeps();

      // No se borra la fila `casos` de verdad: `store.crearDelegacion`
      // (`insertDelegacion`) corre ANTES que `invocar` dentro de
      // `despacharDelegacion` e inserta con `caso_id` referenciando
      // `casos(id)` — borrar la fila real rompería ESA inserción por FK,
      // antes siquiera de llegar al closure bajo prueba. Se simula el
      // invariante roto con un spy sobre `getCasoById` que responde
      // `undefined` UNA vez, dejando la fila real intacta — mismo criterio
      // de "corrupción simulada sin tocar el resto del flujo" que el spy de
      // `mapGithubEvent` en `webhooks/server.test.ts`.
      const getCasoByIdSpy = vi.spyOn(repositoryModule, "getCasoById").mockReturnValueOnce(undefined);

      try {
        const handler = buildOnActivity({
          db,
          memory: fakeMemory(),
          hooks: createHookEngine(),
          agents: [makeAgent("agente-x")],
          board: makeBoard(),
          queue: createKeyedQueue(),
          newId: makeCounterNewId("id"),
          now: makeCounterNow(),
          logDeps,
        });

        // `buildOnActivity` nunca rechaza (contrato de nivel superior): el
        // error se traga en ESE límite y se loguea como
        // `actividad-turno-fallido`, con el mensaje de `CasoNotFoundError`.
        await expect(handler(makeEvento())).resolves.toBeUndefined();

        const logged = parseLastLine(logDeps.lines);
        expect(logged.event).toBe("actividad-turno-fallido");
        expect(logged.message).toBe("Caso not found: id-1");
        expect(getCasoByIdSpy).toHaveBeenCalledWith(db, "id-1");
      } finally {
        getCasoByIdSpy.mockRestore();
      }
    });
  });

  it("con el interruptor activo (roles) NO se construye createKnowledge — ningún rol tiene el tool de conocimiento en su allowedTools", async () => {
    delete process.env.HARNESS_DELEGACION_ROLES;
    mockedInvokeModel.mockImplementation(async (agent) => respuestaSubagente(agent.id));
    const createKnowledge = makeFakeKnowledge();

    await withDbAsync(async (db) => {
      const handler = buildOnActivity({
        db,
        memory: fakeMemory(),
        hooks: createHookEngine(),
        agents: [makeAgent("agente-x")],
        board: makeBoard(),
        queue: createKeyedQueue(),
        newId: makeCounterNewId("id"),
        now: makeCounterNow(),
        createKnowledge,
        logDeps: fakeLogDeps(),
      });

      await handler(makeEvento());

      expect(createKnowledge).not.toHaveBeenCalled();
    });
  });
});

describe("createDelegacionStore (Hito 5, tarea 14, §6.4)", () => {
  it("crearDelegacion + completarDelegacion escriben vía insertDelegacion/completarDelegacion de repository.ts — round-trip por listDelegacionesPorCaso", async () => {
    await withDbAsync(async (db) => {
      // FK real: `delegaciones.caso_id` referencia `casos.id` — crea un caso
      // real primero, vía la misma ruta que `createActivityStore` ya
      // ejercita arriba.
      const activityStore = createActivityStore(db);
      const actividad = activityStore.createCasoConActividad({
        proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "actividad-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "1",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: TIMESTAMP,
      });

      const delegacionStore = createDelegacionStore(db);
      delegacionStore.crearDelegacion({
        id: "delegacion-1",
        casoId: actividad.casoId,
        agentId: PLANNER_AGENT_ID,
        tareaDelegada: "tarea de prueba",
        createdAt: TIMESTAMP,
      });
      delegacionStore.completarDelegacion({
        delegacionId: "delegacion-1",
        sesion: {
          id: "sesion-1",
          casoId: actividad.casoId,
          agentId: PLANNER_AGENT_ID,
          sdkSessionId: "sdk-1",
          createdAt: TIMESTAMP,
        },
        resultado: "resultado de prueba",
      });

      const filas = listDelegacionesPorCaso(db, actividad.casoId);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: "delegacion-1",
        agentId: PLANNER_AGENT_ID,
        sesionSubagenteId: "sesion-1",
        tareaDelegada: "tarea de prueba",
        resultado: "resultado de prueba",
      });
    });
  });
});
