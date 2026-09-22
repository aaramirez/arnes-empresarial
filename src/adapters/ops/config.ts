import "../../core/config/env.js";

/**
 * Side-effect import: mismo criterio que `adapters/webhooks/config.ts` y
 * `adapters/web/config.ts` (verificados). Carga `.env` vía el punto único
 * del repo (`src/core/config/env.ts`), así este módulo es correcto sin
 * depender de que `main.ts` se acuerde de importar `env.js` primero.
 */
export interface OpsConfig {
  /**
   * `0` = adaptador DESHABILITADO: no se abre ningún puerto (molde `WEB_PORT`,
   * `web/config.ts:112-134`). El gate ES el puerto: a diferencia de webhooks,
   * el listener `ops` no tiene secreto (ADR 256, `design.md` §7.1).
   */
  readonly port: number;
  /**
   * Interfaz de escucha (`OPS_HOST`, molde `WEB_HOST`/`WEBHOOK_HOST`,
   * `modo-headless-cierre-limpio` RD-123). AUSENTE por CLAVE (nunca
   * `host: undefined`, `exactOptionalPropertyTypes`) = `startServer` NO pasa
   * `host` a `listen`: mismo bind de siempre (`::`, IPv4 e IPv6). `"0.0.0.0"`
   * no es equivalente (dejaría de escuchar en IPv6). Endurecer la red a
   * loopback es del compose (hijo 2), no de este default (R21 del hijo 1).
   */
  readonly host?: string;
  /**
   * Presente SOLO si `OPS_PORT` venía (no ausente, no en blanco) y NO
   * resolvió a un número `> 0`: trae el valor CRUDO recibido. El silencio es
   * caro — un puerto mal escrito deja al arnés sin healthcheck sin que nadie
   * se entere (mismo precedente que `cierre-presupuesto-invalido` del hijo
   * 1). `config.ts` queda PURO: no loguea, quien emite `ops-puerto-invalido`
   * es `index.ts` (RD-130, `design.md` §7.1).
   */
  readonly puertoInvalido?: string;
}

/** Id de correlación para eventos de ciclo de vida del listener `ops` (arranque, cierre). */
export const OPS_LOG_CORRELATION_ID = "ops-adapter";
/**
 * Techo del `close()` del listener `ops`, envolviendo `server.close()`
 * ENTERO (no solo su callback, divergencia deliberada de los otros tres
 * servidores — `design.md` §0.4/§4.4). CONSTANTE, no variable de entorno
 * (ADR 251 del hijo 1: su valor correcto lo decide el diseño y es el mismo
 * en toda instalación).
 */
export const OPS_CLOSE_TIMEOUT_MS = 5_000;
/** RD-129. Prefijo compartido con la ruta de readiness, reservado para el hijo 6 (`/metrics`). */
export const RUTA_VIVO = "/salud/vivo";
/** RD-129. */
export const RUTA_LISTO = "/salud/listo";
export const CUERPO_VIVO = "vivo";
export const CUERPO_LISTO = "listo";

/** Techo del rango TCP válido (RFC 793: 16 bits sin signo, `0` reservado para "deshabilitado"). */
const PUERTO_TCP_MAXIMO = 65_535;

/**
 * Resultado de intentar leer un puerto TCP desde una variable de entorno.
 * `estabaPresente` distingue "vacío/ausente" (silencio esperado, nunca
 * `puertoInvalido`) de "vino pero no sirve" (sí `puertoInvalido`), sin que
 * `resolveOpsConfig` tenga que re-evaluar el mismo string por su cuenta
 * (Reviewer finding, simplificación).
 */
interface PuertoResuelto {
  readonly port: number;
  readonly estabaPresente: boolean;
}

/**
 * Parses a positive-integer env var, falling back to `0` when the raw value
 * is missing, blank, not an INTEGER, not strictly greater than zero, or por
 * fuera del rango TCP válido (`> 65535`). Never throws — this adapter's
 * configuration is best-effort by design, same criterion as
 * `src/adapters/webhooks/config.ts`.
 *
 * `Number.isInteger` + el techo de 65535 (Reviewer finding, correctness):
 * sin esto, `OPS_PORT="8788.5"` o `"99999"` pasaban como "válidos" (sin
 * `puertoInvalido`) y solo fallaban después, dentro de `server.listen()`,
 * con el `ERR_SOCKET_BAD_PORT` genérico de Node en vez del diagnóstico
 * `ops-puerto-invalido{raw}` que este adaptador existe para dar.
 *
 * DELIBERATELY duplicated across the adapter config files (Reviewer finding,
 * reuse): not hoisted to `src/core/` because this is env-var parsing
 * infrastructure, not business logic, and AGENTS.md's non-negotiable rule
 * forbids one adapter importing from another.
 */
function resolvePositiveNumber(raw: string | undefined): PuertoResuelto {
  const estabaPresente = raw !== undefined && raw.trim() !== "";
  if (!estabaPresente) {
    return { port: 0, estabaPresente };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > PUERTO_TCP_MAXIMO) {
    return { port: 0, estabaPresente };
  }
  return { port: parsed, estabaPresente };
}

/**
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveWebConfig`/`resolveWebhookConfig`.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `OPS_PORT` | `port` | `0` (deshabilitado) — **sin ningún otro default** (K6: un default abriría un puerto en toda instalación existente al actualizar) |
 * | `OPS_HOST` | `host` | clave AUSENTE (`listen` sin `host`); blanco = ausente |
 *
 * `port` ausente/vacío/no numérico/no ENTERO/`<= 0`/`> 65535` → `0`, y en
 * ese caso, si el valor CRUDO estaba presente y no en blanco, `puertoInvalido`
 * lleva ese crudo.
 * NUNCA lanza, NUNCA loguea, NUNCA exige ninguna otra variable (no hay
 * secreto: el puerto ES la decisión, `design.md` §7.1).
 */
export function resolveOpsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const rawPort = env.OPS_PORT;
  const { port, estabaPresente } = resolvePositiveNumber(rawPort);
  const puertoInvalido = port === 0 && estabaPresente ? rawPort : undefined;
  // `.trim()`: un `OPS_HOST=` vacío en un `.env` no puede significar
  // "escucha en la cadena vacía". Blanco = ausente; la clave se OMITE (no `undefined`).
  const host = env.OPS_HOST?.trim();
  return {
    port,
    ...(host !== undefined && host !== "" ? { host } : {}), // exactOptionalPropertyTypes
    ...(puertoInvalido !== undefined ? { puertoInvalido } : {}), // exactOptionalPropertyTypes
  };
}

/** `config.port > 0`. Único gate del listener (molde `isWebEnabled`, `web/config.ts:131-134`). */
export function isOpsEnabled(config: OpsConfig): boolean {
  return config.port > 0;
}
