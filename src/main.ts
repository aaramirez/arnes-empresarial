/**
 * Composition root del proceso — Integración end-to-end (Hito 1, tarea 15).
 *
 * `package.json`'s `dev` script points here (`tsx src/main.ts`). Wires:
 * Secuencia de arranque (tarea 13, `bootstrapHarness`) → Adaptador de
 * Memoria real (`src/adapters/memory/`) → Manejador de Turno
 * (`src/core/turn-selector/handle-turn.ts`, este mismo tarea) → Adaptador
 * TUI (tarea 14, `startTui`) — el escenario de ejecución 1 completo del
 * arc42, prompt entrante por I1 hasta respuesta renderizada.
 *
 * Hito 3 (tarea 22, ADR 5) agrega una SEGUNDA fuente de turnos: el
 * Adaptador de Webhooks (`src/adapters/webhooks/`), que recibe eventos de
 * actividad de GitHub y los enruta a `build-on-activity.ts` en vez de
 * `build-on-submit.ts`. Las dos fuentes comparten `db`/`memory`/`hooks`/
 * `agents` (el arnés es uno solo) pero cada una arma su propio
 * `KnowledgeAdapter` por `casoId` — ver `startHarness()`'s `createKnowledge`
 * más abajo.
 *
 * Ubicación — `src/main.ts`, no dentro de `src/adapters/tui/` ni de
 * `src/adapters/memory/` (Reviewer finding, CRITICAL, post-primera versión
 * de este archivo): AGENTS.md's regla no negociable dice literalmente
 * "Ningún adaptador se comunica directamente con otro adaptador — todo pasa
 * por el núcleo". Este archivo importa directo tanto del adaptador TUI
 * (`startTui`) como del adaptador de Memoria (`openDatabase`,
 * `createCaso`, ...) — si viviera dentro de `src/adapters/tui/`, eso sería
 * literalmente el adaptador TUI hablándole directo al adaptador de
 * Memoria, exactamente lo que la regla prohíbe. Al nivel de `src/`, al
 * mismo nivel que `core/` y `adapters/` (por encima de ambos), es
 * arquitectura hexagonal estándar: el composition root de la aplicación
 * SÍ conoce y conecta adaptadores concretos entre sí — es literalmente su
 * trabajo. La regla no negociable es sobre adaptadores hablándose ENTRE SÍ
 * desde adentro de su propia carpeta, no sobre la capa que ensambla todo
 * desde arriba.
 *
 * CRITICAL ORDERING CONSTRAINT (see `./core/config/env.ts`'s own module
 * doc): the `env.ts` import below MUST stay the very first import of this
 * file, before anything else — even before `node:crypto` — because
 * `handle-turn.js` transitively imports `invoke-model.js`, which imports
 * `@anthropic-ai/claude-agent-sdk` directly. The SDK reads
 * `process.env.ANTHROPIC_API_KEY` as soon as it is evaluated; loading it
 * ahead of `env.ts`'s `dotenv` side effect would make `.env`-provided keys
 * invisible to it. `import type` lines elsewhere in this file are erased at
 * compile time (`isolatedModules`) and carry no runtime side effect, so only
 * this ordering — value imports — matters.
 *
 * Design decision — startup errors caught and reported, not left to crash
 * raw (Reviewer finding, WARNING): `bootstrapHarness()`, `openDatabase()`,
 * and `createCaso()` are the three steps that run before any `caso` exists
 * — before `logTurnEvent` (tarea 12) even has a `casoId` to key on, same
 * scoping note `turn-logger.ts`'s own module doc already makes about that
 * utility only applying once a turn is in flight. Wrapping just those three
 * in one `try`/`catch` that prints a single readable message (same style as
 * `HarnessBootstrapError`'s own message: "No se pudo inicializar el arnés:
 * ...") and exits with a non-zero code replaces an unreadable raw stack
 * trace with an actionable one-line diagnosis, without inventing a
 * sophisticated startup error policy this hito does not ask for. `startTui`
 * itself stays outside the `try` — once it runs, `onSubmit`/`handleTurn`
 * already has its own per-turn failure path (`TurnFailedError`, rendered
 * inline by `App.tsx`, not a process crash). El wiring del servidor de
 * webhooks (Hito 3) sigue el mismo criterio con su PROPIO `try`/`catch`, más
 * abajo: no comparte el de `startHarness()`.
 */
import "./core/config/env.js";

import { randomUUID } from "node:crypto";
import { bootstrapHarness, HarnessBootstrapError } from "./core/startup/bootstrap.js";
import { CASO_ESTADO_ACTIVO, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent } from "./core/logging/turn-logger.js";
import { openDatabase } from "./adapters/memory/db.js";
import {
  createCaso,
  createSesionAgente,
  getCasoById,
  getLatestSesionAgente,
  updateCaso,
  type Caso,
} from "./adapters/memory/repository.js";
import { startTui } from "./adapters/tui/start-tui.js";
import { createKnowledgeAdapter, type KnowledgeAdapter } from "./adapters/knowledge/index.js";
import { buildOnSubmit } from "./build-on-submit.js";
import { buildOnActivity } from "./build-on-activity.js";
import { createBoardAdapter, resolveBotLogin } from "./adapters/board/index.js";
import { resolveBoardConfig } from "./adapters/board/config.js";
import { startWebhookServer, type WebhookAdapter } from "./adapters/webhooks/index.js";
import { WEBHOOK_LOG_CORRELATION_ID } from "./adapters/webhooks/config.js";
import { createKeyedQueue } from "./core/concurrency/keyed-queue.js";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StartupResult {
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly memory: MemoryPort;
  readonly caso: Caso;
  readonly db: ReturnType<typeof openDatabase>;
  /**
   * Fábrica del Adaptador de Conocimiento POR `casoId` (Hito 3, tarea 22,
   * ADR 5) — reemplaza la instancia `knowledge` única de v1.1.0. Con dos
   * fuentes de turnos (TUI + webhooks) una instancia compartida cruzaría el
   * `CitedNodesRecorder` de un turno de la TUI con el de un turno de webhook
   * concurrente (R1). La TUI llama esta fábrica UNA sola vez, con
   * `caso.id`, para sostener una única instancia durante toda su corrida
   * (ver el call site de `buildOnSubmit` más abajo); el wiring de webhooks
   * llama la misma fábrica una vez POR turno, con el `casoId` que cada uno
   * resuelve.
   */
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
}

/**
 * Runs the three startup steps that have no `caso` (and so no
 * `logTurnEvent` correlation) to report against yet — see the module doc's
 * "startup errors caught and reported" note. Any failure here is reported
 * to stderr as a single readable line and ends the process with a non-zero
 * exit code, instead of leaving a raw stack trace as the only diagnosis.
 */
function startHarness(): StartupResult {
  // 1. Secuencia de arranque (tarea 13): Registro de Agentes primero,
  //    Motor de Hooks después — orden ya fijado por `bootstrapHarness`, no
  //    reimplementado acá.
  const { agents, hooks } = bootstrapHarness();

  // 2. Adaptador de Memoria (I3) real: `data/harness.db`, relativa a la
  //    raíz del proyecto (`process.cwd()`). `openDatabase` crea el
  //    directorio padre si hace falta y aplica las migraciones.
  const db = openDatabase("data/harness.db");

  // `MemoryPort` (`handle-turn.ts`) es la unión de `MemoryContextPort`
  // (tarea 8) y `MemoryWritePort` (tarea 10) — un closure de una línea por
  // método sobre las funciones reales de `repository.ts`, sin duplicar
  // lógica, tal como esos módulos ya anticipaban en sus propios
  // comentarios.
  const memory: MemoryPort = {
    getCasoById: (casoId) => getCasoById(db, casoId),
    getLatestSesionAgente: (casoId, agentId) => getLatestSesionAgente(db, casoId, agentId),
    updateCaso: (casoId, update) => {
      updateCaso(db, casoId, update);
    },
    createSesionAgente: (input) => {
      createSesionAgente(db, input);
    },
  };

  // 3. `caso` inicial de esta corrida del proceso: nada lo crea todavía
  //    (el Ensamblador de Contexto, tarea 8, es explícitamente
  //    solo-lectura). Un único `caso` por corrida basta para el
  //    entregable de este hito (un segundo prompt en la misma sesión
  //    recupera el contexto del primero).
  const startedAt = new Date().toISOString();
  const caso = createCaso(db, {
    id: randomUUID(),
    tipo: "conversacion",
    estado: CASO_ESTADO_ACTIVO,
    createdAt: startedAt,
    updatedAt: startedAt,
  });

  // 4. Adaptador de Conocimiento (I2, Hito 2 tarea 7): Hito 3 (tarea 22,
  //    ADR 5) lo convierte de una instancia única por corrida a una FÁBRICA
  //    por `casoId` — ver el comentario de `StartupResult.createKnowledge`
  //    arriba para el motivo. `createKnowledgeAdapter` no tiene efecto
  //    global (verificado en design.md §6.3, leyendo
  //    `src/adapters/knowledge/index.ts` completo): no hay singleton de
  //    módulo, no hay puerto ni subproceso — instanciar una vez por caso es
  //    seguro y barato.
  const createKnowledge = (casoId: string): KnowledgeAdapter =>
    createKnowledgeAdapter({
      casoId,
      logEvent: (event, fields) => logTurnEvent(casoId, event, fields),
    });

  return { agents, hooks, memory, caso, db, createKnowledge };
}

let startup: StartupResult;
try {
  startup = startHarness();
} catch (error) {
  const reason =
    error instanceof HarnessBootstrapError ? error.message : `No se pudo inicializar el arnés: ${toErrorMessage(error)}`;
  console.error(reason);
  process.exit(1);
}

const { agents, hooks, memory, caso, db, createKnowledge } = startup;

// 4. `onSubmit` (I1, `SubmitPromptHandler`) cierra sobre `caso.id`/`memory`/
//    `hooks`/`agents` y delega la secuencia completa del turno al
//    Manejador de Turno (`handle-turn.ts`) — resolver agente, ensamblar
//    contexto (I3 lectura), invocar el modelo (I5), cerrar el turno
//    (I3 escritura). Construcción extraída a `build-on-submit.ts` (mismo
//    nivel que este archivo, no dentro de ningún adaptador — ver el module
//    doc de ese archivo, que también documenta por qué `resolveTurn` se
//    llama acá TAMBIÉN, redundantemente, antes de `handleTurn`) para que
//    esta pieza de wiring tenga su propio archivo de test — este mismo
//    archivo no se puede importar desde un test sin disparar
//    `bootstrapHarness()`/`openDatabase()`/`createCaso()` reales.
//    `createKnowledge(caso.id)` (Hito 3, tarea 22) se llama UNA sola vez
//    acá: la TUI sostiene una única instancia de `KnowledgeAdapter` para
//    toda su corrida, tal como antes — solo que ahora es propia de la TUI,
//    no compartida con los turnos de webhook armados a continuación.
const onSubmit = buildOnSubmit(caso.id, memory, hooks, agents, undefined, createKnowledge(caso.id));

// 5. Segunda fuente de turnos (Hito 3, ADR 5): Adaptador de Tablero
//    (tarea 16), `onActivity` (wiring de `build-on-activity.ts`, tarea 21)
//    y el listener de webhooks (tarea 12). Va DESPUÉS de armar `onSubmit`
//    pero ANTES de montar la TUI, con su PROPIO `try`/`catch` — no el de
//    `startHarness()`, que ya terminó y es síncrono. Un rechazo de
//    `startWebhookServer` (p. ej. `EADDRINUSE`) se loguea como
//    `webhook-arranque-fallido` (correlación `WEBHOOK_LOG_CORRELATION_ID`,
//    ya usada por el propio adaptador para sus eventos
//    `webhook-escuchando`/`webhook-deshabilitado`) y el proceso sigue con
//    `webhook = undefined`: que el puerto esté ocupado no puede impedir que
//    el empleado use la TUI. `undefined` también es el resultado normal
//    (sin excepción) cuando los webhooks están deshabilitados por config —
//    ese caso no pasa por este `catch`, lo maneja `startWebhookServer`
//    internamente.
//
// `resolveBotLogin` (tarea 24, verificación manual end-to-end) resuelve el
// login del bot UNA vez acá, antes de escuchar — no por evento — y se lo
// pasa a `startWebhookServer`, que lo reenvía hasta `mapGithubEvent`: el
// filtro anti-loop que evita que el propio comentario de `publicarRevision`
// se reprocese como un turno nuevo (bug real: 2 vueltas encadenadas
// capturadas en logs antes de que un humano cortara el proceso).
const boardConfig = resolveBoardConfig();

const board = createBoardAdapter({
  config: boardConfig,
  logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
});

const onActivity = buildOnActivity({
  db,
  memory,
  hooks,
  agents,
  board,
  queue: createKeyedQueue(),
  createKnowledge,
});

const botLogin = await resolveBotLogin({
  config: boardConfig,
  logEvent: (event, fields) => logTurnEvent(WEBHOOK_LOG_CORRELATION_ID, event, fields),
});

let webhook: WebhookAdapter | undefined;
try {
  webhook = await startWebhookServer({
    onEvent: onActivity,
    logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
    ...(botLogin !== undefined ? { botLogin } : {}),
  });
} catch (error) {
  logTurnEvent(WEBHOOK_LOG_CORRELATION_ID, "webhook-arranque-fallido", { message: toErrorMessage(error) });
  webhook = undefined;
}

// 6. Monta la TUI (I1) con `onSubmit` como su handler del Núcleo, espera a
//    que se desmonte (p. ej. Ctrl+C — Ink lo maneja solo, `exitOnCtrlC` por
//    defecto) y recién ahí cierra el servidor de webhooks (si arrancó) y el
//    handle de SQLite abierto en el paso 2. Un cierre prolijo del proceso,
//    no una salida abrupta con el archivo de la base de datos todavía
//    abierto. `startTui(onSubmit)` en sí va DENTRO del `try` (Reviewer
//    finding, WARNING, post-primera versión de este fix) — no solo el
//    `await` de `waitUntilExit()`: `startTui`/`renderTui` puede tirar
//    sincrónicamente si falla el mount de Ink (ver `start-tui.tsx`), y si
//    eso pasara antes de que `tui` se asignara, el `finally` de abajo
//    nunca correría.
try {
  const tui = startTui(onSubmit);
  await tui.waitUntilExit();
} finally {
  // `finally`, no solo el camino feliz de Ctrl+C: si `App.tsx` tira un error
  // de render, el error boundary de Ink (`node_modules/ink/build/ink.js`,
  // `unmount(error)`) hace que `waitUntilExit()` rechace en vez de resolver
  // — con top-level `await`, ese rechazo aborta la evaluación del módulo, así
  // que este cierre tiene que correr acá para no perderse ese camino de
  // salida también.
  //
  // ADR 10: primero se deja de aceptar y se drenan los turnos de webhook en
  // vuelo (`webhook.close()`), DESPUÉS se cierra el handle de SQLite. Al
  // revés, un turno de webhook a mitad de camino escribiría contra una base
  // ya cerrada.
  if (webhook !== undefined) {
    try {
      await webhook.close();
    } catch (error) {
      // Red de seguridad sobre un método que ya promete no rechazar
      // (`WebhookAdapter.close()`, `src/adapters/webhooks/index.ts`): si
      // algún día lo violara, no puede impedir que `db.close()` corra.
      console.error(`No se pudo cerrar el servidor de webhooks: ${toErrorMessage(error)}`);
    }
  }
  try {
    db.close();
  } catch (error) {
    // El proceso ya está terminando — un fallo acá no debe convertirse en un
    // crash con código de salida confuso, ni tapar el error original de
    // `waitUntilExit` si lo hubiera; solo se reporta.
    console.error(`No se pudo cerrar la base de datos: ${toErrorMessage(error)}`);
  }
}
