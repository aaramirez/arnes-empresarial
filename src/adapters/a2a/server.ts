/**
 * Listener HTTP del Servidor A2A entrante (Hito 7, tarea 8, design.md §6.3 —
 * parte 1a: tipos + auth + body). El ruteo por método+ruta, la publicación
 * del Agent Card (tarea 9) y el parseo del sobre JSON-RPC (tarea 10) NO están
 * acá todavía — `createRequestListener` no existe hasta la tarea 9.
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
 */
import { timingSafeEqual } from "node:crypto";

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
