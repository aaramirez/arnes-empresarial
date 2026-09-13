import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleadoPort } from "./rol-contract.js";

/**
 * ÚNICO lugar del repo que decide "¿puede resolver lo ajeno?". Los DOS call
 * sites (`resolver-escalacion-reembolso.ts`, `resolver-solicitud-interna.ts`)
 * llaman acá en vez de reimplementar la comparación — así el invariante
 * ADR 154 pto 5 (ausencia de fila ⇒ NUNCA autoriza) se prueba UNA sola vez,
 * no dos, y las dos funciones no pueden divergir en su interpretación.
 */
export function puedeResolverAjeno(rolPort: RolEmpleadoPort, empleadoId: string): boolean {
  const rol = rolPort.buscarRol(empleadoId) ?? ROL_EMPLEADO;
  return rol === ROL_ADMINISTRADOR;
}
