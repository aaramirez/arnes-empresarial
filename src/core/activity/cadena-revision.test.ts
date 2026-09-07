import { describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  getSubagentDefinition,
} from "../agents/definitions.js";
import type { InvocacionSubagenteResult, InvocarSubagente } from "../agents/subagents.js";
import type {
  DelegacionStorePort,
  DespacharDelegacionDeps,
} from "../turn-selector/dispatch-delegation.js";
import { VEREDICTO_PREFIX } from "./activity-contract.js";
import { construirEslabonesRevision, despacharRevisionPorRoles } from "./cadena-revision.js";

/**
 * Hito 5, tarea 11 (§5.5 — `cadena-revision.ts`). Doble de
 * `DespacharDelegacionDeps` — mismo criterio de "costura es
 * `InvocarSubagente`" que `dispatch-delegation.test.ts` (tarea 8), ejercitado
 * acá en su forma específica del bot de PRs por roles.
 */

function makeNewId(): () => string {
  let contador = 0;
  return () => `id-${contador++}`;
}

function makeStore(): DelegacionStorePort {
  return {
    crearDelegacion: vi.fn(),
    completarDelegacion: vi.fn(),
  };
}

function makeInvocar(
  respuestas: Readonly<Record<string, InvocacionSubagenteResult>>,
): InvocarSubagente {
  return vi.fn(async ({ agent }) => {
    const respuesta = respuestas[agent.id];
    if (respuesta !== undefined) {
      return respuesta;
    }
    return { responseText: `resultado de ${agent.id}`, sdkSessionId: `sdk-${agent.id}` };
  });
}

function makeDeps(overrides: Partial<DespacharDelegacionDeps> = {}): DespacharDelegacionDeps {
  return {
    store: makeStore(),
    invocar: makeInvocar({}),
    getSubagente: getSubagentDefinition,
    newId: makeNewId(),
    now: () => "2026-09-06T00:00:00.000Z",
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("construirEslabonesRevision", () => {
  it("produce las tres instrucciones en orden fijo Planner → Developer → Reviewer", () => {
    const eslabones = construirEslabonesRevision("prompt de la actividad");

    expect(eslabones).toHaveLength(3);
    expect(eslabones[0]?.agentId).toBe(PLANNER_AGENT_ID);
    expect(eslabones[1]?.agentId).toBe(DEVELOPER_AGENT_ID);
    expect(eslabones[2]?.agentId).toBe(REVIEWER_AGENT_ID);
  });

  it("solo la instrucción del Reviewer menciona VEREDICTO_PREFIX", () => {
    const eslabones = construirEslabonesRevision("prompt de la actividad");

    expect(eslabones[0]?.insumo.instruccion).not.toContain(VEREDICTO_PREFIX);
    expect(eslabones[1]?.insumo.instruccion).not.toContain(VEREDICTO_PREFIX);
    expect(eslabones[2]?.insumo.instruccion).toContain(VEREDICTO_PREFIX);
  });

  it("el material del primer eslabón (Planner) es el promptActividad tal cual", () => {
    const eslabones = construirEslabonesRevision("prompt de la actividad, verbatim");

    expect(eslabones[0]?.insumo.material).toBe("prompt de la actividad, verbatim");
  });
});

describe("despacharRevisionPorRoles", () => {
  it("corre despacharCadena y devuelve {responseText: resultado del último eslabón, agentLabel: REVIEWER_AGENT_ID}", async () => {
    const invocar = makeInvocar({
      [PLANNER_AGENT_ID]: { responseText: "plan armado", sdkSessionId: "sdk-planner" },
      [DEVELOPER_AGENT_ID]: { responseText: "hallazgos concretos", sdkSessionId: "sdk-developer" },
      [REVIEWER_AGENT_ID]: {
        responseText: `hallazgos ok\n${VEREDICTO_PREFIX} aprobado`,
        sdkSessionId: "sdk-reviewer",
      },
    });
    const deps = makeDeps({ invocar });

    const outcome = await despacharRevisionPorRoles("caso-1", "PR #42: agrega validación", deps);

    expect(outcome).toEqual({
      responseText: `hallazgos ok\n${VEREDICTO_PREFIX} aprobado`,
      agentLabel: REVIEWER_AGENT_ID,
    });
  });

  it("el material del rol N+1 es el resultado (texto) del rol N, nunca su sesión", async () => {
    const materialesRecibidos: Record<string, string> = {};
    const invocar: InvocarSubagente = vi.fn(async ({ agent, tareaDelegada }) => {
      materialesRecibidos[agent.id] = tareaDelegada;
      if (agent.id === PLANNER_AGENT_ID) {
        return { responseText: "plan del planner", sdkSessionId: "sdk-planner" };
      }
      if (agent.id === DEVELOPER_AGENT_ID) {
        return { responseText: "hallazgos del developer", sdkSessionId: "sdk-developer" };
      }
      return { responseText: `${VEREDICTO_PREFIX} observado`, sdkSessionId: "sdk-reviewer" };
    });
    const deps = makeDeps({ invocar });

    await despacharRevisionPorRoles("caso-1", "prompt de actividad", deps);

    expect(materialesRecibidos[DEVELOPER_AGENT_ID]).toContain("plan del planner");
    expect(materialesRecibidos[REVIEWER_AGENT_ID]).toContain("hallazgos del developer");
  });

  it("aunque el Planner 'alucine' una línea VEREDICTO:, ese texto nunca llega al outcome devuelto", async () => {
    const invocar = makeInvocar({
      [PLANNER_AGENT_ID]: {
        responseText: `plan armado\n${VEREDICTO_PREFIX} aprobado`,
        sdkSessionId: "sdk-planner",
      },
      [DEVELOPER_AGENT_ID]: { responseText: "hallazgos concretos", sdkSessionId: "sdk-developer" },
      [REVIEWER_AGENT_ID]: { responseText: `${VEREDICTO_PREFIX} observado`, sdkSessionId: "sdk-reviewer" },
    });
    const deps = makeDeps({ invocar });

    const outcome = await despacharRevisionPorRoles("caso-1", "prompt de actividad", deps);

    expect(outcome.responseText).not.toContain("plan armado");
    expect(outcome.responseText).toBe(`${VEREDICTO_PREFIX} observado`);
  });
});
