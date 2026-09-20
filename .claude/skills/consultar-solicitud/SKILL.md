---
name: consultar-solicitud
description: Cuando el empleado quiera saber en qué quedó una solicitud interna propia —si se la aprobaron o rechazaron, qué dijo el dictamen y cuándo—, o ver el listado de las suyas. Operación de sólo lectura, sin confirmación. Para retirar o cancelar una solicitud, usar cancelar-solicitud.
---

# Consultar el estado de una solicitud interna propia

Arma la consulta de una solicitud interna propia (o el listado de las
propias) vía `mcp__operaciones__operacion_negocio` (operación
`consultar_solicitud`). Es una operación de **sólo lectura**: no escribe
nada, no escala nada, y no tiene paso de confirmación — a diferencia de
otras skills de esta herramienta, invocala directamente en cuanto tengas
lo que necesitás.

Esta skill es distinta de las otras tres skills vecinas sobre
solicitudes internas: `cancelar-solicitud` es para **retirar o dar de
baja** una solicitud, no para enterarse de en qué quedó; `solicitud-interna`
es para **crear** una nueva; y `resolver-solicitud` es para **aprobar o
rechazar** una solicitud **ajena**. Si el empleado quiere alguna de esas
tres cosas, no uses esta skill.

## Con `solicitudId` conocido

Si el empleado te dio (o pudiste identificar sin ambigüedad) el
`solicitudId` de la solicitud que quiere consultar, invocá directamente
`{ operacion: "consultar_solicitud", solicitudId }`. La herramienta te
devuelve el detalle de esa solicitud puntual, incluido el estado
(pendiente, aprobada o rechazada) y, si ya fue resuelta, el `dictamen` y
quién la resolvió. Mostrale el `dictamen` al empleado **tal cual, sin
resumirlo ni interpretarlo** — es el juicio de quien la resolvió, no lo
suavices ni lo endurezcas.

## Sin `solicitudId`

Si el empleado no te dio un `solicitudId` (por ejemplo "¿qué solicitudes
tengo?" o "¿cómo van mis pedidos?"), invocá
`{ operacion: "consultar_solicitud" }`, sin `solicitudId`. La herramienta
te devuelve el listado de sus solicitudes propias — mostráselo tal cual.

## Solicitud ajena

Si el `solicitudId` no corresponde a una solicitud del empleado, la
herramienta lo rechaza distinguiendo ese caso de "no existe" —
comunicaselo tal cual, sin inventar una causa que la herramienta no dio.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer: el detalle, el listado, el
dictamen y el rechazo por solicitud ajena los da siempre la herramienta.
