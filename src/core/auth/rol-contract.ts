/**
 * Contrato de rol de empleado (`autorizacion-empleado`, ADR 157/162). Sin
 * imports — mismo criterio que `credenciales-contract.ts`.
 */
export const ROL_EMPLEADO = "empleado";
export const ROL_ADMINISTRADOR = "administrador";
export const ROLES_EMPLEADO = [ROL_EMPLEADO, ROL_ADMINISTRADOR] as const;
export type RolEmpleado = (typeof ROLES_EMPLEADO)[number];

/**
 * UNA sola operación, de LECTURA, síncrona. `undefined` = ausencia de fila,
 * NUNCA un tercer valor — la interpretación de esa ausencia (ADR 154 pto 5)
 * vive en `autorizacion-resolucion.ts`, no acá ni en el adaptador: así el
 * invariante de seguridad no depende de que un adaptador futuro lo copie bien.
 */
export interface RolEmpleadoPort {
  buscarRol(empleadoId: string): RolEmpleado | undefined;
}

/**
 * Escritor de rol (`comandos-administracion-empleados`, ADR 175 pto 5,
 * RD-82). Separado de `RolEmpleadoPort` (lectura, arriba, SIN TOCAR) por el
 * mismo criterio del ADR 176 pto 1: mezclar lectura y escritura en un
 * puerto obligaría a que el gate del núcleo (`autorizacion-resolucion.ts`)
 * reciba un puerto que también puede escribir.
 */
export interface RolEmpleadoEscritorPort {
  asignarRol(input: { readonly empleadoId: string; readonly rol: RolEmpleado; readonly ahora: string }): void;
}
