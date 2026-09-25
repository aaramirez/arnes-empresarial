> Base verificada: `openspec/specs/` sólo tiene `.gitkeep`. El requirement modificado se copió de `hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual/spec.md:23-30` (ningún delta posterior lo toca: `tui-canal-empleado`, `comando-reporte-comisiones` y `consultas-negocio-a2a-entrante` sólo tocan otros requirements). Ningún requirement vigente fija que "Monto vendido" o "Total comisionado" sean brutos (`rg` sobre `openspec/changes/*/specs`). Decisión B1 = (ii) tomada por el humano el 2026-09-24. Los textos exactos de la leyenda y el ancho de columnas son de `design`. Sin shell ni `graphify query` en este ejecutor.

# Delta for Reporte Comisiones Mensual

## MODIFIED Requirements

### Requirement: Agregación pura por vendedor y periodo

`agruparReporteMensual` SHALL ser una función pura que, dado un conjunto de `ventas` y `comisiones` y un `periodo`, agrupa por `vendedor_id`, testeable sin base de datos ni red. Por vendedor, el "Monto vendido" SHALL ser la suma de `ventaMonto` de las ventas cuyo estado NO es `reembolsada`, y el "Total comisionado" SHALL ser la suma de `comision.monto` de esas mismas ventas: una venta `reembolsada` resta ambos. Las ventas `reembolso_pendiente` y `reembolso_rechazado` SHALL NOT restar nada. "Ventas" SHALL conservar el conteo bruto y "Con reembolso" SHALL contar las ventas `reembolsada` más las `reembolso_pendiente`, sin las `reembolso_rechazado`. El cálculo SHALL derivarse al leer, con el redondeo vigente: SHALL NOT requerir migración ni modificar la tabla `comisiones`.
(Previously: agrupaba "el total comisionado por `vendedor_id`" sin distinguir el estado de la venta, de modo que un reembolso aprobado no descontaba nada.)

#### Scenario: Comparativo por vendedor para un periodo dado
- GIVEN ventas confirmadas de dos vendedores distintos con comisiones en el mismo `periodo`
- WHEN se ejecuta `npm run reporte:mensual` para ese `periodo`
- THEN el reporte imprime el total comisionado agrupado por `vendedor_id`

#### Scenario: Sólo el estado `reembolsada` resta
- GIVEN cuatro vendedores, cada uno con una única venta de 1000.00 y comisión 100.00, en estado `confirmada`, `reembolsada`, `reembolso_pendiente` y `reembolso_rechazado` respectivamente
- WHEN se agrupa el periodo
- THEN `confirmada`, `reembolso_pendiente` y `reembolso_rechazado` quedan en 1000.00 / 100.00
- AND `reembolsada` queda en 0.00 / 0.00
- AND "Con reembolso" vale 0, 1, 1 y 0 en el orden `confirmada`, `reembolsada`, `reembolso_pendiente`, `reembolso_rechazado`, con "Ventas" = 1 en los cuatro

#### Scenario: Reembolsos aplicados con datos reales
- GIVEN Ana Vendedora con 4 ventas, 3 `reembolsada` por 2500.00 en total (comisión 250.00), y Beto con 3 ventas, 2 `reembolsada` por 700.00 en total (comisión 70.00); ambos hoy en 3700.00 / 370.00
- WHEN se agrupa el periodo
- THEN Ana queda en 1200.00 / 120.00 con "Ventas" 4 y "Con reembolso" 3
- AND Beto queda en 3000.00 / 300.00 con "Ventas" 3 y "Con reembolso" 2

#### Scenario: Un reembolso pendiente no resta aunque su monto sea alto
- GIVEN Vendedor Prueba Hito36 con 1 venta `reembolso_pendiente` de 15000.00 (comisión 1500.00)
- WHEN se agrupa el periodo
- THEN queda en 15000.00 / 1500.00 con "Ventas" 1 y "Con reembolso" 1

#### Scenario: Fila con todas sus ventas reembolsadas
- GIVEN un vendedor cuyas ventas del periodo están todas en `reembolsada`
- WHEN se agrupa e imprime el periodo
- THEN su fila se imprime con 0.00 / 0.00, sin desaparecer y sin error
- AND "Ventas" y "Con reembolso" conservan el conteo bruto

#### Scenario: La tabla `comisiones` no se altera
- GIVEN una venta `reembolsada` cuya fila de `comisiones` tiene monto 225.00
- WHEN se genera el reporte
- THEN la fila de `comisiones` sigue en 225.00 y no se escribe ningún registro nuevo

## ADDED Requirements

### Requirement: Fila TOTAL, orden y leyenda del reporte neto

La fila TOTAL SHALL imprimir la suma de los "Monto vendido" netos y la suma de los "Total comisionado" netos de todas las filas (la celda de monto, hoy vacía, SHALL mostrar el neto). Las filas SHALL ordenarse por comisión neta descendente, con desempate por `vendedorId` ascendente. Bajo la tabla, el reporte SHALL imprimir una leyenda que aclare que el reporte es neto de los reembolsos aplicados y que "Con reembolso" incluye pendientes que aún no restan. Cuando el periodo no tiene comisiones, el reporte SHALL seguir imprimiendo únicamente "sin comisiones en el periodo", sin tabla ni leyenda.

#### Scenario: TOTAL y orden con datos reales
- GIVEN Hito36 15000.00 / 1500.00, V39 5000.00 / 500.00, Rick 4000.00 / 400.00, Beto 3000.00 / 300.00 (`beto`), Tom 3000.00 / 300.00 (`tom`) y Ana 1200.00 / 120.00
- WHEN se imprime el reporte
- THEN el orden es Hito36, V39, Rick, Beto, Tom, Ana (Beto antes que Tom por `vendedorId`)
- AND la fila TOTAL imprime 31200.00 / 3120.00

#### Scenario: Venta reembolsada baja al final con 0.00
- GIVEN Juan Perez con una venta `confirmada` de 1000.00 (comisión 100.00) y Ana Gomez con una venta `reembolsada` de 1500.00 (comisión 225.00), periodo 2024-02
- WHEN se imprime el reporte
- THEN Juan Perez va primero con 1000.00 / 100.00 y Ana Gomez después con 0.00 / 0.00 ("Ventas" 1, "Con reembolso" 1)
- AND la fila TOTAL imprime 1000.00 / 100.00
- AND aparece la leyenda de neto bajo la tabla

#### Scenario: Sólo pendientes o sólo rechazado no cambian los totales
- GIVEN un periodo cuyas únicas ventas están en `reembolso_pendiente` (o solo en `reembolso_rechazado`)
- WHEN se imprime el reporte
- THEN la fila TOTAL coincide con la suma bruta de esas ventas y su comisión

#### Scenario: Periodo vacío
- GIVEN un periodo sin ventas ni comisiones
- WHEN se imprime el reporte
- THEN el texto contiene "sin comisiones en el periodo"
- AND no hay fila TOTAL ni leyenda

### Requirement: Todos los consumidores heredan el cálculo neto sin recalcularlo

La TUI (`/reporte-comisiones`), la operación conversacional `consultar_reporte_comisiones`, el CLI `npm run reporte:mensual` y la consulta A2A `reporte_comisiones` SHALL obtener "Monto vendido" y "Total comisionado" exclusivamente de `agruparReporteMensual`. Ningún consumidor SHALL recalcular ni reinterpretar esos importes por su cuenta.

#### Scenario: Mismo texto por TUI y por CLI
- GIVEN una base con una venta `reembolsada` en el periodo
- WHEN se ejecuta `/reporte-comisiones periodo` y `npm run reporte:mensual -- --periodo periodo`
- THEN ambos `responseText` son idénticos y muestran los importes netos

#### Scenario: El reporte compatible con el rechazo
- GIVEN una venta pasó de `reembolso_pendiente` a `reembolso_rechazado`
- WHEN se genera el reporte mensual
- THEN no cuenta en "Con reembolso" (requirement vigente de `tui-canal-empleado`) y tampoco resta monto ni comisión
