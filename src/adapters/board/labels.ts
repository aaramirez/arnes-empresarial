import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  ESTADO_RESUELTO,
  type ActividadEstado,
} from "../../core/activity/activity-contract.js";

/** Mapeo literal del plan. Vive acá y NO en el núcleo (ADR 6): es vocabulario de GitHub. */
export const ESTADO_LABELS: Readonly<Record<ActividadEstado, string>> = {
  [ESTADO_PENDIENTE_REVISION]: "necesita-revision",
  [ESTADO_OBSERVADO]: "observaciones-pendientes",
  [ESTADO_RESUELTO]: "resuelto",
  [ESTADO_APROBADO]: "aprobado",
};

/** Los cuatro labels que este adaptador administra. Ningún otro label del Issue se toca. */
export const MANAGED_LABELS: readonly string[] = Object.values(ESTADO_LABELS);

export function labelForEstado(estado: ActividadEstado): string {
  return ESTADO_LABELS[estado];
}

/**
 * Dada la lista actual de labels del Issue, devuelve la lista que debe
 * quedar: se quitan TODOS los `MANAGED_LABELS` y se agrega el de `estado`.
 *
 * Esto es lo que satisface literalmente el escenario del spec "queda con el
 * label `aprobado` (y sin los otros tres labels de estado)" SIN borrar
 * labels que el equipo puso a mano (`bug`, `docs`, ...). Preserva el orden
 * relativo de los labels no administrados.
 *
 * Pura, no lanza para ningún input razonable: una lista vacía o con
 * duplicados simplemente produce el resultado esperado sin excepción.
 */
export function mergeLabels(
  labelsActuales: readonly string[],
  estado: ActividadEstado,
): readonly string[] {
  const sinAdministrados = labelsActuales.filter((label) => !MANAGED_LABELS.includes(label));
  return [...sinAdministrados, labelForEstado(estado)];
}
