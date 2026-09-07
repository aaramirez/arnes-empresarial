/**
 * Dispatcher de comandos de empleado en la TUI (`tui-canal-empleado`, ADR
 * 21, 34, 36, 37, 40, 55; design.md §6). Hermano de `build-on-submit.ts` /
 * `build-on-venta.ts` / `build-on-soporte.ts`: vive en `src/`, no dentro de
 * ningún adaptador ni de `core/`, porque importa TANTO de `src/core/*`
 * (`parsearComando`, `resolverLogin`, `resolverEscalacionReembolso`,
 * `procesarDevolucion`, `crearSolicitudInterna`) COMO de
 * `src/adapters/memory/repository.ts` (`buscarCredencialEmpleado`,
 * `insertAccionEmpleado`, las cinco funciones de `solicitudes_internas`) y
 * de `src/build-on-venta.ts` (`createVentaStore`, ADR 41) / de
 * `src/build-on-activity.ts` (`createDelegacionStore`, mismo store que usa
 * el Despachador de roles del Entregable A — reusado tal cual, ADR 55).
 *
 * `buildOnComandoEmpleado` ENVUELVE el `onSubmit` que `buildOnSubmit` ya
 * devuelve y el `onSoporte` que `buildOnSoporte` ya devuelve — ninguno de
 * los dos se toca. Devuelve el MISMO tipo `SubmitPromptHandler`: `main.ts`
 * lo monta en `startTui` en el lugar donde hoy monta `onSubmit` (§8).
 *
 * Estado del closure — EXACTAMENTE dos ranuras privadas (ADR 31, 36):
 * `sesion` y `confirmacionPendiente`. Ninguna se persiste (ADR 31 punto 4):
 * mueren con el proceso. El preámbulo (§6.3) corre en este orden fijo para
 * TODO texto que entra, sin excepciones: purga de sesión vencida → purga de
 * confirmación vencida (silenciosa) → `parsearComando` → delegación si no
 * matchea `/` → log de recepción → guarda de privilegio → ruteo.
 *
 * `onAgentResolved` NO se invoca para ninguno de los comandos (ADR 21
 * punto 5): no hay agente que anunciar. Solo se reenvía, intacto, en el
 * camino de delegación a `onSubmit`.
 *
 * **Hito 5, tarea 22 (ADR 55)**: `ConfirmacionPendiente` se ENSANCHA a una
 * unión discriminada por `dominio` (`"reembolso"` | `"solicitud"`) — sigue
 * habiendo UNA sola ranura, ver el tipo más abajo. `/solicitar` (§4.2 del
 * diseño) es de UN SOLO PASO — sesión vigente exigida, sin eco ni
 * confirmación — así que NUNCA construye ni compara contra
 * `confirmacionPendiente`; el rama `dominio: "solicitud"` de la unión
 * existe para que el tipo compile hoy, pero el ÚNICO escritor de esa rama
 * es `/aprobar-solicitud`/`/rechazar-solicitud` (tarea 23, todavía sin
 * implementar). Ver la nota de alcance declarada en `tasks.md` tarea 22
 * para el detalle completo de esta decisión.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  COMANDOS,
  COMANDO_LOG_CORRELATION_ID,
  esComandoPrivilegiado,
  formatearAyuda,
  parsearComando,
  type ComandoEmpleado,
} from "./core/commands/comando-empleado.js";
import {
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_DEVOLUCION,
  COMANDO_LOGIN,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_SOLICITAR,
  COMANDO_SOPORTE,
  RESULTADO_ATENDIDA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_EXITOSA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_REEMBOLSADA,
  type AccionEmpleado,
  type RegistroAccionesEmpleadoPort,
} from "./core/commands/registro-acciones-contract.js";
import { type AuthConfig } from "./core/auth/auth-config.js";
import { type CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import { resolverLogin } from "./core/auth/login.js";
import { sesionVigente, type SesionEmpleado } from "./core/auth/sesion.js";
import {
  ACCION_APROBAR,
  ACCION_REABRIR,
  ACCION_RECHAZAR,
  resolverEscalacionReembolso,
  type AccionEscalacion,
} from "./core/ventas/resolver-escalacion-reembolso.js";
import { procesarDevolucion, type DevolucionResult } from "./core/ventas/procesar-devolucion.js";
import {
  CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
  CASO_ESTADO_RESUELTO,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
  type EscalacionListada,
  type VentaStorePort,
} from "./core/ventas/ventas-contract.js";
import { type VentasConfig } from "./core/ventas/ventas-config.js";
import { formatMoney } from "./core/ventas/reporte.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import { crearSolicitudInterna } from "./core/solicitudes/crear-solicitud-interna.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_TIPOS,
  type SolicitudEstado,
  type SolicitudInterna,
  type SolicitudStorePort,
  type SolicitudTipo,
} from "./core/solicitudes/solicitudes-contract.js";
import type { AccionSolicitud } from "./core/solicitudes/resolver-solicitud-interna.js";
import { getSubagentDefinition } from "./core/agents/definitions.js";
import { invokeModel } from "./core/turn-selector/invoke-model.js";
import type { DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { createVentaStore } from "./build-on-venta.js";
import { createDelegacionStore } from "./build-on-activity.js";
import type { SoporteResult } from "./build-on-soporte.js";
import {
  buscarCredencialEmpleado,
  insertAccionEmpleado,
  crearSolicitudConCaso as crearSolicitudConCasoRow,
  adjuntarDictamenSolicitud,
  listSolicitudesInternas,
  aprobarSolicitudInterna,
  rechazarSolicitudInterna,
  getCasoById,
  CasoNotFoundError,
  type SolicitudRow,
} from "./adapters/memory/repository.js";
import type { SubmitPromptHandler, TuiTurnResult } from "./adapters/tui/tui-port.js";

/**
 * TTL de la confirmación pendiente (ADR 36) — constante de módulo, NO
 * variable de entorno: es un presupuesto de UX (el tiempo que tarda alguien
 * en leer un monto), no algo que nadie vaya a tunear. Independiente y mucho
 * menor que el TTL de sesión.
 */
const CONFIRMACION_TTL_MINUTOS = 2;

/**
 * Unión discriminada por `dominio` (Hito 5, tarea 22, ADR 55): sigue
 * habiendo UNA sola ranura (`confirmacionPendiente` más abajo), ensanchada
 * de tipo, no duplicada. `dominio: "solicitud"` la escriben
 * `/aprobar-solicitud`/`/rechazar-solicitud` (tarea 23) — `/solicitar` es
 * de un solo paso (§4.2) y nunca construye ni compara esta rama.
 */
type ConfirmacionPendiente =
  | {
      readonly dominio: "reembolso";
      readonly accion: AccionEscalacion;
      readonly ventaId: string;
      readonly casoId: string;
      readonly monto: number;
      /** ATADURA a la sesión que la creó (ADR 31 punto 5). */
      readonly empleadoId: string;
      readonly expiraEn: string;
    }
  | {
      readonly dominio: "solicitud";
      readonly accion: AccionSolicitud;
      readonly solicitudId: string;
      readonly casoId: string;
      readonly empleadoId: string;
      readonly expiraEn: string;
    };

export interface BuildOnComandoEmpleadoDeps {
  /** El `SubmitPromptHandler` que `buildOnSubmit` ya devuelve. Se ENVUELVE, no se toca. */
  readonly onSubmit: SubmitPromptHandler;
  /** El MISMO `buildOnSoporte(...)` que sirve a `POST /soporte` — armado UNA vez en `main.ts` y compartido. */
  readonly onSoporte: (input: { readonly consulta: string }) => Promise<SoporteResult>;
  readonly db: Database.Database;
  readonly ventasConfig: VentasConfig;
  readonly authConfig: AuthConfig;
  /** De `src/adapters/crypto/password.ts`. Inyectado (ADR 30): el núcleo no sabe que existe scrypt. */
  readonly verificarPassword: (password: string, hash: string) => boolean;
  /**
   * Hash dummy para la mitigación de timing attack de `resolverLogin`
   * (`core/auth/login.ts`). Generado en `main.ts` con `hashPassword(...)` —
   * la MISMA función que genera los hashes reales — para que herede siempre
   * los parámetros de costo vivos de scrypt y nunca pueda desincronizarse
   * (fix de review, hallazgo de duplicación/drift).
   */
  readonly dummyPasswordHash: string;
  /**
   * Hito 5, tarea 22: requerido (sin default), mismo tipo que
   * `BuildOnActivityDeps.hooks` (`build-on-activity.ts`) — necesario para
   * cerrar `despacharDeps.invocar` sobre `invokeModel` al delegar al
   * `validador-solicitudes`.
   */
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly newId?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;
  /* Costuras de test — default: closures sobre `db`. */
  readonly store?: VentaStorePort;
  readonly credenciales?: CredencialesEmpleadoPort;
  readonly registro?: RegistroAccionesEmpleadoPort;
  /** Tarea 22 — default: `createSolicitudStore(db)` (más abajo). */
  readonly solicitudStore?: SolicitudStorePort;
  /** Tarea 22 — default: closure sobre `invokeModel`, mismo molde que `build-on-activity.ts`. */
  readonly despacharDeps?: DespacharDelegacionDeps;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sistema(texto: string): TuiTurnResult {
  return { responseText: texto, agentLabel: "sistema" };
}

/** Una línea por venta — MISMO formato de línea que `reporte.ts` (§6.4-5/6/7). */
function formatearLineaEscalacion(v: EscalacionListada): string {
  const base = `- venta ${v.ventaId} | vendedor ${v.vendedorNombre} | cliente ${v.clienteId} | monto ${formatMoney(
    v.monto,
  )} | caso ${v.casoId}`;
  return v.confirmedAt === undefined ? base : `${base} | confirmada ${v.confirmedAt}`;
}

function formatearListado(items: readonly EscalacionListada[]): string {
  if (items.length === 0) {
    return "No hay ventas para listar.";
  }
  return items.map(formatearLineaEscalacion).join("\n");
}

/** Eco de confirmación (§6.4-5/6/7c). `reabrir` agrega la salvedad del rechazo previo (ADR 29 punto 2). */
function formatearEco(accion: AccionEscalacion, venta: EscalacionListada): string {
  const base = `venta ${venta.ventaId} · cliente ${venta.clienteId} · monto ${formatMoney(venta.monto)} · caso ${venta.casoId} — repetí el comando para confirmar.`;
  if (accion !== ACCION_REABRIR) {
    return base;
  }
  const rechazadaPor = venta.rechazadaPor ?? "desconocido";
  const rechazadaAt = venta.rechazadaAt ?? "fecha desconocida";
  return `${base} rechazada por ${rechazadaPor} el ${rechazadaAt} · reaperturas previas: ${venta.reaperturasPrevias}.`;
}

/**
 * `aprobar` y `rechazar` comparten la MISMA transición de estado (venta
 * `reembolso_pendiente` → resuelta, caso → `resuelto`) — solo `reabrir`
 * difiere (mismo binario que `formatearEco` arriba, `accion !==
 * ACCION_REABRIR`). Factorizado en una constante en vez de repetido en las
 * dos entradas de `ACCION_ESCALACION_INFO` (Reviewer finding, hallazgo de
 * duplicación): así un cambio a esta transición se edita en un solo lugar
 * y no puede dejar una de las dos entradas desactualizada.
 */
const ESTADOS_APROBAR_O_RECHAZAR = {
  estadoOrigen: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  estadoCaso: CASO_ESTADO_RESUELTO,
} as const;

/** Los tres textos que varían por `AccionEscalacion` — unificados para no branchear tres veces sobre el mismo valor. */
const ACCION_ESCALACION_INFO: Record<
  AccionEscalacion,
  { readonly estadoOrigen: string; readonly estadoCaso: string; readonly comando: string }
> = {
  [ACCION_APROBAR]: { ...ESTADOS_APROBAR_O_RECHAZAR, comando: COMANDO_APROBAR_REEMBOLSO },
  [ACCION_RECHAZAR]: { ...ESTADOS_APROBAR_O_RECHAZAR, comando: COMANDO_RECHAZAR_REEMBOLSO },
  [ACCION_REABRIR]: {
    estadoOrigen: VENTA_ESTADO_REEMBOLSO_RECHAZADO,
    estadoCaso: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
    comando: COMANDO_REABRIR_REEMBOLSO,
  },
};

function resultadoDevolucion(resultado: DevolucionResult["resultado"]): string {
  if (resultado === "reembolsada") return RESULTADO_REEMBOLSADA;
  if (resultado === "escalada") return RESULTADO_ESCALADA;
  return RESULTADO_NO_APLICABLE;
}

/** Vocabulario de `estado` para validar contra la base — mismo criterio que `SOLICITUD_TIPOS`. */
const SOLICITUD_ESTADOS = [SOLICITUD_ESTADO_PENDIENTE, SOLICITUD_ESTADO_APROBADA, SOLICITUD_ESTADO_RECHAZADA] as const;

/**
 * Lanzado por `toPortSolicitud` cuando una fila de `solicitudes_internas`
 * trae un `tipo`/`estado` que no pertenece a `SOLICITUD_TIPOS`/
 * `SOLICITUD_ESTADOS`. Mismo criterio que `ActividadTipoEstadoInvalidoError`
 * (`build-on-activity.ts`): las columnas son TEXT sin `CHECK` a propósito
 * (repository.ts, migración `0008`), pero el ÚNICO escritor de `tipo` es
 * `crearSolicitudInterna` — que ya valida contra `SOLICITUD_TIPOS` ANTES de
 * escribir (§5.6) — así que un valor inválido acá es corrupción de datos
 * real, no una entrada externa esperable.
 */
export class SolicitudTipoEstadoInvalidoError extends Error {
  constructor(solicitudId: string, tipo: string, estado: string) {
    super(`Solicitud ${solicitudId} tiene tipo/estado inválido en la base: ${tipo}/${estado}`);
    this.name = "SolicitudTipoEstadoInvalidoError";
  }
}

/**
 * Traduce un `SolicitudRow` de `repository.ts` (`tipo`/`estado` como
 * `string` suelto) a la `SolicitudInterna` del puerto (`tipo: SolicitudTipo`,
 * `estado: SolicitudEstado`, uniones literales) — mismo criterio que
 * `toPortActividad` (`build-on-activity.ts`). El resto de los campos ya
 * coincide 1:1 (documentado así en `repository.ts:1744-1751`).
 */
function toPortSolicitud(row: SolicitudRow): SolicitudInterna {
  const tipoValido = (SOLICITUD_TIPOS as readonly string[]).includes(row.tipo);
  const estadoValido = (SOLICITUD_ESTADOS as readonly string[]).includes(row.estado);
  if (!tipoValido || !estadoValido) {
    throw new SolicitudTipoEstadoInvalidoError(row.id, row.tipo, row.estado);
  }
  return { ...row, tipo: row.tipo as SolicitudTipo, estado: row.estado as SolicitudEstado };
}

/**
 * `SolicitudStorePort` por closures sobre `repository.ts` (Hito 5, tarea 22,
 * §5.6/§6.3) — mismo patrón que `createVentaStore`/`createDelegacionStore`:
 * delegaciones directas sin lógica de negocio propia, solo traducción vía
 * `toPortSolicitud` de arriba. `crearSolicitudConCasoRow` es el import
 * ALIASEADO de `repository.crearSolicitudConCaso` — mismo nombre que el
 * método del puerto (`SolicitudStorePort.crearSolicitudConCaso`), aliaseado
 * únicamente para que no haya un identificador de módulo y una clave de
 * método idénticos en el mismo bloque.
 */
export function createSolicitudStore(db: Database.Database): SolicitudStorePort {
  return {
    crearSolicitudConCaso(input) {
      const { solicitud } = crearSolicitudConCasoRow(db, input);
      return toPortSolicitud(solicitud);
    },
    adjuntarDictamen(input) {
      const row = adjuntarDictamenSolicitud(db, input);
      return row ? toPortSolicitud(row) : undefined;
    },
    listarSolicitudesPendientes(filtro) {
      return listSolicitudesInternas(db, filtro).map(toPortSolicitud);
    },
    aprobarSolicitud(input) {
      const row = aprobarSolicitudInterna(db, input);
      return row ? toPortSolicitud(row) : undefined;
    },
    rechazarSolicitud(input) {
      const row = rechazarSolicitudInterna(db, input);
      return row ? toPortSolicitud(row) : undefined;
    },
  };
}

/** Devuelve un `SubmitPromptHandler` — MISMO tipo, MISMA firma. I1 no cambia. */
export function buildOnComandoEmpleado(deps: BuildOnComandoEmpleadoDeps): SubmitPromptHandler {
  const { onSubmit, onSoporte, db, ventasConfig, authConfig, verificarPassword, dummyPasswordHash, logDeps, hooks } =
    deps;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const store: VentaStorePort = deps.store ?? createVentaStore(db);
  const credenciales: CredencialesEmpleadoPort =
    deps.credenciales ??
    {
      buscarCredencial: (empleadoId) => {
        const row = buscarCredencialEmpleado(db, empleadoId);
        return row ? { empleadoId: row.empleadoId, passwordHash: row.passwordHash } : undefined;
      },
    };
  const registro: RegistroAccionesEmpleadoPort =
    deps.registro ?? { registrarAccion: (accion) => insertAccionEmpleado(db, accion) };
  const logEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) =>
    logTurnEvent(casoId, event, fields, logDeps);
  const solicitudStore: SolicitudStorePort = deps.solicitudStore ?? createSolicitudStore(db);
  /**
   * Mismo molde que `delegacionDeps` en `build-on-activity.ts` (§6.4):
   * `invocar` resuelve el `caso` REAL (ya insertado transaccionalmente por
   * `store.crearSolicitudConCaso` dentro de `crearSolicitudInterna`, ANTES
   * de que este closure corra) — `CasoNotFoundError` si no existe, nunca un
   * placeholder. `resumeSessionId: undefined` explícito (ADR 53).
   */
  const despacharDeps: DespacharDelegacionDeps =
    deps.despacharDeps ??
    {
      store: createDelegacionStore(db),
      invocar: async ({ agent, casoId, tareaDelegada }) => {
        const caso = getCasoById(db, casoId);
        if (caso === undefined) {
          throw new CasoNotFoundError(casoId);
        }
        return invokeModel(agent, { caso, resumeSessionId: undefined }, tareaDelegada, hooks);
      },
      getSubagente: getSubagentDefinition,
      newId,
      now,
      logEvent,
    };

  // Las DOS ranuras del closure (ADR 31, 36) — privadas, mutables, nunca persistidas.
  let sesion: SesionEmpleado | undefined;
  let confirmacionPendiente: ConfirmacionPendiente | undefined;

  /**
   * Único punto donde el dispatcher escribe FUERA de una transacción
   * (design.md §6.5). ADR 40: nunca propaga — degrada a un evento.
   */
  function registrar(input: Omit<AccionEmpleado, "id" | "empleadoId" | "ocurridoAt">, ahora: string): void {
    if (!sesionVigente(sesion, ahora)) {
      return;
    }
    const empleadoId = (sesion as SesionEmpleado).empleadoId;
    try {
      registro.registrarAccion({ ...input, id: newId(), empleadoId, ocurridoAt: ahora });
      logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-registrada", {
        comando: input.comando,
        resultado: input.resultado,
      });
    } catch (error) {
      logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-registro-fallido", {
        comando: input.comando,
        message: toErrorMessage(error),
      });
    }
  }

  function manejarLogin(comando: Extract<ComandoEmpleado, { tipo: "login" }>, ahora: string): TuiTurnResult {
    // ADR 36: SIEMPRE se limpia, exitoso o no — un intento de login es un cambio de contexto.
    confirmacionPendiente = undefined;

    const resultado = resolverLogin(
      { empleadoId: comando.empleadoId, password: comando.password },
      {
        store: credenciales,
        verificarPassword,
        dummyPasswordHash,
        now,
        ttlMinutos: authConfig.sesionTtlMinutos,
        logEvent,
      },
    );

    if (resultado.resultado === "invalida") {
      sesion = undefined;
      return sistema("Credenciales inválidas.");
    }

    sesion = resultado.sesion;
    registrar({ comando: COMANDO_LOGIN, resultado: RESULTADO_EXITOSA }, ahora);
    const detalleExpiracion =
      resultado.sesion.expiraEn !== undefined ? ` Vence ${resultado.sesion.expiraEn}.` : " Sin expiración.";
    return sistema(`Sesión abierta como ${comando.empleadoId}.${detalleExpiracion}`);
  }

  function manejarLogout(): TuiTurnResult {
    if (sesion === undefined) {
      return sistema("No hay ninguna sesión abierta.");
    }
    const empleadoId = sesion.empleadoId;
    sesion = undefined;
    confirmacionPendiente = undefined;
    logEvent(COMANDO_LOG_CORRELATION_ID, "logout", { empleadoId });
    return sistema("Sesión cerrada.");
  }

  async function manejarSoporte(
    comando: Extract<ComandoEmpleado, { tipo: "soporte" }>,
    ahora: string,
  ): Promise<TuiTurnResult> {
    try {
      const resultado = await onSoporte({ consulta: comando.consulta });
      if (sesionVigente(sesion, ahora)) {
        registrar({ comando: COMANDO_SOPORTE, casoId: resultado.casoId, resultado: RESULTADO_ATENDIDA }, ahora);
      } else {
        logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-sin-sesion", { comando: COMANDO_SOPORTE });
      }
      return { responseText: resultado.respuesta, agentLabel: "soporte" };
    } catch (error) {
      // ADR 40 / §6.4-3c: la TUI no puede quedarse sin respuesta. Sin un
      // `casoId` conocido en el rechazo no hay nada que correlacionar — se
      // registra solo el evento, nunca la fila `fallida` (design.md §6.4-3, nota).
      logEvent(COMANDO_LOG_CORRELATION_ID, "comando-soporte-fallido", { message: toErrorMessage(error) });
      return sistema(`No se pudo atender la consulta: ${toErrorMessage(error)}`);
    }
  }

  function manejarDevolucion(comando: Extract<ComandoEmpleado, { tipo: "devolucion" }>, ahora: string): TuiTurnResult {
    const resultado = procesarDevolucion(
      { token: comando.token, ...(comando.motivo !== undefined ? { motivo: comando.motivo } : {}) },
      { store, config: ventasConfig, now, logEvent },
    );

    if (sesionVigente(sesion, ahora)) {
      registrar(
        {
          comando: COMANDO_DEVOLUCION,
          ...(resultado.ventaId !== undefined ? { ventaId: resultado.ventaId } : {}),
          ...(resultado.casoId !== undefined ? { casoId: resultado.casoId } : {}),
          resultado: resultadoDevolucion(resultado.resultado),
        },
        ahora,
      );
    } else {
      logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-sin-sesion", { comando: COMANDO_DEVOLUCION });
    }

    if (resultado.resultado === "reembolsada") {
      return sistema(`Devolución procesada: la venta ${resultado.ventaId} quedó reembolsada.`);
    }
    if (resultado.resultado === "escalada") {
      return sistema(
        `Devolución escalada: la venta ${resultado.ventaId} quedó en reembolso_pendiente, pendiente de aprobación humana.`,
      );
    }
    return sistema("No se pudo procesar esa devolución.");
  }

  function manejarEscalacion(accion: AccionEscalacion, ventaIdInput: string | undefined, ahora: string): TuiTurnResult {
    // El preámbulo (guarda de privilegio) ya garantizó sesión vigente para
    // llegar hasta acá — ADR 37: nunca un `empleadoId` tipeado.
    const sesionActual = sesion as SesionEmpleado;

    if (ventaIdInput === undefined) {
      const resultado = resolverEscalacionReembolso(
        { accion, confirmado: false, sesion: sesionActual },
        { store, newId, now, logEvent },
      );
      if (resultado.resultado !== "listado") {
        return sistema("No se pudo listar los reembolsos.");
      }
      return sistema(formatearListado(resultado.items));
    }

    const coincide =
      confirmacionPendiente !== undefined &&
      confirmacionPendiente.dominio === "reembolso" &&
      confirmacionPendiente.ventaId === ventaIdInput &&
      confirmacionPendiente.accion === accion &&
      confirmacionPendiente.empleadoId === sesionActual.empleadoId;

    if (!coincide) {
      const resultado = resolverEscalacionReembolso(
        { accion, ventaId: ventaIdInput, confirmado: false, sesion: sesionActual },
        { store, newId, now, logEvent },
      );

      if (resultado.resultado === "no_aplicable") {
        return sistema(`No hay ninguna venta ${ventaIdInput} en estado ${ACCION_ESCALACION_INFO[accion].estadoOrigen}.`);
      }
      if (resultado.resultado !== "requiere_confirmacion") {
        return sistema("No se pudo procesar ese comando.");
      }

      confirmacionPendiente = {
        dominio: "reembolso",
        accion,
        ventaId: ventaIdInput,
        casoId: resultado.venta.casoId,
        monto: resultado.venta.monto,
        empleadoId: sesionActual.empleadoId,
        expiraEn: new Date(Date.parse(ahora) + CONFIRMACION_TTL_MINUTOS * 60_000).toISOString(),
      };
      return sistema(formatearEco(accion, resultado.venta));
    }

    // Coincide: se CONSUME antes de ejecutar (ADR 36).
    confirmacionPendiente = undefined;
    const resultado = resolverEscalacionReembolso(
      { accion, ventaId: ventaIdInput, confirmado: true, sesion: sesionActual },
      { store, newId, now, logEvent },
    );

    if (resultado.resultado === "aplicada") {
      return sistema(
        `Listo: la venta ${ventaIdInput} quedó en ${resultado.estadoFinal} y el caso ${resultado.venta.casoId} en ${ACCION_ESCALACION_INFO[accion].estadoCaso}.`,
      );
    }

    if (resultado.resultado === "no_aplicable") {
      if (resultado.motivo === "cas" && resultado.casoId !== undefined) {
        // La fila ya se hubiese escrito DENTRO de la transacción si el CAS
        // matcheaba (ADR 27); acá no hubo transacción, así que se escribe
        // FUERA — único caso en que este comando privilegiado pasa por `registrar`.
        registrar(
          {
            comando: ACCION_ESCALACION_INFO[accion].comando,
            ventaId: ventaIdInput,
            casoId: resultado.casoId,
            resultado: RESULTADO_NO_APLICABLE,
          },
          ahora,
        );
      }
      return sistema(`Esa venta ya no está en ${ACCION_ESCALACION_INFO[accion].estadoOrigen}: no se aplicó nada.`);
    }

    return sistema("No se pudo procesar ese comando.");
  }

  /**
   * Alta de solicitud interna (Hito 5, tarea 22, §4.2, ADR 55). UN SOLO
   * PASO — sesión vigente ya la garantizó la guarda de privilegio (§6.3
   * paso 6): a diferencia de `manejarEscalacion`, esta función NUNCA lee ni
   * escribe `confirmacionPendiente`. Delega el flujo completo (transacción
   * `caso`+`solicitud`, delegación al validador, degradación de fallo ADR
   * 40) a `crearSolicitudInterna` (tarea 17, ya probado ahí) — acá solo se
   * cablea y se traduce el resultado a `TuiTurnResult`.
   *
   * `registrar(...)`: `COMANDO_SOLICITAR`/`RESULTADO_CREADA` (tarea 21) se
   * consumen acá — mismo molde que `manejarDevolucion`, escritura FUERA de
   * la transacción de `crearSolicitudInterna` (que no toca
   * `registro_acciones_empleado`). Se registra únicamente el alta
   * `"creada"` (con o sin dictamen — ambos casos devuelven `resultado:
   * "creada"` desde `crearSolicitudInterna`, ADR 40); `tipo_desconocido` NO
   * registra fila, mismo criterio "cero escrituras" que
   * `crearSolicitudInterna` ya declara para ese caso — no hay `caso`/
   * `solicitud` que correlacionar, y ningún evento de log está definido
   * para él en design.md §7.
   */
  async function manejarSolicitud(
    comando: Extract<ComandoEmpleado, { tipo: "solicitar" }>,
    ahora: string,
  ): Promise<TuiTurnResult> {
    const sesionActual = sesion as SesionEmpleado;

    const resultado = await crearSolicitudInterna(
      { tipo: comando.tipoSolicitud, detalle: comando.detalle, solicitanteId: sesionActual.empleadoId },
      { store: solicitudStore, despacharDeps },
    );

    if (resultado.resultado === "tipo_desconocido") {
      return sistema(
        `No conozco el tipo de solicitud "${comando.tipoSolicitud}". Tipos válidos: ${SOLICITUD_TIPOS.join(", ")}.`,
      );
    }

    const { solicitud } = resultado;
    registrar({ comando: COMANDO_SOLICITAR, casoId: solicitud.casoId, resultado: RESULTADO_CREADA }, ahora);

    const detalleDictamen =
      solicitud.dictamen !== undefined
        ? ` Dictamen: ${solicitud.dictamen}`
        : " Sin dictamen: la validación automática no se pudo completar.";
    return sistema(`Solicitud ${solicitud.id} creada (caso ${solicitud.casoId}).${detalleDictamen}`);
  }

  function manejarAyuda(comando: Extract<ComandoEmpleado, { tipo: "ayuda" }>): TuiTurnResult {
    if (comando.motivo === "solicitada") {
      return sistema(formatearAyuda());
    }
    if (comando.motivo === "desconocido") {
      logEvent(COMANDO_LOG_CORRELATION_ID, "comando-desconocido", { comando: comando.comando });
      return sistema(`No conozco ${comando.comando}.\n${formatearAyuda()}`);
    }
    // motivo === "argumentos"
    const descriptor = COMANDOS.find((d) => d.nombre === comando.comando);
    return sistema(`Uso: ${descriptor?.uso ?? comando.comando ?? ""}\n${descriptor?.ayuda ?? ""}`);
  }

  return async (texto, onAgentResolved) => {
    const ahora = now();

    // 1. Purga de sesión vencida — ANTES del parseo: es un hecho del reloj.
    if (sesion !== undefined && !sesionVigente(sesion, ahora)) {
      const empleadoId = sesion.empleadoId;
      sesion = undefined;
      confirmacionPendiente = undefined;
      logEvent(COMANDO_LOG_CORRELATION_ID, "sesion-expirada", { empleadoId });
    }

    // 2. Purga silenciosa de la confirmación pendiente vencida.
    if (confirmacionPendiente !== undefined && ahora >= confirmacionPendiente.expiraEn) {
      confirmacionPendiente = undefined;
    }

    // 3-4. Parseo — `undefined` ⇒ delegación BYTE POR BYTE a `onSubmit`.
    const comando = parsearComando(texto);
    if (comando === undefined) {
      return onSubmit(texto, onAgentResolved);
    }

    // 5. Log de recepción — SOLO `tipo`, nunca el texto ni los argumentos.
    logEvent(COMANDO_LOG_CORRELATION_ID, "comando-empleado-recibido", { tipo: comando.tipo });

    // 6. Guarda de privilegio — CERO escrituras si no hay sesión vigente.
    if (esComandoPrivilegiado(comando.tipo) && !sesionVigente(sesion, ahora)) {
      logEvent(COMANDO_LOG_CORRELATION_ID, "comando-privilegiado-sin-sesion", { tipo: comando.tipo });
      return sistema("Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>.");
    }

    // 7. Ruteo.
    switch (comando.tipo) {
      case "login":
        return manejarLogin(comando, ahora);
      case "logout":
        return manejarLogout();
      case "soporte":
        return manejarSoporte(comando, ahora);
      case "devolucion":
        return manejarDevolucion(comando, ahora);
      case "aprobar_reembolso":
        return manejarEscalacion(ACCION_APROBAR, comando.ventaId, ahora);
      case "rechazar_reembolso":
        return manejarEscalacion(ACCION_RECHAZAR, comando.ventaId, ahora);
      case "reabrir_reembolso":
        return manejarEscalacion(ACCION_REABRIR, comando.ventaId, ahora);
      case "solicitar":
        return manejarSolicitud(comando, ahora);
      case "ayuda":
        return manejarAyuda(comando);
    }
  };
}
