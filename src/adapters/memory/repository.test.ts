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
  DelegacionA2ANotFoundError,
  DelegacionNotFoundError,
  SesionAgenteAlreadyExistsError,
  SesionAgenteInvalidCasoError,
  SolicitudA2AEntranteYaExisteError,
  SolicitudAlreadyExistsError,
  VentaAlreadyExistsError,
  VentaTokenDuplicadoError,
  actualizarDelegacionA2A,
  actualizarSolicitudA2AEnCurso,
  adjuntarDictamenSolicitud,
  aplicarPropuestaCambio,
  aprobarEscalacionReembolso,
  aprobarReembolso,
  aprobarSolicitudInterna,
  buscarCredencialEmpleado,
  cancelarSolicitudA2AEntrante,
  cancelarSolicitudInterna,
  completarDelegacion,
  confirmarVentaConComision,
  crearSolicitudConCaso,
  createActividad,
  createCaso,
  createCasoConActividad,
  createSesionAgente,
  createVentaConCaso,
  descartarPropuestaCambio,
  escalarReembolso,
  findActividadPorReferencia,
  findVentaByToken,
  getActividadById,
  getCasoById,
  getLatestSesionAgente,
  getPropuestaCambio,
  getProyectoById,
  getSolicitudA2AEntrantePorTaskId,
  getVentaById,
  insertAccionEmpleado,
  insertCredencialEmpleado,
  insertDelegacion,
  insertDelegacionA2A,
  insertPropuestaCambio,
  insertSolicitudA2AEntrante,
  listAccionesEmpleadoPorVenta,
  listComisionesPorPeriodo,
  listDelegacionesA2APorCaso,
  listDelegacionesPorCaso,
  listEscalacionesReembolso,
  listPropuestasCambio,
  listSolicitudesA2AEntrantesPorCaso,
  listSolicitudesInternas,
  listVentasEnReembolsoPendiente,
  reabrirEscalacionReembolso,
  rechazarEscalacionReembolso,
  rechazarSolicitudInterna,
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
  type CrearPropuestaDbInput,
  type CrearSolicitudConCasoInput,
  type InsertDelegacionA2AInput,
  type InsertDelegacionInput,
  type InsertSolicitudA2AEntranteInput,
  type ResolucionPropuestaDbInput,
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

    it("incluye propuestaId cuando la fila lo tiene, y NO agrega la clave en absoluto cuando no (Reviewer finding: el SELECT explicito no traia propuesta_id, y undefined !== null dejaba una clave espuria propuestaId: undefined)", () => {
      db = openDatabase(":memory:");
      createVentaConCaso(db, buildVentaConCasoInput());
      createCaso(db, buildCaso({ id: "caso-2" }));
      insertPropuestaCambio(db, {
        id: "propuesta-1",
        casoId: "caso-2",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-caso-2-uuid",
        patch: "diff --git a/x b/x\n",
        patchBytes: 20,
        archivos: 1,
        lineasAgregadas: 1,
        lineasEliminadas: 0,
        ahora: "2026-09-07T00:00:00.000Z",
      });

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
        empleadoId: "ana",
        comando: "/aplicar-propuesta",
        ventaId: "venta-1",
        propuestaId: "propuesta-1",
        resultado: "aplicada",
        ocurridoAt: "2026-09-01T00:01:00.000Z",
      });

      const filas = listAccionesEmpleadoPorVenta(db, "venta-1");

      expect(filas).toHaveLength(2);
      const [sinPropuesta, conPropuesta] = filas;
      expect(Object.keys(sinPropuesta!)).not.toContain("propuestaId");
      expect(Object.keys(conPropuesta!)).toContain("propuestaId");
      expect(conPropuesta!.propuestaId).toBe("propuesta-1");
    });

    it("acepta propuestaId (columna nueva de la migracion 0009, ADR 63) y lo persiste sin tocar venta_id/caso_id", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertPropuestaCambio(db, {
        id: "propuesta-1",
        casoId: "caso-1",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-caso-1-uuid",
        patch: "diff --git a/x b/x\n",
        patchBytes: 20,
        archivos: 1,
        lineasAgregadas: 1,
        lineasEliminadas: 0,
        ahora: "2026-09-07T00:00:00.000Z",
      });

      insertAccionEmpleado(db, {
        id: "accion-1",
        empleadoId: "ana",
        comando: "/aplicar-propuesta",
        propuestaId: "propuesta-1",
        casoId: "caso-1",
        resultado: "aplicada",
        ocurridoAt: "2026-09-07T01:00:00.000Z",
      });

      const fila = db
        .prepare("SELECT propuesta_id, venta_id, caso_id FROM registro_acciones_empleado WHERE id = ?")
        .get("accion-1") as { propuesta_id: string | null; venta_id: string | null; caso_id: string | null };
      expect(fila.propuesta_id).toBe("propuesta-1");
      expect(fila.venta_id).toBeNull();
      expect(fila.caso_id).toBe("caso-1");
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

  describe("insertDelegacion / completarDelegacion / listDelegacionesPorCaso", () => {
    function insertDelegacionDePrueba(overrides: Partial<InsertDelegacionInput> = {}) {
      insertDelegacion(db!, {
        id: "delegacion-1",
        casoId: "caso-1",
        agentId: "planner",
        tareaDelegada: "revisar el PR #1",
        createdAt: "2026-09-06T00:00:00.000Z",
        ...overrides,
      });
    }

    it("insertDelegacion escribe una fila con sesion_padre_id/sesion_subagente_id y resultado en NULL", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionDePrueba();

      const [fila] = listDelegacionesPorCaso(db, "caso-1");
      expect(fila).toEqual({
        id: "delegacion-1",
        casoId: "caso-1",
        agentId: "planner",
        tareaDelegada: "revisar el PR #1",
        createdAt: "2026-09-06T00:00:00.000Z",
      });
      expect(fila!.sesionPadreId).toBeUndefined();
      expect(fila!.sesionSubagenteId).toBeUndefined();
      expect(fila!.resultado).toBeUndefined();
    });

    it("insertDelegacion acepta sesionPadreId cuando el eslabon no es la cabeza de la cadena", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      createSesionAgente(db, buildSesionAgente({ id: "sesion-planner", agentId: "planner" }));

      insertDelegacionDePrueba({
        id: "delegacion-2",
        agentId: "developer",
        sesionPadreId: "sesion-planner",
        tareaDelegada: "ejecutar el plan del planner",
        createdAt: "2026-09-06T00:00:01.000Z",
      });

      const [fila] = listDelegacionesPorCaso(db, "caso-1");
      expect(fila!.sesionPadreId).toBe("sesion-planner");
    });

    it("completarDelegacion: INSERT sesiones_agente + UPDATE delegaciones en una sola transaccion", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionDePrueba();

      completarDelegacion(db, {
        delegacionId: "delegacion-1",
        sesion: buildSesionAgente({ id: "sesion-planner", agentId: "planner" }),
        resultado: "plan de revision: revisar src/index.ts",
      });

      const [fila] = listDelegacionesPorCaso(db, "caso-1");
      expect(fila!.sesionSubagenteId).toBe("sesion-planner");
      expect(fila!.resultado).toBe("plan de revision: revisar src/index.ts");
      expect(getLatestSesionAgente(db, "caso-1", "planner")?.id).toBe("sesion-planner");
    });

    it("completarDelegacion es atomica: falla RUIDOSA si la delegacion no existe, y NO deja la sesion huerfana", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() =>
        completarDelegacion(db!, {
          delegacionId: "delegacion-inexistente",
          sesion: buildSesionAgente({ id: "sesion-planner", agentId: "planner" }),
          resultado: "plan de revision",
        }),
      ).toThrow(DelegacionNotFoundError);

      expect(getLatestSesionAgente(db, "caso-1", "planner")).toBeUndefined();
    });

    it("listDelegacionesPorCaso devuelve las filas en orden created_at", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacion(db, {
        id: "delegacion-reviewer",
        casoId: "caso-1",
        agentId: "reviewer",
        tareaDelegada: "emitir veredicto",
        createdAt: "2026-09-06T00:00:02.000Z",
      });
      insertDelegacion(db, {
        id: "delegacion-planner",
        casoId: "caso-1",
        agentId: "planner",
        tareaDelegada: "planificar revision",
        createdAt: "2026-09-06T00:00:00.000Z",
      });
      insertDelegacion(db, {
        id: "delegacion-developer",
        casoId: "caso-1",
        agentId: "developer",
        tareaDelegada: "ejecutar plan",
        createdAt: "2026-09-06T00:00:01.000Z",
      });

      const filas = listDelegacionesPorCaso(db, "caso-1");
      expect(filas.map((fila) => fila.id)).toEqual([
        "delegacion-planner",
        "delegacion-developer",
        "delegacion-reviewer",
      ]);
    });
  });

  describe("insertDelegacionA2A / actualizarDelegacionA2A / listDelegacionesA2APorCaso (migración 0010)", () => {
    function insertDelegacionA2ADePrueba(overrides: Partial<InsertDelegacionA2AInput> = {}) {
      insertDelegacionA2A(db!, {
        id: "delegacion-a2a-1",
        casoId: "caso-1",
        destinoClave: "riesgo-credito",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito",
        tareaDelegada: "Verificá el riesgo crediticio del cliente para esta venta y devolvé una evaluación breve.",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
        ...overrides,
      });
    }

    it("insertDelegacionA2A escribe una fila con a2a_task_id y resultado en NULL", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2ADePrueba();

      const [fila] = listDelegacionesA2APorCaso(db, "caso-1");
      expect(fila).toEqual({
        id: "delegacion-a2a-1",
        casoId: "caso-1",
        destinoClave: "riesgo-credito",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito",
        tareaDelegada: "Verificá el riesgo crediticio del cliente para esta venta y devolvé una evaluación breve.",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      });
      expect(fila!.a2aTaskId).toBeUndefined();
      expect(fila!.resultado).toBeUndefined();
    });

    it("el estado persistido y leido de vuelta es TASK_STATE_* crudo, nunca traducido a minuscula-con-guion", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2ADePrueba({ estado: "TASK_STATE_SUBMITTED" });

      const [fila] = listDelegacionesA2APorCaso(db, "caso-1");
      expect(fila!.estado).toBe("TASK_STATE_SUBMITTED");
    });

    it("actualizarDelegacionA2A con un campo undefined no pisa lo ya escrito (COALESCE)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2ADePrueba();

      actualizarDelegacionA2A(db, {
        delegacionId: "delegacion-a2a-1",
        estado: "TASK_STATE_COMPLETED",
        resultado: "el cliente tiene riesgo bajo",
        updatedAt: "2026-09-06T00:01:00.000Z",
      });

      // Segunda actualización: sólo toca `estado`. `resultado` y
      // `agenteExternoUrl` quedan `undefined` acá — el COALESCE no debe
      // pisar lo que la actualización anterior ya escribió.
      actualizarDelegacionA2A(db, {
        delegacionId: "delegacion-a2a-1",
        estado: "TASK_STATE_COMPLETED",
        updatedAt: "2026-09-06T00:02:00.000Z",
      });

      const [fila] = listDelegacionesA2APorCaso(db, "caso-1");
      expect(fila!.resultado).toBe("el cliente tiene riesgo bajo");
      expect(fila!.agenteExternoUrl).toBe("https://ejemplo.test/riesgo-credito");
      expect(fila!.estado).toBe("TASK_STATE_COMPLETED");
      expect(fila!.updatedAt).toBe("2026-09-06T00:02:00.000Z");
    });

    it("actualizarDelegacionA2A actualiza a2aTaskId y agenteExternoUrl al endpoint efectivo del Agent Card", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2ADePrueba();

      actualizarDelegacionA2A(db, {
        delegacionId: "delegacion-a2a-1",
        estado: "TASK_STATE_WORKING",
        a2aTaskId: "task-externo-1",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito/jsonrpc",
        updatedAt: "2026-09-06T00:01:00.000Z",
      });

      const [fila] = listDelegacionesA2APorCaso(db, "caso-1");
      expect(fila!.a2aTaskId).toBe("task-externo-1");
      expect(fila!.agenteExternoUrl).toBe("https://ejemplo.test/riesgo-credito/jsonrpc");
      expect(fila!.estado).toBe("TASK_STATE_WORKING");
    });

    it("actualizarDelegacionA2A con estado undefined preserva el último estado real escrito (COALESCE, code-review hallazgo 1)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2ADePrueba();

      actualizarDelegacionA2A(db, {
        delegacionId: "delegacion-a2a-1",
        estado: "TASK_STATE_WORKING",
        updatedAt: "2026-09-06T00:01:00.000Z",
      });

      // Segunda actualización sin `estado` (ej. un fallo de transporte antes
      // de que exista cualquier estado real) — NO debe pisar el último
      // estado real conocido con NULL ni con nada fabricado.
      actualizarDelegacionA2A(db, {
        delegacionId: "delegacion-a2a-1",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito/jsonrpc",
        updatedAt: "2026-09-06T00:02:00.000Z",
      });

      const [fila] = listDelegacionesA2APorCaso(db, "caso-1");
      expect(fila!.estado).toBe("TASK_STATE_WORKING");
      expect(fila!.agenteExternoUrl).toBe("https://ejemplo.test/riesgo-credito/jsonrpc");
    });

    it("actualizarDelegacionA2A sobre un delegacionId inexistente lanza DelegacionA2ANotFoundError", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() =>
        actualizarDelegacionA2A(db!, {
          delegacionId: "delegacion-a2a-inexistente",
          estado: "TASK_STATE_FAILED",
          updatedAt: "2026-09-06T00:01:00.000Z",
        }),
      ).toThrow(DelegacionA2ANotFoundError);
    });

    it("listDelegacionesA2APorCaso devuelve las filas de un caso ordenadas por created_at", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertDelegacionA2A(db, {
        id: "delegacion-a2a-kpi",
        casoId: "caso-1",
        destinoClave: "kpi-incidente",
        agenteExternoUrl: "https://ejemplo.test/kpi-incidente",
        tareaDelegada: "consultar el kpi",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-06T00:00:02.000Z",
        updatedAt: "2026-09-06T00:00:02.000Z",
      });
      insertDelegacionA2A(db, {
        id: "delegacion-a2a-riesgo",
        casoId: "caso-1",
        destinoClave: "riesgo-credito",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito",
        tareaDelegada: "verificar riesgo",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      });

      const filas = listDelegacionesA2APorCaso(db, "caso-1");
      expect(filas.map((fila) => fila.id)).toEqual(["delegacion-a2a-riesgo", "delegacion-a2a-kpi"]);
    });

    it("con el mismo created_at (empate al milisegundo), desempata por id de forma determinística", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      const createdAtEmpatado = "2026-09-08T00:00:00.000Z";
      insertDelegacionA2A(db, {
        id: "delegacion-a2a-z",
        casoId: "caso-1",
        destinoClave: "kpi-incidente",
        agenteExternoUrl: "https://ejemplo.test/kpi-incidente",
        tareaDelegada: "consultar el kpi",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: createdAtEmpatado,
        updatedAt: createdAtEmpatado,
      });
      insertDelegacionA2A(db, {
        id: "delegacion-a2a-a",
        casoId: "caso-1",
        destinoClave: "riesgo-credito",
        agenteExternoUrl: "https://ejemplo.test/riesgo-credito",
        tareaDelegada: "verificar riesgo",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: createdAtEmpatado,
        updatedAt: createdAtEmpatado,
      });

      const filas = listDelegacionesA2APorCaso(db, "caso-1");
      expect(filas.map((fila) => fila.id)).toEqual(["delegacion-a2a-a", "delegacion-a2a-z"]);
    });
  });

  describe("solicitudes_a2a_entrantes (migración 0011)", () => {
    it("crea la tabla solicitudes_a2a_entrantes y el índice idx_solicitudes_a2a_entrantes_caso", () => {
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

      expect(tableNames).toContain("solicitudes_a2a_entrantes");
      expect(indexNames).toContain("idx_solicitudes_a2a_entrantes_caso");
    });
  });

  describe("insertSolicitudA2AEntrante / actualizarSolicitudA2AEnCurso / cancelarSolicitudA2AEntrante / getSolicitudA2AEntrantePorTaskId / listSolicitudesA2AEntrantesPorCaso (migración 0011, Hito 7, tarea 7)", () => {
    function insertSolicitudA2AEntranteDePrueba(
      overrides: Partial<InsertSolicitudA2AEntranteInput> = {},
    ) {
      insertSolicitudA2AEntrante(db!, {
        id: "solicitud-a2a-1",
        a2aTaskId: "task-1",
        casoId: "caso-1",
        origenTransporte: "127.0.0.1",
        mensajeRecibido: "¿En qué estado está el proyecto X?",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
        ...overrides,
      });
    }

    it("insertSolicitudA2AEntrante deja agente_externo_url y resultado en NULL", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba();

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila).toEqual({
        id: "solicitud-a2a-1",
        a2aTaskId: "task-1",
        origenTransporte: "127.0.0.1",
        casoId: "caso-1",
        mensajeRecibido: "¿En qué estado está el proyecto X?",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
      });
      expect(fila!.agenteExternoUrl).toBeUndefined();
      expect(fila!.resultado).toBeUndefined();
    });

    it("casoId ausente ⇒ caso_id NULL (fila REJECTED, sin turno)", () => {
      db = openDatabase(":memory:");
      insertSolicitudA2AEntrante(db, {
        id: "solicitud-a2a-rechazada",
        a2aTaskId: "task-rechazada",
        origenTransporte: "127.0.0.1",
        mensajeRecibido: "¿En qué estado está el proyecto X?",
        estado: "TASK_STATE_REJECTED",
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
      });

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-rechazada");
      expect(fila!.casoId).toBeUndefined();
      expect(fila!.estado).toBe("TASK_STATE_REJECTED");
    });

    it("colisión de a2a_task_id lanza SolicitudA2AEntranteYaExisteError", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba();

      expect(() =>
        insertSolicitudA2AEntranteDePrueba({ id: "solicitud-a2a-otra" }),
      ).toThrow(SolicitudA2AEntranteYaExisteError);
    });

    it("getSolicitudA2AEntrantePorTaskId de un id inexistente devuelve undefined", () => {
      db = openDatabase(":memory:");

      expect(getSolicitudA2AEntrantePorTaskId(db, "task-inexistente")).toBeUndefined();
    });

    it("actualizarSolicitudA2AEnCurso sobre una fila CANCELED devuelve false y no pisa el estado (guarda del WHERE)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba();
      const resultado = cancelarSolicitudA2AEntrante(db, {
        a2aTaskId: "task-1",
        updatedAt: "2026-09-09T00:01:00.000Z",
      });
      expect(resultado).toBe("cancelada");

      const actualizoAlgo = actualizarSolicitudA2AEnCurso(db, {
        a2aTaskId: "task-1",
        estado: "TASK_STATE_COMPLETED",
        resultado: "texto que no debería persistirse",
        updatedAt: "2026-09-09T00:02:00.000Z",
      });

      expect(actualizoAlgo).toBe(false);
      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila!.estado).toBe("TASK_STATE_CANCELED");
      expect(fila!.resultado).toBeUndefined();
    });

    it("actualizarSolicitudA2AEnCurso sobre SUBMITTED/WORKING escribe el nuevo estado y resultado", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba();

      const actualizo = actualizarSolicitudA2AEnCurso(db, {
        a2aTaskId: "task-1",
        estado: "TASK_STATE_COMPLETED",
        resultado: "el proyecto está en revisión",
        updatedAt: "2026-09-09T00:01:00.000Z",
      });

      expect(actualizo).toBe(true);
      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila!.estado).toBe("TASK_STATE_COMPLETED");
      expect(fila!.resultado).toBe("el proyecto está en revisión");
    });

    it("cancelarSolicitudA2AEntrante sobre WORKING devuelve 'cancelada' y la fila queda CANCELED", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba({ estado: "TASK_STATE_SUBMITTED" });
      actualizarSolicitudA2AEnCurso(db, {
        a2aTaskId: "task-1",
        estado: "TASK_STATE_WORKING",
        updatedAt: "2026-09-09T00:00:30.000Z",
      });

      const resultado = cancelarSolicitudA2AEntrante(db, {
        a2aTaskId: "task-1",
        updatedAt: "2026-09-09T00:01:00.000Z",
      });

      expect(resultado).toBe("cancelada");
      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila!.estado).toBe("TASK_STATE_CANCELED");
      expect(fila!.updatedAt).toBe("2026-09-09T00:01:00.000Z");
    });

    it("cancelarSolicitudA2AEntrante sobre CANCELED devuelve 'ya-cancelada', idempotente, sin tocar updated_at", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba();
      cancelarSolicitudA2AEntrante(db, {
        a2aTaskId: "task-1",
        updatedAt: "2026-09-09T00:01:00.000Z",
      });
      const filaAntes = getSolicitudA2AEntrantePorTaskId(db, "task-1");

      const resultado = cancelarSolicitudA2AEntrante(db, {
        a2aTaskId: "task-1",
        updatedAt: "2026-09-09T00:02:00.000Z",
      });

      expect(resultado).toBe("ya-cancelada");
      const filaDespues = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(filaDespues).toEqual(filaAntes);
      expect(filaDespues!.updatedAt).toBe("2026-09-09T00:01:00.000Z");
    });

    it.each(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_REJECTED"])(
      "cancelarSolicitudA2AEntrante sobre %s devuelve 'no-cancelable' y no toca la fila",
      (estadoTerminal) => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        insertSolicitudA2AEntranteDePrueba({ estado: estadoTerminal });
        const filaAntes = getSolicitudA2AEntrantePorTaskId(db, "task-1");

        const resultado = cancelarSolicitudA2AEntrante(db, {
          a2aTaskId: "task-1",
          updatedAt: "2026-09-09T00:05:00.000Z",
        });

        expect(resultado).toBe("no-cancelable");
        const filaDespues = getSolicitudA2AEntrantePorTaskId(db, "task-1");
        expect(filaDespues).toEqual(filaAntes);
      },
    );

    it("cancelarSolicitudA2AEntrante sobre un a2aTaskId inexistente devuelve 'no-encontrada'", () => {
      db = openDatabase(":memory:");

      const resultado = cancelarSolicitudA2AEntrante(db, {
        a2aTaskId: "task-inexistente",
        updatedAt: "2026-09-09T00:05:00.000Z",
      });

      expect(resultado).toBe("no-encontrada");
    });

    it("listSolicitudesA2AEntrantesPorCaso devuelve las filas de un caso ordenadas por created_at", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntrante(db, {
        id: "solicitud-a2a-segunda",
        a2aTaskId: "task-2",
        casoId: "caso-1",
        origenTransporte: "127.0.0.1",
        mensajeRecibido: "segunda consulta",
        estado: "TASK_STATE_SUBMITTED",
        createdAt: "2026-09-09T00:00:02.000Z",
        updatedAt: "2026-09-09T00:00:02.000Z",
      });
      insertSolicitudA2AEntranteDePrueba({
        id: "solicitud-a2a-primera",
        a2aTaskId: "task-1",
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
      });

      const filas = listSolicitudesA2AEntrantesPorCaso(db, "caso-1");
      expect(filas.map((fila) => fila.id)).toEqual([
        "solicitud-a2a-primera",
        "solicitud-a2a-segunda",
      ]);
    });

    it("el estado persistido y leído de vuelta es TASK_STATE_* crudo, nunca traducido", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());
      insertSolicitudA2AEntranteDePrueba({ estado: "TASK_STATE_WORKING" });

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila!.estado).toBe("TASK_STATE_WORKING");
    });
  });

  describe("solicitudes_internas (migración 0008)", () => {
    function insertSolicitudDePrueba(
      db: Database.Database,
      overrides: Partial<{
        id: string;
        casoId: string;
        solicitanteId: string;
        tipo: string;
        detalle: string;
        estado: string;
        resueltaPor: string | null;
        createdAt: string;
        updatedAt: string;
      }> = {},
    ) {
      const fila = {
        id: "solicitud-1",
        casoId: "caso-1",
        solicitanteId: "empleado-arbitrario",
        tipo: "vacaciones",
        detalle: "una semana en marzo",
        estado: "pendiente_aprobacion_humana",
        resueltaPor: null,
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
        ...overrides,
      };

      db
        .prepare(
          "INSERT INTO solicitudes_internas (id, caso_id, solicitante_id, tipo, detalle, estado, resuelta_por, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          fila.id,
          fila.casoId,
          fila.solicitanteId,
          fila.tipo,
          fila.detalle,
          fila.estado,
          fila.resueltaPor,
          fila.createdAt,
          fila.updatedAt,
        );
    }

    it("crea la tabla solicitudes_internas y los índices idx_solicitudes_caso (UNIQUE) e idx_solicitudes_estado", () => {
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

      expect(tableNames).toContain("solicitudes_internas");
      expect(indexNames).toContain("idx_solicitudes_caso");
      expect(indexNames).toContain("idx_solicitudes_estado");

      const casoIndexInfo = (
        db!.prepare("PRAGMA index_list(solicitudes_internas)").all() as {
          name: string;
          unique: number;
        }[]
      ).find((row) => row.name === "idx_solicitudes_caso");
      expect(casoIndexInfo?.unique).toBe(1);
    });

    it("rechaza insertar dos solicitudes con el mismo caso_id (UNIQUE)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      insertSolicitudDePrueba(db, { id: "solicitud-1" });

      expect(() =>
        insertSolicitudDePrueba(db!, { id: "solicitud-2" }),
      ).toThrow(/UNIQUE/);
    });

    it("permite insertar con solicitante_id y resuelta_por arbitrarios, sin FK (ADR 49)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      expect(() =>
        insertSolicitudDePrueba(db!, {
          solicitanteId: "empleado-que-no-existe-en-ninguna-tabla",
          resueltaPor: "otro-empleado-inexistente",
        }),
      ).not.toThrow();
    });

    it("rechaza insertar una solicitud con un caso_id inexistente", () => {
      db = openDatabase(":memory:");

      expect(() =>
        insertSolicitudDePrueba(db!, { casoId: "caso-inexistente" }),
      ).toThrow(/FOREIGN KEY/);
    });
  });

  describe("propuestas_cambio (migración 0009, Hito 5.1, tarea 13)", () => {
    function insertPropuestaDePrueba(
      db: Database.Database,
      overrides: Partial<{
        id: string;
        casoId: string;
        delegacionId: string | null;
        baseCommit: string;
        ramaWorktree: string;
        patch: string;
        patchBytes: number;
        archivos: number;
        lineasAgregadas: number;
        lineasEliminadas: number;
        estado: string;
        createdAt: string;
        updatedAt: string;
      }> = {},
    ) {
      const fila = {
        id: "propuesta-1",
        casoId: "caso-1",
        delegacionId: null,
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-caso-1-uuid",
        patch: "diff --git a/x b/x\n",
        patchBytes: 20,
        archivos: 1,
        lineasAgregadas: 1,
        lineasEliminadas: 0,
        estado: "pendiente_aprobacion_humana",
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
        ...overrides,
      };

      db
        .prepare(
          "INSERT INTO propuestas_cambio (id, caso_id, delegacion_id, base_commit, rama_worktree, patch, patch_bytes, archivos, lineas_agregadas, lineas_eliminadas, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          fila.id,
          fila.casoId,
          fila.delegacionId,
          fila.baseCommit,
          fila.ramaWorktree,
          fila.patch,
          fila.patchBytes,
          fila.archivos,
          fila.lineasAgregadas,
          fila.lineasEliminadas,
          fila.estado,
          fila.createdAt,
          fila.updatedAt,
        );
    }

    it("crea la tabla propuestas_cambio, sus índices idx_propuestas_estado/idx_propuestas_caso y la columna propuesta_id en registro_acciones_empleado", () => {
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

      expect(tableNames).toContain("propuestas_cambio");
      expect(indexNames).toContain("idx_propuestas_estado");
      expect(indexNames).toContain("idx_propuestas_caso");

      const columnasRegistro = (
        db!.prepare("PRAGMA table_info(registro_acciones_empleado)").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(columnasRegistro).toContain("propuesta_id");
    });

    it("permite insertar una propuesta con delegacion_id NULL (precedente ADR 48)", () => {
      db = openDatabase(":memory:");
      createCaso(db, buildCaso());

      insertPropuestaDePrueba(db!, { delegacionId: null });

      const fila = db!
        .prepare("SELECT delegacion_id FROM propuestas_cambio WHERE id = ?")
        .get("propuesta-1") as { delegacion_id: string | null };
      expect(fila.delegacion_id).toBeNull();
    });

    it("rechaza insertar una propuesta con un caso_id inexistente", () => {
      db = openDatabase(":memory:");

      expect(() =>
        insertPropuestaDePrueba(db!, { casoId: "caso-inexistente" }),
      ).toThrow(/FOREIGN KEY/);
    });

    it("correr las migraciones dos veces no falla (IF NOT EXISTS)", () => {
      db = openDatabase(":memory:");

      expect(() => runMigrations(db!)).not.toThrow();
    });
  });

  describe("insertPropuestaCambio / getPropuestaCambio / listPropuestasCambio (Hito 5.1, tarea 14)", () => {
    function buildPropuestaInput(overrides: Partial<CrearPropuestaDbInput> = {}): CrearPropuestaDbInput {
      return {
        id: "propuesta-1",
        casoId: "caso-1",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-caso-1-uuid",
        patch: "diff --git a/x b/x\n+hola\n",
        patchBytes: 28,
        archivos: 1,
        lineasAgregadas: 1,
        lineasEliminadas: 0,
        ahora: "2026-09-07T00:00:00.000Z",
        ...overrides,
      };
    }

    describe("insertPropuestaCambio", () => {
      it("crea una fila en estado pendiente_aprobacion_humana con los contadores exactos", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());

        const propuesta = insertPropuestaCambio(db, buildPropuestaInput());

        expect(propuesta).toEqual({
          id: "propuesta-1",
          casoId: "caso-1",
          baseCommit: "abc123",
          ramaWorktree: "harness/caso-caso-1-uuid",
          patch: "diff --git a/x b/x\n+hola\n",
          patchBytes: 28,
          archivos: 1,
          lineasAgregadas: 1,
          lineasEliminadas: 0,
          estado: "pendiente_aprobacion_humana",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
        });
      });

      it("persiste igual sin delegacion_id (ADR 48): la fila queda sin delegacionId", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());

        const propuesta = insertPropuestaCambio(db, buildPropuestaInput());

        expect(propuesta.delegacionId).toBeUndefined();
      });
    });

    describe("getPropuestaCambio", () => {
      it("devuelve undefined para un id inexistente", () => {
        db = openDatabase(":memory:");

        expect(getPropuestaCambio(db, "propuesta-inexistente")).toBeUndefined();
      });

      it("devuelve la fila insertada por id", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        insertPropuestaCambio(db, buildPropuestaInput());

        expect(getPropuestaCambio(db, "propuesta-1")?.estado).toBe("pendiente_aprobacion_humana");
      });
    });

    describe("listPropuestasCambio", () => {
      function crearSegundaPropuesta(ahora: string) {
        createCaso(db!, buildCaso({ id: "caso-2" }));
        insertPropuestaCambio(db!, buildPropuestaInput({ id: "propuesta-2", casoId: "caso-2", ahora }));
      }

      it("filtra por estado", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        insertPropuestaCambio(db, buildPropuestaInput());
        crearSegundaPropuesta("2026-09-07T00:05:00.000Z");
        db!.prepare("UPDATE propuestas_cambio SET estado = 'aplicada' WHERE id = ?").run("propuesta-2");

        const pendientes = listPropuestasCambio(db, { estado: "pendiente_aprobacion_humana" });

        expect(pendientes.map((p) => p.id)).toEqual(["propuesta-1"]);
      });

      it("filtra opcionalmente por propuestaId", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        insertPropuestaCambio(db, buildPropuestaInput());
        crearSegundaPropuesta("2026-09-07T00:05:00.000Z");

        const filtradas = listPropuestasCambio(db, { propuestaId: "propuesta-2" });

        expect(filtradas.map((p) => p.id)).toEqual(["propuesta-2"]);
      });

      it("ordena por created_at y respeta el limite", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        // Se inserta primero la que tiene el `created_at` MÁS TARDÍO, para que
        // el orden del resultado sólo pueda explicarse por `ORDER BY
        // created_at`, nunca por el orden de inserción.
        insertPropuestaCambio(db, buildPropuestaInput({ ahora: "2026-09-07T00:10:00.000Z" }));
        crearSegundaPropuesta("2026-09-07T00:05:00.000Z");

        const listado = listPropuestasCambio(db);
        expect(listado.map((p) => p.id)).toEqual(["propuesta-2", "propuesta-1"]);

        const limitadas = listPropuestasCambio(db, { limite: 1 });
        expect(limitadas.map((p) => p.id)).toEqual(["propuesta-2"]);
      });

      it("filtra por estado usando el indice idx_propuestas_estado, sin table scan (Reviewer finding: el (@estado IS NULL OR estado = @estado) impedia que SQLite use el indice aunque estado viaje con valor)", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso());
        insertPropuestaCambio(db, buildPropuestaInput());

        let sqlCapturado: string | undefined;
        const prepareOriginal = db!.prepare.bind(db);
        // Monkeypatch temporal solo para capturar el SQL exacto que arma listPropuestasCambio.
        db!.prepare = (sql: string) => {
          sqlCapturado = sql;
          return prepareOriginal(sql);
        };
        listPropuestasCambio(db, { estado: "pendiente_aprobacion_humana" });
        db!.prepare = prepareOriginal;

        expect(sqlCapturado).toBeDefined();
        const plan = db!
          .prepare(`EXPLAIN QUERY PLAN ${sqlCapturado}`)
          .all({ estado: "pendiente_aprobacion_humana", propuestaId: null, limite: 20 }) as Array<{
          detail: string;
        }>;
        const detalle = plan.map((p) => p.detail).join("\n");

        // Con `estado` presente, el acceso a `propuestas_cambio` tiene que ser un
        // SEARCH acotado por el indice de estado, nunca un SCAN de toda la tabla.
        expect(detalle).toMatch(/SEARCH propuestas_cambio USING INDEX idx_propuestas_estado/);
        expect(detalle).not.toMatch(/SCAN propuestas_cambio/);
      });
    });

    describe("aplicarPropuestaCambio / descartarPropuestaCambio (Hito 5.1, tarea 15)", () => {
      function buildResolucionInput(
        overrides: Partial<ResolucionPropuestaDbInput> = {},
      ): ResolucionPropuestaDbInput {
        return {
          propuestaId: "propuesta-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: "2026-09-07T01:00:00.000Z",
          ...overrides,
        };
      }

      it("aplicarPropuestaCambio: CAS a aplicada + updateCaso SOLO updatedAt (el estado del caso NO cambia, ADR 65) + UNA fila de auditoria con propuestaId, en una sola transaccion", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso({ estado: "abierto" }));
        insertPropuestaCambio(db, buildPropuestaInput());
        const casoAntes = getCasoById(db, "caso-1");

        const propuesta = aplicarPropuestaCambio(db, buildResolucionInput());

        expect(propuesta?.estado).toBe("aplicada");
        expect(propuesta?.resueltaPor).toBe("ana");
        expect(propuesta?.resueltaAt).toBe("2026-09-07T01:00:00.000Z");

        // ADR 65, assert explícito: el `estado` del caso NO cambia — sólo
        // `updatedAt` se mueve. Aplicar una propuesta no es un canal de
        // transición de estado del caso.
        const casoDespues = getCasoById(db, "caso-1");
        expect(casoDespues?.estado).toBe(casoAntes?.estado);
        expect(casoDespues?.estado).toBe("abierto");
        expect(casoDespues?.updatedAt).toBe("2026-09-07T01:00:00.000Z");

        const fila = db!
          .prepare(
            "SELECT id, empleado_id, comando, resultado, caso_id, propuesta_id FROM registro_acciones_empleado WHERE id = ?",
          )
          .get("accion-1") as {
          id: string;
          empleado_id: string;
          comando: string;
          resultado: string;
          caso_id: string;
          propuesta_id: string;
        };
        expect(fila).toEqual({
          id: "accion-1",
          empleado_id: "ana",
          comando: "/aplicar-propuesta",
          resultado: "aplicada",
          caso_id: "caso-1",
          propuesta_id: "propuesta-1",
        });
      });

      it("descartarPropuestaCambio: CAS a descartada con motivo + caso SOLO updatedAt (ADR 65) + fila 'descartada' con propuestaId, en una sola transaccion", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso({ estado: "abierto" }));
        insertPropuestaCambio(db, buildPropuestaInput());

        const propuesta = descartarPropuestaCambio(
          db,
          buildResolucionInput({ empleadoId: "beto", motivo: "base_commit desactualizado" }),
        );

        expect(propuesta?.estado).toBe("descartada");
        expect(propuesta?.motivo).toBe("base_commit desactualizado");
        expect(propuesta?.resueltaPor).toBe("beto");
        expect(getCasoById(db, "caso-1")?.estado).toBe("abierto");

        const fila = db!
          .prepare("SELECT comando, resultado, propuesta_id FROM registro_acciones_empleado WHERE id = ?")
          .get("accion-1") as { comando: string; resultado: string; propuesta_id: string };
        expect(fila).toEqual({
          comando: "/descartar-propuesta",
          resultado: "descartada",
          propuesta_id: "propuesta-1",
        });
      });

      it("CAS que no matchea (propuesta ya no pendiente) devuelve undefined y NO escribe ni el caso ni la fila de auditoria (rollback verificable)", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso({ estado: "abierto", updatedAt: "2026-09-07T00:00:00.000Z" }));
        insertPropuestaCambio(db, buildPropuestaInput());
        // Fuerza que el CAS de estado no matchee: la propuesta ya no esta pendiente.
        db!.prepare("UPDATE propuestas_cambio SET estado = 'aplicada' WHERE id = ?").run("propuesta-1");

        const resultado = aplicarPropuestaCambio(db, buildResolucionInput({ ahora: "2026-09-07T02:00:00.000Z" }));

        expect(resultado).toBeUndefined();
        // El caso NO se toca en absoluto (ni estado ni updatedAt) -- consulta
        // directa, no solo el valor de retorno.
        const caso = getCasoById(db, "caso-1");
        expect(caso?.estado).toBe("abierto");
        expect(caso?.updatedAt).toBe("2026-09-07T00:00:00.000Z");
        // La fila de auditoria NUNCA se escribio -- consulta directa.
        const filaAccion = db!
          .prepare("SELECT id FROM registro_acciones_empleado WHERE id = ?")
          .get("accion-1");
        expect(filaAccion).toBeUndefined();
        // La propuesta persistida sigue intacta en 'aplicada' (el estado que
        // ya tenía, forzado arriba) -- el CAS fallido no la mueve a otro lado.
        expect(getPropuestaCambio(db, "propuesta-1")?.estado).toBe("aplicada");
      });

      it("descartarPropuestaCambio con CAS que no matchea tampoco escribe nada (rollback verificable)", () => {
        db = openDatabase(":memory:");
        createCaso(db, buildCaso({ estado: "abierto" }));
        insertPropuestaCambio(db, buildPropuestaInput());
        db!.prepare("UPDATE propuestas_cambio SET estado = 'descartada' WHERE id = ?").run("propuesta-1");

        const resultado = descartarPropuestaCambio(db, buildResolucionInput({ motivo: "ya resuelta" }));

        expect(resultado).toBeUndefined();
        const filaAccion = db!
          .prepare("SELECT id FROM registro_acciones_empleado WHERE id = ?")
          .get("accion-1");
        expect(filaAccion).toBeUndefined();
      });
    });
  });

  describe("crearSolicitudConCaso / adjuntarDictamenSolicitud / listSolicitudesInternas / aprobarSolicitudInterna / rechazarSolicitudInterna (Hito 5, tarea 19)", () => {
    function buildSolicitudConCasoInput(
      overrides: Partial<CrearSolicitudConCasoInput> = {},
    ): CrearSolicitudConCasoInput {
      return {
        caso: { id: "caso-1", tipo: "solicitud_interna", estado: "pendiente_aprobacion_humana" },
        solicitud: {
          id: "solicitud-1",
          solicitanteId: "empleado-1",
          tipo: "vacaciones",
          detalle: "una semana en marzo",
          estado: "pendiente_aprobacion_humana",
        },
        timestamp: "2026-09-07T00:00:00.000Z",
        ...overrides,
      };
    }

    describe("crearSolicitudConCaso", () => {
      it("crea caso y solicitud en una sola transaccion", () => {
        db = openDatabase(":memory:");

        const { caso, solicitud } = crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        expect(caso).toEqual({
          id: "caso-1",
          tipo: "solicitud_interna",
          estado: "pendiente_aprobacion_humana",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
        });
        expect(solicitud).toEqual({
          id: "solicitud-1",
          casoId: "caso-1",
          solicitanteId: "empleado-1",
          tipo: "vacaciones",
          detalle: "una semana en marzo",
          estado: "pendiente_aprobacion_humana",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
        });
        expect(getCasoById(db, "caso-1")).not.toBeUndefined();
      });

      it("es atomica: si el INSERT de la solicitud falla, el caso recien creado no queda huerfano", () => {
        db = openDatabase(":memory:");
        // Prime an existing solicitud id by succeeding once.
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        expect(() =>
          crearSolicitudConCaso(
            db!,
            buildSolicitudConCasoInput({
              caso: { id: "caso-2", tipo: "solicitud_interna", estado: "pendiente_aprobacion_humana" },
              // Same solicitud id as the first call above -> PK violation inside the tx.
              solicitud: {
                id: "solicitud-1",
                solicitanteId: "empleado-2",
                tipo: "gasto",
                detalle: "otro detalle",
                estado: "pendiente_aprobacion_humana",
              },
            }),
          ),
        ).toThrow(SolicitudAlreadyExistsError);

        expect(getCasoById(db, "caso-2")).toBeUndefined();
        // The first, successful call's rows are untouched by the rollback.
        expect(getCasoById(db, "caso-1")).not.toBeUndefined();
      });
    });

    describe("adjuntarDictamenSolicitud", () => {
      it("escribe dictamen/dictaminada_at sin tocar estado", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        const actualizada = adjuntarDictamenSolicitud(db, {
          solicitudId: "solicitud-1",
          dictamen: "detalle razonable, sin bandera roja",
          ahora: "2026-09-07T00:05:00.000Z",
        });

        expect(actualizada?.dictamen).toBe("detalle razonable, sin bandera roja");
        expect(actualizada?.dictaminadaAt).toBe("2026-09-07T00:05:00.000Z");
        expect(actualizada?.estado).toBe("pendiente_aprobacion_humana");
      });

      it("devuelve undefined si la solicitud no existe", () => {
        db = openDatabase(":memory:");

        expect(
          adjuntarDictamenSolicitud(db, {
            solicitudId: "solicitud-inexistente",
            dictamen: "x",
            ahora: "2026-09-07T00:05:00.000Z",
          }),
        ).toBeUndefined();
      });
    });

    describe("listSolicitudesInternas", () => {
      function crearSegundaSolicitud() {
        crearSolicitudConCaso(
          db!,
          buildSolicitudConCasoInput({
            caso: { id: "caso-2", tipo: "solicitud_interna", estado: "pendiente_aprobacion_humana" },
            solicitud: {
              id: "solicitud-2",
              solicitanteId: "empleado-2",
              tipo: "gasto",
              detalle: "viatico de marzo",
              estado: "pendiente_aprobacion_humana",
            },
          }),
        );
      }

      it("filtra por estado pendiente, excluyendo solicitudes ya resueltas", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());
        crearSegundaSolicitud();
        aprobarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: "2026-09-07T01:00:00.000Z",
        });

        const pendientes = listSolicitudesInternas(db);

        expect(pendientes.map((s) => s.id)).toEqual(["solicitud-2"]);
      });

      it("filtra opcionalmente por id", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());
        crearSegundaSolicitud();

        const filtradas = listSolicitudesInternas(db, { solicitudId: "solicitud-2" });

        expect(filtradas.map((s) => s.id)).toEqual(["solicitud-2"]);
      });

      // ADR 144 pto 1 / design.md §6-bis fila 1 — spec cancelacion-solicitud-interna,
      // escenario "Solicitudes ajenas no consumen el tope del listado (el bug del LIMIT)".
      // Prueba que el hallazgo del Reviewer era un bug FUNCIONAL, no sólo cosmético: sin
      // filtrar por solicitanteId en el SQL, el LIMIT se aplica ANTES de saber de quién es
      // cada solicitud, así que 25 solicitudes ajenas más antiguas se comen el cupo entero
      // y la propia de E, aunque exista, nunca llega a la respuesta.
      it("no descarta la solicitud propia de E aunque 25 solicitudes ajenas mas antiguas llenen el LIMIT (bug del LIMIT)", () => {
        db = openDatabase(":memory:");
        for (let i = 0; i < 25; i += 1) {
          crearSolicitudConCaso(
            db!,
            buildSolicitudConCasoInput({
              caso: {
                id: `caso-ajena-${i}`,
                tipo: "solicitud_interna",
                estado: "pendiente_aprobacion_humana",
              },
              solicitud: {
                id: `solicitud-ajena-${i}`,
                solicitanteId: "empleado-ajeno",
                tipo: "vacaciones",
                detalle: `solicitud ajena ${i}`,
                estado: "pendiente_aprobacion_humana",
              },
              timestamp: `2026-09-07T00:00:${String(i).padStart(2, "0")}.000Z`,
            }),
          );
        }
        crearSolicitudConCaso(
          db,
          buildSolicitudConCasoInput({
            caso: { id: "caso-propia-e", tipo: "solicitud_interna", estado: "pendiente_aprobacion_humana" },
            solicitud: {
              id: "solicitud-propia-e",
              solicitanteId: "empleado-e",
              tipo: "gasto",
              detalle: "propia de E",
              estado: "pendiente_aprobacion_humana",
            },
            // Creada DESPUES que las 25 ajenas, respetando ORDER BY created_at.
            timestamp: "2026-09-07T00:01:00.000Z",
          }),
        );

        const propias = listSolicitudesInternas(db, { solicitanteId: "empleado-e", limite: 20 });

        expect(propias.map((s) => s.id)).toEqual(["solicitud-propia-e"]);
      });
    });

    describe("aprobarSolicitudInterna / rechazarSolicitudInterna", () => {
      it("aprobarSolicitudInterna: CAS a aprobada + caso resuelto + UNA fila de registro, en una sola transaccion", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        const solicitud = aprobarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: "2026-09-07T01:00:00.000Z",
        });

        expect(solicitud?.estado).toBe("aprobada");
        expect(solicitud?.resueltaPor).toBe("ana");
        expect(solicitud?.resueltaAt).toBe("2026-09-07T01:00:00.000Z");
        expect(getCasoById(db, "caso-1")?.estado).toBe("resuelto");

        const filas = db!
          .prepare("SELECT id, empleado_id, comando, resultado, caso_id FROM registro_acciones_empleado WHERE caso_id = ?")
          .all("caso-1") as { id: string; empleado_id: string; comando: string; resultado: string; caso_id: string }[];
        expect(filas).toHaveLength(1);
        expect(filas[0]).toEqual({
          id: "accion-1",
          empleado_id: "ana",
          comando: "/aprobar-solicitud",
          resultado: "aprobada",
          caso_id: "caso-1",
        });
      });

      it("rechazarSolicitudInterna: CAS a rechazada + caso resuelto + fila 'rechazada'", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        const solicitud = rechazarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "beto",
          accionId: "accion-1",
          ahora: "2026-09-07T01:00:00.000Z",
        });

        expect(solicitud?.estado).toBe("rechazada");
        expect(getCasoById(db, "caso-1")?.estado).toBe("resuelto");
      });

      it("CAS que no matchea (solicitud ya no pendiente) devuelve undefined y NO escribe ni el caso ni la fila de registro (rollback verificable)", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());
        // Fuerza que el CAS de estado no matchee: la solicitud ya no esta pendiente.
        db!.prepare("UPDATE solicitudes_internas SET estado = 'aprobada' WHERE id = ?").run("solicitud-1");

        const resultado = aprobarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: "2026-09-07T02:00:00.000Z",
        });

        expect(resultado).toBeUndefined();
        // El caso NO se marca resuelto -- consulta directa, no solo el valor de retorno.
        expect(getCasoById(db, "caso-1")?.estado).toBe("pendiente_aprobacion_humana");
        // La fila de registro NUNCA se escribio -- consulta directa, no solo el valor de retorno.
        const filaAccion = db!
          .prepare("SELECT id FROM registro_acciones_empleado WHERE id = ?")
          .get("accion-1");
        expect(filaAccion).toBeUndefined();
      });
    });

    describe("cancelarSolicitudInterna (comando-cancelar-solicitud, tarea 6)", () => {
      it("CAS a cancelada + caso resuelto + UNA fila '/cancelar-solicitud'/'cancelada', resuelta_por es el propio solicitante", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());

        const solicitud = cancelarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "empleado-1",
          accionId: "accion-1",
          ahora: "2026-09-07T01:00:00.000Z",
        });

        expect(solicitud?.estado).toBe("cancelada");
        expect(solicitud?.resueltaPor).toBe("empleado-1");
        expect(solicitud?.resueltaAt).toBe("2026-09-07T01:00:00.000Z");
        expect(getCasoById(db, "caso-1")?.estado).toBe("resuelto");

        const filas = db!
          .prepare(
            "SELECT id, empleado_id, comando, resultado, caso_id FROM registro_acciones_empleado WHERE caso_id = ?",
          )
          .all("caso-1") as { id: string; empleado_id: string; comando: string; resultado: string; caso_id: string }[];
        expect(filas).toHaveLength(1);
        expect(filas[0]).toEqual({
          id: "accion-1",
          empleado_id: "empleado-1",
          comando: "/cancelar-solicitud",
          resultado: "cancelada",
          caso_id: "caso-1",
        });
      });

      it("sobre una solicitud ya aprobada devuelve undefined y las tres tablas quedan identicas (snapshot antes/despues)", () => {
        db = openDatabase(":memory:");
        crearSolicitudConCaso(db, buildSolicitudConCasoInput());
        aprobarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-previa",
          ahora: "2026-09-07T00:30:00.000Z",
        });

        const snapshotAntes = {
          solicitudes: db!.prepare("SELECT * FROM solicitudes_internas").all(),
          casos: db!.prepare("SELECT * FROM casos").all(),
          acciones: db!.prepare("SELECT * FROM registro_acciones_empleado").all(),
        };

        const resultado = cancelarSolicitudInterna(db, {
          solicitudId: "solicitud-1",
          casoId: "caso-1",
          empleadoId: "empleado-1",
          accionId: "accion-cancelar",
          ahora: "2026-09-07T02:00:00.000Z",
        });

        expect(resultado).toBeUndefined();
        expect({
          solicitudes: db!.prepare("SELECT * FROM solicitudes_internas").all(),
          casos: db!.prepare("SELECT * FROM casos").all(),
          acciones: db!.prepare("SELECT * FROM registro_acciones_empleado").all(),
        }).toEqual(snapshotAntes);
      });
    });
  });
});
