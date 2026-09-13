import { describe, expect, it } from "vitest";
import { DECISION_CONFIRMAR, DECISION_RECHAZAR } from "../../core/ventas/confirmar-venta.js";
import {
  parseAltaVentaPayload,
  parseDecisionForm,
  parseDevolucionPayload,
  parseLoginPayload,
  parseOperacionesPayload,
  parseSoportePayload,
} from "./payloads.js";

function altaVentaValida(): Record<string, unknown> {
  return {
    vendedorId: "vend-1",
    vendedorNombre: "Ana Vendedora",
    clienteId: "cli-1",
    clienteEmail: "cliente@example.com",
    planAnterior: "plan-basico",
    planNuevo: "plan-pro",
    monto: 1000,
  };
}

describe("parseAltaVentaPayload", () => {
  it("acepta un payload valido con los 7 campos (6 requeridos + planAnterior opcional)", () => {
    const resultado = parseAltaVentaPayload(altaVentaValida());

    expect(resultado).toEqual({
      ok: true,
      valor: {
        vendedorId: "vend-1",
        vendedorNombre: "Ana Vendedora",
        clienteId: "cli-1",
        clienteEmail: "cliente@example.com",
        planAnterior: "plan-basico",
        planNuevo: "plan-pro",
        monto: 1000,
      },
    });
  });

  it("acepta un payload valido sin planAnterior (campo opcional ausente)", () => {
    const payload = altaVentaValida();
    delete payload.planAnterior;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado).toEqual({
      ok: true,
      valor: {
        vendedorId: "vend-1",
        vendedorNombre: "Ana Vendedora",
        clienteId: "cli-1",
        clienteEmail: "cliente@example.com",
        planNuevo: "plan-pro",
        monto: 1000,
      },
    });
  });

  it("rechaza un payload que no es un objeto", () => {
    expect(parseAltaVentaPayload(null)).toEqual({ ok: false, motivo: expect.any(String) });
    expect(parseAltaVentaPayload("texto")).toEqual({ ok: false, motivo: expect.any(String) });
    expect(parseAltaVentaPayload(42)).toEqual({ ok: false, motivo: expect.any(String) });
    expect(parseAltaVentaPayload([])).toEqual({ ok: false, motivo: expect.any(String) });
  });

  it("cada uno de los 6 campos requeridos ausente por separado produce un motivo distinto", () => {
    const camposRequeridos = [
      "vendedorId",
      "vendedorNombre",
      "clienteId",
      "clienteEmail",
      "planNuevo",
      "monto",
    ] as const;

    const motivos = camposRequeridos.map((campo) => {
      const payload = altaVentaValida();
      delete payload[campo];
      const resultado = parseAltaVentaPayload(payload);
      expect(resultado.ok).toBe(false);
      return resultado.ok ? "" : resultado.motivo;
    });

    // Todos los motivos son distintos entre si.
    expect(new Set(motivos).size).toBe(camposRequeridos.length);
  });

  it("rechaza un string requerido vacio tras trim()", () => {
    const payload = altaVentaValida();
    payload.vendedorId = "   ";

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza un string requerido que no es typeof string", () => {
    const payload = altaVentaValida();
    payload.vendedorNombre = 123;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza un string requerido que excede el tope de 256 caracteres", () => {
    const payload = altaVentaValida();
    payload.clienteId = "a".repeat(257);

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("acepta un string requerido de exactamente 256 caracteres (limite inclusive)", () => {
    const payload = altaVentaValida();
    payload.clienteId = "a".repeat(256);

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(true);
  });

  it("rechaza monto como string, NO lo coerciona", () => {
    const payload = altaVentaValida();
    payload.monto = "1000";

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza monto 0", () => {
    const payload = altaVentaValida();
    payload.monto = 0;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza monto negativo", () => {
    const payload = altaVentaValida();
    payload.monto = -50;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza monto NaN", () => {
    const payload = altaVentaValida();
    payload.monto = Number.NaN;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza monto Infinity", () => {
    const payload = altaVentaValida();
    payload.monto = Number.POSITIVE_INFINITY;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("acepta un monto positivo valido", () => {
    const payload = altaVentaValida();
    payload.monto = 1;

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado).toEqual({
      ok: true,
      valor: expect.objectContaining({ monto: 1 }),
    });
  });

  it("rechaza planAnterior presente pero vacio", () => {
    const payload = altaVentaValida();
    payload.planAnterior = "   ";

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza planAnterior presente pero sobre el tope de 256 caracteres", () => {
    const payload = altaVentaValida();
    payload.planAnterior = "a".repeat(257);

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });

  it("acepta clienteEmail sin forma de email (no valida contra un regex)", () => {
    const payload = altaVentaValida();
    payload.clienteEmail = "esto-no-es-un-email";

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado).toEqual({
      ok: true,
      valor: expect.objectContaining({ clienteEmail: "esto-no-es-un-email" }),
    });
  });

  it("rechaza clienteEmail vacio", () => {
    const payload = altaVentaValida();
    payload.clienteEmail = "";

    const resultado = parseAltaVentaPayload(payload);

    expect(resultado.ok).toBe(false);
  });
});

describe("parseDevolucionPayload", () => {
  it("acepta un payload con solo token", () => {
    const resultado = parseDevolucionPayload({ token: "tok-1" });

    expect(resultado).toEqual({ ok: true, valor: { token: "tok-1" } });
  });

  it("acepta un payload con token y motivo", () => {
    const resultado = parseDevolucionPayload({ token: "tok-1", motivo: "no me gusto" });

    expect(resultado).toEqual({ ok: true, valor: { token: "tok-1", motivo: "no me gusto" } });
  });

  it("recorta motivo a 500 caracteres", () => {
    const motivoLargo = "a".repeat(600);

    const resultado = parseDevolucionPayload({ token: "tok-1", motivo: motivoLargo });

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.valor.motivo).toBe("a".repeat(500));
    expect(resultado.ok && resultado.valor.motivo?.length).toBe(500);
  });

  it("rechaza un payload sin token", () => {
    const resultado = parseDevolucionPayload({ motivo: "algo" });

    expect(resultado.ok).toBe(false);
  });

  it("rechaza un payload que no es un objeto", () => {
    const resultado = parseDevolucionPayload(null);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza token vacio tras trim()", () => {
    const resultado = parseDevolucionPayload({ token: "   " });

    expect(resultado.ok).toBe(false);
  });
});

describe("parseSoportePayload", () => {
  it("acepta un payload con consulta no vacia", () => {
    const resultado = parseSoportePayload({ consulta: "necesito ayuda con mi plan" });

    expect(resultado).toEqual({ ok: true, valor: { consulta: "necesito ayuda con mi plan" } });
  });

  it("rechaza consulta vacia", () => {
    const resultado = parseSoportePayload({ consulta: "" });

    expect(resultado.ok).toBe(false);
  });

  it("rechaza consulta ausente", () => {
    const resultado = parseSoportePayload({});

    expect(resultado.ok).toBe(false);
  });

  it("rechaza un payload que no es un objeto", () => {
    const resultado = parseSoportePayload("no es un objeto");

    expect(resultado.ok).toBe(false);
  });
});

describe("parseLoginPayload", () => {
  it("acepta un payload con empleadoId y password no vacios", () => {
    const resultado = parseLoginPayload({ empleadoId: "emp-1", password: "correcta" });

    expect(resultado).toEqual({ ok: true, valor: { empleadoId: "emp-1", password: "correcta" } });
  });

  it("rechaza empleadoId ausente", () => {
    expect(parseLoginPayload({ password: "correcta" }).ok).toBe(false);
  });

  it("rechaza empleadoId vacio", () => {
    expect(parseLoginPayload({ empleadoId: "", password: "correcta" }).ok).toBe(false);
  });

  it("rechaza password ausente", () => {
    expect(parseLoginPayload({ empleadoId: "emp-1" }).ok).toBe(false);
  });

  it("rechaza password vacio", () => {
    expect(parseLoginPayload({ empleadoId: "emp-1", password: "" }).ok).toBe(false);
  });

  it("rechaza un payload que no es un objeto", () => {
    expect(parseLoginPayload("no es un objeto").ok).toBe(false);
  });
});

describe("parseOperacionesPayload", () => {
  it("acepta un payload con consulta no vacia", () => {
    const resultado = parseOperacionesPayload({ consulta: "quiero registrar una venta" });

    expect(resultado).toEqual({ ok: true, valor: { consulta: "quiero registrar una venta" } });
  });

  it("rechaza consulta vacia", () => {
    expect(parseOperacionesPayload({ consulta: "" }).ok).toBe(false);
  });

  it("rechaza consulta ausente", () => {
    expect(parseOperacionesPayload({}).ok).toBe(false);
  });

  it("rechaza un payload que no es un objeto", () => {
    expect(parseOperacionesPayload("no es un objeto").ok).toBe(false);
  });
});

describe("parseDecisionForm", () => {
  it("acepta decision=confirmar", () => {
    const campos = new URLSearchParams({ decision: "confirmar" });

    const resultado = parseDecisionForm(campos);

    expect(resultado).toEqual({ ok: true, valor: DECISION_CONFIRMAR });
  });

  it("acepta decision=rechazar", () => {
    const campos = new URLSearchParams({ decision: "rechazar" });

    const resultado = parseDecisionForm(campos);

    expect(resultado).toEqual({ ok: true, valor: DECISION_RECHAZAR });
  });

  it("rechaza un valor de decision distinto a confirmar/rechazar", () => {
    const campos = new URLSearchParams({ decision: "cualquier-otra-cosa" });

    const resultado = parseDecisionForm(campos);

    expect(resultado.ok).toBe(false);
  });

  it("rechaza cuando decision esta ausente", () => {
    const campos = new URLSearchParams();

    const resultado = parseDecisionForm(campos);

    expect(resultado.ok).toBe(false);
  });
});
