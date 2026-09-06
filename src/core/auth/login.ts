/**
 * Caso de uso: resolver un intento de `/login` (`tui-canal-empleado`, ADR
 * 30, 31). PURA y SÍNCRONA, mismo criterio que `procesar-devolucion.ts`:
 * sin `await`, sin lógica de concurrencia propia.
 *
 * Imports permitidos: solo otros módulos de `src/core/auth/` — regla no
 * negociable de `AGENTS.md`: `src/core/` nunca importa de `src/adapters/*`,
 * ni del SDK, ni de Node.
 */
import { type CredencialesEmpleadoPort } from "./credenciales-contract.js";
import { calcularExpiraEn, type SesionEmpleado } from "./sesion.js";

export const AUTH_LOG_CORRELATION_ID = "auth";

export interface LoginDeps {
  readonly store: CredencialesEmpleadoPort;
  /** INYECTADO (ADR 30): en producción es `verificarPassword` de
   *  `src/adapters/crypto/password.ts`; en test es un `vi.fn()`. El núcleo
   *  NO sabe que existe scrypt, ni cuánto cuesta. */
  readonly verificarPassword: (password: string, hash: string) => boolean;
  readonly now: () => string;
  /** De `AuthConfig.sesionTtlMinutos`. `0` = sin expiración. */
  readonly ttlMinutos: number;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export type LoginResult =
  | { readonly resultado: "exitosa"; readonly sesion: SesionEmpleado }
  | { readonly resultado: "invalida" };

/**
 * PURA y SÍNCRONA. Secuencia exacta (design.md §3.6):
 *  1. `credencial = store.buscarCredencial(empleadoId)`.
 *  2. `credencial === undefined` → `login-fallido` con `{ empleadoId, motivo: "inexistente" }`
 *     → `{ resultado: "invalida" }`.
 *  3. `verificarPassword(password, credencial.passwordHash) === false`
 *     → `login-fallido` con `{ empleadoId, motivo: "password" }` → `invalida`.
 *  4. `iniciadaEn = now()`; `expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos)`
 *     → `login-exitoso` con `{ empleadoId, expiraEn }` → `{ exitosa, sesion }`.
 *
 * ★ `password` aparece EXACTAMENTE UNA VEZ en el cuerpo: como argumento de
 *   `verificarPassword`. No entra en ningún `logEvent`, ni en el resultado,
 *   ni en la sesión. El `motivo` distingue los dos fracasos SOLO en el log
 *   local (útil para diagnóstico); el MENSAJE que el dispatcher le muestra
 *   al usuario es el mismo genérico en los dos casos (ADR 30). ★
 *
 * NO escribe fila de registro: eso lo hace el dispatcher, y SOLO en el
 * camino exitoso (ADR 33 punto 4).
 */
export function resolverLogin(
  input: { readonly empleadoId: string; readonly password: string },
  deps: LoginDeps,
): LoginResult {
  const { store, verificarPassword, now, ttlMinutos, logEvent } = deps;
  const { empleadoId, password } = input;

  const credencial = store.buscarCredencial(empleadoId);

  if (credencial === undefined) {
    logEvent(AUTH_LOG_CORRELATION_ID, "login-fallido", { empleadoId, motivo: "inexistente" });
    return { resultado: "invalida" };
  }

  if (!verificarPassword(password, credencial.passwordHash)) {
    logEvent(AUTH_LOG_CORRELATION_ID, "login-fallido", { empleadoId, motivo: "password" });
    return { resultado: "invalida" };
  }

  const iniciadaEn = now();
  const expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos);

  logEvent(AUTH_LOG_CORRELATION_ID, "login-exitoso", { empleadoId, expiraEn });

  const sesion: SesionEmpleado =
    expiraEn === undefined ? { empleadoId, iniciadaEn } : { empleadoId, iniciadaEn, expiraEn };

  return { resultado: "exitosa", sesion };
}
