> Nota de proceso: mismo hook de graphify sin herramienta de shell disponible en este ejecutor (sólo Read/Edit/Write/Grep/Glob). Delta verificado leyendo `openspec/changes/aprobacion-conversacional-hitl/specs/herramienta-operaciones-negocio/spec.md` (versión vigente): ningún requirement existente está redactado sobre el texto literal de la respuesta de `registrar_venta` — todos hablan de schema, confirmación en dos pasos y literal de auditoría (`comando`). Por eso este delta es **ADDED**, no MODIFIED: cubre terreno que la spec vigente no cubría.

# Delta for Herramienta Operaciones Negocio

## ADDED Requirements

### Requirement: El eco de `registrar_venta` nombra al vendedor y al cliente, conserva los identificadores, y omite el email del cliente

El texto de negocio que `registrar_venta` devuelve al modelo SHALL incluir el nombre del vendedor (`vendedorNombre`, que es el empleado autenticado del turno por closure — ADR 171 pto 2) y el identificador del cliente (`clienteId`), tomados de datos que ya están en el scope de la operación. El texto SHALL conservar `ventaId` y `casoId` — no SHALL reemplazarlos por nombres, porque son la correlación con `registro_acciones_empleado` y el reporte de comisiones. El texto SHALL NOT incluir el email del cliente (`clienteEmail`) en ningún camino, incluidos los de notificación enviada, omitida o fallida (ADR 221 pto 3, ADR 18 pto 4).

#### Scenario: El eco nombra al vendedor y al cliente sin perder los ids

- GIVEN un empleado autenticado registra una venta válida
- WHEN `ejecutarRegistrarVenta` arma el texto de respuesta
- THEN el texto incluye `vendedorNombre`, `clienteId`, `ventaId` y `casoId`

#### Scenario: El eco nunca contiene el email del cliente, en ninguna rama de notificación

- GIVEN una venta registrada con `clienteEmail` presente en el scope de la operación
- WHEN se inspecciona el texto devuelto al modelo, tanto si la notificación se envió como si fue omitida o falló
- THEN el texto no contiene el valor de `clienteEmail` en ningún caso

#### Scenario: El eco no agrega datos calculados fuera del núcleo

- GIVEN el texto de respuesta de `registrar_venta`
- WHEN se compara contra los campos que `registrarVenta` y el scope de `operacion` ya exponían
- THEN el texto no incluye ningún monto recalculado, estado inferido ni texto libre generado por el modelo
