/**
 * Puerto de consulta de actividad para el turno A2A entrante, de sólo
 * lectura (`consultas-negocio-a2a-entrante`, tarea 1, ADR 182 pto 3, ADR 187).
 *
 * Único método: buscar la actividad viva para un par
 * (`proyectoId`, `referenciaExterna`) — el mismo par que ya usa el flujo de
 * webhooks (`ActivityStorePort.findActividadPorReferencia`) y el mismo par
 * que los ejemplos del Agent Card usan ("PR 42 del proyecto X").
 *
 * **No expone la lectura por id interno de `repository.ts`** (`:465-472`):
 * el UUID interno de `actividades` no tiene ningún camino de descubrimiento
 * hacia un llamador A2A externo — inventarle uno sería superficie muerta,
 * nunca alcanzable en la práctica (ADR 187).
 *
 * Implementado por un closure sobre `findActividadPorReferencia`
 * (`src/adapters/memory/repository.ts`), inyectado inline desde el
 * composition root — sin `createXStore` (mismo estilo que `ReporteStorePort`).
 *
 * Sin imports salvo `../activity/activity-contract.js` (tipo `ActividadEstado`).
 */
import type { ActividadEstado } from "../activity/activity-contract.js";

/**
 * Proyección de sólo lectura de una actividad, recortada de datos personales
 * (ADR 180): SIN `responsableId` ni `id` interno.
 */
export interface ActividadResumen {
  readonly estado: ActividadEstado;
  readonly updatedAt: string;
}

export interface ConsultaActividadPort {
  /** Actividad viva para ese par, o `undefined` si no existe (misma semántica que `ActivityStorePort.findActividadPorReferencia`). */
  buscarPorReferencia(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
  }): ActividadResumen | undefined;
}
