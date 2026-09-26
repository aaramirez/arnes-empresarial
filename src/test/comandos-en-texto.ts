/**
 * Helper de test compartido (ADR 303, generaliza la guarda del ADR 302):
 * extrae de un texto que llega al modelo los tokens con forma de comando de
 * la TUI, para verificar que todos existan en `COMANDOS`
 * (`core/commands/comando-empleado.ts`). Lo usan la guarda de
 * `core/agents/textos-modelo-sin-comandos.test.ts` y la de la nota del
 * reporte (`core/ventas/reporte.test.ts`). Vive en `src/test/`, excluido del
 * build (`tsconfig.build.json`). Es puro: recibe los nombres válidos en vez
 * de importar `COMANDOS`.
 *
 * El patrón, pieza por pieza:
 * - `(?<![\p{L}\p{N}_./~])`: la barra no viene después de una letra (con o
 *   sin tilde), un dígito, `_`, `.`, `/` ni `~`. Descarta rutas (`src/core`,
 *   `./x.js`, `../x`, `~/datos`), URLs (`https://x.com/aprobar`) y
 *   alternativas (`y/o`).
 * - `\/[a-z]`: barra seguida de una minúscula. Descarta `/2026`, `//` y
 *   `` `Write`/`Edit` `` (tras la barra viene un backtick).
 * - `[a-z0-9-]*`: el resto del nombre, con dígitos, para reconocer completo
 *   `/ver-solicitudes-a2a`.
 *
 * Límites conocidos: un comando con mayúscula no se reconoce (no existe
 * ninguno); `/aprobación` produce `/aprobaci` y un guion final entra al
 * token. Ante un falso positivo se REFORMULA el texto, no se afloja el
 * patrón (spec `delegacion-subagentes`, v3.22).
 */
export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_./~])\/[a-z][a-z0-9-]*/gu;

/** Tokens con forma de comando, en orden de aparición. Sin estado entre llamadas (`matchAll` clona el patrón). */
export function extraerTokensComando(texto: string): string[] {
  return Array.from(texto.matchAll(PATRON_TOKEN_COMANDO), (m) => m[0]);
}

/** Tokens con forma de comando de `texto` que no son el `nombre` de ningún comando válido. */
export function tokensComandoInexistentes(texto: string, nombresValidos: ReadonlySet<string>): string[] {
  return extraerTokensComando(texto).filter((token) => !nombresValidos.has(token));
}
