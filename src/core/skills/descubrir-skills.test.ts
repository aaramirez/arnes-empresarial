import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILLS_DIR,
  SKILL_FILE_NAME,
  descubrirSkills,
  type DescubrirSkillsDeps,
} from "./descubrir-skills.js";
import { SkillInvalidaError } from "./skill-frontmatter.js";

const BASE = ".claude/skills";

function skillMd(name: string, description = "una descripcion cualquiera"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n`;
}

describe("DEFAULT_SKILLS_DIR", () => {
  it("es exactamente '.claude/skills' — relativa, nunca absoluta ni derivada de process.cwd()", () => {
    expect(DEFAULT_SKILLS_DIR).toBe(".claude/skills");
    expect(DEFAULT_SKILLS_DIR.startsWith("/")).toBe(false);
    expect(DEFAULT_SKILLS_DIR).not.toContain(process.cwd());
  });
});

describe("SKILL_FILE_NAME", () => {
  it("es exactamente 'SKILL.md'", () => {
    expect(SKILL_FILE_NAME).toBe("SKILL.md");
  });
});

describe("descubrirSkills", () => {
  it("base ausente ⇒ { baseAusente: true, skills: [] }, no lanza", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => undefined,
      leerSkillMd: () => {
        throw new Error("no debería llamarse — la base no existe");
      },
    };

    const resultado = descubrirSkills(BASE, deps);

    expect(resultado.baseAusente).toBe(true);
    expect(resultado.skills).toEqual([]);
    expect(resultado.omitidos).toEqual([]);
  });

  it("base vacía ⇒ skills: [], baseAusente: false, no lanza", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => [],
      leerSkillMd: () => {
        throw new Error("no debería llamarse — la base está vacía");
      },
    };

    const resultado = descubrirSkills(BASE, deps);

    expect(resultado.baseAusente).toBe(false);
    expect(resultado.skills).toEqual([]);
    expect(resultado.omitidos).toEqual([]);
  });

  it("subdirectorio sin SKILL.md ⇒ va a omitidos, no a skills, no lanza", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["vacio"],
      leerSkillMd: () => undefined,
    };

    const resultado = descubrirSkills(BASE, deps);

    expect(resultado.skills).toEqual([]);
    expect(resultado.omitidos).toEqual(["vacio"]);
  });

  it("SKILL.md ilegible ⇒ SkillInvalidaError con el motivo del error original", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["rota"],
      leerSkillMd: () => {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    };

    let error: unknown;
    try {
      descubrirSkills(BASE, deps);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(SkillInvalidaError);
    expect((error as SkillInvalidaError).motivo).toBe("permission denied");
  });

  it("'name' del frontmatter distinto del directorio ⇒ SkillInvalidaError (ADR 110 pto 4)", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["mi-carpeta"],
      leerSkillMd: () => skillMd("otro-nombre"),
    };

    expect(() => descubrirSkills(BASE, deps)).toThrow(SkillInvalidaError);
  });

  it("un SKILL.md inválido según el ADR 110 también aborta (propaga el SkillInvalidaError del parser)", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["con-campo-prohibido"],
      leerSkillMd: () => "---\nname: con-campo-prohibido\ndescription: x\nallowed-tools: Read\n---\n",
    };

    expect(() => descubrirSkills(BASE, deps)).toThrow(SkillInvalidaError);
  });

  it("orden estable: el resultado va siempre por nombre asc, nunca el orden del fs", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["zeta", "alfa", "medio"],
      leerSkillMd: (_base, directorio) => skillMd(directorio),
    };

    const resultado = descubrirSkills(BASE, deps);

    expect(resultado.skills.map((s) => s.nombre)).toEqual(["alfa", "medio", "zeta"]);
  });

  it("paquete válido ⇒ nombre y descripción vienen del frontmatter, recortados", () => {
    const deps: DescubrirSkillsDeps = {
      listarSubdirectorios: () => ["demo"],
      leerSkillMd: () => skillMd("demo", "hace algo util"),
    };

    const resultado = descubrirSkills(BASE, deps);

    expect(resultado.skills).toEqual([{ nombre: "demo", descripcion: "hace algo util" }]);
  });
});
