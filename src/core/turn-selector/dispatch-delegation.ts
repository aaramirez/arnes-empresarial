/**
 * Despachador de Delegación — tipos y resolución de destino (arc42 1.4,
 * Hito 5, tarea 7, design.md §5.4 parte 1).
 *
 * Este archivo declara, por ahora, únicamente `DestinoDelegacion`,
 * `resolverDestino` y las dos clases de error tipado del despachador.
 * `despacharDelegacion`/`despacharCadena` (§5.4 parte 2, con
 * `DelegacionStorePort`/`DespacharDelegacionDeps`/`DelegacionAplicada`) se
 * agregan en la tarea 8, sobre este mismo archivo — no están acá a propósito.
 *
 * `resolverDestino` es PURA y SÍNCRONA — cero `await`, cero I/O, cero red,
 * mismo molde que `procesarDevolucion` (`src/core/ventas/procesar-devolucion.ts`):
 * un orquestador de núcleo que no necesita ser `async` no lo es. En este hito
 * devuelve siempre `{ kind: "in-process", agentId }` para todo id presente en
 * `SUBAGENT_REGISTRY` (`src/core/agents/definitions.ts`) — la rama `a2a` de
 * `DestinoDelegacion` no es alcanzable por esta función en v2.0.0: existe,
 * está tipada, y se ejercita recién en la tarea 8 construyendo el destino a
 * mano y pasándoselo directo a `despacharDelegacion` (ADR 45 punto 3 — el
 * contrato con el Hito 6, que reemplaza el `throw` por el Cliente A2A real y
 * borra ese test).
 *
 * Un `agentId` que no está en `SUBAGENT_REGISTRY` lanza
 * `SubagenteDesconocidoError` **antes** de tocar la base (design.md §8,
 * mismo criterio que `ActividadTipoEstadoInvalidoError`).
 *
 * Import único: `../agents/definitions.js` (núcleo → núcleo — regla de
 * `AGENTS.md`: `src/core/` nunca importa de `src/adapters/*`, ni del SDK, ni
 * de Node).
 */
import { getSubagentDefinition } from "../agents/definitions.js";

/**
 * Unión discriminada del destino de una delegación (spec `despacho-delegacion`,
 * req. "`DestinoDelegacion` como unión discriminada resuelta por función
 * pura"). `a2a` es el brazo reservado para el Hito 6 — no implementado, ver
 * `DelegacionA2ANoImplementadaError`.
 */
export type DestinoDelegacion =
  | { readonly kind: "in-process"; readonly agentId: string }
  | { readonly kind: "a2a"; readonly agentId: string; readonly endpoint: string };

/**
 * ÚNICO punto del sistema donde el brazo A2A falla (ADR 45 punto 2).
 * Hito 6: reemplazar el `throw` que la usa por el Cliente A2A real y BORRAR
 * el test que la asserta.
 */
export class DelegacionA2ANoImplementadaError extends Error {
  constructor(destino: Extract<DestinoDelegacion, { kind: "a2a" }>) {
    super(
      `Delegación a2a no implementada (Hito 6): agentId="${destino.agentId}", ` +
        `endpoint="${destino.endpoint}"`,
    );
    this.name = "DelegacionA2ANoImplementadaError";
  }
}

/** `agentId` no encontrado en `SUBAGENT_REGISTRY` (design.md §8). */
export class SubagenteDesconocidoError extends Error {
  constructor(agentId: string) {
    super(`Subagente desconocido: "${agentId}" no está registrado en SUBAGENT_REGISTRY`);
    this.name = "SubagenteDesconocidoError";
  }
}

/**
 * PURA y SÍNCRONA. Resuelve el destino de una delegación por `agentId`,
 * consultando `SUBAGENT_REGISTRY` vía `getSubagentDefinition`. Todo id
 * registrado resuelve a `in-process` en este hito; un id no registrado lanza
 * `SubagenteDesconocidoError` sin tocar la base.
 */
export function resolverDestino(agentId: string): DestinoDelegacion {
  const rol = getSubagentDefinition(agentId);

  if (rol === undefined) {
    throw new SubagenteDesconocidoError(agentId);
  }

  return { kind: "in-process", agentId };
}
