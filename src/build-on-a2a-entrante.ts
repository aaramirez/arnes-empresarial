/**
 * Wiring del camino de LECTURA que este hito agrega al Selector de Turno
 * (Hito 7, tarea 15, design.md §5.2, ADR 87, 90 pto 1-3, 91, 94 pto 5-6, 95,
 * 98). Módulo HERMANO de `build-on-soporte.ts`: vive en `src/`, no dentro de
 * ningún adaptador ni de `core/`, porque importa TANTO de `src/core/*`
 * (`handleTurn`, `buildSolicitudA2APrompt`, `MAX_SOLICITUD_A2A_CHARS`,
 * `TASK_STATE_*`, `turn-logger`) COMO de `src/adapters/memory/repository.ts`
 * (`createCaso`/`insertSolicitudA2AEntrante`/`actualizarSolicitudA2AEnCurso`/
 * `getSolicitudA2AEntrantePorTaskId`/`cancelarSolicitudA2AEntrante` directo)
 * Y de los tipos del adaptador `src/adapters/a2a/server.ts` (los tres
 * callbacks que ese módulo consume, ya cerrados sobre `db`).
 *
 * **ADR 98 — la escritura es INEXPRESABLE por firma**: `BuildOnA2AEntranteDeps`
 * tiene EXACTAMENTE los mismos ocho campos que `BuildOnSoporteDeps`, ni uno
 * más. Ningún puerto de escritura (`board`, store de `actividades`,
 * `escritura`, `ClienteA2APort`) puede colarse acá sin tocar esta interfaz —
 * es la garantía mecánica de que el turno entrante es de sólo lectura, no
 * una declaración (spec `solicitud-a2a-entrante`, requirement "El turno
 * entrante es de lectura").
 *
 * Contraste deliberado con `build-on-soporte.ts`: allá el rechazo de
 * `handleTurn` PROPAGA porque hay un navegador esperando un `502`. Acá
 * `ejecutarTurno` NUNCA rechaza — no espera nadie: `onSolicitudA2A` devuelve
 * `{ turno }` SIN awaitear esa promesa, así que tragar y persistir `FAILED`
 * es la única forma de que la fila quede verdadera y de que no haya un
 * `unhandledRejection`.
 *
 * `handle-turn.ts` NO se modifica ni recibe dependencias nuevas: este módulo
 * lo ENVUELVE, igual que `build-on-soporte.ts` (spec, requirement "sin
 * camino de código paralelo").
 */
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import {
  buildSolicitudA2APrompt,
  MAX_SOLICITUD_A2A_CHARS,
} from "./core/agents/a2a-entrante-prompt.js";
import {
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_REJECTED,
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
} from "./core/agents/a2a-contract.js";
import {
  createCaso,
  insertSolicitudA2AEntrante,
  actualizarSolicitudA2AEnCurso,
  getSolicitudA2AEntrantePorTaskId,
  cancelarSolicitudA2AEntrante,
  type SolicitudA2AEntranteRow,
} from "./adapters/memory/repository.js";
import type {
  SolicitudA2AEntrada,
  SolicitudA2AAceptada,
  SolicitudA2AEntranteVista,
  CancelacionA2AResultado,
} from "./adapters/a2a/server.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";

/**
 * `casos.tipo` es `TEXT` sin `CHECK` — mismo criterio que
 * `CASO_TIPO_CONSULTA_KPI` en `build-on-comando-empleado.ts` y
 * `CASO_TIPO_SOPORTE` en `build-on-soporte.ts`. Constante LOCAL de este
 * módulo, sin migración de `casos` (spec, requirement "`CASO_TIPO_A2A_ENTRANTE`
 * ... aditivos y puros").
 */
export const CASO_TIPO_A2A_ENTRANTE = "a2a_entrante";

/**
 * Valor idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`/`build-on-soporte.ts`.
 * Duplicado a propósito, no un descuido: este módulo no importa ninguno de
 * esos dos archivos sólo para reusar esta constante — mismo criterio que
 * `build-on-soporte.ts` ya documenta para su propia copia (AGENTS.md: solo
 * se importa lo que hace falta).
 */
const CASO_ESTADO_ACTIVO = "activo";

export interface BuildOnA2AEntranteDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  /** La MISMA fábrica por `casoId` que `build-on-soporte.ts` ya usa — un `KnowledgeAdapter` por turno. */
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  readonly newId?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps; // omitir en producción (default: archivo)
}

/** Los tres handlers que `startA2AServer` necesita, ya cerrados sobre `db` (design.md §5.2). */
export interface A2AEntranteHandlers {
  readonly onSolicitudA2A: (input: SolicitudA2AEntrada) => Promise<SolicitudA2AAceptada>;
  readonly onConsultarTarea: (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined;
  readonly onCancelarTarea: (a2aTaskId: string) => CancelacionA2AResultado;
}

/**
 * `SolicitudA2AEntranteRow` → `SolicitudA2AEntranteVista`: `contextId` se
 * resuelve ACÁ (`casoId ?? a2aTaskId`, no en `construirTask`, design.md
 * líneas 648-654) — la única fila sin `casoId` es la `REJECTED` por tope de
 * turnos en vuelo, que no tiene otro identificador de correlación que su
 * propio `a2aTaskId`.
 */
function filaAVista(row: SolicitudA2AEntranteRow): SolicitudA2AEntranteVista {
  return {
    a2aTaskId: row.a2aTaskId,
    contextId: row.casoId ?? row.a2aTaskId,
    estado: row.estado,
    resultado: row.resultado,
    updatedAt: row.updatedAt,
  };
}

/**
 * Devuelve los TRES handlers `(onSolicitudA2A, onConsultarTarea,
 * onCancelarTarea)` que el composition root de `main.ts` pasa a
 * `startA2AServer` (design.md §5.2).
 */
export function buildOnA2AEntrante(deps: BuildOnA2AEntranteDeps): A2AEntranteHandlers {
  const { db, memory, hooks, agents, createKnowledge, logDeps } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());

  /**
   * `ejecutarTurno` — contrato: NUNCA rechaza (ver el doc-comment del
   * módulo). Invocada SIN awaitear desde `onSolicitudA2A` (design.md §5.2
   * paso (d)).
   *
   *  1. `actualizarSolicitudA2AEnCurso(WORKING)` ⇒ `false` significa que
   *     `CancelTask` ganó la carrera ANTES de que este turno arrancara: se
   *     loguea y se vuelve sin gastar una invocación al modelo.
   *  2. `prompt = buildSolicitudA2APrompt(texto)` (el `texto` que llega acá
   *     ya viene truncado por `onSolicitudA2A` — misma cadena que la fila
   *     persistida, para que la fila y lo que ve el modelo digan lo mismo) ·
   *     `knowledge = createKnowledge(casoId)`.
   *  3. `await handleTurn(casoId, prompt, {...})` — firma idéntica a la de
   *     `buildOnSoporte`, incluido el spread condicional de `logDeps` que
   *     `exactOptionalPropertyTypes: true` exige.
   *  4. Éxito: `actualizarSolicitudA2AEnCurso(COMPLETED, result.responseText)`
   *     ⇒ `false` significa que `CancelTask` ganó la carrera MIENTRAS el
   *     turno corría: el resultado se descarta, la fila queda `CANCELED`.
   *  5. `catch`: `actualizarSolicitudA2AEnCurso(FAILED)` + evento, con un
   *     SEGUNDO `catch` que evita cualquier `unhandledRejection` si el
   *     `UPDATE` de cierre también falla.
   */
  async function ejecutarTurno(casoId: string, a2aTaskId: string, texto: string): Promise<void> {
    try {
      const puestoEnCurso = actualizarSolicitudA2AEnCurso(db, {
        a2aTaskId,
        estado: TASK_STATE_WORKING,
        updatedAt: now(),
      });

      if (!puestoEnCurso) {
        logTurnEvent(casoId, "a2a-turno-entrante-descartado", { a2aTaskId }, logDeps);
        return;
      }

      logTurnEvent(casoId, "a2a-turno-entrante-iniciado", { a2aTaskId }, logDeps);

      const inicio = now();
      const prompt = buildSolicitudA2APrompt(texto);
      const knowledge = createKnowledge(casoId);

      const result = await handleTurn(casoId, prompt, {
        memory,
        hooks,
        candidateAgents: agents,
        ...(logDeps ? { logDeps } : {}),
        mcpServers: knowledge.mcpServers,
        knowledgeFeedback: knowledge.feedback,
      });

      const completado = actualizarSolicitudA2AEnCurso(db, {
        a2aTaskId,
        estado: TASK_STATE_COMPLETED,
        resultado: result.responseText,
        updatedAt: now(),
      });

      if (!completado) {
        logTurnEvent(casoId, "a2a-turno-entrante-descartado", { a2aTaskId }, logDeps);
        return;
      }

      logTurnEvent(
        casoId,
        "a2a-turno-entrante-completado",
        {
          a2aTaskId,
          resultadoChars: result.responseText.length,
          duracionMs: new Date(now()).getTime() - new Date(inicio).getTime(),
        },
        logDeps,
      );
    } catch (error) {
      try {
        actualizarSolicitudA2AEnCurso(db, {
          a2aTaskId,
          estado: TASK_STATE_FAILED,
          updatedAt: now(),
        });
        logTurnEvent(
          casoId,
          "a2a-turno-entrante-fallido",
          { a2aTaskId, message: error instanceof Error ? error.message : String(error) },
          logDeps,
        );
      } catch {
        // Segundo catch (design.md §5.2 paso 5): si el `UPDATE` de cierre
        // también falla, no puede haber un `unhandledRejection` en una
        // promesa que nadie awaitea.
      }
    }
  }

  const onSolicitudA2A = async (input: SolicitudA2AEntrada): Promise<SolicitudA2AAceptada> => {
    const timestamp = now();
    const mensajeRecibido =
      input.texto.length > MAX_SOLICITUD_A2A_CHARS
        ? input.texto.slice(0, MAX_SOLICITUD_A2A_CHARS)
        : input.texto;

    logTurnEvent(
      input.a2aTaskId,
      "a2a-solicitud-recibida",
      { chars: input.texto.length, origenTransporte: input.origenTransporte },
      logDeps,
    );

    // Paso (a) del design.md §5.2: sin cupo ⇒ rama corta. Sin caso, sin
    // turno, sin modelo. La fila SÍ se crea (trazabilidad del rechazo).
    if (!input.hayCupo) {
      insertSolicitudA2AEntrante(db, {
        id: newId(),
        a2aTaskId: input.a2aTaskId,
        origenTransporte: input.origenTransporte,
        mensajeRecibido,
        estado: TASK_STATE_REJECTED,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      logTurnEvent(
        input.a2aTaskId,
        "a2a-solicitud-rechazada-tope",
        { a2aTaskId: input.a2aTaskId },
        logDeps,
      );

      return { estado: TASK_STATE_REJECTED, contextId: input.a2aTaskId, updatedAt: timestamp };
    }

    // Paso (b): PROPAGA si falla — sin caso no hay nada que correlacionar.
    const casoId = newId();
    createCaso(db, {
      id: casoId,
      tipo: CASO_TIPO_A2A_ENTRANTE,
      estado: CASO_ESTADO_ACTIVO,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Paso (c): PROPAGA si falla — sin fila no hay trazabilidad. Todo lo de
    // arriba es síncrono, sin ningún `await` previo: la fila existe ANTES de
    // que la promesa de `onSolicitudA2A` resuelva (spec, requirement "Ciclo
    // de vida completo").
    insertSolicitudA2AEntrante(db, {
      id: newId(),
      a2aTaskId: input.a2aTaskId,
      casoId,
      origenTransporte: input.origenTransporte,
      mensajeRecibido,
      estado: TASK_STATE_SUBMITTED,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Paso (d): invocado, NO awaiteado — `ejecutarTurno` nunca rechaza.
    const turno = ejecutarTurno(casoId, input.a2aTaskId, mensajeRecibido);

    // Paso (e).
    return { estado: TASK_STATE_SUBMITTED, contextId: casoId, updatedAt: timestamp, turno };
  };

  const onConsultarTarea = (a2aTaskId: string): SolicitudA2AEntranteVista | undefined => {
    const row = getSolicitudA2AEntrantePorTaskId(db, a2aTaskId);
    return row ? filaAVista(row) : undefined;
  };

  const onCancelarTarea = (a2aTaskId: string): CancelacionA2AResultado => {
    const resultado = cancelarSolicitudA2AEntrante(db, { a2aTaskId, updatedAt: now() });
    logTurnEvent(a2aTaskId, "a2a-cancelacion-recibida", { resultado }, logDeps);

    if (resultado === "no-encontrada") {
      return { resultado };
    }

    const row = getSolicitudA2AEntrantePorTaskId(db, a2aTaskId);
    if (!row) {
      // Defensivo: la fila que `cancelarSolicitudA2AEntrante` acaba de leer
      // (y, en tres de las cuatro ramas, actualizar) desapareció entre esa
      // llamada y este `SELECT`. No debería poder pasar en este proceso.
      return { resultado: "no-encontrada" };
    }

    return { resultado, vista: filaAVista(row) };
  };

  return { onSolicitudA2A, onConsultarTarea, onCancelarTarea };
}
