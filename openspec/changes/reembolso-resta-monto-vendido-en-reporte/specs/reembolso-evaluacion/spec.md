> Base verificada: el requirement vive en `hito-1.3-ventas-comisiones/specs/reembolso-evaluacion/spec.md:63-70`. Contra lo que dice el proposal, el delta de `tui-canal-empleado` NO contiene este requirement, y `operaciones-negocio-conversacionales` y `devolucion-sin-token-dos-personas` tampoco: la base vigente es la de hito-1.3. El bloque se copió completo y se editó. La prohibición sobre la tabla `comisiones` (`SHALL NOT ... ajustar o anular la fila`) sigue cierta; el descuento vive sólo en el reporte, derivado al leer (ADR 301 declara R5 superseded para el reporte).

# Delta for Reembolso Evaluación

## MODIFIED Requirements

### Requirement: Reembolso parcial y reversión de comisión fuera de alcance

`ventas.estado = 'reembolsada'` SHALL ser todo-o-nada sobre `monto`; el sistema SHALL NOT registrar un monto reembolsado parcial ni ajustar o anular la fila de `comisiones` correspondiente al reembolsar. El reporte mensual (capability `reporte-comisiones-mensual`) SHALL descontar de forma derivada, al leer, el monto y la comisión de las ventas `reembolsada`, sin persistir ningún ajuste: la tabla `comisiones` sigue registrando la comisión originalmente generada y no es un libro de lo efectivamente pagado.
(Previously: no distinguía la reversión persistida de la derivada; el reembolso aprobado dejaba viva la comisión también en el reporte.)

#### Scenario: Comisión ya pagada permanece tras un reembolso aprobado
- GIVEN una venta con comisión ya calculada se aprueba para reembolso (bajo el umbral)
- WHEN `ventas.estado` pasa a `reembolsada`
- THEN la fila de `comisiones` original permanece sin cambios y ningún registro de ajuste se crea

#### Scenario: El reporte descuenta sin tocar la tabla
- GIVEN una venta `reembolsada` de 1500.00 con comisión 225.00 en la tabla `comisiones`
- WHEN se genera el reporte mensual de su periodo
- THEN el vendedor no suma esos 1500.00 ni esos 225.00
- AND la fila de `comisiones` sigue en 225.00 y no se crea ningún registro de ajuste
