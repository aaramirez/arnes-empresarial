import { describe, expect, it } from "vitest";
import {
  LIMITE_LISTADO_SOLICITUDES_PROPIAS,
  type ConsultaSolicitudPropiaPort,
  type SolicitudPropia,
} from "./consulta-solicitud-propia-contract.js";

/**
 * `consulta-solicitud-propia`, tarea 2.1 (ADR 237, ADR 239). Molde
 * `consulta-venta-contract.test.ts:45-46`. ★ Riesgo del change: `SolicitudPropia`
 * tiene ONCE campos, uno menos que las doce columnas de `solicitudes_internas`
 * — `updated_at` queda excluido, garantía ESTRUCTURAL verificada acá.
 */

const ONCE_CAMPOS = [
  "solicitudId",
  "solicitanteId",
  "casoId",
  "tipo",
  "detalle",
  "estado",
  "dictamen",
  "dictaminadaAt",
  "resueltaPor",
  "resueltaAt",
  "createdAt",
].sort();

function buildSolicitudPropia(overrides: Partial<SolicitudPropia> = {}): SolicitudPropia {
  return {
    solicitudId: "solicitud-1",
    solicitanteId: "empleado-1",
    casoId: "caso-1",
    tipo: "vacaciones",
    detalle: "tres días",
    estado: "pendiente_aprobacion_humana",
    dictamen: "aprobado por política",
    dictaminadaAt: "2026-09-01T00:00:00.000Z",
    resueltaPor: "empleado-2",
    resueltaAt: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("SolicitudPropia — invariante estructural de once campos, sin updatedAt (ADR 239)", () => {
  it("★ Object.keys(...).sort() es exactamente el conjunto de los once campos esperados", () => {
    const solicitud = buildSolicitudPropia();

    expect(Object.keys(solicitud).sort()).toEqual(ONCE_CAMPOS);
  });

  it("★ un literal con updatedAt de más no compila (garantía estructural)", () => {
    // @ts-expect-error — `SolicitudPropia` no tiene `updatedAt` (ADR 239, exclusión deliberada de metadato de fila).
    const conUpdatedAt: SolicitudPropia = { ...buildSolicitudPropia(), updatedAt: "2026-09-03T00:00:00.000Z" };

    expect(conUpdatedAt).toBeDefined();
  });

  it("LIMITE_LISTADO_SOLICITUDES_PROPIAS es 20 (constante por LECTOR, RD-114 pto 3)", () => {
    expect(LIMITE_LISTADO_SOLICITUDES_PROPIAS).toBe(20);
  });
});

describe("ConsultaSolicitudPropiaPort — un doble compila con las dos firmas exactas", () => {
  it("buscarPorId y listarDeSolicitante, sin ningún método de escritura en la interfaz", () => {
    const solicitudes = new Map<string, SolicitudPropia>([["solicitud-1", buildSolicitudPropia()]]);

    const port: ConsultaSolicitudPropiaPort = {
      buscarPorId: (solicitudId) => solicitudes.get(solicitudId),
      listarDeSolicitante: ({ solicitanteId, limite }) => {
        const todas = [...solicitudes.values()].filter((s) => s.solicitanteId === solicitanteId);
        return todas.slice(0, limite ?? LIMITE_LISTADO_SOLICITUDES_PROPIAS);
      },
    };

    expect(port.buscarPorId("solicitud-1")?.solicitudId).toBe("solicitud-1");
    expect(port.buscarPorId("no-existe")).toBeUndefined();
    expect(port.listarDeSolicitante({ solicitanteId: "empleado-1" })).toHaveLength(1);
    expect(port.listarDeSolicitante({ solicitanteId: "otro" })).toHaveLength(0);
  });
});
