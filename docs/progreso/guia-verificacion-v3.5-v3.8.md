# Guía de verificación manual — hitos v3.5.0 a v3.8.0

Guía para probar a mano, sobre el repo real (`main`, ya con los 4 hitos mergeados), las funcionalidades agregadas en cada uno. Pensada para verificar que el proyecto cumple lo esperado, no como sustituto de `npm test`.

**Antes de arrancar cualquier prueba**:

```bash
npm run typecheck && npm test
```

Debe quedar todo en verde (al cierre de v3.8.0: 133 archivos, 2336 tests, 0 fallos). Si algo falla acá, no tiene sentido seguir con la verificación manual.

**Datos de prueba**: no hay script de `seed` en `package.json`. Para sembrar ventas/solicitudes/actividades sin pasar por el modelo (y sin gastar tokens de la API), hay que escribir un driver throwaway que llame directo a `src/adapters/memory/repository.ts` (`createActividad`, `crearSolicitudConCaso`, `crearVentaConCaso`, `confirmarVentaConComision`, `escalarReembolso`) sobre `openDatabase("data/harness.db")`. Ejemplos reales de este patrón: `docs/progreso/v3.5-autorizacion-empleado/evidencia-verificacion-manual.md` (sección 1) y `docs/progreso/v3.8-consultas-negocio-a2a-entrante/evidencia-verificacion-manual-tarea-15.md` (sección 1). Si preferís no escribir ese driver, muchas de las pruebas de abajo se pueden hacer igual generando los datos EN VIVO a través de la propia TUI (ej. `/solicitar` para crear una solicitud interna real antes de probar `/aprobar-solicitud`).

---

## v3.5.0 — Autorización de empleados (roles)

**Qué verifica**: un empleado con rol base no puede resolver solicitudes/reembolsos ajenos; un administrador sí puede, pero ni el admin puede aprobar lo propio.

1. Crear empleados y asignar un rol:

```bash
npm run empleados:crear -- beto      # pide password por stdin
npm run empleados:crear -- carla
npm run empleados:crear -- ana
npm run empleados:crear -- ana --rol administrador   # SIN password, sólo asigna rol
```

`--rol` sólo acepta `empleado` (default implícito) o `administrador` — cualquier otro valor debe rechazarse.

2. Arrancar la TUI:

```bash
npm run dev
```

3. Con `beto` (rol base) intentando algo **ajeno**:

```
/login beto <password-beto>
/aprobar-solicitud <id-de-una-solicitud-de-carla>
```

Esperado: `No estás autorizado para aprobar esa solicitud: se requiere rol elevado.` — repetir con `/aprobar-reembolso <id>` sobre una venta ajena en `reembolso_pendiente`, mismo resultado.

4. Con `carla` sobre lo **propio** (autoservicio, sin gate de rol):

```
/logout
/login carla <password-carla>
/cancelar-solicitud <id-de-una-solicitud-propia-de-carla>
```

Esperado: cancela sin problema — el gate de rol no debe tocar el autoservicio sobre lo propio.

5. Elevar a `ana` en caliente (**sin reiniciar** la TUI que ya está corriendo) desde otra terminal:

```bash
npm run empleados:crear -- ana --rol administrador
```

6. Con la sesión de `ana` ya montada:

```
/logout
/login ana <password-ana>
/aprobar-solicitud <id-ajena>     → debe aprobar (rol elevado sin relogin)
/aprobar-reembolso <id-ajena>     → debe aprobar
/aprobar-solicitud <id-propia-de-ana>   → "No podés aprobar tu propia solicitud, aunque tengas rol elevado."
```

El último paso es el más importante: confirma que el rol elevado **no** anula la prohibición de autoaprobación.

Referencia con el guion completo y salidas reales: [`docs/progreso/v3.5-autorizacion-empleado/evidencia-verificacion-manual.md`](v3.5-autorizacion-empleado/evidencia-verificacion-manual.md).

---

## v3.6.0 — Operaciones de negocio conversacionales (canal web)

**Qué verifica**: un empleado autenticado por HTTP puede ejecutar las 6 operaciones de negocio en lenguaje natural, con confirmación por token en las sensibles.

1. Arrancar con el servidor web habilitado (puerto distinto del webhook, que también usa 8787 por default):

```bash
WEB_PORT=8791 npm run dev
```

2. Login (devuelve un token de sesión):

```bash
curl -s -X POST http://localhost:8791/login \
  -H "Content-Type: application/json" \
  -d '{"empleadoId":"ana","password":"<password-ana>"}'
```

3. Ejecutar una operación en **lenguaje natural** (el endpoint espera `{"consulta": "..."}`, no un payload estructurado):

```bash
curl -s -X POST http://localhost:8791/operaciones \
  -H "Authorization: Bearer <token-del-login>" \
  -H "Content-Type: application/json" \
  -d '{"consulta":"Quiero registrar una venta nueva. Cliente: cliente-1, email c1@example.com. Plan Pro. Monto pactado: 15000. Mi nombre de vendedor es Ana Prueba."}'
```

4. Probar las 6 operaciones (todas vía el mismo endpoint, cambiando el texto de `consulta`): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`.

5. Confirmación por token (operaciones sensibles): el flujo de venta emite un link tipo `http://localhost:8090/confirmar/<token>` en el mensaje al cliente — ese `<token>` se pega en el texto de la siguiente `consulta` para `resolver_decision_venta`/`procesar_devolucion` (ej. `"El cliente confirmó la venta, token abc123"`).

6. `cancelar_solicitud_interna` usa confirmación por-turno (dos llamadas HTTP separadas: la primera pide confirmar, una segunda repite la intención para ejecutar).

Referencia con ejemplos completos de request/response reales: [`docs/progreso/v3.6-operaciones-conversacionales/verificacion-manual-tarea-15.md`](v3.6-operaciones-conversacionales/verificacion-manual-tarea-15.md).

---

## v3.7.0 — Comandos de administración de empleados

**Qué verifica**: un segundo gate (administrador) protege comandos administrativos, independiente del gate de autenticación básica.

Con la TUI corriendo (`npm run dev`) y sesión de un empleado con rol **base**:

```
/login beto <password-beto>
/asignar-rol carla administrador
```

Esperado: rechazo — `beto` no es administrador.

```
/crear-empleado nuevo-empleado clave-temporal
```

Esperado: mismo rechazo.

```
/estado-bot-prs
```

Esperado: **sí** responde (no requiere administrador) — pero nunca revela el valor real de `GITHUB_TOKEN`, sólo si está "presente" o "ausente".

Ahora con `ana` (administrador, del paso de v3.5):

```
/logout
/login ana <password-ana>
/asignar-rol beto administrador
/crear-empleado nuevo-empleado clave-temporal
```

Ambos deben funcionar. Probar también la protección contra auto-degradación: `ana` intentando quitarse su propio rol de administrador debería estar bloqueado (revisar el criterio exacto en `docs/progreso/v3.7-comandos-administracion-empleados/verificacion-manual-tarea-12.md`, sección 6, antes de asumir el comportamiento).

---

## v3.8.0 — Consultas de negocio de sólo lectura (canal A2A entrante)

**Qué verifica**: un agente externo, hablando el protocolo A2A (JSON-RPC), puede consultar 4 indicadores de negocio de sólo lectura y **nunca** accede a herramientas de escritura ni a datos personales.

1. Arrancar con el token de A2A entrante habilitado (sin este token, el servidor A2A entrante ni siquiera abre el puerto):

```bash
HARNESS_A2A_ENTRANTE_TOKEN=mi-token-de-prueba npm run dev
```

Puerto por defecto: `8888` (`HARNESS_A2A_ENTRANTE_PORT` para cambiarlo).

2. Confirmar que la Agent Card pública ya no promete "incidentes"/"proyectos" (correcciones de la tarea 11):

```bash
curl -s http://localhost:8888/.well-known/agent-card.json | grep -i "tags\|incidentes\|proyectos\|solicitudes"
```

`tags` no debe contener `"incidentes"` ni `"proyectos"`; sí debe contener `"solicitudes"` y `"solo-lectura"`.

3. Enviar una pregunta de negocio real (el modelo decide internamente si llama a `consultar_negocio` — no hay forma de invocar la tool directo por JSON-RPC, se manda lenguaje natural):

```bash
curl -s -X POST http://localhost:8888/a2a \
  -H "Authorization: Bearer mi-token-de-prueba" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
    "params": {"message": {"messageId": "m1", "role": "user",
      "parts": [{"text": "¿Cuál fue el total comisionado en el período 2026-09?"}]}}
  }'
```

La respuesta trae un `task.id` con estado `TASK_STATE_SUBMITTED`. Consultar el resultado con `GetTask`:

```bash
curl -s -X POST http://localhost:8888/a2a \
  -H "Authorization: Bearer mi-token-de-prueba" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"GetTask","params":{"id":"<task-id-del-paso-anterior>"}}'
```

Cuando el estado es `COMPLETED`, el texto de la respuesta está en `result.task.artifacts[0].parts[0].text`.

4. Repetir con preguntas que ejerciten las otras 3 operaciones:
   - `"¿En qué estado está la revisión del PR 42 del proyecto owner/repo?"` (`estado_actividad`)
   - `"¿Cuántas solicitudes internas quedaron pendientes de aprobación?"` (`solicitudes_pendientes`)
   - `"¿Cuántos reembolsos están pendientes y por qué monto total?"` (`reembolsos_pendientes`)

5. **Verificación de seguridad — la más importante de este hito**: sembrar (con el driver de datos) una venta/solicitud con un nombre de vendedor o cliente bien identificable (ej. `"Nombre Secreto Vendedor"`) y confirmar que ese nombre **nunca** aparece en ninguna de las 4 respuestas — sólo agregados (totales, montos, estados), nunca identidad.

6. Confirmar que una herramienta de escritura NO es alcanzable desde este canal — pedile al agente externo algo que requeriría escribir (ej. `"Registrame una venta nueva"`): debe responder que no puede, nunca ejecutar la operación (el `mcpServers` del turno entrante es exactamente `{conocimiento, consultas}`, sin `operaciones`).

Referencia con la corrida real completa (datos "secretos" sembrados y confirmados ausentes de las 4 respuestas): [`docs/progreso/v3.8-consultas-negocio-a2a-entrante/evidencia-verificacion-manual-tarea-15.md`](v3.8-consultas-negocio-a2a-entrante/evidencia-verificacion-manual-tarea-15.md). Precedentes de invocación A2A por `curl` de hitos anteriores: [`docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md`](v3.0-a2a-servidor/evidencia-verificacion-manual.md), [`docs/progreso/v3.4-comando-visibilidad-a2a-entrante/evidencia-verificacion-manual.md`](v3.4-comando-visibilidad-a2a-entrante/evidencia-verificacion-manual.md).

---

## Arranque combinado (todo a la vez)

```bash
HARNESS_A2A_ENTRANTE_TOKEN=mi-token-de-prueba WEB_PORT=8791 npm run dev
```

Esto deja disponibles simultáneamente: la TUI (v3.5/v3.7), el servidor web (v3.6) y el servidor A2A entrante (v3.8) — todos comparten la misma base SQLite (`data/harness.db`), así que una venta cargada por un canal es visible por los otros.

## Qué NO vas a poder probar sin gastar tokens de la API

Todos los flujos de arriba que dependen de que el **modelo real** interprete lenguaje natural (pasos 3-6 de v3.6 y v3.8) consumen la API de Anthropic de verdad — no hay forma de simularlos sin costo. Si el objetivo es sólo confirmar que el código compila/pasa tests, `npm run typecheck && npm test` ya lo cubre; estos pasos son para confirmar el comportamiento de punta a punta con el modelo real.
