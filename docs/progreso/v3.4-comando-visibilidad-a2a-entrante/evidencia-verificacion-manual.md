# v3.4.0 — `/ver-solicitudes-a2a [a2aTaskId]` (comando-visibilidad-a2a-entrante): evidencia de verificación manual (tarea 11)

**Referencia**: [`openspec/changes/comando-visibilidad-a2a-entrante/tasks.md`](../../../openspec/changes/comando-visibilidad-a2a-entrante/tasks.md) tarea 11, [`design.md`](../../../openspec/changes/comando-visibilidad-a2a-entrante/design.md) ADR 140 pto 4 (orden `updated_at ASC`, el argumento del Hallazgo 2). Precedentes seguidos: [`docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md`](../v3.0-a2a-servidor/evidencia-verificacion-manual.md) (arnés real + `curl` JSON-RPC + `taskkill /F`) y [`docs/progreso/v3.3-comando-cancelar-solicitud/README.md`](../v3.3-comando-cancelar-solicitud/README.md) (driver throwaway de Ink sobre `ink-testing-library`).

**Entorno**: Windows 11, Git Bash (MINGW64). Node (vía `tsx`, sin build). `data/harness.db` real del repo **no se tocó en ningún momento** — toda la corrida usó una SQLite aislada bajo `scratch-demo/data/harness.db` (carpeta throwaway en la raíz del repo, **borrada al terminar**, junto con el driver de Ink y los logs). Confirmado con `git status --porcelain data/` antes y después: vacío en los dos casos.

**Nota de acceso a credenciales (limitación real de este entorno, documentada con la misma honestidad que el Hallazgo 2 de `v3.0`)**: esta sesión no tiene acceso de lectura a `.env` (bloqueado por una regla de sandbox del entorno de ejecución, con el mensaje explícito `blocked by a deny rule`) ni a `ANTHROPIC_API_KEY` en el proceso que lanza los comandos (`printenv | grep ANTHROPIC_API_KEY` ⇒ 0 coincidencias). Pese a eso, el arnés real invocado en este entorno **sí** completó turnos reales contra el modelo (ver las respuestas de texto real más abajo, con contenido no determinista específico de cada consulta) — evidencia de que `@anthropic-ai/claude-agent-sdk` se autentica acá por un mecanismo ambiental de esta sesión, no por `process.env.ANTHROPIC_API_KEY` leído por `getAnthropicApiKey()` (`src/core/config/env.ts`), que además resultó no tener ningún call site en `src/core/turn-selector/invoke-model.ts` (`grep` sobre `src/` completo: los únicos usos de `getAnthropicApiKey` están en `env.test.ts`). No fue necesario ningún rodeo sobre `.env` para completar esta tarea — se deja anotado como hallazgo de entorno, no como bloqueo.

## Resultado de los puntos de `tasks.md` (tarea 11)

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| 1 | El caso del Hallazgo 2: huérfano `TASK_STATE_WORKING` real (proceso terminado con `taskkill /F`) aparece primero en el listado sin argumento | **PASÓ** | Ver sección dedicada — orden `updated_at ASC` confirmado en vivo con DOS tareas reales en curso simultáneamente, una huérfana (más vieja) y una legítima (más nueva) |
| 2 | `/ver-solicitudes-a2a` sobre una fila `COMPLETED` real ⇒ nunca "agente", siempre "origen de transporte" (R1) | **PASÓ** | Ver "Detalle — fila `COMPLETED` real" |
| 3 | `/ver-solicitudes-a2a no-existe` ⇒ mensaje explicativo, sin throw, fila `no_aplicable` en auditoría | **PASÓ** | Ver "Detalle — id inexistente" y "Auditoría" |
| 4 | `git diff --stat main -- src/core/agents/a2a-contract.ts src/build-on-a2a-entrante.ts src/adapters/a2a/server.ts` vacío; tests de esos módulos verdes sin tocarse | **PASÓ** | Ver "Verificaciones estáticas" |
| 5 | Rollback del commit de la tarea 8 (inspección con `git show <commit>^:<ruta>`) | **PASÓ, con una precisión** | Ver "Rollback de la tarea 8" — el padre de la tarea 8 confirma ausencia de `case`/`manejarVerSolicitudesA2A`, pero la frase de `tasks.md` sobre "vuelve a caer en `ayudaDesconocido`" no aplica a un rollback de **sólo** la tarea 8 (ver nota) |
| 6 | `npm test`/`npm run typecheck` completos en verde | **PASÓ, con 1 fallo preexistente sin relación** | Ver "Suite completa" |

## El caso del Hallazgo 2 — reproducción en vivo, con dos tareas reales interleaved

**Arranque del arnés real** (aislado, `cwd=scratch-demo/`, para no tocar `data/harness.db` real — `src/main.ts:161` abre `openDatabase("data/harness.db")` relativa a `process.cwd()`, sin override por env var, confirmado por lectura directa del archivo):

```
$ cd scratch-demo && HARNESS_A2A_ENTRANTE_TOKEN="verif-t34-8f21ac" npx tsx ../src/main.ts > run.log 2>&1 &
```

Log real (`scratch-demo/data/harness.log`):

```json
{"port":8888,"publicUrl":"http://localhost:8888","casoId":"a2a-servidor","event":"a2a-servidor-escuchando","timestamp":"2026-09-11T23:50:47.098Z"}
```

Igual que en `v3.0`: con `stdout` redirigido a archivo, Ink emite `ERROR Raw mode is not supported on the current process.stdin...` (no crashea, sigue corriendo) — mismo comportamiento ya documentado, sin relación con este change.

### Ronda 1 — descubrir la ventana de tiempo (`SendMessage` real, sin matar el proceso)

```
$ curl -s -X POST http://localhost:8888/a2a \
  -H "Authorization: Bearer verif-t34-8f21ac" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"msg-t34-huerfano","role":"user","parts":[{"text":"tarea de verificacion v3.4 - reproduccion del huerfano"}]}}}'

{"jsonrpc":"2.0","id":1,"result":{"task":{"id":"5a58fab6-03ae-4a66-83fe-fcbff5efae4e","contextId":"37baf5e3-d67e-418c-89d4-c7aefdc5006a","status":{"state":"TASK_STATE_SUBMITTED","timestamp":"2026-09-11T23:51:14.402Z"}}}}
```

Log real:

```json
{"chars":54,"origenTransporte":"::1","casoId":"5a58fab6-03ae-4a66-83fe-fcbff5efae4e","event":"a2a-solicitud-recibida","timestamp":"2026-09-11T23:51:14.402Z"}
{"a2aTaskId":"5a58fab6-03ae-4a66-83fe-fcbff5efae4e","casoId":"37baf5e3-d67e-418c-89d4-c7aefdc5006a","event":"a2a-turno-entrante-iniciado","timestamp":"2026-09-11T23:51:14.403Z"}
```

Esta tarea llegó sola a `TASK_STATE_COMPLETED` a los `2026-09-11T23:51:31.305Z` (~17s después del `SendMessage`) — se dejó completar a propósito, sin matarla, para usarla después como la fila `COMPLETED` real del punto 2 del checklist. Confirma, además, que `actualizarSolicitudA2AEnCurso(WORKING)` (`build-on-a2a-entrante.ts:152-156`) corre **sincrónicamente antes** de `await handleTurn(...)`: hay una ventana real de varios segundos entre `SUBMITTED`→`WORKING` y `WORKING`→`COMPLETED`, suficiente para intervenir con `taskkill` en la Ronda 2.

### Ronda 2 — el huérfano real

Segundo arranque del arnés (mismo `scratch-demo/data/harness.db`, acumulativo — PID nuevo, puerto libre confirmado con `netstat` antes de arrancar):

```
$ netstat -ano | grep ":8888"        # (sin salida — puerto libre)
$ HARNESS_A2A_ENTRANTE_TOKEN="verif-t34-8f21ac" npx tsx ../src/main.ts > run2.log 2>&1 &
$ netstat -ano | grep ":8888"
  TCP    0.0.0.0:8888    0.0.0.0:0    LISTENING    6700
```

`SendMessage` real + `taskkill /F` **un segundo después** (dentro de la ventana de varios segundos confirmada en la Ronda 1):

```
$ curl -s -X POST http://localhost:8888/a2a \
  -H "Authorization: Bearer verif-t34-8f21ac" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"msg-t34-huerfano-2","role":"user","parts":[{"text":"tarea de verificacion v3.4 - segundo intento huerfano"}]}}}' \
  && sleep 1 && taskkill //PID 6700 //F

{"jsonrpc":"2.0","id":1,"result":{"task":{"id":"16a635b7-5a5f-494e-b177-457b81972f14","contextId":"436582df-3dbd-4a91-a7fc-7f25ce80bdae","status":{"state":"TASK_STATE_SUBMITTED","timestamp":"2026-09-11T23:52:17.371Z"}}}}
Correcto: se terminó el proceso con PID 6700.
```

Mismo hallazgo de entorno que documentó `v3.0` (Hallazgo 2 de ese informe): en Windows, contra un `node.exe` nativo lanzado en background, ni `kill -SIGINT` de Git Bash (`no such process`) ni `taskkill //PID` sin `/F` ("sólo se puede terminar de forma forzada") funcionan — `taskkill //PID <pid> //F` fue, de nuevo, el único mecanismo de terminación disponible. Reproducido tal cual en esta sesión, no sólo heredado del informe anterior.

**Consulta directa a la SQLite aislada, inmediatamente después del `taskkill`:**

```json
{
  "a2a_task_id": "16a635b7-5a5f-494e-b177-457b81972f14",
  "estado": "TASK_STATE_WORKING",
  "created_at": "2026-09-11T23:52:17.371Z",
  "updated_at": "2026-09-11T23:52:17.373Z",
  "resultado": null,
  "origen_transporte": "::1"
}
```

Confirmado: el proceso murió con la fila en `TASK_STATE_WORKING`, `updated_at` congelado en `23:52:17.373Z`, sin `resultado`. Esta fila **nunca** se movió de ahí por el resto de la sesión (ver la tabla acumulativa más abajo) — el huérfano real que este change entero existe para hacer visible.

### Ronda 3 — probar el orden `updated_at ASC` con una tarea legítima MÁS NUEVA en curso al mismo tiempo

Tercer arranque del arnés (mismo `scratch-demo/data/harness.db`, puerto libre confirmado de nuevo):

```
$ HARNESS_A2A_ENTRANTE_TOKEN="verif-t34-8f21ac" npx tsx ../src/main.ts > run3.log 2>&1 &
```

Se provisionó una sesión de empleado real con el CLI real del proyecto (mismo patrón que `v3.3`):

```
$ printf 'clave-verif-t34-1\n' | npx tsx ../src/empleados.ts verifempleado
Contraseña: Empleado verifempleado creado.
```

`SendMessage` real, e **inmediatamente** (sin matar el proceso esta vez) se corrió el driver de Ink que hace `/login` + `/ver-solicitudes-a2a`, para capturar el listado mientras la tarea legítima seguía `WORKING`:

```
$ curl -s -X POST http://localhost:8888/a2a ... -d '{...,"parts":[{"text":"segunda tarea legitima, mas nueva que el huerfano, para probar el orden ASC"}]}...}'
{"jsonrpc":"2.0","id":1,"result":{"task":{"id":"7e300f21-e261-41c3-8246-1e8a107e890a","contextId":"16f13efe-8709-45bd-bd0a-a7ca537bd0ba","status":{"state":"TASK_STATE_SUBMITTED","timestamp":"2026-09-11T23:55:03.852Z"}}}}
$ npx tsx driver-v3.4.tsx
```

**Frame real de la TUI capturado por el driver** (vía `ink-testing-library`, `render(<App onSubmit={onComandoEmpleado} />)`, `instance.stdin.write(comando)` seguido de `instance.stdin.write("\r")` en **dos** llamadas separadas — el mismo hallazgo de `v3.3` sobre por qué una sola llamada con `\r` embebido corrompe el input):

```
[19:55:06] Vos: /login verifempleado clave-verif-t34-1
sistema: Sesión abierta como verifempleado. Vence 2026-09-12T00:25:06.478Z.
[19:55:06] Vos: /ver-solicitudes-a2a
sistema: - tarea 16a635b7-5a5f-494e-b177-457b81972f14 | estado TASK_STATE_WORKING | origen de
transporte ::1 | recibida 2026-09-11T23:52:17.371Z | actualizada 2026-09-11T23:52:17.373Z
- tarea 7e300f21-e261-41c3-8246-1e8a107e890a | estado TASK_STATE_WORKING | origen de transporte ::1
| recibida 2026-09-11T23:55:03.852Z | actualizada 2026-09-11T23:55:03.853Z
```

**Esto es la verificación de cierre del punto 4 de la tabla de `tasks.md`, en vivo, sobre datos reales de punta a punta**: el huérfano (`16a635b7...`, `actualizada 2026-09-11T23:52:17.373Z`, proceso muerto hace más de dos minutos al momento de esta consulta) aparece **primero**, antes que la tarea `7e300f21...` que en ese mismo instante estaba genuinamente en curso (`actualizada 2026-09-11T23:55:03.853Z`, casi tres minutos más nueva, con su proceso todavío vivo). Si el orden fuera `DESC` (el error que `RD-63` sugería y que `ADR 140 pto 4` corrigió), la tarea legítima aparecería primera y el huérfano quedaría enterrado bajo el `LIMIT` en cualquier organización con más de 20 solicitudes en curso — exactamente el bug que este change cierra.

Estado final de las cuatro filas acumuladas en la SQLite aislada, al terminar toda la sesión (consulta directa, no vía la app):

```json
[
  {"a2a_task_id":"5a58fab6-...","estado":"TASK_STATE_COMPLETED","updated_at":"2026-09-11T23:51:31.305Z"},
  {"a2a_task_id":"16a635b7-...","estado":"TASK_STATE_WORKING","updated_at":"2026-09-11T23:52:17.373Z"},
  {"a2a_task_id":"990c3ad1-...","estado":"TASK_STATE_COMPLETED","updated_at":"2026-09-11T23:54:35.407Z"},
  {"a2a_task_id":"7e300f21-...","estado":"TASK_STATE_COMPLETED","updated_at":"2026-09-11T23:55:21.106Z"}
]
```

(`990c3ad1-...` fue un `SendMessage` de una ronda intermedia de calibración de tiempos, dejado completar solo, sin relevancia adicional más allá de confirmar que el flujo normal —sin matar el proceso— siempre termina en `COMPLETED`.) El huérfano `16a635b7-...` es la **única** fila que quedó congelada en `TASK_STATE_WORKING` — las otras tres, incluida la que estaba en curso al mismo tiempo que él, completaron normalmente porque sus procesos siguieron vivos.

## Detalle — fila `COMPLETED` real (punto 2 del checklist, R1)

```
[19:55:06] Vos: /ver-solicitudes-a2a 5a58fab6-03ae-4a66-83fe-fcbff5efae4e
sistema: solicitud A2A 5a58fab6-03ae-4a66-83fe-fcbff5efae4e · estado TASK_STATE_COMPLETED · origen
de transporte ::1 · recibida 2026-09-11T23:51:14.402Z · actualizada 2026-09-11T23:51:31.305Z

mensaje recibido:
tarea de verificacion v3.4 - reproduccion del huerfano

resultado:
No puedo darte una respuesta certera sobre esta solicitud. Aclaro los puntos relevantes:
[... respuesta real del modelo, 3 párrafos, contenido no determinista específico de esta consulta ...]
```

Verificado por inspección directa del string completo de respuesta (`responseText`, capturado en el `lastFrame()` del driver): la palabra `"agente"` **no aparece en ningún lado** como rótulo de origen — el único rótulo usado es `"origen de transporte"`, exactamente el vocabulario que R1/ADR 142 pto 1 exige. El campo `agenteExternoUrl` tampoco aparece (no existe en `SolicitudA2AEntranteVistaEmpleado`, ADR 139 pto 3) — no es que el formateador se abstenga, es que no hay de dónde imprimirlo.

## Detalle — id inexistente (punto 3 del checklist)

```
[19:55:06] Vos: /ver-solicitudes-a2a no-existe
sistema: No existe ninguna solicitud A2A no-existe.
```

Sin throw (la sesión de Ink siguió corriendo con normalidad después, `/logout` respondió igual que siempre).

## Auditoría — `registro_acciones_empleado` (ADR 143)

Consulta directa a la SQLite aislada, filtrando por `comando = '/ver-solicitudes-a2a'`, en orden de ocurrencia:

```json
[
  {"comando":"/ver-solicitudes-a2a","resultado":"atendida","caso_id":null,"empleado_id":"verifempleado"},
  {"comando":"/ver-solicitudes-a2a","resultado":"atendida","caso_id":"37baf5e3-d67e-418c-89d4-c7aefdc5006a","empleado_id":"verifempleado"},
  {"comando":"/ver-solicitudes-a2a","resultado":"no_aplicable","caso_id":null,"empleado_id":"verifempleado"}
]
```

Las tres filas, en el mismo orden que los tres comandos del driver: listado (`atendida`, sin `caso_id`) → detalle encontrado (`atendida`, **con** `caso_id` = el `contextId` real de la tarea `COMPLETED`, `37baf5e3-...`) → id inexistente (`no_aplicable`, sin `caso_id`). Exactamente lo que ADR 143 pto 3-4 diseñó.

## Verificaciones estáticas

### Blast radius del camino de escritura del Hito 7

```
$ git diff --stat main -- src/core/agents/a2a-contract.ts src/build-on-a2a-entrante.ts src/adapters/a2a/server.ts
(sin salida)

$ npx vitest run build-on-a2a-entrante a2a-server.integration
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

### Rollback de la tarea 8

```
$ git log --oneline -1 8751202
8751202 feat(root): cablea manejarVerSolicitudesA2A al dispatcher con auditoria y verifica el caso del hallazgo 2 (comando-visibilidad-a2a-entrante, tarea 8)

$ git log --oneline -1 8751202^
418e15e feat(root): agrega formateadores de listado y detalle de solicitudes A2A entrantes (comando-visibilidad-a2a-entrante, tarea 7)

$ git show 8751202^:src/build-on-comando-empleado.ts | grep -n "ver_solicitudes_a2a\|manejarVerSolicitudesA2A"
(sin salida)
```

Confirmado (usando `git show <commit>^:<ruta>`, sin mover el working tree — mismo método que `v3.3` sección 7.3): en el padre de la tarea 8, `build-on-comando-empleado.ts` **no tiene** ni el `case "ver_solicitudes_a2a"` ni `manejarVerSolicitudesA2A`.

**Precisión sobre la frase de `tasks.md` tarea 11** ("Rollback del commit de la tarea 8 ⇒ `parsearComando(...)` vuelve a caer en `ayudaDesconocido`"): esa frase no aplica a un revert de **sólo** la tarea 8. El descriptor `/ver-solicitudes-a2a` y la rama `id_opcional_a2a_task` de `parsearComando` se agregaron en la tarea 5 (`059f2d3`), tres commits **antes** de la tarea 8, y siguen presentes en el padre de la tarea 8 (confirmado: `git show 8751202^:src/core/commands/comando-empleado.ts | grep ver_solicitudes_a2a` sí tiene coincidencias). Revertir sólo la tarea 8 dejaría `parsearComando` produciendo igual `{tipo: "ver_solicitudes_a2a", ...}` — el `switch (comando.tipo)` de `build-on-comando-empleado.ts` (sin `default:`, exhaustivo sobre la unión `ComandoEmpleado`, según el propio comentario del archivo "vuelve a ser exhaustivo — cierra el TS2322") dejaría de cubrir ese miembro de la unión y **el `npm run typecheck` fallaría**, no "caería a `ayudaDesconocido`" en tiempo de ejecución. Esa frase sí es exacta para el revert de **todo PR2** (tareas 5-11 juntas), que es lo que dice `design.md` §8 ("Rollback: revert ⇒ `/ver-solicitudes-a2a` vuelve al sumidero `ayudaDesconocido`") — ahí sí se remueve también el descriptor de la tarea 5. Se deja anotado con la misma honestidad que el hallazgo de checkbox de `v3.0` (sección "Discrepancia encontrada en `tasks.md`"): no se corrige `tasks.md`, sólo se documenta la precisión.

### Suite completa

```
$ npx tsc --noEmit
(sin salida — 0 errores)

$ npx vitest run
 Test Files  1 failed | 114 passed | 1 skipped (116)
      Tests  1 failed | 1980 passed | 3 skipped (1984)
```

**1980/1984 en verde.** El único fallo es `run-tests.integration.test.ts > ... resuelve vitestEntrypoint del checkout principal (R5, verificado no supuesto) y devuelve exitCode 0 con una suite minima en verde`, por una rama de `git worktree` (`harness/caso-caso-run-tests-verde`) que ya existía de una corrida anterior de ese mismo test de integración en este entorno:

```
GitCliError: git worktree add failed: exit-code
Caused by: Error: Command failed: git worktree add -b harness/caso-caso-run-tests-verde ... HEAD
fatal: a branch named 'harness/caso-caso-run-tests-verde' already exists
```

**Sin relación con `comando-visibilidad-a2a-entrante`**: ningún archivo de `src/core/agents/a2a-entrante-contract.ts`, `src/adapters/memory/repository.ts`, `src/core/commands/comando-empleado.ts`, `src/core/commands/registro-acciones-contract.ts` ni `src/build-on-comando-empleado.ts` aparece en el stack del fallo — el test que falla ejercita el propio test-runner del proyecto contra un `git worktree` real, no ninguna lógica de solicitudes A2A. Es el mismo tipo de fallo preexistente (rama de worktree colgada de una corrida anterior) que ya documentó `v3.3` en su propia evidencia (sección 7.5), con un nombre de rama distinto pero la misma causa raíz — no se intentó arreglar, siguiendo la instrucción explícita de esta tarea.

## Limpieza

`scratch-demo/` completa (arnés aislado, driver `driver-v3.4.tsx`, `run*.log`, `data/harness.db*`, credencial `verifempleado`) se borró al terminar (`rm -rf scratch-demo`). Los tres procesos del arnés (`node.exe` PIDs `33884`, `6700`, `28220`) se cerraron con `taskkill /F` — verificado al final:

```
$ netstat -ano | grep ":8888"
(sin salida)

$ tasklist //FI "IMAGENAME eq node.exe"
INFORMACIÓN: no hay tareas ejecutándose que coincidan con los criterios especificados.

$ git status --porcelain data/
(sin salida)

$ git status --porcelain
(sin salida, salvo esta misma carpeta de evidencia nueva)
```

Ningún proceso huérfano de esta sesión, ningún puerto abierto, y `data/harness.db` real del repo intacto en todo momento.
