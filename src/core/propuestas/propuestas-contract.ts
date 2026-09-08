/**
 * Contrato de propuesta de cambio (Hito 5.1, tarea 17, ADR 42, ADR 58, design.md §5.4).
 *
 * Lo único que el Núcleo sabe sobre una propuesta de cambio capturada del
 * worktree aislado del Developer (capability `escritura-aislada-worktree`):
 * el vocabulario canónico de `propuestas_cambio.estado`, la entidad tal como
 * el núcleo la maneja, y el puerto `PropuestaStorePort` que los casos de uso
 * (`crear-propuesta-cambio.ts`, `resolver-propuesta-cambio.ts`) usan. La
 * implementación real vive del otro lado de este puerto
 * (`src/adapters/memory/repository.ts`) e importa de este módulo, nunca al
 * revés: la regla no negociable de `AGENTS.md` es que `src/core/` no importa
 * de `src/adapters/*`, ni del SDK, ni de Node.
 *
 * Este archivo importa **únicamente** de `../hitl/hitl-contract.js` — un
 * cruce núcleo → núcleo limitado y justificado, mismo criterio que
 * `solicitudes-contract.ts`: propuesta de cambio es OTRO dueño semántico de
 * `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` (ADR 42), así que
 * `PROPUESTA_ESTADO_PENDIENTE` se IMPORTA desde `hitl-contract.ts` en vez de
 * redeclarar el literal — una sola fuente de verdad para el mismo valor.
 */
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";

/* ── Vocabulario canónico de `propuestas_cambio.estado` ── */

/**
 * TRES estados, no cuatro (decisión del checkpoint humano sobre RD-12). Un
 * conflicto de `git apply --check` deja la fila INTACTA en `pendiente` y un
 * patch fuera de tope NO crea fila, así que un cuarto valor `no_aplicable`
 * sería vocabulario que promete una transición que ningún camino ejecuta.
 *
 * OJO — NO confundir con el tag `"no_aplicable"` de `ResolucionHitlResult`
 * (`hitl-contract.ts`, ADR 50 de v2.0.0), que SÍ se usa en `resolver-propuesta-cambio.ts`
 * (tarea 20) y NO se toca acá: ese describe el desenlace de una INVOCACIÓN
 * del resolvedor (`no_encontrada` / `cas`), no un estado persistido. Mismo
 * nombre, planos distintos.
 */
export const PROPUESTA_ESTADO_PENDIENTE = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA;
export const PROPUESTA_ESTADO_APLICADA = "aplicada";
export const PROPUESTA_ESTADO_DESCARTADA = "descartada";
export type PropuestaEstado =
  | typeof PROPUESTA_ESTADO_PENDIENTE
  | typeof PROPUESTA_ESTADO_APLICADA
  | typeof PROPUESTA_ESTADO_DESCARTADA;

/**
 * 64 KB. Tope de RECHAZO, no de truncado (ADR 58 pto 3). NO configurable por
 * env, a propósito: es un invariante de la evidencia, no un parámetro
 * operativo — mismo criterio literal que `SAVE_RESULT_TIMEOUT_MS` y
 * `TAREA_DELEGADA_MAX_CHARS`.
 */
export const PATCH_MAX_BYTES = 65_536;

/** Tope del listado sin argumento, espejo de `LIMITE_LISTADO_ESCALACIONES` (`ventas-contract.ts`). */
export const LIMITE_LISTADO_PROPUESTAS = 20;

/** Líneas de patch por página de `/ver-propuesta <id>`. */
export const LINEAS_PAGINA_PATCH = 80;

/* ── Entidad tal como el núcleo la maneja ── */

export interface PropuestaCambio {
  readonly id: string;
  readonly casoId: string;
  /** nullable — ADR 48: la evidencia no se pierde por una constraint. */
  readonly delegacionId?: string;
  readonly baseCommit: string;
  readonly ramaWorktree: string;
  readonly patch: string;
  readonly patchBytes: number;
  readonly archivos: number;
  readonly lineasAgregadas: number;
  readonly lineasEliminadas: number;
  readonly estado: PropuestaEstado;
  /** Solo escrito por `/descartar-propuesta`. */
  readonly motivo?: string;
  readonly resueltaPor?: string;
  readonly resueltaAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrearPropuestaInput {
  readonly id: string;
  readonly casoId: string;
  readonly delegacionId?: string;
  readonly baseCommit: string;
  readonly ramaWorktree: string;
  readonly patch: string;
  readonly resumen: ResumenPatch;
  readonly createdAt: string;
}

export interface ResolucionPropuestaInput {
  readonly propuestaId: string;
  readonly casoId: string;
  /** SIEMPRE de una sesión vigente (ADR 37, mismo criterio que `ResolucionSolicitudInput`). */
  readonly empleadoId: string;
  /** `id` de la fila de registro, generado por el núcleo (ADR 39). */
  readonly accionId: string;
  /** `updated_at` del caso Y `resuelta_at` de la propuesta. UNO solo, a propósito. */
  readonly ahora: string;
  readonly motivo?: string;
}

/** Forma del resumen de un patch — molde de `resumir-patch.ts` (tarea 18), no importado (ADR 58 pto 2: este archivo importa únicamente de `hitl-contract.js`). */
export interface ResumenPatch {
  readonly patchBytes: number;
  readonly archivos: number;
  readonly lineasAgregadas: number;
  readonly lineasEliminadas: number;
}

/* ── Puerto ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root.
 *
 * SÍNCRONO a propósito, igual que `VentaStorePort`/`SolicitudStorePort`:
 * `better-sqlite3` lo es. CONTRATO: falla RUIDOSAMENTE. Si el estado
 * canónico no se persiste, no hay propuesta — el error propaga.
 */
export interface PropuestaStorePort {
  crearPropuesta(input: CrearPropuestaInput): PropuestaCambio;

  /** `undefined` = no existe la propuesta. */
  obtenerPropuesta(propuestaId: string): PropuestaCambio | undefined;

  /** `estado = PROPUESTA_ESTADO_PENDIENTE`, filtrable por id. Default `LIMITE_LISTADO_PROPUESTAS`. */
  listarPropuestasPendientes(filtro?: {
    readonly propuestaId?: string;
    readonly limite?: number;
  }): readonly PropuestaCambio[];

  /**
   * COMPARE-AND-SWAP + `updateCaso(sólo updatedAt, ADR 65)` + fila de
   * registro, en UNA transacción. `undefined` = el CAS no matcheó (la
   * propuesta ya no estaba `PROPUESTA_ESTADO_PENDIENTE`) — en ese caso NADA
   * se escribe.
   */
  aplicarPropuesta(input: ResolucionPropuestaInput): PropuestaCambio | undefined;

  /** Idéntico a `aplicarPropuesta`, transiciona a `PROPUESTA_ESTADO_DESCARTADA` y persiste `motivo`. */
  descartarPropuesta(input: ResolucionPropuestaInput): PropuestaCambio | undefined;
}
