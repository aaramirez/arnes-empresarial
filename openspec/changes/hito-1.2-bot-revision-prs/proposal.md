# Propuesta: Hito 3 — Bot de revisión de PRs (v1.2.0)

**Origen**: [Plan de Implementación, Hito 3](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-3-bot-de-revisión-de-prs) · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Negra "Adaptador de Webhooks" (molde del Servidor A2A 3.2), Riesgo 2 (concurrencia SQLite), Escenario de calidad 4 (operabilidad local) · [exploration.md](exploration.md).

## Intent

Hasta hoy el arnés solo sabe atender turnos que un humano tipea en la TUI: `startHarness()` crea **un** `caso` al arrancar el proceso y `buildOnSubmit` cierra sobre ese `casoId` fijo para toda la corrida (`src/main.ts:119-171`). Este hito rompe esa suposición y entrega lo que el plan pide textualmente: *"Un PR real dispara una revisión automática; cuando las observaciones quedan resueltas, el tablero se actualiza solo y se asigna la siguiente actividad."* Para eso hacen falta tres cosas nuevas: un punto de entrada HTTP verificado por firma que traduce un evento de GitHub en un turno del mismo Selector de Turno de Hito 1, un modelo de datos de `actividades` ligado a `casos`, y un adaptador saliente que espeje el estado canónico de SQLite sobre el tablero (Issues de GitHub) para que el humano lo vea. Es también el hito donde el proyecto adquiere su **primera concurrencia de escritura real** — dos webhooks casi simultáneos, o un webhook mientras la TUI está en medio de un turno — que el Riesgo 2 del arc42 anticipaba y que hasta ahora no había necesidad de resolver.

## Scope

### In Scope

- **Adaptador de Webhooks (entrante)** en `src/adapters/webhooks/`: listener `node:http` con una sola ruta `POST /webhooks/github`, verificación `X-Hub-Signature-256` (HMAC-SHA256 sobre el body crudo, `node:crypto`), y traducción del payload a un evento normalizado que se entrega por callback inyectado. Eventos: `pull_request` (`opened`, `synchronize`, `reopened`) e `issue_comment` (`created`, solo si el issue es un PR).
- **Adaptador de Tablero (saliente)** en `src/adapters/board/`: cliente REST de GitHub sobre `fetch` con `fetchFn` inyectable. Tres operaciones: leer metadatos del PR (título, cuerpo, autor, archivos cambiados), publicar la revisión como comentario (`POST /repos/{owner}/{repo}/issues/{number}/comments`) y espejar estado + responsable (`PATCH /repos/{owner}/{repo}/issues/{number}` → `labels`, `assignees`).
- **Contrato de actividad en el núcleo** (`src/core/activity/`): los cuatro valores canónicos de `actividades.estado`, la función pura de transición, la construcción del prompt sintético, y los puertos `ActivityStorePort` / `ActivityBoardPort` (ver ADR 6).
- **Turno disparado externamente**: `runActivityTurn(...)` — crea `caso` + `actividad` en una transacción, resuelve el turno con `handleTurn` (sin modificarlo), aplica la transición de estado y dispara el espejo al tablero, best-effort.
- **Migración `0003_proyectos_responsables_actividades.ts`**: tablas `proyectos`, `responsables`, `actividades` + `idx_actividades_proyecto`, exactamente como las declara el plan (incluidos los tres valores de `tipo`, aunque este hito solo ejercite uno — ver ADR 5 y *Fuera de alcance*).
- **Estrategia de concurrencia de escritura**: `journal_mode = WAL` en `openDatabase` + cola en memoria por `proyecto_id` (`Map<string, Promise<void>>`) que serializa el ciclo leer-actividad → turno → escribir-actividad.
- **Composition root reestructurado** (`src/main.ts` + un módulo hermano nuevo de `build-on-submit.ts`): dos fuentes de turnos concurrentes en el mismo proceso, N `caso`s por corrida (ver ADR 5).
- **Configuración por env**: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `WEBHOOK_PORT`, `WEBHOOK_PATH`, vía un `resolveWebhookConfig(env)` / `resolveBoardConfig(env)` puros, calcados de `resolveGraphifyConfig` (`src/adapters/knowledge/config.ts`).
- **Eventos nuevos de `logTurnEvent`** correlacionados por `casoId`, sin cambiar el contrato del logger (mismo criterio que Hito 2).

### Out of Scope

- **Segunda fuente (incidentes de IT) conectada en vivo.** El esquema acepta `tipo` `'incidente'` y el adaptador enruta por origen, pero no se registra ni se autentica un segundo emisor en este hito — ver ADR 5, *Consecuencias*, y *Fuera de alcance / diferido*.
- **`'solicitud_interna'` como flujo end-to-end.** Mismo argumento: valor válido del esquema, sin camino vivo.
- **Segundo `AgentDefinition` ni ruteo multi-agente.** Se reusa `CONVERSATIONAL_AGENT` (ver *Approach — agente y prompt sintético*); bifurcar el Selector de Turno es v2 (swarm), ADR 1 del arc42.
- **Revisión sobre el diff completo del PR.** El MVP revisa metadatos + lista de archivos cambiados, con tope de truncado explícito. Ver *Risks* R4.
- **Modo headless / demonio sin TUI.** El proceso sigue teniendo a la TUI como dueña del ciclo de vida (ver ADR 5). Un `npm run dev:webhooks-only` es trabajo de un hito futuro.
- **Nueva `TurnStage` en `turn-error.ts`.** La resolución del turno del webhook usa las mismas etapas que la de la TUI; el error de traducción webhook→turno es un error propio del adaptador, no una etapa nueva.
- **Modificar `handleTurn`.** No recibe dependencias nuevas: el ciclo de actividad lo envuelve, no lo invade (ver ADR 6).
- **Exponer el endpoint a internet en CI o en el suite de tests.** Todo el TDD corre con fixtures y firmas calculadas a mano; la verificación end-to-end con GitHub real es manual.
- **Rate-limiting, reintentos con backoff y paginación de la API de GitHub.** Una llamada por transición no lo justifica.
- **Dependencias nuevas en `package.json`.**

## Capabilities

### New Capabilities

- `activity-webhook-turn`: un evento externo verificado por firma crea una actividad ligada a un caso, dispara un turno del Selector de Turno y persiste el estado resultante en SQLite como fuente canónica.
- `activity-board-mirror`: espejo unidireccional del estado canónico de la actividad sobre el tablero externo (labels, assignees, comentario de revisión), best-effort y nunca bloqueante del turno.

### Modified Capabilities

- `knowledge-query`: sin cambios de contrato, pero su adaptador pasa a instanciarse **por caso** en vez de una vez por proceso, para no cruzar citas entre turnos concurrentes (ver ADR 5, *Consecuencias*).

## Decisiones de arquitectura fijadas por esta propuesta

La exploración dejó dos preguntas explícitamente abiertas. Esta propuesta las cierra acá, en formato ADR corto, para que el checkpoint humano apruebe la dirección **antes** del diseño técnico completo. La numeración continúa la del arc42 (ADR 1-2) y la de Hito 2 (ADR 3, 3.1, 4); la versión detallada de cada uno va a `design.md` y, al cerrar el hito, al arc42.

### ADR 5: El composition root pasa de "un `caso` al boot" a un *disparador de turno por evento*

**Contexto**. `startHarness()` crea un único `caso` (`tipo: "conversacion"`) antes de montar la TUI, y `buildOnSubmit(caso.id, ...)` cierra sobre ese id para toda la corrida (`src/main.ts:119-171`). Un webhook necesita un `caso` **nuevo por evento**, en cualquier momento del ciclo de vida del proceso, potencialmente mientras la TUI ya está resolviendo su propio turno. `assembleContext` exige que el `caso` exista antes de llamar `handleTurn` (`CasoNotResolvedError`), así que alguien tiene que crearlo por evento. La exploración descartó con razón el proceso separado (opción C: contradice "monolito modular de un solo paquete" de `AGENTS.md` y rompe la cola *intra-proceso* que el propio plan exige) y el adaptador que arma sus propios `deps` (opción B: ubica la responsabilidad de conectar adaptadores concretos dentro de un adaptador, justo lo que los module docs de `main.ts` y `build-on-submit.ts` argumentan que no debe pasar).

**Decisión**. Se generaliza el patrón que `build-on-submit.ts` ya establece — *aplicación parcial en el composition root* — en vez de reescribirlo:

1. **La TUI no cambia en nada.** Sigue creando su `caso` de conversación al boot y `buildOnSubmit` sigue cerrando sobre él. Cero regresión sobre los entregables de Hito 1 y 2.
2. **Se agrega un módulo hermano** de `build-on-submit.ts`, en `src/` raíz (mismo nivel que `core/` y `adapters/`, por la misma razón que ese archivo documenta: conecta adaptadores concretos con el núcleo, así que no puede vivir dentro de ningún adaptador), que devuelve un callback `(evento normalizado) => Promise<void>`. Ese callback es el que crea `caso` + `actividad`, arma `HandleTurnDeps` y delega en el núcleo.
3. **El Adaptador de Webhooks recibe ese callback inyectado**, molde `startTui(onSubmit)` — opción A de la exploración. El adaptador solo escucha, verifica firma, parsea y normaliza; no importa memoria, ni agentes, ni el tablero.
4. **La TUI sigue siendo dueña del ciclo de vida del proceso**: `await tui.waitUntilExit()` y, en el `finally`, se cierra primero el servidor HTTP y después `db.close()`.
5. **El listener es opt-in**: sin `GITHUB_WEBHOOK_SECRET` no se abre ningún puerto; se loguea una línea de "adaptador de webhooks deshabilitado" y el proceso arranca idéntico a hoy.

**Alternativas consideradas**:

- *Endpoint siempre abierto respondiendo 503 sin config*: rechazada. Abrir un puerto en la máquina de cualquiera que solo quiera correr la TUI es una regresión de seguridad y de operabilidad frente al Escenario de calidad 4 del arc42 ("el único requisito es Node + credenciales de Anthropic"), y un 503 no aporta nada: sin secreto compartido GitHub no puede estar configurado contra ese endpoint de todos modos. Se prefiere degradación por ausencia total del listener, misma filosofía que el Adaptador de Conocimiento degradando sin `graphify`.
- *Refactorizar `buildOnSubmit` para que cree el `caso` por prompt*: rechazada. Cambia el comportamiento de Hito 1 (la TUI dejaría de recordar el historial entre prompts de la misma sesión, que es literalmente su entregable funcional) a cambio de una simetría estética.
- *El servidor HTTP como dueño del ciclo de vida, TUI opcional*: rechazada por ahora. Es la forma correcta para un despliegue real, pero invierte el arranque del proceso sin que ningún entregable de este hito lo pida. Queda diferida como "modo headless".

**Consecuencias**:

- `main.ts` gana una responsabilidad real (orquestar dos fuentes de turnos) pero no gana lógica de negocio: sigue siendo wiring. La parte testeable se extrae al módulo hermano, igual que `build-on-submit.ts`.
- **Hallazgo no anticipado por la exploración, y es un bug latente**: `createKnowledgeAdapter({ casoId })` se construye hoy **una vez por proceso** (`src/main.ts:140`) y comparte un `CitedNodesRecorder` de vida de proceso, drenado solo por `saveTurnResult`. Con dos turnos concurrentes, las citas de uno contaminan el `save-result` del otro. La resolución que fija esta propuesta es **instanciar el adaptador de conocimiento por caso**. `sdd-design` debe confirmar que `createKnowledgeAdapter` no tiene efecto global (no lo parece: es config + un objeto servidor MCP in-process) y medir su costo de construcción.
- Aparece por primera vez concurrencia real entre turnos. Se acota con la cola por `proyecto_id` y WAL (ver *Approach*), no con un lock global.

### ADR 6: El "tablero" es un puerto del Núcleo (`ActivityBoardPort`), no lógica interna del Adaptador de Webhooks

**Contexto**. El plan dice que `actividades.estado` en SQLite es la fuente canónica y que los labels de GitHub son "un espejo unidireccional", pero no dice **quién** dispara ese espejo. La exploración planteó la disyuntiva: ¿un puerto en `src/core/` análogo a `KnowledgeFeedbackPort`, o toda la lógica dentro del Adaptador de Webhooks sin que el núcleo se entere?

**Decisión**. Puerto del Núcleo. Se crea `src/core/activity/activity-contract.ts` — sin imports, como `knowledge-contract.ts` — que define:

- Los cuatro valores canónicos de estado (`pendiente_revision`, `observado`, `resuelto`, `aprobado`) y los tres de `tipo`, como constantes.
- `transicionarEstado(estadoActual, veredicto)`: función **pura** de transición.
- `ActivityStorePort`: crear actividad + su caso en una transacción, leer y actualizar estado (implementado por `src/adapters/memory/`).
- `ActivityBoardPort`: `mirrorEstado({ proyectoId, referenciaExterna, estado, responsableId })` y `publicarRevision(...)`. **Mismo contrato que `KnowledgeFeedbackPort`: nunca rechaza** — traga y loguea sus fallas adentro, porque el estado canónico ya se persistió y el turno ya terminó.
- El mapeo estado → label de GitHub (`necesita-revision`, `observaciones-pendientes`, `resuelto`, `aprobado`) vive en `src/adapters/board/`, no en el núcleo: es un detalle de GitHub, no del dominio.

El orquestador (`runActivityTurn`) vive en el núcleo y **envuelve** `handleTurn`, no lo modifica: no todo turno tiene una actividad, y meterle otra dependencia opcional a un módulo ya revisado y estable es exactamente el riesgo de regresión que Hito 2 evitó.

**Alternativas consideradas**:

- *Toda la lógica dentro del Adaptador de Webhooks*: **rechazada, y no por gusto estético — viola una regla no negociable de `AGENTS.md`**: "Ningún adaptador se comunica directamente con otro adaptador — todo pasa por el núcleo". Si el adaptador de webhooks decide cuándo cambia el estado y llama al adaptador de tablero, eso es literalmente adaptador→adaptador. Además ubicaría la máquina de estados de `actividades` —que es lógica de negocio, con cuatro valores y transiciones definidas por el plan— dentro de un adaptador de transporte HTTP, donde nadie la va a encontrar y donde queda acoplada al formato de payload de GitHub.
- *Invocar el puerto desde `handleTurn`, como `knowledgeFeedback`*: rechazada. `handleTurn` es genérico y la mayoría de los turnos no tienen actividad; sumarle un tercer colaborador opcional lo empuja hacia un god-object. El envoltorio consigue el mismo punto de invocación bien definido sin tocar código ya aprobado.
- *Un puerto único que mezcle almacenamiento y tablero*: rechazada. Tienen contratos opuestos: el store **debe** fallar ruidosamente (si no se persiste el estado canónico, el turno mintió), el tablero **nunca** debe fallar (es un espejo cosmético). Un solo puerto obligaría a elegir una de las dos semánticas para ambos.

**Consecuencias**:

- El núcleo aprende que existe un concepto de "tablero", pero **no** que existe GitHub: el puerto habla de estados y responsables, no de labels ni de números de issue de una API concreta. La frontera hexagonal queda más nítida, no menos.
- Cambiar de tablero (Jira, Linear) en un hito futuro es escribir otro adaptador, sin tocar el núcleo.
- El flujo de datos queda: Webhooks → (callback del composition root) → Núcleo → Memoria + Tablero. Ningún adaptador le habla a otro.
- Se paga un archivo de contrato y un orquestador nuevos en `src/core/`, más superficie de test — que es justo lo que TDD estricto quiere que sea testeable sin I/O.

## Approach

**Traducción evento → turno.** El adaptador normaliza el payload de GitHub a un tipo propio (`IncomingActivityEvent`: origen, `proyectoId` = `owner/repo`, `tipo`, `referenciaExterna`, `responsableId`, `titulo`, `cuerpo`, `archivosCambiados`, `comentarioDisparador`). Ese tipo es el contrato entre adaptador y composition root — el núcleo nunca ve un payload de GitHub. Enrutar un segundo origen en el futuro es registrar otro verificador + otro mapper hacia ese mismo tipo, sin tocar nada más; eso es lo que el plan quiere decir con *"el adaptador y su forma de traducir a turno no [cambian]"*, y es lo que este hito deja demostrado sin conectar el segundo emisor.

**Firma y body crudo.** La firma se calcula sobre los bytes exactos recibidos, así que el handler acumula el body como `Buffer` y verifica **antes** de cualquier `JSON.parse`. Comparación con `timingSafeEqual`, con chequeo previo de longitudes iguales (si difieren, se rechaza sin comparar). Body con tope de tamaño explícito para no aceptar un POST ilimitado. Firma inválida → `401` y evento de log, sin crear caso ni actividad.

**Agente y prompt sintético.** Se reusa `CONVERSATIONAL_AGENT` y **no se toca `definitions.ts`**: el framing de revisión viaja en el prompt sintético que construye una función pura del núcleo (`buildActivityPrompt(actividad, contexto)`), no en el system prompt del agente. Motivo: `resolveTurn` hoy devuelve siempre el único agente registrado, y un segundo `AgentDefinition` obligaría a bifurcar el Selector de Turno — que es exactamente lo que Hito 2 evitó por pertenecer a v2. Cambiar el system prompt del agente conversacional, en cambio, contaminaría la identidad que Hito 2 acaba de fijar y afectaría también a los turnos de TUI. El prompt sintético incluye título, cuerpo, autor y lista de archivos cambiados del PR (traídos por el Adaptador de Tablero antes del turno), truncados con un tope explícito — no el diff completo.

**Veredicto y transición de estado.** El prompt sintético pide al agente cerrar con una línea legible por máquina (`VEREDICTO: <valor>`). Una función pura del núcleo la parsea y la traduce a estado; si no se puede parsear, el estado cae a `observado` (nunca a `aprobado` — un fallo de parseo jamás debe aprobar un PR solo). Eso es lo que hace posible la segunda mitad del entregable: cuando llega el `issue_comment`/`synchronize` que resuelve las observaciones, el siguiente turno transiciona y el tablero se actualiza solo.

**Concurrencia.** `journal_mode = WAL` se agrega a `openDatabase` (una línea; aparecen los archivos auxiliares `-wal`/`-shm` junto a `data/harness.db`, a contemplar en `.gitignore`). La cola es un `Map<string, Promise<void>>` encadenado por `proyecto_id`, con borrado de la entrada al resolver para no crecer indefinidamente. **Precisión importante para el diseño**: `better-sqlite3` es síncrono, así que dos sentencias SQL nunca se interleavan dentro del proceso — el peligro real no es esa, es el ciclo *leer actividad → `await` del modelo → escribir actividad*, que sí se interleava a través del `await`. La cola existe para serializar ese ciclo lógico, no las sentencias.

**Errores y degradación.** Sin `GITHUB_TOKEN`, el `ActivityBoardPort` se instancia como no-op que loguea: el estado canónico se sigue persistiendo en SQLite y solo se omite el espejo. Sin `GITHUB_WEBHOOK_SECRET`, no hay listener. Toda falla del tablero se traga y se loguea (contrato del puerto). Toda falla del store propaga como error de turno.

**Testing (TDD estricto).** Fixtures de payload `pull_request` e `issue_comment` en el repo, firmas HMAC calculadas con un secreto de test dentro del propio test, `fetchFn` inyectable para el tablero, y la cola por clave testeada con promesas controladas sin I/O. Nada del suite por defecto abre un puerto real ni le pega a la API de GitHub. La verificación manual del entregable (un PR real) se hace exponiendo el endpoint con `gh webhook forward` o `smee.io` — herramienta externa, solo para la demo, no para CI; queda en el plan de verificación de `sdd-design`.

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/activity/activity-contract.ts` | New | Constantes de `tipo`/`estado`, `ActivityStorePort`, `ActivityBoardPort`. Sin imports. |
| `src/core/activity/` (transición + prompt + orquestador) | New | `transicionarEstado`, `parseVeredicto`, `buildActivityPrompt`, `runActivityTurn` — envuelve `handleTurn`, no lo modifica |
| `src/adapters/webhooks/` | New | `config.ts`, verificación HMAC, servidor `node:http`, mapper payload → `IncomingActivityEvent`, fachada `index.ts` |
| `src/adapters/board/` | New | `config.ts`, cliente REST sobre `fetchFn` inyectable, mapeo estado → label, implementación de `ActivityBoardPort` |
| `src/adapters/memory/migrations/0003_proyectos_responsables_actividades.ts` | New | Tablas del plan + índice, estilo de `0001_casos_sesiones_agente.ts` |
| `src/adapters/memory/repository.ts` | Modified | CRUD de `proyectos`/`responsables`/`actividades`; creación transaccional de `caso` + `actividad` |
| `src/adapters/memory/db.ts` | Modified | `db.pragma("journal_mode = WAL")` |
| `src/main.ts` | Modified | Wiring de las dos fuentes de turnos, cierre ordenado (servidor HTTP → db), adaptador de conocimiento por caso |
| `src/` (módulo hermano de `build-on-submit.ts`) | New | Callback `evento → turno` que el Adaptador de Webhooks recibe inyectado |
| `src/core/logging/turn-logger.ts` | Modified | Eventos nuevos (`webhook-recibido`, `firma-invalida`, `actividad-creada`, `tablero-actualizado`, ...) — datos, sin cambio de contrato |
| `src/core/config/env.ts` | Modified | Variables `GITHUB_*` / `WEBHOOK_*` en el punto único de carga |
| `.gitignore` | Modified | `data/*.db-wal`, `data/*.db-shm` |

## Dependencias nuevas

**Ninguna.** Se confirma explícitamente la inclinación de la exploración: `node:http` para un endpoint único (un router es sobre-ingeniería para una ruta), `node:crypto` para HMAC (~10 líneas contra una dependencia entera), y `fetch` global para 3 llamadas REST (`@octokit/rest` trae megabytes y decenas de transitivas para eso). Mismo criterio de minimalismo que rechazó `@modelcontextprotocol/sdk` en Hito 2.

**Salvedad honesta**, aprendida del ADR 3.1 de Hito 2 (donde el diseño tuvo que corregir a la propuesta declarando `zod`): `engines.node` dice `>=18`, y en Node 18 el `fetch` global existe pero emite `ExperimentalWarning`. `sdd-design` debe decidir si se sube `engines.node` a `>=20` (recomendado, y es lo que `@types/node@^20` ya sugiere de facto) o si se convive con el warning. Es un cambio de metadato, no una dependencia — pero si esa decisión terminara requiriendo un paquete, vuelve al checkpoint humano como corrección de esta propuesta.

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | El adaptador de conocimiento compartido por proceso cruza citas entre turnos concurrentes (bug latente descubierto en esta propuesta) | Alta si no se toca | Instanciarlo por caso (ADR 5); `sdd-design` confirma costo de construcción y ausencia de efecto global |
| R2 | El composition root es el cambio de mayor superficie del hito y toca código ya aprobado de Hito 1/2 | Med | La TUI conserva su camino exacto de hoy; lo nuevo se agrega al lado. Los tests existentes de `build-on-submit` son la red de regresión |
| R3 | Abrir un puerto rompe el Escenario de calidad 4 (operabilidad local) | Med | Listener opt-in: sin `GITHUB_WEBHOOK_SECRET` no se abre nada (ADR 5) |
| R4 | La "revisión automática" sin diff resulta superficial y el entregable no convence al tutor | **Alta** | MVP con metadatos + archivos cambiados; **el checkpoint humano debe decidir explícitamente si acepta este alcance o exige el diff** — es la limitación más discutible de esta propuesta |
| R5 | El agente no emite el `VEREDICTO:` en el formato pedido y el estado no transiciona | Med | Parser tolerante + default seguro a `observado` (nunca `aprobado`); criterio de aceptación explícito |
| R6 | La cola por `proyecto_id` filtra memoria en un proceso de vida larga | Baja | Borrar la entrada del `Map` al resolver la promesa encadenada; test específico |
| R7 | Segunda fuente (incidentes) sin autenticación definida sería una superficie de ataque | — | **Cerrada por alcance**: no se conecta un segundo emisor en este hito |
| R8 | La verificación end-to-end necesita exponer el endpoint (ngrok/smee/`gh`) | Med | Solo afecta la demo manual; el TDD corre 100% con fixtures. La herramienta se fija en el plan de verificación de `sdd-design` |
| R9 | WAL agrega archivos `-wal`/`-shm` que ensucian el repo o scripts de backup | Baja | `.gitignore` en este mismo hito |

## Rollback Plan

El cambio es aditivo. Revertir en caliente = quitar `GITHUB_WEBHOOK_SECRET` del entorno: no se abre el listener, no se crean actividades, y la TUI se comporta exactamente como en `v1.1.0`. Las tablas nuevas quedan vacías y no las lee nadie más; la migración `0003` no altera `casos` ni `sesiones_agente`. `journal_mode = WAL` es reversible con `journal_mode = DELETE` sin pérdida de datos. A nivel git: revertir los commits de `hito/v1.2-bot-revision-prs` antes del merge a `main`.

## Dependencies

- Hito 2 cerrado (`v1.1.0`) — ya lo está.
- Para la demo: un repositorio de GitHub con permisos para crear webhook, un token con scope de Issues/PRs, y una herramienta de forwarding (`gh webhook forward` o `smee.io`). Nada de esto es requerido en CI.
- Checkpoint humano de `AGENTS.md` aprobando esta propuesta —**en particular el ADR 5, el ADR 6, y el alcance de R4**— antes de `sdd-spec`/`sdd-design`.

## Success Criteria

- [ ] Un PR real en un repo de prueba dispara el webhook, se verifica la firma, se crean `proyecto`/`actividad`/`caso`, y el agente publica una revisión como comentario del PR — entregable funcional del hito.
- [ ] El label del Issue refleja `actividades.estado` tras la revisión, y al resolverse las observaciones el label cambia solo y se asigna el `assignee` correspondiente.
- [ ] Un POST con firma inválida devuelve `401` y **no** crea ninguna fila en SQLite.
- [ ] Sin `GITHUB_WEBHOOK_SECRET`, `npm run dev` arranca la TUI sin abrir ningún puerto y sin fallar.
- [ ] Sin `GITHUB_TOKEN`, el turno completa y el estado se persiste; solo se omite el espejo al tablero, sin excepción no capturada.
- [ ] Dos eventos casi simultáneos del mismo `proyecto_id` no pisan la misma fila de `actividades` (test con la cola, sin I/O real).
- [ ] Un turno de webhook concurrente con un turno de TUI no cruza citas de conocimiento entre sí (regresión de R1).
- [ ] `npm test` y `npm run typecheck` en verde; ningún test abre un puerto real ni llama a la API de GitHub.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v1.2-bot-revision-prs/` con evidencia, tag `v1.2.0`.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| Segunda fuente de webhooks (incidentes de IT) conectada y autenticada | Hito futuro, o ampliación de este si el checkpoint humano lo exige | El entregable funcional del plan nombra **solo** el PR. Aceptar un segundo emisor exige un modelo de amenaza propio (¿qué secreto?, ¿qué header?, ¿qué pasa si viaja sin firma?) que la exploración marcó como superficie de seguridad abierta. Shippear eso a medias es peor que diferirlo. La forma genérica queda **demostrada** por el tipo `IncomingActivityEvent` y por el `tipo` de tres valores en el esquema. |
| `'solicitud_interna'` end-to-end | Ídem | Mismo argumento; no aporta nada al entregable y duplica el trabajo de mapeo. |
| Revisión sobre el diff completo | Hito futuro | Tope de tokens, truncado y estrategia de chunking son un problema propio. El MVP demuestra el circuito completo; profundizar la calidad de la revisión es una mejora incremental sobre un circuito que ya funciona. |
| Modo headless (servidor sin TUI) | Hito futuro | Invierte quién es dueño del ciclo de vida del proceso sin que ningún entregable actual lo pida. |
| Segundo agente / ruteo multi-agente | v2 (swarm), ADR 1 del arc42 | Bifurcar el Selector de Turno sin ganancia funcional es exactamente lo que Hito 2 rechazó. |
| Reintentos, backoff y rate-limiting contra GitHub | Cuando haya volumen real | Una llamada por transición de estado no lo justifica. |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain` antes de leer código fuente. El ejecutor de esta fase corrió sin herramienta de shell disponible, así que no se pudo invocar el binario — la propuesta se apoya en el mapeo que ya hizo `exploration.md` más lecturas puntuales de `src/main.ts`, `src/build-on-submit.ts`, `src/core/knowledge/knowledge-contract.ts`, `src/adapters/memory/db.ts` y `package.json` para verificar cada afirmación citada. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` sí ejecute `graphify explain` sobre los conceptos nuevos (`ActivityBoardPort`, cola por proyecto, composition root).
