import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SCRYPT_ALGORITMO,
  SCRYPT_KEY_BYTES,
  SCRYPT_MAX_MEM_BYTES,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_BYTES,
  hashPassword,
  verificarPassword,
} from "./password.js";

/**
 * Design.md §4, §10.3 (ADR 30, 35). Único archivo de test que paga el costo
 * real del KDF (~10 derivaciones) — deliberado, `verificarPassword` NUNCA
 * lanza y hay que probarlo contra un hash corrupto de verdad, no un doble.
 */

describe("hashPassword / verificarPassword", () => {
  it("ida y vuelta: verificarPassword(p, hashPassword(p)) es true", () => {
    const hash = hashPassword("mi-contraseña-segura");
    expect(verificarPassword("mi-contraseña-segura", hash)).toBe(true);
  });

  it("contraseña equivocada devuelve false", () => {
    const hash = hashPassword("correcta");
    expect(verificarPassword("incorrecta", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (salt por fila) y ambos validan", () => {
    const hash1 = hashPassword("misma-clave");
    const hash2 = hashPassword("misma-clave");

    expect(hash1).not.toBe(hash2);
    expect(verificarPassword("misma-clave", hash1)).toBe(true);
    expect(verificarPassword("misma-clave", hash2)).toBe(true);
  });

  it("acepta un salt inyectado por parámetro, solo para test — dos llamadas con el mismo salt dan el mismo hash", () => {
    const salt = Buffer.from("0123456789abcdef", "utf8");
    expect(salt.length).toBe(SCRYPT_SALT_BYTES);

    const hash1 = hashPassword("clave-fija", salt);
    const hash2 = hashPassword("clave-fija", salt);

    expect(hash1).toBe(hash2);
  });

  it("formato: seis campos scrypt$N$r$p$salt$clave, con las constantes exactas y los tamaños esperados tras decodificar base64", () => {
    const hash = hashPassword("cualquier-cosa");
    const campos = hash.split("$");

    expect(campos).toHaveLength(6);
    expect(campos[0]).toBe(SCRYPT_ALGORITMO);
    expect(campos[1]).toBe(String(SCRYPT_N));
    expect(campos[2]).toBe(String(SCRYPT_R));
    expect(campos[3]).toBe(String(SCRYPT_P));
    expect(Buffer.from(campos[4] ?? "", "base64").length).toBe(SCRYPT_SALT_BYTES);
    expect(Buffer.from(campos[5] ?? "", "base64").length).toBe(SCRYPT_KEY_BYTES);
  });

  it.each<[string, string]>([
    ["cadena vacía", ""],
    ["pocos campos", "scrypt$1$2$3"],
    ["algoritmo distinto", "bcrypt$16384$8$1$c2FsdA==$Y2xhdmU="],
    ["N no numérico", "scrypt$abc$8$1$c2FsdA==$Y2xhdmU="],
    ["N enorme (guarda de maxmem)", "scrypt$1073741824$8$1$c2FsdA==$Y2xhdmU="],
    ["base64 basura", "scrypt$16384$8$1$!!!no-es-base64!!!$Y2xhdmU="],
    ["clave vacía", "scrypt$16384$8$1$c2FsdA==$"],
  ])("hash corrupto (%s) → false, sin lanzar", (_descripcion, hashCorrupto) => {
    expect(() => verificarPassword("cualquiera", hashCorrupto)).not.toThrow();
    expect(verificarPassword("cualquiera", hashCorrupto)).toBe(false);
  });

  it("hash con la clave truncada un byte, contraseña equivocada → false, sin lanzar RangeError de timingSafeEqual", () => {
    // El chequeo de longitud (paso 5, design.md §4) evita el `RangeError` que
    // `timingSafeEqual` lanzaría si `derivada` y `clave` tuvieran distinto
    // largo: la longitud de la derivación se toma de la clave ALMACENADA
    // (31 bytes acá), así que ambos buffers miden lo mismo y la comparación
    // corre sin lanzar. No se afirma sobre el resultado con la contraseña
    // CORRECTA: `scryptSync` deriva con PBKDF2 internamente, que es
    // prefijo-consistente entre largos — truncar la clave no invalida un
    // prefijo que coincide por construcción. Lo que este test fija es la
    // garantía real del guard: ninguna longitud distinta llega nunca a
    // `timingSafeEqual`, y una contraseña equivocada sigue dando `false`.
    const hashCompleto = hashPassword("clave-de-prueba");
    const campos = hashCompleto.split("$");
    const claveCompleta = Buffer.from(campos[5] ?? "", "base64");
    const claveTruncada = claveCompleta.subarray(0, claveCompleta.length - 1).toString("base64");
    const hashTruncado = [...campos.slice(0, 5), claveTruncada].join("$");

    expect(() => verificarPassword("otra-contraseña", hashTruncado)).not.toThrow();
    expect(verificarPassword("otra-contraseña", hashTruncado)).toBe(false);
  });

  it("hash con costo entre 32 MiB (maxmem default de Node) y 64 MiB (SCRYPT_MAX_MEM_BYTES) verifica con la contraseña correcta", () => {
    // El guard de verificarPassword acepta cualquier N/r con
    // `128 * N * r <= SCRYPT_MAX_MEM_BYTES` (64 MiB). Pero si scryptSync no
    // recibe `maxmem` explícito, Node aplica su propio default de 32 MiB y
    // tira `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` para cualquier costo por
    // encima de eso — excepción que el catch de verificarPassword traga
    // como `false`, bloqueando para siempre a un empleado con la
    // contraseña CORRECTA. N=16384, r=17 cae justo en esa ventana rota.
    const n = 16_384;
    const r = 17;
    const p = SCRYPT_P;
    const costoBytes = 128 * n * r;
    expect(costoBytes).toBeGreaterThan(32 * 1024 * 1024);
    expect(costoBytes).toBeLessThanOrEqual(SCRYPT_MAX_MEM_BYTES);

    const password = "clave-de-costo-alto";
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    // Deriva la clave "de referencia" con maxmem explícito — así el hash de
    // prueba es válido y consistente, sin depender del bug bajo prueba.
    const clave = scryptSync(password, salt, SCRYPT_KEY_BYTES, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_MAX_MEM_BYTES,
    });
    const hash = [
      SCRYPT_ALGORITMO,
      String(n),
      String(r),
      String(p),
      salt.toString("base64"),
      clave.toString("base64"),
    ].join("$");

    expect(() => verificarPassword(password, hash)).not.toThrow();
    expect(verificarPassword(password, hash)).toBe(true);
  });

  it("contraseña vacía y contraseña de 1 KB no lanzan en ninguna de las dos funciones", () => {
    const vacia = "";
    const larga = "x".repeat(1024);

    expect(() => hashPassword(vacia)).not.toThrow();
    expect(() => hashPassword(larga)).not.toThrow();
    expect(verificarPassword(vacia, hashPassword(vacia))).toBe(true);
    expect(verificarPassword(larga, hashPassword(larga))).toBe(true);
  });
});
