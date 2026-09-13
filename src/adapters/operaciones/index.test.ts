import { describe, expect, it, vi } from "vitest";
import {
  OPERACIONES_MCP_SERVER_NAME,
  OPERACIONES_TOOL_NAME,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_RESOLVER_DECISION_VENTA,
  type ConfirmacionOperacionPort,
} from "../../core/operaciones/operaciones-contract.js";
import type { EjecutarOperacionInput } from "../../core/operaciones/ejecutar-operacion.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";
import { createOperacionesAdapter, type OperacionesAdapterDeps } from "./index.js";

/**
 * Tests for `createOperacionesAdapter` (`operaciones-negocio-conversacionales`,
 * tarea 4). Molde exacto de `adapters/knowledge/index.test.ts`: invoca el
 * handler REAL registrado por `tool()` a través de `_registeredTools`,
 * bypaseando el protocolo MCP — mismo criterio documentado ahí (undocumented
 * internal del SDK instalado, usado deliberadamente para ejercitar el wiring
 * real sin tocar el transporte).
 */

function fakeSesion(overrides: Partial<SesionEmpleado> = {}): SesionEmpleado {
  return { empleadoId: "empleado-1", iniciadaEn: "2026-01-01T00:00:00.000Z", ...overrides };
}

function fakeConfirmacion(): ConfirmacionOperacionPort {
  return {
    estaConfirmada: vi.fn().mockReturnValue(false),
    marcarPendiente: vi.fn(),
    consumir: vi.fn(),
  };
}

async function invokeOperacionesTool(
  adapter: ReturnType<typeof createOperacionesAdapter>,
  args: Readonly<Record<string, unknown>>,
): Promise<{ readonly content: readonly [{ readonly type: "text"; readonly text: string }] }> {
  const server = adapter.mcpServers[OPERACIONES_MCP_SERVER_NAME] as unknown as {
    readonly instance: {
      readonly _registeredTools: Record<
        string,
        { readonly handler: (args: unknown, extra: unknown) => Promise<unknown> }
      >;
    };
  };
  const registeredTool = server.instance._registeredTools[OPERACIONES_TOOL_NAME];
  if (registeredTool === undefined) {
    throw new Error(`test setup error: tool "${OPERACIONES_TOOL_NAME}" was not registered`);
  }
  return (await registeredTool.handler(args, {})) as {
    readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  };
}

function makeDeps(overrides: Partial<OperacionesAdapterDeps> = {}): OperacionesAdapterDeps {
  return {
    casoId: "caso-1",
    sesion: fakeSesion(),
    confirmacion: fakeConfirmacion(),
    ejecutar: vi.fn().mockResolvedValue("texto de resultado"),
    ...overrides,
  };
}

describe("createOperacionesAdapter — mcpServers", () => {
  it("registra el servidor MCP bajo OPERACIONES_MCP_SERVER_NAME, con esa misma tool", () => {
    const adapter = createOperacionesAdapter(makeDeps());

    expect(Object.keys(adapter.mcpServers)).toEqual([OPERACIONES_MCP_SERVER_NAME]);
    const server = adapter.mcpServers[OPERACIONES_MCP_SERVER_NAME] as unknown as { name: string };
    expect(server.name).toBe(OPERACIONES_MCP_SERVER_NAME);
  });
});

describe("createOperacionesAdapter — rechazo de input inválido, sin invocar ejecutar", () => {
  it("operación fuera del enum ⇒ CallToolResult de rechazo, ejecutar nunca se invoca", async () => {
    const ejecutar = vi.fn();
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    const result = await invokeOperacionesTool(adapter, { operacion: "borrar_todo" });

    expect(ejecutar).not.toHaveBeenCalled();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("falta un campo requerido de la operación ⇒ rechazo, sin invocar ejecutar", async () => {
    const ejecutar = vi.fn();
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    // resolver_decision_venta exige token+decision (validar-operacion.ts) — acá faltan ambos.
    const result = await invokeOperacionesTool(adapter, { operacion: OPERACION_RESOLVER_DECISION_VENTA });

    expect(ejecutar).not.toHaveBeenCalled();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("clave extra no permitida para esa operación (monto en cancelar_solicitud_interna) ⇒ rechazo, sin invocar ejecutar", async () => {
    const ejecutar = vi.fn();
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    const result = await invokeOperacionesTool(adapter, {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
      monto: 100,
    });

    expect(ejecutar).not.toHaveBeenCalled();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});

describe("createOperacionesAdapter — delega en ejecutar y traduce el resultado", () => {
  it("input válido ⇒ delega en ejecutar con {operacion, sesion, confirmacion, casoIdActual}", async () => {
    const sesion = fakeSesion({ empleadoId: "empleado-42" });
    const confirmacion = fakeConfirmacion();
    const ejecutar = vi.fn().mockResolvedValue("listo");
    const adapter = createOperacionesAdapter(
      makeDeps({ casoId: "caso-7", sesion, confirmacion, ejecutar }),
    );

    await invokeOperacionesTool(adapter, {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
      solicitudId: "sol-1",
    });

    expect(ejecutar).toHaveBeenCalledTimes(1);
    const input = ejecutar.mock.calls[0]?.[0] as EjecutarOperacionInput;
    expect(input.operacion).toEqual({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "sol-1" });
    expect(input.sesion).toBe(sesion);
    expect(input.confirmacion).toBe(confirmacion);
    expect(input.casoIdActual).toBe("caso-7");
  });

  it("traduce el texto que devuelve ejecutar al content[0].text del CallToolResult", async () => {
    const ejecutar = vi.fn().mockResolvedValue("Venta registrada con éxito.");
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    const result = await invokeOperacionesTool(adapter, {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
    });

    expect(result.content[0].text).toBe("Venta registrada con éxito.");
  });
});

describe("createOperacionesAdapter — nunca lanza", () => {
  it("si ejecutar rechaza (throw/reject), el handler resuelve con un texto degradado en vez de propagar", async () => {
    const ejecutar = vi.fn().mockRejectedValue(new Error("boom"));
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    await expect(
      invokeOperacionesTool(adapter, { operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA }),
    ).resolves.not.toThrow();

    const result = await invokeOperacionesTool(adapter, { operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA });
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});
