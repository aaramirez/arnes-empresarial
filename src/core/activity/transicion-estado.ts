/**
 * Máquina de estados de `actividades.estado` (Hito 3, tarea 3).
 *
 * Dos funciones puras, sin I/O:
 * - `transicionarEstado`: aplica la tabla de transición literal de
 *   `design.md` §3.2. `aprobado` y `observado` valen desde cualquier estado
 *   actual; `resuelto` solo es alcanzable desde `observado` (es lo único que
 *   "resuelto" significa) y desde cualquier otro estado es una transición
 *   inválida que devuelve `estadoActual` sin cambio.
 * - `parseVeredicto`: extrae el veredicto de la respuesta del agente
 *   buscando la ÚLTIMA línea `VEREDICTO: <valor>` reconocible. REGLA DURA
 *   (R5 de la propuesta, spec `activity-webhook-turn`): cualquier ambigüedad
 *   — sin línea, valor no reconocido — cae en `VEREDICTO_OBSERVADO`, JAMÁS
 *   en `VEREDICTO_APROBADO`. Un fallo de parseo no puede aprobar un PR solo.
 *
 * Import único: `./activity-contract.js`, mismo núcleo (regla no negociable
 * de `AGENTS.md`: `src/core/` no importa de `src/adapters/*`, ni del SDK, ni
 * de Node).
 */
import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_RESUELTO,
  VEREDICTO_APROBADO,
  VEREDICTO_OBSERVADO,
  VEREDICTO_PREFIX,
  VEREDICTO_RESUELTO,
  type ActividadEstado,
  type Veredicto,
} from "./activity-contract.js";

/**
 * Palabra clave sin los dos puntos, derivada de `VEREDICTO_PREFIX` — misma
 * fuente única que usa el prompt (`activity-prompt.ts`), para que ambos
 * nunca diverjan si el prefijo cambiara.
 */
const VEREDICTO_KEYWORD = VEREDICTO_PREFIX.replace(/:\s*$/, "");

/**
 * Busca la línea `VEREDICTO: <valor>`, tolerando decoración de markdown
 * (`**`, backticks, `#`, guiones bajos) y espacios antes de la palabra
 * clave o alrededor de los dos puntos. Flags: `g` para poder tomar la
 * ÚLTIMA coincidencia, `i` para mayúsculas/minúsculas, `m` para que `^`/`$`
 * matcheen por línea.
 */
const VEREDICTO_LINE_REGEX = new RegExp(
  `^\\s*[*_\`#\\s]*${VEREDICTO_KEYWORD}\\s*:\\s*(.+)$`,
  "gim",
);

const APROBADO_SINONIMOS = new Set(["aprobado", "aprobada", "approved", "lgtm"]);
const OBSERVADO_SINONIMOS = new Set([
  "observado",
  "observada",
  "observaciones",
  "changes_requested",
]);
const RESUELTO_SINONIMOS = new Set(["resuelto", "resuelta", "resolved"]);

/**
 * Quita backticks, asteriscos, comillas, puntos finales y espacios, y pasa
 * a minúsculas sin acentos (design.md §3.2, punto 2 del algoritmo).
 */
function normalizarValorCrudo(valorCrudo: string): string {
  const sinDecoracion = valorCrudo.replace(/[`*"']/g, "").trim();
  const sinPuntoFinal = sinDecoracion.replace(/\.+$/, "").trim();
  const marcasCombinantes = new RegExp("[\\u0300-\\u036f]", "g");
  return sinPuntoFinal.normalize("NFD").replace(marcasCombinantes, "").toLowerCase();
}

export function parseVeredicto(respuestaAgente: string): Veredicto {
  const coincidencias = [...respuestaAgente.matchAll(VEREDICTO_LINE_REGEX)];
  const ultima = coincidencias.at(-1);
  if (ultima === undefined) {
    return VEREDICTO_OBSERVADO;
  }

  const valorNormalizado = normalizarValorCrudo(ultima[1] ?? "");

  if (APROBADO_SINONIMOS.has(valorNormalizado)) {
    return VEREDICTO_APROBADO;
  }
  if (RESUELTO_SINONIMOS.has(valorNormalizado)) {
    return VEREDICTO_RESUELTO;
  }
  // Incluye el caso de `OBSERVADO_SINONIMOS` y CUALQUIER valor no
  // reconocido — el fallback de seguridad (R5) es el mismo destino que el
  // veredicto "observado" explícito.
  return VEREDICTO_OBSERVADO;
}

export function transicionarEstado(
  estadoActual: ActividadEstado,
  veredicto: Veredicto,
): ActividadEstado {
  if (veredicto === VEREDICTO_APROBADO) {
    return ESTADO_APROBADO;
  }
  if (veredicto === VEREDICTO_OBSERVADO) {
    return ESTADO_OBSERVADO;
  }
  // veredicto === VEREDICTO_RESUELTO: solo alcanzable desde `observado`.
  if (estadoActual === ESTADO_OBSERVADO) {
    return ESTADO_RESUELTO;
  }
  return estadoActual;
}
