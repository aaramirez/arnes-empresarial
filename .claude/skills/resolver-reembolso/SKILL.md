---
name: resolver-reembolso
description: Cuando el empleado quiera aprobar, rechazar o reabrir una escalación de reembolso pendiente de validación.
---

# Resolver una escalación de reembolso ajena

Arma la resolución de una escalación de reembolso que le toca validar al
empleado, vía `mcp__operaciones__operacion_negocio` (operación
`resolver_reembolso`). El flujo tiene pasos obligatorios y **nunca se
saltan ni se colapsan en un mismo turno**.

## Paso 0 — la acción, antes que el id

Antes de listar nada, necesitás saber **qué acción** quiere el empleado:
`aprobar`, `rechazar` o `reabrir`. Esto no es opcional ni un detalle de
orden: el listado de reembolsos depende de la acción — `reabrir` lista
las escalaciones ya rechazadas, mientras que `aprobar`/`rechazar` listan
las pendientes. Pedir un listado con la acción equivocada le muestra al
empleado el conjunto equivocado. Si el empleado no fue inequívoco sobre
cuál de las tres quiere (por ejemplo dijo "resolvelo", "dale", "hacé lo
que corresponda" o "fijate vos"), preguntale explícitamente cuál de las
tres acciones quiere — nunca la elijas vos, ni la deduzcas del contexto.

## Paso 1 — listado, sin `ventaId`

Si el empleado no te dio el id de la venta (lo más común: "aprobame el
reembolso de la devolución que escalaron"), invocá la herramienta con
`{ operacion: "resolver_reembolso", accion }` (la acción del Paso 0),
**sin** `ventaId`. Esto la pone en modo listado: la herramienta te
devuelve las escalaciones correspondientes a esa acción, sin tocar nada
todavía. Mostrale ese listado al empleado para que identifique cuál
quiere resolver.

## Paso 2 — confirmación explícita, repitiendo el detalle tal cual

Una vez identificada la venta (por su id, a partir del listado), **no la
resuelvas todavía**. Primero repetile al empleado el detalle de esa
escalación puntual **tal cual te lo devolvió la herramienta, sin resumir
ni redondear ningún monto**, y pedile que confirme explícitamente que es
esa la que quiere resolver con la acción elegida.

## Paso 3 — esperar un mensaje NUEVO antes de reinvocar

Esta es la instrucción más importante de esta skill: **una vez que
pediste confirmación, tenés que esperar un mensaje nuevo del empleado en
un turno posterior antes de volver a invocar la herramienta con esa
misma `accion` y ese mismo `ventaId`.** Nunca reinvoques la herramienta
en el mismo turno en el que pediste la confirmación, aunque el mensaje
del empleado te parezca suficientemente afirmativo — la confirmación
tiene que llegar como un mensaje aparte, escrito después de que se lo
pediste. Recién cuando ese mensaje nuevo llega, invocá
`{ operacion: "resolver_reembolso", accion, ventaId }` con el id que
confirmó.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer, y esta skill no filtra por rol
ni anticipa quién puede resolver qué: el listado, la confirmación, el
rechazo por rol o por autoaprobación, y el resultado final los da
siempre la herramienta.
