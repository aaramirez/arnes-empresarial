import { describe, expect, it } from "vitest";
import { DEFAULT_SESION_TTL_MINUTOS, MAX_SESION_TTL_MINUTOS, resolveAuthConfig } from "./auth-config.js";

/** Spec `autenticacion-empleado-tui`, requirement "Vigencia y expiración de la sesión por TTL absoluto" (ADR 31). */

describe("resolveAuthConfig", () => {
  it("SESION_TTL_MINUTOS ausente → default 30", () => {
    const resultado = resolveAuthConfig({});
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS } });
  });

  it("SESION_TTL_MINUTOS vacío → default 30", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "" });
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: 30 } });
  });

  it("SESION_TTL_MINUTOS='0' → 0 (sin expiración)", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "0" });
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: 0 } });
  });

  it("SESION_TTL_MINUTOS='45' → 45", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "45" });
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: 45 } });
  });

  it.each(["abc", "-1", "1.5"])("SESION_TTL_MINUTOS='%s' → ok:false con el nombre de la variable y el valor, sin lanzar", (raw) => {
    let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
    expect(() => {
      resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: raw });
    }).not.toThrow();

    expect(resultado?.ok).toBe(false);
    if (resultado && !resultado.ok) {
      expect(resultado.errores.join(" ")).toContain("SESION_TTL_MINUTOS");
      expect(resultado.errores.join(" ")).toContain(raw);
    }
  });

  it(`SESION_TTL_MINUTOS = tope exacto (${MAX_SESION_TTL_MINUTOS}) → ok:true`, () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: String(MAX_SESION_TTL_MINUTOS) });
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: MAX_SESION_TTL_MINUTOS } });
  });

  it("SESION_TTL_MINUTOS por encima del tope → ok:false sin lanzar, en vez de dejar que calcularExpiraEn reviente en tiempo de request con un RangeError de Date fuera de rango", () => {
    const raw = String(MAX_SESION_TTL_MINUTOS + 1);
    let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
    expect(() => {
      resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: raw });
    }).not.toThrow();

    expect(resultado?.ok).toBe(false);
    if (resultado && !resultado.ok) {
      expect(resultado.errores.join(" ")).toContain("SESION_TTL_MINUTOS");
      expect(resultado.errores.join(" ")).toContain(raw);
    }
  });

  it("SESION_TTL_MINUTOS astronómico (excede el rango válido de Date) → ok:false, nunca ok:true con un valor que rompería calcularExpiraEn", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "999999999999" });
    expect(resultado.ok).toBe(false);
  });
});
