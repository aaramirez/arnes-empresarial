/**
 * Ejecución de las seis operaciones del contrato (`operaciones-contract.ts`,
 * tarea 1) — dispatch puro hacia los casos de uso/funciones YA EXISTENTES de
 * `core/ventas`/`core/solicitudes`, SIN modificarlos (ADR 145 pto 5, ADR 167,
 * ADR 170/171/174, tarea 3). Traduce cada `Result` discriminado a texto para
 * el modelo, molde `knowledge-tool.ts` — NUNCA lanza, en ningún camino, ni
 * siquiera si una dependencia inyectada lanza sincrónicamente (mismo criterio
 * que `handleKnowledgeQuery`).
 *
 * Imports: `operaciones-contract.ts` (tarea 1, mismo directorio, para el tipo
 * de la unión discriminada y `ConfirmacionOperacionPort`) + los seis casos de
 * uso/funciones puras de `core/ventas`/`core/solicitudes` que este módulo
 * despacha, sin tocarlos. Ningún import de `src/adapters/*` ni del SDK
 * (regla no negociable de `AGENTS.md`).
 */
import {
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_RESOLVER_DECISION_VENTA,
  type ConfirmacionOperacionPort,
  type OperacionNegocio,
  type OperacionRegistrarVenta,
} from "./operaciones-contract.js";
import { resolverDecisionVenta, type ConfirmarVentaDeps, type DecisionVentaResult } from "../ventas/confirmar-venta.js";
import { procesarDevolucion, type DevolucionResult, type ProcesarDevolucionDeps } from "../ventas/procesar-devolucion.js";
import { registrarVenta, type RegistrarVentaDeps } from "../ventas/registrar-venta.js";
import {
  type ConsultaRiesgoCreditoPort,
  type VentaNotifierPort,
  type VentaStorePort,
} from "../ventas/ventas-contract.js";
import { type VentasConfig } from "../ventas/ventas-config.js";
import { crearSolicitudInterna, type CrearSolicitudInternaResult } from "../solicitudes/crear-solicitud-interna.js";
import {
  ACCION_CANCELAR_SOLICITUD,
  resolverSolicitudInterna,
  type ResolverSolicitudDeps,
} from "../solicitudes/resolver-solicitud-interna.js";
import { type SolicitudStorePort } from "../solicitudes/solicitudes-contract.js";
import type { RolEmpleadoPort } from "../auth/rol-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";
import { agruparReporteMensual, formatearReporteMensual, resolverPeriodoReporte } from "../ventas/reporte.js";
import { type ReporteStorePort } from "../ventas/reporte-contract.js";
import { type DespacharDelegacionDeps } from "../turn-selector/dispatch-delegation.js";
import { MOTIVO_CAS } from "../hitl/hitl-contract.js";
import {
  COMANDO_CANCELAR_SOLICITUD,
  COMANDO_DEVOLUCION,
  COMANDO_REGISTRAR_VENTA,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_RESOLVER_DECISION_VENTA,
  COMANDO_SOLICITAR,
  RESULTADO_ATENDIDA,
  RESULTADO_CONFIRMADA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_NO_APLICABLE,
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
 * Secuencia exacta (ADR 166, tasks.md tarea 3 punto 3): sin `solicitudId` ⇒
 * listado, SIN tocar la ranura. Con `solicitudId` y `confirmacion.estaConfirmada`
 * `false` ⇒ `requiere_confirmacion` + `marcarPendiente({..., origenCasoId})`.
 * Con `estaConfirmada` `true` ⇒ se CONSUME antes de ejecutar (mismo orden que
 * `manejarResolucionSolicitud`, `build-on-comando-empleado.ts`) y se aplica el
 * CAS con `confirmado: true`.
 */
async function ejecutarCancelarSolicitud(
  solicitudId: string | undefined,
  input: EjecutarOperacionInput,
  deps: EjecutarOperacionDeps,
): Promise<string> {
  const resolverDeps: ResolverSolicitudDeps = {
    store: deps.solicitudStore,
    newId: deps.newId,
    now: deps.now,
    logEvent: deps.logEvent,
    rolPort: deps.rolPort,
  };

  if (solicitudId === undefined) {
    const resultado = resolverSolicitudInterna(
      { accion: ACCION_CANCELAR_SOLICITUD, confirmado: false, sesion: input.sesion },
      resolverDeps,
    );
    if (resultado.resultado !== "listado") {
      return "No se pudo listar tus solicitudes pendientes.";
    }
    if (resultado.items.length === 0) {
      return "No tenés solicitudes pendientes para cancelar.";
    }
    return resultado.items.map((item) => `- ${item.id} (${item.tipo}): ${item.detalle}`).join("\n");
  }

  const yaConfirmada = input.confirmacion.estaConfirmada(solicitudId, input.sesion.empleadoId, input.casoIdActual);

  if (!yaConfirmada) {
    const resultado = resolverSolicitudInterna(
      { accion: ACCION_CANCELAR_SOLICITUD, solicitudId, confirmado: false, sesion: input.sesion },
      resolverDeps,
    );

    if (resultado.resultado === "no_aplicable" || resultado.resultado === "no_es_dueno") {
      return `No hay ninguna solicitud ${solicitudId} tuya pendiente de cancelación.`;
    }
    if (resultado.resultado !== "requiere_confirmacion") {
      return "No se pudo procesar esa cancelación.";
    }

    input.confirmacion.marcarPendiente({
      solicitudId,
      casoId: resultado.item.casoId,
      empleadoId: input.sesion.empleadoId,
      origenCasoId: input.casoIdActual,
    });
    return `Vas a cancelar la solicitud ${solicitudId} (${resultado.item.detalle}). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la cancelación.`;
  }

  // Coincide: se CONSUME antes de ejecutar (ADR 36, mismo orden que la TUI).
  input.confirmacion.consumir();
  const resultado = resolverSolicitudInterna(
    { accion: ACCION_CANCELAR_SOLICITUD, solicitudId, confirmado: true, sesion: input.sesion },
    resolverDeps,
  );

  if (resultado.resultado === "aplicada") {
    return `Listo: la solicitud ${solicitudId} quedó ${resultado.estadoFinal}.`;
  }
  // Camino CAS-perdido (ADR 188 hallazgo 1): la ÚNICA rama de esta operación
  // que audita desde acá — el camino feliz de arriba ya viajó dentro de la
  // transacción de `cancelarSolicitudInterna` (`repository.ts`), auditarlo
  // de nuevo lo DUPLICARÍA. `MOTIVO_NO_ENCONTRADA`/`no_es_dueno` no llegan a
  // este punto (ya fueron devueltos por el `if` de más arriba del CAS
  // perdido de `resolverSolicitudInterna` en los pasos previos de esta
  // función), pero el guard de `motivo`/`casoId` deja explícito que sólo el
  // CAS perdido con `casoId` conocido escribe fila.
  if (resultado.resultado === "no_aplicable" && resultado.motivo === MOTIVO_CAS && resultado.casoId !== undefined) {
    registrar(
      { comando: COMANDO_CANCELAR_SOLICITUD, casoId: resultado.casoId, resultado: RESULTADO_NO_APLICABLE },
      input.sesion,
      input.casoIdActual,
      deps,
    );
  }
  return "No se pudo completar la cancelación: puede que ya no esté pendiente.";
}

/**
 * ADR 171 pto 2/5, ADR 170 pto 5: `vendedorId` sale de `sesion.empleadoId`
 * (closure), NUNCA de `operacion` — que ni siquiera tiene ese campo
 * (garantía estructural, `operaciones-contract.ts`). `monto` viaja de
 * `operacion.monto` a `registrarVenta` sin ninguna operación aritmética
 * intermedia — comparación `===` estricta, verificada por
 * `ejecutar-operacion.test.ts`.
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
  return `Venta ${resultado.ventaId} registrada (caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.`;
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
