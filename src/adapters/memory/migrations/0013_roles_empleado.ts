/**
 * Rol de empleado (`autorizacion-empleado`, ADR 157). Tabla propia, no una
 * columna en `credenciales_empleado` — separa autenticación (quién sos) de
 * autorización (qué podés), espejo de cómo `SesionEmpleado` y el rol ya son
 * dos objetos distintos en el TIPO (ADR 154 pto 2).
 *
 * Sin `FK` a `credenciales_empleado` (mismo criterio que el resto del
 * esquema de empleado: las filas sobreviven a lo que le pase a la fila que
 * las originó). Sin `CHECK` sobre `rol` (ADR 152 pto 1).
 *
 * ADITIVA, SIN BACKFILL: una fila en `roles_empleado` no existe hasta que
 * `src/empleados.ts` la crea explícitamente. Toda fila de
 * `credenciales_empleado` anterior a esta migración queda, por construcción,
 * sin fila de rol — que es exactamente el rol BASE (ADR 154 pto 5, ADR 156).
 * La ausencia misma ES el default-deny; no hace falta ningún `UPDATE` ni
 * `DEFAULT` en el esquema.
 */
export const migration0013RolesEmpleado = {
  id: "0013_roles_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS roles_empleado (
  empleado_id TEXT PRIMARY KEY,
  rol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
};
