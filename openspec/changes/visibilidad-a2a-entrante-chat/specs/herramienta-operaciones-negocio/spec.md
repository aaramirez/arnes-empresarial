> Nota de proceso: mismo hook de graphify sin shell que `proposal.md` (sólo Read/Grep/Glob). **Versión base = tip de la cadena de deltas**: `aprobacion-conversacional-hitl/specs/herramienta-operaciones-negocio/spec.md` (ocho) + delta de `devolucion-sin-token-dos-personas` (diez, v3.12) + delta de `consulta-solicitud-propia` (once, v3.14). Los bloques MODIFIED copian los bloques de ESE último delta (mismos títulos, con la única excepción del renombrado declarado abajo) y los editan. ★ **El archivado depende del orden v3.12 → v3.13 → v3.14 → v3.15**: este delta sólo aplica sobre un base que ya tenga once operaciones. Verificado: `OPERACIONES_NEGOCIO` tiene hoy diez (`src/core/operaciones/operaciones-contract.ts:71-82`), así que "11 → 12" es verdad únicamente tras archivar v3.14. `conocimiento-chat-empleado` (v3.13) afirma "diez" en su propio escenario de conteo, correcto en su turno de la cadena; no hay conflicto.
>
> **Dos hallazgos de esta fase sobre el requirement de auditoría** (tercer bloque MODIFIED): (1) el título del tip, "las de sólo lectura no [auditan]", ya es falso hoy para `consultar_reporte_comisiones`, que audita `/reporte-comisiones` con `atendida` (`ejecutar-operacion.ts:747`); el delta de v3.12 había dejado caer la cláusula "o divulga" de la versión de `aprobacion-conversacional-hitl` y con ella el escenario del reporte. Con `ver_solicitudes_a2a` —de sólo lectura pero SÍ auditada— el título se vuelve insostenible, así que se lo RENOMBRA (sección `RENAMED` abajo; es sintaxis estándar de OpenSpec pero este repo no tiene precedente: quien archive debe aplicarla a mano si su herramienta no la soporta) y se restituyen la cláusula, el escenario del reporte y el de fallo de `registrarAccion`. `design.md` §15 pto 2 sólo exige dejar ESCRITA la excepción "sólo lectura pero SÍ audita" (el cuerpo del bloque lo hace); el renombrado es un agregado de esta fase, compatible con el design y reversible: para no renombrar, se elimina la sección `RENAMED` y se conserva el título del tip con el cuerpo tal cual. (2) El delta de v3.12 dejó caer otras cláusulas de la versión de `aprobacion-conversacional-hitl` (reuso de los literales de la TUI, "el camino feliz de `cancelar_solicitud_interna` no duplica fila"); NO se restituyen acá —no son de este change—: quedan señaladas para quien archive v3.12.

# Delta for Herramienta Operaciones Negocio

## MODIFIED Purpose

Capability existente. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente. El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (doce): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`, `resolver_reembolso`, `resolver_solicitud`, `solicitar_devolucion` (capability `devolucion-sin-token-dos-personas`), `consultar_venta` (capability `consulta-venta-empleado`), `consultar_solicitud` (capability `consulta-solicitud-empleado`), y la que este change agrega — `ver_solicitudes_a2a` (capability `visibilidad-a2a-entrante-chat`).

(Previously: once operaciones. Este change agrega la última.)

## RENAMED Requirements

- FROM: `### Requirement: Cada operación que muta deja fila de auditoría; las de sólo lectura no`
- TO: `### Requirement: Cada operación que muta o divulga datos de la empresa deja fila de auditoría; las lecturas de datos propios no`

## ADDED Requirements

### Requirement: `ver_solicitudes_a2a` no muta estado de negocio; su única escritura es la fila de auditoría

`ver_solicitudes_a2a` SHALL NOT modificar ninguna fila de `solicitudes_a2a_entrantes`, `casos`, `ventas` ni `solicitudes_internas`, ni el estado de ninguna ranura de confirmación, en ninguna de sus ramas. Su única escritura SHALL ser UNA fila de `registro_acciones_empleado` por invocación (a diferencia de `consultar_solicitud`, que no escribe ninguna). Vive en el vocabulario del contrato como operación de sólo lectura, sin `accion` ni `confirmado`; su alcance, su proyección y el tratamiento del texto externo que devuelve son de la capability `visibilidad-a2a-entrante-chat`.

#### Scenario: Instantánea de tablas idéntica salvo una fila de auditoría por invocación
- GIVEN una base `:memory:` con solicitudes A2A entrantes en distintos estados, ventas, solicitudes internas y casos
- WHEN se invoca `ver_solicitudes_a2a` sin id, con id existente y con id inexistente
- THEN las filas de `solicitudes_a2a_entrantes`, `casos`, `ventas` y `solicitudes_internas` son idénticas a la instantánea previa (incluido `updated_at`)
- AND `registro_acciones_empleado` tiene exactamente tres filas nuevas, una por invocación

## MODIFIED Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las doce operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `a2aTaskId`, `motivo?`, `decision`, `accion`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato sigue siendo `monto` de `registrar_venta`. `motivo`, en `solicitar_devolucion`, es texto libre acotado por un tope de longitud (RD-106), nunca un veredicto calculado por el modelo. `consultar_solicitud` SHALL aceptar únicamente `operacion` y `solicitudId?`. `ver_solicitudes_a2a` SHALL aceptar únicamente `operacion` y `a2aTaskId?`: un identificador estructurado, sin campo de identidad, de filtro ni de tope.

(Previously: enumeraba once operaciones; `ver_solicitudes_a2a` no existía, su schema (`a2aTaskId?`) no estaba fijado y `a2aTaskId` no figuraba entre los identificadores admitidos.)

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: `solicitar_devolucion` no acepta ningún campo de monto ni de veredicto
- GIVEN un intento de invocar `solicitar_devolucion` con un campo adicional de tipo monto, porcentaje o veredicto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar el módulo de iniciación

#### Scenario: El contrato enumera doce operaciones e incluye `ver_solicitudes_a2a`
- GIVEN `OPERACIONES_NEGOCIO` tras este change
- WHEN se inspecciona su contenido
- THEN tiene longitud 12, contiene `ver_solicitudes_a2a` una sola vez y las once anteriores (incluida `consultar_solicitud`) sin cambios

#### Scenario: `consultar_solicitud` acepta sólo `solicitudId` y rechaza cualquier otra clave
- GIVEN entradas `{operacion:"consultar_solicitud"}`, `{operacion:"consultar_solicitud", solicitudId:"s1"}` y `{operacion:"consultar_solicitud", solicitanteId:"e2"}`
- WHEN se validan
- THEN las dos primeras son válidas y la tercera es rechazada como clave extra

#### Scenario: `ver_solicitudes_a2a` acepta sólo `a2aTaskId` y `a2aTaskId` no pertenece a otra operación
- GIVEN entradas `{operacion:"ver_solicitudes_a2a"}`, `{operacion:"ver_solicitudes_a2a", a2aTaskId:"t1"}`, `{operacion:"ver_solicitudes_a2a", solicitudId:"s1"}` y `{operacion:"consultar_solicitud", a2aTaskId:"t1"}`
- WHEN se validan
- THEN las dos primeras son válidas y las dos últimas son rechazadas como clave extra

### Requirement: El mecanismo de confirmación en dos pasos cubre cuatro operaciones, nunca como campo del schema

Cuatro operaciones —`cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud` y `solicitar_devolucion`— SHALL resolver su confirmación en dos pasos consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`) desde el composition root. `solicitar_devolucion` SHALL usar un dominio de confirmación propio, distinto del de `resolver_reembolso`, para no pisar sobre el mismo `ventaId` una iniciación pendiente contra una aprobación pendiente (RD-107). Ninguna operación del contrato SHALL declarar `confirmado` como campo de su schema, en ninguna capa de validación. `consultar_solicitud` y `ver_solicitudes_a2a`, como `consultar_venta`, NO son confirmables.

(Previously: mencionaba sólo a `consultar_solicitud` como no confirmable; el conjunto de cuatro operaciones confirmables NO cambia — sólo el conteo total de schemas y la aclaración de que `ver_solicitudes_a2a` tampoco es confirmable.)

#### Scenario: Una iniciación pendiente y una aprobación pendiente sobre distintos `ventaId` conviven sin pisarse
- GIVEN una escalación con `resolver_reembolso` pendiente de confirmar sobre un `ventaId`, y una iniciación de `solicitar_devolucion` sobre otro `ventaId` pendiente de confirmar
- WHEN ambas ranuras de confirmación se resuelven en turnos separados
- THEN cada una completa su propia operación sin interferir con la otra

#### Scenario: `confirmado` no existe como campo en ningún schema del contrato
- GIVEN los doce schemas del servidor `operaciones`
- WHEN se inspeccionan sus campos aceptados
- THEN ninguno declara `confirmado`

### Requirement: Cada operación que muta o divulga datos de la empresa deja fila de auditoría; las lecturas de datos propios no

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` para cada operación que muta estado, con un literal distinguible por operación (exacto: RD-110), correlacionado por `ventaId`/`casoId` cuando aplique; y para cada operación de sólo lectura que divulga datos de la empresa o de un tercero: `consultar_reporte_comisiones` (`/reporte-comisiones`, `atendida`, sólo con período válido) y `ver_solicitudes_a2a` (`/ver-solicitudes-a2a`, `atendida` o `no_aplicable`; detalle en `visibilidad-a2a-entrante-chat`). `consultar_venta` y `consultar_solicitud`, de sólo lectura de datos PROPIOS del empleado, y el modo listado de `solicitar_devolucion` y de `resolver_reembolso`, SHALL NOT escribir fila de auditoría. Si `registrarAccion` lanza, el texto de negocio devuelto al modelo SHALL permanecer idéntico al del camino feliz, y el sistema SHALL emitir `accion-empleado-registro-fallido`.

(Previously: decía que las operaciones de sólo lectura no auditan, nombrando `consultar_venta` y `consultar_solicitud` — falso para `consultar_reporte_comisiones` (audita, `ejecutar-operacion.ts:747`) y para `ver_solicitudes_a2a`. Se restituye la cláusula "o divulga" que la versión de v3.12 dejó caer, con el escenario del reporte y el de fallo de `registrarAccion`. El criterio que separa: datos propios del empleado ⇒ sin fila; datos de la empresa o de un tercero ⇒ con fila. Título renombrado, ver sección `RENAMED`.)

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

#### Scenario: El reporte de comisiones deja fila atendida sólo si el período es válido
- GIVEN un empleado invoca `consultar_reporte_comisiones` con un período válido
- WHEN `resolverPeriodoReporte` resuelve OK
- THEN `registrarAccion` recibe `comando: "/reporte-comisiones"` con `resultado: "atendida"`; con un período inválido la tool corta antes de leer `reporteStore` y no llama a `registrarAccion`

#### Scenario: `ver_solicitudes_a2a` deja una fila en cada una de sus tres ramas
- GIVEN un empleado con sesión vigente
- WHEN invoca `ver_solicitudes_a2a` sin id, con un id existente y con un id inexistente
- THEN `registro_acciones_empleado` recibe tres filas con `comando: "/ver-solicitudes-a2a"`, con `resultado` `atendida`, `atendida` y `no_aplicable` respectivamente

#### Scenario: Si `registrarAccion` lanza, el texto de negocio no cambia y se marca el fallo de registro
- GIVEN una operación cuyo efecto o lectura ya se resolvió (por ejemplo `ver_solicitudes_a2a` sin id)
- WHEN `registrarAccion` lanza una excepción al intentar escribir la fila
- THEN el texto devuelto al modelo es idéntico al del camino feliz, y el sistema emite `accion-empleado-registro-fallido` en vez del genérico "no se aplicó nada" del `catch` global
