/**
 * Caso de uso: iniciar una devolución sin depender de la credencial que el
 * cliente recibió por link (change "dos personas, sin esa credencial", ★ EL
 * MÓDULO DEL CHANGE — ADR 223, ADR 227 pto 5, ADR 228). PURO y SÍNCRONO,
 * molde literal de `procesar-devolucion.ts`: sin `await`, sin lógica de
 * concurrencia propia — el CAS lo hace el `store`.
 *
 * ★★★ INVARIANTE DEL CHANGE — LÉASE ANTES DE TOCAR ESTE ARCHIVO ★★★
 * Este módulo NUNCA importa ni invoca la función de evaluación de umbral ni
 * el método de auto-aprobación del camino que confía en la credencial que
 * el cliente recibe por link, EN NINGUNA RAMA, sea cual sea el monto (ADR
 * 223 pto 3). Escala SIEMPRE mediante `store.escalarReembolso`. Si alguien
 * agrega cualquiera de esos dos símbolos acá "porque para montos chicos es
 * molesto", el mecanismo entero deja de ser lo que el stakeholder aprobó:
 * un empleado podría reembolsarse su propia venta sin que nadie mire. Un
 * test mecánico (`solicitar-devolucion.test.ts`) falla si alguno de esos dos
 * símbolos, o el nombre de esa credencial, aparece en este archivo — ni
 * siquiera en un comentario. No lo relajes.
 *
 * `store.escalarReembolso` devuelve la entidad completa de venta del
 * núcleo, que además trae esa misma credencial (ese método está fuera de
 * alcance, su tipo de retorno no se toca — ADR 227 pto 5). Por eso este
 * módulo SÓLO compara ese valor de retorno contra `undefined`, nunca lo
 * desestructura ni lo propaga en su `Result`.
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/ventas/`
 * (regla no negociable de `AGENTS.md`) más `../auth/sesion.js` (ADR 37,
 * mismo criterio que `resolver-escalacion-reembolso.ts`).
 */
import {
  VENTA_ESTADO_CONFIRMADA,
  type VentaStorePort,
} from "./ventas-contract.js";
import type { ConsultaVentaPropiaPort, VentaPropia } from "./consulta-venta-contract.js";
import { MOTIVO_MAX_LENGTH, type JustificacionDevolucionPort } from "./justificacion-devolucion-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

export interface SolicitarDevolucionDeps {
  readonly consulta: ConsultaVentaPropiaPort;
  readonly justificacion: JustificacionDevolucionPort;
  /** Se consume ÚNICAMENTE `escalarReembolso` — ver el doc-comment de módulo. */
  readonly store: VentaStorePort;
  readonly newId: () => string;
  readonly now: () => string;
  /** Ningún evento de este módulo lleva el `motivo` (R13, test dedicado). */
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

/**
 * `ventaId`/`casoId` acompañan cada rama posterior a "encontrada" para que
 * el dispatcher pueda nombrar la venta y correlacionar la fila de auditoría
 * que corresponda (ADR 230). `no_encontrada` sólo lleva `ventaId`: sin
 * `casoId` que correlacionar, tampoco hay fila (mismo criterio que
 * `procesar-devolucion.ts`).
 */
export type SolicitarDevolucionResult =
  | { readonly resultado: "listado"; readonly items: readonly VentaPropia[] }
  | { readonly resultado: "motivo_invalido" }
  | { readonly resultado: "no_encontrada"; readonly ventaId: string }
  | { readonly resultado: "no_autorizada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "requiere_confirmacion"; readonly venta: VentaPropia }
  | { readonly resultado: "escalada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "no_aplicable"; readonly ventaId: string; readonly casoId: string };

/**
 * Secuencia exacta, fijada por `design.md` §4 pto 2 — el orden de los pasos
 * 2 y 4 es de seguridad, no de estilo:
 *
 *  1. `ventaId === undefined` ⇒ listado de propias `confirmada` (ADR 208,
 *     ADR 223 pto 1: el filtro por estado es de ESTA operación — `consultar_
 *     venta` lista todos los estados, ésta sólo la que puede devolverse).
 *  2. ★ `motivo` ausente / en blanco / `> MOTIVO_MAX_LENGTH` ⇒
 *     `motivo_invalido`, ANTES de leer la venta: así un `motivo` vacío no
 *     sirve para sondear qué ventas existen. CERO lecturas, CERO escrituras.
 *  3. `venta = consulta.buscarPorId(ventaId)`; `undefined` ⇒ `no_encontrada`.
 *  4. ★ `venta.vendedorId !== sesion.empleadoId` ⇒ `no_autorizada`, ANTES
 *     del eco: no hay ningún motivo para mostrarle monto y cliente de una
 *     venta ajena antes de rechazar.
 *  5. `!confirmado` ⇒ `requiere_confirmacion` con la `VentaPropia` completa
 *     — de ahí sale el eco (`estado` incluido: el empleado ve que la venta
 *     todavía no está confirmada si intentó apurarse).
 *  6. `confirmado` ⇒ la justificación se registra PRIMERO (sin efecto de
 *     negocio propio), el CAS DESPUÉS. Si el CAS no matchea, la fila de
 *     justificación queda huérfana — auditable, no un agujero (ADR 228 pto
 *     4): al revés, una escalación podría quedar sin justificación si el
 *     `INSERT` lanza, que es justo lo que este orden existe para impedir.
 *
 * SIN verificación de estado propia (ADR 223 pto 2, literal): el
 * `WHERE estado = 'confirmada'` del CAS es la única guarda — una venta que
 * ya no está `confirmada` pasa el gate, muestra el eco y falla en el CAS
 * (⇒ `no_aplicable`), y eso es la decisión, no un descuido.
 */
export function solicitarDevolucion(
  input: {
    readonly ventaId?: string;
    readonly motivo?: string;
    readonly confirmado: boolean;
    readonly sesion: SesionEmpleado;
  },
  deps: SolicitarDevolucionDeps,
): SolicitarDevolucionResult {
  const { consulta, justificacion, store, newId, now, logEvent } = deps;
  const { ventaId, motivo, confirmado, sesion } = input;

  if (ventaId === undefined) {
    const items = consulta.listarDeVendedor({
      vendedorId: sesion.empleadoId,
      estados: [VENTA_ESTADO_CONFIRMADA],
    });
    return { resultado: "listado", items };
  }

  if (motivo === undefined || motivo.trim().length === 0 || motivo.length > MOTIVO_MAX_LENGTH) {
    return { resultado: "motivo_invalido" };
  }

  const venta = consulta.buscarPorId(ventaId);

  if (venta === undefined) {
    return { resultado: "no_encontrada", ventaId };
  }

  if (venta.vendedorId !== sesion.empleadoId) {
    logEvent(venta.casoId, "devolucion-solicitud-no-autorizada", { ventaId, empleadoId: sesion.empleadoId });
    return { resultado: "no_autorizada", ventaId, casoId: venta.casoId };
  }

  if (!confirmado) {
    logEvent(venta.casoId, "devolucion-solicitud-pedida", { ventaId });
    return { resultado: "requiere_confirmacion", venta };
  }

  const ahora = now();

  // ★ Orden fijo (ADR 228 pto 4): la justificación PRIMERO, el CAS DESPUÉS.
  justificacion.registrar({
    id: newId(),
    ventaId,
    casoId: venta.casoId,
    solicitanteId: sesion.empleadoId,
    motivo,
    solicitadaAt: ahora,
  });

  // ★ Escala SIEMPRE — sin evaluar el monto en ninguna rama (ADR 223 pto 2).
  // El valor de retorno SÓLO se compara contra `undefined` — ver el
  // doc-comment de módulo.
  const aplicada = store.escalarReembolso({ ventaId, casoId: venta.casoId, ahora });

  if (aplicada === undefined) {
    logEvent(venta.casoId, "devolucion-solicitud-no-aplicable", { ventaId });
    return { resultado: "no_aplicable", ventaId, casoId: venta.casoId };
  }

  logEvent(venta.casoId, "devolucion-solicitud-escalada", { ventaId });
  return { resultado: "escalada", ventaId, casoId: venta.casoId };
}
