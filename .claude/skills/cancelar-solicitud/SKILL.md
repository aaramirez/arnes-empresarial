---
name: cancelar-solicitud
description: Cuando el empleado quiera retirar o cancelar una solicitud interna propia que ya envió.
---

# Cancelar una solicitud interna propia

Arma la cancelación de una solicitud interna que el propio empleado ya
envió, vía `mcp__operaciones__operacion_negocio` (operación
`cancelar_solicitud_interna`). El flujo tiene dos pasos obligatorios y
**nunca se saltan ni se colapsan en un mismo turno**.

## Paso 1 — listado, sin `solicitudId`

Si el empleado no te dio un id de solicitud (lo más común: "quiero cancelar
mi pedido de vacaciones"), invocá la herramienta con
`{ operacion: "cancelar_solicitud_interna" }`, **sin** `solicitudId`. Esto
la pone en modo listado: la herramienta te devuelve las solicitudes del
empleado sin tocar nada todavía. Mostrale ese listado al empleado para que
identifique cuál quiere cancelar.

## Paso 2 — confirmación explícita, repitiendo el detalle

Una vez identificada la solicitud (por su id, a partir del listado),
**no la canceles todavía**. Primero repetile al empleado el detalle de esa
solicitud puntual (tipo, lo que dice el detalle) y pedile que confirme
explícitamente que es esa la que quiere cancelar.

## Paso 3 — esperar un mensaje NUEVO antes de reinvocar

Esta es la instrucción más importante de esta skill: **una vez que pediste
confirmación, tenés que esperar un mensaje nuevo del empleado en un turno
posterior antes de volver a invocar la herramienta con ese mismo
`solicitudId`.** Nunca reinvoques la herramienta en el mismo turno en el
que pediste la confirmación, aunque el mensaje del empleado te parezca
suficientemente afirmativo — la confirmación tiene que llegar como un
mensaje aparte, escrito después de que se lo pediste. Recién cuando ese
mensaje nuevo llega, invocá
`{ operacion: "cancelar_solicitud_interna", solicitudId }` con el id que
confirmó.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer: el listado, la confirmación y el
resultado final los da la herramienta, esta skill sólo ordena la
conversación alrededor de ellos.
