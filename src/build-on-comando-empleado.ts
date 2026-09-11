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
 * `confirmacionPendiente`; la rama `dominio: "solicitud"` de la unión
 * existía para que el tipo compilara en la tarea 22, sin escritor todavía.
 *
 * **Hito 5, tarea 23 (§6.4 parte 2, ADR 36, ADR 55)**: `/aprobar-solicitud`
 * y `/rechazar-solicitud` (`manejarResolucionSolicitud`) son el escritor y
 * lector real de la rama `dominio: "solicitud"` — mismo molde en dos pasos
 * (eco → confirmar) que `manejarEscalacion` para reembolsos, delegando la
 * transición pura a `resolverSolicitudInterna` (tarea 18) y el CAS
 * transaccional a `SolicitudStorePort.aprobarSolicitud`/`rechazarSolicitud`
 * (tarea 19). Con esto el `switch (comando.tipo)` de más abajo vuelve a ser
 * exhaustivo — cierra el `TS2322` diferido desde la tarea 20.
 *
 * **Hito 5.1, tarea 31 (§5.10 parte 1, ADR 55, ADR 60 pto 1, ADR 69)**:
 * `ConfirmacionPendiente` gana la TERCERA rama, `dominio: "propuesta"` —
 * sigue habiendo UNA sola ranura. `/ver-propuesta` (`manejarVerPropuesta`)
 * es de UN SOLO PASO, de solo lectura: NUNCA construye ni compara esa
 * rama, mismo precedente que `/solicitar` con `dominio: "solicitud"` en la
 * tarea 22. El escritor real de `dominio: "propuesta"` era
 * `manejarResolucionPropuesta`, para `/aplicar-propuesta`/
 * `/descartar-propuesta`.
 *
 * **Hito 5.1, tarea 32 (§5.10 parte 2, ADR 64, ADR 65)**:
 * `manejarResolucionPropuesta` llega acá — mismo molde en dos pasos que
 * `manejarResolucionSolicitud`, con UNA diferencia impuesta por ADR 64: el
 * segundo llamado de `/aplicar-propuesta` intercala `git apply --check`
 * (`AplicarPatchPort.verificar`) ANTES de la transacción CAS y `git apply`
 * real (`AplicarPatchPort.aplicar`) DESPUÉS de que esa transacción hizo
 * commit — nunca al revés, y `git apply` corre SIEMPRE fuera de la
 * transacción SQL (RD-13, heredado y hecho visible con el evento
 * `propuesta-apply-fallido`). `/descartar-propuesta` NUNCA toca
 * `AplicarPatchPort` — no hay patch que aplicar al descartar. Con esto el
 * `switch (comando.tipo)` de más abajo vuelve a ser exhaustivo — cierra el
 * `TS2322` diferido desde la tarea 29.
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
  COMANDO_APLICAR_PROPUESTA,
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_APROBAR_SOLICITUD,
  COMANDO_CONSULTAR_KPI,
  COMANDO_DESCARTAR_PROPUESTA,
  COMANDO_DEVOLUCION,
  COMANDO_LOGIN,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_RECHAZAR_SOLICITUD,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_SOLICITAR,
  COMANDO_SOPORTE,
  RESULTADO_ATENDIDA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_EXITOSA,
  RESULTADO_FALLIDA,
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
import { MOTIVO_CAS } from "./core/hitl/hitl-contract.js";
import { type VentasConfig } from "./core/ventas/ventas-config.js";
import {
  agruparReporteMensual,
  formatMoney,
  formatearReporteMensual,
  resolverPeriodoReporte,
} from "./core/ventas/reporte.js";
import { type ReporteStorePort } from "./core/ventas/reporte-contract.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import { crearSolicitudInterna } from "./core/solicitudes/crear-solicitud-interna.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_TIPOS,
  type SolicitudEstado,
  type SolicitudInterna,
  type SolicitudStorePort,
  type SolicitudTipo,
} from "./core/solicitudes/solicitudes-contract.js";
import {
  ACCION_APROBAR_SOLICITUD,
  ACCION_RECHAZAR_SOLICITUD,
  resolverSolicitudInterna,
  type AccionSolicitud,
} from "./core/solicitudes/resolver-solicitud-interna.js";
import {
  LINEAS_PAGINA_PATCH,
  PROPUESTA_ESTADO_APLICADA,
  PROPUESTA_ESTADO_DESCARTADA,
  PROPUESTA_ESTADO_PENDIENTE,
  type PropuestaCambio,
  type PropuestaEstado,
  type PropuestaStorePort,
} from "./core/propuestas/propuestas-contract.js";
import {
  ACCION_APLICAR_PROPUESTA,
  ACCION_DESCARTAR_PROPUESTA,
  resolverPropuestaCambio,
  type AccionPropuesta,
} from "./core/propuestas/resolver-propuesta-cambio.js";
import { type AplicarPatchPort } from "./core/agents/worktree-contract.js";
import { getSubagentDefinition } from "./core/agents/definitions.js";
import { invokeModel } from "./core/turn-selector/invoke-model.js";
import type { DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";
import {
  despacharDelegacionA2A,
  resolverDestinoA2A,
  type DelegacionA2AStorePort,
} from "./core/turn-selector/dispatch-delegation-a2a.js";
import {
  DelegacionA2ANoCompletadaError,
  DESTINO_A2A_KPI_INCIDENTE,
  type ClienteA2APort,
  type MotivoDelegacionA2ANoCompletada,
} from "./core/agents/a2a-contract.js";
import { type InsumoDelegado } from "./core/agents/subagents.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { createVentaStore, createDelegacionA2AStore } from "./build-on-venta.js";
import { createDelegacionStore } from "./build-on-activity.js";
import { createGitAdapter } from "./adapters/git/index.js";
import { resolveGitConfig, resolveWorktreeConfig } from "./adapters/git/config.js";
import type { SoporteResult } from "./build-on-soporte.js";
import {
  buscarCredencialEmpleado,
  insertAccionEmpleado,
  createCaso,
  crearSolicitudConCaso as crearSolicitudConCasoRow,
  adjuntarDictamenSolicitud,
  listSolicitudesInternas,
  aprobarSolicitudInterna,
  rechazarSolicitudInterna,
  cancelarSolicitudInterna,
  getCasoById,
  CasoNotFoundError,
  insertPropuestaCambio,
  getPropuestaCambio,
  listPropuestasCambio,
  aplicarPropuestaCambio,
  descartarPropuestaCambio,
  listComisionesPorPeriodo,
  listVentasEnReembolsoPendiente,
  type SolicitudRow,
  type PropuestaRow,
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
 * Unión discriminada por `dominio` (Hito 5, tarea 22, ADR 55; ensanchada en
 * Hito 5.1, tarea 31, ADR 60 pto 1): sigue habiendo UNA sola ranura
 * (`confirmacionPendiente` más abajo), ensanchada de tipo, no duplicada.
 * `dominio: "solicitud"` la escriben `/aprobar-solicitud`/`/rechazar-solicitud`
 * (tarea 23) — `/solicitar` es de un solo paso (§4.2) y nunca construye ni
 * compara esta rama.
 *
 * `dominio: "propuesta"` es la tercera rama (tarea 31): existe para que el
 * tipo compile, MISMO precedente que `dominio: "solicitud"` en la tarea 22
 * — su escritor real (`manejarResolucionPropuesta`, para
 * `/aplicar-propuesta`/`/descartar-propuesta`) llega recién en la tarea 32.
 * `manejarVerPropuesta` (esta tarea) es de UN SOLO PASO, sin confirmación
 * (ADR 60 pto 1): NUNCA construye ni compara esta rama, igual que
 * `/solicitar` con `dominio: "solicitud"`.
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
    }
  | {
      readonly dominio: "propuesta";
      readonly accion: AccionPropuesta;
      readonly propuestaId: string;
      readonly casoId: string;
      readonly patchBytes: number;
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
  /** Tarea 31 — default: `createPropuestaStore(db)` (más abajo). */
  readonly propuestaStore?: PropuestaStorePort;
  /**
   * Tarea 32, ADR 64 — default: `createGitAdapter({ repoRoot: process.cwd(), ... }).aplicarPatch`
   * (más abajo), construido con la config real resuelta de env
   * (`resolveGitConfig`/`resolveWorktreeConfig`, `src/adapters/git/config.ts`).
   * `git apply --check`/`git apply` — nunca `git commit`/`git push`/PR.
   */
  readonly aplicarPatch?: AplicarPatchPort;
  /** Tarea 22 — default: closure sobre `invokeModel`, mismo molde que `build-on-activity.ts`. */
  readonly despacharDeps?: DespacharDelegacionDeps;
  /**
   * Hito 6, tarea 20 (ADR 85 + ADR 82). Ausente ⇒ A2A saliente APAGADO ⇒
   * `/consultar-kpi` responde que está desactivado, sin crear caso, sin
   * fila y sin `fetch`. Lo cablea `main.ts` (tarea 21) — este módulo NO lee
   * `HARNESS_A2A_SALIENTE` por su cuenta: el interruptor se consulta UNA
   * vez, en el composition root, y de ahí salen los DOS consumidores
   * (ventas y TUI).
   */
  readonly clienteA2A?: ClienteA2APort;
  /** Costura de test — default: `createDelegacionA2AStore(db)` (`build-on-venta.ts`, tarea 16). */
  readonly delegacionA2AStore?: DelegacionA2AStorePort;
  /**
   * `comando-reporte-comisiones`, ADR 121 pto 1 (RD-55) — default: closure
   * inline sobre `listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente`
   * (`repository.ts`), MISMO molde que `credenciales`/`registro` más abajo
   * (sin `createXStore`: no hay traducción de filas que hacer).
   */
  readonly reporteStore?: ReporteStorePort;
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
const SOLICITUD_ESTADOS = [
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_ESTADO_CANCELADA,
] as const;

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
    cancelarSolicitud(input) {
      const row = cancelarSolicitudInterna(db, input);
      return row ? toPortSolicitud(row) : undefined;
    },
  };
}

/** Vocabulario de `estado` para validar contra la base — mismo criterio que `SOLICITUD_ESTADOS`. */
const PROPUESTA_ESTADOS = [PROPUESTA_ESTADO_PENDIENTE, PROPUESTA_ESTADO_APLICADA, PROPUESTA_ESTADO_DESCARTADA] as const;

/**
 * Lanzado por `toPortPropuesta` cuando una fila de `propuestas_cambio` trae
 * un `estado` que no pertenece a `PROPUESTA_ESTADOS` — mismo criterio que
 * `SolicitudTipoEstadoInvalidoError`: el ÚNICO escritor del estado inicial
 * es `insertPropuestaCambio` (literal fijo, `pendiente_aprobacion_humana`) y
 * las únicas transiciones posibles son `aplicarPropuestaCambio`/
 * `descartarPropuestaCambio` (`repository.ts`, tarea 15) — un valor
 * inválido acá es corrupción de datos real, no una entrada externa
 * esperable.
 */
export class PropuestaEstadoInvalidoError extends Error {
  constructor(propuestaId: string, estado: string) {
    super(`Propuesta ${propuestaId} tiene estado inválido en la base: ${estado}`);
    this.name = "PropuestaEstadoInvalidoError";
  }
}

/**
 * Traduce un `PropuestaRow` de `repository.ts` (`estado` como `string`
 * suelto) a la `PropuestaCambio` del puerto (`estado: PropuestaEstado`,
 * unión literal) — mismo criterio que `toPortSolicitud`. El resto de los
 * campos ya coincide 1:1 (`repository.ts`, `PropuestaRow`).
 */
function toPortPropuesta(row: PropuestaRow): PropuestaCambio {
  const estadoValido = (PROPUESTA_ESTADOS as readonly string[]).includes(row.estado);
  if (!estadoValido) {
    throw new PropuestaEstadoInvalidoError(row.id, row.estado);
  }
  return { ...row, estado: row.estado as PropuestaEstado };
}

/**
 * `PropuestaStorePort` por closures sobre `repository.ts` (Hito 5.1, tarea
 * 31, §5.6) — mismo patrón que `createSolicitudStore`: delegaciones
 * directas sin lógica de negocio propia, solo traducción vía
 * `toPortPropuesta` de arriba. Los cinco métodos ya tienen su función real
 * del lado de `repository.ts` (tareas 13-15), incluidos `aplicarPropuesta`/
 * `descartarPropuesta` — esta tarea (31) solo EJERCITA `obtenerPropuesta`/
 * `listarPropuestasPendientes` desde `manejarVerPropuesta`; los otros tres
 * quedan cableados para cuando la tarea 32 los use, sin placeholder.
 */
export function createPropuestaStore(db: Database.Database): PropuestaStorePort {
  return {
    crearPropuesta(input) {
      const row = insertPropuestaCambio(db, {
        id: input.id,
        casoId: input.casoId,
        ...(input.delegacionId !== undefined ? { delegacionId: input.delegacionId } : {}),
        baseCommit: input.baseCommit,
        ramaWorktree: input.ramaWorktree,
        patch: input.patch,
        patchBytes: input.resumen.patchBytes,
        archivos: input.resumen.archivos,
        lineasAgregadas: input.resumen.lineasAgregadas,
        lineasEliminadas: input.resumen.lineasEliminadas,
        ahora: input.createdAt,
      });
      return toPortPropuesta(row);
    },
    obtenerPropuesta(propuestaId) {
      const row = getPropuestaCambio(db, propuestaId);
      return row ? toPortPropuesta(row) : undefined;
    },
    listarPropuestasPendientes(filtro) {
      return listPropuestasCambio(db, { estado: PROPUESTA_ESTADO_PENDIENTE, ...filtro }).map(toPortPropuesta);
    },
    aplicarPropuesta(input) {
      const row = aplicarPropuestaCambio(db, input);
      return row ? toPortPropuesta(row) : undefined;
    },
    descartarPropuesta(input) {
      const row = descartarPropuestaCambio(db, input);
      return row ? toPortPropuesta(row) : undefined;
    },
  };
}

/**
 * `comando` de `registro_acciones_empleado` para cada `AccionSolicitud`
 * (Hito 5, tarea 23) — análoga a `ACCION_ESCALACION_INFO`, pero más chica:
 * a diferencia de `aprobar`/`rechazar`/`reabrir` reembolso, acá NO hay
 * `estadoOrigen`/`estadoCaso` que branchear en este archivo — esa transición
 * la resuelve enteramente `resolverSolicitudTransaccional` del lado del
 * store (`repository.ts`, tarea 19); este dispatcher solo necesita saber a
 * qué `comando` corresponde cada acción para la escritura FUERA de
 * transacción del motivo `MOTIVO_CAS` (ver `manejarResolucionSolicitud`).
 */
const ACCION_SOLICITUD_COMANDO: Record<AccionSolicitud, string> = {
  [ACCION_APROBAR_SOLICITUD]: COMANDO_APROBAR_SOLICITUD,
  [ACCION_RECHAZAR_SOLICITUD]: COMANDO_RECHAZAR_SOLICITUD,
};

/**
 * `comando` de `registro_acciones_empleado` para cada `AccionPropuesta`
 * (Hito 5.1, tarea 32) — mismo criterio que `ACCION_SOLICITUD_COMANDO`: la
 * transición CAS + fila de auditoría del camino feliz la resuelve
 * enteramente `resolverPropuestaTransaccional` del lado del store
 * (`repository.ts`, tarea 15); este dispatcher solo necesita el `comando`
 * para la escritura FUERA de transacción del motivo `MOTIVO_CAS` (ver
 * `manejarResolucionPropuesta`).
 */
const ACCION_PROPUESTA_COMANDO: Record<AccionPropuesta, string> = {
  [ACCION_APLICAR_PROPUESTA]: COMANDO_APLICAR_PROPUESTA,
  [ACCION_DESCARTAR_PROPUESTA]: COMANDO_DESCARTAR_PROPUESTA,
};

/**
 * Una línea por solicitud — mismo criterio que `formatearLineaEscalacion`.
 * Formato elegido (sin texto literal fijado por el diseño, tarea 23):
 * `id`, `solicitante`, `tipo`, `detalle`, `estado` y `caso` siempre; el
 * `dictamen` se agrega solo si existe (mismo binario que `confirmedAt` en
 * `formatearLineaEscalacion` — su ausencia es la traza de que el validador
 * no corrió o falló, ADR 49, no algo que deba imprimirse como vacío).
 */
function formatearLineaSolicitud(s: SolicitudInterna): string {
  const base = `- solicitud ${s.id} | solicitante ${s.solicitanteId} | tipo ${s.tipo} | detalle ${s.detalle} | estado ${s.estado} | caso ${s.casoId}`;
  return s.dictamen === undefined ? base : `${base} | dictamen ${s.dictamen}`;
}

function formatearListadoSolicitudes(items: readonly SolicitudInterna[]): string {
  if (items.length === 0) {
    return "No hay solicitudes para listar.";
  }
  return items.map(formatearLineaSolicitud).join("\n");
}

/**
 * Eco de confirmación de `/aprobar-solicitud`/`/rechazar-solicitud` (§6.4,
 * parte 2). A diferencia de `formatearEco` (reembolsos), NO recibe la
 * `accion`: no hay ninguna salvedad dominio-específica que dependa de ella
 * (el único caso análogo en reembolsos es `reabrir`, que agrega el dato de
 * quién rechazó antes) — `aprobar`/`rechazar` solicitud son simétricos en
 * el texto del eco, la diferencia vive enteramente en qué transición aplica
 * el CAS del lado del store.
 */
function formatearEcoSolicitud(solicitud: SolicitudInterna): string {
  return `solicitud ${solicitud.id} · tipo ${solicitud.tipo} · detalle ${solicitud.detalle} · caso ${solicitud.casoId} — repetí el comando para confirmar.`;
}

/**
 * Tipo de `casos.tipo` para `/consultar-kpi` (Hito 6, tarea 20, ADR 85).
 * Const de MÓDULO, no de `ventas-contract.ts`: mismo precedente que
 * `CASO_TIPO_SOLICITUD_INTERNA` (`core/solicitudes/crear-solicitud-interna.ts:56`),
 * que tampoco vive en el contrato compartido.
 */
const CASO_TIPO_CONSULTA_KPI = "consulta_kpi";

/**
 * Idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`/`build-on-soporte.ts:48`.
 * Duplicado a propósito, no un descuido: este módulo no importa esos
 * archivos únicamente para esta constante (regla no negociable de
 * `AGENTS.md`: solo se importa lo que hace falta, y `casos.estado` es un
 * TEXT abierto en el esquema) — mismo criterio que `registrar-venta.ts` ya
 * documenta para su propia copia.
 */
const CASO_ESTADO_ACTIVO = "activo";

/**
 * PURA, de módulo (Hito 6, tarea 20, ADR 85) — mismo lugar y mismo molde
 * que `formatearLineaEscalacion`/`formatearListado`/`formatearResumenPropuesta`.
 * TOTAL sobre los OCHO motivos: el `switch` es exhaustivo sobre
 * `MotivoDelegacionA2ANoCompletada` — SIN `default` — así que un motivo
 * nuevo del vocabulario sería un error de COMPILACIÓN, no un mensaje
 * genérico. Requirement literal del spec: dos motivos distintos nunca
 * comparten mensaje. NUNCA incluye el `detalle` crudo del adaptador — ese
 * ya viene truncado a 500 chars pero puede llevar cuerpo de respuesta ajeno.
 */
function mensajeDeMotivoA2A(reason: MotivoDelegacionA2ANoCompletada): string {
  switch (reason) {
    case "failed":
      return "El agente externo de KPIs/incidentes no pudo completar la consulta.";
    case "canceled":
      return "La consulta al agente externo de KPIs/incidentes fue cancelada antes de completarse.";
    case "rejected":
      return "El agente externo de KPIs/incidentes rechazó la consulta.";
    case "input-required":
      return "El agente externo de KPIs/incidentes necesita información adicional que este canal no puede proveer.";
    case "auth-required":
      return "El agente externo de KPIs/incidentes requiere una autenticación que este canal no puede completar.";
    case "timeout":
      return "La consulta al agente externo de KPIs/incidentes agotó el tiempo de espera.";
    case "transporte":
      return "No se pudo establecer comunicación con el agente externo de KPIs/incidentes.";
    case "protocolo":
      return "El agente externo de KPIs/incidentes respondió con un protocolo no reconocido.";
  }
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
  /** `comando-reporte-comisiones`, ADR 121 pto 1 (RD-55) — mismo molde inline que `credenciales`/`registro`. */
  const reporteStore: ReporteStorePort =
    deps.reporteStore ??
    {
      listComisionesPorPeriodo: (periodo) => listComisionesPorPeriodo(db, periodo),
      listVentasEnReembolsoPendiente: () => listVentasEnReembolsoPendiente(db),
    };
  const logEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) =>
    logTurnEvent(casoId, event, fields, logDeps);
  const solicitudStore: SolicitudStorePort = deps.solicitudStore ?? createSolicitudStore(db);
  const propuestaStore: PropuestaStorePort = deps.propuestaStore ?? createPropuestaStore(db);
  // Hito 6, tarea 20 (ADR 85 + ADR 82): `clienteA2A` NO tiene default — su
  // ausencia ES el interruptor apagado, resuelto una sola vez en `main.ts`.
  const { clienteA2A } = deps;
  const delegacionA2AStore: DelegacionA2AStorePort = deps.delegacionA2AStore ?? createDelegacionA2AStore(db);
  /**
   * Tarea 32, ADR 64 — `git apply --check`/`git apply` reales sobre el
   * checkout real (`repoRoot: process.cwd()`, mismo criterio que
   * `design.md` §6.1: `repoRoot` lo fija la composición, nunca un env var).
   * `logEvent` no hace nada acá a propósito: `verificarPatch`/`aplicarPatch`
   * (`src/adapters/git/worktree.ts`) NUNCA lo invocan — solo `cerrarWorktree`
   * lo usa, y este dispatcher no usa `WorktreePort` (§5.10 no abre worktrees,
   * solo aplica patches ya persistidos).
   */
  const aplicarPatch: AplicarPatchPort =
    deps.aplicarPatch ??
    createGitAdapter({
      repoRoot: process.cwd(),
      config: { ...resolveGitConfig(), worktreeRoot: resolveWorktreeConfig().worktreeRoot },
      logEvent: () => {},
    }).aplicarPatch;
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

  /**
   * Resolución de `/aprobar-solicitud`/`/rechazar-solicitud` en dos pasos
   * (Hito 5, tarea 23, §6.4 parte 2, ADR 36, ADR 55). Molde EXACTO de
   * `manejarEscalacion`, adaptado al dominio solicitud: delega toda la
   * lógica pura y síncrona a `resolverSolicitudInterna` (tarea 18) y al
   * CAS transaccional de `SolicitudStorePort` (tarea 19) — acá solo se
   * arma/compara/consume `confirmacionPendiente` (rama `dominio:
   * "solicitud"` de la unión, ADR 55) y se traduce el resultado a
   * `TuiTurnResult`.
   *
   * Escritura de `registrar(...)`: SOLO para `resultado: "no_aplicable"`
   * con `motivo: MOTIVO_CAS` — si el CAS hubiese matcheado, la fila ya
   * viajó DENTRO de la transacción SQL de `aprobarSolicitudInterna`/
   * `rechazarSolicitudInterna` (`repository.ts`, tarea 19,
   * `resolverSolicitudTransaccional`); si no hubo transacción (el CAS no
   * matcheó), no hay otra fila posible, así que se escribe FUERA, igual
   * que el molde de `manejarEscalacion` (líneas 389-403 de `v1.4.0`). Para
   * `MOTIVO_NO_ENCONTRADA` NO se registra: no hay `casoId` que
   * correlacionar (`resolver-solicitud-interna.ts`, ese branch no lo
   * incluye) y `resolverSolicitudInterna` ya logueó el evento
   * `solicitud-resolucion-no-aplicable` internamente — duplicarlo acá
   * sería una segunda escritura del mismo hecho.
   */
  function manejarResolucionSolicitud(
    accion: AccionSolicitud,
    solicitudIdInput: string | undefined,
    ahora: string,
  ): TuiTurnResult {
    const sesionActual = sesion as SesionEmpleado;

    if (solicitudIdInput === undefined) {
      const resultado = resolverSolicitudInterna(
        { accion, confirmado: false, sesion: sesionActual },
        { store: solicitudStore, newId, now, logEvent },
      );
      if (resultado.resultado !== "listado") {
        return sistema("No se pudo listar las solicitudes.");
      }
      return sistema(formatearListadoSolicitudes(resultado.items));
    }

    const coincide =
      confirmacionPendiente !== undefined &&
      confirmacionPendiente.dominio === "solicitud" &&
      confirmacionPendiente.solicitudId === solicitudIdInput &&
      confirmacionPendiente.accion === accion &&
      confirmacionPendiente.empleadoId === sesionActual.empleadoId;

    if (!coincide) {
      const resultado = resolverSolicitudInterna(
        { accion, solicitudId: solicitudIdInput, confirmado: false, sesion: sesionActual },
        { store: solicitudStore, newId, now, logEvent },
      );

      if (resultado.resultado === "no_aplicable") {
        return sistema(`No hay ninguna solicitud ${solicitudIdInput} pendiente de resolución.`);
      }
      if (resultado.resultado !== "requiere_confirmacion") {
        return sistema("No se pudo procesar ese comando.");
      }

      confirmacionPendiente = {
        dominio: "solicitud",
        accion,
        solicitudId: solicitudIdInput,
        casoId: resultado.item.casoId,
        empleadoId: sesionActual.empleadoId,
        expiraEn: new Date(Date.parse(ahora) + CONFIRMACION_TTL_MINUTOS * 60_000).toISOString(),
      };
      return sistema(formatearEcoSolicitud(resultado.item));
    }

    // Coincide: se CONSUME antes de ejecutar (ADR 36).
    confirmacionPendiente = undefined;
    const resultado = resolverSolicitudInterna(
      { accion, solicitudId: solicitudIdInput, confirmado: true, sesion: sesionActual },
      { store: solicitudStore, newId, now, logEvent },
    );

    if (resultado.resultado === "aplicada") {
      return sistema(`Listo: la solicitud ${solicitudIdInput} quedó ${resultado.estadoFinal}.`);
    }

    if (resultado.resultado === "no_aplicable") {
      if (resultado.motivo === MOTIVO_CAS && resultado.casoId !== undefined) {
        // La fila ya se hubiese escrito DENTRO de la transacción si el CAS
        // matcheaba; acá no hubo transacción, así que se escribe FUERA —
        // único caso en que este comando privilegiado pasa por `registrar`.
        registrar(
          {
            comando: ACCION_SOLICITUD_COMANDO[accion],
            casoId: resultado.casoId,
            resultado: RESULTADO_NO_APLICABLE,
          },
          ahora,
        );
      }
      return sistema("Esa solicitud ya no está pendiente: no se aplicó nada.");
    }

    return sistema("No se pudo procesar ese comando.");
  }

  /**
   * Una línea por propuesta — mismo criterio que `formatearLineaEscalacion`/
   * `formatearLineaSolicitud`: sin texto literal fijado por diseño (tarea
   * 31), muestra como mínimo `id`/`casoId`/`archivos`/líneas `+`/`-`/`estado`.
   */
  function formatearLineaPropuesta(p: PropuestaCambio): string {
    return `- propuesta ${p.id} | caso ${p.casoId} | archivos ${p.archivos} | +${p.lineasAgregadas}/-${p.lineasEliminadas} | estado ${p.estado}`;
  }

  function formatearListadoPropuestas(items: readonly PropuestaCambio[]): string {
    if (items.length === 0) {
      return "No hay propuestas para listar.";
    }
    return items.map(formatearLineaPropuesta).join("\n");
  }

  /**
   * Eco de confirmación de `/aplicar-propuesta`/`/descartar-propuesta`
   * (Hito 5.1, tarea 32, §5.10 parte 2). Requirement del spec
   * `propuesta-cambio-hitl`: "id, `base_commit`, archivos, `+N/-M`" — mismo
   * criterio que `formatearEco`/`formatearEcoSolicitud`, sin texto literal
   * fijado por diseño más allá de esos cuatro datos.
   */
  function formatearEcoPropuesta(p: PropuestaCambio): string {
    return `propuesta ${p.id} · caso ${p.casoId} · base ${p.baseCommit} · archivos ${p.archivos} · +${p.lineasAgregadas}/-${p.lineasEliminadas} — repetí el comando para confirmar.`;
  }

  /**
   * Resumen + patch paginado a `LINEAS_PAGINA_PATCH` líneas (§5.10, ADR 69).
   * `/ver-propuesta <id>` no tiene parámetro de página — SIEMPRE la primera
   * (primeras `LINEAS_PAGINA_PATCH` líneas del patch, partido por `\n`), con
   * una nota si hay más líneas de las mostradas. Formato de la nota: sin
   * literal fijado por diseño (tarea 31).
   */
  function formatearResumenPropuesta(p: PropuestaCambio): string {
    const lineas = p.patch.split("\n");
    const primeraPagina = lineas.slice(0, LINEAS_PAGINA_PATCH).join("\n");
    const resumen = `propuesta ${p.id} · caso ${p.casoId} · archivos ${p.archivos} · +${p.lineasAgregadas}/-${p.lineasEliminadas} · base ${p.baseCommit} · estado ${p.estado}`;
    const nota =
      lineas.length > LINEAS_PAGINA_PATCH
        ? `\n\n[…mostrando las primeras ${LINEAS_PAGINA_PATCH} de ${lineas.length} líneas del patch…]`
        : "";
    return `${resumen}\n\n${primeraPagina}${nota}`;
  }

  /**
   * `/ver-propuesta [propuestaId]` (Hito 5.1, tarea 31, §5.10 parte 1, ADR
   * 60 pto 1, ADR 69). UN SOLO PASO, de solo lectura — a diferencia de
   * `manejarEscalacion`/`manejarResolucionSolicitud`, esta función NUNCA
   * lee ni escribe `confirmacionPendiente` ni llama `registrar(...)`:
   * mostrar un patch es una lectura, punto. `privilegiado: true` ya lo
   * garantizó la guarda del preámbulo (§6.3 paso 6) — no se duplica acá.
   * `ahora` viaja en la firma por MISMA consistencia posicional que el
   * resto de los `manejarX` del switch de más abajo (todos reciben
   * `ahora`, mismo molde) — sin uso real: no hay TTL ni `registrar(...)`
   * que calcular en un camino de solo lectura.
   */
  function manejarVerPropuesta(
    comando: Extract<ComandoEmpleado, { tipo: "ver_propuesta" }>,
    ahora: string,
  ): TuiTurnResult {
    void ahora;
    if (comando.propuestaId === undefined) {
      const items = propuestaStore.listarPropuestasPendientes();
      return sistema(formatearListadoPropuestas(items));
    }

    const propuesta = propuestaStore.obtenerPropuesta(comando.propuestaId);
    if (propuesta === undefined) {
      return sistema(`No existe ninguna propuesta ${comando.propuestaId}.`);
    }
    return sistema(formatearResumenPropuesta(propuesta));
  }

  /**
   * `/consultar-kpi <consulta>` (Hito 6, tarea 20, ADR 85). UN SOLO PASO —
   * NUNCA lee ni escribe `confirmacionPendiente`, igual que
   * `manejarVerPropuesta`/`manejarSolicitud`. `privilegiado: true` ya lo
   * garantizó la guarda del preámbulo (paso 6): no se duplica acá.
   *
   * PRIMER llamador de producción del camino SÍNCRONO del ADR 74: awaitea
   * `despacharDelegacionA2A` y devuelve su `resultado` como texto del turno.
   *
   * Secuencia:
   *  a. `clienteA2A === undefined` ⇒ mensaje de "desactivado". SIN caso, SIN fila.
   *  b. `caso` NUEVO por invocación (`createCaso` directo, mismo molde que
   *     `buildOnSoporte`, paso 1): obligatorio, no cosmético —
   *     `delegaciones_a2a.caso_id` es NOT NULL REFERENCES casos(id).
   *  c. `await despacharDelegacionA2A(...)` con `resolverDestinoA2A(
   *     DESTINO_A2A_KPI_INCIDENTE)` y el insumo FIJO EN CÓDIGO (nunca del
   *     modelo, nunca de un prompt libre).
   *  d. éxito ⇒ `registrar(RESULTADO_ATENDIDA)` y se devuelve el texto.
   *  e. `catch` ÚNICO y EXPLÍCITO sobre b-c-d completo — mismo criterio que
   *     `manejarSoporte`/ADR 40 (la TUI no puede quedarse sin respuesta):
   *     una falla de `createCaso` (sin caso no hay nada que correlacionar)
   *     responde igual que una falla de la delegación.
   *     `DelegacionA2ANoCompletadaError` ⇒ `mensajeDeMotivoA2A(error.reason)`;
   *     cualquier otro throw ⇒ el mismo `toErrorMessage` que ya usa este
   *     archivo. En los dos casos se registra `RESULTADO_FALLIDA` y se
   *     emite un evento — NUNCA con el `detalle` crudo del error adentro.
   *
   * `agentLabel: "sistema"` — el texto viene de un tercero, no de un
   * subagente del arnés, y `agentLabel` nombra agentes de ESTE proceso.
   */
  async function manejarConsultarKpi(
    comando: Extract<ComandoEmpleado, { tipo: "consultar_kpi" }>,
    ahora: string,
  ): Promise<TuiTurnResult> {
    if (clienteA2A === undefined) {
      return sistema("La consulta a agentes externos de KPIs/incidentes está desactivada.");
    }

    const casoId = newId();
    try {
      createCaso(db, {
        id: casoId,
        tipo: CASO_TIPO_CONSULTA_KPI,
        estado: CASO_ESTADO_ACTIVO,
        createdAt: ahora,
        updatedAt: ahora,
      });

      const insumo: InsumoDelegado = {
        instruccion: "Consultá al agente externo de KPIs/incidentes y devolvé su respuesta tal cual.",
        material: comando.consulta,
      };

      const delegacion = await despacharDelegacionA2A(
        { casoId, destino: resolverDestinoA2A(DESTINO_A2A_KPI_INCIDENTE), insumo },
        { store: delegacionA2AStore, cliente: clienteA2A, newId, now, logEvent },
      );

      registrar({ comando: COMANDO_CONSULTAR_KPI, casoId, resultado: RESULTADO_ATENDIDA }, ahora);
      return sistema(delegacion.resultado);
    } catch (error) {
      const mensaje =
        error instanceof DelegacionA2ANoCompletadaError ? mensajeDeMotivoA2A(error.reason) : toErrorMessage(error);
      registrar({ comando: COMANDO_CONSULTAR_KPI, casoId, resultado: RESULTADO_FALLIDA }, ahora);
      logEvent(casoId, "comando-consultar-kpi-fallido", { message: mensaje });
      return sistema(mensaje);
    }
  }

  /**
   * Resolución de `/aplicar-propuesta`/`/descartar-propuesta` en dos pasos
   * (Hito 5.1, tarea 32, §5.10 parte 2, ADR 36, ADR 55, ADR 64, ADR 65).
   * Molde de `manejarResolucionSolicitud`, con dos diferencias impuestas por
   * el parser/ADR 64:
   *
   *  1. `propuestaId` es SIEMPRE `string` acá (`comando-empleado.ts` exige
   *     el argumento para ambos comandos) — a diferencia de reembolso/
   *     solicitud, NO hay rama "listar sin id".
   *  2. El segundo llamado de `aplicar` intercala DOS `await` a
   *     `AplicarPatchPort` alrededor de `resolverPropuestaCambio`:
   *     `verificar` (`git apply --check`) ANTES — fuera de cualquier
   *     escritura, con los bytes EXACTOS de
   *     `propuestaStore.listarPropuestasPendientes({ propuestaId })[0]`
   *     (`p` en design.md §4.2, no el `patchBytes` cacheado en
   *     `confirmacionPendiente`; filtrado por PENDIENTE — ADR 38, mismo
   *     criterio que usa `resolverPropuestaCambio` — y NO `obtenerPropuesta`
   *     sin filtro de estado, que dejaría correr `--check` contra una
   *     propuesta que otra persona ya resolvió entre el eco y esta
   *     confirmación, code review Hito 5.1 completo) — y `aplicar` (`git
   *     apply` real) DESPUÉS,
   *     solo si la transacción CAS (`resolverPropuestaCambio` con
   *     `confirmado: true`, que ya comitea vía `PropuestaStorePort.aplicarPropuesta`)
   *     devolvió `"aplicada"`. Un `--check` que falla NUNCA llega a
   *     `resolverPropuestaCambio`: cero escrituras, estado intacto (spec,
   *     escenario explícito) — evento `propuesta-conflicto`. Un `aplicar`
   *     que falla DESPUÉS del commit no propaga (`AplicarPatchPort` nunca
   *     rechaza, ADR 64): evento `propuesta-apply-fallido` + mensaje
   *     EXPLÍCITO al humano (RD-13, heredado, hecho visible).
   *
   * `descartar` NUNCA toca `aplicarPatch` — no hay patch que aplicar al
   * descartar; solo corre la transacción CAS a `descartada` con `motivo`.
   *
   * Escritura de `registrar(...)`: SOLO para `resultado: "no_aplicable"` con
   * `motivo: MOTIVO_CAS` (la carrera entre el `--check` y el commit, o el
   * CAS de `descartar` perdiendo) — mismo criterio que `manejarEscalacion`/
   * `manejarResolucionSolicitud`: si el CAS hubiese matcheado, la fila ya
   * viajó DENTRO de la transacción de `repository.ts` (tarea 15,
   * `resolverPropuestaTransaccional`).
   */
  async function manejarResolucionPropuesta(
    accion: AccionPropuesta,
    propuestaId: string,
    motivo: string | undefined,
    ahora: string,
  ): Promise<TuiTurnResult> {
    const sesionActual = sesion as SesionEmpleado;

    const coincide =
      confirmacionPendiente !== undefined &&
      confirmacionPendiente.dominio === "propuesta" &&
      confirmacionPendiente.propuestaId === propuestaId &&
      confirmacionPendiente.accion === accion &&
      confirmacionPendiente.empleadoId === sesionActual.empleadoId;

    if (!coincide) {
      const resultado = resolverPropuestaCambio(
        {
          accion,
          propuestaId,
          confirmado: false,
          sesion: sesionActual,
          ...(motivo !== undefined ? { motivo } : {}),
        },
        { store: propuestaStore, newId, now, logEvent },
      );

      if (resultado.resultado === "no_aplicable") {
        return sistema(`No hay ninguna propuesta ${propuestaId} pendiente de resolución.`);
      }
      if (resultado.resultado !== "requiere_confirmacion") {
        return sistema("No se pudo procesar ese comando.");
      }

      confirmacionPendiente = {
        dominio: "propuesta",
        accion,
        propuestaId,
        casoId: resultado.item.casoId,
        patchBytes: resultado.item.patchBytes,
        empleadoId: sesionActual.empleadoId,
        expiraEn: new Date(Date.parse(ahora) + CONFIRMACION_TTL_MINUTOS * 60_000).toISOString(),
      };
      return sistema(formatearEcoPropuesta(resultado.item));
    }

    // Coincide: se CONSUME antes de ejecutar (ADR 36).
    confirmacionPendiente = undefined;

    if (accion === ACCION_DESCARTAR_PROPUESTA) {
      const resultado = resolverPropuestaCambio(
        {
          accion,
          propuestaId,
          confirmado: true,
          sesion: sesionActual,
          ...(motivo !== undefined ? { motivo } : {}),
        },
        { store: propuestaStore, newId, now, logEvent },
      );

      if (resultado.resultado === "aplicada") {
        return sistema(`Listo: la propuesta ${propuestaId} quedó ${resultado.estadoFinal}.`);
      }
      if (resultado.resultado === "no_aplicable") {
        if (resultado.motivo === MOTIVO_CAS && resultado.casoId !== undefined) {
          registrar(
            {
              comando: ACCION_PROPUESTA_COMANDO[accion],
              propuestaId,
              casoId: resultado.casoId,
              resultado: RESULTADO_NO_APLICABLE,
            },
            ahora,
          );
        }
        return sistema("Esa propuesta ya no está pendiente: no se aplicó nada.");
      }
      return sistema("No se pudo procesar ese comando.");
    }

    // accion === ACCION_APLICAR_PROPUESTA — ADR 64: `verificar` ANTES de
    // cualquier escritura, con los bytes EXACTOS persistidos en la base.
    // Filtrado por PENDIENTE (ADR 38), mismo criterio que usa
    // `resolverPropuestaCambio` acá abajo — NO `obtenerPropuesta` sin filtro
    // de estado: esa fila puede seguir "existiendo" aunque ya haya sido
    // resuelta por otra persona entre el eco y esta confirmación, y correr
    // `--check` contra ese patch produce el mensaje ENGAÑOSO de "conflicto
    // con la base" para lo que en realidad es "ya resuelta" (code review,
    // Hito 5.1 completo).
    const propuesta = propuestaStore.listarPropuestasPendientes({ propuestaId })[0];
    if (propuesta === undefined) {
      return sistema("Esa propuesta ya no está pendiente: no se aplicó nada.");
    }

    const verificacion = await aplicarPatch.verificar(propuesta.patch);
    if (!verificacion.ok) {
      logEvent(propuesta.casoId, "propuesta-conflicto", {
        propuestaId,
        baseCommit: propuesta.baseCommit,
        ...(verificacion.detalle !== undefined ? { detalleChars: verificacion.detalle.length } : {}),
      });
      return sistema(
        `No se pudo aplicar la propuesta ${propuestaId}: el patch entra en conflicto con la base actual (base_commit ${propuesta.baseCommit}). La propuesta sigue pendiente de aprobación humana — actualizá el checkout y volvé a intentar.`,
      );
    }

    // `--check` pasó: recién ahora corre la transacción CAS (commit real en la base).
    const resultado = resolverPropuestaCambio(
      { accion, propuestaId, confirmado: true, sesion: sesionActual },
      { store: propuestaStore, newId, now, logEvent },
    );

    if (resultado.resultado === "no_aplicable") {
      if (resultado.motivo === MOTIVO_CAS && resultado.casoId !== undefined) {
        registrar(
          {
            comando: ACCION_PROPUESTA_COMANDO[accion],
            propuestaId,
            casoId: resultado.casoId,
            resultado: RESULTADO_NO_APLICABLE,
          },
          ahora,
        );
      }
      return sistema("Esa propuesta ya no está pendiente: no se aplicó nada.");
    }
    if (resultado.resultado !== "aplicada") {
      return sistema("No se pudo procesar ese comando.");
    }

    // La transacción ya hizo COMMIT acá — recién ahora corre `git apply` real
    // (ADR 64), SIEMPRE fuera de la transacción SQL.
    const aplicacion = await aplicarPatch.aplicar(propuesta.patch);
    if (!aplicacion.ok) {
      logEvent(propuesta.casoId, "propuesta-apply-fallido", { propuestaId, motivo: aplicacion.motivo });
      return sistema(
        `La propuesta ${propuestaId} quedó marcada como aplicada, pero el árbol de trabajo NO cambió (${aplicacion.motivo}). Revisá manualmente con git status y aplicá el patch a mano si corresponde.`,
      );
    }

    return sistema(
      `Listo: la propuesta ${propuestaId} quedó aplicada. ${propuesta.archivos} archivo(s) modificados, sin stagear — revisá con git status.`,
    );
  }

  /**
   * `/reporte-comisiones [periodo]` (comando-reporte-comisiones, ADR
   * 117/121/123/124). UN SOLO PASO, de solo lectura — mismo molde que
   * `manejarVerPropuesta`: nunca toca `confirmacionPendiente`, nunca es
   * `async` (sin `await` al modelo, sin transacción). `privilegiado: true`
   * ya lo garantizó el preámbulo (paso 6, guarda de privilegio) — no se
   * duplica acá.
   *
   * `resolverPeriodoReporte` corre ANTES de cualquier lectura: un período
   * inválido responde con su propio mensaje de uso y NO deja fila (ADR 123
   * pto 4) — mismo criterio que `manejarConsultarKpi` cuando `clienteA2A
   * === undefined` ("SIN caso, SIN fila").
   *
   * Devuelve LITERALMENTE `formatearReporteMensual(...)` sin envolver
   * (ADR 124): cualquier texto agregado del lado del comando rompería el
   * Success Criteria de igualdad byte a byte contra `npm run reporte:mensual`.
   */
  function manejarReporteComisiones(
    comando: Extract<ComandoEmpleado, { tipo: "reporte_comisiones" }>,
    ahora: string,
  ): TuiTurnResult {
    const resuelto = resolverPeriodoReporte(comando.periodo, ahora);
    if (!resuelto.ok) {
      return sistema(resuelto.mensaje); // SIN fila (ADR 123 pto 4) — corte ANTES de cualquier lectura.
    }

    const comisiones = reporteStore.listComisionesPorPeriodo(resuelto.periodo);
    const reembolsosPendientes = reporteStore.listVentasEnReembolsoPendiente();
    const reporte = agruparReporteMensual({ periodo: resuelto.periodo, comisiones, reembolsosPendientes });

    registrar({ comando: COMANDO_REPORTE_COMISIONES, resultado: RESULTADO_ATENDIDA }, ahora);
    return sistema(formatearReporteMensual(reporte));
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
      case "aprobar_solicitud":
        return manejarResolucionSolicitud(ACCION_APROBAR_SOLICITUD, comando.solicitudId, ahora);
      case "rechazar_solicitud":
        return manejarResolucionSolicitud(ACCION_RECHAZAR_SOLICITUD, comando.solicitudId, ahora);
      case "ver_propuesta":
        return manejarVerPropuesta(comando, ahora);
      case "consultar_kpi":
        return manejarConsultarKpi(comando, ahora);
      case "aplicar_propuesta":
        return manejarResolucionPropuesta(ACCION_APLICAR_PROPUESTA, comando.propuestaId, undefined, ahora);
      case "descartar_propuesta":
        return manejarResolucionPropuesta(ACCION_DESCARTAR_PROPUESTA, comando.propuestaId, comando.motivo, ahora);
      case "reporte_comisiones":
        return manejarReporteComisiones(comando, ahora);
      case "ayuda":
        return manejarAyuda(comando);
    }
  };
}
