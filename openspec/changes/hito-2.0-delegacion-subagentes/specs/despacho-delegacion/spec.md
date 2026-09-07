> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob) — mismo criterio ya documentado por `exploration.md` y `proposal.md` de este mismo change. Este spec se apoya en `proposal.md` (ADR 44, 45, 47), en el Plan (líneas 298-320) y en `src/core/activity/run-activity-turn.ts` / `activity-contract.ts` como código real verificado. Se recomienda que `sdd-design` corra `graphify explain` sobre `DestinoDelegacion`, `dispatch-delegation` y `sesiones_agente` antes de diseñar.

# Despacho de Delegación Specification

## Purpose

Capability nueva. Cubre el bloque 1.4 del arc42: la resolución determinista del destino de una delegación (`in-process` vs `a2a`), el registro de la fila `delegaciones` antes de invocar y su completado después, y el brazo A2A presente en el tipo pero lanzando un error tipado. Este es el único punto del sistema donde se decide "quién ejecuta esta tarea delegada" — la construcción de `tarea_delegada` y la invocación real del subagente pertenecen a la capability `delegacion-subagentes`.

**Fuera de alcance de este spec**: cliente A2A real, JSON-RPC, Agent Card, `src/adapters/a2a/` (Hito 6); delegación decidida por el modelo vía `tool_use` (ADR 44 — la cadena la arma el Despachador, no el modelo); delegación anidada (un subagente que delega a otro); reintentos, timeouts o presupuesto de tokens por delegación; reembolsos/escalación de ventas (R3/ADR 11 de Hito 4, cerrado por `v1.4.0` — no es parte de este hito).

## Requirements

### Requirement: `DestinoDelegacion` como unión discriminada resuelta por función pura

El sistema SHALL representar el destino de una delegación como el tipo `DestinoDelegacion`, una unión discriminada con al menos dos variantes: `{ kind: "in-process"; agentId: string }` y `{ kind: "a2a"; ... }`. La resolución del destino SHALL ser una función pura del núcleo, sin `await`, sin acceso a red ni a base de datos.

#### Scenario: Resolver un rol conocido da destino in-process
- GIVEN un `agentId` de un rol registrado (`planner`, `developer` o `reviewer`)
- WHEN el Despachador resuelve el destino de la delegación
- THEN el resultado es `{ kind: "in-process", agentId }`
- AND la función de resolución no invoca ninguna I/O

### Requirement: El brazo A2A lanza un error tipado, sin adaptador

Cuando el destino resuelto es `{ kind: "a2a" }`, el Despachador SHALL lanzar `DelegacionA2ANoImplementadaError` en un único punto del código, antes de cualquier intento de red. El sistema SHALL NOT importar ni depender de `src/adapters/a2a/`, JSON-RPC, ni ninguna Agent Card para satisfacer este requisito.

#### Scenario: Despachar a destino A2A lanza el error tipado
- GIVEN un destino resuelto con `kind: "a2a"`
- WHEN el Despachador intenta despachar la delegación
- THEN se lanza `DelegacionA2ANoImplementadaError`
- AND no se crea ninguna fila en `delegaciones` para ese intento
- AND no se importa ningún módulo de `src/adapters/a2a/`

### Requirement: Registro de la delegación antes de invocar, completado después

Para todo despacho `in-process`, el Despachador SHALL crear una fila en `delegaciones` (`sesion_padre_id`, `sesion_subagente_id`, `tarea_delegada`, `created_at`) **antes** de invocar al subagente, y SHALL completar la columna `resultado` de esa misma fila **después** de que el subagente responda. Ambas sesiones referenciadas SHALL existir en `sesiones_agente` (Hito 1).

#### Scenario: Delegación exitosa deja fila completa
- GIVEN un despacho `in-process` hacia un rol registrado
- WHEN el subagente responde exitosamente
- THEN la fila de `delegaciones` creada antes de invocar tiene `resultado` completado tras la respuesta
- AND `sesion_padre_id` y `sesion_subagente_id` referencian filas válidas de `sesiones_agente`

#### Scenario: Falla del subagente deja la fila sin `resultado`
- GIVEN un despacho `in-process` cuyo subagente falla durante la invocación
- WHEN la falla ocurre
- THEN la fila de `delegaciones` ya registrada antes de invocar permanece con `resultado` sin completar
- AND el error propaga como falla del turno, sin revertir la fila de `delegaciones`
- AND el estado canónico de la actividad/caso no se modifica por este fallo

### Requirement: Cadena determinista Planner → Developer → Reviewer

El Despachador SHALL ejecutar la secuencia de roles del bot de PRs en el orden fijo Planner → Developer → Reviewer, decidido por el propio Despachador y no por una decisión del modelo en tiempo de ejecución (`tool_use`). Cada rol SHALL despacharse como una invocación independiente, con su propia fila de `delegaciones`.

#### Scenario: Un evento de PR genera tres delegaciones en orden
- GIVEN un evento de PR válido que dispara el ciclo de revisión
- WHEN el Despachador ejecuta la cadena de roles
- THEN se crean tres filas de `delegaciones` con el mismo `caso_id` de correlación
- AND el orden de invocación es Planner, luego Developer, luego Reviewer
- AND ninguna fila de `tarea_delegada` del Developer o el Reviewer contiene el historial de sesión del rol anterior

### Requirement: `parent_tool_use_id` se registra como correlación, no como mecanismo de despacho

Cuando un mensaje del SDK incluya `parent_tool_use_id`, el sistema SHALL registrarlo como dato de correlación. El sistema SHALL NOT depender de ese campo para decidir si delega ni hacia dónde.

#### Scenario: `parent_tool_use_id` ausente no bloquea el despacho
- GIVEN una invocación de subagente cuyo mensaje no trae `parent_tool_use_id`
- WHEN el Despachador procesa la respuesta
- THEN la delegación se completa igual, sin ese dato de correlación
