/**
 * Initial schema for the shared-memory correlation layer (Hito 1).
 *
 * `casos` holds the shared business state across agents. `sesiones_agente`
 * correlates a `caso` with the Claude Agent SDK sessions that participated
 * in it — the SDK already persists conversational history on its own
 * (resume/continue), so this schema intentionally does NOT duplicate it.
 */
export const migration0001CasosSesionesAgente = {
  id: "0001_casos_sesiones_agente",
  sql: `
CREATE TABLE IF NOT EXISTS casos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones_agente (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  agent_id TEXT NOT NULL,
  sdk_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sesiones_caso ON sesiones_agente(caso_id);
`,
};
