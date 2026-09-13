import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validarOperacion } from "./validar-operacion.js";

/**
 * operaciones-negocio-conversacionales, tarea 2. Whitelist ESTRICTA por
 * operación (ADR 163 pto 3, ADR 171 pto 2, ADR 174 pto 1): el objeto zod
 * plano del adaptador MCP (tarea 4, fuera de esta Unit) ya validó tipos
 * sueltos por campo; ESTA es la segunda validación, la que exige EXACTAMENTE
 * el conjunto de campos de la fila que corresponde a `operacion` y rechaza
 * cualquier clave extra. `validar-operacion.ts` no importa
 * `operaciones-contract.ts` (cero imports en su fuente, ver test al final) —
 * la whitelist de seguridad no depende de que un import se resuelva bien.
 */

describe("validarOperacion — forma mínima de cada una de las 6 operaciones", () => {
  it("resolver_decision_venta: { operacion, token, decision } se acepta", () => {
    const input = { operacion: "resolver_decision_venta", token: "t1", decision: "confirmar" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("procesar_devolucion: { operacion, token } se acepta (motivo es opcional)", () => {
    const input = { operacion: "procesar_devolucion", token: "t1" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("procesar_devolucion: { operacion, token, motivo } se acepta", () => {
    const input = { operacion: "procesar_devolucion", token: "t1", motivo: "no funcionó" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("crear_solicitud_interna: { operacion, tipo, detalle } se acepta", () => {
    const input = { operacion: "crear_solicitud_interna", tipo: "gasto", detalle: "taxi" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("cancelar_solicitud_interna: { operacion } solo se acepta (modo listado)", () => {
    const input = { operacion: "cancelar_solicitud_interna" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("cancelar_solicitud_interna: { operacion, solicitudId } se acepta", () => {
    const input = { operacion: "cancelar_solicitud_interna", solicitudId: "sol-1" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("registrar_venta: forma mínima completa (clienteId, clienteEmail, planNuevo, monto, vendedorNombre) se acepta", () => {
    const input = {
      operacion: "registrar_venta",
      clienteId: "cliente-1",
      clienteEmail: "cliente@example.com",
      planNuevo: "premium",
      monto: 100,
      vendedorNombre: "Juan Pérez",
    };
    expect(validarOperacion(input)).toBe(input);
  });

  it("registrar_venta: con planAnterior opcional se acepta", () => {
    const input = {
      operacion: "registrar_venta",
      clienteId: "cliente-1",
      clienteEmail: "cliente@example.com",
      planAnterior: "basico",
      planNuevo: "premium",
      monto: 100,
      vendedorNombre: "Juan Pérez",
    };
    expect(validarOperacion(input)).toBe(input);
  });

  it("consultar_reporte_comisiones: { operacion } solo se acepta (mes corriente)", () => {
    const input = { operacion: "consultar_reporte_comisiones" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("consultar_reporte_comisiones: { operacion, periodo } se acepta", () => {
    const input = { operacion: "consultar_reporte_comisiones", periodo: "2026-08" };
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — rechazo por campo requerido faltante", () => {
  it("resolver_decision_venta sin token ⇒ rechazo", () => {
    expect(validarOperacion({ operacion: "resolver_decision_venta", decision: "confirmar" })).toBeUndefined();
  });

  it("crear_solicitud_interna sin detalle ⇒ rechazo", () => {
    expect(validarOperacion({ operacion: "crear_solicitud_interna", tipo: "gasto" })).toBeUndefined();
  });

  it("registrar_venta sin monto ⇒ rechazo", () => {
    expect(
      validarOperacion({
        operacion: "registrar_venta",
        clienteId: "c",
        clienteEmail: "c@example.com",
        planNuevo: "p",
        vendedorNombre: "v",
      }),
    ).toBeUndefined();
  });
});

describe("validarOperacion — `monto` como clave extra se rechaza en toda operación salvo registrar_venta (ADR 163 pto 2)", () => {
  it.each([
    { operacion: "resolver_decision_venta", token: "t", decision: "confirmar" },
    { operacion: "procesar_devolucion", token: "t" },
    { operacion: "crear_solicitud_interna", tipo: "gasto", detalle: "x" },
    { operacion: "cancelar_solicitud_interna" },
    { operacion: "consultar_reporte_comisiones" },
  ])("$operacion + monto extra ⇒ rechazo", (base) => {
    expect(validarOperacion({ ...base, monto: 100 })).toBeUndefined();
  });
});

describe("validarOperacion — `periodo` como clave extra se rechaza en toda operación salvo consultar_reporte_comisiones (ADR 174)", () => {
  it.each([
    { operacion: "resolver_decision_venta", token: "t", decision: "confirmar" },
    { operacion: "procesar_devolucion", token: "t" },
    { operacion: "crear_solicitud_interna", tipo: "gasto", detalle: "x" },
    { operacion: "cancelar_solicitud_interna" },
    {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      monto: 1,
      vendedorNombre: "v",
    },
  ])("$operacion + periodo extra ⇒ rechazo", (base) => {
    expect(validarOperacion({ ...base, periodo: "2026-01" })).toBeUndefined();
  });
});

describe("validarOperacion — claves del modelo/dominio NUNCA aceptadas (ADR 147 pto 1, ADR 166 pto 1)", () => {
  it.each(["empleadoId", "vendedorId", "sesion", "confirmado"])(
    "%s como clave extra en cualquier operación ⇒ rechazo",
    (claveProhibida) => {
      const input = { operacion: "crear_solicitud_interna", tipo: "gasto", detalle: "x", [claveProhibida]: "x" };
      expect(validarOperacion(input)).toBeUndefined();
    },
  );

  it("vendedorId como clave extra en registrar_venta (que SÍ acepta monto) también se rechaza", () => {
    const input = {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      monto: 1,
      vendedorNombre: "v",
      vendedorId: "empleado-1",
    };
    expect(validarOperacion(input)).toBeUndefined();
  });
});

describe("validarOperacion — `monto` fuera de rango en registrar_venta se rechaza (hallazgo Reviewer, mismo criterio que parseAltaVentaPayload en payloads.ts)", () => {
  function baseRegistrarVenta(monto: unknown): Record<string, unknown> {
    return {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      vendedorNombre: "v",
      monto,
    };
  }

  it.each([0, -1, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "monto=%p ⇒ rechazo",
    (monto) => {
      expect(validarOperacion(baseRegistrarVenta(monto))).toBeUndefined();
    },
  );

  it("monto positivo y finito ⇒ se sigue aceptando (regresión)", () => {
    const input = baseRegistrarVenta(100);
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — strings sobre el tope de 256 caracteres se rechazan (hallazgo Reviewer, mismo tope que MAX_STRING_LENGTH en payloads.ts)", () => {
  const stringLargo = "x".repeat(257);
  const stringLimite = "x".repeat(256);

  it.each([
    { operacion: "resolver_decision_venta", token: stringLargo, decision: "confirmar" },
    { operacion: "procesar_devolucion", token: "t", motivo: stringLargo },
    { operacion: "crear_solicitud_interna", tipo: stringLargo, detalle: "x" },
    { operacion: "crear_solicitud_interna", tipo: "x", detalle: stringLargo },
    { operacion: "cancelar_solicitud_interna", solicitudId: stringLargo },
    {
      operacion: "registrar_venta",
      clienteId: stringLargo,
      clienteEmail: "c@example.com",
      planNuevo: "p",
      monto: 1,
      vendedorNombre: "v",
    },
    {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      monto: 1,
      vendedorNombre: stringLargo,
    },
    {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planAnterior: stringLargo,
      planNuevo: "p",
      monto: 1,
      vendedorNombre: "v",
    },
    { operacion: "consultar_reporte_comisiones", periodo: stringLargo },
  ])("$operacion con un campo de 257 caracteres ⇒ rechazo", (input) => {
    expect(validarOperacion(input)).toBeUndefined();
  });

  it("string de exactamente 256 caracteres (el límite) se sigue aceptando (regresión)", () => {
    const input = { operacion: "crear_solicitud_interna", tipo: stringLimite, detalle: "x" };
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — operación fuera del enum", () => {
  it("operacion desconocida ⇒ rechazo", () => {
    expect(validarOperacion({ operacion: "borrar_todo", token: "t" })).toBeUndefined();
  });

  it("operacion ausente o no-string ⇒ rechazo", () => {
    expect(validarOperacion({})).toBeUndefined();
    expect(validarOperacion({ operacion: 123 })).toBeUndefined();
  });
});

describe("validar-operacion.ts source", () => {
  it("has no import statements — la whitelist de seguridad no depende de un import", () => {
    const sourcePath = fileURLToPath(new URL("./validar-operacion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
