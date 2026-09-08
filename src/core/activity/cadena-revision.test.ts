import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  getSubagentDefinition,
} from "../agents/definitions.js";
import {
  TAREA_DELEGADA_MAX_CHARS,
  type InvocacionSubagenteResult,
  type InvocarSubagente,
} from "../agents/subagents.js";
import type { WorktreeAbierto, WorktreePort } from "../agents/worktree-contract.js";
import type { PropuestaCambio, PropuestaStorePort } from "../propuestas/propuestas-contract.js";
import type {
  DelegacionStorePort,
  DespacharDelegacionDeps,
} from "../turn-selector/dispatch-delegation.js";
import { VEREDICTO_PREFIX } from "./activity-contract.js";
import {
  construirEslabonesRevision,
  despacharRevisionPorRoles,
  type EscrituraDelegadaDeps,
} from "./cadena-revision.js";

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

/**
 * Hito 5.1, tarea 30 (§5.8 — `EscrituraDelegadaDeps`). Dobles adicionales
 * sobre los de arriba: `WorktreePort` y `PropuestaStorePort` fake, más un
 * `newId`/`now`/`logEvent` PROPIOS de `escritura` (puerto separado del
 * `deps.newId`/`deps.now`/`deps.logEvent` de la fila de `delegaciones` — ver
 * la nota de la tarea sobre por qué el eslabón del Developer sigue
 * escribiendo su propia fila vía `deps.store`, replicando a mano lo que
 * `despacharDelegacion` hace internamente).
 */

function makeWorktreeAbierto(casoId: string, id: string): WorktreeAbierto {
  return {
    casoId,
    ruta: `/harness/worktrees/${casoId}-${id}`,
    rama: `harness/caso-${casoId}-${id}`,
    baseCommit: "sha-base-0",
  };
}

function makeWorktreePort(overrides: Partial<WorktreePort> = {}): WorktreePort {
  return {
    abrir: vi.fn(async ({ casoId, id }) => makeWorktreeAbierto(casoId, id)),
    capturarDiff: vi.fn(async () => "diff --git a/x.ts b/x.ts\n+hola\n"),
    cerrar: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makePropuestaCambio(overrides: Partial<PropuestaCambio> = {}): PropuestaCambio {
  return {
    id: "propuesta-0",
    casoId: "caso-1",
    baseCommit: "sha-base-0",
    ramaWorktree: "harness/caso-caso-1-0",
    patch: "diff --git a/x.ts b/x.ts\n+hola\n",
    patchBytes: 40,
    archivos: 1,
    lineasAgregadas: 1,
    lineasEliminadas: 0,
    estado: "pendiente_aprobacion_humana",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function makePropuestaStorePort(overrides: Partial<PropuestaStorePort> = {}): PropuestaStorePort {
  return {
    crearPropuesta: vi.fn((input) =>
      makePropuestaCambio({
        id: "propuesta-0",
        casoId: input.casoId,
        ...(input.delegacionId !== undefined ? { delegacionId: input.delegacionId } : {}),
        baseCommit: input.baseCommit,
        ramaWorktree: input.ramaWorktree,
        patch: input.patch,
        patchBytes: input.resumen.patchBytes,
        archivos: input.resumen.archivos,
        lineasAgregadas: input.resumen.lineasAgregadas,
        lineasEliminadas: input.resumen.lineasEliminadas,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }),
    ),
    obtenerPropuesta: vi.fn(() => makePropuestaCambio()),
    listarPropuestasPendientes: vi.fn(() => []),
    aplicarPropuesta: vi.fn(() => undefined),
    descartarPropuesta: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeEscrituraNewId(prefijo: string): () => string {
  let contador = 0;
  return () => `${prefijo}-${contador++}`;
}

function makeEscritura(overrides: Partial<EscrituraDelegadaDeps> = {}): EscrituraDelegadaDeps {
  return {
    worktree: makeWorktreePort(),
    propuestas: makePropuestaStorePort(),
    testRunnerMcpServers: vi.fn(() => ({})),
    newId: makeEscrituraNewId("wt"),
    now: () => "2026-09-06T00:00:00.000Z",
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("despacharRevisionPorRoles con escritura delegada", () => {
  it("abre worktree, invoca al developer con cwd/mcpServers, captura el diff, crea la propuesta y cierra el worktree, en ese orden", async () => {
    const orden: string[] = [];

    const worktree = makeWorktreePort({
      abrir: vi.fn(async ({ casoId, id }) => {
        orden.push("abrir");
        return makeWorktreeAbierto(casoId, id);
      }),
      capturarDiff: vi.fn(async () => {
        orden.push("capturar");
        return "diff --git a/x.ts b/x.ts\n+hola\n";
      }),
      cerrar: vi.fn(async () => {
        orden.push("cerrar");
      }),
    });
    const propuestas = makePropuestaStorePort({
      crearPropuesta: vi.fn((input) => {
        orden.push("crear");
        return makePropuestaCambio({
          casoId: input.casoId,
          baseCommit: input.baseCommit,
          ramaWorktree: input.ramaWorktree,
          patch: input.patch,
          patchBytes: input.resumen.patchBytes,
        });
      }),
    });
    const mcpServersDelDeveloper: Options["mcpServers"] = {};
    const invocar: InvocarSubagente = vi.fn(async ({ agent, cwd, mcpServers }) => {
      if (agent.id === DEVELOPER_AGENT_ID) {
        orden.push("invocar");
        expect(cwd).toBe("/harness/worktrees/caso-1-wt-0");
        expect(mcpServers).toBe(mcpServersDelDeveloper);
        return { responseText: "hallazgos del developer", sdkSessionId: "sdk-developer" };
      }
      if (agent.id === PLANNER_AGENT_ID) {
        return { responseText: "plan armado", sdkSessionId: "sdk-planner" };
      }
      return {
        responseText: `${VEREDICTO_PREFIX} aprobado`,
        sdkSessionId: "sdk-reviewer",
      };
    });
    const deps = makeDeps({ invocar });
    const escritura = makeEscritura({
      worktree,
      propuestas,
      testRunnerMcpServers: vi.fn(() => mcpServersDelDeveloper),
    });

    const outcome = await despacharRevisionPorRoles("caso-1", "PR #42", deps, escritura);

    expect(orden).toEqual(["abrir", "invocar", "capturar", "crear", "cerrar"]);
    expect(outcome).toEqual({
      responseText: `${VEREDICTO_PREFIX} aprobado`,
      agentLabel: REVIEWER_AGENT_ID,
    });
  });

  it("cierra el worktree también cuando capturarDiff rechaza (ADR 58 pto 3 / ADR 70)", async () => {
    const cerrar = vi.fn(async () => undefined);
    const worktree = makeWorktreePort({
      capturarDiff: vi.fn(async () => {
        throw new Error("git diff explotó");
      }),
      cerrar,
    });
    const deps = makeDeps();
    const escritura = makeEscritura({ worktree });

    await expect(despacharRevisionPorRoles("caso-1", "PR #42", deps, escritura)).rejects.toThrow(
      "git diff explotó",
    );

    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("el material del Reviewer sale de obtenerPropuesta(id).patch, nunca de la variable en memoria", async () => {
    const propuestas = makePropuestaStorePort({
      crearPropuesta: vi.fn(() =>
        makePropuestaCambio({ patch: "PATCH EN MEMORIA (nunca debe llegar al Reviewer)" }),
      ),
      obtenerPropuesta: vi.fn(() =>
        makePropuestaCambio({ patch: "PATCH LEIDO DE VUELTA DE LA BASE" }),
      ),
    });
    const materialesRecibidos: Record<string, string> = {};
    const invocar: InvocarSubagente = vi.fn(async ({ agent, tareaDelegada }) => {
      materialesRecibidos[agent.id] = tareaDelegada;
      if (agent.id === REVIEWER_AGENT_ID) {
        return { responseText: `${VEREDICTO_PREFIX} aprobado`, sdkSessionId: "sdk-reviewer" };
      }
      return { responseText: `resultado de ${agent.id}`, sdkSessionId: `sdk-${agent.id}` };
    });
    const deps = makeDeps({ invocar });
    const escritura = makeEscritura({ propuestas });

    await despacharRevisionPorRoles("caso-1", "PR #42", deps, escritura);

    expect(materialesRecibidos[REVIEWER_AGENT_ID]).toContain("PATCH LEIDO DE VUELTA DE LA BASE");
    expect(materialesRecibidos[REVIEWER_AGENT_ID]).not.toContain("PATCH EN MEMORIA");
  });

  it("patchBytes > TAREA_DELEGADA_MAX_CHARS emite propuesta-revision-parcial y el ciclo completa igual con un único veredicto", async () => {
    const patchBytesGrande = TAREA_DELEGADA_MAX_CHARS + 1;
    const propuestas = makePropuestaStorePort({
      obtenerPropuesta: vi.fn((propuestaId) =>
        makePropuestaCambio({ id: propuestaId, patchBytes: patchBytesGrande }),
      ),
    });
    const logEvent = vi.fn();
    const invocar = makeInvocar({
      [REVIEWER_AGENT_ID]: { responseText: `${VEREDICTO_PREFIX} observado`, sdkSessionId: "sdk-reviewer" },
    });
    const deps = makeDeps({ invocar });
    const escritura = makeEscritura({ propuestas, logEvent });

    const outcome = await despacharRevisionPorRoles("caso-1", "PR #42", deps, escritura);

    expect(logEvent).toHaveBeenCalledWith(
      "caso-1",
      "propuesta-revision-parcial",
      expect.objectContaining({
        propuestaId: "propuesta-0",
        patchBytes: patchBytesGrande,
        topeTarea: TAREA_DELEGADA_MAX_CHARS,
      }),
    );
    expect(outcome).toEqual({
      responseText: `${VEREDICTO_PREFIX} observado`,
      agentLabel: REVIEWER_AGENT_ID,
    });
  });

  it("con escritura ausente, el comportamiento es idéntico al de v2.0.0: no abre worktree ni crea fila", async () => {
    const worktree = makeWorktreePort();
    const propuestas = makePropuestaStorePort();
    // `escritura` se construye pero deliberadamente NO se pasa: prueba que
    // `despacharRevisionPorRoles` con su parámetro opcional ausente no toca
    // ninguno de estos puertos, ni siquiera si el composition root los tuviera
    // disponibles (interruptor en "off").
    void makeEscritura({ worktree, propuestas });

    const invocar = makeInvocar({
      [REVIEWER_AGENT_ID]: { responseText: `${VEREDICTO_PREFIX} aprobado`, sdkSessionId: "sdk-reviewer" },
    });
    const deps = makeDeps({ invocar });

    const outcome = await despacharRevisionPorRoles("caso-1", "PR #42", deps);

    expect(worktree.abrir).not.toHaveBeenCalled();
    expect(propuestas.crearPropuesta).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      responseText: `${VEREDICTO_PREFIX} aprobado`,
      agentLabel: REVIEWER_AGENT_ID,
    });
  });
});
