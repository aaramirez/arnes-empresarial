> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Spec nueva, construida sobre ADR 225 de `proposal.md`. ★ Riesgo más alto de todo el change (R1 de `proposal.md`): esta lectura reusa la fila cruda de `ventas`, que SÍ incluye `token_confirmacion` (`repository.ts:725`) — la exclusión tiene que vivir en el borde del store, no en el "cuidado" del implementador.

# Consulta Venta Empleado Specification

## Purpose

Capability nueva (ADR 225, ADR 224). Lectura de solo lectura, escopada al vendedor propio, del estado de una venta puntual —incluida la decisión del cliente— y, sin id, el listado de sus ventas. ★ **Riesgo más alto de este change**: la proyección EXCLUYE `token_confirmacion` siempre, con invariante negativo y test mecánico — sin esto, esta lectura "inocente" reabre el ADR 22 por la puerta de atrás, dejando cualquier venta propia reembolsable sin el cliente.

**Fuera de alcance de este spec**: la iniciación de la devolución (capability `devolucion-sin-token-dos-personas`, que reusa esta misma proyección sin token como su fuente de `ventaId → {casoId, vendedorId, estado}`), notificar o exponer datos personales del cliente más allá de `clienteId`.

## Requirements

### Requirement: `consultar_venta` es de sólo lectura y escopada a ventas propias

El sistema SHALL exponer `consultar_venta { ventaId? }`. Sin `ventaId`, SHALL devolver el listado de ventas propias. Con `ventaId` de una venta ajena, SHALL rechazar con un resultado distinguible de "no existe", sin ninguna escritura. La operación SHALL NOT crear caso, marcar nada, ni consumir ninguna ranura de confirmación, verificado con un doble de store que falla si recibe una escritura.

#### Scenario: Consulta de venta propia devuelve su estado
- GIVEN una venta propia del empleado que consulta
- WHEN invoca `consultar_venta { ventaId }`
- THEN recibe el estado de la venta, incluida la decisión del cliente

#### Scenario: Consulta de venta ajena se rechaza sin escrituras
- GIVEN una venta cuyo `vendedorId` no es el del empleado que consulta
- WHEN invoca `consultar_venta { ventaId }`
- THEN se rechaza con un resultado distinguible de "no existe", y no se ejecuta ninguna escritura

#### Scenario: Cero escrituras verificado con un doble de store
- GIVEN un doble de store que lanza si recibe cualquier método de escritura
- WHEN se invoca `consultar_venta` con y sin `ventaId`
- THEN ningún método de escritura del doble se invoca

### Requirement: La proyección EXCLUYE `token_confirmacion` — invariante negativo con test mecánico (riesgo más alto del change)

La proyección de `consultar_venta`, en el detalle y en el listado, SHALL NOT incluir `token_confirmacion` bajo ningún campo, ni en el tipo de la respuesta ni en el texto devuelto al modelo. Esta exclusión SHALL verificarse con un test mecánico que falla si el tipo de la proyección declara un campo de token, o si el texto de salida contiene el token de la venta bajo prueba. El mismo criterio SHALL aplicar a `solicitar_devolucion`, que reusa esta proyección para resolver `ventaId`.

#### Scenario: El tipo de la proyección no declara ningún campo de token
- GIVEN el tipo TypeScript de la proyección de venta
- WHEN se inspeccionan sus campos
- THEN ninguno corresponde a `token_confirmacion` ni a un alias suyo

#### Scenario: El texto de salida nunca contiene el token, aunque la fila del store lo tenga
- GIVEN una venta cuya fila en `ventas` incluye `token_confirmacion` con un valor conocido
- WHEN se invoca `consultar_venta { ventaId }` sobre esa venta
- THEN el texto devuelto al modelo no contiene ese valor en ninguna posición

#### Scenario: `solicitar_devolucion` tampoco expone el token al resolver el `ventaId`
- GIVEN la misma venta con token conocido
- WHEN `solicitar_devolucion` resuelve internamente `ventaId → {casoId, vendedorId, estado}` usando esta proyección
- THEN el token no aparece en ningún texto ni estructura que la operación exponga

### Requirement: El listado sin `ventaId` muestra únicamente ventas propias

Sin `ventaId`, `consultar_venta` SHALL devolver únicamente ventas cuyo `vendedorId` coincide con `sesion.empleadoId`.

#### Scenario: El listado no incluye ventas de otros vendedores
- GIVEN ventas de al menos dos vendedores distintos en el store
- WHEN el empleado E invoca `consultar_venta` sin `ventaId`
- THEN el listado solo contiene ventas cuyo `vendedorId` es el de E

### Requirement: La proyección expone la decisión del cliente sin datos personales más allá de `clienteId`

El estado de la venta expuesto (`pendiente_confirmacion`, `confirmada`, `rechazada`, `reembolso_pendiente`, `reembolso_rechazado`, `reembolsada`) SHALL representar la decisión del cliente. La proyección SHALL NOT incluir ningún dato personal del cliente más allá de `clienteId`.

#### Scenario: El estado refleja que el cliente rechazó la venta
- GIVEN una venta en `rechazada`
- WHEN se consulta
- THEN el estado devuelto es `rechazada`

#### Scenario: No hay datos personales del cliente más allá del id
- GIVEN cualquier venta consultada
- WHEN se inspecciona la proyección devuelta
- THEN no contiene nombre, email ni ningún dato personal del cliente distinto de `clienteId`
