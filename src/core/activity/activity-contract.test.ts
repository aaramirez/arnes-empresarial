import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVIDAD_ESTADOS,
  ACTIVIDAD_TIPO_INCIDENTE,
  ACTIVIDAD_TIPO_PR_REVIEW,
  ACTIVIDAD_TIPO_SOLICITUD_INTERNA,
  ACTIVIDAD_TIPOS,
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  ESTADO_RESUELTO,
  VEREDICTO_APROBADO,
  VEREDICTO_OBSERVADO,
  VEREDICTO_PREFIX,
  VEREDICTO_RESUELTO,
  VEREDICTOS,
  type Actividad,
  type ActividadEstado,
  type ActividadTipo,
  type ActivityBoardPort,
  type ActivityStorePort,
  type CreateCasoConActividadInput,
  type IncomingActivityEvent,
  type PullRequestMetadata,
  type Veredicto,
} from "./activity-contract.js";

describe("ACTIVIDAD_ESTADOS", () => {
  it("tiene exactamente los 4 estados canónicos, en el orden que fija design.md", () => {
    expect(ACTIVIDAD_ESTADOS).toEqual([
      ESTADO_PENDIENTE_REVISION,
      ESTADO_OBSERVADO,
      ESTADO_RESUELTO,
      ESTADO_APROBADO,
    ]);
    expect(ACTIVIDAD_ESTADOS).toEqual([
      "pendiente_revision",
      "observado",
      "resuelto",
      "aprobado",
    ]);
  });
});

describe("ACTIVIDAD_TIPOS", () => {
  it("tiene exactamente los 3 tipos canónicos, en el orden que fija design.md", () => {
    expect(ACTIVIDAD_TIPOS).toEqual([
      ACTIVIDAD_TIPO_PR_REVIEW,
      ACTIVIDAD_TIPO_SOLICITUD_INTERNA,
      ACTIVIDAD_TIPO_INCIDENTE,
    ]);
    expect(ACTIVIDAD_TIPOS).toEqual(["pr_review", "solicitud_interna", "incidente"]);
  });
});

describe("VEREDICTOS", () => {
  it("tiene exactamente los 3 veredictos posibles, sin 'pendiente_revision'", () => {
    expect(VEREDICTOS).toEqual([VEREDICTO_APROBADO, VEREDICTO_OBSERVADO, VEREDICTO_RESUELTO]);
    expect(VEREDICTOS).toEqual(["aprobado", "observado", "resuelto"]);
    expect(VEREDICTOS).not.toContain("pendiente_revision");
  });
});

describe("VEREDICTO_PREFIX", () => {
  it("es exactamente 'VEREDICTO:'", () => {
    expect(VEREDICTO_PREFIX).toBe("VEREDICTO:");
  });
});

describe("IncomingActivityEvent", () => {
  it("es satisfecho por un objeto con la forma exacta del contrato", () => {
    const evento: IncomingActivityEvent = {
      origen: "github",
      proyectoId: "owner/repo",
      proyectoNombre: "repo",
      repoUrl: "https://github.com/owner/repo",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      titulo: "Título del PR",
      cuerpo: "Cuerpo del PR",
      archivosCambiados: ["a.ts", "b.ts"],
      deliveryId: "delivery-1",
      recibidoEn: "2026-09-01T00:00:00.000Z",
    };

    expect(evento.tipo).toBe("pr_review");
    expect(evento.responsableId).toBeUndefined();
  });

  it("acepta responsableId y comentarioDisparador opcionales", () => {
    const evento: IncomingActivityEvent = {
      origen: "github",
      proyectoId: "owner/repo",
      proyectoNombre: "repo",
      repoUrl: "https://github.com/owner/repo",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      responsableId: "octocat",
      titulo: "Título del PR",
      cuerpo: "Cuerpo del PR",
      archivosCambiados: [],
      comentarioDisparador: "listo",
      deliveryId: "delivery-1",
      recibidoEn: "2026-09-01T00:00:00.000Z",
    };

    expect(evento.responsableId).toBe("octocat");
    expect(evento.comentarioDisparador).toBe("listo");
  });
});

describe("Actividad", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato", () => {
    const actividad: Actividad = {
      id: "act-1",
      proyectoId: "owner/repo",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      casoId: "caso-1",
      estado: ESTADO_PENDIENTE_REVISION,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    expect(actividad.estado).toBe("pendiente_revision");
    expect(actividad.responsableId).toBeUndefined();
  });
});

describe("PullRequestMetadata", () => {
  it("es satisfecha por un objeto con la forma exacta del contrato, sin diff", () => {
    const metadatos: PullRequestMetadata = {
      titulo: "Título",
      cuerpo: "Cuerpo",
      autor: "octocat",
      archivosCambiados: ["a.ts"],
      archivosTruncados: false,
    };

    expect(metadatos.archivosTruncados).toBe(false);
    expect(metadatos).not.toHaveProperty("diff");
  });
});

describe("CreateCasoConActividadInput", () => {
  it("es satisfecho por un objeto con la forma exacta del contrato", () => {
    const input: CreateCasoConActividadInput = {
      proyecto: { id: "owner/repo", nombre: "repo", repoUrl: "https://github.com/owner/repo" },
      caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
      actividad: {
        id: "act-1",
        tipo: ACTIVIDAD_TIPO_PR_REVIEW,
        referenciaExterna: "42",
        estado: ESTADO_PENDIENTE_REVISION,
      },
      timestamp: "2026-09-01T00:00:00.000Z",
    };

    expect(input.responsable).toBeUndefined();
  });
});

describe("ActivityStorePort", () => {
  it("es satisfecho por un objeto que implementa los 3 métodos con las firmas del contrato", () => {
    const actividad: Actividad = {
      id: "act-1",
      proyectoId: "owner/repo",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      casoId: "caso-1",
      estado: ESTADO_PENDIENTE_REVISION,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    const store: ActivityStorePort = {
      findActividadPorReferencia(input) {
        expect(input.proyectoId).toBe("owner/repo");
        expect(input.referenciaExterna).toBe("42");
        return undefined;
      },
      createCasoConActividad(_input) {
        return actividad;
      },
      updateActividadEstado(input) {
        expect(input.actividadId).toBe("act-1");
        return { ...actividad, estado: input.estado, updatedAt: input.updatedAt };
      },
    };

    expect(
      store.findActividadPorReferencia({ proyectoId: "owner/repo", referenciaExterna: "42" }),
    ).toBeUndefined();

    expect(
      store.createCasoConActividad({
        proyecto: { id: "owner/repo", nombre: "repo", repoUrl: "https://x" },
        caso: { id: "caso-1", tipo: "pr_review", estado: "activo" },
        actividad: {
          id: "act-1",
          tipo: ACTIVIDAD_TIPO_PR_REVIEW,
          referenciaExterna: "42",
          estado: ESTADO_PENDIENTE_REVISION,
        },
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual(actividad);

    expect(
      store.updateActividadEstado({
        actividadId: "act-1",
        estado: ESTADO_APROBADO,
        updatedAt: "2026-09-01T01:00:00.000Z",
      }).estado,
    ).toBe("aprobado");
  });
});

describe("ActivityBoardPort", () => {
  it("es satisfecho por un objeto que implementa los 3 métodos async con las firmas del contrato", async () => {
    const board: ActivityBoardPort = {
      async leerMetadatos(input) {
        expect(input.proyectoId).toBe("owner/repo");
        expect(input.referenciaExterna).toBe("42");
        expect(input.casoId).toBe("caso-1");
        return undefined;
      },
      async publicarRevision(input) {
        expect(input.texto).toBe("hola");
      },
      async mirrorEstado(input) {
        expect(input.estado).toBe("aprobado");
      },
    };

    await expect(
      board.leerMetadatos({ proyectoId: "owner/repo", referenciaExterna: "42", casoId: "caso-1" }),
    ).resolves.toBeUndefined();

    await expect(
      board.publicarRevision({
        proyectoId: "owner/repo",
        referenciaExterna: "42",
        texto: "hola",
        casoId: "caso-1",
      }),
    ).resolves.toBeUndefined();

    await expect(
      board.mirrorEstado({
        proyectoId: "owner/repo",
        referenciaExterna: "42",
        estado: ESTADO_APROBADO,
        casoId: "caso-1",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("tipos exportados", () => {
  it("ActividadTipo, ActividadEstado y Veredicto son los tipos unión esperados", () => {
    const tipo: ActividadTipo = "pr_review";
    const estado: ActividadEstado = "observado";
    const veredicto: Veredicto = "resuelto";

    expect(ACTIVIDAD_TIPOS).toContain(tipo);
    expect(ACTIVIDAD_ESTADOS).toContain(estado);
    expect(VEREDICTOS).toContain(veredicto);
  });
});

describe("activity-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./activity-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
