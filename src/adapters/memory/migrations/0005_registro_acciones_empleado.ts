/**
 * Registro APPEND-ONLY de acciones de empleado (ADR 27 de la propuesta de
 * `tui-canal-empleado`). Primera tabla del proyecto que captura IDENTIDAD DE
 * ACTOR, y con los ADR 30-32 esa identidad es AUTENTICADA, no autodeclarada.
 *
 * `empleado_id` es NOT NULL a propósito: por construcción no existe la fila
 * anónima (ADR 28). Sin sesión no hay fila — se prefiere un registro con
 * huecos honestos a uno completo y mentiroso. Los logins FALLIDOS no dejan
 * fila (ADR 33 punto 4): no hay empleado identificado a quien atribuírselos.
 *
 * ★ SIN FK a `credenciales_empleado`, y es la decisión menos obvia de la
 *   tabla (ADR 27, enmienda rev. 3): las filas de auditoría tienen que
 *   SOBREVIVIR al empleado que las produjo. Una FK ataría la vida del
 *   registro a la vida de la credencial, y como la única baja posible hoy es
 *   borrar esa fila (ADR 33), la baja fallaría por la FK o arrastraría el
 *   historial. Un append-only que se poda borrando una credencial no es
 *   append-only. Mismo criterio que `ventas.cliente_id`, opaco y sin FK a
 *   propósito (0004). ★
 *
 * `venta_id`/`caso_id` NULLABLE: una consulta de soporte no tiene venta; una
 * devolución con token inválido no tiene ninguna de las dos. SÍ tienen FK:
 * esas dos tablas no se podan.
 *
 * `comando` y `resultado` quedan TEXT abiertos SIN CHECK — mismo criterio
 * que `casos.estado` y `ventas.estado`: el vocabulario canónico vive en
 * `core/commands/registro-acciones-contract.ts`, el SQL no lo conoce.
 *
 * UN solo índice, por `venta_id`, porque hay UN patrón de lectura real: la
 * historia de una venta, que alimenta el listado y el eco de
 * `/reabrir-reembolso` (design.md §5.3). Índices por `empleado_id` u
 * `ocurrido_at` se agregan cuando exista una lectura que los pida — criterio
 * de 0004.
 *
 * Timestamps ISO-8601 UTC, como todo el esquema. `ocurrido_at` se COMPARA y
 * se ORDENA lexicográficamente, correcto SOLO por ese invariante (ADR 16 de
 * Hito 4, regla 3).
 *
 * DESVIACIÓN respecto del SQL del plan (R12): tabla nueva, aditiva, sin
 * datos que migrar y sin lectores previos. Requiere aprobación del
 * checkpoint humano — CONCEDIDA en la revisión 3.
 */
export const migration0005RegistroAccionesEmpleado = {
  id: "0005_registro_acciones_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS registro_acciones_empleado (
  id TEXT PRIMARY KEY,
  empleado_id TEXT NOT NULL,
  comando TEXT NOT NULL,
  venta_id TEXT REFERENCES ventas(id),
  caso_id TEXT REFERENCES casos(id),
  resultado TEXT NOT NULL,
  ocurrido_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registro_acciones_venta ON registro_acciones_empleado(venta_id);
`,
};
