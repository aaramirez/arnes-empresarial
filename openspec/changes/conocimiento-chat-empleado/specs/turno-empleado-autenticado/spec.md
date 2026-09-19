> Nota de proceso: este ejecutor no tiene shell, así que no se pudo correr `graphify query` pese al hook del repo (misma nota que `proposal.md`). Todo lo afirmado abajo se verificó con `Read`/`Grep` (archivo:línea). Versión vigente de la capability = base `openspec/changes/operaciones-negocio-conversacionales/specs/turno-empleado-autenticado/spec.md` + delta `openspec/changes/chat-web-empleado/specs/turno-empleado-autenticado/spec.md` (ADDED puro, no toca el requirement de `allowedTools`). Ningún otro spec del catálogo afirma que el `mcpServers` del turno de empleado sea sólo `operaciones` (verificado por `Grep` de `mcpServers`/`createKnowledge` sobre `openspec/changes/**/specs/**`), por eso no hay delta en otra capability.

# Delta for Turno Empleado Autenticado

## ADDED Requirements

### Requirement: El turno del chat registra el servidor de conocimiento junto al de operaciones — unión exacta, un adaptador por turno

El turno de `POST /operaciones` SHALL pasar a `handleTurn` un `mcpServers` cuyas claves sean **exactamente** `knowledge` (`KNOWLEDGE_MCP_SERVER_NAME`, `src/core/knowledge/knowledge-contract.ts:17`) y `operaciones` (`OPERACIONES_MCP_SERVER_NAME`, `src/core/operaciones/operaciones-contract.ts:29`), y ninguna otra — en particular no `consultas`. El adaptador de conocimiento SHALL obtenerse de una fábrica por `casoId`, invocada dentro del handler devuelto, una vez por turno con el `casoId` de ese turno; SHALL NOT compartirse una instancia entre turnos. El chat SHALL NOT cambiar ninguna entrada de `allowedTools` para esto.
(Estado previo, `src/build-on-operaciones-empleado.ts:265-271` y `.test.ts:265-280`: el turno registraba sólo `operaciones`, y el test afirmaba "nunca la de conocimiento".)

#### Scenario: Igualdad de conjunto de `mcpServers`
- GIVEN un handler construido con un doble de `createKnowledge` y una sesión vigente
- WHEN se invoca el handler con una consulta
- THEN `Object.keys(mcpServers).sort()` recibido por `handleTurn` es igual a `["knowledge", "operaciones"]`
- AND la aserción es de igualdad de conjunto, nunca `contains`

#### Scenario: La tool de conocimiento listada es alcanzable
- GIVEN el `candidateAgents[0]` y el `mcpServers` recibidos por `handleTurn`
- WHEN se toma `KNOWLEDGE_TOOL_QUALIFIED_NAME` de su `allowedTools`
- THEN el segmento de servidor de ese nombre (`knowledge`) es una clave de `mcpServers`

#### Scenario: Un adaptador por turno, con el `casoId` del turno
- GIVEN un handler y una fábrica `createKnowledge` espiada
- WHEN se invoca el handler dos veces
- THEN la fábrica se llamó dos veces, cada una con el `casoId` de su turno, y los `casoId` difieren

### Requirement: El turno del chat NO cablea `knowledgeFeedback` ni escribe en `graphify-out/memory/`

El turno SHALL NOT pasar `knowledgeFeedback` a `handleTurn` y SHALL NOT invocar `feedback.saveTurnResult` ni `feedback.discardPendingCitations` del adaptador de conocimiento. Ninguna vía del chat SHALL ejecutar `graphify save-result`. Motivo: `saveTurnResult` persiste `question`+`answer` (`src/adapters/knowledge/index.ts:116-136`) como nodos del vault que `POST /soporte` sirve sin autenticación (`src/adapters/web/server.ts:386` es el único `esAutorizado`, en `/ventas`; `handleSoporte`, `:552`, no lo llama), y el `answer` del chat de empleado puede contener datos de negocio. Un comentario se borra en un refactor; este requirement lo cubre un test.

#### Scenario: `handleTurn` no recibe `knowledgeFeedback`
- GIVEN un handler construido con un doble de `createKnowledge` cuyo adaptador expone `feedback`
- WHEN se invoca el handler y `handleTurn` (mockeado) resuelve
- THEN el tercer argumento de `handleTurn` no contiene la clave `knowledgeFeedback` (ni con valor `undefined`)

#### Scenario: El handler nunca toca el puerto de feedback
- GIVEN el mismo doble con `saveTurnResult` y `discardPendingCitations` espiados
- WHEN el turno termina, con éxito o con `handleTurn` rechazado
- THEN ninguno de los dos espías fue invocado

#### Scenario: Verificación manual — el vault no crece (evidencia en `docs/progreso/`)
- GIVEN la cantidad de archivos en `graphify-out/memory/` antes de una consulta de conocimiento hecha por el chat web
- WHEN el turno responde citando `src`/`loc`
- THEN la cantidad de archivos es la misma

### Requirement: La tool de conocimiento no es una operación de negocio; `OPERACIONES_NEGOCIO` conserva sus diez entradas

Este change SHALL NOT agregar ninguna entrada a `OPERACIONES_NEGOCIO` (`src/core/operaciones/operaciones-contract.ts:71-82`, hoy diez) ni modificar `validar-operacion.ts`, `ejecutar-operacion.ts` ni el schema de la tool `operaciones`. El conocimiento SHALL llegar sólo por `mcpServers`.

#### Scenario: El conteo no cambia
- GIVEN `OPERACIONES_NEGOCIO` tras este change
- WHEN se inspecciona su longitud y contenido
- THEN tiene longitud 10 y ninguna entrada es una consulta de conocimiento
- AND `operaciones-contract.test.ts` (conteo) pasa sin modificación

### Requirement: Sin filtrado por rol ni identidad del conocimiento en el chat — postura explícita

El wiring de conocimiento del chat SHALL NOT depender del rol, del `empleadoId` ni de la `SesionEmpleado`: la fábrica recibe únicamente el `casoId`. El turno SHALL ver el mismo vault que la TUI y `POST /soporte`. Cualquier filtrado, partición o auditoría del conocimiento por rol o identidad SHALL ser un change nuevo con su propio delta, no un cambio de comportamiento silencioso de este wiring. (La postura de fondo — si el vault es público por diseño — queda preexistente y sin resolver aquí; ADR 236.)

#### Scenario: La fábrica sólo recibe el `casoId`
- GIVEN una fábrica `createKnowledge` espiada
- WHEN se invoca el handler
- THEN la fábrica se llamó con exactamente un argumento, el `casoId` (no `sesion`, `empleadoId` ni rol)

#### Scenario: Dos empleados con roles distintos obtienen el mismo conjunto de servidores
- GIVEN dos sesiones vigentes de empleados con roles distintos (o uno sin rol registrado)
- WHEN cada uno dispara un turno
- THEN el conjunto de claves de `mcpServers` es idéntico e igual a `["knowledge", "operaciones"]`

### Requirement: Fallo del servidor de conocimiento — el error de construcción se propaga; la indisponibilidad de la tool no falla el turno

Si `createKnowledge(casoId)` lanza, el handler SHALL propagar ese mismo error (mismo criterio que `buildOnSoporte`, `src/build-on-soporte.ts:110`, sin guarda, y el "PROPAGA" del módulo, `src/build-on-operaciones-empleado.ts:36-38`), SHALL NOT invocar `handleTurn`, SHALL NOT llamar `conversacion.registrarTurno` y SHALL NOT degradar en silencio a un turno sólo con `operaciones` — eso reintroduciría el defecto que este change cierra. El servidor HTTP ya traduce un turno rechazado en `502 {"error":"error interno"}` (`src/adapters/web/server.ts:752-755`). La variante de `buildOnA2AEntrante` (`createKnowledge` dentro de un `try` que marca la tarea `FAILED`, `src/build-on-a2a-entrante.ts:157,173,211`) responde a su contrato "nunca rechaza" y no aplica: el chat tiene un caller esperando. Si en cambio el servidor se construyó bien y `graphify` falla al consultar, `handleKnowledgeQuery` nunca lanza (`src/adapters/knowledge/knowledge-tool.ts:11-12`): informa el fallo al modelo y el turno continúa, con `operaciones` intacta. Este change SHALL NOT alterar ese contrato.

#### Scenario: `createKnowledge` lanza
- GIVEN una fábrica `createKnowledge` que lanza un `Error` conocido
- WHEN se invoca el handler
- THEN la promesa rechaza con ese mismo error
- AND `handleTurn` y `conversacion.registrarTurno` no fueron llamados

#### Scenario: La consulta al vault falla pero el turno no
- GIVEN el servidor de conocimiento construido con un `execFileFn` que falla
- WHEN el modelo invoca la tool de conocimiento
- THEN la tool devuelve un resultado que indica el fallo, sin lanzar (contrato vigente de `knowledge-tool.test.ts`)

## MODIFIED Requirements

### Requirement: `CONVERSATIONAL_AGENT.allowedTools` tiene exactamente tres entradas, ninguna de acceso a filesystem/shell

`CONVERSATIONAL_AGENT.allowedTools` SHALL contener exactamente tres entradas, en este orden: la tool de conocimiento, `"Skill"` y la tool de consultas de negocio (`src/core/agents/definitions.ts:158`). NO contiene la tool de `operaciones`. El `AgentDefinition` que construye `construirAgenteEmpleadoOperaciones()` (`definitions.ts:255-261`, spread, sin mutar el original) SHALL contener exactamente cuatro: esas tres más la tool de `operaciones`. Ninguna entrada, en ninguna de las dos superficies, SHALL ser `Bash`, `Read`, `Write` ni `Edit`. Que una tool figure en `allowedTools` no la vuelve alcanzable: la frontera real es `mcpServers` por turno (`definitions.ts:154-157`, ADR 176).
(Previously: decía "exactamente tres entradas: la tool de conocimiento, la tool de `operaciones` y `"Skill"`" — desactualizado: `operaciones` nunca entra a `CONVERSATIONAL_AGENT` y la tool de consultas, agregada por `consultas-negocio-a2a-entrante`, no figuraba; no distinguía las dos superficies. Este change NO modifica `allowedTools`; sólo corrige el texto.)

#### Scenario: Verificación mecánica del array base
- GIVEN `definitions.ts` tras este change
- WHEN se inspecciona `CONVERSATIONAL_AGENT.allowedTools`
- THEN tiene longitud 3, es `[KNOWLEDGE_TOOL_QUALIFIED_NAME, "Skill", CONSULTAS_TOOL_QUALIFIED_NAME]` y no contiene `OPERACIONES_TOOL_QUALIFIED_NAME`
- AND ningún elemento es `"Bash"`, `"Read"`, `"Write"` ni `"Edit"`

#### Scenario: La variante de operaciones tiene cuatro y no muta la base
- GIVEN `construirAgenteEmpleadoOperaciones()` invocada
- WHEN se inspecciona su `allowedTools` y luego el de `CONVERSATIONAL_AGENT`
- THEN el primero es `[KNOWLEDGE_TOOL_QUALIFIED_NAME, "Skill", CONSULTAS_TOOL_QUALIFIED_NAME, OPERACIONES_TOOL_QUALIFIED_NAME]`, sin `Bash`/`Read`/`Write`/`Edit`
- AND el segundo sigue con longitud 3 (`definitions.test.ts:108-131`, sin modificación)
