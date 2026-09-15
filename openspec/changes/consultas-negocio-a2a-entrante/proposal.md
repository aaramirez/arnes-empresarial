# Propuesta: Consultas de negocio de sólo lectura para el turno A2A entrante — cerrar la brecha entre lo que el Agent Card promete y lo que el turno puede responder

**Origen**: **Observación del stakeholder de negocio**: *"el A2A entrante es un mock, sólo imprime"*. **Verificado en esta fase: la premisa es falsa, y el síntoma es real.** El turno entrante NO es un mock —despacha de punta a punta contra un LLM real— pero tiene **una sola herramienta** (`query_knowledge_base`, que consulta el vault de documentación) y **ningún acceso a datos de negocio**. Por eso, ante *"¿cuántas ventas hubo este mes?"*, responde una generalidad. El síntoma está documentado como **"Hallazgo 1"** en `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`.

**Rama prevista**: `hito/v3.5-consultas-negocio-a2a` · **Tag de cierre**: `v3.5.0` · **Carpeta de progreso**: `docs/progreso/v3.5-consultas-negocio-a2a/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `comando-visibilidad-a2a-entrante` y `operaciones-negocio-conversacionales`. **La numeración `v3.5.0` es propuesta, no fijada — es decisión del checkpoint.**

> ⛔ **REQUIERE CHECKPOINT HUMANO ANTES DE `sdd-spec` / `sdd-design`.** Este change **reabre el ADR 98** (`hito-3.0-a2a-servidor/design.md:272-294`), un invariante deliberadamente defendido. Mismo tratamiento que recibió toda reapertura de invariante en esta serie (ADR 7/8 → `operaciones-negocio-conversacionales`; ADR 151 → bloqueado por checkpoint). **No avanzar a spec/design sin aprobación explícita.**

---

## Aclaración previa 1: el techo real de numeración

Verificado por `grep` sobre **todo** `openspec/changes/*` (`proposal.md` **y** `design.md`, y además un barrido de control por rangos altos sobre todo el repo), no heredado del texto de ningún change previo — el precedente de `definicion-skills` (que descubrió que el techo real era ADR 102 y no 93) obliga a reverificar siempre.

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **173** | `operaciones-negocio-conversacionales/design.md:245,248` | **ADR 174** |
| **RD** | **RD-79** | `autorizacion-empleado/proposal.md:324` y `design.md:198,277` | **RD-80** |

**Confirmado además que la serie ADR es un pool ÚNICO y compartido entre `proposal.md` y `design.md`**, no dos pools separados: `hito-3.0` usa 86-92 en la propuesta y sigue en 93-102 en el diseño; `comando-cancelar-solicitud` usa 125-128 y sigue en 129-133. La numeración es monotónica a través de fases, no por fase. **`sdd-design` de este change debe continuar desde donde termine esta propuesta, no reiniciar.**

## Aclaración previa 2 (★ **hallazgo de mayor impacto**): la frontera de capacidad del turno NO es `allowedTools` — es `mcpServers`, y eso es lo que salva al change hermano

`CONVERSATIONAL_AGENT.allowedTools` es hoy exactamente `[KNOWLEDGE_TOOL_QUALIFIED_NAME, "Skill"]` (`src/core/agents/definitions.ts:145`) y es **uno solo para TODO el arnés**: TUI, `POST /soporte`, webhook de actividad y A2A entrante **reusan el mismo `AgentDefinition`** con prompt sintético, decisión documentada tres veces por los propios archivos (`soporte-prompt.ts:8-11`, `activity-prompt.ts:9-13`, `a2a-entrante-prompt.ts:9-14`: *"tocar ese system prompt contaminaría también los turnos de TUI y de soporte web"*).

De ahí sale una conclusión alarmante y **falsa**, que conviene matar por escrito antes de que alguien la derive sola: *"si `operaciones-negocio-conversacionales` agrega `mcp__operaciones__*` a `allowedTools`, entonces el turno A2A entrante —abierto a internet— hereda el camino del dinero"*. **No ocurre, y verifiqué por qué**: `allowedTools` es una **lista de permitidos**, pero un tool sólo existe en un turno si su servidor MCP está en el `mcpServers` **de ese turno**. Y `build-on-a2a-entrante.ts:174` pasa, literal, `mcpServers: knowledge.mcpServers` — **sólo el servidor de conocimiento**. Un nombre en `allowedTools` sin servidor que lo provea no es una capacidad, es una cadena inerte.

**Consecuencias, y son tres, todas accionables:**

1. **El change hermano no filtra al A2A entrante.** Confirmado, no supuesto.
2. **La frontera real es `mcpServers` por turno**, y hoy nadie la tiene escrita como invariante ni cubierta por un test. Es una garantía que se sostiene sola por accidente de cableado. **Este change la escribe y la blinda** (ADR 176).
3. **Es exactamente la palanca que este change necesita**: agregar capacidad de lectura al turno entrante se hace **sumando un servidor MCP de sólo lectura a SU `mcpServers`**, sin tocar `allowedTools` para los demás turnos más que en la entrada nueva.

## Aclaración previa 3: el Agent Card ya promete lo que el turno no puede cumplir

Esto no es una consecuencia del change: es **deuda vigente hoy en `main`**. El card (`src/adapters/a2a/agent-card.ts`) publica:

- `DESCRIPCION` (`:61-62`): *"Responde consultas sobre el estado de proyectos, **actividades de desarrollo**, **incidentes**, **solicitudes internas** y **ventas registradas**."*
- `SKILL_CONSULTA_ARNES.description` (`:83-84`): la misma enumeración.
- `examples` (`:86-90`): *"¿En qué estado está la revisión del PR 42 del proyecto X?"*, *"¿Qué incidentes abiertos hay hoy?"*, *"¿Cuántas ventas quedaron pendientes de confirmación esta semana?"*.

**Ninguna de las tres es respondible hoy**, porque el turno sólo tiene el vault. Un Agent Card es un **contrato público de descubrimiento** en A2A: otro agente lo lee para decidir si delega. Publicar capacidades inexistentes no es un detalle cosmético — es la causa raíz de la percepción de "mock". **Cerrar la brecha y corregir el card son el mismo trabajo** (ADR 179).

---

## Intent

El arnés expone un servidor A2A entrante correcto a nivel protocolo (JSON-RPC, Agent Card, `TaskState`, cancelación, auth bearer) y un turno real contra el modelo. Lo que no expone es **una sola respuesta útil sobre el negocio**, porque el turno no tiene de dónde leerla.

El objetivo es **cerrar la brecha entre el contrato publicado y la capacidad real**, dándole al turno entrante acceso de **sólo lectura** a cuatro superficies de datos que ya existen, ya están testeadas y ya son puras: reporte de comisiones, estado de actividad/PR, solicitudes internas pendientes y escalaciones de reembolso pendientes.

El costo arquitectónico está localizado y es exactamente uno: **el ADR 98** decidió que `BuildOnA2AEntranteDeps` tenga *"exactamente los mismos ocho campos que `BuildOnSoporteDeps`, ni uno más"*, y lo hizo como **garantía mecánica** de que el turno entrante es de sólo lectura — *"verificable por inspección de la firma, no por lectura de la implementación"* (`:291`). Ese ADR no se puede rodear con astucia: cualquier acceso a datos de negocio necesita **algo** que hoy no está en esa interfaz.

La salida no es negociar el invariante, es **distinguir qué parte del ADR 98 es el invariante y qué parte es el mecanismo**. El invariante es *"el turno entrante no puede escribir"*. El mecanismo es *"la interfaz tiene ocho campos"*. **El invariante se conserva íntegro y sin matices; se enmienda únicamente el conteo de campos**, agregando un (1) campo de sólo lectura con la forma exacta del que ya está ahí (`createKnowledge`). La tabla de dependencias ausentes del ADR 98 pto 2 —las siete filas que enumeran qué vuelve imposible cada ausencia— **no pierde ni una fila**.

---

## Scope

### In Scope

- **Herramienta MCP de consultas de negocio de sólo lectura** para el turno A2A entrante (`mcp__consultas__*`), **molde `knowledge-tool.ts`**: lógica pura y framework-free en el núcleo, envoltorio `createSdkMcpServer`/`tool()` en el adaptador (`src/adapters/knowledge/knowledge-tool.ts:5-15`). Hereda su **contrato no negociable**: *"never throws and never rejects, on any code path"* (`:11-14`), degradando toda falla a texto.
- **Cuatro operaciones, todas de lectura**, sobre funciones y consultas que **ya existen y no se modifican**:

  | Operación | Delega en | Archivo verificado |
  |---|---|---|
  | Reporte de comisiones por período | `resolverPeriodoReporte` + `agruparReporteMensual` + `formatearReporteMensual` | `src/core/ventas/reporte.ts` (puras, ya testeadas) |
  | Estado de actividad / PR | `findActividadPorReferencia`, `getActividadById` | `activity-contract.ts:127-130`; `repository.ts:465-472` |
  | Solicitudes internas pendientes | `listarSolicitudesPendientes(filtro?)` | `solicitudes-contract.ts:104-108` |
  | Escalaciones / ventas en reembolso pendiente | `listEscalacionesReembolso`, `listVentasEnReembolsoPendiente`, `listComisionesPorPeriodo` | `repository.ts:1262-1265`, `1169-1171`, `1099-1102` |

- **Cuatro puertos de consulta NUEVOS y angostos** en el núcleo, **no** los puertos anchos existentes. Ver ADR 177 — es la pieza que permite que la tabla del ADR 98 pto 2 siga siendo literalmente verdadera.
- **Enmienda formal y acotada al ADR 98**: `BuildOnA2AEntranteDeps` pasa de **ocho a nueve** campos. El campo nuevo es **uno solo**, `createConsultas: (casoId: string) => ConsultasNegocioAdapter`, réplica exacta en forma del `createKnowledge` ya presente (`build-on-a2a-entrante.ts:87-88`). Ver ADR 174.
- **Invariante `mcpServers` escrito y blindado por test** (ADR 176): el `mcpServers` del turno A2A entrante contiene **exclusivamente** servidores de sólo lectura, y existe un test mecánico que falla si aparece cualquier otro — en particular el `mcp__operaciones__*` del change hermano.
- **Corrección del Agent Card** (`agent-card.ts:61-62,83-90`): `DESCRIPCION`, `description` de la skill y los tres `examples` pasan a describir **exactamente** las cuatro capacidades que existirán, ni una más. Ver ADR 179. El tag `"solo-lectura"` y la frase equivalente **se conservan sin cambio** — el ADR 96 pto 3 las marca como declaración pública del límite de alcance, no decoración.
- **Recorte de datos personales en la salida** (ADR 180): el llamador A2A **no tiene identidad de empleado**, sólo un bearer compartido. Lo que se devuelve se recorta en consecuencia (agregados sí, nombres y montos individuales no).
- **Ajuste menor de `buildSolicitudA2APrompt`** (`a2a-entrante-prompt.ts:53-71`): la línea de limitación de sólo lectura (`:62-64`) **se conserva literal y sin cambio** —sigue siendo verdadera y sigue siendo de seguridad, no de estilo— y se agrega la instrucción de **usar la herramienta de consultas** antes de responder con una generalidad, que es el síntoma que originó este change.
- **Alta de la tool en `CONVERSATIONAL_AGENT.allowedTools`** (`definitions.ts:145`), que queda en **tres** entradas (o cuatro si el change hermano mergea antes; ver *Dependencies*). Es una decisión de autorización bajo ADR 4, no un trámite — pero su efecto real está acotado por la Aclaración 2.
- **arc42 + README**: qué puede responder un agente externo y qué no.

### Out of Scope

- **Cualquier escritura por la vía A2A entrante, en cualquier forma.** El invariante del ADR 98 se conserva **íntegro**. Ni un `INSERT`, ni un `UPDATE`, ni disparar una acción con efecto. Verificable por `git diff` sobre la tabla del ADR 98 pto 2: **las siete filas siguen ahí**.
- **Agregar `VentaStorePort`, `ActivityStorePort`, `ActivityBoardPort`, `SolicitudStorePort`, `escritura`/`WorktreePort`, `ClienteA2APort`, `notifier` o `KeyedQueue`** a `BuildOnA2AEntranteDeps`. Las siete filas del ADR 98 pto 2 quedan intactas **por construcción**: los puertos anchos contienen escrituras y por eso **no se usan** (ADR 177).
- **Que el modelo decida a quién delegar por A2A saliente.** La delegación saliente existe y funciona (`hito-2.0`/`2.1`/`2.2`), pero el ruteo lo decide el arnés, no el modelo. Moverlo al modelo es un change propio, mucho mayor, y **explícitamente diferido**. El prompt entrante sigue diciendo *"no podés delegar a otro agente"* (`a2a-entrante-prompt.ts:63`) y esa línea **no se toca**.
- **Exponer las operaciones transaccionales del change hermano** (`registrar venta`, `devolución`, `confirmar/rechazar`, `crear/cancelar solicitud`) al turno A2A entrante, aunque sea "sólo para consultar el resultado". Es el camino del dinero llegando desde internet. ADR 176 lo convierte en imposible-por-test, no en prohibido-por-acuerdo.
- **Un modelo de identidad por llamador A2A** (qué agente externo es, qué puede ver cada uno). Hoy el auth entrante es un bearer **compartido**, sin identidad. Construir identidad por llamador es un change propio; **este change no lo necesita porque recorta la salida** en vez de autorizarla (ADR 180). Ver **R5**.
- **Reabrir el ADR 90 (sin cola de serialización).** Se evaluó explícitamente y **NO corresponde**. Ver ADR 175 — es la verificación más delicada de esta propuesta.
- **Modificar cualquiera de las funciones deterministas de lectura.** `reporte.ts` y las consultas del `repository.ts` entran **tal como están**. Si una sola cambia para "acomodar" la tool, la garantía de reuso se perdió.
- **`streaming` / `pushNotifications` en el card.** Siguen en `false` (`agent-card.ts:66-70`). Fuera de alcance.
- **Dependencias nuevas en `package.json`.**

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. **`sdd-spec` debe reverificar el catálogo por `Glob` antes de fijar nombres** — el conteo cambió dos veces en esta serie.

### New Capabilities

- **`consultas-negocio-a2a`** — el contrato de la herramienta: las cuatro operaciones, el schema exacto de parámetros de cada una, qué se rechaza antes de tocar el núcleo, cómo se traduce cada resultado a texto para el modelo, y **los invariantes negativos que son el corazón del change**: ninguna operación escribe; ninguna operación acepta un parámetro que induzca escritura; la herramienta nunca lanza ni rechaza; la salida está recortada de datos personales (ADR 180).
- **`turno-a2a-entrante-solo-lectura`** — el invariante de composición, hoy inexistente como spec: que el `mcpServers` del turno entrante contiene **exclusivamente** servidores de sólo lectura, que `BuildOnA2AEntranteDeps` no gana ningún puerto de escritura, y que ambas cosas están cubiertas por tests mecánicos y no por convención.

La separación sigue el criterio de `definicion-skills` (`registro-skills` vs. `habilitacion-skills-turno`): **se verifican distinto**. La primera es lógica pura contra dobles; la segunda es cableado de composición.

### Modified Capabilities

- **`solicitud-a2a-entrante`** (`hito-3.0-a2a-servidor/specs/`) — **delta seguro y obligatorio, citado por el propio código**: `build-on-a2a-entrante.ts:18-19` nombra textualmente el requirement *"El turno entrante es de lectura"*. Ese requirement **no se debilita**: se **refuerza y se reformula**, porque hoy está redactado sobre la ausencia de dependencias y pasa a estar redactado sobre la ausencia de **escrituras** (que es lo que siempre quiso decir). También cambia el requirement *"sin camino de código paralelo"*.
- **`agent-card-a2a`** — nombre **a verificar por `sdd-spec`**, no asumido. Cambian `DESCRIPCION`, la `description` de la skill y los tres `examples`. El ADR 96 pto 1 fija que el card se testea *"comparando el objeto entero contra un literal"*, así que **el delta de spec y el test se mueven juntos**.
- **Candidatas a verificar leyendo cada archivo, no razonando desde acá**: `reporte-comisiones`, `actividad-github`, `solicitud-interna-hitl`, `reembolso-resolucion-escalacion`. Criterio fijado por `definicion-skills` y reusado por el change hermano: **hay delta sólo si la spec vigente contiene un requisito exhaustivo sobre el CANAL** (*"esto se consulta ÚNICAMENTE desde el comando X"*). Si el requisito está redactado sobre el **efecto**, no hay delta — ninguna función determinista cambia. **Es la verificación más importante de `sdd-spec` en este change.**

---

## Approach

Cinco piezas, en orden de dependencia:

1. **Cuatro puertos de consulta angostos en el núcleo** (`ConsultaReportePort` —o reuso directo de `ReporteStorePort`, que ya es 100% lectura—, `ConsultaActividadPort`, `ConsultaSolicitudesPort`, `ConsultaReembolsosPort`), implementados por closures sobre las funciones de `repository.ts` ya verificadas. Molde exacto: `reporte-contract.ts:17-20`, que el ADR 121 ya justificó como puerto separado de `VentaStorePort` para no *"inflar la superficie de un contrato"*.
2. **Lógica pura de la tool en el núcleo** (`consultas-negocio-tool.ts`), framework-free, con el contrato *nunca lanza* del `knowledge-tool.ts`. Recorta la salida según ADR 180. Testeable íntegra contra dobles de los cuatro puertos.
3. **Envoltorio MCP en el adaptador** (`createSdkMcpServer`/`tool()`), y un `createConsultas(casoId)` con la misma forma que `createKnowledge(casoId)`.
4. **Cableado**: `BuildOnA2AEntranteDeps` gana su noveno campo; `ejecutarTurno` compone `mcpServers` sumando el servidor de consultas al de conocimiento (`build-on-a2a-entrante.ts:174`); alta en `allowedTools`.
5. **Card, prompt y blindaje**: corrección del Agent Card con su test literal, la instrucción de uso en el prompt sintético, y los dos tests mecánicos (lista de imports del módulo — mecanismo que el ADR 98 pto 3 ya usa — y contenido del `mcpServers` del turno entrante).

---

## ADR 174: Enmienda acotada al ADR 98 — se reabre **el conteo de campos**, NO el invariante de no-escritura; ocho pasan a **nueve**, y la tabla de ausencias no pierde ni una fila

**Contexto.** El ADR 98 (`hito-3.0-a2a-servidor/design.md:272-294`) decidió, cerrando el R8 de su propuesta, que `BuildOnA2AEntranteDeps` tenga *"los MISMOS OCHO CAMPOS que `BuildOnSoporteDeps`, sin agregar ni uno"* (`:278`), como forma de hacer la escritura **inexpresable por firma**: *"verificable por inspección de la firma, no por lectura de la implementación"* (`:291`). Verifiqué que la interfaz sigue hoy exactamente así (`build-on-a2a-entrante.ts:82-92`): `db`, `memory`, `hooks`, `agents`, `createKnowledge`, `newId?`, `now?`, `logDeps?`. **El ADR está vigente y el código lo cumple.**

El ADR 98 pto 5 anticipó este momento con precisión: *"El día que se levante el límite, el diff lo grita: agregar un dep a esta interfaz es la señal, mecánica y visible en el review, de que el ADR 90 se reabrió"*. **Esta propuesta es esa señal, disparada a propósito y por la puerta de adelante.** Ninguna astucia de implementación puede darle datos de negocio al turno sin pasar por acá.

**Decisión**:

1. **Se distingue el invariante del mecanismo.** El **invariante** del ADR 98 es *"el turno entrante no puede escribir"*. El **mecanismo** elegido en su momento fue *"la interfaz tiene ocho campos"*. **El invariante se conserva sin matiz alguno. Se enmienda el mecanismo, y sólo en su parte numérica.**
2. **`BuildOnA2AEntranteDeps` pasa a NUEVE campos.** El noveno es exactamente uno: `readonly createConsultas: (casoId: string) => ConsultasNegocioAdapter`.
3. **El campo nuevo es una réplica en forma del que ya está.** `createKnowledge: (casoId: string) => KnowledgeAdapter` (`:87-88`) ya es una fábrica por caso que devuelve un adaptador con `mcpServers` y `feedback`. El noveno campo **no introduce una categoría nueva de dependencia**: introduce una segunda instancia de la categoría que el ADR 98 ya aceptó como compatible con "sólo lectura". La deja de ser *"la misma interfaz que `BuildOnSoporteDeps`"* y pasa a ser *"la de `BuildOnSoporteDeps` más una fábrica de lectura"* — que es una afirmación igual de verificable de un vistazo.
4. **La tabla del ADR 98 pto 2 (`:281-289`) se conserva ÍNTEGRA, las siete filas.** Ninguna ausencia se levanta: `ActivityStorePort`, `ActivityBoardPort`, `escritura`/`WorktreePort`, `ClienteA2APort`, `notifier`, `VentaStorePort` y `KeyedQueue` **siguen sin estar**. Es verificable por `git diff` y es la prueba de que el invariante no se movió. El ADR 177 es lo que hace posible este punto.
5. **El ADR 98 NO se reescribe.** Su texto queda tal cual, como registro histórico. Este ADR lo **supersede exclusivamente en la afirmación "exactamente ocho campos, ni uno más"** del pto 1 y en la palabra *"ocho"* de su título. Todo el resto del ADR 98 —ptos 2, 3, 4, 5, 6— sigue vigente y este change lo cumple. Mismo criterio de enmienda quirúrgica que esta serie viene usando.
6. **El pto 3 (verificabilidad por firma) se conserva y se refuerza.** Con nueve campos la inspección sigue siendo trivial. Y el test de **lista de imports** que el ADR 98 pto 3 ya exige para `build-on-a2a-entrante.ts` se mantiene: el módulo no gana ni un import de escritura.
7. **El pto 6 (la contracara en el prompt) se conserva**: la firma impide escribir, el prompt impide decir que escribió (`a2a-entrante-prompt.ts:62-64`, sin cambio).

**Alternativas consideradas**:

- **Cuatro campos, uno por puerto** (`consultaReporte`, `consultaActividad`, `consultaSolicitudes`, `consultaReembolsos`): **rechazada**. Deja la interfaz en doce campos y diluye el efecto "el diff lo grita" del pto 5 — cuanto más larga la interfaz, menos evidente es una adición futura. Tiene una ventaja real (cada capacidad visible en la firma) que el ADR 177 recupera por otra vía: los cuatro puertos son visibles **en el tipo `ConsultasNegocioAdapter`**, que es igual de inspeccionable.
- **No tocar la interfaz: leer `db` directamente dentro de la tool**, aprovechando que `db` **ya está** en los ocho campos. **Rechazada, y es la alternativa más peligrosa de las tres** justamente porque funciona y no aparece en ningún diff de firma. Sería exactamente la astucia que el ADR 98 pto 4 describe: *"hacer imposible lo que no se quiere, en vez de prohibirlo con un `if`"*. Un `db` crudo dentro de la tool **es un puerto de escritura sin declarar**. Rechazarla es lo que mantiene honesto al ADR 98.
- **Un `AgentDefinition` separado para el turno entrante, con su propio `allowedTools`**: **rechazada**. Tres archivos del núcleo documentan por qué (`a2a-entrante-prompt.ts:9-14` y sus dos hermanos): *"un segundo `AgentDefinition` obligaría a bifurcar el Selector de Turno"*. No hace falta: la Aclaración 2 mostró que `mcpServers` ya separa por turno.
- **Dejar el card mintiendo y no hacer el change**: **rechazada**. Es la opción de status quo y tiene un costo real — un Agent Card es contrato de descubrimiento, y otro agente delega en base a él.

**Consecuencias**:

- El ADR 98 pasa a estado **"vigente con enmienda"**, no derogado. Quien lo lea debe leer también este ADR.
- Toda propuesta futura que quiera agregar un décimo campo enfrenta el mismo trámite: **este ADR no abre la puerta, la vuelve a cerrar en nueve.**
- El test de lista de imports de `build-on-a2a-entrante.ts` debe actualizarse de forma **aditiva y explícita** (un import nuevo, nombrado), nunca relajando la aserción a un `contains`.

## ADR 175: El **ADR 90 NO se reabre** — su condición de disparo es *"que pueda escribir"*, no *"que gane un dep"*

**Contexto.** Es la verificación más delicada de esta propuesta y hay que hacerla de frente, porque hay **dos textos que dicen cosas distintas** y uno de ellos, leído solo, obligaría a rediseñar la concurrencia del servidor entrante.

- **ADR 90 pto 3** (condición material): *"el día que una solicitud entrante **pueda escribir**, ese ADR se reabre"*.
- **ADR 98 pto 5** (señal procedimental): *"**agregar un dep a esta interfaz** es la señal, mecánica y visible en el review, de que el ADR 90 se reabrió y hay que elegir la clave de serialización antes de mergear"*.

El ADR 98 pto 5 usa *"agregar un dep"* como **proxy** de *"puede escribir"*, y era un proxy perfecto **bajo el supuesto de su autor**: que el único motivo concebible para tocar esa interfaz sería habilitar escritura. Este change es el primer caso en que el proxy y la condición material **se despegan**.

**Decisión**:

1. **Manda la condición material del ADR 90 pto 3, no el proxy del ADR 98 pto 5.** El ADR 90 (no hay cola de serialización para turnos entrantes) existe porque **no hay estado compartido mutable que serializar** — el propio ADR 98 lo dice en su tabla (`:289`): `KeyedQueue` ausente *"porque no hay nada compartido que serializar"*.
2. **Este change no crea nada que serializar.** Cuatro lecturas concurrentes sobre SQLite no tienen carrera entre sí: no hay orden observable que proteger, no hay dato que se pierda por interleaving. **No hay clave de serialización que elegir porque no hay región crítica.**
3. **Por lo tanto el ADR 90 queda VIGENTE Y CERRADO, sin cambios.** La señal del ADR 98 pto 5 **disparó** —y este ADR es la evidencia de que se la atendió en el review, que era su propósito— pero la evaluación concluyó que **no corresponde reabrir**.
4. **El proxy del ADR 98 pto 5 se reformula para el futuro**, y es una mejora que este change deja como saldo: la señal de reapertura del ADR 90 pasa a ser **"agregar un dep que habilite ESCRITURA"**, no "agregar un dep". Redactada así, la señal vuelve a ser exacta.
5. **Las lecturas del turno entrante son consistentes-en-el-momento, no transaccionales entre sí.** Dos operaciones de la tool en un mismo turno pueden ver estados distintos si alguien escribió en el medio. **Es aceptable y se declara**: la respuesta es informativa, el llamador no toma decisiones transaccionales con ella, y el tope de turnos en vuelo del ADR 99 sigue acotando la carga.

**Alternativas consideradas**:

- **Reabrir el ADR 90 y agregar una `KeyedQueue` igual, "por las dudas"**: **rechazada**. Sería una perilla sin consumidor, el patrón que este repo ya rechazó tres veces por nombre (`hito-2.2/design.md §15` ptos 1-2, y el propio `hito-3.0/design.md:268`). Serializar lecturas no protege nada y agrega latencia.
- **Envolver las cuatro lecturas en una transacción de sólo lectura** para consistencia de snapshot: **rechazada en esta fase, pero es la alternativa seria** y se difiere a design como **RD-82**, no se descarta.

**Consecuencias**: el diseño de concurrencia del servidor A2A entrante **no cambia**. El reviewer que vea el noveno campo y busque la cola no la va a encontrar: va a encontrar este ADR explicando por qué no está.

## ADR 176: La frontera de capacidad del turno es **`mcpServers`**, no `allowedTools` — se escribe como invariante y se blinda con un test

**Contexto.** La Aclaración 2. `allowedTools` es global al `AgentDefinition` compartido por los cuatro turnos; `mcpServers` se pasa **por turno** en cada `handleTurn` (`build-on-a2a-entrante.ts:169-176`, con `mcpServers: knowledge.mcpServers` en `:174`). La contención del turno entrante hoy **funciona por accidente de cableado**: nadie la escribió como requisito y ningún test la protege.

**Decisión**:

1. **Se declara el invariante**: *el `mcpServers` del turno A2A entrante contiene exclusivamente servidores MCP de sólo lectura.* Pasa a ser requirement de la capability `turno-a2a-entrante-solo-lectura`.
2. **Test mecánico obligatorio** que afirma el **conjunto exacto** de servidores del turno entrante (conocimiento + consultas, nada más). Debe fallar si aparece `mcp__operaciones__*` o cualquier otro. Aserción de **igualdad de conjunto**, nunca `contains`.
3. **`allowedTools` deja de ser tratado como frontera de seguridad** en la documentación de este change. Sigue siendo una decisión de autorización real bajo ADR 4 —y el alta de la tool nueva pasa por ahí— pero **no es lo que contiene al turno entrante**.
4. **Queda escrito, por el bien del reviewer del change hermano**: que `operaciones-negocio-conversacionales` sume `mcp__operaciones__*` a `allowedTools` **no** expone operaciones al A2A entrante, y el test del pto 2 es lo que mantiene esa afirmación verdadera en el tiempo.

**Alternativas consideradas**:

- **`allowedTools` por turno**: **rechazada** — exigiría bifurcar el `AgentDefinition`, que es justo lo que tres archivos del núcleo documentan como no deseado, y el problema ya está resuelto por `mcpServers`.
- **Dejarlo como está y confiar en el cableado**: **rechazada**. Es una garantía de seguridad sostenida por una línea que nadie protege; el primer refactor distraído que unifique la construcción de `mcpServers` la borra sin que ningún test se queje.

**Consecuencias**: este change deja el arnés **más seguro que antes**, no sólo más capaz — convierte una propiedad accidental en un invariante testeado.

## ADR 177: **Cuatro puertos de consulta nuevos y angostos**, no los puertos anchos existentes — es lo que permite que la tabla del ADR 98 siga intacta

**Contexto.** El atajo obvio es inyectar los puertos que ya existen. **Verifiqué que no se puede**: `ActivityStorePort` (`activity-contract.ts:125-141`) tiene `findActividadPorReferencia` (lectura) **pero también** `createCasoConActividad` y `updateActividadEstado` (escrituras). `SolicitudStorePort` (`solicitudes-contract.ts:104-108+`) tiene `listarSolicitudesPendientes` **pero también** `aprobarSolicitud`, `rechazarSolicitud`, `cancelarSolicitud`. **Inyectar cualquiera de los dos rompería literalmente la fila correspondiente de la tabla del ADR 98 pto 2** y convertiría este change en una reapertura real del invariante, no en una enmienda de conteo.

Además, `getActividadById` (`repository.ts:465-472`) **no está en `ActivityStorePort`** — vive sólo en el repositorio.

**Decisión**:

1. **Se definen puertos nuevos que contienen ÚNICAMENTE métodos de lectura.** Ninguno de los cuatro expone un método con efecto.
2. **Precedente exacto, ya en el repo**: `ReporteStorePort` (`reporte-contract.ts:17-20`) es *"100% lectura y no comparte ninguna invariante con `VentaStorePort`"*, y el ADR 121 ya justificó por qué se separó en vez de ampliar el puerto ancho: *"mezclarlos infla la superficie de un contrato que hoy tiene una sola responsabilidad"*. **Este ADR aplica el mismo criterio tres veces más.**
3. **`ReporteStorePort` se REUSA tal cual** para la operación de comisiones. Ya cumple la regla; definir uno nuevo sería duplicación.
4. **Implementación por closures directos** sobre las funciones de `repository.ts`, inyectados inline desde el composition root — el estilo que `reporte-contract.ts:10-13` documenta como el suyo, **sin `createXStore`**.
5. **La lectura de sólo-lectura es por construcción, no por disciplina**: el turno no puede escribir aunque el modelo lo pida, porque **no existe un método que lo haga** en ninguno de los cuatro puertos.

**Alternativas consideradas**:

- **Inyectar los puertos anchos y "no llamar" a los métodos de escritura**: **rechazada**. Es el `if` que el ADR 98 pto 4 rechaza: *"un `if` se borra en un refactor distraído"*. Y rompe la tabla del pto 2.
- **Un único puerto `ConsultasNegocioPort` con los métodos de los cuatro dominios**: **rechazada, aunque es tentadora** por dejar la firma más corta. Mezcla cuatro responsabilidades en un contrato, que es exactamente lo que el ADR 121 rechazó. **`sdd-design` puede revisitarla** si al bajarla a firmas los cuatro puertos resultan artificiales — queda como **RD-81**.
- **Pasar `db` y hacer las consultas en la tool**: **rechazada** — ver ADR 174, alternativas.

**Consecuencias**: cuatro contratos nuevos y chicos en el núcleo, testeables contra dobles triviales. El costo es superficie de tipos; la compra es que la tabla del ADR 98 sigue siendo verdadera **palabra por palabra**.

## ADR 178: **Una sola tool con operación discriminada**, no cuatro tools sueltas

**Contexto.** Las cuatro capacidades pueden exponerse como cuatro `tool()` independientes o como una con un parámetro discriminante.

**Decisión**: **una sola tool**, `mcp__consultas__consultar_negocio`, con un parámetro `operacion` discriminado y un schema por variante.

1. **Una sola entrada nueva en `allowedTools`** en vez de cuatro. Bajo ADR 4 cada entrada es una decisión de autorización; cuatro entradas es cuatro veces la superficie a auditar para la misma capacidad.
2. **Coherencia con el molde**: `knowledge-tool.ts` expone **una** tool para su dominio.
3. **El discriminante hace explícito el conjunto cerrado**: agregar una quinta operación es un cambio visible en un `union`, no un archivo nuevo que puede pasar desapercibido.
4. **Un solo punto donde se aplica el recorte del ADR 180**, en vez de cuatro que pueden divergir.

**Alternativas consideradas**: **cuatro tools** — rechazada por lo anterior, aunque tiene una ventaja real (schemas más simples, sin uniones discriminadas) que `sdd-design` puede sopesar al bajarla a `tool()` concreto. **RD-83**.

**Consecuencias**: el schema es más complejo; el costo de autorización y auditoría, cuatro veces menor.

## ADR 179: El Agent Card se **corrige**, no sólo se completa — cerrar la brecha alcanza para tres de las cuatro promesas, no para las cuatro

**Contexto.** Aclaración 3. La pregunta que esta propuesta tenía que responder con evidencia y no con optimismo es: *¿alcanza con cerrar la brecha de capacidad para que el card publicado hoy pase a ser verdadero?* **Verifiqué que no del todo.**

| Promesa del card | ¿Queda cubierta por este change? |
|---|---|
| *"estado de proyectos"* | **Sí** — vía actividades por proyecto |
| *"actividades de desarrollo"* / ejemplo del PR 42 | **Sí** — `findActividadPorReferencia` / `getActividadById` |
| *"solicitudes internas"* | **Sí** — `listarSolicitudesPendientes` |
| *"ventas registradas"* / ejemplo de ventas pendientes | **Sí** — reporte de comisiones + reembolsos pendientes |
| ★ *"**incidentes**"* / ejemplo *"¿Qué incidentes abiertos hay hoy?"* | **NO.** No encontré ninguna superficie de datos de "incidentes" entre las cuatro, ni una entidad `incidentes` en el dominio |

**Decisión**:

1. **`DESCRIPCION` y la `description` de la skill se reescriben** para enumerar exactamente las cuatro capacidades reales, **sin "incidentes"**, salvo que `sdd-design` verifique que el término mapea a algo existente (¿`casos` de soporte? ¿`actividades` en cierto estado?) y decida cubrirlo. **Queda como RD-84, con una instrucción explícita: si no hay fuente, la palabra sale del card. No se deja una promesa sin respaldo.**
2. **Los tres `examples` se reescriben** para que cada uno sea **literalmente respondible** por una de las cuatro operaciones. Un `example` en A2A es una señal de descubrimiento: otro agente decide delegar en base a él.
3. **El tag `"solo-lectura"` y la frase equivalente en la `description` se CONSERVAN sin cambio.** El ADR 96 pto 3 las marca como *"la declaración pública del límite de alcance del que depende el ADR 90"*, y después de este change **siguen siendo verdaderas** — esa es justamente la tesis del ADR 174.
4. **`VERSION` sube** (`agent-card.ts:64`, hoy `"3.0.0"`). El valor exacto lo fija el checkpoint junto con el tag.
5. **El test literal del card se actualiza en el mismo commit** (ADR 96 pto 1: se compara el objeto entero contra un literal). El card y su test se mueven juntos, siempre.
6. **`supportedInterfaces`, `capabilities`, `securitySchemes` y los modos NO se tocan.** En particular `preferredTransport`/`additionalInterfaces` siguen sin emitirse (ADR 96 pto 6, RD-24).

**Alternativas consideradas**:

- **Sólo agregar capacidad y dejar el card como está**: **rechazada** — dejaría "incidentes" mintiendo, que es la deuda original.
- **Ampliar el change para cubrir "incidentes"**: **rechazada en esta fase** — sin una entidad identificada, sería inventar un dominio para satisfacer un string. Si `sdd-design` la encuentra, entra; si no, sale la palabra.

**Consecuencias**: el card queda **más chico en promesas y 100% respaldado**. Es el resultado correcto aunque sea contraintuitivo: la solución a un card que sobre-promete no es siempre construir más.

## ADR 180: El llamador A2A **no tiene identidad de empleado** — la salida se **recorta**, no se autoriza

**Contexto.** El auth entrante es un **bearer compartido** (`securitySchemes.bearer`, `agent-card.ts:93-95`): autentica que el llamador es *un* agente autorizado, **no quién**. No hay `empleadoId`, no hay `SesionEmpleado`, no hay rol — y el change hermano `autorizacion-empleado` está construyendo el modelo de roles **para la superficie de empleado, no para ésta**.

Pero las cuatro superficies contienen datos personales: `listComisionesPorPeriodo` devuelve `vendedor_id`, `vendedor_nombre` y `comision_monto` **por vendedor** (`repository.ts:1105-1109`); `listVentasEnReembolsoPendiente` devuelve `vendedor_id`, `vendedor_nombre`, `cliente_id` y `monto` (`:1174-1179`); `listarSolicitudesPendientes` devuelve `solicitanteId` y el `detalle` en texto libre.

**Entregar eso crudo a un agente externo es una fuga de datos personales por diseño**, aunque el llamador esté autenticado.

**Decisión**:

1. **El recorte es la estrategia, no la autorización.** No se construye identidad por llamador (fuera de alcance): se decide **qué es publicable sin identidad** y se devuelve sólo eso.
2. **Criterio**: **agregados y estados, sí; nombres, montos individuales e identificadores de persona, no.**
   - Comisiones: **totales y conteos del período**, no la fila por vendedor.
   - Actividad/PR: **estado y timestamps**, no el `responsable_id`.
   - Solicitudes internas: **conteo por estado/tipo**, no `solicitanteId` ni el `detalle` en texto libre — el `detalle` es campo abierto donde un empleado puede haber escrito cualquier cosa.
   - Reembolsos: **conteo y montos agregados pendientes**, no `cliente_id` ni la fila por venta.
3. **El recorte vive en la lógica pura del núcleo** (pieza 2 del Approach), **no en el prompt**. Un recorte pedido por prompt es una sugerencia; uno hecho en la función es un hecho. Mismo criterio que el ADR 177 pto 5.
4. **Se testea en negativo**: tests que afirman que la salida **no contiene** `vendedor_nombre`, `cliente_id`, `solicitanteId` ni `detalle`, con dobles que sí los traen.
5. **La consulta puntual por referencia (PR/actividad) es la excepción parcial y deliberada**: devuelve el estado de **una** actividad que el llamador ya identificó por `referenciaExterna`. No es enumeración masiva; aun así **no devuelve el responsable**.
6. **Condición de disparo escrita**: el día que exista identidad por llamador A2A, este ADR se reabre para decidir qué ve cada uno. **Hasta entonces, el recorte es el techo.**

**Alternativas consideradas**:

- **Devolver todo crudo y confiar en el bearer**: **rechazada**. Un bearer compartido no distingue llamadores; la superficie de exposición es "cualquiera que tenga el token".
- **Construir identidad por llamador ahora**: **rechazada** — es un change propio y multiplicaría este diff. Ver **R5**.
- **Pedirle al modelo que no revele datos personales**: **rechazada por la misma razón que el pto 3.** El repo ya tiene la lección escrita en `soporte-prompt.ts`: las líneas de seguridad del prompt son necesarias pero **nunca suficientes**.

**Consecuencias**: las respuestas son menos ricas de lo que el dato permite. Es el precio correcto de no tener identidad. Y deja un camino de crecimiento claro y con condición escrita.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/<dominio>/*-consulta-contract.ts` (×3 nuevos) | New | Puertos angostos de sólo lectura (ADR 177). `ReporteStorePort` se reusa |
| `src/core/agents/consultas-negocio-tool.ts` | New | Lógica pura de la tool + recorte del ADR 180. Nunca lanza |
| `src/adapters/consultas/` | New | Envoltorio `createSdkMcpServer`/`tool()` + `createConsultas(casoId)`, molde `adapters/knowledge/` |
| `src/build-on-a2a-entrante.ts` | Modified | **Noveno campo** en `BuildOnA2AEntranteDeps` (`:82-92`); `mcpServers` compuesto en `:174`; doc-comment del ADR 98 (`:13-19`) actualizado citando ADR 174 |
| `src/adapters/a2a/agent-card.ts` | Modified | `DESCRIPCION` (`:61-62`), `description` y `examples` de la skill (`:83-90`), `VERSION` (`:64`) |
| `src/core/agents/definitions.ts` | Modified | Una entrada nueva en `allowedTools` (`:145`) |
| `src/core/agents/a2a-entrante-prompt.ts` | Modified | Instrucción de uso de la tool. **La línea de sólo-lectura (`:62-64`) NO se toca** |
| `src/main.ts` | Modified | Cableado de `createConsultas` (closures sobre `repository.ts`) |
| `src/core/ventas/reporte.ts`, `src/adapters/memory/repository.ts` | **Sin cambio** | Reuso literal. **Si aparecen en el diff, el alcance se filtró** |
| `openspec/changes/hito-3.0-a2a-servidor/design.md` | **Sin cambio** | El ADR 98 **no se reescribe** (ADR 174 pto 5) |
| Tests | New/Modified | Card literal (ADR 96 pto 1); lista de imports (ADR 98 pto 3); conjunto de `mcpServers` (ADR 176); recorte en negativo (ADR 180) |
| `docs/arc42/`, `README.md` | Modified | Qué puede responder un agente externo y qué no |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **El change se usa como precedente para escribir por A2A entrante.** *"Ya se abrió el ADR 98 una vez"* | **Media** | ADR 174 ptos 1, 4 y 7: el invariante no se movió, la tabla de siete ausencias queda intacta y verificable por `git diff`. El ADR 174 **cierra en nueve**, no abre |
| **R2** | **Fuga de datos personales a un agente externo** | **Media-Alta** | ADR 180 completo: recorte en el núcleo (no en el prompt) + tests en negativo. **Es el riesgo de seguridad principal del change** |
| **R3** | **Colisión con `operaciones-negocio-conversacionales`** en `definitions.ts:145`, `main.ts` y el cableado de `mcpServers` | **Alta** | Ambos tocan las mismas líneas. Ver *Dependencies*: hay que fijar orden de merge en el checkpoint. El test del ADR 176 es lo que garantiza que la convivencia sea **segura**, no sólo compilable |
| **R4** | **`sdd-design` baja los cuatro puertos y resultan artificiales** | Media | **RD-81** deja abierta la consolidación. No se fuerza la forma desde acá |
| **R5** | **Sin identidad por llamador, el recorte del ADR 180 puede quedar corto o largo** para el consumidor real | Media | Condición de disparo escrita (ADR 180 pto 6). El checkpoint debería confirmar **quién es el agente externo esperado** |
| **R6** | **"Incidentes" no tiene fuente** y el card queda prometiendo o recortado de más | Media | **RD-84** con instrucción explícita: sin fuente, la palabra sale. **Decisión de `sdd-design`, no de apply** |
| **R7** | **El ADR 175 se equivoca y sí hacía falta serializar** | **Baja** | El argumento es material (no hay región crítica en lecturas concurrentes) y **RD-82** deja abierta la transacción de snapshot si design encuentra un caso |
| **R8** | **Presupuesto de review de 400 líneas** — cuatro puertos + tool + adaptador + cableado + card + cinco familias de tests | **Alta** | **`sdd-tasks` debe forecastear PRs encadenados.** Corte natural: (1) puertos + tool pura + tests; (2) adaptador + cableado + ADR 176; (3) card + prompt + docs |
| **R9** | **El modelo sigue respondiendo generalidades** aun con la tool, si el prompt no lo empuja a usarla | Media | Es el síntoma original. El ajuste del prompt es parte del alcance, y la verificación manual (molde `evidencia-verificacion-manual.md`) debe reproducir **las tres preguntas del card** |

## Rollback Plan

1. **El change es aditivo en el núcleo**: los cuatro puertos, la tool y el adaptador son archivos **nuevos**. Borrarlos no rompe nada preexistente.
2. **Revertir el cableado** (`build-on-a2a-entrante.ts` vuelve a ocho campos y a `mcpServers: knowledge.mcpServers`, `main.ts` deja de construir `createConsultas`) devuelve el turno entrante a su comportamiento exacto de hoy. **El ADR 98 vuelve a ser verdadero palabra por palabra sin tocar su texto** — que es precisamente el beneficio de no haberlo reescrito (ADR 174 pto 5).
3. **Revertir el card** es un cambio de constantes en un archivo puro, con su test literal al lado.
4. **Rollback parcial posible y recomendado si algo sale mal en producción**: quitar **sólo** la operación problemática del discriminante de la tool (ADR 178) deja las otras tres vivas. Es una ventaja concreta de la tool única sobre las cuatro sueltas.
5. **Nada que revertir en datos**: el change no escribe, no migra y no crea tablas. **No hay rollback de base de datos porque no hay forward.**

## Dependencies

- ⛔ **Checkpoint humano previo a `sdd-spec`/`sdd-design`** — reapertura del ADR 98. **Bloqueante.**
- **Orden de merge respecto de `operaciones-negocio-conversacionales`** (R3): ambos tocan `definitions.ts:145`, `main.ts` y la composición de `mcpServers`. **Decisión del checkpoint.** Recomendación: **que mergee primero el hermano** —está más avanzado— y que este change sume su entrada y su test del ADR 176 sobre esa base, porque el test del ADR 176 es **más valioso escrito después** de que exista `mcp__operaciones__*` (puede afirmar su ausencia contra algo real, no contra una hipótesis).
- **Independiente de `autorizacion-empleado`.** Verificado: ese change construye roles para la **superficie de empleado**; este no usa identidad de empleado (ADR 180 pto 1). **No hay dependencia dura en ninguna dirección.**
- **Sin dependencias externas nuevas.** Sin migraciones.
- Reusa, sin modificar: `reporte.ts`, `repository.ts`, `handle-turn.ts`, `knowledge-tool.ts` (como molde), `a2a/server.ts`.

## Success Criteria

- [ ] Las **tres preguntas de `examples` del Agent Card** (ya corregidas) se responden con datos reales de negocio en verificación manual, con evidencia en `docs/progreso/v3.5-consultas-negocio-a2a/`, **cerrando el "Hallazgo 1"** de `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`.
- [ ] **`git diff` confirma que las siete filas de la tabla del ADR 98 pto 2 siguen intactas** y que `BuildOnA2AEntranteDeps` tiene **exactamente nueve** campos, el noveno siendo `createConsultas`.
- [ ] **`hito-3.0-a2a-servidor/design.md` no aparece en el diff** (ADR 174 pto 5).
- [ ] El test de **lista de imports** de `build-on-a2a-entrante.ts` pasa y creció de forma **aditiva y nombrada**, sin relajarse a `contains`.
- [ ] El test de **conjunto exacto de `mcpServers`** del turno entrante pasa y **falla** si se le inyecta `mcp__operaciones__*` (ADR 176 pto 2).
- [ ] Los tests **en negativo** del ADR 180 pasan: la salida no contiene `vendedor_nombre`, `cliente_id`, `solicitanteId` ni `detalle`, con dobles que sí los traen.
- [ ] **Ninguna operación de la tool escribe**: `reporte.ts` y `repository.ts` sin cambios, y ningún puerto nuevo expone un método con efecto.
- [ ] El **test literal del Agent Card** (ADR 96 pto 1) pasa, y **ninguna capacidad publicada carece de respaldo** — incluida la resolución explícita de "incidentes" (RD-84).
- [ ] La tool **nunca lanza ni rechaza**, con test por cada camino de falla (molde `knowledge-tool.ts:11-14`).
- [ ] `npm test`, typecheck y lint en verde; `src/core/` sigue sin importar de `src/adapters/*`.

---

## Decisiones diferidas a `sdd-design` (RD)

Numeración continúa desde el techo verificado **RD-79**.

- **RD-80** — Forma exacta de `ConsultasNegocioAdapter`: ¿replica la de `KnowledgeAdapter` (`{ mcpServers, feedback }`) o sólo `{ mcpServers }`? ¿Hay algo análogo al `feedback`/`CitedNodesRecorder` que valga la pena para consultas de negocio?
- **RD-81** — ¿Cuatro puertos angostos o un `ConsultasNegocioPort` consolidado? (ADR 177, alternativas). Decisión al bajar a firmas.
- **RD-82** — ¿Las cuatro lecturas necesitan una transacción de snapshot para consistencia intra-turno, o alcanza con consistencia-en-el-momento? (ADR 175 pto 5).
- **RD-83** — Una tool con discriminante vs. cuatro tools, al bajar a `tool()` y schema concreto (ADR 178, alternativas).
- **RD-84** — **"Incidentes"**: ¿mapea a alguna entidad existente (`casos` de soporte, `actividades` en cierto estado) o sale del Agent Card? **Sin fuente, sale.** (ADR 179 pto 1).
- **RD-85** — Granularidad exacta de los agregados del ADR 180: ¿qué es "suficientemente agregado" para comisiones y reembolsos sin volver la respuesta inútil?
- **RD-86** — ¿La operación de actividad acepta sólo `(proyectoId, referenciaExterna)`, sólo `actividadId`, o ambas? `getActividadById` **no está en `ActivityStorePort`** y habría que exponerlo en el puerto nuevo.
