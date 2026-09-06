> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob); no se pudo invocar el binario. Este spec se apoya íntegramente en `proposal.md` (ADR 7, 10 y Approach, ya con checkpoint humano pendiente de aprobación explícita) y en `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-webhook-turn/spec.md` como plantilla de formato. Se recomienda que `sdd-design` corra `graphify explain` sobre `VentaStorePort`, `VentaNotifierPort` y el listener web antes de diseñar.

# Venta Confirmación Specification

## Purpose

Capability nueva. Cubre el ciclo determinista de una venta: alta autenticada, notificación del link único, página pública de confirmación, validación del token, y transición a `confirmada` (con cálculo y persistencia de la comisión en la misma transacción) o `rechazada`. Ningún paso de este ciclo invoca al modelo (ADR 7). `cliente_id` es un identificador opaco: llega en el payload de alta y se guarda tal cual, sin tabla, adaptador ni resolución de identidad propios.

**Fuera de alcance de este spec**: reembolso/devolución (capability `reembolso-evaluacion`), turno de soporte (capability `soporte-web-turno`), reporte mensual (capability `reporte-comisiones-mensual`), tabla `clientes` o CRM, reglas de comisión por producto/tramo, reembolso parcial, portal del vendedor con login.

## Requirements

### Requirement: Listener web opt-in por configuración

El adaptador web SHALL NOT abrir ningún puerto HTTP si `WEB_PORT` no está configurado.

#### Scenario: Sin `WEB_PORT` configurado
- GIVEN el proceso arranca sin `WEB_PORT`
- WHEN se ejecuta `npm run dev`
- THEN la TUI y el adaptador de webhooks de Hito 3 arrancan igual que en `v1.2.0`
- AND no se abre ningún puerto del adaptador web

### Requirement: Alta de venta autenticada, sin invocar al modelo

`POST /ventas` SHALL requerir un token estático válido en `VENTAS_API_TOKEN`; sin ese valor configurado, la ruta SHALL responder `401` siempre. Un alta válida SHALL crear (si no existe) el `vendedor`, un `caso` tipo `'venta'` y la fila de `ventas` en `pendiente_confirmacion` con token y `expires_at`, en una única transacción, sin ninguna llamada al modelo. `cliente_id` SHALL persistirse tal cual llega, sin validación de identidad ni entidad propia.

#### Scenario: Alta válida crea vendedor, caso y venta
- GIVEN un `POST /ventas` con token válido y payload completo (incluye `cliente_id` nuevo)
- WHEN el adaptador procesa la request
- THEN se crea (o reusa) el `vendedor`, un `caso` tipo `'venta'` y una fila `ventas` en `pendiente_confirmacion`
- AND `cliente_id` queda guardado como valor opaco, sin fila nueva en ninguna tabla de clientes
- AND no se invoca `handleTurn` ni el SDK del agente

#### Scenario: Token de autenticación ausente o inválido
- GIVEN `VENTAS_API_TOKEN` no está configurado, o está configurado pero no coincide con el header recibido
- WHEN llega cualquier `POST /ventas`
- THEN la ruta responde `401`
- AND no se crea `vendedor`, `caso` ni `venta`

### Requirement: Notificación best-effort del link de confirmación

Tras crear una venta, el sistema SHALL intentar notificar el link único al cliente. Cualquier falla del notificador SHALL loguearse y tragarse, sin revertir la venta ni propagar excepción. Sin `EMAIL_API_KEY`, el notificador SHALL degradar a loguear el link en vez de enviarlo.

#### Scenario: Falla el proveedor de email
- GIVEN una venta se creó correctamente
- WHEN el envío del email falla (red, HTTP ≠ 2xx)
- THEN la falla se loguea y la venta permanece persistida en `pendiente_confirmacion`
- AND no se propaga ninguna excepción al llamador de `POST /ventas`

#### Scenario: Sin `EMAIL_API_KEY` configurada
- GIVEN el proceso arranca sin `EMAIL_API_KEY`
- WHEN se crea una venta
- THEN el link de confirmación se loguea en vez de enviarse
- AND la venta se crea igual, sin excepción no capturada

### Requirement: Validación del token y confirmación determinista, sin invocar al modelo

`validarTokenConfirmacion` SHALL ser una función pura que recibe la venta y un `ahora` inyectado, y valida: el token existe, `ventas.estado === 'pendiente_confirmacion'`, y `expires_at` (si no es `NULL`) no está vencido. Un token vencido y un token inexistente SHALL producir una respuesta indistinguible. `GET/POST /confirmar/:token` SHALL NOT invocar `handleTurn` ni el SDK del agente en ningún caso.

#### Scenario: Token vencido rechazado sin efecto
- GIVEN una venta con `expires_at` en el pasado
- WHEN se hace `POST /confirmar/:token` con ese token
- THEN se rechaza sin efecto (sin cambio de estado, sin fila de comisión)
- AND la respuesta es indistinguible de la de un token inexistente

#### Scenario: Confirmar una venta no llama al modelo
- GIVEN un token válido y pendiente
- WHEN se confirma la venta
- THEN el flujo completo se resuelve sin ninguna llamada al modelo
- AND ningún test de este camino requiere un fixture de LLM

### Requirement: Transacción única de confirmación con cálculo de comisión

Confirmar una venta con token válido SHALL escribir, en una única transacción: `estado = 'confirmada'`, `confirmed_at`, y una fila de `comisiones` con `monto = venta.monto × COMISION_PORCENTAJE` redondeado a 2 decimales y `periodo` derivado de `confirmed_at` (no de `created_at`). Rechazar SHALL escribir `estado = 'rechazada'` sin fila de comisión. Un segundo `POST` sobre un token ya procesado SHALL NOT producir una segunda transición ni una segunda fila de comisión.

#### Scenario: Confirmación exitosa calcula y persiste la comisión
- GIVEN una venta `pendiente_confirmacion` con `monto = 1000` creada en enero y `COMISION_PORCENTAJE = 0.1`, confirmada en febrero
- WHEN se confirma con un token válido
- THEN `ventas.estado` pasa a `confirmada` con `confirmed_at` seteado
- AND se crea una fila `comisiones` con `monto = 100.00` y `periodo` de febrero

#### Scenario: Rechazo no genera comisión
- GIVEN un token válido y pendiente
- WHEN el cliente rechaza la venta
- THEN `ventas.estado` pasa a `rechazada` y no se crea ninguna fila en `comisiones`

#### Scenario: Reintento sobre token ya procesado no duplica efectos
- GIVEN una venta ya `confirmada` (o `rechazada`) mediante un `POST /confirmar/:token` previo
- WHEN llega un segundo `POST /confirmar/:token` con el mismo token (reuso o doble click)
- THEN no se produce ningún cambio de estado adicional ni una segunda fila de comisión

### Requirement: Configuración de comisión validada al arranque

`COMISION_PORCENTAJE` SHALL validarse en `(0, 1]` al arrancar el proceso. Un valor fuera de rango SHALL ser un error de arranque, no un `NaN` silencioso en una fila de comisión.

#### Scenario: Porcentaje de comisión inválido
- GIVEN `COMISION_PORCENTAJE` configurado fuera de `(0, 1]`
- WHEN el proceso arranca
- THEN el arranque falla con un error explícito
- AND ninguna venta llega a confirmarse con ese valor
