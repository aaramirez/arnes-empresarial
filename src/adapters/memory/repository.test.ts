import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "./db.js";
import {
  ActividadAlreadyExistsError,
  ActividadInvalidReferenceError,
  ActividadNotFoundError,
  CasoAlreadyExistsError,
  CasoNotFoundError,
  SesionAgenteAlreadyExistsError,
  SesionAgenteInvalidCasoError,
  createActividad,
  createCaso,
  createCasoConActividad,
  createSesionAgente,
  findActividadPorReferencia,
  getActividadById,
  getCasoById,
  getLatestSesionAgente,
  getProyectoById,
  updateActividad,
  updateCaso,
  upsertProyecto,
  upsertResponsable,
  type CreateActividadInput,
  type CreateCasoConActividadInput,
  type CreateCasoInput,
  type CreateSesionAgenteInput,
} from "./repository.js";

/** Test factories — a single place to change the base fixture if the shape evolves. */
function buildCaso(overrides: Partial<CreateCasoInput> = {}): CreateCasoInput {
  return {
    id: "caso-1",
    tipo: "conversacion",
    estado: "abierto",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function buildSesionAgente(overrides: Partial<CreateSesionAgenteInput> = {}): CreateSesionAgenteInput {
  return {
    id: "sesion-1",
    casoId: "caso-1",
    agentId: "agente-conversacional",
    sdkSessionId: "sdk-session-abc",
    createdAt: "2026-08-26T00:00:01.000Z",
    ...overrides,
  };
}

function buildProyectoInput(
  overrides: Partial<{ id: string; nombre: string; repoUrl: string; createdAt: string }> = {},
) {
  return {
    id: "owner/repo",
    nombre: "Repo",
    repoUrl: "https://github.com/owner/repo",
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function buildResponsableInput(
  overrides: Partial<{ id: string; nombre?: string; createdAt: string }> = {},
) {
  return {
    id: "octocat",
    nombre: "Octo Cat",
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function buildActividadInput(overrides: Partial<CreateActividadInput> = {}): CreateActividadInput {
  return {
    id: "actividad-1",
    proyectoId: "owner/repo",
    tipo: "pr_review",
    referenciaExterna: "https://github.com/owner/repo/pull/1",
    casoId: "caso-1",
    estado: "abierto",
    createdAt: "2026-08-26T00:00:02.000Z",
    updatedAt: "2026-08-26T00:00:02.000Z",
    ...overrides,
  };
}

function buildCasoConActividadInput(
  overrides: Partial<CreateCasoConActividadInput> = {},
): CreateCasoConActividadInput {
  return {
    proyecto: buildProyectoInput(),
    caso: buildCaso(),
    actividad: {
      id: "actividad-1",
      tipo: "pr_review",
      referenciaExterna: "https://github.com/owner/repo/pull/1",
      estado: "abierto",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z",
    },
    timestamp: "2026-08-26T00:00:02.000Z",
    ...overrides,
  };
}

describe("repository", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  describe("casos", () => {
    it("creates a caso and returns it as stored", () => {
      db = openDatabase(":memory:");

      const caso = createCaso(db, buildCaso());

      expect(caso).toEqual({
        id: "caso-1",
        tipo: "conversacion",
        estado: "abierto",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      });
    });

    it("throws CasoAlreadyExistsError when creating a caso with a duplicate id", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() => createCaso(db!, buildCaso())).toThrow(CasoAlreadyExistsError);
    });

    it("returns undefined from getCasoById when the caso does not exist", () => {
      db = openDatabase(":memory:");

      expect(getCasoById(db, "no-existe")).toBeUndefined();
    });

    it("returns the caso previously created via getCasoById", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      const caso = getCasoById(db, "caso-1");

      expect(caso?.estado).toBe("abierto");
    });

    it("updates estado and updatedAt, leaving other fields untouched", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      const updated = updateCaso(db, "caso-1", {
        estado: "cerrado",
        updatedAt: "2026-08-26T01:00:00.000Z",
      });

      expect(updated).toEqual({
        id: "caso-1",
        tipo: "conversacion",
        estado: "cerrado",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T01:00:00.000Z",
      });
    });

    it("throws CasoNotFoundError when updating a caso that does not exist", () => {
      db = openDatabase(":memory:");

      expect(() =>
        updateCaso(db!, "no-existe", { updatedAt: "2026-08-26T01:00:00.000Z" }),
      ).toThrow(CasoNotFoundError);
    });
  });

  describe("sesiones_agente", () => {
    it("creates a sesion_agente correlating caso_id, agent_id and sdk_session_id", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      const sesion = createSesionAgente(db, buildSesionAgente());

      expect(sesion).toEqual({
        id: "sesion-1",
        casoId: "caso-1",
        agentId: "agente-conversacional",
        sdkSessionId: "sdk-session-abc",
        createdAt: "2026-08-26T00:00:01.000Z",
      });
    });

    it("throws SesionAgenteAlreadyExistsError when creating a sesion_agente with a duplicate id", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      createSesionAgente(db, buildSesionAgente());

      expect(() => createSesionAgente(db!, buildSesionAgente())).toThrow(
        SesionAgenteAlreadyExistsError,
      );
    });

    it("throws SesionAgenteInvalidCasoError when caso_id does not reference an existing caso", () => {
      db = openDatabase(":memory:");

      expect(() =>
        createSesionAgente(db!, buildSesionAgente({ casoId: "no-existe" })),
      ).toThrow(SesionAgenteInvalidCasoError);
    });

    it("returns undefined from getLatestSesionAgente when no session exists for that caso+agent", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(getLatestSesionAgente(db, "caso-1", "agente-conversacional")).toBeUndefined();
    });

    it("resolves the most recent session by created_at as the current one", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      createSesionAgente(
        db,
        buildSesionAgente({
          id: "sesion-1",
          sdkSessionId: "sdk-session-old",
          createdAt: "2026-08-26T00:00:01.000Z",
        }),
      );
      createSesionAgente(
        db,
        buildSesionAgente({
          id: "sesion-2",
          sdkSessionId: "sdk-session-new",
          createdAt: "2026-08-26T00:00:02.000Z",
        }),
      );

      const latest = getLatestSesionAgente(db, "caso-1", "agente-conversacional");

      expect(latest?.sdkSessionId).toBe("sdk-session-new");
    });

    it("breaks a created_at tie by preferring the most recently inserted row", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      createSesionAgente(
        db,
        buildSesionAgente({
          id: "sesion-1",
          sdkSessionId: "sdk-session-first",
          createdAt: "2026-08-26T00:00:01.000Z",
        }),
      );
      createSesionAgente(
        db,
        buildSesionAgente({
          id: "sesion-2",
          sdkSessionId: "sdk-session-second",
          createdAt: "2026-08-26T00:00:01.000Z",
        }),
      );

      const latest = getLatestSesionAgente(db, "caso-1", "agente-conversacional");

      expect(latest?.sdkSessionId).toBe("sdk-session-second");
    });

    it("does not mix sessions from a different agent on the same caso", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      createSesionAgente(
        db,
        buildSesionAgente({
          id: "sesion-1",
          agentId: "otro-agente",
          sdkSessionId: "sdk-session-otro",
          createdAt: "2026-08-26T00:00:05.000Z",
        }),
      );

      expect(getLatestSesionAgente(db, "caso-1", "agente-conversacional")).toBeUndefined();
    });
  });

  describe("proyectos", () => {
    it("inserts a proyecto and returns it as stored", () => {
      db = openDatabase(":memory:");

      const proyecto = upsertProyecto(db, buildProyectoInput());

      expect(proyecto).toEqual({
        id: "owner/repo",
        nombre: "Repo",
        repoUrl: "https://github.com/owner/repo",
        createdAt: "2026-08-26T00:00:00.000Z",
      });
    });

    it("is idempotent: upserting the same id updates nombre and repoUrl instead of failing", () => {
      db = openDatabase(":memory:");
      upsertProyecto(db, buildProyectoInput());

      const updated = upsertProyecto(
        db,
        buildProyectoInput({ nombre: "Repo Renombrado", repoUrl: "https://github.com/owner/repo-renamed" }),
      );

      expect(updated).toEqual({
        id: "owner/repo",
        nombre: "Repo Renombrado",
        repoUrl: "https://github.com/owner/repo-renamed",
        createdAt: "2026-08-26T00:00:00.000Z",
      });
      expect(getProyectoById(db, "owner/repo")?.nombre).toBe("Repo Renombrado");
    });

    it("returns undefined from getProyectoById when the proyecto does not exist", () => {
      db = openDatabase(":memory:");

      expect(getProyectoById(db, "no-existe")).toBeUndefined();
    });
  });

  describe("responsables", () => {
    it("inserts a responsable and returns it as stored", () => {
      db = openDatabase(":memory:");

      const responsable = upsertResponsable(db, buildResponsableInput());

      expect(responsable).toEqual({
        id: "octocat",
        nombre: "Octo Cat",
        createdAt: "2026-08-26T00:00:00.000Z",
      });
    });

    it("is idempotent and preserves nombre via COALESCE when the upsert omits it", () => {
      db = openDatabase(":memory:");
      upsertResponsable(db, buildResponsableInput({ nombre: "Ana" }));

      const upserted = upsertResponsable(db, { id: "octocat", createdAt: "2026-08-26T00:00:05.000Z" });

      expect(upserted.nombre).toBe("Ana");
    });

    it("overwrites nombre when the upsert provides a new one", () => {
      db = openDatabase(":memory:");
      upsertResponsable(db, buildResponsableInput({ nombre: "Ana" }));

      const upserted = upsertResponsable(db, buildResponsableInput({ nombre: "Beto" }));

      expect(upserted.nombre).toBe("Beto");
    });
  });

  describe("actividades", () => {
    function seedProyectoYCaso(database: Database.Database) {
      upsertProyecto(database, buildProyectoInput());
      createCaso(database, buildCaso());
    }

    it("creates an actividad and returns it as stored", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);

      const actividad = createActividad(db, buildActividadInput());

      expect(actividad).toEqual({
        id: "actividad-1",
        proyectoId: "owner/repo",
        tipo: "pr_review",
        referenciaExterna: "https://github.com/owner/repo/pull/1",
        casoId: "caso-1",
        estado: "abierto",
        createdAt: "2026-08-26T00:00:02.000Z",
        updatedAt: "2026-08-26T00:00:02.000Z",
      });
    });

    it("returns undefined from getActividadById when the actividad does not exist", () => {
      db = openDatabase(":memory:");

      expect(getActividadById(db, "no-existe")).toBeUndefined();
    });

    it("returns the actividad previously created via getActividadById", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      createActividad(db, buildActividadInput());

      expect(getActividadById(db, "actividad-1")?.estado).toBe("abierto");
    });

    it("throws ActividadAlreadyExistsError when creating an actividad with a duplicate id", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      createActividad(db, buildActividadInput());

      expect(() => createActividad(db!, buildActividadInput())).toThrow(ActividadAlreadyExistsError);
    });

    it("throws ActividadInvalidReferenceError when proyectoId does not reference an existing proyecto", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() =>
        createActividad(db!, buildActividadInput({ proyectoId: "no-existe" })),
      ).toThrow(ActividadInvalidReferenceError);
    });

    it("throws ActividadInvalidReferenceError when casoId does not reference an existing caso", () => {
      db = openDatabase(":memory:");
      upsertProyecto(db, buildProyectoInput());

      expect(() =>
        createActividad(db!, buildActividadInput({ casoId: "no-existe" })),
      ).toThrow(ActividadInvalidReferenceError);
    });

    it("throws ActividadInvalidReferenceError when responsableId does not reference an existing responsable", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);

      expect(() =>
        createActividad(db!, buildActividadInput({ responsableId: "no-existe" })),
      ).toThrow(ActividadInvalidReferenceError);
    });

    it("finds the most recent actividad by created_at for a proyectoId + referenciaExterna pair", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      createActividad(
        db,
        buildActividadInput({ id: "actividad-1", createdAt: "2026-08-26T00:00:02.000Z" }),
      );
      createActividad(
        db,
        buildActividadInput({
          id: "actividad-2",
          createdAt: "2026-08-26T00:00:03.000Z",
          updatedAt: "2026-08-26T00:00:03.000Z",
        }),
      );

      const found = findActividadPorReferencia(db, "owner/repo", "https://github.com/owner/repo/pull/1");

      expect(found?.id).toBe("actividad-2");
    });

    it("breaks a created_at tie by preferring the most recently inserted actividad (rowid)", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      createActividad(
        db,
        buildActividadInput({ id: "actividad-1", createdAt: "2026-08-26T00:00:02.000Z" }),
      );
      createActividad(
        db,
        buildActividadInput({ id: "actividad-2", createdAt: "2026-08-26T00:00:02.000Z" }),
      );

      const found = findActividadPorReferencia(db, "owner/repo", "https://github.com/owner/repo/pull/1");

      expect(found?.id).toBe("actividad-2");
    });

    it("returns undefined from findActividadPorReferencia when no actividad matches", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);

      expect(findActividadPorReferencia(db, "owner/repo", "no-existe")).toBeUndefined();
    });

    it("updates estado, leaving responsableId untouched", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      upsertResponsable(db, buildResponsableInput());
      createActividad(db, buildActividadInput({ responsableId: "octocat" }));

      const updated = updateActividad(db, "actividad-1", {
        estado: "cerrado",
        updatedAt: "2026-08-26T01:00:00.000Z",
      });

      expect(updated).toEqual({
        id: "actividad-1",
        proyectoId: "owner/repo",
        tipo: "pr_review",
        referenciaExterna: "https://github.com/owner/repo/pull/1",
        responsableId: "octocat",
        casoId: "caso-1",
        estado: "cerrado",
        createdAt: "2026-08-26T00:00:02.000Z",
        updatedAt: "2026-08-26T01:00:00.000Z",
      });
    });

    it("desasigna responsableId when the update passes responsableId: null explicitly", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      upsertResponsable(db, buildResponsableInput());
      createActividad(db, buildActividadInput({ responsableId: "octocat" }));

      const updated = updateActividad(db, "actividad-1", {
        responsableId: null,
        updatedAt: "2026-08-26T01:00:00.000Z",
      });

      expect(updated.responsableId).toBeUndefined();
    });

    it("reassigns responsableId to a new value when the update provides one", () => {
      db = openDatabase(":memory:");
      seedProyectoYCaso(db);
      upsertResponsable(db, buildResponsableInput());
      upsertResponsable(db, buildResponsableInput({ id: "hubot", nombre: "Hubot" }));
      createActividad(db, buildActividadInput({ responsableId: "octocat" }));

      const updated = updateActividad(db, "actividad-1", {
        responsableId: "hubot",
        updatedAt: "2026-08-26T01:00:00.000Z",
      });

      expect(updated.responsableId).toBe("hubot");
      expect(getActividadById(db, "actividad-1")?.responsableId).toBe("hubot");
    });

    it("throws ActividadNotFoundError when updating an actividad that does not exist", () => {
      db = openDatabase(":memory:");

      expect(() =>
        updateActividad(db!, "no-existe", { updatedAt: "2026-08-26T01:00:00.000Z" }),
      ).toThrow(ActividadNotFoundError);
    });
  });

  describe("createCasoConActividad", () => {
    it("creates proyecto, caso and actividad in one transaction", () => {
      db = openDatabase(":memory:");

      const result = createCasoConActividad(db, buildCasoConActividadInput());

      expect(result.caso.id).toBe("caso-1");
      expect(result.actividad.id).toBe("actividad-1");
      expect(result.actividad.proyectoId).toBe("owner/repo");
      expect(result.actividad.casoId).toBe("caso-1");
      expect(getProyectoById(db, "owner/repo")).not.toBeUndefined();
      expect(getCasoById(db, "caso-1")).not.toBeUndefined();
      expect(getActividadById(db, "actividad-1")).not.toBeUndefined();
    });

    it("also upserts the responsable when given", () => {
      db = openDatabase(":memory:");

      const result = createCasoConActividad(
        db,
        buildCasoConActividadInput({ responsable: { id: "octocat", nombre: "Octo Cat" } }),
      );

      expect(result.actividad.responsableId).toBe("octocat");
    });

    it("is atomic: when createActividad fails inside the transaction, no orphan proyecto or caso is left behind", () => {
      db = openDatabase(":memory:");
      // Prime an existing actividad id by succeeding once.
      createCasoConActividad(db, buildCasoConActividadInput());

      expect(() =>
        createCasoConActividad(
          db!,
          buildCasoConActividadInput({
            proyecto: buildProyectoInput({ id: "owner/repo-2", repoUrl: "https://github.com/owner/repo-2" }),
            caso: buildCaso({ id: "caso-2" }),
            // Same actividad id as the first call above -> PK violation inside the tx.
            actividad: {
              id: "actividad-1",
              tipo: "pr_review",
              referenciaExterna: "https://github.com/owner/repo-2/pull/1",
              estado: "abierto",
              createdAt: "2026-08-26T00:00:03.000Z",
              updatedAt: "2026-08-26T00:00:03.000Z",
            },
          }),
        ),
      ).toThrow(ActividadAlreadyExistsError);

      expect(getProyectoById(db, "owner/repo-2")).toBeUndefined();
      expect(getCasoById(db, "caso-2")).toBeUndefined();
      // The first, successful call's rows are untouched by the rollback.
      expect(getProyectoById(db, "owner/repo")).not.toBeUndefined();
      expect(getCasoById(db, "caso-1")).not.toBeUndefined();
    });
  });
});
