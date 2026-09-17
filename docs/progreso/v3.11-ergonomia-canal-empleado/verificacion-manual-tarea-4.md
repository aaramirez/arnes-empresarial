# Verificación manual de cierre — `ergonomia-canal-empleado` (tarea 4)

**Fecha**: 2026-09-17
**Rama**: `hito/v3.11-ergonomia-canal-empleado`
**Ejecutor**: verificación manual end-to-end con navegador real (Browser pane), tarea 4 de `openspec/changes/ergonomia-canal-empleado/tasks.md` — sin código de producción (TDD exception, mismo criterio que la tarea 19 de `aprobacion-conversacional-hitl`).

## 0. Nota de método — por qué el turno de "Arnés" no pasa por el Claude Agent SDK real

Este entorno no tiene `ANTHROPIC_API_KEY` disponible (verificado: `node -e "console.log(!!process.env.ANTHROPIC_API_KEY)"` → `false`), igual que documentó `docs/progreso/v3.10-aprobacion-conversacional-hitl/verificacion-manual-tarea-19.md` §0. No se puede levantar un turno conversacional real donde el modelo elija la operación `registrar_venta` y redacte su propia respuesta.

Esta evidencia resuelve las dos piezas del change por separado, cada una con su propio nivel de realismo:

- **El eco de `registrar_venta` (Unit 1)**: se invoca `ejecutarOperacion` — el dispatcher REAL (`src/core/operaciones/ejecutar-operacion.ts`, sin ningún doble en el camino que compone el texto) — con un script temporal (`verificacion-tarea-4-temp.ts`, ejecutado una vez con `npx tsx` y borrado después, mismo molde que el script de la tarea 19). Los únicos dobles son los `Port`s de infraestructura (`VentaStorePort`, `VentaNotifierPort`, etc.), exactamente el mismo criterio que ya usa `ejecutar-operacion.test.ts` para este archivo ("nunca SQLite real, mismo criterio que el resto de `src/core/`" — comentario de ese propio archivo). El texto que produce esta llamada es el texto real de producción, no inventado.
- **El chat (Unit 2)**: se sirve la página real (`GET /chat`, CSP real, `chat-client.js`/`CHAT_CSS` reales, login real contra `credenciales_empleado`) y se intercepta ÚNICAMENTE `fetch("/operaciones", ...)` en la consola del navegador para devolver un cuerpo `{ respuesta: "..." }` controlado — la MISMA forma de respuesta que el servidor real entrega, con el mismo contrato (`chat-client.ts:197-211`). Todo el código bajo prueba (`agregarTurno`, `nodoSpan`, `horaActual`, `CHAT_CSS`) corre sin ningún doble; sólo se evita la llamada de red al modelo, que es la única pieza que este entorno no puede ejercitar. El texto del segundo turno de "Arnés" es exactamente el eco real calculado en el punto anterior — no un texto inventado.

## 1. `npm run build` + arranque desde `dist/`

```
$ npm run build
tsc -p tsconfig.json
(sin salida — sin errores)

$ WEB_PORT=8793 node dist/main.js < /dev/null
```

El servidor levantó correctamente desde `dist/` (no `tsx`). La TUI (`ink`) tira el error esperable de `raw mode` al correr sin TTY — no afecta al adaptador web:

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8793/chat
200
```

## 2. CSP real, sin cambios

```
$ curl -sD - -o /dev/null http://localhost:8793/chat
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Literal idéntico al de `docs/progreso/v3.9-chat-web-empleado/verificacion-manual-tarea-13.md` §3 — `style-src 'self'` ya cubre las 8 reglas nuevas de `CHAT_CSS` (tarea 3) sin ningún cambio de política. `renderChatHtml()` y `CSP_CHAT` no aparecen en el diff de esta rama (confirmado en §6).

## 3. Empleado de prueba y login real

```
$ echo "VerifChat123!" | npm run empleados:crear -- verif-ergo-v311
Empleado verif-ergo-v311 creado.
```

Login real vía UI (`POST /login` real, token real en closure de `chat-client.js`) — pantalla de login servida con el fondo claro real de `CHAT_CSS` (se forzó `color-scheme: light` en el navegador de verificación, porque el modo oscuro forzado del navegador enmascaraba el fondo blanco real de la página — no es un cambio de la app, es una corrección de la emulación del navegador de verificación).

## 4. ★ Captura del eco real de `registrar_venta` (Unit 1)

Salida completa del script temporal:

```
=== Eco real de registrar_venta (ejecutarOperacion, dispatcher real) ===
Venta registrada: vendedor Juan Pérez, cliente cliente-verif-4 (venta venta-manual-4, caso caso-manual-3). Notificación al cliente: sí. Link de confirmación: https://ventas.example.com/confirmar/token-n/a.
--- verificaciones ---
contiene 'Juan Pérez': true
contiene 'cliente-verif-4': true
contiene 'venta-manual-4': true
contiene 'caso-manual-3': true
contiene '@' (NO debe): false
contiene '4200' (NO debe): false
contiene 'premium' (NO debe): false
```

Nombra al vendedor (`Juan Pérez`) y al cliente (`cliente-verif-4`); conserva `ventaId`/`casoId` etiquetados (`venta venta-manual-4, caso caso-manual-3`) y distinguibles entre sí; **no** contiene el email del cliente ni el carácter `@` (el input tenía `clienteEmail: "cliente-verif-4@example.com"` en scope); **no** contiene el monto (`4200`) ni el plan (`premium`) — no-regresión de alcance (ADR 221 pto 4).

Este mismo texto se usó, verbatim, como respuesta stubeada de "Arnés" en el turno 2 del chat de la sección siguiente — así que también queda capturado renderizado en un `turno-arnes` real, no sólo como texto de consola.

## 5. ★ Captura del chat con cuatro turnos alternados (Unit 2)

Sesión real en el navegador (Browser pane, `color-scheme: light`): dos mensajes enviados desde la UI real, con `fetch("/operaciones", ...)` interceptado (ver §0) para devolver, en orden: (i) el eco real de §4, (ii) una respuesta corta genérica.

**Descripción visual de la captura** (pantalla completa del `#mensajes`, fondo claro):

- Turno 1 — barra izquierda **verde** (`#1b5e20`), etiqueta **"Vos"** en negrita verde, hora `17:19`, texto: *"Quiero registrar una venta nueva. Vendedor: Juan Pérez. Cliente: cliente-verif-4, monto 4200, plan premium."*
- Turno 2 — barra izquierda **azul** (`#0d47a1`), etiqueta **"Arnés"** en negrita azul, hora `17:19`, texto: el eco real de §4 completo.
- Turno 3 — barra verde, "Vos", `17:19`, texto: *"Gracias. ¿Eso es todo lo que necesito hacer por ahora?"*
- Turno 4 — barra azul, "Arnés", `17:19`, texto: *"Listo, quedó todo registrado. ¿Necesitás algo más?"*

Cuatro turnos, dos colores, dos etiquetas, cuatro horas visibles — como exige el checklist. Confirmado además por lectura directa del DOM real (no sólo visual):

```json
[
  { "className": "turno turno-empleado", "hijos": [
      { "className": "turno-hora", "texto": "17:19" },
      { "className": "turno-autor", "texto": "Vos" },
      { "className": "turno-texto", "texto": "Quiero registrar una venta nueva. Vendedor: Juan Pérez. Cliente: cliente-verif-4, monto 4200, plan premium." } ] },
  { "className": "turno turno-arnes", "hijos": [
      { "className": "turno-hora", "texto": "17:19" },
      { "className": "turno-autor", "texto": "Arnés" },
      { "className": "turno-texto", "texto": "Venta registrada: vendedor Juan Pérez, cliente cliente-verif-4 (venta venta-manual-4, caso caso-manual-3). Notificación al cliente: sí. Link de confirmación: https://ventas.example.com/confirmar/token-n-a." } ] },
  { "className": "turno turno-empleado", "hijos": [
      { "className": "turno-hora", "texto": "17:19" },
      { "className": "turno-autor", "texto": "Vos" },
      { "className": "turno-texto", "texto": "Gracias. ¿Eso es todo lo que necesito hacer por ahora?" } ] },
  { "className": "turno turno-arnes", "hijos": [
      { "className": "turno-hora", "texto": "17:19" },
      { "className": "turno-autor", "texto": "Arnés" },
      { "className": "turno-texto", "texto": "Listo, quedó todo registrado. ¿Necesitás algo más?" } ] }
]
```

Cada turno tiene exactamente 3 hijos (`turno-hora`/`turno-autor`/`turno-texto`, en ese orden), `className` en propiedad string (nunca `classList`), dos autores únicamente — sin escritor de "sistema".

## 6. ★ Captura en escala de grises

Se aplicó `document.documentElement.style.filter = "grayscale(100%)"` (inyección de verificación en el propio navegador, no un cambio de la app) sobre la misma pantalla de 4 turnos. Resultado: la distinción entre "Vos" y "Arnés" **se mantiene íntegra** sin el color — la etiqueta de texto en negrita ("Vos" / "Arnés") sigue siendo el portador primario, y la barra lateral izquierda sigue presente como segundo portador (dos tonos de gris perceptiblemente distintos, consistente con el cálculo de contraste ya documentado en `design.md` §6: `#1b5e20` ≈ 8.4:1, `#0d47a1` ≈ 9.7:1, ambos AAA contra fondo blanco). Confirma ADR 222 pto 5 / R6 — el color nunca es el único portador. Filtro removido después de la captura.

## 7. `git diff main` de cierre

```
$ git diff --stat main -- src/core/ventas/
(vacío)

$ git diff --stat main -- src/core/auth/
(vacío — modelo de rol y sesion.ts sin tocar)

$ git diff --stat main -- src/adapters/web/server.ts src/adapters/web/config.ts
(vacío — cero cambio de servidor, rutas, payloads o CSP)

$ git diff --stat main -- src/adapters/memory/
(vacío — cero cambio de esquema/migraciones)

$ git diff --stat main -- package.json
(vacío — sin dependencias nuevas)

$ git diff --stat main
 src/adapters/web/chat-client.test.ts            | 141 +++++++++++++++++++++---
 src/adapters/web/chat-client.ts                 |  46 ++++++--
 src/adapters/web/chat-page.test.ts              |  39 +++++++
 src/adapters/web/chat-page.ts                   |  21 ++++
 src/adapters/web/server.test.ts                 |   2 +-
 src/core/operaciones/ejecutar-operacion.test.ts |  99 ++++++++++++++++-
 src/core/operaciones/ejecutar-operacion.ts      |  16 ++-
 7 files changed, 337 insertions(+), 27 deletions(-)
```

`src/adapters/web/server.test.ts` (+1/-1) es el fix mecánico de la regex de parsing, autorizado explícitamente por el checkpoint durante la tarea 1 (gap de diseño no listado en `design.md` §9 — el test acoplaba su extracción de `ventaId`/`casoId` al formato viejo del eco). No es lógica de negocio ni de seguridad; queda documentado como excepción, no como alcance filtrado.

Los requirements de seguridad vigentes de `chat-web-empleado` (sin `innerHTML`, CSP, `textContent`) siguen intactos — ninguno editado, ninguno relajado; `chat-client.ts` sigue prohibiendo `innerHTML`/`outerHTML`/`eval`/`new Function` (ahora con 3 entradas más en `IDENTIFICADORES_PROHIBIDOS`: `.style`, `cssText`, `setAttribute`, sin tocar las 10 vigentes).

## 8. `npm test` / `npm run typecheck` / lint

```
$ rm -rf dist && npm test
 Test Files  137 passed | 1 skipped (138)
      Tests  2493 passed | 3 skipped (2496)

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)

$ npm run lint
→ no existe script "lint" en package.json — N/A para este proyecto (mismo hallazgo que v3.8/v3.10)
```

`dist/` se limpió antes de `npm test` (gotcha ya documentado del repo: Vitest recoge también los `.test.js` compilados si `dist/` queda poblado).

## 9. Cierre

Servidor apagado limpiamente (puerto 8793 liberado). Script temporal `verificacion-tarea-4-temp.ts` borrado tras capturar su salida — no quedó en `git status`. Único archivo de negocio creado: empleado de prueba `verif-ergo-v311` (sin datos de venta reales persistidos — la venta del eco fue calculada por el script contra dobles de store, nunca escrita en la base real).

## 10. Resultado

| # | Ítem del checklist (`tasks.md`, tarea 4 / `proposal.md` Success Criteria) | Resultado |
|---|---|---|
| 1 | Captura del eco de `registrar_venta`: nombra vendedor y cliente, sin email, ids etiquetados | ✅ §4 |
| 2 | Captura del chat con ≥4 turnos alternados: dos colores, dos etiquetas, cuatro horas visibles | ✅ §5 |
| 3 | ★ Captura en escala de grises: autor y barra lateral distinguen igual sin color | ✅ §6 |
| 4 | `git diff main`: cero `src/core/ventas/`, cero esquema/migraciones, cero modelo de rol/`sesion.ts`, cero `server.ts`/rutas/payloads/CSP, cero deps nuevas | ✅ §7 (excepción documentada: `server.test.ts` +1/-1, autorizada en tarea 1) |
| 5 | CSP no cambió — verificado por `git diff`, no sólo por tests | ✅ §2, §7 |
| 6 | Requirements de seguridad vigentes de `chat-web-empleado` intactos | ✅ §7 |
| 7 | `npm test`, `npm run typecheck` y lint en verde | ✅ §8 |

**Hallazgo de método, no bloqueante**: igual que la tarea 19 de `aprobacion-conversacional-hitl`, esta verificación no ejercitó el Claude Agent SDK real (sin `ANTHROPIC_API_KEY` en este entorno) — el turno de "Arnés" en el chat es una respuesta de red interceptada, con el texto real que produce el dispatcher (§4), no un texto inventado. La elección real del modelo de invocar `registrar_venta` y redactar su respuesta ya está cubierta por otros mecanismos (prompt/skills, fuera del alcance de este change) — lo que este documento verifica es el resultado final: qué texto compone el dispatcher y cómo lo renderiza el cliente real.
