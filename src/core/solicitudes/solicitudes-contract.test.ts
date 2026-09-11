import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";
import {
  LIMITE_LISTADO_SOLICITUDES,
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_TIPO_GASTO,
  SOLICITUD_TIPO_VACACIONES,
  SOLICITUD_TIPOS,
  type CrearSolicitudConCasoInput,
  type ResolucionSolicitudInput,
  type SolicitudEstado,
  type SolicitudInterna,
  type SolicitudStorePort,
  type SolicitudTipo,
} from "./solicitudes-contract.js";

describe("SOLICITUD_TIPOS", () => {
  it("tiene exactamente 'vacaciones' y 'gasto', en ese orden", () => {
    expect(SOLICITUD_TIPOS).toEqual(["vacaciones", "gasto"]);
  });

  it("SOLICITUD_TIPO_VACACIONES es 'vacaciones'", () => {
    expect(SOLICITUD_TIPO_VACACIONES).toBe("vacaciones");
  });

  it("SOLICITUD_TIPO_GASTO es 'gasto'", () => {
    expect(SOLICITUD_TIPO_GASTO).toBe("gasto");
  });

  it("SolicitudTipo acepta únicamente los dos literales declarados", () => {
    const tipos: readonly SolicitudTipo[] = [SOLICITUD_TIPO_VACACIONES, SOLICITUD_TIPO_GASTO];

    expect(tipos).toEqual(SOLICITUD_TIPOS);
  });
});

describe("SOLICITUD_ESTADO_PENDIENTE", () => {
  it("es el MISMO valor que CASO_ESTADO_PENDIENTE_APROBACION_HUMANA (importado, no redeclarado)", () => {
    expect(SOLICITUD_ESTADO_PENDIENTE).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
    expect(SOLICITUD_ESTADO_PENDIENTE).toBe("pendiente_aprobacion_humana");
  });

  it("solicitudes-contract.ts no vuelve a declarar el literal 'pendiente_aprobacion_humana'", () => {
    const sourcePath = fileURLToPath(new URL("./solicitudes-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/"pendiente_aprobacion_humana"/);
  });
});

describe("SOLICITUD_ESTADO_APROBADA y SOLICITUD_ESTADO_RECHAZADA", () => {
  it("son 'aprobada' y 'rechazada'", () => {
    expect(SOLICITUD_ESTADO_APROBADA).toBe("aprobada");
    expect(SOLICITUD_ESTADO_RECHAZADA).toBe("rechazada");
  });

  it("SolicitudEstado acepta los cuatro literales declarados", () => {
    const estados: readonly SolicitudEstado[] = [
      SOLICITUD_ESTADO_PENDIENTE,
      SOLICITUD_ESTADO_APROBADA,
      SOLICITUD_ESTADO_RECHAZADA,
      SOLICITUD_ESTADO_CANCELADA,
    ];

    expect(estados).toEqual([
      "pendiente_aprobacion_humana",
      "aprobada",
      "rechazada",
      "cancelada",
    ]);
  });
});

describe("SOLICITUD_ESTADO_CANCELADA", () => {
  it("es 'cancelada'", () => {
    expect(SOLICITUD_ESTADO_CANCELADA).toBe("cancelada");
  });
});

describe("LIMITE_LISTADO_SOLICITUDES", () => {
  it("es 20, espejo de LIMITE_LISTADO_ESCALACIONES", () => {
    expect(LIMITE_LISTADO_SOLICITUDES).toBe(20);
  });
});

describe("solicitudes-contract.ts source — imports núcleo → núcleo limitados", () => {
  it("importa únicamente de ../hitl/hitl-contract.js", () => {
    const sourcePath = fileURLToPath(new URL("./solicitudes-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));

    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from ["']\.\.\/hitl\/hitl-contract\.js["']/);
    }
  });

  it("no importa de src/adapters/*, del SDK ni de Node", () => {
    const sourcePath = fileURLToPath(new URL("./solicitudes-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/from ["']node:/);
    expect(source).not.toMatch(/from ["'].*adapters/);
    expect(source).not.toMatch(/from ["']@anthropic-ai/);
  });
});

describe("SolicitudInterna", () => {
  it("describe la forma completa de una solicitud interna", () => {
    const solicitud: SolicitudInterna = {
      id: "solicitud-1",
      casoId: "caso-1",
      solicitanteId: "empleado-1",
      tipo: SOLICITUD_TIPO_VACACIONES,
      detalle: "una semana en marzo",
      estado: SOLICITUD_ESTADO_PENDIENTE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(solicitud.tipo).toBe("vacaciones");
    expect(solicitud.dictamen).toBeUndefined();
    expect(solicitud.resueltaPor).toBeUndefined();
  });

  it("acepta dictamen y resolución opcionales", () => {
    const solicitud: SolicitudInterna = {
      id: "solicitud-1",
      casoId: "caso-1",
      solicitanteId: "empleado-1",
      tipo: SOLICITUD_TIPO_GASTO,
      detalle: "almuerzo con cliente",
      estado: SOLICITUD_ESTADO_APROBADA,
      dictamen: "cumple las reglas conocidas",
      dictaminadaAt: "2026-01-01T00:00:00.000Z",
      resueltaPor: "empleado-2",
      resueltaAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    expect(solicitud.dictamen).toBe("cumple las reglas conocidas");
    expect(solicitud.resueltaPor).toBe("empleado-2");
  });
});

describe("SolicitudStorePort", () => {
  function crearStoreFalso(): {
    readonly store: SolicitudStorePort;
    readonly solicitudes: SolicitudInterna[];
  } {
    const solicitudes: SolicitudInterna[] = [];

    const store: SolicitudStorePort = {
      crearSolicitudConCaso(input: CrearSolicitudConCasoInput): SolicitudInterna {
        const nueva: SolicitudInterna = {
          id: input.solicitud.id,
          casoId: input.caso.id,
          solicitanteId: input.solicitud.solicitanteId,
          tipo: input.solicitud.tipo,
          detalle: input.solicitud.detalle,
          estado: input.solicitud.estado,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
        };
        solicitudes.push(nueva);
        return nueva;
      },
      adjuntarDictamen(input) {
        const idx = solicitudes.findIndex((s) => s.id === input.solicitudId);
        if (idx === -1) return undefined;
        const actualizada: SolicitudInterna = {
          ...solicitudes[idx]!,
          dictamen: input.dictamen,
          dictaminadaAt: input.ahora,
        };
        solicitudes[idx] = actualizada;
        return actualizada;
      },
      listarSolicitudesPendientes(filtro) {
        let pendientes = solicitudes.filter((s) => s.estado === SOLICITUD_ESTADO_PENDIENTE);
        if (filtro?.solicitanteId !== undefined) {
          pendientes = pendientes.filter((s) => s.solicitanteId === filtro.solicitanteId);
        }
        if (filtro?.solicitudId !== undefined) {
          return pendientes.filter((s) => s.id === filtro.solicitudId);
        }
        return pendientes.slice(0, filtro?.limite ?? LIMITE_LISTADO_SOLICITUDES);
      },
      aprobarSolicitud(input: ResolucionSolicitudInput) {
        const idx = solicitudes.findIndex(
          (s) => s.id === input.solicitudId && s.estado === SOLICITUD_ESTADO_PENDIENTE,
        );
        if (idx === -1) return undefined;
        const actualizada: SolicitudInterna = {
          ...solicitudes[idx]!,
          estado: SOLICITUD_ESTADO_APROBADA,
          resueltaPor: input.empleadoId,
          resueltaAt: input.ahora,
        };
        solicitudes[idx] = actualizada;
        return actualizada;
      },
      rechazarSolicitud(input: ResolucionSolicitudInput) {
        const idx = solicitudes.findIndex(
          (s) => s.id === input.solicitudId && s.estado === SOLICITUD_ESTADO_PENDIENTE,
        );
        if (idx === -1) return undefined;
        const actualizada: SolicitudInterna = {
          ...solicitudes[idx]!,
          estado: SOLICITUD_ESTADO_RECHAZADA,
          resueltaPor: input.empleadoId,
          resueltaAt: input.ahora,
        };
        solicitudes[idx] = actualizada;
        return actualizada;
      },
      cancelarSolicitud(input: ResolucionSolicitudInput) {
        const idx = solicitudes.findIndex(
          (s) => s.id === input.solicitudId && s.estado === SOLICITUD_ESTADO_PENDIENTE,
        );
        if (idx === -1) return undefined;
        const actualizada: SolicitudInterna = {
          ...solicitudes[idx]!,
          estado: SOLICITUD_ESTADO_CANCELADA,
          resueltaPor: input.empleadoId,
          resueltaAt: input.ahora,
        };
        solicitudes[idx] = actualizada;
        return actualizada;
      },
    };

    return { store, solicitudes };
  }

  it("crearSolicitudConCaso crea la solicitud a partir de caso + solicitud + timestamp", () => {
    const { store } = crearStoreFalso();

    const creada = store.crearSolicitudConCaso({
      caso: { id: "caso-1", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
      solicitud: {
        id: "solicitud-1",
        solicitanteId: "empleado-1",
        tipo: SOLICITUD_TIPO_VACACIONES,
        detalle: "una semana en marzo",
        estado: SOLICITUD_ESTADO_PENDIENTE,
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(creada).toEqual({
      id: "solicitud-1",
      casoId: "caso-1",
      solicitanteId: "empleado-1",
      tipo: "vacaciones",
      detalle: "una semana en marzo",
      estado: "pendiente_aprobacion_humana",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("adjuntarDictamen escribe dictamen/dictaminadaAt sin tocar el estado", () => {
    const { store } = crearStoreFalso();
    store.crearSolicitudConCaso({
      caso: { id: "caso-1", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
      solicitud: {
        id: "solicitud-1",
        solicitanteId: "empleado-1",
        tipo: SOLICITUD_TIPO_GASTO,
        detalle: "almuerzo con cliente",
        estado: SOLICITUD_ESTADO_PENDIENTE,
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const actualizada = store.adjuntarDictamen({
      solicitudId: "solicitud-1",
      dictamen: "cumple las reglas conocidas",
      ahora: "2026-01-01T00:05:00.000Z",
    });

    expect(actualizada).toBeDefined();
    expect(actualizada?.dictamen).toBe("cumple las reglas conocidas");
    expect(actualizada?.estado).toBe(SOLICITUD_ESTADO_PENDIENTE);
  });

  it("aprobarSolicitud/rechazarSolicitud devuelven undefined si el CAS no matchea", () => {
    const { store } = crearStoreFalso();

    const resultado = store.aprobarSolicitud({
      solicitudId: "no-existe",
      casoId: "caso-1",
      empleadoId: "empleado-2",
      accionId: "accion-1",
      ahora: "2026-01-01T00:00:00.000Z",
    });

    expect(resultado).toBeUndefined();
  });

  it("listarSolicitudesPendientes filtra por estado pendiente y opcionalmente por id", () => {
    const { store } = crearStoreFalso();
    store.crearSolicitudConCaso({
      caso: { id: "caso-1", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
      solicitud: {
        id: "solicitud-1",
        solicitanteId: "empleado-1",
        tipo: SOLICITUD_TIPO_VACACIONES,
        detalle: "una semana en marzo",
        estado: SOLICITUD_ESTADO_PENDIENTE,
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const pendientes = store.listarSolicitudesPendientes();
    expect(pendientes).toHaveLength(1);

    const filtradas = store.listarSolicitudesPendientes({ solicitudId: "solicitud-1" });
    expect(filtradas).toHaveLength(1);

    const vacias = store.listarSolicitudesPendientes({ solicitudId: "no-existe" });
    expect(vacias).toHaveLength(0);
  });

  // ADR 144 pto 1 — el fake debe honrar `solicitanteId`, y el filtro combinado
  // ({ solicitudId, solicitanteId } a la vez) no debe romper nada.
  it("listarSolicitudesPendientes honra solicitanteId, solo o combinado con solicitudId", () => {
    const { store } = crearStoreFalso();
    store.crearSolicitudConCaso({
      caso: { id: "caso-1", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
      solicitud: {
        id: "solicitud-1",
        solicitanteId: "empleado-1",
        tipo: SOLICITUD_TIPO_VACACIONES,
        detalle: "una semana en marzo",
        estado: SOLICITUD_ESTADO_PENDIENTE,
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    store.crearSolicitudConCaso({
      caso: { id: "caso-2", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
      solicitud: {
        id: "solicitud-2",
        solicitanteId: "empleado-2",
        tipo: SOLICITUD_TIPO_GASTO,
        detalle: "viatico de marzo",
        estado: SOLICITUD_ESTADO_PENDIENTE,
      },
      timestamp: "2026-01-01T00:00:01.000Z",
    });

    const propias = store.listarSolicitudesPendientes({ solicitanteId: "empleado-1" });
    expect(propias.map((s) => s.id)).toEqual(["solicitud-1"]);

    const combinadoPropio = store.listarSolicitudesPendientes({
      solicitudId: "solicitud-1",
      solicitanteId: "empleado-1",
    });
    expect(combinadoPropio.map((s) => s.id)).toEqual(["solicitud-1"]);

    const combinadoAjeno = store.listarSolicitudesPendientes({
      solicitudId: "solicitud-1",
      solicitanteId: "empleado-2",
    });
    expect(combinadoAjeno).toHaveLength(0);
  });
});
