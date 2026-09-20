import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { consultarSolicitudPropia } from "./consultar-solicitud-propia.js";
import type { ConsultaSolicitudPropiaPort, SolicitudPropia } from "./consulta-solicitud-propia-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
} from "./solicitudes-contract.js";

/**
 * `consulta-solicitud-propia`, tarea 2.3 (ADR 238). Molde
 * `consultar-venta-propia.test.ts` — dobles del puerto con `vi.fn()`, sin BD.
 * ★ El más crítico (ADR 238): "ajena" tiene que ser distinguible de "no
 * encontrada" y sin filtrar un solo dato de la solicitud ajena.
 */

function buildSolicitudPropia(overrides: Partial<SolicitudPropia> = {}): SolicitudPropia {
  return {
    solicitudId: "solicitud-1",
    solicitanteId: "empleado-1",
    casoId: "caso-1",
    tipo: "vacaciones",
    detalle: "tres días",
    estado: SOLICITUD_ESTADO_PENDIENTE,
    dictamen: "aprobado por política",
    dictaminadaAt: "2026-09-01T00:00:00.000Z",
    resueltaPor: "empleado-2",
    resueltaAt: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeConsulta(overrides: Partial<ConsultaSolicitudPropiaPort> = {}): ConsultaSolicitudPropiaPort {
  return {
    buscarPorId: vi.fn(() => undefined),
    listarDeSolicitante: vi.fn(() => []),
    ...overrides,
  };
}

describe("consultarSolicitudPropia — listado sin solicitudId", () => {
  it("ausente ⇒ listado de TODAS las solicitudes propias del solicitante, y listarDeSolicitante recibe {solicitanteId} sin limite", () => {
    const items = [buildSolicitudPropia({ solicitudId: "solicitud-1" }), buildSolicitudPropia({ solicitudId: "solicitud-2" })];
    const listarDeSolicitante = vi.fn(() => items);
    const consulta = makeConsulta({ listarDeSolicitante });

    const resultado = consultarSolicitudPropia({ empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "listado", items });
    expect(listarDeSolicitante).toHaveBeenCalledWith({ solicitanteId: "empleado-1" });
  });

  it("el filtro NUNCA lleva `limite` — lo aplica el puerto por default", () => {
    const listarDeSolicitante = vi.fn((_filtro: Parameters<ConsultaSolicitudPropiaPort["listarDeSolicitante"]>[0]) => []);
    const consulta = makeConsulta({ listarDeSolicitante });

    consultarSolicitudPropia({ empleadoId: "empleado-1" }, { consulta });

    const filtro = listarDeSolicitante.mock.calls[0]?.[0];
    expect(filtro).not.toHaveProperty("limite");
  });
});

describe("consultarSolicitudPropia — solicitud inexistente", () => {
  it("buscarPorId devuelve undefined ⇒ no_encontrada", () => {
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => undefined) });

    const resultado = consultarSolicitudPropia({ solicitudId: "no-existe", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "no_encontrada", solicitudId: "no-existe" });
  });
});

describe("consultarSolicitudPropia — solicitud ajena", () => {
  it("solicitanteId distinto del empleado ⇒ no_autorizada", () => {
    const solicitud = buildSolicitudPropia({ solicitudId: "solicitud-1", solicitanteId: "otro-empleado" });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => solicitud) });

    const resultado = consultarSolicitudPropia({ solicitudId: "solicitud-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "no_autorizada", solicitudId: "solicitud-1" });
  });

  it("★★ ajena ≠ no encontrada (ADR 238): el resultado es EXACTAMENTE {resultado, solicitudId} — cero datos filtrados", () => {
    const solicitud = buildSolicitudPropia({
      solicitudId: "solicitud-1",
      solicitanteId: "otro-empleado",
      tipo: "gasto",
      detalle: "detalle ajeno, no debe verse",
      estado: SOLICITUD_ESTADO_APROBADA,
      dictamen: "dictamen ajeno, no debe verse",
      resueltaPor: "empleado-3",
    });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => solicitud) });

    const resultado = consultarSolicitudPropia({ solicitudId: "solicitud-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "no_autorizada", solicitudId: "solicitud-1" });
    expect(resultado.resultado).not.toBe("no_encontrada");
    expect(Object.keys(resultado).sort()).toEqual(["resultado", "solicitudId"]);
    expect(resultado).not.toHaveProperty("tipo");
    expect(resultado).not.toHaveProperty("detalle");
    expect(resultado).not.toHaveProperty("estado");
    expect(resultado).not.toHaveProperty("dictamen");
    expect(resultado).not.toHaveProperty("solicitanteId");
    expect(resultado).not.toHaveProperty("resueltaPor");
  });
});

describe("consultarSolicitudPropia — solicitud propia (detalle), para cada uno de los cuatro estados", () => {
  it.each([
    ["pendiente", SOLICITUD_ESTADO_PENDIENTE],
    ["aprobada", SOLICITUD_ESTADO_APROBADA],
    ["rechazada", SOLICITUD_ESTADO_RECHAZADA],
    ["cancelada", SOLICITUD_ESTADO_CANCELADA],
  ] as const)("estado %s ⇒ detalle con la solicitud completa", (_nombre, estado) => {
    const solicitud = buildSolicitudPropia({ solicitudId: "solicitud-1", solicitanteId: "empleado-1", estado });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => solicitud) });

    const resultado = consultarSolicitudPropia({ solicitudId: "solicitud-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "detalle", solicitud });
  });
});

describe("consultarSolicitudPropia — CERO escrituras, en cualquier rama", () => {
  it("con solicitudId, ausente y ajena — el módulo sólo invoca métodos de lectura del puerto", () => {
    const solicitud = buildSolicitudPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => solicitud) });

    consultarSolicitudPropia({ solicitudId: "solicitud-1", empleadoId: "empleado-1" }, { consulta });
    consultarSolicitudPropia({ empleadoId: "empleado-1" }, { consulta });

    // `ConsultaSolicitudPropiaPort` sólo declara los dos métodos de lectura —
    // no hay ningún método de escritura que pudiera haberse invocado.
    expect(Object.keys(consulta)).toEqual(["buscarPorId", "listarDeSolicitante"]);
  });
});

describe("consultarSolicitudPropia — test mecánico sobre el código fuente (molde ejecutar-operacion.test.ts:1389-1395)", () => {
  it("★ el módulo no reimplementa escrituras/auditoría ni es asíncrono, y su único import es el contrato de lectura", () => {
    const sourcePath = fileURLToPath(new URL("./consultar-solicitud-propia.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    // Los identificadores prohibidos se buscan sobre la fuente SIN comentarios
    // — un doc-comment inocente no debe romper este test.
    const sourceSinComentarios = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(sourceSinComentarios).not.toMatch(/StorePort/);
    expect(sourceSinComentarios).not.toMatch(/registrarAccion/);
    expect(sourceSinComentarios).not.toMatch(/aprobar/i);
    expect(sourceSinComentarios).not.toMatch(/rechazar/i);
    expect(sourceSinComentarios).not.toMatch(/cancelar/i);
    expect(sourceSinComentarios).not.toMatch(/\basync\b/);
    expect(sourceSinComentarios).not.toMatch(/\bawait\b/);

    const imports = [...sourceSinComentarios.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["./consulta-solicitud-propia-contract.js"]);
  });
});
