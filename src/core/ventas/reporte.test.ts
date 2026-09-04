import { describe, expect, it } from "vitest";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
} from "./ventas-contract.js";
import {
  agruparReporteMensual,
  formatearReporteMensual,
  type ComisionConVenta,
  type VentaPendienteReembolso,
} from "./reporte.js";

function comision(overrides: Partial<ComisionConVenta> = {}): ComisionConVenta {
  return {
    ventaId: "venta-1",
    vendedorId: "vend-1",
    vendedorNombre: "Juan Perez",
    comisionMonto: 100,
    ventaMonto: 1000,
    ventaEstado: VENTA_ESTADO_CONFIRMADA,
    periodo: "2024-02",
    ...overrides,
  };
}

function pendiente(overrides: Partial<VentaPendienteReembolso> = {}): VentaPendienteReembolso {
  return {
    ventaId: "venta-9",
    vendedorId: "vend-9",
    vendedorNombre: "Ana Gomez",
    clienteId: "cliente-9",
    monto: 900,
    casoId: "caso-9",
    ...overrides,
  };
}

describe("agruparReporteMensual", () => {
  it("agrupa por separado dos vendedores distintos con comisiones en el mismo periodo", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ vendedorId: "vend-1", vendedorNombre: "Juan Perez", comisionMonto: 100, ventaMonto: 1000 }),
        comision({
          ventaId: "venta-2",
          vendedorId: "vend-2",
          vendedorNombre: "Ana Gomez",
          comisionMonto: 50,
          ventaMonto: 500,
        }),
      ],
      reembolsosPendientes: [],
    });

    expect(reporte.filas).toHaveLength(2);
    const [vend1, vend2] = reporte.filas.filter((f) => f.vendedorId === "vend-1" || f.vendedorId === "vend-2");
    expect(reporte.filas.find((f) => f.vendedorId === "vend-1")).toMatchObject({
      vendedorNombre: "Juan Perez",
      ventasConfirmadas: 1,
      montoVendido: 1000,
      totalComisionado: 100,
    });
    expect(reporte.filas.find((f) => f.vendedorId === "vend-2")).toMatchObject({
      vendedorNombre: "Ana Gomez",
      ventasConfirmadas: 1,
      montoVendido: 500,
      totalComisionado: 50,
    });
    void vend1;
    void vend2;
  });

  it("suma varias comisiones del mismo vendedor dentro del periodo", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ ventaId: "venta-1", comisionMonto: 100, ventaMonto: 1000 }),
        comision({ ventaId: "venta-2", comisionMonto: 30, ventaMonto: 300 }),
      ],
      reembolsosPendientes: [],
    });

    expect(reporte.filas).toHaveLength(1);
    expect(reporte.filas[0]).toMatchObject({
      ventasConfirmadas: 2,
      montoVendido: 1300,
      totalComisionado: 130,
    });
  });

  it("filtra comisiones de un periodo distinto al solicitado", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ periodo: "2024-02", comisionMonto: 100 }),
        comision({ ventaId: "venta-2", periodo: "2024-01", comisionMonto: 999 }),
      ],
      reembolsosPendientes: [],
    });

    expect(reporte.filas).toHaveLength(1);
    expect(reporte.filas[0]?.totalComisionado).toBe(100);
  });

  it("ordena por totalComisionado DESC, con desempate por vendedorId ASC", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ ventaId: "v1", vendedorId: "vend-b", vendedorNombre: "B", comisionMonto: 50 }),
        comision({ ventaId: "v2", vendedorId: "vend-c", vendedorNombre: "C", comisionMonto: 100 }),
        comision({ ventaId: "v3", vendedorId: "vend-a", vendedorNombre: "A", comisionMonto: 100 }),
      ],
      reembolsosPendientes: [],
    });

    expect(reporte.filas.map((f) => f.vendedorId)).toEqual(["vend-a", "vend-c", "vend-b"]);
  });

  it("totalComisionado es la suma redondeada de floats con el mismo criterio de calcularComision", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ ventaId: "v1", comisionMonto: 0.1 }),
        comision({ ventaId: "v2", comisionMonto: 0.2 }),
      ],
      reembolsosPendientes: [],
    });

    // 0.1 + 0.2 === 0.30000000000000004 en IEEE-754; el reporte debe devolver 0.3 exacto.
    expect(reporte.filas[0]?.totalComisionado).toBe(0.3);
    expect(reporte.totalComisionado).toBe(0.3);
  });

  it("reembolsosPendientes se pasa sin filtrar por periodo", () => {
    const pendientes = [pendiente({ ventaId: "venta-9" }), pendiente({ ventaId: "venta-10" })];
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [],
      reembolsosPendientes: pendientes,
    });

    expect(reporte.reembolsosPendientes).toEqual(pendientes);
  });

  it("un periodo sin comisiones produce filas vacías", () => {
    const reporte = agruparReporteMensual({
      periodo: "2020-01",
      comisiones: [comision({ periodo: "2024-02" })],
      reembolsosPendientes: [],
    });

    expect(reporte.filas).toEqual([]);
    expect(reporte.totalComisionado).toBe(0);
  });
});

describe("formatearReporteMensual", () => {
  it("devuelve el string completo y determinista para un periodo con comisiones y reembolsos pendientes", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({
          ventaId: "venta-1",
          vendedorId: "vend-1",
          vendedorNombre: "Juan Perez",
          comisionMonto: 100,
          ventaMonto: 1000,
          ventaEstado: VENTA_ESTADO_CONFIRMADA,
        }),
        comision({
          ventaId: "venta-2",
          vendedorId: "vend-2",
          vendedorNombre: "Ana Gomez",
          comisionMonto: 225,
          ventaMonto: 1500,
          ventaEstado: VENTA_ESTADO_REEMBOLSADA,
        }),
      ],
      reembolsosPendientes: [
        {
          ventaId: "venta-11",
          vendedorId: "vend-1",
          vendedorNombre: "Juan Perez",
          clienteId: "cliente-11",
          monto: 1000,
          casoId: "caso-11",
          confirmedAt: "2024-02-10T10:00:00.000Z",
        },
      ],
    });

    const texto = formatearReporteMensual(reporte);

    expect(texto).toBe(
      [
        "Reporte de comisiones - periodo 2024-02",
        "",
        "Vendedor                 Ventas Monto vendido Total comisionado Con reembolso",
        "-----------------------------------------------------------------------------",
        "Ana Gomez                     1       1500.00            225.00             1",
        "Juan Perez                    1       1000.00            100.00             0",
        "-----------------------------------------------------------------------------",
        "TOTAL                                                    325.00",
        "",
        "Reembolsos pendientes de aprobación",
        "",
        "Nota: este hito no ofrece ninguna vía de producto (endpoint, pantalla o notificación) para aprobar o rechazar estas escalaciones. La resolución es fuera de banda (SQL manual) hasta que el Hito 5 implemente el cierre (ADR 11 punto 5).",
        "",
        "- venta venta-11 | vendedor Juan Perez | cliente cliente-11 | monto 1000.00 | caso caso-11 | confirmada 2024-02-10T10:00:00.000Z",
      ].join("\n"),
    );
  });

  it("un periodo sin comisiones produce la linea explicita 'sin comisiones en el periodo'", () => {
    const reporte = agruparReporteMensual({
      periodo: "2020-01",
      comisiones: [],
      reembolsosPendientes: [],
    });

    const texto = formatearReporteMensual(reporte);

    expect(texto).toContain("sin comisiones en el periodo");
    expect(texto).toBe(
      [
        "Reporte de comisiones - periodo 2020-01",
        "",
        "sin comisiones en el periodo",
        "",
        "Reembolsos pendientes de aprobación",
        "",
        "Nota: este hito no ofrece ninguna vía de producto (endpoint, pantalla o notificación) para aprobar o rechazar estas escalaciones. La resolución es fuera de banda (SQL manual) hasta que el Hito 5 implemente el cierre (ADR 11 punto 5).",
        "",
        "(sin reembolsos pendientes)",
      ].join("\n"),
    );
  });

  it("la seccion de reembolsos pendientes sigue apareciendo aunque no haya comisiones en el periodo, y sin ninguna accion de aprobacion ofrecida", () => {
    const reporte = agruparReporteMensual({
      periodo: "2020-01",
      comisiones: [],
      reembolsosPendientes: [pendiente()],
    });

    const texto = formatearReporteMensual(reporte);

    expect(texto).toContain("Reembolsos pendientes de aprobación");
    expect(texto).toContain("fuera de banda");
    // El reporte solo lista — no ofrece ninguna ruta ni acción para aprobar/rechazar (ADR 11 punto 5).
    expect(texto).not.toMatch(/\/aprobar-reembolso|POST\s/);
    expect(texto).toContain("venta venta-9");
  });
});
