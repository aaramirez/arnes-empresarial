/**
 * Solicitudes internas de empleado (vacaciones, gastos, ...) — ADR 43 de
 * `hito-2.0-delegacion-subagentes` (tabla propia, con su `caso_id`, SIN FK a
 * `proyectos`) y ADR 49 (DDL columna por columna, en `design.md` §6.2).
 *
 * `caso_id` es `NOT NULL REFERENCES casos(id)` MÁS un índice UNIQUE: `casos`
 * nunca se poda, así que la FK es segura (mismo criterio que
 * `registro_acciones_empleado.caso_id`, `0005`). El UNIQUE hace ESTRUCTURAL
 * el invariante 1 solicitud ↔ 1 caso que la transacción de alta crea, en vez
 * de dejarlo como disciplina.
 *
 * ★ `solicitante_id` y `resuelta_por` son NOT NULL/nullable respectivamente,
 *   pero SIN FK a `credenciales_empleado` ★: copia exacta del razonamiento de
 *   `registro_acciones_empleado.empleado_id` (`0005`) — la única baja de
 *   empleado que el repo soporta hoy es borrar su fila de credencial (ADR
 *   33), y una FK haría que esa baja falle o arrastre la solicitud. Una
 *   solicitud tiene que SOBREVIVIR al empleado que la pidió.
 *
 * `tipo`/`estado` quedan TEXT abiertos SIN CHECK — mismo criterio que
 * `casos.estado`/`ventas.estado`/`actividades.estado`: el vocabulario
 * canónico vive en el núcleo (`solicitudes-contract.ts`), el SQL no lo
 * conoce.
 *
 * `dictamen`/`dictaminada_at` NULLABLE en par: `NULL` = el validador no
 * corrió o falló, misma semántica que `delegaciones.resultado` — la ausencia
 * es la traza del fallo, no un bug.
 *
 * `resuelta_por`/`resuelta_at` NULLABLE, sin FK: sólo las escribe el CAS de
 * `/aprobar-solicitud`/`/rechazar-solicitud`.
 *
 * SIN columna `monto` y SIN `proyecto_id`, a propósito — es el punto entero
 * del ADR 43; ninguna solicitud de este hito lleva una cantidad de dinero
 * como columna propia.
 *
 * UN solo índice por `estado`: hay un único patrón de lectura real — listar
 * pendientes para `/aprobar-solicitud` sin id — espejo exacto de
 * `listarReembolsosPendientes`. Índices por `solicitante_id` o `created_at`
 * se agregan cuando exista una lectura que los pida (criterio de `0004`/`0005`).
 */
export const migration0008SolicitudesInternas = {
  id: "0008_solicitudes_internas",
  sql: `
CREATE TABLE IF NOT EXISTS solicitudes_internas (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  solicitante_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  detalle TEXT NOT NULL,
  estado TEXT NOT NULL,
  dictamen TEXT,
  dictaminada_at TEXT,
  resuelta_por TEXT,
  resuelta_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_caso ON solicitudes_internas(caso_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_internas(estado);
`,
};
