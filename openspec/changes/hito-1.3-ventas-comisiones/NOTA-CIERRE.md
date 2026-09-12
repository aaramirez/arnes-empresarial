# Nota de cierre — Hito 4 (v1.3.0) no tagueado

**Fecha:** 2026-09-11
**Autor:** checkpoint humano (registrado retroactivamente a pedido del desarrollador)

## Qué pasó

Las tareas 1-30 de [`tasks.md`](tasks.md) se implementaron completas, con commit propio cada una (`Hito 4, tarea N`, ver `git log v1.2.0..v1.4.0`). La tarea 31 (verificación manual end-to-end, guion de 20 pasos, evidencia para `docs/progreso/v1.3-ventas-comisiones/`) **no se ejecutó como cierre independiente de este hito**: el checkpoint humano determinó que el resultado no cumplía el estándar esperado del Reviewer para cerrarlo como `v1.3.0`.

En consecuencia:

- No existe tag `v1.3.0`.
- No existe `docs/progreso/v1.3-ventas-comisiones/`.
- No existe `verify-report.md` ni `apply-progress.md` en esta carpeta de change.

## Qué pasó con el entregable

El código de ventas/comisiones (`src/core/ventas/`, `src/adapters/web/`, `src/adapters/notificaciones/`, migración `0004`) **no se descartó** — quedó en el árbol y su entregable funcional terminó demostrado como parte de la evidencia del hito siguiente: `docs/progreso/v1.4-tui-canal-empleado/README.md` ("Paso 2 — seed real de ventas", líneas 46-163).

Este change (`hito-1.3-ventas-comisiones`) queda huérfano a propósito: no se archiva como si hubiera cerrado, para no borrar el rastro de que el cierre formal se descartó y por qué.

## Para quien retome esto

Si en algún momento se decide cerrar `v1.3.0` formalmente (tag + `docs/progreso/`), correr primero `sdd-verify` contra este `tasks.md`, los specs y `design.md` — no asumir que la verificación pendiente sigue siendo la tarea 31 tal como está escrita, dado que parte de su alcance (seed de ventas) ya se ejercitó en `v1.4.0`.
