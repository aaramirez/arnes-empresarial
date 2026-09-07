/**
 * Delegaciones a subagentes (ADR 48 de `hito-2.0-delegacion-subagentes`).
 * Una fila por invocación de un rol (`planner`/`developer`/`reviewer`/
 * `validador-solicitudes`), escrita ANTES de invocar y completada DESPUÉS.
 *
 * ★ `sesion_subagente_id` NULLABLE ★: es el único modo de que "registrar
 * antes de invocar" sea ejecutable bajo `foreign_keys = ON` (`db.ts:33`).
 * `sesiones_agente.sdk_session_id` es `NOT NULL` (`0001`) y ese valor sólo
 * existe DESPUÉS de que el SDK responde — con una FK `NOT NULL` literal, el
 * `INSERT` previo a la invocación fallaría siempre con
 * `SQLITE_CONSTRAINT_FOREIGNKEY`. Se completa junto con `resultado`, en la
 * MISMA transacción que inserta la fila de `sesiones_agente` del subagente
 * (repository.ts, `completarDelegacion`).
 *
 * ★ `sesion_padre_id` NULLABLE ★: la delegación la decide el Despachador, no
 * un turno del modelo — la cabeza de una cadena determinista no tiene sesión
 * padre. `NULL` acá significa algo ("esta delegación la originó el arnés,
 * no un agente"): para Developer y Reviewer la columna sí se llena con la
 * sesión del rol anterior, así que codifica la topología de la cadena.
 *
 * `caso_id`/`agent_id` son adiciones respecto del DDL literal del Plan: con
 * `sesion_subagente_id` en `NULL` (justo cuando falla, que es cuando la
 * trazabilidad importa), nada más en la fila dice a qué caso ni a qué rol
 * corresponde. `agent_id` es `TEXT NOT NULL` SIN FK — no hay tabla de
 * agentes, el registro vive en `definitions.ts` (mismo criterio que
 * `sesiones_agente.agent_id`, `0001`).
 *
 * DESVIACIÓN respecto del SQL del plan (líneas 298-306), ver ADR 48 completo
 * en `design.md` §6.1: dos columnas agregadas, dos `NOT NULL` relajados.
 * Checkpoint: APROBADA.
 *
 * UN solo índice, por `caso_id`: es el único patrón de lectura real — "las
 * delegaciones de este caso, en orden" — que alimenta la evidencia de
 * `docs/progreso/`. Criterio de `0004`/`0005`.
 */
export const migration0007Delegaciones = {
  id: "0007_delegaciones",
  sql: `
CREATE TABLE IF NOT EXISTS delegaciones (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  agent_id TEXT NOT NULL,
  sesion_padre_id TEXT REFERENCES sesiones_agente(id),
  sesion_subagente_id TEXT REFERENCES sesiones_agente(id),
  tarea_delegada TEXT NOT NULL,
  resultado TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegaciones_caso ON delegaciones(caso_id);
`,
};
