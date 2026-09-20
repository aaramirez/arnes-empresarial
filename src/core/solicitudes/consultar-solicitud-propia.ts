/**
 * Caso de uso: consulta puntual (o listado) de solicitudes internas propias
 * (`consulta-solicitud-propia`, ADR 238). Hermano exacto de
 * `src/core/ventas/consultar-venta-propia.ts`: PURO y SÍNCRONO — sin `await`,
 * sin lógica de concurrencia propia.
 *
 * CERO ESCRITURAS en cualquier rama: este módulo no importa ningún puerto de
 * escritura, sólo `ConsultaSolicitudPropiaPort` (sólo lectura).
 *
 * El gate de alcance ("¿esta solicitud es del solicitante que consulta?")
 * vive ACÁ, dentro del núcleo — nunca en el store (que no filtra por
 * solicitante a propósito, ADR 237 pto 1) ni en el dispatcher
 * (`ejecutar-operacion.ts`, ADR 238 pto 3, test mecánico). "Ajena"
 * (`no_autorizada`) tiene que ser distinguible de "no existe"
 * (`no_encontrada`).
 */
import { type ConsultaSolicitudPropiaPort, type SolicitudPropia } from "./consulta-solicitud-propia-contract.js";

export interface ConsultarSolicitudPropiaDeps {
  readonly consulta: ConsultaSolicitudPropiaPort;
}

/**
 * `no_encontrada`/`no_autorizada` llevan `solicitudId` para que el dispatcher
 * pueda nombrar la solicitud en el texto — ninguna de las dos rutas escribe
 * fila de auditoría.
 */
export type ConsultarSolicitudPropiaResult =
  | { readonly resultado: "listado"; readonly items: readonly SolicitudPropia[] }
  | { readonly resultado: "no_encontrada"; readonly solicitudId: string }
  | { readonly resultado: "no_autorizada"; readonly solicitudId: string }
  | { readonly resultado: "detalle"; readonly solicitud: SolicitudPropia };

/**
 * `solicitudId` ausente ⇒ listado de TODAS las solicitudes propias del
 * solicitante, cualquier estado. Con `solicitudId`: `buscarPorId` (SIN filtro
 * de solicitante, ADR 237 pto 1) ⇒ `undefined` ⇒ `no_encontrada`;
 * `solicitanteId !== empleadoId` ⇒ `no_autorizada`; coincide ⇒ `detalle`.
 */
export function consultarSolicitudPropia(
  input: { readonly solicitudId?: string; readonly empleadoId: string },
  deps: ConsultarSolicitudPropiaDeps,
): ConsultarSolicitudPropiaResult {
  const { consulta } = deps;

  if (input.solicitudId === undefined) {
    return { resultado: "listado", items: consulta.listarDeSolicitante({ solicitanteId: input.empleadoId }) };
  }

  const solicitud = consulta.buscarPorId(input.solicitudId);

  if (solicitud === undefined) {
    return { resultado: "no_encontrada", solicitudId: input.solicitudId };
  }

  if (solicitud.solicitanteId !== input.empleadoId) {
    return { resultado: "no_autorizada", solicitudId: input.solicitudId };
  }

  return { resultado: "detalle", solicitud };
}
