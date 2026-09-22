# Evidencia de mutación manual — Slice D (`salud-operativa`, tarea 4.10)

Change: [`salud-operativa`](../../../openspec/changes/salud-operativa/) · PR #4 (Slice D, tareas 4.1-4.13).
Metodología: TDD estricto (`strict_tdd: true`). Cada mutación se aplicó sobre el archivo indicado, se corrió el comando indicado, se pegó la salida roja abajo y se **revirtió** antes de seguir (`git diff --stat` verificado idéntico al estado post-4.9 en cada punto de control).

## M5 — reemplazar la sonda de `baseUtilizable` por `() => db.open` (S19) — ★ HALLAZGO, no se puso rojo

**Mutación**, en `src/main.ts`, dentro del bloque de arranque de `ops`:

```diff
-      baseUtilizable: () => {
-        try {
-          sondaBase.get();
-          return true;
-        } catch {
-          return false;
-        }
-      },
+      baseUtilizable: () => db.open,
```

**Comando**: `npx vitest run src/main.test.ts -t "tarea 4.9"`

**Resultado**: **VERDE** (no se puso rojo) —

```
 RUN  v4.1.11 ...
 Test Files  1 passed (1)
      Tests  1 passed | 84 skipped (85)
```

**Hallazgo**: el candado 4.9 solo ejercita el escenario "base cerrada por completo" (`db.close()`), y `Database.prototype.open` de `better-sqlite3` SÍ pasa a `false` en ese caso puntual — por eso `db.open` "acierta" en este escenario concreto y el candado no distingue la mutación. Esto **confirma exactamente la advertencia textual de `tasks.md`** ("`db.open` no detecta…"): `db.open` **no es una lectura real del catálogo** (S19) y **no cubre** el escenario que sí motiva la sonda — una base *abierta* pero *bloqueada/ocupada* (`SQLITE_BUSY`/`SQLITE_LOCKED`), donde `db.open` seguiría siendo `true` mientras `sondaBase.get()` lanzaría. Ese escenario alternativo **sí** está cubierto, y en rojo confirmado durante el desarrollo (no como mutación sino como test directo), por el test de la tarea 4.7 "(iv, S19) get() que lanza Error('locked') ⇒ baseUtilizable() false SIN propagar, y 503 base" — ese test SÍ falla si `baseUtilizable` se cambia a `() => db.open` (verificado: con la mutación aplicada, `db.open` es `true` incluso con el `get()` espiado para lanzar, así que la aserción `expect(salud.baseUtilizable()).toBe(false)` de ese test falla). Se documenta como hallazgo, no se agrega una tarea nueva (fuera de alcance de esta fase): la distinción entre "conexión abierta" y "catálogo consultable" es precisamente la razón de ser de S19, y el candado 4.9 por sí solo no la agota — la cobertura completa vive repartida entre 4.7 (el caso bloqueado) y 4.9 (el caso cerrado).

**Revertido** — `git diff --stat -- src/main.ts` idéntico al estado post-4.9; `npm run typecheck` y la suite completa vuelven a verde.

---

## M6 — cuerpo `503 web` (nombre de listener) en vez de `listener` (S7) — ROJO confirmado

**Mutación**, en `src/adapters/ops/server.ts`, función `responderListo`:

```diff
-  res.end(conCuerpo ? (motivo ?? CUERPO_LISTO) : undefined);
+  res.end(conCuerpo ? (motivo === "listener" ? "web" : (motivo ?? CUERPO_LISTO)) : undefined);
```

**Comando**: `npx vitest run ops/server`

**Resultado**: ROJO —

```
 ❯ src/adapters/ops/server.test.ts (34 tests | 2 failed) 26ms
     × cada hecho por separado (listenersCaidos) ⇒ 503 con el motivo correspondiente 5ms
     × todo cuerpo producido por la suite pertenece al vocabulario cerrado, sin digitos, '/' ni ':' 2ms

 FAIL  ... > cada hecho por separado (listenersCaidos) ⇒ 503 con el motivo correspondiente
AssertionError: expected 'web' to be 'listener' // Object.is equality

 FAIL  ... > todo cuerpo producido por la suite pertenece al vocabulario cerrado, sin digitos, '/' ni ':'
AssertionError: expected false to be true // Object.is equality
(CUERPOS_PERMITIDOS.has("web") es false)

 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
```

**Conclusión**: DOS candados independientes detectan la fuga de un nombre de listener en el cuerpo: (a) la aserción puntual del escenario S15 ("cada hecho por separado") que espera el motivo literal `"listener"`, y (b) el barrido mecánico de vocabulario cerrado (S7) que recorre TODO cuerpo observado por la suite entera y confirma que `"web"` no pertenece al conjunto permitido. La restricción de no-filtración (S16: "`listenersCaidos()` devuelve un número, nunca nombres") queda protegida en dos capas: el TIPO (no hay forma de que el número traiga un nombre) y, si alguien lo escribiera a mano en el handler (como esta mutación), el barrido de vocabulario lo atrapa igual. **Revertido** — `git diff --stat -- src/adapters/ops/server.ts` idéntico al estado post-4.4; `npm run typecheck` y la suite completa (`ops/server`, 34/34) vuelven a verde.

---

## Rojo inicial declarado (TDD estricto, tareas 4.1, 4.3, 4.5, 4.7)

### Tarea 4.1 — `src/adapters/ops/readiness.test.ts` (nuevo) + `arquitectura.test.ts` (extendido) — ROJO de TIPO

Antes de crear `src/adapters/ops/readiness.ts`:

```
npm run typecheck:
src/adapters/ops/readiness.test.ts(14,49): error TS2307: Cannot find module './readiness.js' or its corresponding type declarations.
src/adapters/ops/readiness.test.ts(15,34): error TS2307: Cannot find module './readiness.js' or its corresponding type declarations.

npx vitest run readiness arquitectura:
 ❯ src/adapters/ops/readiness.test.ts (0 test)
 ❯ src/adapters/ops/arquitectura.test.ts (6 tests | 1 failed)
     × readiness.ts no tiene ninguna línea de import (S5, S14, slice D)
 FAIL  src/adapters/ops/readiness.test.ts [ src/adapters/ops/readiness.test.ts ]
Error: Cannot find module './readiness.js' imported from .../src/adapters/ops/readiness.test.ts
 Test Files  2 failed (2)
      Tests  1 failed | 5 passed (6)
```

### Tarea 4.3 — `src/adapters/ops/server.test.ts` (extendido) — ROJO de ASERCIÓN

Contra `server.ts` sin la rama `RUTA_LISTO` (todavía cae al `default` del `switch`, `404`):

```
npx vitest run ops/server:
 Test Files  1 failed (1)
      Tests  8 failed | 26 passed (34)
```

Los 8 fallos: los escenarios de "todo sano ⇒ 200", "cada hecho por separado ⇒ 503", "varios hechos a la vez", "HEAD /salud/listo", "misma terna de headers" y "OpsServerDeps.salud requerido" — todos esperaban `200`/`503` y recibían `404`. `npm run typecheck`: verde (rojo de aserción puro, no de tipo).

### Tarea 4.5 — `src/proceso-cierre.test.ts` (extendido) — ROJO de TIPO

Antes de agregar `estaCerrando()` a `src/proceso-cierre.ts`:

```
npm run typecheck:
src/proceso-cierre.test.ts(817,18): error TS2339: Property 'estaCerrando' does not exist on type '... "src/proceso-cierre" ...'.
(10 ocurrencias más, una por cada uso nuevo de mod.estaCerrando en la suite)

npx vitest run proceso-cierre:
 FAIL  src/proceso-cierre.test.ts > ... > estaCerrando() ... > importar el módulo y llamar estaCerrando() NO toca process...
TypeError: mod.estaCerrando is not a function
 Test Files  1 failed (1)
      Tests  8 failed | 56 passed (64)
```

`git diff -- src/proceso-cierre.test.ts`: 146 líneas, **0 líneas removidas** (solo adiciones — los tests vigentes del hijo 1 no se editaron).

### Tarea 4.7 — `src/main.test.ts` (extendido, describes nuevos AL FINAL) — ROJO de ASERCIÓN

Contra el stub inerte de la tarea 3.5 (`estaCerrando: () => false, baseUtilizable: () => true, listenersCaidos: () => 0`, sin los tres hechos reales todavía inyectados):

```
npx vitest run src/main.test.ts:
 ❯ src/main.test.ts (84 tests | 9 failed)
     × (i, S16) deps.salud tiene EXACTAMENTE estaCerrando, baseUtilizable y listenersCaidos...
     × ★★ (ii, S17, O6) 200 antes de la señal; 503 cerrando en el MISMO tick de SIGTERM...
     × (iii, S18, R35) listener web habilitado y caído vs. deshabilitado > lanza al arrancar...
     × (iii, S18, R35) listener webhook habilitado y caído vs. deshabilitado > lanza al arrancar...
     × (iii, S18, R35) listener a2a habilitado y caído vs. deshabilitado > lanza al arrancar...
     × (iii, S18) dos caídos (web y a2a) suman: listenersCaidos()=2
     × (iv, S19) db.prepare se invoca 1 vez con el SQL de la sonda...
     × (iv, S19) get() que lanza Error('locked') ⇒ baseUtilizable() false SIN propagar...
     × (iv, S19) db.prepare que LANZA Error('closed') al arrancar...
 Test Files  1 failed (1)
      Tests  9 failed | 75 passed (84)
```

`npm run typecheck`: verde (rojo de aserción puro). Las variantes "deshabilitado sin lanzar" y "los tres deshabilitados" y el test 21 (TUI) **nacen en verde** contra el stub por coincidencia (el stub ya devuelve `listenersCaidos: () => 0` y `estaCerrando: () => false` constantes) — no invalida el rojo: son observables que, por diseño, deben seguir siendo ciertos DESPUÉS de 4.8 también, y de hecho lo son (verificado tras 4.8, suite completa 85/85 verde). `git diff -U0 -- src/main.test.ts` de esa tarea: un solo hunk, `@@ -2411,0 +2412,412 @@`, íntegro AL FINAL del archivo, sin tocar ninguna de las seis anclas `bloqueEntre` (líneas 660-690).

---

## Consolidación de las cuatro mutaciones de S22 (referencia)

| # | Mutación | Requirement | Resultado |
|---|---|---|---|
| M1 | Quitar la guarda `if (opsServidor !== undefined)` del `finally` | S12 | ✅ ROJO confirmado en [`mutaciones-slice-c.md`](./mutaciones-slice-c.md) |
| M2 | Extraer el arranque de `ops` a `function arrancarOps()` | S12 | ✅ ROJO confirmado en [`mutaciones-slice-c.md`](./mutaciones-slice-c.md) (vía el candado preexistente del hijo 1, hallazgo declarado) |
| M3 | Import cruzado `../web/config.js` en `ops/server.ts` | S5 | ✅ ROJO confirmado en [`mutaciones-slice-b.md`](./mutaciones-slice-b.md) |
| M4 | Race adentro del callback de `server.close()` | S8 | ✅ ROJO (cuelga) confirmado en [`mutaciones-slice-b.md`](./mutaciones-slice-b.md) |

Las cuatro mutaciones de S22 quedan con evidencia roja confirmada y reversión verificada en sus respectivos documentos. Las dos mutaciones ADICIONALES de esta fase (M5, M6 — propuestas de `tasks.md`, no forman parte de las cuatro de S22) quedan documentadas arriba: M6 en rojo confirmado; M5 declarada como hallazgo (no distingue el escenario que ejercita el candado 4.9, pero SÍ es detectada por el test directo de la tarea 4.7 sobre el escenario de base bloqueada). `git status` sin cambios en `src/` al momento de commitear esta evidencia.
