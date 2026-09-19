---
name: solicitar-devolucion
description: Cuando el empleado te pida iniciar la devolución de una venta que él mismo vendió y NO tiene el token de confirmación de esa venta. Si el empleado SÍ tiene el token, usá la skill `devolucion-conversacional` en su lugar.
---

# Iniciar una devolución sin token, sobre una venta propia

Arma la iniciación de una devolución sin token vía
`mcp__operaciones__operacion_negocio` (operación `solicitar_devolucion`).
Esta operación **NUNCA cierra la devolución** — solo la escala, y queda
pendiente de que un administrador aprueba el cierre en un paso separado,
fuera de esta skill. El flujo tiene pasos obligatorios y **nunca se
saltan ni se colapsan en un mismo turno**.

## Paso 0 — identificar la venta y pedir el motivo, antes de listar o ejecutar

Antes de invocar la herramienta, necesitás dos datos del empleado: **qué
venta** quiere devolver y **por qué** (el `motivo`). Si el empleado ya te
dio un `ventaId` inequívoco y el motivo en el mismo mensaje, pasá directo
al Paso 2. Si te falta cualquiera de los dos, pedíselo explícitamente:

- **Motivo**: si el empleado no dijo por qué quiere la devolución,
  preguntáselo y esperá su respuesta. **Nunca escribas vos un motivo**,
  ni lo deduzcas de la conversación, ni pongas un texto de relleno — es
  el único dato de este flujo que un auditor lee para entender la
  decisión.
- **Venta**: si el empleado no te dio un `ventaId` claro, seguí al
  Paso 1 para listar sus ventas propias y que identifique cuál es.

## Paso 1 — listado, sin `ventaId`

Si no tenés un `ventaId` inequívoco, invocá la herramienta con
`{ operacion: "solicitar_devolucion" }`, **sin** `ventaId` ni `motivo`.
Esto la pone en modo listado: la herramienta te devuelve las ventas
propias confirmadas del empleado, sin tocar nada todavía. Mostrale ese
listado para que identifique cuál quiere devolver.

## Paso 2 — eco de confirmación, repetido tal cual, sin resumir

Con `ventaId` y `motivo` ya identificados, invocá
`{ operacion: "solicitar_devolucion", ventaId, motivo }`. La herramienta
te va a devolver un eco de la venta (incluye `ventaId`, `clienteId`,
`monto`, `estado` y `planNuevo`). **Repetile ese eco al empleado tal
cual, sin resumirlo ni redondear ningún dato** — un `ventaId` mal
tipeado se detecta ahí, antes de escribir nada. Pedile que confirme
explícitamente que es esa venta y ese motivo los que quiere usar.

## Paso 3 — esperar un mensaje NUEVO antes de reinvocar

Esta es la instrucción más importante de esta skill: **una vez que
mostraste el eco y pediste confirmación, tenés que esperar un mensaje
nuevo del empleado en un turno posterior antes de volver a invocar la
herramienta con ese mismo `ventaId` y ese mismo `motivo`.** Nunca
reinvoques la herramienta en el mismo turno en el que mostraste el eco,
aunque el mensaje del empleado te parezca suficientemente afirmativo — la
confirmación tiene que llegar como un mensaje aparte, escrito después de
que se lo pediste. Recién cuando ese mensaje nuevo llega, invocá
`{ operacion: "solicitar_devolucion", ventaId, motivo }` otra vez, con
los mismos valores que confirmó.

## Cómo explicar el resultado al empleado

Cuando la herramienta confirme que la devolución quedó iniciada,
comunicaselo al empleado **sin prometer plazos**: la venta quedó
pendiente de reembolso y la tiene que aprobar un administrador
distinto — no vos, y no el que la vendió. **No digas que la plata se
devolvió**, porque no se devolvió.

## Herramientas

La única herramienta que esta skill necesita es
`mcp__operaciones__operacion_negocio` — nunca `Read`, `Bash`, `Write` ni
`Edit`. No hay ningún cálculo que hacer: el listado, el eco, la
confirmación y el resultado final los da siempre la herramienta.
