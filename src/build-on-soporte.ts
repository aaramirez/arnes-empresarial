/**
 * Wiring del ÚNICO camino de este hito que invoca al modelo (ADR 7 de la
 * propuesta, punto 2; spec `soporte-web-turno`, design.md §6.4). Módulo
 * hermano de `build-on-venta.ts` y de `build-on-activity.ts`: vive en
 * `src/`, no dentro de ningún adaptador ni de `core/`, porque importa TANTO
 * de `src/core/*` (`handleTurn`, `buildSoportePrompt`, `ventas-contract`,
 * `turn-logger`) COMO de `src/adapters/memory/repository.ts`
 * (`createCaso` directo — sin `VentaStorePort`/`ActivityStorePort`
 * equivalente: acá no hace falta traducir ninguna fila, solo crear el
 * `caso`).
 *
 * Es su contraste deliberado con `build-on-venta.ts`: acá SÍ está el SDK,
 * porque acá SÍ hay un paso de razonamiento real — una consulta abierta de
 * un cliente. Es casi exactamente el `runTurn` de `buildOnActivity`
 * (`build-on-activity.ts:223-233`), con dos diferencias:
 *  - crea su propio `caso` tipo `CASO_TIPO_SOPORTE` ANTES de invocar
 *    `handleTurn` (spec: para que el turno quede correlacionado por
 *    `casoId` igual que en Hitos 2 y 3);
 *  - NO hay `KeyedQueue`: no hay recurso compartido que serializar. Cada
 *    consulta de soporte es un `caso` nuevo e independiente.
 *
 * PROPAGA `TurnFailedError` — a diferencia de `buildOnActivity`, que traga
 * porque GitHub ya recibió su `202`. Acá hay un cliente HTTP esperando y el
 * adaptador web traduce el rechazo a un `502` (§4.4, ADR 14). Por eso este
 * módulo NO tiene ningún `try/catch`: tanto la falla de `createCaso` como la
 * de `handleTurn` propagan tal cual hasta el caller.
 *
 * `handle-turn.ts` NO se modifica ni recibe dependencias nuevas: este
 * módulo lo ENVUELVE.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { CASO_TIPO_SOPORTE } from "./core/ventas/ventas-contract.js";
import { buildSoportePrompt } from "./core/ventas/soporte-prompt.js";
import { createCaso } from "./adapters/memory/repository.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";

/**
 * Valor idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`. Duplicado a
 * propósito, no un descuido: este módulo no importa `handle-turn.ts` para
 * esta constante (regla no negociable de `AGENTS.md`: solo se importa lo que
 * hace falta, y `casos.estado` es un TEXT abierto en el esquema) — mismo
 * criterio que `registrar-venta.ts` ya documenta para su propia copia.
 */
const CASO_ESTADO_ACTIVO = "activo";

export interface BuildOnSoporteDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  /** La MISMA fábrica por `casoId` que `main.ts` ya arma para la TUI y los webhooks — un `KnowledgeAdapter` por turno, fix de R1 de Hito 3 que este hito no reintroduce. */
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  readonly newId?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps; // omitir en producción (default: archivo)
}

export interface SoporteResult {
  readonly casoId: string;
  readonly respuesta: string;
}

/**
 * Devuelve el handler `(input) => Promise<SoporteResult>` que el Adaptador
 * Web invoca por cada `POST /soporte`. Secuencia exacta (design.md §6.4):
 *
 *  1. `casoId = newId()`; `createCaso(db, { id: casoId, tipo:
 *     CASO_TIPO_SOPORTE, estado: CASO_ESTADO_ACTIVO, ... })`. PROPAGA si
 *     falla — sin `caso` no hay nada que correlacionar. →
 *     `soporte-caso-creado`.
 *  2. `prompt = buildSoportePrompt(consulta)` — PURO (§3.6). Reusa
 *     `CONVERSATIONAL_AGENT` vía `candidateAgents: agents`, con prompt
 *     sintético, SIN un segundo `AgentDefinition` y SIN tocar
 *     `definitions.ts` (spec, req. "Reuso de `CONVERSATIONAL_AGENT`").
 *  3. `knowledge = createKnowledge(casoId)`; `handleTurn(casoId, prompt,
 *     { memory, hooks, candidateAgents: agents, mcpServers,
 *       knowledgeFeedback, ...(logDeps ? { logDeps } : {}) })`. El spread
 *     condicional de `logDeps` es obligatorio bajo
 *     `exactOptionalPropertyTypes: true` — misma nota que
 *     `build-on-submit.ts`/`build-on-activity.ts` ya documentan.
 *  4. Devuelve `{ casoId, respuesta: result.responseText }`.
 */
export function buildOnSoporte(
  deps: BuildOnSoporteDeps,
): (input: { readonly consulta: string }) => Promise<SoporteResult> {
  const { db, memory, hooks, agents, createKnowledge, logDeps } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());

  return async (input) => {
    const casoId = newId();
    const timestamp = now();

    // Paso 1: PROPAGA si falla — sin caso no hay nada que correlacionar.
    // Nada se llama después de esto si `createCaso` lanza.
    createCaso(db, {
      id: casoId,
      tipo: CASO_TIPO_SOPORTE,
      estado: CASO_ESTADO_ACTIVO,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    logTurnEvent(casoId, "soporte-caso-creado", undefined, logDeps);

    const prompt = buildSoportePrompt(input.consulta);
    const knowledge = createKnowledge(casoId);

    const result = await handleTurn(casoId, prompt, {
      memory,
      hooks,
      candidateAgents: agents,
      ...(logDeps ? { logDeps } : {}),
      mcpServers: knowledge.mcpServers,
      knowledgeFeedback: knowledge.feedback,
    });

    return { casoId, respuesta: result.responseText };
  };
}
