import { describe, expect, it } from "vitest";
import {
  CONSULTAS_MCP_SERVER_NAME,
  CONSULTAS_TOOL_NAME,
  CONSULTAS_TOOL_QUALIFIED_NAME,
  validarConsultaNegocio,
} from "./consultas-negocio-tool.js";

/**
 * consultas-negocio-a2a-entrante, tarea 4 (PR2 — sólo la porción de
 * VALIDACIÓN, ADR 184). Este archivo arranca acá y crece en la tarea 5
 * (orquestación + recorte, PR3) — no se adelanta esa porción.
 *
 * Whitelist ESTRICTA por operación, mismo criterio que
 * `src/core/operaciones/validar-operacion.ts` del change hermano
 * (`operaciones-negocio-conversacionales`): `solicitudes_pendientes` y
 * `reembolsos_pendientes` no aceptan NINGÚN campo adicional — es la señal,
 * verificable por test, de que esas dos operaciones no tienen forma de
 * filtrar por identidad porque no reciben ningún parámetro que pudiera
 * intentarlo (spec `consultas-negocio-a2a`).
 */

describe("constantes MCP de la tool consultas", () => {
  it("CONSULTAS_MCP_SERVER_NAME es 'consultas'", () => {
    expect(CONSULTAS_MCP_SERVER_NAME).toBe("consultas");
  });

  it("CONSULTAS_TOOL_NAME es 'consultar_negocio'", () => {
    expect(CONSULTAS_TOOL_NAME).toBe("consultar_negocio");
  });

  it("CONSULTAS_TOOL_QUALIFIED_NAME es 'mcp__consultas__consultar_negocio'", () => {
    expect(CONSULTAS_TOOL_QUALIFIED_NAME).toBe("mcp__consultas__consultar_negocio");
  });
});

describe("validarConsultaNegocio — forma exacta de cada una de las 4 operaciones ⇒ acepta", () => {
  it("reporte_comisiones: { operacion, periodo } se acepta", () => {
    const input = { operacion: "reporte_comisiones", periodo: "2026-08" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("estado_actividad: { operacion, proyectoId, referenciaExterna } se acepta", () => {
    const input = { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-42" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("solicitudes_pendientes: { operacion } se acepta", () => {
    const input = { operacion: "solicitudes_pendientes" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("reembolsos_pendientes: { operacion } se acepta", () => {
    const input = { operacion: "reembolsos_pendientes" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });
});

describe("validarConsultaNegocio — Punto obligatorio 1: clave extra en solicitudes_pendientes/reembolsos_pendientes ⇒ rechazo, sin tocar ningún puerto", () => {
  it.each([
    { operacion: "solicitudes_pendientes", periodo: "2026-08" },
    { operacion: "solicitudes_pendientes", proyectoId: "proyecto-1" },
    { operacion: "solicitudes_pendientes", campoInventado: "x" },
    { operacion: "reembolsos_pendientes", periodo: "2026-08" },
    { operacion: "reembolsos_pendientes", proyectoId: "proyecto-1" },
    { operacion: "reembolsos_pendientes", campoInventado: "x" },
  ])("$operacion con clave extra ⇒ rechazo", (input) => {
    const resultado = validarConsultaNegocio(input);
    expect(resultado).not.toBe(input);
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — reporte_comisiones, rechazo", () => {
  it("sin periodo ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "reporte_comisiones" });
    expect(resultado).toHaveProperty("rechazo");
  });

  it("con proyectoId en vez de periodo ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "reporte_comisiones", proyectoId: "proyecto-1" });
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — estado_actividad, rechazo", () => {
  it("sin referenciaExterna ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "estado_actividad", proyectoId: "proyecto-1" });
    expect(resultado).toHaveProperty("rechazo");
  });

  it("con periodo en vez de proyectoId/referenciaExterna ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "estado_actividad", periodo: "2026-08" });
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — operación fuera del conjunto cerrado", () => {
  it("operacion desconocida ⇒ rechazo", () => {
    expect(validarConsultaNegocio({ operacion: "borrar_todo" })).toHaveProperty("rechazo");
  });

  it("operacion ausente o no-string ⇒ rechazo", () => {
    expect(validarConsultaNegocio({})).toHaveProperty("rechazo");
    expect(validarConsultaNegocio({ operacion: 123 })).toHaveProperty("rechazo");
  });
});
