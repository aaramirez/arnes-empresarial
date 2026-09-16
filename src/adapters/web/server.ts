/**
 * Listener HTTP del adaptador Web (Hito 4, tarea 17, §4.4 — el corazón del
 * adaptador). Ruteo, auth de `/ventas`, drenaje de turnos de soporte y de
 * operaciones en vuelo, y la tabla de respuestas exhaustiva del diseño.
 *
 * Orden de checks dentro de cada ruta — EXHAUSTIVO, no se reordena
 * (design.md §4.4): `método+ruta → tope de body → auth (solo /ventas) →
 * parseo → handler`.
 *
 * Mismo truco de `webhooks/server.ts` (Hito 3): `createRequestListener`
 * aísla el manejo de una request/response para poder testear cada respuesta
 * con dobles planos de `WebRequest`/`WebResponse`, sin abrir ningún puerto
 * real ni mockear `node:http`. `startServer` monta ese listener sobre un
 * servidor real (o inyectado en tests) y agrega el drenaje de los turnos de
 * `/soporte` y de `/operaciones` en vuelo al cerrar (mismo `Set`
 * compartido — hallazgo de Reviewer, `operaciones-negocio-conversacionales`).
 *
 * Diferencia real con `webhooks/server.ts`, no cosmética: acá la
 * acumulación del body la hace `leerBody` (tarea 14) en vez de reimplementar
 * los listeners de `data`/`end`/`error` a mano — por eso el listener
 * devuelto por `createRequestListener` es una función síncrona que delega en
 * handlers `async` por ruta (`void handleX(...)`), en vez de acumular chunks
 * inline como hace el webhook.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import {
  CSP_CHAT,
  OPERACIONES_TIMEOUT_MS,
  RUTA_CHAT,
  RUTA_CHAT_ESTILOS,
  RUTA_CHAT_SCRIPT,
  RUTA_CONFIRMAR_PREFIJO,
  RUTA_DEVOLUCION,
  RUTA_LOGIN,
  RUTA_LOGOUT,
  RUTA_OPERACIONES,
  RUTA_SOPORTE,
  RUTA_VENTAS,
  SOPORTE_TIMEOUT_MS,
  WEB_CLOSE_TIMEOUT_MS,
  WEB_LOG_CORRELATION_ID,
  type WebConfig,
} from "./config.js";
import type { CreateWebServerFn, WebRequest, WebResponse } from "./http.js";
import { leerBody } from "./body.js";
import { parseJsonBody } from "./body.js";
import {
  parseAltaVentaPayload,
  parseDecisionForm,
  parseDevolucionPayload,
  parseLoginPayload,
  parseOperacionesPayload,
  parseSoportePayload,
} from "./payloads.js";
import { renderConfirmacionHtml, renderLinkInvalidoHtml, renderResultadoHtml } from "./render.js";
import { CHAT_CLIENT_JS } from "./chat-client.js";
import { CHAT_CSS, renderChatHtml } from "./chat-page.js";
import type { RegistrarVentaInput, RegistrarVentaResult } from "../../core/ventas/registrar-venta.js";
import type { DecisionCliente, DecisionVentaResult } from "../../core/ventas/confirmar-venta.js";
import type { DevolucionResult } from "../../core/ventas/procesar-devolucion.js";
import type { VentaPublica } from "../../core/ventas/ventas-contract.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";
import type { ConfirmacionOperacionPort } from "../../core/operaciones/operaciones-contract.js";
import type { SesionEmpleadoStore } from "./sesion-empleado-store.js";
import type { ConfirmacionOperacionesStore } from "./confirmacion-operaciones-store.js";
import type { ConversacionEmpleadoStore } from "./conversacion-empleado-store.js";
import type { ConversacionEmpleadoPort } from "../../core/conversacion/conversacion-contract.js";

/**
 * DECISIÓN PARA EL REVIEWER: `SoporteResult` todavía no existe como módulo
 * importable — se define recién en `build-on-soporte.ts` (tarea 27, futura,
 * composition root, ADR del ámbito de ese archivo). Lo declaro LOCALMENTE
 * acá con la forma exacta que da `design.md` (líneas 1708-1711):
 * `{ casoId, respuesta }`. Cuando la tarea 27 defina el módulo real, este
 * tipo debe alinearse (o re-exportarse desde ahí) — hoy `WebServerDeps`
 * depende de esta forma estructural, no de una identidad de tipo importada.
 */
export interface SoporteResult {
  readonly casoId: string;
  readonly respuesta: string;
}

/**
 * Resultado de `POST /login` (`operaciones-negocio-conversacionales`, ADR
 * 173 pto 2, tarea 9). Mismo criterio estructural que `SoporteResult` de
 * arriba: se declara LOCALMENTE, no se importa desde `build-on-login-http.ts`
 * (composition root) — un adaptador no importa de un módulo de composition
 * root, se acopla por FORMA, no por identidad de tipo.
 */
export type LoginHttpResult =
  | { readonly ok: true; readonly token: string; readonly expiraEn?: string }
  | { readonly ok: false };

export interface WebServerDeps {
  readonly config: WebConfig;
  /** Los cinco handlers del ADR 12, ya cerrados sobre sus dependencias por el composition root. */
  readonly onAltaVenta: (input: RegistrarVentaInput) => Promise<RegistrarVentaResult>;
  readonly onConsultaVenta: (token: string) => Promise<VentaPublica | undefined>;
  readonly onDecisionVenta: (input: {
    readonly token: string;
    readonly decision: DecisionCliente;
  }) => Promise<DecisionVentaResult>;
  readonly onDevolucion: (input: {
    readonly token: string;
    readonly motivo?: string;
  }) => Promise<DevolucionResult>;
  readonly onSoporte: (input: { readonly consulta: string }) => Promise<SoporteResult>;
  /** `operaciones-negocio-conversacionales`, ADR 173 pto 2, tarea 9: `POST /login`. */
  readonly onLogin: (input: {
    readonly empleadoId: string;
    readonly password: string;
  }) => Promise<LoginHttpResult>;
  /**
   * ídem, ADR 173 pto 3: `POST /operaciones`. Mismo shape de resultado que
   * `SoporteResult` (`{ casoId, respuesta }`) -- turno distinto, forma
   * idéntica.
   */
  readonly onOperacionesEmpleado: (input: {
    readonly consulta: string;
    readonly sesion: SesionEmpleado;
    readonly confirmacion: ConfirmacionOperacionPort;
    /** `chat-web-empleado`, ADR 196 pto 3 — memoria conversacional, escopeada por el MISMO token que `sesion` (nunca por `empleadoId`). */
    readonly conversacion: ConversacionEmpleadoPort;
  }) => Promise<SoporteResult>;
  /** ídem, ADR 173 pto 4: resuelve el `Bearer <token>` de `POST /operaciones` a una `SesionEmpleado`. */
  readonly sesionStore: SesionEmpleadoStore;
  /** ídem, ADR 173 pto 4: ranura de confirmación por-empleado de `cancelar_solicitud_interna`. */
  readonly confirmacionOperacionesStore: ConfirmacionOperacionesStore;
  /** `chat-web-empleado`, ADR 196 §2: ranura de memoria conversacional por-TOKEN de sesión HTTP (nunca por `empleadoId`, ADR 196 §2.1). */
  readonly conversacionStore: ConversacionEmpleadoStore;
  readonly logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** `randomUUID` en producción; contador determinista en tests. Ver §9.1. */
  readonly newRequestId?: () => string;
}

export interface WebServerHandle {
  readonly port: number;
  /** Deja de aceptar, drena los turnos de `/soporte` y de `/operaciones` en vuelo con techo de `WEB_CLOSE_TIMEOUT_MS`, resuelve. NUNCA rechaza. */
  close(): Promise<void>;
}

type LogEventFn = WebServerDeps["logEvent"];

/** `req.url` recortado en el primer `?` — mismo criterio que `pathFromUrl` de `webhooks/server.ts:92-98` (duplicado a propósito, ADR 13). */
function pathFromUrl(url: string | undefined): string {
  if (url === undefined) {
    return "";
  }
  const questionMarkIndex = url.indexOf("?");
  return questionMarkIndex === -1 ? url : url.slice(0, questionMarkIndex);
}

/** Header falta en un array — se toma el primer valor. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Auth de `/ventas`: header `Authorization: Bearer <VENTAS_API_TOKEN>`,
 * comparado en tiempo constante. `ventasApiToken === ""` → `false` SIN
 * comparar nada (nunca "abierta por defecto"). Chequeo de longitud ANTES de
 * `timingSafeEqual` — misma trampa que `signature.ts` de Hito 3
 * (`timingSafeEqual` lanza `RangeError` con buffers de largo distinto).
 */
function esAutorizado(req: WebRequest, ventasApiToken: string): boolean {
  if (ventasApiToken === "") {
    return false;
  }

  const headerValue = firstHeaderValue(req.headers.authorization);
  if (typeof headerValue !== "string" || headerValue === "") {
    return false;
  }

  const esperado = `Bearer ${ventasApiToken}`;
  const esperadoBuffer = Buffer.from(esperado, "utf8");
  const actualBuffer = Buffer.from(headerValue, "utf8");

  if (esperadoBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(esperadoBuffer, actualBuffer);
}

const BEARER_PREFIJO = "Bearer ";

/**
 * Extrae `<token>` de un header `Authorization: Bearer <token>`
 * (`operaciones-negocio-conversacionales`, ADR 173 pto 3, tarea 9). Reusa
 * `firstHeaderValue` -- el mismo extractor de header que ya usa `esAutorizado`
 * -- pero a diferencia de esa función, que compara el header COMPLETO contra
 * un secreto único con `timingSafeEqual`, esto DEVUELVE el token para que el
 * caller lo busque por CLAVE en un store (`sesionStore.buscar`, molde
 * `token-confirmacion.ts`: token opaco de alta entropía, buscado por
 * igualdad de clave, no por barrido secuencial contra un secreto adivinable
 * por descarte). `undefined` si falta el header, no empieza con
 * `"Bearer "`, o el token queda vacío tras el prefijo.
 */
function extraerBearerToken(req: WebRequest): string | undefined {
  const headerValue = firstHeaderValue(req.headers.authorization);
  if (typeof headerValue !== "string" || !headerValue.startsWith(BEARER_PREFIJO)) {
    return undefined;
  }
  const token = headerValue.slice(BEARER_PREFIJO.length);
  return token === "" ? undefined : token;
}

/** Resultado de `resolverSesionDesdeRequest`: la sesión resuelta junto con el token crudo que la resolvió. */
interface SesionResuelta {
  readonly sesion: SesionEmpleado;
  readonly token: string;
}

/**
 * Resuelve la `SesionEmpleado` de un `POST /operaciones` a partir de su
 * header `Authorization`, junto con el `token` crudo ya extraído --
 * corrección sobre el hallazgo Reviewer #5 (bajo): antes el caller
 * (`handleOperaciones`) volvía a llamar `extraerBearerToken(req)` para
 * resolver `conversacionStore.paraSesion`, duplicando el parseo del bearer
 * token y forzando un `as string` porque esta función no exponía el token.
 * `undefined` en CUALQUIERA de: header ausente, token sin coincidencia en
 * `sesionStore`, o sesión vencida -- los tres casos son indistinguibles
 * desde acá (mismo criterio que `SesionEmpleadoStore.buscar`, ADR 173 pto 4).
 */
function resolverSesionDesdeRequest(
  req: WebRequest,
  sesionStore: SesionEmpleadoStore,
): SesionResuelta | undefined {
  const token = extraerBearerToken(req);
  if (token === undefined) {
    return undefined;
  }
  const sesion = sesionStore.buscar(token);
  if (sesion === undefined) {
    return undefined;
  }
  return { sesion, token };
}

/**
 * `path.slice(RUTA_CONFIRMAR_PREFIJO.length)`, `decodeURIComponent`
 * envuelto en `try/catch` (una secuencia `%` inválida lanza `URIError`).
 * `undefined` si queda vacío, contiene `/`, o excede 200 caracteres — el
 * caller cae en la misma página genérica en cualquiera de estos casos.
 */
function extraerToken(path: string): string | undefined {
  const crudo = path.slice(RUTA_CONFIRMAR_PREFIJO.length);
  let token: string;
  try {
    token = decodeURIComponent(crudo);
  } catch {
    return undefined;
  }
  if (token === "" || token.includes("/") || token.length > 200) {
    return undefined;
  }
  return token;
}

/** JSON `Content-Type: application/json` (decisión menor, no exigido literal para JSON — ver reporte). */
function respondJson(res: WebResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * `Cache-Control: no-store` + `X-Request-Id` -- compartido por `respondHtml`,
 * `respondAsset` y `handleLogout` (`chat-web-empleado`, hallazgo Reviewer #1:
 * extraído para no repetir el par en cada función que responde).
 */
function aplicarHeadersNoStore(res: WebResponse, requestId: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);
}

/** Headers de toda respuesta HTML (ADR 20, punto 5): Content-Type, Cache-Control, Referrer-Policy, X-Request-Id. */
function respondHtml(res: WebResponse, status: number, html: string, requestId: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  aplicarHeadersNoStore(res, requestId);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(html);
}

/** LA página genérica de indistinguibilidad (R6): un solo cuerpo, byte a byte idéntico, para las 4 filas en negrita de la tabla. */
function respondLinkInvalido(res: WebResponse, requestId: string): void {
  respondHtml(res, 404, renderLinkInvalidoHtml(), requestId);
}

/**
 * `Content-Security-Policy` + `X-Content-Type-Options: nosniff` --
 * compartido por `respondHtmlChat` y `respondAsset` (`chat-web-empleado`,
 * hallazgo Reviewer #1). Extraído para no repetir el par literal en las dos
 * funciones que sirven contenido de `/chat/*`.
 */
function aplicarHeadersSeguridadChat(res: WebResponse): void {
  res.setHeader("Content-Security-Policy", CSP_CHAT);
  res.setHeader("X-Content-Type-Options", "nosniff");
}

/**
 * Helper HERMANO de `respondHtml` (`chat-web-empleado`, ADR 199 pto 2) --
 * **delega en `respondHtml` SIN modificarlo** y suma `Content-Security-Policy`
 * y `X-Content-Type-Options: nosniff`. Modificar `respondHtml` directamente
 * le pondría CSP a `GET /confirmar/:token`, que tiene `<form>` y por lo
 * tanto `form-action 'none'` lo rompería (ADR 192 pto 5 lo excluye
 * explícitamente). Punto obligatorio 6.
 *
 * CORRECCIÓN (hallazgo Reviewer #1, CRÍTICO): los headers propios se setean
 * ANTES de delegar en `respondHtml` -- que es quien llama `res.end()`.
 * Setearlos DESPUÉS de `respondHtml(...)` (como estaba) es setear headers
 * después de `end()`, que contra un `http.ServerResponse` real lanza
 * `ERR_HTTP_HEADERS_SENT`.
 */
function respondHtmlChat(res: WebResponse, html: string, requestId: string): void {
  aplicarHeadersSeguridadChat(res);
  respondHtml(res, 200, html, requestId);
}

/**
 * Sirve `CHAT_CLIENT_JS`/`CHAT_CSS` -- `string` en memoria, **cero `fs`** en
 * el camino de request (ADR 200 pto 1). Mismos dos headers de seguridad que
 * `respondHtmlChat`, más `Cache-Control: no-store` y `X-Request-Id` (ADR
 * 201, tabla de rutas).
 */
function respondAsset(res: WebResponse, contenido: string, contentType: string, requestId: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  aplicarHeadersSeguridadChat(res);
  aplicarHeadersNoStore(res, requestId);
  res.end(contenido);
}

type LecturaCuerpo =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly motivo: "tamano" | "error-transporte" };

/**
 * Envuelve `leerBody` con el tope de `config.maxBodyBytes`. El corte por
 * tamaño (`motivo: "tamano"`) es un evento de TRANSPORTE, propio de
 * `server.ts` (no del handler de negocio) — responde `413` + `destroy()` acá
 * mismo y loguea `web-rechazado-tamano`, para las CUATRO rutas que aceptan
 * body, no solo `/ventas` (decisión — ver reporte). El caller decide qué
 * hacer con `motivo: "error-transporte"`, porque cada ruta responde en un
 * formato distinto (JSON vs. HTML).
 */
async function leerCuerpoConTope(
  req: WebRequest,
  res: WebResponse,
  config: WebConfig,
  requestId: string,
  ruta: string,
  logEvent: LogEventFn,
): Promise<LecturaCuerpo> {
  const resultado = await leerBody(req, config.maxBodyBytes);
  if (!resultado.ok && resultado.motivo === "tamano") {
    res.statusCode = 413;
    res.end();
    req.destroy();
    logEvent(requestId, "web-rechazado-tamano", { ruta });
  }
  return resultado;
}

/** `POST /ventas`. */
async function handleAltaVenta(
  req: WebRequest,
  res: WebResponse,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, onAltaVenta, logEvent } = deps;

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_VENTAS, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      logEvent(requestId, "web-payload-invalido", { motivo: "error-transporte" });
      respondJson(res, 400, { error: "error de transporte" });
    }
    return;
  }

  if (!esAutorizado(req, config.ventasApiToken)) {
    logEvent(requestId, "web-no-autorizado", {});
    respondJson(res, 401, { error: "no autorizado" });
    return;
  }

  const jsonResult = parseJsonBody(lectura.body);
  if (!jsonResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: jsonResult.motivo });
    respondJson(res, 400, { error: jsonResult.motivo });
    return;
  }

  const payloadResult = parseAltaVentaPayload(jsonResult.valor);
  if (!payloadResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: payloadResult.motivo });
    respondJson(res, 400, { error: payloadResult.motivo });
    return;
  }

  try {
    const resultado = await onAltaVenta(payloadResult.valor);
    respondJson(res, 201, {
      ventaId: resultado.ventaId,
      casoId: resultado.casoId,
      linkConfirmacion: resultado.linkConfirmacion,
      notificado: resultado.notificado,
    });
  } catch {
    logEvent(requestId, "web-handler-fallido", {});
    respondJson(res, 500, { error: "error interno" });
  }
}

/** `GET /confirmar/:token`. */
async function handleConsultaVenta(
  res: WebResponse,
  path: string,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const token = extraerToken(path);
  if (token === undefined) {
    respondLinkInvalido(res, requestId);
    return;
  }

  try {
    const venta = await deps.onConsultaVenta(token);
    if (venta === undefined) {
      respondLinkInvalido(res, requestId);
      return;
    }
    respondHtml(res, 200, renderConfirmacionHtml(venta, token), requestId);
  } catch {
    deps.logEvent(requestId, "web-handler-fallido", {});
    // Sin plantilla de "error interno" en `render.ts` (ADR 13/16: no se
    // toca ese archivo) — reusa el cuerpo genérico pero con status 500,
    // distinto de las 4 filas en negrita (404). Ver reporte.
    respondHtml(res, 500, renderLinkInvalidoHtml(), requestId);
  }
}

/** `POST /confirmar/:token`. */
async function handleDecisionVenta(
  req: WebRequest,
  res: WebResponse,
  path: string,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, logEvent } = deps;

  const token = extraerToken(path);
  if (token === undefined) {
    respondLinkInvalido(res, requestId);
    return;
  }

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_CONFIRMAR_PREFIJO, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      respondLinkInvalido(res, requestId);
    }
    return;
  }

  const campos = new URLSearchParams(lectura.body.toString("utf8"));
  const decisionResult = parseDecisionForm(campos);
  if (!decisionResult.ok) {
    respondLinkInvalido(res, requestId);
    return;
  }

  try {
    const resultado = await deps.onDecisionVenta({ token, decision: decisionResult.valor });
    if (resultado.resultado === "confirmada") {
      respondHtml(res, 200, renderResultadoHtml("confirmada"), requestId);
      return;
    }
    if (resultado.resultado === "rechazada") {
      respondHtml(res, 200, renderResultadoHtml("rechazada"), requestId);
      return;
    }
    respondLinkInvalido(res, requestId);
  } catch {
    logEvent(requestId, "web-handler-fallido", {});
    respondHtml(res, 500, renderLinkInvalidoHtml(), requestId);
  }
}

/** `POST /devolucion`. */
async function handleDevolucion(
  req: WebRequest,
  res: WebResponse,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, logEvent } = deps;

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_DEVOLUCION, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      logEvent(requestId, "web-payload-invalido", { motivo: "error-transporte" });
      respondJson(res, 400, { error: "error de transporte" });
    }
    return;
  }

  const jsonResult = parseJsonBody(lectura.body);
  if (!jsonResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: jsonResult.motivo });
    respondJson(res, 400, { error: jsonResult.motivo });
    return;
  }

  const payloadResult = parseDevolucionPayload(jsonResult.valor);
  if (!payloadResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: payloadResult.motivo });
    respondJson(res, 400, { error: payloadResult.motivo });
    return;
  }

  try {
    const resultado = await deps.onDevolucion(payloadResult.valor);
    if (resultado.resultado === "reembolsada") {
      respondJson(res, 200, { resultado: "reembolsada" });
      return;
    }
    if (resultado.resultado === "escalada") {
      respondJson(res, 200, { resultado: "escalada" });
      return;
    }
    respondJson(res, 404, { resultado: "no_aplicable" });
  } catch {
    logEvent(requestId, "web-handler-fallido", {});
    respondJson(res, 500, { error: "error interno" });
  }
}

type TurnoResultado =
  | { readonly estado: "resuelto"; readonly valor: SoporteResult }
  | { readonly estado: "rechazado" }
  | { readonly estado: "timeout" };

/** `POST /soporte`. Carrera contra `SOPORTE_TIMEOUT_MS` — el turno en sí sigue vivo para el drenaje de `startServer` aunque la request ya haya respondido `504`. */
async function handleSoporte(
  req: WebRequest,
  res: WebResponse,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, logEvent } = deps;

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_SOPORTE, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      logEvent(requestId, "web-payload-invalido", { motivo: "error-transporte" });
      respondJson(res, 400, { error: "error de transporte" });
    }
    return;
  }

  const jsonResult = parseJsonBody(lectura.body);
  if (!jsonResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: jsonResult.motivo });
    respondJson(res, 400, { error: jsonResult.motivo });
    return;
  }

  const payloadResult = parseSoportePayload(jsonResult.valor);
  if (!payloadResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: payloadResult.motivo });
    respondJson(res, 400, { error: payloadResult.motivo });
    return;
  }

  const turno = deps.onSoporte(payloadResult.valor);
  // `.then(onFulfilled, onRejected)` sobre `turno` en vez de un `.catch`
  // separado: maneja el rechazo en la MISMA promesa que compite en la
  // carrera, así no queda una rama sin manejar si `turno` rechaza después
  // de que el timeout ya ganó la carrera.
  const resultado = await Promise.race<TurnoResultado>([
    turno.then(
      (valor): TurnoResultado => ({ estado: "resuelto", valor }),
      (): TurnoResultado => ({ estado: "rechazado" }),
    ),
    new Promise<TurnoResultado>((resolve) => {
      setTimeout(() => resolve({ estado: "timeout" }), SOPORTE_TIMEOUT_MS);
    }),
  ]);

  if (resultado.estado === "timeout") {
    logEvent(requestId, "soporte-timeout", {});
    respondJson(res, 504, { error: "tiempo de espera excedido" });
    return;
  }
  if (resultado.estado === "rechazado") {
    logEvent(requestId, "soporte-turno-fallido", {});
    respondJson(res, 502, { error: "error interno" });
    return;
  }

  respondJson(res, 200, { casoId: resultado.valor.casoId, respuesta: resultado.valor.respuesta });
}

/**
 * `POST /login` (`operaciones-negocio-conversacionales`, ADR 173 pto 2,
 * tarea 9). Credenciales inválidas ⇒ `401` con el MISMO mensaje genérico
 * indistinguible que ya usa la TUI (ADR 30, `build-on-comando-empleado.ts`'s
 * `manejarLogin`: `"Credenciales inválidas."`) -- no se filtra por HTTP una
 * distinción que el núcleo ya decidió ocultar.
 */
async function handleLogin(
  req: WebRequest,
  res: WebResponse,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, logEvent } = deps;

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_LOGIN, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      logEvent(requestId, "web-payload-invalido", { motivo: "error-transporte" });
      respondJson(res, 400, { error: "error de transporte" });
    }
    return;
  }

  const jsonResult = parseJsonBody(lectura.body);
  if (!jsonResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: jsonResult.motivo });
    respondJson(res, 400, { error: jsonResult.motivo });
    return;
  }

  const payloadResult = parseLoginPayload(jsonResult.valor);
  if (!payloadResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: payloadResult.motivo });
    respondJson(res, 400, { error: payloadResult.motivo });
    return;
  }

  try {
    const resultado = await deps.onLogin(payloadResult.valor);
    if (!resultado.ok) {
      logEvent(requestId, "web-no-autorizado", {});
      respondJson(res, 401, { error: "Credenciales inválidas." });
      return;
    }
    respondJson(
      res,
      200,
      resultado.expiraEn !== undefined
        ? { token: resultado.token, expiraEn: resultado.expiraEn }
        : { token: resultado.token },
    );
  } catch {
    logEvent(requestId, "web-handler-fallido", {});
    respondJson(res, 500, { error: "error interno" });
  }
}

/**
 * `POST /operaciones` (`operaciones-negocio-conversacionales`, ADR 172/173,
 * tarea 9) -- ★ riesgo dominante R1. Orden EXHAUSTIVO, no se reordena (mismo
 * criterio que el resto del archivo): tope de body → auth por sesión
 * (`resolverSesionDesdeRequest`, NUNCA por el body) → parseo → handler.
 * `empleadoId` SIEMPRE sale de la `sesion` resuelta por el store -- nunca
 * del body del request, ni siquiera si el body lo incluyera. Sin sesión
 * vigente, `onOperacionesEmpleado` JAMÁS se invoca -- eso es lo que blinda
 * este handler contra R1.
 */
async function handleOperaciones(
  req: WebRequest,
  res: WebResponse,
  requestId: string,
  deps: WebServerDeps,
): Promise<void> {
  const { config, logEvent, sesionStore, confirmacionOperacionesStore, conversacionStore } = deps;

  const lectura = await leerCuerpoConTope(req, res, config, requestId, RUTA_OPERACIONES, logEvent);
  if (!lectura.ok) {
    if (lectura.motivo === "error-transporte") {
      logEvent(requestId, "web-payload-invalido", { motivo: "error-transporte" });
      respondJson(res, 400, { error: "error de transporte" });
    }
    return;
  }

  const resuelto = resolverSesionDesdeRequest(req, sesionStore);
  if (resuelto === undefined) {
    logEvent(requestId, "web-no-autorizado", {});
    respondJson(res, 401, { error: "no autorizado" });
    return;
  }
  const { sesion, token } = resuelto;

  const jsonResult = parseJsonBody(lectura.body);
  if (!jsonResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: jsonResult.motivo });
    respondJson(res, 400, { error: jsonResult.motivo });
    return;
  }

  const payloadResult = parseOperacionesPayload(jsonResult.valor);
  if (!payloadResult.ok) {
    logEvent(requestId, "web-payload-invalido", { motivo: payloadResult.motivo });
    respondJson(res, 400, { error: payloadResult.motivo });
    return;
  }

  // `confirmacion` sale de la ranura POR EMPLEADO (ADR 173 pto 4) -- nunca
  // del slot único de la TUI, y siempre resuelta ANTES de invocar el turno
  // (reconciliación 2 de `tasks.md`).
  const confirmacion = confirmacionOperacionesStore.paraEmpleado(sesion.empleadoId);
  // `conversacion` sale de la ranura POR TOKEN (ADR 196 §2.1 -- NUNCA por
  // `empleadoId` ni por ningún campo del body), simétrica a la resolución
  // de `confirmacion` de arriba. `token` ya salió de `resolverSesionDesdeRequest`
  // -- no se vuelve a parsear el bearer token (hallazgo Reviewer #5).
  const conversacion = conversacionStore.paraSesion(token);

  const turno = deps.onOperacionesEmpleado({
    consulta: payloadResult.valor.consulta,
    sesion,
    confirmacion,
    conversacion,
  });
  // Misma carrera contra timeout que `handleSoporte`, con su propia
  // constante independiente (`OPERACIONES_TIMEOUT_MS`, ADR 173 pto 3).
  const resultado = await Promise.race<TurnoResultado>([
    turno.then(
      (valor): TurnoResultado => ({ estado: "resuelto", valor }),
      (): TurnoResultado => ({ estado: "rechazado" }),
    ),
    new Promise<TurnoResultado>((resolve) => {
      setTimeout(() => resolve({ estado: "timeout" }), OPERACIONES_TIMEOUT_MS);
    }),
  ]);

  if (resultado.estado === "timeout") {
    logEvent(requestId, "operaciones-timeout", {});
    respondJson(res, 504, { error: "tiempo de espera excedido" });
    return;
  }
  if (resultado.estado === "rechazado") {
    logEvent(requestId, "operaciones-turno-fallido", {});
    respondJson(res, 502, { error: "error interno" });
    return;
  }

  // ADR 197 pto 3 -- traza de rotación de la conversación, SIN el token
  // (ADR 193 pto 3): un `conversacionId` distinto entre dos mensajes es la
  // evidencia de que la conversación rotó. Nota de desviación: `design.md`
  // §3 pto 3 menciona también un campo `turnos`, pero `ConversacionEmpleadoPort`
  // (§13, tarea 1) no lo expone -- se omite acá en vez de inventar un valor
  // que el puerto no puede dar.
  logEvent(resultado.valor.casoId, "operaciones-conversacion", {
    conversacionId: conversacion.conversacionId(),
  });
  respondJson(res, 200, { casoId: resultado.valor.casoId, respuesta: resultado.valor.respuesta });
}

/**
 * `POST /logout` (`chat-web-empleado`, ADR 201 pto 4-7, ADR 202). Inversa de
 * `/login`, en la raíz, no bajo `/chat/`. SIEMPRE responde `204` sin body —
 * token válido, vencido, inexistente o ausente son indistinguibles desde
 * afuera (mismo criterio que `SesionEmpleadoStore.buscar`,
 * `sesion-empleado-store.ts:13-16`). No lee el body (no hace falta
 * `leerCuerpoConTope`) pero igual lo drena (`req.resume()`) antes de
 * responder, para no dejar el socket a medio consumir.
 *
 * Orden de composición EXACTO, no se reordena (ADR 202 pto 2): el
 * `empleadoId` sólo se puede leer mientras la sesión existe, por eso
 * `confirmacionOperacionesStore` se consulta ANTES de `sesionStore.eliminar`
 * -- `sesionStore.buscar` (sin borrar todavía) → `confirmacion
 * OperacionesStore.limpiarEmpleado(empleadoId)` (si había sesión Y ninguna
 * OTRA sesión vigente del mismo empleado, ver abajo) → `conversacionStore.
 * eliminar` → `sesionStore.eliminar`. El handler compone; ningún store llama
 * a otro.
 *
 * ★ `aprobacion-conversacional-hitl` (ADR 214 pto 4, R12): con la ranura
 * multi-slot, `limpiarEmpleado` reemplaza al `paraEmpleado(...).consumir()`
 * de una sola ranura -- borra TODAS las confirmaciones pendientes del
 * empleado (reembolso, solicitud, cancelación), no sólo la última invocada.
 * El orden de composición no cambió: cambia una llamada, no la secuencia.
 *
 * Nota deliberada (hallazgo Reviewer 2da ronda #4): NO usa
 * `resolverSesionDesdeRequest` -- a diferencia de `handleOperaciones`, este
 * handler necesita el token CRUDO incluso cuando `sesionStore.buscar` no
 * encuentra sesión (token vencido pero todavía presente en el `Map`), para
 * poder limpiar `conversacionStore`/`sesionStore` de esa entrada
 * (`conversacionStore.eliminar(token)`/`sesionStore.eliminar(token)` se
 * llaman igual en ese caso -- test "token inexistente" de este describe).
 * `resolverSesionDesdeRequest` devuelve `undefined` en ese mismo caso y
 * descarta el token junto con la sesión, así que reusarlo acá perdería esa
 * limpieza. Mantener la extracción manual es la única forma de no
 * regresionar ese comportamiento ya cubierto por test.
 *
 * Hallazgo Reviewer 2da ronda #1 (CRÍTICO): `confirmacionOperacionesStore`
 * está keyeada por `empleadoId`, no por sesión -- si el empleado tiene OTRA
 * sesión vigente además de la que se está cerrando, NO se consume su
 * confirmación (podría estar en curso desde esa otra sesión). Las dos
 * últimas líneas (`conversacionStore.eliminar`/`sesionStore.eliminar`, que
 * sí son por token) se ejecutan siempre igual.
 */
function handleLogout(req: WebRequest, res: WebResponse, requestId: string, deps: WebServerDeps): void {
  const { sesionStore, confirmacionOperacionesStore, conversacionStore } = deps;

  req.resume();

  const token = extraerBearerToken(req);
  if (token !== undefined) {
    const sesion = sesionStore.buscar(token);
    if (sesion !== undefined && !sesionStore.otraSesionVigente(sesion.empleadoId, token)) {
      confirmacionOperacionesStore.limpiarEmpleado(sesion.empleadoId);
    }
    conversacionStore.eliminar(token);
    sesionStore.eliminar(token);
  }

  res.statusCode = 204;
  aplicarHeadersNoStore(res, requestId);
  res.end();
}

/**
 * El listener HTTP, aislado del ciclo de vida del servidor para poder
 * testear cada respuesta con dobles planos.
 *
 * Ruteo por combinación exacta `método+ruta` — cualquier otra combinación
 * (incluida una ruta reconocida con un método que no le corresponde) cae en
 * el `404` vacío del final ("ruta no reconocida", primera fila de la tabla).
 */
export function createRequestListener(deps: WebServerDeps): (req: WebRequest, res: WebResponse) => void {
  return (req: WebRequest, res: WebResponse): void => {
    const requestId = deps.newRequestId?.() ?? randomUUID();
    const path = pathFromUrl(req.url);
    const method = req.method;

    if (method === "POST" && path === RUTA_VENTAS) {
      void handleAltaVenta(req, res, requestId, deps);
      return;
    }
    if (method === "GET" && path.startsWith(RUTA_CONFIRMAR_PREFIJO)) {
      void handleConsultaVenta(res, path, requestId, deps);
      return;
    }
    if (method === "POST" && path.startsWith(RUTA_CONFIRMAR_PREFIJO)) {
      void handleDecisionVenta(req, res, path, requestId, deps);
      return;
    }
    if (method === "POST" && path === RUTA_DEVOLUCION) {
      void handleDevolucion(req, res, requestId, deps);
      return;
    }
    if (method === "POST" && path === RUTA_SOPORTE) {
      void handleSoporte(req, res, requestId, deps);
      return;
    }
    if (method === "POST" && path === RUTA_LOGIN) {
      void handleLogin(req, res, requestId, deps);
      return;
    }
    if (method === "POST" && path === RUTA_OPERACIONES) {
      void handleOperaciones(req, res, requestId, deps);
      return;
    }
    // `chat-web-empleado`, ADR 201 pto 3: en la raíz, no bajo `/chat/`.
    if (method === "POST" && path === RUTA_LOGOUT) {
      handleLogout(req, res, requestId, deps);
      return;
    }
    // `chat-web-empleado`, tarea 10 (ADR 199, ADR 201): las tres rutas del
    // chat son PÚBLICAS -- sin sesión, sin dato de negocio, idénticas para
    // cualquier solicitante.
    if (method === "GET" && path === RUTA_CHAT) {
      respondHtmlChat(res, renderChatHtml(), requestId);
      return;
    }
    if (method === "GET" && path === RUTA_CHAT_SCRIPT) {
      respondAsset(res, CHAT_CLIENT_JS, "application/javascript; charset=utf-8", requestId);
      return;
    }
    if (method === "GET" && path === RUTA_CHAT_ESTILOS) {
      respondAsset(res, CHAT_CSS, "text/css; charset=utf-8", requestId);
      return;
    }

    res.statusCode = 404;
    res.end();
  };
}

/**
 * Monta el listener sobre un servidor HTTP. `createServer` se inyecta
 * (default: `http.createServer` real) para que ningún test del suite por
 * defecto abra un puerto.
 *
 * Igual que `webhooks/server.ts:254`: `listen` + `on("error")` con promesa.
 * El `Set<Promise<unknown>>` de drenaje trackea los turnos de `/soporte` Y
 * de `/operaciones` en vuelo, compartiendo el MISMO `Set` (no las otras
 * rutas — son todas síncronas del lado del `store` salvo la notificación
 * best-effort de `/ventas`, que ya corrió cuando `onAltaVenta` resuelve).
 * `close()` hace `server.close()` → `Promise.allSettled([...enVuelo])` en
 * carrera contra `WEB_CLOSE_TIMEOUT_MS` → resuelve. Nunca rechaza.
 */
export function startServer(
  deps: WebServerDeps,
  createServer: CreateWebServerFn = (listener) =>
    createHttpServer((req, res) => listener(req as unknown as WebRequest, res)),
): Promise<WebServerHandle> {
  const enVuelo = new Set<Promise<unknown>>();

  // `createRequestListener` no conoce el `Set` de drenaje (mismo criterio
  // que `webhooks/server.ts`, design.md §4.4: firma de dos parámetros sin
  // estado de ciclo de vida). `startServer` envuelve `onSoporte` para
  // registrar cada turno en vuelo antes de pasarlo al listener.
  const onSoporteConDrenaje = (input: { readonly consulta: string }): Promise<SoporteResult> => {
    const promesa = deps.onSoporte(input);
    enVuelo.add(promesa);
    const olvidar = (): void => {
      enVuelo.delete(promesa);
    };
    promesa.then(olvidar, olvidar);
    return promesa;
  };

  // Hallazgo del Reviewer (`operaciones-negocio-conversacionales`): los
  // turnos de `/operaciones` corren la MISMA carrera de shutdown que los de
  // `/soporte` (una escritura sincrónica de better-sqlite3 que llegue
  // después de `db.close()` en `main.ts` puede pegarle a una DB ya
  // cerrada) -- comparten el MISMO `enVuelo` de arriba, no uno nuevo, así
  // `close()` drena ambos tipos de turno indistintamente.
  const onOperacionesEmpleadoConDrenaje: WebServerDeps["onOperacionesEmpleado"] = (input) => {
    const promesa = deps.onOperacionesEmpleado(input);
    enVuelo.add(promesa);
    const olvidar = (): void => {
      enVuelo.delete(promesa);
    };
    promesa.then(olvidar, olvidar);
    return promesa;
  };

  const listener = createRequestListener({
    ...deps,
    onSoporte: onSoporteConDrenaje,
    onOperacionesEmpleado: onOperacionesEmpleadoConDrenaje,
  });
  const server = createServer(listener);

  return new Promise((resolve, reject) => {
    let settled = false;

    server.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    server.listen(deps.config.port, () => {
      if (settled) {
        return;
      }
      settled = true;

      const handle: WebServerHandle = {
        port: deps.config.port,
        close(): Promise<void> {
          return new Promise((resolveClose) => {
            server.close(() => {
              const drenaje = Promise.allSettled([...enVuelo]).then(() => undefined);
              const timeout = new Promise<"timeout">((resolveTimeout) => {
                setTimeout(() => resolveTimeout("timeout"), WEB_CLOSE_TIMEOUT_MS);
              });

              void Promise.race([drenaje.then(() => "drenado" as const), timeout]).then((resultado) => {
                if (resultado === "timeout") {
                  deps.logEvent(WEB_LOG_CORRELATION_ID, "web-cierre-con-turnos-en-vuelo", {
                    enVuelo: enVuelo.size,
                  });
                }
                resolveClose();
              });
            });
          });
        },
      };

      resolve(handle);
    });
  });
}
