> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `despacho-delegacion/spec.md`. Este spec se apoya en `proposal.md` (ADR 44, 47), el Plan (líneas 289, 324) y `src/core/activity/run-activity-turn.ts` / `activity-contract.ts` como código real verificado. Ver también la delta de `activity-webhook-turn` en este mismo `specs/` para lo que cambia en el ciclo de Hito 3.

# Revisión de PR por Roles Specification

## Purpose

Capability nueva. Cubre el entregable A del hito: el ciclo de revisión de PRs (Hito 3) corriendo con la cadena determinista Planner → Developer → Reviewer, despachada por `despacho-delegacion` e invocada por `delegacion-subagentes`, con un único veredicto final emitido por el Reviewer. El contrato de estados, la transición (`transicionarEstado`) y el espejo al tablero (pasos 6-9 de `runActivityTurn`) NO cambian de forma — cambia quién produce el texto del que sale el veredicto (ADR 47).

**Fuera de alcance de este spec**: la resolución del destino de la delegación y el error tipado del brazo A2A (capability `despacho-delegacion`); la construcción de `tarea_delegada` y la invocación in-process del subagente (capability `delegacion-subagentes`); revisión del diff completo del PR (diferido desde Hito 3); reembolsos/escalación de ventas (cerrado por `v1.4.0`, no es parte de este hito).

## Requirements

### Requirement: El veredicto final lo emite únicamente el Reviewer

De los tres roles de la cadena, solo el Reviewer SHALL producir la línea `VEREDICTO:` que `parseVeredicto` consume. El Planner y el Developer SHALL NOT producir una línea `VEREDICTO:` que compita con la del Reviewer.

#### Scenario: Un ciclo de revisión completo produce un único veredicto
- GIVEN un evento de PR válido dispara el ciclo de revisión
- WHEN la cadena Planner → Developer → Reviewer termina
- THEN `parseVeredicto` procesa exactamente la línea `VEREDICTO:` emitida por el Reviewer
- AND la transición de estado resultante es idéntica a la que produciría un único `runTurn` con ese mismo veredicto en `v1.2.0`

### Requirement: Los pasos 6-9 de `runActivityTurn` no cambian de forma

`parseVeredicto`, `transicionarEstado`, `store.updateActividadEstado` y el espejo al tablero (`board.publicarRevision`, `board.mirrorEstado`) SHALL comportarse exactamente igual que en Hito 3, incluido el invariante "el paso 7 (persistencia del estado canónico) ocurre antes que los pasos 8-9 (espejo), sin excepción".

#### Scenario: El estado canónico se persiste antes del espejo al tablero, con delegación por roles
- GIVEN el Reviewer emitió un veredicto válido
- WHEN `runActivityTurn` procesa la salida de la cadena de roles
- THEN `store.updateActividadEstado` se invoca antes de cualquier llamada a `board.publicarRevision` o `board.mirrorEstado`

#### Scenario: Falla de cualquier rol de la cadena propaga como fallaba `runTurn`
- GIVEN el Developer falla durante su invocación
- WHEN el ciclo de revisión procesa esa falla
- THEN el error propaga como falla del turno, sin invocar `parseVeredicto` ni ningún método del `store` o del `board`

### Requirement: Tres filas de `delegaciones` por PR revisado, mismo `caso_id`

Cada evento de PR que dispara el ciclo completo SHALL producir exactamente tres filas en `delegaciones` (una por rol), todas con el mismo `caso_id` de correlación que la actividad.

#### Scenario: Trazabilidad completa de un PR revisado
- GIVEN un PR dispara el ciclo de revisión y llega a un veredicto
- WHEN se inspeccionan las filas de `delegaciones` de ese `caso_id`
- THEN hay exactamente tres filas, en el orden Planner, Developer, Reviewer, cada una con su `tarea_delegada` y su `resultado` completado

### Requirement: El entregable de Hito 3 corre sin reescribir el Despachador

El mismo caso de uso funcional que corría en Hito 3 (un evento de PR produce un veredicto y una transición de estado) SHALL seguir siendo demostrable con este hito, usando delegación interna entre roles, sin que el código de `despacho-delegacion` necesite reescribirse cuando el Hito 6 reemplace el brazo A2A.

#### Scenario: El caso de Hito 3 es demostrable end-to-end con roles
- GIVEN el mismo escenario de demo de Hito 3 (webhook de GitHub, PR de prueba)
- WHEN se ejecuta contra este hito
- THEN el PR recibe una revisión y una transición de estado equivalente a la de `v1.2.0`, corriendo internamente la cadena de tres roles
