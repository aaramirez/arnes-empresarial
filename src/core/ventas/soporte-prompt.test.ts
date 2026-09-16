import { describe, expect, it } from "vitest";
import { buildOperacionesEmpleadoPrompt, buildSoportePrompt, MAX_SOPORTE_CONSULTA_CHARS } from "./soporte-prompt.js";

/**
 * Spec `soporte-web-turno` req. "Reuso de `CONVERSATIONAL_AGENT` con prompt
 * sintético" / `design.md` §3.6 `soporte-prompt.ts`.
 *
 * `buildSoportePrompt` es una función PURA: mismo input, mismo string. No
 * hay mocks acá — solo consultas literales.
 */

describe("buildSoportePrompt — determinismo", () => {
  it("mismo input produce exactamente el mismo string (función pura)", () => {
    const consulta = "¿Cuándo llega mi pedido?";
    const primero = buildSoportePrompt(consulta);
    const segundo = buildSoportePrompt(consulta);
    expect(primero).toBe(segundo);
  });
});

describe("buildSoportePrompt — truncado de la consulta", () => {
  it("NO trunca una consulta corta, dentro del tope", () => {
    const consultaCorta = "¿Puedo cambiar la dirección de envío?";
    const prompt = buildSoportePrompt(consultaCorta);

    expect(prompt).toContain(consultaCorta);
    expect(prompt).not.toContain("[…truncado]");
  });

  it("trunca la consulta cuando excede MAX_SOPORTE_CONSULTA_CHARS, con marca […truncado]", () => {
    const consultaLarga = "Q".repeat(MAX_SOPORTE_CONSULTA_CHARS + 500);
    const prompt = buildSoportePrompt(consultaLarga);

    expect(prompt).toContain("[…truncado]");
    // La consulta completa sin truncar no debe aparecer literal en el prompt.
    expect(prompt.includes("Q".repeat(MAX_SOPORTE_CONSULTA_CHARS + 1))).toBe(false);
  });

  it("trunca exactamente a MAX_SOPORTE_CONSULTA_CHARS caracteres antes de la marca", () => {
    const consultaLarga = "Q".repeat(MAX_SOPORTE_CONSULTA_CHARS + 500);
    const prompt = buildSoportePrompt(consultaLarga);

    expect(prompt).toContain(`${"Q".repeat(MAX_SOPORTE_CONSULTA_CHARS)}[…truncado]`);
  });
});

describe("buildSoportePrompt — limitación declarada de seguridad", () => {
  it("incluye literalmente que el agente no puede confirmar, cancelar ni reembolsar nada", () => {
    const prompt = buildSoportePrompt("¿Me pueden cancelar la compra?");

    expect(prompt.toLowerCase()).toContain("no podés confirmar, cancelar ni reembolsar nada");
  });

  it("incluye la limitación aun con una consulta vacía", () => {
    const prompt = buildSoportePrompt("");
    expect(prompt.toLowerCase()).toContain("no podés confirmar, cancelar ni reembolsar nada");
  });

  it("instruye derivar a un humano cuando la consulta requiera una acción sobre la cuenta", () => {
    const prompt = buildSoportePrompt("Quiero cancelar mi venta");
    expect(prompt.toLowerCase()).toContain("deriv");
    expect(prompt.toLowerCase()).toContain("humano");
  });
});

describe("buildSoportePrompt — clienteId no entra al prompt", () => {
  it("no tiene clienteId como parámetro (firma de un solo argumento: consulta)", () => {
    expect(buildSoportePrompt).toHaveLength(1);
  });

  it("no agrega clienteId por su cuenta: una consulta sin esa palabra no la adquiere en el prompt", () => {
    const prompt = buildSoportePrompt("Necesito ayuda con mi cuenta");
    expect(prompt.toLowerCase()).not.toContain("clienteid");
  });
});

describe("buildSoportePrompt — estructura general", () => {
  it("incluye un rol de agente de soporte al cliente", () => {
    const prompt = buildSoportePrompt("¿Cómo hago un reclamo?");
    expect(prompt.toLowerCase()).toContain("soporte");
  });

  it("incluye la consulta del cliente en el prompt", () => {
    const consulta = "Mi pedido llegó incompleto";
    const prompt = buildSoportePrompt(consulta);
    expect(prompt).toContain(consulta);
  });
});

/**
 * `buildOperacionesEmpleadoPrompt` — spec `turno-empleado-autenticado` req.
 * "El prompt del turno de empleado es distinto del prompt de cliente" /
 * `design.md` ADR 168 pto 1. Misma firma pura y mismo truncado que
 * `buildSoportePrompt` — SIN las dos líneas de seguridad de cliente
 * (`:65`/`:69` de este archivo, la limitación declarada y la instrucción de
 * derivar a un humano).
 *
 * Regresión obligatoria (ADR 168 pto 1): `buildSoportePrompt` queda
 * BYTE-IDÉNTICA — todas las specs de arriba siguen intactas, ninguna se toca
 * ni se borra para agregar esta sección.
 */
describe("buildOperacionesEmpleadoPrompt — determinismo", () => {
  it("mismo input produce exactamente el mismo string (función pura)", () => {
    const consulta = "Registrame una venta de $500 para el cliente 123";
    const primero = buildOperacionesEmpleadoPrompt(consulta);
    const segundo = buildOperacionesEmpleadoPrompt(consulta);
    expect(primero).toBe(segundo);
  });

  it("firma de un solo argumento (consulta), misma aridad que buildSoportePrompt", () => {
    expect(buildOperacionesEmpleadoPrompt).toHaveLength(1);
  });
});

describe("buildOperacionesEmpleadoPrompt — truncado de la consulta", () => {
  it("NO trunca una consulta corta, dentro del tope", () => {
    const consultaCorta = "Cancelame la solicitud sol-1";
    const prompt = buildOperacionesEmpleadoPrompt(consultaCorta);

    expect(prompt).toContain(consultaCorta);
    expect(prompt).not.toContain("[…truncado]");
  });

  it("trunca la consulta cuando excede MAX_SOPORTE_CONSULTA_CHARS, con marca […truncado] (mismo tope reusado)", () => {
    const consultaLarga = "Q".repeat(MAX_SOPORTE_CONSULTA_CHARS + 500);
    const prompt = buildOperacionesEmpleadoPrompt(consultaLarga);

    expect(prompt).toContain("[…truncado]");
    expect(prompt).toContain(`${"Q".repeat(MAX_SOPORTE_CONSULTA_CHARS)}[…truncado]`);
  });
});

describe("buildOperacionesEmpleadoPrompt — NO hereda la prohibición de cliente", () => {
  it("NO contiene la limitación de cliente (no confirmar/cancelar/reembolsar)", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Quiero cancelar mi solicitud de vacaciones");
    expect(prompt.toLowerCase()).not.toContain("no podés confirmar, cancelar ni reembolsar nada");
  });

  it("NO instruye a derivar a un humano", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Registrame una venta");
    expect(prompt.toLowerCase()).not.toContain("derivá explícitamente a un humano");
  });
});

describe("buildOperacionesEmpleadoPrompt — instrucción de doble confirmación", () => {
  it("instruye a esperar un mensaje NUEVO del empleado antes de reinvocar la misma operación", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Cancelame la solicitud sol-1");
    expect(prompt.toLowerCase()).toContain("mensaje");
    expect(prompt.toLowerCase()).toMatch(/confirm/);
  });

  it("instruye a nunca calcular un monto, porcentaje o veredicto por su cuenta", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Registrame una venta");
    expect(prompt.toLowerCase()).toContain("nunca calcul");
  });
});

describe("buildOperacionesEmpleadoPrompt — incluye la consulta del empleado", () => {
  it("incluye la consulta en el prompt", () => {
    const consulta = "Necesito procesar una devolución";
    const prompt = buildOperacionesEmpleadoPrompt(consulta);
    expect(prompt).toContain(consulta);
  });
});

describe("buildOperacionesEmpleadoPrompt — instrucción de accion inequívoca (aprobacion-conversacional-hitl, tarea 15, ADR 220 pto 2)", () => {
  /** Texto literal de ADR 220 pto 2 — el mismo, duplicado a propósito, en las tres superficies de prompt. */
  const TEXTO_ACCION_INEQUIVOCA =
    "Cuando el empleado te pida resolver un reembolso o una solicitud, la acción (`aprobar`, `rechazar` o `reabrir`) " +
    "tiene que salir de una frase inequívoca del empleado. Si dice algo ambiguo " +
    "—'resolvelo', 'dale', 'hacé lo que corresponda', 'fijate vos'— preguntá " +
    "cuál de las acciones quiere en vez de elegir una. Nunca elegís vos la " +
    "acción, ni la deducís del contexto, ni del dictamen, ni de lo que parezca " +
    "más razonable.";

  it("incluye el texto exacto de ADR 220 pto 2, incluido 'ni del dictamen'", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Resolvé la solicitud S1");

    expect(prompt).toContain(TEXTO_ACCION_INEQUIVOCA);
    expect(prompt).toContain("ni del dictamen");
  });

  it("suma la mención de resolver escalaciones de reembolso y solicitudes internas", () => {
    const prompt = buildOperacionesEmpleadoPrompt("Resolvé la solicitud S1");

    expect(prompt.toLowerCase()).toContain("escalaciones de reembolso y solicitudes internas");
  });
});

describe("buildSoportePrompt — byte-idéntica tras agregar buildOperacionesEmpleadoPrompt (ADR 168 pto 1, regresión)", () => {
  it("sigue incluyendo la limitación de cliente sin cambios", () => {
    const prompt = buildSoportePrompt("¿Me pueden cancelar la compra?");
    expect(prompt.toLowerCase()).toContain("no podés confirmar, cancelar ni reembolsar nada");
  });

  it("sigue instruyendo derivar a un humano", () => {
    const prompt = buildSoportePrompt("Quiero cancelar mi venta");
    expect(prompt.toLowerCase()).toContain("deriv");
    expect(prompt.toLowerCase()).toContain("humano");
  });
});
