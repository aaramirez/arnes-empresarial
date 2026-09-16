/**
 * Contrato de la herramienta de operaciones de negocio
 * (`operaciones-negocio-conversacionales`, ADR 163/171/174, tarea 1). Sin
 * imports — mismo criterio que `ventas-contract.ts`/`solicitudes-contract.ts`/
 * `hitl-contract.ts`: lo único que el Núcleo sabe sobre la MCP tool
 * `operaciones`, antes de que exista cualquier adaptador o caso de uso que la
 * consuma.
 *
 * `OperacionNegocio` es la unión discriminada de las SEIS operaciones del
 * contrato (ADR 163 pto 2 + ADR 171 pto 2 + ADR 174 pto 1): ningún campo de
 * dinero/porcentaje/período/veredicto CALCULADO por el modelo — la única
 * excepción probada por test mecánico es `monto` de `registrar_venta` (ADR
 * 170: hecho declarado por el empleado sobre una venta ya pactada, persistido
 * verbatim, nunca resultado de un cálculo). `empleadoId`/`vendedorId`/
 * `solicitanteId`/`sesion`/`confirmado` NUNCA son campos de esta unión (ADR
 * 147 pto 1, ADR 166 pto 1) — viajan por closure del composition root, jamás
 * por el schema que puebla el modelo.
 *
 * `ConfirmacionOperacionPort` también vive acá y no en
 * `build-on-operaciones-empleado.ts` (tarea 5, Unit 2 — todavía inexistente
 * en esta Unit 1): es un tipo puro sin comportamiento — un puerto del
 * dominio, pertenece al core por convención hexagonal. Decisión de secuencia
 * explícita del checkpoint humano (no una relectura de este archivo): ver
 * `design.md` ADR 167 §6 (~línea 388) para la forma exacta, reproducida acá
 * campo por campo — `ejecutar-operacion.ts` (tarea 3, misma Unit) la importa
 * desde acá.
 */

export const OPERACIONES_MCP_SERVER_NAME = "operaciones";
export const OPERACIONES_TOOL_NAME = "operacion_negocio";
/**
 * Nombre calificado que ve el modelo (`mcp__<server>__<tool>`), mismo molde
 * que `KNOWLEDGE_TOOL_QUALIFIED_NAME` (`knowledge-contract.ts`). Es lo que va
 * en `AgentDefinition.allowedTools` (tarea 6, `definitions.ts`).
 */
export const OPERACIONES_TOOL_QUALIFIED_NAME =
  `mcp__${OPERACIONES_MCP_SERVER_NAME}__${OPERACIONES_TOOL_NAME}` as const;

/* ── Las seis operaciones del contrato (ADR 163 pto 2, ADR 171 pto 2, ADR 174 pto 1) ── */

export const OPERACION_RESOLVER_DECISION_VENTA = "resolver_decision_venta";
export const OPERACION_PROCESAR_DEVOLUCION = "procesar_devolucion";
export const OPERACION_CREAR_SOLICITUD_INTERNA = "crear_solicitud_interna";
export const OPERACION_CANCELAR_SOLICITUD_INTERNA = "cancelar_solicitud_interna";
export const OPERACION_REGISTRAR_VENTA = "registrar_venta";
export const OPERACION_CONSULTAR_REPORTE_COMISIONES = "consultar_reporte_comisiones";
/** `aprobacion-conversacional-hitl`, ADR 206 — dominio solicitud del canal conversacional. */
export const OPERACION_RESOLVER_SOLICITUD = "resolver_solicitud";

export const OPERACIONES_NEGOCIO = [
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_RESOLVER_SOLICITUD,
] as const;

/** `decision` del CLIENTE, ya tomada por otro medio — el empleado la transcribe (ADR 163 pto 2). No es "un veredicto libre". */
export type DecisionVentaModelo = "confirmar" | "rechazar";

export interface OperacionResolverDecisionVenta {
  readonly operacion: typeof OPERACION_RESOLVER_DECISION_VENTA;
  readonly token: string;
  readonly decision: DecisionVentaModelo;
}

export interface OperacionProcesarDevolucion {
  readonly operacion: typeof OPERACION_PROCESAR_DEVOLUCION;
  readonly token: string;
  readonly motivo?: string;
}

export interface OperacionCrearSolicitudInterna {
  readonly operacion: typeof OPERACION_CREAR_SOLICITUD_INTERNA;
  readonly tipo: string;
  readonly detalle: string;
}

/** `solicitudId` ausente ⇒ modo listado, sin tocar ninguna ranura de confirmación (ADR 163 pto 2, ADR 166). */
export interface OperacionCancelarSolicitudInterna {
  readonly operacion: typeof OPERACION_CANCELAR_SOLICITUD_INTERNA;
  readonly solicitudId?: string;
}

/**
 * ★ ÚNICA excepción al invariante "ningún campo de dinero" (ADR 170, ADR 171
 * pto 2): `monto` es un HECHO DECLARADO por el empleado sobre una venta ya
 * pactada, que `registrarVenta` persiste verbatim sin ninguna operación
 * aritmética — no un resultado que la herramienta calcula. `vendedorId` NO es
 * campo de esta interfaz: sale de `sesion.empleadoId` inyectado por el
 * composition root (ADR 147 pto 1, ADR 171 pto 2) — el empleado autenticado
 * del turno ES el vendedor, nunca un id que el modelo nombre.
 */
export interface OperacionRegistrarVenta {
  readonly operacion: typeof OPERACION_REGISTRAR_VENTA;
  readonly clienteId: string;
  readonly clienteEmail: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly vendedorNombre: string;
}

/** Sólo lectura, sin campo de dinero ni de identidad en el INPUT (ADR 174 pto 1) — sin gate de rol, sin escopado por vendedor (R12). */
export interface OperacionConsultarReporteComisiones {
  readonly operacion: typeof OPERACION_CONSULTAR_REPORTE_COMISIONES;
  readonly periodo?: string;
}

/**
 * `aprobacion-conversacional-hitl`, ADR 206. `accion` es la ELECCIÓN de
 * operación que el modelo comunica — nunca un veredicto calculado ni un
 * campo `confirmado` (§0.1, ese booleano es inexpresable por el modelo, lo
 * decide el composition root contra `ConfirmacionOperacionPort`). **Nunca**
 * incluye `"cancelar"` (ADR 217) — esa acción sigue siendo exclusiva de
 * `cancelar_solicitud_interna`, un `switch` exhaustivo distinto.
 */
export type AccionSolicitudModelo = "aprobar" | "rechazar";

/** `solicitudId` ausente ⇒ modo listado, sin tocar ninguna ranura de confirmación (mismo criterio que `cancelar_solicitud_interna`). */
export interface OperacionResolverSolicitud {
  readonly operacion: typeof OPERACION_RESOLVER_SOLICITUD;
  readonly accion: AccionSolicitudModelo;
  readonly solicitudId?: string;
}

export type OperacionNegocio =
  | OperacionResolverDecisionVenta
  | OperacionProcesarDevolucion
  | OperacionCrearSolicitudInterna
  | OperacionCancelarSolicitudInterna
  | OperacionRegistrarVenta
  | OperacionConsultarReporteComisiones
  | OperacionResolverSolicitud;

/**
 * Puerto de confirmación humana para las operaciones de dos pasos del canal
 * conversacional (ADR 166, generalizado a multi-slot por `aprobacion-
 * conversacional-hitl`, ADR 209/212/213). El schema de la tool NUNCA tiene un
 * campo `confirmado` — es inexpresable por el modelo, en cualquier operación
 * (mismo criterio "inexpresable, no testeado" que `definicion-skills` ADR
 * 108 y `autorizacion-empleado` ADR 159). `confirmado` lo decide
 * EXCLUSIVAMENTE el composition root, comparando contra el estado de este
 * puerto.
 *
 * ★ `LlaveConfirmacion` generaliza la ranura única de `cancelar_solicitud_
 * interna` (ADR 166) para que `resolver_reembolso` y `resolver_solicitud`
 * convivan sin pisarse: `dominio` + `itemId` son la LLAVE (ADR 212), `accion`
 * es PREDICADO (ADR 213) — un pedido posterior con `accion` distinta sobre
 * el mismo `dominio`/`itemId` NO coincide con la ranura pendiente: se trata
 * como una intención nueva que reemplaza a la anterior, nunca ejecuta la
 * acción vieja ni la nueva sin confirmar (hallazgo de seguridad de esta
 * fase). El invariante `origenCasoId !== casoIdActual` (ADR 166 pto 3) se
 * conserva SIN relajarse.
 *
 * Implementación concreta por-empleado en
 * `adapters/web/confirmacion-operaciones-store.ts` (`aprobacion-
 * conversacional-hitl`, tarea 2, misma Unit) — la interfaz vive acá por
 * convención hexagonal, es un tipo puro sin comportamiento.
 */
export const DOMINIO_REEMBOLSO = "reembolso";
export const DOMINIO_SOLICITUD = "solicitud";
/** Vocabulario REUSADO de la ranura única de la TUI (`build-on-comando-empleado.ts:272-299`, ADR 55). */
export type DominioConfirmacion = typeof DOMINIO_REEMBOLSO | typeof DOMINIO_SOLICITUD;
export type AccionConfirmable = "aprobar" | "rechazar" | "reabrir" | "cancelar";

/** Identifica UNA ranura. `dominio` + `itemId` son la LLAVE (ADR 212); `accion` es PREDICADO (ADR 213). */
export interface LlaveConfirmacion {
  readonly dominio: DominioConfirmacion;
  /** ★ `itemId`, no `solicitudId` — ahora también transporta un `ventaId` (ADR 209 pto 3). */
  readonly itemId: string;
  readonly accion: AccionConfirmable;
}

export interface ConfirmacionOperacionPort {
  /** `true` si hay una pendiente de ESTA llave Y ESTA acción que este turno puede confirmar (`origenCasoId !== casoIdActual`, ADR 166 pto 3 — predicado INTACTO). */
  estaConfirmada(llave: LlaveConfirmacion, empleadoId: string, casoIdActual: string): boolean;
  marcarPendiente(input: LlaveConfirmacion & {
    readonly casoId: string;
    readonly empleadoId: string;
    readonly origenCasoId: string;
  }): void;
  /** Consume UNA ranura. ★ Nunca "todas las del empleado" — eso es `limpiarEmpleado`, y vive en el adaptador (ADR 214 pto 4). */
  consumir(llave: LlaveConfirmacion): void;
}
