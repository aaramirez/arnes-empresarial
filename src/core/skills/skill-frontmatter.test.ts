import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_PERMITIDOS,
  SKILL_DESCRIPTION_MAX_CHARS,
  SkillInvalidaError,
  parsearSkillFrontmatter,
  type SkillFrontmatter,
} from "./skill-frontmatter.js";

const RUTA = "/repo/.claude/skills/demo/SKILL.md";

function frontmatter(cuerpo: string): string {
  return `---\n${cuerpo}\n---\n`;
}

function capturarError(fn: () => unknown): SkillInvalidaError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SkillInvalidaError) return error;
    throw error;
  }
  throw new Error("se esperaba que fn() lanzara SkillInvalidaError");
}

describe("SKILL_DESCRIPTION_MAX_CHARS", () => {
  it("es 1024, el tope portable del Agent Skills spec, no el 1536 de Claude Code", () => {
    expect(SKILL_DESCRIPTION_MAX_CHARS).toBe(1024);
  });
});

describe("CAMPOS_PERMITIDOS", () => {
  it("es exactamente ['name', 'description']", () => {
    expect(CAMPOS_PERMITIDOS).toEqual(["name", "description"]);
  });
});

describe("parsearSkillFrontmatter", () => {
  it("frontmatter mínimo válido devuelve { name, description } recortados", () => {
    const resultado: SkillFrontmatter = parsearSkillFrontmatter(
      frontmatter("name:  mi-skill  \ndescription:  hace algo  "),
      RUTA,
    );

    expect(resultado).toEqual({ name: "mi-skill", description: "hace algo" });
  });

  it("sin '---' inicial ⇒ SkillInvalidaError con la ruta en el mensaje", () => {
    const error = capturarError(() => parsearSkillFrontmatter("name: x\ndescription: y", RUTA));

    expect(error.ruta).toBe(RUTA);
    expect(error.message).toContain(RUTA);
  });

  it("'---' sin cerrar ⇒ SkillInvalidaError con la ruta en el mensaje", () => {
    const error = capturarError(() =>
      parsearSkillFrontmatter("---\nname: x\ndescription: y", RUTA),
    );

    expect(error.ruta).toBe(RUTA);
    expect(error.message).toContain(RUTA);
  });

  it("línea sin ':' ⇒ SkillInvalidaError con la ruta en el mensaje", () => {
    const error = capturarError(() =>
      parsearSkillFrontmatter(frontmatter("name: x\nlinea-sin-dos-puntos"), RUTA),
    );

    expect(error.ruta).toBe(RUTA);
    expect(error.message).toContain(RUTA);
  });

  it("'allowed-tools' presente ⇒ SkillInvalidaError (guard mecánico del límite 2 del ADR 106)", () => {
    expect(() =>
      parsearSkillFrontmatter(frontmatter("name: x\ndescription: y\nallowed-tools: Read"), RUTA),
    ).toThrow(SkillInvalidaError);
  });

  it.each(["when_to_use", "model", "license", "metadata"])(
    "campo '%s' fuera de la whitelist ⇒ SkillInvalidaError",
    (campo) => {
      expect(() =>
        parsearSkillFrontmatter(frontmatter(`name: x\ndescription: y\n${campo}: algo`), RUTA),
      ).toThrow(SkillInvalidaError);
    },
  );

  it("'name' ausente ⇒ SkillInvalidaError", () => {
    expect(() => parsearSkillFrontmatter(frontmatter("description: y"), RUTA)).toThrow(
      SkillInvalidaError,
    );
  });

  it("'name' en blanco ⇒ SkillInvalidaError", () => {
    expect(() => parsearSkillFrontmatter(frontmatter("name:   \ndescription: y"), RUTA)).toThrow(
      SkillInvalidaError,
    );
  });

  it("'description' ausente ⇒ SkillInvalidaError", () => {
    expect(() => parsearSkillFrontmatter(frontmatter("name: x"), RUTA)).toThrow(
      SkillInvalidaError,
    );
  });

  it("'description' en blanco ⇒ SkillInvalidaError", () => {
    expect(() => parsearSkillFrontmatter(frontmatter("name: x\ndescription:   "), RUTA)).toThrow(
      SkillInvalidaError,
    );
  });

  it("'description' de exactamente 1024 caracteres acepta", () => {
    const descripcion = "a".repeat(1024);

    const resultado = parsearSkillFrontmatter(
      frontmatter(`name: x\ndescription: ${descripcion}`),
      RUTA,
    );

    expect(resultado.description).toHaveLength(1024);
  });

  it("'description' de 1025 caracteres rechaza (el borde del ADR 110 pto 3, no 1536)", () => {
    const descripcion = "a".repeat(1025);

    expect(() =>
      parsearSkillFrontmatter(frontmatter(`name: x\ndescription: ${descripcion}`), RUTA),
    ).toThrow(SkillInvalidaError);
  });
});

describe("skill-frontmatter.ts source", () => {
  it("has no import statements — the module must be pure and stand-alone (ADR 110)", () => {
    const sourcePath = fileURLToPath(new URL("./skill-frontmatter.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
