> Nota de proceso: delta escrito contra `openspec/changes/operaciones-negocio-conversacionales/specs/turno-empleado-autenticado/spec.md` — versión vigente, sin modificación posterior. Los cuatro requirements existentes de esa spec (sesión por closure, prompt distinto, sin herramienta sin sesión, `SesionEmpleado` sin campos nuevos) se verificaron uno por uno contra `design.md` de este change y **ninguno cambia de texto** — el diseño elegido (ADR 196, decorador del `MemoryContextPort`) no toca `sesion.ts` ni agrega campos a `SesionEmpleado`; la conversación viaja como argumento aparte, no como parte de la sesión. Por eso este delta es puramente ADDED: cierra el `RD-69` que la spec vigente dejaba abierto en su "Fuera de alcance" (*"qué transporte expone el turno — TUI, HTTP nuevo autenticado, o ambos"*) declarando que la interfaz visual de chat es ese transporte HTTP, y extiende el mismo criterio de closure de la Requirement de sesión al nuevo estado de conversación.

# Delta for Turno Empleado Autenticado

## ADDED Requirements

### Requirement: La conversación (estado de memoria) viaja por closure, escopeada por sesión — mismo criterio que la sesión

El turno de empleado SHALL recibir el puerto de conversación (memoria multi-turno, capability `memoria-conversacional-empleado`) inyectado por closure desde el composition root, resuelto a partir de la sesión HTTP ya autenticada. Ningún schema de tool, parámetro del turno ni campo del body de `POST /operaciones` SHALL aceptar un identificador de conversación o de "caso anterior" como dato provisto por el modelo o por el cliente.

#### Scenario: La conversación no puede falsificarse desde la conversación ni desde el request

- GIVEN un empleado con sesión vigente y una conversación en curso
- WHEN el turno se construye
- THEN el estado de conversación usado es el resuelto por closure a partir del token de sesión, y ni un mensaje del usuario ni un campo del body pueden apuntarlo a otra conversación

#### Scenario: La interfaz visual de chat es el transporte HTTP que cierra RD-69

- GIVEN el turno de empleado autenticado, transporte-agnóstico por diseño
- WHEN se sirve a través de la interfaz visual de chat (capability `chat-web-empleado`) en vez de `curl` directo
- THEN el comportamiento del turno —sesión por closure, prompt de empleado, herramienta `operaciones` condicionada a sesión vigente— es idéntico al de cualquier otro consumidor autenticado de `POST /operaciones`
