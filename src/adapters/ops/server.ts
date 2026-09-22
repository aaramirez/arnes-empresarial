/**
 * Listener HTTP del cuarto adaptador — salud operativa del proceso (hijo 3,
 * ADR 257/258). Ruteo `switch` sobre `${method} ${ruta}` (abierto a rutas
 * nuevas, R38/R44), comparación LITERAL de la URL (S-a: sin normalizar path
 * ni ignorar query string), `Connection: close` + `Cache-Control: no-store`
 * + `Content-Type` en toda respuesta (S7), SIN `X-Request-Id` (es del
 * adaptador web, ADR 20 pto 5, y acá sería un identificador de correlación
 * regalado por un puerto sin auth). Liveness (`RUTA_VIVO`) NUNCA consulta el
 * `OpsSaludPort` (S6): es una constante, sin importar si las tres funciones
 * lanzan. `ops` NO loguea ninguna request (S9, `design.md` §5.5) — este
 * módulo no importa el logger de negocio, solo recibe `deps.logEvent` para
 * el único evento de ciclo de vida que le compete acá: `ops-cierre-forzado`
 * (S8, tarea 2.4).
 *
 * `GET /salud/listo` (slice D, ADR 258, S15) evalúa `evaluarReadiness`
 * SÍNCRONAMENTE sobre los tres hechos del `OpsSaludPort` inyectado: `200`
 * con `CUERPO_LISTO` si está lista, `503` con el motivo (`cerrando`,
 * `base` o `listener`) si no. Sin consultar terceros, sin I/O propia, sin
 * loguear (S5, S9) — límite declarado en S-f: un `OpsSaludPort` cuyas
 * funciones lanzan no está cubierto acá; `main.ts` garantiza que la sonda
 * de base no lanza y las otras dos son triviales (design.md §7.3, nota).
 */
import { createServer as createHttpServer } from "node:http";
import {
  CUERPO_LISTO,
  CUERPO_VIVO,
  OPS_CLOSE_TIMEOUT_MS,
  OPS_LOG_CORRELATION_ID,
  RUTA_LISTO,
  RUTA_VIVO,
  type OpsConfig,
} from "./config.js";
import type { CreateOpsServerFn, OpsHttpServerLike, OpsRequest, OpsResponse } from "./http.js";
import { evaluarReadiness } from "./readiness.js";

/**
 * Los tres hechos de readiness llegan INYECTADOS desde el composition root
 * (molde literal `reembolsosPort`, `main.ts:691-697`): `ops` no importa
 * `db`, ni `proceso-cierre.ts`, ni ningún otro adaptador (S5). `estaCerrando`
 * es `true` desde el instante de la señal (§6.3); `baseUtilizable` es una
 * sonda síncrona que NUNCA lanza (un fallo es `false`, §7.4);
 * `listenersCaidos` devuelve un NÚMERO, nunca nombres — la restricción de
 * no-filtración del vocabulario cerrado (S7) queda en el TIPO, no en la
 * disciplina de quien escribe el handler.
 */
export interface OpsSaludPort {
  estaCerrando(): boolean;
  baseUtilizable(): boolean;
  listenersCaidos(): number;
}

export interface OpsServerDeps {
  readonly config: OpsConfig;
  /** Requerido (S16: "sin churn opcional→requerido") — nace en este slice B con un consumidor stub en C (slice B/C, ver "Supuestos" #6 de tasks.md). */
  readonly salud: OpsSaludPort;
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface OpsServerHandle {
  readonly port: number;
  /** Ver S8: corta las ociosas, envuelve `server.close()` ENTERO con un techo de 5000 ms, NUNCA rechaza. */
  close(): Promise<void>;
}

/** Recorta la URL en el primer `?` — NO: S-a exige comparación LITERAL, así que NO se recorta acá (a diferencia de webhooks). */
function responderVivo(res: OpsResponse, conCuerpo: boolean): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "close");
  res.end(conCuerpo ? CUERPO_VIVO : undefined);
}

function responderNoEncontrado(res: OpsResponse): void {
  res.statusCode = 404;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "close");
  res.end();
}

/**
 * `evaluarReadiness` sobre los tres hechos leídos DE NUEVO en cada request
 * (S17: el `503 cerrando` tiene que reflejar el instante de la señal, no un
 * valor cacheado al montar el listener). Síncrona por construcción: las
 * tres funciones de `deps.salud` son llamadas síncronas (§7.4).
 */
function responderListo(deps: OpsServerDeps, res: OpsResponse, conCuerpo: boolean): void {
  const motivo = evaluarReadiness({
    cerrando: deps.salud.estaCerrando(),
    baseUtilizable: deps.salud.baseUtilizable(),
    listenersCaidos: deps.salud.listenersCaidos(),
  });
  res.statusCode = motivo === undefined ? 200 : 503;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "close");
  res.end(conCuerpo ? (motivo ?? CUERPO_LISTO) : undefined);
}

/**
 * Ruteo EXHAUSTIVO — `switch` sobre `${method} ${url}` (S-a: comparación
 * LITERAL, sin normalizar `req.url`: `/salud/vivo/` y `/salud/vivo?x=1`
 * caen al `default`, igual que un `method` `undefined`). Liveness responde
 * en el mismo tick sin tocar el `OpsSaludPort` (S6); readiness sí lo
 * consulta, también síncronamente (S15).
 */
function crearListener(deps: OpsServerDeps): (req: OpsRequest, res: OpsResponse) => void {
  return (req: OpsRequest, res: OpsResponse): void => {
    const clave = `${req.method ?? ""} ${req.url ?? ""}`;
    switch (clave) {
      case `GET ${RUTA_VIVO}`:
        responderVivo(res, true);
        return;
      case `HEAD ${RUTA_VIVO}`:
        responderVivo(res, false);
        return;
      case `GET ${RUTA_LISTO}`:
        responderListo(deps, res, true);
        return;
      case `HEAD ${RUTA_LISTO}`:
        responderListo(deps, res, false);
        return;
      default:
        responderNoEncontrado(res);
    }
  };
}

/**
 * Monta el listener sobre un servidor HTTP. `createServer` se inyecta
 * (default: `http.createServer` real) — mismo criterio que
 * `webhooks/server.ts` / `a2a/server.ts`: ningún test del suite por defecto
 * abre un puerto real.
 *
 * `listen` con DOS argumentos sin `host`, TRES con `host` (S3, molde
 * `webhooks/server.ts:352-360`): el default NUNCA es `"0.0.0.0"`, `"::"`,
 * `"localhost"` ni `""` (R21 del hijo 1).
 */
export function startServer(
  deps: OpsServerDeps,
  createServer: CreateOpsServerFn = (listener) =>
    createHttpServer((req, res) =>
      listener(req as unknown as OpsRequest, res as unknown as OpsResponse),
    ) as unknown as OpsHttpServerLike,
): Promise<OpsServerHandle> {
  const listener = crearListener(deps);
  const server = createServer(listener);

  return new Promise((resolve, reject) => {
    let settled = false;

    server.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    const alListen = (): void => {
      if (settled) {
        return;
      }
      settled = true;

      const handle: OpsServerHandle = {
        port: deps.config.port,
        close(): Promise<void> {
          return new Promise((resolveClose) => {
            // ★ DIVERGENCIA DELIBERADA del molde de los otros tres servidores
            //   (`web/server.ts`, `webhooks/server.ts:301-321`,
            //   `a2a/server.ts:877-902`), donde el race de
            //   `SERVER_CLOSE_TIMEOUT_MS` corre DENTRO del callback de
            //   `server.close()` para acotar el DRENAJE de un `Set<Promise>`
            //   de turnos huérfanos en vuelo. `ops` NO TIENE turnos: sus dos
            //   handlers (`/salud/vivo`, `/salud/listo`) son SÍNCRONOS y
            //   responden en el mismo tick — no hay nada que drenar. Lo
            //   único que puede colgar acá es el callback de
            //   `server.close()` mismo, detrás de un keep-alive ocioso del
            //   supervisor (defecto documentado en `a2a/server.ts:96-104`).
            //   Por eso el techo envuelve `server.close()` ENTERO, no su
            //   callback: es la única forma de que `OPS_CLOSE_TIMEOUT_MS`
            //   signifique algo acá (design.md §0.4/§4.4, S8).
            //
            //   Criterio para el hijo 6 (R45): si `/metrics` u otra ruta
            //   nueva agrega trabajo ASÍNCRONO (I/O, una promesa en vuelo),
            //   este módulo necesita su propio `Set<Promise>` y el race
            //   vuelve a entrar DENTRO del callback, igual que los otros
            //   tres. Mientras los handlers sean síncronos, este molde es
            //   correcto.
            server.closeIdleConnections(); // Node 18.2+ — corta las OCIOSAS, no las activas (S8).
            let idTecho: ReturnType<typeof setTimeout> | undefined;
            const cerrado = new Promise<void>((resolveCerrado) => {
              server.close(() => resolveCerrado());
            });
            const techo = new Promise<"timeout">((resolveTecho) => {
              idTecho = setTimeout(() => resolveTecho("timeout"), OPS_CLOSE_TIMEOUT_MS);
            });
            void Promise.race([cerrado.then(() => "cerrado" as const), techo]).then((resultado) => {
              if (resultado === "timeout") {
                deps.logEvent(OPS_LOG_CORRELATION_ID, "ops-cierre-forzado", {
                  techoMs: OPS_CLOSE_TIMEOUT_MS,
                });
              } else if (idTecho !== undefined) {
                // Cierre normal: el techo NO SHALL quedar armado (S-c) — sin
                // esto, un timer vivo retrasaría hasta 5 s la salida en TUI.
                clearTimeout(idTecho);
              }
              resolveClose(); // ★ NUNCA rechaza (molde WebhookAdapter.close).
            });
          });
        },
      };

      resolve(handle);
    };

    if (deps.config.host === undefined) {
      server.listen(deps.config.port, alListen);
    } else {
      server.listen(deps.config.port, deps.config.host, alListen);
    }
  });
}
