/**
 * Caso de uso: resolver una propuesta de cambio (`aplicar`/`descartar`,
 * Hito 5.1, tarea 20, design.md §5.7, ADR 37, ADR 50, ADR 64). PURA y
 * SÍNCRONA, **mismo molde** de `resolverSolicitudInterna`
 * (`../solicitudes/resolver-solicitud-interna.ts`) / `resolverEscalacionReembolso`
 * (`../ventas/resolver-escalacion-reembolso.ts`): sin `await`, sin lógica de
 * concurrencia propia — el CAS lo hace el `store` vía
 * `UPDATE ... WHERE estado = ... RETURNING`; este módulo solo interpreta el
 * resultado.
 *
 * Devuelve el genérico `ResolucionHitlResult<PropuestaCambio, AccionPropuesta,
 * PropuestaEstado>` (ADR 50) en vez de un tipo propio: campos NEUTROS
 * (`items`/`item`/`itemId`), no `propuesta`/`propuestaId` sueltos.
 *
 * `sesion: SesionEmpleado` y no `empleadoId: string` — ADR 37: el invariante
 * "todo `empleadoId` que llega a un caso de uso privilegiado fue
 * AUTENTICADO" se expresa en el TIPO, no en un comentario. Importa
 * `SesionEmpleado` de `../auth/sesion.js` — un cruce entre subcarpetas de
 * `src/core/`, no hacia `src/adapters/*` ni el SDK (regla no negociable de
 * `AGENTS.md`).
 *
 * **El `git apply --check` NO está acá** (ADR 64): cuando este resolvedor
 * corre con `confirmado: true`, la verificación ya pasó en el dispatcher
 * (capa de wiring, PR6). Este módulo no importa ningún puerto de `git`, no
 * hace ningún `await` y no conoce el concepto de "conflicto" — sólo
 * interpreta si el CAS del store matcheó o no.
 *
 * **Nota sobre el tag `"no_aplicable"`, para que nadie lo confunda con
 * RD-12**: acá es el resultado de una INVOCACIÓN del resolvedor —
 * `MOTIVO_NO_ENCONTRADA` o `MOTIVO_CAS`, ambos de `hitl-contract.ts` — no un
 * estado persistido. `propuestas_cambio.estado` sigue teniendo exactamente
 * tres valores (`propuestas-contract.ts`, tarea 17); ese vocabulario no se
 * toca acá.
 */
import {
  LIMITE_LISTADO_PROPUESTAS,
  type PropuestaCambio,
  type PropuestaEstado,
  type PropuestaStorePort,
  type ResolucionPropuestaInput,
} from "./propuestas-contract.js";
import {
  MOTIVO_CAS,
  MOTIVO_NO_ENCONTRADA,
  type ResolucionHitlResult,
} from "../hitl/hitl-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

export const ACCION_APLICAR_PROPUESTA = "aplicar";
export const ACCION_DESCARTAR_PROPUESTA = "descartar";
export type AccionPropuesta = typeof ACCION_APLICAR_PROPUESTA | typeof ACCION_DESCARTAR_PROPUESTA;

export type ResolverPropuestaResult = ResolucionHitlResult<PropuestaCambio, AccionPropuesta, PropuestaEstado>;

export interface ResolverPropuestaDeps {
  readonly store: PropuestaStorePort;
  /** Genera el `id` de la fila de registro (ADR 39). */
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  /** Tope del listado sin argumento. Default `LIMITE_LISTADO_PROPUESTAS` (20). */
  readonly limiteListado?: number;
}

function aplicarCas(
  store: PropuestaStorePort,
  accion: AccionPropuesta,
  input: ResolucionPropuestaInput,
): PropuestaCambio | undefined {
  return accion === ACCION_APLICAR_PROPUESTA
    ? store.aplicarPropuesta(input)
    : store.descartarPropuesta(input);
}

/**
 * PURA y SÍNCRONA — sin `await`, molde de `resolverSolicitudInterna`.
 * Secuencia exacta (design.md §5.7):
 *
 *  A. `propuestaId === undefined` → `store.listarPropuestasPendientes({ limite })`
 *     → `{ resultado: "listado" }`. Evento `propuesta-listada` con
 *     `{ accion, cantidad }`, `casoId` = `"tui-comando"`. CERO escrituras.
 *  B. `propuestaId` presente → `store.listarPropuestasPendientes({ propuestaId })`
 *     (ADR 38: filtro por id, NUNCA un lector por id sin filtro de estado).
 *     Vacío → `no_aplicable` con `motivo: MOTIVO_NO_ENCONTRADA`, evento
 *     `propuesta-resolucion-no-aplicable` (`casoId` = `"tui-comando"`: no hay
 *     ningún caso real que correlacionar). ★ NO escribe fila. ★
 *  C. `confirmado === false` → `{ requiere_confirmacion, item }` — evento
 *     `propuesta-resolucion-solicitada` con `{ accion, propuestaId }`.
 *     ★ NI el store NI el registro reciben una sola escritura. ★
 *  D. `confirmado === true` → el método CAS que corresponda
 *     (`aplicarPropuesta`/`descartarPropuesta`), con `{ propuestaId, casoId,
 *     empleadoId: sesion.empleadoId, accionId: newId(), ahora: now(), motivo? }`.
 *     `undefined` (el CAS no matcheó) → `no_aplicable` con `motivo: MOTIVO_CAS`.
 *     Fila → evento `propuesta-aplicada`/`propuesta-descartada`.
 *
 * CERO llamadas a `git`. CERO `await`. Test explícito de sincronía.
 */
export function resolverPropuestaCambio(
  input: {
    readonly accion: AccionPropuesta;
    readonly propuestaId?: string;
    readonly motivo?: string;
    readonly confirmado: boolean;
    readonly sesion: SesionEmpleado;
  },
  deps: ResolverPropuestaDeps,
): ResolverPropuestaResult {
  const { store, newId, now, logEvent } = deps;
  const { accion, propuestaId, motivo, confirmado, sesion } = input;

  if (propuestaId === undefined) {
    const limite = deps.limiteListado ?? LIMITE_LISTADO_PROPUESTAS;
    const items = store.listarPropuestasPendientes({ limite });
    logEvent("tui-comando", "propuesta-listada", { accion, cantidad: items.length });
    return { resultado: "listado", accion, items };
  }

  const encontradas = store.listarPropuestasPendientes({ propuestaId });
  const propuesta = encontradas[0];

  if (propuesta === undefined) {
    logEvent("tui-comando", "propuesta-resolucion-no-aplicable", {
      accion,
      propuestaId,
      motivo: MOTIVO_NO_ENCONTRADA,
    });
    return { resultado: "no_aplicable", accion, motivo: MOTIVO_NO_ENCONTRADA, itemId: propuestaId };
  }

  if (!confirmado) {
    logEvent(propuesta.casoId, "propuesta-resolucion-solicitada", { accion, propuestaId });
    return { resultado: "requiere_confirmacion", accion, item: propuesta };
  }

  const resolucionInput: ResolucionPropuestaInput = {
    propuestaId,
    casoId: propuesta.casoId,
    empleadoId: sesion.empleadoId,
    accionId: newId(),
    ahora: now(),
    ...(accion === ACCION_DESCARTAR_PROPUESTA && motivo !== undefined ? { motivo } : {}),
  };

  const aplicada = aplicarCas(store, accion, resolucionInput);

  if (aplicada === undefined) {
    logEvent(propuesta.casoId, "propuesta-resolucion-no-aplicable", {
      accion,
      propuestaId,
      motivo: MOTIVO_CAS,
    });
    return {
      resultado: "no_aplicable",
      accion,
      motivo: MOTIVO_CAS,
      itemId: propuestaId,
      casoId: propuesta.casoId,
    };
  }

  const evento = accion === ACCION_APLICAR_PROPUESTA ? "propuesta-aplicada" : "propuesta-descartada";
  logEvent(propuesta.casoId, evento, { propuestaId, empleadoId: sesion.empleadoId });

  return { resultado: "aplicada", accion, item: propuesta, estadoFinal: aplicada.estado };
}
