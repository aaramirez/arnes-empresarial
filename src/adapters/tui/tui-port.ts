/**
 * Contrato I1 (Núcleo ↔ Adaptador TUI) — Hito 1, tarea 14.
 *
 * The arc42 (Interfase 1) describes what I1 transports: "prompt del
 * empleado (entrada) / respuesta renderizada con estado del agente
 * (salida)", over "canal interno del mismo proceso Node.js" — no wire
 * format, just an in-process function call. `SubmitPromptHandler` is that
 * call: the TUI adapter (this module's caller, `start-tui.tsx`) invokes it
 * with the employee's prompt and awaits a `TuiTurnResult` to render.
 *
 * Nota de alcance — sin implementación de producción todavía: this hito's
 * task list explicitly stops at the TUI adapter in isolation (tarea 14).
 * Nothing in `src/core/` calls into this adapter yet — that wiring is the
 * end-to-end Integración (Hito 1, tarea 15, not implemented). Tests inject
 * fake handlers; there is no default export here that reaches the real
 * Núcleo, on purpose — inventing one now would be guessing at a contract
 * tarea 15 has not settled yet (e.g. which `casoId` a session runs under).
 *
 * `agentLabel` (not just `responseText`) mirrors the "estado del agente" the
 * arc42 explicitly calls out on the output side of I1 — a plain text
 * response alone would lose which agent answered, which is the piece of
 * state this adapter's pending indicator and rendered history are meant to
 * surface (see `App.tsx`'s module doc).
 */

/**
 * Sends `prompt` to the Núcleo (I1) and resolves with the rendered turn
 * result once the Núcleo has produced a final answer for it. Rejects if the
 * Núcleo fails to produce one — `App.tsx` renders that rejection as an
 * error instead of leaving the turn's pending state unresolved.
 *
 * `onAgentResolved` (optional) is called SYNCHRONOUSLY, before the returned
 * promise settles, with the id/label of the agent handling this turn — the
 * same "estado del agente" this module doc already calls out on the output
 * side of I1 (`TuiTurnResult.agentLabel`), just available earlier. This lets
 * the TUI show which agent is answering while the turn is still in flight,
 * instead of only once the final response arrives.
 */
export type SubmitPromptHandler = (
  prompt: string,
  onAgentResolved?: (agentLabel: string) => void,
) => Promise<TuiTurnResult>;

/** What a resolved turn renders in the TUI: the answer, and which agent gave it. */
export interface TuiTurnResult {
  /** Final assistant response text for this turn. */
  readonly responseText: string;
  /** Which agent produced `responseText` — the "estado del agente" I1 transports on the output side. */
  readonly agentLabel: string;
}
