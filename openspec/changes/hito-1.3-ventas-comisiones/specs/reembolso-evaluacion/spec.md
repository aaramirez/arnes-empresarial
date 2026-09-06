> Nota de proceso: mismo hook de graphify aplica; sin herramienta de shell disponible en este ejecutor, no se pudo correr `graphify query`/`explain`. Spec basado en `proposal.md` (ADR 11, R3, R5, Success Criteria) y en `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-board-mirror/spec.md` como plantilla de formato.

# Reembolso Evaluación Specification

## Purpose

Capability nueva. `POST /devolucion` evalúa una solicitud de reembolso sobre una venta `confirmada`: por debajo del umbral configurado, auto-aprueba (`reembolsada`); por encima, escala a un humano (`reembolso_pendiente` + `caso.estado = 'pendiente_aprobacion_humana'`) sin transición automática. Ningún paso invoca al modelo. **Este hito construye la detección y persistencia de la escalación, no su cierre**: no hay endpoint de aprobación/rechazo, pantalla de TUI ni notificación al aprobador — la resolución es fuera de banda hasta el Hito 5 (dueño declarado del HITL).

**Fuera de alcance de este spec**: aprobar o rechazar una escalación desde el producto, reembolso parcial, reversión de la comisión ya pagada, notificación al aprobador.

## Requirements

### Requirement: Devolución requiere una venta confirmada

`POST /devolucion` SHALL operar únicamente sobre ventas con `estado = 'confirmada'`. Sobre cualquier otro estado, SHALL rechazar sin efecto.

#### Scenario: Devolución sobre venta no confirmada
- GIVEN una venta en `pendiente_confirmacion` o `rechazada`
- WHEN llega un `POST /devolucion` para esa venta
- THEN se rechaza sin efecto
- AND `ventas.estado` no cambia

### Requirement: Evaluación determinista del reembolso, sin invocar al modelo

`evaluarReembolso(monto, umbral)` SHALL ser una función pura. `POST /devolucion` SHALL NOT invocar `handleTurn` ni el SDK del agente en ningún caso.

#### Scenario: Evaluación no llama al modelo
- GIVEN una venta confirmada solicita devolución
- WHEN se evalúa contra `REEMBOLSO_UMBRAL`
- THEN la decisión se resuelve sin ninguna llamada al modelo

### Requirement: Auto-aprobación por debajo del umbral

Un `monto` estrictamente menor a `REEMBOLSO_UMBRAL` SHALL transicionar `ventas.estado` a `'reembolsada'` sin intervención humana.

#### Scenario: Monto bajo el umbral se aprueba solo
- GIVEN una venta confirmada con `monto < REEMBOLSO_UMBRAL`
- WHEN llega `POST /devolucion`
- THEN `ventas.estado` pasa a `reembolsada`
- AND no se crea ninguna escalación

### Requirement: Escalación humana por encima del umbral, sin transición automática

Un `monto` mayor o igual a `REEMBOLSO_UMBRAL` SHALL transicionar `ventas.estado` a `'reembolso_pendiente'` y, en la misma transacción, `caso.estado` (vía `ventas.caso_id`) a `'pendiente_aprobacion_humana'`. La venta SHALL NOT transicionar a `reembolsada` de forma automática, y la fila de `comisiones` ya creada al confirmar SHALL permanecer intacta.

#### Scenario: Monto sobre el umbral escala a un humano
- GIVEN una venta confirmada con `monto >= REEMBOLSO_UMBRAL`
- WHEN llega `POST /devolucion`
- THEN `ventas.estado` pasa a `reembolso_pendiente` y el `caso` correlacionado pasa a `pendiente_aprobacion_humana`
- AND ningún proceso mueve la venta a `reembolsada` automáticamente
- AND la fila de `comisiones` de esa venta no se modifica ni se elimina

### Requirement: Cierre de la escalación fuera de alcance de este hito

El sistema SHALL NOT exponer ningún endpoint, pantalla ni notificación para aprobar o rechazar una venta en `reembolso_pendiente` en este hito. La resolución se realiza fuera de banda hasta que el Hito 5 (HITL) la construya.

#### Scenario: No existe camino de producto para cerrar la escalación
- GIVEN una venta en `reembolso_pendiente`
- WHEN se busca un endpoint o pantalla para aprobarla o rechazarla
- THEN no existe ninguno en este hito
- AND el único estado observable es el listado en el reporte mensual (capability `reporte-comisiones-mensual`)

### Requirement: Reembolso parcial y reversión de comisión fuera de alcance

`ventas.estado = 'reembolsada'` SHALL ser todo-o-nada sobre `monto`; el sistema SHALL NOT registrar un monto reembolsado parcial ni ajustar o anular la fila de `comisiones` correspondiente al reembolsar.

#### Scenario: Comisión ya pagada permanece tras un reembolso aprobado
- GIVEN una venta con comisión ya calculada se aprueba para reembolso (bajo el umbral)
- WHEN `ventas.estado` pasa a `reembolsada`
- THEN la fila de `comisiones` original permanece sin cambios y ningún registro de ajuste se crea
