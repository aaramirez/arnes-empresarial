import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  getSubagentDefinition,
} from "../agents/definitions.js";
import type { InsumoDelegado, InvocacionSubagenteResult, InvocarSubagente } from "../agents/subagents.js";
import {
  SubagenteDesconocidoError,
  despacharCadena,
  despacharDelegacion,
  resolverDestino,
  type DelegacionAplicada,
  type DelegacionStorePort,
  type DespacharDelegacionDeps,
  type Eslabon,
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

  it("post-refactor (Hito 6, tarea 13): sigue devolviendo {kind: 'in-process', agentId} para todo id registrado — comportamiento sin cambios tras saldar la deuda del ADR 45", () => {
    for (const id of [PLANNER_AGENT_ID, DEVELOPER_AGENT_ID, REVIEWER_AGENT_ID]) {
      expect(resolverDestino(id)).toEqual({ kind: "in-process", agentId: id });
    }
  });
});

describe("dispatch-delegation.ts — límite estructural (Hito 6, tarea 13, ADR 78 pto 1-2)", () => {
  it("el código fuente no exporta DelegacionA2ANoImplementadaError (deuda del ADR 45 saldada)", () => {
    const source = readFileSync(new URL("./dispatch-delegation.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/DelegacionA2ANoImplementadaError/);
  });

  // Nota (ADR 78 pto 2): pasar `{ kind: "a2a", clave: ... }` como
  // `input.destino` de `despacharDelegacion` es, desde este cambio, un ERROR
  // DE COMPILACIÓN — `input.destino?` está angostado a
  // `Extract<DestinoDelegacion, { kind: "in-process" }>`. Un test en runtime
  // no puede demostrar un rechazo de compilación; la evidencia es
  // `npm run typecheck` (`tsc --noEmit`), no un `it` acá.
});

describe("SubagenteDesconocidoError", () => {
  it("es una clase de Error con nombre propio", () => {
    const error = new SubagenteDesconocidoError("rol-inexistente");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SubagenteDesconocidoError");
  });
});

/**
 * Hito 5, tarea 8 (§5.4 parte 2 — `despacharDelegacion`/`despacharCadena`).
 * Doble de `DelegacionStorePort` y de `InvocarSubagente` — mismo criterio de
 * "costura es `InvocarSubagente`" que design.md §9 documenta para este
 * módulo. `callOrder` (mismo molde que `handle-turn.test.ts`) prueba el
 * orden `crear → invocar → completar` con un spy ordenado real, no una
 * inferencia sobre el código.
 */

function makeNewId(): () => string {
  let contador = 0;
  return () => `id-${contador++}`;
}

function makeStore(callOrder: string[]): DelegacionStorePort {
  return {
    crearDelegacion: vi.fn(() => {
      callOrder.push("crear");
    }),
    completarDelegacion: vi.fn(() => {
      callOrder.push("completar");
    }),
  };
}

function makeInvocar(
  callOrder: string[],
  resultado: InvocacionSubagenteResult,
): InvocarSubagente {
  return vi.fn(async () => {
    callOrder.push("invocar");
    return resultado;
  });
}

function makeDeps(overrides: Partial<DespacharDelegacionDeps> = {}): DespacharDelegacionDeps {
  const callOrder: string[] = [];
  return {
    store: makeStore(callOrder),
    invocar: makeInvocar(callOrder, { responseText: "listo", sdkSessionId: "sdk-1" }),
    getSubagente: getSubagentDefinition,
    newId: makeNewId(),
    now: () => "2026-09-06T00:00:00.000Z",
    logEvent: vi.fn(),
    ...overrides,
  };
}

const insumoDePrueba: InsumoDelegado = {
  instruccion: "planificá la revisión del PR",
  material: "PR #42: agrega validación de entrada",
};

describe("despacharDelegacion", () => {
  it("despacha en el orden crear → invocar → completar (spy ordenado)", async () => {
    const callOrder: string[] = [];
    const deps: DespacharDelegacionDeps = {
      store: makeStore(callOrder),
      invocar: makeInvocar(callOrder, { responseText: "plan armado", sdkSessionId: "sdk-planner" }),
      getSubagente: getSubagentDefinition,
      newId: makeNewId(),
      now: () => "2026-09-06T00:00:00.000Z",
      logEvent: vi.fn(),
    };

    await despacharDelegacion(
      { casoId: "caso-1", agentId: PLANNER_AGENT_ID, insumo: insumoDePrueba },
      deps,
    );

    expect(callOrder).toEqual(["crear", "invocar", "completar"]);
  });

  it("falla del invocador deja la fila sin resultado, propaga sin revertir, sin tocar el estado canónico", async () => {
    const callOrder: string[] = [];
    const errorInvocador = new Error("el subagente no respondió");
    const store = makeStore(callOrder);
    const invocar: InvocarSubagente = vi.fn(async () => {
      callOrder.push("invocar");
      throw errorInvocador;
    });
    const deps: DespacharDelegacionDeps = {
      store,
      invocar,
      getSubagente: getSubagentDefinition,
      newId: makeNewId(),
      now: () => "2026-09-06T00:00:00.000Z",
      logEvent: vi.fn(),
    };

    await expect(
      despacharDelegacion(
        { casoId: "caso-1", agentId: PLANNER_AGENT_ID, insumo: insumoDePrueba },
        deps,
      ),
    ).rejects.toThrow(errorInvocador);

    expect(callOrder).toEqual(["crear", "invocar"]);
    expect(store.crearDelegacion).toHaveBeenCalledTimes(1);
    expect(store.completarDelegacion).not.toHaveBeenCalled();
  });

  it("parent_tool_use_id ausente no bloquea el despacho", async () => {
    const deps = makeDeps({
      invocar: vi.fn(async () => ({ responseText: "listo", sdkSessionId: "sdk-1" })),
    });

    const aplicada = await despacharDelegacion(
      { casoId: "caso-1", agentId: PLANNER_AGENT_ID, insumo: insumoDePrueba },
      deps,
    );

    expect(aplicada.resultado).toBe("listo");
    expect(deps.store.completarDelegacion).toHaveBeenCalledTimes(1);
  });
});

describe("despacharCadena", () => {
  it("encadena sesionPadreId (planner sin padre, developer=sesión planner, reviewer=sesión developer) y el material del rol N+1 es el resultado del rol N", async () => {
    const callOrder: string[] = [];
    const invocaciones: string[] = [];
    const store = makeStore(callOrder);
    const invocar: InvocarSubagente = vi.fn(async ({ agent }) => {
      invocaciones.push(agent.id);
      callOrder.push("invocar");
      return { responseText: `resultado de ${agent.id}`, sdkSessionId: `sdk-${agent.id}` };
    });
    const deps: DespacharDelegacionDeps = {
      store,
      invocar,
      getSubagente: getSubagentDefinition,
      newId: makeNewId(),
      now: () => "2026-09-06T00:00:00.000Z",
      logEvent: vi.fn(),
    };

    const eslabones: readonly Eslabon[] = [
      {
        agentId: PLANNER_AGENT_ID,
        insumo: { instruccion: "planificá la revisión", material: "PR #42: agrega validación" },
      },
      {
        agentId: DEVELOPER_AGENT_ID,
        insumo: { instruccion: "ejecutá el plan", material: "(se reemplaza por el resultado del planner)" },
      },
      {
        agentId: REVIEWER_AGENT_ID,
        insumo: { instruccion: "emití el veredicto", material: "(se reemplaza por el resultado del developer)" },
      },
    ];

    const resultados = await despacharCadena(eslabones, { casoId: "caso-1" }, deps);

    expect(invocaciones).toEqual([PLANNER_AGENT_ID, DEVELOPER_AGENT_ID, REVIEWER_AGENT_ID]);
    expect(resultados).toHaveLength(3);

    const [planner, developer, reviewer] = resultados as [
      DelegacionAplicada,
      DelegacionAplicada,
      DelegacionAplicada,
    ];

    const crearCalls = vi.mocked(store.crearDelegacion).mock.calls;
    expect(crearCalls[0]?.[0]?.sesionPadreId).toBeUndefined();
    expect(crearCalls[1]?.[0]?.sesionPadreId).toBe(planner.sesionSubagenteId);
    expect(crearCalls[2]?.[0]?.sesionPadreId).toBe(developer.sesionSubagenteId);

    // El material del rol N+1 ES el resultado (texto) del rol N — nunca su sesión.
    expect(developer.tareaDelegada).toContain(planner.resultado);
    expect(reviewer.tareaDelegada).toContain(developer.resultado);
  });

  it("propaga la falla de un eslabón sin capturar — despacharCadena no revierte nada", async () => {
    const callOrder: string[] = [];
    const store = makeStore(callOrder);
    const errorDeveloper = new Error("el developer falló");
    const invocar: InvocarSubagente = vi.fn(async ({ agent }) => {
      callOrder.push(`invocar:${agent.id}`);
      if (agent.id === DEVELOPER_AGENT_ID) {
        throw errorDeveloper;
      }
      return { responseText: `resultado de ${agent.id}`, sdkSessionId: `sdk-${agent.id}` };
    });
    const deps: DespacharDelegacionDeps = {
      store,
      invocar,
      getSubagente: getSubagentDefinition,
      newId: makeNewId(),
      now: () => "2026-09-06T00:00:00.000Z",
      logEvent: vi.fn(),
    };

    const eslabones: readonly Eslabon[] = [
      { agentId: PLANNER_AGENT_ID, insumo: { instruccion: "planificá", material: "PR #42" } },
      { agentId: DEVELOPER_AGENT_ID, insumo: { instruccion: "ejecutá el plan", material: "placeholder" } },
      { agentId: REVIEWER_AGENT_ID, insumo: { instruccion: "emití veredicto", material: "placeholder" } },
    ];

    await expect(despacharCadena(eslabones, { casoId: "caso-1" }, deps)).rejects.toThrow(errorDeveloper);

    // Planner completó su fila; Developer quedó creado sin resultado; Reviewer nunca se invocó.
    expect(store.crearDelegacion).toHaveBeenCalledTimes(2);
    expect(store.completarDelegacion).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["crear", "invocar:" + PLANNER_AGENT_ID, "completar", "crear", "invocar:" + DEVELOPER_AGENT_ID]);
  });
});
