import {
  descubrirSkills,
  type DescubrirSkillsDeps,
  type ResultadoDescubrimiento,
} from "./descubrir-skills.js";

/** Sentinela de correlación para logs sin `caso`, molde de COMANDO_LOG_CORRELATION_ID / WEBHOOK_LOG_CORRELATION_ID. */
export const SKILLS_LOG_CORRELATION_ID = "arranque-skills";

/**
 * Memo de proceso — puebla el resultado exitoso de la primera llamada sin
 * argumentos. Sin setter público (ADR 115 pto 3): la única forma de
 * modificarla es a través de `descubrirSkillsHabilitadas()`/
 * `listarSkillsHabilitadas()`.
 */
let memo: ResultadoDescubrimiento | undefined;

/**
 * Descubrimiento memoizado del Registro de Skills — la MISMA memo de
 * proceso que consume `listarSkillsHabilitadas()`. SIN argumentos: usa (y
 * puebla) la memo. CON cualquier argumento: no lee ni escribe la memo (ADR
 * 115 pto 5). Sólo memoiza el resultado exitoso: si `descubrirSkills`
 * lanza, la próxima llamada reintenta.
 *
 * `bootstrapHarness` (arranque) llama a esta función como su `descubrir`
 * por default — no a `descubrirSkills` directo — para que el escaneo que
 * valida el arranque (ADR 111) sea el MISMO que después consume
 * `toQueryOptions` en el primer turno (Reviewer finding 1, `definicion-
 * skills`): sin esto, el arranque validaba un escaneo que nadie
 * consumía, y el turno repetía un segundo escaneo sin la protección de
 * `HarnessBootstrapError`.
 */
export function descubrirSkillsHabilitadas(
  base?: string,
  deps?: DescubrirSkillsDeps,
): ResultadoDescubrimiento {
  const usaMemo = base === undefined && deps === undefined;

  if (usaMemo && memo !== undefined) {
    return memo;
  }

  const resultado = descubrirSkills(base, deps);

  if (usaMemo) {
    memo = resultado;
  }

  return resultado;
}

/** Nombres canónicos habilitados para un turno — proyección de `descubrirSkillsHabilitadas()` sobre la misma memo. */
export function listarSkillsHabilitadas(
  base?: string,
  deps?: DescubrirSkillsDeps,
): readonly string[] {
  return descubrirSkillsHabilitadas(base, deps).skills.map((skill) => skill.nombre);
}
