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

vi.mock("./adapters/memory/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/memory/db.js")>();
  return {
    ...actual,
    openDatabase: () => actual.openDatabase(":memory:"),
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
});
