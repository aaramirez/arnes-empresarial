/**
 * Builds el `ActivityEventHandler` que el Adaptador de Webhooks recibe
 * inyectado (Hito 3, tarea 21, ADR 5) — módulo hermano de
 * `build-on-submit.ts`: mismo patrón de aplicación parcial en el
 * composition root, mismo motivo de ubicación. Vive en `src/`, no dentro de
 * ningún adaptador ni de `core/`: importa TANTO de `src/core/*`
 * (`runActivityTurn`, `handleTurn`, `keyed-queue`, `activity-contract`,
 * `turn-logger`, `turn-error`) COMO de `src/adapters/*`
 * (`createKnowledgeAdapter`, y — vía `createActivityStore` — de
 * `src/adapters/memory/repository.ts`). Un archivo que conecta ambos lados
 * no puede vivir dentro de ninguno de los dos sin volverse, estructuralmente,
 * un adaptador hablándole a otro adaptador — la regla no negociable de
 * AGENTS.md que `build-on-submit.ts` ya documenta para el mismo caso.
 *
 * CONTRATO: la promesa que devuelve el handler NUNCA rechaza. GitHub ya
 * recibió su `202` (ADR 10) y no hay nadie del otro lado a quien entregarle
 * un error; un rechazo acá solo produciría un `unhandledRejection` en un
 * proceso que está sosteniendo una TUI. Toda falla se loguea
 * (`actividad-turno-fallido`) y se traga EN ESTE límite — nunca dentro de
 * `runActivityTurn`, que sí debe propagar (spec: "el error propaga como
 * fallo del turno").
 *
 * Tres cosas que el cuerpo de `buildOnActivity` decide, y que valen leer dos
 * veces:
 *
 * 1. `queue.run(evento.proyectoId, ...)` envuelve el ciclo COMPLETO, no solo
 *    la escritura: lo que hay que serializar es leer-actividad → `await` del
 *    modelo → escribir-actividad (ADR 8).
 * 2. `createKnowledge(casoId)` se llama DENTRO de `runTurn`, o sea una vez
 *    por turno y con el `casoId` que `runActivityTurn` acaba de crear o
 *    resolver. Ese es el fix de R1 (spec `knowledge-query`): cada turno
 *    tiene su propio `CitedNodesRecorder` y las citas no se cruzan con las
 *    de un turno concurrente.
 * 3. El spread condicional de `logDeps` es obligatorio bajo
 *    `exactOptionalPropertyTypes: true`, exactamente como `build-on-submit.ts`
 *    ya documenta. `mcpServers`/`knowledgeFeedback` van SIEMPRE (acá el
 *    conocimiento nunca es opcional).
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { KeyedQueue } from "./core/concurrency/keyed-queue.js";
import { runActivityTurn } from "./core/activity/run-activity-turn.js";
import {
  ACTIVIDAD_ESTADOS,
  ACTIVIDAD_TIPOS,
  type ActivityBoardPort,
  type ActivityStorePort,
  type Actividad,
  type ActividadEstado,
  type ActividadTipo,
  type IncomingActivityEvent,
} from "./core/activity/activity-contract.js";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { TurnFailedError } from "./core/turn-selector/turn-error.js";
import { createKnowledgeAdapter, type KnowledgeAdapter } from "./adapters/knowledge/index.js";
import {
  createCasoConActividad,
  findActividadPorReferencia,
  updateActividad,
  type Actividad as RepositoryActividad,
} from "./adapters/memory/repository.js";

export type ActivityEventHandler = (evento: IncomingActivityEvent) => Promise<void>;

export interface BuildOnActivityDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly board: ActivityBoardPort;
  /** Inyectada para que el test pueda observar `size` y el orden; producción pasa `createKeyedQueue()`. */
  readonly queue: KeyedQueue;
  readonly newId?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps; // omitir en producción (default: archivo)
  /**
   * Fábrica del Adaptador de Conocimiento POR CASO — fix de R1 y del spec
   * `knowledge-query`. Default: `(casoId) => createKnowledgeAdapter({ casoId,
   * logEvent: (e, f) => logTurnEvent(casoId, e, f, logDeps) })`. Inyectable
   * para que el test pueda afirmar que se construye UNA instancia POR
   * `casoId`, con su propio `CitedNodesRecorder`.
   */
  readonly createKnowledge?: (casoId: string) => KnowledgeAdapter;
  /** Inyectable solo para el test; default: la implementación de abajo sobre `repository.ts`. */
  readonly store?: ActivityStorePort;
}

/**
 * Lanzado por `toPortActividad` cuando una fila de `actividades` trae un
 * `tipo`/`estado` que no pertenece a `ACTIVIDAD_TIPOS`/`ACTIVIDAD_ESTADOS`.
 * `repository.ts` deja esas columnas como TEXT sin `CHECK` a propósito (su
 * module doc: "el conjunto de estados válidos es asunto del núcleo, no de
 * un enum de columna"), así que esto NUNCA es una entrada externa
 * impredecible (a diferencia del veredicto que devuelve el modelo, texto
 * libre) — es corrupción de datos real: un bug en algún punto de escritura,
 * o manipulación externa de la base. `ActivityStorePort` es explícito
 * ("CONTRATO: falla RUIDOSAMENTE") — este error es esa falla ruidosa, en el
 * único punto donde se puede detectar: la traducción a la forma del puerto,
 * no la capa SQL (por eso vive acá y no en `repository.ts`).
 */
export class ActividadTipoEstadoInvalidoError extends Error {
  constructor(actividadId: string, tipo: string, estado: string) {
    super(`Actividad ${actividadId} tiene tipo/estado inválido en la base: ${tipo}/${estado}`);
    this.name = "ActividadTipoEstadoInvalidoError";
  }
}

/**
 * Traduce una fila `Actividad` de `repository.ts` (`tipo`/`estado` como
 * `string` suelto) a la `Actividad` del puerto (`tipo: ActividadTipo`,
 * `estado: ActividadEstado`, uniones literales). Valida contra las listas
 * canónicas de `activity-contract.ts` en vez de castear a ciegas: si
 * `row.tipo`/`row.estado` no aparecen ahí, lanza `ActividadTipoEstadoInvalidoError`
 * en vez de devolver un objeto con un valor inválido disfrazado de válido.
 */
function toPortActividad(row: RepositoryActividad): Actividad {
  const tipoValido = (ACTIVIDAD_TIPOS as readonly string[]).includes(row.tipo);
  const estadoValido = (ACTIVIDAD_ESTADOS as readonly string[]).includes(row.estado);
  if (!tipoValido || !estadoValido) {
    throw new ActividadTipoEstadoInvalidoError(row.id, row.tipo, row.estado);
  }
  return {
    ...row,
    tipo: row.tipo as ActividadTipo,
    estado: row.estado as ActividadEstado,
  };
}

/**
 * `ActivityStorePort` por closures sobre `repository.ts` — mismo patrón, y
 * mismo lugar, que el `MemoryPort` que `main.ts` ya arma hoy (verificado).
 * No merece archivo propio en el adaptador: son tres delegaciones directas
 * sin lógica de negocio propia — solo traducción de forma entre el puerto
 * (`activity-contract.ts`) y las funciones reales (`repository.ts`):
 *
 * 1. `findActividadPorReferencia`: el puerto agrupa `{proyectoId,
 *    referenciaExterna}` en un objeto; `repository.ts` los expone como dos
 *    parámetros posicionales — se desestructura el input y se llama
 *    posicionalmente. El resultado (o `undefined`) pasa por
 *    `toPortActividad`.
 * 2. `createCasoConActividad`: el `CreateCasoConActividadInput` del puerto
 *    NO trae `createdAt`/`updatedAt` en `caso`/`actividad` (un único
 *    `timestamp` para las cuatro filas); el de `repository.ts` los exige en
 *    ambos. Se completan los dos con `input.timestamp` antes de delegar. El
 *    puerto devuelve `Actividad` directamente — se toma solo `.actividad`
 *    del `CreateCasoConActividadResult` que `repository.ts` devuelve.
 * 3. `updateActividadEstado`: mapeo directo a
 *    `repository.updateActividad(db, actividadId, {estado, responsableId,
 *    updatedAt})`. `responsableId` se spreadea condicionalmente — bajo
 *    `exactOptionalPropertyTypes: true`, incluir la clave con valor
 *    `undefined` no es lo mismo que omitirla (mismo patrón que
 *    `run-activity-turn.ts`/`build-on-submit.ts` ya usan).
 */
export function createActivityStore(db: Database.Database): ActivityStorePort {
  return {
    findActividadPorReferencia(input) {
      const row = findActividadPorReferencia(db, input.proyectoId, input.referenciaExterna);
      return row ? toPortActividad(row) : undefined;
    },

    createCasoConActividad(input) {
      const { actividad } = createCasoConActividad(db, {
        proyecto: input.proyecto,
        ...(input.responsable !== undefined ? { responsable: input.responsable } : {}),
        caso: {
          id: input.caso.id,
          tipo: input.caso.tipo,
          estado: input.caso.estado,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
        },
        actividad: {
          id: input.actividad.id,
          tipo: input.actividad.tipo,
          referenciaExterna: input.actividad.referenciaExterna,
          estado: input.actividad.estado,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
        },
        timestamp: input.timestamp,
      });
      return toPortActividad(actividad);
    },

    updateActividadEstado(input) {
      const row = updateActividad(db, input.actividadId, {
        estado: input.estado,
        ...(input.responsableId !== undefined ? { responsableId: input.responsableId } : {}),
        updatedAt: input.updatedAt,
      });
      return toPortActividad(row);
    },
  };
}

/**
 * Devuelve el callback `(evento) => Promise<void>` que el Adaptador de
 * Webhooks recibe inyectado (ADR 5, punto 2-3). Ver el module doc de arriba
 * para el contrato completo (nunca rechaza) y las tres decisiones del
 * cuerpo.
 */
export function buildOnActivity(deps: BuildOnActivityDeps): ActivityEventHandler {
  const { db, memory, hooks, agents, board, queue, logDeps } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const store = deps.store ?? createActivityStore(db);
  const createKnowledge =
    deps.createKnowledge ??
    ((casoId: string) =>
      createKnowledgeAdapter({
        casoId,
        logEvent: (e, f) => logTurnEvent(casoId, e, f, logDeps),
      }));

  return (evento) =>
    queue.run(evento.proyectoId, async () => {
      try {
        await runActivityTurn(evento, {
          store,
          board,
          runTurn: (casoId, prompt) => {
            const knowledge = createKnowledge(casoId);
            return handleTurn(casoId, prompt, {
              memory,
              hooks,
              candidateAgents: agents,
              ...(logDeps ? { logDeps } : {}),
              mcpServers: knowledge.mcpServers,
              knowledgeFeedback: knowledge.feedback,
            });
          },
          newId,
          now,
          logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields, logDeps),
        });
      } catch (error) {
        logTurnEvent(
          evento.deliveryId,
          "actividad-turno-fallido",
          {
            proyectoId: evento.proyectoId,
            referenciaExterna: evento.referenciaExterna,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof TurnFailedError ? { stage: error.stage } : {}),
          },
          logDeps,
        );
      }
    });
}
