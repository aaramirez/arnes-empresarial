> Nota de proceso: mismo `graphify query` corrido para `cliente-a2a-jsonrpc/spec.md` (ver esa nota). Además se leyó completo `src/core/turn-selector/dispatch-delegation.ts` (`DestinoDelegacion`, `DelegacionStorePort`, `DespacharDelegacionDeps`, `DelegacionAplicada`, `despacharDelegacion`, `despacharCadena`) y `src/core/agents/subagents.ts` (`TAREA_DELEGADA_MAX_CHARS = 8_000`, `InvocarSubagente`, `construirTareaDelegada`) como molde estructural verificado. Este spec se apoya en `proposal.md` (ADR 72, 73, 74, 75, R1, R2, R7, R8, R10, R11, R13) y en `openspec/changes/hito-2.0-delegacion-subagentes/specs/despacho-delegacion/spec.md` como plantilla de formato (registro antes de invocar / completado después, error tipado que propaga). No hay spec previa de esta capability — es un spec completo, no una delta. Ver `openspec/changes/hito-2.2-a2a-cliente/specs/despacho-delegacion/spec.md` para el delta MODIFIED que borra el requirement de `hito-2.0` que este hito reemplaza, y `openspec/changes/hito-2.2-a2a-cliente/specs/cliente-a2a-jsonrpc/spec.md` para el adaptador que este núcleo consume por puerto.

# Delegación A2A Saliente Specification

## Purpose

Capability nueva. Cubre ADR 72 (registro estático de destinos), 73 punto 2 (terminalidad del `TaskState`), 74 (despacho síncrono vía función hermana, tabla `delegaciones_a2a`, falla tipada) y 75 punto 1 (`ClienteA2APort` inyectable) de `proposal.md`, y la Caja Blanca 1.4 del arc42 en su nueva mitad externa: el puerto que el núcleo posee sobre el Cliente A2A, la resolución de una clave de destino fija a su configuración, el despacho real de una delegación externa (registrar antes de invocar, completar después, mismo criterio que `delegaciones` de `hito-2.0`), el vocabulario `TASK_STATE_*` del protocolo como terminología persistida y su predicado puro de terminalidad, y la falla tipada que propaga hacia quien la invoca. Corresponde al Escenario de ejecución 4 del arc42 (líneas 438-454): el Despachador de Delegación recibe la decisión de delegar hacia un destino externo, el resultado vuelve por el mismo camino que cualquier resultado de delegación, y el turno del padre cierra normal.

**Fuera de alcance de este spec**: la conversación HTTP/JSON-RPC real con el agente externo, el Agent Card, el loop de polling y la clasificación transporte/protocolo — capability `cliente-a2a-jsonrpc`, consumida acá solo por puerto; la rama `a2a` de `despacharDelegacion`/`despacharCadena`, que ya no existe (delta MODIFIED de `despacho-delegacion`); asincronía real (ningún caso queda "esperando A2A", ningún proceso separado retoma un caso); descubrimiento dinámico de agentes o un tercer destino más allá de los dos fijos; streaming, push notifications, servidor A2A; correlación con `delegaciones` (son tablas hermanas por `caso_id`, sin FK); qué caso de uso concreto del arnés dispara una delegación a `"riesgo-credito"` — eso es la capability `venta-confirmacion`.

**Enmienda posterior al diseño (ADR 85, cierra RD-26)**: los **tres últimos requirements** de este archivo llegaron después de `design.md`, con el checkpoint humano respondiendo la pregunta §15 punto 2 (*productor real para `"kpi-incidente"`, sí o no*) con un **sí**. Cubren el comando TUI `/consultar-kpi <consulta>`: su parseo, su guarda de privilegio, su llamado **síncrono y esperado** a la delegación externa, y el mapeo de cada motivo de fracaso a un mensaje legible distinto. Van **en esta capability y no en una nueva** por el mismo criterio con que `hito-2.1` puso `/ver-propuesta`/`/aplicar-propuesta`/`/descartar-propuesta` dentro de `propuesta-cambio-hitl` en vez de en una delta sobre `comando-empleado-tui`: el comando es la **superficie humana del dominio**, no una capability aparte. Ninguno de los siete requirements anteriores cambia de texto. Ninguna clave de destino nueva: `DESTINOS_A2A` sigue teniendo exactamente dos (requirement 1, intacto).

## Requirements

### Requirement: Registro estático de dos claves de destino, resueltas por variable de entorno; el llamador elige la clave, nunca el Cliente A2A ni el modelo

El sistema SHALL declarar exactamente dos claves de destino externo como constantes del núcleo: `"riesgo-credito"` y `"kpi-incidente"`. Cada clave SHALL resolver a una URL base configurada por su propia variable de entorno (`HARNESS_A2A_ENDPOINT_RIESGO_CREDITO`, `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE`), mediante una conversión pura y testeable de clave a nombre de variable. Una clave sin su variable de entorno configurada SHALL NOT ser un error de arranque — el destino queda no disponible, y el sistema SHALL fallar tipado únicamente si alguien intenta delegar hacia esa clave concreta. La clave de destino SHALL ser elegida por el caso de uso que invoca la delegación, en código — el sistema SHALL NOT exponer ninguna vía por la que el propio Cliente A2A, un prompt o el modelo elijan o infieran una clave de destino.

#### Scenario: Las dos claves fijas son las únicas reconocidas
- GIVEN el registro estático de destinos externos
- WHEN se inspeccionan las claves declaradas
- THEN son exactamente `"riesgo-credito"` y `"kpi-incidente"`, sin ninguna tercera

#### Scenario: Falta de configuración para una clave no impide arrancar
- GIVEN `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` no está configurada
- WHEN el proceso arranca
- THEN el arranque completa igual, y el destino `"kpi-incidente"` queda marcado como no disponible

#### Scenario: Delegar a una clave sin endpoint configurado falla tipado, no calla ni crashea
- GIVEN `"kpi-incidente"` no tiene su variable de entorno configurada
- WHEN un caso de uso intenta delegar hacia esa clave
- THEN la delegación falla con un error tipado, sin crear una fila huérfana en `delegaciones_a2a` sin destino resoluble

#### Scenario: Ninguna función del núcleo permite pasar una clave arbitraria no declarada
- GIVEN el conjunto de firmas públicas que aceptan una clave de destino
- WHEN se inspeccionan
- THEN todas están acotadas al conjunto cerrado de claves declaradas — ninguna acepta un string arbitrario como si fuera una clave válida sin verificarlo contra el registro

### Requirement: El puerto `ClienteA2APort` es inyectable; el núcleo se testea con dobles puros, sin red

El sistema SHALL declarar en el núcleo un puerto inyectable (mismo molde que `InvocarSubagente`) que representa la conversación completa con un agente externo — desde el envío hasta el resultado terminal o la falla. El caso de uso de despacho externo SHALL depender únicamente de ese puerto, nunca de un import directo del adaptador A2A ni de `fetch`. El sistema SHALL NOT abrir ningún socket real en ningún test del núcleo.

#### Scenario: El despacho externo se testea sin red
- GIVEN un doble del puerto que responde con un resultado exitoso predecible
- WHEN se testea el caso de uso de despacho externo
- THEN el test completa sin ninguna llamada de red real

#### Scenario: El caso de uso no importa el adaptador
- GIVEN el módulo del núcleo que implementa el despacho externo
- WHEN se inspeccionan sus imports
- THEN ninguno referencia `src/adapters/a2a/`

### Requirement: Registro de la delegación externa antes de invocar, completado después — misma disciplina que `delegaciones`

Para toda delegación externa, el sistema SHALL crear una fila en `delegaciones_a2a` (con `caso_id`, `destino_clave`, `agente_externo_url`, `tarea_delegada` y `estado = "TASK_STATE_SUBMITTED"`) **antes** de invocar al Cliente A2A, y SHALL actualizar esa misma fila **después**, con el último estado conocido en todos los casos — completada con `resultado` cuando el desenlace es exitoso, o con `resultado` sin completar en cualquier otro desenlace. El sistema SHALL NOT dejar una delegación externa sin fila de traza bajo ninguna circunstancia.

#### Scenario: La fila existe con estado inicial antes de invocar
- GIVEN un caso de uso dispara una delegación hacia `"riesgo-credito"`
- WHEN se verifica el estado de la base justo después de resolver el destino pero antes de que el Cliente A2A responda
- THEN existe una fila en `delegaciones_a2a` con `estado = "TASK_STATE_SUBMITTED"`, `a2a_task_id` nulo y `resultado` nulo

#### Scenario: Delegación exitosa completa la fila con el resultado
- GIVEN una delegación cuyo Cliente A2A responde con la tarea en `TASK_STATE_COMPLETED`
- WHEN se completa el despacho
- THEN la fila queda con `estado = "TASK_STATE_COMPLETED"`, `a2a_task_id` no nulo y `resultado` poblado con el texto devuelto

#### Scenario: Una falla del Cliente A2A justo después de crear la fila no la deja huérfana
- GIVEN el Cliente A2A rechaza inmediatamente después de que la fila se creó con `estado = "TASK_STATE_SUBMITTED"`
- WHEN se procesa esa falla
- THEN la fila permanece persistida con su último estado conocido, sin borrarse ni quedar en un estado inconsistente

### Requirement: `TASK_STATE_*` persistido crudo, con predicado puro de terminalidad testeado sobre los ocho valores

El sistema SHALL persistir `delegaciones_a2a.estado` con los valores reales del protocolo A2A v1.0.0 (`TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_AUTH_REQUIRED`), sin traducirlos a un vocabulario propio en minúscula-con-guion. El sistema SHALL exponer un predicado puro de terminalidad sobre esos ocho valores: `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED` y `TASK_STATE_REJECTED` SHALL ser terminales; `TASK_STATE_SUBMITTED` y `TASK_STATE_WORKING` SHALL NOT ser terminales; `TASK_STATE_INPUT_REQUIRED` y `TASK_STATE_AUTH_REQUIRED` SHALL tratarse como terminales de fracaso, con su propio `reason` distinguible, porque son estados que esperan una interacción que este hito no construye.

#### Scenario: El predicado de terminalidad cubre los ocho valores exhaustivamente
- GIVEN cada uno de los ocho valores `TASK_STATE_*` de la especificación
- WHEN se evalúa el predicado de terminalidad sobre cada uno
- THEN `COMPLETED`, `FAILED`, `CANCELED` y `REJECTED` son terminales; `SUBMITTED` y `WORKING` no lo son; `INPUT_REQUIRED` y `AUTH_REQUIRED` son terminales de fracaso con `reason` propio

#### Scenario: `TASK_STATE_INPUT_REQUIRED` no queda esperando indefinidamente
- GIVEN una tarea externa que alcanza `TASK_STATE_INPUT_REQUIRED`
- WHEN el Despachador procesa ese estado
- THEN la delegación falla de inmediato con un `reason` distinguible de `"failed"`, en vez de seguir consultando `GetTask` esperando que ese estado avance

#### Scenario: El vocabulario persistido no se traduce a minúscula-con-guion
- GIVEN una fila de `delegaciones_a2a` recién completada
- WHEN se inspecciona su columna `estado`
- THEN el valor es exactamente uno de los ocho `TASK_STATE_*` en mayúscula con guion bajo, nunca un valor traducido

### Requirement: El Despachador bloquea hasta desenlace terminal o timeout — nunca deja un caso "esperando A2A"

La delegación externa SHALL resolverse dentro del mismo `await` que la invoca — el mismo criterio síncrono-por-turno que ya rige `despacharDelegacion`/`despacharCadena`. El sistema SHALL NOT introducir un estado `pendiente_a2a` en `casos`, ninguna cola, ningún reintento diferido, ni ningún mecanismo por el que un proceso separado retome un caso cuando un `TaskState` externo llegue a terminal más tarde.

#### Scenario: El caso de uso que delega recibe el resultado o el error dentro de la misma invocación
- GIVEN un caso de uso invoca la delegación externa con `await`
- WHEN esa expresión resuelve (ya sea con resultado o con excepción)
- THEN no queda ningún estado intermedio "esperando A2A" en `casos`, ni ninguna tarea diferida programada para más tarde

#### Scenario: Ningún mecanismo de reanudación existe para una delegación externa
- GIVEN el código completo de esta capability
- WHEN se inspecciona en busca de un scheduler, una cola o un estado de reanudación
- THEN no existe ninguno — toda delegación externa se resuelve o falla dentro del `await` que la originó

### Requirement: Desenlaces explícitos y exhaustivos — cada uno deja traza, ninguno hangea, ninguno enmascara el error real

Todo desenlace de una delegación externa SHALL mapear a uno de: éxito (`TASK_STATE_COMPLETED`, resultado poblado); fracaso con `reason` igual al `TaskState` terminal real (`failed`, `canceled`, `rejected`, `input-required`, `auth-required`); fracaso por timeout total agotado (`reason = "timeout"`, con `CancelTask` intentado best-effort primero); fracaso de transporte (`reason = "transporte"`); fracaso de protocolo (`reason = "protocolo"`, cuerpo truncado a 500 caracteres). En todo desenlace de fracaso, la fila de `delegaciones_a2a` SHALL quedar con el último `estado` conocido, y el sistema SHALL propagar un error tipado (`DelegacionA2ANoCompletadaError` con su `reason`) tal cual, sin capturarlo ni degradarlo a texto — mismo contrato que `despacharCadena` ("NO captura: si un eslabón falla, el error propaga tal cual").

#### Scenario: `TASK_STATE_FAILED` produce el error tipado con `reason = "failed"` y fila persistida
- GIVEN el agente externo devuelve la tarea en `TASK_STATE_FAILED`
- WHEN el Despachador procesa ese desenlace
- THEN propaga `DelegacionA2ANoCompletadaError` con `reason = "failed"`
- AND la fila de `delegaciones_a2a` queda con `estado = "TASK_STATE_FAILED"` y `resultado` nulo

#### Scenario: Timeout total agotado deja el último estado conocido, no un estado inventado
- GIVEN una tarea que nunca sale de `TASK_STATE_WORKING` hasta agotar `HARNESS_A2A_TASK_TIMEOUT_MS`
- WHEN el timeout se agota
- THEN la fila de `delegaciones_a2a` queda con `estado = "TASK_STATE_WORKING"` (el último conocido, no un valor sintético de "timeout")
- AND se propaga `DelegacionA2ANoCompletadaError` con `reason = "timeout"`

#### Scenario: Ningún desenlace deja la delegación en un estado ambiguo o silencioso
- GIVEN cualquiera de los ocho desenlaces posibles (éxito, los cuatro `reason` de `TaskState` terminal, timeout, transporte, protocolo)
- WHEN se enumera el mapeo completo
- THEN cada uno tiene un `reason` distinguible o un resultado exitoso — ninguno cae en un caso por defecto no especificado

### Requirement: La tarea delegada reusa el mismo tope de caracteres que la delegación in-process, sin depender de una `AgentDefinition`

El texto de la tarea delegada a un agente externo SHALL truncarse al mismo tope que rige `delegaciones.tarea_delegada` (`TAREA_DELEGADA_MAX_CHARS`, 8 000 caracteres). Su construcción SHALL NOT requerir una `AgentDefinition` del registro de subagentes in-process — un agente externo no tiene ni puede tener entrada en ese registro.

#### Scenario: Una tarea delegada de más de 8 000 caracteres se trunca igual que una in-process
- GIVEN un insumo cuyo texto ensamblado supera los 8 000 caracteres
- WHEN se construye la tarea delegada hacia un destino externo
- THEN el texto persistido en `delegaciones_a2a.tarea_delegada` está truncado al mismo tope que usa `delegaciones.tarea_delegada`

#### Scenario: Construir la tarea delegada externa no requiere un rol de `SUBAGENT_REGISTRY`
- GIVEN una clave de destino externo válida y un insumo
- WHEN se construye su tarea delegada
- THEN la construcción no consulta ni depende de ninguna `AgentDefinition` del registro in-process

### Requirement: Interruptor `HARNESS_A2A_SALIENTE` — apagado reproduce exactamente el comportamiento de `v2.1.0`

Con `HARNESS_A2A_SALIENTE=off` (o sin configurar), el composition root SHALL NOT cablear ningún adaptador A2A, y ningún caso de uso SHALL producir una delegación hacia una clave de destino externo. El comportamiento resultante SHALL ser indistinguible del de `v2.1.0`: cero filas en `delegaciones_a2a`, cero llamadas salientes hacia un agente externo.

#### Scenario: Con el interruptor apagado, ninguna venta grande dispara una delegación externa
- GIVEN `HARNESS_A2A_SALIENTE=off` y una venta que supera el umbral de venta grande
- WHEN se registra esa venta
- THEN no se crea ninguna fila en `delegaciones_a2a` y no sale ningún `fetch` hacia un agente A2A

#### Scenario: Con el interruptor encendido y configuración completa, el mecanismo completo se ejercita
- GIVEN `HARNESS_A2A_SALIENTE=on` y ambas claves de destino configuradas con sus variables de entorno
- WHEN un caso de uso delega hacia `"riesgo-credito"` o `"kpi-incidente"`
- THEN el Cliente A2A real se invoca y la fila de `delegaciones_a2a` refleja el desenlace real

### Requirement: `/consultar-kpi <consulta>` es un comando TUI privilegiado, de un solo paso, con la consulta obligatoria

El sistema SHALL exponer en el canal TUI de empleados un comando `/consultar-kpi <consulta>` cuyo argumento SHALL ser el resto entero de la línea después del primer espacio, con los bordes recortados — el mismo patrón de parseo que ya usan `/soporte` y `/devolucion`. Ese argumento SHALL ser **obligatorio**: `/consultar-kpi` sin resto, o con un resto en blanco, SHALL resolverse por el mismo sumidero de ayuda por argumentos faltantes que el resto de los comandos, sin delegar nada. El comando SHALL ser **privilegiado** — exige sesión de empleado vigente, mismo criterio ya aplicado a `/ver-propuesta`, porque envía contexto de la empresa a un tercero externo y devuelve su respuesta. El comando SHALL resolverse en **un solo paso**, sin eco ni confirmación: no escribe estado del núcleo, y el sistema SHALL NOT agregar un cuarto dominio a la ranura única de confirmación pendiente.

#### Scenario: La consulta es el resto entero de la línea
- GIVEN un empleado con sesión vigente escribe `/consultar-kpi` seguido de un texto con varias palabras y espacios internos
- WHEN se parsea el comando
- THEN el texto completo posterior al primer espacio, recortado en los bordes, queda como la consulta — sin partirse en tokens

#### Scenario: Sin consulta, el comando no delega y muestra su uso
- GIVEN un empleado con sesión vigente escribe `/consultar-kpi` sin argumento, o sólo con espacios
- WHEN se procesa el comando
- THEN el sistema responde con la línea de uso del comando y no invoca ninguna delegación externa ni crea ninguna fila en `delegaciones_a2a`

#### Scenario: Sin sesión vigente, el comando no llega a delegar
- GIVEN no hay sesión de empleado vigente
- WHEN se ejecuta `/consultar-kpi <consulta>`
- THEN el sistema responde el mensaje de la guarda de privilegio, y no se crea ningún caso, ninguna fila en `delegaciones_a2a` ni ninguna llamada saliente hacia un agente externo

#### Scenario: El comando no introduce una confirmación en dos pasos
- GIVEN un empleado con sesión vigente ejecuta `/consultar-kpi <consulta>` dos veces seguidas
- WHEN se procesan ambas
- THEN cada una se resuelve por sí sola en un solo turno — la segunda no se interpreta como confirmación de la primera, y la ranura de confirmación pendiente de los otros dominios no se lee ni se escribe

### Requirement: `/consultar-kpi` es el productor real del destino `"kpi-incidente"` y **espera** el resultado — el camino síncrono del Despachador ejercitado por un llamador de producción

El comando SHALL delegar hacia la clave de destino `"kpi-incidente"`, fijada **en código** por el caso de uso, y SHALL **esperar** el desenlace de esa delegación antes de responder — es decir, SHALL usar el mecanismo síncrono-bloqueante del Despachador, con el techo total de reloj ya configurado (`HARNESS_A2A_TASK_TIMEOUT_MS`). La instrucción enviada al agente externo SHALL ser fija, escrita en código; el texto que aporta el empleado SHALL viajar únicamente como material de la consulta. El sistema SHALL NOT declarar una clave de destino nueva: el registro estático sigue teniendo exactamente las dos claves del primer requirement de esta capability. Cuando la delegación completa con éxito, el texto del resultado SHALL devolverse como respuesta del turno de la TUI.

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

### Requirement: Cada motivo de fracaso de la delegación se traduce a un mensaje legible y distinto — ningún camino silencioso, ningún cuelgue

Cuando la delegación no completa, el comando SHALL capturar el error tipado que el Despachador propaga y SHALL responder un mensaje legible **distinto por cada motivo** del vocabulario cerrado (`failed`, `canceled`, `rejected`, `input-required`, `auth-required`, `timeout`, `transporte`, `protocolo`). El sistema SHALL NOT dejar el turno sin respuesta, SHALL NOT propagar la excepción fuera del dispatcher de comandos, y SHALL NOT mantener la TUI esperando más allá del techo total de reloj ya configurado. El mensaje SHALL NOT incluir ninguna credencial. Cuando el interruptor de A2A saliente está apagado, el comando SHALL responder que la delegación externa está desactivada, sin crear caso, sin crear fila y sin ninguna llamada saliente.

#### Scenario: Cada motivo produce un mensaje propio
- GIVEN cada uno de los ocho motivos de fracaso del vocabulario cerrado
- WHEN el comando procesa una delegación que falla con ese motivo
- THEN responde un mensaje legible, y dos motivos distintos nunca producen el mismo mensaje

#### Scenario: Un fracaso no deja el turno sin respuesta ni propaga la excepción
- GIVEN una delegación que falla con cualquier motivo
- WHEN se completa el turno de `/consultar-kpi`
- THEN la TUI recibe un resultado de turno con texto — la excepción no escapa del dispatcher de comandos

#### Scenario: Agotar el techo total de reloj responde por timeout, no cuelga
- GIVEN un agente externo que nunca alcanza un estado terminal
- WHEN se agota el techo total de reloj de la delegación
- THEN el comando responde el mensaje correspondiente al motivo de timeout dentro de ese techo, y la fila queda con el último estado conocido

#### Scenario: Con el interruptor apagado, el comando responde sin delegar
- GIVEN el interruptor de A2A saliente apagado
- WHEN un empleado con sesión vigente ejecuta `/consultar-kpi <consulta>`
- THEN la TUI responde que la delegación externa está desactivada, y no se crea ningún caso, ninguna fila en `delegaciones_a2a` ni ninguna llamada saliente

#### Scenario: Ningún mensaje de error expone credenciales
- GIVEN un destino configurado con token de autorización y una delegación que falla
- WHEN se inspecciona el mensaje que la TUI devuelve
- THEN no contiene el valor del token bajo ninguna forma
