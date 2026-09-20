/**
 * Whitelist ESTRICTA por operación (`operaciones-negocio-conversacionales`,
 * ADR 163 pto 3, ADR 171 pto 2, ADR 174 pto 1, tarea 2). Sin imports — mismo
 * criterio que `operaciones-contract.ts` (tarea 1): el objeto zod plano del
 * adaptador MCP (tarea 4, Unit 2, fuera de esta Unit) ya validó tipos sueltos
 * por campo en el borde; ESTA es la SEGUNDA validación, la que exige
 * EXACTAMENTE el conjunto de campos de la fila que corresponde a `operacion`
 * y rechaza cualquier clave extra — el mismo espíritu de whitelist que
 * `definicion-skills` ADR 110 aplicó al frontmatter.
 *
 * Los nombres de operación y sus campos permitidos están DUPLICADOS acá,
 * literales, a propósito: este módulo no importa `operaciones-contract.ts`
 * (cero imports, mismo criterio "sin imports" de ese archivo, ver ASCII de
 * `design.md` §1) para que una whitelist de seguridad no dependa de una
 * resolución de módulos ajena — mismo criterio que `reporte.ts` documenta
 * para `PERIODO_REGEX` duplicado de `reporte-mensual.ts`.
 *
 * `empleadoId`/`vendedorId`/`solicitanteId`/`sesion`/`confirmado` NUNCA
 * aparecen en ninguna fila de `CAMPOS_POR_OPERACION` (ADR 147 pto 1, ADR 166
 * pto 1): cualquier operación que los reciba como clave los trata como
 * "clave extra" y rechaza — no hace falta una lista de bloqueo separada.
 */

/** Campos ACEPTADOS por operación, incluyendo `operacion` mismo y los opcionales. */
const CAMPOS_POR_OPERACION: Readonly<Record<string, readonly string[]>> = {
  resolver_decision_venta: ["operacion", "token", "decision"],
  procesar_devolucion: ["operacion", "token", "motivo"],
  crear_solicitud_interna: ["operacion", "tipo", "detalle"],
  cancelar_solicitud_interna: ["operacion", "solicitudId"],
  // ★ ÚNICA operación cuya whitelist incluye `monto` (ADR 170/171 pto 2) —
  // `vendedorId` NUNCA está acá, ni acá ni en ninguna otra fila (ADR 147
  // pto 1): sale del closure del composition root, jamás del modelo.
  registrar_venta: ["operacion", "clienteId", "clienteEmail", "planAnterior", "planNuevo", "monto", "vendedorNombre"],
  // ★ ÚNICA operación cuya whitelist incluye `periodo` (ADR 174 pto 1).
  consultar_reporte_comisiones: ["operacion", "periodo"],
  // `aprobacion-conversacional-hitl`, ADR 206/217 — solicitudId ausente = modo listado.
  resolver_solicitud: ["operacion", "accion", "solicitudId"],
  // `aprobacion-conversacional-hitl`, ADR 206/217 — ventaId ausente = modo listado.
  resolver_reembolso: ["operacion", "accion", "ventaId"],
  // `devolucion-sin-token-dos-personas`, ADR 223/228 — ventaId/motivo opcionales en el schema; la
  // obligatoriedad de `motivo` cuando hay `ventaId` es del núcleo (ADR 228 pto 2, paso 2), no de acá.
  solicitar_devolucion: ["operacion", "ventaId", "motivo"],
  // `devolucion-sin-token-dos-personas`, ADR 225/228 — sólo lectura, ventaId ausente = modo listado.
  consultar_venta: ["operacion", "ventaId"],
  // `consulta-solicitud-propia`, ADR 237/238/239 — sólo lectura, solicitudId ausente = modo listado.
  consultar_solicitud: ["operacion", "solicitudId"],
  // `visibilidad-a2a-entrante-chat`, ADR 240-242 — sólo lectura, a2aTaskId ausente = modo listado.
  ver_solicitudes_a2a: ["operacion", "a2aTaskId"],
};

/** Campos OBLIGATORIOS por operación — subconjunto de `CAMPOS_POR_OPERACION`, sin los opcionales. */
const CAMPOS_REQUERIDOS_POR_OPERACION: Readonly<Record<string, readonly string[]>> = {
  resolver_decision_venta: ["token", "decision"],
  procesar_devolucion: ["token"],
  crear_solicitud_interna: ["tipo", "detalle"],
  cancelar_solicitud_interna: [],
  registrar_venta: ["clienteId", "clienteEmail", "planNuevo", "monto", "vendedorNombre"],
  consultar_reporte_comisiones: [],
  resolver_solicitud: ["accion"],
  resolver_reembolso: ["accion"],
  solicitar_devolucion: [],
  consultar_venta: [],
  consultar_solicitud: [],
  ver_solicitudes_a2a: [],
};

/**
 * Tope de largo para todo campo string del objeto zod plano — mismo criterio
 * y mismo valor que `MAX_STRING_LENGTH` en `src/adapters/web/payloads.ts`
 * (R9: "se cierra por alcance, no por credulidad"). Duplicado literal a
 * propósito, mismo motivo "sin dependencias externas" documentado arriba
 * para `CAMPOS_POR_OPERACION`: esta es la validación estricta real (el
 * objeto zod del borde MCP sólo valida tipo/presencia, ADR 163 pto 3) y no
 * puede depender de que otro módulo se resuelva bien.
 *
 * Hallazgo de Reviewer (`operaciones-negocio-conversacionales`): el path
 * conversacional aceptaba strings de largo arbitrario donde el path HTTP
 * `/ventas` (`parseAltaVentaPayload`) ya los acotaba.
 */
const MAX_STRING_LENGTH = 256;

/**
 * Campos NUMÉRICOS por operación y su regla de rango — hoy sólo `monto` en
 * `registrar_venta` (ADR 170/171 pto 2). Mismo criterio que
 * `parseAltaVentaPayload` en `payloads.ts`: `typeof === "number"`, finito,
 * estrictamente positivo.
 *
 * Hallazgo de Reviewer: el path conversacional aceptaba `monto` no positivo
 * o no finito (0, negativo, `NaN`, `Infinity`) donde el path HTTP `/ventas`
 * ya lo rechazaba.
 */
const CAMPOS_NUMERICOS_POR_OPERACION: Readonly<Record<string, readonly string[]>> = {
  resolver_decision_venta: [],
  procesar_devolucion: [],
  crear_solicitud_interna: [],
  cancelar_solicitud_interna: [],
  registrar_venta: ["monto"],
  consultar_reporte_comisiones: [],
  resolver_solicitud: [],
  resolver_reembolso: [],
  solicitar_devolucion: [],
  consultar_venta: [],
  consultar_solicitud: [],
  ver_solicitudes_a2a: [],
};

/**
 * Cuarta tabla (ADR 217 pto 2-3): campos cuyo VALOR, no sólo su tipo/presencia,
 * está acotado a un conjunto cerrado — separa "acota forma" (zod, en el borde
 * MCP) de "acota significado" (acá). Sólo dos filas hoy: `resolver_decision_
 * venta.decision` (cierra la dependencia implícita de zod, aditivo, sin
 * cambio de comportamiento observable) y `resolver_solicitud.accion`.
 * ★ `"cancelar"` NUNCA entra en `resolver_solicitud.accion` — esa acción es
 * exclusiva de `cancelar_solicitud_interna`, un `switch` exhaustivo distinto
 * (ADR 217); incluirla acá permitiría que `resolver_solicitud
 * {accion:"cancelar"}` pasara esta validación y llegara al dispatcher, que la
 * rechazaría recién en un `switch` interno — falla cerrado por accidente, no
 * por diseño. Mismo criterio para `resolver_reembolso.accion` (tarea 12):
 * ★ `"cancelar"` NUNCA entra acá tampoco — esa acción sigue siendo exclusiva
 * de `cancelar_solicitud_interna`, sin excepción por dominio.
 */
export const VALORES_PERMITIDOS_POR_OPERACION: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  resolver_decision_venta: { decision: ["confirmar", "rechazar"] },
  resolver_solicitud: { accion: ["aprobar", "rechazar"] },
  resolver_reembolso: { accion: ["aprobar", "rechazar", "reabrir"] },
};

/**
 * Exportado ÚNICAMENTE para el test estructural de regresión (hallazgo
 * Reviewer, altura/robustez) que verifica que toda operación con un campo
 * "acción"/enum-like tiene su fila en `VALORES_PERMITIDOS_POR_OPERACION` —
 * NUNCA para uso en runtime fuera de este módulo (`validarOperacion` sigue
 * siendo la única función que consume esta tabla en producción). Exportar la
 * tabla no relaja el invariante "sin imports" (es sobre imports DENTRO de
 * este archivo, no sobre qué puede importar de él) ni cambia una sola línea
 * del hot path del dispatcher.
 */
export { CAMPOS_POR_OPERACION };

/**
 * `raw` es el objeto zod plano ya parseado por el adaptador MCP (tarea 4):
 * todos los campos posibles declarados opcionales a nivel del wrapper. Esta
 * función NUNCA lanza: devuelve el mismo objeto (referencia estable, sin
 * copiar) cuando es válido, o `undefined` cuando se rechaza — operación
 * desconocida, clave extra no permitida para esa fila, o falta un campo
 * requerido.
 */
export function validarOperacion(
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const operacion = raw["operacion"];
  if (typeof operacion !== "string" || !Object.hasOwn(CAMPOS_POR_OPERACION, operacion)) {
    return undefined;
  }

  const camposPermitidos = CAMPOS_POR_OPERACION[operacion];
  const camposRequeridos = CAMPOS_REQUERIDOS_POR_OPERACION[operacion];
  if (camposPermitidos === undefined || camposRequeridos === undefined) {
    // Inalcanzable: `Object.hasOwn` ya garantizó la clave en ambos records
    // (tienen las mismas once claves) — la guarda es sólo para satisfacer
    // `noUncheckedIndexedAccess`, no un camino real.
    return undefined;
  }

  const tieneClaveExtra = Object.keys(raw).some((clave) => !camposPermitidos.includes(clave));
  if (tieneClaveExtra) {
    return undefined;
  }

  const faltaRequerido = camposRequeridos.some((campo) => raw[campo] === undefined);
  if (faltaRequerido) {
    return undefined;
  }

  const camposNumericos = CAMPOS_NUMERICOS_POR_OPERACION[operacion] ?? [];
  const valoresPermitidos = VALORES_PERMITIDOS_POR_OPERACION[operacion];
  const tieneValorInvalido = camposPermitidos.some((campo) => {
    if (campo === "operacion") {
      return false;
    }
    const valor = raw[campo];
    if (valor === undefined) {
      return false;
    }
    if (camposNumericos.includes(campo)) {
      return typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0;
    }
    if (typeof valor !== "string" || valor.length > MAX_STRING_LENGTH) {
      return true;
    }
    const listaPermitida = valoresPermitidos?.[campo];
    if (listaPermitida !== undefined && !listaPermitida.includes(valor)) {
      return true;
    }
    return false;
  });
  if (tieneValorInvalido) {
    return undefined;
  }

  return raw;
}
