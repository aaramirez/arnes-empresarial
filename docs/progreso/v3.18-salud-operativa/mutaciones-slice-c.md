# Evidencia de mutación manual — Slice C (`salud-operativa`, tarea 3.8)

Change: [`salud-operativa`](../../../openspec/changes/salud-operativa/) · PR #3 (Slice C, tareas 3.1-3.8).
Metodología: TDD estricto (`strict_tdd: true`). Cada mutación se aplicó sobre `src/main.ts`, se corrió el comando indicado, se pegó la salida roja abajo y se **revirtió** antes de seguir. `git diff -- src/main.ts` quedó idéntico al estado de la tarea 3.5 en cada punto de control (verificado con `git diff` después de cada reversión).

## M1 — quitar la guarda `if (opsServidor !== undefined)` pone rojo el candado 3.6(a) (S12)

**Mutación**: en el `finally` de `src/main.ts`, quitar el `if (opsServidor !== undefined) { ... }` que envuelve el cierre de `ops`, dejando el `try`/`catch` interno intacto pero llamando a `opsServidor.close()` **incondicionalmente**:

```diff
-  if (opsServidor !== undefined) {
-    try {
-      await opsServidor.close();
-    } catch (error) {
-      console.error(`No se pudo cerrar el listener de salud: ${toErrorMessage(error)}`);
-    }
-  }
+  try {
+    await opsServidor.close();
+  } catch (error) {
+    console.error(`No se pudo cerrar el listener de salud: ${toErrorMessage(error)}`);
+  }
```

**Efecto colateral en `npm run typecheck`** (ROJO de tipo, adicional a la evidencia de test): con la guarda afuera, `opsServidor` (`OpsAdapter | undefined`) ya no está narrowed en el punto de la llamada:

```
src/main.ts(822,11): error TS18048: 'opsServidor' is possibly 'undefined'.
```

**Hallazgo durante la mutación**: la primera versión de esta evidencia usaba el test 3.6(a) tal como se declaró originalmente (sin verificar `stderr`), y esa mutación **NO** lo ponía en rojo — sin `OPS_PORT`, `opsServidor` es `undefined` en runtime, así que `opsServidor.close()` lanza un `TypeError` síncrono ("Cannot read properties of undefined (reading 'close')") que el `catch` de al lado **atrapa y traga silenciosamente**, sin que ningún doble de `ops.close` llegue a invocarse (no hay ninguno en ese escenario: nunca se configura). El test original solo verificaba el orden de los otros tres `close()` y que `startOpsServer` había resuelto `undefined`, ninguno de los cuales cambia con esta mutación. Se **fortaleció 3.6(a)** agregando un espía sobre `console.error` que confirma que el mensaje `"No se pudo cerrar el listener de salud"` **nunca** aparece cuando `OPS_PORT` está deshabilitado — esa es la señal observable real de que la guarda faltante intentó cerrar algo que no existe.

**Comando**: `npx vitest run src/main.test.ts -t "tarea 3.6"`

**Resultado**: ROJO —

```
 ❯ src/main.test.ts (69 tests | 1 failed | 65 skipped) 2563ms
     × (a, S12) sin OPS_PORT: orden exacto web.close, webhook.close, a2a.close, db.close; startOpsServer devuelve undefined y ops.close 0 llamadas 1486ms

 FAIL  src/main.test.ts > main.ts -- candado: orden de cierre de hoy sin OPS_PORT y cero funciones extraídas del finally (salud-operativa, tarea 3.6) > (a, S12) sin OPS_PORT: orden exacto web.close, webhook.close, a2a.close, db.close; startOpsServer devuelve undefined y ops.close 0 llamadas
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/main.test.ts:2317:7

 Test Files  1 failed (1)
      Tests  1 failed | 3 passed | 65 skipped (69)
```

**Conclusión**: el candado 3.6(a) detecta correctamente la guarda faltante — el mensaje `"No se pudo cerrar el listener de salud"` aparece en `stderr` cuando no debería (nadie configuró `OPS_PORT`, así que `opsServidor` nunca debió intentarse cerrar). Además, `npm run typecheck` por sí solo ya habría bloqueado esta mutación con un error de tipo, antes de llegar a correr ningún test. **Revertido** — `git diff -- src/main.ts` idéntico al estado de la tarea 3.5 tras la reversión; `npm run typecheck` y la suite completa vuelven a verde.

---

## M2 — extraer el arranque de `ops` a `function arrancarOps()` — el candado que realmente lo detecta es el del hijo 1 (tarea 3.2), no 3.6(c)

**Mutación**: extraer el bloque de arranque de `ops` (declaración + `try`/`catch`) a una función `async function arrancarOps(): Promise<OpsAdapter | undefined>`, invocada inline:

```diff
-let opsServidor: OpsAdapter | undefined;
-try {
-  opsServidor = await startOpsServer({
-    salud: { estaCerrando: () => false, baseUtilizable: () => true, listenersCaidos: () => 0 },
-    logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
-  });
-} catch (error) {
-  logTurnEvent(OPS_LOG_CORRELATION_ID, "ops-arranque-fallido", { message: toErrorMessage(error) });
-  opsServidor = undefined;
-}
+async function arrancarOps(): Promise<OpsAdapter | undefined> {
+  try {
+    return await startOpsServer({
+      salud: { estaCerrando: () => false, baseUtilizable: () => true, listenersCaidos: () => 0 },
+      logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
+    });
+  } catch (error) {
+    logTurnEvent(OPS_LOG_CORRELATION_ID, "ops-arranque-fallido", { message: toErrorMessage(error) });
+    return undefined;
+  }
+}
+const opsServidor: OpsAdapter | undefined = await arrancarOps();
```

`npm run typecheck`: **verde** (esta mutación no rompe ningún tipo).

**Hallazgo durante la mutación**: el candado 3.6(c) que se declaró en la tarea 3.6 solo escanea el tramo `bloqueEntre(source, "} finally {", "\n}\n")` — el arranque de `ops` vive **antes** del `finally` (entre el bloque A2A y el `try` de la TUI/headless), así que esta mutación concreta **NO** lo pone en rojo (verificado: los 4 tests de la tarea 3.6 siguen en verde con la mutación aplicada). La cobertura real de "cero funciones extraídas en TODO el composition root desde el wiring de A2A hasta el final del archivo" ya la tiene el candado **preexistente del hijo 1** (`modo-headless-cierre-limpio`, tarea 3.2, test "(c) no se extraen funciones nuevas desde el bloque final del composition root hasta el final del archivo"), cuya ancla (`"const a2aEntrante"` hasta el final del archivo) sí incluye el punto de inserción de `ops`. Es la regla dura transversal de `tasks.md` ("ninguna tarea extrae funciones de main.ts", R4) la que efectivamente protege esta mutación, no el candado más angosto de la tarea 3.6.

**Comando**: `npx vitest run src/main.test.ts` (suite completa del archivo, no solo `-t "tarea 3.6"`, precisamente porque el candado relevante vive en otro `describe`)

**Resultado**: ROJO —

```
 ❯ src/main.test.ts (69 tests | 1 failed) 16297ms
     × (c) no se extraen funciones nuevas desde el bloque final del composition root hasta el final del archivo 5ms

 FAIL  src/main.test.ts > main.ts -- candados de no-fuga de listeners, finally intacto y cero funciones extraidas (modo-headless-cierre-limpio, tarea 3.2) > (c) no se extraen funciones nuevas desde el bloque final del composition root hasta el final del archivo
AssertionError: expected 'const a2aEntrante = buildOnA2AEntrant…' not to match /\bfunction\s+\w+/

- Expected:
/\bfunction\s+\w+/

+ Received: (incluye la línea "async function arrancarOps(): Promise<OpsAdapter | undefined> {" dentro del tramo escaneado)

 Test Files  1 failed (1)
      Tests  1 failed | 68 passed (69)
```

**Conclusión**: la extracción de funciones en el composition root SÍ se detecta y pone la suite en rojo, pero por el candado del hijo 1 (tarea 3.2), de alcance más amplio, no por el candado 3.6(c) declarado en esta tarea (que solo cubre el tramo del `finally`). Se documenta como hallazgo en vez de agregar un test redundante: la regla R4 ("ninguna tarea extrae funciones de `main.ts`") ya tiene guarda de test suficiente sin necesidad de ampliar 3.6(c). **Revertido** — `git diff -- src/main.ts` idéntico al estado de la tarea 3.5 tras la reversión; `npm run typecheck` y la suite completa (69/69 de este archivo, 3156/3156 del repo) vuelven a verde.

---

## Rojo inicial declarado (TDD estricto, §11.1 del design)

### Tarea 3.1 — `src/adapters/ops/index.test.ts` (ROJO de TIPO)

Antes de crear `src/adapters/ops/index.ts`:

- `npm run typecheck` → `src/adapters/ops/index.test.ts(5,32): error TS2307: Cannot find module './index.js' or its corresponding type declarations.`
- `npx vitest run src/adapters/ops/index.test.ts` → falla al COLECTAR el archivo (0 tests recolectados): `Error: Cannot find module './index.js' imported from .../src/adapters/ops/index.test.ts`.

### Tarea 3.4 — `src/main.test.ts` extendido (ROJO de ASERCIÓN)

Contra `main.ts` **sin** el cableado de la tarea 3.5 (verificado reproduciendo el estado con `git stash push -- src/main.ts`, corriendo la suite, y restaurando con `git stash pop`): los 6 `it` nuevos de la tarea 3.4 fallan, cada uno por una razón distinta y correcta —

```
 ❯ src/main.test.ts (69 tests | 6 failed | 49 skipped) 15876ms
     × (i, S10) startOpsServer se invoca 1 vez y DESPUÉS que web/webhook/a2a; un rechazo con EADDRINUSE no aborta el arranque 256ms
     × (ii, H3' NUEVO 1/S11) orden exacto web -> webhook -> a2a -> ops -> db, una vez cada uno, SALIR 0 tras db.close 5002ms
     × (iii, H3' NUEVO 3) un ops.close() que rechaza no impide db.close(): se reporta y sigue, SALIR 0 5001ms
     × (iv, S8+H8) un ops.close() colgado ... se fuerza a los 5000 ms sin agotar el techo global de 70000 ms 484ms
     × (iv, S11) en TUI el orden es el mismo con waitUntilExit() resuelto y SALIR 0 llamadas ... 294ms
     × (v, S12) web.close, webhook.close, a2aServidor.close, opsServidor.close y db.close en ese orden estrictamente creciente 1ms
```

- **(i)**: `expected "vi.fn()" to be called 1 times, but got 0 times` — `startOpsServer` nunca se invoca (no hay cableado todavía).
- **(ii)** y **(iii)**: `Error: Test timed out in 5000ms` — sin cableado, el orden de cierre nunca llega a `ops.close`, así que el `esperarHasta` que lo espera se cuelga.
- **(iv, S8+H8)**: `expected "close" to not be called at all, but actually been called 1 times` — sin `ops` en el `finally`, `db.close()` corre de inmediato (antes de t=4999 ms), evidenciando exactamente lo que este change viene a corregir: sin el listener de salud en su posición, el drenaje no tiene ninguna barrera extra antes de la base.
- **(iv, S11 TUI)**: `expected "vi.fn()" to be called 1 times, but got 0 times` — `ops.close` nunca se invoca en el camino TUI tampoco.
- **(v, S12)**: `expected -1 to be greater than 441` — el fuente de `main.ts` todavía no contiene `opsServidor.close()` en el tramo del `finally`.

`npm run typecheck` contra este mismo estado: **verde** (task 3.4 es rojo de ASERCIÓN, no de tipo — los módulos de `ops` ya existen desde la tarea 3.2, y `main.test.ts` importa `./adapters/ops/index.js`/`./adapters/ops/config.js` directamente, no a través de `main.ts`).

## Consolidación de las cuatro mutaciones de S22

| # | Mutación | Requirement | Resultado |
|---|---|---|---|
| M1 | Quitar la guarda `if (opsServidor !== undefined)` del `finally` | S12 | ✅ ROJO confirmado arriba (3.6(a), fortalecido con espía de `stderr`) — más `npm run typecheck` en rojo de tipo |
| M2 | Extraer el arranque de `ops` a `function arrancarOps()` | S12 | ✅ ROJO confirmado arriba (candado preexistente del hijo 1, tarea 3.2 — no 3.6(c), ver hallazgo) |
| M3 | Import cruzado `../web/config.js` en `ops/server.ts` | S5 | ✅ ROJO confirmado en [`mutaciones-slice-b.md`](./mutaciones-slice-b.md) |
| M4 | Race adentro del callback de `server.close()` | S8 | ✅ ROJO (cuelga) confirmado en [`mutaciones-slice-b.md`](./mutaciones-slice-b.md) |

Las cuatro mutaciones de S22 quedan con evidencia roja confirmada y reversión verificada (`git diff -- src/` vacío en cada punto de control de este documento). `git status` sin cambios en `src/` al momento de commitear esta evidencia.
