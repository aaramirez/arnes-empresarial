/**
 * Test-first (RED) de `resolveDbPath` (`modo-headless-cierre-limpio`, tarea
 * 1.1, RD-122). El módulo bajo test (`./config.ts`) TODAVÍA NO EXISTE en
 * esta fase — `npm run typecheck` y `npm test -- memory/config` deben
 * fallar los dos, a propósito.
 *
 * Contrato exigido (design.md §7.2):
 *  - `resolveDbPath({})` ⇒ `DEFAULT_DB_PATH` (`"data/harness.db"`).
 *  - `HARNESS_DB_PATH` definida ⇒ ese valor.
 *  - `""` / `"   "` ⇒ equivalen a ausente ⇒ default.
 *  - Una ruta con espacios internos se devuelve TAL CUAL: `.trim()` recorta
 *    solo los bordes, nunca el contenido.
 *  - Escenario `.env`-only (J4, resuelto en design §0.3): el módulo carga
 *    `.env` como efecto colateral de su PRIMER import
 *    (`"../../core/config/env.js"`), así los dos CLIs (`empleados.ts`,
 *    `reporte-mensual.ts`) ven `HARNESS_DB_PATH` aunque nunca importaban el
 *    punto único de `dotenv` antes de este change.
 *  - El módulo no importa nada de `src/core/**` salvo `config/env.js`, ni de
 *    ningún otro adaptador (límite hexagonal, AGENTS.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveDbPath (modo-headless-cierre-limpio, tarea 1.1)", () => {
  it("sin HARNESS_DB_PATH, devuelve el default data/harness.db", async () => {
    const { resolveDbPath, DEFAULT_DB_PATH } = await import("./config.js");
    expect(DEFAULT_DB_PATH).toBe("data/harness.db");
    expect(resolveDbPath({})).toBe(DEFAULT_DB_PATH);
  });

  it("con HARNESS_DB_PATH definida, devuelve exactamente ese valor", async () => {
    const { resolveDbPath } = await import("./config.js");
    expect(resolveDbPath({ HARNESS_DB_PATH: "/var/lib/arnes/harness.db" })).toBe(
      "/var/lib/arnes/harness.db",
    );
  });

  it.each(["", "   "])("HARNESS_DB_PATH=%j equivale a ausente ⇒ default", async (valor) => {
    const { resolveDbPath, DEFAULT_DB_PATH } = await import("./config.js");
    expect(resolveDbPath({ HARNESS_DB_PATH: valor })).toBe(DEFAULT_DB_PATH);
  });

  it("una ruta con espacios se devuelve tal cual, sin escapes (.trim() solo de los bordes, design §7.2)", async () => {
    const { resolveDbPath } = await import("./config.js");
    const rutaConEspacios =
      "C:\\Users\\Windows\\Documents\\UCAB\\11 intensivo agosto 2026\\datos\\harness.db";
    expect(resolveDbPath({ HARNESS_DB_PATH: rutaConEspacios })).toBe(rutaConEspacios);
  });

  it("el módulo no importa nada de src/core/** salvo config/env.js, ni de otro adaptador", () => {
    const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s.*?["']([^"']+)["'];?\s*$/gm)].map(
      (match) => match[1],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const especificador of imports) {
      if (especificador?.includes("/core/")) {
        expect(especificador).toBe("../../core/config/env.js");
      }
      expect(especificador?.includes("/adapters/")).toBe(false);
    }
  });
});

describe("resolveDbPath -- escenario .env-only (J4, modo-headless-cierre-limpio, tarea 1.1)", () => {
  it("el PRIMER import de config.ts es el punto único de carga de .env", () => {
    const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    const primerImport = /^import\s.*?["']([^"']+)["'];?\s*$/m.exec(source)?.[1];
    expect(primerImport).toBe("../../core/config/env.js");
  });

  describe("comportamental, aislado (mkdtemp + process.chdir, restaurado en afterEach)", () => {
    let cwdOriginal: string;
    let dirTemporal: string;
    let valorPrevioEnProceso: string | undefined;

    beforeEach(() => {
      cwdOriginal = process.cwd();
      dirTemporal = mkdtempSync(join(tmpdir(), "harness-config-env-"));
      writeFileSync(join(dirTemporal, ".env"), "HARNESS_DB_PATH=/tmp/x.db\n");
      valorPrevioEnProceso = process.env.HARNESS_DB_PATH;
      delete process.env.HARNESS_DB_PATH;
      process.chdir(dirTemporal);
    });

    afterEach(() => {
      process.chdir(cwdOriginal);
      rmSync(dirTemporal, { recursive: true, force: true });
      if (valorPrevioEnProceso === undefined) {
        delete process.env.HARNESS_DB_PATH;
      } else {
        process.env.HARNESS_DB_PATH = valorPrevioEnProceso;
      }
    });

    it("un valor SOLO en .env, con el entorno del proceso sin la variable, lo resuelve resolveDbPath()", async () => {
      vi.resetModules();
      const { resolveDbPath } = await import("./config.js");
      expect(resolveDbPath()).toBe("/tmp/x.db");
    });
  });
});
