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
  /**
   * Hallazgo Reviewer #3 (ALTO): último "ticket" emitido por `paraSesion`
   * para esta entrada. Cada `paraSesion` sobre un token existente (sin
   * rotar) incrementa este contador y lo captura por closure en el puerto
   * devuelto -- `registrarTurno` sólo aplica su escritura si su ticket
   * capturado sigue siendo el más reciente emitido. Resuelve la carrera de
   * un turno vencido por `OPERACIONES_TIMEOUT_MS` (responde 504 pero sigue
   * corriendo en el fondo, `server.ts:514`) que termina DESPUÉS de que un
   * reintento del usuario ya avanzó la memoria -- sin esto, el turno viejo
   * pisaría silenciosamente el más nuevo.
   *
   * Hallazgo Reviewer 2da ronda #3: este mecanismo cubre AHORA dos casos --
   * el de arriba (turno tardío tras un `paraSesion` más nuevo SOBRE EL MISMO
   * token, ya vigente antes de este hallazgo) Y un turno tardío tras un
   * `eliminar(token)` (nuevo, ver `invalidada`).
   */
  ticketEmitido: number;
  /**
   * Hallazgo Reviewer 2da ronda #3: `eliminar` la pone en `true` antes de
   * borrar la entrada del `Map`. `registrarTurno` la chequea junto con el
   * ticket -- si está `true`, no-op, igual que un ticket vencido. Hoy es
   * inocuo aun sin este flag (el objeto queda inalcanzable tras `delete`,
   * un `paraSesion` posterior crea una entrada nueva sin relación), pero no
   * estaba documentado ni testeado como invariante -- este flag lo hace
   * explícito y a prueba de un futuro refactor que comparta la referencia.
   */
  invalidada: boolean;
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
      ticketEmitido: 0,
      invalidada: false,
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
      entryRef.ticketEmitido += 1;
      const ticket = entryRef.ticketEmitido;

      return {
        casoAnterior: () => entryRef.ultimoCasoId,
        registrarTurno: (casoId: string) => {
          // Ticket superado por un `paraSesion` más reciente sobre el MISMO
          // token, O entrada invalidada por un `eliminar` posterior -- en
          // ambos casos no-op silencioso e intencional (turno viejo, ya
          // superado; hallazgo Reviewer #3 y hallazgo Reviewer 2da ronda #3).
          if (ticket !== entryRef.ticketEmitido || entryRef.invalidada) {
            return;
          }
          entryRef.ultimoCasoId = casoId;
          entryRef.turnos += 1;
          entryRef.ultimaActividad = now();
        },
        conversacionId: () => entryRef.conversacionId,
      };
    },
    eliminar(token: string): void {
      const entry = conversaciones.get(token);
      if (entry !== undefined) {
        entry.invalidada = true;
      }
      conversaciones.delete(token);
    },
  };
}
