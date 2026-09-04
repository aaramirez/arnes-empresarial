/**
 * Contrato de ventas (Hito 4, tarea 1).
 *
 * Lo único que el Núcleo sabe sobre ventas, comisiones y notificaciones: las
 * constantes canónicas de `ventas.estado`, el vocabulario de `casos` que este
 * hito agrega, las entidades tal como el núcleo las maneja y los dos puertos
 * — `VentaStorePort` (persistencia) y `VentaNotifierPort` (aviso al
 * cliente) — que los casos de uso (`registrar-venta.ts`, `confirmar-venta.ts`,
 * `procesar-devolucion.ts`) usan. La implementación real vive del otro lado
 * de estos puertos e importa de este módulo, nunca al revés: la regla no
 * negociable de `AGENTS.md` es que `src/core/` no importa de
 * `src/adapters/*`, ni del SDK, ni de Node. Este archivo no importa nada —
 * mismo criterio que `src/core/knowledge/knowledge-contract.ts` (Hito 2,
 * tarea 1) y `src/core/activity/activity-contract.ts` (Hito 3, tarea 1).
 */

/* ── Estados canónicos de `ventas.estado` ── */
// SQLite guarda `estado` como TEXT abierto SIN CHECK (migración 0004), mismo
// criterio que `repository.ts:5-6` documenta para `casos.estado` y que 0003
// repitió para `actividades`: el conjunto de valores válidos es asunto del
// núcleo. ESTA es la lista canónica; el SQL no la conoce.

export const VENTA_ESTADO_PENDIENTE_CONFIRMACION = "pendiente_confirmacion";
export const VENTA_ESTADO_CONFIRMADA = "confirmada";
export const VENTA_ESTADO_RECHAZADA = "rechazada";
export const VENTA_ESTADO_REEMBOLSADA = "reembolsada";
/** Quinto valor, ADR 11 de la propuesta: escalación humana detectada y persistida, sin transición automática. */
export const VENTA_ESTADO_REEMBOLSO_PENDIENTE = "reembolso_pendiente";

export const VENTA_ESTADOS = [
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_RECHAZADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
] as const;
export type VentaEstado = (typeof VENTA_ESTADOS)[number];

/* ── Vocabulario de `casos` que este hito agrega ── */
// `casos.tipo` ya tiene "conversacion" (main.ts:154) y los tipos de actividad
// de Hito 3. Estos dos son los que agrega Ventas.
export const CASO_TIPO_VENTA = "venta";
export const CASO_TIPO_SOPORTE = "soporte";
/**
 * Estado al que transiciona el `caso` de una venta cuando el reembolso se
 * escala (ADR 11, punto 2). Vive acá y no en `handle-turn.ts` (donde vive
 * `CASO_ESTADO_ACTIVO`) porque hoy tiene UN dueño semántico: ventas. Cuando
 * Hito 5 generalice el HITL, se muda — con más de un dueño, deja de ser
 * vocabulario de ventas.
 */
export const CASO_ESTADO_PENDIENTE_APROBACION_HUMANA = "pendiente_aprobacion_humana";

/* ── Entidades tal como el núcleo las maneja ── */

export interface Venta {
  readonly id: string;
  readonly vendedorId: string;
  /** OPACO. Llega en el payload de alta y se guarda tal cual: sin tabla, sin FK, sin resolución de identidad (R9, fuera de alcance). */
  readonly clienteId: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly estado: VentaEstado;
  readonly casoId: string;
  readonly tokenConfirmacion: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  /** ISO-8601 UTC, o ausente = sin vencimiento (ADR 10 de la propuesta, ADR 17 de este diseño). */
  readonly expiresAt?: string;
}

export interface Comision {
  readonly id: string;
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly monto: number;
  /** `'YYYY-MM'`, derivado de `confirmed_at` — NUNCA de `created_at` (ADR 16). */
  readonly periodo: string;
  readonly createdAt: string;
}

/** Proyección segura de una venta para la página pública: SIN token, SIN caso_id, SIN cliente_id. */
export interface VentaPublica {
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
}

/* ── Puertos ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root
 * (`build-on-venta.ts`).
 *
 * SÍNCRONO a propósito, igual que `ActivityStorePort` y `MemoryPort`:
 * `better-sqlite3` lo es, y la sincronía hace VISIBLE, sin leer una línea de
 * implementación, que el único `await` de todo el camino determinista es la
 * notificación best-effort — que ocurre DESPUÉS de que la transacción cerró.
 * Esa es, literalmente, la razón por la que este hito no necesita
 * `createKeyedQueue()` (ADR 15).
 *
 * CONTRATO: falla RUIDOSAMENTE. Si el estado canónico no se persiste, no hay
 * venta — el error propaga hasta el borde HTTP, que responde 500.
 */
export interface VentaStorePort {
  /** Upsert de `vendedores` + `createCaso` + `INSERT ventas`, en UNA transacción. */
  crearVentaConCaso(input: CrearVentaConCasoInput): Venta;

  /** Lectura por token. `undefined` si no existe. Indexada por el `UNIQUE` de la columna (§6.1). */
  buscarVentaPorToken(token: string): Venta | undefined;

  /**
   * COMPARE-AND-SWAP + comisión, en UNA transacción (ADR 15).
   * Devuelve `undefined` si el `UPDATE` no matcheó ninguna fila — o sea si
   * la venta ya no estaba `pendiente_confirmacion`, o si venció entre la
   * validación y la escritura. En ese caso NO se inserta comisión.
   */
  confirmarVentaConComision(input: ConfirmarVentaConComisionInput): ConfirmacionAplicada | undefined;

  /** CAS a `rechazada` desde `pendiente_confirmacion`. `undefined` = no aplicó. Nunca crea comisión. */
  rechazarVenta(input: { readonly ventaId: string; readonly ahora: string }): Venta | undefined;

  /** CAS a `reembolsada` desde `confirmada`. `undefined` = no aplicó. NO toca `comisiones` (spec, fuera de alcance). */
  aprobarReembolso(input: { readonly ventaId: string; readonly ahora: string }): Venta | undefined;

  /**
   * CAS a `reembolso_pendiente` desde `confirmada` Y, en la MISMA transacción,
   * `caso.estado = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` vía el `casoId`
   * que la venta ya tiene (ADR 11, punto 2). `undefined` = no aplicó, y
   * entonces el `caso` tampoco se toca. NO toca `comisiones`.
   */
  escalarReembolso(input: {
    readonly ventaId: string;
    readonly casoId: string;
    readonly ahora: string;
  }): Venta | undefined;
}

export interface CrearVentaConCasoInput {
  readonly vendedor: { readonly id: string; readonly nombre: string };
  readonly caso: { readonly id: string; readonly tipo: string; readonly estado: string };
  readonly venta: {
    readonly id: string;
    readonly clienteId: string;
    readonly planAnterior?: string;
    readonly planNuevo: string;
    readonly monto: number;
    readonly estado: VentaEstado;
    readonly tokenConfirmacion: string;
    readonly expiresAt?: string;
  };
  /** Un único timestamp para `created_at`/`updated_at` de las tres filas. */
  readonly timestamp: string;
}

export interface ConfirmarVentaConComisionInput {
  readonly ventaId: string;
  readonly comisionId: string;
  readonly comisionMonto: number;
  readonly periodo: string;
  /** Se usa como `confirmed_at`, como `created_at` de la comisión Y como el `@ahora` del predicado de expiración. Uno solo, a propósito (ADR 15). */
  readonly ahora: string;
}

export interface ConfirmacionAplicada {
  readonly venta: Venta;
  readonly comision: Comision;
}

/**
 * Salida hacia una persona. Implementado por `src/adapters/notificaciones/`,
 * inyectado desde el composition root.
 *
 * CONTRATO: **nunca rechaza y nunca lanza** — mismo contrato que
 * `ActivityBoardPort` (Hito 3) y `KnowledgeFeedbackPort` (Hito 2). Cualquier
 * falla (red, HTTP ≠ 2xx, timeout, sin API key) se traga adentro del
 * adaptador y sale como `{ enviado: false, motivo }`. La venta ya está
 * persistida; el aviso es best-effort (spec `venta-confirmacion`).
 *
 * UNA sola operación, no un `enviarEmail` genérico (ADR 18): el núcleo pide
 * "avisale al cliente que confirme esta venta" y no aprende que existe el
 * email como medio.
 */
export interface VentaNotifierPort {
  notificarLinkConfirmacion(input: {
    /** Destino. NO se persiste en ningún lado (ADR 18, punto 4). */
    readonly clienteEmail: string;
    readonly linkConfirmacion: string;
    readonly planNuevo: string;
    readonly monto: number;
    /** Correlación de logs, no dato de negocio — mismo criterio que el `casoId` de `ActivityBoardPort`. */
    readonly casoId: string;
  }): Promise<NotificacionResultado>;
}

export type NotificacionMotivo = "sin-api-key" | "sin-destinatario" | "http" | "network" | "timeout" | "unknown";

export type NotificacionResultado =
  | { readonly enviado: true }
  | { readonly enviado: false; readonly motivo: NotificacionMotivo };
