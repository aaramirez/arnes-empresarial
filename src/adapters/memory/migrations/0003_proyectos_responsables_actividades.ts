/**
 * Esquema de actividades (Hito 3). `actividades` se liga directamente a
 * `casos` (Hito 1) — no se reinventa la correlación.
 *
 * `tipo` acepta los tres valores del plan aunque este hito solo ejercite
 * `'pr_review'` (ADR 5, *Fuera de alcance*): dejar el esquema completo hace
 * que conectar un segundo emisor sea escribir un mapper, no migrar la base.
 *
 * `estado` queda como TEXT abierto, sin CHECK: los valores válidos son
 * asunto del Núcleo (`activity-contract.ts`), mismo criterio que
 * `repository.ts` ya documenta para `casos.estado` ("intencionalmente un
 * string abierto, no un enum").
 */
export const migration0003ProyectosResponsablesActividades = {
  id: "0003_proyectos_responsables_actividades",
  sql: `
CREATE TABLE IF NOT EXISTS proyectos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responsables (
  id TEXT PRIMARY KEY,
  nombre TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actividades (
  id TEXT PRIMARY KEY,
  proyecto_id TEXT NOT NULL REFERENCES proyectos(id),
  tipo TEXT NOT NULL,
  referencia_externa TEXT NOT NULL,
  responsable_id TEXT REFERENCES responsables(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actividades_proyecto ON actividades(proyecto_id);
`,
};
