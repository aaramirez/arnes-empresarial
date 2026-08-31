import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SAVE_RESULT_TIMEOUT_MS, type GraphifyConfig } from "./config.js";

/**
 * Shape of a subprocess runner narrow enough to be faked in tests without
 * touching the real `graphify` binary. `defaultExecFile` is the production
 * implementation; tests inject their own fake.
 */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const execFileAsync = promisify(execFile);

/**
 * Production `ExecFileFn`. Uses `execFile` (array argv, `shell` never set)
 * — never `exec` — because `question` is free text typed by an employee and
 * travels straight into this argv; with a shell, `"; rm -rf ..."` or
 * `$(...)` would be interpreted. `maxBuffer` is raised from Node's 1 MB
 * default because a high `--budget` against a large graph can exceed it,
 * and the failure mode would otherwise be an opaque `ENOBUFS`.
 * `windowsHide` avoids a flashing console window on Windows.
 */
export const defaultExecFile: ExecFileFn = (file, args, options) =>
  execFileAsync(file, args as string[], {
    timeout: options.timeout,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

export type GraphifyFailureReason = "not-found" | "timeout" | "exit-code" | "unknown";

/**
 * Typed error crossing the adapter boundary in place of whatever
 * `execFile`/`node:child_process` raised. Same pattern `repository.ts`
 * applies with `isSqliteConstraintError`: the raw driver error (`cause`)
 * never leaks past this module, only a classified `reason`.
 */
export class GraphifyCliError extends Error {
  readonly reason: GraphifyFailureReason;
  readonly cause: unknown;

  constructor(reason: GraphifyFailureReason, command: string, cause: unknown) {
    super(`graphify ${command} failed: ${reason}`);
    this.name = "GraphifyCliError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Classifies a raw error from `execFile` into a `GraphifyFailureReason`.
 * See design.md's table: `ENOENT` → binary not found, `killed`/`SIGTERM` →
 * timed out, a numeric non-zero `code` → the process ran and exited with
 * failure, anything else → unknown (safety net).
 */
function classifyFailure(error: unknown): GraphifyFailureReason {
  if (typeof error === "object" && error !== null) {
    const err = error as { code?: unknown; killed?: unknown; signal?: unknown };
    if (err.code === "ENOENT") {
      return "not-found";
    }
    if (err.killed === true || err.signal === "SIGTERM") {
      return "timeout";
    }
    if (typeof err.code === "number" && err.code !== 0) {
      return "exit-code";
    }
  }
  return "unknown";
}

/** Builds the argv for `graphify query <question> --graph <graphPath> --budget <budget>`. */
export function buildQueryArgs(question: string, config: GraphifyConfig): readonly string[] {
  return ["query", question, "--graph", config.graphPath, "--budget", String(config.budget)];
}

/** Builds the argv for `graphify save-result --question <q> --answer <a> --nodes <label1> <label2> ...`. */
export function buildSaveResultArgs(input: {
  readonly question: string;
  readonly answer: string;
  readonly nodes: readonly string[];
}): readonly string[] {
  return ["save-result", "--question", input.question, "--answer", input.answer, "--nodes", ...input.nodes];
}

/**
 * Runs `graphify query` and returns its raw stdout untouched — the core
 * never sees parsed nodes, only this string (see design.md's `cited-nodes.ts`
 * section). Throws `GraphifyCliError` on any failure; the raw error from
 * `execFileFn` never crosses this boundary.
 */
export async function runGraphifyQuery(
  question: string,
  config: GraphifyConfig,
  execFileFn: ExecFileFn = defaultExecFile,
): Promise<string> {
  const args = buildQueryArgs(question, config);
  try {
    const { stdout } = await execFileFn(config.bin, args, { timeout: config.queryTimeoutMs });
    return stdout;
  } catch (error) {
    throw new GraphifyCliError(classifyFailure(error), "query", error);
  }
}

/**
 * Runs `graphify save-result`. Best-effort from the caller's perspective
 * (feedback that fails should never break a turn), but this function itself
 * always throws a typed `GraphifyCliError` on failure — degrading silently
 * is the caller's decision to make, not this module's.
 */
export async function runGraphifySaveResult(
  input: { readonly question: string; readonly answer: string; readonly nodes: readonly string[] },
  config: GraphifyConfig,
  execFileFn: ExecFileFn = defaultExecFile,
): Promise<void> {
  const args = buildSaveResultArgs(input);
  try {
    await execFileFn(config.bin, args, { timeout: SAVE_RESULT_TIMEOUT_MS });
  } catch (error) {
    throw new GraphifyCliError(classifyFailure(error), "save-result", error);
  }
}
