/**
 * Contrato de lectura de credenciales de empleado (`tui-canal-empleado`,
 * ADR 30). Sin imports — mismo criterio que `ventas-contract.ts`.
 */
export interface CredencialEmpleado {
  readonly empleadoId: string;
  /** Formato `scrypt$N$r$p$salt$clave` (ADR 30, 35). El núcleo NO lo
   *  interpreta: se lo pasa entero a `verificarPassword`, que es lo único
   *  que sabe leerlo. */
  readonly passwordHash: string;
}

/**
 * UNA sola operación, de LECTURA (ADR 30). El alta y la rotación viven en
 * otro proceso (`src/empleados.ts`, ADR 33) y no pasan por este puerto: la
 * TUI no puede crear credenciales, y eso es una propiedad del diseño, no un
 * olvido.
 *
 * SÍNCRONO, como `VentaStorePort` y `MemoryPort` (`better-sqlite3` lo es).
 */
export interface CredencialesEmpleadoPort {
  buscarCredencial(empleadoId: string): CredencialEmpleado | undefined;
}
