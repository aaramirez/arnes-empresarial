/**
 * Tests de `crearSesionEmpleadoStore` (`operaciones-negocio-conversacionales`,
 * ADR 173 pto 4, tarea 7). `buscar` no distingue "token inexistente" de
 * "sesión vencida" — ambos devuelven `undefined` (mismo criterio que
 * `token-confirmacion.ts`/`sesionVigente`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearSesionEmpleadoStore } from "./sesion-empleado-store.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";

/** Store construido sin argumento de inactividad — molde de los tests preexistentes de vigencia por `expiraEn`, sin renovación (`0` = opt-out). */
function crearStoreSinInactividad() {
  return crearSesionEmpleadoStore(0);
}

describe("crearSesionEmpleadoStore", () => {
  it("crear devuelve un token no vacío", () => {
    const store = crearStoreSinInactividad();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const token = store.crear(sesion);

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("crear con la misma sesión dos veces devuelve tokens distintos", () => {
    const store = crearStoreSinInactividad();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const tokenA = store.crear(sesion);
    const tokenB = store.crear(sesion);

    expect(tokenA).not.toBe(tokenB);
  });

  it("buscar devuelve la sesión mientras está vigente", () => {
    const store = crearStoreSinInactividad();
    const sesion: SesionEmpleado = {
      empleadoId: "emp-1",
      iniciadaEn: new Date().toISOString(),
      expiraEn: new Date(Date.now() + 60_000).toISOString(),
    };

    const token = store.crear(sesion);

    expect(store.buscar(token)).toEqual(sesion);
  });

  it("buscar devuelve la sesión sin expiración (expiraEn ausente = opt-out)", () => {
    const store = crearStoreSinInactividad();
    const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };

    const token = store.crear(sesion);

    expect(store.buscar(token)).toEqual(sesion);
  });

  it("buscar devuelve undefined si el token no existe", () => {
    const store = crearStoreSinInactividad();

    expect(store.buscar("token-inexistente")).toBeUndefined();
  });

  it("buscar devuelve undefined si la sesión venció -- indistinguible de un token inexistente", () => {
    const store = crearStoreSinInactividad();
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
   * `devolucion-sin-token-dos-personas`, tarea 21 (ADR 231 pto 4 — primer
   * escritor obligatorio, HTTP). La renovación vive DENTRO de `buscar()`,
   * único punto de paso de toda request autenticada.
   */
  describe("renovación por inactividad (ADR 231)", () => {
    const INICIO = new Date("2026-09-01T10:00:00.000Z");

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sesión en uso: requests sucesivos antes de vencer la ventana de inactividad siguen vigentes en cada uno", () => {
      vi.useFakeTimers();
      vi.setSystemTime(INICIO);

      const store = crearSesionEmpleadoStore(5);
      const sesion: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: INICIO.toISOString(),
        inactivaEn: new Date(INICIO.getTime() + 5 * 60_000).toISOString(),
      };
      const token = store.crear(sesion);

      vi.setSystemTime(new Date(INICIO.getTime() + 4 * 60_000));
      expect(store.buscar(token)).toBeDefined();

      // 4 min más desde el ÚLTIMO uso (renovado), no desde el inicio (8 min desde el inicio)
      vi.setSystemTime(new Date(INICIO.getTime() + 8 * 60_000));
      expect(store.buscar(token)).toBeDefined();
    });

    it("sesión ociosa vence igual que hoy: sin requests intermedios, la ventana de inactividad expira", () => {
      vi.useFakeTimers();
      vi.setSystemTime(INICIO);

      const store = crearSesionEmpleadoStore(5);
      const sesion: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: INICIO.toISOString(),
        inactivaEn: new Date(INICIO.getTime() + 5 * 60_000).toISOString(),
      };
      const token = store.crear(sesion);

      vi.setSystemTime(new Date(INICIO.getTime() + 6 * 60_000));
      expect(store.buscar(token)).toBeUndefined();
    });

    it("el tope absoluto vence la sesión aunque se la use dentro de la ventana de inactividad", () => {
      vi.useFakeTimers();
      vi.setSystemTime(INICIO);

      const store = crearSesionEmpleadoStore(100);
      const sesion: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: INICIO.toISOString(),
        expiraEn: new Date(INICIO.getTime() + 10 * 60_000).toISOString(),
        inactivaEn: new Date(INICIO.getTime() + 5 * 60_000).toISOString(),
      };
      const token = store.crear(sesion);

      vi.setSystemTime(new Date(INICIO.getTime() + 3 * 60_000));
      expect(store.buscar(token)).toBeDefined();

      vi.setSystemTime(new Date(INICIO.getTime() + 11 * 60_000));
      expect(store.buscar(token)).toBeUndefined();
    });
  });

  /**
   * `chat-web-empleado`, tarea 5 (ADR 195 pto 1, ADR 202 pto 1) -- tercer
   * método, aditivo. `crear`/`buscar` no cambian de firma ni de
   * comportamiento (cubierto por los tests de arriba, sin tocarlos).
   */
  describe("eliminar", () => {
    it("token existente y vigente -- tras eliminar, buscar devuelve undefined", () => {
      const store = crearStoreSinInactividad();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const token = store.crear(sesion);

      store.eliminar(token);

      expect(store.buscar(token)).toBeUndefined();
    });

    it("token vencido -- eliminar no lanza (idempotente, mismo criterio que buscar)", () => {
      const store = crearStoreSinInactividad();
      const sesion: SesionEmpleado = {
        empleadoId: "emp-1",
        iniciadaEn: new Date(Date.now() - 120_000).toISOString(),
        expiraEn: new Date(Date.now() - 60_000).toISOString(),
      };
      const token = store.crear(sesion);

      expect(() => store.eliminar(token)).not.toThrow();
    });

    it("token inexistente -- eliminar no lanza", () => {
      const store = crearStoreSinInactividad();

      expect(() => store.eliminar("token-inexistente")).not.toThrow();
    });

    it("token ya eliminado -- eliminar de nuevo no lanza", () => {
      const store = crearStoreSinInactividad();
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
      const store = crearStoreSinInactividad();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const token = store.crear(sesion);

      expect(store.otraSesionVigente("emp-1", token)).toBe(false);
    });

    it("true si el mismo empleado tiene OTRA sesión vigente además de la que se excluye", () => {
      const store = crearStoreSinInactividad();
      const sesion: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const tokenA = store.crear(sesion);
      const tokenB = store.crear(sesion);

      expect(store.otraSesionVigente("emp-1", tokenA)).toBe(true);
      expect(store.otraSesionVigente("emp-1", tokenB)).toBe(true);
    });

    it("false si la OTRA sesión del mismo empleado ya venció", () => {
      const store = crearStoreSinInactividad();
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
      const store = crearStoreSinInactividad();
      const sesionA: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: new Date().toISOString() };
      const sesionB: SesionEmpleado = { empleadoId: "emp-2", iniciadaEn: new Date().toISOString() };
      const tokenA = store.crear(sesionA);
      store.crear(sesionB);

      expect(store.otraSesionVigente("emp-1", tokenA)).toBe(false);
    });

    it("false si el empleadoId no tiene ninguna sesión en el store", () => {
      const store = crearStoreSinInactividad();

      expect(store.otraSesionVigente("emp-inexistente", "token-cualquiera")).toBe(false);
    });
  });
});
