import "../../core/config/env.js";

/**
 * Typed configuration for the inbound A2A server, `src/adapters/a2a/server.ts`
 * (Hito 7, tarea 1, ADR 88, ADR 94 pto 8-10, ADR 97, design.md §6.1).
 *
 * The side-effect import above loads `.env` via `src/core/config/env.ts`,
 * the repo's single dotenv loading point — same pattern as
 * `src/adapters/a2a/config.ts` and `src/adapters/webhooks/config.ts`.
 */
export interface A2AServerConfig {
  /** `""` (o sólo espacios) = adaptador DESHABILITADO: no se abre ningún puerto (ADR 88 pto 4). */
  readonly token: string;
  readonly port: number;
  /** Base pública para `supportedInterfaces[0].url`. Sin `/` final (se normaliza). */
  readonly publicUrl: string;
  readonly maxBodyBytes: number;
  readonly maxEnVuelo: number;
}

export const DEFAULT_A2A_ENTRANTE_PORT = 8888;
export const DEFAULT_A2A_ENTRANTE_PUBLIC_URL = "http://localhost:8888";
/** 64 KiB. */
export const DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES = 65_536;
export const DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO = 4;
/**
 * Techo del drenaje de turnos en vuelo al cerrar. Constante, NO env var — es
 * un presupuesto de UX, no un hecho del entorno. Molde de
 * `WEBHOOK_CLOSE_TIMEOUT_MS`/`WEB_CLOSE_TIMEOUT_MS` (tercera instancia de
 * `5_000`, design.md §6.1).
 */
export const A2A_CLOSE_TIMEOUT_MS = 5_000;
/**
 * Correlación de eventos de ciclo de vida del proceso sin `a2aTaskId` natural
 * (arranque, apagado, timeouts de drenaje). Análogo de
 * `WEBHOOK_LOG_CORRELATION_ID`/`WEB_LOG_CORRELATION_ID`.
 */
export const A2A_SERVER_LOG_CORRELATION_ID = "a2a-servidor";

/**
 * Techo de DESALOJO de una entrada de `enVuelo` cuando el turno real nunca
 * resuelve ni rechaza (Hallazgo 2 Reviewer, Hito 7): sin esto, un turno
 * colgado (no hay ningún timeout/`AbortController` en la cadena real hasta
 * `invokeModel`, fuera de alcance de este arreglo puntual — ver AGENTS.md)
 * deja su entrada en `enVuelo` para siempre, y tras `maxEnVuelo` turnos
 * colgados el servidor rechaza todo `SendMessage` nuevo hasta reiniciar el
 * proceso. Cumplido el techo, `startServer` saca la entrada de `enVuelo`
 * IGUAL (libera el slot), pero NO cancela ni toca la promesa real del
 * turno, que sigue corriendo en segundo plano y sigue escribiendo su
 * resultado eventual vía `actualizarSolicitudA2AEnCurso` — deja de contar
 * contra el tope, nada más.
 *
 * Constante, NO env var — mismo criterio que `A2A_CLOSE_TIMEOUT_MS`:
 * presupuesto de capacidad/UX, no un hecho del entorno.
 *
 * Valor: `120_000` (2 minutos) — mismo orden de magnitud que los otros dos
 * techos ya existentes en el repo para un turno/tarea de agente de
 * duración "normal pero acotada": `SOPORTE_TIMEOUT_MS` (`adapters/web/config.ts`)
 * y `DEFAULT_A2A_TASK_TIMEOUT_MS` (`adapters/a2a/config.ts`, el timeout del
 * Cliente A2A saliente del Hito 6). Deliberadamente HOLGADO respecto de la
 * duración típica de un turno: el objetivo es blindar el tope de slots
 * contra un turno realmente colgado, no recortar turnos legítimos que
 * simplemente tardan.
 */
export const A2A_TURNO_EN_VUELO_MAX_MS = 120_000;

export const RUTA_AGENT_CARD = "/.well-known/agent-card.json";
export const RUTA_JSONRPC = "/a2a";

export const METODO_SEND_MESSAGE = "SendMessage";
export const METODO_GET_TASK = "GetTask";
export const METODO_CANCEL_TASK = "CancelTask";

/* JSON-RPC 2.0 base — fijos, no dependen de ninguna verificación pendiente (ADR 94 pto 8). */
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/**
 * A2A-específicos — verificados contra `docs/specification.md` del tag
 * `v1.0.0` de `a2aproject/A2A` (Sección 5.4, "Error Code Mappings"; ADR 94
 * pto 9-10, RD-37): la especificación define códigos PROPIOS y literales
 * para estos dos casos, así que se usan tal cual — no un valor libre del
 * rango `-32000..-32099`.
 *
 * `TaskNotFoundError` → `-32001` (docs/specification.md, tabla §5.4, y
 * confirmado además en el ejemplo de payload de esa misma sección).
 */
export const A2A_ERROR_TASK_NOT_FOUND = -32001;
/** `TaskNotCancelableError` → `-32002` (docs/specification.md, tabla §5.4). */
export const A2A_ERROR_TASK_NOT_CANCELABLE = -32002;

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, not finite, or not strictly
 * greater than zero. Never throws — this adapter's configuration is
 * best-effort by design (design.md §6.1), same contract as
 * `resolvePositiveNumber` in `src/adapters/a2a/config.ts`.
 *
 * The finiteness check rejects `Infinity`/`-Infinity` — e.g.
 * `HARNESS_A2A_ENTRANTE_PORT=Infinity` or `=1e400` (which `Number()` also
 * parses to `Infinity`) would otherwise pass and defeat the purpose of
 * having a bounded value at all.
 *
 * DELIBERATELY duplicated across adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic — `src/core/` shouldn't gain a
 * dependency just to serve adapter convenience — and AGENTS.md's
 * non-negotiable rule forbids one adapter importing from another. Same
 * accepted-duplication call as `a2a/config.ts:49-58`.
 */
function resolvePositiveNumber(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

/** Ensures `url` does not end with a trailing `/`. Molde de `normalizeUrl` en `web/config.ts`. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveA2AConfig`/`resolveWebConfig`. NUNCA lanza: un token ausente es
 * un modo de operación válido (adaptador deshabilitado), no un error de
 * arranque.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `HARNESS_A2A_ENTRANTE_TOKEN` | `token` | `""` (deshabilitado) |
 * | `HARNESS_A2A_ENTRANTE_PORT` | `port` | `DEFAULT_A2A_ENTRANTE_PORT` |
 * | `HARNESS_A2A_ENTRANTE_PUBLIC_URL` | `publicUrl` | `DEFAULT_A2A_ENTRANTE_PUBLIC_URL`, sin `/` final |
 * | `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES` | `maxBodyBytes` | `DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES` |
 * | `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | `maxEnVuelo` | `DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO` |
 *
 * `HARNESS_A2A_ENTRANTE_PORT` SÍ lleva default (a diferencia de `WEB_PORT`):
 * acá el gate es el token, no el puerto (ADR 88 pto 4) — ver el comentario
 * completo en `design.md` §6.1.
 */
export function resolveA2AServerConfig(env: NodeJS.ProcessEnv = process.env): A2AServerConfig {
  return {
    // `.trim()` acá (no sólo en `isA2AServerEnabled`, Hallazgo 1 Reviewer,
    // Hito 7): `esAutorizado` (`server.ts`) compara el header `Bearer`
    // contra `config.token` CRUDO. Si el token de entorno tenía espacios
    // incidentales, `isA2AServerEnabled` ya decidía "habilitado" con el
    // criterio recortado, pero el servidor comparaba contra el valor SIN
    // recortar y rechazaba (401) a todo cliente legítimo que mandara el
    // token ya recortado. Recortar acá, una sola vez, en el punto de
    // resolución, alinea ambos criterios.
    token: (env.HARNESS_A2A_ENTRANTE_TOKEN ?? "").trim(),
    port: resolvePositiveNumber(env.HARNESS_A2A_ENTRANTE_PORT, DEFAULT_A2A_ENTRANTE_PORT),
    publicUrl: normalizeUrl(env.HARNESS_A2A_ENTRANTE_PUBLIC_URL ?? DEFAULT_A2A_ENTRANTE_PUBLIC_URL),
    maxBodyBytes: resolvePositiveNumber(
      env.HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES,
      DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES,
    ),
    maxEnVuelo: resolvePositiveNumber(
      env.HARNESS_A2A_ENTRANTE_MAX_EN_VUELO,
      DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO,
    ),
  };
}

/**
 * `config.token.trim() !== ""`. ÚNICO gate del listener (ADR 88 pto 4). Molde
 * de `isWebhookEnabled`. No hay `HARNESS_A2A_ENTRANTE=on/off` separado: un
 * booleano aparte del token permitiría expresar "servidor prendido, sin
 * token", estado que el token-como-único-gate vuelve inexpresable a propósito.
 */
export function isA2AServerEnabled(config: A2AServerConfig): boolean {
  return config.token.trim() !== "";
}
