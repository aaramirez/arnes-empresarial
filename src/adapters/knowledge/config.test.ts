import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET,
  DEFAULT_GRAPH_PATH,
  DEFAULT_GRAPHIFY_BIN,
  DEFAULT_QUERY_TIMEOUT_MS,
  resolveGraphifyConfig,
} from "./config.js";

describe("resolveGraphifyConfig", () => {
  it("returns all defaults for an empty env", () => {
    expect(resolveGraphifyConfig({})).toEqual({
      bin: DEFAULT_GRAPHIFY_BIN,
      graphPath: DEFAULT_GRAPH_PATH,
      budget: DEFAULT_BUDGET,
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
    });
  });

  it("overrides only bin from GRAPHIFY_BIN", () => {
    const config = resolveGraphifyConfig({ GRAPHIFY_BIN: "/usr/local/bin/graphify" });

    expect(config).toEqual({
      bin: "/usr/local/bin/graphify",
      graphPath: DEFAULT_GRAPH_PATH,
      budget: DEFAULT_BUDGET,
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
    });
  });

  it("overrides only graphPath from GRAPHIFY_GRAPH_PATH", () => {
    const config = resolveGraphifyConfig({ GRAPHIFY_GRAPH_PATH: "custom/graph.json" });

    expect(config).toEqual({
      bin: DEFAULT_GRAPHIFY_BIN,
      graphPath: "custom/graph.json",
      budget: DEFAULT_BUDGET,
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
    });
  });

  it("overrides only budget from GRAPHIFY_BUDGET", () => {
    const config = resolveGraphifyConfig({ GRAPHIFY_BUDGET: "500" });

    expect(config).toEqual({
      bin: DEFAULT_GRAPHIFY_BIN,
      graphPath: DEFAULT_GRAPH_PATH,
      budget: 500,
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
    });
  });

  it("overrides only queryTimeoutMs from GRAPHIFY_TIMEOUT_MS", () => {
    const config = resolveGraphifyConfig({ GRAPHIFY_TIMEOUT_MS: "30000" });

    expect(config).toEqual({
      bin: DEFAULT_GRAPHIFY_BIN,
      graphPath: DEFAULT_GRAPH_PATH,
      budget: DEFAULT_BUDGET,
      queryTimeoutMs: 30_000,
    });
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_BUDGET when GRAPHIFY_BUDGET is %s", (_label, value) => {
    const config = resolveGraphifyConfig({ GRAPHIFY_BUDGET: value });

    expect(config.budget).toBe(DEFAULT_BUDGET);
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_QUERY_TIMEOUT_MS when GRAPHIFY_TIMEOUT_MS is %s", (_label, value) => {
    const config = resolveGraphifyConfig({ GRAPHIFY_TIMEOUT_MS: value });

    expect(config.queryTimeoutMs).toBe(DEFAULT_QUERY_TIMEOUT_MS);
  });
});
