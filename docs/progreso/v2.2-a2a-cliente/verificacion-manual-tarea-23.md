# Hito 6 (v2.2.0) — Verificación manual del entregable (tarea 23)

**Fecha de esta verificación**: 2026-09-09.

**Tareas**: [`openspec/changes/hito-2.2-a2a-cliente/tasks.md`](../../../openspec/changes/hito-2.2-a2a-cliente/tasks.md), tarea 23. Pasos verificados: los 14 de [`design.md` §11](../../../openspec/changes/hito-2.2-a2a-cliente/design.md#11-verificación-manual-del-entregable) + los 4 (7b-7d) que agregó el ADR 85.

**Veredicto de esta sesión: TAREA 23 NO CERRADA.** Se armó el entorno real completo (dos + una instancias del sample `helloworld` de `a2aproject/a2a-samples`, arnés corriendo con `HARNESS_A2A_SALIENTE=on` contra ellas) y se encontró un **bug real y reproducible** en `src/adapters/a2a/client.ts`: ninguna delegación A2A completa contra un agente real conforme a la especificación — todas terminan en `reason: "protocolo"` en menos de 15 ms, sin llegar nunca al loop de polling. Además, los pasos 7b-7d (TUI) no se pudieron ejercitar en este entorno headless (Ink exige un TTY con *raw mode*, inexistente en un proceso sin sesión interactiva). Ver el detalle de ambos bloqueos más abajo — no se fabricó ningún resultado.

---

## 1. Entorno armado

- Clonado `a2aproject/a2a-samples` (sparse-checkout de `samples/python/agents/helloworld`, Windows tiene un límite de largo de path que rompe el clone completo).
- `venv` con Python 3.12 estándar de Windows (el Python de MSYS2/ucrt64 no tiene wheels de `cryptography` para su plataforma — primer intento fallido, documentado por si se repite) + `pip install a2a-sdk==1.1.0 uvicorn sse-starlette`.
- Tres copias del sample `helloworld`, cada una con su puerto propio parcheado en `AgentCard.supportedInterfaces[0].url` y en `uvicorn.run(..., port=...)`:
  - `agent-riesgo-credito` → `http://127.0.0.1:9001` (hace de `"riesgo-credito"`).
  - `agent-kpi-incidente` → `http://127.0.0.1:9002` (hace de `"kpi-incidente"`).
  - `agent-kpi-lento` → `http://127.0.0.1:9003`, con un `await asyncio.sleep(10)` agregado en `agent_executor.py` antes de completar la tarea — variante propia, no del repo `a2a-samples`, para poder ejercitar el escenario de timeout bajo (`HARNESS_A2A_TASK_TIMEOUT_MS=3000`).
- Las tres instancias respondieron `GET /.well-known/agent-card.json` con `200` y `supportedInterfaces` correcto antes de arrancar cualquier prueba contra el arnés.
- El arnés (`tsx src/main.ts`) se corrió varias veces, cada vez con las variables `HARNESS_A2A_*`/`VENTA_GRANDE_UMBRAL`/`WEB_PORT`/`VENTAS_API_TOKEN` exportadas **inline en el mismo comando** (nunca se tocó `.env`). Empleado de prueba creado con `npm run empleados:crear -- verif-tarea23` (contraseña por stdin, como pide `src/empleados.ts`).
- `data/harness.db` es el mismo archivo de desarrollo que ya existía (gitignorado por `*.db`, no versionado); se hizo una copia de respaldo (`harness.db.bak`) antes de escribir sobre él.

## 2. Hallazgo crítico — ninguna delegación completa contra un agente real

### 2.1 Cómo se encontró

Al correr el paso 3 de `design.md` §11 (venta grande ⇒ fila `TASK_STATE_SUBMITTED` y, segundos después, `TASK_STATE_COMPLETED`), la fila **nunca avanzó** de `TASK_STATE_SUBMITTED`. El log estructural mostró el ciclo completo en 7-15 ms:

```json
{"event":"delegacion-a2a-iniciada","delegacionId":"2094fa84-...","destinoClave":"riesgo-credito", ...}
{"event":"delegacion-a2a-fallida","delegacionId":"2094fa84-...","reason":"protocolo", ...}
{"event":"a2a-riesgo-credito-fallida","reason":"protocolo", ...}
```

### 2.2 Causa raíz, verificada en dos niveles

**Nivel 1 — reproducción manual con `curl` contra el sample real** (sin pasar por el cliente TypeScript):

```
$ curl -s -X POST http://127.0.0.1:9001/ -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"hola"}]}}}'

{"error":{"code":-32009,"message":"A2A version '0.3' is not supported by this handler. Expected version '1.0'.", ...}}
```

`a2a-sdk==1.1.0` (el paquete pip real que instala hoy `pip install -r requirements.txt` del sample, sin pin adicional) exige un header HTTP `A2A-Version: 1.0` en cada request JSON-RPC. Si el header falta, el servidor asume protocolo legacy `0.3` y rechaza — verificado leyendo `a2a/utils/version_validator.py` del propio paquete instalado (`VERSION_HEADER`, default a `PROTOCOL_VERSION_0_3` cuando el header no está presente).

`src/adapters/a2a/client.ts`'s `construirHeaders()` sólo arma `Content-Type` + `Authorization` opcional — **nunca** `A2A-Version`.

Repitiendo el mismo POST con el header agregado a mano:

```
$ curl -s -X POST http://127.0.0.1:9001/ -H "Content-Type: application/json" -H "A2A-Version: 1.0" \
    -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage", ...}'

{"result":{"task":{"id":"968672b9-...","status":{"state":"TASK_STATE_COMPLETED", ...}, "artifacts":[...]}}, "id":1,"jsonrpc":"2.0"}
```

**Segunda causa, independiente de la primera**: el `result` de `SendMessage` envuelve el `Task` bajo una clave `task` (`result.task.status`, no `result.status`) — consistente con que la respuesta real de `SendMessage` es un `oneof {task, msg}` del proto, no un `Task` plano. `GetTask` (verificado con el mismo header) **sí** devuelve el `Task` directo en `result` (sin envoltorio), confirmado con:

```
$ curl ... -d '{"jsonrpc":"2.0","id":2,"method":"GetTask","params":{"id":"968672b9-..."}}'
{"result":{"id":"968672b9-...","status":{"state":"TASK_STATE_COMPLETED", ...}}, ...}
```

`parsearSobreDeTarea()` en `client.ts` es compartida por `enviarSendMessage` y `consultarOControlarTarea`, y asume uniformemente que `result` ES el `Task` — correcto para `GetTask`/`CancelTask`, **incorrecto para `SendMessage`**. Con el envoltorio sin desempacar, `idDeTarea(sendResult.task)` lee `.id` de `{task: {...}}` (`undefined`), y `delegarTarea()` retorna `{ok:false, reason:"protocolo"}` **antes de entrar al loop de polling**, en la línea 608-611 de `client.ts`.

**Nivel 2 — reproducción con el código real del proyecto** (no una réplica manual), vía un script descartable en el scratchpad que importa `src/adapters/a2a/index.ts` tal cual:

```
RESULTADO: { "ok": false, "reason": "protocolo", "endpoint": "http://127.0.0.1:9001" }
```

Mismo resultado apuntando a `"kpi-incidente"` (puerto 9002) con el mismo código — confirma que el bug es agnóstico al destino (el mecanismo SÍ es genérico, como pide el diseño), pero **nunca completa**.

### 2.3 Impacto sobre los pasos de `design.md` §11

Como el fallo ocurre en la primerísima llamada (`SendMessage`), el loop de `GetTask`, el timeout, y `CancelTask` **nunca se ejercitan** en un flujo real — no importa qué tan rápido o lento responda el agente, ni qué `HARNESS_A2A_TASK_TIMEOUT_MS` se configure. Esto se confirmó también contra el sample lento (9003, con `HARNESS_A2A_TASK_TIMEOUT_MS=3000`): la fila terminó en `reason:"protocolo"` en 9 ms, sin ningún evento `a2a-cancel-intentado` ni `reason:"timeout"`.

### 2.4 Alcance de esta corrección

No se tocó `src/` (fuera de alcance de esta tarea, explícitamente). Este hallazgo debería, a criterio de un humano, reabrir el checkpoint sobre `design.md` §6.2 (RD-24) y agregar al menos dos correcciones a `client.ts`:
1. `construirHeaders()` debe incluir `A2A-Version: 1.0` (o el valor que corresponda) en las tres llamadas.
2. `enviarSendMessage()` necesita su propio desempaquetado del `result` (`result.task` cuando trae `task`, con la rama `result.msg` para el caso — no cubierto por este sample — donde el agente responde con un `Message` en vez de crear una `Task`), en vez de reusar `parsearSobreDeTarea()` sin ajuste.

No se puede descartar que este comportamiento sea específico de la versión `1.1.0` de `a2a-sdk` (el pip package resuelto hoy, sin pin en el `requirements.txt` del sample) y no de la spec v1.0.0 en abstracto — pero es el comportamiento real y reproducible del **mismo procedimiento que el propio `README.md` de este proyecto documenta** para correr la integración, así que es información real que bloquea el entregable, no un problema de la verificación.

## 3. Pasos de `design.md` §11 — resultado paso a paso

| # | Paso | Resultado |
|---|---|---|
| 1 | Sample levantado, `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO`/`HARNESS_A2A_SALIENTE=on` exportados | **OK** — tres samples reales arriba (9001/9002/9003), variables inline por corrida, `.env` intacto |
| 2 | `POST /ventas` bajo el umbral ⇒ cero filas, `201` inmediato | **OK** — `monto:1000 < 5000` ⇒ `HTTP 201` en 0.32s, `SELECT COUNT(*) FROM delegaciones_a2a` = 0 antes y después |
| 3 | `POST /ventas` sobre el umbral ⇒ `201` inmediato (cronometrado) + fila `SUBMITTED` | **OK, parcial** — `monto:5000 >= 5000` ⇒ `HTTP 201` en 0.23s (medido con `curl -w %{time_total}`), fila creada con `estado='TASK_STATE_SUBMITTED'`, `a2a_task_id` NULL. El `201` rápido (ADR 76/R3) **sí** quedó demostrado |
| 4 | Segundos después, fila `TASK_STATE_COMPLETED` con `agente_externo_url` del card | **BLOQUEADO por el bug de §2** — la fila queda para siempre en `TASK_STATE_SUBMITTED`; `agente_externo_url` nunca se sobrescribe con el endpoint del card porque el `patch` de éxito nunca se aplica |
| 5 | La venta sigue su curso, la consulta no gatea nada | **OK** — `venta-creada` se logueó, `201` con `linkConfirmacion` se devolvió antes de que la delegación siquiera terminara; el fallo de la delegación no afectó la respuesta HTTP en ningún caso probado |
| 6 | Tráfico JSON-RPC capturado confirma `SendMessage`/`GetTask` sin prefijo `a2a/` | **OK, vía reproducción manual** — capturado con `curl` contra el sample real (§2.2): los `method` en el sobre son literalmente `"SendMessage"`/`"GetTask"`, sin prefijo. El tráfico real emitido por el arnés durante las corridas también usa esos nombres (mismo código, `client.ts` línea 404/681) |
| 7 | Mismo test de integración contra `kpi-incidente` sin cambiar código | **OK el code-path, BLOQUEADO el resultado** — mismo bug, mismo `reason:"protocolo"`, confirmado con un script de reproducción apuntando a 9002 con el mismo `createA2AAdapter` |
| 7b | `/login` + `/consultar-kpi` en la TUI ⇒ turno que tarda, responde con texto real, fila `COMPLETED` + `atendida` | **PENDIENTE — sesión interactiva humana** (ver §4) |
| 7c | `/consultar-kpi` sin `/login` ⇒ mensaje de sesión requerida, cero filas | **PENDIENTE — sesión interactiva humana** (ver §4) |
| 7d | `/consultar-kpi` con el sample apagado ⇒ mensaje legible, sin stacktrace | **PENDIENTE — sesión interactiva humana** (ver §4) |
| 8 | Fallo a mitad de poll ⇒ último estado conocido, `a2a-delegacion-fallida` con `reason`, venta intacta | **OK, con salvedad** — no se pudo forzar un fallo "a mitad del poll" (el poll nunca arranca, ver §2.3), pero el comportamiento de fallo SÍ se verificó de punta a punta: evento `delegacion-a2a-fallida` con `reason:"protocolo"`, fila conserva el último estado real (`TASK_STATE_SUBMITTED`, nunca `TASK_STATE_FAILED` fabricado — confirma el fix del code-review hallazgo 1 ya commiteado), venta con `201` y link entregados igual |
| 9 | Timeout bajo (`HARNESS_A2A_TASK_TIMEOUT_MS=3000`) contra un agente lento ⇒ `CancelTask` intentado + `reason="timeout"` | **NO VERIFICABLE, bloqueado por el bug de §2** — corrida contra el sample lento (9003, que tarda 10s) con timeout de 3s: la fila terminó en `reason:"protocolo"` en 9ms, **sin** llegar al loop de polling y por lo tanto sin emitir `a2a-cancel-intentado` ni `reason:"timeout"`. Documentado como hallazgo, no fabricado |
| 10 | Destino no configurado ⇒ evento `a2a-destino-no-configurado`, cero filas | **OK** — corrida con `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` ausente: evento `a2a-destino-no-configurado` logueado, `delegaciones_a2a` sin filas nuevas, venta con `201` normal |
| 11 | `HARNESS_A2A_SALIENTE=off` ⇒ idéntico a v2.1.0 | **OK** — corrida sin esa variable: venta de `monto:9000` (bien sobre el umbral) **no generó ningún evento `a2a-*`**, cero filas nuevas — comportamiento idéntico al de antes de este hito |
| 12 | `rg`/`grep` sobre el log por el token ⇒ cero resultados | **OK** — `rg "test-token-riesgo-xyz789" data/harness.log` ⇒ cero coincidencias, incluso en las corridas donde el `Authorization` se envió realmente en cada request fallida |
| 13 | `npm test`/`npm run typecheck` en verde con el sample apagado, integración *skipped* | **OK** — con los tres samples apagados: `npm run typecheck` sin errores; `npm test` → `103 test files passed, 1 skipped (a2a-client.integration.test.ts)`, `1661 tests passed, 3 skipped`. También se corrió el mismo archivo de integración a propósito CON los samples arriba y las env vars apuntándolos, para capturar la evidencia de §2 — ahí los 2 tests con red real **fallan** (no *skip*) por el mismo bug, y el sanity test sin red (`baseUrlDe`) pasa |
| 14 | Evidencia reunida en `docs/progreso/v2.2-a2a-cliente/` | **Este documento** + el volcado de `delegaciones_a2a` (§5) + los fragmentos de log (§2, §3) |

## 4. Por qué 7b-7d quedan pendientes de sesión interactiva

La TUI (`src/adapters/tui/`, Ink) requiere *raw mode* de `process.stdin`. En este entorno de verificación el proceso no tiene una sesión de terminal real (ni el `Bash` en background ni un pipe de stdin califican) — se probó explícitamente:

```
$ printf "/login verif-tarea23 clavesecreta123\n/consultar-kpi ...\n" | HARNESS_A2A_SALIENTE=on ... npm run dev
  ERROR Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.
```

Esto confirma, de forma honesta (no asumida de antemano), lo que la consigna anticipaba: stdin pipeado no alcanza para Ink. **No se fabricó ninguna captura de este flujo.**

Además, aunque la sesión interactiva sí se pudiera correr, el resultado de éxito de 7b (turno que responde con el texto real del agente, fila `COMPLETED`) está bloqueado por el mismo bug de §2 — `manejarConsultarKpi` usa `despacharDelegacionA2A` → `cliente.delegar()`, exactamente el código que falla con `reason:"protocolo"`. Sí se podrían verificar 7c (sin `/login`) y 7d (sample apagado) porque no dependen de que la delegación complete.

**Para que un humano corra esto en ~2 minutos**, en una terminal real:

```bash
# 1. Levantar (en otra terminal) al menos el sample de kpi-incidente:
cd a2a-samples/samples/python/agents/helloworld
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
# editar __main__.py: cambiar el puerto 9999 -> 9002 (2 lugares: AgentCard.supported_interfaces, uvicorn.run)
python __main__.py

# 2. En la raíz del proyecto:
npm run empleados:crear -- verif-humano   # contraseña por stdin
HARNESS_A2A_SALIENTE=on HARNESS_A2A_ENDPOINT_KPI_INCIDENTE=http://localhost:9002 npm run dev

# 3. Dentro de la TUI:
/login verif-humano <la-contraseña-que-elegiste>
/consultar-kpi como esta el sistema de facturacion
# cronometrar el turno (debería sentirse, no ser instantáneo)

# 4. Repetir SIN /login primero (nueva sesión) para 7c, y con el sample apagado para 7d.
```

## 5. Volcado final de `delegaciones_a2a` (todas las corridas de esta sesión)

```
id                                     destino_clave    agente_externo_url     a2a_task_id  estado                 resultado
2094fa84-32e8-45b3-9ab8-42c679062110   riesgo-credito   http://127.0.0.1:9001  (null)       TASK_STATE_SUBMITTED   (null)
2cc26243-6ce0-4795-b090-d85c7a6853b0   riesgo-credito   http://127.0.0.1:9003  (null)       TASK_STATE_SUBMITTED   (null)
```

Dos filas: la del paso 3 (§3) y la del paso 9 (timeout, §3). La corrida del paso 10 (destino no configurado) y la del paso 11 (interruptor off) no agregaron filas, como esperado — confirmado con `SELECT COUNT(*)` antes/después de cada una.

## 6. Conclusión

- Los pasos de HTTP puro (`/ventas`, interruptor, destino no configurado, redacción de credenciales, `npm test`/`typecheck`) están **verificados con evidencia real**, no simulada.
- El **entregable completo del hito** — una delegación que realmente llega a `TASK_STATE_COMPLETED` contra un agente A2A real — **no se pudo demostrar**, por un bug real y reproducible en `src/adapters/a2a/client.ts` (falta el header `A2A-Version` y falta desempaquetar `result.task` en la respuesta de `SendMessage`), encontrado corriendo el procedimiento que el propio `README.md` del proyecto documenta.
- Los pasos 7b-7d (comando `/consultar-kpi` en la TUI) quedan **pendientes de una sesión interactiva humana** — Ink no corre headless — y aunque corrieran, 7b heredaría el mismo bloqueo del punto anterior.
- **La casilla de la tarea 23 en `tasks.md` NO se marca `[x]`** en este commit: ni todos los pasos automatizables terminaron en el resultado que `design.md` especifica (bloqueados por un bug real, no por falta de esfuerzo de verificación) ni los pasos 7b-7d se pudieron ejercitar.

---

## 7. Fix del bug de §2 y re-verificación (misma línea de trabajo, 2026-09-09, sesión posterior)

**Veredicto de esta sesión: el bug de §2 está corregido y verificado con evidencia real — pero la tarea 23 SIGUE SIN CERRARSE**, porque la re-verificación del paso 9 encontró un **segundo hallazgo real, distinto y no relacionado con el fix**, explicado en §7.4. No se fabricó ningún resultado para forzar el cierre.

### 7.1 El fix (TDD real, test primero)

Dos causas, la misma raíz que documentó §2.2, corregidas en `src/adapters/a2a/client.ts`:

1. **`construirHeaders()`** (línea 375 antes del fix) ahora agrega `"A2A-Version": "1.0"` a las cuatro llamadas que la usan (GET del Agent Card, POST de `SendMessage`, `GetTask`, `CancelTask`). El doc-comment de la función deja explícito que esto **NO es un requirement de la especificación v1.0.0 en sí** — verificado (de nuevo, en esta sesión) contra `specification/a2a.proto` del tag `v1.0.0` de `a2aproject/A2A`: el `.proto` no declara ningún header HTTP obligatorio — sino lo que exige `a2a-sdk` (el paquete Python de referencia que implementan los samples de `a2aproject/a2a-samples`, la forma oficial de probar este cliente según el propio `README.md` del proyecto). Sin el header, el servidor de referencia rechaza con `VERSION_NOT_SUPPORTED`, como ya había quedado registrado en §2.2.
2. **`enviarSendMessage()`** ya NO reusa `parsearSobreDeTarea()` (la función que sigue sirviendo, sin cambios, a `GetTask`/`CancelTask`). Ahora usa una función nueva y dedicada, `parsearSobreDeSendMessage()`, que interpreta el `oneof payload { Task task = 1; Message message = 2; }` real de `SendMessageResponse` (confirmado contra el `.proto`, igual que en §2.2):
   - `result.task` presente ⇒ se desempaqueta y sigue el camino normal (el que ya tenía `delegarTarea`, sin tocarlo).
   - `result.message` presente (la otra rama real del `oneof` — un agente sincrónico de una sola respuesta, sin ciclo de vida de `Task`) ⇒ **decisión de esta sesión, documentada en el código**: se trata como `reason: "protocolo"` con un `detalle` explicativo (`"El agente respondió con result.message en vez de result.task — sin Task que trackear."`), **NO** como un error de transporte ni como un éxito fabricado. La razón: este cliente está diseñado enteramente alrededor de `TaskState`/polling (`a2a-contract.ts`, tarea 1) — no hay ningún `Task` que trackear en ese caso, así que lo honesto es decir "el agente no se comportó como este cliente espera", no inventar un resultado.
   - JSON inválido, sobre sin `result`, con `error` presente, o `result` sin `task` NI `message` ⇒ `protocolo`, igual criterio que antes (`error: null` explícito no cuenta como error, mismo criterio que `parsearSobreDeTarea`).

`GetTask`/`CancelTask` **no cambiaron su parseo** — `parsearSobreDeTarea()` sigue intacta y sigue siendo correcta ahí (confirmado en §2.2: esos sí devuelven el `Task` plano en `result`).

### 7.2 Tests nuevos — rojo antes, verde después (TDD real, confirmado)

Se extendió `src/adapters/a2a/client.test.ts`:
- Un fixture nuevo, `sendMessageTaskResponse(task)`, que arma la respuesta real de `SendMessage` (`result: { task }}`), separado de `taskResponse(task)` (que arma la respuesta real de `GetTask`/`CancelTask`, `result: task` plano, sin envoltorio) — los 20 tests existentes que ya cubrían el loop, la extracción de texto, y la no-fuga del `Authorization` se migraron a usar el fixture correcto para cada llamada (antes todos usaban `taskResponse` también para `SendMessage`, lo cual ocultaba exactamente el bug de §2.2 — el propio test suite, antes de este fix, reproducía la forma equivocada del sobre).
- Tests nuevos:
  - Una respuesta real de `SendMessage` con `result.task` (no `result` plano) parsea correctamente y llega a `TASK_STATE_COMPLETED` sin necesitar ningún `GetTask` — reproduce exactamente el bug real de §2.2.
  - `result.message` en vez de `result.task` ⇒ `reason: "protocolo"`, sin crashear, sin llegar nunca al loop de polling (2 llamadas: Agent Card + `SendMessage`, cero `GetTask`).
  - El GET del Agent Card, el POST de `SendMessage`, el POST de `GetTask`, y el POST de `CancelTask` llevan todos el header `A2A-Version: 1.0`.

**Confirmación RED→GREEN, con evidencia de la corrida real:**

```
# ANTES del fix (tests escritos, client.ts SIN tocar):
 Test Files  1 failed (1)
      Tests  22 failed | 22 passed (44)

# DESPUÉS del fix:
 Test Files  1 passed (1)
      Tests  44 passed (44)
```

`npm run typecheck` en verde. `npm test` completo (con los tres samples APAGADOS, integración *skipped*): `103 test files passed, 1 skipped (104)`, `1667 passed, 3 skipped (1670)` — 6 tests más que la corrida de §3 fila 13 (1661→1667), exactamente los 6 tests nuevos de este fix. `npm test` con los dos samples reales ARRIBA (`HARNESS_A2A_ENDPOINT_RIESGO_CREDITO`/`HARNESS_A2A_ENDPOINT_KPI_INCIDENTE`): **`104 test files passed, 1670 passed, CERO fallos, CERO skips`** — antes de este fix, esos mismos dos tests de integración con red real **fallaban** (documentado en §3 fila 13); ahora pasan de verdad.

### 7.3 Re-verificación contra los tres samples reales — pasos 3-4 y 7 (ahora sí, con evidencia real)

Se re-levantaron los tres samples (mismo entorno del scratchpad de la sesión anterior, sin reclonar ni reinstalar: `agent-riesgo-credito`:9001, `agent-kpi-incidente`:9002, `agent-kpi-lento`:9003) y se corrió el harness real (`tsx src/main.ts`) con `WEB_PORT`/`VENTAS_API_TOKEN`/`HARNESS_A2A_SALIENTE=on`/`HARNESS_A2A_ENDPOINT_*` inline, igual criterio que la sesión anterior (nunca se tocó `.env`).

**Paso 3-4 — `POST /ventas` real vía HTTP, con `monto=7500 >= 5000`:**

```
$ curl -X POST http://127.0.0.1:8099/ventas -H "Authorization: Bearer ***" \
    -d '{"vendedorId":"vend-1","vendedorNombre":"Vendedor Verif","clienteId":"cli-1",
         "clienteEmail":"cliente-verif-fix@example.com","planNuevo":"Plan Pro","monto":7500}'

HTTP:201 TIME:0.331823
{"ventaId":"8c14a38c-...","casoId":"b5dcac4f-...","linkConfirmacion":"https://...","notificado":false}
```

El `201` volvió en 0.33s (evidencia de ADR 76/R3, igual que §3 fila 3). Segundos después, la fila real en `delegaciones_a2a` (consultada con `sqlite3`, no simulada):

```
id: 9658c631-8e2f-4d43-bc96-af783e874d39
destino_clave: riesgo-credito
agente_externo_url: http://127.0.0.1:9001   ← el endpoint que el Agent Card declaró (confirmado con curl
                                                contra el card real, supportedInterfaces[0].url), no un
                                                valor inventado ni la base sin resolver
a2a_task_id: 3333df61-8324-4c61-806a-19838ff16b50
estado: TASK_STATE_COMPLETED
resultado: "Hello, World! I have received your request (Destino externo: riesgo-credito ...)"
```

Y el log estructurado real (`data/harness.log`), confirmando el ciclo completo por primera vez en este proyecto:

```json
{"event":"venta-creada", ...}
{"event":"a2a-riesgo-credito-disparada","monto":7500,"umbral":5000, ...}
{"event":"delegacion-a2a-iniciada","delegacionId":"9658c631-...", ...}
{"event":"delegacion-a2a-completada","delegacionId":"9658c631-...","a2aTaskId":"3333df61-...","resultadoChars":275, ...}
```

**Paso 4 queda demostrado de punta a punta, con evidencia real de HTTP, DB y log — el bloqueo de §3 fila 4 está resuelto.**

**Paso 7 — mismo código, apuntando a `kpi-incidente` (puerto 9002):** se corrió el archivo de integración real del proyecto (`src/test/integration/a2a-client.integration.test.ts`, el mismo que gatea por sondeo del Agent Card, sin doble ni mock) con los dos endpoints reales exportados:

```
$ HARNESS_A2A_ENDPOINT_RIESGO_CREDITO=http://127.0.0.1:9001 HARNESS_A2A_ENDPOINT_KPI_INCIDENTE=http://127.0.0.1:9002 \
    npx vitest run src/test/integration/a2a-client.integration.test.ts

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Los tres tests (sanity sin red, `delegar` contra `riesgo-credito`, `delegar` contra `kpi-incidente` — RD-26) pasan contra los DOS agentes reales, **sin una línea de código distinta entre ellos**, confirmando el requirement "mismo código, otro dominio". **Paso 7 queda demostrado — el bloqueo de §3 fila 7 está resuelto.**

Se cronometró también la delegación directa contra cada uno (vía un script descartable que importa `src/adapters/a2a/index.ts` real, mismo molde que §2.2 Nivel 2): riesgo-credito ⇒ `TASK_STATE_COMPLETED` en ~1.2s de principio a fin (proceso Node completo, incluyendo arranque de `tsx`); kpi-incidente, igual.

### 7.4 Paso 9 — SIGUE bloqueado, pero por un hallazgo NUEVO y distinto (no el bug de §2)

Se repitió el escenario de timeout bajo (`taskTimeoutMs=3000`) contra el sample lento (9003, `sleep(10)` antes de completar). Con el fix puesto, el resultado NO fue el esperado por la consigna de esta sesión — y se investigó la causa real en vez de forzarlo:

```
config: { requestTimeoutMs: 5000, pollIntervalMs: 500, taskTimeoutMs: 3000 }
RESULTADO: { "ok": false, "reason": "transporte", "endpoint": "http://127.0.0.1:9003" }
DURACION_MS: 5038
EVENTOS: []
```

Nunca hay `GetTask` ni `a2a-cancel-intentado`: la propia llamada HTTP de `SendMessage` se corta por `requestTimeoutMs` (`AbortSignal.timeout`) **antes** de recibir ninguna respuesta — el loop de polling nunca arranca.

Para entender por qué, se subió `requestTimeoutMs` a 15000 (por encima de los 10s del `sleep`) y se repitió:

```
config: { requestTimeoutMs: 15000, pollIntervalMs: 500, taskTimeoutMs: 3000 }
RESULTADO: { "ok": true, "a2aTaskId": "...", "estado": "TASK_STATE_COMPLETED", ... }
DURACION_MS: 10046
EVENTOS: []
```

`SendMessage` tardó **10046 ms en devolver una respuesta HTTP** — y esa respuesta ya trae `TASK_STATE_COMPLETED`, no `SUBMITTED`/`WORKING`. Cero `GetTask`. **Causa raíz, verificada leyendo el código fuente instalado de `a2a-sdk` (no asumida):**

```python
# venv-a2a/Lib/site-packages/a2a/server/request_handlers/default_request_handler.py:368
blocking = not params.configuration.return_immediately
```

El `DefaultRequestHandler.on_message_send` de referencia de `a2a-sdk` **bloquea la respuesta HTTP de `SendMessage` hasta que la tarea llega a un estado terminal o interrumpible**, salvo que el request incluya `params.configuration.return_immediately = true`. `SendMessageParams` en `src/adapters/a2a/client.ts` **nunca arma ese campo `configuration`** — el diseño de este cliente (design.md §6.2, tabla de las tres llamadas) nunca lo contempló, porque el loop de `GetTask` se diseñó asumiendo que `SendMessage` vuelve rápido con `SUBMITTED`/`WORKING` (el modelo asíncrono típico de A2A). Contra ESTE sample de referencia, con la config por defecto del SDK, esa asunción no se cumple: `SendMessage` ES la espera completa.

**Esto es un hallazgo real, verificado, y completamente DISTINTO de los dos bugs de §2** (que ya están corregidos y confirmados: §7.1-7.3). No es un defecto de este fix — es un gap de diseño preexistente (el cliente nunca pide explícitamente el modo no-bloqueante) que la verificación de la tarea 23 nunca había podido ver porque los dos bugs de §2 hacían fallar la delegación **antes** de llegar siquiera al primer `SendMessage` real. Recién ahora, con `SendMessage` funcionando de verdad, queda expuesto.

**Lo que SÍ se puede afirmar con evidencia real:**
- La lógica de `reason: "timeout"` + `a2a-cancel-intentado` + último estado conocido **está implementada y correctamente probada** — 8+ tests unitarios en `client.test.ts` la ejercitan con un reloj/sueño fake (sin red real), incluida la variante exacta de este escenario (timeout agotado, `CancelTask` disparado sin esperarlo, `logEvent` con `ok`).
- Contra un agente lento real que además **bloquea el `SendMessage` en sí** (como este sample, con la config por defecto del SDK), el cliente **nunca rechaza** (ADR 77 se sostiene): con `requestTimeoutMs` corto, falla limpio con `reason: "transporte"`, sin crashear, sin colgar el proceso.
- Lo que NO se pudo demostrar de punta a punta contra un agente real es específicamente la combinación `reason: "timeout"` (agotamiento del `taskTimeoutMs` **durante el polling**, no durante `SendMessage`) + `a2a-cancel-intentado` — porque, contra este sample de referencia y sin `configuration.return_immediately: true`, el polling nunca llega a arrancar.

**Decisión de esta sesión: NO se modificó `client.ts` para agregar `configuration.return_immediately: true`.** Está fuera del alcance que se pidió para este fix (dos causas puntuales: header y desempaquetado de `result.task`/`result.message`), y es un cambio de comportamiento con superficie propia (agrega un campo nuevo al molde JSON-RPC "propio, acotado y cerrado" de ADR 71 pto 6, que hoy es deliberadamente mínimo) que merece su propia revisión de diseño, no un agregado de último momento dentro de un fix de dos bugs puntuales.

### 7.5 Estado final de la tarea 23

**La casilla de la tarea 23 en `tasks.md` SIGUE SIN marcarse `[x]`.** No porque el fix esté incompleto — está completo, probado con TDD real (rojo→verde), y verificado con evidencia real contra los tres agentes (pasos 3, 4, 5, 6, 7, 10, 11, 12, 13 del §11 de `design.md` ahora pasan con evidencia real; antes de este fix, 4 y 7 estaban bloqueados) — sino porque el **paso 9**, tal como está escrito en `design.md` §11 (`a2a-cancel-intentado` + `reason="timeout"` + fila `TASK_STATE_WORKING`, contra un agente real), sigue sin poder demostrarse de punta a punta, por el hallazgo nuevo de §7.4. Los pasos 7b-7d siguen pendientes de sesión interactiva humana (Ink/raw-mode, sin cambios respecto de §4 — no se re-intentaron en esta sesión, la consigna los dejó explícitamente afuera).

Dos caminos posibles para un humano, sin fabricar ninguno acá:
1. Aceptar la cobertura de `reason: "timeout"` + `CancelTask` a nivel de los 8+ tests unitarios (reloj fake, sin red) como evidencia suficiente para ese sub-requirement puntual, y cerrar la tarea 23 con esa salvedad documentada.
2. Abrir un change nuevo, acotado, para que `enviarSendMessage` mande `params.configuration.return_immediately: true` (alineado con el modelo asíncrono que el resto del diseño ya asume) y volver a correr el paso 9 tal cual está escrito.

Ninguna de las dos decisiones le corresponde a esta sesión tomarla sola.

## 8. Decisión del checkpoint humano (2026-09-09, misma sesión de cierre)

**Camino 1 elegido**: la cobertura de `reason: "timeout"` + `a2a-cancel-intentado` a nivel de los 8+ tests unitarios de `client.test.ts` (reloj/sueño fake, sin red real) se acepta como evidencia suficiente para ese sub-requirement puntual del paso 9 de `design.md` §11. No se abre change nuevo para `configuration.return_immediately` en este momento — queda registrado acá como deuda conocida y no bloqueante, disponible para retomar si un `sdd-apply` futuro necesita demostrar el camino asíncrono real contra un agente que bloquee `SendMessage` por default.

**Con esta decisión, la tarea 23 se da por cerrada** con las siguientes salvedades explícitas, no escondidas:
- El paso 9 de `design.md` §11 (timeout + `CancelTask` contra un agente real) queda demostrado a nivel de test unitario, no de punta a punta contra un agente real — por el hallazgo de §7.4 (el SDK de referencia bloquea `SendMessage` salvo `return_immediately`), no por falta de esfuerzo de verificación ni por un defecto del código.
- Los pasos 7b-7d (`/consultar-kpi` en la TUI) quedan pendientes de una sesión interactiva humana — Ink exige raw-mode real, confirmado en §4. Los comandos exactos para correrlos en ~2 minutos están documentados ahí.

Todos los demás pasos automatizables de `design.md` §11 (1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14) están verificados con evidencia real, no simulada — ver §3 y §7.3.
