/**
 * Wiring del camino DETERMINISTA de ventas (ADR 7 de la propuesta, punto 4,
 * ADR 12, design.md §6.3). Módulo hermano de `build-on-activity.ts` y de
 * `build-on-submit.ts`: vive en `src/`, no dentro de ningún adaptador ni de
 * `core/`, porque importa TANTO de `src/core/ventas/*` COMO de
 * `src/adapters/memory/repository.ts` (vía `createVentaStore`).
 *
 * ★ ESTE ARCHIVO NO IMPORTA `handleTurn`, NI `createKnowledgeAdapter`, NI EL
 *   SDK. NI DEBE. ★ `monto × porcentaje` y `monto < umbral` son reglas
 *   cerradas — cero llamadas al modelo en cualquiera de los cuatro caminos
 *   (spec `venta-confirmacion`, `reembolso-evaluacion`).
 *
 * A diferencia de `buildOnActivity`, este módulo NO usa `KeyedQueue`
 * (ADR 15: el CAS real vive en el `UPDATE ... WHERE estado = ... RETURNING`
 * del store) y sus handlers **SÍ propagan** los errores del store: del otro
 * lado no hay un GitHub que ya recibió su `202`, hay un cliente HTTP
 * esperando, y el adaptador web (`src/adapters/web/server.ts`) traduce la
 * excepción a un `500` (§4.4). Tragar el error acá devolvería un `201`
 * sobre una venta que no existe.
 *
 * Los tres handlers que envuelven casos de uso SÍNCRONOS
 * (`onConsultaVenta`/`onDecisionVenta`/`onDevolucion`) NO se marcan `async`
 * ni usan `await` — pasan por `toPromise` (abajo), que ejecuta el cuerpo
 * síncrono INMEDIATAMENTE al llamar (nunca cede al event loop) y solo
 * traduce el resultado (o la excepción) al canal de una `Promise` ya
 * resuelta o ya rechazada, para uniformar la firma de los cuatro handlers
 * de `WebServerDeps`. Esa ejecución inmediata es lo que el test de
 * concurrencia necesita: dos llamadas seguidas SIN `await` entre medio
 * ejecutan ambos `UPDATE ... RETURNING` del CAS ANTES de que el event loop
 * ceda el control a ningún otro código. El `try/catch` de `toPromise` no
 * traga nada — es la única forma de que un error SÍNCRONO del store llegue
 * al caller como una `Promise` rechazada (que es lo que `await
 * handlers.onX(...)` necesita para propagar) en vez de como una excepción
 * síncrona lanzada al invocar el handler.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  VENTA_ESTADOS,
  type Comision,
  type ConfirmacionAplicada,
  type Venta,
  type VentaEstado,
  type VentaNotifierPort,
  type VentaPublica,
  type VentaStorePort,
} from "./core/ventas/ventas-contract.js";
import {
  registrarVenta,
  type RegistrarVentaInput,
  type RegistrarVentaResult,
} from "./core/ventas/registrar-venta.js";
import { resolverDecisionVenta, type DecisionCliente, type DecisionVentaResult } from "./core/ventas/confirmar-venta.js";
import { procesarDevolucion, type DevolucionResult } from "./core/ventas/procesar-devolucion.js";
import { validarTokenConfirmacion } from "./core/ventas/token-confirmacion.js";
import { type VentasConfig } from "./core/ventas/ventas-config.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import {
  aprobarReembolso,
  confirmarVentaConComision,
  createVentaConCaso,
  escalarReembolso,
  findVentaByToken,
  rechazarVenta,
  type VentaRow,
} from "./adapters/memory/repository.js";

export interface BuildOnVentaDeps {
  readonly db: Database.Database;
  readonly notifier: VentaNotifierPort;
  readonly ventasConfig: VentasConfig;
  readonly baseUrlPublica: string;
  readonly newId?: () => string; // default: randomUUID
  readonly newToken?: () => string; // default: randomUUID (ADR 10 punto 1)
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps; // omitir en producción (default: archivo)
  /** Inyectable solo para el test; default: `createVentaStore(db)`. */
  readonly store?: VentaStorePort;
}

export interface VentaHandlers {
  readonly onAltaVenta: (input: RegistrarVentaInput) => Promise<RegistrarVentaResult>;
  readonly onConsultaVenta: (token: string) => Promise<VentaPublica | undefined>;
  readonly onDecisionVenta: (input: {
    readonly token: string;
    readonly decision: DecisionCliente;
  }) => Promise<DecisionVentaResult>;
  readonly onDevolucion: (input: {
    readonly token: string;
    readonly motivo?: string;
  }) => Promise<DevolucionResult>;
}

/**
 * Lanzado por `toPortVenta` cuando una fila de `ventas` trae un `estado` que
 * no pertenece a `VENTA_ESTADOS`. `repository.ts` deja esa columna como TEXT
 * sin `CHECK` a propósito (migración 0004: "el conjunto de estados válidos
 * es asunto del núcleo, no de un enum de columna") — molde exacto de
 * `ActividadTipoEstadoInvalidoError` en `build-on-activity.ts`, con un solo
 * campo a validar (`estado`) en vez de `tipo`+`estado`.
 */
export class VentaEstadoInvalidoError extends Error {
  constructor(ventaId: string, estado: string) {
    super(`Venta ${ventaId} tiene estado inválido en la base: ${estado}`);
    this.name = "VentaEstadoInvalidoError";
  }
}

/**
 * Traduce una fila `VentaRow` de `repository.ts` (`estado` como `string`
 * suelto) a la `Venta` del puerto (`estado: VentaEstado`, unión literal).
 * Valida contra `VENTA_ESTADOS` en vez de castear a ciegas — molde exacto de
 * `toPortActividad`.
 */
function toPortVenta(row: VentaRow): Venta {
  const estadoValido = (VENTA_ESTADOS as readonly string[]).includes(row.estado);
  if (!estadoValido) {
    throw new VentaEstadoInvalidoError(row.id, row.estado);
  }
  return {
    ...row,
    estado: row.estado as VentaEstado,
  };
}

/**
 * `VentaStorePort` por closures sobre `repository.ts` — mismo patrón, y
 * mismo lugar, que `createActivityStore` (`build-on-activity.ts`). Seis
 * delegaciones directas sobre las funciones ya existentes (tareas 22-24):
 * `createVentaConCaso`, `findVentaByToken`, `confirmarVentaConComision`,
 * `rechazarVenta`, `aprobarReembolso`, `escalarReembolso`. Cada resultado
 * que sea `VentaRow`/`{venta, comision}` pasa por `toPortVenta`; `comision`
 * de `confirmarVentaConComision` ya es camelCase plano (`ComisionRow` de
 * `repository.ts` coincide campo a campo con `Comision` del contrato) y no
 * necesita traducción.
 */
export function createVentaStore(db: Database.Database): VentaStorePort {
  return {
    crearVentaConCaso(input) {
      const row = createVentaConCaso(db, {
        vendedor: input.vendedor,
        caso: {
          id: input.caso.id,
          tipo: input.caso.tipo,
          estado: input.caso.estado,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
        },
        venta: {
          id: input.venta.id,
          clienteId: input.venta.clienteId,
          ...(input.venta.planAnterior !== undefined ? { planAnterior: input.venta.planAnterior } : {}),
          planNuevo: input.venta.planNuevo,
          monto: input.venta.monto,
          estado: input.venta.estado,
          tokenConfirmacion: input.venta.tokenConfirmacion,
          ...(input.venta.expiresAt !== undefined ? { expiresAt: input.venta.expiresAt } : {}),
        },
        timestamp: input.timestamp,
      });
      return toPortVenta(row);
    },

    buscarVentaPorToken(token) {
      const row = findVentaByToken(db, token);
      return row ? toPortVenta(row) : undefined;
    },

    confirmarVentaConComision(input): ConfirmacionAplicada | undefined {
      const aplicada = confirmarVentaConComision(db, input);
      if (aplicada === undefined) {
        return undefined;
      }
      const comision: Comision = aplicada.comision;
      return { venta: toPortVenta(aplicada.venta), comision };
    },

    rechazarVenta(input) {
      const row = rechazarVenta(db, input);
      return row ? toPortVenta(row) : undefined;
    },

    aprobarReembolso(input) {
      const row = aprobarReembolso(db, input);
      return row ? toPortVenta(row) : undefined;
    },

    escalarReembolso(input) {
      const row = escalarReembolso(db, input);
      return row ? toPortVenta(row) : undefined;
    },
  };
}

/**
 * Ejecuta `run` INMEDIATAMENTE (nunca cede al event loop antes de terminar)
 * y traduce su resultado — o la excepción que lance — al canal de una
 * `Promise` ya resuelta o ya rechazada. Ver el module doc de arriba para por
 * qué esto no es lo mismo que `Promise.resolve(run())` a secas: sin el
 * `try/catch`, una excepción síncrona de `run` se propagaría como una
 * excepción síncrona al invocar el handler, no como un rechazo de la
 * `Promise` que su firma promete.
 */
function toPromise<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Los cuatro handlers del ADR 12, ya cerrados sobre sus dependencias
 * (composition root). `onAltaVenta` es genuinamente `async` — envuelve
 * `registrarVenta`, cuyo único `await` es la notificación best-effort tras
 * cerrar la transacción del alta. Los otros tres envuelven casos de uso
 * síncronos vía `toPromise` (ver arriba).
 *
 * `onConsultaVenta` (el `GET` de la página) aplica `validarTokenConfirmacion`
 * ANTES de proyectar a `VentaPublica`: una venta vencida o ya procesada
 * devuelve `undefined`, igual que un token inexistente — el `GET` no puede
 * ser un oráculo que el `POST` no es (R6).
 */
export function buildOnVenta(deps: BuildOnVentaDeps): VentaHandlers {
  const { db, notifier, ventasConfig, baseUrlPublica, logDeps } = deps;
  const newId = deps.newId ?? randomUUID;
  const newToken = deps.newToken ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const store = deps.store ?? createVentaStore(db);
  const logEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) =>
    logTurnEvent(casoId, event, fields, logDeps);

  return {
    onAltaVenta: (input) =>
      registrarVenta(input, {
        store,
        notifier,
        config: ventasConfig,
        baseUrlPublica,
        newId,
        newToken,
        now,
        logEvent,
      }),

    onConsultaVenta: (token) =>
      toPromise((): VentaPublica | undefined => {
        const venta = store.buscarVentaPorToken(token);
        const ahora = now();
        const validacion = validarTokenConfirmacion(venta, ahora);
        if (!validacion.valido) {
          return undefined;
        }
        const v = validacion.venta;
        return {
          ...(v.planAnterior !== undefined ? { planAnterior: v.planAnterior } : {}),
          planNuevo: v.planNuevo,
          monto: v.monto,
        };
      }),

    onDecisionVenta: (input) =>
      toPromise(() =>
        resolverDecisionVenta(input, { store, config: ventasConfig, newId, now, logEvent }),
      ),

    onDevolucion: (input) =>
      toPromise(() => procesarDevolucion(input, { store, config: ventasConfig, now, logEvent })),
  };
}
