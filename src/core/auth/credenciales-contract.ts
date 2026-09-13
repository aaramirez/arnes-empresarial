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
 * UNA sola operación, de LECTURA (ADR 30). La ROTACIÓN sigue viviendo
 * exclusivamente en `src/empleados.ts` (ADR 33) — este puerto no gana una
 * operación de rotación.
 *
 * ★ El ALTA ya NO es exclusiva de `src/empleados.ts` (ADR 174,
 *   `comandos-administracion-empleados`): la propiedad de diseño original
 *   de este comentario — *"la TUI no puede crear credenciales"* — fue
 *   REVERTIDA a pedido explícito del stakeholder. `/crear-empleado` (tarea
 *   8) también da de alta, reusando `altaCredencialEmpleado` (`empleados.ts`,
 *   ADR 181/RD-82) — NO un segundo camino de escritura. Lo que sobrevive
 *   intacto de la propiedad original, y es lo que en realidad protegía
 *   (ADR 174 pto 2): (a) la contraseña NUNCA se persiste en claro — sigue
 *   siendo `scrypt$N$r$p$salt$clave`, mismo hash que el CLI — y (b) este
 *   puerto de LECTURA sigue teniendo una sola operación; el escritor
 *   compartido no vive acá, vive en `empleados.ts`.
 *
 * SÍNCRONO, como `VentaStorePort` y `MemoryPort` (`better-sqlite3` lo es).
 */
export interface CredencialesEmpleadoPort {
  buscarCredencial(empleadoId: string): CredencialEmpleado | undefined;
}
