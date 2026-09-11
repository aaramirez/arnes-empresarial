/**
 * Índice sobre `estado` para `solicitudes_a2a_entrantes` (comando-visibilidad-a2a-entrante,
 * tarea 1). La migración 0011 dejó un único índice, sobre `caso_id`, porque en
 * ese momento ninguna pantalla ni comando filtraba por `estado`. Este cambio
 * agrega ese filtro (visibilidad de solicitudes A2A entrantes por estado), así
 * que sin este índice esa consulta sería un table scan. No toca la migración
 * 0011 — ya está aplicada/aprobada; esta es una migración aditiva, por la
 * convención de migraciones del proyecto.
 */
export const migration0012IdxSolicitudesA2AEntrantesEstado = {
  id: "0012_idx_solicitudes_a2a_entrantes_estado",
  sql: `
CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_estado ON solicitudes_a2a_entrantes(estado);
`,
};
