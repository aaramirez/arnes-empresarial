/**
 * Sesión en memoria del proceso de la TUI (`tui-canal-empleado`, ADR 31).
 * Vive en la ranura del closure de `build-on-comando-empleado.ts` — NUNCA
 * se persiste (ADR 31 punto 4). Sin imports — mismo criterio que
 * `ventas-contract.ts`.
 *
 * ★ Es el tipo que expresa el invariante del ADR 37: el ÚNICO productor real
 *   es `resolverLogin`. Toda función que reciba una `SesionEmpleado` está
 *   declarando que su `empleadoId` fue AUTENTICADO, no tipeado. ★
 */
export interface SesionEmpleado {
  readonly empleadoId: string;
  /** ISO-8601 UTC. */
  readonly iniciadaEn: string;
  /** ISO-8601 UTC, o AUSENTE = sin expiración (`SESION_TTL_MINUTOS=0`, ADR 31 punto 2). */
  readonly expiraEn?: string;
}

/**
 * TTL ABSOLUTO desde el login, no deslizante (ADR 31 punto 2).
 *  · `sesion === undefined`        → `false`
 *  · `sesion.expiraEn === undefined` → `true` (opt-out explícito)
 *  · si no → `ahora < sesion.expiraEn`
 *
 * Comparación LEXICOGRÁFICA de strings, correcta SOLO porque todo timestamp
 * del repo es `new Date().toISOString()` — ISO-8601 UTC de ancho fijo (ADR
 * 16 de Hito 4, regla 3). El borde exacto (`ahora === expiraEn`) es
 * `false`: vencida, mismo criterio que `expires_at > @ahora` del CAS de
 * confirmación.
 */
export function sesionVigente(sesion: SesionEmpleado | undefined, ahora: string): boolean {
  if (sesion === undefined) {
    return false;
  }
  if (sesion.expiraEn === undefined) {
    return true;
  }
  return ahora < sesion.expiraEn;
}

/**
 * `iniciadaEn + ttlMinutos`, o `undefined` si `ttlMinutos === 0`.
 * Molde EXACTO de `calcularExpiresAt` (`token-confirmacion.ts`):
 * `new Date(Date.parse(iniciadaEn) + ttlMinutos * 60_000).toISOString()`.
 *
 * DUPLICACIÓN INTENCIONAL (fix de review, hallazgo de duplicación): extraer
 * el algoritmo a un helper compartido rompería el invariante testeado de
 * este módulo — cero dependencias cargadas desde otro archivo (ver test
 * `sesion.ts source` abajo) — `sesion.ts` no puede depender de
 * `token-confirmacion.ts` ni de un tercer archivo sin dejar de ser un
 * módulo puro sin dependencias. Se acepta la duplicación en vez de reabrir
 * ese invariante en un cleanup no bloqueante; si algún día cambia, es una
 * decisión de diseño, no de Implementer.
 */
export function calcularExpiraEn(iniciadaEn: string, ttlMinutos: number): string | undefined {
  if (ttlMinutos === 0) {
    return undefined;
  }
  return new Date(Date.parse(iniciadaEn) + ttlMinutos * 60_000).toISOString();
}
