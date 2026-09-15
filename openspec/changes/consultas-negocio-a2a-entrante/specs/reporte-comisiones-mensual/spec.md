> Nota de proceso: overlap detectado y verificado con `operaciones-negocio-conversacionales` — ese change (`specs/herramienta-operaciones-negocio/spec.md`) expone cinco operaciones de ESCRITURA sobre `ventas`/`solicitudes`, ninguna de reporte; no toca esta capability. El overlap real es con el requirement vigente de ESTA capability (`comando-reporte-comisiones/specs/reporte-comisiones-mensual/spec.md:11-21`, la versión más reciente): el criterio propio de `proposal.md` — "hay delta sólo si la spec vigente contiene un requisito exhaustivo sobre el CANAL" — se cumple acá: el requirement enumera **taxativamente** los disparadores permitidos de "el reporte" (CLI, comando TUI de un operador humano) y esta propuesta agrega una tercera vía de lectura que reusa las mismas funciones puras (`resolverPeriodoReporte`, `agruparReporteMensual`) desde un llamador sin sesión de empleado. Se copió COMPLETO el requirement afectado y se edita para que la tercera vía quede **explícitamente distinguida** de "el reporte" — produce un agregado recortado (ADR 180), no el artefacto completo — evitando que este delta contradiga el recorte de datos personales que exige `consultas-negocio-a2a`.

# Delta for Reporte Comisiones Mensual

## MODIFIED Requirements

### Requirement: Disparo bajo demanda, por una acción explícita — sin scheduler ni cron

El reporte completo SHALL dispararse únicamente por una acción explícita de un operador humano: `npm run reporte:mensual` desde una terminal, o `/reporte-comisiones [periodo]` del Registro de Comandos de la TUI (capability `comando-reporte-comisiones`) con sesión vigente. El sistema SHALL NOT incluir ningún temporizador, cron, `setInterval`/`node-cron` ni ningún otro mecanismo que genere el reporte completo sin esa acción explícita. La consulta de sólo lectura del turno A2A entrante (`operacion: "reporte_comisiones"` de `consultar_negocio`, capability `consultas-negocio-a2a`) SHALL reusar `resolverPeriodoReporte`/`agruparReporteMensual` como funciones puras, pero SHALL NOT producir el reporte completo — devuelve un agregado recortado (total y conteo del período, sin fila por vendedor, ADR 180) a un llamador sin sesión de empleado, y no cuenta como el disparador humano que este requirement gobierna.

(Previously: "El reporte SHALL dispararse únicamente por una acción explícita de un operador humano: `npm run reporte:mensual`... o `/reporte-comisiones [periodo]`... con sesión vigente. El sistema SHALL NOT incluir ningún temporizador, cron, `setInterval`/`node-cron` ni ningún otro mecanismo que genere el reporte sin esa acción explícita." — no distinguía "el reporte" [artefacto completo, con fila por vendedor] de una consulta agregada y recortada sobre las mismas funciones puras. Esta versión traza esa línea: la vía A2A no es un tercer disparador del artefacto completo, es un consumidor distinto de las mismas funciones, con salida distinta.)

#### Scenario: El reporte no se dispara solo
- GIVEN el proceso de la TUI está corriendo con normalidad
- WHEN pasa un mes calendario sin que nadie ejecute `npm run reporte:mensual` ni el comando `/reporte-comisiones`
- THEN no se genera ni imprime ningún reporte completo
- AND no existe ningún proceso en background, temporizador o cron que lo intente

#### Scenario: El comando de la TUI es la segunda vía explícita, no un scheduler
- GIVEN un empleado con sesión vigente en la TUI
- WHEN ejecuta `/reporte-comisiones [periodo]`
- THEN el reporte completo se genera en respuesta directa a esa acción del empleado, en el mismo turno
- AND ningún proceso, temporizador ni disparo automático lo generó antes de esa acción

#### Scenario: La consulta A2A reusa las funciones puras sin producir el reporte completo
- GIVEN una solicitud A2A entrante con `operacion: "reporte_comisiones"` para un período con ventas y comisiones
- WHEN `consultar_negocio` invoca `resolverPeriodoReporte`/`agruparReporteMensual`
- THEN el texto devuelto al llamador A2A es un total y un conteo agregado del período, no el reporte completo con fila por vendedor, y no queda registrado como una ejecución de `npm run reporte:mensual` ni de `/reporte-comisiones`
