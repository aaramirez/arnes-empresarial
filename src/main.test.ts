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
import { readdirSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { CONSULTAS_MCP_SERVER_NAME, CONSULTAS_TOOL_NAME } from "./core/agents/consultas-negocio-tool.js";
import { insertAccionEmpleado } from "./adapters/memory/repository.js";

/**
 * Capturado por el mock de `openDatabase` de abajo — mismo `:memory:` REAL
 * que `main.ts` termina usando (mismas migraciones, mismo motor), así los
 * tests de los hallazgos 1 y 3 (`consultas-negocio-a2a-entrante`, Reviewer)
 * pueden sembrar filas ANTES de invocar la tool, sin mockear `repository.ts`.
 */
let dbCapturadoParaTest: Database.Database | undefined;
/**
 * Argumento REAL con el que `main.ts` invocó `openDatabase` (`resolveDbPath()`
 * resuelto por `main.ts`, no un valor fijo) — capturado sin alterar el
 * comportamiento de arriba: la base que usan los tests sigue siendo
 * `:memory:` siempre (`modo-headless-cierre-limpio`, tarea 1.4, E1).
 */
let dbPathCapturado: string | undefined;

vi.mock("./adapters/memory/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/memory/db.js")>();
  return {
    ...actual,
    openDatabase: (filePath: string) => {
      dbPathCapturado = filePath;
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

/**
 * `modo-headless-cierre-limpio` (tareas 3.4/3.5) — los tres arranques de
 * servidor se mockean al nivel del MÓDULO (no por variable de entorno, como
 * hacía el resto de la suite hasta acá): así cada test de cierre por señal
 * controla directamente cuándo resuelve/rechaza `close()`, sin tener que
 * levantar un socket real. Sin `mockResolvedValueOnce` explícito, el
 * `vi.fn()` sin implementación devuelve `undefined` -- EXACTAMENTE el mismo
 * resultado que el resto de los tests de este archivo ya observaban con los
 * puertos/tokens deshabilitados (E9), así que esto no cambia ningún test
 * existente.
 */
vi.mock("./adapters/web/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/web/index.js")>();
  return { ...actual, startWebServer: vi.fn() };
});

vi.mock("./adapters/webhooks/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/webhooks/index.js")>();
  return { ...actual, startWebhookServer: vi.fn() };
});

vi.mock("./adapters/a2a/server-index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/a2a/server-index.js")>();
  return { ...actual, startA2AServer: vi.fn() };
});

/**
 * `modo-headless-cierre-limpio` (tarea 3.3) — decisión de wiring documentada
 * en el commit: `main.ts` llama a `esperarSenalDeCierre()`/
 * `finalizarCierreHeadless()` SIN argumentos (design.md §3.2), así que estos
 * tests inyectan un EMISOR y un SALIR falsos por `vi.mock` de
 * `./proceso-cierre.js` — la lógica REAL de ese módulo corre siempre (nunca
 * se reemplaza), solo se le fuerza `proceso`/`salir` a los dobles de abajo:
 * el `process` real de Vitest NUNCA recibe un listener ni un `exit` (R18,
 * R20). `vi.hoisted` porque el factory de `vi.mock` (hoisteado al tope del
 * archivo por Vitest) necesita estas referencias ya creadas.
 */
const { procesoFalsoParaTest, salirEspiaParaTest, logEventEspiaParaTest, eventosDeProcesoParaTest } = vi.hoisted(
  () => {
    const handlers = new Map<string, Set<(arg?: unknown) => void>>();
    const procesoFalsoParaTest = {
      on: (evento: string, handler: (arg?: unknown) => void): void => {
        const conjunto = handlers.get(evento) ?? new Set<(arg?: unknown) => void>();
        conjunto.add(handler);
        handlers.set(evento, conjunto);
      },
      off: (evento: string, handler: (arg?: unknown) => void): void => {
        handlers.get(evento)?.delete(handler);
      },
      emitir: (evento: string, arg?: unknown): void => {
        for (const handler of [...(handlers.get(evento) ?? [])]) {
          handler(arg);
        }
      },
      contarListeners: (evento: string): number => handlers.get(evento)?.size ?? 0,
      /** Fuerza el mapa de handlers a vacío entre tests, sin depender de que un `import("./main.js")` suspendido llegue a llamar `finalizarCierreHeadless()`. */
      limpiar: (): void => {
        handlers.clear();
      },
    };
    // Espía de `logEvent`, en vez de dejar correr el `logTurnEvent` real: los
    // tests de 3.4/3.5 necesitan afirmar sobre `cierre-senal-recibida`,
    // `cierre-presupuesto-excedido`, etc. sin depender de `data/harness.log`
    // en disco ni de su timing de escritura síncrona.
    const eventosDeProcesoParaTest: { casoId: string; event: string; fields: Record<string, unknown> }[] = [];
    const logEventEspiaParaTest = vi.fn(
      (casoId: string, event: string, fields: Record<string, unknown> = {}): void => {
        eventosDeProcesoParaTest.push({ casoId, event, fields });
      },
    );
    return {
      procesoFalsoParaTest,
      salirEspiaParaTest: vi.fn((_codigo: number): void => {}),
      logEventEspiaParaTest,
      eventosDeProcesoParaTest,
    };
  },
);

vi.mock("./proceso-cierre.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./proceso-cierre.js")>();
  return {
    ...real,
    esperarSenalDeCierre: (deps?: Parameters<typeof real.esperarSenalDeCierre>[0]) =>
      real.esperarSenalDeCierre({
        proceso: procesoFalsoParaTest,
        salir: salirEspiaParaTest,
        logEvent: logEventEspiaParaTest,
        ...deps,
      }),
    finalizarCierreHeadless: (deps?: Parameters<typeof real.finalizarCierreHeadless>[0]) =>
      real.finalizarCierreHeadless({
        proceso: procesoFalsoParaTest,
        salir: salirEspiaParaTest,
        logEvent: logEventEspiaParaTest,
        ...deps,
      }),
  };
});

const ENV_KEYS_A_LIMPIAR = [
  "WEB_PORT",
  "WEBHOOK_PORT",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_TOKEN",
  "HARNESS_A2A_ENTRANTE_TOKEN",
  "HARNESS_A2A_SALIENTE",
  "HARNESS_HEADLESS",
  "HARNESS_SHUTDOWN_TIMEOUT_MS",
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
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): FIJADA, no solo borrada.
    // `ENV_KEYS_A_LIMPIAR` de arriba solo hace `delete`, y cada reimportación
    // de `main.js` re-ejecuta `loadDotenv()`, que rellena desde `.env` lo que
    // falta -- `dotenv` no pisa una variable ya definida, aunque sea `"0"`.
    // Sin esto, un `HARNESS_HEADLESS=1` en el `.env` del dev cuelga las seis
    // importaciones de este archivo.
    process.env.HARNESS_HEADLESS = "0";
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
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): ver el comentario del
    // primer `beforeEach` de este archivo.
    process.env.HARNESS_HEADLESS = "0";
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
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): ver el comentario del
    // primer `beforeEach` de este archivo.
    process.env.HARNESS_HEADLESS = "0";
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

/**
 * `consulta-kpi-a2a-chat`, tarea 4.1 (ADR 245 pto 3). Test mecanico sobre el
 * fuente de `main.ts` (NO importa `./main.js`): la segunda instancia del
 * adaptador A2A, la del canal conversacional, existe si y solo si existe la
 * de la TUI, y la config de la TUI queda intacta.
 */
function bloqueEntre(source: string, inicio: string, fin: string): string {
  const desde = source.indexOf(inicio);
  if (desde === -1) {
    throw new Error(`ancla de inicio no encontrada en main.ts: ${inicio}`);
  }
  const hasta = source.indexOf(fin, desde + inicio.length);
  if (hasta === -1) {
    throw new Error(`ancla de fin no encontrada en main.ts: ${fin}`);
  }
  return source.slice(desde, hasta);
}

function contar(texto: string, aguja: string): number {
  return texto.split(aguja).length - 1;
}

describe("main.ts -- segunda instancia del adaptador A2A para el canal conversacional (consulta-kpi-a2a-chat, tarea 4.1)", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("(i) el interruptor y la config se resuelven una vez y el adaptador se instancia dos veces", () => {
    const tramo = bloqueEntre(source, "const a2aConfig", "const riesgoCredito");
    expect(contar(tramo, "resolveA2AConfig(")).toBe(1);
    expect(contar(tramo, "createA2AAdapter(")).toBe(2);
    expect(contar(tramo, "isA2ASalienteEnabled(")).toBe(1);
  });

  it("(ii) clienteA2AChat existe si y solo si existe el de la TUI y usa configParaCanalConversacional", () => {
    const bloque = bloqueEntre(source, "const clienteA2AChat", "const riesgoCredito");
    expect(bloque).toContain("clienteA2A !== undefined");
    expect(bloque).toContain("configParaCanalConversacional(a2aConfig)");
  });

  it("(iii) el cliente de la TUI/ventas conserva su config, sin los techos del canal conversacional", () => {
    const bloque = bloqueEntre(source, "const clienteA2A =", "const clienteA2AChat");
    expect(bloque).not.toContain("configParaCanalConversacional");
  });

  it("(iv) el turno de operaciones recibe el cliente del chat y el resto sigue con el de la TUI", () => {
    const llamada = bloqueEntre(source, "buildOnOperacionesEmpleado({", "\n});");
    expect(llamada).toContain("clienteA2A: clienteA2AChat");
    // `\b`: "clienteA2A: clienteA2AChat" contiene como prefijo "clienteA2A: clienteA2A".
    expect(llamada).not.toMatch(/clienteA2A: clienteA2A\b/);

    const riesgo = bloqueEntre(source, "const riesgoCredito", "const ventaHandlers");
    expect(riesgo).toContain("cliente: clienteA2A,");

    expect(source).toContain(
      "...(clienteA2A !== undefined ? { clienteA2A } : {}), // exactOptionalPropertyTypes\n});",
    );
  });
});

describe("main.ts -- abre la base por resolveDbPath (modo-headless-cierre-limpio, tarea 1.4, E1)", () => {
  const original: Record<string, string | undefined> = {};
  let dbPathPrevio: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dbPathCapturado = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    dbPathPrevio = process.env.HARNESS_DB_PATH;
    delete process.env.HARNESS_DB_PATH;
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): ver el comentario del
    // primer `beforeEach` de este archivo.
    process.env.HARNESS_HEADLESS = "0";
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    if (dbPathPrevio === undefined) {
      delete process.env.HARNESS_DB_PATH;
    } else {
      process.env.HARNESS_DB_PATH = dbPathPrevio;
    }
  });

  it("sin HARNESS_DB_PATH, openDatabase recibe el default data/harness.db", async () => {
    await import("./main.js");
    expect(dbPathCapturado).toBe("data/harness.db");
  });

  it("con HARNESS_DB_PATH definida, openDatabase recibe ese valor", async () => {
    process.env.HARNESS_DB_PATH = "/var/lib/arnes/harness.db";
    await import("./main.js");
    expect(dbPathCapturado).toBe("/var/lib/arnes/harness.db");
  });

  it.each(["", "   "])("HARNESS_DB_PATH=%j equivale a ausente ⇒ default", async (valor) => {
    process.env.HARNESS_DB_PATH = valor;
    await import("./main.js");
    expect(dbPathCapturado).toBe("data/harness.db");
  });
});

/**
 * CANDADOS (`modo-headless-cierre-limpio`, tarea 3.2) — nacen VERDES: hoy
 * (antes de la tarea 3.6) no hay ninguna rama headless en `main.ts`, así que
 * estos tests no prueban una regresión que ya exista, sino que fijan una
 * garantía de NO-FUGA que la tarea 3.6 debe seguir cumpliendo. Su valor real
 * se demuestra por MUTACIÓN, con evidencia en `docs/progreso/` (tarea 3.8).
 * `npm test`/`npm run typecheck` quedan verdes al crearlos.
 */
describe("main.ts -- candados de no-fuga de listeners, finally intacto y cero funciones extraidas (modo-headless-cierre-limpio, tarea 3.2)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): ver el comentario del
    // primer `beforeEach` de este archivo.
    process.env.HARNESS_HEADLESS = "0";
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

  const EVENTOS_DE_PROCESO = ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const;

  function contarListenersReales(): Record<(typeof EVENTOS_DE_PROCESO)[number], number> {
    const conteos = {} as Record<(typeof EVENTOS_DE_PROCESO)[number], number>;
    for (const evento of EVENTOS_DE_PROCESO) {
      conteos[evento] = process.listenerCount(evento);
    }
    return conteos;
  }

  it("(a, R18/H5) importar main.js seis veces en TUI, sobre el process REAL, no acumula listeners -- incluido un import suspendido", async () => {
    const antes = contarListenersReales();

    for (let vez = 0; vez < 6; vez += 1) {
      vi.resetModules();

      if (vez < 5) {
        await import("./main.js");
      } else {
        // Import SUSPENDIDO a propósito (mismo patrón que `getCreateConsultas`
        // más arriba en este archivo, `:319` de la nota del módulo): se
        // resuelve una promesa controlada por este test en vez de dejar que
        // `waitUntilExit()` resuelva sola, para cubrir también el camino
        // "importación en vuelo" antes de cerrar la base.
        const { startTui } = await import("./adapters/tui/start-tui.js");
        const startTuiMock = vi.mocked(startTui);
        const llamadasPrevias = startTuiMock.mock.calls.length;
        let resolverSalida: () => void = () => {};
        const salidaPendiente = new Promise<void>((resolve) => {
          resolverSalida = resolve;
        });
        startTuiMock.mockImplementationOnce(() => ({
          unmount: () => {},
          waitUntilExit: () => salidaPendiente,
        }));

        void import("./main.js");

        const MAX_INTENTOS = 5000;
        for (
          let intento = 0;
          intento < MAX_INTENTOS && startTuiMock.mock.calls.length === llamadasPrevias;
          intento += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }

        expect(contarListenersReales()).toEqual(antes);

        resolverSalida();
        // Deja que la importación suspendida termine de cerrar su base antes
        // de que el test siguiente reciclee el entorno.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(contarListenersReales()).toEqual(antes);
    }
  });

  it("(b, R4) el finally queda intacto: los cuatro close() en el orden del ADR 10", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const tramo = bloqueEntre(source, "} finally {", "\n}\n");
    // Sin líneas de comentario: el propio `finally` menciona los cuatro
    // `close()` DENTRO de un comentario narrativo antes de invocarlos de
    // verdad (p. ej. "`web.close()` corre PRIMERO... y de `db.close()`"), lo
    // que adelantaría un `indexOf` falso si no se descartan esas líneas.
    const tramoSinComentarios = tramo
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("//"))
      .join("\n");

    const indiceWeb = tramoSinComentarios.indexOf("web.close()");
    const indiceWebhook = tramoSinComentarios.indexOf("webhook.close()");
    const indiceA2a = tramoSinComentarios.indexOf("a2aServidor.close()");
    const indiceDb = tramoSinComentarios.indexOf("db.close()");

    expect(indiceWeb).toBeGreaterThanOrEqual(0);
    expect(indiceWebhook).toBeGreaterThan(indiceWeb);
    expect(indiceA2a).toBeGreaterThan(indiceWebhook);
    expect(indiceDb).toBeGreaterThan(indiceA2a);
  });

  it("(c) no se extraen funciones nuevas desde el bloque final del composition root hasta el final del archivo", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    // Ancla re-`Grep`eada (design/tasks citaban `"const a2aEntrante"`, sin
    // verificar contra el árbol -- Contradicción residual #9 de `tasks.md`;
    // en este árbol SÍ existe): es la última constante del wiring de A2A
    // entrante, justo antes del bloque final `try`/`finally`.
    const desde = source.indexOf("const a2aEntrante");
    expect(desde).toBeGreaterThanOrEqual(0);

    const tramoConComentarios = source.slice(desde);
    // Descartar toda línea que empiece con `//` ANTES de buscar: si no, un
    // doc-comment nuevo que mencione la palabra "function" o "shutdown" daría
    // un falso rojo (corrección (d) de `tasks.md`).
    const sinComentarios = tramoConComentarios
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("//"))
      .join("\n");

    expect(sinComentarios).not.toMatch(/\bfunction\s+\w+/);
    expect(sinComentarios).not.toContain("const shutdown");
  });

  it("(d, H7) ningún test de main construye una señal real contra el proceso del runner", () => {
    const directorioDeEsteArchivo = new URL(".", import.meta.url);
    const archivosMain = readdirSync(directorioDeEsteArchivo).filter((nombre) => /^main.*\.test\.ts$/.test(nombre));
    expect(archivosMain.length).toBeGreaterThan(0);

    // Construidos por concatenación a propósito: si se escribieran como
    // literales, este mismo test se encontraría a sí mismo (Contradicción
    // residual #6 de `tasks.md`).
    const patronesProhibidos = [
      "process." + "kill(process.pid",
      "process." + 'emit("SIG',
      "process." + 'emit("unhandledRejection',
    ];

    for (const nombre of archivosMain) {
      const contenido = readFileSync(new URL(nombre, directorioDeEsteArchivo), "utf8");
      for (const patron of patronesProhibidos) {
        expect(contenido).not.toContain(patron);
      }
    }
  });
});

/**
 * Obtiene, ANTES de disparar `import("./main.js")`, la referencia mockeada
 * de `buildOnA2AEntrante` -- mismo orden que ya usa `getCreateConsultas`
 * más arriba en este archivo, y por el mismo motivo: pedir el módulo
 * DESPUÉS de disparar `import("./main.js")` hace que ese `import()` del
 * test compita con el `import` estático que `main.js` ya está resolviendo
 * para el MISMO especificador, y la carrera puede no resolver nunca dentro
 * del árbol de módulos de vite-node (verificado: así colgaba el test hasta
 * el timeout de Vitest). Pedirlo antes evita la carrera por completo. Función
 * de MÓDULO (no de un `describe` puntual) porque las tareas 3.3, 3.4 y 3.5 la
 * comparten.
 */
async function obtenerMockA2AEntrante(): Promise<
  ReturnType<typeof vi.mocked<typeof import("./build-on-a2a-entrante.js").buildOnA2AEntrante>>
> {
  const { buildOnA2AEntrante } = await import("./build-on-a2a-entrante.js");
  return vi.mocked(buildOnA2AEntrante);
}

/**
 * Deja avanzar el import hasta JUSTO ANTES del bloque final `try` (headless
 * o TUI): `buildOnA2AEntrante` es la última pieza de wiring que corre antes
 * de ese bloque (`main.ts`), así que esperar su primera llamada es una señal
 * determinística de "ya estamos ahí" -- a diferencia de un `setTimeout` de
 * duración fija, que resultó NO ser confiable acá: el arranque real
 * (`bootstrapHarness`, wiring de webhooks/web/A2A) puede tardar más que una
 * espera corta arbitraria, dando un falso verde tanto en TUI como en
 * headless.
 */
async function esperarWiringA2AEntrante(
  a2aEntranteMock: Awaited<ReturnType<typeof obtenerMockA2AEntrante>>,
): Promise<void> {
  const MAX_INTENTOS = 5000;
  for (let intento = 0; intento < MAX_INTENTOS && a2aEntranteMock.mock.calls.length === 0; intento += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (a2aEntranteMock.mock.calls.length === 0) {
    throw new Error("test setup error: buildOnA2AEntrante nunca fue invocado dentro del margen de espera");
  }
  // Un turno extra de microtareas/`setTimeout` para que, en el camino
  // headless, `esperarSenalDeCierre()` ya haya registrado sus 4 listeners
  // (ese registro ocurre en la sentencia siguiente a `buildOnA2AEntrante`).
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * ROJO (de aserción) — `modo-headless-cierre-limpio`, tarea 3.3: arranque
 * headless y TUI (H1, H2, H5-iii, H10, test 14). Todavía NO hay rama
 * headless en `main.ts` (llega en la tarea 3.6): (i)-(iv) deben FALLAR a
 * propósito; (v) ya pasa hoy, por ser el camino vigente de la TUI (se
 * declara así en el commit).
 *
 * Todos los tests que activan `HARNESS_HEADLESS=1` dejan el import
 * "en vuelo" (`main.js` sin `await`) y lo cierran al final emitiendo
 * `SIGTERM` sobre `procesoFalsoParaTest` -- incluso hoy, en ROJO, que ese
 * `emitir` sea un no-op (todavía no hay listeners que atender) -- para no
 * dejar un `:memory:` ni una promesa colgada entre tests.
 */
describe("main.ts -- arranque headless y TUI (modo-headless-cierre-limpio, tarea 3.3)", () => {
  const original: Record<string, string | undefined> = {};
  let stdinIsTTYPrevio: boolean | undefined;
  let stdoutIsTTYPrevio: boolean | undefined;

  const EVENTOS_DE_PROCESO = ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const;
  const SIN_CAMBIO = { SIGTERM: 0, SIGINT: 0, unhandledRejection: 0, uncaughtException: 0 };

  /**
   * `NodeJS.ReadStream["isTTY"]`/`NodeJS.WriteStream["isTTY"]` están tipados
   * como `boolean` a secas (no `boolean | undefined`) aunque en runtime la
   * propiedad esté ausente fuera de una terminal real -- de ahí el cast.
   */
  function fijarTTY(flujo: NodeJS.ReadStream | NodeJS.WriteStream, valor: boolean | undefined): void {
    (flujo as unknown as { isTTY: boolean | undefined }).isTTY = valor;
  }

  function contarEmisor(): Record<(typeof EVENTOS_DE_PROCESO)[number], number> {
    const conteos = {} as Record<(typeof EVENTOS_DE_PROCESO)[number], number>;
    for (const evento of EVENTOS_DE_PROCESO) {
      conteos[evento] = procesoFalsoParaTest.contarListeners(evento);
    }
    return conteos;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    // `modo-headless-cierre-limpio`, tarea 3.1 (R26): ver el comentario del
    // primer `beforeEach` de este archivo.
    process.env.HARNESS_HEADLESS = "0";
    stdinIsTTYPrevio = process.stdin.isTTY;
    stdoutIsTTYPrevio = process.stdout.isTTY;
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    fijarTTY(process.stdin, stdinIsTTYPrevio);
    fijarTTY(process.stdout, stdoutIsTTYPrevio);
  });

  it("(H1, escenario 1) sin la variable: startTui 1 vez, EMISOR sin cambio, SALIR no invocada", async () => {
    const { startTui } = await import("./adapters/tui/start-tui.js");
    await import("./main.js");

    expect(vi.mocked(startTui)).toHaveBeenCalledTimes(1);
    expect(contarEmisor()).toEqual(SIN_CAMBIO);
    expect(salirEspiaParaTest).not.toHaveBeenCalled();
  });

  it("(H1, escenario 2) headless: startTui 0, la promesa de la importación no resuelve ni rechaza en 50 ms, SALIR no invocada", async () => {
    process.env.HARNESS_HEADLESS = "1";
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const startTuiMock = vi.mocked(startTui);
    const a2aEntranteMock = await obtenerMockA2AEntrante();

    let resuelta = false;
    let rechazada = false;
    const promesaImport = import("./main.js");
    void promesaImport.then(
      () => {
        resuelta = true;
      },
      () => {
        rechazada = true;
      },
    );

    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(startTuiMock).not.toHaveBeenCalled();
    expect(resuelta).toBe(false);
    expect(rechazada).toBe(false);
    expect(salirEspiaParaTest).not.toHaveBeenCalled();

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(H1, escenario 3) headless sin TTY (stdin/stdout.isTTY undefined): sin error de raw mode, startTui 0", async () => {
    process.env.HARNESS_HEADLESS = "1";
    fijarTTY(process.stdin, undefined);
    fijarTTY(process.stdout, undefined);
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const startTuiMock = vi.mocked(startTui);
    const a2aEntranteMock = await obtenerMockA2AEntrante();

    const promesaImport = import("./main.js");
    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(startTuiMock).not.toHaveBeenCalled();

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(H1, escenario 4) headless con TTY=true sigue siendo headless (no hay autodetección)", async () => {
    process.env.HARNESS_HEADLESS = "1";
    fijarTTY(process.stdin, true);
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const startTuiMock = vi.mocked(startTui);
    const a2aEntranteMock = await obtenerMockA2AEntrante();

    const promesaImport = import("./main.js");
    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(startTuiMock).not.toHaveBeenCalled();

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(H1, escenario 5) TUI sin variable y sin TTY invoca startTui igual (sin autodetección)", async () => {
    fijarTTY(process.stdin, undefined);
    const { startTui } = await import("./adapters/tui/start-tui.js");
    await import("./main.js");
    expect(vi.mocked(startTui)).toHaveBeenCalledTimes(1);
  });

  it("(H2) HARNESS_HEADLESS='1' exacto activa headless: startTui 0", async () => {
    process.env.HARNESS_HEADLESS = "1";
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const a2aEntranteMock = await obtenerMockA2AEntrante();

    const promesaImport = import("./main.js");
    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(vi.mocked(startTui)).not.toHaveBeenCalled();

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it.each(["", "   ", "0"] as const)(
    "(H2) HARNESS_HEADLESS=%j equivale a TUI: startTui 1 vez",
    async (valor) => {
      process.env.HARNESS_HEADLESS = valor;
      const { startTui } = await import("./adapters/tui/start-tui.js");
      await import("./main.js");
      expect(vi.mocked(startTui)).toHaveBeenCalledTimes(1);
    },
  );

  it("(H2) HARNESS_HEADLESS ausente equivale a TUI: startTui 1 vez", async () => {
    delete process.env.HARNESS_HEADLESS;
    const { startTui } = await import("./adapters/tui/start-tui.js");
    await import("./main.js");
    expect(vi.mocked(startTui)).toHaveBeenCalledTimes(1);
  });

  it.each(["true", "yes", "on", "2", "01", " 1", "1 "])(
    "(H2) HARNESS_HEADLESS=%j falla cerrado: la importación rechaza, el cierre completo corre, startTui 0, EMISOR sin cambio",
    async (valor) => {
      process.env.HARNESS_HEADLESS = valor;
      const { startTui } = await import("./adapters/tui/start-tui.js");

      let error: unknown;
      try {
        await import("./main.js");
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      const mensaje = (error as Error).message;
      expect(mensaje).toContain("HARNESS_HEADLESS");
      expect(mensaje).toContain(`"${valor}"`);
      expect(mensaje).toContain("0");
      expect(mensaje).toContain("1");

      expect(vi.mocked(startTui)).not.toHaveBeenCalled();
      expect(contarEmisor()).toEqual(SIN_CAMBIO);

      // El `finally` corrió igual (H3, orden del ADR 10): `db.close()` se
      // invocó sobre la base `:memory:` real, aunque `esModoHeadless()` haya
      // lanzado ANTES de llegar a `esperarSenalDeCierre()`.
      expect(dbCapturadoParaTest).toBeDefined();
      expect(() => dbCapturadoParaTest?.prepare("SELECT 1").get()).toThrow();
    },
  );

  it("(H5, escenario iii) headless: cada uno de los 4 conteos de EMISOR aumenta exactamente en 1", async () => {
    process.env.HARNESS_HEADLESS = "1";
    const a2aEntranteMock = await obtenerMockA2AEntrante();
    const promesaImport = import("./main.js");
    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(contarEmisor()).toEqual({ SIGTERM: 1, SIGINT: 1, unhandledRejection: 1, uncaughtException: 1 });

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(test 14) el tramo del try final headless contiene esModoHeadless, esperarSenalDeCierre, startTui y waitUntilExit", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const tramo = bloqueEntre(source, "\ntry {\n  if (esModoHeadless", "} finally {");
    expect(tramo).toContain("esModoHeadless()");
    expect(tramo).toContain("esperarSenalDeCierre()");
    expect(tramo).toContain("startTui(");
    expect(tramo).toContain("waitUntilExit()");
  });

  // ★ Desvío declarado (evidencia obtenida al correr esta tarea, no
  // supuesta): los dos escenarios de H10 sobre fallas del lado de la TUI
  // ("si `waitUntilExit()` rechaza..." y "si `startTui` lanza
  // sincrónicamente...") NO son verificables con esta técnica (`await
  // import("./main.js")` sobre el runner de vite-node/Vitest): un
  // `top-level await` que rechaza -- o una excepción síncrona que hace
  // rechazar la evaluación async implícita del módulo -- dentro de un
  // módulo SIN exports no propaga ese rechazo a través de la promesa que
  // devuelve `import()` en este entorno; se manifiesta como un "Unhandled
  // Rejection" a nivel de proceso en vez de un rechazo observable de esa
  // promesa (confirmado corriendo ambos escenarios: los dos producen el
  // mismo "Unhandled Rejection", no una aserción `rejects` observable). El
  // código de `main.ts` no cambia (es el camino de v3.16, sin tocar) y el
  // `finally` sigue corriendo igual en producción bajo Node ESM puro; es la
  // TÉCNICA de test la que no lo puede observar acá, no una regresión de
  // `modo-headless-cierre-limpio`. Se documentan y se omiten estas dos
  // aserciones puntuales de H10 en vez de introducir una `Unhandled
  // Rejection` real en la corrida de la suite -- el resto de H10 (TUI sin
  // regresión en el camino feliz) ya queda cubierto por el escenario 1 de
  // H1 más arriba.
});
