/**
 * Integración por PROCESO HIJO REAL (`modo-headless-cierre-limpio`, tarea
 * 3.7, C7/R1, test 15). A diferencia de todo lo demás en `main.test.ts`
 * (que corre `main.js` DENTRO del proceso de Vitest con dobles), acá se
 * arranca un `node` REAL, con `HARNESS_HEADLESS=1`, y se le manda un
 * `SIGTERM` REAL -- es la única prueba de este change que demuestra que el
 * arnés sobrevive a una señal del sistema operativo, no a una emitida sobre
 * un doble.
 *
 * `describe.skipIf` (molde de `a2a-client.integration.test.ts` y
 * `barrido.integration.test.ts`, ya vigente en este repo): NUNCA degrada a
 * `it.fails` ni se salta en silencio -- el motivo queda en el nombre del
 * `describe`. Solo corre en Linux: el sondeo de `/proc/<pid>/status` es
 * Linux-only (CI es `ubuntu-latest`); en Windows (este entorno de
 * desarrollo) Node solo EMULA `SIGINT`, no `SIGTERM` (J3, `[?]`), así que
 * la prueba se saltea limpio en vez de fallar por una limitación de la
 * plataforma, no del código.
 *
 * NO depende de `dist/`: en CI `npm test` corre ANTES de `npm run build`
 * (`.github/workflows/ci.yml`), así que `dist/` puede no existir. Se arranca
 * `src/main.ts` directo con `tsx` vía `--import`, resuelto con
 * `createRequire`/`pathToFileURL` (rutas ABSOLUTAS: el `cwd` del hijo es un
 * directorio temporal, y una ruta relativa a `tsx` o a `main.ts` fallaría
 * ahí). `cwd` temporal porque el logger escribe `data/harness.log`
 * RELATIVO a `process.cwd()` (`turn-logger.ts`) y porque `HARNESS_DB_PATH`
 * apunta a ese mismo directorio -- ningún archivo de esta prueba queda
 * fuera de él.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Bit de `SIGTERM` (señal 15, bit 14) en la máscara hexadecimal de `SigCgt` de `/proc/<pid>/status` (`man 5 proc`). */
const BIT_SIGTERM = 1n << 14n;

async function señalCapturada(pid: number): Promise<boolean> {
  try {
    const contenido = await readFile(`/proc/${pid}/status`, "utf8");
    const linea = contenido.split("\n").find((l) => l.startsWith("SigCgt:"));
    if (linea === undefined) {
      return false;
    }
    const hex = linea.split(/\s+/)[1] ?? "0";
    const mascara = BigInt(`0x${hex}`);
    return (mascara & BIT_SIGTERM) !== 0n;
  } catch {
    // El proceso puede haber muerto (p. ej. si arrancar falló) o
    // `/proc/<pid>` puede no existir todavía -- ambos casos son "todavía no".
    return false;
  }
}

async function esperarHastaQueRegistreSigterm(pid: number, timeoutMs = 15_000): Promise<void> {
  const desde = Date.now();
  while (Date.now() - desde < timeoutMs) {
    if (await señalCapturada(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `test setup error: el proceso hijo (pid ${pid}) nunca registró un handler de SIGTERM dentro de ${timeoutMs} ms`,
  );
}

describe.skipIf(process.platform !== "linux")(
  "cierre headless por SIGTERM real (integración contra un proceso hijo, modo-headless-cierre-limpio, tarea 3.7)",
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

    it("arranca headless, recibe SIGTERM y sale 0 con el log de cierre completo (sin exceder el presupuesto)", async () => {
      dirTemporal = await mkdtemp(path.join(tmpdir(), "arnes-headless-"));

      const mainTsUrl = new URL("../../main.ts", import.meta.url);
      const rutaMainTs = path.resolve(mainTsUrl.pathname);
      const rutaTsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

      // Entorno EXPLÍCITO y mínimo (no se hereda `process.env` completo): sin
      // `*_PORT`/token, los tres listeners quedan deshabilitados -- cero
      // superficie de red en esta prueba.
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HARNESS_HEADLESS: "1",
        HARNESS_DB_PATH: path.join(dirTemporal, "harness.db"),
      };

      hijo = spawn(process.execPath, ["--import", rutaTsx, rutaMainTs], {
        cwd: dirTemporal,
        env,
        stdio: ["ignore", "ignore", "ignore"],
      });

      const pid = hijo.pid;
      expect(pid).toBeDefined();
      if (pid === undefined) {
        throw new Error("test setup error: spawn no devolvió un pid");
      }

      // Esperar el arranque SIN código nuevo de producción: sondear
      // `/proc/<pid>/status` hasta que la rama headless ya haya registrado
      // sus 4 handlers (bit de `SIGTERM` presente en `SigCgt`). Sin este
      // sondeo, un `SIGTERM` mandado demasiado pronto mata al hijo por el
      // comportamiento POR DEFECTO de Node (sin handler, `exitCode` `null`,
      // `signalCode` `"SIGTERM"`) y la prueba sería intermitente.
      await esperarHastaQueRegistreSigterm(pid);

      const salida = new Promise<{ readonly exitCode: number | null; readonly signalCode: string | null }>(
        (resolve) => {
          hijo?.once("exit", (exitCode, signalCode) => {
            resolve({ exitCode, signalCode });
          });
        },
      );

      hijo.kill("SIGTERM");
      const { exitCode, signalCode } = await salida;

      expect(exitCode).toBe(0);
      expect(signalCode).toBeNull();

      const rutaLog = path.join(dirTemporal, "data", "harness.log");
      expect(existsSync(rutaLog)).toBe(true);
      const log = await readFile(rutaLog, "utf8");
      expect(log).toContain("cierre-senal-recibida");
      expect(log).toContain("cierre-completado");
      expect(log).not.toContain("cierre-presupuesto-excedido");
    }, 30_000);
  },
);
