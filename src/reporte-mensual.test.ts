import { describe, expect, it } from "vitest";
import { parsePeriodo } from "./reporte-mensual.js";

describe("parsePeriodo", () => {
  it("sin --periodo → usa el mes corriente inyectado por now()", () => {
    const result = parsePeriodo([], () => "2026-09-05T12:00:00.000Z");

    expect(result).toEqual({ ok: true, periodo: "2026-09" });
  });

  it("--periodo 2026-02 válido → ok:true con ese periodo", () => {
    const result = parsePeriodo(["--periodo", "2026-02"], () => "2026-09-05T12:00:00.000Z");

    expect(result).toEqual({ ok: true, periodo: "2026-02" });
  });

  it.each([
    ["mes fuera de rango (13)", "2026-13"],
    ["no numérico", "febrero"],
    ["sin mes", "2026"],
  ])("--periodo con formato inválido (%s) → ok:false con mensaje de uso", (_label, value) => {
    const result = parsePeriodo(["--periodo", value], () => "2026-09-05T12:00:00.000Z");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mensaje).toContain("Uso:");
      expect(result.mensaje).toContain("--periodo YYYY-MM");
    }
  });
});
