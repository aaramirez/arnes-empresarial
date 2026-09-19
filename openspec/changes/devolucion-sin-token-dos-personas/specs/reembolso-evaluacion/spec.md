> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Delta escrito contra `openspec/changes/operaciones-negocio-conversacionales/specs/reembolso-evaluacion/spec.md` — versión vigente. El requisito de que el token es la ÚNICA credencial de `procesarDevolucion` vivía sólo como comentario de código (ADR 19, `procesar-devolucion.ts:8-13`), nunca como texto de spec — se agrega acá como requirement ADDED, junto con la segunda vía sin token, con los dos escenarios negativos que `proposal.md` exige explícitamente.

# Delta for Reembolso Evaluación

## ADDED Requirements

### Requirement: El token sigue siendo la ÚNICA credencial de `procesarDevolucion`; existe una segunda vía de iniciación sin token que SIEMPRE escala

`procesarDevolucion` SHALL seguir recibiendo únicamente `{ token, motivo? }` y buscando la venta por `store.buscarVentaPorToken(token)`, sin ninguna línea de diff respecto de la versión anterior a este change — el camino del token, incluida su auto-aprobación bajo el umbral, permanece exactamente igual. Existe además una segunda vía de iniciación, `solicitar_devolucion` (capability `devolucion-sin-token-dos-personas`), que NO pasa por `procesarDevolucion`, NO recibe token, y SIEMPRE escala a `reembolso_pendiente` sin importar el monto — nunca auto-aprueba.

#### Scenario: Un monto muy por debajo del umbral, iniciado por la vía sin token, NUNCA queda `reembolsada`
- GIVEN una venta `confirmada` con `monto` muy por debajo de `REEMBOLSO_UMBRAL`
- WHEN se inicia su devolución por `solicitar_devolucion` (sin token) en vez de por `procesar_devolucion` (con token)
- THEN `ventas.estado` queda en `reembolso_pendiente`, nunca en `reembolsada`
- AND el mismo monto, iniciado por `procesar_devolucion` con el token, sí se auto-aprueba — las dos vías tienen precios distintos, a propósito

#### Scenario: El vendedor que inició por la vía sin token no puede aprobar su propia escalación
- GIVEN una escalación creada por `solicitar_devolucion` sobre la venta del vendedor V
- WHEN V invoca `resolver_reembolso { accion: "aprobar", ventaId }`
- THEN se rechaza (`autoaprobacion_prohibida`), igual que cualquier escalación nacida del camino del token sobre el umbral
