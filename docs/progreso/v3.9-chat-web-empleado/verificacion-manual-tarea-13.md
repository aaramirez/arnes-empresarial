# Verificación manual de cierre — `chat-web-empleado` (tarea 13)

**Fecha**: 2026-09-15
**Rama**: `hito/v3.9-chat-web-empleado`
**Ejecutor**: verificación manual end-to-end con navegador real (Browser pane), tarea 13 de `openspec/changes/chat-web-empleado/tasks.md`. Molde de `docs/progreso/v3.6-operaciones-conversacionales/verificacion-manual-tarea-15.md`, pero con capturas de la interfaz real en vez de `curl` — cierra explícitamente la brecha que esa evidencia dejó a la vista.

## 1. `npm run build` + arranque desde `dist/` (verificación explícita de R12)

```
$ npm run build
tsc -p tsconfig.json
(sin salida — sin errores)

$ WEB_PORT=8791 node dist/main.js
```

El servidor levantó correctamente desde `dist/` (no `tsx`/`npm run dev`), confirmando que `CHAT_CLIENT_JS`/`CHAT_CSS` son `string`s exportados y no archivos sueltos que el build tuviera que copiar (R12 del diseño). La TUI (`ink`) tira un error de `raw mode` esperable al correr en background sin TTY — no afecta al adaptador web, que quedó escuchando:

```
$ Get-NetTCPConnection -LocalPort 8791
LocalPort: 8791, State: Listen, OwningProcess: node
```

## 2. Empleados de prueba

```
$ echo "TestChat123!" | npm run empleados:crear -- verif-chat-v39
Empleado verif-chat-v39 creado.

$ echo "TestChat456!" | npm run empleados:crear -- verif-chat-v39-b
Empleado verif-chat-v39-b creado.
```

## 3. CSP real, sin bloqueos

`GET /chat` en un navegador real, cabeceras:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Literal exacto de `CSP_CHAT` (`config.ts`). La página cargó, el CSS se aplicó y el JS externo (`/chat/app.js`) se ejecutó sin ningún bloqueo de la política — confirmado visualmente (login renderizado, formulario funcional) y por red: `GET /chat`, `/chat/app.css`, `/chat/app.js` → los tres `200 OK`.

## 4. Token nunca en storage/cookies

Antes de loguear:
```js
{ localStorage: [], sessionStorage: [], cookies: "" }
```
Después de loguear y de varios turnos de chat:
```js
{ localStorage: [], sessionStorage: [], cookies: "" }
```
El token vive exclusivamente en memoria de módulo del `chat-client.js` — nunca tocó ninguna superficie persistente ni el DOM.

## 5. Memoria multi-turno de punta a punta (★ Success Criterion)

Empleado `verif-chat-v39`, login vía UI, tres turnos reales contra el agente (Claude Agent SDK real, sin mocks):

**Turno 1** — registrar una venta (establece contexto):
> *Vos*: "Mi nombre de vendedor es Vendedor Prueba V39. Quiero registrar una venta nueva. Cliente: cliente-verif-v39... Monto pactado: 5000."
> *Arnés*: venta registrada, `Venta ID 2fce7277-...`, `Caso aa88ca8d-...`, link de confirmación con token `4b19b246-ee12-48b3-869e-192e92f0ec2f`.

**Turno 2** — referencia deíctica, **sin repetir el token**:
> *Vos*: "El cliente me llamo por telefono y me confirmo que acepta. Por favor confirma esa venta."
> *Arnés*: "Necesito el **token de confirmación** de esa venta... el token sería esa parte final, `4b19b246-ee12-48b3-869e-192e92f0ec2f`. ¿Confirmás que ese es el token correspondiente a esta venta, o tenés otro?"

El agente resolvió correctamente, **sin que el token se repitiera en el mensaje del empleado**, cuál era el token en cuestión — la memoria conversacional (`resume` del SDK vía `casoAnterior()`) funcionó de punta a punta.

**Turno 3** — confirmación:
> *Vos*: "Si, ese es el token correcto. Confirma la venta."
> *Arnés*: "La venta quedó **confirmada**. La herramienta calculó una comisión de **500** para el período **2026-09**."

Los tres turnos se ven en la interfaz real con el markdown del modelo (`**negrita**`, backticks) **renderizado como texto literal** — confirma que el cliente usa `textContent`, no interpreta HTML/Markdown.

## 6. Sesión nueva no hereda la conversación anterior

Tras cerrar sesión (botón "Cerrar sesión" en la UI) y volver a loguear **el mismo empleado** en la misma pestaña, se repitió la pregunta deíctica sin contexto:

> *Vos*: "Confirma esa venta de la que hablamos."
> *Arnés*: "Necesito el **token de confirmación** de esa venta para poder registrarlo — **no tengo contexto previo en esta conversación** sobre a cuál te referís. ¿Me pasás el token?"

Confirma el requirement "una sesión nueva no hereda la conversación anterior" — el token nuevo abre una ranura de conversación nueva en `ConversacionEmpleadoStore`, sin importar que sea el mismo `empleadoId`.

### Hallazgo adicional (no bloqueante, fuera del alcance de las specs de este change)

El contenedor `#mensajes` del cliente (`chat-client.ts:55,69`) **nunca se vacía** — ni al cerrar sesión ni al volver a loguear. El resultado es que, en la misma pestaña/proceso de navegador, el historial visual de la conversación anterior queda pegado en pantalla aunque el servidor ya rotó la memoria real (punto 6 arriba lo prueba: el agente no tiene contexto real, pero el DOM sigue mostrando los mensajes viejos). No es una fuga de memoria conversacional (el servidor está bien) ni viola ninguna spec de este change (ninguna de las 3 exige limpiar el DOM), pero es una inconsistencia de UX/higiene de datos visible en una pestaña reusada por dos logins sucesivos — vale una tarea de seguimiento propia, no bloquea este cierre.

## 7. Aislamiento entre empleados (dos sesiones concurrentes)

Empleado `verif-chat-v39-b` logueado en una **pestaña separada** (contexto de módulo JS independiente): al revisar su transcript, estaba **completamente vacío** — ningún mensaje de `verif-chat-v39` visible ni accesible. Aislamiento por pestaña/token confirmado, sin fuga de contexto entre empleados.

## 8. Intento de XSS en un mensaje real

Mensaje enviado tal cual:
```
<script>alert(1)</script> <img src=x onerror="alert(2)"> prueba de xss, decime que opinas de esto
```

Resultado: se renderizó como **texto literal** tanto en el eco del propio mensaje ("Vos: ...") como en la respuesta del agente (que además explicó qué es un payload de XSS y por qué no lo ejecuta). Verificado en el DOM real:
```js
{ scripts: 1 /* solo app.js legítimo */, imgs: 0, hasInjectedImg: false }
```
Sin diálogos `alert()`, sin errores de consola, sin nodos `<script>`/`<img>` inyectados.

## 9. Logout invalida en servidor

```
$ curl -X POST /logout -H "Authorization: Bearer <token>"
HTTP/1.1 204 No Content

$ curl -X POST /operaciones -H "Authorization: Bearer <mismo token>" -d '{"consulta":"hola"}'
HTTP/1.1 401 Unauthorized

$ curl -X POST /logout -H "Authorization: Bearer <mismo token, ya invalido>"   # idempotencia
HTTP/1.1 204 No Content

$ curl -X POST /logout   # sin token
HTTP/1.1 204 No Content
```

También verificado en la UI: el botón "Cerrar sesión" devuelve a la pantalla de login, sin storage ni cookies remanentes.

## 10. Los cuatro códigos de error

| Código | Verificado | Cómo |
|---|---|---|
| `400` | ✅ real | `POST /operaciones` sin `consulta` → `{"error":"consulta invalida"}`; body no-JSON → `{"error":"JSON invalido"}` |
| `401` | ✅ real, en UI real | Token inválido/ausente → `401`; en la UI: "Tu sesión venció. Volvé a ingresar — tu mensaje quedó guardado." **con el texto del `<textarea>` conservado** (verificado leyendo el `value` del textarea oculto tras el 401) y **sin reenvío automático** |
| `502`/`504` | cubiertos por `chat-client.test.ts` (unitario) | No reproducibles de forma segura en este entorno sin degradar artificialmente el SDK/red real — mismo criterio que la autoconfirmación-mismo-turno en el precedente de v3.6 (escenario ya cubierto por test unitario con doble de `fetch`, no por esta verificación manual) |

La tabla de mensajes literales por código (`MENSAJES_ERROR`) ya está verificada carácter por carácter en `chat-client.test.ts` (parte del `sdd-verify` de este change) — acá se confirma que el camino real (`400`/`401`) dispara esos mismos códigos desde el servidor real.

## 11. `git diff` de cierre

```
$ git diff --stat main -- package.json
(vacío — sin dependencias nuevas)

$ git diff --stat main -- src/adapters/web/assemble-context.ts src/adapters/web/confirmacion-operaciones-store.ts src/adapters/web/render.ts
(vacío — núcleo compartido sin tocar)
```

`handleLogin` sin ninguna línea modificada; `handleOperaciones` con sólo las 2 líneas aditivas (resolución de `conversacion` + log sin token) descritas en la tarea 4 — ya confirmado en el `sdd-verify` previo a esta verificación manual.

## 12. `npm test` / `npm run typecheck`

```
$ npm test
 Test Files  137 passed | 1 skipped (138)
      Tests  2413 passed | 3 skipped (2416)

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)
```

**Nota operativa**: un primer `npm test` corrido con `dist/` todavía poblado del build de la sección 1 reportó `33 failed` de `276` archivos — es el artefacto ya conocido de este repo (Vitest recoge también los `.test.js` compilados en `dist/`, que fallan contra aserciones pensadas para el `.ts` fuente, ej. "no tiene imports"). Se limpió `dist/` (`rm -rf dist`) y se corrió de nuevo: **137/2413 en verde**, sin relación con el código de este change.

## 13. Cierre

Servidor apagado limpiamente (`Stop-Process`), puerto 8791 liberado. Ningún archivo de `src/` fue modificado durante esta verificación — sólo se crearon dos empleados de prueba (`verif-chat-v39`, `verif-chat-v39-b`) y datos de negocio ficticios (venta con cliente `@example.com`, dominio reservado IANA).

## 14. Resultado

| # | Ítem del checklist (`tasks.md`, tarea 13) | Resultado |
|---|---|---|
| 1 | Memoria multi-turno de punta a punta | ✅ 3 turnos reales, referencia deíctica resuelta sin repetir el token |
| 2 | Confirmación exige turno posterior, memoria activa | ✅ (cubierto también por unitarios — no reproducible el caso mismo-turno por HTTP, igual criterio que v3.6) |
| 3 | Aislamiento entre empleados | ✅ dos sesiones concurrentes, sin fuga de contexto |
| 4 | CSP activa y la interfaz funciona con ella puesta | ✅ literal exacto, cero bloqueos |
| 5 | XSS real, texto mostrado literal | ✅ sin ejecución, sin nodos inyectados |
| 6 | Los 4 códigos de error | ✅ `400`/`401` reales; `502`/`504` cubiertos por unitarios (no reproducibles sin fault injection) |
| 7 | Token ausente de storage/URL/DOM | ✅ verificado antes y después de login, y tras varios turnos |
| 8 | Logout invalida en servidor | ✅ `401` tras `/logout`, idempotente |
| 9 | `npm run build` + arranque desde `dist/` | ✅ server real sirviendo `/chat` desde `dist/main.js` |
| 10 | `git diff main` de cierre | ✅ sin deps nuevas, núcleo compartido intacto |
| 11 | `npm test`, `npm run typecheck` | ✅ 2413/2413, sin errores de tipos |

**Hallazgo adicional no bloqueante**: el DOM de mensajes no se limpia entre logout/login en la misma pestaña (sección 6) — sugerido como tarea de seguimiento, no bloquea este cierre.
