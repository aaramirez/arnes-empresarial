# Diseño técnico: Chat web de empleado con memoria conversacional real

**Change**: `chat-web-empleado` · **Propuesta**: `openspec/changes/chat-web-empleado/proposal.md` (ADR 189-195, R1-R10, RD-88 a RD-97).

**Numeración verificada en esta fase** (`Grep` sobre `openspec/`, `src/`, `docs/`): el único archivo del repo que menciona `ADR 189`-`ADR 195` y `RD-88`-`RD-97` es la propia propuesta de este change. Techo real hoy: **ADR 195** y **RD-97**. Este diseño abre en **ADR 196**.

> ⛔ **Corrección de una referencia del encargo de esta fase.** El predicado de confirmación humana **no vive en `src/core/solicitudes/`** — ahí no aparece la palabra `origenCasoId` en ningún archivo. Vive, verificado línea por línea:
> - **`src/adapters/web/confirmacion-operaciones-store.ts:46-51`** — el predicado en sí (`pendiente.origenCasoId !== casoIdActual`, línea **50**), dentro de `coincideCancelacionConversacional`.
> - **`src/core/operaciones/ejecutar-operacion.ts:253`** (lectura, `estaConfirmada(...)`) y **`:272`** (escritura, `marcarPendiente({..., origenCasoId: input.casoIdActual})`) — los dos call sites del núcleo.
> - **`src/core/operaciones/operaciones-contract.ts:134-144`** — la interfaz `ConfirmacionOperacionPort`.
>
> La Aclaración 3 de la propuesta cita bien el archivo (`confirmacion-operaciones-store.ts:40-52`); el error estaba en el encargo, no en la propuesta.

---

## 0. Qué NO se reabre acá

Fijado por el checkpoint vía ADR 189-195 y consumido como dado: memoria real es requisito (189), mismo listener (190), vanilla JS sin bundler ni dependencias nuevas —**tampoco `devDependencies`**— (191), texto nunca HTML + CSP (192), token en memoria de la pestaña (193), espera larga como estado de primera clase (194), logout real en el puerto (195). Este documento **elige mecanismos**; no negocia esos invariantes.

Dos reglas duras del repo que atraviesan todo el diseño: `src/core/` nunca importa de `src/adapters/*`, y ningún adaptador importa de otro adaptador (`AGENTS.md`). El *composition root* (`src/main.ts` y los `build-on-*.ts`, que viven en `src/`, por encima de `core/` y `adapters/`) sí puede conocer a los dos — es exactamente su trabajo, y es donde este diseño pone la pieza nueva.

---

## 1. Resumen de la arquitectura elegida

**RD-88 se resuelve con la Opción B, en su variante más barata: un `conversacionId` que agrupa N `casoId`s, implementado como un decorador per-turno del `MemoryContextPort` construido en el composition root.** Cero cambios en `src/core/turn-selector/`, cero migración de esquema, cero campo nuevo en el request de `POST /operaciones`, y el predicado `origenCasoId !== casoIdActual` **no se toca ni una letra**.

La clave estaba en leer el mecanismo real de memoria, no el que la intuición supone:

- `assembleContext(memory, casoId, agentId)` (`src/core/turn-selector/assemble-context.ts:146-162`) hace dos lecturas: `getCasoById(casoId)` y `getLatestSesionAgente(casoId, agentId)`, y devuelve `resumeSessionId`.
- `invokeModel` lo baja a `options.resume = context.resumeSessionId` (`src/core/turn-selector/invoke-model.ts:379-380`). **El historial lo tiene el SDK; el arnés sólo aporta una llave.**
- `closeTurn` (`src/core/turn-selector/close-turn.ts:135-142`) escribe `createSesionAgente({ casoId, agentId, sdkSessionId })` — una fila nueva por turno, nunca un `UPDATE`.
- **`memory` es un puerto inyectado**, no un import. `handleTurn` lo recibe en `HandleTurnDeps.memory` (`handle-turn.ts:161`) y `buildOnOperacionesEmpleado` lo pasa tal cual (`build-on-operaciones-empleado.ts:196`). El propio doc-comment de `assemble-context.ts:44-48` dice que la capa de wiring "plugs in the real adapter with a one-line closure per method".

Entonces: **para que el mensaje N recuerde el N-1 no hace falta que compartan `casoId`; hace falta que la lectura `getLatestSesionAgente` del mensaje N apunte al `casoId` del mensaje N-1.** Eso es un closure de cuatro líneas en `build-on-operaciones-empleado.ts`, no un cambio de núcleo ni una tabla nueva.

La "conversación" es entonces **un puntero al último `casoId` cerrado con éxito**, guardado en un `Map` de proceso escopeado por token de sesión HTTP — el mismo molde exacto que `confirmacion-operaciones-store.ts` ya usa para su ranura por empleado.

### 1.1 La cadena, mensaje a mensaje

| Mensaje | `casoId` del turno | `options.resume` que recibe el SDK | Fila escrita por `closeTurn` | `ultimoCasoId` tras el turno |
|---|---|---|---|---|
| 1 | `A` | *(ninguno)* | `(A, agente, S1)` | `A` |
| 2 | `B` | `S1` — resuelto vía `A` | `(B, agente, S2)` | `B` |
| 3 | `C` | `S2` — resuelto vía `B` | `(C, agente, S3)` | `C` |
| 4 (**falla**) | `D` | `S3` — resuelto vía `C` | *(ninguna)* | `C` — **no avanza** |
| 5 | `E` | `S3` — resuelto vía `C` | `(E, agente, S5)` | `E` |

El turno 4 muestra la propiedad más importante del mecanismo: **el puntero avanza sólo cuando `handleTurn` resolvió**. Un turno fallido no amnesia la conversación — la deja exactamente donde estaba.

### 1.2 Por qué el invariante de confirmación sobrevive intacto

Cada mensaje sigue teniendo su `casoId` propio y distinto (`build-on-operaciones-empleado.ts:171`, `const casoId = newId()`, **se conserva literal**). Entonces:

| Escenario | `origenCasoId` | `casoIdActual` | `!==` | Resultado |
|---|---|---|---|---|
| Dos invocaciones de la tool **en el mismo mensaje** | `C` | `C` | `false` | ★ **Autoconfirmación imposible** — igual que hoy |
| Propuesta en mensaje 2, confirmación en mensaje 3 | `B` | `C` | `true` | Confirma — igual que hoy |
| Propuesta en mensaje 2, confirmación **en otra conversación del mismo empleado** | `B` | `Z` | `true` | Confirma — igual que hoy (la ranura de confirmación es por `empleadoId`, no por conversación; **comportamiento preexistente, no introducido acá**) |

`src/adapters/web/confirmacion-operaciones-store.ts` **no aparece en el diff de este change**. La instrucción operativa del ADR 189 pto 4 ("si la confirmación deja de funcionar, la corrección NO es relajar el predicado") queda satisfecha por la vía más fuerte posible: la confirmación **nunca deja de funcionar**, porque el discriminante que usa nunca cambia de semántica.

---

## 2. ADR 196 (RD-88) ★: la conversación es un **puntero al `casoId` anterior**, resuelto por un decorador del `MemoryContextPort` en el composition root

**Contexto.** Aclaración 3 de la propuesta, más lo verificado en §1. Las dos opciones que la propuesta dejó abiertas eran "un `casoId` por conversación" (A) y "`casoId` por mensaje + agrupador" (B). La propuesta estimó B como *"Alto — concepto, tabla/índice y puerto nuevos"*. **Esa estimación era pesimista**: el agrupador no necesita persistencia porque la conversación no necesita sobrevivir al proceso (ver ADR 197), y el "mecanismo nuevo que resuelva la sesión a retomar a través de varios `casoId`" ya existe — es el puerto inyectado que `assembleContext` recibe.

**Decisión**:

1. **`casoId` sigue siendo uno por mensaje.** `build-on-operaciones-empleado.ts:171` no cambia. Opción A queda **rechazada** (ver alternativas).
2. **Concepto nuevo `conversación`**: identificada por un `conversacionId` (`randomUUID`), con estado `{ conversacionId, ultimoCasoId, turnos, ultimaActividad }`. **Estado de proceso, no de negocio** — vive en un `Map`, nunca en SQLite.
3. **La conversación se escopea por SESIÓN HTTP de empleado** (la clave del `Map` es el token opaco que `sesionStore.crear` devolvió), no por `empleadoId` ni por un id que venga del request. Ver §2.1 para por qué esa elección es de seguridad y no de gusto.
4. **Puerto nuevo en el núcleo**, `ConversacionEmpleadoPort` (`src/core/conversacion/conversacion-contract.ts`, sin imports), con implementación en `src/adapters/web/conversacion-empleado-store.ts`. Molde exacto de `ConfirmacionOperacionPort` (contrato en `core/operaciones/operaciones-contract.ts:134`, implementación en `adapters/web/confirmacion-operaciones-store.ts`).
5. **Viaja como argumento de la función devuelta**, junto a `sesion` y `confirmacion` — no en `BuildOnOperacionesEmpleadoDeps`. Es la regla que el ADR 167 §6 pto 2 ya fijó para el estado vivo por-request, y la que mantiene a `buildOnOperacionesEmpleado` agnóstico del transporte (ADR 172 pto 7).
6. **El mecanismo es un decorador per-turno del `MemoryPort`**, construido dentro del handler devuelto:

   ```ts
   const memoriaConversacional: MemoryPort = {
     getCasoById: (id) => memory.getCasoById(id),
     // ★ ÚNICO método redirigido: la sesión a retomar se resuelve contra el
     //   `casoId` del mensaje ANTERIOR de esta conversación, no contra el de
     //   este mensaje — que por construcción es nuevo y no tiene historial.
     getLatestSesionAgente: (casoIdDelTurno, agentId) =>
       memory.getLatestSesionAgente(input.conversacion.casoAnterior() ?? casoIdDelTurno, agentId),
     updateCaso: (id, update) => memory.updateCaso(id, update),
     createSesionAgente: (fila) => memory.createSesionAgente(fila),
   };
   ```

   Se escribe **campo por campo, sin `...spread`**: un spread copiaría en silencio cualquier método futuro del puerto, que es justo lo que no queremos de una pieza cuyo valor es ser auditable de una mirada.
7. **`registrarTurno(casoId)` se llama DESPUÉS de que `handleTurn` resolvió**, nunca antes y nunca en el `catch`. Un turno fallido deja la conversación donde estaba (§1.1, fila 4).
8. **`src/core/` no cambia**: ni `assemble-context.ts`, ni `handle-turn.ts`, ni `close-turn.ts`, ni `invoke-model.ts`. El único archivo nuevo en `core/` es un contrato sin comportamiento. **Verificable por `git diff --stat src/core/`**.
9. ★ **Prohibido el reintento automático sin `resume`.** Si el SDK falla al retomar una sesión (`TurnFailedError` con `stage: "model"`), **no se reintenta el turno sin `options.resume`**. Motivo: la falla puede haber ocurrido *después* de que la tool ejecutó una operación de negocio, y un reintento duplicaría una operación del camino del dinero. La salida es del empleado (cerrar sesión y volver a entrar arranca conversación nueva), nunca automática. Escrito con el mismo carácter operativo que el ADR 189 pto 4, y por el mismo motivo: es el atajo que un `apply` apurado tomaría.

**Alternativas consideradas**:

| Opción | Costo real | Por qué se rechaza |
|---|---|---|
| **A — un `casoId` por conversación** | Una línea | ★ Rompe `origenCasoId !== casoIdActual` (arc42 `:566`) y obliga a rediseñar el discriminante de confirmación con un id por mensaje distinto de `casoId`. Cambia además la semántica de `casos.estado`/`updatedAt` para los cuatro turnos. **Pagar un rediseño de un invariante de seguridad para ahorrar un closure de cuatro líneas es exactamente el intercambio que no se hace.** |
| **B con tabla `conversaciones` en SQLite** | Migración + índice + puerto de escritura + rollback de esquema (RD-96) | La conversación no tiene valor fuera del proceso: el SDK es quien guarda el historial y el token de sesión ya muere con el proceso (`Map` en memoria, `sesion-empleado-store.ts:29`). Persistir el puntero sin persistir ni la sesión ni el historial sería persistir la mitad inútil del par. |
| **B con parámetro nuevo en `assembleContext`** (`resumeDesdeCasoId?`) | ~15 líneas en `core/` + tests | Es la variante honesta-pero-cara: toca núcleo compartido por los cuatro turnos para servir a uno. RD-88 pregunta literalmente si se puede resolver en el composition root; se puede. |
| **Memoria reinyectada por el servidor en el prompt** (tercera variante del ADR 189) | Store de mensajes + concatenación + techo de tokens | Duplica lo que `resume` ya hace y contradice el diseño del Ensamblador de Contexto que el arc42 declara. Sólo valdría si A y B fueran ambas caras; B no lo es. |
| **`conversacionId` viajando en el body de `/operaciones`** | Trivial | ★ **Rechazada por seguridad, no por alcance**: pondría bajo control del navegador cuál conversación se retoma. Un empleado podría apuntar al `casoId`/`conversacionId` de otro y el arnés le serviría el historial ajeno vía `resume`. Ver §2.1. |

**Consecuencias**: la memoria es aditiva, borrable y sin migración (RD-96 se disuelve). El costo es una pieza de estado de proceso más (`Map`) con su techo propio (ADR 197) y una **enmienda documental al arc42**: hasta hoy "una conversación" y "un caso" eran sinónimos; a partir de acá, en el turno de empleado por HTTP, **una conversación es una cadena de N casos ligados por `sesion_agente`**. Eso se escribe en el arc42 (Concepto de cierre del reparto de canales), no se deja implícito.

### 2.1 Por qué la clave del `Map` es el token y no el `empleadoId` — y por qué no hay `conversacionId` en el request

Tres propiedades, todas estructurales:

1. **El `casoId` anterior NUNCA viene del request.** Sale de `newId()` del servidor y se guarda en un `Map` indexado por un token opaco de alta entropía que el servidor generó. No hay ninguna entrada por la que un cliente pueda influir en qué sesión del SDK se retoma. Si el `conversacionId` viajara en el body, esa propiedad se perdería y habría que defenderla con validación — un `if` que, como dice el ADR 98 pto 4 que el repo ya cita, *"se borra en un refactor distraído"*.
2. **Aislamiento entre empleados (ADR 189 pto 5) por construcción**: dos empleados tienen tokens distintos ⇒ entradas distintas ⇒ cadenas de `casoId` distintas. Es imposible expresar "la conversación del otro". Mismo argumento que `confirmacion-operaciones-store.ts:55` ya hace para su ranura, un nivel más estricto.
3. **La conversación empieza y termina donde empieza y termina la sesión**, sin política extra: `POST /login` ⇒ token nuevo ⇒ conversación nueva; `POST /logout` ⇒ token muerto ⇒ conversación muerta. Esto da el *"principio explícito"* que la capability `memoria-conversacional-empleado` pide, y hace que el ADR 195 pto 3 ("una sesión nueva no hereda la conversación anterior") se cumpla con un `delete`, no con una regla.

Consecuencia coherente con el ADR 193: como el token vive en memoria de la pestaña, **una pestaña = una sesión = una conversación**. Recargar pierde el token, luego pierde la conversación. Es el mismo costo de usabilidad que el ADR 193 pto 4 ya aceptó explícitamente, no uno nuevo.

**Asimetría declarada**: la ranura de confirmación sigue escopeada por `empleadoId` (no se toca, *Out of Scope*), así que una cancelación propuesta en una pestaña puede confirmarse desde otra. No rompe el invariante (son `casoId` distintos, que es todo lo que el predicado exige) y es comportamiento **preexistente de v3.6**. Se nombra para que no se descubra en review como si fuera nuevo.

---

## 3. ADR 197 (RD-89): qué termina una conversación — tres cortes, ninguno silencioso para el servidor

**Contexto.** ADR 189 pto 6: una conversación con memoria crece sin límite natural, y el crecimiento real no está en el `Map` (cuatro campos por sesión) sino **dentro de la sesión del SDK que `resume` arrastra entera**.

**Decisión** — una conversación termina por cualquiera de estos, evaluados **perezosamente en el acceso** (mismo criterio que `SesionEmpleadoStore.buscar` usa con `sesionVigente`, `sesion-empleado-store.ts:39`):

| Corte | Constante | Efecto |
|---|---|---|
| **Logout explícito** | — | `conversacionStore.eliminar(token)` (ADR 202) |
| **Muerte del token** | `SESION_TTL_MINUTOS` | Sin token vigente no hay `/operaciones`; la entrada queda huérfana y la barre el corte de inactividad |
| **Inactividad** | `CONVERSACION_INACTIVIDAD_MS = 30 * 60_000` | Al próximo acceso, la entrada se **rota**: `conversacionId` nuevo, `ultimoCasoId = undefined`, `turnos = 0` |
| **Techo de turnos** | `CONVERSACION_MAX_TURNOS = 40` | Ídem: rota, no rechaza |
| **Reinicio del proceso** | — | El `Map` muere con el proceso, igual que las sesiones |

1. **El corte ROTA, nunca rechaza.** Al alcanzar el techo, el mensaje siguiente **se responde** — arrancando conversación nueva. Un `429`/`400` nuevo en `/operaciones` sería un cambio de contrato (*Out of Scope*) y, peor, dejaría al empleado sin canal por una política interna.
2. **La rotación no se anuncia en la respuesta HTTP.** Agregar un campo a `{casoId, respuesta}` cambiaría el contrato de `/operaciones`. El cliente muestra un aviso **estático** ("la conversación se reinicia tras un rato de inactividad o al cerrar sesión") en vez de duplicar la constante del servidor. **Limitación declarada**: el empleado puede ver al arnés "olvidar" sin un cartel que lo explique en ese momento exacto.
3. **La rotación queda en el log**: `logTurnEvent(casoId, "operaciones-conversacion", { conversacionId, turnos })` en `handleOperaciones`. Un `conversacionId` distinto entre dos mensajes es la traza de que rotó — y es también **la evidencia con la que se verifica el Success Criterion de memoria multi-turno**: dos `casoId` distintos bajo un mismo `conversacionId`. **El token nunca se loguea** (ADR 193 pto 3).
4. **`eliminar` borra la entrada exista o no, esté vencida o no** — idempotente, indistinguible desde afuera, mismo criterio que `buscar` documenta en `sesion-empleado-store.ts:13-16`.
5. **La evicción de entradas huérfanas queda como deuda declarada**, igual que la de sesiones vencidas (R5, ADR 195 pto 4). Con la diferencia de que acá el corte de inactividad al menos **acota el daño de memoria por entrada**, no su cantidad.

**Alternativas**: *techo por tokens de contexto* — rechazada, el arnés no ve el contexto (lo tiene el SDK), así que no puede medirlo; *conversación sin techo* — rechazada por el ADR 189 pto 6; *ruta `POST /chat/nueva-conversacion`* — rechazada por alcance: logout+login ya la produce, y una ruta más es superficie nueva para un botón que la UI puede resolver con la que ya existe.

---

## 4. ADR 198 (RD-90): el ciclo de mensaje **no** tolera recarga completa — `fetch` + JSON, como el ADR 191 alternativa 3 anticipó

Se revisitó la alternativa server-side pura (que eliminaría el vector de XSS de raíz) contra el ciclo real y **se confirma el rechazo**, con dos motivos medibles y uno nuevo:

1. `OPERACIONES_TIMEOUT_MS = 120_000` (`config.ts:43`): con recarga completa el navegador queda en blanco hasta dos minutos, **sin ningún estado intermedio posible** — lo que vacía de sentido al ADR 194 entero.
2. Un `POST` con recarga deja la página en estado re-postable: `F5` reenvía el mensaje. En un canal que llega a `registrar_venta` y `procesar_devolucion`, **un reenvío accidental es una operación de negocio duplicada**.
3. **Nuevo**: con recarga completa el token se pierde en cada navegación (ADR 193 pto 1, el token vive en memoria de la pestaña), así que habría que volverlo persistente — o sea, reabrir el ADR 193 en su punto más sensible. La alternativa "más segura contra XSS" **empeora la postura del token**. Ese intercambio no cierra.

**Consecuencia**: una sola página (`GET /chat`) con dos secciones (`login` / `chat`) conmutadas con el atributo `hidden`. **Sin navegación entre documentos, sin ruteo de cliente** — así que la condición de reapertura del ADR 191 pto 5 ("varias vistas con ruteo de cliente") sigue sin dispararse.

---

## 5. ADR 199 (RD-93): directiva CSP exacta, y **no** se toca `respondHtml`

**Decisión**. Header, literal, para las tres rutas del chat:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

| Directiva | Por qué |
|---|---|
| `default-src 'none'` | Lista blanca desde cero: lo que no se nombra abajo, no carga |
| `script-src 'self'` | Sin `unsafe-inline` (ADR 192 pto 4) y sin CDN. Cumplible **porque** el script es asset propio (ADR 191 pto 1) |
| `style-src 'self'` | Mismo criterio: **cero `<style>` inline y cero atributos `style=`** en la página |
| `connect-src 'self'` | `fetch` sólo contra el mismo origen — el token no puede exfiltrarse a otro host aunque se inyecte script |
| `form-action 'none'` | La página no tiene `<form>` con submit real; corta el envío del contenido a cualquier destino |
| `frame-ancestors 'none'` | Anti-clickjacking sin depender de `X-Frame-Options` |
| `base-uri 'none'` | Impide reescribir el origen de las URLs relativas con un `<base>` inyectado |

1. **Se agrega `X-Content-Type-Options: nosniff`** a las respuestas del chat. Es obligatorio en el momento en que el adaptador empieza a servir `application/javascript`: sin `nosniff`, un navegador puede reinterpretar el tipo.
2. ★ **No se modifica `respondHtml` (`server.ts:243-250`).** Se agrega un helper hermano, `respondHtmlChat`, que delega en `respondHtml` y suma los dos headers. Motivo: modificar `respondHtml` le pondría CSP a `GET /confirmar/:token`, que el **ADR 192 pto 5 excluye explícitamente** — y esa página sí tiene `<form>`, así que `form-action 'none'` la rompería. **Esto matiza la fila de *Affected Areas* de la propuesta que decía "CSP en `responderHtml` (`:245-248`)": el efecto es el que la propuesta quiso, el punto de inserción es un helper nuevo.**
3. **La CSP aplica a las tres rutas del chat**, no sólo al HTML: un header en el `.js` y el `.css` no cuesta nada y cubre el caso de que alguien los abra directo.
4. **Deuda declarada, no arrastrada**: `/confirmar/:token`, `/ventas`, `/devolucion` y `/soporte` siguen sin CSP. Ponerle CSP a `/confirmar` es correcto y es un change propio (necesita `form-action 'self'`).

---

## 6. ADR 200 ★ (hallazgo de esta fase): los assets de cliente son **módulos `.ts` que exportan su fuente como string** — forzado por el build

**Contexto — verificado, no supuesto.** `package.json:11`: `"build": "tsc -p tsconfig.json"`. `tsconfig.json:8-9`: `rootDir: "src"`, `outDir: "dist"`. **`tsc` emite únicamente lo que compila: un `src/adapters/web/chat-client.js` o un `.css` sueltos NUNCA llegarían a `dist/`.** Servirlos desde disco exigiría un paso de copia en el build — que el **ADR 191 pto 3 prohíbe con todas las letras** (*"Cero pasos nuevos de build"*). Leerlos desde `src/` en runtime es peor: en producción se corre `dist/`, y `src/` puede no existir.

**Decisión**:

1. **El JS de cliente vive en `src/adapters/web/chat-client.ts` como `export const CHAT_CLIENT_JS: string`** (template literal). El CSS, ídem, como `CHAT_CSS` en `chat-page.ts`. Se sirven desde memoria; **cero `fs` en el camino de request**, cero MIME guessing, cero riesgo de path traversal — las tres clases de bug que un servidor de estáticos casero suele traer.
2. **El test mecánico del ADR 192 pto 2 se vuelve un test de string puro** sobre `CHAT_CLIENT_JS`: sin `fs`, sin fixtures, sin depender del cwd. Identificadores prohibidos: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, **`new Function`** (agregado acá: es el `eval` que un grep ingenuo no ve) y `srcdoc`.
3. ★ **El cliente sólo toca el entorno por identificadores libres**: `document`, `fetch`, `setInterval`, `clearInterval`. **Nada de `window.X` ni `globalThis`.** No es estética: es lo que permite el test en negativo de XSS del ADR 192 pto 3 **sin instalar jsdom** (prohibido por ADR 191 pto 2, que incluye `devDependencies`). El test hace `new Function("document","fetch","setInterval","clearInterval", CHAT_CLIENT_JS)` contra un doble de DOM escrito a mano y verifica el árbol resultante.
4. **Consecuencia aceptada, dicha en voz alta**: dentro del template literal no hay resaltado de sintaxis, ni lint, ni typecheck del JS. Mitigaciones: el asset se mantiene chico (~170 líneas), es la **única** pieza del repo con esa propiedad, y el par de tests del pto 2-3 cubre justo lo que el compilador no puede ver. **Si el frontend crece más allá de un archivo, este ADR se reabre junto con el 191 pto 5** — comparten condición de disparo.
5. **Escapado**: la página es **100% estática, sin un solo valor dinámico concatenado**. Es la forma más fuerte de cumplir el ADR 20 pto 2: lo que no se concatena no puede escaparse mal. `escapeHtml` no participa porque no hay nada que escapar — y eso es un invariante testeable, no una casualidad.

---

## 7. ADR 201: contrato exacto de las rutas nuevas

**Decisión** — cuatro entradas nuevas en la cadena de `if` de `createRequestListener` (`server.ts:684-711`), en ese orden, antes del `404` final:

| Método | Ruta | Auth | Respuesta | Headers propios |
|---|---|---|---|---|
| `GET` | `/chat` | — | `200` `text/html; charset=utf-8` — la página | CSP, `nosniff`, + los cuatro de `respondHtml` |
| `GET` | `/chat/app.js` | — | `200` `application/javascript; charset=utf-8` — `CHAT_CLIENT_JS` | CSP, `nosniff`, `Cache-Control: no-store`, `X-Request-Id` |
| `GET` | `/chat/app.css` | — | `200` `text/css; charset=utf-8` — `CHAT_CSS` | ídem |
| `POST` | `/logout` | `Authorization: Bearer <token>` | `204` **siempre**, sin body | `Cache-Control: no-store`, `X-Request-Id` |

1. **`POST /operaciones` y `POST /login` no cambian**: ni una letra de su request, su response ni sus códigos. Es el *Out of Scope* más importante del change y es verificable por `git diff` sobre `handleLogin`/`handleOperaciones` — salvo **dos líneas aditivas** en `handleOperaciones`: resolver la ranura de conversación (simétrica a la de confirmación, `server.ts:641`) y el `logEvent` del pto 3 del ADR 197. **Cero efecto observable sobre el contrato.**
2. **Las tres rutas del chat son públicas** (sin sesión). No sirven ni un dato: HTML, JS y CSS estáticos, idénticos para todo el mundo. La autenticación la hace el contenido al llamar a `/login`. Exponer la página no expone nada.
3. **`/logout` en la raíz, no bajo `/chat/`.** Es la inversa de `/login`, no una función del chat: cualquier consumidor del token (incluido `curl`) la necesita. Mantiene la simetría `/login` ↔ `/logout` en la cadena de ruteo.
4. **`204 No Content` siempre**, con token válido, vencido, inexistente o ausente: indistinguibilidad, mismo criterio que `buscar` (`sesion-empleado-store.ts:13-16`) y que `token-confirmacion.ts`.
5. **`/logout` no lee el body** — no hace falta `leerCuerpoConTope`. **Detalle para `sdd-apply`**: hay que drenar el request igual (`req.resume()`) antes de responder, para no dejar el socket a medio consumir.
6. **CSRF**: `/logout` exige el token en el header `Authorization`, que un formulario cross-site no puede setear. No hace falta defensa adicional **mientras el token no viva en una cookie** — cuando eso cambie, se dispara el ADR 205 (RD-91).
7. **Método equivocado sobre ruta conocida ⇒ `404` vacío**, sin caso especial: es la regla que el archivo ya documenta (`server.ts:674-676`) y no se le hace una excepción al chat.

---

## 8. ADR 202: `SesionEmpleadoStore.eliminar` y el logout que **limpia las tres piezas de estado**

**Decisión**:

1. **Tercer método, aditivo**: `eliminar(token: string): void` en `SesionEmpleadoStore` (`sesion-empleado-store.ts:21-26`). `crear` y `buscar` no cambian de firma ni de comportamiento (ADR 195 pto 1). **Borra la entrada del `Map` esté vigente o vencida** — lo que además desagota, por el camino del logout, una parte de la fuga que R5 declara.
2. **El handler compone; ningún store llama a otro.** `handleLogout` recibe los tres stores por `WebServerDeps` (los tres ya están ahí salvo el de conversación, que se agrega) y hace, en este orden exacto:

   ```
   token = extraerBearerToken(req)            // ausente ⇒ 204 y listo
   sesion = sesionStore.buscar(token)         // ANTES de eliminar: hace falta el empleadoId
   if (sesion) confirmacionOperacionesStore.paraEmpleado(sesion.empleadoId).consumir()
   conversacionStore.eliminar(token)
   sesionStore.eliminar(token)
   → 204
   ```

   El orden no es casual: el `empleadoId` sólo se puede leer mientras la sesión existe, y `consumir()` ya existe en `ConfirmacionOperacionPort` (`operaciones-contract.ts:143`) — **no se inventa nada**, se compone lo que hay. Si la sesión ya venció, la ranura de confirmación no se limpia: limitación menor y declarada (la ranura es por empleado y se pisa sola en la próxima propuesta de cancelación).
3. **Esto es exactamente el ADR 195 pto 3** ("el logout limpia también el estado conversacional") con las tres piezas nombradas: sesión, conversación, confirmación pendiente.
4. **La evicción periódica de sesiones vencidas sigue fuera** (ADR 195 pto 4, R5).

---

## 9. ADR 203 (RD-95): **no** se serializa en el servidor — y por qué acá el cliente alcanza

**Contexto.** ADR 194 pto 2 deshabilita el envío mientras hay un turno en vuelo, y dice con razón que *"el cliente no es una garantía de seguridad"*. La pregunta de RD-95 es si hace falta serializar de verdad.

**Decisión: no, en este change.** Se analizó qué rompe exactamente un `POST /operaciones` concurrente del mismo empleado, bajo el mecanismo del ADR 196:

| Propiedad | ¿Se rompe con dos turnos concurrentes? |
|---|---|
| Invariante de confirmación | **No.** Los dos turnos tienen `casoId` distintos, y cada uno exige que el empleado haya mandado un mensaje. "Posterior y distinto" se sigue cumpliendo |
| Aislamiento entre empleados | **No.** Cada token tiene su entrada |
| Corrupción del puntero | **No.** Node es de un solo hilo; `registrarTurno` es una asignación. El puntero termina apuntando al último turno que cerró, que siempre es un `casoId` con fila `sesion_agente` |
| Linealidad de la memoria | **Sí.** El segundo turno arranca con el mismo `resume` que el primero y "no ve" lo que el primero dijo |

El daño acotado es **de experiencia, no de seguridad ni de integridad**. Serializar de verdad exigiría o una cola en el servidor (dos turnos encolados corriendo los dos contra el techo de 120 s) o un código de estado nuevo en `/operaciones` — **que es un cambio de contrato, *Out of Scope***. Se elige la limitación declarada.

**Instrucción para la spec**: el requirement se redacta sobre el cliente (*"mientras hay un turno en vuelo, el envío está deshabilitado"*) y la limitación del servidor se declara explícitamente, para que nadie lea el requirement como una garantía que no es.

---

## 10. ADR 204 (RD-97): tabla de errores — el cliente **nunca** muestra el texto del servidor

**Decisión** — mensajes literales del cliente, uno por código, sin leer `body.error`:

| Código | Qué muestra la UI | Qué NO hace |
|---|---|---|
| `400` | "El mensaje no pudo procesarse. Revisá el texto e intentá de nuevo." | No muestra el `motivo` del parser |
| `401` | "Tu sesión venció. Volvé a ingresar — tu mensaje quedó guardado." | No distingue vencida de inválida (el backend tampoco) |
| `502` | "El arnés no pudo completar la operación. Probá de nuevo en un momento." | No menciona modelo, SDK, base ni stage |
| `504` | ★ "La operación tardó demasiado y no se completó. **No sabemos si llegó a aplicarse** — verificá antes de reintentar." | **No afirma que falló ni que se aplicó** (ADR 194 pto 3) |
| otro / red caída / abort | "No hubo respuesta del servidor." | — |

1. **No se renderiza `body.error` en ningún camino.** Dos beneficios de una decisión: cero filtración de infraestructura (RD-97) y **una cadena menos de texto controlada por el servidor dentro del DOM** — aunque igual iría por `textContent`, la mejor defensa es que el dato no llegue.
2. **`401` conserva lo escrito** (ADR 194 pto 4): el texto vuelve al `<textarea>` y se muestra el login. **No se reenvía solo** tras volver a loguearse: autoenviar un mensaje viejo contra el camino del dinero, sin que el empleado lo vuelva a mirar, es un efecto lateral inaceptable. Reenvía él, con un click.
3. **Ningún mensaje de error incluye el token, el `casoId` ni el `conversacionId`.** El cliente tampoco escribe en `console` en ningún camino (ADR 193 pto 3).

---

## 11. Decisiones que se resuelven **como diferimiento, con forma escrita**

- **RD-91 — migración a cookie `HttpOnly`** (ADR 205, cuando se dispare). Forma exacta, para que el change futuro no arranque de cero: (1) `POST /login` **suma** `Set-Cookie: sesion=<token>; HttpOnly; Secure; SameSite=Strict; Path=/` **sin quitar** `token` del body — ventana de compatibilidad para los consumidores `curl` y para no romper el contrato de golpe; (2) `handleOperaciones` acepta la cookie **o** el header, con precedencia de la cookie; (3) con cookie hay que sumar defensa CSRF: chequeo de `Origin`/`Sec-Fetch-Site` en `/operaciones` y `/logout`, porque `SameSite=Strict` solo no alcanza para navegadores viejos; (4) el cliente deja de guardar el token y el ADR 193 se cierra; (5) recién ahí se puede quitar el token del body, en un tercer paso. **Disparo**: que el despliegue tenga TLS (sin `Secure` la cookie es peor que lo actual) **o** que el adaptador gane parseo de cookies por otra necesidad.
- **RD-92 — streaming incremental** (change propio). Qué habría que tocar, verificado: `invokeModel` ya itera los mensajes del SDK (`invoke-model.ts:454-473`) pero **acumula y devuelve al final**; haría falta (1) un callback de chunk en `InvokeModelResult`/`HandleTurnDeps`, (2) que `handleTurn` lo propague, (3) que `/operaciones` responda `text/event-stream` en vez de JSON — **eso es cambio de contrato, y arrastra a los cuatro turnos si se hace en `invokeModel`**. No es caro por la UI; es caro por el núcleo. Sigue diferido.
- **RD-94 — colisión ADR 174-187** (change de documentación propio). Recomendación de esta fase, para que el change futuro la evalúe: **no renumerar** (hay ADRs citados en doc-comments de código vivo: `consultas-negocio-tool.ts:5`, `build-on-comando-empleado.ts:378`, `ejecutar-operacion.ts:92,160,...`) sino **prefijar por change en las citas NUEVAS** (`ADR 180 (consultas-negocio-a2a-entrante)`) y agregar **una tabla de equivalencias en el arc42** que liste los tres usos de cada número colisionado. Renumerar rompería citas verificables; prefijar es aditivo.
- **RD-96 — rollback de esquema**: **se disuelve.** El ADR 196 no introduce migración, tabla, índice ni columna. El rollback de la memoria es borrar dos archivos y revertir un closure — la propuesta lo listaba como *"la única parte del change con rollback no trivial"* (Rollback Plan pto 3) **y con esta elección deja de serlo**. El checkpoint puede tachar ese punto.

---

## 12. Flujo de datos

```
navegador (pestaña)                      token: variable de módulo, nunca storage
  │  GET /chat  ──────────────────────►  chat-page.ts   (HTML estático + CSP)
  │  GET /chat/app.js ───────────────►   chat-client.ts (CHAT_CLIENT_JS)
  │  POST /login {empleadoId,password} ► handleLogin    → {token}         [SIN CAMBIO]
  │
  │  POST /operaciones  Bearer <token>  body {consulta} [CONTRATO SIN CAMBIO]
  ▼
server.ts · handleOperaciones
  ├─ token ─► sesionStore.buscar ──────────────► SesionEmpleado   (401 si no)
  ├─ token ─► conversacionStore.paraSesion ────► ConversacionEmpleadoPort   ← NUEVO
  └─ empleadoId ─► confirmacionStore.paraEmpleado ► ConfirmacionOperacionPort
  ▼
build-on-operaciones-empleado.ts   (input: consulta, sesion, confirmacion, conversacion)
  ├─ casoId_N = newId()                      ★ SIEMPRE NUEVO — invariante intacto
  ├─ createCaso(casoId_N)
  └─ memoriaConversacional = decorador sobre MemoryPort        ← NUEVO (4 líneas)
     ▼
   handleTurn(casoId_N, prompt, { memory: memoriaConversacional, ... })   [CORE SIN CAMBIO]
     ├─ assembleContext(mem, casoId_N, agentId)
     │     getCasoById(casoId_N)                                  sin redirigir
     │     getLatestSesionAgente(ultimoCasoId ?? casoId_N, agent)  ★ REDIRIGIDO
     ├─ invokeModel  →  options.resume = sdkSessionId del mensaje N-1
     └─ closeTurn    →  createSesionAgente({ casoId: casoId_N, sdkSessionId_N })
     ▼
   conversacion.registrarTurno(casoId_N)      ← SÓLO si handleTurn resolvió
     ▼
   200 {casoId, respuesta}  ──► cliente: nodo nuevo con textContent (NUNCA innerHTML)
```

---

## 13. Contratos de interfaz

```ts
// src/core/conversacion/conversacion-contract.ts — SIN IMPORTS
// Molde exacto de ConfirmacionOperacionPort (operaciones-contract.ts:134): puerto
// del dominio en el núcleo, implementación de proceso en el adaptador.
export interface ConversacionEmpleadoPort {
  /** `casoId` del último turno CERRADO CON ÉXITO de esta conversación, o `undefined` en el primero. */
  casoAnterior(): string | undefined;
  /** Registra `casoId` como último turno cerrado. SÓLO se llama tras `handleTurn` resuelto. */
  registrarTurno(casoId: string): void;
  /** Id de correlación para logs y evidencia. NUNCA es el token de sesión. */
  conversacionId(): string;
}
```

```ts
// src/adapters/web/conversacion-empleado-store.ts
export interface ConversacionEmpleadoStore {
  /** Ranura propia del token — molde de `paraEmpleado` (confirmacion-operaciones-store.ts:56). */
  paraSesion(token: string): ConversacionEmpleadoPort;
  /** Idempotente: existente, vencida o inexistente dan el mismo resultado. */
  eliminar(token: string): void;
}
export function crearConversacionEmpleadoStore(deps?: {
  readonly now?: () => string;      // default: () => new Date().toISOString()
  readonly newId?: () => string;    // default: randomUUID
}): ConversacionEmpleadoStore;
```

```ts
// src/adapters/web/sesion-empleado-store.ts — ADITIVO (ADR 195 pto 1)
export interface SesionEmpleadoStore {
  crear(sesion: SesionEmpleado): string;              // SIN CAMBIO
  buscar(token: string): SesionEmpleado | undefined;  // SIN CAMBIO
  /** Borra la entrada exista, esté vigente o esté vencida. Idempotente. */
  eliminar(token: string): void;                      // NUEVO
}
```

```ts
// src/build-on-operaciones-empleado.ts — el input de la función DEVUELTA gana un campo
(input: {
  readonly consulta: string;
  readonly sesion: SesionEmpleado;
  readonly confirmacion: ConfirmacionOperacionPort;
  readonly conversacion: ConversacionEmpleadoPort;   // NUEVO (ADR 167 §6 pto 2)
}) => Promise<OperacionesEmpleadoResult>             // {casoId, respuesta} SIN CAMBIO
```

```ts
// src/adapters/web/config.ts — constantes nuevas
export const RUTA_CHAT = "/chat";
export const RUTA_CHAT_SCRIPT = "/chat/app.js";
export const RUTA_CHAT_ESTILOS = "/chat/app.css";
export const RUTA_LOGOUT = "/logout";
export const CSP_CHAT = "default-src 'none'; script-src 'self'; ...";  // §5, literal
export const CONVERSACION_INACTIVIDAD_MS = 30 * 60_000;
export const CONVERSACION_MAX_TURNOS = 40;
```

```ts
// src/adapters/web/chat-page.ts   — funciones puras, cero valores dinámicos
export function renderChatHtml(): string;   // <script src="/chat/app.js" defer>, <link rel=stylesheet>
export const CHAT_CSS: string;              // white-space: pre-wrap (saltos de línea, ADR 192 alt. 1)

// src/adapters/web/chat-client.ts
export const CHAT_CLIENT_JS: string;        // identificadores libres: document, fetch, setInterval, clearInterval
```

---

## 14. Archivos — con estimación de líneas para `sdd-tasks`

| Archivo | Acción | Prod | Test | Qué |
|---|---|---|---|---|
| `src/core/conversacion/conversacion-contract.ts` | New | ~35 | ~15 | Puerto + doc. Test de "sin imports" (molde `sesion.ts`) |
| `src/adapters/web/conversacion-empleado-store.ts` | New | ~70 | ~120 | `Map` por token, rotación perezosa, `eliminar` |
| `src/build-on-operaciones-empleado.ts` | Modified | ~25 | ~130 | Campo `conversacion` + decorador + `registrarTurno` tras éxito |
| `src/adapters/web/sesion-empleado-store.ts` | Modified | ~8 | ~30 | `eliminar` |
| `src/adapters/web/server.ts` | Modified | ~70 | ~150 | 4 rutas, `handleLogout`, `respondHtmlChat`, `respondAsset`, ranura de conversación en `handleOperaciones` |
| `src/adapters/web/config.ts` | Modified | ~20 | ~10 | Rutas, CSP, techos de conversación |
| `src/adapters/web/chat-page.ts` | New | ~90 | ~40 | HTML estático + CSS |
| `src/adapters/web/chat-client.ts` | New | ~170 | ~180 | Cliente vanilla + test mecánico + XSS en negativo con DOM doble |
| `src/main.ts` | Modified | ~10 | — | `crearConversacionEmpleadoStore()` y cableado |
| `docs/ARC42_...md`, `README.md`, `docs/progreso/v3.9-.../` | Modified/New | ~120 | — | Concepto de cierre + enmienda "conversación = N casos" + evidencia |
| **`src/core/turn-selector/*`, `confirmacion-operaciones-store.ts`, `core/auth/sesion.ts`, las 6 funciones de negocio, la tool `operaciones`, `package.json`, rama `/soporte`** | **Sin cambio** | **0** | — | ★ **Si aparecen en el diff, el alcance se filtró** |

**Total estimado**: ~500 prod + ~675 test + ~120 docs ≈ **1.300 líneas**. Muy por encima del presupuesto de 400 por PR (R9).

**Corte sugerido en PRs encadenados** — el orden respeta la pieza 1 del *Approach* (memoria antes que UI); `sdd-tasks` hace el corte fino:

| # | Slice | ~Líneas | Verificación autónoma |
|---|---|---|---|
| 1 | Puerto + store de conversación + decorador + tests de memoria, aislamiento y **autoconfirmación imposible** | ~400 | `npm test`; memoria demostrable por `curl` (el chat todavía no existe) |
| 2 | `eliminar` + `POST /logout` + tests | ~270 | Token viejo da `401`; logout idempotente |
| 3 | Rutas del chat + página + CSS + CSP + tests de headers | ~380 | `GET /chat` sirve y la CSP no rompe nada (sin JS todavía) |
| 4 | Cliente vanilla + cuatro estados + tabla de errores + test mecánico + XSS en negativo | ~350 | Chat usable de punta a punta |
| 5 | arc42 + README + evidencia manual con capturas | ~150 | Success Criteria firmados |

---

## 15. Testing (TDD estricto — `AGENTS.md`: test primero en toda tarea con lógica)

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Unit | `conversacion-empleado-store`: primer acceso ⇒ `casoAnterior()` `undefined`; tras `registrarTurno(A)` ⇒ `A`; rotación por inactividad; rotación por techo; `eliminar` idempotente; **dos tokens ⇒ dos cadenas que nunca se cruzan** | `now`/`newId` inyectados, sin reloj real |
| Unit | Contrato de conversación sin imports | Molde del test de fuente de `sesion.ts` |
| Integración | `build-on-operaciones-empleado`: turno 1 sin `resume`; **turno 2 con `options.resume` = `sdkSessionId` del turno 1**; turno fallido **no** avanza el puntero; dos conversaciones concurrentes no se mezclan | SQLite en memoria + `queryFn` fake que captura `Options.resume` (el molde ya existe en el repo) |
| Integración ★ | **Autoconfirmación imposible con memoria activa**: dos invocaciones de `cancelar_solicitud_interna` en el MISMO mensaje no se autoconfirman; la del mensaje siguiente sí | Extiende el molde de `ejecutar-operacion.test.ts`. **Obligatorio (ADR 189 pto 4)** |
| Unit mecánico ★ | `CHAT_CLIENT_JS` no contiene `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `srcdoc` | Aserción sobre el string exportado. Sin `fs` |
| Unit negativo ★ | XSS: respuesta con `<script>`, `<img onerror=...>` y comillas ⇒ el árbol gana **un nodo de texto**, cero elementos; el texto se ve literal | `new Function(...)` + doble de DOM a mano. **Sin jsdom** (ADR 191 pto 2) |
| Unit | `renderChatHtml()` no tiene `<script>` inline ni `<style>` inline ni atributos `style=`; referencia los dos assets | Aserción de string |
| Integración (adaptador) | `GET /chat`/`app.js`/`app.css`: status, `Content-Type`, CSP literal, `nosniff`. `POST /logout`: `204` con token válido, vencido, inexistente y ausente; tras logout, `/operaciones` da `401`; método equivocado ⇒ `404` | Dobles planos de `server.test.ts`, ya existentes |
| Manual E2E | Memoria multi-turno con referencia deíctica; intento de XSS; los cuatro códigos de error; `401` que no pierde lo escrito; token ausente de storage/URL/DOM | `docs/progreso/v3.9-chat-web-empleado/`, molde `verificacion-manual-tarea-15.md`, **con capturas de la interfaz, no de `curl`** |

---

## 16. Migración y rollback

**Sin migración.** No hay tabla, columna, índice ni backfill (ADR 196; RD-96 se disuelve).

Rollback por capas, de más barato a más caro: quitar el cableado de `main.ts` y el campo `conversacion` ⇒ el chat vuelve a ser amnésico pero funcional; borrar `chat-page.ts`/`chat-client.ts` y las tres rutas ⇒ el adaptador vuelve a su comportamiento exacto de hoy; quitar `eliminar` ⇒ `crear`/`buscar` intactos. **Las tres reversiones son independientes entre sí**, y ninguna toca datos de negocio.

---

## 17. Riesgos nuevos que el diseño descubrió (no anticipados por la propuesta)

| # | Riesgo | Prob. | Tratamiento |
|---|---|---|---|
| **R11** ★ | **`options.resume` a una sesión del SDK que el SDK ya no tiene** (poda de su store en disco, cambio de `cwd`): todos los mensajes siguientes de esa conversación fallan con `502`, sin recuperación automática | Media | ADR 196 pto 9: **prohibido el reintento automático sin `resume`** — la falla puede ser posterior a una operación de negocio ya ejecutada, y reintentar la duplicaría. Salida: logout + login (conversación nueva). **Requiere copy explícito en la UI para el `502` y una línea en la doc del hito** |
| **R12** ★ | **El build (`tsc` solo) no copia assets**: un `.js`/`.css` suelto nunca llega a `dist/` y el chat funcionaría en `npm run dev` (tsx, lee `src/`) y fallaría en producción | **Alta si se ignora** | ADR 200: assets como `string` exportado de un `.ts`. **Es un bug de despliegue que no aparece en ningún test de unidad** — hay que verificarlo corriendo desde `dist/` en la evidencia manual |
| **R13** | **`casos` y `sesiones_agente` crecen una fila por mensaje**, y el chat multiplica el volumen de mensajes frente a `curl` | Media | Preexistente, se ensancha. Filas chicas, sin limpieza hoy. **Se declara, no se resuelve acá** (change propio, junto con la evicción de R5) |
| **R14** | **La rotación de conversación (ADR 197) es silenciosa para el empleado**: el arnés "olvida" sin cartel en el momento exacto | Baja | Aviso estático en la UI; `conversacionId` en el log para diagnosticar. Anunciarla en la respuesta exigiría cambiar el contrato de `/operaciones` |
| **R15** | **El JS de cliente dentro de un template literal no tiene lint, typecheck ni resaltado** | Media | ADR 200 pto 4: un solo archivo, acotado, con dos tests que cubren justo lo que el compilador no ve. Condición de reapertura compartida con el ADR 191 pto 5 |

---

## 18. Open Questions para el checkpoint

- [ ] **La enmienda al arc42**: hasta hoy "conversación" y "caso" eran sinónimos; este diseño las separa **sólo para el turno de empleado por HTTP** (`/soporte`, la TUI y el A2A siguen con un caso por turno). ¿Se escribe como Concepto nuevo o como enmienda al Escenario de calidad 2? Afecta redacción, no diseño.
- [ ] **`POST /logout` en la raíz** (§7 pto 3) frente a `/chat/logout`. El diseño elige la raíz por simetría con `/login`; es la única decisión de este documento que es de gusto más que de consecuencia.
- [ ] **R11**: ¿alcanza con "logout + login" como única salida ante una sesión de SDK perdida, o el hito quiere un botón explícito de "empezar conversación nueva"? Si lo quiere, es una ruta más (~60 líneas) y entra como slice 2.5.
- [ ] **Confirmado por el diseño**: RD-96 se disuelve y el punto 3 del *Rollback Plan* de la propuesta (*"la única parte del change con rollback no trivial"*) **ya no aplica**. El checkpoint puede darlo por cerrado.
