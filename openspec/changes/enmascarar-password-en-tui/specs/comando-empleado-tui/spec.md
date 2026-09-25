> Nota de proceso: sin shell ni `graphify query` (este ejecutor sólo tiene Read/Edit/Write/Grep/Glob). `openspec/specs/` sólo tiene `.gitkeep`: no hay spec principal archivada. Delta apoyado en `proposal.md` y en `src/core/commands/comando-empleado.ts:433-442,526-532` (`splitPrimerEspacio`, `parsearComando`). Ningún requirement existente de esta capability afirma "`secreto` SOLO para `/login`": esa frase vive únicamente en el comentario de código `comando-empleado.ts:113` (tarea de documentación, no de spec), por eso este delta es **sólo ADDED**. Decisiones D2/D3 son las **recomendadas** de la propuesta `[SUPUESTO — pendiente de checkpoint]`.

# Delta for Comando Empleado TUI

## ADDED Requirements

### Requirement: El enmascarado de secretos es una función pura derivada del parser y del flag `secreto`

El sistema SHALL exponer en `src/core/commands/` una función pura, sin I/O ni reloj, que dado el texto de un borrador o prompt devuelva su versión enmascarada. SHALL aplicar la misma normalización que `parsearComando`: `trimStart`, match EXACTO y sensible a mayúsculas del primer token contra `DESCRIPTORES`, y espacio U+0020 como único separador. Si el descriptor tiene `secreto: true` (hoy `/login` y `/crear-empleado`), el primer token tras el comando (el id) SHALL quedar visible, el espacio que lo sigue SHALL conservarse, y cada carácter posterior (incluidos espacios internos y finales) SHALL reemplazarse por `*`. El resultado SHALL tener la misma longitud que la entrada. En cualquier otro caso SHALL devolver el texto intacto. Marcar un comando futuro con `secreto: true` SHALL bastar para que quede cubierto (falla cerrado).

#### Scenario: `/login` con clave
- GIVEN el texto `/login ana s3cret`
- WHEN se enmascara
- THEN el resultado es `/login ana ******`

#### Scenario: Clave con espacios internos
- GIVEN el texto `/login ana s3cr et`
- WHEN se enmascara
- THEN el resultado es `/login ana *******` (7 asteriscos: cada carácter cuenta, el espacio interno incluido)

#### Scenario: `/crear-empleado` con clave
- GIVEN el texto `/crear-empleado bob abc`
- WHEN se enmascara
- THEN el resultado es `/crear-empleado bob ***`

#### Scenario: Espacios extra alrededor de los tokens
- GIVEN el texto `  /login  ana  pw` (espacios al inicio, doble espacio entre comando e id, doble espacio tras el id)
- WHEN se enmascara
- THEN el resultado es `  /login  ana ***` (se conserva el prefijo y el espacio previo al id; el separador tras el id se conserva y el resto, ` pw`, se enmascara)

#### Scenario: Todavía no hay clave
- GIVEN los textos `/login`, `/login ana`, `/login ana ` y `/crear-empleado bob`
- WHEN se enmascaran
- THEN cada resultado es idéntico a su entrada

#### Scenario: Comandos no secretos y texto libre
- GIVEN los textos `/estado-bot-prs`, `/soporte ayuda con mi clave`, `hola /login x y` y la cadena vacía
- WHEN se enmascaran
- THEN cada resultado es idéntico a su entrada

#### Scenario: Comando mal tipeado o con mayúsculas no se enmascara (residual aceptado)
- GIVEN los textos `/logni ana secreto` y `/Login ana secreto`
- WHEN se enmascaran
- THEN cada resultado es idéntico a su entrada, porque el primer token no matchea ningún descriptor con `secreto: true`
- AND este comportamiento queda fijado por un test como residual documentado (R2 de la propuesta), no como defecto

#### Scenario: El enmascarado no diverge del parser
- GIVEN cualquier texto para el que `parsearComando` devuelve `login` o `crear_empleado` con un `password`
- WHEN se enmascara
- THEN el resultado tiene la misma longitud que la entrada, coincide con ella hasta el separador posterior al id, y desde ahí sólo contiene `*`
- AND la posición del `password` que extrajo el parser queda íntegramente dentro del tramo enmascarado
