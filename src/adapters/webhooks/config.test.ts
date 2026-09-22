import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WEBHOOK_PORT,
  isWebhookEnabled,
  resolveWebhookConfig,
} from "./config.js";

describe("resolveWebhookConfig", () => {
  it("returns all defaults for an empty env, with secret disabled", () => {
    expect(resolveWebhookConfig({})).toEqual({
      secret: "",
      port: DEFAULT_WEBHOOK_PORT,
      path: DEFAULT_WEBHOOK_PATH,
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it("overrides only secret from GITHUB_WEBHOOK_SECRET", () => {
    const config = resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "s3cr3t" });

    expect(config).toEqual({
      secret: "s3cr3t",
      port: DEFAULT_WEBHOOK_PORT,
      path: DEFAULT_WEBHOOK_PATH,
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it("overrides only port from WEBHOOK_PORT", () => {
    const config = resolveWebhookConfig({ WEBHOOK_PORT: "3000" });

    expect(config).toEqual({
      secret: "",
      port: 3000,
      path: DEFAULT_WEBHOOK_PATH,
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it("overrides only path from WEBHOOK_PATH", () => {
    const config = resolveWebhookConfig({ WEBHOOK_PATH: "/hooks/gh" });

    expect(config).toEqual({
      secret: "",
      port: DEFAULT_WEBHOOK_PORT,
      path: "/hooks/gh",
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it("overrides only maxBodyBytes from WEBHOOK_MAX_BODY_BYTES", () => {
    const config = resolveWebhookConfig({ WEBHOOK_MAX_BODY_BYTES: "2097152" });

    expect(config).toEqual({
      secret: "",
      port: DEFAULT_WEBHOOK_PORT,
      path: DEFAULT_WEBHOOK_PATH,
      maxBodyBytes: 2_097_152,
    });
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_WEBHOOK_PORT when WEBHOOK_PORT is %s", (_label, value) => {
    const config = resolveWebhookConfig(
      value === undefined ? {} : { WEBHOOK_PORT: value },
    );

    expect(config.port).toBe(DEFAULT_WEBHOOK_PORT);
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_MAX_BODY_BYTES when WEBHOOK_MAX_BODY_BYTES is %s", (_label, value) => {
    const config = resolveWebhookConfig(
      value === undefined ? {} : { WEBHOOK_MAX_BODY_BYTES: value },
    );

    expect(config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it("normalizes a path without a leading slash", () => {
    const config = resolveWebhookConfig({ WEBHOOK_PATH: "hooks/gh" });

    expect(config.path).toBe("/hooks/gh");
  });

  it("does not throw when env values are malformed", () => {
    expect(() =>
      resolveWebhookConfig({
        WEBHOOK_PORT: "not-a-port",
        WEBHOOK_MAX_BODY_BYTES: "not-a-size",
        WEBHOOK_PATH: "",
      }),
    ).not.toThrow();
  });
});

describe("resolveWebhookConfig — WEBHOOK_HOST (modo-headless-cierre-limpio, tarea 4.3, E2, R21)", () => {
  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["blank (spaces only)", "   "],
  ])("omits the host KEY (never host: undefined) when WEBHOOK_HOST is %s", (_label, value) => {
    const config = resolveWebhookConfig({
      GITHUB_WEBHOOK_SECRET: "s3cr3t",
      ...(value === undefined ? {} : { WEBHOOK_HOST: value }),
    });

    expect("host" in config).toBe(false);
    expect(Object.keys(config)).not.toContain("host");
  });

  it.each(["127.0.0.1", "::1", "0.0.0.0"])(
    "passes WEBHOOK_HOST=%s through as host, exactly as configured",
    (host) => {
      const config = resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "s3cr3t", WEBHOOK_HOST: host });

      expect(config.host).toBe(host);
    },
  );

  it("trims incidental blanks around a non-blank WEBHOOK_HOST", () => {
    const config = resolveWebhookConfig({ WEBHOOK_HOST: "  127.0.0.1  " });

    expect(config.host).toBe("127.0.0.1");
  });

  it("does not alter port, path nor the GITHUB_WEBHOOK_SECRET switch (WEBHOOK_HOST alone never enables the listener)", () => {
    const soloHost = resolveWebhookConfig({ WEBHOOK_HOST: "127.0.0.1" });
    const conSecreto = resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "s3cr3t", WEBHOOK_HOST: "127.0.0.1" });

    expect(soloHost.port).toBe(DEFAULT_WEBHOOK_PORT);
    expect(soloHost.path).toBe(DEFAULT_WEBHOOK_PATH);
    expect(isWebhookEnabled(soloHost)).toBe(false);
    expect(conSecreto.port).toBe(DEFAULT_WEBHOOK_PORT);
    expect(isWebhookEnabled(conSecreto)).toBe(true);
  });
});

describe("isWebhookEnabled", () => {
  it("returns false when secret is empty", () => {
    expect(isWebhookEnabled(resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "" }))).toBe(false);
  });

  it("returns false when secret is only whitespace", () => {
    expect(isWebhookEnabled(resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "   " }))).toBe(false);
  });

  it("returns true when secret is a non-blank value", () => {
    expect(isWebhookEnabled(resolveWebhookConfig({ GITHUB_WEBHOOK_SECRET: "s3cr3t" }))).toBe(true);
  });
});
