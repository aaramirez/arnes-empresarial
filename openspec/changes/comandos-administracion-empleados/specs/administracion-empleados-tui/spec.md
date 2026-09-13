> Nota de proceso: hook de graphify sin herramienta de shell disponible en este ejecutor (solo Read/Edit/Write/Grep/Glob), misma limitación que `proposal.md` de este change y que los specs previos de la sesión. Spec nuevo, apoyado íntegramente en `proposal.md` (ADR 174-177, Success Criteria) y en la resolución de checkpoint recibida junto con esta tarea: `/estado-bot-prs` queda **aprobado como agregado** de solo lectura (paliativo de ADR 178, punto 3 de "Qué necesita el checkpoint"), password-en-transcripto aceptado como residual documentado (R1, salida (a)), nombres `/crear-empleado`+`/asignar-rol` ratificados (RD-80), y ADR 174 ratificado. **Nota para `sdd-design`/`sdd-tasks`**: con `/estado-bot-prs` incluido, `DESCRIPTORES` queda en **dieciocho** (no diecisiete) — el Success Criterion de `proposal.md` que dice "diecisiete" quedó desactualizado por esta resolución de checkpoint y debe corregirse en la próxima revisión de la propuesta.

# Administración Empleados TUI Specification

## Purpose

Capability nueva. Cubre los tres comandos administrativos de la TUI: `/crear-empleado` (alta de credencial, ADR 174), `/asignar-rol` (escritura de rol, ADR 176) y `/estado-bot-prs` (estado de solo lectura del listener de webhooks, paliativo de ADR 178). Cubre el gate de rol `administrador` que protege a los dos primeros, la protección del último administrador, y los invariantes negativos que son el corazón de este change.

**Fuera de alcance de este spec**: el modelo de rol en sí — vocabulario, tabla, puerto de lectura, gate sobre reembolsos/solicitudes (capability `autorizacion-empleado`, sólo se **consume**); el parseo genérico de comandos y el segundo eje de gateo en el dispatcher (capability `comando-empleado-tui`); las filas de auditoría en sí (capability `registro-acciones-empleado`); autenticación y sesión (capability `autenticacion-empleado-tui`); un tercer rol, RBAC, tabla de permisos; desactivación/borrado de empleado, rate limiting, política de fortaleza, recuperación de contraseña; rotación de contraseña desde la TUI; escritura o rotación de secretos del bot de PRs (`GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`) — `/estado-bot-prs` es de solo lectura y nunca revela su valor.

## Requirements

### Requirement: El gate de `administrador` vive en un módulo de política compartido, no duplicado en el dispatcher

`/crear-empleado` y `/asignar-rol` SHALL exigir `rol === "administrador"`, evaluado mediante el mismo módulo de política que `autorizacion-empleado` ya usa para "resolver lo ajeno" (`autorizacion-resolucion.ts`, ADR 158). El sistema SHALL NOT implementar un segundo cálculo de "¿alcanza el rol?" inline en el dispatcher o en el handler de cada comando. El campo `privilegiado` de `DescriptorComando` SHALL NOT resignificarse para expresar este gate: sigue significando únicamente "exige sesión vigente" (R4 de `autorizacion-empleado`).

#### Scenario: El chequeo de administrador reusa la política compartida
- GIVEN el código que evalúa si `/crear-empleado` o `/asignar-rol` pueden ejecutarse
- WHEN se inspecciona de dónde viene la decisión
- THEN proviene del mismo módulo de política que gatea reembolsos y solicitudes ajenas, no de un `if` propio del dispatcher

#### Scenario: `privilegiado: true` en los dos comandos no sustituye al gate de administrador
- GIVEN un empleado con sesión vigente y rol base (`privilegiado` satisfecho)
- WHEN ejecuta `/crear-empleado` o `/asignar-rol`
- THEN es rechazado igual — sesión vigente no es sustituto de rol `administrador`

### Requirement: `/crear-empleado` da de alta una credencial reusando el hash y la validación de forma del CLI

`/crear-empleado <empleadoId> <password>`, ejecutado por un `administrador`, SHALL crear una fila en `credenciales_empleado` con el mismo algoritmo de hash (`scrypt`, sal aleatoria por fila) y la misma guarda de forma (`ID_REGEX`) que `empleados:crear`. Un `empleadoId` ya existente SHALL rechazarse sin modificar la fila existente. El sistema SHALL NOT introducir un segundo algoritmo de hash ni una segunda regla de forma para el `empleadoId`.

#### Scenario: Un administrador da de alta un empleado nuevo
- GIVEN un `administrador` con sesión vigente y un `empleadoId` sin credencial
- WHEN ejecuta `/crear-empleado ana <password>`
- THEN se crea la fila con `password_hash` derivado por `scrypt`, distinto del texto en claro

#### Scenario: Alta duplicada por TUI no pisa la credencial existente
- GIVEN `ana` ya tiene fila en `credenciales_empleado`
- WHEN un `administrador` ejecuta `/crear-empleado ana <password>`
- THEN el comando se rechaza y `password_hash` de la fila existente no cambia

### Requirement: `/asignar-rol` escribe rol llamando al mecanismo existente, sin reimplementar el modelo

`/asignar-rol <empleadoId> <rol>`, ejecutado por un `administrador`, SHALL validar `rol` contra `ROLES_EMPLEADO` y SHALL escribir mediante `upsertRolEmpleado(db, { empleadoId, rol, ahora })` (ADR 162 de `autorizacion-empleado`). El sistema SHALL NOT crear una migración nueva, una tabla nueva, ni una constante de rol propia. `ROLES_EMPLEADO` SHALL seguir teniendo exactamente dos miembros tras este change. Asignar rol a un `empleadoId` sin fila en `credenciales_empleado` SHALL fallar.

#### Scenario: Un administrador asciende a otro empleado
- GIVEN `ana` con credencial y rol base
- WHEN un `administrador` ejecuta `/asignar-rol ana administrador`
- THEN `ana` queda con rol `administrador`, escrito por `upsertRolEmpleado`, sin migración ni tabla nueva

#### Scenario: Asignar rol sin credencial detrás falla
- GIVEN un `empleadoId` sin fila en `credenciales_empleado`
- WHEN un `administrador` ejecuta `/asignar-rol <empleadoId> administrador`
- THEN el comando falla, sin crear fila de rol huérfana

### Requirement: Un empleado sin rol `administrador` es rechazado y deja fila de auditoría

Un empleado con rol base (o sin sesión) que ejecuta `/crear-empleado` o `/asignar-rol` SHALL ser rechazado, sin ninguna escritura en `credenciales_empleado` ni en `roles_empleado`, y SHALL dejar una fila en `registro_acciones_empleado` con un `resultado` que distingue este rechazo de uno por argumentos inválidos o por `empleadoId` inexistente.

#### Scenario: Rol base no puede crear un empleado
- GIVEN un empleado con rol base y sesión vigente
- WHEN ejecuta `/crear-empleado ana <password>`
- THEN el comando se rechaza, no se crea ninguna fila en `credenciales_empleado`
- AND se crea una fila de auditoría con un `resultado` de rechazo por autorización

#### Scenario: Rol base no puede auto-asignarse `administrador`
- GIVEN un empleado con rol base, `empleadoId = "ana"`, sesión vigente
- WHEN ejecuta `/asignar-rol ana administrador`
- THEN el comando se rechaza y `roles_empleado` no cambia para `ana`

### Requirement: El último `administrador` no puede degradarse a sí mismo

Si `/asignar-rol <empleadoId> empleado` tiene como `empleadoId` al mismo `administrador` que ejecuta el comando, y ese `administrador` es el único con rol elevado, el sistema SHALL rechazar la operación sin modificar `roles_empleado`. Un `administrador` distinto SHALL poder degradar a otro `administrador` sin esta restricción.

#### Scenario: El único administrador no puede auto-degradarse
- GIVEN un único empleado con rol `administrador`, que es quien ejecuta el comando
- WHEN ejecuta `/asignar-rol <su propio empleadoId> empleado`
- THEN el comando se rechaza, su rol sigue siendo `administrador`

#### Scenario: Con dos administradores, uno puede degradar al otro
- GIVEN dos empleados con rol `administrador`
- WHEN uno ejecuta `/asignar-rol <el otro> empleado`
- THEN la degradación se ejecuta con normalidad

### Requirement: La contraseña de alta es un residual documentado, no un defecto

El comando `/crear-empleado` SHALL tipear la contraseña como argumento de la TUI (no enmascarado, ADR 21 sin tocar). Este residual — la contraseña de **otro** empleado visible en el transcripto — SHALL quedar documentado en el arc42 como decisión aceptada (ADR 174 pto 2, R1 salida (a)), no reportado como hallazgo de seguridad nuevo. El sistema SHALL preservar íntegro el invariante de no persistencia en claro: la contraseña tipeada nunca llega a `credenciales_empleado` sin hashear, nunca a una fila de `registro_acciones_empleado`, nunca a un evento de log (ver capability `autenticacion-empleado-tui`, requisito extendido).

#### Scenario: El residual queda documentado, no oculto
- GIVEN el arc42 de este change
- WHEN se busca el tratamiento de la contraseña visible en el transcripto de `/crear-empleado`
- THEN aparece nombrado como decisión aceptada con su ADR, no como pendiente ni como bug

### Requirement: `/estado-bot-prs` es de solo lectura y nunca revela un secreto

`/estado-bot-prs`, con sesión vigente (`privilegiado: true`, sin exigir rol `administrador`), SHALL responder si el listener de webhooks está escuchando, en qué puerto y en qué path, y si `GITHUB_TOKEN` está configurado — como presencia booleana, nunca como valor. El comando SHALL NOT escribir en ninguna tabla, SHALL NOT modificar configuración del listener, y SHALL NOT incluir el valor de `GITHUB_TOKEN` ni de `GITHUB_WEBHOOK_SECRET` en su respuesta ni en ninguna fila de auditoría.

#### Scenario: Estado del listener sin exponer secretos
- GIVEN el listener de webhooks configurado y escuchando
- WHEN un empleado con sesión vigente ejecuta `/estado-bot-prs`
- THEN la respuesta indica que está escuchando, el puerto y el path, y que `GITHUB_TOKEN` está presente
- AND ningún valor de `GITHUB_TOKEN` ni de `GITHUB_WEBHOOK_SECRET` aparece en la respuesta

#### Scenario: No requiere rol administrador
- GIVEN un empleado con rol base y sesión vigente
- WHEN ejecuta `/estado-bot-prs`
- THEN el comando responde igual que para un `administrador` — no está gateado por rol
