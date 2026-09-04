> Nota de proceso: el hook de este repo exige `graphify query`/`explain` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob); no se pudo invocar el binario. Este spec se apoya íntegramente en `proposal.md` (ya aprobada por el checkpoint humano) y en `openspec/changes/hito-1.1-consulta-conocimiento/specs/knowledge/spec.md` como plantilla de formato. Se recomienda que `sdd-design` corra `graphify explain` sobre `ActivityBoardPort` y la cola por `proyecto_id` antes de diseñar.

# Activity Webhook Turn Specification

## Purpose

Capability nueva. Un evento externo de GitHub (`pull_request`, `issue_comment`), verificado por firma HMAC, se traduce en un turno del mismo Selector de Turno de Hito 1: crea `proyecto`/`caso`/`actividad`, invoca `handleTurn` sin modificarlo, parsea el veredicto del agente y persiste el estado resultante en SQLite como fuente canónica.

**Fuera de alcance de este spec** (diferido en la propuesta): revisión del diff completo del PR, segunda fuente de webhooks (incidentes de IT), `'solicitud_interna'` end-to-end, modo headless, `TurnStage` nueva en `turn-error.ts`, rate-limiting/reintentos contra GitHub.

## Requirements

### Requirement: Verificación de firma sobre el body crudo

El listener SHALL calcular la firma `X-Hub-Signature-256` (HMAC-SHA256) sobre los bytes exactos del body recibido (`Buffer`), antes de cualquier `JSON.parse`, comparando con `timingSafeEqual` tras verificar longitudes iguales. Un body que exceda el tope de tamaño configurado SHALL rechazarse sin verificar firma.

#### Scenario: Firma inválida no crea filas
- GIVEN un POST a `/webhooks/github` con firma que no coincide con el secreto configurado
- WHEN el listener verifica `X-Hub-Signature-256`
- THEN responde `401`
- AND no se crea ninguna fila en `proyectos`, `casos` ni `actividades`
- AND se registra un evento de log de firma inválida

#### Scenario: Body excede el tope de tamaño
- GIVEN un POST cuyo body supera el límite configurado
- WHEN el listener lo recibe
- THEN se rechaza sin calcular la firma ni crear filas

### Requirement: Listener opt-in por configuración

El adaptador SHALL NOT abrir ningún puerto HTTP si `GITHUB_WEBHOOK_SECRET` no está configurado.

#### Scenario: Sin secreto configurado
- GIVEN el proceso arranca sin `GITHUB_WEBHOOK_SECRET`
- WHEN se ejecuta `npm run dev`
- THEN la TUI arranca normalmente
- AND no se abre ningún puerto HTTP
- AND se loguea una línea de "adaptador de webhooks deshabilitado"

### Requirement: Traducción de evento a turno normalizado

El adaptador SHALL traducir únicamente los eventos `pull_request` (`opened`, `synchronize`, `reopened`) e `issue_comment` (`created`, solo si el issue referenciado es un PR) a un `IncomingActivityEvent`. Eventos fuera de este conjunto SHALL ignorarse sin crear actividad ni error.

#### Scenario: PR abierto dispara turno
- GIVEN un payload válido `pull_request` con acción `opened` y firma correcta
- WHEN el listener lo procesa
- THEN se invoca el callback inyectado con un `IncomingActivityEvent` normalizado

#### Scenario: Comentario en un issue que no es PR se ignora
- GIVEN un payload `issue_comment.created` donde el issue no es un PR
- WHEN el listener lo procesa
- THEN no se crea actividad ni se invoca `handleTurn`

### Requirement: Creación transaccional de caso y actividad

`runActivityTurn` SHALL crear `proyecto` (si no existe), `caso` y `actividad` en una única transacción antes de invocar `handleTurn`. El `ActivityStorePort` SHALL propagar cualquier fallo de persistencia como error de turno (no lo traga).

#### Scenario: Fallo de persistencia propaga
- GIVEN el `ActivityStorePort` lanza un error al crear la actividad
- WHEN `runActivityTurn` lo invoca
- THEN el error propaga como fallo del turno
- AND no se invoca `handleTurn`

### Requirement: Serialización por `proyecto_id`

El sistema SHALL serializar el ciclo leer-actividad → turno → escribir-actividad para eventos del mismo `proyecto_id`, usando una cola en memoria. Eventos de `proyecto_id` distintos SHALL poder procesarse concurrentemente.

#### Scenario: Dos eventos casi simultáneos del mismo proyecto
- GIVEN dos eventos válidos del mismo `proyecto_id` llegan casi al mismo tiempo
- WHEN ambos se encolan
- THEN se procesan en orden, sin que el segundo lea el estado de `actividades` antes de que el primero termine de escribir
- AND ninguna fila de `actividades` queda pisada o inconsistente

#### Scenario: La cola no filtra memoria
- GIVEN una promesa encolada para un `proyecto_id` se resuelve
- WHEN termina de procesarse
- THEN la entrada correspondiente se borra del mapa de la cola

### Requirement: Parseo de veredicto y transición de estado

Una función pura del núcleo SHALL parsear la línea `VEREDICTO: <valor>` de la respuesta del agente y traducirla a uno de los cuatro estados canónicos (`pendiente_revision`, `observado`, `resuelto`, `aprobado`) vía `transicionarEstado`. Si el veredicto no puede parsearse, el estado resultante SHALL ser `observado`, nunca `aprobado`.

#### Scenario: Veredicto válido transiciona estado
- GIVEN el agente responde con `VEREDICTO: aprobado`
- WHEN se parsea la respuesta
- THEN el estado de la actividad transiciona a `aprobado`

#### Scenario: Veredicto no parseable cae a estado seguro
- GIVEN la respuesta del agente no contiene una línea `VEREDICTO:` reconocible
- WHEN se parsea la respuesta
- THEN el estado resultante es `observado`
- AND nunca es `aprobado`

### Requirement: Logging correlacionado por `casoId`

Todo evento del ciclo (webhook recibido, firma inválida, actividad creada, turno resuelto) SHALL loguearse vía `logTurnEvent` correlacionado por `casoId`, sin cambiar el contrato del logger.

#### Scenario: Traza completa de un turno de webhook
- GIVEN un `pull_request.opened` válido dispara un turno
- WHEN el ciclo completa
- THEN el log contiene los eventos del ciclo bajo el mismo `casoId`
