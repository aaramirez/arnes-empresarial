/**
 * Contrato de la herramienta de operaciones de negocio
 * (`operaciones-negocio-conversacionales`, ADR 163/171/174, tarea 1). Sin
 * imports — mismo criterio que `ventas-contract.ts`/`solicitudes-contract.ts`/
 * `hitl-contract.ts`: lo único que el Núcleo sabe sobre la MCP tool
 * `operaciones`, antes de que exista cualquier adaptador o caso de uso que la
 * consuma.
 *
 * `OperacionNegocio` es la unión discriminada de las TRECE operaciones del
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

/* ── Las trece operaciones del contrato (ADR 163 pto 2, ADR 171 pto 2, ADR 174 pto 1) ── */

export const OPERACION_RESOLVER_DECISION_VENTA = "resolver_decision_venta";
export const OPERACION_PROCESAR_DEVOLUCION = "procesar_devolucion";
export const OPERACION_CREAR_SOLICITUD_INTERNA = "crear_solicitud_interna";
export const OPERACION_CANCELAR_SOLICITUD_INTERNA = "cancelar_solicitud_interna";
export const OPERACION_REGISTRAR_VENTA = "registrar_venta";
export const OPERACION_CONSULTAR_REPORTE_COMISIONES = "consultar_reporte_comisiones";
/** `aprobacion-conversacional-hitl`, ADR 206 — dominio solicitud del canal conversacional. */
export const OPERACION_RESOLVER_SOLICITUD = "resolver_solicitud";
/** `aprobacion-conversacional-hitl`, ADR 206 — dominio reembolso del canal conversacional; octava operación del contrato. */
export const OPERACION_RESOLVER_REEMBOLSO = "resolver_reembolso";
/**
 * `devolucion-sin-token-dos-personas`, ADR 225/227 pto 1 — de sólo lectura,
 * escopada al vendedor propio: estado de una venta puntual (incluida la
 * decisión del cliente) o, sin id, el listado de ventas propias. DÉCIMA y
 * última entrada del contrato (tarea 11): precedida por `solicitar_devolucion`
 * en el orden final del array (`design.md` §0.2).
 */
export const OPERACION_CONSULTAR_VENTA = "consultar_venta";

/**
 * `devolucion-sin-token-dos-personas`, ADR 223/228 — NOVENA operación del
 * contrato. Escala SIEMPRE (nunca mira el monto) e inicia sobre venta propia.
 * `motivo` OBLIGATORIO cuando hay `ventaId` — la obligatoriedad es del
 * NÚCLEO (ADR 228 pto 2 paso 2), por eso es `?` en el TIPO (el modo listado
 * no lo lleva). ★ SIN campo `accion` (ADR 229 pto 3): el dispatcher construye
 * la llave de confirmación con `accion: "solicitar"` LITERAL, desde el
 * closure — nunca del modelo.
 */
export const OPERACION_SOLICITAR_DEVOLUCION = "solicitar_devolucion";

/**
 * `consulta-solicitud-propia`, ADR 237/238/239 — de sólo lectura, escopada al
 * solicitante propio: estado y desenlace de una solicitud interna puntual
 * (cualquiera de los cuatro estados, con su dictamen y su resolución) o, sin
 * id, el listado de las propias. UNDÉCIMA entrada del contrato. SIN `accion`
 * (no es una elección de operación) y SIN `confirmado` (no consume ninguna
 * ranura de confirmación) — mismo criterio que `consultar_venta`.
 */
export const OPERACION_CONSULTAR_SOLICITUD = "consultar_solicitud";

/**
 * `visibilidad-a2a-entrante-chat`, ADR 240-242 — de sólo lectura, alcance
 * ORGANIZACIONAL (no escopada a un empleado ni a un vendedor, ADR 242 pto 1):
 * lo que un agente externo le preguntó al arnés vía A2A entrante. SÍ audita
 * (a diferencia de `consultar_venta`/`consultar_solicitud`, ADR 240 pto 5).
 * DUODÉCIMA entrada del contrato. SIN `accion` y SIN `confirmado` — mismo
 * criterio que el resto de las operaciones de sólo lectura.
 */
export const OPERACION_VER_SOLICITUDES_A2A = "ver_solicitudes_a2a";

/**
 * `consulta-kpi-a2a-chat`, ADR 243/244/245/246 — consulta a un agente EXTERNO
 * por A2A saliente. DECIMOTERCERA entrada del contrato. ★ ÚNICA operación del
 * contrato con efecto FUERA del arnés, y por eso la única que exige rol
 * `administrador` (ADR 244) pese a ser de un solo paso.
 * `consultaId` es una clave de un conjunto CERRADO (`CONSULTAS_KPI`): el modelo
 * NUNCA compone el texto que sale (ADR 243). SIN `accion` y SIN `confirmado`.
 */
export const OPERACION_CONSULTAR_KPI = "consultar_kpi";

export const OPERACIONES_NEGOCIO = [
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_RESOLVER_SOLICITUD,
  OPERACION_RESOLVER_REEMBOLSO,
  OPERACION_SOLICITAR_DEVOLUCION,
  OPERACION_CONSULTAR_VENTA,
  OPERACION_CONSULTAR_SOLICITUD,
  OPERACION_VER_SOLICITUDES_A2A,
  OPERACION_CONSULTAR_KPI,
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

/**
 * `aprobacion-conversacional-hitl`, ADR 206. Mismo criterio que
 * `AccionSolicitudModelo` — elección de operación que el modelo comunica,
 * nunca un campo `confirmado`. A diferencia del dominio solicitud, `"reabrir"`
 * SÍ es un valor válido acá (`resolverEscalacionReembolso` ya lo soporta
 * desde `tui-canal-empleado`). **Nunca** incluye `"cancelar"` (ADR 217).
 */
export type AccionReembolsoModelo = "aprobar" | "rechazar" | "reabrir";

/** `ventaId` ausente ⇒ modo listado, sin tocar ninguna ranura de confirmación (mismo criterio que `resolver_solicitud`). */
export interface OperacionResolverReembolso {
  readonly operacion: typeof OPERACION_RESOLVER_REEMBOLSO;
  readonly accion: AccionReembolsoModelo;
  readonly ventaId?: string;
}

/**
 * `devolucion-sin-token-dos-personas`, ADR 225/229 pto 5 — de sólo lectura:
 * SIN `accion` (no es una elección de operación) y SIN `confirmado` (no
 * consume ninguna ranura de confirmación, a diferencia de `resolver_reembolso`/
 * `resolver_solicitud`/`cancelar_solicitud_interna`). `ventaId` ausente ⇒
 * modo listado de TODAS las ventas propias, cualquier estado (mismo criterio
 * de modo listado que `cancelar_solicitud_interna`/`resolver_reembolso`).
 */
export interface OperacionConsultarVenta {
  readonly operacion: typeof OPERACION_CONSULTAR_VENTA;
  readonly ventaId?: string;
}

/**
 * `devolucion-sin-token-dos-personas`, ADR 223/228/229 pto 3. `ventaId`
 * ausente ⇒ modo listado de ventas propias `confirmada` (mismo criterio de
 * modo listado que `resolver_reembolso`/`resolver_solicitud`). SIN `accion`
 * (no es una elección de operación) y SIN `confirmado` (lo decide el
 * composition root contra `ConfirmacionOperacionPort`, mismo criterio que el
 * resto de las operaciones de dos turnos).
 */
export interface OperacionSolicitarDevolucion {
  readonly operacion: typeof OPERACION_SOLICITAR_DEVOLUCION;
  readonly ventaId?: string;
  readonly motivo?: string;
}

/**
 * `consulta-solicitud-propia`, ADR 237/238/239 — de sólo lectura: SIN `accion`
 * (no es una elección de operación) y SIN `confirmado` (no consume ninguna
 * ranura de confirmación) — mismo criterio que `consultar_venta`.
 * `solicitudId` ausente ⇒ modo listado de TODAS las solicitudes propias,
 * cualquier estado.
 */
export interface OperacionConsultarSolicitud {
  readonly operacion: typeof OPERACION_CONSULTAR_SOLICITUD;
  readonly solicitudId?: string;
}

/**
 * `visibilidad-a2a-entrante-chat`, ADR 240-242 — de sólo lectura, alcance
 * organizacional. `a2aTaskId` ausente ⇒ modo listado de las solicitudes A2A
 * entrantes en curso; con id, el detalle de una puntual.
 */
export interface OperacionVerSolicitudesA2A {
  readonly operacion: typeof OPERACION_VER_SOLICITUDES_A2A;
  readonly a2aTaskId?: string;
}

export interface OperacionConsultarKpi {
  readonly operacion: typeof OPERACION_CONSULTAR_KPI;
  /** ★ OBLIGATORIO EN EL TIPO, a diferencia de `ventaId?`/`a2aTaskId?`: no hay
   *  modo listado. ★ D1: en el ZOD PLANO va `.optional()` (el objeto es
   *  compartido por las trece operaciones); quien exige la presencia es
   *  `CAMPOS_REQUERIDOS_POR_OPERACION`, ANTES del cast a esta unión — así que
   *  cuando el dispatcher recibe este tipo, el campo ya está garantizado.
   *  Tipado como `string` y NO como `ConsultaKpiClave` — este módulo no importa
   *  nada (regla escrita, `:1-8`); el narrowing lo hace el dispatcher con
   *  `esConsultaKpiConocida` (§7 pto 3). */
  readonly consultaId: string;
}

export type OperacionNegocio =
  | OperacionResolverDecisionVenta
  | OperacionProcesarDevolucion
  | OperacionCrearSolicitudInterna
  | OperacionCancelarSolicitudInterna
  | OperacionRegistrarVenta
  | OperacionConsultarReporteComisiones
  | OperacionResolverSolicitud
  | OperacionResolverReembolso
  | OperacionSolicitarDevolucion
  | OperacionConsultarVenta
  | OperacionConsultarSolicitud
  | OperacionVerSolicitudesA2A
  | OperacionConsultarKpi;

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
/**
 * `devolucion-sin-token-dos-personas`, ADR 229 pto 1-2 — dominio PROPIO, no
 * reuso de `DOMINIO_REEMBOLSO`: con dominio compartido, una iniciación
 * pendiente y una aprobación pendiente sobre el MISMO `ventaId` compartirían
 * llave y `marcarPendiente` sobreescribiría una con la otra — dos
 * operaciones con controles distintos pisándose. `confirmacion-operaciones-
 * store.ts` no cambia una sola línea de código por esto (es genérico sobre
 * `DominioConfirmacion`, tarea 12).
 */
export const DOMINIO_DEVOLUCION = "devolucion";
/** Vocabulario REUSADO de la ranura única de la TUI (`build-on-comando-empleado.ts:272-299`, ADR 55). */
export type DominioConfirmacion = typeof DOMINIO_REEMBOLSO | typeof DOMINIO_SOLICITUD | typeof DOMINIO_DEVOLUCION;
/**
 * `"solicitar"` — `devolucion-sin-token-dos-personas`, ADR 229 pto 3. NO es
 * campo de ningún schema: `solicitar_devolucion` no tiene campo `accion`, y
 * por eso no entra en `VALORES_PERMITIDOS_POR_OPERACION`. El dispatcher
 * construye la llave con `accion: "solicitar"` LITERAL, desde el closure.
 */
export type AccionConfirmable = "aprobar" | "rechazar" | "reabrir" | "cancelar" | "solicitar";

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
