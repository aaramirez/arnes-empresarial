import { describe, expect, it } from "vitest";
import {
  DEFAULT_GIT_BIN,
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_WORKTREE_ROOT,
  DEFAULT_WORKTREE_TTL_MS,
  resolveGitConfig,
  resolveWorktreeConfig,
} from "./config.js";

describe("resolveGitConfig", () => {
  it("returns all defaults for an empty env", () => {
    expect(resolveGitConfig({})).toEqual({
      bin: DEFAULT_GIT_BIN,
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
    });
  });

  it("overrides only bin from HARNESS_GIT_BIN", () => {
    const config = resolveGitConfig({ HARNESS_GIT_BIN: "/usr/local/bin/git" });

    expect(config).toEqual({
      bin: "/usr/local/bin/git",
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
    });
  });

  it("overrides only timeoutMs from HARNESS_GIT_TIMEOUT_MS", () => {
    const config = resolveGitConfig({ HARNESS_GIT_TIMEOUT_MS: "60000" });

    expect(config).toEqual({
      bin: DEFAULT_GIT_BIN,
      timeoutMs: 60_000,
    });
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_GIT_TIMEOUT_MS when HARNESS_GIT_TIMEOUT_MS is %s", (_label, value) => {
    const config = resolveGitConfig({ HARNESS_GIT_TIMEOUT_MS: value });

    expect(config.timeoutMs).toBe(DEFAULT_GIT_TIMEOUT_MS);
  });

  it("never throws with an invalid env", () => {
    expect(() =>
      resolveGitConfig({ HARNESS_GIT_TIMEOUT_MS: "not-a-number" }),
    ).not.toThrow();
  });
});

describe("resolveWorktreeConfig", () => {
  it("returns all defaults for an empty env", () => {
    expect(resolveWorktreeConfig({})).toEqual({
      worktreeRoot: DEFAULT_WORKTREE_ROOT,
      ttlMs: DEFAULT_WORKTREE_TTL_MS,
    });
  });

  it("overrides only worktreeRoot from HARNESS_WORKTREE_ROOT", () => {
    const config = resolveWorktreeConfig({ HARNESS_WORKTREE_ROOT: "tmp/worktrees" });

    expect(config).toEqual({
      worktreeRoot: "tmp/worktrees",
      ttlMs: DEFAULT_WORKTREE_TTL_MS,
    });
  });

  it("overrides only ttlMs from HARNESS_WORKTREE_TTL_MS", () => {
    const config = resolveWorktreeConfig({ HARNESS_WORKTREE_TTL_MS: "3600000" });

    expect(config).toEqual({
      worktreeRoot: DEFAULT_WORKTREE_ROOT,
      ttlMs: 3_600_000,
    });
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_WORKTREE_TTL_MS when HARNESS_WORKTREE_TTL_MS is %s", (_label, value) => {
    const config = resolveWorktreeConfig({ HARNESS_WORKTREE_TTL_MS: value });

    expect(config.ttlMs).toBe(DEFAULT_WORKTREE_TTL_MS);
  });

  it("never throws with an invalid env", () => {
    expect(() =>
      resolveWorktreeConfig({ HARNESS_WORKTREE_TTL_MS: "not-a-number" }),
    ).not.toThrow();
  });
});
