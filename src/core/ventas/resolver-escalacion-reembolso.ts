/**
 * Caso de uso: resolver una escalación de reembolso (`tui-canal-empleado`,
 * ADR 25, 29, 37, 38). PURA y SÍNCRONA, molde de `procesar-devolucion.ts`:
 * sin `await`, sin lógica de concurrencia propia — el CAS lo hace el
 * `store` vía `UPDATE ... WHERE estado = ... RETURNING`; este módulo solo
 * interpreta el resultado.
 *
 * `sesion: SesionEmpleado` y no `empleadoId: string` — ADR 37: el invariante
 * "todo `empleadoId` que llega a un caso de uso privilegiado fue
 * AUTENTICADO" se expresa en el TIPO, no en un comentario. Importa
 * `SesionEmpleado` de `src/core/auth/` — un cruce entre subcarpetas de
 * `src/core/`, no hacia `src/adapters/*` ni el SDK (regla no negociable de
 * `AGENTS.md`).
 */
import {
  LIMITE_LISTADO_ESCALACIONES,
  type EscalacionListada,
  type ResolucionEscalacionInput,
  type VentaEstado,
  type VentaStorePort,
} from "./ventas-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

export const ACCION_APROBAR = "aprobar";
export const ACCION_RECHAZAR = "rechazar";
export const ACCION_REABRIR = "reabrir";
export type AccionEscalacion = typeof ACCION_APROBAR | typeof ACCION_RECHAZAR | typeof ACCION_REABRIR;

export interface ResolverEscalacionDeps {
  readonly store: VentaStorePort;
  /** Genera el `id` de la fila de registro (ADR 39). */
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  /** Tope del listado sin argumento. Default `LIMITE_LISTADO_ESCALACIONES` (20). */
  readonly limiteListado?: number;
}

export type MotivoNoAplicable = "no_encontrada" | "cas";

export type ResolverEscalacionResult =
  | { readonly resultado: "listado"; readonly accion: AccionEscalacion; readonly items: readonly EscalacionListada[] }
  | { readonly resultado: "requiere_confirmacion"; readonly accion: AccionEscalacion; readonly venta: EscalacionListada }
  | {
      readonly resultado: "aplicada";
      readonly accion: AccionEscalacion;
      readonly venta: EscalacionListada;
      readonly estadoFinal: VentaEstado;
    }
  | {
      readonly resultado: "no_aplicable";
      readonly accion: AccionEscalacion;
      readonly motivo: MotivoNoAplicable;
      readonly ventaId?: string;
      readonly casoId?: string;
    };

function listar(
  store: VentaStorePort,
  accion: AccionEscalacion,
  filtro: { readonly ventaId?: string; readonly limite?: number },
): readonly EscalacionListada[] {
  return accion === ACCION_REABRIR
    ? store.listarReembolsosRechazados(filtro)
    : store.listarReembolsosPendientes(filtro);
}

function aplicarCas(
  store: VentaStorePort,
  accion: AccionEscalacion,
  input: ResolucionEscalacionInput,
): { readonly estado: VentaEstado } | undefined {
  if (accion === ACCION_APROBAR) {
    return store.aprobarEscalacionReembolso(input);
  }
  if (accion === ACCION_RECHAZAR) {
    return store.rechazarEscalacionReembolso(input);
  }
  return store.reabrirEscalacionReembolso(input);
}

/**
 * PURA y SÍNCRONA — sin `await`, molde de `procesarDevolucion`. Secuencia
 * exacta (design.md §3.7):
 *
 *  A. `estadoOrigen = accion === "reabrir" ? REEMBOLSO_RECHAZADO : REEMBOLSO_PENDIENTE`.
 *  B. `ventaId === undefined` → `store.listar*({ limite })` → `{ resultado: "listado" }`.
 *     Evento `reembolso-listado` con `{ accion, cantidad }`. CERO escrituras.
 *  C. `ventaId` presente → `store.listar*({ ventaId })` (ADR 38: filtro por id, NUNCA
 *     un lector por id sin filtro de estado). Vacío → `no_aplicable` con
 *     `motivo: "no_encontrada"`, evento `reembolso-resolucion-no-aplicable`.
 *     ★ NO escribe fila: no hay `casoId` que correlacionar. ★
 *  D. `confirmado === false` → `{ requiere_confirmacion, venta }` — evento
 *     `reembolso-resolucion-solicitada` con `{ accion, ventaId, monto }`.
 *     ★ NI el store NI el registro reciben una sola escritura. ★
 *  E. `confirmado === true` → el método CAS que corresponda, con
 *     `{ ventaId, casoId, empleadoId: sesion.empleadoId, accionId: newId(), ahora: now() }`.
 *     `undefined` (el CAS no matcheó) → `no_aplicable` con `motivo: "cas"`.
 *     Fila → evento `reembolso-escalacion-aprobada|rechazada|reabierta`.
 *
 * CERO llamadas al modelo. CERO `await`. Test explícito de sincronía.
 */
export function resolverEscalacionReembolso(
  input: {
    readonly accion: AccionEscalacion;
    readonly ventaId?: string;
    readonly confirmado: boolean;
    readonly sesion: SesionEmpleado;
  },
  deps: ResolverEscalacionDeps,
): ResolverEscalacionResult {
  const { store, newId, now, logEvent } = deps;
  const { accion, ventaId, confirmado, sesion } = input;
  // `estadoOrigen` (design.md §A) no se materializa como variable propia: el
  // filtro por estado ya lo aplica `listar()` eligiendo `listarReembolsosRechazados`
  // (reabrir, origen `reembolso_rechazado`) o `listarReembolsosPendientes`
  // (aprobar/rechazar, origen `reembolso_pendiente`) — un solo punto de
  // decisión en vez de dos.

  if (ventaId === undefined) {
    const limite = deps.limiteListado ?? LIMITE_LISTADO_ESCALACIONES;
    const items = listar(store, accion, { limite });
    logEvent("tui-comando", "reembolso-listado", { accion, cantidad: items.length });
    return { resultado: "listado", accion, items };
  }

  const encontradas = listar(store, accion, { ventaId });
  const venta = encontradas[0];

  if (venta === undefined) {
    logEvent("tui-comando", "reembolso-resolucion-no-aplicable", { accion, ventaId, motivo: "no_encontrada" });
    return { resultado: "no_aplicable", accion, motivo: "no_encontrada", ventaId };
  }

  if (!confirmado) {
    logEvent(venta.casoId, "reembolso-resolucion-solicitada", { accion, ventaId, monto: venta.monto });
    return { resultado: "requiere_confirmacion", accion, venta };
  }

  const resolucionInput: ResolucionEscalacionInput = {
    ventaId,
    casoId: venta.casoId,
    empleadoId: sesion.empleadoId,
    accionId: newId(),
    ahora: now(),
  };

  const aplicada = aplicarCas(store, accion, resolucionInput);

  if (aplicada === undefined) {
    logEvent(venta.casoId, "reembolso-resolucion-no-aplicable", { accion, ventaId, motivo: "cas" });
    return { resultado: "no_aplicable", accion, motivo: "cas", ventaId, casoId: venta.casoId };
  }

  const evento =
    accion === ACCION_APROBAR
      ? "reembolso-escalacion-aprobada"
      : accion === ACCION_RECHAZAR
        ? "reembolso-escalacion-rechazada"
        : "reembolso-escalacion-reabierta";
  logEvent(venta.casoId, evento, { ventaId, monto: venta.monto, empleadoId: sesion.empleadoId });

  return { resultado: "aplicada", accion, venta, estadoFinal: aplicada.estado };
}
