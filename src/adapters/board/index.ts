import type { ActivityBoardPort, PullRequestMetadata } from "../../core/activity/activity-contract.js";
import { isBoardEnabled, resolveBoardConfig, MAX_CHANGED_FILES, MAX_COMMENT_CHARS, type BoardConfig } from "./config.js";
import { GithubApiError, githubRequest, splitProyectoId, type FetchFn } from "./github-client.js";
import { labelForEstado, mergeLabels } from "./labels.js";

/**
 * Facade del Adaptador de Tablero (Hito 3, tarea 16) — el único archivo de
 * `src/adapters/board/` que el composition root importa. Cierra
 * `config.ts`/`labels.ts`/`github-client.ts` (tareas 13-15) sobre el
 * `ActivityBoardPort` que `run-activity-turn.ts` consume.
 */

type LogEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/**
 * Puerto no-op — degradación sin `GITHUB_TOKEN` (spec `activity-board-mirror`,
 * escenario "Turno completa sin token de GitHub"). No llama a nada; loguea
 * `tablero-deshabilitado` con la operación pedida. `leerMetadatos` devuelve
 * `undefined`, igual que su camino de falla real, así que el orquestador no
 * distingue "sin token" de "el tablero real no pudo leer".
 */
export function createNoopBoardAdapter(logEvent: LogEvent): ActivityBoardPort {
  return {
    async leerMetadatos(input) {
      logEvent(input.casoId, "tablero-deshabilitado", { operacion: "leerMetadatos" });
      return undefined;
    },
    async publicarRevision(input) {
      logEvent(input.casoId, "tablero-deshabilitado", { operacion: "publicarRevision" });
    },
    async mirrorEstado(input) {
      logEvent(input.casoId, "tablero-deshabilitado", { operacion: "mirrorEstado" });
    },
  };
}

/** Narrows lo que `githubRequest` devuelve como `unknown` para los 3 campos que `leerMetadatos` mapea. */
interface PullRequestPayload {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly user?: { readonly login?: unknown };
}

interface PullRequestFilePayload {
  readonly filename?: unknown;
}

interface IssuePayload {
  readonly labels?: ReadonlyArray<{ readonly name?: unknown }>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Truncates `text` to at most `maxChars` UTF-16 code units, the same way a
 * plain `text.slice(0, maxChars)` would — except it never splits a surrogate
 * pair (an emoji or any other character from a supplementary Unicode plane)
 * in half. A plain `slice` cuts by code unit count, so a cut that happens to
 * land exactly between a pair's high and low surrogate keeps the lone high
 * surrogate, corrupting the string. When the code unit right at the cut
 * boundary is a high surrogate, the cut backs off one position so that
 * dangling surrogate is dropped along with the rest of its pair.
 */
function truncateSafely(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const HIGH_SURROGATE_START = 0xd800;
  const HIGH_SURROGATE_END = 0xdbff;
  const boundaryCharCode = text.charCodeAt(maxChars - 1);
  const cutAt =
    boundaryCharCode >= HIGH_SURROGATE_START && boundaryCharCode <= HIGH_SURROGATE_END
      ? maxChars - 1
      : maxChars;
  return text.slice(0, cutAt);
}

/** Traduce cualquier falla (`GithubApiError` o un throw inesperado) a `{ reason, status? }` para el log. */
function describirFalla(error: unknown): { readonly reason: string; readonly status?: number } {
  if (error instanceof GithubApiError) {
    return error.status !== undefined ? { reason: error.reason, status: error.status } : { reason: error.reason };
  }
  return { reason: "unknown" };
}

/** Narrows lo que `githubRequest` devuelve como `unknown` para el único campo que `resolveBotLogin` lee. */
interface UserPayload {
  readonly login?: unknown;
}

/**
 * Resuelve el login del bot llamando `GET /user` con `GITHUB_TOKEN` — pensado
 * para correr UNA VEZ al arrancar el proceso (no por evento), cachear el
 * resultado y pasarlo como dependencia inyectada hasta `mapGithubEvent`, que
 * filtra ahí los comentarios que el propio bot publicó (bug real de
 * verificación manual end-to-end, Hito 3 tarea 24: `publicarRevision`
 * comenta el PR, GitHub reenvía ese comentario como `issue_comment.created`,
 * y sin este filtro el proceso reprocesa su propio eco — loop infinito).
 *
 * `logEvent` recibe la firma de 2 parámetros (`event`, `fields`) ya cerrada
 * sobre el id de correlación de transporte — NO se importa acá
 * `WEBHOOK_LOG_CORRELATION_ID` de `adapters/webhooks/config.ts`, porque eso
 * sería un adaptador (`board`) hablándole directo a otro adaptador
 * (`webhooks`), justo lo que AGENTS.md prohíbe. Mismo patrón que
 * `createKnowledge` en `main.ts`: `(event, fields) => logTurnEvent(casoId,
 * event, fields)`.
 *
 * Degradación: si el tablero está deshabilitado (sin token) o la resolución
 * falla por cualquier motivo (`GithubApiError` o un throw inesperado),
 * devuelve `undefined` y nunca lanza — mismo criterio que el resto del
 * Adaptador de Tablero, nunca bloquea el arranque.
 */
export async function resolveBotLogin(deps: {
  readonly config?: BoardConfig;
  readonly fetchFn?: FetchFn;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}): Promise<string | undefined> {
  const config = deps.config ?? resolveBoardConfig();

  if (!isBoardEnabled(config)) {
    deps.logEvent("bot-login-no-resuelto", { reason: "deshabilitado" });
    return undefined;
  }

  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchFn);

  try {
    const user = (await githubRequest({
      method: "GET",
      path: "/user",
      config,
      fetchFn,
    })) as UserPayload;

    const login = user.login;
    if (typeof login !== "string" || login === "") {
      deps.logEvent("bot-login-no-resuelto", { reason: "parse" });
      return undefined;
    }

    deps.logEvent("bot-login-resuelto", { login });
    return login;
  } catch (error) {
    const { reason, status } = describirFalla(error);
    deps.logEvent("bot-login-no-resuelto", { reason, ...(status !== undefined ? { status } : {}) });
    return undefined;
  }
}

/**
 * Construye el `ActivityBoardPort` real. Si `!isBoardEnabled(config)`
 * devuelve directamente `createNoopBoardAdapter(logEvent)` — degradación sin
 * `GITHUB_TOKEN` (spec `activity-board-mirror`): el estado canónico se sigue
 * persistiendo y solo se omite el espejo.
 *
 * CONTRATO IMPLEMENTADO: los tres métodos son `try/catch` TOTAL. Capturan
 * `GithubApiError` y cualquier throw inesperado, loguean, y resuelven.
 * `GithubApiError` nunca cruza esta frontera.
 */
export function createBoardAdapter(deps: {
  readonly logEvent: LogEvent;
  readonly config?: BoardConfig;
  readonly fetchFn?: FetchFn;
}): ActivityBoardPort {
  const config = deps.config ?? resolveBoardConfig();

  if (!isBoardEnabled(config)) {
    return createNoopBoardAdapter(deps.logEvent);
  }

  const { logEvent } = deps;
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchFn);

  return {
    async leerMetadatos(input) {
      const { proyectoId, referenciaExterna } = input;
      try {
        const { owner, repo } = splitProyectoId(proyectoId);

        // No pide el diff (Accept: ...diff ausente — R4): `githubRequest`
        // fija siempre `Accept: application/vnd.github+json`, y este path
        // apunta al recurso `pulls/{n}`, nunca a su variante de diff.
        const pr = (await githubRequest({
          method: "GET",
          path: `/repos/${owner}/${repo}/pulls/${referenciaExterna}`,
          config,
          fetchFn,
        })) as PullRequestPayload;

        const titulo = asString(pr.title);
        const cuerpo = asString(pr.body);
        const autor = asString(pr.user?.login);

        let archivosCambiados: readonly string[] = [];
        let archivosTruncados = false;
        try {
          const files = (await githubRequest({
            method: "GET",
            path: `/repos/${owner}/${repo}/pulls/${referenciaExterna}/files?per_page=${MAX_CHANGED_FILES}`,
            config,
            fetchFn,
          })) as readonly PullRequestFilePayload[];
          archivosCambiados = files.map((file) => asString(file.filename));
          archivosTruncados = files.length >= MAX_CHANGED_FILES;
        } catch {
          // Falla solo el segundo GET: se devuelven metadatos igual, con la
          // lista de archivos vacía — el primer GET ya trajo título/cuerpo/autor.
        }

        const metadata: PullRequestMetadata = { titulo, cuerpo, autor, archivosCambiados, archivosTruncados };
        return metadata;
      } catch {
        // Falla el primer GET (o `splitProyectoId`): sin metadatos, sin
        // intentar el segundo GET.
        return undefined;
      }
    },

    async publicarRevision(input) {
      const { proyectoId, referenciaExterna, texto, casoId } = input;
      try {
        const { owner, repo } = splitProyectoId(proyectoId);
        const truncado = truncateSafely(texto, MAX_COMMENT_CHARS);

        await githubRequest({
          method: "POST",
          path: `/repos/${owner}/${repo}/issues/${referenciaExterna}/comments`,
          body: { body: truncado },
          config,
          fetchFn,
        });

        logEvent(casoId, "tablero-comentario-publicado", { chars: truncado.length });
      } catch (error) {
        const { reason, status } = describirFalla(error);
        logEvent(casoId, "tablero-comentario-fallido", { reason, ...(status !== undefined ? { status } : {}) });
      }
    },

    async mirrorEstado(input) {
      const { proyectoId, referenciaExterna, estado, responsableId, casoId } = input;
      try {
        const { owner, repo } = splitProyectoId(proyectoId);
        const issuePath = `/repos/${owner}/${repo}/issues/${referenciaExterna}`;

        // El PATCH reemplaza el conjunto completo de labels — sin leer
        // primero se borrarían los labels manuales del equipo. Si el GET
        // falla, se sigue igual con `mergeLabels([], estado)` (documentado
        // en el diseño) y se loguea `tablero-labels-no-leidos` ADEMÁS del
        // `tablero-actualizado` si el PATCH que sigue sí tiene éxito.
        let labelsActuales: readonly string[] = [];
        try {
          const issue = (await githubRequest({
            method: "GET",
            path: issuePath,
            config,
            fetchFn,
          })) as IssuePayload;
          labelsActuales = (issue.labels ?? []).map((label) => asString(label.name));
        } catch (error) {
          const { reason } = describirFalla(error);
          logEvent(casoId, "tablero-labels-no-leidos", { reason });
        }

        const labels = mergeLabels(labelsActuales, estado);
        const label = labelForEstado(estado);

        await githubRequest({
          method: "PATCH",
          path: issuePath,
          // `assignees` se OMITE (no `assignees: []`) sin `responsableId` —
          // mandarlo vacío desasignaría a todos.
          body: { labels, ...(responsableId !== undefined ? { assignees: [responsableId] } : {}) },
          config,
          fetchFn,
        });

        logEvent(casoId, "tablero-actualizado", {
          estado,
          label,
          ...(responsableId !== undefined ? { assignee: responsableId } : {}),
        });
      } catch (error) {
        const { reason, status } = describirFalla(error);
        logEvent(casoId, "tablero-actualizacion-fallida", { reason, ...(status !== undefined ? { status } : {}) });
      }
    },
  };
}
