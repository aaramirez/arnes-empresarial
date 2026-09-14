/**
 * Store en memoria de la conversación (memoria multi-turno) del empleado
 * (`chat-web-empleado`, ADR 196 §2, ADR 197, tarea 2). Implementa
 * `ConversacionEmpleadoPort` (`core/conversacion/conversacion-contract.ts`,
 * tarea 1) — la interfaz vive en el núcleo por convención hexagonal, esta
 * implementación concreta vive acá porque es estado de proceso ligado a la
 * concurrencia HTTP, no lógica de dominio.
 *
 * `Map<token, ConversacionEntry>` — molde exacto de
 * `confirmacion-operaciones-store.ts` (ranura por clave), pero escopeado por
 * el TOKEN de sesión HTTP, no por `empleadoId` (ADR 196 §2.1: el `casoId`
 * anterior nunca puede venir del request, así que la clave tiene que ser algo
 * que sólo el servidor resuelve).
 *
 * Rotación PEREZOSA (ADR 197), evaluada en el acceso (`paraSesion`) — mismo
 * criterio que `SesionEmpleadoStore.buscar` con `sesionVigente`
 * (`sesion-empleado-store.ts:39`): al superar el techo de inactividad o de
 * turnos, la entrada se ROTA (`conversacionId` nuevo, `ultimoCasoId` a
 * `undefined`, `turnos` a `0`), NUNCA rechaza.
 */
import { randomUUID } from "node:crypto";
import type { ConversacionEmpleadoPort } from "../../core/conversacion/conversacion-contract.js";
import { CONVERSACION_INACTIVIDAD_MS, CONVERSACION_MAX_TURNOS } from "./config.js";

interface ConversacionEntry {
  conversacionId: string;
  ultimoCasoId: string | undefined;
  turnos: number;
  /** ISO-8601 UTC del último `registrarTurno` (o de la creación, si ninguno todavía). */
  ultimaActividad: string;
}

export interface ConversacionEmpleadoStore {
  /** Ranura propia del token — molde de `paraEmpleado` (`confirmacion-operaciones-store.ts:56`). */
  paraSesion(token: string): ConversacionEmpleadoPort;
  /** Idempotente: existente, vencida o inexistente dan el mismo resultado. */
  eliminar(token: string): void;
}

export function crearConversacionEmpleadoStore(deps?: {
  readonly now?: () => string;
  readonly newId?: () => string;
}): ConversacionEmpleadoStore {
  const now = deps?.now ?? (() => new Date().toISOString());
  const newId = deps?.newId ?? randomUUID;
  const conversaciones = new Map<string, ConversacionEntry>();

  function crearEntry(): ConversacionEntry {
    return {
      conversacionId: newId(),
      ultimoCasoId: undefined,
      turnos: 0,
      ultimaActividad: now(),
    };
  }

  function debeRotar(entry: ConversacionEntry): boolean {
    const inactividadMs = Date.parse(now()) - Date.parse(entry.ultimaActividad);
    return inactividadMs >= CONVERSACION_INACTIVIDAD_MS || entry.turnos > CONVERSACION_MAX_TURNOS;
  }

  return {
    paraSesion(token: string): ConversacionEmpleadoPort {
      let entry = conversaciones.get(token);
      if (entry === undefined || debeRotar(entry)) {
        entry = crearEntry();
        conversaciones.set(token, entry);
      }
      const entryRef = entry;

      return {
        casoAnterior: () => entryRef.ultimoCasoId,
        registrarTurno: (casoId: string) => {
          entryRef.ultimoCasoId = casoId;
          entryRef.turnos += 1;
          entryRef.ultimaActividad = now();
        },
        conversacionId: () => entryRef.conversacionId,
      };
    },
    eliminar(token: string): void {
      conversaciones.delete(token);
    },
  };
}
