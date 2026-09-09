import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  TAREA_DELEGADA_MAX_CHARS,
  TAREA_TRUNCADA_SUFIJO,
  type InsumoDelegado,
} from "../agents/subagents.js";
import {
  DESTINO_A2A_KPI_INCIDENTE,
  DESTINO_A2A_RIESGO_CREDITO,
  DelegacionA2ANoCompletadaError,
  DestinoA2ADesconocidoError,
  type ClienteA2APort,
  type ResultadoA2A,
} from "../agents/a2a-contract.js";
import {
  construirTareaDelegadaA2A,
  despacharDelegacionA2A,
  resolverDestinoA2A,
  type DelegacionA2AStorePort,
  type DespacharDelegacionA2ADeps,
} from "./dispatch-delegation-a2a.js";

/**
 * Hito 6, tarea 12 (§5.2 — la función hermana de `despacharDelegacion` para
 * el brazo externo). Fixtures puros: `ClienteA2APort` fake (`baseUrlDe`/
 * `delegar` configurables) + `DelegacionA2AStorePort` fake (`crearDelegacionA2A`/
 * `actualizarDelegacionA2A` como `vi.fn()`, registrando orden y args). Sin
 * SQLite — núcleo puro con puertos inyectados, mismo molde que
 * `dispatch-delegation.test.ts`.
 */

describe("resolverDestinoA2A", () => {
  it("de las dos claves válidas de DESTINOS_A2A resuelve {kind: 'a2a', clave}", () => {
    expect(resolverDestinoA2A(DESTINO_A2A_RIESGO_CREDITO)).toEqual({
      kind: "a2a",
      clave: DESTINO_A2A_RIESGO_CREDITO,
    });
    expect(resolverDestinoA2A(DESTINO_A2A_KPI_INCIDENTE)).toEqual({
      kind: "a2a",
      clave: DESTINO_A2A_KPI_INCIDENTE,
    });
  });

  it.each(["", "riesgo_credito", "otro"])(
    "con clave inválida %j lanza DestinoA2ADesconocidoError",
    (clave) => {
      expect(() => resolverDestinoA2A(clave)).toThrow(DestinoA2ADesconocidoError);
    },
  );
});

describe("construirTareaDelegadaA2A", () => {
  const insumo: InsumoDelegado = {
    instruccion: "evaluá el riesgo crediticio del caso",
    material: "Caso #7: solicitud de crédito por $50.000",
  };

  it("encabezado es la CLAVE, no un Agent Card — formato exacto de líneas", () => {
    const texto = construirTareaDelegadaA2A(DESTINO_A2A_RIESGO_CREDITO, insumo);

    expect(texto).toBe(
      [
        `Destino externo: ${DESTINO_A2A_RIESGO_CREDITO}`,
        `Instrucción: ${insumo.instruccion}`,
        "",
        insumo.material,
      ].join("\n"),
    );
  });

  it("trunca a TAREA_DELEGADA_MAX_CHARS agregando TAREA_TRUNCADA_SUFIJO cuando excede el tope", () => {
    const materialLargo = "M".repeat(TAREA_DELEGADA_MAX_CHARS + 500);
    const texto = construirTareaDelegadaA2A(DESTINO_A2A_KPI_INCIDENTE, {
      instruccion: "reportá el KPI",
      material: materialLargo,
    });

    expect(texto).toContain(TAREA_TRUNCADA_SUFIJO);
    expect(texto.length).toBe(TAREA_DELEGADA_MAX_CHARS + TAREA_TRUNCADA_SUFIJO.length);
    expect(texto).toBe(`${texto.slice(0, TAREA_DELEGADA_MAX_CHARS)}${TAREA_TRUNCADA_SUFIJO}`);
  });
});

function makeStore(callOrder: string[]): DelegacionA2AStorePort {
  return {
    crearDelegacionA2A: vi.fn(() => {
      callOrder.push("crear");
    }),
    actualizarDelegacionA2A: vi.fn(() => {
      callOrder.push("actualizar");
    }),
  };
}

function makeNewId(): () => string {
  let contador = 0;
  return () => `id-${contador++}`;
}

const insumoDePrueba: InsumoDelegado = {
  instruccion: "evaluá el riesgo crediticio del caso",
  material: "Caso #7: solicitud de crédito por $50.000",
};

const destinoRiesgo = { kind: "a2a", clave: DESTINO_A2A_RIESGO_CREDITO } as const;

function makeDeps(overrides: {
  callOrder?: string[];
  store?: DelegacionA2AStorePort;
  cliente?: ClienteA2APort;
}): DespacharDelegacionA2ADeps {
  const callOrder = overrides.callOrder ?? [];
  return {
    store: overrides.store ?? makeStore(callOrder),
    cliente:
      overrides.cliente ??
      ({
        baseUrlDe: vi.fn(() => "https://riesgo.example.com"),
        delegar: vi.fn(
          async (): Promise<ResultadoA2A> => ({
            ok: true,
            a2aTaskId: "task-1",
            estado: "TASK_STATE_COMPLETED",
            resultado: "riesgo bajo",
            agenteNombre: "Agente de Riesgo",
            endpoint: "https://riesgo.example.com/rpc",
          }),
        ),
      } satisfies ClienteA2APort),
    newId: makeNewId(),
    now: () => "2026-09-08T00:00:00.000Z",
    logEvent: vi.fn(),
  };
}

describe("despacharDelegacionA2A", () => {
  it("despacha en el orden baseUrlDe → crearDelegacionA2A → delegar → actualizarDelegacionA2A", async () => {
    const callOrder: string[] = [];
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => {
        callOrder.push("baseUrlDe");
        return "https://riesgo.example.com";
      }),
      delegar: vi.fn(async () => {
        callOrder.push("delegar");
        return {
          ok: true,
          a2aTaskId: "task-1",
          estado: "TASK_STATE_COMPLETED",
          resultado: "riesgo bajo",
          agenteNombre: "Agente de Riesgo",
          endpoint: "https://riesgo.example.com/rpc",
        } satisfies ResultadoA2A;
      }),
    };
    const deps = makeDeps({ callOrder, cliente });

    await despacharDelegacionA2A(
      { casoId: "caso-1", destino: destinoRiesgo, insumo: insumoDePrueba },
      deps,
    );

    expect(callOrder).toEqual(["baseUrlDe", "crear", "delegar", "actualizar"]);
  });

  it("sin destino configurado (baseUrlDe undefined) NO crea fila ni invoca delegar ni actualiza", async () => {
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => undefined),
      delegar: vi.fn(),
    };
    const deps = makeDeps({ cliente });

    await expect(
      despacharDelegacionA2A(
        { casoId: "caso-1", destino: destinoRiesgo, insumo: insumoDePrueba },
        deps,
      ),
    ).rejects.toThrow();

    expect(deps.store.crearDelegacionA2A).not.toHaveBeenCalled();
    expect(cliente.delegar).not.toHaveBeenCalled();
    expect(deps.store.actualizarDelegacionA2A).not.toHaveBeenCalled();
  });

  it("éxito devuelve DelegacionA2AAplicada correcto y actualiza con estado COMPLETED, a2aTaskId, resultado y el endpoint efectivo", async () => {
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => "https://riesgo.example.com"),
      delegar: vi.fn(
        async (): Promise<ResultadoA2A> => ({
          ok: true,
          a2aTaskId: "task-42",
          estado: "TASK_STATE_COMPLETED",
          resultado: "riesgo bajo, aprobar",
          agenteNombre: "Agente de Riesgo",
          endpoint: "https://riesgo.example.com/rpc/efectivo",
        }),
      ),
    };
    const deps = makeDeps({ cliente });

    const aplicada = await despacharDelegacionA2A(
      { casoId: "caso-1", destino: destinoRiesgo, insumo: insumoDePrueba },
      deps,
    );

    expect(aplicada).toEqual({
      delegacionId: "id-0",
      destinoClave: DESTINO_A2A_RIESGO_CREDITO,
      a2aTaskId: "task-42",
      agenteNombre: "Agente de Riesgo",
      tareaDelegada: construirTareaDelegadaA2A(DESTINO_A2A_RIESGO_CREDITO, insumoDePrueba),
      resultado: "riesgo bajo, aprobar",
    });

    expect(deps.store.actualizarDelegacionA2A).toHaveBeenCalledWith(
      expect.objectContaining({
        delegacionId: "id-0",
        estado: "TASK_STATE_COMPLETED",
        a2aTaskId: "task-42",
        resultado: "riesgo bajo, aprobar",
        agenteExternoUrl: "https://riesgo.example.com/rpc/efectivo",
      }),
    );
  });

  it("fallo persiste el último estado conocido y LUEGO lanza DelegacionA2ANoCompletadaError con ese reason (orden: persistencia antes del throw)", async () => {
    const callOrder: string[] = [];
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => "https://kpi.example.com"),
      delegar: vi.fn(async (): Promise<ResultadoA2A> => {
        callOrder.push("delegar");
        return {
          ok: false,
          reason: "timeout",
          estado: "TASK_STATE_WORKING",
          a2aTaskId: "task-7",
          endpoint: "https://kpi.example.com/rpc",
        };
      }),
    };
    const store: DelegacionA2AStorePort = {
      crearDelegacionA2A: vi.fn(() => callOrder.push("crear")),
      actualizarDelegacionA2A: vi.fn(() => callOrder.push("actualizar")),
    };
    const deps = makeDeps({ callOrder, cliente, store });

    const destinoKpi = { kind: "a2a", clave: DESTINO_A2A_KPI_INCIDENTE } as const;

    await expect(
      despacharDelegacionA2A({ casoId: "caso-1", destino: destinoKpi, insumo: insumoDePrueba }, deps),
    ).rejects.toThrow(DelegacionA2ANoCompletadaError);

    expect(callOrder).toEqual(["crear", "delegar", "actualizar"]);

    expect(store.actualizarDelegacionA2A).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: "TASK_STATE_WORKING",
        a2aTaskId: "task-7",
      }),
    );

    try {
      await despacharDelegacionA2A(
        { casoId: "caso-1", destino: destinoKpi, insumo: insumoDePrueba },
        deps,
      );
      expect.unreachable("debía lanzar DelegacionA2ANoCompletadaError");
    } catch (error) {
      expect(error).toBeInstanceOf(DelegacionA2ANoCompletadaError);
      expect((error as DelegacionA2ANoCompletadaError).reason).toBe("timeout");
    }
  });

  it("delegar() que falla por transporte SIN estado (Agent Card inalcanzable, GetTask nunca respondió) omite 'estado' del patch — nunca fabrica TASK_STATE_FAILED (code-review, hallazgo 1)", async () => {
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => "https://kpi.example.com"),
      delegar: vi.fn(async (): Promise<ResultadoA2A> => ({ ok: false, reason: "transporte" })),
    };
    const store: DelegacionA2AStorePort = {
      crearDelegacionA2A: vi.fn(),
      actualizarDelegacionA2A: vi.fn(),
    };
    const deps = makeDeps({ cliente, store });
    const destinoKpi = { kind: "a2a", clave: DESTINO_A2A_KPI_INCIDENTE } as const;

    await expect(
      despacharDelegacionA2A({ casoId: "caso-1", destino: destinoKpi, insumo: insumoDePrueba }, deps),
    ).rejects.toThrow(DelegacionA2ANoCompletadaError);

    expect(store.actualizarDelegacionA2A).toHaveBeenCalledTimes(1);
    const [patch] = (store.actualizarDelegacionA2A as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(patch).not.toHaveProperty("estado");
  });

  it("delegar() que falla con un estado real definido (ej. TASK_STATE_REJECTED de un GetTask real) persiste ese estado sin cambios (code-review, hallazgo 1)", async () => {
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => "https://kpi.example.com"),
      delegar: vi.fn(
        async (): Promise<ResultadoA2A> => ({
          ok: false,
          reason: "rejected",
          estado: "TASK_STATE_REJECTED",
          a2aTaskId: "task-9",
          endpoint: "https://kpi.example.com/rpc",
        }),
      ),
    };
    const store: DelegacionA2AStorePort = {
      crearDelegacionA2A: vi.fn(),
      actualizarDelegacionA2A: vi.fn(),
    };
    const deps = makeDeps({ cliente, store });
    const destinoKpi = { kind: "a2a", clave: DESTINO_A2A_KPI_INCIDENTE } as const;

    await expect(
      despacharDelegacionA2A({ casoId: "caso-1", destino: destinoKpi, insumo: insumoDePrueba }, deps),
    ).rejects.toThrow(DelegacionA2ANoCompletadaError);

    expect(store.actualizarDelegacionA2A).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "TASK_STATE_REJECTED", a2aTaskId: "task-9" }),
    );
  });

  it("delegar() que RECHAZA (viola su contrato) se traduce por el try/catch a {ok:false, reason:'transporte'} y sigue el flujo normal de fallo", async () => {
    const callOrder: string[] = [];
    const errorTransporte = new Error("socket colgado");
    const cliente: ClienteA2APort = {
      baseUrlDe: vi.fn(() => "https://riesgo.example.com"),
      delegar: vi.fn(async () => {
        callOrder.push("delegar");
        throw errorTransporte;
      }),
    };
    const store: DelegacionA2AStorePort = {
      crearDelegacionA2A: vi.fn(() => callOrder.push("crear")),
      actualizarDelegacionA2A: vi.fn(() => callOrder.push("actualizar")),
    };
    const deps = makeDeps({ callOrder, cliente, store });

    await expect(
      despacharDelegacionA2A(
        { casoId: "caso-1", destino: destinoRiesgo, insumo: insumoDePrueba },
        deps,
      ),
    ).rejects.toThrow(DelegacionA2ANoCompletadaError);

    expect(callOrder).toEqual(["crear", "delegar", "actualizar"]);
    // `delegar()` rechazando se traduce a `{ok:false, reason:"transporte"}`
    // SIN `estado` (nunca hubo un `SendMessage`/`GetTask` exitoso) — el
    // patch debe omitir la clave, no fabricar un valor (code-review,
    // hallazgo 1).
    const [patchRechazo] = (store.actualizarDelegacionA2A as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(patchRechazo).not.toHaveProperty("estado");

    // El reason que ve el resultado sigue siendo "transporte" (RD-22): no se
    // abre un vocabulario nuevo. Pero el log SÍ deja evidencia distinguible
    // de que esto fue una violación real del contrato "nunca rechaza"
    // (ADR 77), no una falla de transporte genuina.
    expect(deps.logEvent).toHaveBeenCalledWith(
      "caso-1",
      "a2a-delegar-violo-contrato",
      expect.objectContaining({ destinoClave: DESTINO_A2A_RIESGO_CREDITO }),
    );

    try {
      await despacharDelegacionA2A(
        { casoId: "caso-1", destino: destinoRiesgo, insumo: insumoDePrueba },
        deps,
      );
      expect.unreachable("debía lanzar DelegacionA2ANoCompletadaError");
    } catch (error) {
      expect(error).toBeInstanceOf(DelegacionA2ANoCompletadaError);
      expect((error as DelegacionA2ANoCompletadaError).reason).toBe("transporte");
    }
  });
});

describe("dispatch-delegation-a2a.ts — restricción estructural (Hito 6, tarea 12)", () => {
  it("el código fuente no importa nada de src/adapters/a2a/", () => {
    const source = readFileSync(new URL("./dispatch-delegation-a2a.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/from ["'].*adapters\/a2a/);
  });
});
