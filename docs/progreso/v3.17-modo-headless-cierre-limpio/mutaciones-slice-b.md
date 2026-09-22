# Evidencia de mutación — Slice B (`modo-headless-cierre-limpio`, tarea 3.8)

> Generado en la corrida de Fase 3 (tareas 3.1-3.7), sobre la rama
> `hito/v3.17-modo-headless-cierre-limpio`. Cada mutación se aplicó,
> se corrió el test afectado (salida ROJA pegada tal cual), y se
> **revirtió** antes de seguir — `git status` confirma `src/` limpio al
> cerrar esta tarea.

## Rojo inicial

### Fase 2 (tareas 2.1, 2.4, 2.6) — sesión previa

El rojo inicial de estas tres tareas quedó documentado en su propio ciclo
TDD (test-first: commit `test` en rojo, seguido del commit `feat` en
verde), en los commits:

- `1604934` — tarea 2.1 (`esModoHeadless`/`resolvePresupuestoCierreMs`): rojo de tipo, `src/proceso-cierre.ts` no existía todavía.
- `bee43cb` — tarea 2.4 (`manejarErrorNoCapturado`): rojo de tipo, la función no estaba exportada.
- `9bfecd5` — tarea 2.6 (`esperarSenalDeCierre`/`finalizarCierreHeadless`): rojo de tipo, ídem.

**Nota honesta**: esta corrida (Fase 3) no re-ejecutó esos rojos línea por
línea porque hacerlo exigiría revertir código ya mergeado en la propia
rama y volver a aplicarlo — un riesgo innecesario sobre trabajo ya
verificado en su momento. Se referencian por commit en vez de pegar una
salida no verificada en esta sesión. La garantía de fondo (que esos tres
rojos existieron y llevaron a un verde) queda sostenida por el propio
historial de `git log` de la rama, que la orden de tareas exige preservar
(commit ROJO → commit VERDE, sin squash).

### Fase 3 (tareas 3.3, 3.4, 3.5) — esta sesión, salida real

Antes de cablear `main.ts` (tarea 3.6), `npm test -- main` mostraba (salida
real, resumida a los conteos — el detalle completo de cada aserción está
en el historial de esta sesión):

```
# tras la tarea 3.3 (H1, H2, H5-iii, test 14):
Tests  13 failed | 27 passed (40)

# tras la tarea 3.4 (+ H3, H4, H6, H7, H8):
Tests  26 failed | 28 passed (54)

# tras la tarea 3.5 (+ H9):
Tests  29 failed | 29 passed (58)
```

Ejemplos representativos de las aserciones rojas (pegadas tal cual salieron):

```
FAIL src/main.test.ts > main.ts -- arranque headless y TUI (...) > (H2) HARNESS_HEADLESS="true" falla cerrado...
AssertionError: expected undefined to be an instance of Error

FAIL src/main.test.ts > main.ts -- ... > (test 14) el tramo del try final headless contiene esModoHeadless...
Error: ancla de inicio no encontrada en main.ts:
try {
  if (esModoHeadless

FAIL src/main.test.ts > main.ts -- cierre por señal y fallas no capturadas (...) > (H3) SIGTERM: orden estricto...
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

FAIL src/main.test.ts > main.ts -- R1: turno irreversible en vuelo al recibir SIGTERM (...) > (H9, escenario 2)...
AssertionError: expected "vi.fn()" to be called with arguments: [ 1 ]
Number of calls: 0
```

Tras la tarea 3.6 (cableado real de `main.ts`): `npm test -- main` → **58
passed (58)**, sin editar ninguna aserción de 3.3/3.4/3.5 (confirmado por
`git diff -U0 -- src/main.test.ts`: los únicos hunks posteriores a la tarea
3.5 son la corrección de un solo test — `H9 escenario 1`, que necesitaba
capturar el conteo de filas EN el momento de `db.close()`, no después, un
detalle de la técnica de test, no del código de producción).

## Mutaciones

Cada una: cambio aplicado → test afectado corrido → salida ROJA pegada →
revertido. `git status` sin cambios en `src/` al cerrar esta tarea.

### M1 (R18) — registrar un `process.on("SIGTERM")` al nivel del módulo de `main.ts`

Cambio: agregar `process.on("SIGTERM", () => {});` justo debajo del import
de `./proceso-cierre.js`.

```
FAIL  src/main.test.ts > main.ts -- candados de no-fuga de listeners... > (a, R18/H5) importar main.js seis veces...
AssertionError: expected { SIGTERM: 1, SIGINT: +0, …(2) } to deeply equal { SIGTERM: +0, SIGINT: +0, …(2) }
- Expected
+ Received
  {
    "SIGINT": 0,
-   "SIGTERM": 0,
+   "SIGTERM": 1,
    ...
  }
```

Revertido: `git diff -- src/main.ts` vacío tras deshacer.

### M2 (R4) — extraer una `function shutdown()` del bloque final

Cambio: agregar `function shutdown(): void {}` justo después de `const
a2aEntrante = buildOnA2AEntrante(...)`.

```
FAIL  src/main.test.ts > ... > (c) no se extraen funciones nuevas desde el bloque final...
AssertionError: expected ... to match ... — el `not.toMatch(/\bfunction\s+\w+/)` encuentra "function shutdown"
```

Revertido.

### M3 — reordenar dos `close()` del `finally`

Cambio: invertir el orden textual de los bloques `if (web !== undefined)`
y `if (webhook !== undefined)` en el `finally`.

```
FAIL  src/main.test.ts > ... > (b, R4) el finally queda intacto: los cuatro close() en el orden del ADR 10
AssertionError: expected 65 to be greater than 255
```

(el índice de `webhook.close()` quedó ANTES que el de `web.close()`)

Revertido.

### M4 — cambiar el ancla del `try` (`if (esModoHeadless` → otra)

Cambio: `if (esModoHeadless())` → `if(esModoHeadless())` (sin espacio):
rompe la cadena literal que busca `bloqueEntre`.

```
FAIL  src/main.test.ts > ... > (test 14) el tramo del try final headless contiene esModoHeadless...
Error: ancla de inicio no encontrada en main.ts:
try {
  if (esModoHeadless
```

Revertido.

### M5 (R1) — bajar `DEFAULT_SHUTDOWN_TIMEOUT_MS` a `15_000` en `proceso-cierre.ts`

```
FAIL  src/proceso-cierre.test.ts > ... > DEFAULT_SHUTDOWN_TIMEOUT_MS es 70000 y es estrictamente mayor que 55500 (H9)
AssertionError: expected 15000 to be 70000

FAIL  src/main.test.ts > ... > (H9, escenario 3) DEFAULT_SHUTDOWN_TIMEOUT_MS es estrictamente mayor que 55500...
AssertionError: expected 15000 to be greater than 55500
```

Además, la corrida completa de ambos archivos mostró **15 tests en rojo**
(los que dependen del default de 70 000 ms: los escenarios de `H8` en
`main.test.ts` y `proceso-cierre.test.ts`, y `H9` escenario 2).

Revertido.

### M6 — quitar el `try/catch` alrededor de `logEvent` en `manejarErrorNoCapturado`

```
FAIL  src/proceso-cierre.test.ts > manejarErrorNoCapturado (...) > si logEvent lanza, igual se invoca escribirError y salir(1)
AssertionError: expected [Function] to not throw an error but 'Error: logger roto' was thrown
```

Revertido.

### M7 — quitar la fijación `HARNESS_HEADLESS="0"` de `beforeEach` (tarea 3.1) y un `.env` del dev con `HARNESS_HEADLESS=1`

★ **Desvío de técnica, declarado**: no se pudo reproducir contra el `.env`
real del repo (lectura y escritura bloqueadas por la política de permisos
de este entorno — es un archivo de configuración local del desarrollador).
En su lugar se reprodujo el MECANISMO exacto en aislamiento (mismo patrón
que ya usa `adapters/memory/config.test.ts` para su escenario `.env`-only:
`mkdtemp` + `.env` propio + `process.chdir`), invocando `loadDotenv()` de
`dotenv` dos veces sobre el mismo `process.env`:

```
Antes de loadDotenv(): undefined
Despues de loadDotenv() (mutado, SIN fijar '0'): "1"
MUTACION CONFIRMADA: dotenv rellenó HARNESS_HEADLESS=1 desde el .env del dev.
Con la fijacion de 3.1 (process.env.HARNESS_HEADLESS = '0' ANTES de loadDotenv()): "0"
```

Esto confirma el mecanismo exacto que motiva la tarea 3.1 (R26): sin la
fijación, `dotenv` rellena `HARNESS_HEADLESS` desde un `.env` del
desarrollador aunque el `beforeEach` la haya borrado — el efecto real
sobre `main.test.ts` sería que las seis importaciones de `main.js` entrarían
en modo headless y la promesa de arranque nunca resolvería, colgando la
suite hasta el timeout de Vitest (5000 ms por test × las decenas de tests
que importan `main.js` en este archivo). El script de reproducción se
ejecutó y se borró en el acto; no dejó archivos en el repo (`git status`
limpio).

### M8 — no desarmar el watchdog en `finalizarCierreHeadless`

Cambio: comentar la línea `depsCompletas.desarmarTimer(watchdogHandle);`.

```
FAIL  src/proceso-cierre.test.ts > ... > finalizarCierreHeadless: desarma el watchdog (handle intacto)...
AssertionError: expected 1 to be +0 // Object.is equality
```
(`vi.getTimerCount()` seguía en 1 tras `finalizarCierreHeadless()`: el
watchdog quedó armado.)

Revertido.

### M9 (test de integración, tarea 3.7) — no verificable en este entorno

El sondeo de `/proc/<pid>/status` que usa
`src/test/integration/cierre-headless.integration.test.ts` es Linux-only;
este entorno de ejecución es Windows (`describe.skipIf(process.platform
!== "linux")`, confirmado: el test se SALTEA limpio, `1 skipped`, sin
fallar `npm test`). La mutación M9 ("quitar la rama headless de `main.ts`
⇒ el test de integración pasa a ver `exitCode: null`, matado por el
comportamiento por defecto de `SIGTERM`") **no pudo ejecutarse ni
verificarse en esta sesión** — queda pendiente de una corrida en Linux/CI.
Es la única mutación de esta lista sin evidencia directa.

## Cierre

- `git status` sin cambios en `src/` al momento de este commit (todas las
  mutaciones fueron revertidas antes de seguir).
- `npm test` verde: 3015 passed, 4 skipped (incluye el nuevo test de
  integración de la tarea 3.7, salteado en Windows).
- `npm run typecheck` y `npm run build` verdes.
