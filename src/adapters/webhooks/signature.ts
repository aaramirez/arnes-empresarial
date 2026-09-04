import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";
export const EVENT_HEADER = "x-github-event";
export const DELIVERY_HEADER = "x-github-delivery";
export const SIGNATURE_PREFIX = "sha256=";

/**
 * `"sha256=" + HMAC-SHA256(secret, rawBody)` en hex minúscula. Exportada
 * para que los tests calculen la firma esperada con el mismo código que
 * GitHub usaría.
 */
export function computeSignature(rawBody: Buffer, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * Verificación en tiempo constante. Devuelve `false` (NUNCA lanza) si:
 * el header falta, viene vacío, viene como array, no empieza con
 * `SIGNATURE_PREFIX`, o su longitud en bytes difiere de la esperada.
 *
 * El chequeo de longitud es OBLIGATORIO antes de `timingSafeEqual`: esa
 * función LANZA `RangeError` si los buffers tienen distinto largo, así que
 * sin el chequeo previo una firma de largo raro sería una excepción no
 * capturada en el handler HTTP en vez de un `401`.
 *
 * Se compara sobre `Buffer.from(x, "utf8")` de las dos cadenas COMPLETAS
 * (con prefijo incluido), no sobre el hex parseado: comparar los bytes tal
 * como llegaron evita cualquier normalización intermedia.
 */
export function verifySignature(
  rawBody: Buffer,
  headerValue: string | string[] | undefined,
  secret: string,
): boolean {
  if (typeof headerValue !== "string" || headerValue === "") {
    return false;
  }
  if (!headerValue.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = computeSignature(rawBody, secret);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(headerValue, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
