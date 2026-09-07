import { resolve } from "node:path";
import { WORKTREE_RAMA_PREFIJO, type BarridoResumen } from "../../core/agents/worktree-contract.js";
import {
  buildBranchDeleteArgs,
  buildWorktreeListArgs,
  buildWorktreePruneArgs,
  buildWorktreeRemoveArgs,
  classifyGitFailure,
  GitCliError,
  type GitExecFileFn,
} from "./git-cli.js";

/**
 * Barrido de worktrees huérfanos al arranque (Hito 5.1, tarea 8, ADR 57 pto
 * 7, ADR 62, design.md §6.1). Implementa `BarridoWorktreePort`
 * (`src/core/agents/worktree-contract.ts`) como una función standalone —
 * `index.ts` (tarea 9) es el único archivo que la ata a ese puerto; este
 * módulo no tiene fábrica propia (ADR 62's tabla).
 *
 * Separado de `worktree.ts` (ADR 62): tiene el contrato INVERSO — nunca
 * rechaza, mientras que `abrirWorktree`/`capturarDiff` sí lo hacen — y es el
 * único módulo del adaptador que necesita medir `mtime` (vía `statFn`
 * inyectado, nunca `node:fs/promises` real dentro de este archivo, para que
 * el test pueda fabricar mtimes viejos y recientes sin tocar el disco).
 */
export type StatFn = (ruta: string) => Promise<{ readonly mtimeMs: number }>;

export interface BarridoRunnerDeps {
  /** Root del checkout real — `worktree list --porcelain` y `worktree prune` corren acá (`cwd`). */
  readonly repoRoot: string;
  /** Relativo a `repoRoot` — la mitad RUTA del doble filtro (`resolveWorktreeConfig`, `config.ts`). */
  readonly worktreeRoot: string;
  readonly bin: string;
  readonly timeoutMs: number;
  readonly execFileFn: GitExecFileFn;
  /** Inyectado, no `node:fs/promises` real acá: el test fabrica mtimes viejos y recientes. */
  readonly statFn: StatFn;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

interface RegistroWorktree {
  readonly ruta: string;
  readonly rama: string | undefined;
}

interface CandidatoBarrido {
  readonly ruta: string;
  readonly rama: string;
}

/**
 * Private boundary-crossing helper — misma secuencia que el `runGit` privado
 * de `worktree.ts` (no exportado de ninguno de los dos: ADR 62 prohíbe un
 * `git(args)` genérico en la superficie PÚBLICA del adaptador, cada uno de
 * estos dos helpers privados solo recibe argv ya armado por uno de los diez
 * constructores nombrados).
 */
async function runGit(
  argv: readonly string[],
  command: string,
  cwd: string,
  deps: Pick<BarridoRunnerDeps, "bin" | "timeoutMs" | "execFileFn">,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await deps.execFileFn(deps.bin, argv, { timeout: deps.timeoutMs, cwd });
  } catch (error) {
    throw new GitCliError(classifyGitFailure(error), command, error);
  }
}

/** Mismo molde que `toErrorMessage` de `main.ts`/`build-on-comando-empleado.ts` — duplicado a propósito (config de adaptador, no lógica de negocio para hoistear a `src/core/`). */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parsea la salida de `git worktree list --porcelain` en registros
 * `{ ruta, rama }`. Un nuevo registro empieza en cada línea `worktree `;
 * `branch refs/heads/<rama>` (si está presente) fija `rama` para el registro
 * en curso — `detached`/`bare`/`locked`/`HEAD ...` se ignoran, dejando
 * `rama` en `undefined` (que el doble filtro descarta de por sí, sin
 * necesitar un caso especial).
 */
function parsearPorcelain(salida: string): readonly RegistroWorktree[] {
  const registros: RegistroWorktree[] = [];
  let actual: { ruta: string; rama: string | undefined } | undefined;

  for (const linea of salida.split("\n")) {
    if (linea.startsWith("worktree ")) {
      if (actual !== undefined) {
        registros.push(actual);
      }
      actual = { ruta: linea.slice("worktree ".length).trim(), rama: undefined };
    } else if (linea.startsWith("branch ") && actual !== undefined) {
      const ref = linea.slice("branch ".length).trim();
      const rama = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      actual = { ...actual, rama };
    }
  }
  if (actual !== undefined) {
    registros.push(actual);
  }
  return registros;
}

/**
 * Normaliza separadores de ruta a `/` (hallazgo real de Hito 5.1, tarea 11,
 * confirmado con `git` real en Windows): `git worktree list --porcelain`
 * SIEMPRE reporta rutas con `/`, incluso en Windows, mientras que
 * `resolve()` de Node en Windows devuelve `\`. Sin normalizar, el
 * `startsWith` de `esCandidato` nunca matchea en Windows contra la salida de
 * `git` real — el doble filtro descarta silenciosamente TODOS los
 * candidatos (`examinados: 0` siempre), algo que ningún test unitario
 * anterior (`barrido.test.ts`, `index.test.ts`) podía detectar porque
 * fabrican su propio porcelain con `join()`, que usa el mismo separador que
 * la comparación. En POSIX es un no-op (`\\` no aparece en rutas reales).
 */
function normalizarSeparadores(ruta: string): string {
  return ruta.replaceAll("\\", "/");
}

/**
 * El DOBLE filtro (ADR 57 pto 7, RD-14): un candidato sólo se toca si SU
 * RUTA está bajo `worktreeRootAbsoluto` **y** SU RAMA tiene el prefijo
 * `WORKTREE_RAMA_PREFIJO` — si cualquiera de las dos condiciones falla, no
 * se toca. Sin esto, el barrido de una segunda instancia del arnés podría
 * borrar el checkout principal o una rama ajena.
 */
function esCandidato(registro: RegistroWorktree, worktreeRootAbsoluto: string): registro is RegistroWorktree & { rama: string } {
  const ruta = normalizarSeparadores(registro.ruta);
  const dentroDeLaRaiz = ruta === worktreeRootAbsoluto || ruta.startsWith(`${worktreeRootAbsoluto}/`);
  return dentroDeLaRaiz && registro.rama !== undefined && registro.rama.startsWith(WORKTREE_RAMA_PREFIJO);
}

/**
 * Algoritmo exacto (design.md §6.1):
 *
 * 1. `git worktree list --porcelain` (cwd = repoRoot) → si falla: evento
 *    `worktree-barrido-fallido`, `return {0,0,0}` SIN rechazar.
 * 2. Parsear en registros `{ ruta, rama }`.
 * 3. Filtrar con las DOS condiciones del doble filtro.
 * 4. Por cada candidato, en su PROPIO `try/catch` (uno que falla no aborta
 *    el resto): medir mtime; si está dentro del TTL, dejarlo intacto (podría
 *    estar vivo); si no, `worktree remove --force` + `branch -D`.
 * 5. `git worktree prune` (limpia registros de worktrees ya borrados a
 *    mano) — en su propio `try/catch`: si falla, degrada a evento
 *    `worktree-barrido-fallido` en vez de descartar el resumen ya calculado
 *    en el paso 4 (spec `escritura-aislada-worktree`, escenario "Un fallo de
 *    `git` durante el barrido no tumba el arranque").
 * 6. Si todo lo anterior salió bien, evento `worktree-barrido-ok` con el
 *    resumen completo.
 *
 * NUNCA rechaza (`BarridoWorktreePort`'s doc-comment): un barrido que
 * revienta tumbaría el arranque del arnés por basura de una corrida vieja.
 */
export async function barrerHuerfanos(
  input: { readonly ttlMs: number; readonly ahoraMs: number },
  deps: BarridoRunnerDeps,
): Promise<BarridoResumen> {
  let salida: string;
  try {
    const resultado = await runGit(buildWorktreeListArgs(), "worktree list --porcelain", deps.repoRoot, deps);
    salida = resultado.stdout;
  } catch (error) {
    deps.logEvent("worktree-barrido-fallido", { message: toErrorMessage(error) });
    return { examinados: 0, borrados: 0, fallidos: 0 };
  }

  const worktreeRootAbsoluto = normalizarSeparadores(resolve(deps.repoRoot, deps.worktreeRoot));
  const candidatos: readonly CandidatoBarrido[] = parsearPorcelain(salida).filter((registro) =>
    esCandidato(registro, worktreeRootAbsoluto),
  );

  let borrados = 0;
  let fallidos = 0;

  for (const candidato of candidatos) {
    try {
      const { mtimeMs } = await deps.statFn(candidato.ruta);
      if (input.ahoraMs - mtimeMs <= input.ttlMs) {
        continue; // dentro del TTL: podría estar vivo, se deja intacto
      }
      await runGit(buildWorktreeRemoveArgs(candidato.ruta), "worktree remove --force", deps.repoRoot, deps);
      await runGit(buildBranchDeleteArgs(candidato.rama), "branch -D", deps.repoRoot, deps);
      borrados += 1;
    } catch {
      fallidos += 1;
    }
  }

  const resumen: BarridoResumen = { examinados: candidatos.length, borrados, fallidos };

  try {
    await runGit(buildWorktreePruneArgs(), "worktree prune", deps.repoRoot, deps);
  } catch (error) {
    deps.logEvent("worktree-barrido-fallido", { message: toErrorMessage(error) });
    return resumen;
  }

  deps.logEvent("worktree-barrido-ok", { ...resumen, ttlMs: input.ttlMs });
  return resumen;
}
