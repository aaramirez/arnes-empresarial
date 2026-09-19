/**
 * Test de WIRING de `main.ts` (`operaciones-negocio-conversacionales`, ADR
 * 173 pto 5, ADR 174 consecuencias, tarea 10). No es un test de
 * comportamiento de negocio -- eso ya lo cubren
 * `build-on-operaciones-empleado.test.ts`/`build-on-comando-empleado.test.ts`
 * -- sino de INTEGRACIÓN DE WIRING: confirma que `main.ts` construye
 * `reporteStore` UNA sola vez y pasa la MISMA instancia (`toBe`) a los dos
 * composition roots que la consumen (`buildOnOperacionesEmpleado` y
 * `buildOnComandoEmpleado`) -- "una instancia, dos consumidores", mismo
 * criterio que ya aplica `notifier`/`riesgoCredito`/`baseUrlPublica`.
 *
 * Estrategia: en vez de mockear cada módulo que `main.ts` importa, se deja
 * correr el arranque REAL con sus interruptores opt-in DESHABILITADOS --
 * sin `WEB_PORT`/`WEBHOOK_PORT`/`GITHUB_TOKEN`/`HARNESS_A2A_ENTRANTE_TOKEN`/
 * `HARNESS_A2A_SALIENTE` en el entorno de test, ningún servidor abre puerto
 * real ni hace ningún `fetch` (mismo criterio que `adapters/web/index.ts`/
 * `adapters/webhooks/index.ts` ya documentan para su propio modo
 * deshabilitado). Solo se mockea lo que SÍ tendría un efecto real e inseguro
 * en un test:
 *  - `openDatabase`: redirigido a una base `:memory:` REAL (mismas
 *    migraciones, mismo motor) en vez del archivo `data/harness.db`.
 *  - `startTui`: si no se mockea, `waitUntilExit()` nunca resuelve y el test
 *    cuelga esperando una interacción de terminal que no va a llegar.
 *  - `createGitAdapter`: si no se mockea, `barrerHuerfanos` corre contra el
 *    checkout REAL de este repo -- listar/limpiar worktrees de verdad no es
 *    aceptable como efecto secundario de un test.
 * `buildOnComandoEmpleado`/`buildOnOperacionesEmpleado` se ESPÍAN
 * (`vi.fn(actual)`), no se reemplazan: corren de verdad, solo se capturan
 * sus argumentos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { CONSULTAS_MCP_SERVER_NAME, CONSULTAS_TOOL_NAME } from "./core/agents/consultas-negocio-tool.js";

/**
 * Capturado por el mock de `openDatabase` de abajo — mismo `:memory:` REAL
 * que `main.ts` termina usando (mismas migraciones, mismo motor), así los
 * tests de los hallazgos 1 y 3 (`consultas-negocio-a2a-entrante`, Reviewer)
 * pueden sembrar filas ANTES de invocar la tool, sin mockear `repository.ts`.
 */
let dbCapturadoParaTest: Database.Database | undefined;

vi.mock("./adapters/memory/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/memory/db.js")>();
  return {
    ...actual,
    openDatabase: () => {
      dbCapturadoParaTest = actual.openDatabase(":memory:");
      return dbCapturadoParaTest;
    },
  };
});

vi.mock("./adapters/tui/start-tui.js", () => ({
  startTui: vi.fn(() => ({ waitUntilExit: () => Promise.resolve() })),
}));

vi.mock("./adapters/git/index.js", () => ({
  createGitAdapter: vi.fn(() => ({
    aplicarPatch: vi.fn(),
    barrido: { barrerHuerfanos: vi.fn().mockResolvedValue(undefined) },
  })),
}));

vi.mock("./build-on-comando-empleado.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-on-comando-empleado.js")>();
  return { ...actual, buildOnComandoEmpleado: vi.fn(actual.buildOnComandoEmpleado) };
});

vi.mock("./build-on-operaciones-empleado.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-on-operaciones-empleado.js")>();
  return { ...actual, buildOnOperacionesEmpleado: vi.fn(actual.buildOnOperacionesEmpleado) };
});

vi.mock("./build-on-a2a-entrante.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-on-a2a-entrante.js")>();
  return { ...actual, buildOnA2AEntrante: vi.fn(actual.buildOnA2AEntrante) };
});

const ENV_KEYS_A_LIMPIAR = [
  "WEB_PORT",
  "WEBHOOK_PORT",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_TOKEN",
  "HARNESS_A2A_ENTRANTE_TOKEN",
  "HARNESS_A2A_SALIENTE",
] as const;

describe("main.ts -- wiring de reporteStore compartido (operaciones-negocio-conversacionales, tarea 10)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    // `vi.mock`'s factory result (y por lo tanto el `vi.fn(actual)` que
    // envuelve) persiste entre `resetModules()` -- solo se limpia el
    // MÓDULO real, no el historial de llamadas del mock ya creado. Sin este
    // `clearAllMocks`, el segundo test de este archivo vería las llamadas
    // acumuladas del primero.
    vi.clearAllMocks();
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it("pasa la MISMA instancia de reporteStore a buildOnOperacionesEmpleado y a buildOnComandoEmpleado", async () => {
    await import("./main.js");

    const { buildOnComandoEmpleado } = await import("./build-on-comando-empleado.js");
    const { buildOnOperacionesEmpleado } = await import("./build-on-operaciones-empleado.js");

    const comandoMock = vi.mocked(buildOnComandoEmpleado);
    const operacionesMock = vi.mocked(buildOnOperacionesEmpleado);

    expect(comandoMock).toHaveBeenCalledTimes(1);
    expect(operacionesMock).toHaveBeenCalledTimes(1);

    const reporteStoreDeComando = comandoMock.mock.calls[0]?.[0].reporteStore;
    const reporteStoreDeOperaciones = operacionesMock.mock.calls[0]?.[0].reporteStore;

    expect(reporteStoreDeComando).toBeDefined();
    expect(reporteStoreDeOperaciones).toBeDefined();
    expect(reporteStoreDeComando).toBe(reporteStoreDeOperaciones);
  });

  it("pasa la misma instancia de credenciales a buildOnComandoEmpleado y a buildOnLoginHttp", async () => {
    await import("./main.js");

    const { buildOnComandoEmpleado } = await import("./build-on-comando-empleado.js");
    const comandoMock = vi.mocked(buildOnComandoEmpleado);

    expect(comandoMock).toHaveBeenCalledTimes(1);
    expect(comandoMock.mock.calls[0]?.[0].credenciales).toBeDefined();
  });

  it("pasa createKnowledge a buildOnOperacionesEmpleado (conocimiento-chat-empleado, ADR 234)", async () => {
    await import("./main.js");

    const { buildOnOperacionesEmpleado } = await import("./build-on-operaciones-empleado.js");
    const operacionesMock = vi.mocked(buildOnOperacionesEmpleado);

    expect(operacionesMock).toHaveBeenCalledTimes(1);
    expect(operacionesMock.mock.calls[0]?.[0].createKnowledge).toBeDefined();
  });

  it("pasa la MISMA instancia de registro a buildOnOperacionesEmpleado y a buildOnComandoEmpleado (ADR 188/RD-87, tarea 16)", async () => {
    await import("./main.js");

    const { buildOnComandoEmpleado } = await import("./build-on-comando-empleado.js");
    const { buildOnOperacionesEmpleado } = await import("./build-on-operaciones-empleado.js");

    const comandoMock = vi.mocked(buildOnComandoEmpleado);
    const operacionesMock = vi.mocked(buildOnOperacionesEmpleado);

    expect(comandoMock).toHaveBeenCalledTimes(1);
    expect(operacionesMock).toHaveBeenCalledTimes(1);

    const registroDeComando = comandoMock.mock.calls[0]?.[0].registro;
    const registroDeOperaciones = operacionesMock.mock.calls[0]?.[0].registro;

    expect(registroDeComando).toBeDefined();
    expect(registroDeOperaciones).toBeDefined();
    expect(registroDeComando).toBe(registroDeOperaciones);
  });
});

describe("main.ts -- wiring de createConsultas local al bloque de A2A entrante (consultas-negocio-a2a-entrante, tarea 10)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it("buildOnA2AEntrante recibe un createConsultas que produce un adaptador con mcpServers no vacío", async () => {
    await import("./main.js");

    const { buildOnA2AEntrante } = await import("./build-on-a2a-entrante.js");
    const a2aEntranteMock = vi.mocked(buildOnA2AEntrante);

    expect(a2aEntranteMock).toHaveBeenCalledTimes(1);

    const { createConsultas } = a2aEntranteMock.mock.calls[0]?.[0] ?? {};
    expect(typeof createConsultas).toBe("function");

    const adaptador = createConsultas?.("caso-de-prueba");
    expect(adaptador).toBeDefined();
    expect(Object.keys(adaptador?.mcpServers ?? {}).length).toBeGreaterThan(0);
  });

  it("createConsultas es LOCAL al bloque de A2A entrante — no entra a StartupResult ni al objeto que arma createKnowledge", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    const startupResultMatch = source.match(/interface StartupResult \{([\s\S]*?)\n\}/);
    expect(startupResultMatch).not.toBeNull();
    expect(startupResultMatch?.[1] ?? "").not.toMatch(/createConsultas/);

    const startHarnessReturnMatch = source.match(/return \{ agents, hooks, memory, caso, db, createKnowledge,[^}]*\};/);
    expect(startHarnessReturnMatch).not.toBeNull();
    expect(startHarnessReturnMatch?.[0] ?? "").not.toMatch(/createConsultas/);
  });
});

/**
 * Hallazgos 1 y 3 de Reviewer sobre `createConsultas` (`consultas-negocio-a2a-entrante`,
 * tarea 10). Invoca el handler REAL de la tool `consultar_negocio` vía
 * `_registeredTools`, bypaseando el protocolo MCP — mismo criterio ya
 * documentado en `adapters/knowledge/index.test.ts`/`adapters/consultas/index.test.ts`.
 */
async function invokeConsultasHandlerDirect(
  adaptador: { readonly mcpServers: Record<string, unknown> },
  args: Readonly<Record<string, unknown>>,
): Promise<string> {
  const server = adaptador.mcpServers[CONSULTAS_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly _registeredTools: Record<
        string,
        { readonly handler: (args: unknown, extra: unknown) => Promise<unknown> }
      >;
    };
  };
  const registeredTool = server.instance._registeredTools[CONSULTAS_TOOL_NAME];
  if (registeredTool === undefined) {
    throw new Error(`test setup error: tool "${CONSULTAS_TOOL_NAME}" was not registered`);
  }
  const result = (await registeredTool.handler(args, {})) as {
    readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  };
  return result.content[0].text;
}

describe("main.ts -- hallazgos de Reviewer sobre createConsultas (consultas-negocio-a2a-entrante)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  /**
   * A diferencia del describe de arriba (que deja correr `main.js` HASTA EL
   * FINAL antes de inspeccionar), estos tres tests necesitan sembrar filas
   * y llamar a la tool CON LA BASE TODAVÍA ABIERTA -- `main.ts` la cierra
   * recién después de que `startTui(...).waitUntilExit()` resuelve (ver el
   * module doc de este archivo). Por eso `waitUntilExit` se sobreescribe acá
   * para devolver una promesa que ESTA función controla (`resolverSalidaTui`):
   * `main.js` queda suspendido justo antes de cerrar la base, dando lugar a
   * sembrar datos e invocar la tool real. Cada test debe llamar
   * `resolverSalidaTui()` al final para no dejar la importación colgada
   * entre tests.
   */
  async function getCreateConsultas(): Promise<{
    readonly createConsultas: (casoId: string) => { readonly mcpServers: Record<string, unknown> };
    readonly resolverSalidaTui: () => void;
  }> {
    let resolverSalidaTui: () => void = () => {};
    const salidaTuiPromise = new Promise<void>((resolve) => {
      resolverSalidaTui = resolve;
    });
    // Resuelto/cacheado ANTES de disparar `import("./main.js")`: si los dos
    // `import()` de este mismo módulo mockeado corrieran en paralelo antes de
    // que la factory de `vi.mock` (arriba, `async (importOriginal) => ...`)
    // terminara de resolver, `main.js` podría terminar importando una
    // instancia distinta del mock que la que este test sostiene acá.
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const { buildOnA2AEntrante } = await import("./build-on-a2a-entrante.js");
    const a2aEntranteMock = vi.mocked(buildOnA2AEntrante);

    vi.mocked(startTui).mockImplementationOnce(() => ({
      unmount: () => {},
      waitUntilExit: () => salidaTuiPromise,
    }));

    // Deliberadamente SIN `await`: la importación queda corriendo en
    // background y se suspende en el `await waitUntilExit()` de arriba --
    // `buildOnA2AEntrante` ya fue invocado ANTES de esa línea (wiring de A2A
    // entrante precede al montaje de la TUI), así que alcanza con esperar a
    // que el mock registre esa llamada.
    void import("./main.js");

    // `setImmediate` en loop apretado puede dejar sin turnos a la fase de
    // I/O que necesita vite-node para transformar/ejecutar `main.js` (visto
    // en checkouts con árbol de módulos grande) -- `setTimeout` sí cede esa
    // fase de forma confiable.
    const MAX_INTENTOS = 5000;
    for (let intento = 0; intento < MAX_INTENTOS && a2aEntranteMock.mock.calls.length === 0; intento += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const { createConsultas } = a2aEntranteMock.mock.calls[0]?.[0] ?? {};
    if (createConsultas === undefined) {
      throw new Error("test setup error: createConsultas no fue pasado a buildOnA2AEntrante");
    }
    return { createConsultas, resolverSalidaTui };
  }

  it("Hallazgo 1 -- solicitudes_pendientes: el total refleja MÁS de 20 solicitudes reales, sin truncar al límite por defecto de repository.ts", async () => {
    const { createConsultas, resolverSalidaTui } = await getCreateConsultas();
    const db = dbCapturadoParaTest;
    if (db === undefined) {
      throw new Error("test setup error: openDatabase no fue capturado");
    }
    const { crearSolicitudConCaso } = await import("./adapters/memory/repository.js");

    const TOTAL_SOLICITUDES = 25;
    for (let i = 0; i < TOTAL_SOLICITUDES; i += 1) {
      crearSolicitudConCaso(db, {
        caso: { id: `caso-solicitud-${i}`, tipo: "solicitud_interna", estado: "pendiente_aprobacion_humana" },
        solicitud: {
          id: `solicitud-${i}`,
          solicitanteId: "empleado-x",
          tipo: "vacaciones",
          detalle: `solicitud ${i}`,
          estado: "pendiente_aprobacion_humana",
        },
        timestamp: `2026-09-07T00:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }

    const adaptador = createConsultas("caso-de-prueba");
    const texto = await invokeConsultasHandlerDirect(adaptador, { operacion: "solicitudes_pendientes" });

    expect(texto).toContain(`Total: ${TOTAL_SOLICITUDES}`);
    expect(texto).not.toContain("Total: 20");
    resolverSalidaTui();
  });

  it("Hallazgo 1 -- reembolsos_pendientes: el total refleja MÁS de 20 escalaciones reales, sin truncar al límite por defecto de repository.ts", async () => {
    const { createConsultas, resolverSalidaTui } = await getCreateConsultas();
    const db = dbCapturadoParaTest;
    if (db === undefined) {
      throw new Error("test setup error: openDatabase no fue capturado");
    }
    const { createVentaConCaso, confirmarVentaConComision, escalarReembolso } = await import(
      "./adapters/memory/repository.js"
    );

    const TOTAL_ESCALACIONES = 25;
    for (let i = 0; i < TOTAL_ESCALACIONES; i += 1) {
      createVentaConCaso(db, {
        vendedor: { id: "vendedor-x", nombre: "Vendedora X" },
        caso: {
          id: `caso-venta-${i}`,
          tipo: "venta",
          estado: "pendiente_confirmacion",
          createdAt: `2026-09-07T00:00:${String(i).padStart(2, "0")}.000Z`,
          updatedAt: `2026-09-07T00:00:${String(i).padStart(2, "0")}.000Z`,
        },
        venta: {
          id: `venta-${i}`,
          clienteId: "cliente-x",
          planNuevo: "premium",
          monto: 100,
          estado: "pendiente_confirmacion",
          tokenConfirmacion: `token-${i}`,
        },
        timestamp: `2026-09-07T00:00:${String(i).padStart(2, "0")}.000Z`,
      });
      confirmarVentaConComision(db, {
        ventaId: `venta-${i}`,
        comisionId: `comision-${i}`,
        comisionMonto: 15,
        periodo: "2026-09",
        ahora: `2026-09-07T01:00:${String(i).padStart(2, "0")}.000Z`,
      });
      escalarReembolso(db, {
        ventaId: `venta-${i}`,
        casoId: `caso-venta-${i}`,
        ahora: `2026-09-07T02:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }

    const adaptador = createConsultas("caso-de-prueba");
    const texto = await invokeConsultasHandlerDirect(adaptador, { operacion: "reembolsos_pendientes" });

    expect(texto).toContain(`Total: ${TOTAL_ESCALACIONES}`);
    expect(texto).not.toContain("Total: 20");
    resolverSalidaTui();
  });

  it("Hallazgo 3 -- estado_actividad: un estado corrupto en la base no se expone crudo, la tool responde el mensaje de error seguro", async () => {
    const { createConsultas, resolverSalidaTui } = await getCreateConsultas();
    const db = dbCapturadoParaTest;
    if (db === undefined) {
      throw new Error("test setup error: openDatabase no fue capturado");
    }
    const { createCasoConActividad } = await import("./adapters/memory/repository.js");

    createCasoConActividad(db, {
      proyecto: { id: "acme/repo", nombre: "repo", repoUrl: "https://github.com/acme/repo" },
      caso: {
        id: "caso-actividad-1",
        tipo: "pr_review",
        estado: "activo",
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
      actividad: {
        id: "actividad-1",
        tipo: "pr_review",
        referenciaExterna: "42",
        estado: "pendiente_revision",
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
      timestamp: "2026-09-07T00:00:00.000Z",
    });
    // Corrupción deliberada, mismo molde que `build-on-activity.test.ts`
    // ("estado inválido en la base"): un UPDATE crudo por fuera de
    // `ACTIVIDAD_ESTADOS`, para demostrar que el closure de `main.ts` no lo
    // castea a ciegas.
    db.prepare("UPDATE actividades SET estado = ? WHERE id = ?").run("estado_invalido", "actividad-1");

    const adaptador = createConsultas("caso-de-prueba");
    const texto = await invokeConsultasHandlerDirect(adaptador, {
      operacion: "estado_actividad",
      proyectoId: "acme/repo",
      referenciaExterna: "42",
    });

    expect(texto).not.toContain("estado_invalido");
    expect(texto).toBe("NO SE PUDO CONSULTAR el estado de la actividad. Intentá de nuevo más tarde.");
    resolverSalidaTui();
  });
});
