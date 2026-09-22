# Evidencia manual POST-FIX del proceso real — `modo-headless-cierre-limpio` (tarea 5.1a)

> **Addendum, no reemplazo**: [`evidencia-manual.md`](evidencia-manual.md) (tarea 5.1) queda tal cual — es el registro de lo
> observado ANTES del fix y la justificación del loop de rechazo. Este archivo lo referencia y cierra sus hallazgos H-1..H-5
> uno por uno. Solo se registra lo observado; lo no verificado va como `[no verificado]`.

## Entorno y método

- Contenedor `node:20-bookworm-slim` (Node v20.20.2, npm 10.8.2, Linux 6.6.87.2-microsoft-standard-WSL2, Docker Desktop 29.3.1),
  2026-09-22 00:01-00:06 UTC (2026-09-21 20:01-20:06 -04:00). Rama `hito/v3.17-modo-headless-cierre-limpio`, base `7e21a06` **más
  las tareas 2.7a/3.7a/2.7b aplicadas en el working tree**. Copia del proyecto fuera del repo (sin `.env`, `data/`, `.git`,
  `node_modules` ni `dist`; con `.env.example` porque `env-example.test.ts` lo lee); `npm ci` y `npm run build` (exit 0, sin
  `*.test.js`) dentro del contenedor; todo desde la raíz de la copia (`/work`).
- **Mismo doble que la 5.1** (límite declarado): sin clave de LLM real; el SDK y el binario `claude` reales contra una API
  de mensajes simulada (`ANTHROPIC_BASE_URL`), y un agente KPI lento (copia del mock de v3.16 con retraso). Cliente A2A,
  `ejecutarOperacion`, auditoría y SQLite, reales. Scripts auxiliares fuera del repo. Comando de proceso: `node dist/main.js < /dev/null` (no `npm run start`, ver H-5).

## Resultado por punto

### (1) ★ H-1 cerrado — headless SIN ningún `*_PORT`/token

```
$ HARNESS_HEADLESS=1 node dist/main.js < /dev/null      (2026-09-22T00:02:07Z; antes: exit 13 a los 0.84 s, sin log)
VIVO a los 10 s (pid 4886); salida del proceso: vacía
data/harness.log: web-deshabilitado, webhook-deshabilitado, a2a-servidor-deshabilitado,
                  {"presupuestoMs":70000,"casoId":"proceso","event":"cierre-esperando-senal","timestamp":"…00:02:08.670Z"}
SIGTERM a las 00:02:18.186Z  ⇒  exit=0; señal -> salida 0.023 s; log: cierre-senal-recibida, cierre-completado (00:02:18.196Z)
```

### (2) ★ H-1, caso del bind fallido — `WEB_HOST=203.0.113.9` como ÚNICO listener

```
$ HARNESS_HEADLESS=1 WEB_PORT=8090 WEB_HOST=203.0.113.9 node dist/main.js < /dev/null      (antes: exit 13 a los 0.70 s)
{"message":"listen EADDRNOTAVAIL: address not available 203.0.113.9:8090","event":"web-arranque-fallido"}
{"presupuestoMs":70000,"event":"cierre-esperando-senal"}
VIVO a los 10 s (pid 4927); SIGTERM ⇒ exit=0; señal -> salida 0.025 s (cierre-senal-recibida + cierre-completado)
```
El límite declarado *"un `*_HOST` inválido deja el proceso vivo sin ese listener"* **ahora sí se cumple** (antes no).

### (3) ★ H-2 cerrado — el test de proceso real corre y pasa en Linux

```
$ npx vitest run src/test/integration/cierre-headless.integration.test.ts        (Node 20.20.2)
 ✓ arranca headless, espera el marcador, recibe SIGTERM y sale 0 con el log de cierre completo ...   1430ms
 ✓ (test 27, H-1) headless SIN ningún listener NO termina por sí solo ...                            3313ms
Tests  2 passed (2)
$ npm test   (suite COMPLETA, contenedor, estado final, 2026-09-22T00:05:41Z)
 ✓ src/test/integration/cierre-headless.integration.test.ts (2 tests) 6578ms      ← EJECUTADOS, no salteados
 ✓ src/proceso-cierre.test.ts (56 tests)      ✓ src/main.test.ts (59 tests)
Test Files  2 failed | 150 passed | 4 skipped (156)      Tests  3 failed | 3070 passed | 14 skipped (3087)
```
**La suite completa en el contenedor NO queda verde, y se declara**: (a) `env-example.test.ts` — `HARNESS_A2A_ENTRANTE_HOST`,
`WEB_HOST` y `WEBHOOK_HOST` siguen sin documentarse en `.env.example` (tareas 4.2/4.4/4.6; también rojo en Windows y previo a esta
fase; el agente no puede leer ni editar ese archivo por permiso denegado); (b) **dos** tests de `App.test.tsx` (TUI), ajenos a este
change: en el contenedor fallan entre 2 y 4 tests distintos por corrida (`walks older entries…`, `flushes the banner to the real
stdout stream…` con timeout de 5 000 ms, etc.), **ya en la línea base previa a la Fase 6** (2 fallos) y de forma intermitente.
El criterio de esta tarea —el test de integración **ejecutado** en Linux— **sí se cumple**. Que el PR #2 ya no rompe CI por el
test 3.7 queda demostrado en este contenedor; `[no verificado]` en el runner real de `ubuntu-latest` (no se corrió CI).

### (4) Punto (2) de la 5.1 re-verificado con el fix — `SIGTERM` con un `consultar_kpi` en vuelo

Mismo montaje que la 5.1 (`admin1`, `POST /login` + `POST /operaciones`, agente de KPIs tardando 20 s, presupuesto 70 000 ms):

```
00:03:16.130  POST /operaciones enviado
00:03:19.418  cierre-senal-recibida (SIGTERM, a los ~3 s del turno)
00:03:38.371  accion-empleado-registrada  /consultar-kpi  atendida     ← fila de auditoría (registro_acciones_empleado 0 -> 1; delegaciones_a2a 1)
00:03:38.664  cliente: status=200 duracion_ms=22534 {"respuesta":"Consulta atendida (respuesta del modelo simulado)."}
00:03:38.665  cierre-completado          exit=0; señal -> salida 19.264 s   (5.1 sin fix: 18.832 s)
```
El ancla **no altera el drenaje ni el tiempo** (diferencia de 0,43 s, dentro de la variación del retraso del doble): exit 0,
respuesta 200 y fila escrita **antes** de `db.close()`/`cierre-completado`. (El log muestra dos `cierre-esperando-senal` porque en
ese momento corría también el proceso de la medición (5): comparten `data/harness.log`.)

### (5) Costo del ancla — un wake-up por minuto — `[no verificado]` como costo marginal

Proceso headless sin listeners en reposo, 130,0 s (`/proc/<pid>` de los 11 hilos; `CLK_TCK`=100):

```
00:02:57.369Z  cambios de contexto voluntarios 4359, involuntarios 5, CPU 92 ticks
00:05:07.394Z  cambios de contexto voluntarios 4644, involuntarios 5, CPU 100 ticks
delta: +285 voluntarios (~2,2/s), +0 involuntarios, +8 ticks = 0,08 s de CPU en 130 s (~0,06 %)
```
Observado: el proceso en reposo **no consume CPU apreciable**. **No** se puede aislar el aporte del ancla: los +285 cambios de
contexto son ruido de los 11 hilos de Node (libuv/V8) y un wake-up por minuto (~2 en la ventana) queda muy por debajo. El
costo marginal del ancla es `[no verificado]`; no se adorna.

### (6) Lo que sigue `[no verificado]` de la 5.1 y no cambia

- Punto (6) de la 5.1 en **terminal real interactiva** (Ink + Ctrl+C): pasos en `evidencia-manual.md`.
- Turno con **LLM real**; Ctrl+C (`SIGINT`) real sobre headless en **Windows**; `docker stop` / `stop_grace_period` reales (hijo 2).
- `npm test` en el **runner real de CI** (`ubuntu-latest`); acá solo se corrió en el contenedor.

## Estado final de los hallazgos de la 5.1

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| **H-1** | Un handler de señal no mantiene vivo el loop: headless sin listeners moría solo con exit 13 | **CERRADO** | Puntos (1) y (2); tests 25/25b/25c/25d + test 27; mutaciones M10/M11/M12 (`mutaciones-h1-h2.md`) |
| **H-2** | El test 3.7 fallaba en Linux (`SigCgt` ya viene puesto) | **CERRADO** (en contenedor; CI real `[no verificado]`) | Punto (3); test 26 + marcador `cierre-esperando-senal`; mutaciones M13/M14/M9 |
| **H-3** | `closeIdleConnections` es redundante en Node ≥ 20 | **DECLARADO** (sin cambio) | `evidencia-manual.md` H-3; spec "Límites declarados" |
| **H-4** | Ctrl+C en TUI con web tarda ~5 s | **DECLARADO** (preexistente, fuera de alcance) | `evidencia-manual.md` H-4 |
| **H-5** | `npm run start` no reenvía `SIGTERM` | **DELEGADO al hijo 2** (`CMD` = `node dist/main.js`); no se volvió a medir | `evidencia-manual.md` H-5 |

## Limpieza

Contenedor `harness-f6` eliminado (`docker rm -f`; sin volúmenes); la imagen `node:20-bookworm-slim` se conserva. Copia y scripts
auxiliares en el scratchpad de la sesión, fuera del repo. `git diff -- src` de esta tarea: vacío (los cambios de `src/` son los de 2.7a/3.7a/2.7b).
