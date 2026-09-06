> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md` y por el spec de `venta-confirmacion`. Este spec se apoya íntegramente en `proposal.md` (ADR 21, Approach) y usa `openspec/changes/hito-1.3-ventas-comisiones/specs/venta-confirmacion/spec.md` como plantilla de formato.

# Comando Empleado TUI Specification

## Purpose

Capability nueva. Cubre el reconocimiento de texto con prefijo `/` en la TUI, `parsearComando` puro, el ruteo al manejador correspondiente, la degradación transparente a turno conversacional para cualquier texto sin `/`, y la respuesta de ayuda ante un comando desconocido o con argumentos faltantes.

**Fuera de alcance de este spec**: la lógica de negocio de cada comando (capabilities `autenticacion-empleado-tui`, `reembolso-resolucion-escalacion`, `registro-acciones-empleado`, `soporte-web-turno`, `reembolso-evaluacion`), cambios al contrato `SubmitPromptHandler`/`TuiTurnResult` (`tui-port.ts`), vista navegable dedicada (Approach C, diferido).

## Requirements

### Requirement: Texto sin prefijo `/` se delega intacto al turno conversacional

`parsearComando(texto)` SHALL devolver `undefined` para cualquier texto que no empiece con `/`. En ese caso el dispatcher SHALL delegar el string original, sin modificar, al `SubmitPromptHandler` de `buildOnSubmit`.

#### Scenario: Texto conversacional resuelve idéntico a v1.3.0
- GIVEN un texto sin `/` en la TUI
- WHEN se envía a través del dispatcher de comandos
- THEN el turno se resuelve con el mismo `casoId`, el mismo `handleTurn` y el mismo `agentLabel` que en `v1.3.0`
- AND `parsearComando` no altera el texto antes de delegarlo

### Requirement: Reconocimiento y ruteo de los siete comandos

`parsearComando` SHALL reconocer `/login`, `/logout`, `/soporte`, `/devolucion`, `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` y `/ayuda`, devolviendo una unión discriminada tipada con sus argumentos posicionales. El dispatcher SHALL rutear cada resultado reconocido al manejador correspondiente.

#### Scenario: Cada prefijo reconocido rutea a su manejador
- GIVEN un texto que empieza con uno de los siete prefijos
- WHEN `parsearComando` lo procesa
- THEN devuelve el tipo discriminado correspondiente con sus argumentos
- AND el dispatcher invoca el manejador de ese comando, no el conversacional

### Requirement: Comando desconocido o con argumentos faltantes responde con ayuda, sin efecto

Un texto que empieza con `/` pero no matchea ningún comando conocido, o que matchea un comando sin los argumentos requeridos, SHALL responder con el texto de ayuda/uso y SHALL NOT producir ningún efecto de dominio ni fila de registro.

#### Scenario: Comando desconocido no tiene efecto
- GIVEN el texto `/noexiste algo`
- WHEN se procesa en la TUI
- THEN la respuesta es el texto de ayuda
- AND no se modifica `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: `/ayuda` lista los comandos disponibles

- GIVEN cualquier estado de sesión
- WHEN se ejecuta `/ayuda`
- THEN se listan los siete comandos con su descripción de una línea
- AND no se escribe ninguna fila de registro
