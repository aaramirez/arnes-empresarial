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

/**
 * A GitHub repository tracked for activity webhooks (Hito 3). `id` is
 * `"owner/repo"` — GitHub already guarantees that pair is unique, so there
 * is no reason to mint a synthetic key.
 */
export interface Proyecto {
  readonly id: string;
  readonly nombre: string;
  readonly repoUrl: string;
  readonly createdAt: string;
}

/**
 * A person or bot that can be assigned to an `actividad` — the GitHub login
 * doubles as the primary key, same reasoning as `Proyecto.id`.
 */
export interface Responsable {
  readonly id: string;
  readonly nombre?: string;
  readonly createdAt: string;
}

/**
 * One unit of externally-triggered work (a PR review, an issue, …) tracked
 * against a `caso`. `referenciaExterna` is the emitter's own identifier
 * (e.g. a GitHub PR URL) — `findActividadPorReferencia` resolves it back to
 * the current `actividad` for deduplication on repeated webhook deliveries.
 */
export interface Actividad {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: string;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ActividadNotFoundError extends Error {
  constructor(id: string) {
    super(`Actividad not found: ${id}`);
    this.name = "ActividadNotFoundError";
  }
}

export class ActividadAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Actividad already exists: ${id}`);
    this.name = "ActividadAlreadyExistsError";
  }
}

/**
 * Any of `actividades`' three foreign keys (`proyecto_id`, `caso_id`,
 * `responsable_id`) points at a row that does not exist. The constructor
 * takes the id of the `actividad` being created, not the id of whichever
 * reference is broken — that's the literal contract (design.md §6.1).
 */
export class ActividadInvalidReferenceError extends Error {
  constructor(actividadId: string) {
    super(`Cannot create actividad: invalid reference: ${actividadId}`);
    this.name = "ActividadInvalidReferenceError";
  }
}

interface ProyectoRow {
  id: string;
  nombre: string;
  repo_url: string;
  created_at: string;
}

function rowToProyecto(row: ProyectoRow): Proyecto {
  return {
    id: row.id,
    nombre: row.nombre,
    repoUrl: row.repo_url,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a `proyecto` row, or updates `nombre`/`repo_url` in place if `id`
 * already exists — idempotent by design, since the same repo arrives on
 * every webhook for it. Unlike `upsertResponsable`, this does not
 * `COALESCE` against the existing row: `nombre` and `repoUrl` are required
 * fields on `Proyecto`, so the caller always has a value to write.
 */
export function upsertProyecto(
  db: Database.Database,
  input: { readonly id: string; readonly nombre: string; readonly repoUrl: string; readonly createdAt: string },
): Proyecto {
  const row = db
    .prepare(
      `INSERT INTO proyectos (id, nombre, repo_url, created_at)
       VALUES (@id, @nombre, @repoUrl, @createdAt)
       ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, repo_url = excluded.repo_url
       RETURNING id, nombre, repo_url, created_at`,
    )
    .get(input) as ProyectoRow;
  return rowToProyecto(row);
}

/** Reads a `proyecto` by id. Returns `undefined` if it does not exist. */
export function getProyectoById(db: Database.Database, id: string): Proyecto | undefined {
  const row = db.prepare("SELECT id, nombre, repo_url, created_at FROM proyectos WHERE id = ?").get(id) as
    | ProyectoRow
    | undefined;
  return row ? rowToProyecto(row) : undefined;
}

interface ResponsableRow {
  id: string;
  nombre: string | null;
  created_at: string;
}

function rowToResponsable(row: ResponsableRow): Responsable {
  return {
    id: row.id,
    ...(row.nombre !== null ? { nombre: row.nombre } : {}),
    createdAt: row.created_at,
  };
}

/**
 * Inserts a `responsable` row, or updates it if `id` already exists.
 * Unlike `upsertProyecto`, `nombre` is optional here (GitHub webhooks do
 * not always carry a display name for an assignee) —
 * `COALESCE(excluded.nombre, nombre)` means an upsert that omits `nombre`
 * preserves whatever name was already stored, instead of overwriting it
 * with `NULL`.
 */
export function upsertResponsable(
  db: Database.Database,
  input: { readonly id: string; readonly nombre?: string; readonly createdAt: string },
): Responsable {
  const row = db
    .prepare(
      `INSERT INTO responsables (id, nombre, created_at)
       VALUES (@id, @nombre, @createdAt)
       ON CONFLICT(id) DO UPDATE SET nombre = COALESCE(excluded.nombre, nombre)
       RETURNING id, nombre, created_at`,
    )
    .get({ id: input.id, nombre: input.nombre ?? null, createdAt: input.createdAt }) as ResponsableRow;
  return rowToResponsable(row);
}

export interface CreateActividadInput {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: string;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ActividadRow {
  id: string;
  proyecto_id: string;
  tipo: string;
  referencia_externa: string;
  responsable_id: string | null;
  caso_id: string;
  estado: string;
  created_at: string;
  updated_at: string;
}

function rowToActividad(row: ActividadRow): Actividad {
  return {
    id: row.id,
    proyectoId: row.proyecto_id,
    tipo: row.tipo,
    referenciaExterna: row.referencia_externa,
    ...(row.responsable_id !== null ? { responsableId: row.responsable_id } : {}),
    casoId: row.caso_id,
    estado: row.estado,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts a new `actividad` row and returns it as stored. `actividades` has
 * three foreign keys (`proyecto_id`, `caso_id`, `responsable_id`); any of
 * the three failing collapses to the same `ActividadInvalidReferenceError`,
 * keyed by the `actividad`'s own id — the caller already knows which
 * proyecto/caso/responsable it passed in, what it doesn't know without this
 * is which of the three inserts actually failed.
 */
export function createActividad(db: Database.Database, input: CreateActividadInput): Actividad {
  try {
    db.prepare(
      `INSERT INTO actividades
         (id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at)
       VALUES (@id, @proyectoId, @tipo, @referenciaExterna, @responsableId, @casoId, @estado, @createdAt, @updatedAt)`,
    ).run({ ...input, responsableId: input.responsableId ?? null });
  } catch (error) {
    if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_PRIMARYKEY")) {
      throw new ActividadAlreadyExistsError(input.id);
    }
    if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_FOREIGNKEY")) {
      throw new ActividadInvalidReferenceError(input.id);
    }
    throw error;
  }
  return { ...input };
}

/** Reads an `actividad` by id. Returns `undefined` if it does not exist. */
export function getActividadById(db: Database.Database, id: string): Actividad | undefined {
  const row = db
    .prepare(
      "SELECT id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at FROM actividades WHERE id = ?",
    )
    .get(id) as ActividadRow | undefined;
  return row ? rowToActividad(row) : undefined;
}

/**
 * The most recent `actividad` for a `(proyectoId, referenciaExterna)` pair
 * — how a repeated webhook delivery for the same external reference (e.g.
 * the same PR getting reviewed twice) resolves back to the existing
 * `actividad` instead of creating a duplicate. Same `rowid` tiebreak as
 * `getLatestSesionAgente`: two rows can share `created_at`, and `rowid`
 * reliably orders by insertion since `actividades` is not `WITHOUT ROWID`.
 */
export function findActividadPorReferencia(
  db: Database.Database,
  proyectoId: string,
  referenciaExterna: string,
): Actividad | undefined {
  const row = db
    .prepare(
      `SELECT id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at
       FROM actividades
       WHERE proyecto_id = ? AND referencia_externa = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(proyectoId, referenciaExterna) as ActividadRow | undefined;
  return row ? rowToActividad(row) : undefined;
}

export interface ActividadUpdate {
  readonly estado?: string;
  /** `null` explícito DESASIGNA; `undefined`/ausente deja el valor actual. */
  readonly responsableId?: string | null;
  readonly updatedAt: string;
}

/**
 * Updates the given fields of an `actividad`, `RETURNING` the row as stored
 * after the update — same reasoning as `updateCaso`. `estado` follows the
 * simple `COALESCE(@estado, estado)` pattern (omitted preserves).
 * `responsableId` cannot use that pattern alone: `null` (desasignar) and
 * `undefined`/absent (preservar) both need to reach SQL as *some* bound
 * value — `better-sqlite3` refuses to bind a JS `undefined` at all — so
 * both collapse to a bound `null` for `@responsableId`, and a separate
 * `@hasResponsableId` flag carries which of the two cases it actually was.
 * The `CASE` in the `SET` clause reads that flag instead of trying to infer
 * intent from the (ambiguous on its own) value.
 */
export function updateActividad(db: Database.Database, id: string, update: ActividadUpdate): Actividad {
  const hasResponsableId = Object.prototype.hasOwnProperty.call(update, "responsableId");
  const row = db
    .prepare(
      `UPDATE actividades
       SET estado = COALESCE(@estado, estado),
           responsable_id = CASE WHEN @hasResponsableId = 1 THEN @responsableId ELSE responsable_id END,
           updated_at = @updatedAt
       WHERE id = @id
       RETURNING id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at`,
    )
    .get({
      id,
      estado: update.estado ?? null,
      hasResponsableId: hasResponsableId ? 1 : 0,
      responsableId: update.responsableId ?? null,
      updatedAt: update.updatedAt,
    }) as ActividadRow | undefined;

  if (!row) {
    throw new ActividadNotFoundError(id);
  }

  return rowToActividad(row);
}

export interface CreateCasoConActividadInput {
  readonly proyecto: { readonly id: string; readonly nombre: string; readonly repoUrl: string };
  readonly responsable?: { readonly id: string; readonly nombre?: string };
  readonly caso: CreateCasoInput;
  readonly actividad: Omit<CreateActividadInput, "proyectoId" | "casoId" | "responsableId">;
  readonly timestamp: string;
}

export interface CreateCasoConActividadResult {
  readonly caso: Caso;
  readonly actividad: Actividad;
}

/**
 * Creates `proyecto` (upsert), `responsable` (upsert, if given), `caso` and
 * `actividad` in a single `better-sqlite3` transaction. `db.transaction`
 * wraps a synchronous function and is itself atomic: if any step inside
 * throws, SQLite rolls back everything the transaction did so far — a
 * brand-new `proyecto` row does not survive the rollback, and neither does
 * the `caso` — and the same error propagates out to the caller (it is not
 * swallowed here). This is what makes "una firma inválida no crea NINGUNA
 * fila" literally true instead of aspirational: there is no partial state
 * an interleaved reader could observe.
 */
export function createCasoConActividad(
  db: Database.Database,
  input: CreateCasoConActividadInput,
): CreateCasoConActividadResult {
  const runInTransaction = db.transaction((): CreateCasoConActividadResult => {
    upsertProyecto(db, {
      id: input.proyecto.id,
      nombre: input.proyecto.nombre,
      repoUrl: input.proyecto.repoUrl,
      createdAt: input.timestamp,
    });
    if (input.responsable) {
      upsertResponsable(db, {
        id: input.responsable.id,
        ...(input.responsable.nombre !== undefined ? { nombre: input.responsable.nombre } : {}),
        createdAt: input.timestamp,
      });
    }
    const caso = createCaso(db, input.caso);
    const actividad = createActividad(db, {
      ...input.actividad,
      proyectoId: input.proyecto.id,
      casoId: input.caso.id,
      ...(input.responsable?.id !== undefined ? { responsableId: input.responsable.id } : {}),
    });
    return { caso, actividad };
  });

  return runInTransaction();
}
