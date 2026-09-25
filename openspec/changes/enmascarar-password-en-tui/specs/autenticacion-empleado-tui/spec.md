> Nota de proceso: sin shell ni `graphify query`. No hay spec principal archivada; **existen tres copias** de la capability con el párrafo `Fuera de alcance` (`tui-canal-empleado`, `autorizacion-empleado`, `comandos-administracion-empleados`) y un delta previo que lo toca (`sesiones-web-persistentes`). El texto de reemplazo de abajo **compone** el estado final esperado de esos deltas más este change; qué copia prevalece al archivar lo decide `sdd-archive` `[SUPUESTO — pendiente de checkpoint]`. El destino del primer MODIFIED **no es un `### Requirement:`** sino un párrafo del `## Purpose` (mismo molde que `sesiones-web-persistentes`). ADR 300 = número tentativo, a confirmar en `design.md`.

# Delta for Autenticación Empleado TUI

## MODIFIED Requirements

### Requirement: Fuera de alcance de este spec (párrafo del Purpose)

**Fuera de alcance de este spec**: roles y permisos sobre qué puede hacer un empleado logueado (capability `autorizacion-empleado`), desactivación de empleado, límite de intentos de login / rate limiting, recuperación de contraseña, **enmascarado de la entrada en el CLI `empleados:crear` (eco de terminal, R14, ADR 33) y en el adaptador web (`/login` ya usa `type="password"`)**, sesión de la TUI persistente entre reinicios o compartida entre procesos (la sesión del adaptador web sí persiste, `sesiones-web-persistentes`, ADR 290), autenticación del adaptador web, el gate de rol `administrador` sobre `/crear-empleado` y `/asignar-rol` (capability `administracion-empleados-tui`). El enmascarado de la entrada **en la TUI** queda **dentro** del alcance (requirement nuevo de este delta; ADR 300 reemplaza a ADR 21 en ese punto).

(Previously: "… recuperación de contraseña, enmascarado de la entrada en la TUI, sesión persistente entre reinicios o compartida entre procesos, autenticación del adaptador web." — es decir, el enmascarado en la TUI figuraba como fuera de alcance.)

#### Scenario: El enmascarado en la TUI ya no figura como fuera de alcance
- GIVEN el párrafo `Fuera de alcance` tras aplicar el delta
- WHEN se lee
- THEN no lista "enmascarado de la entrada en la TUI" como exclusión
- AND sí lista el CLI y el adaptador web como fuera de alcance de ese enmascarado

### Requirement: Alta de credencial desde la TUI extiende, sin relajar, el invariante de no persistencia en claro

`/crear-empleado`, ejecutado por un `administrador` (capability `administracion-empleados-tui`), SHALL crear la credencial con el mismo `scryptSync` y sal aleatoria por fila que `empleados:crear`. La contraseña tipeada como argumento de este comando SHALL NOT persistirse en claro en ninguna columna, SHALL NOT aparecer en ninguna fila de `registro_acciones_empleado`, y SHALL NOT aparecer en ningún evento de `logTurnEvent` — mismo invariante, molde y test que ya cubre `/login` (`build-on-comando-empleado.test.ts:524`), extendido a este segundo comando.

(Previously: el mismo texto; sólo cambia el tercer scenario, que aceptaba la contraseña visible en el transcripto "ADR 21 sin tocar, R1 aceptado".)

#### Scenario: Ningún rastro de la contraseña tipeada en `/crear-empleado`
- GIVEN un `administrador` ejecuta `/crear-empleado ana <password>`
- WHEN se inspeccionan todas las filas de `registro_acciones_empleado` y todos los eventos emitidos durante el comando
- THEN ninguno contiene la contraseña, un prefijo suyo, ni su longitud
- AND `credenciales_empleado.password_hash` es el único lugar donde queda un derivado de esa contraseña

#### Scenario: El invariante y el enmascarado de la TUI son dos superficies distintas
- GIVEN que la contraseña tipeada se muestra enmascarada en la TUI (ADR 300, reemplaza a ADR 21 en ese punto)
- WHEN se evalúa este requirement
- THEN el invariante de no persistencia, no fila de auditoría y no evento de log se cumple igual, sin depender del enmascarado visual (ADR 174 pto 2)

## ADDED Requirements

### Requirement: La contraseña tipeada no aparece en ningún frame de la TUI

Para todo texto que tenga tramo secreto no vacío (`contieneSecreto`) (`/login` y `/crear-empleado` con clave), la TUI SHALL: (1) dibujar en el borrador la versión enmascarada mientras se tipea, sin alterar el borrador real; (2) entregar a `onSubmit` el texto REAL, sin enmascarar; (3) guardar `TurnRecord.prompt` YA enmascarado al crearlo, de modo que el eco del turno pendiente y el de `<Static>` nunca muestren la clave; (4) NO guardar esa línea en el historial de flechas ↑/↓ (mínimo privilegio, D4 recomendada), condicionado a `contieneSecreto`; (5) mostrar tantos `*` como caracteres tiene la clave real tras cada tecla, incluido backspace (D3 recomendada). Los demás prompts SHALL comportarse exactamente como hoy. El alcance es sólo la TUI.

#### Scenario: Borrador enmascarado mientras se tipea
- GIVEN una TUI con el prompt vacío
- WHEN se tipea `/login ana secreto` tecla a tecla
- THEN el último frame muestra `> /login ana *******` y en ningún frame intermedio la línea del prompt (`> …`) contiene `secreto` ni un prefijo suyo

#### Scenario: `onSubmit` recibe el texto real y el login funciona
- GIVEN el borrador `/login ana secreto`
- WHEN se envía con Enter
- THEN `onSubmit` recibe `/login ana secreto` byte a byte
- AND el login se resuelve como antes de este change

#### Scenario: El eco del turno nunca muestra la clave
- GIVEN el envío de `/crear-empleado ana secreto-largo-123`
- WHEN se inspeccionan el turno pendiente y, luego, el turno en `<Static>`
- THEN ambos muestran `/crear-empleado ana *****************` (17 asteriscos) y `secreto-largo-123` no aparece en ningún frame

#### Scenario: Backspace conserva el feedback de longitud
- GIVEN el borrador `/login ana secreto`
- WHEN se presiona backspace una vez
- THEN el frame muestra `> /login ana ******` y el borrador real es `/login ana secret`

#### Scenario: Las líneas con clave no entran al historial de flechas
- GIVEN el envío previo de `hola` y luego de `/login ana secreto`
- WHEN se presiona ↑ con el prompt vacío
- THEN se recupera `hola` y en ningún momento la línea del prompt (`> …`) muestra `/login ana secreto` ni su versión enmascarada
- AND el eco `Vos: /login ana *******` en `<Static>` es esperado y no cuenta como incumplimiento (queda fuera de este scenario)

#### Scenario: Clave hecha sólo de asteriscos igual queda fuera del historial
- GIVEN el envío de `/login ana ***`
- WHEN se evalúa `contieneSecreto("/login ana ***")`
- THEN el resultado es `true` porque el tramo tiene longitud no vacía, aunque el enmascarado no cambie visualmente esa línea
- AND al presionar ↑ con el prompt vacío, `/login ana ***` NO se recupera

#### Scenario: Texto libre y comandos sin secreto no cambian
- GIVEN los envíos `hola`, `/estado-bot-prs` y `/login ana` (sin clave todavía)
- WHEN se inspeccionan borrador, eco e historial
- THEN se comportan igual que antes de este change, y los tres se recuperan con ↑

#### Scenario: Comando mal tipeado se ve tal cual (residual documentado)
- GIVEN el borrador `/logni ana secreto`
- WHEN la TUI lo dibuja
- THEN se muestra sin enmascarar, y un test fija ese comportamiento como residual aceptado

### Requirement: Logs, auditoría y respuesta del agente siguen sin contener la clave (no-regresión)

Este change SHALL NOT reintroducir la contraseña en `registro_acciones_empleado`, en eventos de `logTurnEvent` ni en la respuesta de ayuda o del agente. Los tests existentes que lo fijan (`build-on-comando-empleado.test.ts:568-569` y `:2670-2671`; `comando-empleado.test.ts:394-396`) SHALL seguir pasando sin edición. El enmascarado SHALL NOT aplicarse en `build-on-comando-empleado.ts`: el dispatcher recibe el texto real.

#### Scenario: `/login` y `/crear-empleado` no dejan la clave en ninguna otra superficie
- GIVEN `/login ana s3cret` y `/crear-empleado bob s3cret` ejecutados con el enmascarado activo en la TUI
- WHEN se inspeccionan las filas de auditoría, los eventos de log y la respuesta mostrada
- THEN ninguno contiene `s3cret`
