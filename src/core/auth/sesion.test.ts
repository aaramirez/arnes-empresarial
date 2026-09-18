import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calcularExpiraEn, renovarSesion, sesionVigente, type SesionEmpleado } from "./sesion.js";

/**
 * Spec `autenticacion-empleado-tui`, requirement "Vigencia y expiración de la sesión por TTL absoluto"
 * (ADR 31) y, desde `devolucion-sin-token-dos-personas` (ADR 231), "Vigencia y expiración de la
 * sesión por INACTIVIDAD, con TOPE ABSOLUTO".
 */

const INICIADA_EN = "2026-09-01T10:00:00.000Z";

describe("sesionVigente", () => {
  it("sesion undefined → false", () => {
    expect(sesionVigente(undefined, INICIADA_EN)).toBe(false);
  });

  it("expiraEn ausente → true con cualquier ahora (opt-out explícito, TTL=0)", () => {
    const sesion: SesionEmpleado = { empleadoId: "ana", iniciadaEn: INICIADA_EN };
    expect(sesionVigente(sesion, "2099-01-01T00:00:00.000Z")).toBe(true);
  });

  it("T+29m → vigente", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:29:00.000Z")).toBe(true);
  });

  it("T+31m → vencida", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:31:00.000Z")).toBe(false);
  });

  it("ahora === expiraEn → false (borde vencido, mismo criterio que expires_at > @ahora del CAS)", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:30:00.000Z")).toBe(false);
  });

  it("inactivaEn ausente → sólo aplica expiraEn (retrocompatibilidad con sesiones sin inactivaEn)", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:29:00.000Z")).toBe(true);
    expect(sesionVigente(sesion, "2026-09-01T10:30:00.000Z")).toBe(false);
  });

  it("vigente sólo si expiraEn Y inactivaEn se cumplen a la vez", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T18:00:00.000Z",
      inactivaEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:29:00.000Z")).toBe(true);
  });

  it("ADR 231 — el tope absoluto expira la sesión aunque inactivaEn esté vigente", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T10:30:00.000Z",
      inactivaEn: "2099-01-01T00:00:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:31:00.000Z")).toBe(false);
  });

  it("ADR 231 — la inactividad expira la sesión aunque expiraEn esté lejos", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2099-01-01T00:00:00.000Z",
      inactivaEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:31:00.000Z")).toBe(false);
  });

  it("ahora === inactivaEn → false (mismo borde vencido que expiraEn)", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2099-01-01T00:00:00.000Z",
      inactivaEn: "2026-09-01T10:30:00.000Z",
    };
    expect(sesionVigente(sesion, "2026-09-01T10:30:00.000Z")).toBe(false);
  });
});

describe("renovarSesion", () => {
  it("ADR 231 pto 3 — devuelve un inactivaEn nuevo calculado desde ahora, expiraEn intacto (regresión)", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T18:00:00.000Z",
      inactivaEn: "2026-09-01T10:30:00.000Z",
    };
    const renovada = renovarSesion(sesion, "2026-09-01T10:20:00.000Z", 30);

    expect(renovada.inactivaEn).toBe("2026-09-01T10:50:00.000Z");
    expect(renovada.expiraEn).toBe(sesion.expiraEn);
  });

  it("es pura — no muta el objeto original", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T18:00:00.000Z",
      inactivaEn: "2026-09-01T10:30:00.000Z",
    };
    const copia = { ...sesion };

    renovarSesion(sesion, "2026-09-01T10:20:00.000Z", 30);

    expect(sesion).toEqual(copia);
  });

  it("inactividadMinutos 0 → inactivaEn queda undefined (opt-out)", () => {
    const sesion: SesionEmpleado = {
      empleadoId: "ana",
      iniciadaEn: INICIADA_EN,
      expiraEn: "2026-09-01T18:00:00.000Z",
    };
    const renovada = renovarSesion(sesion, "2026-09-01T10:20:00.000Z", 0);

    expect(renovada.inactivaEn).toBeUndefined();
  });
});

describe("calcularExpiraEn", () => {
  it("ttlMinutos 0 → undefined (sin expiración)", () => {
    expect(calcularExpiraEn(INICIADA_EN, 0)).toBeUndefined();
  });

  it("ttlMinutos 30 → ISO exacto a 30 minutos de iniciadaEn", () => {
    expect(calcularExpiraEn(INICIADA_EN, 30)).toBe("2026-09-01T10:30:00.000Z");
  });
});

describe("sesion.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./sesion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
