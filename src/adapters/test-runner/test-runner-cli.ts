import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestRunnerConfig } from "./config.js";

/**
 * Shape of a subprocess runner narrow enough to be faked in tests without
 * touching the real `vitest`/`node` binary — same shape and purpose as
 * `GitExecFileFn` (`src/adapters/git/git-cli.ts`, Hito 5.1, tarea 3).
 * `defaultTestExecFile` is the production implementation; tests inject their
 * own fake (design.md §6.2, Hito 5.1, tarea 22).
 */
export type TestExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly cwd: string },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const execFileAsync = promisify(execFile);

/**
 * Production `TestExecFileFn`. Uses `execFile` (array argv, `shell` never
 * set) — never `exec`, same discipline `git-cli.ts`'s `defaultGitExecFile`
 * applies. `maxBuffer` is raised from Node's 1 MB default because a vitest
 * run's combined stdout/stderr can exceed it on a large suite; `windowsHide`
 * avoids a flashing console window on Windows.
 */
export const defaultTestExecFile: TestExecFileFn = (file, args, options) =>
  execFileAsync(file, args as string[], {
    timeout: options.timeout,
    cwd: options.cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

/**
 * ADR 66: deliberately narrower than `GitFailureReason` — no `"exit-code"`.
 * For `vitest run`, a numeric non-zero exit code means the suite RAN and has
 * red tests, which is a valid `TestRunResult`, not a failure of this
 * adapter. Only `ENOENT` (the vitest entrypoint file doesn't exist) and a
 * killed/timed-out process are real adapter-level failures.
 */
export type TestRunFailureReason = "not-found" | "timeout" | "unknown";

/**
 * Typed error crossing the adapter boundary in place of whatever
 * `execFile`/`node:child_process` raised — same pattern as `GitCliError`
 * (`git-cli.ts`). No `command` field: unlike the git adapter, this module
 * only ever runs one command (`vitest run`), so there is nothing to
 * disambiguate in the message.
 */
export class TestRunnerCliError extends Error {
  readonly reason: TestRunFailureReason;
  readonly cause: unknown;

  constructor(reason: TestRunFailureReason, cause: unknown) {
    super(`vitest run failed: ${reason}`);
    this.name = "TestRunnerCliError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * A successful `runVitest` outcome — "successful" meaning the subprocess
 * itself launched and ran to completion, NOT that the suite passed.
 * `exitCode` carries that verdict instead (0 = green, non-zero = red);
 * `output` is `stdout` + `stderr`, untruncated (truncation by tail lives in
 * `test-runner-tool.ts`, a separate task).
 */
export interface TestRunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly durationMs: number;
}

/**
 * Narrow, untyped shape of whatever `execFile`/its promisified wrapper
 * rejects with — mirrors `classifyGitFailure`'s input handling in
 * `git-cli.ts`. Not exported: unlike `git-cli.ts` (whose wrapper lives in a
 * different file, `worktree.ts`), `runVitest` below is both the builder and
 * the boundary-crossing wrapper in the same module, so there is no separate
 * caller that needs this classification independently.
 */
function extraerCamposError(error: unknown): {
  readonly code?: unknown;
  readonly killed?: unknown;
  readonly signal?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
} {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : {};
}

/**
 * `execFile(process.execPath, [vitestEntrypoint, "run", "--reporter=default"], { cwd, timeout })`.
 *
 * **Corrección post-integración (Hito 5.1, tarea 25, RED→GREEN, sin cambio
 * de alcance)**: design.md §6.2 fijaba literal `"--reporter=basic"`, pero
 * `"basic"` NO es un reporter de Vitest 4.x (confirmado con `npx vitest
 * --help`, lista real: `default, agent, minimal, blob, verbose, dot, json,
 * tap, tap-flat, junit, tree, hanging-process, github-actions` — sin
 * `"basic"`). Contra la versión de `vitest` realmente instalada
 * (`node_modules/vitest@4.1.11`, la misma que corre el resto de la suite del
 * repo), CUALQUIER invocación real de `runVitest` fallaba en el arranque del
 * servidor de Vite con `Failed to load custom Reporter from basic` —
 * `exitCode` no-cero SIEMPRE, sin importar si la suite real era verde o roja.
 * Los tests unitarios de tareas 22-24 (con `TestExecFileFn` fake) nunca lo
 * detectaron porque nunca lanzan el `vitest` real; lo detectó
 * `src/test/integration/run-tests.integration.test.ts` (tarea 25), la
 * primera categoría de este repo que sí lo hace — mismo patrón que el
 * hallazgo de `normalizarSeparadores` en `barrido.ts` (tarea 11). Fix:
 * `"default"`, el reporter humano-legible más cercano al `"basic"` que
 * describía el diseño.
 * NEVER `npm`, NEVER shell: on Windows `npm` is `npm.cmd`, and Node >= 20
 * refuses to launch it with `execFile` without a shell — and using a shell
 * is exactly what ADR 61 prohibits. Running the vitest entrypoint directly
 * through the same `node` binary already running this process (`process.execPath`)
 * sidesteps the whole problem (R6, design.md §6.2).
 *
 * ADR 66's decision tree, order-sensitive (design.md §6.2, literal):
 *
 * ```
 * error de execFile
 *    ├─ code === "ENOENT"                        → TestRunnerCliError("not-found")
 *    ├─ killed === true || signal === "SIGTERM"   → TestRunnerCliError("timeout")
 *    ├─ typeof code === "number"                  → RESULTADO OK { exitCode: code, output: stdout+stderr }
 *    └─ resto                                     → TestRunnerCliError("unknown")
 * ```
 *
 * `ENOENT` is checked before the numeric branch because `code` can be the
 * STRING `"ENOENT"` (not a number), and `killed`/`SIGTERM` is checked before
 * the numeric branch because a process killed by timeout can ALSO carry a
 * numeric `code` — checking numeric first would misreport a timeout as a
 * successful (if red) run.
 */
export async function runVitest(
  config: TestRunnerConfig,
  cwd: string,
  execFileFn: TestExecFileFn = defaultTestExecFile,
): Promise<TestRunResult> {
  const argv = [config.vitestEntrypoint, "run", "--reporter=default"];
  const inicio = Date.now();
  try {
    const { stdout, stderr } = await execFileFn(process.execPath, argv, {
      timeout: config.timeoutMs,
      cwd,
    });
    return { exitCode: 0, output: stdout + stderr, durationMs: Date.now() - inicio };
  } catch (error) {
    const durationMs = Date.now() - inicio;
    const campos = extraerCamposError(error);

    if (campos.code === "ENOENT") {
      throw new TestRunnerCliError("not-found", error);
    }
    if (campos.killed === true || campos.signal === "SIGTERM") {
      throw new TestRunnerCliError("timeout", error);
    }
    if (typeof campos.code === "number") {
      const stdout = typeof campos.stdout === "string" ? campos.stdout : "";
      const stderr = typeof campos.stderr === "string" ? campos.stderr : "";
      return { exitCode: campos.code, output: stdout + stderr, durationMs };
    }
    throw new TestRunnerCliError("unknown", error);
  }
}
