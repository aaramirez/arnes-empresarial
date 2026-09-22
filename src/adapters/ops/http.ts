/**
 * Recortes estructurales de `http.IncomingMessage` / `http.ServerResponse`
 * para el listener `ops`, mismo truco que `WebRequest`/`WebResponse` de
 * `src/adapters/web/http.ts` y `WebhookRequest`/`WebhookResponse` de
 * `src/adapters/webhooks/server.ts`: los tipos reales de `node:http` los
 * satisfacen estructuralmente, así producción pasa los objetos reales y los
 * tests pasan dobles planos SIN abrir ningún puerto ni mockear `node:http`.
 *
 * DUPLICADOS a propósito (ADR 256) de `web/http.ts:19-49`,
 * `webhooks/server.ts:30-55` y `a2a/server.ts:71-110`. El disparador
 * original del ADR 13 ("si aparece un TERCER adaptador HTTP entrante, ese es
 * el disparador para reconsiderar") ya se gastó en v3.0, cuando el A2A llegó
 * como tercero y volvió a duplicar en vez de abstraer — no se puede invocar
 * de nuevo como si estuviera intacto. Este es el CUARTO recorte, y reemplaza
 * ese disparador agotado por un criterio de sucesión concreto:
 *
 * > El patrón de duplicación se corta cuando se cumplan LAS DOS condiciones
 * > a la vez: (a) un adaptador HTTP nuevo necesita una forma que NO es
 * > subconjunto de ninguna de las existentes, Y (b) al menos DOS adaptadores
 * > compartirían exactamente la misma forma. Mientras alguna de las dos
 * > falle, duplicar es más barato que abstraer.
 *
 * Bajo ese criterio, `OpsRequest` duplica sin discusión: es un SUBCONJUNTO
 * ESTRICTO de los otros tres (solo `method` + `url` — sin `headers`, sin
 * `on("data"/"end"/"error")`, sin `destroy`, sin `resume`, sin
 * `socket.remoteAddress`), porque `ops` no lee body y no necesita drenar
 * ningún stream: sus dos handlers son síncronos y responden en el mismo
 * tick. Alternativas descartadas (`design.md` §4.3): importar `web/http.ts`
 * (adaptador→adaptador, prohibido por `AGENTS.md`); subirlos a `src/core/`
 * (el propio comentario del ADR 13 lo veta: "metería HTTP en el vocabulario
 * del núcleo para siempre"); un `src/http-shapes.ts` raíz (obligaría a abrir
 * los tres adaptadores existentes y sus tres suites, un change propio, no un
 * slice de este hijo).
 *
 * ★ Qué le falta para el hijo 6 (`/metrics`, R44) y por qué: si esa ruta
 * necesita leer el body o mantener turnos asíncronos en vuelo, el hijo 6
 * tiene que agregar su propio `Set<Promise>` y volver a meter el race de
 * `close()` DENTRO del callback (R45) — este recorte y el `close()` de
 * `server.ts` asumen handlers síncronos. Ampliarlo es aditivo (agregar
 * miembros), no un rediseño.
 */
export interface OpsRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
}

export interface OpsResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface OpsHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  /** `OPS_HOST` no blanco — mismo molde RD-123 del hijo 1 que `WebHttpServerLike`. */
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  /**
   * ★ OBLIGATORIO en `ops` (a diferencia de `WebHttpServerLike`, donde queda
   * opcional): el listener de salud es el que un supervisor golpea con más
   * frecuencia, así que el riesgo de un `close()` colgado detrás de un
   * keep-alive ocioso (documentado hoy solo para A2A, `a2a/server.ts:95-105`)
   * es el más caro de dejar sin cubrir aquí. Un doble sin este método NO
   * compila bajo `npm run typecheck` (`design.md` §0.4, R32).
   */
  closeIdleConnections(): unknown;
}

export type CreateOpsServerFn = (
  listener: (req: OpsRequest, res: OpsResponse) => void,
) => OpsHttpServerLike;
