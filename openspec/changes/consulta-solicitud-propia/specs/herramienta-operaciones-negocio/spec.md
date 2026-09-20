> Nota de proceso: mismo hook de graphify sin shell que `proposal.md` (sólo Read/Grep/Glob). **Versión base = tip de la cadena**: `aprobacion-conversacional-hitl/specs/herramienta-operaciones-negocio/spec.md` (ocho) + delta de `devolucion-sin-token-dos-personas` (diez, v3.12, aún sin archivar). Los bloques MODIFIED copian los bloques de ESE delta v3.12 (mismos títulos de requirement) y los editan; por eso este change se aplica después de archivar v3.12 (R2 de `proposal.md`). Verificado: `OPERACIONES_NEGOCIO` tiene diez hoy (`operaciones-contract.ts:71-82`) y `ergonomia-canal-empleado` sólo agrega un requirement ADDED sin conteo, sin conflicto.

# Delta for Herramienta Operaciones Negocio

## MODIFIED Purpose

Capability existente. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente. El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (once): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`, `resolver_reembolso`, `resolver_solicitud`, `solicitar_devolucion` (capability `devolucion-sin-token-dos-personas`), `consultar_venta` (capability `consulta-venta-empleado`), y la que este change agrega — `consultar_solicitud` (capability `consulta-solicitud-empleado`).

(Previously: diez operaciones. Este change agrega la última.)

## ADDED Requirements

### Requirement: `consultar_solicitud` no muta estado

`consultar_solicitud` SHALL NOT modificar ninguna fila de `solicitudes_internas`, `casos` ni `registro_acciones_empleado`, ni el estado de ninguna ranura de confirmación, en ninguna de sus ramas. Vive en el vocabulario del contrato como operación de sólo lectura, sin `accion` ni `confirmado`; su alcance (propio) y su proyección son de la capability `consulta-solicitud-empleado`.

#### Scenario: Instantánea de tablas idéntica antes y después
- GIVEN una base `:memory:` con solicitudes propias y ajenas en distintos estados
- WHEN se invoca `consultar_solicitud` con id propio, con id ajeno y sin id
- THEN las filas de `solicitudes_internas`, `casos` y `registro_acciones_empleado` son idénticas a la instantánea previa (incluido `updated_at`)

## MODIFIED Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las once operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `motivo?`, `decision`, `accion`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato sigue siendo `monto` de `registrar_venta`. `motivo`, en `solicitar_devolucion`, es texto libre acotado por un tope de longitud (RD-106), nunca un veredicto calculado por el modelo. `consultar_solicitud` SHALL aceptar únicamente `operacion` y `solicitudId?`.

(Previously: enumeraba diez operaciones; `consultar_solicitud` no existía y su schema no estaba fijado.)

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: `solicitar_devolucion` no acepta ningún campo de monto ni de veredicto
- GIVEN un intento de invocar `solicitar_devolucion` con un campo adicional de tipo monto, porcentaje o veredicto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar el módulo de iniciación

#### Scenario: El contrato enumera once operaciones e incluye `consultar_solicitud`
- GIVEN `OPERACIONES_NEGOCIO` tras este change
- WHEN se inspecciona su contenido
- THEN tiene longitud 11, contiene `consultar_solicitud` una sola vez y las diez anteriores sin cambios

#### Scenario: `consultar_solicitud` acepta sólo `solicitudId` y rechaza cualquier otra clave
- GIVEN entradas `{operacion:"consultar_solicitud"}`, `{operacion:"consultar_solicitud", solicitudId:"s1"}` y `{operacion:"consultar_solicitud", solicitanteId:"e2"}`
- WHEN se validan
- THEN las dos primeras son válidas y la tercera es rechazada como clave extra

### Requirement: El mecanismo de confirmación en dos pasos cubre cuatro operaciones, nunca como campo del schema

Cuatro operaciones —`cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud` y `solicitar_devolucion`— SHALL resolver su confirmación en dos pasos consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`) desde el composition root. `solicitar_devolucion` SHALL usar un dominio de confirmación propio, distinto del de `resolver_reembolso`, para no pisar sobre el mismo `ventaId` una iniciación pendiente contra una aprobación pendiente (RD-107). Ninguna operación del contrato SHALL declarar `confirmado` como campo de su schema, en ninguna capa de validación. `consultar_solicitud`, como `consultar_venta`, NO es confirmable.

(Previously: el escenario de `confirmado` contaba "los diez schemas"; el conjunto de cuatro operaciones confirmables NO cambia — sólo el conteo total y la aclaración de que `consultar_solicitud` no es confirmable.)

#### Scenario: Una iniciación pendiente y una aprobación pendiente sobre distintos `ventaId` conviven sin pisarse
- GIVEN una escalación con `resolver_reembolso` pendiente de confirmar sobre un `ventaId`, y una iniciación de `solicitar_devolucion` sobre otro `ventaId` pendiente de confirmar
- WHEN ambas ranuras de confirmación se resuelven en turnos separados
- THEN cada una completa su propia operación sin interferir con la otra

#### Scenario: `confirmado` no existe como campo en ningún schema del contrato
- GIVEN los once schemas del servidor `operaciones`
- WHEN se inspeccionan sus campos aceptados
- THEN ninguno declara `confirmado`

### Requirement: Cada operación que muta deja fila de auditoría; las de sólo lectura no

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` para cada operación que muta estado, con un literal distinguible por operación (exacto: RD-110), correlacionado por `ventaId`/`casoId` cuando aplique. `consultar_venta` y `consultar_solicitud`, siempre de sólo lectura, y el modo listado de `solicitar_devolucion` y de `resolver_reembolso`, SHALL NOT escribir fila de auditoría.

(Previously: nombraba sólo a `consultar_venta` como operación de lectura sin fila; `consultar_solicitud` (datos propios del solicitante) se suma a las de sólo lectura.)

#### Scenario: `consultar_venta` nunca escribe fila de auditoría
- GIVEN cualquier invocación de `consultar_venta`, con o sin `ventaId`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN no se creó ninguna fila nueva

#### Scenario: `consultar_solicitud` nunca escribe fila de auditoría
- GIVEN cualquier invocación de `consultar_solicitud`, con o sin `solicitudId`, sobre solicitud propia, ajena o inexistente
- WHEN se inspecciona `registro_acciones_empleado`
- THEN no se creó ninguna fila nueva

#### Scenario: Una iniciación exitosa de `solicitar_devolucion` deja fila distinguible
- GIVEN una iniciación exitosa que deja la venta en `reembolso_pendiente`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN existe una fila con un `resultado` distinguible de una escalación creada por el camino del token, correlacionada por `ventaId`/`casoId`, y sin el `motivo`
