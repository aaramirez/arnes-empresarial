/**
 * Store en memoria de sesiones HTTP de empleado
 * (`operaciones-negocio-conversacionales`, ADR 173 pto 4, tarea 7). Vive en
 * `src/adapters/web/` (no en `core/`) — es estado de proceso ligado a la
 * concurrencia HTTP, no lógica de dominio (ADR 173 pto 4).
 *
 * `SesionEmpleado` (`core/auth/sesion.ts`) hoy vive, para la TUI, en la
 * ranura del closure de `build-on-comando-empleado.ts` — correcto para un
 * proceso de un solo usuario interactivo. HTTP es sin estado y
 * potencialmente concurrente (N empleados a la vez): este store reconstruye
 * una `SesionEmpleado` a partir de un token opaco por cada request.
 *
 * `buscar` reusa `sesionVigente` TAL CUAL (sin duplicar el algoritmo) —
 * "vencida" e "inexistente" son INDISTINGUIBLES desde afuera (`undefined` en
 * los dos casos), mismo criterio que `token-confirmacion.ts` ya aplica a sus
 * propios tokens.
 */
import { randomUUID } from "node:crypto";
import { sesionVigente, type SesionEmpleado } from "../../core/auth/sesion.js";

export interface SesionEmpleadoStore {
  /** Genera un token opaco de alta entropía (`randomUUID`), lo asocia a `sesion`, y lo devuelve. */
  crear(sesion: SesionEmpleado): string;
  /** `undefined` si el token no existe O si la sesión asociada venció — mismo caso desde afuera. */
  buscar(token: string): SesionEmpleado | undefined;
}

export function crearSesionEmpleadoStore(): SesionEmpleadoStore {
  const sesiones = new Map<string, SesionEmpleado>();

  return {
    crear(sesion) {
      const token = randomUUID();
      sesiones.set(token, sesion);
      return token;
    },
    buscar(token) {
      const sesion = sesiones.get(token);
      return sesionVigente(sesion, new Date().toISOString()) ? sesion : undefined;
    },
  };
}
