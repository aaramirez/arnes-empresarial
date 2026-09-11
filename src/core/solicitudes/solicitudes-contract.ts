/**
 * Contrato de solicitud interna (Hito 5, tarea 16, ADR 42, ADR 49, design.md §5.6).
 *
 * Lo único que el Núcleo sabe sobre solicitudes internas de empleado
 * (vacaciones, gasto): el vocabulario canónico de `solicitudes_internas.tipo`
 * y `.estado`, la entidad tal como el núcleo la maneja, y el puerto
 * `SolicitudStorePort` que los casos de uso (`crear-solicitud-interna.ts`,
 * `resolver-solicitud-interna.ts`) usan. La implementación real vive del
 * otro lado de este puerto (`src/adapters/memory/repository.ts`) e importa
 * de este módulo, nunca al revés: la regla no negociable de `AGENTS.md` es
 * que `src/core/` no importa de `src/adapters/*`, ni del SDK, ni de Node.
 *
 * Este archivo importa **únicamente** de `../hitl/hitl-contract.js` — un
 * cruce núcleo → núcleo limitado y justificado, mismo criterio que
 * `resolver-escalacion-reembolso.ts` → `../auth/sesion.js`: solicitud
 * interna es el SEGUNDO dueño semántico de `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`
 * (el primero es ventas, vía `ventas-contract.ts`), así que
 * `SOLICITUD_ESTADO_PENDIENTE` se IMPORTA desde `hitl-contract.ts` en vez de
 * redeclarar el literal — una sola fuente de verdad para el mismo valor.
 */
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";

/* ── Vocabulario canónico de `solicitudes_internas.tipo` ── */
// `tipo` es TEXT abierto SIN CHECK en la migración 0008 — mismo criterio que
// `casos.estado`/`ventas.estado`/`actividades.estado`: el vocabulario
// canónico vive acá, el SQL no lo conoce.

export const SOLICITUD_TIPO_VACACIONES = "vacaciones";
export const SOLICITUD_TIPO_GASTO = "gasto";
export const SOLICITUD_TIPOS = [SOLICITUD_TIPO_VACACIONES, SOLICITUD_TIPO_GASTO] as const;
export type SolicitudTipo = (typeof SOLICITUD_TIPOS)[number];

/* ── Vocabulario canónico de `solicitudes_internas.estado` ── */

/**
 * MISMO valor que `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` (ADR 42): una
 * solicitud interna recién creada, o con dictamen del validador ya adjunto
 * pero sin resolución humana, comparte el estado HITL genérico con una
 * venta escalada. Se IMPORTA, no se redeclara.
 */
export const SOLICITUD_ESTADO_PENDIENTE = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA;
export const SOLICITUD_ESTADO_APROBADA = "aprobada";
export const SOLICITUD_ESTADO_RECHAZADA = "rechazada";
/** Retiro por el propio autor, distinto de `rechazada` (auditoría: `resuelta_por` = el autor, no un tercero). */
export const SOLICITUD_ESTADO_CANCELADA = "cancelada";
export type SolicitudEstado =
  | typeof SOLICITUD_ESTADO_PENDIENTE
  | typeof SOLICITUD_ESTADO_APROBADA
  | typeof SOLICITUD_ESTADO_RECHAZADA
  | typeof SOLICITUD_ESTADO_CANCELADA;

/** Tope del listado sin argumento, espejo de `LIMITE_LISTADO_ESCALACIONES` (`ventas-contract.ts`). */
export const LIMITE_LISTADO_SOLICITUDES = 20;

/* ── Entidad tal como el núcleo la maneja ── */

export interface SolicitudInterna {
  readonly id: string;
  readonly casoId: string;
  readonly solicitanteId: string;
  readonly tipo: SolicitudTipo;
  readonly detalle: string;
  readonly estado: SolicitudEstado;
  /** `undefined` = el subagente validador no corrió o falló — la ausencia es la traza del fallo, no un bug. */
  readonly dictamen?: string;
  readonly dictaminadaAt?: string;
  /** Escritos por el CAS de `/aprobar-solicitud`/`/rechazar-solicitud`/`/cancelar-solicitud` (ADR 131: cancelar también es una resolución, el autor queda como `resueltaPor`). */
  readonly resueltaPor?: string;
  readonly resueltaAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ── Puerto ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root.
 *
 * SÍNCRONO a propósito, igual que `VentaStorePort`/`ActivityStorePort`:
 * `better-sqlite3` lo es. CONTRATO: falla RUIDOSAMENTE. Si el estado
 * canónico no se persiste, no hay solicitud — el error propaga.
 */
export interface SolicitudStorePort {
  /** `createCaso` + `INSERT solicitudes_internas`, en UNA transacción. */
  crearSolicitudConCaso(input: CrearSolicitudConCasoInput): SolicitudInterna;

  /** Escribe `dictamen`/`dictaminada_at` SIN transicionar `estado`. `undefined` = no existe la solicitud. */
  adjuntarDictamen(input: {
    readonly solicitudId: string;
    readonly dictamen: string;
    readonly ahora: string;
  }): SolicitudInterna | undefined;

  /**
   * `estado = SOLICITUD_ESTADO_PENDIENTE`, filtrable por id (ADR 38 de `v1.4.0`:
   * nunca un lector por id sin filtro de estado) y, desde ADR 144, por
   * `solicitanteId`. Ese filtro lo usa SÓLO el listado sin id de
   * `/cancelar-solicitud`: la búsqueda POR ID no lo pasa nunca, porque necesita
   * encontrar la solicitud ajena para que el chequeo de dueño devuelva
   * `no_es_dueno` en vez de `no_encontrada` (ADR 126, alternativa rechazada 3).
   * Default `LIMITE_LISTADO_SOLICITUDES`.
   */
  listarSolicitudesPendientes(filtro?: {
    readonly solicitudId?: string;
    readonly solicitanteId?: string; // ★ ADR 144
    readonly limite?: number;
  }): readonly SolicitudInterna[];

  /**
   * COMPARE-AND-SWAP + `updateCaso(resuelto)` + fila de registro, en UNA
   * transacción. `undefined` = el CAS no matcheó (la solicitud ya no estaba
   * `SOLICITUD_ESTADO_PENDIENTE`) — en ese caso NADA se escribe.
   */
  aprobarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;

  /** Idéntico a `aprobarSolicitud`, transiciona a `SOLICITUD_ESTADO_RECHAZADA`. */
  rechazarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;

  /** Idéntico a `aprobarSolicitud`, transiciona a `SOLICITUD_ESTADO_CANCELADA`. */
  cancelarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;
}

export interface CrearSolicitudConCasoInput {
  readonly caso: { readonly id: string; readonly tipo: string; readonly estado: string };
  readonly solicitud: {
    readonly id: string;
    readonly solicitanteId: string;
    readonly tipo: SolicitudTipo;
    readonly detalle: string;
    readonly estado: SolicitudEstado;
  };
  /** Un único timestamp para `created_at`/`updated_at` de ambas filas. */
  readonly timestamp: string;
}

export interface ResolucionSolicitudInput {
  readonly solicitudId: string;
  readonly casoId: string;
  /** SIEMPRE de una sesión vigente (ADR 37, mismo criterio que `ResolucionEscalacionInput`). */
  readonly empleadoId: string;
  /** `id` de la fila de registro, generado por el núcleo (ADR 39). */
  readonly accionId: string;
  /** `updated_at` del caso Y `ocurrido_at`/`resuelta_at` de la fila. UNO solo, a propósito. */
  readonly ahora: string;
}
