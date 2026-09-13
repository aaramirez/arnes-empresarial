---
name: registrar-venta-conversacional
description: Cuando el empleado te pida dar de alta una venta nueva (cliente, plan, monto ya pactado con el cliente).
---

# Registrar una venta nueva

Arma el alta de una venta ya cerrada con el cliente, vía
`mcp__operaciones__operacion_negocio` (operación `registrar_venta`). Esta
skill sólo reúne los datos que el empleado ya tiene sobre un acuerdo
cerrado — no negocia, no sugiere precios y no completa nada que el empleado
no haya dicho.

## Datos mínimos que necesitás antes de invocar la herramienta

- **`clienteId`**: quién es el cliente. Si el empleado no da un id exacto,
  pedile el dato que lo identifique (nombre, email u otro identificador que
  maneje).
- **`clienteEmail`**: el email del cliente.
- **`planNuevo`**: el plan que el cliente contrató.
- **`planAnterior`** (opcional): sólo si el empleado menciona que el
  cliente venía de otro plan.
- **`monto`**: ver el invariante de abajo — es el dato más sensible de esta
  skill.
- **`vendedorNombre`**: el nombre del vendedor a mostrar en el registro
  (dato de la venta, no de la sesión — ver más abajo la diferencia con el
  vendedor autenticado).

Si falta cualquiera de estos datos, pedíselo al empleado antes de invocar
la herramienta — no completes un campo con un valor supuesto.

## Invariante del `monto` — no negociable

El `monto` que va a la herramienta es **siempre** el que el empleado
declara como ya pactado con el cliente. Esta skill **nunca** estima,
calcula ni sugiere un monto: si el empleado no lo tiene a mano, se lo
pedís, nunca se lo inventás ni se lo redondeás ni se lo completás con un
valor de referencia. El monto es un hecho que transcribís, no un resultado
que producís.

## `vendedorId` nunca se pide

A diferencia de `vendedorNombre` (dato de la venta, que sí pedís), el
`vendedorId`/la identidad del vendedor que registra la venta **nunca** es
algo que le preguntes al empleado ni que vos completes — lo pone la sesión
autenticada del turno, automáticamente. Si el empleado te da un nombre o id
de otro vendedor distinto del que está usando el sistema en este turno, no
lo uses como identidad de la venta — la identidad siempre es la de la
sesión, no la que dicte el texto.

## Cómo invocar

Llamá `mcp__operaciones__operacion_negocio` con
`{ operacion: "registrar_venta", clienteId, clienteEmail, planNuevo, monto, vendedorNombre, planAnterior? }`.
Es la única herramienta que esta skill necesita — nunca `Read`, `Bash`,
`Write` ni `Edit`.

## Cómo explicar el resultado

Contale al empleado lo que la herramienta devolvió, sin agregar un cálculo
propio (por ejemplo, no recalcules una comisión ni un total a partir del
monto registrado — eso no es parte de esta skill).
