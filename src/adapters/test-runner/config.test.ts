import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_TIMEOUT_MS,
  TEST_MCP_TIMEOUT_MARGIN_MS,
  resolveTestRunnerConfig,
} from "./config.js";

const REPO_ROOT = resolve("/repo");

describe("resolveTestRunnerConfig", () => {
  it("returns all defaults for an empty env", () => {
    expect(resolveTestRunnerConfig(REPO_ROOT, {})).toEqual({
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      vitestEntrypoint: resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
    });
  });

  it("defaults timeoutMs to 300_000", () => {
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(300_000);
  });

  it("resolves vitestEntrypoint against the given repoRoot, ignoring env", () => {
    const config = resolveTestRunnerConfig(REPO_ROOT, {
      HARNESS_WORKTREE_TEST_TIMEOUT_MS: "60000",
    });

    expect(config.vitestEntrypoint).toBe(resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs"));
  });

  it("recomputes vitestEntrypoint for a different repoRoot", () => {
    const otherRoot = resolve("/otro/repo");
    const config = resolveTestRunnerConfig(otherRoot, {});

    expect(config.vitestEntrypoint).toBe(resolve(otherRoot, "node_modules/vitest/vitest.mjs"));
  });

  it("overrides only timeoutMs from HARNESS_WORKTREE_TEST_TIMEOUT_MS", () => {
    const config = resolveTestRunnerConfig(REPO_ROOT, { HARNESS_WORKTREE_TEST_TIMEOUT_MS: "60000" });

    expect(config).toEqual({
      timeoutMs: 60_000,
      vitestEntrypoint: resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
    });
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["Infinity", "Infinity"],
    ["overflow that parses to Infinity", "1e400"],
  ])(
    "falls back to DEFAULT_TEST_TIMEOUT_MS when HARNESS_WORKTREE_TEST_TIMEOUT_MS is %s",
    (_label, value) => {
      const config = resolveTestRunnerConfig(REPO_ROOT, { HARNESS_WORKTREE_TEST_TIMEOUT_MS: value });

      expect(config.timeoutMs).toBe(DEFAULT_TEST_TIMEOUT_MS);
    },
  );

  it("never throws with an invalid env", () => {
    expect(() =>
      resolveTestRunnerConfig(REPO_ROOT, { HARNESS_WORKTREE_TEST_TIMEOUT_MS: "not-a-number" }),
    ).not.toThrow();
  });
});

describe("TEST_MCP_TIMEOUT_MARGIN_MS", () => {
  it("mirrors MCP_TIMEOUT_MARGIN_MS at 5_000", () => {
    expect(TEST_MCP_TIMEOUT_MARGIN_MS).toBe(5_000);
  });
});
