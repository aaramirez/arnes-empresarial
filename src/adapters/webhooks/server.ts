/**
 * Listener HTTP del webhook de GitHub (Hito 3, tarea 11).
 *
 * Aísla el manejo de una request/response del ciclo de vida del servidor
 * (`createRequestListener`) para que cada respuesta se pueda testear con
 * dobles planos de `WebhookRequest`/`WebhookResponse` — sin abrir ningún
 * puerto real ni mockear `node:http`. `startServer` monta ese listener sobre
 * un servidor real (o inyectado en tests) y agrega el drenaje de `onEvent`
 * en vuelo al cerrar (ADR 10, punto 2).
 *
 * Orden de checks dentro de `createRequestListener` — EXHAUSTIVO, no se
 * reordena (design.md §4.4):
 *   método/path → tope de body → firma → JSON.parse → mapGithubEvent →
 *   ack (202) + onEvent sin await.
 */
import { createServer as createHttpServer } from "node:http";
import type { IncomingActivityEvent } from "../../core/activity/activity-contract.js";
import { SERVER_CLOSE_TIMEOUT_MS, WEBHOOK_LOG_CORRELATION_ID, type WebhookConfig } from "./config.js";
import { mapGithubEvent } from "./github-mapper.js";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, verifySignature } from "./signature.js";

/**
 * Recorte estructural de `http.IncomingMessage` / `http.ServerResponse` — el
 * mismo truco que `RenderTui` usa sobre el `render` de Ink y `QueryFn` sobre
 * el `query` del SDK (ambos verificados en el repo): los tipos reales de
 * `node:http` los satisfacen estructuralmente, así que producción pasa los
 * objetos reales y los tests pasan dobles planos SIN abrir ningún puerto ni
 * mockear `node:http`.
 */
export interface WebhookRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface WebhookResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface HttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateServerFn = (
  listener: (req: WebhookRequest, res: WebhookResponse) => void,
) => HttpServerLike;

export interface WebhookServerDeps {
  readonly config: WebhookConfig;
  /**
   * Callback inyectado desde el composition root (ADR 5, punto 3; molde
   * `startTui(onSubmit)`). El adaptador NO sabe qué hace: solo que devuelve
   * una promesa y que NUNCA debe rechazar (`build-on-activity.ts` traga y
   * loguea, §6.2). El `.catch` de acá es red de seguridad, no el mecanismo.
   */
  readonly onEvent: (evento: IncomingActivityEvent) => Promise<void>;
  /** Ya cerrado sobre el id de correlación de transporte. Ver §9. */
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly now?: () => string;
  /** Login del bot (resuelto una vez al arrancar el proceso, `resolveBotLogin`) — filtro anti-loop de `mapGithubEvent`. */
  readonly botLogin?: string;
}

export interface WebhookServerHandle {
  readonly port: number;
  /** Ver ADR 10: deja de aceptar, drena los `onEvent` en vuelo con techo de `SERVER_CLOSE_TIMEOUT_MS`, resuelve. NUNCA rechaza. */
  close(): Promise<void>;
}

/** Header falta en un array (nunca debería pasar en GitHub real, pero se resuelve igual). */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/** `req.url` recortado en el primer `?`, para tolerar un proxy de forwarding con querystring. */
function pathFromUrl(url: string | undefined): string {
  if (url === undefined) {
    return "";
  }
  const questionMarkIndex = url.indexOf("?");
  return questionMarkIndex === -1 ? url : url.slice(0, questionMarkIndex);
}

/**
 * `payload.action` solo existe en algunos eventos de GitHub (ej.
 * `pull_request.opened`) — guard estructural que nunca lanza si `payload` no
 * tiene esa forma (design.md §9.2, evento `webhook-recibido`).
 */
function extractPayloadAction(payload: unknown): string | undefined {
  return typeof payload === "object" &&
    payload !== null &&
    "action" in payload &&
    typeof (payload as { action: unknown }).action === "string"
    ? (payload as { action: string }).action
    : undefined;
}

/**
 * El listener HTTP, aislado del ciclo de vida del servidor para poder
 * testear cada respuesta con dobles planos.
 *
 * Tabla de respuestas — EXHAUSTIVA:
 * | Condición | Status | Efecto |
 * |---|---|---|
 * | `method !== "POST"` o path ≠ `config.path` | `404` | nada |
 * | body acumulado > `config.maxBodyBytes` | `413` | `req.destroy()`, sin HMAC, sin parse (ADR 9) |
 * | `"error"` en el request | `400` | nada |
 * | firma ausente/inválida | `401` | `webhook-firma-invalida`. NINGUNA fila creada |
 * | `JSON.parse` falla | `400` | `webhook-payload-invalido` |
 * | `mapGithubEvent` → `undefined` | `202` | `webhook-evento-ignorado`, sin actividad |
 * | evento válido | `202` | responde PRIMERO, después `onEvent(...)` sin `await` (ADR 10) |
 *
 * El path se compara contra `req.url` recortado en el primer `?` — GitHub
 * no manda query string, pero un proxy de forwarding (`smee`, `gh webhook
 * forward`) puede agregar una.
 *
 * Firma EXACTA de design.md §4.4 — un solo parámetro. El drenaje de
 * `onEvent` en vuelo (ADR 10, punto 2) es responsabilidad exclusiva de
 * `startServer`, que envuelve `deps.onEvent` antes de llamar a esta función;
 * `createRequestListener` no sabe nada de ese `Set` y es puro respecto al
 * transporte real.
 */
export function createRequestListener(
  deps: WebhookServerDeps,
): (req: WebhookRequest, res: WebhookResponse) => void {
  const { config, onEvent, logEvent, botLogin } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  return (req: WebhookRequest, res: WebhookResponse): void => {
    const path = pathFromUrl(req.url);
    if (req.method !== "POST" || path !== config.path) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const deliveryId = firstHeaderValue(req.headers[DELIVERY_HEADER]) ?? "";

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > config.maxBodyBytes) {
        settled = true;
        res.statusCode = 413;
        res.end();
        req.destroy();
        logEvent(deliveryId, "webhook-rechazado-tamano", { receivedBytes });
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      res.statusCode = 400;
      res.end();
    });

    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;

      const eventName = firstHeaderValue(req.headers[EVENT_HEADER]);
      const rawBody = Buffer.concat(chunks);

      const signatureHeader = req.headers[SIGNATURE_HEADER];
      if (!verifySignature(rawBody, signatureHeader, config.secret)) {
        res.statusCode = 401;
        res.end();
        logEvent(deliveryId, "webhook-firma-invalida", {});
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.statusCode = 400;
        res.end();
        logEvent(deliveryId, "webhook-payload-invalido", {});
        return;
      }

      const action = extractPayloadAction(payload);
      logEvent(deliveryId, "webhook-recibido", {
        event: eventName,
        ...(action !== undefined ? { action } : {}),
        bytes: rawBody.length,
      });

      const evento = mapGithubEvent({
        eventName,
        payload,
        deliveryId,
        recibidoEn: now(),
        ...(botLogin !== undefined ? { botLogin } : {}),
      });

      if (evento === undefined) {
        res.statusCode = 202;
        res.end();
        logEvent(deliveryId, "webhook-evento-ignorado", { eventName });
        return;
      }

      // ADR 10: ack primero, `onEvent` recién después, SIN await.
      res.statusCode = 202;
      res.end();

      void onEvent(evento).catch(() => {
        // Red de seguridad: `onEvent` (`runActivityTurn` vía
        // `build-on-activity.ts`) nunca debería rechazar por contrato, pero
        // el adaptador de transporte no puede confiar ciegamente en eso.
      });
    });
  };
}

/**
 * Monta el listener sobre un servidor HTTP. `createServer` se inyecta
 * (default: `http.createServer` real) para que ningún test del suite por
 * defecto abra un puerto — criterio de aceptación de la propuesta.
 *
 * `listen(config.port)` y `on("error")`: un `EADDRINUSE` rechaza esta
 * promesa con un error legible; `index.ts` decide qué hacer con eso (§4.5).
 */
export function startServer(
  deps: WebhookServerDeps,
  createServer: CreateServerFn = (listener) =>
    createHttpServer((req, res) => listener(req as unknown as WebhookRequest, res)),
): Promise<WebhookServerHandle> {
  const enVuelo = new Set<Promise<void>>();

  // `createRequestListener` no conoce el `Set` de drenaje (design.md §4.4:
  // firma de un solo parámetro). `startServer` envuelve `onEvent` para
  // registrar cada promesa en vuelo antes de pasarla al listener — así el
  // tracking del ADR 10, punto 2 queda enteramente acá.
  const onEventConDrenaje = (evento: IncomingActivityEvent): Promise<void> => {
    const promesa = deps.onEvent(evento);
    enVuelo.add(promesa);
    const olvidar = (): void => {
      enVuelo.delete(promesa);
    };
    // `.then(olvidar, olvidar)` en vez de `.finally` para no generar una
    // promesa hija sin manejar si `promesa` rechaza: acá ambas ramas
    // resuelven, la red de seguridad del `.catch` real vive en
    // `createRequestListener`.
    promesa.then(olvidar, olvidar);
    return promesa;
  };

  const listener = createRequestListener({ ...deps, onEvent: onEventConDrenaje });
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

      const handle: WebhookServerHandle = {
        port: deps.config.port,
        close(): Promise<void> {
          return new Promise((resolveClose) => {
            server.close(() => {
              const drenaje = Promise.allSettled([...enVuelo]).then(() => undefined);
              const timeout = new Promise<"timeout">((resolveTimeout) => {
                setTimeout(() => resolveTimeout("timeout"), SERVER_CLOSE_TIMEOUT_MS);
              });

              void Promise.race([drenaje.then(() => "drenado" as const), timeout]).then(
                (resultado) => {
                  if (resultado === "timeout") {
                    deps.logEvent(WEBHOOK_LOG_CORRELATION_ID, "webhook-cierre-con-turnos-en-vuelo", {
                      enVuelo: enVuelo.size,
                    });
                  }
                  resolveClose();
                },
              );
            });
          });
        },
      };

      resolve(handle);
    });
  });
}
