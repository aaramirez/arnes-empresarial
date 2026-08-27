import Database from "better-sqlite3";

/**
 * Shared business state for a case, as tracked by the `casos` table.
 * `estado` is intentionally an open string, not an enum — the set of valid
 * states is a business-rule concern for the core, not for this adapter.
 */
export interface Caso {
  readonly id: string;
  readonly tipo: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCasoInput {
  readonly id: string;
  readonly tipo: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Fields of a `caso` that can change after creation. `updatedAt` is always
 * required — every update moves the case forward in time. `tipo` and
 * `estado` are optional so callers only touch what actually changed; the
 * turn-close write (Hito 1, tarea 10) only needs `estado`, but leaving
 * `tipo` updatable here keeps this function reusable instead of hardcoding
 * today's single caller.
 */
export interface CasoUpdate {
  readonly tipo?: string;
  readonly estado?: string;
  readonly updatedAt: string;
}

export class CasoNotFoundError extends Error {
  constructor(id: string) {
    super(`Caso not found: ${id}`);
    this.name = "CasoNotFoundError";
  }
}

export class CasoAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Caso already exists: ${id}`);
    this.name = "CasoAlreadyExistsError";
  }
}

export class SesionAgenteAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Sesion agente already exists: ${id}`);
    this.name = "SesionAgenteAlreadyExistsError";
  }
}

export class SesionAgenteInvalidCasoError extends Error {
  constructor(casoId: string) {
    super(`Cannot create sesion_agente: caso does not exist: ${casoId}`);
    this.name = "SesionAgenteInvalidCasoError";
  }
}

/**
 * Narrows a caught error to a specific SQLite constraint violation, so
 * callers can translate the raw driver error into a domain-specific one
 * instead of leaking `better-sqlite3` internals past this adapter.
 */
function isSqliteConstraintError(error: unknown, code: string): boolean {
  return error instanceof Database.SqliteError && error.code === code;
}

interface CasoRow {
  id: string;
  tipo: string;
  estado: string;
  created_at: string;
  updated_at: string;
}

function rowToCaso(row: CasoRow): Caso {
  return {
    id: row.id,
    tipo: row.tipo,
    estado: row.estado,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts a new `caso` row and returns it as stored. Throws
 * `CasoAlreadyExistsError` if `id` collides with an existing row, instead of
 * letting the raw `better-sqlite3` constraint error leak past this adapter.
 */
export function createCaso(db: Database.Database, input: CreateCasoInput): Caso {
  try {
    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (@id, @tipo, @estado, @createdAt, @updatedAt)",
    ).run(input);
  } catch (error) {
    if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_PRIMARYKEY")) {
      throw new CasoAlreadyExistsError(input.id);
    }
    throw error;
  }
  return { ...input };
}

/** Reads a `caso` by id. Returns `undefined` if it does not exist. */
export function getCasoById(db: Database.Database, id: string): Caso | undefined {
  const row = db.prepare("SELECT id, tipo, estado, created_at, updated_at FROM casos WHERE id = ?").get(id) as
    | CasoRow
    | undefined;
  return row ? rowToCaso(row) : undefined;
}

/**
 * Updates the given fields of a `caso` and returns the row as stored after
 * the update, in a single statement via SQLite's `RETURNING` clause — this
 * avoids both a second round-trip and the read-after-write race an UPDATE
 * followed by a separate SELECT would have (nothing stops a concurrent
 * writer from touching the row in between). `COALESCE` lets omitted fields
 * (`undefined` in `update`) fall back to their current value in one pass,
 * without building the SET clause by hand. Throws `CasoNotFoundError` if
 * `id` does not match any row — silently doing nothing would hide a bug in
 * the caller (e.g. a stale `caso_id`) instead of surfacing it.
 */
export function updateCaso(db: Database.Database, id: string, update: CasoUpdate): Caso {
  const row = db
    .prepare(
      `UPDATE casos
       SET tipo = COALESCE(@tipo, tipo),
           estado = COALESCE(@estado, estado),
           updated_at = @updatedAt
       WHERE id = @id
       RETURNING id, tipo, estado, created_at, updated_at`,
    )
    .get({
      id,
      tipo: update.tipo ?? null,
      estado: update.estado ?? null,
      updatedAt: update.updatedAt,
    }) as CasoRow | undefined;

  if (!row) {
    throw new CasoNotFoundError(id);
  }

  return rowToCaso(row);
}

/**
 * Correlates a `caso` with one Claude Agent SDK session for one agent. The
 * SDK owns conversational history itself (resume/continue); this row only
 * records which `sdk_session_id` belongs to which agent within which case.
 */
export interface SesionAgente {
  readonly id: string;
  readonly casoId: string;
  readonly agentId: string;
  readonly sdkSessionId: string;
  readonly createdAt: string;
}

export interface CreateSesionAgenteInput {
  readonly id: string;
  readonly casoId: string;
  readonly agentId: string;
  readonly sdkSessionId: string;
  readonly createdAt: string;
}

interface SesionAgenteRow {
  id: string;
  caso_id: string;
  agent_id: string;
  sdk_session_id: string;
  created_at: string;
}

function rowToSesionAgente(row: SesionAgenteRow): SesionAgente {
  return {
    id: row.id,
    casoId: row.caso_id,
    agentId: row.agent_id,
    sdkSessionId: row.sdk_session_id,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a new `sesion_agente` row and returns it as stored. Throws
 * `SesionAgenteAlreadyExistsError` on an `id` collision, or
 * `SesionAgenteInvalidCasoError` if `casoId` does not reference an existing
 * `caso` (the FK constraint) — both translate the raw `better-sqlite3`
 * constraint error into a domain-specific one, consistent with `createCaso`.
 */
export function createSesionAgente(
  db: Database.Database,
  input: CreateSesionAgenteInput,
): SesionAgente {
  try {
    db.prepare(
      "INSERT INTO sesiones_agente (id, caso_id, agent_id, sdk_session_id, created_at) VALUES (@id, @casoId, @agentId, @sdkSessionId, @createdAt)",
    ).run(input);
  } catch (error) {
    if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_PRIMARYKEY")) {
      throw new SesionAgenteAlreadyExistsError(input.id);
    }
    if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_FOREIGNKEY")) {
      throw new SesionAgenteInvalidCasoError(input.casoId);
    }
    throw error;
  }
  return { ...input };
}

/**
 * Resolves the current `sesion_agente` for a `caso_id` + `agent_id` pair —
 * the one the Ensamblador de Contexto (Hito 1, tarea 8) needs to resolve
 * `options.resume` for the SDK. A case can accumulate more than one session
 * row per agent over time; the most recent one by `created_at` is the
 * current one. Returns `undefined` if the agent never participated in this
 * case yet (nothing to resume).
 *
 * `created_at` alone is not a reliable tiebreaker — two sessions can share
 * the same timestamp (clock resolution, or callers that stamp `createdAt`
 * before calling this module). `sesiones_agente` uses a TEXT primary key
 * (not `WITHOUT ROWID`), so SQLite still maintains an implicit `rowid` that
 * increases with insertion order; ordering by `rowid DESC` as a second key
 * breaks the tie in favor of whichever row was actually inserted last.
 */
export function getLatestSesionAgente(
  db: Database.Database,
  casoId: string,
  agentId: string,
): SesionAgente | undefined {
  const row = db
    .prepare(
      "SELECT id, caso_id, agent_id, sdk_session_id, created_at FROM sesiones_agente WHERE caso_id = ? AND agent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(casoId, agentId) as SesionAgenteRow | undefined;
  return row ? rowToSesionAgente(row) : undefined;
}
