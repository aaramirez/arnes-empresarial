> Nota de proceso: checkpoint humano aprobó la decisión central de esta propuesta (ADR 136 — puerto de núcleo nuevo, archivo nuevo de `src/core/`, en vez de imitar el import directo de `repository.js` de `build-on-a2a-entrante.ts`) y la decisión de auditoría (este comando SÍ registra fila en `registro_acciones_empleado`, RD-67 resuelto — ver delta de `comando-empleado-tui`... salvo que, verificado con Glob, **no hace falta un tercer delta de esa capability**: el conteo de descriptores ya quedó atado a `DESCRIPTORES.length` en el delta de `comando-reporte-comisiones`, y `comando-cancelar-solicitud` ya estableció el precedente de heredar esa decisión sin repetir el delta). Molde de formato de este delta: los dos deltas ya existentes sobre `src/core/` — `openspec/changes/hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md` (copia-completa-y-edita) y el propio requirement `:29-41` que se edita acá.
>
> Se copiaron COMPLETOS los dos requirements que este delta toca (`### Requirement:` + TODOS sus escenarios), verificados línea por línea contra `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md:29-65`. El requirement `:45` ("Ciclo de vida completo... Ningún camino SHALL dejar la fila en `WORKING` con el proceso todavía vivo") **no se copia como MODIFIED** — este change no lo toca ni lo deroga. Se agrega como `ADDED` el requirement que le da su contraparte de observabilidad, dejando el original intacto y citado, no editado.

# Delta for Solicitud A2A Entrante

## MODIFIED Requirements

### Requirement: Cero archivos existentes de `src/core/` modificados en comportamiento por el camino de escritura del Hito 7

El composition root de escritura (`src/build-on-a2a-entrante.ts`, molde literal de `src/build-on-soporte.ts`) SHALL ser el único lugar donde vive la traducción de la solicitud entrante a turno, y SHALL NOT requerir ningún cambio de comportamiento en archivos existentes de `src/core/`. La única excepción permitida SHALL ser un cambio de doc-comment puro (sin cambio de comportamiento) en `src/core/agents/a2a-contract.ts` (ADR 91 puntos 2, 4 y 7). Este requirement gobierna el diff del **camino de escritura** del Hito 7 — SHALL NOT leerse como un congelamiento perpetuo de todo `src/core/`: un change posterior con su propio composition root de **lectura** puede agregar archivos NUEVOS a `src/core/` sin modificar ninguno existente, sin violar este requirement (ADR 136 de `comando-visibilidad-a2a-entrante`).

(Previously: el requirement no distinguía explícitamente "camino de escritura del Hito 7" de "`src/core/` en general"; un Reviewer podía leer el escenario de `git diff --stat` como un congelamiento perpetuo del directorio entero. Esta versión acota el alcance sin cambiar ninguna de sus garantías originales — cero derogación.)

#### Scenario: `git diff --stat main -- src/core/` no muestra archivos modificados (Hito 7)

- GIVEN el código del Hito 7 completo
- WHEN se ejecuta `git diff --stat main -- src/core/`
- THEN ningún archivo existente aparece como `MODIFIED` — a lo sumo un archivo nuevo (el del prompt sintético) y una línea de comentario en `a2a-contract.ts`

#### Scenario: `a2a-contract.ts` se reusa sin cambio de comportamiento

- GIVEN `TASK_STATE_*`, `TASK_STATES_CONOCIDOS`, `esTaskStateConocido` y `esEstadoTerminal` de `a2a-contract.ts`
- WHEN el composition root de escritura los usa para poblar `estado` y construir las respuestas `Task`
- THEN ninguna de esas funciones ni constantes cambia su firma ni su comportamiento respecto de `v2.2.0`

#### Scenario: Un change de lectura posterior agrega archivos nuevos a `src/core/` sin violar este requirement

- GIVEN `comando-visibilidad-a2a-entrante`, que agrega un puerto de lectura nuevo en un archivo NUEVO de `src/core/agents/` (ADR 136)
- WHEN se ejecuta `git diff --stat main -- src/core/` sobre ese change
- THEN ningún archivo EXISTENTE de `src/core/` aparece como `MODIFIED` — el único cambio es un archivo nuevo, y este requirement queda satisfecho, no derogado ni reinterpretado

## ADDED Requirements

### Requirement: Una fila huérfana en `WORKING` es observable por un humano — contraparte del punto ciego, sin escribir nada

El sistema SHALL exponer un mecanismo de lectura (capability `visibilidad-a2a-entrante`) que permita a un empleado autenticado distinguir una fila de `solicitudes_a2a_entrantes` en `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING` (no terminal) de una fila en estado terminal. Este mecanismo SHALL NOT requerir ningún cambio en el camino de escritura del Hito 7 ni en el requirement "Ningún camino SHALL dejar la fila en `WORKING` con el proceso todavía vivo" — lo complementa, dándole visibilidad al punto ciego que esa cláusula deja abierto (el proceso que ya no existe no puede escribir), sin prometer cerrarlo. El mecanismo de lectura SHALL NOT escribir en `solicitudes_a2a_entrantes` bajo ninguna circunstancia.

#### Scenario: Una fila huérfana en WORKING de una sesión anterior es visible

- GIVEN una fila en `TASK_STATE_WORKING` cuyo proceso que la escribió ya terminó (por ejemplo, tras un `taskkill /F`)
- WHEN un empleado autenticado consulta las solicitudes A2A entrantes en curso
- THEN esa fila aparece en el listado — el sistema no promete distinguirla en el modelo de datos de una fila legítimamente en curso de otro proceso, sólo hacerla visible

#### Scenario: El mecanismo de lectura nunca escribe en la tabla

- GIVEN cualquier consulta sobre `solicitudes_a2a_entrantes` a través de este mecanismo, en cualquiera de sus dos modos (listado o detalle)
- WHEN se ejecuta
- THEN no se ejecuta ningún `INSERT` ni `UPDATE` sobre `solicitudes_a2a_entrantes` como efecto de esa consulta
