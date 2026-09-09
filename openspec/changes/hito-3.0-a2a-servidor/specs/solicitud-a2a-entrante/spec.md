> Nota de proceso: misma corrida sin `Bash`/`graphify` documentada en `servidor-a2a-jsonrpc/spec.md` de este change. Se leyó completo `proposal.md` (ADR 86-92), `src/build-on-soporte.ts` completo — el molde literal del ADR 91, incluida su frase textual "NO hay `KeyedQueue`: no hay recurso compartido que serializar" (líneas 19-20) — y `src/core/agents/a2a-contract.ts` completo (vocabulario `TASK_STATE_*` reusado tal cual). Molde de formato: `openspec/changes/hito-2.2-a2a-cliente/specs/delegacion-a2a-saliente/spec.md`.
>
> No hay spec previa de esta capability — es un spec completo, no una delta. Fuera de alcance de este spec: la conversación HTTP/JSON-RPC, el Agent Card, el ruteo por `method`, el tope de turnos en vuelo y el drenaje al cerrar — capability `servidor-a2a-jsonrpc`, que invoca esta capability como la función que corre después de responder `SendMessage`.
>
> **Ambigüedad de la propuesta resuelta acá, no una duda de implementación**: `proposal.md` declara `Modified Capabilities: Ninguna` (ADR 91) y a la vez, en su tabla de componentes, marca `src/core/agents/a2a-contract.ts` como `Modified (doc)` — solo su doc-comment ("Vocabulario del Cliente A2A saliente" → "del protocolo A2A, en sus dos direcciones"), "cero cambio de comportamiento" (ADR 91 punto 7). Resolución: un spec describe comportamiento observable, no comentarios de código — un cambio de doc-comment sin cambio de comportamiento **no genera** un delta `MODIFIED` sobre ninguna capability existente (`cliente-a2a-jsonrpc` ni `delegacion-a2a-saliente` de `hito-2.2`, que son las que hoy documentan ese vocabulario). Por lo tanto `Modified Capabilities: Ninguna` queda confirmado tal cual la propuesta lo declara, y este change no incluye ningún archivo de delta sobre specs previas.

# Solicitud A2A Entrante Specification

## Purpose

Capability nueva. Cubre ADR 87 (la máquina de estados persistida), 89 (el DDL y `agente_externo_url`), 90 puntos 1-3 (por qué no hay cola) y 91 (el molde de composition root, cero archivos de núcleo modificados) de `proposal.md`, y el Escenario de ejecución 6 del arc42: la traducción de una solicitud `SendMessage` ya aceptada por el transporte a un turno del Núcleo — creación del `caso` propio, el prompt sintético, la reutilización de `handleTurn` **sin camino de código paralelo**, el ciclo de vida completo de la fila de `solicitudes_a2a_entrantes`, y el carácter **de lectura** del turno entrante.

## Requirements

### Requirement: La solicitud entrante usa el mismo Selector de Turno que el Empleado, la TUI y `/soporte` — sin camino de código paralelo

El sistema SHALL traducir una solicitud `SendMessage` aceptada a un turno mediante el mismo `handleTurn(casoId, prompt, deps)` que ya invocan `build-on-submit.ts`, `build-on-activity.ts` y `build-on-soporte.ts`. El sistema SHALL NOT introducir un segundo mecanismo de resolución de turno para solicitudes A2A entrantes (ADR 91, Escenario 6 del arc42).

#### Scenario: El turno entrante se resuelve con `handleTurn`, no con un mecanismo propio
- GIVEN una solicitud A2A entrante aceptada, con su `caso` ya creado
- WHEN el sistema resuelve su turno
- THEN invoca la misma función `handleTurn(casoId, prompt, deps)` que usan los demás puntos de entrada del arnés

#### Scenario: `handle-turn.ts` no gana una rama exclusiva para A2A entrante
- GIVEN el código de `src/core/turn-selector/handle-turn.ts`
- WHEN se inspecciona en busca de una rama condicional específica para solicitudes A2A entrantes
- THEN no existe ninguna — el archivo permanece intacto respecto de `v2.2.0`

### Requirement: Cero archivos existentes de `src/core/` modificados en comportamiento

El composition root nuevo (`src/build-on-a2a-entrante.ts`, molde literal de `src/build-on-soporte.ts`) SHALL ser el único lugar donde vive la traducción de la solicitud a turno, y SHALL NOT requerir ningún cambio de comportamiento en archivos existentes de `src/core/`. La única excepción permitida SHALL ser un cambio de doc-comment puro (sin cambio de comportamiento) en `src/core/agents/a2a-contract.ts` (ADR 91 puntos 2, 4 y 7).

#### Scenario: `git diff --stat main -- src/core/` no muestra archivos modificados
- GIVEN el código de este change completo
- WHEN se ejecuta `git diff --stat main -- src/core/`
- THEN ningún archivo existente aparece como `MODIFIED` — a lo sumo un archivo nuevo (el del prompt sintético) y una línea de comentario en `a2a-contract.ts`

#### Scenario: `a2a-contract.ts` se reusa sin cambio de comportamiento
- GIVEN `TASK_STATE_*`, `TASK_STATES_CONOCIDOS`, `esTaskStateConocido` y `esEstadoTerminal` de `a2a-contract.ts`
- WHEN el composition root nuevo los usa para poblar `estado` y construir las respuestas `Task`
- THEN ninguna de esas funciones ni constantes cambia su firma ni su comportamiento respecto de `v2.2.0`

### Requirement: Ciclo de vida completo de `solicitudes_a2a_entrantes` — fila creada antes de responder, actualizada siempre

Para toda solicitud `SendMessage` aceptada (por debajo del tope de turnos en vuelo), el sistema SHALL crear la fila de `solicitudes_a2a_entrantes` con `estado = "TASK_STATE_SUBMITTED"` **antes** de que la respuesta HTTP de `SendMessage` se emita. El sistema SHALL actualizar esa fila a `TASK_STATE_WORKING` al iniciar el turno, y a `TASK_STATE_COMPLETED` (con `resultado` poblado) o `TASK_STATE_FAILED` según el desenlace de `handleTurn`. Ningún camino SHALL dejar la fila en `WORKING` con el proceso todavía vivo (ADR 87 puntos 5 y 7).

#### Scenario: La fila existe antes de que se emita la respuesta HTTP
- GIVEN una solicitud `SendMessage` aceptada
- WHEN se verifica el orden de escritura con un doble del store que observa la secuencia
- THEN la fila con `estado = "TASK_STATE_SUBMITTED"` ya está persistida antes de que la respuesta HTTP se construya

#### Scenario: Un `GetTask` inmediatamente posterior siempre encuentra la tarea
- GIVEN el `SendMessage` que acaba de responder `SUBMITTED`
- WHEN se consulta `GetTask` con ese `a2a_task_id` de inmediato
- THEN la fila existe y se encuentra, nunca "no encontrada" por carrera

#### Scenario: Turno exitoso completa la fila con el resultado
- GIVEN un turno que `handleTurn` resuelve con éxito
- WHEN se actualiza la fila
- THEN queda con `estado = "TASK_STATE_COMPLETED"` y `resultado` no vacío con el texto del turno

#### Scenario: Turno fallido deja la fila en `FAILED`, no en `WORKING`
- GIVEN un turno que `handleTurn` rechaza (`TurnFailedError` u otro)
- WHEN se actualiza la fila
- THEN queda con `estado = "TASK_STATE_FAILED"`, nunca abandonada en `TASK_STATE_WORKING`

### Requirement: `agente_externo_url` es nullable y hoy siempre `NULL`; `origen_transporte` registra el hecho observable

El sistema SHALL persistir `solicitudes_a2a_entrantes.agente_externo_url` como columna nullable y SHALL NOT poblarla con ningún valor en este hito — el protocolo A2A v1.0.0 no transporta esa identidad. El sistema SHALL persistir `origen_transporte` con la dirección remota de la conexión observada por el transporte (ADR 89 puntos 2 y 3).

#### Scenario: `agente_externo_url` queda `NULL` en toda fila nueva
- GIVEN cualquier solicitud A2A entrante procesada, en cualquier desenlace
- WHEN se inspecciona su fila
- THEN `agente_externo_url` es `NULL`

#### Scenario: `origen_transporte` registra la dirección remota observada
- GIVEN una solicitud entrante recibida desde una conexión con una dirección remota conocida
- WHEN se crea su fila
- THEN `origen_transporte` contiene esa dirección, no un valor inventado ni vacío

### Requirement: El turno entrante es de lectura — no escribe en ningún dominio del arnés, invariante verificable por firma

El composition root de la solicitud entrante SHALL NOT recibir entre sus dependencias ningún puerto de escritura del dominio (`board`, store de `actividades`, `escritura`/worktree, ni `ClienteA2APort` para delegación saliente). El turno entrante SHALL NOT crear ni modificar `actividades`, SHALL NOT espejar al tablero, SHALL NOT correr `runActivityTurn`, SHALL NOT despachar la cadena Planner→Developer→Reviewer, y SHALL NOT disparar una delegación A2A saliente (ADR 90 punto 3, Out of Scope de `proposal.md`).

#### Scenario: Las dependencias del composition root no incluyen puertos de escritura
- GIVEN la firma de `BuildOnA2AEntranteDeps` (o equivalente) del composition root nuevo
- WHEN se inspeccionan sus campos
- THEN ninguno es un puerto de escritura de `actividades`, del tablero, de worktree, ni un `ClienteA2APort` de delegación saliente

#### Scenario: Un turno entrante no crea actividades ni despacha delegaciones
- GIVEN un turno entrante que completa exitosamente
- WHEN se inspecciona el estado del dominio después
- THEN no existe ninguna fila nueva en `actividades`, ninguna delegación (`delegaciones`/`delegaciones_a2a`) disparada por ese turno, y el tablero no cambió

### Requirement: Sin `KeyedQueue` para el turno entrante — mismo criterio que `build-on-soporte.ts`, porque no hay recurso compartido que serializar

El sistema SHALL NOT usar ninguna cola (`KeyedQueue` ni equivalente) para serializar turnos A2A entrantes entre sí ni contra otros turnos del arnés. Esa ausencia SHALL depender de que el turno entrante sea de lectura (requirement anterior): cada solicitud crea su propio `caso` nuevo e independiente, sin recurso mutable compartido (ADR 90 puntos 1 y 2, molde textual de `build-on-soporte.ts:19-20`).

#### Scenario: N solicitudes entrantes concurrentes no se serializan entre sí
- GIVEN varias solicitudes A2A entrantes simultáneas, cada una por debajo del tope de turnos en vuelo
- WHEN se procesan
- THEN ninguna espera a que otra termine antes de empezar su propio turno

#### Scenario: Una solicitud entrante y un turno de actividad de webhook sobre el mismo `proyectoId` no se bloquean entre sí
- GIVEN un turno de actividad de webhook en curso sobre un `proyectoId`, y una solicitud A2A entrante concurrente
- WHEN ambos corren al mismo tiempo
- THEN ninguna fuente bloquea a la otra, y ninguna fila de cualquiera de las dos queda inconsistente

### Requirement: `CASO_TIPO_A2A_ENTRANTE` y el prompt sintético son aditivos y puros

El sistema SHALL crear el `caso` de una solicitud entrante con `tipo = CASO_TIPO_A2A_ENTRANTE`, sin requerir ninguna migración de esquema (`casos.tipo` es `TEXT` sin `CHECK`). El sistema SHALL construir el prompt del turno con una función pura del núcleo, sin imports, hermana de `buildSoportePrompt` (ADR 91 puntos 5 y 6).

#### Scenario: El `caso` se crea con el tipo nuevo sin migración de esquema
- GIVEN una solicitud A2A entrante aceptada
- WHEN se crea su `caso`
- THEN su `tipo` es `CASO_TIPO_A2A_ENTRANTE`, y no hizo falta ninguna migración de `casos` para admitirlo

#### Scenario: El prompt sintético es puro y testeable sin red ni modelo
- GIVEN el texto recibido en la solicitud entrante
- WHEN se construye el prompt del turno
- THEN la función que lo construye no realiza ningún I/O y es testeable con solo el texto de entrada y su salida esperada
