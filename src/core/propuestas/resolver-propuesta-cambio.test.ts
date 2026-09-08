import { describe, expect, it, vi } from "vitest";
import { MOTIVO_CAS, MOTIVO_NO_ENCONTRADA } from "../hitl/hitl-contract.js";
import {
  PROPUESTA_ESTADO_APLICADA,
  PROPUESTA_ESTADO_DESCARTADA,
  PROPUESTA_ESTADO_PENDIENTE,
  type PropuestaCambio,
  type PropuestaStorePort,
  type ResolucionPropuestaInput,
} from "./propuestas-contract.js";
import {
  ACCION_APLICAR_PROPUESTA,
  ACCION_DESCARTAR_PROPUESTA,
  resolverPropuestaCambio,
  type ResolverPropuestaDeps,
} from "./resolver-propuesta-cambio.js";
import type { SesionEmpleado } from "../auth/sesion.js";

/**
 * Spec `propuesta-cambio-hitl` (Hito 5.1, tarea 20, design.md §5.7, ADR 37,
 * ADR 50, ADR 64). Molde LITERAL de `resolver-solicitud-interna.test.ts`
 * (Hito 5, tarea 18) — dobles planos de `PropuestaStorePort`, nunca SQLite
 * real, mismo criterio que `resolver-escalacion-reembolso.test.ts` y
 * `resolver-solicitud-interna.test.ts`.
 */

const AHORA = "2026-09-07T10:00:00.000Z";
const SESION: SesionEmpleado = { empleadoId: "ana", iniciadaEn: "2026-09-07T09:00:00.000Z" };

function buildPropuesta(overrides: Partial<PropuestaCambio> = {}): PropuestaCambio {
  return {
    id: "propuesta-1",
    casoId: "caso-1",
    baseCommit: "abc123",
    ramaWorktree: "harness/developer/caso-1",
    patch: "diff --git a/a.ts b/a.ts\n+contenido\n",
    patchBytes: 42,
    archivos: 1,
    lineasAgregadas: 1,
    lineasEliminadas: 0,
    estado: PROPUESTA_ESTADO_PENDIENTE,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(overrides: Partial<PropuestaStorePort> = {}): PropuestaStorePort {
  return {
    crearPropuesta: vi.fn(),
    obtenerPropuesta: vi.fn(),
    listarPropuestasPendientes: vi.fn(() => [buildPropuesta()]),
    aplicarPropuesta: vi.fn(() => undefined),
    descartarPropuesta: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ResolverPropuestaDeps> = {}): ResolverPropuestaDeps {
  return {
    store: makeStore(),
    newId: vi.fn(() => "accion-1"),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("resolverPropuestaCambio", () => {
  it("sin propuestaId → listado con listarPropuestasPendientes, CERO escrituras", () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado.resultado).toBe("listado");
    expect(store.listarPropuestasPendientes).toHaveBeenCalledWith({ limite: 20 });
    expect(store.aplicarPropuesta).not.toHaveBeenCalled();
    expect(store.descartarPropuesta).not.toHaveBeenCalled();
  });

  it("sin propuestaId respeta limiteListado explícito", () => {
    const store = makeStore();
    const deps = makeDeps({ store, limiteListado: 5 });

    resolverPropuestaCambio({ accion: ACCION_APLICAR_PROPUESTA, confirmado: false, sesion: SESION }, deps);

    expect(store.listarPropuestasPendientes).toHaveBeenCalledWith({ limite: 5 });
  });

  it("propuestaId inexistente → no_aplicable/no_encontrada, sin escrituras", () => {
    const store = makeStore({ listarPropuestasPendientes: vi.fn(() => []) });
    const deps = makeDeps({ store });

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-x", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APLICAR_PROPUESTA,
      motivo: MOTIVO_NO_ENCONTRADA,
      itemId: "propuesta-x",
    });
    expect(store.aplicarPropuesta).not.toHaveBeenCalled();
    expect(store.descartarPropuesta).not.toHaveBeenCalled();
  });

  it("confirmado:false con propuestaId presente → requiere_confirmacion (eco), CERO escrituras", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1" });
    const store = makeStore({ listarPropuestasPendientes: vi.fn(() => [propuesta]) });
    const deps = makeDeps({ store });

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "requiere_confirmacion",
      accion: ACCION_APLICAR_PROPUESTA,
      item: propuesta,
    });
    expect(store.aplicarPropuesta).not.toHaveBeenCalled();
    expect(store.descartarPropuesta).not.toHaveBeenCalled();
  });

  it("confirmado:true (aplicar) → store.aplicarPropuesta con {propuestaId, casoId, empleadoId, accionId, ahora} exactos, sesion no empleadoId suelto", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9" });
    const resuelta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9", estado: PROPUESTA_ESTADO_APLICADA });
    const store = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      aplicarPropuesta: vi.fn(() => resuelta),
    });
    const deps = makeDeps({ store, newId: vi.fn(() => "accion-77"), now: vi.fn(() => AHORA) });

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: true, sesion: SESION },
      deps,
    );

    const inputEsperado: ResolucionPropuestaInput = {
      propuestaId: "propuesta-1",
      casoId: "caso-9",
      empleadoId: "ana",
      accionId: "accion-77",
      ahora: AHORA,
    };
    expect(store.aplicarPropuesta).toHaveBeenCalledWith(inputEsperado);
    expect(store.descartarPropuesta).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      resultado: "aplicada",
      accion: ACCION_APLICAR_PROPUESTA,
      item: propuesta,
      estadoFinal: PROPUESTA_ESTADO_APLICADA,
    });
  });

  it("confirmado:true (descartar) con motivo → store.descartarPropuesta recibe motivo", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9" });
    const resuelta = buildPropuesta({
      id: "propuesta-1",
      casoId: "caso-9",
      estado: PROPUESTA_ESTADO_DESCARTADA,
      motivo: "ya no aplica",
    });
    const store = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      descartarPropuesta: vi.fn(() => resuelta),
    });
    const deps = makeDeps({ store, newId: vi.fn(() => "accion-77"), now: vi.fn(() => AHORA) });

    const resultado = resolverPropuestaCambio(
      {
        accion: ACCION_DESCARTAR_PROPUESTA,
        propuestaId: "propuesta-1",
        motivo: "ya no aplica",
        confirmado: true,
        sesion: SESION,
      },
      deps,
    );

    const inputEsperado: ResolucionPropuestaInput = {
      propuestaId: "propuesta-1",
      casoId: "caso-9",
      empleadoId: "ana",
      accionId: "accion-77",
      ahora: AHORA,
      motivo: "ya no aplica",
    };
    expect(store.descartarPropuesta).toHaveBeenCalledWith(inputEsperado);
    expect(store.aplicarPropuesta).not.toHaveBeenCalled();
    expect(resultado.resultado).toBe("aplicada");
    if (resultado.resultado === "aplicada") {
      expect(resultado.estadoFinal).toBe(PROPUESTA_ESTADO_DESCARTADA);
    }
  });

  it("motivo ausente no viaja como undefined explícito al store (exactOptionalPropertyTypes)", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9" });
    const resuelta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9", estado: PROPUESTA_ESTADO_APLICADA });
    const aplicarPropuesta = vi.fn((_input: ResolucionPropuestaInput) => resuelta);
    const store = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      aplicarPropuesta,
    });
    const deps = makeDeps({ store });

    resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: true, sesion: SESION },
      deps,
    );

    const inputRecibido = vi.mocked(aplicarPropuesta).mock.calls[0]![0];
    expect("motivo" in inputRecibido).toBe(false);
  });

  it("CAS devuelve undefined (aplicar) → no_aplicable/cas, sin lanzar", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-1" });
    const store = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      aplicarPropuesta: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof resolverPropuestaCambio> | undefined;
    expect(() => {
      resultado = resolverPropuestaCambio(
        { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: true, sesion: SESION },
        deps,
      );
    }).not.toThrow();

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APLICAR_PROPUESTA,
      motivo: MOTIVO_CAS,
      itemId: "propuesta-1",
      casoId: "caso-1",
    });
  });

  it("CAS devuelve undefined (descartar) → no_aplicable/cas, sin lanzar", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-1" });
    const store = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      descartarPropuesta: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_DESCARTAR_PROPUESTA, propuestaId: "propuesta-1", motivo: "x", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_DESCARTAR_PROPUESTA,
      motivo: MOTIVO_CAS,
      itemId: "propuesta-1",
      casoId: "caso-1",
    });
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable, y la función no es AsyncFunction", () => {
    const deps = makeDeps();

    expect(resolverPropuestaCambio.constructor.name).not.toBe("AsyncFunction");

    const resultado = resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });

  it("nunca hace await: el resolvedor nunca llama a un `git apply --check` (ADR 64) — sólo interpreta el resultado del store", () => {
    // El resolvedor no recibe ningún puerto de git en sus deps: la única
    // superficie de I/O es `store` (síncrono), `newId` y `now`. Si alguna vez
    // se cuela un `await` en el cuerpo de la función, el test de sincronía de
    // arriba (constructor.name !== "AsyncFunction") ya lo detecta; este test
    // documenta la intención de diseño (ADR 64): `git apply --check` vive en
    // el dispatcher, nunca en este módulo.
    const deps = makeDeps();
    expect(Object.keys(deps)).not.toContain("aplicarPatch");
    expect(Object.keys(deps)).not.toContain("git");
  });

  it("logEvent registra propuesta-listada / propuesta-resolucion-solicitada / propuesta-aplicada con los campos del diseño", () => {
    const propuesta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9" });
    const resuelta = buildPropuesta({ id: "propuesta-1", casoId: "caso-9", estado: PROPUESTA_ESTADO_APLICADA });
    const logEvent = vi.fn();

    const storeListado = makeStore();
    resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, confirmado: false, sesion: SESION },
      makeDeps({ store: storeListado, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("tui-comando", "propuesta-listada", {
      accion: ACCION_APLICAR_PROPUESTA,
      cantidad: 1,
    });

    logEvent.mockClear();
    const storeEco = makeStore({ listarPropuestasPendientes: vi.fn(() => [propuesta]) });
    resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: false, sesion: SESION },
      makeDeps({ store: storeEco, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("caso-9", "propuesta-resolucion-solicitada", {
      accion: ACCION_APLICAR_PROPUESTA,
      propuestaId: "propuesta-1",
    });

    logEvent.mockClear();
    const storeAplicada = makeStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      aplicarPropuesta: vi.fn(() => resuelta),
    });
    resolverPropuestaCambio(
      { accion: ACCION_APLICAR_PROPUESTA, propuestaId: "propuesta-1", confirmado: true, sesion: SESION },
      makeDeps({ store: storeAplicada, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("caso-9", "propuesta-aplicada", {
      propuestaId: "propuesta-1",
      empleadoId: "ana",
    });
  });
});
