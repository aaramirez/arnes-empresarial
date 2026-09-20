/**
 * Wiring por turno del turno de empleado autenticado con operaciones de
 * negocio (`operaciones-negocio-conversacionales`, ADR 167/172/173, tarea
 * 5). Hermano de `build-on-soporte.ts` — mismo molde EXACTO (module doc de
 * ese archivo tiene el razonamiento completo que no se repite acá): vive en
 * `src/`, no dentro de ningún adaptador ni de `core/`, porque importa TANTO
 * de `src/core/*` COMO de `src/adapters/memory/repository.ts` (`createCaso`
 * directo) y reusa dos closures de construcción (`createVentaStore`,
 * `createSolicitudStore`) ya expuestas por sus módulos hermanos
 * (`build-on-venta.ts`, `build-on-comando-empleado.ts`).
 *
 * `sesion`/`confirmacion` viajan como argumento de la función DEVUELTA, no
 * del closure de construcción (ADR 167 §6 pto 2) — a diferencia de
 * `createKnowledge` en `buildOnSoporte` (que cierra sobre un `casoId` fijo
 * por turno), acá `sesion` cambia con cada `/login` y `confirmacion`
 * necesita leer/escribir un estado vivo por-empleado (`confirmacion-
 * operaciones-store.ts`, tarea 8, Unit 3 — este módulo no construye esa
 * implementación, solo consume la interfaz `ConfirmacionOperacionPort`
 * declarada en `operaciones-contract.ts`).
 *
 * `candidateAgents: [construirAgenteEmpleadoOperaciones()]` (ADR 164 pto 2):
 * lista de UN elemento, nunca leída de `AGENT_REGISTRY` — mismo mecanismo
 * que `buildOnSoporte` ya usa pasando `agents` explícito a `handleTurn`.
 *
 * `mcpServers` es la UNIÓN EXACTA de dos servidores construidos POR TURNO: el
 * de la tool `operaciones` (`adapters/operaciones/index.ts`, vía
 * `createOperacionesAdapter`) y el de conocimiento (`adapters/knowledge/index.ts`,
 * vía `createKnowledge(casoId)` — `conocimiento-chat-empleado`, ADR 234). El
 * "gap conocido R3" que este doc-comment declaraba —la tool de conocimiento
 * listada en `allowedTools` por el spread de `CONVERSATIONAL_AGENT` pero sin
 * servidor registrado para este turno, o sea inalcanzable en runtime— queda
 * CERRADO. La frontera de autorización sigue siendo `mcpServers` por turno,
 * nunca `allowedTools` (ADR 176): `mcp__consultas__consultar_negocio` sigue
 * listada y sigue SIN servidor, deliberadamente.
 *
 * `knowledgeFeedback` NO se pasa, a diferencia de `buildOnSoporte` y
 * `buildOnA2AEntrante` (ADR 235): `feedback.saveTurnResult` escribe
 * `graphify-out/memory/*.md`, que `POST /soporte` sirve SIN autenticación y que
 * el turno A2A entrante sirve a terceros — cablearlo convertiría este canal
 * autenticado, cuyo `answer` puede traer `clienteId`, montos y `ventaId`, en
 * escritor de un almacén público. Hay un test que FALLA si alguien lo "completa"
 * por simetría. El `CitedNodesRecorder` es por instancia de `KnowledgeAdapter`
 * (`adapters/knowledge/index.ts:81`) y acá hay una por turno: no drenarlo no
 * filtra nada entre turnos.
 *
 * PROPAGA `TurnFailedError` — igual que `buildOnSoporte`: hay un caller
 * esperando (HTTP, `POST /operaciones`, tarea 9) y este módulo no decide
 * cómo se traduce esa falla, solo la deja pasar.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { construirAgenteEmpleadoOperaciones } from "./core/agents/definitions.js";
import { buildOperacionesEmpleadoPrompt } from "./core/ventas/soporte-prompt.js";
import {
  buscarRolEmpleado,
  buscarSolicitudPropiaPorId,
  buscarVentaPropiaPorId,
  createCaso,
  insertAccionEmpleado,
  insertJustificacionDevolucion,
  listComisionesPorPeriodo,
  listSolicitudesPropiasDeSolicitante,
  listVentasEnReembolsoPendiente,
  listVentasPropiasDeVendedor,
  type SolicitudPropiaRow,
  type VentaPropiaRow,
} from "./adapters/memory/repository.js";
import { createOperacionesAdapter } from "./adapters/operaciones/index.js";
import { ejecutarOperacion, type EjecutarOperacionDeps, type EjecutarOperacionInput } from "./core/operaciones/ejecutar-operacion.js";
import type { ConfirmacionOperacionPort } from "./core/operaciones/operaciones-contract.js";
import type { ClienteA2APort } from "./core/agents/a2a-contract.js";
import type { ConversacionEmpleadoPort } from "./core/conversacion/conversacion-contract.js";
import type { SesionEmpleado } from "./core/auth/sesion.js";
import type { RolEmpleado, RolEmpleadoPort } from "./core/auth/rol-contract.js";
import { type VentasConfig } from "./core/ventas/ventas-config.js";
import {
  VENTA_ESTADOS,
  type ConsultaRiesgoCreditoPort,
  type VentaEstado,
  type VentaNotifierPort,
} from "./core/ventas/ventas-contract.js";
import { type ConsultaVentaPropiaPort, type VentaPropia } from "./core/ventas/consulta-venta-contract.js";
import { type JustificacionDevolucionPort } from "./core/ventas/justificacion-devolucion-contract.js";
import { type ReporteStorePort } from "./core/ventas/reporte-contract.js";
import { type RegistroAccionesEmpleadoPort } from "./core/commands/registro-acciones-contract.js";
import { type DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";
import { createDelegacionA2AStore, createVentaStore, VentaEstadoInvalidoError } from "./build-on-venta.js";
import { createSolicitudA2AEntranteStore, createSolicitudStore, SolicitudTipoEstadoInvalidoError } from "./build-on-comando-empleado.js";
import { SOLICITUD_ESTADOS, SOLICITUD_TIPOS } from "./core/solicitudes/solicitudes-contract.js";
import { type ConsultaSolicitudPropiaPort, type SolicitudPropia } from "./core/solicitudes/consulta-solicitud-propia-contract.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";

/**
 * Valor propio de `casos.tipo` para este turno — DUPLICADO a propósito,
 * nunca centralizado en `ventas-contract.ts` (mismo criterio que
 * `CASO_ESTADO_ACTIVO` en `build-on-soporte.ts`): es un detalle de
 * implementación de este único módulo, no vocabulario compartido.
 */
const CASO_TIPO_OPERACIONES = "operaciones";
/** Idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`/`build-on-soporte.ts` — duplicado local a propósito (AGENTS.md). */
const CASO_ESTADO_ACTIVO = "activo";

export interface BuildOnOperacionesEmpleadoDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  /**
   * La MISMA fábrica por `casoId` que `main.ts` ya reparte a la TUI, a
   * `/soporte`, a los webhooks y al turno A2A entrante — un `KnowledgeAdapter`
   * por turno (ADR 234 pto 3), nunca uno por proceso. De lo que devuelve, este
   * módulo consume SÓLO `mcpServers`: `feedback` NO se cablea (ADR 235).
   */
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  readonly ventasConfig: VentasConfig;
  /** Exigido por tipo por `registrarVenta` (ADR 171 pto 5) — reusa la MISMA instancia que `main.ts` construye para `buildOnVenta`. */
  readonly notifier: VentaNotifierPort;
  /** Ídem — reusa `webConfig.publicUrl`. */
  readonly baseUrlPublica: string;
  /** Ídem, opcional — ausente ⇒ `registrarVenta` se comporta como si A2A saliente estuviera apagado. */
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
  /** `consulta-kpi-a2a-chat`, ADR 245 pto 4 — ausente ⇒ A2A saliente apagado (el tipo es el interruptor). */
  readonly clienteA2A?: ClienteA2APort;
  /** ADR 174 — ausente ⇒ default inline IDÉNTICO al de `build-on-comando-empleado.ts` (closures sobre `db`). */
  readonly reporteStore?: ReporteStorePort;
  /** ADR 188 pto 2 (Enmienda 1) — ausente ⇒ default inline byte-idéntico al de `build-on-comando-empleado.ts:868-869` (closure sobre `db`). */
  readonly registro?: RegistroAccionesEmpleadoPort;
  readonly despacharDeps: DespacharDelegacionDeps;
  readonly newId?: () => string; // default: randomUUID
  readonly newToken?: () => string; // default: randomUUID
  readonly now?: () => string; // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;
}

export interface OperacionesEmpleadoResult {
  readonly casoId: string;
  readonly respuesta: string;
}

/**
 * Traduce una fila `VentaPropiaRow` de `repository.ts` (`estado` como
 * `string` suelto) a la `VentaPropia` del puerto (`estado: VentaEstado`,
 * unión literal) — molde exacto de `toPortVenta` (`build-on-venta.ts`),
 * reusando `VentaEstadoInvalidoError` de ese mismo módulo en vez de declarar
 * una variante propia (`devolucion-sin-token-dos-personas`, ADR 227 pto 4).
 */
function toPortVentaPropia(row: VentaPropiaRow): VentaPropia {
  const estadoValido = (VENTA_ESTADOS as readonly string[]).includes(row.estado);
  if (!estadoValido) {
    throw new VentaEstadoInvalidoError(row.ventaId, row.estado);
  }
  return {
    ...row,
    estado: row.estado as VentaEstado,
  };
}

/**
 * Traduce un `SolicitudPropiaRow` de `repository.ts` (`tipo`/`estado` como
 * `string` suelto) a la `SolicitudPropia` del puerto (`tipo`/`estado` como
 * uniones literales) — molde exacto de `toPortVentaPropia`, reusando el
 * MISMO `SolicitudTipoEstadoInvalidoError` que `toPortSolicitud`
 * (`build-on-comando-empleado.ts`) en vez de declarar una variante propia
 * (`consulta-solicitud-propia`, RD-114 pto 2).
 */
function toPortSolicitudPropia(row: SolicitudPropiaRow): SolicitudPropia {
  const tipoValido = (SOLICITUD_TIPOS as readonly string[]).includes(row.tipo);
  const estadoValido = (SOLICITUD_ESTADOS as readonly string[]).includes(row.estado);
  if (!tipoValido || !estadoValido) {
    throw new SolicitudTipoEstadoInvalidoError(row.solicitudId, row.tipo, row.estado);
  }
  return {
    ...row,
    tipo: row.tipo as SolicitudPropia["tipo"],
    estado: row.estado as SolicitudPropia["estado"],
  };
}

/**
 * Devuelve el handler `(input) => Promise<OperacionesEmpleadoResult>` —
 * agnóstico del caller (ADR 172 pto 7): no sabe ni le importa si lo invoca
 * HTTP (`POST /operaciones`, tarea 9) o cualquier otro transporte futuro.
 *
 * Secuencia exacta (molde `buildOnSoporte`):
 *  1. `casoId = newId()`; `createCaso(db, {...})`. PROPAGA si falla.
 *  2. `prompt = buildOperacionesEmpleadoPrompt(input.consulta)` — PURO.
 *  3. `candidateAgents = [construirAgenteEmpleadoOperaciones()]` — lista de
 *     UN elemento (ADR 164 pto 2), nunca `AGENT_REGISTRY`.
 *  4. Arma `EjecutarOperacionDeps` (closures sobre `db`, mismas instancias
 *     compartidas para `notifier`/`baseUrlPublica`/`riesgoCredito`/
 *     `reporteStore`/`despacharDeps` que recibe por parámetro) y
 *     `ejecutar = (input) => ejecutarOperacion(input, ejecutarDeps)`.
 *  5. `knowledge = createKnowledge(casoId)` (`conocimiento-chat-empleado`,
 *     ADR 234 — un `KnowledgeAdapter` por turno, nunca por proceso).
 *  6. `operacionesAdapter = createOperacionesAdapter({ casoId, sesion:
 *     input.sesion, confirmacion: input.confirmacion, ejecutar })`.
 *  7. `handleTurn(casoId, prompt, { memory, hooks, candidateAgents,
 *     ...(logDeps ? {logDeps} : {}), mcpServers: { ...knowledge.mcpServers,
 *     ...operacionesAdapter.mcpServers } })` — `knowledgeFeedback` NO se pasa
 *     (ADR 235, ver doc-comment de módulo más arriba).
 *  8. Devuelve `{ casoId, respuesta: result.responseText }`.
 */
export function buildOnOperacionesEmpleado(
  deps: BuildOnOperacionesEmpleadoDeps,
): (input: {
  readonly consulta: string;
  readonly sesion: SesionEmpleado;
  readonly confirmacion: ConfirmacionOperacionPort;
  /** `chat-web-empleado`, ADR 196 pto 5 — memoria conversacional, viaja como argumento de la función DEVUELTA, no del closure de construcción (mismo criterio que `sesion`/`confirmacion`). */
  readonly conversacion: ConversacionEmpleadoPort;
}) => Promise<OperacionesEmpleadoResult> {
  const { db, memory, hooks, createKnowledge, ventasConfig, notifier, baseUrlPublica, despacharDeps, logDeps } = deps;
  const newId = deps.newId ?? randomUUID;
  const newToken = deps.newToken ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());

  const store = createVentaStore(db);
  const solicitudStore = createSolicitudStore(db);
  /** `visibilidad-a2a-entrante-chat`, ADR 240-242 — mismo molde que `solicitudStore`. */
  const solicitudA2AEntrante = createSolicitudA2AEntranteStore(db);
  /** `consulta-kpi-a2a-chat`, design §7 pto 6 — closures sobre `db`, siempre construible (mismo store que `build-on-comando-empleado.ts`). */
  const delegacionA2AStore = createDelegacionA2AStore(db);
  /** Mismo molde inline que `build-on-comando-empleado.ts` — `cancelar_solicitud_interna` nunca evalúa el gate de rol (bypass estructural, `esAccionAutoservicio`), pero `ResolverSolicitudDeps.rolPort` es un campo requerido del tipo. */
  const rolPort: RolEmpleadoPort = {
    buscarRol: (empleadoId) => {
      const row = buscarRolEmpleado(db, empleadoId);
      return row ? (row.rol as RolEmpleado) : undefined;
    },
  };
  /** ADR 174 — mismo molde inline que `build-on-comando-empleado.ts` cuando no se inyecta explícito. */
  const reporteStore: ReporteStorePort =
    deps.reporteStore ?? {
      listComisionesPorPeriodo: (periodo) => listComisionesPorPeriodo(db, periodo),
      listVentasEnReembolsoPendiente: () => listVentasEnReembolsoPendiente(db),
    };
  /** ADR 188 pto 2 — mismo molde inline que `build-on-comando-empleado.ts:868-869` cuando no se inyecta explícito. */
  const registro: RegistroAccionesEmpleadoPort =
    deps.registro ?? { registrarAccion: (accion) => insertAccionEmpleado(db, accion) };
  /** `devolucion-sin-token-dos-personas`, ADR 225/227 — mismo molde inline que `reporteStore`. */
  const consultaVentaPropia: ConsultaVentaPropiaPort = {
    buscarPorId: (ventaId) => {
      const row = buscarVentaPropiaPorId(db, ventaId);
      return row ? toPortVentaPropia(row) : undefined;
    },
    listarDeVendedor: (filtro) => listVentasPropiasDeVendedor(db, filtro).map(toPortVentaPropia),
  };
  /** `devolucion-sin-token-dos-personas`, ADR 228 pto 6 — mismo molde inline que `consultaVentaPropia`. */
  const justificacion: JustificacionDevolucionPort = {
    registrar: (input) => insertJustificacionDevolucion(db, input),
  };
  /** `consulta-solicitud-propia`, RD-115 pto 4 — mismo molde inline que `consultaVentaPropia`. */
  const consultaSolicitudPropia: ConsultaSolicitudPropiaPort = {
    buscarPorId: (solicitudId) => {
      const row = buscarSolicitudPropiaPorId(db, solicitudId);
      return row ? toPortSolicitudPropia(row) : undefined;
    },
    listarDeSolicitante: (filtro) => listSolicitudesPropiasDeSolicitante(db, filtro).map(toPortSolicitudPropia),
  };
  const logEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) =>
    logTurnEvent(casoId, event, fields, logDeps);

  const ejecutarDeps: EjecutarOperacionDeps = {
    store,
    solicitudStore,
    config: ventasConfig,
    notifier,
    baseUrlPublica,
    ...(deps.riesgoCredito !== undefined ? { riesgoCredito: deps.riesgoCredito } : {}),
    ...(deps.clienteA2A !== undefined ? { clienteA2A: deps.clienteA2A } : {}),
    reporteStore,
    consultaVentaPropia,
    consultaSolicitudPropia,
    solicitudA2AEntrante,
    justificacion,
    delegacionA2AStore,
    registro,
    despacharDeps,
    rolPort,
    newId,
    newToken,
    now,
    logEvent,
  };

  const ejecutar = (input: EjecutarOperacionInput): Promise<string> => ejecutarOperacion(input, ejecutarDeps);

  return async (input) => {
    const casoId = newId();
    const timestamp = now();

    // PROPAGA si falla — sin caso no hay nada que correlacionar (mismo
    // criterio que `buildOnSoporte`). Nada corre después si esto lanza.
    createCaso(db, {
      id: casoId,
      tipo: CASO_TIPO_OPERACIONES,
      estado: CASO_ESTADO_ACTIVO,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    logTurnEvent(casoId, "operaciones-caso-creado", undefined, logDeps);

    const prompt = buildOperacionesEmpleadoPrompt(input.consulta);
    const candidateAgents = [construirAgenteEmpleadoOperaciones()];
    const knowledge = createKnowledge(casoId);

    const operacionesAdapter = createOperacionesAdapter({
      casoId,
      sesion: input.sesion,
      confirmacion: input.confirmacion,
      ejecutar,
    });

    /**
     * Decorador per-turno del `MemoryPort` (ADR 196 pto 6, `chat-web-empleado`
     * tarea 3). Campo por campo, SIN `...spread` — a propósito, para que sea
     * auditable de una mirada que sólo `getLatestSesionAgente` se redirige.
     * ÚNICO método redirigido: la sesión a retomar se resuelve contra el
     * `casoId` del mensaje ANTERIOR de esta conversación
     * (`input.conversacion.casoAnterior()`), no contra el de este mensaje
     * (`casoIdDelTurno`) — que por construcción es nuevo y no tiene
     * historial propio todavía.
     */
    const memoriaConversacional: MemoryPort = {
      getCasoById: (id) => memory.getCasoById(id),
      getLatestSesionAgente: (casoIdDelTurno, agentId) =>
        memory.getLatestSesionAgente(input.conversacion.casoAnterior() ?? casoIdDelTurno, agentId),
      updateCaso: (id, update) => memory.updateCaso(id, update),
      createSesionAgente: (fila) => memory.createSesionAgente(fila),
    };

    const result = await handleTurn(casoId, prompt, {
      memory: memoriaConversacional,
      hooks,
      candidateAgents,
      ...(logDeps ? { logDeps } : {}),
      mcpServers: { ...knowledge.mcpServers, ...operacionesAdapter.mcpServers },
    });

    // `registrarTurno` SÓLO tras `handleTurn` resuelto — NUNCA antes, NUNCA
    // en un `catch` (ADR 196 pto 7): un turno fallido deja la memoria de la
    // conversación exactamente donde estaba. Prohibido además cualquier
    // reintento automático sin `resume` (ADR 196 pto 9) — no hay un segundo
    // `await handleTurn(...)` en este `try`.
    input.conversacion.registrarTurno(casoId);

    return { casoId, respuesta: result.responseText };
  };
}
