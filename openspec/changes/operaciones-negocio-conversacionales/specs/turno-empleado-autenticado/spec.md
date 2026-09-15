> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin herramienta de shell disponible). Spec nuevo, sin delta previo. Molde de formato: `openspec/changes/hito-1.2-bot-revision-prs/specs/activity-webhook-turn/spec.md`. Cubre Aclaración 2 y ADR 146/147 de `proposal.md`.

# Turno Empleado Autenticado Specification

## Purpose

Capability nueva. Superficie conversacional separada de `POST /soporte` (capability `soporte-web-turno`, rama de cliente sin cambio) para el empleado con `SesionEmpleado` vigente. Es la única superficie que habilita la herramienta `operaciones` (capability `herramienta-operaciones-negocio`) — nunca el turno de cliente anónimo (ADR 146).

**Fuera de alcance de este spec**: el contrato interno de la herramienta (capability `herramienta-operaciones-negocio`), qué transporte expone el turno — TUI, HTTP nuevo autenticado, o ambos (RD-69), contenido de las skills de dominio (ADR 149, RD-73), cualquier modelo de rol/permiso (fuera de alcance de este change entero — ver `autorizacion-empleado`).

## Requirements

### Requirement: La `SesionEmpleado` viaja por closure, nunca la aporta el modelo

El turno de empleado SHALL recibir una `SesionEmpleado` real y vigente inyectada por closure desde el composition root, tomada del canal ya autenticado (`/login` en TUI u otro mecanismo de sesión). Ningún schema de tool ni parámetro del turno SHALL aceptar la sesión o el `empleadoId` como dato provisto por el modelo.

#### Scenario: La sesión no puede falsificarse desde la conversación
- GIVEN un empleado con sesión vigente inicia un turno
- WHEN el turno se construye
- THEN la `SesionEmpleado` usada es la de closure, y ningún mensaje del usuario puede reemplazarla

### Requirement: El prompt del turno de empleado es distinto del prompt de cliente

El turno de empleado SHALL usar un prompt propio, separado de `buildSoportePrompt` de cliente. El prompt de empleado SHALL habilitar explícitamente lo que el prompt de cliente prohíbe, sin reusar las dos líneas de seguridad de `soporte-prompt.ts:65,69`.

#### Scenario: El prompt de empleado no hereda la prohibición de cliente
- GIVEN un turno de empleado autenticado
- WHEN se arma su prompt
- THEN el texto no contiene las líneas que prohíben confirmar, cancelar o reembolsar

### Requirement: Un turno sin sesión vigente no tiene la herramienta de operaciones habilitada

Si no hay `SesionEmpleado` vigente para el canal, el turno SHALL construirse sin la herramienta `operaciones` en su lista de tools — equivalente al turno de cliente. El sistema SHALL NOT conceder la herramienta primero y validar después.

#### Scenario: Sesión expirada no habilita la herramienta
- GIVEN una `SesionEmpleado` con `expiraEn` en el pasado
- WHEN se intenta construir el turno de empleado
- THEN el turno resultante no incluye la herramienta `operaciones`, igual que un turno sin sesión

### Requirement: `CONVERSATIONAL_AGENT.allowedTools` tiene exactamente tres entradas, ninguna de acceso a filesystem/shell

Tras este change, `CONVERSATIONAL_AGENT.allowedTools` SHALL contener exactamente tres entradas: la tool de conocimiento, la tool de `operaciones`, y `"Skill"`. Ninguna entrada SHALL ser `Bash`, `Read`, `Write` ni `Edit`.

#### Scenario: Verificación mecánica del array
- GIVEN `definitions.ts` tras este change
- WHEN se inspecciona `CONVERSATIONAL_AGENT.allowedTools`
- THEN tiene longitud 3 y ningún elemento es `"Bash"`, `"Read"`, `"Write"` ni `"Edit"`

### Requirement: `SesionEmpleado` no gana campos nuevos

Este change SHALL NOT agregar un campo de rol, privilegio o permiso a `SesionEmpleado`. El tipo permanece `{ empleadoId, iniciadaEn, expiraEn? }` (ADR 151 pto 3, invariante compartido con `autorizacion-empleado`).

#### Scenario: `git diff` no toca `sesion.ts`
- GIVEN el `git diff` completo de este change
- WHEN se inspecciona `src/core/auth/sesion.ts`
- THEN no tiene ninguna línea modificada
