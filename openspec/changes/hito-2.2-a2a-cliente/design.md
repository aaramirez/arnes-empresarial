> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase **sí tuvo shell**: se corrió `graphify query "dispatch-delegation despacharDelegacion DestinoDelegacion resolverDestino DelegacionA2ANoImplementadaError registrarVenta ventas-config"` antes de abrir cualquier archivo (el binario volvió a advertir que el grafo usa el esquema de IDs anterior a `#1504` — sigue pendiente `graphify extract --force`). Después se verificó **cada firma citada** contra el archivo real: `src/core/turn-selector/dispatch-delegation.ts` completo, `src/core/agents/subagents.ts` completo, `src/adapters/board/github-client.ts` completo, `src/adapters/notificaciones/email-client.ts` completo, `src/adapters/notificaciones/index.ts` completo, `src/adapters/git/config.ts` completo, `src/core/ventas/registrar-venta.ts` completo, `src/core/ventas/ventas-config.ts` completo, `src/adapters/memory/repository.ts` (bloque `delegaciones`, líneas 1613-1737), `src/adapters/memory/migrations/index.ts` + `0009_propuestas_cambio.ts`, `src/build-on-venta.ts` (`buildOnVenta`, `toPromise`), `src/build-on-activity.ts` (`createDelegacionStore`), `src/main.ts` (líneas 318-340 del wiring de ventas y 388-418 del barrido no bloqueante), `src/adapters/web/server.ts` (`onAltaVenta` **awaiteado** antes del `201`), `src/core/logging/turn-logger.ts` (`logTurnEvent`), `src/test/integration/run-tests.integration.test.ts` (gate `describe.skipIf`), `openspec/config.yaml` (`strict_tdd: true`, `integration: true`), `README.md` (tabla de variables `HARNESS_*`).
>
> **Verificación externa adicional de esta fase** (dos `WebFetch` reales contra `a2a-protocol.org/v1.0.0/specification/`, no conocimiento previo): las formas de `params` de los tres métodos, los campos de `Message`/`Task`, los valores del enum `Role` y — hallazgo nuevo — que **`TaskState` tiene NUEVE valores, no ocho** (`TASK_STATE_UNSPECIFIED` existe). Ver **ADR 84** y **RD-27**.

# Diseño técnico: Comunicación A2A saliente — Cliente A2A (v2.2.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 71-75, R1-R13) · [`specs/`](specs/) (4 archivos: `cliente-a2a-jsonrpc` **nueva**, `delegacion-a2a-saliente` **nueva**, delta `MODIFIED` sobre `despacho-delegacion`, delta `ADDED` sobre `venta-confirmacion`) · [`exploration.md`](exploration.md) · [`hito-2.1-escritura-delegada/design.md`](../hito-2.1-escritura-delegada/design.md) (molde de formato y profundidad) · arc42 Caja Negra 5 (188-198), I4 (226-232), Caja Blanca 3.1 (352-364), Escenario de ejecución 4 (438-454).

**Rama**: `hito/v2.2-a2a-cliente` · **Tag**: `v2.2.0` · **Progreso**: `docs/progreso/v2.2-a2a-cliente/`.

**Numeración de ADR**: la propuesta cerró en el **75**. Este diseño abre en el **76** y llega al **84** — nueve decisiones que aparecieron **al bajar la propuesta a firmas reales** y que ningún ADR 71-75 podía anticipar. Riesgos residuales: **RD-19 a RD-31** (la numeración que `proposal.md` dejó reservada; RD-1 a RD-18 son de `v2.0.0`/`v2.1.0` y siguen vigentes).

> **★ Enmienda posterior — ADR 85 (`proposal.md`), productor real para `"kpi-incidente"`.** El checkpoint humano respondió §15 punto 2 con un **sí**: se agrega el comando TUI privilegiado `/consultar-kpi <consulta>`, **síncrono y bloqueante**, primer llamador de producción del mecanismo central del ADR 74. **RD-26 pasa a resuelto** (§13). Este documento se enmienda en: §1 (tabla de disciplinas de espera, ahora tres usos), §2 (mapa capability→módulos), **§5.7 nueva** (firmas del descriptor, del handler y las tres tensiones verificadas contra el código), §7.3 (`main.ts` hoistea `clienteA2A` y alimenta a los DOS consumidores), §8 (tres eventos), §9 (seis filas), §10.A/§10.B (dos filas de test), §11 (pasos 7b-7d), §12 (**cinco** PRs, ~1.975 líneas), §13 (RD-26 resuelto, **RD-30**/**RD-31** nuevos), §14 y §15. **Ningún ADR 71-84 se reabre**, y `DESTINOS_A2A` sigue teniendo exactamente dos claves.

**Cerrado por el checkpoint humano y NO reabierto por este documento**: ADR 71 (cliente propio, sin `@a2a-js/sdk`), ADR 72 (registro estático por clave + Agent Card buscado), ADR 73 (polling, los tres números, `CancelTask` best-effort), ADR 74 (**síncrono**, función hermana, tabla propia, error tipado que propaga), ADR 75 (puerto inyectable + un test de integración gateado), y las dos capabilities separadas.

**Decisión adicional cerrada por el checkpoint DESPUÉS de la propuesta, formalizada acá como ADR 76**: la consulta de riesgo/crédito de ventas es **informativa y NO BLOQUEANTE** — nunca cancela una venta y nunca retiene la respuesta de `POST /ventas`. Esto **cierra** la tensión que `specs/venta-confirmacion/spec.md` dejó explícitamente abierta y el **R3** de la propuesta. **No cambia el ADR 74**: el mecanismo central del Despachador sigue siendo síncrono y bloqueante.

---

## 0. Gate de secuencia — `sdd-apply` NO arranca sin esto

**Esta sección va primero a propósito, igual que en `v2.1.0`. No es una nota al pie: es una precondición de proceso del mismo rango que el checkpoint humano.** Es el **R10** de la propuesta, y **no bloquea este diseño** — bloquea su implementación.

Este diseño **no se puede aplicar** hasta que `hito-2.1-escritura-delegada` esté **mergeado a `main`** con su checklist de cierre completo y su tag.

| # | Comprobación | Comando | Estado hoy |
|---|---|---|---|
| 1 | El tag `v2.1.0` existe | `git tag -l \| rg -x v2.1.0` | **No cumple** (`git tag -l` llega a `v2.0.0`) |
| 2 | `src/adapters/git/` es código en `main` | `git ls-tree main --name-only src/adapters/git/` con salida no vacía | **No cumple** |
| 3 | La migración `0009` está en `main` | `git show main:src/adapters/memory/migrations/index.ts \| rg migration0009` | **No cumple** — vive sólo en la rama `hito/v2.1-escritura-delegada` |

**Por qué es duro**: sin (3), el número de migración de este change colisiona (ver **ADR 80** y §7.1) y `migrations/index.ts` habría que reordenarlo — justo lo que su propia convención (líneas 14-20, leídas) prohíbe. Sin (2), la rama de este hito nace de una `main` sin `src/adapters/git/` ni `src/adapters/test-runner/`, y el Implementer arrastra un merge que este change no tiene por qué resolver.

**Regla de citación mientras el gate no se cumpla**: todo objeto de `hito-2.1` que este documento nombre (`resolveGitConfig`, `resolvePositiveNumber`, `resolveNonBlankString`, `describe.skipIf`, la migración `0009`) se cita como **referencia verificada contra la rama `hito/v2.1-escritura-delegada`**, donde hoy es código real. El primer paso de `sdd-apply` es revalidar cada uno contra `main` y reportar cualquier deriva antes de escribir una línea.

---

## 1. Resumen de la arquitectura elegida

Un adaptador nuevo (3 archivos), dos módulos de núcleo nuevos, una tabla, **cero dependencias nuevas** — sexto change consecutivo sin romper la racha.

```
 ┌───────────────────────── src/core/ (nunca importa de adapters/) ────────────────────────┐
 │                                                                                         │
 │  agents/a2a-contract.ts        TASK_STATE_* · esEstadoTerminal() · motivoDeEstado()      │
 │      (SIN imports)             DESTINOS_A2A · DestinoA2AClave · resolverDestinoA2A()     │
 │                                ClienteA2APort · ResultadoA2A                             │
 │                                DelegacionA2ANoCompletadaError · DestinoA2ADesconocidoError│
 │                                                                                         │
 │  turn-selector/dispatch-delegation-a2a.ts   despacharDelegacionA2A()  ← SÍNCRONO/BLOQUEA │
 │      (hermana, ADR 74 pto 3)                DelegacionA2AStorePort · DelegacionA2AAplicada│
 │                                             construirTareaDelegadaA2A()                  │
 │                                                                                         │
 │  turn-selector/dispatch-delegation.ts (mod)  ─ DelegacionA2ANoImplementadaError BORRADA  │
 │                                              ─ el `throw` de la línea 216-218 BORRADO    │
 │                                              ─ DestinoDelegacion.a2a sin `endpoint`      │
 │                                                                                         │
 │  ventas/ventas-config.ts (mod)    ventaGrandeUmbral                                     │
 │  ventas/ventas-contract.ts (mod)  ConsultaRiesgoCreditoPort  ← NUNCA rechaza            │
 │  ventas/registrar-venta.ts (mod)  `void riesgoCredito.consultar(...)`  ← NO BLOQUEANTE  │
 └───────▲─────────────────────────────────────────────────────────────────────────────────┘
         │  (adapters → core: permitido; core → adapters: JAMÁS)
 ┌───────┴──────────────────────────────────┐
 │ src/adapters/a2a/  (3 archivos)          │      ¡CERO contacto con board/ y
 │   config.ts   registro + env + timeouts  │       notificaciones/! (AGENTS.md)
 │   client.ts   AgentCard · SendMessage ·  │       `FetchFn`, `truncate` y
 │               GetTask (loop) · CancelTask│       ERROR_BODY_MAX_CHARS se
 │   index.ts    createA2AAdapter()         │       DUPLICAN a propósito
 └───────▲──────────────────────────────────┘
         │
         └────── src/main.ts · build-on-venta.ts ──────  (composition root: el único que los une)
                 HARNESS_A2A_SALIENTE (opt-in, ADR 82)
```

**La línea de corte, en una frase**: el arnés decide **a quién le delega afuera, con qué texto acotado, cuánto espera y qué hace si no vuelve**; el agente externo decide **qué contesta**. La topología es determinista y se testea entera con dobles puros; el contenido no.

**Las DOS disciplinas de espera sobre UN solo cliente** — es el corazón de este diseño y hay que leerlo antes que cualquier firma. **Enmienda ADR 85**: son dos disciplinas y ahora **tres** usos — el tercero es el que faltaba para que la disciplina síncrona tenga un llamador real:

| Uso | Quién espera | Disciplina | Por qué |
|---|---|---|---|
| **Núcleo** — `despacharDelegacionA2A` | el llamador, con `await` | **SÍNCRONA, bloquea** hasta terminal o `taskTimeoutMs` | ADR 74: el arc42 Escenario 4 describe un flujo síncrono y toda la arquitectura de Hito 1 a 5.1 lo es. Es el contrato para cuando un turno **necesita** el resultado antes de seguir |
| **Ventas** — `registrarVenta` | **nadie** | **NO BLOQUEANTE** (`void ….catch(…)`) | ADR 76: la consulta es **informativa**, `POST /ventas` es un camino web con un humano esperando, y `onAltaVenta` **sí** está awaiteado antes del `201` (verificado, `web/server.ts:246`) |
| **TUI** — `/consultar-kpi` (**ADR 85**) | el **empleado**, con `await` | **SÍNCRONA, bloquea** — el uso canónico del ADR 74 | El empleado pidió una respuesta y la está esperando en pantalla: es exactamente el Escenario 4 del arc42 (*"el agente delega… y recibe su resultado"*). Sin este uso, la disciplina síncrona quedaba **sin un solo llamador de producción** — el gap que el ADR 85 cierra, y con él **RD-26** |

**Lo que NO cambia**: `despacharDelegacion`, `despacharCadena`, `resolverDestino`, `construirTareaDelegada`, `SUBAGENT_REGISTRY`, la cadena Planner→Developer→Reviewer, la tabla `delegaciones`, y el invariante de sincronía de `resolverDecisionVenta`/`confirmarVenta` (`confirmar-venta.ts:11-13`, **no se toca ni una línea**).

---

## 2. Mapa capability → módulos de código

| Capability (spec) | Módulos de código reales | ¿1:1? |
|---|---|---|
| `cliente-a2a-jsonrpc` | `src/adapters/a2a/config.ts` + `client.ts` + `index.ts` + `src/test/integration/a2a-client.integration.test.ts` | **1:N.** Es la capability del adaptador: card, los tres métodos, el loop, la clasificación de fallas, el truncado |
| `delegacion-a2a-saliente` | `src/core/agents/a2a-contract.ts` + `src/core/turn-selector/dispatch-delegation-a2a.ts` + migración `NNNN` + `repository.ts` + `createDelegacionA2AStore` **+ (ADR 85)** `src/core/commands/comando-empleado.ts` + `src/core/commands/registro-acciones-contract.ts` + `src/build-on-comando-empleado.ts` | **1:N**, igual que `propuesta-cambio-hitl` en `v2.1.0` — que también aloja sus tres comandos TUI dentro de la capability del dominio, no en una delta sobre `comando-empleado-tui`. Los tres requirements del ADR 85 caen acá por ese mismo precedente |
| `despacho-delegacion` (delta `MODIFIED`) | `src/core/turn-selector/dispatch-delegation.ts` + `dispatch-delegation.test.ts` (**borrados**) | **1:2** — el requirement es un comportamiento observable ("el brazo A2A ya no falla por construcción") repartido entre el módulo y el test que lo asseveraba |
| `venta-confirmacion` (delta `ADDED`) | `src/core/ventas/ventas-config.ts` + `ventas-contract.ts` + `registrar-venta.ts` + `src/build-on-venta.ts` + `src/main.ts` | **1:5**, aceptado — el enganche es un punto del flujo, su umbral, su puerto y su cableado |

**Cobertura**: los cuatro archivos de spec cubren **todo** lo que este diseño construye, y este diseño no construye nada que los specs no pidan. Verificación requirement por requirement en **§14**.

---

## 3. Decisiones de arquitectura (ADR 76-84)

### ADR 76: La consulta de riesgo/crédito de ventas es **INFORMATIVA y NO BLOQUEANTE** — nunca cancela una venta, nunca retiene `POST /ventas`

**Contexto**. `specs/venta-confirmacion/spec.md` fijó el **punto de enganche** (`registrarVenta`, después de persistir, antes de notificar) pero dejó explícitamente abierto **qué pasa cuando la delegación de riesgo falla**, con tres alternativas (rechazar la venta / best-effort / un estado nuevo de venta bloqueada) y ligado a **R3**: con `taskTimeoutMs = 120_000`, un `await` en ese camino retendría la petición HTTP hasta **2 minutos**. Verificado, no supuesto: `web/server.ts:246` hace `const resultado = await onAltaVenta(payloadResult.valor);` y **recién después** responde `201`. No hay ningún `202`-antes-de-procesar en el camino de ventas — el ADR 10 protege sólo al adaptador de webhooks.

**Decisión**:

1. **La consulta NUNCA bloquea ni cancela la venta.** Ningún flujo del Plan ni del arc42 describe un **rechazo** de venta por A2A: el Plan dice *"verificación de riesgo/crédito antes de confirmar una venta grande"*, no *"autorización de riesgo/crédito"*. Y el patrón establecido del repo para un servicio externo en el camino de una venta es **degradar con evento, nunca cortar el camino principal** — literalmente el contrato de `VentaNotifierPort` (*"nunca rechaza, nunca lanza"*, `registrar-venta.ts:4-6` y `notificaciones/index.ts:60-64`). Se elige la alternativa **(b)** de las tres que el spec enumeró. Las otras dos quedan rechazadas por escrito, abajo.
2. **Corre NO BLOQUEANTE, con el molde literal de `main.ts:412-418`**: se **dispara** entre el paso 2 (venta+caso persistidos) y el paso 4 (notificación) — así el orden que el spec exige se cumple: la delegación **se invoca antes** de que `notificarLinkConfirmacion` se llame — pero **sin `await`**, con un `.catch()` como red de seguridad sobre un puerto que ya promete no rechazar. Misma frase que el bloque 5d de `main.ts` usa sobre `barrerHuerfanos`.
3. **El resultado se persiste igual**: cuando la respuesta llega (o vence), `despacharDelegacionA2A` ya dejó la fila de `delegaciones_a2a` con su último estado conocido y su `resultado`. La trazabilidad **no** depende de que alguien esté esperando.
4. **Falla o vence ⇒ evento, nada más.** `a2a-delegacion-fallida` con `reason`, y la venta sigue exactamente su curso: el cliente recibe su link, el token es válido, la comisión se calcula igual. Cero cambios en el catálogo de estados de `ventas` (`pendiente_confirmacion | confirmada | rechazada`), cero columnas nuevas, cero transiciones nuevas.
5. **El ADR 74 NO cambia.** El Despachador sigue siendo síncrono y bloqueante: es el contrato para cuando un turno de verdad necesita la respuesta antes de continuar (p. ej. si un hito futuro delega una revisión de PR a un agente externo). Son **dos usos del mismo Cliente A2A con dos disciplinas de espera distintas**, y el que se difiere del camino de respuesta es el enganche puntual de ventas, **fuera** del Despachador, cableado en el composition root.
6. **Consecuencia declarada, no escondida (RD-21)**: con esta decisión, *"el cliente nunca recibe un link sin que la verificación ya se haya intentado"* se cumple en el sentido **iniciada**, no **resuelta**. El spec dice *"intentado"* y esa lectura se sostiene; la lectura fuerte (*"intentada y concluida"*) **no** se satisface, y eso es exactamente el precio de no retener la respuesta HTTP.

**Alternativas consideradas**:

- *(a) La falla propaga y `registrarVenta` rechaza sin notificar*: **rechazada**. Dejaría `ventas.estado = 'pendiente_confirmacion'` con el cliente sin link y sin forma de recuperarlo, convertiría un agente externo caído en una caída del alta de ventas, y contradice el criterio de `VentaNotifierPort` que la propia función ya aplica al email.
- *(c) Un estado nuevo de venta bloqueada*: **rechazada**. Abre un cuarto valor en un catálogo cerrado por la spec base de `venta-confirmacion`, y — precedente **RD-12** de `v2.1.0`, textual — *"un estado que promete una transición que ningún camino ejecuta es peor que no tenerlo"*: nadie desbloquearía esa venta, porque este hito no construye ningún proceso que retome nada.
- *Bloquear con un timeout más bajo (p. ej. 5 s) sólo para este camino*: **rechazada**. Sigue reteniendo la petición, agrega una segunda perilla de timeout sin consumidor propio, y convierte un agente externo lento en latencia visible para el vendedor. Con la consulta no bloqueante, **R3 queda cerrado sin perilla nueva**.

### ADR 77: `ClienteA2APort` **NUNCA rechaza** — devuelve un resultado etiquetado, y el **núcleo** construye el error tipado DESPUÉS de persistir

**Contexto**. El spec de `delegacion-a2a-saliente` exige dos cosas a la vez: (a) la fila de `delegaciones_a2a` queda **siempre** con el último estado conocido, y (b) se propaga `DelegacionA2ANoCompletadaError` con su `reason`. Si el adaptador **lanzara**, el núcleo tendría que atrapar una excepción de un adaptador para poder persistir antes de relanzar — y el repo tiene una regla explícita al respecto: el error del adaptador *"NUNCA cruza la frontera del puerto"* (`github-client.ts:29-33`, `email-client.ts:30-34`).

**Decisión**:

1. **`ClienteA2APort.delegar` devuelve `Promise<ResultadoA2A>`** — unión discriminada por `ok`, con `reason` y `estado` en la rama de fallo — y **nunca rechaza**. Precedente exacto y ya aprobado: `AplicarPatchPort` (ADR 64 pto 3 de `v2.1.0`) y `VentaNotifierPort`. Un resultado etiquetado **obliga** a manejar el camino de fallo; una excepción invita a olvidarlo.
2. **El vocabulario de `reason` vive en el NÚCLEO**, no en el adaptador: `MotivoDelegacionA2ANoCompletada` se declara en `a2a-contract.ts` y el adaptador lo **importa**. Precedente literal y verificado: `notificaciones/index.ts:1` importa `NotificacionMotivo` de `core/ventas/ventas-contract.js`. Sin esto, habría dos uniones de ocho strings que se desincronizan en el primer cambio.
3. **El núcleo construye la excepción, después de escribir la fila.** Orden no negociable de `despacharDelegacionA2A`: `resultado.ok === false` ⇒ `store.actualizarDelegacionA2A(último estado conocido)` ⇒ `logEvent` ⇒ `throw new DelegacionA2ANoCompletadaError(reason, …)`. La excepción es lo **último**, siempre.
4. **Red de seguridad de una línea**: `despacharDelegacionA2A` envuelve la llamada al puerto en un `try/catch` que traduce cualquier rechazo inesperado a `{ ok: false, reason: "transporte" }`. El contrato dice que no puede pasar; el `.catch()` de `main.ts:414` sobre `barrerHuerfanos` es el mismo criterio aplicado a otra promesa que también promete no rechazar.

### ADR 78: `DestinoDelegacion.a2a` pierde `endpoint` y gana `clave`; `despacharDelegacion.input.destino` se **angosta** a la rama in-process — la prohibición se vuelve **inexpresable**, no un `throw`

**Contexto**. La delta de `despacho-delegacion` ordena borrar `DelegacionA2ANoImplementadaError` **y** su `throw`, y a la vez que `despacharDelegacion` siga despachando **únicamente** destinos in-process. Bajado a TypeScript real, eso choca: hoy `input.destino?: DestinoDelegacion` acepta la unión completa y la línea 216-218 es lo único que la **angosta** (`if (destino.kind === "a2a") throw`). Borrar el `if` sin tocar el tipo deja `destino` como la unión entera y el código de abajo leyendo `agentId` de un destino que puede no ser in-process — un `never`-check perdido, no una prohibición. Y hay un problema peor: la rama a2a declara hoy `readonly endpoint: string`, es decir **una URL como campo de un tipo público exportado** — exactamente lo que el requirement de `cliente-a2a-jsonrpc` (*"no existe una firma pública por la que … inyectar una URL de destino arbitraria"*) y **R8** prohíben.

**Decisión**:

1. **La rama a2a se redefine**: `{ readonly kind: "a2a"; readonly clave: DestinoA2AClave }`. **Se va `endpoint: string`** (la URL sale del registro por env, jamás de un parámetro) y se va `agentId` (un agente externo no tiene ni puede tener entrada en `SUBAGENT_REGISTRY` — R2 de la propuesta, ya aceptado).
2. **`despacharDelegacion.input.destino` se angosta por tipo**: `readonly destino?: Extract<DestinoDelegacion, { kind: "in-process" }>`. Con eso, *"un destino `a2a` no se resuelve ni se despacha a través de `despacharDelegacion`"* deja de ser una convención y pasa a ser **un error de compilación**. Mismo mecanismo con el que el ADR 57 pto 4 hizo `git commit` inexpresable y el ADR 67 hizo inexpresable un Developer con `Write` sin `cwd`.
3. **La rama a2a de la unión NO queda muerta**: su consumidor real es `despacharDelegacionA2A`, que recibe `destino: DestinoA2A` (= `Extract<DestinoDelegacion, { kind: "a2a" }>`). La unión sigue siendo el vocabulario único de "destino de una delegación" del arnés, con dos brazos y dos despachadores.
4. **`resolverDestino` no cambia de forma** (ADR 72 pto 7, respetado): sigue devolviendo siempre `{ kind: "in-process", agentId }` y lanzando `SubagenteDesconocidoError`. Su hermana `resolverDestinoA2A(clave: string): DestinoA2A` valida contra el registro cerrado y lanza `DestinoA2ADesconocidoError` — **misma forma, mismo criterio, otro registro**.
5. **El doc-comment de `resolverDestino` y el de `input.destino` se reescriben** en el mismo commit: hoy prometen una deuda (*"Hito 6: reemplazar el `throw`… y BORRAR el test"*) que este change salda. Un doc-comment que sigue prometiendo lo ya hecho es peor que no tenerlo.

**Alternativas consideradas**:

- *Borrar la rama `a2a` de `DestinoDelegacion` por completo*: **rechazada**. La delta de spec dice explícitamente que la rama sigue existiendo y sin ser alcanzable por `resolverDestino`; borrarla dejaría al arnés sin un tipo que nombre los dos destinos posibles y obligaría a `despacharDelegacionA2A` a inventar el suyo.
- *Dejar `endpoint: string` y confiar en que nadie lo construya a mano*: **rechazada** por R8. Una URL en un tipo público exportado es una firma de inyección, aunque hoy nadie la use.
- *Mantener `input.destino?: DestinoDelegacion` y agregar un `if` que ignore el brazo a2a*: **rechazada**. Cambia un `throw` explícito por un descarte silencioso, que es estrictamente peor que lo que había.

### ADR 79: El encabezado de la tarea delegada externa usa la **clave de destino**, no el nombre del Agent Card — y `truncarTareaDelegada` se **exporta** en vez de duplicarse

**Contexto**. El ADR 74 pto 3 dice que `construirTareaDelegadaA2A` arma el texto *"tomando el nombre del Agent Card como encabezado"*. Bajado al orden real de las operaciones, **es imposible**: el spec exige crear la fila de `delegaciones_a2a` — con `tarea_delegada` **NOT NULL** — **antes** de invocar al Cliente A2A, y el nombre del agente sólo se conoce **después** del `GET .well-known/agent-card.json`, que ocurre dentro de esa invocación.

**Decisión**:

1. **El encabezado es la clave de destino**: `Destino externo: riesgo-credito`. Es la información que el arnés **sí** tiene en el momento de construir el texto, es estable entre corridas (a diferencia del `name` de un card de terceros) y es la misma que se persiste en `destino_clave` — la fila queda auditable por sí sola, que es el criterio literal con el que `construirTareaDelegada` justifica su propio encabezado (`subagents.ts:63-66`).
2. **El nombre del agente se persiste igual, pero como evidencia del desenlace**, no como parte de la tarea: viaja en `ResultadoA2A.agenteNombre` y se loguea en `a2a-delegacion-completada`. Si además se quisiera en la fila haría falta una columna que el DDL del Plan no tiene — no se agrega (ver §7.1).
3. **`TAREA_DELEGADA_MAX_CHARS` se reusa TAL CUAL** (`subagents.ts:38`) y `truncarTareaDelegada` (hoy privada, línea 52) **se exporta**. Cambio aditivo de una palabra, cero cambio de comportamiento, core→core permitido. La alternativa era copiar seis líneas de truncado a otro módulo del núcleo: no aplica la excusa de "infraestructura de adaptador" del ADR 71 pto 3, porque acá **los dos lados son núcleo** y la regla de `AGENTS.md` no prohíbe nada. Duplicar el tope sería duplicar el invariante.
4. **`construirTareaDelegadaA2A` NO recibe una `AgentDefinition`** (requirement literal del spec) — recibe `(destinoClave, insumo)` y devuelve el texto truncado.

### ADR 80: `agente_externo_url` nace con la **URL base** y se sobrescribe con el **endpoint efectivo**; `actualizarDelegacionA2A` es **un** método, sin transacción

**Contexto**. Dos exigencias que chocan: `agente_externo_url` es **`NOT NULL`** (DDL del Plan, conservado por el ADR 74 pto 4) y la fila se crea **antes** de invocar — pero el endpoint JSON-RPC **efectivo** es el `url` del Agent Card, que se conoce recién dentro de la llamada (ADR 72 pto 5).

**Decisión**:

1. **La fila nace con la URL base configurada** (`HARNESS_A2A_ENDPOINT_<CLAVE>`) y, cuando el card resuelve, **se sobrescribe con el endpoint efectivo**. Así la columna cumple `NOT NULL` desde el minuto cero y termina siendo lo que el ADR 72 pto 6 pide que sea: **evidencia de contra qué corrió realmente**. Si el card nunca resuelve, la fila queda con la base — que es exactamente la información diagnóstica correcta para ese fallo.
2. **El núcleo obtiene la URL base sin tocar la red**: `ClienteA2APort` expone `baseUrlDe(clave): string | undefined` — **síncrona y pura**, una lectura del registro ya resuelto. Es lo que permite cumplir el escenario *"delegar a una clave sin endpoint configurado falla tipado, **sin crear una fila huérfana**"*: se consulta **antes** de `store.crearDelegacionA2A`.
3. **Un solo método de actualización, sin transacción.** `delegaciones` necesita `completarDelegacion` transaccional porque inserta una fila de `sesiones_agente` en el mismo acto (ADR 48); un agente externo **no produce sesión del SDK**, así que no hay nada que atomizar: `actualizarDelegacionA2A({ delegacionId, estado, a2aTaskId?, resultado?, agenteExternoUrl?, updatedAt })` es un `UPDATE` de una tabla. Dos métodos en el puerto (`crear` + `actualizar`), no tres — "completar" es actualizar con `resultado`.
4. **`crearDelegacionA2A` falla RUIDOSAMENTE** (mismo criterio que `crearDelegacion` y `ActivityStorePort`): sin fila no hay trazabilidad, y una delegación externa sin traza es peor que una que no ocurrió. **`actualizarDelegacionA2A` también propaga** — si falla, el error de escritura tapa al de la delegación, y eso es correcto: una base que no acepta un `UPDATE` es un problema mayor que un agente externo que no contestó.

### ADR 81: El reloj y el sueño del loop de polling son **inyectables**; el timeout total se mide con **reloj de pared**, no contando iteraciones

**Contexto**. El spec pide dos cosas verificables sin dormir de verdad: *"el tiempo simulado entre cada `GetTask` sucesivo coincide con `pollIntervalMs`"* y *"un `GetTask` que excede `requestTimeoutMs` … el loop puede seguir hasta agotar `taskTimeoutMs`"*. Un test que espere 120 s reales es inaceptable, y contar iteraciones (`n * pollIntervalMs`) **no** es equivalente al reloj: cada request tarda lo suyo y una consulta que se murió por timeout de 30 s consumió reloj sin consumir intervalo.

**Decisión**:

1. **`A2AClientDeps` lleva `ahoraMs: () => number` y `dormir: (ms: number) => Promise<void>`**, con defaults reales (`Date.now` y `setTimeout` envuelto en promesa) en `createA2AAdapter`. Mismo espíritu que `BarridoWorktreePort.barrerHuerfanos`, que recibe `ahoraMs` inyectado *"no `Date.now()` adentro: el test fabrica mtimes viejos y recientes"* (`worktree-contract.ts`, verificado).
2. **`deadline = ahoraMs() + taskTimeoutMs`, calculado una vez**, después del `SendMessage`. La condición de corte es `ahoraMs() >= deadline`, evaluada **antes** de dormir y **antes** de cada `GetTask`. Nunca `intentos > N`.
3. **Un `GetTask` que falla por transporte NO corta el loop**: se loguea `a2a-poll-fallido` y el loop sigue hasta el deadline con el **último estado conocido** intacto. Eso **no** es un reintento (ADR 71: cero reintentos): es la siguiente consulta programada. La distinción se escribe en el doc-comment, porque es exactamente donde un futuro Implementer metería un backoff.
4. **`SendMessage` que falla por transporte SÍ corta**: sin `task.id` no hay nada que consultar. Es la asimetría deliberada del loop.

### ADR 82: `HARNESS_A2A_SALIENTE` es **opt-in** (`off` por default) — al revés que `HARNESS_DELEGACION_ROLES` y `HARNESS_ESCRITURA_DELEGADA`

**Contexto**. Los dos interruptores previos usan `(process.env.X ?? "on") !== "off"`: **activos por default**. El requirement del spec dice, literal: *"Con `HARNESS_A2A_SALIENTE=off` **(o sin configurar)**, el composition root SHALL NOT cablear ningún adaptador A2A"*.

**Decisión**:

1. **`const a2aSalienteActivo = (process.env.HARNESS_A2A_SALIENTE ?? "off").trim().toLowerCase() === "on";`** — se activa **sólo** con el valor explícito `on`. Cualquier otra cosa (ausente, vacío, `"true"`, `"1"`, basura) deja el arnés en `v2.1.0` exacto.
2. **Por qué se invierte el default y no es un descuido**: (a) es lo que el spec pide; (b) los otros dos interruptores gobiernan trabajo **adentro del proceso**, mientras que éste gobierna **tráfico saliente hacia un tercero** — un default que hace `fetch` a una URL de una variable de entorno sin que nadie lo haya pedido es la clase de default que no se defiende en un review; (c) sin endpoints configurados el mecanismo no puede hacer nada útil, así que el default activo sólo produciría fallas tipadas.
3. **Coherencia con el rollback**: `HARNESS_A2A_SALIENTE` ausente ⇒ `riesgoCredito === undefined` en `buildOnVenta` ⇒ `registrarVenta` **ni siquiera evalúa el umbral** ⇒ cero filas, cero `fetch`. Es el mismo mecanismo con el que `escritura === undefined` desactiva `v2.1.0` (verificado en §7.3 de su design).

### ADR 83: `VENTA_GRANDE_UMBRAL` vive en `ventas-config.ts` **sin prefijo `HARNESS_`**, con default `5_000`

**Contexto**. El repo tiene dos convenciones de nombres de variable conviviendo, y no es un descuido: la config de **adaptador** usa `HARNESS_*` (`HARNESS_GIT_BIN`, `HARNESS_WORKTREE_TTL_MS`, y ahora `HARNESS_A2A_*`), mientras que las **reglas de negocio** de ventas usan nombres sin prefijo (`COMISION_PORCENTAJE`, `REEMBOLSO_UMBRAL`, `VENTA_TOKEN_TTL_HORAS`) y viven en el **núcleo**, con el criterio explícito del ADR 17a: *"el porcentaje de comisión y el umbral de reembolso son parámetros del negocio, no del transporte"*.

**Decisión**:

1. **`VENTA_GRANDE_UMBRAL` → `VentasConfig.ventaGrandeUmbral`**, resuelto con `resolveNumeroValidado` (ya exportada, `ventas-config.ts:56`) y la **misma** validación que `REEMBOLSO_UMBRAL`: finito, `> 0`, ausente o en blanco ⇒ default, presente e inválido ⇒ **error de arranque acumulado**. Cero infraestructura nueva: tres líneas dentro de `resolveVentasConfig`.
2. **Qué monto es "grande" es del negocio, no del adaptador A2A.** Ponerlo en `src/adapters/a2a/config.ts` acoplaría una regla de ventas al transporte que hoy la consume, y rompería el criterio de `registrar-venta.ts`, que sólo conoce `VentasConfig`.
3. **Default `5_000`**, con el razonamiento escrito: tiene que ser **holgadamente mayor** que `DEFAULT_REEMBOLSO_UMBRAL` (500) — si toda venta que puede escalar un reembolso fuera además "venta grande", el umbral no seleccionaría nada — y chico como para que la demo del entregable dispare con un monto plausible. **Es un número operativo**, en la misma categoría que los tres del ADR 73: si el checkpoint quiere otro, se cambia acá y queda en el spec (§15 pto 3).
4. **`>=`, no `>`**: un monto exactamente igual al umbral **es** venta grande (escenario literal del spec).

### ADR 84: `TaskState` tiene **NUEVE** valores, no ocho — `TASK_STATE_UNSPECIFIED` se trata como `protocolo`

**Contexto**. **Hallazgo de esta fase, verificado contra la especificación real** (`a2a-protocol.org/v1.0.0/specification/`, consultada en esta sesión): el enum `TaskState` incluye **`TASK_STATE_UNSPECIFIED`** además de los ocho que `exploration.md`, `proposal.md` y los dos specs nuevos enumeran. Es el valor cero de un enum proto3 — el que aparece cuando el campo viene **ausente o vacío**.

**Decisión**:

1. **El registro de estados **conocidos** del núcleo sigue teniendo los OCHO** de la spec — `TASK_STATE_UNSPECIFIED` **no** entra, y por lo tanto cae por la regla ya escrita: *"un `status.state` que no es ninguno de los `TASK_STATE_*` conocidos ⇒ `reason = "protocolo"`"*. Ningún requirement se contradice y ningún camino nuevo aparece.
2. **Por qué NO se lo trata como un noveno estado no-terminal**: `TASK_STATE_UNSPECIFIED` no significa *"la tarea está en un estado intermedio"*, significa *"el peer no dijo en qué estado está"* — hacer polling sobre eso sería esperar información que el protocolo declara ausente. Fallar como `protocolo` con el valor crudo en el mensaje es diagnóstico inmediato.
3. **El test exhaustivo se escribe sobre los ocho conocidos + `TASK_STATE_UNSPECIFIED` + un string inventado**, y los dos últimos comparten el mismo veredicto (`protocolo`). Así el test documenta el hallazgo en vez de esconderlo.
4. **Se corrige el texto, no la decisión**: `sdd-tasks` incluye una tarea de documentación que anota esto en `docs/progreso/v2.2-a2a-cliente/`, junto a la corrección al Plan sobre nombres de método y de estado que el ADR 71 pto 4 ya obliga.

---

## 4. Flujos completos

### 4.1 Delegación externa, camino completo — el mecanismo del ADR 74 (SÍNCRONO)

```
caso de uso del arnés  ── elige la CLAVE, en código ──▶  resolverDestinoA2A("riesgo-credito")
                                                          └─ clave fuera del registro ⇒ DestinoA2ADesconocidoError
                                                             (antes de tocar la base, molde de SubagenteDesconocidoError)
   await despacharDelegacionA2A({ casoId, destino, insumo }, deps)
      │
      ├─ baseUrl = cliente.baseUrlDe(destino.clave)        ← SÍNCRONA, cero I/O (ADR 80 pto 2)
      │     └─ undefined ⇒ logEvent("a2a-destino-no-configurado") +
      │                    throw DelegacionA2ANoCompletadaError("transporte")   ← SIN fila huérfana
      │
      ├─ tarea = construirTareaDelegadaA2A(destino.clave, insumo)   ← tope 8_000 (TAREA_DELEGADA_MAX_CHARS)
      │
      ├─ store.crearDelegacionA2A({ id, casoId, destinoClave, agenteExternoUrl: baseUrl,
      │                             tareaDelegada: tarea, estado: TASK_STATE_SUBMITTED, createdAt })
      │     └─ ANTES de invocar. a2a_task_id NULL, resultado NULL. PROPAGA si falla (ADR 80 pto 4)
      │        logEvent("a2a-delegacion-iniciada", { delegacionId, destinoClave, tareaChars })
      │
      ├─ r = await cliente.delegar({ clave, tarea, casoId })        ← EL PUERTO. Nunca rechaza (ADR 77)
      │     │
      │     │  ══════════════ src/adapters/a2a/client.ts ══════════════
      │     ├─ GET  <base>/.well-known/agent-card.json        signal: timeout(requestTimeoutMs)
      │     │     ├─ red / timeout / !ok            ⇒ { ok:false, reason:"transporte" }
      │     │     ├─ JSON inválido                  ⇒ { ok:false, reason:"protocolo" }
      │     │     └─ sin `url` o sin transporte JSON-RPC declarado ⇒ { ok:false, reason:"protocolo" }
      │     │        → endpoint = card.url ; agenteNombre = card.name        (SIN caché, ADR 72 pto 5)
      │     │
      │     ├─ POST endpoint  {"jsonrpc":"2.0","id":1,"method":"SendMessage",
      │     │                  "params":{"message":{"messageId":…,"role":"ROLE_USER",
      │     │                                       "parts":[{"text": tarea}]}}}
      │     │     ├─ sobre con `error`              ⇒ protocolo
      │     │     ├─ sin result.task.id             ⇒ protocolo
      │     │     └─ estado = result.task.status.state   (validado contra los OCHO conocidos, ADR 84)
      │     │
      │     ├─ deadline = ahoraMs() + taskTimeoutMs                          ← reloj de pared (ADR 81)
      │     └─ loop:
      │           esEstadoTerminal(estado)?  ──sí──▶ salir
      │           ahoraMs() >= deadline?     ──sí──▶ POST CancelTask {"params":{"id":taskId}}  best-effort
      │                                              (éxito o fallo NO cambian el desenlace)
      │                                              ⇒ { ok:false, reason:"timeout", estado: último conocido }
      │           await dormir(pollIntervalMs)
      │           POST {"method":"GetTask","params":{"id":taskId}}
      │              ├─ transporte  ⇒ logEvent("a2a-poll-fallido") y SEGUIR (ADR 81 pto 3)
      │              ├─ error JSON-RPC / estado desconocido ⇒ { ok:false, reason:"protocolo" }
      │              └─ estado = nuevo status.state
      │
      ├─ r.ok === true  (TASK_STATE_COMPLETED)
      │     └─ store.actualizarDelegacionA2A({ estado, a2aTaskId, resultado, agenteExternoUrl: endpoint, updatedAt })
      │        logEvent("a2a-delegacion-completada", { a2aTaskId, agenteNombre, resultadoChars })
      │        return DelegacionA2AAplicada { delegacionId, destinoClave, a2aTaskId, tareaDelegada, resultado }
      │
      └─ r.ok === false
            └─ store.actualizarDelegacionA2A({ estado: ÚLTIMO CONOCIDO, a2aTaskId?, agenteExternoUrl?, updatedAt })
               logEvent("a2a-delegacion-fallida", { reason, estado })
               throw DelegacionA2ANoCompletadaError(reason)     ← propaga TAL CUAL (contrato de despacharCadena)

   ══════ lo que DESAPARECE de dispatch-delegation.ts ══════
   - class DelegacionA2ANoImplementadaError            (líneas 51-64)     ADR 45 pto 2, deuda saldada
   - if (destino.kind === "a2a") { throw ... }          (líneas 216-218)
   - `endpoint: string` de la rama a2a de DestinoDelegacion (línea 49)    ADR 78 / R8
   - el test de hito-2.0 que assertea ese throw                           ADR 45 pto 3, "BORRAR en Hito 6"
```

### 4.2 Camino de ventas — el enganche NO BLOQUEANTE del ADR 76

```
POST /ventas  (web/server.ts, autenticado por ventasApiToken)
   │
   await onAltaVenta(payload)  ──▶ registrarVenta(input, deps)
   │                                  │
   │                                  1. token, expiresAt, casoId, ventaId
   │                                  2. store.crearVentaConCaso(...)   ← UNA transacción. PROPAGA si falla
   │                                     logEvent("venta-creada")
   │                                  ┌─────────────────────────────────────────────────────────────┐
   │                                  │ 2b. NUEVO (ADR 76). Sólo si:                                │
   │                                  │     riesgoCredito !== undefined   (⇐ HARNESS_A2A_SALIENTE=on)│
   │                                  │     && input.monto >= config.ventaGrandeUmbral   (>=, ADR 83)│
   │                                  │                                                             │
   │                                  │   logEvent("a2a-riesgo-credito-disparada", {ventaId, monto, umbral})
   │                                  │   void riesgoCredito.consultar({ casoId, ventaId, clienteId,│
   │                                  │            planAnterior?, planNuevo, monto })                │
   │                                  │        .catch(() => logEvent("a2a-riesgo-credito-contrato-violado"))
   │                                  │                                                             │
   │                                  │   ▲ SIN await. Molde literal de main.ts:412-418.            │
   │                                  │   ▲ NUNCA `clienteEmail` en el insumo (no se persiste — ADR 18 pto 4,
   │                                  │     y `tarea_delegada` SÍ se persiste)                       │
   │                                  └─────────────────────────────────────────────────────────────┘
   │                                  3. link = `${baseUrlPublica}/confirmar/${token}`
   │                                  4. await notifier.notificarLinkConfirmacion(...)  ← nunca rechaza
   │                                  5. return { ventaId, casoId, linkConfirmacion, notificado }
   │
   respondJson(res, 201, …)   ← se responde YA. La consulta de riesgo sigue viva en background.
                                 El vendedor NO espera 2 minutos (R3, cerrado).

   … mientras tanto, en el mismo proceso, sin nadie esperando:
        consultar(...) → despacharDelegacionA2A(...)  [§4.1 completo, síncrono para QUIEN LO LLAMA]
              ok    ⇒ fila COMPLETED con resultado. Evidencia lista para `docs/progreso/`.
              falla ⇒ fila con último estado + logEvent("a2a-delegacion-fallida").
                      La venta NO se cancela, NO se bloquea, NO cambia de estado. (ADR 76 pto 4)
```

**Lo que este camino NO toca, y se verifica leyendo el diff**: `confirmar-venta.ts` (sincronía declarada como invariante), `resolverDecisionVenta`, `procesar-devolucion`, el catálogo de `ventas.estado`, y el cálculo de comisión.

---

## 5. Núcleo — módulos y firmas

### 5.1 `src/core/agents/a2a-contract.ts` (nuevo) — **sin imports**

```ts
/* Contrato del Cliente A2A (ADR 71 pto 5, 72, 73 pto 2, 75 pto 1, y ADR 77/84
 * de este diseño). SIN imports: ni SDK, ni Node, ni otro módulo del núcleo —
 * mismo criterio que `knowledge-contract.ts`, `hitl-contract.ts` y
 * `worktree-contract.ts`. */

/* ── Vocabulario del protocolo, CRUDO (ADR 71 pto 5) ────────────────────── */
export const TASK_STATE_SUBMITTED = "TASK_STATE_SUBMITTED";
export const TASK_STATE_WORKING = "TASK_STATE_WORKING";
export const TASK_STATE_COMPLETED = "TASK_STATE_COMPLETED";
export const TASK_STATE_FAILED = "TASK_STATE_FAILED";
export const TASK_STATE_CANCELED = "TASK_STATE_CANCELED";
export const TASK_STATE_REJECTED = "TASK_STATE_REJECTED";
export const TASK_STATE_INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
export const TASK_STATE_AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED";

/**
 * Los OCHO estados que este arnés reconoce. `TASK_STATE_UNSPECIFIED` — que la
 * especificación v1.0.0 SÍ define, verificado en esta fase — queda AFUERA a
 * propósito (ADR 84): no es un estado intermedio, es "el peer no dijo en qué
 * estado está", y cae por la regla de estado desconocido ⇒ `protocolo`.
 */
export const TASK_STATES_CONOCIDOS = [
  TASK_STATE_SUBMITTED, TASK_STATE_WORKING, TASK_STATE_COMPLETED, TASK_STATE_FAILED,
  TASK_STATE_CANCELED, TASK_STATE_REJECTED, TASK_STATE_INPUT_REQUIRED, TASK_STATE_AUTH_REQUIRED,
] as const;

export type TaskState = (typeof TASK_STATES_CONOCIDOS)[number];

/** PURA. Narrowing de un `string` crudo del protocolo al vocabulario conocido. */
export function esTaskStateConocido(valor: string): valor is TaskState;

/**
 * PURA. `COMPLETED` / `FAILED` / `CANCELED` / `REJECTED` son terminales;
 * `SUBMITTED` / `WORKING` no lo son; `INPUT_REQUIRED` / `AUTH_REQUIRED` son
 * terminales DE FRACASO (ADR 73 pto 2): esperan una interacción que este hito
 * no construye, y hacer polling sobre ellos sería esperar algo que no llega.
 * Test exhaustivo sobre los ocho (§10.A).
 */
export function esEstadoTerminal(estado: TaskState): boolean;

/* ── Desenlaces (ADR 74 pto 5) ──────────────────────────────────────────── */
export type MotivoDelegacionA2ANoCompletada =
  | "failed" | "canceled" | "rejected" | "input-required" | "auth-required"
  | "timeout" | "transporte" | "protocolo";

/**
 * PURA y TOTAL. Estado terminal de fracaso → su `reason`. `TASK_STATE_COMPLETED`
 * NO es entrada válida (es el único éxito) y `SUBMITTED`/`WORKING` tampoco
 * (no son terminales) — el tipo lo impide, no un `if`.
 */
export function motivoDeEstadoTerminal(
  estado: Exclude<TaskState, "TASK_STATE_COMPLETED" | "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING">,
): MotivoDelegacionA2ANoCompletada;

/* ── Registro ESTÁTICO de destinos externos (ADR 72 pto 1) ──────────────── */
export const DESTINO_A2A_RIESGO_CREDITO = "riesgo-credito";
export const DESTINO_A2A_KPI_INCIDENTE = "kpi-incidente";

/** Las DOS claves, y no hay una tercera. Mismo espíritu que `SUBAGENT_REGISTRY`, para destinos EXTERNOS. */
export const DESTINOS_A2A = [DESTINO_A2A_RIESGO_CREDITO, DESTINO_A2A_KPI_INCIDENTE] as const;
export type DestinoA2AClave = (typeof DESTINOS_A2A)[number];

/** `clave` fuera del registro cerrado — molde exacto de `SubagenteDesconocidoError`. */
export class DestinoA2ADesconocidoError extends Error {
  constructor(clave: string);
}

/* ── El puerto (ADR 75 pto 1, ADR 77) ───────────────────────────────────── */
export interface ResultadoA2AOk {
  readonly ok: true;
  readonly a2aTaskId: string;
  readonly estado: "TASK_STATE_COMPLETED";
  readonly resultado: string;
  /** `name` del Agent Card — evidencia del desenlace, NO parte de la tarea (ADR 79 pto 2). */
  readonly agenteNombre: string;
  /** Endpoint JSON-RPC EFECTIVO, el que el card declaró (ADR 80 pto 1). */
  readonly endpoint: string;
}

export interface ResultadoA2AFallo {
  readonly ok: false;
  readonly reason: MotivoDelegacionA2ANoCompletada;
  /** Último estado conocido; ausente si nunca hubo un `SendMessage` exitoso. */
  readonly estado?: TaskState;
  readonly a2aTaskId?: string;
  readonly endpoint?: string;
  /** Diagnóstico ya truncado a 500 chars por el adaptador. NUNCA una credencial. */
  readonly detalle?: string;
}

export type ResultadoA2A = ResultadoA2AOk | ResultadoA2AFallo;

/**
 * Puerto que el núcleo posee sobre el Cliente A2A. Molde de `InvocarSubagente`
 * (`subagents.ts:112-120`): declarado acá, implementado en
 * `src/adapters/a2a/`, cerrado por el composition root. Todo test de núcleo lo
 * satisface con un doble puro — NINGUNO abre un socket.
 *
 * `delegar` NUNCA rechaza (ADR 77): el desenlace viaja en `ResultadoA2A` y el
 * error tipado lo construye el núcleo DESPUÉS de persistir la fila.
 *
 * `baseUrlDe` es SÍNCRONA y sin I/O: es una lectura del registro ya resuelto,
 * y existe para que `despacharDelegacionA2A` pueda fallar tipado ANTES de
 * crear una fila huérfana (ADR 80 pto 2).
 *
 * NINGUNA de las dos firmas acepta una URL: sólo una `DestinoA2AClave` del
 * conjunto cerrado (R8, requirement verificable por inspección de firmas).
 */
export interface ClienteA2APort {
  baseUrlDe(clave: DestinoA2AClave): string | undefined;
  delegar(input: {
    readonly clave: DestinoA2AClave;
    readonly tarea: string;
    readonly casoId: string;
  }): Promise<ResultadoA2A>;
}

/**
 * La delegación externa no llegó a `TASK_STATE_COMPLETED`. PROPAGA tal cual —
 * mismo contrato que `despacharCadena` ("NO captura: si un eslabón falla, el
 * error propaga tal cual"). Se lanza SIEMPRE después de que la fila quedó con
 * su último estado conocido (ADR 77 pto 3).
 */
export class DelegacionA2ANoCompletadaError extends Error {
  readonly reason: MotivoDelegacionA2ANoCompletada;
  readonly destinoClave: DestinoA2AClave;
  readonly estado?: TaskState;
  readonly delegacionId?: string;
  constructor(input: {
    readonly reason: MotivoDelegacionA2ANoCompletada;
    readonly destinoClave: DestinoA2AClave;
    readonly estado?: TaskState;
    readonly delegacionId?: string;
    readonly detalle?: string;
  });
}
```

### 5.2 `src/core/turn-selector/dispatch-delegation-a2a.ts` (nuevo) — la función **hermana** (ADR 74 pto 3)

```ts
import { TAREA_DELEGADA_MAX_CHARS, truncarTareaDelegada, type InsumoDelegado } from "../agents/subagents.js";
import { /* … el contrato de §5.1 … */ } from "../agents/a2a-contract.js";
import type { DestinoDelegacion } from "./dispatch-delegation.js";

/** El brazo externo de la unión, con nombre propio (ADR 78 pto 3). */
export type DestinoA2A = Extract<DestinoDelegacion, { kind: "a2a" }>;

/**
 * PURA y SÍNCRONA. Hermana de `resolverDestino`: valida una clave cruda contra
 * el registro CERRADO y lanza `DestinoA2ADesconocidoError` sin tocar la base.
 * No acepta ni produce URLs.
 */
export function resolverDestinoA2A(clave: string): DestinoA2A;

/**
 * PURA. Reusa `TAREA_DELEGADA_MAX_CHARS` (8_000) TAL CUAL vía
 * `truncarTareaDelegada` — el mismo tope que `delegaciones.tarea_delegada`, no
 * una copia (ADR 79 pto 3). NO recibe una `AgentDefinition`: un agente externo
 * no tiene entrada en `SUBAGENT_REGISTRY` (R2). El encabezado es la CLAVE, no
 * el nombre del Agent Card, porque la fila se crea ANTES de conocerlo
 * (ADR 79 pto 1).
 *
 * Texto generado, en este orden:
 *   1. `Destino externo: <clave>`
 *   2. `Instrucción: <insumo.instruccion>`
 *   3. (línea en blanco) + `insumo.material`
 */
export function construirTareaDelegadaA2A(clave: DestinoA2AClave, insumo: InsumoDelegado): string;

/**
 * Puerto sobre `delegaciones_a2a`. DOS métodos, no tres, y NINGUNO
 * transaccional (ADR 80 pto 3): a diferencia de `DelegacionStorePort`, acá no
 * hay fila de `sesiones_agente` que insertar en el mismo acto — un agente
 * externo no produce sesión del SDK.
 *
 * Los dos PROPAGAN si fallan (ADR 80 pto 4): sin fila no hay trazabilidad.
 */
export interface DelegacionA2AStorePort {
  crearDelegacionA2A(input: {
    readonly id: string;
    readonly casoId: string;
    readonly destinoClave: DestinoA2AClave;
    /** URL BASE configurada. Se sobrescribe con el endpoint efectivo al completar (ADR 80 pto 1). */
    readonly agenteExternoUrl: string;
    readonly tareaDelegada: string;
    readonly estado: TaskState;          // siempre TASK_STATE_SUBMITTED en este punto
    readonly createdAt: string;
  }): void;
  actualizarDelegacionA2A(input: {
    readonly delegacionId: string;
    readonly estado: TaskState;
    readonly a2aTaskId?: string;
    readonly resultado?: string;
    readonly agenteExternoUrl?: string;
    readonly updatedAt: string;
  }): void;
}

export interface DespacharDelegacionA2ADeps {
  readonly store: DelegacionA2AStorePort;
  readonly cliente: ClienteA2APort;
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * Resultado de UNA delegación externa despachada de punta a punta. NO es
 * `DelegacionAplicada` y no puede serlo (R2, ADR 74 pto 3): no hay
 * `sesionSubagenteId` porque no hay sesión del SDK, y `agentId` no significa
 * nada para un agente que no está en `SUBAGENT_REGISTRY`.
 */
export interface DelegacionA2AAplicada {
  readonly delegacionId: string;
  readonly destinoClave: DestinoA2AClave;
  readonly a2aTaskId: string;
  readonly agenteNombre: string;
  readonly tareaDelegada: string;
  readonly resultado: string;
}

/**
 * UNA delegación EXTERNA, de punta a punta (§4.1):
 *  a. `cliente.baseUrlDe(destino.clave)` — sin destino NO se crea fila.
 *  b. `construirTareaDelegadaA2A(destino.clave, insumo)`.
 *  c. `store.crearDelegacionA2A(...)` — ANTES de invocar, estado SUBMITTED.
 *  d. `await cliente.delegar(...)` — nunca rechaza; el `try/catch` es red de seguridad (ADR 77 pto 4).
 *  e. `store.actualizarDelegacionA2A(...)` — SIEMPRE, con el último estado conocido.
 *  f. éxito ⇒ `DelegacionA2AAplicada`; cualquier otro desenlace ⇒ `throw`.
 *
 * SÍNCRONO POR TURNO (ADR 74): se resuelve dentro del mismo `await` que la
 * invoca. No existe estado `pendiente_a2a`, ni cola, ni scheduler, ni
 * reanudación. Quien no quiera esperar, no la awaitea — es exactamente lo que
 * hace el enganche de ventas (ADR 76), y esa decisión es del LLAMADOR, no de
 * esta función.
 *
 * NO importa `src/adapters/a2a/` (requirement del spec, verificable por
 * inspección de imports).
 */
export async function despacharDelegacionA2A(
  input: {
    readonly casoId: string;
    readonly destino: DestinoA2A;
    readonly insumo: InsumoDelegado;
  },
  deps: DespacharDelegacionA2ADeps,
): Promise<DelegacionA2AAplicada>;
```

### 5.3 `src/core/turn-selector/dispatch-delegation.ts` (modificado) — sólo **borrados** y un angostamiento

```ts
// ── BORRADO: class DelegacionA2ANoImplementadaError (líneas 51-64) ──
// ── BORRADO: if (destino.kind === "a2a") { throw ... } (líneas 216-218) ──

/** ANTES: | { kind: "a2a"; agentId: string; endpoint: string }   ← URL en un tipo público (R8) */
export type DestinoDelegacion =
  | { readonly kind: "in-process"; readonly agentId: string }
  | { readonly kind: "a2a"; readonly clave: DestinoA2AClave };     // ← ADR 78 pto 1

export async function despacharDelegacion(
  input: {
    readonly casoId: string;
    readonly agentId: string;
    readonly insumo: InsumoDelegado;
    readonly sesionPadreId?: string;
    /** ANGOSTADO (ADR 78 pto 2): pasar un destino `a2a` acá es un ERROR DE COMPILACIÓN. */
    readonly destino?: Extract<DestinoDelegacion, { kind: "in-process" }>;
  },
  deps: DespacharDelegacionDeps,
): Promise<DelegacionAplicada>;
```

`despacharCadena`, `resolverDestino`, `DelegacionStorePort`, `DespacharDelegacionDeps`, `DelegacionAplicada` y `Eslabon` **no cambian ni una línea de cuerpo**. Sí cambian **tres doc-comments** (líneas 15-24, 41-46 y 192-199), que hoy prometen la deuda que este change salda.

**`dispatch-delegation.test.ts` (modificado)**: se borra el test que assertea `DelegacionA2ANoImplementadaError` (ADR 45 pto 3 de `v2.0.0`, literal). En su lugar, un test nuevo de **una línea de intención**: `resolverDestino` sigue devolviendo `in-process` para todo id registrado. El resto de la suite queda intacta.

### 5.4 `src/core/agents/subagents.ts` (modificado) — **una palabra**

```ts
/** ANTES: `function truncarTareaDelegada(...)`. Ahora exportada (ADR 79 pto 3). */
export function truncarTareaDelegada(texto: string): string;
```

Cero cambio de comportamiento, cero call sites tocados. `TAREA_DELEGADA_MAX_CHARS` y `TAREA_TRUNCADA_SUFIJO` ya eran públicos.

### 5.5 `src/core/ventas/ventas-config.ts` (modificado)

```ts
export interface VentasConfig {
  readonly comisionPorcentaje: number;
  readonly reembolsoUmbral: number;
  readonly tokenTtlHoras: number;
  /** Validado `> 0`. `monto >= umbral` ⇒ venta grande ⇒ consulta de riesgo/crédito (ADR 83). */
  readonly ventaGrandeUmbral: number;
}

/** Holgadamente por encima de `DEFAULT_REEMBOLSO_UMBRAL` (500): si toda venta escalable fuera
 *  además "grande", el umbral no seleccionaría nada. Número OPERATIVO (§15 pto 3). */
export const DEFAULT_VENTA_GRANDE_UMBRAL = 5_000;

// dentro de resolveVentasConfig, junto a los otros tres:
const ventaGrandeUmbral = resolveNumeroValidado(
  "VENTA_GRANDE_UMBRAL", env.VENTA_GRANDE_UMBRAL, DEFAULT_VENTA_GRANDE_UMBRAL,
  (parsed) => parsed > 0, "un número finito mayor a 0", errores,
);
```

Se actualiza la tabla del doc-comment de `resolveVentasConfig` con la cuarta fila. **Ninguna** de las tres existentes cambia.

### 5.6 `src/core/ventas/ventas-contract.ts` y `registrar-venta.ts` (modificados)

```ts
/* ventas-contract.ts — el puerto, declarado en el MISMO archivo que
 * `VentaNotifierPort` para que `registrar-venta.ts` no rompa su regla de
 * imports ("únicamente los otros módulos de src/core/ventas/"). */

/**
 * Consulta INFORMATIVA de riesgo/crédito para una venta grande (ADR 76).
 *
 * CONTRATO, dos mitades, las dos obligatorias:
 *  · NUNCA rechaza, NUNCA lanza — mismo criterio que `VentaNotifierPort`.
 *  · El llamador NUNCA la awaitea: se dispara con `void … .catch(…)`, molde
 *    literal de `main.ts:412-418`. Una venta no espera a un tercero.
 *
 * NO recibe `clienteEmail`: ese dato no se persiste (ADR 18 pto 4) y el texto
 * de esta consulta SÍ se persiste en `delegaciones_a2a.tarea_delegada`.
 */
export interface ConsultaRiesgoCreditoPort {
  consultar(input: {
    readonly casoId: string;
    readonly ventaId: string;
    readonly clienteId: string;
    readonly planAnterior?: string;
    readonly planNuevo: string;
    readonly monto: number;
  }): Promise<void>;
}
```

```ts
/* registrar-venta.ts — un campo opcional en deps y un bloque de 6 líneas
 * entre el paso 2 y el paso 3. La secuencia documentada de 5 pasos gana un
 * "2b" en su doc-comment. */
export interface RegistrarVentaDeps {
  // … los 8 campos actuales, sin tocar …
  /** Ausente ⇒ `HARNESS_A2A_SALIENTE` apagado ⇒ comportamiento IDÉNTICO a v2.1.0 (ADR 82 pto 3). */
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
}

// … después de logEvent(venta.casoId, "venta-creada", …) y ANTES del link/notifier:
if (riesgoCredito !== undefined && input.monto >= config.ventaGrandeUmbral) {
  logEvent(venta.casoId, "a2a-riesgo-credito-disparada", {
    ventaId: venta.id, monto: input.monto, umbral: config.ventaGrandeUmbral,
  });
  void riesgoCredito
    .consultar({
      casoId: venta.casoId, ventaId: venta.id, clienteId: input.clienteId,
      ...(input.planAnterior !== undefined ? { planAnterior: input.planAnterior } : {}),
      planNuevo: input.planNuevo, monto: input.monto,
    })
    .catch(() => logEvent(venta.casoId, "a2a-riesgo-credito-contrato-violado", { ventaId: venta.id }));
}
```

**El `.catch()` no recibe el mensaje del error a propósito**: `src/core/` no puede importar de Node ni tiene un `toErrorMessage` propio, y agregar uno para una rama que el contrato declara imposible sería inventar infraestructura. El evento dice **que** el contrato se violó y **cuál** venta; el diagnóstico fino vive del lado del adaptador, que sí tiene el error.

### 5.7 `/consultar-kpi` — el productor real de `"kpi-incidente"` (**ADR 85**, enmienda posterior)

> **Estado de verificación**: todas las firmas y números de línea de esta sección se re-confirmaron contra el código real en la sesión de esta enmienda — `src/core/commands/comando-empleado.ts` completo (415 líneas) y `src/build-on-comando-empleado.ts` completo (1313 líneas), no de memoria. Las tres tensiones que la verificación encontró están en §5.7.4.

#### 5.7.1 `src/core/commands/comando-empleado.ts` (modificado) — un descriptor, un brazo de unión, una rama de parseo

**Descriptor nuevo, mismo formato de tabla que `hito-2.1` usó para los suyos** (`DESCRIPTORES`, `as const satisfies readonly DescriptorInterno[]`). Va **ANTES de `/ayuda`**, que sigue último — regla textual del doc-comment del array (líneas 92-97): *"Cada tanda nueva va ANTES de `/ayuda`… los descriptores existentes no cambian de orden ni de forma"*.

| Campo | Valor | Por qué |
|---|---|---|
| `nombre` | `"/consultar-kpi"` | — |
| `uso` | `"/consultar-kpi <consulta>"` | Argumento **obligatorio**: `<>`, no `[]` — mismo criterio que `/soporte <consulta>` |
| `ayuda` | `"Consulta al agente externo de KPIs/incidentes y espera su respuesta."` | Una línea, en el idioma del resto |
| `privilegiado` | **`true`** | **No es una decisión nueva**: mismo criterio ya escrito para `/ver-propuesta` (líneas 193-198). Manda contexto de la empresa a un tercero externo. Marcarlo acá **ES** la implementación — `esComandoPrivilegiado` es la única fuente de verdad del guard (líneas 238-248), y el guard del preámbulo (paso 6, línea 1276) no se toca |
| `secreto` | `false` | `secreto: true` es exclusivo de `/login` |
| `forma` | `"id_mas_resto"` | **Ninguna `Forma` nueva** — el tipo `Forma` (línea 84) queda intacto |
| `tipo` | `"consultar_kpi"` | Literal nuevo del brazo de unión de abajo |

```ts
/** Brazo NUEVO de `ComandoEmpleado` (ADR 85). Molde exacto de `soporte`: un
 *  solo campo, el resto entero de la línea, obligatorio. */
| { readonly tipo: "consultar_kpi"; readonly consulta: string }
```

**La rama de parseo — y su ubicación, que NO es libre.** Se agrega una rama propia calcada de la de `/soporte` (líneas 356-361):

```ts
if (descriptor.nombre === "/consultar-kpi") {
  if (restoLinea === undefined) {
    return ayudaArgumentos(comandoToken);
  }
  return { tipo: "consultar_kpi", consulta: restoLinea };
}
```

**★ Va OBLIGATORIAMENTE antes del bloque final de `/devolucion` (líneas 408-413).** Verificado leyendo el archivo: la sección `id_mas_resto` es una cadena de `if (descriptor.nombre === …)` cuyo **fallthrough final es `/devolucion`**, sin un `if` propio. Un descriptor `id_mas_resto` nuevo **sin** su rama explícita no falla en compilación: se parsea silenciosamente como `{ tipo: "devolucion", token: <primera palabra> }`. Es exactamente la clase de bug que un test de parseo atrapa y una lectura rápida no — por eso está escrito acá y tiene escenario propio en el spec.

**Tres doc-comments cambian de número**, en el mismo commit: líneas 21 (*"los CATORCE comandos"*), 93 y 233 (*"Los catorce descriptores (ocho de v1.4.0 + tres de Hito 5 + tres de Hito 5.1)"*) pasan a **QUINCE** y ganan *"+ uno de Hito 6 (ADR 85)"*. Un doc-comment que cuenta mal es peor que no tenerlo — mismo criterio del ADR 78 pto 5.

#### 5.7.2 `src/core/commands/registro-acciones-contract.ts` (modificado) — **una constante**

```ts
export const COMANDO_CONSULTAR_KPI = "/consultar-kpi";
```

**Cero vocabulario de `resultado` nuevo**: se reusan `RESULTADO_ATENDIDA` (éxito) y `RESULTADO_FALLIDA` (cualquier fracaso), que ya existen y ya están comentados como *"`/soporte`"* — el mismo par que el comando más parecido a éste. **Cero migración**: `registro_acciones_empleado.comando` es `TEXT NOT NULL` **sin `CHECK`** (verificado, `migrations/0005_registro_acciones_empleado.ts:45-53`), y `caso_id TEXT REFERENCES casos(id)` ya existe.

#### 5.7.3 `src/build-on-comando-empleado.ts` (modificado) — el handler

```ts
/* ── deps: UNA costura nueva, molde de `aplicarPatch`/`propuestaStore` ── */
export interface BuildOnComandoEmpleadoDeps {
  // … los 14 campos actuales, sin tocar …
  /**
   * ADR 85 + ADR 82. Ausente ⇒ A2A saliente APAGADO ⇒ `/consultar-kpi`
   * responde que está desactivado, sin crear caso, sin fila y sin `fetch`.
   * Lo cablea `main.ts` (§7.3) — este módulo NO lee `HARNESS_A2A_SALIENTE`
   * por su cuenta: el interruptor se consulta UNA vez, en el composition
   * root, y de ahí salen los DOS consumidores (ventas y TUI).
   */
  readonly clienteA2A?: ClienteA2APort;
  /** Costura de test — default: `createDelegacionA2AStore(db)` (`build-on-venta.ts`, §7.3). */
  readonly delegacionA2AStore?: DelegacionA2AStorePort;
}

/** Tipo de `casos.tipo` para este comando. Const de MÓDULO, no de `ventas-contract.ts`:
 *  mismo precedente que `CASO_TIPO_SOLICITUD_INTERNA` (`crear-solicitud-interna.ts:56`),
 *  que tampoco vive en el contrato compartido. */
const CASO_TIPO_CONSULTA_KPI = "consulta_kpi";

/** Idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`/`build-on-soporte.ts:48`.
 *  Duplicado a propósito, con el mismo doc-comment que ese archivo ya lleva. */
const CASO_ESTADO_ACTIVO = "activo";

/**
 * PURA, de módulo — mismo lugar y mismo molde que `formatearLineaEscalacion` /
 * `formatearListado` / `formatearResumenPropuesta`. TOTAL sobre los ocho
 * motivos: el `switch` es exhaustivo sobre `MotivoDelegacionA2ANoCompletada`,
 * así que un motivo nuevo del vocabulario sería un error de COMPILACIÓN, no un
 * mensaje genérico. Requirement literal del spec: dos motivos distintos nunca
 * comparten mensaje. NUNCA incluye el `detalle` crudo del adaptador — ese ya
 * viene truncado a 500 chars pero puede llevar cuerpo de respuesta ajeno.
 */
function mensajeDeMotivoA2A(reason: MotivoDelegacionA2ANoCompletada): string;
```

```ts
/**
 * `/consultar-kpi <consulta>` (Hito 6, ADR 85). UN SOLO PASO — NUNCA lee ni
 * escribe `confirmacionPendiente`, igual que `manejarVerPropuesta` y
 * `/solicitar`. `privilegiado: true` ya lo garantizó la guarda del preámbulo
 * (paso 6): no se duplica acá.
 *
 * PRIMER llamador de producción del camino SÍNCRONO del ADR 74: awaitea
 * `despacharDelegacionA2A` y devuelve su `resultado` como texto del turno.
 *
 * Secuencia:
 *  a. `clienteA2A === undefined` ⇒ mensaje de "desactivado". SIN caso, SIN fila.
 *  b. `caso` NUEVO por invocación: `createCaso(db, { id: newId(), tipo:
 *     CASO_TIPO_CONSULTA_KPI, estado: CASO_ESTADO_ACTIVO, … })`. Obligatorio,
 *     no cosmético: `delegaciones_a2a.caso_id` es NOT NULL REFERENCES casos(id).
 *     PROPAGA si falla — sin caso no hay nada que correlacionar (molde literal
 *     de `buildOnSoporte`, paso 1).
 *  c. `await despacharDelegacionA2A({ casoId, destino: resolverDestinoA2A(
 *     DESTINO_A2A_KPI_INCIDENTE), insumo }, { store, cliente: clienteA2A,
 *     newId, now, logEvent })`.
 *  d. éxito ⇒ `registrar({ comando: COMANDO_CONSULTAR_KPI, casoId,
 *     resultado: RESULTADO_ATENDIDA }, ahora)` y se devuelve el texto.
 *  e. `catch` EXPLÍCITO — es la diferencia con el resto del repo y es
 *     deliberada: acá SÍ hay un `throw` tipado ESPERADO (ADR 74 pto 6:
 *     `despacharDelegacionA2A` propaga, y sigue propagando). El borde de la
 *     TUI es donde el repo ya atrapa (ADR 40, `manejarSoporte:705-711`:
 *     "la TUI no puede quedarse sin respuesta"). `DelegacionA2ANoCompletadaError`
 *     ⇒ `mensajeDeMotivoA2A(error.reason)`; cualquier otro throw ⇒ el molde
 *     `toErrorMessage` que este archivo ya usa. En los dos casos se registra
 *     `RESULTADO_FALLIDA` y se emite un evento.
 *
 * `agentLabel: "sistema"` — el texto viene de un tercero, no de un subagente
 * del arnés, y `agentLabel` nombra agentes de ESTE proceso.
 */
async function manejarConsultarKpi(
  comando: Extract<ComandoEmpleado, { tipo: "consultar_kpi" }>,
  ahora: string,
): Promise<TuiTurnResult>;
```

**El insumo, fijo en código** (ADR 85 pto 6) — mismo criterio que `createConsultaRiesgoCredito` (§7.3):

```ts
const insumo: InsumoDelegado = {
  instruccion: "Consultá al agente externo de KPIs/incidentes y devolvé su respuesta tal cual.",
  material: comando.consulta,
};
```

**Un `case` nuevo en el `switch` del ruteo** (línea 1282), entre `"ver_propuesta"` y `"aplicar_propuesta"`, en el orden en que el descriptor aparece: `case "consultar_kpi": return manejarConsultarKpi(comando, ahora);`. El `switch` **vuelve a ser exhaustivo** — mismo patrón de cierre de `TS2322` que las tareas 23 y 32 de los hitos anteriores documentan.

#### 5.7.4 Tensiones reales encontradas al verificar contra el código

| # | Tensión | Resolución |
|---|---|---|
| 1 | **`build-on-comando-empleado.ts` no recibe hoy nada de A2A**, y el ADR 82 exige que el interruptor gobierne el cableado. La salida fácil sería leer `isA2ASalienteEnabled()` dentro de este módulo — como ya hace con `resolveGitConfig()` para `aplicarPatch` (líneas 596-602) | **Rechazada esa salida.** El interruptor se lee **UNA sola vez, en `main.ts`**, que hoistea `clienteA2A` y lo pasa a los dos consumidores (§7.3 enmendado). El precedente de `aplicarPatch` no aplica: `git` **no tiene interruptor**, A2A sí, y duplicar su lectura pondría el rollback a `v2.1.0` en dos lugares. **No cambia el ADR 82** — lo aplica literalmente (*"el composition root SHALL NOT cablear ningún adaptador A2A"*) |
| 2 | **`build-on-comando-empleado.ts` importa de `src/adapters/*`** (`repository.ts`, `adapters/git/index.js`, `adapters/git/config.js`) — ¿rompe la regla de `AGENTS.md`? | **No.** El archivo vive en `src/`, **no** en `src/core/` ni dentro de un adaptador, precisamente porque es composición: su propio doc-comment de cabecera (líneas 1-12) lo declara. La regla no negociable es que **`src/core/` nunca importa de `src/adapters/*`** — y `dispatch-delegation-a2a.ts` (§5.2) la sigue cumpliendo, con su assert sobre imports en el test. Este handler consume el **puerto**, inyectado |
| 3 | **La cadena `id_mas_resto` de `parsearComando` tiene fallthrough a `/devolucion`** (§5.7.1): un descriptor nuevo sin rama propia se parsea en silencio como una devolución | Rama explícita **antes** del bloque final, y escenario de spec dedicado (*"la consulta es el resto entero de la línea"*). Es la tensión de mayor riesgo real de esta enmienda, porque **compila igual** |

---

## 6. Adaptadores — `src/adapters/a2a/` (3 archivos)

**Duplicación deliberada, 7ª y 8ª instancia**: `FetchFn`/`FetchResponseLike`, `ERROR_BODY_MAX_CHARS = 500`, `truncate()`, `isTimeoutError()`, `resolvePositiveNumber`/`resolveNonBlankString`. **No se importan** de `board/`, `notificaciones/` ni `git/` — `AGENTS.md` prohíbe que un adaptador importe de otro, y esto es infraestructura de adaptador, no lógica de negocio. Mismo doc-comment de duplicación aceptada que `git/config.ts:49-56` ya lleva.

### 6.1 `src/adapters/a2a/config.ts` (nuevo)

```ts
import "../../core/config/env.js";                       // molde de git/config.ts:1
import { DESTINOS_A2A, type DestinoA2AClave } from "../../core/agents/a2a-contract.js";

export interface DestinoA2AConfig {
  readonly baseUrl: string;
  /** `Authorization: Bearer <token>` opcional. NUNCA aparece en un mensaje ni en un log. */
  readonly authToken?: string;
}

export interface A2AConfig {
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly taskTimeoutMs: number;
  /** Una entrada por clave del registro; `undefined` = destino NO disponible (ADR 72 pto 3). */
  readonly destinos: Readonly<Record<DestinoA2AClave, DestinoA2AConfig | undefined>>;
}

export const DEFAULT_A2A_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_A2A_POLL_INTERVAL_MS = 1_500;
export const DEFAULT_A2A_TASK_TIMEOUT_MS = 120_000;

/**
 * PURA. `("riesgo-credito", "ENDPOINT")` → `"HARNESS_A2A_ENDPOINT_RIESGO_CREDITO"`.
 * Los guiones de la clave NO son expresables en un nombre de variable de
 * entorno; esa traducción es exactamente el detalle que se rompe en silencio,
 * así que es una función con test dedicado y no un literal escrito dos veces
 * (ADR 72 pto 2).
 */
export function claveAVariableEntorno(clave: DestinoA2AClave, campo: "ENDPOINT" | "TOKEN"): string;

/**
 * PURA, recibe `env` como parámetro, NUNCA lanza — molde literal de
 * `resolveGitConfig`/`resolveWorktreeConfig`. Una clave sin
 * `HARNESS_A2A_ENDPOINT_*` NO es un error de arranque: el destino queda
 * `undefined` y sólo falla — tipado — quien intente delegar hacia él.
 */
export function resolveA2AConfig(env: NodeJS.ProcessEnv = process.env): A2AConfig;

/** `on` explícito y nada más (ADR 82 pto 1). Ausente, vacío o cualquier otro valor ⇒ `false`. */
export function isA2ASalienteEnabled(env: NodeJS.ProcessEnv = process.env): boolean;
```

### 6.2 `src/adapters/a2a/client.ts` (nuevo) — el único archivo que habla HTTP

```ts
export type FetchFn = (url: string, init: {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}) => Promise<FetchResponseLike>;

export interface FetchResponseLike { readonly ok: boolean; readonly status: number; text(): Promise<string>; }

/** Copia deliberada de `github-client.ts:27` / `email-client.ts:28`. */
const ERROR_BODY_MAX_CHARS = 500;

/** Tipos PROPIOS, ACOTADOS y CERRADOS (ADR 71 pto 6). Todo campo del protocolo
 *  que llegue y no esté acá se IGNORA sin fallar — salvo `status.state`. */
interface SobreJsonRpc { readonly jsonrpc: "2.0"; readonly id: number; readonly method: string; readonly params: unknown; }

export interface A2AClientDeps {
  readonly config: A2AConfig;
  readonly fetchFn: FetchFn;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** Inyectables para testear el loop SIN dormir de verdad (ADR 81). */
  readonly ahoraMs: () => number;
  readonly dormir: (ms: number) => Promise<void>;
  readonly newMessageId: () => string;
}

/**
 * El ciclo completo de UNA delegación externa. NUNCA rechaza (ADR 77): todo
 * desenlace vuelve como `ResultadoA2A`.
 *
 * Molde estructural literal de `githubRequest`/`enviarEmail`:
 *   · `AbortSignal.timeout(config.requestTimeoutMs)` por request individual.
 *   · `error.name === "TimeoutError"` distingue timeout de error de red.
 *   · `!response.ok` ⇒ `transporte`, con el cuerpo TRUNCADO a 500 chars.
 *   · CERO reintentos, CERO backoff.
 *   · El header `Authorization` se arma acá y NO se incluye en ningún mensaje
 *     ni evento — el mensaje de error se construye SÓLO con método, status y
 *     cuerpo truncado.
 */
export async function delegarTarea(input: {
  readonly destino: DestinoA2AConfig;
  readonly clave: DestinoA2AClave;
  readonly tarea: string;
  readonly casoId: string;
}, deps: A2AClientDeps): Promise<ResultadoA2A>;
```

**Las tres llamadas, con los nombres y las formas REALES de v1.0.0** (verificadas en esta fase contra `a2a-protocol.org/v1.0.0/specification/`, no contra el Plan, que las cita mal):

| Paso | HTTP | Cuerpo |
|---|---|---|
| Agent Card | `GET <base>/.well-known/agent-card.json` | — |
| Enviar | `POST <endpoint>` | `{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"<uuid>","role":"ROLE_USER","parts":[{"text":"<tarea>"}]}}}` |
| Consultar | `POST <endpoint>` | `{"jsonrpc":"2.0","id":N,"method":"GetTask","params":{"id":"<taskId>"}}` |
| Cancelar | `POST <endpoint>` | `{"jsonrpc":"2.0","id":N,"method":"CancelTask","params":{"id":"<taskId>"}}` |

**Verificado**: los tres nombres de método (PascalCase, **sin** prefijo `a2a/`), `params.id` de `GetTask`/`CancelTask`, `params.message` de `SendMessage`, los campos `messageId`/`role`/`parts` de `Message`, `role: "ROLE_USER"` (ProtoJSON, **no** `"user"`), el campo `text` de una parte de texto, y `Task.id` / `Task.status.state` / `Task.artifacts`.
**★ CORRECCIÓN VERIFICADA EN `sdd-apply` (tarea 4), cierra RD-24** — la suposición de arriba (`preferredTransport`/`additionalInterfaces`) era directamente incorrecta, no una cuestión de camelCase vs snake_case: verificado contra `specification/a2a.proto` normativo (mensaje `AgentCard`, tag `v1.0.0` del repo `a2aproject/A2A`, `gh api repos/a2aproject/A2A/contents/specification/a2a.proto?ref=v1.0.0`) y contra los ejemplos JSON de `docs/specification.md` de ese mismo tag (líneas 1014-1018, 2117-2120, 3028-3031). El `AgentCard` **no tiene un campo `url` de nivel superior**. El mecanismo real es:

```json
{
  "supportedInterfaces": [
    { "url": "https://agente.example.com/a2a/v1", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" },
    { "url": "https://agente.example.com/a2a/grpc", "protocolBinding": "GRPC", "protocolVersion": "1.0" }
  ]
}
```

`supportedInterfaces` es un array ORDENADO por preferencia (la spec: "the first entry is preferred"), cada entrada `AgentInterface` con `url`/`protocolBinding`/`protocolVersion` (mapeo JSON camelCase de los campos proto `protocol_binding`/`protocol_version`) y `tenant` opcional. `protocolBinding` es un string abierto; los valores oficiales son `"JSONRPC"`, `"GRPC"`, `"HTTP+JSON"` (y `"WEBSOCKET"` aparece en un ejemplo de la doc). El validador real: busca en `supportedInterfaces` la primera entrada con `protocolBinding === "JSONRPC"` y `url` no vacío; **si el array está ausente, vacío, o ninguna entrada declara `"JSONRPC"`** ⇒ `reason: "protocolo"`, sin intentar `SendMessage`. Nada que tolerar entre dos formas plausibles — sólo hay una forma real.

**Extracción del texto del resultado**: se concatenan las partes `text` de `task.artifacts[*].parts[*]`; si no hay ninguna, se cae al último `Message` de `task.status`; si tampoco, `resultado = ""` y **el desenlace sigue siendo éxito** (un agente que completó sin texto no es un fallo de protocolo). El criterio se testea con las tres formas.

### 6.3 `src/adapters/a2a/index.ts` (nuevo) — la fachada

```ts
/**
 * Molde de `notificaciones/index.ts`: el ÚNICO archivo de este adaptador que
 * el composition root importa. Cierra `config.ts`/`client.ts` sobre el
 * `ClienteA2APort` del núcleo.
 */
export function createA2AAdapter(deps: {
  readonly config?: A2AConfig;      // default: resolveA2AConfig()
  readonly fetchFn?: FetchFn;       // default: globalThis.fetch as FetchFn
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly ahoraMs?: () => number;  // default: Date.now
  readonly dormir?: (ms: number) => Promise<void>;   // default: (ms) => new Promise((r) => setTimeout(r, ms))
  readonly newMessageId?: () => string;              // default: randomUUID
}): ClienteA2APort;
```

**No hay `createNoopA2AAdapter`.** La degradación de este hito es *no cablear el adaptador* (`riesgoCredito === undefined`), no cablear uno que no hace nada — diferencia con `notificaciones/`, donde el no-op existe porque `VentaNotifierPort` **siempre** se invoca.

---

## 7. Persistencia

### 7.1 Migración `NNNN_delegaciones_a2a.ts` (nueva — ADR 74 pto 4 + regla del ADR 63)

**La regla, no el número** (precedente ADR 63, textual): *sea `M` el prefijo numérico más alto presente en `src/adapters/memory/migrations/index.ts` en `main` al momento de `sdd-apply`; esta migración es `NNNN = M + 1`, a cuatro dígitos, **agregada al final** del array `migrations`, sin editar ni reordenar ninguna entrada previa.*

**Valor de hoy, verificado**: el techo real es **`0009_propuestas_cambio`** (`migrations/index.ts`, leído completo — línea 36) **en la rama `hito/v2.1-escritura-delegada`**; en `main` el techo es `0006`. Con el gate de §0 cumplido, `M = 9` y el archivo será **`0010_delegaciones_a2a.ts`** exportando `migration0010DelegacionesA2A`. Si `hito-2.1` cerrara con otra cantidad, la regla vale igual y el número cambia solo.

**DDL final** (el del ADR 74 pto 4, sin desviaciones nuevas):

```sql
CREATE TABLE IF NOT EXISTS delegaciones_a2a (
  id                  TEXT PRIMARY KEY,
  caso_id             TEXT NOT NULL REFERENCES casos(id),
  destino_clave       TEXT NOT NULL,
  agente_externo_url  TEXT NOT NULL,
  tarea_delegada      TEXT NOT NULL,
  a2a_task_id         TEXT,
  estado              TEXT NOT NULL,
  resultado           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegaciones_a2a_caso ON delegaciones_a2a(caso_id);
```

| Columna | Constraint | Por qué |
|---|---|---|
| `caso_id` | `NOT NULL REFERENCES casos(id)` | `casos` nunca se poda — mismo criterio que `delegaciones.caso_id` (`0007`) y `propuestas_cambio.caso_id` (`0009`) |
| `destino_clave` | `NOT NULL`, **agregada al DDL del Plan** | Sin ella, `agente_externo_url` es la única pista y un `localhost:PUERTO` no dice nada. Mismo argumento con que el ADR 48 agregó `caso_id`/`agent_id` a `delegaciones` |
| `agente_externo_url` | `NOT NULL` | Nace con la URL base, termina con el endpoint efectivo del card (**ADR 80 pto 1**). Es evidencia de contra qué corrió, no de qué estaba configurado hoy |
| `tarea_delegada` | `NOT NULL` | Tope `TAREA_DELEGADA_MAX_CHARS` puesto por el **núcleo**, no por SQL — mismo criterio que `solicitudes_internas.detalle` y `propuestas_cambio.patch` |
| `a2a_task_id` | **nullable** | Sólo existe DESPUÉS del `SendMessage` — *registrar antes de invocar*, idéntico a `delegaciones.sesion_subagente_id` (ADR 48) |
| `estado` | `NOT NULL`, **sin `CHECK`** | Valores `TASK_STATE_*` crudos (ADR 71 pto 5). Criterio de todo el esquema: el vocabulario canónico vive en el núcleo, el SQL no lo conoce — igual que `casos.estado`, `ventas.estado`, `propuestas_cambio.estado` |
| `resultado` | **nullable** | Sólo en `TASK_STATE_COMPLETED` |
| `created_at`, `updated_at` | `NOT NULL` | ISO-8601 UTC, comparado y ordenado lexicográficamente (ADR 16 regla 3) |

**Un solo índice**, a diferencia de `0009` (que tiene dos): hay **un** patrón de lectura real — la evidencia de `docs/progreso/` y el volcado por caso. No hay ninguna pantalla ni comando que filtre por `estado`, y un índice sin lector es peso muerto.
**Sin FK a `delegaciones`**: son hermanas por `caso_id`. Un agente externo nunca va a tener fila en `sesiones_agente` (ADR 74 pto 4).
**Sin columna para el nombre del agente**: el DDL del Plan no la tiene y agregarla por comodidad de log no se justifica — el nombre viaja en el evento `a2a-delegacion-completada` (ADR 79 pto 2).

### 7.2 `repository.ts` — funciones nuevas

```ts
export interface InsertDelegacionA2AInput { /* id, casoId, destinoClave, agenteExternoUrl,
                                               tareaDelegada, estado, createdAt, updatedAt */ }
export function insertDelegacionA2A(db: Database.Database, input: InsertDelegacionA2AInput): void;

export class DelegacionA2ANotFoundError extends Error { constructor(id: string); }

export interface ActualizarDelegacionA2AInput { /* delegacionId, estado, a2aTaskId?, resultado?,
                                                   agenteExternoUrl?, updatedAt */ }
/**
 * `UPDATE` simple, SIN transacción (ADR 80 pto 3) — no hay una segunda fila
 * que insertar en el mismo acto, a diferencia de `completarDelegacion`.
 * `COALESCE(@campo, campo)` para los tres opcionales: un `undefined` no pisa
 * lo ya escrito (mismo patrón que `updateCaso`, `repository.ts:131-145`).
 * `changes === 0` ⇒ `DelegacionA2ANotFoundError`, mismo criterio que
 * `completarDelegacion`.
 */
export function actualizarDelegacionA2A(db: Database.Database, input: ActualizarDelegacionA2AInput): void;

export interface DelegacionA2ARow { /* … camelCase, con los opcionales condicionales
                                       (`...(x !== null ? { x } : {})`), molde de rowToDelegacion … */ }

/** Lectura de evidencia: las delegaciones externas de un caso, en orden. */
export function listDelegacionesA2APorCaso(db: Database.Database, casoId: string): readonly DelegacionA2ARow[];
```

### 7.3 Composition root

**`src/build-on-venta.ts`** — la fábrica del puerto y el cableado del enganche:

```ts
/**
 * Cierra `despacharDelegacionA2A` (núcleo) sobre el store y el Cliente A2A, y
 * lo envuelve en el `try/catch` TOTAL que hace de esta consulta algo
 * INFORMATIVO (ADR 76 pto 4) — molde exacto de `createNotificadorAdapter`,
 * que traduce cualquier `EmailApiError` o throw inesperado a un evento y
 * devuelve sin propagar. **Nunca rechaza, nunca lanza.**
 */
export function createConsultaRiesgoCredito(deps: {
  readonly db: Database.Database;
  readonly cliente: ClienteA2APort;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}): ConsultaRiesgoCreditoPort;

/** Molde de `createDelegacionStore` (`build-on-activity.ts:238`). */
export function createDelegacionA2AStore(db: Database.Database): DelegacionA2AStorePort;

export interface BuildOnVentaDeps {
  // … los actuales …
  /** Ausente ⇒ A2A apagado ⇒ `registrarVenta` no evalúa el umbral (ADR 82 pto 3). */
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
}
```

El insumo que `createConsultaRiesgoCredito` arma es **fijo, en código** (nunca del modelo, nunca de un prompt):

```ts
const insumo: InsumoDelegado = {
  instruccion: "Verificá el riesgo crediticio del cliente para esta venta y devolvé una evaluación breve.",
  material: [
    `ventaId: ${input.ventaId}`, `clienteId: ${input.clienteId}`,
    ...(input.planAnterior !== undefined ? [`planAnterior: ${input.planAnterior}`] : []),
    `planNuevo: ${input.planNuevo}`, `monto: ${input.monto}`,
  ].join("\n"),
};
```

**`src/main.ts`** — el interruptor y el cableado, en el bloque 5b (ventas), junto a `createNotificadorAdapter` (líneas 329-340):

```ts
// 5b-bis. Cliente A2A saliente (Hito 6, ADR 82; hoisted por ADR 85). OPT-IN:
//         sin HARNESS_A2A_SALIENTE=on no se construye NADA — ni adaptador, ni
//         store, ni puerto — y tanto `registrarVenta` como `/consultar-kpi` se
//         comportan exactamente como en v2.1.0 (cero filas en
//         delegaciones_a2a, cero fetch salientes).
//
//         El interruptor se lee UNA SOLA VEZ y UNA SOLA instancia de adaptador
//         alimenta a los DOS consumidores (§5.7.4 tensión 1). `buildOnVenta`
//         está en la línea 335 y `buildOnComandoEmpleado` en la 377
//         (verificado), así que este bloque va antes de ambos, junto a
//         `createNotificadorAdapter` (línea 329).
const clienteA2A = isA2ASalienteEnabled()
  ? createA2AAdapter({
      logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
    })
  : undefined;

const riesgoCredito =
  clienteA2A !== undefined
    ? createConsultaRiesgoCredito({
        db,
        cliente: clienteA2A,
        logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
      })
    : undefined;

const ventaHandlers = buildOnVenta({
  db, notifier, ventasConfig, baseUrlPublica: webConfig.publicUrl,
  ...(riesgoCredito !== undefined ? { riesgoCredito } : {}),   // exactOptionalPropertyTypes
});

// … y más abajo, en el wiring ya existente de la TUI (línea 377):
const onComandoEmpleado = buildOnComandoEmpleado({
  // … los campos actuales, sin tocar …
  ...(clienteA2A !== undefined ? { clienteA2A } : {}),         // ADR 85 + exactOptionalPropertyTypes
});
```

### 7.4 Archivos de configuración del repo

| Archivo | Cambio | Motivo |
|---|---|---|
| `openspec/config.yaml` | Sacar A2A de *"Planned (not yet installed)"* (línea 8) | Es el sentido que este change le da: cliente propio, **cero dependencias nuevas**. `testing.layers.integration` **ya está en `true`** (línea 21, verificado — lo puso `v2.1.0`): **no se toca** |
| `README.md` | Sección nueva de variables `HARNESS_A2A_*` + `VENTA_GRANDE_UMBRAL` + **cómo levantar a mano un sample de `a2a-samples`** | ADR 75 pto 4. Tabla con el mismo formato que la de `HARNESS_GIT_*`/`HARNESS_WORKTREE_*` (líneas 91-99) |
| `.env.example` | Las 8 variables nuevas, comentadas y **sin valores reales** | El archivo ya existe y es el lugar donde un operador las descubre |
| `package.json` | — | **Sin dependencias nuevas** |

**Tabla completa de variables nuevas**:

| Variable | Campo | Default | Inválido / ausente |
|---|---|---|---|
| `HARNESS_A2A_SALIENTE` | interruptor | **`off`** (opt-in, ADR 82) | Cualquier valor ≠ `on` ⇒ apagado |
| `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` | `destinos["riesgo-credito"].baseUrl` | — | Ausente ⇒ destino **no disponible** (no aborta el arranque) |
| `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` | `destinos["kpi-incidente"].baseUrl` | — | Ídem |
| `HARNESS_A2A_TOKEN_RIESGO_CREDITO` | `.authToken` (Bearer opcional) | — | Ausente ⇒ sin header `Authorization` |
| `HARNESS_A2A_TOKEN_KPI_INCIDENTE` | `.authToken` | — | Ídem |
| `HARNESS_A2A_REQUEST_TIMEOUT_MS` | `requestTimeoutMs` | `30_000` | Inválido ⇒ **default**, nunca lanza |
| `HARNESS_A2A_POLL_INTERVAL_MS` | `pollIntervalMs` | `1_500` | Ídem |
| `HARNESS_A2A_TASK_TIMEOUT_MS` | `taskTimeoutMs` | `120_000` | Ídem |
| `VENTA_GRANDE_UMBRAL` | `VentasConfig.ventaGrandeUmbral` | `5_000` | Presente e inválido ⇒ **ABORTA el arranque** (regla de `ventas-config.ts`, ADR 83) |

**La asimetría es deliberada y ya tiene precedente**: la config de adaptador es best-effort (`resolvePositiveNumber` *"never throws"*), la config de negocio aborta (`resolveVentasConfig` acumula y corta).

---

## 8. Logging (Concepto Transversal 3)

Eventos nuevos, **sin cambiar el contrato de `logTurnEvent`** — mismo criterio de todos los hitos anteriores:

| Evento | `casoId` | Campos |
|---|---|---|
| `a2a-delegacion-iniciada` | caso real | `delegacionId`, `destinoClave`, `tareaChars` |
| `a2a-agent-card-resuelto` | caso real | `destinoClave`, `agenteNombre`, `endpointHost` |
| `a2a-tarea-enviada` | caso real | `delegacionId`, `a2aTaskId`, `estado` |
| `a2a-poll` | caso real | `a2aTaskId`, `estado`, `intento`, `transcurridoMs` |
| `a2a-poll-fallido` | caso real | `a2aTaskId`, `reason`, `intento` — **no corta el loop** (ADR 81 pto 3) |
| `a2a-cancel-intentado` | caso real | `a2aTaskId`, `ok` — best-effort, nunca cambia el desenlace |
| `a2a-delegacion-completada` | caso real | `delegacionId`, `a2aTaskId`, `agenteNombre`, `resultadoChars`, `duracionMs` |
| `a2a-delegacion-fallida` | caso real | `delegacionId`, `reason`, `estado`, `duracionMs` |
| `a2a-destino-no-configurado` | caso real | `destinoClave` — **sin fila creada** |
| `a2a-riesgo-credito-disparada` | caso de la venta | `ventaId`, `monto`, `umbral` |
| `a2a-riesgo-credito-contrato-violado` | caso de la venta | `ventaId` — la red de seguridad del `void … .catch()` |
| `consulta-kpi-caso-creado` (**ADR 85**) | caso nuevo del comando | — · molde literal de `soporte-caso-creado` (`build-on-soporte.ts:107`) |
| `comando-consultar-kpi-fallido` (**ADR 85**) | caso nuevo del comando | `reason` cuando es `DelegacionA2ANoCompletadaError`, `message` cuando es un throw inesperado — molde de `comando-soporte-fallido` |
| `comando-consultar-kpi-desactivado` (**ADR 85**) | `COMANDO_LOG_CORRELATION_ID` | — · el interruptor está apagado: **no hay caso** que correlacionar, así que usa la correlación del canal, mismo criterio que `comando-privilegiado-sin-sesion` |

**NUNCA se loguea**: el valor de `Authorization` (requirement literal del spec), el texto de `tarea_delegada` (sólo `tareaChars` — mismo criterio que `v2.0.0`), el texto del resultado (sólo `resultadoChars` — mismo criterio que `propuesta-creada` con el patch), ni la URL completa del endpoint (sólo `endpointHost`: una URL con query podría llevar un token, y el host alcanza para diagnosticar).

---

## 9. Errores y degradación

| Falla | Comportamiento | Precedente |
|---|---|---|
| Clave fuera del registro | `DestinoA2ADesconocidoError`, **antes** de tocar la base | `SubagenteDesconocidoError` |
| Clave sin `HARNESS_A2A_ENDPOINT_*` | Evento + `DelegacionA2ANoCompletadaError("transporte")`, **sin fila huérfana** | ADR 72 pto 3 / **RD-22** |
| `crearDelegacionA2A` falla | **PROPAGA** (falla ruidosa): sin fila no hay trazabilidad | `ActivityStorePort`, ADR 80 pto 4 |
| Agent Card inaccesible | `reason = "transporte"`, sin intentar ningún método JSON-RPC | Spec, escenario literal |
| Agent Card sin `url` o sin JSON-RPC | `reason = "protocolo"`, sin intentar `SendMessage` | Spec, escenario literal |
| `SendMessage` falla por red/HTTP | `reason = "transporte"`, fila con `TASK_STATE_SUBMITTED` | ADR 81 pto 4 |
| Un `GetTask` individual falla | Evento `a2a-poll-fallido`, **el loop sigue** hasta el deadline | **ADR 81 pto 3** |
| `status.state` desconocido (incluido `TASK_STATE_UNSPECIFIED`) | `reason = "protocolo"`, valor crudo truncado en el mensaje, **jamás un crash ni un `as any`** | **ADR 84** |
| Sobre JSON-RPC con `error` | `reason = "protocolo"` | Spec |
| Timeout total agotado | `CancelTask` best-effort ⇒ `reason = "timeout"`, fila con el **último estado conocido** | ADR 73 pto 4 |
| `CancelTask` falla | Evento `a2a-cancel-intentado {ok:false}`; **el desenlace sigue siendo `timeout`** | ADR 73 pto 4, criterio asimétrico de `cerrar` |
| `TASK_STATE_INPUT_REQUIRED` / `AUTH_REQUIRED` | Fracaso **inmediato** con `reason` propio, sin seguir consultando | ADR 73 pto 2 / R11 |
| El puerto rechaza (contrato violado) | Traducido a `{ ok:false, reason:"transporte" }` por el `try/catch` del núcleo | **ADR 77 pto 4** |
| `actualizarDelegacionA2A` falla | **PROPAGA** — una base que no acepta el `UPDATE` es peor que el fallo original | ADR 80 pto 4 |
| **Cualquiera de las anteriores en el camino de VENTAS** | Evento y nada más. **La venta no se cancela, no se bloquea, no cambia de estado** | **ADR 76** |
| **Cualquiera de las anteriores en `/consultar-kpi`** | `catch` explícito en el handler ⇒ `mensajeDeMotivoA2A(reason)`, uno distinto por motivo. Fila `RESULTADO_FALLIDA` + evento. **La TUI SIEMPRE responde** | **ADR 85 pto 7** / ADR 40 (`manejarSoporte`) |
| Un throw NO tipado en `/consultar-kpi` | Mismo `catch`, rama `toErrorMessage(error)` — el molde que este archivo ya usa cinco veces | ADR 40 |
| `/consultar-kpi` sin sesión vigente | Guarda del preámbulo (paso 6). **Cero caso, cero fila, cero `fetch`** — el handler ni siquiera corre | `esComandoPrivilegiado`, ADR 28/32 |
| `/consultar-kpi` con `HARNESS_A2A_SALIENTE` apagado | `clienteA2A === undefined` ⇒ mensaje de desactivado. **Cero caso, cero fila, cero `fetch`** | **ADR 85 pto 10** + ADR 82 |
| `createCaso` de `/consultar-kpi` falla | **PROPAGA** hacia el `catch` del handler ⇒ mensaje legible. Sin caso no se intenta ninguna delegación | molde de `buildOnSoporte` paso 1 |
| `HARNESS_A2A_SALIENTE` apagado | Cero adaptador, cero filas, cero `fetch`: `v2.1.0` exacto | ADR 82 pto 3 |

---

## 10. Estrategia de testing (TDD estricto — `strict_tdd: true`)

**Regla del change**: ningún test de núcleo ni de adaptador abre un socket. La costura es `FetchFn` (adaptador) y `ClienteA2APort` (núcleo). **Tres categorías; la tercera ya existe como categoría desde `v2.1.0`, pero es la primera vez que toca la RED.**

### A. Tests puros (sin dobles, sin I/O)

| Módulo | Qué se testea | TDD |
|---|---|---|
| `a2a-contract.ts` | **el test estrella**: `esEstadoTerminal` **exhaustivo sobre los ocho** (`COMPLETED`/`FAILED`/`CANCELED`/`REJECTED` terminales; `SUBMITTED`/`WORKING` no; `INPUT_REQUIRED`/`AUTH_REQUIRED` terminales de fracaso); `esTaskStateConocido` **rechaza `TASK_STATE_UNSPECIFIED`** y un string inventado (ADR 84); `motivoDeEstadoTerminal` total sobre los cinco; `DESTINOS_A2A` tiene **exactamente dos** elementos; **cero imports** en el archivo (assert sobre el fuente, molde de `hitl-contract`) | Sí |
| `dispatch-delegation-a2a.ts` | `resolverDestinoA2A` con las dos claves válidas y con `""`/`"riesgo_credito"`/`"otro"` ⇒ `DestinoA2ADesconocidoError`; `construirTareaDelegadaA2A` con encabezado de **clave** (no de card), truncado exacto a `TAREA_DELEGADA_MAX_CHARS` con `TAREA_TRUNCADA_SUFIJO`, y **sin** ninguna `AgentDefinition` involucrada | Sí |
| `a2a/config.ts` | `claveAVariableEntorno` para las 2 claves × 2 campos (**los guiones se vuelven `_` y todo va en mayúsculas**); `resolveA2AConfig` con env vacío / valores válidos / `"abc"` / `"0"` / `"-1"` / `"Infinity"` / `"1e400"` / `"   "` ⇒ **siempre** defaults y **nunca lanza**; un destino configurado y el otro no ⇒ `undefined` sólo en ese; `isA2ASalienteEnabled` con `on`/`ON`/` on `/`off`/`true`/`1`/ausente | Sí |
| `ventas-config.ts` | `VENTA_GRANDE_UMBRAL` válido / ausente ⇒ default / `"0"` / `"-5"` / `"abc"` ⇒ **error acumulado junto a `COMISION_PORCENTAJE` y `REEMBOLSO_UMBRAL`** cuando también fallan | Sí |
| `dispatch-delegation.ts` | `DelegacionA2ANoImplementadaError` **no está** entre los exports del módulo; `resolverDestino` sigue devolviendo `in-process` para todo id registrado | Sí |
| `comando-empleado.ts` (**ADR 85**) | `/consultar-kpi hola que tal` ⇒ `{tipo:"consultar_kpi", consulta:"hola que tal"}` — el resto **entero**, con espacios internos, recortado en bordes; **★ y NO un `{tipo:"devolucion"}`** (§5.7.1, el fallthrough); `/consultar-kpi` pelado y `/consultar-kpi    ` ⇒ `{tipo:"ayuda", motivo:"argumentos"}`; `esComandoPrivilegiado("consultar_kpi") === true`; `COMANDOS` tiene **quince** descriptores y `/ayuda` sigue **último**; `formatearAyuda()` incluye la línea del comando nuevo | Sí |

### B. Tests con dobles (`FetchFn` fake, puertos fake) — sin red

| Módulo | Qué se testea | Doble |
|---|---|---|
| `a2a/client.ts` (card) | `GET` a `/.well-known/agent-card.json` **exacto**; card válido ⇒ el `url` del card es el endpoint de los tres POST; **dos delegaciones consecutivas hacen DOS `GET`** (sin caché, escenario literal); red caída ⇒ `transporte` **sin ningún POST**; card sin `url` / sin transporte JSON-RPC ⇒ `protocolo` **sin `SendMessage`** | `FetchFn` fake |
| `a2a/client.ts` (métodos) | `method` es exactamente `"SendMessage"`/`"GetTask"`/`"CancelTask"`, **ninguno con prefijo `a2a/`**; `SendMessage` se envía **exactamente una vez** por delegación sin importar cuántos `GetTask` haya | `FetchFn` fake |
| `a2a/client.ts` (loop) | **con `ahoraMs`/`dormir` inyectados y CERO tiempo real**: el intervalo entre `GetTask` es `pollIntervalMs`; terminal en la 3ª consulta ⇒ **no hay 4ª**; nunca terminal ⇒ `CancelTask` una vez y `reason:"timeout"` con el **último estado**; un `GetTask` que falla por timeout **no corta** y el loop sigue hasta el deadline | `FetchFn` + reloj fake |
| `a2a/client.ts` (fallas) | `!response.ok` ⇒ `transporte`; sobre con `error` ⇒ `protocolo`; `status.state` desconocido y `TASK_STATE_UNSPECIFIED` ⇒ `protocolo` **sin excepción**; campos extra desconocidos junto a un `state` válido ⇒ **se ignoran y sigue**; cuerpo de error > 500 chars ⇒ **truncado a 500**; cuerpo corto ⇒ completo | `FetchFn` fake |
| `a2a/client.ts` (credenciales) | Con `authToken` configurado: el header sale en el request **y** el valor **no aparece** en ningún mensaje de error ni en ningún `logEvent` — para las 6 formas de falla | `FetchFn` + `logEvent` spy |
| `a2a/index.ts` (firmas) | **R8**: ninguna función exportada del adaptador acepta una URL como parámetro — assert sobre las firmas/valores, no un grep | — |
| `dispatch-delegation-a2a.ts` | orden `baseUrlDe → crear → delegar → actualizar` (spy ordenado); destino no configurado ⇒ **`crearDelegacionA2A` NO se llama**; éxito ⇒ fila con `COMPLETED`+`a2aTaskId`+`resultado`+endpoint efectivo; fallo ⇒ fila con el **último estado** y `DelegacionA2ANoCompletadaError` con ese `reason`; un puerto que **rechaza** ⇒ `transporte` (red de seguridad); el módulo **no importa** `src/adapters/a2a/` (assert sobre el fuente) | Puertos fake |
| `registrar-venta.ts` | `monto < umbral` ⇒ **cero llamadas** a `consultar`; `monto === umbral` ⇒ **sí** dispara; `riesgoCredito === undefined` ⇒ comportamiento **idéntico a v2.1.0**; **la llamada ocurre ANTES de `notificarLinkConfirmacion`** (spy ordenado); un `consultar` que **nunca resuelve** ⇒ `registrarVenta` **resuelve igual** (la prueba de que no bloquea); un `consultar` que **rechaza** ⇒ `registrarVenta` resuelve igual y loguea el evento; **`clienteEmail` no aparece** en el input de `consultar` | Puerto fake + promesa colgada |
| `build-on-venta.ts` | `createConsultaRiesgoCredito` **nunca rechaza** aunque `despacharDelegacionA2A` tire (incluido un throw **síncrono**); con `riesgoCredito` ausente el handler es el de `v2.1.0` | Puertos fake |
| `build-on-comando-empleado.ts` (**ADR 85**) | **sin sesión** ⇒ mensaje de la guarda y **cero** llamadas al puerto, cero `createCaso`; `clienteA2A` ausente ⇒ mensaje de desactivado, **cero** caso y **cero** fila; éxito ⇒ el `responseText` **es** el texto del agente externo y hay fila `RESULTADO_ATENDIDA` en `registro_acciones_empleado`; **el turno ESPERA** (un puerto que resuelve tarde ⇒ la promesa del handler no resuelve antes — el espejo exacto del test de "no bloquea" de `registrar-venta.ts`); **los OCHO motivos** de `DelegacionA2ANoCompletadaError` ⇒ ocho mensajes **distintos entre sí** (assert de unicidad sobre el conjunto, no ocho asserts sueltos) y `RESULTADO_FALLIDA` en los ocho; un throw NO tipado ⇒ igual responde; `createCaso` que tira ⇒ igual responde, **sin** intentar delegar; con `authToken` configurado, el valor **no aparece** en ningún `responseText` ni `logEvent`; el `switch` de ruteo cubre `"consultar_kpi"` (exhaustividad por `tsc`) | Puertos fake + `ClienteA2APort` fake + SQLite `:memory:` |
| `repository.test.ts` | La migración aplica; `insertDelegacionA2A` deja `a2a_task_id`/`resultado` en **NULL**; `actualizarDelegacionA2A` con `undefined` **no pisa** lo ya escrito (`COALESCE`); `changes === 0` ⇒ `DelegacionA2ANotFoundError`; `listDelegacionesA2APorCaso` ordena por `created_at`; **el `estado` persistido es `TASK_STATE_*` crudo**, nunca minúscula-con-guion | SQLite `:memory:` |

### C. Integración real contra un agente A2A — **primera vez que un test de este repo toca la red**

Archivo único: `src/test/integration/a2a-client.integration.test.ts`, molde de `run-tests.integration.test.ts` (`describe.skipIf`, degrada a *skip* y **no** a falla).

**Diferencia técnica con el molde, y hay que escribirla**: `run-tests.integration.test.ts` sondea con `execFileSync` (**síncrono**), y `describe.skipIf` necesita un booleano en tiempo de colección. El sondeo del Agent Card es **asíncrono** (`fetch`), así que el gate usa **top-level `await`** en el archivo de test (ESM, soportado por vitest):

```ts
async function sondearAgentCard(baseUrl: string | undefined): Promise<boolean> {
  if (baseUrl === undefined || baseUrl.trim() === "") { return false; }
  try {
    const r = await fetch(`${baseUrl}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch { return false; }
}
const A2A_DISPONIBLE = await sondearAgentCard(process.env.HARNESS_A2A_ENDPOINT_RIESGO_CREDITO);
describe.skipIf(!A2A_DISPONIBLE)("cliente A2A (integración contra un agente real)", () => { … });
```

**Sondear el card, no adivinar por variable de entorno** (ADR 75 pto 2): una variable puesta con el servidor caído convertiría el gate en una falla espuria.

| Qué verifica contra un agente A2A real |
|---|
| `GET /.well-known/agent-card.json` devuelve un card con `url` y transporte JSON-RPC declarado — **conformidad de descubrimiento** |
| `SendMessage` devuelve un `task.id` y un `status.state` que **es uno de los ocho conocidos** — conformidad de vocabulario |
| El loop de `GetTask` llega a `TASK_STATE_COMPLETED` con **texto no vacío** — conformidad end-to-end, lo único que un doble no puede probar |
| El mismo test, apuntado a `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE`, pasa **sin una línea de código distinta** — es lo que demuestra que el cliente es agnóstico al dominio (**RD-26**, ahora además con productor real vía `/consultar-kpi`, **ADR 85**) |

**Excepción de TDD** (`AGENTS.md`): la migración es SQL declarativo — se escribe junto a su test de `repository.test.ts`, que **sí** va primero. `.env.example` y `README.md` son documentación.

---

## 11. Verificación manual del entregable

1. Levantar a mano un sample de `a2a-samples` (procedimiento del README), exportar `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` y `HARNESS_A2A_SALIENTE=on`.
2. `POST /ventas` con `monto` **por debajo** de `VENTA_GRANDE_UMBRAL` ⇒ **cero filas** en `delegaciones_a2a`, `201` inmediato.
3. `POST /ventas` con `monto >= VENTA_GRANDE_UMBRAL` ⇒ **el `201` vuelve enseguida** (cronometrado — es la prueba de ADR 76/R3) **y** aparece una fila en `delegaciones_a2a` con `estado='TASK_STATE_SUBMITTED'`, `a2a_task_id` NULL.
4. Segundos después: `SELECT destino_clave, agente_externo_url, a2a_task_id, estado, resultado FROM delegaciones_a2a WHERE caso_id = ?` ⇒ `TASK_STATE_COMPLETED`, `a2a_task_id` no nulo, `resultado` no vacío, y `agente_externo_url` **con el endpoint del card**, no con la base (evidencia del ADR 80).
5. **La venta sigue su curso**: el cliente recibió su link, el token confirma, la comisión se calcula. La consulta **no gateó nada**.
6. **Tráfico JSON-RPC capturado** (log del sample o proxy): los `method` son `SendMessage`/`GetTask`, **sin prefijo `a2a/`** — evidencia de la corrección al Plan.
7. **Segundo dominio**: apuntar `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` al sample de analytics y correr el test de integración contra él ⇒ pasa **sin cambiar código** (entregable 4 del Plan).
7b. **(ADR 85) El camino SÍNCRONO, con un humano esperando**: en la TUI, `/login` y después `/consultar-kpi <consulta>` contra ese mismo sample ⇒ el turno **tarda** lo que tarde el agente (cronometrado: a diferencia del paso 3, acá el tiempo SÍ se percibe — es la prueba de que este camino bloquea y el de ventas no), responde con el texto del agente externo, y deja una fila en `delegaciones_a2a` con `destino_clave='kpi-incidente'` y `estado='TASK_STATE_COMPLETED'` más una fila `atendida` en `registro_acciones_empleado`. **Es la evidencia del Escenario 4 del arc42 con un llamador real.**
7c. **(ADR 85) `/consultar-kpi` sin `/login`** ⇒ mensaje de sesión requerida, **cero** filas en `delegaciones_a2a` y **cero** casos nuevos.
7d. **(ADR 85) `/consultar-kpi` con el sample apagado** ⇒ mensaje legible de transporte (no un stacktrace, no un cuelgue), fila con el último estado conocido.
8. **Fallo**: apagar el sample a mitad de un poll ⇒ fila con el **último estado conocido**, evento `a2a-delegacion-fallida` con `reason`, **la venta intacta**.
9. **Timeout**: `HARNESS_A2A_TASK_TIMEOUT_MS=3000` contra un agente lento ⇒ `a2a-cancel-intentado` + `reason="timeout"` + fila con `TASK_STATE_WORKING`.
10. **Destino no configurado**: borrar `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` y disparar una venta grande ⇒ evento `a2a-destino-no-configurado`, **cero filas**, venta intacta.
11. **Rollback**: `HARNESS_A2A_SALIENTE=off`, misma venta grande ⇒ **cero filas, cero `fetch` salientes**, comportamiento idéntico a `v2.1.0`.
12. **Ningún log contiene el token**: `rg` sobre `data/harness.log` por el valor de `HARNESS_A2A_TOKEN_*` ⇒ **cero resultados**.
13. `npm test` y `npm run typecheck` en verde, con el sample **apagado** ⇒ el archivo de integración aparece **skipped** y el resto pasa.
14. **Evidencia** en `docs/progreso/v2.2-a2a-cliente/`: el tráfico JSON-RPC de **los dos** agentes, el volcado de `delegaciones_a2a`, el log estructurado, la medición del `201`, y **la nota de corrección al Plan** (nombres de método, valores de estado, y el noveno valor del enum — ADR 84).

---

## 12. Presupuesto de review — corte de PRs encadenados (R12)

La propuesta estimó **~700-900 líneas de producción**. Bajado a firmas concretas y con la relación test:producción ≈ **1:1** de este repo (TDD estricto), el total de la tabla es **~1.700 líneas de diff** (la prosa original decía "~1.500"; `tasks.md` ya documentó esa inconsistencia interna y fijó la tabla como base). **Con la enmienda del ADR 85 son ~1.975 y CINCO PRs**:

| PR | Contenido | Prod. | Test | Total |
|---|---|---|---|---|
| **1** | `core/agents/a2a-contract.ts` · `adapters/a2a/config.ts` · `.env.example` | ~180 | ~200 | **~380** |
| **2** | `adapters/a2a/client.ts` · `adapters/a2a/index.ts` · `src/test/integration/a2a-client.integration.test.ts` · `README.md` | ~260 | ~230 | **~490** |
| **3** | Migración `NNNN` · `repository.ts` (3 funciones + row) · `core/turn-selector/dispatch-delegation-a2a.ts` · **borrado** de `DelegacionA2ANoImplementadaError` + su test + angostamiento de `input.destino` · `subagents.ts` (export) | ~250 | ~230 | **~480** |
| **4** | `ventas-config.ts` · `ventas-contract.ts` · `registrar-venta.ts` · `build-on-venta.ts` · `main.ts` (hoist de `clienteA2A` + ventas) · `openspec/config.yaml` | ~170 | ~180 | **~350** |
| **5** (**ADR 85**) | `core/commands/comando-empleado.ts` · `core/commands/registro-acciones-contract.ts` · `build-on-comando-empleado.ts` · `main.ts` (pasar `clienteA2A` a la TUI) · `README.md` (una línea de comando) | ~110 | ~165 | **~275** |

**Por qué PR5 y no dentro del PR4** — verificado, no asumido: **`build-on-comando-empleado.ts` no aparece en NINGÚN PR de este corte**. El PR4 toca exclusivamente el eje de ventas (`ventas-*`, `build-on-venta.ts`, `main.ts`) y su unidad de review es *"una venta grande dispara la consulta"*. Meter el canal TUI ahí mezclaría dos superficies humanas distintas en un mismo diff y llevaría el PR4 de ~350 a ~625 — por encima del presupuesto. Como PR propio, PR5 tiene una unidad de review de una sola frase (*"un empleado consulta al agente de KPIs y espera la respuesta"*), es **aditivo puro** (ningún archivo del PR1-4 cambia de comportamiento) y es revertible solo.

**Orden y autonomía** — cada PR es demostrable solo y revertible sin tocar el anterior:

```
1 (aditivo puro: nadie lo consume) ──▶ 2 (el cliente habla con un agente real: test de integración)
   └──▶ 3 (la tabla existe, el despachador delega, la deuda del ADR 45 queda saldada)
          └──▶ 4 (una venta grande dispara la consulta NO BLOQUEANTE — entregable de ventas)
                 └──▶ 5 (un empleado consulta KPIs y ESPERA — el camino SÍNCRONO del ADR 74
                         con su primer llamador real; ENTREGABLE COMPLETO, RD-26 cerrado)
```

**Rollback en orden inverso**: 5 → 4 → 3 → 2 → 1. **Los PR 1, 2 y 5 son aditivos puros** y pueden quedarse mergeados sin efecto observable (el 5, con el interruptor apagado, sólo agrega un comando que responde "desactivado"). **Lo único no aditivo** es el PR 3 (el borrado de `DelegacionA2ANoImplementadaError` y el angostamiento del tipo). Con `feature-branch-chain` — misma estrategia que `hito-2.0` y `hito-2.1` — el PR 1 apunta al tracker `hito/v2.2-a2a-cliente` y cada hijo al inmediato anterior.

---

## 13. Riesgos residuales (RD-19 a RD-31)

| # | Riesgo | Mitigación |
|---|---|---|
| **RD-19** | **Gate de secuencia ignorado (R10)**: `sdd-apply` arranca sin `v2.1.0` en `main` ⇒ colisión de migración y una rama que nace de una `main` sin `src/adapters/git/` | §0 con verificación ejecutable de tres condiciones. `sdd-apply` reporta `blocked`, no "parcial". **No bloquea este diseño** — bloquea su implementación |
| **RD-20** | **La promesa en vuelo no sobrevive al proceso.** Si el arnés se cierra (Ctrl+C en la TUI) mientras una consulta de riesgo está en su loop de polling, la fila queda para siempre en `TASK_STATE_SUBMITTED`/`WORKING` | **Aceptado y declarado.** Es la consecuencia directa de ADR 74 (sin asincronía real, sin reanudación) combinada con ADR 76 (sin nadie esperando). La fila **es** la evidencia de que la consulta se disparó y no volvió — que es exactamente la información correcta. Un proceso de reanudación es el change futuro que ADR 74 pto 2 ya difirió con su condición de disparo escrita |
| **RD-21** | **"La verificación ya se intentó" queda satisfecha como *iniciada*, no como *resuelta*.** El texto del spec de `venta-confirmacion` admite las dos lecturas; ADR 76 elige la débil | **Declarado, no escondido** (ADR 76 pto 6). La lectura fuerte exige bloquear `POST /ventas` hasta 2 min, que es lo que R3 pedía evitar. Si el checkpoint quiere la lectura fuerte, el precio es un timeout dedicado y bajo para ese camino — §15 pto 1 |
| **RD-22** | **`reason = "transporte"` para "destino no configurado" es grueso**: mezcla "el operador no configuró el endpoint" con "la red falló" | Aceptado para **no** abrir un noveno `reason` que el spec cerró explícitamente en ocho. Se distingue por el evento propio `a2a-destino-no-configurado` y por `detalle`. Si el diagnóstico resulta insuficiente en la práctica, el noveno `reason` es un cambio de spec, no un parche |
| **RD-23** | **Un `fetch` extra por delegación** (el Agent Card, sin caché — R6) | Aceptado por ADR 72 pto 5: una caché trae invalidación y no hay volumen que la justifique. Con la consulta no bloqueante (ADR 76), ese `fetch` extra ni siquiera está en el camino de una respuesta HTTP |
| **RD-24** | **Los campos del Agent Card que declaran el transporte NO se verificaron literalmente** (el fetch del spec devolvió esa sección truncada) | El validador es **tolerante por diseño** (§6.2): acepta `preferredTransport`/`preferred_transport` con `"JSONRPC"` o `"TRANSPORT_PROTOCOL_JSONRPC"`, o una entrada de `additionalInterfaces`. `sdd-apply` **confirma contra `spec/a2a.proto` y contra el card real del sample antes de escribirlo**, y el test de integración es lo que lo prueba de verdad |
| **RD-25** | **Conformidad de protocolo propia (R4) + los samples pueden no existir o no ser v1.0.0 (R9)** | ADR 71 pto 7, aceptado a conciencia: superficie mínima (3 métodos, 1 transporte), tipos cerrados que ignoran lo desconocido, `protocolo` para todo lo no reconocido. `sdd-tasks` verifica el repo de samples **antes** de escribir la tarea de evidencia; si ninguno califica, el fallback es un servidor A2A mínimo propio **sólo para el test** |
| ~~**RD-26**~~ | ~~**`kpi-incidente` no tiene productor productivo en `v2.2.0`.**~~ **RESUELTO — cerrado por el ADR 85.** El checkpoint humano respondió §15 pto 2 con un **sí**: `/consultar-kpi <consulta>` es un productor de producción real para `"kpi-incidente"`, y además es el **primer y único llamador del camino síncrono del ADR 74** — un gap que RD-26 no había nombrado y que era peor que el que sí nombraba | **Cerrado**, no mitigado. Sigue en pie la evidencia que RD-26 proponía (test de integración parametrizado §10.C + §11 paso 7), ahora **complementada** por §11 pasos 7b-7d, que ejercitan el comando real de punta a punta. Diseño en §5.7; requirements en `specs/delegacion-a2a-saliente/spec.md` (los tres últimos); tareas en el **PR5** (§12). Riesgos nuevos que esta pieza abre: **RD-30** y **RD-31** |
| **RD-27** | **El enum `TaskState` tiene NUEVE valores** y toda la documentación de este change dice ocho | **ADR 84**: el noveno (`TASK_STATE_UNSPECIFIED`) cae por la regla ya escrita de estado desconocido ⇒ `protocolo`, sin contradecir ningún requirement. El test lo cubre explícitamente y `docs/progreso/` lo anota junto a la corrección al Plan |
| **RD-28** | **Concurrencia sin cola**: N ventas grandes simultáneas ⇒ N loops de polling en vuelo en el mismo proceso | Acotado por `taskTimeoutMs` (2 min) y por el volumen real de un arnés de pasantía. No se introduce `createKeyedQueue()` porque el ADR 15 ya decidió que este camino no lo necesita y las delegaciones externas **no comparten estado entre sí** (filas distintas, sin CAS, sin transacción) |
| **RD-29** | **El test de integración nunca corre en CI (R5)**: la conformidad real queda verificada sólo a mano | Aceptado por ADR 75. Se compensa con el gate por **sondeo real** (no por bandera), el README con el procedimiento, y la **evidencia manual obligatoria** contra los dos samples que el checklist de cierre de `AGENTS.md` exige igual |
| **RD-30** (**ADR 85**) | **`/consultar-kpi` puede dejar la TUI esperando hasta 2 minutos** con un agente externo lento. Es el ADR 74 funcionando como fue diseñado — pero es la **primera vez** que un humano paga ese costo en pantalla, y la TUI **no** muestra progreso: los eventos `a2a-poll` van al log estructurado, no al turno | **Aceptado y declarado, no escondido.** Es exactamente el precio del camino síncrono, y el motivo por el que ventas **no** lo usa (ADR 76). Tres mitigaciones que ya existen y **no** requieren perilla nueva: (a) el techo es configurable por operador (`HARNESS_A2A_TASK_TIMEOUT_MS`); (b) el desenlace de timeout es **legible**, no un cuelgue; (c) la `ayuda` del descriptor dice explícitamente *"y espera su respuesta"*, así que la espera no sorprende. Una barra de progreso en la TUI exigiría streaming de estado hacia el turno — infraestructura que el ADR 73 dejó fuera de alcance con argumento propio |
| **RD-31** (**ADR 85**) | **`RD-20` se agrava un poco**: si el proceso muere mientras `/consultar-kpi` poll-ea, la fila queda en `SUBMITTED`/`WORKING` para siempre — y acá, a diferencia de ventas, **hay un humano mirando** una TUI que se cerró | Misma aceptación que **RD-20**, del que éste es un caso particular: sin asincronía real no hay reanudación (ADR 74 pto 2, con su condición de disparo ya escrita). Diferencia a favor: acá el humano **sabe** que su consulta no volvió, porque estaba esperándola — en el camino de ventas nadie se entera. La fila sigue siendo la evidencia correcta de "se disparó y no volvió" |

---

## 14. Trazabilidad — requirement de spec ↔ diseño

**Los cuatro archivos de spec, requirement por requirement.** No hay requirement sin implementación, ni módulo de este diseño sin requirement que lo pida.

| Spec / Requirement | Dónde se implementa |
|---|---|
| `cliente-a2a-jsonrpc` · Agent Card en la URL bien conocida, sin caché, endpoint del card | §6.2 (paso 1 del ciclo) + §4.1 + §10.B ("dos delegaciones ⇒ dos `GET`") + **RD-24** |
| `cliente-a2a-jsonrpc` · card inaccesible ⇒ `transporte`; card inválido ⇒ `protocolo` | §6.2 + §9 (dos filas) + §10.B |
| `cliente-a2a-jsonrpc` · los tres métodos con sus nombres reales, sin `a2a/` | §6.2 (tabla de las tres llamadas, **verificada contra el spec real**) + §10.B |
| `cliente-a2a-jsonrpc` · `SendMessage` una vez + loop de `GetTask` con intervalo y timeout total | §4.1 + §6.2 + **ADR 81** + §10.B (loop con reloj inyectado) |
| `cliente-a2a-jsonrpc` · timeout de un request no agota el total | **ADR 81 pto 3** + §9 + §10.B |
| `cliente-a2a-jsonrpc` · `CancelTask` best-effort, nunca cambia el desenlace | §4.1 (rama del deadline) + §9 + §8 (`a2a-cancel-intentado`) |
| `cliente-a2a-jsonrpc` · clasificación `transporte` vs `protocolo`; `TaskState` desconocido no crashea | §9 (tabla completa) + **ADR 84** + §10.B |
| `cliente-a2a-jsonrpc` · campo desconocido se ignora sin fallar | **ADR 71 pto 6** (tipos cerrados) + §10.B |
| `cliente-a2a-jsonrpc` · cuerpo de error truncado a 500; ninguna credencial en ningún mensaje | §6.2 (`ERROR_BODY_MAX_CHARS`) + §8 ("NUNCA se loguea") + §10.B (test de credenciales × 6 fallas) |
| `cliente-a2a-jsonrpc` · ninguna firma pública acepta una URL (R8) | §5.1 (`ClienteA2APort` sólo por clave) + **ADR 78** (se borra `endpoint` del tipo público) + §6.3 + §10.B |
| `cliente-a2a-jsonrpc` · un solo test con red, gateado por **sondeo** del card | §10.C (con la diferencia del top-level `await` documentada) |
| `delegacion-a2a-saliente` · registro estático de 2 claves por env, mapeo puro | §5.1 (`DESTINOS_A2A`) + §6.1 (`claveAVariableEntorno`) + §10.A |
| `delegacion-a2a-saliente` · clave sin env ⇒ no aborta el arranque; delegar a ella falla tipado sin fila huérfana | **ADR 72 pto 3** + §5.2 (paso a) + §9 + **RD-22** |
| `delegacion-a2a-saliente` · el llamador elige la clave, nunca el modelo | §7.3 (insumo fijo, en código, en `createConsultaRiesgoCredito`) + §5.2 (`resolverDestinoA2A` sobre registro cerrado) |
| `delegacion-a2a-saliente` · `ClienteA2APort` inyectable; el núcleo no importa el adaptador | §5.1 + §5.2 (doc-comment) + §10.B (assert sobre los imports del módulo) |
| `delegacion-a2a-saliente` · registrar antes de invocar, completar después, siempre con el último estado | §4.1 + §5.2 (secuencia a-f) + **ADR 77 pto 3** + **ADR 80** |
| `delegacion-a2a-saliente` · `TASK_STATE_*` crudo + predicado puro exhaustivo | §5.1 + **ADR 84** + §10.A ("el test estrella") + §7.1 (`estado` sin `CHECK`) |
| `delegacion-a2a-saliente` · `INPUT_REQUIRED` no queda esperando | §5.1 (`esEstadoTerminal`) + §9 + ADR 73 pto 2 |
| `delegacion-a2a-saliente` · el Despachador bloquea, sin `pendiente_a2a` ni reanudación | §5.2 (doc-comment de `despacharDelegacionA2A`) + **ADR 74 intacto** + **RD-20** |
| `delegacion-a2a-saliente` · ocho desenlaces explícitos, error tipado que propaga | §9 (tabla) + §5.1 (`MotivoDelegacionA2ANoCompletada`) + **ADR 77** |
| `delegacion-a2a-saliente` · tope de 8 000 chars sin `AgentDefinition` | **ADR 79 pto 3-4** + §5.2 + §5.4 + §10.A |
| `delegacion-a2a-saliente` · interruptor `HARNESS_A2A_SALIENTE` | **ADR 82** + §7.3 + §10.B + §11 paso 11 |
| `delegacion-a2a-saliente` · `/consultar-kpi` privilegiado, un solo paso, consulta obligatoria (**ADR 85**) | §5.7.1 (descriptor + rama de parseo + su ubicación obligatoria) + §5.7.3 (un solo paso, sin cuarta rama de `confirmacionPendiente`) + §10.A (fila de `comando-empleado.ts`) + §11 paso 7c |
| `delegacion-a2a-saliente` · `/consultar-kpi` es el productor real de `"kpi-incidente"` y **espera** el resultado (**ADR 85**) | §1 (tabla de disciplinas, tercera fila) + §5.7.3 (secuencia a-e, insumo fijo en código) + §10.B (test de que el turno espera) + §11 paso 7b + **RD-26 resuelto** |
| `delegacion-a2a-saliente` · cada motivo a un mensaje legible distinto; ningún camino silencioso (**ADR 85**) | §5.7.3 (`mensajeDeMotivoA2A`, `switch` exhaustivo ⇒ error de compilación si el vocabulario crece) + §9 (seis filas nuevas) + §8 (tres eventos) + §10.B (assert de unicidad sobre los ocho) + **RD-30** |
| `despacho-delegacion` (delta) · `DelegacionA2ANoImplementadaError` no existe | §5.3 (borrado) + §10.A (assert sobre los exports) |
| `despacho-delegacion` (delta) · el test de `hito-2.0` está borrado | §5.3 + §12 (PR 3) |
| `despacho-delegacion` (delta) · `despacharDelegacion` sólo in-process, sin importar `adapters/a2a/` | **ADR 78 pto 2** (angostamiento por tipo: es un error de compilación, no una convención) |
| `despacho-delegacion` (delta) · un destino `a2a` se despacha por la función hermana | §5.2 (`despacharDelegacionA2A`) + **ADR 78 pto 3** |
| `venta-confirmacion` (delta) · `ventaGrandeUmbral` validado al arranque como `reembolsoUmbral` | §5.5 + **ADR 83** + §10.A |
| `venta-confirmacion` (delta) · `registrarVenta` delega riesgo/crédito **antes de notificar**, `>=` cuenta | §4.2 + §5.6 + §10.B (spy ordenado y monto igual al umbral) |
| `venta-confirmacion` (delta) · **la tensión abierta: qué pasa si la delegación falla** | **ADR 76** (informativa, no bloqueante, nunca cancela) + §9 (última fila) + **RD-21** |
| `venta-confirmacion` (delta) · por debajo del umbral / con el interruptor off ⇒ `v2.1.0` exacto | §5.6 (la guarda de dos condiciones) + **ADR 82 pto 3** + §10.B |

---

## 15. Preguntas abiertas para el checkpoint humano

> Las decisiones ya cerradas (ADR 71-75 + la del enganche no bloqueante, formalizada como **ADR 76**) **no se reabren**. Lo que sigue son las colisiones y las palancas que aparecieron **al bajar la propuesta a firmas reales**.

1. **RD-21 — "intentada" vs. "intentada y resuelta".** ADR 76 satisface el requirement del spec en su lectura **débil**: cuando el cliente recibe el link, la consulta de riesgo está **iniciada**, no concluida. Es el precio directo de no retener `POST /ventas` hasta 2 minutos (R3). Si querías la lectura fuerte, la única forma es bloquear con un timeout dedicado y bajo (p. ej. 5 s) sólo para ese camino — decime y se agrega una perilla `HARNESS_A2A_VENTA_TIMEOUT_MS`; hoy **deliberadamente no existe** para no tener una perilla sin consumidor.

2. ~~**RD-26 — `kpi-incidente` no tiene productor productivo.**~~ **RESPONDIDA — SÍ, formalizada como ADR 85** (`proposal.md`). El productor es el comando TUI privilegiado `/consultar-kpi <consulta>`, **síncrono y bloqueante**. Se eligió sobre el enganche en el camino de actividades porque ése está detrás del ADR 10 (`202` antes de procesar) y por lo tanto tampoco tendría a nadie esperando el resultado — habría reproducido el problema del ADR 76 en vez de cerrarlo. Bajada técnica en **§5.7**, requirements en `specs/delegacion-a2a-saliente/spec.md`, tareas en el **PR5** de §12. Lo que queda abierto de esta pieza es **RD-30** (la espera de hasta 2 min visible en la TUI, sin barra de progreso) — declarado, aceptado, y sin perilla nueva. Si el checkpoint quiere un techo más bajo **sólo** para el camino de TUI, es la misma conversación que el punto 1 de esta sección y la misma respuesta: hoy deliberadamente no hay una segunda perilla sin consumidor propio.

3. **ADR 83 — el número de `VENTA_GRANDE_UMBRAL`.** Elegí `5_000` con criterio (holgadamente por encima de `REEMBOLSO_UMBRAL = 500`), pero es un parámetro de tu demo. Mismo estatus que los tres números del ADR 73: si querés otro, este es el momento.

4. **ADR 78 — el angostamiento de `input.destino` y el borrado de `endpoint`.** Es la única corrección estructural que le hago a la delta de spec, y es forzada por el código: sin angostar el tipo, borrar el `throw` deja una unión sin narrowing; y `endpoint: string` en un tipo público exportado contradice el requirement de R8 del otro spec. Confirmalo antes de `sdd-apply`.

5. **ADR 79 — el encabezado de la tarea es la CLAVE, no el nombre del Agent Card.** Corrige el ADR 74 pto 3, que pedía algo imposible en ese orden (la fila se crea antes de conocer el card). Si el nombre del agente te importa **en la fila** y no sólo en el log, hace falta una columna que el DDL del Plan no tiene — decilo ahora.

6. **ADR 84 / RD-27 — el noveno `TaskState`.** `TASK_STATE_UNSPECIFIED` existe en la especificación real y ninguno de los documentos previos lo menciona. Lo trato como estado desconocido ⇒ `protocolo`, sin tocar ningún requirement. Si preferís tratarlo como no-terminal (seguir consultando), es un cambio de spec, no de diseño.

7. ~~**RD-24 — los campos del Agent Card que declaran el transporte no están verificados literalmente.**~~ **RESUELTO en `sdd-apply` (tarea 4)**: verificado contra `specification/a2a.proto` normativo del tag `v1.0.0` (no contra `main`, que puede ir adelante del release) y contra `docs/specification.md` del mismo tag. El campo es `supportedInterfaces[]` (no `preferredTransport`/`additionalInterfaces`, que no existen), ver §6.2 arriba para el detalle. No fue una tolerancia entre dos formas plausibles — una de las dos hipótesis originales estaba simplemente equivocada.

8. **§12 — CINCO PRs encadenados** (eran cuatro antes del ADR 85), con `chain_strategy = feature-branch-chain` (mismo criterio que `hito-2.0` y `hito-2.1`). El PR5 es propio y no parte del PR4 por un motivo verificado, no estético: **`build-on-comando-empleado.ts` no aparecía en ningún PR del corte original**, y sumarlo al PR4 lo llevaría de ~350 a ~625 líneas. Confirmá el corte.

9. **RD-19 — el gate de secuencia.** Que quede asentado, de nuevo, que `sdd-apply` de este change **no arranca** hasta ver `v2.1.0` mergeada en `main` con su tag. Hoy **sigue sin cumplirse**.

---

**Nota de formato**: la skill `sdd-design` sugiere un tope de 800 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`, `hito-2.1`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato técnico **completo** del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto, igual que en `exploration.md`, `proposal.md` y los cuatro `specs/`.
