/**
 * Logging y correlación base (Concepto transversal 3) — Hito 1, tarea 12.
 *
 * arc42, Concepto Transversal 3 (línea 500): la Meta 3 (Observabilidad)
 * exige trazar cada respuesta a su fuente — pero eso solo funciona en la
 * práctica si el Núcleo, el Adaptador de Conocimiento y el de Memoria
 * comparten un mismo identificador de turno/sesión en sus logs. Este módulo
 * define esa convención: `casoId` como identificador compartido.
 *
 * Design decision — `casoId` es un parámetro posicional obligatorio, no un
 * campo dentro de `fields`: la convención se hace cumplir por tipos, no solo
 * por documentación, así ningún caller puede loguear un evento de turno sin
 * pasar un `casoId`. `fields` se spreadea PRIMERO y `casoId`/`event`/
 * `timestamp` van DESPUÉS en el objeto literal — si `fields` incluyera
 * cualquiera de esas tres claves, la propia (el `casoId` posicional, el
 * `event` posicional, o `deps.now()`) gana siempre. Esto evita que un
 * caller descuidado rompa la correlación pasando un `casoId` distinto, o
 * (hallazgo de code-review post-implementación) que reemplace en silencio
 * el timestamp real inyectado por `deps.now()` con un `fields.timestamp`
 * arbitrario — la misma garantía que ya protegía `casoId` se extiende a
 * `timestamp`, porque este módulo existe justamente para que la
 * correlación (Concepto Transversal 3) sea confiable.
 *
 * Design decision — sin niveles (info/warn/error) y sin formato legible
 * especial: "base" en el nombre de la tarea significa lo mínimo que hace
 * cumplir la convención de correlación, no un sistema de logging completo.
 * Cada llamada emite una única línea JSON estructurada.
 *
 * Design decision — `now`/`write` inyectables, mismo patrón DI que
 * `queryFn` en `invoke-model.ts` y `CloseTurnDeps` en `close-turn.ts`: el
 * default usa `Date`/`console.error` reales, los tests inyectan fakes. Esto
 * no es específico del turno (`src/core/turn-selector/`) — vive en
 * `src/core/logging/` porque cualquier bloque del núcleo, y más adelante
 * los adaptadores (que sí pueden importar de `src/core/`; la regla no
 * negociable solo prohíbe la dirección opuesta), puede necesitar loguear con
 * un `casoId` de correlación.
 *
 * Alcance — esta tarea define la convención/utilidad standalone. Conectarla
 * a los puntos reales del flujo del turno (`assemble-context.ts`,
 * `invoke-model.ts`, `close-turn.ts`, `turn-error.ts`, etc.) es
 * responsabilidad de tareas posteriores (Secuencia de arranque, tarea 13;
 * Integración end-to-end, tarea 15) — mismo criterio que ya se aplicó en la
 * tarea 11 para `runTurnStage`.
 *
 * Design decision — desde Hito 3, `logTurnEvent` también lo consumen los
 * adaptadores de Webhooks y de Tablero, y el orquestador de actividad
 * (`build-on-activity.ts`, `run-activity-turn.ts`) — no solo `handleTurn`
 * (Hito 1) y los adaptadores de Conocimiento/Memoria/TUI. Ejemplos
 * representativos de los ~25 eventos nuevos: `webhook-recibido`,
 * `webhook-firma-invalida`, `actividad-encolada`, `actividad-creada`,
 * `actividad-turno-fallido`, `tablero-actualizado`. El contrato de esta
 * función NO cambió para soportarlos: `design.md` §9 de ese hito lo
 * resuelve explícitamente ("no gana código; a lo sumo una línea en su
 * module doc") — ver esa sección para la tabla completa.
 *
 * Nota — el parámetro posicional `casoId` no siempre recibe, en la
 * práctica, un id de `caso` real, aunque su nombre en la firma no cambió
 * (eso sí sería un cambio de contrato, fuera de alcance de esta nota).
 * `design.md` §9.1 de Hito 3 resuelve que hay DOS espacios de id de
 * correlación distintos: los eventos de transporte de Webhooks
 * (`webhook-recibido`, `webhook-firma-invalida`, ...) ocurren ANTES de que
 * exista ningún `caso` — una firma inválida, por diseño, no crea fila —
 * así que se correlacionan por `deliveryId` (el `X-GitHub-Delivery` de
 * GitHub); los eventos de ciclo de vida del proceso sin ningún delivery
 * (`webhook-escuchando`, arranque/cierre del servidor) usan en su lugar la
 * constante `"webhook-adapter"` (`WEBHOOK_LOG_CORRELATION_ID`,
 * `adapters/webhooks/config.ts`). Los eventos de turno, una vez que existe
 * `caso`, siguen usando `casoId` como siempre. El puente entre ambos
 * espacios son `actividad-creada` / `actividad-reusada`: se loguean con
 * `casoId` como primer parámetro, pero llevan además `deliveryId` dentro
 * de `fields`, así una línea de `data/harness.log` permite saltar de un
 * espacio al otro.
 *
 * Design decision — default `write` escribe a un archivo (`data/harness.log`
 * vía `createFileLogWriter`), no a ningún stream del proceso (hallazgo
 * post-Hito 1, mejora del Adaptador TUI): esta tarea se implementó antes de
 * que existiera ninguna UI, así que `console.log` (stdout) era un destino
 * inocuo en ese momento. Una vez que el Adaptador TUI (tarea 14) monta con
 * Ink, `render()` asume control exclusivo de stdout para poder redibujar la
 * pantalla en cada frame — cualquier otra escritura cruda a ese canal (como
 * una línea de `logTurnEvent` disparada en medio de un turno por
 * `handleTurn`) corrompe el tracking de líneas de Ink. Un primer intento
 * movió el default a `console.error` (stderr) asumiendo que, al ser Ink
 * ajeno a ese stream, dejaría de interferir — cierto para el tracking
 * interno de Ink, pero insuficiente: stdout y stderr son streams separados a
 * nivel de proceso, pero una terminal real los intercala en la misma
 * pantalla salvo que cada uno se redirija por separado, así que la línea
 * seguía apareciendo igual (verificado por el usuario). Escribir a un
 * archivo en cambio no toca ningún stream que la terminal muestre — la
 * única forma de que el log de correlación no aparezca en pantalla es que
 * no pase por la terminal en absoluto.
 *
 * Design decision — el path del archivo (`DEFAULT_LOG_FILE_PATH`) es un
 * default interno de este módulo, no un parámetro que `handleTurn`/`main.ts`
 * deban pasar explícitamente, a diferencia de `openDatabase(filePath)`
 * (`src/adapters/memory/db.ts`): ese path SÍ es obligatorio porque distintos
 * callers (producción vs. tests con `mkdtempSync`) necesitan valores
 * distintos con frecuencia. Acá el valor por defecto sirve para el 100% de
 * los casos de producción (mismo criterio que `CASO_ESTADO_ACTIVO` en
 * `handle-turn.ts` o `DEFAULT_AGENT_MODEL` en `definitions.ts`) — lo que
 * SÍ es inyectable, y lo que los tests realmente necesitan, es `write`
 * (la función completa), no solo el path. `createFileLogWriter` queda
 * exportado para que los propios tests de este módulo ejerciten el
 * mecanismo real contra un archivo temporal (mismo patrón que
 * `db.test.ts` ya usa con `mkdtempSync`), sin acoplar la aserción a
 * `data/harness.log` real del repo.
 *
 * Design decision — fallas de escritura se tragan (try/catch interno de
 * `createFileLogWriter`), nunca se propagan: este módulo existe para
 * observabilidad (Concepto Transversal 3), no para corrección de negocio —
 * si el disco está lleno o el proceso no tiene permiso de escritura, eso no
 * puede convertir un turno que sí completó exitosamente (`handleTurn`) en
 * uno que aparenta haber fallado. Mismo criterio que ya aplica en
 * `close-turn.ts`/`invoke-model.ts`: cada módulo falla solo por su propia
 * responsabilidad, no por la de otro.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a single already-formatted log line. Default: appends to
 * `DEFAULT_LOG_FILE_PATH` via `createFileLogWriter` — no process stream,
 * stdout or stderr (see the module doc's "default `write` escribe a un
 * archivo" note for why).
 */
export type LogWriter = (line: string) => void;

/**
 * Injectable timestamp/write, so `logTurnEvent` is testable without
 * touching the real clock or the real filesystem. Production callers omit
 * this argument and get the default below.
 */
export interface LogTurnEventDeps {
  readonly now: () => string;
  readonly write: LogWriter;
}

/**
 * Builds a `LogWriter` that appends `line` (plus a trailing newline) to
 * `filePath`, creating any missing parent directories first. Failures
 * (missing permissions, full disk, an invalid path, ...) are swallowed, not
 * thrown — see the module doc's "fallas de escritura se tragan" note for
 * why. Exported so this module's own tests can exercise the real mechanism
 * against a temporary file (same pattern `db.test.ts` uses with
 * `mkdtempSync`), instead of only ever testing a fake `write`.
 */
export function createFileLogWriter(filePath: string): LogWriter {
  return (line) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, `${line}\n`);
    } catch {
      // Best-effort — see this function's own doc for why a logging
      // failure must never propagate.
    }
  };
}

/**
 * Conventional path for `logTurnEvent`'s default file sink — same `data/`
 * directory `main.ts` already uses for `data/harness.db` (`openDatabase`).
 */
export const DEFAULT_LOG_FILE_PATH = "data/harness.log";

const DEFAULT_LOG_TURN_EVENT_DEPS: LogTurnEventDeps = {
  now: () => new Date().toISOString(),
  write: createFileLogWriter(DEFAULT_LOG_FILE_PATH),
};

/**
 * Logs a turn-scoped event as a single structured JSON line, always keyed
 * by `casoId` as the shared correlation identifier (arc42 Concepto
 * Transversal 3). `casoId` is a mandatory positional parameter — see the
 * module doc for why.
 */
export function logTurnEvent(
  casoId: string,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
  deps: LogTurnEventDeps = DEFAULT_LOG_TURN_EVENT_DEPS,
): void {
  deps.write(JSON.stringify({ ...fields, casoId, event, timestamp: deps.now() }));
}
