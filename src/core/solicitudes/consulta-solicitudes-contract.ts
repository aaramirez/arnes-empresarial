/**
 * Puerto de consulta de solicitudes internas pendientes para el turno A2A
 * entrante, de sólo lectura (`consultas-negocio-a2a-entrante`, tarea 2, ADR
 * 182 pto 3).
 *
 * Reusa `listarSolicitudesPendientes` SIN filtro — el llamador A2A no tiene
 * `solicitanteId` que filtrar (ADR 180 pto 1), a diferencia del filtro
 * opcional de `SolicitudStorePort.listarSolicitudesPendientes` (ADR 144),
 * pensado para el self-service de un empleado autenticado.
 *
 * Implementado por un closure sobre `listarSolicitudesPendientes`
 * (`src/adapters/memory/repository.ts`), inyectado inline desde el
 * composition root — sin `createXStore` (mismo estilo que `ReporteStorePort`).
 *
 * Sin imports salvo `./solicitudes-contract.js` (tipo `SolicitudInterna`).
 */
import type { SolicitudInterna } from "./solicitudes-contract.js";

export interface ConsultaSolicitudesPort {
  /** Reusa `listarSolicitudesPendientes` SIN filtro — la A2A entrante no tiene `solicitanteId` que filtrar (ADR 180 pto 1). */
  listarPendientes(): readonly SolicitudInterna[];
}
