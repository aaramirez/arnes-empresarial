> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Delta escrito contra `openspec/changes/aprobacion-conversacional-hitl/specs/reembolso-resolucion-escalacion/spec.md` — versión vigente. Delta de ALCANCE, SIN cambio de comportamiento: el predicado `venta.vendedorId === sesion.empleadoId` (ADR 211) no se toca ni una palabra — gana un escenario que lo ejercita sobre una escalación nacida del camino nuevo (ADR 223/224). Instrucción de `proposal.md`: si esta pieza obligara a tocar `resolverEscalacionReembolso`, el change se detiene y vuelve a checkpoint — no hizo falta, el requirement existente ya cubre el caso sin ninguna guarda nueva.

# Delta for Reembolso Resolución Escalación

## MODIFIED Requirements

### Requirement: Prohibición de autoaprobación de reembolso, independiente del rol

`aprobar`/`rechazar`/`reabrir` una escalación de reembolso con `venta.vendedorId === sesion.empleadoId` SHALL rechazarse, incluso si el empleado tiene rol elevado, con el texto "No podés {accion} el reembolso de tu propia venta, aunque tengas rol elevado.". Esta prohibición SHALL evaluarse con independencia del gate de rol, inmediatamente después de él. El predicado SHALL NOT dispararse para una venta cuyo `vendedorId` no pertenece al espacio de identidad de empleados del canal conversacional (por ejemplo, una venta dada de alta por `POST /ventas`, con `vendedorId` externo). Este predicado SHALL proteger por igual una escalación nacida de `procesar_devolucion` (sobre el umbral) y una nacida de `solicitar_devolucion` (sin token, capability `devolucion-sin-token-dos-personas`) — el predicado no distingue el origen de la escalación.

(Previously: no existía un escenario que ejerciera este predicado sobre una escalación nacida de la vía sin token, porque esa vía no existía. El predicado en sí no cambia de texto ni de implementación.)

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

#### Scenario: El predicado protege por igual una escalación nacida de la vía sin token
- GIVEN una escalación en `reembolso_pendiente` creada por `solicitar_devolucion` (sin token) sobre la venta del vendedor V, con V en rol elevado
- WHEN V confirma aprobar esa misma escalación
- THEN se rechaza con el mismo texto de autoaprobación que si la escalación hubiera nacido de `procesar_devolucion`, sin ninguna guarda nueva en `resolverEscalacionReembolso`
