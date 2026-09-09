/**
 * Despachador de Delegación EXTERNA vía A2A (Hito 6, tarea 12, design.md §5.2,
 * ADR 74 pto 3, ADR 78 pto 1-3, ADR 79, ADR 80, ADR 77 pto 4).
 *
 * Función **hermana** de `despacharDelegacion` (`dispatch-delegation.ts`): el
 * mismo criterio de "crear fila ANTES de invocar, actualizar SIEMPRE después"
 * pero para el brazo `a2a` de `DestinoDelegacion`, contra un agente EXTERNO
 * que no tiene entrada en `SUBAGENT_REGISTRY` ni produce sesión del SDK.
 *
 * `resolverDestinoA2A` es PURA y SÍNCRONA — hermana de `resolverDestino`:
 * valida una clave cruda contra el registro CERRADO `DESTINOS_A2A` y lanza
 * `DestinoA2ADesconocidoError` sin tocar la base.
 *
 * `construirTareaDelegadaA2A` reusa `TAREA_DELEGADA_MAX_CHARS`/
 * `truncarTareaDelegada` TAL CUAL (ADR 79 pto 3) — el mismo tope que
 * `delegaciones.tarea_delegada`, no una copia. NO recibe una
 * `AgentDefinition`: un agente externo no tiene entrada en
 * `SUBAGENT_REGISTRY` (R2). El encabezado es la CLAVE, no el nombre del
 * Agent Card, porque la fila se crea ANTES de conocerlo (ADR 79 pto 1).
 *
 * `despacharDelegacionA2A` (§4.1 pasos a-f):
 *  a. `deps.cliente.baseUrlDe(destino.clave)` — sin destino configurado NO se
 *     crea fila (ni `crearDelegacionA2A` ni `delegar` se llaman).
 *  b. `construirTareaDelegadaA2A(destino.clave, insumo)`.
 *  c. `store.crearDelegacionA2A(...)` — ANTES de invocar, estado SUBMITTED.
 *  d. `await deps.cliente.delegar(...)` — `delegar` nunca rechaza por
 *     contrato (ADR 77), pero el `try/catch` es una red de seguridad
 *     (ADR 77 pto 4): si igual rechaza, se traduce a
 *     `{ ok: false, reason: "transporte" }`.
 *  e. `store.actualizarDelegacionA2A(...)` — SIEMPRE, con el último estado
 *     conocido.
 *  f. éxito ⇒ `DelegacionA2AAplicada`. Cualquier otro desenlace ⇒ `throw`
 *     `DelegacionA2ANoCompletadaError` con el `reason`, lanzada DESPUÉS de
 *     persistir en (e), no antes.
 *
 * SÍNCRONO POR TURNO (ADR 74): se resuelve dentro del mismo `await` que la
 * invoca. No hay estado `pendiente_a2a`, ni cola, ni scheduler.
 *
 * Imports: `../agents/subagents.js` y `../agents/a2a-contract.js`
 * (núcleo → núcleo) y, solo como TIPO, `./dispatch-delegation.js`. Regla no
 * negociable de `AGENTS.md`: `src/core/` nunca importa de `src/adapters/*`.
 * Deliberadamente **ningún** import de `src/adapters/a2a/`.
 */
import { TAREA_DELEGADA_MAX_CHARS, truncarTareaDelegada, type InsumoDelegado } from "../agents/subagents.js";
import {
  DelegacionA2ANoCompletadaError,
  DestinoA2ADesconocidoError,
  DESTINOS_A2A,
  type ClienteA2APort,
  type DestinoA2AClave,
  type ResultadoA2A,
  type TaskState,
} from "../agents/a2a-contract.js";
import type { DestinoDelegacion } from "./dispatch-delegation.js";

/** El brazo externo de la unión, con nombre propio (ADR 78 pto 3). */
export type DestinoA2A = Extract<DestinoDelegacion, { kind: "a2a" }>;

/**
 * PURA y SÍNCRONA. Hermana de `resolverDestino`: valida una clave cruda
 * contra el registro CERRADO `DESTINOS_A2A` y lanza `DestinoA2ADesconocidoError`
 * sin tocar la base. No acepta ni produce URLs.
 */
export function resolverDestinoA2A(clave: string): DestinoA2A {
  if (!(DESTINOS_A2A as readonly string[]).includes(clave)) {
    throw new DestinoA2ADesconocidoError(clave);
  }

  return { kind: "a2a", clave: clave as DestinoA2AClave };
}

/**
 * PURA. Reusa `TAREA_DELEGADA_MAX_CHARS` (8_000) TAL CUAL vía
 * `truncarTareaDelegada` — el mismo tope que `delegaciones.tarea_delegada`,
 * no una copia (ADR 79 pto 3). NO recibe una `AgentDefinition`: un agente
 * externo no tiene entrada en `SUBAGENT_REGISTRY` (R2). El encabezado es la
 * CLAVE, no el nombre del Agent Card, porque la fila se crea ANTES de
 * conocerlo (ADR 79 pto 1).
 *
 * Texto generado, en este orden:
 *   1. `Destino externo: <clave>`
 *   2. `Instrucción: <insumo.instruccion>`
 *   3. (línea en blanco) + `insumo.material`
 */
export function construirTareaDelegadaA2A(clave: DestinoA2AClave, insumo: InsumoDelegado): string {
  const texto = [
    `Destino externo: ${clave}`,
    `Instrucción: ${insumo.instruccion}`,
    "",
    insumo.material,
  ].join("\n");

  return truncarTareaDelegada(texto);
}

/**
 * Puerto sobre `delegaciones_a2a`. DOS métodos, no tres, y NINGUNO
 * transaccional (ADR 80 pto 3): a diferencia de `DelegacionStorePort`, acá no
 * hay fila de `sesiones_agente` que insertar en el mismo acto — un agente
 * externo no produce sesión del SDK.
 *
 * Los dos PROPAGAN si fallan (ADR 80 pto 4): sin fila no hay trazabilidad.
 */
export interface DelegacionA2AStorePort {
  crearDelegacionA2A(input: {
    readonly id: string;
    readonly casoId: string;
    readonly destinoClave: DestinoA2AClave;
    /** URL BASE configurada. Se sobrescribe con el endpoint efectivo al completar (ADR 80 pto 1). */
    readonly agenteExternoUrl: string;
    readonly tareaDelegada: string;
    readonly estado: TaskState; // siempre TASK_STATE_SUBMITTED en este punto
    readonly createdAt: string;
  }): void;
  actualizarDelegacionA2A(input: {
    readonly delegacionId: string;
    readonly estado: TaskState;
    readonly a2aTaskId?: string;
    readonly resultado?: string;
    readonly agenteExternoUrl?: string;
    readonly updatedAt: string;
  }): void;
}

/** Dependencias de `despacharDelegacionA2A` (design.md §5.2). */
export interface DespacharDelegacionA2ADeps {
  readonly store: DelegacionA2AStorePort;
  readonly cliente: ClienteA2APort;
  /** `randomUUID` en producción; contador determinista en tests. */
  readonly newId: () => string;
  /** `() => new Date().toISOString()` en producción. */
  readonly now: () => string;
  /** Ya cerrado sobre `LogTurnEventDeps`; el núcleo no decide el destino del log. */
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

/**
 * Resultado de UNA delegación externa despachada de punta a punta. NO es
 * `DelegacionAplicada` y no puede serlo (R2, ADR 74 pto 3): no hay
 * `sesionSubagenteId` porque no hay sesión del SDK, y `agentId` no significa
 * nada para un agente que no está en `SUBAGENT_REGISTRY`.
 */
export interface DelegacionA2AAplicada {
  readonly delegacionId: string;
  readonly destinoClave: DestinoA2AClave;
  readonly a2aTaskId: string;
  readonly agenteNombre: string;
  readonly tareaDelegada: string;
  readonly resultado: string;
}

/**
 * UNA delegación EXTERNA, de punta a punta (design.md §4.1, §5.2 pasos a-f).
 * Ver doc-comment del módulo para el detalle de cada paso.
 *
 * NO importa `src/adapters/a2a/` (requirement del spec, verificable por
 * inspección de imports).
 */
export async function despacharDelegacionA2A(
  input: {
    readonly casoId: string;
    readonly destino: DestinoA2A;
    readonly insumo: InsumoDelegado;
  },
  deps: DespacharDelegacionA2ADeps,
): Promise<DelegacionA2AAplicada> {
  const { casoId, destino, insumo } = input;
  const { store, cliente, newId, now, logEvent } = deps;
  const destinoClave = destino.clave;

  const agenteExternoUrl = cliente.baseUrlDe(destinoClave);
  if (agenteExternoUrl === undefined) {
    // RD-22 (design.md): "destino no configurado" no abre un noveno `reason`
    // — se reporta como `transporte` (grueso, aceptado) y se distingue por el
    // evento propio `a2a-destino-no-configurado`. Cero filas (§5.2 paso a).
    logEvent(casoId, "a2a-destino-no-configurado", { destinoClave });
    throw new DelegacionA2ANoCompletadaError({
      reason: "transporte",
      destinoClave,
    });
  }

  const tareaDelegada = construirTareaDelegadaA2A(destinoClave, insumo);
  const delegacionId = newId();
  const createdAt = now();

  store.crearDelegacionA2A({
    id: delegacionId,
    casoId,
    destinoClave,
    agenteExternoUrl,
    tareaDelegada,
    estado: "TASK_STATE_SUBMITTED",
    createdAt,
  });
  logEvent(casoId, "delegacion-a2a-iniciada", {
    destinoClave,
    delegacionId,
    tareaChars: tareaDelegada.length,
  });

  let resultado: ResultadoA2A;
  try {
    resultado = await cliente.delegar({ clave: destinoClave, tarea: tareaDelegada, casoId });
  } catch {
    resultado = { ok: false, reason: "transporte" };
  }

  const updatedAt = now();

  if (resultado.ok) {
    store.actualizarDelegacionA2A({
      delegacionId,
      estado: resultado.estado,
      a2aTaskId: resultado.a2aTaskId,
      resultado: resultado.resultado,
      agenteExternoUrl: resultado.endpoint,
      updatedAt,
    });
    logEvent(casoId, "delegacion-a2a-completada", {
      destinoClave,
      delegacionId,
      a2aTaskId: resultado.a2aTaskId,
      resultadoChars: resultado.resultado.length,
    });

    return {
      delegacionId,
      destinoClave,
      a2aTaskId: resultado.a2aTaskId,
      agenteNombre: resultado.agenteNombre,
      tareaDelegada,
      resultado: resultado.resultado,
    };
  }

  store.actualizarDelegacionA2A({
    delegacionId,
    estado: resultado.estado ?? "TASK_STATE_FAILED",
    ...(resultado.a2aTaskId !== undefined ? { a2aTaskId: resultado.a2aTaskId } : {}),
    ...(resultado.endpoint !== undefined ? { agenteExternoUrl: resultado.endpoint } : {}),
    updatedAt,
  });
  logEvent(casoId, "delegacion-a2a-fallida", {
    destinoClave,
    delegacionId,
    reason: resultado.reason,
    ...(resultado.a2aTaskId !== undefined ? { a2aTaskId: resultado.a2aTaskId } : {}),
  });

  throw new DelegacionA2ANoCompletadaError({
    reason: resultado.reason,
    destinoClave,
    ...(resultado.estado !== undefined ? { estado: resultado.estado } : {}),
    delegacionId,
    ...(resultado.detalle !== undefined ? { detalle: resultado.detalle } : {}),
  });
}
