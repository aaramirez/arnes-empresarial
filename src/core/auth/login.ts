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
  /**
   * Hash "dummy" — mitigación de timing attack (hallazgo de seguridad, fuera
   * de tarea numerada). Antes de este fix, `resolverLogin` retornaba casi
   * instantáneo cuando `empleadoId` no existía, pero corría la verificación
   * scrypt completa (computacionalmente cara) cuando el `empleadoId` SÍ
   * existía y la contraseña era incorrecta. El mensaje final es idéntico en
   * los dos casos, pero el TIEMPO no — un atacante puede enumerar qué
   * `empleadoId` existen mandando intentos con password fija y midiendo
   * latencia.
   *
   * TRADE-OFF ACEPTADO, no un efecto secundario pasado por alto (Reviewer
   * finding, hallazgo de eficiencia): esta mitigación cambia un login contra
   * un `empleadoId` inexistente de "casi instantáneo" a "mismo costo scrypt
   * que un intento con password incorrecta contra una cuenta real". Eso
   * habilita a un atacante sin ninguna credencial válida a forzar trabajo
   * scrypt sostenido contra el proceso (amplificación de CPU) a cambio de
   * cerrar la enumeración de `empleadoId` por timing. Este repo no tiene
   * ninguna capa de rate-limiting (ni acá ni en ningún otro comando
   * privilegiado) — acotar esa amplificación es una decisión de diseño
   * nueva (dónde vive el límite, por IP/empleadoId/proceso, qué política),
   * no algo que el Implementer deba resolver unilateralmente en un cleanup
   * de Reviewer: le corresponde a un Spec Author si se decide priorizarlo.
   *
   * INYECTADO, no un literal fijo adentro de este módulo (fix de review,
   * hallazgo de duplicación/drift): si el valor viviera hardcodeado acá con
   * un costo N/r/p propio, una rotación futura de `SCRYPT_N/R/P` en
   * `adapters/crypto/password.ts` haría que los hashes reales se vuelvan más
   * caros mientras este literal se queda congelado con el costo viejo —
   * reabriendo el mismo timing attack que existe para mitigar. El
   * composition root (`main.ts`) lo genera con `hashPassword(...)`, la misma
   * función que genera los hashes reales, así que SIEMPRE hereda los
   * parámetros de costo vivos. El VALOR resultante es arbitrario: nunca se
   * compara contra ninguna contraseña real, y el resultado de
   * `verificarPassword` contra este hash se IGNORA siempre (ver
   * `resolverLogin`) — jamás puede convertir el camino "no existe" en un
   * login exitoso. El núcleo sigue sin importar `password.ts` ni saber que
   * existe scrypt (ADR 30): para `resolverLogin` esto es un literal opaco,
   * igual que `credencial.passwordHash`.
   */
  readonly dummyPasswordHash: string;
  readonly now: () => string;
  /** De `AuthConfig.sesionTtlMinutos`. `0` = sin expiración. */
  readonly ttlMinutos: number;
  /** ★ NUEVO (ADR 231 pto 5). De `AuthConfig.sesionInactividadMinutos`. `0` = sin expiración por inactividad. */
  readonly inactividadMinutos: number;
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
 * PURA y SÍNCRONA. Secuencia exacta (design.md §3.6), con la mitigación de
 * timing attack de `deps.dummyPasswordHash` sumada al paso 2:
 *  1. `credencial = store.buscarCredencial(empleadoId)`.
 *  2. `credencial === undefined` → igual corre `verificarPassword(password,
 *     deps.dummyPasswordHash)` e IGNORA el resultado (mismo costo
 *     computacional que el paso 3) → `login-fallido` con `{ empleadoId,
 *     motivo: "inexistente" }` → `{ resultado: "invalida" }`.
 *  3. `verificarPassword(password, credencial.passwordHash) === false`
 *     → `login-fallido` con `{ empleadoId, motivo: "password" }` → `invalida`.
 *  4. `iniciadaEn = now()`; `expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos)` (tope ABSOLUTO,
 *     significado INTACTO — ADR 31 pto 2); `inactivaEn = calcularExpiraEn(iniciadaEn,
 *     inactividadMinutos)` (★ NUEVO, ADR 231 pto 5, se renueva luego con `renovarSesion`)
 *     → `login-exitoso` con `{ empleadoId, expiraEn }` → `{ exitosa, sesion }`.
 *
 * ★ `password` aparece como argumento de `verificarPassword` en los DOS
 *   caminos de fallo (real o dummy) y en NINGÚN otro lado: no entra en
 *   ningún `logEvent`, ni en el resultado, ni en la sesión. El `motivo`
 *   distingue los dos fracasos SOLO en el log local (útil para
 *   diagnóstico); el MENSAJE que el dispatcher le muestra al usuario es el
 *   mismo genérico en los dos casos (ADR 30). ★
 *
 * NO escribe fila de registro: eso lo hace el dispatcher, y SOLO en el
 * camino exitoso (ADR 33 punto 4).
 */
export function resolverLogin(
  input: { readonly empleadoId: string; readonly password: string },
  deps: LoginDeps,
): LoginResult {
  const { store, verificarPassword, dummyPasswordHash, now, ttlMinutos, inactividadMinutos, logEvent } = deps;
  const { empleadoId, password } = input;

  const credencial = store.buscarCredencial(empleadoId);

  if (credencial === undefined) {
    // Mitigación de timing attack: corre la MISMA verificación cara contra
    // el hash dummy INYECTADO, para que este camino cueste lo mismo que el
    // de "existe, password incorrecta" — el resultado se IGNORA siempre,
    // jamás puede convertir esto en un login exitoso.
    verificarPassword(password, dummyPasswordHash);
    logEvent(AUTH_LOG_CORRELATION_ID, "login-fallido", { empleadoId, motivo: "inexistente" });
    return { resultado: "invalida" };
  }

  if (!verificarPassword(password, credencial.passwordHash)) {
    logEvent(AUTH_LOG_CORRELATION_ID, "login-fallido", { empleadoId, motivo: "password" });
    return { resultado: "invalida" };
  }

  const iniciadaEn = now();
  const expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos);
  const inactivaEn = calcularExpiraEn(iniciadaEn, inactividadMinutos);

  logEvent(AUTH_LOG_CORRELATION_ID, "login-exitoso", { empleadoId, expiraEn });

  const sesion: SesionEmpleado = {
    empleadoId,
    iniciadaEn,
    ...(expiraEn === undefined ? {} : { expiraEn }),
    ...(inactivaEn === undefined ? {} : { inactivaEn }),
  };

  return { resultado: "exitosa", sesion };
}
