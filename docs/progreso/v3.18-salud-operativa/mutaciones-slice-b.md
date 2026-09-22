# Evidencia de mutación manual — Slice B (`salud-operativa`, tarea 2.6)

Change: [`salud-operativa`](../../../openspec/changes/salud-operativa/) · PR #2 (Slice B, tareas 2.1-2.6).
Metodología: TDD estricto (`strict_tdd: true`). Cada mutación se aplicó, se corrió el comando indicado, se pegó la salida roja abajo y se **revirtió** antes de seguir. `git status`/`git diff -- src/` quedó vacío en cada punto de control.

## M3 — import cruzado a `web/config.ts` pone rojo el candado estructural (S5)

**Mutación**: agregar `import { resolveWebConfig } from "../web/config.js";` a `src/adapters/ops/server.ts` (línea 21, entre `node:http` y las importaciones de `./config.js`).

**Comando**: `npm test -- arquitectura`

**Resultado**: ROJO — 2 de 5 tests de `arquitectura.test.ts` fallan:

```
 ❯ src/adapters/ops/arquitectura.test.ts (5 tests | 2 failed) 11ms
     × todo especificador de import de las fuentes no-test es relativo ./..., o node:http, o ../../core/config/env.js SOLO en config.ts 6ms
     × ningun import apunta a ../web, ../webhooks, ../a2a, ../memory, ni a un ../../core/** distinto del env.js citado 1ms

 FAIL  src/adapters/ops/arquitectura.test.ts > ... > todo especificador de import de las fuentes no-test es relativo ./..., o node:http, o ../../core/config/env.js SOLO en config.ts
AssertionError: import inesperado "../web/config.js" en server.ts: expected false to be true

 FAIL  src/adapters/ops/arquitectura.test.ts > ... > ningun import apunta a ../web, ../webhooks, ../a2a, ../memory, ni a un ../../core/** distinto del env.js citado
AssertionError: server.ts importa de otro adaptador via "../web/config.js": expected true to be false

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

**Conclusión**: el candado de `arquitectura.test.ts` (S5, tarea 2.5) detecta correctamente un import cruzado hacia otro adaptador. **Revertido** — `git diff -- src/adapters/ops/server.ts` vacío tras la reversión.

---

## M4 — mover el race ADENTRO del callback de `server.close()` cuelga el test de la divergencia (S8)

**Mutación**: en el `close()` de `src/adapters/ops/server.ts`, mover la construcción del `techo` (el `Promise.race` contra `OPS_CLOSE_TIMEOUT_MS`) de **afuera** de `server.close(cb)` a **adentro** del callback `cb` — exactamente el molde de `web/server.ts`, `webhooks/server.ts:301-321` y `a2a/server.ts:877-902`, donde el race corre dentro del callback para acotar el drenaje de un `Set<Promise>` de turnos huérfanos.

**Comando**: `npx vitest run ops/server --testTimeout=3000 -t "el techo corta"` (se acotó el timeout a 3000 ms para no colgar la sesión; el test real corre con el timeout por defecto de vitest, 5000 ms, y el resultado es el mismo: nunca resuelve).

**Resultado**: ROJO (por timeout, no por aserción — es la evidencia misma de la divergencia) — el test `startServer — close() corta ociosas y acota server.close() ENTERO a 5000 ms (S8) > el techo corta un server.close() cuyo callback NUNCA llega (prueba de la divergencia deliberada)` **se cuelga**:

```
 ❯ src/adapters/ops/server.test.ts (27 tests | 1 failed | 26 skipped) 3009ms
     × el techo corta un server.close() cuyo callback NUNCA llega (prueba de la divergencia deliberada) 3008ms

 FAIL  src/adapters/ops/server.test.ts > startServer — close() corta ociosas y acota server.close() ENTERO a 5000 ms (S8) > el techo corta un server.close() cuyo callback NUNCA llega (prueba de la divergencia deliberada)
Error: Test timed out in 3000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".

 Test Files  1 failed (1)
      Tests  1 failed | 26 skipped (27)
```

**Por qué cuelga, no solo falla una aserción**: el doble de `SERVIDOR` en este test nunca invoca el callback de `server.close(cb)` (a propósito — es la "prueba de la divergencia"). Con el race adentro del callback, el código que arma el `techo` **nunca se ejecuta**, porque vive dentro de un callback que jamás llega. No hay ningún temporizador que pueda vencer: la promesa de `close()` queda pendiente para siempre. Es la confirmación literal de lo que dice el doc-comment de `server.ts` (§0.4/§4.4 del diseño): *"con el molde de los otros tres (race adentro), este escenario NO termina"*.

**Conclusión**: la divergencia deliberada (race ENVOLVIENDO `server.close()` entero, no su callback) no es un descuido — es la única forma de que `OPS_CLOSE_TIMEOUT_MS` tenga efecto cuando el callback de `close()` puede colgarse. **Revertido** — `git diff -- src/adapters/ops/server.ts` vacío tras la reversión.

---

## Rojo inicial declarado (TDD estricto, §11.1 del design)

### Tarea 2.1 — `server.test.ts` (ROJO de TIPO)

Antes de crear `src/adapters/ops/server.ts`:

- `npm run typecheck` → `src/adapters/ops/server.test.ts(4,90): error TS2307: Cannot find module './server.js' or its corresponding type declarations.`
- `npm test -- ops/server` → falla al COLECTAR el archivo (0 tests recolectados): `Error: Cannot find module './server.js' imported from .../src/adapters/ops/server.test.ts`.

### Tarea 2.3 — `server.test.ts` extendido (ROJO de ASERCIÓN)

Contra el stub de `close()` de la tarea 2.2 (sin `closeIdleConnections`, sin techo):

```
 ❯ src/adapters/ops/server.test.ts (27 tests | 2 failed) 5032ms
     × closeIdleConnections se llama 1 vez y ANTES que close 5ms
     × el techo corta un server.close() cuyo callback NUNCA llega (prueba de la divergencia deliberada) 5012ms

AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  (closeIdleConnections nunca invocado por el stub)

Error: Test timed out in 5000ms.
  (el stub no tiene techo propio: sin server.close callback, la promesa jamás resuelve)

 Test Files  1 failed (1)
      Tests  2 failed | 25 passed (27)
```

Los otros dos casos de la tarea 2.3 (cierre normal, nunca rechaza) ya pasaban contra el stub — coherente: el stub delega en `server.close(cb)` sin agregar ningún comportamiento propio, así que esos dos escenarios (que no dependen del techo ni de `closeIdleConnections`) son verdaderos por construcción trivial. Los dos que SÍ importan (orden de `closeIdleConnections` y el techo de 5000 ms) fallaron, que es la señal real de que faltaba implementación.

## Consolidación de las cuatro mutaciones de S22

| # | Mutación | Requirement | Resultado |
|---|---|---|---|
| M1 | Quitar la guarda `if (opsServidor !== undefined)` del `finally` | S12 | Pendiente — PR #3 (tarea 3.8) |
| M2 | Extraer el arranque de `ops` a `function arrancarOps()` | S12 | Pendiente — PR #3 (tarea 3.8) |
| M3 | Import cruzado `../web/config.js` en `ops/server.ts` | S5 | ✅ ROJO confirmado arriba |
| M4 | Race adentro del callback de `server.close()` | S8 | ✅ ROJO (cuelga) confirmado arriba |

M1 y M2 corresponden al slice C (`main.ts`, PR #3) y se documentan en `mutaciones-slice-c.md` cuando ese PR se ejecute — no forman parte del alcance de este PR #2.
