import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";
import {
  LIMITE_LISTADO_PROPUESTAS,
  LINEAS_PAGINA_PATCH,
  PATCH_MAX_BYTES,
  PROPUESTA_ESTADO_APLICADA,
  PROPUESTA_ESTADO_DESCARTADA,
  PROPUESTA_ESTADO_PENDIENTE,
  type CrearPropuestaInput,
  type PropuestaCambio,
  type PropuestaEstado,
  type PropuestaStorePort,
  type ResolucionPropuestaInput,
} from "./propuestas-contract.js";

describe("PATCH_MAX_BYTES", () => {
  it("es 65_536 (64 KB), tope de rechazo no de truncado", () => {
    expect(PATCH_MAX_BYTES).toBe(65_536);
  });
});

describe("PROPUESTA_ESTADO_PENDIENTE", () => {
  it("es el MISMO valor que CASO_ESTADO_PENDIENTE_APROBACION_HUMANA (importado, no redeclarado)", () => {
    expect(PROPUESTA_ESTADO_PENDIENTE).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
    expect(PROPUESTA_ESTADO_PENDIENTE).toBe("pendiente_aprobacion_humana");
  });

  it("propuestas-contract.ts no vuelve a declarar el literal 'pendiente_aprobacion_humana'", () => {
    const sourcePath = fileURLToPath(new URL("./propuestas-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/"pendiente_aprobacion_humana"/);
  });
});

describe("PROPUESTA_ESTADO_APLICADA y PROPUESTA_ESTADO_DESCARTADA", () => {
  it("son 'aplicada' y 'descartada'", () => {
    expect(PROPUESTA_ESTADO_APLICADA).toBe("aplicada");
    expect(PROPUESTA_ESTADO_DESCARTADA).toBe("descartada");
  });
});

describe("PropuestaEstado — máquina de TRES estados (RD-12)", () => {
  it("el conjunto de estados tiene exactamente tres elementos y ninguno es 'no_aplicable'", () => {
    const estados: readonly PropuestaEstado[] = [
      PROPUESTA_ESTADO_PENDIENTE,
      PROPUESTA_ESTADO_APLICADA,
      PROPUESTA_ESTADO_DESCARTADA,
    ];

    expect(estados).toHaveLength(3);
    expect(estados).toEqual(["pendiente_aprobacion_humana", "aplicada", "descartada"]);
    expect(estados).not.toContain("no_aplicable");
  });
});

describe("LIMITE_LISTADO_PROPUESTAS y LINEAS_PAGINA_PATCH", () => {
  it("LIMITE_LISTADO_PROPUESTAS es 20, espejo de LIMITE_LISTADO_ESCALACIONES", () => {
    expect(LIMITE_LISTADO_PROPUESTAS).toBe(20);
  });

  it("LINEAS_PAGINA_PATCH es 80", () => {
    expect(LINEAS_PAGINA_PATCH).toBe(80);
  });
});

describe("propuestas-contract.ts source — imports núcleo → núcleo limitados", () => {
  it("importa únicamente de ../hitl/hitl-contract.js", () => {
    const sourcePath = fileURLToPath(new URL("./propuestas-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));

    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from ["']\.\.\/hitl\/hitl-contract\.js["']/);
    }
  });

  it("no importa de src/adapters/*, del SDK ni de Node", () => {
    const sourcePath = fileURLToPath(new URL("./propuestas-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/from ["']node:/);
    expect(source).not.toMatch(/from ["'].*adapters/);
    expect(source).not.toMatch(/from ["']@anthropic-ai/);
  });
});

describe("PropuestaCambio", () => {
  it("describe la forma completa de una propuesta de cambio", () => {
    const propuesta: PropuestaCambio = {
      id: "propuesta-1",
      casoId: "caso-1",
      baseCommit: "abc123",
      ramaWorktree: "harness/developer/caso-1",
      patch: "diff --git a/a.ts b/a.ts\n+contenido\n",
      patchBytes: 42,
      archivos: 1,
      lineasAgregadas: 1,
      lineasEliminadas: 0,
      estado: PROPUESTA_ESTADO_PENDIENTE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(propuesta.estado).toBe("pendiente_aprobacion_humana");
    expect(propuesta.delegacionId).toBeUndefined();
    expect(propuesta.motivo).toBeUndefined();
    expect(propuesta.resueltaPor).toBeUndefined();
  });

  it("acepta delegacionId, motivo y resolución opcionales", () => {
    const propuesta: PropuestaCambio = {
      id: "propuesta-1",
      casoId: "caso-1",
      delegacionId: "delegacion-1",
      baseCommit: "abc123",
      ramaWorktree: "harness/developer/caso-1",
      patch: "diff --git a/a.ts b/a.ts\n-contenido\n",
      patchBytes: 42,
      archivos: 1,
      lineasAgregadas: 0,
      lineasEliminadas: 1,
      estado: PROPUESTA_ESTADO_DESCARTADA,
      motivo: "no aplica en este contexto",
      resueltaPor: "empleado-2",
      resueltaAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    expect(propuesta.delegacionId).toBe("delegacion-1");
    expect(propuesta.motivo).toBe("no aplica en este contexto");
    expect(propuesta.resueltaPor).toBe("empleado-2");
  });
});

describe("PropuestaStorePort", () => {
  function crearStoreFalso(): {
    readonly store: PropuestaStorePort;
    readonly propuestas: PropuestaCambio[];
  } {
    const propuestas: PropuestaCambio[] = [];

    const store: PropuestaStorePort = {
      crearPropuesta(input: CrearPropuestaInput): PropuestaCambio {
        const nueva: PropuestaCambio = {
          id: input.id,
          casoId: input.casoId,
          ...(input.delegacionId !== undefined ? { delegacionId: input.delegacionId } : {}),
          baseCommit: input.baseCommit,
          ramaWorktree: input.ramaWorktree,
          patch: input.patch,
          patchBytes: input.resumen.patchBytes,
          archivos: input.resumen.archivos,
          lineasAgregadas: input.resumen.lineasAgregadas,
          lineasEliminadas: input.resumen.lineasEliminadas,
          estado: PROPUESTA_ESTADO_PENDIENTE,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        };
        propuestas.push(nueva);
        return nueva;
      },
      obtenerPropuesta(propuestaId: string) {
        return propuestas.find((p) => p.id === propuestaId);
      },
      listarPropuestasPendientes(filtro) {
        const pendientes = propuestas.filter((p) => p.estado === PROPUESTA_ESTADO_PENDIENTE);
        if (filtro?.propuestaId !== undefined) {
          return pendientes.filter((p) => p.id === filtro.propuestaId);
        }
        return pendientes.slice(0, filtro?.limite ?? LIMITE_LISTADO_PROPUESTAS);
      },
      aplicarPropuesta(input: ResolucionPropuestaInput) {
        const idx = propuestas.findIndex(
          (p) => p.id === input.propuestaId && p.estado === PROPUESTA_ESTADO_PENDIENTE,
        );
        if (idx === -1) return undefined;
        const actualizada: PropuestaCambio = {
          ...propuestas[idx]!,
          estado: PROPUESTA_ESTADO_APLICADA,
          resueltaPor: input.empleadoId,
          resueltaAt: input.ahora,
        };
        propuestas[idx] = actualizada;
        return actualizada;
      },
      descartarPropuesta(input: ResolucionPropuestaInput) {
        const idx = propuestas.findIndex(
          (p) => p.id === input.propuestaId && p.estado === PROPUESTA_ESTADO_PENDIENTE,
        );
        if (idx === -1) return undefined;
        const actualizada: PropuestaCambio = {
          ...propuestas[idx]!,
          estado: PROPUESTA_ESTADO_DESCARTADA,
          ...(input.motivo !== undefined ? { motivo: input.motivo } : {}),
          resueltaPor: input.empleadoId,
          resueltaAt: input.ahora,
        };
        propuestas[idx] = actualizada;
        return actualizada;
      },
    };

    return { store, propuestas };
  }

  it("crearPropuesta crea la propuesta a partir de input + resumen", () => {
    const { store } = crearStoreFalso();

    const creada = store.crearPropuesta({
      id: "propuesta-1",
      casoId: "caso-1",
      baseCommit: "abc123",
      ramaWorktree: "harness/developer/caso-1",
      patch: "diff --git a/a.ts b/a.ts\n+contenido\n",
      resumen: { patchBytes: 42, archivos: 1, lineasAgregadas: 1, lineasEliminadas: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(creada).toEqual({
      id: "propuesta-1",
      casoId: "caso-1",
      delegacionId: undefined,
      baseCommit: "abc123",
      ramaWorktree: "harness/developer/caso-1",
      patch: "diff --git a/a.ts b/a.ts\n+contenido\n",
      patchBytes: 42,
      archivos: 1,
      lineasAgregadas: 1,
      lineasEliminadas: 0,
      estado: "pendiente_aprobacion_humana",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("obtenerPropuesta devuelve undefined para id inexistente", () => {
    const { store } = crearStoreFalso();

    expect(store.obtenerPropuesta("no-existe")).toBeUndefined();
  });

  it("aplicarPropuesta/descartarPropuesta devuelven undefined si el CAS no matchea", () => {
    const { store } = crearStoreFalso();

    const resultado = store.aplicarPropuesta({
      propuestaId: "no-existe",
      casoId: "caso-1",
      empleadoId: "empleado-2",
      accionId: "accion-1",
      ahora: "2026-01-01T00:00:00.000Z",
    });

    expect(resultado).toBeUndefined();
  });

  it("listarPropuestasPendientes filtra por estado pendiente y opcionalmente por id", () => {
    const { store } = crearStoreFalso();
    store.crearPropuesta({
      id: "propuesta-1",
      casoId: "caso-1",
      baseCommit: "abc123",
      ramaWorktree: "harness/developer/caso-1",
      patch: "diff --git a/a.ts b/a.ts\n+contenido\n",
      resumen: { patchBytes: 42, archivos: 1, lineasAgregadas: 1, lineasEliminadas: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const pendientes = store.listarPropuestasPendientes();
    expect(pendientes).toHaveLength(1);

    const filtradas = store.listarPropuestasPendientes({ propuestaId: "propuesta-1" });
    expect(filtradas).toHaveLength(1);

    const vacias = store.listarPropuestasPendientes({ propuestaId: "no-existe" });
    expect(vacias).toHaveLength(0);
  });
});
