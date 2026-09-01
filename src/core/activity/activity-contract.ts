/**
 * Contrato de actividad (Hito 3, tarea 1).
 *
 * Lo único que el Núcleo sabe sobre actividades disparadas por un evento
 * externo (un PR de GitHub, hoy; una segunda fuente mañana) y sobre el
 * tablero que las espeja: las constantes canónicas de `actividades.estado`,
 * el evento normalizado que cualquier adaptador entrante traduce, y los dos
 * puertos que el orquestador (`run-activity-turn.ts`) usa para persistir y
 * espejar. La implementación real — HTTP + HMAC en
 * `src/adapters/webhooks/`, REST de GitHub en `src/adapters/board/`,
 * SQLite en `src/adapters/memory/` — vive del otro lado de estos puertos e
 * importa de este módulo, nunca al revés: la regla no negociable de
 * `AGENTS.md` es que `src/core/` no importa de `src/adapters/*`, ni del SDK,
 * ni de Node. Este archivo no importa nada — mismo criterio que
 * `src/core/knowledge/knowledge-contract.ts` (Hito 2, tarea 1).
 */

/* ── Tipos canónicos de actividad (esquema del plan, migración 0003) ── */

export const ACTIVIDAD_TIPO_PR_REVIEW = "pr_review";
export const ACTIVIDAD_TIPO_SOLICITUD_INTERNA = "solicitud_interna";
export const ACTIVIDAD_TIPO_INCIDENTE = "incidente";

/** Los tres valores que el esquema acepta. Este hito solo ejercita el primero (ADR 5). */
export const ACTIVIDAD_TIPOS = [
  ACTIVIDAD_TIPO_PR_REVIEW,
  ACTIVIDAD_TIPO_SOLICITUD_INTERNA,
  ACTIVIDAD_TIPO_INCIDENTE,
] as const;
export type ActividadTipo = (typeof ACTIVIDAD_TIPOS)[number];

/* ── Estados canónicos. SQLite es la fuente de verdad; el tablero es espejo ── */

export const ESTADO_PENDIENTE_REVISION = "pendiente_revision";
export const ESTADO_OBSERVADO = "observado";
export const ESTADO_RESUELTO = "resuelto";
export const ESTADO_APROBADO = "aprobado";

export const ACTIVIDAD_ESTADOS = [
  ESTADO_PENDIENTE_REVISION,
  ESTADO_OBSERVADO,
  ESTADO_RESUELTO,
  ESTADO_APROBADO,
] as const;
export type ActividadEstado = (typeof ACTIVIDAD_ESTADOS)[number];

/** Veredicto que el agente emite al cerrar la revisión. NO incluye `pendiente_revision`: ese es un estado inicial, no un juicio. */
export const VEREDICTO_APROBADO = "aprobado";
export const VEREDICTO_OBSERVADO = "observado";
export const VEREDICTO_RESUELTO = "resuelto";
export const VEREDICTOS = [VEREDICTO_APROBADO, VEREDICTO_OBSERVADO, VEREDICTO_RESUELTO] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

/** Prefijo de la línea legible por máquina. Fuente única: lo usa el prompt Y el parser. */
export const VEREDICTO_PREFIX = "VEREDICTO:";

/* ── Evento normalizado: contrato adaptador → composition root ── */

/**
 * Traducción neutral de un evento externo. El Núcleo NUNCA ve un payload de
 * GitHub. Registrar un segundo origen (incidentes de IT) es escribir otro
 * verificador + otro mapper hacia este mismo tipo — sin tocar nada más.
 */
export interface IncomingActivityEvent {
  /** Sistema emisor, p. ej. `"github"`. Solo para logging y ruteo futuro. */
  readonly origen: string;
  /** `"owner/repo"` — clave de `proyectos.id` Y clave de serialización de la cola. */
  readonly proyectoId: string;
  readonly proyectoNombre: string;
  readonly repoUrl: string;
  readonly tipo: ActividadTipo;
  /** Número del Issue/PR, como texto (`actividades.referencia_externa`). */
  readonly referenciaExterna: string;
  /** Login de quien debe actuar (autor del PR). Ausente si el payload no lo trae. */
  readonly responsableId?: string;
  readonly titulo: string;
  readonly cuerpo: string;
  readonly archivosCambiados: readonly string[];
  /** Cuerpo del comentario que disparó el evento (`issue_comment`). Ausente en `pull_request`. */
  readonly comentarioDisparador?: string;
  /** Id de correlación del emisor (`X-GitHub-Delivery`). Ver §9 del diseño. */
  readonly deliveryId: string;
  /** ISO-8601 de recepción. */
  readonly recibidoEn: string;
}

/* ── Actividad tal como el núcleo la maneja ── */

export interface Actividad {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: ActividadTipo;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: ActividadEstado;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ── Puertos ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root.
 *
 * SÍNCRONO a propósito: `better-sqlite3` lo es, y `MemoryContextPort` /
 * `MemoryWritePort` (`src/core/turn-selector/assemble-context.ts` y
 * `close-turn.ts`) ya establecen esa forma en este repo. Además hace
 * visible, sin leer una línea de implementación, que los ÚNICOS `await` del
 * ciclo de actividad son el modelo y el tablero — que es exactamente el
 * punto de interleaving que la cola de `src/core/concurrency/keyed-queue.ts`
 * (ADR 8) existe para serializar.
 *
 * CONTRATO: falla RUIDOSAMENTE. Si el estado canónico no se persiste, el
 * turno mintió — el error propaga como fallo del turno (ADR 6).
 */
export interface ActivityStorePort {
  /** Actividad viva para ese par, o `undefined` si es la primera vez que se ve esa referencia. */
  findActividadPorReferencia(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
  }): Actividad | undefined;

  /** Crea `proyecto` (si no existe), `responsable` (si viene y no existe), `caso` y `actividad` en UNA transacción. */
  createCasoConActividad(input: CreateCasoConActividadInput): Actividad;

  updateActividadEstado(input: {
    readonly actividadId: string;
    readonly estado: ActividadEstado;
    readonly responsableId?: string;
    readonly updatedAt: string;
  }): Actividad;
}

export interface CreateCasoConActividadInput {
  readonly proyecto: {
    readonly id: string;
    readonly nombre: string;
    readonly repoUrl: string;
  };
  readonly responsable?: { readonly id: string; readonly nombre?: string };
  readonly caso: {
    readonly id: string;
    readonly tipo: string;
    readonly estado: string;
  };
  readonly actividad: {
    readonly id: string;
    readonly tipo: ActividadTipo;
    readonly referenciaExterna: string;
    readonly estado: ActividadEstado;
  };
  /** Un único timestamp para `created_at`/`updated_at` de las cuatro filas. */
  readonly timestamp: string;
}

/**
 * Metadatos del PR que alimentan el prompt sintético. NO incluye el diff
 * completo — decisión de alcance del MVP (R4 de la propuesta), reflejada
 * en el tipo para que nadie la reintroduzca por descuido.
 */
export interface PullRequestMetadata {
  readonly titulo: string;
  readonly cuerpo: string;
  readonly autor: string;
  readonly archivosCambiados: readonly string[];
  /** `true` si la lista de archivos se cortó en el tope del adaptador. */
  readonly archivosTruncados: boolean;
}

/**
 * Espejo del estado canónico sobre el tablero externo. Implementado por
 * `src/adapters/board/`, inyectado desde el composition root.
 *
 * CONTRATO: **nunca rechaza y nunca lanza**, ninguno de los tres métodos —
 * mismo contrato que `KnowledgeFeedbackPort`
 * (`src/core/knowledge/knowledge-contract.ts`). Cualquier falla (red, HTTP
 * ≠ 2xx, timeout, JSON inesperado) se traga y se loguea adentro del
 * adaptador. El estado canónico ya se persistió; el tablero es cosmético.
 *
 * El núcleo habla de estados y responsables. NUNCA de labels, ni de números
 * de issue de una API concreta: el mapeo estado → label vive en
 * `src/adapters/board/labels.ts` (ADR 6).
 */
export interface ActivityBoardPort {
  /** `undefined` si no se pudieron leer (sin token, red caída, PR inexistente). */
  leerMetadatos(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly casoId: string;
  }): Promise<PullRequestMetadata | undefined>;

  publicarRevision(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly texto: string;
    readonly casoId: string;
  }): Promise<void>;

  mirrorEstado(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly estado: ActividadEstado;
    readonly responsableId?: string;
    readonly casoId: string;
  }): Promise<void>;
}
