/**
 * Segundo handler real registrado, ahora para el punto PRE_TURN
 * (`hook-engine.ts`). Mismo molde que `log-post-turn-handler.ts`: reusa
 * `logTurnEvent` (nunca inventa un mecanismo de logging nuevo) en vez de
 * escribir a un stream de terminal — Ink lo necesita para poder redibujar.
 * No duplica `RegistroAccionesEmpleadoPort`: esto es observabilidad técnica
 * de turnos del SDK, no auditoría de acciones de negocio.
 *
 * A diferencia de POST_TURN, el `HookContext` que recibe este handler solo
 * trae `{ casoId, agentId }` — en este punto del flujo (Invocador del
 * Modelo, antes de arrancar `queryFn`) el turno ni arrancó, así que todavía
 * no existen `sdkSessionId` ni `responseText`.
 *
 * `readStringField` está duplicada (no importada) desde
 * `log-post-turn-handler.ts` a propósito: esa función es privada de ese
 * módulo y esta tarea no puede tocarlo (fuera del conjunto de archivos
 * permitido) — la duplicación de una función de 3 líneas es el costo menor
 * frente a modificar un archivo fuera de alcance.
 */

import { logTurnEvent } from "../logging/turn-logger.js";
import type { HookContext, HookHandler } from "./hook-engine.js";

const FALLBACK_ID = "desconocido";

function readStringField(context: HookContext, field: string): string {
  const value = context[field];
  return typeof value === "string" ? value : FALLBACK_ID;
}

/**
 * Factory (mismo patrón factory+singleton que `createLogPostTurnHandler`/
 * `logPostTurnHandler`) para inyectar `log` en tests sin tocar el
 * filesystem real. Nunca lanza: el motor de hooks propaga excepciones de
 * handlers, y este handler es solo observabilidad — no puede tumbar un
 * turno que todavía ni empezó.
 */
export function createLogPreTurnHandler(log = logTurnEvent): HookHandler {
  return (context: HookContext) => {
    const casoId = readStringField(context, "casoId");
    const agentId = readStringField(context, "agentId");

    log(casoId, "turno-iniciado", { agentId });
  };
}

/** Instancia compartida para uso en producción (wiring en `bootstrap.ts`). */
export const logPreTurnHandler: HookHandler = createLogPreTurnHandler();
