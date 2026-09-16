> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/autorizacion-empleado/spec.md` — versión vigente para estos dos requirements específicos: la delta posterior de `comandos-administracion-empleados` sólo modificó "Provisioning del rol..." e "Invariantes negativos de superficie", sin tocar los dos de abajo (verificado leyendo ambos archivos). Dos causas de delta, ninguna toca el modelo de rol en sí: (a) los dos requirements referencian los comandos `/aprobar-reembolso`/`/aprobar-solicitud`, retirados por este change; (b) el requirement de autoaprobación afirma explícitamente que NO aplica a la escalación de reembolso, y eso deja de ser cierto — R7 se cierra en este change con un requirement hermano en `reembolso-resolucion-escalacion`. La prohibición de solicitudes NO se mueve de lugar ni se fusiona con la de reembolso: se verifican sobre funciones y campos distintos (`solicitante_id` vs. `vendedorId`).

# Delta for Autorización Empleado

## MODIFIED Requirements

### Requirement: Gate de autorización sobre "resolver lo ajeno" en el núcleo determinista

El sistema SHALL exigir rol `"administrador"` para `aprobar`, `rechazar` y `reabrir` una escalación de reembolso, y para `aprobar`/`rechazar` una solicitud interna ajena, evaluado dentro de `resolverEscalacionReembolso` y `resolverSolicitudInterna` (no en el handler ni en la guarda del dispatcher), sea cual sea el canal que invoque esas funciones. Un empleado con rol base que intente cualquiera de esas cinco acciones SHALL recibir una variante de rechazo tipada, sin escritura en `ventas`, `casos`, `solicitudes_internas` ni `registro_acciones_empleado` salvo la fila de auditoría del intento. El rechazo SHALL NOT filtrar datos del ítem ajeno.

(Previously: los escenarios invocaban literalmente `/aprobar-reembolso`/`/aprobar-solicitud` como comandos de la TUI. Este change retira esos comandos (ADR 210) y expone el mismo gate vía `resolver_reembolso`/`resolver_solicitud` del canal conversacional; el gate en sí, evaluado dentro de las funciones deterministas, no cambia.)

#### Scenario: Rol base no puede aprobar una escalación de reembolso ajena
- GIVEN un empleado con rol base y una venta en `reembolso_pendiente`
- WHEN confirma aprobar esa escalación (`resolver_reembolso { accion: "aprobar", ventaId }` en el canal conversacional)
- THEN la acción se rechaza con la variante tipada de "no autorizado", sin cambiar `ventas.estado` ni `casos.estado`

#### Scenario: Rol elevado sí puede resolver lo ajeno
- GIVEN un empleado con rol `"administrador"` y una solicitud interna ajena pendiente
- WHEN confirma aprobar esa solicitud (`resolver_solicitud { accion: "aprobar", solicitudId }`)
- THEN la solicitud transiciona con normalidad, igual que antes de este change

#### Scenario: El rechazo por autorización no expone el detalle del ítem ajeno
- GIVEN un empleado con rol base intentando resolver una solicitud ajena
- WHEN recibe el rechazo
- THEN la respuesta no contiene el `detalle` ni datos internos de la solicitud

### Requirement: Prohibición de autoaprobación de solicitud interna, independiente del rol

`aprobar`/`rechazar` una solicitud interna con `solicitante_id === sesion.empleadoId` SHALL rechazarse **incluso si el empleado tiene rol elevado**. Esta prohibición SHALL evaluarse con independencia del resultado del gate de rol. Es un requirement hermano, no genérico, del que este change agrega para la escalación de reembolso (capability `reembolso-resolucion-escalacion`): se verifican sobre funciones distintas (`resolverSolicitudInterna` vs. `resolverEscalacionReembolso`), con predicados sobre campos distintos (`solicitante_id` vs. `vendedorId`).

(Previously: cerraba con "SHALL NOT aplicarse a la escalación de reembolso, donde sesion.empleadoId se usa sólo para atribución" — cierto mientras R7 estuvo declarada como deuda. Este change cierra R7 con un requirement hermano y explícito en `reembolso-resolucion-escalacion`, así que esa frase deja de ser precisa; se reemplaza por la nota de correlación de arriba, sin fusionar los dos requirements.)

#### Scenario: Rol elevado no habilita la autoaprobación
- GIVEN un empleado con rol `"administrador"` que es el `solicitante_id` de una solicitud propia pendiente
- WHEN intenta confirmar aprobar esa misma solicitud (`resolver_solicitud { accion: "aprobar", solicitudId }`)
- THEN la acción se rechaza, con rol o sin rol

#### Scenario: Un administrador sí puede aprobar la solicitud de otro
- GIVEN un empleado con rol `"administrador"` y una solicitud ajena pendiente
- WHEN confirma aprobar esa solicitud
- THEN la solicitud transiciona con normalidad
