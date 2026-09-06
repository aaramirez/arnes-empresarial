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
 * Import único: `./definitions.js` — regla de `AGENTS.md` (`src/core/` no
 * importa de `src/adapters/*`, ni del SDK, ni de Node).
 */
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
 */
export type InvocarSubagente = (input: {
  readonly agent: AgentDefinition;
  readonly casoId: string;
  readonly tareaDelegada: string;
}) => Promise<InvocacionSubagenteResult>;
