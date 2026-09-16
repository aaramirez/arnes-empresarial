> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/solicitud-interna-hitl/spec.md` — versión vigente confirmada por `proposal.md` (no la de `comando-cancelar-solicitud`, que ese requirement hereda sin tocar). Ambos requirements MODIFIED están redactados sobre el comando `/aprobar-solicitud`/`/rechazar-solicitud`, retirado por este change (ADR 210); se re-redactan sobre el efecto —resolver una solicitud vía la operación `resolver_solicitud` del canal conversacional (capability `resolucion-hitl-conversacional`)— sin tocar la lógica de autorización, que no cambia una letra. Las referencias a `/cancelar-solicitud` no se tocan: esa migración de canal ya ocurrió en `operaciones-negocio-conversacionales` y es ajena al alcance de este change.

# Delta for Solicitud Interna con HITL

## MODIFIED Requirements

### Requirement: Cualquier empleado autenticado puede resolver (sin jerarquía de aprobación) — excepto retirar la propia solicitud, ni ver el listado ajeno al retirarla, y excepto resolver la ajena sin rol elevado

El sistema SHALL permitir que cualquier empleado con sesión vigente **y rol elevado** (capability `autorizacion-empleado`) resuelva, vía la operación `resolver_solicitud` del canal conversacional, cualquier solicitud pendiente, sin verificar jerarquía ni relación con el solicitante más allá de esa pertenencia de rol. Un empleado con rol base que intente resolver una solicitud SHALL recibir un rechazo por autorización, sin exponer el `detalle` de la solicitud ajena. El listado sigue igual: invocar `resolver_solicitud` sin `solicitudId` SHALL seguir devolviendo el listado global de solicitudes pendientes de toda la organización, con `solicitante`/`detalle` completos, sin filtro de dueño ni de rol — ver la solicitud no requiere rol elevado, sólo resolverla. Como excepción de autoservicio, el sistema SHALL exigir que `cancelar_solicitud_interna` sólo lo ejecute el propio solicitante (`solicitud.solicitanteId === sesion.empleadoId`), con rol base o elevado indistintamente (capability `cancelacion-solicitud-interna`, no modificada por este change — el gate de rol no aplica a acciones de autoservicio). El sistema SHALL NOT expresar el rechazo por rol insuficiente como un miembro nuevo de `MotivoNoAplicableHitl` — se modela localmente en el resultado de este dominio.

(Previously: redactado sobre `/aprobar-solicitud`/`/rechazar-solicitud` y `/cancelar-solicitud` como comandos de la TUI. Este change retira los dos primeros de la TUI (ADR 210) y expone el mismo efecto vía `resolver_solicitud`; la lógica de autorización no cambia.)

#### Scenario: Un empleado con rol elevado, distinto del solicitante, puede aprobar
- GIVEN una solicitud creada por el empleado A
- WHEN el empleado B, con sesión vigente propia y rol elevado, confirma `resolver_solicitud { accion: "aprobar", solicitudId }`
- THEN la solicitud transiciona a `resuelto`

#### Scenario: Un empleado con rol base no puede aprobar ni rechazar, aunque no sea el solicitante
- GIVEN una solicitud creada por el empleado A, y un empleado B con rol base y sesión vigente
- WHEN B confirma `resolver_solicitud { accion: "aprobar", solicitudId }`
- THEN la acción se rechaza por autorización, sin exponer el `detalle` de la solicitud, y sin transicionar su estado

#### Scenario: Un empleado distinto del solicitante NO puede cancelar
- GIVEN una solicitud `pendiente_aprobacion_humana` creada por el empleado A
- WHEN el empleado B, con sesión vigente propia, invoca `cancelar_solicitud_interna` sobre ella
- THEN se rechaza sin transicionar la solicitud, sin marcar pendiente ninguna confirmación, y sin exponer el `detalle` de la solicitud ajena en la respuesta

#### Scenario: El rol base sí puede cancelar su propia solicitud — el gate de rol no aplica a autoservicio
- GIVEN una solicitud propia `pendiente_aprobacion_humana` de un empleado con rol base
- WHEN ese mismo empleado invoca `cancelar_solicitud_interna` con confirmación
- THEN la solicitud transiciona a `cancelada` con normalidad, sin que el gate de rol la bloquee

#### Scenario: `hitl-contract.ts` no gana un motivo nuevo por el rechazo de rol
- GIVEN el rechazo de `resolver_solicitud { accion: "aprobar" }` a un empleado con rol base
- WHEN se inspecciona `MotivoNoAplicableHitl` en `hitl-contract.ts`
- THEN conserva exactamente los mismos miembros que antes de este change

#### Scenario: `resolver_solicitud` sin id sigue listando toda la organización, sin filtro de dueño ni de rol
- GIVEN hay solicitudes pendientes de varios empleados distintos
- WHEN un empleado con sesión vigente, con cualquier rol, invoca `resolver_solicitud` sin `solicitudId`
- THEN el listado devuelto incluye solicitudes de cualquier solicitante, con `solicitante` y `detalle` completos, igual que antes de este change

### Requirement: Prohibición de autoaprobación, independiente del rol

`aprobar`/`rechazar` una solicitud interna con `solicitud.solicitanteId === sesion.empleadoId` SHALL rechazarse **incluso si el empleado tiene rol elevado**, sea cual sea el canal (TUI históricamente, canal conversacional vía `resolver_solicitud` tras este change). Esta prohibición SHALL evaluarse con independencia del resultado del gate de rol descrito arriba, y SHALL NOT aplicarse a `cancelar_solicitud_interna` (que ya exige exactamente esa igualdad para ejecutarse).

(Previously: redactado sobre el comando `/aprobar-solicitud`. Este change no cambia la prohibición ni su independencia del rol — sólo el canal por el que se alcanza.)

#### Scenario: Rol elevado no habilita aprobar la propia solicitud
- GIVEN un empleado con rol elevado que es el `solicitante_id` de una solicitud propia pendiente
- WHEN intenta confirmar `resolver_solicitud { accion: "aprobar", solicitudId }` sobre esa misma solicitud
- THEN la acción se rechaza, pese a tener rol elevado

#### Scenario: Un administrador aprueba la de otro sin problema
- GIVEN un empleado con rol elevado y una solicitud ajena pendiente
- WHEN confirma `resolver_solicitud { accion: "aprobar", solicitudId }`
- THEN la solicitud transiciona a `resuelto` con normalidad
