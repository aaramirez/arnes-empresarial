# Memoria Conversacional Empleado Specification

## Purpose

Capability nueva. Requisito conductual de memoria multi-turno para el turno de empleado autenticado: una referencia deíctica en el mensaje N+1 (*"esa venta"*, *"confirmá eso"*) resuelve contra lo dicho en el mensaje N de la misma conversación, sin que el empleado repita el identificador. Redactado sobre el **efecto observable**, no sobre el mecanismo (ADR 189 pto 1) — sobrevive sin cambios si `sdd-design` hubiera elegido un mecanismo distinto del decorador de `MemoryContextPort` (ADR 196).

El requisito de mayor severidad de esta capability es de no-regresión: la memoria multi-turno **no** puede relajar el invariante de seguridad que exige un turno conversacional posterior y distinto para confirmar `cancelar_solicitud_interna` (arc42 `:566`).

**Fuera de alcance de este spec**: el mecanismo concreto que resuelve la memoria (decorador del `MemoryContextPort`, `ConversacionEmpleadoPort` — capability `chat-web-empleado`/diseño interno); el contrato de la herramienta `operaciones` (capability `herramienta-operaciones-negocio`, sin delta); la interfaz visual en sí (capability `chat-web-empleado`).

## Requirements

### Requirement: Una referencia deíctica en el mensaje N+1 resuelve contra el mensaje N

Dentro de una misma conversación, el sistema SHALL resolver una referencia deíctica hecha en un mensaje sin que el empleado repita el identificador completo mencionado en un mensaje anterior de esa misma conversación.

#### Scenario: El segundo mensaje referencia al primero sin repetir el identificador

- GIVEN un empleado menciona una venta específica en el mensaje N
- WHEN en el mensaje N+1 dice "confirmá eso" sin repetir el identificador de la venta
- THEN el arnés resuelve la referencia contra lo dicho en el mensaje N y actúa sobre la venta correcta

### Requirement: La memoria está escopeada por sesión de empleado, nunca compartida entre sesiones

El sistema SHALL escopar la memoria conversacional por la sesión HTTP del empleado. Dos sesiones distintas — de dos empleados distintos, o dos sesiones concurrentes del mismo empleado — SHALL NOT compartir memoria en ningún grado, ni siquiera parcialmente.

#### Scenario: Dos sesiones distintas no comparten contexto (negativo)

- GIVEN dos empleados con sesiones distintas y activas, cada uno con su propia conversación en curso
- WHEN el empleado A envía un mensaje que hace referencia deíctica a algo dicho en SU conversación
- THEN el arnés nunca resuelve esa referencia contra nada dicho en la conversación del empleado B, y viceversa

#### Scenario: El origen del "caso anterior" nunca viene del cliente

- GIVEN una solicitud a `POST /operaciones` con un token de sesión válido
- WHEN el servidor resuelve la conversación a retomar
- THEN el turno o caso anterior se determina exclusivamente por el token de sesión resuelto en el servidor, y ningún campo del body de la solicitud puede alterar qué conversación se retoma

### Requirement: Una conversación tiene principio y fin explícitos

El sistema SHALL dar a cada conversación un principio explícito (inicio de sesión) y al menos un fin explícito entre logout, inactividad prolongada o un tope de turnos. Una sesión nueva SHALL NOT heredar la conversación de una sesión anterior, aunque sea del mismo empleado.

#### Scenario: Un logout seguido de un nuevo login no hereda la conversación previa

- GIVEN un empleado con una conversación en curso que referencia contenido de mensajes previos
- WHEN cierra sesión y vuelve a loguearse
- THEN la nueva conversación no resuelve ninguna referencia deíctica contra lo dicho antes del logout

### Requirement: Un turno fallido no hace avanzar la memoria

Si un turno no resuelve con éxito, el sistema SHALL dejar la memoria de la conversación exactamente donde estaba antes de ese turno — apuntando al último turno cerrado con éxito, no al turno fallido.

#### Scenario: Tras un turno fallido, el siguiente mensaje sigue recordando el último éxito

- GIVEN una conversación cuyo último turno exitoso fue el mensaje N
- WHEN el mensaje N+1 falla al resolverse
- THEN el mensaje N+2 sigue pudiendo referenciar deícticamente lo dicho en el mensaje N, como si N+1 no hubiera ocurrido

### Requirement: La confirmación de `cancelar_solicitud_interna` sigue exigiendo un turno posterior y distinto, sin relajarse

Con la memoria conversacional activa, la confirmación de `cancelar_solicitud_interna` SHALL seguir exigiendo que la propuesta y la confirmación ocurran en mensajes distintos del empleado. El sistema SHALL NOT permitir que dos invocaciones de esa herramienta dentro del mismo mensaje del empleado se autoconfirmen, sin importar que la memoria esté activa o no.

#### Scenario: La confirmación en un mensaje posterior sigue funcionando (positivo)

- GIVEN un empleado propone cancelar una solicitud interna en el mensaje N
- WHEN confirma explícitamente en el mensaje N+1
- THEN la cancelación se ejecuta — igual comportamiento que antes de este change

#### Scenario: Dos invocaciones en el mismo mensaje no se autoconfirman, con memoria activa (negativo, crítico)

- GIVEN un empleado con memoria conversacional activa
- WHEN dentro de un ÚNICO mensaje el modelo invoca `cancelar_solicitud_interna` dos veces, la segunda intentando confirmar lo que la primera propuso
- THEN la cancelación NO se confirma — la autoconfirmación dentro del mismo mensaje sigue siendo estructuralmente imposible, exactamente igual que antes de que existiera memoria multi-turno
