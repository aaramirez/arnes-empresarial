/**
 * Propuestas de cambio HITL producidas por el Developer en un worktree
 * aislado (ADR 58 de `hito-2.1-escritura-delegada`, capability
 * `propuesta-cambio-hitl`). Cada fila es un patch capturado con
 * `git diff --binary` dentro del worktree, evaluado contra `PATCH_MAX_BYTES`
 * en el núcleo, y resuelto por un humano vía `/aplicar-propuesta` o
 * `/descartar-propuesta` en la TUI.
 *
 * `estado` es TEXT NOT NULL, SIN CHECK — mismo criterio que `casos.estado`,
 * `ventas.estado`, `actividades.estado` y `solicitudes_internas.estado`: el
 * vocabulario canónico vive en el núcleo (`propuestas-contract.ts`), el SQL
 * no lo conoce. TRES valores reales, no cuatro (RD-12 del checkpoint
 * humano): `pendiente_aprobacion_humana` / `aplicada` / `descartada`. Se negó
 * a propósito un cuarto valor `no_aplicable`: ningún camino de código lo
 * escribe — un conflicto de `git apply --check` deja la fila intacta en
 * `pendiente_aprobacion_humana`, y un patch fuera de tope no crea fila.
 *
 * ★ `delegacion_id` NULLABLE con FK ★ — precedente ADR 48, ya aprobado en
 * `0007_delegaciones.ts`: el patch ES la evidencia, y la evidencia no se
 * pierde por una constraint. `NULL` significa "esta propuesta no la originó
 * una fila de `delegaciones`", y sigue siendo igualmente persistible.
 *
 * `caso_id` es `NOT NULL REFERENCES casos(id)`: `casos` nunca se poda (mismo
 * criterio que `registro_acciones_empleado.caso_id`, `0005`).
 *
 * `base_commit`/`rama_worktree` NOT NULL: sin `base_commit` un `git apply`
 * que falla es indiagnosticable ("la base se movió" deja de ser una
 * respuesta, R13); `rama_worktree` correlaciona la fila con lo que el
 * barrido de huérfanos (ADR 57) va a borrar.
 *
 * `patch` es `TEXT NOT NULL` con los bytes exactos. El tope de 64 KB NO se
 * expresa en SQL — SQLite no lo aplicaría — lo pone el núcleo
 * (`PATCH_MAX_BYTES`), mismo criterio que `solicitudes_internas.detalle`.
 * `patch_bytes`/`archivos`/`lineas_agregadas`/`lineas_eliminadas` son
 * NOT NULL y calculadas por `resumirPatch` (pura) para que el eco y el
 * listado no tengan que re-parsear 64 KB por fila.
 *
 * `motivo` nullable: en este hito lo escribe sólo `/descartar-propuesta`.
 * `resuelta_por`/`resuelta_at` nullable y SIN FK — mismo precedente que
 * `0005`/`0008`: una propuesta tiene que sobrevivir a la baja del empleado
 * que la resolvió (la única baja soportada hoy es borrar la credencial,
 * ADR 33).
 *
 * DOS índices, a diferencia de `0007` (que tiene uno solo): hay dos patrones
 * de lectura reales y distintos — `/ver-propuesta` sin argumento filtra por
 * `estado`, y la evidencia de `docs/progreso/` lee por `caso_id`.
 *
 * ADR 63 — la misma migración agrega `propuesta_id` a
 * `registro_acciones_empleado`, DESPUÉS del `CREATE TABLE` de arriba (la
 * tabla referida tiene que existir primero). Hallazgo real: una fila de
 * auditoría de `/aplicar-propuesta` no puede reusar `venta_id` (la FK a
 * `ventas` fallaría) ni `caso_id` (la relación caso↔propuesta es 1:N, a
 * diferencia de `solicitudes_internas` que tiene `UNIQUE(caso_id)`) — sin
 * una columna propia, la auditoría no puede decir CUÁL propuesta se aplicó.
 * SQLite acepta `ADD COLUMN ... REFERENCES` porque el default es `NULL`.
 */
export const migration0009PropuestasCambio = {
  id: "0009_propuestas_cambio",
  sql: `
CREATE TABLE IF NOT EXISTS propuestas_cambio (
  id                TEXT PRIMARY KEY,
  caso_id           TEXT NOT NULL REFERENCES casos(id),
  delegacion_id     TEXT REFERENCES delegaciones(id),
  base_commit       TEXT NOT NULL,
  rama_worktree     TEXT NOT NULL,
  patch             TEXT NOT NULL,
  patch_bytes       INTEGER NOT NULL,
  archivos          INTEGER NOT NULL,
  lineas_agregadas  INTEGER NOT NULL,
  lineas_eliminadas INTEGER NOT NULL,
  estado            TEXT NOT NULL,
  motivo            TEXT,
  resuelta_por      TEXT,
  resuelta_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_propuestas_estado ON propuestas_cambio(estado);
CREATE INDEX IF NOT EXISTS idx_propuestas_caso   ON propuestas_cambio(caso_id);

ALTER TABLE registro_acciones_empleado ADD COLUMN propuesta_id TEXT REFERENCES propuestas_cambio(id);
`,
};
