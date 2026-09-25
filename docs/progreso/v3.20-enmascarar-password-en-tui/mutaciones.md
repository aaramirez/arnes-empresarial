# Checks de mutación — enmascarado de la clave en la TUI (tarea 5.1)

Tarea `openspec/changes/enmascarar-password-en-tui/tasks.md` 5.1. Fecha: 2026-09-24. Rama `hito/v3.20-enmascarar-password-en-tui`. Cubre M1-M5 del design (`design.md` §7.2, T1-T8, U1-U7) más M5, agregada en la tarea 3.4 (`tasks.md`).

## Procedimiento (igual para las cinco)

1. Copia de respaldo del archivo fuera del repo (sin `git checkout`/`stash`: hay tareas ya hechas y sin commitear en la rama, una restauración con git las habría destruido). `sha256sum` del original antes de mutar.
2. Mutación de una sola línea con `Edit` (nunca reescritura completa del archivo).
3. Test dirigido con `npx vitest run <archivo> -t "<filtro>"` sobre el archivo mutado (salida roja, abajo).
4. Restauración copiando el respaldo sobre el archivo (`cp`, no `git checkout`).
5. `sha256sum` del archivo restaurado = igual al original; `git diff -- src` vacío; test dirigido de nuevo en verde.

Todas las mutaciones se probaron **una a la vez**: nunca hubo dos archivos mutados a la vez.

---

## M1 — `TurnRecord.prompt` guarda el prompt real (no el enmascarado)

**Archivo:línea**: `src/adapters/tui/App.tsx:635` (dentro de `submitDraft`).

**Código mutado**:

```diff
-    setHistory((previous) => [...previous, { id, prompt: visible, status: "pending", timestamp }]);
+    setHistory((previous) => [...previous, { id, prompt, status: "pending", timestamp }]);
```

**Comando**: `npx vitest run src/adapters/tui/App.test.tsx -t "T3"`

**Salida roja (extracto)**:

```
FAIL  src/adapters/tui/App.test.tsx > App > secret masking (ADR 300) > shows the pending turn's echo already masked and never leaks the secret once the turn settles (T3)
AssertionError: expected '  _      _       _     _\n | |    (_)…' to contain 'Vos: /crear-empleado ana ************…'
- Expected
+ Received
- Vos: /crear-empleado ana *****************
+ [21:16:28] Vos: /crear-empleado ana secreto-largo-123
Tests  1 failed | 44 skipped (45)
```

T3 falla: el turno pendiente muestra la clave real (`secreto-largo-123`) en vez de la máscara.

**Restauración**: `sha256sum` idéntico al original (`150e6d20…`); `git diff -- src` vacío; `npx vitest run src/adapters/tui/App.test.tsx -t "secret masking"` → 9 passed | 36 skipped (45).

---

## M2 — el historial de flechas guarda SIEMPRE, sin la guarda de secreto

**Archivo:línea**: `src/adapters/tui/App.tsx:620-622` (dentro de `submitDraft`).

**Código mutado**:

```diff
-    if (!contieneSecreto(prompt)) {
-      promptHistoryRef.current.push(prompt);
-    }
+    promptHistoryRef.current.push(prompt);
     historyIndexRef.current = null;
```

**Comando**: `npx vitest run src/adapters/tui/App.test.tsx -t "T5\)"`

**Salida roja (extracto)**:

```
FAIL  src/adapters/tui/App.test.tsx > App > secret masking (ADR 300) > omits a secret-carrying line from arrow-up history and only recalls the earlier plain prompt (T5)
AssertionError: expected '> /login ana *******' to be '> hola'
Tests  1 failed | 44 skipped (45)
```

T5 falla: tras enviar `hola` y `/login ana secreto`, ↑ recupera la línea con clave en vez de `hola`.

**Restauración**: `git diff -- src` vacío; `npx vitest run src/adapters/tui/App.test.tsx -t "secret masking"` → 9 passed | 36 skipped (45).

---

## M3 — `PromptInput` dibuja el borrador sin máscara

**Archivo:línea**: `src/adapters/tui/App.tsx:437` (dentro de `PromptInput`).

**Código mutado**:

```diff
-      <Text>{`> ${enmascararSecreto(draft)}`}</Text>
+      <Text>{`> ${draft}`}</Text>
```

**Comando**: `npx vitest run src/adapters/tui/App.test.tsx -t "T8|T1\)"`

**Salida roja (extracto)**:

```
FAIL … PromptInput draws the draft already masked when it carries a secreto command's password (T8)
AssertionError: expected '> /login ana pw' to be '> /login ana **'

FAIL … masks the password on every frame while /login is typed character by character, never leaking a prefix of it (T1)
AssertionError: expected '> /login ana secreto' to be '> /login ana *******'

Tests  2 failed | 43 skipped (45)
```

T8 y T1 fallan: el borrador se dibuja con la clave real, sin ningún `*`.

**Restauración**: `git diff -- src` vacío; `npx vitest run src/adapters/tui/App.test.tsx -t "secret masking"` → 9 passed | 36 skipped (45).

---

## M4 — el helper del núcleo desplaza el corte del id en uno (off-by-one)

**Archivo:línea**: `src/core/commands/comando-empleado.ts:682` (dentro de `inicioTramoSecreto`).

**Mutación elegida** (de las dos alternativas de la tarea 5.1 — espacios de cola sin enmascarar, u off-by-one en el id — se usó la **segunda**: off-by-one, quitando el `+ 1` final que salta el separador posterior al id):

```diff
-  const inicioTramo = inicio + finComando + 1 + finId + 1;
+  const inicioTramo = inicio + finComando + 1 + finId;
```

Efecto: el tramo enmascarado empieza un carácter antes, así que el separador (el espacio entre el id y la clave) queda convertido en `*` en vez de conservarse.

**Comando**: `npx vitest run src/core/commands/comando-empleado.test.ts -t "U1:|U4:"`

**Salida roja (extracto)**:

```
FAIL … U1: enmascara todo lo posterior al id, espacios internos y de cola incluidos ("/login ana s3cret" → "/login ana ******")
AssertionError: expected '/login ana*******' to be '/login ana ******'

FAIL … U1: ("/login ana s3cr et" → "/login ana *******")
AssertionError: expected '/login ana********' to be '/login ana *******'

FAIL … U1: ("/crear-empleado bob abc" → "/crear-empleado bob ***")
AssertionError: expected '/crear-empleado bob****' to be '/crear-empleado bob ***'

FAIL … U1: ("  /login  ana  pw" → "  /login  ana ***")
AssertionError: expected '  /login  ana****' to be '  /login  ana ***'

Tests  4 failed | 3 passed | 161 skipped (168)
```

Los cuatro casos literales de **U1** fallan: el espacio separador se enmascara en vez de conservarse.

**Hallazgo no pedido por la tarea, documentado igual**: los tres tests de **U4** (paridad con `parsearComando`) siguieron en **verde** con esta mutación (`3 passed`). U4 verifica un superconjunto (`mascara.slice(inicioPassword, fin)` sea `*`, con `inicioPassword` derivado de `password.length` del parser) que sigue cumpliéndose aunque el tramo `*` empiece un carácter antes de lo debido — U4 es un oráculo de "no sub-enmascarar la clave", no de "posición exacta del corte". La detección real de este off-by-one la hacen los casos literales de U1, no U4. Queda registrado por si el Reviewer quiere reforzar U4 con una aserción de posición exacta en un change futuro.

**Restauración**: `sha256sum` idéntico al original (`fd849bd5…`); `git diff -- src` vacío; `npx vitest run src/core/commands/comando-empleado.test.ts` → 168 passed.

---

## M5 — la guarda del historial usa el predicado rechazado `!==` en vez de `contieneSecreto`

Agregada en la tarea 3.4 (mismo `describe`, mirror de T5 con una clave hecha sólo de `*`). Repetida aquí como parte del set completo de mutaciones de 5.1.

**Archivo:línea**: `src/adapters/tui/App.tsx:620` (dentro de `submitDraft`).

**Código mutado** (predicado rechazado en `design.md` §3.1, invertido a `===` para preservar la semántica de "push si NO hay secreto"):

```diff
-    if (!contieneSecreto(prompt)) {
+    if (enmascararSecreto(prompt) === prompt) {
       promptHistoryRef.current.push(prompt);
     }
```

**Comando**: `npx vitest run src/adapters/tui/App.test.tsx -t "T5b"`

**Salida roja (extracto)**:

```
FAIL … also omits a password made only of asterisks from arrow-up history (T5b)
AssertionError: expected '> /login ana ***' to be '> hola'
Tests  1 failed | 44 skipped (45)
```

T5b falla: con una clave hecha sólo de `*` (`/login ana ***`), `enmascararSecreto(prompt) === prompt` es `true` (la máscara no cambia nada visible), así que el predicado rechazado la deja entrar al historial; ↑ recupera `/login ana ***` en vez de `hola`. Es exactamente el caso borde que motivó elegir el predicado estructural `contieneSecreto` en el design (§3.1).

**Restauración**: `sha256sum` idéntico al original; `git diff -- src` vacío; `npx vitest run src/adapters/tui/App.test.tsx -t "secret masking"` → 9 passed | 36 skipped (45).

---

## Cierre

- Las cinco mutaciones (M1-M5) fueron atrapadas por sus tests nombrados y ninguna otra prueba de `App.test.tsx`/`comando-empleado.test.ts` se vio afectada durante la mutación (los `it.each` no filtrados quedaron `skipped`, no rojos).
- Tras restaurar la última mutación: `git diff -- src` vacío, `npm run typecheck` verde.
- `npm test` completo (con `dist/` limpio antes de correr, por la duplicación de conteo conocida): ver cierre en [`README.md`](README.md).

## Enlaces

- Tareas: [`../../../openspec/changes/enmascarar-password-en-tui/tasks.md`](../../../openspec/changes/enmascarar-password-en-tui/tasks.md)
- Diseño (ADR 300, §7.2, §8): [`../../../openspec/changes/enmascarar-password-en-tui/design.md`](../../../openspec/changes/enmascarar-password-en-tui/design.md)
- Evidencia manual (5.2, pendiente): [`README.md`](README.md)
