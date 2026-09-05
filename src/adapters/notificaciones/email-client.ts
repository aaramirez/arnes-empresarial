import type { NotificacionesConfig } from "./config.js";

/**
 * Recorte estructural de `fetch` — el `fetch` global real (Node 20+, sin
 * import) lo satisface. Es EL seam de los tests: ninguno le pega a la API
 * real de Resend, todos inyectan un doble. Copia deliberada de
 * `adapters/board/github-client.ts`.
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

export type EmailFailureReason = "network" | "timeout" | "http" | "unknown";

/** Cuánto del cuerpo de error del proveedor entra al mensaje — evita mensajes gigantes en el log. */
const ERROR_BODY_MAX_CHARS = 500;

/**
 * Error propio del adaptador — mismo rol que `GithubApiError`: traduce la
 * falla cruda al vocabulario del adaptador. NUNCA cruza la frontera del
 * puerto (§7).
 */
export class EmailApiError extends Error {
  readonly reason: EmailFailureReason;
  readonly status?: number;

  constructor(
    reason: EmailFailureReason,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "EmailApiError";
    this.reason = reason;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/**
 * Única función que habla HTTP. Copia deliberada de `githubRequest`
 * (`adapters/board/github-client.ts`), incluidas sus decisiones:
 *  - `Authorization: Bearer <apiKey>`, `Content-Type: application/json`.
 *  - `AbortSignal.timeout(config.requestTimeoutMs)`; `error.name ===
 *    "TimeoutError"` distingue timeout de error de red.
 *  - `!response.ok` → `EmailApiError("http", ..., { status })`, con el
 *    cuerpo de error del proveedor RECORTADO en el mensaje y la API key
 *    jamás en ningún mensaje ni log.
 *  - Sin reintentos, sin backoff.
 *  - No parsea la respuesta (a diferencia de `githubRequest`) — solo
 *    importa si salió o no.
 *
 * Cuerpo enviado: `{ from, to, subject, html }` — la forma de Resend
 * (ADR 18).
 */
export async function enviarEmail(input: {
  readonly mensaje: { readonly to: string; readonly subject: string; readonly html: string };
  readonly config: NotificacionesConfig;
  readonly fetchFn: FetchFn;
}): Promise<void> {
  const { mensaje, config, fetchFn } = input;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({
    from: config.from,
    to: mensaje.to,
    subject: mensaje.subject,
    html: mensaje.html,
  });

  let response: FetchResponseLike;
  try {
    response = await fetchFn(config.apiUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new EmailApiError("timeout", "Email request timed out", { cause: error });
    }
    throw new EmailApiError("network", "Email request failed", { cause: error });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new EmailApiError(
      "http",
      `Email request failed with status ${response.status}: ${truncate(errorBody, ERROR_BODY_MAX_CHARS)}`,
      { status: response.status },
    );
  }
}
