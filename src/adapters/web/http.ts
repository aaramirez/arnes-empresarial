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
  /**
   * Pone el stream en modo `flowing` sin leer el body (`chat-web-empleado`,
   * ADR 201 pto 5): `POST /logout` no necesita el cuerpo pero igual hay que
   * drenarlo antes de responder, para no dejar el socket a medio consumir.
   */
  resume(): unknown;
}

export interface WebResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface WebHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  /** `modo-headless-cierre-limpio` (E2, RD-123): solo con `WEB_HOST` no blanco. */
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  /**
   * Fuerza el cierre de conexiones keep-alive OCIOSAS (Node 18.2+), sin
   * afectar las que tienen una request en curso (`modo-headless-cierre-limpio`,
   * design §0.2; molde de `a2a/server.ts`). Sin esto `close()` puede colgar
   * detras de un cliente keep-alive que nunca cierra su conexion. Opcional en
   * el tipo (como `closeAllConnections?` en webhooks): un doble sin el metodo
   * sigue siendo valido; el `http.Server` real de Node 18.2+ lo trae.
   *
   * ★ Decisión deliberada (hallazgo 2, revisión post-Reviewer): `a2a/server.ts`
   * SÍ lo declara obligatorio, así que esto queda inconsistente entre
   * adaptadores. No se sube a obligatorio acá porque el doble de
   * `index.test.ts` (`FakeHttpServer`) no implementa `closeIdleConnections`
   * y SÍ ejercita `close()` — forzar el tipo no rompería el compilador (el
   * doble se castea vía `unknown`), pero rompería ese test en runtime con
   * `closeIdleConnections is not a function`. Mantener opcional + `?.()` es
   * la opción de menor riesgo mientras ese doble no se actualice.
   */
  closeIdleConnections?(): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateWebServerFn = (
  listener: (req: WebRequest, res: WebResponse) => void,
) => WebHttpServerLike;
