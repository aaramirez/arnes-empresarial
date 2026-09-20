import type { ListadoSolicitudesA2AEntrantes, SolicitudA2AEntranteVistaEmpleado } from "./a2a-entrante-contract.js";
import { LINEAS_PAGINA_A2A } from "./a2a-entrante-contract.js";

/**
 * Una línea por fila — molde de `formatearLineaPropuesta` (más abajo). El
 * rótulo es **`origen de transporte`**, nunca `agente` (R1, ADR 142 pto 1):
 * `origenTransporte` es una dirección de red observada por el transporte,
 * no una identidad de agente externo (`0011:18-20`). No exportada — sólo
 * la usa `formatearListadoSolicitudesA2A`, mismo criterio que
 * `formatearLineaPropuesta`/`formatearListadoPropuestas`.
 */
function formatearLineaSolicitudA2A(vista: SolicitudA2AEntranteVistaEmpleado): string {
  return `- tarea ${vista.a2aTaskId} | estado ${vista.estado.valor} | origen de transporte ${vista.origenTransporte} | recibida ${vista.createdAt} | actualizada ${vista.updatedAt}`;
}

/**
 * `formatearListadoSolicitudesA2A` (v3.4.0, `comando-visibilidad-a2a-
 * entrante` tarea 7, ADR 142 pto 1). Exportada — a diferencia de
 * `formatearListadoPropuestas`/`formatearResumenPropuesta` (más abajo,
 * anidadas en `buildOnComandoEmpleado`), ésta y
 * `formatearDetalleSolicitudA2A` viven a nivel de módulo porque la tarea 8
 * (el `case` del dispatcher que las cablea) todavía no existe: necesitan
 * ser testeables en forma directa, mismo criterio con el que la tarea 4
 * exportó `createSolicitudA2AEntranteStore`. Vacío ⇒ texto fijo; `hayMas
 * === true` ⇒ nota de truncado al final, molde de la nota de
 * `formatearResumenPropuesta`.
 */
export function formatearListadoSolicitudesA2A(listado: ListadoSolicitudesA2AEntrantes): string {
  if (listado.items.length === 0) {
    return "No hay solicitudes A2A entrantes en curso.";
  }
  const lineas = listado.items.map(formatearLineaSolicitudA2A).join("\n");
  const nota = listado.hayMas
    ? `\n\n[…mostrando las primeras ${listado.items.length}; hay más solicitudes en curso…]`
    : "";
  return `${lineas}${nota}`;
}

/**
 * Pagina `contenido` a `LINEAS_PAGINA_A2A` líneas — mecánica idéntica a
 * `formatearResumenPropuesta` (más abajo), aplicada dos veces de forma
 * independiente (`mensaje_recibido` y `resultado`, ADR 142 pto 2): cada
 * sección paga su propio tope de `LINEAS_PAGINA_A2A`, no un tope conjunto.
 */
function formatearSeccionPaginadaA2A(etiqueta: string, contenido: string): string {
  const lineas = contenido.split("\n");
  const primeraPagina = lineas.slice(0, LINEAS_PAGINA_A2A).join("\n");
  const nota =
    lineas.length > LINEAS_PAGINA_A2A
      ? `\n\n[…mostrando las primeras ${LINEAS_PAGINA_A2A} de ${lineas.length} líneas de ${etiqueta}…]`
      : "";
  return `\n\n${etiqueta}:\n${primeraPagina}${nota}`;
}

/**
 * `formatearDetalleSolicitudA2A` (v3.4.0, tarea 7, ADR 142 pto 2-3). Resumen
 * de una línea (mismos cinco campos que `formatearLineaSolicitudA2A`, con
 * el mismo rótulo `origen de transporte`) + `mensajeRecibido`/`resultado`
 * paginados a `LINEAS_PAGINA_A2A` líneas cada uno. `resultado` ausente ⇒
 * la sección se OMITE por completo — no se imprime vacía ni la palabra
 * `"undefined"` (mismo binario que el `dictamen` de `formatearLineaSolicitud`,
 * ADR 142 pto 3). Exportada por el mismo motivo que
 * `formatearListadoSolicitudesA2A` — ver comentario de esa función.
 */
export function formatearDetalleSolicitudA2A(vista: SolicitudA2AEntranteVistaEmpleado): string {
  const resumen = `solicitud A2A ${vista.a2aTaskId} · estado ${vista.estado.valor} · origen de transporte ${vista.origenTransporte} · recibida ${vista.createdAt} · actualizada ${vista.updatedAt}`;
  const mensaje = formatearSeccionPaginadaA2A("mensaje recibido", vista.mensajeRecibido);
  const resultado = vista.resultado !== undefined ? formatearSeccionPaginadaA2A("resultado", vista.resultado) : "";
  return `${resumen}${mensaje}${resultado}`;
}
