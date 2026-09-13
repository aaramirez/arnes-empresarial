> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/registro-acciones-empleado/spec.md` — versión vigente (ya trae un `MODIFIED Requirements` sobre atomicidad que reconoce filas de rechazo sin transición). La enumeración "por comando" de la versión base es cerrada por comando nombrado, pero no hace una afirmación negativa exhaustiva ("ningún otro comando escribe fila"); `/crear-empleado`, `/asignar-rol` y sus rechazos por gate son comportamiento nuevo, no una reinterpretación de lo existente — se agregan como `ADDED`, sin tocar los requirements existentes ni copiar sus bloques completos.

# Delta for Registro Acciones Empleado

## ADDED Requirements

### Requirement: `/crear-empleado` y `/asignar-rol` dejan fila con el mecanismo existente, sin secreto y sin permiso nuevo de puerto

Una ejecución exitosa de `/crear-empleado` o `/asignar-rol` SHALL escribir una fila en `registro_acciones_empleado` usando el mismo `registrar()` y el mismo `RegistroAccionesEmpleadoPort` que ya existen (ADR 161) — el sistema SHALL NOT agregar un método de puerto nuevo para esto. La fila SHALL identificar el comando y el `empleado_id` objetivo de la operación (el empleado creado o cuyo rol cambió), además del `empleado_id` de quien la ejecutó (el `administrador`). La fila SHALL NOT contener la contraseña de `/crear-empleado` bajo ninguna forma.

#### Scenario: Alta exitosa deja fila con ambos empleados identificables
- GIVEN un `administrador` que ejecuta `/crear-empleado ana <password>` con éxito
- WHEN se inspecciona la fila creada en `registro_acciones_empleado`
- THEN el `empleado_id` de quien ejecutó y el `empleadoId` creado son ambos identificables en la fila o sus campos asociados
- AND ningún campo de la fila contiene la contraseña ni un derivado suyo distinto del hash ya persistido en `credenciales_empleado`

#### Scenario: Asignación de rol exitosa deja fila con el mecanismo existente
- GIVEN un `administrador` que ejecuta `/asignar-rol ana administrador` con éxito
- WHEN se inspecciona `registro_acciones_empleado`
- THEN existe una fila para esa acción, escrita por `registrar()`, sin ningún método de puerto nuevo

### Requirement: Un rechazo por falta de rol `administrador`, o por auto-degradación del último administrador, deja fila distinguible sin efecto de dominio

Todo intento de `/crear-empleado` o `/asignar-rol` rechazado por el gate de rol `administrador` (capability `administracion-empleados-tui`), y todo intento de auto-degradación del último `administrador` rechazado, SHALL dejar una fila en `registro_acciones_empleado` con un `resultado` distinguible de una ejecución exitosa, de `no_aplicable` por argumentos inválidos, y del rechazo por autorización ya existente para reembolsos y solicitudes ajenas (capability `autorizacion-empleado`). Ninguna de estas filas SHALL tener asociada una escritura en `credenciales_empleado` ni en `roles_empleado`.

#### Scenario: Rechazo por rol insuficiente queda auditado sin escritura
- GIVEN un empleado con rol base que intenta `/asignar-rol ana administrador`
- WHEN el gate lo rechaza
- THEN se crea una fila con `resultado` distinguible de una asignación exitosa
- AND `roles_empleado` no cambia para `ana`

#### Scenario: Rechazo por auto-degradación del último administrador queda auditado
- GIVEN el único `administrador` intentando degradarse a sí mismo
- WHEN el chequeo de cardinalidad lo rechaza
- THEN se crea una fila con `resultado` distinguible de los dos casos anteriores
- AND su rol sigue siendo `administrador`
