# Checks de mutación — prompt del validador sin comandos retirados (tarea 5.1)

Tarea `openspec/changes/validador-prompt-sin-comandos-retirados/tasks.md` 5.1. Fecha: 2026-09-26. Rama `hito/v3.22-validador-prompt-sin-comandos-retirados`, sobre `858aa07`. Cubre M1-M6 del plan (ADR 303).

## Procedimiento (igual para las seis)

1. Copia de respaldo del archivo fuera del repo (scratchpad de la sesión) y `sha256sum` del original.
2. Mutación de un solo literal con un script de reemplazo que **aborta si el texto buscado no aparece exactamente una vez**. En el primer intento de M5 abortó porque el lookbehind aparece también en el doc-comment del helper; se repitió anclando en `PATRON_TOKEN_COMANDO = /…`.
3. Tests dirigidos con `npx vitest run <archivos>` sobre el archivo mutado.
4. Restauración copiando el respaldo (`cp`, no `git checkout`).
5. `sha256sum` restaurado = original, y los mismos tests de nuevo en verde.

Una mutación a la vez. Al terminar: `git status --short src` vacío y `npm run typecheck` verde.

---

## M1 — el prompt del validador vuelve a nombrar `/aprobar-solicitud`

**Archivo**: `src/core/agents/definitions.ts` (`VALIDADOR_SOLICITUDES_AGENT.systemPrompt`).

```diff
-    "indiques comandos, herramientas ni pasos para resolverla.",
+    "indiques comandos, herramientas ni pasos para resolverla. Usá `/aprobar-solicitud`.",
```

**Tests**: `textos-modelo-sin-comandos.test.ts`, `definitions.test.ts`.

```
× ningún texto de agente del núcleo nombra un comando que no existe
× el validador-solicitudes sabe que decide una persona autorizada distinta del solicitante y no da pasos (ADR 303)
Tests  2 failed | 33 passed (35)
```

Revertido: `Tests  35 passed (35)`, sha igual.

## M2 — el prompt deja de decir quién decide

```diff
-    "autorizada, distinta de quien la pidió. Tu dictamen se muestra tal " +
+    "autorizada. Tu dictamen se muestra tal " +
```

**Tests**: `definitions.test.ts`, `textos-modelo-sin-comandos.test.ts`.

```
× el validador-solicitudes sabe que decide una persona autorizada distinta del solicitante y no da pasos (ADR 303)
Tests  1 failed | 34 passed (35)
```

Revertido: `Tests  35 passed (35)`, sha igual. (La guarda sigue verde, como corresponde: no hay comandos en el texto mutado.)

## M3 — la instrucción de delegación vuelve a "un empleado autenticado"

**Archivo**: `src/core/solicitudes/crear-solicitud-interna.ts` (`insumo.instruccion`).

```diff
-… esa decisión la toma después una persona autorizada, distinta de quien la pidió. No indiques …
+… esa decisión la toma un empleado autenticado. No indiques …
```

**Tests**: `crear-solicitud-interna.test.ts`.

```
× lo que recibe el validador dice que decide una persona autorizada distinta del solicitante y no nombra comandos inexistentes (ADR 303)
Tests  1 failed | 4 passed (5)
```

Revertido: `Tests  5 passed (5)`, sha igual.

## M4 — la regex del helper vuelve a la del v3.21 (sin dígitos)

**Archivo**: `src/test/comandos-en-texto.ts`.

```diff
-export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_./~])\/[a-z][a-z0-9-]*/gu;
+export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_./~])\/[a-z][a-z-]*/gu;
```

**Tests**: `src/test/comandos-en-texto.test.ts`.

```
× reconoce completo un comando vigente con dígitos
Tests  1 failed | 13 passed (14)
```

Revertido: `Tests  14 passed (14)`, sha igual.

## M5 — el lookbehind deja de excluir `.`

```diff
-export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_./~])\/[a-z][a-z0-9-]*/gu;
+export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_/~])\/[a-z][a-z0-9-]*/gu;
```

**Tests**: `src/test/comandos-en-texto.test.ts`.

```
× no confunde "./activity-contract.js" con un comando (rutas, URLs y alternativas)
× no confunde "../commands" con un comando (rutas, URLs y alternativas)
Tests  2 failed | 12 passed (14)
```

Revertido: `Tests  14 passed (14)`, sha igual.

## M6 — el inventario pierde una fuente

**Archivo**: `src/core/agents/textos-modelo-sin-comandos.test.ts` (se borra la entrada `a2a-entrante` de `inventario()`).

**Tests**: el mismo archivo.

```
× el inventario no es vacío: diez fuentes con id distinto y diecisiete textos no vacíos
Tests  1 failed | 1 passed (2)
```

Revertido: `Tests  2 passed (2)`, sha igual. Es el diente del test que nació verde en 2.1 (b).

---

## Cierre

- `git status --short src`: vacío.
- `npm run typecheck`: verde.
