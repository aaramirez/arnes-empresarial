---
name: venta-decision
description: Cuando el empleado te diga que un cliente confirmó o rechazó una venta por otro medio (teléfono, en persona) y tengas o puedas pedir el token de confirmación de esa venta.
---

# Venta: decisión del cliente por otro medio

Traduce a la herramienta `mcp__operaciones__operacion_negocio` (operación
`resolver_decision_venta`) lo que el empleado ya escuchó del cliente por
teléfono o en persona. Esta skill nunca decide nada por su cuenta — la
decisión ya la tomó el cliente, el empleado sólo la transcribe.

## Datos que necesitás antes de invocar la herramienta

1. **`token`**: el token de confirmación de la venta. Si el empleado no lo
   trajo en el mensaje, pedíselo explícitamente antes de invocar la
   herramienta — nunca lo inventes ni lo adivines a partir de otro dato
   (nombre de cliente, fecha, monto).
2. **`decision`**: se arma a partir de lo que el empleado contó, no de una
   palabra técnica que tenga que conocer:
   - "confirmó" / "aceptó" / equivalentes → `decision: "confirmar"`.
   - "rechazó" / "canceló" / equivalentes → `decision: "rechazar"`.

Si el mensaje del empleado es ambiguo sobre qué dijo el cliente, preguntá
antes de mapear — no asumas un sentido por defecto.

## Cómo invocar

Llamá `mcp__operaciones__operacion_negocio` con
`{ operacion: "resolver_decision_venta", token, decision }`. Es la única
herramienta que esta skill necesita — nunca uses `Read`, `Bash`, `Write` ni
`Edit` para esto, ni intentes resolver el token vos mismo revisando algún
archivo.

## Cómo explicar el resultado al empleado

La herramienta devuelve uno de tres resultados textuales:

- `confirmada`: contale al empleado que la venta quedó confirmada.
- `rechazada`: contale que la venta quedó rechazada.
- `no_aplicable`: el token no corresponde a una venta pendiente de esta
  decisión (vencido, ya resuelto, o inexistente) — decíselo así, sin
  inventar una causa más específica que la herramienta no dio.

**Nunca inventes ni calcules el monto de la venta.** Si el monto aparece en
la respuesta, es porque la herramienta lo incluyó en su texto — repetilo tal
cual viene. Si no aparece, no lo agregues de memoria ni lo estimes.
