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
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
  VENTA_ESTADOS,
  type Comision,
  type ConfirmacionAplicada,
  type ConsultaRiesgoCreditoPort,
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
  despacharDelegacionA2A,
  resolverDestinoA2A,
  type DelegacionA2AStorePort,
} from "./core/turn-selector/dispatch-delegation-a2a.js";
import {
  DelegacionA2ANoCompletadaError,
  DESTINO_A2A_RIESGO_CREDITO,
  type ClienteA2APort,
} from "./core/agents/a2a-contract.js";
import { type InsumoDelegado } from "./core/agents/subagents.js";
import {
  actualizarDelegacionA2A,
  aprobarEscalacionReembolso,
  aprobarReembolso,
  confirmarVentaConComision,
  createVentaConCaso,
  escalarReembolso,
  findVentaByToken,
  insertDelegacionA2A,
  listEscalacionesReembolso,
  reabrirEscalacionReembolso,
  rechazarEscalacionReembolso,
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
  /** Ausente ⇒ A2A apagado ⇒ `registrarVenta` no evalúa el umbral (ADR 82 pto 3). */
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
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
 *
 * Los CINCO métodos nuevos de `tui-canal-empleado` (ADR 41 — corrección a
 * la tabla de archivos de la propuesta, que no listaba este módulo). Dos
 * lecturas y tres CAS transaccionales:
 *  - `listarReembolsosPendientes`/`listarReembolsosRechazados` delegan a
 *    `listEscalacionesReembolso` con el `estado` fijo correspondiente. Su
 *    fila (`EscalacionReembolsoRow`) coincide campo a campo con
 *    `EscalacionListada` del contrato — mismo criterio que `ComisionRow` de
 *    arriba, sin función de traducción propia.
 *  - `aprobarEscalacionReembolso`/`rechazarEscalacionReembolso`/
 *    `reabrirEscalacionReembolso` delegan a los tres CAS transaccionales de
 *    `repository.ts` (que ya insertan la fila de auditoría DENTRO de su
 *    propia transacción — ADR 27, 40) y traducen el `VentaRow` resultante
 *    con `toPortVenta`, igual que `aprobarReembolso`/`escalarReembolso`.
 *  `buildOnVenta` y los cuatro handlers web NO cambian: siguen usando los
 *  mismos seis métodos de Hito 4.
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

    listarReembolsosPendientes(filtro) {
      return listEscalacionesReembolso(db, { estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE, ...filtro });
    },

    listarReembolsosRechazados(filtro) {
      return listEscalacionesReembolso(db, { estado: VENTA_ESTADO_REEMBOLSO_RECHAZADO, ...filtro });
    },

    aprobarEscalacionReembolso(input) {
      const row = aprobarEscalacionReembolso(db, input);
      return row ? toPortVenta(row) : undefined;
    },

    rechazarEscalacionReembolso(input) {
      const row = rechazarEscalacionReembolso(db, input);
      return row ? toPortVenta(row) : undefined;
    },

    reabrirEscalacionReembolso(input) {
      const row = reabrirEscalacionReembolso(db, input);
      return row ? toPortVenta(row) : undefined;
    },
  };
}

/**
 * `DelegacionA2AStorePort` por closures sobre `repository.ts` (Hito 6,
 * tarea 16, design.md §7.3) — mismo patrón, y mismo lugar, que
 * `createDelegacionStore` (`build-on-activity.ts:238`): dos delegaciones
 * directas sin lógica propia sobre `insertDelegacionA2A`/
 * `actualizarDelegacionA2A` (tarea 10). `crearDelegacionA2A` completa
 * `updatedAt` con el mismo valor que `createdAt` — el puerto no expone un
 * campo separado para el alta, y la fila recién insertada no tiene aún
 * ninguna actualización distinta de su creación (mismo criterio que
 * `caso`/`venta` de `crearVentaConCaso` más arriba, que también completan
 * `createdAt`/`updatedAt` con el mismo `timestamp`).
 */
export function createDelegacionA2AStore(db: Database.Database): DelegacionA2AStorePort {
  return {
    crearDelegacionA2A(input) {
      insertDelegacionA2A(db, { ...input, updatedAt: input.createdAt });
    },
    actualizarDelegacionA2A(input) {
      actualizarDelegacionA2A(db, input);
    },
  };
}

/**
 * Cierra `despacharDelegacionA2A` (núcleo) sobre `createDelegacionA2AStore`
 * y el Cliente A2A, y lo envuelve en el `try/catch` TOTAL que hace de esta
 * consulta algo INFORMATIVO (ADR 76 pto 4-5, design.md §7.3) — molde exacto
 * de `createNotificadorAdapter` (`adapters/notificaciones/index.ts:74`):
 * traduce cualquier `DelegacionA2ANoCompletadaError` o throw inesperado —
 * incluido uno SÍNCRONO (p. ej. si `crearDelegacionA2A`/
 * `actualizarDelegacionA2A` propagan por una base que no acepta la
 * escritura, ADR 80 pto 4) — a un evento y devuelve sin propagar.
 * **Nunca rechaza, nunca lanza.**
 *
 * El insumo (`instruccion` + `material`) es FIJO EN CÓDIGO — nunca del
 * modelo, nunca de un prompt libre — construido únicamente a partir de
 * `ventaId`/`clienteId`/`planAnterior?`/`planNuevo`/`monto` (design.md
 * §7.3). `clienteEmail` NUNCA entra acá: ni siquiera es un campo de
 * `ConsultaRiesgoCreditoPort.consultar` (ADR 18 pto 4, ya excluido desde
 * `registrar-venta.ts` en la tarea 15).
 */
export function createConsultaRiesgoCredito(deps: {
  readonly db: Database.Database;
  readonly cliente: ClienteA2APort;
  readonly newId?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}): ConsultaRiesgoCreditoPort {
  const { cliente, logEvent } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const store = createDelegacionA2AStore(deps.db);

  return {
    async consultar(input) {
      try {
        const insumo: InsumoDelegado = {
          instruccion:
            "Verificá el riesgo crediticio del cliente para esta venta y devolvé una evaluación breve.",
          material: [
            `ventaId: ${input.ventaId}`,
            `clienteId: ${input.clienteId}`,
            ...(input.planAnterior !== undefined ? [`planAnterior: ${input.planAnterior}`] : []),
            `planNuevo: ${input.planNuevo}`,
            `monto: ${input.monto}`,
          ].join("\n"),
        };

        await despacharDelegacionA2A(
          {
            casoId: input.casoId,
            destino: resolverDestinoA2A(DESTINO_A2A_RIESGO_CREDITO),
            insumo,
          },
          { store, cliente, newId, now, logEvent },
        );
      } catch (error) {
        const reason = error instanceof DelegacionA2ANoCompletadaError ? error.reason : "unknown";
        logEvent(input.casoId, "a2a-riesgo-credito-fallida", {
          reason,
          ...(error instanceof DelegacionA2ANoCompletadaError ? {} : { message: String(error) }),
        });
      }
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
  const { db, notifier, ventasConfig, baseUrlPublica, logDeps, riesgoCredito } = deps;
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
        ...(riesgoCredito !== undefined ? { riesgoCredito } : {}),
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
