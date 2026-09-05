import type { VentaNotifierPort, NotificacionMotivo } from "../../core/ventas/ventas-contract.js";
import { isNotificacionesEnabled, resolveNotificacionesConfig, type NotificacionesConfig } from "./config.js";
import { EmailApiError, enviarEmail, type FetchFn } from "./email-client.js";

/**
 * Facade del Adaptador de Notificaciones (Hito 4, tarea 21) — el único
 * archivo de `src/adapters/notificaciones/` que el composition root importa.
 * Cierra `config.ts`/`email-client.ts` (tareas 19-20) sobre el
 * `VentaNotifierPort` que los casos de uso de ventas consumen.
 */

type LogEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/**
 * Puerto no-op — degradación sin `EMAIL_API_KEY` (spec `venta-confirmacion`,
 * escenario "Sin `EMAIL_API_KEY` configurada"). Molde exacto de
 * `createNoopBoardAdapter` (`adapters/board/index.ts:22`, verificado).
 *
 * Loguea `email-omitido` CON EL LINK COMPLETO y devuelve
 * `{ enviado: false, motivo: "sin-api-key" }`. El link en el log es
 * deliberado: el objetivo declarado de esta degradación es que la demo y el
 * suite completo funcionen con cero cuentas externas, y para eso el link
 * tiene que ser recuperable. Consecuencia declarada (R17):
 * `data/harness.log` contiene links de confirmación válidos cuando el
 * notificador está degradado.
 */
export function createNoopNotificador(logEvent: LogEvent): VentaNotifierPort {
  return {
    async notificarLinkConfirmacion(input) {
      logEvent(input.casoId, "email-omitido", { linkConfirmacion: input.linkConfirmacion });
      return { enviado: false, motivo: "sin-api-key" };
    },
  };
}

/** Traduce cualquier falla (`EmailApiError` o un throw inesperado) a `{ reason, status? }` para el log. */
function describirFalla(error: unknown): { readonly reason: NotificacionMotivo; readonly status?: number } {
  if (error instanceof EmailApiError) {
    return error.status !== undefined ? { reason: error.reason, status: error.status } : { reason: error.reason };
  }
  return { reason: "unknown" };
}

const ASUNTO_CONFIRMACION = "Confirmá tu cambio de plan";

/**
 * Cuerpo del email como TEXTO PLANO (ADR 18, punto 1) — este módulo no usa
 * `escapeHtml` de `render.ts` (eso vive en el adaptador web, ADR 13). Un
 * email de confirmación de una sola línea con el link no necesita HTML, así
 * no hay nada que escapar.
 */
function armarCuerpo(input: { readonly planNuevo: string; readonly monto: number; readonly linkConfirmacion: string }): string {
  return [
    `Confirmá tu cambio al plan ${input.planNuevo} por ${input.monto}.`,
    "",
    `Link de confirmación: ${input.linkConfirmacion}`,
  ].join("\n");
}

/**
 * Puerto real. `try/catch` TOTAL alrededor de `enviarEmail`: cualquier
 * `EmailApiError` o throw inesperado se traduce a `{ enviado: false, motivo }`
 * y se loguea `email-fallido` con `reason` y `status?`. **Nunca rechaza,
 * nunca lanza** (contrato del puerto, §3.1).
 *
 * `clienteEmail` vacío → `{ enviado: false, motivo: "sin-destinatario" }` sin
 * llamar a `fetchFn`: no se le pide al proveedor que rechace lo que ya
 * sabemos que está mal.
 *
 * NUNCA se loguea `clienteEmail` (PII, y `data/harness.log` no tiene control
 * de acceso — mismo criterio con el que Hito 2 loguea `questionLength` y no
 * `question`).
 */
export function createNotificadorAdapter(deps: {
  readonly config?: NotificacionesConfig;
  readonly fetchFn?: FetchFn;
  readonly logEvent: LogEvent;
}): VentaNotifierPort {
  const config = deps.config ?? resolveNotificacionesConfig();

  if (!isNotificacionesEnabled(config)) {
    return createNoopNotificador(deps.logEvent);
  }

  const { logEvent } = deps;
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchFn);

  return {
    async notificarLinkConfirmacion(input) {
      const { casoId, clienteEmail, linkConfirmacion, planNuevo, monto } = input;

      if (clienteEmail === "") {
        logEvent(casoId, "email-fallido", { reason: "sin-destinatario" });
        return { enviado: false, motivo: "sin-destinatario" };
      }

      try {
        await enviarEmail({
          mensaje: {
            to: clienteEmail,
            subject: ASUNTO_CONFIRMACION,
            html: armarCuerpo({ planNuevo, monto, linkConfirmacion }),
          },
          config,
          fetchFn,
        });

        logEvent(casoId, "email-enviado", {});
        return { enviado: true };
      } catch (error) {
        const { reason, status } = describirFalla(error);
        logEvent(casoId, "email-fallido", { reason, ...(status !== undefined ? { status } : {}) });
        return { enviado: false, motivo: reason };
      }
    },
  };
}
