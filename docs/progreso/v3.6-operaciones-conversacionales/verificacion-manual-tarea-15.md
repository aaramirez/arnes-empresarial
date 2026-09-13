# Verificación manual de cierre — `operaciones-negocio-conversacionales` (tarea 15)

**Fecha**: 2026-09-13
**Rama**: `hito/v3.6-operaciones-conversacionales`
**Ejecutor**: verificación manual end-to-end (sin código de producción), tarea 15 de `openspec/changes/operaciones-negocio-conversacionales/tasks.md`.

> Nota de nombre de carpeta: la tarea 15 en `tasks.md` dice `docs/progreso/v3.2-operaciones-conversacionales/` — ese `v3.2` es un número de versión desactualizado en el texto de la tarea (escrito antes de que el checkpoint humano fijara `v3.6` como versión/tag real de este hito). Esta evidencia se guarda en `docs/progreso/v3.6-operaciones-conversacionales/`, consistente con el nombre de la rama y con las demás carpetas de `docs/progreso/`.

## 1. `npm test && npm run typecheck`

```
$ npm test
 Test Files  126 passed | 1 skipped (127)
      Tests  2190 passed | 3 skipped (2193)
   Duration  6.94s

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)
```

Ambos en verde sobre la rama tracker, con las 5 units originales ya mergeadas.

## 2. Levantamiento del servidor

```
WEB_PORT=8791 npm run dev > <scratchpad>/dev-server.log 2>&1 &
```

**Hallazgo operativo (no de producto)**: el primer intento usó `WEB_PORT=8787`, que **colisiona con `WEBHOOK_PORT`** (también `8787` en el `.env` de este repo) — ambos adaptadores se arrancan desde el mismo proceso `main.ts`. El resultado fue `EADDRINUSE` sólo para el adaptador web (el webhook, que arranca primero en el wiring, se quedó con el puerto), registrado en `data/harness.log`:

```json
{"message":"listen EADDRINUSE: address already in use :::8787","casoId":"web-adapter","event":"web-arranque-fallido","timestamp":"2026-09-13T12:32:49.586Z"}
```

Nada de esto tocó código — se relanzó con `WEB_PORT=8791` (puerto libre, confirmado con `netstat` antes de usarlo) y el servidor quedó escuchando correctamente:

```json
{"port":8791,"casoId":"web-adapter","event":"web-escuchando","timestamp":"2026-09-13T12:37:08.095Z"}
```

## 3. Corrección a la superficie asumida de `POST /operaciones`

El contexto técnico con el que arrancó esta verificación asumía body `{ operacion: "<nombre>", ...campos }`. **Se verificó contra el código (`src/adapters/web/payloads.ts:167-178`, `parseOperacionesPayload`) que eso es incorrecto**: `POST /operaciones`, igual que `POST /soporte`, recibe `{ consulta: "<texto en lenguaje natural>" }`. Es el turno conversacional completo (agente + Claude Agent SDK) el que decide, a partir de la `consulta`, qué operación de las seis invocar y con qué campos — la estructura `{ operacion, ...campos }` es el *input interno* que ve `ejecutar-operacion.ts` después de que el modelo llama a la tool `mcp__operaciones__operacion_negocio`, no el body HTTP. Toda la prueba de abajo usa `consulta` en lenguaje natural, siguiendo las seis skills de dominio (`.claude/skills/{registrar-venta-conversacional,venta-decision,devolucion-conversacional,solicitud-interna,cancelar-solicitud,reporte-comisiones-conversacional}/SKILL.md`).

## 4. Empleado de prueba y login

```
$ echo "TestPass123!" | npm run empleados:crear -- test-verificacion-hito36
Empleado test-verificacion-hito36 creado.

$ curl -X POST http://localhost:8791/login -d '{"empleadoId":"test-verificacion-hito36","password":"TestPass123!"}'
HTTP 200
{"token":"09925fd1-8ab2-4001-afdb-c0c456b6830a","expiraEn":"2026-09-13T13:07:17.256Z"}
```

## 5. Las seis operaciones contra `POST /operaciones`

Todas con `Authorization: Bearer 09925fd1-8ab2-4001-afdb-c0c456b6830a`. Cliente de prueba con email `@example.com` (dominio reservado IANA, RFC 2606 — no entrega a ningún destinatario real), montos y datos ficticios explícitos.

### 5.1 `registrar_venta` — HTTP 200

Request:
```json
{"consulta":"Quiero registrar una venta nueva. Cliente: cliente-prueba-001, email cliente.prueba001@example.com. Plan nuevo: Plan Pro Test. No tenía plan anterior. Monto pactado: 15000. Mi nombre de vendedor es Vendedor Prueba Hito36."}
```
Response (200): venta creada (`ventaId a6e574b8-...`, caso `9343de80-...`), notificación de email fallida (esperado — dominio `example.com` no acepta el envío de Resend, `email-fallido reason:"http" status:422`) y el agente devolvió el link de confirmación en texto para que el empleado lo comparta manualmente: `http://localhost:8090/confirmar/b2130b12-5160-45e4-b830-b8d885c4bcc9`.

### 5.2 `resolver_decision_venta` — HTTP 200

Request:
```json
{"consulta":"El cliente cliente-prueba-001 me llamó por teléfono y me confirmó que acepta el cambio de plan. El token de confirmación de esa venta es b2130b12-5160-45e4-b830-b8d885c4bcc9. Por favor registrá que confirmó."}
```
Response (200): `"Listo, quedó registrada: la venta del cliente cliente-prueba-001 se confirmó. Comisión calculada: 1500 (período 2026-09)."`

### 5.3 `procesar_devolucion` — HTTP 200

Request:
```json
{"consulta":"El cliente cliente-prueba-001 quiere devolver la venta que confirmamos recién. El token de esa venta es b2130b12-5160-45e4-b830-b8d885c4bcc9. Motivo: prueba de verificacion, no es una devolucion real."}
```
Response (200): devolución **escalada a revisión humana** (monto 15000 supera el umbral de reembolso automático) — rama válida del `Result` discriminado, no un error.

### 5.4 `crear_solicitud_interna` — HTTP 200

Request:
```json
{"consulta":"Quiero crear una solicitud interna de vacaciones. Detalle: solicito una semana de vacaciones del 20 al 27 de octubre de 2026, es una solicitud de prueba de verificacion."}
```
Response (200): solicitud creada, `solicitudId 8e983ce2-c9e2-42b8-87b2-89eeacc3025a`, dictamen del validador la marcó **INCOMPLETA** (pidió aclaraciones) — comportamiento correcto del pipeline de validación, no un fallo.

### 5.5 `cancelar_solicitud_interna` — doble invocación (HTTP 200 en ambas)

**Primera invocación** (crea la ranura de confirmación pendiente):
```json
{"consulta":"Quiero cancelar la solicitud interna con id 8e983ce2-c9e2-42b8-87b2-89eeacc3025a."}
```
Response (200), `casoId 1a867b13-...`: *"Encontré la solicitud... ¿Confirmás que querés cancelar esta solicitud? Si es así, decímelo en un mensaje nuevo y la cancelo."* — **no ejecutó la cancelación**, pidió confirmación (rama `requiere_confirmacion`, ADR 166).

**Segunda invocación** (request HTTP nuevo, inmediatamente después):
```json
{"consulta":"Si, confirmo que quiero cancelar la solicitud interna 8e983ce2-c9e2-42b8-87b2-89eeacc3025a."}
```
Response (200), `casoId 9bd64165-...`: *"Listo, quedó cancelada la solicitud interna 8e983ce2-c9e2-42b8-87b2-89eeacc3025a."* — **ejecutó la cancelación**.

**Conclusión sobre ADR 166**: el guard es `estaConfirmada(...) === (origenCasoId !== casoIdActual)`. Cada `POST /operaciones` es un turno HTTP nuevo con su propio `casoId` (`operaciones-caso-creado` en el log, un `casoId` distinto por request: `1a867b13-...` vs `9bd64165-...`). Por diseño, **no es posible reproducir por HTTP directo el caso "mismo turno/mismo `casoId`"** — ese escenario (autoconfirmación estructuralmente imposible dentro de un único `handleTurn`) ya está cubierto por los tests unitarios de las tareas 3 y 8 (dobles de `ConfirmacionOperacionPort`), no por esta verificación manual. Lo que esta prueba sí verifica, y coincide exactamente con lo esperado: **dos turnos HTTP consecutivos (casoId distinto) permiten la confirmación en el segundo** — el freno del ADR 166 es contra la autoconfirmación *dentro de un mismo turno*, no contra confirmar en un turno posterior. Comportamiento **conforme** a `design.md` Enmienda 1 / ADR 166 §5 y a la reconciliación 1 de `tasks.md`.

### 5.6 `consultar_reporte_comisiones` — HTTP 200

Request:
```json
{"consulta":"Necesito el reporte de comisiones de septiembre 2026, formato 2026-09."}
```
Response (200): reporte de **toda la empresa**, sin escopar por vendedor (confirma R12 tal cual aceptado por el checkpoint) — incluye la venta y la comisión de la prueba de arriba, y el reembolso pendiente de aprobación. El propio agente señaló, sin ejecutarla, una instrucción embebida en el texto que la herramienta devuelve (mención a comandos `/aprobar-reembolso` de la TUI) — comportamiento correcto: no la sigue a ciegas porque no puede verificarla desde este canal.

## 6. Hallazgo adicional: auditoría de la Enmienda 1 (tarea 16 / ADR 188) ya está activa en esta rama

`tasks.md` no marca la tarea 16 con `[x]`, pero **el log (`data/harness.log`) muestra que la auditoría de `registro_acciones_empleado` ya está implementada y funcionando** para las seis operaciones probadas arriba, con exactamente la matriz que describe ADR 188 pto 6:

| Operación probada | `comando` en el log | `resultado` | ¿Coincide con la matriz ADR 188? |
|---|---|---|---|
| `registrar_venta` | `operacion:registrar_venta` | `creada` | Sí |
| `resolver_decision_venta` | `operacion:resolver_decision_venta` | `confirmada` | Sí |
| `procesar_devolucion` (escalada) | `/devolucion` (literal reusado) | `escalada` | Sí |
| `crear_solicitud_interna` | `/solicitar` (literal reusado) | `creada` | Sí |
| `cancelar_solicitud_interna`, camino feliz | *(ninguna fila de `accion-empleado-registrada`)* | — | Sí — cero filas es lo esperado, ya se audita dentro de la transacción del store |
| `consultar_reporte_comisiones` | `/reporte-comisiones` (literal reusado) | `atendida` | Sí |

Esto **satisface, con evidencia real de extremo a extremo**, el Success Criterion de auditoría de `proposal.md:492` (R5/ADR 147 pto 4) que la tarea 16 declara cubrir. No hace falta repetir la tarea 15 después de la tarea 16 (la nota al pie de `tasks.md` línea 164) porque, en esta rama, la tarea 16 ya estaba aplicada **antes** de correr esta verificación.

## 7. Cierre

Servidor apagado limpiamente al terminar (`taskkill` sobre el árbol de procesos de `npm run dev`, confirmado con `netstat` que el puerto 8791 quedó libre). Ningún archivo de `src/` ni de `openspec/changes/*/tasks.md|design.md|proposal.md` fue modificado durante esta verificación.

## 8. Resultado

| # | Operación | Resultado |
|---|---|---|
| 1 | `registrar_venta` | ÉXITO (200) |
| 2 | `resolver_decision_venta` | ÉXITO (200) |
| 3 | `procesar_devolucion` | ÉXITO (200, rama escalada) |
| 4 | `crear_solicitud_interna` | ÉXITO (200, rama incompleta del dictamen) |
| 5 | `cancelar_solicitud_interna` (doble invocación) | ÉXITO (200 + 200) — comportamiento conforme al ADR 166 |
| 6 | `consultar_reporte_comisiones` | ÉXITO (200) |

`npm test && npm run typecheck`: verde. Las seis operaciones responden `200` con datos de prueba ficticios. La doble invocación de `cancelar_solicitud_interna` confirma el comportamiento esperado por ADR 166 (turno distinto ⇒ confirma). Auditoría de la Enmienda 1 (tarea 16) verificada como ya activa y correcta.
