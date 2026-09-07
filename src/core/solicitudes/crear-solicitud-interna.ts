/**
 * Alta de solicitud interna con validación delegada (Hito 5, tarea 17,
 * design.md §4.2 + §5.6, ADR 40, ADR 43).
 *
 * Flujo (design.md §4.2, Entregable B):
 *  1. Valida `tipo ∈ SOLICITUD_TIPOS` ANTES de escribir nada — tipo
 *     desconocido devuelve `{ resultado: "tipo_desconocido" }` sin tocar el
 *     `store` (cero escrituras).
 *  2. `store.crearSolicitudConCaso(...)` — UNA transacción (documentada así
 *     en `SolicitudStorePort`, `solicitudes-contract.ts`): crea `caso` +
 *     `solicitudes_internas` juntos.
 *  3. Delega al subagente `validador-solicitudes` vía `despacharDelegacion`
 *     (`../turn-selector/dispatch-delegation.js`, tarea 8) con
 *     `insumo.material` = tipo + detalle EXCLUSIVAMENTE — nunca el
 *     `solicitanteId` ni ningún historial de sesión u otras solicitudes
 *     (spec `solicitud-interna-hitl`, escenario "El subagente validador no
 *     ve el historial de otras solicitudes").
 *  4. `store.adjuntarDictamen(...)` — escribe el dictamen SIN transicionar
 *     `estado` (sigue `pendiente_aprobacion_humana`; la transición es
 *     responsabilidad de `resolver-solicitud-interna.ts`, tarea 18).
 *
 * Degradación de fallo (ADR 40, MISMO molde que `manejarSoporte`,
 * `build-on-comando-empleado.ts:278-297`): si la delegación al validador
 * falla (`despacharDelegacion` rechaza), la solicitud YA creada por el paso 2
 * queda sin dictamen — el efecto de negocio (la solicitud existe) ya
 * ocurrió, así que la función NO relanza el error; degrada a un evento
 * `solicitud-validacion-fallida` y devuelve la solicitud tal como quedó.
 *
 * Imports: `../hitl/hitl-contract.js`, `../agents/definitions.js`,
 * `../turn-selector/dispatch-delegation.js`, `./solicitudes-contract.js` —
 * todos núcleo → núcleo (regla de `AGENTS.md`: `src/core/` nunca importa de
 * `src/adapters/*`, ni del SDK, ni de Node).
 */
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";
import { VALIDADOR_SOLICITUDES_AGENT_ID } from "../agents/definitions.js";
import {
  despacharDelegacion,
  type DespacharDelegacionDeps,
} from "../turn-selector/dispatch-delegation.js";
import {
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_TIPOS,
  type SolicitudInterna,
  type SolicitudStorePort,
  type SolicitudTipo,
} from "./solicitudes-contract.js";

/**
 * `caso.tipo` para el `caso` que acompaña a toda solicitud interna. Literal
 * (no una constante exportada de `solicitudes-contract.ts`): sigue el mismo
 * valor ya usado por los dobles de `solicitudes-contract.test.ts` (tarea 16,
 * ya commiteada, líneas 218/244/283) y por `ACTIVIDAD_TIPO_SOLICITUD_INTERNA`
 * (`activity-contract.ts`) — mismo string, dominio distinto (`casos.tipo` acá,
 * `actividades.tipo` allá), sin acoplar ambos módulos entre sí.
 */
const CASO_TIPO_SOLICITUD_INTERNA = "solicitud_interna";

export interface CrearSolicitudInternaInput {
  /**
   * SIN tipar como `SolicitudTipo`: el parser (`comando-empleado.ts`) es
   * puro y sin imports por contrato (design.md §5.7) — la validación del
   * tipo es responsabilidad de ESTE caso de uso.
   */
  readonly tipo: string;
  readonly detalle: string;
  /** `empleadoId` de la sesión vigente que ejecuta `/solicitar` (ADR 37). */
  readonly solicitanteId: string;
}

export interface CrearSolicitudInternaDeps {
  readonly store: SolicitudStorePort;
  /**
   * Reutilizada tal cual para `despacharDelegacion`: `newId`/`now`/`logEvent`
   * de acá son los MISMOS que genera `casoId`/`solicitudId`/el timestamp de
   * alta — un solo reloj y un solo generador de ids para todo el caso de uso,
   * mismo criterio que `despacharCadena` reusando sus propias `deps`.
   */
  readonly despacharDeps: DespacharDelegacionDeps;
}

export type CrearSolicitudInternaResult =
  | { readonly resultado: "tipo_desconocido" }
  | { readonly resultado: "creada"; readonly solicitud: SolicitudInterna };

function esTipoConocido(tipo: string): tipo is SolicitudTipo {
  return (SOLICITUD_TIPOS as readonly string[]).includes(tipo);
}

/**
 * `async` (delega al validador). Ver doc-comment de módulo para el flujo
 * completo y la degradación de fallo (ADR 40).
 */
export async function crearSolicitudInterna(
  input: CrearSolicitudInternaInput,
  deps: CrearSolicitudInternaDeps,
): Promise<CrearSolicitudInternaResult> {
  if (!esTipoConocido(input.tipo)) {
    return { resultado: "tipo_desconocido" };
  }

  const { store, despacharDeps } = deps;
  const { newId, now, logEvent } = despacharDeps;

  const casoId = newId();
  const solicitudId = newId();
  const timestamp = now();

  const solicitudCreada = store.crearSolicitudConCaso({
    caso: {
      id: casoId,
      tipo: CASO_TIPO_SOLICITUD_INTERNA,
      estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
    },
    solicitud: {
      id: solicitudId,
      solicitanteId: input.solicitanteId,
      tipo: input.tipo,
      detalle: input.detalle,
      estado: SOLICITUD_ESTADO_PENDIENTE,
    },
    timestamp,
  });

  logEvent(casoId, "solicitud-creada", { solicitudId, tipo: input.tipo });

  try {
    const aplicada = await despacharDelegacion(
      {
        casoId,
        agentId: VALIDADOR_SOLICITUDES_AGENT_ID,
        insumo: {
          instruccion:
            "Evaluá si esta solicitud interna está completa y cumple las reglas conocidas, y emití tu dictamen. No apruebes ni rechaces la solicitud — esa decisión la toma un empleado autenticado.",
          // EXCLUSIVAMENTE tipo + detalle — jamás el solicitanteId ni ningún
          // historial de sesión u otras solicitudes (spec, escenario "El
          // subagente validador no ve el historial de otras solicitudes").
          material: `Tipo: ${input.tipo}\nDetalle: ${input.detalle}`,
        },
      },
      despacharDeps,
    );

    logEvent(casoId, "solicitud-validada", { solicitudId, delegacionId: aplicada.delegacionId });

    const conDictamen = store.adjuntarDictamen({
      solicitudId,
      dictamen: aplicada.resultado,
      ahora: now(),
    });

    return { resultado: "creada", solicitud: conDictamen ?? solicitudCreada };
  } catch (error) {
    // ADR 40 — mismo molde que `manejarSoporte`
    // (`build-on-comando-empleado.ts:278-297`): el efecto de negocio (la
    // solicitud existe) ya ocurrió; degrada a evento, NO relanza.
    logEvent(casoId, "solicitud-validacion-fallida", {
      solicitudId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { resultado: "creada", solicitud: solicitudCreada };
  }
}
