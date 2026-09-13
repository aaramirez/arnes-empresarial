import { afterEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "./adapters/memory/db.js";
import { buscarRolEmpleado, insertCredencialEmpleado } from "./adapters/memory/repository.js";
import { main, parseArgsEmpleado } from "./empleados.js";

/**
 * Spec `autenticacion-empleado-tui`, requirements "Alta de credencial por
 * CLI con contraseña por stdin" y "Rotación de credencial por CLI" (ADR 33);
 * spec `autorizacion-empleado`, requirement "Provisioning del rol
 * exclusivamente por CLI" (ADR 160, RD-79). `parseArgsEmpleado` se testea
 * directo (I/O manual, mismo criterio que `reporte-mensual.test.ts` con
 * `parsePeriodo`). El modo `"asignar-rol"` de `main()` SÍ se integra:
 * `openDatabase` se espía (namespace import, molde de `getCasoById` en
 * `build-on-activity.test.ts`) para redirigir a un `:memory:` real ya
 * abierto, y `process.exit` se espía para capturar el código de salida sin
 * matar el worker de vitest — invariante de seguridad (no crea fila de rol
 * huérfana) que amerita test real, no solo verificación manual.
 */

describe("parseArgsEmpleado", () => {
  it("['ana'] → alta", () => {
    expect(parseArgsEmpleado(["ana"])).toEqual({ ok: true, empleadoId: "ana", modo: "alta" });
  });

  it("['ana','--rotar'] → rotar", () => {
    expect(parseArgsEmpleado(["ana", "--rotar"])).toEqual({ ok: true, empleadoId: "ana", modo: "rotar" });
  });

  it("['--rotar','ana'] → rotar (orden libre)", () => {
    expect(parseArgsEmpleado(["--rotar", "ana"])).toEqual({ ok: true, empleadoId: "ana", modo: "rotar" });
  });

  it("[] → uso (empleadoId ausente)", () => {
    const resultado = parseArgsEmpleado([]);
    expect(resultado.ok).toBe(false);
  });

  it("['--rotar'] → uso (empleadoId ausente, solo la flag)", () => {
    const resultado = parseArgsEmpleado(["--rotar"]);
    expect(resultado.ok).toBe(false);
  });

  it("['ana bad'] → uso (un solo argv con espacio no matchea ID_REGEX)", () => {
    const resultado = parseArgsEmpleado(["ana bad"]);
    expect(resultado.ok).toBe(false);
  });

  it("['--ana'] → uso (todo son flags, ningún posicional)", () => {
    const resultado = parseArgsEmpleado(["--ana"]);
    expect(resultado.ok).toBe(false);
  });

  it("['ana','--rotr'] → uso (flag desconocida, NO cae en silencio al modo alta)", () => {
    const resultado = parseArgsEmpleado(["ana", "--rotr"]);
    expect(resultado.ok).toBe(false);
  });

  it("un empleadoId con caracteres inválidos (espacio, símbolo) → uso", () => {
    expect(parseArgsEmpleado(["ana!"]).ok).toBe(false);
  });

  it("acepta un empleadoId con puntos, guiones y guion bajo", () => {
    expect(parseArgsEmpleado(["ana.beto-3_x"])).toEqual({
      ok: true,
      empleadoId: "ana.beto-3_x",
      modo: "alta",
    });
  });

  it("['ana','--rol','administrador'] → asignar-rol", () => {
    expect(parseArgsEmpleado(["ana", "--rol", "administrador"])).toEqual({
      ok: true,
      empleadoId: "ana",
      modo: "asignar-rol",
      rol: "administrador",
    });
  });

  it("['ana','--rol'] (sin valor siguiente) → uso", () => {
    expect(parseArgsEmpleado(["ana", "--rol"]).ok).toBe(false);
  });

  it("['ana','--rol','valor-invalido'] → uso", () => {
    expect(parseArgsEmpleado(["ana", "--rol", "valor-invalido"]).ok).toBe(false);
  });

  it("['ana','--rol','administrador','--rotar'] → uso, mensaje específico de incompatibilidad", () => {
    const resultado = parseArgsEmpleado(["ana", "--rol", "administrador", "--rotar"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensaje).toContain("--rol y --rotar no se combinan");
    }
  });

  it("una flag realmente desconocida sigue rechazando con el mensaje de flag desconocida, no con el de --rol/--rotar", () => {
    const resultado = parseArgsEmpleado(["ana", "--foo"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensaje).toContain("Flag desconocida: --foo");
    }
  });
});

describe("main() — modo asignar-rol", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = process.argv.slice(0, 2);
  });

  // `main()` cierra la conexión en su `finally` (comportamiento real,
  // correcto en producción). Para poder inspeccionar el estado del `db`
  // DESPUÉS de que `main()` retorne (o lance vía `process.exit` espiado),
  // `close()` se vuelve un no-op de test; el cierre real se restaura y se
  // invoca manualmente al final de cada test.
  function stubDb() {
    const db = dbModule.openDatabase(":memory:");
    const cerrarDeVerdad = db.close.bind(db);
    db.close = () => db;
    vi.spyOn(dbModule, "openDatabase").mockReturnValue(db);
    return { db, cerrarDeVerdad };
  }

  function stubExit() {
    return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  }

  it("empleadoId inexistente + --rol administrador ⇒ error, exit 1, sin credencial ni fila de rol huérfana", async () => {
    const { db, cerrarDeVerdad } = stubDb();
    const exitSpy = stubExit();
    process.argv = ["node", "empleados.ts", "ana", "--rol", "administrador"];

    try {
      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(buscarRolEmpleado(db, "ana")).toBeUndefined();
    } finally {
      cerrarDeVerdad();
    }
  });

  it("empleadoId existente + --rol administrador ⇒ éxito, upsertRolEmpleado aplicado, sin pedir stdin", async () => {
    const { db, cerrarDeVerdad } = stubDb();
    insertCredencialEmpleado(db, {
      empleadoId: "ana",
      passwordHash: "hash-cualquiera",
      ahora: "2026-09-13T00:00:00.000Z",
    });
    process.argv = ["node", "empleados.ts", "ana", "--rol", "administrador"];

    try {
      await main();

      const rol = buscarRolEmpleado(db, "ana");
      expect(rol?.rol).toBe("administrador");
    } finally {
      cerrarDeVerdad();
    }
  });
});
