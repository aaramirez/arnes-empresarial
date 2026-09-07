# Propuesta: Hito 5 — Delegación a subagentes (v2.0.0)

**Origen**: [Plan de Implementación, Hito 5](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-5-delegación-a-subagentes) (líneas 285-326) · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Blanca 1.4 (Despachador de Delegación), 2.1 (Definición y Carga de Agentes), 2.2 (Delegación a Subagentes), Escenario de ejecución 3, ADR 1 (v2 = swarm) · [exploration.md](exploration.md).

**Rama prevista**: `hito/v2.0-delegacion-subagentes` · **Tag de cierre**: `v2.0.0` · **Carpeta de progreso**: `docs/progreso/v2.0-delegacion-subagentes/`.

## Aclaración previa: qué NO es este hito

La ronda anterior de planificación arrastraba una premisa equivocada que la exploración corrigió y que esta propuesta deja fijada por escrito, para que no se re-litigue:

**R3 / ADR 11 de Hito 4 (cierre de la escalación de reembolso) YA ESTÁ CERRADO y no es alcance de este hito.** Lo cerró el change `tui-canal-empleado`, shippeado como `v1.4.0` y mergeado a `main` (`b733f98`). Existen `/aprobar-reembolso`, `/rechazar-reembolso` y `/reabrir-reembolso` (ADR 23/24/25/27/29), con auditoría append-only, autenticación por sesión y 978 tests en verde. `src/core/ventas/reporte.ts:158-171` ya actualizó `NOTA_ESCALACION_FUERA_DE_BANDA` para reflejarlo (ADR 26). El texto del ADR 11 que decía *"con dueño asignado (Hito 5)"* fue escrito cuando "Hito 5" era el próximo hito sin numerar; el Hito 5 **real** del Plan es otra cosa: **Delegación a subagentes**.

Lo único que sí queda como deuda del Hito 5 sobre el código de ventas es **textual y puntual**: el comentario de `src/core/ventas/ventas-contract.ts:49-63`, que promete que `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y `CASO_ESTADO_RESUELTO` *"se mudan cuando Hito 5 generalice el HITL"*. Esta propuesta lo salda explícitamente en el ADR 42 — no lo difiere de nuevo.

## Intent

Los cinco hitos anteriores construyeron un arnés donde **un turno es siempre un agente contra un prompt**: la TUI (Hito 1), el conocimiento (Hito 2), la revisión de PRs (Hito 3), el canal de empleado (v1.4). `AGENT_REGISTRY` tiene exactamente **una** entrada (`definitions.ts:106`), `toQueryOptions` registra exactamente **un** agente en `options.agents` (`invoke-model.ts:276-279`), y el system prompt del único agente termina literalmente con *"Todavía no tenés delegación a otros agentes."* (`definitions.ts:96`). Los tres archivos que el arc42 reserva para la delegación — `dispatch-delegation.ts` (1.4), `subagents.ts` (2.2) — **no existen**.

Este hito es la transición `v1 lineal → v2 swarm` del ADR 1: el arnés deja de ser un agente que responde y pasa a ser un agente que **reparte trabajo entre roles con contexto propio y acotado**, con trazabilidad de negocio de cada delegación. Y lo hace construyendo el Despachador **con la forma de Gateway desde el día uno** — con el brazo A2A presente en el tipo y en el switch aunque todavía lance "no implementado" — porque el entregable declarado del hito no es solo "corre con roles", es *"sin reescribir el Despachador cuando llegue el Hito 6"*, y eso solo es verificable si la bifurcación existe y está testeada ahora.

Además cierra dos comentarios que hoy mienten o quedarán desactualizados: el de `ventas-contract.ts:49-63` (HITL genérico) y el de `invoke-model.ts:6-9` (*"eso pertenece al Despachador de Delegación (Hito posterior)"* — el hito posterior es este).

## Scope

### In Scope

- **Despachador de Delegación** en `src/core/turn-selector/dispatch-delegation.ts` (bloque 1.4): tipo `DestinoDelegacion` como unión discriminada `{ kind: "in-process" } | { kind: "a2a" }`, función pura de resolución de destino, y despacho con **el brazo A2A presente y lanzando un error tipado** `DelegacionA2ANoImplementadaError` (ADR 45). Registra la delegación **antes** de invocar y completa `resultado` **después** (texto del Plan, línea 320).
- **Delegación a Subagentes** en `src/core/agents/subagents.ts` (bloque 2.2): construcción del `tarea_delegada` acotado por rol, invocación in-process del subagente contra su propia `AgentDefinition`, y devolución del resultado al despachador. Sin historial del padre — el aislamiento es el default del SDK, no algo que este módulo fuerce (hallazgo del Plan, línea 293).
- **Tres roles reales en `definitions.ts`** (bloque 2.1): `planner`, `developer`, `reviewer`, cada uno con su `systemPrompt`, su `description` (nuevo campo obligatorio, ADR 44) y su `allowedTools` **acotado por rol**. `CONVERSATIONAL_AGENT` **no se toca**.
- **`AgentDefinition` gana `description: string` obligatorio** y `toMainThreadAgentDescription` (`invoke-model.ts:226`) se retira: con subagentes reales, `description` deja de ser un placeholder y pasa a ser dato de ruteo (ADR 44).
- **`toQueryOptions` registra múltiples agentes** en `options.agents` — el padre más los roles delegables — en vez del único de hoy.
- **Bot de PRs por roles**: el paso 5 de `runActivityTurn` (`run-activity-turn.ts:235`) deja de ser un `runTurn` único y pasa a ser una **cadena determinista Planner → Developer → Reviewer** despachada por 1.4. Los pasos 6-9 (`parseVeredicto` → `transicionarEstado` → `store.updateActividadEstado` → espejo al tablero) **no cambian**: el veredicto sigue siendo uno solo, emitido por el Reviewer (ADR 47).
- **Solicitud interna con HITL** por el **canal TUI de empleado** (ADR 43): `/solicitar` (alta por el empleado, con un **subagente validador** que evalúa la solicitud contra las reglas), y `/aprobar-solicitud` / `/rechazar-solicitud` (resolución por un humano autenticado), reusando `parsearComando`, `SesionEmpleado`, la confirmación en dos pasos y `RegistroAccionesEmpleadoPort` que v1.4 ya construyó.
- **Vocabulario HITL compartido** en `src/core/hitl/hitl-contract.ts` (ADR 42): `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y `CASO_ESTADO_RESUELTO` **se mudan acá**; `ventas-contract.ts` los re-exporta para no romper ningún call site, con el comentario actualizado.
- **Migración `0007_delegaciones.ts`**: la tabla `delegaciones` tal como el Plan la define (líneas 298-306), con las dos FK a `sesiones_agente`.
- **Migración `0008_solicitudes_internas.ts`**: tabla propia para la solicitud interna (ADR 43) — **no** se reusa `actividades`, por el mismo motivo que el ADR 11 ya documentó y el repo ya aceptó.
- **Eventos nuevos de `logTurnEvent`** (`delegacion-iniciada`, `delegacion-completada`, `delegacion-fallida`, `solicitud-creada`, `solicitud-validada`, `solicitud-aprobada`, `solicitud-rechazada`), sin cambiar el contrato del logger — mismo criterio que Hitos 2, 3, 4 y v1.4.
- **Actualización de los tres doc-comments que quedan desactualizados**: `invoke-model.ts:6-9`, `ventas-contract.ts:49-63`, `activity-contract.ts:24` (ADR 46 — se actualizan en este mismo change, criterio del ADR 26).

### Out of Scope

- **Delegación decidida por el modelo vía `tool_use`.** El Despachador arma `tarea_delegada` **explícitamente** (texto del Plan, línea 320) y la cadena de roles es determinista. Procesar un `tool_use` de delegación emitido por el modelo queda fuera. Ver ADR 44 y R3.
- **`src/adapters/a2a/`, JSON-RPC, Agent Card, cualquier dependencia de A2A.** El brazo A2A de este hito es **una rama del switch y un error tipado en el núcleo**, nada más. Hito 6.
- **Delegación anidada** (un subagente que delega a otro). Un solo nivel de profundidad, verificado por el propio despachador.
- **Delegación en el camino de la TUI conversacional.** `CONVERSATIONAL_AGENT` conserva su `allowedTools` y su system prompt actual — incluida la frase *"Todavía no tenés delegación a otros agentes"*, que sigue siendo verdadera para él.
- **Generalizar `resolverEscalacionReembolso` a un resolvedor de aprobaciones genérico.** Ver ADR 42 y R5: se muda el **vocabulario**, no se reescribe el caso de uso que acaba de shippear.
- **Reintentos, timeouts o presupuesto de tokens por delegación.** Una falla del subagente propaga como falla del turno, igual que hoy propaga `runTurn`.
- **Ejercitar `ACTIVIDAD_TIPO_SOLICITUD_INTERNA`.** La solicitud interna **no** pasa por `actividades` (ADR 43); la constante queda como el tercer valor legal del esquema, con su comentario actualizado para decir por qué sigue sin uso.
- **Flujo de aprobación multinivel, delegación de aprobador, o política de quién puede aprobar qué.** Cualquier empleado autenticado puede resolver, igual que en v1.4 (ADR 28) — misma limitación, mismo riesgo aceptado.
- **Dependencias nuevas en `package.json`.**
- **Cerrar el hueco de proceso de `v1.3.0`** (falta tag y `docs/progreso/v1.3-ventas-comisiones/`). Visible, ajeno a este hito. Ver R10.

## Capabilities

> El repo no tiene `openspec/specs/` — cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Los nombres de abajo son los que `sdd-spec` debe crear bajo esa ruta.

### New Capabilities

- `despacho-delegacion`: resolución del destino de una delegación (in-process vs. A2A), despacho, registro de la fila de `delegaciones` antes de invocar y completado de `resultado` después, y el error tipado del brazo A2A todavía no implementado.
- `delegacion-subagentes`: invocación de un subagente in-process con contexto propio y acotado, construcción del `tarea_delegada` por rol, y devolución del resultado al despachador.
- `revision-pr-por-roles`: el ciclo de revisión de PRs corriendo la cadena Planner → Developer → Reviewer, con un único veredicto final emitido por el Reviewer.
- `solicitud-interna-hitl`: alta de una solicitud interna por el canal TUI, validación por subagente, y resolución (aprobar/rechazar) por un humano autenticado, con confirmación en dos pasos y fila de auditoría.

### Modified Capabilities

- `activity-webhook-turn` (Hito 3): el requisito *"el ciclo resuelve un turno del agente y parsea su veredicto"* cambia a *"el ciclo despacha una delegación por roles y parsea el veredicto del Reviewer"*. El contrato de estados, la transición y el espejo al tablero **no** cambian — cambia quién produce el texto del que sale el veredicto.

**Sin cambio de spec**: `reembolso-resolucion-escalacion`, `registro-acciones-empleado`, `autenticacion-empleado-tui`, `comando-empleado-tui`, `venta-confirmacion`, `knowledge-query`, `activity-board-mirror`. La mudanza de constantes del ADR 42 es un movimiento de módulo con re-export: cero cambio de comportamiento, cero cambio de requisito.

## Decisiones de arquitectura fijadas por esta propuesta

La exploración dejó **cuatro forks abiertos**. Esta propuesta los cierra todos acá, explícitamente, para que el checkpoint humano apruebe la dirección **antes** del diseño. La numeración continúa la del arc42 (ADR 1-2), Hito 2 (3, 3.1, 4), Hito 3 (5-10), Hito 4 (11-20) y v1.4 (21-41).

### ADR 42: El HITL genérico son el **vocabulario** y la **forma del resultado**, no un resolvedor genérico — `CASO_ESTADO_*` se mudan en este hito

*(Fork 1 de la exploración.)*

**Contexto**. `ventas-contract.ts:49-56` promete textualmente que `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` *"vive acá porque hoy tiene UN dueño semántico: ventas. Cuando Hito 5 generalice el HITL, se muda"*. Este hito le da un segundo dueño (solicitud interna). Del otro lado, `resolverEscalacionReembolso` (`resolver-escalacion-reembolso.ts`) está acoplado a `VentaStorePort`, `EscalacionListada` y `VentaEstado`, y acaba de shippear con 20 hallazgos de review cerrados.

**Decisión**. Se generaliza **lo que efectivamente pasó a tener dos dueños**, y nada más:

1. **Nace `src/core/hitl/hitl-contract.ts`**, módulo de núcleo **sin imports** (mismo criterio que `knowledge-contract.ts`, `activity-contract.ts`, `ventas-contract.ts`). Adentro: `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`, `CASO_ESTADO_RESUELTO`, y el tipo genérico del desenlace de una resolución HITL — la unión `listado | requiere_confirmacion | aplicada | no_aplicable` que `ResolverEscalacionResult` ya tiene, parametrizada por el tipo del ítem.
2. **`ventas-contract.ts` re-exporta** ambas constantes desde `hitl-contract.ts`. **Ningún call site cambia**, ningún test de v1.4 se toca, y el comentario se reescribe para decir que la mudanza ya ocurrió y dónde.
3. **`resolverEscalacionReembolso` NO se generaliza.** Conserva su `VentaStorePort` y sus tres acciones. `solicitud-interna` obtiene su **propio** caso de uso sobre su **propio** puerto, que **importa el vocabulario y la forma del resultado** de `hitl-contract.ts`.

**Alternativas consideradas**:

- *Generalización total: `resolverAprobacion<T>(store: AprobacionStorePort<T>)`, del que ventas y solicitud-interna cuelguen* (Opción A de la exploración): **rechazada**, y no por pereza. Los CAS de ambos dominios **no son la misma operación**: el reembolso tiene un ciclo de tres acciones con reapertura y un sexto estado (`reembolso_rechazado`, ADR 23/29); una solicitud de vacaciones es aprobar/rechazar sobre su propia máquina de estados. Un puerto "genérico" que cubra ambos sería la **unión** de los dos, o sea una abstracción que filtra los dos dominios a la vez — exactamente el anti-patrón que los ADR 8 y 9 rechazaron con un solo consumidor, agravado por reescribir código que acaba de pasar el gate del Reviewer.
- *Duplicar el patrón sin tocar ventas* (Opción B de la exploración): **rechazada**. Deja el comentario de `ventas-contract.ts:52-54` mintiendo para siempre. Es exactamente el modo de falla que el ADR 26 se negó a aceptar para `NOTA_ESCALACION_FUERA_DE_BANDA`, y este repo ya fijó ese precedente: *la documentación en el código se actualiza en el mismo change que la invalida*.

**Consecuencias**:

- La deuda textual del Hito 5 queda **saldada**, no diferida por segunda vez.
- Dos casos de uso HITL con **vocabulario compartido y mecánica propia**. El disparador para unificar la mecánica queda escrito: **un tercer dominio HITL cuyo CAS tenga la misma forma que uno de los dos existentes**. Con dos formas distintas, no hay abstracción que extraer todavía.
- Riesgo acotado: el movimiento es un `export ... from` verificable por `npm run typecheck` (R5).

### ADR 43: La solicitud interna entra por el **canal TUI de empleado**, con tabla propia — sin adaptador nuevo y sin reusar `actividades`

*(Fork 2 de la exploración.)*

**Contexto**. El Plan especifica el origen del evento para el Hito 3 (webhook de GitHub) y para el Hito 4 (página web del cliente), pero **para el Hito 5 no dice nada**: solo *"una solicitud interna (ej. vacaciones o gasto)"*. Es una laguna real del Plan que el Spec Author tiene que resolver.

**Decisión**. Entra por la **TUI**, como comandos del dispatcher que v1.4 construyó, y se persiste en **tabla propia**:

1. **Criterio de ruteo, el mismo que el repo ya usó tres veces**: el canal se elige por **quién es el actor**. Hito 3 → webhook, porque el actor es un sistema externo (GitHub). Hito 4 → web pública, porque el actor es un cliente fuera de la organización. v1.4 → TUI, porque el actor es **un empleado** — el change se llama, literalmente, `tui-canal-empleado`. En una solicitud de vacaciones o gasto **el solicitante y el aprobador son ambos empleados**. El criterio ya establecido da un único resultado: la TUI.
2. **Reuso, no construcción**: `parsearComando` (ADR 21), autenticación con `SesionEmpleado` + scrypt (ADR 30/37), confirmación en dos pasos con eco (ADR 25/36), y `RegistroAccionesEmpleadoPort` append-only (ADR 27) **ya existen y están testeados**. Un adaptador HTTP nuevo obligaría a inventar de cero una autenticación de empleados que la TUI ya tiene resuelta.
3. **Tabla propia `solicitudes_internas`** (migración 0008), no `actividades`. Motivo idéntico al que el ADR 11 ya documentó y el repo ya aceptó: `actividades.proyecto_id` es `NOT NULL REFERENCES proyectos(id)` (`0003:32`), y una solicitud de vacaciones no tiene proyecto — habría que inventar una fila fantasma en `proyectos` para satisfacer una FK, y encima arrastraría el espejo al tablero de GitHub a un flujo que no tiene repositorio. Reuso aparente, acoplamiento real. La solicitud sí tiene su `caso_id`, como todo en este arnés.
4. **`ACTIVIDAD_TIPO_SOLICITUD_INTERNA` sigue sin ejercitarse**, y su comentario (`activity-contract.ts:24`) se actualiza para decirlo con el motivo, en vez de dejar la promesa implícita colgada.

**Alternativas consideradas**:

- *Tercer origen en el Adaptador de Webhooks*: **rechazada**. Un webhook existe para que **un sistema externo** empuje un evento. Acá no hay sistema externo: hay un empleado tipeando. Sería un endpoint HTTP sin emisor, sin firma que verificar (el HMAC de Hito 3 no aplica) y sin autenticación propia.
- *Formulario en el Adaptador Web de Hito 4*: **rechazada**. Esa superficie es **pública y sin login** por diseño (ADR 20): su única credencial es el token de la venta. Meter ahí un flujo interno obligaría a construir sesiones de empleado en el adaptador público — la superficie de ataque más cara del proyecto, para un actor que ya tiene canal autenticado.
- *Reusar `actividades` con `tipo: 'solicitud_interna'`*: **rechazada** por la FK, con el mismo argumento verificado del ADR 11.

**Consecuencias**:

- El caso de uso 2 del Plan queda cubierto **sin ningún adaptador nuevo**: la superficie de este hito es núcleo + dos migraciones + comandos.
- La TUI se consolida como *el* canal del empleado, coherente con v1.4.
- **`solicitudes_internas` es una tabla que el Plan no enumera** — desviación documentada que el checkpoint humano debe aprobar explícitamente (R8), en la misma línea que el `expires_at` del ADR 10.

### ADR 44: Planner / Developer / Reviewer son **tres subagentes reales del SDK**, y el Despachador arma el `tarea_delegada` — no el modelo

*(Fork 3 de la exploración: confirmado, con una precisión que el fork no contemplaba.)*

**Contexto**. La exploración planteaba "tres subagentes reales de `options.agents`" vs. "un agente con distintos prompts según fase". El Plan (línea 308) y el arc42 (2.2) piden lo primero. Pero al leer el código aparece una tercera pregunta que ninguna de las dos opciones cubría: **quién decide delegar** — ¿el modelo, emitiendo un `tool_use` que interceptamos (arc42 Escenario 3, paso 1), o el Despachador, armando la tarea explícitamente (Plan, línea 320)?

**Decisión**. Subagentes reales **sí**; delegación decidida por el modelo **no, en este hito**:

1. **Tres `AgentDefinition` reales** en `definitions.ts` (`planner`, `developer`, `reviewer`), registradas en `options.agents` junto al agente padre. `toQueryOptions` (`invoke-model.ts:271`) deja de registrar un único agente.
2. **`allowedTools` acotado por rol** — el Planner no necesita las mismas herramientas que el Reviewer. ADR 4 sigue vigente y es la razón: **otorgar una herramienta es auto-aprobarla**, sin confirmación humana por llamada. El recorte por rol no es cosmético, es la decisión de autorización.
3. **`AgentDefinition` gana `description: string` obligatorio**, y `toMainThreadAgentDescription` (`invoke-model.ts:226`) se elimina. Ese helper documenta él mismo que es *"un placeholder de bajo riesgo… ningún code path lee este string para tomar una decisión de ruteo"*, y esa afirmación **deja de ser cierta en el momento en que hay más de un agente registrado**.
4. **El Despachador construye `tarea_delegada` explícitamente** y corre la cadena de roles de forma **determinista**. El texto del Plan es literal: *"El Despachador de Delegación arma explícitamente `tarea_delegada` (el prompt de la tool Agent) antes de invocar al subagente"*.
5. **El aislamiento de contexto no se implementa: se hereda.** Cada rol corre su propia invocación, con su propia sesión y su propio system prompt — el hallazgo del Plan (línea 293) es que eso es el default del SDK. `delegaciones` existe para **trazabilidad de negocio**, no para forzar un aislamiento que ya viene gratis.

**Alternativas consideradas**:

- *Un agente con tres prompts* (Opción B de la exploración): **rechazada**. No ejercita 2.2, no produce contexto aislado, y convertiría la tabla `delegaciones` en una ficción — filas que dicen "delegué" cuando nadie delegó. El entregable del hito quedaría sin demostrar.
- *Interceptar el `tool_use` de delegación que emite el modelo* (arc42 Escenario 3 literal): **rechazada para este hito, con un motivo técnico y uno de proceso**. Técnico: el SDK **ejecuta la tool `Agent` puertas adentro**; no expone un hook pre-despacho donde el núcleo pueda rutear, así que interceptar implicaría reimplementar la ejecución del subagente por nuestra cuenta — tirando a la basura justamente el aislamiento nativo que el hito quiere demostrar. De proceso: que un LLM decida en runtime si delega vuelve el entregable **no reproducible** para la demo y prácticamente intesteable bajo TDD estricto. El precedente del ADR 7 aplica igual acá: *lo determinista se resuelve determinista*.

**Consecuencias**:

- `parent_tool_use_id` (Plan, línea 320) se registra **cuando esté presente**, como dato de correlación — no es el mecanismo de despacho.
- El doc-comment de `invoke-model.ts:6-9` se actualiza: el Despachador ya existe, y procesar `tool_use` de delegación emitido por el modelo queda declarado fuera de alcance con su motivo, en vez de seguir apuntando a "un hito posterior" indefinido.
- **R3**: el checkpoint humano debe aceptar que "delegación" acá significa *el núcleo reparte trabajo entre subagentes nativos del SDK*, no *el modelo decide delegar*.

### ADR 45: El Despachador nace **con el brazo A2A en el tipo y en el switch**, lanzando un error tipado — sin `src/adapters/a2a/`

*(Fork 4 de la exploración: confirmado, y es lo que el Plan pide textualmente.)*

**Contexto**. El Plan, línea 291, es explícito: el Despachador se construye *"desde este hito con la separación estructural tipo Gateway (Delegación interna vs. A2A) aunque A2A recién se active en el Hito 6"*. El entregable, línea 324, cierra el argumento: *"sin reescribir el Despachador cuando llegue el Hito 6"*.

**Decisión**. La bifurcación existe, está tipada y está testeada:

1. **`DestinoDelegacion`** es una unión discriminada — `{ kind: "in-process"; agentId }` | `{ kind: "a2a"; … }` — resuelta por una **función pura** del núcleo.
2. **El brazo A2A lanza `DelegacionA2ANoImplementadaError`**, una clase de error con nombre propio, en **un solo punto**. No `throw new Error("TODO")` desperdigados.
3. **Un test asserta ese error explícitamente.** Ese test es el contrato con el Hito 6: cuando llegue, su trabajo es *reemplazar el `throw` por el Cliente A2A* y **borrar ese único test**. La diferencia entre "el Despachador no se reescribió" y "se reescribió" pasa a ser verificable por diff, en vez de una afirmación de buena fe.
4. **No se crea `src/adapters/a2a/`**, ni se instala nada de JSON-RPC, ni se define una Agent Card. El brazo es **núcleo puro**: I4 es un puerto que el núcleo posee, y su implementación es de Hito 6.

**Alternativas consideradas**:

- *Solo el camino in-process, y la forma del Gateway se decide en Hito 6* (Opción B de la exploración): **rechazada**. Contradice el texto del Plan, y — más grave — vuelve el entregable del hito **no verificable**: no se puede demostrar "sin reescribir el Despachador" si no hay Despachador con las dos ramas.
- *Construir un `A2AClientPort` completo con un stub que devuelve vacío*: **rechazada**. Un stub que devuelve un resultado **falso** es peor que un error: un test podría pasar en verde con delegación externa que nunca ocurrió. Fallar ruidosamente es el contrato correcto acá, coherente con `ActivityStorePort` (*"falla RUIDOSAMENTE"*).

**Consecuencias**:

- Costo real de la desviación: un tipo, una rama y una clase de error. Cero dependencias, cero adaptador, cero superficie de red.
- Queda una rama muerta hasta el Hito 6 (R4), aceptada a conciencia y con test que la documenta.

### ADR 46: Los tres doc-comments que este hito invalida se actualizan **en este mismo change**

**Contexto**. El repo ya tiene un precedente fijado (ADR 26): la documentación embebida en el código se corrige en el change que la invalida, no después.

**Decisión**. Este hito toca, además de su código:

1. `src/core/ventas/ventas-contract.ts:49-63` — la mudanza que prometía **ya ocurrió** (ADR 42); el comentario dice dónde viven ahora las constantes y por qué se re-exportan.
2. `src/core/turn-selector/invoke-model.ts:6-9` — el Despachador existe; procesar `tool_use` de delegación del modelo queda fuera de alcance **con motivo** (ADR 44).
3. `src/core/activity/activity-contract.ts:24` — *"este hito solo ejercita el primero"* pasa a decir por qué `solicitud_interna` sigue sin ejercitarse en `actividades` pese a que el hito construye solicitudes internas (ADR 43).

**Consecuencia**: cero comentarios que mientan al cerrar el hito. Es una de las cuatro condiciones que el Reviewer verifica.

### ADR 47: El paso 5 de `runActivityTurn` cambia de forma; **los pasos 6-9 no se tocan**

**Contexto**. `RunActivityTurnDeps.runTurn` es hoy `(casoId, prompt) => Promise<ActivityTurnOutcome>` — **un** turno, **un** resultado (`run-activity-turn.ts:73`). Pasar a tres roles es un cambio de forma en un módulo con tests dedicados y consumidores en el composition root (`build-on-activity.ts`). La exploración lo marcó como el riesgo de diseño real del hito.

**Decisión**. El cambio se **contiene en un solo paso** de la secuencia de nueve:

1. `runTurn` se reemplaza por una dependencia inyectada de despacho de delegación que devuelve **el mismo `ActivityTurnOutcome`** (texto final + etiqueta de agente).
2. **El veredicto lo emite el Reviewer**, y es **uno solo**. `VEREDICTO_PREFIX`, `parseVeredicto` y `transicionarEstado` (`activity-contract.ts:55`, `transicion-estado.ts`) **no cambian**.
3. Los pasos 6, 7, 8 y 9 — parseo, transición, persistencia del estado canónico y espejo al tablero — **quedan idénticos**, incluido el invariante *"7 antes de 8-9, sin excepción"*.
4. El contrato de propagación tampoco cambia: una falla de cualquier rol propaga como fallaba `runTurn`.

**Consecuencia**: `run-activity-turn.test.ts` sobrevive cambiando el doble inyectado, no reescribiendo los asserts de estado. Es lo que acota R1 de una reescritura a una sustitución.

## Approach

**Flujo del entregable A — bot de PRs por roles.** Webhook de GitHub (sin cambios) → `github-mapper` (sin cambios) → cola por `proyecto_id` (sin cambios) → `runActivityTurn` pasos 1-4 (sin cambios) → **paso 5 nuevo**: el Despachador resuelve destino `in-process`, arma el `tarea_delegada` del **Planner** (qué revisar, con los metadatos del PR), registra la fila de `delegaciones`, invoca, completa `resultado`; repite para **Developer** (con la salida del Planner como tarea acotada, **no** con su historial) y para **Reviewer**, que emite la línea `VEREDICTO:` → pasos 6-9 idénticos a Hito 3. Tres filas de `delegaciones` por PR revisado, todas con el mismo `caso_id` de correlación.

**Flujo del entregable B — solicitud interna con HITL.** `/solicitar vacaciones …` en la TUI, con sesión vigente → se crea `caso` + fila en `solicitudes_internas` en una transacción → el Despachador delega al **subagente validador** (¿la solicitud está completa?, ¿cumple las reglas conocidas?) → la solicitud queda en `pendiente_aprobacion_humana` (constante de `hitl-contract.ts`, ADR 42) con el dictamen del validador adjunto → un empleado autenticado corre `/aprobar-solicitud <id>` o `/rechazar-solicitud <id>`, con **confirmación en dos pasos y eco** (mismo patrón del ADR 25/36) → CAS + `caso` a `resuelto` + fila append-only en `registro_acciones_empleado`, **en una transacción**.

**Determinismo y no-determinismo, separados a propósito.** La **cadena** de roles es determinista (la decide el Despachador); el **contenido** de cada rol es del modelo. Es la misma línea de corte que el ADR 7 trazó para el camino del dinero, aplicada al camino de la delegación: el arnés decide *quién habla y en qué orden*, el modelo decide *qué dice*.

**Contexto acotado: el subagente recibe la tarea, no la conversación.** `tarea_delegada` se persiste tal como se envió — el Plan lo subraya (*"la tarea específica, no el historial completo"*). Eso hace que la fila de `delegaciones` sea **evidencia auditable del aislamiento**, no una afirmación: si alguien sospecha que el Developer vio el historial del Planner, la columna lo desmiente.

**Testing (TDD estricto).** La resolución de destino, la construcción del `tarea_delegada` y la máquina de estados de la solicitud interna son **funciones puras**, testeables sin SDK, sin base y sin red. La cadena de roles se testea con dobles de invocación por rol (mismo patrón que `queryFn` inyectable de `invoke-model.ts` y que `runTurn` inyectado de `run-activity-turn.ts`). El brazo A2A se testea asertando `DelegacionA2ANoImplementadaError`. **Ningún test del suite invoca el modelo real ni abre un puerto.**

**Configuración.** Los roles se registran en código (`definitions.ts`), no por env: son parte del contrato del hito, no de la operación. Si hace falta un interruptor para volver al turno único, es una variable de entorno de **degradación**, evaluada en el composition root — ver *Rollback Plan*.

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/turn-selector/dispatch-delegation.ts` | New | Bloque 1.4. `DestinoDelegacion`, resolución pura, despacho, `DelegacionA2ANoImplementadaError`, registro antes/después (ADR 45) |
| `src/core/agents/subagents.ts` | New | Bloque 2.2. Construcción de `tarea_delegada` por rol e invocación in-process del subagente (ADR 44) |
| `src/core/agents/definitions.ts` | Modified | `description` obligatorio en `AgentDefinition`; alta de `planner`/`developer`/`reviewer` con `allowedTools` por rol. `CONVERSATIONAL_AGENT` sin cambios de comportamiento |
| `src/core/turn-selector/invoke-model.ts` | Modified | `toQueryOptions` registra múltiples agentes; se retira `toMainThreadAgentDescription`; doc-comment actualizado (ADR 44, 46) |
| `src/core/hitl/hitl-contract.ts` | New | Vocabulario HITL compartido + forma genérica del resultado. Sin imports (ADR 42) |
| `src/core/ventas/ventas-contract.ts` | Modified | Re-export de las dos constantes desde `hitl-contract.ts` + comentario actualizado. **Cero cambio de comportamiento** (ADR 42, 46) |
| `src/core/solicitudes/` | New | Contrato + casos de uso de solicitud interna (alta, validación, resolución HITL), puros (ADR 43) |
| `src/core/commands/comando-empleado.ts` | Modified | Tres descriptores nuevos: `/solicitar`, `/aprobar-solicitud`, `/rechazar-solicitud` (privilegiados los dos últimos) |
| `src/core/commands/registro-acciones-contract.ts` | Modified | Constantes de comando y `resultado` para los tres comandos nuevos — datos, sin cambio de contrato |
| `src/core/activity/run-activity-turn.ts` | Modified | Paso 5: `runTurn` → despacho de delegación. Pasos 6-9 intactos (ADR 47) |
| `src/core/activity/activity-contract.ts` | Modified | Solo el comentario de `ACTIVIDAD_TIPOS` (ADR 46) |
| `src/adapters/memory/migrations/0007_delegaciones.ts` | New | Tabla `delegaciones` del Plan (líneas 298-306) |
| `src/adapters/memory/migrations/0008_solicitudes_internas.ts` | New | Tabla propia de solicitud interna (ADR 43) |
| `src/adapters/memory/repository.ts` | Modified | `crearDelegacion` / `completarDelegacion`; alta, listado y CAS de `solicitudes_internas` |
| `src/build-on-activity.ts` | Modified | Wiring del despachador en lugar del `runTurn` único |
| `src/` (dispatcher de TUI) | Modified | Wiring de los tres comandos nuevos sobre la sesión ya existente |
| `src/core/logging/turn-logger.ts` | Modified | Eventos nuevos — datos, sin cambio de contrato |
| `package.json` | — | **Sin dependencias nuevas** |

## Dependencias nuevas

**Ninguna.** El SDK ya está instalado y `options.agents` ya se usa (`invoke-model.ts:278`) — este hito pasa de una entrada a varias. `delegaciones` y `solicitudes_internas` son SQLite con el mismo `better-sqlite3` de siempre. La TUI, la autenticación y la auditoría son las de v1.4. **Cuarto hito consecutivo sin romper la racha de cero dependencias nuevas.**

## Casos de uso del Hito 5 — cobertura

Los siete requisitos que la exploración enumeró contra el Plan, y dónde los cubre esta propuesta:

| # | Caso de uso del Plan | Cubierto por | ¿En alcance? |
|---|---|---|---|
| 1 | Bot de PRs con roles separados (Planner/Developer/Reviewer) | ADR 44 + ADR 47; capability `revision-pr-por-roles` | **Sí** |
| 2 | Solicitud interna (vacaciones/gasto) con subagente validador + HITL | ADR 43 + ADR 42; capability `solicitud-interna-hitl` | **Sí** |
| 3 | Despachador de Delegación (1.4) con separación Gateway interno/A2A | ADR 45; capability `despacho-delegacion` | **Sí** |
| 4 | Delegación a Subagentes (2.2) — subagente nativo del SDK con contexto acotado | ADR 44; capability `delegacion-subagentes` | **Sí** — con la salvedad del ADR 44 punto 4 (la delegación la decide el Despachador, no el modelo). **Requiere aceptación del checkpoint (R3)** |
| 5 | Definición y Carga de Agentes (2.1) extendida a múltiples agentes | ADR 44 puntos 1-3; `definitions.ts` | **Sí** |
| 6 | Tabla `delegaciones` (trazabilidad) | Migración `0007`, escrita antes de invocar y completada después | **Sí** |
| 7 | Entregable: el caso de Hito 3 corre con delegación interna, sin reescribir el Despachador en Hito 6 | ADR 45 punto 3 (test del brazo A2A) + ADR 47 | **Sí** — y verificable por diff, no por afirmación |
| — | R3 / ADR 11 (cierre de escalación de reembolso) | Ya cerrado por `v1.4.0` | **No es de este hito** — ver *Aclaración previa* |

**Ningún caso de uso del Plan queda fuera de alcance.** Lo que queda fuera son extensiones que el Plan **no** pide para el Hito 5 (delegación decidida por el modelo, delegación anidada, A2A real), enumeradas en *Out of Scope* y en *Fuera de alcance / diferido*.

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | El cambio de forma del paso 5 de `runActivityTurn` rompe un módulo testeado y sus consumidores | **Alta** | ADR 47 contiene el cambio a **un** paso de nueve; el `ActivityTurnOutcome` y los pasos 6-9 no cambian, así que los tests de estado sobreviven cambiando el doble inyectado |
| R2 | Tres invocaciones al modelo por PR triplican costo y latencia frente a Hito 3 | Med | `allowedTools` recortado por rol y `tarea_delegada` acotada (no el historial). El diseño debe fijar un tope de tamaño de tarea; la demo corre sobre un PR chico |
| R3 | "Delegación" sin `tool_use` decidido por el modelo se lee como el hito a medias | Med | ADR 44 lo declara, con motivo técnico verificado (el SDK ejecuta la tool `Agent` puertas adentro) y de proceso (reproducibilidad + TDD). **El checkpoint humano debe aceptarlo explícitamente** |
| R4 | La rama A2A queda como código muerto hasta el Hito 6 | Baja | Es lo que el Plan pide textualmente (línea 291); un test asserta el error tipado y ese test **es** el contrato con Hito 6 (ADR 45) |
| R5 | Mudar `CASO_ESTADO_*` toca un módulo que acaba de cerrar v1.4 | Med | Re-export desde `ventas-contract.ts`: cero call sites tocados, cero tests de v1.4 tocados, verificable con `npm run typecheck` |
| R6 | `description` obligatorio en `AgentDefinition` rompe `definitions.test.ts` e `invoke-model.ts` | Baja | Hay **un** registro y **un** mapper; el compilador encuentra los dos call sites. Se retira el placeholder que el propio código declara innecesario |
| R7 | Dos flujos HITL parecidos (reembolso y solicitud) divergen con el tiempo | Med | Vocabulario y forma del resultado compartidos en `src/core/hitl/` (ADR 42); mismo two-step confirm y mismo registro append-only. El disparador para unificar la mecánica queda escrito |
| R8 | `solicitudes_internas` es una tabla que el Plan no enumera | Med | Desviación documentada con el argumento ya aceptado del ADR 11 (FK `proyecto_id NOT NULL`). **Requiere aprobación del checkpoint**, igual que el `expires_at` del ADR 10 |
| R9 | El hito cubre 7 casos de uso: el PR resultante excede de largo el presupuesto de 400 líneas de review | **Alta** | `sdd-tasks` debe forecastear y proponer **PRs encadenados** por unidad entregable — corte natural: (a) Despachador + brazo A2A, (b) roles + bot de PRs, (c) HITL genérico + solicitud interna |
| R10 | Hueco de proceso previo: no existe tag `v1.3.0` ni `docs/progreso/v1.3-ventas-comisiones/` | Baja | Ajeno a este hito; se deja anotado para que el humano decida si lo regulariza antes de tagear `v2.0.0` |
| R11 | Un subagente falla a mitad de cadena y deja filas de `delegaciones` sin `resultado` | Med | La fila sin `resultado` **es** la traza del fallo, no un bug: el error propaga como falla del turno (contrato de Hito 3) y el estado canónico no se toca. Se documenta como comportamiento esperado |

## Rollback Plan

El cambio es **casi** aditivo, con una excepción que hay que nombrar: el paso 5 de `runActivityTurn` **reemplaza** comportamiento existente (R1). Por eso el rollback tiene dos niveles:

1. **En caliente**: el composition root conserva la capacidad de inyectar el `runTurn` único de Hito 3 en lugar del despachador, tras una variable de entorno de degradación. Sin ella activa, el bot de PRs se comporta **exactamente** como `v1.2.0`/`v1.4.0`: un turno, un veredicto. Los comandos de solicitud interna simplemente no se registran en el dispatcher y `/ayuda` no los lista.
2. **Migraciones**: `0007` y `0008` solo crean tablas nuevas (`IF NOT EXISTS`), no alteran ninguna existente. Quedan vacías y no las lee nadie más. Ninguna migración anterior se modifica.
3. **A nivel git**: revertir los commits de `hito/v2.0-delegacion-subagentes` antes del merge a `main`. Si se entregó en PRs encadenados (R9), revertir en orden inverso: solicitud interna → roles → despachador; el despachador es aditivo puro y puede quedarse sin daño.

La mudanza de constantes del ADR 42 no necesita rollback propio: es un re-export, y revertirla es mover dos líneas de vuelta.

## Dependencies

- Hito 4 (`v1.3.0`) y el change `tui-canal-empleado` (`v1.4.0`) cerrados y en `main` — ya lo están (`b733f98`).
- **Los hallazgos de la segunda ronda de `/code-review` sobre `v1.4` que la exploración detectó sin commitear deben tener rama y destino resueltos antes de abrir `hito/v2.0-…`** — arrancar este hito sobre un `main` con trabajo sin commitear encima confunde el diff de review.
- SDK ya instalado, con `options.agents` en uso. Para la demo: el mismo forwarding de webhooks de Hito 3 y un PR de prueba.
- **Checkpoint humano de `AGENTS.md` aprobando esta propuesta** — en particular los **ADR 42, 43, 44, 45 y 47**, la desviación de esquema de R8, la salvedad de alcance de R3, y la estrategia de entrega de R9 — antes de `sdd-spec`/`sdd-design`.

## Success Criteria

- [ ] Un evento de PR dispara **tres** invocaciones de subagente en orden Planner → Developer → Reviewer, y quedan **tres filas** en `delegaciones` con el mismo `caso_id`, cada una con su `tarea_delegada` y su `resultado` completado.
- [ ] Ninguna `tarea_delegada` persistida contiene el historial del agente padre — se verifica leyendo la columna, no confiando en el comportamiento.
- [ ] El veredicto final lo emite el Reviewer, es **uno solo**, y la transición de estado + el espejo al tablero se comportan **idénticos a `v1.2.0`** para el mismo veredicto.
- [ ] Resolver un destino `a2a` lanza `DelegacionA2ANoImplementadaError`, con un test que lo asserta explícitamente y lo declara como contrato de Hito 6.
- [ ] `options.agents` registra el agente padre **y** los cuatro roles (Planner/Developer/Reviewer del bot de PRs, más el validador de solicitudes internas del ADR 52); cada rol tiene su propio `description` y su `allowedTools` acotado.
- [ ] `/solicitar` crea `caso` + `solicitud_interna` en una transacción, el subagente validador emite su dictamen, y la solicitud queda `pendiente_aprobacion_humana` **sin transición automática**.
- [ ] `/aprobar-solicitud` y `/rechazar-solicitud` exigen sesión vigente y confirmación en dos pasos, y dejan fila en `registro_acciones_empleado` en la **misma** transacción que el CAS.
- [ ] `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y `CASO_ESTADO_RESUELTO` viven en `src/core/hitl/hitl-contract.ts`, `ventas-contract.ts` los re-exporta, y **ningún test de v1.4 se modificó** para lograrlo.
- [ ] Los tres doc-comments del ADR 46 están actualizados; ninguno promete algo que ya ocurrió o que quedó fuera de alcance sin motivo.
- [ ] `CONVERSATIONAL_AGENT` conserva comportamiento: la TUI conversacional responde igual que en `v1.4.0`.
- [ ] `npm test` y `npm run typecheck` en verde; ningún test invoca el modelo real ni abre un puerto.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v2.0-delegacion-subagentes/` con evidencia del entregable end-to-end (incluidas las filas reales de `delegaciones`), tag `v2.0.0`.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| Delegación decidida por el modelo (`tool_use` interceptado) | Hito futuro, si aparece un caso donde el ruteo dinámico compre algo | ADR 44: el SDK ejecuta la tool `Agent` puertas adentro; interceptar implicaría reimplementar la ejecución del subagente y perder el aislamiento nativo. Además vuelve el entregable no reproducible bajo TDD |
| Cliente A2A, JSON-RPC, `src/adapters/a2a/`, Agent Card | **Hito 6**, dueño declarado por el Plan | ADR 45: el brazo existe en el tipo y en el switch con error tipado; el trabajo de Hito 6 es reemplazar un `throw`, verificable por diff |
| Delegación anidada (subagente que delega) | Hito futuro con caso real | Un nivel cubre los dos casos de uso del Plan. Profundidad arbitraria trae presupuesto de tokens, detección de ciclos y trazabilidad en árbol — infraestructura sin consumidor |
| Reintentos, timeouts y presupuesto de tokens por delegación | Deuda documentada | Hoy una falla de turno propaga (contrato de Hito 3) y la fila sin `resultado` es la traza (R11). Reintentar sin política de idempotencia sería peor que fallar |
| Resolvedor HITL genérico (unificar reembolso y solicitud) | Cuando exista un **tercer** dominio HITL cuyo CAS tenga la **misma forma** que uno de los dos actuales | ADR 42: con dos mecánicas distintas (ciclo de tres acciones con reapertura vs. aprobar/rechazar), el "puerto genérico" sería la unión de ambas. Mismo YAGNI de los ADR 8 y 9 |
| Política de quién puede aprobar qué (jerarquía, delegación de aprobador, montos por rol) | Hito futuro | Misma limitación que v1.4 (ADR 28): cualquier empleado autenticado resuelve. Riesgo ya aceptado por el proyecto, no ampliado por este hito |
| Ejercitar `ACTIVIDAD_TIPO_SOLICITUD_INTERNA` en `actividades` | Cuando exista una solicitud interna **con proyecto** | ADR 43: `actividades.proyecto_id` es `NOT NULL REFERENCES proyectos(id)`; una solicitud de vacaciones no tiene proyecto |
| Delegación desde la TUI conversacional | Hito futuro | `CONVERSATIONAL_AGENT` conserva su system prompt y sus tools. Ampliar el radio de explosión al camino más usado del arnés, en el mismo hito que introduce la delegación, no compra nada |
| Regularizar el tag `v1.3.0` y `docs/progreso/v1.3-ventas-comisiones/` | Decisión del humano | Hueco de proceso previo (R10), ajeno al alcance técnico de este hito |

## Qué necesita el checkpoint humano antes de `sdd-spec` / `sdd-design`

1. **ADR 44, punto 4 (R3)** — aceptar que la cadena de roles la decide el **Despachador**, no el modelo. Es la decisión más discutible de la propuesta: si el tutor espera ver al LLM emitiendo una tool call de delegación, hay que saberlo **ahora**, no en el review.
2. **ADR 43 y R8** — aprobar la tabla `solicitudes_internas`, que el Plan no enumera, y la elección del canal TUI como origen del evento (laguna real del Plan).
3. **ADR 42** — confirmar que `CASO_ESTADO_*` se mudan **en este hito** (con re-export), en vez de diferirlos por segunda vez.
4. **R9 / estrategia de entrega** — decidir si el hito se entrega en **PRs encadenados** (corte sugerido: despachador → roles/bot de PRs → HITL/solicitud interna) o en uno solo con `size:exception`. Con 7 casos de uso, el presupuesto de 400 líneas por PR se supera con margen.
5. **Dependencias** — confirmar el destino de los hallazgos de la 2ª ronda de code review de `v1.4` que quedaron sin commitear sobre `main`, antes de abrir la rama de este hito.

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por las exploraciones de Hito 3, Hito 4 y de este mismo change. Se compensó con lectura directa y verificación puntual de cada afirmación citada: `src/core/agents/definitions.ts` (registro de un solo agente, líneas 96 y 106), `src/core/turn-selector/invoke-model.ts` (líneas 1-25, 211-294 — `toMainThreadAgentDescription` y `toQueryOptions` con un único `agents[id]`), `src/core/activity/run-activity-turn.ts` (secuencia de nueve pasos y `RunActivityTurnDeps.runTurn`), `src/core/activity/activity-contract.ts`, `src/core/ventas/ventas-contract.ts` (líneas 44-68), `src/core/ventas/resolver-escalacion-reembolso.ts` (acoplamiento a `VentaStorePort`), `src/core/commands/comando-empleado.ts` y `registro-acciones-contract.ts` (índice de exports), `openspec/config.yaml`, `AGENTS.md`, y `docs/Plan_Implementacion_Harness_Empresarial.md:285-326` + `docs/ARC42_Harness_Empresarial.md:319-436`. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` ejecute `graphify explain` sobre los conceptos nuevos (`DestinoDelegacion`, `dispatch-delegation`, `subagents`, `hitl-contract`, `solicitudes_internas`).

**Nota de formato**: la skill `sdd-propose` sugiere un tope de 450 palabras para el artefacto. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`), que es sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato completo del hito y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto.
