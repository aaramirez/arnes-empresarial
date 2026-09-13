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
});
