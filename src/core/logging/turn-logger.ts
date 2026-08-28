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
 * default usa `Date`/`console.log` reales, los tests inyectan fakes. Esto no
 * es específico del turno (`src/core/turn-selector/`) — vive en
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
 */

/** Writes a single already-formatted log line. Default: `console.log`. */
export type LogWriter = (line: string) => void;

/**
 * Injectable timestamp/write, so `logTurnEvent` is testable without
 * touching the real clock or real stdout. Production callers omit this
 * argument and get the default below.
 */
export interface LogTurnEventDeps {
  readonly now: () => string;
  readonly write: LogWriter;
}

const DEFAULT_LOG_TURN_EVENT_DEPS: LogTurnEventDeps = {
  now: () => new Date().toISOString(),
  write: (line) => console.log(line),
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
