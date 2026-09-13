> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin herramienta de shell disponible en este ejecutor — solo Read/Edit/Write/Grep/Glob). Molde de formato: `openspec/changes/hito-1.1-consulta-conocimiento/specs/knowledge/spec.md` (servidor MCP in-process, degradación sin excepción). Alcance de operaciones fijado por `proposal.md` tras la Enmienda 2 (cuatro funciones completas + `cancelar` de `resolverSolicitudInterna`) y ampliado por la Enmienda 5/ADR 174 (`consultar_reporte_comisiones`, sexta operación) — **corregido en la tarea 12 de `tasks.md`**, esta versión ya refleja las seis. Las cinco operaciones HITL del ADR 151 quedan explícitamente FUERA — verificado contra el bloque de estado ⛔ del ADR 151 y el Success Criteria de `proposal.md`.

# Herramienta Operaciones Negocio Specification

## Purpose

Capability nueva. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente, sin modificarla (ADR 145 pto 5). El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (Enmienda 2 + Enmienda 5/ADR 174, ADR 151 BLOQUEADO): `registrar_venta` (`registrarVenta`), `resolver_decision_venta` (`resolverDecisionVenta`), `procesar_devolucion` (`procesarDevolucion`), `crear_solicitud_interna` (`crearSolicitudInterna`), `cancelar_solicitud_interna` (`resolverSolicitudInterna` con `accion: "cancelar"` únicamente), `consultar_reporte_comisiones` (`resolverPeriodoReporte`/`agruparReporteMensual`/`formatearReporteMensual`, sin gate de rol, sin campo de dinero ni de identidad en el input).

**Fuera de alcance de este spec**: las tres transiciones de `resolverEscalacionReembolso` (`aprobar`/`rechazar`/`reabrir`) y las acciones `aprobar`/`rechazar` de `resolverSolicitudInterna` — quedan fuera del contrato mientras el ADR 151 esté BLOQUEADO (capabilities `reembolso-resolucion-escalacion` y `solicitud-interna-hitl`, sin delta de este change). Granularidad exacta — una tool con `operacion` discriminada vs. varias tools — es RD-68, `sdd-design`.

## Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las seis operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `motivo?`, `decision`, `accion`, `confirmado`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato es `monto` de `registrar_venta` (ADR 170 pto 5).

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: Una operación válida delega el cálculo íntegro al núcleo
- GIVEN un input válido para `procesar_devolucion` con solo `token`
- WHEN se invoca la tool
- THEN el monto, la auto-aprobación o escalación, los produce únicamente `procesarDevolucion`

### Requirement: Traducción de cada `Result` discriminado a texto, sin lanzar ni rechazar

Cada operación SHALL traducir el `Result` de su función determinista (incluidas sus ramas de error: `no_aplicable`, `no_es_dueno`, token inexistente/vencido) a un `CallToolResult` de texto, molde `knowledge-tool.ts`. La tool SHALL NOT lanzar una excepción ni dejar un rechazo sin capturar en ningún camino.

#### Scenario: Una rama de error del núcleo se traduce a texto
- GIVEN `procesarDevolucion` devuelve `no_aplicable` porque la venta no está `confirmada`
- WHEN la tool traduce el resultado
- THEN el modelo recibe texto explicando el rechazo, sin excepción propagada

### Requirement: `empleadoId` nunca es parámetro; `sesion` y `deps` se cierran por closure

Ninguna operación SHALL declarar `empleadoId` como parámetro de su schema. La `sesion: SesionEmpleado` y las `deps` de cada función SHALL cerrarse en el composition root desde la sesión autenticada del turno (ADR 147 pto 1-2).

#### Scenario: El modelo no puede nombrar a otro empleado
- GIVEN un turno con `sesion.empleadoId = "E1"`
- WHEN el modelo invoca cualquier operación
- THEN la función determinista recibe `sesion.empleadoId = "E1"` sin que el schema exponga campo para sobreescribirlo

### Requirement: `confirmado` representa una confirmación humana, no una inferencia del modelo

La única operación con `confirmado: boolean` es `cancelar_solicitud_interna`. El sistema SHALL NOT derivar `confirmado: true` de una frase ambigua; SHALL requerir un turno explícito de confirmación (mecanismo exacto: RD-71, `sdd-design`).

#### Scenario: Una frase ambigua no dispara la cancelación
- GIVEN el empleado dice "quiero cancelar mi solicitud" sin confirmar explícitamente
- WHEN el modelo procesa el turno
- THEN la tool no se invoca con `confirmado: true` en ese turno

### Requirement: La sexta operación es de sólo lectura y no admite escopado por vendedor

`consultar_reporte_comisiones` SHALL delegar exclusivamente en `resolverPeriodoReporte`, `agruparReporteMensual` y `formatearReporteMensual` (`core/ventas/reporte.ts`), sin gate de rol y sin ningún parámetro de escopado por vendedor o empleado (Enmienda 5, ADR 174 pto 2 — R12 aceptado explícitamente por el checkpoint, no es un hallazgo pendiente). Su schema SHALL aceptar únicamente `periodo?: string`.

#### Scenario: Un período inválido no toca el store de reporte
- GIVEN un input de `consultar_reporte_comisiones` con `periodo` en un formato inválido
- WHEN se invoca la tool
- THEN se devuelve el mensaje de uso de `resolverPeriodoReporte` y no ocurre ninguna llamada a `reporteStore` (cero filas leídas)

#### Scenario: Sin filtro de vendedor, R12 aceptado por checkpoint
- GIVEN un input válido de `consultar_reporte_comisiones` (con o sin `periodo`)
- WHEN se invoca la tool
- THEN el reporte devuelto incluye las comisiones de todos los vendedores del período, sin ningún parámetro que permita escoparlo a un vendedor o empleado en particular

### Requirement: Las cinco operaciones HITL bloqueadas por el ADR 151 no están en el contrato

El schema del servidor `operaciones` SHALL NOT exponer `aprobar`/`rechazar`/`reabrir` de escalación ni `aprobar`/`rechazar` de solicitud interna, mientras el ADR 151 permanezca BLOQUEADO.

#### Scenario: Un test sobre el schema confirma la ausencia de las cinco operaciones
- GIVEN el schema completo del servidor `operaciones`
- WHEN se inspeccionan sus operaciones declaradas
- THEN ninguna corresponde a `aprobar_escalacion`, `rechazar_escalacion`, `reabrir_escalacion`, `aprobar_solicitud` ni `rechazar_solicitud`

### Requirement: Las seis funciones deterministas del núcleo no se modifican

Este change SHALL NOT modificar la firma ni el cuerpo de `registrarVenta`, `resolverDecisionVenta`, `procesarDevolucion`, `resolverEscalacionReembolso`, `resolverSolicitudInterna` ni `crearSolicitudInterna`. Tampoco SHALL modificar `resolverPeriodoReporte`, `agruparReporteMensual` ni `formatearReporteMensual` (`core/ventas/reporte.ts`) — las tres funciones puras que reusa `consultar_reporte_comisiones` (ADR 174 consecuencias). La herramienta las consume tal cual existen hoy.

#### Scenario: `git diff` no toca ninguna de las seis funciones ni las tres funciones puras de reporte
- GIVEN el `git diff` completo de este change
- WHEN se inspeccionan los archivos de `src/core/ventas/` y `src/core/solicitudes/` que las contienen
- THEN ninguno tiene una línea modificada dentro del cuerpo de esas seis funciones ni de `resolverPeriodoReporte`, `agruparReporteMensual` o `formatearReporteMensual`

### Requirement: Cada operación que muta o divulga deja la misma fila de auditoría que el comando que reemplazó

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` (`RegistroAccionesEmpleadoPort`) para cada operación que muta estado o divulga datos sensibles, reusando el mismo literal de `comando` que escribía el comando de TUI que reemplaza — `/devolucion` (`procesar_devolucion`), `/solicitar` (`crear_solicitud_interna`), `/cancelar-solicitud` (`cancelar_solicitud_interna`, únicamente en el camino de CAS perdido) y `/reporte-comisiones` (`consultar_reporte_comisiones`) — y los literales nuevos `operacion:registrar_venta`/`operacion:resolver_decision_venta` para las dos operaciones sin comando previo (ADR 188). El camino feliz de `cancelar_solicitud_interna` SHALL NOT escribir fila desde el dispatcher, porque la transacción del store ya la escribe. Si `registrarAccion` lanza, el texto de negocio devuelto al modelo SHALL permanecer idéntico al del camino feliz, y el sistema SHALL emitir `accion-empleado-registro-fallido`.

#### Scenario: Una devolución conversacional deja la misma fila que dejaba el comando de TUI
- GIVEN un empleado con sesión vigente invoca `procesar_devolucion` desde el turno conversacional
- WHEN `procesarDevolucion` resuelve cualquiera de sus tres ramas (`reembolsada`, `escalada`, `no_aplicable`)
- THEN `registrarAccion` recibe `comando: "/devolucion"` con el mismo `resultado`, `ventaId` y `casoId` que escribía el comando `/devolucion` retirado de la TUI

#### Scenario: La cancelación exitosa no duplica su fila de auditoría
- GIVEN un empleado invoca `cancelar_solicitud_interna` y la cancelación se resuelve en el camino feliz
- WHEN el dispatcher del núcleo traduce el `Result` a texto
- THEN `ejecutar-operacion.ts` NO llama a `registrarAccion` — la única fila de auditoría es la que la transacción de `cancelarSolicitudInterna` ya escribió en el store, sin duplicados

#### Scenario: El reporte de comisiones deja fila atendida sólo si el período es válido
- GIVEN un empleado invoca `consultar_reporte_comisiones` con un período válido
- WHEN `resolverPeriodoReporte` resuelve OK
- THEN `registrarAccion` recibe `comando: "/reporte-comisiones"` con `resultado: "atendida"`; si el período es inválido, la tool corta antes de leer `reporteStore` y no llama a `registrarAccion` en absoluto

#### Scenario: Si `registrarAccion` lanza, el texto de negocio no cambia y se marca el fallo de registro
- GIVEN una operación cuya función determinista ya resolvió el efecto de negocio (por ejemplo `procesar_devolucion`)
- WHEN `registrarAccion` lanza una excepción al intentar escribir la fila
- THEN el texto devuelto al modelo es idéntico al del camino feliz, y el sistema emite `accion-empleado-registro-fallido` en vez del genérico "no se aplicó nada" del `catch` global
