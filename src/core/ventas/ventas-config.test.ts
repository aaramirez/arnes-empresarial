import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMISION_PORCENTAJE,
  DEFAULT_REEMBOLSO_UMBRAL,
  DEFAULT_VENTA_GRANDE_UMBRAL,
  DEFAULT_VENTA_TOKEN_TTL_HORAS,
  MAX_VENTA_TOKEN_TTL_HORAS,
  resolveVentasConfig,
} from "./ventas-config.js";

describe("resolveVentasConfig — defaults", () => {
  it("resuelve los 3 defaults con env vacío", () => {
    const result = resolveVentasConfig({});

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: DEFAULT_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
    expect(DEFAULT_COMISION_PORCENTAJE).toBe(0.1);
    expect(DEFAULT_REEMBOLSO_UMBRAL).toBe(500);
    expect(DEFAULT_VENTA_TOKEN_TTL_HORAS).toBe(72);
    expect(DEFAULT_VENTA_GRANDE_UMBRAL).toBe(5_000);
  });

  it("cadena vacía se trata igual que ausente — cae al default, no es error", () => {
    const result = resolveVentasConfig({
      COMISION_PORCENTAJE: "",
      REEMBOLSO_UMBRAL: "",
      VENTA_TOKEN_TTL_HORAS: "",
      VENTA_GRANDE_UMBRAL: "",
    });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: DEFAULT_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
  });
});

describe("resolveVentasConfig — COMISION_PORCENTAJE", () => {
  it.each([
    ["cero", "0"],
    ["fuera de rango por arriba", "1.5"],
    ["no numérico", "abc"],
  ])("%s → ok:false", (_label, value) => {
    const result = resolveVentasConfig({ COMISION_PORCENTAJE: value });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0]).toContain("COMISION_PORCENTAJE");
      expect(result.errores[0]).toContain(value);
    }
  });

  it("1 exacto es válido — el límite superior es inclusivo", () => {
    const result = resolveVentasConfig({ COMISION_PORCENTAJE: "1" });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: 1,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: DEFAULT_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
  });

  it("negativo también es inválido", () => {
    const result = resolveVentasConfig({ COMISION_PORCENTAJE: "-0.1" });

    expect(result.ok).toBe(false);
  });
});

describe("resolveVentasConfig — REEMBOLSO_UMBRAL", () => {
  it("acepta un valor positivo válido", () => {
    const result = resolveVentasConfig({ REEMBOLSO_UMBRAL: "750" });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: 750,
        tokenTtlHoras: DEFAULT_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
  });

  it.each([
    ["cero", "0"],
    ["negativo", "-1"],
    ["no numérico", "no-es-numero"],
  ])("%s → ok:false", (_label, value) => {
    const result = resolveVentasConfig({ REEMBOLSO_UMBRAL: value });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0]).toContain("REEMBOLSO_UMBRAL");
      expect(result.errores[0]).toContain(value);
    }
  });
});

describe("resolveVentasConfig — VENTA_TOKEN_TTL_HORAS", () => {
  it("0 es válido — significa sin vencimiento", () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: "0" });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: 0,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
  });

  it("-1 es inválido", () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: "-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0]).toContain("VENTA_TOKEN_TTL_HORAS");
      expect(result.errores[0]).toContain("-1");
    }
  });

  it("no numérico es inválido", () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: "abc" });

    expect(result.ok).toBe(false);
  });

  it("valor decimal (no entero) es inválido", () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: "1.5" });

    expect(result.ok).toBe(false);
  });

  it(`tope exacto (${MAX_VENTA_TOKEN_TTL_HORAS}) → ok:true`, () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: String(MAX_VENTA_TOKEN_TTL_HORAS) });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: MAX_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: DEFAULT_VENTA_GRANDE_UMBRAL,
      },
    });
  });

  it("por encima del tope → ok:false sin lanzar, en vez de dejar que calcularExpiresAt reviente en tiempo de request con un RangeError de Date fuera de rango (Reviewer finding: mismo bug que SESION_TTL_MINUTOS ya tenía tapado)", () => {
    const raw = String(MAX_VENTA_TOKEN_TTL_HORAS + 1);
    let resultado: ReturnType<typeof resolveVentasConfig> | undefined;

    expect(() => {
      resultado = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: raw });
    }).not.toThrow();

    expect(resultado?.ok).toBe(false);
    if (resultado && !resultado.ok) {
      expect(resultado.errores.join(" ")).toContain("VENTA_TOKEN_TTL_HORAS");
      expect(resultado.errores.join(" ")).toContain(raw);
    }
  });

  it("astronómico (excede el rango válido de Date) → ok:false, nunca ok:true con un valor que rompería calcularExpiresAt", () => {
    const result = resolveVentasConfig({ VENTA_TOKEN_TTL_HORAS: "999999999999" });

    expect(result.ok).toBe(false);
  });
});

describe("resolveVentasConfig — VENTA_GRANDE_UMBRAL", () => {
  it("acepta un valor positivo válido", () => {
    const result = resolveVentasConfig({ VENTA_GRANDE_UMBRAL: "10000" });

    expect(result).toEqual({
      ok: true,
      config: {
        comisionPorcentaje: DEFAULT_COMISION_PORCENTAJE,
        reembolsoUmbral: DEFAULT_REEMBOLSO_UMBRAL,
        tokenTtlHoras: DEFAULT_VENTA_TOKEN_TTL_HORAS,
        ventaGrandeUmbral: 10_000,
      },
    });
  });

  it("ausente ⇒ cae al default (5000)", () => {
    const result = resolveVentasConfig({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.ventaGrandeUmbral).toBe(DEFAULT_VENTA_GRANDE_UMBRAL);
    }
  });

  it.each([
    ["cero", "0"],
    ["negativo", "-5"],
    ["no numérico", "abc"],
  ])("%s → ok:false", (_label, value) => {
    const result = resolveVentasConfig({ VENTA_GRANDE_UMBRAL: value });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0]).toContain("VENTA_GRANDE_UMBRAL");
      expect(result.errores[0]).toContain(value);
    }
  });
});

describe("resolveVentasConfig — acumulación de errores", () => {
  it("dos variables inválidas a la vez devuelven DOS errores en el mismo array", () => {
    const result = resolveVentasConfig({
      COMISION_PORCENTAJE: "abc",
      REEMBOLSO_UMBRAL: "-5",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(2);
      expect(result.errores.some((e) => e.includes("COMISION_PORCENTAJE"))).toBe(true);
      expect(result.errores.some((e) => e.includes("REEMBOLSO_UMBRAL"))).toBe(true);
    }
  });

  it("las 3 variables inválidas a la vez devuelven TRES errores", () => {
    const result = resolveVentasConfig({
      COMISION_PORCENTAJE: "2",
      REEMBOLSO_UMBRAL: "0",
      VENTA_TOKEN_TTL_HORAS: "-3",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(3);
    }
  });

  it("VENTA_GRANDE_UMBRAL inválido junto a REEMBOLSO_UMBRAL inválido acumula AMBOS errores", () => {
    const result = resolveVentasConfig({
      VENTA_GRANDE_UMBRAL: "-1",
      REEMBOLSO_UMBRAL: "0",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errores).toHaveLength(2);
      expect(result.errores.some((e) => e.includes("VENTA_GRANDE_UMBRAL"))).toBe(true);
      expect(result.errores.some((e) => e.includes("REEMBOLSO_UMBRAL"))).toBe(true);
    }
  });
});

describe("ventas-config.ts source — ADR 17a", () => {
  it("no importa env.js ni tiene process.env como parámetro por default", () => {
    const sourcePath = fileURLToPath(new URL("./ventas-config.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    // Descarta comentarios de bloque y de línea antes de inspeccionar código
    // real: la documentación del módulo cita `env.js`/`process.env` a
    // propósito para explicar por qué NO se usan (ADR 17a).
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(codeOnly).not.toMatch(/^import\b.*env\.js/m);
    expect(codeOnly).not.toMatch(/process\.env/);
  });
});
