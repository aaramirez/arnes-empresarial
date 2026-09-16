---
name: resolver-solicitud
description: Cuando el empleado quiera aprobar o rechazar una solicitud interna de otro empleado que le toque validar.
---

# Resolver una solicitud interna ajena

Arma la resolución de una solicitud interna de otro empleado que le toca
validar, vía `mcp__operaciones__operacion_negocio` (operación
`resolver_solicitud`). El flujo tiene pasos obligatorios y **nunca se
saltan ni se colapsan en un mismo turno**.

## Paso 0 — la acción, antes que el id

Antes de listar nada, necesitás saber **qué acción** quiere el empleado:
`aprobar` o `rechazar`. Si el empleado no fue inequívoco sobre cuál de
las dos quiere (por ejemplo dijo "resolvela", "dale", "hacé lo que
corresponda" o "fijate vos"), preguntale explícitamente cuál de las dos
acciones quiere — nunca la elijas vos, ni la deduzcas del contexto, ni
del dictamen que pueda venir con la solicitud.

## Paso 1 — listado, sin `solicitudId`

Si el empleado no te dio el id de la solicitud (lo más común: "aprobame
la solicitud de vacaciones que me llegó"), invocá la herramienta con
`{ operacion: "resolver_solicitud", accion }` (la acción del Paso 0),
**sin** `solicitudId`. Esto la pone en modo listado: la herramienta te
devuelve las solicitudes ajenas pendientes de esa acción, sin tocar nada
todavía. Mostrale ese listado al empleado para que identifique cuál
quiere resolver.

## Paso 2 — confirmación explícita, repitiendo el detalle tal cual

Una vez identificada la solicitud (por su id, a partir del listado),
**no la resuelvas todavía**. Primero repetile al empleado el detalle de
esa solicitud puntual **tal cual te lo devolvió la herramienta, sin
resumir ni redondear nada** (incluido el dictamen, si lo trae), y pedile
que confirme explícitamente que es esa la que quiere resolver con la
acción elegida.

## Paso 3 — esperar un mensaje NUEVO antes de reinvocar

Esta es la instrucción más importante de esta skill: **una vez que
pediste confirmación, tenés que esperar un mensaje nuevo del empleado en
un turno posterior antes de volver a invocar la herramienta con esa
misma `accion` y ese mismo `solicitudId`.** Nunca reinvoques la
herramienta en el mismo turno en el que pediste la confirmación, aunque
el mensaje del empleado te parezca suficientemente afirmativo — la
confirmación tiene que llegar como un mensaje aparte, escrito después de
que se lo pediste. Recién cuando ese mensaje nuevo llega, invocá
`{ operacion: "resolver_solicitud", accion, solicitudId }` con el id que
confirmó.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer, y esta skill no filtra por rol
ni anticipa quién puede resolver qué: el listado, la confirmación, el
rechazo por rol o por autoaprobación, y el resultado final los da
siempre la herramienta.
