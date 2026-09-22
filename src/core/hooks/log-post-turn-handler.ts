/**
 * Primer handler real registrado para el punto POST_TURN (`hook-engine.ts`).
 * Reusa `logTurnEvent` (ya usado por ~40 eventos del repo, ya escribe a
 * `data/harness.log`, nunca a un stream de terminal — Ink lo necesita para
 * poder redibujar) en vez de inventar un mecanismo de logging nuevo. No
 * duplica `RegistroAccionesEmpleadoPort`: esto es observabilidad técnica de
 * turnos del SDK, no auditoría de acciones de negocio.
 */

import { logTurnEvent } from "../logging/turn-logger.js";
import type { HookContext, HookHandler } from "./hook-engine.js";

const FALLBACK_ID = "desconocido";

function readStringField(context: HookContext, field: string): string {
  const value = context[field];
  return typeof value === "string" ? value : FALLBACK_ID;
}

/**
 * Factory (mismo patrón factory+singleton que `createHookEngine()`/
 * `hookEngine`) para inyectar `log` en tests sin tocar el filesystem real.
 * Nunca lanza: el motor de hooks propaga excepciones de handlers, y este
 * handler es solo observabilidad — no puede tumbar un turno que ya terminó.
 */
export function createLogPostTurnHandler(log = logTurnEvent): HookHandler {
  return (context: HookContext) => {
    const casoId = readStringField(context, "casoId");
    const agentId = readStringField(context, "agentId");
    const sdkSessionId = readStringField(context, "sdkSessionId");
    const responseText = context.responseText;
    const longitudRespuesta = typeof responseText === "string" ? responseText.length : 0;

    log(casoId, "post-turn-hook-ejecutado", { agentId, sdkSessionId, longitudRespuesta });
  };
}

/** Instancia compartida para uso en producción (wiring en `bootstrap.ts`). */
export const logPostTurnHandler: HookHandler = createLogPostTurnHandler();
