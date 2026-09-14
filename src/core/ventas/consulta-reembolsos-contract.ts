/**
 * Puerto de consulta de escalaciones de reembolso pendientes para el turno
 * A2A entrante, de sólo lectura (`consultas-negocio-a2a-entrante`, tarea 3,
 * ADR 182 pto 3-4).
 *
 * Cerrado sobre `estado: "reembolso_pendiente"` desde el composition root —
 * el puerto NO acepta un estado arbitrario, a diferencia de
 * `VentaStorePort.listarReembolsosPendientes`/`listarReembolsosRechazados`,
 * que sí lo reciben fijo por método pero exponen ambos estados por separado
 * al empleado autenticado.
 *
 * Corrección de diseño aplicada (ADR 182 pto 4): `listComisionesPorPeriodo`
 * NO delega en esta operación — sólo la usa `agruparReporteMensual` para la
 * operación `reporte_comisiones` (distinta). `listEscalacionesReembolso(db,
 * { estado: "reembolso_pendiente" })` ya es superconjunto de columnas de
 * `listVentasEnReembolsoPendiente`, así que un solo método basta.
 *
 * Reusa `EscalacionListada` del contrato de ventas en vez de declarar un
 * tipo de fila propio: coincide campo a campo con `EscalacionReembolsoRow`
 * de `repository.ts` — mismo criterio que ya usa
 * `VentaStorePort.listarReembolsosPendientes` (`build-on-venta.ts:231-233`),
 * sin función de traducción propia.
 *
 * Sin imports salvo `./ventas-contract.js` (vocabulario y forma de fila ya
 * establecidos).
 */
import type { EscalacionListada } from "./ventas-contract.js";

export interface ConsultaReembolsosPort {
  /** Cerrado sobre `"reembolso_pendiente"` desde el composition root — el puerto no acepta un valor arbitrario. */
  listPendientes(): readonly EscalacionListada[];
}
