/**
 * Contrato del registro de acciones de empleado (`tui-canal-empleado`, ADR
 * 27, 39, 40). Sin imports — mismo criterio que `ventas-contract.ts`:
 * `src/core/` nunca importa de `src/adapters/*`, ni del SDK, ni de Node.
 */

/* ── Vocabulario de `registro_acciones_empleado.comando` ── */
export const COMANDO_LOGIN = "/login";
export const COMANDO_SOPORTE = "/soporte";
export const COMANDO_DEVOLUCION = "/devolucion";
export const COMANDO_APROBAR_REEMBOLSO = "/aprobar-reembolso";
export const COMANDO_RECHAZAR_REEMBOLSO = "/rechazar-reembolso";
export const COMANDO_REABRIR_REEMBOLSO = "/reabrir-reembolso";
export const COMANDO_SOLICITAR = "/solicitar";
export const COMANDO_APROBAR_SOLICITUD = "/aprobar-solicitud";
export const COMANDO_RECHAZAR_SOLICITUD = "/rechazar-solicitud";
export const COMANDO_VER_PROPUESTA = "/ver-propuesta";
export const COMANDO_APLICAR_PROPUESTA = "/aplicar-propuesta";
export const COMANDO_DESCARTAR_PROPUESTA = "/descartar-propuesta";
export const COMANDO_CONSULTAR_KPI = "/consultar-kpi"; // Hito 6, ADR 85
export const COMANDO_REPORTE_COMISIONES = "/reporte-comisiones"; // comando-reporte-comisiones, ADR 117
export const COMANDO_CANCELAR_SOLICITUD = "/cancelar-solicitud"; // v3.3.0
export const COMANDO_VER_SOLICITUDES_A2A = "/ver-solicitudes-a2a"; // v3.4.0
// Sin comando de TUI ancestro (ADR 188 pto 6/7, operaciones-negocio-conversacionales
// Enmienda 1): el prefijo `operacion:` deja constancia de que el disparo es
// exclusivamente conversacional, sin inventar un comando de TUI fantasma.
export const COMANDO_REGISTRAR_VENTA = "operacion:registrar_venta";
export const COMANDO_RESOLVER_DECISION_VENTA = "operacion:resolver_decision_venta";

/* ── Vocabulario de `registro_acciones_empleado.resultado` (tabla del ADR 27) ── */
export const RESULTADO_EXITOSA = "exitosa"; // /login
export const RESULTADO_ATENDIDA = "atendida"; // /soporte
export const RESULTADO_FALLIDA = "fallida"; // /soporte
export const RESULTADO_REEMBOLSADA = "reembolsada"; // /devolucion
export const RESULTADO_ESCALADA = "escalada"; // /devolucion
export const RESULTADO_APROBADA = "aprobada"; // /aprobar-reembolso
export const RESULTADO_RECHAZADA = "rechazada"; // /rechazar-reembolso
export const RESULTADO_REABIERTA = "reabierta"; // /reabrir-reembolso
export const RESULTADO_CREADA = "creada"; // /solicitar
export const RESULTADO_APLICADA = "aplicada"; // /aplicar-propuesta
export const RESULTADO_DESCARTADA = "descartada"; // /descartar-propuesta
export const RESULTADO_NO_APLICABLE = "no_aplicable";
export const RESULTADO_CANCELADA = "cancelada"; // /cancelar-solicitud (ADR 132/133)
export const RESULTADO_NO_AUTORIZADO = "no_autorizado"; // /aprobar-reembolso, /rechazar-reembolso, /reabrir-reembolso, /aprobar-solicitud, /rechazar-solicitud (autorizacion-empleado, ADR 161)
export const RESULTADO_AUTOAPROBACION_PROHIBIDA = "autoaprobacion_prohibida"; // /aprobar-solicitud, /rechazar-solicitud (autorizacion-empleado, ADR 161)
export const RESULTADO_CONFIRMADA = "confirmada"; // operacion:resolver_decision_venta (ADR 188 pto 6)

/**
 * Una fila del registro. `ventaId`/`casoId`/`propuestaId` son OPCIONALES
 * (columnas nullable): una consulta de soporte no tiene venta; una
 * devolución con token inválido no tiene ninguna de las tres.
 *
 * ★ LO QUE ESTE TIPO NO TIENE, Y NO PUEDE TENER (ADR 27) ★
 *   token_confirmacion · password · texto de la consulta · motivo del
 *   cliente. No hay campo donde meterlos. La garantía es estructural, no de
 *   disciplina.
 */
export interface AccionEmpleado {
  readonly id: string;
  /** SIEMPRE de una `SesionEmpleado` vigente (ADR 27 enmienda rev. 3, ADR 37). */
  readonly empleadoId: string;
  readonly comando: string;
  readonly ventaId?: string;
  readonly casoId?: string;
  /** Sólo para `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta` (ADR 63). */
  readonly propuestaId?: string;
  readonly resultado: string;
  readonly ocurridoAt: string;
}

/**
 * Escritura de las acciones que NO ocurren dentro de una transacción de
 * venta: `/login` exitoso, `/soporte`, `/devolucion` y los intentos
 * `no_aplicable`.
 *
 * CONTRATO DE FALLAS — asimétrico con `VentaNotifierPort` a propósito (ADR
 * 40): este puerto SÍ puede lanzar (es un `INSERT` síncrono de
 * `better-sqlite3`), y es el LLAMADOR (el dispatcher) el que envuelve la
 * llamada y degrada a un evento `accion-empleado-registro-fallido`. El
 * efecto de negocio ya ocurrió; perder la fila es R10, mentir sobre el
 * efecto no lo es.
 *
 * Las filas de una resolución EXITOSA de los TRES comandos de resolución NO
 * pasan por acá: viajan dentro de la transacción del CAS (`VentaStorePort`,
 * ADR 27). Un INTENTO RECHAZADO sí pasa por acá — igual que ya pasa un
 * intento rechazado por CAS-no-matcheado, un rechazo por rol (`no_autorizado`)
 * o por autoaprobación (`autoaprobacion_prohibida`) también se escribe fuera
 * de la transacción de dominio, vía este puerto (autorizacion-empleado, ADR
 * 161).
 */
export interface RegistroAccionesEmpleadoPort {
  registrarAccion(accion: AccionEmpleado): void;
}
