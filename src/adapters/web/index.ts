/**
 * Fachada opt-in del adaptador Web (Hito 4, tarea 18, §4.6) — el único
 * archivo de `src/adapters/web/` que el composition root (`main.ts`)
 * importa. Arma el `WebServerDeps` completo (`config`, los cinco handlers de
 * negocio, `logEvent`) a partir de sus propios `deps` y se lo pasa a
 * `startServer` (tarea 17), que ya sabe montar el listener HTTP sobre un
 * servidor real o inyectado.
 *
 * Molde exacto de `startWebhookServer` (`adapters/webhooks/index.ts:51`,
 * verificado). `config`/`createServer` son opcionales con default
 * `resolveWebConfig()` / `node:http createServer` real — mismo criterio que
 * `startWebhookServer`: producción no pasa nada, los tests inyectan un
 * `CreateWebServerFn` doble para no abrir ningún puerto real.
 */
import {
  isWebEnabled,
  resolveWebConfig,
  WEB_LOG_CORRELATION_ID,
  type WebConfig,
} from "./config.js";
import { startServer, type WebServerDeps } from "./server.js";
import type { CreateWebServerFn } from "./http.js";

export interface WebAdapter {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Punto de entrada único del adaptador — misma semántica de `undefined` que
 * `startWebhookServer`:
 *
 * Devuelve `undefined` cuando `!isWebEnabled(config)`: NO se abre ningún
 * puerto, se emite `web-deshabilitado` y el proceso arranca idéntico a
 * `v1.2.0` (spec `venta-confirmacion`, req. "Listener web opt-in por
 * configuración").
 *
 * `undefined` y no un objeto no-op a propósito: `main.ts` tiene que poder
 * distinguir "no hay nada que cerrar" de "hay un servidor que cerrar" en su
 * `finally`, y un no-op con `close()` vacío esconde esa diferencia justo en
 * el camino de salida del proceso.
 *
 * Un `listen` que rechaza (p. ej. `EADDRINUSE`) se propaga tal cual: esta
 * función no lo captura ni loguea `web-arranque-fallido` — esa es
 * responsabilidad del composition root (`main.ts`), que decide si aborta el
 * arranque o sigue sin listener web.
 */
export async function startWebServer(
  deps: Omit<WebServerDeps, "config"> & {
    readonly config?: WebConfig;
    readonly createServer?: CreateWebServerFn;
  },
): Promise<WebAdapter | undefined> {
  const config = deps.config ?? resolveWebConfig();

  if (!isWebEnabled(config)) {
    deps.logEvent(WEB_LOG_CORRELATION_ID, "web-deshabilitado");
    return undefined;
  }

  const serverDeps: WebServerDeps = {
    ...deps,
    config,
  };

  const handle = await startServer(serverDeps, deps.createServer);

  deps.logEvent(WEB_LOG_CORRELATION_ID, "web-escuchando", { port: handle.port });

  return {
    port: handle.port,
    close: () => handle.close(),
  };
}
