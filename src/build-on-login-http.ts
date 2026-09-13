/**
 * Wiring de `POST /login` (`operaciones-negocio-conversacionales`, ADR 173
 * pto 6, tarea 9). Molde de tamaño/forma `build-on-soporte.ts`: envuelve
 * `resolverLogin` (núcleo, PURA y SÍNCRONA) en una función
 * `Promise`-friendly para calzar con el resto de `WebServerDeps`, y llama
 * `sesionStore.crear(sesion)` SOLO en el camino `exitosa` -- con
 * credenciales inválidas nunca se crea ninguna sesión (mismo criterio de
 * indistinguibilidad, ADR 30, que ya usa la TUI).
 *
 * Reusa las MISMAS `deps` de política de auth que ya arma `main.ts` para la
 * TUI (`credenciales`, `verificarPassword`, `dummyPasswordHash`,
 * `authConfig.sesionTtlMinutos`) -- cero duplicación de política de auth
 * (ADR 173 pto 2).
 */
import { resolverLogin } from "./core/auth/login.js";
import type { CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import type { AuthConfig } from "./core/auth/auth-config.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { SesionEmpleadoStore } from "./adapters/web/sesion-empleado-store.js";

export interface BuildOnLoginHttpDeps {
  readonly credenciales: CredencialesEmpleadoPort;
  /** INYECTADO (ADR 30): en producción es `verificarPassword` de `src/adapters/crypto/password.ts`. */
  readonly verificarPassword: (password: string, hash: string) => boolean;
  /** Mitigación de timing attack de `resolverLogin` -- MISMA instancia que ya usa la TUI. */
  readonly dummyPasswordHash: string;
  readonly authConfig: AuthConfig;
  readonly sesionStore: SesionEmpleadoStore;
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;
}

export type LoginHttpResult =
  | { readonly ok: true; readonly token: string; readonly expiraEn?: string }
  | { readonly ok: false };

/**
 * Devuelve el handler `(input) => Promise<LoginHttpResult>` que el
 * Adaptador Web invoca por cada `POST /login`. Secuencia exacta (ADR 173
 * pto 2):
 *  1. `resolverLogin({ empleadoId, password }, { store: credenciales, ... })`.
 *  2. `resultado.resultado === "invalida"` ⇒ `{ ok: false }` -- ninguna
 *     sesión se crea.
 *  3. `resultado.resultado === "exitosa"` ⇒ `sesionStore.crear(resultado.sesion)`
 *     ⇒ `{ ok: true, token, expiraEn? }`.
 */
export function buildOnLoginHttp(
  deps: BuildOnLoginHttpDeps,
): (input: { readonly empleadoId: string; readonly password: string }) => Promise<LoginHttpResult> {
  const { credenciales, verificarPassword, dummyPasswordHash, authConfig, sesionStore, logDeps } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  return async (input) => {
    const resultado = resolverLogin(input, {
      store: credenciales,
      verificarPassword,
      dummyPasswordHash,
      now,
      ttlMinutos: authConfig.sesionTtlMinutos,
      logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields, logDeps),
    });

    if (resultado.resultado === "invalida") {
      return { ok: false };
    }

    const token = sesionStore.crear(resultado.sesion);
    return resultado.sesion.expiraEn !== undefined
      ? { ok: true, token, expiraEn: resultado.sesion.expiraEn }
      : { ok: true, token };
  };
}
