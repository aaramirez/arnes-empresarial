> Nota de proceso: mismo criterio sin herramienta de shell documentado en `proposal.md` de este change. No hay spec previa de esta capability — es un spec completo, no una delta. Cubre ADR 125 (alcance sólo `PENDIENTE`, garantizado por las dos cerraduras estructurales del ADR 38 y el CAS), ADR 126 (chequeo de dueño, modelado fuera de `MotivoNoAplicableHitl`), ADR 127 (`privilegiado: true`, sin categoría nueva) y ADR 128 (confirmación en dos pasos reusando `manejarResolucionSolicitud`, sin ampliar `confirmacionPendiente`) de `proposal.md`. Molde de formato: `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md`.

# Cancelación de Solicitud Interna Specification

## Purpose

Capability nueva. Expone `/cancelar-solicitud [solicitudId]`: el propio solicitante retira su solicitud interna mientras está `pendiente_aprobacion_humana`, cerrando la asimetría de que el autor de una solicitud era el único actor del flujo sin ninguna acción sobre ella (Intent de `proposal.md`).

Fuera de alcance de este spec: cancelar una solicitud `aprobada` o `rechazada` (ADR 125); reabrir una solicitud cancelada; extender el chequeo de dueño a `/aprobar-solicitud`/`/rechazar-solicitud`; cualquier cambio a `MotivoNoAplicableHitl` o a `hitl-contract.ts` (frontera documentada en el delta de `solicitud-interna-hitl`).

## Requirements

### Requirement: Descriptor `/cancelar-solicitud [solicitudId]`, forma `id_opcional_solicitud` existente, privilegiado

El sistema SHALL declarar en `DESCRIPTORES` un descriptor `/cancelar-solicitud [solicitudId]` con `forma: "id_opcional_solicitud"` (reusada, sin agregar un miembro nuevo al tipo `Forma`) y `privilegiado: true`. `parsearComando` SHALL reconocerlo sin ningún import nuevo.

#### Scenario: `/cancelar-solicitud S-7` se reconoce con el id explícito
- GIVEN el texto `/cancelar-solicitud S-7`
- WHEN `parsearComando` lo procesa
- THEN devuelve un resultado tipado con `solicitudId: "S-7"`, con la misma forma que usa `/aprobar-solicitud`

#### Scenario: Sin sesión, el comando se rechaza antes de leer nada
- GIVEN no hay sesión vigente
- WHEN se ejecuta `/cancelar-solicitud S-7`
- THEN el comando se rechaza sin leer la solicitud ni escribir ningún cambio

### Requirement: Sólo se cancela una solicitud `pendiente_aprobacion_humana`; una ya decidida es inalcanzable, no un error explícito

El sistema SHALL cancelar únicamente solicitudes en estado `pendiente_aprobacion_humana`. El sistema SHALL NOT introducir un lector sin filtro de estado para distinguir "no existe" de "ya fue decidida" — una solicitud `aprobada` o `rechazada` SHALL quedar fuera del alcance de lectura de este comando, sin que eso exija una rama de error dedicada.

#### Scenario: Cancelar una solicitud ya aprobada no escribe nada
- GIVEN una solicitud en estado `aprobada`
- WHEN su propio solicitante ejecuta `/cancelar-solicitud` con ese id, con confirmación
- THEN `solicitudes_internas`, `casos` y `registro_acciones_empleado` quedan idénticas a antes del intento

#### Scenario: Una solicitud ya decidida responde igual que un id inexistente
- GIVEN una solicitud ya `aprobada` o `rechazada`
- WHEN se ejecuta `/cancelar-solicitud` con su id
- THEN la respuesta es la misma que para un id que no existe — ninguna solicitud pendiente con ese id

### Requirement: Sólo el propio solicitante puede cancelar, chequeado antes de armar la confirmación

El sistema SHALL verificar `solicitud.solicitanteId === sesion.empleadoId` después de encontrar la solicitud pendiente y antes de armar el eco de confirmación. Un empleado distinto del solicitante SHALL recibir un rechazo sin que se arme `confirmacionPendiente` y sin que el `detalle` de la solicitud aparezca en la respuesta.

#### Scenario: El dueño pasa el chequeo y ve el eco
- GIVEN una solicitud pendiente del propio solicitante
- WHEN ejecuta `/cancelar-solicitud` con ese id
- THEN el chequeo de dueño pasa y se muestra el eco de confirmación con el `detalle`

#### Scenario: Un tercero es rechazado antes del eco
- GIVEN una solicitud pendiente de otro empleado
- WHEN un tercero ejecuta `/cancelar-solicitud` con ese id
- THEN recibe un rechazo explicativo, sin `confirmacionPendiente` armada y sin el `detalle` en la respuesta

### Requirement: Confirmación en dos pasos reusando `manejarResolucionSolicitud`, sin ampliar `confirmacionPendiente`

El sistema SHALL reusar la rama `dominio: "solicitud"` de `confirmacionPendiente`, genérica sobre `accion: AccionSolicitud`, para `/cancelar-solicitud`. El sistema SHALL NOT agregar una rama nueva al tipo de la ranura de confirmación del dispatcher.

#### Scenario: Confirmación aplica el CAS y deja registro en la misma transacción
- GIVEN el eco de `/cancelar-solicitud S-7` ya se mostró al dueño
- WHEN el dueño confirma
- THEN la solicitud transiciona a `cancelada`, el caso a `resuelto`, y se crea una fila en `registro_acciones_empleado` con `comando = "/cancelar-solicitud"` y `resultado = "cancelada"`, todo en una única transacción

#### Scenario: Un eco pendiente de aprobar no interfiere con cancelar la misma solicitud
- GIVEN un eco pendiente de `/aprobar-solicitud S-7` sin confirmar
- WHEN se ejecuta `/cancelar-solicitud S-7`
- THEN no matchea el eco pendiente de aprobar — la clave de confirmación incluye la acción
