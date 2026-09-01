/**
 * Prompt sintético del turno disparado por actividad (Hito 3, tarea 4).
 *
 * `buildActivityPrompt` reemplaza al texto que un humano tipearía en la TUI
 * cuando el turno lo dispara un evento externo (un webhook de GitHub, hoy).
 * Es una función PURA: mismo input, mismo string.
 *
 * El framing de "revisor de PRs" vive ACÁ, no en el system prompt de
 * `CONVERSATIONAL_AGENT` (`definitions.ts`, que este hito no toca — ver
 * `proposal.md`, "Approach — Agente y prompt sintético"): tocar ese system
 * prompt contaminaría también los turnos de TUI, y un segundo
 * `AgentDefinition` obligaría a bifurcar el Selector de Turno (v2, ADR 1 del
 * arc42).
 *
 * Import único: `./activity-contract.js` — regla no negociable de
 * `AGENTS.md` (`src/core/` no importa de `src/adapters/*`, ni del SDK, ni de
 * Node).
 */
import {
  ESTADO_OBSERVADO,
  VEREDICTO_PREFIX,
  VEREDICTOS,
  type Actividad,
  type ActividadEstado,
  type PullRequestMetadata,
} from "./activity-contract.js";

/** Topes de truncado del prompt sintético. Ver design.md §3.2 / §7. */
export const MAX_PROMPT_CUERPO_CHARS = 4_000;
export const MAX_PROMPT_COMENTARIO_CHARS = 2_000;
export const MAX_PROMPT_ARCHIVOS = 50;
export const MAX_PROMPT_TITULO_CHARS = 300;

const MARCA_TRUNCADO = "[…truncado]";

export interface ActivityPromptContext {
  /** `undefined` cuando el tablero no pudo leerlos (sin `GITHUB_TOKEN`, red caída). */
  readonly metadatos?: PullRequestMetadata;
  /** Comentario que disparó este turno (`issue_comment`), si lo hubo. */
  readonly comentarioDisparador?: string;
  /** Estado ANTES de este turno — el agente necesita saber si está revisando por primera vez o verificando observaciones previas. */
  readonly estadoActual: ActividadEstado;
  /** Fallbacks del propio evento, usados cuando `metadatos` es `undefined`. */
  readonly titulo: string;
  readonly cuerpo: string;
}

/** Trunca `texto` a `maxChars`, agregando `MARCA_TRUNCADO` cuando se corta. */
function truncarTexto(texto: string, maxChars: number): string {
  if (texto.length <= maxChars) {
    return texto;
  }
  return `${texto.slice(0, maxChars)}${MARCA_TRUNCADO}`;
}

/**
 * Formatea la lista de archivos cambiados, cortando en `MAX_PROMPT_ARCHIVOS`
 * y agregando `(… y N archivos más)` cuando se corta.
 */
function formatearArchivos(archivos: readonly string[]): string {
  if (archivos.length === 0) {
    return "(sin archivos)";
  }

  const visibles = archivos.slice(0, MAX_PROMPT_ARCHIVOS);
  const lineas = visibles.map((archivo) => `- ${archivo}`);

  if (archivos.length > MAX_PROMPT_ARCHIVOS) {
    const restantes = archivos.length - MAX_PROMPT_ARCHIVOS;
    lineas.push(`(… y ${restantes} archivos más)`);
  }

  return lineas.join("\n");
}

/**
 * Construye el prompt sintético que reemplaza al texto que un humano
 * tipearía en la TUI. FUNCIÓN PURA: mismo input, mismo string.
 *
 * Estructura del texto generado, en este orden (design.md §3.2):
 *  1. Rol + tarea.
 *  2. Referencia: `{proyectoId} #{referenciaExterna}`, tipo, estado actual.
 *  3. Título (truncado a `MAX_PROMPT_TITULO_CHARS`).
 *  4. Descripción (truncada a `MAX_PROMPT_CUERPO_CHARS`, con marca de truncado).
 *  5. Archivos cambiados: hasta `MAX_PROMPT_ARCHIVOS`, con marca de recorte.
 *  6. Si `comentarioDisparador` existe: el comentario, truncado a
 *     `MAX_PROMPT_COMENTARIO_CHARS`, con framing de "verificá si esto
 *     resuelve tus observaciones anteriores".
 *  7. LIMITACIÓN DECLARADA (honestidad de R4): no hay diff completo, solo
 *     metadatos y lista de archivos.
 *  8. Instrucción de cierre OBLIGATORIA: última línea `VEREDICTO: <valor>`
 *     con los valores de `VEREDICTOS` enumerados y su significado, más el
 *     default de `parseVeredicto` (mitigación de R5).
 *
 * Cuando `metadatos` es `undefined`, los puntos 3-5 se arman con
 * `contexto.titulo`/`contexto.cuerpo` del evento y una lista de archivos
 * vacía, más una línea que declara explícitamente la degradación.
 */
export function buildActivityPrompt(
  actividad: Actividad,
  contexto: ActivityPromptContext,
): string {
  const { metadatos, comentarioDisparador, estadoActual, titulo, cuerpo } = contexto;

  const tituloCrudo = metadatos?.titulo ?? titulo;
  const cuerpoCrudo = metadatos?.cuerpo ?? cuerpo;
  const archivosCrudos = metadatos?.archivosCambiados ?? [];

  const secciones: string[] = [];

  secciones.push(
    "Sos el revisor automático de PRs de este proyecto. Tu trabajo es analizar la actividad descripta abajo y emitir un veredicto fundamentado.",
  );

  secciones.push(
    [
      `Referencia: ${actividad.proyectoId} #${actividad.referenciaExterna}`,
      `Tipo: ${actividad.tipo}`,
      `Estado actual: ${estadoActual}`,
    ].join("\n"),
  );

  secciones.push(`Título:\n${truncarTexto(tituloCrudo, MAX_PROMPT_TITULO_CHARS)}`);

  secciones.push(`Descripción:\n${truncarTexto(cuerpoCrudo, MAX_PROMPT_CUERPO_CHARS)}`);

  if (metadatos === undefined) {
    secciones.push(
      "No se pudieron obtener metadatos completos del tablero (sin token configurado o error de red). No se pudieron leer los archivos cambiados; se usan los datos crudos del evento recibido.",
    );
  }

  secciones.push(`Archivos cambiados:\n${formatearArchivos(archivosCrudos)}`);

  if (comentarioDisparador !== undefined) {
    secciones.push(
      [
        "Se recibió un nuevo comentario en esta actividad. Verificá si esto resuelve las observaciones anteriores, en vez de tratarlo como una primera revisión desde cero.",
        "Comentario:",
        truncarTexto(comentarioDisparador, MAX_PROMPT_COMENTARIO_CHARS),
      ].join("\n"),
    );
  }

  secciones.push(
    "Limitación importante: no tenés el diff completo del PR, solo metadatos (título, descripción) y la lista de archivos cambiados. No afirmes nada sobre líneas de código que no viste, y no dés a entender que revisaste los cambios línea por línea.",
  );

  secciones.push(
    [
      `Terminá tu respuesta con una última línea exactamente con el formato \`${VEREDICTO_PREFIX} <valor>\`, donde <valor> es uno de: ${VEREDICTOS.join(", ")}.`,
      `- ${VEREDICTOS[0]}: el PR está listo, sin observaciones pendientes.`,
      `- ${VEREDICTOS[1]}: encontraste problemas que el responsable debe atender.`,
      `- ${VEREDICTOS[2]}: lo señalado previamente (estado actual \`${ESTADO_OBSERVADO}\`) quedó solucionado.`,
      `Si no incluís esa línea, o el valor no es reconocible, se asume \`${ESTADO_OBSERVADO}\` por seguridad.`,
    ].join("\n"),
  );

  return secciones.join("\n\n");
}
