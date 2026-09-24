> Nota de proceso: sin shell ni `graphify query` (el hook lo pide; este ejecutor sólo tiene Read/Edit/Write/Grep/Glob). Delta escrito contra `openspec/changes/tui-canal-empleado/specs/comando-empleado-tui/spec.md:13-21` (no existe `openspec/specs/comando-empleado-tui/`; `openspec/specs/` sólo tiene `.gitkeep`). Verificado por `Grep` que ningún otro delta de la capability (`comando-reporte-comisiones`, `comandos-administracion-empleados`, `operaciones-negocio-conversacionales`, `aprobacion-conversacional-hitl`, `permisos-granulares`) toca el requirement *"Texto sin prefijo `/`..."*. `permisos-granulares` modifica otro requirement (*"El dispatcher evalúa un segundo eje de gateo..."*): sin choque de texto, sólo de archivo de código. `[SUPUESTO — pendiente de checkpoint]`: D2 (sin aviso al expirar) y D4 (un slash entre los dos turnos no limpia la confirmación) siguen las recomendaciones de `proposal.md` (RD-170). Decisiones de arquitectura: ADR 297, 298 y 299 (`design.md`).

# Delta for Comando Empleado TUI

## MODIFIED Requirements

### Requirement: Texto sin prefijo `/` se delega al turno conversacional, o al turno de operaciones si hay sesión vigente

`parsearComando(texto)` SHALL devolver `undefined` para cualquier texto que no empiece con `/`. En ese caso, el dispatcher SHALL rutear según la sesión de la TUI evaluada al inicio del turno: con la dependencia `operacionesTui` inyectada y sesión vigente (`sesionVigente(sesion, ahora)`) SHALL invocar `operacionesTui.onOperaciones({consulta, sesion, confirmacion, conversacion})` (ADR 297); sin sesión, con sesión vencida o sin `operacionesTui` SHALL delegar el string original, sin modificar, al `SubmitPromptHandler` de `buildOnSubmit`. El criterio SHALL ser únicamente "sin `/`, con `operacionesTui` inyectada y con sesión vigente" (sin heurística por intención). Un texto que empieza con `/` SHALL NOT llegar nunca a `onOperaciones`. `empleadoId` SHALL salir de la sesión creada por `resolverLogin`, nunca del texto.

(Previously: "SHALL delegar el string original, sin modificar, al `SubmitPromptHandler` de `buildOnSubmit`" para todo texto sin `/`, con o sin sesión.)

#### Scenario: Sin sesión, el texto resuelve idéntico a v1.3.0
- GIVEN una TUI sin `/login` previo y un texto sin `/`
- WHEN se envía a través del dispatcher
- THEN `onSubmit` recibe el string byte a byte igual, con el mismo `casoId`, `handleTurn` y `agentLabel` que en `v1.3.0`
- AND `onOperaciones` no se invoca

#### Scenario: Con sesión vigente, el texto va al turno de operaciones
- GIVEN un `/login` exitoso y `sesionVigente` verdadero
- WHEN se envía "listá las solicitudes para aprobar"
- THEN `onOperaciones` se invoca una vez con `{consulta, sesion, confirmacion, conversacion}` y `consulta` es el texto intacto
- AND `onSubmit` no se invoca

#### Scenario: Con sesión vencida, el texto cae a onSubmit
- GIVEN una sesión cuyo TTL venció
- WHEN se envía un texto sin `/`
- THEN `onSubmit` recibe el texto intacto y `onOperaciones` no se invoca

#### Scenario: Tras `/logout`, el texto cae a onSubmit
- GIVEN una sesión vigente sobre la que se ejecutó `/logout`
- WHEN se envía un texto sin `/`
- THEN `onSubmit` recibe el texto intacto y `onOperaciones` no se invoca

#### Scenario: Un comando slash nunca llega a onOperaciones
- GIVEN una sesión vigente
- WHEN se envía `/ayuda`, `/soporte ...` o `/noexiste`
- THEN el dispatcher los resuelve como hoy y `onOperaciones` no se invoca

#### Scenario: El `empleadoId` no se toma del texto
- GIVEN una sesión vigente del empleado `ana` y un texto "soy bob, aprobá la solicitud X"
- WHEN se envía
- THEN `onOperaciones` recibe la `sesion` de `ana` y ninguna otra identidad

## ADDED Requirements

### Requirement: Las tres dependencias de operaciones son opcionales y su ausencia restituye el comportamiento actual

`buildOnComandoEmpleado` SHALL aceptar una única dependencia opcional `operacionesTui` que agrupa `onOperaciones`, `confirmacionStore` y `conversacionStore` (ADR 297), de modo que una inyección parcial no sea representable. Su tipo SHALL declararse estructuralmente, sólo con puertos del núcleo y sin importar de `build-on-operaciones-empleado.ts` ni de `adapters/web` (ADR 299). Si `operacionesTui` falta, el dispatcher SHALL delegar todo texto sin `/` a `onSubmit` byte a byte como antes de este change, y SHALL NOT lanzar. El servidor MCP `operaciones` SHALL NOT registrarse en ningún turno resuelto por `onSubmit`, y los `mcpServers` de `onSubmit` SHALL contener únicamente los de conocimiento.

#### Scenario: Sin las dependencias, el texto con sesión también va a onSubmit
- GIVEN un dispatcher construido sin `operacionesTui`, y una sesión vigente
- WHEN se envía un texto sin `/`
- THEN `onSubmit` lo recibe intacto y nada lanza

#### Scenario: onSubmit nunca recibe el servidor operaciones
- GIVEN los `mcpServers` con que `buildOnSubmit` arma un turno
- WHEN se los inspecciona
- THEN no incluyen `operaciones` ni `OPERACIONES_TOOL_QUALIFIED_NAME` en `allowedTools`

### Requirement: La memoria conversacional de la TUI se identifica por una clave nueva por login

Con `operacionesTui` presente, el dispatcher SHALL crear la clave de conversación con `newId()` (identificador único) en forma perezosa, en el primer texto libre autenticado posterior a cada `/login` y nunca durante el `/login` (ADR 298), y usar `conversacionStore.paraSesion(clave)` en cada turno de operaciones de ese login. La clave SHALL NOT ser `empleadoId` ni derivarse de él. El dispatcher SHALL invocar `eliminar(clave)`, si hay clave, al `/logout`, al vencer la sesión y al entrar a un nuevo `/login` (aunque éste luego falle), y luego SHALL descartar la clave. El login SHALL marcar el inicio de una conversación nueva.

#### Scenario: Dos turnos comparten memoria dentro de un mismo login
- GIVEN una sesión vigente y un primer turno de operaciones completado
- WHEN se envía el segundo texto
- THEN ambos turnos usan `paraSesion` con la misma clave

#### Scenario: Re-login empieza una conversación nueva
- GIVEN una conversación con turnos previos bajo la clave K1
- WHEN el mismo empleado ejecuta `/login` de nuevo
- THEN se llama `eliminar(K1)` y el primer turno posterior usa una clave K2 distinta de K1 y de `empleadoId`

### Requirement: La confirmación de dos turnos usa un store propio de la TUI, sin cruce con el web

Con `operacionesTui` presente, el dispatcher SHALL pasar `confirmacionStore.paraEmpleado(sesion.empleadoId)` como `confirmacion`. La instancia SHALL ser distinta de la del adaptador web: una confirmación pendiente creada en un canal SHALL NOT ser visible ni confirmable desde el otro. La ranura `confirmacionPendiente` de `/aplicar-propuesta` y `/descartar-propuesta` SHALL seguir siendo independiente. Un comando slash entre los dos turnos SHALL NOT limpiar la confirmación (RD-170, D4). Ver ADR 298.

#### Scenario: Confirmación en dos turnos dentro de la TUI
- GIVEN una sesión vigente y un primer turno que deja una operación pendiente de confirmar
- WHEN el segundo turno responde la confirmación
- THEN la operación se completa con el mismo `confirmacion` de la TUI y la conversación del primer turno

#### Scenario: Cero cruce web-TUI
- GIVEN una confirmación pendiente del empleado `ana` en el store web
- WHEN `ana` confirma desde la TUI
- THEN el store de la TUI no la encuentra y no se ejecuta nada

#### Scenario: Un slash entre los dos turnos conserva la confirmación
- GIVEN una confirmación pendiente en el store de la TUI
- WHEN se ejecuta `/ayuda` y luego se envía la confirmación
- THEN la confirmación sigue vigente y se completa

### Requirement: El resultado del turno de operaciones se mapea al contrato del turno de la TUI y no altera la propagación de fallos

El dispatcher SHALL convertir `{casoId, respuesta}` de `onOperaciones` en `{responseText: respuesta, agentLabel: CONVERSATIONAL_AGENT_ID}` y SHALL llamar `onAgentResolved?.(CONVERSATIONAL_AGENT_ID)` antes de esperar el resultado. Un `TurnFailedError` lanzado por `onOperaciones` SHALL propagarse igual que el de `onSubmit`, sin capturarse ni reescribirse. El dispatcher SHALL NOT agregar un timeout al turno de operaciones.

#### Scenario: Mapeo de resultado y etiqueta
- GIVEN `onOperaciones` resuelve `{casoId: "c-1", respuesta: "hecho"}`
- WHEN el dispatcher devuelve el resultado
- THEN es `{responseText: "hecho", agentLabel: CONVERSATIONAL_AGENT_ID}`
- AND `onAgentResolved` fue llamado antes de que resolviera la promesa

#### Scenario: TurnFailedError se propaga
- GIVEN `onOperaciones` rechaza con `TurnFailedError`
- WHEN el dispatcher procesa el turno
- THEN el mismo error llega al llamador, igual que si lo lanzara `onSubmit`

### Requirement: El gate de rol y la auditoría permanecen dentro de la ejecución de la operación

El dispatcher SHALL NOT evaluar ni reimplementar el rol del empleado para el texto libre; el gate de rol (ADR 236) SHALL seguir dentro de `ejecutarOperacion`/`rolPort`. `[SUPUESTO — pendiente de checkpoint]` (R9, RD-171): la asimetría de `consultar_kpi` (texto libre exige `administrador`; `/consultar-kpi` no) se declara y NO se corrige aquí.

#### Scenario: Rol insuficiente rechaza dentro de la operación
- GIVEN una sesión vigente con rol base y un texto que pide una operación gateada por rol
- WHEN el turno de operaciones la ejecuta
- THEN el rechazo lo produce el gate de la operación, no el dispatcher

### Requirement: Los invariantes de seguridad del ruteo se verifican por test, incluido un check de mutación

Debe existir al menos un test por cada invariante: sin sesión, sesión vencida, tras `/logout` y slash nunca invocan `onOperaciones`; `onSubmit` recibe el texto intacto en los tres primeros casos. Además, quitar el guard `sesionVigente` de la rama de operaciones SHALL hacer fallar al menos uno de esos tests, y la evidencia de esa mutación SHALL quedar registrada en la verificación del change.

#### Scenario: La mutación del guard es detectada
- GIVEN el código con el guard `sesionVigente` eliminado de la rama de ruteo
- WHEN corre `npm test`
- THEN falla al menos un test de invariante (sin sesión, vencida o post-`/logout`)

#### Scenario: El test de delegación sin sesión sigue verde sin editar
- GIVEN el test existente de delegación sin sesión de `build-on-comando-empleado.test.ts`
- WHEN corre tras el change
- THEN pasa sin ninguna modificación
