import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAMPOS_POR_OPERACION, VALORES_PERMITIDOS_POR_OPERACION, validarOperacion } from "./validar-operacion.js";

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

describe("validarOperacion — resolver_solicitud: forma mínima se acepta (aprobacion-conversacional-hitl, tarea 7)", () => {
  it("{ operacion, accion } solo se acepta (modo listado)", () => {
    const input = { operacion: "resolver_solicitud", accion: "aprobar" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, accion, solicitudId } se acepta", () => {
    const input = { operacion: "resolver_solicitud", accion: "rechazar", solicitudId: "sol-1" };
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — VALORES_PERMITIDOS_POR_OPERACION: whitelist estricta de accion/decision (ADR 217, aprobacion-conversacional-hitl, tarea 7)", () => {
  it("resolver_solicitud con accion:'reabrir' ⇒ rechazo ('reabrir' es de resolver_reembolso, no de resolver_solicitud)", () => {
    expect(validarOperacion({ operacion: "resolver_solicitud", accion: "reabrir" })).toBeUndefined();
  });

  it("resolver_solicitud con accion:'cancelar' ⇒ rechazo ('cancelar' NUNCA es válido acá, ADR 217 — es de cancelar_solicitud_interna)", () => {
    expect(validarOperacion({ operacion: "resolver_solicitud", accion: "cancelar" })).toBeUndefined();
  });

  it("resolver_decision_venta con decision:'algo-invalido' ⇒ rechazo (cobertura nueva, antes dependía de zod)", () => {
    expect(validarOperacion({ operacion: "resolver_decision_venta", token: "t", decision: "algo-invalido" })).toBeUndefined();
  });

  it("confirmado como clave en resolver_solicitud ⇒ rechazo (regresión §0.1)", () => {
    expect(
      validarOperacion({ operacion: "resolver_solicitud", accion: "aprobar", confirmado: true }),
    ).toBeUndefined();
  });
});

describe("validarOperacion — resolver_reembolso: forma mínima se acepta (aprobacion-conversacional-hitl, tarea 12)", () => {
  it("{ operacion, accion } solo se acepta (modo listado)", () => {
    const input = { operacion: "resolver_reembolso", accion: "aprobar" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, accion, ventaId } se acepta", () => {
    const input = { operacion: "resolver_reembolso", accion: "reabrir", ventaId: "v1" };
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — VALORES_PERMITIDOS_POR_OPERACION.resolver_reembolso: whitelist estricta de accion (ADR 217, aprobacion-conversacional-hitl, tarea 12)", () => {
  it("resolver_reembolso con accion:'cancelar' ⇒ rechazo ('cancelar' NUNCA es válido acá, ADR 217)", () => {
    expect(validarOperacion({ operacion: "resolver_reembolso", accion: "cancelar" })).toBeUndefined();
  });

  it("resolver_reembolso sin accion ⇒ rechazo (campo requerido)", () => {
    expect(validarOperacion({ operacion: "resolver_reembolso", ventaId: "v1" })).toBeUndefined();
  });

  it("resolver_solicitud con accion:'reabrir' sigue rechazada tras ampliarse el enum zod para reembolso (regresión tarea 7, ADR 217 pto 3 — 'acota forma' vs 'acota significado')", () => {
    expect(validarOperacion({ operacion: "resolver_solicitud", accion: "reabrir" })).toBeUndefined();
  });
});

describe("validarOperacion — solicitar_devolucion: forma mínima se acepta (devolucion-sin-token-dos-personas, tarea 13)", () => {
  it("{ operacion } solo se acepta (modo listado)", () => {
    const input = { operacion: "solicitar_devolucion" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, ventaId, motivo } se acepta", () => {
    const input = { operacion: "solicitar_devolucion", ventaId: "venta-1", motivo: "el cliente se arrepintió" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("un campo ajeno (accion) como clave extra ⇒ rechazo — solicitar_devolucion NO tiene campo accion (ADR 229 pto 3)", () => {
    expect(validarOperacion({ operacion: "solicitar_devolucion", ventaId: "v1", accion: "solicitar" })).toBeUndefined();
  });

  it("motivo de 257 caracteres ⇒ rechazo (capa 1 de dos, MAX_STRING_LENGTH del borde)", () => {
    expect(
      validarOperacion({ operacion: "solicitar_devolucion", ventaId: "venta-1", motivo: "x".repeat(257) }),
    ).toBeUndefined();
  });

  it("motivo de exactamente 256 caracteres (el límite) se acepta", () => {
    const input = { operacion: "solicitar_devolucion", ventaId: "venta-1", motivo: "x".repeat(256) };
    expect(validarOperacion(input)).toBe(input);
  });
});

describe("validarOperacion — consultar_venta: forma mínima se acepta (devolucion-sin-token-dos-personas, tarea 4)", () => {
  it("{ operacion } solo se acepta (modo listado)", () => {
    const input = { operacion: "consultar_venta" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, ventaId } se acepta", () => {
    const input = { operacion: "consultar_venta", ventaId: "venta-1" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("un campo ajeno (monto) como clave extra ⇒ rechazo — consultar_venta es de sólo lectura, sin ninguna excepción de dinero", () => {
    expect(validarOperacion({ operacion: "consultar_venta", monto: 100 })).toBeUndefined();
  });

  it("ventaId de más de 256 caracteres ⇒ rechazo (mismo tope que el resto del contrato)", () => {
    expect(validarOperacion({ operacion: "consultar_venta", ventaId: "x".repeat(257) })).toBeUndefined();
  });
});

describe("validarOperacion — consultar_solicitud: forma mínima se acepta (consulta-solicitud-propia, tarea 4.1)", () => {
  it("{ operacion } solo se acepta (modo listado)", () => {
    const input = { operacion: "consultar_solicitud" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, solicitudId } se acepta", () => {
    const input = { operacion: "consultar_solicitud", solicitudId: "sol-1" };
    expect(validarOperacion(input)).toBe(input);
  });

  it.each(["ventaId", "accion", "confirmado", "empleadoId", "solicitanteId"])(
    "%s como clave extra en consultar_solicitud ⇒ rechazo, pareado con la forma válida como control (ADR 147 pto 1, ADR 166 pto 1)",
    (claveExtra) => {
      const valido = { operacion: "consultar_solicitud", solicitudId: "sol-1" };
      expect(validarOperacion(valido)).toBe(valido);

      const invalido = { ...valido, [claveExtra]: "x" };
      expect(validarOperacion(invalido)).toBeUndefined();
    },
  );
});

describe("validarOperacion — ver_solicitudes_a2a: forma mínima se acepta (visibilidad-a2a-entrante-chat, tarea 3.1)", () => {
  it("{ operacion } solo se acepta (modo listado)", () => {
    const input = { operacion: "ver_solicitudes_a2a" };
    expect(validarOperacion(input)).toBe(input);
  });

  it("{ operacion, a2aTaskId } se acepta", () => {
    const input = { operacion: "ver_solicitudes_a2a", a2aTaskId: "task-1" };
    expect(validarOperacion(input)).toBe(input);
  });

  it.each([
    "empleadoId",
    "solicitanteId",
    "origenTransporte",
    "estado",
    "estados",
    "limite",
    "solicitudId",
    "ventaId",
    "accion",
    "confirmado",
  ])(
    "%s como clave extra en ver_solicitudes_a2a ⇒ rechazo, pareado con la forma válida como control",
    (claveExtra) => {
      const valido = { operacion: "ver_solicitudes_a2a", a2aTaskId: "task-1" };
      expect(validarOperacion(valido)).toBe(valido);

      const invalido = { ...valido, [claveExtra]: "x" };
      expect(validarOperacion(invalido)).toBeUndefined();
    },
  );

  it("a2aTaskId sólo pertenece a ver_solicitudes_a2a — otra operación con esa clave extra se rechaza", () => {
    expect(validarOperacion({ operacion: "consultar_venta", a2aTaskId: "t1" })).toBeUndefined();
    expect(validarOperacion({ operacion: "consultar_solicitud", a2aTaskId: "t1" })).toBeUndefined();
  });

  it("a2aTaskId de 256 caracteres se acepta; de 257 se rechaza (tope MAX_STRING_LENGTH)", () => {
    const valido = { operacion: "ver_solicitudes_a2a", a2aTaskId: "x".repeat(256) };
    expect(validarOperacion(valido)).toBe(valido);

    expect(validarOperacion({ operacion: "ver_solicitudes_a2a", a2aTaskId: "x".repeat(257) })).toBeUndefined();
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

describe("validarOperacion — VALORES_PERMITIDOS_POR_OPERACION: test estructural de regresión (hallazgo Reviewer, altura/robustez — ADR 217 pto 2-3)", () => {
  /**
   * Convención del módulo (única fuente de verdad, ver `VALORES_PERMITIDOS_
   * POR_OPERACION`): un campo se considera "de tipo acción/enum-like" cuando
   * su NOMBRE es literalmente `accion` o `decision` — las tres filas hoy
   * vigentes (`resolver_solicitud.accion`, `resolver_reembolso.accion`,
   * `resolver_decision_venta.decision`) siguen esa convención. Este test NO
   * cambia `validarOperacion` en sí (permanece fail-open por diseño para
   * campos sin fila — decisión de runtime fuera de alcance de este
   * hallazgo): es una regresión que falla en TIEMPO DE TEST si una operación
   * futura agrega un campo `accion`/`decision` y se olvida su fila en
   * `VALORES_PERMITIDOS_POR_OPERACION`, sin agregar overhead al dispatcher.
   */
  const CAMPOS_ENUM_LIKE = ["accion", "decision"];

  it("toda operación con un campo 'accion'/'decision' en CAMPOS_POR_OPERACION tiene su fila en VALORES_PERMITIDOS_POR_OPERACION para ESE campo", () => {
    const operacionesConCampoEnumLike = Object.entries(CAMPOS_POR_OPERACION).flatMap(([operacion, campos]) =>
      campos.filter((campo) => CAMPOS_ENUM_LIKE.includes(campo)).map((campo) => ({ operacion, campo })),
    );

    // Regresión sobre el regresor: si esto queda vacío, el test de abajo
    // pasaría trivialmente sin cubrir nada — hoy tiene que haber exactamente
    // 3 (resolver_solicitud.accion, resolver_reembolso.accion,
    // resolver_decision_venta.decision).
    expect(operacionesConCampoEnumLike.length).toBeGreaterThan(0);

    for (const { operacion, campo } of operacionesConCampoEnumLike) {
      const fila = VALORES_PERMITIDOS_POR_OPERACION[operacion];
      expect(fila, `operación '${operacion}' tiene el campo '${campo}' pero NO fila en VALORES_PERMITIDOS_POR_OPERACION`).toBeDefined();
      expect(
        fila?.[campo],
        `operación '${operacion}' tiene fila en VALORES_PERMITIDOS_POR_OPERACION pero sin whitelist para su campo '${campo}'`,
      ).toBeDefined();
    }
  });

  it("las tres filas conocidas hoy siguen presentes (resolver_solicitud.accion, resolver_reembolso.accion, resolver_decision_venta.decision)", () => {
    expect(VALORES_PERMITIDOS_POR_OPERACION["resolver_solicitud"]?.["accion"]).toBeDefined();
    expect(VALORES_PERMITIDOS_POR_OPERACION["resolver_reembolso"]?.["accion"]).toBeDefined();
    expect(VALORES_PERMITIDOS_POR_OPERACION["resolver_decision_venta"]?.["decision"]).toBeDefined();
  });
});

describe("validar-operacion.ts source", () => {
  it("has no import statements — la whitelist de seguridad no depende de un import", () => {
    const sourcePath = fileURLToPath(new URL("./validar-operacion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
