/**
 * Caso de uso: alta de una venta (Hito 4, tarea 6, §3.4). Orquestador
 * asíncrono — análogo exacto de `run-activity-turn.ts` (Hito 3): recibe
 * puertos por `deps`, no importa adaptadores, propaga lo que el `store`
 * propague y NUNCA propaga lo que el `notifier` haga (contrato de
 * `VentaNotifierPort`: nunca rechaza, nunca lanza).
 *
 * Secuencia exacta (design.md §3.4):
 *  1. `timestamp = now()`, `token = newToken()`, `expiresAt =
 *     calcularExpiresAt(timestamp, config.tokenTtlHoras)`.
 *  2. `store.crearVentaConCaso({...})` — UNA transacción: upsert de
 *     `vendedores`, `caso` tipo `CASO_TIPO_VENTA` en estado activo, y la fila
 *     de `ventas` en `pendiente_confirmacion`. PROPAGA si falla: sin venta no
 *     hay nada que notificar. → `venta-creada`.
 *  3. `link = `${baseUrlPublica}/confirmar/${token}``.
 *  4. `await notifier.notificarLinkConfirmacion({...})` — NUNCA rechaza por
 *     contrato. → `email-enviado` | `email-omitido` (sin API key) |
 *     `email-fallido` (red/HTTP/timeout).
 *  5. Devuelve el resultado con `notificado = resultado.enviado`.
 *
 * CERO llamadas al modelo, cero `handleTurn`, cero SDK (spec
 * `venta-confirmacion`, escenario "Alta válida crea vendedor, caso y venta").
 *
 * El paso 4 va DESPUÉS de que la transacción cerró, a propósito: es el único
 * `await` de todo el camino determinista y no debe estar dentro de ninguna
 * ventana transaccional — es también la razón literal por la que este hito
 * no necesita `createKeyedQueue()` (ADR 15).
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/ventas/`
 * (mismo dominio) — regla no negociable de `AGENTS.md`: `src/core/` nunca
 * importa de `src/adapters/*`, ni del SDK, ni de Node.
 */
import {
  CASO_TIPO_VENTA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  type VentaNotifierPort,
  type VentaStorePort,
} from "./ventas-contract.js";
import { calcularExpiresAt } from "./token-confirmacion.js";
import { type VentasConfig } from "./ventas-config.js";

/**
 * Valor idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`. Duplicado a
 * propósito, no un descuido: este módulo no importa `handle-turn.ts` (regla
 * no negociable de `AGENTS.md`, mismo criterio que `run-activity-turn.ts`
 * documenta para su propia copia), y `casos.estado` es un TEXT abierto en el
 * esquema.
 */
const CASO_ESTADO_ACTIVO = "activo";

export interface RegistrarVentaDeps {
  readonly store: VentaStorePort;
  readonly notifier: VentaNotifierPort;
  readonly config: VentasConfig;
  /** `WEB_PUBLIC_URL` ya normalizada por el adaptador (sin `/` final). El núcleo la concatena, no la resuelve. */
  readonly baseUrlPublica: string;
  readonly newId: () => string;
  /** Token opaco de alta entropía: `randomUUID()` en producción (`node:crypto`, cero dependencias). Inyectado para que el test sea determinista. */
  readonly newToken: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface RegistrarVentaInput {
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  /** Solo para notificar. NO se persiste (ADR 18, punto 4). */
  readonly clienteEmail: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
}

export interface RegistrarVentaResult {
  readonly ventaId: string;
  readonly casoId: string;
  readonly linkConfirmacion: string;
  readonly notificado: boolean;
}

export async function registrarVenta(
  input: RegistrarVentaInput,
  deps: RegistrarVentaDeps,
): Promise<RegistrarVentaResult> {
  const { store, notifier, config, baseUrlPublica, newId, newToken, now, logEvent } = deps;

  const timestamp = now();
  const token = newToken();
  const expiresAt = calcularExpiresAt(timestamp, config.tokenTtlHoras);
  const casoId = newId();
  const ventaId = newId();

  // Paso 2: PROPAGA si falla — sin venta no hay nada que notificar. Nada se
  // llama después de esto si `crearVentaConCaso` lanza.
  const venta = store.crearVentaConCaso({
    vendedor: { id: input.vendedorId, nombre: input.vendedorNombre },
    caso: { id: casoId, tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_ACTIVO },
    venta: {
      id: ventaId,
      clienteId: input.clienteId,
      ...(input.planAnterior !== undefined ? { planAnterior: input.planAnterior } : {}),
      planNuevo: input.planNuevo,
      monto: input.monto,
      estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      tokenConfirmacion: token,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    },
    timestamp,
  });

  logEvent(venta.casoId, "venta-creada", {
    ventaId: venta.id,
    vendedorId: venta.vendedorId,
  });

  const linkConfirmacion = `${baseUrlPublica}/confirmar/${token}`;

  // Paso 4: el ÚNICO `await` del camino determinista, DESPUÉS de que la
  // transacción del paso 2 ya cerró — nunca en paralelo, nunca antes.
  // `notificarLinkConfirmacion` nunca rechaza por contrato de
  // `VentaNotifierPort`; no hay `try/catch` acá porque no hace falta uno.
  const resultado = await notifier.notificarLinkConfirmacion({
    clienteEmail: input.clienteEmail,
    linkConfirmacion,
    planNuevo: input.planNuevo,
    monto: input.monto,
    casoId: venta.casoId,
  });

  logEvent(
    venta.casoId,
    resultado.enviado
      ? "email-enviado"
      : resultado.motivo === "sin-api-key"
        ? "email-omitido"
        : "email-fallido",
    { ventaId: venta.id, ...(resultado.enviado ? {} : { motivo: resultado.motivo }) },
  );

  return {
    ventaId: venta.id,
    casoId: venta.casoId,
    linkConfirmacion,
    notificado: resultado.enviado,
  };
}
