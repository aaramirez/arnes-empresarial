/**
 * Delegación a Subagentes (arc42 2.2, Hito 5, tarea 6).
 *
 * Este módulo tiene una sola responsabilidad: ensamblar el texto que se
 * persiste TAL CUAL en `delegaciones.tarea_delegada` (`construirTareaDelegada`,
 * §5.3), y declarar el puerto `InvocarSubagente` que el composition root
 * cierra sobre `invokeModel` con `resumeSessionId: undefined` explícito
 * (ADR 53) — la implementación real vive fuera del núcleo, se ejercita con
 * doble recién en la tarea 8.
 *
 * `construirTareaDelegada` es la única función que construye ese texto — es
 * lo que hace verificable el criterio de éxito "ninguna `tarea_delegada`
 * persistida contiene el historial del agente padre": hay un único punto
 * donde mirar. Deliberadamente NO recibe ni usa `rol.systemPrompt`: ese
 * texto ya viaja aparte, como parte de la `AgentDefinition` propia del rol
 * que el composition root registra en `options.agents` (Hito 5, tarea 9) —
 * incluirlo acá lo duplicaría en la fila de `delegaciones` sin necesidad.
 * `InsumoDelegado.material` es siempre un `string` plano — no hay ningún
 * tipo por el que un historial de sesión pueda colarse en su lugar.
 *
 * Imports: `./definitions.js` (núcleo) y, solo como TIPO, `Options` del SDK
 * (Hito 5.1, tarea 27) — la regla de `AGENTS.md` es que `src/core/` nunca
 * importa de `src/adapters/*` (ni siquiera un import de tipo); el SDK mismo
 * ya tiene precedente exacto de import de tipo dentro de `src/core/` en
 * `turn-selector/handle-turn.ts` y `turn-selector/invoke-model.ts`
 * (`import type { Options } from "@anthropic-ai/claude-agent-sdk"`), erasado
 * en compilación — no hay contacto en runtime con el SDK ni con
 * `src/adapters/*` desde este archivo.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "./definitions.js";

/**
 * Tope duro del texto delegado (mitigación de R2). No es configurable: es un
 * invariante de la evidencia — `delegaciones.tarea_delegada` tiene que caber
 * en una lectura humana para servir de auditoría del aislamiento.
 */
export const TAREA_DELEGADA_MAX_CHARS = 8_000;
export const TAREA_TRUNCADA_SUFIJO = "\n[…tarea truncada por tope de tamaño…]";

export interface InsumoDelegado {
  /** Qué tiene que hacer este rol, en una o dos líneas. */
  readonly instruccion: string;
  /**
   * El material acotado: metadatos del PR, o la SALIDA de texto del rol
   * anterior. NUNCA una sesión.
   */
  readonly material: string;
}

/** Trunca `texto` a `TAREA_DELEGADA_MAX_CHARS`, agregando `TAREA_TRUNCADA_SUFIJO` cuando se corta. */
function truncarTareaDelegada(texto: string): string {
  if (texto.length <= TAREA_DELEGADA_MAX_CHARS) {
    return texto;
  }
  return `${texto.slice(0, TAREA_DELEGADA_MAX_CHARS)}${TAREA_TRUNCADA_SUFIJO}`;
}

/**
 * PURA. Ensambla el texto que se persiste TAL CUAL en
 * `delegaciones.tarea_delegada`. Mismo input, mismo string.
 *
 * Estructura del texto generado, en este orden:
 *  1. Encabezado con el id y la `description` del rol invocado (para que la
 *     fila de `delegaciones` sea auditable por sí sola, sin tener que cruzar
 *     `definitions.ts`).
 *  2. La instrucción acotada del rol (`insumo.instruccion`).
 *  3. El material acotado (`insumo.material`) — metadatos del PR o la salida
 *     de texto del rol anterior, nunca su sesión ni su `systemPrompt`.
 *
 * El texto ensamblado se trunca a `TAREA_DELEGADA_MAX_CHARS` (§ arriba).
 */
export function construirTareaDelegada(rol: AgentDefinition, insumo: InsumoDelegado): string {
  const texto = [
    `Rol delegado: ${rol.id} — ${rol.description}`,
    `Instrucción: ${insumo.instruccion}`,
    "",
    insumo.material,
  ].join("\n");

  return truncarTareaDelegada(texto);
}

export interface InvocacionSubagenteResult {
  readonly responseText: string;
  readonly sdkSessionId: string;
  /** Correlación cuando el SDK lo trae (spec). Ausente no bloquea nada. */
  readonly parentToolUseId?: string;
}

/**
 * Puerto (I5 por rol). El composition root lo cierra sobre `invokeModel` con
 * `resumeSessionId: undefined` explícito (ADR 53) — se ejercita con doble en
 * la tarea 8, la implementación real se cablea en la tarea 14.
 *
 * `cwd?`/`mcpServers?` (Hito 5.1, tarea 27, ADR 67 pto 4 — primera mitad de
 * "propagación hasta el SDK") son ADITIVOS y OPCIONALES: todo call site de
 * `v2.0.0` que arma el input con solo `agent`/`casoId`/`tareaDelegada` sigue
 * compilando y ejecutando IGUAL, porque agregar campos opcionales a un tipo
 * nunca rompe a quien ya construye un objeto más chico. `cwd` es la ruta
 * ABSOLUTA del worktree del Developer con escritura (mismo campo, mismo tipo,
 * que `InvocacionDeveloperEscritura.cwd` en `./definitions.js`, tarea 26);
 * `mcpServers` se tipa como `Options["mcpServers"]` del SDK — no una forma
 * propia inventada acá — porque ya hay precedente exacto de ese mismo tipo
 * usado dentro de `src/core/` (`turn-selector/invoke-model.ts`,
 * `turn-selector/handle-turn.ts`), y porque es, literalmente, el valor que
 * termina viajando a `options.mcpServers` de la llamada real al SDK
 * (segunda mitad de la propagación, tarea 28). Ninguno de los dos campos
 * tiene todavía un productor ni un consumidor real en este archivo — eso se
 * cablea en las tareas 14/28 — acá solo se declara el contrato.
 */
export type InvocarSubagente = (input: {
  readonly agent: AgentDefinition;
  readonly casoId: string;
  readonly tareaDelegada: string;
  /** Ruta ABSOLUTA del worktree, cuando el subagente invocado gana escritura (ADR 67). */
  readonly cwd?: string;
  /** Reenviado tal cual a `options.mcpServers` del SDK (ADR 61 pto 4/9). */
  readonly mcpServers?: Options["mcpServers"];
}) => Promise<InvocacionSubagenteResult>;
