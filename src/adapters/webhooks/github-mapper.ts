import {
  ACTIVIDAD_TIPO_PR_REVIEW,
  type IncomingActivityEvent,
} from "../../core/activity/activity-contract.js";

export const ORIGEN_GITHUB = "github";
export const SUPPORTED_PULL_REQUEST_ACTIONS = ["opened", "synchronize", "reopened"] as const;
export const SUPPORTED_ISSUE_COMMENT_ACTIONS = ["created"] as const;

type SupportedPullRequestAction = (typeof SUPPORTED_PULL_REQUEST_ACTIONS)[number];
type SupportedIssueCommentAction = (typeof SUPPORTED_ISSUE_COMMENT_ACTIONS)[number];

/** Narrows `unknown` to a plain record, without asserting anything about its keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

interface RepositoryShape {
  readonly full_name: string;
  readonly name: string;
  readonly html_url: string;
}

/** Validates the `repository` object shared by both event types (§4.3). */
function readRepository(payload: Record<string, unknown>): RepositoryShape | undefined {
  const repository = payload.repository;
  if (!isRecord(repository)) {
    return undefined;
  }
  const { full_name, name, html_url } = repository;
  if (!isNonEmptyString(full_name) || !isNonEmptyString(name) || !isNonEmptyString(html_url)) {
    return undefined;
  }
  return { full_name, name, html_url };
}

interface ActorShape {
  readonly login: string;
}

function readActor(value: unknown): ActorShape | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { login } = value;
  if (!isNonEmptyString(login)) {
    return undefined;
  }
  return { login };
}

interface PullRequestShape {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly user: ActorShape;
}

function readPullRequest(payload: Record<string, unknown>): PullRequestShape | undefined {
  const pullRequest = payload.pull_request;
  if (!isRecord(pullRequest)) {
    return undefined;
  }
  const { number, title, user } = pullRequest;
  if (typeof number !== "number" || !isNonEmptyString(title)) {
    return undefined;
  }
  const actor = readActor(user);
  if (actor === undefined) {
    return undefined;
  }
  const body = typeof pullRequest.body === "string" ? pullRequest.body : "";
  return { number, title, body, user: actor };
}

interface IssueShape {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly user: ActorShape;
  readonly isPullRequest: boolean;
}

function readIssue(payload: Record<string, unknown>): IssueShape | undefined {
  const issue = payload.issue;
  if (!isRecord(issue)) {
    return undefined;
  }
  const { number, title, user } = issue;
  if (typeof number !== "number" || !isNonEmptyString(title)) {
    return undefined;
  }
  const actor = readActor(user);
  if (actor === undefined) {
    return undefined;
  }
  const body = typeof issue.body === "string" ? issue.body : "";
  return { number, title, body, user: actor, isPullRequest: issue.pull_request !== undefined };
}

interface CommentShape {
  readonly body: string;
  readonly authorLogin: string | undefined;
}

function readComment(payload: Record<string, unknown>): CommentShape | undefined {
  const comment = payload.comment;
  if (!isRecord(comment)) {
    return undefined;
  }
  const { body } = comment;
  if (typeof body !== "string") {
    return undefined;
  }
  const actor = readActor(comment.user);
  return { body, authorLogin: actor?.login };
}

function isSupportedPullRequestAction(action: unknown): action is SupportedPullRequestAction {
  return (
    typeof action === "string" &&
    (SUPPORTED_PULL_REQUEST_ACTIONS as readonly string[]).includes(action)
  );
}

function isSupportedIssueCommentAction(action: unknown): action is SupportedIssueCommentAction {
  return (
    typeof action === "string" &&
    (SUPPORTED_ISSUE_COMMENT_ACTIONS as readonly string[]).includes(action)
  );
}

function mapPullRequestEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  recibidoEn: string,
): IncomingActivityEvent | undefined {
  if (!isSupportedPullRequestAction(payload.action)) {
    return undefined;
  }
  const repository = readRepository(payload);
  const pullRequest = readPullRequest(payload);
  if (repository === undefined || pullRequest === undefined) {
    return undefined;
  }

  return {
    origen: ORIGEN_GITHUB,
    proyectoId: repository.full_name,
    proyectoNombre: repository.name,
    repoUrl: repository.html_url,
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: String(pullRequest.number),
    responsableId: pullRequest.user.login,
    titulo: pullRequest.title,
    cuerpo: pullRequest.body,
    archivosCambiados: [],
    deliveryId,
    recibidoEn,
  };
}

function mapIssueCommentEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  recibidoEn: string,
  botLogin: string | undefined,
): IncomingActivityEvent | undefined {
  if (!isSupportedIssueCommentAction(payload.action)) {
    return undefined;
  }
  const repository = readRepository(payload);
  const issue = readIssue(payload);
  const comment = readComment(payload);
  if (repository === undefined || issue === undefined || comment === undefined) {
    return undefined;
  }
  if (!issue.isPullRequest) {
    return undefined;
  }
  // Filtro anti-loop (bug real de verificación manual end-to-end, Hito 3
  // tarea 24): `publicarRevision` comenta el PR con `GITHUB_TOKEN`, GitHub
  // dispara `issue_comment.created` de vuelta, y sin este filtro ese eco se
  // mapea a un turno nuevo que vuelve a comentar — loop infinito confirmado
  // en logs reales. Se ignora únicamente cuando el autor del comentario
  // coincide con el login del propio bot.
  if (botLogin !== undefined && comment.authorLogin === botLogin) {
    return undefined;
  }

  return {
    origen: ORIGEN_GITHUB,
    proyectoId: repository.full_name,
    proyectoNombre: repository.name,
    repoUrl: repository.html_url,
    tipo: ACTIVIDAD_TIPO_PR_REVIEW,
    referenciaExterna: String(issue.number),
    responsableId: issue.user.login,
    titulo: issue.title,
    cuerpo: issue.body,
    archivosCambiados: [],
    comentarioDisparador: comment.body,
    deliveryId,
    recibidoEn,
  };
}

/**
 * Traduce un payload de GitHub ya verificado y parseado a un
 * `IncomingActivityEvent`. PURA — no toca red, no lanza.
 *
 * Devuelve `undefined` (evento IGNORADO, no error) cuando:
 * - `eventName` no es `"pull_request"` ni `"issue_comment"`;
 * - la acción no está en la lista soportada de ese evento;
 * - es `issue_comment` y `payload.issue.pull_request` NO existe (el issue no
 *   es un PR — escenario literal del spec);
 * - el payload no tiene la forma mínima esperada (`repository.full_name`,
 *   número, título). Un payload deforme se ignora, no rompe: el listener ya
 *   verificó que viene de GitHub, así que una forma inesperada es un cambio
 *   de la API, no un ataque;
 * - es `issue_comment` y `comment.user.login === input.botLogin`: filtro
 *   anti-loop — sin él, el propio comentario que `publicarRevision` postea
 *   al PR se reprocesa como un turno nuevo (bug real, ver Hito 3 tarea 24).
 *
 * El narrowing es a mano (type guards locales), sin `zod`: acá TODO camino
 * de invalidez termina en el mismo `undefined`, así que un schema solo
 * aportaría mensajes de error que nadie lee.
 *
 * Mapeo de campos:
 * | `IncomingActivityEvent` | `pull_request` | `issue_comment` |
 * |---|---|---|
 * | `proyectoId` | `repository.full_name` | ídem |
 * | `proyectoNombre` | `repository.name` | ídem |
 * | `repoUrl` | `repository.html_url` | ídem |
 * | `tipo` | `ACTIVIDAD_TIPO_PR_REVIEW` | ídem |
 * | `referenciaExterna` | `String(pull_request.number)` | `String(issue.number)` |
 * | `responsableId` | `pull_request.user.login` | `issue.user.login` |
 * | `titulo` | `pull_request.title` | `issue.title` |
 * | `cuerpo` | `pull_request.body ?? ""` | `issue.body ?? ""` |
 * | `archivosCambiados` | `[]` (los trae el tablero, §5) | `[]` |
 * | `comentarioDisparador` | ausente | `comment.body` |
 *
 * `responsableId` es el AUTOR del PR, no quien comentó: el responsable es
 * quien tiene que actuar sobre las observaciones, y es a quien se asigna el
 * Issue en `mirrorEstado`.
 */
export function mapGithubEvent(input: {
  readonly eventName: string | undefined;
  readonly payload: unknown;
  readonly deliveryId: string;
  readonly recibidoEn: string;
  readonly botLogin?: string;
}): IncomingActivityEvent | undefined {
  const { eventName, payload, deliveryId, recibidoEn } = input;
  if (!isRecord(payload)) {
    return undefined;
  }

  if (eventName === "pull_request") {
    return mapPullRequestEvent(payload, deliveryId, recibidoEn);
  }
  if (eventName === "issue_comment") {
    return mapIssueCommentEvent(payload, deliveryId, recibidoEn, input.botLogin);
  }
  return undefined;
}
