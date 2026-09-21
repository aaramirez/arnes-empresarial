> Nota de proceso: mismo hook de graphify sin shell que `proposal.md` (sólo Read/Grep/Glob). **Versión base**: `openspec/changes/hito-2.2-a2a-cliente/specs/delegacion-a2a-saliente/spec.md`, la ÚNICA versión de esta capability (verificado por `Glob` sobre `openspec/changes/*/specs/delegacion-a2a-saliente/spec.md`; ningún otro change la modifica). Este delta es el que `design.md` §17 pto 2 exige y que la primera redacción de `sdd-spec` omitió por error. **Es mínimo a propósito**: sólo el requirement del productor de `"kpi-incidente"` queda falso o incompleto con este change, porque dice que `/consultar-kpi` ES el productor y describe el material únicamente como "el texto que aporta el empleado". Los demás requirements de la capability —registro estático de dos claves, puerto inyectable, fila antes de invocar, `TASK_STATE_*`, bloqueo hasta desenlace, desenlaces exhaustivos, tope de la tarea, interruptor `HARNESS_A2A_SALIENTE`, comando de TUI privilegiado y mensajes por motivo— siguen ciertos tal cual: el chat cumple el interruptor y el registro de claves sin necesitar texto nuevo, y el rol, el plazo total del canal, el caso del turno, la auditoría y el marco del resultado son de la capability `consulta-kpi-a2a-chat`, no del mecanismo de despacho. Ninguna clave de destino nueva. ★ **Alcance de la garantía nueva**: nombra la operación `consultar_kpi` y el destino `"kpi-incidente"` y nada más; NO describe ni prohíbe lo que otros casos de uso componen hacia sus destinos (p. ej. la consulta de riesgo crediticio que dispara `registrar_venta` hacia `"riesgo-credito"` con campos de la venta, `design.md` §0.8).

# Delta for Delegación A2A Saliente

## RENAMED Requirements

- FROM: `### Requirement: `/consultar-kpi` es el productor real del destino `"kpi-incidente"` y **espera** el resultado — el camino síncrono del Despachador ejercitado por un llamador de producción`
- TO: `### Requirement: El destino `"kpi-incidente"` tiene dos productores reales —el comando TUI `/consultar-kpi` y la operación conversacional `consultar_kpi`— y ambos **esperan** el resultado, con el material fijado por el canal`

## MODIFIED Requirements

### Requirement: El destino `"kpi-incidente"` tiene dos productores reales —el comando TUI `/consultar-kpi` y la operación conversacional `consultar_kpi`— y ambos **esperan** el resultado, con el material fijado por el canal

Hay DOS productores del destino `"kpi-incidente"`: el comando `/consultar-kpi <consulta>` de la TUI, cuyo comportamiento no cambia, y la operación conversacional `consultar_kpi` (capability `consulta-kpi-a2a-chat`). Los dos SHALL delegar hacia la clave de destino `"kpi-incidente"`, fijada **en código** por el caso de uso, y SHALL **esperar** el desenlace de esa delegación antes de responder — es decir, SHALL usar el mecanismo síncrono-bloqueante del Despachador, con el techo total de reloj que corresponde a su canal (el ya configurado `HARNESS_A2A_TASK_TIMEOUT_MS` para la TUI; para el chat, uno propio y más corto, que fija `consulta-kpi-a2a-chat`). La instrucción enviada al agente externo SHALL ser fija, escrita en código, en los dos canales. El material SHALL depender del canal: en la TUI, el texto que aporta el empleado SHALL viajar únicamente como material de la consulta; en el canal conversacional, el material SHALL salir de un catálogo cerrado definido en código, el modelo SHALL aportar únicamente una clave de ese conjunto, y el sistema SHALL NOT despachar hacia `"kpi-incidente"` con una clave fuera del conjunto. El sistema SHALL NOT declarar una clave de destino nueva: el registro estático sigue teniendo exactamente las dos claves del primer requirement de esta capability. Cuando la delegación completa con éxito, el texto del resultado SHALL devolverse como respuesta del turno de la TUI; en el chat, SHALL llegar al modelo únicamente dentro del marco de texto externo que fija `consulta-kpi-a2a-chat`.

(Previously: el requirement se titulaba "`/consultar-kpi` es el productor real del destino `"kpi-incidente"`" y afirmaba que el comando de la TUI era el único productor, que la instrucción era fija y que sólo "el texto que aporta el empleado" viajaba como material; no decía nada del canal conversacional, donde quien elige es un modelo y no un humano que tipea, ni prohibía nada en él. El techo de reloj era uno solo, el ya configurado. El resultado se devolvía sólo como respuesta del turno de la TUI.)

#### Scenario: Una consulta exitosa devuelve el texto del agente externo
- GIVEN un empleado con sesión vigente, el interruptor de A2A saliente encendido y `"kpi-incidente"` configurado
- WHEN ejecuta `/consultar-kpi <consulta>` y el agente externo llega a `TASK_STATE_COMPLETED` con texto
- THEN la TUI responde con ese texto
- AND queda una fila en `delegaciones_a2a` con `destino_clave = "kpi-incidente"`, `estado = "TASK_STATE_COMPLETED"` y `resultado` poblado

#### Scenario: El comando espera el desenlace, no dispara y sigue
- GIVEN una delegación hacia `"kpi-incidente"` que todavía no alcanzó un estado terminal
- WHEN se observa el turno de `/consultar-kpi`
- THEN el turno todavía no respondió — a diferencia del enganche de ventas, este camino sí espera el resultado dentro de la misma invocación

#### Scenario: La clave y la instrucción las fija el código, nunca el empleado ni el modelo
- GIVEN cualquier texto de consulta que un empleado pueda escribir
- WHEN se construye la delegación
- THEN la clave de destino es siempre `"kpi-incidente"` y la instrucción es siempre la fijada en código — el texto del empleado sólo puede influir en el material, nunca en el destino ni en la instrucción

#### Scenario: El comando no agrega una tercera clave de destino
- GIVEN el registro estático de destinos externos después de agregar este comando
- WHEN se inspeccionan las claves declaradas
- THEN siguen siendo exactamente `"riesgo-credito"` y `"kpi-incidente"`

#### Scenario: En el chat, el material sale del catálogo y la instrucción es la de la TUI
- GIVEN un doble de `ClienteA2APort` que registra lo que recibe, un administrador y cada clave K del catálogo cerrado de `consultar_kpi`
- WHEN se invoca la operación conversacional `consultar_kpi` con K
- THEN el destino es `"kpi-incidente"`, la línea de instrucción de la tarea es igual a la que envía `/consultar-kpi` en la TUI, y el material es el que el catálogo fija para K, sin ningún carácter aportado por el modelo

#### Scenario: En el chat no se despacha hacia `"kpi-incidente"` con una clave fuera del catálogo
- GIVEN una invocación de `consultar_kpi` con una clave fuera del catálogo que llega al dispatcher, y espías del cliente A2A y del store de delegaciones
- WHEN se ejecuta la operación
- THEN no se llamó al cliente, no se creó ninguna fila en `delegaciones_a2a` y la respuesta no contiene la clave recibida
