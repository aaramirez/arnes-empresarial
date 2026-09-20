> Nota de proceso: este ejecutor no tiene shell, así que no se pudo correr `graphify query` pese al hook del repo (misma nota que `proposal.md`). Todo lo afirmado abajo se reverificó con `Read`/`Grep` (archivo:línea). Spec nueva, molde literal `devolucion-sin-token-dos-personas/specs/consulta-venta-empleado/spec.md`; ADR 237-239 de `proposal.md`. Los nombres de tipo/campo que aparecen son los de `proposal.md`; la forma exacta de puertos y textos es de `design.md`.

# Consulta Solicitud Empleado Specification

## Purpose

Capability nueva (ADR 237, 238, 239). Operación conversacional `consultar_solicitud { solicitudId? }` de SOLO LECTURA, escopada al solicitante propio: el estado de UNA solicitud interna suya por id —en cualquiera de sus cuatro estados (`pendiente_aprobacion_humana`, `aprobada`, `rechazada`, `cancelada`, `solicitudes-contract.ts:42-46`)— o, sin id, el listado de las suyas. Cierra el hallazgo H2: hoy la única lectura del solicitante (`cancelar_solicitud_interna` sin id) lee únicamente pendientes (`repository.ts:2288`), así que una solicitud resuelta desaparece de su vista junto con el dictamen.

`dictamen` es el del subagente VALIDADOR (adjuntado sin transicionar estado, ADR 49); el sistema NO guarda un motivo textual de quien resuelve. "Qué dijeron" = dictamen del validador + `resueltaPor` (id).

Esta operación NO amplía lo que un empleado puede ver de OTROS: expone estrictamente menos que `resolver_solicitud` sin id, que ya devuelve a cualquier empleado el listado global de pendientes con `detalle` completo (`design.md` §0.2). Lo único que agrega es el desenlace de solicitudes del propio actor.

**Decisiones asumidas — pendientes de checkpoint** (`proposal.md`, "Qué necesita el checkpoint" pto 3; `design.md` §5.2; se toma la RECOMENDACIÓN de la propuesta). El resto de la lista blanca (once campos, sólo `updated_at` excluido) es decisión firme del diseño (ADR 239), no pendiente. Cambiar cualquiera de estas dos es editar los requirements indicados:

| Decisión asumida | Requirement a editar |
|---|---|
| El solicitante ve el `dictamen` completo (y con él `dictaminadaAt`) | "El detalle expone el dictamen y `resueltaPor` (como id)" y "La proyección es una lista blanca" |
| El solicitante ve `resueltaPor`, siempre como id, nunca como nombre | los mismos dos |

Si el checkpoint elige "estado + fecha y nada más", caen juntos `dictamen`, `dictaminadaAt` y `resueltaPor` (`design.md` §5.2): la lista blanca pasa de once a ocho campos.

**Fuera de alcance**: ver solicitudes AJENAS (aun siendo administrador), cambiar `cancelar_solicitud_interna` o `SolicitudStorePort`, auditar la lectura, migraciones (próxima libre `0015`, sin usar).

## Requirements

### Requirement: `consultar_solicitud` es de sólo lectura, sin confirmación ni auditoría

La operación SHALL NOT escribir en ninguna tabla, SHALL NOT marcar, consultar ni consumir ninguna ranura de confirmación, y SHALL NOT escribir fila en `registro_acciones_empleado`, en ninguna rama (detalle, listado, `no_encontrada`, `no_autorizada`). Su schema SHALL NOT tener campo `accion` ni `confirmado`.

#### Scenario: Cero escrituras verificado con un doble de store
- GIVEN un doble del puerto de consulta y un doble del store de solicitudes que lanzan si reciben cualquier método de escritura
- WHEN se invoca `consultar_solicitud` con id propio, con id ajeno, con id inexistente y sin id
- THEN ningún método de escritura de ningún doble se invoca

#### Scenario: No toca ranuras de confirmación ni deja fila de auditoría
- GIVEN un espía de `ConfirmacionOperacionPort` y un espía de `RegistroAccionesEmpleadoPort`
- WHEN se invoca `consultar_solicitud` en sus cuatro ramas
- THEN ni `marcarPendiente`, `estaConfirmada`, `consumir` ni `registrarAccion` se invocaron

### Requirement: La identidad del solicitante sale de la sesión, nunca de la entrada del modelo

El empleado cuyas solicitudes se consultan SHALL ser el de la sesión autenticada del turno, inyectada por el composition root (closure). Ningún campo de la entrada (`solicitanteId`, `empleadoId` ni equivalente) SHALL poder cambiarlo: la validación SHALL rechazarlos como clave extra. El dispatcher SHALL NOT comparar `solicitanteId` de ninguna solicitud contra el empleado; esa decisión SHALL tomarla únicamente el núcleo.

#### Scenario: Una clave de identidad en la entrada se rechaza antes de ejecutar
- GIVEN una invocación `consultar_solicitud` con `solicitanteId` o `empleadoId` de otro empleado
- WHEN se valida la entrada
- THEN la validación la rechaza y el puerto de consulta no se invoca

#### Scenario: El listado se filtra por el empleado de la sesión
- GIVEN solicitudes de dos empleados y una sesión del empleado E
- WHEN E invoca `consultar_solicitud` sin id
- THEN el puerto de consulta recibe `solicitanteId` igual al `empleadoId` de la sesión de E

#### Scenario: El dispatcher no lee `solicitanteId` (test mecánico)
- GIVEN el módulo del dispatcher
- WHEN se inspecciona su código fuente
- THEN el manejo de `consultar_solicitud` no contiene una comparación contra `solicitanteId`

### Requirement: La consulta por id devuelve el estado en cualquiera de los cuatro estados

Con `solicitudId` de una solicitud propia, SHALL devolver `solicitudId`, `tipo`, `estado`, `createdAt`, `casoId` y `detalle`, sea cual sea el estado, incluidos los resueltos que hoy ningún camino del solicitante lista.

#### Scenario: Solicitud pendiente
- GIVEN una solicitud propia en `pendiente_aprobacion_humana`
- WHEN E invoca `consultar_solicitud { solicitudId }`
- THEN recibe `pendiente_aprobacion_humana`, `solicitudId`, `tipo`, `casoId`, `detalle` y `createdAt`, sin `resueltaPor` ni `resueltaAt`

#### Scenario: Solicitud resuelta, para cada uno de los tres estados
- GIVEN una solicitud propia en `aprobada`, otra en `rechazada` y otra en `cancelada`
- WHEN E consulta cada una por id
- THEN cada respuesta contiene su `estado` literal y `resueltaAt`

### Requirement: El detalle expone el dictamen y `resueltaPor` (como id) — asumido, pendiente de checkpoint

El detalle SHALL incluir el `dictamen` completo cuando existe, y `resueltaPor` (junto con `resueltaAt`) como el identificador del empleado que resolvió, sin resolverlo nunca a un nombre ni email. Si no hay `dictamen`, el detalle SHALL OMITIR la línea de dictamen, sin escribir "sin dictamen" ni inventar uno (RD-115): a diferencia del texto de creación, donde la ausencia es accionable en el momento, días después es ruido; la ausencia sigue siendo observable porque el campo no aparece. Si no hay resolución, SHALL omitir también la línea de quién/cuándo resolvió. Para `cancelada`, `resueltaPor` es el propio solicitante (ADR 131).

#### Scenario: Dictamen completo y `resueltaPor` como id
- GIVEN una solicitud `aprobada` con `dictamen` conocido y `resueltaPor` igual a un id de empleado
- WHEN E la consulta por id
- THEN el texto contiene el `dictamen` íntegro y el id, y ninguna consulta de nombres de empleado ocurre

#### Scenario: Sin dictamen la línea se omite, sin leyenda de sustitución
- GIVEN una solicitud sin `dictamen` (el validador no corrió)
- WHEN E la consulta por id
- THEN el texto no contiene la línea `Dictamen:` ni la frase "sin dictamen", y conserva `estado` y `detalle`

#### Scenario: Cancelada por el propio autor
- GIVEN una solicitud `cancelada` por E
- WHEN E la consulta por id
- THEN `resueltaPor` es el id de E

### Requirement: Una solicitud AJENA se rechaza, distinguible de una inexistente y sin filtrar sus datos

Con `solicitudId` de una solicitud cuyo `solicitanteId` no es el del empleado, SHALL responder `no_autorizada`; con un id que no existe, `no_encontrada`. Ambas respuestas SHALL ser distinguibles entre sí y SHALL NOT incluir ningún dato de la solicitud ajena (`tipo`, `detalle`, `estado`, `dictamen`, `solicitanteId`, `resueltaPor`). El gate SHALL vivir en el núcleo, no en el store ni en el dispatcher (el store no filtra por dueño en la búsqueda por id). El alcance es propio también para un administrador: la operación SHALL NOT consultar el puerto de rol. Tradeoff aceptado (ADR 238): distinguir revela la existencia de un id ajeno; los ids son `randomUUID`, no enumerables (mismo argumento de ADR 126).

#### Scenario: Ajena no revela nada
- GIVEN una solicitud de otro empleado con `detalle` y `dictamen` conocidos
- WHEN E invoca `consultar_solicitud { solicitudId }` con ese id
- THEN la respuesta es `no_autorizada` y su texto no contiene ninguno de esos valores

#### Scenario: Inexistente se distingue de ajena
- GIVEN un id que no existe en el store
- WHEN E lo consulta
- THEN la respuesta es `no_encontrada`, con texto distinto al de `no_autorizada`

#### Scenario: El administrador tampoco ve solicitudes ajenas
- GIVEN una sesión con rol administrador y una solicitud de otro empleado
- WHEN invoca `consultar_solicitud { solicitudId }`
- THEN la respuesta es `no_autorizada` y el puerto de rol no fue consultado

### Requirement: La proyección es una lista blanca de columnas y de campos

La lectura SHALL usar una lista blanca explícita de columnas (nunca `SELECT *`) y una interfaz explícita `SolicitudPropia` de ONCE campos, las doce columnas de `solicitudes_internas` menos `updated_at`: `solicitudId`, `solicitanteId` (sólo para el gate del núcleo), `casoId`, `tipo`, `detalle`, `estado`, `dictamen?`, `dictaminadaAt?`, `resueltaPor?`, `resueltaAt?`, `createdAt`. `updated_at` (metadato de fila, no hecho de negocio) SHALL NOT entrar, ni ninguna columna agregada en el futuro por defecto (ADR 239). Asumido, pendiente de checkpoint: `dictamen?`, `dictaminadaAt?` y `resueltaPor?` (ver tabla del Purpose).

#### Scenario: La lista blanca de columnas tiene exactamente once y no incluye `updated_at` ni `*` (test mecánico)
- GIVEN la constante de columnas de la lectura propia y las dos sentencias que la usan
- WHEN se inspeccionan
- THEN la constante contiene exactamente las once columnas esperadas, no contiene `updated_at` ni `*`, y ninguna sentencia usa `SELECT *`

#### Scenario: El tipo no declara campos fuera de la lista
- GIVEN el tipo `SolicitudPropia`
- WHEN se inspeccionan sus campos
- THEN son exactamente los once de la lista; ninguno es `updatedAt`

### Requirement: El listado sin `solicitudId` muestra únicamente solicitudes propias, de todos los estados, las más recientes primero

Sin `solicitudId`, SHALL devolver únicamente solicitudes con `solicitanteId` igual al del empleado, en todos los estados, ordenadas por `createdAt` descendente, con un tope de 20 (`LIMITE_LISTADO_SOLICITUDES_PROPIAS`). El filtro por dueño SHALL aplicarse en el store, ANTES del límite: solicitudes ajenas nunca consumen el cupo. Cada entrada del listado SHALL mostrar `solicitudId`, `tipo`, `estado`, `createdAt` y `casoId`, y SHALL NOT incluir `detalle` ni `dictamen` (texto libre sin tope: 20 dictámenes inundarían el turno, RD-115); esos dos sólo aparecen en el detalle.

#### Scenario: Sólo propias, mezcla de estados, orden descendente
- GIVEN E con solicitudes en los cuatro estados y solicitudes de otros empleados intercaladas
- WHEN E invoca `consultar_solicitud` sin id
- THEN el listado contiene sólo las de E, incluidas las resueltas, con la más reciente primero

#### Scenario: El límite se aplica después del filtro
- GIVEN E con 25 solicitudes propias y otro empleado con 30 más recientes
- WHEN E invoca `consultar_solicitud` sin id
- THEN el listado tiene exactamente 20 entradas, todas de E

#### Scenario: El listado no contiene `detalle` ni `dictamen`; el detalle sí
- GIVEN una solicitud propia con `detalle` y `dictamen` largos y reconocibles
- WHEN E la ve en el listado (sin id) y luego por id
- THEN el texto del listado no contiene ninguno de los dos valores y el texto del detalle contiene ambos íntegros

### Requirement: El listado vacío responde con un mensaje propio, no con un error

Si el empleado no tiene ninguna solicitud, SHALL responder que no tiene solicitudes internas registradas, sin lanzar y sin listar las de otros. El mensaje SHALL ser distinto del de `cancelar_solicitud_interna` ("No tenés solicitudes pendientes para cancelar."): no tener pendientes no es no tener historial (RD-115).

#### Scenario: Empleado sin solicitudes
- GIVEN un empleado sin solicitudes, con solicitudes de otros en el store
- WHEN invoca `consultar_solicitud` sin id
- THEN el texto es `No tenés solicitudes internas registradas.`, distinto del de cancelación, y no contiene ningún dato ajeno

### Requirement: La cancelación y el puerto de escritura de solicitudes no cambian (ADR 237)

Esta capability SHALL NOT modificar `SolicitudStorePort` ni `listarSolicitudesPendientes`, ni el modo listado ni la confirmación en dos pasos de `cancelar_solicitud_interna`. El listado de cancelación SHALL seguir mostrando únicamente pendientes propias, aunque `consultar_solicitud` liste también las resueltas.

#### Scenario: Las dos vistas coexisten sin contaminarse
- GIVEN E con una solicitud `pendiente_aprobacion_humana` y otra `aprobada`
- WHEN E invoca `cancelar_solicitud_interna` sin id y luego `consultar_solicitud` sin id
- THEN el primer listado contiene sólo la pendiente y el segundo contiene ambas
