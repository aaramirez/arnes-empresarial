import "../../core/config/env.js";

/**
 * Side-effect import: mismo criterio que `adapters/webhooks/config.ts` y
 * `adapters/board/config.ts` (verificados). Este módulo SÍ lo hace, a
 * diferencia de `core/ventas/ventas-config.ts` (ADR 17a): acá estamos en un
 * adaptador y leer `process.env` es su trabajo.
 */
export interface WebConfig {
  /** `0` = adaptador DESHABILITADO: no se abre ningún puerto (spec `venta-confirmacion`, req. 1). */
  readonly port: number;
  /**
   * Interfaz de escucha (`WEB_HOST`, `modo-headless-cierre-limpio` RD-123).
   * AUSENTE por CLAVE (nunca `host: undefined`, `exactOptionalPropertyTypes`)
   * = `startServer` NO pasa `host` a `listen`: mismo bind de siempre (`::`,
   * IPv4 e IPv6). `"0.0.0.0"` no es equivalente (dejaria de escuchar en IPv6).
   */
  readonly host?: string;
  /** Base pública para armar el link. Sin `/` final (se normaliza). */
  readonly publicUrl: string;
  /** `""` = `POST /ventas` responde 401 SIEMPRE. Nunca "abierta por defecto" (propuesta, *Approach*). */
  readonly ventasApiToken: string;
  readonly maxBodyBytes: number;
}

export const DEFAULT_WEB_PUBLIC_URL = "http://localhost:8080";
/** 64 KiB. */
export const DEFAULT_WEB_MAX_BODY_BYTES = 65_536;
/** Techo del drenaje de turnos de soporte en vuelo al cerrar (ADR 14, punto 4). Constante, no env var. */
export const WEB_CLOSE_TIMEOUT_MS = 5_000;
/** Techo de un turno de soporte antes de responder 504 (ADR 14, punto 3). Constante: presupuesto de UX. */
export const SOPORTE_TIMEOUT_MS = 120_000;
/** Correlación de eventos de ciclo de vida del proceso, sin `requestId` natural. Análogo de `WEBHOOK_LOG_CORRELATION_ID`. */
export const WEB_LOG_CORRELATION_ID = "web-adapter";

export const RUTA_VENTAS = "/ventas";
export const RUTA_CONFIRMAR_PREFIJO = "/confirmar/";
export const RUTA_DEVOLUCION = "/devolucion";
export const RUTA_SOPORTE = "/soporte";
/** `operaciones-negocio-conversacionales`, ADR 173 pto 1, tarea 9. */
export const RUTA_LOGIN = "/login";
/** Ídem. */
export const RUTA_OPERACIONES = "/operaciones";
/**
 * Techo del turno de `POST /operaciones` antes de responder `504` -- CONSTANTE
 * nueva e INDEPENDIENTE de `SOPORTE_TIMEOUT_MS` (ADR 173 pto 3): son turnos
 * distintos (empleado autenticado vs. cliente anónimo), se permite tunearlos
 * distinto.
 */
export const OPERACIONES_TIMEOUT_MS = 120_000;

/**
 * Techos de rotación perezosa de la conversación (`chat-web-empleado`, ADR
 * 197). Evaluados en el ACCESO (`ConversacionEmpleadoStore.paraSesion`), no
 * con un timer — mismo criterio que `SesionEmpleadoStore.buscar` con
 * `sesionVigente`. Al superarlos la entrada ROTA (nunca rechaza).
 */
export const CONVERSACION_INACTIVIDAD_MS = 30 * 60_000;
/** Ídem, por cantidad de turnos en vez de tiempo. */
export const CONVERSACION_MAX_TURNOS = 40;

/**
 * Rutas nuevas de la interfaz de chat (`chat-web-empleado`, ADR 199, ADR
 * 201). `RUTA_LOGOUT` en la raíz, no bajo `/chat/` -- es la inversa de
 * `/login` (ADR 201 pto 3), no una función del chat.
 */
export const RUTA_CHAT = "/chat";
export const RUTA_CHAT_SCRIPT = "/chat/app.js";
export const RUTA_CHAT_ESTILOS = "/chat/app.css";
export const RUTA_LOGOUT = "/logout";

/**
 * Content-Security-Policy exacta de las tres rutas del chat (`design.md`
 * §5, ADR 199) -- literal, sin `unsafe-inline`. Comparar SIEMPRE con
 * igualdad completa (`toEqual`), nunca `toContain` (molde ADR 96 pto 1).
 * NO se aplica a `respondHtml` (`GET /confirmar/:token` sigue sin CSP,
 * ADR 199 pto 2) -- ver `respondHtmlChat` en `server.ts`.
 */
export const CSP_CHAT =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Parses a positive-integer env var, falling back to `defaultValue` when the
 * raw value is missing, blank, not a number, or not strictly greater than
 * zero. Never throws. Mismo criterio que `resolvePositiveNumber` de
 * `adapters/webhooks/config.ts`.
 *
 * DELIBERATELY duplicated across 5 adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic — `src/core/` shouldn't gain a
 * dependency just to serve adapter convenience — and AGENTS.md's
 * non-negotiable rule forbids one adapter importing from another. Same
 * accepted-duplication call as `sesion.ts`/`token-confirmacion.ts`.
 */
function resolvePositiveNumber(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

/** Ensures `url` does not end with a trailing `/`. */
function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Pura, `env` con default `process.env` — mismo patrón que
 * `resolveWebhookConfig`. NUNCA lanza: la ausencia de `WEB_PORT` es un modo
 * de operación válido, no un error (a diferencia de `resolveVentasConfig`,
 * ADR 17).
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `WEB_PORT` | `port` | `0` (deshabilitado) |
 * | `WEB_HOST` | `host` | clave AUSENTE (`listen` sin `host`); blanco = ausente |
 * | `WEB_PUBLIC_URL` | `publicUrl` | `DEFAULT_WEB_PUBLIC_URL`, sin `/` final |
 * | `VENTAS_API_TOKEN` | `ventasApiToken` | `""` (ruta `/ventas` siempre 401) |
 * | `WEB_MAX_BODY_BYTES` | `maxBodyBytes` | `DEFAULT_WEB_MAX_BODY_BYTES` |
 *
 * `WEB_PORT` ausente/vacío/no numérico/≤ 0 → `0`. NO cae a un puerto por
 * defecto, a diferencia de `WEBHOOK_PORT`: en el webhook el gate es el
 * secreto y el puerto tiene default; acá el gate ES el puerto (ADR 5 de Hito
 * 3, mismo criterio opt-in con otra llave), así que un default lo rompería.
 */
export function resolveWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  // `.trim()`: un `WEB_HOST=` vacio en un `.env` no puede significar "escucha
  // en la cadena vacia". Blanco = ausente; la clave se OMITE (no `undefined`).
  const host = env.WEB_HOST?.trim();
  return {
    port: resolvePositiveNumber(env.WEB_PORT, 0),
    ...(host !== undefined && host !== "" ? { host } : {}), // exactOptionalPropertyTypes
    publicUrl: normalizeUrl(env.WEB_PUBLIC_URL ?? DEFAULT_WEB_PUBLIC_URL),
    ventasApiToken: env.VENTAS_API_TOKEN ?? "",
    maxBodyBytes: resolvePositiveNumber(env.WEB_MAX_BODY_BYTES, DEFAULT_WEB_MAX_BODY_BYTES),
  };
}

/** `config.port > 0`. Único gate del listener. */
export function isWebEnabled(config: WebConfig): boolean {
  return config.port > 0;
}
