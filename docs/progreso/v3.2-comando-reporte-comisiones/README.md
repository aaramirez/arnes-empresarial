# comando-reporte-comisiones — tarea 7: verificación manual del entregable

**Alcance de este documento**: únicamente la tarea 7 de
[`openspec/changes/comando-reporte-comisiones/tasks.md`](../../../openspec/changes/comando-reporte-comisiones/tasks.md)
— **verificación manual del entregable**, excepción TDD explícita, sin
código de producción, cero commits de un agente (regla no negociable de
`AGENTS.md`: el commit/push los ejecuta siempre el humano). Las tareas 1-6
ya estaban implementadas y commiteadas antes de esta sesión. Esto **no** es
el cierre del hito: falta el paso del Reviewer (`sdd-verify` + `code-review`)
sobre este mismo change, tal como exige el ciclo de `AGENTS.md`.

**Entregable verificado**: el comando `/reporte-comisiones [periodo]` de la
TUI de empleado, cableado en `src/build-on-comando-empleado.ts`
(`manejarReporteComisiones`) y `src/core/commands/comando-empleado.ts`
(forma `id_opcional_periodo`), reusando las mismas funciones puras
(`agruparReporteMensual`/`formatearReporteMensual`, `src/core/ventas/reporte.ts`)
y el mismo store de solo lectura que ya usa `npm run reporte:mensual`
(`src/reporte-mensual.ts`, sin una sola línea tocada por este change).

## Metodología — mismo precedente que v1.4 (sin `tmux`/TTY real)

Este entorno (Windows + Git Bash/MINGW64) no tiene `tmux` para manejar una
TUI interactiva real, igual que documentó
[`docs/progreso/v1.4-tui-canal-empleado/README.md`](../v1.4-tui-canal-empleado/README.md).
Se siguió el mismo patrón: un driver throwaway in-process
(`scratch-verif-tarea7/driver.tsx`, **borrado al terminar**, no es parte del
entregable) que:

1. Abre **la base real del repo**, `data/harness.db` (con
   `openDatabase("data/harness.db")`, la MISMA función y el MISMO path que
   `main.ts`/`reporte-mensual.ts`/`empleados.ts`) — necesario porque
   `src/reporte-mensual.ts` tiene ese path hardcodeado y no es parametrizable
   (ADR 118 prohíbe tocarlo), y la tarea 7 exige comparar las dos vías **sobre
   la misma base**. Antes de tocarla se hizo `cp data/harness.db
   data/harness.db.bak-tarea7` (`data/*.db` está en `.gitignore`, confirmado
   con `git status --porcelain data/` antes de empezar: cero rastro en git) y
   al terminar se restauró con `mv data/harness.db.bak-tarea7
   data/harness.db` — ver la sección "Limpieza" más abajo, con los conteos de
   filas antes/después que confirman la restauración exacta.
2. Provisiona un empleado real con el **CLI real**, `npm run empleados:crear`
   (`tsx src/empleados.ts verif-tarea7`, contraseña por stdin, hash scrypt
   real vía `hashPassword`) — no una credencial insertada a mano.
3. Siembra **una venta confirmada con comisión en el período 2026-08** con
   los **casos de uso reales** (`src/build-on-venta.ts`'s `buildOnVenta` →
   `onAltaVenta` que envuelve `registrarVenta`, `src/core/ventas/registrar-venta.ts`,
   y `onDecisionVenta({decision:"confirmar"})` que envuelve
   `resolverDecisionVenta`, `src/core/ventas/confirmar-venta.ts`) — **cero
   `INSERT` manual**. `resolverDecisionVenta` calcula la comisión con
   `calcularComision` (`src/core/ventas/comision.ts`) y el período con
   `periodoDeConfirmacion(confirmedAt) = confirmedAt.slice(0,7)` — por eso el
   `now` de `buildOnVenta` se inyectó fijo en `"2026-08-15T10:00:00.000Z"`
   únicamente para esta siembra (mismo patrón de inyección de reloj que ya
   usa todo el resto del repo), de modo que la venta caiga exactamente en el
   período `2026-08` que pide la tarea.
4. Arma `buildOnComandoEmpleado` con el **mismo wiring real** que `main.ts`:
   `bootstrapHarness().hooks`, `resolveVentasConfig(process.env)`,
   `resolveAuthConfig(process.env)`, `verificarPassword`/`hashPassword`
   reales de `src/adapters/crypto/password.ts`. `onSubmit`/`onSoporte` se
   reemplazaron por stubs textuales (nunca invocados por
   `/reporte-comisiones`, que no delega a ninguno de los dos) — se documenta
   esto explícitamente para no insinuar que se ejercitó el camino
   conversacional, que está fuera del alcance de esta tarea.
   `reporteStore`/`credenciales`/`registro` **NO se inyectaron**: se usó el
   default real (closures sobre `db`, `src/build-on-comando-empleado.ts:664-680`),
   así el reporte lee de verdad vía SQL, igual que `reporte-mensual.ts`.
5. Monta `<App onSubmit={onComandoEmpleado} />` (el componente TUI real,
   `src/adapters/tui/App.tsx`) con **Ink real** (no `ink-testing-library`,
   que hardcodea `columns=100` sin forma de configurarlo — confirmado leyendo
   `node_modules/ink-testing-library/build/index.js`), sino `render` de
   `"ink"` directamente con un `stdout` falso de `columns`/`rows`
   configurables — **el mismo patrón que ya usa este repo**,
   `src/adapters/tui/App.test.tsx`, describe `"banner placement — real
   (non-debug) Ink render path"`, clase `FakeInkStdout`. Esto fue necesario
   para el punto R2 (medición de ancho a <80 columnas), que
   `ink-testing-library` no permite. Los comandos se envían con
   `stdin.write(texto)` + `stdin.write("\r")` (mismo mecanismo que una tecla
   Enter real) y se lee `stdout.writes.at(-1)` (el frame más reciente, en
   modo `debug: true` — equivalente de `lastFrame()`).
6. La función `onComandoEmpleado` pasada a `<App/>` es un wrapper de una
   sola línea sobre el handler real que además graba cada
   `(texto, TuiTurnResult)` en un array — sin alterar el comportamiento — para
   poder capturar el `responseText` exacto (bytes) de cada turno y compararlo
   después contra la salida de `npm run reporte:mensual`.

## Paso 1 — siembra real (casos de uso reales, `periodo` inyectado a `"2026-08"`)

```
Venta creada: {"ventaId":"80aeeea7-...","casoId":"7034aa56-...","linkConfirmacion":"http://localhost:0/confirmar/de47e5aa-...","notificado":false}
Decisión de venta: {"resultado":"confirmada","comisionMonto":32.15,"periodo":"2026-08"}
```

**Nota honesta de esta sesión**: el driver falló dos veces por un error de
JSX/tooling (`ReferenceError: React is not defined` al usar `<App .../>`
directo con `tsx` fuera de `src/`, que es lo único incluido en
`tsconfig.json`; se resolvió reemplazando el JSX por
`React.createElement(App, {...})`) **antes** de llegar al fix definitivo.
Cada intento fallido ya había corrido el Paso 1 (siembra) antes de fallar en
el paso siguiente — así que la corrida que sí llegó al final encontró **tres**
ventas ya sembradas bajo el mismo `vendedorId` (`vend-verif-tarea7`) en el
período `2026-08`, no una sola. Esto no invalida ningún criterio de la tarea
(sigue siendo 100% casos de uso reales, cero `INSERT` manual, mismo período),
solo explica por qué el reporte de abajo muestra "Ventas: 3" en vez de "1" —
se deja constancia en vez de maquillar el número.

## Guion paso a paso — resultado real

| # | Paso | Resultado |
|---|---|---|
| 1 | `/reporte-comisiones 2026-08` **sin sesión** | Rechazado: `"Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>."` — snapshot de `ventas`/`comisiones`/`casos`/`registro_acciones_empleado` **idéntico** antes/después (ver evidencia abajo) |
| 2 | `/login verif-tarea7 clave-verif-tarea7` | `"Sesión abierta como verif-tarea7. Vence 2026-09-11T04:29:12.023Z."` |
| 3 | `/reporte-comisiones 2026-08` **con sesión**, terminal ancha (100 cols) | Reporte completo, ver texto exacto abajo — fila nueva en `registro_acciones_empleado` (14→15) |
| 4 | `/reporte-comisiones 2026-13` **con sesión** | `"Periodo inválido. Formato esperado: YYYY-MM."` (mensaje propio, NO el molde `/ayuda` "Uso: ...") — filas de `registro_acciones_empleado` **sin cambio** (15→15) |
| 5 | `/reporte-comisiones` sin argumento, **con sesión** | `"Reporte de comisiones - periodo 2026-09"` — coincide con el mes corriente real de la máquina en el momento de la corrida (`new Date().toISOString().slice(0,7)`, reloj NO inyectado en `buildOnComandoEmpleado`) |
| 6 | `/reporte-comisiones 2026-08`, misma sesión, terminal angosta (60 cols) | Mismo contenido, renderizado con wrap (R2, ver abajo) |

## Evidencia — frames reales de la TUI (Ink real, terminal ancha 100 cols)

Paso 1 (sin sesión, rechazado):

```
[23:59:11] Vos: /reporte-comisiones 2026-08
sistema: Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>.
```

Paso 2 (login real):

```
[23:59:11] Vos: /login verif-tarea7 clave-verif-tarea7
sistema: Sesión abierta como verif-tarea7. Vence 2026-09-11T04:29:12.023Z.
```

Paso 3 (reporte válido, terminal ≥80 columnas — legible, una línea por fila):

```
[23:59:12] Vos: /reporte-comisiones 2026-08
sistema: Reporte de comisiones - periodo 2026-08

Vendedor                 Ventas Monto vendido Total comisionado Con reembolso
-----------------------------------------------------------------------------
Vendedora Verificacion Tarea7      3        964.50             96.45             0
-----------------------------------------------------------------------------
TOTAL                                                     96.45

Reembolsos pendientes de aprobación

Nota: estas escalaciones se resuelven con /aprobar-reembolso, /rechazar-reembolso y
/reabrir-reembolso desde la TUI local de empleados, tras iniciar sesión con /login. La contraseña se
 verifica localmente contra la misma base de datos que este proceso escribe.

(sin reembolsos pendientes)
```

Paso 4 (período malformado — mensaje propio, no el de `/ayuda`):

```
[23:59:12] Vos: /reporte-comisiones 2026-13
sistema: Periodo inválido. Formato esperado: YYYY-MM.
```

Paso 5 (sin argumento — mes corriente real):

```
[23:59:12] Vos: /reporte-comisiones
sistema: Reporte de comisiones - periodo 2026-09

sin comisiones en el periodo

Reembolsos pendientes de aprobación
...
(sin reembolsos pendientes)
```

## Evidencia — snapshot de "cero lecturas" sin sesión

```json
Snapshot antes:   {"ventas":9,"comisiones":3,"casos":57,"registro_acciones_empleado":13}
Snapshot después: {"ventas":9,"comisiones":3,"casos":57,"registro_acciones_empleado":13}
IGUALES: true
```

(Los valores base — 9/3/57 — ya incluyen las ventas sembradas por los dos
intentos fallidos del driver, ver la nota honesta del Paso 1; lo que importa
para este punto de la tarea es que el comando sin sesión no cambió **nada**
de esos cuatro conteos, lo cual se cumplió.)

## Evidencia — `registro_acciones_empleado` real (consulta SQL directa)

```json
[
  {
    "id": "19eb7006-69e5-4b37-a3d0-276d23f5877c",
    "empleado_id": "verif-tarea7",
    "comando": "/reporte-comisiones",
    "venta_id": null,
    "caso_id": null,
    "resultado": "atendida",
    "ocurrido_at": "2026-09-11T03:59:12.052Z"
  },
  {
    "id": "753772c3-f011-4012-bf48-8c515eb4584d",
    "empleado_id": "verif-tarea7",
    "comando": "/reporte-comisiones",
    "venta_id": null,
    "caso_id": null,
    "resultado": "atendida",
    "ocurrido_at": "2026-09-11T03:59:12.099Z"
  },
  {
    "id": "b48c6fef-d11c-465a-ac35-1ef29d1f27b2",
    "empleado_id": "verif-tarea7",
    "comando": "/reporte-comisiones",
    "venta_id": null,
    "caso_id": null,
    "resultado": "atendida",
    "ocurrido_at": "2026-09-11T03:59:12.176Z"
  }
]
```

Tres filas — una por cada comando `/reporte-comisiones` con período válido y
sesión vigente que se envió en el guion (pasos 3, 5 y 6; el período
malformado del paso 4 correctamente NO generó fila). `empleado_id` siempre
`"verif-tarea7"` (de la sesión), `resultado: "atendida"` (`RESULTADO_ATENDIDA`
reusado, ADR 122 — cero `RESULTADO_*` nuevo), `venta_id`/`caso_id` siempre
`NULL` (comando de solo lectura, sin venta ni caso asociado).

## Evidencia — comparación byte a byte contra `npm run reporte:mensual`

`npm run reporte:mensual -- --periodo 2026-08` corrido como **proceso
separado real** (no import, `tsx` invocado por `npm`), **sin ninguna sesión
de empleado**, sobre la misma `data/harness.db`, DESPUÉS de que el driver
cerró su handle (`db.close()` en el `finally`):

```
$ npm run reporte:mensual -- --periodo 2026-08

> arnes-empresarial@0.1.0 reporte:mensual
> tsx src/reporte-mensual.ts --periodo 2026-08

Reporte de comisiones - periodo 2026-08

Vendedor                 Ventas Monto vendido Total comisionado Con reembolso
-----------------------------------------------------------------------------
Vendedora Verificacion Tarea7      3        964.50             96.45             0
-----------------------------------------------------------------------------
TOTAL                                                     96.45

Reembolsos pendientes de aprobación

Nota: estas escalaciones se resuelven con /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso desde la TUI local de empleados, tras iniciar sesión con /login. La contraseña se verifica localmente contra la misma base de datos que este proceso escribe.

(sin reembolsos pendientes)
```

Comparación programática (Node, `===` sobre el string completo, banner de
`npm` y el `\n` final de `reporte-mensual.ts:98` recortados — la única
diferencia esperada y documentada por diseño, ADR 124: `formatearReporteMensual`
nunca agrega el `\n` final, es `reporte-mensual.ts` quien lo hace al escribir
a `stdout`) entre el `responseText` capturado del turno de la TUI (paso 3) y
el `stdout` real de `reporte:mensual`:

```
Longitud TUI: 749  Longitud CLI: 749
IDENTICOS BYTE A BYTE: true
```

Confirma en una corrida real, sobre la base real, el mismo Success Criteria
que `build-on-comando-empleado.test.ts` ya afirma con fixtures en memoria
(`proposal.md:227`).

`exit code` de `npm run reporte:mensual -- --periodo 2026-08`: `0`.

## Evidencia — medición de ancho (R2)

**≥80 columnas (100, legible)** — cada línea de la tabla (77 caracteres,
`SEPARADOR_WIDTH` de `reporte.ts`) entra sin cortarse en un ancho de
terminal de 100 columnas (ver el frame del paso 3 arriba: "Vendedor ...
Con reembolso" en una sola línea, "Nota: ..." en dos líneas solo porque el
texto de la nota en sí supera 100 caracteres, no por la tabla).

**<80 columnas (60, wrap documentado)** — mismo comando (`/reporte-comisiones
2026-08`), misma sesión (el closure de `sesion` persiste entre los dos
montajes de `<App/>`, ambos comparten la misma instancia del handler real),
terminal de 60 columnas:

```
[23:59:12] Vos: /reporte-comisiones 2026-08
sistema: Reporte de comisiones - periodo 2026-08

Vendedor                 Ventas Monto vendido Total
comisionado Con reembolso
------------------------------------------------------------
-----------------
Vendedora Verificacion Tarea7      3        964.50
   96.45             0
------------------------------------------------------------
-----------------
TOTAL
96.45

Reembolsos pendientes de aprobación

Nota: estas escalaciones se resuelven con
/aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso
 desde la TUI local de empleados, tras iniciar sesión con
/login. La contraseña se verifica localmente contra la misma
 base de datos que este proceso escribe.

(sin reembolsos pendientes)
```

Confirmado: a 60 columnas, Ink envuelve la fila del encabezado ("Total
comisionado" queda partido en dos líneas), la fila de separadores (77
guiones — parte en dos líneas de la terminal), la fila de datos, y la fila
`TOTAL` — exactamente el comportamiento que el README (tarea 5, ya
commiteada) documenta: *"El reporte usa un layout de 77 columnas fijas; en
terminales más angostas Ink lo envuelve línea por línea"*. `responseText` en
sí (el string que devuelve el handler) es **idéntico** en ambos casos — el
wrap es puramente de renderizado (Ink/Yoga), no del contenido.

**Cómo se obtuvo cada caso, con honestidad**: ninguno de los dos es una
terminal real con TTY (no disponible en este entorno) — ambos son Ink real
(`render` de `"ink"`, no un doble) montado sobre un `stdout` falso con
`columns` fijo (100 y 60 respectivamente), mismo mecanismo que
`src/adapters/tui/App.test.tsx` ya usa en su describe `"banner placement —
real (non-debug) Ink render path"`. `ink-testing-library` (la librería usada
para el resto del guion) fue investigada primero y descartada para este
punto específico: su `Stdout` interna hardcodea `columns` en `100`
(`node_modules/ink-testing-library/build/index.js:4-6`), sin ningún
parámetro para cambiarlo.

## Checklist de la tarea 7 — resultado punto por punto

| # | Punto (`tasks.md`, tarea 7) | Resultado |
|---|---|---|
| 1 | `/reporte-comisiones 2026-08` en TUI real vs. `npm run reporte:mensual -- --periodo 2026-08`, misma base, byte a byte | **VERDE** — `IDENTICOS BYTE A BYTE: true` (ver arriba) |
| 2 | Sin sesión, `/reporte-comisiones` pide `/login` sin lecturas | **VERDE** — snapshot de 4 tablas idéntico antes/después |
| 3 | Con sesión, período malformado responde mensaje de uso propio, sin fila | **VERDE** — `"Periodo inválido. Formato esperado: YYYY-MM."`, filas 15→15 |
| 4 | Con sesión, sin argumento, reporta el mes corriente real | **VERDE** — `"periodo 2026-09"`, coincide con el reloj real de la máquina al momento de la corrida |
| 5 | Fila real en `registro_acciones_empleado` confirmada por SQL directo | **VERDE** — 3 filas, `resultado: "atendida"`, `venta_id`/`caso_id` `NULL` |
| 6 | `npm run reporte:mensual` en proceso separado, sin sesión, sin tocar código, sigue funcionando | **VERDE** — `exit code 0`, salida idéntica a la de la TUI |
| 7 | Medición de ancho R2: ≥80 (legible) y <80 (wrap documentado) | **VERDE** — ambos frames capturados y documentados arriba, con nota honesta del método |
| 8 | `rg 'id_opcional_periodo' src/` — un solo lugar del parser | **VERDE** — ver detalle abajo |
| 9 | `git diff --stat main -- src/adapters/` vacío | **VERDE** — output vacío, confirmado |
| 10 | `npm test` y `npm run typecheck` en verde, `reporte-mensual.test.ts` sin modificar | **VERDE** — ver detalle abajo |

### Punto 8 — `rg 'id_opcional_periodo' src/`

```
src/core/commands/comando-empleado.test.ts:488:    expect(descriptores[14]).toMatchObject({ nombre: "/reporte-comisiones", forma: "id_opcional_periodo" });
src/core/commands/comando-empleado.ts:94: * `"id_opcional_periodo"` (ADR 119, `comando-reporte-comisiones`) es el
src/core/commands/comando-empleado.ts:105:  | "id_opcional_periodo";
src/core/commands/comando-empleado.ts:265:    forma: "id_opcional_periodo",
src/core/commands/comando-empleado.ts:410:    // "id_opcional_periodo" ("reporte_comisiones") sale gratis de `as const
src/core/commands/comando-empleado.ts:405:  if (descriptor.forma === "id_opcional_periodo")
```

Todas las apariciones caen en `comando-empleado.ts` (tipo, descriptor,
comentarios) y en su propio test — la Forma se **consume** (rama de parseo
real, `if (descriptor.forma === "id_opcional_periodo")`) en un único lugar
del parser (`parsearComando`, línea 405). Ningún otro archivo de `src/`
referencia la Forma.

### Punto 9 — `git diff --stat main -- src/adapters/`

```
$ git diff --stat main -- src/adapters/
(sin salida)
```

Cero archivos de `src/adapters/` tocados por este change — confirma el
Resumen de arquitectura de `design.md` §1 (el comando se resuelve enteramente
en `src/core/` + `src/build-on-comando-empleado.ts`, sin nuevo código de
adaptador).

### Punto 10 — `npm test` / `npm run typecheck`

```
$ npm test
 Test Files  114 passed | 1 skipped (115)
      Tests  1904 passed | 3 skipped (1907)
   Duration  7.83s

$ npm run typecheck
(sin salida — cero errores de tipos)

$ git diff --stat main -- src/reporte-mensual.ts
(sin salida)
```

`reporte-mensual.test.ts` corrió sin modificar (confirmado por el `git diff
--stat` vacío sobre `src/reporte-mensual.ts`, ADR 118) y está incluido en los
114 archivos/1904 tests en verde de arriba.

## Limpieza

- `scratch-verif-tarea7/` (driver, logs y capturas intermedias) —
  **borrado por completo** al terminar, `rm -rf scratch-verif-tarea7`.
- `data/harness.db`: respaldada ANTES de cualquier escritura
  (`data/harness.db.bak-tarea7`) y restaurada al terminar
  (`mv data/harness.db.bak-tarea7 data/harness.db`). Confirmado con conteos
  de filas antes de tocarla / después de restaurarla:

  | Tabla | Antes de esta sesión (post-restauración) |
  |---|---|
  | `ventas` | 6 |
  | `comisiones` | 0 |
  | `casos` | 54 |
  | `registro_acciones_empleado` | 13 |
  | `credenciales_empleado` | 2 |

  Estos valores coinciden exactamente con lo esperable de deshacer las 3
  ventas + 3 comisiones + 3 casos sembrados por los tres intentos del driver
  (9→6, 3→0, 57→54) y el empleado `verif-tarea7` provisionado por
  `empleados:crear` (3→2 credenciales) — la restauración fue exacta, no
  aproximada.
- `git status` al final de la sesión: árbol de trabajo limpio salvo los tres
  `openspec/changes/*` ya untracked antes de empezar esta tarea (no creados
  ni tocados por esta verificación).
- **Cero `git add`/`git commit`/`git push` ejecutados por este agente**,
  conforme a la regla no negociable de `AGENTS.md`.

## Hallazgos para el humano antes de cerrar el hito

1. **Ninguna discrepancia funcional.** Los 10 puntos de la tarea 7 dieron
   verde. `manejarReporteComisiones` es efectivamente síncrono y de solo
   lectura — en ningún momento de esta sesión se invocó el SDK de Claude ni
   se consumió API real (los stubs de `onSubmit`/`onSoporte` nunca se
   ejercitaron, porque `/reporte-comisiones` no delega a ninguno de los dos).
2. **Dato operativo, no un defecto**: por el orden en que se depuró el driver
   (dos fallas de tooling de JSX antes del fix), el reporte de evidencia de
   este documento muestra 3 ventas agregadas bajo un mismo vendedor en vez de
   1 — ver la nota honesta del Paso 1. No afecta ningún criterio de
   aceptación (sigue siendo agregación real sobre datos reales, sin `INSERT`
   manual), y de cualquier modo quedó completamente revertido al restaurar
   `data/harness.db` desde el backup.
3. **Pendiente explícito, no de esta tarea**: falta el paso del Reviewer
   (`sdd-verify` + `code-review`) sobre este change completo — este documento
   cubre exclusivamente la tarea 7 (verificación manual), no el checklist de
   cierre de hito completo de `AGENTS.md`.

## Mensaje de commit sugerido (lo ejecuta el humano)

Rama: `hito/v3.2-comando-reporte-comisiones`

```
docs: evidencia de verificacion manual del entregable reporte-comisiones (comando-reporte-comisiones, tarea 7)
```
