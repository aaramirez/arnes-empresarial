> Nota de proceso: mismo hook de graphify sin herramienta de shell disponible en este ejecutor (sólo Read/Edit/Write/Grep/Glob). Delta verificado leyendo `openspec/changes/chat-web-empleado/specs/chat-web-empleado/spec.md` (versión vigente única, v3.9): la capability ya tiene el requirement de seguridad "El texto del modelo y del empleado se inserta siempre como texto, nunca como HTML" — **ese requirement NO se toca ni se relaja**. Este delta es **ADDED**: agrega un requirement de presentación (autor + hora), no modifica ninguno existente.

# Delta for Chat Web Empleado

## ADDED Requirements

### Requirement: Cada turno del chat distingue autor por clase CSS y muestra la hora en que se pintó, sin ganar ninguna vía de inserción HTML

El cliente SHALL renderizar cada turno con una estructura que incluya al menos una clase por autor (empleado, arnés, sistema) y un nodo de texto con la hora en que el cliente pintó el turno. El color por autor SHALL asignarse exclusivamente vía `classList`/hoja de estilos — nunca por atributo `style` inline ni por reglas nuevas con `unsafe-inline` en la CSP. El autor SHALL permanecer legible como texto, sin depender únicamente del color para distinguirlo. Esta estructura SHALL construirse por `textContent`/`createTextNode`, respetando íntegro el requirement vigente "El texto del modelo y del empleado se inserta siempre como texto, nunca como HTML" (ADR 200 pto 5, ADR 222 pto 1).

#### Scenario: Dos turnos de autores distintos son distinguibles por clase y llevan hora

- GIVEN una conversación con al menos un turno del empleado y uno de respuesta del arnés
- WHEN se inspecciona el DOM de ambos turnos
- THEN cada uno tiene una clase de autor distinta y un nodo de texto con la hora en que se pintó

#### Scenario: El color nunca se asigna por atributo `style` inline

- GIVEN el DOM de un turno recién pintado con su clase de autor
- WHEN se inspecciona el elemento y todos sus hijos
- THEN ninguno tiene un atributo `style`

#### Scenario: El autor sigue siendo texto, no sólo color

- GIVEN un turno pintado con su clase de autor
- WHEN se lee el `textContent` del turno
- THEN el nombre del autor está presente como texto, independientemente del color aplicado por CSS

#### Scenario: `chat-client.ts` no incorpora ninguna vía de HTML dinámico al agregar la estructura de autor y hora

- GIVEN el código fuente de `chat-client.ts` tras agregar la estructura por autor y hora
- WHEN se inspecciona mecánicamente el archivo
- THEN no contiene `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ni asignación de `style` inline

### Requirement: La hora del turno es una ayuda de lectura del cliente, no un dato de auditoría

La hora que el cliente estampa en cada turno SHALL originarse en el reloj del navegador al momento de pintar el turno, no en el servidor. Esta hora SHALL NOT presentarse como equivalente a la hora auditable de `registro_acciones_empleado`, que no cambia con este requirement.

#### Scenario: La hora del chat no reemplaza la auditoría

- GIVEN una operación registrada con su fila en `registro_acciones_empleado`
- WHEN se compara la hora mostrada en el chat con la hora de esa fila de auditoría
- THEN ambas pueden diferir, porque la del chat es del navegador y la de auditoría es la fuente de verdad
