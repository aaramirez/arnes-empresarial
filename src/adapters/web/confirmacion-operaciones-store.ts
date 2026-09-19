/**
 * Store en memoria de confirmaciones pendientes de las CUATRO operaciones
 * del canal conversacional que usan confirmación en dos pasos —
 * `cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud` y
 * `solicitar_devolucion` (`aprobacion-conversacional-hitl`, ADR 212/213/214,
 * tarea 2; `devolucion-sin-token-dos-personas`, ADR 229 pto 4, tarea 12 —
 * CERO cambio de código: este módulo ya era genérico sobre
 * `DominioConfirmacion`, sólo cambian dos doc-comments). Implementa
 * `ConfirmacionOperacionPort` (`core/operaciones/operaciones-contract.ts`,
 * tarea 1) — la interfaz vive en el núcleo por convención hexagonal, esta
 * implementación concreta vive acá porque es estado de proceso ligado a la
 * concurrencia HTTP, no lógica de dominio.
 *
 * ★ `Map<empleadoId CRUDO, Map<`${dominio}:${itemId}`, ConfirmacionPendiente>>`
 * (ADR 212): el aislamiento entre empleados es estructural (el `Map` externo
 * indexa por `empleadoId` sin concatenar nada), y el interno multiplexa las
 * tres operaciones sin que se pisen entre sí. `accion` NO entra en la llave
 * interna: entra en el PREDICADO (`coincideConfirmacionConversacional`, ADR
 * 213) — un pedido posterior con `accion` distinta sobre el mismo
 * `dominio`/`itemId` no coincide con la ranura pendiente, la reemplaza y
 * exige su propia confirmación en un turno todavía posterior. Es el hallazgo
 * de seguridad de esta fase: sin esto, "rechazá V1" seguido de "aprobá V1"
 * ejecutaría la aprobación sin eco y sin confirmación.
 *
 * `CONFIRMACIONES_PENDIENTES_MAX = 8` por empleado, con evicción de la
 * ranura MÁS VIEJA (orden de inserción del `Map`) al superar el techo —
 * rota, nunca rechaza (ADR 214 pto 3).
 *
 * `limpiarEmpleado` vive en la interfaz del ADAPTADOR, no en
 * `ConfirmacionOperacionPort` del núcleo: el ciclo de vida de TODAS las
 * ranuras de un empleado es asunto del logout, no del dispatcher de una
 * operación puntual (ADR 214 pto 4).
 *
 * `coincideConfirmacionConversacional` reusa el mismo algoritmo
 * `origenCasoId !== casoIdActual` (ADR 166 pto 3) que ya usa la TUI, escrito
 * LOCALMENTE (sin duplicar el import de otro archivo — sería adaptador
 * importando de otro archivo de composition root, y de todos modos el tipo
 * de la ranura es distinto acá), molde literal de
 * `build-on-comando-empleado.ts:1113-1118`.
 */
import type {
  AccionConfirmable,
  ConfirmacionOperacionPort,
  DominioConfirmacion,
  LlaveConfirmacion,
} from "../../core/operaciones/operaciones-contract.js";

interface ConfirmacionPendiente {
  readonly dominio: DominioConfirmacion;
  readonly itemId: string;
  readonly accion: AccionConfirmable;
  readonly casoId: string;
  readonly empleadoId: string;
  readonly origenCasoId: string;
}

/** `${dominio}:${itemId}` — el `itemId` NUNCA contiene el separador de forma ambigua (ADR 212 pto 3): el prefijo `dominio:` es fijo y cerrado (TRES valores, `devolucion-sin-token-dos-personas` ADR 229 pto 4), así que un `itemId` con ':' adentro no puede confundirse con otro par dominio/itemId. */
function llaveInterna(dominio: DominioConfirmacion, itemId: string): string {
  return `${dominio}:${itemId}`;
}

/**
 * ADR 166 pto 3 — estructuralmente imposible que dos invocaciones de la tool
 * dentro del MISMO `handleTurn` (mismo `casoIdActual`) se autoconfirmen: la
 * primera crea la ranura con `origenCasoId = casoIdActual`; una segunda
 * invocación en el MISMO turno comparte ese mismo `casoIdActual`, así que
 * `pendiente.origenCasoId !== casoIdActual` es `false` y no coincide. Solo
 * un turno POSTERIOR (mensaje nuevo del empleado, `casoId` nuevo) puede
 * confirmar.
 *
 * ★ ADR 213 — cuarta condición: `pendiente.accion === llave.accion`. Sin
 * ella, un cambio de `accion` sobre el mismo `dominio`/`itemId` ejecutaría
 * sin confirmación (ver doc-comment de módulo).
 */
function coincideConfirmacionConversacional(
  pendiente: ConfirmacionPendiente | undefined,
  llave: LlaveConfirmacion,
  empleadoId: string,
  casoIdActual: string,
): boolean {
  return (
    pendiente !== undefined &&
    pendiente.dominio === llave.dominio &&
    pendiente.itemId === llave.itemId &&
    pendiente.accion === llave.accion &&
    pendiente.empleadoId === empleadoId &&
    pendiente.origenCasoId !== casoIdActual
  );
}

export interface ConfirmacionOperacionesStore {
  /** Ranuras propias de `empleadoId` — N empleados concurrentes nunca se pisan. SIN CAMBIO de firma. */
  paraEmpleado(empleadoId: string): ConfirmacionOperacionPort;
  /** ★ NUEVO (ADR 214 pto 4): borra TODAS las ranuras del empleado. Para `handleLogout`. Idempotente. */
  limpiarEmpleado(empleadoId: string): void;
}

/** Techo por empleado; al superarlo evicta la ranura más vieja (ADR 214 pto 3). */
export const CONFIRMACIONES_PENDIENTES_MAX = 8;

export function crearConfirmacionOperacionesStore(): ConfirmacionOperacionesStore {
  const pendientes = new Map<string, Map<string, ConfirmacionPendiente>>();

  return {
    paraEmpleado(empleadoId: string): ConfirmacionOperacionPort {
      return {
        estaConfirmada(llave, empleadoIdVerificado, casoIdActual) {
          const ranurasEmpleado = pendientes.get(empleadoId);
          return coincideConfirmacionConversacional(
            ranurasEmpleado?.get(llaveInterna(llave.dominio, llave.itemId)),
            llave,
            empleadoIdVerificado,
            casoIdActual,
          );
        },
        marcarPendiente(input) {
          let ranurasEmpleado = pendientes.get(empleadoId);
          if (ranurasEmpleado === undefined) {
            ranurasEmpleado = new Map<string, ConfirmacionPendiente>();
            pendientes.set(empleadoId, ranurasEmpleado);
          }

          const clave = llaveInterna(input.dominio, input.itemId);
          // Rota, nunca rechaza (ADR 214 pto 3): al superar el techo, evicta
          // la ranura MÁS VIEJA (el `Map` de JS conserva orden de inserción).
          // Si la llave YA existe, `.set` la reemplaza sin sumar al conteo,
          // así que sólo evictamos cuando el techo se supera con una llave
          // NUEVA.
          if (!ranurasEmpleado.has(clave) && ranurasEmpleado.size >= CONFIRMACIONES_PENDIENTES_MAX) {
            const masVieja = ranurasEmpleado.keys().next().value;
            if (masVieja !== undefined) {
              ranurasEmpleado.delete(masVieja);
            }
          }
          ranurasEmpleado.set(clave, input);
        },
        consumir(llave) {
          const ranurasEmpleado = pendientes.get(empleadoId);
          ranurasEmpleado?.delete(llaveInterna(llave.dominio, llave.itemId));
          // Libera el Map interno cuando queda vacío -- si no, un empleado
          // que confirma sin desloguearse deja un Map vacío colgado hasta el
          // próximo logout (hallazgo no bloqueante de code-review, Unit 1).
          if (ranurasEmpleado?.size === 0) {
            pendientes.delete(empleadoId);
          }
        },
      };
    },
    limpiarEmpleado(empleadoId: string): void {
      pendientes.delete(empleadoId);
    },
  };
}
