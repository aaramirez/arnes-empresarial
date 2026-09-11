/** Tope portable del Agent Skills spec (ADR 110 pto 3). NO el 1536 de Claude Code. */
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;

/** Whitelist del ADR 110 pto 2. Agregar un campo acá es una decisión de ADR, no un detalle. */
export const CAMPOS_PERMITIDOS = ["name", "description"] as const;

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

/** Rechazo del cargador. `bootstrapHarness` la envuelve en HarnessBootstrapError (ADR 111 pto 1-2). */
export class SkillInvalidaError extends Error {
  readonly ruta: string;
  readonly motivo: string;

  constructor(ruta: string, motivo: string) {
    super(`SKILL.md inválido en ${ruta}: ${motivo}`);
    this.name = "SkillInvalidaError";
    this.ruta = ruta;
    this.motivo = motivo;
  }
}

/**
 * Parsea el frontmatter de un SKILL.md. TOTAL en su entrada (cualquier string
 * es aceptable como argumento) y ESTRICTA en su resultado: lanza
 * SkillInvalidaError ante frontmatter ausente/no cerrado, línea sin
 * `clave: valor`, campo fuera de CAMPOS_PERMITIDOS, `name` o `description`
 * ausentes o en blanco, o `description` > SKILL_DESCRIPTION_MAX_CHARS. `ruta`
 * viaja sólo para el mensaje.
 */
export function parsearSkillFrontmatter(contenido: string, ruta: string): SkillFrontmatter {
  const lineas = contenido.split(/\r\n|\r|\n/);

  if ((lineas[0] ?? "").trim() !== "---") {
    throw new SkillInvalidaError(ruta, "falta el delimitador '---' inicial del frontmatter");
  }

  let indiceCierre = -1;
  for (let i = 1; i < lineas.length; i++) {
    if ((lineas[i] ?? "").trim() === "---") {
      indiceCierre = i;
      break;
    }
  }
  if (indiceCierre === -1) {
    throw new SkillInvalidaError(ruta, "falta el delimitador '---' de cierre del frontmatter");
  }

  const campos = new Map<string, string>();
  for (let i = 1; i < indiceCierre; i++) {
    const linea = lineas[i] ?? "";
    const indiceDosPuntos = linea.indexOf(":");
    if (indiceDosPuntos === -1) {
      throw new SkillInvalidaError(ruta, `línea sin 'clave: valor': "${linea}"`);
    }

    const clave = linea.slice(0, indiceDosPuntos).trim();
    const valor = linea.slice(indiceDosPuntos + 1).trim();
    if (!CAMPOS_PERMITIDOS.includes(clave as (typeof CAMPOS_PERMITIDOS)[number])) {
      throw new SkillInvalidaError(ruta, `campo no permitido: '${clave}'`);
    }

    campos.set(clave, valor);
  }

  const name = campos.get("name") ?? "";
  const description = campos.get("description") ?? "";

  if (name.trim() === "") {
    throw new SkillInvalidaError(ruta, "el campo 'name' es obligatorio y no puede estar en blanco");
  }
  if (description.trim() === "") {
    throw new SkillInvalidaError(
      ruta,
      "el campo 'description' es obligatorio y no puede estar en blanco",
    );
  }
  if (description.length > SKILL_DESCRIPTION_MAX_CHARS) {
    throw new SkillInvalidaError(
      ruta,
      `el campo 'description' supera el tope de ${SKILL_DESCRIPTION_MAX_CHARS} caracteres`,
    );
  }

  return { name, description };
}
