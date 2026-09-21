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

/** Representación textual de un motivo que puede no ser un `Error` (`unhandledRejection` admite cualquier valor rechazado). */
function toErrorMessage(motivo: unknown): string {
  if (motivo instanceof Error) {
    return motivo.message;
  }
  if (typeof motivo === "string") {
    return motivo;
  }
  if (motivo === undefined) {
    return "undefined";
  }
  try {
    // `JSON.stringify` devuelve `undefined` (no la cadena) para algunos
    // valores (funciones, símbolos) — de ahí el `?? String(motivo)`.
    return JSON.stringify(motivo) ?? String(motivo);
  } catch {
    return String(motivo);
  }
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
