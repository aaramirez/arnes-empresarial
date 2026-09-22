import "../../core/config/env.js";

/**
 * El side-effect import de arriba carga `.env` vía el punto único del repo
 * (`src/core/config/env.ts`), mismo molde que los `config.ts` de los otros
 * nueve adaptadores (`webhooks`, `web`, `a2a`, `board`, `git`, `knowledge`,
 * `notificaciones`, `test-runner`).
 *
 * A diferencia de esos nueve, este módulo lo importan además DOS CLIs
 * (`src/empleados.ts`, `src/reporte-mensual.ts`) que hasta este change
 * NUNCA cargaban `.env` (`modo-headless-cierre-limpio`, design.md §0.3,
 * RD-122): ninguno de los dos importaba, directa ni transitivamente,
 * `core/config/env.js`. Al importar `resolveDbPath` desde acá, ambos CLIs
 * pasan a ver TODO el `.env`, no solo `HARNESS_DB_PATH` — ninguno lee hoy
 * otra variable (verificado), así que no hay cambio de comportamiento
 * observable, pero el próximo que agregue una variable leída por un CLI
 * necesita saber por qué ahora funciona sin nada más que este import.
 */

/** Ruta por defecto de la base, relativa a `process.cwd()`, idéntica a la de antes de este change. */
export const DEFAULT_DB_PATH = "data/harness.db";

/**
 * Resuelve la ruta de la base SQLite consumida por los cuatro sitios que
 * hoy abren `data/harness.db`: `main.ts`, `empleados.ts` (×2) y
 * `reporte-mensual.ts`.
 *
 * `HARNESS_DB_PATH` ausente, vacía o en blanco ⇒ `DEFAULT_DB_PATH`. Un valor
 * no blanco se devuelve TAL CUAL, sin normalizar: `.trim()` recorta solo los
 * bordes (una ruta con espacios internos es válida — el propio repo vive en
 * un directorio con espacios).
 *
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveWebhookConfig`/`resolveGraphifyConfig`, para que los tests
 * pasen un objeto literal en vez de mutar el env global.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HARNESS_DB_PATH;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DB_PATH;
  }
  return raw.trim();
}
