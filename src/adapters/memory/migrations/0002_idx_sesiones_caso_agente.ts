/**
 * Composite index to match the access pattern of `getLatestSesionAgente`
 * (repository.ts): filter by `caso_id` AND `agent_id`, then order by
 * `created_at DESC`. The `idx_sesiones_caso` index from migration 0001 only
 * covers `caso_id`, so that lookup still needed a table scan over every
 * session of the case to filter by agent and sort by timestamp. Does not
 * touch migration 0001 — it is already applied/approved; this is an
 * additive migration, per the project's migration convention.
 */
export const migration0002IdxSesionesCasoAgente = {
  id: "0002_idx_sesiones_caso_agente",
  sql: `
CREATE INDEX IF NOT EXISTS idx_sesiones_caso_agente ON sesiones_agente(caso_id, agent_id, created_at);
`,
};
