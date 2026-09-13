import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVIDAD_ESTADOS, type ActividadEstado } from "../activity/activity-contract.js";
import type { ActividadResumen, ConsultaActividadPort } from "./consulta-actividad-contract.js";

describe("ConsultaActividadPort", () => {
  it("un doble plano que implementa el puerto compila contra la interfaz y buscarPorReferencia devuelve {estado, updatedAt}", () => {
    const estadoSimulado: ActividadEstado = ACTIVIDAD_ESTADOS[1];
    const actividadSimulada: ActividadResumen = {
      estado: estadoSimulado,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    const port: ConsultaActividadPort = {
      buscarPorReferencia(input) {
        expect(input.proyectoId).toBe("owner/repo");
        expect(input.referenciaExterna).toBe("42");
        return actividadSimulada;
      },
    };

    const resultado = port.buscarPorReferencia({ proyectoId: "owner/repo", referenciaExterna: "42" });

    expect(resultado).toEqual(actividadSimulada);
  });

  it("aserción de FORMA: el objeto devuelto tiene EXACTAMENTE las claves estado/updatedAt — sin responsableId ni id", () => {
    const port: ConsultaActividadPort = {
      buscarPorReferencia() {
        return { estado: ACTIVIDAD_ESTADOS[0], updatedAt: "2026-09-01T00:00:00.000Z" };
      },
    };

    const resultado = port.buscarPorReferencia({ proyectoId: "owner/repo", referenciaExterna: "42" });

    expect(Object.keys(resultado ?? {}).sort()).toEqual(["estado", "updatedAt"]);
    expect(resultado).not.toHaveProperty("responsableId");
    expect(resultado).not.toHaveProperty("id");
  });

  it("devuelve undefined cuando no hay actividad viva para esa referencia", () => {
    const port: ConsultaActividadPort = {
      buscarPorReferencia() {
        return undefined;
      },
    };

    expect(
      port.buscarPorReferencia({ proyectoId: "owner/repo", referenciaExterna: "inexistente" }),
    ).toBeUndefined();
  });
});

describe("consulta-actividad-contract.ts source", () => {
  it("no importa nada salvo activity-contract.js — y no expone getActividadById (ADR 187)", () => {
    const sourcePath = fileURLToPath(new URL("./consulta-actividad-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const importLines = source.match(/^import .*/gm) ?? [];

    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\.\.\/activity\/activity-contract\.js/);
    expect(source).not.toMatch(/getActividadById/);
  });
});
