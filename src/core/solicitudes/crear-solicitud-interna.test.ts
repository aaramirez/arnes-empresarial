import { describe, expect, it, vi } from "vitest";
import { tokensComandoInexistentes } from "../../test/comandos-en-texto.js";
import { VALIDADOR_SOLICITUDES_AGENT_ID, getSubagentDefinition } from "../agents/definitions.js";
import { COMANDOS } from "../commands/comando-empleado.js";
import type { InvocacionSubagenteResult, InvocarSubagente } from "../agents/subagents.js";
import type {
  DelegacionStorePort,
  DespacharDelegacionDeps,
} from "../turn-selector/dispatch-delegation.js";
import {
  SOLICITUD_ESTADO_PENDIENTE,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./solicitudes-contract.js";
import { crearSolicitudInterna } from "./crear-solicitud-interna.js";

/**
 * Hito 5, tarea 17 (§4.2, §5.6 — `crear-solicitud-interna.ts`). Dobles de
 * `SolicitudStorePort` + `InvocarSubagente` (vía `DespacharDelegacionDeps`),
 * mismo criterio de "costura es `InvocarSubagente`" que
 * `cadena-revision.test.ts` (tarea 11) / `dispatch-delegation.test.ts`
 * (tarea 8).
 */

function makeNewId(): () => string {
  let contador = 0;
  return () => `id-${contador++}`;
}

function makeSolicitudStore(overrides: Partial<SolicitudStorePort> = {}): SolicitudStorePort {
  return {
    crearSolicitudConCaso: vi.fn((input) => ({
      id: input.solicitud.id,
      casoId: input.caso.id,
      solicitanteId: input.solicitud.solicitanteId,
      tipo: input.solicitud.tipo,
      detalle: input.solicitud.detalle,
      estado: input.solicitud.estado,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })),
    adjuntarDictamen: vi.fn(() => undefined),
    listarSolicitudesPendientes: vi.fn(() => []),
    aprobarSolicitud: vi.fn(() => undefined),
    rechazarSolicitud: vi.fn(() => undefined),
    cancelarSolicitud: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeDelegacionStore(): DelegacionStorePort {
  return { crearDelegacion: vi.fn(), completarDelegacion: vi.fn() };
}

function makeInvocar(resultado: InvocacionSubagenteResult): InvocarSubagente {
  return vi.fn(async () => resultado);
}

function makeDespacharDeps(overrides: Partial<DespacharDelegacionDeps> = {}): DespacharDelegacionDeps {
  return {
    store: makeDelegacionStore(),
    invocar: makeInvocar({ responseText: "dictamen del validador", sdkSessionId: "sdk-validador" }),
    getSubagente: getSubagentDefinition,
    newId: makeNewId(),
    now: () => "2026-09-07T00:00:00.000Z",
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("crearSolicitudInterna", () => {
  it("tipo desconocido devuelve {resultado: 'tipo_desconocido'} sin ningún write al store", async () => {
    const store = makeSolicitudStore();
    const despacharDeps = makeDespacharDeps();

    const resultado = await crearSolicitudInterna(
      { tipo: "reembolso-inventado", detalle: "algo", solicitanteId: "empleado-1" },
      { store, despacharDeps },
    );

    expect(resultado).toEqual({ resultado: "tipo_desconocido" });
    expect(store.crearSolicitudConCaso).not.toHaveBeenCalled();
    expect(store.adjuntarDictamen).not.toHaveBeenCalled();
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
    expect(store.listarSolicitudesPendientes).not.toHaveBeenCalled();
    expect(despacharDeps.invocar).not.toHaveBeenCalled();
    expect(despacharDeps.store.crearDelegacion).not.toHaveBeenCalled();
  });

  it("alta válida crea la solicitud (dentro de la transacción del store) y delega al validador-solicitudes con material = tipo+detalle exclusivamente", async () => {
    const store = makeSolicitudStore();
    const invocar = vi.fn(async (_input: Parameters<InvocarSubagente>[0]) => ({
      responseText: "dictamen ok",
      sdkSessionId: "sdk-1",
    }));
    const despacharDeps = makeDespacharDeps({ invocar });

    await crearSolicitudInterna(
      { tipo: "vacaciones", detalle: "una semana en marzo", solicitanteId: "empleado-secreto" },
      { store, despacharDeps },
    );

    expect(store.crearSolicitudConCaso).toHaveBeenCalledTimes(1);
    const inputCreado = vi.mocked(store.crearSolicitudConCaso).mock.calls[0]![0];
    expect(inputCreado.solicitud.tipo).toBe("vacaciones");
    expect(inputCreado.solicitud.detalle).toBe("una semana en marzo");
    expect(inputCreado.solicitud.estado).toBe(SOLICITUD_ESTADO_PENDIENTE);
    expect(inputCreado.solicitud.solicitanteId).toBe("empleado-secreto");

    expect(invocar).toHaveBeenCalledTimes(1);
    const invocacionInput = vi.mocked(invocar).mock.calls[0]![0];
    expect(invocacionInput.agent.id).toBe(VALIDADOR_SOLICITUDES_AGENT_ID);
    // Assert explícito del payload EXACTO que recibe InvocarSubagente:
    // solo tipo + detalle, JAMÁS el solicitanteId ni ningún historial.
    expect(invocacionInput.tareaDelegada).toContain("vacaciones");
    expect(invocacionInput.tareaDelegada).toContain("una semana en marzo");
    expect(invocacionInput.tareaDelegada).not.toContain("empleado-secreto");

    // Orden: crearSolicitudConCaso ANTES de invocar al validador.
    const ordenCrear = vi.mocked(store.crearSolicitudConCaso).mock.invocationCallOrder[0]!;
    const ordenInvocar = vi.mocked(invocar).mock.invocationCallOrder[0]!;
    expect(ordenCrear).toBeLessThan(ordenInvocar);
  });

  it("lo que recibe el validador dice que decide una persona autorizada distinta del solicitante y no nombra comandos inexistentes (ADR 303)", async () => {
    const invocar = vi.fn(async (_input: Parameters<InvocarSubagente>[0]) => ({
      responseText: "dictamen ok",
      sdkSessionId: "sdk-1",
    }));

    await crearSolicitudInterna(
      { tipo: "vacaciones", detalle: "una semana en marzo", solicitanteId: "empleado-1" },
      { store: makeSolicitudStore(), despacharDeps: makeDespacharDeps({ invocar }) },
    );

    const { agent, tareaDelegada } = vi.mocked(invocar).mock.calls[0]![0];
    const nombresValidos = new Set(COMANDOS.map((c) => c.nombre));
    expect(agent.id).toBe(VALIDADOR_SOLICITUDES_AGENT_ID);
    expect(tareaDelegada).toContain("persona autorizada");
    expect(tareaDelegada).toContain("distinta de quien la pidió");
    expect(tareaDelegada).not.toContain("empleado autenticado");
    expect(tokensComandoInexistentes(tareaDelegada, nombresValidos)).toEqual([]);
    expect(tokensComandoInexistentes(agent.systemPrompt, nombresValidos)).toEqual([]);
  });

  it("adjunta el dictamen del validador vía adjuntarDictamen SIN transicionar el estado", async () => {
    const store = makeSolicitudStore({
      adjuntarDictamen: vi.fn((input): SolicitudInterna => ({
        id: input.solicitudId,
        casoId: "caso-x",
        solicitanteId: "empleado-1",
        tipo: "gasto",
        detalle: "almuerzo",
        estado: SOLICITUD_ESTADO_PENDIENTE,
        dictamen: input.dictamen,
        dictaminadaAt: input.ahora,
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      })),
    });
    const invocar = vi.fn(async () => ({ responseText: "cumple las reglas", sdkSessionId: "sdk-1" }));
    const despacharDeps = makeDespacharDeps({ invocar });

    const resultado = await crearSolicitudInterna(
      { tipo: "gasto", detalle: "almuerzo", solicitanteId: "empleado-1" },
      { store, despacharDeps },
    );

    expect(store.adjuntarDictamen).toHaveBeenCalledTimes(1);
    const dictamenInput = vi.mocked(store.adjuntarDictamen).mock.calls[0]![0];
    expect(dictamenInput.dictamen).toBe("cumple las reglas");

    expect(resultado.resultado).toBe("creada");
    if (resultado.resultado !== "creada") throw new Error("esperaba 'creada'");
    expect(resultado.solicitud.estado).toBe(SOLICITUD_ESTADO_PENDIENTE);
    expect(resultado.solicitud.dictamen).toBe("cumple las reglas");
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("si la delegación al validador falla, degrada a evento (molde manejarSoporte, ADR 40) y NO relanza", async () => {
    const store = makeSolicitudStore();
    const invocar = vi.fn(async () => {
      throw new Error("el validador no respondió");
    });
    const logEvent = vi.fn();
    const despacharDeps = makeDespacharDeps({ invocar, logEvent });

    const resultado = await crearSolicitudInterna(
      { tipo: "vacaciones", detalle: "una semana en marzo", solicitanteId: "empleado-1" },
      { store, despacharDeps },
    );

    // La solicitud ya creada por crearSolicitudConCaso queda sin dictamen.
    expect(resultado.resultado).toBe("creada");
    if (resultado.resultado !== "creada") throw new Error("esperaba 'creada'");
    expect(resultado.solicitud.dictamen).toBeUndefined();
    expect(store.adjuntarDictamen).not.toHaveBeenCalled();

    expect(logEvent).toHaveBeenCalledWith(
      expect.any(String),
      "solicitud-validacion-fallida",
      expect.objectContaining({ message: "el validador no respondió" }),
    );
  });
});
