/**
 * Puerto de consulta de una venta propia, de sólo lectura
 * (`devolucion-sin-token-dos-personas`, ADR 224, ADR 225, ADR 227, tarea 1).
 *
 * Molde: `consulta-reembolsos-contract.ts` — un puerto de lectura aparte, sin
 * las operaciones de escritura de `VentaStorePort`. Sin imports salvo
 * `./ventas-contract.js`, del que sólo se toma `VentaEstado` (vocabulario ya
 * establecido).
 *
 * ★ `VentaPropia` NO TIENE — y no puede tener — ningún campo de token
 * (`tokenConfirmacion` ni alias). La garantía es ESTRUCTURAL, mismo criterio
 * que `AccionEmpleado` (`registro-acciones-contract.ts`) y `VentaPublica`
 * (`ventas-contract.ts`, "SIN token"): no hay campo donde ponerlo. La
 * exclusión de la fuente (SQL) vive en `repository.ts` (ADR 227 pto 2) — este
 * archivo sólo fija la forma que el núcleo puede ver.
 *
 * `buscarPorId` NO filtra por vendedor: "ajena" tiene que ser distinguible de
 * "no existe" (Success Criteria de `proposal.md`), y ese gate vive DENTRO del
 * núcleo (`consultar-venta-propia.ts`, ADR 224 pto 4) — nunca en el store ni
 * en el dispatcher.
 */
import type { VentaEstado } from "./ventas-contract.js";

/** Tope del listado sin argumento — mismo valor que `LIMITE_LISTADO_ESCALACIONES` (ADR 208 pto 5, patrón vigente por dominio). */
export const LIMITE_LISTADO_VENTAS_PROPIAS = 20;

/**
 * Proyección de una venta propia. Campos exactos, RD-108: `vendedorId` está
 * para que el gate del ADR 224 pueda compararlo DENTRO del núcleo — el
 * dispatcher no lo lee (test mecánico, ADR 224 pto 4). `expiresAt` responde
 * "el link venció y por eso el cliente no confirmó" (hallazgo 3 de
 * `proposal.md`). Ningún dato personal del cliente más allá de `clienteId`
 * (ADR 18).
 */
export interface VentaPropia {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly clienteId: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly estado: VentaEstado;
  readonly casoId: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly expiresAt?: string;
}

export interface ConsultaVentaPropiaPort {
  /**
   * Por id, SIN filtro de vendedor: el gate de alcance vive en el núcleo
   * (ADR 224 pto 4). `undefined` si no existe. NUNCA devuelve el token.
   */
  buscarPorId(ventaId: string): VentaPropia | undefined;
  /** `estados` ausente ⇒ todos. Orden `createdAt` DESC. Default de `limite`: `LIMITE_LISTADO_VENTAS_PROPIAS`. */
  listarDeVendedor(filtro: {
    readonly vendedorId: string;
    readonly estados?: readonly VentaEstado[];
    readonly limite?: number;
  }): readonly VentaPropia[];
}
