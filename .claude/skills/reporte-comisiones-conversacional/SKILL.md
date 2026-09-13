---
name: reporte-comisiones-conversacional
description: Cuando el empleado pida el reporte de comisiones o de ventas de un periodo (propio o de la empresa) por texto.
---

# Reporte de comisiones, por conversación

Pide a `mcp__operaciones__operacion_negocio` (operación
`consultar_reporte_comisiones`) el reporte de un periodo y transmite el
texto que devuelve. A diferencia de las otras cinco skills de este dominio,
esta es de sólo lectura: no hay token, no hay doble paso de confirmación,
no hay nada que crear ni cancelar.

## Cómo entender o pedir el `periodo`

- Formato esperado: `YYYY-MM` (por ejemplo `2026-03`).
- Si el empleado no menciona un periodo, dejá el campo vacío — la
  herramienta usa el mes corriente por defecto, no hace falta que vos
  calcules cuál es "el mes actual".
- Si el empleado da una fecha en otro formato ("marzo", "el mes pasado"),
  convertila vos al formato `YYYY-MM` antes de invocar la herramienta; si
  no podés resolver a qué mes se refiere con certeza, preguntale.

## Cómo invocar

Llamá `mcp__operaciones__operacion_negocio` con
`{ operacion: "consultar_reporte_comisiones", periodo? }`. Es la única
herramienta que esta skill necesita — nunca `Read`, `Bash`, `Write` ni
`Edit`.

## Cómo transmitir el resultado — la regla más importante de esta skill

El texto que devuelve la herramienta se relaya **tal cual**, sin resumirlo
ni recalcular ningún total, porcentaje o comisión a partir de los números
que trae. Si el empleado pide un dato que el texto no incluye (por ejemplo,
un desglose que el reporte no trae), decile que ese dato no está en el
reporte — no lo estimes a partir de lo que sí viene.

## Alcance del reporte — aclaralo si preguntan

Si el empleado pregunta si el reporte es "el suyo" o el de toda la empresa:
aclarale que el reporte es el de **toda la empresa** para el periodo
pedido, no uno filtrado a sus propias ventas — es una limitación conocida
del reporte, sin una versión distinta disponible en este sistema. No
intentes filtrarlo vos mismo ni sugerir que "en teoría" se podría acotar.
