/**
 * Contrato + validación de la tool de consultas de negocio de sólo lectura
 * para el turno A2A entrante (`consultas-negocio-a2a-entrante`, tarea 4, PR2,
 * ADR 184). Este archivo arranca acá con la porción de VALIDACIÓN y crece en
 * la tarea 5 (PR3) con la orquestación (`handleConsultaNegocio`) y el
 * recorte de datos personales (ADR 180/186) — esa porción NO se adelanta
 * acá.
 *
 * `OperacionConsulta` es la unión discriminada de las CUATRO operaciones de
 * sólo lectura (ADR 178 de `proposal.md`, ADR 184 de `design.md` §5):
 * `reporte_comisiones`, `estado_actividad`, `solicitudes_pendientes`,
 * `reembolsos_pendientes`. A diferencia de `OperacionNegocio` del hermano
 * (`operaciones-contract.ts`), ninguna de las cuatro formas tiene un campo de
 * identidad (`empleadoId`/`solicitanteId`/`vendedorId`) ni de escritura — no
 * hay self-service posible por A2A entrante (ADR 180 pto 1).
 *
 * `validarConsultaNegocio(raw)` exige EXACTAMENTE los campos de la fila que
 * corresponde a `raw.operacion` y rechaza cualquier clave extra — mismo
 * criterio de whitelist que `src/core/operaciones/validar-operacion.ts` del
 * change hermano y que `definicion-skills` ADR 110 aplicó al frontmatter.
 * `solicitudes_pendientes`/`reembolsos_pendientes` no aceptan NINGÚN campo
 * adicional (ni `periodo` ni `proyectoId`): es la señal, verificable por
 * test, de que esas dos operaciones no tienen forma de filtrar por identidad
 * porque no reciben ningún parámetro que pudiera intentarlo.
 *
 * A diferencia de `validarOperacion` (que devuelve `undefined` en el
 * rechazo), esta función devuelve `{ rechazo: string }` — el motivo forma
 * parte del contrato de esta tarea (ver `tasks.md` tarea 4).
 *
 * Sin imports: depende de las tareas 1-3 (`ConsultaActividadPort`, etc.)
 * SÓLO por tipos a nivel de diseño (`ConsultasNegocioToolDeps`, tarea 5) —
 * esta porción de validación no acopla esa lógica todavía.
 */

export const CONSULTAS_MCP_SERVER_NAME = "consultas";
export const CONSULTAS_TOOL_NAME = "consultar_negocio";
/**
 * Nombre calificado que ve el modelo (`mcp__<server>__<tool>`), mismo molde
 * que `OPERACIONES_TOOL_QUALIFIED_NAME`/`KNOWLEDGE_TOOL_QUALIFIED_NAME`. Es
 * lo que va en `AgentDefinition.allowedTools` (tarea 9, `definitions.ts`,
 * PR5 — gateada, no se adelanta acá).
 */
export const CONSULTAS_TOOL_QUALIFIED_NAME =
  `mcp__${CONSULTAS_MCP_SERVER_NAME}__${CONSULTAS_TOOL_NAME}` as const;

/* ── Las cuatro operaciones de sólo lectura (ADR 178, ADR 184) ── */

export const OPERACION_REPORTE_COMISIONES = "reporte_comisiones";
export const OPERACION_ESTADO_ACTIVIDAD = "estado_actividad";
export const OPERACION_SOLICITUDES_PENDIENTES = "solicitudes_pendientes";
export const OPERACION_REEMBOLSOS_PENDIENTES = "reembolsos_pendientes";

export const CONSULTAS_NEGOCIO_OPERACIONES = [
  OPERACION_REPORTE_COMISIONES,
  OPERACION_ESTADO_ACTIVIDAD,
  OPERACION_SOLICITUDES_PENDIENTES,
  OPERACION_REEMBOLSOS_PENDIENTES,
] as const;

/** Sólo lectura — `periodo` revalidado en formato por `resolverPeriodoReporte` en la tarea 5 (ADR 184 pto 4), acá sólo se exige presente. */
export interface OperacionReporteComisiones {
  readonly operacion: typeof OPERACION_REPORTE_COMISIONES;
  readonly periodo: string;
}

/** El único par que un llamador A2A externo puede conocer — nunca el `id` interno (ADR 187). */
export interface OperacionEstadoActividad {
  readonly operacion: typeof OPERACION_ESTADO_ACTIVIDAD;
  readonly proyectoId: string;
  readonly referenciaExterna: string;
}

/** Sin parámetros — no hay `solicitanteId` que filtrar (ADR 180 pto 1). */
export interface OperacionSolicitudesPendientes {
  readonly operacion: typeof OPERACION_SOLICITUDES_PENDIENTES;
}

/** Sin parámetros — cerrado sobre `estado: "reembolso_pendiente"` desde el composition root (ADR 182 pto 3-4). */
export interface OperacionReembolsosPendientes {
  readonly operacion: typeof OPERACION_REEMBOLSOS_PENDIENTES;
}

export type OperacionConsulta =
  | OperacionReporteComisiones
  | OperacionEstadoActividad
  | OperacionSolicitudesPendientes
  | OperacionReembolsosPendientes;

/** Rechazo de `validarConsultaNegocio` — motivo en texto, nunca una excepción (mismo espíritu "nunca lanza" de `handleConsultaNegocio`, tarea 5). */
export interface ConsultaNegocioRechazo {
  readonly rechazo: string;
}

/** Campos ACEPTADOS por operación, incluyendo `operacion` mismo. */
const CAMPOS_POR_OPERACION: Readonly<Record<string, readonly string[]>> = {
  [OPERACION_REPORTE_COMISIONES]: ["operacion", "periodo"],
  [OPERACION_ESTADO_ACTIVIDAD]: ["operacion", "proyectoId", "referenciaExterna"],
  [OPERACION_SOLICITUDES_PENDIENTES]: ["operacion"],
  [OPERACION_REEMBOLSOS_PENDIENTES]: ["operacion"],
};

/** Campos OBLIGATORIOS por operación — subconjunto de `CAMPOS_POR_OPERACION`, sin `operacion`. */
const CAMPOS_REQUERIDOS_POR_OPERACION: Readonly<Record<string, readonly string[]>> = {
  [OPERACION_REPORTE_COMISIONES]: ["periodo"],
  [OPERACION_ESTADO_ACTIVIDAD]: ["proyectoId", "referenciaExterna"],
  [OPERACION_SOLICITUDES_PENDIENTES]: [],
  [OPERACION_REEMBOLSOS_PENDIENTES]: [],
};

/**
 * `raw` es el objeto zod plano ya parseado por el adaptador MCP (tarea 6,
 * fuera de esta tarea): todos los campos posibles declarados opcionales a
 * nivel del wrapper. Esta función NUNCA lanza: devuelve el mismo objeto
 * (referencia estable, sin copiar) cuando es válido, o `{ rechazo }` cuando
 * se rechaza — operación desconocida, clave extra no permitida para esa
 * fila, o falta un campo requerido.
 */
export function validarConsultaNegocio(
  raw: Readonly<Record<string, unknown>>,
): OperacionConsulta | ConsultaNegocioRechazo {
  const operacion = raw["operacion"];
  if (typeof operacion !== "string" || !Object.hasOwn(CAMPOS_POR_OPERACION, operacion)) {
    return { rechazo: `operacion desconocida: ${String(operacion)}` };
  }

  const camposPermitidos = CAMPOS_POR_OPERACION[operacion];
  const camposRequeridos = CAMPOS_REQUERIDOS_POR_OPERACION[operacion];
  if (camposPermitidos === undefined || camposRequeridos === undefined) {
    // Inalcanzable: `Object.hasOwn` ya garantizó la clave en ambos records
    // (tienen las mismas cuatro claves) — la guarda es sólo para satisfacer
    // `noUncheckedIndexedAccess`, no un camino real.
    return { rechazo: `operacion desconocida: ${operacion}` };
  }

  const claveExtra = Object.keys(raw).find((clave) => !camposPermitidos.includes(clave));
  if (claveExtra !== undefined) {
    return { rechazo: `campo no permitido para ${operacion}: ${claveExtra}` };
  }

  const campoFaltante = camposRequeridos.find((campo) => raw[campo] === undefined);
  if (campoFaltante !== undefined) {
    return { rechazo: `falta el campo requerido ${campoFaltante} para ${operacion}` };
  }

  return raw as unknown as OperacionConsulta;
}
