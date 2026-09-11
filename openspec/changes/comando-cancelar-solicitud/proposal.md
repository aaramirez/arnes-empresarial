# Propuesta: `/cancelar-solicitud [solicitudId]` — el solicitante retira su propia solicitud pendiente (v3.3.0)

**Origen**: `openspec/changes/hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md:72-74`, el requirement *"Cualquier empleado autenticado puede resolver (sin jerarquía de aprobación)"*. Hoy el flujo de solicitud interna tiene **alta** (`/solicitar`) y **decisión ajena** (`/aprobar-solicitud`/`/rechazar-solicitud`), pero **no tiene retirada por el propio autor**. Un empleado que pidió vacaciones mal cargadas no tiene ninguna vía en el arnés para deshacerlo: depende de que un tercero se la rechace.

**Rama prevista**: `hito/v3.3-comando-cancelar-solicitud` · **Tag de cierre**: `v3.3.0` · **Carpeta de progreso**: `docs/progreso/v3.3-comando-cancelar-solicitud/`.

**No es un hito del Plan.** El Plan termina en el Hito 7. Change standalone con nombre descriptivo sin prefijo `hito-X.Y`, mismo tratamiento que `tui-canal-empleado`, `definicion-skills` y `comando-reporte-comisiones`. **`v3.3.0` es propuesta, no fijada** — depende de si `v3.1.0`/`v3.2.0` cierran en ese orden.

**Numeración verificada, no asumida.** `grep '^### ADR \d+'` sobre **todos** los `proposal.md`/`design.md`/`tasks.md` de `openspec/changes/*`: el máximo real es **ADR 124** (`comando-reporte-comisiones/design.md:95`), no 115 ni 120 — el change más reciente de esta sesión subió el techo nueve números. `grep 'RD-\d+'` sobre **todo el repo** (`openspec/` + `docs/` + `src/`): el máximo real es **RD-58** (`comando-reporte-comisiones/design.md:95`, `proposal.md:258`). Contra-verificado con dos greps de exclusión (`ADR (12[5-9]|1[3-9][0-9])` y `RD-(59|[6-9][0-9]|[1-9][0-9][0-9])`) sobre la raíz del repo: **cero matches**. Esta propuesta abre en **ADR 125** y reserva **RD-59 en adelante**.

> ★ **Corrección de hecho a la fase de exploración, y es load-bearing.** El brief de exploración afirmó que `MotivoNoAplicableHitl` *"es usada también por `resolver-escalacion-reembolso.ts` del dominio de ventas"*. **Es falso, verificado por `grep`**: ventas declara su **propio** `MotivoNoAplicable = "no_encontrada" | "cas"` (`resolver-escalacion-reembolso.ts:43`) y **no importa nada de `hitl-contract.ts`**. El propio `hitl-contract.ts:36-38` lo dice textual: *"`ResolverEscalacionResult` (ventas) NO se toca ni se redefine como alias de este tipo — quedan estructuralmente idénticos y duplicados a propósito (ADR 50, punto 4)"*. El blast radius real del tipo compartido es **propuestas**, no ventas. Esto **no achica** la decisión del ADR 126: la reorienta, y de hecho le da su argumento más fuerte (ver ADR 126, punto 3).

---

## Intent

El flujo de solicitud interna tiene un agujero de simetría que no es cosmético: **el autor de una solicitud es el único actor del flujo sin ninguna acción sobre ella.** Puede crearla (`/solicitar`, `privilegiado: true`, `comando-empleado.ts:166-173`) y después queda como espectador. Cualquier *otro* empleado autenticado puede aprobarla o rechazarla — el requirement de `solicitud-interna-hitl:72` lo permite explícitamente, *"sin verificar jerarquía, rol de aprobador ni relación con el solicitante"*.

La consecuencia práctica: una solicitud cargada por error (tipo equivocado, detalle mal tipeado, vacaciones que ya no se van a tomar) **sólo se saca del medio molestando a un tercero para que la rechace**. Y un rechazo no es lo mismo que un retiro: deja `estado = 'rechazada'` y `resuelta_por = <el tercero>`, o sea, un registro de auditoría que dice que alguien negó algo que en realidad nadie llegó a pedir en serio.

Hay además una razón de forma, y es la que hace este change barato: **el molde ya está construido tres veces y parametrizado una.** `resolverSolicitudTransaccional` (`repository.ts:2115-2165`) es una función privada parametrizada por `{estadoOrigen, estadoDestino, estadoCaso, comando, resultado}` que `aprobarSolicitudInterna` y `rechazarSolicitudInterna` (`:2168-2193`) ya comparten — **son ocho líneas cada una, cero SQL propio**. Cancelar es una tercera llamada al mismo privado. El comentario del propio archivo (`:2107-2113`) explica por qué esa transacción es correcta, y el argumento no cambia por el estado destino.

---

## Scope

### In Scope

- **Descriptor `/cancelar-solicitud [solicitudId]`** en `DESCRIPTORES` (`comando-empleado.ts:101-245`), `privilegiado: true` (ADR 127), **reusando la forma existente `id_opcional_solicitud`** (`:87`, ADR 56). **El parser no gana una `Forma` nueva** — a diferencia de `comando-reporte-comisiones`, acá el SHAPE de payload (`{ solicitudId }`) ya existe.
- **Cuarto valor de estado**: `SOLICITUD_ESTADO_CANCELADA = "cancelada"` en `solicitudes-contract.ts:41-47`, y su lugar en la unión `SolicitudEstado`.
- **Tercera acción**: `ACCION_CANCELAR_SOLICITUD` en `AccionSolicitud` (`resolver-solicitud-interna.ts:36-38`) y su rama en `aplicarCas` (`:56-64`).
- **Método `cancelarSolicitud`** en `SolicitudStorePort` (`solicitudes-contract.ts:98-107`), implementado como **tercera llamada** a `resolverSolicitudTransaccional` con `{estadoOrigen: "pendiente_aprobacion_humana", estadoDestino: "cancelada", estadoCaso: "resuelto", comando: "/cancelar-solicitud", resultado: "cancelada"}`.
- **★ El chequeo de dueño (`solicitud.solicitanteId !== sesion.empleadoId`), que es lógica NUEVA de punta a punta** — no existe ningún precedente en `src/core/` (ADR 126). Vive **dentro** del caso de uso, no en el guard genérico.
- **Constantes de registro**: `COMANDO_CANCELAR_SOLICITUD = "/cancelar-solicitud"` y `RESULTADO_CANCELADA = "cancelada"` en `registro-acciones-contract.ts:8-34` (RD-62).
- **Confirmación en dos pasos**, reusando la rama `dominio: "solicitud"` de `confirmacionPendiente` **sin ampliarla** (ADR 128).
- **Delta de spec sobre `solicitud-interna-hitl`** — obligatorio, ver Capabilities. El requirement `:72` deja de ser literalmente cierto.
- **Actualización del comentario de `0008_solicitudes_internas.ts:28-29`** (*"`resuelta_por`/`resuelta_at` … sólo las escribe el CAS de `/aprobar-solicitud`/`/rechazar-solicitud`"*), que este change vuelve falso (R2).

### Out of Scope

- **★ Cancelar una solicitud ya `APROBADA` o `RECHAZADA`.** Decisión del humano, formalizada en el **ADR 125** con su alternativa descartada.
- **Des-cancelar / reabrir una solicitud cancelada.** No hay `/reabrir-solicitud`, y este change no lo inventa. Nótese la asimetría deliberada con ventas, que **sí** tiene `/reabrir-reembolso` (`comando-empleado.ts:156-164`): ahí el reabrir existe porque el rechazo lo decide un tercero y puede ser un error suyo. Acá la cancelación la decide el propio dueño sobre su propia solicitud — el remedio a una cancelación equivocada es `/solicitar` de nuevo, que cuesta un comando y no arrastra estado.
- **Modelo de roles o permisos de empleado.** Sigue sin existir: `SesionEmpleado` es `{empleadoId, iniciadaEn, expiraEn?}` (`auth/sesion.ts:11-17`), `credenciales_empleado` no tiene columna de rol, y `esComandoPrivilegiado` (`comando-empleado.ts:262-264`) sólo exige sesión vigente. **"Validador" es convención de negocio, no algo que el código haga cumplir** — hoy cualquier empleado autenticado puede aprobar cualquier solicitud, incluida la propia. Este change **no cierra ese agujero** (ADR 127 pto 4).
- **Extender el chequeo de dueño a `/aprobar-solicitud`/`/rechazar-solicitud`** (p. ej. "no podés aprobar tu propia solicitud"). Es tentador y es una feature distinta: derogaría el requirement `solicitud-interna-hitl:72` en vez de acotarlo. Se reporta al checkpoint (pregunta 3).
- **Notificación al validador** de que una solicitud que tenía en la lista desapareció. No hay `NotifierPort` de solicitudes en el repo.
- **Tocar `MotivoNoAplicableHitl`** (ADR 126). Cero cambios en `hitl-contract.ts`, cero impacto sobre `propuestas`.
- **Migraciones de base de datos.** Cero — `estado` es `TEXT NOT NULL` **sin `CHECK`** (`0008:49`), criterio explícito del propio archivo (`:19-22`). Tercer change consecutivo sin migración.
- **Dependencias nuevas en `package.json`.** Cero. Décimo change consecutivo.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`.

### New Capabilities

- **`cancelacion-solicitud-interna`** — el comando nuevo, su chequeo de dueño, su restricción a `PENDIENTE`, su confirmación en dos pasos y su fila de auditoría. Sigue el precedente verificado de que **cada change pone el requirement de su comando nuevo en la spec de SU capability dueña** (`comando-reporte-comisiones/proposal.md:66`, con los tres precedentes de Hito 5 / 5.1 / 6 citados).

### Modified Capabilities

- **`solicitud-interna-hitl`** — **delta OBLIGATORIO, y no es una formalidad.** Dos requirements dejan de ser literalmente ciertos:
  1. **`:72-74`**, *"Cualquier empleado autenticado puede resolver … sin verificar jerarquía, rol de aprobador **ni relación con el solicitante**"*. Este change introduce **la primera verificación de relación con el solicitante del sistema entero**. El delta tiene que **acotar sin derogar**: el requirement sigue valiendo tal cual para `/aprobar-solicitud`/`/rechazar-solicitud`; `/cancelar-solicitud` es la excepción, y hay que escribirla como excepción explícita, no dejar que se lea como contradicción.
  2. **`:43-45`** (los dos comandos privilegiados con confirmación en dos pasos) — pasa a haber un tercero, con el mismo patrón pero distinto sujeto autorizado.
  El vocabulario de `SolicitudEstado` también cambia (tres valores → cuatro), y eso es superficie de spec, no de implementación.

- **`comando-empleado-tui`** — **misma pregunta abierta que dejó `comando-reporte-comisiones`, ahora compuesta.** El requirement *"Reconocimiento y ruteo de los ocho comandos"* (`tui-canal-empleado/specs/comando-empleado-tui/spec.md:23`, `:47`) ya es falso desde hace **cuatro** changes. Si el checkpoint decidió corregirlo en `comando-reporte-comisiones` (su pregunta 3), este change **hereda** esa decisión y suma un comando al conteo; si decidió no tocarlo, este change tampoco lo toca. **No se decide acá dos veces** — se decide una vez, allá, y acá se acata.

---

## Approach

Cuatro piezas, **todas por extensión de un molde parametrizado que ya existe**, más una que es genuinamente nueva:

1. **Storage** (`repository.ts`) — `cancelarSolicitudInterna`, ocho líneas, tercera llamada a `resolverSolicitudTransaccional`. **Cero SQL nuevo, cero transacción nueva, cero migración.** El `estadoOrigen: "pendiente_aprobacion_humana"` del CAS es, además, **la primera de las dos cerraduras estructurales del ADR 125**.
2. **Contrato** (`solicitudes-contract.ts`, `registro-acciones-contract.ts`) — cuarto `SolicitudEstado`, método en el puerto, dos constantes de vocabulario. Ambos archivos siguen sin imports de adaptadores.
3. **Caso de uso** (`resolver-solicitud-interna.ts`) — tercera `AccionSolicitud`, tercera rama en `aplicarCas`, **y el chequeo de dueño**. Éste es el único trabajo conceptualmente nuevo del change (ADR 126).
4. **Handler** (`build-on-comando-empleado.ts`) — **posiblemente cero líneas de lógica nueva.** `manejarResolucionSolicitud` (`:976-1034`) ya es genérico sobre `accion: AccionSolicitud`: arma y compara `confirmacionPendiente` con `accion` incluido en la clave (`:998`), y su mensaje de éxito (`:1032-1034`) ya es genérico —`` `Listo: la solicitud ${solicitudId} quedó ${resultado.estadoFinal}.` ``— o sea que **con `estadoFinal = "cancelada"` funciona tal cual, sin tocarse**. Lo que sí hay que agregar: la entrada `/cancelar-solicitud` en el mapa `ACCION_SOLICITUD_COMANDO` (`:1043`) y la rama de respuesta del resultado "no sos el dueño".

**El flujo entero, en una línea**: `/cancelar-solicitud S-7` → guard de privilegio (ya existe) → `listarSolicitudesPendientes({solicitudId})` (**cerradura 1: sólo devuelve pendientes**) → chequeo de dueño (**nuevo**) → eco de confirmación → segundo `/cancelar-solicitud S-7` → CAS `WHERE estado = 'pendiente_aprobacion_humana'` (**cerradura 2**) → `cancelada` + caso `resuelto` + fila de auditoría, en una transacción.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 125-128)

### ADR 125: Sólo se cancela una solicitud `PENDIENTE` — y el alcance ya está garantizado por DOS cerraduras estructurales que existen hoy

**Contexto**. Decisión ya tomada por el humano; este ADR la formaliza con su argumento y su alternativa descartada, para que `sdd-tasks` no la reinterprete y para que el próximo lector no la lea como un olvido.

**Decisión**. **`PENDIENTE` es el único estado de origen. Una vez que el validador aprobó o rechazó, la solicitud no se retira — sin excepción y sin un segundo estado de origen.**

1. **Y el punto más fuerte: no hay que construir casi nada para garantizarlo.** El alcance queda cerrado por **dos cerraduras estructurales independientes que ya están en el repo**:
   - **Cerradura 1, el lector.** `listarSolicitudesPendientes` es el **único** lector de solicitudes del puerto (`solicitudes-contract.ts:92-96`) y filtra `estado = SOLICITUD_ESTADO_PENDIENTE` por diseño — el ADR 38 de `v1.4.0` lo dejó escrito textual: *"nunca un lector por id sin filtro de estado"*. Una solicitud ya aprobada **no es alcanzable** desde el caso de uso: `resolver-solicitud-interna.ts:108-118` devuelve `no_aplicable` antes de llegar a ninguna escritura.
   - **Cerradura 2, el CAS.** `resolverSolicitudTransaccional` compara `AND estado = @estadoOrigen` dentro del `UPDATE` (`repository.ts:2134-2135`), y si no matchea devuelve `undefined` **sin tocar el caso ni escribir la fila** (`:2146-2148`).
   Entre las dos, *"cancelar una solicitud aprobada"* no es un caso que haya que rechazar con un `if`: es un caso **inexpresable**, y lo era antes de este change. La decisión del humano no agrega una restricción — **reconoce una que el diseño de `v1.4.0`/Hito 5 ya había fijado**, y se niega a construir la vía para saltearla.
2. **Semánticamente es lo correcto, no sólo lo barato.** `estadoCaso: "resuelto"` significa que el caso HITL **ya cerró**. Cancelar algo cerrado no es cancelar: es revertir. Son dos operaciones con garantías distintas.
3. **La restricción es del ESTADO, no del tiempo.** No hay TTL, no hay ventana de gracia, no hay reloj en la regla. Mientras nadie decida, se puede retirar; en el instante en que alguien decide, no. Esto importa porque hace la regla testeable sin reloj inyectado — coherente con que `resolverSolicitudInterna` sea **pura y síncrona** (`:1-13`, *"CERO llamadas al modelo. CERO `await`"*).

**Alternativas consideradas**:

- ***Permitir cancelar también desde `APROBADA`*** (retirar unas vacaciones ya autorizadas): **rechazada, y es la alternativa seria.** No se rechaza por costo de implementación —de hecho sería otra llamada al mismo privado, con `estadoOrigen: "aprobada"`— sino porque **abre preguntas de negocio que nadie respondió y que el código tendría que contestar inventando**: ¿se le notifica al validador que autorizó algo que ya no existe? (no hay `NotifierPort` de solicitudes en el repo). ¿Qué pasa con los efectos ya consumidos —días de vacaciones ya tomados, un gasto ya reembolsado—? ¿El caso vuelve de `resuelto` a `pendiente_aprobacion_humana`, o queda `resuelto` con la solicitud `cancelada`, que es un par de estados que hoy no existe? **Es exactamente el criterio del ADR 11 punto 5** de `hito-1.3-ventas-comisiones` (`proposal.md:137`), que declaró el cierre de la escalación fuera de alcance con estas palabras: *"Esto se dice acá para que `sdd-tasks` no lo invente y para que el checkpoint humano lo apruebe o lo rechace a ojos abiertos"*. Mismo criterio, misma redacción deliberada: **preferimos una capacidad ausente y declarada a una semántica inventada por el implementador.**
- *Un estado `cancelada_post_aprobacion` distinto, para no mezclar las dos semánticas*: **rechazada** — es la alternativa anterior con un nombre más largo. Agrega un quinto valor al vocabulario para un flujo que igual habría que diseñar entero.
- *No agregar `cancelada` y reusar `rechazada` con `resuelta_por = solicitanteId`*: **rechazada.** Sería exactamente el problema que este change viene a resolver (Intent): una auditoría que no distingue *"un tercero lo negó"* de *"el autor lo retiró"*. Ahorra una constante y arruina el dato.

**Consecuencia, y hay que decirla porque es la parte incómoda**: cancelar una solicitud ya aprobada devuelve hoy `MOTIVO_NO_ENCONTRADA` — o sea, el mensaje *"No hay ninguna solicitud X pendiente de resolución"* (`build-on-comando-empleado.ts:1008`), que es **verdadero pero engañoso**: al usuario le suena a "no existe", cuando el hecho real es "existe y ya se decidió". Es un costo de UX de la cerradura 1, no un bug. **Se reserva a `sdd-design` (RD-61)**, con la restricción dura de que la solución **no puede** consistir en agregar un lector sin filtro de estado — eso derogaría el ADR 38.

### ADR 126: El resultado *"no sos el dueño"* se modela DENTRO de `resolver-solicitud-interna.ts` — `MotivoNoAplicableHitl` **no se toca**

**Contexto**. El chequeo de dueño es lógica nueva sin ningún precedente en `src/core/` (verificado por `grep` de `proponenteId|solicitanteId|creadoPor|autorId`: fuera de `solicitudes/*`, cero hits; `src/core/propuestas/`, el otro flujo HITL, no tiene concepto de creador humano porque las propuestas las genera un subagente). Hay que decidir **dónde vive el chequeo** y **cómo se expresa su resultado**, y la segunda mitad toca un tipo compartido.

**Decisión**:

1. **El chequeo vive DENTRO del caso de uso** (`resolverSolicitudInterna`), **no** en `esComandoPrivilegiado`. El guard del dispatcher es una función pura sobre `DESCRIPTORES` que sólo sabe si hay sesión (`comando-empleado.ts:262-264`); no tiene acceso al store, no puede leer la solicitud y no sabe quién la creó. Meter el chequeo ahí exigiría darle una dependencia de datos a un predicado estático — y el caso de uso **ya tiene la solicitud cargada en la mano** (`resolver-solicitud-interna.ts:108-109`).
2. **El chequeo va DESPUÉS de "encontrada" y ANTES de `requiere_confirmacion`** — o sea, entre las líneas 118 y 120. El orden no es estético: si fuera después, el arnés le pediría al usuario que confirme una acción que va a rechazar igual, y encima le mostraría en el eco (`formatearEcoSolicitud`) el `detalle` de una solicitud ajena. **Chequear tarde es una fuga de datos, no una ineficiencia.**
3. **★ El resultado se modela FUERA de `MotivoNoAplicableHitl`, ampliando localmente `ResolverSolicitudResult`** (`:40`), sin tocar `hitl-contract.ts`. Y el argumento definitivo es que **el repo ya tomó esta misma decisión una vez, deliberadamente**: `hitl-contract.ts:33-38` documenta que ventas conserva su **propio** `MotivoNoAplicable` (`resolver-escalacion-reembolso.ts:43`) en vez de importar el compartido, *"duplicados a propósito (ADR 50, punto 4)"*. El criterio vigente del repo no es *"todo motivo va al contrato compartido"*, es **"el contrato compartido sólo tiene lo que TODOS los dueños pueden producir"**. `hitl-contract.ts:2` se autodefine *"Vocabulario HITL **compartido**"*, y un motivo que sólo uno de los tres dueños puede emitir no es vocabulario compartido: es vocabulario local mal ubicado.
4. **El blast radius medido, no estimado.** Consumidores reales de `MotivoNoAplicableHitl` (`grep` sobre todo `src/`): `resolver-solicitud-interna.ts` (este dominio), `resolver-propuesta-cambio.ts` (**propuestas** — el blast radius real), `build-on-comando-empleado.ts` (importa sólo `MOTIVO_CAS` y **estrecha con `if (… === MOTIVO_CAS)`**, no con `switch` exhaustivo) y `hitl-contract.test.ts:31-33`. **Ventas NO está en la lista** (corrección de la exploración, ver cabecera). Agregar un tercer miembro **no rompería el compilador** en ningún consumidor —por eso la alternativa es tentadora— pero **haría que `ResolverPropuestaResult` declare en su tipo un `motivo` que `resolver-propuesta-cambio.ts` no puede emitir jamás**. Un tipo que promete estados imposibles obliga a todo consumidor futuro de propuestas a manejar una rama muerta. Es deuda silenciosa: no falla, miente.

**Alternativas consideradas**:

- ***Agregar `MOTIVO_NO_ES_DUENO` a `MotivoNoAplicableHitl`***: **rechazada por los puntos 3 y 4.** Es una línea, no rompe nada y reusa la rama `no_aplicable` que el handler ya maneja — un caso de libro de "barato hoy, confuso siempre". Contamina el contrato de un dominio (propuestas) con un concepto que ese dominio no tiene, y contradice el criterio que el ADR 50 punto 4 ya fijó por escrito.
- *Mover el chequeo a `esComandoPrivilegiado` con una categoría `propietario`*: **rechazada por el punto 1**, y además rompería la propiedad de que el parser/guard sea puro y sin acceso a datos.
- *Devolver `no_aplicable` con `MOTIVO_NO_ENCONTRADA` para no exponer que la solicitud existe*: **rechazada, aunque tiene un argumento de seguridad legítimo** (no confirmarle a un empleado que existe la solicitud `S-7` de otro). Se rechaza porque el arnés es una TUI local con login por empleado, donde **cualquier empleado autenticado ya puede listar todas las solicitudes pendientes** con `/aprobar-solicitud` sin id — el `solicitanteId` ya es visible para todos. Mentir en el mensaje no ocultaría nada y le devolvería *"no existe"* a alguien que está mirando la solicitud en pantalla. Mismo criterio que la nota R16 de `tui-canal-empleado`: *"es una TUI LOCAL con login por empleado, no un portal autenticado"*.

**Consecuencia**. `hitl-contract.ts` **no se toca en este change** (cero riesgo sobre propuestas, cero sobre ventas) y `ResolverSolicitudResult` deja de ser un alias desnudo del genérico para pasar a ser *el genérico más lo propio de este dominio* — que es exactamente el molde que el ADR 50 anticipó. **La forma exacta del miembro nuevo se reserva a `sdd-design` (RD-59)**: un cuarto `resultado: "no_es_dueno"` en la unión local, o un `no_aplicable` con motivo local, son dos bajadas defendibles de esta misma decisión.

### ADR 127: `privilegiado: true`, sin categoría nueva — la sesión es **insumo** del chequeo de dueño, no sólo su guarda

**Contexto**. `/aprobar-solicitud` y `/rechazar-solicitud` son `privilegiado: true` porque son "para el validador". `/cancelar-solicitud` es para cualquier empleado sobre **sus propias** solicitudes, así que la pregunta legítima es si el flag sigue aplicando o si hace falta una tercera categoría en `DescriptorComando`.

**Decisión**. **`privilegiado: true`, reusando el flag existente. Ninguna categoría nueva, ningún campo nuevo en `DescriptorComando`.**

1. **No es una decisión nueva: es la que ya se tomó para `/solicitar`.** El comando que **crea** la solicitud es `privilegiado: true` (`comando-empleado.ts:166-173`), por el mismo motivo exacto: sin sesión no hay `solicitanteId` que escribir. Si crear exige sesión, retirar lo creado no puede exigir menos.
2. **Acá la sesión no es sólo la guarda, es el INSUMO.** En `/aprobar-solicitud` la sesión responde *"¿podés operar?"*. En `/cancelar-solicitud` responde además *"¿quién sos?"* — sin `sesion.empleadoId` el chequeo del ADR 126 **no se puede computar**. Un `privilegiado: false` no sería una política más laxa: sería un comando **imposible de implementar**.
3. **Una categoría nueva sería un modelo de permisos disfrazado.** `DescriptorComando` tiene hoy dos flags booleanos (`privilegiado`, `secreto`, `:62-73`) y `esComandoPrivilegiado` es *"la única fuente de verdad para el guard de privilegio (ADR 28, 32)"* (`:91`). Agregar `propietario: boolean` metería en un descriptor **estático** una condición que depende de **datos de la fila** — el descriptor no puede saber quién es el dueño. Sería un flag que no decide nada, con un chequeo real viviendo en otro lado igual (ADR 126 pto 1). Peor que no tenerlo.
4. **★ Y hay que decir en voz alta lo que este ADR NO arregla.** Verificado: `esComandoPrivilegiado` sólo exige sesión vigente, y `SesionEmpleado` (`auth/sesion.ts:11-17`) es `{empleadoId, iniciadaEn, expiraEn?}` — **sin campo de rol**. O sea que **hoy, en código, cualquier empleado autenticado puede aprobar cualquier solicitud, incluida la propia** — el requirement `solicitud-interna-hitl:72` lo dice y lo acepta. "Validador" es convención de negocio, no una restricción que el arnés haga cumplir. Este change introduce **la primera** verificación de relación autor↔actor del sistema, pero **sólo para cancelar**; no toca la asimetría de aprobar. Eso es deliberado (Out of Scope) y va al checkpoint (pregunta 3).
5. **Deja fila en `registro_acciones_empleado`, DENTRO de la transacción del CAS** — no vía `registrar(...)` — porque `resolverSolicitudTransaccional` ya hace el `insertAccionEmpleado` adentro (`repository.ts:2152-2159`). Es gratis y automático: sale del mismo `config` parametrizado. **Sin migración**: `comando` es `TEXT` sin `CHECK` (`0005:48`).

### ADR 128: Confirmación en dos pasos SÍ — y la ranura `confirmacionPendiente` **no gana ninguna rama**

**Contexto**. `comando-reporte-comisiones` (ADR 119 pto 5) acaba de decidir lo contrario para su comando, citando la regla original: la confirmación del **ADR 36** existe *"para escrituras irreversibles con CAS. Una consulta no escribe nada del núcleo"* (`hito-2.2-a2a-cliente/proposal.md:290`). Hay que aplicar la misma regla, no el mismo resultado.

**Decisión**. **Confirmación en dos pasos, sí.** La regla del ADR 36 se cumple en las dos mitades, no en una: `/cancelar-solicitud` **escribe** (CAS + `updateCaso` + fila de auditoría, en transacción) y es **irreversible** (no hay des-cancelar — Out of Scope, y es una consecuencia directa del ADR 125). Es el caso central que el ADR 36 describe, no un borde.

1. **Y el costo de implementarla es cero, verificado línea por línea.** `manejarResolucionSolicitud` (`build-on-comando-empleado.ts:976-1034`) es **ya genérico** sobre `accion: AccionSolicitud`: la clave de comparación de `confirmacionPendiente` incluye `accion` (`:998`), así que un eco pendiente de `/aprobar-solicitud S-7` **no** matchea un `/cancelar-solicitud S-7` — no hay cross-talk entre acciones sobre la misma solicitud, y eso ya está construido y testeado.
2. **El mensaje de éxito ya sirve tal cual.** `` `Listo: la solicitud ${solicitudId} quedó ${resultado.estadoFinal}.` `` (`:1032-1034`) con `estadoFinal = "cancelada"` produce *"Listo: la solicitud S-7 quedó cancelada."* **Cero líneas nuevas.** Que el molde absorba un tercer caso sin tocarse es la evidencia de que el ADR 55 lo generalizó bien.
3. **`confirmacionPendiente` NO gana una cuarta rama** — misma fórmula del ADR 85 pto 5. La rama `dominio: "solicitud"` ya existe y ya es genérica sobre la acción; lo que se amplía es `AccionSolicitud`, un tipo del **núcleo**, no la unión de la ranura de confirmación del **dispatcher**. Verificable leyendo el tipo, y va a Success Criteria.

---

## Affected Areas

| Área | Impacto | Qué cambia |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor nuevo (`privilegiado: true`, `forma: "id_opcional_solicitud"` **ya existente**), brazo de la unión, rama en `parsearComando`. **Sin `Forma` nueva.** Sigue sin imports |
| `src/core/commands/registro-acciones-contract.ts` | Modificado | `COMANDO_CANCELAR_SOLICITUD` + `RESULTADO_CANCELADA` (RD-62). Sigue sin imports |
| `src/core/solicitudes/solicitudes-contract.ts` | Modificado | `SOLICITUD_ESTADO_CANCELADA`, cuarto miembro de `SolicitudEstado`, `cancelarSolicitud` en `SolicitudStorePort` |
| `src/core/solicitudes/resolver-solicitud-interna.ts` | **Modificado — el trabajo real** | `ACCION_CANCELAR_SOLICITUD`, rama en `aplicarCas`, **chequeo de dueño** y ampliación local de `ResolverSolicitudResult` (ADR 126, RD-59) |
| `src/core/hitl/hitl-contract.ts` | **★ Sin cambios (ADR 126)** | `MotivoNoAplicableHitl` intacto ⇒ **cero impacto sobre `propuestas`** |
| `src/core/propuestas/**` · `src/core/ventas/**` | **Sin cambios** | Ninguno de los dos consume nada que este change toque |
| `src/adapters/memory/repository.ts` | Modificado | `cancelarSolicitudInterna`: tercera llamada a `resolverSolicitudTransaccional`, **sin SQL nuevo** |
| `src/build-on-comando-empleado.ts` | Modificado | Entrada en `ACCION_SOLICITUD_COMANDO` (`:1043`) + rama de respuesta "no sos el dueño". `manejarResolucionSolicitud` **casi sin tocar** (ADR 128) |
| `src/adapters/memory/migrations/0008_*.ts` | **Comentario, no DDL** | El doc de `:28-29` deja de ser cierto (R2). **Cero SQL, cero migración nueva** |
| `src/adapters/tui/**` | **Sin cambios** | El adaptador TUI sigue sin saber que existen los comandos (ADR 31) |
| `package.json` | **Sin cambios** | Sin dependencias nuevas, sin scripts nuevos |
| `README.md` · `docs/ARC42_*.md` | Modificado | Comando nuevo en la Caja Blanca del Registro de Comandos y en el flujo de solicitud interna |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **El chequeo de dueño contradice un requirement vigente.** `solicitud-interna-hitl:72` dice textual *"sin verificar … relación con el solicitante"*. Un Reviewer que lea la spec y el código ve una contradicción directa | **Media — es el riesgo vivo del change** | Delta **obligatorio** en Capabilities, con la instrucción de **acotar sin derogar**: el requirement sigue intacto para aprobar/rechazar, cancelar es excepción explícita. Está además en Success Criteria como ítem propio |
| **R2** | **`resuelta_por`/`resuelta_at` se estiran semánticamente.** Una cancelación escribiría `resuelta_por = <el propio solicitante>` en una columna que el doc de `0008:28-29` declara *"sólo las escribe el CAS de `/aprobar-solicitud`/`/rechazar-solicitud`"*, y `solicitudes-contract.ts:64` repite lo mismo | Media | **RD-60**: o se acepta y se reescriben los dos comentarios (barato, y "quién cerró la solicitud" sigue siendo verdad), o el CAS de cancelación deja las columnas nulas. **No se puede dejar sin decidir**: hoy el privado las escribe siempre |
| **R3** | **Colisión de archivo con `comando-reporte-comisiones`.** Los dos changes están abiertos, ninguno implementado, y **los dos tocan `comando-empleado.ts` y `registro-acciones-contract.ts`**, incluido el comentario de conteo de descriptores (`:96-99`) | **Alta — pero es de ORDEN, no de diseño** | La lógica de los dos es **independiente** (uno lee ventas, el otro escribe solicitudes; cero funciones en común). El único conflicto real es textual: el array `DESCRIPTORES` y el comentario *"Los quince descriptores"*. **El segundo en implementarse rebasa y actualiza el conteo.** Ver Dependencies |
| **R4** | **Mensaje engañoso al cancelar algo ya aprobado**: responde *"No hay ninguna solicitud X pendiente"* (`:1008`) cuando el hecho es *"ya fue decidida"* | Media | Consecuencia declarada del ADR 125, reservada a **RD-61**, con la restricción dura de que la solución **no puede** ser un lector sin filtro de estado (derogaría el ADR 38) |
| **R5** | **La ampliación de `AccionSolicitud` deja un caso sin cubrir en algún consumidor.** `aplicarCas` (`:56-64`) usa un **ternario**, no un `switch`: agregar un tercer valor sin corregirlo haría que `cancelar` caiga silenciosamente en la rama `rechazarSolicitud` — **fallo silencioso, tipos en verde** | **Media-Alta — el bug más peligroso del change** | El ternario **debe** pasar a `switch` con guarda de exhaustividad (`never`), y `ACCION_SOLICITUD_COMANDO` (`:1043`) igual. TDD estricto: el test que afirma que cancelar llama a `cancelarSolicitud` y **no** a `rechazarSolicitud` se escribe **primero** |
| **R6** | **El eco de confirmación filtra el detalle de una solicitud ajena** si el chequeo de dueño se ubica mal | Baja | Cerrado por diseño en el **ADR 126 pto 2**: el chequeo va **antes** de `requiere_confirmacion`. Test explícito: cancelar una solicitud ajena **no** deja `confirmacionPendiente` armada y **no** imprime el `detalle` |
| **R7** | **`cancelada` rompe algún consumidor de `SolicitudEstado`** que hoy asume tres valores | Baja | `estado` es `TEXT` sin `CHECK` (`0008:49`), y el índice `idx_solicitudes_estado` (`:59`) no lo restringe. El `grep` de consumidores se hace en `sdd-design`; el compilador atrapa los `switch` exhaustivos |

---

## Rollback Plan

**Aditivo y reversible borrando código, sin migración que revertir.** Quitar el descriptor, el brazo de la unión, la rama de `parsearComando`, `ACCION_CANCELAR_SOLICITUD` y su rama de `aplicarCas`, el chequeo de dueño, la ampliación local de `ResolverSolicitudResult`, `cancelarSolicitud` del puerto, `cancelarSolicitudInterna` del repositorio y las dos constantes de registro. `parsearComando("/cancelar-solicitud …")` vuelve a caer en `ayudaDesconocido` (el sumidero del ADR 34) y los demás comandos se comportan **byte por byte igual**, porque `resolverSolicitudTransaccional` **no se modifica**: se lo llama una vez menos.

**El dato persistido sí necesita una nota, y es la única parte no trivial del rollback.** Las filas con `estado = 'cancelada'` que hubieran quedado **sobreviven al revert** y pasan a ser **inalcanzables**: `listarSolicitudesPendientes` filtra por `pendiente`, así que no aparecen en ningún listado, y `SolicitudEstado` ya no incluiría ese valor (un `rowToSolicitud` que castea el `TEXT` devolvería un estado fuera de la unión declarada). **No corrompen nada** —su caso está `resuelto` y su fila de auditoría es válida— pero quedan como registro histórico de una feature que no existe. Es el precio de no tener `CHECK` en la columna, y es el mismo precio que el repo ya paga en `casos.estado`/`ventas.estado` por decisión explícita (`0008:19-22`). **Un rollback después de que un usuario real canceló algo debería preferir dejar las filas quietas antes que reescribirlas** — reescribir estado histórico para que encaje en un tipo es peor que un valor huérfano.

Las filas de `registro_acciones_empleado` con `comando = '/cancelar-solicitud'` son **inertes** y se conservan: una auditoría no se limpia porque la feature se revirtió.

A nivel git: revertir los commits de `hito/v3.3-comando-cancelar-solicitud` antes del merge a `main`. Es una TUI local: se reinicia el proceso, no hay deploy.

---

## Dependencies

- **Hito 5 (`solicitud-interna-hitl`) implementado y en `main`** — verificado presente: `repository.ts:2099-2193`, `resolver-solicitud-interna.ts`, `0008_solicitudes_internas.ts`. Este change **extiende** ese molde, no lo reconstruye.
- **★ `comando-reporte-comisiones` — dependencia de ORDEN, no de diseño (R3).** Los dos changes tocan `src/core/commands/comando-empleado.ts` y `registro-acciones-contract.ts` sin compartir una sola función. **No hay gate duro en ninguna dirección**: se pueden implementar en cualquier orden, pero **no en paralelo sobre ramas que se mergeen sin rebase**, porque el array `DESCRIPTORES` y su comentario de conteo (*"Los quince descriptores"*, `:96-99`) van a conflictuar textualmente. **El segundo en mergear rebasa y actualiza el conteo** — y ése es el que debería, además, cerrar la pregunta del requirement *"los ocho comandos"* de `comando-empleado-tui` si el checkpoint la respondió que sí.
- **Relación con `definicion-skills` (`v3.1.0`): NINGUNA.** Ese change toca `src/core/skills/`, `invoke-model.ts`, `bootstrap.ts` y `.claude/`. Cero archivos en común.
- **Checkpoint humano de `AGENTS.md`** aprobando esta propuesta —en particular **ADR 125** (el alcance `PENDIENTE`, ya decidido) y **ADR 126** (el chequeo de dueño y su modelado)— antes de `sdd-spec`/`sdd-design`.

---

## Success Criteria

- [ ] `/cancelar-solicitud` está en `DESCRIPTORES` con `privilegiado: true`, y un test afirma `esComandoPrivilegiado("cancelar_solicitud") === true`.
- [ ] `parsearComando` sigue **sin un solo import** y **sin `Forma` nueva** — un test afirma que el tipo `Forma` conserva sus cinco miembros.
- [ ] El **dueño** cancela su solicitud `PENDIENTE`: dos pasos (eco + confirmación), y al final `estado = 'cancelada'`, caso `resuelto`, y **una** fila de auditoría con `comando = '/cancelar-solicitud'` y `resultado = 'cancelada'`, escrita **dentro** de la transacción.
- [ ] **Un empleado que NO es el dueño no puede cancelar**, y el test verifica las tres garantías juntas: respuesta explicativa, **`confirmacionPendiente` sin armar**, y **el `detalle` de la solicitud ajena ausente de la respuesta** (R6).
- [ ] **Cancelar una solicitud ya `aprobada` o `rechazada` no escribe nada**: un test afirma que `solicitudes_internas`, `casos` y `registro_acciones_empleado` quedan idénticas (ADR 125, las dos cerraduras).
- [ ] **`aplicarCas` es un `switch` con guarda de exhaustividad (`never`), no un ternario**, y un test afirma que `cancelar` invoca `cancelarSolicitud` y **nunca** `rechazarSolicitud` (R5).
- [ ] **`src/core/hitl/hitl-contract.ts` no tiene ni una línea modificada** (ADR 126) — verificable en el diff. `MotivoNoAplicableHitl` conserva exactamente dos miembros, y `hitl-contract.test.ts` pasa **sin modificarse**.
- [ ] **Los tests de `resolver-propuesta-cambio` y de `resolver-escalacion-reembolso` pasan sin modificarse** — evidencia de blast radius cero sobre los otros dos dominios.
- [ ] `confirmacionPendiente` **no gana ninguna rama nueva** (ADR 128 pto 3) — verificable leyendo el tipo.
- [ ] `/aprobar-solicitud` y `/rechazar-solicitud` se comportan **idéntico**, con sus tests actuales en verde y **sin modificarlos** (salvo el conteo de descriptores).
- [ ] `/ayuda` lista el comando nuevo con su `uso` de una línea, **sin código nuevo** (sale de `formatearAyuda`).
- [ ] Delta de `solicitud-interna-hitl` que **acota sin derogar** el requirement *"sin verificar … relación con el solicitante"* (R1), y spec nueva de `cancelacion-solicitud-interna`.
- [ ] Los comentarios de `0008:28-29` y `solicitudes-contract.ts:64` quedan **consistentes** con lo que RD-60 decida (R2).
- [ ] **Cero migraciones**, **cero dependencias nuevas**, `npm test` y `npm run typecheck` en verde.
- [ ] **TDD estricto** (red → green → refactor) en el parser, el caso de uso, el chequeo de dueño y el CAS — todo lógica de negocio, sin excepción aplicable.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v3.3-comando-cancelar-solicitud/` con evidencia manual, tag `v3.3.0`.

---

## Qué necesita el checkpoint humano

1. **El ADR 125 es la decisión que ya tomaste; acá está formalizada con un hallazgo que la refuerza.** El alcance *"sólo `PENDIENTE`"* **no hay que construirlo**: ya está garantizado por dos cerraduras estructurales que existen desde Hito 5 (el lector filtrado del ADR 38 y el `estadoOrigen` del CAS). La decisión, leída con precisión, es *"no construimos la vía para saltearlas"*.
2. **El ADR 126 es la decisión de arquitectura real del change, y corrige un hecho de la exploración.** `MotivoNoAplicableHitl` **no** lo usa ventas (usa su propio tipo duplicado a propósito); su blast radius real es **propuestas**. La propuesta decide **no tocar el tipo compartido**. Si preferís la vía barata (un tercer motivo en el contrato compartido), decilo ahora: es una línea, pero le mete a `propuestas` un estado imposible en su tipo.
3. **★ La pregunta de negocio que este change deja abierta a propósito.** Hoy, **en código**, cualquier empleado autenticado puede aprobar cualquier solicitud —incluida la propia— y el requirement `solicitud-interna-hitl:72` lo declara aceptado. Este change introduce la **primera** verificación autor↔actor del sistema, pero **sólo para cancelar**. ¿Querés que un change futuro cierre también *"no podés aprobar tu propia solicitud"*, o eso se sigue aceptando? **No lo decide esta propuesta**, pero después de este change la asimetría queda más visible.
4. **R3, orden de implementación.** `comando-reporte-comisiones` y este change tocan los mismos dos archivos sin compartir lógica. ¿Cuál va primero? El segundo rebasa y actualiza el conteo de descriptores — no hay dependencia técnica, sólo secuencia.
5. **R2, `resuelta_por` para una cancelación.** ¿Te sirve que la columna guarde al propio solicitante (con los comentarios reescritos), o preferís que quede nula? Es RD-60, pero la semántica de auditoría es tuya.
6. **Numeración y versión.** `v3.3.0` es propuesta y depende de que `v3.1.0`/`v3.2.0` cierren en ese orden. **ADR 125-128 y RD-59-62** salen de un techo verificado en ADR 124 / RD-58.

## Decisiones reservadas para `sdd-design` (RD-59 en adelante)

| RD | Qué | Por qué no se decide acá |
|---|---|---|
| **RD-59** | **Forma exacta del resultado "no sos el dueño"**: ¿un cuarto `resultado: "no_es_dueno"` en la unión local `ResolverSolicitudResult`, o un `no_aplicable` con un motivo LOCAL (sin tocar el compartido)? Más el nombre del evento de `logEvent` | El **ADR 126 ya fijó la decisión de arquitectura** (fuera de `MotivoNoAplicableHitl`). Esto es la bajada a firmas: exige mirar cómo el handler estrecha hoy el resultado (`build-on-comando-empleado.ts:1007-1049`) y qué rama nueva le cuesta menos |
| **RD-60** | **Qué escribe el CAS de cancelación en `resuelta_por`/`resuelta_at`** (R2): el propio `solicitanteId` reescribiendo los dos comentarios, o `NULL` desviándose del privado parametrizado | Cambia si `resolverSolicitudTransaccional` sigue sirviendo **sin tocarse** (que es el argumento entero del Approach) o si necesita un parámetro más. Es una decisión de firma con consecuencia de auditoría |
| **RD-61** | **Qué responde cancelar una solicitud que existe pero YA fue decidida** (R4): aceptar el *"no hay ninguna pendiente"* actual, o distinguir el caso — **con la restricción dura de no agregar un lector sin filtro de estado** (ADR 38) | Depende de si hay una vía que distinga sin derogar el ADR 38 (p. ej. un lector filtrado por `solicitanteId` + estados terminales). Es diseño de puerto, y esta fase no baja a firmas |
| **RD-62** | **`RESULTADO_CANCELADA` propio vs. reusar uno existente**, y si `SolicitudEstado`/`AccionSolicitud` necesitan guardas de exhaustividad más allá de `aplicarCas` (R5) | Mismo criterio que RD-56 de `comando-reporte-comisiones`: agregar al vocabulario compartido de `resultado` es barato pero lo engorda. Se decide con el spec del requirement de auditoría al lado y el `grep` de consumidores hecho |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió **sin herramienta de shell disponible** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), así que no se pudo invocar el binario — misma limitación ya documentada por las propuestas de Hito 3, Hito 4, `definicion-skills` y `comando-reporte-comisiones`. Se compensó verificando **cada** afirmación contra archivo y línea: `src/core/hitl/hitl-contract.ts` (completo), `src/core/solicitudes/solicitudes-contract.ts` (completo), `src/core/solicitudes/resolver-solicitud-interna.ts` (completo), `src/core/commands/registro-acciones-contract.ts` (completo), `src/adapters/memory/migrations/0008_solicitudes_internas.ts` (completo), `src/adapters/memory/repository.ts:2098-2193`, `src/build-on-comando-empleado.ts:930-1049`, `src/core/commands/comando-empleado.ts:60-180`, `grep` de `motivo|Motivo|hitl-contract` sobre `src/core/ventas/resolver-escalacion-reembolso.ts` (**que desmiente la afirmación de la exploración sobre el blast radius**), `grep` de `MotivoNoAplicableHitl|MOTIVO_*` sobre todo `src/` (blast radius real: solicitudes, propuestas, dispatcher, test), `openspec/changes/hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md` (headers de requirements), `openspec/changes/hito-1.3-ventas-comisiones/proposal.md:118-141` (ADR 11 completo), `openspec/changes/comando-reporte-comisiones/proposal.md` (completo, molde de formato) y los cuatro `grep` de numeración que fijan los techos en **ADR 124** y **RD-58** (dos de detección + dos de exclusión con cero matches). Se recomienda que `sdd-design` ejecute `graphify explain` sobre `resolverSolicitudInterna`, `resolverSolicitudTransaccional` y `manejarResolucionSolicitud`, y `graphify update .` una vez implementado.
