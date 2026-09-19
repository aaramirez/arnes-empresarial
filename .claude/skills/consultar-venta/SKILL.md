---
name: consultar-venta
description: Cuando el empleado quiera saber el estado de una venta propia puntual (incluida la decisión del cliente) o el listado de sus ventas propias. Operación de sólo lectura, sin confirmación.
---

# Consultar el estado de una venta propia

Arma la consulta de una venta propia (o el listado de las propias) vía
`mcp__operaciones__operacion_negocio` (operación `consultar_venta`). Es
una operación de **sólo lectura**: no escribe nada, no escala nada, y no
tiene paso de confirmación — a diferencia de otras skills de esta
herramienta, invocala directamente en cuanto tengas lo que necesitás.

## Con `ventaId` conocido

Si el empleado te dio (o pudiste identificar sin ambigüedad) el
`ventaId` de la venta que quiere consultar, invocá directamente
`{ operacion: "consultar_venta", ventaId }`. La herramienta te devuelve
el estado de esa venta puntual, incluida la decisión del cliente
(confirmada, rechazada, pendiente, en reembolso, etc.) — mostrásela al
empleado tal cual, sin resumir el estado.

## Sin `ventaId`

Si el empleado no te dio un `ventaId` (por ejemplo "¿cómo van mis
ventas?" o "quiero ver el estado de mis ventas"), invocá
`{ operacion: "consultar_venta" }`, sin `ventaId`. La herramienta te
devuelve el listado de sus ventas propias — mostráselo tal cual.

## Venta ajena

Si el `ventaId` no corresponde a una venta del empleado, la herramienta
lo rechaza distinguiendo ese caso de "no existe" — comunicaselo tal cual,
sin inventar una causa que la herramienta no dio.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer: el estado, el listado y el
rechazo por venta ajena los da siempre la herramienta.
