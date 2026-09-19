---
name: devolucion-conversacional
description: Cuando el empleado te pida procesar la devolución de una venta y TIENE (o puede conseguir) el token de confirmación de esa venta. Si el empleado NO tiene el token pero la venta la vendió él, usá la skill `solicitar-devolucion` en su lugar.
---

# Devolución de una venta, por conversación

Reemplaza al comando `/devolucion <token> [motivo]`: el empleado ahora lo
pide en lenguaje natural y esta skill arma la llamada a
`mcp__operaciones__operacion_negocio` (operación `procesar_devolucion`) en
vez de que el empleado tenga que recordar la sintaxis del comando.

## Datos que necesitás antes de invocar la herramienta

1. **`token`**: el token de confirmación de la venta a devolver. Si el
   empleado describe la venta en palabras ("la venta del cliente X de la
   semana pasada") en vez de dar el token, pedíselo explícitamente — esta
   skill no busca ni adivina el token por otro medio, sólo lo recibe del
   empleado.
2. **`motivo`** (opcional): si el empleado lo menciona, incluilo tal cual lo
   dijo. Si no lo menciona, no es obligatorio pedirlo — la operación acepta
   la devolución sin motivo.

## Cómo invocar

Llamá `mcp__operaciones__operacion_negocio` con
`{ operacion: "procesar_devolucion", token, motivo? }`. Es la única
herramienta que esta skill necesita — nunca `Read`, `Bash`, `Write` ni
`Edit`.

## Cómo explicar el resultado al empleado

La herramienta devuelve uno de tres resultados textuales:

- `reembolsada`: la devolución se procesó y el reembolso quedó hecho —
  contáselo así al empleado.
- `escalada`: la devolución no se resolvió sola y quedó pendiente de
  revisión humana — explicáselo, sin prometer un tiempo de resolución que
  la herramienta no dio.
- `no_aplicable`: el token no corresponde a una venta que pueda devolverse
  en este momento — comunicalo tal cual, sin inventar una causa puntual que
  la herramienta no devolvió.

No calcules ni sugieras un monto de reembolso — ese dato, si la herramienta
lo incluye en su texto, se repite tal cual; si no lo incluye, no se agrega.
