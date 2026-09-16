import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  OPERACIONES_MCP_SERVER_NAME,
  OPERACIONES_NEGOCIO,
  OPERACIONES_TOOL_NAME,
  type ConfirmacionOperacionPort,
  type OperacionNegocio,
} from "../../core/operaciones/operaciones-contract.js";
import { validarOperacion } from "../../core/operaciones/validar-operacion.js";
import type { EjecutarOperacionInput } from "../../core/operaciones/ejecutar-operacion.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";

/**
 * Adaptador MCP de la herramienta de operaciones de negocio
 * (`operaciones-negocio-conversacionales`, ADR 163/167, tarea 4). Molde
 * exacto de `adapters/knowledge/index.ts`: un `createSdkMcpServer` con UNA
 * tool, cuyo handler NUNCA lanza — cualquier falla se traduce a texto
 * degradado (mismo contrato que `handleKnowledgeQuery`).
 *
 * A diferencia de `createKnowledgeAdapter` (que construye su propia lógica
 * de negocio internamente), acá el handler es un delegador puro: valida el
 * objeto zod plano con `validar-operacion.ts` (whitelist estricta, tarea 2)
 * y, si pasa, delega en `deps.ejecutar` — la partial-application de
 * `ejecutarOperacion` (tarea 3) que `build-on-operaciones-empleado.ts`
 * (tarea 5) arma por turno, ya cerrada sobre `EjecutarOperacionDeps`. Este
 * módulo no conoce `EjecutarOperacionDeps` en absoluto — solo el tipo de
 * entrada que `ejecutarOperacion` espera (`EjecutarOperacionInput`).
 *
 * `casoId`/`sesion`/`confirmacion` se reciben una vez, en la construcción
 * (igual que `createKnowledgeAdapter` recibe `casoId`): este adaptador se
 * arma por turno, nunca se reusa entre turnos ni entre empleados.
 */

export interface OperacionesAdapterDeps {
  /** `casoId` del turno actual — via a `EjecutarOperacionInput.casoIdActual` (ADR 166 pto 3). */
  readonly casoId: string;
  /** SIEMPRE de una sesión autenticada (ADR 37/147 pto 1) — nunca del modelo. */
  readonly sesion: SesionEmpleado;
  readonly confirmacion: ConfirmacionOperacionPort;
  /**
   * Partial-application de `ejecutarOperacion` con `EjecutarOperacionDeps` ya
   * cerrado (armada por `build-on-operaciones-empleado.ts`). NUNCA lanza —
   * mismo contrato que `ejecutarOperacion` documenta — pero este módulo se
   * defiende igual (try/catch alrededor de la invocación) para no depender
   * únicamente de esa promesa documentada.
   */
  readonly ejecutar: (input: EjecutarOperacionInput) => Promise<string>;
}

export interface OperacionesAdapter {
  /** Listo para `HandleTurnDeps.mcpServers` / `options.mcpServers`. */
  readonly mcpServers: NonNullable<Options["mcpServers"]>;
}

const REJECTION_TEXT =
  "SOLICITUD INVÁLIDA: la operación indicada no existe, o los datos que diste no coinciden exactamente con los que esa operación necesita (te falta un dato obligatorio, o incluiste uno que no corresponde). Pedile al empleado los datos correctos antes de reintentar — no inventes ni completes ningún valor por tu cuenta.";

const DEGRADED_TEXT =
  "No se pudo completar la operación por un error interno. Contá con que no se aplicó nada e intentá de nuevo.";

function toCallToolResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

/** Objeto zod plano en el borde MCP (ADR 163 pto 3): TODOS los campos posibles, opcionales a este nivel — `validar-operacion.ts` es la validación estricta real. */
const OPERACIONES_TOOL_SCHEMA = {
  operacion: z.enum(OPERACIONES_NEGOCIO),
  token: z.string().optional(),
  decision: z.enum(["confirmar", "rechazar"]).optional(),
  motivo: z.string().optional(),
  tipo: z.string().optional(),
  detalle: z.string().optional(),
  solicitudId: z.string().optional(),
  clienteId: z.string().optional(),
  clienteEmail: z.string().optional(),
  planAnterior: z.string().optional(),
  planNuevo: z.string().optional(),
  monto: z.number().optional(),
  vendedorNombre: z.string().optional(),
  periodo: z.string().optional(),
  /**
   * `aprobacion-conversacional-hitl`, ADR 217 pto 3 — enum ampliado en la
   * tarea 12 para incluir "reabrir" (dominio reembolso, Unit 4), además de
   * "aprobar"/"rechazar" (dominio solicitud, Unit 3). "acota forma" (zod,
   * acá) es deliberadamente más laxo que "acota significado"
   * (`VALORES_PERMITIDOS_POR_OPERACION`, `validar-operacion.ts`, que sí
   * distingue qué acción vale para cada operación — `resolver_solicitud`
   * sigue sin aceptar "reabrir" a ese nivel, aunque el zod plano ya lo deje
   * pasar).
   */
  accion: z.enum(["aprobar", "rechazar", "reabrir"]).optional(),
  /** `aprobacion-conversacional-hitl`, ADR 206/217, tarea 12 — ausente = modo listado (mismo criterio que `solicitudId`). */
  ventaId: z.string().optional(),
};

/** Exportado para test directo del schema zod (aprobacion-conversacional-hitl, tarea 8) — la forma en el borde MCP, sin pasar por el handler. */
export const OPERACIONES_TOOL_ZOD_SCHEMA = z.object(OPERACIONES_TOOL_SCHEMA);

/**
 * Exportado para test directo del contenido del prompt (aprobacion-conversacional-hitl,
 * tarea 15, molde `OPERACIONES_TOOL_ZOD_SCHEMA` de la tarea 8) — mismo criterio de
 * exportar constantes de sólo-lectura para verificación de contenido sin pasar por
 * el registro MCP.
 *
 * `aprobacion-conversacional-hitl`, tarea 15 (ADR 220 pto 1-3): suma la frase sobre
 * `accion` inequívoca, texto literal compartido con `INSTRUCCION_OPERACIONES_EMPLEADO`
 * (`definitions.ts`) y `buildOperacionesEmpleadoPrompt` (`soporte-prompt.ts`).
 */
export const OPERACIONES_TOOL_DESCRIPTION =
  "Ejecutá una operación de negocio en nombre del empleado autenticado de este turno: " +
  "resolver una decisión de venta ya tomada por el cliente, procesar una devolución, " +
  "crear o cancelar una solicitud interna propia, registrar una venta nueva ya pactada " +
  "con el cliente, resolver (aprobar/rechazar) una solicitud interna ajena escalada, " +
  "resolver (aprobar/rechazar/reabrir) una escalación de reembolso ajena, " +
  "o consultar el reporte de comisiones de un período. Nunca calculás " +
  "ni proponés vos un monto, porcentaje o veredicto — eso lo hace esta herramienta. " +
  "Cuando el empleado te pida resolver una solicitud (`aprobar` o `rechazar`) o un " +
  "reembolso (`aprobar`, `rechazar` o `reabrir`), la acción tiene que salir de una " +
  "frase inequívoca del empleado. Si dice algo ambiguo —'resolvelo', 'dale', 'hacé lo que corresponda', " +
  "'fijate vos'— preguntá cuál de las acciones quiere en vez de elegir una. Nunca " +
  "elegís vos la acción, ni la deducís del contexto, ni del dictamen, ni de lo que " +
  "parezca más razonable. Si la respuesta pide confirmación, comunicásela al " +
  "empleado tal cual y esperá que te lo vuelva a pedir en un mensaje nuevo antes " +
  "de invocar la misma operación otra vez.";

/**
 * Builds an `OperacionesAdapter`: an in-process MCP server exposing the
 * `operacion_negocio` tool. `deps.ejecutar` NUNCA se invoca para un `raw`
 * que `validarOperacion` rechaza (tarea 4, test primero).
 */
export function createOperacionesAdapter(deps: OperacionesAdapterDeps): OperacionesAdapter {
  const mcpServer = createSdkMcpServer({
    name: OPERACIONES_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      tool(OPERACIONES_TOOL_NAME, OPERACIONES_TOOL_DESCRIPTION, OPERACIONES_TOOL_SCHEMA, async (args) => {
        const validado = validarOperacion(args as Readonly<Record<string, unknown>>);
        if (validado === undefined) {
          return toCallToolResult(REJECTION_TEXT);
        }

        try {
          // Casteo deliberado: `validarOperacion` no importa
          // `operaciones-contract.ts` (whitelist "sin imports", tarea 2) así
          // que no puede devolver el tipo de la unión discriminada — pero YA
          // garantizó, campo por campo, que `validado` tiene exactamente la
          // forma de una de las ocho variantes de `OperacionNegocio`.
          const operacion = validado as unknown as OperacionNegocio;
          const texto = await deps.ejecutar({
            operacion,
            sesion: deps.sesion,
            confirmacion: deps.confirmacion,
            casoIdActual: deps.casoId,
          });
          return toCallToolResult(texto);
        } catch {
          // Defensa adicional: `ejecutarOperacion` real nunca lanza, pero
          // este adaptador no depende únicamente de esa promesa documentada
          // (mismo criterio que `handleKnowledgeQuery`).
          return toCallToolResult(DEGRADED_TEXT);
        }
      }),
    ],
  });

  return {
    mcpServers: { [OPERACIONES_MCP_SERVER_NAME]: mcpServer },
  };
}
