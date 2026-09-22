# Matriz criterio → evidencia — `modo-headless-cierre-limpio` (tarea 5.2)

> Transcripción fiel de `tasks.md` (tarea 5.2, requirement H12 de `specs/modo-headless-proceso/spec.md`), con las filas
> nuevas de la Fase 6 copiadas literalmente de su tabla y redactadas con lo medido (errata del 2026-09-21). **No modifica**
> `evaluacion/08-evaluacion-empresarial.md` — el tutor juzga el verde.

## Matriz por criterio

| Criterio | Sub-caso | Evidencia (test o evidencia manual con fecha) |
|---|---|---|
| **C7** | Cierre por `SIGTERM`/`SIGINT` | tarea 3.4 (rojo), tarea 3.6 (verde, wiring en `main.test.ts`), tarea 3.7 (integración proceso real), tarea 5.1 (evidencia manual, 2026-09-21) |
| **C7** | `unhandledRejection`/`uncaughtException` con log + `exit(1)` sin matar Vitest | tarea 2.4 (rojo), tarea 3.4 puntos iii-iv |
| **C7** | Presupuesto configurable con default finito, los tres techos de 5 s intactos | tarea 2.1 (constantes/resolvers), tarea 3.4 punto v |
| **R1** | Turno irreversible deja su fila antes de `db.close()` | tarea 3.5, tarea 5.1 (evidencia manual, punto 2 y 4) |
| **R1** | Vencimiento del presupuesto queda registrado (pérdida no silenciosa) | tarea 3.5 punto ii |
| **D4** | Headless sin TTY y sin Ink | tarea 3.3, tarea 5.1 (evidencia manual, punto 1) |
| **D4** | Script `start` sobre `dist` | tareas 1.6-1.7, tarea 5.1 |
| **D4** | `build` sin `*.test.js` y `typecheck` que sigue viendo los tests | tareas 1.6, 1.8, corrida de CI |
| **D4** | `*_HOST` opcional con default sin `host` | tareas 4.1 / 4.3 / 4.5 |
| **D4** | `HARNESS_DB_PATH` en los cuatro sitios | tareas 1.4-1.5 |

## Transversales

| Transversal | Evidencia |
|---|---|
| Byte-equivalencia sin `HARNESS_HEADLESS`, cero listeners nuevos | tarea 3.2a |
| `git diff` de `main.ts` y anclas `bloqueEntre` intactas | tareas 3.6 / 3.9 |
| Las seis variables en `.env.example` | tareas 1.3, 2.3, 4.2, 4.4, 4.6 |
| `src/core` sin adaptadores | verificación de cierre (H11), regla dura (f) |
| `AGENTS.md` / arc42 / `evaluacion/08` fuera del diff | verificación de cierre (H11) |
| Cero migraciones / cero dependencias nuevas | verificación de cierre (H11) |
| `npm test` + `npm run typecheck` | verificación de cierre de cada PR |
| ★ Candado `git diff` de v3.7 acotado, no apagado | tarea 4.2a + mutación M-C6 (tarea 4.7); `src/adapters/board/` y `src/core/config/env.ts` siguen vigilados |

## Filas NUEVAS de la Fase 6 (redactadas con lo medido)

| Criterio | Evidencia que SÍ lo cubre | Lo que NO lo cubre (y hay que escribirlo) |
|---|---|---|
| **C7/D4 — headless sin ningún listener queda vivo (H1 ampliado, H-1)** | **test 27** de proceso real en Linux (tarea 3.7a) · evidencia manual `5.1a` puntos (1) y (2), con tiempos y códigos · mutación **M10** (tarea 3.8a) | ★ **El test 15 NO lo cubre**: bajo M10 queda **VERDE** (el `SIGTERM` llega ~20 ms después del marcador, antes de la muerte a ~0,7 s) |
| **R31 (a) — el ancla es ref'd** | **test mecánico 25c** (`unref` ausente del fuente, corre en todas las plataformas) · mutación **M11** en **Linux** (los dos `it` rojos) | ★ **El test 25 de unit NO lo cubre**: con relojes falsos `vi.getTimerCount()` cuenta también un timer desreferenciado |
| **R31 (b) — el ancla se desarma** | tests **unit y de wiring**: 25, 25b, 25d, el espía de `desarmarAncla` de `main.test.ts` y el **preexistente de la 2.6** (`getTimerCount() === 0`) · mutación **M12** (6 rojos en Windows) | ★ **Ningún test de proceso lo cubre, y no puede**: con el `salir` real (`process.exit(0)`) el proceso **no se cuelga** aunque el ancla siga armada (M12 ⇒ **verde en Linux**) |
| **C7 — marcador `cierre-esperando-senal` (H13, H-2)** | **test 26** (tarea 2.7a) · la espera por marcador de 3.7a · mutaciones **M13** (falla con mensaje de setup explícito) y **M14** (el sondeo viejo de `SigCgt` sigue roto con el producto ya arreglado) | — |
| **Transversal — la suite corre de verdad en Linux** | `5.1a` punto (3): `cierre-headless.integration.test.ts` **EJECUTADO** y verde (2/2) en contenedor `node:20-bookworm-slim` | ★ **`[no verificado]` en el runner real de `ubuntu-latest`** · ★ **"suite completa verde en Linux" NO se afirma** (ver límites) |

★ **Regla nueva**: un `skipIf` de plataforma no cuenta como verificado hasta correrlo ahí.

## Límites declarados

| Límite | Detalle |
|---|---|
| Ventana previa al registro | `main.ts` tiene cuatro `await` de nivel de módulo antes del bloque final; una señal que llegue antes de que la rama headless registre sus handlers recibe el comportamiento por defecto de Node (sin `db.close()`). Se acepta y se documenta |
| `*_HOST` inválido | Deja el proceso vivo sin ese listener (comportamiento vigente, no lo cambia esta spec); ahora garantizado también sin ningún listener habilitado (H-1 cerrado) |
| Log a `data/harness.log` | El destino del logger no cambia; en headless el operador no lo ve por stdout hasta el hijo 6. El marcador `cierre-esperando-senal` también va solo al archivo |
| Señales reales solo fuera de Windows | En Windows (Node 24.14.1) `child.kill("SIGTERM")` termina el proceso sin ejecutar ningún handler; el cierre ordenado por señal solo es verificable fuera de Windows |
| `uncaughtException` sin cierre ordenado | La política no invoca ningún `close`/`db`; R27, decisión discutible declarada |
| `stop_grace_period` del supervisor | Debe ser **estrictamente mayor** que `HARNESS_SHUTDOWN_TIMEOUT_MS` (R24); ~90 s con el default de 70 s |
| `closeIdleConnections` redundante en Node ≥ 20 | Medido en Node v20.20.2 y v24.14.1: `server.close(cb)` con un ocioso llama al callback a 1 ms con y sin el fix (H-3). Se conserva como candado de intención, no como mejora medible |
| Ctrl+C en TUI con web tarda ~5 s | H-4, preexistente, no instrumentado, fuera de alcance |
| `npm run start` no reenvía `SIGTERM` | H-5: `npm` muere con 143 y `node dist/main.js` queda huérfano, vivo y sin cierre ordenado. Contrato con el hijo 2: el `CMD`/`ExecStart` debe ser `node dist/main.js` directo. El script `start` de `package.json` no cambia |
| Costo del ancla | Un wake-up por minuto en headless; costo marginal `[no verificado]` (medido: sin consumo de CPU apreciable en 130 s, sin poder aislar el aporte del ancla del ruido de los 11 hilos de Node) |
| No desarmar el ancla no cuelga el proceso | M12: con el `salir` real (`process.exit(0)`), no desarmar el ancla **no cuelga** el proceso; la consecuencia real es un intervalo de 60 s huérfano, protegido solo por tests unit/wiring |
| Flaky preexistente de `src/adapters/tui/App.test.tsx` en contenedor Linux | 2-4 tests distintos por corrida, ya en la línea base previa a la Fase 6, ajeno a este change. Por eso el criterio de cierre es "el test de integración ejecutado y verde", no "suite completa verde en Linux" |
| Incidente de proceso de `.env.example` | Los commits 4.2/4.4/4.6 salieron sin las filas de `WEB_HOST`, `WEBHOOK_HOST` y `HARNESS_A2A_ENTRANTE_HOST`; `env-example.test.ts` quedó rojo hasta un commit de corrección aparte. No es un límite del producto, es del proceso, y contamina toda medición de suite tomada en esa ventana |

## Qué se daba por cubierto y NO lo estaba hasta la Fase 6

Antes de la Fase 6, **C7** (cierre por señal en headless) y **D4** (arranque headless sin TTY que "queda vivo") se daban por
cubiertos con la implementación de las tareas 2.1-2.7/3.1-3.9, pero el proceso headless **sin ningún listener habilitado
moría solo con exit 13 en ~0,7-1,0 s sin una línea `cierre-*`** (H-1), y el test de integración de la tarea 3.7 **fallaba en
Linux** por un sondeo inválido de `SigCgt` (H-2) — ninguno de los dos hallazgos era observable en Windows, donde el
test se salteaba. Recién con el ancla ref'd (2.7b) y el marcador `cierre-esperando-senal` (H13) quedaron cerrados.
