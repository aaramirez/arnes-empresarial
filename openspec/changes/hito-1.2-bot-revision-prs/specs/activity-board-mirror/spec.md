> Nota de proceso: mismo hook de graphify aplica; sin herramienta de shell disponible en este ejecutor, no se pudo correr `graphify query`/`explain`. Spec basado en `proposal.md` (ADR 6) y en la plantilla de `hito-1.1-consulta-conocimiento/specs/knowledge/spec.md`.

# Activity Board Mirror Specification

## Purpose

Capability nueva. Espejo unidireccional del estado canónico de `actividades` (SQLite) sobre el tablero externo de GitHub (labels, assignee, comentario de revisión), a través del puerto de núcleo `ActivityBoardPort` (ADR 6). El espejo es best-effort: nunca bloquea ni revierte el turno, porque el estado canónico ya se persistió y el turno ya terminó.

**Fuera de alcance de este spec**: revisión del diff completo del PR, rate-limiting/reintentos/backoff, paginación de la API de GitHub, segunda fuente de tablero (Jira/Linear).

## Requirements

### Requirement: `ActivityBoardPort` nunca rechaza

`mirrorEstado` y `publicarRevision` SHALL capturar internamente cualquier falla (red, HTTP ≠ 2xx, timeout) y loguearla, sin lanzar excepción ni rechazar la promesa. El turno SHALL considerarse exitoso independientemente del resultado del espejo.

#### Scenario: Falla de red al espejar estado
- GIVEN `mirrorEstado` se invoca tras un turno resuelto
- WHEN la llamada a la API de GitHub falla por red
- THEN la falla se loguea
- AND el turno permanece exitoso
- AND no se propaga ninguna excepción al llamador

#### Scenario: Falla al publicar comentario de revisión
- GIVEN `publicarRevision` se invoca con el texto de la revisión del agente
- WHEN la API de GitHub responde con un código de error
- THEN la falla se loguea
- AND el turno permanece exitoso

### Requirement: Mapeo estado → label

El adaptador de tablero SHALL mapear cada uno de los cuatro estados canónicos a un label fijo: `pendiente_revision` → `necesita-revision`, `observado` → `observaciones-pendientes`, `resuelto` → `resuelto`, `aprobado` → `aprobado`. Este mapeo SHALL vivir en el adaptador, no en el núcleo.

#### Scenario: Estado aprobado refleja label correspondiente
- GIVEN una actividad transiciona a `aprobado`
- WHEN se invoca `mirrorEstado`
- THEN el Issue de GitHub queda con el label `aprobado` (y sin los otros tres labels de estado)

### Requirement: Actualización automática de label y assignee al resolverse observaciones

Cuando un turno subsiguiente transiciona el estado de `observado` a `resuelto` (o a `aprobado`), el sistema SHALL invocar `mirrorEstado` con el nuevo estado y el `responsableId` correspondiente, sin intervención manual.

#### Scenario: Resolución de observaciones actualiza el tablero solo
- GIVEN una actividad en estado `observado` recibe un `issue_comment` que la resuelve
- WHEN el turno subsiguiente transiciona el estado a `resuelto`
- THEN el label del Issue cambia a `resuelto`
- AND el `assignee` del Issue se actualiza al `responsableId` resuelto

### Requirement: Degradación sin `GITHUB_TOKEN`

Sin `GITHUB_TOKEN` configurado, el sistema SHALL instanciar `ActivityBoardPort` como una implementación no-op que loguea, sin afectar la persistencia del estado canónico.

#### Scenario: Turno completa sin token de GitHub
- GIVEN el proceso arranca sin `GITHUB_TOKEN`
- WHEN un webhook válido dispara un turno de actividad
- THEN el turno completa
- AND el estado se persiste en `actividades`
- AND se omite el espejo al tablero sin excepción no capturada

### Requirement: Lectura de metadatos del PR antes del turno

El adaptador de tablero SHALL exponer una operación para leer título, cuerpo, autor y lista de archivos cambiados del PR, usada para construir el prompt sintético antes de invocar `handleTurn`. Esta operación SHALL NOT leer el diff completo del PR.

#### Scenario: Metadatos disponibles para el prompt
- GIVEN un `pull_request.opened` válido
- WHEN el composition root arma el turno
- THEN dispone de título, cuerpo, autor y archivos cambiados del PR antes de invocar `handleTurn`
- AND ningún campo del diff completo forma parte de esos datos
