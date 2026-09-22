# Matriz criterio → evidencia — `salud-operativa` (tarea 4.12, S22a)

Change: [`salud-operativa`](../../../openspec/changes/salud-operativa/) · PR #4 (Slice D). Una fila por cada criterio de **O6**, **D7-parcial** y cada transversal de `tasks.md`, apuntando a un test concreto o a evidencia manual con fecha. No modifica `evaluacion/08-evaluacion-empresarial.md` (tarea gateada ADR 247): el tutor juzga el verde de la suite y esta matriz es solo un mapa de navegación.

## O6 — el proceso reporta si está vivo y si se le puede mandar tráfico, sin terceros, desde el instante de la señal

| Criterio | Evidencia (test o manual) |
|---|---|
| `503` desde el INSTANTE de la señal, antes del primer `close()` | `src/main.test.ts`, tarea 4.7, test `★★ (ii, S17, O6) 200 antes de la señal; 503 cerrando en el MISMO tick de SIGTERM...` |
| Sin consultar terceros (Claude/GitHub/`graphify`/A2A saliente), sin I/O propia | `src/adapters/ops/arquitectura.test.ts` (candado 2.5, extendido en 4.1 para `readiness.ts`) + `src/adapters/ops/readiness.test.ts` (tarea 4.1, "readiness.ts no tiene ninguna línea de import") |
| Listener HABILITADO caído vs. DESHABILITADO a propósito | `src/main.test.ts`, tarea 4.7, describe `(iii, S18, R35) listener %s habilitado y caído vs. deshabilitado` (×3 adaptadores) + `evidencia-manual.md` Escenario 2 (2026-09-22 04:34 UTC, `curl` real: `503 listener`) |
| Liveness (`/salud/vivo`) responde sin consultar el `OpsSaludPort` | `src/adapters/ops/server.test.ts`, describe `"GET/HEAD /salud/vivo responde 200 constante sin consultar el PUERTO (S6)"` (tarea 2.1/2.2) + `evidencia-manual.md` Escenario 2 (`/salud/vivo` sigue `200` con `web` caído) |

## D7-parcial — el endpoint de salud es invocable y ocupa su lugar en el orden de arranque/cierre

| Criterio | Evidencia |
|---|---|
| Endpoint invocable (`GET`/`HEAD` responden, aridad de `listen`) | `src/adapters/ops/server.test.ts`, describe `"OPS_HOST y la aridad de listen (S3)"` (tarea 2.1) |
| `ops` en su posición del ADR 10 (`web → webhook → a2a → ops → db`) | `src/main.test.ts`, tarea 3.4, test `(ii, H3' NUEVO 1/S11) orden exacto web -> webhook -> a2a -> ops -> db...` |

## Transversales

| Criterio | Evidencia |
|---|---|
| Respuestas sin datos (vocabulario cerrado de 3 palabras, sin dígitos/`/`/`:`, sin nombre de listener) | `src/adapters/ops/server.test.ts`, describe `"barrido mecanico de vocabulario cerrado y headers (S7)"` — extendido con las 4 palabras de readiness desde 2.1/2.2 (ya presentes en `CUERPOS_PERMITIDOS`); confirmado con mutación M6 en `mutaciones-slice-d.md` (nombrar un listener pone el barrido en rojo) |
| `src/adapters/ops/` sin imports de otro adaptador, de `core/` (salvo `env.js` en `config.ts`), ni de `node:fs`/`node:https`/`node:net` | `src/adapters/ops/arquitectura.test.ts` (tarea 2.5, extendido en 4.1 para `readiness.ts`) |
| Dos variables nuevas documentadas en `.env.example` (`OPS_PORT`, `OPS_HOST`) | tarea 1.3 (PR #1, fuera de esta fase) — sin cambios en esta fase |
| `git diff` de `main.ts` en CINCO puntos exactos, anclas `bloqueEntre` intactas | `src/main.test.ts`, tarea 4.8, aceptación verificada manualmente vía `git diff -U0 -- src/main.ts` (hunks en líneas 71, 334-352, 559, 717-744 — ninguno en 660-690, el tramo de las seis anclas) + candado preexistente del hijo 1 (`bloqueEntre`, `main.test.ts:660-690`) sin editar |
| `AGENTS.md`, `docs/ARC42_Harness_Empresarial.md`, `evaluacion/08-evaluacion-empresarial.md` fuera del diff (ADR 247, gateada) | `git status`/`git diff --stat` de esta fase: ninguno de los tres archivos aparece — verificado en la tarea 4.13 |
| Cero migraciones, cero dependencias nuevas | `git diff --stat -- package.json src/adapters/memory/migrate.ts` vacío — verificado en 4.13 |
| `npm test` + `npm run typecheck` en verde | Verificado tras cada tarea de esta fase (4.1-4.9); consolidado en 4.13 (`3202/3207` tests, `2` skipped preexistentes, `0` fallos) |

## Límites declarados (no son incumplimientos — están documentados en el código/design)

| Límite | Dónde está declarado |
|---|---|
| TUI nunca emite `503 cerrando` (el listener muere en el mismo `finally`, antes de `db.close()`; el observable es `ECONNREFUSED`, no `503`) | `design.md` §6.5; `src/proceso-cierre.ts` doc-comment de `estaCerrando()`; `src/main.test.ts` tarea 4.7 test `(v, test 21)` (cero listeners de señal en TUI) |
| Sin autenticación en `/salud/*` (R34) | `openspec/changes/salud-operativa/design.md` §7.1 (`OPS_HOST` + compose es la mitigación de red, no auth) |
| Sonda de base SÍNCRONA, costo sobre el event loop no medido (K5, insumo de N2) | `design.md` §7.4; comentario en `src/main.ts` sobre `sondaBase` |
| Ventana de arranque: `ECONNREFUSED` entre `docker start` y el `listen` de `ops` (R43, dependencia hacia el hijo 2 — `start_period` del compose) | `design.md` §7.3 ("por qué el arranque va DESPUÉS del bloque A2A") |
| `OpsSaludPort` que lanza no está cubierto por un mapeo a `503` (S-f) — `main.ts` garantiza que la sonda no lanza y las otras dos son triviales | `tasks.md`, "Supuestos pendientes" #7; `src/adapters/ops/server.ts` doc-comment de `responderListo` |
| `SIGTERM` real no verificable con `curl` en Windows sin contenedor/VM Linux (K3 depende del mismo escenario) | `evidencia-manual.md`, Escenario 3 y K3 |
| Un listener que arrancó bien y DESPUÉS dejó de responder no se detecta — "caído" ≡ "el arranque de ese listener lanzó" (S18), sin sondeo posterior | `design.md` §0.3 |
| Un fallo de la sonda de base EN RUNTIME (`sondaBase.get()` lanza durante un `/salud/listo`, no en el arranque) no deja ningún rastro de log — `design.md` §5.5 justifica "no loguear ninguna request" citando que la causa ya está logueada por quien la produce para `cerrando`/`listener`, pero no cita un evento equivalente para el motivo `base`; el arranque fallido de `db` SÍ queda cubierto por `ops-arranque-fallido`, esto es específicamente el caso runtime | `design.md` §5.5; `src/main.ts`, closure `baseUtilizable` |
