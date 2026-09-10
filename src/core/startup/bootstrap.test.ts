import { describe, expect, it, vi } from "vitest";
import { listAgentDefinitions, type AgentDefinition } from "../agents/definitions.js";
import { createHookEngine, hookEngine } from "../hooks/hook-engine.js";
import type { ResultadoDescubrimiento } from "../skills/descubrir-skills.js";
import { SkillInvalidaError } from "../skills/skill-frontmatter.js";
import { bootstrapHarness, HarnessBootstrapError } from "./bootstrap.js";

function resultadoVacioPorAusencia(): ResultadoDescubrimiento {
  return { baseAusente: true, skills: [], omitidos: [] };
}

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

describe("bootstrapHarness — Registro de Skills (tercer registro, ADR 111/115)", () => {
  it("invoca descubrir() después de listAgents() — Skills es el tercer paso", () => {
    const orden: string[] = [];
    const listAgentsSpy = (): readonly AgentDefinition[] => {
      orden.push("agentes");
      return listAgentDefinitions();
    };
    const descubrirSpy = (): ResultadoDescubrimiento => {
      orden.push("skills");
      return resultadoVacioPorAusencia();
    };

    bootstrapHarness(listAgentsSpy, createHookEngine(), descubrirSpy, vi.fn());

    expect(orden).toEqual(["agentes", "skills"]);
  });

  it("baseAusente: true ⇒ registries.skills es [], no lanza, y loguea 'skills-carpeta-ausente'", () => {
    const log = vi.fn();

    const registries = bootstrapHarness(
      undefined,
      createHookEngine(),
      resultadoVacioPorAusencia,
      log,
    );

    expect(registries.skills).toEqual([]);
    expect(log).toHaveBeenCalledWith("skills-carpeta-ausente");
  });

  it("carpeta presente pero sin ningún paquete ⇒ loguea 'skills-registro-vacio', no lanza", () => {
    const log = vi.fn();
    const descubrir = (): ResultadoDescubrimiento => ({
      baseAusente: false,
      skills: [],
      omitidos: [],
    });

    const registries = bootstrapHarness(undefined, createHookEngine(), descubrir, log);

    expect(registries.skills).toEqual([]);
    expect(log).toHaveBeenCalledWith("skills-registro-vacio");
  });

  it("omitidos no vacío ⇒ loguea 'skill-omitida-sin-skill-md' una vez por directorio", () => {
    const log = vi.fn();
    const descubrir = (): ResultadoDescubrimiento => ({
      baseAusente: false,
      skills: [],
      omitidos: ["sin-skill-md-1", "sin-skill-md-2"],
    });

    bootstrapHarness(undefined, createHookEngine(), descubrir, log);

    expect(log).toHaveBeenCalledWith("skill-omitida-sin-skill-md", { directorio: "sin-skill-md-1" });
    expect(log).toHaveBeenCalledWith("skill-omitida-sin-skill-md", { directorio: "sin-skill-md-2" });
  });

  it("skills descubiertas ⇒ registries.skills tiene los nombres y loguea 'skills-registro-cargado'", () => {
    const log = vi.fn();
    const descubrir = (): ResultadoDescubrimiento => ({
      baseAusente: false,
      skills: [{ nombre: "demo", descripcion: "una descripcion cualquiera" }],
      omitidos: [],
    });

    const registries = bootstrapHarness(undefined, createHookEngine(), descubrir, log);

    expect(registries.skills).toEqual(["demo"]);
    expect(log).toHaveBeenCalledWith("skills-registro-cargado", { cantidad: 1, nombres: ["demo"] });
  });

  it("descubrir() lanza SkillInvalidaError ⇒ HarnessBootstrapError con la ruta y el motivo en el mensaje", () => {
    const descubrir = (): ResultadoDescubrimiento => {
      throw new SkillInvalidaError(".claude/skills/rota/SKILL.md", "el motivo del rechazo");
    };

    expect(() => bootstrapHarness(undefined, createHookEngine(), descubrir, vi.fn())).toThrow(
      HarnessBootstrapError,
    );
    expect(() => bootstrapHarness(undefined, createHookEngine(), descubrir, vi.fn())).toThrow(
      /\.claude\/skills\/rota\/SKILL\.md.*el motivo del rechazo/,
    );
  });

  it("un fallo del Registro de Skills no devuelve un HarnessRegistries parcial — la función lanza, no retorna", () => {
    const descubrir = (): ResultadoDescubrimiento => {
      throw new SkillInvalidaError(".claude/skills/rota/SKILL.md", "motivo");
    };

    let resultado: unknown;
    try {
      resultado = bootstrapHarness(undefined, createHookEngine(), descubrir, vi.fn());
    } catch {
      // se espera que lance — ver el test anterior para la aserción del tipo/mensaje
    }

    expect(resultado).toBeUndefined();
  });
});
