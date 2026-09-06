import type { WebRequest } from "./http.js";

/**
 * Mismo mecanismo de acumulación con tope que fija el ADR 9 de Hito 3 y que
 * `webhooks/server.ts:159-182` ya implementa (verificado) — reimplementado
 * acá por ADR 13 (un adaptador no importa de otro adaptador).
 *
 * Diferencia real, no cosmética: acá no hay firma que verificar (no hay
 * orden "tope → HMAC → parse" que respetar — ver `payloads.ts` para el
 * orden real de este hito, `tope → auth (solo /ventas) → parse`), y el
 * corte por tamaño NO escribe ninguna respuesta: devuelve un resultado
 * discriminado y deja la decisión de qué status HTTP corresponde al
 * ruteador, que es quien sabe si la ruta responde HTML o JSON.
 */
export type LeerBodyResultado =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly motivo: "tamano" | "error-transporte" };

/**
 * Acumula el body de `req` en memoria, cortando en `maxBodyBytes` ANTES de
 * guardar el chunk que haría superar el tope (ese chunk se descarta
 * entero, no se trunca parcialmente). Al cortar por tamaño, NO toca el
 * transporte (no llama `req.destroy()` ni escribe nada en `res`): solo
 * devuelve el resultado discriminado. `req`/`res` comparten el mismo
 * socket TCP, y `leerBody` no sabe si el ruteador (tarea 17) ya escribió
 * la respuesta — destruir acá podría matar la conexión antes de que el
 * cliente reciba el `413`. Quien destruye el socket es el ruteador,
 * DESPUÉS de `res.end()` — mismo orden que `webhooks/server.ts:166-168`
 * (`res.statusCode = 413; res.end(); req.destroy();`).
 */
export function leerBody(req: WebRequest, maxBodyBytes: number): Promise<LeerBodyResultado> {
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
 * Resultado discriminado genérico de un parseo, reusado por `payloads.ts`
 * (tarea 15) — ver design.md §4.3. A diferencia de `LeerBodyResultado`, acá
 * `motivo` es `string` porque cada parser define sus propios mensajes en
 * castellano, estables para el `400` que ve la integración del vendedor.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly motivo: string };

/** Decodifica el body a texto UTF-8, sea `Buffer` o `string`. */
function aTexto(body: Buffer | string): string {
  return typeof body === "string" ? body : body.toString("utf8");
}

/** Parsea `body` como JSON. `JSON.parse` roto o body vacío → `ok:false`. */
export function parseJsonBody(body: Buffer | string): ParseResult<unknown> {
  try {
    return { ok: true, valor: JSON.parse(aTexto(body)) };
  } catch {
    return { ok: false, motivo: "JSON invalido" };
  }
}

/**
 * Decodifica `body` como `application/x-www-form-urlencoded` usando
 * `URLSearchParams` (no lanza con secuencias `%` malformadas — las deja
 * literales, comportamiento WHATWG verificado), por eso siempre resuelve
 * `ok:true`.
 */
export function parseFormBody(body: Buffer | string): ParseResult<Record<string, string>> {
  const params = new URLSearchParams(aTexto(body));
  const valor: Record<string, string> = {};
  for (const [clave, dato] of params) {
    valor[clave] = dato;
  }
  return { ok: true, valor };
}
