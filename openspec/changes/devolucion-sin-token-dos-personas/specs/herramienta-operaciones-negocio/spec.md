> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Delta escrito contra `openspec/changes/aprobacion-conversacional-hitl/specs/herramienta-operaciones-negocio/spec.md` — versión vigente (ocho operaciones). No existe en esa versión un requirement de enumeración exhaustiva separado para REMOVER (el patrón que v3.6 dejó y v3.10 tuvo que remover ya fue resuelto en esta versión: el conteo vive en el `Purpose`, que se edita in-place con bloque `Previously`).

# Delta for Herramienta Operaciones Negocio

## MODIFIED Purpose

Capability existente. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente. El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (diez): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`, `resolver_reembolso`, `resolver_solicitud`, y las dos que este change agrega — `solicitar_devolucion` (capability `devolucion-sin-token-dos-personas`) y `consultar_venta` (capability `consulta-venta-empleado`).

(Previously: ocho operaciones. Este change agrega las dos últimas.)

## MODIFIED Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las diez operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `motivo?`, `decision`, `accion`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato sigue siendo `monto` de `registrar_venta`. `motivo`, en `solicitar_devolucion`, es texto libre acotado por un tope de longitud (RD-106), nunca un veredicto calculado por el modelo.

(Previously: enumeraba ocho operaciones, sin mención del `motivo` de `solicitar_devolucion` como texto libre acotado.)

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: `solicitar_devolucion` no acepta ningún campo de monto ni de veredicto
- GIVEN un intento de invocar `solicitar_devolucion` con un campo adicional de tipo monto, porcentaje o veredicto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar el módulo de iniciación

### Requirement: El mecanismo de confirmación en dos pasos cubre cuatro operaciones, nunca como campo del schema

Cuatro operaciones —`cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud` y `solicitar_devolucion`— SHALL resolver su confirmación en dos pasos consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`) desde el composition root. `solicitar_devolucion` SHALL usar un dominio de confirmación propio, distinto del de `resolver_reembolso`, para no pisar sobre el mismo `ventaId` una iniciación pendiente contra una aprobación pendiente (RD-107). Ninguna operación del contrato SHALL declarar `confirmado` como campo de su schema, en ninguna capa de validación.

(Previously: cubría tres operaciones. Este change agrega `solicitar_devolucion` como la cuarta, con dominio de confirmación propio.)

#### Scenario: Una iniciación pendiente y una aprobación pendiente sobre distintos `ventaId` conviven sin pisarse
- GIVEN una escalación con `resolver_reembolso` pendiente de confirmar sobre un `ventaId`, y una iniciación de `solicitar_devolucion` sobre otro `ventaId` pendiente de confirmar
- WHEN ambas ranuras de confirmación se resuelven en turnos separados
- THEN cada una completa su propia operación sin interferir con la otra

#### Scenario: `confirmado` no existe como campo en ningún schema del contrato
- GIVEN los diez schemas del servidor `operaciones`
- WHEN se inspeccionan sus campos aceptados
- THEN ninguno declara `confirmado`

### Requirement: Cada operación que muta deja fila de auditoría; las de sólo lectura no

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` para cada operación que muta estado, con un literal distinguible por operación (exacto: RD-110), correlacionado por `ventaId`/`casoId` cuando aplique. `consultar_venta`, siempre de sólo lectura, y el modo listado de `solicitar_devolucion` y de `resolver_reembolso`, SHALL NOT escribir fila de auditoría.

(Previously: enumeraba los literales reusados/acuñados de las ocho operaciones existentes, sin cubrir las dos operaciones nuevas de este change.)

#### Scenario: `consultar_venta` nunca escribe fila de auditoría
- GIVEN cualquier invocación de `consultar_venta`, con o sin `ventaId`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN no se creó ninguna fila nueva

#### Scenario: Una iniciación exitosa de `solicitar_devolucion` deja fila distinguible
- GIVEN una iniciación exitosa que deja la venta en `reembolso_pendiente`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN existe una fila con un `resultado` distinguible de una escalación creada por el camino del token, correlacionada por `ventaId`/`casoId`, y sin el `motivo`
