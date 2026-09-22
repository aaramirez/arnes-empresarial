# Evidencia manual del proceso REAL — `salud-operativa` (tarea 4.11)

Change: [`salud-operativa`](../../../openspec/changes/salud-operativa/) · PR #4 (Slice D). Verificación manual con el binario REAL (`node dist/main.js`, no un doble), `curl` real contra un puerto real.

**Entorno**: Windows 11 (Git Bash / MSYS sobre PowerShell subyacente), Node ≥20, sin contenedor Linux disponible en esta sesión. **Declarado explícitamente por lo que sigue**: en Windows, Node.js NO implementa señales POSIX reales — `SIGTERM` no tiene semántica nativa (ver Node.js docs: *"the SIGTERM and SIGHUP signals do not have any default behavior on Windows"*, y `ChildProcess.kill()`/`process.kill(pid, signal)` sobre un PID externo en Windows "will result in the process being terminated forcefully, similarly to \`SIGKILL\`"). Esto se **reprodujo empíricamente** en esta misma sesión (ver "Intento de escenario 3" abajo) antes de declarar la limitación, tal como pide la instrucción del Implementer.

## Build usado

```
npm run build   # dist/ limpio antes (prebuild), tsc -p tsconfig.build.json
```

## Escenario 1 — sano ⇒ `200 vivo` / `200 listo`

```
$ HARNESS_HEADLESS=1 OPS_PORT=8790 node dist/main.js &
$ curl -sS -i http://127.0.0.1:8790/salud/vivo
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store
Connection: close
Content-Length: 4

vivo
$ curl -sS -i http://127.0.0.1:8790/salud/listo
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store
Connection: close
Content-Length: 5

listo
```

**Fecha/hora de la observación**: 2026-09-22, 04:33 UTC. **Código y cuerpo observados**: `200`/`vivo` y `200`/`listo`, ambos con los tres headers de S7/S15. Proceso detenido después con `taskkill //F` (ver nota de la limitación de Windows: incluso para DETENER un proceso de prueba desde esta sesión hace falta un `taskkill` forzado, no un cierre ordenado).

## Escenario 2 — un listener HABILITADO caído ⇒ `/salud/listo` `503 listener`, `/salud/vivo` sigue `200`

Se ocupó el puerto `8791` de antemano con un listener HTTP mínimo (`node -e "require('node:http').createServer(()=>{}).listen(8791, ...)"`) para forzar que `WEB_PORT=8791` colisione (`EADDRINUSE`) al arrancar el harness real:

```
$ node -e "require('node:http').createServer(()=>{}).listen(8791, ()=>console.log('ocupando 8791'))" &
ocupando 8791
$ HARNESS_HEADLESS=1 OPS_PORT=8792 WEB_PORT=8791 node dist/main.js &
$ curl -sS -i http://127.0.0.1:8792/salud/vivo
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store
Connection: close
Content-Length: 4

vivo
$ curl -sS -i http://127.0.0.1:8792/salud/listo
HTTP/1.1 503 Service Unavailable
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store
Connection: close
Content-Length: 8

listener
```

**Fecha/hora de la observación**: 2026-09-22, 04:34 UTC. **Código y cuerpo observados**: `/salud/vivo` sigue en `200`/`vivo` (liveness no consulta nada, S6, verificado con el proceso REAL, no solo el doble unitario); `/salud/listo` responde `503`/`listener` (S18: un listener HABILITADO cuyo arranque lanzó cuenta como caído). El cuerpo NO nombra `web` en ningún momento (S7, vocabulario cerrado) — consistente con la mutación M6 de `mutaciones-slice-d.md`, que confirma que nombrar el listener pondría el barrido de vocabulario en rojo. Ambos procesos (el ocupante de 8791 y el harness) detenidos con `taskkill //F` al terminar.

## Escenario 3 — durante un `SIGTERM` con un turno en vuelo — ★ NO VERIFICABLE con señales reales en este entorno Windows

**Intento realizado** (con el harness del Escenario 1 corriendo, PID `31140` obtenido vía `netstat -ano`):

```
$ kill -TERM 31140
/usr/bin/bash: line 1: kill: (31140) - No such process
```

Git Bash (MSYS) sobre Windows no logra siquiera **localizar** el PID nativo de Windows para entregarle una señal POSIX — no hay traductor de PID MSYS↔Win32 para `kill` en este entorno. El intento alternativo, detener el proceso, requirió `taskkill //F` (equivalente a `SIGKILL`, terminación forzosa e inmediata sin correr ningún `finally`):

```
$ taskkill //F //PID 31140
Correcto: se terminó el proceso con PID 31140.
```

**Por qué esto es una limitación de la PLATAFORMA, no del código bajo prueba** (documentado, no inventado): la documentación oficial de Node.js declara que en Windows `SIGTERM`/`SIGHUP` **no tienen comportamiento por defecto**, y que `process.kill(pid, señal)` sobre un proceso EXTERNO en Windows termina el proceso **forzosamente, de forma equivalente a `SIGKILL`**, sin invocar ningún handler de señal registrado con `process.on("SIGTERM", ...)`. Esto aplica igual vía `child_process.kill()`. La ÚNICA forma de que un proceso Node en Windows reciba un `SIGTERM` "real" con su handler corriendo es que el propio proceso se lo autoenvíe (`process.kill(process.pid, "SIGTERM")`), lo cual no reproduce el escenario que esta tarea pide verificar (un supervisor externo pidiendo un apagado ordenado).

**Qué SÍ queda verificado, y dónde**: el observable exacto de este escenario (`503 cerrando` **en el mismo tick de la señal**, con `web.close()` **pendiente**, `0` resoluciones, persistiendo 50 000 ms y tras una segunda señal) está probado exhaustivamente con reloj falso y un `EMISOR`/`SALIR` inyectados — sin depender de ninguna señal real del sistema operativo — en `src/main.test.ts`, tarea 4.7, test `★★ (ii, S17, O6) 200 antes de la señal; 503 cerrando en el MISMO tick de SIGTERM sin await ni avanzar el reloj; persiste a 50000ms y tras una 2.ª señal` (verde, ver `mutaciones-slice-d.md` para el rojo inicial de esa tarea). Ese test es, en los hechos, **más estricto** que una verificación manual con `curl` real durante una ventana de milisegundos: puede afirmar "cero resoluciones" en el MISMO tick síncrono, algo que una observación manual con `curl` no podría cronometrar con precisión ni en Linux.

**Recomendación para quien retome esto en un entorno Linux/contenedor** (fuera del alcance de esta tarea, dependencia declarada hacia el hijo 2 — compose/despliegue): repetir este escenario con `kill -TERM $(pgrep -f dist/main.js)` mientras un turno esté en curso (p. ej., una petición A2A entrante lenta), observando (a) `503 cerrando` inmediato en `/salud/listo`, y (b) `ECONNREFUSED` recién DESPUÉS de que `ops.close()` corra (tras el drenaje de web/webhook/a2a). El **K3** de abajo también requiere ese entorno.

## K3 — cliente con conexión reusada (keep-alive) durante el cierre — ★ NO VERIFICABLE en este entorno (depende del Escenario 3)

K3 pide repetir el cierre con un cliente que reusa conexión (keep-alive) y registrar que el apagado no se cuelga más allá del techo de 5 s. Como el Escenario 3 (disparar un `SIGTERM` real sobre el proceso mientras atiende tráfico) no es reproducible en este Windows sin un contenedor/VM Linux, K3 **tampoco se pudo ejercitar con un cliente real**. Lo que SÍ está cubierto, sin necesidad de un cliente HTTP con keep-alive real, es el mecanismo del techo mismo: `src/adapters/ops/server.test.ts`, describe `"startServer — close() corta ociosas y acota server.close() ENTERO a 5000 ms (S8)"` (verde, cuatro escenarios: `closeIdleConnections` se llama antes de `close`, el techo corta un `close()` que nunca vuelve, un cierre normal no fuerza nada, y `close()` nunca rechaza). `closeIdleConnections()` es exactamente el mecanismo que corta un keep-alive OCIOSO (Node 18.2+); un keep-alive con una request ACTIVA en el momento del cierre queda fuera del alcance declarado de este listener (S8, `design.md` §0.4: `ops` no tiene turnos en vuelo, sus dos handlers son síncronos).

**Con qué cliente se repitió**: no se repitió con `curl`/`wget`/Node real por la razón de arriba. Queda como **dependencia hacia el hijo 2** (K2), consistente con `tasks.md`.

## Resumen de fechas y estados observados

| Escenario | Fecha/hora (UTC) | `/salud/vivo` | `/salud/listo` | Método |
|---|---|---|---|---|
| 1. Sano | 2026-09-22 04:33 | `200 vivo` | `200 listo` | `curl` real contra `dist/main.js` real |
| 2. Listener caído (`web`) | 2026-09-22 04:34 | `200 vivo` | `503 listener` | `curl` real, colisión de puerto real (`EADDRINUSE`) |
| 3. `SIGTERM` con turno en vuelo | — | — | — | ★ No verificable en Windows sin contenedor/VM Linux — ver test 4.7(ii) para el observable equivalente, verificado con reloj falso |

`git diff -- src/` vacío durante toda esta verificación (ningún archivo de código tocado; solo se corrió el binario ya buildeado).
