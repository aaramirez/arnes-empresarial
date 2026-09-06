import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_API_URL,
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_TIMEOUT_MS,
  isNotificacionesEnabled,
  resolveNotificacionesConfig,
} from "./config.js";

describe("resolveNotificacionesConfig", () => {
  it("returns all defaults for an empty env, with apiKey disabled", () => {
    expect(resolveNotificacionesConfig({})).toEqual({
      apiKey: "",
      from: DEFAULT_EMAIL_FROM,
      apiUrl: DEFAULT_EMAIL_API_URL,
      requestTimeoutMs: DEFAULT_EMAIL_TIMEOUT_MS,
    });
  });

  it("overrides only apiKey from EMAIL_API_KEY", () => {
    const config = resolveNotificacionesConfig({ EMAIL_API_KEY: "re_t0k3n" });

    expect(config).toEqual({
      apiKey: "re_t0k3n",
      from: DEFAULT_EMAIL_FROM,
      apiUrl: DEFAULT_EMAIL_API_URL,
      requestTimeoutMs: DEFAULT_EMAIL_TIMEOUT_MS,
    });
  });

  it("overrides only from from EMAIL_FROM", () => {
    const config = resolveNotificacionesConfig({ EMAIL_FROM: "ventas@example.com" });

    expect(config).toEqual({
      apiKey: "",
      from: "ventas@example.com",
      apiUrl: DEFAULT_EMAIL_API_URL,
      requestTimeoutMs: DEFAULT_EMAIL_TIMEOUT_MS,
    });
  });

  it("overrides only apiUrl from EMAIL_API_URL", () => {
    const config = resolveNotificacionesConfig({
      EMAIL_API_URL: "https://email.example.com/send",
    });

    expect(config).toEqual({
      apiKey: "",
      from: DEFAULT_EMAIL_FROM,
      apiUrl: "https://email.example.com/send",
      requestTimeoutMs: DEFAULT_EMAIL_TIMEOUT_MS,
    });
  });

  it("overrides only requestTimeoutMs from EMAIL_TIMEOUT_MS", () => {
    const config = resolveNotificacionesConfig({ EMAIL_TIMEOUT_MS: "20000" });

    expect(config).toEqual({
      apiKey: "",
      from: DEFAULT_EMAIL_FROM,
      apiUrl: DEFAULT_EMAIL_API_URL,
      requestTimeoutMs: 20_000,
    });
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_EMAIL_TIMEOUT_MS when EMAIL_TIMEOUT_MS is %s", (_label, value) => {
    const config = resolveNotificacionesConfig(
      value === undefined ? {} : { EMAIL_TIMEOUT_MS: value },
    );

    expect(config.requestTimeoutMs).toBe(DEFAULT_EMAIL_TIMEOUT_MS);
  });

  it("does not throw when env values are malformed", () => {
    expect(() =>
      resolveNotificacionesConfig({
        EMAIL_TIMEOUT_MS: "not-a-timeout",
      }),
    ).not.toThrow();
  });
});

describe("isNotificacionesEnabled", () => {
  it("returns false when apiKey is empty", () => {
    expect(isNotificacionesEnabled(resolveNotificacionesConfig({ EMAIL_API_KEY: "" }))).toBe(
      false,
    );
  });

  it("returns false when apiKey is only whitespace", () => {
    expect(isNotificacionesEnabled(resolveNotificacionesConfig({ EMAIL_API_KEY: "   " }))).toBe(
      false,
    );
  });

  it("returns true when apiKey is a non-blank value", () => {
    expect(
      isNotificacionesEnabled(resolveNotificacionesConfig({ EMAIL_API_KEY: "re_t0k3n" })),
    ).toBe(true);
  });
});
