import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Shared subprocess-launch safety policy for every adapter that shells out
 * to a CLI binary (`git`, the local `vitest` entrypoint, `graphify`):
 * array argv only (`execFile`, never `exec` — no adapter this repo talks to
 * a shell for, so no adapter-controlled or user-controlled string is ever
 * interpreted by one), `maxBuffer` raised from Node's 1 MB default (a `git
 * diff --binary` on a sizeable patch, a `vitest run`'s combined
 * stdout/stderr, or a high `--budget` `graphify query` can all exceed it —
 * the failure mode would otherwise be an opaque `ENOBUFS`), and
 * `windowsHide` to avoid a flashing console window on Windows.
 *
 * Extracted from three near-identical wrappers (Reviewer finding, reuse):
 * `defaultGitExecFile` (`src/adapters/git/git-cli.ts`), `defaultTestExecFile`
 * (`src/adapters/test-runner/test-runner-cli.ts`) and `defaultExecFile`
 * (`src/adapters/knowledge/graphify-cli.ts`). Each adapter keeps its own
 * named function-type (`GitExecFileFn`/`TestExecFileFn`/`ExecFileFn`) —
 * `cwd` is required for the first two and absent for the third, so this
 * shared function takes it as optional rather than forcing one shape on all
 * three call sites.
 */
export function execFileSafely(
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly cwd?: string },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return execFileAsync(file, args as string[], {
    timeout: options.timeout,
    cwd: options.cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
}
