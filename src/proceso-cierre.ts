/**
 * Ciclo de vida del PROCESO como contrato observable (`modo-headless-cierre-limpio`,
 * ADR 248/249/250, RD-121). Módulo NUEVO, nivel composition root — mismo nivel
 * que `main.ts`, `empleados.ts` y los `build-on-*.ts` (razón: que esta pieza de
 * wiring tenga su propio archivo de test, como ya explica `main.ts:275-280`
 * para `build-on-submit.ts`).
 *
 * Toda dependencia sobre el `process` real (escuchar señales, loguear, salir,
 * armar/desarmar un timer, leer el entorno) está INYECTADA vía `ProcesoCierreDeps`,
 * con un default real en `DEPS_POR_DEFECTO` — es el único lugar del módulo que
 * toca el `process` global. Ningún test del suite necesita registrar un
 * listener real ni invocar `process.exit` real (R18, R20): mismo criterio que
 * `CreateWebServerFn` (`web/server.ts:902-916`) y `LogTurnEventDeps`
 * (`turn-logger.ts:194-197`).
 *
 * Esta primera capa (tarea 2.2) cubre solo constantes, tipos y los dos
 * resolvers de lectura de entorno (`esModoHeadless`, `resolvePresupuestoCierreMs`).
 * `manejarErrorNoCapturado`, `esperarSenalDeCierre` y `finalizarCierreHeadless`
 * llegan en tareas posteriores (2.5, 2.7) — ★ importar este módulo NO registra
 * ningún listener ni sale del proceso: eso solo ocurre cuando alguien invoca
 * `esperarSenalDeCierre()`.
 */
import { logTurnEvent } from "./core/logging/turn-logger.js";

/** Id de correlación de los eventos de ciclo de vida del proceso, molde de `WEBHOOK_LOG_CORRELATION_ID` / `WEB_LOG_CORRELATION_ID` / `A2A_SERVER_LOG_CORRELATION_ID`. */
export const PROCESO_LOG_CORRELATION_ID = "proceso";

/**
 * Presupuesto por defecto del apagado headless completo, en milisegundos
 * (RD-121, design §5.3/§6.2): estrictamente mayor que el peor caso conocido
 * de un turno con `consultar_kpi` (≈55 500 ms, `consulta-kpi-a2a-chat/design.md`
 * §9) más margen. Es un TECHO, no una espera — sin turnos en vuelo el cierre
 * no consume nada de esta ventana (§5.2).
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 70_000;

/**
 * Periodo del ANCLA del event loop (H-1, design §0.7b): un `setInterval`
 * no-op que mantiene vivo el proceso headless mientras espera la señal.
 *
 * ★ POR QUÉ existe: un handler de señal NO ref'a el event loop en Node
 * (medido: `process.on("SIGTERM", …); await new Promise(() => {})` sale con
 * código 13). Sin un handle ref'd propio, un proceso headless sin ningún
 * listener de red -- o con el único fallado al enlazar -- moría solo a los
 * ~0,8 s, sin una línea de log. El ancla se arma al registrar los handlers, se
 * desarma en la 1.ª señal (el watchdog del presupuesto, que también es ref'd,
 * toma la posta) y `finalizarCierreHeadless` la desarma otra vez como red.
 *
 * ★ COSTO declarado y aceptado: UN wake-up del proceso por minuto en reposo.
 * Un intervalo más corto no compra nada; uno más largo no ahorra nada medible.
 * ★ NUNCA se desreferencia el handle (ni el del ancla ni el del watchdog): un
 * ancla que no cuenta para el loop es exactamente el bug que este mecanismo
 * arregla.
 */
export const ANCLA_INTERVALO_MS = 60_000;

/** Las dos señales que disparan el cierre ordenado headless (ADR 249). */
export type SenalDeCierre = "SIGTERM" | "SIGINT";

/** Los dos eventos de fallo no capturado que ADR 250 trata igual: log + `exit(1)`. */
export type TipoErrorNoCapturado = "unhandledRejection" | "uncaughtException";

/**
 * Vista MÍNIMA de `process`, no `typeof process`. Inyectable por la misma
 * razón que `HttpServerLike` (`webhooks/server.ts:46-51`): que ningún test
 * del suite registre un listener real sobre el proceso de Vitest.
 */
export interface ProcesoLike {
  on(evento: SenalDeCierre | TipoErrorNoCapturado, handler: (arg?: unknown) => void): unknown;
  off(evento: SenalDeCierre | TipoErrorNoCapturado, handler: (arg?: unknown) => void): unknown;
}

/**
 * Dependencias inyectables de todo el módulo. Los defaults reales viven
 * SOLO en `DEPS_POR_DEFECTO`, más abajo — ningún resolver ni política
 * construye su propio default.
 */
export interface ProcesoCierreDeps {
  /** Default: el `process` real (vista mínima). */
  readonly proceso: ProcesoLike;
  /** Default: `logTurnEvent` real (escribe a `data/harness.log`). */
  readonly logEvent: typeof logTurnEvent;
  /** Default: `console.error`. */
  readonly escribirError: (linea: string) => void;
  /** ★ Default: `process.exit` — INYECTADO a propósito (R20): la política se verifica sin matar el runner de Vitest. */
  readonly salir: (codigo: number) => void;
  /** Default: `setTimeout`. */
  readonly armarTimer: (fn: () => void, ms: number) => unknown;
  /** Default: `clearTimeout`. */
  readonly desarmarTimer: (handle: unknown) => void;
  /**
   * ★ ENMIENDA H-1 (design §0.7b, §8). Arma el ANCLA ref'd que sostiene el
   * event loop mientras se espera la señal. Default: `setInterval` no-op cada
   * `ANCLA_INTERVALO_MS`. ADITIVA (los consumidores pasan `Partial<ProcesoCierreDeps>`)
   * y separada de `armarTimer` a propósito: son handles de vida distinta y el
   * test tiene que poder distinguirlos.
   */
  readonly armarAncla: () => unknown;
  /** ★ ENMIENDA H-1. Default: `clearInterval`. Recibe TAL CUAL el handle que devolvió `armarAncla`; con `undefined` es un no-op. */
  readonly desarmarAncla: (handle: unknown) => void;
  /** Default: `process.env`. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Defaults reales de `ProcesoCierreDeps`. Es el único punto del módulo que
 * referencia el `process` global — y solo como VALORES (funciones sin
 * invocar, el objeto `env` por referencia): nada de esto registra un
 * listener ni sale del proceso por sí solo con solo importar el módulo (R18).
 */
const DEPS_POR_DEFECTO: ProcesoCierreDeps = {
  proceso: process as unknown as ProcesoLike,
  logEvent: logTurnEvent,
  escribirError: (linea: string): void => {
    console.error(linea);
  },
  salir: (codigo: number): void => {
    process.exit(codigo);
  },
  armarTimer: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  desarmarTimer: (handle: unknown): void => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  armarAncla: (): unknown => setInterval(() => {}, ANCLA_INTERVALO_MS),
  desarmarAncla: (handle: unknown): void => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  env: process.env,
};

/**
 * `HARNESS_HEADLESS` estricto (H2, S-c): solo el valor exacto `"1"` activa
 * headless, sin recortar ni normalizar mayúsculas. Ausente, `""`, solo
 * espacios y `"0"` equivalen a TUI. CUALQUIER OTRO valor FALLA CERRADO: se
 * invoca dentro del `try` final de `main.ts` (ADR 249 pto 4), así que el
 * `Error` deja correr el `finally` (cierra los listeners de red ya abiertos)
 * y Node termina con código 1 — más seguro que caer en TUI silenciosamente
 * (que en un contenedor moriría con el error de Ink, lejos de la causa).
 */
export function esModoHeadless(env: NodeJS.ProcessEnv = DEPS_POR_DEFECTO.env): boolean {
  const raw = env.HARNESS_HEADLESS;
  if (raw === undefined || raw.trim() === "" || raw === "0") {
    return false;
  }
  if (raw === "1") {
    return true;
  }
  throw new Error(
    `Variable de entorno HARNESS_HEADLESS invalida: "${raw}". Valores admitidos: "0" (o ausente/en blanco, TUI) y "1" (headless).`,
  );
}

/** `Number.isFinite` excluye `NaN` e `Infinity` en un solo chequeo; `> 0` descarta cero y negativos. */
function esPresupuestoValido(parsed: number): boolean {
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * `HARNESS_SHUTDOWN_TIMEOUT_MS` (H8, RD-121). Ausente o en blanco ⇒
 * `DEFAULT_SHUTDOWN_TIMEOUT_MS`, SIN loguear (es el caso normal, no una
 * configuración rota). Un valor no numérico, `<= 0`, `NaN` o infinito
 * también cae al default, pero SÍ deja el evento `cierre-presupuesto-invalido`
 * con el valor recibido — nunca lanza.
 *
 * `resolvePositiveNumber` DUPLICADO A PROPÓSITO (mismo criterio que los otros
 * cinco `config.ts`, `webhooks/config.ts:32-38`), con un desvío deliberado
 * del molde: los adaptadores caen al default en silencio; acá el silencio es
 * caro (R24 — un valor mal escrito es un apagado con otra semántica que la
 * que el operador cree), así que se loguea (design §5.3).
 */
export function resolvePresupuestoCierreMs(deps: Partial<ProcesoCierreDeps> = {}): number {
  const env = deps.env ?? DEPS_POR_DEFECTO.env;
  const logEvent = deps.logEvent ?? DEPS_POR_DEFECTO.logEvent;
  const raw = env.HARNESS_SHUTDOWN_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (esPresupuestoValido(parsed)) {
    return parsed;
  }
  logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-presupuesto-invalido", { raw });
  return DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

/**
 * Representación textual de un motivo que puede no ser un `Error`
 * (`unhandledRejection` admite cualquier valor rechazado). Mismo one-liner
 * que las otras 13 copias del molde en el repo (`main.ts`, `bootstrap.ts`,
 * `ejecutar-operacion.ts`, etc.) — sin ramas extra, para no divergir del
 * formato de log que ya usa el resto del código.
 */
function toErrorMessage(motivo: unknown): string {
  return motivo instanceof Error ? motivo.message : String(motivo);
}

/**
 * ADR 250 pto 2-3 — `unhandledRejection` / `uncaughtException`: log + `exit(1)`,
 * SIN intentar el cierre ordenado de H3 (ningún `close`/`db`, R27). El estado
 * del proceso es indeterminado por definición; correr un drenaje de decenas
 * de segundos sobre invariantes recién rotas puede escribir MÁS basura de la
 * que salva. SQLite es *crash-safe*: lo ya commiteado sobrevive a un `exit(1)`.
 *
 * PURA y observable (R20): el test inyecta `salir` y nunca ejecuta el
 * `process.exit` real. Cada efecto va en su propio `try/catch` y `deps.salir(1)`
 * corre FUERA de ambos, garantizado aunque el logger (o `escribirError`) falle.
 *
 * ★ Nota honesta [D]: en Node 20 el default es `--unhandled-rejections=throw`,
 * o sea una promesa rechazada sin manejar YA mata el proceso por sí sola.
 * Registrar este handler no cambia si el proceso muere; cambia que quede la
 * línea estructurada en `data/harness.log` antes de morir.
 */
export function manejarErrorNoCapturado(
  error: unknown,
  tipo: TipoErrorNoCapturado,
  deps: Partial<ProcesoCierreDeps> = {},
): void {
  const logEvent = deps.logEvent ?? DEPS_POR_DEFECTO.logEvent;
  const escribirError = deps.escribirError ?? DEPS_POR_DEFECTO.escribirError;
  const salir = deps.salir ?? DEPS_POR_DEFECTO.salir;

  try {
    logEvent(PROCESO_LOG_CORRELATION_ID, "proceso-error-no-capturado", {
      tipo,
      message: toErrorMessage(error),
    });
  } catch {
    // El log falló: igual se sale. Ver doc del módulo.
  }
  try {
    escribirError(`Error no capturado (${tipo}): ${toErrorMessage(error)}`);
  } catch {
    // Idem.
  }
  salir(1);
}

/**
 * Estado del módulo (§3.4 del diseño): la señal, el watchdog y la
 * finalización son el ÚNICO tramo con estado mutable de todo `proceso-cierre.ts`
 * — todo lo de arriba es puro. `faseDeCierre` es la garantía de que la
 * promesa se resuelve una sola vez y de que un cierre no arranca dos veces,
 * NO un `boolean` suelto.
 */
let faseDeCierre: "inactiva" | "esperando" | "cerrando" | "terminada" = "inactiva";
/** Deps completas capturadas en la llamada a `esperarSenalDeCierre` — `finalizarCierreHeadless` las reutiliza (mismo `proceso`/`desarmarTimer` que armó todo). */
let depsCapturadas: ProcesoCierreDeps | undefined;
/** Los cuatro pares (evento, handler) registrados, para poder hacer `.off()` con la MISMA referencia de función. */
let handlersRegistrados: {
  evento: SenalDeCierre | TipoErrorNoCapturado;
  handler: (arg?: unknown) => void;
}[] = [];
/** Handle devuelto por `armarTimer`, pasado TAL CUAL a `desarmarTimer` — siempre ref'd (ver `ANCLA_INTERVALO_MS`). */
let watchdogHandle: unknown;
/**
 * Handle devuelto por `armarAncla` (H-1, design §0.7b), pasado TAL CUAL a
 * `desarmarAncla`. Se pone en `undefined` al desarmarlo en la 1.ª señal, así
 * que el desarme de `finalizarCierreHeadless` es un no-op idempotente.
 */
let anclaHandle: unknown;

function resolverDepsCompletas(deps: Partial<ProcesoCierreDeps>): ProcesoCierreDeps {
  return { ...DEPS_POR_DEFECTO, ...deps };
}

/**
 * ★ Registra los cuatro handlers (`SIGTERM`, `SIGINT`, `unhandledRejection`,
 * `uncaughtException`) SOBRE `deps.proceso` y devuelve una promesa que
 * resuelve con la PRIMERA señal recibida. NUNCA rechaza. Llamarla es el
 * ÚNICO camino por el que este módulo toca `process` — importarlo no
 * registra nada (R18).
 *
 * El presupuesto (`resolvePresupuestoCierreMs`) se resuelve UNA VEZ, AL
 * REGISTRAR (no en cada señal): así el evento `cierre-presupuesto-invalido`,
 * si corresponde, sale en el arranque headless, no en el apagado (design §5.3).
 *
 * ★ ENMIENDA H-1/H-2 (design §0.7b y §8) — ORDEN OBLIGATORIO del armado, un
 * contrato y no un detalle: (1) resolver el presupuesto, (2) armar el ANCLA
 * ref'd (`armarAncla`), (3) registrar los cuatro handlers, (4) loguear
 * `cierre-esperando-senal{presupuestoMs}` como ÚLTIMA sentencia. El marcador
 * significa dos cosas a la vez: "ya es seguro mandar la señal" y "el proceso
 * no se va a morir solo". Es el punto de sincronización del test de proceso
 * hijo y lo que un supervisor puede leer; si el logger falla, el arranque
 * continúa igual (mismo criterio que H6): no es un requisito de arranque.
 *
 * En la 1.ª señal: loguea `cierre-senal-recibida`, DESARMA el ancla y arma el
 * watchdog del presupuesto (el baton: siempre hay >= 1 handle ref'd; el
 * watchdog DEBE poder disparar aunque no quede nada más pendiente, así que
 * también se deja ref'd) y resuelve la promesa — la fase pasa a
 * `"cerrando"` ANTES de resolver. Una señal repetida (2.ª+, en cualquier
 * combinación de `SIGTERM`/`SIGINT`) es idempotente: solo loguea
 * `cierre-senal-repetida`, no acorta ni prolonga la espera ni fuerza la
 * salida (ADR 249 pto 5, S-b). Si el watchdog vence, loguea
 * `cierre-presupuesto-excedido{presupuestoMs, senal}` y `salir(1)` — SIN
 * `db.close()` (SQLite es crash-safe).
 *
 * Una falla no capturada durante la espera o el drenaje (incluso con un
 * cierre ya en curso) delega en `manejarErrorNoCapturado` (ADR 250) — nunca
 * se intenta el cierre ordenado desde ahí.
 */
export function esperarSenalDeCierre(
  deps: Partial<ProcesoCierreDeps> = {},
): Promise<SenalDeCierre> {
  const depsCompletas = resolverDepsCompletas(deps);
  depsCapturadas = depsCompletas;
  const presupuestoMs = resolvePresupuestoCierreMs(depsCompletas);
  faseDeCierre = "esperando";
  handlersRegistrados = [];
  watchdogHandle = undefined;
  // (2) El ANCLA va ANTES de los handlers: cuando el marcador aparece, el proceso ya no puede morirse solo.
  anclaHandle = depsCompletas.armarAncla();

  return new Promise<SenalDeCierre>((resolve) => {
    const manejarSenal = (senal: SenalDeCierre): void => {
      if (faseDeCierre !== "esperando") {
        depsCompletas.logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-senal-repetida", { senal });
        return;
      }
      depsCompletas.logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-senal-recibida", { senal });
      // El baton: el ancla sale y el watchdog (ref'd) entra en este mismo turno del event loop.
      depsCompletas.desarmarAncla(anclaHandle);
      anclaHandle = undefined;
      watchdogHandle = depsCompletas.armarTimer(() => {
        depsCompletas.logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-presupuesto-excedido", {
          presupuestoMs,
          senal,
        });
        depsCompletas.salir(1);
      }, presupuestoMs);
      faseDeCierre = "cerrando";
      resolve(senal);
    };

    const manejarFalla =
      (tipo: TipoErrorNoCapturado) =>
      (motivo?: unknown): void => {
        manejarErrorNoCapturado(motivo, tipo, depsCompletas);
      };

    handlersRegistrados = [
      { evento: "SIGTERM", handler: (): void => manejarSenal("SIGTERM") },
      { evento: "SIGINT", handler: (): void => manejarSenal("SIGINT") },
      { evento: "unhandledRejection", handler: manejarFalla("unhandledRejection") },
      { evento: "uncaughtException", handler: manejarFalla("uncaughtException") },
    ];
    for (const { evento, handler } of handlersRegistrados) {
      depsCompletas.proceso.on(evento, handler);
    }

    // (4) ÚLTIMA sentencia del armado (H13). Un logger roto no puede impedir el arranque.
    try {
      depsCompletas.logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-esperando-senal", { presupuestoMs });
    } catch {
      // Ver el doc de arriba: el marcador es informativo, no un requisito de arranque.
    }
  });
}

/**
 * §0.7 + §0.7b + §3.3 — desarma el watchdog Y el ancla (idempotente: tras la
 * 1.ª señal el ancla ya está desarmada y esto es un no-op), quita los cuatro
 * listeners (con la MISMA referencia con la que se registraron), loguea
 * `cierre-completado`, `salir(0)`.
 *
 * ★ CORREGIDO por la evidencia (H-1): un handler de señal NO mantiene vivo el
 * event loop, así que quitarlos es higiene, no mecanismo. Lo que este `salir(0)`
 * explícito garantiza es que el proceso termine YA y con un código conocido
 * tras el cierre ordenado, en vez de depender de qué otros handles queden
 * pendientes. Se llama SIEMPRE después del `finally` de `main.ts` (nunca
 * antes). Código `0`: es un cierre iniciado
 * por señal que completó el drenaje, no la muerte reportada por una shell
 * (`128+N` confundiría un `docker stop` normal con un fallo, §3.3).
 *
 * No-op si `esperarSenalDeCierre` nunca se llamó (modo TUI: no hay fase que
 * cerrar) y no-op si ya se llamó antes (`"terminada"`): idempotente.
 */
/**
 * Lector PURO de la fase de cierre (`salud-operativa`, tarea 4.6, ADR 258
 * §6.3, H13 del delta de `modo-headless-proceso`). NO toca `process`, NO
 * registra nada, NO cambia ninguna transición: solo lee el `let
 * faseDeCierre` que este módulo ya mantiene. `"esperando"` es `false` A
 * PROPÓSITO — en esa fase el proceso está vivo, sano y aceptando tráfico;
 * recién la PRIMERA señal lo pasa a `"cerrando"`, y esa transición ocurre
 * ANTES de resolver la promesa de `esperarSenalDeCierre` (ver el manejador
 * de la señal, arriba): por eso `estaCerrando()` es `true` en el MISMO
 * tick síncrono de la señal, mientras el `finally` de `main.ts` todavía no
 * arrancó — el `503` de `/salud/listo` (S17, criterio O6) ocurre antes que
 * el primer `close()` por CONSTRUCCIÓN, no por carrera.
 */
export function estaCerrando(): boolean {
  return faseDeCierre === "cerrando" || faseDeCierre === "terminada";
}

export function finalizarCierreHeadless(deps: Partial<ProcesoCierreDeps> = {}): void {
  if (faseDeCierre === "inactiva" || faseDeCierre === "terminada") {
    return;
  }
  const depsCompletas = resolverDepsCompletas({ ...depsCapturadas, ...deps });
  depsCompletas.desarmarTimer(watchdogHandle);
  depsCompletas.desarmarAncla(anclaHandle);
  anclaHandle = undefined;
  for (const { evento, handler } of handlersRegistrados) {
    depsCompletas.proceso.off(evento, handler);
  }
  handlersRegistrados = [];
  faseDeCierre = "terminada";
  depsCompletas.logEvent(PROCESO_LOG_CORRELATION_ID, "cierre-completado", {});
  depsCompletas.salir(0);
}
