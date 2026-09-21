/**
 * Entrypoint CLI del reporte mensual de comisiones (Hito 4, tarea 30, §6.6,
 * ADR 9 de la propuesta). `package.json`'s `reporte:mensual` script points
 * here (`tsx src/reporte-mensual.ts`). Uso:
 * `npm run reporte:mensual -- --periodo 2026-02`.
 *
 * Solo I/O y wiring — mismo criterio que `src/main.ts`: `parsePeriodo`
 * (única parte pura de este archivo, testeada en
 * `reporte-mensual.test.ts`) resuelve `--periodo` de `process.argv` o cae al
 * mes corriente (UTC); la base se abre por `resolveDbPath` (`HARNESS_DB_PATH`/
 * default `data/harness.db`, modo-headless-cierre-limpio RD-122), el MISMO
 * resolver y el MISMO path que `main.ts`, corre las migraciones si faltan;
 * `listComisionesPorPeriodo` + `listVentasEnReembolsoPendiente` (tarea 25,
 * adapter de memoria, solo lectura) alimentan `agruparReporteMensual` +
 * `formatearReporteMensual` (tarea 9, ambas PURAS, `src/core/ventas/
 * reporte.ts` — no reimplementadas acá) y el texto resultante va a
 * `process.stdout`.
 *
 * `db.close()` corre en un `finally` — este proceso es de vida corta, sin
 * ninguna TUI montada (a diferencia de `main.ts`), así que no hay otro
 * recurso que drenar antes de cerrar la base.
 *
 * ★ stdout es legítimo ACÁ y solo acá. ★ Ver el module doc de
 * `src/core/logging/turn-logger.ts` para por qué NADA del proceso
 * principal (`main.ts`) puede escribir a un stream que la terminal muestre
 * (Ink). Este es un proceso DISTINTO, de vida corta, sin ninguna TUI
 * montada — imprimir es literalmente su trabajo.
 *
 * NO correr este comando no tiene NINGÚN efecto sobre `ventas`,
 * `comisiones` ni el resto del arnés: es de solo lectura (spec
 * `reporte-comisiones-mensual`, "Comando bajo demanda, sin scheduler ni
 * registro" / "Ejecutar o no ejecutar el comando no afecta el resto del
 * sistema").
 *
 * A diferencia de `main.ts` (que ningún test importa — ver su propio module
 * doc), `reporte-mensual.test.ts` SÍ importa este archivo para testear
 * `parsePeriodo` directamente, sin extraer un `build-*.ts` aparte (no vale
 * la pena para un solo entrypoint de una función). Eso significa que
 * `main()` NO puede dispararse como efecto secundario de la sola
 * importación del módulo — abriría `data/harness.db` de verdad y podría
 * llamar `process.exit(1)` en medio de la corrida de vitest. El guard de
 * `isMainModule` de abajo (comparación `import.meta.url` vs.
 * `process.argv[1]`, patrón estándar de Node.js) es lo que lo evita: solo
 * corre cuando el archivo se ejecuta directamente (`tsx
 * src/reporte-mensual.ts`), no cuando otro módulo lo importa.
 */
import { pathToFileURL } from "node:url";
import { openDatabase } from "./adapters/memory/db.js";
import { resolveDbPath } from "./adapters/memory/config.js";
import { listComisionesPorPeriodo, listVentasEnReembolsoPendiente } from "./adapters/memory/repository.js";
import { agruparReporteMensual, formatearReporteMensual } from "./core/ventas/reporte.js";

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const USO_MENSAJE = "Uso: npm run reporte:mensual -- --periodo YYYY-MM";

type ParsePeriodoResult =
  | { readonly ok: true; readonly periodo: string }
  | { readonly ok: false; readonly mensaje: string };

/**
 * Resuelve el `periodo` a reportar a partir de `argv` (§6.6, paso 1). PURA:
 * no lee `process.argv` ni `Date` directamente, los recibe como parámetros
 * para que el test sea determinista.
 *
 * - `--periodo <valor>` presente → valida formato `YYYY-MM`; si no matchea,
 *   `ok:false` con el mensaje de uso.
 * - Ausente → mes corriente vía `now().slice(0, 7)` (ISO 8601, UTC — ADR 16
 *   regla 2).
 */
export function parsePeriodo(
  argv: readonly string[],
  now: () => string,
): ParsePeriodoResult {
  const flagIndex = argv.indexOf("--periodo");
  if (flagIndex === -1) {
    return { ok: true, periodo: now().slice(0, 7) };
  }

  const valor = argv[flagIndex + 1];
  if (valor === undefined || !PERIODO_REGEX.test(valor)) {
    return { ok: false, mensaje: USO_MENSAJE };
  }

  return { ok: true, periodo: valor };
}

async function main(): Promise<void> {
  const parsed = parsePeriodo(process.argv.slice(2), () => new Date().toISOString());
  if (!parsed.ok) {
    process.stderr.write(`${parsed.mensaje}\n`);
    process.exit(1);
    return;
  }

  const db = openDatabase(resolveDbPath());
  try {
    const comisiones = listComisionesPorPeriodo(db, parsed.periodo);
    const reembolsosPendientes = listVentasEnReembolsoPendiente(db);
    const reporte = agruparReporteMensual({ periodo: parsed.periodo, comisiones, reembolsosPendientes });
    process.stdout.write(`${formatearReporteMensual(reporte)}\n`);
  } finally {
    db.close();
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await main();
}
