/**
 * Vocabulario del Cliente A2A saliente (Hito 6, tarea 1, design.md §5.1,
 * ADR 71 pto 5, 72, 73 pto 2, 75 pto 1, 77, 84).
 *
 * `TASK_STATE_*` persiste el vocabulario CRUDO del protocolo A2A v1.0.0
 * (`TaskState`), sin traducir a minúscula-con-guion. La especificación real
 * define NUEVE valores — `TASK_STATE_UNSPECIFIED` incluido, verificado contra
 * `a2a-protocol.org/v1.0.0/specification/` en la fase de diseño (ADR 84) —
 * pero este arnés reconoce sólo los OCHO "reales/usables"; el noveno es el
 * valor cero de un enum proto3 (campo ausente o vacío, no un estado
 * intermedio) y cae por la regla de estado desconocido ⇒ `reason: "protocolo"`.
 *
 * `DESTINOS_A2A` es el registro ESTÁTICO y CERRADO de las dos claves de
 * destino externo (ADR 72 pto 1) — molde de `SUBAGENT_REGISTRY`, para
 * destinos EXTERNOS en vez de in-process.
 *
 * `ClienteA2APort` es el puerto que el núcleo posee sobre el Cliente A2A
 * (ADR 75 pto 1). `delegar` NUNCA rechaza (ADR 77): el desenlace viaja en
 * `ResultadoA2A`, unión discriminada por `ok`, y el núcleo construye
 * `DelegacionA2ANoCompletadaError` DESPUÉS de persistir la fila.
 *
 * Regla no negociable de `AGENTS.md`: `src/core/` no importa de
 * `src/adapters/*`, ni del SDK, ni de Node. Este archivo no importa nada —
 * mismo criterio que `src/core/hitl/hitl-contract.ts`,
 * `src/core/knowledge/knowledge-contract.ts` y
 * `src/core/activity/activity-contract.ts`.
 */

/* ── Vocabulario del protocolo, CRUDO (ADR 71 pto 5) ────────────────────── */

export const TASK_STATE_SUBMITTED = "TASK_STATE_SUBMITTED";
export const TASK_STATE_WORKING = "TASK_STATE_WORKING";
export const TASK_STATE_COMPLETED = "TASK_STATE_COMPLETED";
export const TASK_STATE_FAILED = "TASK_STATE_FAILED";
export const TASK_STATE_CANCELED = "TASK_STATE_CANCELED";
export const TASK_STATE_REJECTED = "TASK_STATE_REJECTED";
export const TASK_STATE_INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
export const TASK_STATE_AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED";

/**
 * Los OCHO estados que este arnés reconoce. `TASK_STATE_UNSPECIFIED` — que la
 * especificación v1.0.0 SÍ define, verificado en la fase de diseño — queda
 * AFUERA a propósito (ADR 84): no es un estado intermedio, es "el peer no
 * dijo en qué estado está", y cae por la regla de estado desconocido ⇒
 * `protocolo`.
 */
export const TASK_STATES_CONOCIDOS = [
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_CANCELED,
  TASK_STATE_REJECTED,
  TASK_STATE_INPUT_REQUIRED,
  TASK_STATE_AUTH_REQUIRED,
] as const;

export type TaskState = (typeof TASK_STATES_CONOCIDOS)[number];

/** PURA. Narrowing de un `string` crudo del protocolo al vocabulario conocido. */
export function esTaskStateConocido(valor: string): valor is TaskState {
  return (TASK_STATES_CONOCIDOS as readonly string[]).includes(valor);
}

/**
 * PURA. `COMPLETED` / `FAILED` / `CANCELED` / `REJECTED` son terminales;
 * `SUBMITTED` / `WORKING` no lo son; `INPUT_REQUIRED` / `AUTH_REQUIRED` son
 * terminales DE FRACASO (ADR 73 pto 2): esperan una interacción que este
 * hito no construye, y hacer polling sobre ellos sería esperar algo que no
 * llega.
 */
export function esEstadoTerminal(estado: TaskState): boolean {
  return estado !== TASK_STATE_SUBMITTED && estado !== TASK_STATE_WORKING;
}

/* ── Desenlaces (ADR 74 pto 5) ──────────────────────────────────────────── */

export type MotivoDelegacionA2ANoCompletada =
  | "failed"
  | "canceled"
  | "rejected"
  | "input-required"
  | "auth-required"
  | "timeout"
  | "transporte"
  | "protocolo";

/**
 * PURA y TOTAL. Estado terminal de fracaso → su `reason`. `TASK_STATE_COMPLETED`
 * NO es entrada válida (es el único éxito) y `SUBMITTED`/`WORKING` tampoco
 * (no son terminales) — el tipo lo impide, no un `if`.
 */
export function motivoDeEstadoTerminal(
  estado: Exclude<TaskState, "TASK_STATE_COMPLETED" | "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING">,
): MotivoDelegacionA2ANoCompletada {
  switch (estado) {
    case TASK_STATE_FAILED:
      return "failed";
    case TASK_STATE_CANCELED:
      return "canceled";
    case TASK_STATE_REJECTED:
      return "rejected";
    case TASK_STATE_INPUT_REQUIRED:
      return "input-required";
    case TASK_STATE_AUTH_REQUIRED:
      return "auth-required";
  }
}

/* ── Registro ESTÁTICO de destinos externos (ADR 72 pto 1) ──────────────── */

export const DESTINO_A2A_RIESGO_CREDITO = "riesgo-credito";
export const DESTINO_A2A_KPI_INCIDENTE = "kpi-incidente";

/** Las DOS claves, y no hay una tercera. Mismo espíritu que `SUBAGENT_REGISTRY`, para destinos EXTERNOS. */
export const DESTINOS_A2A = [DESTINO_A2A_RIESGO_CREDITO, DESTINO_A2A_KPI_INCIDENTE] as const;
export type DestinoA2AClave = (typeof DESTINOS_A2A)[number];

/** `clave` fuera del registro cerrado — molde exacto de `SubagenteDesconocidoError`. */
export class DestinoA2ADesconocidoError extends Error {
  constructor(clave: string) {
    super(`Destino A2A desconocido: "${clave}" no está registrado en DESTINOS_A2A`);
    this.name = "DestinoA2ADesconocidoError";
  }
}

/* ── El puerto (ADR 75 pto 1, ADR 77) ───────────────────────────────────── */

export interface ResultadoA2AOk {
  readonly ok: true;
  readonly a2aTaskId: string;
  readonly estado: "TASK_STATE_COMPLETED";
  readonly resultado: string;
  /** `name` del Agent Card — evidencia del desenlace, NO parte de la tarea (ADR 79 pto 2). */
  readonly agenteNombre: string;
  /** Endpoint JSON-RPC EFECTIVO, el que el card declaró (ADR 80 pto 1). */
  readonly endpoint: string;
}

export interface ResultadoA2AFallo {
  readonly ok: false;
  readonly reason: MotivoDelegacionA2ANoCompletada;
  /** Último estado conocido; ausente si nunca hubo un `SendMessage` exitoso. */
  readonly estado?: TaskState;
  readonly a2aTaskId?: string;
  readonly endpoint?: string;
  /** Diagnóstico ya truncado a 500 chars por el adaptador. NUNCA una credencial. */
  readonly detalle?: string;
}

export type ResultadoA2A = ResultadoA2AOk | ResultadoA2AFallo;

/**
 * Puerto que el núcleo posee sobre el Cliente A2A. Molde de `InvocarSubagente`
 * (`subagents.ts`): declarado acá, implementado en `src/adapters/a2a/`,
 * cerrado por el composition root. Todo test de núcleo lo satisface con un
 * doble puro — NINGUNO abre un socket.
 *
 * `delegar` NUNCA rechaza (ADR 77): el desenlace viaja en `ResultadoA2A` y el
 * error tipado lo construye el núcleo DESPUÉS de persistir la fila.
 *
 * `baseUrlDe` es SÍNCRONA y sin I/O: es una lectura del registro ya resuelto,
 * y existe para que `despacharDelegacionA2A` pueda fallar tipado ANTES de
 * crear una fila huérfana (ADR 80 pto 2).
 *
 * NINGUNA de las dos firmas acepta una URL: sólo una `DestinoA2AClave` del
 * conjunto cerrado (R8, requirement verificable por inspección de firmas).
 */
export interface ClienteA2APort {
  baseUrlDe(clave: DestinoA2AClave): string | undefined;
  delegar(input: {
    readonly clave: DestinoA2AClave;
    readonly tarea: string;
    readonly casoId: string;
  }): Promise<ResultadoA2A>;
}

/**
 * La delegación externa no llegó a `TASK_STATE_COMPLETED`. PROPAGA tal cual —
 * mismo contrato que `despacharCadena` ("NO captura: si un eslabón falla, el
 * error propaga tal cual"). Se lanza SIEMPRE después de que la fila quedó con
 * su último estado conocido (ADR 77 pto 3).
 */
export class DelegacionA2ANoCompletadaError extends Error {
  readonly reason: MotivoDelegacionA2ANoCompletada;
  readonly destinoClave: DestinoA2AClave;
  readonly estado?: TaskState | undefined;
  readonly delegacionId?: string | undefined;
  readonly detalle?: string | undefined;

  constructor(input: {
    readonly reason: MotivoDelegacionA2ANoCompletada;
    readonly destinoClave: DestinoA2AClave;
    readonly estado?: TaskState | undefined;
    readonly delegacionId?: string | undefined;
    readonly detalle?: string | undefined;
  }) {
    super(
      `Delegación A2A no completada: destino="${input.destinoClave}", reason="${input.reason}"` +
        (input.detalle !== undefined ? `, detalle="${input.detalle}"` : ""),
    );
    this.name = "DelegacionA2ANoCompletadaError";
    this.reason = input.reason;
    this.destinoClave = input.destinoClave;
    this.estado = input.estado;
    this.delegacionId = input.delegacionId;
    this.detalle = input.detalle;
  }
}
