/**
 * Listener HTTP del Servidor A2A entrante (Hito 7, tareas 8-13, design.md
 * §6.3 — partes 1a, 1b, 1c, 2b y 2c: tipos + auth + body + ruteo por
 * método+ruta + Agent Card + sobre JSON-RPC + los cinco errores base + el
 * despacho REAL de los tres métodos (`SendMessage`/`GetTask`/`CancelTask`,
 * ADR 94, ADR 100) + `startServer` con el tope de turnos en vuelo, el
 * drenaje al cerrar y el puerto efectivo (ADR 99, ADR 101). El `hayCupo:
 * true` fijo que ve `handleSolicitudJsonRpc` es sólo el valor por defecto
 * cuando `createRequestListener` se invoca directo (sin pasar por
 * `startServer`, p. ej. en los tests de las tareas 8-12): `startServer`
 * envuelve `deps.onSolicitudA2A` y sobrescribe ese campo con el valor real
 * (tarea 13, ADR 99 pto 3) antes de que el composition root lo vea.
 *
 * Recorte estructural DUPLICADO a propósito de `web/http.ts` y
 * `webhooks/server.ts:30-51` (ADR 13 — **tercer servidor HTTP de la misma
 * familia**): los tipos reales de `node:http` los satisfacen
 * estructuralmente, así que producción pasa los objetos reales y los tests
 * pasan dobles planos SIN abrir ningún puerto ni mockear `node:http`.
 * Importarlos de `web/`/`webhooks/` sería un adaptador dependiendo de otro
 * (regla no negociable de `AGENTS.md`).
 *
 * Única pieza NUEVA respecto de `WebRequest`/`WebhookRequest`:
 * `A2ARequest.socket?.remoteAddress` — la única fuente de `origen_transporte`
 * (ADR 89 pto 3, design.md §6.3).
 *
 * `esAutorizado` es un calco EXACTO de `web/server.ts:113-132`, con las dos
 * trampas que el repo ya pagó y documentó: `token === "" ⇒ false` **sin
 * comparar nada** (nunca "abierta por defecto"), y chequeo de longitud
 * **ANTES** de `timingSafeEqual` (que lanza `RangeError` con buffers de
 * largo distinto).
 *
 * `createRequestListener` gana en la tarea 9 el ruteo por `método+ruta`
 * (orden EXHAUSTIVO, no se reordena: `método+ruta → tope de body → AUTH →
 * parseo JSON-RPC → despacho`, design.md §6.3): `GET RUTA_AGENT_CARD`,
 * público, sin auth (ADR 88 pto 5), y cualquier `método+ruta` no reconocido
 * ⇒ `404` vacío (molde `web/server.ts:486`). La tarea 10 agrega
 * `POST RUTA_JSONRPC`: tope de body → AUTH → parseo del sobre JSON-RPC →
 * ruteo por `method` → placeholder `-32603` para los tres métodos
 * soportados. El despacho real de esos tres métodos llega en la tarea 12,
 * sin reabrir esta.
 */
import { createServer as createHttpServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  TASK_STATE_CANCELED,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_REJECTED,
  TASK_STATE_SUBMITTED,
} from "../../core/agents/a2a-contract.js";
import { construirAgentCard } from "./agent-card.js";
import {
  A2A_CLOSE_TIMEOUT_MS,
  A2A_ERROR_TASK_NOT_CANCELABLE,
  A2A_ERROR_TASK_NOT_FOUND,
  A2A_SERVER_LOG_CORRELATION_ID,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  METODO_CANCEL_TASK,
  METODO_GET_TASK,
  METODO_SEND_MESSAGE,
  RUTA_AGENT_CARD,
  RUTA_JSONRPC,
  type A2AServerConfig,
} from "./server-config.js";

export interface A2ARequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** ★ NUEVO respecto de `WebRequest`/`WebhookRequest`: única fuente de `origen_transporte` (ADR 89 pto 3). */
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface A2AResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface A2AHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  /** ★ NUEVO respecto de los otros dos: puerto EFECTIVO con `listen(0)` (ADR 101). */
  address(): { readonly port: number } | string | null;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateA2AServerFn = (
  listener: (req: A2ARequest, res: A2AResponse) => void,
) => A2AHttpServerLike;

/**
 * Vista mínima de una fila de `solicitudes_a2a_entrantes` (design.md §7.2,
 * tarea 7) que `construirTask` necesita para armar el `Task` de respuesta
 * (Hito 7, tarea 11, ADR 93). `estado` es el vocabulario `TASK_STATE_*`
 * CRUDO tal cual se persiste (nunca traducido) — mismo criterio que
 * `SolicitudA2AEntranteRow.estado` en `repository.ts`. `contextId` llega YA
 * RESUELTO por quien arma esta vista (`onConsultarTarea`, Hito 7 tarea 15):
 * `casoId ?? a2aTaskId` se calcula ahí, no acá — `construirTask` sólo copia
 * el valor tal cual (design.md líneas 648-654, ajuste post-checkpoint sobre
 * tarea 11). `resultado` ausente cuando la fila no tiene caso completado
 * (única fila sin caso: `REJECTED`, ADR 90 pto 4) o no completó todavía.
 */
export interface SolicitudA2AEntranteVista {
  readonly a2aTaskId: string;
  readonly contextId: string;
  readonly estado: string;
  readonly resultado?: string | undefined;
  readonly updatedAt: string;
}

/**
 * Input de `SendMessage` hacia el composition root (Hito 7, tarea 12,
 * design.md §6.3). `hayCupo` lo decide `startServer` (tarea 13, ADR 99 pto 3,
 * dueño del contador `enVuelo`) — hasta esa tarea viaja fijo en `true` desde
 * `handleSolicitudJsonRpc`.
 */
export interface SolicitudA2AEntrada {
  readonly a2aTaskId: string;
  readonly texto: string;
  readonly origenTransporte: string;
  readonly hayCupo: boolean;
}

/**
 * Resultado de `onSolicitudA2A` — unión discriminada por `estado` (design.md
 * §6.3, ADR 99 pto 4): la rama `SUBMITTED` trae `turno: Promise<void>` (que
 * `startServer` registra en `enVuelo`, tarea 13); la rama `REJECTED` NO trae
 * ninguno — así es imposible registrar en el `Set` de drenaje un turno que no
 * existe. El tipo lo impide, no un `if`.
 */
export type SolicitudA2AAceptada =
  | {
      readonly estado: "TASK_STATE_SUBMITTED";
      readonly contextId: string;
      readonly updatedAt: string;
      readonly turno: Promise<void>;
    }
  | {
      readonly estado: "TASK_STATE_REJECTED";
      readonly contextId: string;
      readonly updatedAt: string;
    };

/**
 * Resultado de `onCancelarTarea` — unión discriminada por `resultado` (Hito
 * 7, tarea 12, design.md ADR 94 + ADR 100 pto 5): el ADR 94 distingue CUATRO
 * desenlaces que se responden distinto. `"cancelada"`/`"ya-cancelada"`
 * responden con `Task` vía `construirTask(vista)`; `"no-cancelable"` y
 * `"no-encontrada"` son error JSON-RPC y no traen `vista` cuando no hay fila
 * que mostrar.
 */
export type CancelacionA2AResultado =
  | { readonly resultado: "cancelada"; readonly vista: SolicitudA2AEntranteVista }
  | { readonly resultado: "ya-cancelada"; readonly vista: SolicitudA2AEntranteVista }
  | { readonly resultado: "no-cancelable"; readonly vista: SolicitudA2AEntranteVista }
  | { readonly resultado: "no-encontrada" };

interface TaskTextPartJson {
  readonly text: string;
}

interface TaskStatusMessageJson {
  readonly messageId: string;
  readonly parts: readonly [TaskTextPartJson];
}

interface TaskArtifactJson {
  readonly artifactId: string;
  readonly name: string;
  readonly parts: readonly [TaskTextPartJson];
}

interface TaskStatusJson {
  readonly state: string;
  readonly timestamp: string;
  readonly message?: TaskStatusMessageJson;
}

/**
 * Recorte del `Task` del protocolo A2A que este servidor DEVUELVE (design.md
 * §6.3, ADR 93) — sólo los campos que `construirTask` produce y que nuestro
 * propio Cliente A2A (`client.ts:130-134`, `TaskLike`) efectivamente lee:
 * `id`, `contextId`, `status.state`/`status.timestamp`/`status.message`,
 * `artifacts`. Sin `history` (ADR 93 pto 7).
 */
export interface TaskJson {
  readonly id: string;
  readonly contextId: string;
  readonly status: TaskStatusJson;
  readonly artifacts?: readonly [TaskArtifactJson];
}

/**
 * `req.url` recortado en el primer `?` — duplicado a propósito del mismo
 * molde que `web/server.ts:93-99`/`webhooks/server.ts:92-98` (ADR 13).
 */
export function pathFromUrl(url: string | undefined): string {
  if (url === undefined) {
    return "";
  }
  const questionMarkIndex = url.indexOf("?");
  return questionMarkIndex === -1 ? url : url.slice(0, questionMarkIndex);
}

/** Header en array — se toma el primer valor (molde `firstHeaderValue` de `web/`/`webhooks/`). */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Auth del endpoint JSON-RPC: header `Authorization: Bearer <token>`,
 * comparado en tiempo constante. Calco EXACTO de `web/server.ts:113-132`:
 * `token === ""` ⇒ `false` SIN comparar nada (nunca "abierta por defecto");
 * chequeo de longitud ANTES de `timingSafeEqual` (que lanza `RangeError` con
 * buffers de largo distinto).
 */
export function esAutorizado(req: A2ARequest, token: string): boolean {
  if (token === "") {
    return false;
  }

  const headerValue = firstHeaderValue(req.headers.authorization);
  if (typeof headerValue !== "string" || headerValue === "") {
    return false;
  }

  const esperado = `Bearer ${token}`;
  const esperadoBuffer = Buffer.from(esperado, "utf8");
  const actualBuffer = Buffer.from(headerValue, "utf8");

  if (esperadoBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(esperadoBuffer, actualBuffer);
}

export type LecturaCuerpoA2A =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly motivo: "tamano" | "error-transporte" };

/**
 * Acumula el body de `req` en memoria, con tope en `maxBodyBytes`. A
 * diferencia del adaptador Web (`leerBody` en `body.ts`, reusado por cuatro
 * rutas con cuerpo), acá hay **una sola** ruta con body (`POST /a2a`) — un
 * archivo `body.ts` propio para un único llamador sería estructura sin uso
 * (design.md §6.3), así que se reimplementa acá, en esta única función.
 *
 * Al superar el tope, responde `413` y hace `res.end()` **ANTES** de
 * `req.destroy()` — mismo orden exacto que `web/server.ts:198-204` /
 * `webhooks/server.ts:164-169`: `req`/`res` comparten el mismo socket TCP, y
 * destruirlo antes de `res.end()` podría matar la conexión antes de que el
 * cliente reciba el `413`.
 *
 * Nunca llama a ningún callback de negocio: esta función no conoce
 * `A2AServerDeps` — el ruteo que la invoca (tarea 9) es quien decide qué
 * pasa después de una lectura `ok: true`.
 */
export function leerCuerpoConTope(
  req: A2ARequest,
  res: A2AResponse,
  maxBodyBytes: number,
): Promise<LecturaCuerpoA2A> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > maxBodyBytes) {
        settled = true;
        res.statusCode = 413;
        res.end();
        req.destroy();
        resolve({ ok: false, motivo: "tamano" });
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: false, motivo: "error-transporte" });
    });

    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: true, body: Buffer.concat(chunks) });
    });
  });
}

/**
 * Dependencias de `createRequestListener` (Hito 7, tarea 12, design.md §6.3)
 * — molde de `WebServerDeps`/`WebhookServerDeps`. Los tres callbacks llegan
 * YA CERRADOS sobre `db` desde el composition root (`build-on-a2a-entrante.ts`,
 * tarea 15) — `server.ts` NO importa `repository.ts` (ADR 102 pto 1, regla no
 * negociable de `AGENTS.md`: ningún adaptador se comunica con otro).
 * `onConsultarTarea`/`onCancelarTarea` son SÍNCRONAS por firma (ADR 100): sin
 * `Promise` en su tipo de retorno, un `await` a un modelo adentro de esas dos
 * ramas del dispatcher es un error de COMPILACIÓN, no de criterio.
 */
export interface A2AServerDeps {
  readonly config: A2AServerConfig;
  /** Ya cerrado sobre el id de correlación de transporte. Molde `WebhookServerDeps.logEvent`. */
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly onSolicitudA2A: (input: SolicitudA2AEntrada) => Promise<SolicitudA2AAceptada>;
  /** SÍNCRONA (ADR 100): un `SELECT` y nada más. */
  readonly onConsultarTarea: (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined;
  /** SÍNCRONA (ADR 100): un `SELECT` + `UPDATE` guardado, las cuatro ramas del ADR 94. */
  readonly onCancelarTarea: (a2aTaskId: string) => CancelacionA2AResultado;
  /** `randomUUID` en producción; contador determinista en tests. Molde de `newRequestId` (`web/server.ts:81`). */
  readonly newTaskId?: () => string;
}

/** Sobre de error JSON-RPC 2.0 — molde literal de `errorEnvelopeResponse` en `client.test.ts:502`. */
interface JsonRpcErrorEnvelope {
  readonly jsonrpc: "2.0";
  readonly id: unknown;
  readonly error: { readonly code: number; readonly message: string };
}

function respondJsonRpcError(res: A2AResponse, id: unknown, code: number, message: string): void {
  const sobre: JsonRpcErrorEnvelope = { jsonrpc: "2.0", id, error: { code, message } };
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(sobre));
}

/** Sobre de éxito JSON-RPC 2.0 — gemelo de `JsonRpcErrorEnvelope` (Hito 7, tarea 12). */
interface JsonRpcResultEnvelope {
  readonly jsonrpc: "2.0";
  readonly id: unknown;
  readonly result: TaskJson;
}

function respondJsonRpcResult(res: A2AResponse, id: unknown, result: TaskJson): void {
  const sobre: JsonRpcResultEnvelope = { jsonrpc: "2.0", id, result };
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(sobre));
}

/**
 * Sobre de éxito JSON-RPC 2.0 para `SendMessage` — DISTINTO de
 * `JsonRpcResultEnvelope` (usado por `GetTask`/`CancelTask`, donde el `Task`
 * va DIRECTO en `result`). `SendMessageResponse` es un `oneof payload { Task
 * task = 1; Message message = 2; }` REAL del protocolo (verificado contra
 * `specification/a2a.proto` del tag `v1.0.0` de `a2aproject/A2A` — mismo
 * hallazgo que `client.ts:291-303` ya documenta del lado cliente,
 * `parsearSobreDeSendMessage`, y que un sample real confirmó con `curl` en
 * el Hito 6). Encontrado por el test de integración de la tarea 17 (Hito 7)
 * contra el Cliente A2A real: con el `Task` directo en `result` (el bug que
 * este comentario reemplaza), `idDeTarea` nunca ve un `id` y la delegación
 * completa moría con `reason: "protocolo"` sin llegar al loop de `GetTask` —
 * invisible para los dobles unitarios de las tareas 8-12, que sólo leían
 * `sobre.result.status.state` directo, nunca `parsearSobreDeSendMessage` real.
 */
interface JsonRpcSendMessageResultEnvelope {
  readonly jsonrpc: "2.0";
  readonly id: unknown;
  readonly result: { readonly task: TaskJson };
}

function respondJsonRpcSendMessageResult(res: A2AResponse, id: unknown, task: TaskJson): void {
  const sobre: JsonRpcSendMessageResultEnvelope = { jsonrpc: "2.0", id, result: { task } };
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(sobre));
}

/**
 * PURA. Extrae y concatena el texto de `parts[*].text` de un `SendMessage`
 * entrante (Hito 7, tarea 12, design.md ADR 102 pto 3-4). Gemela
 * DELIBERADAMENTE separada de `concatenarPartesDeTexto` (`client.ts:362-377`,
 * que hace exactamente este trabajo del lado cliente): el valor entero del
 * test de integración de la tarea 17 es que servidor y cliente sean DOS
 * implementaciones independientes del mismo protocolo — si el servidor
 * reusara el parser del cliente, un bug simétrico en ambos pasaría verde. Ver
 * el comentario gemelo en `client.ts`.
 */
function extraerTextoDePartes(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  const textos: string[] = [];
  for (const parte of parts as readonly unknown[]) {
    if (typeof parte !== "object" || parte === null) {
      continue;
    }
    const { text } = parte as { readonly text?: unknown };
    if (typeof text === "string") {
      textos.push(text);
    }
  }
  return textos.join("");
}

/**
 * `params.message.parts[*].text`, concatenado y no vacío, o `undefined` si
 * `params`/`message`/`parts` están mal formados o el texto concatenado queda
 * en `""` (design.md §6.3, fila `-32602` de `SendMessage`).
 */
function extraerTextoSendMessage(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const { message } = params as { readonly message?: unknown };
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const { parts } = message as { readonly parts?: unknown };
  const texto = extraerTextoDePartes(parts);
  return texto === "" ? undefined : texto;
}

/**
 * `params.id` como string no vacío (sin espacios), o `undefined` — usado por
 * `GetTask`/`CancelTask` (design.md §6.3, fila `-32602` de ambos métodos).
 */
function extraerIdDeParams(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const { id } = params as { readonly id?: unknown };
  return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

/**
 * `sobre` es un objeto (no `null`, no array) con `jsonrpc === "2.0"` y
 * `method` string. Un campo extra/desconocido en el sobre NO lo invalida —
 * sólo se leen estas tres claves (molde `parsearSobreDeTarea`, `client.ts:276-280`).
 */
function esSobreJsonRpcValido(
  sobre: unknown,
): sobre is { readonly id?: unknown; readonly method: string; readonly params?: unknown } {
  if (typeof sobre !== "object" || sobre === null || Array.isArray(sobre)) {
    return false;
  }
  const candidato = sobre as { readonly jsonrpc?: unknown; readonly method?: unknown };
  return candidato.jsonrpc === "2.0" && typeof candidato.method === "string";
}

/**
 * `POST RUTA_JSONRPC` — partes 1c + 2b (tareas 10 y 12, design.md §6.3, orden
 * EXHAUSTIVO `tope de body → AUTH → parseo JSON-RPC → despacho`, ya en marcha
 * desde `método+ruta`, tarea 9).
 *
 * Despacho real de los tres métodos (Hito 7, tarea 12, ADR 94, ADR 100):
 * - `SendMessage`: `params.message.parts[*].text` mal formado ⇒ `-32602`.
 *   `a2aTaskId = deps.newTaskId?.() ?? randomUUID()` (molde `newRequestId`,
 *   `web/server.ts:81`). `hayCupo` viaja FIJO en `true` — el tope real de
 *   turnos en vuelo es la tarea 13 (`startServer`, ADR 99), que inyecta el
 *   valor correcto sin tocar esta rama. Un `onSolicitudA2A` que rechaza ⇒
 *   `-32603`, `a2a-handler-fallido`, NUNCA un stacktrace en el cuerpo.
 * - `GetTask`/`CancelTask`: SÍNCRONOS (ADR 100) — **sin ningún `await`** en
 *   estas dos ramas: la firma de `onConsultarTarea`/`onCancelarTarea` no
 *   devuelve `Promise`, así que un `await` acá sería un error de
 *   COMPILACIÓN, no de criterio. `params.id` mal formado ⇒ `-32602`.
 *   `GetTask` de un id inexistente ⇒ `A2A_ERROR_TASK_NOT_FOUND`. `CancelTask`
 *   despacha las cuatro ramas de `CancelacionA2AResultado` (ADR 94):
 *   `"cancelada"`/`"ya-cancelada"` ⇒ `result` vía `construirTask(vista)`
 *   (idempotente en la segunda, la fila no se toca de nuevo — eso ya lo
 *   garantiza el repositorio, tarea 7); `"no-cancelable"` ⇒
 *   `A2A_ERROR_TASK_NOT_CANCELABLE`; `"no-encontrada"` ⇒
 *   `A2A_ERROR_TASK_NOT_FOUND`. Un handler que lanza (síncrono) ⇒ `-32603`,
 *   `a2a-handler-fallido`.
 */
async function handleSolicitudJsonRpc(
  req: A2ARequest,
  res: A2AResponse,
  deps: A2AServerDeps,
): Promise<void> {
  const { config, logEvent } = deps;
  const origenTransporte = req.socket?.remoteAddress ?? "desconocido";

  const lectura = await leerCuerpoConTope(req, res, config.maxBodyBytes);
  if (!lectura.ok) {
    if (lectura.motivo === "tamano") {
      logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-solicitud-rechazada-tamano", {
        origenTransporte,
        maxBodyBytes: config.maxBodyBytes,
      });
      return;
    }
    // `motivo === "error-transporte"`: `400` vacío, sin log (design.md §6.3, "nada").
    res.statusCode = 400;
    res.end();
    return;
  }

  if (!esAutorizado(req, config.token)) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", "Bearer");
    res.end();
    logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-solicitud-no-autorizada", { origenTransporte });
    return;
  }

  let sobre: unknown;
  try {
    sobre = JSON.parse(lectura.body.toString("utf8"));
  } catch {
    logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-sobre-invalido", { code: JSONRPC_PARSE_ERROR });
    respondJsonRpcError(res, null, JSONRPC_PARSE_ERROR, "JSON invalido");
    return;
  }

  if (!esSobreJsonRpcValido(sobre)) {
    logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-sobre-invalido", { code: JSONRPC_INVALID_REQUEST });
    respondJsonRpcError(res, null, JSONRPC_INVALID_REQUEST, "sobre JSON-RPC invalido");
    return;
  }

  const { id, method, params } = sobre;

  if (method !== METODO_SEND_MESSAGE && method !== METODO_GET_TASK && method !== METODO_CANCEL_TASK) {
    logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-metodo-no-soportado", { method });
    respondJsonRpcError(res, id, JSONRPC_METHOD_NOT_FOUND, `method no soportado: ${method}`);
    return;
  }

  if (method === METODO_SEND_MESSAGE) {
    const texto = extraerTextoSendMessage(params);
    if (texto === undefined) {
      respondJsonRpcError(
        res,
        id,
        JSONRPC_INVALID_PARAMS,
        "params invalidos: message.parts[*].text requerido",
      );
      return;
    }

    const a2aTaskId = deps.newTaskId?.() ?? randomUUID();
    try {
      // `hayCupo: true` es el default de esta llamada directa al listener;
      // `startServer` (tarea 13, ADR 99) sobrescribe el campo con el valor
      // real antes de que `deps.onSolicitudA2A` lo reciba.
      const resultado = await deps.onSolicitudA2A({ a2aTaskId, texto, origenTransporte, hayCupo: true });
      const vista: SolicitudA2AEntranteVista = {
        a2aTaskId,
        contextId: resultado.contextId,
        estado: resultado.estado,
        updatedAt: resultado.updatedAt,
      };
      respondJsonRpcSendMessageResult(res, id, construirTask(vista));
    } catch {
      logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-handler-fallido", { method });
      respondJsonRpcError(res, id, JSONRPC_INTERNAL_ERROR, "error interno");
    }
    return;
  }

  const taskId = extraerIdDeParams(params);
  if (taskId === undefined) {
    respondJsonRpcError(res, id, JSONRPC_INVALID_PARAMS, "params invalidos: id requerido");
    return;
  }

  if (method === METODO_GET_TASK) {
    // SÍNCRONA (ADR 100): ningún `await` entre acá y `res.end()`.
    try {
      const vista = deps.onConsultarTarea(taskId);
      if (vista === undefined) {
        logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-tarea-no-encontrada", { a2aTaskId: taskId });
        respondJsonRpcError(res, id, A2A_ERROR_TASK_NOT_FOUND, "tarea no encontrada");
        return;
      }
      respondJsonRpcResult(res, id, construirTask(vista));
    } catch {
      logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-handler-fallido", { method });
      respondJsonRpcError(res, id, JSONRPC_INTERNAL_ERROR, "error interno");
    }
    return;
  }

  // `method === METODO_CANCEL_TASK` — SÍNCRONA (ADR 100), sin `await` acá tampoco.
  try {
    const resultado = deps.onCancelarTarea(taskId);
    switch (resultado.resultado) {
      case "cancelada":
      case "ya-cancelada":
        respondJsonRpcResult(res, id, construirTask(resultado.vista));
        return;
      case "no-cancelable":
        logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-tarea-no-cancelable", { a2aTaskId: taskId });
        respondJsonRpcError(res, id, A2A_ERROR_TASK_NOT_CANCELABLE, "tarea no cancelable");
        return;
      case "no-encontrada":
        logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-tarea-no-encontrada", { a2aTaskId: taskId });
        respondJsonRpcError(res, id, A2A_ERROR_TASK_NOT_FOUND, "tarea no encontrada");
        return;
    }
  } catch {
    logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-handler-fallido", { method });
    respondJsonRpcError(res, id, JSONRPC_INTERNAL_ERROR, "error interno");
  }
}

/**
 * El listener HTTP, aislado del ciclo de vida del servidor para poder
 * testear cada respuesta con dobles planos (molde `webhooks/server.ts:139-244`).
 *
 * Tabla de respuestas — hasta esta tarea (design.md §6.3, sin el tope de
 * turnos en vuelo ni el drenaje, tarea 13):
 * | Condición | Status | Efecto |
 * |---|---|---|
 * | `GET RUTA_AGENT_CARD` | `200` | el card de `construirAgentCard`, **sin auth**. `a2a-card-servido` |
 * | `POST RUTA_JSONRPC`, body > `maxBodyBytes` | `413` | `a2a-solicitud-rechazada-tamano`. Sin auth, sin parse |
 * | `POST RUTA_JSONRPC`, error de transporte leyendo el body | `400` | nada |
 * | `POST RUTA_JSONRPC`, sin auth válida | `401` | `a2a-solicitud-no-autorizada`. Ninguna fila creada |
 * | `POST RUTA_JSONRPC`, `JSON.parse` inválido | `200` | `-32700`, `id: null`. `a2a-sobre-invalido` |
 * | `POST RUTA_JSONRPC`, sobre no-objeto / `jsonrpc !== "2.0"` / `method` no-string | `200` | `-32600`, `id: null` |
 * | `POST RUTA_JSONRPC`, `method` fuera de los tres soportados | `200` | `-32601`, con el `id` del request. `a2a-metodo-no-soportado` |
 * | `SendMessage`/`GetTask`/`CancelTask`, `params` mal formados | `200` | `-32602`, ningún callback invocado |
 * | `SendMessage` con éxito | `200` | `result: { task: Task }` (`SUBMITTED`/`REJECTED` según `onSolicitudA2A` — ÚNICO método cuyo `result` envuelve el `Task`, ver `respondJsonRpcSendMessageResult`) |
 * | `GetTask`/`CancelTask` de un id inexistente | `200` | `A2A_ERROR_TASK_NOT_FOUND` |
 * | `CancelTask` sobre terminal no cancelable | `200` | `A2A_ERROR_TASK_NOT_CANCELABLE`, fila intacta |
 * | `CancelTask` sobre `CANCELED`/`SUBMITTED`/`WORKING` | `200` | `result: Task` (idempotente en el primer caso) |
 * | Un handler lanza | `200` | `-32603`, `a2a-handler-fallido`, nunca un stacktrace en el cuerpo |
 * | Cualquier `método+ruta` no reconocido | `404` | nada |
 *
 * `GET RUTA_AGENT_CARD` se sirve SIN auth a propósito (ADR 88 pto 5): es el
 * único endpoint público de este adaptador — lo único que revela es que hay
 * un agente que exige token para el resto.
 */
export function createRequestListener(
  deps: A2AServerDeps,
): (req: A2ARequest, res: A2AResponse) => void {
  const { config, logEvent } = deps;

  return (req: A2ARequest, res: A2AResponse): void => {
    const path = pathFromUrl(req.url);

    if (req.method === "GET" && path === RUTA_AGENT_CARD) {
      const card = construirAgentCard(config);
      const origenTransporte = req.socket?.remoteAddress ?? "desconocido";

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(card));

      logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-card-servido", { origenTransporte });
      return;
    }

    if (req.method === "POST" && path === RUTA_JSONRPC) {
      void handleSolicitudJsonRpc(req, res, deps);
      return;
    }

    res.statusCode = 404;
    res.end();
  };
}

/**
 * Texto fijo de `status.message` para los tres terminales de FRACASO
 * (design.md ADR 93 pto 3) — constantes de módulo, nunca strings del modelo.
 * `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING` no aparecen acá a propósito
 * (ADR 93 pto 4: ninguno de los dos lleva `status.message`).
 */
const TEXTO_STATUS_MESSAGE_FRACASO: Readonly<Record<string, string>> = {
  [TASK_STATE_FAILED]: "El turno del arnés no pudo completarse.",
  [TASK_STATE_CANCELED]: "La tarea fue cancelada por el llamador.",
  [TASK_STATE_REJECTED]: "El arnés está al máximo de solicitudes en curso. Reintentá más tarde.",
};

/**
 * `construirTask` (Hito 7, tarea 11, design.md §6.3 parte 2a, ADR 93) — PURA
 * y TOTAL: ni reloj ni `randomUUID`, y ninguna rama lanza.
 *
 * - `TASK_STATE_COMPLETED` con `resultado` presente ⇒ `artifacts` con el
 *   resultado, SIN `status.message` (ADR 93 pto 1-2: el resultado vive en un
 *   solo lugar, nunca en los dos).
 * - `FAILED`/`CANCELED`/`REJECTED` ⇒ `status.message` con el texto fijo de
 *   `TEXTO_STATUS_MESSAGE_FRACASO`, SIN `artifacts`.
 * - `SUBMITTED`/`WORKING` ⇒ ni uno ni el otro (ADR 93 pto 4).
 * - `COMPLETED` SIN `resultado` (que ningún camino real produce, pero el tipo
 *   admite) ⇒ no lanza, `artifacts` queda AUSENTE, no un array vacío (ADR 93
 *   pto 6).
 * - `status.timestamp` = `vista.updatedAt`, exacto, sin transformar (ADR 93
 *   pto 5: es más verdadero que `now()`).
 * - `artifactId` = `` `${a2aTaskId}-0` ``, `status.message.messageId` =
 *   `` `${a2aTaskId}-msg` `` — derivados, deterministas, sin `randomUUID`.
 * - `contextId` = `vista.contextId`, copiado tal cual: ya viene resuelto
 *   (`casoId ?? a2aTaskId`) por quien arma la vista, no por esta función
 *   (design.md líneas 648-654).
 */
export function construirTask(vista: SolicitudA2AEntranteVista): TaskJson {
  const { a2aTaskId, contextId, estado, resultado, updatedAt } = vista;

  const status: TaskStatusJson = { state: estado, timestamp: updatedAt };

  if (estado === TASK_STATE_COMPLETED && resultado !== undefined) {
    return {
      id: a2aTaskId,
      contextId,
      status,
      artifacts: [{ artifactId: `${a2aTaskId}-0`, name: "respuesta", parts: [{ text: resultado }] }],
    };
  }

  const textoFijo = TEXTO_STATUS_MESSAGE_FRACASO[estado];
  if (textoFijo !== undefined) {
    return {
      id: a2aTaskId,
      contextId,
      status: {
        ...status,
        message: { messageId: `${a2aTaskId}-msg`, parts: [{ text: textoFijo }] },
      },
    };
  }

  return { id: a2aTaskId, contextId, status };
}

/**
 * Handle devuelto por `startServer` (Hito 7, tarea 13, design.md §6.3,
 * ADR 101). `port` es el puerto EFECTIVO — el que asignó el SO cuando
 * `deps.config.port === 0` — no el configurado (asimetría deliberada
 * respecto de `WebServerHandle`/`WebhookServerHandle`, RD-42).
 */
export interface A2AServerHandle {
  readonly port: number;
  /** Deja de aceptar, drena los turnos en vuelo con techo `A2A_CLOSE_TIMEOUT_MS`, resuelve. NUNCA rechaza. */
  close(): Promise<void>;
}

/**
 * Monta el listener sobre un servidor HTTP (Hito 7, tarea 13, design.md
 * §6.3 parte 2c, ADR 99, ADR 101). `createServer` se inyecta (default:
 * `http.createServer` real) para que ningún test del suite por defecto abra
 * un puerto — mismo criterio que `web/server.ts:504-508`.
 *
 * `const enVuelo = new Set<Promise<void>>()` es a la vez el contador del
 * tope y el conjunto de drenaje (ADR 99 pto 1) — cero estado duplicado.
 * `startServer` envuelve `deps.onSolicitudA2A` (molde LITERAL de
 * `onSoporteConDrenaje`, `web/server.ts:515-523`, incluido el
 * `.then(olvidar, olvidar)` en vez de `.finally`): calcula `hayCupo` a
 * partir de `enVuelo.size` **antes** de invocar al composition root, y
 * registra `resultado.turno` en `enVuelo` **sólo** cuando
 * `estado === TASK_STATE_SUBMITTED` — el tipo de `SolicitudA2AAceptada`
 * (ADR 99 pto 4) hace imposible registrar un turno que la rama `REJECTED`
 * no trae.
 *
 * `address()` resuelve el puerto EFECTIVO dentro del callback de `listen`
 * (ADR 101), con fallback a `deps.config.port` si el doble de test no
 * implementa `address()`. `close()` drena `enVuelo` con `Promise.allSettled`
 * en carrera contra `A2A_CLOSE_TIMEOUT_MS` — igual que
 * `web/server.ts:547-565` — y NUNCA rechaza; agotado el techo, loguea
 * `a2a-servidor-cierre-con-turnos-en-vuelo`.
 */
export function startServer(
  deps: A2AServerDeps,
  createServer: CreateA2AServerFn = (listener) =>
    createHttpServer((req, res) => listener(req as unknown as A2ARequest, res)),
): Promise<A2AServerHandle> {
  const enVuelo = new Set<Promise<void>>();

  const onSolicitudConTopeYDrenaje = async (
    input: Omit<SolicitudA2AEntrada, "hayCupo">,
  ): Promise<SolicitudA2AAceptada> => {
    const resultado = await deps.onSolicitudA2A({
      ...input,
      hayCupo: enVuelo.size < deps.config.maxEnVuelo,
    });
    if (resultado.estado === TASK_STATE_SUBMITTED) {
      enVuelo.add(resultado.turno);
      const olvidar = (): void => {
        enVuelo.delete(resultado.turno);
      };
      resultado.turno.then(olvidar, olvidar);
    }
    return resultado;
  };

  const listener = createRequestListener({ ...deps, onSolicitudA2A: onSolicitudConTopeYDrenaje });
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

      const direccion = server.address();
      const puertoEfectivo =
        typeof direccion === "object" && direccion !== null ? direccion.port : deps.config.port;

      const handle: A2AServerHandle = {
        port: puertoEfectivo,
        close(): Promise<void> {
          return new Promise((resolveClose) => {
            server.close(() => {
              const drenaje = Promise.allSettled([...enVuelo]).then(() => undefined);
              const timeout = new Promise<"timeout">((resolveTimeout) => {
                setTimeout(() => resolveTimeout("timeout"), A2A_CLOSE_TIMEOUT_MS);
              });

              void Promise.race([drenaje.then(() => "drenado" as const), timeout]).then((resultado) => {
                if (resultado === "timeout") {
                  deps.logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-cierre-con-turnos-en-vuelo", {
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
