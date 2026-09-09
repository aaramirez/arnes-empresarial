# Propuesta: Comunicación A2A saliente — Cliente A2A (v2.2.0)

**Origen**: [Plan de Implementación](../../../docs/Plan_Implementacion_Harness_Empresarial.md) **Hito 6** (líneas 328-366) · [`exploration.md`](exploration.md) de este change · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Negra 5 (Adaptador A2A, líneas 188-198), **I4** (líneas 226-232), Cajas Blancas 3.1/3.2 (líneas 352-370), **Escenario de ejecución 4** (líneas 438-454) · contrato explícito dejado por `hito-2.0-delegacion-subagentes` (ADR 45, puntos 2-4) en `src/core/turn-selector/dispatch-delegation.ts`.

**Rama prevista**: `hito/v2.2-a2a-cliente` · **Tag de cierre**: `v2.2.0` · **Carpeta de progreso**: `docs/progreso/v2.2-a2a-cliente/`.

---

## Aclaración previa 1: corrección de versión (ya cerrada, no se reabre)

El Plan (línea 366) etiqueta este hito como *`v2.1.0 — docs/progreso/v2.1-a2a-cliente/`*. **Es un error del Plan**, verificado contra el repo: `v2.1.0` ya está tomado por la escritura delegada (`openspec/changes/hito-2.1-escritura-delegada/`, rama actual `hito/v2.1-escritura-delegada`, **36 tareas marcadas y ninguna pendiente**, ADR 62-70 cerrados en su `design.md`). Este change usa **`v2.2.0`** y abre en **ADR 71**, exactamente donde la exploración lo dejó reservado.

## Aclaración previa 2: qué decidió el checkpoint humano y qué NO reabre esta propuesta

La exploración cerró con **cinco preguntas abiertas**. El checkpoint humano las respondió las cinco antes de esta fase. Esta propuesta **las formaliza como ADR 71-75 y las verifica contra el código real** — no las relitiga. Donde la verificación encontró una colisión con el código que la decisión no anticipaba, está escrita **como nota de riesgo explícita** (R1, R2, R6), nunca corregida en silencio.

| # | Pregunta de la exploración | Decisión del checkpoint | ADR |
|---|---|---|---|
| 1 | SDK oficial vs. cliente a mano | **Cliente JSON-RPC propio sobre `fetch`** (Opción B). Sin `@a2a-js/sdk` | **71** |
| 2 | Descubrimiento del Agent Card | **Registro estático por clave de destino**, resuelto por env. El **llamador** elige la clave | **72** |
| 3 | Polling vs. push | **Polling con `GetTask`**. Ningún servidor de escucha nuevo | **73** |
| 4 | Síncrono vs. asíncrono real | **SÍNCRONO**: el Despachador bloquea hasta estado terminal o timeout | **74** |
| 5 | Testing sin infraestructura externa | **Puerto inyectable + UN test de integración gateado**, sin automatizar el arranque de los samples | **75** |

---

## Dependencia de secuencia (gate duro de `sdd-apply`)

**Mismo rango que el checkpoint humano, no una nota al pie** — y es la misma situación exacta que `hito-2.1` tuvo con `hito-2.0`, verificada hoy contra el repo:

| Qué | Estado real verificado | Consecuencia si se ignora |
|---|---|---|
| `hito-2.1-escritura-delegada` **mergeado a `main`** con tag `v2.1.0` | **No cumplido.** `git log main --oneline` corta en `e6f121a Merge pull request #5 … hito/v2.0-delegacion-subagentes`; `git tag -l` llega hasta **`v2.0.0`**. Todo `v2.1.0` vive sólo en la rama actual | El Implementer de `v2.2.0` ramifica de una `main` sin `src/adapters/git/`, sin `src/adapters/test-runner/`, sin la migración `0009` y sin los ADR 62-70 — y la migración de este change colisionaría de número |
| Numeración de migración | Techo real **`0009_propuestas_cambio.ts`** (en la rama, no en `main`). `delegaciones_a2a` es **`0010`** *si y sólo si* `v2.1.0` ya está mergeada | Un `index.ts` reordenado — justo lo que la convención de migraciones prohíbe |
| Numeración de ADR | `hito-2.1/design.md` cierra en **ADR 70** | Colisión de numeración en el registro de decisiones del proyecto |

**Verificación ejecutable del gate**: `git tag -l | grep -x v2.1.0` **y** `git ls-tree main --name-only src/adapters/git/` con salida no vacía. Sin las dos cosas, `sdd-apply` se detiene y reporta `blocked`.

**Lo que sí avanza en paralelo**: `sdd-spec`, `sdd-design`, `sdd-tasks`. Ninguno toca código. La condición que arrastran es de **citación**: todo objeto de `hito-2.1` que se nombre acá se cita como referencia a su especificación, y `sdd-design` lo revalida contra el código real cuando ese hito cierre.

---

## Intent

`v2.1.0` deja el arnés repartiendo trabajo entre cuatro subagentes **adentro del propio proceso**, todos hablando el mismo SDK, todos bajo el mismo límite de confianza. Todo lo que el arnés sabe hacer, lo sabe hacer solo.

Este change rompe esa frontera **una vez, en una dirección, y con el mecanismo mínimo**: el Despachador de Delegación deja de tener un único destino posible y gana un segundo — un agente **externo**, de otro proceso, de otro stack, que no comparte código ni contexto ni confianza con el arnés, y que se habla por un protocolo abierto (A2A v1.0.0 sobre JSON-RPC 2.0) en vez de por un import.

El punto de enganche **ya existe y fue diseñado para esto**. `src/core/turn-selector/dispatch-delegation.ts` declara `DestinoDelegacion` como unión discriminada con un brazo `a2a` desde `v2.0.0`, y su doc-comment (líneas 52-54) dice literalmente: *"Hito 6: reemplazar el `throw` que la usa por el Cliente A2A real y BORRAR el test que la asserta"*. Este change **cobra esa deuda**: `DelegacionA2ANoImplementadaError` desaparece, y con ella el único punto del sistema donde el brazo A2A fallaba por construcción.

La honestidad del argumento importa, igual que en `v2.1.0`: **esto no introduce asincronía real**, y esta propuesta no la vende como tal (ADR 74). Lo que introduce es un **límite de proceso y de confianza** cruzado dentro de un `await` que ya existía. Un agente externo que tarda más que el timeout no deja un caso "esperando": deja una fila de trazabilidad con su último estado conocido y un eslabón que falló con un error tipado. Eso es menos de lo que A2A permite, y es exactamente lo que "Hito 6: Comunicación A2A saliente" pide.

---

## Scope

### In Scope

- **Adaptador `src/adapters/a2a/`** (nuevo, primer archivo del directorio que el arc42 reserva desde el día 1): `config.ts`, `client.ts`, `index.ts`. Cliente JSON-RPC 2.0 hecho a mano sobre `fetch` nativo, molde estructural literal de `src/adapters/board/github-client.ts` y `src/adapters/notificaciones/email-client.ts` — `FetchFn` inyectable, `AbortSignal.timeout`, error tipado con `reason`, `ERROR_BODY_MAX_CHARS = 500` y `truncate()` propios (ADR 71).
- **Registro estático de destinos externos** en `config.ts`: un puñado de claves fijas (`"riesgo-credito"`, `"kpi-incidente"`), cada una resuelta a la URL base de un agente externo vía `HARNESS_A2A_ENDPOINT_<CLAVE>`, con función pura de mapeo clave→variable (ADR 72).
- **Puerto `src/core/agents/a2a-contract.ts`** (nuevo): `ClienteA2APort` inyectable — mismo molde exacto que `InvocarSubagente` (`subagents.ts`) — más el vocabulario de `TaskState`, el predicado puro de terminalidad, y las claves de destino como constantes del núcleo.
- **Rama `a2a` real de `despacharDelegacion`**: `DelegacionA2ANoImplementadaError` **se borra**, y con ella el test de `hito-2.0` que la assertea (contrato explícito del ADR 45 punto 3). En su lugar, `despacharDelegacionA2A` — hermana, no sobrecarga (ADR 74 punto 3).
- **Tabla propia `delegaciones_a2a`** con su migración (`NNNN_delegaciones_a2a.ts`, número por **regla**, no por número fijo — precedente ADR 63) y sus funciones en `repository.ts`.
- **Polling bloqueante**: `SendMessage` → loop de `GetTask` a intervalo fijo → estado terminal o timeout total. `CancelTask` **best-effort** al agotarse el timeout (ADR 73).
- **Falla tipada y controlada**: `DelegacionA2ANoCompletadaError` con `reason ∈ {failed, canceled, rejected, input-required, auth-required, timeout, transporte, protocolo}`, **siempre después** de dejar la fila de `delegaciones_a2a` con su último estado conocido (ADR 74 punto 5).
- **Interruptor de degradación `HARNESS_A2A_SALIENTE`** en el composition root, mismo molde que `HARNESS_DELEGACION_ROLES` (ADR 54) y `HARNESS_ESCRITURA_DELEGADA` (`v2.1.0`): `off` ⇒ comportamiento **idéntico a `v2.1.0`**, cero destinos A2A producidos.
- **UN test de integración real gateado** en `src/test/integration/a2a-client.integration.test.ts`, molde exacto de `run-tests.integration.test.ts` (`describe.skipIf`, degrada a *skip* y no a falla). **Asume** un sample de `a2a-samples` ya corriendo; no lo arranca (ADR 75).
- **README**: sección de cómo levantar a mano un sample de Python de `a2a-samples` para correr ese test. **Tarea de documentación**, no de código (ADR 75 punto 4).
- **`openspec/config.yaml`**: sacar A2A de *"Planned (not yet installed)"* — pasa a instalado en el sentido que este change le da (cliente propio, **cero dependencias nuevas**).

### Out of Scope

- **Asincronía real.** Ningún caso queda "esperando A2A"; ningún proceso separado retoma un caso cuando un `TaskState` externo llega a terminal; ninguna cola, ningún reintento diferido, ningún estado `pendiente_a2a` en `casos`. El Despachador bloquea o falla (ADR 74). Nota de trabajo futuro, **no tarea de este hito**.
- **Descubrimiento dinámico de agentes.** No hay catálogo, ni registro remoto, ni resolución por capacidad declarada, ni un campo por caso que un Empleado complete con una URL arbitraria. El conjunto de destinos posibles es **fijo en el código y resuelto por env** (ADR 72).
- **Streaming y push.** Ni `SendStreamingMessage`, ni eventos `status-update`/`artifact-update`, ni push notifications, ni un segundo servidor de escucha, ni extender `src/adapters/webhooks/` (que es de **entrada** y sigue siéndolo) (ADR 73).
- **Servidor A2A (Caja Blanca 3.2, `src/adapters/a2a/server.ts`).** El arnés no se vuelve invocable desde afuera. Eso es **Hito 7** y el arc42 lo declara "hito posterior" (línea 370).
- **`@a2a-js/sdk` ni ningún SDK de A2A**, oficial o comunitario (ADR 71). Sexto change consecutivo sin dependencias productivas nuevas.
- **Transportes REST y gRPC** del protocolo. Sólo JSON-RPC 2.0, que es el que I4 declara (arc42 línea 232).
- **Capa de compatibilidad con A2A v0.3.0.** Sólo v1.0.0. Un peer viejo falla con `reason = "protocolo"` y eso es una respuesta correcta.
- **Delegación A2A decidida por el modelo.** La clave de destino la elige el **caso de uso**, en código, igual que `construirEslabonesRevision` fija la cadena de roles. Sin cambios respecto del ADR 44 de `v2.0.0`.
- **Autenticación hacia el agente externo** más allá de un `Authorization: Bearer` opcional por destino. Sin OAuth, sin mTLS, sin rotación. Los samples de `a2a-samples` corren sin auth en `localhost`.
- **Caché del Agent Card.** Se busca una vez por delegación. Una caché es una decisión con invalidación propia y no hay volumen que la justifique (ADR 72 punto 5).
- **Automatizar el arranque de los samples de Python** (script, Docker, `child_process`). El repo no tiene runtime de Python y este change no se lo agrega (ADR 75).
- **Correlacionar `delegaciones_a2a` con `delegaciones`.** Son dos tablas hermanas por `caso_id`, sin FK entre ellas. Un agente externo no tiene fila en `sesiones_agente` y nunca la va a tener (ADR 74 punto 4).

---

## Capabilities

> El repo no tiene `openspec/specs/`: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado: **19 nombres de capability únicos** en **25 archivos de spec** (Hitos 1.1-1.3, `tui-canal-empleado`, `hito-2.0`, `hito-2.1` — los 17 que `hito-2.1` contó, más los 2 que ese change agregó). **Ninguno colisiona** con los nombres de abajo, y ninguna contiene hoy la palabra `a2a` fuera de las tres de `hito-2.0` que la nombran para **prohibirla**.

### New Capabilities

- **`cliente-a2a-jsonrpc`** — el adaptador: resolución de un destino a Agent Card, los tres métodos JSON-RPC (`SendMessage`/`GetTask`/`CancelTask`) con su serialización real de v1.0.0, el loop de polling con su intervalo y su timeout total, la clasificación de fallas de transporte/protocolo, y el truncado del cuerpo de error.
- **`delegacion-a2a-saliente`** — el núcleo: el puerto `ClienteA2APort`, la rama `a2a` del Despachador, el registro estático de claves de destino, la persistencia en `delegaciones_a2a` (registrar antes de invocar, completar después — mismo criterio que `delegaciones`), y la falla tipada.

> **Nota para el checkpoint**: propongo **dos** capabilities aplicando el mismo criterio que `hito-2.1` usó para separar `escritura-aislada-worktree` de `propuesta-cambio-hitl`: se verifican con **categorías de test distintas** (integración real gateada vs. dobles puros) y la primera tiene requisitos que la segunda no puede reclamar (*"el cuerpo de error se trunca a 500 caracteres"*, *"un `TaskState` no reconocido es `protocolo`, no un crash"*). Si preferís un solo archivo de spec, colapsarlas no cambia ninguna decisión de esta propuesta.

### Modified Capabilities

- **`despacho-delegacion`** (de `hito-2.0`): el requisito **"El brazo A2A lanza un error tipado, sin adaptador"** y su escenario **"Despachar a destino A2A lanza el error tipado"** se **eliminan** y se reemplazan por el despacho real. Esto es **exactamente lo que ADR 45 punto 3 dejó firmado**, no una regresión — pero tiene que estar escrito en el spec y no descubrirse en el review (R7).
- **`delegacion-subagentes`** (de `hito-2.0`, ya modificada por `hito-2.1`): el requisito de que ningún rol delega hacia afuera se acota a *"ningún **subagente** delega hacia afuera; la delegación A2A la decide el **caso de uso**, en código, y nunca el modelo"*. Cambio de redacción, no de garantía.

**Sin cambio de spec**: `revision-pr-por-roles` (la cadena Planner→Developer→Reviewer no gana ningún eslabón A2A en este hito), `activity-webhook-turn`, `propuesta-cambio-hitl`, `escritura-aislada-worktree`, `hitl-generico`, `solicitud-interna-hitl`, y todo lo de `v1.x`.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 71-75)

La numeración **continúa exactamente donde `hito-2.1/design.md` la dejó**: arc42 (1-2), Hito 2 (3, 3.1, 4), Hito 3 (5-10), Hito 4 (11-20), `v1.4` (21-41), `hito-2.0` (42-56), `hito-2.1` (57-70). Este change abre en el **71**. Las decisiones de nivel diseño de este change reservan **RD-19 en adelante**.

### ADR 71: Cliente JSON-RPC 2.0 **hecho a mano** sobre `fetch` nativo, con tipos propios acotados al subconjunto real — **sin `@a2a-js/sdk`**

**Contexto**. La exploración verificó contra el registro de npm que `@a2a-js/sdk` está en `1.1.0` (2026-08-26), con `1.0.0` estable publicada el 2025-12-22: **~9 meses de rodaje** a la fecha de este change. Trae tres transportes (JSON-RPC, REST, gRPC), streaming completo, push notifications y una capa de compatibilidad opt-in con v0.3.0. El arnés necesita **tres métodos sobre un transporte**.

**Decisión**:

1. **`src/adapters/a2a/client.ts` nuevo, sobre `fetch` nativo de Node 20+, sin dependencia nueva.** El molde no es una analogía: es el mismo archivo dos veces. `github-client.ts` y `email-client.ts` ya son adaptadores HTTP salientes hechos a mano en este repo, con `FetchFn` inyectable como *seam* de test (*"ninguno le pega a la API real"*), `AbortSignal.timeout(config.requestTimeoutMs)`, `error.name === "TimeoutError"` para distinguir timeout de error de red, `!response.ok` traducido a error tipado con `status`, y **cero reintentos, cero backoff**. `client.ts` copia esa estructura completa.
2. **Coherencia de dependencias, verificada.** El repo tiene exactamente **dos** dependencias productivas de terceros con superficie real (`@anthropic-ai/claude-agent-sdk` y `better-sqlite3`); todo lo demás que habla con un sistema externo — GitHub, email, `graphify`, `git`, `vitest` — está hecho a mano en `src/adapters/*`. Traer un SDK de ~9 meses para tres llamadas rompería una regla que este repo sostiene desde el Hito 1, y le pondría al Reviewer de esta pasantía una superficie que no puede auditar en el tiempo de un review.
3. **Truncado de error idéntico**: `const ERROR_BODY_MAX_CHARS = 500;` y una función `truncate()` local — **duplicación deliberada**, mismo criterio ya documentado cinco veces en este repo (`resolvePositiveNumber` en `git/config.ts:50-56` lo explica textualmente): `AGENTS.md` prohíbe que un adaptador importe de otro, y esto es infraestructura de adaptador, no lógica de negocio.
4. **Nombres reales de v1.0.0, no los del Plan.** Los tres métodos son **`SendMessage`, `GetTask`, `CancelTask`** — PascalCase, **sin** prefijo `a2a/`. El Plan (línea 354) dice `a2a/sendMessage`/`a2a/getTask`/`a2a/cancelTask`; la exploración lo verificó contra dos fuentes independientes de la especificación (`github.com/a2aproject/A2A` §5.3/§9.4 y `a2a-protocol.org/v1.0.0/specification/` §4.1.3/§9.4) y **el Plan cita mal**. El código sigue la especificación; el Plan queda con una nota de corrección en `docs/progreso/v2.2-a2a-cliente/`.
5. **`TaskState` se persiste con los valores reales del protocolo, en `TASK_STATE_*`** (`TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_REJECTED`, `TASK_STATE_AUTH_REQUIRED`), **no** en los strings minúscula-con-guion del DDL del Plan (línea 345). Motivo: `delegaciones_a2a.estado` es **traza de protocolo**, no vocabulario del núcleo. Una capa de traducción a un vocabulario privado no tendría ningún consumidor, y haría que la fila persistida no se pueda comparar contra una captura real del tráfico — que es precisamente para lo que sirve esa columna cuando algo falla. El vocabulario del núcleo (*terminal / no terminal*, *éxito / fracaso*) es una **función pura** sobre esos valores, en `a2a-contract.ts`, y se testea sin red.
6. **Tipos propios, acotados y cerrados.** Se tipa el subconjunto que se usa — `Message` con partes de texto, `Task` con `id`/`status.state`/`artifacts` de texto, el sobre JSON-RPC 2.0 (`jsonrpc`/`id`/`method`/`params` y `result`/`error`) — y **nada más**. Cualquier campo del protocolo que llegue y no esté tipado se ignora sin fallar; cualquier `TaskState` desconocido produce `reason = "protocolo"` con el valor crudo truncado en el mensaje, **nunca un crash ni un `as any`**.
7. **Contrapartida asumida, escrita**: la conformidad con el protocolo es nuestra, y un cambio de especificación no nos llega por `npm update`. La mitigación es el test de integración del ADR 75 contra un servidor A2A **real** — que es lo que verifica conformidad de verdad, y que un SDK tampoco garantizaría sin correrlo.

**Alternativas consideradas**:

- *`@a2a-js/sdk` consumiendo sólo el subconjunto JSON-RPC*: **rechazada** por los puntos 1-2. Sería la opción correcta en un proyecto con equipo de mantenimiento y necesidad de seguir el spec de cerca; no lo es en un arnés de pasantía cuyo Reviewer tiene que poder leer todo lo que corre.
- *SDKs comunitarios* (`Dexwox-Innovations-Org/a2a-node-sdk`, `@ryukez/a2a-sdk`, `@agentic-profile/a2a-client`): **rechazadas**. Si de todos modos hay que confiar en un mantenedor individual, escribir el cliente propio da más control por el mismo riesgo.

### ADR 72: Registro **estático** de destinos externos por clave, resuelto por variable de entorno — y **el llamador elige la clave, nunca el Cliente A2A**

**Contexto**. El Plan pide dos agentes externos de dominios distintos demostrados (riesgo/crédito antes de una venta grande; incidente técnico / consolidado de KPIs) y dice que el Cliente A2A obtiene el Agent Card *"en una URL bien conocida"* — pero **no dice de dónde sale esa URL por caso concreto**. Hoy nada en el código produce un `{kind: "a2a", …}`: `resolverDestino` (`dispatch-delegation.ts:80-88`) devuelve siempre `in-process` para todo id de `SUBAGENT_REGISTRY` y lanza `SubagenteDesconocidoError` para cualquier otro.

**Decisión**:

1. **Un registro chico y explícito, mismo espíritu que `SUBAGENT_REGISTRY` pero para destinos EXTERNOS.** Dos claves fijas, declaradas como constantes del núcleo en `a2a-contract.ts`:

| Clave | Dominio | Sample sugerido por el Plan | Caso de uso del Plan que cubre |
|---|---|---|---|
| `"riesgo-credito"` | Finanzas / Riesgo | `langgraph` (conversión de moneda, ciclo de tarea real con herramientas) | *"Verificación de riesgo/crédito antes de confirmar una venta grande"* |
| `"kpi-incidente"` | Métricas / Analítica | `analytics` (CrewAI + Matplotlib) | *"consolidado ejecutivo de KPIs"* **y** *"incidente técnico coordinado"* |

   **Por qué dos claves y no tres**, con los tres casos de uso del Plan: `kpi-incidente` funde el incidente técnico y el consolidado de KPIs porque el propio Plan los funde — línea 360, sobre el sample `analytics`: *"encaja con un consolidado ejecutivo de KPIs, y también sirve para visualizar una tendencia de métricas durante el diagnóstico de un incidente"*. Un destino por **dominio del agente externo**, no por caso de uso del arnés: es el agente el que tiene una capacidad, no nosotros.

2. **Cada clave resuelve a una URL base por env, con mapeo puro y testeable**: `HARNESS_A2A_ENDPOINT_<CLAVE_EN_MAYUSCULAS_CON_GUION_BAJO>` — `riesgo-credito` → `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO`, `kpi-incidente` → `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE`. La conversión es **una función pura** (`claveAVariableEntorno`), no un literal escrito dos veces, y tiene test dedicado: los guiones de la clave no son expresables en un nombre de variable de entorno y esa traducción es exactamente el tipo de detalle que se rompe en silencio. Prefijo `HARNESS_A2A_` siguiendo la convención **más reciente** del repo (`HARNESS_GIT_*`, `HARNESS_WORKTREE_*`, `HARNESS_WORKTREE_TEST_TIMEOUT_MS` de `v2.1.0`), no la de los adaptadores de Hito 1-4 (`GITHUB_*`, `EMAIL_*`, `WEBHOOK_*`, `GRAPHIFY_*`).
3. **`resolveA2AConfig(env)` — pura, recibe `env` como parámetro, nunca lanza.** Molde literal de `resolveGitConfig`/`resolveWorktreeConfig` (`git/config.ts:97-123`), incluidos `resolvePositiveNumber` (con el chequeo de finitud que la revisión de `v2.1.0` agregó) y `resolveNonBlankString` (que rechaza strings en blanco, corrección de `hito-2.1`). **Una clave sin su variable de entorno definida no es un error de arranque**: el destino queda **no disponible**, y sólo falla — tipado — si alguien intenta delegar a él. Un arnés que no arranca porque falta el endpoint de KPIs sería peor que uno que atiende PRs y falla sólo la delegación de KPIs.
4. **Quién elige la clave: el caso de uso, en código. Nunca el Cliente A2A, nunca el modelo.** El Cliente A2A recibe una clave ya resuelta y **no tiene ninguna firma por la que adivinar un destino** — mismo criterio estructural que el ADR 57 punto 4 de `v2.1.0` usó para hacer `git commit` *inexpresable*. Es un test sobre la firma, no una convención.
5. **El Agent Card SÍ se busca; lo que es estático es el conjunto de destinos.** La variable de entorno guarda la **URL base** del agente externo; el cliente hace `GET <base>/.well-known/agent-card.json` (ruta real de v1.0.0, renombrada desde `/.well-known/agent.json` de v0.3.0 — dato que el Plan no menciona), valida un subconjunto mínimo (`name`, `url`, transporte JSON-RPC declarado) y usa el `url` del card como endpoint JSON-RPC. **Sin caché** (una caché trae invalidación y no hay volumen que la justifique). Esto satisface literalmente la *"Integración concreta"* del Plan y el arc42 sin abrir descubrimiento dinámico: **el conjunto de agentes posibles es fijo; lo que se descubre es dónde y cómo hablarle a uno ya elegido.** → *Ver R8 y el punto 2 de "Qué necesita el checkpoint humano": si el checkpoint prefiere que el env guarde el endpoint JSON-RPC directo y se saltee el card, es un ahorro de un `fetch` y una desviación explícita del Plan.*
6. **La URL efectiva se persiste** en `delegaciones_a2a.agente_externo_url` (`NOT NULL`, como pide el Plan). Con el registro por env, esa columna deja de ser redundante y pasa a ser **evidencia**: dice contra qué corrió realmente esa delegación, no contra qué debería haber corrido según la configuración de hoy.
7. **`resolverDestino` no cambia de forma.** El destino A2A llega por el campo `input.destino` que `despacharDelegacion` ya expone desde `v2.0.0` — hoy documentado como *"Ausente en producción"* (`dispatch-delegation.ts:198-199`), doc-comment que este change **actualiza**. Es exactamente el camino que el ADR 45 punto 3 anticipó.

**Alternativas consideradas**:

- *Un campo de URL en el caso o la actividad, completado por el Empleado o un comando*: **rechazada**. Convierte una URL arbitraria en entrada de usuario y abre SSRF sobre un adaptador que hace `fetch` — el peor intercambio posible por una flexibilidad que ningún caso de uso del Plan pide.
- *Un único endpoint hardcodeado (MVP de un solo agente)*: **rechazada**. El Plan pide explícitamente **dos** dominios distintos demostrados, y un solo endpoint haría que el mecanismo de selección no exista y haya que inventarlo en Hito 7.
- *Derivar la clave del tipo de actividad (`incidente`/`kpi`/`riesgo`)*: **rechazada**. Acopla el registro de destinos externos al vocabulario de `activity-contract.ts`, y deja la decisión de delegar hacia afuera implícita en un mapa en vez de explícita en el caso de uso.

### ADR 73: **Polling** con `GetTask` a intervalo fijo hasta estado terminal — sin push, sin streaming, sin servidor de escucha nuevo

**Contexto**. A2A v1.0.0 soporta consulta (`GetTask`), streaming (`status-update`/`artifact-update`) y push notifications. El arnés tiene un adaptador de webhooks (`src/adapters/webhooks/`) que es **exclusivamente de entrada**: traduce eventos de GitHub a turnos, sin ningún camino de salida ni acoplamiento con nada saliente.

**Decisión**:

1. **`SendMessage` inicia, un loop de `GetTask` espera.** El cliente envía la tarea, obtiene el `task.id`, y consulta el estado a intervalo fijo hasta que `status.state` sea **terminal** o se agote el timeout total.
2. **Estados terminales**: `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`. **No terminales**: `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`. **`TASK_STATE_INPUT_REQUIRED` y `TASK_STATE_AUTH_REQUIRED` se tratan como terminales de fracaso**, con su propio `reason`: son estados que esperan una **interacción** que este hito no construye (una conversación multi-turno con el agente externo, o un flujo de credenciales), y hacer polling sobre ellos sería esperar algo que nunca va a llegar. La terminalidad es una **función pura** sobre el `TaskState`, con test exhaustivo sobre los ocho valores.
3. **Tres parámetros, todos por env con default, molde de `resolvePositiveNumber`**:

| Variable | Campo | Default | Por qué ese número |
|---|---|---|---|
| `HARNESS_A2A_REQUEST_TIMEOUT_MS` | `requestTimeoutMs` | `30_000` | Por **request** HTTP individual. Mismo orden que `DEFAULT_GIT_TIMEOUT_MS` (30 s) |
| `HARNESS_A2A_POLL_INTERVAL_MS` | `pollIntervalMs` | `1_500` | Suficientemente frecuente para que un sample que responde en segundos no agregue latencia perceptible; suficientemente espaciado para no ametrallar a un agente externo. ~80 consultas en el peor caso |
| `HARNESS_A2A_TASK_TIMEOUT_MS` | `taskTimeoutMs` | `120_000` (2 min) | Techo **total** de reloj. Holgado sobre un ciclo real de herramientas del sample `langgraph` (segundos), y bien por debajo de cualquier espera que un humano tolere en el camino web (R3) |

4. **`CancelTask` es best-effort al agotarse el timeout**, y **nunca cambia el desenlace**: la delegación ya falló por timeout; cancelar es cortesía hacia el agente externo para que no siga gastando. Si `CancelTask` falla, se registra y se sigue — **jamás enmascara el error real**, mismo criterio asimétrico del ADR 57 punto 6 de `v2.1.0` (`cerrar` nunca rechaza).
5. **Ningún puerto nuevo, ningún servidor nuevo, ningún cambio en `src/adapters/webhooks/`.** Extender el adaptador de entrada a un segundo propósito de salida mezclaría responsabilidades en el único adaptador del repo que hoy tiene una sola.

**Alternativas consideradas**:

- *Streaming (`SendStreamingMessage`)*: **rechazada**. Requiere manejo de SSE y un modelo de eventos parciales que nada en el arnés consume — el resultado se incorpora entero o no se incorpora. Cero valor incremental para el entregable, mucha superficie nueva.
- *Push notifications hacia un servidor de escucha*: **rechazada**. Sólo tiene sentido con asincronía real (ADR 74), y arrastra puerto abierto, autenticación de callbacks y correlación fuera de proceso. Es infraestructura para un problema que este hito no tiene.

### ADR 74: **SÍNCRONO** — el Despachador bloquea hasta estado terminal o timeout. **La asincronía real queda explícitamente fuera de alcance**

**Contexto**. Es la decisión de mayor riesgo arquitectónico que la exploración señaló, y la razón por la que la señaló es correcta: `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING` son estados intermedios **reales**, y un agente externo puede tardar. Bloquear es una elección, no una obviedad.

**Decisión**:

1. **Se bloquea.** El Cliente A2A hace `SendMessage` → loop de `GetTask` **dentro del mismo `await`** que `despacharDelegacion` ya usa hoy para `invocar(...)` in-process. Tres argumentos verificados, no supuestos:
   - **El arc42, tal como está escrito HOY, describe un flujo síncrono.** Escenario de ejecución 4, líneas 448-452: *"El agente externo procesa la solicitud y devuelve su resultado… el Cliente A2A entrega el resultado al Despachador… Continúa como el Escenario 3 desde el paso 6 (el resultado se incorpora como tool result y el turno del padre cierra normal)"*. Implementar asincronía real **contradiría el documento de arquitectura vigente**, que es exactamente lo que `AGENTS.md` reserva al rol Spec Author y a un ADR de otra escala.
   - **Toda la arquitectura de Hito 1 a 5.1 es síncrona por turno.** `despacharDelegacion`, `despacharCadena` (fold secuencial de `await`), `crearSolicitudInterna`, `despacharRevisionPorRoles`: `await` tras `await`, sin ningún mecanismo de "caso esperando, retomado después", sin cola, sin scheduler, sin estado de reanudación. Introducirlo acá no sería un hito de comunicación A2A: sería un hito de **motor de ejecución**.
   - **El costo real de bloquear ya está pagado por el ADR 10.** Verificado en `src/adapters/webhooks/server.ts:127`: el webhook **responde `202` PRIMERO y después llama a `onEvent(...)` sin `await`**. En el camino principal del entregable (evento de PR → turno de actividad), un bloqueo de hasta 2 minutos **no retiene ninguna petición HTTP**. → El camino web de ventas es la excepción y está en R3.
2. **Alcance, no limitación oculta.** La asincronía real queda anotada como **trabajo futuro** en *Fuera de alcance / diferido*, con su condición de disparo escrita: cuando exista un caso real cuyo agente externo tarde más que el timeout de forma sistemática. Ese día será su propio change, con su propio ADR sobre el motor de ejecución.
3. **`despacharDelegacionA2A` es una función HERMANA de `despacharDelegacion`, no una rama adentro.** Esto es una **corrección al enunciado del checkpoint**, verificada contra el código, y está en R2 como nota de riesgo. Motivo: `despacharDelegacion` está estructuralmente atada a lo in-process en tres puntos —
   - `construirTareaDelegada(rol, insumo)` (`dispatch-delegation.ts:225`) exige un `AgentDefinition`, y un agente externo **no tiene ni puede tener** entrada en `SUBAGENT_REGISTRY`;
   - `store.completarDelegacion` inserta una fila de `sesiones_agente` con `sdk_session_id` **en la misma transacción** (ADR 48), y un agente externo **no produce sesión del SDK**;
   - `DelegacionAplicada` lleva `sesionSubagenteId`, que para A2A no significa nada.

   Por eso la vuelta a `despacharDelegacion` es **borrar el `throw` y el brazo `a2a` de la unión que llega hasta ahí**, y exponer la delegación externa como su propia función con su propio puerto de store, su propio constructor de tarea (que reusa `TAREA_DELEGADA_MAX_CHARS = 8_000` **tal cual**, sin `AgentDefinition`, tomando el nombre del Agent Card como encabezado) y su propio resultado `DelegacionA2AAplicada`. **El contrato conceptual del checkpoint se respeta** — el resultado se incorpora como cualquier otro resultado de delegación — pero **no puede ser literalmente el tipo `DelegacionAplicada`**.
4. **Tabla `delegaciones_a2a`, DDL del Plan con dos desviaciones declaradas** (mismo criterio y mismo formato de desviación que el ADR 48 usó para `delegaciones`):

```sql
CREATE TABLE IF NOT EXISTS delegaciones_a2a (
  id                  TEXT PRIMARY KEY,
  caso_id             TEXT NOT NULL REFERENCES casos(id),
  destino_clave       TEXT NOT NULL,   -- ★ AGREGADA: "riesgo-credito" | "kpi-incidente"
  agente_externo_url  TEXT NOT NULL,   -- endpoint JSON-RPC efectivo (ADR 72 pto 6)
  tarea_delegada      TEXT NOT NULL,   -- tope TAREA_DELEGADA_MAX_CHARS, igual que `delegaciones`
  a2a_task_id         TEXT,            -- nullable: sólo existe DESPUÉS de SendMessage
  estado              TEXT NOT NULL,   -- ★ TASK_STATE_* del protocolo (ADR 71 pto 5), no minúscula
  resultado           TEXT,            -- nullable: sólo en TASK_STATE_COMPLETED
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegaciones_a2a_caso ON delegaciones_a2a(caso_id);
```

   - **`destino_clave` agregada**: sin ella, `agente_externo_url` es la única pista de qué destino se usó, y una URL de `localhost` con puerto no dice nada. Mismo argumento textual con que el ADR 48 agregó `caso_id`/`agent_id` a `delegaciones`.
   - **`estado` en `TASK_STATE_*`**: desviación del comentario del DDL del Plan, justificada en ADR 71 punto 5.
   - **`a2a_task_id` y `resultado` nullable**: *registrar antes de invocar*, criterio idéntico a `delegaciones.sesion_subagente_id` (ADR 48). La fila nace con `estado = "TASK_STATE_SUBMITTED"` **antes** del `SendMessage` — una delegación externa sin traza es peor que una que no ocurrió.
   - **Sin FK a `delegaciones`**: son hermanas por `caso_id`. Un agente externo nunca va a tener fila en `sesiones_agente`.
   - **Sin `CHECK` sobre `estado`**: criterio de todo el esquema — el vocabulario canónico vive en el núcleo, el SQL no lo conoce.
   - **Numeración por REGLA, no por número** (precedente ADR 63): se agrega **al final** de `migrations/index.ts`, sin editar ni reordenar ninguna existente. Será `0010` *si y sólo si* la `0009` de `v2.1.0` está en `main` — ver *Dependencia de secuencia*.
5. **Desenlaces, todos explícitos y ninguno un hang**:

| `TaskState` terminal / evento | Qué hace el Despachador | Fila `delegaciones_a2a` |
|---|---|---|
| `TASK_STATE_COMPLETED` | Devuelve `DelegacionA2AAplicada` con el texto del resultado | `estado = TASK_STATE_COMPLETED`, `resultado` poblado |
| `TASK_STATE_FAILED` / `CANCELED` / `REJECTED` | `DelegacionA2ANoCompletadaError` con ese `reason` | `estado` = el real, `resultado` `NULL` |
| `TASK_STATE_INPUT_REQUIRED` / `AUTH_REQUIRED` | Ídem, `reason` propio (ADR 73 pto 2) | Ídem |
| Timeout total agotado | `CancelTask` best-effort, después `reason = "timeout"` | `estado` = **el último conocido** (`SUBMITTED`/`WORKING`) |
| Falla de red / HTTP / timeout de request | `reason = "transporte"` | `estado` = el último conocido |
| JSON-RPC `error`, o `TaskState` no reconocido | `reason = "protocolo"`, cuerpo truncado a 500 chars | Ídem |

6. **"Falla explícita y controlada" en el vocabulario de ESTE repo: error tipado que propaga, no texto degradado.** Matiz respecto de la formulación del checkpoint: `handleRunTests` nunca lanza porque es un **handler de tool MCP** y su consumidor es un **modelo**, que ante una excepción improvisa. El Despachador no le habla a un modelo: le habla a un caso de uso de TypeScript, y ahí el precedente del repo es el opuesto y explícito — `despacharCadena` *"NO captura: si un eslabón falla, el error propaga tal cual"*, igual que `SubagenteDesconocidoError` y que el propio `DelegacionA2ANoImplementadaError` que este change reemplaza. **Lo que el criterio "nunca lanza sin control" garantiza acá y se cumple entero**: (a) nunca un hang — hay timeout total; (b) nunca un error no tipado — todo camino termina en `DelegacionA2ANoCompletadaError` con `reason`; (c) nunca sin traza — la fila queda escrita antes y actualizada después, en todos los caminos.

**Alternativas consideradas**:

- *Asincronía real (caso en estado "esperando A2A" + proceso que lo retoma)*: **rechazada para este hito** por los tres argumentos del punto 1. No se descarta para siempre: se difiere con condición de disparo escrita.
- *Fire-and-forget (delegar y no esperar el resultado)*: **rechazada**. El entregable del Plan es *"el agente delega parte del diagnóstico y **recibe su resultado**"*. Sin resultado incorporado no hay entregable.

### ADR 75: `ClienteA2APort` **inyectable** en el núcleo + **UN** test de integración real **gateado**, sin automatizar el arranque de los samples

**Contexto**. La suite de este repo no toca la red en ningún test y no invoca el modelo real en ninguno. `v2.1.0` abrió la única excepción: `src/test/integration/` con procesos externos reales (`git`, `vitest`), **gateados** con `describe.skipIf` para que la ausencia del binario degrade a *skip* y no a falla. Los samples de A2A son procesos de **Python**, un runtime que el repo no tiene.

**Decisión**:

1. **`ClienteA2APort` en `src/core/agents/a2a-contract.ts`, molde exacto de `InvocarSubagente`** (`subagents.ts:112-120`): un tipo función `(input) => Promise<...>`, declarado en el núcleo, implementado en el adaptador, cerrado por el composition root. Consecuencia directa: **`despacharDelegacionA2A` y todo el núcleo se testean con dobles puros, sin red, sin servidor, sin Python** — igual que `despacharDelegacion` se testea hoy sin tocar el modelo.
2. **UN solo archivo de integración real**: `src/test/integration/a2a-client.integration.test.ts`, molde de `run-tests.integration.test.ts` (tarea 25 de `v2.1.0`). Gate: `describe.skipIf(!A2A_SAMPLE_DISPONIBLE)`, donde la disponibilidad se determina **por un `fetch` real al Agent Card** del endpoint configurado, con timeout corto. **Sondear el card, no adivinar por variable de entorno**: una variable puede estar puesta con el servidor caído, y eso convertiría el gate en una falla espuria — que es exactamente lo que `v2.1.0` evitó sondeando el binario `git` en vez de confiar en una bandera.
3. **El test ASUME el sample ya corriendo.** No lo arranca, no lo instala, no verifica que exista Python. Motivo: automatizarlo agregaría al repo una dependencia de runtime cruzado (Python + `uv`/`pip` + las deps del sample) que **nada más en el proyecto necesita**, para beneficio de un único test que además puede saltarse. La Restricción Técnica del arc42 rige nuestro arnés; correr procesos de terceros de otro stack es el **punto** de A2A, no un motivo para adoptarlos como dependencia de build.
4. **La forma de levantarlo se documenta en el README** — tarea de **documentación**, no de código: qué sample, cómo arrancarlo, en qué puerto, y qué `HARNESS_A2A_ENDPOINT_*` exportar para que el test deje de saltarse. Quien quiera correrlo, puede; quien no, ve un *skip*, no un rojo.
5. **Qué cubre cada capa, sin solapamiento**: puro → mapeo clave→env, terminalidad del `TaskState`, construcción del sobre JSON-RPC, clasificación de `reason`, truncado a 500 chars, tope de `tarea_delegada`, y el loop de polling **con reloj y `fetch` inyectados** (un test que verifica el intervalo sin dormir de verdad). Integración real → que un `SendMessage` seguido de `GetTask` contra un agente A2A **real** vuelva con un `TASK_STATE_COMPLETED` y texto — es decir, **conformidad de protocolo**, que es lo único que un doble no puede probar y lo único que justifica la categoría.
6. **La evidencia de `docs/progreso/v2.2-a2a-cliente/`** incluye la corrida manual contra **los dos** samples, con las filas de `delegaciones_a2a` resultantes. Eso es lo que cierra el entregable del Plan, no el test automático.

---

## Enmienda posterior al diseño — ADR 85 (cierra RD-26)

> **Cómo leer esta sección.** `design.md` cerró en el **ADR 84** y elevó **RD-26** al checkpoint humano (§15 punto 2: *"`kpi-incidente` no tiene productor productivo… Si querés un productor real (un comando de TUI `/kpi`, o un enganche en el camino de actividades), **es alcance nuevo** y hay que decidirlo ahora"*). El checkpoint **respondió que sí**. El ADR nuevo vive acá, en `proposal.md`, porque es una decisión de **alcance** — qué construye este change —, no una de bajada a firmas; su bajada técnica está en `design.md` §5.7/§6.4/§7.5 y sus requirements en `specs/delegacion-a2a-saliente/spec.md`. **Numeración verificada**: `proposal.md` abrió en 71 y cerró en 75; `design.md` abrió en 76 y cerró en 84. El siguiente disponible es el **85**. Ningún ADR 71-84 se reabre.

### ADR 85: `/consultar-kpi <consulta>` — comando TUI privilegiado, **síncrono y bloqueante**, primer llamador real del mecanismo CENTRAL del ADR 74

**Contexto**. El ADR 74 fija que `despacharDelegacionA2A` **bloquea** hasta estado terminal o timeout, y lo justifica con el **Escenario de ejecución 4 del arc42** (líneas 438-454): *"El agente externo procesa la solicitud y devuelve su resultado… el Cliente A2A entrega el resultado al Despachador… el resultado se incorpora como tool result y el turno del padre cierra normal"*. Es el corazón del diseño. Y hoy, **ninguno de los dos usos que este change construye lo ejercita**:

| Uso | Clave | Disciplina de espera | ¿Ejercita el camino síncrono del ADR 74? |
|---|---|---|---|
| Venta grande (`registrarVenta`) | `"riesgo-credito"` | **NO bloqueante** — `void … .catch(…)`, ADR 76 | **No.** Dispara y sigue; nadie awaitea el resultado. Por diseño, y bien decidido: `POST /ventas` tiene un humano esperando |
| `"kpi-incidente"` | `"kpi-incidente"` | — | **No.** No tiene ningún llamador de producción (**RD-26**). Se demuestra sólo por el test de integración parametrizado y por la evidencia manual |

El resultado es que `v2.2.0`, tal como estaba planificada, **entregaría el mecanismo síncrono sin un solo caso de uso real que lo dispare**. Eso no es un hueco cosmético: el flujo que el arc42 describe como *el* flujo de delegación externa quedaría verificado únicamente por dobles y por un test que degrada a *skip*. **Ese es el gap que este ADR cierra**, y de paso cierra RD-26 con un productor real en vez de con una nota.

**Decisión**:

1. **Un comando TUI nuevo, `/consultar-kpi <consulta>`**, que consulta al agente externo de KPIs/incidente y **espera su respuesta** — con el techo de reloj que el ADR 73 ya fijó (`HARNESS_A2A_TASK_TIMEOUT_MS`, default 120 s). Es la demostración más fiel del Escenario 4 que este change puede construir: el arnés delega hacia afuera **y recibe el resultado dentro del mismo `await`**, que es literalmente el entregable 1 del Plan (línea 364).
2. **Fija la clave `"kpi-incidente"` en código**, del mismo modo que `registrarVenta` fija `"riesgo-credito"`. **NO se agrega una tercera clave de destino ni se toca `DESTINOS_A2A`** — el ADR 72 sigue cerrado tal cual: dos claves, y no hay una tercera. Este comando es un **llamador**, no un destino.
3. **Molde exacto de los comandos privilegiados que `hito-2.1` ya agregó** (ADR 69): descriptor nuevo en `DESCRIPTORES` de `src/core/commands/comando-empleado.ts` con `forma: "id_mas_resto"` y una rama propia en `parsearComando` (calcada de la de `/soporte`: el resto entero es `consulta`, obligatorio); handler nuevo en `src/build-on-comando-empleado.ts`, el mismo archivo que ya aloja `manejarSoporte` y `manejarVerPropuesta`. **Ninguna forma de parseo nueva, ningún tipo de payload nuevo, ningún `Forma` nuevo.**
4. **`privilegiado: true`, y no es una decisión nueva**: es el criterio **ya aplicado** a `/ver-propuesta` (`comando-empleado.ts:193-198`, textual: *"muestra el contenido íntegro de un patch — código propietario del repo — y el spec sólo garantiza el canal TUI autenticado"*). `/consultar-kpi` manda contexto de la empresa a un **tercero externo** y trae su respuesta: exige sesión vigente por el mismo argumento, y la guarda del preámbulo (`esComandoPrivilegiado`, paso 6 del dispatcher) lo protege **sin tocar el guard** — marcar el descriptor **es** la implementación.
5. **UN SOLO PASO, sin confirmación en dos pasos.** No escribe estado del núcleo: no hay CAS, no hay transición de máquina de estados, no hay nada que un humano deba re-leer antes de aceptar. Mismo espíritu que `/soporte` y `/ver-propuesta`, explícitamente **no** el de `/aplicar-propuesta`. **`confirmacionPendiente` no gana una cuarta rama** — la ranura única del ADR 36/55/60 queda intacta.
6. **La `instruccion` del insumo es FIJA, en código** — nunca del modelo, nunca del empleado. El empleado aporta únicamente el `material` (su consulta). Mismo criterio literal que `createConsultaRiesgoCredito` (`design.md` §7.3) y que el ADR 44 de `v2.0.0`: *la topología la decide el arnés, el contenido el modelo (o acá, el humano)*.
7. **El `throw` tipado SÍ se atrapa acá, y eso no contradice el ADR 74 punto 6.** El ADR 74 fija que `despacharDelegacionA2A` **propaga** `DelegacionA2ANoCompletadaError` tal cual — y lo sigue haciendo. Lo que este ADR agrega es un **`catch` explícito en el borde de la TUI**, que es exactamente donde el repo ya los pone: `manejarSoporte` envuelve `onSoporte` en `try/catch` *"la TUI no puede quedarse sin respuesta"* (ADR 40, `build-on-comando-empleado.ts:705-711`). Cada `reason` se traduce a **un mensaje distinto y legible**; **ningún camino queda silencioso** y la TUI no cuelga más allá del timeout que el ADR 73 ya fijó.
8. **`casoId`: un `caso` nuevo por invocación. Verificado, no supuesto.** `build-on-comando-empleado.ts` **no tiene** ningún `caso` de sesión que reusar — sus dos ranuras de closure son `sesion` y `confirmacionPendiente`, y nada más (ADR 31/36, verificado leyendo el archivo). Cada comando que necesita un caso lo obtiene de una entidad existente o **crea el suyo**: `/soporte` vía `onSoporte` → `createCaso(…, CASO_TIPO_SOPORTE)`, `/solicitar` vía `crearSolicitudInterna` → `crearSolicitudConCaso`. `/consultar-kpi` hace lo mismo, y **tiene que hacerlo**: `delegaciones_a2a.caso_id` es `NOT NULL REFERENCES casos(id)` (ADR 74 pto 4), así que sin caso no hay fila de traza posible.
9. **Cero cambios de esquema.** `registro_acciones_empleado.comando` es `TEXT NOT NULL` **sin `CHECK`** (verificado, migración `0005`), así que la constante nueva `COMANDO_CONSULTAR_KPI` no necesita migración; el `resultado` reusa `RESULTADO_ATENDIDA`/`RESULTADO_FALLIDA`, que ya existen para `/soporte`. **Ninguna migración nueva más allá de la de `delegaciones_a2a` que este change ya tenía.**
10. **El interruptor `HARNESS_A2A_SALIENTE` gobierna también este camino** (ADR 82, sin cambio): apagado ⇒ el comando existe y responde *"la delegación A2A saliente está apagada"*, sin construir adaptador, sin `fetch`, sin fila. El rollback a `v2.1.0` exacto sigue siendo el mismo mecanismo — un comando que no delega no es una delegación.

**Alternativas consideradas**:

- *Dejar RD-26 abierto y demostrar `"kpi-incidente"` sólo con el test de integración (lo que `design.md` §15 pto 2 proponía)*: **rechazada por el checkpoint**. Cumple el entregable 4 del Plan ("dos dominios demostrados") pero deja el entregable 1 ("el arnés delega **y recibe su resultado**") sin ningún camino de producción que lo ejercite de punta a punta.
- *Enganchar `"kpi-incidente"` en el camino de actividades (webhook de PR)*: **rechazada**. Ese camino ya está cubierto por el ADR 10 (`202` primero, procesar después), así que tampoco tendría a nadie esperando el resultado — reproduciría el problema del ADR 76 en vez de resolverlo, y además metería tráfico saliente en el camino del entregable principal.
- *Un comando de dos pasos con confirmación, como `/aplicar-propuesta`*: **rechazada**. La confirmación en dos pasos del ADR 36 existe para escrituras irreversibles con CAS. Una consulta no escribe nada del núcleo, y un eco previo sólo agregaría fricción sin proteger nada.
- *Una tercera clave de destino (`"kpi"` aparte de `"incidente"`)*: **rechazada**. Reabriría el ADR 72, que fundió los dos casos de uso en una clave **siguiendo al propio Plan** (línea 360). Un destino es un **dominio de agente externo**, no un caso de uso del arnés.

**RD-26 queda CERRADO por este ADR**: `"kpi-incidente"` tiene un productor real de producción. Ver `design.md` §13 (RD-26 marcado **resuelto**) y los riesgos residuales nuevos **RD-30** y **RD-31** que esta pieza abre.

---

## Approach

**Flujo del entregable — de la decisión de delegar afuera al resultado incorporado.**

```
caso de uso (código del arnés)  ──elige la CLAVE de destino, explícitamente──┐
   p. ej. "riesgo-credito" antes de una venta grande                         │
   p. ej. "kpi-incidente" en un consolidado ejecutivo                        │
                                                                            ▼
   despacharDelegacionA2A({ casoId, destinoClave, insumo }, deps)   ← hermana de despacharDelegacion
      │
      ├─ resolverDestinoA2A(clave)         config.ts: HARNESS_A2A_ENDPOINT_RIESGO_CREDITO
      │                                    clave no configurada ⇒ reason="transporte", sin fila huérfana
      │
      ├─ construirTareaDelegadaA2A(nombreAgente, insumo)   tope 8_000 chars (TAREA_DELEGADA_MAX_CHARS)
      │
      ├─ store.crearDelegacionA2A(...)     ← ANTES de invocar. estado = TASK_STATE_SUBMITTED
      │                                       a2a_task_id NULL, resultado NULL
      │
      ├─ await clienteA2A.delegar({ baseUrl, tarea })      ← el PUERTO (doble puro en todo test de núcleo)
      │     │
      │     │   ══════ src/adapters/a2a/client.ts ══════
      │     ├─ GET  <base>/.well-known/agent-card.json     → endpoint JSON-RPC + nombre del agente
      │     ├─ POST SendMessage                            → task.id, status.state
      │     └─ loop:  POST GetTask   cada pollIntervalMs   → hasta terminal | taskTimeoutMs
      │                 └─ timeout ⇒ CancelTask best-effort (nunca cambia el desenlace)
      │
      ├─ TASK_STATE_COMPLETED ──▶ store.completarDelegacionA2A(estado, a2a_task_id, resultado, updated_at)
      │                           └──▶ DelegacionA2AAplicada { resultado, a2aTaskId, ... }
      │                                     └──▶ el caso de uso lo incorpora como cualquier otro resultado
      │
      └─ cualquier otro desenlace ──▶ store.actualizarDelegacionA2A(último estado conocido)
                                      └──▶ throw DelegacionA2ANoCompletadaError { reason }
                                            (propaga tal cual — mismo contrato que despacharCadena)

   ══════ lo que DESAPARECE de dispatch-delegation.ts ══════
   - class DelegacionA2ANoImplementadaError                  (ADR 45 pto 2, deuda saldada)
   - if (destino.kind === "a2a") { throw ... }               (línea 216-218)
   - el test de hito-2.0 que assertea ese throw              (ADR 45 pto 3, "BORRAR en Hito 6")
```

**Determinismo y no-determinismo, misma línea de corte de siempre**: el arnés decide *a quién le delega, con qué texto acotado, cuánto espera y qué hace si no vuelve*; el agente externo decide *qué contesta*. La topología es determinista y testeable con dobles puros; el contenido no.

**Testing (TDD estricto, `strict_tdd: true` en `openspec/config.yaml`)**. Lo puro es la enorme mayoría (ADR 75 punto 5) y **ningún test de núcleo abre un socket**. La única categoría con red real es el archivo gateado de `src/test/integration/`, que degrada a *skip*.

---

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/adapters/a2a/config.ts` | **New** | `A2AConfig`, registro estático de destinos, `claveAVariableEntorno` (pura), `resolveA2AConfig(env)` — molde de `git/config.ts` (ADR 72) |
| `src/adapters/a2a/client.ts` | **New** | Agent Card + `SendMessage`/`GetTask`/`CancelTask` + loop de polling. `FetchFn` inyectable, `A2AClientError` con `reason`, `ERROR_BODY_MAX_CHARS = 500` (ADR 71/73) |
| `src/adapters/a2a/index.ts` | **New** | `createA2AAdapter(...)` — cierra el puerto del núcleo sobre `client.ts`, molde de `notificaciones/index.ts` |
| `src/core/agents/a2a-contract.ts` | **New** | `ClienteA2APort`, vocabulario `TASK_STATE_*`, `esEstadoTerminal` (pura), claves de destino, `DelegacionA2ANoCompletadaError` |
| `src/core/turn-selector/dispatch-delegation-a2a.ts` | **New** | `despacharDelegacionA2A`, `DelegacionA2AStorePort`, `DelegacionA2AAplicada`, `construirTareaDelegadaA2A` (ADR 74 pto 3) |
| `src/core/turn-selector/dispatch-delegation.ts` | **Modified** | **Borra** `DelegacionA2ANoImplementadaError` y el `throw` de la línea 216-218; actualiza los doc-comments que prometían esta deuda |
| `src/core/turn-selector/dispatch-delegation.test.ts` | **Modified** | **Borra** el test que assertea el error (ADR 45 pto 3, literal) |
| `src/adapters/memory/migrations/NNNN_delegaciones_a2a.ts` | **New** | DDL del ADR 74 pto 4; número por regla, al final de `index.ts` |
| `src/adapters/memory/repository.ts` | **Modified** | Alta, actualización y completado de `delegaciones_a2a` |
| `src/core/ventas/*` **o** un caso de uso nuevo | **Modified/New** | Punto de enganche de `"riesgo-credito"` — **abierto, ver R1 y punto 1 del checkpoint** |
| `src/core/commands/comando-empleado.ts` | **Modified** | Descriptor y rama de parseo de `/consultar-kpi <consulta>` (forma `id_mas_resto`, `privilegiado: true`) — **ADR 85** |
| `src/core/commands/registro-acciones-contract.ts` | **Modified** | `COMANDO_CONSULTAR_KPI` — una constante; `resultado` reusa `RESULTADO_ATENDIDA`/`RESULTADO_FALLIDA`. **Sin migración** (ADR 85 pto 9) |
| `src/build-on-comando-empleado.ts` | **Modified** | `manejarConsultarKpi` — primer llamador REAL del camino síncrono del ADR 74: `caso` nuevo, `await despacharDelegacionA2A(…, "kpi-incidente", …)`, traducción de cada `reason` a un mensaje legible — **ADR 85** |
| `src/main.ts` / `src/build-on-*.ts` | **Modified** | Wiring del adaptador A2A + interruptor `HARNESS_A2A_SALIENTE` |
| `src/core/logging/turn-logger.ts` | **Modified** | Eventos nuevos (`a2a-delegacion-iniciada`, `a2a-poll`, `a2a-delegacion-completada`, `a2a-delegacion-fallida`) — datos, sin cambio de contrato |
| `src/test/integration/a2a-client.integration.test.ts` | **New** | Único test con red real, gateado por sondeo del Agent Card (ADR 75) |
| `README.md` | **Modified** | Cómo levantar a mano un sample de `a2a-samples` |
| `openspec/config.yaml` | **Modified** | A2A sale de *"Planned (not yet installed)"* |
| `package.json` | — | **Sin dependencias nuevas** |

## Dependencias nuevas

**Ninguna.** `fetch` es global desde Node 18 y el repo exige Node ≥ 20; el patrón `FetchFn` inyectable ya está usado dos veces (`github-client.ts`, `email-client.ts`). **Sexto change consecutivo sin romper la racha de cero dependencias productivas nuevas** — y, en este caso, esa racha **es** el ADR 71.

---

## Entregables del Hito 6 — cobertura

| # | Entregable del Plan / arc42 | Cubierto por | ¿En alcance? |
|---|---|---|---|
| 1 | El arnés delega hacia afuera, a un agente externo real, y **recibe su resultado** (Plan línea 364; arc42 Escenario 4) | ADR 71 + 73 + 74; capability `delegacion-a2a-saliente` | **Sí** |
| 2 | JSON-RPC 2.0 sobre el protocolo A2A v1.0.0, con los **nombres reales** de método y de estado | ADR 71 ptos 4-5 | **Sí** — y corrige el Plan, que los cita mal |
| 3 | Descubrimiento vía Agent Card en la URL bien conocida (Plan línea 352) | ADR 72 pto 5 (`/.well-known/agent-card.json`) | **Sí**, con conjunto de destinos estático |
| 4 | **Dos** agentes externos de dominios distintos demostrados (Plan líneas 356-360) | ADR 72 pto 1 (`riesgo-credito`, `kpi-incidente`) | **Sí** — evidencia manual en `docs/progreso/`, y desde el **ADR 85** los dos con un **productor de producción** cada uno |
| 4b | El camino **síncrono-bloqueante** del arc42 Escenario 4 ejercitado por un llamador REAL, no sólo por dobles | **ADR 85** (`/consultar-kpi`) | **Sí** — es el gap que el ADR 85 cierra; sin él, el mecanismo central del ADR 74 quedaba sin caso de uso |
| 5 | Tabla `delegaciones_a2a` con el patrón de correlación `caso_id` + tarea acotada | ADR 74 pto 4 | **Sí**, con dos desviaciones declaradas |
| 6 | I4 (Núcleo ↔ Adaptador A2A) ejercitada por primera vez; `src/adapters/a2a/` deja de estar vacío | Adaptador nuevo + `ClienteA2APort` | **Sí** — cierra la *Deuda 2* del arc42 en su mitad cliente |
| 7 | El `throw` del brazo A2A desaparece y su test se borra | ADR 45 ptos 2-3 de `v2.0.0`, saldados | **Sí** |
| 8 | Rollback a `v2.1.0` exacto con una variable de entorno | `HARNESS_A2A_SALIENTE=off` | **Sí** |
| 9 | Verificación de riesgo/crédito **antes de confirmar una venta grande** (Plan línea 332) | Punto de enganche **a resolver** — ver **R1** | **Parcial** — el mecanismo sí; el punto exacto del flujo de ventas queda al checkpoint |
| — | Asincronía real, descubrimiento dinámico, streaming/push, Servidor A2A | — | **No** — ver *Out of Scope* |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **Nota de riesgo sobre la decisión 2 del checkpoint.** El ejemplo dado — *"el flujo de confirmación de venta grande del Hito 4 pasaría `riesgo-credito` explícito"* — **no tiene punto de enganche viable tal cual**. Verificado: `resolverDecisionVenta` (`src/core/ventas/confirmar-venta.ts:75`) es **síncrona a propósito**, y su propio doc-comment (líneas 11-13) declara esa sincronía como *"la prueba de que en este camino no hay ni puede haber una ventana de carrera"*. Un `await` a un agente externo la volvería `async` y **destruiría un invariante documentado del Hito 4**. Además, **no existe ningún umbral de "venta grande"** en el código: `ventas-config.ts` sólo tiene `reembolsoUmbral` (default 500) | **Alta** | **No se cambia la decisión en silencio.** Se propone el enganche alternativo: `registrarVenta` (`src/core/ventas/registrar-venta.ts:86`) **sí es `async`** y corre **antes** de emitir el token de confirmación — es decir, riesgo/crédito consultado *antes* de que el cliente pueda confirmar, que es lo que el Plan pide en español. Requiere un umbral nuevo (`ventaGrandeUmbral`) en `ventas-config.ts`. **Decisión del checkpoint**, punto 1 de la sección final. Alternativa: demostrar `riesgo-credito` desde un caso de uso propio y dejar ventas intacto |
| **R2** | **Nota de riesgo sobre la decisión 4 del checkpoint.** *"el resultado se incorpora como si fuera el `resultado` de cualquier otra delegación (mismo contrato que `DelegacionAplicada`)"* **no es literalmente alcanzable**: `construirTareaDelegada` exige un `AgentDefinition` (`dispatch-delegation.ts:225`), `completarDelegacion` inserta una fila de `sesiones_agente` con `sdk_session_id` en la misma transacción (ADR 48), y `DelegacionAplicada` lleva `sesionSubagenteId` — tres cosas que un agente externo no tiene | **Alta** | ADR 74 pto 3: función **hermana** con puerto de store propio y resultado `DelegacionA2AAplicada`. **El contrato conceptual se respeta entero** (texto acotado adentro, texto de resultado afuera, fila de traza antes y después); lo que no se puede compartir es el **tipo**. Sin esto, el Implementer llegaría a este muro con el código a medio escribir |
| **R3** | **Bloqueo de hasta 2 min en el camino web.** El webhook responde `202` antes de procesar (verificado, `webhooks/server.ts:127` — ADR 10), así que el camino del entregable principal está a salvo; pero si `riesgo-credito` se engancha en `registrarVenta` (R1), ese sí **retiene una petición `POST /venta`** | Med | `HARNESS_A2A_TASK_TIMEOUT_MS` configurable, y `sdd-design` debe fijar un techo **más bajo** para el camino web (o aplicar el mismo patrón *responder primero, procesar después* del ADR 10). Escrito acá para que no se descubra en producción |
| **R4** | **Conformidad de protocolo propia**: sin SDK, un cambio de especificación no llega por `npm update`, y v0.3.0→v1.0.0 ya demostró que A2A rompe compatibilidad | Med | Aceptado a conciencia (ADR 71 pto 7). Superficie mínima (3 métodos, 1 transporte), tipos cerrados que ignoran lo desconocido sin fallar, `reason = "protocolo"` para todo lo que no se reconoce, y **el test de integración contra un servidor real** como verificación de conformidad — que un SDK tampoco daría sin correrlo |
| **R5** | El test de integración **nunca corre en CI** (ningún sample de Python levantado), así que la conformidad real queda verificada sólo a mano | **Alta** | Aceptado por el ADR 75. Se compensa con: gate por **sondeo real** (no por bandera), README con el procedimiento, y **evidencia manual obligatoria** en `docs/progreso/v2.2-a2a-cliente/` contra **los dos** samples — que es lo que el checklist de cierre de `AGENTS.md` exige de todos modos |
| **R6** | **Nota de riesgo sobre la decisión 2**: el Plan y el arc42 piden descubrimiento **vía Agent Card**, no un endpoint JSON-RPC directo. El ADR 72 pto 5 lo resuelve buscando el card de un host estáticamente conocido — pero eso es **un `fetch` extra por delegación** y una interpretación mía de "sin descubrimiento dinámico" | Med | Declarado explícitamente en ADR 72 pto 5 y elevado al checkpoint (punto 2 de la sección final). Si el checkpoint prefiere el endpoint directo, es un cambio de una línea en `config.ts` y una desviación explícita del Plan que hay que escribir |
| R7 | **Borrar un requisito de spec vigente** (`despacho-delegacion`: *"El brazo A2A lanza un error tipado, sin adaptador"*) puede leerse como regresión si no está escrito | Med | Delta explícita en *Modified Capabilities*, citando ADR 45 pto 3 de `v2.0.0`, que **ordena** este borrado por escrito. Se aprueba en el checkpoint, no se descubre en el review — mismo tratamiento que R12 de `v2.1.0` |
| R8 | **SSRF**: un adaptador que hace `fetch` a una URL configurable | Baja | El conjunto de destinos es **fijo en el código**; sólo la URL de cada clave viene de env, y env es superficie del operador, no del usuario. **Ninguna URL entra por un caso, un prompt, un webhook ni un comando** (ADR 72, alternativa rechazada #1). Test que asserta que no existe firma pública por la que pasar una URL arbitraria |
| R9 | Los samples de `a2a-samples` sugeridos por el Plan **pueden no existir hoy** con ese nombre, o no implementar v1.0.0 (la exploración no lo verificó, deliberadamente) | Med | `sdd-tasks` verifica el repo de samples **antes** de escribir la tarea de evidencia. El adaptador es agnóstico al sample: cualquier agente A2A v1.0.0 con transporte JSON-RPC sirve. Si ninguno califica, el fallback es un servidor A2A mínimo propio **sólo para el test** (no productivo) |
| R10 | **Gate de secuencia**: `sdd-apply` arranca antes de que `v2.1.0` esté en `main`, con colisión de migración `0010` y de ADR | **Alta** | Sección *Dependencia de secuencia* como gate duro con verificación ejecutable. Es el mismo riesgo que `hito-2.1` documentó como R1 y que hoy **sigue sin cumplirse** |
| R11 | `TASK_STATE_INPUT_REQUIRED` tratado como fracaso puede sorprender: es un estado **normal** de A2A para agentes conversacionales | Med | Escrito en el ADR 73 pto 2 y en el spec, no descubierto: este hito no construye conversación multi-turno con el externo, y hacer polling sobre `INPUT_REQUIRED` sería esperar algo que nunca llega. `reason` propio y distinguible para que el diagnóstico sea inmediato |
| R12 | Presupuesto de review: adaptador + puerto + despachador + migración + repositorio + wiring + integración estimados en **~700-900 líneas** | **Alta** | `sdd-tasks` debe forecastear **PRs encadenados**. Corte natural: **(a)** `config.ts` + registro + puerto del núcleo; **(b)** `client.ts` + polling + test de integración; **(c)** tabla + `despacharDelegacionA2A` + borrado del `throw`; **(d)** wiring, interruptor y caso de uso demostrativo |
| R13 | El interruptor `HARNESS_A2A_SALIENTE=off` deja el brazo `a2a` **sin ningún productor** — el mismo estado que `v2.1.0`, pero ahora sin el `throw` que lo señalaba | Baja | Es el comportamiento buscado (rollback exacto), y está escrito en *Rollback Plan*. El `throw` no vuelve: su reemplazo es que ningún destino A2A se produzca |

---

## Rollback Plan

1. **En caliente**: `HARNESS_A2A_SALIENTE=off`. El composition root no cablea el adaptador A2A y ningún caso de uso produce una clave de destino: el arnés se comporta **exactamente** como `v2.1.0`. `delegaciones_a2a` queda vacía.
2. **Migración**: la tabla es nueva y `IF NOT EXISTS`; no altera ninguna existente ni la lee nadie más. Ninguna migración anterior se modifica.
3. **A nivel git**: revertir los commits de `hito/v2.2-a2a-cliente` antes del merge a `main`. Con PRs encadenados (R12), en orden inverso: wiring → despachador + tabla → cliente → config + puerto. El adaptador es **aditivo puro** y puede quedarse mergeado sin daño.
4. **Lo único no aditivo** es el borrado de `DelegacionA2ANoImplementadaError` y su test. Restaurarlos es revertir un commit acotado — y si se revierte, el brazo `a2a` vuelve a fallar por construcción, que era su estado en `v2.1.0`.
5. **Nada externo que revertir**: este change **no escribe** en ningún sistema de terceros. Un `SendMessage` a un agente externo puede haber gastado su tiempo, pero no dejó estado nuestro afuera.

---

## Dependencies

- **`hito-2.1-escritura-delegada` mergeado a `main`** con checklist de cierre completo y tag `v2.1.0` — **gate duro de `sdd-apply`**, ver *Dependencia de secuencia*. Hoy **no** se cumple: `main` corta en `v2.0.0`.
- **Un agente A2A v1.0.0 con transporte JSON-RPC alcanzable** para el test de integración y para la evidencia de cierre — no automatizado, no en CI (ADR 75).
- Node ≥ 20 (ya declarado en `package.json`) con `fetch` global. Sin paquetes nuevos.
- **Checkpoint humano aprobando esta propuesta** — en particular ADR 74 (síncrono, y el punto 3 sobre la función hermana), ADR 72 punto 5 (Agent Card sí/no), ADR 71 punto 5 (`TASK_STATE_*` persistidos crudos), la delta de borrado sobre `despacho-delegacion` (R7) y el enganche de `riesgo-credito` (R1) — **antes** de `sdd-spec`/`sdd-design`.
- `sdd-spec` corre **primero**: `AGENTS.md` pone la especificación antes del diseño, y las dos capabilities nuevas no tienen requirements escritos.

## Success Criteria

- [ ] Una delegación a `"riesgo-credito"` contra un agente A2A real deja **una fila** en `delegaciones_a2a` con `destino_clave`, `agente_externo_url`, `a2a_task_id` no nulo, `estado = "TASK_STATE_COMPLETED"` y `resultado` no vacío.
- [ ] El **mismo** mecanismo, sin una línea de código distinta, funciona con `"kpi-incidente"` contra un agente de **otro dominio** — es lo que demuestra que el Cliente A2A es agnóstico al dominio.
- [ ] **(ADR 85)** `/consultar-kpi <consulta>` en la TUI, con sesión vigente, **espera** la respuesta del agente externo de KPIs y la devuelve como texto del turno — el camino **síncrono** del ADR 74 ejercitado por un llamador de producción, no sólo por un doble.
- [ ] **(ADR 85)** `/consultar-kpi` sin sesión vigente **no** delega ni crea fila alguna: responde el mensaje de la guarda de privilegio, igual que `/ver-propuesta`.
- [ ] **(ADR 85)** Cada `reason` de `DelegacionA2ANoCompletadaError` produce un mensaje **distinto y legible** en la TUI — ninguno deja al empleado sin respuesta, ninguno cuelga la TUI más allá de `HARNESS_A2A_TASK_TIMEOUT_MS`.
- [ ] La fila existe con `estado = "TASK_STATE_SUBMITTED"` **antes** del `SendMessage`, y se completa después — verificable con un doble que falla justo después de crear.
- [ ] Un agente externo que devuelve `TASK_STATE_FAILED` produce `DelegacionA2ANoCompletadaError` con `reason = "failed"`, **fila persistida con ese estado**, y **ningún** crash ni hang.
- [ ] Un agente que nunca llega a terminal agota `HARNESS_A2A_TASK_TIMEOUT_MS`, intenta `CancelTask`, y falla con `reason = "timeout"` dejando el **último estado conocido** en la fila — con reloj inyectado, sin dormir de verdad en el test.
- [ ] `DelegacionA2ANoImplementadaError` **no existe** en el código, y el test de `hito-2.0` que la asserteaba **está borrado** (ADR 45 pto 3).
- [ ] **No existe ninguna firma pública** por la que un caso, un prompt, un webhook o un comando pueda inyectar una URL de destino arbitraria — test dedicado (R8).
- [ ] `esEstadoTerminal` tiene test **exhaustivo** sobre los ocho `TaskState` de v1.0.0, y un valor desconocido produce `reason = "protocolo"`, no una excepción.
- [ ] El cuerpo de un error HTTP del agente externo se trunca a **500 caracteres** en el mensaje, y **ninguna credencial** aparece en ningún mensaje ni log.
- [ ] Con `HARNESS_A2A_SALIENTE=off`, el arnés se comporta **idéntico a `v2.1.0`**: cero filas en `delegaciones_a2a`, cero `fetch` salientes de A2A, mismo veredicto en el bot de PRs.
- [ ] `npm test` y `npm run typecheck` en verde; **ningún test de núcleo abre un socket**; el único test con red real vive en `src/test/integration/` y **degrada a `skip`** cuando no hay agente disponible.
- [ ] El README explica cómo levantar a mano un sample de `a2a-samples` y qué variable exportar para que ese test deje de saltarse.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v2.2-a2a-cliente/` con evidencia end-to-end contra **los dos** agentes externos (tráfico JSON-RPC y filas de `delegaciones_a2a`) **más la nota de corrección al Plan** sobre los nombres de método y de estado, tag `v2.2.0`.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| **Asincronía real** (caso "esperando A2A", proceso que lo retoma) | Change futuro, **con condición de disparo escrita**: cuando exista un agente externo que tarde sistemáticamente más que `HARNESS_A2A_TASK_TIMEOUT_MS` | ADR 74 pto 1: el arc42 vigente describe un flujo síncrono, y toda la arquitectura de Hito 1 a 5.1 lo es. Sería un hito de **motor de ejecución**, no de comunicación A2A, y merece su propio ADR de otra escala |
| Streaming (`SendStreamingMessage`) y push notifications | Change futuro, sólo **después** de la asincronía real | ADR 73: sin asincronía real no aportan nada — el resultado se incorpora entero o no se incorpora |
| Descubrimiento dinámico de agentes (catálogo, resolución por capacidad) | Change futuro con más de dos destinos reales | ADR 72: con dos destinos, un catálogo es infraestructura especulativa. Con veinte, sería lo correcto |
| Caché del Agent Card | Cuando haya volumen que la justifique | Una caché trae invalidación, y la invalidación trae bugs que hoy nadie está pagando |
| **Servidor A2A** (`src/adapters/a2a/server.ts`, Caja Blanca 3.2) | **Hito 7** del Plan | El arc42 lo declara "hito posterior" (línea 370). Este change cubre la mitad **cliente** de la Deuda 2 |
| Transportes REST y gRPC de A2A | **Nunca, mientras I4 diga "JSON-RPC"** | arc42 línea 232 fija el formato de la interfaz. No es una limitación técnica: es el contrato de I4 |
| Compatibilidad con A2A v0.3.0 | **Nunca** | El Plan ya decidió v1.0.0 y v0.3.0 es incompatible. Un peer viejo falla con `reason = "protocolo"`, y eso es correcto |
| Delegación A2A decidida por el modelo | Change futuro | Sin cambios respecto del ADR 44 de `v2.0.0`: la topología la decide el arnés, el contenido el modelo |
| Autenticación real hacia agentes externos (OAuth, mTLS, rotación) | Cuando haya un agente externo que la exija | Los samples corren sin auth en `localhost`. Construir un flujo de credenciales sin un consumidor real sería adivinar |
| Automatizar el arranque de los samples de Python | **Nunca, mientras la Restricción Técnica del arc42 esté vigente** | ADR 75 pto 3: agregaría un runtime cruzado al repo para beneficio de un único test que además puede saltarse |
| Reintentos y backoff del Cliente A2A | Change futuro con evidencia de fallas transitorias | Coherencia con `github-client.ts` y `email-client.ts`, que tampoco reintentan. Un reintento sin idempotencia demostrada del peer duplicaría tareas |

---

## Qué necesita el checkpoint humano antes de `sdd-spec` / `sdd-design`

> Los cinco puntos de la decisión están **formalizados y verificados**; lo que sigue son las **colisiones reales** que la verificación encontró y que no puedo cerrar solo, más las palancas que quedaron abiertas.

1. **R1 — dónde engancha `"riesgo-credito"`.** Tu ejemplo era el flujo de confirmación de venta grande del Hito 4, pero `resolverDecisionVenta` **es síncrona a propósito** y su doc-comment declara esa sincronía como garantía de ausencia de carrera; y **no existe umbral de "venta grande"** en el código. Propongo `registrarVenta` (que sí es `async`, y corre antes de emitir el token) más un `ventaGrandeUmbral` nuevo en `ventas-config.ts`. **Alternativa**: dejar ventas intacto y demostrar `riesgo-credito` desde un caso de uso propio. Es una decisión tuya, no mía.

2. **ADR 72 pto 5 — ¿se busca el Agent Card, o el env guarda el endpoint JSON-RPC directo?** Interpreté "sin descubrimiento dinámico" como *"el conjunto de destinos es fijo"*, no como *"no se busca el card"* — y buscarlo es lo que el Plan y el arc42 piden literalmente. El costo es un `fetch` extra por delegación. Si preferías lo segundo, decilo ahora: es una línea de `config.ts` y una desviación explícita del Plan que hay que dejar escrita.

3. **R2 / ADR 74 pto 3 — función hermana, no rama adentro.** Es la única corrección estructural que le hago a tu enunciado, y es forzada por el código: `construirTareaDelegada` exige un `AgentDefinition` y `completarDelegacion` inserta una `sesiones_agente` en la misma transacción. El contrato conceptual queda intacto; el **tipo** `DelegacionAplicada` no se puede compartir. Confirmalo antes de `sdd-design`.

4. **ADR 71 pto 5 — `estado` persistido como `TASK_STATE_*` crudo.** Es la desviación del DDL del Plan que la exploración dejó explícitamente a tu criterio. Elegí el valor crudo del protocolo (la columna es traza, no vocabulario del núcleo). La alternativa es una capa de traducción a minúscula-con-guion, más legible internamente y sin ningún consumidor hoy.

5. **ADR 73 pto 3 — los tres números** (`30_000` por request, `1_500` de intervalo, `120_000` total). Los fijé con criterio, pero son parámetros operativos de tu máquina y tus samples. Si querés otros defaults, este es el momento: quedan en el spec.

6. **R7 — el borrado del requisito de spec de `despacho-delegacion`.** `v2.0.0` cerró con un requisito y un escenario que dicen que el brazo A2A lanza un error tipado. Este change los **borra**. Está ordenado por escrito en el ADR 45 pto 3, pero es un borrado de spec vigente y tiene que aprobarse acá, no leerse como sorpresa en el review.

7. **Dos capabilities en vez de una.** Propongo separar `cliente-a2a-jsonrpc` (adaptador, verificado con integración real) de `delegacion-a2a-saliente` (núcleo, verificado con dobles puros). Si preferís un solo spec, se colapsa sin cambiar ninguna decisión.

8. **R12 / estrategia de entrega.** Con ~700-900 líneas estimadas, el presupuesto de 400 por PR se supera: decidir **PRs encadenados** (corte sugerido en R12) o uno solo con `size:exception`.

9. **Confirmación del gate de secuencia.** Que quede asentado que `sdd-apply` de este change **no arranca** hasta ver `v2.1.0` mergeada en `main` con su tag — no como buena intención, sino como condición verificable (`git tag -l | grep -x v2.1.0` **y** `git ls-tree main --name-only src/adapters/git/`).

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase **sí tuvo shell disponible** y corrió `graphify query` sobre el vecindario del Cliente A2A/I4 antes de abrir archivos crudos (el binario advirtió que el grafo usa el esquema de IDs anterior a `#1504` — se recomienda `graphify extract --force` y `graphify update .` antes de `sdd-design`). Después se verificó **cada afirmación citada** contra el archivo real: `dispatch-delegation.ts` completo (`DestinoDelegacion` líneas 47-49, `DelegacionA2ANoImplementadaError` 52-64, `resolverDestino` 80-88, el `throw` 216-218, `input.destino` "ausente en producción" 198-199, `despacharCadena` "NO captura" 286-289), `subagents.ts` completo (`TAREA_DELEGADA_MAX_CHARS = 8_000` línea 38, `InvocarSubagente` 112-120), `email-client.ts` completo (`FetchFn`, `ERROR_BODY_MAX_CHARS = 500`, `truncate`, `AbortSignal.timeout`, "sin reintentos"), `github-client.ts` (`ERROR_BODY_MAX_CHARS` línea 27), `git/config.ts` completo (`resolvePositiveNumber`/`resolveNonBlankString`/`resolveGitConfig` y su nota de duplicación deliberada), `confirmar-venta.ts` líneas 1-120 (**sincronía declarada como invariante**), `registrar-venta.ts` (firma `async`, línea 86), `ventas-config.ts` (**no hay umbral de venta grande**), `0007_delegaciones.ts` completo (precedente de columnas agregadas y `NOT NULL` relajados), el catálogo de migraciones (techo `0009` en rama), `webhooks/server.ts` línea 127 (**`202` antes de `onEvent` sin `await`** — ADR 10), `run-tests.integration.test.ts` (`describe.skipIf`, línea 96), `openspec/config.yaml` (`strict_tdd: true`, `integration: true`, A2A "Planned"), el catálogo completo de archivos de spec existentes (19 nombres de capability únicos en 25 archivos), `hito-2.1/design.md` (ADR cierra en **70**), `hito-2.1/tasks.md` (**36 tareas marcadas, cero pendientes**), y el estado real de `main` (`git log`/`git tag`: **corta en `v2.0.0`**).

**Nota de formato**: la skill `sdd-propose` sugiere un tope de 450 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`, `hito-2.1`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato completo del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto.
