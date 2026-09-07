> **Nota de proceso**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió **sin herramienta Bash disponible** (solo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por `exploration.md`, `proposal.md` y los seis archivos de `specs/` de este mismo change. Se compensó con lectura directa y verificación línea por línea de cada afirmación citada. Todo número de línea de este documento fue verificado contra el archivo real en esta sesión.

> **Historial de revisiones de este documento**
> · **Rev. 1** — diseño inicial. ADR 48-56. Developer **read-only**, con un push-back explícito contra otorgarle `Write`/`Edit`.
> · **Rev. 2** — el checkpoint pidió que el Developer escribiera código real; se diseñaron worktree aislado, `propuestas_cambio` y two-step confirm (ADR 57-61).
> · **Rev. 3 (esta) — VIGENTE.** El checkpoint verificó el texto literal del Plan y **revirtió a read-only**. Evidencia, comprobada también por este ejecutor: `docs/Plan_Implementacion_Harness_Empresarial.md:315` da el ejemplo de subagente de PRs con `tools: ['Read', 'Grep', 'Glob']`; la línea 324 define el entregable como *"el mismo caso del Hito 3 corre ahora con delegación interna entre roles"*, y el caso de Hito 3 es **revisar y comentar** un PR; y `specs/delegacion-subagentes/spec.md` sólo menciona la escritura para **prohibirla** (escenario *"El Planner no tiene herramientas de escritura"*). **El Plan no pide que el Developer escriba código.** El mecanismo de la rev. 2 no se descarta: queda documentado en §15 como candidato a `v2.1.0`, fuera de alcance de este hito.
> ADR 48-56 y RD-1 a RD-8 **siguen vigentes y aprobados**, sin cambios.

# Diseño técnico: Hito 5 — Delegación a subagentes (v2.0.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 42-47) · [`specs/`](specs/) (6 archivos) · [Plan, Hito 5](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-5-delegación-a-subagentes) (líneas 285-326) · [arc42](../../../docs/ARC42_Harness_Empresarial.md) Cajas Blancas 1.4, 2.1, 2.2.

**Rama**: `hito/v2.0-delegacion-subagentes` · **Tag**: `v2.0.0` · **Progreso**: `docs/progreso/v2.0-delegacion-subagentes/`.

**Numeración de ADR**: la propuesta cerró en el ADR 47. Este diseño abre en el **48** y llega al **56**. Los ADR 48-50 resuelven las tres ambigüedades que `sdd-spec` dejó explícitamente para esta fase; los ADR 51-56 son decisiones que aparecieron **al bajar la propuesta a firmas reales** y que la propuesta no podía anticipar. Los números **57-61 quedan reservados** para el trabajo futuro de §15, para que un `v2.1.0` los retome sin colisionar.

---

## 1. Resumen de la arquitectura elegida

Tres piezas nuevas de núcleo, cero adaptadores nuevos, cero dependencias nuevas — cuarto hito consecutivo:

```
                     ┌──────────────────────── src/core/agents/ ─────────────────────────┐
                     │ definitions.ts        AGENT_REGISTRY   (1er nivel: conversacional) │
                     │  (2.1, extendido)     SUBAGENT_REGISTRY (planner/developer/        │
                     │                                          reviewer/validador)       │
                     │ subagents.ts (2.2)    construirTareaDelegada() + InvocarSubagente   │
                     └───────────────────────────────▲───────────────────────────────────┘
                                                     │
   ┌──────── src/core/turn-selector/dispatch-delegation.ts (1.4) ─────────┐
   │  resolverDestino(agentId) : DestinoDelegacion                        │
   │     ├─ { kind: "in-process", agentId }  → crearDelegacion →          │
   │     │                                     invocar → completarDelegacion
   │     └─ { kind: "a2a", … }               → throw DelegacionA2ANo…Error│
   │  despacharCadena(roles[], deps)  ← el orden fijo vive acá            │
   └──────────▲────────────────────────────────────────────▲─────────────┘
              │                                            │
  ┌───────────┴──────────────┐                 ┌───────────┴──────────────────┐
  │ core/activity/           │                 │ core/solicitudes/            │
  │  cadena-revision.ts      │                 │  crear-solicitud-interna.ts  │
  │  (insumos por rol de PR) │                 │  resolver-solicitud-…ts      │
  │  run-activity-turn.ts    │                 │  solicitudes-contract.ts     │
  │   paso 5 ── SOLO ese     │                 └──────────────────────────────┘
  └──────────────────────────┘                              │
              │                                             │
              └────────────► src/core/hitl/hitl-contract.ts ◄──── ventas-contract.ts
                             (vocabulario + ResolucionHitlResult)     (re-export)
```

**La línea de corte del hito, en una frase**: el arnés decide **quién habla y en qué orden** (determinista, testeable sin modelo); el modelo decide **qué dice** (no determinista, aislado por invocación). Es la misma línea del ADR 7 aplicada al camino de la delegación.

**Y lo que el hito deliberadamente NO hace**: ningún subagente escribe en el filesystem. Los cuatro roles son de lectura, tal como el Plan los especifica (línea 315) y como el entregable los pide (línea 324: *"el mismo caso del Hito 3"*, que es revisar y comentar un PR). Ver §15.

---

## 2. Ambigüedad 3 resuelta — mapa capability → módulos de código

`sdd-spec` produjo **cinco** archivos de spec (uno más que los cuatro enumerados en la propuesta) y consolidó "Definición y Carga de Agentes extendida" dentro de `delegacion-subagentes`. **Confirmo ambas decisiones, sin pedir reescritura de specs**, con una precisión:

| Capability (spec) | Módulos de código reales | ¿1:1? |
|---|---|---|
| `hitl-generico` | `src/core/hitl/hitl-contract.ts` + el re-export de `ventas-contract.ts` | **Sí, 1:1.** El quinto archivo está bien creado: `hitl-contract.ts` es un módulo con requisitos propios (sin imports, re-export sin duplicar, comentario actualizado) que ningún otro capability puede reclamar. Meterlo dentro de `solicitud-interna-hitl` habría mezclado "vocabulario compartido con ventas" con "lógica de negocio de solicitudes" — exactamente el acoplamiento que el ADR 42 rechaza |
| `despacho-delegacion` | `src/core/turn-selector/dispatch-delegation.ts` | **Sí, 1:1** (arc42 1.4) |
| `delegacion-subagentes` | `src/core/agents/subagents.ts` (2.2) **+** `src/core/agents/definitions.ts` (2.1) | **1:2, aceptado.** El arc42 mantiene 2.1 y 2.2 como bloques distintos, pero el *requisito* de 2.1 en este hito ("tres definiciones reales, `description` obligatorio, `allowedTools` por rol") no tiene sentido sin 2.2 y no es verificable por separado: son un solo comportamiento observable. Un sexto archivo de spec con dos requirements de registro sería trazabilidad de papel |
| `revision-pr-por-roles` | `src/core/activity/cadena-revision.ts` (nuevo) | **1:1** para lo específico del PR |
| `activity-webhook-turn` (delta) | `src/core/activity/run-activity-turn.ts` (paso 5) | **1:1** |
| `solicitud-interna-hitl` | `src/core/solicitudes/*` + `comando-empleado.ts` + `build-on-comando-empleado.ts` | **1:N**, igual que `reembolso-resolucion-escalacion` en v1.4 |

**Cobertura**: los seis archivos de spec cubren **todo** lo que este diseño construye, y este diseño no construye nada que los specs no pidan. Verificación requirement por requirement en §13.

**Ajuste único que sí pido**: la requirement *"Cadena determinista Planner → Developer → Reviewer"* está en `despacho-delegacion/spec.md`, no en `revision-pr-por-roles`. **Se respeta tal cual** — el *orden* lo ejecuta el Despachador (`despacharCadena`, §5.4), y lo *específico del PR* (qué se le pide a cada rol) vive en `cadena-revision.ts`. No hace falta mover nada de spec.

---

## 3. Decisiones de arquitectura (ADR 48-56)

### ADR 48: `delegaciones` desvía del DDL literal del Plan — dos columnas nuevas y dos FK **nullable**, porque "registrar antes de invocar" y el DDL del Plan son **mutuamente excluyentes** en este esquema

> **APROBADO por el checkpoint humano.**

**Contexto — tres hechos verificados, no supuestos**:

1. `src/adapters/memory/db.ts:33` ejecuta `db.pragma("foreign_keys = ON")`, con el comentario *"required for the `REFERENCES` constraints in the schema to actually be checked"*. Las FK **se validan de verdad**.
2. `sesiones_agente.sdk_session_id` es `NOT NULL` (`0001:24`), y ese valor **sólo existe durante la invocación**: `invoke-model.ts:329-330` lo lee del mensaje `system`/`init` que el SDK emite dentro del `for await`. La fila de `sesiones_agente` del subagente **no puede existir antes de invocarlo**.
3. El Plan (línea 320) exige *"Se registra la delegación **antes** de invocar, y se completa `resultado` cuando el subagente responde"*, y `despacho-delegacion/spec.md` lo eleva a requisito con un escenario dedicado (*"Falla del subagente deja la fila sin `resultado`"*), que **sólo es satisfacible si la fila existe antes**.

Con `sesion_subagente_id TEXT NOT NULL REFERENCES sesiones_agente(id)` (DDL del Plan, línea 301), el `INSERT` previo a la invocación **falla con `SQLITE_CONSTRAINT_FOREIGNKEY`**, siempre. No es una preferencia de estilo: el DDL literal del Plan y el requisito del propio Plan no pueden ser ciertos a la vez.

**Decisión**. Se conservan los cinco nombres de columna del Plan y se hacen **cuatro cambios**, cada uno con su motivo:

| Cambio | Motivo |
|---|---|
| `sesion_subagente_id` pasa a **nullable** | El único modo de que "registrar antes de invocar" sea ejecutable bajo `foreign_keys = ON`. Se completa junto con `resultado`, en la **misma transacción** que inserta la fila de `sesiones_agente` del subagente (§6.3) |
| `sesion_padre_id` pasa a **nullable** | Bajo ADR 44 la delegación la decide el **Despachador**, no un turno del modelo: la cabeza de una cadena determinista **no tiene sesión padre**. Escribir un `sdk_session_id` inventado para satisfacer una FK es exactamente la "fila fantasma en `proyectos`" que el ADR 43 rechazó. `NULL` acá **significa algo**: "esta delegación la originó el arnés, no un agente". Para Developer y Reviewer la columna **sí** se llena (con la sesión del rol anterior), así que pasa a codificar la **topología de la cadena** en vez de ser uniformemente falsa |
| **+ `caso_id TEXT NOT NULL REFERENCES casos(id)`** | `revision-pr-por-roles/spec.md` exige *"tres filas con el mismo `caso_id` de correlación"*. Con el DDL del Plan ese `caso_id` sólo se deriva por `JOIN` a través de `sesion_subagente_id` — la columna que está **`NULL` exactamente cuando la delegación falló**, o sea justo cuando la trazabilidad importa. Una traza de fallo que no se puede correlacionar no es una traza |
| **+ `agent_id TEXT NOT NULL`** | Por lo mismo: con `sesion_subagente_id` en `NULL`, nada en la fila dice **qué rol** falló. `agent_id` es escribible antes de invocar y responde esa pregunta. Sin FK (no hay tabla de agentes; el registro vive en `definitions.ts`), igual criterio que `sesiones_agente.agent_id` (`0001:23`) |

**Alternativas consideradas**:

- *Insertar la fila después de invocar, respetando el DDL literal*: **rechazada**. Rompe el texto del Plan y deja el escenario "falla del subagente deja la fila sin `resultado`" sin implementación posible — una falla no dejaría fila alguna, que es precisamente el modo de falla silencioso que R11 quiere evitar.
- *Pre-insertar `sesiones_agente` con un `sdk_session_id` placeholder y actualizarlo después*: **rechazada**. `sesiones_agente` es la tabla de correlación con el SDK; escribir en ella un id que el SDK nunca emitió la vuelve mentirosa para `assembleContext`, que lee `getLatestSesionAgente` y lo usa como `options.resume`. Un `resume` contra una sesión inexistente falla en producción, no en el test.
- *Apagar `foreign_keys` para esta tabla*: **rechazada**. No existe granularidad por tabla en SQLite y apagar el pragma degradaría el esquema completo.

**Consecuencia**: la migración `0007` no es el `CREATE TABLE` textual del Plan. Es una desviación de esquema documentada, con el mismo precedente de la desviación R12 de `0005` (concedida en la revisión 3 de v1.4) y del `expires_at` del ADR 10.

### ADR 49: DDL de `solicitudes_internas` — `caso_id` con FK, actores **sin** FK, estado propio espejando el patrón de ventas

*(**Ambigüedad 1**, resuelta.)*

**Contexto**. El ADR 43 sólo fija tres cosas: tabla propia, tiene su `caso_id`, sin FK a `proyectos`. El resto es de esta fase.

**Decisión** (DDL completo en §6.2). Columna por columna, con el precedente que la justifica:

| Columna | Decisión | Precedente / motivo |
|---|---|---|
| `caso_id` | `NOT NULL REFERENCES casos(id)`, **más un índice UNIQUE** | ADR 43 punto 3. `casos` nunca se poda, así que la FK es segura (mismo criterio que `registro_acciones_empleado.caso_id`, `0005:50`). El `UNIQUE` hace **estructural** el invariante 1 solicitud ↔ 1 caso que la transacción de alta crea, en vez de dejarlo como disciplina |
| `solicitante_id` | `NOT NULL`, **SIN FK** a `credenciales_empleado` | Copia exacta del razonamiento de `registro_acciones_empleado.empleado_id` (`0005:12-18`): la única baja de empleado que el repo soporta hoy es borrar su fila de credencial (ADR 33), y una FK haría que esa baja falle o arrastre la solicitud. Una solicitud tiene que **sobrevivir** al empleado que la pidió |
| `tipo`, `estado` | `TEXT NOT NULL`, **sin `CHECK`** | Criterio de todo el esquema (`casos.estado`, `ventas.estado`, `actividades.estado`): el vocabulario canónico vive en el núcleo (`solicitudes-contract.ts`), el SQL no lo conoce |
| `detalle` | `TEXT NOT NULL` | Es el texto libre que el empleado tipeó; es lo que el validador evalúa. Sin tope de columna — SQLite no lo aplicaría; el tope real lo pone `construirTareaDelegada` (§5.3) |
| `dictamen`, `dictaminada_at` | **Nullable**, en par | `NULL` = el validador no corrió o falló. **Misma semántica que `delegaciones.resultado`**: la ausencia es la traza del fallo, no un bug (R11 de la propuesta). El spec exige que el dictamen "quede adjunto" sin transicionar — esta es la columna donde se adjunta |
| `resuelta_por`, `resuelta_at` | **Nullable**, sin FK | Sólo las escribe el CAS de `/aprobar-solicitud`/`/rechazar-solicitud`. Sin FK por lo mismo que `solicitante_id` |
| `created_at`, `updated_at` | `NOT NULL`, ISO-8601 UTC | Convención de todo el esquema |
| índice `(estado)` | Uno solo | Hay **un** patrón de lectura real: listar pendientes para `/aprobar-solicitud` sin id — espejo exacto de `listarReembolsosPendientes`. Índices por `solicitante_id` o `created_at` se agregan cuando exista una lectura que los pida (criterio de `0004`/`0005`) |

**Lo que NO tiene, a propósito**: **ninguna columna `monto`**. Una solicitud de vacaciones no tiene monto y una de gasto lo lleva dentro de `detalle` en este hito. Una columna nullable de dinero sin ningún consumidor (no hay política por monto — está fuera de alcance por el propio ADR 28/proposal) es el YAGNI que los ADR 8 y 9 ya rechazaron dos veces. Tampoco tiene `proyecto_id` — es literalmente el punto del ADR 43.

**Estados**: `solicitudes_internas.estado` ∈ `{ pendiente_aprobacion_humana, aprobada, rechazada }`. El primero **es** `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` de `hitl-contract.ts` (el spec lo exige literalmente). Los otros dos son propios de la solicitud. Espeja la mecánica de ventas: el **caso** responde sólo *"¿sigue esperando a un humano?"* (`pendiente_aprobacion_humana` → `resuelto`), la **entidad** guarda el desenlace concreto — igual que `ventas.estado` distingue `reembolsada` de `reembolso_rechazado` mientras el caso va a `resuelto` en los dos casos (`repository.ts:1470-1491`).

### ADR 50: El tipo genérico se llama `ResolucionHitlResult<TItem, TAccion>`, usa nombres de campo **neutros**, y **no** se retrofitea sobre ventas

*(**Ambigüedad 2**, resuelta.)*

**Contexto**. La propuesta describe el comportamiento ("genérico, parametrizado por el tipo del ítem, molde de `ResolverEscalacionResult`") pero no el nombre ni los campos. El molde real (`resolver-escalacion-reembolso.ts:45-60`) usa campos con **nombre de dominio**: `venta`, `ventaId`, y `estadoFinal: VentaEstado`.

**Decisión**:

1. **Nombre**: `ResolucionHitlResult<TItem, TAccion extends string, TEstadoFinal extends string>`. `Resolucion…Result` y no `Resolver…Result` porque el tipo describe **el desenlace**, no la función; `Hitl` porque es el prefijo del módulo. Junto van `MotivoNoAplicableHitl` (`"no_encontrada" | "cas"`) y sus dos constantes.
2. **Campos neutros**: `items` / `item` / `itemId`, **no** `venta`/`ventaId`. Un tipo genérico con un campo llamado `venta` es un tipo de ventas con un parámetro suelto.
3. **`ResolverEscalacionResult` NO se toca, ni se redefine como alias del genérico.** Es la consecuencia directa de la decisión anterior: alias implicaría renombrar `venta` → `item` y `ventaId` → `itemId`, y `build-on-comando-empleado.ts:368,373,385,390-397` lee `resultado.venta` y `resultado.casoId` en cinco puntos. Ese cambio rompería call sites de v1.4 — exactamente lo que el criterio de éxito *"ningún test de v1.4 se modificó"* prohíbe, y lo que el spec `hitl-generico` fija (*"su firma y su dependencia de `VentaStorePort` son idénticas"*).
4. **Consecuencia asumida**: `MotivoNoAplicable` (ventas) y `MotivoNoAplicableHitl` quedan **estructuralmente idénticos y duplicados**. Es deliberado y queda escrito acá, no descubierto por el Reviewer: el ADR 42 ya fijó que el disparador para unificar es **un tercer dominio HITL**, no el segundo. El Implementer **no debe** re-exportarlo desde ventas por su cuenta (§12, RD-3).

**Alternativa rechazada**: *tipo genérico con nombres de campo configurables por mapped type*. Complejidad de tipos para ahorrar seis literales, en un repo cuyo criterio explícito es rechazar abstracciones con menos de tres consumidores.

### ADR 51: **Dos registros** de agentes en `definitions.ts` — los subagentes NO entran en `AGENT_REGISTRY`

**Contexto**. `resolve-turn.ts:93-102` devuelve **`candidates[0]`**, literalmente el primer elemento. `bootstrapHarness` (`bootstrap.ts:53`) llena `candidates` con `listAgentDefinitions()`. Si `planner`/`developer`/`reviewer` se agregan al `AGENT_REGISTRY` existente, **el agente que atiende cada turno de la TUI conversacional pasa a depender del orden de inserción de un `Map`**. Hoy funcionaría por casualidad (el conversacional está primero, `definitions.ts:107`); un reordenamiento inocente rompería el camino más usado del arnés, sin que ningún test lo agarre.

Además, `bootstrapHarness` sólo valida `agents.length > 0`: si el conversacional se cayera del registro, el arnés arrancaría igual y le contestaría al empleado con el system prompt del **Reviewer**.

**Decisión**:

1. `AGENT_REGISTRY` **no cambia**: sigue con `CONVERSATIONAL_AGENT` y nada más. `listAgentDefinitions()`, `getAgentDefinition()`, `resolveTurn`, `bootstrapHarness` y el camino de la TUI quedan **byte por byte idénticos** a `v1.4.0`.
2. Nace `SUBAGENT_REGISTRY` con los cuatro roles delegables, y dos funciones nuevas: `getSubagentDefinition(id)` y `listSubagentDefinitions()`. Misma forma pública que las de primer nivel.
3. `toQueryOptions` (`invoke-model.ts:271`) pasa a registrar en `options.agents` **el agente que corre el turno más todos los subagentes**, manteniendo `options.agent = agent.id` para el hilo principal. Así se cumple el escenario del spec (*"`options.agents` contiene una entrada por cada uno de los cuatro"*) **sin** que el registro de primer nivel crezca.

**Alternativa rechazada**: *un solo `Map` con un campo `delegable: boolean`, y `listAgentDefinitions()` filtrando*. Funcionaría, pero deja la trampa del `candidates[0]` viva: un filtro mal escrito o un orden distinto vuelve a poner un rol de PR al frente del turno conversacional. Dos mapas hacen que ese error **no se pueda escribir**.

### ADR 52: Son **cuatro** subagentes, no tres — `validador-solicitudes` es el cuarto

**Contexto**. La propuesta enumera tres roles (ADR 44 punto 1) y el criterio de éxito dice *"`options.agents` registra el agente padre **y los tres roles**"*. Pero el entregable B, en la misma propuesta y en `solicitud-interna-hitl/spec.md`, exige un *"subagente validador (rol dedicado, invocado in-process vía `delegacion-subagentes`)"*. Tres roles + un validador dedicado = cuatro definiciones.

**Decisión**. Se declara `validador-solicitudes` como cuarta `AgentDefinition` de `SUBAGENT_REGISTRY`, con `allowedTools: []` (§5.2). No es alcance nuevo: es el rol que el entregable B ya pedía, contado bien. **El criterio de éxito de la propuesta debe leerse "el padre y los cuatro roles"** — corrección textual, no de alcance, que este diseño deja anotada para el Reviewer.

**Alternativa rechazada**: *reusar el `reviewer` como validador de solicitudes*. Su `allowedTools` y su system prompt están afinados para emitir `VEREDICTO:` sobre código; reusarlo obligaría a un prompt condicional por dominio dentro de un mismo rol — la Opción B de la exploración que el ADR 44 ya rechazó, en versión chica.

### ADR 53: El subagente **no** pasa por `assembleContext` — contexto fresco explícito, vía el puerto `InvocarSubagente`

**Contexto**. `assembleContext` (`assemble-context.ts:156-161`) resuelve `resumeSessionId` con `getLatestSesionAgente(casoId, agentId)`. Es correcto para el turno conversacional. Pero un PR que dispara el ciclo **dos veces** (reapertura, segundo `issue_comment`) reusa la misma `actividad` y el mismo `casoId` (`run-activity-turn.ts:204`). Si el Planner se invocara vía `assembleContext`, la segunda vez recibiría `options.resume` **con su propia sesión anterior** — o sea historial. El aislamiento que el hito existe para demostrar se rompería en el segundo evento, en silencio, y la columna `tarea_delegada` seguiría diciendo la verdad (sólo la tarea) mientras el modelo ve otra cosa. Es el peor modo de falla posible para este hito: la evidencia auditable seguiría verde.

**Decisión**:

1. `subagents.ts` define el puerto `InvocarSubagente` (§5.3). El núcleo no importa el SDK acá.
2. El composition root lo implementa como `invokeModel(agentDelRol, { caso, resumeSessionId: undefined }, tareaDelegada, hooks, queryFn)` — **`resumeSessionId` explícitamente `undefined`, nunca derivado de la base**. Sin `resume` no hay historial: es el default del SDK, tal como el Plan (línea 293) documenta.
3. Un test dedicado asserta que la implementación del puerto **no** llama a `memory.getLatestSesionAgente`.

### ADR 54: `RunActivityTurnDeps.runTurn` se **renombra** a `despacharRevision` con el **mismo tipo**; el interruptor de degradación vive en el composition root

**Contexto**. ADR 47 exige contener el cambio en un paso de nueve. El tipo actual, `(casoId: string, prompt: string) => Promise<ActivityTurnOutcome>` (`run-activity-turn.ts:73`), **ya es exactamente el tipo que la cadena necesita**: entra el caso y el prompt sintético, sale texto final + etiqueta de agente.

**Decisión**:

1. **El tipo no cambia. El nombre sí.** `runTurn` → `despacharRevision`. En `run-activity-turn.ts` cambian **dos líneas** (la desestructuración de `deps` y la llamada del paso 5) más el doc-comment de la secuencia. Pasos 6-9, `ActivityTurnOutcome`, `RunActivityTurnResult` y el invariante "7 antes de 8-9": **intactos**.
2. **Por qué renombrar y no dejar `runTurn`**: si el campo conserva el nombre, el composition root puede seguir cableando el `handleTurn` único de `v1.2.0` y **todos los tests pasan igual** — el entregable del hito quedaría sin demostrar y sin diff que lo delate. El rename convierte "se cableó la cadena" en algo que el compilador verifica. Es el mismo criterio del ADR 45 punto 3: la diferencia entre hecho y no hecho tiene que ser visible por diff.
3. **Interruptor de degradación** (Rollback Plan punto 1): `build-on-activity.ts` decide **qué closure** bindea a `despacharRevision` según `HARNESS_DELEGACION_ROLES` (`"off"` ⇒ el `handleTurn` único de Hito 3; cualquier otro valor o ausente ⇒ la cadena). El núcleo **no** conoce la variable — se resuelve en el composition root, precedente del ADR 17.
4. `run-activity-turn.test.ts` cambia **la clave del doble inyectado**, no los asserts — exactamente el escenario del delta de `activity-webhook-turn`.

### ADR 55: **Una sola** ranura `confirmacionPendiente`, ahora unión discriminada por dominio

**Contexto**. `build-on-comando-empleado.ts:212-214` declara literalmente *"Las DOS ranuras del closure (ADR 31, 36)"*: `sesion` y `confirmacionPendiente`. `ConfirmacionPendiente` (líneas 88-96) está tipada al dominio reembolso (`accion: AccionEscalacion`, `ventaId`, `monto`).

**Decisión**. Se **ensancha el tipo**, no se agrega una tercera ranura:

```ts
type ConfirmacionPendiente =
  | { readonly dominio: "reembolso"; readonly accion: AccionEscalacion; readonly ventaId: string;
      readonly casoId: string; readonly monto: number; readonly empleadoId: string; readonly expiraEn: string }
  | { readonly dominio: "solicitud"; readonly accion: AccionSolicitud; readonly solicitudId: string;
      readonly casoId: string; readonly empleadoId: string; readonly expiraEn: string };
```

**Por qué una sola ranura**: con dos, un empleado podría tener a la vez un `/aprobar-reembolso` y un `/rechazar-solicitud` pendientes de confirmación, y el eco que leyó hace dos minutos no le diría cuál está a punto de confirmar. La ranura única **es** la garantía de que hay como mucho una acción destructiva armada por vez; duplicarla la disuelve. Además preserva el invariante del ADR 31 tal como está escrito ("exactamente dos ranuras privadas") y las purgas ya existentes (`/login` y `/logout` la limpian, líneas 241 y 273) siguen cubriendo los dos dominios sin tocar una línea.

### ADR 56: El parser gana **una forma nueva** (`id_opcional_solicitud`), no un campo de configuración

**Contexto**. `comando-empleado.ts:215-228` explota una propiedad no obvia: como los tres descriptores con `forma: "id_opcional"` comparten la **misma clave de payload** (`ventaId`), `as const satisfies readonly DescriptorInterno[]` permite `return { tipo, ventaId }` sin ningún cast, y el compilador rechaza un descriptor incompatible ahí mismo (el propio comentario lo documenta). Agregar `/aprobar-solicitud` con clave `solicitudId` a esa misma forma **rompe ese narrowing**.

**Decisión**. Se agrega `forma: "id_opcional_solicitud"` con su propia rama, que devuelve `{ tipo, solicitudId }`. Una forma por **shape de payload**, no por comando.

**Alternativa rechazada**: *`campoId: "ventaId" | "solicitudId"` en `DescriptorInterno` y construcción dinámica de la clave*. Obliga a un cast (`{ [descriptor.campoId]: id }` no narrowea a la unión), y ese cast es exactamente la garantía que el comentario de la línea 217-226 se tomó el trabajo de conseguir sin casts. Cambiar un chequeo de compilador por un cast para ahorrar seis líneas es un mal negocio.

---

## 4. Flujos completos

### 4.1 Entregable A — bot de PRs por roles

```
webhook GitHub ──▶ github-mapper ──▶ keyed-queue(proyectoId) ──▶ runActivityTurn
                                                                     │
  pasos 1-4 (SIN CAMBIOS): findActividad → createCasoConActividad? → leerMetadatos → buildActivityPrompt
                                                                     │
  paso 5 (NUEVO) ─────────── despacharRevision(casoId, prompt) ──────┤
      │                                                              │
      │  cadena-revision.ts → despacharCadena([planner, developer, reviewer])
      │       ┌──────────────────────────────────────────────────────────────┐
      │       │ por cada rol, en dispatch-delegation.ts:                       │
      │       │  a. resolverDestino(rolId)          → { kind:"in-process" }    │
      │       │  b. construirTareaDelegada(rol, insumo)                        │
      │       │  c. store.crearDelegacion({id, casoId, agentId, sesionPadreId?,│
      │       │                            tareaDelegada, createdAt})  ◄─ ANTES│
      │       │     log `delegacion-iniciada`                                  │
      │       │  d. await invocarSubagente({agent, casoId, tareaDelegada})     │
      │       │  e. store.completarDelegacion({delegacionId, sesion, resultado})│
      │       │     (UNA transacción: INSERT sesiones_agente + UPDATE)  ◄ DESPUÉS
      │       │     log `delegacion-completada` (+ parentToolUseId si vino)    │
      │       └──────────────────────────────────────────────────────────────┘
      │       insumo del Developer = SALIDA del Planner (texto), NO su sesión
      │       insumo del Reviewer  = SALIDA del Developer (texto), NO su sesión
      │       sesionPadreId: planner=∅ · developer=sesión(planner) · reviewer=sesión(developer)
      ▼
  ActivityTurnOutcome { responseText: <salida del Reviewer>, agentLabel: "reviewer" }
      │
  pasos 6-9 (SIN CAMBIOS): parseVeredicto → transicionarEstado → updateActividadEstado
                            → publicarRevision → mirrorEstado
```

Los tres roles son de **lectura**: el ciclo produce una revisión publicada como comentario y una transición de estado, exactamente el caso de Hito 3 (Plan, línea 324). **Ningún rol escribe en el filesystem ni toca el repositorio.**

**Falla de cualquier rol**: `despacharCadena` **no captura**. El error sube por `despacharRevision` → paso 5 → `runActivityTurn` propaga tal como propagaba `runTurn` (`run-activity-turn.ts:233-235` ya documenta *"Propaga sin llamar a nada más después"*) → `build-on-activity.ts:238` lo traga y loguea `actividad-turno-fallido`. La fila de `delegaciones` del rol que falló queda **con `tarea_delegada`, sin `resultado` y sin `sesion_subagente_id`**: la traza completa del fallo, con `caso_id` y `agent_id` legibles (ADR 48). Las filas de los roles anteriores quedan completas. Ningún método del `store` de actividad ni del `board` se invoca.

### 4.2 Entregable B — solicitud interna con HITL

```
/solicitar vacaciones "una semana en marzo"    (sesión vigente exigida)
   │
   ├─ crearSolicitudInterna()  → store.crearSolicitudConCaso(...)   UNA transacción:
   │                              INSERT casos(estado=pendiente_aprobacion_humana)
   │                            + INSERT solicitudes_internas(estado=pendiente_aprobacion_humana)
   │     log `solicitud-creada`
   │
   ├─ await despacharDelegacion(validador-solicitudes, tarea = tipo + detalle)   ← §5.4
   │     └─ fila de `delegaciones` con el caso_id de la solicitud
   │     log `solicitud-validada`
   │
   └─ store.adjuntarDictamen({ solicitudId, dictamen, dictaminadaAt })
        ★ SIN transición automática ★ — la solicitud sigue `pendiente_aprobacion_humana`

/aprobar-solicitud <id>            (1er paso) → eco, CERO escrituras
/aprobar-solicitud <id>            (2do paso) → resolverSolicitudInterna(confirmado: true)
   └─ store.aprobarSolicitud(...)  UNA transacción:
        CAS UPDATE solicitudes_internas SET estado='aprobada'
            WHERE id=@ AND estado='pendiente_aprobacion_humana' RETURNING …
        + updateCaso(casoId, 'resuelto')
        + insertAccionEmpleado(comando='/aprobar-solicitud', resultado='aprobada')
      CAS no matchea ⇒ undefined ⇒ NADA se escribió (molde exacto de repository.ts:1403-1455)
```

Si la delegación al validador **falla**, la solicitud ya existe y queda sin dictamen (`dictamen IS NULL`) — el humano puede resolverla igual. El comando responde con el aviso, no revienta la TUI: `crearSolicitudInterna` degrada el fallo del validador a evento `solicitud-validacion-fallida`, **igual que `manejarSoporte` degrada un fallo de `onSoporte`** (`build-on-comando-empleado.ts:290-296`). El efecto de negocio (la solicitud existe) ya ocurrió; mentir sobre él sería peor (ADR 40).

---

## 5. Núcleo — módulos y firmas

### 5.1 `src/core/hitl/hitl-contract.ts` (nuevo) — **sin imports**

```ts
/* Vocabulario HITL compartido (ADR 42). Segundo dueño: solicitud interna. */
export const CASO_ESTADO_PENDIENTE_APROBACION_HUMANA = "pendiente_aprobacion_humana";
export const CASO_ESTADO_RESUELTO = "resuelto";

export const MOTIVO_NO_ENCONTRADA = "no_encontrada";
export const MOTIVO_CAS = "cas";
export type MotivoNoAplicableHitl = typeof MOTIVO_NO_ENCONTRADA | typeof MOTIVO_CAS;

/** Molde genérico del desenlace de una resolución HITL (ADR 50). Campos NEUTROS. */
export type ResolucionHitlResult<TItem, TAccion extends string, TEstadoFinal extends string> =
  | { readonly resultado: "listado"; readonly accion: TAccion; readonly items: readonly TItem[] }
  | { readonly resultado: "requiere_confirmacion"; readonly accion: TAccion; readonly item: TItem }
  | { readonly resultado: "aplicada"; readonly accion: TAccion; readonly item: TItem;
      readonly estadoFinal: TEstadoFinal }
  | { readonly resultado: "no_aplicable"; readonly accion: TAccion;
      readonly motivo: MotivoNoAplicableHitl; readonly itemId?: string; readonly casoId?: string };
```

`ventas-contract.ts:49-63` se reemplaza por:

```ts
/**
 * Estos dos valores YA NO viven acá (Hito 5, ADR 42): con dos dueños semánticos
 * — ventas y solicitud interna — dejaron de ser vocabulario de ventas y se
 * mudaron a `src/core/hitl/hitl-contract.ts`. Se re-exportan para que ningún
 * call site de `v1.4.0` cambie; NO se redeclaran acá.
 */
export { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA, CASO_ESTADO_RESUELTO } from "../hitl/hitl-contract.js";
```

Nota: esto convierte `ventas-contract.ts` en un módulo **con un import**, contra su propio doc-comment de la línea 12 (*"Este archivo no importa nada"*). Ese doc-comment se actualiza en el mismo change (ADR 46) para decir que la única excepción es el re-export del vocabulario HITL. `hitl-contract.ts` **sí** cumple la regla de cero imports.

### 5.2 `src/core/agents/definitions.ts` (modificado)

`AgentDefinition` gana `readonly description: string` **obligatorio**. `CONVERSATIONAL_AGENT` gana el suyo (`"Agente conversacional del arnés: sostiene el diálogo con el empleado y consulta la base de conocimiento interna."`) — **único cambio** a esa constante; `systemPrompt` y `allowedTools` quedan idénticos, incluida la frase *"Todavía no tenés delegación a otros agentes"*, que **sigue siendo verdadera para él** (no se le agrega ninguna tool de delegación).

Los cuatro subagentes (`SUBAGENT_REGISTRY`, ADR 51):

| id | `description` | `allowedTools` | Por qué ese recorte (ADR 4) |
|---|---|---|---|
| `planner` | `"Analiza el cambio de un PR y produce el plan de revisión: qué revisar, en qué archivos y con qué criterio. No emite veredicto."` | `["Read", "Glob"]` | Necesita **enumerar** (`Glob`) y **leer** los archivos que el PR nombra para armar el checklist. No necesita búsqueda transversal: planificar no es investigar. Cero escritura, cero `Bash` |
| `developer` | `"Ejecuta el plan de revisión sobre el código: rastrea impacto y produce hallazgos concretos. No emite veredicto."` | `["Read", "Glob", "Grep"]` | Es el único rol que debe **rastrear call sites y propagación** de cada ítem del plan: `Grep` es literalmente esa herramienta. **Sin escritura** — ver la nota de alcance abajo |
| `reviewer` | `"Emite el veredicto final de una revisión de PR en una única línea VEREDICTO: aprobado\|observado\|resuelto."` | `["Read"]` | **El más acotado de los tres, a propósito.** Juzga los hallazgos que le llegan en su `tarea_delegada`; darle `Glob`/`Grep` lo habilitaría a re-investigar por su cuenta y **sustituir en silencio el trabajo de la cadena** — la cadena dejaría de significar algo. Además es el único rol cuya salida se **parsea por máquina** (`VEREDICTO_PREFIX`), así que su superficie tiene que ser la mínima |
| `validador-solicitudes` | `"Evalúa si una solicitud interna (vacaciones o gasto) está completa y cumple las reglas conocidas, y emite un dictamen. No aprueba ni rechaza."` | `[]` | **Cero herramientas.** Juzga texto contra reglas que están en su system prompt. Una solicitud de vacaciones no tiene nada que ver con el filesystem del repo; darle `Read` sería superficie regalada |

**Ninguno** de los cuatro incluye `Agent`/`Task` en `allowedTools` — es lo que satisface, estructuralmente, la requirement *"Un solo nivel de profundidad de delegación"*: no hay vía para que un subagente delegue.

**Nota de alcance — el Developer NO escribe código en este hito, y es lo que el Plan pide.** Los cuatro roles son de lectura. Tres verificaciones contra la fuente, no una opinión de diseño:

1. **El Plan da el ejemplo él mismo** (línea 315): el `AgentDefinition` del subagente de PRs que el Plan escribe lleva `tools: ['Read', 'Grep', 'Glob']`. Solo lectura, textual.
2. **El entregable funcional** (línea 324) es *"el mismo caso del Hito 3 corre ahora con delegación interna entre roles"*. El caso de Hito 3 es **revisar un PR y publicar un veredicto**; nunca escribió una línea de código.
3. **Los specs sólo mencionan la escritura para prohibirla**: `delegacion-subagentes/spec.md` tiene el escenario *"El Planner no tiene herramientas de escritura"*. Ningún requirement de los seis archivos pide que un rol escriba.

A esto se suma que ADR 4 es literal — **otorgar una herramienta es auto-aprobarla, sin confirmación humana por llamada** — y que a este agente lo dispara un **webhook**, sin persona presente y sin sandbox en el repo. Darle `Write`/`Edit` sería alcance que el Plan no pide, con superficie de ataque que el proyecto no necesita. El mecanismo completo para hacerlo bien **existe, fue diseñado y evaluado**, y está resumido en **§15** como candidato a `v2.1.0`.

### 5.3 `src/core/agents/subagents.ts` (nuevo — arc42 2.2)

```ts
/** Tope duro del texto delegado (mitigación de R2). No es configurable: es un
 *  invariante de la evidencia — `delegaciones.tarea_delegada` tiene que caber
 *  en una lectura humana para servir de auditoría del aislamiento. */
export const TAREA_DELEGADA_MAX_CHARS = 8_000;
export const TAREA_TRUNCADA_SUFIJO = "\n[…tarea truncada por tope de tamaño…]";

export interface InsumoDelegado {
  /** Qué tiene que hacer este rol, en una o dos líneas. */
  readonly instruccion: string;
  /** El material acotado: metadatos del PR, o la SALIDA de texto del rol anterior. NUNCA una sesión. */
  readonly material: string;
}

/** PURA. Ensambla el texto que se persiste TAL CUAL en `delegaciones.tarea_delegada`. */
export function construirTareaDelegada(rol: AgentDefinition, insumo: InsumoDelegado): string;

export interface InvocacionSubagenteResult {
  readonly responseText: string;
  readonly sdkSessionId: string;
  /** Correlación cuando el SDK lo trae (spec). Ausente no bloquea nada. */
  readonly parentToolUseId?: string;
}

/** Puerto (I5 por rol). El composition root lo cierra sobre `invokeModel` con
 *  `resumeSessionId: undefined` explícito — ADR 53. */
export type InvocarSubagente = (input: {
  readonly agent: AgentDefinition;
  readonly casoId: string;
  readonly tareaDelegada: string;
}) => Promise<InvocacionSubagenteResult>;
```

`construirTareaDelegada` es **una función pura y el único constructor** de ese texto. Que sea única es lo que hace verificable el criterio de éxito *"ninguna `tarea_delegada` persistida contiene el historial del agente padre"*: hay **un** punto donde mirarlo, y `InsumoDelegado.material` es un `string` plano — no hay ningún tipo por el que un historial pueda entrar.

### 5.4 `src/core/turn-selector/dispatch-delegation.ts` (nuevo — arc42 1.4)

```ts
export type DestinoDelegacion =
  | { readonly kind: "in-process"; readonly agentId: string }
  | { readonly kind: "a2a"; readonly agentId: string; readonly endpoint: string };

/** PURA y SÍNCRONA. Cero `await`, cero I/O, cero red — test explícito de sincronía. */
export function resolverDestino(agentId: string): DestinoDelegacion;

/** ÚNICO punto del sistema donde el brazo A2A falla (ADR 45 punto 2).
 *  Hito 6: reemplazar el `throw` por el Cliente A2A y BORRAR el test que lo asserta. */
export class DelegacionA2ANoImplementadaError extends Error {
  constructor(destino: Extract<DestinoDelegacion, { kind: "a2a" }>) { … }
}
export class SubagenteDesconocidoError extends Error { … }

export interface DelegacionStorePort {
  /** ANTES de invocar. Falla RUIDOSAMENTE (criterio de `ActivityStorePort`). */
  crearDelegacion(input: {
    readonly id: string; readonly casoId: string; readonly agentId: string;
    readonly sesionPadreId?: string; readonly tareaDelegada: string; readonly createdAt: string;
  }): void;
  /** DESPUÉS. UNA transacción: INSERT `sesiones_agente` + UPDATE `delegaciones` (ADR 48). */
  completarDelegacion(input: {
    readonly delegacionId: string;
    readonly sesion: { readonly id: string; readonly casoId: string; readonly agentId: string;
                       readonly sdkSessionId: string; readonly createdAt: string };
    readonly resultado: string;
  }): void;
}

export interface DespacharDelegacionDeps {
  readonly store: DelegacionStorePort;
  readonly invocar: InvocarSubagente;
  readonly getSubagente: (id: string) => AgentDefinition | undefined;
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

export interface DelegacionAplicada {
  readonly agentId: string;
  readonly delegacionId: string;
  readonly sesionSubagenteId: string;
  readonly tareaDelegada: string;
  readonly resultado: string;
}

/** UNA delegación, de punta a punta. Ver §4.1 pasos a-e. */
export async function despacharDelegacion(input: {
  readonly casoId: string; readonly agentId: string; readonly insumo: InsumoDelegado;
  readonly sesionPadreId?: string;
}, deps: DespacharDelegacionDeps): Promise<DelegacionAplicada>;

/** La CADENA determinista (spec `despacho-delegacion`). Fold sobre `despacharDelegacion`:
 *  el `sesionSubagenteId` del paso N es el `sesionPadreId` del paso N+1; el `material`
 *  del paso N+1 es el `resultado` del paso N. La cabeza va SIN `sesionPadreId`. */
export async function despacharCadena(
  eslabones: readonly Eslabon[],
  input: { readonly casoId: string },
  deps: DespacharDelegacionDeps,
): Promise<readonly DelegacionAplicada[]>;
```

`resolverDestino` en este hito devuelve `in-process` para todo id de `SUBAGENT_REGISTRY`. **La rama `a2a` no es alcanzable por producción y eso está bien**: es exactamente lo que el ADR 45 pide (*"la bifurcación existe, está tipada y está testeada"*). El test la ejercita construyendo el destino a mano y llamando a `despacharDelegacion` con él — un test, un `throw`, un contrato con el Hito 6 verificable por diff.

### 5.5 `src/core/activity/cadena-revision.ts` (nuevo) y `run-activity-turn.ts` (modificado)

```ts
export const ROL_PLANNER = "planner";
export const ROL_DEVELOPER = "developer";
export const ROL_REVIEWER = "reviewer";

/** Las tres instrucciones, en orden fijo. La del Reviewer es la ÚNICA que menciona
 *  `VEREDICTO_PREFIX` — así el "un solo veredicto" es estructural, no una esperanza. */
export function construirEslabonesRevision(promptActividad: string): readonly Eslabon[];

/** Devuelve el MISMO `ActivityTurnOutcome` que devolvía `runTurn`. */
export async function despacharRevisionPorRoles(
  casoId: string, prompt: string, deps: DespacharDelegacionDeps,
): Promise<ActivityTurnOutcome>;
```

`despacharRevisionPorRoles` corre `despacharCadena`, toma **el último eslabón** (Reviewer) y devuelve `{ responseText: ultimo.resultado, agentLabel: ROL_REVIEWER }`.

**Que sólo el Reviewer emita `VEREDICTO:` se garantiza por construcción, no por prompt**: `VEREDICTO_PREFIX` sólo aparece en la instrucción del Reviewer, y `parseVeredicto` sólo ve el texto del Reviewer porque `despacharRevisionPorRoles` **descarta** las salidas intermedias antes de devolver. Aunque el Planner alucinara una línea `VEREDICTO:`, ese texto nunca llega a `parseVeredicto`.

Cambio exacto en `run-activity-turn.ts` — **cuatro ediciones, ninguna en los pasos 6-9**:

| Línea actual | Cambio |
|---|---|
| `73` (`readonly runTurn: …`) | Renombre a `despacharRevision`, **mismo tipo**, doc-comment nuevo |
| `158` (desestructuración) | `runTurn` → `despacharRevision` |
| `235` (`await runTurn(...)`) | `await despacharRevision(actividad.casoId, prompt)` |
| `147` (doc de la secuencia) | El paso 5 pasa a describir la cadena |

`activity-contract.ts:24` cambia **sólo el comentario** de `ACTIVIDAD_TIPOS` (ADR 46/43): pasa a decir que `solicitud_interna` **sigue sin ejercitarse sobre `actividades`** porque `actividades.proyecto_id` es `NOT NULL REFERENCES proyectos(id)` (`0003:32`) y una solicitud de vacaciones no tiene proyecto — tabla propia, migración `0008`.

### 5.6 `src/core/solicitudes/` (nuevo)

**`solicitudes-contract.ts`** — importa **sólo** de `../hitl/hitl-contract.js` (núcleo → núcleo, mismo cruce que `resolver-escalacion-reembolso.ts` → `../auth/sesion.js`):

```ts
export const SOLICITUD_TIPO_VACACIONES = "vacaciones";
export const SOLICITUD_TIPO_GASTO = "gasto";
export const SOLICITUD_TIPOS = [SOLICITUD_TIPO_VACACIONES, SOLICITUD_TIPO_GASTO] as const;
export type SolicitudTipo = (typeof SOLICITUD_TIPOS)[number];

export const SOLICITUD_ESTADO_PENDIENTE = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA; // ← HITL
export const SOLICITUD_ESTADO_APROBADA = "aprobada";
export const SOLICITUD_ESTADO_RECHAZADA = "rechazada";
export type SolicitudEstado = …;

export const LIMITE_LISTADO_SOLICITUDES = 20;   // espejo de LIMITE_LISTADO_ESCALACIONES

export interface SolicitudInterna {
  readonly id: string; readonly casoId: string; readonly solicitanteId: string;
  readonly tipo: SolicitudTipo; readonly detalle: string; readonly estado: SolicitudEstado;
  readonly dictamen?: string; readonly dictaminadaAt?: string;
  readonly resueltaPor?: string; readonly resueltaAt?: string;
  readonly createdAt: string; readonly updatedAt: string;
}

/** SÍNCRONO (better-sqlite3), como `VentaStorePort`/`ActivityStorePort`. Falla RUIDOSAMENTE. */
export interface SolicitudStorePort {
  crearSolicitudConCaso(input: CrearSolicitudConCasoInput): SolicitudInterna;   // 1 transacción
  adjuntarDictamen(input: { solicitudId: string; dictamen: string; ahora: string }): SolicitudInterna | undefined;
  listarSolicitudesPendientes(filtro?: { solicitudId?: string; limite?: number }): readonly SolicitudInterna[];
  aprobarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;   // CAS + caso + fila
  rechazarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;
}
```

**`crear-solicitud-interna.ts`** — `async` (delega al validador). Valida `tipo ∈ SOLICITUD_TIPOS` **antes** de escribir nada; tipo desconocido ⇒ `{ resultado: "tipo_desconocido" }`, cero escrituras.

**`resolver-solicitud-interna.ts`** — **PURA y SÍNCRONA**, molde literal de `resolverEscalacionReembolso` (cero `await`, test explícito de sincronía), y devuelve el genérico del ADR 50:

```ts
export const ACCION_APROBAR_SOLICITUD = "aprobar";
export const ACCION_RECHAZAR_SOLICITUD = "rechazar";
export type AccionSolicitud = typeof ACCION_APROBAR_SOLICITUD | typeof ACCION_RECHAZAR_SOLICITUD;

export type ResolverSolicitudResult =
  ResolucionHitlResult<SolicitudInterna, AccionSolicitud, SolicitudEstado>;

export function resolverSolicitudInterna(
  input: { accion: AccionSolicitud; solicitudId?: string; confirmado: boolean; sesion: SesionEmpleado },
  deps: { store: SolicitudStorePort; newId: () => string; now: () => string; logEvent: …; limiteListado?: number },
): ResolverSolicitudResult;
```

`sesion: SesionEmpleado` y no `empleadoId: string` — **ADR 37 de v1.4**: el invariante "todo `empleadoId` que llega a un caso de uso privilegiado fue autenticado" se expresa en el **tipo**.

### 5.7 `comando-empleado.ts` y `registro-acciones-contract.ts` (modificados)

Tres descriptores nuevos; los ocho existentes **no se tocan** (orden preservado, los nuevos van antes de `/ayuda`, que sigue último):

| Nombre | `uso` | `privilegiado` | `forma` | `tipo` |
|---|---|---|---|---|
| `/solicitar` | `/solicitar <tipo> <detalle>` | **`true`** | `id_mas_resto` | `solicitar` |
| `/aprobar-solicitud` | `/aprobar-solicitud [solicitudId]` | `true` | `id_opcional_solicitud` | `aprobar_solicitud` |
| `/rechazar-solicitud` | `/rechazar-solicitud [solicitudId]` | `true` | `id_opcional_solicitud` | `rechazar_solicitud` |

`/solicitar` es **privilegiado**: el spec exige sesión vigente, y `esComandoPrivilegiado` (`comando-empleado.ts:148-150`) ya es la única fuente de verdad que el guard del dispatcher consulta (`build-on-comando-empleado.ts:449`). Marcarlo `true` **es** la implementación del requisito — cero líneas en el guard. Ese es justamente el diseño que v1.4 dejó preparado.

`ComandoEmpleado` gana tres variantes:
```ts
| { readonly tipo: "solicitar"; readonly tipoSolicitud: string; readonly detalle: string }
| { readonly tipo: "aprobar_solicitud"; readonly solicitudId?: string }
| { readonly tipo: "rechazar_solicitud"; readonly solicitudId?: string }
```
`tipoSolicitud: string` (no `SolicitudTipo`): el parser es **puro y sin imports** por contrato (`comando-empleado.ts:1-6`) — no puede importar `solicitudes-contract.ts`. La validación del tipo es del caso de uso (§5.6), donde además hay dónde loguear el rechazo.

`registro-acciones-contract.ts` suma **datos, sin cambio de contrato**: `COMANDO_SOLICITAR`, `COMANDO_APROBAR_SOLICITUD`, `COMANDO_RECHAZAR_SOLICITUD`, `RESULTADO_CREADA`. `RESULTADO_APROBADA`/`RESULTADO_RECHAZADA`/`RESULTADO_NO_APLICABLE` se **reusan** (ya existen, líneas 21-24).

### 5.8 `invoke-model.ts` (modificado)

1. **`toMainThreadAgentDescription` se elimina** (líneas 211-228) junto con su test. `toSdkAgentDefinition` pasa a `description: agent.description`.
2. `toQueryOptions` registra múltiples agentes:
   ```ts
   const options: Options = {
     agent: agent.id,
     agents: { [agent.id]: toSdkAgentDefinition(agent),
               ...Object.fromEntries(subagentes.map((s) => [s.id, toSdkAgentDefinition(s)])) },
   };
   ```
   `subagentes` entra como parámetro con default `listSubagentDefinitions()` — **mismo patrón DI** que `candidates` en `resolve-turn.ts:91` y `queryFn` acá mismo: producción omite, el test inyecta. `options.allowedTools` (auto-aprobación) sigue derivándose **sólo** del agente del hilo principal: un subagente registrado pero no invocado no debe auto-aprobar nada.
3. `InvokeModelResult` gana `readonly parentToolUseId?: string`, leído de los mensajes que lo traigan. **Aditivo y opcional**: ningún consumidor actual cambia. Su ausencia no bloquea nada (escenario del spec).
4. El doc-comment de las **líneas 6-9** se reescribe (ADR 46/44): el Despachador ya existe (`dispatch-delegation.ts`) y procesar un `tool_use` de delegación **emitido por el modelo** queda fuera de alcance **con motivo** (el SDK ejecuta la tool `Agent` puertas adentro; interceptarla implicaría reimplementar la ejecución del subagente y perder el aislamiento nativo que el hito demuestra). Las líneas 126-132, que apuntan a `toMainThreadAgentDescription`, se reescriben para decir que `description` ahora es campo obligatorio del núcleo.

---

## 6. Persistencia

### 6.1 Migración `0007_delegaciones.ts` (nueva)

La última migración existente es **`0006_credenciales_empleado.ts`** (verificado en `migrations/index.ts:6,30`), así que la numeración correcta es `0007`/`0008`.

```sql
CREATE TABLE IF NOT EXISTS delegaciones (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  agent_id TEXT NOT NULL,
  sesion_padre_id TEXT REFERENCES sesiones_agente(id),
  sesion_subagente_id TEXT REFERENCES sesiones_agente(id),
  tarea_delegada TEXT NOT NULL,
  resultado TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegaciones_caso ON delegaciones(caso_id);
```

Un solo índice, por `caso_id`: hay **un** patrón de lectura real — "las delegaciones de este caso, en orden", que es el que alimenta la evidencia de `docs/progreso/`. Criterio de `0004`/`0005`.

> **Desviación respecto del SQL del Plan (líneas 298-306)**: dos columnas agregadas (`caso_id`, `agent_id`) y dos `NOT NULL` relajados. **Justificación completa y verificada en el ADR 48** — el DDL literal del Plan es incompatible con el propio requisito del Plan de "registrar antes de invocar" bajo `foreign_keys = ON` (`db.ts:33`) y `sesiones_agente.sdk_session_id NOT NULL` (`0001:24`). **Aprobada por el checkpoint humano.**

### 6.2 Migración `0008_solicitudes_internas.ts` (nueva — ADR 43 + ADR 49)

```sql
CREATE TABLE IF NOT EXISTS solicitudes_internas (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  solicitante_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  detalle TEXT NOT NULL,
  estado TEXT NOT NULL,
  dictamen TEXT,
  dictaminada_at TEXT,
  resuelta_por TEXT,
  resuelta_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_caso ON solicitudes_internas(caso_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_internas(estado);
```

**Sin `proyecto_id` y sin FK a `proyectos`** — es el punto entero del ADR 43. **Sin FK sobre `solicitante_id`/`resuelta_por`** — ADR 49, precedente de `0005`.

Las dos migraciones se agregan **al final** de `migrations/index.ts` (nunca se editan ni reordenan las existentes — convención documentada en `index.ts:14-18`).

### 6.3 `repository.ts` — funciones nuevas

```ts
export function insertDelegacion(db, input: {
  id; casoId; agentId; sesionPadreId?; tareaDelegada; createdAt }): void;

/** UNA transacción (ADR 48): INSERT `sesiones_agente` + UPDATE `delegaciones`.
 *  Molde EXACTO de `resolverEscalacionTransaccional` (líneas 1403-1455). */
export function completarDelegacion(db, input: {
  delegacionId; sesion: CreateSesionAgenteInput; resultado: string }): void;

export function listDelegacionesPorCaso(db, casoId: string): readonly DelegacionRow[];

export function crearSolicitudConCaso(db, input): { caso: Caso; solicitud: SolicitudRow };  // 1 transacción
export function adjuntarDictamenSolicitud(db, input): SolicitudRow | undefined;
export function listSolicitudesInternas(db, filtro): readonly SolicitudRow[];
export function aprobarSolicitudInterna(db, input: ResolucionSolicitudDbInput): SolicitudRow | undefined;
export function rechazarSolicitudInterna(db, input: ResolucionSolicitudDbInput): SolicitudRow | undefined;
```

`aprobar/rechazarSolicitudInterna` comparten un `resolverSolicitudTransaccional(db, input, config)` privado, **calcado** de `resolverEscalacionTransaccional` (`repository.ts:1403-1455`), con el mismo invariante que hace la línea 1435-1437 (`if (!row) return undefined;` **antes** de tocar el caso): no existe una transición exitosa sin su fila de auditoría, ni una fila sin su transición.

`completarDelegacion` **no** reusa `createSesionAgente` con dos llamadas sueltas: la fila de `sesiones_agente` y el `UPDATE` de `delegaciones` van en la misma `db.transaction`, porque una sesión huérfana sin su delegación completada es exactamente el estado intermedio que la tabla existe para descartar.

### 6.4 Composition root

**`build-on-activity.ts`**: `runTurn:` → `despacharRevision:`, cableado según el interruptor del ADR 54.

```ts
const delegacionDeps: DespacharDelegacionDeps = {
  store: createDelegacionStore(db),
  invocar: async ({ agent, casoId, tareaDelegada }) =>
    invokeModel(agent, { caso: { id: casoId, … }, resumeSessionId: undefined },  // ← ADR 53
                tareaDelegada, hooks),
  getSubagente: getSubagentDefinition,
  newId, now,
  logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields, logDeps),
};

// ADR 54 — el núcleo no conoce la variable; el composition root elige el closure.
const despacharRevision: RunActivityTurnDeps["despacharRevision"] =
  delegacionRolesActiva
    ? (casoId, prompt) => despacharRevisionPorRoles(casoId, prompt, delegacionDeps)
    : (casoId, prompt) => { const k = createKnowledge(casoId); return handleTurn(casoId, prompt, { … }); };
```

Nótese: en el camino de roles **no se construye `createKnowledge`**. Ninguno de los tres roles tiene el tool de conocimiento en su `allowedTools` (§5.2), así que armar el adaptador MCP por caso sería infraestructura sin consumidor — y su `CitedNodesRecorder` quedaría sin drenar. Con el interruptor en `off`, el camino de v1.2/v1.4 lo sigue construyendo, idéntico.

**`build-on-comando-empleado.ts`**: se suman `solicitudStore`, `delegacionDeps` (con `invocar` cerrado sobre el `validador-solicitudes`) y tres `case` al `switch` (líneas 455-472). `manejarSolicitud` / `manejarResolucionSolicitud` calcan `manejarEscalacion` (líneas 330-408), incluida la lógica de `confirmacionPendiente` con el discriminante `dominio` (ADR 55) y la escritura **fuera** de transacción sólo en el caso `no_aplicable`/`cas` (líneas 389-403).

---

## 7. Logging (Concepto Transversal 3)

Eventos nuevos, **sin cambiar el contrato de `logTurnEvent`** — mismo criterio de los Hitos 2, 3, 4 y v1.4:

| Evento | `casoId` | Campos |
|---|---|---|
| `delegacion-iniciada` | caso real | `agentId`, `delegacionId`, `tareaChars` (**longitud**, nunca el texto) |
| `delegacion-completada` | caso real | `agentId`, `delegacionId`, `sdkSessionId`, `resultadoChars`, `parentToolUseId?` |
| `delegacion-fallida` | caso real | `agentId`, `delegacionId`, `message` |
| `solicitud-creada` | caso de la solicitud | `solicitudId`, `tipo` |
| `solicitud-validada` | caso de la solicitud | `solicitudId`, `dictamenChars` |
| `solicitud-validacion-fallida` | caso de la solicitud | `solicitudId`, `message` |
| `solicitud-listada` | `"tui-comando"` | `accion`, `cantidad` |
| `solicitud-resolucion-solicitada` | caso | `accion`, `solicitudId` |
| `solicitud-resolucion-no-aplicable` | caso o `"tui-comando"` | `accion`, `solicitudId`, `motivo` |
| `solicitud-aprobada` / `solicitud-rechazada` | caso | `solicitudId`, `empleadoId` |

**Nunca se loguea `tarea_delegada` ni `resultado` completos**, sólo su longitud: ese texto ya está en la base, con su `caso_id`, y duplicarlo en el log de un proceso que sostiene una TUI es ruido más superficie de fuga. Mismo criterio que `comando-empleado-recibido`, que loguea **sólo `tipo`** (`build-on-comando-empleado.ts:446`).

---

## 8. Errores y degradación

| Falla | Comportamiento | Precedente |
|---|---|---|
| Rol de la cadena falla | Propaga como falla del turno. Fila de `delegaciones` sin `resultado`; estado canónico intacto; ni `store.updateActividadEstado` ni el `board` se tocan | Contrato de Hito 3 + R11 |
| Destino `a2a` | `DelegacionA2ANoImplementadaError`, **antes** de crear ninguna fila | ADR 45 |
| `agentId` no está en `SUBAGENT_REGISTRY` | `SubagenteDesconocidoError`, antes de tocar la base | Criterio de `ActividadTipoEstadoInvalidoError` |
| Validador de solicitud falla | Se **degrada a evento**; la solicitud ya existe y queda sin dictamen. El humano la resuelve igual | ADR 40, molde de `manejarSoporte` |
| CAS de `/aprobar-solicitud` no matchea | `no_aplicable` + fila `no_aplicable` fuera de transacción. Nada más se escribe | v1.4, líneas 389-403 |
| `crearDelegacion` falla | Propaga (falla ruidosa del store): sin fila no hay trazabilidad, y una delegación sin traza es peor que una delegación que no ocurrió | `ActivityStorePort` |

---

## 9. Estrategia de testing (TDD estricto — `strict_tdd: true`)

**Regla del hito**: ningún test invoca el modelo real ni abre un puerto. La costura es `InvocarSubagente` (§5.3) — el equivalente por rol del `queryFn` de `invoke-model.ts` y del `runTurn` inyectado de `run-activity-turn.ts`.

| Módulo | Qué se testea | Necesita doble de modelo | TDD |
|---|---|---|---|
| `hitl-contract.ts` | valores de las constantes; **cero imports** (assert sobre el archivo) | No | Sí |
| `ventas-contract.ts` | el re-export resuelve al mismo literal; no hay segunda declaración de `"resuelto"` | No | Sí |
| `definitions.ts` | los cuatro subagentes existen; `description` no vacío; `allowedTools` de `reviewer ≠ developer`; **ninguno** trae `Agent`/`Task`/`Write`/`Edit`/`Bash`; `AGENT_REGISTRY` **sigue teniendo exactamente uno** (ADR 51) | No | Sí |
| `subagents.ts` | `construirTareaDelegada` pura; tope `TAREA_DELEGADA_MAX_CHARS` con truncado + sufijo | No | Sí |
| `dispatch-delegation.ts` | `resolverDestino` pura y **síncrona** (test explícito, molde de `procesar-devolucion`); brazo `a2a` lanza el error tipado **y no crea fila**; orden `crear → invocar → completar` (spy ordenado); falla del invocador deja fila sin `resultado`; cadena de 3 con `sesionPadreId` encadenado | **Doble** de `InvocarSubagente` | Sí |
| `cadena-revision.ts` | orden Planner→Developer→Reviewer; el `material` del rol N+1 **es** el `resultado` del rol N; sólo la instrucción del Reviewer menciona `VEREDICTO_PREFIX`; el outcome devuelve la salida del Reviewer | Doble | Sí |
| `run-activity-turn.ts` | **los tests existentes**, cambiando la clave del doble; se agrega uno que asserta que una falla del Developer no invoca `store`/`board` | Doble | Sí |
| `invoke-model.ts` | `options.agents` con 5 entradas; `options.agent` sigue siendo el principal; `options.allowedTools` **no** incluye tools de subagentes; `toMainThreadAgentDescription` no existe; `parentToolUseId` opcional | `queryFn` fake (ya existe) | Sí |
| `solicitudes/*` | tipo desconocido ⇒ cero escrituras; sin sesión ⇒ rechazo; `resolverSolicitudInterna` **síncrona** (test explícito); listado / eco / CAS / `no_aplicable` | Doble para `crear-…` | Sí |
| `comando-empleado.ts` | los tres comandos nuevos; `/solicitar` sin detalle ⇒ `ayuda/argumentos`; `esComandoPrivilegiado` `true` para los tres; `/ayuda` lista once | No | Sí |
| `build-on-comando-empleado.ts` | two-step confirm de solicitudes; **una sola** ranura (armar un reembolso y después una solicitud pisa el pendiente, ADR 55); `/login`/`/logout` la purgan | Doble | Sí |
| `repository.test.ts` | `0007`/`0008` aplican; `crearDelegacion` con `sesion_subagente_id` NULL **funciona** (prueba de que el ADR 48 era necesario); `completarDelegacion` atómico; CAS de solicitud + `updateCaso` + fila, todo o nada; **rollback** verificable (CAS que no matchea ⇒ ni caso ni fila) | No (SQLite `:memory:`) | Sí |
| `build-on-activity.test.ts` | el interruptor bindea el closure correcto en cada valor | Doble | Sí |

**Excepción de TDD** (`AGENTS.md`, línea 17): las dos migraciones son SQL declarativo — se escriben junto a su test de `repository.test.ts`, que **sí** va primero.

**Fuera del suite por defecto**: la verificación manual end-to-end (§10). **Ningún test del hito necesita un proceso externo, ni git, ni red** — la ausencia de escritura mantiene el suite en el mismo perfil que los cuatro hitos anteriores.

---

## 10. Verificación manual del entregable

1. **A** — `HARNESS_DELEGACION_ROLES` sin definir; forwarding de webhooks de Hito 3 sobre un PR chico. Esperado: el PR recibe una revisión y una transición de estado **equivalente a `v1.2.0`**, y `SELECT agent_id, sesion_padre_id, sesion_subagente_id, length(tarea_delegada), length(resultado) FROM delegaciones WHERE caso_id = ? ORDER BY created_at` devuelve **tres filas** en orden `planner, developer, reviewer`, la primera con `sesion_padre_id` NULL y las otras dos encadenadas, las tres con `resultado` completado.
2. **Aislamiento, leído, no confiado**: se **imprime** la columna `tarea_delegada` del Developer y del Reviewer y se verifica que no contiene el system prompt ni mensajes de sesión del rol anterior.
3. **Sin efectos sobre el repositorio**: `git status` después del ciclo completo debe estar **limpio**. Ningún rol escribe (§5.2); esta comprobación lo hace evidencia, no promesa.
4. **B** — `/login` → `/solicitar vacaciones "una semana en marzo"` → la solicitud queda `pendiente_aprobacion_humana` con dictamen adjunto → `/aprobar-solicitud <id>` (eco, sin escribir) → repetir (aplica) → `SELECT` sobre `solicitudes_internas`, `casos` y `registro_acciones_empleado`.
5. **Rollback**: `HARNESS_DELEGACION_ROLES=off`, reenviar el mismo PR, verificar comportamiento de `v1.4.0` y **cero filas nuevas** en `delegaciones`.
6. **Evidencia** en `docs/progreso/v2.0-delegacion-subagentes/`: capturas de la TUI, log estructurado y el volcado real de las tres filas de `delegaciones`.

---

## 11. Presupuesto de review (R9)

Corte para `sdd-tasks`, en el orden en que se pueden mergear:

| PR | Contenido | Estimado |
|---|---|---|
| 1 | `hitl-contract.ts` + re-export + `0007` + `dispatch-delegation.ts` + `subagents.ts` + `definitions.ts` + `invoke-model.ts` | ~400 líneas |
| 2 | `cadena-revision.ts` + paso 5 + `build-on-activity.ts` + interruptor | ~250 líneas |
| 3 | `0008` + `solicitudes/*` + comandos + dispatcher | ~450 líneas |

**Total estimado ~1100 líneas.** Cada PR es **demostrable solo**: el 1 con un test de la cadena sin `runActivityTurn`, el 2 con el bot de PRs corriendo end-to-end, el 3 con el canal TUI. El 1 es **aditivo puro** — puede quedarse mergeado aunque se reviertan el 2 y el 3.

El PR 3 roza el presupuesto de 400 líneas; si al implementarlo se pasa, el corte natural es separar la migración `0008` + `core/solicitudes/*` (3a) de los tres comandos + dispatcher (3b).

---

## 12. Riesgos residuales

| # | Riesgo | Mitigación |
|---|---|---|
| **RD-1** | **El DDL literal del Plan es inejecutable** (ADR 48) | **Resuelto**: el checkpoint aprobó la desviación, con los tres hechos verificados del ADR 48 |
| **RD-2** | Agregar los roles a `AGENT_REGISTRY` cambiaría **en silencio** qué agente atiende la TUI conversacional (`resolveTurn` = `candidates[0]`, `resolve-turn.ts:93`) | ADR 51 (dos registros) + test que asserta `listAgentDefinitions().length === 1` |
| **RD-3** | `MotivoNoAplicable` (ventas) y `MotivoNoAplicableHitl` quedan duplicados; el Implementer puede "arreglarlo" unificándolos y romper el criterio "cero tests de v1.4 tocados" | ADR 50 punto 4 lo prohíbe explícitamente. El disparador para unificar es un **tercer** dominio |
| **RD-4** | El validador es un **cuarto** rol que la propuesta contó como tres (ADR 52); el criterio de éxito de `proposal.md` dice "los tres roles" | Corrección textual anotada acá. El Reviewer debe leer "el padre y los cuatro roles" |
| **RD-5** | Reusar `assembleContext` para subagentes reintroduciría historial en el **segundo** evento del mismo PR, con la columna `tarea_delegada` diciendo la verdad igual — falla silenciosa con evidencia en verde | ADR 53 + test que asserta que el puerto no consulta `getLatestSesionAgente` |
| **RD-6** | `ventas-contract.ts` deja de ser un módulo sin imports; su propio doc-comment (línea 12) queda desactualizado | Se actualiza en este mismo change (ADR 46). `hitl-contract.ts` sí mantiene cero imports |
| **RD-7** | Tres invocaciones por PR triplican costo/latencia frente a Hito 3 (R2 de la propuesta) | `TAREA_DELEGADA_MAX_CHARS = 8000` como tope duro; `allowedTools` mínimo por rol; el camino de roles **no** monta el adaptador de conocimiento; interruptor de degradación disponible |
| **RD-8** | `delegacion-subagentes` cubre dos bloques de arc42 (2.1 y 2.2) en un solo spec | Aceptado (§2). Trazabilidad explícita en §13 |

---

## 13. Trazabilidad — requirement de spec ↔ diseño

Verificación completa: **los seis archivos de spec, requirement por requirement**. No hay requirement sin implementación, ni módulo de este diseño sin requirement que lo pida.

| Spec / Requirement | Dónde se implementa |
|---|---|
| `despacho-delegacion` · `DestinoDelegacion` unión + función pura | §5.4 `resolverDestino` |
| `despacho-delegacion` · brazo A2A con error tipado, sin adaptador | §5.4 `DelegacionA2ANoImplementadaError`; §9 test dedicado |
| `despacho-delegacion` · registro antes / completado después | §5.4 `crearDelegacion`/`completarDelegacion`; **ADR 48** |
| `despacho-delegacion` · cadena determinista Planner→Developer→Reviewer | §5.4 `despacharCadena` |
| `despacho-delegacion` · `parent_tool_use_id` como correlación | §5.8 punto 3 + evento `delegacion-completada` (§7) |
| `delegacion-subagentes` · `tarea_delegada` sin historial | §5.3 `construirTareaDelegada` (único constructor, `material: string`) |
| `delegacion-subagentes` · invocación con `AgentDefinition` propia | §5.3 `InvocarSubagente`; **ADR 53** |
| `delegacion-subagentes` · resultado sin transformación de negocio | §5.4 `DelegacionAplicada.resultado` (texto crudo) |
| `delegacion-subagentes` · un solo nivel de profundidad | §5.2: ningún rol tiene `Agent`/`Task` |
| `delegacion-subagentes` · tres `AgentDefinition` con `description` obligatorio | §5.2 (+ **ADR 52**: son cuatro) |
| `delegacion-subagentes` · `CONVERSATIONAL_AGENT` sin cambios de comportamiento | §5.2 + **ADR 51** (registro de primer nivel intacto) |
| `delegacion-subagentes` · `allowedTools` acotado por rol (ADR 4) | §5.2 tabla. Escenario *"El Planner no tiene herramientas de escritura"*: **ningún rol** tiene `Write`/`Edit`, verificado por test (§9) |
| `delegacion-subagentes` · retiro de `toMainThreadAgentDescription` | §5.8 puntos 1 y 4 |
| `revision-pr-por-roles` · veredicto único del Reviewer | §5.5 (garantía estructural, no de prompt) |
| `revision-pr-por-roles` · pasos 6-9 sin cambios de forma | §5.5 tabla de cuatro ediciones |
| `revision-pr-por-roles` · tres filas con el mismo `caso_id` | §6.1 columna `caso_id` (**ADR 48**) |
| `revision-pr-por-roles` · el entregable de Hito 3 corre sin reescribir el Despachador | §4.1 + §10 paso 1; **ADR 45** punto 3 (test del brazo A2A como contrato de Hito 6) |
| `activity-webhook-turn` (delta) · el paso 5 despacha la cadena | **ADR 54** + §5.5 |
| `activity-webhook-turn` (delta) · `ActivityTurnOutcome` mantiene su forma | **ADR 54** punto 1 (el tipo no cambia) |
| `activity-webhook-turn` (delta) · el veredicto proviene del Reviewer | §5.5 (las salidas intermedias se descartan) |
| `hitl-generico` · módulo sin imports | §5.1 |
| `hitl-generico` · re-export sin duplicar ni romper call sites | §5.1 + §9 |
| `hitl-generico` · comentario actualizado | §5.1 (ADR 46) |
| `hitl-generico` · tipo genérico del desenlace | **ADR 50** `ResolucionHitlResult` |
| `hitl-generico` · `resolverEscalacionReembolso` no se generaliza | **ADR 50** punto 3 |
| `solicitud-interna-hitl` · `/solicitar` transaccional con sesión vigente | §5.6 `crearSolicitudConCaso`; §5.7 `privilegiado: true` |
| `solicitud-interna-hitl` · validador sin transición automática | §4.2 + §6.2 (`dictamen` nullable, estado intacto) |
| `solicitud-interna-hitl` · el validador no ve historial de otras solicitudes | §5.3 (`material` = tipo + detalle de esa solicitud) |
| `solicitud-interna-hitl` · two-step confirm con eco | §5.6 `resolverSolicitudInterna`; **ADR 55** |
| `solicitud-interna-hitl` · tabla propia sin `proyectos` | §6.2; **ADR 49** |
| `solicitud-interna-hitl` · cualquier empleado autenticado resuelve | §5.6: sin chequeo de jerarquía, `SesionEmpleado` como único gate |

---

## 14. Preguntas abiertas para el checkpoint humano

1. **ADR 52 — son cuatro subagentes.** ¿Se corrige el criterio de éxito de `proposal.md` ("los tres roles" → "los cuatro roles") o se documenta como aclaración del diseño?
2. **ADR 54 — nombre y valores del interruptor** `HARNESS_DELEGACION_ROLES` (`off` = comportamiento `v1.4.0`). ¿Se documenta en el `README`?
3. **§15 — trabajo futuro.** ¿Se abre ya un change de `openspec/` para `v2.1.0`, o queda como sección de este documento hasta que haya un caso de uso que lo pida?

**Cerradas por el checkpoint**, anotadas para el Reviewer:

- **ADR 48** (desviación de esquema de `delegaciones`) — **aprobada**.
- **Developer con `Write`/`Edit`** — **rechazada**, con evidencia del Plan (líneas 315 y 324) y de los specs. El hito es read-only; el mecanismo alternativo queda en §15.
- **Spec de `propuesta-cambio-hitl`** — **ya no hace falta**. Esa capability salió del alcance junto con la escritura; los seis specs existentes cubren el 100 % de este diseño (§13).

---

## 15. Trabajo futuro (fuera de alcance de este hito) — candidato a `v2.1.0`

Durante la revisión 2 de este documento se diseñó **completo** el mecanismo para que el rol `developer` escribiera código real de forma segura. El checkpoint humano decidió **no construirlo en `v2.0.0`** porque el Plan no lo pide (líneas 315 y 324) y ningún requirement de los seis specs lo requiere. Queda acá el resumen ejecutivo para que el trabajo de diseño no se pierda si un hito futuro lo retoma. **Nada de esta sección se implementa en este hito.**

**El mecanismo, en dos párrafos.** El Developer recibiría `["Read","Glob","Grep","Write","Edit"]` — **nunca `Bash`**, porque todo el aislamiento descansa en `options.cwd` y una shell lo evapora con un `cd ..`. Escribiría dentro de un **`git worktree` descartable por caso** (rama `harness/caso-<casoId>-<uuid>`), creado por un adaptador nuevo `src/adapters/git/` con la misma estructura de cuatro archivos y el mismo patrón de subproceso que `src/adapters/knowledge/graphify-cli.ts` (`ExecFileFn` inyectable, `execFile` nunca `exec`, error tipado con `reason` clasificado). El puerto viviría en `src/core/agents/worktree-contract.ts`, con contrato asimétrico deliberado: `abrir`/`capturarDiff` fallan ruidosamente, `cerrar` nunca rechaza. Ciclo `abrir → Developer → capturarDiff` con `cerrar` en un `finally`, más un **barrido de huérfanos al arranque** filtrado por el prefijo de rama y un TTL — porque el `finally` no corre ante un `SIGKILL`. Es viable **gracias al ADR 53**: como cada rol es su propia llamada a `query()`, cada rol tiene su propio `Options` y por lo tanto su propio `cwd`.

El diff se capturaría con `git diff` **dentro** del worktree y se persistiría en una **tabla propia `propuestas_cambio`** (migración `0009`), no en una columna de `delegaciones`: lo que produce el Developer tiene máquina de estados, aprobador, motivo de rechazo e índice de listado — mismo argumento que el ADR 43 usó contra reusar `actividades`. El Reviewer juzgaría el **patch persistido**, no el worktree vivo, para que `propuestas_cambio.patch` sean los mismos bytes que el Reviewer leyó, que el eco resume y que `git apply` escribe. Y nada llegaría al checkout real sin **two-step confirm humano** por comandos TUI privilegiados (`/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta`), con el molde exacto de `/aprobar-reembolso` — TUI y no webhook, porque un webhook no puede autenticar al empleado y `registro_acciones_empleado.empleado_id` es `NOT NULL` por construcción (ADR 28). "Aplicar" se detendría en `git apply` sobre el working tree: **sin commit, sin push, sin PR**, porque `AGENTS.md` línea 78 lo prohíbe *"ni siquiera con el Reviewer ya aprobado"*.

**Lo que hay que saber antes de retomarlo**:

- **Numeración reservada**: ADR **57-61** (worktree · tabla propia del diff · Reviewer juzga el patch persistido · confirmación TUI y límite de "aplicar" · tools y scoping del Developer). Riesgos **RD-9 a RD-15**. El detalle completo está en el historial de este archivo (revisión 2).
- **Riesgo residual honesto**: `options.cwd` es un **anclaje de alcance, no un sandbox de SO**. La garantía dura no es el `cwd` sino la **topología**: el único camino al checkout real es `git diff` dentro del worktree → confirm humano → `git apply`; lo escrito afuera no se captura, no se muestra y no se aplica.
- **Sin transacción entre SQLite y filesystem** (RD-13): un crash entre el CAS y el `git apply` deja la propuesta marcada `aplicada` sin cambios en el árbol. Se eligió sobre el riesgo opuesto (doble-apply) porque es **detectable** (`git status`) y **reversible** (el patch sigue persistido).
- **Costo real**: ~930 líneas adicionales, 3 PRs más (adaptador git · propuestas + `0009` · comandos), y una **categoría de test nueva para este repo** — integración contra un proceso `git` real en `src/test/integration/`, que además obliga a corregir `openspec/config.yaml` (hoy declara `testing.layers.integration: false`, ya falso desde Hito 1). También pediría agregar `.harness/` al `.gitignore`.
- **Limitación conocida del alcance propuesto**: con `Write`/`Edit` pero sin `Bash`, el Developer podría editar pero **no correr los tests de lo que escribió**. La salida correcta no es otorgar `Bash` — es una tool MCP acotada del arnés que corra `npm test` dentro del worktree y devuelva la salida. Eso es alcance adicional a decidir explícitamente.
- **Precondición de proceso**: sería una **capability nueva** (`propuesta-cambio-hitl`) sin requirements escritos. `AGENTS.md` pone la especificación antes del diseño, así que retomarlo exige correr `sdd-spec` primero — un spec propio más una delta sobre `delegacion-subagentes` para el `allowedTools` del Developer.

---

**Nota de formato**: la skill `sdd-design` sugiere un tope de 800 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2-bot-revision-prs/design.md`, `hito-1.3-ventas-comisiones/design.md`, `tui-canal-empleado/design.md`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato técnico completo del hito y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto, igual que en `proposal.md`.
