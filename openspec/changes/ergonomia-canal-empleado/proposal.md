# Propuesta: Ergonomía del canal de empleado — que la respuesta de `registrar_venta` nombre personas y que el chat distinga quién habló y cuándo

**Origen**: **hallazgos 2 y 5 de la verificación manual de punta a punta que hizo el stakeholder** tras cerrar `aprobacion-conversacional-hitl` (v3.10.0, mergeado a `main`). Probó el arnés como empleado y como administrador, en TUI y en chat web, y anotó cinco cosas. **Esta propuesta toma exactamente dos**: las que son de presentación, no tocan el servidor de operaciones, no cambian ninguna garantía de seguridad y no necesitan una decisión de arquitectura del stakeholder para arrancar.

**Las otras tres** (recuperar una devolución sin token, consultar el estado de una venta puntual, y el TTL de sesión) viven en `openspec/changes/devolucion-autorizada-por-cliente/proposal.md`. **La razón del corte está abajo, en la Aclaración previa 2** — y es deliberada, no una repartija por tamaño.

**Rama prevista**: `hito/v3.11-ergonomia-canal-empleado` · **Tag de cierre**: `v3.11.0` · **Carpeta de progreso**: `docs/progreso/v3.11-ergonomia-canal-empleado/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `chat-web-empleado` y `aprobacion-conversacional-hitl`. **La numeración `v3.11.0` es propuesta, no fijada — es decisión del checkpoint**, y depende del orden de merge que se elija frente al otro change (ver *Dependencies*).

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo. Misma nota y mismo criterio que `operaciones-negocio-conversacionales`, `autorizacion-empleado` y `aprobacion-conversacional-hitl` ya dejaron escritos. **Toda afirmación de abajo está verificada por `Grep`/`Read` con archivo:línea, sobre `main` post-v3.10.**

---

## Aclaración previa 1: el techo real de numeración

Verificado por `Grep` sobre **todo** el repo (`openspec/changes/*`, **más** `src/**` y `docs/**`, porque en esta serie los ADR se citan en doc-comments de código vivo y el techo real suele vivir ahí — el precedente de `definicion-skills` obliga a reverificar siempre).

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **220** | `aprobacion-conversacional-hitl/design.md:347,352`, citado en código vivo: `src/core/agents/definitions.ts:201`, `src/core/ventas/soporte-prompt.ts:97`, `src/adapters/operaciones/index.ts:106` | **ADR 221** |
| **RD** | **RD-104** | `aprobacion-conversacional-hitl/proposal.md:403`, `design.md:280-282` | **RD-105** |

★ **Atención, `sdd-spec`/`sdd-design`**: el techo **no** es el 211 que anunciaba el `proposal.md` de v3.10 — ese change siguió abriendo ADRs en su `design.md` hasta el **220**. **El rango 221-222 de esta propuesta y el 223-226 de `devolucion-autorizada-por-cliente` son disjuntos a propósito**: los dos changes pueden escribirse en paralelo sin colisionar. **La colisión histórica ADR 174-187 sigue abierta y esta propuesta NO la reabre** (**RD-94**, forma de resolución ya recomendada en `chat-web-empleado/design.md:281`).

## Aclaración previa 2: por qué estos dos hallazgos van separados de los otros tres

No es por tamaño. Es porque **mezclarlos tiene un modo de falla concreto y conocido**: de los cinco hallazgos, tres exigen una decisión de seguridad explícita (la credencial de la devolución, el escopado de una lectura nueva, y la ventana de exposición de la sesión). Meterlas en el mismo PR que "pintar el chat de colores" hace que el Reviewer y el checkpoint las lean **con el ojo puesto en lo cosmético** — que es exactamente el mecanismo por el que un cambio de postura de seguridad pasa de largo firmado.

Este change, entonces, se define por lo que **NO** tiene: **cero cambios de servidor** en el hallazgo 5 (verificado: `chat-client.ts` y `CHAT_CSS` de `chat-page.ts` alcanzan), **cero cambios de esquema**, **cero autorización nueva**, **cero superficie HTTP nueva**. Si al implementarlo aparece cualquiera de esas cuatro cosas, **el alcance se filtró y hay que parar**.

## Aclaración previa 3: los dos hechos verificados que fijan el alcance real

1. **`ejecutarRegistrarVenta` ya tiene los nombres a mano; sólo no los usa.** La función recibe `operacion` y `sesion` (`ejecutar-operacion.ts:653-658`) y arma la respuesta en una sola línea: `` `Venta ${resultado.ventaId} registrada (caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.` `` (`:691-692`). `operacion.vendedorNombre` y `operacion.clienteId` están en el scope (`operaciones-contract.ts:99-107`) y **no se leen**. No hace falta ninguna consulta nueva, ningún puerto nuevo y ningún dato nuevo: es una interpolación.

   ★ **Y hay un dato que está a mano y que este change decide NO mostrar: `operacion.clienteEmail`.** Ver **ADR 221 pto 3** — no es un olvido.

   ★ **Nota de vocabulario, que corrige el pedido tal como fue enunciado**: *"mostrar el vendedor Y el empleado que registró"* son, en este diseño, **una sola persona**. `vendedorId` sale de `sesion.empleadoId` por closure y **nunca** de la entrada del modelo (`ejecutar-operacion.ts:646-648`, ADR 171 pto 2/5 — *"`vendedorId` sale de `sesion.empleadoId` (closure), NUNCA de `operacion` — que ni siquiera tiene ese campo"*). No hay un tercer actor que nombrar: hay **un** empleado autenticado que **es** el vendedor.

2. **El chat no distingue autor ni hora, y no lo prohíbe ningún ADR — simplemente no estaba en el alcance de v3.9.** `agregarTurno(autor, texto)` concatena todo en **un solo nodo de texto**: `turno.appendChild(document.createTextNode(autor + ": " + texto))` (`src/adapters/web/chat-client.ts:66-70`), sin clase por autor y sin marca de tiempo. Lo que **sí** está decidido, y este change **no** toca, son los invariantes de seguridad de la página (ADR 200 pto 5): nunca `innerHTML`, todo por `textContent`/`createTextNode`, CSP estricta **sin `unsafe-inline`**, y cero dependencias nuevas. **La afordancia se construye DENTRO de esos invariantes o no se construye** (ADR 222).

---

## Intent

El stakeholder usó el arnés de punta a punta y chocó con dos fricciones que no son bugs — el sistema hace exactamente lo que se especificó — pero que **degradan el único entregable que el tutor mira: que el arnés se pueda demostrar funcionando delante de alguien**.

1. **`registrar_venta` contesta con dos UUID y nada más.** El empleado acaba de decir, en castellano, *"registrale a Pérez el plan Premium por 1200"*, y el arnés le devuelve `Venta 8f3c… registrada (caso a91b…)`. Es correcto y es **ilegible**: no confirma **a quién** se le vendió ni **quién** quedó registrado como vendedor, que es justo lo que el empleado necesita para saber que el modelo no entendió cualquier cosa. En un canal conversacional, el eco de una operación de dinero **es el control de lectura del usuario** — el mismo argumento con el que el ADR 151 pto 6 defendió el doble paso de confirmación.

2. **El chat web no dice quién habló ni cuándo.** Todos los turnos son texto plano del mismo color, en una sola columna. Con conversaciones de más de cuatro o cinco mensajes —que es lo normal desde que v3.10 movió las cinco decisiones HITL al canal conversacional— **el empleado pierde el hilo de qué dijo él y qué contestó el arnés**, y no tiene forma de ubicar temporalmente una operación que ejecutó "hace un rato".

**Por qué ahora**: porque los dos son baratos, no bloquean a nadie y **el otro change los va a pisar si no salen primero**. `devolucion-autorizada-por-cliente` toca `ejecutar-operacion.ts` y la superficie de respuesta del canal; hacer este primero deja al otro rebasando sobre un texto ya estabilizado, y no al revés (ver **R3**).

---

## Scope

### In Scope

- **Unit 1 — La respuesta de `registrar_venta` nombra a las personas y CONSERVA los ids** (ADR 221). Se agregan `vendedorNombre` (que es, por construcción, el empleado autenticado del turno) y `clienteId`. **Los ids de venta y caso no se quitan**: son lo que el empleado necesita para correlacionar con la auditoría y con el reporte. **`clienteEmail` NO se muestra** (ADR 221 pto 3).
- **Unit 2 — El chat web distingue autor por clase CSS y estampa la hora de cada turno** (ADR 222), **100% del lado del cliente**: `src/adapters/web/chat-client.ts` (`agregarTurno`) y el `CHAT_CSS` de `src/adapters/web/chat-page.ts`. **Cero cambios en `server.ts`, cero cambios de contrato de `POST /mensaje`, cero dependencias nuevas.**
- **Los invariantes de la página se conservan y se vuelven a testear** (ADR 222 pto 2): sin `innerHTML`, sin estilo inline, sin relajar la CSP, sin `eval`. El color entra por `classList`, no por atributo `style`.
- **Tests**: el texto de `registrar_venta` afirmado sobre el contenido (que incluye nombre y `clienteId`, y que **NO** incluye `clienteEmail`); y el DOM del chat afirmado sobre estructura (dos nodos distinguibles por clase, marca de tiempo presente) con el molde de test de cliente que v3.9 ya dejó montado.
- **Evidencia de verificación manual** en `docs/progreso/v3.11-ergonomia-canal-empleado/`: captura del eco de `registrar_venta` y captura del chat con al menos cuatro turnos alternados.
- **README/arc42**: sólo si el texto vigente describe el eco de `registrar_venta` literalmente. **A verificar leyendo, no asumir.**

### Out of Scope

- **Mostrar `clienteEmail` en el eco.** Decisión, no omisión: ADR 221 pto 3.
- **Tocar `registrarVenta`, `procesarDevolucion` o cualquier función determinista del núcleo.** Este change **no** entra a `src/core/ventas/`. El criterio del ADR 145 pto 5 se sostiene **sin ninguna excepción** — a diferencia de v3.10, que tuvo una nombrada.
- **Quitar el link de confirmación del eco de `registrar_venta`.** Es tentador (es la credencial del cliente en manos del empleado), **pero es una decisión de seguridad y no entra en un change de presentación** — y además hoy es el **único** canal de entrega cuando el notificador no envía (`registrar-venta.ts:177-185`: `email-omitido` sin API key, `email-fallido` por red). Se trata en `devolucion-autorizada-por-cliente` y en su checkpoint.
- **Cualquier cambio de servidor por el hallazgo 5**: `server.ts`, rutas, payloads, CSP, cabeceras. Si aparecen en el diff, el alcance se filtró.
- **Rediseñar el chat** (scroll, markdown, historial persistente, indicadores de "escribiendo"). Se agregan **dos** afordancias nombradas, no una interfaz nueva.
- **Timestamps de servidor / reloj autoritativo.** El sello lo pone el cliente al recibir el turno (ADR 222 pto 4): es una ayuda de lectura, **no un dato de auditoría** — la auditoría real vive en `registro_acciones_empleado` y no cambia.
- **Los otros tres hallazgos** (devolución sin token, consulta de venta puntual, TTL de sesión): `devolucion-autorizada-por-cliente`.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado por `Glob` en esta fase: **71 archivos**. **`sdd-spec` debe reverificar por `Glob` antes de fijar nombres** — el conteo cambió en cada change de esta serie.

### New Capabilities

- **Ninguna.** Las dos afordancias caen dentro de capabilities que ya existen. Inventar una capability para "el chat pinta colores" ataría una decisión de presentación a un archivo de contrato.

### Modified Capabilities

- **`chat-web-empleado`** (versión vigente: `chat-web-empleado/specs/`) — **delta seguro**: es la capability que describe la página y su cliente. **Instrucción para `sdd-spec`: los requirements de seguridad de esa spec (sin `innerHTML`, CSP, `textContent`) NO se editan ni se relajan — se AGREGA un requirement de presentación que se verifica contra el DOM.** Si un requirement de seguridad vigente queda más permisivo después del delta, el change violó su propio *Out of Scope*.
- **`herramienta-operaciones-negocio`** (versión vigente: `aprobacion-conversacional-hitl/specs/`) — **delta acotado y a verificar leyendo**: sólo si algún requirement está redactado sobre el **texto literal** de la respuesta de `registrar_venta`. Si está redactado sobre el **efecto** (qué se persiste, qué se audita, qué no se calcula), **no hay delta** y no hay que forzar uno. ★ **Lo que sí conviene que el delta fije, si existe: que el eco NO incluye el email del cliente** — un requirement en negativo, con test, vale más que el comentario en el código (molde ADR 98 pto 4).
- **`turno-empleado-autenticado`** — **sin delta esperado.** No cambia qué operaciones habilita el turno ni cómo llega la sesión.

---

## Approach

**Dos piezas independientes entre sí.** Pueden ir en PRs separados o en uno solo (ver **R2** — el presupuesto de 400 líneas no corre riesgo acá).

1. **El eco de `registrar_venta`** (ADR 221): una interpolación en `ejecutar-operacion.ts:691-692` usando datos que ya están en el scope, y su test de texto. **Cero puertos, cero consultas, cero núcleo.**
2. **Autor y hora en el chat** (ADR 222): `agregarTurno` pasa de un `createTextNode` concatenado a una estructura con nodos separados y `classList`; `CHAT_CSS` gana las reglas de color y de disposición. **Cero servidor.**

**El orden no importa entre ellas**; sí importa frente al otro change (**R3**).

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 221-222)

La numeración continúa el techo real **ADR 220** (Aclaración 1). Las decisiones de nivel diseño reservan **RD-105**.

### ADR 221: El eco de `registrar_venta` nombra al vendedor y al cliente, **conserva los ids**, y **no dice el email**

**Contexto.** El eco actual (`ejecutar-operacion.ts:692`) sólo tiene `ventaId` y `casoId`. El pedido del stakeholder fue *"que muestre el vendedor y el empleado que registró, no ids"*. Dos precisiones que la verificación impone sobre ese enunciado: (a) vendedor y empleado **son la misma persona** por construcción (ADR 171 pto 2, `ejecutar-operacion.ts:646-648`), y (b) `clienteEmail` está en el scope y sería lo más "humano" para nombrar al cliente.

**Decisión**:

1. **El eco agrega `vendedorNombre` y `clienteId`**, tomados de `operacion` (`operaciones-contract.ts:99-107`). Cero lecturas nuevas.
2. **Los ids NO se reemplazan: se conservan.** Sustituirlos por nombres rompería la correlación con `registro_acciones_empleado` (que audita por `ventaId`/`casoId`, `ejecutar-operacion.ts:684-689`) y con el reporte de comisiones. El pedido era *"que no sean SÓLO ids"*, no *"que no haya ids"*. **Un eco sin ids es un eco que no se puede auditar.**
3. ★ **`clienteEmail` NO entra en el eco.** El email del cliente es el único dato personal del flujo que el repo decidió **no persistir en ninguna parte** (`registrar-venta.ts:84-85` *"Solo para notificar. NO se persiste (ADR 18, punto 4)"*; migración `0004_vendedores_ventas_comisiones.ts:26` *"El email del cliente NO tiene columna y NO se persiste (ADR 18)"*; `ventas-contract.ts:289`). **El transcripto del chat SÍ se guarda** (sesiones del SDK, memoria conversacional de v3.9): meter el email en la respuesta lo empuja a un almacén donde ADR 18 decidió que no estuviera. Que el empleado lo haya tipeado en su propio mensaje **no es licencia para que el arnés lo reimprima** — un dato lo escribe quien lo escribe, y el arnés no agrega copias. `clienteId` es un identificador de negocio y **ya** está persistido en `ventas` (`repository.ts:725`): nombrar por ahí no crea ninguna copia nueva.
4. **Nada más entra al eco.** Ni monto recalculado, ni estado inferido, ni texto del modelo. Sigue siendo una plantilla determinista armada por el dispatcher.

**Alternativas consideradas**:

- **Reemplazar los ids por nombres**: **rechazada**, pto 2.
- **Mostrar el email para "que se vea a quién le llegó"**: **rechazada**, pto 3. Si algún día hace falta confirmar la entrega, el dato correcto es el que ya está: `notificado` (`registrar-venta.ts:191`), que dice si el envío salió — sin repetir la dirección.
- **Resolver el nombre del cliente desde la base**: **rechazada por inexistente**: no hay tabla de clientes; `ventas.cliente_id` es un TEXT libre (`repository.ts:725`). Inventar un padrón de clientes para mejorar un eco es una migración buscando una excusa.

**Consecuencias**: el eco pasa de dos UUID a cuatro datos, tres de los cuales ya viajaban en el mismo scope. **Cero impacto en persistencia, auditoría, autorización y contrato.**

### ADR 222: Autor y hora se resuelven **enteramente en el cliente**, dentro de los invariantes del ADR 200 pto 5 — y sin tocar el servidor

**Contexto.** `agregarTurno` (`chat-client.ts:66-70`) concatena `autor + ": " + texto` en un `createTextNode` único. La página se construyó estática a propósito (ADR 200 pto 5): nunca `innerHTML`, CSP estricta sin `unsafe-inline`, sin dependencias.

**Decisión**:

1. **El turno pasa a ser una estructura, no una cadena**: un contenedor con `classList` por autor (empleado / arnés / sistema) y nodos hijos separados para autor, hora y texto — **todos por `textContent`/`createTextNode`, ninguno por `innerHTML`**.
2. ★ **Invariante negativo con test, molde ADR 98 pto 3** (el mismo que `aprobacion-conversacional-hitl` reusó en su ADR 207 pto 2): **una aserción que falla si `chat-client.ts` menciona `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` o asigna `style` inline.** Sin eso, la garantía depende de que nadie la rompa en el próximo refactor — *"un `if` se borra en un refactor distraído"* (ADR 98 pto 4).
3. **El color va por CSS, nunca por atributo `style`.** Las reglas nuevas viajan por el **mismo canal que `CHAT_CSS` ya usa hoy** — `sdd-design` verifica cuál es (hoja servida, `<style>` con hash, lo que sea) y **no inventa uno nuevo ni agrega `unsafe-inline` a la CSP**. **RD-105.**
4. **La hora la pone el cliente al pintar el turno**, no el servidor. Es una ayuda de lectura, **no un dato de auditoría**: la hora que vale para auditar es la de `registro_acciones_empleado`, que ya existe y no se toca. Decirlo explícito evita que alguien lea el chat como evidencia temporal de una operación.
5. **El color NO es el único portador de la distinción** (accesibilidad y daltonismo): el autor sigue escrito en texto. El color acompaña, no reemplaza.

**Alternativas consideradas**:

- **Marcar el autor desde el servidor** (que `POST /mensaje` devuelva rol y timestamp): **rechazada.** Cambia el contrato de una ruta autenticada del canal de empleado para resolver un problema de pintado, y arrastra al change un delta de `chat-web-empleado` sobre transporte. **El cliente ya sabe quién habló: es él quien lo agrega.**
- **Una micro-librería de formato de fechas**: **rechazada.** Cero dependencias nuevas, criterio sostenido desde v3.2. `Date` del navegador alcanza.
- **`innerHTML` con plantilla "controlada"**: **rechazada sin discusión.** Es exactamente el invariante que el ADR 200 pto 5 fijó, y el pto 2 lo vuelve mecánicamente verificable.

**Consecuencias**: dos archivos del adaptador web cambian, ninguno del núcleo. La superficie de review es pequeña y **auditable leyendo el diff del cliente**, sin necesidad de razonar sobre el servidor.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | **Sólo** el literal de respuesta de `ejecutarRegistrarVenta` (`:691-692`), con datos que ya están en el scope (ADR 221). **Ninguna rama de dispatch nueva, ninguna llamada nueva** |
| `src/adapters/web/chat-client.ts` | Modified | `agregarTurno` (`:66-70`) pasa a estructura con `classList` + hora (ADR 222 ptos 1, 4) |
| `src/adapters/web/chat-page.ts` | Modified | `CHAT_CSS` gana reglas por autor y disposición del sello de hora (ADR 222 pto 3) |
| `src/adapters/web/server.ts`, rutas, payloads, CSP | **Sin cambio** | **Si aparecen en el diff, el alcance se filtró** |
| `src/core/ventas/**` (las seis funciones deterministas y las tres puras de reporte) | **Sin cambio** | ADR 145 pto 5, **sin excepción** — a diferencia de v3.10 |
| Esquema / migraciones | **Sin cambio** | Cero migraciones. Próxima libre sigue siendo `0014` |
| Modelo de rol, `sesion.ts`, `puedeResolverAjeno` | **Sin cambio** | Este change no toca autorización |
| Tests | New/Modified | Eco de `registrar_venta` con nombre y `clienteId` y **sin `clienteEmail`**; DOM del chat con dos autores distinguibles por clase y con hora; **test mecánico de ausencia de `innerHTML`/estilo inline en `chat-client.ts`** |
| `package.json` | **Sin cambio** | Sin dependencias nuevas, criterio sostenido desde v3.2 |
| `docs/progreso/v3.11-ergonomia-canal-empleado/` | New | Evidencia de los dos entregables |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★ | **El eco filtra el email del cliente** al transcripto persistido, contradiciendo ADR 18 pto 4 sin que nadie lo note (es "sólo texto") | **Media** | ADR 221 pto 3: prohibido explícitamente, **con test que afirma la ausencia**. Es la única decisión de este change con consecuencia de privacidad, y por eso es requirement, no comentario |
| **R2** | **Presupuesto de review de 400 líneas** | **Baja** | Dos piezas chicas y desacopladas. `sdd-tasks` forecastea; si diera alto, el corte natural es **una PR por pieza** (eco / chat) |
| **R3** ★ | **Solapamiento territorial con `devolucion-autorizada-por-cliente`**: los dos tocan `ejecutar-operacion.ts` y la superficie de respuesta del canal | **Media-Alta si corren en paralelo** | **Recomendación de esta fase: ESTE change primero.** Es chico, no bloquea a nadie y deja el texto del eco estabilizado antes de que el otro lo lea. Mismo tratamiento que la R10 de v3.10 le dio a su conflicto con v3.9. **Decisión del checkpoint antes de `sdd-tasks`** |
| **R4** | **La estructura nueva del turno rompe el test de DOM de v3.9** que afirmaba sobre el nodo de texto concatenado | **Media** | Esperado y sano: el test **debe** cambiar con el contrato de presentación. Lo que **no** puede cambiar es ningún test de seguridad de la página — si uno de esos se toca, el change violó su *Out of Scope* |
| **R5** | **El sello de hora se lee como evidencia de auditoría** ("la operación fue a las 14:32") cuando es hora del navegador | **Baja-Media** | ADR 222 pto 4: dicho explícito en la spec y en el arc42 si corresponde. La hora auditable sigue siendo la de `registro_acciones_empleado` |
| **R6** | **El color como único portador de significado** (accesibilidad) | **Baja** | ADR 222 pto 5: el autor sigue en texto |

## Rollback Plan

1. **Las dos piezas son aditivas y revertibles por separado**, y ninguna deja estado atrás: **cero migraciones, cero columnas, cero backfill, cero estado de proceso nuevo**.
2. **El eco**: revertir el literal de `ejecutar-operacion.ts:691-692` a su forma actual. Nada más lo consume — la auditoría no lee el texto, lo arma aparte (`:684-689`).
3. **El chat**: revertir `agregarTurno` y las reglas de `CHAT_CSS`. La página vuelve a pintar texto plano; **ningún turno anterior queda ilegible**, porque nada se persistió con el formato nuevo (el historial se rearma del lado del cliente en cada carga).
4. **No hay rollback de datos posible ni necesario**: este change no escribe en ninguna tabla.

## Dependencies

- **Depende de `chat-web-empleado` (v3.9), ya mergeado**: la página, el cliente estático, la CSP y el molde de test de DOM.
- **Depende de `operaciones-negocio-conversacionales` (v3.6) y `aprobacion-conversacional-hitl` (v3.10), ya mergeados**: el dispatcher, `registrar_venta` y el vocabulario de las ocho operaciones (`operaciones-contract.ts:52-61`).
- ★ **Relación con `devolucion-autorizada-por-cliente` (change hermano, no arrancado)**: **sin dependencia funcional en ninguna dirección**, pero **sí territorial** sobre `ejecutar-operacion.ts`. **Recomendación: este change primero.** Ver **R3**.
- **Sin dependencias externas nuevas. Sin dependencias nuevas en `package.json`.**
- **Reusa, sin modificar**: `registrarVenta`, el contrato de la herramienta, `registro_acciones_empleado`, la CSP y el transporte del chat.

## Success Criteria

- [ ] **El eco de `registrar_venta` nombra al vendedor (que es el empleado autenticado del turno) y al cliente por `clienteId`, y CONSERVA `ventaId` y `casoId`** — verificado por test sobre el texto, no por captura.
- [ ] ★ **Existe un test que FALLA si el eco de `registrar_venta` contiene el email del cliente** (ADR 221 pto 3). Es el único criterio de este change con consecuencia de privacidad.
- [ ] **El chat distingue al menos dos autores por clase CSS y estampa una hora por turno**, verificado sobre el DOM (estructura y clases), no sobre el aspecto.
- [ ] ★ **Existe un test mecánico que FALLA si `chat-client.ts` menciona `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval` o asigna `style` inline** (ADR 222 pto 2).
- [ ] **La CSP no cambió y no ganó `unsafe-inline`**, verificado por `git diff` sobre `server.ts` y `chat-page.ts`.
- [ ] ★ **`git diff` confirma cero cambios en `src/core/ventas/`, cero cambios de esquema/migraciones, cero cambios en el modelo de rol o en `sesion.ts`, y cero dependencias nuevas en `package.json`.**
- [ ] **Los requirements de seguridad de `chat-web-empleado` siguen intactos** — ninguno editado, ninguno relajado.
- [ ] **Evidencia de verificación manual** en `docs/progreso/v3.11-ergonomia-canal-empleado/`: eco de `registrar_venta` legible y chat con cuatro turnos alternados distinguibles.
- [ ] `npm test`, typecheck y lint en verde; **TDD estricto**, con el rojo inicial en el test del eco (hoy pasa "en verde de la forma equivocada": el texto existe pero no nombra a nadie).

---

## Decisiones diferidas a `sdd-design` (RD)

Numeración continúa desde el techo verificado **RD-104** (Aclaración 1).

- **RD-105** — Forma exacta de la presentación del chat: cómo se sirve hoy `CHAT_CSS` y por dónde entran las reglas nuevas **sin agregar `unsafe-inline`**; paleta y contraste; formato del sello de hora (`HH:MM` local vs. completo); estructura DOM exacta del turno (cuántos nodos, qué clases, en qué orden) para que el test afirme estructura y no pixeles. **A verificar leyendo `chat-page.ts` y la CSP de `server.ts`, no razonando desde acá.**

## Qué necesita el checkpoint

1. ★ **¿Aprobás el corte en DOS changes** —éste, de presentación, y `devolucion-autorizada-por-cliente`, de seguridad— **en vez de uno solo con cinco unidades?** El argumento está en la Aclaración previa 2: junto, el riesgo concreto es que una decisión de seguridad se firme con el ojo puesto en lo cosmético.
2. ★ **¿Orden de merge? La recomendación de esta fase es: ESTE primero** (chico, sin decisiones abiertas), y que el otro rebase sobre el eco ya estabilizado (**R3**). **Es el único punto que puede bloquear el arranque del otro change.**
3. ★ **¿Confirmás que el eco NO muestre el email del cliente** (ADR 221 pto 3), aunque sea el dato más "humano" para nombrarlo? Si preferís mostrarlo, decilo explícito: es una excepción a ADR 18 pto 4 y tiene que quedar escrita como tal, no colarse.
4. **¿Confirmás que los ids se conservan** (ADR 221 pto 2) y que el pedido era *"que no sean sólo ids"*, no *"que no haya ids"*?
5. **¿Aprobás abrir en ADR 221-222** (por encima del techo real verificado, **220** — que **no** es el 211 que anunciaba el `proposal.md` de v3.10) **y no reabrir** la colisión 174-187 (**RD-94**, change propio)?
6. **¿Confirmás `v3.11.0` y el nombre de rama/carpeta de progreso?** Depende del punto 2.
