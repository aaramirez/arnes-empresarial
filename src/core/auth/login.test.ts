import { describe, expect, it, vi } from "vitest";
import type { CredencialEmpleado, CredencialesEmpleadoPort } from "./credenciales-contract.js";
import { resolverLogin, type LoginDeps } from "./login.js";

/**
 * Spec `autenticacion-empleado-tui`, requirements "Verificación de
 * contraseña en `/login`, con respuesta indistinguible" y "`resolverLogin`
 * es puro, síncrono, y no expone la contraseña fuera de la verificación"
 * (ADR 30, 31). Dobles planos, nunca scrypt real — molde de
 * `procesar-devolucion.test.ts`.
 */

const AHORA = "2026-09-01T10:00:00.000Z";

function buildCredencial(overrides: Partial<CredencialEmpleado> = {}): CredencialEmpleado {
  return {
    empleadoId: "ana",
    passwordHash: "scrypt$16384$8$1$c2FsdA==$Y2xhdmU=",
    ...overrides,
  };
}

function makeStore(overrides: Partial<CredencialesEmpleadoPort> = {}): CredencialesEmpleadoPort {
  return {
    buscarCredencial: vi.fn(() => buildCredencial()),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    store: makeStore(),
    verificarPassword: vi.fn(() => true),
    now: vi.fn(() => AHORA),
    ttlMinutos: 30,
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("resolverLogin", () => {
  it("credencial inexistente → invalida, verificarPassword NO se llamó", () => {
    const store = makeStore({ buscarCredencial: vi.fn(() => undefined) });
    const verificarPassword = vi.fn(() => true);
    const deps = makeDeps({ store, verificarPassword });

    const resultado = resolverLogin({ empleadoId: "zzz", password: "cualquiera" }, deps);

    expect(resultado).toEqual({ resultado: "invalida" });
    expect(verificarPassword).not.toHaveBeenCalled();
  });

  it("credencial inexistente → logEvent login-fallido con motivo inexistente", () => {
    const store = makeStore({ buscarCredencial: vi.fn(() => undefined) });
    const logEvent = vi.fn();
    const deps = makeDeps({ store, logEvent });

    resolverLogin({ empleadoId: "zzz", password: "cualquiera" }, deps);

    expect(logEvent).toHaveBeenCalledWith("auth", "login-fallido", {
      empleadoId: "zzz",
      motivo: "inexistente",
    });
  });

  it("verificarPassword devuelve false → invalida, sin sesión", () => {
    const deps = makeDeps({ verificarPassword: vi.fn(() => false) });

    const resultado = resolverLogin({ empleadoId: "ana", password: "incorrecta" }, deps);

    expect(resultado).toEqual({ resultado: "invalida" });
  });

  it("verificarPassword false → logEvent login-fallido con motivo password", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ verificarPassword: vi.fn(() => false), logEvent });

    resolverLogin({ empleadoId: "ana", password: "incorrecta" }, deps);

    expect(logEvent).toHaveBeenCalledWith("auth", "login-fallido", {
      empleadoId: "ana",
      motivo: "password",
    });
  });

  it("verificarPassword true → exitosa con sesión y expiraEn derivado de now/ttlMinutos", () => {
    const deps = makeDeps({ verificarPassword: vi.fn(() => true), ttlMinutos: 30, now: vi.fn(() => AHORA) });

    const resultado = resolverLogin({ empleadoId: "ana", password: "correcta" }, deps);

    expect(resultado).toEqual({
      resultado: "exitosa",
      sesion: { empleadoId: "ana", iniciadaEn: AHORA, expiraEn: "2026-09-01T10:30:00.000Z" },
    });
  });

  it("ttlMinutos: 0 → sesión exitosa SIN expiraEn", () => {
    const deps = makeDeps({ verificarPassword: vi.fn(() => true), ttlMinutos: 0 });

    const resultado = resolverLogin({ empleadoId: "ana", password: "correcta" }, deps);

    expect(resultado).toEqual({
      resultado: "exitosa",
      sesion: { empleadoId: "ana", iniciadaEn: AHORA },
    });
  });

  it("verificarPassword true → logEvent login-exitoso con empleadoId y expiraEn", () => {
    const logEvent = vi.fn();
    const deps = makeDeps({ verificarPassword: vi.fn(() => true), logEvent });

    resolverLogin({ empleadoId: "ana", password: "correcta" }, deps);

    expect(logEvent).toHaveBeenCalledWith("auth", "login-exitoso", {
      empleadoId: "ana",
      expiraEn: "2026-09-01T10:30:00.000Z",
    });
  });

  it("★ la contraseña llega a verificarPassword y a ningún otro lado ★: se inspeccionan TODAS las llamadas a logEvent", () => {
    const verificarPassword = vi.fn(() => false);
    const logEvent = vi.fn();
    const deps = makeDeps({ verificarPassword, logEvent });

    resolverLogin({ empleadoId: "ana", password: "un-secreto-muy-especifico" }, deps);

    expect(verificarPassword).toHaveBeenCalledWith("un-secreto-muy-especifico", buildCredencial().passwordHash);
    for (const llamada of logEvent.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain("un-secreto-muy-especifico");
    }
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable", () => {
    const deps = makeDeps();

    const resultado = resolverLogin({ empleadoId: "ana", password: "correcta" }, deps);

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });
});
