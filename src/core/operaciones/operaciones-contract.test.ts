import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOMINIO_DEVOLUCION,
  DOMINIO_REEMBOLSO,
  DOMINIO_SOLICITUD,
  OPERACIONES_MCP_SERVER_NAME,
  OPERACIONES_NEGOCIO,
  OPERACIONES_TOOL_NAME,
  OPERACIONES_TOOL_QUALIFIED_NAME,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_CONSULTAR_VENTA,
  OPERACION_CONSULTAR_SOLICITUD,
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_RESOLVER_REEMBOLSO,
  OPERACION_RESOLVER_SOLICITUD,
  OPERACION_SOLICITAR_DEVOLUCION,
  type AccionConfirmable,
  type AccionReembolsoModelo,
  type AccionSolicitudModelo,
  type ConfirmacionOperacionPort,
  type DominioConfirmacion,
  type LlaveConfirmacion,
  type OperacionCancelarSolicitudInterna,
  type OperacionConsultarReporteComisiones,
  type OperacionConsultarSolicitud,
  type OperacionConsultarVenta,
  type OperacionCrearSolicitudInterna,
  type OperacionNegocio,
  type OperacionProcesarDevolucion,
  type OperacionRegistrarVenta,
  type OperacionResolverDecisionVenta,
  type OperacionResolverReembolso,
  type OperacionResolverSolicitud,
  type OperacionSolicitarDevolucion,
} from "./operaciones-contract.js";

/**
 * operaciones-negocio-conversacionales, tarea 1. Molde de `hitl-contract.test.ts`
 * (constantes + chequeos de tipos en compilación) — este módulo, igual que
 * `hitl-contract.ts`, no tiene ni un solo `import` en su fuente.
 */

describe("operaciones-contract constants", () => {
  it("OPERACIONES_TOOL_QUALIFIED_NAME es mcp__operaciones__operacion_negocio", () => {
    expect(OPERACIONES_MCP_SERVER_NAME).toBe("operaciones");
    expect(OPERACIONES_TOOL_NAME).toBe("operacion_negocio");
    expect(OPERACIONES_TOOL_QUALIFIED_NAME).toBe("mcp__operaciones__operacion_negocio");
  });

  it("OPERACIONES_NEGOCIO enumera ONCE operaciones — forma FINAL (consulta-solicitud-propia, tarea 4.1): consultar_solicitud precede a nada, cierra el array", () => {
    expect(OPERACIONES_NEGOCIO).toEqual([
      OPERACION_RESOLVER_DECISION_VENTA,
      OPERACION_PROCESAR_DEVOLUCION,
      OPERACION_CREAR_SOLICITUD_INTERNA,
      OPERACION_CANCELAR_SOLICITUD_INTERNA,
      OPERACION_REGISTRAR_VENTA,
      OPERACION_CONSULTAR_REPORTE_COMISIONES,
      OPERACION_RESOLVER_SOLICITUD,
      OPERACION_RESOLVER_REEMBOLSO,
      OPERACION_SOLICITAR_DEVOLUCION,
      OPERACION_CONSULTAR_VENTA,
      OPERACION_CONSULTAR_SOLICITUD,
    ]);
    expect(OPERACIONES_NEGOCIO).toHaveLength(11);
  });
});

describe("OperacionSolicitarDevolucion (devolucion-sin-token-dos-personas, tarea 11, ADR 223/228/229 pto 3)", () => {
  it("ventaId y motivo opcionales en el TIPO (ausente ventaId ⇒ modo listado), SIN accion ni confirmado", () => {
    const listado: OperacionSolicitarDevolucion = { operacion: OPERACION_SOLICITAR_DEVOLUCION };
    const conDatos: OperacionSolicitarDevolucion = {
      operacion: OPERACION_SOLICITAR_DEVOLUCION,
      ventaId: "venta-1",
      motivo: "el cliente se arrepintió",
    };
    const generico: OperacionNegocio = listado;

    expect(generico.operacion).toBe("solicitar_devolucion");
    expect(conDatos.ventaId).toBe("venta-1");
    expect(conDatos.motivo).toBe("el cliente se arrepintió");
    expect("accion" in listado).toBe(false);
    expect("confirmado" in listado).toBe(false);
  });
});

describe("OperacionConsultarVenta (devolucion-sin-token-dos-personas, tarea 3, ADR 225/229 pto 5)", () => {
  it("ventaId opcional (ausente ⇒ modo listado), SIN accion ni confirmado — es de sólo lectura", () => {
    const listado: OperacionConsultarVenta = { operacion: OPERACION_CONSULTAR_VENTA };
    const conId: OperacionConsultarVenta = { operacion: OPERACION_CONSULTAR_VENTA, ventaId: "venta-1" };
    const generico: OperacionNegocio = listado;

    expect(generico.operacion).toBe("consultar_venta");
    expect(conId.ventaId).toBe("venta-1");
    expect("accion" in listado).toBe(false);
    expect("confirmado" in listado).toBe(false);
  });
});

describe("OperacionConsultarSolicitud (consulta-solicitud-propia, ADR 237/238/239, tarea 4.1)", () => {
  it("solicitudId opcional (ausente ⇒ modo listado), SIN accion ni confirmado — es de sólo lectura", () => {
    const listado: OperacionConsultarSolicitud = { operacion: OPERACION_CONSULTAR_SOLICITUD };
    const conId: OperacionConsultarSolicitud = { operacion: OPERACION_CONSULTAR_SOLICITUD, solicitudId: "sol-1" };
    const generico: OperacionNegocio = listado;

    expect(generico.operacion).toBe("consultar_solicitud");
    expect(conId.solicitudId).toBe("sol-1");
    expect("accion" in listado).toBe(false);
    expect("confirmado" in listado).toBe(false);
  });
});

describe("OperacionNegocio — cada input mínimo tipa correctamente", () => {
  it("resolver_decision_venta: token + decision", () => {
    const op: OperacionResolverDecisionVenta = {
      operacion: OPERACION_RESOLVER_DECISION_VENTA,
      token: "token-1",
      decision: "confirmar",
    };
    const generico: OperacionNegocio = op;
    expect(generico.operacion).toBe("resolver_decision_venta");
  });

  it("procesar_devolucion: token, motivo opcional", () => {
    const sinMotivo: OperacionProcesarDevolucion = {
      operacion: OPERACION_PROCESAR_DEVOLUCION,
      token: "token-1",
    };
    const conMotivo: OperacionProcesarDevolucion = {
      operacion: OPERACION_PROCESAR_DEVOLUCION,
      token: "token-1",
      motivo: "no le sirvió",
    };
    const generico: OperacionNegocio = sinMotivo;
    expect(generico.operacion).toBe("procesar_devolucion");
    expect(conMotivo.motivo).toBe("no le sirvió");
  });

  it("crear_solicitud_interna: tipo + detalle, ambos string libres", () => {
    const op: OperacionCrearSolicitudInterna = {
      operacion: OPERACION_CREAR_SOLICITUD_INTERNA,
      tipo: "gasto",
      detalle: "taxi al cliente",
    };
    const generico: OperacionNegocio = op;
    expect(generico.operacion).toBe("crear_solicitud_interna");
  });

  it("cancelar_solicitud_interna: solicitudId opcional (ausente = modo listado)", () => {
    const listado: OperacionCancelarSolicitudInterna = {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
    };
    const conId: OperacionCancelarSolicitudInterna = {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
      solicitudId: "sol-1",
    };
    const generico: OperacionNegocio = listado;
    expect(generico.operacion).toBe("cancelar_solicitud_interna");
    expect(conId.solicitudId).toBe("sol-1");
  });

  it("registrar_venta: monto es la ÚNICA excepción de dinero del contrato (ADR 170/171), sin vendedorId", () => {
    const op: OperacionRegistrarVenta = {
      operacion: OPERACION_REGISTRAR_VENTA,
      clienteId: "cliente-1",
      clienteEmail: "cliente@example.com",
      planNuevo: "premium",
      monto: 100,
      vendedorNombre: "Juan Pérez",
    };
    const generico: OperacionNegocio = op;
    expect(generico.operacion).toBe("registrar_venta");
    // vendedorId NUNCA es campo del modelo (ADR 147 pto 1, ADR 171 pto 2) — sale de sesion.empleadoId por closure.
    expect("vendedorId" in op).toBe(false);
  });

  it("resolver_solicitud: accion + solicitudId opcional, sin campo confirmado (ADR 206)", () => {
    const listado: OperacionResolverSolicitud = {
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "aprobar",
    };
    const conId: OperacionResolverSolicitud = {
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "rechazar",
      solicitudId: "sol-1",
    };
    const generico: OperacionNegocio = listado;
    expect(generico.operacion).toBe("resolver_solicitud");
    expect(conId.solicitudId).toBe("sol-1");
    // `confirmado` NUNCA es campo de esta interfaz — lo decide el composition root (ADR 206, §0.1).
    expect("confirmado" in listado).toBe(false);
  });

  it("resolver_reembolso: accion + ventaId opcional, sin campo confirmado, tres valores de accion (ADR 206)", () => {
    const listado: OperacionResolverReembolso = {
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "aprobar",
    };
    const conId: OperacionResolverReembolso = {
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "reabrir",
      ventaId: "v1",
    };
    const generico: OperacionNegocio = listado;
    expect(generico.operacion).toBe("resolver_reembolso");
    expect(conId.ventaId).toBe("v1");
    // `confirmado` NUNCA es campo de esta interfaz — lo decide el composition root (ADR 206, §0.1).
    expect("confirmado" in listado).toBe(false);

    const aprobar: AccionReembolsoModelo = "aprobar";
    const rechazar: AccionReembolsoModelo = "rechazar";
    const reabrir: AccionReembolsoModelo = "reabrir";
    expect([aprobar, rechazar, reabrir]).toEqual(["aprobar", "rechazar", "reabrir"]);
  });

  it("consultar_reporte_comisiones: único campo opcional periodo, sin dinero ni identidad (ADR 174)", () => {
    const sinPeriodo: OperacionConsultarReporteComisiones = {
      operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES,
    };
    const conPeriodo: OperacionConsultarReporteComisiones = {
      operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES,
      periodo: "2026-08",
    };
    const generico: OperacionNegocio = sinPeriodo;
    expect(generico.operacion).toBe("consultar_reporte_comisiones");
    expect(conPeriodo.periodo).toBe("2026-08");
  });
});

describe("OperacionNegocio — invariante: campo de dinero/período sólo en su operación (ADR 145 pto 2, ADR 170/171/174)", () => {
  // Chequeo de tipos en tiempo de compilación, no una prueba de
  // comportamiento: estas funciones nunca se invocan (mismo molde que
  // `definitions.test.ts:198-210`). La garantía la da `tsc --noEmit` al
  // fallar si el `@ts-expect-error` deja de ser necesario.

  function _chequeoDeTipos_resolverDecisionVentaNoAceptaMonto(): void {
    const op: OperacionResolverDecisionVenta = {
      operacion: OPERACION_RESOLVER_DECISION_VENTA,
      token: "t",
      decision: "confirmar",
      // @ts-expect-error — `monto` no es campo de `resolver_decision_venta`; es la única excepción de `registrar_venta` (ADR 170/171).
      monto: 100,
    };
    void op;
  }

  function _chequeoDeTipos_procesarDevolucionNoAceptaPorcentaje(): void {
    const op: OperacionProcesarDevolucion = {
      operacion: OPERACION_PROCESAR_DEVOLUCION,
      token: "t",
      // @ts-expect-error — `porcentaje` no es campo de ninguna operación del contrato (ADR 145 pto 2).
      porcentaje: 10,
    };
    void op;
  }

  function _chequeoDeTipos_crearSolicitudInternaNoAceptaMonto(): void {
    const op: OperacionCrearSolicitudInterna = {
      operacion: OPERACION_CREAR_SOLICITUD_INTERNA,
      tipo: "gasto",
      detalle: "x",
      // @ts-expect-error — `monto` no es campo de `crear_solicitud_interna`.
      monto: 50,
    };
    void op;
  }

  function _chequeoDeTipos_cancelarSolicitudInternaNoAceptaMonto(): void {
    const op: OperacionCancelarSolicitudInterna = {
      operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA,
      // @ts-expect-error — `monto` no es campo de `cancelar_solicitud_interna`.
      monto: 50,
    };
    void op;
  }

  function _chequeoDeTipos_consultarReporteComisionesNoAceptaMonto(): void {
    const op: OperacionConsultarReporteComisiones = {
      operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES,
      // @ts-expect-error — `monto` no es campo de `consultar_reporte_comisiones` (sólo lectura, ADR 174).
      monto: 50,
    };
    void op;
  }

  function _chequeoDeTipos_registrarVentaNoAceptaPeriodo(): void {
    const op: OperacionRegistrarVenta = {
      operacion: OPERACION_REGISTRAR_VENTA,
      clienteId: "c",
      clienteEmail: "c@example.com",
      planNuevo: "p",
      monto: 1,
      vendedorNombre: "x",
      // @ts-expect-error — `periodo` no es campo de `registrar_venta`; es exclusivo de `consultar_reporte_comisiones` (ADR 174).
      periodo: "2026-01",
    };
    void op;
  }

  function _chequeoDeTipos_resolverSolicitudNoAceptaConfirmado(): void {
    const op: OperacionResolverSolicitud = {
      operacion: OPERACION_RESOLVER_SOLICITUD,
      accion: "aprobar",
      // @ts-expect-error — `confirmado` NUNCA es campo del schema (ADR 206, §0.1) — lo decide el composition root.
      confirmado: true,
    };
    void op;
  }

  function _chequeoDeTipos_accionSolicitudModeloNoAceptaCancelar(): void {
    // @ts-expect-error — "cancelar" nunca es un AccionSolicitudModelo (ADR 217) — esa acción es de `cancelar_solicitud_interna`, no de `resolver_solicitud`.
    const accionInvalida: AccionSolicitudModelo = "cancelar";
    void accionInvalida;
  }

  function _chequeoDeTipos_resolverReembolsoNoAceptaMonto(): void {
    const op: OperacionResolverReembolso = {
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "aprobar",
      // @ts-expect-error — `monto` no es campo de `resolver_reembolso`.
      monto: 50,
    };
    void op;
  }

  function _chequeoDeTipos_consultarVentaNoAceptaMonto(): void {
    const op: OperacionConsultarVenta = {
      operacion: OPERACION_CONSULTAR_VENTA,
      // @ts-expect-error — `monto` no es campo de `consultar_venta` (sólo lectura, ADR 225).
      monto: 50,
    };
    void op;
  }

  function _chequeoDeTipos_solicitarDevolucionNoAceptaAccion(): void {
    const op: OperacionSolicitarDevolucion = {
      operacion: OPERACION_SOLICITAR_DEVOLUCION,
      ventaId: "v1",
      motivo: "m",
      // @ts-expect-error — `accion` NUNCA es campo de `solicitar_devolucion` (ADR 229 pto 3) — la pone el dispatcher, literal.
      accion: "aprobar",
    };
    void op;
  }

  function _chequeoDeTipos_solicitarDevolucionNoAceptaConfirmado(): void {
    const op: OperacionSolicitarDevolucion = {
      operacion: OPERACION_SOLICITAR_DEVOLUCION,
      // @ts-expect-error — `confirmado` NUNCA es campo del schema (ADR 206, §0.1) — lo decide el composition root.
      confirmado: true,
    };
    void op;
  }

  function _chequeoDeTipos_resolverReembolsoNoAceptaConfirmado(): void {
    const op: OperacionResolverReembolso = {
      operacion: OPERACION_RESOLVER_REEMBOLSO,
      accion: "aprobar",
      // @ts-expect-error — `confirmado` NUNCA es campo del schema (ADR 206, §0.1) — lo decide el composition root.
      confirmado: true,
    };
    void op;
  }

  function _chequeoDeTipos_accionReembolsoModeloNoAceptaCancelar(): void {
    // @ts-expect-error — "cancelar" nunca es un AccionReembolsoModelo (ADR 217) — esa acción es exclusiva de `cancelar_solicitud_interna`.
    const accionInvalida: AccionReembolsoModelo = "cancelar";
    void accionInvalida;
  }

  it("las funciones de arriba nunca se invocan — la garantía es tsc --noEmit, no runtime", () => {
    expect(typeof _chequeoDeTipos_resolverDecisionVentaNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_procesarDevolucionNoAceptaPorcentaje).toBe("function");
    expect(typeof _chequeoDeTipos_crearSolicitudInternaNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_cancelarSolicitudInternaNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_consultarReporteComisionesNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_registrarVentaNoAceptaPeriodo).toBe("function");
    expect(typeof _chequeoDeTipos_resolverSolicitudNoAceptaConfirmado).toBe("function");
    expect(typeof _chequeoDeTipos_accionSolicitudModeloNoAceptaCancelar).toBe("function");
    expect(typeof _chequeoDeTipos_resolverReembolsoNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_consultarVentaNoAceptaMonto).toBe("function");
    expect(typeof _chequeoDeTipos_resolverReembolsoNoAceptaConfirmado).toBe("function");
    expect(typeof _chequeoDeTipos_accionReembolsoModeloNoAceptaCancelar).toBe("function");
    expect(typeof _chequeoDeTipos_solicitarDevolucionNoAceptaAccion).toBe("function");
    expect(typeof _chequeoDeTipos_solicitarDevolucionNoAceptaConfirmado).toBe("function");
  });
});

describe("ConfirmacionOperacionPort — LlaveConfirmacion (ADR 209/212/213)", () => {
  it("marcarPendiente + estaConfirmada + consumir reciben LlaveConfirmacion en las tres firmas, guard origenCasoId !== casoIdActual intacto", () => {
    let pendiente:
      | {
          dominio: DominioConfirmacion;
          itemId: string;
          accion: AccionConfirmable;
          empleadoId: string;
          casoId: string;
          origenCasoId: string;
        }
      | undefined;

    // Doble que implementa el puerto nuevo — compila con las tres firmas exactas (tarea 1).
    const port: ConfirmacionOperacionPort = {
      estaConfirmada: (llave, empleadoId, casoIdActual) =>
        pendiente !== undefined &&
        pendiente.dominio === llave.dominio &&
        pendiente.itemId === llave.itemId &&
        pendiente.accion === llave.accion &&
        pendiente.empleadoId === empleadoId &&
        pendiente.origenCasoId !== casoIdActual,
      marcarPendiente: (input) => {
        pendiente = { ...input };
      },
      consumir: (_llave) => {
        pendiente = undefined;
      },
    };

    const llave: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "s1", accion: "cancelar" };

    port.marcarPendiente({ ...llave, casoId: "c1", empleadoId: "e1", origenCasoId: "caso-turno-1" });

    // Mismo turno que creó la ranura ⇒ nunca autoconfirma (ADR 166).
    expect(port.estaConfirmada(llave, "e1", "caso-turno-1")).toBe(false);
    // Turno posterior ⇒ sí confirma.
    expect(port.estaConfirmada(llave, "e1", "caso-turno-2")).toBe(true);

    port.consumir(llave);
    expect(port.estaConfirmada(llave, "e1", "caso-turno-2")).toBe(false);
  });

  it("DominioConfirmacion es una unión cerrada de TRES literales (devolucion-sin-token-dos-personas, tarea 11), sin 'propuesta' (ADR 212 pto 4)", () => {
    const reembolso: DominioConfirmacion = DOMINIO_REEMBOLSO;
    const solicitud: DominioConfirmacion = DOMINIO_SOLICITUD;
    const devolucion: DominioConfirmacion = DOMINIO_DEVOLUCION;
    expect(reembolso).toBe("reembolso");
    expect(solicitud).toBe("solicitud");
    expect(devolucion).toBe("devolucion");

    function _chequeoDeTipos_dominioConfirmacionNoAceptaPropuesta(): void {
      // @ts-expect-error — "propuesta" nunca es un DominioConfirmacion; esa ranura es de la TUI, no de esta capability (ADR 212 pto 4).
      const dominioInvalido: DominioConfirmacion = "propuesta";
      void dominioInvalido;
    }
    expect(typeof _chequeoDeTipos_dominioConfirmacionNoAceptaPropuesta).toBe("function");
  });

  it("★ AccionConfirmable gana 'solicitar' (devolucion-sin-token-dos-personas, ADR 229 pto 3) — no es campo de ningún schema, el dispatcher la pone literal", () => {
    const solicitar: AccionConfirmable = "solicitar";
    expect(solicitar).toBe("solicitar");

    const llave: LlaveConfirmacion = { dominio: DOMINIO_DEVOLUCION, itemId: "venta-1", accion: "solicitar" };
    expect(llave.accion).toBe("solicitar");
  });
});

describe("operaciones-contract.ts source", () => {
  it("has no import statements — el módulo del contrato no importa nada", () => {
    const sourcePath = fileURLToPath(new URL("./operaciones-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
