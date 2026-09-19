/**
 * Justificación de una devolución sin token (`devolucion-sin-token-dos-
 * personas`, ADR 228 pto 6, RD-106, tarea 9). APPEND-ONLY: sin `UPDATE`, sin
 * `DELETE` — el puerto (`justificacion-devolucion-contract.ts`, tarea 8)
 * expone UNA sola operación, `registrar`.
 *
 * ★ `solicitante_id` SIN FK a `credenciales_empleado`, mismo argumento
 *   textual que `0005_registro_acciones_empleado.ts`: las filas de auditoría
 *   tienen que SOBREVIVIR al empleado que las produjo. `venta_id`/`caso_id`
 *   SÍ llevan FK: esas dos tablas no se podan.
 *
 * UN solo índice, por `venta_id` — hay UN patrón de lectura real (la
 * historia de una venta), mismo criterio que 0005. ★ SIN índice sobre
 * `motivo` (R13: `motivo` NUNCA es clave de búsqueda). ★ SIN `UNIQUE` sobre
 * `venta_id`: una venta puede tener un intento fallido y uno exitoso, y
 * borrar esa historia sería peor que guardarla (design.md ADR 228 pto 6).
 *
 * `motivo`/`solicitada_at` TEXT abiertos SIN CHECK — mismo criterio que el
 * resto del esquema: el vocabulario canónico (tope de 256, ADR 228 pto 5)
 * vive en el núcleo, no en el SQL.
 *
 * ADITIVA: tabla nueva, sin datos que migrar, sin lectores previos.
 */
export const migration0014JustificacionesDevolucion = {
  id: "0014_justificaciones_devolucion",
  sql: `
CREATE TABLE IF NOT EXISTS justificaciones_devolucion (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  solicitante_id TEXT NOT NULL,
  motivo TEXT NOT NULL,
  solicitada_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_justificaciones_devolucion_venta ON justificaciones_devolucion(venta_id);
`,
};
