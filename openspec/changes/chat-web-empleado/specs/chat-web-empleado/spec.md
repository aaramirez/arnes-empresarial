# Chat Web Empleado Specification

## Purpose

Capability nueva. Interfaz visual de chat servida por el mismo listener HTTP del arnés (`src/adapters/web/server.ts`, ADR 190), consumida por un empleado con `SesionEmpleado` vigente. Cubre las pantallas de login y chat, el ciclo de un mensaje contra `POST /operaciones` (contrato existente, **sin cambios**), el tratamiento exhaustivo de los códigos de error que esa ruta ya devuelve, el estado de espera larga (ADR 194), el logout (ADR 195), y los invariantes negativos que son el corazón del change: el texto del modelo nunca se interpreta como HTML; la página no ejecuta script inline ni de terceros; el token nunca aparece en la URL, en el DOM renderizado, en un log de cliente, ni en `localStorage`/`sessionStorage`.

**Fuera de alcance de este spec**: el mecanismo de memoria conversacional multi-turno (capability `memoria-conversacional-empleado`); el contrato interno de la herramienta `operaciones` (capability `herramienta-operaciones-negocio`); cualquier framework, bundler o dependencia nueva de frontend (ADR 191); streaming incremental de la respuesta; cookies `HttpOnly` como mecanismo de sesión (RD-91); HTTPS/TLS.

## Requirements

### Requirement: Rutas públicas nuevas sirven la interfaz desde el mismo listener HTTP

El sistema SHALL exponer `GET /chat`, `GET /chat/app.js` y `GET /chat/app.css` en el mismo listener que ya sirve `/login` y `/operaciones`, sin requerir sesión vigente para obtenerlas. Ninguna de las tres rutas SHALL devolver datos de negocio, de empleado ni de sesión — su contenido es idéntico para cualquier solicitante.

#### Scenario: La página se sirve sin sesión

- GIVEN un cliente sin token de sesión
- WHEN hace `GET /chat`
- THEN recibe `200` con el HTML de la interfaz, con `Content-Type: text/html; charset=utf-8`

#### Scenario: Los assets del cliente se sirven con su tipo correcto

- GIVEN un cliente sin sesión
- WHEN hace `GET /chat/app.js` y `GET /chat/app.css`
- THEN recibe `200` con `Content-Type: application/javascript; charset=utf-8` y `text/css; charset=utf-8` respectivamente

### Requirement: El texto del modelo y del empleado se inserta siempre como texto, nunca como HTML

El cliente SHALL insertar todo texto dinámico —la `respuesta` del modelo y el mensaje que el propio empleado escribió— en el DOM exclusivamente por la vía de texto (`textContent`/`createTextNode`). El cliente SHALL NOT usar `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` ni `eval` en ningún camino, para ningún valor dinámico.

#### Scenario: Una respuesta normal se muestra literal

- GIVEN el modelo responde con texto de negocio ordinario
- WHEN el cliente renderiza el turno
- THEN el texto aparece en pantalla exactamente como fue recibido, sin interpretación de marcado

#### Scenario: Una respuesta con marcado ejecutable no se ejecuta (negativo, XSS)

- GIVEN una `respuesta` del backend que contiene `<script>alert(1)</script>` y un `<img onerror="...">`
- WHEN el cliente la renderiza en el DOM
- THEN el árbol resultante NO gana ningún elemento `<script>` ni `<img>` ejecutable — sólo un nodo de texto
- AND el texto se ve en pantalla literal, incluidas las etiquetas, sin que se dispare ningún `alert` ni handler

### Requirement: Las respuestas HTML del chat llevan una Content-Security-Policy sin `unsafe-inline`

Las tres rutas del chat SHALL responder con una cabecera `Content-Security-Policy` que prohíba `unsafe-inline` en `script-src` y `style-src`, y que no permita cargar script de ningún origen distinto del propio. La interfaz SHALL funcionar correctamente con esa CSP puesta.

#### Scenario: La CSP está presente y restringe origen

- GIVEN una solicitud a `GET /chat`
- WHEN se inspecciona la respuesta
- THEN la cabecera `Content-Security-Policy` está presente, con `script-src` y `style-src` limitados a `'self'` y sin `unsafe-inline`

#### Scenario: El chat es usable con la CSP activa

- GIVEN la página cargada con la CSP del punto anterior
- WHEN el empleado interactúa con el formulario de login y de mensaje
- THEN ninguna funcionalidad queda bloqueada por la política (no hay script inline ni estilo inline que la CSP rechace)

### Requirement: El token de sesión vive sólo en memoria de la pestaña, nunca se persiste ni se expone

El cliente SHALL NOT escribir el token en `localStorage`, en `sessionStorage`, en la URL (query string ni fragment), en el DOM renderizado, ni en la consola del navegador, en ningún camino incluidos los de error.

#### Scenario: El token no queda en almacenamiento persistente

- GIVEN un empleado que inició sesión en el chat
- WHEN se inspeccionan `localStorage` y `sessionStorage` del origen
- THEN ninguno de los dos contiene el token

#### Scenario: Un error de red no filtra el token

- GIVEN un turno en curso que falla por error de red
- WHEN el cliente maneja el error
- THEN ni el mensaje mostrado en pantalla ni la consola del navegador contienen el token

### Requirement: El logout invalida la sesión en el servidor, no sólo en el cliente

`POST /logout` con un token válido SHALL invalidar ese token del lado del servidor, de modo que un uso posterior del mismo token en `POST /operaciones` se comporte igual que un token vencido. El logout SHALL ser idempotente: token válido, vencido, inexistente o ausente SHALL producir la misma respuesta `204`.

#### Scenario: Un token usado tras logout es indistinguible de uno vencido

- GIVEN una sesión vigente y su token
- WHEN el cliente hace `POST /logout` con ese token, y luego intenta `POST /operaciones` con el mismo token
- THEN la segunda solicitud responde `401`, con el mismo tratamiento que un token vencido

#### Scenario: Logout con token inexistente no falla

- GIVEN un token que nunca existió o ya fue invalidado
- WHEN el cliente hace `POST /logout` con ese token
- THEN la respuesta es `204`, igual que con un token válido

### Requirement: Tratamiento exhaustivo de los cuatro códigos de error de `POST /operaciones`

La interfaz SHALL distinguir y tratar explícitamente los cuatro códigos que `/operaciones` ya devuelve (`400`, `401`, `502`, `504`), sin renderizar el cuerpo de error del servidor en el DOM. Un `401` SHALL conservar el mensaje que el empleado había escrito, sin perderlo. Un `504` SHALL comunicarse como una operación que no se sabe si llegó a aplicarse, nunca como un fallo confirmado.

#### Scenario: `401` no pierde el mensaje escrito

- GIVEN un empleado escribió un mensaje y la sesión venció antes de enviarlo
- WHEN `POST /operaciones` responde `401`
- THEN la interfaz vuelve a la pantalla de login sin descartar el texto que el empleado había escrito

#### Scenario: `504` no afirma éxito ni fracaso

- GIVEN un turno que excede el techo de tiempo del servidor
- WHEN `POST /operaciones` responde `504`
- THEN la interfaz muestra que la operación no se completó y que no se sabe si llegó a aplicarse, sin afirmar ninguna de las dos cosas

### Requirement: La espera larga es un estado explícito de la interfaz, no un estado indefinido

Mientras un turno está en curso, la interfaz SHALL mostrar un estado de espera explícito y SHALL deshabilitar el envío de un nuevo mensaje hasta que el turno anterior resuelva (éxito o error). El deshabilitado es una limitación del cliente, no una garantía de serialización del servidor.

#### Scenario: El envío se deshabilita durante la espera

- GIVEN un turno en curso, sin respuesta todavía
- WHEN el empleado intenta enviar un segundo mensaje
- THEN el envío no se dispara hasta que el turno anterior resuelva

### Requirement: El contrato de `POST /operaciones` y `POST /login` permanece sin cambios

Este change SHALL NOT modificar el shape del request ni del response de `POST /operaciones` ni de `POST /login`, ni agregar, quitar o renombrar ningún campo existente. La interfaz consume esas dos rutas tal como existen hoy.

#### Scenario: El shape de `/operaciones` es idéntico antes y después del change

- GIVEN el contrato de `POST /operaciones` documentado antes de este change (`{casoId, respuesta}` en la respuesta)
- WHEN se compara con el contrato tras este change
- THEN el request y el response tienen exactamente los mismos campos, sin adiciones ni remociones

#### Scenario: El shape de `/login` es idéntico antes y después del change

- GIVEN el contrato de `POST /login` documentado antes de este change
- WHEN se compara con el contrato tras este change
- THEN el request y el response tienen exactamente los mismos campos, sin adiciones ni remociones
