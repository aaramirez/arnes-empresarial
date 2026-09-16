> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/operaciones-negocio-conversacionales/specs/herramienta-operaciones-negocio/spec.md` — versión vigente única de esta capability. Cuatro puntos ya identificados por `proposal.md` (Purpose 6→8, "fuera de alcance" mientras el ADR 151 esté BLOQUEADO deja de ser cierto, requirement `:70-77` invertido, requirement `:47-54` pasa de una a tres operaciones) **más un quinto verificado en esta fase**: el requirement de auditoría (`:88-105`) enumera exhaustivamente operación por operación qué literal reusa cada una — con dos operaciones nuevas que mutan/divulgan, esa enumeración queda incompleta si no se extiende. El detalle operativo de las dos operaciones nuevas vive en la capability nueva `resolucion-hitl-conversacional`; este delta sólo cubre el contrato.

# Delta for Herramienta Operaciones Negocio

## MODIFIED Purpose

Capability existente. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente. El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (ocho, tras la ejecución del ADR 151): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`, y las dos que este change agrega — `resolver_reembolso` y `resolver_solicitud` (capability `resolucion-hitl-conversacional`).

(Previously: seis operaciones, con las tres transiciones de escalación de reembolso y las dos de solicitud interna excluidas del contrato "mientras el ADR 151 esté BLOQUEADO". El ADR 151 se ejecuta en este change: deja de existir una exclusión condicionada a su estado.)

## REMOVED Requirements

### Requirement: Las cinco operaciones HITL bloqueadas por el ADR 151 no están en el contrato

(Reason: el ADR 151 pasa de BLOQUEADO a EJECUTADO en este change. Su inverso — que las dos operaciones que reemplazan a esas cinco SÍ están en el contrato, con su gate de rol heredado — queda como requirement ADDED en la capability nueva `resolucion-hitl-conversacional`.)

## MODIFIED Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las ocho operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `motivo?`, `decision`, `accion`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato sigue siendo `monto` de `registrar_venta`. `accion`, en `resolver_reembolso` y `resolver_solicitud`, es una elección de operación de una unión cerrada, nunca un veredicto calculado por el modelo.

(Previously: enumeraba seis operaciones, sin mención de `accion` como campo del contrato.)

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: Una operación válida delega el cálculo íntegro al núcleo
- GIVEN un input válido para `procesar_devolucion` con solo `token`
- WHEN se invoca la tool
- THEN el monto, la auto-aprobación o escalación, los produce únicamente `procesarDevolucion`

### Requirement: El mecanismo de confirmación en dos pasos cubre tres operaciones, nunca como campo del schema

Tres operaciones —`cancelar_solicitud_interna`, `resolver_reembolso` y `resolver_solicitud`— SHALL resolver su confirmación en dos pasos consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`) desde el composition root. Ninguna operación del contrato SHALL declarar `confirmado` como campo de su schema, en ninguna capa de validación — es inexpresable por el modelo, en cualquier operación. El sistema SHALL NOT derivar el equivalente interno de `confirmado: true` de una frase ambigua; SHALL requerir un turno explícito de confirmación posterior y distinto.

(Previously: "La única operación con `confirmado: boolean` es `cancelar_solicitud_interna`" — redactado sobre un campo de schema que ninguna operación declaró nunca. Esta versión corrige la lectura: lo que cambia es cuántas operaciones usan el mecanismo de dos pasos, de una a tres — no que aparezca un campo nuevo.)

#### Scenario: Una frase ambigua no dispara ninguna de las tres operaciones de dos pasos
- GIVEN el empleado dice "quiero cancelar mi solicitud" sin confirmar explícitamente
- WHEN el modelo procesa el turno
- THEN la operación no se invoca con el estado interno equivalente a `confirmado: true` en ese turno

#### Scenario: `confirmado` no existe como campo en ningún schema del contrato
- GIVEN los ocho schemas del servidor `operaciones`
- WHEN se inspeccionan sus campos aceptados
- THEN ninguno declara `confirmado`

### Requirement: Cada operación que muta o divulga deja la misma fila de auditoría que el comando que reemplazó

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` (`RegistroAccionesEmpleadoPort`) para cada operación que muta estado o divulga datos sensibles, reusando el mismo literal de `comando` que escribía el comando de TUI que reemplaza — `/devolucion`, `/solicitar`, `/cancelar-solicitud` (únicamente en el camino de CAS perdido), `/reporte-comisiones`, y los cinco retirados por este change (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`, ahora alcanzados por `resolver_reembolso`/`resolver_solicitud`) — y los literales `operacion:registrar_venta`/`operacion:resolver_decision_venta` para las dos operaciones sin comando previo. El camino feliz de `cancelar_solicitud_interna`, `resolver_reembolso` y `resolver_solicitud` SHALL NOT escribir fila desde el dispatcher cuando la transacción del store ya la escribe. El listado de `resolver_reembolso`/`resolver_solicitud` SHALL NOT escribir fila de auditoría. Si `registrarAccion` lanza, el texto de negocio devuelto al modelo SHALL permanecer idéntico al del camino feliz, y el sistema SHALL emitir `accion-empleado-registro-fallido`.

(Previously: enumeraba cuatro literales reusados y dos acuñados, sobre seis operaciones, sin cubrir el listado de las dos nuevas. Esta versión agrega los cinco literales retirados de la TUI, ahora reusados por las dos operaciones nuevas, y aclara que su listado tampoco escribe fila — mismo criterio que el resto del contrato.)

#### Scenario: Una devolución conversacional deja la misma fila que dejaba el comando de TUI
- GIVEN un empleado con sesión vigente invoca `procesar_devolucion` desde el turno conversacional
- WHEN `procesarDevolucion` resuelve cualquiera de sus tres ramas
- THEN `registrarAccion` recibe `comando: "/devolucion"` con el mismo `resultado`, `ventaId` y `casoId` que escribía el comando retirado

#### Scenario: Un rechazo de `resolver_reembolso` reusa el literal del comando que reemplazó
- GIVEN un empleado con rol base invoca `resolver_reembolso { accion: "aprobar", ventaId }` y confirma
- WHEN el gate de rol lo rechaza
- THEN `registrarAccion` recibe `comando: "/aprobar-reembolso"`, el mismo literal que escribía el comando retirado

#### Scenario: El listado de `resolver_reembolso` no escribe fila de auditoría
- GIVEN un empleado invoca `resolver_reembolso` sin `ventaId`
- WHEN recibe el listado
- THEN `registrarAccion` no se invoca
