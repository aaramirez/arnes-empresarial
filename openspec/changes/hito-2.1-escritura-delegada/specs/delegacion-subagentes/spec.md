> **DELTA — modifica un requirement existente de `hito-2.0-delegacion-subagentes`, no es aditivo.** Sigue el mismo patrón que `openspec/changes/hito-2.0-delegacion-subagentes/specs/activity-webhook-turn/spec.md` usó como delta sobre `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-webhook-turn/spec.md`: se copió el bloque COMPLETO del requirement afectado (`### Requirement:` + todos sus escenarios) desde `openspec/changes/hito-2.0-delegacion-subagentes/specs/delegacion-subagentes/spec.md`, y se editó — no se recortó ningún escenario previo sin reemplazarlo explícitamente. El resto de los requirements de esa spec base (`tarea_delegada` sin historial del padre, invocación in-process contra la `AgentDefinition` propia, resultado sin transformación de negocio, un solo nivel de profundidad, tres `AgentDefinition` reales con `description` obligatorio, retiro de `toMainThreadAgentDescription`) **no cambian** y no se repiten acá.
>
> **Qué relaja esta delta, explícitamente confirmado por el checkpoint humano**: el invariante de seguridad de `v2.0.0` *"ningún rol tiene herramientas de escritura"* pasa a ser *"ningún rol tiene `Write`/`Edit` fuera de un worktree aislado con su propio `cwd`, entregados en el mismo acto (constructor único)"*. Es un relajamiento **acotado** — solo el rol `developer`, solo junto con un worktree — no una eliminación de la prohibición. `Bash`, `Agent` y `Task` siguen prohibidos para los cuatro roles, sin excepción, con o sin el interruptor `HARNESS_ESCRITURA_DELEGADA` activo.

# Delta for Delegación a Subagentes

## MODIFIED Requirements

### Requirement: `allowedTools` acotado por rol; el Developer es el único que puede ganar herramientas de escritura, y solo junto con un worktree aislado

Cada rol SHALL declarar su propio `allowedTools`, recortado a lo que ese rol necesita. El sistema SHALL NOT otorgar al Planner o al Reviewer ninguna herramienta de escritura de archivos (`Write`/`Edit`) en ningún camino de código, con o sin el interruptor `HARNESS_ESCRITURA_DELEGADA` activo. El sistema SHALL otorgar `Write`/`Edit` (y la tool `mcp__worktree__run_tests`) al rol `developer` **únicamente** cuando ese Developer se invoca con `cwd` fijado a un `git worktree` aislado (capability `escritura-aislada-worktree`) — ambas condiciones, las tools de escritura y el `cwd`, SHALL entregarse en el mismo acto, mediante un único constructor del núcleo, o no entregarse. Ningún rol, en ningún camino de código, SHALL tener `Bash`, `Agent` ni `Task` en su `allowedTools`. Otorgar una herramienta sigue siendo auto-aprobarla sin confirmación humana por llamada (ADR 4).

(Previously: "El sistema SHALL NOT otorgar al Planner o al Developer las mismas herramientas que al Reviewer sin una justificación de caso de uso" — en `v2.0.0` ningún rol tenía herramientas de escritura, sin excepción. `v2.1.0` relaja esa prohibición de forma acotada y explícita: solo `developer`, solo junto con un worktree aislado, nunca `Bash`/`Agent`/`Task` para ningún rol.)

#### Scenario: El Planner no tiene herramientas de escritura (sin cambios respecto de `v2.0.0`)
- GIVEN el rol `planner` solo necesita leer y analizar el PR
- WHEN se define su `AgentDefinition`
- THEN su `allowedTools` no incluye herramientas de escritura de archivos ni de ejecución de comandos destructivos

#### Scenario: El Reviewer nunca tiene herramientas de escritura, con o sin el interruptor activo
- GIVEN el rol `reviewer` solo lee el patch persistido de una propuesta de cambio
- WHEN se define su `AgentDefinition`, en cualquier estado de `HARNESS_ESCRITURA_DELEGADA`
- THEN su `allowedTools` no incluye `Write`, `Edit`, `Bash`, `Agent` ni `Task`

#### Scenario: El Developer solo gana `Write`/`Edit` junto con un `cwd` de worktree
- GIVEN `HARNESS_ESCRITURA_DELEGADA` está activo y el composition root va a invocar al Developer
- WHEN se construye su `AgentDefinition` de escritura
- THEN esa construcción incluye tanto `Write`/`Edit` (y `mcp__worktree__run_tests`) en `allowedTools` como un `cwd` apuntando a un `git worktree` recién abierto
- AND no existe una función en el código que otorgue `Write`/`Edit` al Developer sin ese `cwd` acompañándolo

#### Scenario: Con el interruptor apagado, el Developer vuelve a ser exactamente el de `v2.0.0`
- GIVEN `HARNESS_ESCRITURA_DELEGADA=off`
- WHEN el composition root invoca al Developer
- THEN su `allowedTools` es idéntico al de `v2.0.0` (`["Read","Glob","Grep"]`), sin `Write`, `Edit`, `mcp__worktree__run_tests` ni `cwd` de worktree

#### Scenario: Ningún rol tiene `Bash`, `Agent` ni `Task`, en ningún estado del interruptor
- GIVEN cualquiera de los cuatro roles (`planner`, `developer`, `reviewer`, `validador-solicitudes`)
- WHEN se inspecciona su `allowedTools`, con `HARNESS_ESCRITURA_DELEGADA` en `on` o en `off`
- THEN ninguno incluye `Bash`, `Agent` ni `Task`
