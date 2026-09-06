/**
 * Recortes estructurales de `http.IncomingMessage` / `http.ServerResponse`,
 * mismo truco que `RenderTui` sobre el `render` de Ink y `QueryFn` sobre el
 * `query` del SDK: los tipos reales de `node:http` los satisfacen
 * estructuralmente, así producción pasa los objetos reales y los tests pasan
 * dobles planos SIN abrir ningún puerto ni mockear `node:http`.
 *
 * DUPLICADOS a propósito de `src/adapters/webhooks/server.ts:30-55` — ver
 * ADR 13. Importarlos de ahí sería un adaptador dependiendo de otro; moverlos
 * a `src/core/` metería HTTP en el vocabulario del núcleo para siempre. Si
 * aparece un TERCER adaptador HTTP entrante, ese es el disparador para
 * reconsiderar.
 *
 * Diferencia real con la versión de webhooks, no cosmética: acá `WebResponse`
 * necesita `writeHead`-equivalente con varios headers (`Content-Type`,
 * `Cache-Control`, `Referrer-Policy`, `X-Request-Id` — ADR 20 punto 5), así
 * que `setHeader` se usa más de una vez por respuesta.
 */
export interface WebRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface WebResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface WebHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateWebServerFn = (
  listener: (req: WebRequest, res: WebResponse) => void,
) => WebHttpServerLike;
