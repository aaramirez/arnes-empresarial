/**
 * Caso de uso: confirmar o rechazar una venta (Hito 4, tarea 7, §3.4).
 * Orquestador SÍNCRONO — a diferencia de `registrar-venta.ts`, este módulo
 * no tiene ningún `await`: valida el token con la función pura de
 * `token-confirmacion.ts`, calcula la comisión con las funciones puras de
 * `comision.ts` cuando corresponde, y delega el compare-and-swap al `store`.
 * No hay lógica de concurrencia propia acá — el CAS lo hace el `store` vía
 * `UPDATE ... WHERE estado = ... RETURNING` (ADR 15); este módulo solo
 * interpreta el resultado (`undefined` = "alguien llegó primero").
 *
 * Que la firma sea síncrona no es un detalle: es la prueba de que en este
 * camino no hay ni puede haber una ventana de carrera que una cola pudiera
 * arreglar (design.md §3.4, nota bajo `resolverDecisionVenta`). El adaptador
 * web la envuelve en una promesa ya resuelta para uniformar la firma de los
 * cinco handlers de `WebServerDeps`.
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/ventas/`
 * (mismo dominio) — regla no negociable de `AGENTS.md`: `src/core/` nunca
 * importa de `src/adapters/*`, ni del SDK, ni de Node.
 */
import {
  type ConfirmarVentaConComisionInput,
  type VentaStorePort,
} from "./ventas-contract.js";
import { type MotivoTokenInvalido, validarTokenConfirmacion } from "./token-confirmacion.js";
import { calcularComision, periodoDeConfirmacion } from "./comision.js";
import { type VentasConfig } from "./ventas-config.js";

export const DECISION_CONFIRMAR = "confirmar";
export const DECISION_RECHAZAR = "rechazar";
export type DecisionCliente = typeof DECISION_CONFIRMAR | typeof DECISION_RECHAZAR;

export interface ConfirmarVentaDeps {
  readonly store: VentaStorePort;
  readonly config: VentasConfig;
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export type DecisionVentaResult =
  | { readonly resultado: "confirmada"; readonly comisionMonto: number; readonly periodo: string }
  | { readonly resultado: "rechazada" }
  /** Token inexistente, estado inválido, vencido, o CAS que no matcheó. Indistinguibles hacia afuera (R6). */
  | { readonly resultado: "no_aplicable"; readonly motivo: MotivoTokenInvalido | "carrera" };

/**
 * Secuencia exacta (design.md §3.4):
 *  1. `ahora = now()` — UN solo valor para toda la operación: la validación
 *     del token, el `confirmed_at`/`created_at` de la comisión, el período y
 *     el predicado de expiración del `UPDATE`.
 *  2. `venta = store.buscarVentaPorToken(token)`.
 *  3. `validarTokenConfirmacion(venta, ahora)` — si `!valido`, loguea
 *     `token-invalido` con `motivo` y devuelve `no_aplicable`. SIN efecto:
 *     ningún método de escritura del `store` se llama en esta rama.
 *  4a. `decision === DECISION_RECHAZAR` → `store.rechazarVenta({ventaId,
 *      ahora})`. `undefined` → `no_aplicable` ("carrera"). Fila → `rechazada`.
 *      Ninguna fila en `comisiones` (spec, "Rechazo no genera comisión").
 *  4b. `decision === DECISION_CONFIRMAR` →
 *      `comisionMonto = calcularComision(venta.monto, config.comisionPorcentaje)`,
 *      `periodo = periodoDeConfirmacion(ahora)`, y
 *      `store.confirmarVentaConComision({ventaId, comisionId: newId(),
 *      comisionMonto, periodo, ahora})`.
 *      `undefined` → `no_aplicable` ("carrera"), loguea
 *      `venta-confirmacion-ignorada`. Fila → `confirmada`, y se loguean
 *      `venta-confirmada` + `comision-calculada`.
 *
 * CERO llamadas al modelo en cualquiera de las ramas (spec, "Confirmar una
 * venta no llama al modelo").
 */
export function resolverDecisionVenta(
  input: { readonly token: string; readonly decision: DecisionCliente },
  deps: ConfirmarVentaDeps,
): DecisionVentaResult {
  const { store, config, newId, now, logEvent } = deps;

  const ahora = now();
  const venta = store.buscarVentaPorToken(input.token);
  const validacion = validarTokenConfirmacion(venta, ahora);

  if (!validacion.valido) {
    logEvent(venta?.casoId ?? "desconocido", "token-invalido", { motivo: validacion.motivo });
    return { resultado: "no_aplicable", motivo: validacion.motivo };
  }

  const ventaValida = validacion.venta;

  if (input.decision === DECISION_RECHAZAR) {
    const ventaRechazada = store.rechazarVenta({ ventaId: ventaValida.id, ahora });

    if (ventaRechazada === undefined) {
      logEvent(ventaValida.casoId, "venta-confirmacion-ignorada", { ventaId: ventaValida.id });
      return { resultado: "no_aplicable", motivo: "carrera" };
    }

    logEvent(ventaValida.casoId, "venta-rechazada", { ventaId: ventaValida.id });
    return { resultado: "rechazada" };
  }

  const comisionMonto = calcularComision(ventaValida.monto, config.comisionPorcentaje);
  const periodo = periodoDeConfirmacion(ahora);
  const confirmarInput: ConfirmarVentaConComisionInput = {
    ventaId: ventaValida.id,
    comisionId: newId(),
    comisionMonto,
    periodo,
    ahora,
  };
  const aplicada = store.confirmarVentaConComision(confirmarInput);

  if (aplicada === undefined) {
    logEvent(ventaValida.casoId, "venta-confirmacion-ignorada", { ventaId: ventaValida.id });
    return { resultado: "no_aplicable", motivo: "carrera" };
  }

  logEvent(ventaValida.casoId, "venta-confirmada", { ventaId: ventaValida.id });
  logEvent(ventaValida.casoId, "comision-calculada", {
    ventaId: ventaValida.id,
    comisionMonto: aplicada.comision.monto,
    periodo: aplicada.comision.periodo,
  });

  return { resultado: "confirmada", comisionMonto: aplicada.comision.monto, periodo: aplicada.comision.periodo };
}
