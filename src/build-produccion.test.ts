/**
 * Test mecánico (RED, `modo-headless-cierre-limpio`, tarea 1.6, B1/B2) sobre
 * archivos de configuración del build de producción: `tsconfig.build.json`
 * (NUEVO), `package.json` (`scripts`) y `vitest.config.ts`. Ningún archivo
 * bajo test existe todavía con el contenido exigido — `npm run typecheck`
 * debe seguir VERDE (no hay tipos nuevos) y `npm test -- build-produccion`
 * debe fallar en (i)-(iii).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../", import.meta.url);

function leerJson(archivo: string): Record<string, unknown> {
  const contenido = readFileSync(new URL(archivo, REPO_ROOT), "utf8");
  return JSON.parse(contenido) as Record<string, unknown>;
}

function leerTexto(archivo: string): string {
  return readFileSync(new URL(archivo, REPO_ROOT), "utf8");
}

describe("tsconfig.build.json existe, extiende tsconfig.json y excluye todo archivo de test (modo-headless-cierre-limpio, tarea 1.6, B1)", () => {
  it("extends ./tsconfig.json", () => {
    const tsconfigBuild = leerJson("tsconfig.build.json");
    expect(tsconfigBuild["extends"]).toBe("./tsconfig.json");
  });

  it("exclude repite node_modules y dist, y agrega **/*.test.ts, **/*.test.tsx y src/test", () => {
    const tsconfigBuild = leerJson("tsconfig.build.json");
    const exclude = tsconfigBuild["exclude"];
    expect(Array.isArray(exclude)).toBe(true);
    const lista = exclude as unknown[];
    expect(lista).toContain("node_modules");
    expect(lista).toContain("dist");
    expect(lista).toContain("**/*.test.ts");
    expect(lista).toContain("**/*.test.tsx");
    expect(lista).toContain("src/test");
  });
});

describe("package.json — scripts de build de producción (modo-headless-cierre-limpio, tarea 1.6, B1/B2/RD-124)", () => {
  it("scripts.build usa -p tsconfig.build.json", () => {
    const pkg = leerJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts.build).toContain("-p tsconfig.build.json");
  });

  it("scripts.typecheck sigue tsc --noEmit, sin -p (sigue viendo tsconfig.json con los tests)", () => {
    const pkg = leerJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts.typecheck).toBe("tsc --noEmit");
    expect(scripts.typecheck).not.toContain("-p");
  });

  it("scripts.dev sigue siendo tsx src/main.ts", () => {
    const pkg = leerJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts.dev).toBe("tsx src/main.ts");
  });

  it("scripts.start ejecuta dist/main.js con node y no contiene tsx, tsc ni build", () => {
    const pkg = leerJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts.start).toBeDefined();
    expect(scripts.start).toContain("node");
    expect(scripts.start).toContain("dist/main.js");
    expect(scripts.start).not.toContain("tsx");
    expect(scripts.start).not.toContain("tsc");
    expect(scripts.start).not.toContain("build");
  });

  it("scripts.prebuild borra dist de forma multiplataforma (node -e, no rm -rf)", () => {
    const pkg = leerJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts.prebuild).toBeDefined();
    expect(scripts.prebuild).toContain("node -e");
    expect(scripts.prebuild).not.toContain("rm -rf");
  });

  it("version sigue 0.1.0 (fuera de alcance de este change)", () => {
    const pkg = leerJson("package.json");
    expect(pkg["version"]).toBe("0.1.0");
  });
});

describe("vitest.config.ts excluye dist/ de la discovery de tests (modo-headless-cierre-limpio, tarea 1.6, design §0.4/§9.3)", () => {
  it('el exclude incluye "**/dist/**"', () => {
    const source = leerTexto("vitest.config.ts");
    expect(source).toContain('"**/dist/**"');
  });
});
