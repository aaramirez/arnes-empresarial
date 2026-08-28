import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../agents/definitions.js";
import { createHookEngine, hookEngine } from "../hooks/hook-engine.js";
import { bootstrapHarness, HarnessBootstrapError } from "./bootstrap.js";

describe("bootstrapHarness", () => {
  it("loads the real Agent Registry and the default shared Hook Engine when called with no arguments", () => {
    const registries = bootstrapHarness();

    expect(registries.agents.length).toBeGreaterThan(0);
    expect(registries.agents[0]?.id).toBe("agente-conversacional");
    expect(registries.hooks).toBe(hookEngine);
  });

  it("uses an injected hook engine instead of the default shared singleton", () => {
    const fakeHookEngine = createHookEngine();

    const registries = bootstrapHarness(undefined, fakeHookEngine);

    expect(registries.hooks).toBe(fakeHookEngine);
    expect(registries.hooks).not.toBe(hookEngine);
  });

  it("throws HarnessBootstrapError when the injected Agent Registry has no agents defined", () => {
    const emptyRegistry = (): readonly AgentDefinition[] => [];

    expect(() => bootstrapHarness(emptyRegistry, createHookEngine())).toThrow(
      HarnessBootstrapError,
    );
  });

  it("includes the failure reason in the HarnessBootstrapError message", () => {
    const emptyRegistry = (): readonly AgentDefinition[] => [];

    expect(() => bootstrapHarness(emptyRegistry, createHookEngine())).toThrow(
      /Registro de Agentes no tiene ningún agente definido/,
    );
  });

  it("wraps an exception thrown by listAgents itself in HarnessBootstrapError instead of letting it propagate raw", () => {
    const throwingRegistry = (): readonly AgentDefinition[] => {
      throw new Error("fallo de conexión simulado");
    };

    expect(() => bootstrapHarness(throwingRegistry, createHookEngine())).toThrow(
      HarnessBootstrapError,
    );
    expect(() => bootstrapHarness(throwingRegistry, createHookEngine())).toThrow(
      /fallo de conexión simulado/,
    );
  });

  it("is a named, exported error type distinguishable from a plain Error", () => {
    expect(HarnessBootstrapError.name).toBe("HarnessBootstrapError");

    const error = new HarnessBootstrapError("motivo de prueba");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("motivo de prueba");
  });
});
