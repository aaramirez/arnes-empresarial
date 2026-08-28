/**
 * Startup sequence (arc42 Concepto transversal 5), Hito 1
 * (esqueleto conversacional), tarea 13.
 *
 * Nota de alcance: el arc42 (líneas 506-508) señala que Registro de
 * Agentes, Registro de Comandos, Motor de Hooks y Registro de Skills se
 * cargan "al iniciar el arnés" sin que ningún lado fije el orden. En Hito 1
 * solo existen dos de esos cuatro registros — Registro de Comandos y
 * Registro de Skills son de hitos futuros y no se ejercitan acá. Esta
 * función fija el orden entre los dos que sí existen hoy: Registro de
 * Agentes primero, Motor de Hooks después (ver justificación en los
 * comentarios de `bootstrapHarness` más abajo).
 *
 * Esto NO es el entrypoint real del proceso — no hay todavía ningún
 * `src/index.ts`/`src/main.ts` en el repo. Ese entrypoint es la
 * Integración end-to-end (Hito 1, tarea 15, todavía no implementada), que
 * es quien va a llamar a `bootstrapHarness` al principio, cuando exista.
 */

import { listAgentDefinitions, type AgentDefinition } from "../agents/definitions.js";
import { hookEngine as defaultHookEngine, type HookEngine } from "../hooks/hook-engine.js";

/**
 * Raised when the harness cannot complete its startup sequence. The
 * message always embeds the concrete reason so a failure at process start
 * (before any `caso` exists, so before `logTurnEvent` — tarea 12 — even
 * applies) is still actionable without extra context.
 */
export class HarnessBootstrapError extends Error {
  constructor(reason: string) {
    super(`No se pudo inicializar el arnés: ${reason}`);
    this.name = "HarnessBootstrapError";
  }
}

/** The registries wired up by a successful startup sequence. */
export interface HarnessRegistries {
  readonly agents: readonly AgentDefinition[];
  readonly hooks: HookEngine;
}

/**
 * Runs the Hito 1 startup sequence: loads the Agent Registry, then wires up
 * the Hook Engine, in that fixed order.
 *
 * Both dependencies are injectable (defaulting to the real Agent Registry
 * and the shared `hookEngine` singleton) — same DI pattern used across this
 * hito (`resolve-turn.ts`, `invoke-model.ts`, etc.) — so tests can exercise
 * this function, including its failure path, without depending on or
 * mutating global/shared state.
 */
export function bootstrapHarness(
  listAgents: () => readonly AgentDefinition[] = listAgentDefinitions,
  hooks: HookEngine = defaultHookEngine,
): HarnessRegistries {
  // 1. Registro de Agentes primero: nada más en este hito depende de que
  //    exista todavía, y un arnés sin ningún agente definido no puede
  //    resolver ningún turno — falla rápido acá en vez de fallar más tarde,
  //    de forma más confusa, en Resolución de Turno. Envolvemos la llamada
  //    misma: si `listAgents()` tira (hoy `listAgentDefinitions` no lo
  //    hace, pero un fake inyectado o una implementación futura sí
  //    podrían), esa excepción cruda no debe escaparse — contradiría lo que
  //    `HarnessBootstrapError` promete ("Raised when the harness cannot
  //    complete its startup sequence").
  let agents: readonly AgentDefinition[];
  try {
    agents = listAgents();
  } catch (error) {
    throw new HarnessBootstrapError(
      `el Registro de Agentes falló al cargar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (agents.length === 0) {
    throw new HarnessBootstrapError("el Registro de Agentes no tiene ningún agente definido");
  }

  // 2. Motor de Hooks después: en un hito futuro con Registro de Comandos/
  //    Skills, un hook podría necesitar inspeccionar qué agentes existen —
  //    en Hito 1 el motor mínimo no tiene esa dependencia real todavía
  //    (registro vacío, ver hook-engine.ts), pero el orden queda fijado acá
  //    para cuando sí la tenga.
  return { agents, hooks };
}
