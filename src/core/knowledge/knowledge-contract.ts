/**
 * Contrato de conocimiento (I2, Hito 2 tarea 1).
 *
 * Lo único que el Núcleo sabe sobre la capacidad de consulta de conocimiento:
 * el nombre calificado de una tool MCP (para otorgarla en
 * `AgentDefinition.allowedTools`, `src/core/agents/definitions.ts`) y un
 * puerto de feedback que `handleTurn` invoca al cerrar el turno
 * (`src/core/turn-selector/handle-turn.ts`). La implementación real —
 * servidor MCP in-process, wrapper de subproceso de la CLI de Graphify —
 * vive en `src/adapters/knowledge/` e importa de este módulo, nunca al
 * revés: la regla no negociable de `AGENTS.md` es que `src/core/` no
 * importa de `src/adapters/*`, ni del SDK, ni de Node. Este archivo no
 * importa nada.
 */

/** Nombre del servidor MCP en `options.mcpServers`. */
export const KNOWLEDGE_MCP_SERVER_NAME = "knowledge";

/** Nombre de la tool dentro de ese servidor. */
export const KNOWLEDGE_TOOL_NAME = "query_knowledge_base";

/**
 * Nombre calificado que ve el modelo (`mcp__<server>__<tool>`, sdk.d.ts:48).
 * Es lo que va en `AgentDefinition.allowedTools`.
 */
export const KNOWLEDGE_TOOL_QUALIFIED_NAME =
  `mcp__${KNOWLEDGE_MCP_SERVER_NAME}__${KNOWLEDGE_TOOL_NAME}` as const;

/**
 * Cierre del loop de feedback (I2, escritura). Implementado por
 * `src/adapters/knowledge/`, inyectado desde el composition root.
 *
 * CONTRATO: nunca rechaza. Una falla del adaptador se loguea adentro y se
 * traga — el turno ya entregó su respuesta al empleado.
 */
export interface KnowledgeFeedbackPort {
  saveTurnResult(input: {
    readonly casoId: string;
    readonly question: string;
    readonly answer: string;
  }): Promise<void>;

  /**
   * Discards whatever has been recorded for the in-flight turn, WITHOUT
   * persisting anything to graphify. Called by `handleTurn`'s `catch` branch
   * (`src/core/turn-selector/handle-turn.ts`) when a turn fails after
   * `resolveTurn`: the underlying accumulator the adapter shares with the
   * MCP tool handler is a process-lifetime singleton, drained only by
   * `saveTurnResult` — which never runs on a failed turn. Without this,
   * whatever got recorded before the failure survives into the next turn and
   * contaminates that next turn's `saveTurnResult` call with citations that
   * do not belong to it. A failed turn has no valid answer to cite, so this
   * must never call out to `graphify save-result`; it only clears state.
   */
  discardPendingCitations(): void;
}
