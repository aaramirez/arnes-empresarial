/**
 * Prompt sintético para el turno disparado por una solicitud A2A entrante
 * (Hito 7, tarea 3).
 *
 * `buildSolicitudA2APrompt` reemplaza al texto que un humano tipearía en la
 * TUI cuando el turno lo dispara un `SendMessage` recibido por el Servidor
 * A2A entrante. Es una función PURA: mismo input, mismo string.
 *
 * El framing vive ACÁ, no en el system prompt de `CONVERSATIONAL_AGENT`
 * (`definitions.ts`, que este hito no toca): tocar ese system prompt
 * contaminaría también los turnos de TUI y de soporte web, y un segundo
 * `AgentDefinition` obligaría a bifurcar el Selector de Turno. Mismo criterio
 * que `buildSoportePrompt` (Hito 4, `src/core/ventas/soporte-prompt.ts`) y
 * `buildActivityPrompt` (Hito 3, `src/core/activity/activity-prompt.ts`).
 *
 * Módulo sin dependencias de código: ninguna — no depende de ningún otro
 * contrato del núcleo, cumpliendo la regla de `AGENTS.md` (`src/core/` no
 * trae nada de `src/adapters/*`, ni del SDK, ni de Node). El nombre
 * calificado de la tool de consultas (`mcp__consultas__consultar_negocio`,
 * tarea 6/9) se referencia ACÁ como literal fijo, sin traerlo desde
 * `consultas-negocio-tool.ts` — mantiene el invariante de este módulo
 * (verificado por test); la correspondencia exacta con
 * `CONSULTAS_TOOL_QUALIFIED_NAME` la fija el test de la tarea 12.
 */

/** Tope de truncado del texto entrante del prompt sintético. Ver design.md §5.1. */
export const MAX_SOLICITUD_A2A_CHARS = 8_000;

const MARCA_TRUNCADO = "[…truncado]";

/** Trunca `texto` a `maxChars`, agregando `MARCA_TRUNCADO` cuando se corta. */
function truncarTexto(texto: string, maxChars: number): string {
  if (texto.length <= maxChars) {
    return texto;
  }
  return `${texto.slice(0, maxChars)}${MARCA_TRUNCADO}`;
}

/**
 * Construye el prompt sintético que reemplaza al texto que un humano
 * tipearía en la TUI para el turno disparado por una solicitud A2A entrante.
 * FUNCIÓN PURA y TOTAL: mismo input, mismo string, nunca lanza.
 *
 * Estructura del texto generado, en este orden (design.md §5.1):
 *  1. Rol ("Sos el agente que atiende una solicitud A2A entrante...").
 *  2. El texto de la solicitud, truncado a `MAX_SOLICITUD_A2A_CHARS` con
 *     marca `[…truncado]`.
 *  3. LIMITACIÓN DECLARADA: esta solicitud es de sólo lectura, el agente no
 *     puede modificar ningún dato ni ejecutar ninguna acción sobre el
 *     sistema, y no puede delegar la solicitud a otro agente. Esto es
 *     literal y es de seguridad, no de estilo: sin esa línea, un modelo
 *     servicial podría intentar "resolver" la solicitud modificando datos o
 *     reenviándola a otro agente, y esta vía de entrada no tiene ningún
 *     puerto de escritura (ADR 98).
 *  4. INSTRUCCIÓN DE USO DE LA TOOL (tarea 12, Hallazgo 1): antes de
 *     responder con una generalidad, usar `mcp__consultas__consultar_negocio`
 *     para consultar datos reales de negocio. Es el síntoma que originó este
 *     change (`proposal.md` R9) — sin este empujón explícito, el modelo
 *     tiende a responder en abstracto aun teniendo la tool disponible.
 *  5. Instrucción de honestidad: si falta información para responder con
 *     certeza, decirlo explícitamente en vez de inventar una respuesta.
 */
export function buildSolicitudA2APrompt(texto: string): string {
  const secciones: string[] = [];

  secciones.push(
    "Sos el agente que atiende una solicitud recibida por el protocolo A2A (Agent-to-Agent) entrante. Tu trabajo es responder la solicitud descripta abajo de la forma más útil posible, dentro de tus limitaciones.",
  );

  secciones.push(`Solicitud recibida:\n${truncarTexto(texto, MAX_SOLICITUD_A2A_CHARS)}`);

  secciones.push(
    "Limitación importante: esta solicitud es de sólo lectura. No podés modificar ningún dato del sistema, no podés confirmar ni ejecutar ninguna acción, y no podés delegar a otro agente. Respondé usando únicamente la información disponible, sin afirmar que realizaste alguna acción sobre el sistema.",
  );

  secciones.push(
    "Antes de responder con una generalidad, usá la herramienta mcp__consultas__consultar_negocio para consultar el estado real de actividades, solicitudes internas, comisiones o reembolsos pendientes.",
  );

  secciones.push(
    "Si no tenés información suficiente para responder con certeza, decilo explícitamente en vez de inventar una respuesta.",
  );

  return secciones.join("\n\n");
}
