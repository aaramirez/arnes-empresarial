import { describe, expect, it, vi } from "vitest";
import {
  ACTIVIDAD_TIPO_PR_REVIEW,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  VEREDICTO_PREFIX,
  type Actividad,
  type ActivityBoardPort,
  type ActivityStorePort,
  type CreateCasoConActividadInput,
  type IncomingActivityEvent,
} from "./activity-contract.js";
import {
  runActivityTurn,
  type ActivityTurnOutcome,
  type RunActivityTurnDeps,
} from "./run-activity-turn.js";

/**
 * Spec `activity-webhook-turn`, requirements "Creación transaccional de caso
 * y actividad" y "Fallo de persistencia propaga":
 * - "Fallo de persistencia propaga": el `ActivityStorePort` que lanza al
 *   crear la actividad propaga el error como fallo del turno, y el paso 5
 *   (acá, el `despacharRevision` inyectado — Hito 5, tarea 12: renombre de
 *   `runTurn`, mismo tipo, ADR 54) NO se invoca.
 *
 * Dobles planos de `ActivityStorePort`/`ActivityBoardPort`/`despacharRevision`
 * — nunca SQLite ni red real. `run-activity-turn.ts` envuelve el paso 5 sin
 * importar `cadena-revision.ts` (el composition root lo cierra, design.md
 * §5.5); estos tests no importan `cadena-revision.ts` tampoco, por la misma
 * razón (mismo criterio que `handle-turn.ts` en Hito 3).
 */

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function makeEvento(overrides: Partial<IncomingActivityEvent> = {}): IncomingActivityEvent {
  return {
    origen: "github",
    proyectoId: "acme/repo",
    proyectoNombre: "repo",
    repoUrl: "https://github.com/acme/repo",
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: "42",
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
    id: "actividad-existente",
    proyectoId: "acme/repo",
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: "42",
    responsableId: "octocat",
    casoId: "caso-existente",
    estado: ESTADO_PENDIENTE_REVISION,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

/** Convierte el input que recibiría `createCasoConActividad` en la `Actividad` que devolvería un store real — para que el doble por defecto se comporte de forma consistente sin necesitar SQLite. */
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
    createCasoConActividad: vi.fn((input: CreateCasoConActividadInput) =>
      actividadDesdeCreateInput(input),
    ),
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

function makeDeps(overrides: Partial<RunActivityTurnDeps> = {}): RunActivityTurnDeps {
  let contador = 0;
  const outcomeAprobado: ActivityTurnOutcome = {
    responseText: `Todo listo.\n${VEREDICTO_PREFIX} aprobado`,
    agentLabel: "revisor-pr",
  };

  return {
    store: makeStore(),
    board: makeBoard(),
    despacharRevision: vi.fn(async () => outcomeAprobado),
    newId: vi.fn(() => `id-${++contador}`),
    now: vi.fn(() => TIMESTAMP),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("runActivityTurn", () => {
  it("crea proyecto+caso+actividad cuando no existe actividad previa (actividadCreada: true)", async () => {
    const evento = makeEvento();
    const deps = makeDeps();

    const resultado = await runActivityTurn(evento, deps);

    expect(resultado.actividadCreada).toBe(true);
    expect(deps.store.createCasoConActividad).toHaveBeenCalledTimes(1);

    const inputCreado = vi.mocked(deps.store.createCasoConActividad).mock.calls[0]?.[0];
    expect(inputCreado?.actividad.estado).toBe(ESTADO_PENDIENTE_REVISION);
    expect(inputCreado?.caso.tipo).toBe(evento.tipo);
    expect(inputCreado?.timestamp).toBe(TIMESTAMP);

    expect(deps.logEvent).toHaveBeenCalledWith(
      resultado.casoId,
      "actividad-creada",
      expect.anything(),
    );
  });

  it("reusa la actividad existente, incluido su casoId (actividadCreada: false)", async () => {
    const evento = makeEvento();
    const actividadExistente = makeActividad({
      casoId: "caso-existente-reusado",
      estado: ESTADO_OBSERVADO,
    });
    const store = makeStore({
      findActividadPorReferencia: vi.fn(() => actividadExistente),
    });
    const deps = makeDeps({ store });

    const resultado = await runActivityTurn(evento, deps);

    expect(resultado.actividadCreada).toBe(false);
    expect(resultado.casoId).toBe("caso-existente-reusado");
    expect(deps.store.createCasoConActividad).not.toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(
      "caso-existente-reusado",
      "actividad-reusada",
      expect.anything(),
    );
  });

  it("propaga si findActividadPorReferencia lanza, y NO invoca despacharRevision", async () => {
    const evento = makeEvento();
    const error = new Error("fallo de lectura de actividad");
    const store = makeStore({
      findActividadPorReferencia: vi.fn(() => {
        throw error;
      }),
    });
    const deps = makeDeps({ store });

    await expect(runActivityTurn(evento, deps)).rejects.toThrow(error);
    expect(deps.despacharRevision).not.toHaveBeenCalled();
  });

  it("propaga si createCasoConActividad lanza, y NO invoca despacharRevision", async () => {
    const evento = makeEvento();
    const error = new Error("fallo de persistencia al crear actividad");
    const store = makeStore({
      createCasoConActividad: vi.fn(() => {
        throw error;
      }),
    });
    const deps = makeDeps({ store });

    await expect(runActivityTurn(evento, deps)).rejects.toThrow(error);
    expect(deps.despacharRevision).not.toHaveBeenCalled();
  });

  it("propaga si despacharRevision rechaza, y NO invoca updateActividadEstado", async () => {
    const evento = makeEvento();
    const error = new Error("el modelo fallo");
    const deps = makeDeps({
      despacharRevision: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(runActivityTurn(evento, deps)).rejects.toThrow(error);
    expect(deps.store.updateActividadEstado).not.toHaveBeenCalled();
  });

  it("falla del Developer (segundo rol de la cadena) no invoca ningun metodo de store ni de board tras el paso 5", async () => {
    // El doble de `despacharRevision` simula lo que pasaria si `despacharCadena`
    // (cadena-revision.ts, tarea 11) rechazara en el eslabon del Developer: la
    // cadena entera propaga sin devolver ActivityTurnOutcome (design.md §5.5,
    // "No captura: si un eslabon falla, el error de despacharCadena propaga
    // tal cual"). Este test vive en run-activity-turn.ts porque acá es donde
    // se verifica el contrato de propagacion del paso 5 (module doc de
    // arriba): nada de store/board corre despues de una falla de la cadena.
    const evento = makeEvento();
    const error = new Error("Developer fallo: no se pudo rastrear el impacto del plan");
    const board = makeBoard({
      publicarRevision: vi.fn(async () => undefined),
      mirrorEstado: vi.fn(async () => undefined),
    });
    const store = makeStore({
      updateActividadEstado: vi.fn((input) => ({
        ...makeActividad(),
        id: input.actividadId,
        estado: input.estado,
        updatedAt: input.updatedAt,
      })),
    });
    const deps = makeDeps({
      store,
      board,
      despacharRevision: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(runActivityTurn(evento, deps)).rejects.toThrow(error);

    expect(deps.store.updateActividadEstado).not.toHaveBeenCalled();
    expect(deps.board.publicarRevision).not.toHaveBeenCalled();
    expect(deps.board.mirrorEstado).not.toHaveBeenCalled();
  });

  it("actualiza el estado canónico ANTES de publicar/espejar en el tablero (orden 7 antes de 8-9)", async () => {
    const evento = makeEvento();
    const callOrder: string[] = [];

    const store = makeStore({
      updateActividadEstado: vi.fn((input) => {
        callOrder.push("updateActividadEstado");
        return {
          ...makeActividad(),
          id: input.actividadId,
          estado: input.estado,
          updatedAt: input.updatedAt,
        };
      }),
    });
    const board = makeBoard({
      publicarRevision: vi.fn(async () => {
        callOrder.push("publicarRevision");
      }),
      mirrorEstado: vi.fn(async () => {
        callOrder.push("mirrorEstado");
      }),
    });
    const deps = makeDeps({ store, board });

    await runActivityTurn(evento, deps);

    expect(callOrder).toEqual(["updateActividadEstado", "publicarRevision", "mirrorEstado"]);
  });

  it("un board mal comportado que rechaza en sus tres metodos NUNCA rompe al orquestador", async () => {
    const evento = makeEvento();
    const boardError = new Error("board violando su propio contrato de nunca rechazar");
    const board: ActivityBoardPort = {
      leerMetadatos: vi.fn(async () => {
        throw boardError;
      }),
      publicarRevision: vi.fn(async () => {
        throw boardError;
      }),
      mirrorEstado: vi.fn(async () => {
        throw boardError;
      }),
    };
    const deps = makeDeps({ board });

    await expect(runActivityTurn(evento, deps)).resolves.toMatchObject({
      actividadCreada: true,
    });
  });

  it("leerMetadatos → undefined degrada sin error: el prompt usa los fallbacks del evento", async () => {
    const evento = makeEvento({ titulo: "Titulo crudo del evento", cuerpo: "Cuerpo crudo del evento" });
    const board = makeBoard({ leerMetadatos: vi.fn(async () => undefined) });
    const deps = makeDeps({ board });

    await expect(runActivityTurn(evento, deps)).resolves.toBeDefined();

    const promptUsado = vi.mocked(deps.despacharRevision).mock.calls[0]?.[1];
    expect(promptUsado).toContain("Titulo crudo del evento");
    expect(promptUsado).toContain("Cuerpo crudo del evento");
  });
});
