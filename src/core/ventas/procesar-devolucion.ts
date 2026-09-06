/**
 * Caso de uso: procesar una solicitud de devolución (Hito 4, tarea 8, §3.4,
 * ADR 19). Orquestador SÍNCRONO, mismo criterio que `confirmar-venta.ts`:
 * sin `await`, sin lógica de concurrencia propia — el CAS lo hace el `store`
 * vía `UPDATE ... WHERE estado = 'confirmada' ... RETURNING` (ADR 15); este
 * módulo solo interpreta el resultado.
 *
 * ADR 19: el `token_confirmacion` de la venta es la CREDENCIAL de este
 * camino, no un token que se valide con `validarTokenConfirmacion` de
 * `token-confirmacion.ts`. Este módulo NO importa esa función a propósito:
 * `expires_at` acota cuánto dura la ventana para CONFIRMAR, no para pedir
 * una devolución después. La única guarda real es el ESTADO de la venta
 * (`WHERE estado = 'confirmada'` en el CAS del store, ADR 19 punto 3).
 *
 * Este módulo no toca `comisiones` en ningún camino: es una operación
 * completamente separada del flujo de confirmación (spec
 * `reembolso-evaluacion`, "Evaluación no llama al modelo" — tampoco llama a
 * `confirmarVentaConComision` ni a `rechazarVenta`).
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/ventas/`
 * (mismo dominio) — regla no negociable de `AGENTS.md`: `src/core/` nunca
 * importa de `src/adapters/*`, ni del SDK, ni de Node.
 */
import { VENTA_ESTADO_CONFIRMADA, type VentaStorePort } from "./ventas-contract.js";
import { evaluarReembolso, RESULTADO_REEMBOLSO_AUTO_APROBADO } from "./reembolso.js";
import { type VentasConfig } from "./ventas-config.js";

export interface ProcesarDevolucionDeps {
  readonly store: VentaStorePort;
  readonly config: VentasConfig;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

/**
 * `ventaId`/`casoId` ganan los dos caminos exitosos y los `no_aplicable`
 * posteriores a encontrar la venta (`tui-canal-empleado`, ADR 27,
 * design.md §3.9). El `no_aplicable` de token inexistente queda SIN ids a
 * propósito: la fila del registro no tiene qué correlacionar y no debe
 * quedar rastro del token.
 */
export type DevolucionResult =
  | { readonly resultado: "reembolsada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "escalada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "no_aplicable"; readonly ventaId?: string; readonly casoId?: string };

/**
 * Secuencia exacta (design.md §3.4):
 *  1. `venta = store.buscarVentaPorToken(token)` (ADR 19: el token de
 *     confirmación es la credencial de este camino).
 *  2. `venta === undefined` → `no_aplicable`, loguea `devolucion-rechazada`
 *     con `motivo: "token"`. **`expires_at` NO se evalúa acá** (ADR 19,
 *     punto 2): una devolución ocurre después de confirmar, potencialmente
 *     meses después.
 *  3. `venta.estado !== VENTA_ESTADO_CONFIRMADA` → `no_aplicable`, loguea
 *     `devolucion-rechazada` con `motivo: "estado"` y el estado real. SIN
 *     efecto (spec, escenario "Devolución sobre venta no confirmada").
 *  4. `evaluarReembolso(venta.monto, config.reembolsoUmbral)`:
 *     - `auto_aprobado` → `store.aprobarReembolso({ventaId, ahora})`.
 *       `undefined` → `no_aplicable` (carrera CAS). Fila → `reembolsada`.
 *       **No se crea ninguna escalación** y **la fila de `comisiones` NO se
 *       toca** → `reembolso-aprobado`.
 *     - `escalado` → `store.escalarReembolso({ventaId, casoId: venta.casoId,
 *       ahora})`. `undefined` → `no_aplicable` (carrera CAS). Fila → venta
 *       `reembolso_pendiente` Y `caso` → `pendiente_aprobacion_humana`,
 *       MISMA transacción (ADR 11, punto 2). **NINGÚN camino de este módulo
 *       mueve la venta a `reembolsada` desde `reembolso_pendiente`** — eso
 *       es el ADR 11 punto 3 y el spec "Cierre de la escalación fuera de
 *       alcance". → `reembolso-escalado`.
 *
 * SÍNCRONA, por la misma razón que `resolverDecisionVenta`.
 * CERO llamadas al modelo (spec, escenario "Evaluación no llama al modelo").
 */
export function procesarDevolucion(
  input: { readonly token: string; readonly motivo?: string },
  deps: ProcesarDevolucionDeps,
): DevolucionResult {
  const { store, config, now, logEvent } = deps;

  const venta = store.buscarVentaPorToken(input.token);

  if (venta === undefined) {
    logEvent("desconocido", "devolucion-rechazada", { motivo: "token" });
    return { resultado: "no_aplicable" };
  }

  if (venta.estado !== VENTA_ESTADO_CONFIRMADA) {
    logEvent(venta.casoId, "devolucion-rechazada", {
      motivo: "estado",
      estadoActual: venta.estado,
    });
    return { resultado: "no_aplicable", ventaId: venta.id, casoId: venta.casoId };
  }

  const ahora = now();
  const evaluacion = evaluarReembolso(venta.monto, config.reembolsoUmbral);

  if (evaluacion === RESULTADO_REEMBOLSO_AUTO_APROBADO) {
    const ventaReembolsada = store.aprobarReembolso({ ventaId: venta.id, ahora });

    if (ventaReembolsada === undefined) {
      return { resultado: "no_aplicable", ventaId: venta.id, casoId: venta.casoId };
    }

    logEvent(venta.casoId, "reembolso-aprobado", {
      ventaId: venta.id,
      monto: venta.monto,
      umbral: config.reembolsoUmbral,
    });
    return { resultado: "reembolsada", ventaId: venta.id, casoId: venta.casoId };
  }

  const ventaEscalada = store.escalarReembolso({
    ventaId: venta.id,
    casoId: venta.casoId,
    ahora,
  });

  if (ventaEscalada === undefined) {
    return { resultado: "no_aplicable", ventaId: venta.id, casoId: venta.casoId };
  }

  logEvent(venta.casoId, "reembolso-escalado", {
    ventaId: venta.id,
    monto: venta.monto,
    umbral: config.reembolsoUmbral,
  });
  return { resultado: "escalada", ventaId: venta.id, casoId: venta.casoId };
}
