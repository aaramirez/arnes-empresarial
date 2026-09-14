import { describe, expect, it } from "vitest";
import {
  CONVERSACION_INACTIVIDAD_MS,
  CONVERSACION_MAX_TURNOS,
  DEFAULT_WEB_MAX_BODY_BYTES,
  DEFAULT_WEB_PUBLIC_URL,
  isWebEnabled,
  OPERACIONES_TIMEOUT_MS,
  resolveWebConfig,
  RUTA_LOGIN,
  RUTA_OPERACIONES,
  SOPORTE_TIMEOUT_MS,
} from "./config.js";

describe("CONVERSACION_INACTIVIDAD_MS / CONVERSACION_MAX_TURNOS (ADR 197)", () => {
  it("son los techos exactos de rotación perezosa de la conversación", () => {
    expect(CONVERSACION_INACTIVIDAD_MS).toBe(30 * 60_000);
    expect(CONVERSACION_MAX_TURNOS).toBe(40);
  });
});

describe("resolveWebConfig", () => {
  it("returns all defaults for an empty env, with the listener disabled", () => {
    expect(resolveWebConfig({})).toEqual({
      port: 0,
      publicUrl: DEFAULT_WEB_PUBLIC_URL,
      ventasApiToken: "",
      maxBodyBytes: DEFAULT_WEB_MAX_BODY_BYTES,
    });
  });

  it("overrides only port from a valid WEB_PORT", () => {
    const config = resolveWebConfig({ WEB_PORT: "3000" });

    expect(config).toEqual({
      port: 3000,
      publicUrl: DEFAULT_WEB_PUBLIC_URL,
      ventasApiToken: "",
      maxBodyBytes: DEFAULT_WEB_MAX_BODY_BYTES,
    });
  });

  it("overrides only publicUrl from WEB_PUBLIC_URL", () => {
    const config = resolveWebConfig({ WEB_PUBLIC_URL: "https://example.com" });

    expect(config).toEqual({
      port: 0,
      publicUrl: "https://example.com",
      ventasApiToken: "",
      maxBodyBytes: DEFAULT_WEB_MAX_BODY_BYTES,
    });
  });

  it("overrides only ventasApiToken from VENTAS_API_TOKEN", () => {
    const config = resolveWebConfig({ VENTAS_API_TOKEN: "t0k3n" });

    expect(config).toEqual({
      port: 0,
      publicUrl: DEFAULT_WEB_PUBLIC_URL,
      ventasApiToken: "t0k3n",
      maxBodyBytes: DEFAULT_WEB_MAX_BODY_BYTES,
    });
  });

  it("overrides only maxBodyBytes from WEB_MAX_BODY_BYTES", () => {
    const config = resolveWebConfig({ WEB_MAX_BODY_BYTES: "131072" });

    expect(config).toEqual({
      port: 0,
      publicUrl: DEFAULT_WEB_PUBLIC_URL,
      ventasApiToken: "",
      maxBodyBytes: 131_072,
    });
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to 0 (disabled) when WEB_PORT is %s, unlike WEBHOOK_PORT's positive default", (_label, value) => {
    const config = resolveWebConfig(value === undefined ? {} : { WEB_PORT: value });

    expect(config.port).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to DEFAULT_WEB_MAX_BODY_BYTES when WEB_MAX_BODY_BYTES is %s", (_label, value) => {
    const config = resolveWebConfig(value === undefined ? {} : { WEB_MAX_BODY_BYTES: value });

    expect(config.maxBodyBytes).toBe(DEFAULT_WEB_MAX_BODY_BYTES);
  });

  it("normalizes a publicUrl with a trailing slash", () => {
    const config = resolveWebConfig({ WEB_PUBLIC_URL: "https://example.com/" });

    expect(config.publicUrl).toBe("https://example.com");
  });

  it("does not throw when env values are malformed", () => {
    expect(() =>
      resolveWebConfig({
        WEB_PORT: "not-a-port",
        WEB_MAX_BODY_BYTES: "not-a-size",
        WEB_PUBLIC_URL: "",
      }),
    ).not.toThrow();
  });
});

describe("isWebEnabled", () => {
  it("returns false when port is 0", () => {
    expect(isWebEnabled(resolveWebConfig({}))).toBe(false);
  });

  it("returns false when WEB_PORT resolves to a fallback of 0", () => {
    expect(isWebEnabled(resolveWebConfig({ WEB_PORT: "-1" }))).toBe(false);
  });

  it("returns true when port is a positive value", () => {
    expect(isWebEnabled(resolveWebConfig({ WEB_PORT: "8080" }))).toBe(true);
  });
});

describe("rutas y timeout de operaciones-negocio-conversacionales (tarea 9)", () => {
  it("RUTA_LOGIN y RUTA_OPERACIONES son rutas nuevas, distintas de las existentes", () => {
    expect(RUTA_LOGIN).toBe("/login");
    expect(RUTA_OPERACIONES).toBe("/operaciones");
  });

  it("OPERACIONES_TIMEOUT_MS es independiente de SOPORTE_TIMEOUT_MS (turnos distintos)", () => {
    expect(OPERACIONES_TIMEOUT_MS).toBe(SOPORTE_TIMEOUT_MS);
    // Mismo valor hoy, constantes DISTINTAS a propósito (ADR 173 pto 3):
    // tunearlas por separado no debe requerir tocar la otra.
  });
});
