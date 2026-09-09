> **DELTA — modifica un requirement existente de `hito-2.0-delegacion-subagentes`, no es aditivo.** Sigue el mismo patrón que `openspec/changes/hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md` usó como delta sobre su base: se copió el bloque COMPLETO del requirement afectado (`### Requirement:` + todos sus escenarios) desde `openspec/changes/hito-2.0-delegacion-subagentes/specs/despacho-delegacion/spec.md`, y se reemplazó — no se recortó ningún escenario previo sin reemplazarlo explícitamente. El resto de los requirements de esa spec base (`DestinoDelegacion` como unión discriminada resuelta por función pura, registro de la delegación antes de invocar/completado después, cadena determinista Planner → Developer → Reviewer, `parent_tool_use_id` como correlación) **no cambian** y no se repiten acá — en particular, `resolverDestino` sigue teniendo exactamente la misma forma (ADR 72 punto 7 de `proposal.md`): la rama `a2a` de `DestinoDelegacion` sigue sin ser alcanzable por esa función, y el destino `a2a` sigue llegando por el campo opcional `input.destino`.
>
> **Qué borra esta delta, y por qué no es una regresión (R7 de `proposal.md`, ordenado por ADR 45 punto 3 de `v2.0.0` desde que se escribió el doc-comment de `DelegacionA2ANoImplementadaError`)**: el requirement "El brazo A2A lanza un error tipado, sin adaptador" y su escenario "Despachar a destino A2A lanza el error tipado" describían el **único** estado posible del brazo `a2a` en `v2.0.0`/`v2.1.0`: sin adaptador, sin Cliente A2A, ese brazo solo podía fallar. Este hito construye el Cliente A2A (capability `cliente-a2a-jsonrpc`) y el despacho externo real (capability `delegacion-a2a-saliente`), así que ese requirement deja de describir el sistema — no porque la garantía se debilite, sino porque la pieza que faltaba para cumplirla de verdad ya existe.
>
> **Nota de proceso**: `graphify query "dispatch-delegation despacharDelegacion DestinoDelegacion resolverDestino DelegacionA2ANoImplementadaError"` se corrió antes de abrir `dispatch-delegation.ts` (`graphify-out/graph.json` existe en este repo), confirmando el vecindario del módulo antes de leerlo completo. Se verificó contra el archivo real: el `throw` en la línea 216-218, la clase de error en 56-64 con su doc-comment "Hito 6: reemplazar el throw... y BORRAR el test que la asserta", y el test `dispatch-delegation.test.ts` (mismo `community` en el grafo) que hoy la assertea.

# Delta for Despacho de Delegación

## MODIFIED Requirements

### Requirement: El brazo A2A ya no falla por construcción — el Despachador delega de verdad a través de una capability hermana

Cuando el destino resuelto de una delegación es `{ kind: "a2a" }`, el sistema SHALL NOT lanzar `DelegacionA2ANoImplementadaError`, porque esa clase SHALL NOT existir en el código. El despacho de una delegación `a2a` SHALL ejecutarse a través de la función hermana que cubre la capability `delegacion-a2a-saliente`, no a través de `despacharDelegacion`/`despacharCadena` (que siguen resolviendo y despachando únicamente destinos `in-process`, sin cambio de forma respecto de `v2.0.0`/`v2.1.0`). El sistema SHALL NOT importar `src/adapters/a2a/` desde `despacharDelegacion`/`despacharCadena` — esa importación, si existe, vive exclusivamente del lado de la capability `delegacion-a2a-saliente`.

(Previously: "Cuando el destino resuelto es `{ kind: "a2a" }`, el Despachador SHALL lanzar `DelegacionA2ANoImplementadaError` en un único punto del código, antes de cualquier intento de red. El sistema SHALL NOT importar ni depender de `src/adapters/a2a/`, JSON-RPC, ni ninguna Agent Card para satisfacer este requisito." — en `v2.0.0`/`v2.1.0` el brazo `a2a` no tenía ningún adaptador real, así que el único comportamiento correcto era fallar tipado, antes de tocar la base. `v2.2.0` reemplaza esa falla por un despacho real, en una función distinta.)

#### Scenario: `DelegacionA2ANoImplementadaError` no existe en el código
- GIVEN el conjunto completo de símbolos exportados por `src/core/turn-selector/dispatch-delegation.ts`
- WHEN se inspecciona ese módulo
- THEN `DelegacionA2ANoImplementadaError` no está entre ellos

#### Scenario: El test de `hito-2.0` que aseveraba el error tipado está borrado
- GIVEN la suite de tests de `src/core/turn-selector/dispatch-delegation.test.ts`
- WHEN se ejecuta la suite completa
- THEN ningún test asserta que despachar un destino `a2a` lanza `DelegacionA2ANoImplementadaError`

#### Scenario: `despacharDelegacion` sigue resolviendo únicamente destinos in-process
- GIVEN un destino resuelto con `kind: "in-process"` hacia un rol registrado en `SUBAGENT_REGISTRY`
- WHEN el Despachador despacha esa delegación
- THEN el comportamiento es idéntico al de `v2.0.0`/`v2.1.0`: crea la fila de `delegaciones` antes de invocar, invoca al subagente y completa la fila después
- AND ningún camino de `despacharDelegacion`/`despacharCadena` importa un módulo de `src/adapters/a2a/`

#### Scenario: Un destino `a2a` no se resuelve ni se despacha a través de `despacharDelegacion`
- GIVEN un destino ya resuelto con `kind: "a2a"`
- WHEN se necesita ejecutar esa delegación
- THEN el camino de ejecución es la función que cubre `delegacion-a2a-saliente`, no `despacharDelegacion`
- AND `despacharDelegacion` no participa en ese despacho ni crea ninguna fila en `delegaciones` para él
