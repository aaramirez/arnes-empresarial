# Hito 7 (v3.0.0) — Servidor A2A entrante: evidencia de verificación manual del entregable (tarea 21)

**Fecha**: 2026-09-09/10 (sesión continua, cruza medianoche UTC).
**Referencia**: [`openspec/changes/hito-3.0-a2a-servidor/design.md`](../../../openspec/changes/hito-3.0-a2a-servidor/design.md) §11 (los 17 pasos), [`tasks.md`](../../../openspec/changes/hito-3.0-a2a-servidor/tasks.md) tarea 21. Complementa, sin pisar, [`README.md`](README.md) (tarea 20 — corrección al Plan).

**Entorno**: Windows 11, Git Bash (MSYS). El arnés se levantó tres veces (`npm run dev`, proceso real, no dobles de test) en distintas rondas de configuración, cada una en background con las env vars inline necesarias — nunca en `.env` real, así que ningún token real quedó expuesto en el repo. `data/harness.db` y `data/harness.log` son los archivos reales y acumulativos del proyecto (no `:memory:`, no fixtures).

**Tokens de prueba usados** (no son secretos reales, sólo strings de esta sesión, elegidos para poder buscarlos con certeza en el log):
- `HARNESS_A2A_ENTRANTE_TOKEN`: `a2a-verif-9f3d2c-hito7t21`
- `GITHUB_WEBHOOK_SECRET` (sobrescrito sólo para esta sesión — el real de `.env` nunca se leyó ni se usó): `webhook-verif-hito7t21-secret`
- `GITHUB_TOKEN` forzado a `""` en las tres rondas — deshabilita el Adaptador de Tablero a propósito, para que el webhook real del punto 12 no dispare llamadas reales a la API de GitHub.

## Resultado de los 17 pasos

| # | Paso | Resultado | Evidencia |
|---|---|---|---|
| 1 | Arranque con token ⇒ log `a2a-servidor-escuchando {port:8888}` | **PASÓ** | `{"port":8888,"publicUrl":"http://localhost:8888","casoId":"a2a-servidor","event":"a2a-servidor-escuchando",...}` en `data/harness.log` |
| 2 | Card sin auth ⇒ `200` completo | **PASÓ** | `curl` sin `Authorization` ⇒ `HTTP_STATUS:200`, card completo (ver abajo) |
| 3 | `POST /a2a` sin token ⇒ `401`, `SELECT count(*)` no cambia | **PASÓ** | `401`, count `0` antes y después |
| 4 | `SendMessage` con token ⇒ `SUBMITTED` inmediato (cronometrado), fila en base con `agente_externo_url NULL` | **PASÓ** | 104 ms, fila insertada con `agente_externo_url` vacío, `origen_transporte` poblado (`::1`) |
| 5 | `GetTask` inmediato ⇒ encontrado; a los pocos segundos ⇒ `COMPLETED` con texto | **PASÓ** | `WORKING` a los 0s y 8s, `COMPLETED` con `artifacts[0].parts[0].text` (1534 chars) a los ~29s |
| 6 | `handleTurn` real invocado por el ciclo A2A entrante (turno real de modelo, no doble) | **PASÓ** (ver Hallazgo 1) | Respuesta real de Claude vía el adaptador de conocimiento |
| 7 | Ciclo completo contra el test de la tarea 17, con el arnés real levantado en simultáneo | **PASÓ** | `npm test -- a2a-server.integration` → 5/5 tests, mientras la Ronda A seguía escuchando en 8888 (el test usa su propio puerto efímero, sin conflicto) |
| 8 | `method` inexistente ⇒ `-32601`, no `500` | **PASÓ** | `{"error":{"code":-32601,"message":"method no soportado: ListTasks"}}`, `HTTP_STATUS:200` |
| 9 | Tope `MAX_EN_VUELO=1` ⇒ el segundo `SendMessage` `REJECTED` sin `caso_id` | **PASÓ** | Ronda B, ver abajo |
| 10 | `CancelTask` en vuelo ⇒ `CANCELED`, resultado descartado al terminar el turno | **PASÓ** | `CANCELED` inmediato; 20s después, `resultado` sigue `NULL`, log `a2a-turno-entrante-descartado` |
| 11 | `CancelTask` sobre `COMPLETED` ⇒ error no cancelable, `resultado` intacto | **PASÓ** | `{"error":{"code":-32002,"message":"tarea no cancelable"}}`, `resultado` sigue en 1534 chars |
| 12 | Riesgo 2: 6 `SendMessage` concurrentes + un webhook real sobre un proyecto ⇒ sin filas inconsistentes | **PASÓ** | Ver sección dedicada abajo |
| 13 | `git diff --stat main -- src/core/` con el código final | **PASÓ** | 3 archivos: `a2a-contract.ts` (6 líneas, doc-comment), `a2a-entrante-prompt.ts` + su test (nuevos) — ningún archivo existente de `src/core/` modificado en comportamiento |
| 14 | Rollback quitando el token ⇒ idéntico a `v2.2.0` | **PASÓ** | `a2a-servidor-deshabilitado`, sin listener en 8888, webhooks/web arrancan igual |
| 15 | Cierre con turno en vuelo (Ctrl+C durante un `SendMessage`) ⇒ drena sin `unhandledRejection` | **NO SE PUDO VERIFICAR TAL CUAL DISEÑADO** — ver Hallazgo 2 | `taskkill` sin `/F` rechazado por Windows ("sólo se puede terminar de forma forzada"); `kill -SIGINT` de Git Bash no alcanza un `node.exe` nativo lanzado así. Con `taskkill /F` (el único cierre posible en este entorno) no hay `unhandledRejection` en ningún log, pero tampoco corre el `finally` de `main.ts`: la fila en vuelo queda `TASK_STATE_WORKING` para siempre |
| 16 | `rg` sobre `data/harness.log` por el token ⇒ cero resultados | **PASÓ** | 0 ocurrencias de `a2a-verif-9f3d2c-hito7t21` ni de `webhook-verif-hito7t21-secret` en `data/harness.log` |
| 17 | `npm test`/`npm run typecheck` en verde, con el test de integración corriendo | **PASÓ** | `1825 passed | 3 skipped` (los 3 skips son del `a2a-client.integration.test.ts` del Hito 6, que requiere un sample Python externo — sin relación con este hito); los 5 tests de `a2a-server.integration.test.ts` corrieron y pasaron, no `skipped`. `tsc --noEmit` sin salida (0 errores) |

**16/17 pasos pasaron tal cual.** El paso 15 no pudo reproducirse exactamente como lo describe `design.md` §11 punto 14 (`Ctrl+C`) por una limitación real del entorno Windows — documentada en detalle como Hallazgo 2, con el resultado que sí se pudo observar.

## Paso 2 — Agent Card completo (sin auth)

```json
{"name":"Arnés Empresarial","description":"Arnés de agentes de IA de una empresa. Responde consultas sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas.","version":"3.0.0","capabilities":{"streaming":false,"pushNotifications":false,"extendedAgentCard":false},"defaultInputModes":["text/plain"],"defaultOutputModes":["text/plain"],"skills":[{"id":"consulta-arnes","name":"Consulta al arnés empresarial","description":"Respondé una consulta en lenguaje natural sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas en el arnés. Es una consulta de sólo lectura: el arnés no modifica nada a pedido de un agente externo.","tags":["consulta","estado","proyectos","incidentes","solo-lectura"],"examples":["¿En qué estado está la revisión del PR 42 del proyecto X?","¿Qué incidentes abiertos hay hoy?","¿Cuántas ventas quedaron pendientes de confirmación esta semana?"]}],"supportedInterfaces":[{"protocolBinding":"JSONRPC","url":"http://localhost:8888/a2a"}],"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}}
```

`HTTP_STATUS:200`, sin header `Authorization`.

## Tráfico JSON-RPC de los tres métodos

**`SendMessage`** (paso 4, con token):

```json
{"jsonrpc":"2.0","id":1,"result":{"task":{"id":"b6d30dee-1ece-4bb7-8862-241e2f966ecd","contextId":"3913e45a-1547-4188-a7f0-03fb78c04a25","status":{"state":"TASK_STATE_SUBMITTED","timestamp":"2026-09-10T02:58:40.664Z"}}}}
```

**`GetTask`** inmediato (paso 5, `WORKING`, no "no encontrada"):

```json
{"jsonrpc":"2.0","id":2,"result":{"id":"b6d30dee-1ece-4bb7-8862-241e2f966ecd","contextId":"3913e45a-1547-4188-a7f0-03fb78c04a25","status":{"state":"TASK_STATE_WORKING","timestamp":"2026-09-10T02:58:40.666Z"}}}
```

**`GetTask`** ~29s después (paso 5, `COMPLETED` con texto real del modelo, truncado acá por espacio — el texto completo está en `data/harness.db`, columna `resultado` de la fila `b6d30dee-...`):

```json
{"jsonrpc":"2.0","id":4,"result":{"id":"b6d30dee-1ece-4bb7-8862-241e2f966ecd","contextId":"3913e45a-1547-4188-a7f0-03fb78c04a25","status":{"state":"TASK_STATE_COMPLETED","timestamp":"2026-09-10T02:59:09.973Z"},"artifacts":[{"artifactId":"b6d30dee-1ece-4bb7-8862-241e2f966ecd-0","name":"respuesta","parts":[{"text":"No logré obtener del vault el texto exacto... (1534 caracteres totales, ver Hallazgo 1)"}]}]}}
```

**`CancelTask`** sobre tarea en vuelo (paso 10, `CANCELED` inmediato):

```json
{"jsonrpc":"2.0","id":11,"result":{"id":"1de722d2-b403-41b1-a1bd-4aec762af8cb","contextId":"c8abfeea-d700-4f5a-8105-768aa5d7d2c8","status":{"state":"TASK_STATE_CANCELED","timestamp":"2026-09-10T03:00:07.337Z","message":{"messageId":"1de722d2-b403-41b1-a1bd-4aec762af8cb-msg","parts":[{"text":"La tarea fue cancelada por el llamador."}]}}}}
```

**`CancelTask`** sobre tarea `COMPLETED` (paso 11, error no cancelable):

```json
{"jsonrpc":"2.0","id":6,"error":{"code":-32002,"message":"tarea no cancelable"}}
```

**`SendMessage`** con `method` inexistente (paso 8):

```json
{"jsonrpc":"2.0","id":5,"error":{"code":-32601,"message":"method no soportado: ListTasks"}}
```

**`SendMessage`** con `MAX_EN_VUELO=1`, segundo pedido (paso 9, Ronda B):

```json
{"jsonrpc":"2.0","id":2,"result":{"task":{"id":"dcfd2a17-2b7b-494e-ac0f-bc8b291cc1ff","contextId":"dcfd2a17-2b7b-494e-ac0f-bc8b291cc1ff","status":{"state":"TASK_STATE_REJECTED","timestamp":"2026-09-10T03:05:18.294Z","message":{"messageId":"dcfd2a17-2b7b-494e-ac0f-bc8b291cc1ff-msg","parts":[{"text":"El arnés está al máximo de solicitudes en curso. Reintentá más tarde."}]}}}}}
```

Confirmado en base: `caso_id` de esa fila es `NULL`.

## Volcado de `solicitudes_a2a_entrantes` en sus cinco estados

Los cinco estados que este hito ejercita en el ciclo de vida de la tabla (`SUBMITTED`/`WORKING` capturados en las respuestas JSON-RPC de arriba, los otros tres persistidos):

| `a2a_task_id` | `estado` | `agente_externo_url` | `origen_transporte` | `caso_id` | `resultado` (chars) |
|---|---|---|---|---|---|
| `b6d30dee-...` | `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` → **`TASK_STATE_COMPLETED`** | `NULL` | `::1` | `3913e45a-...` | 1534 |
| `1de722d2-...` | `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` → **`TASK_STATE_CANCELED`** | `NULL` | `::1` | `c8abfeea-...` | 0 (`NULL`) |
| `866ed8cd-...` | `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` → **`TASK_STATE_COMPLETED`** | `NULL` | `::1` | `89057a61-...` | 1127 |
| `dcfd2a17-...` | **`TASK_STATE_REJECTED`** (directo, sin pasar por `SUBMITTED`/`WORKING`) | `NULL` | `::1` | `NULL` | 0 (`NULL`) |

`TASK_STATE_SUBMITTED` y `TASK_STATE_WORKING` no tienen fila propia persistida al momento del volcado porque son estados de tránsito — se capturan en las respuestas JSON-RPC de arriba (paso 4, la respuesta inmediata siempre es `SUBMITTED`; el primer `GetTask` del paso 5 capturó `WORKING`).

`agente_externo_url` es `NULL` en las cuatro filas — confirma la Corrección 1 de la tarea 20 (README.md de esta misma carpeta): el protocolo A2A v1.0.0 no transporta identidad del emisor, así que la columna nunca se puebla en este hito.

## Paso 12 — Riesgo 2: 6 `SendMessage` concurrentes + un webhook real

Config: Ronda A, `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO=10` (para que los 6 turnos entren todos con cupo y el experimento mida concurrencia real, no el tope). Webhook real: `POST http://localhost:8787/webhooks/github`, evento `pull_request.opened` sintético, con firma HMAC-SHA256 calculada con el mismo algoritmo que `src/adapters/webhooks/signature.ts` (`computeSignature`) sobre un secreto elegido para esta sesión — nunca el secreto real de `.env`. `GITHUB_TOKEN=""` (Adaptador de Tablero deshabilitado a propósito): el webhook ejercita transporte + firma + `mapGithubEvent` + `build-on-activity.ts` + `handleTurn` real de punta a punta, sin disparar llamadas de escritura reales contra GitHub.

Las 7 peticiones (6 `SendMessage` + 1 webhook) se lanzaron en paralelo (`curl ... &` × 7 seguido de `wait`):

- **Tiempo total de las 7 llamadas HTTP**: 172 ms — todas concurrentes, ninguna esperó a la anterior.
- **Las 6 respuestas de `SendMessage`**: las seis `TASK_STATE_SUBMITTED`, con seis `id`/`contextId` distintos.
- **La respuesta del webhook**: `HTTP 202`.
- **Tras esperar a que los 6 turnos terminaran** (polling sobre la base, ~25s): las 6 filas de `solicitudes_a2a_entrantes` de esta corrida llegaron a `TASK_STATE_COMPLETED`, cada una con su propio `caso_id` distinto — ninguna cruzada, ninguna perdida.
- **La actividad del webhook**: exactamente **una** fila en `actividades` con `proyecto_id = 'acme/repo-verificacion-hito7'`.
- **Conteos globales antes/después**: `solicitudes_a2a_entrantes` pasó de 2 a 8 filas (+6, exactas); `casos` pasó de 35 a 42 (+7 = 6 A2A + 1 actividad, exacto). Ninguna fila inconsistente, ninguna fuente bloqueó a la otra.
- Log (`data/harness.log`): `webhook-recibido` (`bytes:462`, `casoId` = el `deliveryId` sintético) seguido de `actividad-creada` en el mismo milisegundo que las respuestas `SendMessage` — evidencia directa de que ambas fuentes de turnos corrieron entrelazadas, no en serie.

## Discrepancia encontrada en `tasks.md` (no corregida por esta tarea)

Al leer `openspec/changes/hito-3.0-a2a-servidor/tasks.md` antes de arrancar, la tarea 19 (`git diff --stat main -- src/core/` — verificación mecánica del Escenario 6) aparece con el checkbox **sin marcar** (`- [ ]`), a pesar de que el resto del contexto de la sesión indicaba que las tareas 1-20 ya estaban completas y commiteadas. Esta tarea 21 vuelve a correr ese mismo comando (punto 13 de la tabla de arriba) como parte de su propio checklist y confirma que pasa — pero el checkbox de la tarea 19 en sí no se tocó acá, siguiendo la instrucción explícita de sólo marcar la tarea 21. Se deja anotado para que el Reviewer/checkpoint humano decida si corresponde marcarlo también.

## Hallazgo 1 — el prompt sintético de A2A entrante depende de resultados de `graphify` que a veces vienen truncados sin contenido real

Al ejercitar el paso 6 con una consulta real ("que es un arnes empresarial"), la respuesta del modelo (fila `b6d30dee-...`, 1534 caracteres) es honesta pero incompleta: el modelo reporta explícitamente que las herramientas de conocimiento disponibles (`graphify query`) le devolvieron "resultados... truncados a nombres de nodos del grafo, sin el contenido descriptivo real de las secciones", y arma una respuesta best-effort citando fuentes en vez de la definición completa. Esto **no es un bug de este hito** (`a2a-entrante-prompt.ts` es puro y no toca el problema) — es evidencia real, obtenida por primera vez con un turno A2A entrante real de punta a punta (a diferencia de todos los tests de este hito, que sustituyen `handleTurn` por un doble), de que el Adaptador de Conocimiento puede degradar la calidad de una respuesta cuando el presupuesto de tokens de una consulta a `graphify` corta el contenido antes de la sección relevante. Queda anotado para quien dé seguimiento al Adaptador de Conocimiento (fuera del alcance de este hito, que sólo agrega el transporte A2A entrante).

## Hallazgo 2 — el cierre elegante por Ctrl+C no tiene ningún camino equivalente para `SIGINT`/`SIGTERM` externos (Windows, y potencialmente cualquier entorno no interactivo)

**Lo que dice el diseño**: `main.ts` (bloque final, comentario de la tarea 16) confía en que "Ink lo maneja solo, `exitOnCtrlC` por defecto" para disparar el `finally` que drena A2A/webhooks/web antes de `db.close()`.

**Lo que se verificó al intentar reproducir el paso 15 con el arnés real**:

1. Con `stdout`/`stderr` redirigidos a un archivo (exactamente como corre este proceso en background, y como correría bajo cualquier supervisor de procesos — `systemd`, Docker, `pm2`), Ink emite en su primer render: `ERROR Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.` — confirmado en los tres arranques de esta sesión (`round-a.log`, `round-b.log`, `round-c.log`). El proceso NO crashea por este error (se loguea y sigue), pero significa que la detección de Ctrl+C de Ink (`node_modules/ink/build/hooks/use-input.js`, que escucha el byte `\x03` en modo raw de `stdin`) **nunca puede dispararse** en este modo de ejecución.
2. Se buscó en todo `src/` (`rg SIGINT|SIGTERM|SIGBREAK`) — no existe ningún `process.on('SIGINT'|'SIGTERM')` en `main.ts` ni en ningún otro módulo de la aplicación (los únicos matches son de `test-runner-cli.ts`/`git-cli.ts`/`graphify-cli.ts`, que matan *subprocesos* que ellos mismos lanzan — sin relación con el ciclo de vida del proceso principal).
3. Intento de reproducir un `SIGINT` real desde fuera del proceso, en Windows:
   - `kill -SIGINT <pid>` (builtin de Git Bash/MSYS) ⇒ `no such process` — MSYS `kill` sólo puede señalar procesos de su propio árbol MSYS; un `node.exe` nativo lanzado por `npm run dev &` en background no califica, ni usando el PID de Windows (`netstat`) ni el PID interno de `ps -W`.
   - `taskkill //PID <pid>` (sin `/F`, el cierre "amable" de Windows) ⇒ **rechazado por el propio Windows**: `"Este proceso se puede terminar solo de forma forzada (con la opción /F)"`. Es decir: ni siquiera el sistema operativo tiene un mecanismo de cierre no forzado disponible para este proceso concreto tal como está lanzado.
   - Único camino que funcionó: `taskkill //PID <pid> //F` (equivalente a `SIGKILL`, terminación incondicional).
4. **Resultado observado con la única terminación disponible** (`taskkill /F`, con un `SendMessage` en vuelo, tarea `9f27f1fb-...`): cero apariciones de `unhandledRejection`/`UnhandledPromiseRejection`/`uncaughtException` en ningún log (`data/harness.log` ni el log de consola) — pero **no porque el drenaje haya corrido**, sino porque el proceso terminó de forma incondicional antes de que el runtime de Node tuviera oportunidad de ejecutar ninguna línea de JavaScript adicional (ni el `finally` de `main.ts`, ni el `catch` de `startServer`). La fila de esa tarea quedó **permanentemente en `TASK_STATE_WORKING`**, sin `resultado`, sin transición a `CANCELED` ni a ningún estado terminal — un cliente que hiciera `GetTask` después de un reinicio del arnés jamás vería otra cosa (el proceso que sostenía esa promesa ya no existe).

**Conclusión honesta sobre el paso 15**: no se pudo verificar tal como lo pide `design.md` §11 punto 14 en este entorno — no por una falla del código de este hito, sino porque el mecanismo de cierre elegante de TODO el arnés (A2A, webhooks y web por igual, no sólo este hito) depende **exclusivamente** de una señal de teclado interpretada en modo raw por Ink, sin ningún `process.on('SIGINT'|'SIGTERM')` de respaldo. Esto es un hallazgo transversal, no específico de A2A: el mismo problema aplicaría al cierre de `webhooks/index.ts` y `web/index.ts` bajo cualquier supervisor de procesos que envíe `SIGTERM` en vez de simular una tecla. Se recomienda al Reviewer/checkpoint humano evaluar si corresponde abrir un hallazgo de seguimiento (fuera del alcance de este hito, que no toca `main.ts` más allá del wiring aditivo ya hecho) para agregar un handler de `process.on('SIGINT'/'SIGTERM')` que invoque el mismo camino de cierre que hoy sólo dispara `waitUntilExit()` rechazando.

## Comandos y verificaciones independientes

```
$ git diff --stat main -- src/core/
 src/core/agents/a2a-contract.ts             |   6 +-
 src/core/agents/a2a-entrante-prompt.test.ts | 102 ++++++++++++++++++++++++++++
 src/core/agents/a2a-entrante-prompt.ts      |  71 +++++++++++++++++++
 3 files changed, 177 insertions(+), 2 deletions(-)

$ rg "a2a-verif-9f3d2c-hito7t21|webhook-verif-hito7t21-secret" data/harness.log
(sin resultados)

$ npm test
 Test Files  110 passed | 1 skipped (111)
      Tests  1825 passed | 3 skipped (1828)
 (el único archivo skipped es src/test/integration/a2a-client.integration.test.ts, Hito 6,
  requiere un sample Python externo — sin relación con este hito. Los 5 tests de
  a2a-server.integration.test.ts corrieron y pasaron, no fueron skipped.)

$ npm run typecheck
(sin salida — 0 errores)
```

## Cierre de procesos y puertos

Las tres rondas (`token=...`/`MAX_EN_VUELO=10`; `token=...`/`MAX_EN_VUELO=1`; sin token) se cerraron con `taskkill /F` (único mecanismo disponible en este entorno, ver Hallazgo 2). Verificado al final de la sesión:

```
$ netstat -ano | grep -E ":8888 |:8787 |:8090 "
(sin listeners activos)

$ tasklist //FI "IMAGENAME eq node.exe" //V | grep -i "tsx\|main.ts"
(sin procesos node.exe corriendo src/main.ts)
```

Ningún proceso huérfano ni puerto abierto quedó al finalizar esta verificación.
