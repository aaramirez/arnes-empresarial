/**
 * Contrato + validación + orquestación de la tool de consultas de negocio de
 * sólo lectura para el turno A2A entrante
 * (`consultas-negocio-a2a-entrante`, tarea 4 PR2 + tarea 5 PR3, ADR 184,
 * ADR 180/186). Arrancó en la tarea 4 con la porción de VALIDACIÓN
 * (`validarConsultaNegocio`) y crece acá con la ORQUESTACIÓN
 * (`ConsultasNegocioToolDeps`, `handleConsultaNegocio`) y el recorte de
 * datos personales (ADR 180 pto 4, ADR 186 §7).
 *
 * CONTRATO NO NEGOCIABLE de `handleConsultaNegocio` (molde
 * `knowledge-tool.ts` §"contrato no negociable"): nunca lanza ni rechaza, en
 * ningún camino de falla — input rechazado, período inválido, referencia
 * inexistente, o cualquiera de los cuatro puertos lanzando/rechazando
 * internamente. Toda falla se traduce a texto degradado.
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

import type { ReporteStorePort } from "../ventas/reporte-contract.js";
import { agruparReporteMensual, formatMoney, resolverPeriodoReporte } from "../ventas/reporte.js";
import type { ConsultaActividadPort } from "../actividad/consulta-actividad-contract.js";
import type { ConsultaSolicitudesPort } from "../solicitudes/consulta-solicitudes-contract.js";
import type { ConsultaReembolsosPort } from "../ventas/consulta-reembolsos-contract.js";

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
 * Tope de longitud para los tres campos string que alguna de las cuatro
 * operaciones acepta (`periodo`, `proyectoId`, `referenciaExterna`). Mismo
 * VALOR que `MAX_STRING_LENGTH` en `src/core/operaciones/validar-operacion.ts`
 * (y, en cascada, `src/adapters/web/payloads.ts`) — duplicado literal a
 * propósito, no importado: `src/core/agents` y `src/core/operaciones` son
 * módulos hermanos sin relación de dependencia entre sí (mismo criterio
 * "sin dependencias externas" que ya justifica la duplicación en
 * `validar-operacion.ts`) — esta validación estricta no puede depender de
 * que un módulo ajeno se resuelva bien.
 *
 * Hallazgo de Reviewer (`consultas-negocio-a2a-entrante`): `validarConsultaNegocio`
 * sólo comprobaba presencia de campo y whitelist de claves, nunca tipo ni
 * longitud — mismo hueco que `validar-operacion.ts` ya había cerrado tras un
 * hallazgo anterior de Reviewer sobre el change hermano.
 */
const MAX_STRING_LENGTH = 256;

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

  // Tipo/longitud, mismo criterio que `validar-operacion.ts`: cada campo
  // permitido (salvo `operacion` mismo) tiene que ser un `string` de a lo
  // sumo `MAX_STRING_LENGTH` — ninguna de las cuatro operaciones tiene hoy
  // un campo numérico (a diferencia del hermano con `monto`), así que no
  // hace falta una tabla de excepciones por campo.
  const campoInvalido = camposPermitidos.find((campo) => {
    if (campo === "operacion") {
      return false;
    }
    const valor = raw[campo];
    if (valor === undefined) {
      return false;
    }
    return typeof valor !== "string" || valor.length > MAX_STRING_LENGTH;
  });
  if (campoInvalido !== undefined) {
    return { rechazo: `valor inválido para ${campoInvalido} en ${operacion}` };
  }

  return raw as unknown as OperacionConsulta;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Orquestación (tarea 5, PR3, ADR 180/186)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Bolsa plana de colaboradores, molde `KnowledgeToolDeps`
 * (`adapters/knowledge/knowledge-tool.ts`): cada campo es un colaborador
 * distinto y testeable con su propio doble — no un puerto ni una fusión
 * semántica (ADR 182 pto 5).
 */
export interface ConsultasNegocioToolDeps {
  /** Correlación (mismo criterio que `KnowledgeToolDeps.casoId`). */
  readonly casoId: string;
  readonly reporteStore: ReporteStorePort;
  readonly actividadPort: ConsultaActividadPort;
  readonly solicitudesPort: ConsultaSolicitudesPort;
  readonly reembolsosPort: ConsultaReembolsosPort;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * `resolverPeriodoReporte` sólo lee `ahora` cuando `argumento === undefined`.
 * `periodo` es SIEMPRE un string en `reporte_comisiones` acá porque
 * `validarConsultaNegocio` ya lo exige como campo requerido (tarea 4) —
 * ese branch es inalcanzable en la práctica. Este valor existe únicamente
 * para satisfacer la firma de la función pura reusada, sin duplicar su
 * lógica de resolución de "mes corriente".
 */
const AHORA_INALCANZABLE = "1970-01-01T00:00:00.000Z";

type ConsultaSegura<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false };

/**
 * Ejecuta `fn` (una llamada a UNO de los cuatro puertos) atrapando tanto un
 * `throw` sincrónico como cualquier excepción — nunca deja que
 * `handleConsultaNegocio` propague (Punto obligatorio 3, molde
 * `knowledge-tool.ts`: el `try/catch` envuelve la llamada al colaborador
 * inyectado, no la función entera).
 */
function consultarSeguro<T>(
  fn: () => T,
  deps: Pick<ConsultasNegocioToolDeps, "casoId" | "logEvent">,
  operacion: OperacionConsulta["operacion"],
): ConsultaSegura<T> {
  try {
    return { ok: true, valor: fn() };
  } catch (error) {
    deps.logEvent("consulta-negocio-error", {
      casoId: deps.casoId,
      operacion,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

const MENSAJE_ERROR_PUERTO: Readonly<Record<OperacionConsulta["operacion"], string>> = {
  [OPERACION_REPORTE_COMISIONES]: "NO SE PUDO CONSULTAR el reporte de comisiones. Intentá de nuevo más tarde.",
  [OPERACION_ESTADO_ACTIVIDAD]: "NO SE PUDO CONSULTAR el estado de la actividad. Intentá de nuevo más tarde.",
  [OPERACION_SOLICITUDES_PENDIENTES]:
    "NO SE PUDO CONSULTAR las solicitudes internas pendientes. Intentá de nuevo más tarde.",
  [OPERACION_REEMBOLSOS_PENDIENTES]: "NO SE PUDO CONSULTAR los reembolsos pendientes. Intentá de nuevo más tarde.",
};

/**
 * Formatea el agregado de `reporte_comisiones` (ADR 186 §7): `periodo`,
 * cantidad de vendedores con ventas, suma de `ventasConfirmadas`, suma de
 * `montoVendido`, `totalComisionado` (ya viene sumado por
 * `agruparReporteMensual`), suma de `ventasConReembolso`. Función NUEVA, SIN
 * nombre compartido con `formatearReporteMensual` — no imprime la tabla
 * `filas` ni `reembolsosPendientes` (ADR 186, decisión explícita).
 */
function formatearAgregadoReporteComisiones(reporte: {
  readonly periodo: string;
  readonly filas: readonly { readonly ventasConfirmadas: number; readonly montoVendido: number; readonly ventasConReembolso: number }[];
  readonly totalComisionado: number;
}): string {
  const ventasConfirmadas = reporte.filas.reduce((acc, f) => acc + f.ventasConfirmadas, 0);
  const montoVendido = reporte.filas.reduce((acc, f) => acc + f.montoVendido, 0);
  const ventasConReembolso = reporte.filas.reduce((acc, f) => acc + f.ventasConReembolso, 0);

  return [
    `Reporte de comisiones (agregado) - periodo ${reporte.periodo}`,
    `Vendedores con ventas: ${reporte.filas.length}`,
    `Ventas confirmadas: ${ventasConfirmadas}`,
    `Monto vendido: ${formatMoney(montoVendido)}`,
    `Total comisionado: ${formatMoney(reporte.totalComisionado)}`,
    `Ventas con reembolso: ${ventasConReembolso}`,
  ].join("\n");
}

async function handleReporteComisiones(
  op: OperacionReporteComisiones,
  deps: ConsultasNegocioToolDeps,
): Promise<string> {
  const resuelto = resolverPeriodoReporte(op.periodo, AHORA_INALCANZABLE);
  if (!resuelto.ok) {
    return `CONSULTA RECHAZADA: ${resuelto.mensaje}`;
  }

  const resultado = consultarSeguro(
    () => deps.reporteStore.listComisionesPorPeriodo(resuelto.periodo),
    deps,
    OPERACION_REPORTE_COMISIONES,
  );
  if (!resultado.ok) {
    return MENSAJE_ERROR_PUERTO[OPERACION_REPORTE_COMISIONES];
  }

  // `reembolsosPendientes` NO se consulta acá: `agruparReporteMensual` lo
  // exige como parámetro pero el recorte del ADR 186 nunca lo usa en la
  // salida de A2A — esa lista la cubre la operación `reembolsos_pendientes`,
  // con su propio puerto (`ConsultaReembolsosPort`). Pasar `[]` evita una
  // lectura extra del `ReporteStorePort` que después se descartaría.
  const reporte = agruparReporteMensual({ periodo: resuelto.periodo, comisiones: resultado.valor, reembolsosPendientes: [] });
  deps.logEvent("consulta-negocio-ok", { casoId: deps.casoId, operacion: OPERACION_REPORTE_COMISIONES });
  return formatearAgregadoReporteComisiones(reporte);
}

async function handleEstadoActividad(
  op: OperacionEstadoActividad,
  deps: ConsultasNegocioToolDeps,
): Promise<string> {
  const resultado = consultarSeguro(
    () => deps.actividadPort.buscarPorReferencia({ proyectoId: op.proyectoId, referenciaExterna: op.referenciaExterna }),
    deps,
    OPERACION_ESTADO_ACTIVIDAD,
  );
  if (!resultado.ok) {
    return MENSAJE_ERROR_PUERTO[OPERACION_ESTADO_ACTIVIDAD];
  }

  const resumen = resultado.valor;
  if (resumen === undefined) {
    return `SIN RESULTADOS: no se encontró actividad para el proyecto "${op.proyectoId}" con referencia "${op.referenciaExterna}".`;
  }

  deps.logEvent("consulta-negocio-ok", { casoId: deps.casoId, operacion: OPERACION_ESTADO_ACTIVIDAD });
  return [
    `Estado de actividad - proyecto ${op.proyectoId}, referencia ${op.referenciaExterna}`,
    `Estado: ${resumen.estado}`,
    `Actualizado: ${resumen.updatedAt}`,
  ].join("\n");
}

async function handleSolicitudesPendientes(deps: ConsultasNegocioToolDeps): Promise<string> {
  const resultado = consultarSeguro(
    () => deps.solicitudesPort.listarPendientes(),
    deps,
    OPERACION_SOLICITUDES_PENDIENTES,
  );
  if (!resultado.ok) {
    return MENSAJE_ERROR_PUERTO[OPERACION_SOLICITUDES_PENDIENTES];
  }

  const solicitudes = resultado.valor;
  const porTipo = new Map<string, number>();
  for (const solicitud of solicitudes) {
    porTipo.set(solicitud.tipo, (porTipo.get(solicitud.tipo) ?? 0) + 1);
  }
  const desglose = [...porTipo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tipo, cantidad]) => `- ${tipo}: ${cantidad}`)
    .join("\n");

  deps.logEvent("consulta-negocio-ok", { casoId: deps.casoId, operacion: OPERACION_SOLICITUDES_PENDIENTES });
  return [
    "Solicitudes internas pendientes",
    `Total: ${solicitudes.length}`,
    solicitudes.length === 0 ? "(sin desglose)" : desglose,
  ].join("\n");
}

async function handleReembolsosPendientes(deps: ConsultasNegocioToolDeps): Promise<string> {
  const resultado = consultarSeguro(
    () => deps.reembolsosPort.listPendientes(),
    deps,
    OPERACION_REEMBOLSOS_PENDIENTES,
  );
  if (!resultado.ok) {
    return MENSAJE_ERROR_PUERTO[OPERACION_REEMBOLSOS_PENDIENTES];
  }

  const escalaciones = resultado.valor;
  const montoTotal = escalaciones.reduce((acc, escalacion) => acc + escalacion.monto, 0);

  deps.logEvent("consulta-negocio-ok", { casoId: deps.casoId, operacion: OPERACION_REEMBOLSOS_PENDIENTES });
  return [
    "Reembolsos pendientes de aprobación",
    `Total: ${escalaciones.length}`,
    `Monto total: ${formatMoney(montoTotal)}`,
  ].join("\n");
}

/**
 * Punto de entrada de la tool `mcp__consultas__consultar_negocio` (el
 * adaptador MCP de la tarea 6, fuera de esta tarea, envuelve este texto en
 * un `CallToolResult`). Delega en `validarConsultaNegocio` primero, luego en
 * el puerto correspondiente, y aplica el recorte del ADR 186 §7 antes de
 * formatear el texto.
 *
 * CONTRATO NO NEGOCIABLE: nunca lanza ni rechaza, en ningún camino de falla
 * — ver el comentario de cabecera del archivo.
 */
export async function handleConsultaNegocio(
  input: Readonly<Record<string, unknown>>,
  deps: ConsultasNegocioToolDeps,
): Promise<string> {
  const operacionValidada = validarConsultaNegocio(input);
  if ("rechazo" in operacionValidada) {
    deps.logEvent("consulta-negocio-rechazo", { casoId: deps.casoId, rechazo: operacionValidada.rechazo });
    return `CONSULTA RECHAZADA: ${operacionValidada.rechazo}`;
  }

  switch (operacionValidada.operacion) {
    case OPERACION_REPORTE_COMISIONES:
      return handleReporteComisiones(operacionValidada, deps);
    case OPERACION_ESTADO_ACTIVIDAD:
      return handleEstadoActividad(operacionValidada, deps);
    case OPERACION_SOLICITUDES_PENDIENTES:
      return handleSolicitudesPendientes(deps);
    case OPERACION_REEMBOLSOS_PENDIENTES:
      return handleReembolsosPendientes(deps);
  }
}
