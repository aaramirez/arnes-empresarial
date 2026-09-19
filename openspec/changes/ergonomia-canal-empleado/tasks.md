> **Nota de proceso**: fase `sdd-tasks` ejecutada con herramientas de sólo lectura/escritura de archivos (`Read`/`Grep`/`Glob`/`Write`/`Edit`, sin shell), mismo criterio que el resto de la serie ya dejó escrito. Se releyeron completos `proposal.md` (Aclaraciones 1-3, ADR 221-222, R1-R6, RD-105), `design.md` (§0-13, ADR 221 ejecutado, ADR 227-228 nuevos, RD-105 resuelta, R7-R10 nuevos) y las 2 `specs/` (deltas ADDED: `herramienta-operaciones-negocio`, `chat-web-empleado`). No se leyó código fuente de `src/` en esta fase — el diseño ya bajó cada archivo a nivel de línea, texto literal y estructura DOM exacta; no hace falta releerlo para descomponer en tareas. Se recomienda `graphify update .` recién después de `sdd-apply`.
>
> Este documento **no reabre ninguna decisión** ya fijada por el checkpoint: `className` en vez de `classList` (design §4 pto 3, Open Question §13 resuelta), estructura de **tres** nodos por turno en orden fijo hora/autor/texto (design §4 pto 4), **dos** autores y no tres — sin escritor de "sistema" (design §4 pto 2), `Date` como **quinto** identificador libre permitido (ADR 228 pto 1), y el conteo exacto de `children` del test de XSS vigente que pasa de `1` a `3` **reapuntado, nunca borrado** (design §0.3, R9). Todo eso se preserva como dado y se baja a tareas de archivo real.

# Tasks: Ergonomía del canal de empleado — el eco de `registrar_venta` nombra personas, y el chat distingue autor y hora

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 221-222, R1-R6, RD-105) · [`design.md`](design.md) §0-13 (ADR 221 ejecutado, ADR 227-228 nuevos, RD-105 resuelta, R7-R10 nuevos) · specs: [`herramienta-operaciones-negocio`](specs/herramienta-operaciones-negocio/spec.md) (delta ADDED, 1 requirement / 3 escenarios), [`chat-web-empleado`](specs/chat-web-empleado/spec.md) (delta ADDED, 2 requirements / 5 escenarios).

**No es un hito numerado del Plan** — carpeta descriptiva, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `chat-web-empleado` y `aprobacion-conversacional-hitl`. Rama prevista `hito/v3.11-ergonomia-canal-empleado` (numeración `v3.11.0`, decisión del checkpoint ya tomada — ver *Qué necesita el checkpoint* pto 6 de `proposal.md`); commits usan `(ergonomia-canal-empleado, tarea N)`.

**Metodología**: TDD estricto (`strict_tdd: true`) en las tareas 1-3, todas con lógica o estructura verificable. **Una excepción explícita**: tarea 4 (verificación manual final), sin ciclo rojo-verde propio — mismo criterio que la tarea 19 de `aprobacion-conversacional-hitl`.

**Decisión de entrega ya tomada por el checkpoint**: `delivery_strategy: single-pr` (`design.md` §9.1 lo recomendó explícitamente: ~490 líneas de diff total, pero **menos de 90 son producción**, y las dos piezas no comparten ni un archivo). No se usa `feature-branch-chain` para este change — ver *Review Workload Forecast* al final.

---

## Cadena de dependencia real de archivos — y dónde SÍ hay paralelismo

Verificado contra `proposal.md` §Approach ("Dos piezas independientes entre sí... el orden no importa entre ellas") y `design.md` §9 (reconciliación de archivos):

- **Unit 1 — el eco de `registrar_venta`** (tarea 1, **sola**): toca únicamente `src/core/operaciones/ejecutar-operacion.ts` y su test. **Cero archivo compartido con Unit 2** — verificado: Unit 2 toca únicamente `src/adapters/web/chat-client.ts`, `chat-client.test.ts`, `chat-page.ts` y `chat-page.test.ts`. **Unit 1 y Unit 2 son paralelizables entre sí**, en ramas o sesiones distintas, sin ningún riesgo de conflicto de merge.
- **Unit 2 — el chat distingue autor y hora** (tareas 2→3): la tarea 2 (`chat-client.ts` + `chat-client.test.ts`) fija la estructura DOM, la tabla `AUTORES`, `className` y el quinto identificador `Date` — **todo en un solo commit**, por instrucción explícita del diseño (R8: *"es un solo cambio con tres archivos [doc-comment, `new Function` del test, spec], no tres tareas"*; acá se traduce a "un solo commit para `chat-client.ts` y su test", para que la garantía no quede escrita en un lado y verificada en otro). La tarea 3 (`chat-page.ts` + `chat-page.test.ts`, las reglas CSS) **no depende del archivo de la tarea 2** — `renderChatHtml()` no cambia y `CHAT_CSS` es un string independiente del cliente — pero los nombres de clase que estiliza (`turno`, `turno-hora`, `turno-autor`, `turno-texto`, `turno-empleado`, `turno-arnes`) ya están fijados por `design.md` §6, no por la tarea 2, así que **también podría ir en paralelo**. Se secuencia 2→3 en este documento sólo por conveniencia de revisión (ver la estructura DOM pintada antes de estilarla), no por una dependencia real.
- **Tarea 4 (verificación manual)**: converge sobre las tareas 1-3 cerradas — necesita el eco y el chat completos para capturar evidencia de los dos entregables.

**Paralelismo real y verificado**: **Unit 1 (tarea 1) y Unit 2 (tareas 2-3) pueden implementarse en paralelo**, cero archivos compartidos. Dentro de Unit 2, **la tarea 3 podría adelantarse a la tarea 2** sin romper nada — se ordena 2→3 por legibilidad de la demo, no por dependencia de archivo.

---

## Los puntos obligatorios, confirmados con tarea propia

| # | Punto | Dónde en `design.md`/specs | Tarea | Por qué no puede quedar implícito |
|---|---|---|---|---|
| 1 | ★ **El eco NUNCA contiene el email del cliente, con test en negativo que atrapa formateo creativo** (`toContain("@")`, no sólo el email completo) | ADR 221 pto 3, §1.1, spec `herramienta-operaciones-negocio` escenario 2 | **Tarea 1** | Es el único criterio de este change con consecuencia de privacidad (R1) — un `toContain` del email completo dejaría pasar `c***@example.com` o `cliente [at] example.com` |
| 2 | **Los ids se conservan, juntos y etiquetados** (`venta X, caso Y`), nunca reemplazados por nombres | ADR 221 pto 2, design §3 pto 2 | **Tarea 1** | Sustituirlos rompería la correlación con `registro_acciones_empleado` y el reporte de comisiones — el pedido era "que no sean SÓLO ids", no "que no haya ids" |
| 3 | ★ **El texto dice `vendedor <nombre>`, NUNCA "registrado por"** — `vendedorNombre` es texto libre del modelo, no el empleado autenticado | design §0.1 pto 2, §3 pto 5 | **Tarea 1** | Decir "registrado por" afirmaría identidad autenticada sobre un string que el modelo llenó y que además pisa `vendedores.nombre` en silencio (R7) |
| 4 | **Dos autores, no tres** — sin escritor de "sistema" en la transcripción | design §4 pto 2, Open Question §13 resuelta | **Tarea 2** | Un tercer miembro sin escritor es "un valor que existe para que compile", el defecto que el repo ya rechazó (ADR 212 pto 4) |
| 5 | ★ **`className`, no `classList`** — la clase entra por propiedad string, afirmable como `textContent` | design §4 pto 3, ADR 227 pto 3, Open Question §13 resuelta | **Tarea 2** | `classList` obliga a doblar a mano un objeto con métodos en el doble de DOM (jsdom prohibido, ADR 191 pto 2); `className` se afirma con `toBe(...)`, una línea |
| 6 | ★ **`Date` como quinto identificador libre, actualizado en los tres lugares en el mismo commit** (doc-comment, `new Function` del test, spec) | design §0.2, ADR 228 pto 1, R8 | **Tarea 2** | Si el quinto entra en dos lugares y no en tres, la garantía del test queda escrita en un lado y verificada en otro |
| 7 | ★ **El test de XSS vigente se REAPUNTA, no se afloja**: conteo exacto `3` (no se borra el `toHaveLength`), payload verbatim en `children[2]`, más la aserción nueva en positivo `{"div","span"}` | design §0.3, R9 | **Tarea 2** | Borrar el `toHaveLength` es la salida de menor esfuerzo y deja la suite verde con la garantía muerta — instrucción explícita para el Reviewer: si el diff BORRA en vez de reapuntar, rechazar |
| 8 | **Prohibición de estilo inline ampliada sin regex**: `.style`, `cssText`, `setAttribute` — las diez entradas vigentes no se tocan | design §5 pto 3, ADR 228 pto 3 | **Tarea 2** | `setAttribute` es una prohibición más ancha que "estilo inline" y cierra de una vez la familia entera de sumideros de atributo (incluidos `onerror`/`href`), sin costo porque el cliente no usa atributos |
| 9 | **La CSP no cambia — verificado, no supuesto** (`style-src 'self'` ya cubre `CHAT_CSS`) | design §6, Success Criteria de `proposal.md` | **Tarea 3** | Los tests vigentes (`config.test.ts:144-148`, `server.test.ts:2035`) comparan el literal completo — si alguien agrega `unsafe-inline`, fallan solos. Reverificar en verde, no requiere test nuevo |
| 10 | **El color no es el único portador** — autor en texto + barra lateral + color, contraste WCAG AAA verificado | ADR 222 pto 5, design §6 pto 1-2, R6 | **Tarea 3** | Accesibilidad para daltonismo y lectores de pantalla; la barra lateral se ve igual en escala de grises |

---

## Suggested Work Units

| Unit | Goal | Tareas | Cadena | Est. líneas | Paralelizable con |
|---|---|---|---|---|---|
| 1 | El eco de `registrar_venta` nombra vendedor y cliente, conserva ids, omite email | 1 | Eco | ~88 | Unit 2 |
| 2 | El chat distingue autor por `className` y hora vía `Date`, dentro de los invariantes de seguridad vigentes | 2-3 | Chat | ~341 | Unit 1 |
| 3 | Verificación manual + evidencia | 4 | Convergencia | ~60 | — (depende de 1-3) |

**Total estimado**: ~489, reconciliado línea por línea contra `design.md` §9 (ver *Reconciliación* al final) — **81 de producción, 348 de test, 60 de docs**.

---

## Tareas

### Unit 1 — El eco de `registrar_venta` (tarea 1)

1. [x] **`src/core/operaciones/ejecutar-operacion.ts`** (modificado, porción `ejecutarRegistrarVenta`, ADR 221 ejecutado en `design.md` §3) — **sin dependencia de Unit 2**, viaja sola. Reemplaza la línea única `:691-692` por el texto literal fijado por el diseño (sin improvisar):
   ```ts
   return `Venta registrada: vendedor ${operacion.vendedorNombre}, cliente ${operacion.clienteId} (venta ${resultado.ventaId}, caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.`;
   ```
   Agrega doc-comment nuevo en `:645-652` explicando por qué `vendedorNombre` es texto declarado, no identidad autenticada (§0.1 pto 2, punto obligatorio 3 de arriba) y por qué `clienteEmail` está prohibido en el eco (ADR 221 pto 3, §1.1). **Cero lecturas nuevas, cero puertos, cero `await`** — los cuatro datos ya están en el scope de la función. **Cualquier otra línea en el diff de este archivo es alcance filtrado.** ★ **Es el rojo inicial de la propuesta**: hoy el test vigente (`ejecutar-operacion.test.ts:421`) pasa "en verde de la forma equivocada" — `toContain("registrada")` seguiría verde con casi cualquier texto. Test primero (extiende `ejecutar-operacion.test.ts`, fixture vigente `:409-416`, con `ventaId ≠ casoId` para que la posición no pueda mentir): (i) **positivo**, el texto contiene `vendedorNombre` ("Juan Pérez"), `clienteId` ("cliente-1"), `ventaId`, `casoId`, el estado de notificación y el link — los seis; (ii) ★ **negativo obligatorio de privacidad** (R1): con `clienteEmail: "cliente@example.com"` en el scope, el texto **no** contiene el email completo **ni** `"@"` — la aserción de `"@"` es la que atrapa un formateo creativo que un `toContain` del email completo dejaría pasar; (iii) **no-regresión de alcance** (ADR 221 pto 4): con `monto: 1234` y `planNuevo: "premium"`, el texto **no** contiene `"1234"`; (iv) **la auditoría no cambió**: el doble de `RegistroAccionesEmpleadoPort` sigue recibiendo `{comando, ventaId, casoId, resultado: "creada"}` intacto (`:684-689`). Cubre `herramienta-operaciones-negocio` — el único requirement ADDED, los **3** escenarios completos. Comando: `npm test -- ejecutar-operacion`. Commit: `feat(core): el eco de registrar_venta nombra vendedor y cliente, conserva los ids y omite el email (ergonomia-canal-empleado, tarea 1)`.

**Verificación de cierre de Unit 1**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/core/ventas/` **vacío** — ningún núcleo determinista tocado (ADR 145 pto 5, sin excepción); `git diff --stat main -- src/adapters/web/` **vacío** desde esta unidad — Unit 1 no toca el chat. Revertible sola: restaurar la línea `:691-692`, nada más la consume (`RegistrarVentaResult` no incluye el texto, `registrar-venta.ts:91-96`).

### Unit 2 — El chat distingue autor y hora (tareas 2-3)

2. [x] ★ **`src/adapters/web/chat-client.ts`** + **`src/adapters/web/chat-client.test.ts`** (modificados, ADR 227, ADR 228 — **un solo commit**, punto obligatorio 6 de arriba) — **sin dependencia de Unit 1**, viaja en paralelo. `agregarTurno` deja de recibir una etiqueta de presentación y pasa a recibir una **clave cerrada** de una tabla de módulo:
   ```js
   var AUTORES = {
     empleado: { etiqueta: "Vos",   clase: "turno turno-empleado" },
     arnes:    { etiqueta: "Arnés", clase: "turno turno-arnes"    }
   };
   ```
   **Dos autores, no tres** — no hay ningún escritor de "sistema" en la transcripción (punto obligatorio 4). La función pasa a construir **tres hijos, siempre, en ese orden** — hora, autor, texto — vía `nodoSpan(clase, texto)`, un helper nuevo que asigna `span.className` y `span.textContent`:
   ```js
   function agregarTurno(claveAutor, texto) {
     var autor = AUTORES[claveAutor];
     var turno = document.createElement("div");
     turno.className = autor.clase;
     turno.appendChild(nodoSpan("turno-hora", horaActual()));
     turno.appendChild(nodoSpan("turno-autor", autor.etiqueta));
     turno.appendChild(nodoSpan("turno-texto", texto));
     mensajes.appendChild(turno);
   }
   ```
   **`className`, no `classList`** (punto obligatorio 5, ADR 227 pto 3). Los dos call sites pasan a `agregarTurno("empleado", texto)` y `agregarTurno("arnes", cuerpo.respuesta)` (`:182-183`). Suma `horaActual()`/`dosDigitos(n)` — formato `HH:MM`, 24h, hora local, **sin** `toLocaleTimeString` (no afirmable en test, ADR 228 pto 4) y **sin** `padStart` (archivo ES5 a propósito, sin typecheck ni lint, ADR 200 pto 4). El doc-comment de `:17-22` pasa de **cuatro** a **cinco** identificadores libres declarados: `document`, `fetch`, `setInterval`, `clearInterval`, `Date` (punto obligatorio 6). En el test: `ElementoFake` gana `className: ""`; `new Function(...)` gana un quinto parámetro con un `Date` doble determinista (constructor que devuelve un objeto, sobreescribe el `this` de `new`); `IDENTIFICADORES_PROHIBIDOS` gana **tres** entradas — `.style`, `cssText`, `setAttribute` (punto obligatorio 8) — **las diez vigentes no se tocan, no se reordenan, no se relajan**. Test primero (extiende `chat-client.test.ts`): (i) **estructura**: tras un envío exitoso, `mensajes.children` tiene 2, `children[0].className === "turno turno-empleado"`, `children[1].className === "turno turno-arnes"`, cada uno con **exactamente 3** hijos con `className` `turno-hora`/`turno-autor`/`turno-texto` en ese orden; (ii) **el autor está en texto, no sólo en color** (ADR 222 pto 5): `children[0].children[1].textContent === "Vos"`, `children[1].children[1].textContent === "Arnés"`; (iii) **la hora tiene el formato exacto**: con el doble `Date(9, 5)` ⇒ `turno-hora.textContent === "09:05"` — el caso de un dígito es el que prueba `dosDigitos` (con `(14, 32)` solo, un `slice` roto pasaría); (iv) ★ **XSS reapuntado, no aflojado** (punto obligatorio 7): payload `<script>alert(1)</script>` ⇒ el turno tiene **3** hijos (conteo exacto, nunca borrado), `children[2].textContent` contiene el payload verbatim, `elementosCreados` **no** contiene `"script"` ni `"img"`; (v) **nueva, en positivo**: `new Set(documento.elementosCreados)` es exactamente `{"div","span"}`; (vi) **ningún string dinámico llega a `className`** (ADR 227 pto 1): con un mensaje de empleado cuyo texto es literalmente `"arnes"` y una respuesta `"turno-empleado"`, las clases de los dos turnos siguen siendo las correctas. Cubre `chat-web-empleado` — el requirement "distingue autor por clase CSS y muestra la hora" completo (los 4 escenarios de esa parte) y el requirement "la hora es ayuda de lectura, no auditoría" (parcial — la aserción de formato). Comando: `npm test -- chat-client`. Commit: `feat(adapters): el turno del chat pasa a estructura de tres nodos con className por autor y hora via Date (ergonomia-canal-empleado, tarea 2)`.

3. [x] **`src/adapters/web/chat-page.ts`** (porción `CHAT_CSS`) + **`src/adapters/web/chat-page.test.ts`** (modificados, RD-105 resuelta en `design.md` §6) — **sin dependencia de archivo con la tarea 2** (`renderChatHtml()` no cambia ni un carácter, `CHAT_CSS` es un string independiente del cliente); se secuencia después de la tarea 2 sólo por legibilidad de la demo. Agrega **ocho** reglas al final de `CHAT_CSS` — las cinco vigentes (`:24-44`) **no se editan**:
   ```css
   .turno { border-left: 3px solid transparent; margin-bottom: 8px; padding-left: 8px; }
   .turno-hora { color: #616161; font-variant-numeric: tabular-nums; margin-right: 8px; }
   .turno-autor { font-weight: 600; margin-right: 8px; }
   .turno-texto { display: block; }
   .turno-empleado { border-left-color: #1b5e20; }
   .turno-empleado .turno-autor { color: #1b5e20; }
   .turno-arnes { border-left-color: #0d47a1; }
   .turno-arnes .turno-autor { color: #0d47a1; }
   ```
   Contraste verificado contra el fondo blanco del `body`: `#1b5e20` ≈ 8.4:1, `#0d47a1` ≈ 9.7:1, `#616161` ≈ 6.1:1 — los tres pasan WCAG AA con margen, los dos primeros AAA (punto obligatorio 10). **`white-space: pre-wrap` de `#mensajes` (`:36-41`) no se toca** — sigue heredándose a `.turno-texto`. **Cero cambio de CSP** — `style-src 'self'` ya cubre la hoja (punto obligatorio 9), `renderChatHtml()` sin una línea de diff. Test primero (extiende `chat-page.test.ts`): las ocho reglas nuevas están presentes en `CHAT_CSS`; los dos `it` vigentes (`:39-47`, incluido `pre-wrap`) sobreviven sin tocar. **Reverificar en verde, sin modificar** (no requiere test nuevo): `config.test.ts:144-148` y `server.test.ts:2035` — comparan el literal completo de `CSP_CHAT`, fallan solos si alguien agrega `unsafe-inline`. Cubre `chat-web-empleado` — cierra el requirement "distingue autor por clase CSS" (la parte de estilos: color nunca por atributo `style`, contraste, portador redundante) y el escenario "El color nunca se asigna por atributo `style` inline". Comando: `npm test -- chat-page && npm test -- config && npm test -- server`. Commit: `feat(adapters): agrega las reglas CSS de turno-empleado/turno-arnes/turno-hora/turno-autor a CHAT_CSS (ergonomia-canal-empleado, tarea 3)`.

**Verificación de cierre de Unit 2**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/adapters/web/server.ts src/adapters/web/config.ts` **vacío** — cero cambio de servidor, rutas, payloads o CSP (Aclaración previa 2 de la propuesta); `git diff --stat main -- src/core/` **vacío** — cero cambio de núcleo desde esta unidad; `package.json` sin dependencias nuevas. Revertible sola: restaurar `agregarTurno` y quitar las reglas de `CHAT_CSS` — ningún turno anterior queda ilegible, nada se persistió con el formato nuevo.

### Unit 3 — Verificación manual del entregable (tarea 4)

4. [x] **Verificación manual del entregable** — TDD exception (sin código de producción). Evidencia en `docs/progreso/v3.11-ergonomia-canal-empleado/`, molde `verificacion-manual-tarea-19.md` de `aprobacion-conversacional-hitl` / tarea 13 de `chat-web-empleado`. Depende de que las tareas 1-3 estén cerradas. Cubre, como mínimo, los **Success Criteria** de `proposal.md`:
    - **Captura del eco de `registrar_venta`**: nombra al vendedor y al cliente, **no** muestra el email, conserva `ventaId` y `casoId` etiquetados.
    - **Captura del chat con al menos cuatro turnos alternados**: dos colores, dos etiquetas, cuatro horas visibles.
    - ★ **Captura en escala de grises o con el color forzado**, mostrando que autor y barra lateral distinguen igual sin depender del color (ADR 222 pto 5, R6).
    - `git diff main` confirma: **cero** cambios en `src/core/ventas/`, **cero** cambios de esquema/migraciones, **cero** cambios en el modelo de rol o en `sesion.ts`, **cero** cambios en `server.ts`/rutas/payloads/CSP, **cero** dependencias nuevas en `package.json`.
    - La CSP no cambió — verificado por `git diff` sobre `server.ts` y `chat-page.ts` (no sólo por los tests que ya la comparan).
    - Los requirements de seguridad vigentes de `chat-web-empleado` (sin `innerHTML`, CSP, `textContent`) siguen intactos — ninguno editado, ninguno relajado.
    - `npm test`, `npm run typecheck` y lint en verde.
    Commit: `docs: evidencia de verificacion manual de la ergonomia del canal de empleado (ergonomia-canal-empleado, tarea 4)`.

---

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~489 (`design.md` §9, reconciliado por archivo) — **81 de producción, 348 de test, 60 de docs** |
| 400-line budget risk | Bajo, en la propiedad que el presupuesto protege — el conteo bruto (`additions+deletions`) roza los 400, pero **menos de 90 líneas son producción** en tres archivos, y **~350 del total son tests**, que es lectura confirmatoria, no deliberativa (`design.md` §9.1) |
| Chained PRs recommended | **No** |
| Delivery strategy | `single-pr` — **decisión ya tomada por el checkpoint**, ver `proposal.md` R2 y `design.md` §9.1: las dos unidades son independientes, sin archivo compartido, y el presupuesto real de revisión se cumple con holgura |
| Chain strategy | No aplica — una sola PR, sin ramas encadenadas |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: n/a (single-pr)
400-line budget risk: Low
```

**Nota explícita para el orquestador**: `delivery_strategy: single-pr` no es una decisión nueva de esta fase — la fijó el checkpoint sobre la recomendación explícita de `design.md` §9.1. Si al implementar apareciera cualquiera de las cuatro señales de alcance filtrado (cambio de servidor, de esquema, de autorización nueva, o de superficie HTTP nueva — Aclaración previa 2 de `proposal.md`), el humano debe detenerse y volver al Spec Author, no reabrir la decisión de entrega unilateralmente.

### Reconciliación con `design.md` §9

| Tarea | Archivos principales | Prod (§9) | Test (§9) | Total | Nota |
|---|---|---|---|---|---|
| 1 | `ejecutar-operacion.ts` + `.test.ts` | ~8 | ~40 (+~40 del propio test file) | ~88 | Sin ajuste respecto de `design.md` §9 |
| 2 | `chat-client.ts` + `chat-client.test.ts` | ~45 | ~130 (+~130 del propio test file) | ~305 | Sin ajuste — el diseño ya cuenta ambas filas por separado |
| 3 | `chat-page.ts` + `chat-page.test.ts` | ~28 | 0 (+~8 del propio test file) | ~36 | Sin ajuste |
| 4 | `docs/progreso/v3.11-ergonomia-canal-empleado/` | ~60 (docs, no producción) | — | ~60 | Sin ajuste |
| **Total** | | **~81 producción** | **~348 test** | **~489** | Coincide con el total que `design.md` §9 declara explícitamente (*"≈ 490 líneas de diff, de las cuales menos de 90 son producción"*) |

**Ningún archivo ganó ni perdió líneas estimadas respecto de `design.md`** — los ajustes de esta fase son de agrupamiento en tareas, no de tamaño.

## Después de la tarea 4

- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este documento, las 2 specs y `design.md`, con atención especial a: **el test de XSS reapuntado, no aflojado** (tarea 2 — R9, conteo exacto `3`, si el diff borra en vez de reapuntar, rechazar); **el negativo de privacidad del email con la aserción de `"@"`** (tarea 1 — R1, único criterio con consecuencia de privacidad); **que `Date` esté declarado en los tres lugares en el mismo commit** (tarea 2 — R8); y **que ningún archivo de `server.ts`, `config.ts` o `src/core/ventas/` aparezca en el diff** (Aclaración previa 2 de la propuesta — si aparece, el alcance se filtró).
- `delivery_strategy` ya está resuelto (`single-pr`) — no hay decisión pendiente para el humano antes de `sdd-apply`.
- Si aprueba: checklist de cierre de `AGENTS.md` (Reviewer aprobado, `docs/progreso/v3.11-ergonomia-canal-empleado/` completo con las tres capturas), tag `v3.11.0` sobre `main` tras el merge de `hito/v3.11-ergonomia-canal-empleado` — **numeración y orden de merge frente a `devolucion-sin-token-dos-personas` a confirmar por el checkpoint** (R3 de la propuesta recomienda este change primero).

---

**Nota de formato**: mismo criterio que `definicion-skills/tasks.md`, `chat-web-empleado/tasks.md` y `aprobacion-conversacional-hitl/tasks.md` — se sigue el formato extenso ya establecido por `proposal.md` y las 2 `specs/` de este mismo change, en vez del tope de 530 palabras de la skill `sdd-tasks`.
