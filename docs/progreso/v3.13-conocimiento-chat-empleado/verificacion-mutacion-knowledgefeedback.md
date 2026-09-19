# Verificación por mutación manual — invariante `knowledgeFeedback` (ADR 235, tarea 6)

**Fecha**: 2026-09-19
**Rama**: `hito/v3.13-conocimiento-chat-empleado`, sobre el árbol con las tareas 1-5 aplicadas.
**Objetivo**: probar que el test (v) de la tarea 2 (`NO pasa knowledgeFeedback a handleTurn`) realmente detecta una regresión del invariante del ADR 235 — que nazca verde no significa que sea un test vacío.

## 1. Mutación aplicada

En `src/build-on-operaciones-empleado.ts`, dentro de la llamada a `handleTurn` (después de `mcpServers`), se agregó temporalmente:

```diff
       ...(logDeps ? { logDeps } : {}),
       mcpServers: { ...knowledge.mcpServers, ...operacionesAdapter.mcpServers },
+      knowledgeFeedback: knowledge.feedback,
     });
```

## 2. Salida en ROJO (con la mutación)

```
$ npm test -- build-on-operaciones-empleado

 ❯ src/build-on-operaciones-empleado.test.ts (27 tests | 1 failed) 142ms
     × NO pasa knowledgeFeedback a handleTurn (ADR 235 pto 4 — invariante negativo, nace verde) 8ms

 FAIL  src/build-on-operaciones-empleado.test.ts > buildOnOperacionesEmpleado > NO pasa knowledgeFeedback a handleTurn (ADR 235 pto 4 — invariante negativo, nace verde)
AssertionError: expected { memory: { …(4) }, …(4) } to not have property "knowledgeFeedback"

- Expected:
undefined

+ Received:
{
  "discardPendingCitations": [Function Mock],
  "saveTurnResult": [Function Mock],
}

 ❯ src/build-on-operaciones-empleado.test.ts:438:24
    436|       const deps = mockedHandleTurn.mock.calls[0]?.[2];
    437|       expect(deps).toBeDefined();
    438|       expect(deps).not.toHaveProperty("knowledgeFeedback");
       |                        ^

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 47 passed (48)
```

**Resultado**: falla exactamente (v), como exige la aceptación mínima de la tarea 6 ("deben fallar (v) y (vi) ... **o, al menos, (v)**"). (vi) (`saveTurnResult`/`discardPendingCitations` no invocados) sigue en verde porque esa mutación puntual no llega a invocar el feedback real — sólo lo pasa como dependencia — así que no contradice la aceptación.

## 3. Reversión

```diff
       ...(logDeps ? { logDeps } : {}),
       mcpServers: { ...knowledge.mcpServers, ...operacionesAdapter.mcpServers },
-      knowledgeFeedback: knowledge.feedback,
     });
```

```
$ git diff -- src/build-on-operaciones-empleado.ts
(vacío)
```

Confirmado: el archivo quedó exactamente en el estado de la tarea 4-5, sin residuos de la mutación.

## 4. Salida en VERDE (tras revertir)

```
$ npm test -- build-on-operaciones-empleado

 Test Files  2 passed (2)
      Tests  48 passed (48)
```

## 5. Segunda mutación — por qué el índice es `[2]` y no `[1]`

`handleTurn(casoId, prompt, opciones)` — el objeto de opciones (donde vive `mcpServers`/`knowledgeFeedback`) es el **tercer** argumento posicional, índice `2` de `mock.calls[0]`. `mock.calls[0]?.[1]` es `prompt` (un `string`), no un objeto — cambiar el índice ahí haría que `toHaveProperty`/`not.toHaveProperty` operen sobre un string, que en Vitest jamás tiene la propiedad buscada, así que el test **nunca fallaría** con la mutación real de arriba (falso negativo estructural, no relacionado al invariante de negocio). Se usa `[2]` precisamente porque es el único índice que referencia el objeto de opciones real.

## 6. Resultado

| Criterio de aceptación (tarea 6) | Resultado |
|---|---|
| Salida en rojo con la mutación (al menos test (v) falla) | ✅ §2 |
| Reversión limpia, `git diff` vacío | ✅ §3 |
| Salida en verde tras revertir | ✅ §4 |
| Justificación del índice `[2]` | ✅ §5 |

**El criterio de seguridad del change queda demostrado**: el invariante "el chat de empleado nunca cablea `knowledgeFeedback`" (ADR 235) no es sólo una afirmación en un test que nace verde por casualidad — una regresión real de una línea lo rompe de forma detectable.
