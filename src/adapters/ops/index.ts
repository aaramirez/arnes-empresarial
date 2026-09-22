/**
 * Fachada opt-in del adaptador `ops` (hijo 3, ADR 257) — el único archivo de
 * `src/adapters/ops/` que el composition root (`main.ts`) importa. Molde
 * LITERAL de `src/adapters/webhooks/index.ts:51-88`, con la misma diferencia
 * inevitable que ya documenta ese molde: `async` (`startServer` lo es) y
 * puede devolver `undefined`.
 *
 * Devuelve `undefined` cuando `!isOpsEnabled(config)`: no se abre ningún
 * puerto, se emite `ops-deshabilitado` y — si el valor CRUDO de `OPS_PORT`
 * venía y no servía — también `ops-puerto-invalido{raw}` ANTES de
 * `ops-deshabilitado` (RD-130, `design.md` §7.1). `config.ts` queda PURO
 * (no loguea): este módulo es el ÚNICO lugar que decide qué hacer con
 * `puertoInvalido`.
 *
 * `undefined` y no un objeto no-op a propósito, mismo motivo que
 * `WebhookAdapter`: `main.ts` necesita distinguir "no hay nada que cerrar"
 * de "hay un servidor que cerrar" en su `finally`.
 *
 * `ops` NO loguea ninguna request (S9, `server.ts` ya lo documenta): los
 * únicos cinco eventos de ciclo de vida que este módulo puede emitir son
 * `ops-deshabilitado`, `ops-puerto-invalido`, `ops-escuchando`, y (dentro de
 * `server.ts`) `ops-cierre-forzado` — el quinto, `ops-arranque-fallido`, lo
 * emite `main.ts` (composition root), no este adaptador (mismo criterio que
 * `webhook-arranque-fallido`/`web-arranque-fallido`: un `listen` que
 * rechaza se PROPAGA tal cual, sin capturarlo ni loguearlo acá).
 */
import { isOpsEnabled, OPS_LOG_CORRELATION_ID, resolveOpsConfig, type OpsConfig } from "./config.js";
import type { CreateOpsServerFn } from "./http.js";
import { startServer, type OpsSaludPort } from "./server.js";

export interface OpsAdapter {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Punto de entrada único del adaptador. `config`/`createServer` son
 * opcionales con default `resolveOpsConfig()` / `http.createServer` real
 * (vía el default de `startServer`) — producción no pasa nada, los tests
 * inyectan un `CreateOpsServerFn` doble para no abrir ningún puerto real.
 */
export async function startOpsServer(deps: {
  readonly salud: OpsSaludPort;
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly config?: OpsConfig;
  readonly createServer?: CreateOpsServerFn;
}): Promise<OpsAdapter | undefined> {
  const config = deps.config ?? resolveOpsConfig();

  if (!isOpsEnabled(config)) {
    if (config.puertoInvalido !== undefined) {
      deps.logEvent(OPS_LOG_CORRELATION_ID, "ops-puerto-invalido", { raw: config.puertoInvalido });
    }
    deps.logEvent(OPS_LOG_CORRELATION_ID, "ops-deshabilitado");
    return undefined;
  }

  const handle = await startServer(
    { config, salud: deps.salud, logEvent: deps.logEvent },
    deps.createServer,
  );

  deps.logEvent(OPS_LOG_CORRELATION_ID, "ops-escuchando", { port: handle.port });

  return {
    port: handle.port,
    close: () => handle.close(),
  };
}
