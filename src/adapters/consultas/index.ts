import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  CONSULTAS_MCP_SERVER_NAME,
  CONSULTAS_NEGOCIO_OPERACIONES,
  CONSULTAS_TOOL_NAME,
  handleConsultaNegocio,
  type ConsultasNegocioToolDeps,
} from "../../core/agents/consultas-negocio-tool.js";

/**
 * Adaptador MCP de las consultas de negocio de sólo lectura para el turno
 * A2A entrante (`consultas-negocio-a2a-entrante`, tarea 6, PR4, ADR
 * 178/181/184). Molde exacto de `adapters/knowledge/index.ts` y
 * `adapters/operaciones/index.ts`: un `createSdkMcpServer` con UNA tool,
 * cuyo handler es un delegador puro — no reimplementa ninguna validación ni
 * orquestación, sólo pasa el objeto zod plano (`args`) tal cual a
 * `handleConsultaNegocio` (tarea 5), que ya hace `validarConsultaNegocio`
 * primero (tarea 4) por su cuenta.
 *
 * A diferencia de `KnowledgeAdapter` (`{ mcpServers, feedback }`), este
 * adaptador tiene UN SOLO CAMPO: `mcpServers` (ADR 181). Ninguna de las
 * cuatro operaciones de sólo lectura cita nodos de un vault ni acumula
 * estado que drenar al cerrar el turno — no hay nada que un `feedback`
 * pudiera drenar. Por eso este módulo tampoco importa
 * `KnowledgeFeedbackPort` (ADR 181 pto 3).
 *
 * Schema del wrapper (ADR 184 pto 2): `operacion` es el único campo
 * requerido (enum cerrado de las cuatro operaciones); `periodo`,
 * `proyectoId` y `referenciaExterna` son opcionales A NIVEL DE ESTE
 * WRAPPER — la forma laxa que el modelo puede mandar. La validación
 * ESTRICTA (exactamente los campos de la operación pedida, sin claves
 * extra) vive en `validarConsultaNegocio`, dentro de `handleConsultaNegocio`
 * — este adaptador no la duplica.
 */

export interface ConsultasNegocioAdapter {
  /** Listo para `HandleTurnDeps.mcpServers` / `options.mcpServers`. */
  readonly mcpServers: NonNullable<Options["mcpServers"]>;
}

/** Objeto zod plano en el borde MCP (ADR 184 pto 2) — forma laxa, sin whitelist estricta. */
const CONSULTAS_TOOL_SCHEMA = {
  operacion: z.enum(CONSULTAS_NEGOCIO_OPERACIONES),
  periodo: z.string().optional(),
  proyectoId: z.string().optional(),
  referenciaExterna: z.string().optional(),
};

const CONSULTAS_TOOL_DESCRIPTION =
  "Consultá información de negocio de sólo lectura: el reporte agregado de comisiones " +
  "de un período, el estado de una actividad de desarrollo (PR) por proyecto y " +
  "referencia externa, las solicitudes internas pendientes de aprobación, o los " +
  "reembolsos pendientes de aprobación. Nunca modifica nada ni devuelve datos " +
  "personales de empleados o clientes.";

function toCallToolResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

/**
 * Builds a `ConsultasNegocioAdapter`: an in-process MCP server exposing the
 * `consultar_negocio` tool. `deps` se recibe una vez, en la construcción
 * (mismo criterio que `createKnowledgeAdapter`/`createOperacionesAdapter`
 * reciben sus colaboradores) — este adaptador se arma por turno.
 */
export function createConsultasAdapter(deps: ConsultasNegocioToolDeps): ConsultasNegocioAdapter {
  const mcpServer = createSdkMcpServer({
    name: CONSULTAS_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      tool(CONSULTAS_TOOL_NAME, CONSULTAS_TOOL_DESCRIPTION, CONSULTAS_TOOL_SCHEMA, async (args) => {
        const texto = await handleConsultaNegocio(args as Readonly<Record<string, unknown>>, deps);
        return toCallToolResult(texto);
      }),
    ],
  });

  return {
    mcpServers: { [CONSULTAS_MCP_SERVER_NAME]: mcpServer },
  };
}
