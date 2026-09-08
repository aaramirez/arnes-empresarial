/**
 * Contrato del entorno de trabajo aislado (Hito 5.1, tarea 1, ADR 57, 61, 62,
 * design.md §5.1).
 *
 * Lo único que el Núcleo sabe sobre la escritura delegada del Developer: el
 * nombre calificado de la tool MCP de tests (para otorgarla en
 * `AgentDefinition.allowedTools`, `src/core/agents/definitions.ts`), el
 * prefijo de rama que usa el barrido de huérfanos, y los puertos que
 * `src/adapters/git/` implementa — ciclo de vida del worktree, barrido, y
 * aplicación de patch sobre el checkout real. La implementación real vive en
 * `src/adapters/git/` e importa de este módulo, nunca al revés: la regla no
 * negociable de `AGENTS.md` es que `src/core/` no importa de
 * `src/adapters/*`, ni del SDK, ni de Node. Este archivo no importa nada —
 * mismo criterio que `src/core/knowledge/knowledge-contract.ts` (Hito 2,
 * tarea 1) y `src/core/hitl/hitl-contract.ts` (Hito 5, tarea 1).
 */

/* ── Nombres de la tool MCP (molde literal de knowledge-contract.ts:17-27) ── */
export const WORKTREE_MCP_SERVER_NAME = "worktree";
export const WORKTREE_TEST_TOOL_NAME = "run_tests";
export const WORKTREE_TEST_TOOL_QUALIFIED_NAME =
  `mcp__${WORKTREE_MCP_SERVER_NAME}__${WORKTREE_TEST_TOOL_NAME}` as const; // "mcp__worktree__run_tests"

/** Prefijo de rama — la mitad FILTRABLE del doble filtro del barrido (ADR 57 pto 7). */
export const WORKTREE_RAMA_PREFIJO = "harness/caso-";

/** Handle de un worktree vivo. Lo produce SÓLO `WorktreePort.abrir`; es el único
 *  parámetro de `construirDeveloperConEscritura` (ADR 67). */
export interface WorktreeAbierto {
  readonly casoId: string;
  /** Ruta ABSOLUTA. `.harness/worktrees/<casoId>-<uuid>` resuelta contra la raíz del repo. */
  readonly ruta: string;
  /** `harness/caso-<casoId>-<uuid>`. NUNCA recibe un commit. */
  readonly rama: string;
  /** SHA de `HEAD` en el momento de abrir. Sin esto, un `apply` fallido es indiagnosticable (R13). */
  readonly baseCommit: string;
}

/**
 * CONTRATO ASIMÉTRICO, DELIBERADO (ADR 57 pto 6) — leer antes de implementar:
 *
 *  · `abrir` y `capturarDiff` FALLAN RUIDOSAMENTE: rechazan con `GitCliError`
 *    (o lo que el adaptador tire) y NO lo atrapan. Criterio de `ActivityStorePort`:
 *    sin worktree no hay trabajo, y un diff que no se pudo capturar es trabajo
 *    PERDIDO que hay que ver, no tragar.
 *
 *  · `cerrar` NUNCA rechaza, bajo NINGUNA circunstancia — ni si el worktree ya
 *    no existe, ni si `git` desapareció del PATH, ni si el disco está lleno.
 *    Tiene su propio `try/catch` interno que degrada a evento
 *    `worktree-cierre-fallido`. Motivo: se invoca desde un `finally`, y un
 *    `finally` que revienta ENMASCARA el error real del `try`.
 */
export interface WorktreePort {
  abrir(input: { readonly casoId: string; readonly id: string }): Promise<WorktreeAbierto>;
  capturarDiff(worktree: WorktreeAbierto): Promise<string>;
  cerrar(worktree: WorktreeAbierto): Promise<void>;
}

export interface BarridoResumen {
  readonly examinados: number;
  readonly borrados: number;
  readonly fallidos: number;
}

/**
 * Barrido de huérfanos al arranque. NUNCA rechaza: un barrido que revienta
 * tumbaría el arranque del arnés por basura de una corrida vieja. Degrada a
 * evento `worktree-barrido-fallido` y devuelve el resumen parcial.
 */
export interface BarridoWorktreePort {
  barrerHuerfanos(input: {
    readonly ttlMs: number;
    /** Inyectado, no `Date.now()` adentro: el test fabrica mtimes viejos y recientes. */
    readonly ahoraMs: number;
  }): Promise<BarridoResumen>;
}

export const MOTIVO_PATCH_CONFLICTO = "conflicto";
export const MOTIVO_PATCH_ERROR_GIT = "error_git";
export type MotivoPatchNoAplicable = typeof MOTIVO_PATCH_CONFLICTO | typeof MOTIVO_PATCH_ERROR_GIT;

export type ResultadoPatch =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: MotivoPatchNoAplicable; readonly detalle?: string };

/**
 * Puerto SEPARADO de `WorktreePort` a propósito (ADR 57 pto 4 + ADR 60): su
 * único consumidor es el comando TUI, y opera sobre el CHECKOUT REAL, no
 * sobre un worktree. Tenerlos juntos invitaría a que la cadena de revisión
 * — que sí tiene un `WorktreePort` — pudiera aplicar un patch sin humano.
 *
 * NUNCA rechaza (ADR 64 pto 3): un `--check` que falla es el desenlace NORMAL
 * de "la base se movió", y `aplicar` corre DESPUÉS del commit de la
 * transacción, donde una excepción perdería la única chance de avisarle al
 * humano que el estado quedó inconsistente (RD-13).
 */
export interface AplicarPatchPort {
  verificar(patch: string): Promise<ResultadoPatch>;
  aplicar(patch: string): Promise<ResultadoPatch>;
}
