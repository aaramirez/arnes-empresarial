/**
 * Vocabulario HITL compartido (Hito 5, tarea 1, ADR 42, design.md §5.1).
 *
 * Hasta este hito, `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y
 * `CASO_ESTADO_RESUELTO` vivían solo en `src/core/ventas/ventas-contract.ts`
 * con un único dueño semántico (ventas). Con `solicitud-interna-hitl` como
 * segundo dueño, se mudan acá; `ventas-contract.ts` pasa a re-exportarlas sin
 * redeclarar sus valores. Este módulo también declara la forma genérica del
 * desenlace de una resolución HITL (`ResolucionHitlResult`, ADR 50) —
 * parametrizada por el tipo del ítem, con campos neutros (no de dominio),
 * molde de `ResolverEscalacionResult` (`resolver-escalacion-reembolso.ts`)
 * pero sin retrofitearse sobre él.
 *
 * La implementación real de cada dueño (ventas, solicitud interna) importa
 * de este módulo, nunca al revés: la regla no negociable de `AGENTS.md` es
 * que `src/core/` no importa de `src/adapters/*`, ni del SDK, ni de Node.
 * Este archivo no importa nada — mismo criterio que
 * `src/core/knowledge/knowledge-contract.ts` (Hito 2, tarea 1) y
 * `src/core/activity/activity-contract.ts` (Hito 3, tarea 1).
 */

/* ── Estados canónicos de `caso` compartidos por todo flujo HITL ── */

export const CASO_ESTADO_PENDIENTE_APROBACION_HUMANA = "pendiente_aprobacion_humana";
export const CASO_ESTADO_RESUELTO = "resuelto";

/* ── Motivo por el cual una resolución HITL no aplica ── */

export const MOTIVO_NO_ENCONTRADA = "no_encontrada";
export const MOTIVO_CAS = "cas";
export type MotivoNoAplicableHitl = typeof MOTIVO_NO_ENCONTRADA | typeof MOTIVO_CAS;

/**
 * Molde genérico del desenlace de una resolución HITL (ADR 50). Campos
 * NEUTROS (`items`/`item`/`itemId`), no de dominio (`venta`/`ventaId`):
 * `ResolverEscalacionResult` (ventas) NO se toca ni se redefine como alias de
 * este tipo — quedan estructuralmente idénticos y duplicados a propósito
 * (ADR 50, punto 4).
 */
export type ResolucionHitlResult<TItem, TAccion extends string, TEstadoFinal extends string> =
  | { readonly resultado: "listado"; readonly accion: TAccion; readonly items: readonly TItem[] }
  | { readonly resultado: "requiere_confirmacion"; readonly accion: TAccion; readonly item: TItem }
  | {
      readonly resultado: "aplicada";
      readonly accion: TAccion;
      readonly item: TItem;
      readonly estadoFinal: TEstadoFinal;
    }
  | {
      readonly resultado: "no_aplicable";
      readonly accion: TAccion;
      readonly motivo: MotivoNoAplicableHitl;
      readonly itemId?: string;
      readonly casoId?: string;
    };
