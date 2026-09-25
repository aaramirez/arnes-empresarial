> Supuesto explícito (R2c del proposal). La prohibición de `operaciones-negocio-conversacionales/specs/herramienta-operaciones-negocio/spec.md:79-86` está redactada como *"Este change SHALL NOT..."* y su scenario mide el `git diff` de ese change: es una restricción de ese change, no de la capability. Ningún delta posterior la modifica. Si se archivara tal cual, quedaría como prohibición permanente en la spec principal y contradiría este change; por eso se acota con un MODIFIED (bloque copiado completo y editado). Requiere confirmación en el checkpoint.

# Delta for Herramienta Operaciones Negocio

## MODIFIED Requirements

### Requirement: Las seis funciones deterministas del núcleo no se modifican

El change `operaciones-negocio-conversacionales` SHALL NOT modificar la firma ni el cuerpo de `registrarVenta`, `resolverDecisionVenta`, `procesarDevolucion`, `resolverEscalacionReembolso`, `resolverSolicitudInterna` ni `crearSolicitudInterna`. Tampoco SHALL modificar `resolverPeriodoReporte`, `agruparReporteMensual` ni `formatearReporteMensual` (`core/ventas/reporte.ts`) — las tres funciones puras que reusa `consultar_reporte_comisiones` (ADR 174 consecuencias). La herramienta las consume tal cual existen. Esta restricción SHALL limitarse al diff de ese change y SHALL NOT ser una prohibición permanente: un change posterior puede modificar esas funciones con su propio delta de spec, y `consultar_reporte_comisiones` seguirá delegando en ellas sin recalcular.
(Previously: "Este change SHALL NOT modificar ... La herramienta las consume tal cual existen hoy." — sin dejar explícito que el alcance era sólo el de ese change.)

#### Scenario: `git diff` no toca ninguna de las seis funciones ni las tres funciones puras de reporte
- GIVEN el `git diff` completo del change `operaciones-negocio-conversacionales`
- WHEN se inspeccionan los archivos de `src/core/ventas/` y `src/core/solicitudes/` que las contienen
- THEN ninguno tiene una línea modificada dentro del cuerpo de esas seis funciones ni de `resolverPeriodoReporte`, `agruparReporteMensual` o `formatearReporteMensual`

#### Scenario: Un change posterior puede modificar `agruparReporteMensual`
- GIVEN un change posterior con su propio delta de `reporte-comisiones-mensual` que modifica `agruparReporteMensual`
- WHEN se compara contra este requirement
- THEN no lo viola
- AND `consultar_reporte_comisiones` sigue delegando en `agruparReporteMensual` y muestra el resultado sin recalcularlo
