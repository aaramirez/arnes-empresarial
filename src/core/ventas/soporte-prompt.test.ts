import { describe, expect, it } from "vitest";
import { buildSoportePrompt, MAX_SOPORTE_CONSULTA_CHARS } from "./soporte-prompt.js";

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
