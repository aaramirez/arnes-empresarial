> Nota de proceso: mismo hook de graphify sin shell disponible (Read/Edit/Write/Grep/Glob únicamente). Capability nueva, verificada contra `proposal.md` (ADR 206-208, 217) y `design.md` (§0.1, §8, §11) de este change. Cubre el efecto observable de las dos operaciones que reemplazan a los cinco comandos HITL de la TUI. La ranura de confirmación en sí es capability separada (`confirmacion-operaciones-multislot`) y la autoaprobación de reembolso vive en `reembolso-resolucion-escalacion` — este spec sólo los referencia.

# Resolución HITL Conversacional Specification

## Purpose

Capability nueva. Expone, dentro de la herramienta `operaciones` (capability `herramienta-operaciones-negocio`), las dos operaciones que reemplazan a los cinco comandos HITL retirados de la TUI: `resolver_reembolso` (transiciones `aprobar`/`rechazar`/`reabrir` de `resolverEscalacionReembolso`) y `resolver_solicitud` (transiciones `aprobar`/`rechazar` de `resolverSolicitudInterna`). Cada una delega el cálculo íntegro a la función determinista existente y hereda, sin reimplementarla, la autorización que esa función ya evalúa.

**Fuera de alcance de este spec**: el modelo de rol en sí y la prohibición de autoaprobación (capabilities `autorizacion-empleado` y `reembolso-resolucion-escalacion`), la estructura de la ranura de confirmación (capability `confirmacion-operaciones-multislot`), y el gate de rol sobre el modo listado (deuda declarada, R5, sin cambio).

## Requirements

### Requirement: `accion` es una elección de operación, nunca un veredicto calculado por el modelo

El schema de `resolver_reembolso` SHALL aceptar `accion: "aprobar" | "rechazar" | "reabrir"`; el de `resolver_solicitud` SHALL aceptar `accion: "aprobar" | "rechazar"`. Ninguno de los dos SHALL aceptar `"cancelar"` como valor de `accion` — esa transición tiene su propia operación (`cancelar_solicitud_interna`). Un valor de `accion` fuera de la unión permitida de cada operación SHALL rechazarse antes de invocar la función determinista, sin excepción no controlada y sin fila de auditoría de fallo interno.

#### Scenario: Un valor de `accion` ajeno al dominio se rechaza antes del núcleo
- GIVEN una invocación de `resolver_solicitud` con `accion: "reabrir"`
- WHEN se valida el input
- THEN la validación rechaza el input antes de invocar `resolverSolicitudInterna`, sin lanzar una excepción no controlada

#### Scenario: `"cancelar"` nunca es un valor válido de `resolver_solicitud`
- GIVEN una invocación de `resolver_solicitud` con `accion: "cancelar"`
- WHEN se valida el input
- THEN la validación rechaza el input, y `cancelar_solicitud_interna` no se invoca por esta vía

### Requirement: Ausencia de id activa el modo listado, con cero escrituras

`ventaId` ausente en `resolver_reembolso`, o `solicitudId` ausente en `resolver_solicitud`, SHALL activar el listado determinista existente de la función pura correspondiente, sin ninguna escritura en `ventas`, `casos`, `solicitudes_internas` ni en la ranura de confirmación. El identificador que el modelo use en una invocación posterior SHALL provenir de ese listado, nunca de un valor inventado.

#### Scenario: Listar reembolsos pendientes no escribe nada
- GIVEN un empleado con sesión vigente invoca `resolver_reembolso` con `accion: "aprobar"` y sin `ventaId`
- WHEN la operación se ejecuta
- THEN devuelve el listado de escalaciones pendientes con ids reales, y ninguna tabla de negocio ni la ranura de confirmación cambia

### Requirement: `confirmado` es inexpresable por el modelo en las dos operaciones

Ninguno de los dos schemas SHALL declarar un campo `confirmado`. La confirmación en dos pasos SHALL calcularse exclusivamente en el composition root, consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`), y SHALL pasarse a la función determinista como parámetro ya resuelto — nunca como un valor que el modelo declaró.

#### Scenario: El modelo no puede declarar la confirmación
- GIVEN el schema completo de `resolver_reembolso` y de `resolver_solicitud`
- WHEN se inspeccionan sus campos aceptados, en el objeto de validación del borde y en la whitelist estricta
- THEN ninguno de los dos incluye `confirmado`

#### Scenario: Una frase ambigua no dispara la resolución
- GIVEN el empleado dice "resolvé eso" sin confirmar explícitamente la acción propuesta
- WHEN el modelo procesa el turno
- THEN la operación no se invoca con el estado interno equivalente a `confirmado: true` en ese turno

### Requirement: El gate de rol se hereda por delegación; el dispatcher no lo reimplementa

`ejecutar-operacion.ts` SHALL delegar el 100% de la decisión de autorización a `resolverEscalacionReembolso` y `resolverSolicitudInterna`, y SHALL NOT invocar `puedeResolverAjeno`, leer el rol, ni comparar identidades para decidir si la operación procede. Un empleado con rol base que confirme resolver una escalación o solicitud ajena SHALL recibir el mismo texto de rechazo que ya produce el gate existente, sin ejecutar ninguna escritura salvo la fila de auditoría del intento.

#### Scenario: Rol base es rechazado por el canal conversacional con el mismo mensaje que hoy
- GIVEN un empleado con rol base y sesión vigente, y una escalación de reembolso ajena en `reembolso_pendiente`
- WHEN confirma `resolver_reembolso { accion: "aprobar", ventaId }`
- THEN recibe el mismo texto de rechazo por autorización que produce el gate existente, `ventas.estado` no cambia, y se escribe la fila de auditoría del intento

#### Scenario: `ejecutar-operacion.ts` no contiene lógica de autorización
- GIVEN el código fuente de `ejecutar-operacion.ts`
- WHEN se inspecciona por imports y símbolos
- THEN no importa `autorizacion-resolucion` ni menciona `puedeResolverAjeno`
