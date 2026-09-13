/**
 * Store en memoria de confirmaciones pendientes de `cancelar_solicitud_interna`
 * (`operaciones-negocio-conversacionales`, ADR 173 pto 4, tarea 8). Implementa
 * `ConfirmacionOperacionPort` (`core/operaciones/operaciones-contract.ts`,
 * tarea 1/5) — la interfaz vive en el núcleo por convención hexagonal, esta
 * implementación concreta vive acá porque es estado de proceso ligado a la
 * concurrencia HTTP, no lógica de dominio.
 *
 * `Map<empleadoId, ConfirmacionPendiente>` — un tipo NUEVO e INDEPENDIENTE
 * del `ConfirmacionPendiente` de `build-on-comando-empleado.ts` (nunca se
 * importa ni se extiende ese archivo, ver `tasks.md` reconciliación 1): acá
 * solo existe UN flujo de confirmación (`cancelar_solicitud_interna`), así
 * que no hace falta el campo `dominio`/`accion` que sí necesita la ranura
 * única de la TUI (que también sirve a `manejarEscalacion`).
 *
 * `coincideCancelacionConversacional` reusa el mismo algoritmo
 * `origenCasoId !== casoIdActual` (ADR 166 pto 3) que ya usa la TUI, escrito
 * LOCALMENTE (sin duplicar el import de otro archivo — sería adaptador
 * importando de otro archivo de composition root, y de todos modos el tipo
 * de la ranura es distinto acá).
 */
import type { ConfirmacionOperacionPort } from "../../core/operaciones/operaciones-contract.js";

interface ConfirmacionPendiente {
  readonly solicitudId: string;
  readonly casoId: string;
  readonly empleadoId: string;
  readonly origenCasoId: string;
}

/**
 * ADR 166 pto 3 — estructuralmente imposible que dos invocaciones de la tool
 * dentro del MISMO `handleTurn` (mismo `casoIdActual`) se autoconfirmen: la
 * primera crea la ranura con `origenCasoId = casoIdActual`; una segunda
 * invocación en el MISMO turno comparte ese mismo `casoIdActual`, así que
 * `pendiente.origenCasoId !== casoIdActual` es `false` y no coincide. Solo
 * un turno POSTERIOR (mensaje nuevo del empleado, `casoId` nuevo) puede
 * confirmar.
 */
function coincideCancelacionConversacional(
  pendiente: ConfirmacionPendiente | undefined,
  solicitudId: string,
  empleadoId: string,
  casoIdActual: string,
): boolean {
  return (
    pendiente !== undefined &&
    pendiente.solicitudId === solicitudId &&
    pendiente.empleadoId === empleadoId &&
    pendiente.origenCasoId !== casoIdActual
  );
}

export interface ConfirmacionOperacionesStore {
  /** Ranura propia de `empleadoId` — N empleados concurrentes nunca se pisan. */
  paraEmpleado(empleadoId: string): ConfirmacionOperacionPort;
}

export function crearConfirmacionOperacionesStore(): ConfirmacionOperacionesStore {
  const pendientes = new Map<string, ConfirmacionPendiente>();

  return {
    paraEmpleado(empleadoId: string): ConfirmacionOperacionPort {
      return {
        estaConfirmada(solicitudId, empleadoIdVerificado, casoIdActual) {
          return coincideCancelacionConversacional(
            pendientes.get(empleadoId),
            solicitudId,
            empleadoIdVerificado,
            casoIdActual,
          );
        },
        marcarPendiente(input) {
          pendientes.set(empleadoId, input);
        },
        consumir() {
          pendientes.delete(empleadoId);
        },
      };
    },
  };
}
