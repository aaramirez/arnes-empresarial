import { migration0001CasosSesionesAgente } from "./0001_casos_sesiones_agente.js";
import { migration0002IdxSesionesCasoAgente } from "./0002_idx_sesiones_caso_agente.js";

/**
 * A single schema migration: a stable `id` (used to track whether it has
 * already been applied) plus the SQL to run.
 *
 * Migration convention: one file per migration under `migrations/`, named
 * `NNNN_short_description.ts` with a zero-padded sequential prefix so
 * ordering is obvious from the filename. Each file exports a single
 * `Migration` object. New migrations are appended to `migrations` below —
 * existing entries are never edited or reordered once committed, since
 * `runMigrations` tracks applied ids permanently in `schema_migrations`.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  migration0001CasosSesionesAgente,
  migration0002IdxSesionesCasoAgente,
];
