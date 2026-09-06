> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible. Delta escrito contra `openspec/changes/hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual/spec.md` (el spec archivado en `openspec/specs/` todavía no existe — solo `.gitkeep` — así que esa es la fuente de la versión "actual"), siguiendo `proposal.md` (ADR 23, 26 y su enmienda de la revisión 3, `## Capabilities > Modified Capabilities`).

# Delta for Reporte Comisiones Mensual

## ADDED Requirements

### Requirement: La nota de escalaciones ya no afirma ausencia de vía de producto ni identidad por configuración

El texto de `NOTA_ESCALACION_FUERA_DE_BANDA` SHALL NOT afirmar que no existe ninguna vía de producto para cerrar una escalación, SHALL NOT describir el rechazo como irreversible, y SHALL NOT decir que la identidad del resolvedor se toma de la configuración. SHALL mencionar los tres comandos de resolución (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`) y la salvedad de que el canal es la TUI local con login por empleado.

#### Scenario: Reporte con la nota actualizada
- GIVEN se ejecuta `npm run reporte:mensual`
- WHEN se imprime la sección de escalaciones
- THEN el texto menciona los tres comandos de resolución
- AND no afirma que la resolución es SQL manual, ni que el rechazo es irreversible, ni que la identidad sale de una variable de entorno

### Requirement: Una venta `reembolso_rechazado` no cuenta como reembolso en el reporte

`ventasConReembolso` (o el conteo equivalente que hace visible R5 de Hito 4) SHALL NOT contar una venta en `reembolso_rechazado`, porque en un rechazo no se devolvió plata. Una venta reabierta (`reembolso_pendiente`) SHALL volver a aparecer en el listado de pendientes sin código adicional.

#### Scenario: Rechazo no se cuenta como reembolso
- GIVEN una venta pasó de `confirmada` a `reembolso_pendiente` y luego a `reembolso_rechazado`
- WHEN se genera el reporte mensual
- THEN esa venta no se cuenta en `ventasConReembolso`

#### Scenario: Venta reabierta vuelve a aparecer como pendiente
- GIVEN una venta en `reembolso_rechazado` se reabre a `reembolso_pendiente`
- WHEN se genera el reporte mensual
- THEN esa venta aparece de nuevo en la sección de reembolsos pendientes de aprobación
