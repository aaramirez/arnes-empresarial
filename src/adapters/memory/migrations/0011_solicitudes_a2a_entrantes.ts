/**
 * Solicitudes A2A entrantes (Hito 7, tarea 6, design.md §7.1, ADR 89 pto 4 +
 * regla de numeración del ADR 63). Hermana de `delegaciones_a2a` (`0010`)
 * pero de la dirección opuesta del protocolo: `0010` registra tareas que
 * NOSOTROS delegamos afuera, esta tabla registra tareas que un agente
 * externo nos delega a NOSOTROS. Sin FK entre ambas: son direcciones
 * opuestas del mismo protocolo, sin relación entre filas.
 *
 * `a2a_task_id` es `NOT NULL UNIQUE`: lo asignamos nosotros (`newTaskId`) y
 * es la clave por la que `GetTask`/`CancelTask` buscan. Sin índice único el
 * lookup sería un scan y la unicidad sería una convención en vez de un
 * invariante.
 *
 * `agente_externo_url` NULLABLE, hoy SIEMPRE `NULL`: relajada respecto del
 * Plan. El protocolo A2A v1.0.0 no transporta la identidad del emisor
 * (ADR 89), así que no hay nada verdadero que poner ahí todavía.
 *
 * `origen_transporte` es `TEXT NOT NULL`: `socket.remoteAddress`, o
 * `"desconocido"`. No es identidad de agente y el DDL no pretende que lo
 * sea.
 *
 * `caso_id` NULLABLE, `REFERENCES casos(id)`: `NULL` sólo en `REJECTED`
 * (sin caso, ADR 90 pto 4). Todas las demás filas lo tienen.
 *
 * `mensaje_recibido` es `TEXT NOT NULL`: el tope `MAX_SOLICITUD_A2A_CHARS`
 * lo pone el núcleo, no SQL — mismo criterio que `tarea_delegada`,
 * `solicitudes_internas.detalle` y `propuestas_cambio.patch`.
 *
 * `estado` es `TEXT NOT NULL`, SIN `CHECK` — valores `TASK_STATE_*` crudos
 * (ADR 71 pto 5). El vocabulario canónico vive en el núcleo, el SQL no lo
 * conoce. Molde literal de `0010`.
 *
 * `resultado` NULLABLE: sólo se llena en `TASK_STATE_COMPLETED`. Sin ella,
 * `GetTask` no tendría nada que devolver (ADR 87).
 *
 * Un solo índice, sobre `caso_id`: era el único patrón de lectura real al
 * momento de esta migración — la evidencia de `docs/progreso/` y el volcado
 * por caso (`listSolicitudesA2AEntrantesPorCaso`, §7.2). La migración 0012
 * agrega el índice sobre `estado` cuando comando-visibilidad-a2a-entrante
 * introduce el filtro por estado.
 */
export const migration0011SolicitudesA2AEntrantes = {
  id: "0011_solicitudes_a2a_entrantes",
  sql: `
CREATE TABLE IF NOT EXISTS solicitudes_a2a_entrantes (
  id                  TEXT PRIMARY KEY,
  a2a_task_id         TEXT NOT NULL UNIQUE,
  agente_externo_url  TEXT,
  origen_transporte   TEXT NOT NULL,
  caso_id             TEXT REFERENCES casos(id),
  mensaje_recibido    TEXT NOT NULL,
  estado              TEXT NOT NULL,
  resultado           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_caso ON solicitudes_a2a_entrantes(caso_id);
`,
};
