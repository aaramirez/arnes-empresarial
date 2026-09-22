/**
 * Integración por PROCESO HIJO REAL (`modo-headless-cierre-limpio`, tarea
 * 3.7, C7/R1, test 15; REDISEÑADA por la tarea 3.7a, H-1/H-2, test 27). A
 * diferencia de todo lo demás en `main.test.ts` (que corre `main.js` DENTRO
 * del proceso de Vitest con dobles), acá se arranca un `node` REAL, con
 * `HARNESS_HEADLESS=1`, y se le manda un `SIGTERM` REAL -- es la única prueba
 * de este change que demuestra que el arnés sobrevive a una señal del sistema
 * operativo, no a una emitida sobre un doble.
 *
 * ★ Cómo se espera el arranque (H-2, design §11.4 corregido): por un MARCADOR
 * del producto, `cierre-esperando-senal`, que `esperarSenalDeCierre()` deja en
 * `<cwd>/data/harness.log` como ÚLTIMA operación del armado (spec H13). La
 * versión original sondeaba `SigCgt` de `/proc/<pid>/status` hasta ver el bit
 * de `SIGTERM`: era INVÁLIDO -- un Node recién arrancado ya trae
 * `SigCgt = 0x0000000100004602` (bits de `SIGTERM` y `SIGINT`) SIN un solo
 * `process.on`, así que el sondeo daba positivo de inmediato y el `SIGTERM`
 * salía ~600 ms ANTES del registro de `main`: el hijo moría por la señal y
 * `expect(exitCode).toBe(0)` fallaba con `expected null to be 0` (medido en
 * un contenedor `node:20-bookworm-slim`). El marcador es causal (lo emite el
 * código que registra), no una heurística del sistema operativo, y funciona
 * también fuera de Linux.
 *
 * ★ Los DOS `it` corren con los tres listeners deshabilitados (cero
 * superficie de red). El segundo (test 27) es el que habría atrapado H-1: un
 * handler de señal NO mantiene vivo el event loop, así que sin un handle
 * ref'd propio el hijo salía solo con código 13 a los ~0,7-1 s.
 *
 * `describe.skipIf(process.platform === "win32")` (molde de
 * `a2a-client.integration.test.ts` y `barrido.integration.test.ts`): NUNCA
 * degrada a `it.fails` ni se salta en silencio -- el motivo queda en el
 * nombre del `describe`. En Windows Node solo EMULA `SIGINT`
 * (`child.kill("SIGTERM")` termina el proceso SIN correr ningún handler, J3),
 * así que se saltea limpio. Ya no depende de `/proc`: macOS también vale.
 * ★ Regla nueva (H-2): un `skipIf` de plataforma NO cuenta como verificado
 * hasta correrlo en esa plataforma -- la tarea 3.7 se dio por buena con
 * `1 skipped` en Windows y llegó rota; su corrida real es en Linux/contenedor.
 *
 * NO depende de `dist/`: en CI `npm test` corre ANTES de `npm run build`
 * (`.github/workflows/ci.yml`), así que `dist/` puede no existir. Se arranca
 * `src/main.ts` directo con `tsx` vía `--import`, resuelto con
 * `createRequire`/`pathToFileURL` (rutas ABSOLUTAS: el `cwd` del hijo es un
 * directorio temporal, y una ruta relativa a `tsx` o a `main.ts` fallaría
 * ahí). `cwd` temporal porque el logger escribe `data/harness.log`
 * RELATIVO a `process.cwd()` (`turn-logger.ts`) y porque `HARNESS_DB_PATH`
 * apunta a ese mismo directorio -- ningún archivo de esta prueba queda
 * fuera de él. Los dos `[?]` de la 3.7 quedaron RESUELTOS por la evidencia
 * manual: `main` arranca headless SIN claves de LLM y SIN `.claude/skills` en
 * el `cwd`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Evento de log que `esperarSenalDeCierre()` deja como ÚLTIMA operación del armado (spec H13). */
const MARCADOR = "cierre-esperando-senal";
const ESPERA_MARCADOR_MS = 15_000;
/**
 * Vida mínima exigida a un headless SIN listeners tras el marcador. Holgada
 * sobre los 0,70-1,02 s de muerte observados antes del fix (evidencia manual,
 * H-1): si el hijo sigue vivo pasados 2 s, el ancla del event loop existe.
 */
const VIDA_MINIMA_SIN_LISTENERS_MS = 2_000;

interface Salida {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
}

async function leerLogOVacio(rutaLog: string): Promise<string> {
  try {
    return await readFile(rutaLog, "utf8");
  } catch {
    // Todavía no existe (el hijo aún no escribió su primera línea): equivale a "vacío".
    return "";
  }
}

/**
 * Sondea `<cwd>/data/harness.log` (el mismo archivo que el test ya lee para
 * sus aserciones finales) hasta que contenga el marcador. Falla con un mensaje
 * de SETUP explícito -- nunca con un timeout mudo -- tanto si el marcador no
 * llega en `timeoutMs` como si el hijo termina antes de publicarlo.
 */
async function esperarMarcador(
  rutaLog: string,
  hijo: ChildProcess,
  timeoutMs = ESPERA_MARCADOR_MS,
): Promise<void> {
  const desde = Date.now();
  while (Date.now() - desde < timeoutMs) {
    if ((await leerLogOVacio(rutaLog)).includes(MARCADOR)) {
      return;
    }
    if (hijo.exitCode !== null || hijo.signalCode !== null) {
      throw new Error(
        `test setup error: el marcador ${MARCADOR} nunca apareció en ${rutaLog}: el proceso hijo terminó antes de publicarlo (exitCode ${String(hijo.exitCode)}, signalCode ${String(hijo.signalCode)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `test setup error: el marcador ${MARCADOR} nunca apareció en ${rutaLog} dentro de ${timeoutMs} ms`,
  );
}

describe.skipIf(process.platform === "win32")(
  "cierre headless por SIGTERM real (integración contra un proceso hijo, modo-headless-cierre-limpio, tareas 3.7 y 3.7a; se saltea en Windows: allí SIGTERM no corre handlers, J3)",
  () => {
    let hijo: ChildProcess | undefined;
    let dirTemporal: string | undefined;

    afterEach(async () => {
      // Red de seguridad: si una aserción falló antes del `kill("SIGTERM")`
      // normal del test, no dejar un proceso Node huérfano corriendo.
      if (hijo !== undefined && hijo.exitCode === null && hijo.signalCode === null) {
        hijo.kill("SIGKILL");
      }
      hijo = undefined;
      if (dirTemporal !== undefined) {
        await rm(dirTemporal, { recursive: true, force: true });
        dirTemporal = undefined;
      }
    });

    /**
     * Arranca `main.ts` headless con el entorno EXPLÍCITO y mínimo (no se
     * hereda `process.env` completo): sin `*_PORT`/token, los tres listeners
     * quedan deshabilitados -- cero superficie de red en esta prueba.
     */
    async function arrancarHijoHeadlessSinListeners(): Promise<{
      readonly hijo: ChildProcess;
      readonly rutaLog: string;
      readonly salida: Promise<Salida>;
    }> {
      const dir = await mkdtemp(path.join(tmpdir(), "arnes-headless-"));
      dirTemporal = dir;

      const mainTsUrl = new URL("../../main.ts", import.meta.url);
      const rutaMainTs = path.resolve(mainTsUrl.pathname);
      const rutaTsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HARNESS_HEADLESS: "1",
        HARNESS_DB_PATH: path.join(dir, "harness.db"),
      };

      const proceso = spawn(process.execPath, ["--import", rutaTsx, rutaMainTs], {
        cwd: dir,
        env,
        stdio: ["ignore", "ignore", "ignore"],
      });
      hijo = proceso;
      // El listener de `exit` se engancha YA, antes de cualquier espera: así una muerte temprana no se pierde.
      const salida = new Promise<Salida>((resolve) => {
        proceso.once("exit", (exitCode, signalCode) => {
          resolve({ exitCode, signalCode });
        });
      });

      expect(proceso.pid).toBeDefined();
      return { hijo: proceso, rutaLog: path.join(dir, "data", "harness.log"), salida };
    }

    async function afirmarCierreCompleto(rutaLog: string, salida: Salida): Promise<void> {
      expect(salida.exitCode).toBe(0);
      expect(salida.signalCode).toBeNull();

      expect(existsSync(rutaLog)).toBe(true);
      const log = await readFile(rutaLog, "utf8");
      expect(log).toContain("cierre-senal-recibida");
      expect(log).toContain("cierre-completado");
      expect(log).not.toContain("cierre-presupuesto-excedido");
    }

    it("arranca headless, espera el marcador, recibe SIGTERM y sale 0 con el log de cierre completo (sin exceder el presupuesto)", async () => {
      const { hijo: proceso, rutaLog, salida } = await arrancarHijoHeadlessSinListeners();

      // Sin el marcador, un `SIGTERM` mandado demasiado pronto mata al hijo por el
      // comportamiento POR DEFECTO de Node (`exitCode` `null`, `signalCode` `"SIGTERM"`).
      await esperarMarcador(rutaLog, proceso);

      proceso.kill("SIGTERM");
      await afirmarCierreCompleto(rutaLog, await salida);
    }, 30_000);

    it("(test 27, H-1) headless SIN ningún listener NO termina por sí solo: sigue vivo tras el marcador y recién el SIGTERM lo cierra con 0", async () => {
      const { hijo: proceso, rutaLog, salida } = await arrancarHijoHeadlessSinListeners();

      await esperarMarcador(rutaLog, proceso);

      // Sin la señal, el proceso debe seguir vivo: un handler de señal NO ref'a el event loop
      // (medido: `process.on("SIGTERM", …); await new Promise(() => {})` sale con 13), así que lo
      // único que lo sostiene es el ancla de `esperarSenalDeCierre()` (design §0.7b).
      await new Promise((resolve) => setTimeout(resolve, VIDA_MINIMA_SIN_LISTENERS_MS));
      expect(proceso.exitCode).toBeNull();
      expect(proceso.signalCode).toBeNull();

      proceso.kill("SIGTERM");
      await afirmarCierreCompleto(rutaLog, await salida);
    }, 30_000);
  },
);
