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
  nombreComando,
  parsearComando,
  requiereAdministrador,
  type ComandoEmpleado,
} from "./core/commands/comando-empleado.js";
import {
  COMANDO_APLICAR_PROPUESTA,
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_ASIGNAR_ROL,
  COMANDO_CANCELAR_SOLICITUD,
  COMANDO_CONSULTAR_KPI,
  COMANDO_CREAR_EMPLEADO,
  COMANDO_DESCARTAR_PROPUESTA,
  COMANDO_DEVOLUCION,
  COMANDO_LOGIN,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_SOLICITAR,
  COMANDO_SOPORTE,
  COMANDO_VER_SOLICITUDES_A2A,
  RESULTADO_ATENDIDA,
  RESULTADO_AUTODEGRADACION_PROHIBIDA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_EXITOSA,
  RESULTADO_FALLIDA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_NO_AUTORIZADO,
  RESULTADO_REEMBOLSADA,
  type AccionEmpleado,
  type RegistroAccionesEmpleadoPort,
} from "./core/commands/registro-acciones-contract.js";
import { type AuthConfig } from "./core/auth/auth-config.js";
import { type CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import { resolverLogin } from "./core/auth/login.js";
import { sesionVigente, type SesionEmpleado } from "./core/auth/sesion.js";
import {
  ROLES_EMPLEADO,
  ROL_ADMINISTRADOR,
  type RolEmpleado,
  type RolEmpleadoEscritorPort,
  type RolEmpleadoPort,
} from "./core/auth/rol-contract.js";
import { esAdministrador } from "./core/auth/autorizacion-resolucion.js";
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
import { type AccionSolicitud } from "./core/solicitudes/resolver-solicitud-interna.js";
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
  esTaskStateConocido,
  type ClienteA2APort,
  type MotivoDelegacionA2ANoCompletada,
} from "./core/agents/a2a-contract.js";
import {
  LIMITE_LISTADO_A2A_ENTRANTES,
  LINEAS_PAGINA_A2A,
  TASK_STATES_EN_CURSO,
  type EstadoSolicitudA2AEntrante,
  type ListadoSolicitudesA2AEntrantes,
  type SolicitudA2AEntranteStorePort,
  type SolicitudA2AEntranteVistaEmpleado,
} from "./core/agents/a2a-entrante-contract.js";
import { type InsumoDelegado } from "./core/agents/subagents.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { createVentaStore, createDelegacionA2AStore } from "./build-on-venta.js";
import { createDelegacionStore } from "./build-on-activity.js";
import { altaCredencialEmpleado } from "./empleados.js";
import { createGitAdapter } from "./adapters/git/index.js";
import { resolveGitConfig, resolveWorktreeConfig } from "./adapters/git/config.js";
import { isWebhookEnabled, resolveWebhookConfig } from "./adapters/webhooks/config.js";
import { isBoardEnabled, resolveBoardConfig } from "./adapters/board/config.js";
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
  getSolicitudA2AEntrantePorTaskId,
  listSolicitudesA2AEntrantesPorEstado,
  buscarRolEmpleado,
  upsertRolEmpleado,
  type SolicitudRow,
  type PropuestaRow,
  type SolicitudA2AEntranteRow,
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
   * v3.4.0, `comando-visibilidad-a2a-entrante` tarea 4 — default:
   * `createSolicitudA2AEntranteStore(db)` (más abajo). Opcional para no
   * romper ningún fake existente de `Deps` en tests actuales.
   */
  readonly solicitudA2AEntranteStore?: SolicitudA2AEntranteStorePort;
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
  /**
   * `autorizacion-empleado`, ADR 161/162 — costura de test opcional, MISMO
   * molde que `credenciales`/`registro`/`reporteStore`: default construido
   * DENTRO de esta función, closure sobre `buscarRolEmpleado(db, ...)`.
   * `main.ts` NO la pasa explícitamente — verificado en `design.md` §7.
   */
  readonly rolPort?: RolEmpleadoPort;
  /**
   * `comandos-administracion-empleados`, ADR 180/RD-82 — costura de test
   * opcional, MISMO molde que `rolPort`: default `createRolEmpleadoEscritor(db)`.
   * `Deps.rolEscritor` opcional no rompe ningún fake existente. SIN
   * consumidor todavía — `/asignar-rol` (PR3, bloqueada) es quien lo llama.
   */
  readonly rolEscritor?: RolEmpleadoEscritorPort;
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
 * Traduce un `SolicitudA2AEntranteRow` de `repository.ts` a la
 * `SolicitudA2AEntranteVistaEmpleado` del puerto (v3.4.0, `comando-visibilidad-
 * a2a-entrante` tarea 4, ADR 141) — ★ donde vive el guard de vocabulario:
 * `esTaskStateConocido(row.estado)` decide la unión discriminada
 * `EstadoSolicitudA2AEntrante`. A diferencia de `toPortSolicitud`/
 * `toPortPropuesta` (arriba), **NO lanza**: éste es un camino de LECTURA
 * PURA y diagnóstico, no el CAS de escritura — un `throw` haría que una
 * sola fila corrupta apague el listado entero, exactamente el escenario
 * para el que este comando existe (ADR 141 pto 3). `agenteExternoUrl` e
 * `id` NO se copian: no están en el tipo del puerto (ADR 139 pto 3, R1
 * estructural).
 */
function toPortSolicitudA2AEntrante(row: SolicitudA2AEntranteRow): SolicitudA2AEntranteVistaEmpleado {
  const estado: EstadoSolicitudA2AEntrante = esTaskStateConocido(row.estado)
    ? { conocido: true, valor: row.estado }
    : { conocido: false, valor: row.estado };
  return {
    a2aTaskId: row.a2aTaskId,
    estado,
    origenTransporte: row.origenTransporte,
    ...(row.casoId !== undefined ? { casoId: row.casoId } : {}),
    mensajeRecibido: row.mensajeRecibido,
    ...(row.resultado !== undefined ? { resultado: row.resultado } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `SolicitudA2AEntranteStorePort` por closures sobre `repository.ts`
 * (v3.4.0, tarea 4) — molde exacto de `createPropuestaStore` de arriba:
 * delegaciones directas sin lógica de negocio propia, sólo traducción vía
 * `toPortSolicitudA2AEntrante`. `obtenerPorTaskId` envuelve
 * `getSolicitudA2AEntrantePorTaskId` — cero SQL nuevo (ADR 136).
 */
export function createSolicitudA2AEntranteStore(db: Database.Database): SolicitudA2AEntranteStorePort {
  return {
    listarPorEstados(filtro) {
      const { items, hayMas } = listSolicitudesA2AEntrantesPorEstado(db, {
        estados: filtro.estados,
        limite: filtro.limite ?? LIMITE_LISTADO_A2A_ENTRANTES,
      });
      return { items: items.map(toPortSolicitudA2AEntrante), hayMas };
    },
    obtenerPorTaskId(a2aTaskId) {
      const row = getSolicitudA2AEntrantePorTaskId(db, a2aTaskId);
      return row ? toPortSolicitudA2AEntrante(row) : undefined;
    },
  };
}

/**
 * `comandos-administracion-empleados` (ADR 180, RD-82) — escritor de rol,
 * co-ubicado con `RolEmpleadoPort` (lectura) en `rol-contract.ts`, SIN
 * tocarlo. Exportada, mismo molde que `createSolicitudStore`/
 * `createSolicitudA2AEntranteStore` arriba: permite probar el adaptador por
 * defecto contra un `db` real sin depender de un consumidor (`/asignar-rol`
 * llega en la PR3, bloqueada). `upsertRolEmpleado` (ADR 162) NO cambia de
 * firma — este adaptador es una línea sobre la función que ya existe.
 */
export function createRolEmpleadoEscritor(db: Database.Database): RolEmpleadoEscritorPort {
  return {
    asignarRol(input) {
      upsertRolEmpleado(db, input);
    },
  };
}

/**
 * Una línea por fila — molde de `formatearLineaPropuesta` (más abajo). El
 * rótulo es **`origen de transporte`**, nunca `agente` (R1, ADR 142 pto 1):
 * `origenTransporte` es una dirección de red observada por el transporte,
 * no una identidad de agente externo (`0011:18-20`). No exportada — sólo
 * la usa `formatearListadoSolicitudesA2A`, mismo criterio que
 * `formatearLineaPropuesta`/`formatearListadoPropuestas`.
 */
function formatearLineaSolicitudA2A(vista: SolicitudA2AEntranteVistaEmpleado): string {
  return `- tarea ${vista.a2aTaskId} | estado ${vista.estado.valor} | origen de transporte ${vista.origenTransporte} | recibida ${vista.createdAt} | actualizada ${vista.updatedAt}`;
}

/**
 * `formatearListadoSolicitudesA2A` (v3.4.0, `comando-visibilidad-a2a-
 * entrante` tarea 7, ADR 142 pto 1). Exportada — a diferencia de
 * `formatearListadoPropuestas`/`formatearResumenPropuesta` (más abajo,
 * anidadas en `buildOnComandoEmpleado`), ésta y
 * `formatearDetalleSolicitudA2A` viven a nivel de módulo porque la tarea 8
 * (el `case` del dispatcher que las cablea) todavía no existe: necesitan
 * ser testeables en forma directa, mismo criterio con el que la tarea 4
 * exportó `createSolicitudA2AEntranteStore`. Vacío ⇒ texto fijo; `hayMas
 * === true` ⇒ nota de truncado al final, molde de la nota de
 * `formatearResumenPropuesta`.
 */
export function formatearListadoSolicitudesA2A(listado: ListadoSolicitudesA2AEntrantes): string {
  if (listado.items.length === 0) {
    return "No hay solicitudes A2A entrantes en curso.";
  }
  const lineas = listado.items.map(formatearLineaSolicitudA2A).join("\n");
  const nota = listado.hayMas
    ? `\n\n[…mostrando las primeras ${listado.items.length}; hay más solicitudes en curso…]`
    : "";
  return `${lineas}${nota}`;
}

/**
 * Pagina `contenido` a `LINEAS_PAGINA_A2A` líneas — mecánica idéntica a
 * `formatearResumenPropuesta` (más abajo), aplicada dos veces de forma
 * independiente (`mensaje_recibido` y `resultado`, ADR 142 pto 2): cada
 * sección paga su propio tope de `LINEAS_PAGINA_A2A`, no un tope conjunto.
 */
function formatearSeccionPaginadaA2A(etiqueta: string, contenido: string): string {
  const lineas = contenido.split("\n");
  const primeraPagina = lineas.slice(0, LINEAS_PAGINA_A2A).join("\n");
  const nota =
    lineas.length > LINEAS_PAGINA_A2A
      ? `\n\n[…mostrando las primeras ${LINEAS_PAGINA_A2A} de ${lineas.length} líneas de ${etiqueta}…]`
      : "";
  return `\n\n${etiqueta}:\n${primeraPagina}${nota}`;
}

/**
 * `formatearDetalleSolicitudA2A` (v3.4.0, tarea 7, ADR 142 pto 2-3). Resumen
 * de una línea (mismos cinco campos que `formatearLineaSolicitudA2A`, con
 * el mismo rótulo `origen de transporte`) + `mensajeRecibido`/`resultado`
 * paginados a `LINEAS_PAGINA_A2A` líneas cada uno. `resultado` ausente ⇒
 * la sección se OMITE por completo — no se imprime vacía ni la palabra
 * `"undefined"` (mismo binario que el `dictamen` de `formatearLineaSolicitud`,
 * ADR 142 pto 3). Exportada por el mismo motivo que
 * `formatearListadoSolicitudesA2A` — ver comentario de esa función.
 */
export function formatearDetalleSolicitudA2A(vista: SolicitudA2AEntranteVistaEmpleado): string {
  const resumen = `solicitud A2A ${vista.a2aTaskId} · estado ${vista.estado.valor} · origen de transporte ${vista.origenTransporte} · recibida ${vista.createdAt} · actualizada ${vista.updatedAt}`;
  const mensaje = formatearSeccionPaginadaA2A("mensaje recibido", vista.mensajeRecibido);
  const resultado = vista.resultado !== undefined ? formatearSeccionPaginadaA2A("resultado", vista.resultado) : "";
  return `${resumen}${mensaje}${resultado}`;
}

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
  /** `autorizacion-empleado`, ADR 161/162 — mismo molde inline que `credenciales`/`registro`. */
  const rolPort: RolEmpleadoPort =
    deps.rolPort ??
    {
      buscarRol: (empleadoId) => {
        const row = buscarRolEmpleado(db, empleadoId);
        return row ? (row.rol as RolEmpleado) : undefined;
      },
    };
  /** `comandos-administracion-empleados`, ADR 180/RD-82 — mismo molde inline que `rolPort`. */
  const rolEscritor: RolEmpleadoEscritorPort = deps.rolEscritor ?? createRolEmpleadoEscritor(db);
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
  /** v3.4.0, `comando-visibilidad-a2a-entrante` tarea 8 — default: `createSolicitudA2AEntranteStore(db)`. */
  const solicitudA2AEntranteStore: SolicitudA2AEntranteStorePort =
    deps.solicitudA2AEntranteStore ?? createSolicitudA2AEntranteStore(db);
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
        { store, newId, now, logEvent, rolPort },
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
        { store, newId, now, logEvent, rolPort },
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
      { store, newId, now, logEvent, rolPort },
    );

    if (resultado.resultado === "aplicada") {
      return sistema(
        `Listo: la venta ${ventaIdInput} quedó en ${resultado.estadoFinal} y el caso ${resultado.venta.casoId} en ${ACCION_ESCALACION_INFO[accion].estadoCaso}.`,
      );
    }

    if (resultado.resultado === "no_autorizado") {
      registrar(
        {
          comando: ACCION_ESCALACION_INFO[accion].comando,
          ventaId: ventaIdInput,
          casoId: resultado.casoId,
          resultado: RESULTADO_NO_AUTORIZADO,
        },
        ahora,
      );
      return sistema(`No estás autorizado para ${accion} esa escalación de reembolso: se requiere rol elevado.`);
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
   * `cancelar_solicitud` (`ComandoEmpleado`) sigue existiendo como tipo,
   * pero SIN descriptor propio desde `operaciones-negocio-conversacionales`
   * (tarea 14, código muerto preexistente) — y ahora, con la baja de
   * `manejarResolucionSolicitud` (`aprobacion-conversacional-hitl`, ADR 210
   * pto 1, tarea 10: `/aprobar-solicitud`/`/rechazar-solicitud` se
   * resuelven vía `resolver_solicitud`, ADR 206), este handler tampoco
   * tiene mecanismo propio que reimplementar — es inalcanzable desde
   * `parsearComando` (`switch (comando.tipo)` de más abajo lo exige sólo
   * por exhaustividad de tipos).
   */
  function manejarCancelarSolicitudInalcanzable(): TuiTurnResult {
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
   * `/ver-solicitudes-a2a [a2aTaskId]` (v3.4.0, `comando-visibilidad-a2a-
   * entrante` tarea 8, ADR 134/143). Molde LITERAL de `manejarVerPropuesta`
   * de arriba: UN SOLO PASO, SÍNCRONO, sin `await`, sin `createCaso`, y
   * NUNCA lee ni escribe `confirmacionPendiente` — mostrar filas que ya
   * existen es una lectura, punto. `privilegiado: true` ya lo garantizó la
   * guarda del preámbulo (paso 6): no se duplica acá.
   *
   * ÚNICA diferencia con el molde: `registrar(...)` (ADR 143, revertido por
   * el checkpoint) — `RESULTADO_ATENDIDA` cuando hay algo que mostrar
   * (listado o detalle encontrado), `RESULTADO_NO_APLICABLE` cuando el id
   * no existe, para que la auditoría distinga una divulgación de contenido
   * de un id mal tipeado (ADR 138 pto 2). `casoId` viaja SOLO en modo
   * detalle (varias filas en el listado, ninguna es "el" caso).
   */
  function manejarVerSolicitudesA2A(
    comando: Extract<ComandoEmpleado, { tipo: "ver_solicitudes_a2a" }>,
    ahora: string,
  ): TuiTurnResult {
    if (comando.a2aTaskId === undefined) {
      const listado = solicitudA2AEntranteStore.listarPorEstados({ estados: TASK_STATES_EN_CURSO });
      registrar({ comando: COMANDO_VER_SOLICITUDES_A2A, resultado: RESULTADO_ATENDIDA }, ahora);
      return sistema(formatearListadoSolicitudesA2A(listado));
    }

    const vista = solicitudA2AEntranteStore.obtenerPorTaskId(comando.a2aTaskId);
    if (vista === undefined) {
      registrar({ comando: COMANDO_VER_SOLICITUDES_A2A, resultado: RESULTADO_NO_APLICABLE }, ahora);
      return sistema(`No existe ninguna solicitud A2A ${comando.a2aTaskId}.`);
    }
    registrar(
      {
        comando: COMANDO_VER_SOLICITUDES_A2A,
        ...(vista.casoId !== undefined ? { casoId: vista.casoId } : {}),
        resultado: RESULTADO_ATENDIDA,
      },
      ahora,
    );
    return sistema(formatearDetalleSolicitudA2A(vista));
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

  /**
   * `/estado-bot-prs` (comandos-administracion-empleados, tarea 3, ADR
   * 185) — enmienda del checkpoint al diferido del ADR 178 de esa misma
   * propuesta. Solo lectura, cero escrituras: `resolveWebhookConfig`/
   * `isWebhookEnabled` y `resolveBoardConfig`/`isBoardEnabled` YA EXISTEN
   * (`src/adapters/webhooks/config.ts`, `src/adapters/board/config.ts`) —
   * sin puerto nuevo. Nunca imprime `GITHUB_WEBHOOK_SECRET` ni
   * `GITHUB_TOKEN`: sólo el booleano de presencia y, si el listener está
   * habilitado, el puerto/path (configuración no sensible). Sin
   * `registrar()`: es una lectura, `privilegiado: true` (guarda de sesión
   * del preámbulo, paso 6) ya la protege, y el descriptor no exige rol
   * administrador — no hay secreto ni escritura que gatear por rol. El
   * dispatcher NO consulta ningún campo de rol para este comando todavía
   * (ese gate llega en la PR2, bloqueada).
   */
  function manejarEstadoBotPrs(): TuiTurnResult {
    const webhook = resolveWebhookConfig();
    const board = resolveBoardConfig();
    const listener = isWebhookEnabled(webhook)
      ? `escuchando en :${webhook.port}${webhook.path}`
      : "deshabilitado (sin GITHUB_WEBHOOK_SECRET)";
    return sistema(`Bot de PRs — listener: ${listener}. GITHUB_TOKEN: ${isBoardEnabled(board) ? "presente" : "ausente"}.`);
  }

  /**
   * `comandos-administracion-empleados` (ADR 175 pto 4, 177, 182, 184,
   * tarea 7) — se llega acá SOLO con sesión vigente (paso 6) y rol
   * `administrador` ya confirmado (paso 6.5): esta función no vuelve a
   * chequear ninguno de los dos.
   *
   * Orden de validación, en el orden exacto de `tasks.md` tarea 7: (1) `rol`
   * contra `ROLES_EMPLEADO` — el parser NO lo valida (ADR 177 pto 2); (2)
   * `empleadoId` tiene credencial — sin eso no hay a quién autenticar
   * (mismo criterio que ADR 160/RD-79 del CLI); (3) ★ auto-degradación
   * PROHIBIDA SIN CONTEO (ADR 182) — el propio actor no puede asignarse un
   * rol distinto de `administrador` a sí mismo, sin importar cuántos
   * administradores existan. Las validaciones (1) y (2) NO dejan fila de
   * auditoría (son errores de entrada, no un intento de acción evaluado);
   * (3) SÍ deja fila `autodegradacion_prohibida` — es un intento real,
   * rechazado por política.
   */
  function manejarAsignarRol(comando: Extract<ComandoEmpleado, { tipo: "asignar_rol" }>, ahora: string): TuiTurnResult {
    if (!(ROLES_EMPLEADO as readonly string[]).includes(comando.rol)) {
      return sistema(`Rol inválido: "${comando.rol}". Roles válidos: ${ROLES_EMPLEADO.join(" | ")}.`);
    }
    const rol = comando.rol as RolEmpleado;

    if (credenciales.buscarCredencial(comando.empleadoId) === undefined) {
      return sistema(`No existe el empleado "${comando.empleadoId}".`);
    }

    const empleadoIdActor = (sesion as SesionEmpleado).empleadoId;
    if (comando.empleadoId === empleadoIdActor && rol !== ROL_ADMINISTRADOR) {
      registrar({ comando: COMANDO_ASIGNAR_ROL, resultado: RESULTADO_AUTODEGRADACION_PROHIBIDA }, ahora);
      return sistema("No podés quitarte a vos mismo el rol de administrador.");
    }

    rolEscritor.asignarRol({ empleadoId: comando.empleadoId, rol, ahora });
    registrar({ comando: COMANDO_ASIGNAR_ROL, resultado: RESULTADO_EXITOSA }, ahora);
    return sistema(`Rol de ${comando.empleadoId} asignado: ${rol}.`);
  }

  /**
   * `comandos-administracion-empleados` (ADR 174, 181, 184, tarea 8) — se
   * llega acá SOLO con sesión vigente (paso 6) y rol `administrador` ya
   * confirmado (paso 6.5). Reusa `altaCredencialEmpleado` (tarea 1,
   * `src/empleados.ts`) — MISMA validación de forma, MISMO hash scrypt y
   * MISMO mensaje de duplicado que el CLI (`empleados:crear`). ★ La
   * contraseña NUNCA llega a `registrar()` — sólo `comando`/`resultado`, ni
   * siquiera en el camino de error (invariante estructural de
   * `AccionEmpleado`, `registro-acciones-contract.ts`).
   */
  function manejarCrearEmpleado(
    comando: Extract<ComandoEmpleado, { tipo: "crear_empleado" }>,
    ahora: string,
  ): TuiTurnResult {
    const resultado = altaCredencialEmpleado(db, { empleadoId: comando.empleadoId, password: comando.password, ahora });
    if (!resultado.ok) {
      return sistema(resultado.mensaje);
    }
    registrar({ comando: COMANDO_CREAR_EMPLEADO, resultado: RESULTADO_EXITOSA }, ahora);
    return sistema(`Empleado ${comando.empleadoId} creado.`);
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

    // 6.5. Gate de administrador (comandos-administracion-empleados, ADR
    // 175/183 parte 2, RD-84) — SEGUNDO eje de gateo, DISTINTO de
    // `privilegiado` (paso 6, arriba, sin cambios): ese exige sólo sesión
    // vigente, éste exige además rol `administrador`. Corre DESPUÉS de la
    // guarda de sesión: sin sesión, el rechazo ya ocurrió en el paso 6 y el
    // rol nunca se consulta. `empleadoId` sale de `sesion`, nunca del
    // comando tipeado (ADR 37) — la sesión ya está garantizada acá para
    // todo comando `requiereAdministrador: true`, porque esos comandos son
    // SIEMPRE `privilegiado: true` también (ADR 177 pto 3).
    if (requiereAdministrador(comando.tipo)) {
      const empleadoId = (sesion as SesionEmpleado).empleadoId;
      if (!esAdministrador(rolPort, empleadoId)) {
        logEvent(COMANDO_LOG_CORRELATION_ID, "comando-administrativo-no-autorizado", {
          tipo: comando.tipo,
          empleadoId,
        });
        registrar({ comando: nombreComando(comando.tipo), resultado: RESULTADO_NO_AUTORIZADO }, ahora);
        return sistema("Ese comando requiere rol administrador.");
      }
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
      case "cancelar_solicitud":
        return manejarCancelarSolicitudInalcanzable();
      case "ver_propuesta":
        return manejarVerPropuesta(comando, ahora);
      case "ver_solicitudes_a2a":
        return manejarVerSolicitudesA2A(comando, ahora);
      case "consultar_kpi":
        return manejarConsultarKpi(comando, ahora);
      case "aplicar_propuesta":
        return manejarResolucionPropuesta(ACCION_APLICAR_PROPUESTA, comando.propuestaId, undefined, ahora);
      case "descartar_propuesta":
        return manejarResolucionPropuesta(ACCION_DESCARTAR_PROPUESTA, comando.propuestaId, comando.motivo, ahora);
      case "reporte_comisiones":
        return manejarReporteComisiones(comando, ahora);
      case "estado_bot_prs":
        return manejarEstadoBotPrs();
      case "asignar_rol":
        return manejarAsignarRol(comando, ahora);
      case "crear_empleado":
        return manejarCrearEmpleado(comando, ahora);
      case "ayuda":
        return manejarAyuda(comando);
    }
  };
}
