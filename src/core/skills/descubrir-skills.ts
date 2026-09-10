/**
 * Descubrimiento de skills en disco (ADR 109). Único módulo del Registro de
 * Skills con I/O real — la frontera vive en `DescubrirSkillsDeps`/`DEPS_FS`;
 * fuera de esa frontera este archivo no compone rutas de filesystem, solo
 * recibe nombres de directorio y devuelve nombres de skill (ADR 109 pto 5).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsearSkillFrontmatter, SkillInvalidaError } from "./skill-frontmatter.js";

/** Ruta RELATIVA, resuelta contra process.cwd() por Node — igual que "data/harness.log" (ADR 109 pto 2). */
export const DEFAULT_SKILLS_DIR = ".claude/skills";
export const SKILL_FILE_NAME = "SKILL.md";

export interface SkillDescubierta {
  readonly nombre: string; // === directorio, garantizado por el ADR 110 pto 4
  readonly descripcion: string; // no se emite al SDK; viaja para el log y para el README
}

/** ÚNICA frontera con el filesystem. `undefined` significa "no existe", nunca "falló". */
export interface DescubrirSkillsDeps {
  /** Subdirectorios de `base`, o `undefined` si `base` no existe. Cualquier otro error de I/O: lanza. */
  readonly listarSubdirectorios: (base: string) => readonly string[] | undefined;
  /** Contenido del SKILL.md de `directorio`, o `undefined` si no hay SKILL.md. Cualquier otro error: lanza. */
  readonly leerSkillMd: (base: string, directorio: string) => string | undefined;
}

export interface ResultadoDescubrimiento {
  readonly baseAusente: boolean;
  /** Orden ESTABLE por `nombre` ascendente, nunca el orden del filesystem (ADR 111 / test D). */
  readonly skills: readonly SkillDescubierta[];
  /** Subdirectorios sin SKILL.md, para el log. No es un error. */
  readonly omitidos: readonly string[];
}

function listarSubdirectoriosReal(base: string): readonly string[] | undefined {
  let entradas;
  try {
    entradas = readdirSync(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name);
}

function leerSkillMdReal(base: string, directorio: string): string | undefined {
  try {
    return readFileSync(join(base, directorio, SKILL_FILE_NAME), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export const DEPS_FS: DescubrirSkillsDeps = {
  listarSubdirectorios: listarSubdirectoriosReal,
  leerSkillMd: leerSkillMdReal,
};

/** Lanza SkillInvalidaError según la tabla del ADR 111. Nunca lanza por base ausente ni por carpeta vacía. */
export function descubrirSkills(
  base: string = DEFAULT_SKILLS_DIR,
  deps: DescubrirSkillsDeps = DEPS_FS,
): ResultadoDescubrimiento {
  const directorios = deps.listarSubdirectorios(base);
  if (directorios === undefined) {
    return { baseAusente: true, skills: [], omitidos: [] };
  }

  const skills: SkillDescubierta[] = [];
  const omitidos: string[] = [];

  for (const directorio of directorios) {
    const ruta = `${base}/${directorio}/${SKILL_FILE_NAME}`;

    let contenido: string | undefined;
    try {
      contenido = deps.leerSkillMd(base, directorio);
    } catch (error) {
      throw new SkillInvalidaError(ruta, error instanceof Error ? error.message : String(error));
    }

    if (contenido === undefined) {
      omitidos.push(directorio);
      continue;
    }

    const frontmatter = parsearSkillFrontmatter(contenido, ruta);
    if (frontmatter.name !== directorio) {
      throw new SkillInvalidaError(
        ruta,
        `el campo 'name' ('${frontmatter.name}') no coincide con el nombre del directorio ('${directorio}')`,
      );
    }

    skills.push({ nombre: frontmatter.name, descripcion: frontmatter.description });
  }

  const skillsOrdenadas = [...skills].sort((a, b) => a.nombre.localeCompare(b.nombre));

  return { baseAusente: false, skills: skillsOrdenadas, omitidos };
}
