import { RUTA_JSONRPC, type A2AServerConfig } from "./server-config.js";

/**
 * Agent Card servido en `RUTA_AGENT_CARD` (Hito 7, tarea 4, design.md §6.2,
 * ADR 92, ADR 96).
 *
 * `construirAgentCard` es PURA — sin I/O, sin reloj — se testea comparando el
 * objeto entero contra un literal (ADR 96 pto 1). Los siete campos
 * requeridos van todos con valores fijos de módulo, ninguno del modelo. Los
 * strings van en castellano, mismo criterio que el resto del dominio del
 * repo (ADR 96 pto 2).
 *
 * `preferredTransport`/`additionalInterfaces` NO se emiten a propósito (ADR
 * 96 pto 6): esos campos no existen en la especificación A2A v1.0.0 —
 * emitirlos reintroduciría del lado servidor el error que el Cliente A2A del
 * Hito 6 ya corrigió (RD-24).
 */

export interface AgentCardCapabilities {
  readonly streaming: boolean;
  readonly pushNotifications: boolean;
  readonly extendedAgentCard: boolean;
}

export interface AgentCardSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples: readonly string[];
}

export interface AgentCardSupportedInterface {
  readonly protocolBinding: "JSONRPC";
  readonly url: string;
}

export interface AgentCardSecuritySchemeBearer {
  readonly type: "http";
  readonly scheme: "bearer";
}

export interface AgentCardSecuritySchemes {
  readonly bearer: AgentCardSecuritySchemeBearer;
}

export interface AgentCardJson {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly capabilities: AgentCardCapabilities;
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly [AgentCardSkill];
  readonly supportedInterfaces: readonly [AgentCardSupportedInterface];
  readonly securitySchemes: AgentCardSecuritySchemes;
}

const NOMBRE = "Arnés Empresarial";

const DESCRIPCION =
  "Arnés de agentes de IA de una empresa. Responde consultas sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas.";

const VERSION = "3.0.0";

const CAPABILITIES: AgentCardCapabilities = {
  streaming: false,
  pushNotifications: false,
  extendedAgentCard: false,
};

const MODOS: readonly string[] = ["text/plain"];

/**
 * La única skill del card — una skill verdadera, no tres falsas (ADR 92 pto
 * 5-7). `"solo-lectura"` como tag y la frase equivalente en la
 * `description` no son decoración: son la declaración pública del límite de
 * alcance del que depende el ADR 90 (sin cola) — ver ADR 96 pto 3.
 */
const SKILL_CONSULTA_ARNES: AgentCardSkill = {
  id: "consulta-arnes",
  name: "Consulta al arnés empresarial",
  description:
    "Respondé una consulta en lenguaje natural sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas en el arnés. Es una consulta de sólo lectura: el arnés no modifica nada a pedido de un agente externo.",
  tags: ["consulta", "estado", "proyectos", "incidentes", "solo-lectura"],
  examples: [
    "¿En qué estado está la revisión del PR 42 del proyecto X?",
    "¿Qué incidentes abiertos hay hoy?",
    "¿Cuántas ventas quedaron pendientes de confirmación esta semana?",
  ],
};

const SECURITY_SCHEMES: AgentCardSecuritySchemes = {
  bearer: { type: "http", scheme: "bearer" },
};

/**
 * PURA, sin I/O ni reloj: de `config` a `AgentCardJson`. `supportedInterfaces`
 * trae una sola entrada `JSONRPC` con `url = config.publicUrl + RUTA_JSONRPC`
 * — es un requirement, no una preferencia (ADR 96 pto 4): `extraerEndpointJsonRpc`
 * (`client.ts`, Hito 6) exige exactamente esa forma para poder delegar.
 */
export function construirAgentCard(config: A2AServerConfig): AgentCardJson {
  return {
    name: NOMBRE,
    description: DESCRIPCION,
    version: VERSION,
    capabilities: CAPABILITIES,
    defaultInputModes: MODOS,
    defaultOutputModes: MODOS,
    skills: [SKILL_CONSULTA_ARNES],
    supportedInterfaces: [{ protocolBinding: "JSONRPC", url: `${config.publicUrl}${RUTA_JSONRPC}` }],
    securitySchemes: SECURITY_SCHEMES,
  };
}
