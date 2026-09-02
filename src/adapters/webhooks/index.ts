/**
 * Fachada opt-in del adaptador de Webhooks (Hito 3, tarea 12) — el único
 * archivo de `src/adapters/webhooks/` que el composition root (`main.ts`)
 * importa. Arma el `WebhookServerDeps` completo (`config`, `onEvent`,
 * `logEvent`) a partir de sus propios `deps` y se lo pasa a `startServer`
 * (tarea 11), que ya sabe montar el listener HTTP (tareas 8-10) sobre un
 * servidor real o inyectado.
 *
 * `config`/`createServer` son opcionales con default `resolveWebhookConfig()`
 * / `node:http createServer` real — mismo criterio que
 * `createKnowledgeAdapter` en `src/adapters/knowledge/index.ts`: producción
 * no pasa nada, los tests inyectan un `CreateServerFn` doble para no abrir
 * ningún puerto real.
 */
import type { IncomingActivityEvent } from "../../core/activity/activity-contract.js";
import {
  isWebhookEnabled,
  resolveWebhookConfig,
  WEBHOOK_LOG_CORRELATION_ID,
  type WebhookConfig,
} from "./config.js";
import { startServer, type CreateServerFn, type WebhookServerDeps } from "./server.js";

export interface WebhookAdapter {
  readonly port: number;
  readonly path: string;
  close(): Promise<void>;
}

/**
 * Punto de entrada único del adaptador — molde `startTui(onSubmit)` (ADR 5,
 * punto 3), con dos diferencias inevitables y deliberadas: es `async`
 * (`listen` lo es) y puede devolver `undefined`.
 *
 * Devuelve `undefined` cuando `!isWebhookEnabled(config)`: NO se abre ningún
 * puerto, se emite `webhook-deshabilitado` y el proceso arranca idéntico a
 * `v1.1.0`. Es la degradación por ausencia total del listener que ADR 5
 * elige sobre un endpoint que responde `503` — misma filosofía que el
 * Adaptador de Conocimiento degradando sin `graphify`.
 *
 * `undefined` y no un objeto no-op a propósito: `main.ts` tiene que poder
 * distinguir "no hay nada que cerrar" de "hay un servidor que cerrar" en su
 * `finally`, y un no-op con `close()` vacío esconde esa diferencia justo en
 * el camino de salida del proceso.
 *
 * Un `listen` que rechaza (p. ej. `EADDRINUSE`) se propaga tal cual: esta
 * función no lo captura ni loguea `webhook-arranque-fallido` — esa es
 * responsabilidad del composition root (`main.ts`), que decide si aborta el
 * arranque o sigue sin webhook.
 */
export async function startWebhookServer(deps: {
  readonly onEvent: (evento: IncomingActivityEvent) => Promise<void>;
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly config?: WebhookConfig;
  readonly createServer?: CreateServerFn;
}): Promise<WebhookAdapter | undefined> {
  const config = deps.config ?? resolveWebhookConfig();

  if (!isWebhookEnabled(config)) {
    deps.logEvent(WEBHOOK_LOG_CORRELATION_ID, "webhook-deshabilitado");
    return undefined;
  }

  const serverDeps: WebhookServerDeps = {
    config,
    onEvent: deps.onEvent,
    logEvent: deps.logEvent,
  };

  const handle = await startServer(serverDeps, deps.createServer);

  deps.logEvent(WEBHOOK_LOG_CORRELATION_ID, "webhook-escuchando", {
    port: handle.port,
    path: config.path,
  });

  return {
    port: handle.port,
    path: config.path,
    close: () => handle.close(),
  };
}
