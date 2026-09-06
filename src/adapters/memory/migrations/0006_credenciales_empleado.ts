/**
 * Credenciales de empleado (ADR 30 de la propuesta de `tui-canal-empleado`).
 * Una fila por empleado, `empleado_id` como PK — el mismo string que después
 * va a `registro_acciones_empleado.empleado_id` (sin FK, ver 0005).
 *
 * ★ SIN columna `salt` ★: el formato `scrypt$N$r$p$salt$clave` (ADR 30, 35)
 * lo embebe. Una columna aparte obligaría a versionar el esquema cada vez que
 * cambie un parámetro de costo; con el hash autodescriptivo, dos filas con
 * costos distintos conviven sin migrar nada.
 *
 * ★ SIN columna `activo` ★: la desactivación está DIFERIDA (ADR 33 punto 3,
 * R15). Arrastra una política que nadie definió — qué pasa con la sesión
 * abierta de alguien que se desactiva mientras la usa, si sus filas de
 * auditoría siguen valiendo, si el id se puede reusar — y eso es el modelo
 * de autorización de Hito 5. El paliativo existe y cuesta un comando: rotar
 * la contraseña a un valor aleatorio que nadie conoce.
 *
 * `created_at` NO se pisa en una rotación; `updated_at` SÍ. Esa diferencia
 * es la huella que R16 usa: un alta nueva se ve en `created_at`, una
 * impersonación por rotación se ve en `updated_at`.
 *
 * La contraseña en claro NO existe en ninguna columna, en ningún índice y en
 * ningún log. La escribe UN solo proceso (`src/empleados.ts`) y la lee UNA
 * sola función (`verificarPassword`).
 *
 * DESVIACIÓN respecto del SQL del plan (R12), aditiva. Checkpoint:
 * CONCEDIDA.
 */
export const migration0006CredencialesEmpleado = {
  id: "0006_credenciales_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS credenciales_empleado (
  empleado_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
};
