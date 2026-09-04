import {
  DECISION_CONFIRMAR,
  DECISION_RECHAZAR,
  type DecisionCliente,
} from "../../core/ventas/confirmar-venta.js";
import type { RegistrarVentaInput } from "../../core/ventas/registrar-venta.js";
import type { ParseResult } from "./body.js";

/**
 * Tope de largo para strings requeridos "opacos" (`vendedorId`, `clienteId`,
 * etc.) — design.md §4.3: "R9 se cierra por alcance, no por credulidad". No
 * es un tope de dominio, es un tope de "esto no es un ataque de payload
 * gigante disfrazado de string".
 */
const MAX_STRING_LENGTH = 256;

/** Tope de recorte de `motivo` en `parseDevolucionPayload` (ADR 19). */
const MAX_MOTIVO_LENGTH = 500;

/** Narrows `unknown` to a plain record, sin asumir nada sobre sus claves. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `typeof === "string"` y no vacío tras `trim()`. Sin tope de largo. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Regla general de "strings requeridos" del §4.3: presente, `typeof ===
 * "string"`, no vacío tras `trim()`, y bajo el tope de 256 caracteres.
 * Aplica a los 5 strings requeridos de `parseAltaVentaPayload` (incluido
 * `clienteEmail`, que además NO se valida contra un regex de email) y a
 * `planAnterior` cuando viene presente.
 */
function isValidBoundedString(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_STRING_LENGTH;
}

/**
 * `{ vendedorId, vendedorNombre, clienteId, clienteEmail, planAnterior?,
 * planNuevo, monto }` (design.md §4.3). Ver ahí las validaciones exactas:
 * strings requeridos bajo tope de 256, `monto` numérico sin coerción,
 * `clienteEmail` sin regex.
 */
export function parseAltaVentaPayload(payload: unknown): ParseResult<RegistrarVentaInput> {
  if (!isRecord(payload)) {
    return { ok: false, motivo: "payload invalido" };
  }

  const { vendedorId, vendedorNombre, clienteId, clienteEmail, planAnterior, planNuevo, monto } =
    payload;

  if (!isValidBoundedString(vendedorId)) {
    return { ok: false, motivo: "vendedorId invalido" };
  }
  if (!isValidBoundedString(vendedorNombre)) {
    return { ok: false, motivo: "vendedorNombre invalido" };
  }
  if (!isValidBoundedString(clienteId)) {
    return { ok: false, motivo: "clienteId invalido" };
  }
  if (!isValidBoundedString(clienteEmail)) {
    return { ok: false, motivo: "clienteEmail invalido" };
  }
  if (!isValidBoundedString(planNuevo)) {
    return { ok: false, motivo: "planNuevo invalido" };
  }
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto <= 0) {
    return { ok: false, motivo: "monto invalido" };
  }
  if (planAnterior !== undefined && !isValidBoundedString(planAnterior)) {
    return { ok: false, motivo: "planAnterior invalido" };
  }

  return {
    ok: true,
    valor: {
      vendedorId,
      vendedorNombre,
      clienteId,
      clienteEmail,
      ...(planAnterior !== undefined ? { planAnterior } : {}),
      planNuevo,
      monto,
    },
  };
}

/**
 * `{ token, motivo? }` (ADR 19). `motivo` opcional, recortado a 500 chars,
 * nunca persistido (el recorte lo hace este parser, no el `store`).
 */
export function parseDevolucionPayload(
  payload: unknown,
): ParseResult<{ token: string; motivo?: string }> {
  if (!isRecord(payload)) {
    return { ok: false, motivo: "payload invalido" };
  }

  const { token, motivo } = payload;
  if (!isNonEmptyString(token)) {
    return { ok: false, motivo: "token invalido" };
  }
  if (motivo !== undefined && typeof motivo !== "string") {
    return { ok: false, motivo: "motivo invalido" };
  }

  return {
    ok: true,
    valor: {
      token,
      ...(motivo !== undefined ? { motivo: motivo.slice(0, MAX_MOTIVO_LENGTH) } : {}),
    },
  };
}

/**
 * `{ consulta }`. `consulta` string no vacío; el truncado real (por
 * longitud de prompt) lo hace `buildSoportePrompt`, no este parser.
 */
export function parseSoportePayload(payload: unknown): ParseResult<{ consulta: string }> {
  if (!isRecord(payload)) {
    return { ok: false, motivo: "payload invalido" };
  }

  const { consulta } = payload;
  if (!isNonEmptyString(consulta)) {
    return { ok: false, motivo: "consulta invalida" };
  }

  return { ok: true, valor: { consulta } };
}

/**
 * `application/x-www-form-urlencoded` del formulario HTML: `decision=confirmar|rechazar`.
 * Cualquier otro valor (incluida su ausencia) → `{ ok: false }`, que el
 * ruteador convierte en la MISMA página genérica que un token inválido (R6:
 * sin oráculos).
 */
export function parseDecisionForm(campos: URLSearchParams): ParseResult<DecisionCliente> {
  const decision = campos.get("decision");
  if (decision === DECISION_CONFIRMAR || decision === DECISION_RECHAZAR) {
    return { ok: true, valor: decision };
  }
  return { ok: false, motivo: "decision invalida" };
}
