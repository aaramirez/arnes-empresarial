import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { solicitarDevolucion, type SolicitarDevolucionDeps } from "./solicitar-devolucion.js";
import type { ConsultaVentaPropiaPort, VentaPropia } from "./consulta-venta-contract.js";
import type { JustificacionDevolucionPort } from "./justificacion-devolucion-contract.js";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  type CrearVentaConCasoInput,
  type NotificacionResultado,
  type ResolucionEscalacionInput,
  type Venta,
  type VentaStorePort,
} from "./ventas-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

/**
 * `devolucion-sin-token-dos-personas`, tarea 14 (ADR 223, ADR 227 pto 5, ADR
 * 228). ★ El módulo más delicado del change: escala SIEMPRE sin mirar el
 * monto, y jamás importa ni menciona `evaluarReembolso`/`aprobarReembolso`
 * ni la subcadena de la credencial del camino con la que este cambio
 * convive (verificado abajo con el test mecánico de ausencia, molde
 * `ejecutar-operacion.test.ts:975` de `aprobacion-conversacional-hitl`).
 */

const SESION: SesionEmpleado = { empleadoId: "empleado-1", iniciadaEn: "2026-09-17T09:00:00.000Z" };
const AHORA = "2026-09-17T10:00:00.000Z";

function buildVentaPropia(overrides: Partial<VentaPropia> = {}): VentaPropia {
  return {
    ventaId: "venta-1",
    vendedorId: "empleado-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 1000,
    estado: VENTA_ESTADO_CONFIRMADA,
    casoId: "caso-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeConsulta(overrides: Partial<ConsultaVentaPropiaPort> = {}): ConsultaVentaPropiaPort {
  return {
    buscarPorId: vi.fn(() => {
      throw new Error("buscarPorId no debía invocarse");
    }),
    listarDeVendedor: vi.fn(() => {
      throw new Error("listarDeVendedor no debía invocarse");
    }),
    ...overrides,
  };
}

function makeJustificacion(overrides: Partial<JustificacionDevolucionPort> = {}): JustificacionDevolucionPort {
  return {
    registrar: vi.fn(() => {
      throw new Error("registrar no debía invocarse");
    }),
    ...overrides,
  };
}

/** Doble mínimo — cada método lanza si se invoca, salvo los que el test sobreescribe. */
function makeStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  const noop = (nombre: string) => () => {
    throw new Error(`${nombre} no debía invocarse`);
  };
  return {
    crearVentaConCaso: noop("crearVentaConCaso") as unknown as (input: CrearVentaConCasoInput) => Venta,
    buscarVentaPorToken: noop("buscarVentaPorToken") as unknown as (token: string) => Venta | undefined,
    confirmarVentaConComision: noop("confirmarVentaConComision") as never,
    rechazarVenta: noop("rechazarVenta") as never,
    aprobarReembolso: noop("aprobarReembolso") as never,
    escalarReembolso: noop("escalarReembolso") as never,
    listarReembolsosPendientes: noop("listarReembolsosPendientes") as never,
    listarReembolsosRechazados: noop("listarReembolsosRechazados") as never,
    aprobarEscalacionReembolso: noop("aprobarEscalacionReembolso") as unknown as (
      input: ResolucionEscalacionInput,
    ) => Venta | undefined,
    rechazarEscalacionReembolso: noop("rechazarEscalacionReembolso") as unknown as (
      input: ResolucionEscalacionInput,
    ) => Venta | undefined,
    reabrirEscalacionReembolso: noop("reabrirEscalacionReembolso") as unknown as (
      input: ResolucionEscalacionInput,
    ) => Venta | undefined,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SolicitarDevolucionDeps> = {}): SolicitarDevolucionDeps {
  return {
    consulta: makeConsulta(),
    justificacion: makeJustificacion(),
    store: makeStore(),
    newId: vi.fn(() => "just-1"),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("★ test mecánico de ausencia (ADR 223 pto 3, ADR 227 pto 5): la fuente no menciona evaluarReembolso, aprobarReembolso ni la subcadena del secreto de confirmación", () => {
  it("ninguno de los tres símbolos aparece en el archivo fuente", () => {
    const sourcePath = fileURLToPath(new URL("./solicitar-devolucion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toContain("evaluarReembolso");
    expect(source).not.toContain("aprobarReembolso");
    expect(source.toLowerCase()).not.toContain("token");
  });
});

describe("solicitarDevolucion — listado sin ventaId", () => {
  it("lista SÓLO ventas confirmada del vendedor, CERO escrituras", () => {
    const items = [buildVentaPropia()];
    const listarDeVendedor = vi.fn(() => items);
    const consulta = makeConsulta({ listarDeVendedor });
    const deps = makeDeps({ consulta });

    const resultado = solicitarDevolucion({ confirmado: false, sesion: SESION }, deps);

    expect(resultado).toEqual({ resultado: "listado", items });
    expect(listarDeVendedor).toHaveBeenCalledWith({
      vendedorId: SESION.empleadoId,
      estados: [VENTA_ESTADO_CONFIRMADA],
    });
  });
});

describe("solicitarDevolucion — motivo inválido, ANTES de leer la venta (ADR 228 pto 2)", () => {
  it.each([
    ["ausente", undefined],
    ["blanco", "   "],
    ["257 caracteres", "x".repeat(257)],
  ])("motivo %s ⇒ motivo_invalido, CERO lecturas y CERO escrituras", (_nombre, motivo) => {
    const deps = makeDeps();

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", confirmado: true, sesion: SESION, ...(motivo !== undefined ? { motivo } : {}) },
      deps,
    );

    expect(resultado).toEqual({ resultado: "motivo_invalido" });
    expect(deps.consulta.buscarPorId).not.toHaveBeenCalled();
    expect(deps.justificacion.registrar).not.toHaveBeenCalled();
  });

  it("motivo de exactamente 256 caracteres (el límite) NO es inválido — sigue el flujo normal", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const deps = makeDeps({ consulta });

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", motivo: "x".repeat(256), confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado.resultado).not.toBe("motivo_invalido");
  });
});

describe("solicitarDevolucion — venta inexistente", () => {
  it("buscarPorId undefined ⇒ no_encontrada", () => {
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => undefined) });
    const deps = makeDeps({ consulta });

    const resultado = solicitarDevolucion(
      { ventaId: "no-existe", motivo: "el cliente se arrepintió", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_encontrada", ventaId: "no-existe" });
  });
});

describe("solicitarDevolucion — venta ajena, ANTES del eco (ADR 228 pto 2)", () => {
  it("★ vendedorId !== empleadoId ⇒ no_autorizada, distinguible de no_encontrada, CERO escrituras", () => {
    const venta = buildVentaPropia({ vendedorId: "otro-vendedor" });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const deps = makeDeps({ consulta });

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", motivo: "motivo válido", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_autorizada", ventaId: "venta-1", casoId: "caso-1" });
    expect(resultado.resultado).not.toBe("no_encontrada");
    expect(deps.justificacion.registrar).not.toHaveBeenCalled();
  });
});

describe("solicitarDevolucion — primer turno (sin confirmar)", () => {
  it("!confirmado ⇒ requiere_confirmacion con la VentaPropia completa, CERO escrituras", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const deps = makeDeps({ consulta });

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", motivo: "el cliente se arrepintió", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({ resultado: "requiere_confirmacion", venta });
    expect(deps.justificacion.registrar).not.toHaveBeenCalled();
  });
});

describe("★ solicitarDevolucion — SIEMPRE escala, sin mirar el monto (ADR 223 pto 2)", () => {
  it("monto MUY por debajo del umbral ⇒ escalada, JAMÁS invoca el CAS de autoaprobación", () => {
    const venta = buildVentaPropia({ monto: 1 });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const ventaEscalada: Venta = {
      id: "venta-1",
      vendedorId: "empleado-1",
      clienteId: "cliente-1",
      planNuevo: "plan-pro",
      monto: 1,
      estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
      casoId: "caso-1",
      tokenConfirmacion: "TOKEN-SECRETO-RECONOCIBLE-XYZ",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const escalarReembolso = vi.fn(() => ventaEscalada);
    // ★ Si el módulo alguna vez invocara este método, el reembolso unilateral volvería a existir.
    const aprobarReembolso = vi.fn(() => {
      throw new Error("aprobarReembolso NUNCA debe invocarse desde este módulo (ADR 223 pto 3)");
    });
    const store = makeStore({ escalarReembolso, aprobarReembolso });
    const justificacion = makeJustificacion({ registrar: vi.fn() });
    const deps = makeDeps({ consulta, store, justificacion });

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", motivo: "el cliente se arrepintió", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({ resultado: "escalada", ventaId: "venta-1", casoId: "caso-1" });
    expect(aprobarReembolso).not.toHaveBeenCalled();
    expect(escalarReembolso).toHaveBeenCalledWith({ ventaId: "venta-1", casoId: "caso-1", ahora: AHORA });
    // ★ El valor de retorno del CAS (con el secreto de confirmación en el fixture) NUNCA se propaga al Result.
    expect(JSON.stringify(resultado)).not.toContain("TOKEN-SECRETO-RECONOCIBLE-XYZ");
    expect(resultado).not.toHaveProperty("tokenConfirmacion");
  });

  it("★ orden de escritura: la justificación se registra ANTES del CAS", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const orden: string[] = [];
    const registrar = vi.fn(() => {
      orden.push("justificacion");
    });
    const escalarReembolso = vi.fn(() => {
      orden.push("cas");
      return { ...venta, tokenConfirmacion: "t" } as unknown as Venta;
    });
    const store = makeStore({ escalarReembolso });
    const justificacion = makeJustificacion({ registrar });
    const deps = makeDeps({ consulta, store, justificacion });

    solicitarDevolucion({ ventaId: "venta-1", motivo: "motivo válido", confirmado: true, sesion: SESION }, deps);

    expect(orden).toEqual(["justificacion", "cas"]);
  });

  it("★ si el CAS devuelve undefined, la justificación YA quedó escrita (fila huérfana) y el resultado es no_aplicable", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const registrar = vi.fn();
    const escalarReembolso = vi.fn(() => undefined);
    const store = makeStore({ escalarReembolso });
    const justificacion = makeJustificacion({ registrar });
    const deps = makeDeps({ consulta, store, justificacion });

    const resultado = solicitarDevolucion(
      { ventaId: "venta-1", motivo: "motivo válido", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_aplicable", ventaId: "venta-1", casoId: "caso-1" });
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it("la justificación se registra con solicitanteId de la sesión y el motivo tal cual", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const registrar = vi.fn();
    const escalarReembolso = vi.fn(() => ({ ...venta, tokenConfirmacion: "t" }) as unknown as Venta);
    const store = makeStore({ escalarReembolso });
    const justificacion = makeJustificacion({ registrar });
    const deps = makeDeps({ consulta, store, justificacion, newId: vi.fn(() => "just-99") });

    solicitarDevolucion(
      { ventaId: "venta-1", motivo: "el cliente se arrepintió, no era lo que buscaba", confirmado: true, sesion: SESION },
      deps,
    );

    expect(registrar).toHaveBeenCalledWith({
      id: "just-99",
      ventaId: "venta-1",
      casoId: "caso-1",
      solicitanteId: SESION.empleadoId,
      motivo: "el cliente se arrepintió, no era lo que buscaba",
      solicitadaAt: AHORA,
    });
  });
});

describe("solicitarDevolucion — el motivo NUNCA aparece en logEvent (R13)", () => {
  it("ningún evento emitido contiene el texto del motivo", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });
    const escalarReembolso = vi.fn(() => ({ ...venta, tokenConfirmacion: "t" }) as unknown as Venta);
    const store = makeStore({ escalarReembolso });
    const justificacion = makeJustificacion({ registrar: vi.fn() });
    const logEvent = vi.fn();
    const motivoSecreto = "MOTIVO-DE-TEXTO-LIBRE-RECONOCIBLE";
    const deps = makeDeps({ consulta, store, justificacion, logEvent });

    solicitarDevolucion({ ventaId: "venta-1", motivo: motivoSecreto, confirmado: true, sesion: SESION }, deps);
    solicitarDevolucion({ ventaId: "venta-1", motivo: motivoSecreto, confirmado: false, sesion: SESION }, deps);

    for (const llamada of logEvent.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain(motivoSecreto);
    }
  });
});
