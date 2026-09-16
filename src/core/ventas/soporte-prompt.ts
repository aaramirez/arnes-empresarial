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

/**
 * Prompt sintético hermano de `buildSoportePrompt`, para el turno de
 * empleado autenticado con operaciones de negocio habilitadas
 * (`operaciones-negocio-conversacionales`, ADR 168 pto 1, design.md §7).
 * Misma firma pura, mismo truncado (`MAX_SOPORTE_CONSULTA_CHARS`, reusado
 * tal cual — no hay motivo de dominio para un tope distinto).
 *
 * Estructura: rol de empleado con acceso a la herramienta de operaciones
 * (SIN las dos líneas de seguridad de cliente de `buildSoportePrompt` —
 * `:65`/`:69` de este archivo — que son exactamente lo que este turno
 * revierte para el empleado) + la consulta + la instrucción de esperar
 * confirmación explícita en un mensaje nuevo antes de reinvocar la misma
 * operación.
 *
 * DUPLICACIÓN INTENCIONAL del texto de confirmación (no una referencia a
 * `INSTRUCCION_OPERACIONES_EMPLEADO` de `definitions.ts`): este módulo no
 * importa nada (ver el doc del módulo, "Import: ninguno") — mismo criterio
 * de independencia que `sesion.ts` documenta para `calcularExpiraEn`.
 *
 * `buildSoportePrompt` (la de cliente) NO se edita — ver arriba, byte a
 * byte igual que antes de esta función.
 *
 * `aprobacion-conversacional-hitl`, tarea 15 (ADR 220 pto 1-2): suma, DUPLICADA
 * a propósito de `definitions.ts` (sin refactor a constante compartida — mismo
 * criterio "sin imports" de este módulo), la mención de resolver escalaciones
 * de reembolso/solicitud y la instrucción sobre `accion` inequívoca.
 */
export function buildOperacionesEmpleadoPrompt(consulta: string): string {
  const secciones: string[] = [];

  secciones.push(
    "Sos el agente conversacional de este producto, en un turno de empleado autenticado con acceso a la herramienta de operaciones de negocio. Tu trabajo es resolver la consulta del empleado descripta abajo de la forma más útil posible, incluida la resolución de escalaciones de reembolso y solicitudes internas que le toque validar.",
  );

  secciones.push(`Consulta del empleado:\n${truncarTexto(consulta, MAX_SOPORTE_CONSULTA_CHARS)}`);

  secciones.push(
    "Nunca calculás ni proponés vos un monto, porcentaje o veredicto — eso lo hace siempre la herramienta de operaciones. Cuando el empleado te pida resolver un reembolso o una solicitud, la acción (`aprobar`, `rechazar` o `reabrir`) tiene que salir de una frase inequívoca del empleado. Si dice algo ambiguo —'resolvelo', 'dale', 'hacé lo que corresponda', 'fijate vos'— preguntá cuál de las acciones quiere en vez de elegir una. Nunca elegís vos la acción, ni la deducís del contexto, ni del dictamen, ni de lo que parezca más razonable. Si la herramienta te devuelve un pedido de confirmación, comunicáselo al empleado tal cual y esperá su respuesta explícita en un mensaje nuevo antes de volver a invocar la misma operación: nunca decidas vos que ya quedó confirmado.",
  );

  return secciones.join("\n\n");
}
