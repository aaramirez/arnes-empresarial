> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md` y por el spec de `venta-confirmacion`. Este spec se apoya íntegramente en `proposal.md` (ADR 22, 25, 29, 31, Approach) y usa `openspec/changes/hito-1.3-ventas-comisiones/specs/venta-confirmacion/spec.md` como plantilla de formato. Capability renombrada respecto de `reembolso-cierre-escalacion` (revisión 1 de esta misma propuesta); no existe `openspec/specs/reembolso-cierre-escalacion/spec.md` que migrar (verificado: `openspec/specs/` solo tiene `.gitkeep`), así que se escribe como spec completo, no delta.

# Reembolso Resolución Escalación Specification

## Purpose

Capability nueva. Cubre el cierre de producto de una escalación de reembolso: listado de pendientes y de rechazados, confirmación en dos pasos con eco del monto atada a la sesión del empleado, y las tres transiciones — aprobar (`reembolso_pendiente → reembolsada`), rechazar (`reembolso_pendiente → reembolso_rechazado`) y reabrir (`reembolso_rechazado → reembolso_pendiente`) — cada una con la transición correspondiente del `caso` y su fila de registro, todo en una única transacción.

**Fuera de alcance de este spec**: roles/permisos sobre quién puede resolver, tope de reaperturas, deshacer una aprobación (`reembolsada` es terminal sin excepción), notificación al cliente del desenlace, layout exacto de la fila de auditoría (capability `registro-acciones-empleado`), verificación de identidad (capability `autenticacion-empleado-tui`).

## Requirements

### Requirement: Listado de reembolsos pendientes de aprobación

`/aprobar-reembolso` sin argumento SHALL listar las ventas en `reembolso_pendiente` con `ventaId`, vendedor, cliente y monto.

#### Scenario: Listado sin argumento
- GIVEN al menos una venta en `reembolso_pendiente`
- WHEN se ejecuta `/aprobar-reembolso` sin `ventaId`
- THEN se listan todas, cada una con `ventaId`, vendedor, cliente y monto

### Requirement: Confirmación en dos pasos con eco del monto, atada a la sesión

Un primer llamado a `/aprobar-reembolso`, `/rechazar-reembolso` o `/reabrir-reembolso` con `ventaId` SHALL NOT ejecutar ninguna escritura: SHALL devolver un eco (monto, cliente, caso) y guardar una confirmación pendiente asociada al `empleadoId` de la sesión activa. Un segundo llamado SHALL ejecutar solo si hay sesión vigente del **mismo** `empleadoId` que preparó la confirmación; ante `/logout`, un `/login` (de cualquier empleado, incluido el mismo) o la expiración de la sesión, la confirmación pendiente SHALL quedar invalidada y el segundo paso SHALL NOT producir ningún efecto.

#### Scenario: Primer llamado no ejecuta nada
- GIVEN una sesión vigente y una venta en `reembolso_pendiente`
- WHEN se ejecuta `/aprobar-reembolso <ventaId>` por primera vez
- THEN se devuelve el eco del monto y no se escribe en `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: Confirmación no sobrevive a un cambio de sesión
- GIVEN una confirmación pendiente preparada por `ana`
- WHEN ocurre, por separado, un `/logout`, un `/login` de `beto`, o el vencimiento de la sesión de `ana`, y luego se repite el comando con el mismo `ventaId`
- THEN el segundo paso no ejecuta ningún efecto en ninguno de los tres casos

### Requirement: Aprobación transaccional

Un segundo llamado confirmado a `/aprobar-reembolso <ventaId>` SHALL ejecutar, en una única transacción: `ventas.estado: reembolso_pendiente → reembolsada` (CAS), `casos.estado → resuelto`, y una fila de registro con el `empleadoId` de la sesión. Un CAS que no matchea SHALL devolver `no_aplicable` sin excepción y sin una segunda escritura sobre `ventas`.

#### Scenario: Aprobación exitosa
- GIVEN una confirmación pendiente vigente sobre una venta en `reembolso_pendiente`
- WHEN se repite `/aprobar-reembolso <ventaId>`
- THEN `ventas.estado` pasa a `reembolsada`, `casos.estado` pasa a `resuelto`, y se crea una fila con el `empleadoId` de la sesión, todo en una transacción

#### Scenario: Reintento sobre venta ya aprobada
- GIVEN una venta ya `reembolsada`
- WHEN se repite `/aprobar-reembolso <ventaId>` confirmado
- THEN el resultado es `no_aplicable`, sin excepción y sin cambio adicional en `ventas`, con una fila `resultado='no_aplicable'`

### Requirement: Rechazo transaccional y su efecto sobre una devolución posterior

Un segundo llamado confirmado a `/rechazar-reembolso <ventaId>` SHALL ejecutar, en una única transacción: `ventas.estado: reembolso_pendiente → reembolso_rechazado` (CAS), `casos.estado → resuelto`, y su fila de registro. Un `/devolucion` posterior sobre una venta en `reembolso_rechazado` SHALL responder `no_aplicable` sin efecto.

#### Scenario: Rechazo exitoso y devolución posterior no aplica
- GIVEN una confirmación pendiente vigente sobre una venta en `reembolso_pendiente`
- WHEN se repite `/rechazar-reembolso <ventaId>` y luego llega un `/devolucion` con el token de esa misma venta
- THEN la venta queda en `reembolso_rechazado` con su `caso` en `resuelto` y su fila
- AND el `/devolucion` posterior responde `no_aplicable` sin cambiar `ventas.estado`

### Requirement: Listado de reembolsos rechazados, ordenado por fecha de rechazo

`/reabrir-reembolso` sin argumento SHALL listar las ventas en `reembolso_rechazado`, acotado por un límite (default 20), ordenado por la fecha del rechazo (tomada de `registro_acciones_empleado`) de más reciente a más antigua.

#### Scenario: Listado de rechazados
- GIVEN varias ventas en `reembolso_rechazado` rechazadas en momentos distintos
- WHEN se ejecuta `/reabrir-reembolso` sin argumento
- THEN se listan ordenadas de la más reciente a la más antigua, acotadas por el límite

### Requirement: Reapertura transaccional reusa el mismo caso

Un segundo llamado confirmado a `/reabrir-reembolso <ventaId>` SHALL ejecutar, en una única transacción: `ventas.estado: reembolso_rechazado → reembolso_pendiente` (CAS), `casos.estado → pendiente_aprobacion_humana` sobre el **mismo** `caso_id` de la venta (no se crea un caso nuevo), y su fila de registro. El eco del primer llamado SHALL incluir quién rechazó, cuándo, y cuántas reaperturas previas tuvo esa venta.

#### Scenario: Reapertura exitosa reusa el caso
- GIVEN una venta en `reembolso_rechazado` con `caso_id = c-9`
- WHEN se confirma `/reabrir-reembolso <ventaId>`
- THEN `ventas.estado` vuelve a `reembolso_pendiente` y `casos.estado` (mismo `c-9`) vuelve a `pendiente_aprobacion_humana`
- AND la venta reaparece en `/aprobar-reembolso` sin argumento y en el reporte mensual

#### Scenario: Reapertura sobre una venta reembolsada no aplica
- GIVEN una venta en `reembolsada`
- WHEN se intenta `/reabrir-reembolso <ventaId>` confirmado
- THEN el resultado es `no_aplicable` sin escritura, por el CAS, sin ninguna validación especial adicional

### Requirement: `reembolsada` es terminal sin excepción; sin tope de reaperturas

Ninguna transición de este spec SHALL mover una venta fuera de `reembolsada`. El sistema SHALL NOT imponer un límite al número de veces que una venta puede pasar por el ciclo rechazar → reabrir.

#### Scenario: Ciclo completo de resolución
- GIVEN una venta escalada a `reembolso_pendiente`
- WHEN se ejecuta, con sesiones autenticadas de dos empleados distintos, el ciclo rechazar → reabrir → aprobar
- THEN el estado final de la venta es `reembolsada`
- AND ninguna de las transiciones intermedias fue bloqueada por un tope de reaperturas
