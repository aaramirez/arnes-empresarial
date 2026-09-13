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

export const OPERACIONES_NEGOCIO = [
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
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

export type OperacionNegocio =
  | OperacionResolverDecisionVenta
  | OperacionProcesarDevolucion
  | OperacionCrearSolicitudInterna
  | OperacionCancelarSolicitudInterna
  | OperacionRegistrarVenta
  | OperacionConsultarReporteComisiones;

/**
 * Puerto de confirmación humana para `cancelar_solicitud_interna` (ADR 166).
 * El schema de la tool NUNCA tiene un campo `confirmado` — es inexpresable
 * por el modelo, en cualquier operación (mismo criterio "inexpresable, no
 * testeado" que `definicion-skills` ADR 108 y `autorizacion-empleado` ADR
 * 159). `confirmado` lo decide EXCLUSIVAMENTE el composition root, comparando
 * contra el estado de este puerto.
 *
 * Decisión de secuencia del checkpoint humano (ver doc-comment de módulo, no
 * un hallazgo de este archivo): la interfaz vive acá en Unit 1; su
 * implementación real por-empleado (`confirmacion-operaciones-store.ts`,
 * ADR 173 pto 4) llega en Unit 3 (tarea 8), y el wiring inline sobre la
 * ranura de la TUI descrito por el ADR 167 §6 pt 3 quedó SUPERSEDIDO por el
 * ADR 172/173 — `build-on-comando-empleado.ts` nunca construye esta
 * implementación. Ninguno de los dos existe todavía en esta Unit 1;
 * `ejecutar-operacion.ts` (tarea 3, esta misma Unit) sólo conoce el TIPO.
 */
export interface ConfirmacionOperacionPort {
  /** `true` si hay una cancelación pendiente que ESTE turno puede confirmar (`origenCasoId !== casoIdActual`, ADR 166 pto 3). */
  estaConfirmada(solicitudId: string, empleadoId: string, casoIdActual: string): boolean;
  marcarPendiente(input: {
    readonly solicitudId: string;
    readonly casoId: string;
    readonly empleadoId: string;
    readonly origenCasoId: string;
  }): void;
  consumir(): void;
}
