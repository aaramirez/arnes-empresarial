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
import { resolveVentasConfig, type VentasConfig } from "./core/ventas/ventas-config.js";
import { createNotificadorAdapter } from "./adapters/notificaciones/index.js";
import { createA2AAdapter } from "./adapters/a2a/index.js";
import { isA2ASalienteEnabled } from "./adapters/a2a/config.js";
import { resolveWebConfig, WEB_LOG_CORRELATION_ID } from "./adapters/web/config.js";
import { buildOnVenta, createConsultaRiesgoCredito } from "./build-on-venta.js";
import { buildOnSoporte } from "./build-on-soporte.js";
import { startWebServer, type WebAdapter } from "./adapters/web/index.js";
import { resolveAuthConfig, type AuthConfig } from "./core/auth/auth-config.js";
import { hashPassword, verificarPassword } from "./adapters/crypto/password.js";
import { buildOnComandoEmpleado } from "./build-on-comando-empleado.js";
import { createGitAdapter } from "./adapters/git/index.js";
import { resolveGitConfig, resolveWorktreeConfig } from "./adapters/git/config.js";

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
  /**
   * Configuración de reglas de negocio de ventas (Hito 4, tarea 2,
   * `resolveVentasConfig`), validada dentro de `startHarness()`'s propio
   * `try` — un error acá aborta el arranque ANTES de que exista
   * `startWebServer` (Hito 4, tarea 28). Propagada fuera de `startHarness()`
   * para que el wiring de la tercera fuente (más abajo) la use.
   */
  readonly ventasConfig: VentasConfig;
  /**
   * Configuración de autenticación de empleado (`tui-canal-empleado`, ADR
   * 31, design.md §8 punto 1), validada dentro de `startHarness()`'s propio
   * `try` — mismo criterio que `ventasConfig`: un `SESION_TTL_MINUTOS`
   * inválido aborta el arranque ACÁ, antes de que exista ningún servidor.
   * Propagada fuera de `startHarness()` para que `buildOnComandoEmpleado`
   * (bloque 5c, más abajo) la use.
   */
  readonly authConfig: AuthConfig;
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

  // 2b. Configuración de reglas de negocio de ventas (Hito 4, tarea 2,
  //     ADR 17b): TODOS los errores juntos, no uno por uno. Un valor
  //     inválido aborta el arranque ACÁ, dentro de este `try` — antes de que
  //     exista `startWebServer` más abajo (Hito 4, tarea 28): la validación
  //     de config de negocio es un paso de arranque, no un fallback en
  //     runtime.
  const ventasConfigResult = resolveVentasConfig(process.env);
  if (!ventasConfigResult.ok) {
    throw new HarnessBootstrapError(
      `Configuración de ventas inválida:\n  - ${ventasConfigResult.errores.join("\n  - ")}`,
    );
  }
  const ventasConfig = ventasConfigResult.config;

  // 2c. Configuración de autenticación de empleado (`tui-canal-empleado`,
  //     ADR 31, design.md §8 punto 1): MISMA clase "aborta" que `ventasConfig`
  //     de arriba — un `SESION_TTL_MINUTOS` mal escrito es una sesión que
  //     dura otra cosa que la que el operador cree, y eso se detecta acá, no
  //     en runtime.
  const authConfigResult = resolveAuthConfig(process.env);
  if (!authConfigResult.ok) {
    throw new HarnessBootstrapError(
      `Configuración de autenticación inválida:\n  - ${authConfigResult.errores.join("\n  - ")}`,
    );
  }
  const authConfig = authConfigResult.config;

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

  return { agents, hooks, memory, caso, db, createKnowledge, ventasConfig, authConfig };
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

const { agents, hooks, memory, caso, db, createKnowledge, ventasConfig, authConfig } = startup;

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

// 5b. Tercera fuente de turnos (Hito 4, tarea 28, design.md §6.5): el
//     Adaptador Web (tarea 18), opt-in por `WEB_PORT` (`resolveWebConfig`,
//     `isWebEnabled`). Comparte `db`/`memory`/`hooks`/`agents`/`createKnowledge`
//     con la TUI y los webhooks (la MISMA fábrica por `casoId` — R1 de
//     Hito 3 no reintroducido) y agrega su propio `notifier`
//     (`createNotificadorAdapter`, tarea 21) para el camino de ventas
//     (`buildOnVenta`, tarea 26). `buildOnSoporte` (tarea 27) arma el único
//     handler de este hito que invoca al modelo. Mismo criterio que el
//     wiring de webhooks de arriba: PROPIO `try`/`catch`, un rechazo de
//     `startWebServer` (p. ej. `EADDRINUSE`) se loguea como
//     `web-arranque-fallido` y el proceso sigue con `web = undefined` — un
//     puerto ocupado no puede impedir que el empleado use la TUI ni que los
//     webhooks sigan andando.
const notifier = createNotificadorAdapter({
  logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
});

const webConfig = resolveWebConfig();

// 5b-bis. Cliente A2A saliente (Hito 6, tareas 17 y 21, ADR 82, design.md
//         §5.7.4 tensión 1). OPT-IN: sin HARNESS_A2A_SALIENTE=on no se
//         construye NADA — ni adaptador, ni store, ni puerto — y los DOS
//         consumidores se comportan exactamente como en v2.1.0 (cero filas
//         en delegaciones_a2a, cero fetch salientes). `HARNESS_A2A_SALIENTE`
//         se lee UNA SOLA VEZ acá y `createA2AAdapter` se instancia UNA SOLA
//         VEZ, hoisteado antes de `buildOnVenta` (línea 335 más abajo) y de
//         `buildOnComandoEmpleado` (línea 377 más abajo) porque los DOS lo
//         necesitan: ventas (`riesgoCredito`, ya cableado en Hito 6) y el
//         comando privilegiado `/consultar-kpi` de la TUI (`clienteA2A`,
//         Hito 6, tarea 21, ADR 85). Se rechaza deliberadamente la salida
//         fácil de leer el interruptor DENTRO de
//         `build-on-comando-empleado.ts` — ese archivo ya hace algo
//         parecido con `resolveGitConfig()` para `aplicarPatch`, pero `git`
//         no tiene interruptor y A2A sí: duplicar la lectura de
//         `HARNESS_A2A_SALIENTE` pondría el rollback a `v2.1.0` en dos
//         lugares distintos en vez de uno solo, acá.
const clienteA2A = isA2ASalienteEnabled()
  ? createA2AAdapter({
      logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
    })
  : undefined;

const riesgoCredito =
  clienteA2A !== undefined
    ? createConsultaRiesgoCredito({
        db,
        cliente: clienteA2A,
        logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
      })
    : undefined;

const ventaHandlers = buildOnVenta({
  db,
  notifier,
  ventasConfig,
  baseUrlPublica: webConfig.publicUrl,
  ...(riesgoCredito !== undefined ? { riesgoCredito } : {}), // exactOptionalPropertyTypes
});

// `onSoporte` (Hito 4, tarea 27) se arma UNA sola vez acá y se COMPARTE
// (design.md §8 punto 3): la misma constante alimenta a `startWebServer`
// (más abajo, para `POST /soporte`) y al bloque 5c (para `/soporte` de la
// TUI) — `buildOnSoporte` no se toca y `createKnowledge` no se duplica.
const onSoporte = buildOnSoporte({ db, memory, hooks, agents, createKnowledge });

let web: WebAdapter | undefined;
try {
  web = await startWebServer({
    ...ventaHandlers,
    onSoporte,
    logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
  });
} catch (error) {
  logTurnEvent(WEB_LOG_CORRELATION_ID, "web-arranque-fallido", { message: toErrorMessage(error) });
  web = undefined;
}

// 5c. Dispatcher de comandos de empleado (Hito 5, tarea 14, design.md §8
//     punto 4): envuelve `onSubmit` (camino conversacional, intacto) y
//     reusa el MISMO `onSoporte` de arriba. Único import nuevo de un
//     adaptador en `main.ts` — `verificarPassword`, de
//     `adapters/crypto/password.ts` (ADR 30): el núcleo no lo importa, el
//     composition root los une, igual que ya hace con `randomUUID` como
//     `newId` en `buildOnVenta`.
//
// `dummyPasswordHash` (fix de review sobre `resolverLogin`, hallazgo de
// duplicación/drift): se genera acá con `hashPassword(...)` — la MISMA
// función que produce los hashes reales de `credenciales_empleado` — para
// que la mitigación de timing attack de `resolverLogin` SIEMPRE use el
// costo scrypt vigente, sin importar qué tan viejo sea un literal
// hardcodeado. La contraseña de entrada es arbitraria: este hash nunca se
// compara contra ninguna contraseña real, solo fuerza el mismo costo
// computacional.
const dummyPasswordHash = hashPassword("dummy-timing-mitigation");
const onComandoEmpleado = buildOnComandoEmpleado({
  onSubmit,
  onSoporte,
  db,
  ventasConfig,
  authConfig,
  verificarPassword,
  dummyPasswordHash,
  hooks,
  ...(clienteA2A !== undefined ? { clienteA2A } : {}), // exactOptionalPropertyTypes
});

// 5d. Barrido de worktrees huérfanos al arranque (Hito 5.1, tarea 34, ADR 57
//     pto 7, design.md §7.3 bloque 5d). NO BLOQUEANTE (`void ... .catch(...)`,
//     nunca `await`): `BarridoWorktreePort.barrerHuerfanos`
//     (`src/adapters/git/barrido.ts`) nunca rechaza por contrato
//     (`worktree-contract.ts`) — el `.catch()` de acá es una red de seguridad
//     sobre esa promesa, mismo criterio que el `try`/`catch` de
//     `webhook.close()` más abajo sobre un método que también promete no
//     rechazar nunca: si algún día lo violara, no puede demorar el arranque
//     de la TUI. Sin `casoId` real (corre antes de que exista ningún turno):
//     usa la correlación fija `WORKTREE_LOG_CORRELATION_ID`, mismo patrón que
//     `WEBHOOK_LOG_CORRELATION_ID`/`COMANDO_LOG_CORRELATION_ID` de arriba.
//     `gitAdapter` se construye ACÁ, propio de este bloque: ni
//     `buildOnComandoEmpleado` (tarea 32) ni `buildOnActivity` (tarea 33)
//     exponen la instancia que arman internamente como default de
//     `aplicarPatch`/`worktree` — no hay una instancia compartida en este
//     archivo que reusar.
const WORKTREE_LOG_CORRELATION_ID = "worktree";
const worktreeConfig = resolveWorktreeConfig();
const gitAdapter = createGitAdapter({
  repoRoot: process.cwd(),
  logEvent: (event, fields) => logTurnEvent(WORKTREE_LOG_CORRELATION_ID, event, fields),
  config: { ...resolveGitConfig(), worktreeRoot: worktreeConfig.worktreeRoot },
});

void gitAdapter.barrido
  .barrerHuerfanos({ ttlMs: worktreeConfig.ttlMs, ahoraMs: Date.now() })
  .catch((error) =>
    logTurnEvent(WORKTREE_LOG_CORRELATION_ID, "worktree-barrido-fallido", {
      message: toErrorMessage(error),
    }),
  );

// 6. Monta la TUI (I1) con `onComandoEmpleado` como su handler del Núcleo, espera a
//    que se desmonte (p. ej. Ctrl+C — Ink lo maneja solo, `exitOnCtrlC` por
//    defecto) y recién ahí cierra el servidor web (si arrancó), el servidor
//    de webhooks (si arrancó) y el handle de SQLite abierto en el paso 2. Un
//    cierre prolijo del proceso, no una salida abrupta con el archivo de la
//    base de datos todavía abierto. `startTui(onComandoEmpleado)` en sí va
//    DENTRO del `try` (Reviewer finding, WARNING, post-primera versión de
//    este fix) — no solo el `await` de `waitUntilExit()`: `startTui`/
//    `renderTui` puede tirar sincrónicamente si falla el mount de Ink (ver
//    `start-tui.tsx`), y si eso pasara antes de que `tui` se asignara, el
//    `finally` de abajo nunca correría. `startTui` sigue recibiendo un
//    `SubmitPromptHandler` — I1 no cambia (design.md §8 punto 5): rollback
//    en caliente es volver a `startTui(onSubmit)`, una sola línea.
try {
  const tui = startTui(onComandoEmpleado);
  await tui.waitUntilExit();
} finally {
  // `finally`, no solo el camino feliz de Ctrl+C: si `App.tsx` tira un error
  // de render, el error boundary de Ink (`node_modules/ink/build/ink.js`,
  // `unmount(error)`) hace que `waitUntilExit()` rechace en vez de resolver
  // — con top-level `await`, ese rechazo aborta la evaluación del módulo, así
  // que este cierre tiene que correr acá para no perderse ese camino de
  // salida también.
  //
  // Hito 4, tarea 28: `web.close()` corre PRIMERO, antes del cierre de
  // webhooks y de `db.close()` — mismo criterio del ADR 10 de abajo, ahora
  // con una tercera fuente: dejar de aceptar y drenar los turnos web en
  // vuelo (`WebAdapter.close()`, ADR 14 punto 4) antes de tocar cualquier
  // otro recurso compartido.
  if (web !== undefined) {
    try {
      await web.close();
    } catch (error) {
      console.error(`No se pudo cerrar el servidor web: ${toErrorMessage(error)}`);
    }
  }
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
