# Evidencia manual del proceso real — `modo-headless-cierre-limpio` (tarea 5.1)

> Se registra SOLO lo observado (fecha, comando, tiempo, código de salida, cuerpo). Lo que no se pudo verificar va
> como `[no verificado]` con los pasos para el humano. Los hallazgos que contradicen el design/spec están en la
> sección "Hallazgos" y NO se corrigieron acá (5.1 no toca `src/`).

## Entornos y método

| | Entorno A (Linux, señales POSIX) | Entorno B (Windows) |
|---|---|---|
| SO | contenedor `node:20-bookworm-slim` (digest `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`), kernel `6.6.87.2-microsoft-standard-WSL2`, Docker Desktop 29.3.1 | Windows 11 Pro 10.0.26200, Git Bash |
| Node | v20.20.2 (npm 10.8.2), coincide con `ci.yml` (`node-version: 20`) y `engines >=20` | v24.14.1 |
| Fecha | 2026-09-21, 23:05-23:20 UTC (19:05-19:20 -04:00) | 2026-09-21, 19:17-19:18 -04:00 |

- **Base**: commit `42b10a9`, árbol limpio de `src/`. Copia del proyecto FUERA del repo (scratchpad de la sesión) con
  solo `src/`, `package*.json`, `tsconfig*.json`, `vitest.config.ts` y `.claude/skills`: **sin `.env`, `data/`, `.git`,
  `node_modules` ni `dist`**. Dentro del contenedor: `npm ci` (12 s) y `npm run build` (exit 0). Todo desde la raíz de
  la copia (`/work`), como exige `start` (`data/` y `.claude/skills` se resuelven contra `process.cwd()`).
- `dist/` del repo y el del contenedor son **idénticos byte a byte** (`sha256sum`: `main.js` `85420f00...`,
  `proceso-cierre.js` `76f5c35e...`, `adapters/web/server.js` `ddcb5a70...`), por eso el entorno B corre el `dist/`
  del repo con `cwd` en un directorio temporal (no lee el `.env` ni toca el `data/` reales).
- **Doble del modelo (límite declarado)**: no hay `ANTHROPIC_API_KEY` real. Los turnos del punto (2) corren el SDK y el
  binario `claude` reales contra una API de mensajes **simulada** (`ANTHROPIC_BASE_URL=http://127.0.0.1:9500`, clave
  ficticia) que pide `consultar_kpi{kpis_del_mes}` y luego contesta texto. El agente externo de KPIs es una copia del
  `mock-a2a-kpi.cjs` de v3.16 con retraso configurable. Cliente A2A, `ejecutarOperacion`, auditoría y SQLite son los
  reales. Los scripts auxiliares (mock, API simulada, clientes, medidores) están fuera del repo.
- Tiempos: marcas `date +%s.%N` alrededor de `kill -TERM` y de la salida del proceso, y las marcas de `data/harness.log`.

## Resumen

| # | Punto | Resultado |
|---|---|---|
| 1 | Arranque headless real sin TTY | **Parcial.** Con al menos un listener: vivo, sin Ink. **Sin ningún listener: sale solo con código 13 en ~0,8 s** (H-1) |
| 2 | `SIGTERM` con turno en vuelo | **Confirmado**: drena, fila de auditoría antes de `db.close`, exit 0 en 18,8 s; con presupuesto 5 s: exit 1, `cierre-presupuesto-excedido`, fila ausente |
| 3 | Cierre sin turnos / keep-alive ocioso | **Confirmado** (22-27 ms); pero el keep-alive no cuelga ni sin el fix en Node >= 20 (H-3) |
| 4 | `HARNESS_DB_PATH` con espacios | **Confirmado** en Linux y Windows |
| 5 | `*_HOST` | **Confirmado** en los tres listeners; J1 `[D]` confirmado |
| 6 | Arranque TUI sin regresión | **`[no verificado]` en terminal real**; pty emulado: Ink monta, Ctrl+C sale 0 |
| 7 | `HARNESS_HEADLESS=true` | **Confirmado**: exit 1, mensaje claro, sin Ink, en Linux y Windows |

## (1) Arranque headless real sin TTY (Linux, Node 20.20.2)

```
$ npm run start < /dev/null                                   # control: sin HARNESS_HEADLESS
exit=13 tras 0.97 s; Ink dibuja el banner y falla: "ERROR Raw mode is not supported on the current process.stdin"

$ HARNESS_HEADLESS=1 npm run start < /dev/null                # ningún *_PORT/token: los tres listeners deshabilitados
exit=13 tras 0.84 s; salida solo "> arnes-empresarial@0.1.0 start / > node dist/main.js"; sin Ink, sin log de cierre

$ HARNESS_HEADLESS=1 WEB_PORT=8090 npm run start < /dev/null  # un listener habilitado
VIVO a los 10 s (pid 271); salida idéntica (solo el banner de npm), Ink NO montado (0 ocurrencias del banner);
data/harness.log: ..., {"port":8090,"event":"web-escuchando"}; socket en :::8090
```

`startTui` no se monta y no aborta con `Raw mode is not supported` en las dos corridas headless. **Pero "queda vivo"
solo se cumple si hay algo más que sostenga el event loop** (H-1). En Windows (Node 24.14.1) el mismo caso sin
listeners: exit 13 tras 1,02 s con `Warning: Detected unsettled top-level await at .../dist/main.js:636 await esperarSenalDeCierre();`.

## (2) `SIGTERM` con un turno `consultar_kpi` en vuelo (Linux)

Cuenta `admin1` creada con los CLIs reales (`empleados:crear -- admin1` + `--rol administrador`), `POST /login` y
`POST /operaciones {"consulta":"Consultá los KPIs del mes"}` con el agente de KPIs tardando 20 s. Arnés lanzado con
`node dist/main.js` (no `npm run start`, ver H-2), `HARNESS_HEADLESS=1 WEB_PORT=8090 HARNESS_A2A_SALIENTE=on`.

**(2a) presupuesto por defecto (70 000 ms), `SIGTERM` a los 3 s del turno:**

```
23:11:07.634  POST /operaciones enviado
23:11:10.920  {"event":"cierre-senal-recibida","senal":"SIGTERM"}
23:11:29.387  {"event":"accion-empleado-registrada","comando":"/consultar-kpi","resultado":"atendida"}   # fila de auditoría
23:11:29.723  {"event":"turno-completado"}
23:11:29.726  cliente: status=200 duracion_ms=22091  {"casoId":"bdbe913f-...","respuesta":"Consulta atendida (respuesta del modelo simulado)."}
23:11:29.733  {"event":"cierre-completado"}
exit=0; SIGTERM -> salida: 18.832 s
registro_acciones_empleado: 1 -> 2 filas (nueva: comando /consultar-kpi, empleado admin1, resultado atendida, ocurrido_at 23:11:29.387)
delegaciones_a2a: 1 -> 2
```

El turno terminó, entregó su respuesta y **dejó su fila antes de `db.close()` y de `cierre-completado`** (R1). Sin
`*-cierre-con-turnos-en-vuelo`: no hizo falta el techo de 5 s.

**(2b) `HARNESS_SHUTDOWN_TIMEOUT_MS=5000` (bajo la duración del turno), `SIGTERM` a los 3 s:**

```
23:11:55.488  POST /operaciones enviado;  23:11:56.193 {"event":"delegacion-a2a-iniciada"}   # nunca aparece "delegacion-a2a-completada"
23:11:58.771  {"event":"cierre-senal-recibida","senal":"SIGTERM"}
23:12:03.771  {"event":"cierre-presupuesto-excedido","presupuestoMs":5000,"senal":"SIGTERM"}
exit=1; SIGTERM -> salida: 5.019 s
cliente: ERROR de transporte: ECONNRESET tras 8300 ms
registro_acciones_empleado: 2 -> 2 filas (la fila del turno AUSENTE)
```

Vencimiento **logueado** con exit 1 y fila ausente, como prevé el design. Tampoco apareció
`web-cierre-con-turnos-en-vuelo`: con el socket del turno retenido el callback de `server.close()` no llega (design
§0.1/§6.2 pto 3, **confirmado**: la evidencia garantizada del vencimiento es `cierre-presupuesto-excedido`).

## (3) Cierre sin turnos y con un cliente keep-alive ocioso (Linux)

- **Sin turnos** (`SIGTERM` a `node dist/main.js` con web habilitado): exit 0; `senal -> salida` 24 ms, 22 ms y 25 ms en
  tres corridas; log `cierre-senal-recibida` 23:10:49.274 -> `cierre-completado` 23:10:49.279. **El presupuesto de 70 s
  es un techo, no una espera: `[I]` de design §6.2 confirmado** (ya con `closeIdleConnections` del slice C).
- **Con un cliente keep-alive ocioso contra `/chat`** (socket TCP crudo: `GET /chat` con `Connection: keep-alive`, 200 OK,
  conexión abierta e inactiva): `SIGTERM` a las 23:12:52; el servidor cerró esa conexión a las 23:12:52.166 (2 ms
  después de `cierre-senal-recibida`), exit 0, 27 ms. El cierre **no se cuelga**. Matiz en H-3.

## (4) `HARNESS_DB_PATH` con espacios y directorio nuevo

```
HARNESS_DB_PATH="/opt/mi base/datos nuevos/harness.db"      (el directorio no existía)
$ printf 'Clave-Prueba-51x\n' | npm run empleados:crear -- ana    -> "Empleado ana creado."   # crea /opt/mi base/datos nuevos/harness.db (233472 bytes)
$ npm run reporte:mensual -- --periodo 2026-09                     -> "(sin reembolsos pendientes)"
ls data/ tras los dos CLIs -> no existe (ninguno abrió el default)
$ HARNESS_HEADLESS=1 WEB_PORT=8090 node dist/main.js  +  POST /login {ana}  -> 200 {"token":...}    # main ve a "ana", creada por el CLI
data/ tras main -> solo harness.log (el destino del logger no cambia; es del hijo 6)
contraste: reporte:mensual SIN la variable -> crea data/harness.db
```

**Windows (Node 24.14.1)**, `HARNESS_DB_PATH=<scratchpad>\winrun\dir con espacios\datos nuevos\harness.db`, con
`dist/empleados.js` y `dist/reporte-mensual.js`: mismo resultado (base creada en la ruta con espacios, `data/` sin
`harness.db` tras los dos CLIs, `main` headless con la misma ruta hace `POST /login` de `ana` -> 200).

## (5) `*_HOST` (Linux; web 8090, webhooks 8787, A2A entrante 8888; sockets leídos de `/proc/net/tcp{,6}`)

| Configuración | Sockets en LISTEN | Conexiones (127.0.0.1 / ::1 / IP de eth0 172.17.0.2) |
|---|---|---|
| Ningún `*_HOST` | `tcp6 :::8090`, `:::8787`, `:::8888` | ACEPTADA / ACEPTADA / ACEPTADA (los 3 puertos) |
| Los tres `=127.0.0.1` | `tcp 127.0.0.1:8090`, `:8787`, `:8888` | ACEPTADA / ECONNREFUSED / ECONNREFUSED |
| `WEB_HOST=0.0.0.0` | `tcp 0.0.0.0:8090` | ACEPTADA / ECONNREFUSED / ACEPTADA |
| `WEB_HOST=203.0.113.9` (no enlazable) + A2A válido | web: `EADDRNOTAVAIL`; A2A escuchando | proceso vivo; log `web-arranque-fallido`; exit 0 con `SIGTERM` |

**J1 `[D]` confirmado**: sin `host`, Node escucha en `::` (dual-stack IPv4 + IPv6); `"0.0.0.0"` deja de escuchar en
IPv6 (`::1` rechazada), por eso el default correcto es omitir el argumento. Un `*_HOST` inválido deja el proceso vivo
**sin ese listener** (límite declarado del design) **siempre que haya otro listener**; con el web como único listener
y `WEB_HOST=203.0.113.9` el proceso sale solo con exit 13 tras 0,70 s (H-1).

## (6) Arranque TUI sin regresión — `[no verificado]` en terminal real

Un agente no tiene terminal interactiva. Se hizo la aproximación posible: **pty emulado** con `script(1)` (util-linux
2.38.1) dentro del contenedor, con el byte `0x03` (Ctrl+C) inyectado al pty a los 6 s:

- Sin `HARNESS_HEADLESS`: Ink **montó** (banner y caja de prompt en el typescript, 0 ocurrencias de `Raw mode is not supported`).
- Ctrl+C -> `node` sale **0**. Sin `WEB_PORT`: 0,059 s. **Con `WEB_PORT=8090`: 5,021 s** y el puerto queda cerrado (H-4).

Esto NO reemplaza la prueba humana. **Pasos para el humano** (Windows Terminal o PowerShell, desde la raíz del repo):
`npm run build`, `npm run start` (sin `HARNESS_HEADLESS`); ver el banner y el prompt; pulsar Ctrl+C y comprobar que vuelve
al prompt con `echo $LASTEXITCODE` = 0; repetir con `$env:WEB_PORT="8090"` y anotar el tiempo hasta la salida.

## (7) `HARNESS_HEADLESS=true`

Linux (Node 20.20.2) y Windows (Node 24.14.1), `node dist/main.js < /dev/null`:

```
exit=1 (0.73 s Linux)
Error: Variable de entorno HARNESS_HEADLESS invalida: "true". Valores admitidos: "0" (o ausente/en blanco, TUI) y "1" (headless).
    at esModoHeadless (.../dist/proceso-cierre.js:72:11)
```

Igual con `"2"` y `"yes"` (Linux, exit 1). Sin Ink, sin listeners de señal y sin proceso residual. `" "` (blanco) equivale a
TUI: Ink monta y falla por falta de TTY, exit 13, como el control del punto (1). Matiz: el error sale como excepción no
capturada con stack, y `openDatabase` ya corrió (queda `data/harness.db` en el `cwd`) antes del `throw`.

## Hallazgos que contradicen el design/spec (no corregidos aquí)

**H-1 (crítico) — un handler de señal NO mantiene vivo el event loop; el design §0.7 `[D]` es falso.** Experimento
mínimo, sin el arnés (Node 20.20.2): `process.on("SIGTERM", ...); await new Promise(() => {})` sale con **exit 13**
inmediatamente. Consecuencias observadas en el proceso real: headless sin ningún listener habilitado, o con el único
listener fallido, termina solo con **exit 13 en ~0,7-1 s, sin `cierre-*` en el log** (y, en Node 20, sin mensaje). Con al
menos un listener el servidor sostiene el loop y todo lo demás funciona. Contradice el comentario de `main.ts:805-807`
("los listeners de señal mantienen vivo el event loop") y el escenario "queda vivo" de la spec H1/tarea 5.1 (1).

**H-2 — el test 3.7 (`cierre-headless.integration.test.ts`) FALLA en Linux.** Corrido en el contenedor
(`npx vitest run src/test/integration/cierre-headless.integration.test.ts`): `AssertionError: expected null to be 0`
(`signalCode` = `SIGTERM`, 34 ms). Causa verificada: el sondeo de `SigCgt` no detecta el registro del handler, porque un
Node **recién arrancado ya tiene el bit de SIGTERM (y SIGINT) en `SigCgt`** (`0x0000000100004602`, sin ningún
`process.on`); el test manda `SIGTERM` a los ~20 ms, ~600 ms antes de que `main` registre su handler, y el hijo muere por
la señal. Además, aun corrigiendo el sondeo, el hijo del test no tiene listeners y por H-1 saldría solo con 13 a los
~0,7 s (`SigCgt` pasa a `0x...14602` a los 660 ms: bit de `SIGCHLD`, atribuible al `spawn` de `git` del barrido de
worktrees, no al handler de `SIGTERM`; atribución inferida, no instrumentada). **Es probable que rompa el `npm test` de
CI (ubuntu, Node 20)**: no se corrió en el CI real, solo en este contenedor. El desarrollo es Windows, donde el test se
saltea; no hay constancia en el repo de una corrida previa en Linux.

**H-3 — la premisa de design §0.2/§10.1 (un keep-alive ocioso cuelga `server.close()`) no se reproduce en Node >= 20.**
Control sin el arnés: en Node v20.20.2 **y** v24.14.1, `server.close(cb)` con un keep-alive ocioso abierto llama al
callback a **1 ms con y sin** `closeIdleConnections()` previo (Node >= 19 ya cierra los ociosos en `close()`). Con
`engines >=20`, `closeIdleConnections()` es redundante e inocuo; el punto (3) pasa, pero **no distingue con/sin el
fix**. Por la misma razón el "dato de riesgo" de design §10.1 (un socket ocioso consume el presupuesto entre el merge de
#2 y #3) no aplica en las versiones soportadas.

**H-4 (preexistente, informativo) — en TUI con el web habilitado, Ctrl+C tarda 5,02 s en terminar el proceso** (0,059 s
sin `WEB_PORT`). Coincide con `WEB_CLOSE_TIMEOUT_MS = 5000`; la causa probable es el `setTimeout` del `race` de `close()`
(nunca se limpia) que sostiene el loop hasta vencer. Causa NO instrumentada. En headless no se nota porque
`salir(0)` es explícito. Es del `race` que este change se comprometió a no tocar.

**H-5 (para el hijo 2, R24) — `npm run start` NO reenvía `SIGTERM` al `node` hijo.** `SIGTERM` al pid de `npm`: `npm`
murió con 143 en 6 ms y `node dist/main.js` quedó **huérfano y vivo, escuchando `:::8090`, sin ejecutar el cierre** (solo
al mandarle `SIGTERM` directo hizo `cierre-senal-recibida` y `cierre-completado`). Un `CMD`/`ExecStart` con
`npm run start` como proceso principal pierde el cierre ordenado y cae en `SIGKILL`. Debe ser `node dist/main.js` directo.

**Ventana J3 (Windows) confirmada `[D]`**: en Windows Node 24.14.1, `child.kill("SIGTERM")` a `main.js` headless lo termina
(`{code: null, signal: "SIGTERM"}` a los 13 ms) sin correr ningún handler: el log NO contiene `cierre-senal-recibida` ni
`cierre-completado`. El cierre ordenado por señal solo es verificable en Linux/contenedor.

## `[no verificado]`

- **Punto (6) en terminal real interactiva** (pasos arriba). Solo hay evidencia en pty emulado.
- **Turno real con un LLM real**: el punto (2) usa un modelo simulado. Con clave real: `WEB_PORT=8090 HARNESS_HEADLESS=1
  HARNESS_A2A_SALIENTE=on HARNESS_A2A_ENDPOINT_KPI_INCIDENTE=http://localhost:9001 node dist/main.js` en Linux/contenedor,
  `MOCK_MODE=normal node docs/progreso/v3.16-consulta-kpi-a2a-chat/mock-a2a-kpi.cjs`, pedir los KPIs por `/chat` y enviar
  `SIGTERM` durante los ~9 s del mock.
- **Ctrl+C (`SIGINT`) real sobre headless en Windows**: mi shell no tiene consola; en PowerShell,
  `$env:HARNESS_HEADLESS="1"; $env:WEB_PORT="8091"; npm run start`, Ctrl+C: esperado `cierre-senal-recibida` con `SIGINT` y exit 0.
- `docker stop` / `stop_grace_period` reales: son del hijo 2.

## Limpieza

Contenedor `harness-5-1` eliminado (`docker rm -f`; sin volúmenes creados hoy). La imagen `node:20-bookworm-slim` se
conserva. La copia del proyecto y los scripts auxiliares quedan en el scratchpad de la sesión, fuera del repo. En el repo:
`git diff -- src` vacío; el único archivo nuevo de esta tarea es este.
