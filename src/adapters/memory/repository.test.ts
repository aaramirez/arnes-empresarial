import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "./db.js";
import { runMigrations } from "./migrate.js";
import {
  ActividadAlreadyExistsError,
  ActividadInvalidReferenceError,
  ActividadNotFoundError,
  CasoAlreadyExistsError,
  CasoNotFoundError,
  CredencialEmpleadoDuplicadaError,
  SesionAgenteAlreadyExistsError,
  SesionAgenteInvalidCasoError,
  VentaAlreadyExistsError,
  VentaTokenDuplicadoError,
  aprobarEscalacionReembolso,
  aprobarReembolso,
  buscarCredencialEmpleado,
  confirmarVentaConComision,
  createActividad,
  createCaso,
  createCasoConActividad,
  createSesionAgente,
  createVentaConCaso,
  escalarReembolso,
  findActividadPorReferencia,
  findVentaByToken,
  getActividadById,
  getCasoById,
  getLatestSesionAgente,
  getProyectoById,
  getVentaById,
  insertAccionEmpleado,
  insertCredencialEmpleado,
  listAccionesEmpleadoPorVenta,
  listComisionesPorPeriodo,
  listEscalacionesReembolso,
  listVentasEnReembolsoPendiente,
  reabrirEscalacionReembolso,
  rechazarEscalacionReembolso,
  rechazarVenta,
  updateActividad,
  updateCaso,
  updateCredencialEmpleado,
  upsertProyecto,
  upsertResponsable,
  upsertVendedor,
  type CreateActividadInput,
  type CreateCasoConActividadInput,
  type CreateCasoInput,
  type CreateSesionAgenteInput,
  type CreateVentaConCasoInput,
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

function buildVendedorInput(
  overrides: Partial<{ id: string; nombre: string; createdAt: string }> = {},
) {
  return {
    id: "vendedor-1",
    nombre: "Ana Vendedora",
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function buildVentaConCasoInput(
  overrides: Partial<CreateVentaConCasoInput> = {},
): CreateVentaConCasoInput {
  return {
    vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
    caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
    venta: {
      id: "venta-1",
      clienteId: "cliente-1",
      planNuevo: "premium",
      monto: 100,
      estado: "pendiente_confirmacion",
      tokenConfirmacion: "token-1",
    },
    timestamp: "2026-08-26T00:00:03.000Z",
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

  describe("vendedores", () => {
    it("inserts a vendedor and returns it as stored", () => {
      db = openDatabase(":memory:");

      const vendedor = upsertVendedor(db, buildVendedorInput());

      expect(vendedor).toEqual({
        id: "vendedor-1",
        nombre: "Ana Vendedora",
        createdAt: "2026-08-26T00:00:00.000Z",
      });
    });

    it("is idempotent: upserting the same id updates nombre instead of failing", () => {
      db = openDatabase(":memory:");
      upsertVendedor(db, buildVendedorInput());

      const updated = upsertVendedor(db, buildVendedorInput({ nombre: "Ana Renombrada" }));

      expect(updated).toEqual({
        id: "vendedor-1",
        nombre: "Ana Renombrada",
        createdAt: "2026-08-26T00:00:00.000Z",
      });
    });
  });

  describe("createVentaConCaso", () => {
    it("creates vendedor, caso and venta in one transaction", () => {
      db = openDatabase(":memory:");

      const venta = createVentaConCaso(db, buildVentaConCasoInput());

      expect(venta.id).toBe("venta-1");
      expect(venta.vendedorId).toBe("vendedor-1");
      expect(venta.casoId).toBe("caso-1");
      expect(venta.clienteId).toBe("cliente-1");
      expect(venta.planNuevo).toBe("premium");
      expect(venta.monto).toBe(100);
      expect(venta.estado).toBe("pendiente_confirmacion");
      expect(venta.tokenConfirmacion).toBe("token-1");
      expect(getCasoById(db, "caso-1")).not.toBeUndefined();
    });

    it("binds planAnterior and expiresAt as explicit null when the input omits them", () => {
      db = openDatabase(":memory:");

      createVentaConCaso(db, buildVentaConCasoInput());

      const venta = getVentaById(db, "venta-1");
      expect(venta).not.toBeUndefined();
      expect(venta).not.toHaveProperty("planAnterior");
      expect(venta).not.toHaveProperty("expiresAt");
    });

    it("keeps planAnterior and expiresAt when the input provides them", () => {
      db = openDatabase(":memory:");

      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planAnterior: "basico",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
            expiresAt: "2026-08-27T00:00:00.000Z",
          },
        }),
      );

      const venta = getVentaById(db, "venta-1");
      expect(venta?.planAnterior).toBe("basico");
      expect(venta?.expiresAt).toBe("2026-08-27T00:00:00.000Z");
    });

    it("is atomic: when the INSERT of ventas fails, no orphan vendedor or caso is left behind", () => {
      db = openDatabase(":memory:");
      // Prime an existing venta id by succeeding once.
      createVentaConCaso(db, buildVentaConCasoInput());

      expect(() =>
        createVentaConCaso(
          db!,
          buildVentaConCasoInput({
            vendedor: { id: "vendedor-2", nombre: "Beto Vendedor" },
            caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
            // Same venta id as the first call above -> PK violation inside the tx.
            venta: {
              id: "venta-1",
              clienteId: "cliente-2",
              planNuevo: "premium",
              monto: 200,
              estado: "pendiente_confirmacion",
              tokenConfirmacion: "token-2",
            },
          }),
        ),
      ).toThrow(VentaAlreadyExistsError);

      expect(getCasoById(db, "caso-2")).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM vendedores WHERE id = ?").get("vendedor-2")).toBeUndefined();
      // The first, successful call's rows are untouched by the rollback.
      expect(getCasoById(db, "caso-1")).not.toBeUndefined();
      expect(getVentaById(db, "venta-1")?.clienteId).toBe("cliente-1");
    });

    it("throws VentaTokenDuplicadoError when token_confirmacion collides with an existing venta", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      expect(() =>
        createVentaConCaso(
          db!,
          buildVentaConCasoInput({
            caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
            venta: {
              id: "venta-2",
              clienteId: "cliente-2",
              planNuevo: "premium",
              monto: 200,
              estado: "pendiente_confirmacion",
              tokenConfirmacion: "token-1",
            },
          }),
        ),
      ).toThrow(VentaTokenDuplicadoError);

      expect(getCasoById(db, "caso-2")).toBeUndefined();
      expect(getVentaById(db, "venta-2")).toBeUndefined();
    });

    // `createVentaConCaso` upserts el vendedor y crea el caso ANTES del INSERT
    // de `ventas`, en la misma transacción — por construcción, `vendedor_id`
    // y `caso_id` siempre existen para ese INSERT, así que el catch de
    // `VentaInvalidReferenceError` (molde de `ActividadInvalidReferenceError`)
    // es defensivo: no hay hoy un caller público que lo dispare. Este test no
    // pasa por `createVentaConCaso` — verifica, al nivel de la tabla real,
    // que el `FOREIGN KEY` que ese catch está preparado para traducir
    // efectivamente existe y se dispara, para que la traducción no quede sin
    // ninguna base real detrás.
    it("rejects at the schema level a ventas row whose vendedor_id does not reference an existing vendedor", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }));

      expect(() =>
        db!
          .prepare(
            `INSERT INTO ventas (id, vendedor_id, cliente_id, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at)
             VALUES (@id, @vendedorId, @clienteId, @planNuevo, @monto, @estado, @casoId, @tokenConfirmacion, @createdAt)`,
          )
          .run({
            id: "venta-x",
            vendedorId: "no-existe",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 10,
            estado: "pendiente_confirmacion",
            casoId: "caso-1",
            tokenConfirmacion: "token-x",
            createdAt: "2026-08-26T00:00:00.000Z",
          }),
      ).toThrowError(/FOREIGN KEY/i);
    });
  });

  describe("findVentaByToken", () => {
    it("finds a venta by its token_confirmacion", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      const venta = findVentaByToken(db, "token-1");

      expect(venta?.id).toBe("venta-1");
    });

    it("returns undefined when no venta matches the token", () => {
      db = openDatabase(":memory:");

      expect(findVentaByToken(db, "no-existe")).toBeUndefined();
    });
  });

  describe("getVentaById", () => {
    it("returns undefined when the venta does not exist", () => {
      db = openDatabase(":memory:");

      expect(getVentaById(db, "no-existe")).toBeUndefined();
    });
  });

  describe("confirmarVentaConComision", () => {
    it("updates venta a confirmada, inserta la comision, y vendedorId de la comision sale de la fila que RETURNING acaba de devolver", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      const resultado = confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      expect(resultado?.venta.estado).toBe("confirmada");
      expect(resultado?.venta.confirmedAt).toBe("2026-08-26T01:00:00.000Z");
      expect(resultado?.comision).toEqual({
        id: "comision-1",
        ventaId: "venta-1",
        vendedorId: "vendedor-1",
        monto: 15,
        periodo: "2026-08",
        createdAt: "2026-08-26T01:00:00.000Z",
      });
    });

    it("dos llamadas seguidas sobre el mismo token: la segunda devuelve undefined y SELECT count(*) FROM comisiones es 1 (cierra R4 sin createKeyedQueue())", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      const input = {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      };

      const primera = confirmarVentaConComision(db, input);
      const segunda = confirmarVentaConComision(db, { ...input, comisionId: "comision-2" });

      expect(primera).not.toBeUndefined();
      expect(segunda).toBeUndefined();
      const count = db.prepare("SELECT count(*) as total FROM comisiones").get() as { total: number };
      expect(count.total).toBe(1);
    });

    it("token vencido: devuelve undefined sin escribir nada (ni venta ni comision)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
            expiresAt: "2026-08-26T00:30:00.000Z",
          },
        }),
      );

      const resultado = confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      expect(resultado).toBeUndefined();
      const venta = getVentaById(db, "venta-1");
      expect(venta?.estado).toBe("pendiente_confirmacion");
      expect(venta).not.toHaveProperty("confirmedAt");
      const count = db.prepare("SELECT count(*) as total FROM comisiones").get() as { total: number };
      expect(count.total).toBe(0);
    });

    it("confirma correctamente cuando expires_at esta en el futuro respecto a ahora (rama '> @ahora' del guard)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
            expiresAt: "2026-08-27T00:00:00.000Z",
          },
        }),
      );

      const resultado = confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      expect(resultado?.venta.estado).toBe("confirmada");
    });
  });

  describe("rechazarVenta", () => {
    it("actualiza estado a rechazada y nunca toca comisiones", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      const venta = rechazarVenta(db, { ventaId: "venta-1", ahora: "2026-08-26T01:00:00.000Z" });

      expect(venta?.estado).toBe("rechazada");
      const count = db.prepare("SELECT count(*) as total FROM comisiones").get() as { total: number };
      expect(count.total).toBe(0);
    });

    it("devuelve undefined cuando la venta ya no esta pendiente_confirmacion", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      rechazarVenta(db, { ventaId: "venta-1", ahora: "2026-08-26T01:00:00.000Z" });

      const segundo = rechazarVenta(db, { ventaId: "venta-1", ahora: "2026-08-26T01:05:00.000Z" });

      expect(segundo).toBeUndefined();
    });
  });

  describe("aprobarReembolso", () => {
    it("CAS a reembolsada desde confirmada, sin modificar la comision ya pagada", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      const venta = aprobarReembolso(db, { ventaId: "venta-1", ahora: "2026-08-27T00:00:00.000Z" });

      expect(venta?.estado).toBe("reembolsada");
      const comision = db.prepare("SELECT monto FROM comisiones WHERE id = ?").get("comision-1") as {
        monto: number;
      };
      expect(comision.monto).toBe(15);
      const count = db.prepare("SELECT count(*) as total FROM comisiones").get() as { total: number };
      expect(count.total).toBe(1);
    });

    it("devuelve undefined cuando la venta no esta confirmada", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      const venta = aprobarReembolso(db, { ventaId: "venta-1", ahora: "2026-08-26T01:00:00.000Z" });

      expect(venta).toBeUndefined();
    });

    it("aplica el CAS sin guarda de expiracion aunque expires_at ya haya vencido (ADR 19, punto 2)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
            expiresAt: "2026-08-26T00:30:00.000Z",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T00:10:00.000Z",
      });

      // "ahora" muy posterior a expires_at, que ya no importa post-confirmacion.
      const venta = aprobarReembolso(db, { ventaId: "venta-1", ahora: "2026-09-01T00:00:00.000Z" });

      expect(venta?.estado).toBe("reembolsada");
    });
  });

  describe("escalarReembolso", () => {
    it("CAS a reembolso_pendiente Y mueve el caso a pendiente_aprobacion_humana en la MISMA transaccion", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      const venta = escalarReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        ahora: "2026-08-27T00:00:00.000Z",
      });

      expect(venta?.estado).toBe("reembolso_pendiente");
      expect(getCasoById(db, "caso-1")?.estado).toBe("pendiente_aprobacion_humana");
      const count = db.prepare("SELECT count(*) as total FROM comisiones").get() as { total: number };
      expect(count.total).toBe(1);
    });

    it("si la venta no esta confirmada, devuelve undefined y el caso NO se toca", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      // La venta sigue en pendiente_confirmacion (nunca se confirmo).

      const venta = escalarReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        ahora: "2026-08-27T00:00:00.000Z",
      });

      expect(venta).toBeUndefined();
      expect(getCasoById(db, "caso-1")?.estado).toBe("pendiente_confirmacion");
    });

    it("si el caso no existe, la actualizacion de la venta tambien se revierte (misma transaccion)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      expect(() =>
        escalarReembolso(db!, {
          ventaId: "venta-1",
          casoId: "no-existe",
          ahora: "2026-08-27T00:00:00.000Z",
        }),
      ).toThrow(CasoNotFoundError);

      expect(getVentaById(db, "venta-1")?.estado).toBe("confirmada");
    });
  });

  describe("listComisionesPorPeriodo", () => {
    it("joins comision con venta y vendedor, devolviendo el estado ACTUAL de la venta", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      const filas = listComisionesPorPeriodo(db, "2026-08");

      expect(filas).toEqual([
        {
          ventaId: "venta-1",
          vendedorId: "vendedor-1",
          vendedorNombre: "Ana Vendedora",
          comisionMonto: 15,
          ventaMonto: 100,
          ventaEstado: "confirmada",
          periodo: "2026-08",
        },
      ]);
    });

    it("filtra por periodo: excluye comisiones de otros periodos", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      expect(listComisionesPorPeriodo(db, "2026-09")).toEqual([]);
    });

    it("refleja el estado ACTUAL de la venta, no el estado al momento de la comision (hace visible R5)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      aprobarReembolso(db, { ventaId: "venta-1", ahora: "2026-08-27T00:00:00.000Z" });

      const filas = listComisionesPorPeriodo(db, "2026-08");

      expect(filas).toEqual([
        expect.objectContaining({ ventaId: "venta-1", ventaEstado: "reembolsada", comisionMonto: 15 }),
      ]);
    });

    it("ordena por vendedor_id, luego por created_at de la comision, sin GROUP BY", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          vendedor: { id: "vendedor-2", nombre: "Beto Vendedor" },
          caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
          },
        }),
      );
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-2",
            clienteId: "cliente-2",
            planNuevo: "premium",
            monto: 200,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-2",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-2",
        comisionId: "comision-2",
        comisionMonto: 20,
        periodo: "2026-08",
        ahora: "2026-08-26T02:00:00.000Z",
      });

      const filas = listComisionesPorPeriodo(db, "2026-08");

      expect(filas.map((f) => f.vendedorId)).toEqual(["vendedor-1", "vendedor-2"]);
    });
  });

  describe("listVentasEnReembolsoPendiente", () => {
    it("devuelve ventas en reembolso_pendiente joineadas con el nombre del vendedor, sin filtro de periodo", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });

      const filas = listVentasEnReembolsoPendiente(db);

      expect(filas).toEqual([
        {
          ventaId: "venta-1",
          vendedorId: "vendedor-1",
          vendedorNombre: "Ana Vendedora",
          clienteId: "cliente-1",
          monto: 100,
          casoId: "caso-1",
          confirmedAt: "2026-08-26T01:00:00.000Z",
        },
      ]);
    });

    it("excluye ventas que no estan en reembolso_pendiente", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      expect(listVentasEnReembolsoPendiente(db)).toEqual([]);
    });

    it("ordena por confirmed_at ascendente, sin importar el orden de escalacion", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
          },
        }),
      );
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-2",
            clienteId: "cliente-2",
            planNuevo: "premium",
            monto: 200,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-2",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-2",
        comisionId: "comision-2",
        comisionMonto: 20,
        periodo: "2026-08",
        ahora: "2026-08-26T02:00:00.000Z",
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-2", casoId: "caso-2", ahora: "2026-08-27T00:00:00.000Z" });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T01:00:00.000Z" });

      const filas = listVentasEnReembolsoPendiente(db);

      expect(filas.map((f) => f.ventaId)).toEqual(["venta-1", "venta-2"]);
    });
  });

  describe("listEscalacionesReembolso", () => {
    it("lista reembolso_pendiente ordenadas por confirmed_at ASC", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
          },
        }),
      );
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-2",
            clienteId: "cliente-2",
            planNuevo: "premium",
            monto: 200,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-2",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-2",
        comisionId: "comision-2",
        comisionMonto: 20,
        periodo: "2026-08",
        ahora: "2026-08-26T02:00:00.000Z",
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-2", casoId: "caso-2", ahora: "2026-08-27T00:00:00.000Z" });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T01:00:00.000Z" });

      const filas = listEscalacionesReembolso(db, { estado: "reembolso_pendiente" });

      expect(filas.map((f) => f.ventaId)).toEqual(["venta-1", "venta-2"]);
      expect(filas[0]).toEqual(
        expect.objectContaining({ vendedorNombre: "Ana Vendedora", reaperturasPrevias: 0 }),
      );
    });

    it("respeta el limite en el listado sin filtro por id", () => {
      db = openDatabase(":memory:");
      for (let i = 1; i <= 3; i += 1) {
        createVentaConCaso(
          db,
          buildVentaConCasoInput({
            caso: buildCaso({ id: `caso-${i}`, tipo: "venta", estado: "pendiente_confirmacion" }),
            venta: {
              id: `venta-${i}`,
              clienteId: "cliente-1",
              planNuevo: "premium",
              monto: 100,
              estado: "pendiente_confirmacion",
              tokenConfirmacion: `token-${i}`,
            },
          }),
        );
        confirmarVentaConComision(db, {
          ventaId: `venta-${i}`,
          comisionId: `comision-${i}`,
          comisionMonto: 15,
          periodo: "2026-08",
          ahora: `2026-08-26T0${i}:00:00.000Z`,
        });
        escalarReembolso(db, { ventaId: `venta-${i}`, casoId: `caso-${i}`, ahora: "2026-08-27T00:00:00.000Z" });
      }

      const filas = listEscalacionesReembolso(db, { estado: "reembolso_pendiente", limite: 2 });

      expect(filas).toHaveLength(2);
    });

    it("filtro por ventaId encuentra la fila 21 de 25, sin importar el limite (ADR 38)", () => {
      db = openDatabase(":memory:");
      for (let i = 1; i <= 25; i += 1) {
        createVentaConCaso(
          db,
          buildVentaConCasoInput({
            caso: buildCaso({ id: `caso-${i}`, tipo: "venta", estado: "pendiente_confirmacion" }),
            venta: {
              id: `venta-${i}`,
              clienteId: "cliente-1",
              planNuevo: "premium",
              monto: 100,
              estado: "pendiente_confirmacion",
              tokenConfirmacion: `token-${i}`,
            },
          }),
        );
        confirmarVentaConComision(db, {
          ventaId: `venta-${i}`,
          comisionId: `comision-${i}`,
          comisionMonto: 15,
          periodo: "2026-08",
          ahora: `2026-08-26T00:00:${String(i).padStart(2, "0")}.000Z`,
        });
        escalarReembolso(db, { ventaId: `venta-${i}`, casoId: `caso-${i}`, ahora: "2026-08-27T00:00:00.000Z" });
      }

      // Sin filtro, el listado sin limite explicito se acota al default (20):
      // la fila 21 no aparecería en ese listado, pero SÍ se encuentra por id.
      const listado = listEscalacionesReembolso(db, { estado: "reembolso_pendiente" });
      expect(listado.some((f) => f.ventaId === "venta-21")).toBe(false);

      const porId = listEscalacionesReembolso(db, { estado: "reembolso_pendiente", ventaId: "venta-21" });
      expect(porId).toHaveLength(1);
      expect(porId[0]?.ventaId).toBe("venta-21");
    });

    it("reaperturasPrevias cuenta exactamente las filas 'reabierta'; rechazadaPor/rechazadaAt son las del ULTIMO rechazo", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });

      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });
      reabrirEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-2",
        ahora: "2026-08-29T00:00:00.000Z",
      });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-3",
        ahora: "2026-08-30T00:00:00.000Z",
      });

      const filas = listEscalacionesReembolso(db, { estado: "reembolso_rechazado" });

      expect(filas).toHaveLength(1);
      expect(filas[0]).toEqual(
        expect.objectContaining({
          ventaId: "venta-1",
          rechazadaPor: "beto",
          rechazadaAt: "2026-08-30T00:00:00.000Z",
          reaperturasPrevias: 1,
        }),
      );
    });

    it("no hace table scan de registro_acciones_empleado al resolver rechazadaPor/rechazadaAt (Reviewer finding: regresión de eficiencia — la versión con LEFT JOIN + GROUP BY escaneaba TODA la tabla de auditoría en cada llamada, en vez de usar el índice por venta_id)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      let sqlCapturado: string | undefined;
      const prepareOriginal = db.prepare.bind(db);
      // Monkeypatch temporal solo para capturar el SQL exacto que arma listEscalacionesReembolso.
      db.prepare = (sql: string) => {
        sqlCapturado = sql;
        return prepareOriginal(sql);
      };
      listEscalacionesReembolso(db, { estado: "reembolso_rechazado" });
      db.prepare = prepareOriginal;

      expect(sqlCapturado).toBeDefined();
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN ${sqlCapturado}`)
        .all({ estado: "reembolso_rechazado", ventaId: null, limite: 20 }) as Array<{ detail: string }>;
      const detalle = plan.map((p) => p.detail).join("\n");

      // Cualquier acceso a `registro_acciones_empleado` (alias `r` o `ultimo_rechazo`) tiene
      // que ser un SEARCH acotado por venta_id (o por su clave primaria), nunca un SCAN de
      // toda la tabla — eso es justamente lo que crece sin límite con el log append-only.
      expect(detalle).not.toMatch(/SCAN (r|ultimo_rechazo)\b/);
    });

    it("captura la forma EXACTA del row: sin rechazo previo omite rechazadaPor/rechazadaAt; con un solo rechazo los incluye", () => {
      db = openDatabase(":memory:");

      // Escenario 1: sin rechazo previo (queda pendiente).
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });

      const pendientes = listEscalacionesReembolso(db, { estado: "reembolso_pendiente" });

      expect(pendientes).toEqual([
        {
          ventaId: "venta-1",
          vendedorId: "vendedor-1",
          vendedorNombre: "Ana Vendedora",
          clienteId: "cliente-1",
          monto: 100,
          casoId: "caso-1",
          confirmedAt: "2026-08-26T01:00:00.000Z",
          reaperturasPrevias: 0,
        },
      ]);
      expect(pendientes[0]).not.toHaveProperty("rechazadaPor");
      expect(pendientes[0]).not.toHaveProperty("rechazadaAt");

      // Escenario 2: con un solo rechazo previo.
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-2",
            clienteId: "cliente-2",
            planNuevo: "premium",
            monto: 200,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-2",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-2",
        comisionId: "comision-2",
        comisionMonto: 20,
        periodo: "2026-08",
        ahora: "2026-08-26T02:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-2", casoId: "caso-2", ahora: "2026-08-27T02:00:00.000Z" });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-2",
        casoId: "caso-2",
        empleadoId: "carla",
        accionId: "accion-x",
        ahora: "2026-08-28T02:00:00.000Z",
      });

      const rechazados = listEscalacionesReembolso(db, { estado: "reembolso_rechazado" });

      expect(rechazados).toEqual([
        {
          ventaId: "venta-2",
          vendedorId: "vendedor-1",
          vendedorNombre: "Ana Vendedora",
          clienteId: "cliente-2",
          monto: 200,
          casoId: "caso-2",
          confirmedAt: "2026-08-26T02:00:00.000Z",
          rechazadaPor: "carla",
          rechazadaAt: "2026-08-28T02:00:00.000Z",
          reaperturasPrevias: 0,
        },
      ]);
    });

    it("ordena rechazados por rechazada_at DESC (mas reciente primero)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-1", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "premium",
            monto: 100,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-1",
          },
        }),
      );
      createVentaConCaso(
        db,
        buildVentaConCasoInput({
          caso: buildCaso({ id: "caso-2", tipo: "venta", estado: "pendiente_confirmacion" }),
          venta: {
            id: "venta-2",
            clienteId: "cliente-2",
            planNuevo: "premium",
            monto: 200,
            estado: "pendiente_confirmacion",
            tokenConfirmacion: "token-2",
          },
        }),
      );
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-2",
        comisionId: "comision-2",
        comisionMonto: 20,
        periodo: "2026-08",
        ahora: "2026-08-26T02:00:00.000Z",
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });
      escalarReembolso(db, { ventaId: "venta-2", casoId: "caso-2", ahora: "2026-08-27T01:00:00.000Z" });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-2",
        casoId: "caso-2",
        empleadoId: "ana",
        accionId: "accion-2",
        ahora: "2026-08-29T00:00:00.000Z",
      });

      const filas = listEscalacionesReembolso(db, { estado: "reembolso_rechazado" });

      expect(filas.map((f) => f.ventaId)).toEqual(["venta-2", "venta-1"]);
    });
  });

  describe("insertAccionEmpleado / listAccionesEmpleadoPorVenta", () => {
    it("inserta una fila y la lee de vuelta con venta_id/caso_id normalizados a NULL cuando estan ausentes", () => {
      db = openDatabase(":memory:");

      insertAccionEmpleado(db, {
        id: "accion-1",
        empleadoId: "ana",
        comando: "/soporte",
        resultado: "atendida",
        ocurridoAt: "2026-09-01T00:00:00.000Z",
      });

      const filas = listAccionesEmpleadoPorVenta(db, "venta-inexistente");
      expect(filas).toEqual([]);

      const fila = db
        .prepare("SELECT empleado_id, venta_id, caso_id FROM registro_acciones_empleado WHERE id = ?")
        .get("accion-1") as { empleado_id: string; venta_id: string | null; caso_id: string | null };
      expect(fila.empleado_id).toBe("ana");
      expect(fila.venta_id).toBeNull();
      expect(fila.caso_id).toBeNull();
    });

    it("listAccionesEmpleadoPorVenta devuelve las filas de una venta en orden de insercion", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());

      insertAccionEmpleado(db, {
        id: "accion-1",
        empleadoId: "ana",
        comando: "/devolucion",
        ventaId: "venta-1",
        casoId: "caso-1",
        resultado: "escalada",
        ocurridoAt: "2026-09-01T00:00:00.000Z",
      });
      insertAccionEmpleado(db, {
        id: "accion-2",
        empleadoId: "beto",
        comando: "/rechazar-reembolso",
        ventaId: "venta-1",
        casoId: "caso-1",
        resultado: "rechazada",
        ocurridoAt: "2026-09-02T00:00:00.000Z",
      });

      const filas = listAccionesEmpleadoPorVenta(db, "venta-1");

      expect(filas.map((f) => f.id)).toEqual(["accion-1", "accion-2"]);
    });
  });

  describe("aprobarEscalacionReembolso / rechazarEscalacionReembolso / reabrirEscalacionReembolso", () => {
    function escalarVentaDePrueba() {
      createVentaConCaso(db!, buildVentaConCasoInput());
      confirmarVentaConComision(db!, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });
      escalarReembolso(db!, { ventaId: "venta-1", casoId: "caso-1", ahora: "2026-08-27T00:00:00.000Z" });
    }

    it("aprobarEscalacionReembolso: CAS a reembolsada + caso resuelto + UNA fila, en una sola transaccion", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();

      const venta = aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      expect(venta?.estado).toBe("reembolsada");
      expect(getCasoById(db, "caso-1")?.estado).toBe("resuelto");
      const filas = listAccionesEmpleadoPorVenta(db, "venta-1");
      expect(filas).toHaveLength(1);
      expect(filas[0]).toEqual(
        expect.objectContaining({
          id: "accion-1",
          empleadoId: "ana",
          comando: "/aprobar-reembolso",
          resultado: "aprobada",
        }),
      );
    });

    it("aprobarEscalacionReembolso: si el caso no existe, la transaccion completa revierte (ni venta ni fila)", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();

      expect(() =>
        aprobarEscalacionReembolso(db!, {
          ventaId: "venta-1",
          casoId: "caso-inexistente",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: "2026-08-28T00:00:00.000Z",
        }),
      ).toThrow(CasoNotFoundError);

      expect(getVentaById(db, "venta-1")?.estado).toBe("reembolso_pendiente");
      expect(listAccionesEmpleadoPorVenta(db, "venta-1")).toEqual([]);
    });

    it("los tres CAS devuelven undefined sobre una venta 'confirmada' (no escalada) y no escriben nada", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 15,
        periodo: "2026-08",
        ahora: "2026-08-26T01:00:00.000Z",
      });

      const input = {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      };
      expect(aprobarEscalacionReembolso(db, input)).toBeUndefined();
      expect(rechazarEscalacionReembolso(db, input)).toBeUndefined();
      expect(reabrirEscalacionReembolso(db, input)).toBeUndefined();
      expect(getVentaById(db, "venta-1")?.estado).toBe("confirmada");
      expect(listAccionesEmpleadoPorVenta(db, "venta-1")).toEqual([]);
    });

    it("rechazarEscalacionReembolso: CAS a reembolso_rechazado + caso resuelto + fila 'rechazada'", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();

      const venta = rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      expect(venta?.estado).toBe("reembolso_rechazado");
      expect(getCasoById(db, "caso-1")?.estado).toBe("resuelto");
    });

    it("reabrirEscalacionReembolso: CAS reembolso_rechazado -> reembolso_pendiente, MISMO caso_id, vuelve a pendiente_aprobacion_humana", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      const venta = reabrirEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-2",
        ahora: "2026-08-29T00:00:00.000Z",
      });

      expect(venta?.estado).toBe("reembolso_pendiente");
      expect(venta?.casoId).toBe("caso-1");
      expect(getCasoById(db, "caso-1")?.estado).toBe("pendiente_aprobacion_humana");
      const pendientes = listEscalacionesReembolso(db, { estado: "reembolso_pendiente" });
      expect(pendientes.map((f) => f.ventaId)).toContain("venta-1");
    });

    it("una venta 'reembolsada' es terminal: reabrirEscalacionReembolso devuelve undefined, sin fila", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();
      aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      const resultado = reabrirEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-2",
        ahora: "2026-08-29T00:00:00.000Z",
      });

      expect(resultado).toBeUndefined();
      expect(listAccionesEmpleadoPorVenta(db, "venta-1")).toHaveLength(1);
    });

    it("doble aprobacion: la segunda devuelve undefined, sin segunda fila desde el CAS", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();
      aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      const segunda = aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-2",
        ahora: "2026-08-29T00:00:00.000Z",
      });

      expect(segunda).toBeUndefined();
      expect(listAccionesEmpleadoPorVenta(db, "venta-1")).toHaveLength(1);
    });

    it("ninguna fila de registro_acciones_empleado contiene un token_confirmacion, password, consulta ni motivo (garantia estructural)", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();
      aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-1",
        ahora: "2026-08-28T00:00:00.000Z",
      });

      const filas = db.prepare("SELECT * FROM registro_acciones_empleado").all();
      const serializado = JSON.stringify(filas);
      expect(serializado).not.toContain("token-1");
      expect(serializado.toLowerCase()).not.toContain("password");
      expect(serializado).not.toContain("motivo");
      expect(serializado).not.toContain("consulta");
    });

    it("ciclo end-to-end: escalada -> rechazada(ana) -> reabierta(beto) -> aprobada(ana) deja 4 filas en orden, venta termina reembolsada", () => {
      db = openDatabase(":memory:");
      escalarVentaDePrueba();

      insertAccionEmpleado(db, {
        id: "accion-escalada",
        empleadoId: "cliente-anonimo",
        comando: "/devolucion",
        ventaId: "venta-1",
        casoId: "caso-1",
        resultado: "escalada",
        ocurridoAt: "2026-08-27T00:00:01.000Z",
      });
      rechazarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-rechazada",
        ahora: "2026-08-28T00:00:00.000Z",
      });
      reabrirEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "beto",
        accionId: "accion-reabierta",
        ahora: "2026-08-29T00:00:00.000Z",
      });
      aprobarEscalacionReembolso(db, {
        ventaId: "venta-1",
        casoId: "caso-1",
        empleadoId: "ana",
        accionId: "accion-aprobada",
        ahora: "2026-08-30T00:00:00.000Z",
      });

      const filas = listAccionesEmpleadoPorVenta(db, "venta-1");

      expect(filas.map((f) => f.resultado)).toEqual(["escalada", "rechazada", "reabierta", "aprobada"]);
      expect(filas.map((f) => f.empleadoId)).toEqual(["cliente-anonimo", "ana", "beto", "ana"]);
      expect(getVentaById(db, "venta-1")?.estado).toBe("reembolsada");
    });
  });

  describe("credenciales de empleado", () => {
    it("insertCredencialEmpleado crea una fila con created_at === updated_at", () => {
      db = openDatabase(":memory:");

      const credencial = insertCredencialEmpleado(db, {
        empleadoId: "ana",
        passwordHash: "scrypt$16384$8$1$c2FsdA==$Y2xhdmU=",
        ahora: "2026-09-01T00:00:00.000Z",
      });

      expect(credencial).toEqual({
        empleadoId: "ana",
        passwordHash: "scrypt$16384$8$1$c2FsdA==$Y2xhdmU=",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });

    it("buscarCredencialEmpleado lee la fila insertada; undefined si no existe", () => {
      db = openDatabase(":memory:");
      insertCredencialEmpleado(db, {
        empleadoId: "ana",
        passwordHash: "hash-1",
        ahora: "2026-09-01T00:00:00.000Z",
      });

      expect(buscarCredencialEmpleado(db, "ana")?.passwordHash).toBe("hash-1");
      expect(buscarCredencialEmpleado(db, "inexistente")).toBeUndefined();
    });

    it("alta repetida lanza CredencialEmpleadoDuplicadaError y NO pisa el hash existente", () => {
      db = openDatabase(":memory:");
      insertCredencialEmpleado(db, {
        empleadoId: "ana",
        passwordHash: "hash-original",
        ahora: "2026-09-01T00:00:00.000Z",
      });

      expect(() =>
        insertCredencialEmpleado(db!, {
          empleadoId: "ana",
          passwordHash: "hash-nuevo",
          ahora: "2026-09-02T00:00:00.000Z",
        }),
      ).toThrow(CredencialEmpleadoDuplicadaError);

      expect(buscarCredencialEmpleado(db, "ana")?.passwordHash).toBe("hash-original");
    });

    it("updateCredencialEmpleado rota password_hash y updated_at, dejando created_at intacto", () => {
      db = openDatabase(":memory:");
      insertCredencialEmpleado(db, {
        empleadoId: "ana",
        passwordHash: "hash-viejo",
        ahora: "2026-09-01T00:00:00.000Z",
      });

      const rotada = updateCredencialEmpleado(db, {
        empleadoId: "ana",
        passwordHash: "hash-nuevo",
        ahora: "2026-09-05T00:00:00.000Z",
      });

      expect(rotada).toEqual({
        empleadoId: "ana",
        passwordHash: "hash-nuevo",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      });
    });

    it("updateCredencialEmpleado sobre un id inexistente devuelve undefined", () => {
      db = openDatabase(":memory:");

      const resultado = updateCredencialEmpleado(db, {
        empleadoId: "inexistente",
        passwordHash: "hash-nuevo",
        ahora: "2026-09-05T00:00:00.000Z",
      });

      expect(resultado).toBeUndefined();
    });
  });

  describe("delegaciones (migración 0007)", () => {
    it("crea la tabla delegaciones y el índice idx_delegaciones_caso", () => {
      db = openDatabase(":memory:");

      const tableNames = (
        db!
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name);
      const indexNames = (
        db!
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all() as { name: string }[]
      ).map((row) => row.name);

      expect(tableNames).toContain("delegaciones");
      expect(indexNames).toContain("idx_delegaciones_caso");
    });

    it("correr las migraciones dos veces no falla (IF NOT EXISTS)", () => {
      db = openDatabase(":memory:");

      expect(() => runMigrations(db!)).not.toThrow();
    });

    it("permite insertar una fila con sesion_padre_id y sesion_subagente_id ambos NULL (ADR 48)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      db!
        .prepare(
          "INSERT INTO delegaciones (id, caso_id, agent_id, sesion_padre_id, sesion_subagente_id, tarea_delegada, resultado, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "delegacion-1",
          "caso-1",
          "planner",
          null,
          null,
          "revisar el PR #1",
          null,
          "2026-09-06T00:00:00.000Z",
        );

      const fila = db!
        .prepare(
          "SELECT sesion_padre_id, sesion_subagente_id FROM delegaciones WHERE id = ?",
        )
        .get("delegacion-1") as {
        sesion_padre_id: string | null;
        sesion_subagente_id: string | null;
      };
      expect(fila.sesion_padre_id).toBeNull();
      expect(fila.sesion_subagente_id).toBeNull();
    });

    it("rechaza insertar una delegacion con un caso_id inexistente", () => {
      db = openDatabase(":memory:");

      expect(() =>
        db!
          .prepare(
            "INSERT INTO delegaciones (id, caso_id, agent_id, tarea_delegada, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            "delegacion-1",
            "caso-inexistente",
            "planner",
            "revisar el PR #1",
            "2026-09-06T00:00:00.000Z",
          ),
      ).toThrow(/FOREIGN KEY/);
    });

    it("rechaza insertar una delegacion sin agent_id", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() =>
        db!
          .prepare(
            "INSERT INTO delegaciones (id, caso_id, tarea_delegada, created_at) VALUES (?, ?, ?, ?)",
          )
          .run("delegacion-1", "caso-1", "revisar el PR #1", "2026-09-06T00:00:00.000Z"),
      ).toThrow(/NOT NULL/);
    });
  });
});
