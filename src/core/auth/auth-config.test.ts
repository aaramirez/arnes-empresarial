import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESION_INACTIVIDAD_MINUTOS,
  DEFAULT_SESION_TTL_MINUTOS,
  MAX_SESION_TTL_MINUTOS,
  resolveAuthConfig,
} from "./auth-config.js";

/**
 * Spec `autenticacion-empleado-tui`, requirement "Vigencia y expiración de la sesión por TTL
 * absoluto" (ADR 31) y, desde `devolucion-sin-token-dos-personas` (ADR 231), "Vigencia y
 * expiración de la sesión por INACTIVIDAD, con TOPE ABSOLUTO".
 */

describe("resolveAuthConfig", () => {
  it("las dos variables ausentes → defaults (480 absoluto, 30 inactividad), sin lanzar", () => {
    const resultado = resolveAuthConfig({});
    expect(resultado).toEqual({
      ok: true,
      config: {
        sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS,
        sesionInactividadMinutos: DEFAULT_SESION_INACTIVIDAD_MINUTOS,
      },
    });
    expect(DEFAULT_SESION_TTL_MINUTOS).toBe(480);
    expect(DEFAULT_SESION_INACTIVIDAD_MINUTOS).toBe(30);
  });

  it("SESION_TTL_MINUTOS vacío → default 480, significado intacto (tope absoluto)", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "" });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: 480, sesionInactividadMinutos: DEFAULT_SESION_INACTIVIDAD_MINUTOS },
    });
  });

  it("SESION_TTL_MINUTOS='0' → 0 (sin expiración absoluta), independiente de la inactividad", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "0" });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: 0, sesionInactividadMinutos: DEFAULT_SESION_INACTIVIDAD_MINUTOS },
    });
  });

  it("SESION_INACTIVIDAD_MINUTOS='0' → 0 (sin expiración por inactividad), independiente del tope absoluto", () => {
    const resultado = resolveAuthConfig({ SESION_INACTIVIDAD_MINUTOS: "0" });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS, sesionInactividadMinutos: 0 },
    });
  });

  it("las dos en '0' → las dos sin expiración, cada una por su cuenta", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "0", SESION_INACTIVIDAD_MINUTOS: "0" });
    expect(resultado).toEqual({ ok: true, config: { sesionTtlMinutos: 0, sesionInactividadMinutos: 0 } });
  });

  it("SESION_TTL_MINUTOS='45' → 45", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "45" });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: 45, sesionInactividadMinutos: DEFAULT_SESION_INACTIVIDAD_MINUTOS },
    });
  });

  it("SESION_INACTIVIDAD_MINUTOS='15' → 15", () => {
    const resultado = resolveAuthConfig({ SESION_INACTIVIDAD_MINUTOS: "15" });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS, sesionInactividadMinutos: 15 },
    });
  });

  it.each(["abc", "-1", "1.5"])(
    "SESION_TTL_MINUTOS='%s' → ok:false con el nombre de la variable y el valor, sin lanzar",
    (raw) => {
      let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
      expect(() => {
        resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: raw });
      }).not.toThrow();

      expect(resultado?.ok).toBe(false);
      if (resultado && !resultado.ok) {
        expect(resultado.errores.join(" ")).toContain("SESION_TTL_MINUTOS");
        expect(resultado.errores.join(" ")).toContain(raw);
      }
    },
  );

  it.each(["abc", "-1", "1.5"])(
    "SESION_INACTIVIDAD_MINUTOS='%s' → ok:false con el nombre de la variable y el valor, sin lanzar",
    (raw) => {
      let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
      expect(() => {
        resultado = resolveAuthConfig({ SESION_INACTIVIDAD_MINUTOS: raw });
      }).not.toThrow();

      expect(resultado?.ok).toBe(false);
      if (resultado && !resultado.ok) {
        expect(resultado.errores.join(" ")).toContain("SESION_INACTIVIDAD_MINUTOS");
        expect(resultado.errores.join(" ")).toContain(raw);
      }
    },
  );

  it("las dos variables inválidas a la vez → error ACUMULADO de las dos, sin lanzar", () => {
    let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
    expect(() => {
      resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "abc", SESION_INACTIVIDAD_MINUTOS: "xyz" });
    }).not.toThrow();

    expect(resultado?.ok).toBe(false);
    if (resultado && !resultado.ok) {
      expect(resultado.errores.join(" ")).toContain("SESION_TTL_MINUTOS");
      expect(resultado.errores.join(" ")).toContain("SESION_INACTIVIDAD_MINUTOS");
    }
  });

  it(`SESION_TTL_MINUTOS = tope exacto (${MAX_SESION_TTL_MINUTOS}) → ok:true`, () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: String(MAX_SESION_TTL_MINUTOS) });
    expect(resultado).toEqual({
      ok: true,
      config: {
        sesionTtlMinutos: MAX_SESION_TTL_MINUTOS,
        sesionInactividadMinutos: DEFAULT_SESION_INACTIVIDAD_MINUTOS,
      },
    });
  });

  it(`SESION_INACTIVIDAD_MINUTOS = tope exacto (${MAX_SESION_TTL_MINUTOS}) → ok:true (mismo techo, RD-111)`, () => {
    const resultado = resolveAuthConfig({ SESION_INACTIVIDAD_MINUTOS: String(MAX_SESION_TTL_MINUTOS) });
    expect(resultado).toEqual({
      ok: true,
      config: { sesionTtlMinutos: DEFAULT_SESION_TTL_MINUTOS, sesionInactividadMinutos: MAX_SESION_TTL_MINUTOS },
    });
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

  it("SESION_INACTIVIDAD_MINUTOS por encima del tope → ok:false sin lanzar", () => {
    const raw = String(MAX_SESION_TTL_MINUTOS + 1);
    let resultado: ReturnType<typeof resolveAuthConfig> | undefined;
    expect(() => {
      resultado = resolveAuthConfig({ SESION_INACTIVIDAD_MINUTOS: raw });
    }).not.toThrow();

    expect(resultado?.ok).toBe(false);
    if (resultado && !resultado.ok) {
      expect(resultado.errores.join(" ")).toContain("SESION_INACTIVIDAD_MINUTOS");
      expect(resultado.errores.join(" ")).toContain(raw);
    }
  });

  it("SESION_TTL_MINUTOS astronómico (excede el rango válido de Date) → ok:false, nunca ok:true con un valor que rompería calcularExpiraEn", () => {
    const resultado = resolveAuthConfig({ SESION_TTL_MINUTOS: "999999999999" });
    expect(resultado.ok).toBe(false);
  });
});
