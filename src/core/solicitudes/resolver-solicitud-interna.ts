/**
 * Caso de uso: resolver una solicitud interna (`tui-canal-empleado`, Hito 5,
 * tarea 18, design.md §5.6, ADR 37, ADR 50). PURA y SÍNCRONA, **mismo molde**
 * de `resolverEscalacionReembolso` (`../ventas/resolver-escalacion-reembolso.ts`):
 * sin `await`, sin lógica de concurrencia propia — el CAS lo hace el `store`
 * vía `UPDATE ... WHERE estado = ... RETURNING`; este módulo solo interpreta
 * el resultado.
 *
 * Devuelve el genérico `ResolucionHitlResult<SolicitudInterna, AccionSolicitud,
 * SolicitudEstado>` (ADR 50) en vez de un tipo propio: campos NEUTROS
 * (`items`/`item`/`itemId`), no `solicitud`/`solicitudId` — la razón exacta
 * por la que existe el genérico (`hitl-contract.ts`) en vez de copiar el
 * molde de ventas literal.
 *
 * `sesion: SesionEmpleado` y no `empleadoId: string` — ADR 37: el invariante
 * "todo `empleadoId` que llega a un caso de uso privilegiado fue
 * AUTENTICADO" se expresa en el TIPO, no en un comentario. Importa
 * `SesionEmpleado` de `../auth/sesion.js` — un cruce entre subcarpetas de
 * `src/core/`, no hacia `src/adapters/*` ni el SDK (regla no negociable de
 * `AGENTS.md`).
 */
import {
  LIMITE_LISTADO_SOLICITUDES,
  type ResolucionSolicitudInput,
  type SolicitudEstado,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./solicitudes-contract.js";
import {
  MOTIVO_CAS,
  MOTIVO_NO_ENCONTRADA,
  type ResolucionHitlResult,
} from "../hitl/hitl-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

export const ACCION_APROBAR_SOLICITUD = "aprobar";
export const ACCION_RECHAZAR_SOLICITUD = "rechazar";
export type AccionSolicitud = typeof ACCION_APROBAR_SOLICITUD | typeof ACCION_RECHAZAR_SOLICITUD;

export type ResolverSolicitudResult = ResolucionHitlResult<SolicitudInterna, AccionSolicitud, SolicitudEstado>;

export interface ResolverSolicitudDeps {
  readonly store: SolicitudStorePort;
  /** Genera el `id` de la fila de registro (ADR 39). */
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  /** Tope del listado sin argumento. Default `LIMITE_LISTADO_SOLICITUDES` (20). */
  readonly limiteListado?: number;
}

function aplicarCas(
  store: SolicitudStorePort,
  accion: AccionSolicitud,
  input: ResolucionSolicitudInput,
): SolicitudInterna | undefined {
  return accion === ACCION_APROBAR_SOLICITUD
    ? store.aprobarSolicitud(input)
    : store.rechazarSolicitud(input);
}

/**
 * PURA y SÍNCRONA — sin `await`, molde de `resolverEscalacionReembolso`.
 * Secuencia exacta (design.md §7, tabla de eventos):
 *
 *  A. `solicitudId === undefined` → `store.listarSolicitudesPendientes({ limite })`
 *     → `{ resultado: "listado" }`. Evento `solicitud-listada` con
 *     `{ accion, cantidad }`, `casoId` = `"tui-comando"`. CERO escrituras.
 *  B. `solicitudId` presente → `store.listarSolicitudesPendientes({ solicitudId })`
 *     (ADR 38: filtro por id, NUNCA un lector por id sin filtro de estado).
 *     Vacío → `no_aplicable` con `motivo: MOTIVO_NO_ENCONTRADA`, evento
 *     `solicitud-resolucion-no-aplicable` (`casoId` = `"tui-comando"`: no hay
 *     ningún caso real que correlacionar). ★ NO escribe fila. ★
 *  C. `confirmado === false` → `{ requiere_confirmacion, item }` — evento
 *     `solicitud-resolucion-solicitada` con `{ accion, solicitudId }`.
 *     ★ NI el store NI el registro reciben una sola escritura. ★
 *  D. `confirmado === true` → el método CAS que corresponda
 *     (`aprobarSolicitud`/`rechazarSolicitud`), con `{ solicitudId, casoId,
 *     empleadoId: sesion.empleadoId, accionId: newId(), ahora: now() }`.
 *     `undefined` (el CAS no matcheó) → `no_aplicable` con `motivo: MOTIVO_CAS`.
 *     Fila → evento `solicitud-aprobada`/`solicitud-rechazada`.
 *
 * CERO llamadas al modelo. CERO `await`. Test explícito de sincronía.
 */
export function resolverSolicitudInterna(
  input: {
    readonly accion: AccionSolicitud;
    readonly solicitudId?: string;
    readonly confirmado: boolean;
    readonly sesion: SesionEmpleado;
  },
  deps: ResolverSolicitudDeps,
): ResolverSolicitudResult {
  const { store, newId, now, logEvent } = deps;
  const { accion, solicitudId, confirmado, sesion } = input;

  if (solicitudId === undefined) {
    const limite = deps.limiteListado ?? LIMITE_LISTADO_SOLICITUDES;
    const items = store.listarSolicitudesPendientes({ limite });
    logEvent("tui-comando", "solicitud-listada", { accion, cantidad: items.length });
    return { resultado: "listado", accion, items };
  }

  const encontradas = store.listarSolicitudesPendientes({ solicitudId });
  const solicitud = encontradas[0];

  if (solicitud === undefined) {
    logEvent("tui-comando", "solicitud-resolucion-no-aplicable", {
      accion,
      solicitudId,
      motivo: MOTIVO_NO_ENCONTRADA,
    });
    return { resultado: "no_aplicable", accion, motivo: MOTIVO_NO_ENCONTRADA, itemId: solicitudId };
  }

  if (!confirmado) {
    logEvent(solicitud.casoId, "solicitud-resolucion-solicitada", { accion, solicitudId });
    return { resultado: "requiere_confirmacion", accion, item: solicitud };
  }

  const resolucionInput: ResolucionSolicitudInput = {
    solicitudId,
    casoId: solicitud.casoId,
    empleadoId: sesion.empleadoId,
    accionId: newId(),
    ahora: now(),
  };

  const aplicada = aplicarCas(store, accion, resolucionInput);

  if (aplicada === undefined) {
    logEvent(solicitud.casoId, "solicitud-resolucion-no-aplicable", {
      accion,
      solicitudId,
      motivo: MOTIVO_CAS,
    });
    return {
      resultado: "no_aplicable",
      accion,
      motivo: MOTIVO_CAS,
      itemId: solicitudId,
      casoId: solicitud.casoId,
    };
  }

  const evento = accion === ACCION_APROBAR_SOLICITUD ? "solicitud-aprobada" : "solicitud-rechazada";
  logEvent(solicitud.casoId, evento, { solicitudId, empleadoId: sesion.empleadoId });

  return { resultado: "aplicada", accion, item: solicitud, estadoFinal: aplicada.estado };
}
