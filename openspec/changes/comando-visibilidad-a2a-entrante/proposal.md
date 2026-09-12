# Propuesta: `/ver-solicitudes-a2a [a2aTaskId]` — visibilidad humana sobre las solicitudes A2A entrantes (v3.4.0)

**Origen**: `src/adapters/memory/migrations/0011_solicitudes_a2a_entrantes.ts:36-38`, que justifica tener **un solo índice** con esta frase textual: *"hay un único patrón de lectura real … **Ninguna pantalla ni comando filtra por `estado`**"*. Era cierto cuando se escribió. Dejó de serlo el día que el Hito 7 (`v3.0.0`) cerró y el arnés empezó a aceptar tareas de terceros: hoy la tabla `solicitudes_a2a_entrantes` es la **única de las tres tablas de flujo con listado potencial** (`solicitudes_internas`, `propuestas_cambio`, ésta) que ningún humano puede mirar desde la TUI.

**Rama prevista**: `hito/v3.4-comando-visibilidad-a2a-entrante` · **Tag de cierre**: `v3.4.0` · **Carpeta de progreso**: `docs/progreso/v3.4-comando-visibilidad-a2a-entrante/`.

**No es un hito del Plan.** El Plan termina en el Hito 7. Change standalone con nombre descriptivo **sin prefijo `hito-X.Y`**, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `comando-reporte-comisiones` y `comando-cancelar-solicitud`. **`v3.4.0` es propuesta, no fijada** — depende de que `v3.1.0`/`v3.2.0`/`v3.3.0` cierren en ese orden.

**Numeración verificada, no asumida.** `grep '^### ADR (\d+)'` sobre **todos** los `proposal.md`/`design.md`/`tasks.md` de `openspec/changes/*`: el máximo real es **ADR 133** (`comando-cancelar-solicitud/design.md:126`), no 124 — el change más reciente de esta sesión subió el techo nueve números después de que `comando-reporte-comisiones` lo hubiera subido de 115 a 124. Contra-verificado con un grep de exclusión `ADR (13[4-9]|1[4-9]\d|[2-9]\d\d)`: **cero matches**. `grep 'RD-(6\d|7\d|8\d|9\d|1\d\d)'` sobre `openspec/changes/`: el máximo real es **RD-62** (`comando-cancelar-solicitud/proposal.md:34,155,241`), **cero matches en RD-63 o superior**. Se verificó además el `docs/ARC42_*.md` (sólo tres menciones de `ADR \d+`, la mayor es ADR 90 — no compite). Esta propuesta abre en **ADR 134** y reserva **RD-63 en adelante**. **Migración**: la última en disco es `0011` (`src/adapters/memory/migrations/`), y **ninguno de los tres changes abiertos reserva una** (`comando-reporte-comisiones/proposal.md:49` y `comando-cancelar-solicitud/proposal.md:47` declaran *"cero migraciones"* explícitamente) ⇒ **`0012` está libre**, verificado, no asumido.

> ★ **Corrección de encuadre al brief, y es load-bearing para el ADR 136.** El brief pide *"una función nueva del puerto"*. **No hay puerto.** Verificado por `grep` sobre todo `src/`: `solicitudes_a2a_entrantes` **no tiene ningún `Port` en `src/core/`** — `build-on-a2a-entrante.ts:48-55` importa `createCaso`/`insertSolicitudA2AEntrante`/`actualizarSolicitudA2AEnCurso`/`getSolicitudA2AEntrantePorTaskId`/`cancelarSolicitudA2AEntrante` **directamente de `src/adapters/memory/repository.js`**, y su propio doc-comment (`:8-9`) lo dice textual. Es legal (ese módulo vive en `src/`, no en `core/`, y es un composition root, igual que `build-on-soporte.ts`), pero significa que este change **no extiende un puerto: decide si crear el primero**. Eso lo convierte en la decisión de arquitectura real de la propuesta, no en un trámite (ADR 136).

---

## Intent

**El problema no es hipotético y está documentado con evidencia real, no con una suposición de diseño.**

`docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:128-142` (**Hallazgo 2**) registra un caso ocurrido: con un `SendMessage` en vuelo (tarea `9f27f1fb-…`), la única terminación disponible del proceso en Windows —`taskkill /F`, porque `taskkill` sin `/F` **lo rechaza el propio sistema operativo** (`:138`) y `kill -SIGINT` no alcanza a un `node.exe` nativo (`:137`)— dejó la fila **permanentemente en `TASK_STATE_WORKING`**, sin `resultado` y sin transición a ningún estado terminal. Y no hay red de contención: `rg SIGINT|SIGTERM|SIGBREAK` sobre todo `src/` (`:135`) confirma que **no existe ningún `process.on('SIGINT'/'SIGTERM')` en la aplicación**; el cierre elegante depende exclusivamente de que Ink interprete un `\x03` en modo raw, cosa que **no puede pasar con `stdout` redirigido** (`:134`).

**★ Y acá está el punto fino que hace que este change sea el remedio correcto y no un parche.** El requirement vigente `solicitud-a2a-entrante:45` dice: *"Ningún camino SHALL dejar la fila en `WORKING` **con el proceso todavía vivo**"*. Esa cláusula final no es un descuido: es el alcance honesto de lo que un `finally` puede prometer. El huérfano del Hallazgo 2 **no viola ese requirement — cae exactamente en su punto ciego**, y ningún cambio en el camino de escritura puede cerrarlo, porque el proceso que tendría que escribir ya no existe. Lo único que puede cerrarse desde el lado del arnés es **la ceguera del operador**: hoy, tras un reinicio, un administrador no tiene ninguna vía en el arnés para distinguir *"una tarea está corriendo ahora"* de *"una tarea quedó colgada de la sesión anterior"*. Sólo puede sospechar que algo quedó trabado.

La asimetría de fondo: los otros dos flujos HITL **ya tienen su ventana humana** —`/aprobar-solicitud` sin id lista las pendientes, `/ver-propuesta` sin id lista las propuestas—, y el flujo A2A **saliente** deja rastro consultable. El flujo A2A **entrante**, que es el único donde el arnés le respondió algo a un tercero, es el único a ciegas. Este change no cambia ni una línea del camino de escritura del Hito 7: **agrega el lector que faltaba**.

---

## Scope

### In Scope

- **Descriptor `/ver-solicitudes-a2a [a2aTaskId]`** en `DESCRIPTORES` (`comando-empleado.ts:101-245`), `privilegiado: true` (ADR 138). **Sería el 18.º descriptor** (15 en disco hoy + 1 de `comando-reporte-comisiones` + 1 de `comando-cancelar-solicitud`, ninguno de los dos implementado todavía — ver Dependencies).
- **Una `Forma` nueva, `"id_opcional_a2a"`**, por el criterio ya fijado del **ADR 56**: *"una forma nueva por SHAPE de payload"* (`comando-empleado.ts:75-87`). La clave del payload es `a2aTaskId`, que no es ni `ventaId` (`id_opcional`) ni `solicitudId` (`id_opcional_solicitud`) ni `propuestaId` (`id_opcional_propuesta`). **Se sigue el precedente, no se lo reabre.**
- **Handler `manejarVerSolicitudesA2A`** en `build-on-comando-empleado.ts`, **molde literal de `manejarVerPropuesta`** (`:1113-1128`): un solo paso, sin `await`, sin `confirmacionPendiente`, sin `createCaso`, sin `registrar(...)` (ADR 134).
- **Puerto de núcleo NUEVO, en un archivo NUEVO de `src/core/`** con dos métodos de lectura —listar por estados y obtener por `a2aTaskId`— y su `createSolicitudA2AEntranteStore(db)` del lado del adaptador, molde exacto de `createPropuestaStore` (`build-on-comando-empleado.ts:494`). **Ningún archivo existente de `src/core/` cambia de comportamiento** (ADR 136).
- **Función de listado nueva en `repository.ts`**: `listSolicitudesA2AEntrantesPorEstado(db, { estados, limite? })`, molde de `listPropuestasCambio` (`:2346-2364`) — con su misma lección de eficiencia ya pagada por un Reviewer (`:2334-2344`): **nunca una forma de SQL que fuerce a escanear la tabla entera cuando sí hay con qué acotar**.
- **Migración `0012_idx_solicitudes_a2a_entrantes_estado.ts`**: `CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_estado ON solicitudes_a2a_entrantes(estado);`, más la **corrección del doc-comment de `0011:36-38`**, que este change vuelve falso (R2). Precedente directo de una migración que es **sólo un índice**: `0002_idx_sesiones_caso_agente.ts`.
- **El conjunto "en curso" se DERIVA de `esEstadoTerminal`** (`a2a-contract.ts:74-76`), **sin declarar ninguna lista paralela y sin tocar ese archivo** (ADR 135).
- **Delta de spec sobre `solicitud-a2a-entrante`** — obligatorio, ver Capabilities.

### Out of Scope

- **★ Cancelar una solicitud A2A entrante desde la TUI.** `cancelarSolicitudA2AEntrante` **ya existe y está probada** (`repository.ts:2665-2698`, con sus cuatro ramas del ADR 94), pero **ningún comando humano la expone**: hoy sólo la alcanza `onCancelarTarea` (`build-on-a2a-entrante.ts:308`), es decir, un `CancelTask` JSON-RPC de un tercero. Es un hallazgo colateral **real y anotado**, candidato natural a una propuesta FUTURA (*"cancelar una solicitud A2A entrante desde la TUI"*, que además sería el remedio activo al huérfano del Hallazgo 2). **Este change es de LECTURA PURA y no lo implementa** — se dice acá para que `sdd-tasks` no lo invente y para que el checkpoint lo apruebe o lo rechace a ojos abiertos (mismo criterio que el ADR 11 pto 5 de `hito-1.3-ventas-comisiones`).
- **Barrido de arranque que reconcilie huérfanos** (marcar como `FAILED`/`CANCELED` al bootear toda fila que quedó en `WORKING` de una sesión anterior). Es la otra mitad del Hallazgo 2 y es **escritura**, con su propia pregunta sin responder (¿cómo distingue el barrido un huérfano de una tarea legítimamente en curso de otro proceso?). Va al checkpoint (pregunta 3).
- **Handler `process.on('SIGINT'/'SIGTERM')`.** Es el hallazgo transversal que la propia evidencia recomienda evaluar (`:142`), toca `main.ts` y afecta por igual a A2A, webhooks y web. **No es de este change** y no se resuelve agregando un comando de lectura.
- **★ Mostrar "qué agente externo" delegó la tarea. NO SE PUEDE, y hay que decirlo antes de que se lea como una promesa incumplida.** `agente_externo_url` es NULLABLE y **hoy es siempre `NULL`**, no por un bug sino por decisión formalizada: el protocolo A2A v1.0.0 **no transporta la identidad del emisor** (ADR 89, `0011:14-16`, y el requirement `solicitud-a2a-entrante:67-79` lo declara con un escenario propio). Lo único mostrable es `origen_transporte` —`socket.remoteAddress` o `"desconocido"` (`0011:18-20`)—, que es **una dirección de red, NO una identidad de agente**, y el DDL *"no pretende que lo sea"*. El comando **debe** rotularlo como origen de transporte, nunca como "agente".
- **Filtrar por caso, por fecha o por texto del mensaje.** El comando tiene dos modos y nada más: sin argumento ⇒ las que están en curso; con `a2aTaskId` ⇒ esa. `listSolicitudesA2AEntrantesPorCaso` (`:2701`) ya cubre el volcado por caso para la evidencia de `docs/progreso/`.
- **Tocar el camino de escritura del Hito 7.** Cero cambios en `build-on-a2a-entrante.ts`, `src/adapters/a2a/server.ts`, `insertSolicitudA2AEntrante`, `actualizarSolicitudA2AEnCurso` y `cancelarSolicitudA2AEntrante`.
- **Tocar `src/core/agents/a2a-contract.ts`** (ADR 135). Cero líneas.
- **Dependencias nuevas en `package.json`.** Cero. Undécimo change consecutivo.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Verificado: `hito-3.0-a2a-servidor/specs/` contiene `servidor-a2a-jsonrpc/` y `solicitud-a2a-entrante/`.

### New Capabilities

- **`visibilidad-a2a-entrante`** — el comando nuevo, sus dos modos, la derivación del conjunto "en curso" desde `esEstadoTerminal`, el rótulo honesto de `origen_transporte`, el puerto de lectura nuevo y el índice. Sigue el precedente verificado de que **cada change pone el requirement de su comando nuevo en la spec de SU capability dueña** (`comando-reporte-comisiones/proposal.md:66`, `comando-cancelar-solicitud/proposal.md:58`).

### Modified Capabilities

- **`solicitud-a2a-entrante`** — **delta OBLIGATORIO, y hay que redactarlo con precisión quirúrgica.** Dos requirements se rozan:
  1. **`:29-41`**, *"Cero archivos existentes de `src/core/` modificados en comportamiento"*, con el escenario `git diff --stat main -- src/core/` (`:33-36`) y la excepción de doc-comment sobre `a2a-contract.ts` (`:31`). **Ese requirement está redactado sobre "el composition root nuevo" del Hito 7 y su diff, no como un congelamiento perpetuo de `src/core/`** — pero un Reviewer que lea el escenario literalmente va a marcarlo. El delta debe **acotar el alcance del requirement al camino de escritura del Hito 7**, sin derogarlo. Nótese que el ADR 135 y el ADR 136 están diseñados justamente para que este change **no modifique ni un archivo existente de `src/core/`**: sólo agrega archivos nuevos. El delta documenta esa propiedad; no pide permiso para romperla.
  2. **`:45`**, la cláusula *"con el proceso todavía vivo"*. El delta **no la cambia**: la **complementa** con el requirement nuevo de que el punto ciego que esa cláusula deja abierto sea **observable por un humano**. Es la diferencia entre corregir un requirement y darle la contraparte que le faltaba.

- **`comando-empleado-tui`** — **misma pregunta abierta heredada, ahora en su tercera capa.** El requirement *"Reconocimiento y ruteo de los **ocho** comandos"* (`tui-canal-empleado/specs/comando-empleado-tui/spec.md:23`, `:47`) ya era falso hace cuatro changes (hoy hay quince descriptores en disco). `comando-reporte-comisiones` lo dejó como pregunta 3 de su checkpoint y `comando-cancelar-solicitud` decidió explícitamente **heredar** esa decisión en vez de tomarla de nuevo. **Este change hace exactamente lo mismo**: si el checkpoint mandó corregir el conteo, este change suma uno; si mandó no tocarlo, no lo toca. **No se decide acá por tercera vez.**

---

## Approach

Cinco piezas, **cuatro de ellas por copia de un molde existente y verificado**, y todas aditivas:

1. **Migración** (`0012_idx_solicitudes_a2a_entrantes_estado.ts`) — un `CREATE INDEX IF NOT EXISTS`, molde de `0002`. Más la corrección del doc-comment de `0011:36-38` (R2).
2. **Repositorio** (`repository.ts`) — `listSolicitudesA2AEntrantesPorEstado`, reusando `SOLICITUD_A2A_ENTRANTE_SELECT_COLUMNS` (`:2573`) y `rowToSolicitudA2AEntrante` (`:2576`) que **ya existen**. Cero mapeo nuevo.
3. **Contrato** (archivo NUEVO de `src/core/`) — el puerto de dos métodos de lectura y su tipo de fila del lado del núcleo (ADR 136, RD-64).
4. **Comando** (`comando-empleado.ts`) — descriptor, brazo de la unión `ComandoEmpleado`, `Forma` nueva `"id_opcional_a2a"`, rama en `parsearComando`. Sigue **sin un solo import**.
5. **Handler** (`build-on-comando-empleado.ts`) — `manejarVerSolicitudesA2A` calcado de `manejarVerPropuesta`, más el `createSolicitudA2AEntranteStore(db)` por default en `Deps` (molde de `:288-289` y `:494`), más las dos funciones de formateo.

**El flujo entero, en dos líneas**:
`/ver-solicitudes-a2a` → guard de privilegio (ya existe) → `listarEnCurso(estadosDerivadosDeEsEstadoTerminal)` → tabla de una línea por fila con `a2aTaskId`, `estado`, `origen_transporte`, `created_at`/`updated_at`.
`/ver-solicitudes-a2a <id>` → `obtenerPorTaskId(id)` → detalle, o *"No existe ninguna solicitud A2A `<id>`."* — misma forma exacta que `manejarVerPropuesta:1124-1126`.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 134-138)

### ADR 134: El molde es `/ver-propuesta`, **no** `/consultar-kpi` — y la diferencia es de naturaleza, no de estilo

**Contexto**. Los dos comandos privilegiados más recientes son moldes opuestos, y elegir mal arrastra costo estructural en cascada. Hay que decidir cuál aplica **con un criterio, no con una preferencia**.

**Decisión**. **`manejarVerPropuesta` (`build-on-comando-empleado.ts:1113-1128`) es el molde. `manejarConsultarKpi` no aplica.**

1. **`/consultar-kpi` no es una lectura: es una delegación.** Su doc-comment (`:1131-1159`) enumera lo que hace y ninguna parte le sirve a este comando: `await despacharDelegacionA2A(...)`, un **`createCaso` nuevo por invocación** —obligatorio, porque `delegaciones_a2a.caso_id` es `NOT NULL REFERENCES casos(id)` (`:1142-1143`)—, un `catch` único y explícito sobre todo el bloque *"porque la TUI no puede quedarse sin respuesta"* (ADR 40), y `registrar(RESULTADO_ATENDIDA)`/`RESULTADO_FALLIDA`. **Genera tráfico saliente, costo de modelo y una fila de `delegaciones_a2a` nueva.** `/ver-solicitudes-a2a` **no manda nada a ningún lado**: muestra filas que **ya existen** porque un tercero ya nos habló.
2. **`manejarVerPropuesta` es exactamente la forma que hace falta, y su doc-comment ya escribió el argumento.** `:1103-1107`: *"UN SOLO PASO, de solo lectura — a diferencia de `manejarEscalacion`/`manejarResolucionSolicitud`, esta función NUNCA lee ni escribe `confirmacionPendiente` ni llama `registrar(...)`: **mostrar un patch es una lectura, punto**"*. Mostrar una fila de `solicitudes_a2a_entrantes` es la misma frase con otro sustantivo.
3. **Sin `await`, y eso es una propiedad, no una omisión.** `manejarVerPropuesta` es **síncrona**: `propuestaStore` es un puerto síncrono porque `better-sqlite3` lo es (criterio ya escrito en el ADR 100: *"SÍNCRONA, `better-sqlite3` no necesita `Promise`"*). El puerto nuevo del ADR 136 **debe** ser síncrono por el mismo motivo. Un `async` acá sería una promesa que nunca cede.
4. **Sin confirmación en dos pasos.** La regla del **ADR 36** es *"para escrituras irreversibles con CAS"* (`hito-2.2-a2a-cliente/proposal.md:290`), y `comando-reporte-comisiones` (ADR 119 pto 5) ya la aplicó en este mismo sentido: **una consulta no escribe nada del núcleo**. `confirmacionPendiente` **no gana ninguna rama** — verificable leyendo el tipo, y va a Success Criteria.
5. **★ NO deja fila en `registro_acciones_empleado` — y acá hay una tensión real que hay que decir en voz alta, no esconder.** `manejarVerPropuesta` **no** llama `registrar(...)` (`:1104-1105`), y este comando lo copia. Pero `comando-reporte-comisiones` decidió **lo contrario** para su comando, que también es una lectura local pura (`proposal.md:113`, alineándose con `/consultar-kpi`). Los dos precedentes no se pueden satisfacer a la vez. **Esta propuesta elige `/ver-propuesta`** por identidad de forma —mismo tipo de payload, mismo tipo de salida, mismo `store` de lectura por closures— y porque el criterio que explica los tres casos sin contradicción es *"registra el comando que produce un efecto (tráfico externo, caso nuevo, costo), no el que sólo mira"*. **Si el checkpoint prefiere el criterio de `comando-reporte-comisiones`, es un `registrar(...)` de una línea y RD-67 lo absorbe** — pero entonces conviene armonizar los dos changes de una vez, no acumular una tercera política. Va al checkpoint (pregunta 4).

**Alternativas consideradas**:

- ***Molde `/consultar-kpi`***: **rechazada por el punto 1.** Arrastraría `createCaso` (una fila de `casos` por cada vez que un administrador mira una lista — ruido de auditoría puro), un handler `async` innecesario y un `catch` diseñado para fallas de red que acá no existen.
- ***Molde `manejarResolucionSolicitud` (dos pasos)***: **rechazada por el punto 4.** No hay nada que confirmar: no se escribe.
- ***Dos comandos separados (`/ver-solicitudes-a2a` y `/ver-solicitud-a2a <id>`)***: **rechazada.** Rompería el patrón de *"lista si se omite el id"* que los **cinco** comandos con `id_opcional*` ya comparten (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`, `/ver-propuesta`), y agregaría un descriptor por una diferencia que el payload opcional ya expresa.

### ADR 135: "En curso" se **DERIVA** de `esEstadoTerminal` — cero taxonomía paralela, y `a2a-contract.ts` no se toca

**Contexto**. El comando necesita el conjunto `{SUBMITTED, WORKING}` en dos lugares: en el SQL (`estado IN (…)`) y en la clasificación de la vista. La tentación obvia es declarar `const TASK_STATES_EN_CURSO = [TASK_STATE_SUBMITTED, TASK_STATE_WORKING]`. **Es una taxonomía paralela y hay que rechazarla explícitamente**, porque el arnés ya tiene una fuente de verdad para esa partición.

**Decisión**. **El conjunto se computa como `TASK_STATES_CONOCIDOS.filter((e) => !esEstadoTerminal(e))`. No se declara ninguna lista literal de estados "en curso", y `src/core/agents/a2a-contract.ts` no recibe ni una línea nueva.**

1. **`esEstadoTerminal` ya ES la partición, y su semántica está razonada por escrito.** `a2a-contract.ts:67-76`: `COMPLETED`/`FAILED`/`CANCELED`/`REJECTED` son terminales; `SUBMITTED`/`WORKING` no lo son; **`INPUT_REQUIRED`/`AUTH_REQUIRED` son "terminales DE FRACASO" (ADR 73 pto 2)** — *"esperan una interacción que este hito no construye, y hacer polling sobre ellos sería esperar algo que no llega"*. **Una tarea en `AUTH_REQUIRED` NO está "en curso" pese a que el nombre suene a que sí**, y ése es exactamente el error que una lista literal escrita a mano cometería tarde o temprano.
2. **Derivar hace la regla auto-consistente ante un noveno estado.** Si algún día `TASK_STATES_CONOCIDOS` gana un miembro, la clasificación de este comando se actualiza sola y de forma correcta por construcción. Una lista literal quedaría desactualizada **en silencio** — el peor modo de falla: tipos en verde, comando mintiendo.
3. **★ Y hay una razón estructural fuerte, no sólo de elegancia: no tocar `a2a-contract.ts` es lo que mantiene este change compatible con el requirement `solicitud-a2a-entrante:29-41`.** Ese requirement permite **una sola** excepción sobre ese archivo —*"un cambio de doc-comment puro (sin cambio de comportamiento)"* (`:31`)— y ya fue consumida por el Hito 7. Exportar una constante nueva desde ahí sería un cambio de superficie pública, no un doc-comment. **La derivación evita la colisión sin negociarla.**
4. **El SQL recibe la lista derivada como binds, no como literales hardcodeados.** Nótese que `actualizarSolicitudA2AEnCurso` (`repository.ts:2636`) **sí** tiene `estado IN ('TASK_STATE_SUBMITTED','TASK_STATE_WORKING')` incrustado en el SQL, y `cancelarSolicitudA2AEntrante` (`:2694`) repite los cuatro terminales igual. **No se copia ese patrón**: son código del camino de escritura del Hito 7, fuera de alcance, y duplicar la lista una tercera vez es precisamente lo que este ADR evita. Que ya esté duplicada dos veces es un argumento a favor de no hacerlo una tercera, no un permiso.

**Alternativas consideradas**:

- ***Exportar `TASK_STATES_EN_CURSO` desde `a2a-contract.ts`***: **rechazada por los puntos 3 y 4.** Es la más tentadora (una línea, legible en el sitio de uso) y crea una segunda fuente de verdad que hay que mantener sincronizada con `esEstadoTerminal` a mano, además de rozar el requirement de Hito 7.
- ***Hardcodear `IN ('TASK_STATE_SUBMITTED','TASK_STATE_WORKING')` en el SQL nuevo***, imitando `:2636`: **rechazada.** Metería el vocabulario del protocolo dentro del adaptador SQL, justo lo que el ADR 71 pto 5 rechazó por escrito (`0011:29-31`: *"el vocabulario canónico vive en el núcleo, el SQL no lo conoce"*).
- ***Que el comando liste TODO y el humano filtre con los ojos***: **rechazada.** Convierte el caso de uso del Hallazgo 2 (*"¿quedó algo colgado?"*) en trabajo manual sobre una tabla que crece sin techo, y hace inútil el índice del ADR 137.

### ADR 136: Se crea el **primer puerto de núcleo** de `solicitudes_a2a_entrantes`, en un **archivo nuevo** — no se copia el camino sin puerto de `build-on-a2a-entrante.ts`

**Contexto**. Corrección al brief (ver cabecera): **no existe puerto**. Hay dos precedentes vigentes y opuestos en el repo, los dos legales bajo `AGENTS.md`, y hay que elegir con criterio:
- **(a) `/ver-propuesta`** ⇒ `PropuestaStorePort` en `src/core/propuestas/propuestas-contract.ts`, inyectado como `deps.propuestaStore?` con default `createPropuestaStore(db)` (`build-on-comando-empleado.ts:288-289`, `:494`).
- **(b) `build-on-a2a-entrante.ts`** ⇒ **sin puerto**, importando `repository.js` directo (`:48-55`).

**Decisión**. **Puerto nuevo, molde (a), en un archivo NUEVO de `src/core/` — no dentro de `a2a-contract.ts`.** Dos métodos síncronos de lectura: listar por estados y obtener por `a2aTaskId`.

1. **El precedente (b) es legal por dónde vive el consumidor, no por lo que es.** `build-on-a2a-entrante.ts` está en `src/`, no en `src/core/`, y es un **composition root** — la regla de `AGENTS.md` (*"`src/core/` nunca importa nada de `src/adapters/*`"*) no lo alcanza. **El consumidor de este change es otro**: el handler nuevo vive dentro de `buildOnComandoEmpleado`, cuyo patrón establecido para **todo** store es el puerto opcional inyectable (`registro`, `solicitudStore`, `propuestaStore`, `:285-289`). Copiar (b) sería meter una excepción en un archivo que no la tiene.
2. **El puerto es lo que hace el handler testeable como los otros.** `manejarVerPropuesta` se prueba con un `PropuestaStorePort` falso plano, sin base de datos —`crearStoreFalso`, el molde que `crear-propuesta-cambio.test.ts:25` y `cadena-revision.test.ts:199` ya usan—. Sin puerto, testear el handler nuevo exigiría una `db` real o un `vi.mock` del módulo entero de `repository.js`, que es exactamente lo que `build-on-a2a-entrante.test.ts:6` tuvo que hacer y **declara como concesión** (*"se mockea el módulo ENTERO … la única forma honesta"*). **Con TDD estricto obligatorio, esta diferencia se paga en cada test del change.**
3. **★ Archivo NUEVO, no dentro de `a2a-contract.ts` — por la misma razón del ADR 135 pto 3.** `a2a-contract.ts` ya hospeda `ClienteA2APort`, así que "poner el puerto ahí" es defendible en abstracto. **Pero consumiría la única excepción que el requirement `:31` permite sobre ese archivo**, y encima mezclaría un puerto de **persistencia local** con uno de **transporte saliente** en un archivo cuyo doc-comment se define como *"Vocabulario del protocolo A2A, en sus dos direcciones"* (`:1`). Una tabla local no es vocabulario de protocolo. **Archivo nuevo ⇒ cero archivos existentes de `src/core/` modificados ⇒ el delta de spec sólo documenta una propiedad que se cumple, en vez de pedir una excepción.** El nombre y la ubicación exacta se reservan a `sdd-design` (RD-64).
4. **El tipo de fila del núcleo NO puede ser `SolicitudA2AEntranteRow` ni `SolicitudA2AEntranteVista`.** El primero vive en `src/adapters/memory/repository.ts:2547` y el segundo en `src/adapters/a2a/server.ts:124`: **`src/core/` no puede importar de ninguno de los dos** — regla no negociable de `AGENTS.md`. El puerto necesita su propio tipo, y el adaptador traduce, exactamente como `toPortPropuesta` (`build-on-comando-empleado.ts:481`) ya hace para propuestas. **No es duplicación por descuido: es la dirección de la dependencia.** La forma exacta se reserva a RD-64.

**Alternativas consideradas**:

- ***Sin puerto, importando `repository.js` directo desde el handler***: **rechazada por los puntos 1 y 2.** Es menos código hoy y rompe el patrón del archivo consumidor, además de encarecer cada test.
- ***Reusar `getSolicitudA2AEntrantePorTaskId` directamente y crear puerto sólo para el listado***: **rechazada.** Un puerto con un solo método y una importación directa al lado, para dos lecturas de la misma tabla en el mismo handler, es lo peor de las dos opciones. **El brief acierta en reusar la lógica de `getSolicitudA2AEntrantePorTaskId`** — se reusa **la función del repositorio**, envuelta por el segundo método del puerto. Cero SQL nuevo para el modo detalle.
- ***Meter el puerto en `a2a-contract.ts`***: **rechazada por el punto 3.**

### ADR 137: Migración `0012`, sólo índice sobre `estado` — y el doc-comment de `0011` se corrige en el mismo change

**Contexto**. `solicitudes_a2a_entrantes` tiene **un solo índice**, sobre `caso_id` (`0011:56`), y su doc-comment (`:36-38`) justifica esa unicidad con *"ninguna pantalla ni comando filtra por `estado`"*. Este change es, literalmente, el comando que filtra por `estado`.

**Decisión**. **Migración nueva `0012_idx_solicitudes_a2a_entrantes_estado.ts` con un único `CREATE INDEX IF NOT EXISTS`, y corrección del doc-comment de `0011` en el mismo change.**

1. **Es lo que las otras dos tablas de flujo ya tienen.** `solicitudes_internas` ⇒ `idx_solicitudes_estado` (`0008:59`); `propuestas_cambio` ⇒ `idx_propuestas_estado` (`0009:79`). Ésta es la única de las tres sin él, y deja de ser la única sin listado. **No se está inventando un patrón: se está cerrando la última excepción.**
2. **Hay precedente exacto de una migración que es sólo un índice**: `0002_idx_sesiones_caso_agente.ts`. No hace falta inventar la forma del archivo.
3. **`CREATE INDEX IF NOT EXISTS` es idempotente y aditivo**: sin `ALTER TABLE`, sin backfill, sin reescritura de filas, sin ventana de datos inconsistentes.
4. **★ Y la eficiencia acá no es teórica: el repo ya pagó esta lección con un hallazgo de Reviewer.** `listPropuestasCambio` (`repository.ts:2334-2344`) documenta que envolver `estado = @estado` en `(@estado IS NULL OR …)` **le impide a SQLite usar el índice aunque el bind traiga un valor real**, porque el planner no puede asumirlo en tiempo de `prepare`; la condición se arma **en JS** y sólo entra al SQL cuando el filtro está presente, *"dejando la comparación como una igualdad simple que el índice sí puede resolver con `SEARCH`"* — **verificado con `EXPLAIN QUERY PLAN` en el test de ese archivo**. La función nueva **debe** seguir esa forma. Con un `IN (…)` de aridad variable el detalle es distinto del caso de igualdad simple, así que **`sdd-design` debe verificarlo con `EXPLAIN QUERY PLAN`, no darlo por hecho** (RD-63).
5. **Sin `CHECK` sobre `estado`, y el índice no lo agrega.** `0011:29-31` fijó `TEXT NOT NULL` **sin `CHECK`** a propósito (ADR 71 pto 5). Este change **no reabre** esa decisión: un índice acelera búsquedas, no restringe valores. Consecuencia directa: **una fila puede tener un `estado` que no sea un `TaskState` conocido**, y el comando tiene que comportarse ante eso (RD-66).

### ADR 138: `privilegiado: true` — y el argumento es el contenido de `resultado`, no el del listado

**Contexto**. El comando no escribe nada. Cabe preguntarse si necesita sesión.

**Decisión**. **`privilegiado: true`, mismo criterio literal que `/ver-propuesta`.**

1. **El comentario de `/ver-propuesta` ya escribió el argumento y aplica sin traducción** (`comando-empleado.ts:196-201`): *"`privilegiado: true` aunque no escriba nada: muestra el contenido íntegro de un patch — código propietario del repo … Marcarlo `true` acá ES la implementación: `esComandoPrivilegiado` es la única fuente de verdad que consulta el guard del dispatcher"*.
2. **★ Y el contenido expuesto acá es del mismo orden, o mayor.** `resultado` de una fila `COMPLETED` **es la respuesta real que el arnés le dio a un tercero**, construida por `handleTurn` sobre el Adaptador de Conocimiento — o sea, sobre datos de la empresa. La evidencia manual lo muestra concretamente: una respuesta de 1534 caracteres citando secciones internas del arc42 (`evidencia-verificacion-manual.md:126`, fila `b6d30dee-…`). `mensaje_recibido` es, simétricamente, lo que el tercero nos preguntó. **Un listado de tareas en curso es metadata; el detalle de una `COMPLETED` es contenido.** Como el comando tiene los dos modos, el flag se fija por el más sensible.
3. **`/consultar-kpi` ya usó este mismo criterio como precedente encadenado** (`:228-231`: *"no es una decisión nueva: mismo criterio ya escrito para `/ver-propuesta` arriba"*). Éste es el tercer eslabón de la misma cadena, no una política nueva.
4. **Ninguna categoría nueva en `DescriptorComando`.** Sigue con sus dos flags (`privilegiado`, `secreto`, `:62-73`). No hace falta nada más: **no hay chequeo de dueño acá** (a diferencia de `comando-cancelar-solicitud`, ADR 127) — una solicitud A2A entrante no tiene empleado dueño, tiene un tercero anónimo del que ni siquiera conocemos la identidad (ADR 89).

---

## Affected Areas

| Área | Impacto | Qué cambia |
|---|---|---|
| `src/adapters/memory/migrations/0012_*.ts` | **Nuevo** | Un `CREATE INDEX IF NOT EXISTS` sobre `estado`. Molde de `0002` (ADR 137). **`0012` verificado libre** |
| `src/adapters/memory/migrations/0011_*.ts` | **Doc-comment, no DDL** | `:36-38` (*"Ninguna pantalla ni comando filtra por `estado`"*) deja de ser cierto (R2). **Cero SQL tocado** |
| `src/adapters/memory/migrations/index.ts` | Modificado | Registro de `0012` en la lista de migraciones |
| `src/core/agents/<archivo nuevo>.ts` | **Nuevo (ADR 136, RD-64)** | Puerto de lectura de dos métodos + tipo de fila del núcleo. Sin imports de adaptadores |
| `src/core/agents/a2a-contract.ts` | **★ Sin cambios (ADR 135)** | `esEstadoTerminal` se **usa**, no se modifica ⇒ excepción del requirement `:31` **no consumida** |
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor 18.º, brazo de la unión, `Forma` nueva `"id_opcional_a2a"` (ADR 56), rama de `parsearComando`. Sigue **sin un solo import** |
| `src/build-on-comando-empleado.ts` | Modificado | `manejarVerSolicitudesA2A` (calco de `manejarVerPropuesta:1113-1128`), `createSolicitudA2AEntranteStore(db)` por default, entrada en `Deps`, dos formateadores, rama del switch |
| `src/adapters/memory/repository.ts` | Modificado | `listSolicitudesA2AEntrantesPorEstado`, reusando `SOLICITUD_A2A_ENTRANTE_SELECT_COLUMNS` (`:2573`) y `rowToSolicitudA2AEntrante` (`:2576`). `getSolicitudA2AEntrantePorTaskId` **sin tocar** |
| `src/build-on-a2a-entrante.ts` · `src/adapters/a2a/server.ts` | **★ Sin cambios** | El camino de escritura del Hito 7 no se toca. Cero riesgo de regresión sobre `v3.0.0` |
| `src/core/propuestas/**` · `src/core/solicitudes/**` · `src/core/ventas/**` | **Sin cambios** | Ningún dominio existente consume nada que este change toque |
| `src/adapters/tui/**` | **Sin cambios** | El adaptador TUI sigue sin saber que existen los comandos (ADR 31) |
| `package.json` | **Sin cambios** | Sin dependencias nuevas, sin scripts nuevos |
| `README.md` · `docs/ARC42_*.md` | Modificado | Comando nuevo en la Caja Blanca del Registro de Comandos y en el flujo A2A entrante |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **★ El comando se lee como una promesa de trazabilidad que el protocolo no puede cumplir.** Un administrador que ve *"solicitudes A2A entrantes"* espera saber **quién** las mandó. `agente_externo_url` es **siempre `NULL`** (ADR 89, requirement `:67-79`) y `origen_transporte` es una IP, **no una identidad de agente** (`0011:18-20`) | **Alta — es el riesgo de producto del change** | Está en Out of Scope **explícito**, va al requirement de la spec nueva, y **el formato de salida debe rotular la columna como origen de transporte, nunca como "agente"** (RD-65). Success Criteria tiene un ítem propio que lo verifica |
| **R2** | **El doc-comment de `0011:36-38` queda mintiendo.** Justifica tener un solo índice con *"ninguna pantalla ni comando filtra por `estado`"* — este change lo vuelve falso, y es el archivo que un futuro lector va a consultar para entender por qué hay o no hay índices | **Alta (certeza, si no se corrige)** | Corrección del comentario **en el mismo change**, listada en In Scope y en Success Criteria. Mismo criterio que `comando-cancelar-solicitud` aplicó a `0008:28-29` |
| **R3** | **Colisión de archivo con los otros dos changes abiertos.** `comando-reporte-comisiones` y `comando-cancelar-solicitud` tocan **el mismo array `DESCRIPTORES`**, el mismo comentario de conteo (`:96-99`, *"Los quince descriptores"*) y el mismo switch de `build-on-comando-empleado.ts`. Ninguno de los tres está implementado en disco | **Alta — pero de ORDEN, no de diseño** | Cero lógica compartida entre los tres (uno lee ventas, otro escribe solicitudes internas, éste lee A2A entrante). **El último en mergear rebasa y actualiza el conteo a 18.** Ver Dependencies |
| **R4** | **★ El `IN (…)` no usa el índice y el listado degrada a scan**, justo lo que el hallazgo de Reviewer de `listPropuestasCambio` (`:2334-2344`) enseñó a evitar. Un `IN` de aridad variable no es el caso de igualdad simple que ese comentario resolvió | Media | **RD-63** con obligación explícita de verificar con `EXPLAIN QUERY PLAN` **en un test**, igual que se hizo para `listPropuestasCambio`. La migración del ADR 137 es condición necesaria pero **no suficiente**: la forma del SQL también tiene que dejarlo usar |
| **R5** | **Una fila con `estado` fuera de `TASK_STATES_CONOCIDOS` rompe la clasificación.** `estado` es `TEXT` sin `CHECK` (`0011:29-31`, ADR 137 pto 5) y `SolicitudA2AEntranteRow.estado` es `string` crudo (`:2554`), pero `esEstadoTerminal` **exige un `TaskState`** (`a2a-contract.ts:74`): el narrowing con `esTaskStateConocido` **no es opcional** | Media | **RD-66** decide el comportamiento (¿se muestra rotulada como desconocida? ¿queda fuera del listado "en curso"?). **Nunca un cast a `TaskState` sin narrowing** — sería exactamente el fallo silencioso que el ADR 84 previó para `TASK_STATE_UNSPECIFIED`. Test explícito con una fila de estado basura |
| **R6** | **El delta sobre `solicitud-a2a-entrante:29-41` se lee como una derogación.** Ese requirement dice *"Cero archivos existentes de `src/core/` modificados"* con un escenario `git diff --stat` | Media | Los ADR 135 y 136 están diseñados para que la propiedad **siga siendo cierta**: este change sólo **agrega** archivos a `src/core/`. El delta **acota el alcance** al camino de escritura del Hito 7 sin derogar nada. Success Criteria incluye el `git diff --stat main -- src/core/` como verificación mecánica |
| **R7** | **Listado sin techo.** `solicitudes_a2a_entrantes` crece con cada solicitud de terceros y no tiene poda. Un listado sin `LIMIT` podría volcar cientos de filas a la TUI | Baja-Media | El modo por defecto filtra por **en curso**, que es un conjunto naturalmente chico. Aun así, `LIMITE_LISTADO_PROPUESTAS_DEFAULT = 20` (`:2325`) es el precedente y **RD-63** fija el techo y qué se dice al truncar |
| **R8** | **`resultado` largo desborda la TUI.** Es texto libre de un turno completo (1534 caracteres en la evidencia real, `:126`) | Baja | Precedente resuelto: `formatearResumenPropuesta` (`:1090-1099`) pagina con `LINEAS_PAGINA_PATCH` y anuncia *"…mostrando las primeras N de M líneas…"*. **RD-65** decide si se copia tal cual |

---

## Rollback Plan

**Aditivo, y reversible borrando código — con una sola asimetría honesta: el índice.**

Quitar el descriptor, el brazo de la unión, la `Forma` `"id_opcional_a2a"`, la rama de `parsearComando`, el handler y sus formateadores, la entrada de `Deps`, `createSolicitudA2AEntranteStore`, el archivo nuevo del puerto y `listSolicitudesA2AEntrantesPorEstado`. `parsearComando("/ver-solicitudes-a2a …")` vuelve a caer en `ayudaDesconocido` (el sumidero del ADR 34) y **los demás comandos se comportan byte por byte igual**, porque este change **no modifica ni una función existente**: sólo agrega.

**El camino de escritura del Hito 7 es inmune por construcción.** `build-on-a2a-entrante.ts`, `src/adapters/a2a/server.ts`, `insertSolicitudA2AEntrante`, `actualizarSolicitudA2AEnCurso`, `cancelarSolicitudA2AEntrante` y `getSolicitudA2AEntrantePorTaskId` **no se tocan**, así que revertir este change no puede regresionar `v3.0.0`. Es la propiedad más valiosa del rollback y sale gratis de que el change sea de lectura pura.

**El índice: se deja quieto, y hay que decir por qué.** `idx_solicitudes_a2a_entrantes_estado` **sobrevive al revert**: las migraciones son forward-only en este arnés (no hay `down`), y quitarlo exigiría una migración `0013` que dropee lo que `0012` creó — más movimiento que el que ahorra. **Un índice huérfano no corrompe nada**: no restringe valores (no hay `CHECK`), no cambia resultados de ninguna query y su único costo es unos kilobytes y una escritura marginal por `INSERT`/`UPDATE` sobre `estado`. **Preferir dejarlo quieto antes que encadenar una migración de reversión** es el mismo criterio que `comando-cancelar-solicitud` aplicó a sus filas huérfanas: *"reescribir estado histórico para que encaje en un tipo es peor que un valor huérfano"*.

**Cero filas nuevas que revertir.** El comando no escribe: no hay `registro_acciones_empleado` que limpiar (ADR 134 pto 5), no hay `casos`, no hay nada persistido con formato nuevo. **Éste es el rollback más limpio de los cuatro changes abiertos.**

A nivel git: revertir los commits de `hito/v3.4-comando-visibilidad-a2a-entrante` antes del merge a `main`. Es una TUI local: se reinicia el proceso, no hay deploy.

---

## Dependencies

- **`v3.0.0` (Hito 7, Servidor A2A entrante) cerrado y en `main`** — **gate duro y verificado presente**: `0011_solicitudes_a2a_entrantes.ts`, `repository.ts:2487-2714`, `build-on-a2a-entrante.ts`, `src/adapters/a2a/server.ts`. Sin la tabla no hay nada que leer. Es la única dependencia técnica real del change.
- **★ `comando-reporte-comisiones` y `comando-cancelar-solicitud` — dependencia de ORDEN, no de diseño (R3).** Los tres changes están abiertos, **ninguno implementado en disco** (verificado: `DESCRIPTORES` tiene 15 entradas hoy), y los tres tocan `comando-empleado.ts` y el switch de `build-on-comando-empleado.ts` **sin compartir una sola función**. **No hay gate duro en ninguna dirección**: se pueden implementar en cualquier orden, pero **no en paralelo sobre ramas que se mergeen sin rebase**. **El último en mergear rebasa y actualiza el comentario de conteo a 18** (`:96-99`, `:248-251` — son **dos** comentarios con el mismo texto, ambos hay que tocar). Éste es, además, el único de los tres que agrega una **migración**, así que si otro change abriera una `0012` en el ínterin, este change toma `0013` — verificar al implementar, no al planificar.
- **Relación con `definicion-skills` (`v3.1.0`): NINGUNA.** Ese change toca `src/core/skills/`, `invoke-model.ts`, `bootstrap.ts` y `.claude/`. Cero archivos en común.
- **Checkpoint humano de `AGENTS.md`** aprobando esta propuesta —en particular **ADR 136** (crear el primer puerto de núcleo de esta tabla) y **ADR 134 pto 5** (no registrar auditoría, en tensión con `comando-reporte-comisiones`)— antes de `sdd-spec`/`sdd-design`.

---

## Success Criteria

- [ ] `/ver-solicitudes-a2a` está en `DESCRIPTORES` con `privilegiado: true`, y un test afirma `esComandoPrivilegiado("ver_solicitudes_a2a") === true`.
- [ ] `parsearComando` sigue **sin un solo import**, y un test afirma que `Forma` pasa de cinco a **seis** miembros con `"id_opcional_a2a"` (ADR 56).
- [ ] **Sin argumento**, el comando lista **exactamente** las filas en `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING`. Un test con las **ocho** filas de `TASK_STATES_CONOCIDOS` verifica que aparecen dos y **que `INPUT_REQUIRED` y `AUTH_REQUIRED` NO aparecen** (ADR 73 pto 2 — el borde que una lista escrita a mano erraría).
- [ ] **★ El conjunto "en curso" se DERIVA de `esEstadoTerminal`** (ADR 135): un test afirma que la lista derivada es exactamente `[SUBMITTED, WORKING]` y **que no existe ninguna constante literal de estados "en curso" en el código nuevo**.
- [ ] **`git diff --stat main -- src/core/agents/a2a-contract.ts` está vacío** (ADR 135 pto 3) — verificable en el diff, y la excepción del requirement `:31` queda **sin consumir**.
- [ ] **Con `a2aTaskId`**, el detalle sale de `getSolicitudA2AEntrantePorTaskId` **sin SQL nuevo** (ADR 136), y un id inexistente responde con la forma de `manejarVerPropuesta:1124-1126`, no con un throw.
- [ ] **★ Ni el listado ni el detalle rotulan `origen_transporte` como "agente" ni prometen identidad del emisor** (R1), y un test afirma que una fila con `agente_externo_url = NULL` —o sea, **todas**— no imprime un valor inventado ni una cadena vacía engañosa.
- [ ] **El handler es SÍNCRONO, sin `await`, sin `createCaso`, sin `confirmacionPendiente` y sin `registrar(...)`** (ADR 134). `confirmacionPendiente` **no gana ninguna rama** — verificable leyendo el tipo.
- [ ] **El listado usa el índice**: un test con `EXPLAIN QUERY PLAN` afirma `SEARCH` (no `SCAN`) sobre `solicitudes_a2a_entrantes`, mismo estándar de prueba que `listPropuestasCambio` (R4, ADR 137 pto 4).
- [ ] **Una fila con `estado` fuera de `TASK_STATES_CONOCIDOS` no rompe el comando** y se comporta según RD-66, **sin ningún cast a `TaskState` sin `esTaskStateConocido`** (R5).
- [ ] **`src/build-on-a2a-entrante.ts` y `src/adapters/a2a/server.ts` no tienen ni una línea modificada** — verificable en el diff. Los tests del Hito 7 (`build-on-a2a-entrante.test.ts`, `a2a-server.integration.test`) pasan **sin modificarse**.
- [ ] **Migración `0012` aplicada e idempotente**: correrla dos veces no falla (`IF NOT EXISTS`), y el doc-comment de `0011:36-38` queda **consistente** con la realidad (R2).
- [ ] Delta de `solicitud-a2a-entrante` que **acota sin derogar** el requirement `:29-41` y **complementa** el `:45` con la contraparte de observabilidad (R6), más spec nueva de `visibilidad-a2a-entrante`.
- [ ] `/ayuda` lista el comando nuevo con su `uso` de una línea, **sin código nuevo** (sale de `formatearAyuda`), y los **dos** comentarios de conteo de descriptores quedan en 18 (o en el número que resulte del orden de merge, R3).
- [ ] **Cero dependencias nuevas**, `npm test` y `npm run typecheck` en verde.
- [ ] **TDD estricto** (red → green → refactor) en el parser, el puerto, la función de repositorio, la derivación de estados y el handler — todo lógica de negocio, sin excepción aplicable.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v3.4-comando-visibilidad-a2a-entrante/` con evidencia manual (**incluida la demostración de que una fila huérfana en `WORKING` se vuelve visible** — el caso del Hallazgo 2), tag `v3.4.0`.

---

## Qué necesita el checkpoint humano

1. **★ El brief pedía "una función nueva del puerto", y no hay puerto.** Verificado: `build-on-a2a-entrante.ts:48-55` importa `repository.js` **directo**, sin ninguna abstracción de núcleo. Este change no extiende un puerto — **decide crear el primero** (ADR 136), en un **archivo nuevo** de `src/core/` para no consumir la única excepción que el requirement de Hito 7 permite sobre `a2a-contract.ts`. La alternativa barata (importar el repositorio directo, como hace el módulo A2A) es defendible y **te la dejo explícita**: cuesta menos hoy, rompe el patrón de `buildOnComandoEmpleado` y encarece cada test bajo TDD estricto. **Si preferís la vía sin puerto, decilo ahora** — después de `sdd-design` es rework.
2. **La motivación es real y está documentada, pero el remedio es parcial y quiero que quede claro.** El huérfano en `WORKING` del Hallazgo 2 (`evidencia-verificacion-manual.md:140`) **no viola** el requirement `:45`, que dice *"con el proceso todavía vivo"* — cae en su punto ciego, y ningún cambio de escritura puede cerrarlo. **Este change hace el problema VISIBLE, no lo arregla.** Un administrador va a poder ver la fila colgada; no va a poder hacer nada con ella desde el arnés.
3. **★ Y ésa es la pregunta que abro deliberadamente: ¿querés el remedio activo, y en qué orden?** Hay **dos** candidatos, los dos fuera de alcance acá: (a) exponer `cancelarSolicitudA2AEntrante` —que **ya existe y está probada**, `repository.ts:2665-2698`, y hoy sólo la alcanza un tercero vía `CancelTask`— con un comando humano; (b) un barrido de arranque que reconcilie huérfanos. **Este change es el prerequisito honesto de los dos**: sin un lector, cualquier acción correctiva sería a ciegas. Pero si querés (a) ya mismo, decime y se planifica como un change hermano, no como un scope creep de éste.
4. **Tensión de política de auditoría entre changes hermanos, y no la puedo resolver sola.** `/ver-propuesta` **no** registra fila; `comando-reporte-comisiones` decidió que su comando **sí**, aunque también es una lectura local pura. Esta propuesta elige **no registrar** (ADR 134 pto 5), con el criterio *"registra el que produce un efecto, no el que sólo mira"*. Si preferís el criterio contrario, es un `registrar(...)` de una línea (RD-67) — **pero entonces conviene armonizar los dos changes de una vez** en vez de dejar tres políticas distintas conviviendo.
5. **R1, la promesa que el protocolo no puede cumplir.** El comando **nunca** va a poder decir qué agente externo delegó la tarea: A2A v1.0.0 no transporta esa identidad (ADR 89) y `agente_externo_url` es siempre `NULL`. Lo único mostrable es una IP. **¿Te alcanza, o el valor real del comando dependía de saber quién nos habló?** Si es lo segundo, este change no es lo que necesitás y conviene saberlo antes de implementarlo.
6. **R3, orden de implementación.** Tres changes abiertos tocan `DESCRIPTORES` y el switch, sin compartir lógica. ¿En qué orden van? El último rebasa y deja el conteo en 18. Éste es además el único que trae migración: si otro abriera `0012` primero, éste toma `0013`.
7. **Numeración y versión.** `v3.4.0` es propuesta y depende de que `v3.1.0`/`v3.2.0`/`v3.3.0` cierren en ese orden. **ADR 134-138 y RD-63-67** salen de un techo verificado en **ADR 133** / **RD-62**, con greps de exclusión en cero.

## Decisiones reservadas para `sdd-design` (RD-63 en adelante)

| RD | Qué | Por qué no se decide acá |
|---|---|---|
| **RD-63** | **Firma exacta de `listSolicitudesA2AEntrantesPorEstado`**: ¿`estados: readonly string[]` o `readonly TaskState[]`? ¿`limite` con default (`LIMITE_LISTADO_PROPUESTAS_DEFAULT = 20` es el precedente) y qué se dice al truncar? ¿Orden `created_at` ASC como `listSolicitudesA2AEntrantesPorCaso` (`:2710`), o `updated_at` DESC —que es lo que un operador buscando huérfanos quiere ver primero—? **Y la verificación con `EXPLAIN QUERY PLAN` de que el `IN` de aridad variable usa el índice** (R4) | El ADR 137 fija **que hay índice** y **que la forma del SQL no puede impedir usarlo**; la bajada a firma exige mirar cómo `listPropuestasCambio` arma `estadoClausula` en JS (`:2350`) y comprobar si el mismo truco aplica a un `IN`. Esta fase no baja a firmas |
| **RD-64** | **Ubicación y nombre exactos del archivo nuevo del puerto** (¿`src/core/agents/a2a-entrante-contract.ts`? ¿otro directorio?), **nombres de los dos métodos**, y **forma del tipo de fila del núcleo**: ¿espejo de `SolicitudA2AEntranteRow` (`:2547`), o más chico si el comando no necesita todas las columnas? | El **ADR 136 ya fijó la decisión de arquitectura** (puerto nuevo, archivo nuevo, no dentro de `a2a-contract.ts`). Esto es la bajada a firmas, y exige decidir qué traduce `toPort…` — molde de `toPortPropuesta` (`build-on-comando-empleado.ts:481`) |
| **RD-65** | **Formato exacto de las dos salidas.** Listado: qué columnas y en qué orden, **con el rótulo honesto de `origen_transporte`** (R1). Detalle: si `resultado` y `mensaje_recibido` se paginan como el patch de `formatearResumenPropuesta` (`:1090-1099`, con su nota *"…mostrando las primeras N de M líneas…"*) y con qué tope (R8) | Es diseño de presentación con una restricción dura **ya fijada** por el ADR 138 y R1 (nunca rotular una IP como identidad de agente). El tope de líneas se decide con el formateador de propuestas al lado, no en abstracto |
| **RD-66** | **Qué hace el comando con una fila cuyo `estado` NO está en `TASK_STATES_CONOCIDOS`** (R5): ¿queda fuera del listado "en curso" y sólo se ve por id? ¿Se muestra rotulada como estado desconocido? La restricción dura: **`esEstadoTerminal` exige `TaskState`, así que hay `esTaskStateConocido` obligatorio antes — nunca un cast** | `estado` es `TEXT` sin `CHECK` por decisión del ADR 71 pto 5 y este change **no la reabre** (ADR 137 pto 5). El comportamiento correcto depende de cómo se ordene el narrowing dentro del formateador, que es diseño de función |
| **RD-67** | **Si el comando registra fila en `registro_acciones_empleado`** — reservado **sólo si el checkpoint revierte el ADR 134 pto 5**. Incluye la constante `COMANDO_VER_SOLICITUDES_A2A` en `registro-acciones-contract.ts` y su `resultado` | La propuesta **decide que no** (molde `/ver-propuesta`). Queda reservado porque `comando-reporte-comisiones` decidió lo contrario para un comando comparable, y la armonización es del humano (pregunta 4). **Sin migración en ningún caso**: `comando` es `TEXT` sin `CHECK` (`0005:48`) |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió **sin herramienta de shell disponible** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), así que no se pudo invocar el binario — misma limitación ya documentada por las propuestas de Hito 3, Hito 4, `definicion-skills`, `comando-reporte-comisiones` y `comando-cancelar-solicitud`. Se compensó verificando **cada** afirmación contra archivo y línea: `src/adapters/memory/migrations/0011_solicitudes_a2a_entrantes.ts` (completo), `src/core/agents/a2a-contract.ts:1-95`, `src/adapters/memory/repository.ts:2325-2364` y `:2540-2714`, `src/build-on-a2a-entrante.ts:1-120` (**que desmiente la premisa del brief sobre la existencia de un puerto**), `src/build-on-comando-empleado.ts:1090-1159` y los `grep` de `propuestaStore|PropuestaStorePort` sobre ese archivo y sobre `src/core/`, `src/core/commands/comando-empleado.ts:55-253` (**conteo real: quince descriptores en disco**), `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md:29-83` (**la cláusula "con el proceso todavía vivo" del `:45`, que es el eje del Intent**), `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:118-142` (Hallazgo 2 completo), `openspec/changes/comando-cancelar-solicitud/proposal.md` (completo, molde de formato), `AGENTS.md` (completo), el listado de `src/adapters/memory/migrations/*.ts` (**última en disco: `0011`**) y los greps de reserva de migración sobre los tres changes abiertos, más los cuatro greps de numeración que fijan los techos en **ADR 133** y **RD-62** (dos de detección, dos de exclusión con cero matches, más el control sobre `docs/ARC42_*.md`). Se recomienda que `sdd-design` ejecute `graphify explain` sobre `manejarVerPropuesta`, `listPropuestasCambio` y `esEstadoTerminal`, `graphify path "comando-empleado" "solicitudes_a2a_entrantes"`, y `graphify update .` una vez implementado.
