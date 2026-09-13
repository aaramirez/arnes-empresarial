import { describe, expect, it, vi } from "vitest";
import type { EscalacionListada } from "../ventas/ventas-contract.js";
import type { SolicitudInterna } from "../solicitudes/solicitudes-contract.js";
import type { ActividadResumen } from "../actividad/consulta-actividad-contract.js";
import {
  CONSULTAS_MCP_SERVER_NAME,
  CONSULTAS_TOOL_NAME,
  CONSULTAS_TOOL_QUALIFIED_NAME,
  handleConsultaNegocio,
  type ConsultasNegocioToolDeps,
  validarConsultaNegocio,
} from "./consultas-negocio-tool.js";

/**
 * consultas-negocio-a2a-entrante, tarea 4 (PR2 — porción de VALIDACIÓN,
 * ADR 184) + tarea 5 (PR3 — orquestación + recorte, ADR 180/186). Este
 * archivo arrancó con la porción de validación y crece acá con
 * `handleConsultaNegocio`.
 *
 * Whitelist ESTRICTA por operación, mismo criterio que
 * `src/core/operaciones/validar-operacion.ts` del change hermano
 * (`operaciones-negocio-conversacionales`): `solicitudes_pendientes` y
 * `reembolsos_pendientes` no aceptan NINGÚN campo adicional — es la señal,
 * verificable por test, de que esas dos operaciones no tienen forma de
 * filtrar por identidad porque no reciben ningún parámetro que pudiera
 * intentarlo (spec `consultas-negocio-a2a`).
 */

describe("constantes MCP de la tool consultas", () => {
  it("CONSULTAS_MCP_SERVER_NAME es 'consultas'", () => {
    expect(CONSULTAS_MCP_SERVER_NAME).toBe("consultas");
  });

  it("CONSULTAS_TOOL_NAME es 'consultar_negocio'", () => {
    expect(CONSULTAS_TOOL_NAME).toBe("consultar_negocio");
  });

  it("CONSULTAS_TOOL_QUALIFIED_NAME es 'mcp__consultas__consultar_negocio'", () => {
    expect(CONSULTAS_TOOL_QUALIFIED_NAME).toBe("mcp__consultas__consultar_negocio");
  });
});

describe("validarConsultaNegocio — forma exacta de cada una de las 4 operaciones ⇒ acepta", () => {
  it("reporte_comisiones: { operacion, periodo } se acepta", () => {
    const input = { operacion: "reporte_comisiones", periodo: "2026-08" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("estado_actividad: { operacion, proyectoId, referenciaExterna } se acepta", () => {
    const input = { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-42" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("solicitudes_pendientes: { operacion } se acepta", () => {
    const input = { operacion: "solicitudes_pendientes" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });

  it("reembolsos_pendientes: { operacion } se acepta", () => {
    const input = { operacion: "reembolsos_pendientes" };
    expect(validarConsultaNegocio(input)).toBe(input);
  });
});

describe("validarConsultaNegocio — Punto obligatorio 1: clave extra en solicitudes_pendientes/reembolsos_pendientes ⇒ rechazo, sin tocar ningún puerto", () => {
  it.each([
    { operacion: "solicitudes_pendientes", periodo: "2026-08" },
    { operacion: "solicitudes_pendientes", proyectoId: "proyecto-1" },
    { operacion: "solicitudes_pendientes", campoInventado: "x" },
    { operacion: "reembolsos_pendientes", periodo: "2026-08" },
    { operacion: "reembolsos_pendientes", proyectoId: "proyecto-1" },
    { operacion: "reembolsos_pendientes", campoInventado: "x" },
  ])("$operacion con clave extra ⇒ rechazo", (input) => {
    const resultado = validarConsultaNegocio(input);
    expect(resultado).not.toBe(input);
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — reporte_comisiones, rechazo", () => {
  it("sin periodo ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "reporte_comisiones" });
    expect(resultado).toHaveProperty("rechazo");
  });

  it("con proyectoId en vez de periodo ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "reporte_comisiones", proyectoId: "proyecto-1" });
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — estado_actividad, rechazo", () => {
  it("sin referenciaExterna ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "estado_actividad", proyectoId: "proyecto-1" });
    expect(resultado).toHaveProperty("rechazo");
  });

  it("con periodo en vez de proyectoId/referenciaExterna ⇒ rechazo", () => {
    const resultado = validarConsultaNegocio({ operacion: "estado_actividad", periodo: "2026-08" });
    expect(resultado).toHaveProperty("rechazo");
  });
});

describe("validarConsultaNegocio — operación fuera del conjunto cerrado", () => {
  it("operacion desconocida ⇒ rechazo", () => {
    expect(validarConsultaNegocio({ operacion: "borrar_todo" })).toHaveProperty("rechazo");
  });

  it("operacion ausente o no-string ⇒ rechazo", () => {
    expect(validarConsultaNegocio({})).toHaveProperty("rechazo");
    expect(validarConsultaNegocio({ operacion: 123 })).toHaveProperty("rechazo");
  });
});

/**
 * handleConsultaNegocio — tarea 5 (PR3, orquestación + recorte, ADR 180/186).
 */

function makeDeps(overrides: Partial<ConsultasNegocioToolDeps> = {}): ConsultasNegocioToolDeps {
  return {
    casoId: "caso-1",
    reporteStore: {
      listComisionesPorPeriodo: vi.fn().mockReturnValue([]),
      listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([]),
    },
    actividadPort: { buscarPorReferencia: vi.fn().mockReturnValue(undefined) },
    solicitudesPort: { listarPendientes: vi.fn().mockReturnValue([]) },
    reembolsosPort: { listPendientes: vi.fn().mockReturnValue([]) },
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("handleConsultaNegocio — las 4 operaciones con dobles de los 4 puertos ⇒ texto refleja datos reales", () => {
  it("reporte_comisiones: texto trae periodo, filas.length, sumas y totalComisionado", async () => {
    const deps = makeDeps({
      reporteStore: {
        listComisionesPorPeriodo: vi.fn().mockReturnValue([
          {
            ventaId: "venta-1",
            vendedorId: "vendedor-1",
            vendedorNombre: "Juana Pérez",
            comisionMonto: 100,
            ventaMonto: 1000,
            ventaEstado: "confirmada",
            periodo: "2026-08",
          },
          {
            ventaId: "venta-2",
            vendedorId: "vendedor-2",
            vendedorNombre: "Carlos Gómez",
            comisionMonto: 50,
            ventaMonto: 500,
            ventaEstado: "reembolso_pendiente",
            periodo: "2026-08",
          },
        ]),
        listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([]),
      },
    });

    const texto = await handleConsultaNegocio({ operacion: "reporte_comisiones", periodo: "2026-08" }, deps);

    expect(texto).toContain("2026-08");
    expect(texto).toContain("2"); // filas.length
    expect(texto).toContain("150.00"); // totalComisionado
    expect(deps.reporteStore.listComisionesPorPeriodo).toHaveBeenCalledWith("2026-08");
  });

  it("estado_actividad: texto trae estado y updatedAt reales", async () => {
    const resumen: ActividadResumen = { estado: "aprobado", updatedAt: "2026-08-10T12:00:00.000Z" };
    const deps = makeDeps({
      actividadPort: { buscarPorReferencia: vi.fn().mockReturnValue(resumen) },
    });

    const texto = await handleConsultaNegocio(
      { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-42" },
      deps,
    );

    expect(texto).toContain("aprobado");
    expect(texto).toContain("2026-08-10T12:00:00.000Z");
    expect(texto).toContain("PR-42");
    expect(texto).toContain("proyecto-1");
    expect(deps.actividadPort.buscarPorReferencia).toHaveBeenCalledWith({
      proyectoId: "proyecto-1",
      referenciaExterna: "PR-42",
    });
  });

  it("solicitudes_pendientes: texto trae el conteo total y desglose por tipo", async () => {
    const solicitudes: readonly SolicitudInterna[] = [
      {
        id: "s1",
        casoId: "c1",
        solicitanteId: "empleado-1",
        tipo: "vacaciones",
        detalle: "una semana",
        estado: "pendiente_aprobacion_humana",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "s2",
        casoId: "c2",
        solicitanteId: "empleado-2",
        tipo: "vacaciones",
        detalle: "otra semana",
        estado: "pendiente_aprobacion_humana",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "s3",
        casoId: "c3",
        solicitanteId: "empleado-3",
        tipo: "gasto",
        detalle: "almuerzo con cliente",
        estado: "pendiente_aprobacion_humana",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const deps = makeDeps({
      solicitudesPort: { listarPendientes: vi.fn().mockReturnValue(solicitudes) },
    });

    const texto = await handleConsultaNegocio({ operacion: "solicitudes_pendientes" }, deps);

    expect(texto).toContain("3");
    expect(texto).toContain("vacaciones: 2");
    expect(texto).toContain("gasto: 1");
  });

  it("reembolsos_pendientes: texto trae el conteo total y la suma de monto", async () => {
    const escalaciones: readonly EscalacionListada[] = [
      {
        ventaId: "venta-1",
        vendedorId: "vendedor-1",
        vendedorNombre: "Juana Pérez",
        clienteId: "cliente-1",
        monto: 300,
        casoId: "caso-1",
        reaperturasPrevias: 0,
      },
      {
        ventaId: "venta-2",
        vendedorId: "vendedor-2",
        vendedorNombre: "Carlos Gómez",
        clienteId: "cliente-2",
        monto: 200,
        casoId: "caso-2",
        reaperturasPrevias: 0,
      },
    ];
    const deps = makeDeps({
      reembolsosPort: { listPendientes: vi.fn().mockReturnValue(escalaciones) },
    });

    const texto = await handleConsultaNegocio({ operacion: "reembolsos_pendientes" }, deps);

    expect(texto).toContain("2");
    expect(texto).toContain("500.00");
  });
});

describe("handleConsultaNegocio — Punto obligatorio 2 (ADR 180 pto 4, negativo): recorte de datos personales, ni siquiera truncados", () => {
  it("reporte_comisiones: el texto no contiene vendedorNombre ni siquiera parcial", async () => {
    const deps = makeDeps({
      reporteStore: {
        listComisionesPorPeriodo: vi.fn().mockReturnValue([
          {
            ventaId: "venta-1",
            vendedorId: "vendedor-1",
            vendedorNombre: "Wilhelmina Ozorio",
            comisionMonto: 100,
            ventaMonto: 1000,
            ventaEstado: "confirmada",
            periodo: "2026-08",
          },
        ]),
        listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([]),
      },
    });

    const texto = await handleConsultaNegocio({ operacion: "reporte_comisiones", periodo: "2026-08" }, deps);

    expect(texto).not.toContain("Wilhelmina");
    expect(texto).not.toContain("Ozorio");
    expect(texto).not.toContain("vendedor-1");
  });

  it("solicitudes_pendientes: el texto no contiene solicitanteId ni detalle, ni siquiera parcial", async () => {
    const solicitudes: readonly SolicitudInterna[] = [
      {
        id: "s1",
        casoId: "c1",
        solicitanteId: "empleado-Zorrilla-99",
        tipo: "gasto",
        detalle: "Reembolso de viaje confidencial a Bariloche",
        estado: "pendiente_aprobacion_humana",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const deps = makeDeps({
      solicitudesPort: { listarPendientes: vi.fn().mockReturnValue(solicitudes) },
    });

    const texto = await handleConsultaNegocio({ operacion: "solicitudes_pendientes" }, deps);

    expect(texto).not.toContain("Zorrilla");
    expect(texto).not.toContain("empleado-Zorrilla-99");
    expect(texto).not.toContain("Bariloche");
    expect(texto).not.toContain("confidencial");
  });

  it("reembolsos_pendientes: el texto no contiene vendedorId, vendedorNombre, clienteId, ventaId ni casoId, ni siquiera parcial", async () => {
    const escalaciones: readonly EscalacionListada[] = [
      {
        ventaId: "venta-secreta-7",
        vendedorId: "vendedor-Nakamura",
        vendedorNombre: "Nakamura Fujita",
        clienteId: "cliente-Delacroix",
        monto: 300,
        casoId: "caso-oculto-3",
        rechazadaPor: "empleado-9",
        reaperturasPrevias: 0,
      },
    ];
    const deps = makeDeps({
      reembolsosPort: { listPendientes: vi.fn().mockReturnValue(escalaciones) },
    });

    const texto = await handleConsultaNegocio({ operacion: "reembolsos_pendientes" }, deps);

    expect(texto).not.toContain("Nakamura");
    expect(texto).not.toContain("Fujita");
    expect(texto).not.toContain("Delacroix");
    expect(texto).not.toContain("venta-secreta-7");
    expect(texto).not.toContain("caso-oculto-3");
    expect(texto).not.toContain("empleado-9");
  });

  it("estado_actividad: una actividad con responsableId poblado ⇒ el texto no lo contiene", async () => {
    const resumenConFuga = {
      estado: "aprobado",
      updatedAt: "2026-08-10T12:00:00.000Z",
      responsableId: "empleado-Yamamoto-fuga",
    } as unknown as ActividadResumen;
    const deps = makeDeps({
      actividadPort: { buscarPorReferencia: vi.fn().mockReturnValue(resumenConFuga) },
    });

    const texto = await handleConsultaNegocio(
      { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-42" },
      deps,
    );

    expect(texto).not.toContain("Yamamoto");
    expect(texto).not.toContain("empleado-Yamamoto-fuga");
  });
});

describe("handleConsultaNegocio — reporte_comisiones con periodo inválido ⇒ mensaje de uso", () => {
  it("periodo con formato inválido reusa resolverPeriodoReporte, sin tocar el puerto", async () => {
    const deps = makeDeps();

    const texto = await handleConsultaNegocio({ operacion: "reporte_comisiones", periodo: "no-es-un-periodo" }, deps);

    expect(texto).toContain("Periodo inválido");
    expect(deps.reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
  });
});

describe("handleConsultaNegocio — estado_actividad con referenciaExterna inexistente ⇒ texto de no encontrado, sin excepción", () => {
  it("actividadPort devuelve undefined ⇒ texto indica que no se encontró", async () => {
    const deps = makeDeps({
      actividadPort: { buscarPorReferencia: vi.fn().mockReturnValue(undefined) },
    });

    const texto = await handleConsultaNegocio(
      { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-inexistente" },
      deps,
    );

    expect(texto).toContain("no se encontró");
    expect(texto).toContain("PR-inexistente");
  });
});

describe("handleConsultaNegocio — Punto obligatorio 3: nunca lanza ni rechaza, ni siquiera cuando un puerto falla internamente", () => {
  it("reporteStore.listComisionesPorPeriodo lanza sincrónicamente ⇒ handleConsultaNegocio igual devuelve texto", async () => {
    const deps = makeDeps({
      reporteStore: {
        listComisionesPorPeriodo: vi.fn(() => {
          throw new Error("fallo de reporteStore");
        }),
        listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([]),
      },
    });

    await expect(
      handleConsultaNegocio({ operacion: "reporte_comisiones", periodo: "2026-08" }, deps),
    ).resolves.toEqual(expect.any(String));
  });

  it("actividadPort.buscarPorReferencia lanza sincrónicamente ⇒ handleConsultaNegocio igual devuelve texto", async () => {
    const deps = makeDeps({
      actividadPort: {
        buscarPorReferencia: vi.fn(() => {
          throw new Error("fallo de actividadPort");
        }),
      },
    });

    await expect(
      handleConsultaNegocio(
        { operacion: "estado_actividad", proyectoId: "proyecto-1", referenciaExterna: "PR-42" },
        deps,
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it("solicitudesPort.listarPendientes lanza sincrónicamente ⇒ handleConsultaNegocio igual devuelve texto", async () => {
    const deps = makeDeps({
      solicitudesPort: {
        listarPendientes: vi.fn(() => {
          throw new Error("fallo de solicitudesPort");
        }),
      },
    });

    await expect(handleConsultaNegocio({ operacion: "solicitudes_pendientes" }, deps)).resolves.toEqual(
      expect.any(String),
    );
  });

  it("reembolsosPort.listPendientes lanza sincrónicamente ⇒ handleConsultaNegocio igual devuelve texto", async () => {
    const deps = makeDeps({
      reembolsosPort: {
        listPendientes: vi.fn(() => {
          throw new Error("fallo de reembolsosPort");
        }),
      },
    });

    await expect(handleConsultaNegocio({ operacion: "reembolsos_pendientes" }, deps)).resolves.toEqual(
      expect.any(String),
    );
  });
});

describe("handleConsultaNegocio — recorte exacto de reporte_comisiones exitoso", () => {
  it("no incluye la tabla filas completa ni reembolsosPendientes, sólo agregados", async () => {
    const deps = makeDeps({
      reporteStore: {
        listComisionesPorPeriodo: vi.fn().mockReturnValue([
          {
            ventaId: "venta-1",
            vendedorId: "vendedor-1",
            vendedorNombre: "No Debería Aparecer",
            comisionMonto: 100,
            ventaMonto: 1000,
            ventaEstado: "confirmada",
            periodo: "2026-08",
          },
        ]),
        listVentasEnReembolsoPendiente: vi.fn().mockReturnValue([
          {
            ventaId: "venta-reembolso-1",
            vendedorId: "vendedor-9",
            vendedorNombre: "Tampoco Debería Aparecer",
            clienteId: "cliente-9",
            monto: 999,
            casoId: "caso-9",
          },
        ]),
      },
    });

    const texto = await handleConsultaNegocio({ operacion: "reporte_comisiones", periodo: "2026-08" }, deps);

    expect(texto).toContain("2026-08");
    expect(texto).toContain("1000.00"); // monto vendido agregado
    expect(texto).toContain("100.00"); // totalComisionado
    expect(texto).not.toContain("No Debería Aparecer");
    expect(texto).not.toContain("Tampoco Debería Aparecer");
    expect(texto).not.toContain("venta-reembolso-1");
    // `reembolsosPendientes` del ReporteStorePort no se consulta para esta operación
    // (ADR 182 pto 4, distinta de `reembolsos_pendientes`).
    expect(deps.reporteStore.listVentasEnReembolsoPendiente).not.toHaveBeenCalled();
  });
});
