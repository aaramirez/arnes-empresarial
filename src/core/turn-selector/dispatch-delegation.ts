/**
 * Despachador de Delegación (arc42 1.4, Hito 5, design.md §5.4).
 *
 * Parte 1 (tarea 7): `DestinoDelegacion`, `resolverDestino` y el error
 * tipado del despachador.
 *
 * Parte 2 (tarea 8, esta extensión): `despacharDelegacion`/`despacharCadena`,
 * con el puerto `DelegacionStorePort`, sus dependencias
 * (`DespacharDelegacionDeps`), el resultado `DelegacionAplicada` y el tipo
 * `Eslabon` que arma una cadena (§5.4, comentario "Fold sobre
 * `despacharDelegacion`"; `Eslabon` no tiene firma literal en design.md —
 * ver el doc-comment de `despacharCadena` más abajo para la nota de alcance
 * explícita sobre esta forma).
 *
 * `resolverDestino` es PURA y SÍNCRONA — cero `await`, cero I/O, cero red,
 * mismo molde que `procesarDevolucion` (`src/core/ventas/procesar-devolucion.ts`):
 * un orquestador de núcleo que no necesita ser `async` no lo es. Devuelve
 * siempre `{ kind: "in-process", agentId }` para todo id presente en
 * `SUBAGENT_REGISTRY` (`src/core/agents/definitions.ts`) — la rama `a2a` de
 * `DestinoDelegacion` no es alcanzable por esta función: es resuelta por su
 * función hermana `resolverDestinoA2A` (`dispatch-delegation-a2a.ts`, Hito 6
 * tarea 12), consumida por `despacharDelegacionA2A`, el despachador hermano
 * de `despacharDelegacion` para el brazo externo (ADR 78 pto 1-3).
 *
 * Un `agentId` que no está en `SUBAGENT_REGISTRY` lanza
 * `SubagenteDesconocidoError` **antes** de tocar la base (design.md §8,
 * mismo criterio que `ActividadTipoEstadoInvalidoError`).
 *
 * Imports: `../agents/definitions.js`, `../agents/subagents.js` y
 * `../agents/a2a-contract.js` (núcleo → núcleo — regla de `AGENTS.md`:
 * `src/core/` nunca importa de `src/adapters/*`, ni del SDK, ni de Node).
 * Deliberadamente **ningún** import de `src/adapters/a2a/`.
 */
import type { AgentDefinition } from "../agents/definitions.js";
import { getSubagentDefinition } from "../agents/definitions.js";
import type { DestinoA2AClave } from "../agents/a2a-contract.js";
import type { InsumoDelegado, InvocarSubagente } from "../agents/subagents.js";
import { construirTareaDelegada } from "../agents/subagents.js";

/**
 * Unión discriminada del destino de una delegación (spec `despacho-delegacion`,
 * req. "`DestinoDelegacion` como unión discriminada resuelta por función
 * pura"). `a2a` identifica el destino externo por su `clave` cerrada del
 * registro de `a2a-contract.ts` (ADR 78 pto 1) — nunca por una URL: la base
 * sale del registro por env, jamás de un parámetro (R8). Su consumidor real
 * es `despacharDelegacionA2A` (`dispatch-delegation-a2a.ts`), que recibe
 * `destino: Extract<DestinoDelegacion, { kind: "a2a" }>`.
 */
export type DestinoDelegacion =
  | { readonly kind: "in-process"; readonly agentId: string }
  | { readonly kind: "a2a"; readonly clave: DestinoA2AClave };

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

/**
 * Puerto que el Despachador posee sobre `delegaciones` (design.md §5.4,
 * §6.3). `crearDelegacion` se llama ANTES de invocar al subagente y falla
 * RUIDOSAMENTE (mismo criterio que `ActivityStorePort`): sin fila no hay
 * trazabilidad, y una delegación sin traza es peor que una delegación que no
 * ocurrió (design.md §8). `completarDelegacion` se llama DESPUÉS, en una
 * ÚNICA transacción que inserta la fila de `sesiones_agente` del subagente y
 * actualiza `delegaciones.resultado` (ADR 48) — el composition root (tarea
 * 10, `src/adapters/memory/repository.ts`) implementa ambos métodos contra
 * SQLite; acá el puerto se ejercita solo con un doble.
 */
export interface DelegacionStorePort {
  crearDelegacion(input: {
    readonly id: string;
    readonly casoId: string;
    readonly agentId: string;
    readonly sesionPadreId?: string;
    readonly tareaDelegada: string;
    readonly createdAt: string;
  }): void;
  completarDelegacion(input: {
    readonly delegacionId: string;
    readonly sesion: {
      readonly id: string;
      readonly casoId: string;
      readonly agentId: string;
      readonly sdkSessionId: string;
      readonly createdAt: string;
    };
    readonly resultado: string;
  }): void;
}

/** Dependencias de `despacharDelegacion`/`despacharCadena` (design.md §5.4). */
export interface DespacharDelegacionDeps {
  readonly store: DelegacionStorePort;
  readonly invocar: InvocarSubagente;
  /**
   * Inyectado (no el `getSubagentDefinition` de `resolverDestino`, que
   * consulta directamente el módulo): permite testear `despacharDelegacion`
   * sin acoplarse a `SUBAGENT_REGISTRY` real. El composition root lo cierra
   * sobre `getSubagentDefinition`.
   */
  readonly getSubagente: (id: string) => AgentDefinition | undefined;
  /** `randomUUID` en producción; contador determinista en tests. */
  readonly newId: () => string;
  /** `() => new Date().toISOString()` en producción. */
  readonly now: () => string;
  /** Ya cerrado sobre `LogTurnEventDeps`; el núcleo no decide el destino del log. */
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

/** Resultado de UNA delegación despachada de punta a punta (design.md §5.4). */
export interface DelegacionAplicada {
  readonly agentId: string;
  readonly delegacionId: string;
  readonly sesionSubagenteId: string;
  readonly tareaDelegada: string;
  readonly resultado: string;
}

/**
 * Un eslabón de una cadena de delegación: el rol a invocar y su insumo
 * (design.md §5.4, comentario de `despacharCadena` — "Fold sobre
 * `despacharDelegacion`"). **Nota de alcance**: `Eslabon` no tiene firma
 * literal en design.md, solo se lo nombra como parámetro de
 * `despacharCadena`; esta forma reutiliza `InsumoDelegado` (§5.3) tal cual,
 * en vez de declarar campos `instruccion`/`material` duplicados. Para el
 * primer eslabón, `insumo.material` se usa TAL CUAL viene (p. ej. el prompt
 * de la actividad); para cualquier eslabón siguiente, `despacharCadena`
 * IGNORA `insumo.material` y lo reemplaza por el `resultado` (texto) del
 * eslabón anterior — `insumo.instruccion` nunca se pisa, es fija por rol.
 * `cadena-revision.ts` (tarea 11) construye `readonly Eslabon[]` con
 * `construirEslabonesRevision`.
 */
export interface Eslabon {
  readonly agentId: string;
  readonly insumo: InsumoDelegado;
}

/**
 * UNA delegación, de punta a punta (design.md §4.1 pasos a-e):
 *  a. `resolverDestino(agentId)` (o `input.destino`, ver más abajo).
 *  b. `construirTareaDelegada(rol, insumo)`.
 *  c. `store.crearDelegacion(...)` — ANTES de invocar.
 *  d. `await deps.invocar({ agent: rol, casoId, tareaDelegada })`.
 *  e. `store.completarDelegacion(...)` — DESPUÉS, con la sesión del subagente.
 *
 * Si `deps.invocar` rechaza, el error propaga TAL CUAL — sin capturar, sin
 * revertir la fila ya creada por `store.crearDelegacion` (que queda con
 * `tarea_delegada` y sin `resultado`), y sin tocar ningún otro estado
 * canónico (spec, escenario "Falla del subagente deja la fila sin
 * `resultado`").
 *
 * `input.destino` es un campo opcional adicional respecto de la firma de
 * design.md §5.4 (que solo declara `casoId`/`agentId`/`insumo`/
 * `sesionPadreId`), angostado a
 * `Extract<DestinoDelegacion, { kind: "in-process" }>` (ADR 78 pto 2): el
 * brazo `a2a` de la unión ya no es un valor aceptable acá — pasarlo es un
 * ERROR DE COMPILACIÓN, no una convención documentada. El destino externo se
 * despacha por `despacharDelegacionA2A` (`dispatch-delegation-a2a.ts`), la
 * función hermana. Ausente en producción: se resuelve siempre con
 * `resolverDestino(agentId)`.
 */
export async function despacharDelegacion(
  input: {
    readonly casoId: string;
    readonly agentId: string;
    readonly insumo: InsumoDelegado;
    readonly sesionPadreId?: string;
    readonly destino?: Extract<DestinoDelegacion, { kind: "in-process" }>;
  },
  deps: DespacharDelegacionDeps,
): Promise<DelegacionAplicada> {
  const { casoId, agentId, insumo, sesionPadreId } = input;
  const { store, invocar, getSubagente, newId, now, logEvent } = deps;

  // `input.destino ?? resolverDestino(agentId)` ya no se calcula acá: ambos
  // resuelven siempre `{ kind: "in-process", agentId }` (el tipo angostado
  // de `input.destino` lo garantiza en compilación — ADR 78 pto 2) y ningún
  // consumidor de este cuerpo necesita el objeto `DestinoDelegacion` en sí,
  // solo `agentId`, ya disponible desde `input`.

  const rol = getSubagente(agentId);
  if (rol === undefined) {
    throw new SubagenteDesconocidoError(agentId);
  }

  const tareaDelegada = construirTareaDelegada(rol, insumo);
  const delegacionId = newId();
  const createdAt = now();

  store.crearDelegacion({
    id: delegacionId,
    casoId,
    agentId,
    ...(sesionPadreId !== undefined ? { sesionPadreId } : {}),
    tareaDelegada,
    createdAt,
  });
  logEvent(casoId, "delegacion-iniciada", {
    agentId,
    delegacionId,
    tareaChars: tareaDelegada.length,
  });

  const invocacion = await invocar({ agent: rol, casoId, tareaDelegada });

  const sesionSubagenteId = newId();

  store.completarDelegacion({
    delegacionId,
    sesion: {
      id: sesionSubagenteId,
      casoId,
      agentId,
      sdkSessionId: invocacion.sdkSessionId,
      createdAt: now(),
    },
    resultado: invocacion.responseText,
  });
  logEvent(casoId, "delegacion-completada", {
    agentId,
    delegacionId,
    sdkSessionId: invocacion.sdkSessionId,
    resultadoChars: invocacion.responseText.length,
    ...(invocacion.parentToolUseId !== undefined
      ? { parentToolUseId: invocacion.parentToolUseId }
      : {}),
  });

  return {
    agentId,
    delegacionId,
    sesionSubagenteId,
    tareaDelegada,
    resultado: invocacion.responseText,
  };
}

/**
 * La CADENA determinista (spec `despacho-delegacion`, req. "Cadena
 * determinista Planner → Developer → Reviewer"). Fold secuencial sobre
 * `despacharDelegacion`: el `sesionSubagenteId` del paso N es el
 * `sesionPadreId` del paso N+1; el `material` del paso N+1 es el
 * `resultado` (texto) del paso N — nunca su sesión. La cabeza va SIN
 * `sesionPadreId` y con su propio `insumo.material` intacto.
 *
 * NO captura: si un eslabón falla, el error propaga tal cual (mismo
 * contrato que `despacharDelegacion`) y ningún eslabón posterior se
 * invoca — el diagnóstico completo queda en design.md §4.1 ("Falla de
 * cualquier rol").
 */
export async function despacharCadena(
  eslabones: readonly Eslabon[],
  input: { readonly casoId: string },
  deps: DespacharDelegacionDeps,
): Promise<readonly DelegacionAplicada[]> {
  const resultados: DelegacionAplicada[] = [];
  let sesionPadreId: string | undefined;
  let materialAnterior: string | undefined;

  for (const eslabon of eslabones) {
    const insumo: InsumoDelegado =
      materialAnterior === undefined
        ? eslabon.insumo
        : { instruccion: eslabon.insumo.instruccion, material: materialAnterior };

    const aplicada = await despacharDelegacion(
      {
        casoId: input.casoId,
        agentId: eslabon.agentId,
        insumo,
        ...(sesionPadreId !== undefined ? { sesionPadreId } : {}),
      },
      deps,
    );

    resultados.push(aplicada);
    sesionPadreId = aplicada.sesionSubagenteId;
    materialAnterior = aplicada.resultado;
  }

  return resultados;
}
