import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `createConsultasAdapter` (`consultas-negocio-a2a-entrante`,
 * tarea 6, PR4, ADR 178/181/184). Molde exacto de
 * `adapters/knowledge/index.test.ts` / `adapters/operaciones/index.test.ts`
 * para la parte estructural (invocar el handler REAL vía `_registeredTools`,
 * bypaseando el protocolo MCP), pero suma un segundo helper para el test de
 * "mitad de núcleo obligatorio 1" — ver `invokeConsultasToolsCallRequest`
 * abajo, que sí necesita el camino completo del SDK.
 */

const { handleConsultaNegocioMock } = vi.hoisted(() => ({
  handleConsultaNegocioMock: vi.fn(),
}));

vi.mock("../../core/agents/consultas-negocio-tool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/agents/consultas-negocio-tool.js")>();
  return {
    ...actual,
    handleConsultaNegocio: handleConsultaNegocioMock,
  };
});

import {
  CONSULTAS_MCP_SERVER_NAME,
  CONSULTAS_TOOL_NAME,
  type ConsultasNegocioToolDeps,
} from "../../core/agents/consultas-negocio-tool.js";
import { createConsultasAdapter } from "./index.js";

function makeDeps(overrides: Partial<ConsultasNegocioToolDeps> = {}): ConsultasNegocioToolDeps {
  return {
    casoId: "caso-1",
    reporteStore: {
      listComisionesPorPeriodo: vi.fn().mockReturnValue([]),
      listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([]),
    },
    actividadPort: {
      buscarPorReferencia: vi.fn().mockReturnValue(undefined),
    },
    solicitudesPort: {
      listarPendientes: vi.fn().mockReturnValue([]),
    },
    reembolsosPort: {
      listPendientes: vi.fn().mockReturnValue([]),
    },
    logEvent: vi.fn(),
    ...overrides,
  };
}

/**
 * Invoca el handler REAL registrado por `tool()` a través de
 * `_registeredTools`, bypaseando el protocolo MCP — mismo criterio ya
 * documentado en `adapters/knowledge/index.test.ts`. Sólo sirve para probar
 * la DELEGACIÓN (el wrapper zod ya no interviene en este camino), nunca para
 * el test de rechazo de esquema.
 */
async function invokeConsultasHandlerDirect(
  adapter: ReturnType<typeof createConsultasAdapter>,
  args: Readonly<Record<string, unknown>>,
): Promise<{ readonly content: readonly [{ readonly type: "text"; readonly text: string }] }> {
  const server = adapter.mcpServers[CONSULTAS_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly _registeredTools: Record<
        string,
        { readonly handler: (args: unknown, extra: unknown) => Promise<unknown> }
      >;
    };
  };
  const registeredTool = server.instance._registeredTools[CONSULTAS_TOOL_NAME];
  if (registeredTool === undefined) {
    throw new Error(`test setup error: tool "${CONSULTAS_TOOL_NAME}" was not registered`);
  }
  return (await registeredTool.handler(args, {})) as {
    readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  };
}

/**
 * Invoca el camino COMPLETO de una request MCP `tools/call` —
 * el handler que `McpServer` registra en el `Server` interno vía
 * `setRequestHandler(CallToolRequestSchema, ...)`, guardado (sin documentar)
 * en `Protocol._requestHandlers` bajo la clave `"tools/call"`
 * (`@modelcontextprotocol/sdk` `dist/cjs/shared/protocol.js:890-897`).
 *
 * Es deliberado y distinto del helper de arriba: `_registeredTools[...].handler`
 * es el callback CRUDO que le pasamos a `tool()` — la validación zod del
 * schema (`McpServer.validateToolInput`, `dist/cjs/server/mcp.js:169-184`) NO
 * vive ahí, vive una capa más arriba, en el handler de `"tools/call"`
 * (`mcp.js:103-146`, líneas 128-129: `validateToolInput` corre ANTES de
 * `executeToolHandler`, que es quien recién ahí invoca `tool.handler`). Sólo
 * pasando por este camino completo se puede demostrar que
 * `handleConsultaNegocio` nunca se invoca cuando `operacion` cae fuera del
 * enum — llamar al `.handler` crudo (helper de arriba) bypasea esa
 * validación por completo y no probaría nada. Undocumented internal del SDK
 * instalado, usado narrow y deliberadamente sólo acá; si una futura versión
 * del SDK renombra `_requestHandlers` o el literal `"tools/call"`, sólo este
 * helper necesita actualizarse.
 */
async function invokeConsultasToolsCallRequest(
  adapter: ReturnType<typeof createConsultasAdapter>,
  args: Readonly<Record<string, unknown>>,
): Promise<{
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly isError?: boolean;
}> {
  const server = adapter.mcpServers[CONSULTAS_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly server: {
        readonly _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
      };
    };
  };
  const toolsCallHandler = server.instance.server._requestHandlers.get("tools/call");
  if (toolsCallHandler === undefined) {
    throw new Error('test setup error: no request handler registered for "tools/call"');
  }
  return (await toolsCallHandler(
    { method: "tools/call", params: { name: CONSULTAS_TOOL_NAME, arguments: args } },
    {},
  )) as {
    readonly content: readonly [{ readonly type: "text"; readonly text: string }];
    readonly isError?: boolean;
  };
}

beforeEach(() => {
  handleConsultaNegocioMock.mockReset();
});

describe("createConsultasAdapter — mcpServers", () => {
  it("registra el servidor MCP bajo exactamente la clave CONSULTAS_MCP_SERVER_NAME", () => {
    const adapter = createConsultasAdapter(makeDeps());

    expect(Object.keys(adapter.mcpServers)).toEqual([CONSULTAS_MCP_SERVER_NAME]);
  });
});

describe("createConsultasAdapter — ADR 181, sin feedback", () => {
  it("el adaptador devuelto no tiene la propiedad feedback", () => {
    const adapter = createConsultasAdapter(makeDeps());

    expect("feedback" in adapter).toBe(false);
  });
});

describe("createConsultasAdapter — mitad de núcleo obligatorio 1 (ADR 184, schema zod)", () => {
  it("operacion fuera del enum de 4 valores ⇒ la validación de zod rechaza sin invocar handleConsultaNegocio", async () => {
    const adapter = createConsultasAdapter(makeDeps());

    const result = await invokeConsultasToolsCallRequest(adapter, { operacion: "borrar_todo" });

    expect(handleConsultaNegocioMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});

describe("createConsultasAdapter — delega en handleConsultaNegocio (tarea 5)", () => {
  it("input válido ⇒ delega en handleConsultaNegocio con (args, deps) y traduce su texto al CallToolResult", async () => {
    handleConsultaNegocioMock.mockResolvedValue("texto de resultado");
    const deps = makeDeps();
    const adapter = createConsultasAdapter(deps);

    const result = await invokeConsultasHandlerDirect(adapter, { operacion: "solicitudes_pendientes" });

    expect(handleConsultaNegocioMock).toHaveBeenCalledWith({ operacion: "solicitudes_pendientes" }, deps);
    expect(result.content[0].text).toBe("texto de resultado");
  });
});

describe("createConsultasAdapter — ADR 181 pto 3, sin import de KnowledgeFeedbackPort", () => {
  it("ningún import (a diferencia de un comentario explicativo) trae KnowledgeFeedbackPort", () => {
    const sourcePath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");
    // Grep de IMPORTS, no de texto libre: el bloque de `import ... ;` que
    // arranca el archivo — un comentario que *explique* por qué no se
    // importa `KnowledgeFeedbackPort` (como el de este mismo módulo) es
    // legítimo y no debe hacer fallar este test (señal del ADR 181 pto 3).
    const importsBlock = source.match(/^(?:import[^;]*;\s*)+/)?.[0] ?? "";

    expect(importsBlock).not.toMatch(/KnowledgeFeedbackPort/);
  });
});
