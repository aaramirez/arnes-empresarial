/**
 * Delegaciones externas por A2A (Hito 6, tarea 9, design.md §7.1, ADR 74
 * pto 4 + regla de numeración del ADR 63). Hermana de `delegaciones`
 * (`0007`) pero sin FK a ella: un agente externo nunca tiene fila en
 * `sesiones_agente` — son hermanas por `caso_id`, no por delegación interna.
 *
 * `destino_clave` es `NOT NULL` y **no** está en el DDL original del Plan:
 * sin ella, `agente_externo_url` es la única pista y un `localhost:PUERTO`
 * no dice nada — mismo argumento con que el ADR 48 agregó `caso_id`/`agent_id`
 * a `0007`.
 *
 * `agente_externo_url` nace con la URL base del destino y termina con el
 * endpoint efectivo resuelto del Agent Card (ADR 80 pto 1) — es evidencia de
 * contra qué corrió, no de qué estaba configurado hoy.
 *
 * `tarea_delegada` es `TEXT NOT NULL`: el tope `TAREA_DELEGADA_MAX_CHARS` lo
 * pone el núcleo, no SQL — mismo criterio que `solicitudes_internas.detalle`
 * y `propuestas_cambio.patch`.
 *
 * `a2a_task_id` NULLABLE: solo existe DESPUÉS del `SendMessage` — se
 * registra la fila antes de invocar, idéntico a
 * `delegaciones.sesion_subagente_id` (ADR 48).
 *
 * `estado` es `TEXT NOT NULL`, SIN `CHECK` — valores `TASK_STATE_*` crudos
 * (ADR 71 pto 5). Mismo criterio que todo el esquema: el vocabulario
 * canónico vive en el núcleo, el SQL no lo conoce.
 *
 * `resultado` NULLABLE: solo se llena en `TASK_STATE_COMPLETED`.
 *
 * Un solo índice, a diferencia de `0009` (que tiene dos): hay un único
 * patrón de lectura real — la evidencia de `docs/progreso/` y el volcado por
 * caso. Ninguna pantalla ni comando filtra por `estado`.
 */
export const migration0010DelegacionesA2A = {
  id: "0010_delegaciones_a2a",
  sql: `
CREATE TABLE IF NOT EXISTS delegaciones_a2a (
  id                  TEXT PRIMARY KEY,
  caso_id             TEXT NOT NULL REFERENCES casos(id),
  destino_clave       TEXT NOT NULL,
  agente_externo_url  TEXT NOT NULL,
  tarea_delegada      TEXT NOT NULL,
  a2a_task_id         TEXT,
  estado              TEXT NOT NULL,
  resultado           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegaciones_a2a_caso ON delegaciones_a2a(caso_id);
`,
};
