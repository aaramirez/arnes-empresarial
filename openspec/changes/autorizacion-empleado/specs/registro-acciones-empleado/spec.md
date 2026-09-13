> Nota de proceso: sin herramienta de shell disponible, mismo criterio de `proposal.md`. Delta sobre `openspec/changes/tui-canal-empleado/specs/registro-acciones-empleado/spec.md` — versión vigente única, sin revisión posterior. El requirement de Atomicidad afirma una biyección "ni una fila sin su transición" para las tres funciones de resolución de reembolso; con este change esa biyección se vuelve falsa, porque un intento rechazado por autorización o por autoaprobación deja fila **sin** transición de dominio (Success Criteria y ADR 155 pto 4 de `proposal.md`). Se copia completo el requirement y se edita.

# Delta for Registro Acciones Empleado

## MODIFIED Requirements

### Requirement: Atomicidad — las resoluciones escriben su fila en la transacción cuando hay transición; un rechazo por autorización o autoaprobación deja fila sin transición

`aprobarEscalacionReembolso`, `rechazarEscalacionReembolso`, `reabrirEscalacionReembolso`, y `aprobar`/`rechazar` de solicitud interna SHALL escribir su fila de registro en la **misma transacción** que el CAS de `ventas`/`solicitudes_internas` y la actualización de `casos` cuando la acción se ejecuta con éxito: no SHALL existir una transición exitosa sin su fila, ni una fila de transición exitosa sin su transición. Un intento rechazado por el gate de rol o por la prohibición de autoaprobación (capability `autorizacion-empleado`) SHALL dejar una fila **sin** transición de dominio asociada, con un `resultado` que lo distingue tanto de una transición exitosa como de `no_aplicable` por CAS. `/login`, `/soporte`, `/devolucion` y los intentos `no_aplicable` de esos caminos siguen escribiendo su fila **después** del efecto, fuera de esa transacción, sin cambio respecto de la versión anterior.

(Previously: la regla era una biyección estricta entre fila y transición exitosa para las tres funciones de resolución de reembolso — "no SHALL existir una transición exitosa sin su fila, ni una fila sin su transición", sin excepción. Esta versión mantiene la biyección para el caso exitoso, pero reconoce un tercer tipo de fila —la del intento rechazado por autorización o autoaprobación— que por definición no tiene transición, y la extiende a las dos funciones de solicitud interna que ahora también tienen gate.)

#### Scenario: Fila y transición son atómicas en una resolución exitosa
- GIVEN una aprobación de escalación confirmada por un empleado con rol elevado
- WHEN se ejecuta `aprobarEscalacionReembolso`
- THEN el cambio de `ventas.estado`, el de `casos.estado` y la fila de registro ocurren en la misma transacción

#### Scenario: Un rechazo por rol insuficiente deja fila sin transición
- GIVEN un empleado con rol base que intenta aprobar una escalación ajena
- WHEN el gate de autorización rechaza el intento
- THEN se crea una fila en `registro_acciones_empleado` con un `resultado` distinguible de una aprobación exitosa y de `no_aplicable`
- AND `ventas.estado` y `casos.estado` no cambian

#### Scenario: Un rechazo por autoaprobación deja fila sin transición
- GIVEN un empleado con rol elevado que intenta aprobar su propia solicitud
- WHEN la prohibición de autoaprobación rechaza el intento
- THEN se crea una fila en `registro_acciones_empleado` con un `resultado` distinguible del de un rechazo por rol insuficiente y de una resolución exitosa
- AND la solicitud no transiciona
