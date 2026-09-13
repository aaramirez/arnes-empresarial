---
name: solicitud-interna
description: Cuando el empleado quiera crear una solicitud interna (vacaciones, gasto, reclamo de comisión u otro trámite propio).
---

# Crear una solicitud interna

Convierte el pedido del empleado, dicho en lenguaje libre, en una llamada a
`mcp__operaciones__operacion_negocio` (operación `crear_solicitud_interna`).
Esta skill sólo arma la solicitud — no decide si se aprueba, ni calcula
ningún monto involucrado. **No cubre cancelar una solicitud ya enviada**:
para eso existe la skill `cancelar-solicitud`, esta skill es sólo para
crear una nueva.

## Cómo distinguir `tipo` de `detalle`

- **`tipo`**: la categoría del trámite, en una palabra o frase corta —
  por ejemplo "vacaciones", "gasto", "reclamo de comisión". Si el empleado
  no dice una categoría clara, preguntale de qué se trata antes de mandar
  algo ambiguo.
- **`detalle`**: todo lo demás que el empleado contó sobre su pedido, en
  prosa libre — fechas, montos que el empleado menciona sobre su propio
  gasto, motivo del reclamo, etc. No se estructura en campos separados, va
  como texto.

Si el `tipo` que arma la herramienta no es reconocido, el resultado va a
decir `tipo_desconocido` — explicáselo al empleado tal cual (por ejemplo,
pidiéndole que lo reformule o que use una categoría más estándar), sin
inventar una razón distinta a la que devolvió la herramienta.

## Caso particular: `reclamo_comision`

Un reclamo sobre una comisión que el empleado esperaba cobrar es un `tipo`
de solicitud interna más, igual que "vacaciones" o "gasto" — no es una
operación distinta. Para reunir el `detalle` en este caso, preguntale al
empleado:

1. Qué venta es (en sus palabras — cliente, fecha aproximada, lo que
   recuerde).
2. Qué esperaba cobrar de comisión por esa venta.
3. Qué pasó (por qué cree que hay una diferencia o que no se la liquidaron).

Armá el `detalle` con esas tres respuestas en prosa libre. **Nunca calcules
ni muestres un monto de comisión, ni intentes resolver a qué venta
corresponde por sistema** — ese cruce, si corresponde, lo hace el dictamen
humano que recibe la solicitud, no esta skill ni la herramienta.

## Cómo invocar y qué esperar

Llamá `mcp__operaciones__operacion_negocio` con
`{ operacion: "crear_solicitud_interna", tipo, detalle }`. Es la única
herramienta que esta skill necesita — nunca `Read`, `Bash`, `Write` ni
`Edit`. Una vez creada, la solicitud queda pendiente de dictamen y
aprobación humana — contale eso al empleado, no le digas que ya está
resuelta ni le des un resultado que la herramienta no devolvió.
