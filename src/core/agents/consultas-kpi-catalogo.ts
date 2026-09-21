// SIN IMPORTS. Módulo PROPIO a propósito (ADR 243): TODO lo que el canal
// conversacional puede mandar fuera del arnés hacia el destino `kpi-incidente`
// cabe acá. Es el único archivo que hay que leer entero para auditar esa
// superficie de salida.
//
// ALCANCE ACOTADO: la garantía vale para `consultar_kpi` y el destino
// `kpi-incidente`, NO para el canal conversacional en general. Otras
// operaciones (p. ej. `registrar_venta` hacia `riesgo-credito`) componen su
// propio insumo y este módulo no las describe ni las restringe.
//
// CÓMO AGREGAR UNA ENTRADA (seis pasos a propósito: lo que sale del arnés
// tiene que costar una revisión, no un commit distraído):
//   1. La clave en `CONSULTAS_KPI`.
//   2. El material en el `switch` de `materialDeConsultaKpi` (sin esto no compila).
//   3. La clave en `VALORES_PERMITIDOS_POR_OPERACION.consultar_kpi.consultaId`
//      de `validar-operacion.ts` (duplicación literal: ese módulo no importa nada).
//   4. El test de coherencia de las tres copias pasa a rojo hasta que el paso 3 esté.
//   5. La cláusula correspondiente en `OPERACIONES_TOOL_DESCRIPTION`.
//   6. El delta de spec.

/** Conjunto CERRADO. El modelo aporta una de estas claves y NADA MÁS (ADR 243). */
export const CONSULTAS_KPI = [
  "kpis_del_mes",
  "incidentes_abiertos",
  "incidentes_criticos",
  "estado_general",
] as const;

export type ConsultaKpiClave = (typeof CONSULTAS_KPI)[number];

/**
 * Instrucción FIJA — la MISMA cadena que usa el comando de la TUI para consultar KPIs.
 *
 * Es una COPIA, no una mudanza (corrección D8): mudarla metería la TUI en una
 * PR que no la toca, por tres líneas. Lo que sostiene la no-divergencia es un
 * TEST MECÁNICO (test 5b): el fuente de la TUI contiene esta cadena
 * EXACTAMENTE una vez. Es más débil que una única fuente de verdad —alguien
 * puede borrar el test— y se acepta a propósito por el costo de alcance.
 * Si se prefiere la mudanza, el test se invierte.
 */
export const INSTRUCCION_CONSULTA_KPI =
  "Consultá al agente externo de KPIs/incidentes y devolvé su respuesta tal cual.";

/**
 * PURA y SÍNCRONA. Narrowing de un `string` crudo al conjunto cerrado. La usa
 * el dispatcher como TERCERA capa de defensa, después de zod y de la whitelist.
 * Coincidencia EXACTA: sin `trim`, sin normalizar, sin claves de prototipo.
 */
export function esConsultaKpiConocida(valor: string): valor is ConsultaKpiClave {
  return (CONSULTAS_KPI as readonly string[]).includes(valor);
}

/**
 * PURA y TOTAL. Clave → el texto EXACTO que viaja como `InsumoDelegado.material`
 * hacia el agente externo. `switch` EXHAUSTIVO sobre `ConsultaKpiClave`, SIN
 * `default` — molde de `mensajeDeMotivoA2A` y `motivoDeEstadoTerminal`: una
 * clave nueva sin material es un error de COMPILACIÓN, nunca un `undefined`.
 *
 * INVARIANTE (test 3): ninguno de los materiales interpola NADA. Son
 * constantes: no llevan dato de la empresa, del empleado ni del turno. Lo único
 * que sale por este canal es "cuál de las N constantes".
 */
export function materialDeConsultaKpi(clave: ConsultaKpiClave): string {
  switch (clave) {
    case "kpis_del_mes":
      return "Resumen de los KPIs del mes corriente.";
    case "incidentes_abiertos":
      return "Listado de incidentes abiertos.";
    case "incidentes_criticos":
      return "Incidentes críticos abiertos en este momento.";
    case "estado_general":
      return "Estado general de KPIs e incidentes.";
  }
}
