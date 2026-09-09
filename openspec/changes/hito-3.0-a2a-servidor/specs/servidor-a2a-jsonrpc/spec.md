> Nota de proceso: fase corrida sin `Bash`/`graphify` (mismo motivo que `proposal.md` de este change: entorno sin esa herramienta en esta sesión) — `Read`/`Grep`/`Glob` directos sobre código real. Se leyó completo `proposal.md` (ADR 86-92, R1-R12), `src/adapters/web/server.ts` (auth `esAutorizado` con `timingSafeEqual` 113-132, listener síncrono con `void handleX(...)` 459-489, drenaje `startServer` 504-571), `src/adapters/webhooks/server.ts` (tabla de respuestas exhaustiva 118-137, ack antes de `onEvent` sin `await` 233-241, drenaje 254-327), `src/core/agents/a2a-contract.ts` completo (`TASK_STATE_*`, `esEstadoTerminal`) y `src/adapters/a2a/client.ts` completo (forma de `TaskLike`, extracción de resultado desde `artifacts`/`status.message`, nombres de método sin prefijo). Molde de formato: `openspec/changes/hito-2.2-a2a-cliente/specs/cliente-a2a-jsonrpc/spec.md`.
>
> No hay spec previa de esta capability — es un spec completo, no una delta. Fuera de alcance de este spec: la traducción de la solicitud a un turno del Núcleo, la tabla `solicitudes_a2a_entrantes`, el composition root y el carácter de lectura del turno — capability `solicitud-a2a-entrante`, consumida acá solo como la función que `SendMessage` invoca sin `await` después de responder.

# Servidor A2A JSON-RPC Specification

## Purpose

Capability nueva. Cubre ADR 86, 87 (el contrato de respuesta HTTP), 88, 90 punto 4 (el mecanismo del tope) y 92 de `proposal.md` — la mitad **servidor** de la Caja Negra 5 / I4 del arc42: el adaptador `src/adapters/a2a/server.ts` a mano sobre `node:http`, sin SDK ni Express. Publicación del Agent Card, autenticación bearer del endpoint JSON-RPC, ruteo por `method`, la forma exacta del `Task` que devuelve (parseable por el propio Cliente A2A del Hito 6), el mapeo de errores JSON-RPC, el tope de turnos en vuelo con su respuesta `REJECTED`, y el drenaje al cerrar.

## Requirements

### Requirement: El Agent Card se publica en la URL bien conocida, público y sin autenticación

El servidor SHALL servir `GET /.well-known/agent-card.json` sin exigir `Authorization`, con `name`, `description`, `version = "3.0.0"`, `capabilities` con `streaming`/`pushNotifications`/`extendedAgentCard` las tres en `false` explícitamente, `defaultInputModes`/`defaultOutputModes` en `["text/plain"]`, exactamente **una** `skill`, `securitySchemes` declarando un esquema HTTP bearer, y `supportedInterfaces` con **una** entrada de transporte JSON-RPC apuntando a `HARNESS_A2A_ENTRANTE_PUBLIC_URL` (ADR 92, ADR 88 punto 5).

#### Scenario: El card se sirve sin `Authorization`
- GIVEN el servidor A2A corriendo con un token configurado
- WHEN se hace `GET /.well-known/agent-card.json` sin header `Authorization`
- THEN la respuesta es `200` con el card completo, no `401`

#### Scenario: Las tres `capabilities` están declaradas en `false`, no omitidas
- GIVEN el card servido
- WHEN se inspecciona el campo `capabilities`
- THEN `streaming`, `pushNotifications` y `extendedAgentCard` están presentes y en `false`, ninguno ausente

#### Scenario: `supportedInterfaces` declara una única entrada JSON-RPC
- GIVEN el card servido
- WHEN se inspecciona `supportedInterfaces`
- THEN hay exactamente una entrada con transporte JSON-RPC apuntando a la URL pública configurada

### Requirement: Autenticación bearer obligatoria en el endpoint JSON-RPC, verificada antes de parsear el body

El endpoint JSON-RPC SHALL exigir `Authorization: Bearer <HARNESS_A2A_ENTRANTE_TOKEN>`, comparado con `timingSafeEqual` y chequeo de longitud previo (molde `esAutorizado` de `web/server.ts:113-132`). El servidor SHALL rechazar con `401` **antes** de parsear el body JSON-RPC, y SHALL NOT crear ninguna fila de trazabilidad para una llamada no autenticada (ADR 88).

#### Scenario: Sin `Authorization` válido, responde 401 sin parsear
- GIVEN una llamada `POST` al endpoint JSON-RPC sin header `Authorization`, o con un valor incorrecto
- WHEN el servidor procesa la request
- THEN responde `401` antes de intentar `JSON.parse` del body, y no se crea ninguna fila en la tabla de trazabilidad

#### Scenario: Token vacío en configuración nunca autoriza
- GIVEN el token configurado es una cadena vacía
- WHEN llega cualquier `Authorization: Bearer <lo que sea>`
- THEN la respuesta es `401` sin comparar buffers — nunca "abierta por defecto"

#### Scenario: Con `Authorization` correcto, la llamada procede
- GIVEN el header `Authorization: Bearer <token configurado>` exacto
- WHEN llega un `SendMessage` válido
- THEN el servidor continúa al parseo y despacho por `method`

### Requirement: El token es el único interruptor — sin token, el servidor no abre ningún puerto

Con `HARNESS_A2A_ENTRANTE_TOKEN` ausente o en blanco, el composition root SHALL NOT abrir ningún puerto del Servidor A2A, y SHALL loguear `a2a-servidor-deshabilitado`. No SHALL existir ningún interruptor booleano separado (tipo `HARNESS_A2A_ENTRANTE=on/off`) que permita un servidor escuchando sin token (ADR 88 punto 4).

#### Scenario: Sin token configurado, no se abre puerto
- GIVEN `HARNESS_A2A_ENTRANTE_TOKEN` no está definida
- WHEN el proceso arranca
- THEN no se abre ningún puerto del Servidor A2A y se loguea `a2a-servidor-deshabilitado`

#### Scenario: Con token configurado, el servidor escucha
- GIVEN `HARNESS_A2A_ENTRANTE_TOKEN` tiene un valor no vacío
- WHEN el proceso arranca
- THEN el Servidor A2A abre su puerto y sirve el Agent Card y el endpoint JSON-RPC

### Requirement: Ruteo exclusivo por `method` — solo tres soportados, cualquier otro responde el error JSON-RPC estándar

El servidor SHALL despachar únicamente `SendMessage`, `GetTask` y `CancelTask` (PascalCase, sin prefijo `a2a/` — mismos nombres reales de v1.0.0 que consume el Cliente A2A del Hito 6). Cualquier otro `method` (incluidos `SendStreamingMessage`, `ListTasks`, `SubscribeToTask`) SHALL responder el error JSON-RPC estándar de método no encontrado (`-32601`), nunca un `500` ni un cuelgue (ADR 86, ADR 92 punto 1).

#### Scenario: Los tres métodos soportados se despachan por su nombre real
- GIVEN un sobre JSON-RPC con `method: "SendMessage"`, `"GetTask"` o `"CancelTask"`
- WHEN el servidor lo procesa
- THEN despacha al handler correspondiente

#### Scenario: Un método no soportado responde `-32601`, no un 500
- GIVEN un sobre JSON-RPC con `method: "ListTasks"` o `"SendStreamingMessage"`
- WHEN el servidor lo procesa
- THEN responde el error JSON-RPC estándar de método no encontrado, con status HTTP `200` y el `error` en el cuerpo del sobre — no un `500`

### Requirement: `SendMessage` responde `TASK_STATE_SUBMITTED` en la misma respuesta HTTP; `GetTask` es una lectura pura

`SendMessage` SHALL responder, en la misma respuesta HTTP, un `Task` con `status.state = "TASK_STATE_SUBMITTED"` y un `id` no vacío, sin esperar a que el turno del Núcleo complete. `GetTask` SHALL ser una operación de solo lectura: SHALL NOT invocar al modelo, SHALL NOT ejecutar ningún turno, y un `task_id` inexistente SHALL responder el error JSON-RPC de tarea no encontrada (ADR 87 puntos 1 y 6).

#### Scenario: `SendMessage` responde `SUBMITTED` sin esperar el turno
- GIVEN una llamada `SendMessage` autenticada y por debajo del tope de turnos en vuelo
- WHEN el servidor la procesa
- THEN responde en esa misma llamada HTTP un `Task` con `status.state = "TASK_STATE_SUBMITTED"` y un `id` no vacío

#### Scenario: `GetTask` nunca dispara un turno
- GIVEN una tarea existente en cualquier estado
- WHEN se consulta con `GetTask`
- THEN la respuesta se sirve sin ninguna invocación al modelo ni efecto colateral

#### Scenario: `GetTask` de un `task_id` inexistente responde error de tarea no encontrada
- GIVEN un `id` que no corresponde a ninguna tarea conocida
- WHEN se consulta con `GetTask`
- THEN el servidor responde el error JSON-RPC de tarea no encontrada, no un `Task` vacío ni un `500`

### Requirement: `CancelTask` marca la tarea como cancelada con honestidad declarada — no interrumpe el cómputo en vuelo

`CancelTask` SHALL marcar la tarea como `TASK_STATE_CANCELED` y descartar el resultado que el turno en vuelo eventualmente produzca. `CancelTask` SHALL NOT interrumpir la invocación al modelo ya lanzada (ADR 92 punto 4).

#### Scenario: `CancelTask` sobre una tarea en vuelo la marca `CANCELED`
- GIVEN una tarea en `TASK_STATE_WORKING`
- WHEN se invoca `CancelTask` sobre su `id`
- THEN un `GetTask` posterior devuelve `TASK_STATE_CANCELED`

#### Scenario: El resultado del turno cancelado no se escribe como completado
- GIVEN `CancelTask` ya marcó la tarea como `CANCELED`
- WHEN el turno subyacente eventualmente termina
- THEN ese resultado no sobrescribe el estado `CANCELED` con `TASK_STATE_COMPLETED`

### Requirement: Tope de turnos en vuelo — superado, `SendMessage` responde `TASK_STATE_REJECTED` y persiste la fila sin `caso`

Cuando el número de turnos en vuelo alcanza el tope configurado, `SendMessage` SHALL responder un `Task` con `status.state = "TASK_STATE_REJECTED"`, y la fila de trazabilidad correspondiente SHALL persistirse sin crear ningún `caso` (ADR 90 punto 4).

#### Scenario: Superado el tope, `SendMessage` responde `REJECTED` sin crear caso
- GIVEN el número de turnos en vuelo ya en el tope configurado
- WHEN llega un `SendMessage` adicional
- THEN responde `Task{ status.state: "TASK_STATE_REJECTED" }`, y la fila de trazabilidad se persiste sin `caso_id`

#### Scenario: Por debajo del tope, la solicitud procede normalmente
- GIVEN el número de turnos en vuelo por debajo del tope configurado
- WHEN llega un `SendMessage`
- THEN se crea el `caso` y se responde `TASK_STATE_SUBMITTED`, no `REJECTED`

### Requirement: Servidor a mano sobre `node:http`, testeable con dobles planos — ningún test del suite por defecto abre un puerto

El servidor SHALL implementarse a mano sobre `node:http`, sin `@a2a-js/sdk` ni Express. El listener SHALL ser testeable con dobles planos de request/response, sin abrir ningún socket real. El repo SHALL tener exactamente un archivo de test que abra un puerto efímero real para este adaptador (ADR 86).

#### Scenario: El listener se testea sin abrir un socket
- GIVEN un doble plano de request/response con un sobre `SendMessage` válido
- WHEN se invoca el listener directamente
- THEN produce la respuesta esperada sin que el test abra ningún puerto

#### Scenario: Un único archivo de test abre un puerto efímero real
- GIVEN la suite completa del proyecto
- WHEN se ejecuta `npm test`
- THEN solo `src/test/integration/a2a-server.integration.test.ts` abre un socket real contra este adaptador; el resto usa dobles

### Requirement: Drenaje de turnos en vuelo al cerrar, con techo — nunca deja un `unhandledRejection`

Al cerrar, el servidor SHALL dejar de aceptar nuevas conexiones y SHALL esperar los turnos en vuelo hasta un techo de tiempo configurado (molde `Set<Promise>` + `WEB_CLOSE_TIMEOUT_MS` de `web/server.ts:504` y `webhooks/server.ts:259`). Agotado el techo, `close()` SHALL resolver igual — SHALL NOT rechazar nunca.

#### Scenario: Cerrar con turnos en vuelo drena hasta el techo
- GIVEN turnos en vuelo por debajo del techo de tiempo de cierre
- WHEN se invoca `close()`
- THEN espera a que terminen antes de resolver

#### Scenario: Agotado el techo, `close()` resuelve igual, sin rechazar
- GIVEN un turno en vuelo que no termina dentro del techo de cierre
- WHEN se invoca `close()`
- THEN resuelve de todos modos al agotarse el techo, loguea el evento de cierre con turnos en vuelo, y no produce ningún rechazo ni `unhandledRejection`

### Requirement: El `Task` devuelto es parseable por el Cliente A2A propio, sin modificarlo

El `Task` que el servidor devuelve en `SendMessage` y `GetTask` SHALL ser parseable por `TaskLike` del Cliente A2A del Hito 6 (`id`, `status.state`, y el texto del resultado accesible desde `artifacts` o `status.message`) sin ningún cambio de ese cliente (ADR 92 punto 8).

#### Scenario: El ciclo completo funciona contra el Cliente A2A real
- GIVEN un `SendMessage` seguido de polling de `GetTask` hasta `TASK_STATE_COMPLETED`
- WHEN se ejercita con `delegarTarea` del Cliente A2A del Hito 6, sin modificarlo
- THEN el ciclo completa con el texto del resultado extraído correctamente
