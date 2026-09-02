import type { BoardConfig } from "./config.js";

/**
 * Recorte estructural de `fetch` — el `fetch` global real (Node 20+, sin
 * import) lo satisface. Es EL seam de los tests: ninguno le pega a la API
 * real de GitHub, todos inyectan un doble.
 */
export type FetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type GithubFailureReason = "network" | "timeout" | "http" | "parse" | "unknown";

/** Cuánto del cuerpo de error de GitHub entra al mensaje — evita mensajes gigantes en el log. */
const ERROR_BODY_MAX_CHARS = 500;

/**
 * Error propio del adaptador — mismo rol que `GraphifyCliError` en el
 * Adaptador de Conocimiento y que `CasoNotFoundError` en `repository.ts`:
 * traducir la falla cruda a vocabulario del adaptador para que el log tenga
 * un `reason` estructurado. NUNCA cruza la frontera del puerto (§7).
 */
export class GithubApiError extends Error {
  readonly reason: GithubFailureReason;
  readonly status?: number;

  constructor(
    reason: GithubFailureReason,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GithubApiError";
    this.reason = reason;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

/**
 * `"owner/repo"` → `{ owner, repo }`.
 *
 * Formato válido: EXACTAMENTE una `/`, con contenido no vacío a ambos
 * lados. Lanza `GithubApiError("parse")` en cualquier otro caso:
 * - cero `/` (`"soloowner"`, `""`),
 * - dos o más `/` (`"owner/repo/extra"`, `"owner//repo"` — las dos barras
 *   seguidas cuentan como dos separadores, no como una con `repo` vacío),
 * - una sola `/` pero un lado vacío (`"owner/"`, `"/repo"`) — ni `owner` ni
 *   `repo` pueden ser cadena vacía porque la URL resultante (`/repos/{owner}/{repo}/...`)
 *   dejaría de tener sentido.
 */
export function splitProyectoId(proyectoId: string): { readonly owner: string; readonly repo: string } {
  const partes = proyectoId.split("/");
  if (partes.length !== 2) {
    throw new GithubApiError("parse", `proyectoId invalido (se espera "owner/repo"): "${proyectoId}"`);
  }
  const [owner, repo] = partes;
  if (owner === undefined || repo === undefined || owner === "" || repo === "") {
    throw new GithubApiError("parse", `proyectoId invalido (se espera "owner/repo"): "${proyectoId}"`);
  }
  return { owner, repo };
}

function isTimeoutError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/**
 * Única función que habla HTTP. Devuelve el JSON parseado (`unknown` — el
 * narrowing es de quien llama) o lanza `GithubApiError`.
 *
 * - Headers fijos: `Authorization: Bearer <token>`, `Accept:
 *   application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
 *   `User-Agent: <config.userAgent>`, y `Content-Type: application/json`
 *   solo cuando hay body.
 * - Timeout con `AbortSignal.timeout(config.requestTimeoutMs)` → `reason:
 *   "timeout"` (se distingue del error de red por `error.name ===
 *   "TimeoutError"`).
 * - `!response.ok` → `reason: "http"` con `status`. El cuerpo de error de
 *   GitHub se lee con `text()` y se recorta para el mensaje; NUNCA se
 *   loguea el token.
 * - Sin reintentos, sin backoff, sin paginación: fuera de alcance
 *   explícito de la propuesta (una llamada por transición no lo justifica).
 */
export async function githubRequest(input: {
  readonly method: string;
  /** Path relativo a `apiBaseUrl`, ya con owner/repo/número interpolados. */
  readonly path: string;
  readonly body?: unknown;
  readonly config: BoardConfig;
  readonly fetchFn: FetchFn;
}): Promise<unknown> {
  const { method, path, body, config, fetchFn } = input;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": config.userAgent,
  };
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  if (serializedBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const url = `${config.apiBaseUrl}${path}`;

  let response: FetchResponseLike;
  try {
    response = await fetchFn(url, {
      method,
      headers,
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new GithubApiError("timeout", `GitHub request timed out: ${method} ${path}`, { cause: error });
    }
    throw new GithubApiError("network", `GitHub request failed: ${method} ${path}`, { cause: error });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new GithubApiError(
      "http",
      `GitHub request failed with status ${response.status}: ${method} ${path} - ${truncate(errorBody, ERROR_BODY_MAX_CHARS)}`,
      { status: response.status },
    );
  }

  const responseText = await response.text();
  return JSON.parse(responseText) as unknown;
}
