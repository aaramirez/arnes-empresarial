/**
 * Fachada opt-in del Servidor A2A entrante (Hito 7, tarea 14, design.md
 * §6.4) — el único archivo de `src/adapters/a2a/` que el composition root
 * (`main.ts`) importa para levantar el listener HTTP. Arma el
 * `A2AServerDeps` completo (`config`, los tres callbacks de negocio,
 * `logEvent`) a partir de sus propios `deps` y se lo pasa a `startServer`
 * (tarea 13), que ya sabe montar el listener sobre un servidor real o
 * inyectado.
 *
 * Molde LITERAL de `startWebhookServer` (`adapters/webhooks/index.ts:51`) y
 * de `startWebServer` (`adapters/web/index.ts:48`), incluida la semántica de
 * `undefined`: sin `HARNESS_A2A_ENTRANTE_TOKEN` NO se abre ningún puerto, se
 * emite `a2a-servidor-deshabilitado` y el proceso arranca idéntico a
 * `v2.2.0`. `config`/`createServer` son opcionales con default
 * `resolveA2AServerConfig()` / `node:http createServer` real — mismo
 * criterio que los otros dos adaptadores: producción no pasa nada, los
 * tests inyectan un `CreateA2AServerFn` doble para no abrir ningún puerto
 * real.
 *
 * `undefined` y no un objeto no-op a propósito: `main.ts` tiene que poder
 * distinguir "no hay nada que cerrar" de "hay un servidor que cerrar" en su
 * `finally`, y un no-op con `close()` vacío esconde esa diferencia justo en
 * el camino de salida del proceso.
 *
 * Un `listen` que rechaza (p. ej. `EADDRINUSE`) se propaga tal cual: esta
 * función no lo captura ni loguea `a2a-servidor-arranque-fallido` — esa es
 * responsabilidad del composition root (`main.ts`, tarea 16), que decide si
 * el resto del arnés sigue sin Servidor A2A.
 *
 * El evento `a2a-servidor-escuchando` (con el puerto EFECTIVO, ADR 101) se
 * loguea ACÁ, en la fachada — no en `startServer` — mismo precedente exacto
 * que `webhooks/index.ts:78` (`webhook-escuchando`) y `web/index.ts:68`
 * (`web-escuchando`): el evento de "servidor escuchando" es responsabilidad
 * de la fachada opt-in, no del listener HTTP interno.
 */
import {
  A2A_SERVER_LOG_CORRELATION_ID,
  isA2AServerEnabled,
  resolveA2AServerConfig,
  type A2AServerConfig,
} from "./server-config.js";
import { startServer, type A2AServerDeps, type CreateA2AServerFn } from "./server.js";

export interface A2AServerAdapter {
  readonly port: number;
  readonly publicUrl: string;
  close(): Promise<void>;
}

/**
 * Punto de entrada único del adaptador — misma semántica de `undefined` que
 * `startWebhookServer`/`startWebServer` (spec `servidor-a2a-jsonrpc`, req.
 * "El token es el único interruptor").
 */
export async function startA2AServer(
  deps: Omit<A2AServerDeps, "config"> & {
    readonly config?: A2AServerConfig;
    readonly createServer?: CreateA2AServerFn;
  },
): Promise<A2AServerAdapter | undefined> {
  const config = deps.config ?? resolveA2AServerConfig();

  if (!isA2AServerEnabled(config)) {
    deps.logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-deshabilitado");
    return undefined;
  }

  const serverDeps: A2AServerDeps = {
    ...deps,
    config,
  };

  const handle = await startServer(serverDeps, deps.createServer);

  deps.logEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-escuchando", {
    port: handle.port,
    publicUrl: config.publicUrl,
  });

  return {
    port: handle.port,
    publicUrl: config.publicUrl,
    close: () => handle.close(),
  };
}
