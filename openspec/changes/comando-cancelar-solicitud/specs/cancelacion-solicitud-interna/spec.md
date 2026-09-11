> Nota de proceso: mismo criterio sin herramienta de shell documentado en `proposal.md` de este change. No hay spec previa de esta capability — es un spec completo, no una delta. Cubre ADR 125 (alcance sólo `PENDIENTE`, garantizado por las dos cerraduras estructurales del ADR 38 y el CAS), ADR 126 (chequeo de dueño, modelado fuera de `MotivoNoAplicableHitl`), ADR 127 (`privilegiado: true`, sin categoría nueva) y ADR 128 (confirmación en dos pasos reusando `manejarResolucionSolicitud`, sin ampliar `confirmacionPendiente`) de `proposal.md`. Molde de formato: `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md`.
>
> **★ Segunda ronda (ADR 144, `design.md` §2-bis/§10).** Corrió sin herramienta de shell disponible (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), mismo criterio documentado en `design.md` de esta misma ronda. Fuente única: `design.md` §2-bis (ADR 144) y §10 punto 1 y 2, que enumeran textualmente los escenarios exigidos. Cubre el hueco que el Reviewer encontró: `/cancelar-solicitud` **sin id** reusaba el listado sin filtrar por dueño (bug funcional — el `LIMIT 20` se comía las ajenas antes de cualquier filtro — más fuga de `detalle`/`solicitanteId`). El requirement nuevo de abajo y el escenario agregado a "Sólo el propio solicitante puede cancelar…" son los dos puntos que `design.md` §10 dejó pendientes para esta fase.

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

#### Scenario: La búsqueda por id de una solicitud ajena sigue encontrándola — no se filtra por dueño (ADR 144 pto 3)
- GIVEN una solicitud pendiente de otro empleado, con id conocido
- WHEN un tercero ejecuta `/cancelar-solicitud` con ese id explícito
- THEN el sistema SHALL NOT excluirla de la búsqueda por dueño — la encuentra igual que al día de hoy
- AND la respuesta SHALL seguir siendo `no_es_dueno` ("no es tuya…"), no la misma respuesta que un id inexistente

### Requirement: El listado sin id (`/cancelar-solicitud` sin argumento) muestra únicamente las solicitudes pendientes del propio solicitante

El sistema SHALL filtrar `listarSolicitudesPendientes` por `solicitanteId` **en el store** (parámetro SQL, no un recorte en memoria posterior) cuando la acción es `cancelar`. El límite del listado SHALL aplicarse **después** de ese filtro, de modo que solicitudes ajenas pendientes NUNCA consuman el cupo del listado propio. Cuando el filtro por dueño no deja resultados, el sistema SHALL mostrar un mensaje propio de la acción `cancelar`, distinto del mensaje genérico de listado vacío que usan `/aprobar-solicitud`/`/rechazar-solicitud`.

#### Scenario: El listado sin id devuelve sólo las solicitudes propias
- GIVEN el solicitante E tiene solicitudes propias pendientes y existen también solicitudes pendientes de otros empleados
- WHEN E ejecuta `/cancelar-solicitud` sin id
- THEN el listado devuelto contiene únicamente solicitudes con `solicitanteId === E`

#### Scenario: Una solicitud ajena pendiente no aparece ni expone su detalle
- GIVEN existen solicitudes pendientes de otros empleados junto con las propias de E
- WHEN E ejecuta `/cancelar-solicitud` sin id
- THEN ninguna solicitud ajena aparece en el listado
- AND el `detalle` y el `solicitanteId` de las solicitudes ajenas no están presentes en la respuesta

#### Scenario: Solicitudes ajenas no consumen el tope del listado (el bug del `LIMIT`)
- GIVEN hay 25 solicitudes pendientes de otros empleados creadas antes que la única solicitud pendiente de E
- WHEN E ejecuta `/cancelar-solicitud` sin id
- THEN el listado devuelto incluye la solicitud propia de E, sin importar cuántas solicitudes ajenas la preceden en orden de creación

#### Scenario: Sin solicitudes propias pendientes, mensaje propio de la acción cancelar
- GIVEN E no tiene ninguna solicitud pendiente, aunque existan solicitudes pendientes de otros empleados
- WHEN E ejecuta `/cancelar-solicitud` sin id
- THEN el sistema responde con un mensaje que indica que E no tiene solicitudes pendientes propias, distinto del mensaje genérico "No hay solicitudes para listar." que usan `/aprobar-solicitud`/`/rechazar-solicitud`

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
