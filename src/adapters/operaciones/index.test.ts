import { describe, expect, it, vi } from "vitest";
import {
  OPERACIONES_MCP_SERVER_NAME,
  OPERACIONES_TOOL_NAME,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_RESOLVER_REEMBOLSO,
  OPERACION_RESOLVER_SOLICITUD,
  type ConfirmacionOperacionPort,
} from "../../core/operaciones/operaciones-contract.js";
import type { EjecutarOperacionInput } from "../../core/operaciones/ejecutar-operacion.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";
import {
  createOperacionesAdapter,
  OPERACIONES_TOOL_DESCRIPTION,
  OPERACIONES_TOOL_ZOD_SCHEMA,
  type OperacionesAdapterDeps,
} from "./index.js";

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

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "registrar_venta con monto=%p ⇒ rechazo, sin invocar ejecutar (hallazgo Reviewer)",
    async (monto) => {
      const ejecutar = vi.fn();
      const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

      const result = await invokeOperacionesTool(adapter, {
        operacion: "registrar_venta",
        clienteId: "c",
        clienteEmail: "c@example.com",
        planNuevo: "p",
        vendedorNombre: "v",
        monto,
      });

      expect(ejecutar).not.toHaveBeenCalled();
      expect(result.content[0].text.length).toBeGreaterThan(0);
    },
  );

  it("registrar_venta con monto positivo y finito ⇒ sigue delegando en ejecutar (regresión)", async () => {
    const ejecutar = vi.fn().mockResolvedValue("ok");
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    await invokeOperacionesTool(adapter, {
      operacion: "registrar_venta",
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      vendedorNombre: "v",
      monto: 100,
    });

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("un campo string de más de 256 caracteres ⇒ rechazo, sin invocar ejecutar (hallazgo Reviewer)", async () => {
    const ejecutar = vi.fn();
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    const result = await invokeOperacionesTool(adapter, {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
      solicitudId: "x".repeat(257),
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

describe("OPERACIONES_TOOL_ZOD_SCHEMA — resolver_solicitud: forma zod (aprobacion-conversacional-hitl, tarea 8)", () => {
  it("acepta { operacion, accion, solicitudId } con accion:'aprobar'", () => {
    const result = OPERACIONES_TOOL_ZOD_SCHEMA.safeParse({
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "aprobar",
      solicitudId: "S1",
    });
    expect(result.success).toBe(true);
  });

  it("acepta accion:'reabrir' a nivel de forma — el enum del zod plano ya incluye reabrir (tarea 12, ampliado para reembolso); validar-operacion.ts sigue rechazando reabrir para resolver_solicitud por significado (regresión ADR 217 pto 3)", () => {
    const result = OPERACIONES_TOOL_ZOD_SCHEMA.safeParse({
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "reabrir",
    });
    expect(result.success).toBe(true);
  });
});

describe("OPERACIONES_TOOL_ZOD_SCHEMA — resolver_reembolso: forma zod (aprobacion-conversacional-hitl, tarea 12)", () => {
  it("acepta { operacion, accion, ventaId } con accion:'aprobar'|'rechazar'|'reabrir'", () => {
    for (const accion of ["aprobar", "rechazar", "reabrir"]) {
      const result = OPERACIONES_TOOL_ZOD_SCHEMA.safeParse({
        operacion: OPERACION_RESOLVER_REEMBOLSO,
        accion,
        ventaId: "V1",
      });
      expect(result.success).toBe(true);
    }
  });

  it("acepta { operacion, accion } sin ventaId (modo listado)", () => {
    const result = OPERACIONES_TOOL_ZOD_SCHEMA.safeParse({
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "aprobar",
    });
    expect(result.success).toBe(true);
  });
});

describe("createOperacionesAdapter — resolver_reembolso: input válido delega en ejecutar (aprobacion-conversacional-hitl, tarea 12)", () => {
  it("{ operacion: resolver_reembolso, accion: 'reabrir', ventaId } ⇒ delega en ejecutar", async () => {
    const ejecutar = vi.fn().mockResolvedValue("ok");
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    await invokeOperacionesTool(adapter, {
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "reabrir",
      ventaId: "V1",
    });

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("resolver_solicitud con accion:'reabrir' ⇒ pasa el zod ampliado pero validar-operacion.ts lo rechaza, ejecutar nunca se invoca (regresión ADR 217 pto 3)", async () => {
    const ejecutar = vi.fn();
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    const result = await invokeOperacionesTool(adapter, {
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "reabrir",
    });

    expect(ejecutar).not.toHaveBeenCalled();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});

describe("createOperacionesAdapter — resolver_solicitud: input válido delega en ejecutar (aprobacion-conversacional-hitl, tarea 8)", () => {
  it("{ operacion: resolver_solicitud, accion: 'aprobar', solicitudId } ⇒ delega en ejecutar", async () => {
    const ejecutar = vi.fn().mockResolvedValue("ok");
    const adapter = createOperacionesAdapter(makeDeps({ ejecutar }));

    await invokeOperacionesTool(adapter, {
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "aprobar",
      solicitudId: "S1",
    });

    expect(ejecutar).toHaveBeenCalledTimes(1);
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

describe("OPERACIONES_TOOL_DESCRIPTION — instrucción de accion inequívoca (aprobacion-conversacional-hitl, tarea 15, ADR 220 pto 2)", () => {
  /** Texto literal de ADR 220 pto 2 — el mismo, duplicado a propósito, en las tres superficies de prompt. */
  const TEXTO_ACCION_INEQUIVOCA =
    "Cuando el empleado te pida resolver un reembolso o una solicitud, la acción " +
    "(`aprobar`, `rechazar` o `reabrir`) tiene que salir de una frase inequívoca del " +
    "empleado. Si dice algo ambiguo —'resolvelo', 'dale', 'hacé lo que corresponda', " +
    "'fijate vos'— preguntá cuál de las acciones quiere en vez de elegir una. Nunca " +
    "elegís vos la acción, ni la deducís del contexto, ni del dictamen, ni de lo que " +
    "parezca más razonable.";

  it("incluye el texto exacto de ADR 220 pto 2, incluido 'ni del dictamen'", () => {
    expect(OPERACIONES_TOOL_DESCRIPTION).toContain(TEXTO_ACCION_INEQUIVOCA);
    expect(OPERACIONES_TOOL_DESCRIPTION).toContain("ni del dictamen");
  });

  it("es la misma descripción registrada en la tool real del servidor MCP", () => {
    const adapter = createOperacionesAdapter(makeDeps());
    const server = adapter.mcpServers[OPERACIONES_MCP_SERVER_NAME] as unknown as {
      readonly instance: { readonly _registeredTools: Record<string, { readonly description?: string }> };
    };
    const registeredTool = server.instance._registeredTools[OPERACIONES_TOOL_NAME];

    expect(registeredTool?.description).toBe(OPERACIONES_TOOL_DESCRIPTION);
  });
});
