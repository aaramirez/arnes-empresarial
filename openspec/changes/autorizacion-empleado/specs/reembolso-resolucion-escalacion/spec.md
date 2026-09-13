> Nota de proceso: sin herramienta de shell disponible, mismo criterio de `proposal.md`. Delta sobre `openspec/changes/tui-canal-empleado/specs/reembolso-resolucion-escalacion/spec.md` — versión vigente única, sin revisión posterior. Dos cambios: (1) la línea de `Fuera de alcance` en `## Purpose`, que hoy difiere "roles/permisos sobre quién puede resolver" sin nombrar dueño y queda parcialmente falsa porque ese eje deja de estar completamente diferido; (2) un requirement nuevo (ADDED) que documenta el gate donde hoy no existe ninguno (`resolverEscalacionReembolso` verificado íntegro sin gate, `:107-168` de `proposal.md`). El detalle del modelo de rol y del gate vive en `autorizacion-empleado`; este delta sólo fija que las tres transiciones de esta capability ahora lo exigen.

# Delta for Reembolso Resolución Escalación

## MODIFIED Purpose

Capability nueva. Cubre el cierre de producto de una escalación de reembolso: listado de pendientes y de rechazados, confirmación en dos pasos con eco del monto atada a la sesión del empleado, y las tres transiciones — aprobar (`reembolso_pendiente → reembolsada`), rechazar (`reembolso_pendiente → reembolso_rechazado`) y reabrir (`reembolso_rechazado → reembolso_pendiente`) — cada una con la transición correspondiente del `caso` y su fila de registro, todo en una única transacción.

**Fuera de alcance de este spec**: el modelo de rol en sí (vocabulario, persistencia, puerto de lectura — capability `autorizacion-empleado`), tope de reaperturas, deshacer una aprobación (`reembolsada` es terminal sin excepción), notificación al cliente del desenlace, layout exacto de la fila de auditoría (capability `registro-acciones-empleado`), verificación de identidad (capability `autenticacion-empleado-tui`), y la autoaprobación de reembolso por el propio vendedor (R7, deuda declarada en `autorizacion-empleado` — `vendedores` y `credenciales_empleado` no están ligadas por nada).

(Previously: "roles/permisos sobre quién puede resolver" figuraba como fuera de alcance sin nombrar una capability dueña. Esa frase queda falsa: quién puede resolver ya no es indiferente — las tres transiciones exigen rol elevado desde este change. Lo que sigue fuera de alcance de *este* spec es el modelo de rol en sí mismo, no la pregunta de autorización.)

## ADDED Requirements

### Requirement: Las tres transiciones de resolución exigen rol elevado

`/aprobar-reembolso`, `/rechazar-reembolso` y `/reabrir-reembolso` SHALL exigir, además de sesión vigente y confirmación en dos pasos, que el empleado tenga rol elevado (capability `autorizacion-empleado`). Un empleado con rol base que confirme cualquiera de los tres SHALL recibir un rechazo por autorización, distinguible de `no_aplicable` y de "falta sesión", sin ejecutar ninguna escritura en `ventas`, `casos` ni `registro_acciones_empleado` salvo la fila de auditoría del intento.

#### Scenario: Rol base confirma pero el gate rechaza antes de la transición
- GIVEN un empleado con rol base, sesión vigente, y una confirmación pendiente sobre una venta en `reembolso_pendiente`
- WHEN confirma `/aprobar-reembolso <ventaId>`
- THEN la acción se rechaza por autorización, `ventas.estado` no cambia, y el rechazo es distinguible de un `no_aplicable` por CAS

#### Scenario: Rol elevado resuelve exactamente como antes de este change
- GIVEN un empleado con rol elevado en las mismas condiciones
- WHEN confirma `/aprobar-reembolso <ventaId>`
- THEN `ventas.estado` pasa a `reembolsada`, `casos.estado` a `resuelto`, y se crea la fila de registro, igual que en la versión anterior de este spec
