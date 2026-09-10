import { descubrirSkills, type DescubrirSkillsDeps } from "./descubrir-skills.js";

/** Sentinela de correlación para logs sin `caso`, molde de COMANDO_LOG_CORRELATION_ID / WEBHOOK_LOG_CORRELATION_ID. */
export const SKILLS_LOG_CORRELATION_ID = "arranque-skills";

/**
 * Memo de proceso — puebla el resultado exitoso de la primera llamada sin
 * argumentos. Sin setter público (ADR 115 pto 3): la única forma de
 * modificarla es a través de `listarSkillsHabilitadas()`.
 */
let memo: readonly string[] | undefined;

/**
 * Nombres canónicos habilitados para un turno. SIN argumentos: usa (y
 * puebla) la memo de proceso — es la forma que `toQueryOptions` invoca como
 * default. CON cualquier argumento: no lee ni escribe la memo (ADR 115 pto
 * 5). Sólo memoiza el resultado exitoso: si `descubrirSkills` lanza, la
 * próxima llamada reintenta.
 */
export function listarSkillsHabilitadas(
  base?: string,
  deps?: DescubrirSkillsDeps,
): readonly string[] {
  const usaMemo = base === undefined && deps === undefined;

  if (usaMemo && memo !== undefined) {
    return memo;
  }

  const nombres = descubrirSkills(base, deps).skills.map((skill) => skill.nombre);

  if (usaMemo) {
    memo = nombres;
  }

  return nombres;
}
