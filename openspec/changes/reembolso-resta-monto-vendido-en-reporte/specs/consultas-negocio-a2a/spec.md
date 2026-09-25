> Base verificada: `consultas-negocio-a2a-entrante/specs/consultas-negocio-a2a/spec.md` es la única versión de la capability (sin deltas posteriores). Ningún requirement fija importes brutos. El agregado lo arma `formatearAgregadoReporteComisiones` con `sum(filas.montoVendido)` y `reporte.totalComisionado`, así que hereda el neto sin cambio de código; esta capability no exige la leyenda (decisión del proposal: la leyenda va sólo en la tabla). Se usa ADDED porque no cambia ningún requirement existente.

# Delta for Consultas Negocio A2A

## ADDED Requirements

### Requirement: El agregado `reporte_comisiones` informa monto y comisión netos de reembolsos aplicados

En `operacion: "reporte_comisiones"`, "Monto vendido" y "Total comisionado" SHALL ser netos de los reembolsos aplicados (`reembolsada`), tal como los calcula `agruparReporteMensual`. "Ventas confirmadas" y "Ventas con reembolso" SHALL conservar el conteo bruto. Una fila de vendedor con todas sus ventas reembolsadas SHALL seguir contando en "Vendedores con ventas". La salida SHALL seguir sin fila por vendedor. La herramienta SHALL NOT recalcular el neto por su cuenta.

#### Scenario: Una venta reembolsada resta del agregado
- GIVEN un periodo con la venta `confirmada` de 1000.00 (comisión 100.00) de un vendedor y la venta `reembolsada` de 1500.00 (comisión 225.00) de otro
- WHEN se invoca `reporte_comisiones` para ese periodo
- THEN el texto trae `Monto vendido: 1000.00` y `Total comisionado: 100.00`
- AND `Ventas confirmadas: 2`, `Ventas con reembolso: 1` y `Vendedores con ventas: 2`

#### Scenario: Pendiente y rechazado no restan en el agregado
- GIVEN un periodo con una venta `reembolso_pendiente` de 15000.00 (comisión 1500.00) y una `reembolso_rechazado` de 1000.00 (comisión 100.00)
- WHEN se invoca `reporte_comisiones`
- THEN el texto trae `Monto vendido: 16000.00` y `Total comisionado: 1600.00`

#### Scenario: El agregado sigue recortado
- GIVEN un periodo con reembolsos aplicados
- WHEN se invoca `reporte_comisiones`
- THEN el texto no incluye `vendedor_nombre`, fila por vendedor ni leyenda de la tabla
