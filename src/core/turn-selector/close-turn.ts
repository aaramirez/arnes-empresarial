/**
 * Escritura de cierre de turno (I3) — Hito 1, tarea 10.
 *
 * Tras la respuesta del modelo (Invocador del Modelo, Hito 1 tarea 9), esta
 * es la escritura que el arc42 marca como el aspecto más notable del
 * Escenario de ejecución 1: "El Núcleo actualiza el estado del caso en
 * memoria compartida vía I3 — el SDK ya persiste el turno en sí por su
 * cuenta." Sin esta escritura, el siguiente turno no ve el resultado de
 * este — `tasks.md` lo dice explícitamente: "Sin esta tarea el checklist
 * se puede dar por completo y el entregable funcional falla igual".
 *
 * Design decision — I3 como puerto inyectado, mismo patrón que
 * `MemoryContextPort` (`./assemble-context.ts`): AGENTS.md ("Reglas
 * técnicas no negociables") prohíbe que `src/core/` importe nada de
 * `src/adapters/*`. `MemoryWritePort` es estructuralmente idéntico a
 * `updateCaso`/`createSesionAgente` de `src/adapters/memory/repository.ts`
 * menos el parámetro `db` — la capa de wiring (Hito 1, tarea 13/15, no
 * implementada todavía) los conecta con un closure de una línea por
 * método, sin duplicar lógica, igual que `toMemoryPort` hace hoy para el
 * ensamblador de contexto en su test de integración.
 *
 * Design decision — siempre INSERT, nunca UPDATE, en `sesiones_agente`:
 * `repository.ts` solo expone `createSesionAgente`, no un
 * `updateSesionAgente` — su propio comentario documenta el modelo: "A case
 * can accumulate more than one session row per agent over time; the most
 * recent one by created_at is the current one." Cerrar un turno crea una
 * fila nueva; `getLatestSesionAgente` (ya usado por `assembleContext`) es
 * lo que después resuelve cuál es la vigente.
 *
 * Design decision — `estado` es un parámetro explícito, no inventado acá:
 * Hito 1 no define una máquina de estados de negocio para
 * `casos.tipo = 'conversacion'` (el plan solo especifica valores de
 * `estado` concretos para otros hitos/tipos de caso). Inventar un valor acá
 * sería una decisión de negocio fuera de alcance — `closeTurn` recibe el
 * nuevo `estado` como argumento explícito, igual que `CasoUpdate.estado` es
 * explícito en `updateCaso`.
 *
 * Design decision — timestamps e id de sesión inyectables, mismo patrón DI
 * que `queryFn` en `invoke-model.ts` y `candidates` en `resolve-turn.ts`:
 * `CloseTurnDeps` permite testear sin tocar el reloj real ni depender de
 * aleatoriedad real, sin forzar a los callers de producción a pasar nada —
 * el default usa `Date` real y `randomUUID` importado explícitamente de
 * `node:crypto`.
 *
 * Fix (Reviewer finding, post-tarea-10 code-review, BLOQUEANTE) — import
 * explícito de `node:crypto`, no el global implícito `crypto`: la primera
 * versión de este módulo usaba `crypto.randomUUID()` asumiendo que `crypto`
 * es un global disponible desde Node 18 (`engines.node` de `package.json`).
 * Eso es incorrecto: `globalThis.crypto` (Web Crypto API como global
 * implícito) recién se estabiliza sin flag en Node 19 — en un Node 18.x
 * real, sin `--experimental-global-webcrypto`, `globalThis.crypto` no
 * existe, así que la primera llamada en producción a `closeTurn()` sin
 * `deps` explícito lanzaba `ReferenceError: crypto is not defined`. Ningún
 * test lo agarró porque `close-turn.test.ts` siempre inyecta
 * `generateSesionId`, así que nunca ejercitaba el default real. El fix
 * importa `randomUUID` directamente del módulo `node:crypto` (disponible
 * sin flag desde Node 14.17/15.6, muy por debajo del mínimo soportado), que
 * no es un import de `src/adapters/*` de este repo, así que sigue sin
 * violar la regla de import — mismo razonamiento que permitió importar el
 * SDK de Anthropic directo en `invoke-model.ts`: la regla de import solo
 * aplica a los adaptadores de este repo, no a módulos built-in de Node.
 *
 * Design decision — manejo de errores diferido: mismo criterio ya aplicado
 * por `assemble-context.ts` e `invoke-model.ts` — Manejo de errores base
 * (Hito 1, tarea 11) no corrió todavía. Si `memory.updateCaso` o
 * `memory.createSesionAgente` lanzan (p. ej. `CasoNotFoundError`), este
 * módulo deja propagar la excepción sin envolverla.
 *
 * Nota de alcance — atomicidad entre `updateCaso` y `createSesionAgente`:
 * las dos escrituras no corren dentro de una misma transacción — el core
 * no tiene handle de `Database` para envolverlas (regla hexagonal, el
 * puerto solo expone las dos operaciones, no una transacción). Coincide
 * con W2 de `sdd-verify`; decisión pendiente para la tarea 11 (Manejo de
 * errores base) o la capa de wiring, no resuelta acá.
 */

import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/definitions.js";
import type { AssembledContext } from "./assemble-context.js";
import type { InvokeModelResult } from "./invoke-model.js";

/**
 * The I3 write operations this block depends on. See the module doc above
 * for why this is an injected port instead of a direct import from
 * `src/adapters/memory/repository.ts`.
 */
export interface MemoryWritePort {
  /** Updates the `estado` of an existing `caso`. */
  updateCaso(casoId: string, update: { readonly estado: string; readonly updatedAt: string }): void;
  /** Inserts a new `sesion_agente` row — closing a turn always inserts, never updates. */
  createSesionAgente(input: {
    readonly id: string;
    readonly casoId: string;
    readonly agentId: string;
    readonly sdkSessionId: string;
    readonly createdAt: string;
  }): void;
}

/**
 * Injectable timestamp/id generation, so `closeTurn` is testable without
 * touching the real clock or real randomness. Production callers omit this
 * argument and get the default below.
 */
export interface CloseTurnDeps {
  readonly now: () => string;
  readonly generateSesionId: () => string;
}

const DEFAULT_CLOSE_TURN_DEPS: CloseTurnDeps = {
  now: () => new Date().toISOString(),
  generateSesionId: () => randomUUID(),
};

/**
 * Closes a turn: updates the `caso`'s `estado` and records a new
 * `sesion_agente` row with the SDK session id the turn ran under, via the
 * injected `memory` port (I3) — the write half of `assembleContext`'s read.
 *
 * `estado` is an explicit parameter — see the module doc's "estado es un
 * parámetro explícito" note for why this module does not invent one.
 *
 * Lets any `memory` port exception propagate unwrapped (error policy
 * deferred to Hito 1, tarea 11 — see the module doc's "manejo de errores
 * diferido" note).
 */
export function closeTurn(
  memory: MemoryWritePort,
  context: AssembledContext,
  agent: AgentDefinition,
  result: InvokeModelResult,
  estado: string,
  deps: CloseTurnDeps = DEFAULT_CLOSE_TURN_DEPS,
): void {
  memory.updateCaso(context.caso.id, { estado, updatedAt: deps.now() });
  memory.createSesionAgente({
    id: deps.generateSesionId(),
    casoId: context.caso.id,
    agentId: agent.id,
    sdkSessionId: result.sdkSessionId,
    createdAt: deps.now(),
  });
}
