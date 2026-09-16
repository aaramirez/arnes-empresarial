> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/reembolso-resolucion-escalacion/spec.md` — versión vigente (MODIFIED Purpose + requirement ADDED de gate de rol, sin revisión posterior). Cierra R7 (ADR 211): la línea de *Fuera de alcance* que declaraba la autoaprobación de reembolso como deuda se corrige, y se agrega el requirement hermano del que `autorizacion-empleado` ya tiene para solicitudes, con el escenario positivo y los DOS escenarios negativos obligatorios (Aclaración 3(b) de `proposal.md`: sin el escenario sobre `POST /ventas`, el control no se distingue de un fixture complaciente).

# Delta for Reembolso Resolución Escalación

## MODIFIED Purpose

Capability existente. Cubre el cierre de producto de una escalación de reembolso: listado de pendientes y de rechazados, confirmación en dos pasos con eco del monto atada a la sesión del empleado, y las tres transiciones — aprobar (`reembolso_pendiente → reembolsada`), rechazar (`reembolso_pendiente → reembolso_rechazado`) y reabrir (`reembolso_rechazado → reembolso_pendiente`) — cada una con la transición correspondiente del `caso` y su fila de registro, todo en una única transacción, exigiendo rol elevado y la ausencia de autoaprobación.

**Fuera de alcance de este spec**: el modelo de rol en sí (capability `autorizacion-empleado`), tope de reaperturas, deshacer una aprobación (`reembolsada` es terminal sin excepción), notificación al cliente del desenlace, layout exacto de la fila de auditoría (capability `registro-acciones-empleado`), verificación de identidad (capability `autenticacion-empleado-tui`), y extender la prohibición de autoaprobación a "quien escaló la devolución" en vez de al vendedor de la venta (sería una prohibición distinta, de separación de funciones).

(Previously: "la autoaprobación de reembolso por el propio vendedor (R7, deuda declarada en `autorizacion-empleado` — `vendedores` y `credenciales_empleado` no están ligadas por nada)" figuraba como fuera de alcance. Este change cierra R7 con una comparación directa `venta.vendedorId === sesion.empleadoId`, sin ligar tablas — el canal conversacional ya escribe `vendedorId = sesion.empleadoId` para toda venta que da de alta. Queda un riesgo residual, aceptado y no bloqueante, de falso positivo por colisión de identificadores con ventas externas de `POST /ventas` — R11.)

## ADDED Requirements

### Requirement: Prohibición de autoaprobación de reembolso, independiente del rol

`aprobar`/`rechazar`/`reabrir` una escalación de reembolso con `venta.vendedorId === sesion.empleadoId` SHALL rechazarse, incluso si el empleado tiene rol elevado, con el texto "No podés {accion} el reembolso de tu propia venta, aunque tengas rol elevado.". Esta prohibición SHALL evaluarse con independencia del gate de rol, inmediatamente después de él. El predicado SHALL NOT dispararse para una venta cuyo `vendedorId` no pertenece al espacio de identidad de empleados del canal conversacional (por ejemplo, una venta dada de alta por `POST /ventas`, con `vendedorId` externo).

#### Scenario: Un vendedor distinto del empleado que resuelve, aprueba con normalidad
- GIVEN una venta cuyo `vendedorId` es distinto de `sesion.empleadoId`, en `reembolso_pendiente`, y un empleado con rol elevado
- WHEN confirma aprobar esa escalación
- THEN la transición procede: `ventas.estado` pasa a `reembolsada`, igual que sin esta prohibición

#### Scenario: El vendedor de la venta no puede aprobar su propio reembolso, aunque tenga rol elevado
- GIVEN una venta dada de alta por el canal conversacional con `vendedorId = sesion.empleadoId` del empleado E, en `reembolso_pendiente`, y E con rol elevado
- WHEN E confirma aprobar esa escalación
- THEN la acción se rechaza con el texto de autoaprobación, `ventas.estado` no cambia, `casos.estado` no cambia, y no se ejecuta ninguna escritura salvo la fila de auditoría del intento

#### Scenario: Una venta de origen externo nunca se bloquea de más
- GIVEN una venta dada de alta por `POST /ventas`, con `vendedorId` provisto por el caller externo y sin sesión de empleado detrás, en `reembolso_pendiente`, y un administrador cuyo `empleadoId` no coincide con ese `vendedorId`
- WHEN el administrador confirma aprobar esa escalación
- THEN el predicado de autoaprobación no dispara, y la resolución procede normalmente según el gate de rol vigente
