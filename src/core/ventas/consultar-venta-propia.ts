/**
 * Caso de uso: consulta puntual (o listado) de ventas propias
 * (`devolucion-sin-token-dos-personas`, ADR 224 pto 4, ADR 225, tarea 6).
 * Molde `procesar-devolucion.ts`: orquestador PURO y SÍNCRONO — sin `await`,
 * sin lógica de concurrencia propia.
 *
 * CERO ESCRITURAS en cualquier rama: este módulo no importa ningún puerto de
 * escritura, sólo `ConsultaVentaPropiaPort` (sólo lectura).
 *
 * El gate de alcance ("¿esta venta es del vendedor que consulta?") vive ACÁ,
 * dentro del núcleo — nunca en el store (que no filtra por vendedor a
 * propósito, ADR 227 pto 3) ni en el dispatcher (`ejecutar-operacion.ts`,
 * ADR 224 pto 4, test mecánico). "Ajena" (`no_autorizada`) tiene que ser
 * distinguible de "no existe" (`no_encontrada`) — Success Criteria de
 * `proposal.md`.
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/ventas/`
 * (regla no negociable de `AGENTS.md`).
 */
import { type ConsultaVentaPropiaPort, type VentaPropia } from "./consulta-venta-contract.js";

export interface ConsultarVentaPropiaDeps {
  readonly consulta: ConsultaVentaPropiaPort;
}

/**
 * `no_encontrada`/`no_autorizada` llevan `ventaId` para que el dispatcher
 * pueda nombrar la venta en el texto — ninguna de las dos rutas escribe fila
 * de auditoría (`consultar_venta` nunca la escribe, ADR 230 pto 4).
 */
export type ConsultarVentaPropiaResult =
  | { readonly resultado: "listado"; readonly items: readonly VentaPropia[] }
  | { readonly resultado: "no_encontrada"; readonly ventaId: string }
  | { readonly resultado: "no_autorizada"; readonly ventaId: string }
  | { readonly resultado: "detalle"; readonly venta: VentaPropia };

/**
 * `ventaId` ausente ⇒ listado de TODAS las ventas propias del vendedor,
 * cualquier estado (ver la decisión del cliente es el punto del hallazgo 3
 * de `proposal.md`). Con `ventaId`: `buscarPorId` (SIN filtro de vendedor,
 * ADR 227 pto 3) ⇒ `undefined` ⇒ `no_encontrada`; `vendedorId !==
 * empleadoId` ⇒ `no_autorizada`; coincide ⇒ `detalle`.
 */
export function consultarVentaPropia(
  input: { readonly ventaId?: string; readonly empleadoId: string },
  deps: ConsultarVentaPropiaDeps,
): ConsultarVentaPropiaResult {
  const { consulta } = deps;

  if (input.ventaId === undefined) {
    return { resultado: "listado", items: consulta.listarDeVendedor({ vendedorId: input.empleadoId }) };
  }

  const venta = consulta.buscarPorId(input.ventaId);

  if (venta === undefined) {
    return { resultado: "no_encontrada", ventaId: input.ventaId };
  }

  if (venta.vendedorId !== input.empleadoId) {
    return { resultado: "no_autorizada", ventaId: input.ventaId };
  }

  return { resultado: "detalle", venta };
}
