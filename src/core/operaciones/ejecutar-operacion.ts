/**
 * Ejecución de las ocho operaciones del contrato (`operaciones-contract.ts`,
 * tarea 1, ampliado a `resolver_solicitud`/`resolver_reembolso` por
 * `aprobacion-conversacional-hitl`, tareas 9/13) — dispatch puro hacia los
 * casos de uso/funciones YA EXISTENTES de `core/ventas`/`core/solicitudes`,
 * SIN modificarlos (ADR 145 pto 5, ADR 167, ADR 170/171/174, tarea 3).
 * Traduce cada `Result` discriminado a texto para el modelo, molde
 * `knowledge-tool.ts` — NUNCA lanza, en ningún camino, ni siquiera si una
 * dependencia inyectada lanza sincrónicamente (mismo criterio que
 * `handleKnowledgeQuery`).
 *
 * Imports: `operaciones-contract.ts` (tarea 1, mismo directorio, para el tipo
 * de la unión discriminada y `ConfirmacionOperacionPort`) + los casos de
 * uso/funciones puras de `core/ventas`/`core/solicitudes` que este módulo
 * despacha, sin tocarlos. Ningún import de `src/adapters/*` ni del SDK
 * (regla no negociable de `AGENTS.md`).
 */
import {
  DOMINIO_DEVOLUCION,
  DOMINIO_REEMBOLSO,
  DOMINIO_SOLICITUD,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_CONSULTAR_SOLICITUD,
  OPERACION_CONSULTAR_VENTA,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_RESOLVER_REEMBOLSO,
  OPERACION_RESOLVER_SOLICITUD,
  OPERACION_SOLICITAR_DEVOLUCION,
  type ConfirmacionOperacionPort,
  type LlaveConfirmacion,
  type OperacionConsultarSolicitud,
  type OperacionConsultarVenta,
  type OperacionNegocio,
  type OperacionRegistrarVenta,
  type OperacionResolverReembolso,
  type OperacionResolverSolicitud,
  type OperacionSolicitarDevolucion,
} from "./operaciones-contract.js";
import { consultarVentaPropia } from "../ventas/consultar-venta-propia.js";
import { type ConsultaVentaPropiaPort, type VentaPropia } from "../ventas/consulta-venta-contract.js";
import { consultarSolicitudPropia } from "../solicitudes/consultar-solicitud-propia.js";
import { type ConsultaSolicitudPropiaPort, type SolicitudPropia } from "../solicitudes/consulta-solicitud-propia-contract.js";
import { solicitarDevolucion, type SolicitarDevolucionDeps, type SolicitarDevolucionResult } from "../ventas/solicitar-devolucion.js";
import { type JustificacionDevolucionPort } from "../ventas/justificacion-devolucion-contract.js";
import { resolverDecisionVenta, type ConfirmarVentaDeps, type DecisionVentaResult } from "../ventas/confirmar-venta.js";
import { procesarDevolucion, type DevolucionResult, type ProcesarDevolucionDeps } from "../ventas/procesar-devolucion.js";
import { registrarVenta, type RegistrarVentaDeps } from "../ventas/registrar-venta.js";
import {
  ACCION_REABRIR,
  resolverEscalacionReembolso,
  type AccionEscalacion,
  type ResolverEscalacionDeps,
} from "../ventas/resolver-escalacion-reembolso.js";
import {
  CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
  CASO_ESTADO_RESUELTO,
  type ConsultaRiesgoCreditoPort,
  type EscalacionListada,
  type VentaNotifierPort,
  type VentaStorePort,
} from "../ventas/ventas-contract.js";
import { type VentasConfig } from "../ventas/ventas-config.js";
import { crearSolicitudInterna, type CrearSolicitudInternaResult } from "../solicitudes/crear-solicitud-interna.js";
import {
  ACCION_CANCELAR_SOLICITUD,
  resolverSolicitudInterna,
  type AccionSolicitud,
  type ResolverSolicitudDeps,
} from "../solicitudes/resolver-solicitud-interna.js";
import { type SolicitudStorePort } from "../solicitudes/solicitudes-contract.js";
import type { RolEmpleadoPort } from "../auth/rol-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";
import { agruparReporteMensual, formatearReporteMensual, formatMoney, resolverPeriodoReporte } from "../ventas/reporte.js";
import { type ReporteStorePort } from "../ventas/reporte-contract.js";
import { type DespacharDelegacionDeps } from "../turn-selector/dispatch-delegation.js";
import { MOTIVO_CAS } from "../hitl/hitl-contract.js";
import {
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_APROBAR_SOLICITUD,
  COMANDO_CANCELAR_SOLICITUD,
  COMANDO_DEVOLUCION,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_RECHAZAR_SOLICITUD,
  COMANDO_REGISTRAR_VENTA,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_RESOLVER_DECISION_VENTA,
  COMANDO_SOLICITAR,
  COMANDO_SOLICITAR_DEVOLUCION,
  RESULTADO_ATENDIDA,
  RESULTADO_AUTOAPROBACION_PROHIBIDA,
  RESULTADO_CONFIRMADA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_NO_AUTORIZADO,
  RESULTADO_RECHAZADA,
  RESULTADO_REEMBOLSADA,
  type AccionEmpleado,
  type RegistroAccionesEmpleadoPort,
} from "../commands/registro-acciones-contract.js";

export interface EjecutarOperacionDeps {
  readonly store: VentaStorePort;
  readonly solicitudStore: SolicitudStorePort;
  readonly config: VentasConfig;
  /** Exigido por tipo por `registrarVenta` (ADR 171 pto 5) — reusa la MISMA instancia que `main.ts` ya construye para `buildOnVenta`. */
  readonly notifier: VentaNotifierPort;
  readonly baseUrlPublica: string;
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
  /**
   * Requerida acá (nunca `undefined`) — la opcionalidad vive únicamente en
   * `BuildOnOperacionesEmpleadoDeps` (tarea 5), resuelta a una instancia
   * concreta antes de despachar (ADR 174 pto 6).
   */
  readonly reporteStore: ReporteStorePort;
  /** `devolucion-sin-token-dos-personas`, ADR 225 pto 4, ADR 227 pto 4 — mismo criterio "requerido acá" que `reporteStore`. */
  readonly consultaVentaPropia: ConsultaVentaPropiaPort;
  /** `consulta-solicitud-propia`, RD-115 pto 4 — mismo criterio "requerido acá" que `consultaVentaPropia`: la opcionalidad, si hiciera falta, vive en `BuildOnOperacionesEmpleadoDeps`, resuelta antes de despachar. */
  readonly consultaSolicitudPropia: ConsultaSolicitudPropiaPort;
  /** `devolucion-sin-token-dos-personas`, ADR 228 pto 6, tarea 16 — mismo criterio "requerido acá" que `consultaVentaPropia`. */
  readonly justificacion: JustificacionDevolucionPort;
  readonly despacharDeps: DespacharDelegacionDeps;
  /**
   * Requerido (`autorizacion-empleado`, ADR 157/159/162, ya mergeado a esta
   * rama): `ResolverSolicitudDeps.rolPort` es un campo obligatorio del puerto
   * que `cancelar_solicitud_interna` consume — aunque `esAccionAutoservicio`
   * nunca evalúa el gate de rol para `cancelar` (bypass estructural, mismo
   * criterio que `resolver-solicitud-interna.ts` documenta), el objeto de
   * `deps` no compila sin este campo.
   */
  readonly rolPort: RolEmpleadoPort;
  /**
   * Requerido (nunca opcional acá) — ADR 188 pto 1: la opcionalidad vive
   * únicamente en `BuildOnOperacionesEmpleadoDeps` (tarea 5), resuelta a una
   * instancia concreta antes de despachar, mismo criterio que `reporteStore`
   * (ADR 174 pto 6).
   */
  readonly registro: RegistroAccionesEmpleadoPort;
  readonly newId: () => string;
  /** Exigido por tipo por `registrarVenta` (ADR 171 pto 5). */
  readonly newToken: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface EjecutarOperacionInput {
  readonly operacion: OperacionNegocio;
  /** SIEMPRE de una sesión autenticada (ADR 37/147 pto 1) — nunca del `input` del modelo. */
  readonly sesion: SesionEmpleado;
  readonly confirmacion: ConfirmacionOperacionPort;
  /** `casoId` del turno actual — guard `origenCasoId !== casoIdActual` (ADR 166 pto 3). */
  readonly casoIdActual: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textoDecisionVenta(resultado: DecisionVentaResult): string {
  switch (resultado.resultado) {
    case "confirmada":
      return `Venta confirmada. Comisión calculada: ${resultado.comisionMonto} (período ${resultado.periodo}).`;
    case "rechazada":
      return "Venta rechazada por el cliente. No se generó ninguna comisión.";
    case "no_aplicable":
      return `No se pudo procesar la decisión: el token no es válido o ya fue usado (motivo: ${resultado.motivo}).`;
  }
}

function textoDevolucion(resultado: DevolucionResult): string {
  switch (resultado.resultado) {
    case "reembolsada":
      return `Devolución aprobada automáticamente para la venta ${resultado.ventaId} (caso ${resultado.casoId}).`;
    case "escalada":
      return `Devolución escalada a revisión humana para la venta ${resultado.ventaId} (caso ${resultado.casoId}). Queda pendiente de aprobación.`;
    case "no_aplicable":
      return resultado.ventaId === undefined
        ? "No se pudo procesar la devolución: el token no corresponde a ninguna venta."
        : `No se pudo procesar la devolución para la venta ${resultado.ventaId}: no está en un estado válido para eso.`;
  }
}

function textoCrearSolicitudInterna(resultado: CrearSolicitudInternaResult): string {
  if (resultado.resultado === "tipo_desconocido") {
    return "No conozco ese tipo de solicitud interna.";
  }
  const { solicitud } = resultado;
  const dictamen =
    solicitud.dictamen !== undefined
      ? ` Dictamen: ${solicitud.dictamen}`
      : " Sin dictamen: la validación automática no se pudo completar.";
  return `Solicitud ${solicitud.id} creada (caso ${solicitud.casoId}).${dictamen}`;
}

/**
 * Duplicado local mínimo de `resultadoDevolucion` (`build-on-comando-empleado.ts`,
 * ADR 188 sección final) — `src/core/` no puede importar de un archivo raíz
 * (regla no negociable de `AGENTS.md`), mismo criterio de duplicación
 * deliberada que `CASO_TIPO_OPERACIONES`/`CASO_ESTADO_ACTIVO` en
 * `build-on-operaciones-empleado.ts`.
 */
function resultadoDevolucionAuditoria(resultado: DevolucionResult["resultado"]): string {
  if (resultado === "reembolsada") return RESULTADO_REEMBOLSADA;
  if (resultado === "escalada") return RESULTADO_ESCALADA;
  return RESULTADO_NO_APLICABLE;
}

/** Mismo criterio que `resultadoDevolucionAuditoria` — mapea las tres ramas de `DecisionVentaResult` al vocabulario de auditoría. */
function resultadoDecisionVentaAuditoria(resultado: DecisionVentaResult["resultado"]): string {
  if (resultado === "confirmada") return RESULTADO_CONFIRMADA;
  if (resultado === "rechazada") return RESULTADO_RECHAZADA;
  return RESULTADO_NO_APLICABLE;
}

/**
 * Único punto donde el dispatcher del núcleo escribe FUERA de la
 * transacción de dominio de la operación (ADR 188 pto 3, Enmienda 1 post-
 * implementación). Contrato asimétrico del ADR 40, citado en el propio
 * puerto (`registro-acciones-contract.ts:70-76`): `RegistroAccionesEmpleadoPort`
 * SÍ puede lanzar, y es el LLAMADOR (acá) quien envuelve la llamada en su
 * PROPIO `try`/`catch` — NUNCA el `catch` global de `ejecutarOperacion`, que
 * degradaría el texto de negocio ya resuelto a un genérico "no se aplicó
 * nada" (mentira, si el efecto ya ocurrió). Éxito ⇒
 * `accion-empleado-registrada`; falla ⇒ `accion-empleado-registro-fallido`,
 * sin alterar el texto que ya se le devuelve al modelo.
 *
 * NO re-chequea `sesionVigente` (ADR 188 pto 9): a diferencia de la TUI,
 * `EjecutarOperacionInput.sesion` es requerida por tipo y el turno entero ya
 * está gateado en `POST /operaciones` (401 sin token vigente, ADR 173) — la
 * rama `accion-empleado-sin-sesion` de la TUI es estructuralmente
 * inalcanzable acá.
 */
function registrar(
  input: Omit<AccionEmpleado, "id" | "empleadoId" | "ocurridoAt">,
  sesion: SesionEmpleado,
  casoIdActual: string,
  deps: EjecutarOperacionDeps,
): void {
  const ahora = deps.now();
  try {
    deps.registro.registrarAccion({ ...input, id: deps.newId(), empleadoId: sesion.empleadoId, ocurridoAt: ahora });
    deps.logEvent(casoIdActual, "accion-empleado-registrada", {
      comando: input.comando,
      resultado: input.resultado,
      canal: "conversacional",
    });
  } catch (error) {
    deps.logEvent(casoIdActual, "accion-empleado-registro-fallido", {
      comando: input.comando,
      message: toErrorMessage(error),
    });
  }
}

/**
 * Registro de auditoría compartido por las tres ramas "resultado no
 * aplicado" (`no_autorizado`, `autoaprobacion_prohibida`,
 * `no_aplicable`/CAS-perdido) de `ejecutarAccionSolicitud` Y
 * `ejecutarResolverReembolso` (hallazgo Reviewer 4, duplicación). El único
 * campo que varía entre ambas funciones es `ventaId` (ausente en
 * solicitudes) — de ahí `extra`, en vez de un objeto de payload completo,
 * que forzaría a repetir `comando`/`casoId`/`resultado` en cada call site
 * de todos modos.
 */
function registrarResultadoAccion(
  comando: string,
  resultado: string,
  casoId: string,
  extra: { readonly ventaId?: string },
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): void {
  registrar({ comando, casoId, resultado, ...extra }, input.sesion, input.casoIdActual, deps);
}

/**
 * Despacho COMPARTIDO de las TRES ramas "resultado no aplicado"
 * (`no_autorizado`, `autoaprobacion_prohibida`, `no_aplicable`/CAS-perdido)
 * de `ejecutarAccionSolicitud` Y `ejecutarResolverReembolso` (hallazgo
 * Reviewer 6, duplicación — antes cada dispatcher repetía el mismo trío
 * `registrarResultadoAccion` + `return texto` tres veces). El CALLER ya
 * hizo el `if (resultado.resultado === ...)` sobre el `Result` de SU propio
 * dominio (las FORMAS no coinciden campo a campo entre ambos — `itemId` vs
 * `ventaId`, y sólo el dominio solicitud tiene `no_es_dueno` — por eso el
 * narrowing sigue siendo de cada dominio, nunca de acá): a esta función sólo
 * llegan los TRES valores que SÍ coinciden en ambos `Result` — el `tag` ya
 * resuelto, `casoId` y (para CAS-perdido) que el motivo ya era CAS.
 */
function textoResultadoNoAplicado(
  tag: "no_autorizado" | "autoaprobacion_prohibida" | "no_aplicable_cas" | "no_aplicable_otro",
  comando: string,
  casoId: string | undefined,
  extra: { readonly ventaId?: string },
  textos: { readonly noAutorizado: string; readonly autoaprobacionProhibida: string; readonly noCompletada: string },
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): string {
  if (tag === "no_autorizado") {
    registrarResultadoAccion(comando, RESULTADO_NO_AUTORIZADO, casoId ?? "", extra, input, deps);
    return textos.noAutorizado;
  }
  if (tag === "autoaprobacion_prohibida") {
    registrarResultadoAccion(comando, RESULTADO_AUTOAPROBACION_PROHIBIDA, casoId ?? "", extra, input, deps);
    return textos.autoaprobacionProhibida;
  }
  if (tag === "no_aplicable_cas" && casoId !== undefined) {
    registrarResultadoAccion(comando, RESULTADO_NO_APLICABLE, casoId, extra, input, deps);
  }
  return textos.noCompletada;
}

/**
 * Ciclo de confirmación en dos pasos COMPARTIDO por `ejecutarAccionSolicitud`
 * y `ejecutarResolverReembolso` (hallazgo Reviewer 6, duplicación) —
 * `estaConfirmada` → si NO: invoca `resolver(false)` y el CALLER decide qué
 * hacer con la 1ra ejecución vía `primeraEjecucion` (puede cerrar con un
 * texto propio — `no_aplicable`/`no_es_dueno` — o pedir `marcarPendiente` +
 * el eco); si SÍ: `consumir()` ANTES de invocar `resolver(true)` (ADR 36,
 * mismo orden que la TUI) y el CALLER interpreta la 2da ejecución vía
 * `segundaEjecucion`. Este helper orquesta SÓLO la secuencia
 * (`estaConfirmada`/`marcarPendiente`/`consumir`, parametrizado por
 * `LlaveConfirmacion`) — nunca el contenido de los `Result`, que sigue
 * siendo de cada dominio (`itemId` vs `ventaId`, la rama `no_es_dueno` que
 * sólo existe en solicitud).
 */
async function ejecutarConDobleConfirmacion<TResult>(
  llave: LlaveConfirmacion,
  input: EjecutarOperacionInput,
  resolver: (confirmado: boolean) => TResult,
  ramas: {
    readonly primeraEjecucion: (
      resultado: TResult,
    ) => { readonly kind: "texto"; readonly texto: string } | { readonly kind: "confirmar"; readonly casoId: string; readonly eco: string };
    readonly segundaEjecucion: (resultado: TResult) => string;
  },
): Promise<string> {
  const yaConfirmada = input.confirmacion.estaConfirmada(llave, input.sesion.empleadoId, input.casoIdActual);

  if (!yaConfirmada) {
    const decision = ramas.primeraEjecucion(resolver(false));
    if (decision.kind === "texto") {
      return decision.texto;
    }
    input.confirmacion.marcarPendiente({
      ...llave,
      casoId: decision.casoId,
      empleadoId: input.sesion.empleadoId,
      origenCasoId: input.casoIdActual,
    });
    return decision.eco;
  }

  // Coincide: se CONSUME antes de ejecutar (ADR 36, mismo orden que la TUI).
  input.confirmacion.consumir(llave);
  return ramas.segundaEjecucion(resolver(true));
}

/** `cancelar`→`/cancelar-solicitud`, `aprobar`→`/aprobar-solicitud`, `rechazar`→`/rechazar-solicitud` (ADR 210 pto 1, tarea 9; unificado hallazgo Reviewer 2). */
const COMANDO_POR_ACCION_SOLICITUD: Record<AccionSolicitud, string> = {
  cancelar: COMANDO_CANCELAR_SOLICITUD,
  aprobar: COMANDO_APROBAR_SOLICITUD,
  rechazar: COMANDO_RECHAZAR_SOLICITUD,
};

/**
 * Textos propios de cada acción — lo único que distingue
 * `ejecutarCancelarSolicitud` de `ejecutarResolverSolicitud` (hallazgo
 * Reviewer 2). `noAutorizado`/`autoaprobacionProhibida` viajan acá (en vez de
 * hardcodeados en `ejecutarAccionSolicitud`) porque `textoResultadoNoAplicado`
 * (hallazgo Reviewer 6) es compartido con el dominio reembolso y no conoce el
 * vocabulario de "solicitud" — para `cancelar` (autoservicio) estos dos
 * campos son código muerto en la práctica: `resolverSolicitudInterna` nunca
 * produce esas dos variantes de `Result` para esa acción (ADR 130).
 */
interface TextosAccionSolicitud {
  readonly sinId: string;
  readonly listadoVacio: string;
  readonly noAplicable: (solicitudId: string) => string;
  readonly noProcesable: string;
  readonly confirmacionPendiente: (solicitudId: string, detalle: string) => string;
  readonly noAutorizado: string;
  readonly autoaprobacionProhibida: string;
  readonly noCompletada: string;
}

/**
 * Control de flujo COMPARTIDO por `ejecutarCancelarSolicitud` (ADR 166) y
 * `ejecutarResolverSolicitud` (ADR 206-207) — extraído tras hallazgo Reviewer
 * 2 (refactor puro, comportamiento observable idéntico, verificado por la
 * suite existente de ambas), y ampliado tras hallazgo Reviewer 6 para usar
 * `ejecutarConDobleConfirmacion`/`textoResultadoNoAplicado` (compartidos con
 * `ejecutarResolverReembolso`). Secuencia exacta (ADR 166, tasks.md tarea 3
 * punto 3): sin `solicitudId` ⇒ listado, SIN tocar la ranura. Con
 * `solicitudId` y `estaConfirmada() === false` ⇒ `requiere_confirmacion` +
 * `marcarPendiente({..., origenCasoId})`. Con `estaConfirmada() === true` ⇒
 * se CONSUME antes de ejecutar (ADR 36, mismo orden que la TUI).
 *
 * `aprobar`/`rechazar` SÍ atraviesan el gate de rol y la prohibición de
 * autoaprobación de `resolverSolicitudInterna`; `cancelar` (autoservicio,
 * ADR 130) nunca produce esas dos variantes de `Result` — pero este
 * dispatcher no reimplementa ningún gate, sólo traduce el `Result` a texto
 * (ADR 207 pto 2, R2), así que las dos ramas conviven acá sin riesgo para
 * `cancelar`: simplemente nunca se disparan para esa acción.
 *
 * Camino CAS-perdido (ADR 188 hallazgo 1): la ÚNICA rama de esta operación
 * que audita desde acá — el camino feliz ya viajó dentro de la transacción
 * del store, auditarlo de nuevo lo DUPLICARÍA.
 */
async function ejecutarAccionSolicitud(
  accion: AccionSolicitud,
  solicitudId: string | undefined,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
  textos: TextosAccionSolicitud,
): Promise<string> {
  const resolverDeps: ResolverSolicitudDeps = {
    store: deps.solicitudStore,
    newId: deps.newId,
    now: deps.now,
    logEvent: deps.logEvent,
    rolPort: deps.rolPort,
  };

  if (solicitudId === undefined) {
    const resultado = resolverSolicitudInterna({ accion, confirmado: false, sesion: input.sesion }, resolverDeps);
    if (resultado.resultado !== "listado") {
      return textos.sinId;
    }
    if (resultado.items.length === 0) {
      return textos.listadoVacio;
    }
    return resultado.items.map((item) => `- ${item.id} (${item.tipo}): ${item.detalle}`).join("\n");
  }

  const llave: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: solicitudId, accion };
  const comando = COMANDO_POR_ACCION_SOLICITUD[accion];

  return ejecutarConDobleConfirmacion(
    llave,
    input,
    (confirmado) => resolverSolicitudInterna({ accion, solicitudId, confirmado, sesion: input.sesion }, resolverDeps),
    {
      primeraEjecucion: (resultado) => {
        if (resultado.resultado === "no_aplicable" || resultado.resultado === "no_es_dueno") {
          return { kind: "texto", texto: textos.noAplicable(solicitudId) };
        }
        if (resultado.resultado !== "requiere_confirmacion") {
          return { kind: "texto", texto: textos.noProcesable };
        }
        return {
          kind: "confirmar",
          casoId: resultado.item.casoId,
          eco: textos.confirmacionPendiente(solicitudId, resultado.item.detalle),
        };
      },
      segundaEjecucion: (resultado) => {
        if (resultado.resultado === "aplicada") {
          return `Listo: la solicitud ${solicitudId} quedó ${resultado.estadoFinal}.`;
        }
        if (resultado.resultado === "no_autorizado") {
          return textoResultadoNoAplicado("no_autorizado", comando, resultado.casoId, {}, textos, input, deps);
        }
        if (resultado.resultado === "autoaprobacion_prohibida") {
          return textoResultadoNoAplicado("autoaprobacion_prohibida", comando, resultado.casoId, {}, textos, input, deps);
        }
        const esCas = resultado.resultado === "no_aplicable" && resultado.motivo === MOTIVO_CAS;
        const casoId = resultado.resultado === "no_aplicable" ? resultado.casoId : undefined;
        return textoResultadoNoAplicado(esCas ? "no_aplicable_cas" : "no_aplicable_otro", comando, casoId, {}, textos, input, deps);
      },
    },
  );
}

/** Wrapper de `ejecutarAccionSolicitud` para `cancelar_solicitud_interna` (ADR 166) — textos propios de la acción autoservicio. */
async function ejecutarCancelarSolicitud(
  solicitudId: string | undefined,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  return ejecutarAccionSolicitud(ACCION_CANCELAR_SOLICITUD, solicitudId, input, deps, {
    sinId: "No se pudo listar tus solicitudes pendientes.",
    listadoVacio: "No tenés solicitudes pendientes para cancelar.",
    noAplicable: (id) => `No hay ninguna solicitud ${id} tuya pendiente de cancelación.`,
    noProcesable: "No se pudo procesar esa cancelación.",
    confirmacionPendiente: (id, detalle) =>
      `Vas a cancelar la solicitud ${id} (${detalle}). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la cancelación.`,
    // Código muerto en la práctica (ADR 130) — `cancelar` nunca produce estas dos variantes de `Result`.
    noAutorizado: "No estás autorizado para cancelar tu propia solicitud.",
    autoaprobacionProhibida: "No podés cancelar tu propia solicitud.",
    noCompletada: "No se pudo completar la cancelación: puede que ya no esté pendiente.",
  });
}

/**
 * Wrapper de `ejecutarAccionSolicitud` para `resolver_solicitud` (ADR
 * 206-207, tarea 9) — textos propios de `aprobar`/`rechazar`. Texto de
 * autoaprobación reusado literal del vigente de la TUI
 * (`build-on-comando-empleado.ts:1336`, ADR 216 pto 5).
 */
async function ejecutarResolverSolicitud(
  operacion: OperacionResolverSolicitud,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const { accion, solicitudId } = operacion;
  return ejecutarAccionSolicitud(accion, solicitudId, input, deps, {
    sinId: "No se pudo listar las solicitudes.",
    listadoVacio: "No hay solicitudes para listar.",
    noAplicable: (id) => `No hay ninguna solicitud ${id} pendiente de resolución.`,
    noProcesable: "No se pudo procesar esa resolución.",
    confirmacionPendiente: (id, detalle) =>
      `Vas a ${accion} la solicitud ${id} (${detalle}). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.`,
    noAutorizado: `No estás autorizado para ${accion} esa solicitud: se requiere rol elevado.`,
    autoaprobacionProhibida: `No podés ${accion} tu propia solicitud, aunque tengas rol elevado.`,
    noCompletada: "No se pudo completar la resolución: puede que ya no esté pendiente.",
  });
}

/** `aprobar`→`/aprobar-reembolso`, `rechazar`→`/rechazar-reembolso`, `reabrir`→`/reabrir-reembolso` (ADR 210 pto 1, tarea 13). */
const COMANDO_POR_ACCION_REEMBOLSO: Record<AccionEscalacion, string> = {
  aprobar: COMANDO_APROBAR_REEMBOLSO,
  rechazar: COMANDO_RECHAZAR_REEMBOLSO,
  reabrir: COMANDO_REABRIR_REEMBOLSO,
};

/**
 * Estado del CASO al que transiciona cada `accion` de reembolso, molde
 * literal de `ACCION_ESCALACION_INFO`/`ESTADOS_APROBAR_O_RECHAZAR` de la TUI
 * vieja (`build-on-comando-empleado.ts`, ya removida por la tarea 14 de este
 * change) — `aprobar`/`rechazar` comparten la MISMA transición
 * (`reembolso_pendiente` → resuelta, caso → `resuelto`); sólo `reabrir`
 * difiere (caso → `pendiente_aprobacion_humana`, vuelve a quedar para
 * revisión humana). Hallazgo Reviewer, correctness: el mensaje de éxito del
 * dispatcher conversacional había perdido este dato que la TUI vieja sí
 * reportaba.
 */
const ESTADO_CASO_POR_ACCION_REEMBOLSO: Record<AccionEscalacion, string> = {
  aprobar: CASO_ESTADO_RESUELTO,
  rechazar: CASO_ESTADO_RESUELTO,
  reabrir: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
};

/**
 * Una línea por venta — MISMO formato que `formatearLineaEscalacion` de la
 * TUI vieja (`build-on-comando-empleado.ts`, ya removida por la tarea 14):
 * vendedor, cliente y monto vía `formatMoney` (hallazgo Reviewer,
 * correctness — el listado conversacional los había perdido).
 */
function formatearLineaListadoReembolso(item: EscalacionListada): string {
  const base = `- venta ${item.ventaId} | vendedor ${item.vendedorNombre} | cliente ${item.clienteId} | monto ${formatMoney(
    item.monto,
  )} | caso ${item.casoId}`;
  return conSufijoConfirmada(base, item.confirmedAt);
}

/**
 * Sufijo ` | confirmada <fecha>` cuando `confirmedAt` está presente — mismo
 * criterio en `formatearLineaVentaPropia` y `formatearLineaListadoReembolso`
 * (hallazgo code-review: duplicación letra por letra, extraído acá).
 */
function conSufijoConfirmada(base: string, confirmedAt?: string): string {
  return confirmedAt === undefined ? base : `${base} | confirmada ${confirmedAt}`;
}

/**
 * Wrapper de `resolverEscalacionReembolso` para `resolver_reembolso` (ADR
 * 206-207, ADR 211, ADR 216, ADR 218, tarea 13) — molde de
 * `ejecutarResolverSolicitud`/`ejecutarAccionSolicitud`, adaptado a las
 * SEIS ramas de `ResolverEscalacionResult`. Comparte con `ejecutarAccionSolicitud`
 * el ciclo de confirmación (`ejecutarConDobleConfirmacion`) y el despacho de
 * las tres ramas "no aplicado" (`textoResultadoNoAplicado`) — hallazgo
 * Reviewer 6: sólo esas partes coinciden campo a campo entre dominios. Lo que
 * SIGUE sin compartirse, a propósito (`itemId` vs `ventaId`, la rama
 * `no_es_dueno` que sólo existe en solicitud, el modo listado — formatos de
 * dominio completamente distintos): el listado, el eco (con la salvedad de
 * `reabrir`) y el texto de "no encontrada" por `accion`. Texto de
 * autoaprobación LITERAL (ADR 216 pto 1), distinguible del rechazo por rol.
 * **Cero lógica de autorización, incluido el predicado `vendedorId`/
 * `empleadoId`** — el dispatcher SOLO traduce el `Result` que ya produjo
 * `resolverEscalacionReembolso` (tarea 5, Unit 2).
 */
async function ejecutarResolverReembolso(
  operacion: OperacionResolverReembolso,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const { accion, ventaId } = operacion;
  const resolverDeps: ResolverEscalacionDeps = {
    store: deps.store,
    newId: deps.newId,
    now: deps.now,
    logEvent: deps.logEvent,
    rolPort: deps.rolPort,
  };
  const textos = {
    noAutorizado: `No estás autorizado para ${accion} esa escalación de reembolso: se requiere rol elevado.`,
    autoaprobacionProhibida: `No podés ${accion} el reembolso de tu propia venta, aunque tengas rol elevado.`,
    noCompletada: "No se pudo completar la resolución: puede que ya no esté pendiente.",
  };

  if (ventaId === undefined) {
    const resultado = resolverEscalacionReembolso({ accion, confirmado: false, sesion: input.sesion }, resolverDeps);
    if (resultado.resultado !== "listado") {
      return "No se pudo listar las escalaciones de reembolso.";
    }
    if (resultado.items.length === 0) {
      return "No hay escalaciones de reembolso para listar.";
    }
    return resultado.items.map(formatearLineaListadoReembolso).join("\n");
  }

  const llave: LlaveConfirmacion = { dominio: DOMINIO_REEMBOLSO, itemId: ventaId, accion };
  const comando = COMANDO_POR_ACCION_REEMBOLSO[accion];
  // ★ Hallazgo Reviewer, correctness: la precondición real de `reabrir` es
  // que la venta esté `reembolso_rechazado` — el mensaje distingue eso de
  // `pendiente` (aprobar/rechazar), molde `estadoOrigen` de la TUI vieja.
  const textoNoEncontrada =
    accion === ACCION_REABRIR
      ? `No hay ninguna escalación de reembolso ${ventaId} rechazada pendiente de reapertura.`
      : `No hay ninguna escalación de reembolso ${ventaId} pendiente de resolución.`;

  return ejecutarConDobleConfirmacion(
    llave,
    input,
    (confirmado) => resolverEscalacionReembolso({ accion, ventaId, confirmado, sesion: input.sesion }, resolverDeps),
    {
      primeraEjecucion: (resultado) => {
        if (resultado.resultado === "no_aplicable") {
          return { kind: "texto", texto: textoNoEncontrada };
        }
        if (resultado.resultado !== "requiere_confirmacion") {
          return { kind: "texto", texto: "No se pudo procesar esa resolución." };
        }
        const eco = `Vas a ${accion} el reembolso de la venta ${ventaId} (monto ${resultado.venta.monto}). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.`;
        if (accion !== ACCION_REABRIR) {
          return { kind: "confirmar", casoId: resultado.venta.casoId, eco };
        }
        const rechazadaPor = resultado.venta.rechazadaPor ?? "desconocido";
        const rechazadaAt = resultado.venta.rechazadaAt ?? "fecha desconocida";
        return {
          kind: "confirmar",
          casoId: resultado.venta.casoId,
          eco: `${eco} rechazada por ${rechazadaPor} el ${rechazadaAt} · reaperturas previas: ${resultado.venta.reaperturasPrevias}.`,
        };
      },
      segundaEjecucion: (resultado) => {
        if (resultado.resultado === "aplicada") {
          const estadoCaso = ESTADO_CASO_POR_ACCION_REEMBOLSO[accion];
          return `Listo: el reembolso de la venta ${ventaId} quedó ${resultado.estadoFinal} y el caso ${resultado.venta.casoId} en ${estadoCaso}.`;
        }
        if (resultado.resultado === "no_autorizado") {
          return textoResultadoNoAplicado("no_autorizado", comando, resultado.casoId, { ventaId }, textos, input, deps);
        }
        if (resultado.resultado === "autoaprobacion_prohibida") {
          return textoResultadoNoAplicado("autoaprobacion_prohibida", comando, resultado.casoId, { ventaId }, textos, input, deps);
        }
        const esCas = resultado.resultado === "no_aplicable" && resultado.motivo === MOTIVO_CAS;
        const casoId = resultado.resultado === "no_aplicable" ? resultado.casoId : undefined;
        return textoResultadoNoAplicado(esCas ? "no_aplicable_cas" : "no_aplicable_otro", comando, casoId, { ventaId }, textos, input, deps);
      },
    },
  );
}

/**
 * ADR 171 pto 2/5, ADR 170 pto 5: `vendedorId` sale de `sesion.empleadoId`
 * (closure), NUNCA de `operacion` — que ni siquiera tiene ese campo
 * (garantía estructural, `operaciones-contract.ts`). `monto` viaja de
 * `operacion.monto` a `registrarVenta` sin ninguna operación aritmética
 * intermedia — comparación `===` estricta, verificada por
 * `ejecutar-operacion.test.ts`.
 *
 * ADR 221 pto 1/2/3 (ergonomia-canal-empleado, tarea 1): el eco de esta
 * función nombra a `operacion.vendedorNombre`. ★ Ese campo NO es identidad
 * autenticada — es texto libre que el MODELO llenó a partir del mensaje del
 * empleado (a diferencia de `vendedorId`, que sale de `sesion.empleadoId`
 * por closure y es inexpresable por el modelo). Por eso el texto del eco
 * dice `vendedor <nombre>` y NUNCA "registrado por" ni "el empleado que
 * registró": esa frase afirmaría una garantía de autenticación que este
 * dato no tiene. Quien manda para la auditoría sigue siendo `vendedorId`
 * (`:684-689`). ★ `operacion.clienteEmail` está prohibido en el eco (ADR 221
 * pto 3): es el único dato personal del flujo que el repo decidió no
 * persistir en ninguna parte (`registrar-venta.ts`, ADR 18 pto 4), y el
 * transcripto del chat SÍ se guarda — meterlo en el eco lo empujaría a un
 * almacén donde esa decisión no lo quiere.
 */
async function ejecutarRegistrarVenta(
  operacion: OperacionRegistrarVenta,
  sesion: SesionEmpleado,
  casoIdActual: string,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const registrarDeps: RegistrarVentaDeps = {
    store: deps.store,
    notifier: deps.notifier,
    config: deps.config,
    baseUrlPublica: deps.baseUrlPublica,
    newId: deps.newId,
    newToken: deps.newToken,
    now: deps.now,
    logEvent: deps.logEvent,
    ...(deps.riesgoCredito !== undefined ? { riesgoCredito: deps.riesgoCredito } : {}),
  };

  const resultado = await registrarVenta(
    {
      vendedorId: sesion.empleadoId,
      vendedorNombre: operacion.vendedorNombre,
      clienteId: operacion.clienteId,
      clienteEmail: operacion.clienteEmail,
      ...(operacion.planAnterior !== undefined ? { planAnterior: operacion.planAnterior } : {}),
      planNuevo: operacion.planNuevo,
      monto: operacion.monto,
    },
    registrarDeps,
  );

  registrar(
    { comando: COMANDO_REGISTRAR_VENTA, ventaId: resultado.ventaId, casoId: resultado.casoId, resultado: RESULTADO_CREADA },
    sesion,
    casoIdActual,
    deps,
  );

  const notificado = resultado.notificado ? "sí" : "no se pudo notificar automáticamente";
  return `Venta registrada: vendedor ${operacion.vendedorNombre}, cliente ${operacion.clienteId} (venta ${resultado.ventaId}, caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.`;
}

/** ADR 174 pto 2/4: sin gate de rol, sin escopado por vendedor (R12) — `periodo` es el único dato de entrada. */
async function ejecutarConsultarReporte(
  periodoInput: string | undefined,
  sesion: SesionEmpleado,
  casoIdActual: string,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const resolucion = resolverPeriodoReporte(periodoInput, deps.now());
  if (!resolucion.ok) {
    return resolucion.mensaje;
  }

  const comisiones = deps.reporteStore.listComisionesPorPeriodo(resolucion.periodo);
  const reembolsosPendientes = deps.reporteStore.listVentasEnReembolsoPendiente();
  const reporte = agruparReporteMensual({ periodo: resolucion.periodo, comisiones, reembolsosPendientes });
  registrar({ comando: COMANDO_REPORTE_COMISIONES, resultado: RESULTADO_ATENDIDA }, sesion, casoIdActual, deps);
  return formatearReporteMensual(reporte);
}

/** Una línea por venta propia — molde `formatearLineaListadoReembolso`. */
function formatearLineaVentaPropia(venta: VentaPropia): string {
  const base = `- venta ${venta.ventaId} | cliente ${venta.clienteId} | plan ${venta.planNuevo} | monto ${formatMoney(
    venta.monto,
  )} | estado ${venta.estado} | caso ${venta.casoId}`;
  return conSufijoConfirmada(base, venta.confirmedAt);
}

/** Construye el `SolicitarDevolucionDeps` del núcleo a partir del `EjecutarOperacionDeps` del dispatcher — molde `ConfirmarVentaDeps`/`ResolverEscalacionDeps` de arriba. */
function solicitarDevolucionDeps(deps: EjecutarOperacionDeps): SolicitarDevolucionDeps {
  return {
    consulta: deps.consultaVentaPropia,
    justificacion: deps.justificacion,
    store: deps.store,
    newId: deps.newId,
    now: deps.now,
    logEvent: deps.logEvent,
  };
}

/**
 * `devolucion-sin-token-dos-personas`, ADR 223, ADR 224 pto 4, ADR 230 pto
 * 3, tarea 16. Molde `ejecutarCancelarSolicitud`: rama listado sin tocar la
 * ranura; `estaConfirmada({dominio: DOMINIO_DEVOLUCION, itemId: ventaId,
 * accion: "solicitar"})`; delega ÍNTEGRO en `solicitarDevolucion` (tarea
 * 14) — nunca reimplementa el gate de alcance ni el orden de evaluación,
 * SÓLO traduce el `Result` a texto y a fila de auditoría. ★ **Cero lógica
 * de alcance acá**: el dispatcher no compara `vendedorId` con `empleadoId`
 * (test mecánico, ampliado de la tarea 7).
 *
 * Auditoría por rama (design.md §6 pto 3): `escalada` ⇒ fila
 * `RESULTADO_ESCALADA`; `no_autorizada` ⇒ fila `RESULTADO_NO_AUTORIZADO`
 * (★ la fila más valiosa del change: un empleado intentó iniciar sobre una
 * venta que no es suya); `no_aplicable` ⇒ fila `RESULTADO_NO_APLICABLE`;
 * `motivo_invalido`/`no_encontrada`/`requiere_confirmacion`/`listado` ⇒
 * CERO filas — ninguna de esas cuatro tuvo un efecto que correlacionar.
 */
async function ejecutarSolicitarDevolucion(
  operacion: OperacionSolicitarDevolucion,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const { ventaId, motivo } = operacion;

  if (ventaId === undefined) {
    const resultado = solicitarDevolucion({ confirmado: false, sesion: input.sesion }, solicitarDevolucionDeps(deps));
    if (resultado.resultado !== "listado") {
      return "No se pudo listar tus ventas propias.";
    }
    if (resultado.items.length === 0) {
      return "No tenés ventas confirmadas para iniciar una devolución.";
    }
    return resultado.items.map(formatearLineaVentaPropia).join("\n");
  }

  const llave: LlaveConfirmacion = { dominio: DOMINIO_DEVOLUCION, itemId: ventaId, accion: "solicitar" };

  return ejecutarConDobleConfirmacion<SolicitarDevolucionResult>(
    llave,
    input,
    (confirmado) =>
      solicitarDevolucion(
        { ventaId, confirmado, sesion: input.sesion, ...(motivo !== undefined ? { motivo } : {}) },
        solicitarDevolucionDeps(deps),
      ),
    {
      primeraEjecucion: (resultado) => {
        if (resultado.resultado === "motivo_invalido") {
          return {
            kind: "texto",
            texto: "Necesito un motivo (no vacío, hasta 256 caracteres) para iniciar la devolución.",
          };
        }
        if (resultado.resultado === "no_encontrada") {
          return { kind: "texto", texto: `No encontré ninguna venta ${ventaId}.` };
        }
        if (resultado.resultado === "no_autorizada") {
          registrarResultadoAccion(COMANDO_SOLICITAR_DEVOLUCION, RESULTADO_NO_AUTORIZADO, resultado.casoId, { ventaId }, input, deps);
          return { kind: "texto", texto: `La venta ${ventaId} no es tuya: no puedo iniciar una devolución sobre ella.` };
        }
        if (resultado.resultado !== "requiere_confirmacion") {
          return { kind: "texto", texto: "No se pudo procesar esa solicitud." };
        }
        const { venta } = resultado;
        return {
          kind: "confirmar",
          casoId: venta.casoId,
          eco: `Vas a iniciar una devolución para la venta ${ventaId} (cliente ${venta.clienteId}, plan ${venta.planNuevo}, monto ${formatMoney(venta.monto)}, estado ${venta.estado}). Esto queda pendiente de aprobación de un administrador distinto — no se devuelve la plata todavía. Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la iniciación.`,
        };
      },
      segundaEjecucion: (resultado) => {
        if (resultado.resultado === "escalada") {
          registrarResultadoAccion(COMANDO_SOLICITAR_DEVOLUCION, RESULTADO_ESCALADA, resultado.casoId, { ventaId }, input, deps);
          return `Listo: la devolución de la venta ${ventaId} quedó escalada, pendiente de que un administrador distinto la apruebe.`;
        }
        if (resultado.resultado === "no_autorizada") {
          registrarResultadoAccion(COMANDO_SOLICITAR_DEVOLUCION, RESULTADO_NO_AUTORIZADO, resultado.casoId, { ventaId }, input, deps);
          return `La venta ${ventaId} no es tuya: no puedo iniciar una devolución sobre ella.`;
        }
        if (resultado.resultado === "no_aplicable") {
          registrarResultadoAccion(COMANDO_SOLICITAR_DEVOLUCION, RESULTADO_NO_APLICABLE, resultado.casoId, { ventaId }, input, deps);
          return "No se pudo completar la iniciación: puede que la venta ya no esté en un estado válido para eso.";
        }
        return "No se pudo procesar esa solicitud.";
      },
    },
  );
}

/**
 * `devolucion-sin-token-dos-personas`, ADR 224 pto 4, ADR 225, ADR 229 pto 5,
 * ADR 230 pto 4, tarea 7. De sólo lectura, sin ranura de confirmación (no es
 * confirmable) y sin fila de auditoría en NINGUNA rama — `consultar_venta`
 * "no muta nada, y lo que divulga son datos propios del actor"
 * (`herramienta-operaciones-negocio`). **Cero lógica de alcance acá**: el
 * dispatcher delega ÍNTEGRO en `consultarVentaPropia` (tarea 6) — nunca
 * compara `vendedorId` con `empleadoId` (test mecánico).
 */
async function ejecutarConsultarVenta(
  operacion: OperacionConsultarVenta,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const resultado = consultarVentaPropia(
    { ...(operacion.ventaId !== undefined ? { ventaId: operacion.ventaId } : {}), empleadoId: input.sesion.empleadoId },
    { consulta: deps.consultaVentaPropia },
  );

  switch (resultado.resultado) {
    case "listado":
      if (resultado.items.length === 0) {
        return "No tenés ventas registradas.";
      }
      return resultado.items.map(formatearLineaVentaPropia).join("\n");
    case "no_encontrada":
      return `No encontré ninguna venta ${resultado.ventaId}.`;
    case "no_autorizada":
      return `La venta ${resultado.ventaId} no es tuya: no puedo mostrarte su estado.`;
    case "detalle":
      return formatearLineaVentaPropia(resultado.venta);
  }
}

/** Una línea por solicitud propia — listado. ★ SIN `dictamen` ni `detalle`: los dos son texto
 *  libre sin tope y un listado de hasta 20 los multiplicaría (RD-115 pto 1). NO comparte
 *  formateador con `formatearDetalleSolicitudPropia` — a propósito, `design.md` §7 pto 1. */
function formatearLineaSolicitudPropia(s: SolicitudPropia): string {
  return `- solicitud ${s.solicitudId} (${s.tipo}) | estado ${s.estado} | creada ${s.createdAt} | caso ${s.casoId}`;
}

/** Multilínea: cabecera + `detalle`, + `dictamen` si existe (SIN resumir, R8), + quién/cuándo la
 *  resolvió si existe. La línea `Dictamen:` se OMITE cuando no hay — no se escribe "sin
 *  dictamen" (`design.md` §7 pto 1). */
function formatearDetalleSolicitudPropia(s: SolicitudPropia): string {
  const lineas = [
    `solicitud ${s.solicitudId} (${s.tipo}) | estado ${s.estado} | creada ${s.createdAt} | caso ${s.casoId}`,
    `Detalle: ${s.detalle}`,
  ];
  if (s.dictamen !== undefined) {
    lineas.push(`Dictamen: ${s.dictamen}`);
  }
  if (s.resueltaPor !== undefined && s.resueltaAt !== undefined) {
    lineas.push(`Resuelta por ${s.resueltaPor} el ${s.resueltaAt}.`);
  }
  return lineas.join("\n");
}

/**
 * `consulta-solicitud-propia`, ADR 238, RD-115. De sólo lectura, sin ranura de confirmación (no
 * es confirmable) y sin fila de auditoría en NINGUNA rama: son datos que el propio empleado
 * escribió, leídos por él mismo. **Cero lógica de alcance acá**: el dispatcher delega ÍNTEGRO en
 * `consultarSolicitudPropia` (núcleo) — nunca compara la identidad de quien pidió la solicitud
 * con la del empleado de la sesión (test mecánico, tarea 5.1/5.7).
 */
function ejecutarConsultarSolicitud(
  operacion: OperacionConsultarSolicitud,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): string {
  const resultado = consultarSolicitudPropia(
    {
      ...(operacion.solicitudId !== undefined ? { solicitudId: operacion.solicitudId } : {}),
      empleadoId: input.sesion.empleadoId,
    },
    { consulta: deps.consultaSolicitudPropia },
  );

  switch (resultado.resultado) {
    case "listado":
      if (resultado.items.length === 0) {
        return "No tenés solicitudes internas registradas.";
      }
      return resultado.items.map(formatearLineaSolicitudPropia).join("\n");
    case "no_encontrada":
      return `No encontré ninguna solicitud ${resultado.solicitudId}.`;
    case "no_autorizada":
      return `La solicitud ${resultado.solicitudId} no es tuya: no puedo mostrarte su estado.`;
    case "detalle":
      return formatearDetalleSolicitudPropia(resultado.solicitud);
  }
}

/**
 * NUNCA lanza — cualquier error sincrónico o rechazo de una dependencia
 * inyectada (p. ej. `store.crearVentaConCaso` fallando ruidosamente) se
 * traduce a texto degradado, mismo contrato que `handleKnowledgeQuery`
 * (`adapters/knowledge/knowledge-tool.ts`).
 */
export async function ejecutarOperacion(
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  try {
    const { operacion } = input;

    switch (operacion.operacion) {
      case OPERACION_RESOLVER_DECISION_VENTA: {
        const confirmarDeps: ConfirmarVentaDeps = {
          store: deps.store,
          config: deps.config,
          newId: deps.newId,
          now: deps.now,
          logEvent: deps.logEvent,
        };
        const resultado = resolverDecisionVenta(
          { token: operacion.token, decision: operacion.decision },
          confirmarDeps,
        );
        registrar(
          { comando: COMANDO_RESOLVER_DECISION_VENTA, resultado: resultadoDecisionVentaAuditoria(resultado.resultado) },
          input.sesion,
          input.casoIdActual,
          deps,
        );
        return textoDecisionVenta(resultado);
      }

      case OPERACION_PROCESAR_DEVOLUCION: {
        const procesarDeps: ProcesarDevolucionDeps = {
          store: deps.store,
          config: deps.config,
          now: deps.now,
          logEvent: deps.logEvent,
        };
        const resultado = procesarDevolucion(
          {
            token: operacion.token,
            ...(operacion.motivo !== undefined ? { motivo: operacion.motivo } : {}),
          },
          procesarDeps,
        );
        registrar(
          {
            comando: COMANDO_DEVOLUCION,
            ...(resultado.ventaId !== undefined ? { ventaId: resultado.ventaId } : {}),
            ...(resultado.casoId !== undefined ? { casoId: resultado.casoId } : {}),
            resultado: resultadoDevolucionAuditoria(resultado.resultado),
          },
          input.sesion,
          input.casoIdActual,
          deps,
        );
        return textoDevolucion(resultado);
      }

      case OPERACION_CREAR_SOLICITUD_INTERNA: {
        const resultado = await crearSolicitudInterna(
          { tipo: operacion.tipo, detalle: operacion.detalle, solicitanteId: input.sesion.empleadoId },
          { store: deps.solicitudStore, despacharDeps: deps.despacharDeps },
        );
        if (resultado.resultado === "creada") {
          registrar(
            { comando: COMANDO_SOLICITAR, casoId: resultado.solicitud.casoId, resultado: RESULTADO_CREADA },
            input.sesion,
            input.casoIdActual,
            deps,
          );
        }
        return textoCrearSolicitudInterna(resultado);
      }

      case OPERACION_CANCELAR_SOLICITUD_INTERNA:
        return await ejecutarCancelarSolicitud(operacion.solicitudId, input, deps);

      case OPERACION_REGISTRAR_VENTA:
        return await ejecutarRegistrarVenta(operacion, input.sesion, input.casoIdActual, deps);

      case OPERACION_CONSULTAR_REPORTE_COMISIONES:
        return await ejecutarConsultarReporte(operacion.periodo, input.sesion, input.casoIdActual, deps);

      case OPERACION_RESOLVER_SOLICITUD:
        return await ejecutarResolverSolicitud(operacion, input, deps);

      case OPERACION_RESOLVER_REEMBOLSO:
        return await ejecutarResolverReembolso(operacion, input, deps);

      case OPERACION_SOLICITAR_DEVOLUCION:
        return await ejecutarSolicitarDevolucion(operacion, input, deps);

      case OPERACION_CONSULTAR_VENTA:
        return await ejecutarConsultarVenta(operacion, input, deps);

      case OPERACION_CONSULTAR_SOLICITUD:
        return ejecutarConsultarSolicitud(operacion, input, deps);

      default: {
        const _exhaustivo: never = operacion;
        return `Operación desconocida: ${String((_exhaustivo as { operacion: string }).operacion)}`;
      }
    }
  } catch (error) {
    deps.logEvent(input.casoIdActual, "operacion-fallida", {
      operacion: input.operacion.operacion,
      message: toErrorMessage(error),
    });
    return "No se pudo completar la operación por un error interno. Contá con que no se aplicó nada e intentá de nuevo.";
  }
}
