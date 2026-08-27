import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "./db.js";
import {
  CasoAlreadyExistsError,
  CasoNotFoundError,
  SesionAgenteAlreadyExistsError,
  SesionAgenteInvalidCasoError,
  createCaso,
  createSesionAgente,
  getCasoById,
  getLatestSesionAgente,
  updateCaso,
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
});
