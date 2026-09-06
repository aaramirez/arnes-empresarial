import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
  CASO_ESTADO_RESUELTO,
  CASO_TIPO_SOPORTE,
  CASO_TIPO_VENTA,
  LIMITE_LISTADO_ESCALACIONES,
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_RECHAZADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
  VENTA_ESTADOS,
  type Comision,
  type ConfirmacionAplicada,
  type ConfirmarVentaConComisionInput,
  type CrearVentaConCasoInput,
  type EscalacionListada,
  type FiltroEscalaciones,
  type NotificacionMotivo,
  type NotificacionResultado,
  type ResolucionEscalacionInput,
  type Venta,
  type VentaEstado,
  type VentaNotifierPort,
  type VentaPublica,
  type VentaStorePort,
} from "./ventas-contract.js";

describe("VENTA_ESTADOS", () => {
  it("tiene exactamente los 6 estados canónicos, en el orden que fija design.md (incluido reembolso_rechazado)", () => {
    expect(VENTA_ESTADOS).toEqual([
      VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      VENTA_ESTADO_CONFIRMADA,
      VENTA_ESTADO_RECHAZADA,
      VENTA_ESTADO_REEMBOLSADA,
      VENTA_ESTADO_REEMBOLSO_PENDIENTE,
      VENTA_ESTADO_REEMBOLSO_RECHAZADO,
    ]);
    expect(VENTA_ESTADOS).toEqual([
      "pendiente_confirmacion",
      "confirmada",
      "rechazada",
      "reembolsada",
      "reembolso_pendiente",
      "reembolso_rechazado",
    ]);
  });
});

describe("vocabulario de casos", () => {
  it("CASO_TIPO_VENTA, CASO_TIPO_SOPORTE y CASO_ESTADO_PENDIENTE_APROBACION_HUMANA son los strings exactos de design.md", () => {
    expect(CASO_TIPO_VENTA).toBe("venta");
    expect(CASO_TIPO_SOPORTE).toBe("soporte");
    expect(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA).toBe("pendiente_aprobacion_humana");
  });

  it("CASO_ESTADO_RESUELTO es el string exacto de design.md §2 (ADR 34-41)", () => {
    expect(CASO_ESTADO_RESUELTO).toBe("resuelto");
  });
});

describe("LIMITE_LISTADO_ESCALACIONES", () => {
  it("es 20 (ADR 29 punto 1)", () => {
    expect(LIMITE_LISTADO_ESCALACIONES).toBe(20);
  });
});

describe("EscalacionListada", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato, con los campos opcionales del registro ausentes", () => {
    const escalacion: EscalacionListada = {
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      vendedorNombre: "Ana Vendedora",
      clienteId: "cliente-1",
      monto: 1000,
      casoId: "caso-1",
      reaperturasPrevias: 0,
    };

    expect(escalacion.confirmedAt).toBeUndefined();
    expect(escalacion.rechazadaPor).toBeUndefined();
    expect(escalacion.rechazadaAt).toBeUndefined();
  });

  it("acepta confirmedAt, rechazadaPor y rechazadaAt cuando están presentes", () => {
    const escalacion: EscalacionListada = {
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      vendedorNombre: "Ana Vendedora",
      clienteId: "cliente-1",
      monto: 1000,
      casoId: "caso-1",
      confirmedAt: "2026-09-01T00:00:00.000Z",
      rechazadaPor: "beto",
      rechazadaAt: "2026-09-02T00:00:00.000Z",
      reaperturasPrevias: 2,
    };

    expect(escalacion.rechazadaPor).toBe("beto");
    expect(escalacion.reaperturasPrevias).toBe(2);
  });
});

describe("ResolucionEscalacionInput", () => {
  it("es satisfecho por un objeto con la forma exacta del contrato (ADR 37, 39)", () => {
    const input: ResolucionEscalacionInput = {
      ventaId: "venta-1",
      casoId: "caso-1",
      empleadoId: "ana",
      accionId: "accion-1",
      ahora: "2026-09-01T00:00:00.000Z",
    };

    expect(input.empleadoId).toBe("ana");
    expect(input.accionId).toBe("accion-1");
  });
});

describe("FiltroEscalaciones", () => {
  it("acepta ventaId y limite opcionales", () => {
    const soloLimite: FiltroEscalaciones = { limite: 5 };
    const soloVentaId: FiltroEscalaciones = { ventaId: "venta-21" };
    const vacio: FiltroEscalaciones = {};

    expect(soloLimite.ventaId).toBeUndefined();
    expect(soloVentaId.limite).toBeUndefined();
    expect(vacio).toEqual({});
  });
});

describe("Venta", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato", () => {
    const venta: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planNuevo: "plan-pro",
      monto: 1000,
      estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      casoId: "caso-1",
      tokenConfirmacion: "token-1",
      createdAt: "2026-09-01T00:00:00.000Z",
    };

    expect(venta.estado).toBe("pendiente_confirmacion");
    expect(venta.planAnterior).toBeUndefined();
    expect(venta.confirmedAt).toBeUndefined();
    expect(venta.expiresAt).toBeUndefined();
  });

  it("acepta planAnterior, confirmedAt y expiresAt opcionales", () => {
    const venta: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planAnterior: "plan-basico",
      planNuevo: "plan-pro",
      monto: 1000,
      estado: VENTA_ESTADO_CONFIRMADA,
      casoId: "caso-1",
      tokenConfirmacion: "token-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      confirmedAt: "2026-09-01T01:00:00.000Z",
      expiresAt: "2026-09-04T00:00:00.000Z",
    };

    expect(venta.planAnterior).toBe("plan-basico");
    expect(venta.confirmedAt).toBe("2026-09-01T01:00:00.000Z");
    expect(venta.expiresAt).toBe("2026-09-04T00:00:00.000Z");
  });
});

describe("Comision", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato", () => {
    const comision: Comision = {
      id: "comision-1",
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      monto: 100,
      periodo: "2026-09",
      createdAt: "2026-09-01T01:00:00.000Z",
    };

    expect(comision.periodo).toBe("2026-09");
  });
});

describe("VentaPublica", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato, SIN token/caso_id/cliente_id", () => {
    const publica: VentaPublica = {
      planNuevo: "plan-pro",
      monto: 1000,
    };

    expect(publica.planAnterior).toBeUndefined();
    expect(publica).not.toHaveProperty("tokenConfirmacion");
    expect(publica).not.toHaveProperty("casoId");
    expect(publica).not.toHaveProperty("clienteId");
  });
});

describe("CrearVentaConCasoInput", () => {
  it("es satisfecho por un objeto con la forma exacta del contrato", () => {
    const input: CrearVentaConCasoInput = {
      vendedor: { id: "vendedor-1", nombre: "Vendedor Uno" },
      caso: { id: "caso-1", tipo: "venta", estado: "activo" },
      venta: {
        id: "venta-1",
        clienteId: "cliente-1",
        planNuevo: "plan-pro",
        monto: 1000,
        estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
        tokenConfirmacion: "token-1",
      },
      timestamp: "2026-09-01T00:00:00.000Z",
    };

    expect(input.venta.planAnterior).toBeUndefined();
    expect(input.venta.expiresAt).toBeUndefined();
  });
});

describe("ConfirmarVentaConComisionInput", () => {
  it("es satisfecho por un objeto con la forma exacta del contrato", () => {
    const input: ConfirmarVentaConComisionInput = {
      ventaId: "venta-1",
      comisionId: "comision-1",
      comisionMonto: 100,
      periodo: "2026-09",
      ahora: "2026-09-01T01:00:00.000Z",
    };

    expect(input.periodo).toBe("2026-09");
  });
});

describe("ConfirmacionAplicada", () => {
  it("es satisfecha por un objeto con venta y comision", () => {
    const venta: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planNuevo: "plan-pro",
      monto: 1000,
      estado: VENTA_ESTADO_CONFIRMADA,
      casoId: "caso-1",
      tokenConfirmacion: "token-1",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const comision: Comision = {
      id: "comision-1",
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      monto: 100,
      periodo: "2026-09",
      createdAt: "2026-09-01T01:00:00.000Z",
    };

    const aplicada: ConfirmacionAplicada = { venta, comision };

    expect(aplicada.venta).toEqual(venta);
    expect(aplicada.comision).toEqual(comision);
  });
});

describe("VentaStorePort", () => {
  it("es satisfecho por un objeto que implementa los 11 métodos con las firmas del contrato", () => {
    const venta: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planNuevo: "plan-pro",
      monto: 1000,
      estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      casoId: "caso-1",
      tokenConfirmacion: "token-1",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const comision: Comision = {
      id: "comision-1",
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      monto: 100,
      periodo: "2026-09",
      createdAt: "2026-09-01T01:00:00.000Z",
    };
    const escalacion: EscalacionListada = {
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      vendedorNombre: "Ana Vendedora",
      clienteId: "cliente-1",
      monto: 1000,
      casoId: "caso-1",
      reaperturasPrevias: 0,
    };

    const store: VentaStorePort = {
      crearVentaConCaso(_input) {
        return venta;
      },
      buscarVentaPorToken(token) {
        expect(token).toBe("token-1");
        return venta;
      },
      confirmarVentaConComision(input) {
        expect(input.ventaId).toBe("venta-1");
        return { venta: { ...venta, estado: VENTA_ESTADO_CONFIRMADA }, comision };
      },
      rechazarVenta(input) {
        expect(input.ventaId).toBe("venta-1");
        return { ...venta, estado: VENTA_ESTADO_RECHAZADA };
      },
      aprobarReembolso(input) {
        expect(input.ventaId).toBe("venta-1");
        return { ...venta, estado: VENTA_ESTADO_REEMBOLSADA };
      },
      escalarReembolso(input) {
        expect(input.casoId).toBe("caso-1");
        return { ...venta, estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE };
      },
      listarReembolsosPendientes(_filtro) {
        return [escalacion];
      },
      listarReembolsosRechazados(_filtro) {
        return [escalacion];
      },
      aprobarEscalacionReembolso(input) {
        expect(input.empleadoId).toBe("ana");
        return { ...venta, estado: VENTA_ESTADO_REEMBOLSADA };
      },
      rechazarEscalacionReembolso(input) {
        expect(input.accionId).toBe("accion-1");
        return { ...venta, estado: VENTA_ESTADO_REEMBOLSO_RECHAZADO };
      },
      reabrirEscalacionReembolso(input) {
        expect(input.ventaId).toBe("venta-1");
        return { ...venta, estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE };
      },
    };

    expect(
      store.crearVentaConCaso({
        vendedor: { id: "vendedor-1", nombre: "Vendedor Uno" },
        caso: { id: "caso-1", tipo: "venta", estado: "activo" },
        venta: {
          id: "venta-1",
          clienteId: "cliente-1",
          planNuevo: "plan-pro",
          monto: 1000,
          estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
          tokenConfirmacion: "token-1",
        },
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual(venta);

    expect(store.buscarVentaPorToken("token-1")).toEqual(venta);

    expect(
      store.confirmarVentaConComision({
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 100,
        periodo: "2026-09",
        ahora: "2026-09-01T01:00:00.000Z",
      })?.venta.estado,
    ).toBe("confirmada");

    expect(store.rechazarVenta({ ventaId: "venta-1", ahora: "2026-09-01T01:00:00.000Z" })?.estado).toBe(
      "rechazada",
    );

    expect(store.aprobarReembolso({ ventaId: "venta-1", ahora: "2026-09-01T01:00:00.000Z" })?.estado).toBe(
      "reembolsada",
    );

    expect(
      store.escalarReembolso({
        ventaId: "venta-1",
        casoId: "caso-1",
        ahora: "2026-09-01T01:00:00.000Z",
      })?.estado,
    ).toBe("reembolso_pendiente");

    expect(store.listarReembolsosPendientes()).toEqual([escalacion]);
    expect(store.listarReembolsosRechazados({ ventaId: "venta-1" })).toEqual([escalacion]);

    const resolucionInput: ResolucionEscalacionInput = {
      ventaId: "venta-1",
      casoId: "caso-1",
      empleadoId: "ana",
      accionId: "accion-1",
      ahora: "2026-09-01T02:00:00.000Z",
    };

    expect(store.aprobarEscalacionReembolso(resolucionInput)?.estado).toBe("reembolsada");
    expect(store.rechazarEscalacionReembolso(resolucionInput)?.estado).toBe("reembolso_rechazado");
    expect(store.reabrirEscalacionReembolso(resolucionInput)?.estado).toBe("reembolso_pendiente");
  });

  it("los 7 métodos de transición devuelven undefined cuando el CAS no aplica", () => {
    const store: VentaStorePort = {
      crearVentaConCaso(_input) {
        throw new Error("no ejercitado en este test");
      },
      buscarVentaPorToken(_token) {
        return undefined;
      },
      confirmarVentaConComision(_input) {
        return undefined;
      },
      rechazarVenta(_input) {
        return undefined;
      },
      aprobarReembolso(_input) {
        return undefined;
      },
      escalarReembolso(_input) {
        return undefined;
      },
      listarReembolsosPendientes(_filtro) {
        return [];
      },
      listarReembolsosRechazados(_filtro) {
        return [];
      },
      aprobarEscalacionReembolso(_input) {
        return undefined;
      },
      rechazarEscalacionReembolso(_input) {
        return undefined;
      },
      reabrirEscalacionReembolso(_input) {
        return undefined;
      },
    };

    expect(store.buscarVentaPorToken("inexistente")).toBeUndefined();
    expect(
      store.confirmarVentaConComision({
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 100,
        periodo: "2026-09",
        ahora: "2026-09-01T01:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(store.rechazarVenta({ ventaId: "venta-1", ahora: "2026-09-01T01:00:00.000Z" })).toBeUndefined();
    expect(
      store.aprobarReembolso({ ventaId: "venta-1", ahora: "2026-09-01T01:00:00.000Z" }),
    ).toBeUndefined();
    expect(
      store.escalarReembolso({
        ventaId: "venta-1",
        casoId: "caso-1",
        ahora: "2026-09-01T01:00:00.000Z",
      }),
    ).toBeUndefined();

    const resolucionInput: ResolucionEscalacionInput = {
      ventaId: "venta-1",
      casoId: "caso-1",
      empleadoId: "ana",
      accionId: "accion-1",
      ahora: "2026-09-01T02:00:00.000Z",
    };
    expect(store.aprobarEscalacionReembolso(resolucionInput)).toBeUndefined();
    expect(store.rechazarEscalacionReembolso(resolucionInput)).toBeUndefined();
    expect(store.reabrirEscalacionReembolso(resolucionInput)).toBeUndefined();
  });
});

describe("VentaNotifierPort", () => {
  it("es satisfecho por un objeto async que implementa notificarLinkConfirmacion con la firma del contrato", async () => {
    const notifier: VentaNotifierPort = {
      async notificarLinkConfirmacion(input) {
        expect(input.clienteEmail).toBe("cliente@example.com");
        expect(input.linkConfirmacion).toBe("https://x/confirmar/token-1");
        expect(input.planNuevo).toBe("plan-pro");
        expect(input.monto).toBe(1000);
        expect(input.casoId).toBe("caso-1");
        return { enviado: true };
      },
    };

    await expect(
      notifier.notificarLinkConfirmacion({
        clienteEmail: "cliente@example.com",
        linkConfirmacion: "https://x/confirmar/token-1",
        planNuevo: "plan-pro",
        monto: 1000,
        casoId: "caso-1",
      }),
    ).resolves.toEqual({ enviado: true });
  });

  it("nunca rechaza — devuelve enviado:false con motivo en vez de lanzar", async () => {
    const notifier: VentaNotifierPort = {
      async notificarLinkConfirmacion(_input) {
        return { enviado: false, motivo: "sin-api-key" };
      },
    };

    await expect(
      notifier.notificarLinkConfirmacion({
        clienteEmail: "cliente@example.com",
        linkConfirmacion: "https://x/confirmar/token-1",
        planNuevo: "plan-pro",
        monto: 1000,
        casoId: "caso-1",
      }),
    ).resolves.toEqual({ enviado: false, motivo: "sin-api-key" });
  });
});

describe("tipos exportados", () => {
  it("VentaEstado y NotificacionMotivo son los tipos unión esperados", () => {
    const estado: VentaEstado = "reembolso_pendiente";
    const motivo: NotificacionMotivo = "timeout";
    const resultado: NotificacionResultado = { enviado: false, motivo: "network" };

    expect(VENTA_ESTADOS).toContain(estado);
    expect(["sin-api-key", "sin-destinatario", "http", "network", "timeout", "unknown"]).toContain(motivo);
    expect(resultado).toEqual({ enviado: false, motivo: "network" });
  });
});

describe("ventas-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./ventas-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
