# Verificación por mutación manual — marco de texto externo (tarea 2.8)

Excepción TDD (design §13.3): con la tarea 2.7 aplicada, se probó que los tests de las
tareas 2.1-2.6 —rojos sólo "de tipo" o "porque el módulo no existía"— tienen dientes.
Cada mutación se aplicó temporalmente sobre `src/core/agents/texto-externo.ts` o
`src/core/agents/a2a-entrante-textos.ts`, se confirmó el fallo esperado, se revirtió
(`git diff` contra el estado de 2.7 queda vacío tras cada revert) y se confirmó `npm test`
en verde antes de pasar a la siguiente.

## M1 — truncar antes de escapar (en vez de escapar antes de truncar)

Mutación: en `enmarcarTextoExterno`, truncar `contenido` a `MAX_CHARS_TEXTO_EXTERNO_MODELO`
**antes** de aplicar el escape del delimitador forjado.

```
 FAIL  src/core/agents/texto-externo.test.ts > texto-externo: truncado, escape de delimitador forjado y orden escapar→truncar (visibilidad-a2a-entrante-chat, tarea 2.3) > orden escapar→truncar: contenido de T caracteres hecho de marcas forjadas ⇒ el tramo ya escapado sigue ≤ T, con nota de truncado
AssertionError: expected 1720 to be less than or equal to 1000
 ❯ src/core/agents/texto-externo.test.ts:111:41

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

Falla exactamente el test de 2.3-(iv), como predice el diseño. Revertido; `git diff` vacío contra 2.7.

## M2 — condición de la nota `>` → `>=`

Mutación: `escapado.length > MAX_CHARS_TEXTO_EXTERNO_MODELO` → `escapado.length >= MAX_CHARS_TEXTO_EXTERNO_MODELO`.

```
 FAIL  src/core/agents/texto-externo.test.ts > ... > frontera (nace VERDE, declarado): T caracteres exactos sin marcas forjadas ⇒ íntegro y sin nota de truncado
AssertionError: expected "…" not to match /trunc/i

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

Falla exactamente la frontera exacta de 2.3-(ii) (el caso que "nace verde"), como predice el diseño.
Revertido; `git diff` vacío contra 2.7.

## M3 — quitar la bandera `i` del escape

Mutación: `contenido.replace(/<<<EXTERNO:/gi, ...)` → `contenido.replace(/<<<EXTERNO:/g, ...)`.

```
 FAIL  src/core/agents/texto-externo.test.ts > ... > escape case-insensitive: marcas forjadas en distintas capitalizaciones quedan neutralizadas, quedan exactamente una apertura y un cierre reales
AssertionError: expected [ '<<<EXTERNO:', '<<<externo:', …(2) ] to have a length of 2 but got 4

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

Falla exactamente el test de minúsculas de 2.3-(iii), como predice el diseño. Revertido; `git diff` vacío contra 2.7.

## M4 — mover la nota de truncado antes de FIN

Mutación: `` `${truncado}\n${MARCA_EXTERNO_FIN}${nota}` `` → `` `${truncado}${nota}\n${MARCA_EXTERNO_FIN}` ``.

```
 × truncado: 5000 caracteres ⇒ tramo entre marcas ≤ T y nota de truncado fuera del marco declara el largo original 5000; 1001 declara 1001
 × frontera: T+1 caracteres ⇒ truncado con nota (este caso es el rojo)
 × orden escapar→truncar: contenido de T caracteres hecho de marcas forjadas ⇒ el tramo ya escapado sigue ≤ T, con nota de truncado
 FAIL  ... > nota forjada dentro del marco queda dentro; la nota real (si existe) va después de FIN
AssertionError: expected -1 to be greater than 1343

 Test Files  1 failed (1)
      Tests  4 failed | 9 passed (13)
```

Falla 2.3-(i) y 2.3-(vi), como predice el diseño (además de dos casos colaterales que también
dependen de que la nota quede fuera del marco — señal de que la mutación se detecta con margen).
Revertido; `git diff` vacío contra 2.7.

## M5 — en `formatearDetalleSolicitudA2AParaModelo`, no pasar `resultado` por `enmarcarTextoExterno`

Mutación: `` `\n\n${enmarcarTextoExterno("resultado", vista.resultado)}` `` → `` `\n\nresultado: ${vista.resultado}` ``
(texto plano, sin marco).

```
 FAIL  src/core/agents/a2a-entrante-textos.test.ts > a2a-entrante-textos: formatearDetalleSolicitudA2AParaModelo (visibilidad-a2a-entrante-chat, tarea 2.6) > dos secciones enmarcadas: 'mensaje recibido' y 'resultado', cada una con su propio INICIO/FIN y su centinela dentro
```

Falla 2.6-(iii) (más dos colaterales — truncado por sección y marca forjada — que también dependen
de que `resultado` esté enmarcado). Revertido; `git diff` vacío contra 2.7.

## M6 — reemplazar `enmarcarTextoExterno("mensaje recibido", …)` por paginado por líneas

Mutación: `enmarcarTextoExterno("mensaje recibido", vista.mensajeRecibido)` →
`formatearSeccionPaginadaA2A("mensaje recibido", vista.mensajeRecibido)` (el paginado de la TUI).

```
 FAIL  ... > 'resultado' ausente ⇒ una sola sección enmarcada, sin la etiqueta 'resultado' ni la palabra 'undefined'
 FAIL  ... > truncado por sección: mensajeRecibido de 5000 y resultado de 1001 caracteres ⇒ dos notas fuera del marco que declaran 5000 y 1001, cada tramo ≤ T
 FAIL  ... > una marca forjada dentro de mensajeRecibido no agrega aperturas ni cierres reales — siguen siendo 2 y 2
 FAIL  ... > no pagina por líneas (a diferencia de la TUI): 100 líneas cortas, bajo el tope de caracteres, aparecen todas y sin nota de 'líneas'
```

Falla 2.6-(v) y 2.6-(vii) (más dos colaterales, ya que `mensajeRecibido` deja de estar enmarcado
en absoluto). Revertido; `git diff` vacío contra 2.7.

## Confirmación final tras revertir las seis mutaciones

```
> tsc --noEmit
(sin salida — verde)

 Test Files  148 passed | 1 skipped (149)
      Tests  2711 passed | 3 skipped (2714)

> tsc -p tsconfig.json
(sin salida — verde)
```

Las seis mutaciones fueron detectadas por el test que el diseño predijo (M1-M4 sobre
`texto-externo.ts`, M5-M6 sobre `a2a-entrante-textos.ts`); ninguna pasó desapercibida.
