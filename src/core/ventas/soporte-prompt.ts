/**
 * Prompt sintético para el turno de soporte al cliente (Hito 4, tarea 10).
 *
 * `buildSoportePrompt` reemplaza al texto que un humano tipearía en la TUI
 * cuando el turno lo dispara una consulta de soporte recibida por `POST
 * /soporte`. Es una función PURA: mismo input, mismo string.
 *
 * El framing vive ACÁ, no en el system prompt de `CONVERSATIONAL_AGENT`
 * (`definitions.ts`, que este hito no toca — spec `soporte-web-turno`):
 * tocar ese system prompt contaminaría también los turnos de TUI, y un
 * segundo `AgentDefinition` obligaría a bifurcar el Selector de Turno.
 * Mismo criterio que `buildActivityPrompt` en Hito 3
 * (`src/core/activity/activity-prompt.ts`).
 *
 * `clienteId` NO entra al prompt ni es parámetro de esta función: es un
 * identificador opaco sin significado para el modelo, y mandarlo solo
 * agregaría un dato sin uso al contexto.
 *
 * Import: ninguno — este módulo no depende de ningún otro contrato del
 * núcleo, cumpliendo la regla de `AGENTS.md` (`src/core/` no importa de
 * `src/adapters/*`, ni del SDK, ni de Node).
 */

/** Tope de truncado de la consulta del prompt sintético. Ver design.md §3.6. */
export const MAX_SOPORTE_CONSULTA_CHARS = 4_000;

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
 * tipearía en la TUI para el turno de soporte. FUNCIÓN PURA: mismo input,
 * mismo string.
 *
 * Estructura del texto generado, en este orden (design.md §3.6):
 *  1. Rol ("Sos el agente de soporte al cliente de este producto...").
 *  2. La consulta del cliente, truncada a `MAX_SOPORTE_CONSULTA_CHARS` con
 *     marca `[…truncado]`.
 *  3. LIMITACIÓN DECLARADA: el agente no tiene acceso a la cuenta del
 *     cliente, ni a sus ventas, y no puede confirmar, cancelar ni
 *     reembolsar nada. Esto es literal y es de seguridad, no de estilo: sin
 *     esa línea, un modelo servicial le dice al cliente "listo, te cancelé
 *     la venta", y la venta sigue igual. El camino del dinero es
 *     determinista y el agente conversacional no lo toca.
 *  4. Instrucción de derivar a un humano cuando la consulta requiera una
 *     acción sobre la cuenta.
 */
export function buildSoportePrompt(consulta: string): string {
  const secciones: string[] = [];

  secciones.push(
    "Sos el agente de soporte al cliente de este producto. Tu trabajo es responder la consulta del cliente descripta abajo de la forma más útil posible, dentro de tus limitaciones.",
  );

  secciones.push(`Consulta del cliente:\n${truncarTexto(consulta, MAX_SOPORTE_CONSULTA_CHARS)}`);

  secciones.push(
    "Limitación importante: no tenés acceso a la cuenta del cliente ni a sus ventas, y no podés confirmar, cancelar ni reembolsar nada. No afirmes ni des a entender que realizaste una acción sobre su cuenta o sus ventas.",
  );

  secciones.push(
    "Si la consulta requiere una acción sobre la cuenta del cliente (confirmar, cancelar, reembolsar, o cualquier otro cambio), derivá explícitamente a un humano en vez de intentar resolverlo vos.",
  );

  return secciones.join("\n\n");
}
