> **DELTA — modifica un requirement existente de `hito-1.3-ventas-comisiones`, no es aditivo.** Mismo patrón que `openspec/changes/hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md` usó sobre `hito-2.0-delegacion-subagentes`: se copió el bloque COMPLETO del requirement afectado (`### Requirement:` + su único escenario) desde `openspec/changes/hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual/spec.md:13-21`, y se editó — el escenario previo no se recortó, se conservó y se agregó uno nuevo. Los otros tres requirements de esa spec base (agregación pura por vendedor y periodo, listado de reembolsos pendientes, "ejecutar o no ejecutar no afecta el resto del sistema") **no cambian** y no se repiten acá.
>
> **Qué neutraliza esta delta, explícitamente confirmado por ADR 116**: el requirement vigente dice textual *"`npm run reporte:mensual` SHALL ser el único disparador del reporte. El sistema SHALL NOT incluir ningún temporizador, cron **ni Registro de Comandos** que lo dispare automáticamente."* Eso dejó de ser cierto: `/reporte-comisiones [periodo]` (capability nueva `comando-reporte-comisiones`) es un segundo disparador explícito, vía el Registro de Comandos de la TUI. **Lo que NO cambia**: la prohibición de temporizador/cron/disparo automático sigue absoluta — el Registro de Comandos deja de estar prohibido como *canal*, pero seguir prohibido como *disparador automático* no se toca en ninguna palabra.
>
> **Nota para el archive**: el `## Purpose` de la spec base (línea 9) también enumera *"un Registro de Comandos que resuelva comandos por nombre"* dentro de su "Fuera de alcance". Esa frase queda desactualizada por la misma razón que el requirement de abajo — el archive step debe corregirla junto con el reemplazo del requirement (no es una `### Requirement`, así que no lleva bloque propio en este delta, pero se deja escrito para que no se pierda).

# Delta for Reporte Comisiones Mensual

## MODIFIED Requirements

### Requirement: Disparo bajo demanda, por una acción explícita — sin scheduler ni cron

El reporte SHALL dispararse únicamente por una acción explícita de un operador humano: `npm run reporte:mensual` desde una terminal, o `/reporte-comisiones [periodo]` del Registro de Comandos de la TUI (capability `comando-reporte-comisiones`) con sesión vigente. El sistema SHALL NOT incluir ningún temporizador, cron, `setInterval`/`node-cron` ni ningún otro mecanismo que genere el reporte sin esa acción explícita.

(Previously: "`npm run reporte:mensual` SHALL ser el único disparador del reporte. El sistema SHALL NOT incluir ningún temporizador, cron ni Registro de Comandos que lo dispare automáticamente." — el Registro de Comandos pasa de estar prohibido como canal a ser la segunda vía explícita permitida; la prohibición de temporizador/cron/disparo automático no cambia en ninguna palabra.)

#### Scenario: El reporte no se dispara solo
- GIVEN el proceso de la TUI está corriendo con normalidad
- WHEN pasa un mes calendario sin que nadie ejecute `npm run reporte:mensual` ni el comando `/reporte-comisiones`
- THEN no se genera ni imprime ningún reporte
- AND no existe ningún proceso en background, temporizador o cron que lo intente

#### Scenario: El comando de la TUI es la segunda vía explícita, no un scheduler
- GIVEN un empleado con sesión vigente en la TUI
- WHEN ejecuta `/reporte-comisiones [periodo]`
- THEN el reporte se genera en respuesta directa a esa acción del empleado, en el mismo turno
- AND ningún proceso, temporizador ni disparo automático generó el reporte antes de esa acción
