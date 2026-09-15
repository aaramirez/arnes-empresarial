> Nota de proceso: sin herramienta de shell disponible en este ejecutor (solo Read/Edit/Write/Grep/Glob). Spec nueva, sin delta previo — verificado por `Glob` que `openspec/changes/*/specs/consultas-negocio-a2a/` no existe. Cubre ADR 174, 177, 178, 180 de `proposal.md`. Molde de formato: `openspec/changes/operaciones-negocio-conversacionales/specs/herramienta-operaciones-negocio/spec.md` (mismo patrón: servidor MCP in-process, contrato tipado por operación, nunca lanza).

# Consultas Negocio A2A Specification

## Purpose

Capability nueva. Servidor MCP in-process `mcp__consultas__consultar_negocio` (molde `knowledge-tool.ts`), única tool nueva habilitada en el turno A2A entrante. Expone, con un parámetro `operacion` discriminado, cuatro operaciones de sólo lectura sobre reporte de comisiones, estado de actividad/PR, solicitudes internas pendientes y escalaciones/ventas en reembolso pendiente. Cada operación delega el 100% del cálculo a funciones deterministas existentes de `src/core/ventas/reporte.ts` y `src/adapters/memory/repository.ts`, sin modificarlas (ADR 177).

**Fuera de alcance de este spec**: el invariante de composición del turno (`mcpServers`, campos de `BuildOnA2AEntranteDeps`) — capability `turno-a2a-entrante-solo-lectura`. El contenido del Agent Card — capability `servidor-a2a-jsonrpc`.

## Requirements

### Requirement: Cuatro operaciones de sólo lectura, una tool con `operacion` discriminada

El servidor MCP `consultas` SHALL exponer una única tool, `consultar_negocio`, con un parámetro `operacion` discriminado entre exactamente cuatro valores: reporte de comisiones por período, estado de actividad/PR por referencia, solicitudes internas pendientes, escalaciones/ventas en reembolso pendiente (ADR 178).

#### Scenario: Un `operacion` fuera del conjunto cerrado se rechaza sin tocar el núcleo
- GIVEN un intento de invocar `consultar_negocio` con un `operacion` no reconocido
- WHEN el schema valida el input
- THEN la validación falla antes de invocar cualquier función de `reporte.ts` o `repository.ts`

#### Scenario: Una operación válida devuelve datos reales de negocio
- GIVEN `operacion: "reporte_comisiones"` válido con un período existente
- WHEN se invoca la tool
- THEN el texto devuelto refleja el resultado real de `resolverPeriodoReporte`/`agruparReporteMensual`, no una generalidad

### Requirement: Ningún schema acepta un parámetro que induzca escritura

Ninguna de las cuatro variantes SHALL declarar un campo que permita crear, modificar, aprobar, rechazar o cancelar una entidad de negocio. Los únicos parámetros aceptados SHALL ser identificadores de consulta (período, referencia externa, filtro de estado).

#### Scenario: El schema no tiene campos de escritura
- GIVEN el schema completo de las cuatro variantes
- WHEN se inspeccionan sus campos
- THEN ninguno corresponde a alta, modificación, aprobación, rechazo o cancelación

### Requirement: La tool nunca lanza ni rechaza, en ningún camino de falla

`consultar_negocio` SHALL traducir toda falla (input inválido, período/referencia inexistente, error del repositorio) a un `CallToolResult` de texto, molde `knowledge-tool.ts:11-14`. SHALL NOT lanzar excepción ni dejar una promesa rechazada sin capturar.

#### Scenario: Una referencia inexistente se traduce a texto, no a excepción
- GIVEN `operacion: "estado_actividad"` con una `referenciaExterna` inexistente
- WHEN se invoca la tool
- THEN el modelo recibe texto indicando que no se encontró, sin excepción propagada

### Requirement: La salida se recorta de datos personales antes de llegar al modelo

El sistema SHALL excluir de la salida `vendedor_nombre`, `cliente_id`, `solicitanteId` y `detalle` de solicitudes internas; SHALL devolver únicamente agregados, conteos y estados (ADR 180). La consulta puntual de actividad/PR por referencia SHALL devolver estado y timestamps, SHALL NOT devolver `responsable_id`.

#### Scenario: La salida de comisiones no contiene la fila por vendedor
- GIVEN un doble de `listComisionesPorPeriodo` con `vendedor_id`, `vendedor_nombre` y `comision_monto` por fila
- WHEN se traduce el resultado
- THEN el texto devuelto trae total y conteo del período, sin `vendedor_nombre` ni fila individual

#### Scenario: La salida de solicitudes pendientes no contiene `solicitanteId` ni `detalle`
- GIVEN un doble de `listarSolicitudesPendientes` con `solicitanteId` y `detalle` en texto libre
- WHEN se traduce el resultado
- THEN el texto devuelto trae conteos por estado/tipo, sin `solicitanteId` ni `detalle`

#### Scenario: La consulta de actividad por referencia no devuelve el responsable
- GIVEN una actividad existente con `responsable_id` poblado
- WHEN se consulta su estado por `referenciaExterna`
- THEN el texto devuelto trae estado y timestamps, sin `responsable_id`
