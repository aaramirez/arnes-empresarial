import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOLICITUD_ESTADO_PENDIENTE, SOLICITUD_TIPO_VACACIONES, type SolicitudInterna } from "./solicitudes-contract.js";
import type { ConsultaSolicitudesPort } from "./consulta-solicitudes-contract.js";

const SOLICITUD_SIMULADA: SolicitudInterna = {
  id: "solicitud-1",
  casoId: "caso-1",
  solicitanteId: "empleado-1",
  tipo: SOLICITUD_TIPO_VACACIONES,
  detalle: "Vacaciones de fin de año",
  estado: SOLICITUD_ESTADO_PENDIENTE,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("ConsultaSolicitudesPort", () => {
  it("un doble que implementa el puerto compila contra la interfaz y listarPendientes devuelve SolicitudInterna[]", () => {
    const port: ConsultaSolicitudesPort = {
      listarPendientes() {
        return [SOLICITUD_SIMULADA];
      },
    };

    expect(port.listarPendientes()).toEqual([SOLICITUD_SIMULADA]);
  });

  it("la firma de listarPendientes NO acepta ningún parámetro — aridad 0 (el llamador A2A no tiene solicitanteId que filtrar, ADR 180 pto 1)", () => {
    const port: ConsultaSolicitudesPort = {
      listarPendientes() {
        return [];
      },
    };

    expect(port.listarPendientes.length).toBe(0);
  });

  it("devuelve lista vacía cuando no hay solicitudes pendientes", () => {
    const port: ConsultaSolicitudesPort = {
      listarPendientes() {
        return [];
      },
    };

    expect(port.listarPendientes()).toEqual([]);
  });
});

describe("consulta-solicitudes-contract.ts source", () => {
  it("no importa nada salvo solicitudes-contract.js", () => {
    const sourcePath = fileURLToPath(new URL("./consulta-solicitudes-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const importLines = source.match(/^import .*/gm) ?? [];

    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\.\/solicitudes-contract\.js/);
  });
});
