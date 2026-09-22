# Evidencia de mutación — Fase 6, H-1 y H-2 (`modo-headless-cierre-limpio`, tarea 3.8a)

> Archivo NUEVO. `mutaciones-slice-b.md` **no se edita** (ya está commiteado): su M9 quedó declarada allí como *"no
> verificable en este entorno, pendiente de una corrida en Linux/CI"*, honesta y sin corregir. **Este archivo la
> salda** (ver M9 abajo). Origen de los hallazgos: [`evidencia-manual.md`](evidencia-manual.md) (tarea 5.1).

## Entorno y método

- Rama `hito/v3.17-modo-headless-cierre-limpio`, base `7e21a06`, 2026-09-21/22. Unit y wiring en **Windows 11 / Node
  24.14.1**; integración de proceso real en **contenedor `node:20-bookworm-slim` / Node 20.20.2 / Linux
  6.6.87.2-microsoft-standard-WSL2** (`npm ci` dentro; imagen ya descargada; contenedor eliminado al final).
- Cada mutación se aplicó sobre el working tree, se corrió `npm test -- proceso-cierre src/main.test.ts` (Windows) y
  `npx vitest run src/test/integration/cierre-headless.integration.test.ts` (Linux, con el archivo mutado copiado al
  contenedor), y se **revirtió**. Reversión verificada tras cada una con `cmp` byte a byte contra una copia previa y, al
  cierre, con `sha256sum` de `git diff -- src` **idéntico antes y después** de las seis (`fae6b09e...3c3ca`).
- Salidas crudas guardadas en el scratchpad de la sesión (`mut-M*-{win,linux}-raw.txt`); abajo, lo esencial.

## Rojo inicial

**2.7a** (Windows, antes de tocar producción) — `npm run typecheck` **exit 2**, 6 errores, y `npm test` en rojo:

```
src/main.test.ts(207,9), (216,9): TS2353 'armarAncla' does not exist in type 'Partial<ProcesoCierreDeps>'   (los dos wrappers del vi.mock)
src/proceso-cierre.test.ts(597,9), (737,9): TS2353 idem (los dos deps anotados)
src/proceso-cierre.test.ts(679,18), (685,49): TS2339 Property 'ANCLA_INTERVALO_MS' does not exist
$ npm test -- proceso-cierre        Tests 10 failed | 46 passed (56)   # los 46 previos, sin editar
$ npm test -- src/main.test.ts      Tests  1 failed | 58 passed (59)
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times          (test 25, 25b, wiring)
AssertionError: expected '/**\n * Ciclo de vida del PROCESO com…' not to contain 'unref'   (test 25c: el fuente TENÍA `unref` en dos comentarios)
AssertionError: expected [] to have a length of 1 but got +0                       (test 26, marcador)
```

Dos tests nacen VERDES y se declaran así: `(test 25b)` "finalizar sin esperarSenalDeCierre no toca el ancla" y
`(test 26)` "sin esperarSenalDeCierre no hay marcador" (comportamiento TUI vigente; son candados).

**3.7a** (Linux, contenedor, ANTES de 2.7b) — los DOS `it` rojos, con el mensaje de setup explícito y el hijo ya muerto:

```
$ npx vitest run src/test/integration/cierre-headless.integration.test.ts     (exit 1, 2026-09-21T23:50:34Z)
 × arranca headless, espera el marcador, recibe SIGTERM y sale 0 ...                                  1487ms
 × (test 27, H-1) headless SIN ningún listener NO termina por sí solo ...                              1213ms
Error: test setup error: el marcador cierre-esperando-senal nunca apareció en /tmp/arnes-headless-eiJ0Lt/data/harness.log:
       el proceso hijo terminó antes de publicarlo (exitCode 13, signalCode null)
Tests  2 failed (2)
```
En Windows (Node 24.14.1): `npm test -- cierre-headless` ⇒ `2 skipped`, typecheck sin errores en el archivo.

**Verde 2.7b** — mismo comando en Linux tras implementar: `Tests 2 passed (2)` (1430 ms y 3313 ms). `npm test` en Windows:
`3081 passed`; `rg "unref" src/proceso-cierre.ts` ⇒ sin coincidencias; `git diff -U0 -- src/main.ts` ⇒ un único hunk, de comentario.

## Mutaciones

### M10 (H-1) — no armar el ancla (`anclaHandle = undefined` en lugar de `armarAncla()`)

```
Windows: Tests 5 failed | 110 passed (115)
  × (test 25) ...   × (test 25b) finalizarCierreHeadless tras la señal ...   × (test 25d) ... default arma un intervalo real
  × (test 26) el marcador es lo ÚLTIMO del armado ...   × (test 25, wiring) ...            armarAncla: expected 1 call, got 0
Linux:   × (test 27, H-1) ...   AssertionError: expected 13 to be null        ← el hijo SE MURIÓ SOLO (exit 13)
         ✓ arranca headless, espera el marcador, recibe SIGTERM y sale 0 ...   (1319 ms)
```
Observación honesta: el primer `it` (test 15) sigue **verde** bajo M10: el `SIGTERM` llega ~20 ms después del marcador, antes
de que el hijo muera solo (~0,7 s). **Solo el test 27 atrapa H-1 a nivel proceso.**

### M11 (R31) — `.unref()` al ancla

```
Windows: Tests 1 failed | 114 passed (115)   × (test 25c, mecánico) AssertionError: expected '/**...' not to contain 'unref'
Linux:   × arranca headless, espera el marcador, ...   AssertionError: expected 13 to be +0
         × (test 27, H-1) ...                           AssertionError: expected 13 to be null
```
Es la mutación que prueba que "ref'd" no es decorativo: un ancla desreferenciada reproduce el exit 13. **Desvío respecto
del tasks.md** ("mismos dos rojos"): el **test 25 de unit NO se pone rojo** (verifica llamadas y handle, no la ref del
timer; con relojes falsos `vi.getTimerCount()` cuenta también un timer desreferenciado). La garantía la dan el 25c (fuente) y Linux.

### M12 (R31, modo simétrico) — no desarmar el ancla ni en la señal ni en `finalizarCierreHeadless`

```
Windows: Tests 6 failed | 109 passed (115)
  × (test 25) ... × (test 25b) ×2 ... × (test 25d): expected 2 to be 1 ... × (test 25, wiring): desarmarAncla not called with [{ancla:23}]
  × [EXISTENTE 2.6] finalizarCierreHeadless: ... sin timers pendientes   AssertionError: expected 1 to be +0   (vi.getTimerCount)
Linux:   ✓ ✓  Tests 2 passed (2)     ← NO se cuelga; ver el desvío
```
★ **Desvío que contradice al design/tasks**: la 3.8a prevé que en Linux el `it` de cierre *"se cuelga hasta el timeout
(proceso vivo con la base cerrada)"*. **No ocurre**: `finalizarCierreHeadless` termina en `salir(0)` = `process.exit(0)` real,
que mata el proceso aunque quede un ancla armada. El modo de falla simétrico de design §0.7b (propiedad 5) / R31 no es
alcanzable a nivel proceso con el `salir` real; el desarme del ancla queda protegido **solo por los tests unit y de wiring**
(que sí lo detectan, incl. un test previo de la 2.6 sin editar). Al Spec Author: ajustar la redacción de esa propiedad.

### M13 (H-2) — quitar el log `cierre-esperando-senal`

```
Windows: Tests 6 failed | 109 passed (115)   (5 de test 26 + el wiring)
Linux:   × ×  Tests 2 failed (2)   Duration 30.20s   (15.0 s de espera por cada it)
Error: test setup error: el marcador cierre-esperando-senal nunca apareció en /tmp/arnes-headless-CGf7e6/data/harness.log dentro de 15000 ms
```
Falla con **el mensaje de setup explícito**, no con un timeout mudo: evidencia de que (b) de la 3.7a está bien escrito.
(La mutación dejó en el fuente la línea de comentario `// (4) ÚLTIMA sentencia…`, sin efecto.)

### M14 (control de H-2) — restaurar el sondeo de `SigCgt` (el test de integración ORIGINAL de HEAD contra el fix)

```
Linux:   × arranca headless, recibe SIGTERM y sale 0 con el log de cierre completo ...   35 ms
         AssertionError: expected null to be +0     (Tests 1 failed (1), Duration 197ms)
```
Prueba directa de que el mecanismo viejo estaba roto **incluso con el producto arreglado** y el nuevo no: `SIGTERM` a los
~20 ms, `exitCode null` (el hijo murió por la señal).

### M9 (SALDADA) — quitar la rama headless de `main.ts` (dejar solo `startTui` + `waitUntilExit`)

```
Windows: Tests 30 failed | 85 passed (115)   (H1 escenarios 2-4, H2 ×8, H5, test 14, H3 ×3, ...)
Linux:   × ×  Tests 2 failed (2)
Error: test setup error: el marcador cierre-esperando-senal nunca apareció ...: el proceso hijo terminó antes de publicarlo (exitCode 1, signalCode null)
```
**Ahora SÍ ejecutada en Linux**: cierra el único hueco declarado de `mutaciones-slice-b.md`. Desvío menor: el rojo es
`exitCode 1` (Ink aborta por raw mode sin TTY antes del marcador), no el `exitCode null` por `SIGTERM` que preveía el tasks.md,
porque el test nuevo espera el marcador antes de mandar la señal.

## Cierre

- `git status` de `src/`: solo los archivos de las tareas 2.7a/3.7a/2.7b; **ninguna mutación quedó**. `cmp` idéntico de
  `proceso-cierre.ts`, `main.ts`, `proceso-cierre.test.ts`, `main.test.ts` y `cierre-headless.integration.test.ts` contra las copias base.
- **Suite tras las mutaciones (estado final)**: Windows `npm test` ⇒ `1 failed | 3081 passed | 5 skipped`, el fallo es
  `env-example.test.ts` (`HARNESS_A2A_ENTRANTE_HOST`, `WEB_HOST`, `WEBHOOK_HOST` sin documentar en `.env.example`: de las
  tareas 4.2/4.4/4.6, previo a esta fase); Linux ⇒ `cierre-headless.integration.test.ts (2 tests) ✓`, `proceso-cierre.test.ts
  (56) ✓`, `main.test.ts (59) ✓`, y `3 failed`: el mismo `env-example` y dos de `App.test.tsx` (TUI, intermitentes en el contenedor:
  fallan entre 2 y 4 tests distintos por corrida, también en la línea base previa a esta fase). **No se declara "verde completo"**.
