/**
 * Política de readiness (hijo 3, ADR 258, S14) — función PURA y TOTAL, SIN
 * UNA SOLA LÍNEA DE `import`. A PROPÓSITO: vive en el adaptador (no en
 * `core/`) porque la salud del proceso NO es vocabulario de negocio —
 * mismo criterio con el que `core/ventas/ventas-config.ts` deja escrito
 * por qué NO lee entorno. Cero imports hace el requirement testeable por
 * ESTRUCTURA (`arquitectura.test.ts`), no solo por prosa: es la garantía de
 * que esta política no puede, ni por accidente, tocar `db`, el logger de
 * negocio, `process`, ni ningún adaptador.
 *
 * Prioridad FIJA `cerrando > base > listener` (ADR 257 §5.3): durante un
 * despliegue los tres hechos pueden ser ciertos a la vez, y el operador
 * debe leer primero la causa raíz BENIGNA — `cerrando` es la única de las
 * tres que no es una falla, es el proceso haciendo exactamente lo que se
 * le pidió.
 */

/** El motivo por el que `/salud/listo` no está lista. Ausente (`undefined`) = lista. */
export type MotivoNoListo = "cerrando" | "base" | "listener";

/** Los tres hechos que la política evalúa, inyectados por el composition root vía `OpsSaludPort`. */
export interface EstadoSalud {
  readonly cerrando: boolean;
  readonly baseUtilizable: boolean;
  readonly listenersCaidos: number;
}

/**
 * PURA y TOTAL: cubre las 8 combinaciones de los tres hechos sin ninguna
 * rama oculta. `undefined` (listo) ocurre EXCLUSIVAMENTE cuando los tres
 * son sanos (`!cerrando && baseUtilizable && listenersCaidos === 0`).
 */
export function evaluarReadiness(estado: EstadoSalud): MotivoNoListo | undefined {
  if (estado.cerrando) return "cerrando";
  if (!estado.baseUtilizable) return "base";
  if (estado.listenersCaidos > 0) return "listener";
  return undefined;
}
