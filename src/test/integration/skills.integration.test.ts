import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SKILLS_DIR, DEPS_FS, descubrirSkills } from "../../core/skills/descubrir-skills.js";
import { SKILL_DESCRIPTION_MAX_CHARS } from "../../core/skills/skill-frontmatter.js";

/**
 * Integration test for the Registro de Skills (`definicion-skills`, tarea 8,
 * §7.E) against the REAL filesystem — `DEPS_FS` real, no doubles. NOT a TDD
 * exception (`tasks.md` línea 9): verifica el invariante negativo real
 * contra disco (RD-48) y puede ponerse en rojo por una divergencia real,
 * igual que la tarea 17 de `hito-3.0-a2a-servidor`.
 *
 * `mkdtempSync`, molde `turn-logger.test.ts`: el directorio temporal del
 * primer test nunca toca el `.claude/skills/` real de este repo. El segundo
 * y tercer test SÍ leen ese `.claude/skills/` real, a propósito y declarado
 * (design.md §7, la excepción explícita a "ningún test del suite por
 * defecto lee `.claude/skills/` del repo por accidente").
 *
 * El testigo de RD-48 (tercer test) copia el molde de
 * `run-tests.integration.test.ts:88-90`: `REPO_ROOT` se deriva de
 * `import.meta.url`, nunca de `process.cwd()`, para que sea un testigo
 * genuinamente independiente del que usa la producción (`DEFAULT_SKILLS_DIR`
 * resuelto por Node contra `process.cwd()`).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
/** `src/test/integration/` → raíz del repo, tres niveles arriba. */
const REPO_ROOT = resolve(__dirname, "../../..");

describe("Registro de Skills — integración con disco real (definicion-skills, tarea 8)", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("descubrirSkills con DEPS_FS real sobre un directorio temporal encuentra exactamente el paquete válido — el invariante negativo con disco real", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-skills-test-"));
    const base = join(tempDir, ".claude", "skills");

    // Paquete válido.
    mkdirSync(join(base, "demo"), { recursive: true });
    writeFileSync(
      join(base, "demo", "SKILL.md"),
      "---\nname: demo\ndescription: una skill de prueba para el test de integracion\n---\n",
    );

    // Subdirectorio sin SKILL.md — debe ir a omitidos, no a skills.
    mkdirSync(join(base, "vacio"), { recursive: true });

    // Directorio hermano FUERA de .claude/skills/ — nunca debe aparecer.
    mkdirSync(join(tempDir, "hermano-fuera"), { recursive: true });
    writeFileSync(
      join(tempDir, "hermano-fuera", "SKILL.md"),
      "---\nname: intruso\ndescription: no deberia aparecer nunca en el resultado\n---\n",
    );

    const resultado = descubrirSkills(base, DEPS_FS);

    expect(resultado.baseAusente).toBe(false);
    expect(resultado.skills.map((skill) => skill.nombre)).toEqual(["demo"]);
    expect(resultado.omitidos).toEqual(["vacio"]);
  });

  it("descubrirSkills() con los defaults reales, corrido desde la raíz del repo, encuentra citar-conocimiento validada por el parser real", () => {
    const resultado = descubrirSkills();

    expect(resultado.baseAusente).toBe(false);
    const citarConocimiento = resultado.skills.find(
      (skill) => skill.nombre === "citar-conocimiento",
    );
    expect(citarConocimiento).toBeDefined();
    expect(citarConocimiento?.descripcion.length).toBeGreaterThan(0);
    expect(citarConocimiento?.descripcion.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX_CHARS);
  });

  it("RD-48: process.cwd() y la raíz derivada de import.meta.url resuelven la MISMA ruta base — dos testigos independientes", () => {
    const rutaDesdeCwd = resolve(process.cwd(), DEFAULT_SKILLS_DIR);
    const rutaDesdeImportMetaUrl = resolve(REPO_ROOT, DEFAULT_SKILLS_DIR);

    expect(rutaDesdeCwd).toBe(rutaDesdeImportMetaUrl);
  });
});
