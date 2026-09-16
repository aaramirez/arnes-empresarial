/**
 * Tests de `crearSesionEmpleadoStore` (`operaciones-negocio-conversacionales`,
 * ADR 173 pto 4, tarea 7). `buscar` no distingue "token inexistente" de
 * "sesión vencida" — ambos devuelven `undefined` (mismo criterio que
 * `token-confirmacion.ts`/`sesionVigente`).
 */
import { describe, expect, it } from "vitest";
import { crearSesionEmpleadoStore } from "./sesion-empleado-store.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";

describe("crearSesionEmpleadoStore", () => {
  it("crear devuelve un token no vacío", () => {
    const store = crearSesionEmpleadoStore();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const token = store.crear(sesion);

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("crear con la misma sesión dos veces devuelve tokens distintos", () => {
    const store = crearSesionEmpleadoStore();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const tokenA = store.crear(sesion);
    const tokenB = store.crear(sesion);

    expect(tokenA).not.toBe(tokenB);
  });

  it("buscar devuelve la sesión mientras está vigente", () => {
    const store = crearSesionEmpleadoStore();
    const sesion: SesionEmpleado = {
      empleadoId: "emp-1",
      iniciadaEn: new Date().toISOString(),
      expiraEn: new Date(Date.now() + 60_000).toISOString(),
    };

    const token = store.crear(sesion);

    expect(store.buscar(token)).toEqual(sesion);
  });

  it("buscar devuelve la sesión sin expiración (expiraEn ausente = opt-out)", () => {
    const store = crearSesionEmpleadoStore();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const token = store.crear(sesion);

    expect(store.buscar(token)).toEqual(sesion);
  });

  it("buscar devuelve undefined si el token no existe", () => {
    const store = crearSesionEmpleadoStore();

    expect(store.buscar("token-inexistente")).toBeUndefined();
  });

  it("buscar devuelve undefined si la sesión venció -- indistinguible de un token inexistente", () => {
    const store = crearSesionEmpleadoStore();
    const sesion: SesionEmpleado = {
      empleadoId: "emp-1",
      iniciadaEn: new Date(Date.now() - 120_000).toISOString(),
      expiraEn: new Date(Date.now() - 60_000).toISOString(),
    };

    const token = store.crear(sesion);

    expect(store.buscar(token)).toBe(store.buscar("token-inexistente"));
    expect(store.buscar(token)).toBeUndefined();
  });

  /**
   * `chat-web-empleado`, tarea 5 (ADR 195 pto 1, ADR 202 pto 1) -- tercer
   * método, aditivo. `crear`/`buscar` no cambian de firma ni de
   * comportamiento (cubierto por los tests de arriba, sin tocarlos).
   */
  describe("eliminar", () => {
    it("token existente y vigente -- tras eliminar, buscar devuelve undefined", () => {
      const store = crearSesionEmpleadoStore();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const token = store.crear(sesion);

      store.eliminar(token);

      expect(store.buscar(token)).toBeUndefined();
    });

    it("token vencido -- eliminar no lanza (idempotente, mismo criterio que buscar)", () => {
      const store = crearSesionEmpleadoStore();
      const sesion: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: new Date(Date.now() - 120_000).toISOString(),
        expiraEn: new Date(Date.now() - 60_000).toISOString(),
      };
      const token = store.crear(sesion);

      expect(() => store.eliminar(token)).not.toThrow();
    });

    it("token inexistente -- eliminar no lanza", () => {
      const store = crearSesionEmpleadoStore();

      expect(() => store.eliminar("token-inexistente")).not.toThrow();
    });

    it("token ya eliminado -- eliminar de nuevo no lanza", () => {
      const store = crearSesionEmpleadoStore();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const token = store.crear(sesion);

      store.eliminar(token);

      expect(() => store.eliminar(token)).not.toThrow();
      expect(store.buscar(token)).toBeUndefined();
    });
  });

  /**
   * `chat-web-empleado`, hallazgo Reviewer 2da ronda #1 (CRÍTICO): dos
   * sesiones concurrentes del MISMO empleado (dos tokens) no deben pisarse
   * al cerrar sesión. Método aditivo -- `crear`/`buscar`/`eliminar` no
   * cambian de firma ni de comportamiento.
   */
  describe("otraSesionVigente", () => {
    it("false si el empleado sólo tiene la sesión que se está por cerrar", () => {
      const store = crearSesionEmpleadoStore();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const token = store.crear(sesion);

      expect(store.otraSesionVigente("emp-1", token)).toBe(false);
    });

    it("true si el mismo empleado tiene OTRA sesión vigente además de la que se excluye", () => {
      const store = crearSesionEmpleadoStore();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const tokenA = store.crear(sesion);
      const tokenB = store.crear(sesion);

      expect(store.otraSesionVigente("emp-1", tokenA)).toBe(true);
      expect(store.otraSesionVigente("emp-1", tokenB)).toBe(true);
    });

    it("false si la OTRA sesión del mismo empleado ya venció", () => {
      const store = crearSesionEmpleadoStore();
      const sesionVigente: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const sesionVencida: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: new Date(Date.now() - 120_000).toISOString(),
        expiraEn: new Date(Date.now() - 60_000).toISOString(),
      };
      const tokenVigente = store.crear(sesionVigente);
      store.crear(sesionVencida);

      expect(store.otraSesionVigente("emp-1", tokenVigente)).toBe(false);
    });

    it("false si la otra sesión vigente pertenece a OTRO empleado", () => {
      const store = crearSesionEmpleadoStore();
      const sesionA: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const sesionB: SesionEmpleado = { empleadoId: "emp-2", iniciadaEn: new Date().toISOString() };
      const tokenA = store.crear(sesionA);
      store.crear(sesionB);

      expect(store.otraSesionVigente("emp-1", tokenA)).toBe(false);
    });

    it("false si el empleadoId no tiene ninguna sesión en el store", () => {
      const store = crearSesionEmpleadoStore();

      expect(store.otraSesionVigente("emp-inexistente", "token-cualquiera")).toBe(false);
    });
  });
});
