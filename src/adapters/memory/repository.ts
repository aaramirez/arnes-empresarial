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

/**
 * A person who sells plan changes (Hito 4). `id` and `nombre` come from
 * whatever identity the caller already has for the seller; this adapter
 * does not mint one.
 */
export interface Vendedor {
  readonly id: string;
  readonly nombre: string;
  readonly createdAt: string;
}

/**
 * Public shape of a `venta`, camelCase — field-for-field the same as `Venta`
 * in `src/core/ventas/ventas-contract.ts`. This module never imports that
 * contract (`src/core/` never imports from `src/adapters/*`, and this
 * adapter has no reason to depend on the core either — the shapes line up
 * by convention, not by a shared type), but they must match 1:1 so the
 * composition root can wire this adapter behind `VentaStorePort` without a
 * translation layer.
 */
export interface VentaRow {
  readonly id: string;
  readonly vendedorId: string;
  readonly clienteId: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly estado: string;
  readonly casoId: string;
  readonly tokenConfirmacion: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly expiresAt?: string;
}

export class VentaNotFoundError extends Error {
  constructor(id: string) {
    super(`Venta not found: ${id}`);
    this.name = "VentaNotFoundError";
  }
}

export class VentaAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Venta already exists: ${id}`);
    this.name = "VentaAlreadyExistsError";
  }
}

/**
 * `vendedor_id` o `caso_id` de `ventas` no existen. Molde de
 * `ActividadInvalidReferenceError`. `createVentaConCaso` upsertea el
 * vendedor y crea el caso ANTES de este INSERT, en la misma transacción, así
 * que por construcción ambas referencias siempre existen para ese INSERT —
 * este catch es defensivo, para cualquier otro caller que inserte una
 * `venta` sin pasar por esa función.
 */
export class VentaInvalidReferenceError extends Error {
  constructor(ventaId: string) {
    super(`Cannot create venta: invalid reference: ${ventaId}`);
    this.name = "VentaInvalidReferenceError";
  }
}

/**
 * Colisión de `token_confirmacion` (`SQLITE_CONSTRAINT_UNIQUE`). Con
 * `randomUUID` es astronómicamente improbable, pero un `UNIQUE` que se
 * viola en silencio sería peor que uno que se nombra.
 */
export class VentaTokenDuplicadoError extends Error {
  constructor(token: string) {
    super(`Venta token_confirmacion already exists: ${token}`);
    this.name = "VentaTokenDuplicadoError";
  }
}

interface VendedorRow {
  id: string;
  nombre: string;
  created_at: string;
}

function rowToVendedor(row: VendedorRow): Vendedor {
  return {
    id: row.id,
    nombre: row.nombre,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a `vendedor` row, or updates `nombre` in place if `id` already
 * exists — idempotent by design, molde de `upsertProyecto`: sin `COALESCE`,
 * porque `nombre` es `NOT NULL` y el caller siempre tiene valor.
 */
export function upsertVendedor(
  db: Database.Database,
  input: { readonly id: string; readonly nombre: string; readonly createdAt: string },
): Vendedor {
  const row = db
    .prepare(
      `INSERT INTO vendedores (id, nombre, created_at)
       VALUES (@id, @nombre, @createdAt)
       ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre
       RETURNING id, nombre, created_at`,
    )
    .get(input) as VendedorRow;
  return rowToVendedor(row);
}

interface VentaSqlRow {
  id: string;
  vendedor_id: string;
  cliente_id: string;
  plan_anterior: string | null;
  plan_nuevo: string;
  monto: number;
  estado: string;
  caso_id: string;
  token_confirmacion: string;
  created_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
}

const VENTA_SELECT_COLUMNS =
  "id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at";

function rowToVenta(row: VentaSqlRow): VentaRow {
  return {
    id: row.id,
    vendedorId: row.vendedor_id,
    clienteId: row.cliente_id,
    ...(row.plan_anterior !== null ? { planAnterior: row.plan_anterior } : {}),
    planNuevo: row.plan_nuevo,
    monto: row.monto,
    estado: row.estado,
    casoId: row.caso_id,
    tokenConfirmacion: row.token_confirmacion,
    createdAt: row.created_at,
    ...(row.confirmed_at !== null ? { confirmedAt: row.confirmed_at } : {}),
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
  };
}

export interface CreateVentaConCasoInput {
  readonly vendedor: { readonly id: string; readonly nombre: string };
  readonly caso: CreateCasoInput;
  readonly venta: {
    readonly id: string;
    readonly clienteId: string;
    readonly planAnterior?: string;
    readonly planNuevo: string;
    readonly monto: number;
    readonly estado: string;
    readonly tokenConfirmacion: string;
    readonly expiresAt?: string;
  };
  /** Un único timestamp para `created_at` de las tres filas. */
  readonly timestamp: string;
}

/**
 * `upsertVendedor` + `createCaso` + `INSERT ventas` en UNA transacción,
 * molde EXACTO de `createCasoConActividad`: si cualquiera de los tres pasos
 * lanza, SQLite revierte los anteriores — no queda un `vendedor` nuevo ni un
 * `caso` huérfano.
 *
 * `planAnterior`/`expiresAt` ausentes se bindean como `null` explícito
 * (`better-sqlite3` se niega a bindear un `undefined` de JS). `confirmedAt`
 * no forma parte del input: una venta recién creada nunca está confirmada
 * todavía.
 */
export function createVentaConCaso(db: Database.Database, input: CreateVentaConCasoInput): VentaRow {
  const runInTransaction = db.transaction((): VentaRow => {
    upsertVendedor(db, {
      id: input.vendedor.id,
      nombre: input.vendedor.nombre,
      createdAt: input.timestamp,
    });
    const caso = createCaso(db, input.caso);

    let row: VentaSqlRow;
    try {
      row = db
        .prepare(
          `INSERT INTO ventas
             (id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at)
           VALUES (@id, @vendedorId, @clienteId, @planAnterior, @planNuevo, @monto, @estado, @casoId, @tokenConfirmacion, @createdAt, @confirmedAt, @expiresAt)
           RETURNING ${VENTA_SELECT_COLUMNS}`,
        )
        .get({
          id: input.venta.id,
          vendedorId: input.vendedor.id,
          clienteId: input.venta.clienteId,
          planAnterior: input.venta.planAnterior ?? null,
          planNuevo: input.venta.planNuevo,
          monto: input.venta.monto,
          estado: input.venta.estado,
          casoId: caso.id,
          tokenConfirmacion: input.venta.tokenConfirmacion,
          createdAt: input.timestamp,
          confirmedAt: null,
          expiresAt: input.venta.expiresAt ?? null,
        }) as VentaSqlRow;
    } catch (error) {
      if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_PRIMARYKEY")) {
        throw new VentaAlreadyExistsError(input.venta.id);
      }
      if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_FOREIGNKEY")) {
        throw new VentaInvalidReferenceError(input.venta.id);
      }
      if (isSqliteConstraintError(error, "SQLITE_CONSTRAINT_UNIQUE")) {
        throw new VentaTokenDuplicadoError(input.venta.tokenConfirmacion);
      }
      throw error;
    }

    return rowToVenta(row);
  });

  return runInTransaction();
}

/**
 * Reads a `venta` by its `token_confirmacion`. Indexada por el `UNIQUE` de
 * la columna. `undefined` si no existe.
 */
export function findVentaByToken(db: Database.Database, token: string): VentaRow | undefined {
  const row = db
    .prepare(`SELECT ${VENTA_SELECT_COLUMNS} FROM ventas WHERE token_confirmacion = ?`)
    .get(token) as VentaSqlRow | undefined;
  return row ? rowToVenta(row) : undefined;
}

/** Reads a `venta` by id. Returns `undefined` if it does not exist. */
export function getVentaById(db: Database.Database, id: string): VentaRow | undefined {
  const row = db.prepare(`SELECT ${VENTA_SELECT_COLUMNS} FROM ventas WHERE id = ?`).get(id) as
    | VentaSqlRow
    | undefined;
  return row ? rowToVenta(row) : undefined;
}

/**
 * Public shape of a `comision`, camelCase — field-for-field the same as
 * `Comision` in `src/core/ventas/ventas-contract.ts`. Same reasoning as
 * `VentaRow`: this adapter never imports that contract, but the shapes must
 * line up 1:1 so the composition root can wire this module behind
 * `VentaStorePort` without a translation layer.
 */
export interface ComisionRow {
  readonly id: string;
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly monto: number;
  readonly periodo: string;
  readonly createdAt: string;
}

interface ComisionSqlRow {
  id: string;
  venta_id: string;
  vendedor_id: string;
  monto: number;
  periodo: string;
  created_at: string;
}

const COMISION_SELECT_COLUMNS = "id, venta_id, vendedor_id, monto, periodo, created_at";

function rowToComision(row: ComisionSqlRow): ComisionRow {
  return {
    id: row.id,
    ventaId: row.venta_id,
    vendedorId: row.vendedor_id,
    monto: row.monto,
    periodo: row.periodo,
    createdAt: row.created_at,
  };
}

export interface ConfirmarVentaConComisionInput {
  readonly ventaId: string;
  readonly comisionId: string;
  readonly comisionMonto: number;
  readonly periodo: string;
  /**
   * Un único valor: se usa como `confirmed_at`, como `created_at` de la
   * comisión Y como el `@ahora` del predicado de expiración (ADR 15).
   */
  readonly ahora: string;
}

/**
 * EL corazón del hito (design.md §6.2). UNA transacción, dos escrituras, y
 * el compare-and-swap de ADR 15:
 *
 * 1. El `WHERE estado = 'pendiente_confirmacion' AND (expires_at IS NULL OR
 *    expires_at > @ahora)` es la guarda REAL contra el doble click y contra
 *    dos POST simultáneos — no un chequeo en JS que ocurrió antes de llegar
 *    acá. `undefined` NO es un error: es "ya estaba procesada" o "venció", y
 *    el caller lo traduce a la página genérica.
 * 2. El `INSERT` en `comisiones` ocurre SOLO en la rama donde el `UPDATE`
 *    matcheó. Por construcción no puede haber dos comisiones para la misma
 *    venta: la segunda confirmación nunca llega a insertar.
 * 3. `vendedor_id` de la comisión sale de la fila que el `RETURNING` acaba
 *    de devolver, no de un parámetro — así el denormalizado
 *    (`comisiones.vendedor_id`) no puede divergir de `ventas.vendedor_id`
 *    aunque el caller se equivoque.
 *
 * `expires_at > @ahora` es comparación lexicográfica de TEXT: correcta solo
 * porque todo timestamp de este repo es ISO-8601 UTC de ancho fijo (ADR 16,
 * regla 3).
 */
export function confirmarVentaConComision(
  db: Database.Database,
  input: ConfirmarVentaConComisionInput,
): { readonly venta: VentaRow; readonly comision: ComisionRow } | undefined {
  const runInTransaction = db.transaction(():
    | { readonly venta: VentaRow; readonly comision: ComisionRow }
    | undefined => {
    const ventaRow = db
      .prepare(
        `UPDATE ventas
            SET estado = 'confirmada', confirmed_at = @ahora
          WHERE id = @ventaId
            AND estado = 'pendiente_confirmacion'
            AND (expires_at IS NULL OR expires_at > @ahora)
         RETURNING ${VENTA_SELECT_COLUMNS}`,
      )
      .get({ ventaId: input.ventaId, ahora: input.ahora }) as VentaSqlRow | undefined;

    if (!ventaRow) {
      return undefined;
    }

    const venta = rowToVenta(ventaRow);

    const comisionRow = db
      .prepare(
        `INSERT INTO comisiones (id, venta_id, vendedor_id, monto, periodo, created_at)
         VALUES (@id, @ventaId, @vendedorId, @monto, @periodo, @createdAt)
         RETURNING ${COMISION_SELECT_COLUMNS}`,
      )
      .get({
        id: input.comisionId,
        ventaId: venta.id,
        vendedorId: venta.vendedorId,
        monto: input.comisionMonto,
        periodo: input.periodo,
        createdAt: input.ahora,
      }) as ComisionSqlRow;

    return { venta, comision: rowToComision(comisionRow) };
  });

  return runInTransaction();
}

/**
 * CAS a `'rechazada'` desde `'pendiente_confirmacion'`, misma guarda de
 * expiración que `confirmarVentaConComision`. `undefined` = no aplicó
 * (molde de `updateCaso`/`updateActividad`: un solo `UPDATE ... RETURNING`,
 * atómico por sí mismo sin necesitar `db.transaction`). NUNCA toca
 * `comisiones` — no hay ningún `INSERT` en este cuerpo.
 */
export function rechazarVenta(
  db: Database.Database,
  input: { readonly ventaId: string; readonly ahora: string },
): VentaRow | undefined {
  const row = db
    .prepare(
      `UPDATE ventas
          SET estado = 'rechazada'
        WHERE id = @ventaId
          AND estado = 'pendiente_confirmacion'
          AND (expires_at IS NULL OR expires_at > @ahora)
       RETURNING ${VENTA_SELECT_COLUMNS}`,
    )
    .get(input) as VentaSqlRow | undefined;
  return row ? rowToVenta(row) : undefined;
}

/**
 * CAS a `'reembolsada'` desde `'confirmada'`. SIN guarda de expiración (ADR
 * 19, punto 2): una devolución ocurre después de confirmar, potencialmente
 * meses después de que `expires_at` haya vencido — esa columna solo acota la
 * ventana para CONFIRMAR, no la de pedir un reembolso. NO toca `comisiones`
 * (spec: "la comisión ya pagada permanece").
 */
export function aprobarReembolso(
  db: Database.Database,
  input: { readonly ventaId: string; readonly ahora: string },
): VentaRow | undefined {
  const row = db
    .prepare(
      `UPDATE ventas
          SET estado = 'reembolsada'
        WHERE id = @ventaId
          AND estado = 'confirmada'
       RETURNING ${VENTA_SELECT_COLUMNS}`,
    )
    .get(input) as VentaSqlRow | undefined;
  return row ? rowToVenta(row) : undefined;
}

/**
 * CAS a `'reembolso_pendiente'` desde `'confirmada'` Y
 * `updateCaso(db, casoId, { estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
 * updatedAt: ahora })` en la MISMA `db.transaction` (ADR 11 de la propuesta,
 * punto 2). Si el `UPDATE` de `ventas` no matchea, se devuelve `undefined`
 * ANTES de tocar el `caso`: no existe el estado intermedio "caso escalado,
 * venta no". `updateCaso` ya existe (arriba en este archivo) y se REUSA tal
 * cual — cero cambios en esa función; si `casoId` no existe, su
 * `CasoNotFoundError` revierte también el `UPDATE` de `ventas` gracias a la
 * transacción. NO toca `comisiones`.
 */
export function escalarReembolso(
  db: Database.Database,
  input: { readonly ventaId: string; readonly casoId: string; readonly ahora: string },
): VentaRow | undefined {
  const runInTransaction = db.transaction((): VentaRow | undefined => {
    const row = db
      .prepare(
        `UPDATE ventas
            SET estado = 'reembolso_pendiente'
          WHERE id = @ventaId
            AND estado = 'confirmada'
         RETURNING ${VENTA_SELECT_COLUMNS}`,
      )
      .get({ ventaId: input.ventaId }) as VentaSqlRow | undefined;

    if (!row) {
      return undefined;
    }

    updateCaso(db, input.casoId, {
      estado: "pendiente_aprobacion_humana",
      updatedAt: input.ahora,
    });

    return rowToVenta(row);
  });

  return runInTransaction();
}

/**
 * Fila de `comisiones` cruzada con `ventas`/`vendedores`, tal como
 * `listComisionesPorPeriodo` la entrega (design.md §6.2). Misma forma,
 * campo por campo, que `ComisionConVenta` en `src/core/ventas/reporte.ts` —
 * este módulo NO importa esa interfaz (`src/adapters/*` no depende de
 * `src/core/*` acá, mismo criterio que `VentaRow`/`ComisionRow` arriba), los
 * shapes se alinean por convención para que el composition root pueda pasar
 * esta lectura directo a `agruparReporteMensual` sin capa de traducción.
 */
export interface ComisionConVentaRow {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly comisionMonto: number;
  readonly ventaMonto: number;
  readonly ventaEstado: string;
  readonly periodo: string;
}

interface ComisionConVentaSqlRow {
  venta_id: string;
  vendedor_id: string;
  vendedor_nombre: string;
  comision_monto: number;
  venta_monto: number;
  venta_estado: string;
  periodo: string;
}

function rowToComisionConVenta(row: ComisionConVentaSqlRow): ComisionConVentaRow {
  return {
    ventaId: row.venta_id,
    vendedorId: row.vendedor_id,
    vendedorNombre: row.vendedor_nombre,
    comisionMonto: row.comision_monto,
    ventaMonto: row.venta_monto,
    ventaEstado: row.venta_estado,
    periodo: row.periodo,
  };
}

/**
 * `SELECT` con `JOIN ventas` y `JOIN vendedores`, `WHERE c.periodo = ?`,
 * `ORDER BY c.vendedor_id, c.created_at` (design.md §6.2). Devuelve el
 * estado ACTUAL de la venta (`v.estado`), no el que tenía al momento de
 * generarse la comisión — eso es lo que hace visible R5 (una venta
 * reembolsada con una comisión viva) en vez de esconderla.
 *
 * SIN `GROUP BY`: toda la agrupación por vendedor vive en
 * `agruparReporteMensual` (PURA, `src/core/ventas/reporte.ts`, §3.5), no
 * acá — el spec exige que esa agregación sea testeable sin base de datos, y
 * eso solo es cierto si esta función se limita a leer.
 */
export function listComisionesPorPeriodo(
  db: Database.Database,
  periodo: string,
): readonly ComisionConVentaRow[] {
  const rows = db
    .prepare(
      `SELECT c.venta_id AS venta_id,
              c.vendedor_id AS vendedor_id,
              ve.nombre AS vendedor_nombre,
              c.monto AS comision_monto,
              v.monto AS venta_monto,
              v.estado AS venta_estado,
              c.periodo AS periodo
         FROM comisiones c
         JOIN ventas v ON v.id = c.venta_id
         JOIN vendedores ve ON ve.id = c.vendedor_id
        WHERE c.periodo = @periodo
        ORDER BY c.vendedor_id, c.created_at`,
    )
    .all({ periodo }) as ComisionConVentaSqlRow[];
  return rows.map(rowToComisionConVenta);
}

/**
 * Fila de `ventas` en `'reembolso_pendiente'` cruzada con `vendedores`, tal
 * como `listVentasEnReembolsoPendiente` la entrega. Misma forma que
 * `VentaPendienteReembolso` en `src/core/ventas/reporte.ts`, mismo criterio
 * de no-importación que `ComisionConVentaRow` arriba.
 */
export interface VentaPendienteReembolsoRow {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  readonly monto: number;
  readonly casoId: string;
  readonly confirmedAt?: string;
}

interface VentaPendienteReembolsoSqlRow {
  venta_id: string;
  vendedor_id: string;
  vendedor_nombre: string;
  cliente_id: string;
  monto: number;
  caso_id: string;
  confirmed_at: string | null;
}

function rowToVentaPendienteReembolso(row: VentaPendienteReembolsoSqlRow): VentaPendienteReembolsoRow {
  return {
    ventaId: row.venta_id,
    vendedorId: row.vendedor_id,
    vendedorNombre: row.vendedor_nombre,
    clienteId: row.cliente_id,
    monto: row.monto,
    casoId: row.caso_id,
    ...(row.confirmed_at !== null ? { confirmedAt: row.confirmed_at } : {}),
  };
}

/**
 * `SELECT ... FROM ventas JOIN vendedores WHERE ventas.estado =
 * 'reembolso_pendiente' ORDER BY confirmed_at` (design.md §6.2). SIN filtro
 * de período — el spec lo pide explícitamente: una escalación de reembolso
 * no caduca al cambiar de mes. El literal `'reembolso_pendiente'` en el SQL
 * sigue el mismo criterio que las funciones CAS de arriba
 * (`escalarReembolso`, `aprobarReembolso`, `rechazarVenta`): este módulo no
 * importa el vocabulario de estados de `core/ventas/ventas-contract.ts`.
 */
export function listVentasEnReembolsoPendiente(
  db: Database.Database,
): readonly VentaPendienteReembolsoRow[] {
  const rows = db
    .prepare(
      `SELECT v.id AS venta_id,
              v.vendedor_id AS vendedor_id,
              ve.nombre AS vendedor_nombre,
              v.cliente_id AS cliente_id,
              v.monto AS monto,
              v.caso_id AS caso_id,
              v.confirmed_at AS confirmed_at
         FROM ventas v
         JOIN vendedores ve ON ve.id = v.vendedor_id
        WHERE v.estado = 'reembolso_pendiente'
        ORDER BY v.confirmed_at`,
    )
    .all() as VentaPendienteReembolsoSqlRow[];
  return rows.map(rowToVentaPendienteReembolso);
}
