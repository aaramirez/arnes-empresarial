import { describe, expect, it } from "vitest";
import { PLANNER_AGENT_ID } from "../agents/definitions.js";
import {
  DelegacionA2ANoImplementadaError,
  SubagenteDesconocidoError,
  resolverDestino,
} from "./dispatch-delegation.js";

/**
 * Hito 5, tarea 7 (§5.4 parte 1 — tipos y resolución). Solo `resolverDestino`
 * y las dos clases de error tipado; `despacharDelegacion`/`despacharCadena`
 * (§5.4 parte 2) se agregan en la tarea 8, sobre este mismo archivo. Sin
 * fixture de LLM — nada acá invoca `InvocarSubagente`.
 */

describe("resolverDestino", () => {
  it("de un rol conocido de SUBAGENT_REGISTRY devuelve {kind: 'in-process', agentId}", () => {
    const destino = resolverDestino(PLANNER_AGENT_ID);

    expect(destino).toEqual({ kind: "in-process", agentId: PLANNER_AGENT_ID });
  });

  it("de un agentId no registrado en SUBAGENT_REGISTRY lanza SubagenteDesconocidoError", () => {
    expect(() => resolverDestino("rol-inexistente")).toThrow(SubagenteDesconocidoError);
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable (molde de procesarDevolucion)", () => {
    const destino = resolverDestino(PLANNER_AGENT_ID);

    expect(destino).not.toBeInstanceOf(Promise);
    expect(typeof (destino as { then?: unknown }).then).not.toBe("function");
  });
});

describe("DelegacionA2ANoImplementadaError", () => {
  it("es una clase de Error con nombre propio", () => {
    const destino = { kind: "a2a" as const, agentId: "rol-a2a", endpoint: "https://a2a.ejemplo/invocar" };

    const error = new DelegacionA2ANoImplementadaError(destino);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DelegacionA2ANoImplementadaError");
  });
});

describe("SubagenteDesconocidoError", () => {
  it("es una clase de Error con nombre propio", () => {
    const error = new SubagenteDesconocidoError("rol-inexistente");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SubagenteDesconocidoError");
  });
});
