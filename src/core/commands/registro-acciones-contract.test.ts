import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_APROBAR_SOLICITUD,
  COMANDO_DEVOLUCION,
  COMANDO_LOGIN,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_RECHAZAR_SOLICITUD,
  COMANDO_SOLICITAR,
  COMANDO_SOPORTE,
  RESULTADO_APROBADA,
  RESULTADO_ATENDIDA,
  RESULTADO_CREADA,
  RESULTADO_EXITOSA,
  RESULTADO_FALLIDA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_REABIERTA,
  RESULTADO_RECHAZADA,
  RESULTADO_REEMBOLSADA,
  RESULTADO_ESCALADA,
  type AccionEmpleado,
  type RegistroAccionesEmpleadoPort,
} from "./registro-acciones-contract.js";

/** Spec `registro-acciones-empleado`, requirements 1, 2, 5 (ADR 27, 39, 40). */

describe("vocabulario de comando", () => {
  it("son los strings exactos de comando-empleado.ts", () => {
    expect(COMANDO_LOGIN).toBe("/login");
    expect(COMANDO_SOPORTE).toBe("/soporte");
    expect(COMANDO_DEVOLUCION).toBe("/devolucion");
    expect(COMANDO_APROBAR_REEMBOLSO).toBe("/aprobar-reembolso");
    expect(COMANDO_RECHAZAR_REEMBOLSO).toBe("/rechazar-reembolso");
    expect(COMANDO_REABRIR_REEMBOLSO).toBe("/reabrir-reembolso");
    expect(COMANDO_SOLICITAR).toBe("/solicitar");
    expect(COMANDO_APROBAR_SOLICITUD).toBe("/aprobar-solicitud");
    expect(COMANDO_RECHAZAR_SOLICITUD).toBe("/rechazar-solicitud");
  });
});

describe("vocabulario de resultado", () => {
  it("son los nueve strings exactos de design.md §3.2", () => {
    expect(RESULTADO_EXITOSA).toBe("exitosa");
    expect(RESULTADO_ATENDIDA).toBe("atendida");
    expect(RESULTADO_FALLIDA).toBe("fallida");
    expect(RESULTADO_REEMBOLSADA).toBe("reembolsada");
    expect(RESULTADO_ESCALADA).toBe("escalada");
    expect(RESULTADO_APROBADA).toBe("aprobada");
    expect(RESULTADO_RECHAZADA).toBe("rechazada");
    expect(RESULTADO_REABIERTA).toBe("reabierta");
    expect(RESULTADO_NO_APLICABLE).toBe("no_aplicable");
    expect(RESULTADO_CREADA).toBe("creada");
  });
});

describe("AccionEmpleado", () => {
  it("es satisfecha por un objeto con venta_id/caso_id ausentes (consulta de soporte sin venta)", () => {
    const accion: AccionEmpleado = {
      id: "accion-1",
      empleadoId: "ana",
      comando: COMANDO_SOPORTE,
      casoId: "caso-1",
      resultado: RESULTADO_ATENDIDA,
      ocurridoAt: "2026-09-01T00:00:00.000Z",
    };

    expect(accion.ventaId).toBeUndefined();
    expect(accion.casoId).toBe("caso-1");
  });

  it("NO tiene campos para token_confirmacion, password, texto de consulta ni motivo (garantía estructural, ADR 27)", () => {
    const accion: AccionEmpleado = {
      id: "accion-1",
      empleadoId: "ana",
      comando: COMANDO_LOGIN,
      resultado: RESULTADO_EXITOSA,
      ocurridoAt: "2026-09-01T00:00:00.000Z",
    };

    expect(accion).not.toHaveProperty("password");
    expect(accion).not.toHaveProperty("token");
    expect(accion).not.toHaveProperty("tokenConfirmacion");
    expect(accion).not.toHaveProperty("consulta");
    expect(accion).not.toHaveProperty("motivo");
  });
});

describe("RegistroAccionesEmpleadoPort", () => {
  it("es satisfecho por un objeto con registrarAccion(accion): void", () => {
    let recibida: AccionEmpleado | undefined;
    const port: RegistroAccionesEmpleadoPort = {
      registrarAccion(accion) {
        recibida = accion;
      },
    };

    port.registrarAccion({
      id: "accion-1",
      empleadoId: "ana",
      comando: COMANDO_DEVOLUCION,
      ventaId: "venta-1",
      casoId: "caso-1",
      resultado: RESULTADO_REEMBOLSADA,
      ocurridoAt: "2026-09-01T00:00:00.000Z",
    });

    expect(recibida?.empleadoId).toBe("ana");
    expect(recibida?.ventaId).toBe("venta-1");
  });
});

describe("registro-acciones-contract.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./registro-acciones-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
