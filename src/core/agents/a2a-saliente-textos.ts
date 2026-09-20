import type { MotivoDelegacionA2ANoCompletada } from "./a2a-contract.js";

/**
 * PURA, de módulo (Hito 6, tarea 20, ADR 85) — mismo lugar y mismo molde
 * que `formatearLineaEscalacion`/`formatearListado`/`formatearResumenPropuesta`.
 * TOTAL sobre los OCHO motivos: el `switch` es exhaustivo sobre
 * `MotivoDelegacionA2ANoCompletada` — SIN `default` — así que un motivo
 * nuevo del vocabulario sería un error de COMPILACIÓN, no un mensaje
 * genérico. Requirement literal del spec: dos motivos distintos nunca
 * comparten mensaje. NUNCA incluye el `detalle` crudo del adaptador — ese
 * ya viene truncado a 500 chars pero puede llevar cuerpo de respuesta ajeno.
 */
export function mensajeDeMotivoA2A(reason: MotivoDelegacionA2ANoCompletada): string {
  switch (reason) {
    case "failed":
      return "El agente externo de KPIs/incidentes no pudo completar la consulta.";
    case "canceled":
      return "La consulta al agente externo de KPIs/incidentes fue cancelada antes de completarse.";
    case "rejected":
      return "El agente externo de KPIs/incidentes rechazó la consulta.";
    case "input-required":
      return "El agente externo de KPIs/incidentes necesita información adicional que este canal no puede proveer.";
    case "auth-required":
      return "El agente externo de KPIs/incidentes requiere una autenticación que este canal no puede completar.";
    case "timeout":
      return "La consulta al agente externo de KPIs/incidentes agotó el tiempo de espera.";
    case "transporte":
      return "No se pudo establecer comunicación con el agente externo de KPIs/incidentes.";
    case "protocolo":
      return "El agente externo de KPIs/incidentes respondió con un protocolo no reconocido.";
  }
}
