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
const {
  procesoFalsoParaTest,
  salirEspiaParaTest,
  logEventEspiaParaTest,
  eventosDeProcesoParaTest,
  armarAnclaEspiaParaTest,
  desarmarAnclaEspiaParaTest,
  anclasArmadasParaTest,
} = vi.hoisted(
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
    // `modo-headless-cierre-limpio`, tarea 2.7a (H-1, design §0.7b): el ancla
    // del event loop TAMBIÉN se inyecta. Sin estos espías, un test de wiring
    // headless que no use reloj falso armaría un `setInterval` REAL de 60 s
    // sobre el proceso de Vitest -- la fuga que R18 existe para impedir. El
    // espía NO crea ningún timer: devuelve un handle-objeto y lo registra en
    // `anclasArmadasParaTest`; `desarmarAncla` lo saca. "Ninguna ancla armada"
    // = el conjunto vacío.
    const anclasArmadasParaTest = new Set<unknown>();
    let contadorDeAnclas = 0;
    const armarAnclaEspiaParaTest = vi.fn((): unknown => {
      contadorDeAnclas += 1;
      const handle = { ancla: contadorDeAnclas };
      anclasArmadasParaTest.add(handle);
      return handle;
    });
    const desarmarAnclaEspiaParaTest = vi.fn((handle: unknown): void => {
      anclasArmadasParaTest.delete(handle);
    });
    return {
      procesoFalsoParaTest,
      salirEspiaParaTest: vi.fn((_codigo: number): void => {}),
      logEventEspiaParaTest,
      eventosDeProcesoParaTest,
      armarAnclaEspiaParaTest,
      desarmarAnclaEspiaParaTest,
      anclasArmadasParaTest,
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
        armarAncla: armarAnclaEspiaParaTest,
        desarmarAncla: desarmarAnclaEspiaParaTest,
        ...deps,
      }),
    finalizarCierreHeadless: (deps?: Parameters<typeof real.finalizarCierreHeadless>[0]) =>
      real.finalizarCierreHeadless({
        proceso: procesoFalsoParaTest,
        salir: salirEspiaParaTest,
        logEvent: logEventEspiaParaTest,
        armarAncla: armarAnclaEspiaParaTest,
        desarmarAncla: desarmarAnclaEspiaParaTest,
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
  "OPS_PORT",
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
    // `salud-operativa`, tarea 3.3 (R46): FIJADA, no solo borrada. Mismo
    // motivo que `HARNESS_HEADLESS` arriba -- `dotenv` (vía
    // `core/config/env.js`) rellena desde `.env` una variable que solo se
    // borró, y cada `import("./main.js")` lo re-ejecuta. Sin esto, un
    // `OPS_PORT` ambiental abriría un puerto real de `ops` en cada
    // reimportación de este archivo.
    process.env.OPS_PORT = "0";
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
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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

/**
 * ROJO (de aserción) — `modo-headless-cierre-limpio`, tarea 3.4: cierre por
 * señal y fallas no capturadas (H3, H4, H6, H8). Todavía NO hay rama
 * headless en `main.ts` (llega en la 3.6): el `await` de headless nunca
 * espera la señal hoy, así que TODOS estos tests deben FALLAR a propósito
 * (típicamente por timeout de la espera interna, ver aceptación de la
 * tarea).
 *
 * Los tres servidores se mockean por MÓDULO (arriba, cerca del tope del
 * archivo) para poder controlar `close()` sin abrir sockets reales.
 * `logEvent` está espiado (también arriba) en vez de dejar correr
 * `logTurnEvent` real, para afirmar sobre los eventos `cierre-*` sin tocar
 * `data/harness.log`.
 */
/** Doble de adaptador con `close()` controlable a mano por el test (resolver/rechazar cuándo quiera). Función de MÓDULO: la comparten las tareas 3.4 y 3.5. */
function crearCierreControlable(): {
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly resolver: () => void;
  readonly rechazar: (error: Error) => void;
} {
  let resolver: () => void = () => {};
  let rechazar: (error: Error) => void = () => {};
  const promesa = new Promise<void>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  const close = vi.fn<() => Promise<void>>(() => promesa);
  return { close, resolver, rechazar };
}

/** Configura los `startXServer` mockeados por módulo para devolver, UNA vez, el doble indicado (o ninguno, si se omite -- adaptador deshabilitado). */
async function configurarAdaptadores(config: {
  readonly web?: { readonly close: () => Promise<void> };
  readonly webhook?: { readonly close: () => Promise<void> };
  readonly a2a?: { readonly close: () => Promise<void> };
}): Promise<void> {
  const { startWebServer } = await import("./adapters/web/index.js");
  const { startWebhookServer } = await import("./adapters/webhooks/index.js");
  const { startA2AServer } = await import("./adapters/a2a/server-index.js");
  if (config.web !== undefined) {
    vi.mocked(startWebServer).mockResolvedValueOnce(
      config.web as unknown as Awaited<ReturnType<typeof startWebServer>>,
    );
  }
  if (config.webhook !== undefined) {
    vi.mocked(startWebhookServer).mockResolvedValueOnce(
      config.webhook as unknown as Awaited<ReturnType<typeof startWebhookServer>>,
    );
  }
  if (config.a2a !== undefined) {
    vi.mocked(startA2AServer).mockResolvedValueOnce(
      config.a2a as unknown as Awaited<ReturnType<typeof startA2AServer>>,
    );
  }
}

/** Sondeo genérico -- más robusto que un `setTimeout` de duración fija (ver la nota de `esperarWiringA2AEntrante` de arriba). */
async function esperarHasta(condicion: () => boolean, maxIntentosMs = 2000): Promise<void> {
  for (let intento = 0; intento < maxIntentosMs && !condicion(); intento += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (!condicion()) {
    throw new Error("test setup error: la condicion nunca se cumplio dentro del margen de espera");
  }
}

/**
 * Dispara `import("./main.js")` y lo deja avanzar hasta justo antes del
 * `try` final (mismo criterio que el describe de la tarea 3.3). Envuelta
 * en un objeto -- no devuelta directa -- porque una función `async` que
 * `return`a una `Promise` la aplana automáticamente (semántica de
 * `thenable`): `Promise<Promise<T>>` colapsa en runtime a `Promise<T>`, así
 * que `await dispararImport()` daría el VALOR resuelto, no la promesa en
 * vuelo que estos tests necesitan seguir controlando.
 */
async function dispararImport(): Promise<{ readonly promesaImport: Promise<unknown> }> {
  const a2aEntranteMock = await obtenerMockA2AEntrante();
  const promesaImport = import("./main.js");
  await esperarWiringA2AEntrante(a2aEntranteMock);
  return { promesaImport };
}

function obtenerDbOLanzar(): Database.Database {
  if (dbCapturadoParaTest === undefined) {
    throw new Error("test setup error: openDatabase no fue capturado");
  }
  return dbCapturadoParaTest;
}

describe("main.ts -- cierre por señal y fallas no capturadas (modo-headless-cierre-limpio, tarea 3.4)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    // Todo este describe corre en headless: es la única rama que registra
    // señales (H5).
    process.env.HARNESS_HEADLESS = "1";
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    vi.useRealTimers();
  });

  it("(H3) SIGTERM: orden estricto y secuencial web -> webhook -> a2a -> db, SALIR 0 después de db.close", async () => {
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    const a2a = crearCierreControlable();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");

    procesoFalsoParaTest.emitir("SIGTERM");

    await esperarHasta(() => web.close.mock.calls.length === 1);
    expect(webhook.close).not.toHaveBeenCalled();
    expect(a2a.close).not.toHaveBeenCalled();
    expect(dbCloseSpy).not.toHaveBeenCalled();

    web.resolver();
    await esperarHasta(() => webhook.close.mock.calls.length === 1);
    expect(a2a.close).not.toHaveBeenCalled();
    expect(dbCloseSpy).not.toHaveBeenCalled();

    webhook.resolver();
    await esperarHasta(() => a2a.close.mock.calls.length === 1);
    expect(dbCloseSpy).not.toHaveBeenCalled();

    a2a.resolver();
    await promesaImport.catch(() => {});

    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(H3) SIGINT produce la misma secuencia que SIGTERM", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    procesoFalsoParaTest.emitir("SIGINT");
    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(H3) adaptadores deshabilitados se saltean: solo web habilitado ⇒ solo web.close corre; ninguno ⇒ solo db.close", async () => {
    const web = crearCierreControlable();
    web.resolver();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");
    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(H3) un close() que rechaza no impide llegar a db.close(): se reporta y sigue", async () => {
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    procesoFalsoParaTest.emitir("SIGTERM");
    await esperarHasta(() => web.close.mock.calls.length === 1);
    web.rechazar(new Error("boom"));
    await promesaImport.catch(() => {});

    expect(
      stderrSpy.mock.calls.some((llamada) => String(llamada[0]).includes("No se pudo cerrar el servidor web: boom")),
    ).toBe(true);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);

    stderrSpy.mockRestore();
  });

  it("(H3) db.close() que lanza se reporta sin propagarse, SALIR 0 igual", async () => {
    const web = crearCierreControlable();
    web.resolver();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(obtenerDbOLanzar(), "close").mockImplementation(() => {
      throw new Error("locked");
    });

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});

    expect(
      stderrSpy.mock.calls.some((llamada) =>
        String(llamada[0]).includes("No se pudo cerrar la base de datos: locked"),
      ),
    ).toBe(true);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);

    stderrSpy.mockRestore();
  });

  it("(H4) dos SIGTERM durante el drenaje: una sola secuencia de cierre, 1 evento cierre-senal-repetida, no acorta la espera", async () => {
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();

    procesoFalsoParaTest.emitir("SIGTERM");
    await esperarHasta(() => web.close.mock.calls.length === 1);
    procesoFalsoParaTest.emitir("SIGTERM");
    await Promise.resolve();

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).not.toHaveBeenCalled();
    expect(eventosDeProcesoParaTest.filter((e) => e.event === "cierre-senal-repetida")).toHaveLength(1);

    web.resolver();
    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(H4) SIGINT seguido de SIGTERM produce un solo cierre", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    procesoFalsoParaTest.emitir("SIGINT");
    await esperarHasta(() => web.close.mock.calls.length === 1);
    procesoFalsoParaTest.emitir("SIGTERM");
    await Promise.resolve();

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(eventosDeProcesoParaTest.filter((e) => e.event === "cierre-senal-repetida")).toHaveLength(1);

    web.resolver();
    await promesaImport.catch(() => {});
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(H4) una señal tardía, con el cierre ya completado, no lanza ni repite el cierre", async () => {
    const web = crearCierreControlable();
    web.resolver();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledTimes(1);

    expect(() => procesoFalsoParaTest.emitir("SIGTERM")).not.toThrow();
    expect(web.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unhandledRejection", "boom"],
    ["uncaughtException", "kaput"],
  ] as const)(
    "(H6) %s no capturado: 1 evento proceso-error-no-capturado, SALIR 1, cero close()",
    async (tipo, mensaje) => {
      // Los tres se resuelven de una: el criterio POST-3.6 es que una falla
      // no capturada ANTES de cualquier señal deja el `await
      // esperarSenalDeCierre()` colgado para siempre (nunca resuelve, salvo
      // por una señal real) -- así que este `import()` queda deliberadamente
      // "en vuelo" sin awaitearse al final (`manejarErrorNoCapturado` es
      // síncrona, las aserciones no lo necesitan). Resolverlos de entrada
      // evita además que la corrida ROJA de hoy (TUI incondicional, sin
      // gate) cuelgue esperando un `close()` que nunca resuelve.
      const web = crearCierreControlable();
      web.resolver();
      const webhook = crearCierreControlable();
      webhook.resolver();
      const a2a = crearCierreControlable();
      a2a.resolver();
      await configurarAdaptadores({ web, webhook, a2a });

      await dispararImport();
      procesoFalsoParaTest.emitir(tipo, new Error(mensaje));

      const fallas = eventosDeProcesoParaTest.filter((e) => e.event === "proceso-error-no-capturado");
      expect(fallas).toHaveLength(1);
      expect(fallas[0]?.fields).toMatchObject({ tipo });
      expect(String(fallas[0]?.fields.message)).toContain(mensaje);
      expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
      expect(web.close).not.toHaveBeenCalled();
      expect(webhook.close).not.toHaveBeenCalled();
      expect(a2a.close).not.toHaveBeenCalled();
    },
  );

  it("(H6) una falla no capturada durante el drenaje de una señal previa: SALIR 1 y db.close 0 llamadas", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");

    procesoFalsoParaTest.emitir("SIGTERM");
    await esperarHasta(() => web.close.mock.calls.length === 1);
    procesoFalsoParaTest.emitir("unhandledRejection", new Error("boom"));

    expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
    expect(dbCloseSpy).not.toHaveBeenCalled();

    // Deja que el `web.close()` pendiente resuelva para no dejar el import
    // colgado entre tests (el watchdog no se armó -- nunca hubo señal de
    // cierre real, solo la falla no capturada).
    web.resolver();
    await promesaImport.catch(() => {});
  });

  it("(H7) una falla simulada no toca el process.exit real ni deja exitCode asignado", async () => {
    // Mismo motivo que el `it.each` de H6 de arriba: no se awaitea el
    // import al final (queda "en vuelo" a propósito, ver esa nota).
    const web = crearCierreControlable();
    web.resolver();
    await configurarAdaptadores({ web });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispararImport();
    procesoFalsoParaTest.emitir("unhandledRejection", new Error("boom"));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    exitSpy.mockRestore();
  });

  it("(H8) sin la variable, un cierre colgado vence a los 70000 ms: log + SALIR 1, db.close 0", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(69_999);
    expect(salirEspiaParaTest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(salirEspiaParaTest).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
    const excedidos = eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);
    expect(excedidos[0]?.fields).toMatchObject({ presupuestoMs: 70_000, senal: "SIGTERM" });

    vi.useRealTimers();
    web.resolver();
    await promesaImport.catch(() => {});
  });

  it("(H8) con HARNESS_SHUTDOWN_TIMEOUT_MS=20000, vence a los 20000 ms con presupuestoMs:20000", async () => {
    process.env.HARNESS_SHUTDOWN_TIMEOUT_MS = "20000";
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(19_999);
    expect(salirEspiaParaTest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
    const excedidos = eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);
    expect(excedidos[0]?.fields).toMatchObject({ presupuestoMs: 20_000 });

    vi.useRealTimers();
    web.resolver();
    await promesaImport.catch(() => {});
  });
});

/**
 * ROJO (de aserción) — `modo-headless-cierre-limpio`, tarea 3.5: R1, EL
 * CRITERIO QUE DEFINE EL HIJO (H9). Todavía NO hay rama headless en
 * `main.ts`: estos tests deben FALLAR a propósito.
 *
 * ★ Desvío declarado del texto de la tarea, necesario y documentado en el
 * commit: el turno irreversible NO se dispara a través de la pila HTTP real
 * (`POST /operaciones` -> `consultar_kpi` -> `ClienteA2APort.delegar`),
 * porque `startWebServer` está mockeado por MÓDULO en este archivo (tareas
 * 3.4/3.5, para controlar `close()` sin abrir un socket) -- no existe un
 * servidor real al que pegarle un request. En su lugar, el propio `close()`
 * del adaptador WEB hace de estand-in del "socket retenido por un turno en
 * vuelo" (exactamente la semántica que `design.md` §0.1 describe: el
 * `callback` de `server.close()` no llega hasta que el socket del turno
 * cierra) y, al resolver, ESCRIBE la fila de auditoría con
 * `insertAccionEmpleado` sobre la base `:memory:` REAL -- la misma función
 * que usa el composition root real y que el hallazgo 1/3 de
 * `consultas-negocio-a2a-entrante` ya ejercita en este mismo archivo. La
 * garantía verificada es la que este change agrega (el proceso no mata la
 * base antes de que la escritura en vuelo termine); la garantía de que
 * `consultar_kpi` específicamente llega a esa escritura ya la cubre
 * `src/test/integration/consulta-kpi-a2a-chat.integration.test.ts`, de otro
 * change, y no se re-deriva acá.
 */
describe("main.ts -- R1: turno irreversible en vuelo al recibir SIGTERM (modo-headless-cierre-limpio, tarea 3.5)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "1";
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    vi.useRealTimers();
  });

  function contarFilasRegistro(db: Database.Database): number {
    const fila = db.prepare("SELECT COUNT(*) AS total FROM registro_acciones_empleado").get() as {
      total: number;
    };
    return fila.total;
  }

  function escribirFilaDelTurno(db: Database.Database): void {
    insertAccionEmpleado(db, {
      id: "accion-turno-irreversible",
      empleadoId: "empleado-consulta-kpi",
      comando: "/consultar-kpi",
      resultado: "KPI: 42",
      ocurridoAt: new Date().toISOString(),
    });
  }

  it("(H9, escenario 1) el turno de 50 s deja su fila antes de db.close, con el default de 70000", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const db = obtenerDbOLanzar();
    const conteoPrevio = contarFilasRegistro(db);

    // `db.close()` se cierra de verdad (mejor-sqlite3 lanza al consultar una
    // conexión cerrada): el conteo hay que capturarlo EN el instante de la
    // llamada real a `close()`, no después de awaitear el import completo.
    let conteoAlCerrar: number | undefined;
    const closeOriginal = db.close.bind(db);
    const dbCloseSpy = vi.spyOn(db, "close").mockImplementation(() => {
      conteoAlCerrar = contarFilasRegistro(db);
      return closeOriginal();
    });

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    // El turno "completa" a t=50 000: el socket que retenía el turno se
    // libera y, en ese mismo instante, la fila de auditoría queda escrita
    // ANTES de que `web.close()` resuelva (mismo orden que un handler HTTP
    // real: primero el `INSERT`, después el `return`/cierre de la conexión).
    await vi.advanceTimersByTimeAsync(50_000);
    escribirFilaDelTurno(db);
    web.resolver();

    vi.useRealTimers();
    await promesaImport.catch(() => {});

    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(conteoAlCerrar).toBe(conteoPrevio + 1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
    expect(eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido")).toHaveLength(0);
  });

  it("(H9, escenario 2) el turno que nunca termina agota el presupuesto y lo registra: SALIR 1, db.close 0", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const db = obtenerDbOLanzar();
    const dbCloseSpy = vi.spyOn(db, "close");

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(70_000);

    expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
    expect(dbCloseSpy).not.toHaveBeenCalled();
    const excedidos = eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);

    vi.useRealTimers();
    web.resolver();
    await promesaImport.catch(() => {});
  });

  it("(H9, escenario 3) DEFAULT_SHUTDOWN_TIMEOUT_MS es estrictamente mayor que 55500 (peor caso de consultar_kpi)", async () => {
    const { DEFAULT_SHUTDOWN_TIMEOUT_MS } = await import("./proceso-cierre.js");
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(55_500);
  });

  it("(H9, escenario 4) con el presupuesto bajado a 15000, el mismo turno de 50 s pierde la fila y queda registrado", async () => {
    process.env.HARNESS_SHUTDOWN_TIMEOUT_MS = "15000";
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    const db = obtenerDbOLanzar();
    const conteoPrevio = contarFilasRegistro(db);

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(15_000);

    expect(salirEspiaParaTest).toHaveBeenCalledWith(1);
    const excedidos = eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);
    expect(excedidos[0]?.fields).toMatchObject({ presupuestoMs: 15_000 });
    // El turno de 50 s no llegó a completar dentro de los 15 s: la fila NO existe.
    expect(contarFilasRegistro(db)).toBe(conteoPrevio);

    vi.useRealTimers();
    // El turno "completa" tarde (a los 50 s reales del negocio, ya sin
    // efecto sobre el proceso, que ya salió) -- se resuelve solo para no
    // dejar la promesa de `web.close()` colgada entre tests.
    web.resolver();
    await promesaImport.catch(() => {});
  });
});

/**
 * ROJO (de tipo + aserción) -- `modo-headless-cierre-limpio`, tarea 2.7a
 * (H-1/H-2, design §0.7b y §8, spec H1 ampliado + H13). `armarAncla`/
 * `desarmarAncla` todavía NO existen en `ProcesoCierreDeps` (el `vi.mock` del
 * tope ya los inyecta: eso es lo que hace fallar el typecheck), así que este
 * `it` falla a propósito hasta la 2.7b. Va AL FINAL del archivo, lejos de las
 * anclas de `bloqueEntre`.
 */
describe("main.ts -- ancla del event loop en el wiring headless (modo-headless-cierre-limpio, tarea 2.7a)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    anclasArmadasParaTest.clear();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "1";
    // `salud-operativa`, tarea 3.3: ver el comentario del primer `beforeEach`
    // de este archivo.
    process.env.OPS_PORT = "0";
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

  it("(test 25, wiring) tras un cierre headless completo, desarmarAncla recibió el handle de armarAncla, no queda ningún ancla armada y el marcador salió una vez", async () => {
    const web = crearCierreControlable();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();

    // Mientras espera la señal hay EXACTAMENTE un ancla armada y el marcador ya salió (H13).
    expect(armarAnclaEspiaParaTest).toHaveBeenCalledTimes(1);
    expect(anclasArmadasParaTest.size).toBe(1);
    const marcadores = eventosDeProcesoParaTest.filter((e) => e.event === "cierre-esperando-senal");
    expect(marcadores).toHaveLength(1);
    expect(marcadores[0]?.fields).toMatchObject({ presupuestoMs: 70_000 });

    procesoFalsoParaTest.emitir("SIGTERM");
    web.resolver();
    await promesaImport.catch(() => {});

    const handleDelAncla = armarAnclaEspiaParaTest.mock.results[0]?.value;
    expect(handleDelAncla).toBeDefined();
    expect(desarmarAnclaEspiaParaTest).toHaveBeenCalledWith(handleDelAncla);
    expect(anclasArmadasParaTest.size).toBe(0);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });
});

/**
 * `salud-operativa`, tarea 3.4: mismo criterio que los `vi.mock` de
 * `web`/`webhook`/`a2a` de arriba (mockeado por MÓDULO, no por variable de
 * entorno) -- Vitest hoistea un `vi.mock` sin importar dónde se declara
 * textualmente en el archivo, así que esta declaración funciona igual que si
 * viviera junto a las otras tres (arriba, cerca del tope del archivo) sin
 * necesidad de tocar ese bloque: el diff de este change es únicamente una
 * adición al final. `startOpsServer` se envuelve con `vi.fn(actual)`, no se
 * reemplaza (mismo molde que `buildOnComandoEmpleado`/
 * `buildOnOperacionesEmpleado`/`buildOnA2AEntrante`): sin `mockResolvedValueOnce`/
 * `mockRejectedValueOnce` explícito, corre la implementación REAL (config
 * real, `ops-deshabilitado` real si `OPS_PORT="0"`), lo que permite que los
 * tests "sin OPS_PORT" (tarea 3.6) observen el comportamiento genuino del
 * adaptador sin necesitar un segundo mecanismo de mock.
 */
vi.mock("./adapters/ops/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/ops/index.js")>();
  return { ...actual, startOpsServer: vi.fn(actual.startOpsServer) };
});

/**
 * `salud-operativa`, tarea 3.4: `logTurnEvent` NUNCA se mockeó por módulo en
 * este archivo (a diferencia de `web`/`webhook`/`a2a`, los eventos de ciclo
 * de vida de `ops` -- `ops-arranque-fallido` en particular -- se emiten
 * DIRECTO desde `main.ts` vía la importación estática de
 * `./core/logging/turn-logger.js`, no a través del `logEvent` inyectado en
 * `proceso-cierre.js` (ese solo cubre los eventos `cierre-*`). Se envuelve
 * con `vi.fn(actual)`, igual que arriba: la implementación REAL sigue
 * corriendo (best-effort, nunca lanza -- ver el module doc de
 * `turn-logger.ts`), solo se agrega la capacidad de espiar sus llamadas.
 */
vi.mock("./core/logging/turn-logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/logging/turn-logger.js")>();
  return { ...actual, logTurnEvent: vi.fn(actual.logTurnEvent) };
});

/**
 * Doble de `OpsAdapter` con `close()` controlable a mano (molde
 * `crearCierreControlable`, que ya cubre `webhook`/`web`/`a2a`): agrega
 * `port` porque `OpsAdapter` lo requiere.
 */
function crearOpsControlable(): {
  readonly port: number;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly resolver: () => void;
  readonly rechazar: (error: Error) => void;
} {
  const controlable = crearCierreControlable();
  return { port: 8788, ...controlable };
}

/** Configura el `startOpsServer` mockeado por módulo para devolver, UNA vez, el doble indicado (o dejarlo correr REAL, si se omite). */
async function configurarOps(config?: { readonly port: number; readonly close: () => Promise<void> }): Promise<void> {
  const { startOpsServer } = await import("./adapters/ops/index.js");
  if (config !== undefined) {
    vi.mocked(startOpsServer).mockResolvedValueOnce(
      config as unknown as Awaited<ReturnType<typeof startOpsServer>>,
    );
  }
}

/**
 * ROJO (de aserción) -- `salud-operativa`, tarea 3.4: arranque de `ops`
 * DESPUÉS de los otros tres (S10) y su cierre entre `a2aServidor.close()` y
 * `db.close()` (H3' NUEVO 1-3, S11). Todavía NO hay wiring de `ops` en
 * `main.ts` (llega en la tarea 3.5): `startOpsServer` nunca se invoca, así
 * que TODOS los tests de invocación/orden deben FALLAR a propósito.
 */
describe("main.ts -- arranque y cierre del listener ops, camino headless (salud-operativa, tarea 3.4)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    // Este describe corre en headless -- mismo criterio que "cierre por
    // señal y fallas no capturadas" más arriba.
    process.env.HARNESS_HEADLESS = "1";
    process.env.OPS_PORT = "0";
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    vi.useRealTimers();
  });

  it("(i, S10) startOpsServer se invoca 1 vez y DESPUÉS que web/webhook/a2a; un rechazo con EADDRINUSE no aborta el arranque", async () => {
    const { startWebServer } = await import("./adapters/web/index.js");
    const { startWebhookServer } = await import("./adapters/webhooks/index.js");
    const { startA2AServer } = await import("./adapters/a2a/server-index.js");
    const { startOpsServer } = await import("./adapters/ops/index.js");
    const { logTurnEvent } = await import("./core/logging/turn-logger.js");
    const { OPS_LOG_CORRELATION_ID } = await import("./adapters/ops/config.js");
    const error = new Error("listen EADDRINUSE: address already in use :::8788");
    vi.mocked(startOpsServer).mockRejectedValueOnce(error);

    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});

    expect(vi.mocked(startOpsServer)).toHaveBeenCalledTimes(1);
    const ordenWeb = vi.mocked(startWebServer).mock.invocationCallOrder[0] as number;
    const ordenWebhook = vi.mocked(startWebhookServer).mock.invocationCallOrder[0] as number;
    const ordenA2a = vi.mocked(startA2AServer).mock.invocationCallOrder[0] as number;
    const ordenOps = vi.mocked(startOpsServer).mock.invocationCallOrder[0] as number;
    expect(ordenOps).toBeGreaterThan(ordenWeb);
    expect(ordenOps).toBeGreaterThan(ordenWebhook);
    expect(ordenOps).toBeGreaterThan(ordenA2a);

    const fallidos = vi.mocked(logTurnEvent).mock.calls.filter((llamada) => llamada[1] === "ops-arranque-fallido");
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]?.[0]).toBe(OPS_LOG_CORRELATION_ID);
    expect(String((fallidos[0]?.[2] as { message?: unknown } | undefined)?.message)).toContain("EADDRINUSE");
    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(ii, H3' NUEVO 1/S11) orden exacto web -> webhook -> a2a -> ops -> db, una vez cada uno, SALIR 0 tras db.close", async () => {
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    const a2a = crearCierreControlable();
    const ops = crearOpsControlable();
    await configurarAdaptadores({ web, webhook, a2a });
    await configurarOps(ops);

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");

    procesoFalsoParaTest.emitir("SIGTERM");

    await esperarHasta(() => web.close.mock.calls.length === 1);
    expect(webhook.close).not.toHaveBeenCalled();
    web.resolver();

    await esperarHasta(() => webhook.close.mock.calls.length === 1);
    expect(a2a.close).not.toHaveBeenCalled();
    webhook.resolver();

    await esperarHasta(() => a2a.close.mock.calls.length === 1);
    expect(ops.close).not.toHaveBeenCalled();
    a2a.resolver();

    await esperarHasta(() => ops.close.mock.calls.length === 1);
    expect(dbCloseSpy).not.toHaveBeenCalled();
    ops.resolver();

    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(ops.close).toHaveBeenCalledTimes(1);
    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
  });

  it("(iii, H3' NUEVO 3) un ops.close() que rechaza no impide db.close(): se reporta y sigue, SALIR 0", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    const ops = crearOpsControlable();
    await configurarAdaptadores({ web, webhook, a2a });
    await configurarOps(ops);

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    procesoFalsoParaTest.emitir("SIGTERM");
    await esperarHasta(() => ops.close.mock.calls.length === 1);
    ops.rechazar(new Error("boom"));
    await promesaImport.catch(() => {});

    expect(
      stderrSpy.mock.calls.some((llamada) =>
        String(llamada[0]).includes("No se pudo cerrar el listener de salud: boom"),
      ),
    ).toBe(true);
    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);

    stderrSpy.mockRestore();
  });

  it("(iv, S8+H8) un ops.close() colgado (servidor real inyectado cuyo close() nunca vuelve) se fuerza a los 5000 ms sin agotar el techo global de 70000 ms: SALIR 0, sin cierre-presupuesto-excedido", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { startServer: startOpsServerReal } = await import("./adapters/ops/server.js");
    const { resolveOpsConfig } = await import("./adapters/ops/config.js");
    const { startOpsServer } = await import("./adapters/ops/index.js");
    const opsLogEvent = vi.fn();
    const fakeHttpServer = {
      listen: vi.fn((...args: unknown[]) => {
        (args[args.length - 1] as () => void)();
      }),
      close: vi.fn(() => {
        // El callback de `server.close()` NUNCA se invoca a propósito -- es
        // lo único que puede colgar en `ops` (§0.4 del design, S8).
      }),
      on: vi.fn(),
      closeIdleConnections: vi.fn(),
    };
    const opsHandle = await startOpsServerReal(
      {
        config: resolveOpsConfig({ OPS_PORT: "8788" }),
        salud: { estaCerrando: () => false, baseUtilizable: () => true, listenersCaidos: () => 0 },
        logEvent: opsLogEvent,
      },
      (() => fakeHttpServer) as unknown as Parameters<typeof startOpsServerReal>[1],
    );
    vi.mocked(startOpsServer).mockResolvedValueOnce({ port: opsHandle.port, close: () => opsHandle.close() });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");

    vi.useFakeTimers();
    procesoFalsoParaTest.emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(dbCloseSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await promesaImport.catch(() => {});

    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    expect(salirEspiaParaTest).toHaveBeenCalledWith(0);
    expect(opsLogEvent.mock.calls.some((llamada) => llamada[1] === "ops-cierre-forzado")).toBe(true);
    expect(eventosDeProcesoParaTest.filter((e) => e.event === "cierre-presupuesto-excedido")).toHaveLength(0);
  });
});

describe("main.ts -- cierre del listener ops en TUI (salud-operativa, tarea 3.4)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "0";
    process.env.OPS_PORT = "0";
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

  it("(iv, S11) en TUI el orden es el mismo con waitUntilExit() resuelto y SALIR 0 llamadas; durante el drenaje ops.close tiene 0 llamadas", async () => {
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    const ops = crearOpsControlable();
    ops.resolver();
    await configurarAdaptadores({ web, webhook, a2a });
    await configurarOps(ops);

    let resolverSalidaTui: () => void = () => {};
    const salidaTuiPromise = new Promise<void>((resolve) => {
      resolverSalidaTui = resolve;
    });
    vi.mocked(startTui).mockImplementationOnce(() => ({
      unmount: () => {},
      waitUntilExit: () => salidaTuiPromise,
    }));

    const a2aEntranteMock = await obtenerMockA2AEntrante();
    const promesaImport = import("./main.js");
    await esperarWiringA2AEntrante(a2aEntranteMock);

    expect(ops.close).not.toHaveBeenCalled();
    resolverSalidaTui();

    await esperarHasta(() => web.close.mock.calls.length === 1);
    expect(ops.close).not.toHaveBeenCalled();
    web.resolver();

    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(ops.close).toHaveBeenCalledTimes(1);
    // TUI no pasa por `esperarSenalDeCierre`/`finalizarCierreHeadless`: `salir` nunca se invoca (H2).
    expect(salirEspiaParaTest).not.toHaveBeenCalled();
  });
});

/**
 * Test mecánico sobre el FUENTE de `main.ts` (S12) -- no importa `./main.js`,
 * mismo criterio que la "segunda instancia del adaptador A2A" de arriba: el
 * tramo del `finally`, SIN comentarios, referencia los cinco `close()` en un
 * `indexOf` estrictamente creciente.
 */
describe("main.ts -- orden mecánico del finally con opsServidor.close incluido (salud-operativa, tarea 3.4)", () => {
  it("(v, S12) web.close, webhook.close, a2aServidor.close, opsServidor.close y db.close en ese orden estrictamente creciente", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const tramo = bloqueEntre(source, "} finally {", "\n}\n");
    const tramoSinComentarios = tramo
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("//"))
      .join("\n");

    const indiceWeb = tramoSinComentarios.indexOf("web.close()");
    const indiceWebhook = tramoSinComentarios.indexOf("webhook.close()");
    const indiceA2a = tramoSinComentarios.indexOf("a2aServidor.close()");
    const indiceOps = tramoSinComentarios.indexOf("opsServidor.close()");
    const indiceDb = tramoSinComentarios.indexOf("db.close()");

    expect(indiceWeb).toBeGreaterThanOrEqual(0);
    expect(indiceWebhook).toBeGreaterThan(indiceWeb);
    expect(indiceA2a).toBeGreaterThan(indiceWebhook);
    expect(indiceOps).toBeGreaterThan(indiceA2a);
    expect(indiceDb).toBeGreaterThan(indiceOps);
  });
});

/**
 * `salud-operativa`, tarea 3.6: `vi.spyOn` directo sobre el namespace de un
 * módulo integrado de Node (`node:http`) no funciona en ESM ("Module
 * namespace is not configurable", verificado) -- a diferencia de los módulos
 * propios del repo, que sí lo permiten (mismo motivo que el `vi.mock` de
 * `turn-logger.js` de arriba). Se mockea (hoisteado, igual que los de
 * arriba) envolviendo `createServer` con `vi.fn(actual)`: sigue siendo el
 * `createServer` REAL para cualquier caller, solo se agrega espionaje.
 */
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});

/**
 * CANDADO (nace VERDE) -- `salud-operativa`, tarea 3.6. Se declara: pasa
 * desde que existe la guarda del `finally` (tarea 3.5); su valor es de
 * NO-REGRESIÓN (S12/S13) y se prueba por MUTACIÓN en la tarea 3.8 (M1
 * elimina la guarda `if (opsServidor !== undefined)`, M2 extrae el bloque de
 * arranque a una función). `npm test`/`npm run typecheck` quedan verdes al
 * crearlo.
 */
describe("main.ts -- candado: orden de cierre de hoy sin OPS_PORT y cero funciones extraídas del finally (salud-operativa, tarea 3.6)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "1";
    process.env.OPS_PORT = "0";
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

  it("(a, S12) sin OPS_PORT: orden exacto web.close, webhook.close, a2a.close, db.close; startOpsServer devuelve undefined y ops.close 0 llamadas", async () => {
    const { startOpsServer } = await import("./adapters/ops/index.js");
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    const dbCloseSpy = vi.spyOn(obtenerDbOLanzar(), "close");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    procesoFalsoParaTest.emitir("SIGTERM");

    await esperarHasta(() => web.close.mock.calls.length === 1);
    expect(webhook.close).not.toHaveBeenCalled();
    web.resolver();

    await promesaImport.catch(() => {});

    expect(web.close).toHaveBeenCalledTimes(1);
    expect(webhook.close).toHaveBeenCalledTimes(1);
    expect(a2a.close).toHaveBeenCalledTimes(1);
    expect(dbCloseSpy).toHaveBeenCalledTimes(1);
    const resultado = vi.mocked(startOpsServer).mock.results[0];
    expect(resultado?.type).toBe("return");
    await expect(resultado?.value as Promise<unknown>).resolves.toBeUndefined();
    // M1 (tarea 3.8): sin `OPS_PORT`, `opsServidor` es `undefined` -- el
    // `finally` NUNCA debe intentar `opsServidor.close()` (la guarda `if
    // (opsServidor !== undefined)` existe para eso). Si esa guarda se
    // quitara, `opsServidor.close()` lanzaría sobre `undefined` y el
    // `catch` de al lado lo reportaría con este mensaje -- es la señal
    // observable de la mutación.
    expect(
      stderrSpy.mock.calls.some((llamada) =>
        String(llamada[0]).includes("No se pudo cerrar el listener de salud"),
      ),
    ).toBe(false);

    stderrSpy.mockRestore();
  });

  it("(b, S9) createServer de ops (node:http) espía ⇒ 0 llamadas; entre los eventos con correlación ops-adapter (S-e: OPS_PORT='0' fijada también emite ops-puerto-invalido) está ops-deshabilitado", async () => {
    const http = await import("node:http");
    const { OPS_LOG_CORRELATION_ID } = await import("./adapters/ops/config.js");
    const { logTurnEvent } = await import("./core/logging/turn-logger.js");
    const createServerMock = vi.mocked(http.createServer);
    const web = crearCierreControlable();
    web.resolver();
    await configurarAdaptadores({ web });

    const { promesaImport } = await dispararImport();
    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});

    expect(createServerMock).not.toHaveBeenCalled();
    // S-e (`tasks.md`, "Supuestos pendientes" #8): `OPS_PORT="0"` es un valor
    // CRUDO presente y no en blanco -- `resolveOpsConfig` lo trata como
    // "vino y no sirvió" (fiel al diseño, RD-130 `design.md` §7.1), así que
    // ESTE `beforeEach` (tarea 3.3, que fija `OPS_PORT="0"` en vez de
    // borrarla) emite un segundo evento, `ops-puerto-invalido{raw:"0"}`,
    // ADEMÁS de `ops-deshabilitado`. El único evento con correlación
    // `ops-adapter` que NO se explica por esa señal ruidosa y documentada
    // sigue siendo `ops-deshabilitado`.
    const eventosOps = vi
      .mocked(logTurnEvent)
      .mock.calls.filter((llamada) => llamada[0] === OPS_LOG_CORRELATION_ID);
    expect(eventosOps).toHaveLength(2);
    expect(eventosOps.map((llamada) => llamada[1])).toEqual(["ops-puerto-invalido", "ops-deshabilitado"]);
    expect(eventosOps[0]?.[2]).toEqual({ raw: "0" });
  });

  it("(c, R4) el tramo del finally, sin comentarios, no contiene ninguna declaración de función nueva", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const tramo = bloqueEntre(source, "} finally {", "\n}\n");
    const tramoSinComentarios = tramo
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("//"))
      .join("\n");

    expect(tramoSinComentarios).not.toMatch(/\bfunction\s+\w+/);
  });

  it("(d, S13) con OPS_PORT='8788' ambiental antes de la guarda de la tarea 3.3, cada importación la sobreescribe: real listen 0 llamadas y cada una registra ops-deshabilitado", { timeout: 15_000 }, async () => {
    const http = await import("node:http");
    const { OPS_LOG_CORRELATION_ID } = await import("./adapters/ops/config.js");
    const { logTurnEvent } = await import("./core/logging/turn-logger.js");
    const createServerMock = vi.mocked(http.createServer);

    for (let vez = 0; vez < 3; vez += 1) {
      // Simula un `OPS_PORT` que ya estaba presente en el entorno (p. ej. un
      // `.env` real de desarrollo con la sugerencia comentada de `design.md`
      // §7.1 vuelta activa) ANTES de que corra la guarda de la tarea 3.3 --
      // la misma guarda que el `beforeEach` de este archivo ya aplica en
      // cada test, reproducida acá explícitamente para dejar constancia de
      // que sobrevive a "cada importación", no solo a la primera. NO se
      // limpia el historial de mocks entre rondas (a propósito, sin
      // `vi.clearAllMocks()`): la aserción de abajo necesita los TRES eventos
      // `ops-deshabilitado` acumulados, uno por ronda.
      process.env.OPS_PORT = "8788";
      delete process.env.OPS_PORT;
      process.env.OPS_PORT = "0";

      vi.resetModules();
      procesoFalsoParaTest.limpiar();
      // `vi.mock`'s factory result (y el `vi.fn(actual)` de
      // `buildOnA2AEntrante`) persiste entre `resetModules()` -- mismo
      // comentario que el primer `beforeEach` de este archivo. Sin este
      // `mockClear()` puntual, `esperarWiringA2AEntrante` (dentro de
      // `dispararImport`) vería el conteo de la ronda ANTERIOR ya `> 0` y
      // avanzaría antes de que esta ronda wireara de verdad, dejando el
      // `SIGTERM` de abajo sin listener que lo atienda (import colgado).
      (await obtenerMockA2AEntrante()).mockClear();

      const web = crearCierreControlable();
      web.resolver();
      await configurarAdaptadores({ web });

      const { promesaImport } = await dispararImport();
      procesoFalsoParaTest.emitir("SIGTERM");
      await promesaImport.catch(() => {});
    }

    expect(createServerMock).not.toHaveBeenCalled();
    const eventosDeshabilitado = vi
      .mocked(logTurnEvent)
      .mock.calls.filter(
        (llamada) => llamada[0] === OPS_LOG_CORRELATION_ID && llamada[1] === "ops-deshabilitado",
      );
    expect(eventosDeshabilitado).toHaveLength(3);
  });
});

/**
 * ★★ ROJO (de ASERCIÓN) — `salud-operativa`, tarea 4.7 (S16-S19, criterio
 * O6). Todavía NO hay wiring de los tres hechos reales en `main.ts` (llega
 * en la tarea 4.8): `startOpsServer` sigue recibiendo el STUB INERTE de la
 * tarea 3.5 (`estaCerrando: () => false, baseUtilizable: () => true,
 * listenersCaidos: () => 0`), así que TODOS los tests de este bloque deben
 * FALLAR a propósito.
 *
 * Estrategia (equivalente a "GET /salud/listo", sin reabrir la plomería
 * HTTP que 4.3 ya cubre exhaustivamente): se captura `deps.salud` con el
 * que `main.ts` invocó el `startOpsServer` mockeado (molde `reembolsosPort`,
 * S16) y se alimenta DIRECTO a `evaluarReadiness` (ADR 258, ya unitario en
 * 4.1) — es EXACTAMENTE lo que `server.ts` hace internamente al atender
 * `GET /salud/listo` (4.4, ya unitario en 4.3). Lo que este bloque verifica
 * es el WIRING (que `deps.salud` refleje el estado real de `main.ts`), no
 * el ruteo HTTP, que ya tiene su propia cobertura.
 */
describe("main.ts -- los tres hechos de readiness inyectados en deps.salud (salud-operativa, tarea 4.7, S16-S19, O6)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "1";
    process.env.OPS_PORT = "0";
  });

  afterEach(() => {
    for (const key of ENV_KEYS_A_LIMPIAR) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    vi.useRealTimers();
  });

  /** El `deps.salud` con el que `main.ts` invocó `startOpsServer`, capturado por ÍNDICE de llamada (molde `reembolsosPort`, S16). */
  async function capturarSaludDeOps(indice = 0): Promise<{
    readonly estaCerrando: () => boolean;
    readonly baseUtilizable: () => boolean;
    readonly listenersCaidos: () => number;
  }> {
    const { startOpsServer } = await import("./adapters/ops/index.js");
    const llamada = vi.mocked(startOpsServer).mock.calls[indice];
    if (llamada === undefined) {
      throw new Error("test setup error: startOpsServer no fue invocado");
    }
    return (
      llamada[0] as {
        salud: { estaCerrando: () => boolean; baseUtilizable: () => boolean; listenersCaidos: () => number };
      }
    ).salud;
  }

  /** Evalúa `evaluarReadiness` sobre el `salud` capturado — mismo cálculo que `responderListo` de `server.ts` (4.4). */
  async function evaluarListoDesde(salud: {
    estaCerrando: () => boolean;
    baseUtilizable: () => boolean;
    listenersCaidos: () => number;
  }): Promise<{ statusCode: number; cuerpo: string }> {
    const { evaluarReadiness } = await import("./adapters/ops/readiness.js");
    const motivo = evaluarReadiness({
      cerrando: salud.estaCerrando(),
      baseUtilizable: salud.baseUtilizable(),
      listenersCaidos: salud.listenersCaidos(),
    });
    return { statusCode: motivo === undefined ? 200 : 503, cuerpo: motivo ?? "listo" };
  }

  it("(i, S16) deps.salud tiene EXACTAMENTE estaCerrando, baseUtilizable y listenersCaidos, las tres funciones; listenersCaidos() es number", async () => {
    const { startWebServer } = await import("./adapters/web/index.js");
    vi.mocked(startWebServer).mockRejectedValueOnce(new Error("EADDRINUSE"));
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ webhook, a2a });

    const { promesaImport } = await dispararImport();
    const salud = await capturarSaludDeOps();

    expect(Object.keys(salud).sort()).toEqual(["baseUtilizable", "estaCerrando", "listenersCaidos"]);
    expect(salud.estaCerrando).toBeTypeOf("function");
    expect(salud.baseUtilizable).toBeTypeOf("function");
    expect(salud.listenersCaidos).toBeTypeOf("function");
    expect(salud.listenersCaidos()).toBe(1);
    expect(salud.listenersCaidos()).toBeTypeOf("number");

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("★★ (ii, S17, O6) 200 antes de la señal; 503 cerrando en el MISMO tick de SIGTERM sin await ni avanzar el reloj; persiste a 50000ms y tras una 2.ª señal", async () => {
    const web = crearCierreControlable();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    const salud = await capturarSaludDeOps();

    vi.useFakeTimers();

    expect(salud.estaCerrando()).toBe(false);
    const antes = await evaluarListoDesde(salud);
    expect(antes.statusCode).toBe(200);

    procesoFalsoParaTest.emitir("SIGTERM");
    // ★★ SIN `await`, SIN avanzar el reloj entre la señal y esta lectura:
    // O6 exige que el 503 exista DESDE el instante de la señal, no desde que
    // el primer `close()` resuelve.
    expect(salud.estaCerrando()).toBe(true);

    await vi.advanceTimersByTimeAsync(50_000);
    const tras50s = await evaluarListoDesde(salud);
    expect(tras50s.statusCode).toBe(503);
    expect(tras50s.cuerpo).toBe("cerrando");

    procesoFalsoParaTest.emitir("SIGTERM"); // 2.ª señal: idempotente (H4)
    const trasSegunda = await evaluarListoDesde(salud);
    expect(trasSegunda.statusCode).toBe(503);
    expect(trasSegunda.cuerpo).toBe("cerrando");

    web.resolver();
    await promesaImport.catch(() => {});
  });

  describe.each([
    ["web", async () => (await import("./adapters/web/index.js")).startWebServer, "web-arranque-fallido"] as const,
    [
      "webhook",
      async () => (await import("./adapters/webhooks/index.js")).startWebhookServer,
      "webhook-arranque-fallido",
    ] as const,
    [
      "a2a",
      async () => (await import("./adapters/a2a/server-index.js")).startA2AServer,
      "a2a-servidor-arranque-fallido",
    ] as const,
  ])("(iii, S18, R35) listener %s habilitado y caído vs. deshabilitado", (_nombre, obtenerStart, eventoFallido) => {
    it(`lanza al arrancar ⇒ listenersCaidos()=1, 503 listener, y existe ${eventoFallido}`, async () => {
      const startFn = await obtenerStart();
      vi.mocked(startFn).mockRejectedValueOnce(new Error("EADDRINUSE"));

      const { promesaImport } = await dispararImport();
      const salud = await capturarSaludDeOps();

      expect(salud.listenersCaidos()).toBe(1);
      const resultado = await evaluarListoDesde(salud);
      expect(resultado.statusCode).toBe(503);
      expect(resultado.cuerpo).toBe("listener");

      const { logTurnEvent } = await import("./core/logging/turn-logger.js");
      const fallidos = vi.mocked(logTurnEvent).mock.calls.filter((llamada) => llamada[1] === eventoFallido);
      expect(fallidos).toHaveLength(1);

      procesoFalsoParaTest.emitir("SIGTERM");
      await promesaImport.catch(() => {});
    });

    it("devuelve undefined SIN lanzar (deshabilitado a propósito) ⇒ listenersCaidos()=0, 200 listo", async () => {
      // Los tres `startXServer` quedan en su default (`vi.fn()` sin
      // `mockResolvedValueOnce`, molde ya establecido en este archivo):
      // `await undefined` resuelve sin lanzar, igual que un gate cerrado.
      const { promesaImport } = await dispararImport();
      const salud = await capturarSaludDeOps();

      expect(salud.listenersCaidos()).toBe(0);
      const resultado = await evaluarListoDesde(salud);
      expect(resultado.statusCode).toBe(200);

      procesoFalsoParaTest.emitir("SIGTERM");
      await promesaImport.catch(() => {});
    });
  });

  it("(iii, S18) los tres deshabilitados a la vez ⇒ nace 200 listo", async () => {
    const { promesaImport } = await dispararImport();
    const salud = await capturarSaludDeOps();

    expect(salud.listenersCaidos()).toBe(0);
    const resultado = await evaluarListoDesde(salud);
    expect(resultado.statusCode).toBe(200);

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(iii, S18) dos caídos (web y a2a) suman: listenersCaidos()=2", async () => {
    const { startWebServer } = await import("./adapters/web/index.js");
    const { startA2AServer } = await import("./adapters/a2a/server-index.js");
    vi.mocked(startWebServer).mockRejectedValueOnce(new Error("EADDRINUSE"));
    vi.mocked(startA2AServer).mockRejectedValueOnce(new Error("EADDRINUSE"));
    const webhook = crearCierreControlable();
    webhook.resolver();
    await configurarAdaptadores({ webhook });

    const { promesaImport } = await dispararImport();
    const salud = await capturarSaludDeOps();

    expect(salud.listenersCaidos()).toBe(2);

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(iii, S18) la caída de ops mismo NO suma a listenersCaidos", async () => {
    const { startOpsServer } = await import("./adapters/ops/index.js");
    vi.mocked(startOpsServer).mockRejectedValueOnce(new Error("EADDRINUSE"));
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { promesaImport } = await dispararImport();
    const salud = await capturarSaludDeOps();

    // `startOpsServer` rechazó, pero `deps.salud` ya se había construido
    // ANTES de esa llamada (design.md §7.3, punto 5): los tres listeners de
    // negocio arrancaron bien, así que el conteo sigue en 0 pese a la
    // caída de `ops`.
    expect(salud.listenersCaidos()).toBe(0);

    const { logTurnEvent } = await import("./core/logging/turn-logger.js");
    const { OPS_LOG_CORRELATION_ID } = await import("./adapters/ops/config.js");
    const fallidos = vi.mocked(logTurnEvent).mock.calls.filter((llamada) => llamada[1] === "ops-arranque-fallido");
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]?.[0]).toBe(OPS_LOG_CORRELATION_ID);

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });

  it("(iv, S19) db.prepare se invoca 1 vez con el SQL de la sonda; baseUtilizable() ⇒ true las 3 veces", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { default: DatabaseCtor } = await import("better-sqlite3");
    const prepareSpy = vi.spyOn(
      DatabaseCtor.prototype as unknown as { prepare: (sql: string) => unknown },
      "prepare",
    );

    try {
      const { promesaImport } = await dispararImport();
      const salud = await capturarSaludDeOps();

      const llamadasSonda = prepareSpy.mock.calls.filter(
        (llamada) => llamada[0] === "SELECT 1 FROM sqlite_schema LIMIT 1",
      );
      expect(llamadasSonda).toHaveLength(1);

      expect(salud.baseUtilizable()).toBe(true);
      expect(salud.baseUtilizable()).toBe(true);
      expect(salud.baseUtilizable()).toBe(true);
      // `baseUtilizable()` ejecuta `get()` sobre la sentencia YA preparada:
      // `db.prepare` para la sonda sigue en 1 sola llamada.
      expect(
        prepareSpy.mock.calls.filter((llamada) => llamada[0] === "SELECT 1 FROM sqlite_schema LIMIT 1"),
      ).toHaveLength(1);

      procesoFalsoParaTest.emitir("SIGTERM");
      await promesaImport.catch(() => {});
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("(iv, S19) get() que lanza Error('locked') ⇒ baseUtilizable() false SIN propagar, y 503 base", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { default: DatabaseCtor } = await import("better-sqlite3");
    const prototipo = DatabaseCtor.prototype as unknown as {
      prepare: (sql: string, ...resto: unknown[]) => { get: (...args: unknown[]) => unknown };
    };
    const prepareOriginal = prototipo.prepare;
    const prepareSpy = vi.spyOn(prototipo, "prepare").mockImplementation(function (
      this: unknown,
      sql: string,
      ...resto: unknown[]
    ) {
      const statement = prepareOriginal.apply(this, [sql, ...resto]);
      if (sql === "SELECT 1 FROM sqlite_schema LIMIT 1") {
        vi.spyOn(statement, "get").mockImplementation(() => {
          throw new Error("locked");
        });
      }
      return statement;
    });

    try {
      const { promesaImport } = await dispararImport();
      const salud = await capturarSaludDeOps();

      expect(() => salud.baseUtilizable()).not.toThrow();
      expect(salud.baseUtilizable()).toBe(false);
      const resultado = await evaluarListoDesde(salud);
      expect(resultado.statusCode).toBe(503);
      expect(resultado.cuerpo).toBe("base");

      procesoFalsoParaTest.emitir("SIGTERM");
      await promesaImport.catch(() => {});
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("(iv, S19) db.prepare que LANZA Error('closed') al arrancar ⇒ 1 ops-arranque-fallido{message⊇closed}; la importación no rechaza; startOpsServer 0 llamadas", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { default: DatabaseCtor } = await import("better-sqlite3");
    const prototipo = DatabaseCtor.prototype as unknown as {
      prepare: (sql: string, ...resto: unknown[]) => unknown;
    };
    const prepareOriginal = prototipo.prepare;
    const prepareSpy = vi.spyOn(prototipo, "prepare").mockImplementation(function (
      this: unknown,
      sql: string,
      ...resto: unknown[]
    ) {
      if (sql === "SELECT 1 FROM sqlite_schema LIMIT 1") {
        throw new Error("closed");
      }
      return prepareOriginal.apply(this, [sql, ...resto]);
    });

    try {
      const { startOpsServer } = await import("./adapters/ops/index.js");
      const { logTurnEvent } = await import("./core/logging/turn-logger.js");
      const { OPS_LOG_CORRELATION_ID } = await import("./adapters/ops/config.js");

      const { promesaImport } = await dispararImport();

      procesoFalsoParaTest.emitir("SIGTERM");
      await expect(promesaImport).resolves.not.toThrow();

      expect(vi.mocked(startOpsServer)).not.toHaveBeenCalled();
      const fallidos = vi
        .mocked(logTurnEvent)
        .mock.calls.filter((llamada) => llamada[1] === "ops-arranque-fallido");
      expect(fallidos).toHaveLength(1);
      expect(fallidos[0]?.[0]).toBe(OPS_LOG_CORRELATION_ID);
      expect(String((fallidos[0]?.[2] as { message?: unknown } | undefined)?.message)).toContain("closed");
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("(v, test 21) en TUI, main.ts NUNCA invoca esperarSenalDeCierre: cero listeners de señal en todo el ciclo de vida", async () => {
    // ★ Nota de diseño de este test (deviation declarada en el reporte de
    // 4.7/4.8): NO se lee `salud.estaCerrando()` directo acá. `proceso-cierre.js`
    // REAL queda capturado UNA sola vez por el `vi.mock` de este archivo
    // (comentario del segundo `beforeEach`, arriba) y su `faseDeCierre`
    // SOBREVIVE a `vi.resetModules()` entre tests: en HEADLESS eso se
    // "autosana" porque cada test vuelve a llamar `esperarSenalDeCierre()`
    // (su primera sentencia resetea a `"esperando"`), pero TUI NUNCA la
    // llama, así que un test headless anterior de ESTE MISMO archivo puede
    // dejar `estaCerrando()` en `true` sin que el wiring de TUI de ESTE test
    // haya hecho nada -- no es un observable confiable a nivel de wiring. El
    // valor `false` de `estaCerrando()` en modo TUI YA está probado, sin
    // esta fuga, en `proceso-cierre.test.ts` (tarea 4.5, "false en modo TUI
    // ... y en un montaje headless recién creado"). Acá se verifica el
    // observable que SÍ es leak-proof: que el wiring de `main.ts` en modo
    // TUI nunca registra un solo listener de señal (`esperarSenalDeCierre`
    // nunca corre) -- que es, precisamente, la RAZÓN por la que
    // `estaCerrando()` se mantiene falsa en TUI (design.md §6.5).
    process.env.HARNESS_HEADLESS = "0";
    const { startTui } = await import("./adapters/tui/start-tui.js");
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    let resolverSalidaTui: () => void = () => {};
    const salidaTuiPromise = new Promise<void>((resolve) => {
      resolverSalidaTui = resolve;
    });
    vi.mocked(startTui).mockImplementationOnce(() => ({
      unmount: () => {},
      waitUntilExit: () => salidaTuiPromise,
    }));

    const { promesaImport } = await dispararImport();
    await capturarSaludDeOps();

    for (const evento of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const) {
      expect(procesoFalsoParaTest.contarListeners(evento)).toBe(0);
    }

    resolverSalidaTui();
    await promesaImport.catch(() => {});

    for (const evento of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const) {
      expect(procesoFalsoParaTest.contarListeners(evento)).toBe(0);
    }
  });
});

/**
 * ★ CANDADO (nace VERDE) — `salud-operativa`, tarea 4.9, S19. Se declara:
 * verifica sobre una base `:memory:` REAL (no un doble) lo que los
 * unitarios de 4.7 ya dirigieron -- su valor es de NO-REGRESIÓN (red de
 * seguridad del orden ADR 10: la sonda no debe lanzar ni aunque `db.close()`
 * ya haya corrido) y se prueba por MUTACIÓN M5 en la tarea 4.10
 * (`mutaciones-slice-d.md`). `npm test` queda verde al crearlo.
 */
describe("main.ts -- candado: baseUtilizable() sobre una base :memory: REAL, sana y tras db.close() (salud-operativa, tarea 4.9, S19)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    procesoFalsoParaTest.limpiar();
    eventosDeProcesoParaTest.length = 0;
    dbCapturadoParaTest = undefined;
    for (const key of ENV_KEYS_A_LIMPIAR) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HARNESS_HEADLESS = "1";
    process.env.OPS_PORT = "0";
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

  it("base :memory: real con esquema aplicado ⇒ baseUtilizable() true; tras db.close() ⇒ false SIN lanzar", async () => {
    const web = crearCierreControlable();
    web.resolver();
    const webhook = crearCierreControlable();
    webhook.resolver();
    const a2a = crearCierreControlable();
    a2a.resolver();
    await configurarAdaptadores({ web, webhook, a2a });

    const { startOpsServer } = await import("./adapters/ops/index.js");
    const { promesaImport } = await dispararImport();

    const llamada = vi.mocked(startOpsServer).mock.calls[0];
    if (llamada === undefined) {
      throw new Error("test setup error: startOpsServer no fue invocado");
    }
    const salud = (llamada[0] as { salud: { baseUtilizable: () => boolean } }).salud;

    expect(salud.baseUtilizable()).toBe(true);

    // Cierra la base REAL a mano, ANTES de la señal -- red de seguridad del
    // orden ADR 10: la sonda ya preparada NUNCA debe lanzar, ni siquiera
    // sobre un handle cerrado por otra vía.
    obtenerDbOLanzar().close();
    expect(() => salud.baseUtilizable()).not.toThrow();
    expect(salud.baseUtilizable()).toBe(false);

    procesoFalsoParaTest.emitir("SIGTERM");
    await promesaImport.catch(() => {});
  });
});
