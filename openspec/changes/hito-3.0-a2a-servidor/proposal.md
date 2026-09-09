# Propuesta: Comunicación A2A entrante — Servidor A2A (v3.0.0)

**Origen**: [Plan de Implementación](../../../docs/Plan_Implementacion_Harness_Empresarial.md) **Hito 7** (líneas 368-400) · [`exploration.md`](exploration.md) de este change · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Negra 5 (Adaptador A2A, líneas 188-198), **I4** (líneas 226-232), **Caja Blanca 3.2** (Servidor A2A, líneas 362-370), **Escenario de ejecución 6** (líneas 614-620), **Riesgo 2** (líneas 632-636) · mitad servidor de la **Deuda 2** del arc42, cuya mitad cliente cerró `hito-2.2-a2a-cliente`.

**Rama prevista**: `hito/v3.0-a2a-servidor` · **Tag de cierre**: `v3.0.0` · **Carpeta de progreso**: `docs/progreso/v3.0-a2a-servidor/`.

**Último hito del Plan.** Cierra el objetivo específico 7 del Alcance por completo.

---

## Aclaración previa 1: la versión del Plan es correcta (a diferencia del Hito 6)

La exploración lo verificó y no hay nada que corregir: `docs/progreso/` tiene `v1.0`, `v1.1`, `v1.2`, `v1.4`, `v2.0`, `v2.1` — ni `v2.2` ni `v3.0` existen. `v3.0.0` / `docs/progreso/v3.0-a2a-servidor/` se usa **tal cual el Plan lo asigna** (línea 400). El nombre de este change, `hito-3.0-a2a-servidor`, es válido y no colisiona con ningún directorio previo de `openspec/changes/`.

## Aclaración previa 2: qué cierra esta propuesta y qué NO

La exploración cerró con **siete preguntas abiertas**, todas de arquitectura. Esta propuesta **toma posición en las siete** y las formaliza como **ADR 86-92**. Las que quedan genuinamente abiertas para `design.md` no son decisiones de arquitectura sino de bajada a firmas y strings concretos — están listadas al final como **RD-32 a RD-35**, con su motivo.

| # exploración | Pregunta | Decisión de esta propuesta | ADR |
|---|---|---|---|
| **7** | Forma del servidor HTTP: `node:http` a mano vs. `@a2a-js/sdk` + Express | **`node:http` a mano** — con un argumento propio que la exploración no tenía (ver ADR 86 pto 3) | **86** |
| **1** | Síncrono vs. asíncrono en `SendMessage` | **Asíncrono**: `TASK_STATE_SUBMITTED` inmediato, turno en segundo plano, `GetTask` es el canal del resultado | **87** |
| **4** | ¿El servidor exige autenticación? | **SÍ, en este hito**: bearer token único, declarado en `securitySchemes`. El token **es** el interruptor del servidor | **88** |
| **3** | Identidad del llamador / `agente_externo_url` | **Ninguna de las tres de la exploración**: la columna queda **nullable y hoy siempre `NULL`**, y se agrega `origen_transporte` con el hecho observable. Sin header propietario | **89** |
| **5** | Clave de `KeyedQueue` para tráfico entrante | **Sin cola**, con precedente verificado en el repo — más un **tope de turnos en vuelo**. Así es como el Riesgo 2 "aguanta" | **90** |
| **2** | ¿Puerto de núcleo propio o tabla de trazabilidad del adaptador? | **Trazabilidad del composition root.** El núcleo **no gana ningún puerto** y **no se modifica ningún archivo de núcleo existente** | **91** |
| **6** | Contenido del Agent Card | Superficie declarada: **tres métodos**, `capabilities` las tres en `false`, **una skill genérica**, sin `ListTasks` | **92** |

---

## Dependencia de secuencia (gate duro de `sdd-apply`)

Mismo rango que el checkpoint humano, y misma situación que `hito-2.2` tuvo con `hito-2.1`:

| Qué | Estado real verificado | Consecuencia si se ignora |
|---|---|---|
| `hito-2.2-a2a-cliente` **mergeado a `main`** con tag `v2.2.0` | **No cumplido.** Rama actual `hito/v2.2-a2a-cliente`, **20 de 23 tareas** commiteadas, sin Reviewer, sin merge, sin tag. Todo el Cliente A2A vive sólo en esa rama | Este hito ramificaría de una `main` sin `src/adapters/a2a/`, sin `src/core/agents/a2a-contract.ts` y sin la migración `0010` — es decir, sin **todo** lo que reusa |
| Numeración de migración | Techo real **`0010_delegaciones_a2a.ts`** (en la rama, no en `main`). `solicitudes_a2a_entrantes` es **`0011`** *si y sólo si* `v2.2.0` ya está mergeada | Un `index.ts` reordenado — justo lo que la convención de migraciones prohíbe |
| Numeración de ADR / RD | `hito-2.2` cierra en **ADR 85** (`proposal.md`, enmienda posterior al diseño) y **RD-31** (`design.md` §13) | Colisión en el registro de decisiones del proyecto |

**Verificación ejecutable del gate**: `git tag -l | grep -x v2.2.0` **y** `git ls-tree main --name-only src/adapters/a2a/` con salida no vacía. Sin las dos cosas, `sdd-apply` se detiene y reporta `blocked`.

**Lo que sí avanza en paralelo**: `sdd-spec`, `sdd-design`, `sdd-tasks`. Ninguno toca código. La condición que arrastran es de **citación**: todo objeto de `hito-2.2` que se nombre acá se cita como referencia, y `sdd-design` lo revalida contra el código real cuando ese hito cierre.

---

## Intent

`v2.2.0` deja al arnés cruzando la frontera del proceso **en una sola dirección**: sabe elegir un agente externo, hablarle A2A y esperar su resultado. Pero sigue siendo, de punta a punta, un sistema que **sólo se inicia desde adentro** — un empleado en la TUI, un webhook de GitHub, un `POST` del canal web de ventas. Nadie de afuera puede *pedirle* algo al arnés. El arnés es cliente de otros; no es agente de nadie.

Este change invierte esa flecha por primera y última vez en el Plan: el arnés **publica su propio Agent Card**, escucha JSON-RPC, y un agente externo — el ejemplo del Plan es "un agente de Compras de otra área" — puede consultarlo como consultaría a cualquier otro agente A2A del ecosistema. Es lo que convierte al arnés de un consumidor de agentes en un **nodo del grafo**: la madurez `v3` del ADR 1 del arc42 (`v1.x` MVP lineal · `v2.x` swarm · `v3.x` grafo).

El criterio de aceptación más duro no es "responde JSON-RPC". Es el **Escenario de ejecución 6 del arc42**, textual: *"el arnés traduce la solicitud JSON-RPC (I4) a un turno del Núcleo… usando el mismo Selector de Turno que atiende al Empleado — **no existe un camino de código separado para solicitudes A2A**"*. Este change lo cumple de la forma más fuerte posible y verificable: **no modifica ni un solo archivo existente de `src/core/`**. El Selector de Turno (`handleTurn`) recibe un `casoId` y un prompt, exactamente igual que cuando lo invoca la TUI, el webhook de GitHub o `POST /soporte`. El adaptador nuevo no le enseña nada al núcleo; sólo le trae trabajo (ADR 91).

Y hay una honestidad que corresponde declarar acá, no descubrir en el review: **el hallazgo de mayor impacto de la exploración es que el protocolo A2A no transporta la identidad del que llama**. El Plan escribió `agente_externo_url TEXT NOT NULL -- quién invocó, según su Agent Card`, y eso **no es implementable de forma conforme**: `SendMessageRequest`/`Message` de `specification/a2a.proto` v1.0.0 no tienen ningún campo que identifique al emisor. Esta propuesta no lo disimula con un header propietario ni con un `"desconocido"` disfrazado de URL — lo escribe (ADR 89) y ajusta el DDL en consecuencia.

---

## Scope

### In Scope

- **Adaptador `src/adapters/a2a/server.ts`** (nuevo, la ubicación que el arc42 reserva desde el día 1, línea 368) + `server-config.ts`, `agent-card.ts`, `server-index.ts`. Servidor JSON-RPC 2.0 sobre `node:http` a mano, molde estructural literal de `src/adapters/web/server.ts` y `src/adapters/webhooks/server.ts` (ADR 86).
- **Publicación del Agent Card propio** en `GET /.well-known/agent-card.json` — ruta verificada dos veces (exploraciones de Hito 6 y Hito 7, contra `a2a.proto` y `docs/specification.md` del tag `v1.0.0`). Público, sin auth (ADR 92 pto 5).
- **Tres métodos JSON-RPC del lado servidor**: `SendMessage`, `GetTask`, `CancelTask` — los mismos tres que el Cliente A2A del Hito 6 consume, ahora del otro lado, con los nombres reales de v1.0.0 (PascalCase, sin prefijo `a2a/`; el Plan los cita mal, corrección ya asentada por ADR 71 pto 4).
- **Autenticación bearer obligatoria** sobre el endpoint JSON-RPC, con `timingSafeEqual` y chequeo de longitud previo — molde literal de `esAutorizado` (`web/server.ts:113-132`). El token **es** el interruptor: sin token, el servidor no abre puerto (ADR 88).
- **Traducción de la solicitud a un turno del Núcleo** vía un composition root nuevo (`src/build-on-a2a-entrante.ts`), molde literal de `build-on-soporte.ts`: `createCaso` → `handleTurn` → texto. **Sin tocar `handle-turn.ts` ni ningún archivo existente de `src/core/`** (ADR 91).
- **Tabla propia `solicitudes_a2a_entrantes`** con su migración (`NNNN_solicitudes_a2a_entrantes.ts`, número **por regla** al final de `migrations/index.ts` — precedente ADR 63) y sus funciones en `repository.ts`. DDL del Plan con **cinco desviaciones declaradas** (ADR 89 pto 4).
- **Máquina de estados de la solicitud entrante**, persistida: fila creada en `TASK_STATE_SUBMITTED` **antes** de responder `SendMessage` → `TASK_STATE_WORKING` al empezar el turno → `TASK_STATE_COMPLETED`/`FAILED`/`CANCELED`/`REJECTED` al terminar. `GetTask` lee esa fila y **nada más** (ADR 87).
- **Tope de turnos entrantes en vuelo**, con `TASK_STATE_REJECTED` persistido al superarse — la respuesta concreta al Riesgo 2 del arc42 (ADR 90).
- **Drenaje de turnos en vuelo al cerrar el servidor**, molde literal del `Set<Promise>` + `WEB_CLOSE_TIMEOUT_MS` de `web/server.ts:504` y `webhooks/server.ts:259`.
- **UN test de integración real** en `src/test/integration/a2a-server.integration.test.ts`: levanta el servidor en un puerto efímero y lo consulta con **el propio Cliente A2A del Hito 6**, importando `delegarTarea` directamente (que sí acepta un `DestinoA2AConfig { baseUrl, authToken? }`) — **sin ensuciar el registro cerrado `DESTINOS_A2A`**, que el ADR 72/R8 declaró cerrado por diseño. Es la vía que la exploración verificó como limpia.
- **README**: cómo levantar el servidor, qué token exportar, y cómo consultarlo con `curl`/con el propio cliente.

### Out of Scope

- **`@a2a-js/sdk` (lado servidor) y Express.** Séptimo change consecutivo sin dependencias productivas nuevas (ADR 86).
- **Los otros ocho RPCs de `AgentService`**: `SendStreamingMessage`, `ListTasks`, `SubscribeToTask`, los cuatro de push-notification config, y `GetExtendedAgentCard`. Conforme por **modelo de capacidades**, verificado por la exploración contra `docs/specification.md`: el card declara `capabilities` en `false` y un método no soportado responde el error JSON-RPC estándar de método inexistente (ADR 92).
- **Conversación multi-turno con el agente externo.** El servidor **nunca emite** `TASK_STATE_INPUT_REQUIRED`: una solicitud entrante es una pregunta y una respuesta. `Message.context_id` y `reference_task_ids` se ignoran sin fallar (mismo criterio de tipos cerrados del ADR 71 pto 6). Simétrico exacto con el ADR 73 pto 2, que del lado cliente ya trata `INPUT_REQUIRED` como terminal de fracaso — el arnés no conversa con externos en ninguna de las dos direcciones.
- **Que un turno entrante ESCRIBA en el dominio del arnés.** El turno entrante es **de lectura**: no crea ni modifica `actividades`, no espeja al tablero, no corre `runActivityTurn`, no despacha la cadena Planner→Developer→Reviewer, no delega a subagentes y no dispara una delegación A2A **saliente**. Es la condición que hace verdadera la decisión de concurrencia (ADR 90/91) — si mañana se levanta, el ADR 90 se reabre, y esa es su condición de disparo escrita.
- **Registro de agentes externos conocidos** (tabla de tokens por agente, identidad verificable del llamador). Es lo que haría poblable `agente_externo_url`, y es el trabajo diferido con condición de disparo del ADR 89 pto 5.
- **Transportes REST y gRPC** del protocolo. Sólo JSON-RPC 2.0, que es lo que I4 declara (arc42 línea 232) y lo que el card declarará en `supportedInterfaces`.
- **Compatibilidad con A2A v0.3.0.** Sólo v1.0.0, mismo criterio que el ADR 71.
- **TLS / HTTPS.** El servidor habla HTTP plano, igual que `web/server.ts` y `webhooks/server.ts`. La terminación TLS es del operador (reverse proxy), no del arnés — y el token bearer sobre HTTP plano en `localhost` es exactamente el modelo de amenaza que `VENTAS_API_TOKEN` ya asume en producción hoy.
- **Multi-tenant.** `SendMessageRequest.tenant` existe en la especificación y se **ignora**: este arnés es una sola empresa.
- **Cancelación real del cómputo en vuelo.** `CancelTask` marca la solicitud como cancelada y descarta su resultado, pero **no interrumpe** la invocación al modelo ya lanzada — no hay token de cancelación en `handleTurn` y este hito no se lo agrega (ADR 92 pto 4).
- **Interfaz de operación del servidor** (listar solicitudes entrantes desde la TUI, comando `/solicitudes`). La evidencia del hito son las filas de `solicitudes_a2a_entrantes` y el log estructurado, igual que `delegaciones_a2a` en el Hito 6.

---

## Capabilities

> El repo no tiene `openspec/specs/`: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado por `Glob`: **21 nombres de capability únicos** en **29 archivos de spec** (Hitos 1.1-1.3, `tui-canal-empleado`, `hito-2.0`, `hito-2.1`, `hito-2.2`). **Ninguno colisiona** con los dos nombres de abajo.

### New Capabilities

- **`servidor-a2a-jsonrpc`** — el adaptador: publicación del Agent Card en la URL bien conocida, autenticación bearer del endpoint JSON-RPC, ruteo por `method`, parseo y validación del sobre JSON-RPC 2.0, la forma exacta del `Task` que devuelve (parseable por el propio Cliente A2A del Hito 6), el mapeo de errores JSON-RPC, el tope de body, el tope de turnos en vuelo, y el drenaje al cerrar.
- **`solicitud-a2a-entrante`** — la traducción a turno: creación del `caso` propio, el prompt sintético, la reutilización de `handleTurn` **sin camino de código paralelo** (Escenario 6 del arc42), el ciclo de vida completo de la fila de `solicitudes_a2a_entrantes` (crear antes de responder, actualizar siempre), y el carácter **de lectura** del turno entrante.

### Modified Capabilities

**Ninguna.** No hay un solo requirement vigente de ningún change anterior que este hito cambie o borre — consecuencia directa del ADR 91 (cero archivos de núcleo modificados). Es la primera vez en el proyecto que un hito no toca ninguna spec previa, y es una propiedad que el Reviewer debería poder verificar mecánicamente.

> **Nota para el checkpoint**: propongo **dos** capabilities con el mismo criterio que `hito-2.2` usó para separar `cliente-a2a-jsonrpc` de `delegacion-a2a-saliente`: se verifican con categorías de test distintas (dobles planos de request/response sin abrir puerto vs. dobles del turno) y la primera tiene requisitos que la segunda no puede reclamar (*"un `method` no soportado responde error JSON-RPC estándar, no un 500"*, *"el card se sirve sin auth y el endpoint JSON-RPC no"*). Si preferís un solo archivo de spec, colapsarlas no cambia ninguna decisión de esta propuesta.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 86-92)

La numeración **continúa exactamente donde `hito-2.2` la dejó**: arc42 (1-2), Hito 2 (3, 3.1, 4), Hito 3 (5-10), Hito 4 (11-20), `v1.4` (21-41), `hito-2.0` (42-56), `hito-2.1` (57-70), `hito-2.2` (71-85, incluido el ADR 85 de la enmienda posterior al diseño). Este change abre en el **86**. Las decisiones de nivel diseño reservan **RD-32 en adelante**.

### ADR 86: Servidor JSON-RPC **hecho a mano** sobre `node:http` — sin `@a2a-js/sdk`, sin Express

**Contexto**. La exploración verificó por búsqueda real (no de memoria) que el SDK oficial sí tiene lado servidor: `AgentExecutor` + `DefaultRequestHandler` + `A2AExpressApp` montando rutas sobre **Express**, un framework que este repo no tiene como dependencia. La exploración recomendó la Opción A por coherencia con el ADR 71 pto 6 (rechazo del SDK del lado cliente), pero dejó explícito que su recomendación **no es vinculante**. Repetir "por coherencia" sería adoptar una decisión sin volver a pensarla. Los tres argumentos de abajo son propios de este hito.

**Decisión**:

1. **`src/adapters/a2a/server.ts` nuevo, sobre `node:http`, sin dependencia nueva.** El molde no es una analogía: **este repo ya tiene DOS servidores HTTP escritos a mano**, no uno — dato que la exploración no registró y que cambia el peso del argumento. `src/adapters/webhooks/server.ts` (Hito 3) y `src/adapters/web/server.ts` (Hito 4) comparten la misma anatomía verificada archivo por archivo: recorte estructural de request/response (`WebhookRequest`/`WebRequest`), `CreateServerFn`/`CreateWebServerFn` inyectable, `pathFromUrl` recortando en el primer `?` (duplicado **a propósito**, ADR 13), tabla de respuestas exhaustiva documentada en el doc-comment, `Set<Promise>` de drenaje al cerrar con techo (`SERVER_CLOSE_TIMEOUT_MS` / `WEB_CLOSE_TIMEOUT_MS = 5_000`). El Servidor A2A es el **tercero** de la misma familia, no una excepción.
2. **`web/server.ts` es el molde MÁS CERCANO, no `webhooks/server.ts`** — y esto es una precisión sobre el Plan, que sólo nombra a Webhooks (línea 374). Verificado leyendo los dos completos: `web/server.ts` ya tiene **las cuatro** piezas que el Servidor A2A necesita y el webhook no: (a) **auth bearer con `timingSafeEqual` y chequeo de longitud previo** (`esAutorizado`, líneas 113-132); (b) **listener síncrono que delega en handlers `async` por ruta** (`void handleSoporte(...)`, línea 482) en vez de acumular chunks inline; (c) **body leído por un módulo aparte** (`leerBody`/`parseJsonBody` de `web/body.ts`) en vez de reimplementar `data`/`end`/`error`; (d) **drenaje de un turno de modelo en vuelo** con `Promise.race` contra un techo (`handleSoporte`, `SOPORTE_TIMEOUT_MS = 120_000`). El Plan pedía el molde de Webhooks; se sigue el molde de **la familia**, y el pariente más cercano es el adaptador Web.
3. **El argumento que el Hito 6 NO tuvo que hacer, y que es el decisivo: testear un servidor no es como testear un cliente.** Un cliente HTTP se testea inyectando `FetchFn` — trivial, y por eso el ADR 71 pudo rechazar el SDK sin costo de testabilidad. Un servidor no: `A2AExpressApp` monta sobre una instancia real de Express, así que adoptarlo obligaría a **abrir un puerto real en los tests o mockear Express**. El repo sostiene desde el Hito 3 el invariante contrario, escrito textualmente en `webhooks/server.ts:249` (*"`createServer` se inyecta … para que ningún test del suite por defecto abra un puerto — criterio de aceptación de la propuesta"*) y repetido en `web/server.ts`. Ese invariante no se negocia por un SDK.
4. **Segundo argumento propio: `DefaultRequestHandler` sería una SEGUNDA fuente de verdad del estado de las tareas.** El SDK administra el ciclo de vida y el almacenamiento de tareas por su cuenta. El Plan, en cambio, **manda** que ese estado viva en `solicitudes_a2a_entrantes` (línea 379-387), y el ADR 87 lo convierte en la máquina de estados que `GetTask` lee. Adoptar el SDK obligaría a duplicar ese estado o a subordinar nuestra tabla de trazabilidad al store del SDK — una inversión arquitectónica en la que el adaptador pasaría a ser dueño de un estado del que depende la trazabilidad del arnés. Es peor que una dependencia: es una dependencia **que se lleva puesto el modelo de datos que el Plan define**.
5. **Superficie real, medida**: tres métodos, un transporte, un documento estático servido en una ruta fija. El `client.ts` del Hito 6 hace el camino inverso completo — Agent Card, los tres métodos, el sobre JSON-RPC, la clasificación de errores — y es un archivo auditable. El servidor es de la misma escala.
6. **Contrapartida asumida, escrita**: la conformidad de protocolo del lado servidor es nuestra. La mitigación es la misma que el ADR 71 pto 7 eligió y que acá es **más fuerte**: el test de integración usa **nuestro propio Cliente A2A**, que ya fue verificado contra la especificación real y contra agentes de terceros en el Hito 6. Un cliente independiente probando nuestro servidor es exactamente la prueba de conformidad que un SDK no da sin correrlo.

**Alternativas consideradas**:

- *`@a2a-js/sdk` + Express*: **rechazada** por los puntos 3 y 4. Sería la opción correcta en un proyecto que necesite los once RPCs y streaming, con equipo de mantenimiento. No lo es en un arnés de pasantía cuyo Reviewer tiene que poder leer todo lo que corre.
- *Reusar `src/adapters/web/server.ts` agregándole dos rutas A2A*: **rechazada**, y por una regla explícita de `AGENTS.md`, no por gusto: el adaptador Web es el canal **del cliente final** (ventas, devoluciones, soporte), con su propio token y su propio modelo de amenaza. Meter el canal agente-a-agente ahí fusionaría dos límites de confianza distintos detrás de la misma configuración de puerto y token. Adaptador propio, `src/adapters/a2a/`, que es donde el arc42 lo puso.

### ADR 87: `SendMessage` responde **`TASK_STATE_SUBMITTED` de inmediato**; el turno corre en segundo plano; **`GetTask` es el canal del resultado**

**Contexto**. Es la asimetría real con Webhooks que la exploración detectó bien: un webhook de GitHub no espera contenido (ADR 10: `202` primero, `onEvent` sin `await`), pero un cliente A2A que llama `SendMessage` **sí parsea un `Task` del cuerpo de la respuesta** — verificado en `enviarSendMessage` de nuestro propio `client.ts`. Las tres opciones (responder ya con `SUBMITTED`, bloquear hasta terminal, o híbrido) son todas implementables.

**Decisión**:

1. **`SendMessage` responde `TASK_STATE_SUBMITTED` con el `task.id` que asignamos nosotros, y el turno arranca después, sin `await`** — el mismo gesto del ADR 10, con la única diferencia de que el cuerpo de la respuesta lleva un `Task` real en vez de estar vacío.
2. **Argumento 1 — el timeout que decide es el del OTRO.** Del lado cliente, el ADR 73 fijó `requestTimeoutMs` por request en **30 s** (`DEFAULT_A2A_REQUEST_TIMEOUT_MS`) y `taskTimeoutMs` total en 120 s. Si nuestro servidor bloqueara, encadenaría la latencia completa de un turno de modelo al `requestTimeoutMs` **del llamador**, que es un parámetro que no configuramos, no vemos y no podemos negociar. Un tercero con un timeout de 10 s haría fracasar turnos que nuestro servidor completó perfectamente. Responder `SUBMITTED` mueve la espera al mecanismo que el protocolo diseñó para eso.
3. **Argumento 2 — sin esto, la mitad del Plan sería código muerto.** El Plan manda `GetTask` (línea 392) **y** una tabla con columna `estado` (línea 384). Con respuesta síncrona, la fila iría de `SUBMITTED` a `COMPLETED` dentro de la misma llamada y `GetTask` no tendría nunca nada distinto que devolver: dos entregables del Plan quedarían vestigiales. La elección asíncrona es la única que los vuelve **necesarios**.
4. **Argumento 3 — es lo que ejercita el camino real de nuestro propio cliente.** El Cliente A2A del Hito 6 hace `SendMessage` → loop de `GetTask` a `pollIntervalMs` → estado terminal (ADR 73 pto 1). Con un servidor que responde `SUBMITTED`, el test de integración recorre **el loop de polling completo**, que es la parte del cliente que hoy sólo está verificada con reloj inyectado. El entregable end-to-end vale el doble: prueba el servidor nuevo **y** cierra la verificación real del cliente viejo.
5. **La fila se persiste ANTES de responder, y eso no es una carrera** — es una propiedad verificada del stack: `better-sqlite3` es **síncrono** (documentado textualmente en `ActivityStorePort`, `activity-contract.ts:117`), así que el `INSERT` de `solicitudes_a2a_entrantes` está commiteado antes de que se ejecute `res.end()`. Un `GetTask` que llegue un milisegundo después **siempre** encuentra la fila. Sin esta propiedad, la decisión asíncrona tendría una ventana de carrera real; con ella, no la tiene.
6. **`GetTask` no invoca nada: es una lectura de una fila.** Sin modelo, sin `await`, sin efectos. Ese es su contrato y es lo que lo hace barato de servir bajo polling.
7. **Máquina de estados, completa y sin ningún camino que quede colgado**:

| Momento | `estado` de la fila | Qué ve un `GetTask` |
|---|---|---|
| `SendMessage` aceptado, antes de responder | `TASK_STATE_SUBMITTED` | `SUBMITTED` |
| El turno empieza (post-respuesta) | `TASK_STATE_WORKING` | `WORKING` |
| `handleTurn` resuelve | `TASK_STATE_COMPLETED` + `resultado` | `COMPLETED` + texto |
| `handleTurn` rechaza (`TurnFailedError` u otro) | `TASK_STATE_FAILED` | `FAILED` |
| `CancelTask` antes de terminar | `TASK_STATE_CANCELED`, resultado descartado | `CANCELED` |
| Tope de turnos en vuelo superado (ADR 90) | `TASK_STATE_REJECTED`, sin `caso` | `REJECTED` |
| `GetTask` de un `task_id` inexistente | — | Error JSON-RPC de tarea no encontrada |

8. **Consecuencia asumida, escrita: el proceso que muere se lleva puesta la solicitud en vuelo.** Si el arnés se cierra mientras un turno entrante corre, la fila queda en `WORKING` para siempre y el llamador poll-ea hasta su propio `taskTimeoutMs`. Es el mismo riesgo exacto que `hito-2.2` declaró y aceptó como **RD-20/RD-31** del lado saliente, con la misma causa (sin asincronía real no hay reanudación, ADR 74 pto 2) y la misma respuesta: la fila **es** la evidencia de "se aceptó y no volvió". El drenaje al cerrar (`Set<Promise>` + techo, molde de `web/server.ts`) reduce la ventana, no la elimina.

**Alternativas consideradas**:

- *Bloquear hasta terminal, molde de `handleSoporte` (`Promise.race` contra `SOPORTE_TIMEOUT_MS = 120_000`, responder `504` al vencer)*: **rechazada** por los puntos 2 y 3. Es un patrón que el repo ya tiene y que funciona — pero funciona porque en `/soporte` el que espera es un navegador cuyo timeout no está en juego. Acá el que espera es un cliente A2A con su propio reloj.
- *Híbrido: esperar un timeout corto interno y responder `COMPLETED` si llegó a tiempo, `SUBMITTED` si no*: **rechazada**. Da dos formas de respuesta para la misma llamada, así que el llamador tiene que implementar los dos caminos igual — todo el costo del polling, más una rama extra. Optimiza el caso feliz a cambio de duplicar la superficie de test.

### ADR 88: **Autenticación bearer obligatoria** en el endpoint JSON-RPC, declarada en `securitySchemes` — y el token **es** el interruptor del servidor

**Contexto**. La exploración lo dejó abierto porque el Plan no menciona autenticación en absoluto y porque la especificación la hace opcional (un servidor "DEBE" rechazar credenciales inválidas **si declaró `securitySchemes`**). La pregunta era si dejarlo para v3.1 con una razón escrita.

**Decisión**:

1. **Sí, en este hito.** El argumento no es de seguridad genérica: es que **los dos adaptadores de entrada que este repo ya tiene autentican todas sus entradas**, cada uno con el mecanismo que su protocolo define. `webhooks/server.ts` verifica HMAC-SHA256 con `timingSafeEqual` y responde `401` **antes** de parsear el body (línea 194). `web/server.ts` verifica `Authorization: Bearer <VENTAS_API_TOKEN>` con `timingSafeEqual` y chequeo de longitud previo (líneas 113-132). Copiar el "molde estructural" de esos adaptadores y saltarse el único paso que ambos comparten sería copiar la forma sin la sustancia — y el Servidor A2A es el **primer** puerto del arnés pensado para tráfico de otra área, no de un sistema conocido.
2. **Un token compartido, `Authorization: Bearer`.** Es el mecanismo que la especificación A2A contempla, y es el que **nuestro propio cliente ya sabe enviar**: `DestinoA2AConfig.authToken` → `headers.Authorization = \`Bearer ${destino.authToken}\`` (`client.ts:358-359`), resuelto por `HARNESS_A2A_TOKEN_<CLAVE>` (`config.ts:97`). Cero mecanismo nuevo en el proyecto: sólo el lado que faltaba.
3. **Función de auth calcada de `esAutorizado`** (`web/server.ts:113-132`), duplicación deliberada por la regla de `AGENTS.md` que prohíbe que un adaptador importe de otro — mismo criterio ya documentado para `pathFromUrl` (ADR 13) y para `ERROR_BODY_MAX_CHARS` (ADR 71 pto 3). Incluye las dos trampas que el repo ya pagó y documentó: **token vacío ⇒ `false` sin comparar nada** (nunca "abierta por defecto") y **chequeo de longitud antes de `timingSafeEqual`**, que lanza `RangeError` con buffers de largo distinto.
4. **El token es el interruptor — y no hay un segundo interruptor booleano.** `HARNESS_A2A_ENTRANTE_TOKEN` ausente o en blanco ⇒ el adaptador devuelve `undefined`, **no abre ningún puerto**, y loguea `a2a-servidor-deshabilitado`. Molde literal de `isWebhookEnabled` + `startWebhookServer` (`webhooks/index.ts:64-67`), incluido el criterio de devolver `undefined` y no un no-op (para que `main.ts` distinga "no hay nada que cerrar" de "hay un servidor que cerrar"). **Se rechaza explícitamente un `HARNESS_A2A_ENTRANTE=on/off` simétrico a `HARNESS_A2A_SALIENTE`** (que era lo que la exploración sugería): un booleano separado del token permitiría expresar "servidor prendido, sin token" — es decir, un endpoint abierto que ejecuta turnos de modelo para cualquiera. Con el token como único interruptor, ese estado **es inexpresable**, que es el mismo criterio estructural del ADR 57 pto 4 y del ADR 78 (hacer imposible lo que no se quiere, en vez de prohibirlo con un `if`).
5. **El Agent Card declara `securitySchemes` con un esquema HTTP bearer** y se sirve **sin** autenticación. Es deliberado y conforme: el card es el documento de descubrimiento — pedirle credenciales haría el descubrimiento imposible, y lo único que revela es que hay un agente que exige token. El endpoint JSON-RPC sí exige token, siempre.
6. **`401` antes de parsear el body**, mismo orden exhaustivo que los otros dos servidores: `método + ruta → tope de body → auth → parseo JSON-RPC → despacho por method`. Ninguna fila de `solicitudes_a2a_entrantes` se crea por una llamada no autenticada — una tabla de trazabilidad que cualquiera puede llenar desde afuera no es trazabilidad, es un vector de crecimiento sin límite.
7. **Lo que este token NO da: identidad.** Un secreto compartido prueba autorización, no autoría. Por eso no alcanza para poblar `agente_externo_url` — ver ADR 89, con el que este ADR se engancha directamente.

**Alternativas consideradas**:

- *Sin auth en `v3.0.0`, "queda para v3.1"*: **rechazada**. Un endpoint sin auth que ejecuta turnos de modelo es gasto de API por invitación abierta, y la diferencia entre tenerlo y no tenerlo es una función de veinte líneas que ya está escrita dos veces en este repo.
- *HMAC del body con secreto compartido, molde de `webhooks/signature.ts`*: **rechazada**. Es más fuerte, pero **no** es lo que A2A define ni lo que ningún cliente A2A de terceros sabe hacer — y nuestro propio cliente manda `Authorization`, no una firma. Elegir HMAC sería inventar un dialecto propietario en el único adaptador cuyo punto entero es hablar un protocolo abierto.
- *mTLS / OAuth con `securitySchemes` completo*: **diferida**, sin fecha. Sin un agente externo real que lo exija, sería adivinar un flujo de credenciales (mismo argumento con que el ADR 71/75 difirió la autenticación real hacia afuera).

### ADR 89: **El protocolo no transporta la identidad del llamador** — `agente_externo_url` queda nullable y hoy siempre `NULL`; el hecho observable va en `origen_transporte`

**Contexto**. El hallazgo de mayor impacto de la exploración, verificado contra `specification/a2a.proto` del tag `v1.0.0`: `SendMessageRequest { tenant, message, configuration, metadata }` y `Message { message_id, context_id, task_id, role, parts, metadata, extensions, reference_task_ids }` — **ningún campo identifica al emisor** (`role` sólo distingue `ROLE_USER`/`ROLE_AGENT`). La identidad, según la especificación, sólo se resuelve a nivel de transporte. Y nuestro propio Cliente A2A del Hito 6 tampoco manda nada parecido (`client.ts:382-393`: sólo `messageId`/`role`/`parts`). El Plan escribió `agente_externo_url TEXT NOT NULL -- quién invocó, según su Agent Card`: **eso no es implementable de forma conforme**.

**Decisión**:

1. **Ninguna de las tres opciones de la exploración tal cual.** (a) El header propietario `X-A2A-Caller-Card-Url` se **rechaza**: rompería interoperabilidad con cualquier cliente de terceros, y además — argumento del propio repo — sería *infraestructura sin consumidor*, porque nuestro propio cliente no lo manda y modificarlo para que lo mande sería tocar un hito cerrado para hablarle a sí mismo. El repo ya rechazó dos veces "una perilla sin consumidor propio" (`design.md` §15 ptos 1-2 de `hito-2.2`); el mismo criterio aplica acá. (b) Resolver la identidad desde el token exige un **registro de agentes conocidos** que el Plan no menciona y que el ADR 88 pto 7 deja explícitamente afuera. (c) Un `"desconocido"` guardado en una columna llamada `_url` es un dato que miente sobre su propio tipo.
2. **La columna se conserva con su nombre (simetría con `delegaciones_a2a`, que el Plan pide) pero pasa a ser `NULLABLE`, y en `v3.0.0` es siempre `NULL`.** Su comentario en la migración deja escrito por qué: *reservada — el protocolo A2A v1.0.0 no transporta esta identidad; se puebla cuando exista un registro de agentes externos autenticados*. Relajar un `NOT NULL` del DDL del Plan tiene precedente directo y citable: `0007_delegaciones.ts` y el ADR 74 pto 4 (`a2a_task_id`/`resultado` nullable, "registrar antes de invocar").
3. **Se agrega `origen_transporte TEXT NOT NULL` con el único hecho que el transporte sí provee**: la dirección remota de la conexión (`socket.remoteAddress`). No es identidad de agente y el DDL no pretende que lo sea — es lo que permite responder *"¿de dónde vino esto?"* cuando algo sale mal, que es para lo que existe una tabla de trazabilidad. Precedente de agregar una columna al DDL del Plan con justificación: ADR 74 pto 4 (`destino_clave`).
4. **DDL propuesto, con las cinco desviaciones declaradas** (mismo formato que el ADR 74 pto 4 usó para `delegaciones_a2a`):

```sql
CREATE TABLE IF NOT EXISTS solicitudes_a2a_entrantes (
  id                  TEXT PRIMARY KEY,
  a2a_task_id         TEXT NOT NULL UNIQUE,  -- lo asignamos NOSOTROS; clave de lookup de GetTask/CancelTask
  agente_externo_url  TEXT,                  -- ★ RELAJADA a nullable. Hoy SIEMPRE NULL (pto 2)
  origen_transporte   TEXT NOT NULL,         -- ★ AGREGADA: dirección remota observada (pto 3)
  caso_id             TEXT REFERENCES casos(id),  -- ★ RELAJADA: NULL en REJECTED (sin caso, ADR 90)
  mensaje_recibido    TEXT NOT NULL,         -- ★ AGREGADA: tope TAREA_DELEGADA_MAX_CHARS, simétrico a delegaciones_a2a.tarea_delegada
  estado              TEXT NOT NULL,         -- TASK_STATE_* crudo, SIN CHECK (ADR 71 pto 5)
  resultado           TEXT,                  -- ★ AGREGADA: sólo en COMPLETED. SIN ella, GetTask no tiene qué devolver (ADR 87)
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_caso ON solicitudes_a2a_entrantes(caso_id);
```

   - **`resultado` es la desviación más importante**, y no es cosmética: con `SendMessage` asíncrono (ADR 87), el texto del turno se computa después de que la request que lo originó ya respondió. Sin una columna donde persistirlo, **el resultado se pierde y `GetTask` no tiene nada que devolver**. El DDL del Plan omite esta columna porque fue escrito sin decidir la pregunta 1 de la exploración. Simétrico exacto con `delegaciones_a2a.resultado`.
   - **`a2a_task_id UNIQUE`**: es la clave por la que `GetTask`/`CancelTask` buscan. Sin índice único, el lookup es un scan y la unicidad es una convención en vez de un invariante.
   - **`estado` sin `CHECK`**: criterio de todo el esquema — el vocabulario canónico vive en el núcleo (`TASK_STATES_CONOCIDOS` de `a2a-contract.ts`), el SQL no lo conoce. Molde literal de `0010_delegaciones_a2a.ts`.
   - **Numeración por REGLA, no por número** (precedente ADR 63): se agrega **al final** de `migrations/index.ts`, sin editar ni reordenar ninguna existente. Será `0011` *si y sólo si* la `0010` de `v2.2.0` está en `main` — ver *Dependencia de secuencia*.
5. **Trabajo diferido con condición de disparo escrita**: cuando exista más de un agente externo real llamando al arnés y haga falta distinguirlos, el camino es un **registro de agentes externos** (token por agente → URL de su Agent Card), y **ese** es el momento en que `agente_externo_url` se puebla con un dato en el que se puede confiar. No antes: una columna poblada con lo que el llamador afirma de sí mismo es peor que una columna vacía, porque parece evidencia.
6. **El comentario del Plan queda corregido por escrito** en `docs/progreso/v3.0-a2a-servidor/`, junto a la corrección de nombres de método que el Hito 6 ya dejó anotada. Es el mismo tratamiento que este proyecto le dio a RD-24.

**Alternativas consideradas**:

- *Borrar la columna del todo y agregarla en v3.1*: **rechazada por poco**. Rompe la simetría con `delegaciones_a2a` que el Plan pide explícitamente (línea 376) y obliga a una migración extra más adelante, cuando el costo de dejarla nullable es cero. Es, honestamente, la alternativa más defendible de las descartadas — ver *Qué necesita el checkpoint*, punto 3.
- *Guardar el `Message.metadata` crudo del llamador como identidad*: **rechazada**. `metadata` es un campo libre que el emisor controla por completo; guardarlo como identidad es guardar una afirmación sin verificar en una columna que se va a leer como si fuera un hecho.

### ADR 90: **Sin `KeyedQueue` para el tráfico entrante** — el precedente ya existe en el repo — más un **tope de turnos en vuelo**. Así es como el Riesgo 2 "aguanta"

**Contexto**. El Plan ata este hito al Riesgo 2 del arc42 (*"Concurrencia de escritura en SQLite bajo múltiples agentes A2A (v3)"*) y afirma que *"no se resuelve de cero, se confirma que aguanta"* (línea 396). La exploración mostró que esa confirmación **no es gratis**: la cola de hoy está keyed por `proyectoId` (`build-on-activity.ts:447`), un dato que una solicitud A2A genérica no tiene, y que sin decidir la clave correcta no hay nada que confirmar.

**Decisión**:

1. **No hay cola para el tráfico entrante, y no es una omisión: es la aplicación de un criterio que este repo ya escribió.** `build-on-soporte.ts:19-20`, textual: *"**NO hay `KeyedQueue`: no hay recurso compartido que serializar. Cada consulta de soporte es un `caso` nuevo e independiente**"*. Una solicitud A2A entrante es estructuralmente idéntica a un `POST /soporte`: entrada externa, `caso` propio recién creado, un turno, un texto de vuelta. Elegir una clave sería inventar contención donde el repo ya documentó que no la hay.
2. **Por qué es cierto, verificado y no asumido.** Lo que el ADR 8 serializa es el ciclo `leer actividad → await del modelo → escribir actividad` sobre un recurso **compartido** (`proyectoId`). Un turno entrante, tal como este hito lo define, no comparte ningún recurso mutable con nadie: `handleTurn` escribe únicamente `casos`/`sesiones_agente` **de su propio `casoId`** recién creado, y la fila de `solicitudes_a2a_entrantes` es exclusiva de esa solicitud. Y `better-sqlite3` es **síncrono**, así que dos sentencias SQL no se interleavan dentro del proceso — el peligro es el `await` del medio, y acá ese `await` no tiene lectura previa que invalidar.
3. **Esa verdad depende de una condición de alcance, y por eso está en *Out of Scope* y no en una nota al pie: el turno entrante es DE LECTURA.** No crea ni modifica `actividades`, no espeja al tablero, no corre `runActivityTurn`, no despacha la cadena de roles, no delega a subagentes ni hacia afuera. **Condición de disparo escrita: el día que una solicitud entrante pueda escribir en el dominio del arnés, este ADR se reabre** y la clave correcta pasa a ser el recurso que escriba (`proyectoId` si toca un proyecto). No es "no hace falta cola"; es "no hace falta cola **mientras el turno entrante no escriba**".
4. **Lo que el nuevo patrón de tráfico SÍ trae, y que la cola nunca resolvió: caudal sin límite.** Webhooks tiene a GitHub del otro lado; el canal web tiene un navegador. El endpoint A2A tiene un agente automático que puede llamar en loop. El problema real no es corrupción de datos — es **N invocaciones simultáneas al modelo**. Se resuelve con lo mínimo que lo resuelve: un **contador de turnos en vuelo** con tope `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` (default **4**, número operativo — ver *Qué necesita el checkpoint*, punto 4). Superado el tope, `SendMessage` responde `TASK_STATE_REJECTED` y **persiste la fila igual**, sin crear `caso`.
5. **`REJECTED` no es un estado inventado para esto: es vocabulario del protocolo que nuestro propio cliente ya entiende.** `TASK_STATE_REJECTED` está en `TASK_STATES_CONOCIDOS`, `esEstadoTerminal` lo trata como terminal y `motivoDeEstadoTerminal` lo mapea a `reason: "rejected"` (`a2a-contract.ts:99-101`). Un cliente A2A nuestro que sea rechazado por saturación recibe un error tipado y legible **sin una línea de código nueva del lado cliente**. Simetría real, no declarada.
6. **El mismo contador es el `Set<Promise>` del drenaje al cerrar** (molde `web/server.ts:504`, `webhooks/server.ts:259`): una sola estructura sirve para las dos cosas — saber cuántos turnos hay en vuelo y esperarlos al cerrar. No se agregan dos mecanismos donde alcanza uno.
7. **Cómo se confirma que el Riesgo 2 aguanta, concretamente**: un test de integración con N `SendMessage` concurrentes **más** un turno de actividad de webhook sobre el mismo `proyectoId`, que afirme que ninguna fila queda inconsistente, que el tope rechaza el sobrante con `REJECTED`, y que ninguna de las dos fuentes bloquea a la otra. Eso es evidencia; "la cola de Hito 3 sigue ahí" no lo es.

**Alternativas consideradas**:

- *Una clave global fija (serializar TODO el tráfico A2A entrante entre sí)*: **rechazada**. Es lo más conservador y también lo más caro: convertiría el endpoint en estrictamente secuencial sin ningún recurso compartido que lo justifique, y bajo polling haría que la segunda solicitud espere el turno completo de la primera. Serialización sin contención es sólo latencia.
- *Keyed por identidad del llamador*: **rechazada**, y por partida doble: serializa por origen (no por recurso, que es lo que el ADR 8 serializa) y además **no hay identidad del llamador** (ADR 89). Una cola cuya clave es siempre la misma constante es la alternativa anterior con otro nombre.
- *Keyed por el `caso_id` recién creado*: **rechazada** por vacía: cada solicitud crea su propio caso, así que cada clave tendría exactamente un elemento. Es no tener cola, con el costo de mantener una.

### ADR 91: **El núcleo no gana ningún puerto ni contrato de persistencia** — molde de `build-on-soporte.ts`. Cero archivos de `src/core/` modificados

**Contexto**. La pregunta 2 de la exploración: ¿`solicitudes_a2a_entrantes` necesita un `ServidorA2APort` en el núcleo (simétrico a `DelegacionA2AStorePort` del Hito 6), o es trazabilidad del adaptador? Y por detrás, la exigencia dura del Escenario 6 del arc42: *"no existe un camino de código separado para solicitudes A2A"*.

**Decisión**:

1. **Trazabilidad del composition root. El núcleo no conoce la tabla, no gana un puerto, y no se modifica ningún archivo existente de `src/core/`.**
2. **El molde no es una analogía, es un archivo que ya hace exactamente esto**: `src/build-on-soporte.ts`, el wiring de `POST /soporte` (Hito 4). Su secuencia completa es `casoId = newId()` → `createCaso(db, { tipo: CASO_TIPO_SOPORTE, estado: "activo", … })` → `buildSoportePrompt(consulta)` (puro, en el núcleo) → `handleTurn(casoId, prompt, deps)` → `{ casoId, respuesta }`. El Servidor A2A necesita **la misma secuencia**, con `CASO_TIPO_A2A_ENTRANTE` en vez de `CASO_TIPO_SOPORTE` y con la actualización de la fila de trazabilidad alrededor. El archivo nuevo se llama `src/build-on-a2a-entrante.ts` y es hermano de `build-on-soporte.ts`/`build-on-venta.ts`/`build-on-activity.ts`, en `src/` por el mismo motivo que todos ellos (importa de `src/core/*` **y** de `src/adapters/*`, así que no puede vivir en ninguno de los dos sin volverse, estructuralmente, un adaptador hablándole a otro adaptador).
3. **Por qué NO es el molde de `runActivityTurn`/`IncomingActivityEvent`**, aunque el Plan diga "mismo molde estructural que el Adaptador de Webhooks": porque `IncomingActivityEvent` exige `proyectoId`, `repoUrl`, `referenciaExterna`, `archivosCambiados` y un `tipo` de `ACTIVIDAD_TIPOS`, y `actividades.proyecto_id` es `NOT NULL REFERENCES proyectos(id)`. Una consulta A2A genérica no tiene nada de eso — y el propio `activity-contract.ts:26-30` **ya documenta este mismo choque** para `solicitud_interna`: *"una solicitud de vacaciones no tiene proyecto — vive en su propia tabla"* (ADR 43/46). Forzar una solicitud A2A dentro de `actividades` repetiría un error que este repo ya identificó y corrigió una vez. El Plan acertó en el **espíritu** (un disparador externo se traduce en un turno) y el archivo que encarna ese espíritu sin el equipaje de GitHub es `build-on-soporte.ts`.
4. **Así se cumple el Escenario 6 en su forma más fuerte y verificable.** No hay "segundo `handleTurn`" porque no hay **ningún** archivo de núcleo tocado: el mismo `handleTurn` que atiende al Empleado desde `build-on-submit.ts`, al webhook desde `build-on-activity.ts` y al canal web desde `build-on-soporte.ts`, atiende ahora al agente externo. **`build-on-soporte.ts` ya es la prueba de que el arnés soporta una tercera entrada sin caminos paralelos; ésta es la cuarta.** El requirement correspondiente es verificable mecánicamente por el Reviewer: `git diff --stat main -- src/core/` no muestra ningún archivo modificado.
5. **Lo único nuevo en el núcleo es aditivo y puro**: una función de prompt sintético (`buildSolicitudA2APrompt`), hermana exacta de `buildSoportePrompt` (`src/core/ventas/soporte-prompt.ts`) — sin imports, testeable sin red ni modelo. Ubicación exacta del archivo: detalle de `design.md` (**RD-32**).
6. **`CASO_TIPO_A2A_ENTRANTE` no necesita migración.** Verificado: `casos.tipo` es `TEXT` sin `CHECK` y el precedente es de este mismo mes — `CASO_TIPO_CONSULTA_KPI = "consulta_kpi"` es una constante local de módulo en `build-on-comando-empleado.ts:598` (ADR 85 pto 9), y `CASO_TIPO_SOPORTE`/`CASO_TIPO_VENTA` viven en `ventas-contract.ts:49-50`.
7. **`a2a-contract.ts` se reusa tal cual, sin modificarlo**: `TASK_STATE_*`, `TASK_STATES_CONOCIDOS`, `esTaskStateConocido` y `esEstadoTerminal` son exactamente el vocabulario que el servidor necesita para poblar `estado` y construir las respuestas `Task`. Núcleo → núcleo, permitido. **Única excepción a "cero archivos de núcleo tocados": su doc-comment dice hoy *"Vocabulario del Cliente A2A saliente"* y pasa a decir *"del protocolo A2A, en sus dos direcciones"*.** Es un cambio de comentario, cero cambio de comportamiento, y se declara acá para que no se lea como una contradicción en el review.

**Alternativas consideradas**:

- *Un `ServidorA2AStorePort` en el núcleo, simétrico a `DelegacionA2AStorePort` del Hito 6*: **rechazada**. Del lado saliente ese puerto existe porque **el núcleo decide delegar** — la fila es consecuencia de una decisión de negocio (`dispatch-delegation-a2a.ts` vive en `src/core/turn-selector/` por eso). Acá el núcleo no decide nada: la solicitud ya llegó. La fila es un registro de transporte, y ponerla detrás de un puerto de núcleo le enseñaría al núcleo un concepto ("una tarea A2A entrante") que ninguna regla de negocio necesita.
- *Extender `IncomingActivityEvent` con campos opcionales para el caso A2A*: **rechazada** por el punto 3, y porque volvería opcionales campos que hoy son obligatorios en el único contrato de entrada que el arnés tiene — degradando un tipo que hoy es preciso para todos sus consumidores actuales.

### ADR 92: **Agent Card** — tres métodos, `capabilities` las tres en `false`, **una** skill genérica, sin `ListTasks`

**Contexto**. La exploración verificó dos cosas contra la fuente: (a) `AgentService` define **once** RPCs, no tres, pero la conformidad es **por capacidades declaradas** — un servidor puede soportar un subconjunto si lo declara; (b) el `AgentCard` tiene campos **requeridos** que el Plan nunca menciona, entre ellos `skills`. El Cliente A2A del Hito 6 trata `name` como best-effort al **leer** el card de un tercero, pero eso es tolerancia de lectura, no licencia para publicar un card incompleto.

**Decisión**:

1. **Se implementan exactamente tres métodos**: `SendMessage`, `GetTask`, `CancelTask` — los que el Plan pide y los que nuestro propio cliente consume. Cualquier otro `method` responde el error JSON-RPC estándar de **método no encontrado** (`-32601`), no un `500` y no un silencio. La conformidad se sostiene porque el card declara qué soportamos.
2. **`capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false }`, las tres explícitas.** No omitidas: declaradas en `false`. Es lo que convierte "no implementamos streaming" en una afirmación del protocolo en vez de en un hueco. Y no hay presión interna que lo cuestione: nuestro propio cliente usa **polling**, no streaming (ADR 73).
3. **`ListTasks` NO se implementa**, y no sólo por alcance: con un token compartido (ADR 88), un método que enumera **todas** las solicitudes entrantes le mostraría a cualquier llamador autorizado las consultas de todos los demás. Es una superficie de divulgación entre llamadores que este hito no tiene forma de acotar, y no tiene ningún consumidor (nuestro cliente nunca lo llama). Se difiere junto con el registro de agentes del ADR 89 pto 5, que es lo que permitiría acotarlo por llamador.
4. **`CancelTask` se implementa con honestidad declarada**: marca la fila en `TASK_STATE_CANCELED` y descarta el resultado del turno, **pero no interrumpe** la invocación al modelo ya lanzada — `handleTurn` no tiene token de cancelación y este hito no se lo agrega (sería un cambio del motor de ejecución, exactamente la escala que el ADR 74 pto 1 reservó para otro change). El llamador recibe `CANCELED` verdadero en términos del protocolo (no le vamos a entregar ese resultado); lo que no se le promete es que dejamos de gastar cómputo. El comportamiento exacto ante un `CancelTask` sobre una tarea ya terminal queda para `design.md` (**RD-33**).
5. **Una sola skill genérica, no skills discretas por tipo de actividad.** El punto de entrada del arnés es un **prompt libre**: `handleTurn` llama a `resolveTurn(prompt, candidateAgents)` y el ruteo lo decide el contenido, no un comando. Declarar `skills` discretas (`pr_review`, `incidente`, `solicitud_interna`) publicaría una superficie de comandos que **el código no tiene** — un card que promete lo que el arnés no expone. Una skill que describe lo que el arnés realmente hace ("consultar al arnés empresarial sobre el estado de proyectos, actividades e incidentes") es la declaración verdadera. Los strings exactos (`id`, `name`, `description`, `tags`, `examples`) son detalle de `design.md` (**RD-32**).
6. **Campos requeridos, todos poblados**: `name`, `description`, `version = "3.0.0"` (el tag del hito), `capabilities`, `defaultInputModes`/`defaultOutputModes` en `["text/plain"]` (el turno es texto adentro, `responseText` afuera), `skills` (punto 5) y `supportedInterfaces` con **una** entrada de transporte JSON-RPC.
7. **La URL pública del arnés viene por env, no se adivina.** Un servidor no puede inferir su propia URL externa desde una request. Precedente exacto en el repo: `DEFAULT_WEB_PUBLIC_URL = "http://localhost:8080"` (`web/config.ts:19`), que existe por el mismo motivo (el adaptador Web tiene que escribir links de confirmación que apunten a sí mismo). El card publica el valor de `HARNESS_A2A_ENTRANTE_PUBLIC_URL`.
8. **El `Task` que devolvemos tiene que ser parseable por nuestro propio cliente, y eso es un requirement, no una esperanza.** `TaskLike` (`client.ts`) lee `id`, `status.state`, `status.message` y `artifacts`. La forma exacta de dónde va el texto del resultado se fija en `design.md` y **se verifica en el test de integración** contra el cliente real — que es la única prueba que vale.

**Alternativas consideradas**:

- *Implementar también `ListTasks` "porque podría ser core"*: **rechazada** por el punto 3. La exploración dejó su estatus core-vs-opcional sin cerrar; el argumento de divulgación entre llamadores decide igual, sin depender de esa verificación.
- *Skills discretas atadas a `ACTIVIDAD_TIPOS`*: **rechazada** por el punto 5. Además acoplaría el card público al vocabulario interno de `activity-contract.ts` — el mismo acoplamiento que el ADR 72 rechazó del lado cliente ("derivar la clave del tipo de actividad").
- *Servir el card también bajo autenticación*: **rechazada**. Haría el descubrimiento imposible y contradice para qué existe un documento de descubrimiento.

---

## Approach

**Flujo del entregable — de la llamada JSON-RPC externa al resultado que el llamador recoge.**

```
agente externo (p. ej. "Compras")
   │  GET /.well-known/agent-card.json          ← público, sin auth (ADR 88 pto 5)
   │     └─ name, version 3.0.0, capabilities{...:false}, skills[1], securitySchemes, supportedInterfaces[JSONRPC]
   │
   │  POST /a2a   Authorization: Bearer <HARNESS_A2A_ENTRANTE_TOKEN>
   ▼
 ══════ src/adapters/a2a/server.ts ══════   (node:http a mano — ADR 86)
   método+ruta → tope de body → AUTH (401 antes de parsear) → parse JSON-RPC → despacho por `method`
        │                                                                              │
        │  method desconocido ──▶ error JSON-RPC -32601 (ADR 92 pto 1)                 │
        ▼                                                                              │
   ┌─ SendMessage ────────────────────────────────────────────────────────────────┐    │
   │   a2aTaskId = newId()                                                        │    │
   │   ¿en vuelo >= MAX_EN_VUELO?  ──sí──▶ fila REJECTED (sin caso) ──▶ responde  │    │
   │   │                                    Task{state: TASK_STATE_REJECTED}       │    │
   │   no                                                                          │    │
   │   ├─ createCaso(tipo: a2a_entrante)          ← better-sqlite3 SÍNCRONO        │    │
   │   ├─ insert solicitudes_a2a_entrantes(SUBMITTED, caso_id, origen_transporte)  │    │
   │   ├─ RESPONDE Task{ id: a2aTaskId, state: TASK_STATE_SUBMITTED }   ← ADR 87   │    │
   │   └─ recién AHORA, sin await (molde ADR 10):                                  │    │
   │        void ejecutarTurnoEntrante()  ──▶ registrado en el Set de drenaje      │    │
   │             ├─ update → TASK_STATE_WORKING                                    │    │
   │             ├─ buildSolicitudA2APrompt(texto)        ← PURO, en el núcleo     │    │
   │             ├─ await handleTurn(casoId, prompt, …)   ← EL MISMO Selector de   │    │
   │             │                                          Turno. ADR 91          │    │
   │             ├─ ok    → update COMPLETED + `resultado`                         │    │
   │             └─ error → update FAILED                                          │    │
   └───────────────────────────────────────────────────────────────────────────────┘   │
   ┌─ GetTask ─────────────────────────────────────────────────────────────────────┐   │
   │   SELECT por a2a_task_id  →  Task{ id, status.state, resultado si COMPLETED }  │◀──┘
   │   SIN modelo, SIN await, SIN efectos. Es una lectura. (ADR 87 pto 6)           │
   └───────────────────────────────────────────────────────────────────────────────┘
   ┌─ CancelTask ──────────────────────────────────────────────────────────────────┐
   │   update → TASK_STATE_CANCELED, resultado descartado.                          │
   │   NO interrumpe el turno en vuelo — declarado, no escondido (ADR 92 pto 4)     │
   └───────────────────────────────────────────────────────────────────────────────┘

 ══════ lo que NO cambia, y es el punto ══════
   src/core/turn-selector/handle-turn.ts          intacto
   src/core/activity/*                            intacto
   src/core/agents/a2a-contract.ts                reusado (sólo su doc-comment se actualiza)
   git diff --stat main -- src/core/  ⇒  ningún archivo MODIFICADO, sólo uno agregado
```

**El molde, lado a lado** — el argumento del ADR 91 en una tabla:

| Paso | `POST /soporte` (Hito 4, ya en producción) | `SendMessage` A2A (este hito) |
|---|---|---|
| Entrada externa | `web/server.ts` → `onSoporte({ consulta })` | `a2a/server.ts` → `onSolicitudA2A({ texto, … })` |
| Caso propio | `createCaso(CASO_TIPO_SOPORTE)` | `createCaso(CASO_TIPO_A2A_ENTRANTE)` |
| Prompt | `buildSoportePrompt` (puro, núcleo) | `buildSolicitudA2APrompt` (puro, núcleo) |
| Turno | `handleTurn(casoId, prompt, deps)` | **el mismo** `handleTurn(casoId, prompt, deps)` |
| Cola | ninguna, documentado en el archivo | ninguna, **mismo motivo** (ADR 90) |
| Espera | el navegador espera (con `504` al vencer) | **nadie espera**: `GetTask` recoge (ADR 87) |
| Trazabilidad | ninguna tabla propia | `solicitudes_a2a_entrantes` (lo pide el Plan) |

**Testing (TDD estricto, `strict_tdd: true`)**. La enorme mayoría es puro y con dobles planos: el listener se testea con dobles de `A2ARequest`/`A2AResponse` (recorte estructural, molde `webhooks/server.ts:30-44` y `web/http.ts`) y **ningún test del suite por defecto abre un puerto** — invariante del repo desde el Hito 3, que el ADR 86 pto 3 protege. La única categoría con socket real es `src/test/integration/a2a-server.integration.test.ts`, que levanta el servidor en un puerto efímero y lo consulta con `delegarTarea` del Hito 6. **A diferencia del test de integración del Hito 6, éste NO depende de infraestructura de terceros** (no hay sample de Python que levantar): cliente y servidor son ambos nuestros, así que **este sí puede correr en CI sin degradar a `skip`** — es la primera verificación de conformidad A2A automatizable que el proyecto tiene.

---

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/adapters/a2a/server-config.ts` | **New** | `A2AServerConfig`, `resolveA2AServerConfig(env)` (pura, nunca lanza), `isA2AServerEnabled` (token no vacío), constantes de ruta y topes — molde de `web/config.ts` + `webhooks/config.ts` (ADR 88 pto 4) |
| `src/adapters/a2a/agent-card.ts` | **New** | Construcción **pura** del Agent Card a partir de la config. Sin I/O: se testea comparando el objeto (ADR 92) |
| `src/adapters/a2a/server.ts` | **New** | `createRequestListener` con tabla de respuestas exhaustiva + auth + ruteo JSON-RPC por `method` + `startServer` con `Set` de drenaje. Molde de `web/server.ts` (ADR 86) |
| `src/adapters/a2a/server-index.ts` | **New** | `startA2AServer(deps)` — fachada opt-in, devuelve `undefined` sin token. Molde literal de `webhooks/index.ts` |
| `src/core/.../a2a-server-prompt.ts` | **New** | `buildSolicitudA2APrompt` — PURA, sin imports. Hermana de `soporte-prompt.ts`. Ubicación exacta: **RD-32** |
| `src/core/agents/a2a-contract.ts` | **Modified (doc)** | **Sólo el doc-comment**: "Vocabulario del Cliente A2A saliente" → "del protocolo A2A, en sus dos direcciones". Cero cambio de comportamiento (ADR 91 pto 7) |
| `src/build-on-a2a-entrante.ts` | **New** | `createCaso` → `buildSolicitudA2APrompt` → `handleTurn` → actualización de la fila. Molde literal de `build-on-soporte.ts` (ADR 91) |
| `src/adapters/memory/migrations/NNNN_solicitudes_a2a_entrantes.ts` | **New** | DDL del ADR 89 pto 4; número **por regla**, al final de `index.ts` |
| `src/adapters/memory/repository.ts` | **Modified** | Alta, actualización de estado y lookup por `a2a_task_id` de `solicitudes_a2a_entrantes` |
| `src/main.ts` | **Modified** | Wiring del Servidor A2A + su `close()` en el `finally`, molde del webhook y del adaptador Web |
| `src/core/logging/turn-logger.ts` | **Modified** | Eventos nuevos (`a2a-servidor-escuchando`, `a2a-servidor-deshabilitado`, `a2a-solicitud-recibida`, `a2a-solicitud-rechazada-tope`, `a2a-solicitud-no-autorizada`, `a2a-turno-entrante-completado`, `a2a-turno-entrante-fallido`, `a2a-cancelacion-recibida`) — datos, sin cambio de contrato |
| `src/test/integration/a2a-server.integration.test.ts` | **New** | Puerto efímero + `delegarTarea` del Hito 6. **Sin infraestructura de terceros; corre en CI** |
| `README.md` | **Modified** | Cómo levantar el Servidor A2A, qué token exportar, cómo consultarlo |
| `docs/ARC42_Harness_Empresarial.md` | **Modified** | Caja Blanca 3.2 deja de decir "hito posterior"; **Deuda 2** se cierra entera; **Riesgo 2** se anota como confirmado con la evidencia del ADR 90 pto 7 |
| `package.json` | — | **Sin dependencias nuevas** (séptimo change consecutivo) |
| **`src/core/` (todo lo demás)** | **— NINGUNO —** | Ningún archivo existente de núcleo modificado. Es un criterio de aceptación verificable, no una casualidad (ADR 91 pto 4) |

## Dependencias nuevas

**Ninguna.** `node:http` y `node:crypto` son de Node; el repo exige Node ≥ 20. **Séptimo change consecutivo sin dependencias productivas nuevas** — y, como en el Hito 6, esa racha **es** el ADR 86.

---

## Entregables del Hito 7 — cobertura

| # | Entregable del Plan / arc42 | Cubierto por | ¿En alcance? |
|---|---|---|---|
| 1 | El arnés es **invocable desde afuera** por un agente externo (Plan línea 372) | ADR 86 + 87 + 88; capability `servidor-a2a-jsonrpc` | **Sí** |
| 2 | Agent Card propio publicado en la URL bien conocida (Plan línea 390) | ADR 92 (`/.well-known/agent-card.json`, público) | **Sí** — con los campos requeridos que el Plan no enumeraba |
| 3 | Los tres métodos JSON-RPC del lado servidor (Plan línea 392) | ADR 87 + 92 pto 1, con los nombres reales de v1.0.0 | **Sí** — y sigue corrigiendo la cita del Plan (`a2a/sendMessage`) |
| 4 | La solicitud se traduce a un turno del Núcleo, **mismo Selector de Turno** (arc42 Escenario 6) | ADR 91 — verificable por `git diff --stat main -- src/core/` | **Sí**, en su forma más fuerte |
| 5 | Tabla `solicitudes_a2a_entrantes`, simétrica a `delegaciones_a2a` | ADR 89 pto 4 | **Sí**, con cinco desviaciones declaradas |
| 6 | Se prueba sin un tercer agente, reusando el Cliente A2A del Hito 6 (Plan línea 394) | Test de integración con `delegarTarea`, sin tocar `DESTINOS_A2A` | **Sí** — y además corre en CI |
| 7 | **Riesgo 2** del arc42 confirmado bajo el nuevo patrón de tráfico (Plan línea 396) | ADR 90, con el test de concurrencia del pto 7 como evidencia | **Sí** — confirmado con prueba, no por declaración |
| 8 | I4 ejercitada en su **segunda** dirección; **Deuda 2** del arc42 cerrada entera | Adaptador servidor nuevo | **Sí** |
| 9 | Rollback a `v2.2.0` exacto con una variable de entorno | `HARNESS_A2A_ENTRANTE_TOKEN` sin definir ⇒ ningún puerto abierto | **Sí** |
| 10 | Cierra el **objetivo específico 7** del Alcance por completo (Plan línea 398) | Todo lo anterior + `docs/progreso/v3.0-a2a-servidor/` | **Sí** — último hito del Plan |
| — | Streaming/push, `ListTasks`, multi-turno, escritura desde afuera, registro de agentes | — | **No** — ver *Out of Scope* |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **Gate de secuencia**: `sdd-apply` arranca antes de que `v2.2.0` esté en `main`. Este hito reusa `a2a-contract.ts`, `client.ts` y la migración `0010` — **todo** lo que necesita vive hoy sólo en la rama del Hito 6 | **Alta** | Sección *Dependencia de secuencia* como gate duro con verificación ejecutable. Es el mismo riesgo que `hito-2.1` y `hito-2.2` documentaron y que **volvió a incumplirse las dos veces** |
| **R2** | **El DDL del Plan se desvía en CINCO puntos** (dos `NOT NULL` relajados, tres columnas agregadas). Leído sin contexto parece que el hito reescribió el modelo de datos | **Alta** | ADR 89 pto 4, cada desviación con su motivo verificado, y la más importante (`resultado`) atada a una consecuencia funcional dura: sin ella `GetTask` no tiene nada que devolver. Se aprueba en el checkpoint, no se descubre en el review — mismo tratamiento que R7 de `hito-2.2` |
| **R3** | **`agente_externo_url` siempre `NULL` puede leerse como "la implementación quedó a medias"** | **Alta** | ADR 89 con la cita verificada de `a2a.proto`, más la corrección explícita al comentario del Plan en `docs/progreso/`. La columna lleva su motivo escrito en la migración: nadie que la lea en seis meses tiene que reconstruir el razonamiento |
| **R4** | **`SendMessage` asíncrono deja al llamador poll-eando si el proceso muere**: fila en `WORKING` para siempre | Med | Aceptado y declarado (ADR 87 pto 8). Es literalmente el mismo riesgo que `hito-2.2` aceptó como **RD-20/RD-31** del lado saliente, por la misma causa. El drenaje al cerrar acota la ventana. Reabrirlo sería un change de **motor de ejecución** (ADR 74 pto 1) |
| **R5** | **Endpoint público que ejecuta turnos de modelo**: costo de API por invitación abierta si el token se filtra o si el tope no alcanza | Med | ADR 88 (token obligatorio, inexpresable prenderlo sin token, `401` antes de parsear, ninguna fila creada sin auth) + ADR 90 pto 4 (tope de turnos en vuelo con `REJECTED` persistido). El tope es un número operativo revisable — punto 4 del checkpoint |
| **R6** | **Conformidad de protocolo propia del lado servidor**: sin SDK, un cambio de especificación no llega por `npm update` | Med | Aceptado (ADR 86 pto 6), y **mejor mitigado que en el Hito 6**: el test de integración usa nuestro Cliente A2A ya verificado contra la especificación real y contra agentes de terceros, y **corre en CI** (no degrada a `skip` como el del Hito 6, porque no depende de ningún sample de Python) |
| **R7** | **`CancelTask` no cancela el cómputo.** Un llamador puede leerlo como que dejamos de trabajar | Med | Declarado en el ADR 92 pto 4 y en el spec, no escondido. `handleTurn` no tiene token de cancelación y agregárselo es un change de motor de ejecución. El comportamiento exacto sobre una tarea ya terminal queda a `design.md` (**RD-33**) |
| **R8** | **La afirmación "el turno entrante es de sólo lectura" no está garantizada por el tipo** — es una propiedad del wiring, y de ella depende que el ADR 90 (sin cola) sea verdadero | Med | Escrita como límite de alcance duro, no como nota, con **condición de disparo** explícita. `sdd-design` debe elegir cómo hacerla verificable: lo natural es que `build-on-a2a-entrante.ts` **no reciba** `board`, `store` de actividades, `escritura` ni `ClienteA2APort` entre sus deps — que la escritura sea **inexpresable** por firma, mismo criterio del ADR 57 pto 4 / ADR 78 |
| **R9** | **Segundo (tercer) puerto HTTP en el mismo proceso**: colisión de puertos, y un `EADDRINUSE` podría voltear el arranque del arnés | Baja | Precedente resuelto: `startWebhookServer` propaga el rechazo de `listen` y **`main.ts` decide** si aborta o sigue sin webhook (`webhooks/index.ts:46-49`). Mismo criterio acá — el arnés arranca sin Servidor A2A antes que no arrancar |
| **R10** | **`skills` genérica vs. discreta** puede ser objetada por un revisor de protocolo: un card con una sola skill difusa es menos útil para descubrimiento automático | Baja | ADR 92 pto 5: una skill verdadera es mejor que tres falsas. Si el checkpoint prefiere skills discretas, exige **primero** decidir qué comandos expone el arnés hacia afuera — que es alcance nuevo, no un cambio de strings |
| **R11** | **Presupuesto de review**: servidor + card + config + fachada + wiring + migración + repositorio + prompt + integración, estimados en **~1 200-1 400 líneas** de producción | **Alta** | `sdd-tasks` debe forecastear **PRs encadenados**. Corte sugerido: **(a)** `server-config.ts` + `agent-card.ts` + migración + `repository.ts`; **(b)** `server.ts` (listener, auth, ruteo, errores JSON-RPC) sin turno; **(c)** `build-on-a2a-entrante.ts` + máquina de estados + tope en vuelo + prompt del núcleo; **(d)** fachada + wiring en `main.ts` + test de integración + README + arc42 |
| **R12** | **Es el último hito del Plan**: cerrarlo implica también cerrar Deuda 2 y anotar Riesgo 2 en el arc42, y esas ediciones suelen quedar afuera del alcance del Implementer | Med | Están **en la tabla de componentes** como `docs/ARC42_Harness_Empresarial.md` **Modified**, y en el checklist de cierre. Un hito que cierra el Plan y deja el documento de arquitectura desactualizado no cierra nada |

---

## Rollback Plan

1. **En caliente**: quitar `HARNESS_A2A_ENTRANTE_TOKEN`. `startA2AServer` devuelve `undefined`, **no se abre ningún puerto**, se loguea `a2a-servidor-deshabilitado`, y el arnés se comporta **exactamente** como `v2.2.0`. `solicitudes_a2a_entrantes` queda vacía. Es el rollback más limpio de todos los hitos del proyecto, porque el interruptor no apaga una funcionalidad: **impide que el proceso empiece a escuchar**.
2. **Migración**: la tabla es nueva y `IF NOT EXISTS`; no altera ninguna existente y ninguna otra la lee. Ninguna migración anterior se modifica.
3. **A nivel núcleo**: **no hay nada que revertir**. Ningún archivo existente de `src/core/` cambia de comportamiento (ADR 91). Si este change se revierte entero, el núcleo queda bit a bit como estaba — propiedad que ningún hito anterior pudo afirmar.
4. **A nivel git**: revertir los commits de `hito/v3.0-a2a-servidor` antes del merge a `main`. Con PRs encadenados (R11), en orden inverso: wiring → turno entrante → servidor → config + migración. Todo el adaptador es **aditivo puro** y puede quedarse mergeado sin daño (sin token, no hace nada).
5. **Nada externo que revertir**: el servidor no escribe en ningún sistema de terceros. Una solicitud entrante ya atendida gastó una invocación al modelo, pero no dejó estado nuestro afuera.

---

## Dependencies

- **`hito-2.2-a2a-cliente` mergeado a `main`** con checklist de cierre completo y tag `v2.2.0` — **gate duro de `sdd-apply`**, ver *Dependencia de secuencia*. Hoy **no** se cumple: 20/23 tareas commiteadas en la rama, sin Reviewer, sin merge, sin tag.
- **Node ≥ 20** (ya declarado en `package.json`) con `node:http`/`node:crypto`. Sin paquetes nuevos.
- **Un puerto libre** para el Servidor A2A, distinto de los del adaptador Web y de Webhooks.
- **Checkpoint humano aprobando esta propuesta** — en particular ADR 87 (asíncrono con `GetTask` como canal del resultado), ADR 88 (auth obligatoria y el token como único interruptor), ADR 89 (las cinco desviaciones del DDL y `agente_externo_url` siempre `NULL`) y ADR 90 (sin cola, con tope) — **antes** de `sdd-spec`/`sdd-design`.
- `sdd-spec` corre **primero**: `AGENTS.md` pone la especificación antes del diseño, y las dos capabilities nuevas no tienen requirements escritos.

## Success Criteria

- [ ] `GET /.well-known/agent-card.json` devuelve, **sin autenticación**, un card con `name`, `description`, `version = "3.0.0"`, `capabilities` con las tres banderas en `false`, `defaultInputModes`/`defaultOutputModes`, **una** `skill`, `securitySchemes` con bearer, y `supportedInterfaces` con **una** entrada JSON-RPC apuntando a `HARNESS_A2A_ENTRANTE_PUBLIC_URL`.
- [ ] `POST` al endpoint JSON-RPC **sin** `Authorization` válido responde `401`, **antes** de parsear el body, y **no crea ninguna fila** en `solicitudes_a2a_entrantes`.
- [ ] Un `SendMessage` autenticado responde, en la **misma** respuesta HTTP, un `Task` con `status.state = "TASK_STATE_SUBMITTED"` y un `id` no vacío — y la fila ya existe en la base **antes** de que esa respuesta se emita (verificable con un doble del store que observa el orden).
- [ ] Un `GetTask` inmediatamente posterior a ese `SendMessage` **siempre** encuentra la tarea — nunca "no encontrada" por carrera.
- [ ] Cuando el turno termina, `GetTask` devuelve `TASK_STATE_COMPLETED` **con el texto del turno**, y la fila tiene `resultado` no vacío. Si el turno falla, devuelve `TASK_STATE_FAILED` y la fila queda con ese estado — **ningún camino deja la fila en `WORKING` con el proceso vivo**.
- [ ] **El ciclo completo `SendMessage` → polling de `GetTask` → `TASK_STATE_COMPLETED` funciona contra el Cliente A2A del Hito 6 sin modificarlo**, con `delegarTarea` apuntado a un puerto efímero — y **sin agregar ninguna clave a `DESTINOS_A2A`**.
- [ ] Superado `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO`, `SendMessage` responde `TASK_STATE_REJECTED`, persiste la fila **sin `caso_id`**, y el Cliente A2A del Hito 6 lo recibe como `reason = "rejected"` **sin una línea de código nueva del lado cliente**.
- [ ] N solicitudes A2A concurrentes **más** un turno de actividad de webhook sobre el mismo `proyectoId` terminan sin ninguna fila inconsistente y sin que una fuente bloquee a la otra — **la evidencia de que el Riesgo 2 aguanta** (ADR 90 pto 7).
- [ ] Un `method` JSON-RPC no soportado (`ListTasks`, `SendStreamingMessage`) responde el error estándar `-32601`, **no** un `500` ni un cuelgue.
- [ ] `CancelTask` sobre una tarea en vuelo deja la fila en `TASK_STATE_CANCELED` y el resultado del turno **no** se escribe como `COMPLETED`.
- [ ] **`git diff --stat main -- src/core/` no muestra ningún archivo MODIFICADO** (sólo el archivo nuevo del prompt y el doc-comment de `a2a-contract.ts`) — la verificación mecánica del Escenario 6 del arc42.
- [ ] Sin `HARNESS_A2A_ENTRANTE_TOKEN`, el arnés arranca **sin abrir ningún puerto A2A**, loguea `a2a-servidor-deshabilitado`, y se comporta idéntico a `v2.2.0`.
- [ ] Cerrar el arnés con un turno entrante en vuelo **drena** con techo y no deja un `unhandledRejection`.
- [ ] `npm test` y `npm run typecheck` en verde; **ningún test del suite por defecto abre un puerto** salvo el de `src/test/integration/`, que **sí corre en CI** (no degrada a `skip`).
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v3.0-a2a-servidor/` con evidencia end-to-end (Agent Card servido, tráfico JSON-RPC de los tres métodos, filas de `solicitudes_a2a_entrantes` en sus cinco estados, y la corrida de concurrencia del Riesgo 2) **más la nota de corrección al Plan** sobre `agente_externo_url`, tag `v3.0.0`.
- [ ] `docs/ARC42_Harness_Empresarial.md` actualizado: Caja Blanca 3.2 sin "hito posterior", **Deuda 2 cerrada**, **Riesgo 2 anotado como confirmado** con su evidencia.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| **Registro de agentes externos** (token por agente → su Agent Card) | Change futuro, **con condición de disparo escrita**: cuando haya más de un agente externo real llamando y haga falta distinguirlos | ADR 89 pto 5. Es lo único que haría poblable `agente_externo_url` con un dato confiable; hoy sería una tabla sin filas |
| **Que un turno entrante ESCRIBA** en el dominio del arnés | Change futuro, **reabre el ADR 90** | ADR 90 pto 3: la ausencia de cola es verdadera *porque* el turno entrante no comparte recurso mutable. Levantar el límite exige elegir la clave de serialización antes, no después |
| **Cancelación real del cómputo en vuelo** | Junto con la asincronía real que el ADR 74 pto 2 ya difirió | Exige un token de cancelación en `handleTurn`: es un change de **motor de ejecución**, la misma escala que el ADR 74 reservó |
| **`ListTasks`** | Después del registro de agentes | ADR 92 pto 3: con un token compartido, enumerar tareas es divulgación entre llamadores. Con identidad por llamador, se acota |
| **Streaming (`SendStreamingMessage`, `SubscribeToTask`) y push notifications** | Change futuro | ADR 92 pto 2: el card las declara en `false`. Nuestro propio cliente usa polling, así que no hay presión interna en ninguna de las dos direcciones |
| **Conversación multi-turno con el agente externo** (`INPUT_REQUIRED` emitido, `context_id` honrado) | Change futuro | Simétrico del ADR 73 pto 2, que del lado cliente ya trata `INPUT_REQUIRED` como terminal de fracaso. El arnés no conversa con externos en ninguna dirección |
| **TLS / HTTPS propio** | **Nunca, mientras el operador tenga un reverse proxy** | Mismo criterio que `web/server.ts` y `webhooks/server.ts`: la terminación TLS no es del arnés |
| **Multi-tenant** (`SendMessageRequest.tenant`) | **Nunca, mientras el arnés modele una sola empresa** | El campo se ignora sin fallar, criterio de tipos cerrados del ADR 71 pto 6 |
| **Transportes REST y gRPC** | **Nunca, mientras I4 diga "JSON-RPC"** | arc42 línea 232 fija el formato de la interfaz. Es el contrato de I4, no una limitación técnica |
| **Interfaz de operación del servidor** (`/solicitudes` en la TUI) | Change futuro si hay volumen | La evidencia son las filas y el log, igual que `delegaciones_a2a` en el Hito 6 |

---

## Preguntas que esta propuesta deja ABIERTAS para `design.md` (RD-32 a RD-35)

> La numeración RD **continúa** desde `hito-2.2/design.md` §13, que cierra en **RD-31**. Ninguna de estas es una decisión de arquitectura — son bajadas a firmas y strings que exigen leer código o la especificación con más profundidad de la que corresponde a una propuesta. Las siete preguntas de la exploración están **cerradas** en los ADR 86-92.

- **RD-32 — Ubicación exacta del prompt sintético y los strings del Agent Card.** ¿`buildSolicitudA2APrompt` vive en `src/core/a2a/`, en `src/core/activity/`, o en un módulo propio? ¿Qué dicen exactamente `skill.id`/`name`/`description`/`tags`/`examples`? El ADR 91 pto 5 y el ADR 92 pto 5 fijan el **criterio** (puro y sin imports; una skill verdadera y no tres falsas); los nombres concretos requieren mirar `soporte-prompt.ts` y el card real de un sample, que es trabajo de diseño.
- **RD-33 — Semántica exacta de `CancelTask` sobre una tarea ya terminal, y el código de error JSON-RPC.** La exploración no cerró qué error define la especificación para una tarea no cancelable, y esta propuesta no lo inventa. `sdd-design` lo verifica contra `specification/a2a.proto` del tag `v1.0.0` — mismo tratamiento que RD-24 recibió en el Hito 6.
- **RD-34 — Dónde va el texto del resultado dentro del `Task`** (`status.message`, `artifacts`, o ambos) para que `TaskLike` de nuestro cliente lo lea. El ADR 92 pto 8 fija que **tiene** que ser parseable por el cliente real y que el test de integración lo verifica; la forma exacta se elige leyendo `client.ts` línea por línea.
- **RD-35 — Los números operativos**: `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` (propuesto **4**), el puerto por default, `maxBodyBytes` (candidato: `65_536`, el de `web/config.ts`) y el techo de drenaje al cerrar (candidato: `5_000`, el de los otros dos servidores). Mismo estatus que los tres números del ADR 73 y que el umbral del ADR 83: fijados con criterio, revisables en el checkpoint.

---

## Qué necesita el checkpoint humano antes de `sdd-spec` / `sdd-design`

> Las siete preguntas de la exploración están **decididas** arriba. Lo que sigue son los cuatro puntos donde tu decisión puede cambiar un ADR, más el gate.

1. **ADR 87 — asíncrono vs. bloqueante.** Es la decisión de mayor impacto de este hito y la que más se aleja de "responder y listo". Elegí asíncrono porque el timeout que decide sería el del llamador (que no controlamos) y porque, con respuesta síncrona, `GetTask` y la columna `estado` que el Plan manda quedarían vestigiales. El precio está escrito en R4: si el proceso muere, la fila queda en `WORKING` y el llamador poll-ea hasta su propio techo. La alternativa (bloquear con `Promise.race`, molde de `handleSoporte`) es más simple y este repo ya la tiene escrita. **Es tu llamada.**

2. **ADR 88 — auth obligatoria y el token como ÚNICO interruptor.** El Plan no menciona autenticación, así que esto es alcance que agrego. Lo agrego porque los dos adaptadores de entrada que ya existen autentican todo, y porque un endpoint abierto que ejecuta turnos de modelo es gasto de API por invitación. Consecuencia deliberada: **no se puede prender el servidor sin token** — no hay `HARNESS_A2A_ENTRANTE=on`. Si querés un modo "abierto en `localhost` para demo", decilo ahora: es una perilla más y una desviación explícita de este ADR.

3. **ADR 89 — las cinco desviaciones del DDL, y `agente_externo_url` siempre `NULL`.** Es la corrección de hecho al Plan (como RD-24 lo fue en el Hito 6): el protocolo **no transporta** la identidad del llamador, verificado contra `a2a.proto`. La alternativa más defendible que descarté es **borrar la columna** y agregarla cuando exista el registro de agentes; la conservo nullable por la simetría con `delegaciones_a2a` que el propio Plan pide. Si preferís borrarla, es una línea de la migración y una desviación más del DDL. La columna `resultado`, en cambio, **no es negociable si el ADR 87 queda asíncrono**.

4. **ADR 90 / RD-35 — el tope de turnos en vuelo, y el número.** Propongo **4** con criterio, pero es un parámetro de tu máquina y tu cuota de API. Y confirmá el razonamiento de fondo, que es lo que de verdad importa: **no hay cola porque no hay recurso compartido** (precedente textual de `build-on-soporte.ts`), y esa verdad depende de que el turno entrante sea **de sólo lectura**. Si querés que un agente externo pueda hacer que el arnés *escriba* algo, ese es alcance nuevo y reabre el ADR 90 entero.

5. **R11 / estrategia de entrega.** Con ~1 200-1 400 líneas estimadas, el presupuesto de 400 por PR se supera por lejos: decidir **PRs encadenados** (corte sugerido en R11) o uno solo con `size:exception`. Precedente: `hito-2.2` fue a cinco PRs con `chain_strategy = feature-branch-chain`.

6. **Confirmación del gate de secuencia.** Que quede asentado que `sdd-apply` de este change **no arranca** hasta ver `v2.2.0` mergeada en `main` con su tag — no como buena intención, sino como condición verificable (`git tag -l | grep -x v2.2.0` **y** `git ls-tree main --name-only src/adapters/a2a/`). Es el tercer hito consecutivo que arrastra este gate, y los dos anteriores lo incumplieron.

---

**Nota de proceso**: esta fase corrió **sin `Bash`** (por lo tanto sin `graphify query`, igual que la exploración), con `Read`/`Grep`/`Glob` sobre el código real. Se confió en las verificaciones de la exploración contra la especificación A2A v1.0.0 (`a2a.proto`, `docs/specification.md`) sin repetirlas, tal como corresponde a esta fase. Lo que **sí** se verificó en primera persona, archivo por archivo, es cada afirmación sobre el código de este repo: `AGENTS.md` completo; `docs/Plan_Implementacion_Harness_Empresarial.md` líneas 360-400 (Hito 7 completo); `openspec/changes/hito-2.2-a2a-cliente/proposal.md` completo (ADR 71-85, R1-R13) y `design.md` §13/§15 (RD-19 a RD-31); `openspec/config.yaml` (`strict_tdd: true`, `rules.proposal`); `src/adapters/webhooks/server.ts` completo (recorte estructural líneas 30-51, `CreateServerFn` 53-55, tabla exhaustiva 118-137, **`202` antes de `onEvent` sin `await`** 233-241, drenaje 259-320) e `index.ts` completo (degradación por `undefined`, 62-88); **`src/adapters/web/server.ts` líneas 1-140 y sus grep dirigidos — el hallazgo nuevo de esta fase: `esAutorizado` con `timingSafeEqual` y chequeo de longitud (113-132), listener síncrono con `void handleX(...)` (476-488), `handleSoporte` con `Promise.race` contra `SOPORTE_TIMEOUT_MS` (390-439), drenaje (496-507)**; `src/adapters/web/config.ts` (`DEFAULT_WEB_PUBLIC_URL`, `DEFAULT_WEB_MAX_BODY_BYTES = 65_536`, `WEB_CLOSE_TIMEOUT_MS = 5_000`, `SOPORTE_TIMEOUT_MS = 120_000`); **`src/build-on-soporte.ts` completo — el molde del ADR 91, incluida su frase textual "NO hay `KeyedQueue`: no hay recurso compartido que serializar" (líneas 19-20)**; `src/build-on-submit.ts` completo; `src/build-on-activity.ts` completo (`queue.run(evento.proyectoId, …)` línea 447, interruptores por env 344/394); `src/core/activity/activity-contract.ts` completo (`IncomingActivityEvent` con `proyectoId` obligatorio 71-92, la nota de `actividades.proyecto_id NOT NULL` 26-30, `better-sqlite3` síncrono 117); `src/core/activity/run-activity-turn.ts` líneas 1-130; `src/core/concurrency/keyed-queue.ts` completo (qué serializa el ADR 8, líneas 1-12); `src/core/turn-selector/handle-turn.ts` (firma `handleTurn(casoId, prompt, deps)` 228-232, `HandleTurnResult` 208-213); `src/core/agents/a2a-contract.ts` completo (`TASK_STATE_*`, `TASK_STATES_CONOCIDOS`, `esEstadoTerminal`, `motivoDeEstadoTerminal` → `"rejected"` 99-101, `DESTINOS_A2A` cerrado 116); `src/adapters/a2a/client.ts` y `config.ts` por grep (`Authorization: Bearer` 358-359, `authToken` 97); `src/adapters/webhooks/signature.ts` (`timingSafeEqual` + chequeo de longitud); el catálogo de migraciones por `Glob` (**techo real `0010_delegaciones_a2a.ts`**); y el catálogo completo de specs por `Glob` (**21 capabilities únicas en 29 archivos**, ninguna colisión).

**Nota de persistencia**: artifact store `openspec`, por regla de `AGENTS.md` (*"los artefactos del ciclo quedan como archivos en `openspec/`, versionados en git"*) y de `openspec/config.yaml`. El MCP de engram no está conectado en esta sesión; `mem_save` no se pudo intentar. **No es bloqueante**: el artefacto vinculante de este proyecto es este archivo.

**Nota de formato**: la skill `sdd-propose` sugiere un tope de 450 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`, `hito-2.1`, `hito-2.2`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato completo del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto.
