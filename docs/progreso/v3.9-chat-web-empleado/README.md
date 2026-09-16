# v3.9.0 — `chat-web-empleado`: evidencia de cierre

**Entregable funcional**: un empleado autenticado chatea con el arnés desde una interfaz web (`GET /chat`) con memoria conversacional real entre mensajes — una referencia deíctica en el turno N+1 resuelve sin repetir el identificador del turno N — sirviendo un cliente vanilla sin `innerHTML`/`eval` bajo una CSP estricta sin `unsafe-inline`, con el token de sesión sólo en memoria de pestaña y `POST /logout` que invalida la sesión en el servidor. `POST /operaciones` y `POST /login` no cambian de contrato salvo dos líneas aditivas en el primero.

**Tareas**: [`openspec/changes/chat-web-empleado/tasks.md`](../../../openspec/changes/chat-web-empleado/tasks.md) — 13 tareas en 3 cadenas de dependencia (A: memoria, tareas 1-4; B: logout, tareas 5-6; C: interfaz de chat, tareas 7-10) más convergencia (tareas 11-13), todas commiteadas en `hito/v3.9-chat-web-empleado`. A diferencia de `consultas-negocio-a2a-entrante`, las cadenas A+B y C no compartían archivo hasta la convergencia — se implementaron y committearon en el orden que `tasks.md` fija, sin necesidad de PRs encadenados.

## Ciclo de Reviewer — tres pasadas

### Primera pasada (`sdd-verify` + `code-review --level high`, diff completo de las tareas 1-10)

- `sdd-verify`: **APROBADO** contra los 12 puntos obligatorios de `tasks.md` (autoconfirmación imposible con memoria activa, turno fallido no avanza memoria, ausencia mecánica de `innerHTML`, CSP literal exacta, etc.), arquitectura hexagonal intacta, cero dependencias nuevas.
- `code-review` (8 ángulos + verificación): **8 hallazgos**, 1 CRÍTICO:
  1. **CRÍTICO** — `respondHtmlChat` seteaba `Content-Security-Policy`/`X-Content-Type-Options` DESPUÉS de `res.end()` (delegado en `respondHtml`) — contra un `http.ServerResponse` real esto lanza `ERR_HTTP_HEADERS_SENT`: `GET /chat` crasheaba en producción, invisible en tests porque el mock no simulaba esa semántica.
  2. ALTO — `chat-client.ts`: el `.then()` de éxito de `manejarEnvio`/`manejarLogin` no atrapaba el rechazo de `respuesta.json()` en un body malformado con status 200 — el chat quedaba trabado en "Esperando respuesta…" para siempre.
  3. ALTO — sin serialización por token en `registrarTurno`: un turno vencido por timeout que sigue corriendo en el fondo (comportamiento preexistente) podía pisar silenciosamente la memoria de un turno más nuevo del mismo token.
  4. MEDIO — `POST /logout` invalidaba la confirmación pendiente de OTRA sesión concurrente del mismo empleado (`confirmacionOperacionesStore` keyeado por `empleadoId`, no por token).
  5. BAJO — doble parseo del bearer token en `handleOperaciones` con un cast `as string` sin chequeo.
  6. BAJO — mensaje de error genérico para status no listados.
  7. Convenciones — formato de commits/scopes de este change no coincide literal con el ejemplo de `AGENTS.md:94-98`, pero es el mismo patrón ya usado en v3.6-v3.8 (deuda de documentación de `AGENTS.md`, no de este change).
  8. Reuse — headers de CSP/nosniff duplicados entre `respondHtmlChat`/`respondAsset`.

### Fix del Implementer, ronda 1 (commits `af6d3ed`, `6b422f4`, `ceae6c7`)

- **Hallazgos 1 y 8**: reordenado `respondHtmlChat` para setear headers antes de `res.end()`; extraídos `aplicarHeadersSeguridadChat`/`aplicarHeadersNoStore` compartidos. Nuevo `StrictFakeResponse` en `server.test.ts` que reproduce `ERR_HTTP_HEADERS_SENT` real.
- **Hallazgo 2**: `.catch()` agregado a ambas cadenas de `fetch(...).then(...)`.
- **Hallazgo 3**: mecanismo de "ticket" incremental por token en `ConversacionEmpleadoStore` — `registrarTurno` es no-op si su ticket quedó superado por un `paraSesion` más reciente del mismo token.
- **Hallazgo 5**: `resolverSesionDesdeRequest` devuelve `{ sesion, token }`; eliminado el doble parseo en `handleOperaciones`.
- **Hallazgo 6**: **NO corregido, correctamente** — el Implementer verificó que el mensaje genérico es literal de ADR 204 (`design.md`), no un bug; tocarlo hubiera reabierto una decisión de diseño ya aprobada sin pasar por Spec Author.
- **Hallazgo 4**: quedó explícitamente **ABIERTO** (ni arreglado ni documentado como deuda) — se convirtió en el bloqueante de la segunda pasada.

### Segunda pasada (`sdd-verify` + `code-review` enfocado en los 3 fixes)

- `sdd-verify`: **RECHAZA** — el hallazgo 4 seguía sin resolver *y* sin declarar como deuda en el arc42, a diferencia de todo otro residual del repo (R1, R5, R7, R11, R12, RD-88 a RD-97), que sí tienen mitigación/condición de disparo explícitas. Motivo citado: *"es exactamente el tipo de vacío que la convención de deuda declarada existe para evitar"*.
- `code-review` (foco en los 3 fixes de ronda 1): 3 hallazgos menores, ninguno bloqueante — escritura parcial en el DOM de `chat-client.ts` antes de un crash por forma de body inesperada; `eliminar` no invalidaba el ticket en vuelo (inocuo hoy, sin test); `handleLogout` sin reusar `resolverSesionDesdeRequest`.

### Fix del Implementer, ronda 2 (commits `74184eb`, `88e4165`, `b80cdfa`)

- **Hallazgo 4 (bloqueante)**: nuevo método aditivo `SesionEmpleadoStore.otraSesionVigente(empleadoId, tokenExcluir)`; `handleLogout` sólo consume la confirmación pendiente si NO hay otra sesión vigente del mismo empleado. `conversacionStore.eliminar`/`sesionStore.eliminar` siguen corriendo siempre. Caso de una sola sesión: sin regresión, probado contra stores reales.
- **Hallazgo de `chat-client.ts`**: valida `cuerpo`/`cuerpo.respuesta` antes de tocar el DOM — un body de forma inesperada cae en la misma rama de error sin escribir ningún turno.
- **Hallazgo de `conversacion-empleado-store.ts`**: flag `invalidada` seteado por `eliminar`, chequeado por `registrarTurno` junto al ticket.
- **Dedup de `resolverSesionDesdeRequest` en `handleLogout`**: **NO aplicado, correctamente** — `resolverSesionDesdeRequest` descarta el token crudo cuando no hay sesión, y `handleLogout` lo necesita para limpiar una sesión vencida-pero-presente; aplicar el dedup rompía ese caso (test existente lo prueba). Documentado in situ en el código en vez de forzarlo — sería una decisión de diseño sobre un contrato compartido con `handleOperaciones`, no una corrección de Implementer.

### Tercera pasada — **APROBADO**

Verificación directa contra el código commiteado (no contra reportes previos):

```
npm test -- server && npm test -- sesion-empleado-store
  88/88 passed

npm test
 Test Files  137 passed | 1 skipped (138)
      Tests  2424 passed | 3 skipped (2427)

npm run typecheck
  (sin salida, sin errores)
```

`otraSesionVigente` reusa la misma lógica de vigencia que `buscar` (una entrada vencida del mismo empleado no cuenta como "otra sesión"); el orden de operaciones en `handleLogout` no tiene ventana de miscount; la validación de forma en `chat-client.ts` corta en `!cuerpo` antes de cualquier acceso a propiedad; `crearEntry()` resetea `invalidada: false` en toda entrada nueva o rotada. Cero hallazgos nuevos.

## Verificación del entregable de punta a punta

Ver [`verificacion-manual-tarea-13.md`](verificacion-manual-tarea-13.md) para el detalle completo: `npm run build` + arranque real desde `dist/main.js`, memoria multi-turno de punta a punta contra el Claude Agent SDK real (sin mocks) con referencia deíctica resuelta, aislamiento entre dos empleados concurrentes, intento de XSS real mostrado como texto literal, CSP real sin bloqueos, logout invalidando en servidor, token nunca en storage/URL/DOM. Un hallazgo adicional no bloqueante quedó documentado ahí (el DOM de `#mensajes` no se limpia entre logout/login en la misma pestaña) — no viola ninguna de las 3 specs de este change, deuda de UX para una tarea de seguimiento propia.

## Checklist de cierre de hito (`AGENTS.md`)

- [x] El Reviewer aprobó explícitamente (tercera pasada, `sdd-verify` + `code-review`, sin hallazgos bloqueantes pendientes).
- [x] El entregable funcional se demuestra de punta a punta (`verificacion-manual-tarea-13.md`) — no sólo compila y pasan los tests unitarios.
- [x] Existe `docs/progreso/v3.9-chat-web-empleado/` con evidencia (este documento + la evidencia de tarea 13).
- [x] Tag semántico `v3.9.0` creado sobre `main`, tras el merge de `hito/v3.9-chat-web-empleado` vía PR #21.

Las cuatro casillas están marcadas — hito cerrado.
