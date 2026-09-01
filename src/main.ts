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
 * inline by `App.tsx`, not a process crash).
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StartupResult {
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly memory: MemoryPort;
  readonly caso: Caso;
  readonly db: ReturnType<typeof openDatabase>;
  readonly knowledge: KnowledgeAdapter;
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

  // 4. Adaptador de Conocimiento (I2, Hito 2 tarea 7): una única vez por
  //    corrida, después de `caso` porque necesita su `id` para correlacionar
  //    los eventos de log (`logTurnEvent`) y para el `CitedNodesRecorder`
  //    compartido entre la tool MCP y `feedback` (design.md §6). Va dentro
  //    de este mismo `try`: si `resolveGraphifyConfig` fallara, es un error
  //    de arranque tan legible como los tres pasos anteriores, no algo que
  //    crashee sin contexto.
  const knowledge = createKnowledgeAdapter({
    casoId: caso.id,
    logEvent: (event, fields) => logTurnEvent(caso.id, event, fields),
  });

  return { agents, hooks, memory, caso, db, knowledge };
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

const { agents, hooks, memory, caso, db, knowledge } = startup;

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
const onSubmit = buildOnSubmit(caso.id, memory, hooks, agents, undefined, knowledge);

// 5. Monta la TUI (I1) con `onSubmit` como su handler del Núcleo, espera a
//    que se desmonte (p. ej. Ctrl+C — Ink lo maneja solo, `exitOnCtrlC` por
//    defecto) y recién ahí cierra el handle de SQLite abierto en el paso 2.
//    Un cierre prolijo del proceso, no una salida abrupta con el archivo de
//    la base de datos todavía abierto. `startTui(onSubmit)` en sí va DENTRO
//    del `try` (Reviewer finding, WARNING, post-primera versión de este
//    fix) — no solo el `await` de `waitUntilExit()`: `startTui`/`renderTui`
//    puede tirar sincrónicamente si falla el mount de Ink (ver
//    `start-tui.tsx`), y si eso pasara antes de que `tui` se asignara,
//    `db.close()` nunca correría.
try {
  const tui = startTui(onSubmit);
  await tui.waitUntilExit();
} finally {
  // `finally`, no solo el camino feliz de Ctrl+C: si `App.tsx` tira un error
  // de render, el error boundary de Ink (`node_modules/ink/build/ink.js`,
  // `unmount(error)`) hace que `waitUntilExit()` rechace en vez de resolver
  // — con top-level `await`, ese rechazo aborta la evaluación del módulo, así
  // que `db.close()` tiene que correr acá para no perderse ese camino de
  // salida también.
  try {
    db.close();
  } catch (error) {
    // El proceso ya está terminando — un fallo acá no debe convertirse en un
    // crash con código de salida confuso, ni tapar el error original de
    // `waitUntilExit` si lo hubiera; solo se reporta.
    console.error(`No se pudo cerrar la base de datos: ${toErrorMessage(error)}`);
  }
}
