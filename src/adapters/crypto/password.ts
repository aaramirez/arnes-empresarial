/**
 * Adaptador de hashing de contraseñas (`tui-canal-empleado`, ADR 30, 35).
 * Hermano exacto de `adapters/webhooks/signature.ts` (mismo tamaño, mismo
 * contrato de "nunca lanza", mismo chequeo de longitud previo a
 * `timingSafeEqual`). Cero dependencias nuevas — solo `node:crypto`.
 *
 * `verificarPassword` se inyecta en `src/core/auth/login.ts` por su forma
 * estructural `(string, string) => boolean`; el núcleo no importa este
 * módulo ni sabe que existe scrypt (regla no negociable de `AGENTS.md`).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SCRYPT_ALGORITMO = "scrypt";
export const SCRYPT_N = 16_384; // 2^14 — 128 * N * r = 16 MiB, bajo el maxmem default de Node (32 MiB)
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_BYTES = 32;
export const SCRYPT_SALT_BYTES = 16;
/**
 * Guarda anti-DoS (ADR 35 punto 3): un hash escrito a mano con un `N`
 * gigante (R16: quien puede escribir `credenciales_empleado` puede) no va a
 * hacer que `scryptSync` intente reservar cientos de GB o lance.
 */
export const SCRYPT_MAX_MEM_BYTES = 64 * 1024 * 1024;

const CAMPOS_ESPERADOS = 6;

/**
 * `scrypt$16384$8$1$<salt-base64>$<clave-base64>`. `salt` es inyectable
 * SOLO para el test (default: `randomBytes(SCRYPT_SALT_BYTES)`) — mismo
 * criterio que `newToken`/`newId` inyectados en `build-on-venta.ts`. Dos
 * llamadas con la misma contraseña y sin `salt` explícito dan hashes
 * DISTINTOS: un salt nuevo por fila.
 */
export function hashPassword(password: string, salt: Buffer = randomBytes(SCRYPT_SALT_BYTES)): string {
  const clave = scryptSync(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEM_BYTES,
  });
  return [
    SCRYPT_ALGORITMO,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    clave.toString("base64"),
  ].join("$");
}

function decodeBase64Estricto(valor: string): Buffer | undefined {
  const decoded = Buffer.from(valor, "base64");
  // `Buffer.from` ignora basura en silencio en vez de lanzar; el round-trip
  // es lo que detecta un hash corrupto (design.md §4).
  if (decoded.toString("base64") !== valor) {
    return undefined;
  }
  return decoded;
}

/**
 * NUNCA LANZA — devuelve `false` ante cualquier hash malformado o cualquier
 * excepción de `scryptSync`. Molde de `verifySignature`
 * (`adapters/webhooks/signature.ts`). Pasos (design.md §4):
 *  1. `hash.split("$")` ⇒ exactamente 6 campos, y `campos[0] === "scrypt"`.
 *  2. `N`, `r`, `p` enteros `>= 1`, y `128 * N * r <= SCRYPT_MAX_MEM_BYTES`.
 *  3. `salt` y `clave` decodifican de base64 con longitud `> 0` (round-trip
 *     verificado).
 *  4. `derivada = scryptSync(...)`, envuelto en `try/catch`.
 *  5. Chequeo de longitud ANTES de `timingSafeEqual` — esa función LANZA
 *     `RangeError` con buffers de distinto largo.
 *  6. `timingSafeEqual(derivada, clave)`.
 */
export function verificarPassword(password: string, hash: string): boolean {
  const campos = hash.split("$");
  if (campos.length !== CAMPOS_ESPERADOS) {
    return false;
  }

  const [algoritmo, nRaw, rRaw, pRaw, saltRaw, claveRaw] = campos;
  if (algoritmo !== SCRYPT_ALGORITMO) {
    return false;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    !Number.isInteger(r) ||
    r < 1 ||
    !Number.isInteger(p) ||
    p < 1
  ) {
    return false;
  }
  if (128 * n * r > SCRYPT_MAX_MEM_BYTES) {
    return false;
  }

  const salt = decodeBase64Estricto(saltRaw ?? "");
  const clave = decodeBase64Estricto(claveRaw ?? "");
  if (salt === undefined || salt.length === 0 || clave === undefined || clave.length === 0) {
    return false;
  }

  let derivada: Buffer;
  try {
    derivada = scryptSync(password, salt, clave.length, { N: n, r, p, maxmem: SCRYPT_MAX_MEM_BYTES });
  } catch {
    return false;
  }

  if (derivada.length !== clave.length) {
    return false;
  }

  return timingSafeEqual(derivada, clave);
}
