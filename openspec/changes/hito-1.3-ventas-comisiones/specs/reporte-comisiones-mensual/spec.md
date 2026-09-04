> Nota de proceso: mismo hook de graphify aplica; sin herramienta de shell disponible en este ejecutor, no se pudo correr `graphify query`/`explain`. Spec basado en `proposal.md` (ADR 9, Approach, Success Criteria) y en `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-board-mirror/spec.md` como plantilla de formato.

# Reporte Comisiones Mensual Specification

## Purpose

Capability nueva. `npm run reporte:mensual` es un script CLI independiente que agrega `ventas` + `comisiones` por `vendedor_id` y `periodo`, e imprime el comparativo junto con el listado de reembolsos pendientes de aprobación (`ventas.estado = 'reembolso_pendiente'`). No hay Registro de Comandos genérico ni scheduler (ADR 9): el comando corre a mano, bajo demanda.

**Fuera de alcance de este spec**: cualquier disparo automático (cron, `node-cron`, `setInterval`), un Registro de Comandos que resuelva comandos por nombre, formato de salida como archivo persistido.

## Requirements

### Requirement: Comando bajo demanda, sin scheduler ni registro

`npm run reporte:mensual` SHALL ser el único disparador del reporte. El sistema SHALL NOT incluir ningún temporizador, cron ni Registro de Comandos que lo dispare automáticamente.

#### Scenario: El reporte no se dispara solo
- GIVEN el proceso de la TUI está corriendo con normalidad
- WHEN pasa un mes calendario sin que nadie ejecute `npm run reporte:mensual`
- THEN no se genera ni imprime ningún reporte
- AND no existe ningún proceso en background que lo intente

### Requirement: Agregación pura por vendedor y periodo

`agruparReporteMensual` SHALL ser una función pura que, dado un conjunto de `ventas` y `comisiones` y un `periodo`, agrupa el total comisionado por `vendedor_id`, testeable sin base de datos ni red.

#### Scenario: Comparativo por vendedor para un periodo dado
- GIVEN ventas confirmadas de dos vendedores distintos con comisiones en el mismo `periodo`
- WHEN se ejecuta `npm run reporte:mensual` para ese `periodo`
- THEN el reporte imprime el total comisionado agrupado por `vendedor_id`

### Requirement: Listado de reembolsos pendientes de aprobación

El reporte SHALL incluir una sección que lista las ventas en `reembolso_pendiente`, independientemente de su `periodo` de confirmación.

#### Scenario: Reembolso escalado aparece en el reporte
- GIVEN una venta quedó en `reembolso_pendiente` (capability `reembolso-evaluacion`)
- WHEN se ejecuta `npm run reporte:mensual`
- THEN esa venta aparece listada en la sección de reembolsos pendientes de aprobación

### Requirement: Ejecutar o no ejecutar el comando no afecta el resto del sistema

No correr `npm run reporte:mensual` SHALL NOT tener ningún efecto sobre `ventas`, `comisiones`, ni el resto del arnés.

#### Scenario: Sistema funciona igual sin correr el reporte nunca
- GIVEN el comando de reporte nunca se ejecuta
- WHEN el resto del sistema (ventas, confirmación, soporte, devolución) opera con normalidad
- THEN ningún flujo depende de que el reporte se haya corrido
