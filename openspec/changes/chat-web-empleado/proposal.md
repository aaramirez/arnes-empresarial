# Propuesta: Chat web de empleado — la interfaz visual que el reparto de canales del arc42 prometió y el hito v3.6 dejó sin construir, **con memoria conversacional real**

**Origen**: **Decisión del stakeholder**, sobre una deuda que el propio arc42 ya declaró. El arc42 (`docs/ARC42_Harness_Empresarial.md:572`) fija el reparto de canales en una línea textual — ***"chat = trabajo transaccional del empleado, TUI = administración"*** — y el hito v3.7 (`comandos-administracion-empleados`) ya cerró **la mitad de administración**. La mitad de chat **no existe como interfaz**: v3.6 construyó el backend completo (`POST /login`, `POST /operaciones`, seis operaciones de negocio vía MCP) y lo dejó **sólo consumible por `curl`**. La evidencia de cierre de ese hito lo muestra sin disimulo: `docs/progreso/v3.6-operaciones-conversacionales/verificacion-manual-tarea-15.md:54` es una respuesta JSON cruda de `/login` pegada de una terminal.

**Rama prevista**: `hito/v3.9-chat-web-empleado` · **Tag de cierre**: `v3.9.0` · **Carpeta de progreso**: `docs/progreso/v3.9-chat-web-empleado/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `operaciones-negocio-conversacionales`, `consultas-negocio-a2a-entrante` y `comandos-administracion-empleados`. **La numeración `v3.9.0` es propuesta, no fijada — es decisión del checkpoint.**

> ⛔ **REQUIERE CHECKPOINT HUMANO ANTES DE `sdd-spec` / `sdd-design`.** Dos motivos, y el segundo es el serio:
> 1. Es el **primer JavaScript de cliente del repo** — una decisión de infraestructura, no de feature (ADR 191).
> 2. **La memoria conversacional real colisiona con un invariante de seguridad ya escrito en el arc42** (`:566`) y ya implementado (`confirmacion-operaciones-store.ts:40-52`). No es una incompatibilidad inventada por esta propuesta: se verificó en el código y se documenta abajo como **Aclaración previa 3**. **No avanzar sin leerla.**

---

## Aclaración previa 1: el techo real de numeración — y una **patología de numeración ya presente en `main`** que hay que nombrar

Verificado por `grep` sobre **todo** el repo (`openspec/changes/*` en `proposal.md`, `design.md`, `tasks.md` y `specs/`, **más** `src/**` y `docs/**`, porque en esta serie los ADR se citan en doc-comments de código y el techo real puede vivir ahí). El precedente de `definicion-skills` —que descubrió que el techo real era 102 y no 93— obliga a reverificar siempre y a **no heredar el número del change anterior**.

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **188** | `operaciones-negocio-conversacionales/design.md:575`, y citado en código vivo: `src/core/operaciones/ejecutar-operacion.ts:92,160,180,190,287`, `src/build-on-operaciones-empleado.ts:84,145`, `src/main.ts:447` | **ADR 189** |
| **RD** | **RD-87** | `operaciones-negocio-conversacionales/design.md:573,575`, citado en `src/main.ts:447` y `src/core/operaciones/ejecutar-operacion.test.ts:195,583,585` | **RD-88** |

★ **Hallazgo de proceso que esta propuesta NO va a repetir y que el checkpoint debería ver**: el rango **ADR 174-187 está asignado TRES veces** a decisiones distintas y no relacionadas — `consultas-negocio-a2a-entrante` (174-180 en `proposal.md`, hasta 187 en `design.md`), `comandos-administracion-empleados` (174-179 en `proposal.md`, 180-185 en `design.md`) y `operaciones-negocio-conversacionales/design.md` (171-174, 188). Los tres changes se escribieron **en paralelo**, cada uno verificó el techo correctamente **en su momento**, y ninguno lo reverificó al mergear. Consecuencia concreta y verificable hoy: *"ADR 180"* significa **tres cosas distintas** según el archivo que lo cite — el recorte de datos personales A2A (`consultas-negocio-tool.ts:5`), la co-ubicación de `RolEmpleadoEscritorPort` (`comandos-administracion-empleados/design.md:5`) y el registro de acciones (`build-on-comando-empleado.ts:378`). **Esta propuesta no arregla esa colisión** —sería un change de documentación propio, y tocar ADRs ya citados por código vivo es exactamente el tipo de cambio ancho que esta serie evita— pero **la declara** y abre en 189, por encima del máximo absoluto, para no agregar una cuarta capa. Ver **R8** y **RD-94**.

## Aclaración previa 2: qué existe hoy exactamente, verificado — no hay servidor de estáticos y no hay tooling de frontend

1. **La superficie HTTP es un solo listener con ruteo por método+ruta**, en `src/adapters/web/server.ts:681-712`: una cadena de `if (method === X && path === Y)`, con `pathFromUrl` (`:133-139`) recortando el query string. Las dos rutas de v3.6 son `RUTA_LOGIN = "/login"` y `RUTA_OPERACIONES = "/operaciones"` (`src/adapters/web/config.ts:34,36`). **No hay ninguna rama que sirva un archivo estático, ni un `GET` que devuelva HTML que no sea `GET /confirmar/:token`** (`server.ts:340`) — que es HTML generado por función pura, no un archivo leído de disco.
2. **El precedente de UI es HTML server-side por funciones puras**: `src/adapters/web/render.ts`. Su regla, que el ADR 20 pto 2 marca como **no negociable** y el propio archivo repite en su encabezado (`render.ts:10-12`): *"TODO valor dinámico que venga de fuera (plan, monto, token) pasa por `escapeHtml` o `encodeURIComponent` antes de concatenarse — **nunca crudo**"*. `escapeHtml` (`:25-32`) escapa `& < > " '`, con `&` primero y el motivo documentado.
3. **CERO JavaScript de cliente en todo el repo.** Verificado, no supuesto.
4. **No hay bundler ni nada parecido**: `package.json` no tiene Vite, webpack, esbuild, Rollup ni Parcel. Hay `react@^18.3.1` pero **es para Ink** (TUI) — y el dato que cierra la discusión: **`react-dom` NO está instalado**, ni en `dependencies` ni en `devDependencies`. "Ya tenemos React" es **falso para web**: usar React en el navegador exigiría agregar `react-dom` **y** un bundler, o sea dos decisiones de infraestructura, no cero. Ver ADR 191.
5. ★ **No existe ninguna cabecera `Content-Security-Policy` en el repo.** Verificado por `grep` sobre todo el árbol: cero ocurrencias de `Content-Security-Policy`, `X-Frame-Options` y `X-Content-Type-Options`. Lo que sí hay, en las respuestas HTML (`server.ts:245-248`), es `Content-Type` con charset, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` y `X-Request-Id`. La ausencia de CSP **no es un bug hoy** —`GET /confirmar/:token` no ejecuta JS ni renderiza texto de modelo— pero **pasa a ser material** en el minuto en que una página del arnés muestre prosa generada por un LLM. Ver ADR 192.
6. **Sesión HTTP**: token opaco `randomUUID` en un `Map` de proceso (`src/adapters/web/sesion-empleado-store.ts:28-42`). El puerto tiene **exactamente dos métodos**, `crear` y `buscar` (`:21-26`). ★ **No hay `eliminar`: el logout no es que esté sin exponer — es INEXPRESABLE con el puerto actual.** Tampoco hay evicción de sesiones vencidas (`buscar` las filtra pero nunca las borra del `Map`). El TTL es absoluto y **desactivable**: `SESION_TTL_MINUTOS=0` ⇒ `expiraEn` ausente ⇒ *"sin expiración"* (`src/core/auth/sesion.ts:15`, ADR 31 pto 2), y el arc42 ya lo dice con todas las letras (`:555`): *"una sesión sin `expiraEn` puede no expirar nunca"*.
7. **El turno de `/operaciones` tiene techo de 120 segundos**: `OPERACIONES_TIMEOUT_MS = 120_000` (`config.ts:43`), tras el cual la ruta responde `504`. Y el body tiene tope de 64 KiB (`DEFAULT_WEB_MAX_BODY_BYTES = 65_536`, `config.ts:21`).

## Aclaración previa 3 (★ **el hallazgo de mayor impacto de esta fase**): la memoria conversacional real **choca de frente con un invariante de seguridad ya escrito en el arc42**, y el mecanismo de memoria del arnés **no es el que parece**

El stakeholder decidió que el chat tenga **memoria conversacional real** — que *"confirmá esa venta"* pueda referirse a algo dicho en un mensaje anterior. Esta propuesta **no reabre esa decisión**. Pero al bajarla al código aparecieron dos cosas que cambian el tamaño del problema, y las dos están verificadas.

### (a) La memoria multi-turno del arnés NO se ensambla desde la base de datos: se delega al SDK vía `resume`, y está **escopeada por `(casoId, agentId)`**

`assembleContext` (`src/core/turn-selector/assemble-context.ts:146-162`) hace exactamente dos lecturas: resuelve el `caso` y llama `getLatestSesionAgente(casoId, agentId)`, devolviendo `resumeSessionId`. El encabezado del módulo (`:8-14`) cita el arc42 textualmente: *"el Ensamblador de Contexto resuelve vía I3 la sesión del SDK a retomar (`options.resume`), **que aporta el historial completo de ese agente**"*. O sea: **el historial conversacional lo tiene el SDK, y la llave para recuperarlo es el par `(casoId, agentId)`.** No hay un ensamblado manual de mensajes previos que se pueda "ampliar" — hay una llave que resuelve o no resuelve.

Y hoy **no resuelve nunca**, por una sola línea: `src/build-on-operaciones-empleado.ts:171` hace `const casoId = newId()` **en cada invocación**. Cada mensaje del empleado es un `caso` nuevo, con `sesion_agente` nuevo, con `resumeSessionId: undefined`. El turno arranca amnésico **por construcción**, y `:203` devuelve ese `casoId` efímero al cliente junto con la respuesta.

**Consecuencia**: dar memoria real es, en su forma más simple, **dejar de generar un `casoId` nuevo por mensaje**. Es un cambio de una línea en apariencia. Y es justo esa apariencia la que esconde (b).

### (b) ★ Hay un invariante de seguridad que **depende de que el `casoId` cambie entre mensajes** — y está escrito en el arc42, no sólo en el código

`operaciones-negocio-conversacionales` resolvió la confirmación humana de `cancelar_solicitud_interna` (ADR 166 pto 3) con este predicado, literal (`src/adapters/web/confirmacion-operaciones-store.ts:40-52`):

```ts
pendiente.origenCasoId !== casoIdActual
```

El comentario que lo acompaña (`:31-39`) explica el propósito: *"estructuralmente imposible que dos invocaciones de la tool dentro del MISMO `handleTurn` (mismo `casoIdActual`) se autoconfirmen... **Solo un turno POSTERIOR (mensaje nuevo del empleado, `casoId` nuevo) puede confirmar**"*. Y el arc42 lo elevó a garantía de arquitectura (`:566`): *"un `casoId` de origen (`origenCasoId`) hace estructuralmente imposible que la misma invocación se autoconfirme en el mismo turno — **la confirmación exige un turno conversacional posterior y distinto**"*. La spec vigente lo pide en abstracto (`specs/herramienta-operaciones-negocio/spec.md:49`): *"SHALL requerir un turno explícito de confirmación"*.

**El choque, en una línea: si una conversación de chat reusa UN solo `casoId` para todos sus mensajes, `casoIdActual` nunca cambia, `origenCasoId !== casoIdActual` es siempre `false`, y `cancelar_solicitud_interna` se vuelve IMPOSIBLE de confirmar.**

Conviene decir con precisión **en qué dirección** falla, porque es contraintuitivo y porque determina la severidad: **no falla abierto, falla cerrado**. No habilita una autoconfirmación; **rompe la funcionalidad** — el empleado dice "sí, cancelá" y el arnés nunca le da por confirmado. Es un bug de producto, no un agujero de seguridad. **Pero la tentación de arreglarlo relajando el predicado SÍ es un agujero de seguridad**, y es exactamente el camino que un `apply` apurado tomaría: si alguien "corrige" el predicado para que la confirmación vuelva a funcionar con `casoId` fijo, está borrando el mecanismo que el arc42 declara como estructural. **Por eso esto tiene que estar decidido ANTES de `sdd-apply`, no descubierto durante.** Ver ADR 189 pto 4 y **R1**.

### Las dos opciones, con su costo — **y esta propuesta NO elige entre ellas**

| | **Opción A — un `casoId` por conversación** | **Opción B — `casoId` por mensaje + agrupador de conversación** |
|---|---|---|
| Cómo da memoria | `getLatestSesionAgente(casoId, agentId)` resuelve solo; `resume` llega gratis | Hace falta un mecanismo nuevo que resuelva la sesión a retomar **a través de** varios `casoId` |
| Costo de construcción | **Bajo** — deja de llamarse `newId()` por mensaje | **Alto** — concepto, tabla/índice y puerto nuevos; hoy no existe nada que agrupe `casos` |
| Efecto sobre ADR 166 pto 3 / arc42:566 | ★ **Lo rompe** (confirmación imposible) — exige rediseñar el predicado de confirmación con el mismo rigor, sin relajarlo | **Lo conserva intacto**: cada mensaje sigue teniendo su `casoId` propio y distinto |
| Efecto sobre el modelo de datos | Un `caso` pasa a ser de vida larga; `casos.estado`/`updatedAt` cambian de semántica | Aditivo; `casos` no cambia de semántica |
| Riesgo de contexto ilimitado | Alto — una conversación larga acumula historial sin techo | Igual de alto: el techo hay que ponerlo explícito en cualquiera de las dos |

**Esta decisión es de `sdd-design`, no de esta fase.** Se deja escrita como **RD-88**, la más importante del change, con una instrucción explícita en el ADR 189 pto 4: **cualquiera de las dos que se elija, el invariante de "la confirmación exige un turno posterior y distinto" se conserva — lo que puede cambiar es el MECANISMO que lo implementa, nunca la garantía.** Es el mismo criterio de "distinguir el invariante del mecanismo" que el ADR 174 de `consultas-negocio-a2a-entrante` ya usó para enmendar el ADR 98 sin tocar su invariante.

---

## Intent

El arnés tiene, hoy en `main`, un backend de chat de empleado **completo y testeado**: autenticación por token, seis operaciones de negocio conversacionales sobre funciones deterministas, confirmación humana, timeout, drenaje de turnos en vuelo al cerrar. Y tiene **cero formas de usarlo que no sean `curl`**. El reparto de canales que el arc42 declara en `:572` está ejecutado en su mitad de administración (v3.7, comandos de TUI) y **sin ejecutar en su mitad de chat**, que es —según esa misma línea— donde vive *"el trabajo transaccional del empleado"*.

El objetivo es **construir esa interfaz**, y construirla con la propiedad que el stakeholder marcó como no negociable: **memoria conversacional real**. Un chat sin memoria es un formulario con estética de chat — obliga al empleado a repetir el identificador completo en cada mensaje, que es exactamente la fricción que `operaciones-negocio-conversacionales` se propuso eliminar (su propio *Intent* lo dice: *"la sintaxis posicional actual obliga al empleado a conocer el token de confirmación de una venta antes de poder pedir su devolución"*). Resolver eso a medias sería reintroducir la fricción por la puerta de atrás.

El costo arquitectónico real **no está donde la intuición lo pone**. No está en el HTML ni en el CSS: está en dos lugares que la Aclaración 2 y la 3 localizan con precisión. **Primero**, el chat es el primer consumidor del arnés que renderiza **prosa generada por un LLM dentro de un DOM**, con un token de sesión al alcance de ese mismo DOM — una combinación que el repo nunca tuvo y para la que su regla vigente (`escapeHtml` server-side, ADR 20 pto 2) **no aplica tal cual**, porque el texto ya no se concatena en el servidor. **Segundo**, la memoria real toca el mecanismo de `resume` del Selector de Turno, que es infraestructura compartida por los cuatro turnos del arnés, y colisiona con un invariante de confirmación humana ya escrito en el arc42.

---

## Scope

### In Scope

- ★ **Memoria conversacional real, como requisito NO NEGOCIABLE del hito.** Decidido por el stakeholder; **esta propuesta no lo reabre y `sdd-design` tampoco puede diluirlo a "turnos independientes"**. El criterio de aceptación es conductual y se verifica de punta a punta: *el empleado menciona algo en el mensaje N y lo referencia deícticamente ("esa venta", "confirmá eso", "la que te dije") en el mensaje N+1, y el arnés resuelve la referencia sin que el empleado repita el identificador.* **Qué mecanismo lo implementa es RD-88** (Aclaración 3), no alcance de esta fase.
- **Interfaz de chat servida por el arnés**: una ruta `GET` nueva en el **mismo listener** de `src/adapters/web/server.ts` (ADR 190), que entrega la pantalla de login y la de chat. Molde de ruteo: la cadena de `if` de `:681-712`; molde de respuesta HTML: `responderHtml` (`:245-248`).
- **JavaScript de cliente propio, vanilla, sin bundler y sin dependencias nuevas** (ADR 191): envío del mensaje, render incremental de la conversación, estado de espera, estado de error, logout.
- **Defensa de XSS en el cliente como invariante de spec, no como cuidado de implementación** (ADR 192): el texto de `respuesta` —**generado por el modelo**— se inserta como **texto**, jamás como HTML, y la página va con `Content-Security-Policy` que prohíbe `unsafe-inline` y script de terceros. **Es el riesgo de severidad más alta del change (R2)** y recibe el mismo tratamiento que `consultas-negocio-a2a-entrante` le dio a su R2 (recorte de datos personales): decisión en el ADR, invariante en la spec, **y test en negativo**.
- **Postura explícita de almacenamiento del token de sesión** (ADR 193), dado que el adaptador hoy no soporta cookies y el token se responde en el body JSON de `/login` (`server.ts:580-581`).
- **La espera larga como estado de primera clase de la UI** (ADR 194): con `OPERACIONES_TIMEOUT_MS = 120_000`, un turno puede tardar dos minutos y terminar en `504`. La UI **declara** ese estado; no lo deja como un spinner infinito.
- **Logout de verdad**, lo que exige **agregar un tercer método al `SesionEmpleadoStore`** (`eliminar`/`cerrar`), hoy inexistente (Aclaración 2 pto 6) — y la ruta que lo expone. Ver ADR 195.
- **Manejo explícito de los códigos que `/operaciones` ya devuelve**: `401` (sesión vencida o token inválido ⇒ volver a login **sin perder lo escrito**), `400`, `502`, `504`. Están todos implementados en el backend y hoy no los interpreta nadie.
- **Evidencia de verificación manual** en `docs/progreso/v3.9-chat-web-empleado/`, molde `verificacion-manual-tarea-15.md` — **reemplazando las capturas de `curl` por capturas de la interfaz real**, y con al menos un caso de memoria multi-turno (mensaje N + referencia deíctica en N+1) y uno de intento de XSS.
- **arc42 + README**: el Concepto que cierra el reparto de canales por el lado de chat, simétrico al Concepto 8 que cerró administración.

### Out of Scope

- **Cambiar el contrato de `POST /operaciones` o de `POST /login`.** Las dos rutas quedan **tal como están**, con su shape de request y response actual — son el contrato que esta interfaz consume. Si aparecen en el diff con un cambio de contrato, **el alcance se filtró**. (Distinto de agregar rutas **nuevas**, que sí está en alcance.)
- **Modificar cualquiera de las seis funciones deterministas de negocio**, la herramienta `operaciones`, o su validación. Invariante heredado de `operaciones-negocio-conversacionales` y del ADR 7: **el camino del dinero no se toca**. Esta propuesta agrega una vista, no una capacidad de negocio.
- **Dar chat de empleado al turno de cliente de `POST /soporte`, o exponer la herramienta `operaciones` por cualquier ruta sin sesión.** El ADR 146 sigue vigente sin matiz. La ruta `/soporte` **no se toca en este change**.
- **Un framework de frontend, un bundler, o cualquier dependencia nueva en `package.json`.** Ver ADR 191.
- **Un modelo de roles nuevo.** `autorizacion-empleado` (v3.5) y `comandos-administracion-empleados` (v3.7) ya cerraron eso. El chat **reproduce la autorización vigente y no agrega ni quita un permiso** — mismo criterio que el ADR 151 pto 3.
- ★ **Cambiar QUÉ ve un empleado.** En particular, `consultar_reporte_comisiones` **sigue sin gate de rol y sin escopar por vendedor** — la **R12** heredada y explícitamente aceptada por el checkpoint (arc42 `:568`). Este change **la hereda sin agravarla ni resolverla**, pero hay que decir en voz alta que **ensancha su canal**: de "HTTP autenticado que hay que saber armar con `curl`" a "un chat con caja de texto". Es el mismo razonamiento que la Enmienda 5 de `operaciones-negocio-conversacionales` ya aplicó al pasar de TUI a HTTP. **No es una brecha nueva; es la misma brecha con menos fricción de acceso.** Ver **R6** — y es un punto que el checkpoint debería mirar de frente.
- **Resolver la colisión de numeración ADR 174-187** (Aclaración 1). Change propio. Ver **RD-94**.
- **Streaming de la respuesta token por token.** El backend responde `{casoId, respuesta}` de una sola vez (`build-on-operaciones-empleado.ts:203`); hacerlo incremental exigiría cambiar el contrato de `/operaciones` y el shape de `handleTurn`. **Diferido explícitamente.** Ver ADR 194 alternativas y **RD-92**.
- **Adjuntar archivos, imágenes, historial persistente navegable entre dispositivos, o notificaciones push.**
- **Cookies `HttpOnly` / `Secure` / `SameSite` como mecanismo de sesión.** Es la mitigación estructuralmente correcta para R2 y **no está en alcance**: el adaptador hoy no parsea ni emite cookies en ninguna ruta, y agregarlo cambia el contrato de `/login` (que devuelve el token en el body). Se declara como la salida de crecimiento del ADR 193, con condición de disparo escrita. Ver **RD-91**.
- **HTTPS / TLS.** El arnés sirve HTTP plano y su despliegue está fuera del repo. Sin TLS, el token viaja en claro — **limitación heredada del entorno de despliegue, no introducida por este change**, pero que un chat de uso real vuelve mucho más fácil de explotar. Ver **R7**.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado por `Glob` en esta fase: **62 archivos**. **`sdd-spec` debe reverificar por `Glob` antes de fijar nombres** — el conteo cambió en cada change de esta serie.

### New Capabilities

- **`chat-web-empleado`** — el contrato de la interfaz: qué rutas la sirven, las pantallas (login / chat), el ciclo de un mensaje contra `POST /operaciones`, el tratamiento **exhaustivo** de `401`/`400`/`502`/`504`, el estado de espera larga (ADR 194), el logout (ADR 195), y **los invariantes negativos que son el corazón del change**: el texto del modelo nunca se interpreta como HTML; la página no ejecuta script inline ni de terceros; el token nunca aparece en la URL, ni en el DOM renderizado, ni en un log de cliente.
- **`memoria-conversacional-empleado`** — el requisito conductual de memoria multi-turno, **redactado sobre el EFECTO observable y no sobre el mecanismo**: que una referencia deíctica en el mensaje N+1 resuelve contra lo dicho en el mensaje N dentro de la misma conversación; que la memoria está escopeada a **un empleado y una conversación** (la de un empleado nunca alcanza a otro, ni siquiera concurrente); que una conversación tiene un principio explícito; y **que la garantía de "la confirmación exige un turno posterior y distinto" se conserva sea cual sea el mecanismo elegido** (ADR 189 pto 4).

La separación sigue el criterio que `definicion-skills` fijó (`registro-skills` vs. `habilitacion-skills-turno`) y que `consultas-negocio-a2a-entrante` reusó: **se verifican distinto**. La primera es superficie y render, verificable contra el adaptador y el DOM. La segunda es comportamiento del turno a través de varios mensajes, verificable contra dobles del Selector de Turno — **y sobrevive intacta si `sdd-design` cambia de opinión entre Opción A y Opción B**, que es precisamente por qué se redacta sobre el efecto.

### Modified Capabilities

- **`turno-empleado-autenticado`** (`operaciones-negocio-conversacionales/specs/`) — **delta muy probable y el más delicado del change**. Su *Fuera de alcance* dice hoy, textual (`spec.md:9`): *"qué transporte expone el turno — TUI, HTTP nuevo autenticado, o ambos (RD-69)"*. Este change **cierra ese RD-69 por el lado de la interfaz visual**. Además, si `sdd-design` elige la Opción A, la semántica de `casoId` por turno cambia y esta spec es donde eso vive. **Sus tres requirements de seguridad —sesión por closure y nunca por el modelo (`:15`), prompt de empleado distinto del de cliente (`:24`), y turno sin sesión vigente sin herramienta (`:33`)— se conservan SIN CAMBIO.** Si alguno se debilita, el change violó su propio *Out of Scope*.
- **`cancelacion-solicitud-interna`** y **`herramienta-operaciones-negocio`** (ambas en `operaciones-negocio-conversacionales/specs/`) — **delta condicionado a RD-88, y hay que decirlo así**. `herramienta-operaciones-negocio/spec.md:49` exige *"un turno explícito de confirmación"*. Ese requirement está redactado sobre el **efecto**, así que por el criterio vigente de esta serie **no necesita delta**. Pero si la Opción A obliga a reimplementar el predicado `origenCasoId !== casoIdActual`, el delta hay que escribirlo **para reafirmar la garantía con el mecanismo nuevo, nunca para relajarla**. **Instrucción explícita para `sdd-spec`: si al escribir este delta el texto resultante es más PERMISIVO que el vigente, parar y volver al checkpoint.**
- **`soporte-web-turno`** — **candidata, a verificar leyendo el archivo, no razonando desde acá.** Criterio vigente de la serie: hay delta **sólo si** la spec contiene un requisito **exhaustivo sobre el canal** (*"la única ruta HTML del adaptador web es X"*). Si está redactada sobre el **efecto** (el turno de cliente es anónimo y no tiene la herramienta), **no hay delta** — este change no toca `/soporte`. **Es la verificación más importante de `sdd-spec` en este change**, junto con la de `cancelacion-solicitud-interna`.

---

## Approach

Cinco piezas, en orden de dependencia — **y el orden importa, porque la 1 puede invalidar el diseño de la 3**:

1. **Resolver RD-88 (el mecanismo de memoria) ANTES de escribir una línea de UI.** Es lo único del change que puede obligar a tocar el núcleo (`assemble-context.ts`, el modelo de `casos`) y lo único que colisiona con un invariante escrito. Si se descubre tarde, la UI se rehace. `sdd-design` decide Opción A o B con el ADR 189 como marco.
2. **Rutas nuevas en el listener existente** (ADR 190): `GET` de la interfaz + la ruta de logout (ADR 195). Molde: la cadena de `if` de `server.ts:681-712`, y `responderHtml` (`:245-248`) **ampliado con CSP** (ADR 192).
3. **La página**: HTML por función pura en `render.ts` o un módulo hermano —respetando la regla del ADR 20 pto 2 para lo que se concatene en el servidor— **más** el script de cliente vanilla (ADR 191), servido como asset propio y no inline, que es lo que hace cumplible la CSP sin `unsafe-inline`.
4. **El ciclo de mensaje en el cliente**: `POST /operaciones` con `Authorization: Bearer`, render del turno **como texto** (ADR 192), estado de espera con el techo de 120 s (ADR 194), y la tabla exhaustiva de códigos de error.
5. **Tercer método en `SesionEmpleadoStore`** (ADR 195), evidencia manual y documentación.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 189-195)

La numeración continúa el techo real **ADR 188** (Aclaración 1). Las decisiones de nivel diseño reservan **RD-88 en adelante** (techo real RD-87).

### ADR 189: La memoria conversacional real es **requisito del hito, no una mejora opcional** — y el **invariante** de confirmación humana se conserva aunque cambie su **mecanismo**

**Contexto.** Aclaración 3. El stakeholder decidió memoria real, a sabiendas de que es el camino de mayor esfuerzo. El código actual es amnésico por una línea (`build-on-operaciones-empleado.ts:171`), la memoria del arnés se delega al SDK vía `resume` escopeado por `(casoId, agentId)` (`assemble-context.ts:146-162`), y hay un invariante de seguridad escrito en el arc42 (`:566`) que **depende de que el `casoId` cambie entre mensajes**.

**Decisión**:

1. **La memoria conversacional real es un requisito no negociable de este change.** Pasa a ser requirement de la capability `memoria-conversacional-empleado`, redactado sobre el **efecto observable** (referencia deíctica que resuelve entre mensajes), **no sobre el mecanismo**. Un chat de turnos independientes **no satisface este change** y no puede aceptarse como entrega parcial.
2. **El mecanismo NO se elige en esta fase.** Las dos opciones viables están identificadas y acotadas (Aclaración 3), con sus costos. La elección es **RD-88**, de `sdd-design`, al bajar a firmas y modelo de datos. Fijarla acá sería decidir sin la información que sólo aparece al diseñar.
3. **Se distingue el invariante del mecanismo**, mismo criterio que el ADR 174 de `consultas-negocio-a2a-entrante` usó sobre el ADR 98. **Invariante**: *la confirmación de `cancelar_solicitud_interna` exige un turno conversacional posterior y distinto del que la propuso* (arc42 `:566`). **Mecanismo**: el predicado `pendiente.origenCasoId !== casoIdActual`. **El invariante se conserva sin matiz. El mecanismo puede cambiar si —y sólo si— la Opción A lo vuelve inaplicable.**
4. ★ **Instrucción operativa, escrita para el reviewer y para `sdd-apply`**: si la memoria se implementa reusando un `casoId` y eso hace que la confirmación deje de funcionar, **la corrección NO es relajar el predicado**. Hay que sustituirlo por otro discriminante de "mensaje posterior y distinto" con la misma propiedad estructural (por ejemplo un identificador por mensaje, distinto de `casoId`) y **cubrirlo con un test que falle si dos invocaciones del MISMO mensaje se autoconfirman**. Ese test es obligatorio en cualquiera de las dos opciones.
5. **Cualquiera sea el mecanismo, la memoria está escopeada por empleado.** Dos empleados concurrentes nunca comparten memoria. Es el mismo criterio que `confirmacion-operaciones-store.ts:55` ya aplica a su ranura (*"Ranura propia de `empleadoId` — N empleados concurrentes nunca se pisan"*) y **se testea igual**.
6. **El techo de contexto se decide, no se omite.** Una conversación con memoria crece sin límite natural. `sdd-design` fija qué la termina (inactividad, tope de mensajes, logout, reinicio de proceso) — **RD-89**. No fijarlo es dejar un crecimiento sin techo en un `Map` de proceso, que es la misma clase de omisión que la Aclaración 2 pto 6 ya encontró en las sesiones vencidas.

**Alternativas consideradas**:

- **Turnos independientes, sin memoria, con la UI repitiendo el contexto**: **rechazada — el stakeholder la descartó explícitamente.** Y tiene un defecto técnico propio que conviene dejar escrito: reinyectar el historial desde el cliente pone el contexto **bajo control del navegador**, o sea del usuario — un empleado podría alterar lo que el arnés "recuerda" que él dijo. Peor que no tener memoria.
- **Memoria en el prompt, reinyectada por el servidor** (el servidor guarda los mensajes y los concatena): **rechazada como decisión por defecto, pero NO descartada del todo** — es, en rigor, una tercera variante de la Opción B. Duplica el trabajo que el `resume` del SDK ya hace y contradice el diseño que el arc42 declara para el Ensamblador de Contexto. **`sdd-design` puede revisitarla dentro de RD-88** si Opción A y B resultan ambas caras.
- **Elegir Opción A acá, por ser la barata**: **rechazada.** Es la que rompe el invariante del arc42, y elegirla sin haber diseñado su reemplazo sería exactamente el atajo que el pto 4 prohíbe.

**Consecuencias**: el change no puede empezar por la UI. La pieza 1 del Approach es de diseño puro y bloquea a las otras cuatro.

### ADR 190: El chat se sirve desde el **MISMO listener HTTP**, como extensión de `src/adapters/web/`, no como adaptador nuevo

**Contexto.** El arnés ya expone `/login` y `/operaciones` en `src/adapters/web/server.ts`, con ruteo por método+ruta (`:681-712`). La interfaz consume exactamente esas dos rutas.

**Decisión**:

1. **Rutas nuevas en la cadena de ruteo existente**, no un segundo servidor ni un proceso aparte. Se conserva el criterio vigente de **un solo listener HTTP con ruteo por método+ruta**.
2. **Precedente exacto, ya en el repo**: `GET /confirmar/:token` (`server.ts:340`) ya sirve HTML para un humano con navegador desde este mismo listener. El chat es **el mismo tipo de ruta**, con más pantallas.
3. **`src/core/` no se entera.** El frontend habla HTTP contra `/operaciones`, igual que `curl` hoy. La regla de `AGENTS.md` (*`src/core/` nunca importa de `src/adapters/*`*) **no entra en tensión en ningún punto de este change** — y eso es verificable por `git diff`: si aparece un import de `adapters` dentro de `core`, el change se desvió.
4. **El drenaje de turnos en vuelo al cerrar no cambia.** `server.ts:752-771` ya envuelve `onOperacionesEmpleado` para drenar con el `Set` compartido; la interfaz no agrega turnos por otra vía, así que hereda esa garantía **sin tocarla**.

**Alternativas consideradas**:

- **Un adaptador `src/adapters/chat/` separado con su propio listener**: **rechazada.** Dos puertos que servir, dos configuraciones, dos ciclos de cierre, y CORS entre ellos — complejidad nueva para separar cosas que comparten sesión y contrato.
- **Servir el frontend por fuera del arnés** (nginx, CDN, `file://`): **rechazada.** Convierte un problema de misma-origen en uno de CORS más credenciales cruzadas, que es estrictamente peor para R2, y agrega una pieza de despliegue que el repo no tiene.

**Consecuencias**: el diff se concentra en `src/adapters/web/`. El cierre ordenado, el logging por `requestId` y el tope de body se heredan sin escribir nada.

### ADR 191: **Vanilla JS sin bundler y sin dependencias nuevas** — porque "ya tenemos React" es **falso para web**

**Contexto.** Aclaración 2 pto 4. Es el primer JS de cliente del repo, así que la decisión es de **infraestructura**, no de feature: fija con qué se escribe el frontend de acá en adelante. El argumento intuitivo (*"React ya está instalado"*) **se verificó y no se sostiene**: `react@^18.3.1` está para **Ink** (TUI), y **`react-dom` no está instalado**. Usar React en el navegador exigiría `react-dom` **más** un bundler (no hay ninguno) **más** integrarlo al `build` actual, que es un `tsc -p tsconfig.json` y nada más.

**Decisión**:

1. **JavaScript de cliente vanilla, servido como asset propio** (no inline — es lo que hace cumplible la CSP del ADR 192 sin `unsafe-inline`).
2. **Cero dependencias nuevas en `package.json`.** Criterio ya declarado como *Out of Scope* por `operaciones-negocio-conversacionales` y `consultas-negocio-a2a-entrante`; acá se sostiene.
3. **Cero pasos nuevos de build.** `npm run build` sigue siendo `tsc`. Si el frontend necesita transpilarse o empaquetarse, la decisión se tomó mal.
4. **El alcance lo justifica**: una caja de texto, una lista de mensajes, cuatro estados (idle / esperando / error / sesión vencida) y una llamada `fetch`. Es el tamaño de problema para el que un framework es costo neto.
5. **Condición de disparo escrita, para que esto no sea dogma**: el día que el frontend tenga varias vistas con ruteo de cliente y estado compartido no trivial, este ADR se reabre. **Hasta entonces, vanilla es el techo.**

**Alternativas consideradas**:

- **React + `react-dom` + Vite**: **rechazada.** Tres piezas de infraestructura nueva (dependencia de runtime, bundler, paso de build) para una pantalla. Contradice el *Out of Scope* de dependencias que esta serie sostiene desde v3.2.
- **Ink reusado en el navegador**: **rechazada — no es posible.** Ink renderiza a un TTY, no a un DOM. Compartir componentes entre TUI y web no está sobre la mesa.
- **Sin JS de cliente: HTML server-side puro con `<form>` y recarga completa**, extendiendo `render.ts`: **rechazada, y es la alternativa seria — merece decir por qué se descarta.** Sería el máximo de coherencia con el precedente del repo (ADR 20) y **eliminaría de raíz el vector de XSS del ADR 192**, porque todo el escapado volvería a ser server-side con `escapeHtml`. Se descarta porque **un turno de hasta 120 s con recarga completa de página es inusable**: el navegador queda en blanco dos minutos sin poder mostrar estado de progreso, y cualquier reintento reenvía el `POST`. La contrapartida es asumir el vector de XSS **a conciencia**, que es exactamente lo que el ADR 192 hace en vez de dejarlo implícito. **`sdd-design` puede revisitarla si encuentra que el ciclo de mensaje tolera la recarga — RD-90.**

**Consecuencias**: el frontend es simple y auditable de una sentada, sin `node_modules` de por medio. El costo es que todo se escribe a mano; con este alcance, es el intercambio correcto.

### ADR 192: El texto del modelo se inserta como **TEXTO, jamás como HTML** — y la página va con **CSP**. Es el riesgo de mayor severidad del change

**Contexto.** Éste es el punto donde el chat introduce una clase de riesgo que el arnés **nunca tuvo**. El campo `respuesta` de `POST /operaciones` es prosa **generada por un LLM** (`build-on-operaciones-empleado.ts:203`, `result.responseText`), y el modelo la redacta a partir de datos de negocio que **empleados escribieron** — el `detalle` de una solicitud interna es texto libre, y `consultas-negocio-a2a-entrante` ya documentó que ese campo es *"campo abierto donde un empleado puede haber escrito cualquier cosa"* (su ADR 180 pto 2). O sea: hay un camino por el que texto controlable por un usuario llega a la prosa del modelo, y de ahí al DOM del chat.

La regla vigente del repo (ADR 20 pto 2, `render.ts:10-12`) —*"TODO valor dinámico pasa por `escapeHtml`, nunca crudo"*— **es la regla correcta pero no se aplica sola acá**: está escrita para concatenación **server-side**, y en el chat el texto se inserta **en el cliente**, donde `escapeHtml` no participa. Un `innerHTML` distraído en el script de cliente **evade la regla del repo sin violar ni una línea de `render.ts`**.

Y lo que lo vuelve severo y no molesto: **el token de sesión vive en JS accesible al mismo DOM** (ADR 193, forzado por la Aclaración 2 pto 6 — no hay cookies `HttpOnly` disponibles). **XSS exitoso ⇒ robo de sesión ⇒ acceso completo a las seis operaciones de negocio**, incluido el camino del dinero. La cadena es corta y es real.

**Decisión**:

1. **Invariante de spec, no recomendación de estilo**: el texto de `respuesta` —y el del propio empleado— se inserta **siempre** por la vía de texto del DOM (`textContent` / `createTextNode`). **`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` y `eval` no aparecen en el frontend, en ningún camino.**
2. **Test mecánico obligatorio**, con el molde de *test de lista de imports* que el ADR 98 pto 3 ya usa y que `consultas-negocio-a2a-entrante` reusó: una aserción sobre el **texto fuente** del asset de cliente que **falla** si alguno de esos identificadores aparece. Es la única forma de que la garantía sobreviva a un refactor distraído — *"un `if` se borra en un refactor distraído"* (ADR 98 pto 4), y una convención de estilo también.
3. **Test en negativo, de punta a punta**, mismo criterio que el ADR 180 de `consultas-negocio-a2a-entrante`: con una `respuesta` que contiene `<script>`, `<img onerror=...>` y comillas, el DOM resultante **no gana un elemento ejecutable** y el texto se ve literal en pantalla.
4. **`Content-Security-Policy` en las respuestas HTML del chat**, como **segunda línea** y no como sustituto de los ptos 1-3. Sin `unsafe-inline`, sin script de terceros. Es cumplible **porque** el ADR 191 pto 1 sirve el script como asset propio. **La directiva exacta es RD-93.**
5. **La ausencia de CSP en el resto del adaptador NO se toca en este change.** `GET /confirmar/:token` no ejecuta JS ni renderiza texto de modelo; agregarle CSP es correcto pero es alcance ajeno. **Se declara como deuda nombrada, no se arrastra en silencio.**
6. **Lo que el servidor concatene sigue bajo ADR 20 pto 2**, sin excepción. Este ADR **agrega** una regla para el cliente; no reemplaza ni debilita la del servidor.

**Alternativas consideradas**:

- **Renderizar Markdown para que las respuestas se vean lindas**: **rechazada, y es la alternativa peligrosa justamente porque es la más tentadora** — es lo que todo chat hace. Exigiría una dependencia nueva (contra ADR 191) y, sobre todo, **convertiría "insertar como texto" en "parsear e insertar como HTML"**, que es literalmente el vector del pto 1. Si alguna vez entra, entra con sanitizador auditado y ADR propio. **Hoy: texto plano con saltos de línea preservados por CSS.**
- **Confiar en que el modelo no emite HTML**: **rechazada por la misma razón que el ADR 180 pto 3 rechazó pedirle al modelo que no revele datos personales.** El repo ya tiene la lección escrita (`soporte-prompt.ts`): las líneas de seguridad del prompt son necesarias pero **nunca suficientes**. Un recorte pedido por prompt es una sugerencia; uno hecho en la función es un hecho.
- **Escapar en el servidor antes de responder `respuesta`**: **rechazada.** Cambiaría el contrato de `/operaciones` (*Out of Scope*) y rompería a los consumidores no-HTML de esa ruta, que la ven como texto y no como HTML.

**Consecuencias**: el change deja el arnés **con una defensa que antes no necesitaba**, y la deja testeada en vez de confiada. El costo es que el chat muestra texto plano.

### ADR 193: El token **no va a `localStorage`** — vive en memoria de la pestaña, y la salida estructural queda con condición de disparo escrita

**Contexto.** `POST /login` devuelve el token en el **body JSON** (`server.ts:580-581`), y el adaptador **no emite ni parsea cookies en ninguna ruta** (Aclaración 2 pto 6). Así que el frontend **tiene** que guardar el token en JS. Dado el ADR 192, dónde exactamente importa: `localStorage` **persiste** entre pestañas, sesiones del navegador y reinicios, así que un XSS exitoso en **cualquier momento futuro** lo cosecha.

**Decisión**:

1. **El token vive en memoria de la pestaña** (variable de módulo / closure), **no en `localStorage` ni en `sessionStorage`.** Cerrar la pestaña lo pierde: **es el comportamiento deseado**, no una carencia.
2. **El token nunca aparece en la URL** (ni query string ni fragment): quedaría en el historial, en `Referer` y en los logs de acceso. El arnés ya loguea por `requestId` y ya manda `Referrer-Policy: no-referrer` (`server.ts:247`); esto lo mantiene coherente.
3. **El token nunca se renderiza en el DOM** ni se escribe en la consola del navegador, en ningún camino de error.
4. **Se acepta el costo de usabilidad, explícitamente**: recargar la página obliga a volver a loguearse. Con `SESION_TTL_MINUTOS` típico es aceptable; el ADR 195 (logout) y el manejo de `401` hacen que el camino de vuelta sea corto y no pierda lo escrito.
5. **Condición de disparo escrita**: el día que el adaptador soporte cookies, **este ADR se reabre** y el token pasa a cookie `HttpOnly` + `Secure` + `SameSite`, que es la mitigación estructuralmente correcta de R2 (ni un XSS puede leer una cookie `HttpOnly`). **Hasta entonces, memoria de pestaña es el techo.** Ver **RD-91**.

**Alternativas consideradas**:

- **`localStorage`**: **rechazada.** Máxima comodidad, peor postura: persiste indefinidamente y es legible por cualquier script del origen.
- **`sessionStorage`**: **rechazada, aunque es la más discutible de las tres** — se limpia al cerrar la pestaña, así que su ventana de exposición es casi la de memoria. Se descarta porque **sobrevive a la recarga**, y esa persistencia extra no compra nada que el pto 4 no acepte ya, mientras sí amplía la ventana en la que un XSS lo encuentra.
- **Implementar cookies `HttpOnly` en este change**: **rechazada por alcance**, no por mérito — **es la opción técnicamente superior**. Cambia el contrato de `/login` (*Out of Scope*) y agrega parseo de cookies y defensa CSRF, que hoy no existen. Es un change propio y se nombra como tal.

**Consecuencias**: la ventana de robo de token se acota a la vida de la pestaña. El camino de crecimiento queda escrito con su condición, no como intención vaga.

### ADR 194: La **espera larga es un estado de primera clase de la UI**, no un spinner — con el techo de 120 s declarado

**Contexto.** `OPERACIONES_TIMEOUT_MS = 120_000` (`config.ts:43`) y su comentario lo llama *"Techo del turno de `POST /operaciones` antes de responder `504`"*. Dos minutos es mucho más de lo que un usuario tolera sin señal. La UI es **el primer consumidor que expone esa latencia a un humano**: `curl` la tolera callado.

**Decisión**:

1. **Cuatro estados explícitos y exhaustivos**: `idle`, `esperando`, `respondido`, `error`. `error` se desagrega por código (`400`, `401`, `502`, `504`) — **los cuatro que `/operaciones` ya devuelve** — con un mensaje propio cada uno. Pasa a ser requirement de spec.
2. **Durante `esperando`, el envío se deshabilita**: un segundo `POST` concurrente del mismo empleado abriría un turno paralelo con el mismo `casoId`/conversación, que es precisamente el escenario de carrera que el ADR 166 pto 3 razona (dos invocaciones, mismo `casoIdActual`). **No se serializa en el servidor: se evita en el cliente y se declara la limitación** — el cliente no es una garantía de seguridad, y decirlo es parte de la decisión. Si `sdd-design` encuentra que hace falta serializar de verdad, es **RD-95**.
3. **`504` se muestra como lo que es**: *"la operación tardó demasiado y no se completó"*, **sin afirmar que falló ni que se aplicó**. Es la diferencia entre un timeout y un error, y el empleado necesita saber que el estado quedó indeterminado.
4. **`401` no pierde lo que el empleado escribió**: vuelve a login conservando el mensaje pendiente. Es el caso frecuente (el TTL vence a mitad de conversación) y el que peor se siente si borra trabajo.

**Alternativas consideradas**:

- **Streaming token por token**: **rechazada por alcance** — es la mejor experiencia y **cambiaría el contrato de `/operaciones`** (hoy responde de una sola vez, `build-on-operaciones-empleado.ts:203`) y el shape de `handleTurn`. **RD-92** la deja nombrada para un change propio.
- **Un spinner genérico sin estados**: **rechazada.** Es lo que produce "se colgó" ante un turno normal de 90 segundos.
- **Bajar `OPERACIONES_TIMEOUT_MS` para que la espera sea tolerable**: **rechazada.** Es cambiar el backend para acomodar la UI; el valor está fijado por el ADR 173 pto 3 con su propio criterio.

**Consecuencias**: la UI tiene más estados de los que un chat "simple" sugiere, y son exactamente los que el backend ya produce.

### ADR 195: **Logout de verdad** — el `SesionEmpleadoStore` gana un tercer método, porque hoy cerrar sesión es **inexpresable**

**Contexto.** Aclaración 2 pto 6: el puerto tiene `crear` y `buscar`, y nada más (`sesion-empleado-store.ts:21-26`). No hay `eliminar`. **No es que el logout esté sin exponer por HTTP: no existe la operación.** Hoy la única forma de invalidar una sesión es esperar el TTL — que con `SESION_TTL_MINUTOS=0` **no llega nunca** (`sesion.ts:15`, arc42 `:555`). Con `curl` era tolerable; con un chat en una máquina compartida, no.

**Decisión**:

1. **`SesionEmpleadoStore` gana un tercer método** (`eliminar(token)`), y una ruta nueva lo expone. **Aditivo**: `crear` y `buscar` no cambian de firma ni de comportamiento.
2. **El logout es idempotente y no distingue casos**: token inexistente, ya eliminado o vencido dan el mismo resultado. Es el criterio que el propio archivo ya documenta para `buscar` (`:13-16`, *"vencida e inexistente son INDISTINGUIBLES desde afuera"*) y que `token-confirmacion.ts` aplica a sus tokens. **Se reusa, no se inventa.**
3. **El logout limpia también el estado conversacional del empleado**: la memoria (ADR 189) y la ranura de confirmación pendiente (`confirmacion-operaciones-store.ts`, que ya tiene `consumir()`). Una sesión nueva **no hereda** la conversación anterior. Sin esto, "cerrar sesión" sería una mentira parcial.
4. **La evicción de sesiones vencidas del `Map` NO entra en este change.** Es una fuga de memoria lenta y preexistente, ortogonal al logout. **Se nombra como deuda, no se arrastra en silencio.** Ver **R5**.

**Alternativas consideradas**:

- **Logout sólo del lado del cliente** (olvidar el token en la pestaña): **rechazada, y es la trampa de este ADR.** El token **sigue siendo válido en el servidor** — cualquiera que lo haya capturado lo sigue usando. Sería seguridad de teatro.
- **Hacer el TTL deslizante en vez de absoluto**: **rechazada por alcance.** Es una mejora real y ortogonal; cambia `sesion.ts`, que es núcleo compartido con la TUI. Change propio.

**Consecuencias**: el adaptador web gana una ruta y el puerto un método, los dos aditivos. A cambio, "cerrar sesión" pasa a significar lo que dice.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/adapters/web/server.ts` | Modified | Rutas nuevas en la cadena de `:681-712` (interfaz + logout); CSP en `responderHtml` (`:245-248`). **`handleLogin`/`handleOperaciones` sin cambio de contrato** |
| `src/adapters/web/` (página del chat) | New | HTML por función pura, molde `render.ts`; `escapeHtml` para todo lo que se concatene server-side (ADR 20 pto 2) |
| `src/adapters/web/` (asset de cliente) | New | JS vanilla: ciclo de mensaje, cuatro estados, logout. **Sin `innerHTML` — test mecánico (ADR 192 pto 2)** |
| `src/adapters/web/sesion-empleado-store.ts` | Modified | Tercer método `eliminar` (ADR 195 pto 1). `crear`/`buscar` intactos |
| `src/adapters/web/config.ts` | Modified | Constantes de rutas nuevas, molde `RUTA_LOGIN`/`RUTA_OPERACIONES` (`:34,36`) |
| `src/build-on-operaciones-empleado.ts` | **Modified — alcance dependiente de RD-88** | Hoy `const casoId = newId()` en `:171`. **Cuánto cambia lo decide `sdd-design`**: Opción A toca esta línea; Opción B agrega un mecanismo de agrupación |
| `src/core/turn-selector/assemble-context.ts` | **Posiblemente Modified — RD-88** | Sólo si la Opción B exige resolver la sesión a retomar a través de varios `casoId`. **Con Opción A, sin cambio.** Es núcleo compartido por los cuatro turnos: tocarlo exige cuidado extra |
| `src/adapters/web/confirmacion-operaciones-store.ts` | **Posiblemente Modified — ADR 189 pto 4** | Sólo si la Opción A invalida `origenCasoId !== casoIdActual` (`:40-52`). **Si cambia, el invariante se refuerza, nunca se relaja** |
| `src/adapters/memory/` (migración) | **Posiblemente New — RD-88** | Sólo si la Opción B necesita persistir la agrupación de conversación |
| `src/main.ts` | Modified | Cableado de lo que agregue RD-88 y del logout |
| `src/core/auth/sesion.ts`, las seis funciones de negocio, la herramienta `operaciones` | **Sin cambio** | **Si aparecen en el diff, el alcance se filtró** |
| `src/adapters/web/` rama `/soporte` | **Sin cambio** | ADR 146 vigente |
| `package.json` | **Sin cambio** | ADR 191 pto 2 |
| Tests | New/Modified | Ausencia de `innerHTML` (ADR 192 pto 2); XSS en negativo (pto 3); memoria multi-turno; autoconfirmación imposible (ADR 189 pto 4); aislamiento entre empleados (pto 5); logout idempotente |
| `docs/ARC42_Harness_Empresarial.md`, `README.md` | Modified | Concepto de cierre del reparto de canales por el lado de chat |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | ★ **La memoria real rompe la confirmación de `cancelar_solicitud_interna`** (arc42 `:566`), y se "arregla" relajando el predicado | **Alta** | **Es el riesgo estructural del change.** Aclaración 3 lo documenta antes de diseñar; ADR 189 ptos 3-4 separan invariante de mecanismo y **exigen un test de autoconfirmación imposible en cualquiera de las dos opciones**. **RD-88 se resuelve ANTES de escribir UI** (Approach pieza 1) |
| **R2** | ★ **XSS vía `respuesta` del modelo ⇒ robo del token ⇒ acceso al camino del dinero** | **Alta** | **Riesgo de seguridad principal del change.** ADR 192 completo: inserción como texto + test mecánico de ausencia de `innerHTML` + test en negativo + CSP. ADR 193 acota la ventana del token a la pestaña. **La cadena se corta en tres puntos, no en uno** |
| **R3** | **El scope se infla**: "ya que hacemos la UI", agregar Markdown, streaming, adjuntos, tema oscuro | **Alta** | *Out of Scope* explícito y nominal; ADR 191 (sin dependencias), ADR 192 alternativa 1 (Markdown rechazado con motivo), ADR 194 alternativa 1 (streaming → RD-92) |
| **R4** | **`sdd-design` elige la Opción B y el costo excede el presupuesto** del hito (concepto, migración, puerto nuevo) | **Media** | RD-88 se resuelve primero, así que el costo se conoce **antes** de comprometer la UI. Si B resulta desproporcionada, el checkpoint puede re-secuenciar — **lo que NO puede es degradar el requisito a turnos independientes** (ADR 189 pto 1) |
| **R5** | **Sesiones y conversaciones sin techo en `Map`s de proceso** — hoy nada se desaloja | **Media** | Preexistente y nombrada (Aclaración 2 pto 6, ADR 195 pto 4). ADR 189 pto 6 obliga a fijar el fin de conversación (**RD-89**). **La evicción de sesiones vencidas queda como deuda declarada** |
| **R6** | ★ **El chat masifica el acceso a `consultar_reporte_comisiones`**, que no tiene gate de rol ni escopado por vendedor (**R12** heredada, arc42 `:568`) | **Media-Alta** | **No se agrava ni se resuelve acá** — pero baja la fricción de `curl` a caja de texto. **El checkpoint debería confirmar explícitamente que sigue aceptando R12 en este canal**, con el mismo criterio con que la aceptó al aprobar la Enmienda 5 de v3.6 |
| **R7** | **Sin TLS, el token viaja en claro** y un chat de uso real lo expone mucho más que `curl` de desarrollo | **Media** | Heredado del entorno de despliegue, fuera del repo. **Se declara en la documentación del hito**; ADR 193 pto 5 nombra la cookie `Secure` como salida cuando haya TLS |
| **R8** | **Colisión de numeración ADR 174-187** (Aclaración 1) confunde a quien lea las referencias cruzadas | Media | Esta propuesta abre en **189**, por encima del máximo absoluto verificado en `openspec/`, `src/` y `docs/`. La colisión se **declara** y se difiere (**RD-94**) |
| **R9** | **Presupuesto de review de 400 líneas** — memoria + rutas + HTML + JS de cliente + logout + cinco familias de tests | **Alta** | **`sdd-tasks` debe forecastear PRs encadenados.** Corte natural, alineado con el Approach: (1) memoria/RD-88 + tests de invariante; (2) rutas + página + CSP; (3) cliente + estados + XSS en negativo; (4) logout + docs |
| **R10** | **El primer JS de cliente sienta un precedente** que el próximo change hereda sin discutir | Media | ADR 191 con condición de disparo escrita (pto 5): no es dogma, es techo con criterio de reapertura |

## Rollback Plan

1. **Las piezas de interfaz son aditivas y borrables**: la página, el asset de cliente y las rutas nuevas son **archivos nuevos** más entradas nuevas en la cadena de `if` de `server.ts:681-712`. Quitarlos devuelve el adaptador a su comportamiento exacto de hoy — **`/login` y `/operaciones` siguen respondiendo igual porque su contrato no se tocó** (*Out of Scope*), que es precisamente el beneficio de no haberlo cambiado.
2. **El logout es aditivo**: quitar `eliminar` del puerto y su ruta no afecta a `crear`/`buscar` (ADR 195 pto 1).
3. ★ **La memoria es la pieza NO trivialmente reversible, y hay que decirlo.** Con Opción A, revertir es volver a `const casoId = newId()` (`:171`) — barato. Con Opción B, puede haber una migración de por medio: **la reversión de esquema se diseña junto con el forward, no después** (**RD-96**). **Es la única parte del change con rollback no trivial, y el checkpoint debería saberlo antes de aprobar la opción.**
4. **Rollback parcial posible y recomendado**: la interfaz y la memoria son **independientes en el sentido de la reversión**. Se puede revertir la UI dejando la memoria (el backend sigue sirviendo a `curl` con memoria), o revertir la memoria dejando la UI (un chat funcional aunque amnésico, que **no satisface el hito** pero es un estado estable y desplegable mientras se rehace).
5. **Nada que revertir en datos de negocio**: no se escribe ni migra nada de ventas, comisiones, solicitudes ni empleados. El único dato nuevo posible es la agrupación de conversación (Opción B), que es **estado de conversación, no de negocio** — perderlo cuesta memoria conversacional, nunca una operación.

## Dependencies

- ⛔ **Checkpoint humano previo a `sdd-spec`/`sdd-design`** — primer JS de cliente del repo (ADR 191) **y**, sobre todo, la colisión de la Aclaración 3 con el invariante del arc42 `:566`. **Bloqueante.**
- ⛔ **RD-88 (mecanismo de memoria) es prerrequisito interno de todo lo demás.** Approach pieza 1. No es una dependencia externa, pero se comporta como una: la UI no se diseña antes.
- **Depende de `operaciones-negocio-conversacionales` (v3.6), ya mergeado**: `POST /login`, `POST /operaciones`, la herramienta y la confirmación por `origenCasoId`. **Este change consume ese trabajo; no lo modifica.**
- **Depende de `autorizacion-empleado` (v3.5) y `comandos-administracion-empleados` (v3.7), ya mergeados**, para que existan empleados con credenciales y rol que puedan loguearse. **Sin dependencia de código, sólo de datos.**
- **Independiente de `consultas-negocio-a2a-entrante` (v3.8).** Verificado: ese change toca el turno A2A entrante y su `mcpServers`; éste no toca ninguno de los dos. **Sin dependencia en ninguna dirección.**
- **Sin dependencias externas nuevas. Sin dependencias nuevas en `package.json`** (ADR 191 pto 2).
- **Reusa, sin modificar**: `escapeHtml` y el molde de `render.ts`, `responderHtml`/`pathFromUrl` de `server.ts`, `sesionVigente` de `core/auth/sesion.ts`, las seis funciones de negocio y la herramienta `operaciones`.

## Success Criteria

- [ ] ★ **Memoria multi-turno demostrada de punta a punta**: el empleado menciona algo en el mensaje N, lo referencia deícticamente en N+1 (*"esa venta"*, *"confirmá eso"*) **sin repetir el identificador**, y el arnés resuelve la referencia. Con evidencia en `docs/progreso/v3.9-chat-web-empleado/`.
- [ ] ★ **La confirmación de `cancelar_solicitud_interna` sigue exigiendo un turno posterior y distinto** (arc42 `:566`), **y existe un test que falla si dos invocaciones del mismo mensaje se autoconfirman** (ADR 189 pto 4). **Obligatorio en cualquiera de las dos opciones de RD-88.**
- [ ] **La memoria está aislada por empleado**: test con dos empleados concurrentes donde la conversación de uno **no** aparece en el contexto del otro (ADR 189 pto 5).
- [ ] **Test mecánico de ausencia de `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`** en el asset de cliente, que **falla** si se inyecta cualquiera (ADR 192 pto 2).
- [ ] **Test en negativo de XSS**: con `respuesta` conteniendo `<script>` y `<img onerror=...>`, el DOM no gana un elemento ejecutable y el texto se muestra literal (ADR 192 pto 3).
- [ ] **Las respuestas HTML del chat llevan CSP sin `unsafe-inline`**, y la página **funciona** con esa CSP puesta (ADR 192 pto 4).
- [ ] **El token no está en `localStorage`, ni en `sessionStorage`, ni en la URL, ni en el DOM renderizado** (ADR 193 ptos 1-3), verificado en la evidencia manual.
- [ ] **Los cuatro códigos de error de `/operaciones` (`400`/`401`/`502`/`504`) tienen tratamiento propio y distinguible**, y `401` **no pierde el mensaje que el empleado había escrito** (ADR 194 ptos 1 y 4).
- [ ] **Logout invalida la sesión EN EL SERVIDOR**: tras cerrar sesión, el token viejo devuelve `401` en `POST /operaciones`; y la conversación no sobrevive a un login nuevo (ADR 195 ptos 1 y 3).
- [ ] **`git diff` confirma que `/login` y `/operaciones` no cambiaron de contrato**, que las seis funciones de negocio y la herramienta `operaciones` no se tocaron, y que **`package.json` no ganó ni una dependencia**.
- [ ] **Los tres requirements de seguridad de `turno-empleado-autenticado` siguen intactos** (`spec.md:15,24,33`), y **la rama de cliente de `/soporte` no cambió de comportamiento** (ADR 146).
- [ ] **Evidencia de verificación manual con capturas de la interfaz real**, no de `curl` — cerrando explícitamente la brecha que `verificacion-manual-tarea-15.md:54` dejó a la vista.
- [ ] `npm test`, typecheck y lint en verde; **`src/core/` sigue sin importar de `src/adapters/*`** (ADR 190 pto 3).

---

## Decisiones diferidas a `sdd-design` (RD)

Numeración continúa desde el techo verificado **RD-87** (Aclaración 1).

- ★ **RD-88** — **LA decisión central del change, y la única que bloquea a las otras**: ¿un único `casoId` por conversación (Opción A) o `casoId` por mensaje con un mecanismo nuevo de agrupación (Opción B)? Incluye: qué pasa con `origenCasoId !== casoIdActual` si se elige A, y si la Opción B exige tocar `assemble-context.ts` (núcleo compartido por los cuatro turnos) o puede resolverse en el composition root. **Ver Aclaración 3 y ADR 189. Se resuelve ANTES de diseñar la UI.**
- **RD-89** — ¿Qué termina una conversación? (inactividad, tope de mensajes, logout, reinicio de proceso). ADR 189 pto 6. Sin esto, el contexto crece sin techo.
- **RD-90** — ¿El ciclo de mensaje tolera HTML server-side puro con recarga completa, eliminando de raíz el vector de XSS del ADR 192? (ADR 191, alternativa 3). Depende de cuán tolerable sea la espera de hasta 120 s.
- **RD-91** — Forma exacta de la migración a cookie `HttpOnly` cuando el adaptador soporte cookies: qué pasa con el contrato de `/login` y qué defensa CSRF hace falta. ADR 193 pto 5.
- **RD-92** — Streaming incremental de la respuesta: qué tendría que cambiar en `/operaciones` y en `handleTurn`. ADR 194, alternativa 1. **Change propio, no éste.**
- **RD-93** — Directiva `Content-Security-Policy` exacta (`default-src`, `script-src`, `style-src`, `connect-src`), y si aplica sólo al chat o también a `GET /confirmar/:token`. ADR 192 ptos 4-5.
- **RD-94** — Cómo se desambigua la colisión ADR 174-187 (Aclaración 1) sin romper las citas en código vivo: ¿prefijo por change, tabla de equivalencias en el arc42, o renumeración? **Change de documentación propio.**
- **RD-95** — ¿Hace falta serializar de verdad en el servidor los mensajes concurrentes del mismo empleado, o alcanza con deshabilitar el envío en el cliente? ADR 194 pto 2 — **el cliente no es una garantía de seguridad**.
- **RD-96** — Si RD-88 resuelve Opción B con migración: forma exacta del rollback de esquema, diseñado junto con el forward. Rollback Plan pto 3.
- **RD-97** — Granularidad de los mensajes de error de la UI: ¿cuánto detalle del `502`/`504` se le muestra al empleado sin filtrar información de infraestructura?

---

## Qué necesita el checkpoint

1. ★ **¿Confirma la Aclaración 3?** Es el hallazgo que cambia el tamaño del change: memoria real vs. el invariante del arc42 `:566`. **No hace falta elegir Opción A o B acá** (eso es RD-88), pero sí reconocer que la elección existe y que **bloquea** al resto.
2. **¿Aprueba abrir en ADR 189** (por encima del máximo absoluto), y **diferir** la colisión 174-187 a un change propio (RD-94)?
3. **¿Aprueba vanilla JS sin dependencias ni bundler** (ADR 191), sabiendo que `react-dom` no está instalado y que "ya tenemos React" no aplica a web?
4. ★ **¿Sigue aceptando R12 en este canal?** `consultar_reporte_comisiones` sin gate de rol ni escopado por vendedor, ahora detrás de una caja de texto en vez de `curl` (**R6**). Se aceptó para HTTP en la Enmienda 5 de v3.6; **este change no la agrava, pero baja la fricción de acceso** y merece una confirmación explícita.
5. **¿Confirma la numeración `v3.9.0` y el nombre de rama/carpeta de progreso?**
6. **¿Acepta que el rollback de la memoria puede no ser trivial** si RD-88 resuelve Opción B con migración (Rollback Plan pto 3)?
