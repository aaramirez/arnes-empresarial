/**
 * Tests de `buildOnLoginHttp` (`operaciones-negocio-conversacionales`, ADR
 * 173 pto 6, tarea 9). Envuelve `resolverLogin` (núcleo, síncrona) en una
 * función `Promise`-friendly; llama `sesionStore.crear(sesion)` SOLO en el
 * camino `exitosa` -- con credenciales inválidas nunca se crea ninguna
 * sesión.
 */
import { describe, expect, it, vi } from "vitest";
import { buildOnLoginHttp } from "./build-on-login-http.js";
import type { AuthConfig } from "./core/auth/auth-config.js";
import type { CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import type { SesionEmpleadoStore } from "./adapters/web/sesion-empleado-store.js";

const AUTH_CONFIG: AuthConfig = { sesionTtlMinutos: 30 };
const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function fakeSesionStore(): SesionEmpleadoStore {
  return {
    crear: vi.fn().mockReturnValue("token-generado"),
    buscar: vi.fn(),
    eliminar: vi.fn(),
  };
}

describe("buildOnLoginHttp", () => {
  it("con credenciales válidas, llama resolverLogin y registra el token en el store", async () => {
    const credenciales: CredencialesEmpleadoPort = {
      buscarCredencial: () => ({ empleadoId: "emp-1", passwordHash: "hash-real" }),
    };
    const verificarPassword = vi.fn().mockReturnValue(true);
    const sesionStore = fakeSesionStore();
    const onLogin = buildOnLoginHttp({
      credenciales,
      verificarPassword,
      dummyPasswordHash: "hash-dummy",
      authConfig: AUTH_CONFIG,
      sesionStore,
      now: () => TIMESTAMP,
    });

    const resultado = await onLogin({ empleadoId: "emp-1", password: "correcta" });

    expect(resultado.ok).toBe(true);
    expect(sesionStore.crear).toHaveBeenCalledTimes(1);
    expect(sesionStore.crear).toHaveBeenCalledWith(
      expect.objectContaining({ empleadoId: "emp-1", iniciadaEn: TIMESTAMP }),
    );
    if (resultado.ok) {
      expect(resultado.token).toBe("token-generado");
    }
  });

  it("con credenciales inválidas (empleado inexistente), no crea ninguna sesión", async () => {
    const credenciales: CredencialesEmpleadoPort = {
      buscarCredencial: () => undefined,
    };
    const verificarPassword = vi.fn().mockReturnValue(false);
    const sesionStore = fakeSesionStore();
    const onLogin = buildOnLoginHttp({
      credenciales,
      verificarPassword,
      dummyPasswordHash: "hash-dummy",
      authConfig: AUTH_CONFIG,
      sesionStore,
      now: () => TIMESTAMP,
    });

    const resultado = await onLogin({ empleadoId: "emp-inexistente", password: "cualquiera" });

    expect(resultado.ok).toBe(false);
    expect(sesionStore.crear).not.toHaveBeenCalled();
    // Mitigación de timing attack (ADR 30): igual corre verificarPassword contra el dummy.
    expect(verificarPassword).toHaveBeenCalledWith("cualquiera", "hash-dummy");
  });

  it("con credenciales inválidas (password incorrecta), no crea ninguna sesión", async () => {
    const credenciales: CredencialesEmpleadoPort = {
      buscarCredencial: () => ({ empleadoId: "emp-1", passwordHash: "hash-real" }),
    };
    const verificarPassword = vi.fn().mockReturnValue(false);
    const sesionStore = fakeSesionStore();
    const onLogin = buildOnLoginHttp({
      credenciales,
      verificarPassword,
      dummyPasswordHash: "hash-dummy",
      authConfig: AUTH_CONFIG,
      sesionStore,
      now: () => TIMESTAMP,
    });

    const resultado = await onLogin({ empleadoId: "emp-1", password: "incorrecta" });

    expect(resultado.ok).toBe(false);
    expect(sesionStore.crear).not.toHaveBeenCalled();
  });
});
