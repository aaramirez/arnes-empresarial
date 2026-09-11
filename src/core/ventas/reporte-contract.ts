/**
 * Contrato de lectura del reporte mensual de comisiones (`design.md` §3,
 * ADR 121 punto 2, RD-55). Módulo hermano de `reporte.ts` — el ÚNICO import
 * es hacia `./reporte.js` (los dos tipos de fila, ya definidos ahí), nunca al
 * revés: `reporte.ts` no gana ningún import nuevo por este archivo.
 *
 * `ReporteStorePort` es 100% lectura y no comparte ninguna invariante con
 * `VentaStorePort` (`ventas-contract.ts`) — mezclarlos infla la superficie de
 * un contrato que hoy tiene una sola responsabilidad (ADR 121, alternativas
 * consideradas). Implementado por closures directos sobre
 * `listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente`
 * (`src/adapters/memory/repository.ts`), inyectadas inline desde el
 * composition root (`build-on-comando-empleado.ts`) — sin `createXStore`.
 */
import type { ComisionConVenta, VentaPendienteReembolso } from "./reporte.js";

export interface ReporteStorePort {
  listComisionesPorPeriodo(periodo: string): readonly ComisionConVenta[];
  listVentasEnReembolsoPendiente(): readonly VentaPendienteReembolso[];
}
