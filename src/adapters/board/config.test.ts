import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_TIMEOUT_MS,
  DEFAULT_BOARD_USER_AGENT,
  DEFAULT_GITHUB_API_BASE_URL,
  MAX_CHANGED_FILES,
  MAX_COMMENT_CHARS,
  isBoardEnabled,
  resolveBoardConfig,
} from "./config.js";

describe("resolveBoardConfig", () => {
  it("returns all defaults for an empty env, with token disabled", () => {
    expect(resolveBoardConfig({})).toEqual({
      token: "",
      apiBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
      requestTimeoutMs: DEFAULT_BOARD_TIMEOUT_MS,
      userAgent: DEFAULT_BOARD_USER_AGENT,
    });
  });

  it("overrides only token from GITHUB_TOKEN", () => {
    const config = resolveBoardConfig({ GITHUB_TOKEN: "gh_t0k3n" });

    expect(config).toEqual({
      token: "gh_t0k3n",
      apiBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
      requestTimeoutMs: DEFAULT_BOARD_TIMEOUT_MS,
      userAgent: DEFAULT_BOARD_USER_AGENT,
    });
  });

  it("overrides only apiBaseUrl from GITHUB_API_BASE_URL", () => {
    const config = resolveBoardConfig({
      GITHUB_API_BASE_URL: "https://ghe.example.com/api/v3",
    });

    expect(config).toEqual({
      token: "",
      apiBaseUrl: "https://ghe.example.com/api/v3",
      requestTimeoutMs: DEFAULT_BOARD_TIMEOUT_MS,
      userAgent: DEFAULT_BOARD_USER_AGENT,
    });
  });

  it("overrides only requestTimeoutMs from BOARD_TIMEOUT_MS", () => {
    const config = resolveBoardConfig({ BOARD_TIMEOUT_MS: "20000" });

    expect(config).toEqual({
      token: "",
      apiBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
      requestTimeoutMs: 20_000,
      userAgent: DEFAULT_BOARD_USER_AGENT,
    });
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_BOARD_TIMEOUT_MS when BOARD_TIMEOUT_MS is %s", (_label, value) => {
    const config = resolveBoardConfig(
      value === undefined ? {} : { BOARD_TIMEOUT_MS: value },
    );

    expect(config.requestTimeoutMs).toBe(DEFAULT_BOARD_TIMEOUT_MS);
  });

  it("does not throw when env values are malformed", () => {
    expect(() =>
      resolveBoardConfig({
        BOARD_TIMEOUT_MS: "not-a-timeout",
      }),
    ).not.toThrow();
  });

  it("never overrides userAgent from any env var (not configurable)", () => {
    const config = resolveBoardConfig({
      GITHUB_USER_AGENT: "some-custom-agent",
      USER_AGENT: "another-custom-agent",
      GITHUB_TOKEN: "gh_t0k3n",
      GITHUB_API_BASE_URL: "https://ghe.example.com/api/v3",
      BOARD_TIMEOUT_MS: "20000",
    });

    expect(config.userAgent).toBe(DEFAULT_BOARD_USER_AGENT);
  });
});

describe("isBoardEnabled", () => {
  it("returns false when token is empty", () => {
    expect(isBoardEnabled(resolveBoardConfig({ GITHUB_TOKEN: "" }))).toBe(false);
  });

  it("returns false when token is only whitespace", () => {
    expect(isBoardEnabled(resolveBoardConfig({ GITHUB_TOKEN: "   " }))).toBe(false);
  });

  it("returns true when token is a non-blank value", () => {
    expect(isBoardEnabled(resolveBoardConfig({ GITHUB_TOKEN: "gh_t0k3n" }))).toBe(true);
  });
});

describe("module constants", () => {
  it("exposes the expected values for MAX_CHANGED_FILES and MAX_COMMENT_CHARS", () => {
    expect(MAX_CHANGED_FILES).toBe(50);
    expect(MAX_COMMENT_CHARS).toBe(60_000);
  });
});
