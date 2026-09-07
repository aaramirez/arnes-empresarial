> **DELTA — aditiva sobre `openspec/changes/hito-2.0-delegacion-subagentes/specs/revision-pr-por-roles/spec.md`.** Ninguno de los cuatro requirements existentes ahí ("El veredicto final lo emite únicamente el Reviewer", "Los pasos 6-9 de `runActivityTurn` no cambian de forma", "Tres filas de `delegaciones` por PR revisado", "El entregable de Hito 3 corre sin reescribir el Despachador") cambia de texto — por eso esta delta usa `## ADDED Requirements`, no `MODIFIED`. Lo que agrega `v2.1.0` es un requirement nuevo sobre **qué es** el material que el Reviewer consume cuando la escritura delegada está activa (ADR 59), que no existía como pregunta en `v2.0.0` porque el Developer producía únicamente texto.

# Delta for Revisión de PR por Roles

## ADDED Requirements

### Requirement: El material del Reviewer es el patch persistido cuando la escritura delegada está activa

Con `HARNESS_ESCRITURA_DELEGADA` activo, el eslabón del Developer de la cadena Planner → Developer → Reviewer SHALL producir un diff capturado y persistido en `propuestas_cambio` (capability `propuesta-cambio-hitl`), en lugar de únicamente texto en prosa. El material que el Reviewer consume para emitir su veredicto SHALL ser el patch leído de vuelta de esa persistencia (capability `escritura-aislada-worktree` para la captura, `propuesta-cambio-hitl` para la lectura), no la salida en memoria del Developer ni el estado del worktree, que ya está cerrado cuando el Reviewer se invoca.

#### Scenario: El Reviewer lee el patch persistido, no el worktree
- GIVEN la escritura delegada está activa y el Developer completó su turno (worktree ya cerrado)
- WHEN el Reviewer se invoca
- THEN su `tarea_delegada` incluye el patch obtenido de `propuestas_cambio`, no una referencia al worktree ni a una variable en memoria del turno del Developer

#### Scenario: Con la escritura delegada apagada, el eslabón se comporta como en `v2.0.0`
- GIVEN `HARNESS_ESCRITURA_DELEGADA=off`
- WHEN corre la cadena Planner → Developer → Reviewer
- THEN el Developer produce únicamente texto en prosa, igual que en `v2.0.0`, sin abrir worktree ni crear fila en `propuestas_cambio`

### Requirement: El veredicto sigue siendo uno solo, del Reviewer, aun cuando ve una vista parcial del patch

Cuando `propuestas_cambio.patch_bytes` excede `TAREA_DELEGADA_MAX_CHARS` (invariante ya vigente de `v2.0.0`), el Reviewer SHALL recibir una vista truncada del patch en su `tarea_delegada`. El sistema SHALL NOT bloquear ni invalidar el ciclo de revisión por ese truncado — el veredicto se emite igual, declarado como cota inferior de la aprobación humana final que ve los bytes completos en `/ver-propuesta`.

#### Scenario: Patch grande produce revisión parcial declarada, sin bloquear el ciclo
- GIVEN un patch persistido de más bytes que `TAREA_DELEGADA_MAX_CHARS`
- WHEN se construye la `tarea_delegada` del Reviewer
- THEN el texto se trunca al límite vigente y se emite el evento `propuesta-revision-parcial`
- AND el ciclo de revisión completa igual, con un único veredicto del Reviewer, sin excepción ni estado de error
