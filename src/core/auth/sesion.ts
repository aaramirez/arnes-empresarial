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
  /** Tope ABSOLUTO desde el login. NO se renueva NUNCA. Ausente = sin tope. (ADR 31 punto 2, significado INTACTO). */
  readonly expiraEn?: string;
  /** ★ NUEVO (ADR 231): vencimiento por INACTIVIDAD. Se RENUEVA en cada uso. Ausente = sin vencimiento por inactividad. */
  readonly inactivaEn?: string;
}

/**
 * Vigente sólo si las DOS condiciones se cumplen: `ahora < expiraEn` (tope
 * ABSOLUTO desde el login, no deslizante, ADR 31 punto 2) Y `ahora <
 * inactivaEn` (vencimiento por INACTIVIDAD, se renueva en cada uso vía
 * `renovarSesion`, ADR 231). Cada condición se saltea si su campo está
 * ausente — retrocompatibilidad con sesiones sin `inactivaEn`.
 *  · `sesion === undefined` → `false`
 *
 * Comparación LEXICOGRÁFICA de strings, correcta SOLO porque todo timestamp
 * del repo es `new Date().toISOString()` — ISO-8601 UTC de ancho fijo (ADR
 * 16 de Hito 4, regla 3). El borde exacto (`ahora === expiraEn` o `ahora
 * === inactivaEn`) es `false`: vencida, mismo criterio que `expires_at >
 * @ahora` del CAS de confirmación.
 */
export function sesionVigente(sesion: SesionEmpleado | undefined, ahora: string): boolean {
  if (sesion === undefined) {
    return false;
  }
  if (sesion.expiraEn !== undefined && ahora >= sesion.expiraEn) {
    return false;
  }
  if (sesion.inactivaEn !== undefined && ahora >= sesion.inactivaEn) {
    return false;
  }
  return true;
}

/**
 * Renueva la ventana de inactividad de una sesión vigente. PURA — no muta
 * `sesion`, devuelve un objeto nuevo. `expiraEn` (tope absoluto) NUNCA se
 * toca acá — sólo `inactivaEn` cambia (ADR 231 pto 3). Reusa
 * `calcularExpiraEn`, del mismo archivo, para no cargar ninguna dependencia
 * nueva.
 */
export function renovarSesion(
  sesion: SesionEmpleado,
  ahora: string,
  inactividadMinutos: number,
): SesionEmpleado {
  const inactivaEn = calcularExpiraEn(ahora, inactividadMinutos);
  if (inactivaEn === undefined) {
    const { inactivaEn: _omitida, ...resto } = sesion;
    return resto;
  }
  return { ...sesion, inactivaEn };
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
