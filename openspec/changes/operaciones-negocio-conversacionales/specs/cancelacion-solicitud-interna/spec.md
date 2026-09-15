> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin shell disponible). Delta escrito contra `openspec/changes/comando-cancelar-solicitud/specs/cancelacion-solicitud-interna/spec.md` — versión vigente, no modificada por `autorizacion-empleado`. **Verificación explícita del criterio "exhaustivo sobre canal"**: dos de los cinco requirements de esa spec son exhaustivos sobre el canal `/cancelar-solicitud` (el descriptor mismo, y la confirmación en dos pasos vía `manejarResolucionSolicitud`/dispatcher de comandos) — ambos quedan REMOVED porque ese comando se quita (ADR 148 pto 2). Los otros tres requirements (estado `pendiente_aprobacion_humana`, chequeo de dueño, listado filtrado) son sobre el EFECTO de `resolverSolicitudInterna`/`esAccionAutoservicio`, sin modificar — no llevan delta, salvo el de chequeo de dueño, actualizado para no asumir un único invocador. Ninguna de las tres funciones deterministas cambia.

# Delta for Cancelación de Solicitud Interna

## REMOVED Requirements

### Requirement: Descriptor `/cancelar-solicitud [solicitudId]`, forma `id_opcional_solicitud` existente, privilegiado

(Reason: ADR 148 pto 2 quita `/cancelar-solicitud` de `DESCRIPTORES` — capability `comando-empleado-tui`. La operación de autoservicio `cancelar` pasa a exponerse como `cancelar_solicitud_interna` en la herramienta `operaciones`, capability `herramienta-operaciones-negocio`, que reusa `resolverSolicitudInterna` sin modificarla.)

### Requirement: Confirmación en dos pasos reusando `manejarResolucionSolicitud`, sin ampliar `confirmacionPendiente`

(Reason: ese camino de confirmación era específico del dispatcher de comandos de la TUI y deja de ser alcanzable para `cancelar` al quitarse `/cancelar-solicitud`. Cómo se materializa la confirmación en dos pasos para esta operación en conversación es RD-71, capability `herramienta-operaciones-negocio`. `manejarResolucionSolicitud` y su `confirmacionPendiente` para `aprobar`/`rechazar` HITL no se tocan — ADR 151 sigue BLOQUEADO y esos comandos se conservan.)

## MODIFIED Requirements

### Requirement: Sólo el propio solicitante puede cancelar, único invocador tras este change es la herramienta

El sistema SHALL verificar `solicitud.solicitanteId === sesion.empleadoId` antes de ejecutar cualquier cancelación. Tras este change, el único invocador de esta verificación es la operación `cancelar_solicitud_interna` de la herramienta `operaciones` (capability `herramienta-operaciones-negocio`) — no un comando de la TUI. Un empleado distinto del solicitante SHALL recibir un rechazo sin que el `detalle` de la solicitud ajena aparezca en la respuesta.

(Previously: "chequeado antes de armar la confirmación" — redactado en términos del eco de confirmación del dispatcher de comandos, que deja de existir para esta operación. El chequeo de dueño en sí — `esAccionAutoservicio`, sin modificar — es el mismo.)

#### Scenario: El dueño cancela vía la herramienta
- GIVEN una solicitud pendiente del propio solicitante
- WHEN el empleado invoca `cancelar_solicitud_interna` con ese id, confirmado
- THEN el chequeo de dueño pasa y la solicitud transiciona a `cancelada`

#### Scenario: Un tercero es rechazado sin exponer el detalle
- GIVEN una solicitud pendiente de otro empleado
- WHEN un tercero invoca `cancelar_solicitud_interna` con ese id
- THEN recibe un rechazo, sin que el `detalle` de la solicitud aparezca en la respuesta
