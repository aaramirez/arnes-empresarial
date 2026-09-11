/**
 * Puerto de LECTURA de `solicitudes_a2a_entrantes` (v3.4.0, ADR 136/139).
 * Hermano de `a2a-entrante-prompt.ts`: misma familia, mismo directorio.
 * NO es vocabulario de protocolo — por eso no vive en `a2a-contract.ts`,
 * que este change no toca ni en un doc-comment (ADR 135 pto 3).
 * Importa de `a2a-contract.ts` (core → core, legal por `AGENTS.md`).
 */
import { TASK_STATES_CONOCIDOS, esEstadoTerminal, type TaskState } from "./a2a-contract.js";

/** DERIVADO, no literal (ADR 135). Hoy `[SUBMITTED, WORKING]`; un noveno
 *  estado se clasifica solo y de forma correcta por construcción. */
export const TASK_STATES_EN_CURSO: readonly TaskState[] = TASK_STATES_CONOCIDOS.filter(
  (estado) => !esEstadoTerminal(estado),
);

/** Tope del listado sin argumento — espejo de `LIMITE_LISTADO_PROPUESTAS`.
 *  ÚNICA fuente de verdad: el repositorio NO tiene default propio (ADR 140 pto 6). */
export const LIMITE_LISTADO_A2A_ENTRANTES = 20;

/** Líneas por página de `mensaje_recibido`/`resultado`. PROPIA, no
 *  `LINEAS_PAGINA_PATCH`: mismo valor, otro significado (ADR 142 pto 2). */
export const LINEAS_PAGINA_A2A = 80;

/**
 * ★ EL GUARD DE VOCABULARIO ES ESTE TIPO (ADR 141, R5). `estado` es TEXT sin
 * `CHECK` (`0011:29-31`) y `esEstadoTerminal` exige un `TaskState`: acá el
 * narrowing no es una regla que haya que recordar, es la única forma de
 * obtener un `TaskState`. `esEstadoTerminal(vista.estado.valor)` NO COMPILA
 * sin haber discriminado por `conocido` primero.
 */
export type EstadoSolicitudA2AEntrante =
  | { readonly conocido: true; readonly valor: TaskState }
  | { readonly conocido: false; readonly valor: string };

/**
 * La fila tal como el núcleo la ve. Nombrada `...VistaEmpleado`, no
 * `...Vista` a secas (post-Reviewer, tarea 10 review): la propuesta ya
 * había fijado que este tipo NO puede llamarse `SolicitudA2AEntranteVista`
 * — ese nombre está tomado por la vista del `TaskJson` saliente en
 * `src/adapters/a2a/server.ts:124`, un concepto distinto para un
 * consumidor distinto (protocolo A2A, no TUI de empleado). `design.md`
 * (ADR 139) pasó por alto esa restricción explícita de `proposal.md`
 * punto 4 al bajar la firma — se corrige acá sin reabrir ninguna decisión
 * de forma o de campos, sólo el nombre.
 * MÁS CHICA que `SolicitudA2AEntranteRow`
 * (`repository.ts`), a propósito (ADR 139 pto 3):
 *  · SIN `agenteExternoUrl` — siempre `NULL` (ADR 89) y R1 se vuelve
 *    ESTRUCTURAL: no hay campo desde donde imprimir una identidad falsa.
 *  · SIN `id` — el comando indexa por `a2aTaskId` en sus dos modos.
 * `origenTransporte` es una DIRECCIÓN DE RED, no una identidad de agente
 * (`0011:18-20`), y el formateador la rotula así (ADR 142 pto 1).
 */
export interface SolicitudA2AEntranteVistaEmpleado {
  readonly a2aTaskId: string;
  readonly estado: EstadoSolicitudA2AEntrante;
  readonly origenTransporte: string;
  readonly casoId?: string;
  readonly mensajeRecibido: string;
  readonly resultado?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `hayMas` sale del `LIMIT limite + 1` (ADR 140 pto 5): sin él no se puede
 *  avisar del truncado sin mentir ni pagar un `COUNT(*)`. */
export interface ListadoSolicitudesA2AEntrantes {
  readonly items: readonly SolicitudA2AEntranteVistaEmpleado[];
  readonly hayMas: boolean;
}

/**
 * SÍNCRONO (ADR 100/134 pto 3: `better-sqlite3` no necesita `Promise`).
 * Sólo LECTURA: el camino de escritura del Hito 7 no pasa por acá y este
 * puerto no puede alcanzarlo.
 */
export interface SolicitudA2AEntranteStorePort {
  /** `estados` vacío ⇒ listado vacío, sin tocar la base (ADR 140 pto 3). */
  listarPorEstados(filtro: {
    readonly estados: readonly TaskState[];
    readonly limite?: number;
  }): ListadoSolicitudesA2AEntrantes;
  /** Envuelve `getSolicitudA2AEntrantePorTaskId` — CERO SQL nuevo (ADR 136). */
  obtenerPorTaskId(a2aTaskId: string): SolicitudA2AEntranteVistaEmpleado | undefined;
}
