> Nota de proceso: capability nueva — no hay spec previa, es un spec completo, no una delta. Cubre ADR 134 (molde `/ver-propuesta`, síncrono, sin confirmación, con auditoría — checkpoint resolvió la tensión con `comando-reporte-comisiones` a favor de SÍ registrar), ADR 135 (conjunto "en curso" derivado de `esEstadoTerminal`, cero taxonomía paralela, `a2a-contract.ts` sin tocar), ADR 136 (checkpoint aprobado: puerto de núcleo nuevo en archivo nuevo de `src/core/`, no el import directo de `repository.js`), ADR 137 (índice sobre `estado`, `SEARCH` no `SCAN`) y ADR 138 (`privilegiado: true`) de `proposal.md`.
>
> Fuera de alcance de este spec: cancelar una solicitud A2A entrante desde la TUI (`cancelarSolicitudA2AEntrante` ya existe pero sólo la alcanza un tercero vía `CancelTask`); un barrido de arranque que reconcilie huérfanos; filtrar por caso, fecha o texto del mensaje (`listSolicitudesA2AEntrantesPorCaso` ya cubre el volcado por caso). El delta sobre `solicitud-a2a-entrante` (mismo change) documenta que este comando no toca el camino de escritura del Hito 7 ni `a2a-contract.ts`.

# Visibilidad A2A Entrante Specification

## Purpose

Capability nueva. Expone `/ver-solicitudes-a2a [a2aTaskId]`: la ventana humana que falta sobre `solicitudes_a2a_entrantes` — sin argumento, las solicitudes en curso; con `a2aTaskId`, el detalle de una. Es de lectura pura, privilegiado, y su límite honesto es estructural: el protocolo A2A v1.0.0 no transporta la identidad del agente externo, así que el comando nunca puede decir "quién" delegó — sólo desde dónde llegó la conexión.

## Requirements

### Requirement: Descriptor `/ver-solicitudes-a2a [a2aTaskId]`, forma `id_opcional_a2a`, privilegiado

El sistema SHALL declarar en `DESCRIPTORES` un descriptor `/ver-solicitudes-a2a [a2aTaskId]` con una `Forma` nueva `"id_opcional_a2a"` (ADR 56 — una forma por SHAPE de payload, la clave es `a2aTaskId`, distinta de `ventaId`/`solicitudId`/`propuestaId`) y `privilegiado: true` (ADR 138). `parsearComando` SHALL reconocerlo sin ningún import nuevo.

#### Scenario: `/ver-solicitudes-a2a <id>` se reconoce con el id explícito

- GIVEN el texto `/ver-solicitudes-a2a 9f27f1fb-...`
- WHEN `parsearComando` lo procesa
- THEN devuelve un resultado tipado con `a2aTaskId: "9f27f1fb-..."`

#### Scenario: `/ver-solicitudes-a2a` sin argumento se reconoce sin id

- GIVEN el texto `/ver-solicitudes-a2a`
- WHEN `parsearComando` lo procesa
- THEN devuelve el resultado tipado sin campo `a2aTaskId`

#### Scenario: Sin sesión, el comando se rechaza antes de leer nada

- GIVEN no hay sesión vigente
- WHEN se ejecuta `/ver-solicitudes-a2a` o `/ver-solicitudes-a2a <id>`
- THEN el comando se rechaza sin ejecutar ninguna consulta sobre `solicitudes_a2a_entrantes`

### Requirement: Sin argumento, lista las solicitudes en curso — el conjunto se DERIVA de `esEstadoTerminal`, sin taxonomía paralela

Sin `a2aTaskId`, el sistema SHALL listar únicamente las filas cuyo `estado` no sea terminal según `esEstadoTerminal` de `a2a-contract.ts` (hoy `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING`). El sistema SHALL NOT declarar ninguna constante literal de estados "en curso" — el conjunto SHALL computarse filtrando `TASK_STATES_CONOCIDOS` con `esEstadoTerminal`, reusada sin modificar `a2a-contract.ts` (ADR 135).

#### Scenario: Lista exactamente las filas SUBMITTED/WORKING

- GIVEN filas con las ocho variantes de `TASK_STATES_CONOCIDOS`
- WHEN se ejecuta `/ver-solicitudes-a2a` sin argumento
- THEN el listado contiene únicamente las filas en `SUBMITTED` y `WORKING`

#### Scenario: `INPUT_REQUIRED` y `AUTH_REQUIRED` no aparecen como "en curso"

- GIVEN una fila en `TASK_STATE_INPUT_REQUIRED` y otra en `TASK_STATE_AUTH_REQUIRED` (terminales de fracaso, ADR 73 punto 2)
- WHEN se ejecuta `/ver-solicitudes-a2a` sin argumento
- THEN ninguna de las dos aparece en el listado

#### Scenario: El conjunto no depende de una lista escrita a mano

- GIVEN el código del comando
- WHEN se inspecciona en busca de una constante literal de estados "en curso"
- THEN no existe ninguna — el conjunto se deriva de `esEstadoTerminal` en tiempo de ejecución

### Requirement: Con `a2aTaskId`, muestra el detalle o "no existe" — sin SQL nuevo para ese modo

Con `a2aTaskId`, el sistema SHALL mostrar el detalle de esa fila reusando la lectura existente por id (`getSolicitudA2AEntrantePorTaskId`), sin SQL nuevo para este modo. Un `a2aTaskId` sin fila correspondiente SHALL responder con un texto explicativo de "no existe", nunca con una excepción sin capturar.

#### Scenario: Un id existente muestra su detalle completo

- GIVEN una fila con `a2aTaskId = "9f27f1fb-..."` en cualquier estado
- WHEN se ejecuta `/ver-solicitudes-a2a 9f27f1fb-...`
- THEN la respuesta incluye `a2aTaskId`, `estado`, `origen_transporte`, `created_at`/`updated_at`, y `resultado`/`mensaje_recibido` si están poblados

#### Scenario: Un id inexistente responde sin lanzar

- GIVEN ningún `a2aTaskId` igual a `"no-existe"`
- WHEN se ejecuta `/ver-solicitudes-a2a no-existe`
- THEN la respuesta es un texto explicativo de que no existe ninguna solicitud con ese id, sin lanzar ninguna excepción

### Requirement: Puerto de lectura nuevo en `src/core/`, síncrono, dos métodos — sin puerto de escritura

El sistema SHALL exponer un puerto de núcleo nuevo, en un archivo NUEVO de `src/core/` (no dentro de `a2a-contract.ts`), con dos métodos síncronos de lectura: listar solicitudes por conjunto de estados, y obtener una por `a2aTaskId`. El puerto SHALL NOT incluir ningún método de escritura. El sistema SHALL NOT modificar ningún archivo existente de `src/core/` para exponerlo (ADR 136).

#### Scenario: El puerto es inyectable y testeable sin base de datos

- GIVEN el handler del comando
- WHEN se lo testea con un doble plano del puerto (sin `db` real)
- THEN el handler produce la salida esperada sin ninguna dependencia de `better-sqlite3`

#### Scenario: El puerto no tiene ningún método de escritura

- GIVEN la interfaz del puerto nuevo
- WHEN se inspeccionan sus métodos
- THEN ninguno inserta, actualiza ni borra filas de `solicitudes_a2a_entrantes`

### Requirement: El listado usa índice sobre `estado` — `SEARCH`, no `SCAN`

El sistema SHALL crear un índice sobre `solicitudes_a2a_entrantes.estado` (migración aditiva, `CREATE INDEX IF NOT EXISTS`). La función de listado SHALL construir el filtro por estado de forma que el planner de SQLite pueda usar ese índice para un `IN` de aridad variable — mismo estándar de prueba que `listPropuestasCambio` (ADR 137).

#### Scenario: `EXPLAIN QUERY PLAN` confirma `SEARCH`, no `SCAN`

- GIVEN la tabla `solicitudes_a2a_entrantes` con el índice nuevo aplicado
- WHEN se ejecuta `EXPLAIN QUERY PLAN` sobre la consulta del listado con el conjunto de estados en curso
- THEN el plan reporta `SEARCH` sobre `solicitudes_a2a_entrantes`, no `SCAN`

### Requirement: `origen_transporte` se rotula como origen de transporte, nunca como "agente" — límite honesto, no identidad

El sistema SHALL NOT mostrar `origen_transporte` (o cualquier otro campo) rotulado como identidad de un agente externo. El protocolo A2A v1.0.0 no transporta esa identidad — `agente_externo_url` es siempre `NULL` — y `origen_transporte` es únicamente la dirección de red observada por el transporte. Ni el listado ni el detalle SHALL sugerir, por texto o rótulo, que se conoce qué agente delegó una tarea.

#### Scenario: El listado rotula la columna como origen de transporte

- GIVEN cualquier fila con `origen_transporte` poblado
- WHEN se muestra en el listado o el detalle
- THEN el rótulo de esa columna dice "origen" o equivalente de transporte, nunca "agente" ni "solicitante"

#### Scenario: `agente_externo_url` NULL no se sustituye por un valor inventado

- GIVEN una fila con `agente_externo_url = NULL` (todas, en este hito)
- WHEN se muestra su detalle
- THEN no se imprime ningún valor inventado ni una cadena vacía engañosa en su lugar — se omite o se marca explícitamente como no disponible

### Requirement: Sin confirmación en dos pasos — es una consulta, no una escritura

`/ver-solicitudes-a2a`, en cualquiera de sus dos modos, SHALL NOT modificar `solicitudes_a2a_entrantes` ni ninguna otra tabla de negocio, y SHALL NOT exigir un segundo paso de confirmación. `confirmacionPendiente` SHALL NOT ganar ninguna rama para este comando.

#### Scenario: Ejecutarlo no cambia ningún dato de negocio

- GIVEN un estado inicial de `solicitudes_a2a_entrantes`
- WHEN se ejecuta `/ver-solicitudes-a2a` con o sin `a2aTaskId`, con sesión vigente
- THEN `solicitudes_a2a_entrantes` queda idéntica a antes de ejecutarlo

#### Scenario: Un solo mensaje resuelve el comando, sin eco previo

- GIVEN sesión vigente
- WHEN se ejecuta `/ver-solicitudes-a2a <id>`
- THEN la respuesta llega en el mismo turno, sin un paso previo que pida confirmar

### Requirement: Fila de auditoría en `registro_acciones_empleado`

Toda ejecución exitosa de `/ver-solicitudes-a2a` con sesión vigente SHALL dejar una fila en `registro_acciones_empleado` con el `empleado_id` de la sesión, sin requerir migración de esquema — decisión de checkpoint alineada con `comando-reporte-comisiones` y `comando-cancelar-solicitud`, no con `/ver-propuesta`.

#### Scenario: Ejecución exitosa deja fila de auditoría

- GIVEN sesión vigente de un `empleadoId` conocido
- WHEN se ejecuta `/ver-solicitudes-a2a` (con o sin `a2aTaskId`) y produce una respuesta
- THEN existe una fila nueva en `registro_acciones_empleado` con ese `empleado_id`

#### Scenario: Sin sesión, no hay fila de auditoría

- GIVEN no hay sesión vigente
- WHEN se intenta `/ver-solicitudes-a2a`
- THEN no se escribe ninguna fila en `registro_acciones_empleado`
