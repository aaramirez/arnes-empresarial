import { randomUUID } from "node:crypto";
import type { ClienteA2APort, DestinoA2AClave } from "../../core/agents/a2a-contract.js";
import { type A2AClientDeps, type FetchFn, delegarTarea } from "./client.js";
import { type A2AConfig, resolveA2AConfig } from "./config.js";

/**
 * Facade del Cliente A2A saliente (Hito 6, tarea 6, design.md §6.3) — el
 * ÚNICO archivo de `src/adapters/a2a/` que el composition root importa.
 * Cierra `config.ts` (tarea 2) + `client.ts` (tareas 4-5) sobre el
 * `ClienteA2APort` que el núcleo posee (ADR 75 pto 1).
 *
 * Sin `createNoopA2AAdapter`: la degradación de este hito es *no cablear el
 * adaptador* (`riesgoCredito === undefined`, `main.ts`), no cablear uno que
 * no hace nada — a diferencia de `notificaciones/`, donde `VentaNotifierPort`
 * SIEMPRE se invoca y por eso sí necesita un no-op.
 *
 * `baseUrlDe` es SÍNCRONA y sin I/O: sólo lee `config.destinos[clave]`, ya
 * resuelto por `resolveA2AConfig` — existe para que `despacharDelegacionA2A`
 * (núcleo, tarea 12) pueda fallar tipado ANTES de crear una fila huérfana
 * (ADR 80 pto 2), sin necesitar `await`.
 *
 * `delegar` sobre una clave sin destino configurado es un caso de borde que
 * no debería ocurrir en uso normal (el llamador ya filtró con `baseUrlDe`),
 * pero `delegar` NUNCA rechaza (ADR 77) — así que se resuelve como un fallo
 * de protocolo en vez de lanzar o de invocar `delegarTarea` con un destino
 * inexistente.
 */
export function createA2AAdapter(deps: {
  readonly config?: A2AConfig;
  readonly fetchFn?: FetchFn;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly ahoraMs?: () => number;
  readonly dormir?: (ms: number) => Promise<void>;
  readonly newMessageId?: () => string;
}): ClienteA2APort {
  const config = deps.config ?? resolveA2AConfig();
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchFn);
  const ahoraMs = deps.ahoraMs ?? Date.now;
  const dormir =
    deps.dormir ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newMessageId = deps.newMessageId ?? randomUUID;
  const { logEvent } = deps;

  const clientDeps: A2AClientDeps = { config, fetchFn, logEvent, ahoraMs, dormir, newMessageId };

  return {
    baseUrlDe(clave: DestinoA2AClave): string | undefined {
      return config.destinos[clave]?.baseUrl;
    },

    async delegar(input) {
      const destino = config.destinos[input.clave];
      if (destino === undefined) {
        return { ok: false, reason: "protocolo" };
      }

      return delegarTarea(
        { destino, clave: input.clave, tarea: input.tarea, casoId: input.casoId },
        clientDeps,
      );
    },
  };
}
