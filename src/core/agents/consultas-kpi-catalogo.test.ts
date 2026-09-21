import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONSULTAS_KPI,
  INSTRUCCION_CONSULTA_KPI,
  esConsultaKpiConocida,
  materialDeConsultaKpi,
  type ConsultaKpiClave,
} from "./consultas-kpi-catalogo.js";

/**
 * Recorta el cuerpo de una función de nivel de módulo, por NOMBRE.
 * LANZA si no la encuentra — así el test es ROJO mientras la función no exista,
 * en vez de pasar en vacío sobre un string vacío.
 */
function cuerpoDeFuncion(source: string, nombre: string): string {
  const inicio = source.indexOf(`function ${nombre}(`); // cubre `async function X(`
  if (inicio === -1) throw new Error(`no existe function ${nombre} en el fuente`);
  const resto = source.slice(inicio + 1);
  const siguiente = resto.search(/\n(?:export )?(?:async )?function /);
  return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

const RUTA_PROPIA = fileURLToPath(new URL("./consultas-kpi-catalogo.ts", import.meta.url));
const RUTA_TUI = fileURLToPath(new URL("../../build-on-comando-empleado.ts", import.meta.url));

const MATERIAL_PINEADO: ReadonlyArray<readonly [ConsultaKpiClave, string]> = [
  ["kpis_del_mes", "Resumen de los KPIs del mes corriente."],
  ["incidentes_abiertos", "Listado de incidentes abiertos."],
  ["incidentes_criticos", "Incidentes críticos abiertos en este momento."],
  ["estado_general", "Estado general de KPIs e incidentes."],
];

describe("CONSULTAS_KPI — conjunto cerrado (ADR 243)", () => {
  it("el catálogo v1 tiene exactamente las cuatro claves", () => {
    expect([...CONSULTAS_KPI]).toEqual([
      "kpis_del_mes",
      "incidentes_abiertos",
      "incidentes_criticos",
      "estado_general",
    ]);
  });
});

describe("materialDeConsultaKpi — el texto que sale es una constante (ADR 243)", () => {
  it.each(MATERIAL_PINEADO)("%s ⇒ material literal pineado", (clave, esperado) => {
    expect(materialDeConsultaKpi(clave)).toBe(esperado);
  });

  it.each(CONSULTAS_KPI.map((clave) => [clave] as const))(
    "%s ⇒ idéntico entre dos llamadas (nada se interpola)",
    (clave) => {
      expect(materialDeConsultaKpi(clave)).toBe(materialDeConsultaKpi(clave));
    },
  );

  it("el cuerpo de materialDeConsultaKpi no usa backtick, ${ ni + (nada interpola)", () => {
    const source = readFileSync(RUTA_PROPIA, "utf-8");
    const cuerpo = cuerpoDeFuncion(source, "materialDeConsultaKpi");
    expect(cuerpo).not.toMatch(/`|\$\{|\+/);
  });

  it("es total: las cuatro claves dan material no vacío y dos claves nunca comparten material", () => {
    const materiales = CONSULTAS_KPI.map((clave) => materialDeConsultaKpi(clave));
    for (const material of materiales) {
      expect(material.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(materiales).size).toBe(4);
  });
});

describe("esConsultaKpiConocida — narrowing por coincidencia EXACTA", () => {
  it.each(CONSULTAS_KPI.map((clave) => [clave] as const))("%s ⇒ true", (clave) => {
    expect(esConsultaKpiConocida(clave)).toBe(true);
  });

  it.each([
    [""],
    [" kpis_del_mes"],
    ["kpis_del_mes "],
    ["KPIS_DEL_MES"],
    ["no-existe"],
    ["constructor"],
    ["__proto__"],
    ["toString"],
  ])("%j ⇒ false", (valor) => {
    expect(esConsultaKpiConocida(valor)).toBe(false);
  });
});

describe("consultas-kpi-catalogo — módulo aislado", () => {
  it("no tiene ningún import (módulo dedicado: todo lo que sale cabe en un archivo)", () => {
    const source = readFileSync(RUTA_PROPIA, "utf-8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe("INSTRUCCION_CONSULTA_KPI — copia de la TUI (D8)", () => {
  it("es la cadena fija acordada", () => {
    expect(INSTRUCCION_CONSULTA_KPI).toBe(
      "Consultá al agente externo de KPIs/incidentes y devolvé su respuesta tal cual.",
    );
  });

  it("5b: el fuente de la TUI contiene la instrucción exactamente una vez (no divergió)", () => {
    const fuente = readFileSync(RUTA_TUI, "utf-8");
    expect(fuente.split(INSTRUCCION_CONSULTA_KPI).length).toBe(2);
  });
});
