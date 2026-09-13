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

/**
 * `comandos-administracion-empleados` (ADR 183 parte 2/RD-84). Nombre
 * DISTINTO de `puedeResolverAjeno` a propósito: hoy coinciden en
 * implementación (dos roles), pero responden preguntas de política
 * distintas — si aparece un tercer rol, cada una cambia de forma
 * independiente sin tocar la otra. Consumida por el gate genérico del
 * dispatcher (`build-on-comando-empleado.ts`, paso 6.5), DESPUÉS de la
 * guarda de sesión existente.
 */
export function esAdministrador(rolPort: RolEmpleadoPort, empleadoId: string): boolean {
  const rol = rolPort.buscarRol(empleadoId) ?? ROL_EMPLEADO;
  return rol === ROL_ADMINISTRADOR;
}
