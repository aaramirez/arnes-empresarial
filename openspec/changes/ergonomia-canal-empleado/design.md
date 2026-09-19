# Diseño técnico: Ergonomía del canal de empleado — el eco de `registrar_venta` nombra personas, y el chat distingue autor y hora

**Change**: `ergonomia-canal-empleado` · **Propuesta**: `openspec/changes/ergonomia-canal-empleado/proposal.md` (ADR 221-222, R1-R6, RD-105).

**Numeración verificada en esta fase** (`Grep`/`Read` sobre `openspec/`, `src/`, `docs/`): el techo real sigue siendo **ADR 220** y **RD-104**, y el change hermano —que en el repo se llama **`devolucion-sin-token-dos-personas`**, no `devolucion-autorizada-por-cliente` como lo nombra la propuesta— ya reservó **ADR 223-226** y **RD-106 a RD-111** (`devolucion-sin-token-dos-personas/proposal.md:31-32`). Entonces este diseño **no puede abrir en 223**: abre en **ADR 227** y **ADR 228**, y **no abre ninguna RD nueva** — **RD-105 se resuelve acá, entera** (§6).

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo. Misma nota y mismo criterio que `operaciones-negocio-conversacionales`, `autorizacion-empleado`, `chat-web-empleado`, `aprobacion-conversacional-hitl` y la propia propuesta de este change ya dejaron escritos. **Toda afirmación de abajo está verificada por `Read`/`Grep` con archivo:línea, sobre `main` post-v3.10.**

---

## 0. Hallazgos de esta fase — tres cosas que la propuesta no pudo ver

Ninguno cambia una decisión del checkpoint. Los tres cambian **cómo se implementa** y, el primero, **cómo se redacta el texto**.

### 0.1 ★ `vendedorNombre` **NO es el empleado autenticado**: es texto libre que el modelo llena — y cada venta **reescribe** el nombre guardado del vendedor

La *Nota de vocabulario* de la propuesta (`proposal.md:38`) dice que vendedor y empleado *"son, en este diseño, **una sola persona**"*, y funda eso en el ADR 171 pto 2. **Esa cita es correcta para `vendedorId` y NO se transfiere a `vendedorNombre`.** Verificado:

| Dato | De dónde sale | Verificación |
|---|---|---|
| `vendedorId` | `sesion.empleadoId`, por closure. **Inexpresable por el modelo** | `ejecutar-operacion.ts:673`; `operaciones-contract.ts:94-97` (*"`vendedorId` NO es campo de esta interfaz"*), y `OperacionRegistrarVenta` (`:99-107`) efectivamente no lo declara |
| `vendedorNombre` | ★ **`operacion.vendedorNombre`** — campo de la interfaz (`operaciones-contract.ts:106`), o sea **lo que el modelo extrajo del mensaje del empleado** | `ejecutar-operacion.ts:674` |

Y hay una segunda mitad, peor y más útil: **ese nombre se persiste pisando el anterior**. `registrarVenta` lo pasa como `vendedor: { id: input.vendedorId, nombre: input.vendedorNombre }` (`registrar-venta.ts:113-114`), y el upsert es `ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre` (`repository.ts:700-703`) — **sin `COALESCE`**, a diferencia del de `responsables` (`:392`). El reporte de comisiones agrupa por `vendedorId` y muestra ese `vendedorNombre` (`reporte.ts:154-155`). **Conclusión**: hoy, si el modelo pone un nombre equivocado, el arnés **renombra al vendedor en el reporte de comisiones y nadie se entera**.

**Qué fija este diseño**:

1. **El eco SÍ muestra `operacion.vendedorNombre`**, exactamente como el ADR 221 pto 1 lo decidió. **Y ahora hay un argumento más fuerte que la ergonomía**: el eco es el **único** punto del flujo donde ese texto libre se le devuelve a un humano antes de que quede escrito. Deja de ser cosmética y pasa a ser **el control de lectura de un dato que pisa estado persistido**.
2. ★ **El texto NUNCA dice "registrado por" ni "el empleado que registró".** Eso afirmaría identidad autenticada sobre un string que el modelo llenó. Dice **`vendedor <nombre>`**: un dato **declarado**, presentado como lo que es. Quien manda para la auditoría es `vendedorId`, y ya viaja en `registro_acciones_empleado` (`ejecutar-operacion.ts:684-689`).
3. **El eco NO agrega `sesion.empleadoId`** para "mostrar también al autenticado". Sería un tercer id en un eco cuyo pedido era tener menos ids, y **ADR 221 pto 4 cerró la lista** (*"Nada más entra al eco"*). El binding nombre↔sesión se documenta en el doc-comment y en la spec, no en el texto que ve el empleado.
4. **El pisado silencioso (`ON CONFLICT … SET nombre`) NO se toca**: es `src/adapters/memory/repository.ts` y una decisión de persistencia — alcance filtrado. Se declara como **R7** y queda nombrado para un change propio.

### 0.2 ★ La hora obliga a un **quinto identificador libre**, y el invariante vigente enumera **cuatro**

`chat-client.ts:17-22` declara, como invariante no negociable: *"Sólo toca el entorno por los identificadores libres `document`, `fetch`, `setInterval`, `clearInterval` — nada de `window.X` ni `globalThis` (ADR 200 pto 3): **es lo que permite el test de XSS en negativo con `new Function(...)`** contra un doble de DOM escrito a mano, sin instalar jsdom"*. El test lo materializa literal: `new Function("document", "fetch", "setInterval", "clearInterval", CHAT_CLIENT_JS)` (`chat-client.test.ts:139`).

**Un reloj de cliente necesita `Date`, que no está en esa lista.** Y `Date` **no se puede inyectar en producción**: el asset se carga con `<script src="/chat/app.js" defer>` (`chat-page.ts:74`), o sea la IIFE (`chat-client.ts:32`) no recibe argumentos — los cuatro de hoy son identificadores **libres**, resueltos contra el global, y el `new Function` del test los **sombrea** con dobles. `Date` va a funcionar igual (el global real está ahí), pero **quedaría fuera del inventario declarado y fuera del control del test**, que es justo la propiedad que ese invariante compra.

**Qué fija este diseño**: el inventario pasa a **cinco**, explícito en los tres lugares (doc-comment del archivo, `new Function` del test, spec). Ver **ADR 228**.

### 0.3 El test de XSS vigente **cambia de forma, no de fuerza** — y hay que decir exactamente cómo

`chat-client.test.ts:184-189` afirma hoy:

```ts
expect(ultimoTurno.children).toHaveLength(1);
expect(ultimoTurno.children[0]!.textContent).toContain("<script>alert(1)</script>");
```

Con la estructura nueva el turno tiene **tres** hijos y el payload cae en el tercero. **Es la R4 de la propuesta, y ocurre exactamente como fue prevista.** El riesgo real no es que el test cambie: es que se "arregle" aflojándolo (`toHaveLength` → nada, o `textContent` del contenedor en vez del nodo). **Instrucción para `sdd-apply`: el conteo pasa de `1` a `3` —número exacto, nunca borrado— y la aserción del payload se mueve a `children[2]`, verbatim.** Más una aserción **nueva** que hoy no existe y que cierra el hueco en positivo: `documento.elementosCreados` contiene **sólo** `"div"` y `"span"` (§10).

---

## 1. Qué NO se reabre acá

Fijado por el checkpoint vía ADR 221-222 y consumido como dado: el eco agrega `vendedorNombre` y `clienteId` (221 pto 1), **conserva `ventaId` y `casoId`** (221 pto 2), **nunca dice `clienteEmail`** (221 pto 3), y no agrega nada más (221 pto 4); el autor y la hora se resuelven **enteramente en el cliente** (222), dentro de los invariantes del ADR 200 pto 5 — nunca `innerHTML`, nunca estilo inline, CSP sin `unsafe-inline`, cero dependencias — con invariante negativo mecánico (222 pto 2), color por CSS (222 pto 3), hora de navegador que **no es auditoría** (222 pto 4) y autor **también en texto** (222 pto 5).

Y las dos reglas duras del repo atraviesan todo: `src/core/` nunca importa de `src/adapters/*`, y ningún adaptador importa de otro adaptador (`AGENTS.md`). **Este change no agrega ni un import en ninguna dirección.**

### 1.1 ★ Verificación de la privacidad del ADR 221 pto 3 — es más fuerte de lo que la propuesta escribió

La propuesta argumentó que mostrar `clienteEmail` lo empujaría *"a un almacén donde ADR 18 decidió que no estuviera"*. Verificado, y hay un matiz que **agrava**: el email **no** terminaría en una columna de SQLite. `sesiones_agente` guarda **`sdk_session_id`**, un puntero (`repository.ts:201-208`); el transcripto real —con el `CallToolResult` adentro— lo guarda **el Claude Agent SDK en disco**, y el arnés lo vuelve resoluble en cada mensaje vía `getLatestSesionAgente` → `options.resume` (`build-on-operaciones-empleado.ts:208-214`). **O sea: iría a un almacén durable que ninguna migración modela, ninguna retención purga y ninguna consulta de auditoría alcanza.** Es peor que una columna, no mejor. `clienteEmail` sigue documentado como *"Solo para notificar. NO se persiste (ADR 18, punto 4)"* (`registrar-venta.ts:84-85`) y **`RegistrarVentaResult` ni siquiera lo devuelve** (`:91-96`).

---

## 2. Resumen de la arquitectura elegida

Cuatro decisiones, en una frase cada una:

1. **El eco es una sola línea reemplazada** en `ejecutarRegistrarVenta`, que **lidera con las personas y baja los ids a un paréntesis** — porque la queja del stakeholder no fue *"hay ids"*, fue *"arranca con dos UUID"*. **ADR 221, ejecutado en §3.**
2. **`agregarTurno` deja de recibir una etiqueta y pasa a recibir una CLAVE de una tabla cerrada de dos autores** (`empleado` / `arnes`). La clase CSS y la etiqueta salen de esa tabla, nunca del texto: **ningún string dinámico llega jamás a `className`. ADR 227.**
3. **La clase entra por `className` (propiedad string), no por `classList`** — un `classList` obliga a doblar un objeto con métodos en un doble de DOM escrito a mano, y `className` se afirma exactamente igual que `textContent`, que es el mecanismo que el archivo ya tiene probado. **ADR 227 pto 3.**
4. **`Date` se declara como quinto identificador libre y se inyecta determinista en el test**; el test mecánico de ausencia gana **`.style`, `cssText` y `setAttribute`**, que es la forma sin-regex de prohibir el estilo inline que la propuesta exige. **ADR 228.**

### 2.1 El mapa de piezas

```
UNIDAD 1 — eco (100% núcleo, cero puertos nuevos)
  operacion ─┬─ vendedorNombre ─┐        ★ texto libre del modelo (§0.1)
             └─ clienteId ──────┤
  sesion ────── empleadoId ─────┼──► registrarVenta ──► RegistrarVentaResult {ventaId, casoId, link, notificado}
                                │                         │
                                └────────────────────────►└──► plantilla determinista  (ejecutar-operacion.ts:692)
                                     ★ clienteEmail: viaja a registrarVenta, NUNCA al texto (ADR 221 pto 3)

UNIDAD 2 — chat (100% cliente, cero servidor)
  POST /operaciones ──► {respuesta}          [CONTRATO SIN CAMBIO]
        │
        ▼
  agregarTurno("empleado"|"arnes", texto)    ← clave cerrada, no etiqueta (ADR 227)
        │
        ├─ div.turno.turno-<autor>           className desde AUTORES[clave].clase
        │    ├─ span.turno-hora     "14:32"  ← Date, formateado a mano (ADR 228)
        │    ├─ span.turno-autor    "Vos"    ← ADR 222 pto 5: el autor SIEMPRE en texto
        │    └─ span.turno-texto    <texto>  ← textContent, verbatim
        ▼
  CHAT_CSS ──► GET /chat/app.css  (text/css, style-src 'self')   [CSP SIN CAMBIO]
```

---

## 3. ADR 221 ejecutado: el texto exacto del eco

**Contexto.** Hoy, línea única (`ejecutar-operacion.ts:691-692`):

```ts
const notificado = resultado.notificado ? "sí" : "no se pudo notificar automáticamente";
return `Venta ${resultado.ventaId} registrada (caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.`;
```

**Decisión — el texto final, literal, para que `sdd-apply` no improvise**:

```ts
return `Venta registrada: vendedor ${operacion.vendedorNombre}, cliente ${operacion.clienteId} (venta ${resultado.ventaId}, caso ${resultado.casoId}). Notificación al cliente: ${notificado}. Link de confirmación: ${resultado.linkConfirmacion}.`;
```

Renderizado, con la fixture que el test vigente ya usa (`ejecutar-operacion.test.ts:409-416`):

> `Venta registrada: vendedor Juan Pérez, cliente cliente-1 (venta id-3, caso id-2). Notificación al cliente: sí. Link de confirmación: https://ventas.example.com/confirmar/token-1.`

**Las cinco propiedades que lo justifican, una por una**:

1. **Lidera con las personas, no con los UUID.** La queja verificable fue *"el arnés le devuelve `Venta 8f3c… registrada (caso a91b…)`… es correcto y es **ilegible**"* (`proposal.md:48`). Mantener el prefijo `Venta ${ventaId} registrada` dejaría el primer token del mensaje siendo un UUID: **arregla el contenido y no la queja**.
2. **Los ids se conservan, juntos y etiquetados** (`(venta X, caso Y)`, ADR 221 pto 2). Etiquetados a propósito: hoy el `casoId` se distingue del `ventaId` sólo por la posición. Quien correlaciona con `registro_acciones_empleado` (`:684-689`) o con el reporte de comisiones necesita saber cuál es cuál **sin contar paréntesis**.
3. **Cuatro datos, ni uno más** (ADR 221 pto 4): `vendedorNombre`, `clienteId`, `ventaId`, `casoId` — más los dos que ya estaban (`notificado`, `linkConfirmacion`), **que no se tocan**. ★ **Ni `monto` ni `planNuevo` entran**, aunque estén en el scope (`operaciones-contract.ts:104-105`) y sean tentadores: la lista la cerró el checkpoint, y `monto` es *"la ÚNICA excepción al invariante 'ningún campo de dinero'"* (`:91-93`) — no se la reexporta a un canal nuevo por ergonomía.
4. **`clienteEmail` no aparece, y es imposible que aparezca por descuido**: el `catch` de esta decisión es un test en negativo (§10), no un comentario. §1.1 verifica por qué importa.
5. **`vendedor <nombre>`, nunca "registrado por"** (§0.1 pto 2).

**Cero lecturas nuevas, cero puertos, cero `await`**: los cuatro datos ya están en el scope de la función (`operacion` y `resultado`, `:653-682`). El diff de producción es **una línea reemplazada**, más el doc-comment.

**Alternativas consideradas**:

| Opción | Por qué se rechaza |
|---|---|
| Conservar el prefijo `Venta ${ventaId} registrada (caso …)` y **sumar** dos oraciones (`Vendedor: X. Cliente: Y.`) | Diff más chico (una inserción, sin reordenar) y **no arregla la queja**: el mensaje sigue empezando con un UUID. Pto 1 |
| Sumar `monto` y `planNuevo` *"ya que estamos"* | Alcance filtrado sobre el único campo de dinero del contrato. Pto 3 |
| Agregar `sesion.empleadoId` como "el que registró" | Un tercer id en un eco cuyo pedido era tener menos. §0.1 pto 3 |
| Mostrar `clienteEmail` | ADR 221 pto 3, ya decidido por el checkpoint. §1.1 lo refuerza |

---

## 4. ADR 227 (RD-105, parte 1): el turno es una estructura de **tres nodos**, el autor es una **clave cerrada**, y la clase entra por **`className`**

**Contexto.** Hoy (`chat-client.ts:66-70`):

```js
function agregarTurno(autor, texto) {
  var turno = document.createElement("div");
  turno.appendChild(document.createTextNode(autor + ": " + texto));
  mensajes.appendChild(turno);
}
```

Dos call sites, ambos con **etiqueta de presentación como argumento**: `agregarTurno("Vos", texto)` y `agregarTurno("Arnés", cuerpo.respuesta)` (`:182-183`).

**Decisión**:

1. ★ **`agregarTurno` recibe una CLAVE, no una etiqueta.** Tabla de módulo, junto a `MENSAJES_ERROR` (`:39-46`), que ya es el molde de "tabla de literales del cliente":

   ```js
   var AUTORES = {
     empleado: { etiqueta: "Vos",   clase: "turno turno-empleado" },
     arnes:    { etiqueta: "Arnés", clase: "turno turno-arnes"    }
   };
   ```

   Call sites: `agregarTurno("empleado", texto)` y `agregarTurno("arnes", cuerpo.respuesta)`. **La razón es de seguridad, no de estilo**: derivar la clase de la etiqueta (`"turno-" + autor.toLowerCase()`) metería un string de presentación —acentuado— dentro de un atributo. Con la tabla, **lo único que puede llegar a `className` son dos literales del propio archivo**. El texto del modelo nunca toca nada que no sea `textContent`.
2. ★ **Dos autores, no tres.** La propuesta mencionó *"empleado / arnés / sistema"* (`proposal.md:135`). **No hay ningún escritor de "sistema"**: los errores van a `estadoMensaje` (`:72-74`, `cambiarEstado`) y a `loginError`, **nunca a la transcripción** — verificado en los cuatro caminos de error de `manejarEnvio` (`:146-168`, `:187-194`, `:196-199`). Un tercer miembro sin escritor es *"un valor que existe para que compile"*, el defecto que el repo ya rechazó explícitamente en el mismo lugar (ADR 212 pto 4 de `aprobacion-conversacional-hitl/design.md`, sobre `dominio: "propuesta"`). **Si un día hay turnos de sistema, se agrega la fila con su escritor, en el mismo commit.**
3. ★ **`className`, no `classList`.** Las dos cumplen ADR 222 pto 3 (nada de `style` inline); la diferencia es de **testabilidad**, y en este archivo eso es la garantía entera:
   - El doble de DOM está **escrito a mano** porque jsdom está prohibido incluso como `devDependency` (ADR 191 pto 2, citado en `chat-client.test.ts:38-39`). `ElementoFake` (`:41-50`) es un objeto plano: `value`, `disabled`, `hidden`, `textContent`, `children`.
   - `className` es **una propiedad string más**: el doble gana **una línea** (`className: ""`) y se afirma con `toBe("turno turno-empleado")`, exactamente como se afirma `textContent` hoy.
   - `classList` obliga a doblar un objeto **con métodos y estado** (`add`, `contains`, `toString`), o sea a escribir a mano una pieza del DOM cuya divergencia respecto del navegador real nadie verifica. **Pagar eso para poner dos clases en un elemento recién creado —donde no hay nada que preservar— es complejidad sin contrapartida.**
   - ★ La propuesta escribió *"el color entra por `classList`, no por atributo `style`"* (`proposal.md:62`). **Se lee como el contraste que enuncia —clase CSS contra estilo inline—, no como un mandato de API.** Queda en Open Questions para ratificación explícita (§13).
4. **Estructura DOM exacta** — cuántos nodos, qué clases, en qué orden (la pregunta literal de RD-105):

   ```js
   function agregarTurno(claveAutor, texto) {
     var autor = AUTORES[claveAutor];
     var turno = document.createElement("div");
     turno.className = autor.clase;
     turno.appendChild(nodoSpan("turno-hora", horaActual()));
     turno.appendChild(nodoSpan("turno-autor", autor.etiqueta));
     turno.appendChild(nodoSpan("turno-texto", texto));
     mensajes.appendChild(turno);
   }

   function nodoSpan(clase, texto) {
     var span = document.createElement("span");
     span.className = clase;
     span.textContent = texto;
     return span;
   }
   ```

   **Tres hijos, siempre, en ese orden** — número fijo y afirmable (§0.3). `span`, no `<time>`: `<time>` sólo aporta si lleva `datetime`, y eso exige `setAttribute`, que el ADR 228 pto 3 **prohíbe mecánicamente**. Un elemento semántico a medias no vale una excepción al invariante.
5. **El texto entra por `span.textContent = texto`, no por `createTextNode`.** Los dos cumplen el invariante de `:11-14`; `textContent` es la API **más angosta** (no puede recibir otra cosa que un string) y ahorra tres nodos por turno. ★ **`createTextNode` queda sin usar en el cliente pero NO se borra del doble de DOM** (`chat-client.test.ts:107`): sigue siendo parte del contrato del doble y su ausencia volvería el test ciego a una regresión que lo reintroduzca.
6. **La etiqueta deja de llevar `": "` pegado.** La separación pasa a ser de CSS (§6), que es donde vive la presentación. Consecuencia buscada: el DOM no tiene **ni un carácter** que no sea dato — nada de separadores que un test tenga que tolerar.

**Alternativas consideradas**:

| Opción | Por qué se rechaza |
|---|---|
| Mantener la firma `agregarTurno(autor, texto)` con etiqueta y derivar la clase | Mete un string de presentación en un atributo. Pto 1 |
| `classList.add("turno", "turno-empleado")` | Obliga a doblar a mano un objeto con métodos. Pto 3 |
| Un solo nodo con `` `${hora} ${autor}: ${texto}` `` y sólo la clase en el contenedor | El test volvería a afirmar sobre **una cadena concatenada** — exactamente lo que este change viene a desarmar — y la hora no podría estilarse aparte. Además reintroduce el parsing por posición que la R4 vino a matar |
| Nodo `<time datetime=…>` | Exige `setAttribute`. Pto 4 |
| Marcar autor y hora **desde el servidor** | **Rechazada por el ADR 222 (alternativas)**, y este diseño lo confirma leyendo: `POST /operaciones` devuelve `{casoId, respuesta}` y el cliente **ya sabe quién habló porque es él quien lo agrega** (`:182-183`) |

---

## 5. ADR 228 (RD-105, parte 2): `Date` es el **quinto** identificador libre, y el test mecánico gana la prohibición de estilo inline

**Contexto.** §0.2: el inventario de identificadores libres es de **cuatro** y está declarado en tres lugares acoplados (`chat-client.ts:17-22`, `chat-client.test.ts:139`, y la spec vigente de `chat-web-empleado`).

**Decisión**:

1. ★ **El inventario pasa a cinco: `document`, `fetch`, `setInterval`, `clearInterval`, `Date`.** Se actualizan **los tres lugares en el mismo commit**. El doc-comment de `:17-22` no es documentación decorativa: es el enunciado del invariante que el test ejecuta. **Si cambia uno y no el otro, la garantía queda escrita en un lado y verificada en otro.**
2. **El test inyecta un `Date` determinista** como quinto parámetro de `new Function(...)`, que lo **sombrea** dentro del cuerpo del cliente:

   ```ts
   function fakeDate(hora: number, minuto: number) {
     return function () { return { getHours: () => hora, getMinutes: () => minuto }; };
   }
   // new Function("document","fetch","setInterval","clearInterval","Date", CHAT_CLIENT_JS)
   ```

   Un constructor que devuelve un objeto **sobreescribe** el `this` de `new`, así que `new Date()` adentro del cliente entrega el doble. **Cero dependencias, cero jsdom, cero reloj real en la suite.**
3. ★ **`IDENTIFICADORES_PROHIBIDOS` (`chat-client.test.ts:16-24`) gana tres entradas**: `".style"`, `"cssText"`, `"setAttribute"`. Es el invariante negativo que el ADR 222 pto 2 exige, en su forma **mecánica y sin regex**:
   - `".style"` cubre `el.style.color = …` (con el punto adelante, para no matchear la palabra dentro de `"stylesheet"` si algún día el string la contuviera).
   - `"cssText"` cubre `el.style.cssText = …`.
   - `"setAttribute"` cubre `el.setAttribute("style", …)` **y** cualquier otra escritura de atributo. Es una prohibición **más ancha** que "estilo inline", y es deliberado: el cliente no necesita atributos —usa `hidden`, `disabled`, `value`, `textContent` y ahora `className`, todas propiedades— así que la prohibición ancha no cuesta nada y **cierra la familia entera de sumideros de atributo de una vez**, incluidos `onerror`/`href`.
   - Las **siete** entradas vigentes (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `srcdoc`) y las dos aserciones de `window.`/`globalThis` (`:31-34`) **no se tocan, no se reordenan y no se relajan**. El `it.each` las recorre: agregar filas es aditivo.
4. **La hora se formatea a mano, en 24h y con dos dígitos** — `HH:MM`, hora **local** del navegador:

   ```js
   function dosDigitos(n) { return n < 10 ? "0" + n : "" + n; }
   function horaActual() {
     var ahora = new Date();
     return dosDigitos(ahora.getHours()) + ":" + dosDigitos(ahora.getMinutes());
   }
   ```

   ★ **Nada de `toLocaleTimeString`**: su salida depende del locale y del build de ICU del navegador (puede dar `2:32 p. m.`, o `14:32:07`), así que **no se puede afirmar en un test** ni garantizar ancho fijo en una columna. `HH:MM` es determinista, alineado y suficiente — es un sello de lectura, no un timestamp (ADR 222 pto 4). ★ Sin `padStart`: el archivo es ES5 a propósito (`var`, `"use strict"`, cero arrow functions, cero template literals) porque vive dentro de un template literal **sin typecheck ni lint** (ADR 200 pto 4, `chat-client.ts:26-29`). **No se moderniza acá.**
5. **Segundos, fecha y zona horaria quedan afuera.** Un sello con segundos invita a leerlo como evidencia (R5 de la propuesta); la fecha no aporta en una conversación que muere con la pestaña (ADR 197: la conversación rota por inactividad y por logout).

**Alternativas consideradas**:

| Opción | Por qué se rechaza |
|---|---|
| Usar `Date` sin declararlo en el inventario | Funciona y **rompe la propiedad que el invariante compra**: que el test pueda sombrear todo el entorno. §0.2 |
| Pedirle la hora al servidor (`POST /mensaje` devuelve `timestamp`) | Cambia el contrato de una ruta autenticada para pintar. **Ya rechazada por el ADR 222 (alternativas)** |
| Una micro-librería de fechas | Cero dependencias nuevas, criterio sostenido desde v3.2 (`package.json` sin cambio) |
| `toLocaleTimeString("es-AR", {...})` | No afirmable ni de ancho fijo. Pto 4 |
| Prohibir el estilo inline con un regex sobre la fuente | Un regex sobre JS es frágil y da falsos negativos. Tres `toContain` son legibles y no mienten. Pto 3 |

---

## 6. RD-105 resuelta: por dónde entra el CSS, la paleta y el contraste

**Por dónde entra — verificado leyendo, que era la instrucción explícita de RD-105** (*"a verificar leyendo `chat-page.ts` y la CSP de `server.ts`, no razonando desde acá"*):

| Pregunta de RD-105 | Respuesta verificada |
|---|---|
| ¿Cómo se sirve hoy `CHAT_CSS`? | Como **asset separado** en `GET /chat/app.css`, `text/css; charset=utf-8` (`server.ts:891-893`, ruta `config.ts:62`), referenciado por `<link rel="stylesheet" href="/chat/app.css">` (`chat-page.ts:54`). **Nunca inline** — lo dice su propio doc-comment (`chat-page.ts:22`) |
| ¿Hay que tocar la CSP? | ★ **No.** `CSP_CHAT` ya trae `style-src 'self'` (`config.ts:72-73`), que autoriza exactamente esa hoja. **Reglas nuevas en `CHAT_CSS` = cero diff de CSP.** El literal está clavado con igualdad completa en dos tests (`config.test.ts:144-148`, `server.test.ts:2035`): **si alguien la tocara, fallan solos** |
| ¿Se inventa un canal nuevo? | **No.** Se agregan reglas al string que ya existe. `renderChatHtml()` **no cambia ni un carácter**: `<div id="mensajes">` (`chat-page.ts:69`) ya es el contenedor |

**Las reglas nuevas** (se **agregan** al final de `CHAT_CSS`; las cinco vigentes de `:24-44` **no se editan**):

```css
.turno {
  border-left: 3px solid transparent;
  margin-bottom: 8px;
  padding-left: 8px;
}
.turno-hora {
  color: #616161;
  font-variant-numeric: tabular-nums;
  margin-right: 8px;
}
.turno-autor {
  font-weight: 600;
  margin-right: 8px;
}
.turno-texto {
  display: block;
}
.turno-empleado { border-left-color: #1b5e20; }
.turno-empleado .turno-autor { color: #1b5e20; }
.turno-arnes { border-left-color: #0d47a1; }
.turno-arnes .turno-autor { color: #0d47a1; }
```

**Cinco propiedades, cada una con su motivo**:

1. ★ **El color NO es el único portador** (ADR 222 pto 5), y acá hay **tres** portadores redundantes: el autor **escrito en texto** (`.turno-autor`), la **barra lateral** (`border-left`, que se ve en escala de grises y en monocromo), y el color. Un usuario daltónico distingue igual; un usuario de lector de pantalla lee el autor.
2. **Contraste verificado contra el fondo blanco del `body`** (no hay `background-color` declarado, `chat-page.ts:27-32`): `#1b5e20` ≈ **8.4:1**, `#0d47a1` ≈ **9.7:1**, `#616161` ≈ **6.1:1**. Los tres pasan WCAG AA (4.5:1) con margen; los dos primeros pasan **AAA** (7:1).
3. ★ **`white-space: pre-wrap` de `#mensajes` (`:36-41`) NO se toca.** Es heredable, así que sigue valiendo para `.turno-texto` y los saltos de línea del modelo se siguen preservando — que es lo que su test afirma (`chat-page.test.ts:40-42`, **sobrevive sin cambio**). Y como los nodos se crean por DOM y no por HTML parseado, **no hay nodos de texto en blanco entre los `span`**: `pre-wrap` no introduce separación fantasma.
4. **La separación es por `margin-right`, no por caracteres**: §4 pto 6.
5. **`font-variant-numeric: tabular-nums`** para que la columna de horas no baile entre turnos. Es una línea y es la diferencia entre "se lee de un vistazo" y "hay que buscar".

**Lo que NO entra**: scroll automático, `max-height`, burbujas, avatares, `@media`, modo oscuro. **Se agregan dos afordancias nombradas, no una interfaz nueva** (*Out of Scope* de la propuesta).

---

## 7. Contratos e interfaces

★ **Este change no agrega, no quita y no cambia ni un tipo exportado.** Verificado archivo por archivo. Lo único que cambia de forma es una función **interna** del template literal del cliente, que no tiene tipo porque no la ve el compilador (ADR 200 pto 4):

```js
// src/adapters/web/chat-client.ts — DENTRO del template literal, sin typecheck
// ANTES: agregarTurno(autor: etiqueta visible, texto)
// AHORA: agregarTurno(claveAutor: "empleado" | "arnes", texto)
var AUTORES = { empleado: {...}, arnes: {...} };   // tabla cerrada, molde de MENSAJES_ERROR (:39-46)
function nodoSpan(clase, texto) { ... }             // helper privado nuevo
function horaActual() { ... }                       // helper privado nuevo
function dosDigitos(n) { ... }                      // helper privado nuevo
```

**Lo que NO cambia de firma, y es verificable por `git diff`**: `OperacionRegistrarVenta`, `RegistrarVentaInput`, `RegistrarVentaResult`, `registrarVenta`, `EjecutarOperacionDeps`, `EjecutarOperacionInput`, `ejecutarOperacion`, `ConfirmacionOperacionPort`, `SesionEmpleado`, `RegistroAccionesEmpleadoPort`, `renderChatHtml`, `CHAT_CSS` (sigue siendo `string`), `CSP_CHAT`, las cuatro constantes de ruta, y los contratos de `POST /operaciones`, `POST /login` y `POST /logout`.

---

## 8. Flujo de datos

```
UNIDAD 1
empleado: "registrale a Pérez el plan Premium por 1200"
  ▼  POST /operaciones  Bearer <token>                     [CONTRATO SIN CAMBIO]
tool operacion_negocio → validarOperacion → ejecutarOperacion
  ▼
ejecutarRegistrarVenta(operacion, sesion, casoIdActual, deps)        :653-658
  ├─ registrarVenta({ vendedorId: sesion.empleadoId,  ← ★ closure, NUNCA del modelo  :673
  │                   vendedorNombre: operacion.…,    ← ★ del modelo (§0.1)          :674
  │                   clienteId, clienteEmail, … })                                  :671-682
  │       └─ store.crearVentaConCaso  →  vendedores ON CONFLICT SET nombre  ← ★ R7
  ├─ registrar({comando, ventaId, casoId, resultado: creada})   ← auditoría INTACTA   :684-689
  └─ plantilla determinista                                                          :691-692
        ★ usa: vendedorNombre, clienteId, ventaId, casoId, notificado, link
        ★ NO usa: clienteEmail, monto, planNuevo, empleadoId
  ▼
200 {casoId, respuesta}                                   [CONTRATO SIN CAMBIO]

UNIDAD 2
cuerpo.respuesta ──► agregarTurno("arnes", cuerpo.respuesta)     chat-client.ts:183
texto del textarea ─► agregarTurno("empleado", texto)            chat-client.ts:182
        ▼
   div.turno.turno-<autor>  +  3 × span[className, textContent]
        ▼
   #mensajes.appendChild(turno)        ← única escritura de DOM del camino
```

★ **Dónde NO aparece nada nuevo**: `server.ts`, rutas, payloads, cabeceras, CSP, esquema, migraciones, `sesion.ts`, modelo de rol, `src/core/ventas/**`, `package.json`. **Si alguno aparece en el diff, el alcance se filtró** (*Aclaración previa 2* de la propuesta).

---

## 9. Archivos — reconciliación contra el *Affected Areas* de la propuesta

| Archivo | Acción | Prod | Test | Qué cambia exactamente | ¿Coincide con la propuesta? |
|---|---|---|---|---|---|
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | **~8** | ~40 | **Una línea reemplazada** (`:692`) + ~6 de doc-comment nuevo en `:645-652` (§0.1: por qué `vendedorNombre` es declarado y `clienteEmail` está prohibido). **Ninguna rama nueva, ninguna llamada nueva, ningún `await` nuevo** | ✅ Sí |
| `src/adapters/web/chat-client.ts` | Modified | ~45 | ~130 | `AUTORES` (~4), `agregarTurno` reescrita (5→10), `nodoSpan`/`horaActual`/`dosDigitos` (~10), 2 call sites (`:182-183`), doc-comment `:17-22` de cuatro a **cinco** identificadores (ADR 228 pto 1) | ✅ Sí |
| `src/adapters/web/chat-page.ts` | Modified | ~28 | 0 | **Sólo `CHAT_CSS`**: 8 reglas nuevas **agregadas al final**; las cinco vigentes (`:24-44`) **no se editan**. `renderChatHtml()` **sin una línea de diff** | ✅ Sí — y más acotado: el HTML no se toca |
| `src/adapters/web/chat-client.test.ts` | Modified | — | ~130 | +3 entradas prohibidas (ADR 228 pto 3), `className` en `ElementoFake` (`:41-50`) y en `crearElementoFake` (`:52-75`), `Date` doble en `new Function` (`:139`), **XSS retargeteado a `children[2]` con conteo `3`** (§0.3), + los casos nuevos de §10 | ✅ Esperado (R4) |
| `src/core/operaciones/ejecutar-operacion.test.ts` | Modified | — | ~40 | El `it` de `:405-422` pasa de `toContain("registrada")` a aserciones sobre el contenido; **+ el test en negativo del email** | ✅ Sí |
| `src/adapters/web/chat-page.test.ts` | Modified | — | ~8 | **Aditivo**: las reglas nuevas están presentes. Los dos `it` vigentes (`:39-47`) **sobreviven sin tocar** | ✅ Sí |
| `docs/progreso/v3.11-ergonomia-canal-empleado/` | New | ~60 | — | Eco legible + chat con ≥4 turnos alternados | ✅ Sí |
| ★ `docs/ARC42_Harness_Empresarial.md`, `README.md` | ★ **Sin cambio** | **0** | — | **Verificado leyendo, no asumido**: ningún documento transcribe el eco de `registrar_venta` (`Grep` de `"registrada (caso"` y `"Notificación al cliente"` sobre `docs/` + `README.md` ⇒ único hit vivo: `ejecutar-operacion.ts:692`; el otro es evidencia histórica de v3.10, **que no se reescribe**). Y `README.md:298` describe el chat por su invariante (*"El texto del modelo se inserta siempre como texto (`textContent`), nunca como HTML"*) — **sigue siendo cierto palabra por palabra** | ⚠️ La propuesta lo dejaba condicional (*"sólo si… a verificar leyendo"*). **Verificado: no hace falta** |
| ★ `src/adapters/web/server.ts`, `config.ts`, rutas, payloads, CSP | **Sin cambio** | **0** | — | `style-src 'self'` ya cubre la hoja (§6) | ✅ Sí |
| ★ `src/core/ventas/**`, esquema/migraciones, `sesion.ts`, modelo de rol, `package.json`, `.claude/skills/**`, prompts | **Sin cambio** | **0** | — | ★ **Si aparecen en el diff, el alcance se filtró** | ✅ Sí |

**Total estimado**: **~81 líneas de producción**, ~348 de test, ~60 de docs. ⇒ **≈ 490 líneas de diff**, de las cuales **menos de 90 son producción**.

### 9.1 Presupuesto de review (R2)

**Una sola PR alcanza y es lo recomendado.** El presupuesto de 400 cuenta `additions + deletions`, así que el total roza el techo, **pero la propiedad que el presupuesto protege —carga cognitiva— se cumple con holgura**: el diff de producción son **tres archivos y ~81 líneas**, y **~350 del total son tests**, que es lectura confirmatoria, no deliberativa.

★ **Si `sdd-tasks` prefiere no discutir el número**: el corte natural es **una PR por unidad** (eco ≈ 50 líneas / chat ≈ 440), son **independientes entre sí** (`proposal.md:97-102`), **revertibles por separado** y no comparten ni un archivo. **En ese caso, `stacked-to-main`**: no hay integración que coordinar, y `feature-branch-chain` agregaría una rama tracker para dos slices que no se tocan.

---

## 10. Testing (TDD estricto — `AGENTS.md`: test primero en toda tarea con lógica)

**Los dos rojos iniciales**, en el orden que la propuesta fijó (*Success Criteria*, último punto):

1. ★ **Unidad 1** — *"el eco nombra al vendedor y al cliente"*. Hoy **pasa en verde de la forma equivocada**: `expect(texto).toContain("registrada")` (`ejecutar-operacion.test.ts:421`) seguiría verde con el texto viejo, con el nuevo, y con casi cualquier cosa. El rojo se construye afirmando `toContain("Juan Pérez")` y `toContain("cliente-1")` sobre la fixture que ya existe (`:409-416`).
2. **Unidad 2** — *"el turno tiene tres nodos y una clase por autor"*. Hoy **no puede ni escribirse**: `ElementoFake` no tiene `className` (`chat-client.test.ts:41-50`).

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Unit ★ | **Eco, en positivo**: el texto contiene `vendedorNombre`, `clienteId`, `ventaId`, `casoId`, el estado de notificación y el link — **los seis**, y `ventaId ≠ casoId` en la fixture para que la posición no pueda mentir | `ejecutar-operacion.test.ts`, fixture vigente `:409-416` |
| Unit ★★ | **Eco, en negativo — el único criterio con consecuencia de privacidad** (ADR 221 pto 3, R1): con `clienteEmail: "cliente@example.com"`, el texto devuelto **no contiene** `"cliente@example.com"` **ni** `"@"`. ★ **La aserción de `"@"` es la que atrapa un formateo creativo** (`c***@example.com`, `cliente [at] example.com`) que un `toContain` del email completo dejaría pasar | Ídem. **Obligatorio** |
| Unit | **Eco, no-regresión de alcance**: con `monto: 1234` y `planNuevo: "premium"`, el texto **no** contiene `"1234"` (ADR 221 pto 4, §3 pto 3) | Ídem |
| Unit | **La auditoría no cambió**: `registrar` sigue recibiendo `{comando, ventaId, casoId, resultado: creada}` — el eco no toca la fila (`:684-689`) | Doble de `RegistroAccionesEmpleadoPort` |
| Unit mecánico ★ | **`CHAT_CLIENT_JS` no contiene** las **diez** entradas prohibidas: las 7 vigentes + `".style"` + `"cssText"` + `"setAttribute"` (ADR 228 pto 3). **Más `window.`/`globalThis`, sin tocar** | `it.each` vigente `:26-35`, aditivo |
| Unit funcional ★ | **Estructura del turno**: tras un envío exitoso, `mensajes.children` tiene **2**; `children[0].className === "turno turno-empleado"`, `children[1].className === "turno turno-arnes"`; cada uno tiene **exactamente 3** hijos con `className` `turno-hora`/`turno-autor`/`turno-texto` **en ese orden** | Doble de DOM + `className` nuevo en `ElementoFake` |
| Unit funcional ★ | **El autor está en TEXTO, no sólo en color** (ADR 222 pto 5): `children[0].children[1].textContent === "Vos"` y `children[1].children[1].textContent === "Arnés"` | Ídem |
| Unit funcional ★ | **La hora está y tiene el formato exacto**: con el doble `Date` de `(9, 5)` ⇒ `turno-hora.textContent === "09:05"`. ★ **El caso de un dígito es el que prueba `dosDigitos`** — con `(14, 32)` solo, un `slice` roto pasaría | `new Function` con **cinco** parámetros (ADR 228 pto 2) |
| Unit funcional ★ | **XSS, retargeteado no aflojado** (§0.3): payload `<script>alert(1)</script>` ⇒ `elementosCreados` **no contiene** `"script"` ni `"img"`; el turno tiene **3** hijos; **`children[2].textContent` contiene el payload verbatim** | Molde vigente `:178-190` |
| Unit funcional ★ | **NUEVO — sólo se crean `div` y `span`**: `new Set(documento.elementosCreados)` es exactamente `{"div","span"}`. Cierra en positivo lo que el `not.toContain` cierra en negativo caso por caso | Ídem |
| Unit ★ | **Ningún string dinámico llega a `className`** (ADR 227 pto 1): con un mensaje de empleado `"arnes"` y una respuesta `"turno-empleado"`, las clases de los dos turnos **siguen siendo las correctas** — o sea, el texto no influye en la clase | Ídem |
| Unit | **`CHAT_CSS` trae las reglas nuevas** y **conserva** `white-space: pre-wrap` (`chat-page.test.ts:40-42`, sin tocar) | Aserciones sobre el string |
| Unit no-regresión ★ | **La CSP no cambió**: `config.test.ts:144-148` y `server.test.ts:2035` comparan el literal **completo**. **No se tocan — si alguien agrega `unsafe-inline`, fallan solos** | Ya existen. **Reverificar en verde** |
| Manual E2E | (a) `registrar_venta` por chat: el eco nombra vendedor y cliente, **no muestra el email**, conserva los dos ids. (b) Chat con **≥4 turnos alternados**: dos colores, dos etiquetas, cuatro horas. (c) ★ **Captura en escala de grises** o con el color forzado, mostrando que autor y barra distinguen igual (ADR 222 pto 5, R6) | `docs/progreso/v3.11-ergonomia-canal-empleado/`, molde `verificacion-manual-tarea-19.md` de v3.10 |

---

## 11. Migración y rollback

**Sin migración.** Cero tablas, columnas, índices y backfill. Próxima migración libre sigue siendo `0014_`, **sin consumir**.

1. **Las dos unidades son aditivas e independientes**, y ninguna deja estado atrás.
2. **El eco** ⇒ restaurar la línea `:692`. **Nada lo consume**: la auditoría se arma aparte (`:684-689`), `RegistrarVentaResult` no lo incluye (`registrar-venta.ts:91-96`), y ningún test fuera de `ejecutar-operacion.test.ts` lo menciona (`Grep` verificado). ★ **Lo único que queda escrito con el texto nuevo es el transcripto del SDK de conversaciones ya ocurridas** — texto histórico, sin lector programático.
3. **El chat** ⇒ restaurar `agregarTurno` y quitar las reglas de `CHAT_CSS`. **Ningún turno anterior queda ilegible**: la transcripción se rearma del lado del cliente en cada carga (el token muere con la recarga, ADR 193) y **no se persiste ningún DOM**.
4. **Reversión parcial segura**: quitar sólo el CSS deja la estructura DOM sin color — **degradación limpia**, el autor y la hora siguen en texto. Al revés (quitar la estructura y dejar el CSS) sólo deja reglas muertas. **Ningún orden de reversión produce una página rota.**
5. **No hay rollback de datos posible ni necesario**: este change no escribe en ninguna tabla.

---

## 12. Riesgos nuevos que el diseño descubrió

Continúa desde **R6** (techo de la propuesta).

| # | Riesgo | Prob. | Tratamiento |
|---|---|---|---|
| **R7** ★ | **El nombre del vendedor es texto libre del modelo y cada venta lo PISA** en `vendedores.nombre` (`repository.ts:700-703`, `ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre`, **sin `COALESCE`** — a diferencia de `responsables`, `:392`), propagándose al reporte de comisiones (`reporte.ts:154-155`). Hoy ocurre **en silencio** | **Preexistente, Media** | ★ **No lo introduce este change y este change NO lo arregla** (sería `repository.ts`: alcance filtrado, §0.1 pto 4). **Lo vuelve visible**: el eco es el único punto donde ese texto se le devuelve a un humano antes de quedar escrito. **Se declara acá y queda nombrado para un change propio**; la salida legítima es `COALESCE` o un nombre derivado del registro de empleados, y **las dos son decisiones de persistencia con checkpoint** |
| **R8** ★ | **Deriva de los tres lugares del invariante de identificadores libres**: doc-comment (`chat-client.ts:17-22`), `new Function` del test (`chat-client.test.ts:139`) y spec. Si el quinto (`Date`) entra en dos y no en tres, la garantía queda **escrita en un lado y verificada en otro** | **Alta si se ignora** | ADR 228 pto 1: **los tres en el mismo commit**. ★ **Instrucción para `sdd-apply`: es un solo cambio con tres archivos, no tres tareas** |
| **R9** ★ | **El test de XSS se "arregla" aflojándolo** cuando pase de 1 a 3 hijos — borrar el `toHaveLength` es la salida de menor esfuerzo y **deja la suite verde con la garantía muerta** | **Media** | §0.3: conteo exacto `3`, payload verbatim en `children[2]`, **más** la aserción nueva de `{"div","span"}`. ★ **Para el Reviewer: si el diff de `chat-client.test.ts` BORRA una aserción en vez de reapuntarla, rechazar** |
| **R10** | **El sello de hora se lee como evidencia** ("la operación fue a las 14:32") | **Baja-Media** | ★ Ya es **R5** de la propuesta; el diseño la refuerza con mecanismo: **sin segundos y sin fecha** (ADR 228 pto 5), o sea el sello **no tiene la forma** de un timestamp de auditoría. La hora auditable sigue en `registro_acciones_empleado` |

---

## 13. Open Questions para el checkpoint

- [ ] ★ **§0.1 — `vendedorNombre` NO es el empleado autenticado.** La *Nota de vocabulario* de la propuesta (`:38`) transfiere a `vendedorNombre` una garantía que el ADR 171 pto 2 da sólo a `vendedorId`. Verificado: el nombre lo llena **el modelo** (`ejecutar-operacion.ts:674`). **Es una corrección de lectura, no un cambio de decisión** —el eco sigue mostrando ese campo, como el ADR 221 pto 1 mandó—, pero cambia el TEXTO: dice `vendedor <nombre>` y **nunca** *"registrado por"*. Ratificá esa redacción.
- [ ] ★ **R7 — el pisado silencioso del nombre del vendedor.** Consecuencia de §0.1 que la propuesta no vio: cada venta reescribe `vendedores.nombre` desde texto del modelo, y eso llega al reporte de comisiones. **Este change lo hace visible y NO lo arregla** (sería `repository.ts`). ¿Se acepta declarado, o querés que abra change propio ya?
- [ ] **ADR 227 pto 3 — `className` en vez de `classList`.** La propuesta escribió *"el color entra por `classList`, no por atributo `style`"* (`:62`). Este diseño lo lee como el **contraste** que enuncia (clase CSS vs. estilo inline) y elige `className` porque el doble de DOM está escrito a mano y jsdom está prohibido (§4 pto 3). **La garantía de seguridad es idéntica.** ¿Lo ratificás?
- [ ] **ADR 227 pto 2 — dos autores, no tres.** La propuesta nombró *"empleado / arnés / sistema"*; **no existe ningún escritor de "sistema"** (los errores van a `estadoMensaje`, nunca a la transcripción). ¿Confirmás que no se crea un tercer autor sin escritor?
- [ ] **§9 — arc42 y README quedan SIN CAMBIO.** La propuesta lo dejó condicional a verificar leyendo; verificado: ningún documento transcribe el eco, y `README.md:298` describe el chat por su invariante, que sigue siendo cierto. ¿Se acepta, o querés una línea igual en la sección de chat del README?
- [ ] **§9.1 — una sola PR.** El diff total roza el presupuesto de 400 (~490), pero **menos de 90 líneas son producción**. Recomendación: **una PR**. Si preferís dos, el corte es **eco / chat** en `stacked-to-main`.
- [ ] **Numeración: ADR 227-228, no 223.** El change hermano (`devolucion-sin-token-dos-personas`) ya reservó **223-226** y **RD-106 a RD-111**. Este diseño abre en **227** y **no abre RD nueva** (RD-105 queda resuelta acá). Confirmá también `v3.11.0` y el orden de merge (**R3** de la propuesta: este change primero).
