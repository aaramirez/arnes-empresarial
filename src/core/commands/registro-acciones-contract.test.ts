import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMANDO_APLICAR_PROPUESTA,
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_APROBAR_SOLICITUD,
  COMANDO_ASIGNAR_ROL,
  COMANDO_DESCARTAR_PROPUESTA,
  COMANDO_DEVOLUCION,
  COMANDO_LOGIN,
  COMANDO_REABRIR_REEMBOLSO,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_RECHAZAR_SOLICITUD,
  COMANDO_SOLICITAR,
  COMANDO_SOLICITAR_DEVOLUCION,
  COMANDO_SOPORTE,
  COMANDO_VER_PROPUESTA,
  RESULTADO_APLICADA,
  RESULTADO_APROBADA,
  RESULTADO_ATENDIDA,
  RESULTADO_AUTODEGRADACION_PROHIBIDA,
  RESULTADO_CREADA,
  RESULTADO_DESCARTADA,
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
    expect(COMANDO_VER_PROPUESTA).toBe("/ver-propuesta");
    expect(COMANDO_APLICAR_PROPUESTA).toBe("/aplicar-propuesta");
    expect(COMANDO_DESCARTAR_PROPUESTA).toBe("/descartar-propuesta");
  });

  it("COMANDO_ASIGNAR_ROL es '/asignar-rol' (comandos-administracion-empleados, tarea 7, ADR 184)", () => {
    expect(COMANDO_ASIGNAR_ROL).toBe("/asignar-rol");
  });

  it("★ COMANDO_SOLICITAR_DEVOLUCION es 'operacion:solicitar_devolucion' y es DISTINTO de COMANDO_DEVOLUCION (devolucion-sin-token-dos-personas, ADR 230 pto 1) — dos vías, dos precios", () => {
    expect(COMANDO_SOLICITAR_DEVOLUCION).toBe("operacion:solicitar_devolucion");
    expect(COMANDO_SOLICITAR_DEVOLUCION).not.toBe(COMANDO_DEVOLUCION);
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
    expect(RESULTADO_APLICADA).toBe("aplicada");
    expect(RESULTADO_DESCARTADA).toBe("descartada");
  });

  it("RESULTADO_AUTODEGRADACION_PROHIBIDA es 'autodegradacion_prohibida' (comandos-administracion-empleados, tarea 7, ADR 182)", () => {
    expect(RESULTADO_AUTODEGRADACION_PROHIBIDA).toBe("autodegradacion_prohibida");
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

  it("★ NO ganó ningún campo con devolucion-sin-token-dos-personas — exactamente las mismas OCHO claves de antes (ADR 27, R13, tarea 15)", () => {
    const accion: AccionEmpleado = {
      id: "accion-1",
      empleadoId: "ana",
      comando: COMANDO_SOLICITAR_DEVOLUCION,
      ventaId: "venta-1",
      casoId: "caso-1",
      resultado: RESULTADO_ESCALADA,
      ocurridoAt: "2026-09-01T00:00:00.000Z",
    };

    expect(Object.keys(accion).sort()).toEqual(
      ["id", "empleadoId", "comando", "ventaId", "casoId", "resultado", "ocurridoAt"].sort(),
    );
    expect(accion).not.toHaveProperty("motivo");
  });

  it("acepta propuestaId opcional (ADR 63), sin exigirlo en acciones que no son de propuestas", () => {
    const accion: AccionEmpleado = {
      id: "accion-1",
      empleadoId: "ana",
      comando: COMANDO_APLICAR_PROPUESTA,
      propuestaId: "propuesta-1",
      casoId: "caso-1",
      resultado: RESULTADO_APLICADA,
      ocurridoAt: "2026-09-01T00:00:00.000Z",
    };

    expect(accion.propuestaId).toBe("propuesta-1");
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
