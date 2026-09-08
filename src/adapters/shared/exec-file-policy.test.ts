import { describe, expect, it, vi } from "vitest";
import { execFileSafely } from "./exec-file-policy.js";

// `util.promisify(execFile)` resolves to `{stdout, stderr}` only because the
// real `execFile` declares a `util.promisify.custom` implementation with
// that two-field shape (Node's callback signature is `(err, stdout,
// stderr)`, not the generic single-value `(err, value)`). The mock below
// replicates that symbol directly instead of a plain callback-style stub, or
// `promisify` would fall back to treating `stdout` as the sole resolved
// value and silently drop `stderr`. Built inside `vi.hoisted` because
// `vi.mock`'s factory is hoisted above this file's own top-level code and
// can only see variables created the same way (Vitest's own constraint).
const { customExecFileImpl, execFileMock } = vi.hoisted(() => {
  const customExecFileImpl = vi.fn((_file: string, _args: readonly string[], _options: unknown) =>
    Promise.resolve({ stdout: "stdout", stderr: "stderr" }),
  );
  function execFileMock(): void {
    throw new Error("execFileSafely should always call the promisified (custom) form, not the raw callback form");
  }
  (execFileMock as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] =
    customExecFileImpl;
  return { customExecFileImpl, execFileMock };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("execFileSafely", () => {
  it("forwards file, args, and timeout to execFile, merging the shared safety options", async () => {
    const result = await execFileSafely("git", ["rev-parse", "HEAD"], { timeout: 30_000, cwd: "/repo" });

    expect(result).toEqual({ stdout: "stdout", stderr: "stderr" });
    expect(customExecFileImpl).toHaveBeenCalledTimes(1);
    const [file, args, options] = customExecFileImpl.mock.calls[0]!;
    expect(file).toBe("git");
    expect(args).toEqual(["rev-parse", "HEAD"]);
    expect(options).toMatchObject({
      timeout: 30_000,
      cwd: "/repo",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  });

  it("omits cwd from the underlying call when not provided (graphify's ExecFileFn has no cwd)", async () => {
    await execFileSafely("graphify", ["query", "algo"], { timeout: 15_000 });

    const [, , options] = customExecFileImpl.mock.calls.at(-1)!;
    expect((options as { cwd?: string }).cwd).toBeUndefined();
  });
});
