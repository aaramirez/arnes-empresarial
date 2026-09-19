# Propuesta: el chat web del empleado puede consultar la base de conocimiento interna

**Origen**: **hallazgo H1 de la exploración de brechas del canal conversacional del empleado** (fase `sdd-explore`, rol Spec Author, corrida sobre `hito/v3.12-devolucion-sin-token-dos-personas`). No es un hallazgo nuevo: es el **"gap conocido" R3** que el propio código dejó anotado por escrito hace tres hitos (`src/build-on-operaciones-empleado.ts:25-34`) y que nadie cerró. Esta propuesta lo cierra y **nada más**.

**Rama prevista**: `hito/v3.13-conocimiento-chat-empleado` · **Tag de cierre**: `v3.13.0` · **Carpeta de progreso**: `docs/progreso/v3.13-conocimiento-chat-empleado/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`, mismo tratamiento que `chat-web-empleado`, `ergonomia-canal-empleado` y `devolucion-sin-token-dos-personas`. **La numeración `v3.13.0` es propuesta, no fijada — la decide el checkpoint**, y depende de que el humano mergee v3.12 primero (ver *Dependencies*). **Por AGENTS.md la rama se crea DESPUÉS del checkpoint, no ahora** — ningún agente la abre por su cuenta.

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo. Misma nota y mismo criterio que `operaciones-negocio-conversacionales`, `autorizacion-empleado`, `aprobacion-conversacional-hitl` y `ergonomia-canal-empleado` ya dejaron escritos. **Toda afirmación de abajo está verificada por `Read`/`Grep` con archivo:línea**, releyendo el fuente en esta fase — no heredada del reporte de exploración.

---

## Aclaración previa 1: el techo de numeración — y una colisión NUEVA que hay que mirar

Verificado por `Grep` sobre **todo** el repo (`openspec/changes/**`, `src/**`, `docs/**`), porque en esta serie los ADR se citan en doc-comments de código vivo y el techo real suele vivir ahí.

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **233** | `devolucion-sin-token-dos-personas/design.md:295`, citado en código vivo: `src/core/agents/definitions.ts:225`, `src/core/ventas/soporte-prompt.ts:102`, `src/adapters/operaciones/index.ts:110` | **ADR 234-236** |
| **RD** | **RD-111** | `devolucion-sin-token-dos-personas/proposal.md:380`, `design.md:226,272`; citado en `src/core/auth/auth-config.test.ts:130` | **RD-112 y RD-113** |
| **Migración** | `0014_justificaciones_devolucion.ts` | — | **`0015` sigue libre: este change NO usa ninguna** |

Confirmado por `Grep` que **no existe ningún `ADR 234+` ni ningún `RD-112+`** en el repo hoy.

★ **Atención, `sdd-spec`/`sdd-design`: los rangos 237+ y RD-114+ NO son de este change.** Pertenecen a los tres changes hermanos que se están escribiendo **en paralelo** (ver *Hoja de ruta*). Este change se queda dentro de 234-236 y RD-112/113, y punto.

### ★ Hallazgo de esta fase: ADR 227 y 228 están asignados DOS VECES

No lo traía el reporte de exploración. Verificado leyendo los dos diseños y el código vivo:

| ADR | Significado A | Significado B |
|---|---|---|
| **227** | `ergonomia-canal-empleado/design.md:142` — "el turno del chat es una estructura de tres nodos, el autor es una clave cerrada". Citado en `src/adapters/web/chat-client.ts:49,89` y `chat-client.test.ts:184,243` | `devolucion-sin-token-dos-personas/design.md:102` — "la proyección `VentaPropia`, el token se excluye en el SQL". Citado en `src/adapters/memory/repository.ts:859,868,883,901` y `repository.test.ts:893,899` |
| **228** | `ergonomia-canal-empleado/design.md:211` — "`Date` es el quinto identificador libre". Citado en `chat-client.ts:19,83` | `devolucion-sin-token-dos-personas/design.md:136` — "el módulo de iniciación y la tabla `0014`". Citado en `repository.ts:962,964`, `0014_justificaciones_devolucion.ts:3` |

**Hoy, en código vivo, la frase "ADR 227 pto 2" significa dos cosas distintas según el archivo donde se lee.** El mecanismo de falla es exactamente el de la colisión histórica 174-187: `ergonomia-canal-empleado/design.md:441` reservó 227-228 *porque en ese momento el change hermano sólo había reservado 223-226 en su `proposal.md`* — y después la fase `sdd-design` de ese hermano abrió 227-233 y le pasó por encima.

★ **Este change NO reabre ninguna de las dos colisiones** (ni 174-187/**RD-94**, ni la nueva 227-228). Las deja anotadas para el checkpoint como deuda de trazabilidad, que es lo que son. Pero **sí extrae la lección operativa**: reservar ADRs en el `proposal.md` no alcanza si la fase de diseño del hermano puede pasar por encima. Por eso este change reserva **234-236 explícitamente y lo dice acá arriba**, y por eso los hermanos arrancan en 237+.

## Aclaración previa 2: los tres hechos verificados que fijan el alcance real

1. **No hay obstáculo estructural. Faltan literalmente dos líneas y una dependencia.** `BuildOnOperacionesEmpleadoDeps` (`build-on-operaciones-empleado.ts:89-109`) no declara `createKnowledge`, y `handleTurn` recibe `mcpServers: operacionesAdapter.mcpServers` a secas (`:270`). El `casoId` del turno se crea **dentro** del handler devuelto (`:223`), igual que en `buildOnSoporte` (`build-on-soporte.ts`), así que `createKnowledge(casoId)` se puede llamar ahí mismo. Y `createKnowledge` **ya está en scope en `main.ts`**: se destructura en `main.ts:269` y se le pasa a `buildOnSoporte` (`:406`) y a `buildOnA2AEntrante` (`:683`) — a `buildOnOperacionesEmpleado` (`:501`) no. **Es una línea de composition root.**

   ★ **El argumento del doc-comment no dice lo que parece decir.** `build-on-operaciones-empleado.ts:12-19` explica por qué `sesion`/`confirmacion` **no** viajan por closure; no es un argumento contra el conocimiento. La omisión está declarada como lo que es: *"gap conocido, fuera del alcance explícito de esta tarea"* (`:33-34`).

2. **El prompt ya le promete al modelo una herramienta que no tiene.** El `systemPrompt` de `CONVERSATIONAL_AGENT` le dice literalmente *"Tenés acceso a la base de conocimiento interna de la empresa mediante la herramienta `mcp__knowledge__query_knowledge_base`: usala siempre que…"* (`definitions.ts:125-139`), y `construirAgenteEmpleadoOperaciones` hereda ese prompt y ese `allowedTools` por spread (`:255-261`). Pero `allowedTools` **sólo pre-aprueba**: la frontera real es `mcpServers` por turno, y el propio código lo dice — *"Que figure en `allowedTools` no la vuelve alcanzable"* (`definitions.ts:154-157`, ADR 176). **El chat autenticado tiene hoy un prompt que miente.** Tras este change deja de mentir.

3. **El caso de uso está documentado como TUI-only, no como "no soportado".** La guía de verificación dice, del caso 8: *"**Actor**: cualquier empleado, por **TUI** (canal sin cambios respecto de antes — no pasa por la herramienta `operaciones`, así que no depende del chat web)"* (`docs/progreso/guia-verificacion-casos-de-uso.md:249`). El empleado nuevo que hace onboarding por el chat web no tiene a dónde preguntar.

---

## Intent

**El problema**: un empleado autenticado en el chat web (`POST /operaciones`, el canal que sirve `src/adapters/web/chat-client.ts`) **no puede preguntarle nada a la base de conocimiento interna de la empresa**. La tool figura en su lista de herramientas permitidas y su prompt le insiste en usarla, pero el servidor MCP no está registrado en ese turno, así que es inalcanzable. La TUI sí la tiene, por dos caminos distintos (mensaje libre y `/soporte`), y **`POST /soporte` la sirve incluso sin autenticación**.

**Por qué ahora**:

1. **Bloquea el caso de uso de onboarding.** "Soy nuevo en el equipo, ¿qué es la política de reembolsos?" es la pregunta arquetípica del canal conversacional, y el canal moderno del producto —el chat web, el que se demuestra delante de alguien— es justo el que no la contesta. El vault tiene memorias de esa pregunta exacta (`graphify-out/memory/query_20260901_014558_soy_nuevo_en_el_equipo__podes_explicarme_que_es_la.md`), todas entradas por la TUI.
2. **El prompt ya promete la capacidad** (Aclaración 2 pto 2). Un prompt que describe una herramienta ausente no es neutro: empuja al modelo a responder de memoria y **sin cita**, que es exactamente el modo de falla que el adaptador de conocimiento existe para prevenir.
3. **La spec/diseño previos ya lo daban por hecho.** `operaciones-negocio-conversacionales/design.md:483` razona sobre las skills del turno de empleado asumiendo la tool de conocimiento disponible. Es decir: **el contrato escrito y el wiring no coinciden desde v3.6.** Esto no es una feature nueva, es saldar una deuda declarada.
4. **Es chico y no bloquea a nadie** (~150 líneas, cero núcleo, cero migraciones), y sale del paso antes de que los tres changes hermanos empiecen a pelearse por `operaciones-contract.ts`.

**Cómo se ve el éxito**: un empleado le pregunta al chat web por una política interna y recibe una respuesta **citando `src`/`loc` reales del vault**, con la misma calidad de cita que hoy da la TUI — demostrado a mano y con evidencia en `docs/progreso/`.

---

## Scope

### In Scope

- **Cablear el servidor MCP de conocimiento en el turno del chat de empleado** (ADR 234): `createKnowledge` entra a `BuildOnOperacionesEmpleadoDeps`, el handler llama `createKnowledge(casoId)` con el `casoId` que ya crea, y `handleTurn` recibe la **unión exacta** de los dos servidores. `main.ts:501` gana un campo.
- **NO cablear `knowledgeFeedback`** (ADR 235). Es una decisión explícita con test, no una omisión.
- **Dejar escrita la postura de autorización del conocimiento en este canal** (ADR 236): este change **no** introduce filtrado por rol, y dice por qué.
- **Tests (TDD estricto, el rojo primero)**: invertir `build-on-operaciones-empleado.test.ts:265-280` (hoy afirma *"nunca la de conocimiento"*), test de **unión exacta** de `mcpServers` molde `build-on-a2a-entrante.test.ts`, y test de que el turno **NO** pasa `knowledgeFeedback`.
- **Delta de spec** en `turno-empleado-autenticado`, que además **corrige un requirement hoy desactualizado** (ver *Capabilities*).
- **Higiene documental acotada**: reescribir el doc-comment R3 de `build-on-operaciones-empleado.ts:25-34`, que tras este change **pasa a afirmar lo contrario de lo que es cierto**. Es obligatorio, no cosmético.
- **Evidencia de verificación manual** en `docs/progreso/v3.13-conocimiento-chat-empleado/`: una consulta de conocimiento contestada por el chat web **con cita**, y la captura del comportamiento **antes** del cambio (ver **R1**).

### Out of Scope

- **`knowledgeFeedback` en el chat.** Decisión, no omisión: **ADR 235**.
- **Cablear la tool `consultas` en el chat.** `CONSULTAS_TOOL_QUALIFIED_NAME` también está en `CONVERSATIONAL_AGENT.allowedTools` (`definitions.ts:158`) y también llega por spread al turno de empleado **sin servidor registrado**. O sea: hoy hay **dos** referencias colgantes, y este change cierra **una sola**. ★ **La de `consultas` se deja colgante a propósito**: sus consultas de sólo lectura no están escopadas por identidad (`consultas-negocio-a2a-entrante`, ADR 180), así que cablearla le daría a cualquier empleado más de lo que necesita. **Queda anotado como observación, no como bug, y no se toca acá.**
- **Calidad de recuperación del vault** (`DEFAULT_BUDGET = 200`, `src/adapters/knowledge/config.ts:20`). Ver **R2** — es un riesgo de percepción real, pero es otro problema y otro change.
- **Tocar `src/core/`.** Este change no entra al núcleo. Si aparece `src/core/` en el diff, el alcance se filtró (con **una** excepción posible y acotada: ninguna, en el diseño recomendado — ver ADR 234).
- **Tocar `buildOperacionesEmpleadoPrompt` / `INSTRUCCION_OPERACIONES_EMPLEADO`.** Los dos textos están **duplicados a propósito** y pineados por tests (`definitions.test.ts`, `soporte-prompt.test.ts`). El `systemPrompt` base **ya** menciona el conocimiento; tras el fix queda consistente sin tocar una letra.
- **Tocar la skill `citar-conocimiento`.** Verificado leyéndola (`.claude/skills/citar-conocimiento/SKILL.md`): es agnóstica del canal, opera sobre líneas `NODE` ya presentes en el contexto y se auto-descubre sin registro en código. **No necesita cambio.**
- **Filtrado del vault por rol o por identidad**, y cualquier auditoría de las consultas de conocimiento. ADR 236.
- **Los otros tres hallazgos de la exploración** (H2, H3a, H3b): ver *Hoja de ruta*.

---

## Capabilities

> El repo **no tiene `openspec/specs/` poblado**: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`, y `archive/` está vacío. Catálogo verificado por `Glob` en esta fase: **80 archivos `spec.md`**. **`sdd-spec` debe reverificar por `Glob` antes de fijar nombres** — el conteo creció en cada change de esta serie.

### New Capabilities

- **Ninguna.** Registrar un servidor MCP ya existente en un turno ya existente no es una capability nueva. Si la verificación de `sdd-spec` demostrara lo contrario, es un hallazgo que vuelve al Spec Author antes de inventar un archivo.

### Modified Capabilities

- **`turno-empleado-autenticado`** — **delta, y es el único.** Versión vigente = base `operaciones-negocio-conversacionales/specs/turno-empleado-autenticado/spec.md` + delta `chat-web-empleado/specs/turno-empleado-autenticado/spec.md` (verificado leyendo los dos).

  ★ **Instrucción para `sdd-spec`: la spec vigente está DESACTUALIZADA y el delta tiene que corregirla, no sólo agregarle un requirement.** El requirement `### Requirement: CONVERSATIONAL_AGENT.allowedTools tiene exactamente tres entradas…` (base, `:40-47`) dice: *"SHALL contener exactamente tres entradas: la tool de conocimiento, la tool de `operaciones`, y `"Skill"`"*. **Eso no describe el código de hoy**, verificado en `definitions.ts:158,258`:
  - `CONVERSATIONAL_AGENT.allowedTools` tiene **tres** entradas, pero son `[conocimiento, "Skill", consultas]` — **`operaciones` NO está ahí**;
  - la variante `construirAgenteEmpleadoOperaciones()` agrega `operaciones` por spread y tiene **cuatro**.

  El requirement quedó viejo cuando `consultas-negocio-a2a-entrante` (v3.8) metió `CONSULTAS_TOOL_QUALIFIED_NAME` en la lista base. El delta **SHALL** fijar el estado real por superficie (base vs. variante de operaciones) y conservar intacta la garantía que sí importa: **ninguna entrada es `Bash`/`Read`/`Write`/`Edit`**. Forma exacta: **RD-113**.

  Lo **ADDED** del delta: que el turno de empleado autenticado registra el servidor de conocimiento en sus `mcpServers`, que **NO** registra `consultas`, y que **NO** pasa `knowledgeFeedback`.

- **`chat-web-empleado`** — **sin delta esperado.** Esa spec describe la página, el cliente y el transporte; acá no cambia ninguno de los tres. **A verificar leyendo, no forzar.**
- **`herramienta-operaciones-negocio`** — **sin delta.** `OPERACIONES_NEGOCIO` sigue teniendo **diez** entradas (`operaciones-contract.ts:71-82`, pineado por `operaciones-contract.test.ts:54-67`). ★ **Este change NO toca el conteo** — es justamente lo que lo hace paralelizable frente a los hermanos.

---

## Approach

**Una sola pieza, en el composition root del turno.** El conocimiento no entra por el contrato de operaciones: entra por donde ya entra en los otros tres turnos del arnés.

1. `BuildOnOperacionesEmpleadoDeps` gana `createKnowledge: (casoId: string) => KnowledgeAdapter`, **con la misma firma exacta** que `BuildOnSoporteDeps.createKnowledge` (`build-on-soporte.ts:56`) y `BuildOnA2AEntranteDeps` (`build-on-a2a-entrante.ts:130`).
2. Dentro del handler devuelto, después de `createCaso` (`build-on-operaciones-empleado.ts:228-234`): `const knowledge = createKnowledge(casoId);`.
3. `handleTurn` pasa `mcpServers: { ...knowledge.mcpServers, ...operacionesAdapter.mcpServers }` — **precedente literal**: `build-on-a2a-entrante.ts:185` hace `{ ...knowledge.mcpServers, ...consultas.mcpServers }`, con su test de "UNIÓN EXACTA".
4. `handleTurn` **NO** recibe `knowledgeFeedback` (ADR 235). En `build-on-a2a-entrante.ts:186` sí se pasa; acá, deliberadamente, no.
5. `main.ts:501` agrega `createKnowledge` al objeto — la variable ya está en scope desde `:269`.

**Por qué no pasa por el núcleo**: el wiring por turno vive en `src/build-on-*.ts`, que por diseño **no es `src/core/` ni `src/adapters/`** — es el composition root del turno, y ya importa tipos de adaptador (`build-on-soporte.ts` importa `KnowledgeAdapter`; `build-on-operaciones-empleado.ts:57-58` ya importa de `adapters/memory` y `adapters/operaciones`). **La frontera hexagonal de AGENTS.md —`src/core/` nunca importa `src/adapters/*`— no se toca ni se roza**: este change no agrega un solo import a `src/core/`.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 234-236)

La numeración continúa el techo real **ADR 233** (Aclaración 1). Las decisiones de nivel diseño reservan **RD-112** y **RD-113**.

### ADR 234: El conocimiento entra al chat por `mcpServers` del turno — **no** como una operación de `OPERACIONES_NEGOCIO`

**Contexto.** Hay dos formas de darle conocimiento al chat: registrar el servidor MCP que ya existe, o crear una operación `consultar_conocimiento` dentro del contrato de operaciones de negocio.

**Decisión**: **se registra el servidor MCP en el turno.** `createKnowledge` entra a las deps, el handler lo instancia con su `casoId` y `handleTurn` recibe la unión de los dos servidores (*Approach* ptos 1-5).

1. **La frontera de autorización es `mcpServers`, no `allowedTools`** — decisión ya tomada en ADR 176 y escrita en el código (`definitions.ts:154-157`). Lo único que este change "concede" es registrar el servidor. `allowedTools` **no cambia ni una entrada**.
2. **La unión es exacta y con test**: `Object.keys(mcpServers).sort()` === `["knowledge", "operaciones"]` (nombres verificados: `knowledge-contract.ts:17`, `operaciones-contract.ts:29`). **Nunca `consultas`** (`consultas-negocio-tool.ts:48`). Molde del test de unión exacta de `build-on-a2a-entrante.test.ts`.
3. **Un `KnowledgeAdapter` por turno, nunca uno por proceso.** `createKnowledge` se llama **dentro** del handler, con el `casoId` de ese turno (`:223`) — misma fábrica por `casoId` que `main.ts:250-256` ya reparte a la TUI, los webhooks, `/soporte` y A2A entrante. **R1 de Hito 3 (instancia única compartida) no se reintroduce.** Esto importa además por el `CitedNodesRecorder`, que es **por instancia** (`adapters/knowledge/index.ts:81`): un turno no puede heredar las citas del anterior.
4. **Cero cambios en `src/core/`.** El diff vive en `src/build-on-operaciones-empleado.ts` y `src/main.ts`.

**Alternativas consideradas**:

- **Una operación `consultar_conocimiento` en `OPERACIONES_NEGOCIO`**: **rechazada**, y el motivo es arquitectónico, no de esfuerzo. El dispatcher es núcleo (`src/core/operaciones/ejecutar-operacion.ts`) y **no puede importar adaptadores** (AGENTS.md, regla no negociable): habría que inventar un `KnowledgePort` en `core/` y un delegador, más una fila en las **tres** tablas de `validar-operacion.ts`, más un campo `question` de **texto libre** en el zod plano del adaptador — rompiendo el invariante *"sólo identificadores estructurados"* que hoy sólo `motivo` excepciona (RD-106). Además sube el conteo 10→11, lo que obliga a un delta de `herramienta-operaciones-negocio` y **serializa este change contra los tres hermanos**. Y todo eso **para duplicar una tool que ya existe y que los otros tres turnos ya usan**. El único argumento a favor sería auditar cada consulta — que hoy no se hace en ningún canal (ADR 236 pto 3).
- **Cablearlo en `CONVERSATIONAL_AGENT` en vez de en el turno**: **rechazada por inaplicable.** `CONVERSATIONAL_AGENT` es un `AgentDefinition`; los `mcpServers` no viven ahí, viven en las deps de `handleTurn` (`handle-turn.ts:189`). No hay dónde ponerlo.

**Consecuencias**: ~15 líneas de producción. Cero núcleo, cero contrato de operaciones, cero migraciones, cero dependencias. El costo real es el de tests: `createKnowledge` pasa a ser un campo de las deps y `makeBaseDeps` (`build-on-operaciones-empleado.test.ts:186-200`) tiene que aportarlo para **todos** los casos del archivo. Si es requerido u opcional, y cómo se dobla en tests: **RD-112**.

### ADR 235: El chat **NO** cablea `knowledgeFeedback` — porque el feedback escribe en un almacén que se sirve sin autenticación

**Contexto.** `KnowledgeAdapter` devuelve `{ mcpServers, feedback }` (`adapters/knowledge/index.ts:60-64,146-149`). `buildOnSoporte` y `buildOnA2AEntrante` pasan los dos. La pregunta obvia es si el chat debería hacer lo mismo. **La respuesta es no, y el motivo es de seguridad, no de simplicidad.**

Los hechos, verificados leyendo:

- `feedback.saveTurnResult` ejecuta `graphify save-result --question <q> --answer <a> --nodes …` (`graphify-cli.ts:91-97`, `adapters/knowledge/index.ts:116-136`) cuando el modelo citó al menos un nodo.
- Eso deja archivos en `graphify-out/memory/*.md` — **39 hoy**, verificado por `Glob`.
- **Esos archivos ya son nodos consultables del grafo**, y el grafo es lo que sirven `POST /soporte` (**sin autenticación**) y el turno A2A entrante (hacia agentes de terceros).
- El `question` que se persiste es **el prompt completo**, no la pregunta del empleado: `handle-turn.ts:265-268` pasa `question: prompt`, y `prompt` es el texto sintético del turno con todo su boilerplate. **La evidencia está a la vista en los nombres de archivo del vault**: `query_20260905_163414_sos_el_agente_de_soporte_al_cliente_de_este_produc.md`, `query_20260910_025909_sos_el_agente_que_atiende_una_solicitud_recibida_p.md`. Los archivos se nombran con el boilerplate, no con la consulta.
- El `answer` se guarda hasta el tope de caracteres del adaptador (`index.ts:127`), y en el chat de empleado **un `answer` puede contener `clienteId`, montos, `ventaId`, detalle de solicitudes internas** — es el canal que ejecuta las diez operaciones de negocio.

**Decisión**:

1. **`handleTurn` en el turno de empleado NO recibe `knowledgeFeedback`.** Se cablea **sólo** `mcpServers`.
2. **El motivo escrito, para que no se "arregle" en un refactor distraído**: cablearlo convertiría una conversación **autenticada** en escrituras dentro de un almacén que hoy se sirve **sin autenticación** por `POST /soporte` (verificado: `esAutorizado` se invoca una sola vez en `server.ts:386`, en la rama de `/ventas`; `handleSoporte` —`:551-583`— no lo llama). Es una **fuga cruzada de canal autenticado a canal público, mediada por el vault**. Que sea indirecta la hace peor, no mejor: nadie la ve en el diff del chat.
3. **No drenar el recorder no filtra nada entre turnos.** El `CitedNodesRecorder` es **por instancia** de `KnowledgeAdapter` (`index.ts:81`) y acá hay una instancia por turno (ADR 234 pto 3): al terminar el turno se va con él. **No hace falta llamar `discardPendingCitations` por higiene.**
4. **Invariante negativo con test**, molde ADR 98 pto 4 / ADR 232: una aserción que **falla si el turno de empleado pasa `knowledgeFeedback`**. Un comentario se borra; un test no.
5. **Consecuencia aceptada y escrita**: el chat **no alimenta** el vault. Las consultas de conocimiento del empleado no quedan como memoria reutilizable. **Es el precio, y es el correcto**: el canal que ya alimenta el vault (`/soporte`) es el que no tiene datos de negocio en su respuesta.

**Alternativas consideradas**:

- **Cablear el feedback igual que `buildOnSoporte`**: **rechazada**, ptos 2 y 5.
- **Cablearlo con un `question` saneado** (sólo la consulta del empleado, sin boilerplate): **rechazada para este change.** Arregla el problema del *nombre de archivo*, no el del `answer` — que es el que filtra datos de negocio. Y para hacerlo habría que cambiar la firma de `saveTurnResult` o el prompt, que son núcleo y contrato compartido con los otros tres turnos. **Si el stakeholder quiere el feedback en el chat, es su propio change con su propio análisis.**
- **Un vault particionado por canal**: **rechazada por inexistente.** El vault es un único grafo global; `adapters/knowledge/config.ts:11-25` no tiene noción de identidad, rol ni partición. Inventar particiones para habilitar el feedback es construir un sistema nuevo para resolver un problema que se resuelve no haciendo nada.

### ADR 236: Este change **no** introduce filtrado del conocimiento por rol — y lo dice explícito en vez de dejarlo implícito

**Contexto.** La pregunta "¿un empleado cualquiera debería poder consultar todo el vault desde el chat?" es legítima y aparece sola al leer el diff.

**Decisión**:

1. **No se agrega filtrado por rol, identidad ni partición.** El turno del chat verá **exactamente el mismo vault** que ve hoy la TUI y que ve hoy `POST /soporte`.
2. **El motivo es de proporción, verificado**: `POST /soporte` sirve el vault **sin ninguna autenticación** (`server.ts:551-583`, sin `esAutorizado`). El chat de empleado, en cambio, exige `Bearer <token>` de sesión vigente (`server.ts:126,217`). **Tras este change, el canal autenticado expone estrictamente MENOS conocimiento que el que ya está expuesto al público anónimo.** Filtrar por rol acá, dejando `/soporte` abierto, sería teatro de seguridad: cerraría la puerta del frente con la del fondo abierta.
3. **Sin auditoría de consultas de conocimiento**, coherente con los otros tres turnos: ninguno escribe fila en `registro_acciones_empleado` por consultar el vault. Este change **no** estrena esa asimetría.
4. ★ **Lo que sí hace este change es dejar la pregunta escrita, no resuelta**: **¿el vault es público por diseño?** Es una postura **preexistente** —la decidió v1.3 al abrir `/soporte` sin auth, no este change— y **merece su propio análisis y su propio change**. Lo que no puede pasar es que siga siendo implícita. Queda como punto 3 del checkpoint.

**Alternativas consideradas**:

- **Filtrar el vault por rol sólo en el chat**: **rechazada**, pto 2.
- **Bloquear H1 hasta resolver la postura del vault**: **rechazada.** Bloquear un canal autenticado por una exposición que ya existe en un canal anónimo no reduce ni un gramo de riesgo — sólo mantiene rota una funcionalidad. La postura del vault se decide igual, con o sin este change.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/build-on-operaciones-empleado.ts` | Modified | `BuildOnOperacionesEmpleadoDeps` gana `createKnowledge` (`:89-109`); el handler lo instancia tras `createCaso` (`:228-234`); `handleTurn` recibe la unión de `mcpServers` (`:270`) **y ningún `knowledgeFeedback`** (ADR 234, 235) |
| `src/build-on-operaciones-empleado.ts` (doc-comment) | Modified | **Obligatorio**: `:25-34` afirma hoy que este módulo NO recibe `createKnowledge` y que la tool queda inalcanzable. Tras el change **es falso**. El "gap conocido R3" se declara cerrado |
| `src/main.ts` | Modified | `buildOnOperacionesEmpleado({...})` (`:501-512`) gana `createKnowledge` — variable ya en scope (`:269`). **Una línea** |
| `src/build-on-operaciones-empleado.test.ts` | Modified | **Rojo primero**: invertir `:265-280`; agregar unión exacta y ausencia de `knowledgeFeedback`; `makeBaseDeps` (`:186-200`) aporta el doble (**RD-112**) |
| `src/core/**` | **Sin cambio** | ★ **Invariante duro de este change.** Si `src/core/` aparece en el diff, el alcance se filtró |
| `src/core/agents/definitions.ts` (`allowedTools`, prompts) | **Sin cambio** | La tool **ya** está listada (`:158,258`) y el `systemPrompt` **ya** la describe (`:125-139`). No hay nada que agregar |
| `src/core/ventas/soporte-prompt.ts` | **Sin cambio** | `buildOperacionesEmpleadoPrompt` no menciona conocimiento y **no se toca** (texto duplicado a propósito y pineado por tests) |
| `.claude/skills/citar-conocimiento/SKILL.md` | **Sin cambio** | Verificado leyéndola: agnóstica del canal, auto-descubierta, sin registro en código |
| `src/adapters/knowledge/**` | **Sin cambio** | Se consume tal cual. Ni `config.ts`, ni `DEFAULT_BUDGET`, ni `graphify-cli.ts` |
| `src/adapters/web/server.ts`, rutas, payloads, CSP | **Sin cambio** | **Si aparecen en el diff, el alcance se filtró** |
| `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts`, `adapters/operaciones/index.ts` | **Sin cambio** | ★ El conteo sigue en **diez**. Es lo que desacopla este change de los tres hermanos |
| Esquema / migraciones | **Sin cambio** | Cero migraciones. Próxima libre sigue siendo `0015` |
| `package.json` | **Sin cambio** | Cero dependencias nuevas, criterio sostenido desde v3.2 |
| `openspec/changes/conocimiento-chat-empleado/specs/turno-empleado-autenticado/` | New | Delta: ADDED (registra conocimiento, no `consultas`, no feedback) + corrección del requirement desactualizado (**RD-113**) |
| `docs/progreso/v3.13-conocimiento-chat-empleado/` | New | Evidencia manual: antes y después (**R1**) |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★ | **No está verificado en vivo qué hace el SDK con una tool listada en `allowedTools` sin su servidor en `mcpServers`.** La hipótesis (el modelo no la ve y responde de memoria, sin cita) es razonable pero **NO fue confirmada** — la única nota existente es de la **TUI**, no del chat (`docs/progreso/guia-verificacion-casos-de-uso.md:367`). Si el SDK hiciera otra cosa (p. ej. error visible al empleado), el diagnóstico del gap cambia de forma | **Media** | **La verificación manual del change SHALL demostrar el comportamiento ANTES y DESPUÉS**, en el chat web, con evidencia de las dos. Sin el "antes", no hay prueba de que el cambio haya arreglado algo. Es un criterio de éxito, no una sugerencia |
| **R2** ★ | **El stakeholder percibe H1 como "no resuelto" aunque el wiring esté bien.** `DEFAULT_BUDGET = 200` (`adapters/knowledge/config.ts:20`) y la nota *"8. Consulta de conocimiento citando fuente real (TUI) --fallo pero funciona un poquito--"* (`guia-verificacion-casos-de-uso.md:367`) sugieren que la **calidad de recuperación** es floja **incluso en la TUI**, que ya tiene la tool cableada | **Media-Alta** | **Fuera de alcance, y escrito acá para que no sorprenda.** El criterio de éxito de este change es *"el chat alcanza la tool y cita una fuente real"*, **no** *"la respuesta es buena"*. Si la prueba manual falla por recuperación floja, es el **otro** problema y no se arregla acá. **Pregunta 5 del checkpoint** |
| **R3** | **Exposición del vault**: el chat autenticado pasa a poder leer todo el conocimiento interno | **Baja** | ADR 236 pto 2: `POST /soporte` ya lo sirve **sin auth** (`server.ts:551-583`). Este canal expone estrictamente **menos**. La postura de fondo queda como pregunta 3 del checkpoint, no como bloqueo |
| **R4** ★ | **Que alguien "complete" el wiring agregando `knowledgeFeedback`**, por simetría con `buildOnSoporte`/`buildOnA2AEntrante`, sin ver la consecuencia | **Media** | ADR 235 pto 4: **test que falla si el turno pasa `knowledgeFeedback`**, más el motivo escrito en el doc-comment. Es el riesgo más probable de este change, justamente porque el "arreglo" parece obvio |
| **R5** | **Solapamiento territorial con v3.12** (`devolucion-sin-token-dos-personas`): toca `build-on-operaciones-empleado.ts` (`:187-197`, `:194`) y `main.ts`, los mismos dos archivos | **Alta si corren en paralelo** | **Este change SHALL salir de `main` DESPUÉS del merge de v3.12.** No es negociable: el conflicto sería en el mismo objeto de deps. Ver *Dependencies* |
| **R6** | **Solapamiento con `ergonomia-canal-empleado`**: change ya implementado y mergeado (código vivo lo cita: `chat-client.ts:49,83`; `docs/progreso/v3.11-ergonomia-canal-empleado/` existe), pero ★ **su carpeta `openspec/changes/ergonomia-canal-empleado/` figura SIN TRACKEAR en `git status`** | **Baja (funcional) / Alta (trazabilidad)** | **Sin solape funcional**: toca `chat-client.ts`/`chat-page.ts`/el eco de `registrar_venta`, nada de esto. Pero va **contra la exigencia del tutor** de que el repo muestre el proceso. **Recomendación al humano: commitear esos artefactos antes de abrir este change** (lo hace el humano, no el agente) |
| **R7** | **`makeBaseDeps` toca ~10 sitios de llamada** si `createKnowledge` es requerido, inflando el diff de tests | **Media** | **RD-112** decide requerido vs. opcional. ★ **Recomendación de esta fase: REQUERIDO**, igual que en `buildOnSoporte` y `buildOnA2AEntrante` — un opcional silencioso reintroduce exactamente el bug que este change cierra, pero sin doc-comment que lo declare |
| **R8** | **Presupuesto de review de 400 líneas** | **Baja** | ≈150 líneas totales (≈20 de producción + ≈80 de tests + delta de spec + evidencia). `sdd-tasks` forecastea igual. **Una sola PR** |

## Rollback Plan

1. **El change es puramente aditivo y revertible con un `git revert`**: **cero migraciones, cero columnas, cero backfill, cero estado de proceso nuevo, cero dependencias**.
2. **Revertir = quitar el campo de deps, la instanciación y el spread.** El turno vuelve a `mcpServers: operacionesAdapter.mcpServers` y el chat vuelve exactamente a la conducta de hoy (tool listada e inalcanzable). Nada más lo consume.
3. **No hay rollback de datos posible ni necesario.** ★ **Y esto es consecuencia directa del ADR 235**: como el chat **no** cablea el feedback, este change **no escribe ni un byte** en `graphify-out/memory/`. Si se hubiera cableado, revertir el código **no** revertiría los archivos ya escritos en el vault — habría que borrarlos a mano y regenerar el grafo. **Un change sin feedback es un change con rollback limpio**; con feedback, no lo sería.
4. **La instancia por turno se va con el turno** (ADR 234 pto 3): no queda ningún singleton ni recorder vivo que limpiar.

## Dependencies

- ★ **Depende del merge de `devolucion-sin-token-dos-personas` (v3.12) a `main`.** Está implementado y con su `docs/progreso/v3.12-devolucion-sin-token-dos-personas/`, pero **sin mergear y sin tag** (rama actual: `hito/v3.12-devolucion-sin-token-dos-personas`). Toca `build-on-operaciones-empleado.ts` (`:71,121,187-197`) y `main.ts` — los dos archivos de este change. **La rama `hito/v3.13-…` sale de `main` después del merge y del tag `v3.12.0`.** Ver **R5**.
- **Depende de `chat-web-empleado` (v3.9), ya mergeado**: el canal `POST /operaciones`, el cliente estático y la memoria conversacional.
- **Depende de `operaciones-negocio-conversacionales` (v3.6), ya mergeado**: `buildOnOperacionesEmpleado`, el turno de empleado y su `AgentDefinition` construido por spread.
- **Depende de `hito-1.1-consulta-conocimiento` (v1.1) y `consultas-negocio-a2a-entrante` (v3.8), ya mergeados**: el `KnowledgeAdapter`, `KNOWLEDGE_MCP_SERVER_NAME` y el precedente de composición de `mcpServers` del ADR 176.
- **Relación con los tres changes hermanos** (*Hoja de ruta*): **sin dependencia funcional en ninguna dirección, y sin solape de archivos** — este change no toca `operaciones-contract.ts`, `validar-operacion.ts` ni `ejecutar-operacion.ts`. **Puede correr en paralelo con ellos** una vez mergeado v3.12. Los hermanos sí se serializan **entre sí**.
- **Sin dependencias externas nuevas. Sin cambios en `package.json`.**
- **Reusa, sin modificar**: `createKnowledgeAdapter`, `KnowledgeFeedbackPort`, el `systemPrompt` base, `allowedTools`, la skill `citar-conocimiento`, el binario `graphify` y su config.

## Success Criteria

- [ ] **El turno del chat de empleado registra el servidor MCP de conocimiento**, verificado por test: `Object.keys(mcpServers).sort()` === `["knowledge", "operaciones"]`.
- [ ] ★ **Existe un test que FALLA si el turno registra `consultas`** en sus `mcpServers` (ADR 234 pto 2).
- [ ] ★ **Existe un test que FALLA si el turno pasa `knowledgeFeedback` a `handleTurn`** (ADR 235 pto 4). Es el criterio con consecuencia de seguridad de este change.
- [ ] **TDD estricto respetado**: el rojo inicial es `build-on-operaciones-empleado.test.ts:265-280`, que hoy pasa **afirmando lo contrario** de lo que el change quiere (*"nunca la de conocimiento"*). Ese test se invierte **antes** de escribir producción, y el commit del rojo es visible.
- [ ] ★ **`git diff` confirma CERO cambios en `src/core/`.**
- [ ] ★ **`git diff` confirma cero migraciones** (la próxima libre sigue siendo `0015`), **cero cambios en `src/adapters/web/server.ts`, y cero dependencias nuevas en `package.json`.**
- [ ] **`git diff` confirma que `OPERACIONES_NEGOCIO` sigue con diez entradas** (`operaciones-contract.test.ts` sin tocar) — prueba de que no se filtró alcance hacia los changes hermanos.
- [ ] **El doc-comment R3 de `build-on-operaciones-empleado.ts:25-34` ya no afirma que la tool de conocimiento es inalcanzable** — verificado leyendo, no asumido.
- [ ] ★ **Evidencia de verificación manual en `docs/progreso/v3.13-conocimiento-chat-empleado/`: una consulta de conocimiento interno hecha DESDE EL CHAT WEB y contestada CON CITA (`src`, y `loc` cuando exista)** — más la captura del comportamiento **antes** del cambio en el mismo canal (**R1**). Sin el "antes", el entregable no está demostrado.
- [ ] **El delta de `turno-empleado-autenticado` fija el estado real de `allowedTools` por superficie** (base 3 / variante de operaciones 4) y **conserva intacta** la garantía de que ninguna entrada es `Bash`/`Read`/`Write`/`Edit`.
- [ ] `npm test`, `npm run typecheck` y `npm run build` en verde.

---

## Hoja de ruta (changes hermanos, **fuera de este change**)

La exploración identificó cuatro brechas del canal conversacional. Este change resuelve **una**. Las otras tres tienen propuesta propia, **escrita en paralelo por otro agente** en `openspec/changes/<nombre>/proposal.md` — **no se desarrollan acá, y este change no las bloquea ni depende de ellas**.

| Orden | Change | Contenido | Versión propuesta | Riesgo |
|---|---|---|---|---|
| 0 | *(humano)* | Mergea v3.12, tag `v3.12.0`, commitea los artefactos `openspec/` sin trackear (**R6**) | — | — |
| 1 | **`conocimiento-chat-empleado`** ← **este** | H1: registrar el servidor de conocimiento en el turno, sin feedback | `v3.13` | Medio-bajo |
| 2 | `consulta-solicitud-propia` | H2: el empleado consulta el estado de una solicitud interna propia (aprobada/rechazada, no sólo pendiente) — puerto de lectura nuevo + operación nº 11 | `v3.14` | Bajo |
| 3 | `visibilidad-a2a-entrante-chat` | H3a: `/ver-solicitudes-a2a` desde el chat — mover formateadores a `core/` + operación nº 12 | `v3.15` | Medio (texto externo al contexto del modelo) |
| 4 | `consulta-kpi-a2a-chat` | H3b: `/consultar-kpi` desde el chat — A2A **saliente** | `v3.16` | **Alto** (sale a un sistema externo con texto redactado por el modelo) |

★ **Los changes 2, 3 y 4 se serializan entre sí**: los tres editan `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts` y los tests de conteo de operaciones. **Este change (1) no toca ninguno de esos archivos**, así que es el único que puede correr en paralelo con cualquiera de ellos. **Las versiones de la tabla son propuestas, no fijadas** — las decide el checkpoint.

## Decisiones diferidas a `sdd-design` (RD)

Numeración continúa desde el techo verificado **RD-111** (Aclaración 1).

- **RD-112** — **Forma exacta del wiring y de su doble en tests**: ¿`createKnowledge` **requerido** u opcional en `BuildOnOperacionesEmpleadoDeps` (recomendación de esta fase: **requerido**, **R7**)?; orden exacto del spread de `mcpServers` y qué gana en caso de colisión de claves (hoy no hay, los nombres son `knowledge`/`operaciones`); forma del doble de `KnowledgeAdapter` en `makeBaseDeps` (`build-on-operaciones-empleado.test.ts:186-200`) para que **ningún test toque el binario `graphify` real**; y forma exacta del test de ausencia de `knowledgeFeedback` (sobre el argumento de `handleTurn`, no sobre el texto del archivo).
- **RD-113** — **Redacción exacta del delta de `turno-empleado-autenticado`**: cómo se corrige el requirement *"exactamente tres entradas"* (`operaciones-negocio-conversacionales/specs/turno-empleado-autenticado/spec.md:40-47`) para que describa el estado real **por superficie** (`CONVERSATIONAL_AGENT` = 3 con `consultas`; variante de operaciones = 4 con `operaciones`) **sin relajar** la prohibición de `Bash`/`Read`/`Write`/`Edit`; y redacción de los requirements ADDED en negativo (**no** `consultas`, **no** `knowledgeFeedback`) con sus escenarios Given/When/Then. **A verificar releyendo `definitions.ts:158,258`, no razonando desde acá.**

## Qué necesita el checkpoint

1. ★ **¿Aprobás el corte en CUATRO changes, con H1 primero y solo?** El argumento: H1 no toca el contrato de operaciones, así que no se serializa contra los otros tres, y cierra una deuda que el propio código declaró hace tres hitos. Los otros tres tienen perfiles de riesgo distintos entre sí (datos propios / datos de terceros / escritura hacia un sistema externo) y no se mezclan.
2. ★ **¿Confirmás NO cablear `knowledgeFeedback` en el chat (ADR 235)?** Con feedback, una consulta del empleado en el canal **autenticado** termina como archivo en `graphify-out/memory/`, que hoy se sirve por `POST /soporte` **sin autenticación** y por A2A hacia terceros. Si preferís cablearlo, tiene que quedar escrito como excepción deliberada — no colarse por simetría con `buildOnSoporte`.
3. ★ **¿El vault es público por diseño?** Hoy `POST /soporte` lo sirve sin auth (`server.ts:551-583`). Este change **no** introduce filtrado por rol y lo dice explícito (ADR 236). **La pregunta es preexistente y merece su propio change** — lo único que no puede seguir siendo es implícita.
4. **¿Confirmás la numeración `v3.13.0`, el nombre de rama/carpeta, el orden de merge (v3.12 primero, **R5**) y el rango ADR 234-236 / RD-112-113?** Y, de paso: **¿qué hacemos con la colisión ADR 227-228** que detectó esta fase (Aclaración 1) y con los artefactos `openspec/` sin trackear (**R6**)? Este change no toca ninguna de las dos, pero las dos son deuda de trazabilidad contra la exigencia del tutor.
5. **¿Alcanza con el wiring, o también hay que atender la calidad de recuperación?** (`DEFAULT_BUDGET = 200`; la guía dice *"fallo pero funciona un poquito"* **en la TUI, que ya tiene la tool cableada**, `guia-verificacion-casos-de-uso.md:367`). Si la expectativa es "respuestas buenas" y no "la tool es alcanzable y cita", **este change no la va a cumplir solo** — y conviene saberlo antes de la prueba manual, no después (**R2**).
