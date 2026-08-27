/**
 * Hooks Engine (arc42 Caja Blanca Bloque de Construcción 4), minimal
 * version for Hito 1 (esqueleto conversacional).
 *
 * Nota de alcance — versión mínima de este hito: el arc42 describe el
 * bloque completo (que abarca más de un hito) como construido "sobre el
 * sistema de hooks nativo del Claude Agent SDK". Esa integración real es
 * progresiva. Para el Hito 1, `tasks.md` (tarea 6) solo pide un registro
 * de hooks vacío, capaz de disparar los puntos pre/post-turno in-process
 * aunque no haya nada registrado todavía — es lo que el Invocador del
 * Modelo (Hito 1, tarea 9) necesita para cumplir el Escenario de ejecución
 * 1 del arc42 tal cual está escrito ("Invocador del Modelo dispara los
 * hooks de post-turno correspondientes"). Mapear estos puntos a hooks
 * nativos del SDK (PreToolUse/PostToolUse/Stop/etc.) es una decisión que
 * le corresponde al Spec Author en el hito que la necesite, no a esta
 * tarea.
 *
 * SDK-agnostic by design, same criterion as the Agent Registry
 * (`src/core/agents/definitions.ts`, Hito 1, tarea 5): this module does
 * NOT import `@anthropic-ai/claude-agent-sdk` — that package is not even a
 * project dependency yet.
 *
 * Nota de alcance — manejo de errores: con el registro vacío (el caso de
 * este hito), no hay ningún handler que pueda fallar, así que este
 * contrato todavía no necesita decidir una política sofisticada al
 * respecto. Lo que sí existe hoy, ya implementado y cubierto por test, es
 * el comportamiento por defecto más simple posible: si un handler lanza
 * (o su promesa rechaza), `triggerHook` propaga esa excepción sin
 * envolverla y NO ejecuta los handlers restantes registrados para ese
 * punto. La política concreta ante ese fallo (reintentar, degradar,
 * abortar el turno, aislar un hook del resto) es responsabilidad de
 * Manejo de errores base (Hito 1, tarea 11), que corre después de esta
 * tarea a propósito — ver Deuda 1 en `docs/ARC42_Harness_Empresarial.md`,
 * sección "Riesgos y deuda técnica". Lo único que decide tarea 11 es si
 * este comportamiento por defecto cambia, no si existe.
 */

/** Lifecycle points a turn goes through that hooks can attach to. */
export type HookPoint = "PRE_TURN" | "POST_TURN";

/**
 * Minimal payload passed to hook handlers when a lifecycle point fires.
 * Kept intentionally generic (a plain string-keyed record) instead of a
 * fixed shape: no real hook is registered yet in this hito, so there is no
 * concrete field to commit to. The Invocador del Modelo (Hito 1, tarea 9)
 * is the first real caller and decides what it actually passes (e.g.
 * `caseId`, the model response) when it wires up here — adding fields
 * later is additive and does not need to change this type.
 */
export type HookContext = Readonly<Record<string, unknown>>;

/**
 * A hook handler for a lifecycle point. Async by design: the trigger
 * point that matters most for this hito (post-turn, from the Invocador
 * del Modelo) wraps a real call to the Anthropic API, so the contract
 * must support awaiting handlers from the moment it exists — even though
 * no handler is registered yet.
 */
export type HookHandler = (context: HookContext) => void | Promise<void>;

/** Public contract of a hook engine instance. */
export interface HookEngine {
  /** Registers `handler` to run when `point` fires, after any handler already registered for that point. */
  registerHook(point: HookPoint, handler: HookHandler): void;
  /**
   * Runs every handler registered for `point`, in registration order,
   * awaiting each one before starting the next. With no handlers
   * registered for `point` (the only case this hito exercises), this
   * resolves immediately without doing anything.
   */
  triggerHook(point: HookPoint, context?: HookContext): Promise<void>;
}

/**
 * Creates an isolated hook engine instance with its own registry. Exposed
 * as a factory (rather than only a shared singleton) so tests can exercise
 * the engine without leaking registered handlers across test cases, and so
 * a future hito could run more than one independent registry if it ever
 * needs to.
 */
export function createHookEngine(): HookEngine {
  const registry = new Map<HookPoint, HookHandler[]>();

  return {
    registerHook(point, handler) {
      const handlers = registry.get(point);
      if (handlers) {
        handlers.push(handler);
      } else {
        registry.set(point, [handler]);
      }
    },

    async triggerHook(point, context = {}) {
      const handlers = registry.get(point);
      if (!handlers) {
        return;
      }
      for (const handler of handlers) {
        await handler(context);
      }
    },
  };
}

/**
 * Shared hook engine instance for production use across the harness.
 * Secuencia de arranque (Hito 1, tarea 13) and the Invocador del Modelo
 * (Hito 1, tarea 9) are the intended consumers of this instance; tests use
 * `createHookEngine()` directly instead, to stay isolated from each other.
 */
export const hookEngine: HookEngine = createHookEngine();
