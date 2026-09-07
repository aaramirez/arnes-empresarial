> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `despacho-delegacion/spec.md`. Delta sobre `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-webhook-turn/spec.md` (spec base de Hito 3), siguiendo el flujo MODIFIED de `sdd-spec`: se copió el bloque completo de la requirement afectada y se editó, sin recortar sus escenarios previos. El resto de los requirements de la spec base (firma HMAC, listener opt-in, traducción de evento, creación transaccional, serialización por `proyecto_id`, logging) **no cambian** y no se repiten acá.

# Delta for Activity Webhook Turn

## MODIFIED Requirements

### Requirement: Parseo de veredicto y transición de estado

Una función pura del núcleo SHALL parsear la línea `VEREDICTO: <valor>` de la respuesta final del ciclo y traducirla a uno de los cuatro estados canónicos (`pendiente_revision`, `observado`, `resuelto`, `aprobado`) vía `transicionarEstado`. Si el veredicto no puede parsearse, el estado resultante SHALL ser `observado`, nunca `aprobado`. La respuesta final de la que se parsea el veredicto SHALL ser la producida por el rol Reviewer al cierre de la cadena Planner → Developer → Reviewer (capability `revision-pr-por-roles`), no por un único `runTurn` de un solo agente.

(Previously: el veredicto se parseaba de la respuesta de un único `runTurn`, sin cadena de roles.)

#### Scenario: Veredicto válido transiciona estado
- GIVEN el ciclo de revisión (ahora despachado por roles) produce como salida final `VEREDICTO: aprobado`
- WHEN se parsea la respuesta
- THEN el estado de la actividad transiciona a `aprobado`

#### Scenario: Veredicto no parseable cae a estado seguro
- GIVEN la respuesta final del ciclo no contiene una línea `VEREDICTO:` reconocible
- WHEN se parsea la respuesta
- THEN el estado resultante es `observado`
- AND nunca es `aprobado`

#### Scenario: El veredicto proviene del Reviewer, no del Planner ni del Developer
- GIVEN la cadena Planner → Developer → Reviewer completó sus tres invocaciones
- WHEN `runActivityTurn` recibe la salida a parsear
- THEN esa salida es la del Reviewer
- AND ninguna salida intermedia del Planner o del Developer se usa como entrada de `parseVeredicto`

## ADDED Requirements

### Requirement: El paso 5 despacha una delegación por roles en vez de invocar un `runTurn` único

El paso 5 de `runActivityTurn` SHALL reemplazar la invocación directa de `RunActivityTurnDeps.runTurn` por una dependencia inyectada que despacha la cadena de delegación de roles (capabilities `despacho-delegacion` y `delegacion-subagentes`) y devuelve el mismo tipo `ActivityTurnOutcome` (texto final + etiqueta de agente) que el `runTurn` de Hito 3. Los pasos 6, 7, 8 y 9 de la secuencia SHALL permanecer sin cambios de forma.

#### Scenario: `ActivityTurnOutcome` mantiene su forma tras el cambio de paso 5
- GIVEN el paso 5 ahora despacha la cadena de roles en vez de un `runTurn` único
- WHEN el paso 5 completa
- THEN produce un `ActivityTurnOutcome` con `responseText` y `agentLabel`, consumible por los pasos 6-9 sin modificarlos

#### Scenario: El doble inyectado en tests cambia, los asserts de estado no
- GIVEN `run-activity-turn.test.ts` reemplaza su doble de `runTurn` por un doble de despacho de delegación
- WHEN los tests existentes de transición de estado corren contra ese nuevo doble
- THEN los asserts sobre `estadoAnterior`/`estado`/`veredicto` no requieren reescritura, solo el doble inyectado cambia
