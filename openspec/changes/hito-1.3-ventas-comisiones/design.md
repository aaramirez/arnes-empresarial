> **Nota de proceso (hook de graphify)**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), igual que `sdd-explore`, `sdd-propose` y `sdd-spec` de este hito y los de Hito 3, así que no se pudo invocar el binario. Se compensó con lectura directa y **verificada** de: `src/main.ts`, `src/build-on-activity.ts`, `src/adapters/webhooks/server.ts`, `index.ts` y `config.ts`, `src/adapters/board/config.ts`, `github-client.ts` e `index.ts`, `src/adapters/memory/repository.ts`, `db.ts`, `migrations/index.ts` y `migrations/0003_proyectos_responsables_actividades.ts`, `src/core/logging/turn-logger.ts`, `src/core/config/env.ts`, `src/core/turn-selector/handle-turn.ts` (índice de exports), `src/core/agents/definitions.ts` (índice de exports), `package.json`, y `docs/Plan_Implementacion_Harness_Empresarial.md:222-283`. Toda afirmación sobre código existente en este documento está citada contra esos archivos. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-tasks` corra `graphify explain` sobre `VentaStorePort`, `VentaNotifierPort` y el adaptador web.

# Diseño técnico: Hito 4 — Confirmación de venta y comisiones (v1.3.0)

**Entra con**: [`proposal.md`](proposal.md) (pendiente de checkpoint humano sobre **ADR 7-11**, la desviación de concurrencia y el alcance de **R3**) · [`specs/venta-confirmacion/spec.md`](specs/venta-confirmacion/spec.md) · [`specs/reembolso-evaluacion/spec.md`](specs/reembolso-evaluacion/spec.md) · [`specs/soporte-web-turno/spec.md`](specs/soporte-web-turno/spec.md) · [`specs/reporte-comisiones-mensual/spec.md`](specs/reporte-comisiones-mensual/spec.md) · [arc42](../../../docs/ARC42_Harness_Empresarial.md) (Caja Blanca bloques 3 y 5, Riesgo 2, Escenario de calidad 4) · [`AGENTS.md`](../../../AGENTS.md) (reglas no negociables).

**Alcance de este documento**: el *cómo* arquitectónico — ADRs, componentes, **contratos literales** (firmas, interfaces, SQL), flujo de datos, fronteras, logging, degradación, riesgos. No es la lista de tareas (eso es `tasks.md`, que este documento **no** toca) ni el contrato de requisitos (eso es `specs/`).

**Alcance verificado de los specs**: **19 requerimientos** y **24 escenarios** repartidos así — `venta-confirmacion` 6/11, `reembolso-evaluacion` 6/6, `soporte-web-turno` 3/3, `reporte-comisiones-mensual` 4/4. (El encargo de esta fase mencionaba 28 escenarios; contados uno por uno sobre los cuatro archivos, son 24. §7.3 y §13 los cubren de a uno, así que la diferencia es de conteo, no de cobertura.)

**Numeración de ADR**: el arc42 fijó ADR 1-2, Hito 2 fijó ADR 3 / 3.1 / 4, Hito 3 fijó ADR 5-10 (5 y 6 en su propuesta, 7-10 en su diseño), y la propuesta de **este** hito fijó **ADR 7-11** en su propia secuencia. Para no colisionar con los ADR 7-10 de Hito 3, este documento arranca en **ADR 12** y trata los ADR 7-11 de la propuesta como dados: no se repiten, se referencian.

---

## 1. Resumen de la arquitectura elegida

Dos adaptadores nuevos (uno entrante, uno saliente), un bloque de núcleo nuevo (`src/core/ventas/`), **dos** módulos hermanos de `build-on-activity.ts` en el composition root — porque hay dos naturalezas de flujo, no una (ADR 7 de la propuesta) — y un entrypoint CLI independiente.

```
                         composition root (src/main.ts)
                                      │
     ┌────────────────┬───────────────┼───────────────┬──────────────────┐
     │                │               │               │                  │
buildOnSubmit   buildOnActivity   buildOnVenta   buildOnSoporte    openDatabase
(Hito 1,        (Hito 3,          (NUEVO —       (NUEVO —          bootstrapHarness
 intacto)        intacto)          DETERMINISTA)  CON handleTurn)         │
     │                │               │               │                  │
     ▼                ▼               └───────┬───────┘                  ▼
 startTui      startWebhookServer             ▼                   MemoryPort
   (I1)         (Hito 3, intacto)      startWebServer            VentaStorePort
                                     (src/adapters/web/)      (closures s/ repository.ts)
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     │  POST /ventas  GET|POST /confirmar/:token       │
                     │  POST /devolucion            POST /soporte      │
                     └────────────────────────┬────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────┐
                    ▼                                           ▼
        src/core/ventas/  (PURO)                     handleTurn (SOLO /soporte)
   registrarVenta · confirmarVenta · rechazarVenta      + createKnowledgeAdapter({casoId})
   procesarDevolucion · calcularComision                (handle-turn.ts NO se modifica)
   evaluarReembolso · validarTokenConfirmacion
   agruparReporteMensual · buildSoportePrompt
                    │                    │
        VentaStorePort            VentaNotifierPort
        (repository.ts,           (src/adapters/notificaciones/,
         transaccional)            fetch + degradación a log)


        entrypoint aparte:  npm run reporte:mensual  →  src/reporte-mensual.ts
                            openDatabase → lecturas → agruparReporteMensual (PURA)
                            → formatearReporteMensual (PURA) → stdout → db.close()
```

Ninguna flecha va de `src/core/` a `src/adapters/*`. Ningún adaptador le habla a otro: el Adaptador Web recibe **callbacks inyectados** y nunca importa memoria, agentes ni notificaciones (ADR 12); el Adaptador de Notificaciones se invoca **desde el núcleo** a través de `VentaNotifierPort`. Las únicas flechas que cruzan la frontera nacen en el composition root (`main.ts`, `build-on-venta.ts`, `build-on-soporte.ts`, `reporte-mensual.ts`) — la excepción documentada de `AGENTS.md`.

**La asimetría es el punto** (ADR 7 de la propuesta, materializado acá): tres de los cuatro caminos nuevos **no tocan el SDK ni `handleTurn`**. `calcularComision` es una multiplicación y `evaluarReembolso` es una comparación; ponerles un modelo estadístico en el medio no es uniformidad, es no-determinismo en el camino del dinero.

**Lo que NO cambia** (garantía de no-regresión): `handle-turn.ts`, `invoke-model.ts`, `assemble-context.ts`, `close-turn.ts`, `resolve-turn.ts`, `definitions.ts`, `turn-error.ts`, `keyed-queue.ts`, `build-on-submit.ts`, `build-on-activity.ts`, todo `src/core/activity/`, todo `src/adapters/tui/`, `src/adapters/knowledge/`, `src/adapters/webhooks/` y `src/adapters/board/`. Se tocan exactamente cinco archivos existentes: `repository.ts` (funciones nuevas al final), `migrations/index.ts` (una línea de append), `db.ts` (**cero** — WAL ya está), `main.ts` (wiring + cierre), `core/config/env.ts` (module doc) y `package.json` (un script). `db.ts` figura en la lista solo para decir explícitamente que no se toca.

**Precisión del diseño sobre el ADR 7 de la propuesta.** La propuesta describió el hermano determinista como *"un manejador que compone repositorio + núcleo puro y devuelve un resultado"*, sin decir **dónde vive la orquestación** (validar → transaccionar → notificar). Este diseño la pone **en el núcleo** (`src/core/ventas/registrar-venta.ts`, `confirmar-venta.ts`, `procesar-devolucion.ts`), con puertos inyectados, exactamente como `run-activity-turn.ts` hace hoy — y deja en `src/build-on-venta.ts` **solo** el wiring (armar los puertos sobre `repository.ts` y sobre el notificador, y tragar/loguear el error del borde). Motivo: si la secuencia "chequear estado → calcular comisión → persistir → notificar" viviera en `src/build-on-venta.ts`, la regla de negocio más cara del hito quedaría en un archivo que importa adaptadores concretos, o sea intesteable sin base de datos — justo lo contrario de lo que TDD estricto y el ADR 7 quieren. El manejador del composition root sigue sin ser un constructor de turno y sigue sin recibir `HandleTurnDeps`; la propuesta se cumple en su intención y se precisa en su ubicación.

---

## 2. Decisiones de arquitectura (ADR 12-20)

Mismo formato que Hitos 2 y 3: **Contexto / Decisión / Alternativas consideradas / Consecuencias**. Al cerrar el hito se copian a `docs/ARC42_Harness_Empresarial.md`, sección *Decisiones de Diseño*, junto con los ADR 7-11 de la propuesta.

### ADR 12: El Adaptador Web recibe **cuatro handlers inyectados** y no conoce ni el núcleo de ventas ni la memoria

**Contexto**. El ADR 7 de la propuesta fija ruteo asimétrico: `/ventas`, `/confirmar/:token` y `/devolucion` son deterministas, `/soporte` pasa por `handleTurn`. La tentación obvia es que el adaptador importe `src/core/ventas/` y arme él mismo la llamada — total, el núcleo no es un adaptador y la regla no lo prohíbe.

**Decisión**. El adaptador web importa **solo `ventas-contract.js`** (tipos y constantes, sin lógica) y recibe en `WebServerDeps` cuatro callbacks ya cerrados sobre sus dependencias, molde exacto de `startWebhookServer({ onEvent })` (`src/adapters/webhooks/index.ts:51`):

```ts
readonly onAltaVenta:   (input: AltaVentaInput)   => Promise<AltaVentaResult>;
readonly onConsultaVenta: (token: string)         => Promise<VentaPublica | undefined>;
readonly onDecisionVenta: (input: DecisionVentaInput) => Promise<DecisionVentaResult>;
readonly onDevolucion:  (input: DevolucionInput)  => Promise<DevolucionResult>;
readonly onSoporte:     (input: SoporteInput)     => Promise<SoporteResult>;
```

(Cinco, contando `onConsultaVenta`, que es el `GET` de la página; "cuatro" en el título son las cuatro **rutas** POST del entregable.) Los cuatro primeros los arma `build-on-venta.ts` sin `handleTurn`; el quinto lo arma `build-on-soporte.ts` con `handleTurn`. El adaptador no sabe cuál es cuál: para él son cinco funciones que devuelven promesas.

**Alternativas consideradas**:

- *El adaptador importa `src/core/ventas/` y llama las funciones directo*: rechazada. Necesitaría también el `VentaStorePort`, o sea `better-sqlite3`, o sea el adaptador web importando el adaptador de memoria — literalmente la regla no negociable de `AGENTS.md`. Y aunque se le inyectara el store, el adaptador pasaría a decidir el orden de la transacción y el momento de la notificación: reglas de negocio dentro del transporte.
- *Un solo handler genérico `onRequest(rutaNormalizada, payload)` con un discriminante*: rechazada. Colapsa cinco tipos de entrada y cinco de salida en un `unknown` con `switch`, y tira el chequeo estático justo donde el hito tiene su superficie pública. La asimetría del ADR 7 es real; esconderla detrás de un tipo unión la vuelve invisible en vez de resolverla.

**Consecuencias**. Aparecen **dos** módulos hermanos de `build-on-activity.ts` en vez de uno (R1 de la propuesta se materializa acá). El costo se paga con module docs explícitos en los dos, citando ADR 7 y el criterio de corte ("¿hay un paso de razonamiento real?"). A cambio, todo el adaptador web se testea con handlers dobles de una línea, sin base, sin red y sin SDK.

### ADR 13: Los tipos estructurales de HTTP se **re-declaran** en `src/adapters/web/`, no se importan de `src/adapters/webhooks/`

**Contexto**. `src/adapters/webhooks/server.ts:30-55` ya define `WebhookRequest`, `WebhookResponse`, `HttpServerLike` y `CreateServerFn` — recortes estructurales de `node:http` que son exactamente lo que el adaptador web necesita, y que ya están probados. Reusarlos es un `import` de 4 nombres.

**Decisión**. Se **duplican** (~25 líneas) como `WebRequest`, `WebResponse`, `WebHttpServerLike`, `CreateWebServerFn` en `src/adapters/web/http.ts`. `src/adapters/webhooks/` no se toca.

**Alternativas consideradas**:

- *`import type { WebhookRequest } from "../webhooks/server.js"`*: rechazada. Son solo tipos y `import type` se borra en compilación (`isolatedModules`), así que no habría acoplamiento **en runtime** — pero sí lo habría en el grafo de dependencias del código fuente, que es lo que `AGENTS.md` prohíbe y lo que un lector ve. Además crea un precedente pésimo: el día que alguien necesite una constante y no un tipo, el import ya está escrito y solo hay que sacarle el `type`.
- *Promoverlos a `src/core/http/`*: rechazada, y es la alternativa que más tienta. Serían tipos sin imports y sin I/O, técnicamente elegibles para el núcleo. Pero `IncomingMessage`/`ServerResponse` son **la forma de un transporte concreto**: meterlos en `src/core/` significa que el núcleo, que hoy no sabe que existe HTTP, pasaría a tener HTTP en su vocabulario para siempre. El criterio del ADR 8 de Hito 3 (`keyed-queue` sí va al núcleo porque lo que serializa es un turno, no SQLite) juega acá al revés: lo que estos tipos describen **es** el transporte.
- *Un paquete/carpeta `src/adapters/_shared/`*: rechazada por YAGNI y por el mismo argumento de los ADR 8 y 9 de la propuesta — infraestructura compartida con dos consumidores y 25 líneas.

**Consecuencias**. 25 líneas duplicadas, con un comentario en cada archivo que dice por qué y apunta al otro. Si mañana aparece un tercer adaptador HTTP entrante, ese es el disparador para reconsiderar (tres consumidores, no dos).

### ADR 14: **Ningún** endpoint de este hito usa el ack-`202` del ADR 10 de Hito 3 — todos responden después del efecto

**Contexto**. El ADR 10 de Hito 3 fue tajante: el webhook responde `202` **antes** de correr el turno, porque GitHub falla la entrega a los ~10 s y un turno dura decenas de segundos. Copiar ese patrón acá sería "consistencia".

**Decisión**. Los cinco endpoints responden **después** de aplicar su efecto:

1. `/ventas`, `/confirmar/:token`, `/devolucion` son deterministas: el efecto completo son una o dos sentencias SQL síncronas más, en el alta, una llamada HTTP best-effort acotada. Latencia del orden de milisegundos. Responder antes no compra nada y perdería lo único que el llamador necesita (el `ventaId`, la página de resultado, el veredicto del reembolso).
2. `/soporte` **espera el turno** y devuelve la respuesta del agente en el cuerpo HTTP — porque el spec `soporte-web-turno` lo exige literalmente ("la respuesta del agente se devuelve en la respuesta HTTP de `POST /soporte`") y porque del otro lado no hay un GitHub con timeout de entrega de 10 s, hay un cliente que hizo una pregunta y espera la contestación. El canal de salida del turno **es** la respuesta HTTP, a diferencia de Hito 3 donde era el comentario en el PR.
3. Para que (2) no sea un endpoint que puede quedar colgado para siempre, `/soporte` corre el turno en carrera contra `SOPORTE_TIMEOUT_MS` (**120 000 ms**, constante, no env var — es un presupuesto de UX, mismo criterio que `SERVER_CLOSE_TIMEOUT_MS`). Si vence, responde `504` y loguea `soporte-timeout`; **el turno sigue corriendo** (no se puede cancelar `handleTurn` sin tocarlo, y no se toca) y su `caso` ya está persistido, así que la respuesta no se pierde: queda en `data/harness.log` y el `caso` en la base.
4. El drenaje al cerrar es **más simple que el de Hito 3, no más complejo**: como `/soporte` mantiene la conexión abierta mientras el turno corre, `server.close()` de `node:http` ya espera esa conexión por sí solo. Igual se mantiene el `Set<Promise<void>>` de turnos en vuelo con el mismo techo de `SERVER_CLOSE_TIMEOUT_MS` (**5 000 ms**), porque el `504` del punto 3 cierra la conexión y deja el turno huérfano — sin el `Set`, ese caso escaparía al drenaje.

**Alternativas consideradas**:

- *`202` + resultado por email en `/soporte`*: rechazada. Convierte una consulta de soporte en un ticket asíncrono, contradice el escenario literal del spec y arrastra el notificador (que puede estar degradado a log) al camino feliz de una capacidad que no lo necesita.
- *Sin timeout en `/soporte`*: rechazada. Es el único endpoint público del hito cuyo tiempo de respuesta no está acotado por nada; sin techo, N requests lentas pinchan N conexiones del proceso que además sostiene la TUI.
- *Timeout configurable por env*: rechazada por el mismo argumento con el que `SERVER_CLOSE_TIMEOUT_MS` no lo es. Nadie lo va a tunear y agrega una variable más a validar.

**Consecuencias**. Se rompe la simetría con Hito 3 **a propósito**, y queda escrito por qué: el ack diferido no es una virtud arquitectónica, es una respuesta al timeout de entrega de un emisor concreto. Donde ese emisor no existe, el patrón no aplica.

### ADR 15: La guarda contra doble confirmación es el `WHERE estado = ...` del propio `UPDATE` (compare-and-swap), no un `SELECT` previo

**Contexto**. Tres requisitos distintos convergen en el mismo punto: "un segundo `POST` sobre un token ya procesado no produce una segunda transición ni una segunda fila de comisión" (`venta-confirmacion`), "dos POST simultáneos sobre el mismo token no pueden confirmar dos veces" (*Approach* de la propuesta) y R4 ("no usar la cola por `vendedor_id` se lee como omisión"). La forma ingenua es `findVentaByToken` → validar estado en JS → `UPDATE`.

**Decisión**. La validación de estado **también** viaja al predicado del `UPDATE`, dentro de la transacción:

```sql
UPDATE ventas
   SET estado = 'confirmada', confirmed_at = @confirmedAt
 WHERE id = @ventaId
   AND estado = 'pendiente_confirmacion'
   AND (expires_at IS NULL OR expires_at > @ahora)
RETURNING id, vendedor_id, monto, caso_id, estado, confirmed_at;
```

`better-sqlite3` devuelve `undefined` en `.get()` si ninguna fila matcheó. **Ese `undefined` es la señal de "alguien llegó primero"**: la transacción termina sin escribir nada y sin insertar comisión. La fila de `comisiones` se inserta **solo** en la rama donde el `UPDATE` devolvió fila, dentro de la misma `db.transaction(...)`. La función pura `validarTokenConfirmacion(venta, ahora)` sigue existiendo y sigue siendo la que **decide la respuesta al usuario y el evento de log**; el predicado SQL es la **garantía**. Se les pasa el **mismo** valor de `ahora`, así que no pueden discrepar.

Esto es lo que hace verdadera —y no aspiracional— la afirmación de la propuesta de que una transacción da una garantía *más fuerte* que la cola por `vendedor_id`: `better-sqlite3` es síncrono, no hay ningún `await` entre el `UPDATE` y el `INSERT`, y el predicado hace el chequeo y la escritura indivisibles. Una cola serializaría el ciclo pero seguiría dependiendo de que el chequeo en JS fuera correcto; el CAS no depende de eso.

**Alternativas consideradas**:

- *`SELECT` + chequeo en JS + `UPDATE` incondicional*: rechazada. Correcta hoy por accidente (el ciclo es síncrono), frágil mañana: la primera vez que alguien meta un `await` en el medio — por ejemplo notificar dentro de la ventana de confirmación, escenario que la propia propuesta anticipa — se vuelve una condición de carrera silenciosa que duplica comisiones. El CAS no se rompe con ese cambio.
- *`createKeyedQueue()` por `vendedor_id`, como nombra el plan*: rechazada, con el argumento de la propuesta y una precisión: la clave correcta ni siquiera sería `vendedor_id` sino `venta_id` — dos ventas del mismo vendedor no compiten por nada. Y encima no haría falta: la cola protege ciclos con `await` en el medio, y acá no hay ninguno. `keyed-queue.ts` **no se importa ni se modifica** en este hito. **Desviación del plan, ya declarada en la propuesta; requiere el checkpoint.**
- *`UNIQUE (venta_id)` en `comisiones` como red adicional*: rechazada **como cambio de este hito**, pero es la alternativa más defendible de las tres. Sería una garantía de esquema, no de código. Se rechaza por dos razones: (a) sería una **segunda** desviación del SQL literal del plan, y este hito ya pide aprobar una (ADR 10, `expires_at`); (b) con el CAS, la violación es inalcanzable — el constraint no *previene* el bug, lo *convierte* en un `SQLITE_CONSTRAINT` en runtime. Queda como deuda documentada, con disparador: si alguna vez se agrega un segundo camino de escritura a `comisiones`, entra.

**Consecuencias**. Un reintento (doble click, reenvío del formulario, refresh) no es un error: es un `UPDATE` que matchea cero filas, y el usuario ve la misma página genérica que vería un token inválido (§4.4). El evento `venta-confirmacion-ignorada` lo hace visible del lado del servidor. El mismo patrón CAS se aplica, sin excepción, a `rechazarVenta`, `aprobarReembolso` y `escalarReembolso`.

### ADR 16: Aritmética del dinero y del período — redondeo a centavos con `Math.round`, `periodo = confirmed_at.slice(0, 7)` en UTC

**Contexto**. R8 de la propuesta: el esquema del plan fija `monto REAL`, o sea IEEE-754. `1000 * 0.1` da `100.00000000000001` en JavaScript, y `0.615` redondeado "a dos decimales" con `toFixed` da `0.61` en algunos motores por cómo se representa el literal. El spec exige `monto = venta.monto × COMISION_PORCENTAJE` redondeado a 2 decimales y `periodo` derivado de `confirmed_at`, **no** de `created_at`.

**Decisión**, en tres reglas, todas dentro de funciones puras testeadas:

1. **Redondeo**: `Math.round((monto * porcentaje) * 100) / 100`. No `toFixed` (devuelve string y arrastra la representación del literal), no `Intl` (formato, no aritmética). `Math.round` sobre el producto escalado es la forma con el error acotado y el comportamiento más fácil de fijar con casos borde en un test (`0.005` sube, `-0` no existe porque el porcentaje es `> 0` y el monto se valida `> 0`).
2. **Período**: `periodoDeConfirmacion(confirmedAt) = confirmedAt.slice(0, 7)`. Funciona **porque** todos los timestamps del repo son `new Date().toISOString()` — ISO-8601 en **UTC**, ancho fijo `YYYY-MM-DDTHH:mm:ss.sssZ`. Nada de `getMonth()`, que aplicaría la zona horaria de la máquina y haría que una venta confirmada a las 22:00 del 31 de enero en Caracas cayera en enero o febrero según dónde corra el proceso.
3. **Comparación de fechas en SQL**: `expires_at > @ahora` es una comparación **lexicográfica de texto**, y es correcta *solo* por la misma razón: ISO-8601 UTC de ancho fijo ordena lexicográficamente igual que cronológicamente. Esto es un invariante del repo, no una casualidad de este hito; se escribe en el module doc de la migración y en el de `token-confirmacion.ts` para que nadie escriba nunca un timestamp con otro formato en estas columnas.

**Alternativas consideradas**:

- *Enteros de centavos (`INTEGER`) en vez de `REAL`*: rechazada por alcance, igual que en la propuesta. Es la solución correcta para plata de verdad, y sería la **segunda** desviación del esquema del plan. Deuda documentada (R8).
- *Redondear al leer, no al escribir*: rechazada. Dejaría `100.00000000000001` persistido y cada consumidor (reporte, futura exportación contable) tendría que acordarse de redondear igual. El redondeo es parte del contrato de `calcularComision`, se persiste redondeado, punto.
- *`periodo` derivado de `created_at`*: explícitamente rechazada por el spec y por la propuesta — una venta creada en enero y confirmada en febrero paga en febrero, que es cuando el hecho comisionable ocurrió.

**Consecuencias**. El escenario literal del spec (`monto = 1000`, `porcentaje = 0.1`, creada en enero, confirmada en febrero → comisión `100.00` en el período de febrero) es un test unitario de `calcularComision` + `periodoDeConfirmacion`, sin base de datos. El error de punto flotante queda acotado a la suma del reporte (§6.5), que también redondea al agregar.

### ADR 17: Dos clases de configuración — la que degrada y la que aborta; `resolveVentasConfig` vive en el **núcleo**, es pura y **devuelve** un resultado en vez de lanzar

**Contexto**. El repo tiene un patrón único y consistente: `resolveWebhookConfig` / `resolveBoardConfig` (verificados) son puros, reciben `env` con default `process.env`, **nunca lanzan**, caen a defaults en silencio, y hacen un `import "../../core/config/env.js"` de side-effect. Ese patrón funciona porque en esos adaptadores la ausencia es un **modo de operación válido**. Este hito rompe eso en un punto: el spec `venta-confirmacion` exige que `COMISION_PORCENTAJE` fuera de `(0, 1]` sea **error de arranque**.

**Decisión**, dos clases separadas y una ubicación deliberada:

| Clase | Variables | Dónde vive | Ante valor ausente/inválido |
|---|---|---|---|
| **Degrada** | `WEB_PORT`, `WEB_PUBLIC_URL`, `VENTAS_API_TOKEN`, `WEB_MAX_BODY_BYTES` | `src/adapters/web/config.ts` | default silencioso; sin `WEB_PORT` el adaptador **no existe** |
| **Degrada** | `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_API_URL`, `EMAIL_TIMEOUT_MS` | `src/adapters/notificaciones/config.ts` | default silencioso; sin `EMAIL_API_KEY` el notificador es no-op que loguea |
| **Aborta** | `COMISION_PORCENTAJE`, `REEMBOLSO_UMBRAL`, `VENTA_TOKEN_TTL_HORAS` | **`src/core/ventas/ventas-config.ts`** | resultado `{ ok: false, errores }`; el composition root aborta |

Dos decisiones dentro de la decisión:

**(a) `resolveVentasConfig` vive en el núcleo, no en un adaptador.** `COMISION_PORCENTAJE` y `REEMBOLSO_UMBRAL` **son reglas de negocio parametrizadas**, no configuración de un transporte. Si vivieran en `src/adapters/web/config.ts`, el conjunto de reglas del negocio quedaría definido por el adaptador HTTP — y el día que una venta entre por otro canal (CLI, otro webhook), habría que importar config del adaptador web desde otro lado. Para que eso sea legítimo en el núcleo, la función **no importa `env.js`** y **no tiene default `= process.env`**: recibe un `Readonly<Record<string, string | undefined>>` y devuelve un valor. Es una función de un diccionario a un resultado — pura en el sentido fuerte, sin acceso a nada global. El composition root le pasa `process.env` **después** de que `env.js` cargó `.env`.

**(b) Devuelve un resultado discriminado, no lanza.** `ResolveVentasConfigResult = { ok: true; config: VentasConfig } | { ok: false; errores: readonly string[] }`. Dos razones: (i) hay **dos** consumidores con políticas distintas — `main.ts` aborta el proceso con un mensaje legible (molde del `catch` de `startHarness()`, `main.ts:180-185`), y `reporte-mensual.ts` no necesita ni el porcentaje ni el umbral, así que ni siquiera la llama; (ii) juntar **todos** los errores en un array es estrictamente mejor UX que lanzar en el primero — quien configuró mal dos variables las ve las dos de una.

**Alternativas consideradas**:

- *`resolveVentasConfig` lanza `VentasConfigError`*: rechazada por (i) y (ii). Además usa excepciones para control de flujo en una función que el resto del núcleo consume como un valor.
- *Mismo patrón "nunca lanza, cae al default" que webhooks/board*: rechazada — la contradice el spec de forma literal. Un `COMISION_PORCENTAJE=1.5` cayendo silenciosamente a `0.1` es peor que un arranque fallido: paga comisiones equivocadas sin que nadie se entere.
- *Validar con `zod` (ya está en `dependencies`)*: rechazada. Tres campos numéricos con rangos; un schema agrega indirección y mensajes en inglés genérico donde queremos tres líneas explícitas en el idioma del resto de los mensajes de arranque.

**Consecuencias**. `VENTA_TOKEN_TTL_HORAS` entra en la clase "aborta" con una salvedad: **`0` es un valor válido y significa "sin vencimiento"** (`expires_at = NULL`, el interruptor que el ADR 10 de la propuesta pide para poder desactivar la guarda sin migrar). Ausente cae a **72 h** — seguro por defecto, que es lo que R6 pide del único endpoint público. Un valor negativo o no numérico sí aborta.

### ADR 18: El notificador es un puerto de **una sola operación** sobre un cliente HTTP genérico, no un módulo por proveedor

**Contexto**. La propuesta ya fijó *qué* (API HTTP sobre `fetch` con `fetchFn` inyectable, molde `github-client.ts:102-151`, cero dependencias, `nodemailer` rechazado). No fijó la **forma del puerto** ni qué pasa el día que el proveedor cambie.

**Decisión**:

1. `VentaNotifierPort` tiene **un** método: `notificarLinkConfirmacion(input): Promise<NotificacionResultado>`. No un `enviarEmail(asunto, cuerpo)` genérico. El núcleo pide *"avisale al cliente que confirme esta venta"*; el asunto, el cuerpo y el HTML del email son detalle del adaptador, igual que el mapeo estado→label es detalle del adaptador de tablero (ADR 6 de Hito 3).
2. **Nunca rechaza y nunca lanza** — mismo contrato que `ActivityBoardPort` y `KnowledgeFeedbackPort`. Devuelve `{ enviado: true } | { enviado: false; motivo: "sin-api-key" | "http" | "network" | "timeout" | "unknown" }`, para que el núcleo pueda incluir `notificado` en la respuesta de `POST /ventas` sin aprender nada de HTTP.
3. Un solo cliente (`email-client.ts`) que hace `POST {EMAIL_API_URL}` con `Authorization: Bearer {EMAIL_API_KEY}` y cuerpo `{ from, to, subject, html }`. **Eso es literalmente la API de Resend**; SendGrid usa otra forma de cuerpo. Se dice acá con todas las letras en vez de fingir neutralidad: soportar un segundo proveedor es escribir una función `bodyFor(proveedor, mensaje)` y una variable de env más — **no** un módulo nuevo, **no** una interfaz de proveedor con dos implementaciones.
4. **La dirección de email del cliente NO se persiste.** Llega en el payload de `POST /ventas` como `clienteEmail`, viaja al notificador y se descarta. No hay columna donde guardarla (el esquema del plan no la tiene), agregarla sería una tercera desviación, y sería meter PII en una base sin control de acceso. `cliente_id` sigue siendo el identificador opaco del negocio (fuera de alcance, R9).

**Alternativas consideradas**:

- *Puerto genérico `EmailPort.enviar(mensaje)`*: rechazada. Empuja la composición del asunto y el cuerpo al núcleo, que pasaría a saber que existe el email como medio. Con un puerto de una operación, cambiar email por SMS es escribir otro adaptador.
- *Interfaz `EmailProvider` con `ResendProvider` y `SendgridProvider`*: rechazada, ADR 8 y 9 de la propuesta otra vez — un registro de proveedores con **un** proveedor. El disparador para construirlo es un segundo proveedor real en uso simultáneo, no la posibilidad de uno.
- *Persistir `cliente_email` en `ventas`*: rechazada por (4). **Consecuencia aceptada y explícita**: el link **no se puede reenviar** desde la base, porque no sabemos a dónde. El link en sí **sí** es recuperable (`SELECT token_confirmacion FROM ventas WHERE id = ?`), así que la recuperación manual existe: se saca el link y se lo hace llegar por fuera. Riesgo residual R16.

**Consecuencias**. Sin `EMAIL_API_KEY`, `createNoopNotificador` devuelve `{ enviado: false, motivo: "sin-api-key" }` y loguea `email-omitido` **con el link completo** — es un log local, y el objetivo declarado de la degradación es que la demo funcione sin cuenta externa. Se documenta que `data/harness.log` contiene links de confirmación válidos cuando el notificador está degradado (R17).

### ADR 19: `POST /devolucion` se autentica con el `token_confirmacion` de la venta, y `expires_at` **no** gatea ese camino

**Contexto**. Ni el plan, ni la propuesta, ni el spec `reembolso-evaluacion` dicen **cómo se identifica y autoriza** la solicitud de devolución. El spec solo exige que opere sobre ventas `confirmada`. Sin una decisión explícita, `POST /devolucion { ventaId }` sin credencial sería un endpoint público que reembolsa cualquier venta con solo adivinar un UUID.

**Decisión**:

1. El cuerpo es `{ token, motivo? }` — **el mismo `token_confirmacion`** que el cliente ya tiene en su bandeja. Es la única credencial que existe que (a) el cliente posee, (b) es opaca y de alta entropía, y (c) está atada a **exactamente una** venta, sin inventar identidad de cliente (fuera de alcance, R9).
2. **`expires_at` no se evalúa en este camino.** El TTL existe para acotar la ventana en que un link *de confirmación* sirve para confirmar (ADR 10 de la propuesta); una devolución ocurre por definición **después** de confirmar, potencialmente meses más tarde. Gatearlo con el mismo vencimiento haría el endpoint inútil.
3. La guarda de este camino es **el estado**: `WHERE estado = 'confirmada'` en el CAS (ADR 15). Una venta reembolsada, escalada, rechazada o pendiente no matchea. El token deja de servir para devoluciones en el instante en que la primera devolución se procesa — replay muerto por construcción.
4. `motivo` es texto libre opcional, con tope de largo, y **no se persiste** (no hay columna) — solo viaja al log recortado. Existe porque el formulario del cliente lo va a pedir igual y descartarlo en el borde es más honesto que fingir que no llegó.

**Alternativas consideradas**:

- *`{ ventaId }` + `VENTAS_API_TOKEN` (máquina a máquina)*: rechazada. Modela que **el vendedor** pide la devolución, no el cliente; el plan dice "solicitud de devolución/reembolso" en la misma página web donde el cliente confirma y consulta soporte.
- *`{ ventaId }` sin credencial*: rechazada, obviamente. Es el agujero que este ADR existe para cerrar.
- *Un segundo token de devolución emitido al confirmar*: rechazada. Necesita columna nueva (cuarta desviación), un segundo email, y no compra nada que (3) no dé: el token de confirmación ya es de un solo uso **por estado**.

**Consecuencias**. El `token_confirmacion` es una credencial de vida larga para un único efecto acotado (una devolución sobre una venta confirmada). Es un riesgo real y se declara (R15): quien tenga el link puede pedir la devolución de esa venta. La mitigación de fondo — identidad de cliente — está fuera de alcance por decisión de la propuesta, y el efecto máximo del abuso es revertir una venta que el propio dueño del link confirmó.

### ADR 20: El HTML se genera con funciones puras con escapado obligatorio; el `POST` de confirmación **no** lleva token CSRF, y por qué

**Contexto**. La propuesta fija "HTML mínimo renderizado por función pura en el adaptador, sin motor de plantillas, sin assets, sin framework". Eso deja dos cosas abiertas que son de seguridad, no de estilo: la inyección de HTML y el CSRF.

**Decisión**:

1. `renderConfirmacionHtml(venta)`, `renderResultadoHtml(resultado)` y `renderLinkInvalidoHtml()` son puras (`string` adentro, `string` afuera), viven en `src/adapters/web/render.ts` y tienen test propio.
2. **Todo** valor dinámico pasa por `escapeHtml(texto)` (`&`, `<`, `>`, `"`, `'`). Los valores dinámicos son `plan_anterior`, `plan_nuevo`, `monto` formateado y `cliente_id` — todos vienen del payload de `POST /ventas`, o sea de **entrada externa**, aunque esté autenticada. Un `plan_nuevo` con `<script>` es XSS almacenado en la página que el cliente abre. El test lo cubre explícitamente.
3. El `token` se interpola en el `action` del formulario con `encodeURIComponent`, no con `escapeHtml`: son contextos distintos (URL vs. texto HTML) y confundirlos es el error clásico. El token generado por `randomUUID()` no necesita escaparse, pero el que llega en la URL puede ser cualquier cosa, y `renderResultadoHtml` no debe confiar en su forma.
4. **Sin token CSRF**, deliberadamente. Un ataque CSRF hace que el navegador de la víctima dispare un `POST` con sus credenciales ambientales — cookies, sesión, auth básica. Acá **no hay ninguna credencial ambiental**: la única credencial es el token en el *path*, que el atacante tendría que conocer; y si lo conoce, no necesita CSRF, dispara el `POST` él mismo. Agregar un token CSRF exigiría estado de sesión (cookies) que este hito explícitamente no construye — sería **más** superficie, no menos.
5. Guardas que **sí** se ponen, porque cuestan poco: `Cache-Control: no-store` en las respuestas de `/confirmar/:token` (para que el link con credencial no quede en cachés intermedias), `Content-Type: text/html; charset=utf-8` explícito, y `Referrer-Policy: no-referrer` (para que el token en la URL no viaje en el `Referer` a ningún recurso externo — que hoy no hay, porque no hay assets, pero el header es una línea).

**Alternativas consideradas**:

- *Un motor de plantillas mínimo (`lit-html`, `handlebars`)*: rechazada — primera dependencia nueva desde el baseline, para tres funciones que devuelven strings.
- *Escapar en el borde de entrada (al recibir el payload) en vez de en el de salida*: rechazada. Escapar en la entrada guarda datos deformados en la base y falla el día que el mismo dato salga por otro canal (JSON del reporte, log). El escapado pertenece al momento de renderizar, en el contexto donde se renderiza.
- *`POST /confirmar` como `GET` con parámetro*: rechazada — un efecto de estado detrás de un `GET` lo dispara cualquier prefetch del navegador o del cliente de correo. Es exactamente cómo se confirmaría una venta sola.

**Consecuencias**. La página no tiene CSS, ni imágenes, ni JavaScript. Es fea a propósito: cada byte que no se sirve es una decisión de alcance que no hay que defender. Si la demo pide presentación, entra un `<style>` inline en la misma función pura, sin assets estáticos.

---

## 3. Componentes del Núcleo — `src/core/ventas/`

Nueve archivos, cada uno con su `*.test.ts` colocado (estilo del repo). **Ninguno importa de `src/adapters/*`.** Ninguno importa el SDK. Ninguno llama a `Date.now()` ni a `randomUUID()` por su cuenta: el tiempo y los ids entran siempre por parámetro o por `deps`, que es lo que hace todo el bloque testeable sin fixtures.

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `ventas-contract.ts` | constantes, tipos, `VentaStorePort`, `VentaNotifierPort` | §3.1. **Sin imports.** |
| `ventas-config.ts` | `VentasConfig`, `resolveVentasConfig` | §3.2. Pura, sin `process.env` (ADR 17). |
| `comision.ts` | `calcularComision`, `periodoDeConfirmacion` | §3.3. Pura. |
| `reembolso.ts` | `evaluarReembolso`, `RESULTADO_REEMBOLSO_*` | §3.3. Pura. |
| `token-confirmacion.ts` | `validarTokenConfirmacion`, `calcularExpiresAt`, `MOTIVO_TOKEN_*` | §3.3. Pura. |
| `registrar-venta.ts` | `RegistrarVentaDeps`, `registrarVenta` | §3.4. Caso de uso: alta. |
| `confirmar-venta.ts` | `ConfirmarVentaDeps`, `resolverDecisionVenta` | §3.4. Caso de uso: confirmar/rechazar. |
| `procesar-devolucion.ts` | `ProcesarDevolucionDeps`, `procesarDevolucion` | §3.4. Caso de uso: devolución. |
| `reporte.ts` | `agruparReporteMensual`, `formatearReporteMensual` | §3.5. Puras. |
| `soporte-prompt.ts` | `buildSoportePrompt`, topes de truncado | §3.6. Pura. |

(Diez, contando `soporte-prompt.ts`; nueve son del camino determinista.)

### 3.1 `src/core/ventas/ventas-contract.ts` (nuevo)

Lo único que el núcleo sabe sobre ventas, comisiones y notificaciones. **Sin imports** — misma regla que `knowledge-contract.ts` y `activity-contract.ts` cumplen hoy (verificado).

```ts
/* ── Estados canónicos de `ventas.estado` ── */
// SQLite guarda `estado` como TEXT abierto SIN CHECK (migración 0004), mismo
// criterio que `repository.ts:5-6` documenta para `casos.estado` y que 0003
// repitió para `actividades`: el conjunto de valores válidos es asunto del
// núcleo. ESTA es la lista canónica; el SQL no la conoce.

export const VENTA_ESTADO_PENDIENTE_CONFIRMACION = "pendiente_confirmacion";
export const VENTA_ESTADO_CONFIRMADA = "confirmada";
export const VENTA_ESTADO_RECHAZADA = "rechazada";
export const VENTA_ESTADO_REEMBOLSADA = "reembolsada";
/** Quinto valor, ADR 11 de la propuesta: escalación humana detectada y persistida, sin transición automática. */
export const VENTA_ESTADO_REEMBOLSO_PENDIENTE = "reembolso_pendiente";

export const VENTA_ESTADOS = [
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_RECHAZADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
] as const;
export type VentaEstado = (typeof VENTA_ESTADOS)[number];

/* ── Vocabulario de `casos` que este hito agrega ── */
// `casos.tipo` ya tiene "conversacion" (main.ts:154) y los tipos de actividad
// de Hito 3. Estos dos son los que agrega Ventas.
export const CASO_TIPO_VENTA = "venta";
export const CASO_TIPO_SOPORTE = "soporte";
/**
 * Estado al que transiciona el `caso` de una venta cuando el reembolso se
 * escala (ADR 11, punto 2). Vive acá y no en `handle-turn.ts` (donde vive
 * `CASO_ESTADO_ACTIVO`) porque hoy tiene UN dueño semántico: ventas. Cuando
 * Hito 5 generalice el HITL, se muda — con más de un dueño, deja de ser
 * vocabulario de ventas.
 */
export const CASO_ESTADO_PENDIENTE_APROBACION_HUMANA = "pendiente_aprobacion_humana";

/* ── Entidades tal como el núcleo las maneja ── */

export interface Venta {
  readonly id: string;
  readonly vendedorId: string;
  /** OPACO. Llega en el payload de alta y se guarda tal cual: sin tabla, sin FK, sin resolución de identidad (R9, fuera de alcance). */
  readonly clienteId: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly estado: VentaEstado;
  readonly casoId: string;
  readonly tokenConfirmacion: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  /** ISO-8601 UTC, o ausente = sin vencimiento (ADR 10 de la propuesta, ADR 17 de este diseño). */
  readonly expiresAt?: string;
}

export interface Comision {
  readonly id: string;
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly monto: number;
  /** `'YYYY-MM'`, derivado de `confirmed_at` — NUNCA de `created_at` (ADR 16). */
  readonly periodo: string;
  readonly createdAt: string;
}

/** Proyección segura de una venta para la página pública: SIN token, SIN caso_id, SIN cliente_id. */
export interface VentaPublica {
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
}

/* ── Puertos ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root
 * (`build-on-venta.ts`).
 *
 * SÍNCRONO a propósito, igual que `ActivityStorePort` y `MemoryPort`:
 * `better-sqlite3` lo es, y la sincronía hace VISIBLE, sin leer una línea de
 * implementación, que el único `await` de todo el camino determinista es la
 * notificación best-effort — que ocurre DESPUÉS de que la transacción cerró.
 * Esa es, literalmente, la razón por la que este hito no necesita
 * `createKeyedQueue()` (ADR 15).
 *
 * CONTRATO: falla RUIDOSAMENTE. Si el estado canónico no se persiste, no hay
 * venta — el error propaga hasta el borde HTTP, que responde 500.
 */
export interface VentaStorePort {
  /** Upsert de `vendedores` + `createCaso` + `INSERT ventas`, en UNA transacción. */
  crearVentaConCaso(input: CrearVentaConCasoInput): Venta;

  /** Lectura por token. `undefined` si no existe. Indexada por el `UNIQUE` de la columna (§6.1). */
  buscarVentaPorToken(token: string): Venta | undefined;

  /**
   * COMPARE-AND-SWAP + comisión, en UNA transacción (ADR 15).
   * Devuelve `undefined` si el `UPDATE` no matcheó ninguna fila — o sea si
   * la venta ya no estaba `pendiente_confirmacion`, o si venció entre la
   * validación y la escritura. En ese caso NO se inserta comisión.
   */
  confirmarVentaConComision(input: ConfirmarVentaConComisionInput): ConfirmacionAplicada | undefined;

  /** CAS a `rechazada` desde `pendiente_confirmacion`. `undefined` = no aplicó. Nunca crea comisión. */
  rechazarVenta(input: { readonly ventaId: string; readonly ahora: string }): Venta | undefined;

  /** CAS a `reembolsada` desde `confirmada`. `undefined` = no aplicó. NO toca `comisiones` (spec, fuera de alcance). */
  aprobarReembolso(input: { readonly ventaId: string; readonly ahora: string }): Venta | undefined;

  /**
   * CAS a `reembolso_pendiente` desde `confirmada` Y, en la MISMA transacción,
   * `caso.estado = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` vía el `casoId`
   * que la venta ya tiene (ADR 11, punto 2). `undefined` = no aplicó, y
   * entonces el `caso` tampoco se toca. NO toca `comisiones`.
   */
  escalarReembolso(input: {
    readonly ventaId: string;
    readonly casoId: string;
    readonly ahora: string;
  }): Venta | undefined;
}

export interface CrearVentaConCasoInput {
  readonly vendedor: { readonly id: string; readonly nombre: string };
  readonly caso: { readonly id: string; readonly tipo: string; readonly estado: string };
  readonly venta: {
    readonly id: string;
    readonly clienteId: string;
    readonly planAnterior?: string;
    readonly planNuevo: string;
    readonly monto: number;
    readonly estado: VentaEstado;
    readonly tokenConfirmacion: string;
    readonly expiresAt?: string;
  };
  /** Un único timestamp para `created_at`/`updated_at` de las tres filas. */
  readonly timestamp: string;
}

export interface ConfirmarVentaConComisionInput {
  readonly ventaId: string;
  readonly comisionId: string;
  readonly comisionMonto: number;
  readonly periodo: string;
  /** Se usa como `confirmed_at`, como `created_at` de la comisión Y como el `@ahora` del predicado de expiración. Uno solo, a propósito (ADR 15). */
  readonly ahora: string;
}

export interface ConfirmacionAplicada {
  readonly venta: Venta;
  readonly comision: Comision;
}

/**
 * Salida hacia una persona. Implementado por `src/adapters/notificaciones/`,
 * inyectado desde el composition root.
 *
 * CONTRATO: **nunca rechaza y nunca lanza** — mismo contrato que
 * `ActivityBoardPort` (Hito 3) y `KnowledgeFeedbackPort` (Hito 2). Cualquier
 * falla (red, HTTP ≠ 2xx, timeout, sin API key) se traga adentro del
 * adaptador y sale como `{ enviado: false, motivo }`. La venta ya está
 * persistida; el aviso es best-effort (spec `venta-confirmacion`).
 *
 * UNA sola operación, no un `enviarEmail` genérico (ADR 18): el núcleo pide
 * "avisale al cliente que confirme esta venta" y no aprende que existe el
 * email como medio.
 */
export interface VentaNotifierPort {
  notificarLinkConfirmacion(input: {
    /** Destino. NO se persiste en ningún lado (ADR 18, punto 4). */
    readonly clienteEmail: string;
    readonly linkConfirmacion: string;
    readonly planNuevo: string;
    readonly monto: number;
    /** Correlación de logs, no dato de negocio — mismo criterio que el `casoId` de `ActivityBoardPort`. */
    readonly casoId: string;
  }): Promise<NotificacionResultado>;
}

export type NotificacionMotivo = "sin-api-key" | "sin-destinatario" | "http" | "network" | "timeout" | "unknown";

export type NotificacionResultado =
  | { readonly enviado: true }
  | { readonly enviado: false; readonly motivo: NotificacionMotivo };
```

### 3.2 `src/core/ventas/ventas-config.ts` (nuevo — ADR 17)

```ts
/**
 * Configuración de REGLAS DE NEGOCIO de ventas. Vive en el núcleo, no en un
 * adaptador (ADR 17a): el porcentaje de comisión y el umbral de reembolso son
 * parámetros del negocio, no del transporte HTTP que hoy los dispara.
 *
 * Por eso, y a diferencia de `resolveWebhookConfig`/`resolveBoardConfig`
 * (verificados), esta función:
 *  - NO hace `import "../config/env.js"` — no carga nada, no toca el mundo;
 *  - NO tiene default `= process.env` — el composition root le pasa el
 *    diccionario DESPUÉS de que `env.js` cargó `.env`;
 *  - NO lanza: devuelve un resultado discriminado con TODOS los errores
 *    juntos (ADR 17b).
 *
 * Es, literalmente, una función de un diccionario a un valor. Pura en el
 * sentido fuerte.
 */
export interface VentasConfig {
  /** Validado en `(0, 1]`. Spec `venta-confirmacion`: fuera de rango = error de arranque. */
  readonly comisionPorcentaje: number;
  /** Validado `> 0`. `monto < umbral` auto-aprueba; `>=` escala (spec `reembolso-evaluacion`). */
  readonly reembolsoUmbral: number;
  /** Horas. `0` = SIN vencimiento (`expires_at = NULL`) — el interruptor del ADR 10 de la propuesta. Default 72. */
  readonly tokenTtlHoras: number;
}

export const DEFAULT_COMISION_PORCENTAJE = 0.1;
export const DEFAULT_REEMBOLSO_UMBRAL = 500;
/** Seguro por defecto: sin configurar, el link vence en 3 días (R6). `0` desactiva la guarda explícitamente. */
export const DEFAULT_VENTA_TOKEN_TTL_HORAS = 72;

export type ResolveVentasConfigResult =
  | { readonly ok: true; readonly config: VentasConfig }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * | Env var | Campo | Default | Validación | Inválido |
 * |---|---|---|---|---|
 * | `COMISION_PORCENTAJE` | `comisionPorcentaje` | `0.1` | finito, `> 0`, `<= 1` | **ABORTA** |
 * | `REEMBOLSO_UMBRAL` | `reembolsoUmbral` | `500` | finito, `> 0` | **ABORTA** |
 * | `VENTA_TOKEN_TTL_HORAS` | `tokenTtlHoras` | `72` | entero finito, `>= 0` | **ABORTA** |
 *
 * Ausente o cadena vacía → default (no es un error: no configurar es un modo
 * válido). Presente pero inválido → error, con el nombre de la variable y el
 * valor recibido en el mensaje. Se acumulan TODOS antes de devolver.
 */
export function resolveVentasConfig(
  env: Readonly<Record<string, string | undefined>>,
): ResolveVentasConfigResult;
```

### 3.3 Funciones puras del dominio

#### `comision.ts`

```ts
/**
 * `monto × porcentaje`, redondeado a 2 decimales (ADR 16, regla 1).
 *
 * `Math.round(x * 100) / 100`, NO `toFixed` (devuelve string y arrastra la
 * representación del literal) ni `Intl` (formato, no aritmética).
 *
 * PRECONDICIONES, garantizadas por quien llama y no re-chequeadas acá:
 * `monto > 0` (lo valida el parseo del payload, §4.5) y `porcentaje ∈ (0, 1]`
 * (lo valida `resolveVentasConfig`, §3.2). Esta función no defiende contra
 * `NaN`: si llegara uno, la configuración inválida ya habría abortado el
 * arranque — que es exactamente lo que el spec pide en vez de un `NaN`
 * silencioso en una fila de comisiones.
 *
 * Casos borde con test propio: 1000 × 0.1 = 100 (no 100.00000000000001) ·
 * 0.05 × 0.1 = 0.01 (redondeo hacia arriba en el .005) · montos con más de
 * 2 decimales de entrada · porcentaje exactamente 1 (comisión = monto).
 */
export function calcularComision(monto: number, porcentaje: number): number;

/**
 * `'YYYY-MM'` a partir de un ISO-8601 UTC — `confirmedAt.slice(0, 7)`.
 *
 * Deliberadamente un `slice` y no `new Date(...).getMonth()`: `getMonth`
 * aplica la zona horaria de la máquina, así que una venta confirmada a las
 * 22:00 del 31 de enero caería en enero o en febrero según dónde corra el
 * proceso. Todos los timestamps de este repo son `new Date().toISOString()`
 * (UTC, ancho fijo), invariante que ADR 16 documenta y que estas tres
 * funciones asumen.
 *
 * Se llama con `confirmed_at`, NUNCA con `created_at` (spec + ADR 16).
 */
export function periodoDeConfirmacion(confirmedAt: string): string;
```

#### `reembolso.ts`

```ts
export const RESULTADO_REEMBOLSO_AUTO_APROBADO = "auto_aprobado";
export const RESULTADO_REEMBOLSO_ESCALADO = "escalado";
export type ResultadoReembolso =
  | typeof RESULTADO_REEMBOLSO_AUTO_APROBADO
  | typeof RESULTADO_REEMBOLSO_ESCALADO;

/**
 * La regla completa del spec `reembolso-evaluacion`, en una comparación:
 *
 *   monto  <  umbral  → auto_aprobado   (venta → 'reembolsada')
 *   monto >=  umbral  → escalado        (venta → 'reembolso_pendiente')
 *
 * El BORDE ESTÁ EN EL `>=`, no en el `>`: el spec dice "estrictamente menor"
 * para auto-aprobar y "mayor o igual" para escalar, así que `monto ===
 * umbral` ESCALA. Test dedicado para esa celda exacta — es el único lugar
 * del hito donde un `<=` en vez de un `<` cambia una decisión de plata.
 *
 * `monto` es SIEMPRE `venta.monto` completo: el reembolso es todo-o-nada
 * (spec, fuera de alcance del parcial).
 */
export function evaluarReembolso(monto: number, umbral: number): ResultadoReembolso;
```

#### `token-confirmacion.ts`

```ts
export const MOTIVO_TOKEN_INEXISTENTE = "inexistente";
export const MOTIVO_TOKEN_ESTADO_INVALIDO = "estado_invalido";
export const MOTIVO_TOKEN_VENCIDO = "vencido";
export type MotivoTokenInvalido =
  | typeof MOTIVO_TOKEN_INEXISTENTE
  | typeof MOTIVO_TOKEN_ESTADO_INVALIDO
  | typeof MOTIVO_TOKEN_VENCIDO;

export type ValidacionToken =
  | { readonly valido: true; readonly venta: Venta }
  | { readonly valido: false; readonly motivo: MotivoTokenInvalido };

/**
 * Las tres guardas del ADR 10 de la propuesta, en una función pura con
 * `ahora` INYECTADO — nunca `Date.now()` adentro (spec `venta-confirmacion`).
 *
 *  1. `venta === undefined`            → `inexistente`
 *  2. `venta.estado !== 'pendiente_confirmacion'` → `estado_invalido`
 *     (cubre reuso, doble click y venta ya rechazada — ADR 15)
 *  3. `expiresAt !== undefined && expiresAt <= ahora` → `vencido`
 *     Comparación LEXICOGRÁFICA de strings, correcta solo porque ambos son
 *     ISO-8601 UTC de ancho fijo (ADR 16, regla 3). `undefined` = sin
 *     vencimiento, y pasa.
 *
 * El `motivo` existe para el LOG, no para la respuesta: el spec exige que un
 * token vencido y uno inexistente produzcan una respuesta INDISTINGUIBLE
 * (R6). El handler HTTP descarta el motivo al renderizar y lo conserva al
 * loguear (§4.4, §9.2).
 *
 * La guarda 2 se REPITE dentro del `UPDATE` (ADR 15). No es redundancia
 * ociosa: acá decide la respuesta, allá garantiza la atomicidad. Se les pasa
 * el mismo `ahora`, así que no pueden discrepar.
 */
export function validarTokenConfirmacion(venta: Venta | undefined, ahora: string): ValidacionToken;

/**
 * `createdAt + ttlHoras` como ISO-8601 UTC, o `undefined` si `ttlHoras === 0`
 * (sin vencimiento — el interruptor de configuración del ADR 10 de la
 * propuesta, que evita tener que migrar para desactivar la guarda).
 *
 * `new Date(Date.parse(createdAt) + ttlHoras * 3_600_000).toISOString()`.
 */
export function calcularExpiresAt(createdAt: string, ttlHoras: number): string | undefined;
```

### 3.4 Casos de uso (orquestadores del núcleo)

Los tres son el análogo exacto de `run-activity-turn.ts` (Hito 3): reciben puertos por `deps`, no importan adaptadores, propagan lo que el store propague y **nunca** propagan lo que el notificador haga.

#### `registrar-venta.ts`

```ts
export interface RegistrarVentaDeps {
  readonly store: VentaStorePort;
  readonly notifier: VentaNotifierPort;
  readonly config: VentasConfig;
  /** `WEB_PUBLIC_URL` ya normalizada por el adaptador (sin `/` final). El núcleo la concatena, no la resuelve. */
  readonly baseUrlPublica: string;
  readonly newId: () => string;
  /** Token opaco de alta entropía: `randomUUID()` en producción (`node:crypto`, cero dependencias — ADR 10 punto 1). Inyectado para que el test sea determinista. */
  readonly newToken: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

export interface RegistrarVentaInput {
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  /** Solo para notificar. NO se persiste (ADR 18, punto 4). */
  readonly clienteEmail: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
}

export interface RegistrarVentaResult {
  readonly ventaId: string;
  readonly casoId: string;
  readonly linkConfirmacion: string;
  readonly notificado: boolean;
}

/**
 * Secuencia exacta:
 *  1. `timestamp = now()`, `token = newToken()`, `expiresAt =
 *     calcularExpiresAt(timestamp, config.tokenTtlHoras)`.
 *  2. `store.crearVentaConCaso({...})` — UNA transacción: upsert de
 *     `vendedores`, `caso` tipo `CASO_TIPO_VENTA` en `CASO_ESTADO_ACTIVO`, y
 *     la fila de `ventas` en `pendiente_confirmacion`. PROPAGA si falla: sin
 *     venta no hay nada que notificar. → `venta-creada`.
 *  3. `link = `${baseUrlPublica}/confirmar/${token}``.
 *  4. `await notifier.notificarLinkConfirmacion({...})` — NUNCA rechaza por
 *     contrato. → `email-enviado` | `email-omitido` (sin API key) |
 *     `email-fallido` (red/HTTP/timeout).
 *  5. Devuelve el resultado con `notificado` = `resultado.enviado`.
 *
 * CERO llamadas al modelo, cero `handleTurn`, cero SDK (spec
 * `venta-confirmacion`, escenario "Alta válida crea vendedor, caso y venta").
 *
 * El paso 4 va DESPUÉS de que la transacción cerró, a propósito: es el único
 * `await` de todo el camino determinista y no debe estar dentro de ninguna
 * ventana transaccional. Es también la razón literal por la que este hito no
 * necesita `createKeyedQueue()` (ADR 15).
 */
export function registrarVenta(
  input: RegistrarVentaInput,
  deps: RegistrarVentaDeps,
): Promise<RegistrarVentaResult>;
```

#### `confirmar-venta.ts`

```ts
export const DECISION_CONFIRMAR = "confirmar";
export const DECISION_RECHAZAR = "rechazar";
export type DecisionCliente = typeof DECISION_CONFIRMAR | typeof DECISION_RECHAZAR;

export interface ConfirmarVentaDeps {
  readonly store: VentaStorePort;
  readonly config: VentasConfig;
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

export type DecisionVentaResult =
  | { readonly resultado: "confirmada"; readonly comisionMonto: number; readonly periodo: string }
  | { readonly resultado: "rechazada" }
  /** Token inexistente, estado inválido, vencido, o CAS que no matcheó. Indistinguibles hacia afuera (R6). */
  | { readonly resultado: "no_aplicable"; readonly motivo: MotivoTokenInvalido | "carrera" };

/**
 * Secuencia exacta:
 *  1. `ahora = now()`.
 *  2. `venta = store.buscarVentaPorToken(token)`.
 *  3. `validarTokenConfirmacion(venta, ahora)` — si `!valido`, loguea
 *     `token-invalido` con `motivo` y devuelve `no_aplicable`. SIN efecto.
 *  4a. `decision === DECISION_RECHAZAR` → `store.rechazarVenta({ventaId,
 *      ahora})`. `undefined` → `no_aplicable` ("carrera"). Fila → `rechazada`.
 *      **Ninguna fila en `comisiones`** (spec, escenario "Rechazo no genera
 *      comisión"). → `venta-rechazada`.
 *  4b. `decision === DECISION_CONFIRMAR` →
 *      `comisionMonto = calcularComision(venta.monto, config.comisionPorcentaje)`,
 *      `periodo = periodoDeConfirmacion(ahora)`, y
 *      `store.confirmarVentaConComision({ventaId, comisionId: newId(),
 *      comisionMonto, periodo, ahora})`.
 *      `undefined` → `no_aplicable` ("carrera"), loguea
 *      `venta-confirmacion-ignorada`. Fila → `confirmada`, y se loguean
 *      `venta-confirmada` + `comision-calculada`.
 *
 * `ahora` se calcula UNA vez y se usa para todo — validación, `confirmed_at`,
 * `periodo`, `created_at` de la comisión y el predicado de expiración del
 * `UPDATE`. Un único instante para un único hecho: si el período se derivara
 * de un segundo `now()`, una confirmación exactamente a medianoche del 1 de
 * mes podría pagar en un período distinto del que dice `confirmed_at`.
 *
 * CERO llamadas al modelo en cualquiera de las ramas (spec, escenario
 * "Confirmar una venta no llama al modelo").
 */
export function resolverDecisionVenta(
  input: { readonly token: string; readonly decision: DecisionCliente },
  deps: ConfirmarVentaDeps,
): DecisionVentaResult;
```

> **`resolverDecisionVenta` es SÍNCRONA.** No devuelve una promesa, y eso no es un descuido: todo lo que hace es leer y escribir SQLite (síncrono) y llamar dos funciones puras. Que el tipo lo diga es la mejor documentación posible de que en este camino no hay ni puede haber un `await` — y por lo tanto ni carrera que una cola pudiera arreglar (ADR 15). El adaptador la envuelve en una promesa ya resuelta para uniformar la firma de los handlers.

#### `procesar-devolucion.ts`

```ts
export interface ProcesarDevolucionDeps {
  readonly store: VentaStorePort;
  readonly config: VentasConfig;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

export type DevolucionResult =
  | { readonly resultado: "reembolsada" }
  | { readonly resultado: "escalada" }
  | { readonly resultado: "no_aplicable" };

/**
 * Secuencia exacta:
 *  1. `venta = store.buscarVentaPorToken(token)` (ADR 19: el token de
 *     confirmación es la credencial de este camino).
 *  2. `venta === undefined` → `no_aplicable`, loguea `devolucion-rechazada`
 *     con `motivo: "token"`. **`expires_at` NO se evalúa acá** (ADR 19,
 *     punto 2): una devolución ocurre después de confirmar, potencialmente
 *     meses después.
 *  3. `venta.estado !== VENTA_ESTADO_CONFIRMADA` → `no_aplicable`, loguea
 *     `devolucion-rechazada` con `motivo: "estado"` y el estado real. SIN
 *     efecto (spec, escenario "Devolución sobre venta no confirmada").
 *  4. `evaluarReembolso(venta.monto, config.reembolsoUmbral)`:
 *     - `auto_aprobado` → `store.aprobarReembolso({ventaId, ahora})`.
 *       `undefined` → `no_aplicable`. Fila → `reembolsada`. **No se crea
 *       ninguna escalación** y **la fila de `comisiones` NO se toca** (spec,
 *       escenario "Comisión ya pagada permanece tras un reembolso
 *       aprobado"). → `reembolso-aprobado`.
 *     - `escalado` → `store.escalarReembolso({ventaId, casoId: venta.casoId,
 *       ahora})`: venta → `reembolso_pendiente` Y `caso` →
 *       `pendiente_aprobacion_humana`, MISMA transacción (ADR 11, punto 2).
 *       **NINGÚN camino de este módulo mueve la venta a `reembolsada` desde
 *       `reembolso_pendiente`** — eso es el ADR 11 punto 3 y el spec
 *       "Cierre de la escalación fuera de alcance". → `reembolso-escalado`.
 *
 * SÍNCRONA, por la misma razón que `resolverDecisionVenta`.
 * CERO llamadas al modelo (spec, escenario "Evaluación no llama al modelo").
 */
export function procesarDevolucion(
  input: { readonly token: string; readonly motivo?: string },
  deps: ProcesarDevolucionDeps,
): DevolucionResult;
```

### 3.5 `reporte.ts` — agregación y formato, ambos puros (ADR 9 de la propuesta)

```ts
/** Fila de comisión ya cruzada con su venta, tal como la lectura SQL la entrega (§6.2). */
export interface ComisionConVenta {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly comisionMonto: number;
  readonly ventaMonto: number;
  /** Estado ACTUAL de la venta. Va en el reporte a propósito: es lo que hace VISIBLE la inconsistencia de R5 (una venta reembolsada cuya comisión sigue viva) en vez de esconderla. */
  readonly ventaEstado: string;
  readonly periodo: string;
}

export interface VentaPendienteReembolso {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  readonly monto: number;
  readonly casoId: string;
  readonly confirmedAt?: string;
}

export interface FilaVendedor {
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly ventasConfirmadas: number;
  readonly montoVendido: number;
  readonly totalComisionado: number;
  /** Cuántas de esas ventas están hoy `reembolsada` o `reembolso_pendiente` — la columna que hace medible R5. */
  readonly ventasConReembolso: number;
}

export interface ReporteMensual {
  readonly periodo: string;
  readonly filas: readonly FilaVendedor[];
  readonly totalComisionado: number;
  readonly reembolsosPendientes: readonly VentaPendienteReembolso[];
}

/**
 * Agrupa por `vendedor_id` dentro de un `periodo`. PURA: sin base, sin red,
 * sin reloj (spec `reporte-comisiones-mensual`, "testeable sin base de datos
 * ni red").
 *
 * Reglas:
 *  - Solo entran comisiones cuyo `periodo` coincide con el pedido. Filtrar
 *    acá y no solo en el SQL hace la función total y testeable con una lista
 *    mezclada.
 *  - `totalComisionado` se redondea a 2 decimales con la MISMA regla de
 *    `calcularComision` (ADR 16): sumar 30 floats y no redondear devolvería
 *    la basura de punto flotante al reporte, que es justo lo que R8 acota.
 *  - Orden: `totalComisionado` DESC, desempate por `vendedorId` ASC. El
 *    desempate existe para que la salida sea DETERMINISTA y el test pueda
 *    afirmar el string completo.
 *  - `reembolsosPendientes` pasa TAL CUAL, sin filtrar por `periodo`: el spec
 *    lo pide explícitamente ("independientemente de su `periodo` de
 *    confirmación"). Una escalación abierta no debe desaparecer del reporte
 *    porque cambió el mes.
 */
export function agruparReporteMensual(input: {
  readonly periodo: string;
  readonly comisiones: readonly ComisionConVenta[];
  readonly reembolsosPendientes: readonly VentaPendienteReembolso[];
}): ReporteMensual;

/**
 * Reporte a texto plano de ancho fijo. PURA — `string` adentro, `string`
 * afuera; quien lo imprime es `src/reporte-mensual.ts` (§6.5).
 *
 * Tres bloques, en este orden:
 *  1. Encabezado con el `periodo`.
 *  2. Tabla comparativa por vendedor (las 5 columnas de `FilaVendedor`) y la
 *     línea de total.
 *  3. **Reembolsos pendientes de aprobación** — con la nota literal de que
 *     este hito no expone camino de producto para cerrarlos y que la
 *     resolución es fuera de banda hasta Hito 5 (ADR 11 punto 5, R3). La
 *     limitación se imprime EN el reporte, no solo en un documento de diseño:
 *     quien lo corra a fin de mes tiene que ver por qué esa lista no se vacía
 *     sola.
 *  4. Si no hay comisiones en el período: línea explícita "sin comisiones en
 *     el periodo", nunca una tabla vacía sin explicación.
 */
export function formatearReporteMensual(reporte: ReporteMensual): string;
```

### 3.6 `soporte-prompt.ts` — el único módulo de este bloque que alimenta al modelo

```ts
export const MAX_SOPORTE_CONSULTA_CHARS = 4_000;

/**
 * Prompt sintético para el turno de soporte — mismo rol que
 * `buildActivityPrompt` en Hito 3, y por la misma razón: el framing vive acá
 * y NO en el system prompt de `CONVERSATIONAL_AGENT` (`definitions.ts`, que
 * este hito NO toca, spec `soporte-web-turno`). Cambiar ese system prompt
 * contaminaría los turnos de la TUI; un segundo `AgentDefinition` obligaría a
 * bifurcar el Selector de Turno.
 *
 * PURA: mismo input, mismo string. Estructura:
 *  1. Rol ("Sos el agente de soporte al cliente de este producto...").
 *  2. La consulta del cliente, truncada a `MAX_SOPORTE_CONSULTA_CHARS` con
 *     marca `[…truncado]`.
 *  3. LIMITACIÓN DECLARADA: el agente NO tiene acceso a la cuenta del
 *     cliente, ni a sus ventas, ni puede confirmar, cancelar o reembolsar
 *     nada. Esto es literal y es de seguridad, no de estilo: sin esa línea,
 *     un modelo servicial le dice al cliente "listo, te cancelé la venta",
 *     y la venta sigue igual. El camino del dinero es determinista (ADR 7 de
 *     la propuesta) y el agente conversacional no lo toca.
 *  4. Instrucción de derivar a un humano cuando la consulta requiera una
 *     acción sobre la cuenta.
 *
 * `clienteId` NO entra al prompt: es un identificador opaco sin significado
 * para el modelo, y mandarlo solo agregaría un dato sin uso al contexto.
 */
export function buildSoportePrompt(consulta: string): string;
```

---

## 4. Adaptador Web (entrante) — `src/adapters/web/`

Siete archivos + tests colocados. **No importa** memoria, agentes, notificaciones, ni `src/adapters/webhooks/` (ADR 13); solo `ventas-contract.js` (tipos) y el logger.

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `config.ts` | `WebConfig`, `resolveWebConfig`, `isWebEnabled`, defaults | env → config tipada. Pura. |
| `http.ts` | `WebRequest`, `WebResponse`, `WebHttpServerLike`, `CreateWebServerFn` | Recortes estructurales de `node:http` (ADR 13). Solo tipos. |
| `body.ts` | `leerBody`, `parseJsonBody`, `parseFormBody` | Acumulación con tope, JSON y `application/x-www-form-urlencoded`. |
| `payloads.ts` | `parseAltaVentaPayload`, `parseDevolucionPayload`, `parseSoportePayload`, `parseDecisionForm` | `unknown` → input tipado o motivo. Puras. |
| `render.ts` | `renderConfirmacionHtml`, `renderResultadoHtml`, `renderLinkInvalidoHtml`, `escapeHtml` | HTML por función pura (ADR 20). |
| `server.ts` | `createRequestListener`, `startServer`, `WebServerDeps`, `WebServerHandle` | Ruteo, auth, drenaje, tabla de respuestas. |
| `index.ts` | `startWebServer`, `WebAdapter` | Fachada. Lo único que importa el composition root. |

### 4.1 `config.ts`

```ts
import "../../core/config/env.js";

/**
 * Side-effect import: mismo criterio que `adapters/webhooks/config.ts` y
 * `adapters/board/config.ts` (verificados). Este módulo SÍ lo hace, a
 * diferencia de `core/ventas/ventas-config.ts` (ADR 17a): acá estamos en un
 * adaptador y leer `process.env` es su trabajo.
 */
export interface WebConfig {
  /** `0` = adaptador DESHABILITADO: no se abre ningún puerto (spec `venta-confirmacion`, req. 1). */
  readonly port: number;
  /** Base pública para armar el link. Sin `/` final (se normaliza). */
  readonly publicUrl: string;
  /** `""` = `POST /ventas` responde 401 SIEMPRE. Nunca "abierta por defecto" (propuesta, *Approach*). */
  readonly ventasApiToken: string;
  readonly maxBodyBytes: number;
}

export const DEFAULT_WEB_PUBLIC_URL = "http://localhost:8080";
/** 64 KiB. Un décimosexto del tope del webhook (1 MiB) porque acá los payloads son 6 campos y una consulta de texto, no un evento de GitHub. */
export const DEFAULT_WEB_MAX_BODY_BYTES = 65_536;
/** Techo del drenaje de turnos de soporte en vuelo al cerrar (ADR 14, punto 4). Constante, no env var. */
export const WEB_CLOSE_TIMEOUT_MS = 5_000;
/** Techo de un turno de soporte antes de responder 504 (ADR 14, punto 3). Constante: presupuesto de UX. */
export const SOPORTE_TIMEOUT_MS = 120_000;
/** Correlación de eventos de ciclo de vida del proceso, sin `requestId` natural. Análogo de `WEBHOOK_LOG_CORRELATION_ID`. */
export const WEB_LOG_CORRELATION_ID = "web-adapter";

export const RUTA_VENTAS = "/ventas";
export const RUTA_CONFIRMAR_PREFIJO = "/confirmar/";
export const RUTA_DEVOLUCION = "/devolucion";
export const RUTA_SOPORTE = "/soporte";

/**
 * Pura, `env` con default `process.env` — mismo patrón que
 * `resolveWebhookConfig`. NUNCA lanza: la ausencia de `WEB_PORT` es un modo
 * de operación válido, no un error (a diferencia de `resolveVentasConfig`,
 * ADR 17).
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `WEB_PORT` | `port` | `0` (deshabilitado) |
 * | `WEB_PUBLIC_URL` | `publicUrl` | `DEFAULT_WEB_PUBLIC_URL`, sin `/` final |
 * | `VENTAS_API_TOKEN` | `ventasApiToken` | `""` (ruta `/ventas` siempre 401) |
 * | `WEB_MAX_BODY_BYTES` | `maxBodyBytes` | `DEFAULT_WEB_MAX_BODY_BYTES` |
 *
 * `WEB_PORT` ausente/vacío/no numérico/≤ 0 → `0`. NO cae a un puerto por
 * defecto, a diferencia de `WEBHOOK_PORT`: en el webhook el gate es el
 * secreto y el puerto tiene default; acá el gate ES el puerto (ADR 5 de Hito
 * 3, mismo criterio opt-in con otra llave), así que un default lo rompería.
 */
export function resolveWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig;

/** `config.port > 0`. Único gate del listener. */
export function isWebEnabled(config: WebConfig): boolean;
```

### 4.2 `http.ts` — recortes estructurales (ADR 13)

```ts
/**
 * Recortes estructurales de `http.IncomingMessage` / `http.ServerResponse`,
 * mismo truco que `RenderTui` sobre el `render` de Ink y `QueryFn` sobre el
 * `query` del SDK: los tipos reales de `node:http` los satisfacen
 * estructuralmente, así producción pasa los objetos reales y los tests pasan
 * dobles planos SIN abrir ningún puerto ni mockear `node:http`.
 *
 * DUPLICADOS a propósito de `src/adapters/webhooks/server.ts:30-55` — ver
 * ADR 13. Importarlos de ahí sería un adaptador dependiendo de otro; moverlos
 * a `src/core/` metería HTTP en el vocabulario del núcleo para siempre. Si
 * aparece un TERCER adaptador HTTP entrante, ese es el disparador para
 * reconsiderar.
 *
 * Diferencia real con la versión de webhooks, no cosmética: acá `WebResponse`
 * necesita `writeHead`-equivalente con varios headers (`Content-Type`,
 * `Cache-Control`, `Referrer-Policy`, `X-Request-Id` — ADR 20 punto 5), así
 * que `setHeader` se usa más de una vez por respuesta.
 */
export interface WebRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface WebResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface WebHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateWebServerFn = (
  listener: (req: WebRequest, res: WebResponse) => void,
) => WebHttpServerLike;
```

### 4.3 `body.ts` y `payloads.ts` — entrada no confiable

`leerBody(req, maxBodyBytes)` es el mismo mecanismo que el ADR 9 de Hito 3 fijó y que `webhooks/server.ts:159-182` ya implementa (verificado), reimplementado acá por ADR 13: acumulación en `Buffer[]` con contador incremental, corte en `maxBodyBytes` **antes** de guardar el chunk, `413` + `req.destroy()`, y `req.on("error")` → `400`. Diferencias de este hito:

- **No hay firma que verificar**, así que no hay orden "tope → HMAC → parse" que respetar; el orden es `tope → auth (solo /ventas) → parse`.
- El corte devuelve un resultado discriminado (`{ ok: true, body } | { ok: false, motivo: "tamano" | "error-transporte" }`) en vez de escribir la respuesta adentro: quien decide el status es el ruteador, que sabe si la ruta responde HTML o JSON.

`payloads.ts` traduce `unknown` a inputs tipados con **type guards a mano**, sin `zod` — aunque `zod` está en `dependencies` (verificado). Motivo: son 6, 2 y 2 campos respectivamente, y necesitamos un `motivo` en castellano y estable para el `400` que ve la integración del vendedor; un schema agregaría indirección y mensajes genéricos. Mismo criterio que `github-mapper.ts` documenta hoy, con la diferencia de que allá todo camino inválido colapsa en `undefined` y acá **sí** queremos distinguir el motivo.

```ts
export type ParseResult<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly motivo: string };

/**
 * `{ vendedorId, vendedorNombre, clienteId, clienteEmail, planAnterior?,
 *    planNuevo, monto }`.
 *
 * Validaciones, cada una con su `motivo`:
 *  - strings requeridos: presentes, `typeof === "string"`, no vacíos tras
 *    `trim()`, y bajo un tope de largo (256; `clienteId` es opaco pero no
 *    ilimitado — R9 se cierra por alcance, no por credulidad).
 *  - `monto`: `typeof === "number"`, `Number.isFinite`, `> 0`. Un `monto`
 *    como string NO se coerce: una integración que manda `"1000"` tiene un
 *    bug y merece un 400, no una comisión calculada sobre una coerción.
 *  - `planAnterior`: opcional; si viene debe ser string no vacío.
 *  - `clienteEmail`: presente y no vacío. NO se valida contra un regex de
 *    email — validar emails con regex es una trampa clásica y el proveedor
 *    de email ya rechaza los inválidos; su fallo degrada a
 *    `email-fallido`, que es exactamente el camino que el spec pide.
 */
export function parseAltaVentaPayload(payload: unknown): ParseResult<RegistrarVentaInput>;

/** `{ token, motivo? }` (ADR 19). `motivo` opcional, recortado a 500 chars, nunca persistido. */
export function parseDevolucionPayload(payload: unknown): ParseResult<{ token: string; motivo?: string }>;

/** `{ consulta }`. `consulta` string no vacío; el truncado real lo hace `buildSoportePrompt`. */
export function parseSoportePayload(payload: unknown): ParseResult<{ consulta: string }>;

/**
 * `application/x-www-form-urlencoded` del formulario HTML:
 * `decision=confirmar|rechazar`. Cualquier otro valor → `{ ok: false }`, que
 * el ruteador convierte en la MISMA página genérica que un token inválido
 * (R6: sin oráculos).
 */
export function parseDecisionForm(campos: URLSearchParams): ParseResult<DecisionCliente>;
```

### 4.4 `server.ts` — ruteo, auth y tabla de respuestas

```ts
export interface WebServerDeps {
  readonly config: WebConfig;
  /** Los cinco handlers del ADR 12, ya cerrados sobre sus dependencias por el composition root. */
  readonly onAltaVenta: (input: RegistrarVentaInput) => Promise<RegistrarVentaResult>;
  readonly onConsultaVenta: (token: string) => Promise<VentaPublica | undefined>;
  readonly onDecisionVenta: (input: { token: string; decision: DecisionCliente }) => Promise<DecisionVentaResult>;
  readonly onDevolucion: (input: { token: string; motivo?: string }) => Promise<DevolucionResult>;
  readonly onSoporte: (input: { consulta: string }) => Promise<SoporteResult>;
  readonly logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** `randomUUID` en producción; contador determinista en tests. Ver §9.1. */
  readonly newRequestId?: () => string;
}
```

**Tabla de respuestas — EXHAUSTIVA.** El orden de checks es `método+ruta → tope de body → auth (solo `/ventas`) → parseo → handler`, y no se reordena.

| Ruta | Método | Condición | Status | Cuerpo | Evento |
|---|---|---|---|---|---|
| cualquiera | cualquiera | ruta no reconocida | `404` | vacío | — |
| `/ventas` | `POST` | `ventasApiToken === ""` o header no coincide | `401` | JSON `{error}` | `web-no-autorizado` |
| `/ventas` | `POST` | body > tope | `413` | vacío + `destroy()` | `web-rechazado-tamano` |
| `/ventas` | `POST` | JSON roto o payload inválido | `400` | JSON `{error: motivo}` | `web-payload-invalido` |
| `/ventas` | `POST` | ok | `201` | JSON `{ventaId, casoId, linkConfirmacion, notificado}` | `venta-creada` (+ email-*) |
| `/ventas` | `POST` | el store lanzó | `500` | JSON `{error}` genérico | `web-handler-fallido` |
| `/confirmar/:token` | `GET` | token resuelve a venta pendiente | `200` | HTML formulario | `venta-consultada` |
| `/confirmar/:token` | `GET` | inexistente / vencida / no pendiente | `404` | **HTML genérico idéntico** | `token-invalido` |
| `/confirmar/:token` | `POST` | `decision=confirmar`, CAS aplicó | `200` | HTML "confirmada" | `venta-confirmada` + `comision-calculada` |
| `/confirmar/:token` | `POST` | `decision=rechazar`, CAS aplicó | `200` | HTML "rechazada" | `venta-rechazada` |
| `/confirmar/:token` | `POST` | inexistente / vencida / ya procesada / CAS no aplicó / `decision` inválida | `404` | **HTML genérico idéntico** | `token-invalido` \| `venta-confirmacion-ignorada` |
| `/devolucion` | `POST` | bajo umbral | `200` | JSON `{resultado:"reembolsada"}` | `reembolso-aprobado` |
| `/devolucion` | `POST` | sobre o igual al umbral | `200` | JSON `{resultado:"escalada"}` | `reembolso-escalado` |
| `/devolucion` | `POST` | token desconocido / venta no `confirmada` | `404` | **JSON genérico idéntico** | `devolucion-rechazada` |
| `/soporte` | `POST` | turno resuelto | `200` | JSON `{casoId, respuesta}` | `soporte-caso-creado` + los de `handleTurn` |
| `/soporte` | `POST` | turno excedió `SOPORTE_TIMEOUT_MS` | `504` | JSON `{error}` | `soporte-timeout` |
| `/soporte` | `POST` | `handleTurn` rechazó | `502` | JSON `{error}` genérico | `soporte-turno-fallido` |

**Las cuatro filas en negrita son el requisito de indistinguibilidad** (spec `venta-confirmacion`, escenario "Token vencido rechazado sin efecto"; R6). Misma página, mismo status, mismo `Content-Type`, y **sin diferencia de tiempo observable** — las tres validaciones cuestan una lectura indexada. La distinción vive **solo** en el log del servidor, vía el `motivo` que `validarTokenConfirmacion` devuelve.

**Trade-off aceptado**: un cliente que hace doble click ve "link no válido" en vez de "ya confirmaste esta venta". Es peor UX a cambio de no darle a un atacante un oráculo que distinga "token que existió" de "token que nunca existió". Si el checkpoint prefiere la UX, la mitigación es mostrar el mensaje específico **solo** para `estado_invalido` — pero eso reabre el oráculo, y por eso no es el default.

**Autenticación de `/ventas`**: header `Authorization: Bearer <VENTAS_API_TOKEN>`, comparado con `timingSafeEqual` sobre `Buffer.from(x, "utf8")` **con chequeo de longitud previo** — `timingSafeEqual` lanza `RangeError` con buffers de largo distinto, exactamente la trampa que `signature.ts` de Hito 3 ya documenta (verificado). Con `ventasApiToken === ""` se responde `401` **sin comparar nada**: nunca "abierta por defecto".

**Extracción del token de la ruta**: `path.slice(RUTA_CONFIRMAR_PREFIJO.length)`, luego `decodeURIComponent`, y se rechaza (misma página genérica) si queda vacío, contiene `/`, o excede 200 caracteres. Un `decodeURIComponent` con una secuencia `%` inválida lanza `URIError`: va envuelto en `try`, y el `catch` cae en la misma página genérica.

**Query string**: `req.url` se recorta en el primer `?`, igual que `pathFromUrl` en `webhooks/server.ts:92-98` (verificado) — un proxy de forwarding puede agregar una.

`startServer(deps, createServer = <node:http real>)` es idéntico en forma a `webhooks/server.ts:254`: `listen` + `on("error")` con promesa, `Set<Promise<void>>` de turnos de soporte en vuelo, y `close()` que hace `server.close()` → `Promise.allSettled([...enVuelo])` en carrera contra `WEB_CLOSE_TIMEOUT_MS` → resuelve. **Nunca rechaza.**

### 4.5 `render.ts` — HTML por función pura (ADR 20)

```ts
/** `&`, `<`, `>`, `"`, `'` → entidades. Aplicado a TODO valor dinámico (ADR 20, punto 2). */
export function escapeHtml(texto: string): string;

/**
 * Página de confirmación: detalle de la venta (plan anterior si existe, plan
 * nuevo, monto) y UN formulario con DOS botones `submit` que comparten
 * `name="decision"` y difieren en `value` (`confirmar` / `rechazar`).
 *
 * `action="/confirmar/${encodeURIComponent(token)}"` — `encodeURIComponent`,
 * NO `escapeHtml`: es un contexto de URL, no de texto (ADR 20, punto 3).
 * `method="post"`.
 *
 * `venta` es `VentaPublica`: sin token, sin `caso_id`, sin `cliente_id`. Lo
 * que no se le pasa a esta función no puede filtrarse a la página.
 */
export function renderConfirmacionHtml(venta: VentaPublica, token: string): string;

/** Página de resultado: "confirmada" o "rechazada", sin montos de comisión (el cliente no tiene por qué ver cuánto cobra el vendedor). */
export function renderResultadoHtml(resultado: "confirmada" | "rechazada"): string;

/**
 * LA página genérica. Un solo texto para inexistente, vencido, ya procesado y
 * decisión inválida. Sin ningún dato del servidor adentro — no tiene
 * parámetros a propósito: una función sin entrada no puede filtrar nada.
 */
export function renderLinkInvalidoHtml(): string;
```

Headers de toda respuesta HTML (ADR 20, punto 5): `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Request-Id: <requestId>`.

### 4.6 `index.ts` (fachada)

```ts
export interface WebAdapter {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Molde exacto de `startWebhookServer` (`adapters/webhooks/index.ts:51`,
 * verificado), con la misma semántica de `undefined`:
 *
 * Devuelve `undefined` cuando `!isWebEnabled(config)` — NO se abre ningún
 * puerto, se emite `web-deshabilitado`, y el proceso arranca idéntico a
 * `v1.2.0` (spec `venta-confirmacion`, req. 1). `undefined` y no un no-op con
 * `close()` vacío, por la misma razón que documenta el adaptador de webhooks:
 * `main.ts` tiene que distinguir "no hay nada que cerrar" de "hay algo que
 * cerrar" en su `finally`.
 *
 * Un `listen` que rechaza (`EADDRINUSE`) se PROPAGA — quien decide si eso
 * aborta el arranque es el composition root, igual que con webhooks.
 */
export function startWebServer(deps: {
  /* los 5 handlers + logEvent, config? y createServer? opcionales */
}): Promise<WebAdapter | undefined>;
```

---

## 5. Adaptador de Notificaciones (saliente) — `src/adapters/notificaciones/`

Tres archivos + tests. Calcado de `src/adapters/board/` (verificado): `config.ts` con gate por ausencia de credencial, un cliente con `fetchFn` inyectable, y una fachada que devuelve el puerto real o el no-op.

### 5.1 `config.ts`

```ts
import "../../core/config/env.js";

export interface NotificacionesConfig {
  /** `""` = adaptador DESHABILITADO → no-op que loguea el link (spec `venta-confirmacion`). */
  readonly apiKey: string;
  readonly from: string;
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
}

/** Resend. Un segundo proveedor cambia esta URL Y la forma del cuerpo — ver ADR 18, punto 3. */
export const DEFAULT_EMAIL_API_URL = "https://api.resend.com/emails";
export const DEFAULT_EMAIL_TIMEOUT_MS = 10_000;
export const DEFAULT_EMAIL_FROM = "arnes@localhost";

/**
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `EMAIL_API_KEY` | `apiKey` | `""` (deshabilitado) |
 * | `EMAIL_FROM` | `from` | `DEFAULT_EMAIL_FROM` |
 * | `EMAIL_API_URL` | `apiUrl` | `DEFAULT_EMAIL_API_URL` |
 * | `EMAIL_TIMEOUT_MS` | `requestTimeoutMs` | `DEFAULT_EMAIL_TIMEOUT_MS` |
 *
 * Pura, nunca lanza, numéricos inválidos al default — mismas reglas que
 * `resolveBoardConfig`.
 */
export function resolveNotificacionesConfig(env: NodeJS.ProcessEnv = process.env): NotificacionesConfig;

/** `config.apiKey.trim() !== ""`. Único gate. */
export function isNotificacionesEnabled(config: NotificacionesConfig): boolean;
```

### 5.2 `email-client.ts`

```ts
/** Recorte estructural de `fetch` — el global real (Node 20+, `engines` ya en `>=20`, verificado) lo satisface. EL seam de los tests. */
export type FetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export type EmailFailureReason = "network" | "timeout" | "http" | "unknown";

/** Mismo rol que `GithubApiError`: traduce la falla cruda al vocabulario del adaptador. NUNCA cruza la frontera del puerto. */
export class EmailApiError extends Error {
  readonly reason: EmailFailureReason;
  readonly status?: number;
}

/**
 * Única función que habla HTTP. Copia deliberada de `githubRequest`
 * (`adapters/board/github-client.ts:102`, verificado), incluidas sus
 * decisiones:
 *  - `Authorization: Bearer <apiKey>`, `Content-Type: application/json`.
 *  - `AbortSignal.timeout(config.requestTimeoutMs)`; `error.name ===
 *    "TimeoutError"` distingue timeout de error de red.
 *  - `!response.ok` → `EmailApiError("http", ..., { status })`, con el cuerpo
 *    de error del proveedor RECORTADO en el mensaje y **la API key jamás en
 *    ningún mensaje ni log**.
 *  - Sin reintentos, sin backoff: un email por venta no lo justifica, y el
 *    contrato del puerto ya es best-effort.
 *  - **No parsea la respuesta.** A diferencia de `githubRequest`, que
 *    devuelve JSON porque el llamador necesita el cuerpo, acá lo único que
 *    importa es si salió o no. Menos superficie para romperse contra un
 *    proveedor que cambie su formato de respuesta.
 *
 * Cuerpo enviado: `{ from, to, subject, html }` — la forma de Resend, dicha
 * con todas las letras en ADR 18 en vez de fingir neutralidad.
 */
export function enviarEmail(input: {
  readonly mensaje: { readonly to: string; readonly subject: string; readonly html: string };
  readonly config: NotificacionesConfig;
  readonly fetchFn: FetchFn;
}): Promise<void>;
```

### 5.3 `index.ts` — la implementación del puerto

```ts
type LogEvent = (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/**
 * Puerto no-op — degradación sin `EMAIL_API_KEY` (spec `venta-confirmacion`,
 * escenario "Sin `EMAIL_API_KEY` configurada"). Molde exacto de
 * `createNoopBoardAdapter` (`adapters/board/index.ts:22`, verificado).
 *
 * Loguea `email-omitido` CON EL LINK COMPLETO y devuelve
 * `{ enviado: false, motivo: "sin-api-key" }`. El link en el log es
 * deliberado: el objetivo declarado de esta degradación es que la demo y el
 * suite completo funcionen con cero cuentas externas, y para eso el link
 * tiene que ser recuperable. Consecuencia declarada (R17):
 * `data/harness.log` contiene links de confirmación válidos cuando el
 * notificador está degradado.
 */
export function createNoopNotificador(logEvent: LogEvent): VentaNotifierPort;

/**
 * Puerto real. `try/catch` TOTAL alrededor de `enviarEmail`: cualquier
 * `EmailApiError` o throw inesperado se traduce a `{ enviado: false, motivo }`
 * y se loguea `email-fallido` con `reason` y `status?`. **Nunca rechaza,
 * nunca lanza** (contrato del puerto, §3.1).
 *
 * `clienteEmail` vacío → `{ enviado: false, motivo: "sin-destinatario" }` sin
 * llamar a `fetchFn`: no se le pide al proveedor que rechace lo que ya
 * sabemos que está mal.
 *
 * Arma el asunto y el HTML del email ACÁ (ADR 18, punto 1): el núcleo pidió
 * "avisale al cliente que confirme esta venta" y no sabe que existe el email.
 * El HTML del mail usa el mismo `escapeHtml`... **no**: `render.ts` vive en
 * el adaptador web y este es otro adaptador (ADR 13 otra vez). Este módulo
 * tiene su propio escapado local de 6 líneas, o compone el cuerpo del mail
 * como TEXTO PLANO con el link, que es lo que este diseño elige — un email de
 * confirmación con una línea y un link no necesita HTML, y así no hay nada
 * que escapar.
 *
 * NUNCA se loguea `clienteEmail` (PII, y `data/harness.log` no tiene control
 * de acceso — mismo criterio con el que Hito 2 loguea `questionLength` y no
 * `question`).
 */
export function createNotificadorAdapter(deps: {
  readonly config?: NotificacionesConfig;
  readonly fetchFn?: FetchFn;
  readonly logEvent: LogEvent;
}): VentaNotifierPort;
```

---

## 6. Memoria y composition root

### 6.1 Migración `migrations/0004_vendedores_ventas_comisiones.ts` (nueva)

SQL **literal del plan** (`docs/Plan_Implementacion_Harness_Empresarial.md:233-262`, verificado) con el estilo `IF NOT EXISTS` de `0001`/`0003`, más **una** desviación: la columna `expires_at` (ADR 10 de la propuesta).

```ts
/**
 * Esquema de ventas y comisiones (Hito 4). `ventas` se liga a `casos`
 * (Hito 1) por `caso_id` — no se reinventa la correlación, y ese mismo
 * `caso_id` es el handle de la escalación de reembolso (ADR 11 de la
 * propuesta), por eso no hace falta ninguna tabla ni columna nueva para el
 * HITL.
 *
 * DESVIACIÓN ÚNICA respecto del SQL del plan: `expires_at TEXT` (nullable) en
 * `ventas`. ADR 10 de la propuesta: el chequeo de estado cubre el replay, la
 * expiración cubre el link viejo-pero-válido reenviado desde una bandeja de
 * entrada; ninguna sustituye a la otra. Nullable a propósito, para que la
 * guarda se pueda desactivar por configuración (`VENTA_TOKEN_TTL_HORAS=0`)
 * sin migrar nada. La tabla se crea POR PRIMERA VEZ acá: no hay datos que
 * migrar ni consumidores que reconciliar. **Requiere aprobación explícita del
 * checkpoint humano.**
 *
 * `estado` queda TEXT abierto, SIN CHECK — mismo criterio que `repository.ts`
 * documenta para `casos.estado` ("intentionally an open string, not an enum")
 * y que 0003 repitió para `actividades`. Es lo que hace que el quinto valor
 * `'reembolso_pendiente'` (ADR 11) sea legal sin tocar el esquema. La lista
 * canónica vive en `core/ventas/ventas-contract.ts`.
 *
 * `cliente_id TEXT NOT NULL` SIN tabla y SIN FK — la única columna del
 * proyecto con ese tratamiento, tal como el plan la dejó, y la señal es
 * deliberada: identificador OPACO, sin gestión de clientes (R9, fuera de
 * alcance). El email del cliente NO tiene columna y NO se persiste (ADR 18).
 *
 * `monto REAL` se conserva del plan pese a R8 (punto flotante para dinero):
 * el redondeo explícito a 2 decimales vive en `calcularComision` (ADR 16) y
 * migrar a enteros de centavos sería una SEGUNDA desviación. Deuda
 * documentada.
 *
 * Todos los timestamps son ISO-8601 UTC (`new Date().toISOString()`).
 * `expires_at` se COMPARA lexicográficamente en SQL (§6.2), lo cual es
 * correcto SOLO por ese invariante — ADR 16, regla 3.
 */
export const migration0004VendedoresVentasComisiones = {
  id: "0004_vendedores_ventas_comisiones",
  sql: `
CREATE TABLE IF NOT EXISTS vendedores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  cliente_id TEXT NOT NULL,
  plan_anterior TEXT,
  plan_nuevo TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  token_confirmacion TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON ventas(vendedor_id);

CREATE TABLE IF NOT EXISTS comisiones (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  monto REAL NOT NULL,
  periodo TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comisiones_periodo ON comisiones(periodo);
`,
};
```

Y en `migrations/index.ts`, **append** — nunca editar ni reordenar entradas ya commiteadas, regla que ese archivo documenta (verificado):

```ts
export const migrations: readonly Migration[] = [
  migration0001CasosSesionesAgente,
  migration0002IdxSesionesCasoAgente,
  migration0003ProyectosResponsablesActividades,
  migration0004VendedoresVentasComisiones,
];
```

**Índices — lo que hay y lo que deliberadamente no**:

- `token_confirmacion TEXT NOT NULL UNIQUE` crea un índice **implícito**. `buscarVentaPorToken` — la lectura del camino más caliente del hito, y la única que un atacante podría martillar (R6) — queda indexada **sin agregar nada al SQL del plan**. Vale decirlo porque parece que falta un índice y no falta.
- `idx_ventas_vendedor` e `idx_comisiones_periodo`: los dos del plan, tal cual.
- **Sin `idx_ventas_estado`**, a propósito, aunque el reporte filtra por `estado = 'reembolso_pendiente'`. Mismo criterio que Hito 3 usó para no crear el índice compuesto de `actividades`: sería medible recién con decenas de miles de ventas, y un scan sobre una tabla de demo cuesta microsegundos. Si hace falta, entra como `0005` — aditivo, sin migrar datos.
- **Sin `UNIQUE (venta_id)` en `comisiones`**: ver ADR 15, alternativas. Deuda documentada con disparador explícito.

`db.ts` **no se toca**: WAL ya está activo desde Hito 3 (`db.ts:42`, verificado) y las FK ya están en `ON` (`db.ts:33`) — que es lo que hace que `REFERENCES vendedores(id)` y `REFERENCES casos(id)` se chequeen de verdad y no sean decorativas.

### 6.2 `repository.ts` — funciones nuevas (firmas completas)

Se **agregan al final** del archivo, sin tocar nada de lo existente. Mismo estilo: interfaces `readonly`, `rowToX` privados, errores de dominio traducidos con `isSqliteConstraintError` (`repository.ts:71`, verificado), `RETURNING` en los updates.

```ts
export interface Vendedor {
  readonly id: string;
  readonly nombre: string;
  readonly createdAt: string;
}

export interface VentaRow { /* forma pública, camelCase — igual a `Venta` del contrato */ }
export interface ComisionRow { /* ídem `Comision` */ }

export class VentaNotFoundError extends Error { constructor(id: string); }
export class VentaAlreadyExistsError extends Error { constructor(id: string); }
/** FK rota: `vendedor_id` o `caso_id` no existen. Molde de `ActividadInvalidReferenceError`. */
export class VentaInvalidReferenceError extends Error { constructor(ventaId: string); }
/** Colisión de `token_confirmacion` (SQLITE_CONSTRAINT_UNIQUE). Con `randomUUID` es astronómicamente improbable, pero un UNIQUE que se viola en silencio sería peor que uno que se nombra. */
export class VentaTokenDuplicadoError extends Error { constructor(token: string); }

/** `ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre RETURNING ...`. Molde de `upsertProyecto` (`repository.ts:339`) — sin `COALESCE`, porque `nombre` es NOT NULL y el caller siempre tiene valor. */
export function upsertVendedor(
  db: Database.Database,
  input: { readonly id: string; readonly nombre: string; readonly createdAt: string },
): Vendedor;

export interface CreateVentaConCasoInput {
  readonly vendedor: { readonly id: string; readonly nombre: string };
  readonly caso: CreateCasoInput;
  readonly venta: {
    readonly id: string;
    readonly clienteId: string;
    readonly planAnterior?: string;
    readonly planNuevo: string;
    readonly monto: number;
    readonly estado: string;
    readonly tokenConfirmacion: string;
    readonly expiresAt?: string;
  };
  readonly timestamp: string;
}

/**
 * `upsertVendedor` + `createCaso` + `INSERT ventas` en UNA transacción
 * (`db.transaction(fn)()`), molde EXACTO de `createCasoConActividad`
 * (`repository.ts:568`, verificado). Si cualquiera de los tres pasos lanza,
 * SQLite revierte los anteriores: no queda un `vendedor` nuevo ni un `caso`
 * huérfano. Es lo que hace literal —y no aspiracional— el escenario "Token de
 * autenticación ausente o inválido → no se crea `vendedor`, `caso` ni
 * `venta`": no hay estado intermedio observable.
 *
 * `planAnterior`/`expiresAt` ausentes se bindean como `null` explícito
 * (`better-sqlite3` se niega a bindear un `undefined` de JS — misma nota que
 * `updateActividad` ya documenta).
 */
export function createVentaConCaso(db: Database.Database, input: CreateVentaConCasoInput): VentaRow;

/** `SELECT ... WHERE token_confirmacion = ?`. Indexada por el `UNIQUE` de la columna. `undefined` si no existe. */
export function findVentaByToken(db: Database.Database, token: string): VentaRow | undefined;

export function getVentaById(db: Database.Database, id: string): VentaRow | undefined;

export interface ConfirmarVentaConComisionInput {
  readonly ventaId: string;
  readonly comisionId: string;
  readonly comisionMonto: number;
  readonly periodo: string;
  readonly ahora: string;
}

/**
 * EL corazón del hito. UNA transacción, dos escrituras, y el compare-and-swap
 * del ADR 15:
 *
 *   const venta = db.prepare(`
 *     UPDATE ventas
 *        SET estado = 'confirmada', confirmed_at = @ahora
 *      WHERE id = @ventaId
 *        AND estado = 'pendiente_confirmacion'
 *        AND (expires_at IS NULL OR expires_at > @ahora)
 *     RETURNING <todas las columnas>`).get({...});
 *   if (!venta) return undefined;            // ← alguien llegó primero
 *   const comision = insertComision({ id, ventaId, vendedorId: venta.vendedor_id,
 *                                     monto, periodo, createdAt: ahora });
 *   return { venta, comision };
 *
 * Tres cosas que este cuerpo garantiza y que valen leer dos veces:
 *
 * 1. El `WHERE estado = 'pendiente_confirmacion'` es la guarda REAL contra el
 *    doble click y contra dos POST simultáneos, no el chequeo en JS que
 *    ocurrió antes (ADR 15). `undefined` NO es un error: es "ya estaba
 *    procesada", y el caller lo traduce a la página genérica.
 * 2. El `INSERT` en `comisiones` ocurre SOLO en la rama donde el `UPDATE`
 *    matcheó. Por construcción no puede haber dos comisiones para la misma
 *    venta: la segunda confirmación nunca llega a insertar.
 * 3. `vendedor_id` de la comisión sale de la fila que el `RETURNING` acaba de
 *    devolver, no de un parámetro. Así el denormalizado del plan
 *    (`comisiones.vendedor_id`) no puede divergir de `ventas.vendedor_id`
 *    aunque el caller se equivoque.
 *
 * `expires_at > @ahora` es comparación lexicográfica de TEXT: correcta solo
 * porque todo timestamp de este repo es ISO-8601 UTC de ancho fijo (ADR 16,
 * regla 3). El MISMO `@ahora` se usa para el predicado, para `confirmed_at` y
 * para el `created_at` de la comisión.
 */
export function confirmarVentaConComision(
  db: Database.Database,
  input: ConfirmarVentaConComisionInput,
): { readonly venta: VentaRow; readonly comision: ComisionRow } | undefined;

/** CAS a `'rechazada'` desde `'pendiente_confirmacion'` (+ misma guarda de expiración). `undefined` = no aplicó. NUNCA toca `comisiones`. */
export function rechazarVenta(db: Database.Database, input: { ventaId: string; ahora: string }): VentaRow | undefined;

/** CAS a `'reembolsada'` desde `'confirmada'`. SIN guarda de expiración (ADR 19, punto 2). NO toca `comisiones` (spec: la comisión ya pagada permanece). */
export function aprobarReembolso(db: Database.Database, input: { ventaId: string; ahora: string }): VentaRow | undefined;

/**
 * CAS a `'reembolso_pendiente'` desde `'confirmada'` Y `updateCaso(db,
 * casoId, { estado: 'pendiente_aprobacion_humana', updatedAt: ahora })` en la
 * MISMA `db.transaction` (ADR 11 de la propuesta, punto 2). Si el `UPDATE` de
 * `ventas` no matchea, se devuelve `undefined` ANTES de tocar el `caso`: no
 * existe el estado intermedio "caso escalado, venta no".
 *
 * `updateCaso` ya existe (`repository.ts:131`, verificado) y se REUSA tal
 * cual — cero cambios en esa función. NO toca `comisiones` (spec, escenario
 * "la fila de `comisiones` de esa venta no se modifica ni se elimina").
 */
export function escalarReembolso(
  db: Database.Database,
  input: { ventaId: string; casoId: string; ahora: string },
): VentaRow | undefined;

/* ── Lecturas de agregación del reporte (ADR 9 de la propuesta) ── */

/**
 * `SELECT` con `JOIN ventas` y `JOIN vendedores`, `WHERE c.periodo = ?`,
 * `ORDER BY c.vendedor_id, c.created_at`. Devuelve `ComisionConVenta[]` —
 * incluido `ventas.estado` ACTUAL, que es lo que hace visible R5 (la
 * inconsistencia entre una venta reembolsada y su comisión viva) en vez de
 * esconderla.
 *
 * Toda la lógica de agrupación, comparación y orden vive en
 * `agruparReporteMensual` (PURA, §3.5). Esta función solo lee: el spec exige
 * que la agregación sea testeable sin base de datos, y eso solo es cierto si
 * el SQL no agrupa.
 */
export function listComisionesPorPeriodo(db: Database.Database, periodo: string): readonly ComisionConVentaRow[];

/** `SELECT ... FROM ventas JOIN vendedores WHERE ventas.estado = 'reembolso_pendiente' ORDER BY confirmed_at`. Sin filtro de período — el spec lo pide explícitamente. */
export function listVentasEnReembolsoPendiente(db: Database.Database): readonly VentaPendienteReembolsoRow[];
```

### 6.3 `src/build-on-venta.ts` (nuevo — el hermano DETERMINISTA)

```ts
/**
 * Wiring del camino DETERMINISTA de ventas (ADR 7 de la propuesta, punto 4).
 * Módulo hermano de `build-on-activity.ts` y de `build-on-submit.ts`: vive en
 * `src/`, no dentro de ningún adaptador ni de `core/`, porque importa TANTO
 * de `src/core/ventas/*` COMO de `src/adapters/memory/repository.ts` — un
 * archivo que conecta ambos lados no puede vivir dentro de ninguno sin
 * volverse, estructuralmente, un adaptador hablándole a otro adaptador.
 *
 * ★ ESTE ARCHIVO NO IMPORTA `handleTurn`, NI `createKnowledgeAdapter`, NI EL
 *   SDK. NI DEBE. ★  Si algún día aparece un import del SDK acá, el ADR 7 se
 *   rompió: `monto × porcentaje` y `monto < umbral` son reglas cerradas, y
 *   meterles un modelo estadístico en el medio no es uniformidad, es
 *   no-determinismo en el camino del dinero. El criterio de corte, escrito
 *   para que no haya que volver a discutirlo: **¿hay un paso de razonamiento
 *   real?** Acá no lo hay. En `build-on-soporte.ts` sí.
 *
 * A diferencia de `buildOnActivity`, este módulo NO usa `KeyedQueue` (ADR 15)
 * y sus handlers **SÍ propagan** los errores del store: del otro lado no hay
 * un GitHub que ya recibió su `202`, hay un cliente HTTP esperando, y el
 * adaptador web traduce la excepción a un `500` (§4.4). Tragar el error acá
 * devolvería un `201` sobre una venta que no existe.
 */
export interface BuildOnVentaDeps {
  readonly db: Database.Database;
  readonly notifier: VentaNotifierPort;
  readonly ventasConfig: VentasConfig;
  readonly baseUrlPublica: string;
  readonly newId?: () => string;      // default: randomUUID
  readonly newToken?: () => string;   // default: randomUUID (ADR 10 punto 1: token opaco de alta entropía, node:crypto, cero dependencias)
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
  /** Inyectable solo para el test; default: `createVentaStore(db)`. */
  readonly store?: VentaStorePort;
}

export interface VentaHandlers {
  readonly onAltaVenta: (input: RegistrarVentaInput) => Promise<RegistrarVentaResult>;
  readonly onConsultaVenta: (token: string) => Promise<VentaPublica | undefined>;
  readonly onDecisionVenta: (input: { token: string; decision: DecisionCliente }) => Promise<DecisionVentaResult>;
  readonly onDevolucion: (input: { token: string; motivo?: string }) => Promise<DevolucionResult>;
}

/**
 * Los cuatro handlers del ADR 12. Los tres últimos envuelven funciones
 * SÍNCRONAS del núcleo en promesas ya resueltas: la firma uniforme es
 * comodidad del adaptador, no una promesa de asincronía. `onAltaVenta` sí es
 * genuinamente `async` — su único `await` es la notificación best-effort.
 *
 * `onConsultaVenta` (el `GET` de la página) proyecta a `VentaPublica`: sin
 * token, sin `caso_id`, sin `cliente_id`. Y aplica `validarTokenConfirmacion`
 * ANTES de proyectar, así que una venta vencida o ya procesada devuelve
 * `undefined` y el adaptador muestra la página genérica — el `GET` no puede
 * ser un oráculo que el `POST` no es (R6).
 */
export function buildOnVenta(deps: BuildOnVentaDeps): VentaHandlers;

/**
 * `VentaStorePort` por closures sobre `repository.ts` — mismo patrón, y mismo
 * lugar, que `createActivityStore` (`build-on-activity.ts:156`, verificado) y
 * que el `MemoryPort` de `main.ts`. Seis delegaciones directas con traducción
 * de forma (`estado: string` de la fila → `VentaEstado` del puerto), validada
 * contra `VENTA_ESTADOS` en vez de casteada a ciegas — molde exacto de
 * `toPortActividad`, incluida su excepción propia
 * (`VentaEstadoInvalidoError`) para el caso de corrupción de datos real.
 */
export function createVentaStore(db: Database.Database): VentaStorePort;
```

### 6.4 `src/build-on-soporte.ts` (nuevo — el hermano CON `handleTurn`)

```ts
/**
 * Wiring del ÚNICO camino de este hito que invoca al modelo (ADR 7 de la
 * propuesta, punto 2; spec `soporte-web-turno`). Hermano de
 * `build-on-venta.ts`, y su contraste deliberado: acá SÍ está el SDK, porque
 * acá SÍ hay un paso de razonamiento real — una consulta abierta de un
 * cliente. Convertir eso en una plantilla determinista tiraría a la basura la
 * única parte del hito donde el agente conversacional aporta valor.
 *
 * Es casi exactamente el `runTurn` de `buildOnActivity` (`build-on-activity.ts:223-233`,
 * verificado), con dos diferencias:
 *  - crea su propio `caso` tipo `CASO_TIPO_SOPORTE` (spec: ANTES de invocar
 *    `handleTurn`, para que el turno quede correlacionado por `casoId` igual
 *    que en Hitos 2 y 3);
 *  - NO hay `KeyedQueue`: no hay recurso compartido que serializar. Cada
 *    consulta de soporte es un `caso` nuevo e independiente.
 */
export interface BuildOnSoporteDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  /** La MISMA fábrica por `casoId` que `main.ts` ya arma (`main.ts:168`). Un `KnowledgeAdapter` por turno — fix de R1 de Hito 3, que este hito NO reintroduce. */
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
}

export interface SoporteResult {
  readonly casoId: string;
  readonly respuesta: string;
}

/**
 * Secuencia exacta:
 *  1. `casoId = newId()`; `createCaso(db, { id: casoId, tipo:
 *     CASO_TIPO_SOPORTE, estado: CASO_ESTADO_ACTIVO, ... })`. PROPAGA si
 *     falla. → `soporte-caso-creado`.
 *  2. `prompt = buildSoportePrompt(consulta)` — PURO, §3.6. Reusa
 *     `CONVERSATIONAL_AGENT` con prompt sintético, SIN un segundo
 *     `AgentDefinition` y SIN tocar `definitions.ts` (spec, req. 15; mismo
 *     criterio que Hito 3).
 *  3. `knowledge = createKnowledge(casoId)`; `handleTurn(casoId, prompt,
 *     { memory, hooks, candidateAgents: agents, mcpServers,
 *       knowledgeFeedback, ...(logDeps ? { logDeps } : {}) })`.
 *     El spread condicional de `logDeps` es obligatorio bajo
 *     `exactOptionalPropertyTypes: true` — misma nota que
 *     `build-on-submit.ts` y `build-on-activity.ts` ya documentan.
 *  4. Devuelve `{ casoId, respuesta: result.responseText }`.
 *
 * PROPAGA `TurnFailedError` — a diferencia de `buildOnActivity`, que traga
 * porque GitHub ya recibió su `202`. Acá hay un cliente esperando y el
 * adaptador traduce el rechazo a `502` (§4.4, ADR 14). `handle-turn.ts` NO se
 * modifica ni recibe dependencias nuevas: este módulo lo ENVUELVE.
 */
export function buildOnSoporte(deps: BuildOnSoporteDeps): (input: { consulta: string }) => Promise<SoporteResult>;
```

### 6.5 `src/main.ts` — cambios exactos

Cuatro cambios. Ninguno toca el camino de la TUI ni el de los webhooks.

**(a) Validación de la configuración de negocio, dentro de `startHarness()`** (ADR 17b) — antes de abrir nada:

```ts
const ventasConfigResult = resolveVentasConfig(process.env);
if (!ventasConfigResult.ok) {
  throw new HarnessBootstrapError(
    `Configuración de ventas inválida:\n  - ${ventasConfigResult.errores.join("\n  - ")}`,
  );
}
```

Va **dentro** del `try` de `startHarness()` que ya existe (`main.ts:178-185`, verificado), así que reusa su `catch` — un mensaje legible por stderr y `process.exit(1)`, sin stack trace crudo. Eso satisface literalmente el escenario "Porcentaje de comisión inválido → el arranque falla con un error explícito **y ninguna venta llega a confirmarse con ese valor**": el proceso muere antes de que `startWebServer` exista. `process.env` se lee acá y no dentro de `resolveVentasConfig` por ADR 17a; es correcto porque `import "./core/config/env.js"` sigue siendo el **primer** import del archivo (restricción crítica que el module doc de `main.ts` documenta, verificada).

**(b) Wiring de la tercera fuente de eventos**, después del wiring de webhooks y antes de montar la TUI:

```ts
const notifier = createNotificadorAdapter({
  logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
});

const webConfig = resolveWebConfig();

const ventaHandlers = buildOnVenta({
  db,
  notifier,
  ventasConfig,
  baseUrlPublica: webConfig.publicUrl,
});

const onSoporte = buildOnSoporte({ db, memory, hooks, agents, createKnowledge });

let web: WebAdapter | undefined;
try {
  web = await startWebServer({
    ...ventaHandlers,
    onSoporte,
    logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
  });
} catch (error) {
  logTurnEvent(WEB_LOG_CORRELATION_ID, "web-arranque-fallido", { message: toErrorMessage(error) });
  web = undefined;
}
```

`createNotificadorAdapter` devuelve el no-op sin `EMAIL_API_KEY` — la decisión vive adentro del adaptador, igual que `createBoardAdapter` hoy. `createKnowledge` es **la misma fábrica** que `main.ts:168` ya construye: la TUI, los webhooks y soporte comparten la fábrica, nunca la instancia (fix de R1 de Hito 3, no reintroducido).

El `try/catch` propio replica exactamente el criterio del webhook (`main.ts:250-259`, verificado): que el puerto esté ocupado no puede impedir que el empleado use la TUI.

**(c) Cierre ordenado** — el `finally` gana un paso **antes** del de webhooks:

```ts
} finally {
  // Orden: web → webhooks → db. Los dos servidores primero porque los dos
  // pueden tener trabajo en vuelo que ESCRIBE en la base (un turno de
  // soporte, un turno de actividad); `db.close()` con cualquiera a mitad de
  // camino explotaría contra un handle cerrado. Web antes que webhooks es
  // arbitrario y da igual: son independientes y ninguno espera al otro.
  if (web !== undefined) {
    try { await web.close(); } catch (error) { console.error(`No se pudo cerrar el servidor web: ${toErrorMessage(error)}`); }
  }
  if (webhook !== undefined) { /* ... sin cambios ... */ }
  try { db.close(); } catch (error) { /* ... sin cambios ... */ }
}
```

El `try/catch` alrededor de `web.close()` es red de seguridad sobre un método que ya promete no rechazar — mismo razonamiento y misma forma que el que ya envuelve `webhook.close()` y `db.close()`.

**(d) `core/config/env.ts`** gana **solo module doc**: la lista de variables que otros módulos leen de `process.env` después de que este cargó `.env` suma `WEB_*`, `VENTAS_API_TOKEN`, `EMAIL_*`, `COMISION_PORCENTAJE`, `REEMBOLSO_UMBRAL`, `VENTA_TOKEN_TTL_HORAS`. Cero código nuevo. **Esto corrige la tabla de la propuesta**, que listaba `env.ts` como *Modified* con implicación de código.

### 6.6 `src/reporte-mensual.ts` (nuevo — entrypoint CLI, ADR 9 de la propuesta)

```ts
/**
 * Comando del reporte mensual — entrypoint SEPARADO de `main.ts`, corrido a
 * mano con `npm run reporte:mensual` (ADR 9 de la propuesta). NO hay Registro
 * de Comandos, NO hay scheduler, NO hay `node-cron`, NO hay `setInterval`:
 * el proceso del arnés vive mientras la TUI está montada, y un temporizador
 * de un mes adentro de un proceso de vida corta no dispara nunca. Sería
 * infraestructura nueva Y rota.
 *
 * Este archivo es SOLO I/O y wiring. Toda la lógica de agrupación,
 * comparación entre vendedores y formato vive en funciones puras de
 * `core/ventas/reporte.ts`, testeables sin base de datos (spec
 * `reporte-comisiones-mensual`, req. 17).
 *
 * Secuencia:
 *  1. `periodo` = `--periodo YYYY-MM` de `process.argv`, o el mes corriente
 *     (`new Date().toISOString().slice(0, 7)` — UTC, ADR 16 regla 2).
 *     Formato inválido → mensaje de uso por stderr y `exit(1)`.
 *  2. `openDatabase("data/harness.db")` — MISMA función y MISMO path que
 *     `main.ts`. Corre las migraciones si faltan, lo cual es correcto: abrir
 *     el reporte sobre una base sin `0004` la migra en vez de fallar.
 *  3. `listComisionesPorPeriodo(db, periodo)` y
 *     `listVentasEnReembolsoPendiente(db)`.
 *  4. `agruparReporteMensual({ periodo, comisiones, reembolsosPendientes })`
 *     → `formatearReporteMensual(...)`. Las dos PURAS.
 *  5. `process.stdout.write(texto)`.
 *  6. `db.close()` en un `finally`.
 *
 * ★ stdout es legítimo ACÁ y solo acá. ★ El module doc de `turn-logger.ts`
 * documenta en detalle por qué NADA del proceso principal puede escribir a un
 * stream que la terminal muestre: Ink asume control exclusivo de stdout y
 * cualquier escritura cruda corrompe el render. Este es un proceso DISTINTO,
 * de vida corta, sin ninguna TUI montada — imprimir es literalmente su
 * trabajo. La regla no se rompe, no aplica.
 *
 * NO correr este comando no tiene NINGÚN efecto sobre `ventas`, `comisiones`
 * ni el resto del arnés: es de solo lectura y nadie más lo espera (spec,
 * req. 19).
 */
```

`package.json` gana **una** línea, y ninguna dependencia:

```json
"reporte:mensual": "tsx src/reporte-mensual.ts"
```

Uso: `npm run reporte:mensual -- --periodo 2026-02`.

---

## 7. Manejo de errores y degradación

**Regla de oro del hito**: el estado canónico falla ruidosamente, la notificación nunca falla, y el camino del dinero nunca improvisa. Los dos puertos existen separados exactamente por eso.

### 7.1 Garantías por capa

| Capa | Garantía | Qué pasa si falla |
|---|---|---|
| `resolveWebConfig` / `resolveNotificacionesConfig` | Nunca lanzan; defaults en silencio | Adaptador deshabilitado o con default |
| `resolveVentasConfig` | Nunca lanza; devuelve `{ ok: false, errores }` | `main.ts` aborta con mensaje legible (ADR 17) |
| `createRequestListener` | Nunca lanza al servidor HTTP | Toda rama termina en un status y un `res.end()` |
| `parse*Payload` | Nunca lanzan; `{ ok: false, motivo }` | `400` con el motivo |
| `calcularComision` / `evaluarReembolso` / `validarTokenConfirmacion` | Puras y totales; nunca lanzan | — |
| `VentaStorePort` | **Falla RUIDOSAMENTE** | Propaga al handler → `500` |
| `VentaNotifierPort` | **Nunca rechaza, nunca lanza** | `{ enviado: false, motivo }`; la venta queda persistida |
| `registrarVenta` | Propaga fallas del store; **traga** las del notifier | `500` en el primer caso, `201` con `notificado: false` en el segundo |
| `resolverDecisionVenta` / `procesarDevolucion` | Síncronas; propagan del store | `500`; `no_aplicable` NO es un fallo |
| `buildOnSoporte` | **Propaga** `TurnFailedError` | `502` (ADR 14) |
| `WebAdapter.close()` | Nunca rechaza | Drena o corta en `WEB_CLOSE_TIMEOUT_MS` |

### 7.2 Matriz de degradación

| Falta / falla | Qué pasa | Evento de log |
|---|---|---|
| `WEB_PORT` | **No se abre puerto.** TUI + webhooks idénticos a `v1.2.0` | `web-deshabilitado` |
| `VENTAS_API_TOKEN` | Puerto abierto; `POST /ventas` responde `401` **siempre** | `web-no-autorizado` |
| `EMAIL_API_KEY` | Venta se crea igual; el link se **loguea** en vez de enviarse | `email-omitido` |
| Proveedor de email caído / HTTP ≠ 2xx / timeout | Venta persiste en `pendiente_confirmacion`; **sin excepción al llamador** | `email-fallido` |
| `WEB_PUBLIC_URL` | Link armado sobre `http://localhost:8080` — inútil para un cliente real, correcto para probar en la máquina | — |
| Puerto ocupado (`EADDRINUSE`) | `web = undefined`; TUI y webhooks arrancan igual | `web-arranque-fallido` |
| `COMISION_PORCENTAJE` / `REEMBOLSO_UMBRAL` / `VENTA_TOKEN_TTL_HORAS` inválidos | **El proceso NO arranca** | (stderr, antes del logger) |
| `graphify` ausente | Solo afecta `/soporte`: el turno completa degradado, igual que Hito 2 | `conocimiento-consulta-error` |
| Modelo caído / `TurnFailedError` | Solo `/soporte`: `502`. **Cero impacto** en ventas, confirmación y devolución | `soporte-turno-fallido` |
| Turno de soporte > 120 s | `504`; el turno sigue y su `caso` queda persistido | `soporte-timeout` |
| Ctrl+C con turno de soporte en vuelo | Se drena hasta 5 s, después se cierra igual | `web-cierre-con-turnos-en-vuelo` |

**Asimetría que vale nombrar**: una caída del modelo o de `graphify` **no puede** impedir que una venta se confirme o que una comisión se calcule. Esa es, medida en una sola línea, la ganancia del ADR 7 de la propuesta.

**Topes, todos con constante nombrada y test**:

| Constante | Valor | Motivo |
|---|---|---|
| `DEFAULT_WEB_MAX_BODY_BYTES` | 64 KiB | Guardia de memoria sobre entrada no autenticada (R6) |
| `MAX_SOPORTE_CONSULTA_CHARS` | 4 000 | Una consulta de soporte no necesita más; el resto es contexto desperdiciado |
| tope de strings del payload de alta | 256 | `cliente_id` es opaco, no ilimitado (R9) |
| tope de `motivo` de devolución | 500 | Solo va al log, recortado (ADR 19, punto 4) |
| tope del token en la ruta | 200 | Un `randomUUID` mide 36; 200 es margen sin ser una puerta |
| `SOPORTE_TIMEOUT_MS` | 120 000 | ADR 14, punto 3 |
| `WEB_CLOSE_TIMEOUT_MS` | 5 000 | ADR 14, punto 4 |
| `DEFAULT_EMAIL_TIMEOUT_MS` | 10 000 | Mismo valor que el tablero — la notificación está en el camino de la respuesta de `POST /ventas` |

**`turn-error.ts` NO se toca**, confirmando el *Fuera de alcance* de la propuesta. `TurnStage` (`"context" | "model" | "close"`) modela etapas de un turno del Selector de Turno; nada del camino determinista es un turno, así que no hay ninguna falla nueva que `TurnFailedError` deba representar. El único camino de este hito que produce `TurnFailedError` es `/soporte`, y lo produce el `handleTurn` existente sin cambios.

### 7.3 Cobertura escenario por escenario (24 escenarios)

**`venta-confirmacion` (11)**

| # | Escenario | Mecanismo de diseño |
|---|---|---|
| 1 | Sin `WEB_PORT` configurado | §4.1 `isWebEnabled(config)` = `port > 0` + §4.6 `startWebServer` devuelve `undefined` sin llamar a `createServer` |
| 2 | Alta válida crea vendedor, caso y venta | §6.2 `createVentaConCaso` (una transacción) + §3.4 `registrarVenta` paso 2; `cliente_id` como TEXT sin FK (§6.1); `build-on-venta.ts` **no importa el SDK** |
| 3 | Token de autenticación ausente o inválido | §4.4 auth con `timingSafeEqual` + chequeo de largo; `""` → `401` sin comparar; el `401` ocurre **antes** de parsear, así que ninguna transacción arranca |
| 4 | Falla el proveedor de email | §3.1 contrato "nunca rechaza" + §5.3 `try/catch` total + §3.4 paso 4; la venta ya está persistida y el `201` sale con `notificado: false` |
| 5 | Sin `EMAIL_API_KEY` | §5.3 `createNoopNotificador`, `email-omitido` con el link completo |
| 6 | Token vencido rechazado sin efecto | §3.3 `validarTokenConfirmacion` guarda 3 + §6.2 predicado `expires_at > @ahora` en el `UPDATE`; §4.4 respuesta idéntica a la de un token inexistente |
| 7 | Confirmar una venta no llama al modelo | ADR 7 de la propuesta + §6.3 (`build-on-venta.ts` sin import del SDK) + test que afirma que un `queryFn` doble **nunca** se invoca |
| 8 | Confirmación exitosa calcula y persiste la comisión | §6.2 `confirmarVentaConComision` (una transacción) + ADR 16 (`Math.round(x*100)/100`, `periodo` de `confirmed_at`) |
| 9 | Rechazo no genera comisión | §6.2 `rechazarVenta` — CAS a `rechazada`, `comisiones` no se toca en ninguna rama |
| 10 | Reintento sobre token ya procesado | **ADR 15**: el `WHERE estado = 'pendiente_confirmacion'` no matchea; `undefined` → página genérica, sin segunda comisión |
| 11 | Porcentaje de comisión inválido | ADR 17 + §6.5(a): `HarnessBootstrapError` antes de abrir ningún puerto |

**`reembolso-evaluacion` (6)**

| # | Escenario | Mecanismo |
|---|---|---|
| 12 | Devolución sobre venta no confirmada | §3.4 `procesarDevolucion` paso 3 + CAS `WHERE estado = 'confirmada'` (§6.2) |
| 13 | Evaluación no llama al modelo | Mismo mecanismo del #7 — `procesarDevolucion` vive en `build-on-venta.ts` |
| 14 | Monto bajo el umbral se aprueba solo | §3.3 `evaluarReembolso` (`<`) + §6.2 `aprobarReembolso`; ninguna escalación creada |
| 15 | Monto sobre el umbral escala a un humano | §6.2 `escalarReembolso`: venta + `updateCaso` en **una** transacción (ADR 11 punto 2); ningún camino del código mueve a `reembolsada` desde `reembolso_pendiente`; `comisiones` intacta |
| 16 | No existe camino de producto para cerrar la escalación | Fuera de alcance por diseño: **no hay** ruta de aprobación en la tabla de §4.4, ni pantalla de TUI, ni notificación al aprobador. La única observabilidad es §3.5 (`reembolsosPendientes` en el reporte). **R3 — requiere aceptación del checkpoint** |
| 17 | Comisión ya pagada permanece tras un reembolso | `aprobarReembolso` y `escalarReembolso` **no tocan `comisiones`**, ni por `UPDATE` ni por `DELETE` ni con una fila de ajuste. El reporte muestra `ventaEstado` junto a la comisión (§3.5) para que la inconsistencia sea **visible**, no silenciosa (R5) |

**`soporte-web-turno` (3)**

| # | Escenario | Mecanismo |
|---|---|---|
| 18 | Soporte invoca al modelo, ventas y confirmación no | ADR 12 (dos módulos de wiring separados) + §6.3/§6.4; test que ejercita los cuatro endpoints con un `queryFn` doble y cuenta **una** invocación |
| 19 | Consulta de soporte crea su caso | §6.4 paso 1: `createCaso` con `tipo = CASO_TIPO_SOPORTE` **antes** de `handleTurn`; el `casoId` es el argumento posicional de `logTurnEvent` en todo el turno |
| 20 | Respuesta del agente se devuelve al cliente | **ADR 14**: `/soporte` espera el turno y devuelve `responseText` en el cuerpo — no hay ack-`202` |

**`reporte-comisiones-mensual` (4)**

| # | Escenario | Mecanismo |
|---|---|---|
| 21 | El reporte no se dispara solo | ADR 9 de la propuesta + §6.6: cero `setInterval`, cero `node-cron`, cero Registro de Comandos. Entrypoint separado que solo corre cuando alguien lo corre |
| 22 | Comparativo por vendedor para un periodo dado | §3.5 `agruparReporteMensual` — pura, testeable sin base; el SQL solo lee (§6.2) |
| 23 | Reembolso escalado aparece en el reporte | §6.2 `listVentasEnReembolsoPendiente` **sin filtro de período** + §3.5 (`reembolsosPendientes` pasa tal cual) |
| 24 | Sistema funciona igual sin correr el reporte | §6.6: proceso separado, de solo lectura, sin ningún consumidor |

---

## 8. Concurrencia: una transacción, no una cola

**Qué protege qué**, sin ambigüedad:

- `better-sqlite3` es **síncrono**: dos sentencias SQL nunca se interleavan dentro de este proceso.
- La cola de Hito 3 (`createKeyedQueue`) existe para serializar el ciclo `leer actividad → await del modelo (decenas de segundos) → escribir actividad`. Ese `await` del medio es el único lugar donde el event loop puede meter un segundo evento que lea estado viejo.
- **El camino determinista de este hito no tiene ningún `await` entre la lectura y la escritura.** `resolverDecisionVenta` y `procesarDevolucion` son **síncronas** (§3.4), y la única operación asíncrona del camino — la notificación — ocurre *después* de que la transacción cerró (§3.4, `registrarVenta` paso 4). Que las funciones sean síncronas **en el tipo** es la prueba, no la promesa.
- Por eso una `db.transaction(...)` con el CAS del ADR 15 da una garantía **más fuerte** que la cola: la re-validación del estado y la escritura son indivisibles a nivel de motor, no a nivel de disciplina del caller.
- WAL ya está activo desde Hito 3 (`db.ts:42`, verificado) y **no se toca**. Su beneficio acá es el mismo de allá: abrir `data/harness.db` con un cliente externo durante la demo no bloquea al arnés.

**`createKeyedQueue()` no se importa ni se modifica en este hito.** La propuesta lo dejó condicionado a que `sdd-design` encontrara un ciclo con `await` real; no lo hay. **Desviación del plan** (que nombra "cola por `vendedor_id`") ya declarada en la propuesta — R4, requiere el checkpoint. Precisión adicional de este diseño: aunque hubiera que ponerla, la clave correcta sería `venta_id`, no `vendedor_id` — dos ventas del mismo vendedor no compiten por ninguna fila.

**Cuándo habría que agregarla** (disparador escrito, para no volver a discutirlo): si algún día se decide notificar *dentro* de la ventana de confirmación, o consultar un servicio externo antes de aplicar la transición (por ejemplo la verificación de riesgo/crédito que el plan vincula al Hito 6), aparece un `await` en el medio y la cola vuelve a ser necesaria. `keyed-queue.ts` está escrito, testeado y aprobado; se importa y se usa sin modificarlo.

**Test que cierra R4**: dos invocaciones de `onDecisionVenta` con el mismo token, disparadas sin `await` entre medio sobre una base real en `:memory:`, y se afirma que (a) exactamente una devuelve `confirmada`, (b) `SELECT count(*) FROM comisiones WHERE venta_id = ?` es **1**, (c) la otra devuelve `no_aplicable`.

---

## 9. Logging (Concepto Transversal 3)

Se reusa `logTurnEvent(correlationId, event, fields, deps)` **sin cambiar su contrato** — igual que hicieron Hitos 2 y 3. `turn-logger.ts` no gana código; a lo sumo una línea en su module doc listando los consumidores nuevos. **Esto corrige la tabla de la propuesta**, que lo listaba como *Modified*.

### 9.1 Correlación: `requestId` como análogo del `deliveryId`

El mismo problema que §9.1 de Hito 3 resolvió reaparece con otra forma: `web-rechazado-tamano`, `web-no-autorizado` y `token-invalido` ocurren **antes** de que exista ningún `caso` — y en el caso de `token-invalido`, por definición nunca va a existir uno.

Hito 3 tenía a mano el `X-GitHub-Delivery`. Acá **no hay un id de correlación provisto por el emisor**, así que el adaptador genera uno:

- **Eventos de transporte** (antes del caso): `requestId = newRequestId()` (`randomUUID` en producción), generado al entrar la request. Se devuelve además en el header `X-Request-Id` de **toda** respuesta, así el operador que ve un `401` en su cliente HTTP puede grepear el log por ese mismo valor.
- **Eventos de ciclo de vida del proceso** (sin request): constante `WEB_LOG_CORRELATION_ID = "web-adapter"`, análogo exacto de `WEBHOOK_LOG_CORRELATION_ID`.
- **Eventos de negocio** (una vez que hay caso): `casoId`, como siempre.
- **Puente**: `venta-creada`, `venta-confirmada` y `soporte-caso-creado` se loguean con `casoId` **y** llevan `requestId` en `fields`. Una línea de `data/harness.log` permite saltar de un espacio al otro.

**`token-invalido` es el caso que no cierra, y se dice en vez de esconderse**: no tiene `casoId` (por definición: el token no resolvió a ninguna venta, o resolvió a una que no debe revelarse) y no puede llevar el token en `fields` — el token **es una credencial**, y `data/harness.log` no tiene rotación ni control de acceso. Se correlaciona por `requestId` y lleva **solo** `{ motivo, tokenLength }`. Con eso alcanza para diagnosticar ("todos los rechazos de la última hora son `vencido`") sin construir un diccionario de tokens válidos en un archivo plano. Queda como riesgo residual R14.

### 9.2 Eventos nuevos

| Evento | Correlación | Cuándo | Campos |
|---|---|---|---|
| `web-escuchando` | `"web-adapter"` | El servidor quedó escuchando | `port` |
| `web-deshabilitado` | `"web-adapter"` | Arranque sin `WEB_PORT` | — |
| `web-arranque-fallido` | `"web-adapter"` | `listen` falló (`EADDRINUSE`) | `message` |
| `web-cierre-con-turnos-en-vuelo` | `"web-adapter"` | El drenaje agotó `WEB_CLOSE_TIMEOUT_MS` | `enVuelo` |
| `web-no-autorizado` | `requestId` | `/ventas` sin token válido | `tokenConfigurado` (bool) |
| `web-rechazado-tamano` | `requestId` | Body superó `maxBodyBytes` | `ruta`, `maxBodyBytes` |
| `web-payload-invalido` | `requestId` | JSON roto o `parse*Payload` falló | `ruta`, `motivo` |
| `web-handler-fallido` | `requestId` | Un handler lanzó (store caído) | `ruta`, `message` |
| `venta-creada` | `casoId` | Tras la transacción de alta | `requestId`, `ventaId`, `vendedorId`, `monto`, `expiresAt?` |
| `email-enviado` | `casoId` | El proveedor respondió 2xx | — |
| `email-omitido` | `casoId` | Sin `EMAIL_API_KEY` | `linkConfirmacion` (deliberado — ADR 18, R17) |
| `email-fallido` | `casoId` | Red / HTTP ≠ 2xx / timeout | `reason`, `status?` |
| `venta-consultada` | `casoId` | `GET /confirmar/:token` con token válido | `requestId` |
| `token-invalido` | `requestId` | Token inexistente, vencido o en estado inválido | `motivo`, `tokenLength` — **nunca el token** |
| `venta-confirmada` | `casoId` | CAS aplicó | `requestId`, `ventaId`, `confirmedAt` |
| `comision-calculada` | `casoId` | `INSERT comisiones` OK | `comisionId`, `monto`, `periodo`, `porcentaje` |
| `venta-rechazada` | `casoId` | CAS a `rechazada` | `requestId`, `ventaId` |
| `venta-confirmacion-ignorada` | `requestId` | CAS **no** matcheó (reintento / carrera) | `ventaId` |
| `devolucion-rechazada` | `requestId` \| `casoId` | Token desconocido o venta no `confirmada` | `motivo` (`"token"` \| `"estado"`), `estadoActual?` |
| `reembolso-aprobado` | `casoId` | Bajo el umbral, CAS aplicó | `ventaId`, `monto`, `umbral` |
| `reembolso-escalado` | `casoId` | Sobre el umbral, venta + caso escalados | `ventaId`, `monto`, `umbral` |
| `soporte-caso-creado` | `casoId` | Antes de `handleTurn` | `requestId`, `consultaLength` |
| `soporte-turno-fallido` | `casoId` | `handleTurn` rechazó | `stage?`, `message` |
| `soporte-timeout` | `casoId` | Turno excedió `SOPORTE_TIMEOUT_MS` | `timeoutMs` |
| `reporte-generado` | `"reporte-mensual"` | Fin del CLI | `periodo`, `vendedores`, `reembolsosPendientes` |

**Qué NO se loguea, deliberadamente** (mismo criterio con el que Hito 2 loguea `questionLength` y no `question`): el `token_confirmacion`, `VENTAS_API_TOKEN`, `EMAIL_API_KEY`, `clienteEmail` (PII), el texto de la consulta de soporte y la respuesta del agente. De la consulta va `consultaLength`. **La única excepción declarada** es `linkConfirmacion` en `email-omitido`, que contiene el token: es el precio explícito de la degradación sin proveedor de email (ADR 18, R17), y solo ocurre cuando `EMAIL_API_KEY` está vacía.

---

## 10. Estrategia de testing

TDD estricto activo (`openspec/config.yaml: strict_tdd: true`). **Ningún test del suite por defecto abre un puerto, resuelve un DNS, manda un email ni llama al modelo.** Los seams son `CreateWebServerFn` (web), `FetchFn` (email), `Database` en `:memory:` (memoria) y `queryFn` (SDK, ya existente).

Este es el hito que mejor encaja con TDD estricto de los cuatro: **el 80% del código nuevo es puro**. La comisión, el umbral, la validación del token, la agregación del reporte, el parseo de payloads y el render del HTML se testean sin base, sin red y sin un solo fixture de LLM.

### Unitarios

| Archivo | Casos clave |
|---|---|
| `core/ventas/comision.test.ts` | `1000 × 0.1 = 100` **exacto** (no `100.00000000000001`) · redondeo del `.005` hacia arriba · monto con 3+ decimales · `porcentaje = 1` → comisión = monto · `periodoDeConfirmacion` sobre un ISO de fin de mes en UTC **no** cambia de mes por zona horaria |
| `core/ventas/reembolso.test.ts` | `monto < umbral` → `auto_aprobado` · **`monto === umbral` → `escalado`** (la celda del borde) · `monto > umbral` → `escalado` |
| `core/ventas/token-confirmacion.test.ts` | `undefined` → `inexistente` · estado ≠ pendiente → `estado_invalido` (para los 4 otros estados) · `expiresAt` en el pasado → `vencido` · `expiresAt` exactamente igual a `ahora` → `vencido` · `expiresAt` ausente → **válido** · `ahora` siempre inyectado, **`Date.now()` nunca aparece en el módulo** · `calcularExpiresAt(x, 0)` → `undefined` |
| `core/ventas/ventas-config.test.ts` | Defaults con env vacío · `COMISION_PORCENTAJE` en `0`, `1.5`, `"abc"` → `ok: false` · `1` exacto → válido · **dos variables inválidas devuelven DOS errores**, no uno · `VENTA_TOKEN_TTL_HORAS=0` → válido, `= -1` → error |
| `core/ventas/registrar-venta.test.ts` | Store que lanza → **propaga y el notifier NO se llama** · notifier que devuelve `enviado: false` → resultado con `notificado: false`, **sin excepción** · el link se arma como `{base}/confirmar/{token}` · `newToken`/`newId`/`now` inyectados → salida determinista · **`expiresAt` presente con TTL > 0 y ausente con TTL = 0** |
| `core/ventas/confirmar-venta.test.ts` | Token inválido → `no_aplicable` y **el store nunca recibe un write** · confirmar → comisión con el monto y período esperados · rechazar → **`confirmarVentaConComision` nunca se llama** · store que devuelve `undefined` (carrera) → `no_aplicable`, sin excepción · **el mismo `ahora` llega a validación, `confirmed_at` y `periodo`** |
| `core/ventas/procesar-devolucion.test.ts` | Venta inexistente → `no_aplicable` · venta en cada uno de los 4 estados ≠ `confirmada` → `no_aplicable` sin efecto · bajo umbral → `aprobarReembolso` · sobre/igual umbral → `escalarReembolso` con el `casoId` de la venta · **ningún camino llama a nada que toque `comisiones`** · **`expires_at` vencido NO bloquea la devolución** (ADR 19) |
| `core/ventas/reporte.test.ts` | Dos vendedores en el mismo período agrupan por separado · comisiones de otro período se filtran · orden por total DESC con desempate por id · `totalComisionado` redondeado (suma de floats) · `reembolsosPendientes` pasa **sin filtrar por período** · período sin comisiones → línea explícita · salida formateada afirmada como string completo (determinismo) |
| `core/ventas/soporte-prompt.test.ts` | Pura y determinista · trunca con marca · **incluye la limitación literal** de que el agente no puede confirmar/cancelar/reembolsar nada · **no incluye `clienteId`** |
| `adapters/web/config.test.ts` | Defaults · `WEB_PORT` ausente/`0`/`"abc"` → `isWebEnabled === false` · `publicUrl` con `/` final se normaliza · sin `VENTAS_API_TOKEN` → `""` |
| `adapters/web/payloads.test.ts` | Los 6 campos requeridos, uno ausente por vez → `motivo` distinto · `monto` como string → **rechazado, no coercido** · `monto` `0`/negativo/`NaN`/`Infinity` → rechazado · strings sobre el tope → rechazados · `decision` distinta de `confirmar`/`rechazar` → rechazada |
| `adapters/web/render.test.ts` | **`plan_nuevo` con `<script>` sale escapado** (XSS almacenado) · el token va `encodeURIComponent` en el `action` · `renderConfirmacionHtml` **no contiene** el `caso_id` ni el `cliente_id` · `renderLinkInvalidoHtml()` es idéntico llamado N veces y no toma parámetros |
| `adapters/web/server.test.ts` | Con `req`/`res` dobles: `404` en ruta desconocida · `401` sin token y **con `VENTAS_API_TOKEN` vacío**, sin llamar al handler · **header de largo distinto → `401`, NO `RangeError`** · `413` + `destroy()` al pasar el tope, **sin llamar al handler** · `400` con JSON roto · `201` con payload válido · **token vencido, inexistente y ya-confirmado producen respuestas byte a byte idénticas** (el requisito de indistinguibilidad) · `/soporte` responde `504` si el handler tarda más que el timeout (con reloj falso) · `502` si el handler rechaza · `close()` espera al turno en vuelo y resuelve igual al vencer el techo |
| `adapters/web/index.test.ts` | Sin `WEB_PORT` → devuelve `undefined`, **`createServer` nunca se llama**, loguea `web-deshabilitado` |
| `adapters/notificaciones/email-client.test.ts` | URL/método/headers exactos · **la API key nunca aparece en el mensaje de error** · `!ok` → `EmailApiError("http", status)` · abort → `"timeout"` · throw de red → `"network"` |
| `adapters/notificaciones/index.test.ts` | Sin API key → `fetchFn` **nunca** se llama, `{ enviado: false, motivo: "sin-api-key" }`, loguea el link · `fetchFn` que rechaza → **resuelve** con `enviado: false`, nunca lanza · `clienteEmail` vacío → `"sin-destinatario"` sin llamar a `fetchFn` · **`clienteEmail` nunca aparece en ningún log** |
| `adapters/memory/repository.test.ts` (+) | `upsertVendedor` idempotente · `createVentaConCaso` atómica: **si el `INSERT` de `ventas` falla, no queda `vendedor` ni `caso`** · `findVentaByToken` · **`confirmarVentaConComision` dos veces seguidas: la segunda devuelve `undefined` y `comisiones` tiene 1 fila** · token vencido → `undefined` sin escribir · `escalarReembolso` deja venta y caso coherentes, y **si la venta no está `confirmada` el `caso` NO se toca** · `aprobarReembolso`/`escalarReembolso` **no modifican `comisiones`** · FK rota → `VentaInvalidReferenceError` |
| `build-on-venta.test.ts` | **Ningún import del SDK en el módulo** (test estructural sobre el grafo de imports) · `onConsultaVenta` de una venta vencida → `undefined` · los 4 handlers propagan el error del store · **dos `onDecisionVenta` concurrentes sobre el mismo token → una comisión** (cierre de R4, §8) |
| `build-on-soporte.test.ts` | Crea el `caso` con `tipo: "soporte"` **antes** de llamar a `handleTurn` (orden afirmado) · `createKnowledge` se invoca **una vez, con el `casoId` del turno** · `TurnFailedError` **propaga** · reusa `CONVERSATIONAL_AGENT` sin definir un segundo agente |
| `reporte-mensual` | La lógica está toda en `reporte.test.ts` (puro). Del entrypoint se testea solo el parseo de `--periodo` si se extrae a una función pura; el `main` de I/O no se testea, mismo criterio que `main.ts` |
| `build-on-submit.test.ts` / `build-on-activity.test.ts` | **Sin cambios.** Son la red de regresión de Hitos 1 y 3: si algo de este hito los rompiera, lo detectan sin haber sido tocados |

### Fuera del suite por defecto

Nada de este hito necesita un test de integración opt-in nuevo. No hay ningún formato externo del que dependamos (a diferencia de los payloads de GitHub de Hito 3): el proveedor de email solo tiene que devolver 2xx, y eso se dobla con una función.

---

## 11. Riesgos residuales, supuestos y decisiones que el Implementer debe verificar

R1-R10 vienen de la propuesta; **R11-R18 son nuevos, aparecidos en este diseño**.

| # | Riesgo / supuesto | Estado tras este diseño | Acción |
|---|---|---|---|
| R1 | Dos formas de wiring confunden a quien lea el código | Acotado y **explícito en el nombre de los archivos**: `build-on-venta.ts` (sin SDK) vs. `build-on-soporte.ts` (con SDK) | Module docs en ambos citando ADR 7; el de `build-on-venta.ts` lleva la advertencia en mayúsculas (§6.3) |
| R2 | `expires_at` desvía del esquema literal del plan | **Sigue abierto — requiere el checkpoint.** Es la única desviación de esquema del hito | Columna nullable; `VENTA_TOKEN_TTL_HORAS=0` desactiva la guarda sin migrar (§3.2) |
| R3 | Se shippea una escalación que **nadie puede cerrar** | **Sigue abierto — es la limitación más discutible.** Este diseño la hace más visible, no la resuelve: la nota se imprime **en el reporte** (§3.5), no solo en un doc | **El checkpoint debe aceptarla o exigir un endpoint mínimo de aprobación.** Si lo exige: una ruta `POST /aprobar-reembolso` autenticada con `VENTAS_API_TOKEN` + un CAS más en `repository.ts`. Aditivo, ~1 tarea |
| R4 | No usar la cola se lee como omisión | **Cerrado por diseño**: las funciones del núcleo son SÍNCRONAS en el tipo (§3.4) y el CAS del ADR 15 da la garantía | Test de doble POST simultáneo sobre el mismo token (§8, §10) |
| R5 | Un reembolso deja viva la comisión ya pagada | Aceptado y **medible**: `FilaVendedor.ventasConReembolso` y `ComisionConVenta.ventaEstado` lo ponen en el reporte | Deuda documentada; revertir requiere decidir el modelo contable |
| R6 | La página pública es la primera superficie sin firma | Acotado: token opaco + `expires_at` + CAS + tope de body + **respuestas indistinguibles** (§4.4) + `Cache-Control: no-store` | La indistinguibilidad tiene test propio byte a byte (§10) |
| R7 | Dependencia operacional de un proveedor de email | Acotado por la degradación; **el checkpoint debe confirmar el proveedor** antes de la demo | §12.1, paso 4 |
| R8 | Dinero en `REAL` | Acotado con redondeo explícito y testeado en **dos** lugares: `calcularComision` y la suma del reporte (ADR 16) | Migrar a centavos = deuda documentada |
| R9 | El alcance crece hacia gestión de clientes | Cerrado: `cliente_id` opaco con tope de largo, sin tabla, sin FK, y **`clienteEmail` ni siquiera se persiste** (ADR 18) | — |
| R10 | `src/core/skills/` y `src/core/commands/` siguen vacíos | Sin cambios respecto de la propuesta (ADR 8 y 9) | Documentar en el cierre del hito con el disparador escrito |
| **R11** | **`/soporte` es el primer endpoint del proyecto que espera al modelo con una conexión HTTP abierta.** N requests lentas pinchan N conexiones en el proceso que además sostiene la TUI | Acotado por `SOPORTE_TIMEOUT_MS` (ADR 14, punto 3) y por el drenaje al cerrar | **No hay límite de concurrencia** — un rate limit está fuera de alcance. Si en la demo se abusa, la mitigación es un semáforo de N turnos simultáneos, aditivo |
| **R12** | **Un `504` de soporte deja un turno huérfano corriendo** que igual va a escribir su `caso` y consumir tokens del modelo | Aceptado: `handleTurn` no es cancelable y **no se modifica** | El `caso` queda persistido y el turno queda en el log — la respuesta no se pierde, solo no llega por HTTP |
| **R13** | **El `token_confirmacion` es credencial de vida larga para devoluciones** (ADR 19): `expires_at` no gatea ese camino | Aceptado y declarado. El estado lo acota: solo funciona sobre una venta `confirmada`, y una vez usada deja de estarlo | Cerrar esto de verdad requiere identidad de cliente, fuera de alcance por decisión de la propuesta |
| **R14** | **`token-invalido` no se puede correlacionar con una venta**: no hay `casoId` y el token no puede ir al log (es credencial) | Diseñado con `requestId` + `{ motivo, tokenLength }` (§9.1). **No se reinterpretó el spec en silencio** | Si hiciera falta trazar un token concreto, la salida es un hash truncado (`sha256(token).slice(0,8)`) — cambio de una línea, sin exponer la credencial |
| **R15** | **`main.ts` acumula tres fuentes de eventos y un `finally` de tres pasos.** Es el archivo con más razones para cambiar del repo | Acotado: los tres wirings están extraídos a `build-on-*.ts` con test propio; `main.ts` solo los conecta | Si crece una cuarta fuente, el disparador es extraer una función `startAdapters()` |
| **R16** | **El link de confirmación no se puede reenviar** desde la base: no persistimos a dónde (ADR 18, punto 4) | Aceptado. El **link** sí es recuperable (`SELECT token_confirmacion`); el destinatario no | Recuperación manual: sacar el link y hacerlo llegar por fuera. Documentar en el cierre |
| **R17** | **`data/harness.log` contiene links de confirmación válidos** cuando el notificador está degradado (`email-omitido`) | Aceptado y **declarado**: es el precio de que la demo y el suite corran sin cuenta externa | `data/` ya está en `.gitignore`; con `EMAIL_API_KEY` configurada el evento no ocurre |
| **R18** | **`AbortSignal.timeout` y `fetch` global** se asumen presentes y tipados con `@types/node@^20` | Bajo — **ya verificado en producción**: `github-client.ts:131` los usa hoy y el suite está en verde (`engines.node >= 20`, `@types/node ^20.14.0`, ambos verificados en `package.json`) | Ninguna. Este riesgo, que en Hito 3 era R15 sin verificar, quedó cerrado por el propio Hito 3 |

---

## 12. Plan de verificación manual (entregable funcional)

El TDD corre 100% con dobles. Esto es lo que demuestra el entregable de punta a punta, y es **manual y fuera de CI** por diseño.

### 12.1 Preparación (una vez)

1. **Node 20+** (`node -v`) — ya requerido desde Hito 3.
2. **Cuenta y API key** de un proveedor de email transaccional (Resend, por el ADR 18). **El checkpoint humano debe confirmar que hay uno disponible** (R7). Sin cuenta, la demo corre igual en modo degradado y el link se saca del log — pero el camino feliz es el envío real.
3. **Exponer el puerto local**: misma herramienta de forwarding que Hito 3. Con `gh webhook forward` no alcanza (eso reenvía webhooks, no expone un puerto), así que acá va un túnel genérico — `cloudflared tunnel --url http://localhost:8080` o `ngrok http 8080`. **Ninguno es dependencia del proyecto ni entra en CI.** La URL pública resultante es la que va en `WEB_PUBLIC_URL`.
4. **`.env`** local:
   ```
   ANTHROPIC_API_KEY=...
   WEB_PORT=8080
   WEB_PUBLIC_URL=https://<host-del-tunel>
   VENTAS_API_TOKEN=<cadena aleatoria larga>
   COMISION_PORCENTAJE=0.1
   REEMBOLSO_UMBRAL=500
   VENTA_TOKEN_TTL_HORAS=72
   EMAIL_API_KEY=<la del proveedor>
   EMAIL_FROM=ventas@<dominio verificado>
   ```
5. **Un cliente HTTP** para simular al vendedor (`curl`, Bruno, Postman).

### 12.2 Guion de la demo (en este orden)

| # | Paso | Qué demuestra | Qué mirar |
|---|---|---|---|
| 1 | `npm run dev` **sin** `WEB_PORT` | Opt-in del listener (spec req. 1, Escenario de calidad 4) | TUI y webhooks arrancan normal; `web-deshabilitado` en `data/harness.log`; nada escuchando en 8080 |
| 2 | `npm run dev` con `COMISION_PORCENTAJE=1.5` | Configuración de negocio validada al arranque (spec req. 6) | El proceso **no arranca**; una línea legible en stderr; **cero** puertos abiertos |
| 3 | `npm run dev` con `.env` completo | Arranque de las tres fuentes | `web-escuchando { port: 8080 }`; la TUI sigue usable |
| 4 | `POST /ventas` **sin** header `Authorization` | Autenticación del alta (spec, escenario 3) | `401`; `SELECT count(*) FROM ventas` **no cambia** |
| 5 | `POST /ventas` con token válido y payload completo | **Entregable, mitad 1** (spec, escenario 2) | `201` con `linkConfirmacion`; filas nuevas en `vendedores`/`casos`/`ventas` con `estado='pendiente_confirmacion'`; **el email llega**; `venta-creada` en el log; **cero** eventos de modelo |
| 6 | Abrir el link del email en un navegador | Página pública | HTML con plan y monto; **sin** `caso_id` ni `cliente_id` en el fuente de la página |
| 7 | Click en "Confirmar" | **Entregable, mitad 2** (spec, escenario 8) | Página "confirmada"; `ventas.estado='confirmada'` con `confirmed_at`; **una** fila en `comisiones` con `monto = venta.monto × 0.1` y `periodo` del mes de `confirmed_at` |
| 8 | Volver atrás y reenviar el formulario (doble click) | **Idempotencia, ADR 15** (spec, escenario 10) | Página genérica "link no válido"; `SELECT count(*) FROM comisiones WHERE venta_id=?` sigue en **1**; `venta-confirmacion-ignorada` en el log |
| 9 | Crear otra venta, `UPDATE ventas SET expires_at='2020-01-01T00:00:00.000Z'`, abrir el link | Expiración (spec, escenario 6, ADR 10) | Página **byte a byte idéntica** a la del paso 8 y a la de un token inventado; `token-invalido { motivo: "vencido" }` en el log |
| 10 | `POST /devolucion` con el token de la venta del paso 7 (`monto < 500`) | Auto-aprobación (spec, escenario 14) | `{"resultado":"reembolsada"}`; `ventas.estado='reembolsada'`; **`comisiones` intacta** (R5 visible, no silenciosa) |
| 11 | Venta nueva con `monto = 1000`, confirmar, `POST /devolucion` | Escalación humana (spec, escenario 15, ADR 11) | `{"resultado":"escalada"}`; `ventas.estado='reembolso_pendiente'` **y** `casos.estado='pendiente_aprobacion_humana'`; **ningún proceso la mueve a `reembolsada`** |
| 12 | Buscar un endpoint para aprobar esa escalación | **R3, la limitación declarada** (spec, escenario 16) | No existe ninguno. La única observabilidad es el reporte del paso 15 |
| 13 | `POST /soporte` con una consulta real | Único camino con modelo (spec, escenarios 18-20) | Respuesta del agente en el cuerpo HTTP; `caso` nuevo con `tipo='soporte'`; el log muestra el turno completo correlacionado por ese `casoId` |
| 14 | Escribir en la TUI **mientras** corre el turno de soporte | Aislamiento de citas (regresión de R1 de Hito 3) | Las dos respuestas llegan; dos `casoId` distintos en el log; `conocimiento-guardado` con nodos que **no se cruzan** |
| 15 | `npm run reporte:mensual -- --periodo <mes actual>` | **Entregable, mitad 3** (spec, escenarios 22-23) | Comparativo por vendedor con total comisionado; sección de reembolsos pendientes con la venta del paso 11 y la nota de que se resuelve fuera de banda |
| 16 | Correr el reporte con `--periodo 2020-01` | Filtro de período | "sin comisiones en el periodo", **pero la sección de reembolsos pendientes sigue apareciendo** (spec: independiente del período) |
| 17 | `npm run dev` con `EMAIL_API_KEY` vacía, crear una venta | Degradación del notificador (spec, escenario 5) | `201` con `notificado: false`; `email-omitido` con el link en el log; **cero excepciones no capturadas**; el link del log funciona |
| 18 | Cortar la red (o poner `EMAIL_API_URL` a un host muerto) y crear una venta | Falla del proveedor (spec, escenario 4) | `201`; venta persistida en `pendiente_confirmacion`; `email-fallido { reason }` |
| 19 | Ctrl+C durante un turno de soporte | Cierre ordenado (ADR 14, punto 4) | El proceso espera hasta ~5 s; después `webhook.close()` y `db.close()`; sin `SQLITE_MISUSE` ni stack traces |
| 20 | `npm test` y `npm run typecheck` | Suite en verde | Todo verde; **ningún test abrió un puerto, mandó un email ni llamó al modelo** en el camino determinista |

### 12.3 Evidencia para `docs/progreso/v1.3-ventas-comisiones/`

Capturas de la página de confirmación y de la de resultado, el email recibido, la salida de `npm run reporte:mensual`, el extracto de `data/harness.log` de un ciclo completo (`grep` por un `requestId` y por su `casoId`), los `SELECT` de `vendedores`/`ventas`/`comisiones` antes y después de los pasos 7, 8 y 11, la salida de `npm test` y `npm run typecheck` en verde, y **el registro explícito de las desviaciones del plan aprobadas en el checkpoint**: `expires_at` (ADR 10 de la propuesta), la ausencia de la cola por `vendedor_id` (§8) y el alcance de R3.

---

## 13. Trazabilidad — diseño ↔ requisitos de los specs

Los 19 requerimientos, uno por fila. La cobertura escenario por escenario (24) está en §7.3.

| # | Requisito (spec) | Dónde lo resuelve este diseño |
|---|---|---|
| 1 | **venta-confirmacion** · Listener web opt-in por configuración | §4.1 (`isWebEnabled` = `port > 0`, sin default de puerto) + §4.6 (`undefined`, `createServer` nunca llamado) + §6.5(b) |
| 2 | **venta-confirmacion** · Alta de venta autenticada, sin invocar al modelo | §4.4 (auth `Bearer` con `timingSafeEqual`, `401` con token vacío) + §6.2 (`createVentaConCaso`, una transacción) + §3.4 `registrarVenta` + §6.3 (`build-on-venta.ts` **sin SDK**) + §6.1 (`cliente_id` TEXT sin FK) |
| 3 | **venta-confirmacion** · Notificación best-effort del link | §3.1 (contrato "nunca rechaza") + §5.3 (`try/catch` total, no-op sin API key) + §3.4 paso 4 + §7.2 |
| 4 | **venta-confirmacion** · Validación del token y confirmación determinista | §3.3 `validarTokenConfirmacion` (pura, `ahora` inyectado, 3 guardas) + §4.4 (respuestas indistinguibles) + ADR 20 punto 4 + §6.3 |
| 5 | **venta-confirmacion** · Transacción única con cálculo de comisión | **ADR 15** + §6.2 `confirmarVentaConComision` (CAS + `INSERT` en una `db.transaction`) + ADR 16 (redondeo y `periodo` de `confirmed_at`) |
| 6 | **venta-confirmacion** · Configuración de comisión validada al arranque | **ADR 17** + §3.2 `resolveVentasConfig` (`(0,1]`, resultado discriminado) + §6.5(a) (`HarnessBootstrapError` antes de abrir nada) |
| 7 | **reembolso-evaluacion** · Devolución requiere una venta confirmada | §3.4 `procesarDevolucion` paso 3 + §6.2 (CAS `WHERE estado = 'confirmada'` en `aprobarReembolso` y `escalarReembolso`) |
| 8 | **reembolso-evaluacion** · Evaluación determinista, sin invocar al modelo | §3.3 `evaluarReembolso` (pura) + §6.3 (mismo módulo sin SDK que el resto del camino determinista) |
| 9 | **reembolso-evaluacion** · Auto-aprobación por debajo del umbral | §3.3 (`<` estricto) + §6.2 `aprobarReembolso`; ninguna escalación creada |
| 10 | **reembolso-evaluacion** · Escalación humana por encima, sin transición automática | §6.2 `escalarReembolso` (venta + `updateCaso` en **una** transacción, ADR 11 punto 2) + §3.4 (ningún camino mueve a `reembolsada` desde `reembolso_pendiente`) + `comisiones` intacta |
| 11 | **reembolso-evaluacion** · Cierre de la escalación fuera de alcance | §4.4 (**no hay** ruta de aprobación en la tabla exhaustiva) + §3.5 (única observabilidad: el reporte, con la nota impresa) + **R3** |
| 12 | **reembolso-evaluacion** · Reembolso parcial y reversión de comisión fuera de alcance | §6.1 (sin columna de monto reembolsado) + §6.2 (`aprobarReembolso`/`escalarReembolso` **no tocan `comisiones`**) + §3.5 (`ventaEstado` en el reporte hace R5 visible) |
| 13 | **soporte-web-turno** · Único camino que invoca al modelo | **ADR 12** (handlers separados) + §6.3 (`build-on-venta.ts` sin SDK) vs. §6.4 (`build-on-soporte.ts` con SDK) + test de los cuatro endpoints con `queryFn` doble (§10) |
| 14 | **soporte-web-turno** · Creación de caso tipo `'soporte'` antes del turno | §6.4 paso 1 (`createCaso` con `CASO_TIPO_SOPORTE` **antes** de `handleTurn`) + §9.2 (`soporte-caso-creado` correlacionado por `casoId`) |
| 15 | **soporte-web-turno** · Reuso de `CONVERSATIONAL_AGENT` con prompt sintético | §3.6 `buildSoportePrompt` (pura, el framing vive acá y no en `definitions.ts`) + §6.4 paso 3; `definitions.ts` y `handle-turn.ts` **no se tocan** (§1) |
| 16 | **reporte-comisiones-mensual** · Comando bajo demanda, sin scheduler ni registro | ADR 9 de la propuesta + §6.6 (entrypoint separado, cero temporizadores, cero Registro de Comandos) |
| 17 | **reporte-comisiones-mensual** · Agregación pura por vendedor y periodo | §3.5 `agruparReporteMensual` (pura, sin base ni red) + §6.2 (el SQL **solo lee**, no agrupa — que es lo que hace verdadera la pureza) |
| 18 | **reporte-comisiones-mensual** · Listado de reembolsos pendientes | §6.2 `listVentasEnReembolsoPendiente` (**sin** filtro de período) + §3.5 (pasa tal cual, con la nota de R3 impresa en el reporte) |
| 19 | **reporte-comisiones-mensual** · Ejecutar o no el comando no afecta al resto | §6.6 (proceso separado, solo lectura, sin consumidores) + §12.2 paso 15-16 |
| — | Rollback (propuesta) | Quitar `WEB_PORT`: sin listener, sin ventas, sin comisiones; TUI y webhooks idénticos a `v1.2.0`. `0004` solo crea tablas nuevas con `IF NOT EXISTS` y no altera ninguna existente; quedan vacías y no las lee nadie más. `reporte:mensual` es un entrypoint independiente. `EMAIL_API_KEY` vacía degrada el notificador sin tocar el resto |

