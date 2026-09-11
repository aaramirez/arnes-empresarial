import { describe, expect, it } from "vitest";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
} from "./ventas-contract.js";
import {
  agruparReporteMensual,
  formatearReporteMensual,
  resolverPeriodoReporte,
  type ComisionConVenta,
  type VentaPendienteReembolso,
} from "./reporte.js";
// Import SOLO de test (tarea 2, ADR 118/121 pto 3): `reporte.ts` nunca importa
// de `reporte-mensual.ts` — este import existe únicamente para el test de
// equivalencia (R6) de más abajo.
import { parsePeriodo } from "../../reporte-mensual.js";

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

  it("una venta reembolso_rechazado NO suma a ventasConReembolso (ADR 23, tui-canal-empleado)", () => {
    const reporte = agruparReporteMensual({
      periodo: "2024-02",
      comisiones: [
        comision({ ventaId: "v1", ventaEstado: VENTA_ESTADO_CONFIRMADA }),
        comision({ ventaId: "v2", ventaEstado: VENTA_ESTADO_REEMBOLSADA }),
        comision({ ventaId: "v3", ventaEstado: VENTA_ESTADO_REEMBOLSO_PENDIENTE }),
        comision({ ventaId: "v4", ventaEstado: VENTA_ESTADO_REEMBOLSO_RECHAZADO }),
      ],
      reembolsosPendientes: [],
    });

    // Cuatro comisiones del mismo vendedor (`comision()` default `vend-1`):
    // solo REEMBOLSADA y REEMBOLSO_PENDIENTE cuentan — REEMBOLSO_RECHAZADO
    // NO, porque el reembolso fue DENEGADO (la venta sigue `confirmada` en
    // los hechos de negocio, no hay dinero devuelto).
    expect(reporte.filas).toHaveLength(1);
    expect(reporte.filas[0]).toMatchObject({ ventasConfirmadas: 4, ventasConReembolso: 2 });
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
        "Nota: estas escalaciones se resuelven con /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso desde la TUI local de empleados, tras iniciar sesión con /login. La contraseña se verifica localmente contra la misma base de datos que este proceso escribe.",
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
        "Nota: estas escalaciones se resuelven con /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso desde la TUI local de empleados, tras iniciar sesión con /login. La contraseña se verifica localmente contra la misma base de datos que este proceso escribe.",
        "",
        "(sin reembolsos pendientes)",
      ].join("\n"),
    );
  });

  it("la seccion de reembolsos pendientes sigue apareciendo aunque no haya comisiones en el periodo", () => {
    const reporte = agruparReporteMensual({
      periodo: "2020-01",
      comisiones: [],
      reembolsosPendientes: [pendiente()],
    });

    const texto = formatearReporteMensual(reporte);

    expect(texto).toContain("Reembolsos pendientes de aprobación");
    expect(texto).toContain("venta venta-9");
  });

  it("la nota nueva (ADR 26, enmienda rev. 3) menciona los tres comandos de resolucion y la TUI local, sin las frases prohibidas", () => {
    const reporte = agruparReporteMensual({
      periodo: "2020-01",
      comisiones: [],
      reembolsosPendientes: [pendiente()],
    });

    const texto = formatearReporteMensual(reporte);

    // Menciona qué comando cierra estas escalaciones (ya no hay que resolverlas "fuera de banda").
    expect(texto).toContain("/aprobar-reembolso");
    expect(texto).toContain("/rechazar-reembolso");
    expect(texto).toContain("/reabrir-reembolso");
    // Salvedad del canal: TUI local con login por empleado (no un portal autenticado).
    expect(texto).toContain("TUI local");
    expect(texto).toContain("/login");
    // Prohibido por el ADR: "SQL manual", rechazo descrito como irreversible,
    // identidad tomada de la configuración, tabla de auditoría, roles/permisos.
    expect(texto).not.toMatch(/SQL manual/i);
    expect(texto).not.toMatch(/irreversible/i);
    expect(texto).not.toMatch(/configuraci[oó]n/i);
    expect(texto).not.toMatch(/registro_acciones_empleado|auditor[ií]a/i);
    expect(texto).not.toMatch(/\brol(es)?\b|permisos?/i);
  });
});

describe("resolverPeriodoReporte", () => {
  const AHORA_FIJO = "2026-09-10T12:00:00Z";

  it("sin argumento, con reloj fijo, resuelve al mes corriente", () => {
    expect(resolverPeriodoReporte(undefined, AHORA_FIJO)).toEqual({ ok: true, periodo: "2026-09" });
  });

  it("un periodo YYYY-MM valido se acepta tal cual", () => {
    expect(resolverPeriodoReporte("2026-08", AHORA_FIJO)).toEqual({ ok: true, periodo: "2026-08" });
  });

  it.each(["2026-13", "26-08", ""])("un formato invalido (%s) devuelve ok:false con el mensaje de uso", (valor) => {
    expect(resolverPeriodoReporte(valor, AHORA_FIJO)).toEqual({
      ok: false,
      mensaje: "Periodo inválido. Formato esperado: YYYY-MM.",
    });
  });
});

describe("equivalencia resolverPeriodoReporte / parsePeriodo (R6)", () => {
  const AHORA_FIJO = "2026-09-10T12:00:00Z";

  const TABLA_PERIODOS: ReadonlyArray<{ readonly label: string; readonly valor: string | undefined }> = [
    { label: "2026-08 (valido)", valor: "2026-08" },
    { label: "2026-13 (mes fuera de rango)", valor: "2026-13" },
    { label: "26-08 (anio de 2 digitos)", valor: "26-08" },
    { label: "cadena vacia", valor: "" },
    { label: "ausente", valor: undefined },
  ];

  describe.each(TABLA_PERIODOS)("$label", ({ valor }) => {
    it("resolverPeriodoReporte y parsePeriodo coinciden en el veredicto ok", () => {
      const argv = valor === undefined ? [] : ["--periodo", valor];
      const resultadoParsePeriodo = parsePeriodo(argv, () => AHORA_FIJO);
      const resultadoResolverPeriodoReporte = resolverPeriodoReporte(valor, AHORA_FIJO);

      expect(resultadoResolverPeriodoReporte.ok).toBe(resultadoParsePeriodo.ok);
      if (resultadoParsePeriodo.ok && resultadoResolverPeriodoReporte.ok) {
        expect(resultadoResolverPeriodoReporte.periodo).toBe(resultadoParsePeriodo.periodo);
      }
    });
  });
});
