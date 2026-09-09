import type { A2AConfig, DestinoA2AConfig } from "./config.js";
import type { DestinoA2AClave, ResultadoA2A } from "../../core/agents/a2a-contract.js";

/**
 * Cliente A2A saliente — el único archivo de este adaptador que habla HTTP
 * (Hito 6, tarea 4, design.md §6.2 parte 1, ADR 71 pto 6, 72 pto 5).
 *
 * Esta tarea implementa SOLO la resolución del Agent Card y el envío de
 * `SendMessage` (design.md §6.2 parte 1). El loop de `GetTask`/`CancelTask`,
 * la clasificación completa de fallas sobre `status.state`, el truncado del
 * cuerpo de error y la extracción del texto de resultado son de la tarea 5
 * (design.md §6.2 parte 2), que EXTIENDE este mismo archivo.
 *
 * `delegarTarea` NUNCA rechaza (ADR 77): todo desenlace vuelve como
 * `ResultadoA2A`.
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
 * No se usa todavía en esta tarea (el truncado de cuerpos de error es de la
 * tarea 5); queda declarada acá porque es la constante que esa tarea
 * extiende sobre este mismo archivo.
 */
const ERROR_BODY_MAX_CHARS = 500;

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

/**
 * Dependencias que este adaptador necesita — molde literal de
 * `A2AClientDeps` en design.md §6.2. `ahoraMs`/`dormir` están declarados acá
 * porque son parte del contrato del archivo completo (design.md §6.2 parte
 * 2, tarea 5, loop de `GetTask`), aunque esta tarea todavía no los use.
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
  | { readonly ok: true; readonly endpoint: string }
  | { readonly ok: false; readonly reason: "transporte" | "protocolo" };

interface EntradaAgentCard {
  readonly url?: unknown;
  readonly protocolBinding?: unknown;
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
 * caída o `!response.ok`) ⇒ `transporte`.
 */
async function resolverEndpointJsonRpc(input: {
  readonly baseUrl: string;
  readonly fetchFn: FetchFn;
  readonly requestTimeoutMs: number;
}): Promise<ResolucionAgentCard> {
  const url = `${input.baseUrl}/.well-known/agent-card.json`;

  let response: FetchResponseLike;
  try {
    response = await input.fetchFn(url, {
      method: "GET",
      headers: {},
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
  return { ok: true, endpoint };
}

type EnvioSendMessage = { readonly ok: true } | { readonly ok: false };

/**
 * Paso 2 del ciclo (design.md §6.2): `POST <endpoint>` con el sobre exacto
 * de la tabla (`method: "SendMessage"`, `params.message.role: "ROLE_USER"`).
 * `SendMessage` se envía exactamente una vez por delegación. El header
 * `Authorization` se arma acá y NUNCA se incluye en un mensaje ni en un
 * evento. Falla de red o `!response.ok` ⇒ `transporte` (quien llama decide
 * el resto del `ResultadoA2AFallo`, porque acá no se conoce todavía el
 * endpoint resuelto para incluirlo).
 */
async function enviarSendMessage(input: {
  readonly endpoint: string;
  readonly destino: DestinoA2AConfig;
  readonly tarea: string;
  readonly deps: A2AClientDeps;
}): Promise<EnvioSendMessage> {
  const { endpoint, destino, tarea, deps } = input;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (destino.authToken !== undefined) {
    headers.Authorization = `Bearer ${destino.authToken}`;
  }

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
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.config.requestTimeoutMs),
    });
  } catch {
    return { ok: false };
  }

  if (!response.ok) {
    return { ok: false };
  }

  return { ok: true };
}

/**
 * El ciclo de UNA delegación externa. En esta tarea (4) llega hasta el envío
 * de `SendMessage`: resuelve el Agent Card, envía el mensaje, y clasifica
 * `transporte`/`protocolo` en las dos llamadas. NUNCA rechaza (ADR 77).
 *
 * La tarea 5 (design.md §6.2 parte 2) EXTIENDE esta función con el loop real
 * de `GetTask`/`CancelTask`. Sin ese loop todavía, un `SendMessage` exitoso
 * se reporta como `reason: "timeout"` en vez de inventar un desenlace
 * (`ok: true` o cualquier otro `reason`) que este archivo, en su alcance
 * actual, no puede verificar.
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
    baseUrl: input.destino.baseUrl,
    fetchFn: deps.fetchFn,
    requestTimeoutMs: deps.config.requestTimeoutMs,
  });
  if (!cardResult.ok) {
    return { ok: false, reason: cardResult.reason };
  }

  const sendResult = await enviarSendMessage({
    endpoint: cardResult.endpoint,
    destino: input.destino,
    tarea: input.tarea,
    deps,
  });
  if (!sendResult.ok) {
    return { ok: false, reason: "transporte", endpoint: cardResult.endpoint };
  }

  return { ok: false, reason: "timeout", endpoint: cardResult.endpoint };
}
