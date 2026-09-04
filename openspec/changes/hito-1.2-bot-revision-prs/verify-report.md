# Verification Report

Verificacion holistica del Hito 3 (v1.2 - Bot de revision de PRs), corrida "Despues de la tarea 24" segun pide `tasks.md`. Las 23 tareas de codigo ya pasaron su propio ciclo Implementer->Reviewer individual (mas varios commits adicionales de hardening surgidos durante la tarea 24, ver seccion dedicada); este reporte confirma que lo committeado en `hito/v1.2-bot-revision-prs` coincide con eso, corre limpio en conjunto, cumple la frontera hexagonal, y evalua honestamente la evidencia de verificacion manual end-to-end ya recolectada en `docs/progreso/v1.2-bot-revision-prs/README.md`.

Comando ejecutado en secuencia, `dist/` limpio primero:

```
rm -rf dist && npm run typecheck && npm test
```

- `typecheck` (`tsc --noEmit`): PASS, sin salida (sin errores).
- `test` (`vitest run`): PASS - 40 test files, 477 tests, 0 fallos.

(`npm run build` no se corrio en esta sesion, no forma parte del criterio literal de esta verificacion en `tasks.md`/`design.md`, que solo pide `npm test` y `npm run typecheck` en verde para el checklist de cierre; `typecheck` ya cubre la superficie de tipos que `build` tambien ejercitaria.)

## Regla no negociable de arquitectura hexagonal

Grep real sobre el arbol actual de `src/`:

- `from ".*adapters` dentro de `src/core/**` -> 0 resultados. `src/core/` (incluidos los nuevos `src/core/activity/` y `src/core/concurrency/`) no importa nada de `src/adapters/*`.
- Grep de imports dentro de `src/adapters/webhooks/**`: solo referencias relativas dentro del propio directorio (`./config.js`, `./server.js`, `./github-mapper.js`, `./signature.js`) mas `../../core/activity/activity-contract.js`. Ningun import a `adapters/board`, `adapters/memory`, `adapters/tui` ni `adapters/knowledge`.
- Mismo grep sobre `src/adapters/board/**`: solo referencias relativas propias (`./config.js`, `./github-client.js`, `./labels.js`) mas `../../core/activity/activity-contract.js`. Ningun import a otro adaptador.
- `src/adapters/tui/**` y `src/adapters/knowledge/**` (ya verificados en el cierre de Hito 2, re-confirmados aca): sin cambios de import cruzado.
- Excepcion documentada de composition root: `src/main.ts` y `src/build-on-activity.ts` son los unicos archivos que importan simultaneamente de `src/core/*` y de mas de un `src/adapters/*` (`board`, `webhooks`, `memory`, `knowledge`). `build-on-activity.ts` lo declara explicitamente en su module doc ("un archivo que conecta ambos lados no puede vivir dentro de ninguno de los dos sin volverse, estructuralmente, un adaptador hablandole a otro adaptador"). Mismo patron que `build-on-submit.ts` ya establecia en Hito 1/2.

Caso especifico del bug de auto-loop verificado con atencion: `resolveBotLogin` vive en `src/adapters/board/index.ts` (adaptador de tablero, que ya tiene el token de GitHub). El filtro que usa ese login (`comment.authorLogin === botLogin`) vive en `src/adapters/webhooks/github-mapper.ts` (`mapIssueCommentEvent`), en el adaptador de webhooks. La conexion entre ambos NO es un adaptador importando al otro: `botLogin` viaja como parametro plano (`string | undefined`) a traves de `WebhookServerDeps` (`server.ts`) y `startWebhookServer` (`index.ts`), ambos en `adapters/webhooks/`, resuelto y pasado desde `src/main.ts` (composition root). El module doc de `resolveBotLogin` es explicito sobre esta decision: "NO se importa aca WEBHOOK_LOG_CORRELATION_ID de adapters/webhooks/config.ts, porque eso seria un adaptador (board) hablandole directo a otro adaptador (webhooks), justo lo que AGENTS.md prohibe". Confirmado leyendo el codigo: correcto.

Veredicto de esta regla: CUMPLE, en todo el codigo actual, incluida la correccion del bug de auto-loop.

## Checklist de las 23 tareas de codigo

### Nucleo (tareas 1-7)

1. `src/core/activity/activity-contract.ts` - PASS. Constantes `ACTIVIDAD_ESTADOS` (4 valores, orden pendiente_revision/observado/resuelto/aprobado), `ACTIVIDAD_TIPOS` (3 valores), `VEREDICTOS` (3 valores, sin pendiente_revision), `VEREDICTO_PREFIX = "VEREDICTO:"` confirmados leyendo el archivo. `ActivityStorePort`/`ActivityBoardPort`/`IncomingActivityEvent`/`PullRequestMetadata` exportados tal como el diseno los especifica, sin diferencias.

2. `src/core/concurrency/keyed-queue.ts` - PASS. `createKeyedQueue()` sin imports (confirmado). Las 4 garantias presentes: orden por clave (`previousTail.then(task, task)`), aislamiento por clave (`Map` por key), no contagio (`.then(noop, noop)` en la cadena interna), sin fuga con chequeo de IDENTIDAD antes de borrar (`if (tails.get(key) === newTail)`) - exactamente el detalle fino que R6 exige.

3. `src/core/activity/transicion-estado.ts` - PASS. `parseVeredicto`: toma la ULTIMA coincidencia de la regex, tolera decoracion markdown, normaliza acentos/mayusculas/puntuacion, matchea sinonimos, y cualquier valor no reconocido (incluido "sin linea") cae a VEREDICTO_OBSERVADO - nunca a "aprobado", confirmado leyendo el flujo completo de la funcion (no hay ningun camino que devuelva VEREDICTO_APROBADO salvo el match explicito contra APROBADO_SINONIMOS). `transicionarEstado`: matriz confirmada linea por linea contra la tabla del diseno - aprobado/observado desde cualquier estado, resuelto solo desde observado, sin cambio en cualquier otro caso.

4. `src/core/activity/activity-prompt.ts` - PASS. Estructura de 8 secciones en el orden exacto del diseno. Truncado con marca y topes (MAX_PROMPT_TITULO_CHARS, MAX_PROMPT_CUERPO_CHARS, MAX_PROMPT_COMENTARIO_CHARS, MAX_PROMPT_ARCHIVOS) confirmados como constantes exportadas con los valores del diseno (300/4000/2000/50). Sin metadatos, degrada a los fallbacks del evento con una linea explicita que lo declara. Con comentarioDisparador, cambia el framing ("verifica si esto resuelve tus observaciones anteriores"). Limitacion R4 declarada literalmente: "no tenes el diff completo del PR..." - cubierta por un test dedicado (activity-prompt.test.ts, describe "limitacion declarada de R4") que ademas verifica con regex que el prompt nunca sugiere tener el diff.

5. `src/core/activity/run-activity-turn.ts` - PASS. Secuencia de 9 pasos confirmada leyendo el cuerpo completo de runActivityTurn: findActividadPorReferencia -> crea o reusa (con eventos actividad-creada/actividad-reusada) -> leerMetadatosSeguro (nunca lanza) -> buildActivityPrompt -> runTurn (propaga sin llamar nada mas si rechaza) -> parseVeredicto/transicionarEstado -> store.updateActividadEstado SIEMPRE antes de publicarRevision/mirrorEstado (confirmado por el orden literal del codigo, lineas 242-271) -> efectos de tablero envueltos en ejecutarEfectoDeTableroSeguro (try/catch silencioso, documentado explicitamente por que). Contrato de propagacion (store y runTurn propagan, board nunca) confirmado.

6. `src/core/config/env.ts` - PASS (TDD exception, segun marca tasks.md). Variables GITHUB_WEBHOOK_SECRET/GITHUB_TOKEN/WEBHOOK_PORT/WEBHOOK_PATH/WEBHOOK_MAX_BODY_BYTES/GITHUB_API_BASE_URL/BOARD_TIMEOUT_MS registradas en el punto unico de carga (confirmado que `import "./core/config/env.js"` sigue siendo el primer import de main.ts).

7. `package.json` - PASS (TDD exception). `"engines": { "node": ">=20" }` confirmado leyendo el archivo directamente.

### Adaptador de Webhooks (tareas 8-12)

8. `src/adapters/webhooks/config.ts` - PASS. `resolveWebhookConfig(env = process.env)` pura, `import "../../core/config/env.js"` de efecto lateral presente.

9. `src/adapters/webhooks/signature.ts` - PASS. `verifySignature` confirmado: chequeo de longitud (`expectedBuffer.length !== actualBuffer.length`) ANTES de `timingSafeEqual` - el comentario en el codigo es explicito sobre por que (RangeError si no se chequea antes), exactamente lo que ADR 9 y el spec piden. Header ausente/vacio/prefijo faltante -> false sin lanzar.

10. `src/adapters/webhooks/github-mapper.ts` - PASS, incluida la extension de la tarea 24. `mapPullRequestEvent`/`mapIssueCommentEvent` con narrowing manual, sin zod (justificado en el module doc). Issue sin pull_request -> undefined (`!issue.isPullRequest`). Filtro anti-loop por botLogin agregado como cuarto parametro opcional de mapIssueCommentEvent, con comentario in-line documentando el bug real que lo motivo. responsableId = autor del PR/issue, no quien comenta - confirmado en la tabla de mapeo del module doc y en el codigo.

11. `src/adapters/webhooks/server.ts` - PASS. Tabla de respuestas confirmada linea por linea contra el codigo: 404 (metodo/path), 413 + req.destroy() sin verificar firma (el chequeo de tamano ocurre en el handler "data", antes de que "end" siquiera calcule la firma), 401 con webhook-firma-invalida y sin invocar onEvent, 400 con JSON.parse roto, 202 con evento ignorado o valido. ADR 10 confirmado: res.end() se llama ANTES de onEvent(evento) (lineas 234-241, sin await sobre onEvent). close() con Promise.race contra SERVER_CLOSE_TIMEOUT_MS y logueo de webhook-cierre-con-turnos-en-vuelo si excede el timeout.

12. `src/adapters/webhooks/index.ts` - PASS. Sin secreto -> undefined, webhook-deshabilitado logueado, createServer nunca se llama (no hay ninguna rama de codigo que lo alcance antes del return undefined). botLogin propagado condicionalmente hacia WebhookServerDeps con spread bajo exactOptionalPropertyTypes.

### Adaptador de Tablero (tareas 13-16)

13. `src/adapters/board/config.ts` - PASS. `resolveBoardConfig`/`isBoardEnabled` con el mismo patron que webhooks/config.ts.

14. `src/adapters/board/labels.ts` - PASS. Los 4 mapeos exactos de ESTADO_LABELS. mergeLabels quita todos los MANAGED_LABELS presentes (filter sobre `!MANAGED_LABELS.includes(label)`) y agrega el nuevo, preservando el orden relativo de labels ajenos - confirmado leyendo la implementacion de 6 lineas, sin ambiguedad.

15. `src/adapters/board/github-client.ts` - PASS, incluido R15 (verificado en vivo con npm run typecheck limpio en esta sesion, Node v24 con @types/node@^20: sin friccion de tipos para fetch/AbortSignal.timeout). githubRequest con headers exactos, Authorization: Bearer <token> presente pero el token NUNCA aparece en ningun mensaje de GithubApiError (confirmado leyendo las 3 construcciones de error: solo interpolan method/path/status/cuerpo de respuesta truncado, nunca config.token) - cubierto ademas por un test dedicado ("never leaks the token into the GithubApiError message on !response.ok"). splitProyectoId valida exactamente una barra. Clasificacion timeout/network/http/parse confirmada.

16. `src/adapters/board/index.ts` - PASS. createNoopBoardAdapter sin token: los tres metodos loguean tablero-deshabilitado y nunca tocan fetchFn. mirrorEstado: GET de labels actuales (con fallback a mergeLabels([], estado) + tablero-labels-no-leidos si el GET falla) + PATCH con assignees OMITIDO (no []) cuando no hay responsableId - confirmado en el spread condicional. publicarRevision trunca con truncateSafely (version UTF-16-safe que no parte pares subrogados - hardening de la tarea 24, commit dadb3b0). leerMetadatos nunca pide Accept: ...diff - confirmado, el githubRequest siempre fija Accept: application/vnd.github+json y el path apunta a pulls/{n} (metadatos) y pulls/{n}/files (lista de nombres), nunca a la variante de diff.

### Memoria: migracion + repository + WAL (tareas 17-20)

17. `.gitignore` - PASS. `*.db-wal`/`*.db-shm` presentes.

18. `src/adapters/memory/db.ts` - PASS. `db.pragma("journal_mode = WAL")` inmediatamente despues de `foreign_keys = ON` (confirmado por linea).

19. `src/adapters/memory/migrations/0003_proyectos_responsables_actividades.ts` - PASS. Tablas proyectos/responsables/actividades + idx_actividades_proyecto confirmadas por el test de migracion (migrate.test.ts, "creates proyectos, responsables, actividades and idx_actividades_proyecto on a fresh database").

20. `src/adapters/memory/repository.ts` - PASS. createCasoConActividad envuelto en `db.transaction(...)` - atomicidad confirmada leyendo el comentario y el codigo: "a brand-new proyecto row does not survive the rollback". upsertProyecto/upsertResponsable con ON CONFLICT ... DO UPDATE + COALESCE. ActividadNotFoundError/ActividadAlreadyExistsError/ActividadInvalidReferenceError presentes.

### Composition root (tareas 21-23)

21. `src/build-on-activity.ts` - PASS. buildOnActivity/createActivityStore exportados. La promesa del handler nunca rechaza (try/catch total con actividad-turno-fallido). queue.run(evento.proyectoId, ...) envuelve el ciclo completo (findActividadPorReferencia esta DENTRO de runActivityTurn, que corre DENTRO del callback de queue.run). Fix de R1 confirmado: createKnowledge(casoId) se invoca dentro del closure runTurn que run-activity-turn.ts recibe, una vez por turno, con el casoId recien resuelto - no hay ninguna instancia compartida entre turnos. Tests dedicados de aislamiento de citas (build-on-activity.test.ts, linea 411: "aislamiento de citas: dos turnos con casoId distintos... ningun nodo cruza") y de instanciacion unica por turno (linea 307) confirmados presentes y en verde.

22. `src/main.ts` - PASS. Los 3 cambios de diseno confirmados: createKnowledge(caso.id) pasado a buildOnSubmit para la TUI (instancia propia, no compartida); wiring de board/onActivity/webhook fuera del try de startHarness(), con su propio try/catch que loguea webhook-arranque-fallido; finally cierra webhook.close() antes de db.close() (confirmado por orden literal en el archivo). resolveBotLogin se llama una vez, antes de startWebhookServer, con el resultado propagado condicionalmente - exactamente el orden que el hardening de tarea 24 documenta.

23. `src/core/logging/turn-logger.ts` - PASS (TDD exception). Module doc actualizado listando eventos representativos de Hito 3 (webhook-recibido, webhook-firma-invalida, actividad-creada, tablero-actualizado, etc.) y la resolucion de R10 (dos espacios de id). El contrato de logTurnEvent no cambio - confirmado, ningun test existente de turn-logger.test.ts se toco.

## Atencion especial: R10 (dos espacios de id de correlacion)

Confirmado en la practica, no solo en el diseno:

- Eventos de transporte (webhook-recibido, webhook-rechazado-tamano, webhook-firma-invalida, webhook-payload-invalido, webhook-evento-ignorado) se loguean con deliveryId como primer argumento de logEvent dentro de createRequestListener - confirmado leyendo cada llamada en server.ts.
- Eventos de ciclo de vida del proceso (webhook-escuchando, webhook-deshabilitado, webhook-arranque-fallido, webhook-cierre-con-turnos-en-vuelo) usan WEBHOOK_LOG_CORRELATION_ID = "webhook-adapter" - confirmado en index.ts, server.ts y main.ts.
- Eventos del turno (actividad-veredicto, actividad-estado-persistido, tablero-actualizado, etc.) usan casoId - confirmado en run-activity-turn.ts (todas las llamadas a logEvent reciben actividad.casoId como primer argumento).
- Puente: actividad-creada/actividad-reusada se loguean con casoId y llevan deliveryId en fields - confirmado literalmente en run-activity-turn.ts lineas 197-212.

Esto no es una reinterpretacion silenciosa del spec - design.md secciones 9.1 y 11 (R10) documentan honestamente que es una imposibilidad literal (correlacionar por casoId un evento que ocurre antes de que exista un caso, cuando el mismo spec prohibe crear filas ante firma invalida) y proponen el puente como resolucion. El codigo implementa esa resolucion tal cual. Este Reviewer no exige la letra literal del spec sobre este punto - la resolucion de dos espacios + puente es razonable, esta documentada, y es trazable en el log real (confirmado en la evidencia de docs/progreso/v1.2-bot-revision-prs/README.md, donde deliveryId y casoId aparecen correlacionados en la misma linea de actividad-creada).

## Atencion especial: R4 (limitacion de "sin diff")

Confirmado en tres capas independientes:
1. Tipo: PullRequestMetadata no tiene ningun campo de diff (confirmado en activity-contract.ts).
2. Adaptador: leerMetadatos en board/index.ts nunca pide Accept: ...diff, solo usa los endpoints pulls/{n} y pulls/{n}/files con el Accept fijo de githubRequest.
3. Prompt: buildActivityPrompt declara la limitacion explicitamente y de forma verificable por test (activity-prompt.test.ts, regex sobre "no tenes el diff").

Sin hallazgos sobre este punto.

## Tests vs. los 20 escenarios de los 3 specs

Confirmado con Grep dirigido (no de memoria) que los 20 escenarios de activity-webhook-turn (11), activity-board-mirror (6) y el delta knowledge-query (3) tienen contraparte real en el suite:

| Spec | Escenario | Test confirmado |
|---|---|---|
| webhook-turn | Firma invalida no crea filas | server.test.ts (401, onEvent no invocado) |
| webhook-turn | Body excede el tope | server.test.ts (413, req.destroy, sin firma) |
| webhook-turn | Sin secreto configurado | webhooks/index.test.ts (undefined, createServer nunca llamado) |
| webhook-turn | PR abierto dispara turno | github-mapper.test.ts (fixture pull-request.opened.json) |
| webhook-turn | Comentario en issue que no es PR se ignora | github-mapper.test.ts (fixture issue-comment.on-issue.json) |
| webhook-turn | Fallo de persistencia propaga | run-activity-turn.test.ts |
| webhook-turn | Dos eventos casi simultaneos del mismo proyecto | keyed-queue.test.ts + build-on-activity.test.ts |
| webhook-turn | La cola no filtra memoria | keyed-queue.test.ts (size === 0) |
| webhook-turn | Veredicto valido transiciona estado | transicion-estado.test.ts |
| webhook-turn | Veredicto no parseable cae a estado seguro | transicion-estado.test.ts |
| webhook-turn | Traza completa por casoId | run-activity-turn.test.ts + evidencia de log real |
| board-mirror | Falla de red al espejar estado | board/index.test.ts (fetchFn que rechaza) |
| board-mirror | Falla al publicar comentario | board/index.test.ts |
| board-mirror | Estado aprobado refleja label | labels.test.ts |
| board-mirror | Resolucion de observaciones actualiza tablero solo | board/index.test.ts (unitario) - ver WARNING sobre evidencia manual |
| board-mirror | Turno completa sin token de GitHub | board/index.test.ts (no-op) |
| board-mirror | Metadatos disponibles para el prompt | board/index.test.ts + run-activity-turn.test.ts |
| knowledge-query | Dos turnos concurrentes no cruzan citas | build-on-activity.test.ts linea 411 |
| knowledge-query | Turno aislado no ve estado residual | build-on-activity.test.ts |
| knowledge-query | Instancias independientes sin estado compartido | build-on-activity.test.ts linea 307 + Hito 2 knowledge/index.test.ts |

Los 20 escenarios tienen cobertura de test automatizado. Sin hallazgos de cobertura faltante.

## Commits adicionales fuera de la lista original de 24 tareas (hardening de tarea 24)

`git log hito/v1.2-bot-revision-prs` muestra varios commits que NO corresponden 1:1 a una de las 24 tareas originales, todos generados durante la verificacion manual end-to-end (tarea 24) al encontrar comportamiento real distinto del esperado:

- 511cd43/9d54801/a0e05b6 - el fix del bug de auto-loop (resolveBotLogin + filtro), ya evaluado arriba.
- 426f569 - fix de aislamiento de tests (logDeps explicito en 6 tests de build-on-activity.test.ts que corrian con turno real; confirmado con Grep que los 8 call-sites de makeBaseDeps(...) en ese archivo ahora pasan logDeps explicito, sin excepcion).
- 8e0573c - fix(root): valida tipo/estado en toPortActividad antes de cruzar al puerto - agrega ActividadTipoEstadoInvalidoError, confirmado en build-on-activity.ts (funcion toPortActividad).
- dadb3b0 - cobertura extra de tablero-labels-no-leidos + fix de truncado UTF-16-safe (truncateSafely, confirmado en board/index.ts).
- d05d748 - agrega el evento webhook-recibido que faltaba respecto de design.md seccion 9.2 (confirmado presente en server.ts linea 212).
- 0b76320 - fix de TUI (inputLineText insensible a color ANSI forzado por FORCE_COLOR) - fuera de alcance de este hito (no toca src/core/activity/, src/adapters/webhooks/, ni src/adapters/board/), aparentemente un bug lateral encontrado mientras se ejercitaba la TUI en paralelo durante la demo del paso 4. No es materia de este spec pero esta incluido en la rama del hito.

Todos estos commits son consistentes con lo que AGENTS.md/tasks.md permiten para la tarea 24 (verificacion manual end-to-end; aca no fue el spec el que fallo, fue codigo real con bugs reales, corregidos con TDD segun indican los mensajes test/fix). El commit 0b76320 es la unica excepcion cuestionable por alcance (TUI, no bot de PRs) - SUGGESTION, no bloqueante: separarlo en su propio commit ya esta hecho (no esta mezclado con codigo del hito), asi que no contamina la trazabilidad, pero idealmente iria en un hito/branch propio o al menos documentado como "fuera de alcance, encontrado en paralelo".

## Verificacion manual end-to-end (tarea 24) - evaluacion de la evidencia ya recolectada

docs/progreso/v1.2-bot-revision-prs/README.md documenta el guion de 10 pasos de design.md seccion 12.3 con evidencia real (logs de data/harness.log, SELECT de las 3 tablas nuevas, capturas pendientes). Evaluacion honesta de esa evidencia, no solo repeticion de lo que dice el README:

- Pasos 1, 2, 3, 4, 6, 7, 8, 10 - confirmados con evidencia real, incluida la evidencia tecnica de aislamiento por proyectoId (paso 8) con timestamps intercalados reales de dos repos distintos, y el SELECT de las 3 tablas nuevas.
- Paso 5 (label/assignee se actualizan solos al resolverse observaciones) - NO demostrado end-to-end. El propio README lo marca como limitacion conocida, con una explicacion honesta: el entorno de demo usa el mismo PAT personal tanto para abrir PRs/comentar como para el propio bot, asi que comment.authorLogin === botLogin es SIEMPRE true para cualquier comentario humano real en ese entorno - el filtro anti-loop, funcionando exactamente como esta disenado, termina descartando tambien los comentarios humanos legitimos de resolucion. Esto NO es un bug de codigo: el filtro hace lo que el diseno pide (comparar autor contra login del bot). Es una limitacion real del entorno de demo (credencial compartida) que ademas revela un riesgo de produccion no anticipado en design.md R1-R15: cualquier despliegue real que use un PAT personal compartido en vez de una cuenta de servicio/GitHub App dedicada sufre el mismo problema - el bot no podria distinguir jamas una resolucion humana genuina de su propio eco.
- Paso 9 (cierre ordenado con Ctrl+C durante un turno en vuelo) - no verificado manualmente, documentado honestamente en el README como omitido por timing. Cobertura existente: solo unitaria (server.test.ts, close() con Promise.race y timeout), no un proceso real con SIGINT a mitad de turno.

## Issues encontrados

CRITICAL: Ninguno. El codigo implementado cumple los 3 specs, el diseno, y las 23 tareas de tasks.md contra sus criterios literales; la frontera hexagonal se sostiene sin excepciones no documentadas; 477/477 tests en verde; typecheck limpio.

WARNING:

1. Paso 5 del guion de demo no demostrado end-to-end (label + assignee actualizandose solos al resolver observaciones) - es parte literal del "entregable funcional a demostrar" que tasks.md fija para este hito ("al resolverse las observaciones el label y el assignee se actualizan solos - sin intervencion manual"). La logica esta correctamente implementada y cubierta por tests unitarios (board/index.test.ts, run-activity-turn.test.ts), pero el checklist de AGENTS.md pide que el entregable se demuestre "de punta a punta - no alcanza con que compile o pasen los tests unitarios". Recomendacion no bloqueante para el codigo, si para el checklist de cierre: repetir el paso 5 con una cuenta de bot dedicada (GitHub App o segundo usuario) distinta de la cuenta humana que abre los PRs, antes de dar el checklist de cierre por completo. Alternativamente, documentar explicitamente en README.md/.env.example que GITHUB_TOKEN debe pertenecer a una identidad distinta de quien comenta manualmente los PRs - esto tambien cierra el riesgo de produccion real que la limitacion revela (no solo un problema de demo).
2. Paso 9 (cierre ordenado con Ctrl+C) no verificado manualmente, solo por unit test. Riesgo bajo - ADR 10 esta bien testeado a nivel de close(), pero la interaccion real con SIGINT/Ink no se ejercito en vivo. No bloqueante: es una verificacion de robustez de proceso, no del entregable funcional principal (label/comentario/estado).
3. Commit 0b76320 (fix de TUI, inputLineText vs FORCE_COLOR) esta mezclado en la rama del hito sin pertenecer a ninguna de las 24 tareas de este spec. No contamina el codigo de este hito (es un archivo distinto, src/adapters/tui/), pero rompe la trazabilidad 1:1 commit-tarea que el resto de la rama mantiene. No bloqueante.

SUGGESTION:

- Ninguna adicional que amerite mencion aparte de lo ya cubierto arriba.

Riesgos residuales ya documentados en design.md seccion 11 (contexto, no hallazgos nuevos de esta verificacion): R11 (sin token, sin lista de archivos - aceptado, la demo real uso token), R12 (202 antes de procesar, turno puede fallar despues - sin incidentes visibles en la evidencia real), R13 (reentrada por reintento de GitHub, no deduplicada - no observada en la evidencia, pero el riesgo sigue latente tal como el diseno lo anticipa).

Riesgo nuevo, no anticipado en design.md R1-R15 (surgido de la evidencia real de la tarea 24, ya parcialmente documentado por el propio README de progreso): compartir GITHUB_TOKEN entre la identidad del bot y una identidad humana que tambien comenta manualmente hace que el filtro anti-loop (correcto en su diseno) tambien descarte comentarios humanos legitimos. Ver WARNING 1.

## Estado del checklist de cierre de hito segun AGENTS.md

- [x] El Reviewer aprueba explicitamente en este reporte sdd-verify, con 3 WARNINGs no bloqueantes (ninguno de codigo; dos de evidencia de demo incompleta, uno de higiene de commit fuera de alcance).
- [ ] El entregable funcional del hito - demostrado de punta a punta - esta PARCIALMENTE confirmado: pasos 1-4, 6-8, 10 si; paso 5 (la "mitad 2" explicita del entregable funcional en tasks.md) no, por la limitacion de entorno documentada arriba. Recomendacion: repetir el paso 5 con una identidad de bot dedicada antes de marcar esta casilla como completa, o aceptar explicitamente el riesgo documentado (decision del humano, no de este Reviewer).
- [x] docs/progreso/v1.2-bot-revision-prs/ existe, con evidencia real y honesta (incluye explicitamente lo que NO se pudo demostrar, en vez de omitirlo).
- [ ] Tag semantico v1.2.0 no existe todavia (pendiente del humano).

## Veredicto final

PASS con WARNINGs - no bloqueantes para el codigo, si para el checklist de cierre de hito hasta que el humano decida como resolver el WARNING 1.

El codigo del hito, tal como esta en hito/v1.2-bot-revision-prs, cumple las 23 tareas de codigo de tasks.md contra sus criterios de aceptacion literales y contra los 3 specs (20/20 escenarios con test automatizado confirmado); la regla no negociable de arquitectura hexagonal se sostiene en todo el arbol src/, incluida la correccion del bug de auto-loop (arquitectonicamente correcta: el filtro vive en el adaptador de webhooks, recibe el login del bot como dato plano desde el composition root, sin que ningun adaptador importe a otro); R10 y R4 estan resueltos tal como design.md los documenta, sin reinterpretacion silenciosa; el ciclo typecheck + test corre limpio - 0 errores, 477 de 477 tests, con dist/ limpiado antes de correr.

El unico hallazgo que un humano deberia mirar antes de cerrar el hito por completo es el WARNING 1: la "mitad 2" del entregable funcional (resolucion automatica de label/assignee) no se pudo demostrar end-to-end en el entorno de demo real por una limitacion de credencial compartida - no un defecto de codigo. No devuelvo este hito al Implementer: no hay nada que corregir en el codigo. La decision pendiente es del humano (checkpoint de cierre): repetir la demo con una identidad de bot separada, o aceptar el riesgo documentado y cerrar igual.

Lo que le falta al humano para cerrar el hito:

1. Decidir sobre el WARNING 1 (repetir demo con bot dedicado, o aceptar el riesgo documentado explicitamente).
2. Opcional: separar o documentar el commit 0b76320 (fuera de alcance de este hito).
3. Mergear hito/v1.2-bot-revision-prs a main.
4. Crear el tag v1.2.0 sobre main.
5. Commit final de cierre: "docs: cierra Hito 1.2 - bot de revision de PRs", recien con las 4 casillas del checklist marcadas.
