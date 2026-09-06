> Nota de proceso: mismo hook de graphify aplica; sin herramienta de shell disponible en este ejecutor, no se pudo correr `graphify query`/`explain`. Spec basado en `proposal.md` (ADR 7 punto 2, Approach) y en `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-webhook-turn/spec.md` como plantilla de formato.

# Soporte Web Turno Specification

## Purpose

Capability nueva. `POST /soporte` es el único endpoint nuevo de este hito que resuelve un turno conversacional real: crea un `caso` tipo `'soporte'` y llama a `handleTurn` reusando `CONVERSATIONAL_AGENT` con un prompt sintético armado a partir de la consulta del cliente, sin agregar un segundo `AgentDefinition`.

**Fuera de alcance de este spec**: cualquier cambio a `definitions.ts` o al contrato de `handleTurn`, autenticación de sesión del cliente de soporte.

## Requirements

### Requirement: `POST /soporte` es el único camino de este hito que invoca al modelo

De los endpoints nuevos de este hito (`/ventas`, `/confirmar/:token`, `/devolucion`, `/soporte`), únicamente `POST /soporte` SHALL invocar `handleTurn`.

#### Scenario: Soporte invoca al modelo, ventas y confirmación no
- GIVEN se ejercitan los cuatro endpoints nuevos con datos válidos
- WHEN se observan las llamadas al modelo de cada uno
- THEN solo `POST /soporte` produce una invocación de `handleTurn`

### Requirement: Creación de caso tipo `'soporte'` antes del turno

`POST /soporte` SHALL crear un `caso` con `tipo = 'soporte'` antes de invocar `handleTurn`, para que el turno quede correlacionado por `casoId` igual que en Hitos 2 y 3.

#### Scenario: Consulta de soporte crea su caso
- GIVEN llega un `POST /soporte` con una consulta válida
- WHEN se procesa la request
- THEN se crea un `caso` con `tipo = 'soporte'`
- AND el turno subsiguiente queda correlacionado por ese `casoId`

### Requirement: Reuso de `CONVERSATIONAL_AGENT` con prompt sintético

El turno de soporte SHALL reusar `CONVERSATIONAL_AGENT` con un prompt sintético construido a partir de la consulta recibida, sin definir un segundo `AgentDefinition`.

#### Scenario: Respuesta del agente se devuelve al cliente
- GIVEN un `POST /soporte` válido resuelve su turno
- WHEN `handleTurn` completa
- THEN la respuesta del agente se devuelve en la respuesta HTTP de `POST /soporte`
