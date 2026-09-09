import type { A2AConfig, DestinoA2AConfig } from "./config.js";
import {
  type DestinoA2AClave,
  type MotivoDelegacionA2ANoCompletada,
  type ResultadoA2A,
  type TaskState,
  TASK_STATE_COMPLETED,
  esEstadoTerminal,
  esTaskStateConocido,
  motivoDeEstadoTerminal,
} from "../../core/agents/a2a-contract.js";

/**
 * Cliente A2A saliente — el único archivo de este adaptador que habla HTTP
 * (Hito 6, tareas 4-5, design.md §6.2, ADR 71 pto 6, 72 pto 5, 81, 84).
 *
 * Tarea 4: resolución del Agent Card y envío de `SendMessage` (§6.2 parte 1).
 * Tarea 5 (esta extensión, §6.2 parte 2): el loop de `GetTask` a intervalo
 * fijo hasta estado terminal o timeout total, `CancelTask` best-effort al
 * agotar el timeout, la clasificación completa `transporte`/`protocolo`
 * sobre `status.state` (validado con `esTaskStateConocido` del núcleo — ADR
 * 84, `TASK_STATE_UNSPECIFIED` incluido), el truncado del cuerpo de error a
 * `ERROR_BODY_MAX_CHARS`, y la extracción del texto de resultado.
 *
 * `delegarTarea` NUNCA rechaza (ADR 77): todo desenlace vuelve como
 * `ResultadoA2A`. `esEstadoTerminal`/`motivoDeEstadoTerminal` se importan tal
 * cual del núcleo (`a2a-contract.ts`, tarea 1) — este archivo no reinventa
 * ese mapeo. `INPUT_REQUIRED`/`AUTH_REQUIRED` pasan por el mismo camino que
 * `FAILED`/`CANCELED`/`REJECTED` (ADR 73 pto 2): ninguna rama especial acá,
 * la política sobre qué significa ese desenlace es del núcleo (tarea 12).
 */

/**
 * Recorte estructural de `fetch` — el `fetch` global real (Node 20+, sin
 * import) lo satisface. Es EL seam de los tests: ninguno le pega a un
 * servidor A2A real, todos inyectan un doble. Copia deliberada de
 * `adapters/board/github-client.ts` / `adapters/notificaciones/email-client.ts`.
 */
export type FetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * Cuánto del cuerpo de error entra al mensaje — evita mensajes gigantes en
 * el log. Copia deliberada de `github-client.ts:27` / `email-client.ts:28`
 * (7ª/8ª instancia): `AGENTS.md` prohíbe que un adaptador importe de otro,
 * y esto es infraestructura de adaptador, no lógica de negocio. Mismo
 * criterio de duplicación aceptada que `git/config.ts:49-56`.
 *
 * Usada por el loop de `GetTask` de esta tarea (5) — un `!response.ok` de
 * `SendMessage`/Agent Card no incluye cuerpo en el `ResultadoA2AFallo`
 * (tarea 4, sin cambios acá).
 */
const ERROR_BODY_MAX_CHARS = 500;

/** Copia deliberada de `email-client.ts:57-59` — mismo criterio de duplicación de infraestructura de adaptador. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/**
 * Lee y trunca el cuerpo de una respuesta HTTP `!ok`, a `ERROR_BODY_MAX_CHARS`
 * — compartido entre `enviarSendMessage` y `consultarOControlarTarea`
 * (code-review, hallazgo 2): antes sólo `consultarOControlarTarea` capturaba
 * el `detalle` para este caso, dejando `enviarSendMessage` inconsistente
 * para el mismo desenlace (`!response.ok`). `response.text()` puede rechazar
 * (stream cortado después de que las cabeceras llegaron bien) — se trata
 * como "sin detalle que truncar", mismo criterio que el resto de fallas de
 * red (ADR 77 "nunca rechaza").
 */
async function leerDetalleDeErrorTransporte(response: FetchResponseLike): Promise<string | undefined> {
  try {
    const cuerpo = await response.text();
    return truncate(cuerpo, ERROR_BODY_MAX_CHARS);
  } catch {
    return undefined;
  }
}

/**
 * Sobre JSON-RPC PROPIO, ACOTADO y CERRADO (ADR 71 pto 6) — molde de
 * `SobreJsonRpc` en design.md §6.2. Los tres métodos de este cliente son
 * PascalCase, sin prefijo `a2a/` (verificado contra `specification/a2a.proto`
 * del tag `v1.0.0` de `a2aproject/A2A`).
 */
interface SobreJsonRpc<TMethod extends string, TParams> {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: TMethod;
  readonly params: TParams;
}

interface SendMessageParams {
  readonly message: {
    readonly messageId: string;
    /** ProtoJSON del enum `Role` — literal `"ROLE_USER"`, NO `"user"`. */
    readonly role: "ROLE_USER";
    readonly parts: readonly [{ readonly text: string }];
  };
}

type SendMessageRequest = SobreJsonRpc<"SendMessage", SendMessageParams>;

/** `params.id` de `GetTask`/`CancelTask` (design.md §6.2, tabla de las tres llamadas). */
interface TaskIdParams {
  readonly id: string;
}

type GetTaskRequest = SobreJsonRpc<"GetTask", TaskIdParams>;
type CancelTaskRequest = SobreJsonRpc<"CancelTask", TaskIdParams>;

/**
 * Recorte estructural de `Task` (design.md §6.2 parte 2) — sólo los campos
 * que este cliente lee (`id`, `status.state`, `status.message`, `artifacts`).
 * Cualquier otro campo del protocolo se ignora sin fallar (ADR 71 pto 6): no
 * hay una interfaz que lo declare, así que TypeScript nunca lo ve.
 */
interface TaskLike {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly artifacts?: unknown;
}

interface TaskTextPartLike {
  readonly text?: unknown;
}

/**
 * Dependencias que este adaptador necesita — molde literal de
 * `A2AClientDeps` en design.md §6.2. `ahoraMs`/`dormir` alimentan el loop de
 * `GetTask` de esta tarea (5), SIN dormir de verdad en los tests (ADR 81).
 */
export interface A2AClientDeps {
  readonly config: A2AConfig;
  readonly fetchFn: FetchFn;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** Inyectables para testear el loop de la tarea 5 SIN dormir de verdad (ADR 81). */
  readonly ahoraMs: () => number;
  readonly dormir: (ms: number) => Promise<void>;
  readonly newMessageId: () => string;
}

type ResolucionAgentCard =
  | { readonly ok: true; readonly endpoint: string; readonly agenteNombre: string }
  | { readonly ok: false; readonly reason: "transporte" | "protocolo" };

interface EntradaAgentCard {
  readonly url?: unknown;
  readonly protocolBinding?: unknown;
}

/**
 * PURA. `name` del Agent Card, best-effort (Requirement 1 pide validar "al
 * menos name, url y transporte JSON-RPC", pero el molde de card usado en los
 * tests de la tarea 4 no lo trae — endurecer esto a obligatorio rompería esa
 * suite ya revisada). Ausente o no-string ⇒ `""`, nunca crashea. Se usa sólo
 * como evidencia del desenlace (`agenteNombre`, ADR 79 pto 2).
 */
function extraerNombreAgente(card: unknown): string {
  if (typeof card !== "object" || card === null) {
    return "";
  }
  const { name } = card as { readonly name?: unknown };
  return typeof name === "string" ? name : "";
}

/**
 * PURA. Recorta el JSON crudo del Agent Card a la única cosa que este
 * cliente necesita: la primera entrada de `supportedInterfaces` con
 * `protocolBinding === "JSONRPC"` y `url` no vacío (★ RD-24 resuelto,
 * verificado contra `specification/a2a.proto` y `docs/specification.md` del
 * tag `v1.0.0` de `a2aproject/A2A` — NO existen `preferredTransport` ni
 * `additionalInterfaces`). Cualquier otro campo del card se ignora sin
 * fallar. `undefined` si el array está ausente, vacío, o sin ninguna
 * entrada `"JSONRPC"`.
 */
function extraerEndpointJsonRpc(card: unknown): string | undefined {
  if (typeof card !== "object" || card === null) {
    return undefined;
  }
  const { supportedInterfaces } = card as { supportedInterfaces?: unknown };
  if (!Array.isArray(supportedInterfaces)) {
    return undefined;
  }
  for (const entrada of supportedInterfaces as readonly unknown[]) {
    if (typeof entrada !== "object" || entrada === null) {
      continue;
    }
    const { url, protocolBinding } = entrada as EntradaAgentCard;
    if (protocolBinding === "JSONRPC" && typeof url === "string" && url !== "") {
      return url;
    }
  }
  return undefined;
}

/**
 * Paso 1 del ciclo (design.md §6.2): `GET <base>/.well-known/agent-card.json`,
 * exacto, sin caché — dos delegaciones hacen dos GET. Sin `url` de destino
 * JSON-RPC ⇒ `protocolo`, sin intentar `SendMessage`. Card inaccesible (red
 * caída o `!response.ok`) ⇒ `transporte`. El header `Authorization` se arma
 * con `construirHeaders`, igual que las otras tres llamadas (post-review
 * PR2, Hallazgo 6) — un destino que exige auth también para el card no debe
 * fallar por falta de token.
 */
async function resolverEndpointJsonRpc(input: {
  readonly destino: DestinoA2AConfig;
  readonly fetchFn: FetchFn;
  readonly requestTimeoutMs: number;
}): Promise<ResolucionAgentCard> {
  const url = `${input.destino.baseUrl}/.well-known/agent-card.json`;

  let response: FetchResponseLike;
  try {
    response = await input.fetchFn(url, {
      method: "GET",
      headers: construirHeaders(input.destino),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    });
  } catch {
    return { ok: false, reason: "transporte" };
  }

  if (!response.ok) {
    return { ok: false, reason: "transporte" };
  }

  let card: unknown;
  try {
    card = JSON.parse(await response.text()) as unknown;
  } catch {
    return { ok: false, reason: "protocolo" };
  }

  const endpoint = extraerEndpointJsonRpc(card);
  if (endpoint === undefined) {
    return { ok: false, reason: "protocolo" };
  }
  return { ok: true, endpoint, agenteNombre: extraerNombreAgente(card) };
}

/**
 * PURA. Interpreta un sobre JSON-RPC de respuesta (`SendMessage`, `GetTask`)
 * como éxito con el `Task` crudo, o fracaso: JSON inválido, sobre sin
 * `result` (objeto), o con `error` presente ⇒ `protocolo` (Requirement
 * "Clasificación de fallas..."). Ningún campo no reconocido del sobre hace
 * fallar el parseo — sólo se leen `result`/`error`.
 */
function parsearSobreDeTarea(cuerpo: string): { readonly ok: true; readonly task: TaskLike } | { readonly ok: false } {
  let sobre: unknown;
  try {
    sobre = JSON.parse(cuerpo) as unknown;
  } catch {
    return { ok: false };
  }
  if (typeof sobre !== "object" || sobre === null) {
    return { ok: false };
  }
  const { result, error } = sobre as { readonly result?: unknown; readonly error?: unknown };
  // `error: null` explícito (algunos frameworks no estrictos serializan
  // ambos campos) NO cuenta como error — sólo un valor presente y no nulo
  // (post-review PR2, Hallazgo 5).
  if ((error !== undefined && error !== null) || typeof result !== "object" || result === null) {
    return { ok: false };
  }
  return { ok: true, task: result as TaskLike };
}

type SobreSendMessage =
  | { readonly ok: true; readonly outcome: "task"; readonly task: TaskLike }
  | { readonly ok: true; readonly outcome: "message" }
  | { readonly ok: false };

/**
 * PURA. Interpreta el sobre JSON-RPC de una respuesta `SendMessage` —
 * DISTINTO de `parsearSobreDeTarea` (GetTask/CancelTask, sin cambios):
 * `SendMessageResponse` es un `oneof payload { Task task = 1; Message
 * message = 2; }` REAL del protocolo (verificado contra
 * `specification/a2a.proto` del tag `v1.0.0` de `a2aproject/A2A` — el
 * segundo bug encontrado en la verificación manual de la tarea 23,
 * `docs/progreso/v2.2-a2a-cliente/verificacion-manual-tarea-23.md` §2.2), NO
 * un `Task` plano como devuelven `GetTask`/`CancelTask` (confirmado con
 * `curl` real contra el sample en el mismo reporte). JSON inválido, sobre sin
 * `result` (objeto), con `error` presente, o `result` sin `task` NI `message`
 * ⇒ `ok: false` (mismo criterio que `parsearSobreDeTarea`: `error: null`
 * explícito no cuenta como error).
 */
function parsearSobreDeSendMessage(cuerpo: string): SobreSendMessage {
  let sobre: unknown;
  try {
    sobre = JSON.parse(cuerpo) as unknown;
  } catch {
    return { ok: false };
  }
  if (typeof sobre !== "object" || sobre === null) {
    return { ok: false };
  }
  const { result, error } = sobre as { readonly result?: unknown; readonly error?: unknown };
  if ((error !== undefined && error !== null) || typeof result !== "object" || result === null) {
    return { ok: false };
  }
  const { task, message } = result as { readonly task?: unknown; readonly message?: unknown };
  if (typeof task === "object" && task !== null) {
    return { ok: true, outcome: "task", task: task as TaskLike };
  }
  if (typeof message === "object" && message !== null) {
    return { ok: true, outcome: "message" };
  }
  return { ok: false };
}

/**
 * PURA. `status.state` de un `TaskLike`, validado contra los ocho valores
 * conocidos con `esTaskStateConocido` del núcleo (ADR 84 — incluye el
 * rechazo de `TASK_STATE_UNSPECIFIED`). `undefined` si el campo falta, no es
 * un string, o no es ninguno de los ocho — el llamador lo clasifica como
 * `protocolo`, esta función no clasifica nada, sólo valida.
 */
function estadoDeTarea(task: TaskLike): TaskState | undefined {
  if (typeof task.status !== "object" || task.status === null) {
    return undefined;
  }
  const { state } = task.status as { readonly state?: unknown };
  return typeof state === "string" && esTaskStateConocido(state) ? state : undefined;
}

/** PURA. `task.id`, o `undefined` si falta o no es un string — nunca inventa un id. */
function idDeTarea(task: TaskLike): string | undefined {
  return typeof task.id === "string" ? task.id : undefined;
}

/**
 * PURA. Concatena las partes `text` de un array `parts` desconocido —
 * cualquier entrada que no sea `{ text: string }` se ignora sin fallar.
 */
function concatenarPartesDeTexto(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  const textos: string[] = [];
  for (const parte of parts as readonly unknown[]) {
    if (typeof parte !== "object" || parte === null) {
      continue;
    }
    const { text } = parte as TaskTextPartLike;
    if (typeof text === "string") {
      textos.push(text);
    }
  }
  return textos.join("");
}

/**
 * PURA. Extracción del texto de resultado (design.md §6.2): se concatenan
 * las partes `text` de `task.artifacts[*].parts[*]`; si no hay ninguna, cae
 * al `Message` de `task.status.message`; si tampoco, `""` — un agente que
 * completó sin texto sigue siendo éxito, no un fallo de protocolo.
 */
function extraerResultado(task: TaskLike): string {
  if (Array.isArray(task.artifacts)) {
    const textos: string[] = [];
    for (const artifact of task.artifacts as readonly unknown[]) {
      if (typeof artifact !== "object" || artifact === null) {
        continue;
      }
      const { parts } = artifact as { readonly parts?: unknown };
      const texto = concatenarPartesDeTexto(parts);
      if (texto !== "") {
        textos.push(texto);
      }
    }
    if (textos.length > 0) {
      return textos.join("");
    }
  }

  if (typeof task.status === "object" && task.status !== null) {
    const { message } = task.status as { readonly message?: unknown };
    if (typeof message === "object" && message !== null) {
      const { parts } = message as { readonly parts?: unknown };
      return concatenarPartesDeTexto(parts);
    }
  }

  return "";
}

type EnvioSendMessage =
  | { readonly ok: true; readonly task: TaskLike }
  | { readonly ok: false; readonly reason: "transporte" | "protocolo"; readonly detalle?: string };

/**
 * PURA. Defensa de contrato: un `FetchFn` real siempre resuelve un
 * `FetchResponseLike`; si no lo hace (contrato violado), el llamador debe
 * tratarlo como indeterminado — no reintentable — en vez de crashear leyendo
 * `.ok` de algo que no es la respuesta esperada. Antes duplicada verbatim en
 * `enviarSendMessage` y `consultarOControlarTarea` (post-review PR2, Hallazgo 3).
 */
function respetaContratoDeFetchResponse(response: unknown): response is FetchResponseLike {
  return (
    typeof response === "object" && response !== null && typeof (response as FetchResponseLike).ok === "boolean"
  );
}

/**
 * `Content-Type` fijo + `A2A-Version` fijo + `Authorization` opcional —
 * compartido por los tres métodos JSON-RPC de este cliente Y por el GET del
 * Agent Card.
 *
 * `A2A-Version: "1.0"` NO es un requirement de la especificación v1.0.0 en sí
 * — verificado contra `specification/a2a.proto` del tag `v1.0.0` de
 * `a2aproject/A2A`: el `.proto` no declara ningún header HTTP obligatorio, la
 * negociación de versión queda fuera del `.proto` de mensajes. Es lo que
 * exige `a2a-sdk` (el paquete Python de referencia que implementan los
 * samples de `a2aproject/a2a-samples` — la forma oficial de probar este
 * cliente según el propio `README.md` del proyecto): sin el header, el
 * servidor de referencia asume protocolo legacy `0.3` y rechaza con
 * `VERSION_NOT_SUPPORTED` (verificado con `curl` real contra el sample,
 * `docs/progreso/v2.2-a2a-cliente/verificacion-manual-tarea-23.md` §2.2, el
 * bug que motivó este fix). Se manda igual — mismo espíritu pragmático que
 * otras decisiones ya tomadas en este cliente (ADR 71 pto 6): sin este
 * header, la interoperabilidad real con el ecosistema de referencia del
 * protocolo se rompe.
 */
function construirHeaders(destino: DestinoA2AConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "A2A-Version": "1.0" };
  if (destino.authToken !== undefined) {
    headers.Authorization = `Bearer ${destino.authToken}`;
  }
  return headers;
}

/**
 * Paso 2 del ciclo (design.md §6.2): `POST <endpoint>` con el sobre exacto
 * de la tabla (`method: "SendMessage"`, `params.message.role: "ROLE_USER"`).
 * `SendMessage` se envía exactamente una vez por delegación. El header
 * `Authorization` se arma acá y NUNCA se incluye en un mensaje ni en un
 * evento. Falla de red o `!response.ok` ⇒ `transporte` (quien llama decide
 * el resto del `ResultadoA2AFallo`, porque acá no se conoce todavía el
 * endpoint resuelto para incluirlo). Éxito ⇒ parsea el `Task` de la
 * respuesta (tarea 5) para conocer `task.id` y el estado inicial.
 */
async function enviarSendMessage(input: {
  readonly endpoint: string;
  readonly destino: DestinoA2AConfig;
  readonly tarea: string;
  readonly deps: A2AClientDeps;
}): Promise<EnvioSendMessage> {
  const { endpoint, destino, tarea, deps } = input;

  const body: SendMessageRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: {
        messageId: deps.newMessageId(),
        role: "ROLE_USER",
        parts: [{ text: tarea }],
      },
    },
  };

  let response: FetchResponseLike;
  try {
    response = await deps.fetchFn(endpoint, {
      method: "POST",
      headers: construirHeaders(destino),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.config.requestTimeoutMs),
    });
  } catch {
    return { ok: false, reason: "transporte" };
  }

  // Defensa de contrato: `response` violando `FetchResponseLike` se trata
  // como `protocolo` — indeterminado, no reintentable.
  if (!respetaContratoDeFetchResponse(response)) {
    return { ok: false, reason: "protocolo" };
  }

  // `!response.ok` captura el cuerpo truncado en `detalle` — mismo criterio
  // que `consultarOControlarTarea` para el mismo caso (code-review, hallazgo
  // 2; antes esta rama devolvía `{ok:false, reason:"transporte"}` sin
  // `detalle`, inconsistente con su función hermana).
  if (!response.ok) {
    const detalle = await leerDetalleDeErrorTransporte(response);
    return { ok: false, reason: "transporte", ...(detalle !== undefined ? { detalle } : {}) };
  }

  // `response.text()` puede rechazar si el stream del cuerpo se corta
  // después de que las cabeceras llegaron bien — no es un problema de
  // protocolo, es de transporte/lectura, mismo criterio que el resto de
  // fallas de red (post-review PR2, Hallazgo 1; ADR 77 "nunca rechaza").
  let cuerpo: string;
  try {
    cuerpo = await response.text();
  } catch {
    return { ok: false, reason: "transporte" };
  }

  const parsed = parsearSobreDeSendMessage(cuerpo);
  if (!parsed.ok) {
    return { ok: false, reason: "protocolo" };
  }
  if (parsed.outcome === "message") {
    // La otra rama real del `oneof` (verificación manual tarea 23 §2.4): el
    // agente respondió con un `Message` en vez de crear una `Task` — un
    // agente sincrónico de una sola respuesta, sin ciclo de vida de tarea.
    // Este cliente está diseñado ENTERAMENTE alrededor de
    // `TaskState`/polling (a2a-contract.ts, tarea 1) — no hay un `Task` que
    // trackear acá, así que lo más honesto es tratarlo como `protocolo` (el
    // agente no se comportó como este cliente espera), NO como un error de
    // transporte ni un éxito fabricado.
    return {
      ok: false,
      reason: "protocolo",
      detalle: "El agente respondió con result.message en vez de result.task — sin Task que trackear.",
    };
  }
  return { ok: true, task: parsed.task };
}

type IntercambioTarea =
  | { readonly ok: true; readonly task: TaskLike }
  | { readonly ok: false; readonly reason: "transporte" | "protocolo"; readonly detalle?: string };

/**
 * `POST <endpoint>` de `GetTask`/`CancelTask` (design.md §6.2, tabla de las
 * tres llamadas). Mismo criterio de clasificación que `SendMessage`: red
 * caída o `!response.ok` ⇒ `transporte` (con el cuerpo truncado a
 * `ERROR_BODY_MAX_CHARS`, NUNCA el header `Authorization`); sobre con
 * `error`, JSON inválido, o una respuesta que no cumple el contrato de
 * `FetchResponseLike` ⇒ `protocolo`.
 */
async function consultarOControlarTarea(input: {
  readonly endpoint: string;
  readonly destino: DestinoA2AConfig;
  readonly body: GetTaskRequest | CancelTaskRequest;
  readonly deps: A2AClientDeps;
}): Promise<IntercambioTarea> {
  const { endpoint, destino, body, deps } = input;

  let response: FetchResponseLike;
  try {
    response = await deps.fetchFn(endpoint, {
      method: "POST",
      headers: construirHeaders(destino),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.config.requestTimeoutMs),
    });
  } catch {
    return { ok: false, reason: "transporte" };
  }

  if (!respetaContratoDeFetchResponse(response)) {
    return { ok: false, reason: "protocolo" };
  }

  // `response.text()` puede rechazar (stream cortado) — se trata como
  // `transporte`, igual que el resto de fallas de red (post-review PR2,
  // Hallazgo 1; ADR 77 "nunca rechaza"). Sin `detalle` cuando rechaza: no hay
  // cuerpo que truncar. Mismo helper que `enviarSendMessage` (code-review,
  // hallazgo 2) — antes duplicado acá.
  if (!response.ok) {
    const detalle = await leerDetalleDeErrorTransporte(response);
    return { ok: false, reason: "transporte", ...(detalle !== undefined ? { detalle } : {}) };
  }

  let cuerpo: string;
  try {
    cuerpo = await response.text();
  } catch {
    return { ok: false, reason: "transporte" };
  }

  const parsed = parsearSobreDeTarea(cuerpo);
  if (!parsed.ok) {
    return { ok: false, reason: "protocolo" };
  }
  return { ok: true, task: parsed.task };
}

/**
 * PURA. `estado` ya es terminal (`esEstadoTerminal` del núcleo) y distinto de
 * `TASK_STATE_COMPLETED` ⇒ es un terminal DE FRACASO — el único narrowing
 * que TypeScript necesita para aceptar `estado` en `motivoDeEstadoTerminal`
 * (cuyo parámetro excluye justamente `COMPLETED`/`SUBMITTED`/`WORKING`).
 * `esEstadoTerminal` en sí no es un *type guard* (task 1, ya committeado —
 * fuera de alcance de esta tarea tocarlo); este wrapper local lo es.
 */
function esTerminalDeFracaso(
  estado: TaskState,
): estado is Exclude<TaskState, "TASK_STATE_COMPLETED" | "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING"> {
  return estado !== TASK_STATE_COMPLETED && esEstadoTerminal(estado);
}

/**
 * Intenta `CancelTask` una vez, best-effort (Requirement "`CancelTask` es
 * best-effort..."): su resultado sólo se loguea (`a2a-cancel-intentado`),
 * NUNCA cambia el desenlace ya decidido como `timeout`.
 */
async function intentarCancelTask(input: {
  readonly endpoint: string;
  readonly destino: DestinoA2AConfig;
  readonly taskId: string;
  readonly idJsonRpc: number;
  readonly casoId: string;
  readonly deps: A2AClientDeps;
}): Promise<void> {
  const cancelacion = await consultarOControlarTarea({
    endpoint: input.endpoint,
    destino: input.destino,
    body: { jsonrpc: "2.0", id: input.idJsonRpc, method: "CancelTask", params: { id: input.taskId } },
    deps: input.deps,
  });
  input.deps.logEvent(input.casoId, "a2a-cancel-intentado", { a2aTaskId: input.taskId, ok: cancelacion.ok });
}

/**
 * El ciclo completo de UNA delegación externa (design.md §6.2, tareas 4-5):
 * Agent Card → `SendMessage` una vez → loop de `GetTask` a `pollIntervalMs`
 * hasta estado terminal o `taskTimeoutMs` agotado → `CancelTask` best-effort
 * si se agotó el timeout. NUNCA rechaza (ADR 77): todo desenlace es un
 * `return`, nunca un `throw`.
 *
 * `deadline` se calcula UNA vez (`ahoraMs()` al terminar `SendMessage` +
 * `taskTimeoutMs`), y `dormir(pollIntervalMs)` se ejecuta al principio de
 * cada iteración — así el intervalo entre cada `GetTask` sucesivo (y entre
 * el estado inicial de `SendMessage` y el primer `GetTask`) es siempre
 * exactamente `pollIntervalMs`, verificable sin dormir de verdad (ADR 81).
 *
 * Un `GetTask` que falla por transporte NO corta el loop — se loguea
 * (`a2a-poll-fallido`) y se sigue hasta el deadline (ADR 81 pto 3). Un
 * `status.state` desconocido (incluido `TASK_STATE_UNSPECIFIED`, ADR 84) o
 * un sobre con `error` SÍ corta el loop de inmediato con `reason:
 * "protocolo"` — no es un problema de red que reintentar vaya a resolver.
 */
export async function delegarTarea(
  input: {
    readonly destino: DestinoA2AConfig;
    readonly clave: DestinoA2AClave;
    readonly tarea: string;
    readonly casoId: string;
  },
  deps: A2AClientDeps,
): Promise<ResultadoA2A> {
  const cardResult = await resolverEndpointJsonRpc({
    destino: input.destino,
    fetchFn: deps.fetchFn,
    requestTimeoutMs: deps.config.requestTimeoutMs,
  });
  if (!cardResult.ok) {
    return { ok: false, reason: cardResult.reason };
  }
  const { endpoint, agenteNombre } = cardResult;

  const sendResult = await enviarSendMessage({
    endpoint,
    destino: input.destino,
    tarea: input.tarea,
    deps,
  });
  if (!sendResult.ok) {
    return {
      ok: false,
      reason: sendResult.reason,
      endpoint,
      ...(sendResult.detalle !== undefined ? { detalle: sendResult.detalle } : {}),
    };
  }

  const taskId = idDeTarea(sendResult.task);
  if (taskId === undefined) {
    return { ok: false, reason: "protocolo", endpoint };
  }

  const deadline = deps.ahoraMs() + deps.config.taskTimeoutMs;
  let tareaActual = sendResult.task;
  let idJsonRpc = 2; // `id: 1` ya usado por `SendMessage`.
  let intento = 0;
  /**
   * Último `detalle` de un poll fallido por transporte, truncado por
   * `consultarOControlarTarea`. Antes moría en el `logEvent` de
   * `a2a-poll-fallido`; ahora sobrevive hasta el `return` de `timeout` si el
   * loop nunca se recupera — `ResultadoA2AFallo.detalle` existe justo para
   * esto (post-review PR2, Hallazgo 2).
   */
  let ultimoDetalleTransporte: string | undefined;

  for (;;) {
    const estado = estadoDeTarea(tareaActual);
    if (estado === undefined) {
      return { ok: false, reason: "protocolo", endpoint, a2aTaskId: taskId };
    }
    if (estado === TASK_STATE_COMPLETED) {
      return {
        ok: true,
        a2aTaskId: taskId,
        estado: TASK_STATE_COMPLETED,
        resultado: extraerResultado(tareaActual),
        agenteNombre,
        endpoint,
      };
    }
    if (esTerminalDeFracaso(estado)) {
      const reason: MotivoDelegacionA2ANoCompletada = motivoDeEstadoTerminal(estado);
      return { ok: false, reason, estado, a2aTaskId: taskId, endpoint };
    }

    if (deps.ahoraMs() >= deadline) {
      // Best-effort (Requirement "CancelTask es best-effort..."): NUNCA
      // cambia el desenlace ya decidido como `timeout`, así que no vale la
      // pena esperarlo — dispararlo sin `await` evita hasta `requestTimeoutMs`
      // de latencia evitable al que llama (post-review PR2, Hallazgo 4).
      // `.catch()` es una red de seguridad: `intentarCancelTask` no debería
      // rechazar (su `consultarOControlarTarea` interno ya no rechaza tras
      // el fix del Hallazgo 1), pero el transporte no puede confiar
      // ciegamente en eso. Molde de `webhooks/server.ts` (`void onEvent(...).catch(...)`).
      void intentarCancelTask({
        endpoint,
        destino: input.destino,
        taskId,
        idJsonRpc: idJsonRpc++,
        casoId: input.casoId,
        deps,
      }).catch(() => {
        // Red de seguridad — ver comentario arriba.
      });
      return {
        ok: false,
        reason: "timeout",
        estado,
        a2aTaskId: taskId,
        endpoint,
        ...(ultimoDetalleTransporte !== undefined ? { detalle: ultimoDetalleTransporte } : {}),
      };
    }

    await deps.dormir(deps.config.pollIntervalMs);
    intento += 1;

    const consulta = await consultarOControlarTarea({
      endpoint,
      destino: input.destino,
      body: { jsonrpc: "2.0", id: idJsonRpc++, method: "GetTask", params: { id: taskId } },
      deps,
    });

    if (!consulta.ok) {
      if (consulta.reason === "protocolo") {
        return { ok: false, reason: "protocolo", endpoint, a2aTaskId: taskId };
      }
      ultimoDetalleTransporte = consulta.detalle;
      // NUNCA se incluye `detalle` acá (code-review, hallazgo 3): es el
      // cuerpo crudo de la respuesta del agente externo, truncado pero SIN
      // redactar — ya sobrevive hasta el `return` final vía
      // `ultimoDetalleTransporte` (ver comentario arriba), no hace falta
      // loguearlo crudo en cada iteración del polling. Mismo criterio que
      // `build-on-venta.ts`/`build-on-comando-empleado.ts`: el `detalle`
      // crudo de un fallo A2A nunca entra a un `logEvent`.
      deps.logEvent(input.casoId, "a2a-poll-fallido", {
        a2aTaskId: taskId,
        reason: consulta.reason,
        intento,
      });
      continue;
    }

    tareaActual = consulta.task;
  }
}
