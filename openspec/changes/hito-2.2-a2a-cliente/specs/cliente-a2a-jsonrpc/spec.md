> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Se corrió `graphify query "dispatch-delegation despacharDelegacion DestinoDelegacion resolverDestino DelegacionA2ANoImplementadaError"` (`graphify-out/graph.json` existe) antes de abrir `dispatch-delegation.ts`. Este spec se apoya en `proposal.md` (ADR 71, 72, 73, 75, R4, R6, R8, R9, R11) y verifica su molde estructural contra código real ya leído completo: `src/adapters/notificaciones/email-client.ts` (`FetchFn`, `ERROR_BODY_MAX_CHARS = 500`, `truncate()`, `AbortSignal.timeout`, `error.name === "TimeoutError"`, sin reintentos) y `src/adapters/git/config.ts` (`resolvePositiveNumber`/`resolveNonBlankString`, "nunca lanza", duplicación deliberada de infraestructura de adaptador). No hay spec previa de esta capability — es un spec completo, no una delta. La propuesta la separa de `delegacion-a2a-saliente` porque tiene requirements que esa capability no puede reclamar (el cuerpo de error se trunca a 500 caracteres; un `TaskState` no reconocido es `protocolo`, no un crash) y se verifica con una categoría de test distinta: integración real gateada contra un agente A2A v1.0.0, además de dobles puros.

# Cliente A2A JSON-RPC Specification

## Purpose

Capability nueva. Cubre ADR 71, 72 punto 5, 73 y 75 de `proposal.md`, y la mitad **cliente** de la Caja Negra 5 / I4 del arc42 (líneas 188-198, 226-232): el adaptador que le habla, por primera vez, a un agente A2A externo real — resolución de un destino ya conocido a su Agent Card, los tres métodos JSON-RPC 2.0 reales de la especificación v1.0.0 (`SendMessage`, `GetTask`, `CancelTask`), el loop de polling con su intervalo fijo y su timeout total, la clasificación de fallas de transporte vs. protocolo, y el truncado del cuerpo de un error HTTP a un tamaño acotado. Sigue el mismo molde estructural que los otros adaptadores HTTP salientes del repo (`github-client.ts`, `email-client.ts`): `FetchFn` inyectable como *seam* de test, `AbortSignal.timeout` por request, cero reintentos, cero backoff.

**Fuera de alcance de este spec**: la decisión de **a quién** delegar — qué clave de destino usar y cuándo — pertenece al caso de uso que invoca la capability `delegacion-a2a-saliente`, no a este adaptador; el puerto inyectable que el núcleo consume, el vocabulario `TASK_STATE_*` como terminología del núcleo, la persistencia en `delegaciones_a2a` y la falla tipada que propaga hacia el Despachador — capability `delegacion-a2a-saliente`; streaming (`SendStreamingMessage`), eventos `status-update`/`artifact-update`, push notifications; un segundo servidor de escucha o cualquier extensión de `src/adapters/webhooks/` (que es exclusivamente de entrada); caché del Agent Card; compatibilidad con A2A v0.3.0; transportes REST y gRPC del protocolo; autenticación más allá de un `Authorization: Bearer` opcional por destino; reintentos y backoff; automatizar el arranque de los samples de Python de `a2a-samples`.

## Requirements

### Requirement: El Agent Card se busca en la URL bien conocida de v1.0.0; el endpoint JSON-RPC sale de ahí, no de la configuración

Dada la URL base de un destino ya resuelto (capability `delegacion-a2a-saliente`), el adaptador SHALL obtener el Agent Card con `GET <base>/.well-known/agent-card.json` (ruta de v1.0.0, no `/.well-known/agent.json` de v0.3.0), validar que trae al menos `name`, `url` y una declaración de transporte JSON-RPC, y usar el `url` del card como endpoint JSON-RPC efectivo para los tres métodos. El adaptador SHALL NOT cachear el Agent Card entre delegaciones — se busca una vez por delegación.

#### Scenario: Agent Card válido resuelve el endpoint JSON-RPC efectivo
- GIVEN una URL base configurada para un destino, con un Agent Card real disponible en `/.well-known/agent-card.json`
- WHEN el adaptador resuelve el destino antes de enviar la tarea
- THEN usa el `url` declarado en ese card como endpoint de `SendMessage`/`GetTask`/`CancelTask`

#### Scenario: Dos delegaciones consecutivas al mismo destino buscan el card dos veces
- GIVEN dos delegaciones sucesivas hacia la misma clave de destino
- WHEN cada una se ejecuta
- THEN cada una hace su propio `GET .well-known/agent-card.json`, sin reusar una respuesta de la delegación anterior

#### Scenario: Agent Card inaccesible por red clasifica como falla de transporte
- GIVEN el host de la URL base no responde o rechaza la conexión
- WHEN el adaptador intenta obtener el Agent Card
- THEN la delegación falla con `reason = "transporte"`, sin llegar a intentar ningún método JSON-RPC

#### Scenario: Agent Card sin los campos mínimos clasifica como falla de protocolo
- GIVEN el Agent Card responde `200` pero el cuerpo no trae `url` o no declara transporte JSON-RPC
- WHEN el adaptador lo valida
- THEN la delegación falla con `reason = "protocolo"`, sin intentar `SendMessage`

### Requirement: Los tres métodos JSON-RPC son los nombres reales de v1.0.0, sin el prefijo `a2a/`

El adaptador SHALL enviar los tres métodos JSON-RPC 2.0 con sus nombres reales de la especificación v1.0.0 — `SendMessage`, `GetTask`, `CancelTask`, PascalCase, sin prefijo — y SHALL NOT enviar `a2a/sendMessage`, `a2a/getTask` ni `a2a/cancelTask` (los nombres que cita el Plan de Implementación, verificados como incorrectos contra la especificación real por `exploration.md` de este change).

#### Scenario: El sobre JSON-RPC de `SendMessage` usa el método real
- GIVEN una tarea lista para enviar a un destino resuelto
- WHEN el adaptador arma la solicitud
- THEN el campo `method` del sobre JSON-RPC es exactamente `"SendMessage"`

#### Scenario: `GetTask` y `CancelTask` usan sus métodos reales
- GIVEN una tarea ya iniciada con un `task.id`
- WHEN el adaptador consulta su estado o la cancela
- THEN los sobres JSON-RPC usan `method: "GetTask"` y `method: "CancelTask"` respectivamente, ninguno con el prefijo `a2a/`

### Requirement: `SendMessage` inicia la tarea; un loop de `GetTask` a intervalo fijo espera hasta estado terminal o timeout total

El adaptador SHALL enviar `SendMessage` una única vez por delegación, obtener el `task.id` de la respuesta, y luego consultar `GetTask` a un intervalo fijo (`pollIntervalMs`, default `1_500` ms) hasta que `status.state` alcance un valor terminal o se agote un timeout total de reloj (`taskTimeoutMs`, default `120_000` ms). Cada llamada HTTP individual (`SendMessage`, cada `GetTask`, `CancelTask`) SHALL tener su propio timeout por request (`requestTimeoutMs`, default `30_000` ms), independiente del timeout total.

#### Scenario: `SendMessage` se envía una sola vez por delegación
- GIVEN una delegación en curso
- WHEN el adaptador ejecuta el ciclo completo, sin importar cuántas veces consulte `GetTask`
- THEN `SendMessage` se invoca exactamente una vez

#### Scenario: El intervalo entre consultas de `GetTask` es el configurado, verificable sin dormir de verdad
- GIVEN un reloj y un `fetch` inyectados en el test, con `pollIntervalMs` configurado
- WHEN la tarea permanece en un estado no terminal durante varias consultas
- THEN el tiempo simulado entre cada `GetTask` sucesivo coincide con `pollIntervalMs`, sin que el test duerma tiempo real

#### Scenario: Estado terminal alcanzado antes del timeout total corta el loop
- GIVEN una tarea que alcanza `TASK_STATE_COMPLETED` en la tercera consulta de `GetTask`
- WHEN el loop de polling procesa esa respuesta
- THEN el loop se detiene ahí, sin más consultas, y el resultado se entrega con el texto de la tarea completada

#### Scenario: Timeout de un request individual no agota necesariamente el timeout total
- GIVEN una única llamada a `GetTask` excede `requestTimeoutMs`
- WHEN esa llamada individual falla por timeout
- THEN la falla se clasifica como transporte para esa consulta, y el loop de polling puede seguir reintentando hasta agotar `taskTimeoutMs` (sin reintento automático de la llamada fallida en sí — ADR 71: cero reintentos)

### Requirement: `CancelTask` es best-effort al agotar el timeout total, y nunca cambia el desenlace ya decidido

Cuando el timeout total (`taskTimeoutMs`) se agota sin que la tarea alcance un estado terminal, el adaptador SHALL intentar `CancelTask` una vez, best-effort. El resultado de ese intento — éxito o fallo — SHALL NOT alterar el desenlace de la delegación, que ya quedó decidido como fallo por timeout antes de intentar la cancelación.

#### Scenario: `CancelTask` exitoso no cambia el `reason` de timeout
- GIVEN el timeout total se agotó con la tarea todavía en `TASK_STATE_WORKING`
- WHEN el adaptador intenta `CancelTask` y el agente externo confirma la cancelación
- THEN la delegación de todos modos falla con `reason = "timeout"`, no con un `reason` distinto derivado de la cancelación

#### Scenario: `CancelTask` fallido no enmascara ni agrava el error real
- GIVEN el timeout total se agotó y el intento de `CancelTask` también falla (red, HTTP, o el agente ya no responde)
- WHEN el adaptador procesa ese resultado
- THEN la delegación falla igual con `reason = "timeout"`, y el fallo de `CancelTask` se registra sin propagarse como un segundo error ni reemplazar al primero

### Requirement: Clasificación de fallas en `transporte` (red/HTTP/timeout de request) vs. `protocolo` (JSON-RPC `error` o `TaskState` no reconocido)

El adaptador SHALL clasificar toda falla de un intercambio JSON-RPC en exactamente una de dos categorías: `"transporte"` (fallo de red, `AbortSignal.timeout` disparado, o un `!response.ok` HTTP) o `"protocolo"` (la respuesta JSON-RPC trae un campo `error`, o `status.state` no es ninguno de los ocho valores `TASK_STATE_*` conocidos). El adaptador SHALL NOT dejar pasar un `TaskState` desconocido como si fuera un estado válido, y SHALL NOT lanzar una excepción no tipada ni un `as any` ante un campo del protocolo no reconocido — todo lo no tipado se ignora sin fallar, salvo el propio `status.state`.

#### Scenario: Un `TaskState` no reconocido produce `reason = "protocolo"`, no un crash
- GIVEN una respuesta de `GetTask` con `status.state` igual a un string que no es ninguno de los ocho valores `TASK_STATE_*` de la especificación
- WHEN el adaptador procesa esa respuesta
- THEN la delegación falla con `reason = "protocolo"`, sin lanzar una excepción no capturada

#### Scenario: Una respuesta JSON-RPC con `error` clasifica como protocolo
- GIVEN el agente externo responde con un sobre JSON-RPC que trae el campo `error` en vez de `result`
- WHEN el adaptador procesa esa respuesta
- THEN la delegación falla con `reason = "protocolo"`

#### Scenario: Un fallo de red o un `!response.ok` clasifica como transporte
- GIVEN la conexión HTTP falla, o el agente externo responde con un status HTTP fuera del rango `2xx`
- WHEN el adaptador procesa ese intercambio
- THEN la delegación falla con `reason = "transporte"`

#### Scenario: Un campo desconocido del protocolo no tipado se ignora sin fallar
- GIVEN una respuesta de `GetTask` que trae campos adicionales no contemplados por los tipos del adaptador, junto a un `status.state` válido
- WHEN el adaptador la procesa
- THEN esos campos se ignoran y el procesamiento continúa normalmente sobre `status.state`

### Requirement: El cuerpo de un error HTTP se trunca a 500 caracteres, y ninguna credencial aparece en ningún mensaje

El adaptador SHALL truncar el cuerpo de cualquier respuesta de error HTTP a `500` caracteres antes de incluirlo en el mensaje de la falla tipada. El adaptador SHALL NOT incluir el valor del header `Authorization` (o cualquier credencial de destino) en ningún mensaje de error ni evento de log.

#### Scenario: Cuerpo de error largo se trunca a 500 caracteres
- GIVEN el agente externo responde con un status `!= 2xx` y un cuerpo de error de más de 500 caracteres
- WHEN el adaptador construye el error tipado
- THEN el mensaje incluye como máximo los primeros 500 caracteres del cuerpo original

#### Scenario: Cuerpo de error corto se incluye completo
- GIVEN un cuerpo de error de menos de 500 caracteres
- WHEN el adaptador construye el error tipado
- THEN el mensaje incluye el cuerpo completo, sin truncar

#### Scenario: Ningún mensaje de error ni evento contiene el `Authorization: Bearer` configurado para el destino
- GIVEN un destino configurado con un `Authorization: Bearer` opcional
- WHEN cualquier llamada a ese destino falla, por la razón que sea
- THEN ningún mensaje de error ni evento de log contiene el valor de ese header

### Requirement: No existe una firma pública por la que un caso, un prompt, un webhook o un comando pueda inyectar una URL de destino arbitraria

El adaptador SHALL exponer únicamente funciones que reciben una clave de destino ya resuelta (capability `delegacion-a2a-saliente`) — nunca una URL arbitraria como parámetro de entrada público. Esto SHALL ser verificable por inspección de las firmas expuestas del adaptador, no solo por convención documental (mismo criterio que el requirement equivalente de `escritura-aislada-worktree` sobre los constructores de argv de `git`).

#### Scenario: Ninguna función pública del adaptador acepta una URL de destino como parámetro directo
- GIVEN el conjunto completo de funciones exportadas del adaptador A2A
- WHEN se inspeccionan sus firmas
- THEN ninguna acepta una URL arbitraria de entrada — todas reciben una clave de destino ya resuelta contra el registro estático

### Requirement: Único test con red real, gateado por sondeo del Agent Card — el resto de la suite usa dobles puros

El repo SHALL tener exactamente un archivo de test que abra un socket real contra un agente A2A, gateado con `describe.skipIf`. La disponibilidad SHALL determinarse haciendo un `fetch` real al Agent Card del endpoint configurado, con timeout corto — no por la mera presencia de una variable de entorno. Cuando el agente configurado no responde a ese sondeo, la suite SHALL degradar a *skip*, no a falla.

#### Scenario: Sin agente A2A disponible, el test de integración se saltea, no falla
- GIVEN ningún endpoint A2A configurado responde al sondeo del Agent Card
- WHEN se corre la suite completa (`npm test`)
- THEN el archivo de integración de A2A aparece como *skipped*, y el resto de la suite pasa igual

#### Scenario: Un endpoint configurado pero con el servidor caído no produce una falla espuria
- GIVEN una variable de entorno de endpoint está configurada mientras el servidor detrás de esa URL está apagado
- WHEN se corre la suite completa
- THEN el gate sondea el card real, lo encuentra inalcanzable, y el test se saltea — no falla por confiar ciegamente en que la variable estaba puesta

#### Scenario: Un test de núcleo nunca abre un socket real
- GIVEN cualquier test fuera de `src/test/integration/a2a-client.integration.test.ts`
- WHEN esa suite corre
- THEN ningún `fetch` real sale hacia la red — todos los dobles satisfacen `FetchFn` sin tocar un socket
