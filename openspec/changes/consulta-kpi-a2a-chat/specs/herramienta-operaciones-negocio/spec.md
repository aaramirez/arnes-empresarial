> Nota de proceso: mismo hook de graphify sin shell que `proposal.md` (sólo Read/Grep/Glob). **Versión base = tip de la cadena de deltas**: `aprobacion-conversacional-hitl/specs/herramienta-operaciones-negocio/spec.md` (ocho) + delta de `devolucion-sin-token-dos-personas` (diez, v3.12) + delta de `consulta-solicitud-propia` (once, v3.14) + delta de `visibilidad-a2a-entrante-chat` (doce, v3.15). Los bloques MODIFIED copian los bloques de ESE último delta (mismos títulos, con la única excepción del renombrado declarado abajo) y los editan. ★ **El archivado depende del orden v3.12 → v3.13 → v3.14 → v3.15 → v3.16**: este delta sólo aplica sobre un base que ya tenga doce operaciones. Verificado: `OPERACIONES_NEGOCIO` tiene hoy diez (`src/core/operaciones/operaciones-contract.ts:71-82`), así que "12 → 13" es verdad únicamente tras archivar v3.15. Este delta NO restituye las cláusulas que el delta de v3.12 dejó caer (las señaló v3.15 para quien archive v3.12).
>
> **Segundo RENAMED sobre el mismo requirement de auditoría.** `visibilidad-a2a-entrante-chat` renombró el requirement de auditoría a "…muta o divulga datos de la empresa deja fila de auditoría; las lecturas de datos propios no". `consultar_kpi` no muta estado de negocio y, con el catálogo cerrado, no divulga datos de la empresa (el texto que sale es estático); pero SALE a un tercero y audita, así que ese título vuelve a quedarse corto. Se lo renombra otra vez (sección `RENAMED` abajo). **Si v3.15 NO aplicó su RENAMED, el `FROM` de este delta es el título del tip original ("Cada operación que muta deja fila de auditoría; las de sólo lectura no", el que v3.15 declara como su `FROM`) y quien archive debe ajustarlo a mano**; es sintaxis estándar de OpenSpec pero este repo no tiene precedente de aplicarla. Reversible: para no renombrar, se elimina la sección `RENAMED` y se conserva el título vigente con el cuerpo tal cual. (Divergencia con `design.md` §17 pto 3, que considera que la cláusula "o divulga datos de la empresa" restituida por v3.15 ya cubre `consultar_kpi` y sólo pide nombrarla: esta spec lo lee distinto, porque con catálogo cerrado la operación no divulga datos de la empresa; lo que la hace auditable es la salida a un tercero. Si el checkpoint prefiere no renombrar, el cuerpo del requirement sigue nombrando `consultar_kpi` igual.)
>
> **Deriva de auditoría heredada, resuelta en el mismo sentido que v3.15.** El criterio que separa quién audita sigue siendo: datos propios del empleado ⇒ sin fila; datos de la empresa o de un tercero, o una salida a un tercero ⇒ con fila. `consultar_kpi` cae en el segundo grupo por la salida: la fila es lo único que deja rastro de quién disparó una consulta a un sistema externo.

# Delta for Herramienta Operaciones Negocio

## MODIFIED Purpose

Capability existente. Servidor MCP in-process `operaciones` (molde `src/adapters/knowledge/knowledge-tool.ts`), habilitado únicamente en el turno de empleado autenticado (capability `turno-empleado-autenticado`). Expone un conjunto acotado de operaciones sobre el camino del dinero; cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista existente. El modelo aporta únicamente identificadores estructurados — nunca un monto, porcentaje, período ni veredicto.

**Operaciones del contrato** (trece): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `consultar_reporte_comisiones`, `resolver_reembolso`, `resolver_solicitud`, `solicitar_devolucion` (capability `devolucion-sin-token-dos-personas`), `consultar_venta` (capability `consulta-venta-empleado`), `consultar_solicitud` (capability `consulta-solicitud-empleado`), `ver_solicitudes_a2a` (capability `visibilidad-a2a-entrante-chat`), y la que este change agrega — `consultar_kpi` (capability `consulta-kpi-a2a-chat`), la única cuyo propósito es una consulta A2A saliente a un sistema externo: por eso el texto que sale lo fija el código (catálogo cerrado), el modelo sólo elige una clave y la operación exige rol `administrador` (ADR 244, más estricto que el comando de la TUI).

(Previously: doce operaciones. Este change agrega la última, y la lista no describía ninguna operación con salida a un sistema externo.)

## RENAMED Requirements

- FROM: `### Requirement: Cada operación que muta o divulga datos de la empresa deja fila de auditoría; las lecturas de datos propios no`
- TO: `### Requirement: Cada operación que muta, divulga datos de la empresa o consulta a un sistema externo deja fila de auditoría; las lecturas de datos propios no`

## ADDED Requirements

### Requirement: `consultar_kpi` no muta estado de negocio; sus únicas escrituras son la fila de delegación y la fila de auditoría

`consultar_kpi` SHALL NOT modificar ninguna fila de `ventas`, `solicitudes_internas`, `solicitudes_a2a_entrantes` ni de las tablas de comisiones, ni crear ninguna fila de `casos` (la delegación cuelga del caso del turno, RD-118), ni cambiar el estado de ninguna ranura de confirmación, en ninguna de sus ramas. Sus únicas escrituras SHALL ser: UNA fila de `delegaciones_a2a` por invocación que llegó a despachar (creada y luego actualizada por el mecanismo existente) y UNA fila de `registro_acciones_empleado` por invocación que pasó la guarda de A2A apagado (a diferencia de `consultar_venta` y `consultar_solicitud`, que no escriben ninguna). Las ramas sin despacho —sin rol `administrador`, clave fuera del catálogo que llegó al dispatcher— escriben SÓLO la fila de auditoría. Vive en el vocabulario del contrato como operación sin `accion` ni `confirmado`; su autorización por rol, su entrada, el plazo de espera, el tratamiento del resultado externo y la auditoría son de la capability `consulta-kpi-a2a-chat`. Con A2A apagado, o con una entrada rechazada por la validación, SHALL NOT escribir nada.

#### Scenario: Instantánea de tablas idéntica salvo las filas de delegación y de auditoría
- GIVEN una base `:memory:` con ventas, solicitudes internas, solicitudes A2A entrantes, comisiones y casos, un administrador y un cliente A2A doble que completa
- WHEN se invoca `consultar_kpi` con una clave válida
- THEN las filas de `ventas`, `solicitudes_internas`, `solicitudes_a2a_entrantes`, de comisiones y de `casos` son idénticas a la instantánea previa (incluido `updated_at`)
- AND `delegaciones_a2a` y `registro_acciones_empleado` tienen exactamente UNA fila nueva cada una

#### Scenario: Las ramas sin despacho escriben sólo la fila de auditoría
- GIVEN una base `:memory:`, una sesión sin rol `administrador` y una clave fuera del catálogo forzada al dispatcher con un administrador
- WHEN se invoca `consultar_kpi` en cada caso
- THEN ninguna tabla cambió respecto de la instantánea previa salvo UNA fila nueva en `registro_acciones_empleado` por invocación

#### Scenario: Con A2A apagado o con una entrada rechazada por la validación no se escribe nada
- GIVEN una base `:memory:`, un turno sin cliente A2A y una entrada con una clave fuera del catálogo que la validación rechaza
- WHEN se invoca `consultar_kpi` en cada caso
- THEN ninguna tabla cambió respecto de la instantánea previa

## MODIFIED Requirements

### Requirement: Contrato tipado por operación, sin campos de dinero ni veredicto

El servidor MCP `operaciones` SHALL exponer únicamente las trece operaciones listadas en el Purpose, cada una con un schema de input que acepte exclusivamente identificadores estructurados (`token`, `ventaId`, `solicitudId`, `a2aTaskId`, `consultaId`, `motivo?`, `decision`, `accion`, `periodo?`, datos de alta). Ningún schema SHALL contener un campo numérico de monto o porcentaje, ni un campo de veredicto de texto libre — el único campo numérico admitido en todo el contrato sigue siendo `monto` de `registrar_venta`. `motivo`, en `solicitar_devolucion`, es texto libre acotado por un tope de longitud (RD-106), nunca un veredicto calculado por el modelo. `consultar_solicitud` SHALL aceptar únicamente `operacion` y `solicitudId?`. `ver_solicitudes_a2a` SHALL aceptar únicamente `operacion` y `a2aTaskId?`: un identificador estructurado, sin campo de identidad, de filtro ni de tope. `consultar_kpi` SHALL aceptar únicamente `operacion` y `consultaId`: la clave de un catálogo cerrado definido en código, obligatoria PARA ESA OPERACIÓN (su ausencia se rechaza en la validación de `consultar_kpi`). El schema del borde MCP es un único objeto plano compartido por las trece operaciones, con todos los campos opcionales a ese nivel; exigir `consultaId` ahí rechazaría las otras doce operaciones, así que este requirement NO dicta que sea obligatorio en el borde (lo fija el design) y SÍ exige que las otras doce sigan aceptándose. No es una excepción al invariante de identificadores estructurados (a diferencia de `motivo`): ningún campo de texto libre del schema determina el texto que se envía al destino A2A `kpi-incidente`; ese texto es función pura de la clave.

(Previously: enumeraba doce operaciones; `consultar_kpi` no existía, su schema (`consultaId`) no estaba fijado y `consultaId` no figuraba entre los identificadores admitidos. Corrección posterior de esta fase: una primera redacción decía "`consultaId` OBLIGATORIO" sin distinguir el borde MCP compartido de la validación por operación.)

#### Scenario: El schema rechaza un monto antes de tocar el núcleo
- GIVEN un intento de invocar `procesar_devolucion` con un campo adicional de tipo monto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar `procesarDevolucion`, y ninguna fila de `ventas` cambia

#### Scenario: `solicitar_devolucion` no acepta ningún campo de monto ni de veredicto
- GIVEN un intento de invocar `solicitar_devolucion` con un campo adicional de tipo monto, porcentaje o veredicto
- WHEN el schema valida el input
- THEN la validación falla antes de invocar el módulo de iniciación

#### Scenario: El contrato enumera trece operaciones e incluye `consultar_kpi`
- GIVEN `OPERACIONES_NEGOCIO` tras este change
- WHEN se inspecciona su contenido
- THEN tiene longitud 13, contiene `consultar_kpi` una sola vez y las doce anteriores (incluida `ver_solicitudes_a2a`) sin cambios

#### Scenario: `consultar_solicitud` acepta sólo `solicitudId` y rechaza cualquier otra clave
- GIVEN entradas `{operacion:"consultar_solicitud"}`, `{operacion:"consultar_solicitud", solicitudId:"s1"}` y `{operacion:"consultar_solicitud", solicitanteId:"e2"}`
- WHEN se validan
- THEN las dos primeras son válidas y la tercera es rechazada como clave extra

#### Scenario: `ver_solicitudes_a2a` acepta sólo `a2aTaskId` y `a2aTaskId` no pertenece a otra operación
- GIVEN entradas `{operacion:"ver_solicitudes_a2a"}`, `{operacion:"ver_solicitudes_a2a", a2aTaskId:"t1"}`, `{operacion:"ver_solicitudes_a2a", solicitudId:"s1"}` y `{operacion:"consultar_solicitud", a2aTaskId:"t1"}`
- WHEN se validan
- THEN las dos primeras son válidas y las dos últimas son rechazadas como clave extra

#### Scenario: Las otras doce operaciones siguen aceptándose sin `consultaId`
- GIVEN, para cada una de las doce operaciones anteriores, una entrada mínima válida que no lleva `consultaId`
- WHEN se la pasa por el schema del borde MCP y por la validación
- THEN las doce se aceptan, y sólo `consultar_kpi` rechaza la ausencia de `consultaId`

#### Scenario: `consultar_kpi` acepta sólo una clave del catálogo y rechaza todo lo demás
- GIVEN una clave K del catálogo, y entradas `{operacion:"consultar_kpi", consultaId:K}`, `{operacion:"consultar_kpi"}`, `{operacion:"consultar_kpi", consultaId:""}`, `{operacion:"consultar_kpi", consultaId:"no-existe"}`, `{operacion:"consultar_kpi", consultaId:K, consulta:"texto libre"}` y `{operacion:"consultar_venta", consultaId:K}`
- WHEN se validan
- THEN la primera es válida y las cinco restantes son rechazadas (clave ausente, vacía, fuera del catálogo, campo extra y clave en otra operación)

### Requirement: El mecanismo de confirmación en dos pasos cubre cuatro operaciones, nunca como campo del schema

Cuatro operaciones —`cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud` y `solicitar_devolucion`— SHALL resolver su confirmación en dos pasos consultando la ranura de confirmación (capability `confirmacion-operaciones-multislot`) desde el composition root. `solicitar_devolucion` SHALL usar un dominio de confirmación propio, distinto del de `resolver_reembolso`, para no pisar sobre el mismo `ventaId` una iniciación pendiente contra una aprobación pendiente (RD-107). Ninguna operación del contrato SHALL declarar `confirmado` como campo de su schema, en ninguna capa de validación. `consultar_solicitud`, `ver_solicitudes_a2a` y `consultar_kpi`, como `consultar_venta`, NO son confirmables. `consultar_kpi` se resuelve en UN paso porque el texto que sale lo fija el catálogo y no un humano ni el modelo, y el control humano que en el chat se pierde se repone con el rol `administrador` (ADR 244; asumido, pendiente de checkpoint: si el checkpoint elige doble confirmación, esta operación pasa a ser la quinta confirmable y nace un dominio de confirmación propio).

(Previously: mencionaba `consultar_solicitud` y `ver_solicitudes_a2a` como no confirmables; el conjunto de cuatro operaciones confirmables NO cambia — sólo el conteo total de schemas y la aclaración de que `consultar_kpi` tampoco es confirmable, con su motivo.)

#### Scenario: Una iniciación pendiente y una aprobación pendiente sobre distintos `ventaId` conviven sin pisarse
- GIVEN una escalación con `resolver_reembolso` pendiente de confirmar sobre un `ventaId`, y una iniciación de `solicitar_devolucion` sobre otro `ventaId` pendiente de confirmar
- WHEN ambas ranuras de confirmación se resuelven en turnos separados
- THEN cada una completa su propia operación sin interferir con la otra

#### Scenario: `confirmado` no existe como campo en ningún schema del contrato
- GIVEN los trece schemas del servidor `operaciones`
- WHEN se inspeccionan sus campos aceptados
- THEN ninguno declara `confirmado`

#### Scenario: `consultar_kpi` no marca ni consume ninguna ranura de confirmación
- GIVEN un espía de `ConfirmacionOperacionPort` y una invocación de `consultar_kpi` con una clave válida
- WHEN se ejecuta
- THEN ni `marcarPendiente`, `estaConfirmada` ni `consumir` se invocaron, y el conjunto de dominios de confirmación (`DominioConfirmacion`) no ganó ningún valor

### Requirement: Cada operación que muta, divulga datos de la empresa o consulta a un sistema externo deja fila de auditoría; las lecturas de datos propios no

El dispatcher del núcleo (`ejecutar-operacion.ts`) SHALL llamar `registrarAccion` para cada operación que muta estado, con un literal distinguible por operación (exacto: RD-110), correlacionado por `ventaId`/`casoId` cuando aplique; para cada operación de sólo lectura que divulga datos de la empresa o de un tercero: `consultar_reporte_comisiones` (`/reporte-comisiones`, `atendida`, sólo con período válido) y `ver_solicitudes_a2a` (`/ver-solicitudes-a2a`, `atendida` o `no_aplicable`; detalle en `visibilidad-a2a-entrante-chat`); y para cada operación que consulta a un sistema externo: `consultar_kpi` (`/consultar-kpi`, con el `casoId` del turno, que comparte con su fila de `delegaciones_a2a`; `atendida` cuando el agente externo completó, `fallida` en cualquier otro desenlace posterior al inicio del despacho, `no_autorizado` sin rol `administrador` y `no_aplicable` con una clave fuera del catálogo, las dos últimas sin despacho; sin fila cuando A2A está apagado o la entrada se rechaza en la validación; detalle en `consulta-kpi-a2a-chat`). `consultar_venta` y `consultar_solicitud`, de sólo lectura de datos PROPIOS del empleado, y el modo listado de `solicitar_devolucion` y de `resolver_reembolso`, SHALL NOT escribir fila de auditoría. Si `registrarAccion` lanza, el texto de negocio devuelto al modelo SHALL permanecer idéntico al del camino feliz, y el sistema SHALL emitir `accion-empleado-registro-fallido`.

(Previously: cubría las operaciones que mutan y las de sólo lectura que divulgan datos de la empresa o de un tercero, y no decía nada de una operación que SALE a un sistema externo; `consultar_kpi` no existía. El criterio que separa se extiende sin cambiar: datos propios del empleado ⇒ sin fila; datos de la empresa o de un tercero, o una salida a un tercero ⇒ con fila. Título renombrado, ver sección `RENAMED`.)

#### Scenario: `consultar_venta` nunca escribe fila de auditoría
- GIVEN cualquier invocación de `consultar_venta`, con o sin `ventaId`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN no se creó ninguna fila nueva

#### Scenario: `consultar_solicitud` nunca escribe fila de auditoría
- GIVEN cualquier invocación de `consultar_solicitud`, con o sin `solicitudId`, sobre solicitud propia, ajena o inexistente
- WHEN se inspecciona `registro_acciones_empleado`
- THEN no se creó ninguna fila nueva

#### Scenario: Una iniciación exitosa de `solicitar_devolucion` deja fila distinguible
- GIVEN una iniciación exitosa que deja la venta en `reembolso_pendiente`
- WHEN se inspecciona `registro_acciones_empleado`
- THEN existe una fila con un `resultado` distinguible de una escalación creada por el camino del token, correlacionada por `ventaId`/`casoId`, y sin el `motivo`

#### Scenario: El reporte de comisiones deja fila atendida sólo si el período es válido
- GIVEN un empleado invoca `consultar_reporte_comisiones` con un período válido
- WHEN `resolverPeriodoReporte` resuelve OK
- THEN `registrarAccion` recibe `comando: "/reporte-comisiones"` con `resultado: "atendida"`; con un período inválido la tool corta antes de leer `reporteStore` y no llama a `registrarAccion`

#### Scenario: `ver_solicitudes_a2a` deja una fila en cada una de sus tres ramas
- GIVEN un empleado con sesión vigente
- WHEN invoca `ver_solicitudes_a2a` sin id, con un id existente y con un id inexistente
- THEN `registro_acciones_empleado` recibe tres filas con `comando: "/ver-solicitudes-a2a"`, con `resultado` `atendida`, `atendida` y `no_aplicable` respectivamente

#### Scenario: `consultar_kpi` audita cuatro ramas y no audita el apagado ni el rechazo de validación
- GIVEN un cliente A2A doble, un administrador y un empleado sin rol `administrador`
- WHEN el administrador invoca `consultar_kpi` con una clave válida y el agente completa, luego con el agente fallando, luego con una clave fuera del catálogo forzada al dispatcher; luego el empleado sin rol la invoca con una clave válida; y por último se invoca con A2A apagado y con una entrada rechazada por la validación
- THEN `registro_acciones_empleado` recibe exactamente cuatro filas, todas con `comando: "/consultar-kpi"` y el `casoId` del turno, con `resultado` `atendida`, `fallida`, `no_aplicable` y `no_autorizado` respectivamente

#### Scenario: Si `registrarAccion` lanza, el texto de negocio no cambia y se marca el fallo de registro
- GIVEN una operación cuyo efecto o lectura ya se resolvió (por ejemplo `ver_solicitudes_a2a` sin id, o `consultar_kpi` con el agente completando)
- WHEN `registrarAccion` lanza una excepción al intentar escribir la fila
- THEN el texto devuelto al modelo es idéntico al del camino feliz, y el sistema emite `accion-empleado-registro-fallido` en vez del genérico "no se aplicó nada" del `catch` global
