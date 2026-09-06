> **Nota de proceso (hook de graphify)**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Grep`/`Glob`/`Write`/`Edit`), igual que `sdd-explore`, `sdd-propose` y las tres revisiones de la propuesta, así que no se pudo invocar el binario. Se compensó con lectura directa y **verificada** de: `AGENTS.md`, `openspec/config.yaml`, `openspec/changes/tui-canal-empleado/proposal.md` (completo, 620 líneas), `openspec/changes/hito-1.3-ventas-comisiones/design.md` (§1-§3.4, molde de formato), `src/core/ventas/ventas-contract.ts`, `ventas-config.ts`, `procesar-devolucion.ts`, `reporte.ts:130-199`, `src/core/logging/turn-logger.ts:163-218`, `src/adapters/tui/tui-port.ts`, `src/adapters/webhooks/signature.ts`, `src/adapters/memory/migrations/index.ts` y `0004_vendedores_ventas_comisiones.ts`, `src/adapters/memory/repository.ts` (índice completo de exports + `:60-109`, `:604-763`, `:960-1189`), `src/build-on-venta.ts:1-137`, `src/build-on-soporte.ts`, `src/main.ts:96-200` y `:200-386`, `src/reporte-mensual.ts`, `package.json`. Toda afirmación sobre código existente está citada contra esos archivos. **Dos hallazgos de esa lectura corrigen la propuesta** y están declarados en §11: `createVentaStore` ya está exportado (`build-on-venta.ts:137`) y **ese archivo sí se modifica**, y `getVentaById` ya existe en `repository.ts:835` (no se usa ni se expone en este change). Se recomienda correr `graphify update .` una vez persistido este archivo.

# Diseño técnico: Canal TUI para empleados — soporte, devolución y cierre de R3 (v1.4.0)

**Entra con**: [`proposal.md`](proposal.md) **revisión 3, aprobada por el checkpoint humano** (incluye la resolución de R14 — se acepta el eco de la contraseña — y de R9 — un solo change `v1.4.0`, sin partir) · [`exploration.md`](exploration.md) · [arc42](../../../docs/ARC42_Harness_Empresarial.md) (Interfase I1, Caja Blanca bloque 3, Escenario de calidad 4) · [`AGENTS.md`](../../../AGENTS.md) · [`openspec/config.yaml`](../../config.yaml) (`strict_tdd: true`).

**Alcance de este documento**: el *cómo* implementable — firmas literales, SQL completo, secuencias paso a paso, fronteras, logging, plan de testing y orden de implementación. **No** re-decide arquitectura: los ADR 21-33 de la propuesta son **dados**, se referencian y no se repiten. **No** es la lista de tareas (eso es `tasks.md`) ni el contrato de requisitos (eso es `specs/`, que **todavía no existe** — verificado: `openspec/changes/tui-canal-empleado/` contiene solo `exploration.md` y `proposal.md`; este diseño corre en paralelo con `sdd-spec`).

**Numeración de ADR**: arc42 fijó 1-2, Hito 2 fijó 3/3.1/4, Hito 3 fijó 5-10, la propuesta de Hito 4 fijó 7-11 en su secuencia y su diseño fijó 12-20. La propuesta de este change fijó **21-33**. Este documento arranca en **ADR 34**.

---

## 1. Resumen de la arquitectura elegida

Un envoltorio en el composition root, dos carpetas nuevas de núcleo (`src/core/commands/`, `src/core/auth/`), un adaptador nuevo de una sola responsabilidad (`src/adapters/crypto/`), dos tablas aditivas y un entrypoint CLI. **Cero cambios de tipos en I1.**

```
                       composition root (src/main.ts)
                                     │
   ┌───────────────┬─────────────────┼──────────────────┬────────────────┐
   │               │                 │                  │                │
buildOnSubmit  buildOnActivity   buildOnVenta      buildOnSoporte    openDatabase
(Hito 1,       (Hito 3,          (Hito 4,          (Hito 4,          (0005 + 0006
 intacto)       intacto)          + 5 closures)     COMPARTIDO)       nuevas)
   │               │                 │              │        │            │
   │               ▼                 └──────┬───────┘        │            ▼
   │        startWebhookServer              ▼                │      VentaStorePort
   │                                  startWebServer         │   CredencialesEmpleadoPort
   │                                (adapters/web, INTACTO)  │   RegistroAccionesEmpleadoPort
   │                                                         │   (closures s/ repository.ts)
   └──────────────► buildOnComandoEmpleado ◄─────────────────┘
                    (src/build-on-comando-empleado.ts — NUEVO)
                     · ranura `sesion`
                     · ranura `confirmacionPendiente`
                             │
                             ▼
                      startTui(onComando)          ← única línea que cambia en el mount
                     (I1 SIN cambios de tipos)

        src/core/commands/          src/core/auth/           src/core/ventas/
        parsearComando (PURA)       resolverLogin (PURA)     resolverEscalacionReembolso
        COMANDOS / formatearAyuda   sesionVigente (PURA)     (PURA)
        RegistroAccionesEmpleadoPort resolveAuthConfig (PURA) procesarDevolucion (retorno +2)
                                    CredencialesEmpleadoPort ventas-contract (+2 estados, +5 métodos)
                                              ▲
                                              │ verificarPassword INYECTADO
                                              │
                                    src/adapters/crypto/password.ts
                                    (scryptSync + randomBytes + timingSafeEqual)

        entrypoint aparte:  npm run empleados:crear -- <id> [--rotar]  →  src/empleados.ts
                            parseArgsEmpleado (PURA) → stdin → hashPassword
                            → openDatabase → insert|update → db.close() en finally
```

Ninguna flecha va de `src/core/` a `src/adapters/*`. El único cruce de frontera nace en el composition root (`main.ts`, `build-on-comando-empleado.ts`, `empleados.ts`), que es la excepción documentada de `AGENTS.md`.

**Lo que NO cambia** (garantía de no-regresión, verificada archivo por archivo): `src/adapters/tui/tui-port.ts` (**solo un comentario**, cero tipos), `App.tsx`, `start-tui.tsx`, `build-on-submit.ts`, `handle-turn.ts`, `build-on-soporte.ts`, `build-on-activity.ts`, todo `src/adapters/web/*`, `src/adapters/webhooks/*`, `src/adapters/knowledge/*`, `src/adapters/notificaciones/*`, `db.ts`, `migrations/0001`-`0004`, `ventas`/`casos`/`comisiones` (**cero cambios de esquema**), `aprobarReembolso`, `escalarReembolso`, `rechazarVenta`, `confirmarVentaConComision`, `listVentasEnReembolsoPendiente`, `listComisionesPorPeriodo` y `agruparReporteMensual`.

**La asimetría es el punto** (ADR 21 + 30 de la propuesta, materializados acá): de los ocho comandos, **uno solo toca el SDK** (`/soporte`, que reusa el `buildOnSoporte` ya construido). Los otros siete son deterministas y síncronos hasta el borde de la promesa. Y de los ocho, **uno solo mueve dinero por dos pasos** (los tres de resolución), con la sesión re-verificada en el segundo.

---

## 2. Decisiones de diseño (ADR 34-41)

Mismo formato que Hitos 2, 3 y 4: **Contexto / Decisión / Alternativas consideradas / Consecuencias**. Al cerrar el change se copian al arc42 junto con los ADR 21-33.

### ADR 34: `parsearComando` es un parser de **tres formas fijas** y `/ayuda` es el sumidero de todo lo malformado — el parser nunca devuelve un error

**Contexto**. La propuesta fija que `parsearComando` es puro y devuelve una unión discriminada o `undefined`, y que un comando mal escrito "cae en `/ayuda`, nunca en un camino destructivo" (ADR 21). No fija **cómo** se parsean los argumentos, ni qué forma tiene el caso "reconocí el comando pero le faltan argumentos", ni cómo se cumple la regla del argumento secreto (ADR 21, enmienda rev. 3).

**Decisión**. Tres formas de argumento y una sola salida de error:

| Forma | Comandos | Regla de parseo |
|---|---|---|
| **Sin argumentos** | `/logout`, `/ayuda` | Todo lo que venga después se ignora |
| **Un identificador opaco opcional** | `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` | Primer token no vacío o `undefined` |
| **Identificador + resto de línea** | `/login` (id + password), `/devolucion` (token + motivo opcional), `/soporte` (todo el resto es la consulta) | `split` en el **primer** espacio; el resto va entero, con `trim` de bordes |

**El parser no tiene una rama de error**: cualquier texto que empiece con `/` y no matchee un comando conocido, o que matchee uno pero sin sus argumentos obligatorios, devuelve `{ tipo: "ayuda", motivo }`. `motivo` distingue `"solicitada"` (el usuario escribió `/ayuda`), `"desconocido"` y `"argumentos"`, y el campo `comando` **lleva solo el primer token** (`"/logni"`), **nunca el resto de la línea**. Eso es lo que hace estructuralmente imposible que un `/logni ana secreto` deje la contraseña en el evento `comando-desconocido`: **el dato no existe después del parser**.

**Alternativas consideradas**:

- *Un tipo `{ tipo: "error", mensaje }` separado de `ayuda`*: rechazada. Duplica el camino de salida (dos ramas del dispatcher que producen el mismo `TuiTurnResult` con `agentLabel: "sistema"`) y crea la tentación de meter el texto original en `mensaje` — que es exactamente lo que la enmienda del ADR 21 prohíbe.
- *Parseo con comillas (`/login ana "mi pass"`)*: rechazada. Agrega un mini-lexer (escapes, comillas sin cerrar) al único módulo del change que tiene que ser trivialmente auditable, para resolver un caso que la forma "resto de línea" ya cubre.
- *Rechazar contraseñas con espacios*: rechazada, y acá se **resuelve la ambigüedad de R4**, que dice a la vez "una contraseña con espacios no se puede tipear" y "el parser toma el resto de línea como contraseña". Con "resto de línea + `trim` de bordes", la lectura correcta es: **una contraseña con espacios internos SÍ se puede tipear; una que empiece o termine con espacio NO**. Se documenta así y se testea así, en vez de dejar dos frases que se contradicen.

**Consecuencias**. `parsearComando` es una función de `string` a unión, sin dependencias, sin reloj y sin I/O: el archivo más barato de testear del change y el primero que se escribe. El `trim` de bordes de la contraseña es un límite real y queda escrito en el descriptor de `/login`.

### ADR 35: parámetros de scrypt **concretos** (N=16384, r=8, p=1, clave 32 B, salt 16 B), y `verificarPassword` **valida los parámetros embebidos antes de derivar**

**Contexto**. El ADR 30 fija el formato `scrypt$<N>$<r>$<p>$<salt>$<clave>` y dice "parámetros serios", sin números. Un formato que **lee sus parámetros del propio hash** tiene una consecuencia que el ADR 30 no nombra: el atacante que puede escribir `credenciales_empleado` (R16) puede escribir un hash con `N = 2^30`, y `scryptSync` intentaría reservar cientos de GB o lanzar — un DoS de un solo `UPDATE`.

**Decisión**:

1. **Parámetros de escritura**: `N = 16384` (2¹⁴), `r = 8`, `p = 1`, `keylen = 32`, `salt = randomBytes(16)`. Costo de memoria `128 × N × r = 16 MiB`, **por debajo del `maxmem` default de Node (32 MiB)**, así que no hace falta pasar `maxmem` en el camino feliz. Costo de tiempo del orden de decenas de ms en hardware de laptop — el "~100 ms por intento" que R13 usa como freno.
2. **Formato exacto**: `scrypt$16384$8$1$<salt en base64>$<clave en base64>`. Seis campos separados por `$`, algoritmo primero. `base64` (no `hex`) por tamaño; el separador `$` no aparece en el alfabeto base64 estándar, así que el `split("$")` es inequívoco.
3. **`verificarPassword` nunca lanza** — mismo contrato que `verifySignature` (`signature.ts:18-31`). Devuelve `false` ante: hash vacío, cantidad de campos ≠ 6, algoritmo ≠ `"scrypt"`, `N`/`r`/`p` no enteros positivos, **`128 × N × r > 64 MiB`** (la guarda del párrafo de contexto), base64 inválido, longitud de clave 0, y cualquier excepción de `scryptSync` (envuelta en `try/catch`).
4. **Chequeo de longitud antes de `timingSafeEqual`**, obligatorio y por el motivo que `signature.ts:22-26` ya documenta: esa función **lanza `RangeError`** con buffers de distinto largo. La longitud de la clave derivada se toma de la clave almacenada, así que un hash truncado da longitudes iguales y falla en la comparación, no en el `RangeError`.
5. **`hashPassword` acepta el salt por parámetro con default `randomBytes(16)`** — mismo criterio que `newToken`/`newId` inyectados en `build-on-venta.ts:73-75`: el test de "dos hashes de la misma contraseña son distintos" usa el default real, y el test de formato usa un salt fijo.

**Alternativas consideradas**:

- *Parámetros fijos en constantes, no embebidos en el hash*: rechazada — es lo que el ADR 30 ya rechazó (obligaría a migrar el esquema para cambiar un parámetro). La guarda del punto 3 es el precio de esa flexibilidad, y cuesta un `if`.
- *`scrypt` asíncrono (callback/`promisify`)*: rechazada. `verificarPassword` se inyecta en un caso de uso **síncrono y puro** (ADR 30); volverlo `Promise<boolean>` haría `resolverLogin` asíncrono y con él todo el camino de `/login`, para ganar nada: el proceso de la TUI atiende a **una** persona y no tiene otro trabajo mientras espera.
- *`N = 2^17` (~1 s por intento)*: rechazada. Supera el `maxmem` default (128 MB) y obligaría a pasar `maxmem` explícito, y un segundo de bloqueo del hilo que sostiene Ink es una TUI que parece colgada. `2^14` es el punto donde el KDF ya domina el costo del ataque offline sin degradar la interacción.

**Consecuencias**. Los parámetros quedan congelados por fila (consecuencia ya declarada por el ADR 30); subirlos más adelante es cambiar dos constantes y rotar. La guarda de `maxmem` convierte un vector de DoS en un `false`, que es indistinguible de una contraseña incorrecta — exactamente lo que se quiere.

### ADR 36: dos ranuras, **un orden de verificación fijo**, y un TTL propio para la confirmación pendiente

**Contexto**. El ADR 31 punto 5 exige que el segundo paso re-verifique sesión vigente **y** mismo `empleadoId`. No fija el **orden** de los chequeos ni cuánto dura la confirmación pendiente ("una ventana corta").

**Decisión**. El dispatcher evalúa, para **todo** comando, en este orden exacto y sin excepciones:

```
1. purgarSesionSiVencio(ahora)        → si venció: sesion = undefined,
                                         confirmacionPendiente = undefined,
                                         evento `sesion-expirada`
2. parsearComando(texto)              → undefined ⇒ return onSubmit(texto, onAgentResolved)
3. si el comando es PRIVILEGIADO y no hay sesión vigente
                                      → responde "hace falta /login", evento
                                        `comando-privilegiado-sin-sesion`,
                                        CERO escrituras
4. ruteo del comando
```

El paso 1 corre **antes** del parseo, a propósito: la expiración es un hecho del reloj, no del comando, y una sesión vencida no puede sobrevivir a un `/ayuda`. El paso 3 corre **antes** de mirar la confirmación pendiente: una confirmación no es una autorización almacenada (ADR 31 punto 5).

La confirmación pendiente tiene **su propio TTL**, `CONFIRMACION_TTL_MINUTOS = 2`, **constante de módulo, no variable de entorno** — mismo criterio con el que `SOPORTE_TIMEOUT_MS` y `SERVER_CLOSE_TIMEOUT_MS` no son configurables (ADR 14 de Hito 4): es un presupuesto de UX, nadie lo va a tunear, y agregarlo a `resolveAuthConfig` sería una variable más que validar para cero lectores. Es **independiente** del TTL de sesión y siempre mucho menor: la sesión dura una jornada de trabajo, la confirmación dura lo que tarda alguien en leer un monto.

La ranura se limpia en **cinco** puntos, y los cinco tienen test: `/logout`, cualquier `/login` (exitoso o no — un intento de login es un cambio de contexto), expiración de la sesión, expiración propia, y **ejecución** (la confirmación se consume, no se reusa).

**Alternativas consideradas**:

- *Verificar la confirmación pendiente antes de la sesión*: rechazada — es literalmente el bypass que el ADR 31 punto 5 describe.
- *Un TTL de confirmación configurable*: rechazada por el argumento de arriba.
- *N ranuras de confirmación (un mapa por `ventaId`)*: rechazada. Con una sola ranura, preparar una segunda confirmación **descarta** la primera, y eso es una propiedad de seguridad barata: no puede haber dos aprobaciones armadas al mismo tiempo esperando un Enter distraído.

**Consecuencias**. El dispatcher tiene exactamente **dos** variables mutables en su closure y **un** orden de evaluación, ambos verificables con dobles. Prepararle una confirmación a la venta A y después a la B, y confirmar la A, devuelve el eco de la A otra vez (no ejecuta), porque la ranura ya es de la B.

### ADR 37: los casos de uso privilegiados reciben **`SesionEmpleado`**, no `empleadoId: string`

**Contexto**. La enmienda rev. 3 del ADR 27 pide fijar como **invariante estructural** que "no hay ninguna función que acepte un `empleadoId` provisto por el usuario". Una firma `resolverEscalacionReembolso({ ventaId, empleadoId: string, ... })` no expresa ese invariante: acepta cualquier string, incluido el que venga tipeado.

**Decisión**. `resolverEscalacionReembolso` y el registro de las acciones públicas reciben **`sesion: SesionEmpleado`**, el tipo que **solo `resolverLogin` construye**. Recién adentro de esas funciones se extrae `sesion.empleadoId` para pasarlo al puerto. El puerto (`insertAccionEmpleado`, los tres métodos CAS) sigue recibiendo `empleadoId: string` — un adaptador no debe conocer el tipo de sesión del núcleo.

**Alternativas consideradas**:

- *`empleadoId: string` con un comentario que diga "de la sesión"*: rechazada. Un comentario no es un invariante; el compilador no lo lee y un `sdd-apply` apurado tampoco.
- *Un tipo nominal/branded (`EmpleadoIdAutenticado = string & { __brand }`)*: rechazada por ergonomía. Obligaría a un cast en el único constructor y a nada más; `SesionEmpleado` ya es un tipo propio, ya tiene un solo productor real y además arrastra `expiraEn`, que el llamador necesita igual.

**Consecuencias**. `SesionEmpleado` sigue siendo una interfaz plana, así que un test puede fabricar una a mano — y eso está bien, es un test. En producción, el **único** camino que produce una es `resolverLogin`, y el dispatcher es el único que la guarda. El invariante queda verificable leyendo tres firmas, no auditando call sites.

### ADR 38: **un solo lector** `listEscalacionesReembolso(db, { estado, ventaId?, limite? })`, con filtro opcional por id — y por qué eso **no** es un `buscarVentaPorId`

**Contexto**. La propuesta dice: "se busca la venta en ese mismo listado (sin método nuevo de lectura por id)". Eso tiene un bug latente: el listado de rechazados está **acotado a 20** (ADR 29 punto 1), así que la venta número 21 sería inencontrable por `/reabrir-reembolso <ventaId>` — el comando respondería "no aplicable" sobre una venta perfectamente reabrible.

**Decisión**. Una sola función de lectura, parametrizada, que sirve los cuatro usos (listar pendientes, listar rechazados, resolver un id pendiente, resolver un id rechazado):

```ts
listEscalacionesReembolso(db, { estado, ventaId?, limite? })
```

Con `ventaId` presente, el `LIMIT` es irrelevante y el resultado es 0 o 1 fila. **No es un `buscarVentaPorId`** y la diferencia no es cosmética: `estado` es un parámetro **obligatorio** y solo acepta `reembolso_pendiente` o `reembolso_rechazado`, así que esta función **no puede devolver jamás una venta `confirmada`** — que es exactamente la clase de venta que el ADR 22 protege. El camino de devolución sigue teniendo el token como única credencial, sin una sola línea nueva.

**Alternativas consideradas**:

- *Paginar el listado y aceptar el bug*: rechazada. Un comando que responde "no aplicable" sobre una venta que sí aplica es peor que no tener el comando: enseña a desconfiar del producto y empuja al `UPDATE` manual, que es lo que este change existe para eliminar.
- *Subir el límite a 1000 y llamarlo resuelto*: rechazada. Es el mismo bug con un número más grande y una lectura más cara.
- *Dos funciones (`listar...` y `buscarEscalacionPorId`)*: rechazada. Mismo SQL, mismo mapeo, mismas subconsultas; dos funciones que solo difieren en un `WHERE` son dos lugares donde arreglar el próximo bug del `JOIN`.

**Consecuencias**. `listVentasEnReembolsoPendiente` (`repository.ts:1169`) **no se toca**: el reporte mensual sigue compilando y testeando byte por byte igual. Hay dos lectores de `ventas` en `reembolso_pendiente` con SQL parecido y distinta forma de salida, y se declara: el del reporte no necesita las subconsultas al registro y no debe pagarlas.

### ADR 39: el `id` de la fila de registro lo genera el **núcleo** (`newId` inyectado) y viaja al puerto

**Contexto**. `registro_acciones_empleado.id` es `TEXT PRIMARY KEY`. Alguien tiene que generarlo, y las dos rutas de escritura (dentro de la transacción del CAS, y fuera vía `registrarAccion`) terminan en la misma función del adaptador.

**Decisión**. Lo genera el núcleo con el `newId: () => string` inyectado en las `deps`, y viaja como `accionId` en el input de los tres métodos CAS y en el input de `registrarAccion`. **El adaptador sigue sin ninguna fuente de aleatoriedad**, exactamente como `ConfirmarVentaConComisionInput.comisionId` ya hace hoy (`ventas-contract.ts:157-164`).

**Alternativas consideradas**:

- *`randomUUID()` adentro de `repository.ts`*: rechazada. Rompe el determinismo del test de atomicidad (no se puede afirmar sobre el id de la fila escrita) y mete una decisión del núcleo en el adaptador, contra el precedente ya establecido por `comisionId`.
- *`id INTEGER PRIMARY KEY AUTOINCREMENT`*: rechazada. Todas las PK del proyecto son `TEXT` (0001-0004, verificado); una tabla con otra convención es una excepción que después hay que explicar en cada `JOIN`.

**Consecuencias**. El test de "el ciclo completo deja cuatro filas legibles en orden" puede fijar los cuatro ids y afirmar sobre ellos.

### ADR 40: la fila **no transaccional** no puede tumbar el comando; la **transaccional** sí propaga

**Contexto**. El ADR 27 declara la asimetría de atomicidad pero no dice qué pasa si la escritura **no transaccional** falla (disco lleno, base bloqueada). El efecto ya ocurrió: el reembolso se procesó, la consulta de soporte se contestó.

**Decisión**. Dos contratos distintos, y se nombran:

| Ruta | Contrato | Si falla |
|---|---|---|
| **Transaccional** (`aprobar`/`rechazar`/`reabrirEscalacionReembolso`) | Falla **ruidosamente**, molde de `VentaStorePort` (`ventas-contract.ts:103-105`) | La transacción revierte: **no hay transición sin fila ni fila sin transición**. El error propaga al dispatcher, que lo traduce a un `TuiTurnResult` de error |
| **No transaccional** (`RegistroAccionesEmpleadoPort.registrarAccion`) | **Nunca lanza** hacia afuera: el dispatcher la envuelve en `try/catch` | Evento `accion-empleado-registro-fallido` con el motivo, y el comando responde su resultado normal |

**Alternativas consideradas**:

- *Que `registrarAccion` también propague*: rechazada. Convertiría "tu reembolso se procesó pero no pudimos anotarlo" en "error" sobre una TUI donde el empleado no tiene forma de saber qué parte falló, y lo empujaría a reintentar un comando que ya tuvo efecto. R10 ya acepta el efecto sin fila; lo que no acepta es mentirle al operador sobre si el efecto ocurrió.
- *Que `registrarAccion` trague en silencio adentro del adaptador*: rechazada. Un registro de auditoría que puede perder filas sin dejar rastro es peor que uno que las pierde ruidosamente. El evento en `data/harness.log` es lo que hace el hueco **detectable**, que es literalmente la mitigación que R10 declara.

**Consecuencias**. `RegistroAccionesEmpleadoPort` es el primer puerto del proyecto cuyo contrato de fallas lo impone el **llamador** y no el puerto (a diferencia de `VentaNotifierPort`, que nunca rechaza por adentro). Se documenta en el module doc del contrato, porque es una asimetría con `VentaNotifierPort` que un lector va a notar.

### ADR 41: `createVentaStore` se **amplía** con los cinco métodos y el dispatcher lo **reusa** — corrección a la tabla de archivos de la propuesta

**Contexto**. La tabla *Nuevos componentes y cambios* de la propuesta **no lista `src/build-on-venta.ts`**. Verificado contra el código: `createVentaStore` ya está **exportado** (`build-on-venta.ts:137`) y es la única implementación de `VentaStorePort`. Agregarle cinco métodos al puerto rompe la compilación de ese archivo hasta que se amplíe. **No hay diseño posible en el que `build-on-venta.ts` no se toque.**

**Decisión**. Se amplía `createVentaStore` con los cinco closures nuevos y el dispatcher lo **importa tal cual**. `buildOnVenta` y los cuatro handlers web **no cambian** ni una línea: siguen recibiendo el mismo `store` y usando los mismos seis métodos.

**Alternativas consideradas**:

- *Un `src/venta-store.ts` nuevo al que se muda `createVentaStore` + `toPortVenta`*: rechazada. El diff sería **más** grande (mover ~100 líneas aprobadas por el Reviewer de Hito 4 más actualizar dos imports y un archivo de test) para el mismo resultado funcional. Mover código aprobado sin necesidad es la clase de churn que hace ilegible un code review.
- *Un segundo store parcial solo para el dispatcher*: rechazada. Dos implementaciones del mismo puerto, con dos `toPortVenta` y dos validaciones de `VENTA_ESTADOS`, para no agregar cinco líneas a un archivo.

**Consecuencias**. La tabla de archivos de la propuesta se corrige acá (§11), no en silencio. Y hay una **verificación gratis** que el checkpoint pidió sin saberlo: el test existente de `createVentaStore` (`build-on-venta.test.ts:240-312`) es el canario de R2 — si alguien ensanchara `aprobarReembolso` a `IN ('confirmada','reembolso_pendiente')` en vez de agregar métodos, ese test lo detecta.

---

## 3. Componentes del Núcleo

Cada archivo con su `*.test.ts` colocado (estilo del repo). **Ninguno importa de `src/adapters/*`.** Ninguno llama a `Date.now()` ni a `randomUUID()` por su cuenta.

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | `ComandoEmpleado`, `parsearComando`, `COMANDOS`, `formatearAyuda`, `COMANDO_LOG_CORRELATION_ID` | §3.1. **Sin imports.** |
| `src/core/commands/registro-acciones-contract.ts` | `AccionEmpleado`, `COMANDO_*`, `RESULTADO_*`, `RegistroAccionesEmpleadoPort` | §3.2. **Sin imports.** |
| `src/core/auth/credenciales-contract.ts` | `CredencialEmpleado`, `CredencialesEmpleadoPort` | §3.3. **Sin imports.** |
| `src/core/auth/sesion.ts` | `SesionEmpleado`, `sesionVigente`, `calcularExpiraEn` | §3.4. **Sin imports.** Puras. |
| `src/core/auth/auth-config.ts` | `AuthConfig`, `DEFAULT_SESION_TTL_MINUTOS`, `resolveAuthConfig` | §3.5. Pura, sin `process.env`. |
| `src/core/auth/login.ts` | `LoginDeps`, `LoginResult`, `resolverLogin`, `AUTH_LOG_CORRELATION_ID` | §3.6. Pura y **síncrona**. |
| `src/core/ventas/resolver-escalacion-reembolso.ts` | `AccionEscalacion`, `EscalacionListada`, `resolverEscalacionReembolso` | §3.7. Pura y **síncrona**. |
| `src/core/ventas/ventas-contract.ts` | *(modificado)* +2 constantes, +5 métodos de puerto, +2 tipos | §3.8. |
| `src/core/ventas/procesar-devolucion.ts` | *(modificado)* solo el retorno | §3.9. |

### 3.1 `src/core/commands/comando-empleado.ts` (nuevo — ADR 21, 34)

```ts
/** Correlación de log para eventos del canal de comandos que no tienen `casoId` propio.
 *  Molde de `WEBHOOK_LOG_CORRELATION_ID` / `WEB_LOG_CORRELATION_ID` (main.ts). */
export const COMANDO_LOG_CORRELATION_ID = "tui-comando";

export type MotivoAyuda = "solicitada" | "desconocido" | "argumentos";

/**
 * Unión discriminada de los OCHO comandos (ADR 21, 34). `ayuda` no es un
 * comando más: es también el sumidero de todo lo malformado, y por eso el
 * parser NO tiene una rama de error.
 *
 * ★ `login.password` es el ÚNICO campo SECRETO de todo el núcleo. ★ No se
 *   loguea, no se persiste, no se devuelve en ningún `TuiTurnResult`, y no
 *   sobrevive a la llamada a `verificarPassword` (ADR 21 enmienda rev. 3).
 */
export type ComandoEmpleado =
  | { readonly tipo: "login"; readonly empleadoId: string; readonly password: string }
  | { readonly tipo: "logout" }
  | { readonly tipo: "soporte"; readonly consulta: string }
  | { readonly tipo: "devolucion"; readonly token: string; readonly motivo?: string }
  | { readonly tipo: "aprobar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "rechazar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "reabrir_reembolso"; readonly ventaId?: string }
  /** `comando` lleva SOLO el primer token (`"/logni"`), NUNCA el resto de la línea. */
  | { readonly tipo: "ayuda"; readonly motivo: MotivoAyuda; readonly comando?: string };

export interface DescriptorComando {
  /** `"/aprobar-reembolso"`. */
  readonly nombre: string;
  /** `"/aprobar-reembolso [ventaId]"` — una línea de uso. */
  readonly uso: string;
  /** Una línea de ayuda, en el idioma del resto de los mensajes. */
  readonly ayuda: string;
  /** `true` ⇒ exige sesión vigente (ADR 28, 32). Lo consume el dispatcher, no el parser. */
  readonly privilegiado: boolean;
  /** `true` SOLO para `/login`: su segundo argumento es un secreto, no un identificador opaco. */
  readonly secreto: boolean;
}

/** Los ocho descriptores, en el orden en que `/ayuda` los imprime. */
export const COMANDOS: readonly DescriptorComando[];

/** Texto de `/ayuda`: encabezado + una línea `uso — ayuda` por descriptor. PURA. */
export function formatearAyuda(comandos?: readonly DescriptorComando[]): string;

/**
 * PURA, sin I/O, sin reloj. Reglas, en orden:
 *  1. `texto.trimStart()` no empieza con `/`  → `undefined` (turno conversacional).
 *  2. Primer token → busca descriptor por `nombre`. No matchea → `{ ayuda, "desconocido", comando }`.
 *  3. Parseo por forma (ADR 34):
 *     · sin argumentos: `/logout`, `/ayuda` (sobrantes ignorados).
 *     · id opcional: primer token del resto, o campo ausente si el resto está vacío.
 *     · id + resto: `split` en el PRIMER espacio; el resto entero con `trim` de bordes.
 *  4. Argumento obligatorio ausente o vacío → `{ ayuda, "argumentos", comando }`.
 *     Obligatorios: `/login` (los DOS), `/soporte` (consulta), `/devolucion` (token).
 *     `motivo` de `/devolucion` y `ventaId` de los tres privilegiados son OPCIONALES.
 *  5. `/ayuda` explícito → `{ ayuda, "solicitada" }`.
 *
 * LÍMITE CONOCIDO Y TESTEADO (R4, resuelto por ADR 34): una contraseña con
 * espacios INTERNOS se tipea sin problema; una que empiece o termine con
 * espacio NO, porque el `trim` de bordes se la come.
 */
export function parsearComando(texto: string): ComandoEmpleado | undefined;
```

### 3.2 `src/core/commands/registro-acciones-contract.ts` (nuevo — ADR 27, 40)

```ts
/* ── Vocabulario de `registro_acciones_empleado.comando` ── */
export const COMANDO_LOGIN = "/login";
export const COMANDO_SOPORTE = "/soporte";
export const COMANDO_DEVOLUCION = "/devolucion";
export const COMANDO_APROBAR_REEMBOLSO = "/aprobar-reembolso";
export const COMANDO_RECHAZAR_REEMBOLSO = "/rechazar-reembolso";
export const COMANDO_REABRIR_REEMBOLSO = "/reabrir-reembolso";

/* ── Vocabulario de `registro_acciones_empleado.resultado` (tabla del ADR 27) ── */
export const RESULTADO_EXITOSA = "exitosa";         // /login
export const RESULTADO_ATENDIDA = "atendida";       // /soporte
export const RESULTADO_FALLIDA = "fallida";         // /soporte
export const RESULTADO_REEMBOLSADA = "reembolsada"; // /devolucion
export const RESULTADO_ESCALADA = "escalada";       // /devolucion
export const RESULTADO_APROBADA = "aprobada";       // /aprobar-reembolso
export const RESULTADO_RECHAZADA = "rechazada";     // /rechazar-reembolso
export const RESULTADO_REABIERTA = "reabierta";     // /reabrir-reembolso
export const RESULTADO_NO_APLICABLE = "no_aplicable";

/**
 * Una fila del registro. `ventaId`/`casoId` son OPCIONALES (columnas nullable):
 * una consulta de soporte no tiene venta; una devolución con token inválido no
 * tiene ninguna de las dos.
 *
 * ★ LO QUE ESTE TIPO NO TIENE, Y NO PUEDE TENER (ADR 27) ★
 *   token_confirmacion · password · texto de la consulta · motivo del cliente.
 *   No hay campo donde meterlos. La garantía es estructural, no de disciplina.
 */
export interface AccionEmpleado {
  readonly id: string;
  /** SIEMPRE de una `SesionEmpleado` vigente (ADR 27 enmienda rev. 3, ADR 37). */
  readonly empleadoId: string;
  readonly comando: string;
  readonly ventaId?: string;
  readonly casoId?: string;
  readonly resultado: string;
  readonly ocurridoAt: string;
}

/**
 * Escritura de las acciones que NO ocurren dentro de una transacción de venta:
 * `/login` exitoso, `/soporte`, `/devolucion` y los intentos `no_aplicable`.
 *
 * CONTRATO DE FALLAS — asimétrico con `VentaNotifierPort` a propósito (ADR 40):
 * este puerto SÍ puede lanzar (es un `INSERT` síncrono de `better-sqlite3`), y
 * es el LLAMADOR (el dispatcher) el que envuelve la llamada y degrada a un
 * evento `accion-empleado-registro-fallido`. El efecto de negocio ya ocurrió;
 * perder la fila es R10, mentir sobre el efecto no lo es.
 *
 * Las filas de los TRES comandos de resolución NO pasan por acá: viajan dentro
 * de la transacción del CAS (`VentaStorePort`, ADR 27).
 */
export interface RegistroAccionesEmpleadoPort {
  registrarAccion(accion: AccionEmpleado): void;
}
```

### 3.3 `src/core/auth/credenciales-contract.ts` (nuevo — ADR 30)

```ts
export interface CredencialEmpleado {
  readonly empleadoId: string;
  /** Formato `scrypt$N$r$p$salt$clave` (ADR 30, 35). El núcleo NO lo interpreta:
   *  se lo pasa entero a `verificarPassword`, que es lo único que sabe leerlo. */
  readonly passwordHash: string;
}

/**
 * UNA sola operación, de LECTURA (ADR 30). El alta y la rotación viven en otro
 * proceso (`src/empleados.ts`, ADR 33) y no pasan por este puerto: la TUI no
 * puede crear credenciales, y eso es una propiedad del diseño, no un olvido.
 *
 * SÍNCRONO, como `VentaStorePort` y `MemoryPort` (`better-sqlite3` lo es).
 */
export interface CredencialesEmpleadoPort {
  buscarCredencial(empleadoId: string): CredencialEmpleado | undefined;
}
```

### 3.4 `src/core/auth/sesion.ts` (nuevo — ADR 31)

```ts
/**
 * Sesión en memoria del proceso de la TUI. Vive en la ranura del closure de
 * `build-on-comando-empleado.ts` — NUNCA se persiste (ADR 31 punto 4).
 *
 * ★ Es el tipo que expresa el invariante del ADR 37: el ÚNICO productor real
 *   es `resolverLogin`. Toda función que reciba una `SesionEmpleado` está
 *   declarando que su `empleadoId` fue AUTENTICADO, no tipeado. ★
 */
export interface SesionEmpleado {
  readonly empleadoId: string;
  /** ISO-8601 UTC. */
  readonly iniciadaEn: string;
  /** ISO-8601 UTC, o AUSENTE = sin expiración (`SESION_TTL_MINUTOS=0`, ADR 31 punto 2). */
  readonly expiraEn?: string;
}

/**
 * TTL ABSOLUTO desde el login, no deslizante (ADR 31 punto 2).
 *  · `sesion === undefined`        → `false`
 *  · `sesion.expiraEn === undefined` → `true` (opt-out explícito)
 *  · si no → `ahora < sesion.expiraEn`
 *
 * Comparación LEXICOGRÁFICA de strings, correcta SOLO porque todo timestamp
 * del repo es `new Date().toISOString()` — ISO-8601 UTC de ancho fijo (ADR 16
 * de Hito 4, regla 3). El borde exacto (`ahora === expiraEn`) es `false`:
 * vencida, mismo criterio que `expires_at > @ahora` del CAS de confirmación.
 */
export function sesionVigente(sesion: SesionEmpleado | undefined, ahora: string): boolean;

/**
 * `iniciadaEn + ttlMinutos`, o `undefined` si `ttlMinutos === 0`.
 * Molde EXACTO de `calcularExpiresAt` (`token-confirmacion.ts`):
 * `new Date(Date.parse(iniciadaEn) + ttlMinutos * 60_000).toISOString()`.
 */
export function calcularExpiraEn(iniciadaEn: string, ttlMinutos: number): string | undefined;
```

### 3.5 `src/core/auth/auth-config.ts` (nuevo — ADR 31)

Molde **exacto** de `ventas-config.ts` (verificado línea por línea): no importa `env.js`, no tiene default `= process.env`, no lanza, acumula todos los errores.

```ts
export interface AuthConfig {
  /** Minutos. `0` = SIN expiración — mismo interruptor que `VENTA_TOKEN_TTL_HORAS=0`. Default 30. */
  readonly sesionTtlMinutos: number;
}

export const DEFAULT_SESION_TTL_MINUTOS = 30;

export type ResolveAuthConfigResult =
  | { readonly ok: true; readonly config: AuthConfig }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * | Env var | Campo | Default | Validación | Inválido |
 * |---|---|---|---|---|
 * | `SESION_TTL_MINUTOS` | `sesionTtlMinutos` | `30` | entero finito, `>= 0` | **ABORTA** |
 *
 * Ausente o vacía → default. Presente pero inválida → error con el nombre de la
 * variable y el valor recibido. Clase "aborta" (ADR 17 de Hito 4): un TTL de
 * sesión mal escrito que caiga en silencio a 30 min es una sesión que dura otra
 * cosa que la que el operador cree.
 */
export function resolveAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
): ResolveAuthConfigResult;
```

### 3.6 `src/core/auth/login.ts` (nuevo — ADR 30, 31)

```ts
export const AUTH_LOG_CORRELATION_ID = "auth";

export interface LoginDeps {
  readonly store: CredencialesEmpleadoPort;
  /** INYECTADO (ADR 30): en producción es `verificarPassword` de
   *  `src/adapters/crypto/password.ts`; en test es un `vi.fn()`. El núcleo NO
   *  sabe que existe scrypt, ni cuánto cuesta. */
  readonly verificarPassword: (password: string, hash: string) => boolean;
  readonly now: () => string;
  /** De `AuthConfig.sesionTtlMinutos`. `0` = sin expiración. */
  readonly ttlMinutos: number;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export type LoginResult =
  | { readonly resultado: "exitosa"; readonly sesion: SesionEmpleado }
  | { readonly resultado: "invalida" };

/**
 * PURA y SÍNCRONA. Secuencia exacta:
 *  1. `credencial = store.buscarCredencial(empleadoId)`.
 *  2. `credencial === undefined` → `login-fallido` con `{ empleadoId, motivo: "inexistente" }`
 *     → `{ resultado: "invalida" }`.
 *  3. `verificarPassword(password, credencial.passwordHash) === false`
 *     → `login-fallido` con `{ empleadoId, motivo: "password" }` → `invalida`.
 *  4. `iniciadaEn = now()`; `expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos)`
 *     → `login-exitoso` con `{ empleadoId, expiraEn }` → `{ exitosa, sesion }`.
 *
 * ★ `password` aparece EXACTAMENTE UNA VEZ en el cuerpo: como argumento de
 *   `verificarPassword`. No entra en ningún `logEvent`, ni en el resultado, ni
 *   en la sesión. El `motivo` distingue los dos fracasos SOLO en el log local
 *   (útil para diagnóstico); el MENSAJE que el dispatcher le muestra al usuario
 *   es el mismo genérico en los dos casos (ADR 30). ★
 *
 * NO escribe fila de registro: eso lo hace el dispatcher, y SOLO en el camino
 * exitoso (ADR 33 punto 4).
 */
export function resolverLogin(
  input: { readonly empleadoId: string; readonly password: string },
  deps: LoginDeps,
): LoginResult;
```

### 3.7 `src/core/ventas/resolver-escalacion-reembolso.ts` (nuevo — ADR 25, 29, 37, 38)

```ts
export const ACCION_APROBAR = "aprobar";
export const ACCION_RECHAZAR = "rechazar";
export const ACCION_REABRIR = "reabrir";
export type AccionEscalacion =
  | typeof ACCION_APROBAR | typeof ACCION_RECHAZAR | typeof ACCION_REABRIR;

export interface ResolverEscalacionDeps {
  readonly store: VentaStorePort;
  /** Genera el `id` de la fila de registro (ADR 39). */
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** Tope del listado sin argumento. Default `LIMITE_LISTADO_ESCALACIONES` (20). */
  readonly limiteListado?: number;
}

export type MotivoNoAplicable = "no_encontrada" | "cas";

export type ResolverEscalacionResult =
  | { readonly resultado: "listado"; readonly accion: AccionEscalacion;
      readonly items: readonly EscalacionListada[] }
  | { readonly resultado: "requiere_confirmacion"; readonly accion: AccionEscalacion;
      readonly venta: EscalacionListada }
  | { readonly resultado: "aplicada"; readonly accion: AccionEscalacion;
      readonly venta: EscalacionListada; readonly estadoFinal: VentaEstado }
  | { readonly resultado: "no_aplicable"; readonly accion: AccionEscalacion;
      readonly motivo: MotivoNoAplicable; readonly ventaId?: string; readonly casoId?: string };

/**
 * PURA y SÍNCRONA — sin `await`, molde de `procesarDevolucion`. Secuencia exacta:
 *
 *  A. `estadoOrigen = accion === "reabrir" ? REEMBOLSO_RECHAZADO : REEMBOLSO_PENDIENTE`.
 *  B. `ventaId === undefined` → `store.listar*({ limite })` → `{ resultado: "listado" }`.
 *     Evento `reembolso-listado` con `{ accion, cantidad }`. CERO escrituras.
 *  C. `ventaId` presente → `store.listar*({ ventaId })` (ADR 38: filtro por id, NUNCA
 *     un lector por id sin filtro de estado). Vacío → `no_aplicable` con
 *     `motivo: "no_encontrada"`, evento `reembolso-resolucion-no-aplicable`.
 *     ★ NO escribe fila: no hay `casoId` que correlacionar y el ADR 27 no pide
 *       auditar un id que no existe. ★
 *  D. `confirmado === false` → `{ requiere_confirmacion, venta }` — evento
 *     `reembolso-resolucion-solicitada` con `{ accion, ventaId, monto }`.
 *     ★ NI el store NI el registro reciben una sola escritura. ★
 *  E. `confirmado === true` → el método CAS que corresponda, con
 *     `{ ventaId, casoId, empleadoId: sesion.empleadoId, accionId: newId(), ahora: now() }`:
 *       aprobar  → `store.aprobarEscalacionReembolso`  → venta `reembolsada`
 *       rechazar → `store.rechazarEscalacionReembolso` → venta `reembolso_rechazado`
 *       reabrir  → `store.reabrirEscalacionReembolso`  → venta `reembolso_pendiente`
 *     `undefined` (el CAS no matcheó) → `no_aplicable` con `motivo: "cas"`.
 *     ★ En ESE caso el dispatcher escribe la fila `no_aplicable` FUERA de la
 *       transacción (ADR 27) — este módulo solo informa el motivo. ★
 *     Fila → evento `reembolso-escalacion-aprobada|rechazada|reabierta`.
 *
 * `sesion: SesionEmpleado` y no `empleadoId: string` — ADR 37.
 * CERO llamadas al modelo. CERO `await`. Test explícito de sincronía.
 */
export function resolverEscalacionReembolso(
  input: {
    readonly accion: AccionEscalacion;
    readonly ventaId?: string;
    readonly confirmado: boolean;
    readonly sesion: SesionEmpleado;
  },
  deps: ResolverEscalacionDeps,
): ResolverEscalacionResult;
```

### 3.8 `src/core/ventas/ventas-contract.ts` (modificado — ADR 23, 24, 27, 29, 38, 39)

Se agrega **al final de las secciones existentes**, sin reordenar nada:

```ts
/** SEXTO valor (ADR 23): venta confirmada, reembolso escalado y DENEGADO por un
 *  empleado autenticado. Terminal SALVO reapertura explícita (ADR 29).
 *  NO es `rechazada`: esa significa "el cliente declinó ANTES de confirmar". */
export const VENTA_ESTADO_REEMBOLSO_RECHAZADO = "reembolso_rechazado";

export const VENTA_ESTADOS = [
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_RECHAZADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,   // ← nuevo
] as const;

/** Un solo valor para los TRES desenlaces (ADR 24): el `caso` solo responde
 *  "¿sigue esperando a un humano?". Una reapertura lo devuelve a
 *  `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` — el ciclo es CÍCLICO, no lineal. */
export const CASO_ESTADO_RESUELTO = "resuelto";

/** Tope del listado sin argumento (ADR 29 punto 1). Los rechazados se acumulan
 *  para siempre; los pendientes no, pero se acota igual por uniformidad. */
export const LIMITE_LISTADO_ESCALACIONES = 20;

/** Una venta escalada, con lo que el eco de confirmación necesita mostrar.
 *  Misma forma, campo por campo, que `EscalacionReembolsoRow` de `repository.ts`
 *  (que NO importa este archivo — se alinean por convención, igual que
 *  `VentaRow`/`Venta` hoy). */
export interface EscalacionListada {
  readonly ventaId: string;
  readonly vendedorId: string;
  readonly vendedorNombre: string;
  readonly clienteId: string;
  readonly monto: number;
  readonly casoId: string;
  readonly confirmedAt?: string;
  /** Del registro (ADR 27): último `/rechazar-reembolso` con `resultado='rechazada'`. */
  readonly rechazadaPor?: string;
  readonly rechazadaAt?: string;
  /** Del registro: cantidad de `/reabrir-reembolso` con `resultado='reabierta'`. */
  readonly reaperturasPrevias: number;
}

export interface ResolucionEscalacionInput {
  readonly ventaId: string;
  readonly casoId: string;
  /** SIEMPRE de una sesión vigente (ADR 27 enmienda, ADR 37). */
  readonly empleadoId: string;
  /** `id` de la fila de registro, generado por el núcleo (ADR 39). */
  readonly accionId: string;
  /** `updated_at` del caso Y `ocurrido_at` de la fila. UNO solo, a propósito. */
  readonly ahora: string;
}

export interface FiltroEscalaciones {
  /** Presente ⇒ 0 o 1 resultado, sin importar `limite` (ADR 38). */
  readonly ventaId?: string;
  /** Default `LIMITE_LISTADO_ESCALACIONES`. */
  readonly limite?: number;
}

/* ── Los CINCO métodos nuevos de VentaStorePort ─────────────────────────────
 * `aprobarReembolso`/`escalarReembolso` NO SE TOCAN (R2): ensanchar el
 * `WHERE estado='confirmada'` de `aprobarReembolso` a
 * `IN ('confirmada','reembolso_pendiente')` dejaría que `procesarDevolucion` se
 * salte la escalación sin que nadie apruebe nada. PROHIBIDO explícitamente.
 */
export interface VentaStorePort {
  // ...los seis métodos de Hito 4, sin cambios...

  /** `reembolso_pendiente`, ordenadas por `confirmed_at` ASC. Solo lectura. */
  listarReembolsosPendientes(filtro?: FiltroEscalaciones): readonly EscalacionListada[];

  /** `reembolso_rechazado`, ordenadas por fecha del rechazo DESC (ADR 29 punto 1). */
  listarReembolsosRechazados(filtro?: FiltroEscalaciones): readonly EscalacionListada[];

  /** UNA transacción: CAS `reembolso_pendiente → reembolsada` + `updateCaso(resuelto)`
   *  + fila de registro (`comando='/aprobar-reembolso'`, `resultado='aprobada'`).
   *  `undefined` = el CAS no matcheó ⇒ NADA se escribió: ni caso, ni fila. */
  aprobarEscalacionReembolso(input: ResolucionEscalacionInput): Venta | undefined;

  /** Idéntico, CAS `reembolso_pendiente → reembolso_rechazado`, `resultado='rechazada'`. */
  rechazarEscalacionReembolso(input: ResolucionEscalacionInput): Venta | undefined;

  /** CAS `reembolso_rechazado → reembolso_pendiente` + `updateCaso(pendiente_aprobacion_humana)`
   *  + fila `resultado='reabierta'`. El `caso` es EL MISMO de siempre (ADR 29).
   *  Una venta `reembolsada` NO matchea este CAS: `no_aplicable` sin código especial. */
  reabrirEscalacionReembolso(input: ResolucionEscalacionInput): Venta | undefined;
}
```

### 3.9 `src/core/ventas/procesar-devolucion.ts` (modificado — **solo el retorno**, ADR 27)

```ts
export type DevolucionResult =
  | { readonly resultado: "reembolsada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "escalada";    readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "no_aplicable"; readonly ventaId?: string; readonly casoId?: string };
```

**Cambio quirúrgico, y no más que eso**: los cinco `return` existentes ganan los campos que la venta ya tenía en la mano. La secuencia, las guardas, los efectos y los `logEvent` quedan **byte por byte idénticos** — el diff es de cinco líneas de `return`. Mapa exacto:

| Rama actual (línea) | Retorno nuevo |
|---|---|
| token no matchea (`:80-81`) | `{ no_aplicable }` — **sin ids**, y ese es el punto: la fila queda con `venta_id NULL` y sin rastro del token (ADR 27) |
| estado ≠ confirmada (`:85-89`) | `{ no_aplicable, ventaId: venta.id, casoId: venta.casoId }` |
| CAS de aprobar devuelve `undefined` (`:98-100`) | `{ no_aplicable, ventaId, casoId }` |
| reembolsada (`:102-107`) | `{ reembolsada, ventaId, casoId }` |
| CAS de escalar `undefined` (`:116-118`) / escalada (`:120-125`) | `{ no_aplicable \| escalada, ventaId, casoId }` |

`src/adapters/web/server.ts` **solo lee `resultado`** (verificado en la propuesta contra el adaptador), así que compila sin tocarse. `build-on-venta.ts` reexporta el tipo y tampoco cambia.

---

## 4. Adaptador de criptografía — `src/adapters/crypto/password.ts` (nuevo, ADR 30, 35)

Hermano exacto de `adapters/webhooks/signature.ts` (mismo tamaño, mismo contrato de "nunca lanza", mismo chequeo de longitud previo a `timingSafeEqual`). **Cero dependencias nuevas.**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SCRYPT_ALGORITMO = "scrypt";
export const SCRYPT_N = 16_384;   // 2^14 — 128 * N * r = 16 MiB, bajo el maxmem default (32 MiB)
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_BYTES = 32;
export const SCRYPT_SALT_BYTES = 16;
/** Guarda anti-DoS (ADR 35 punto 3): un hash escrito a mano con N gigante
 *  (R16: quien escribe la base puede) NO va a intentar reservar memoria. */
export const SCRYPT_MAX_MEM_BYTES = 64 * 1024 * 1024;

/**
 * `scrypt$16384$8$1$<salt-base64>$<clave-base64>`.
 * `salt` inyectable SOLO para el test (default: `randomBytes(16)`) — mismo
 * criterio que `newToken` en `build-on-venta.ts`.
 * Dos llamadas con la misma contraseña dan hashes DISTINTOS: salt por fila.
 */
export function hashPassword(password: string, salt?: Buffer): string;

/**
 * NUNCA LANZA — devuelve `false`. Molde de `verifySignature`. Pasos:
 *  1. `hash.split("$")` ⇒ 6 campos exactos, y `campos[0] === "scrypt"`.
 *  2. `N`, `r`, `p` enteros `>= 1`, y `128 * N * r <= SCRYPT_MAX_MEM_BYTES`.
 *  3. `salt` y `clave` decodifican de base64 con longitud `> 0`
 *     (round-trip verificado: `Buffer.from(x,"base64").toString("base64") === x`,
 *     porque `Buffer.from` ignora basura en silencio y un hash corrupto NO debe
 *     pasar por válido).
 *  4. `derivada = scryptSync(password, salt, clave.length, { N, r, p, maxmem })`,
 *     TODO adentro de un `try/catch` que devuelve `false`.
 *  5. `derivada.length !== clave.length` → `false` ANTES de `timingSafeEqual`
 *     (esa función LANZA `RangeError` con largos distintos — `signature.ts:22-26`).
 *  6. `timingSafeEqual(derivada, clave)`.
 *
 * Sobre el timing (ADR 30, sin vender humo): NO se deriva contra un hash señuelo
 * cuando el empleado no existe. En este modelo de amenaza el atacante lee
 * `credenciales_empleado` con cualquier cliente SQLite (R16); defender la
 * enumeración por timing sería teatro. `timingSafeEqual` se usa igual porque es
 * gratis y es la convención del repo (`signature.ts`, `web/server.ts:131`).
 */
export function verificarPassword(password: string, hash: string): boolean;
```

---

## 5. Esquema y adaptador de memoria

### 5.1 `migrations/0005_registro_acciones_empleado.ts` (nuevo — ADR 27)

```ts
/**
 * Registro APPEND-ONLY de acciones de empleado (ADR 27). Primera tabla del
 * proyecto que captura IDENTIDAD DE ACTOR, y con los ADR 30-32 esa identidad es
 * AUTENTICADA, no autodeclarada.
 *
 * `empleado_id` es NOT NULL a propósito: por construcción no existe la fila
 * anónima (ADR 28). Sin sesión no hay fila — se prefiere un registro con huecos
 * honestos a uno completo y mentiroso. Los logins FALLIDOS no dejan fila (ADR 33
 * punto 4): no hay empleado identificado a quien atribuírselos.
 *
 * ★ SIN FK a `credenciales_empleado`, y es la decisión menos obvia de la tabla
 *   (ADR 27, enmienda rev. 3): las filas de auditoría tienen que SOBREVIVIR al
 *   empleado que las produjo. Una FK ataría la vida del registro a la vida de la
 *   credencial, y como la única baja posible hoy es borrar esa fila (ADR 33), la
 *   baja fallaría por la FK o arrastraría el historial. Un append-only que se
 *   poda borrando una credencial no es append-only. Mismo criterio que
 *   `ventas.cliente_id`, opaco y sin FK a propósito (0004). ★
 *
 * `venta_id`/`caso_id` NULLABLE: una consulta de soporte no tiene venta; una
 * devolución con token inválido no tiene ninguna de las dos. SÍ tienen FK: esas
 * dos tablas no se podan.
 *
 * `comando` y `resultado` quedan TEXT abiertos SIN CHECK — mismo criterio que
 * `casos.estado` y `ventas.estado`: el vocabulario canónico vive en
 * `core/commands/registro-acciones-contract.ts`, el SQL no lo conoce.
 *
 * UN solo índice, por `venta_id`, porque hay UN patrón de lectura real: la
 * historia de una venta, que alimenta el listado y el eco de
 * `/reabrir-reembolso` (§5.3). Índices por `empleado_id` u `ocurrido_at` se
 * agregan cuando exista una lectura que los pida — criterio de 0004.
 *
 * Timestamps ISO-8601 UTC, como todo el esquema. `ocurrido_at` se COMPARA y se
 * ORDENA lexicográficamente (§5.3), correcto SOLO por ese invariante.
 *
 * DESVIACIÓN respecto del SQL del plan (R12): tabla nueva, aditiva, sin datos
 * que migrar y sin lectores previos. Requiere aprobación del checkpoint humano
 * — CONCEDIDA en la revisión 3.
 */
export const migration0005RegistroAccionesEmpleado = {
  id: "0005_registro_acciones_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS registro_acciones_empleado (
  id TEXT PRIMARY KEY,
  empleado_id TEXT NOT NULL,
  comando TEXT NOT NULL,
  venta_id TEXT REFERENCES ventas(id),
  caso_id TEXT REFERENCES casos(id),
  resultado TEXT NOT NULL,
  ocurrido_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registro_acciones_venta ON registro_acciones_empleado(venta_id);
`,
};
```

### 5.2 `migrations/0006_credenciales_empleado.ts` (nuevo — ADR 30, 33)

```ts
/**
 * Credenciales de empleado (ADR 30). Una fila por empleado, `empleado_id` como
 * PK — el mismo string que después va a `registro_acciones_empleado.empleado_id`
 * (sin FK, ver 0005).
 *
 * ★ SIN columna `salt` ★: el formato `scrypt$N$r$p$salt$clave` (ADR 30, 35) lo
 * embebe. Una columna aparte obligaría a versionar el esquema cada vez que
 * cambie un parámetro de costo; con el hash autodescriptivo, dos filas con
 * costos distintos conviven sin migrar nada.
 *
 * ★ SIN columna `activo` ★: la desactivación está DIFERIDA (ADR 33 punto 3,
 * R15). Arrastra una política que nadie definió — qué pasa con la sesión abierta
 * de alguien que se desactiva mientras la usa, si sus filas de auditoría siguen
 * valiendo, si el id se puede reusar — y eso es el modelo de autorización de
 * Hito 5. El paliativo existe y cuesta un comando: rotar la contraseña a un
 * valor aleatorio que nadie conoce.
 *
 * `created_at` NO se pisa en una rotación; `updated_at` SÍ. Esa diferencia es la
 * huella que R16 usa: un alta nueva se ve en `created_at`, una impersonación por
 * rotación se ve en `updated_at`.
 *
 * La contraseña en claro NO existe en ninguna columna, en ningún índice y en
 * ningún log. La escribe UN solo proceso (`src/empleados.ts`) y la lee UNA sola
 * función (`verificarPassword`).
 *
 * DESVIACIÓN respecto del SQL del plan (R12), aditiva. Checkpoint: CONCEDIDA.
 */
export const migration0006CredencialesEmpleado = {
  id: "0006_credenciales_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS credenciales_empleado (
  empleado_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
};
```

`migrations/index.ts` gana **dos líneas de import y dos de append**, sin editar ni reordenar las cuatro existentes (convención documentada en ese archivo, `:11-15`).

### 5.3 `repository.ts` — nueve funciones nuevas, ninguna existente modificada

Se agregan **al final del archivo**, con el mismo estilo: `*SqlRow` privada + `rowTo*` privada + función exportada, literales de estado en el SQL (este módulo **no importa** el vocabulario del núcleo — criterio ya documentado en `:1160-1168`).

**(a) Lectura de escalaciones — ADR 38.** Una función, cuatro usos:

```ts
export interface EscalacionReembolsoRow {
  readonly ventaId: string; readonly vendedorId: string; readonly vendedorNombre: string;
  readonly clienteId: string; readonly monto: number; readonly casoId: string;
  readonly confirmedAt?: string;
  readonly rechazadaPor?: string; readonly rechazadaAt?: string;
  readonly reaperturasPrevias: number;
}

export function listEscalacionesReembolso(
  db: Database.Database,
  filtro: { readonly estado: string; readonly ventaId?: string; readonly limite?: number },
): readonly EscalacionReembolsoRow[];
```

```sql
SELECT v.id            AS venta_id,
       v.vendedor_id   AS vendedor_id,
       ve.nombre       AS vendedor_nombre,
       v.cliente_id    AS cliente_id,
       v.monto         AS monto,
       v.caso_id       AS caso_id,
       v.confirmed_at  AS confirmed_at,
       (SELECT r.empleado_id
          FROM registro_acciones_empleado r
         WHERE r.venta_id = v.id
           AND r.comando = '/rechazar-reembolso'
           AND r.resultado = 'rechazada'
         ORDER BY r.ocurrido_at DESC
         LIMIT 1)                                   AS rechazada_por,
       (SELECT r.ocurrido_at
          FROM registro_acciones_empleado r
         WHERE r.venta_id = v.id
           AND r.comando = '/rechazar-reembolso'
           AND r.resultado = 'rechazada'
         ORDER BY r.ocurrido_at DESC
         LIMIT 1)                                   AS rechazada_at,
       (SELECT COUNT(*)
          FROM registro_acciones_empleado r
         WHERE r.venta_id = v.id
           AND r.comando = '/reabrir-reembolso'
           AND r.resultado = 'reabierta')           AS reaperturas_previas
  FROM ventas v
  JOIN vendedores ve ON ve.id = v.vendedor_id
 WHERE v.estado = @estado
   AND (@ventaId IS NULL OR v.id = @ventaId)
 ORDER BY <ORDEN>
 LIMIT @limite
```

`<ORDEN>` se elige en TS con un `switch` sobre `estado` **contra una constante literal** (nunca interpolando entrada del usuario):

- `reembolso_rechazado` → `rechazada_at DESC, v.confirmed_at DESC` (ADR 29 punto 1: el más recientemente rechazado primero; `rechazada_at` puede ser `NULL` si la fila se perdió por R10, y en SQLite `NULL` ordena primero en `ASC` / último en `DESC` — el desempate por `confirmed_at` evita un orden arbitrario).
- `reembolso_pendiente` → `v.confirmed_at ASC` (mismo orden que `listVentasEnReembolsoPendiente` ya usa, para que el listado de `/aprobar-reembolso` y el del reporte coincidan).

`@ventaId` se pasa como `input.ventaId ?? null`; `@limite` como `input.limite ?? LIMITE` (20). **`listVentasEnReembolsoPendiente` no se toca**: el reporte mensual no paga estas tres subconsultas (ADR 38).

**(b) Escritura del registro — la ÚNICA (ADR 27, 39, 40):**

```ts
export interface AccionEmpleadoInput {
  readonly id: string; readonly empleadoId: string; readonly comando: string;
  readonly ventaId?: string; readonly casoId?: string;
  readonly resultado: string; readonly ocurridoAt: string;
}

/** UN solo lugar que sabe el layout de la fila. Las DOS rutas del ADR 27
 *  (dentro de la transacción del CAS, y `registrarAccion` fuera) terminan acá. */
export function insertAccionEmpleado(db: Database.Database, input: AccionEmpleadoInput): void;
```

```sql
INSERT INTO registro_acciones_empleado
  (id, empleado_id, comando, venta_id, caso_id, resultado, ocurrido_at)
VALUES (@id, @empleadoId, @comando, @ventaId, @casoId, @resultado, @ocurridoAt)
```

con `ventaId`/`casoId` normalizados a `null`. Se agrega también, **solo para test**, `listAccionesEmpleadoPorVenta(db, ventaId)` — la lectura que el test de "el ciclo completo deja cuatro filas legibles en orden" necesita, y que **ningún camino de producción usa**; se declara así en su module doc para que el Reviewer no la lea como código muerto.

**(c) Los tres CAS transaccionales — molde EXACTO de `escalarReembolso` (`:1016-1044`), con un `insertAccionEmpleado` más adentro de la misma `db.transaction`:**

```ts
export function aprobarEscalacionReembolso(db, input): VentaRow | undefined;
export function rechazarEscalacionReembolso(db, input): VentaRow | undefined;
export function reabrirEscalacionReembolso(db, input): VentaRow | undefined;
```

Cuerpo común (los tres difieren en tres literales y en el estado del caso):

```ts
const runInTransaction = db.transaction((): VentaRow | undefined => {
  const row = db.prepare(
    `UPDATE ventas
        SET estado = '<ESTADO_DESTINO>'
      WHERE id = @ventaId
        AND estado = '<ESTADO_ORIGEN>'
     RETURNING ${VENTA_SELECT_COLUMNS}`,
  ).get({ ventaId: input.ventaId }) as VentaSqlRow | undefined;

  if (!row) return undefined;            // ← el CAS no matcheó: NADA más se escribe

  updateCaso(db, input.casoId, { estado: "<ESTADO_CASO>", updatedAt: input.ahora });

  insertAccionEmpleado(db, {
    id: input.accionId,
    empleadoId: input.empleadoId,
    comando: "<COMANDO>",
    ventaId: input.ventaId,
    casoId: input.casoId,
    resultado: "<RESULTADO>",
    ocurridoAt: input.ahora,
  });

  return rowToVenta(row);
});
return runInTransaction();
```

| Función | ORIGEN | DESTINO | ESTADO_CASO | COMANDO | RESULTADO |
|---|---|---|---|---|---|
| `aprobarEscalacionReembolso` | `reembolso_pendiente` | `reembolsada` | `resuelto` | `/aprobar-reembolso` | `aprobada` |
| `rechazarEscalacionReembolso` | `reembolso_pendiente` | `reembolso_rechazado` | `resuelto` | `/rechazar-reembolso` | `rechazada` |
| `reabrirEscalacionReembolso` | `reembolso_rechazado` | `reembolso_pendiente` | `pendiente_aprobacion_humana` | `/reabrir-reembolso` | `reabierta` |

**Invariante que estas tres funciones garantizan**: *no existe una transición de resolución exitosa sin su fila, ni una fila sin su transición.* El `return undefined` antes de tocar el caso es lo que impide el estado intermedio "caso resuelto, venta no" — mismo argumento que `escalarReembolso:1031-1033` ya documenta. Y una venta `reembolsada` **nunca** matchea el CAS de reapertura: `no_aplicable` **sin una línea de validación especial** (ADR 29).

**(d) Credenciales (ADR 33):**

```ts
export interface CredencialEmpleadoRow {
  readonly empleadoId: string; readonly passwordHash: string;
  readonly createdAt: string; readonly updatedAt: string;
}

/** `SELECT ... WHERE empleado_id = ?`. `undefined` si no existe. */
export function buscarCredencialEmpleado(db, empleadoId: string): CredencialEmpleadoRow | undefined;

/** `INSERT`. Lanza `CredencialEmpleadoDuplicadaError` ante
 *  `SQLITE_CONSTRAINT_PRIMARYKEY` — molde EXACTO de `createCaso:103-108` con
 *  `isSqliteConstraintError`. Un alta que pisa un hash existente es un reseteo
 *  disfrazado de alta (ADR 33 punto 1). `created_at = updated_at = ahora`. */
export function insertCredencialEmpleado(
  db, input: { empleadoId: string; passwordHash: string; ahora: string },
): CredencialEmpleadoRow;

/** `UPDATE password_hash, updated_at ... WHERE empleado_id = @empleadoId
 *  RETURNING ...`. `undefined` = no existe (el caller falla con exit(1)).
 *  `created_at` NO se toca: es la huella de R16. */
export function updateCredencialEmpleado(
  db, input: { empleadoId: string; passwordHash: string; ahora: string },
): CredencialEmpleadoRow | undefined;
```

---

## 6. El dispatcher — `src/build-on-comando-empleado.ts` (nuevo)

Hermano de `build-on-submit.ts` / `build-on-venta.ts` / `build-on-soporte.ts`: vive en `src/`, **no** dentro de un adaptador ni de `core/`, porque importa de los dos lados.

### 6.1 Firma y estado

```ts
export interface BuildOnComandoEmpleadoDeps {
  /** El `SubmitPromptHandler` que `buildOnSubmit` ya devuelve. Se ENVUELVE, no se toca. */
  readonly onSubmit: SubmitPromptHandler;
  /** El MISMO `buildOnSoporte(...)` que sirve a `POST /soporte` — se arma UNA vez
   *  en `main.ts` y se comparte, sin duplicar `createKnowledge` (§8). */
  readonly onSoporte: (input: { readonly consulta: string }) => Promise<SoporteResult>;
  readonly db: Database.Database;
  readonly ventasConfig: VentasConfig;
  readonly authConfig: AuthConfig;
  /** De `src/adapters/crypto/password.ts`. El núcleo lo recibe inyectado (ADR 30). */
  readonly verificarPassword: (password: string, hash: string) => boolean;
  readonly newId?: () => string;   // default: randomUUID
  readonly now?: () => string;     // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;
  /* Costuras de test — default: closures sobre `db` (§6.2). */
  readonly store?: VentaStorePort;
  readonly credenciales?: CredencialesEmpleadoPort;
  readonly registro?: RegistroAccionesEmpleadoPort;
}

/** Devuelve un `SubmitPromptHandler` — MISMO tipo, MISMA firma. I1 no cambia. */
export function buildOnComandoEmpleado(deps: BuildOnComandoEmpleadoDeps): SubmitPromptHandler;
```

**Estado del closure — exactamente dos ranuras** (ADR 31, 36), ambas privadas:

```ts
let sesion: SesionEmpleado | undefined;
let confirmacionPendiente: ConfirmacionPendiente | undefined;

interface ConfirmacionPendiente {
  readonly accion: AccionEscalacion;
  readonly ventaId: string;
  readonly casoId: string;
  readonly monto: number;
  /** ATADURA a la sesión (ADR 31 punto 5): el paso 2 re-verifica que coincida. */
  readonly empleadoId: string;
  readonly expiraEn: string;   // `ahora + CONFIRMACION_TTL_MINUTOS` (2, constante de módulo)
}
```

### 6.2 Puertos que arma

- `store` ← `createVentaStore(db)` (importado de `build-on-venta.ts`, ya exportado — ADR 41).
- `credenciales` ← `{ buscarCredencial: (id) => buscarCredencialEmpleado(db, id) }`, con el mapeo a `CredencialEmpleado` (descarta `createdAt`/`updatedAt`, que el núcleo no necesita).
- `registro` ← `{ registrarAccion: (a) => insertAccionEmpleado(db, a) }`.

### 6.3 Preámbulo, para TODO texto que entra

```
ahora = now()

1. if (sesion !== undefined && !sesionVigente(sesion, ahora)) {
     sesion = undefined; confirmacionPendiente = undefined;
     logEvent(COMANDO_LOG_CORRELATION_ID, "sesion-expirada", { empleadoId })
   }
2. if (confirmacionPendiente !== undefined && ahora >= confirmacionPendiente.expiraEn) {
     confirmacionPendiente = undefined     // silencioso: no es un hecho de negocio
   }
3. comando = parsearComando(texto)
4. if (comando === undefined) return onSubmit(texto, onAgentResolved)   // ★ byte por byte ★
5. logEvent(COMANDO_LOG_CORRELATION_ID, "comando-empleado-recibido", { tipo: comando.tipo })
      ★ SOLO `tipo`. NUNCA el texto original, NUNCA los argumentos (ADR 21 enmienda). ★
6. if (descriptor(comando).privilegiado && !sesionVigente(sesion, ahora)) {
     logEvent(..., "comando-privilegiado-sin-sesion", { tipo: comando.tipo })
     return sistema("Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>.")
   }   // ★ CERO escrituras: ni store, ni registro ★
7. ruteo (§6.4)
```

`sistema(texto)` es un helper de una línea: `{ responseText: texto, agentLabel: "sistema" }` (ADR 21 punto 4). `onAgentResolved` **no se invoca** para ningún comando determinista (ADR 21 punto 5): no hay agente que anunciar.

### 6.4 Los ocho comandos, paso a paso

**1. `/login <empleadoId> <password>`** — público, y el único con un argumento secreto.

```
a. confirmacionPendiente = undefined            ← SIEMPRE, exitoso o no (ADR 36)
b. r = resolverLogin({ empleadoId, password }, { store: credenciales, verificarPassword,
                                                now, ttlMinutos: authConfig.sesionTtlMinutos,
                                                logEvent })
c. r.resultado === "invalida"  → sesion = undefined
                                → sistema("Credenciales inválidas.")   ← mensaje GENÉRICO,
                                  idéntico para id inexistente y password incorrecta
                                → SIN fila de registro (ADR 33 punto 4)
d. r.resultado === "exitosa"   → sesion = r.sesion
                                → registrar({ comando: "/login", resultado: "exitosa" })
                                  con venta_id y caso_id en NULL
                                → sistema("Sesión abierta como <empleadoId>. Vence <expiraEn>.")
```

*Borde — `/login` con sesión ya abierta*: **reemplaza** (ADR 31 punto 1). *Borde — `/login` fallido con sesión abierta*: la sesión anterior **se cierra** (paso c pone `undefined`). Es deliberado: un intento de cambio de usuario no puede dejar la sesión del anterior viva mientras alguien tantea contraseñas.

**2. `/logout`** — público.

```
sesion === undefined  → sistema("No hay ninguna sesión abierta.")   ← sin efecto
si no                 → empleadoId = sesion.empleadoId
                        sesion = undefined; confirmacionPendiente = undefined
                        logEvent(..., "logout", { empleadoId })
                        → sistema("Sesión cerrada.")
NO deja fila de registro (ADR 27: no es una acción sobre el dominio).
```

**3. `/soporte <consulta>`** — público, **el único camino asíncrono y el único que toca el SDK**.

```
a. r = await onSoporte({ consulta })          ← el MISMO handler de POST /soporte,
                                                 sin modificarlo (ADR 21, capability
                                                 `soporte-web-turno` sin cambio de contrato)
b. éxito   → si hay sesión: registrar({ comando:"/soporte", casoId: r.casoId,
                                        resultado:"atendida" })   ← ventaId NULL
             si no:         logEvent(..., "accion-empleado-sin-sesion", { comando:"/soporte" })
           → { responseText: r.respuesta, agentLabel: "soporte" }
c. si `onSoporte` RECHAZA (propaga `TurnFailedError`, `build-on-soporte.ts:22-26`):
   se captura acá — la TUI no puede quedarse sin respuesta —
   si hay sesión: registrar({ resultado:"fallida", casoId: <si se conoce>, }) ;
   logEvent(..., "comando-soporte-fallido", { message })
   → sistema("No se pudo atender la consulta: <mensaje>")
```

*Nota*: `resultado: "fallida"` solo se puede escribir si el rechazo trae el `casoId`. Si el fallo fue **antes** de crear el caso (`createCaso` lanzó), no hay nada que correlacionar y **no se escribe fila** — se registra solo el evento. Se declara como el único punto donde `fallida` puede faltar.

**4. `/devolucion <token> [motivo]`** — público. `token_confirmacion` sigue siendo la credencial (ADR 19, 22).

```
a. r = procesarDevolucion({ token, motivo }, { store, config: ventasConfig, now, logEvent })
b. si hay sesión → registrar({ comando: "/devolucion",
                               ventaId: r.ventaId, casoId: r.casoId,   ← pueden ser undefined
                               resultado: r.resultado })               ← reembolsada|escalada|no_aplicable
   si no         → logEvent(..., "accion-empleado-sin-sesion", { comando: "/devolucion" })
c. respuesta por rama:
     reembolsada  → "Devolución procesada: la venta <ventaId> quedó reembolsada."
     escalada     → "Devolución escalada: la venta <ventaId> quedó en reembolso_pendiente,
                     pendiente de aprobación humana."
     no_aplicable → "No se pudo procesar esa devolución."
★ NI la respuesta, NI la fila, NI ningún evento contienen el token ni el motivo (ADR 27). ★
Con token inexistente: fila con venta_id/caso_id NULL y resultado no_aplicable — dice
"este empleado intentó una devolución que no aplicó" sin revelar qué se intentó.
```

**5-7. `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso [ventaId]`** — **privilegiados**. Un solo cuerpo, parametrizado por `accion` (el paso 6 del preámbulo ya garantizó sesión vigente):

```
a. ventaId === undefined  →  resolverEscalacionReembolso({ accion, confirmado:false, sesion }, deps)
                             → { resultado: "listado" }
                             → sistema(formatearListado(items))      ← una línea por venta,
                               MISMO formato de línea que el reporte mensual
                             → CERO escrituras. FIN.

b. ventaId presente. ¿Hay confirmación pendiente que matchee?
     matchea  ⟺  confirmacionPendiente !== undefined
              &&  .ventaId === ventaId
              &&  .accion  === accion
              &&  .empleadoId === sesion.empleadoId     ← ATADURA (ADR 31 punto 5)
     (la vigencia de la ranura y de la sesión ya se purgaron en el preámbulo)

c. NO matchea → r = resolver...({ accion, ventaId, confirmado:false, sesion }, deps)
     r = no_aplicable("no_encontrada")
        → sistema("No hay ninguna venta <ventaId> en estado <origen>.")
        → SIN fila (no hay casoId que correlacionar)
     r = requiere_confirmacion
        → confirmacionPendiente = { accion, ventaId, casoId, monto,
                                    empleadoId: sesion.empleadoId,
                                    expiraEn: ahora + 2 min }
        → sistema(eco)   ← ★ NI el store NI el registro reciben una escritura ★
             aprobar/rechazar: "venta <id> · cliente <clienteId> · monto <monto> · caso <casoId>
                                — repetí el comando para confirmar."
             reabrir (ADR 29 punto 2): + "rechazada por <rechazadaPor> el <rechazadaAt>
                                          · reaperturas previas: <n>"

d. SÍ matchea → confirmacionPendiente = undefined       ← se CONSUME antes de ejecutar
                r = resolver...({ accion, ventaId, confirmado:true, sesion }, deps)
     r = aplicada
        → (la fila ya se escribió DENTRO de la transacción — ADR 27)
        → sistema("Listo: la venta <ventaId> quedó en <estadoFinal> y el caso <casoId> en <estadoCaso>.")
     r = no_aplicable("cas")
        → registrar({ comando, ventaId, casoId, resultado: "no_aplicable" })   ← FUERA de la
          transacción, porque no hubo transacción que la contenga
        → sistema("Esa venta ya no está en <origen>: no se aplicó nada.")
     r = no_aplicable("no_encontrada")   ← la venta cambió de estado entre el paso 1 y el 2
        → mismo texto, sin fila
```

**Bordes cubiertos y su comportamiento exacto:**

| Borde | Resultado |
|---|---|
| Privilegiado sin sesión | Paso 6 del preámbulo: mensaje, evento `comando-privilegiado-sin-sesion`, **cero escrituras** |
| Confirmación preparada por A, confirmada por B (B hizo `/login` en el medio) | El `/login` de B ya limpió la ranura (§6.4-1a) ⇒ el comando de B es un **primer** paso: eco nuevo, sin ejecutar |
| Sesión vence entre paso 1 y paso 2 | Preámbulo 1: sesión y ranura a `undefined` ⇒ el paso 2 cae en "privilegiado sin sesión". **No ejecuta** |
| Ranura vencida (2 min) con sesión viva | Preámbulo 2 la limpia ⇒ el comando vuelve a ser un primer paso: **eco, no ejecución** |
| `/logout` entre paso 1 y paso 2 | Ranura limpiada ⇒ "privilegiado sin sesión" |
| Confirmación de la venta A, después preparo la B, después confirmo la A | La ranura ya es de la B ⇒ la A no matchea ⇒ **eco de la A otra vez**, sin ejecutar (ADR 36) |
| CAS que no matchea (otra TUI llegó primero, o doble aprobación) | `no_aplicable`, **sin excepción**, sin segunda escritura en `ventas`, con fila `no_aplicable` |
| `/reabrir-reembolso` sobre una venta `reembolsada` | No aparece en `listarReembolsosRechazados` ⇒ `no_aplicable("no_encontrada")`, **sin código especial** (ADR 29) |
| `accion` distinta con el mismo `ventaId` (preparé aprobar, escribo rechazar) | No matchea (`.accion !== accion`) ⇒ eco del rechazo, **no ejecuta la aprobación** |

**8. `/ayuda` (y todo lo malformado)** — público.

```
motivo "solicitada"   → sistema(formatearAyuda())
motivo "desconocido"  → logEvent(..., "comando-desconocido", { comando })   ← SOLO el primer
                        token, jamás el resto de la línea (ADR 21 enmienda, ADR 34)
                      → sistema("No conozco <comando>.\n" + formatearAyuda())
motivo "argumentos"   → sistema("Uso: <descriptor.uso>\n" + descriptor.ayuda)
En los tres: CERO efecto, CERO fila de registro (ADR 27).
```

### 6.5 Helper de registro — el único punto donde el dispatcher escribe fuera de una transacción

```ts
function registrar(input: Omit<AccionEmpleado, "id" | "empleadoId" | "ocurridoAt">): void {
  if (!sesionVigente(sesion, ahora)) return;          // ADR 28/32: sin sesión, sin fila
  try {
    registro.registrarAccion({ ...input, id: newId(), empleadoId: sesion.empleadoId, ocurridoAt: ahora });
    logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-registrada", { comando: input.comando, resultado: input.resultado });
  } catch (error) {
    // ADR 40: la fila no transaccional NO puede tumbar un comando que ya tuvo efecto.
    logEvent(COMANDO_LOG_CORRELATION_ID, "accion-empleado-registro-fallido",
             { comando: input.comando, message: toErrorMessage(error) });
  }
}
```

**Invariante estructural (ADR 27 enmienda, ADR 37)**: `empleadoId` sale **exclusivamente** de `sesion.empleadoId`, y `sesion` solo la escribe la rama exitosa de `resolverLogin`. **No hay ninguna función en el change que acepte un `empleadoId` provisto por el usuario** — verificable leyendo tres firmas.

---

## 7. Entrypoint de provisioning — `src/empleados.ts` (nuevo, ADR 33)

Molde **exacto** de `src/reporte-mensual.ts` (verificado línea por línea): parte pura testeada directo, `openDatabase("data/harness.db")` (misma función y mismo path que `main.ts`, corre las migraciones si faltan), `db.close()` en un `finally`, guard `isMainModule`, `stdout` legítimo por ser un proceso sin TUI montada.

```ts
export type ParseArgsEmpleadoResult =
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "alta" | "rotar" }
  | { readonly ok: false; readonly mensaje: string };

/** ID_REGEX: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
 *  Guarda de forma, no de política: este string va a ser la columna de actor de
 *  cada fila de auditoría y se imprime en el eco de `/login`. Un id con espacios
 *  o saltos de línea rompería el parseo posicional de `/login` (§3.1) y haría
 *  ilegible el registro. NO es una política de nombres. */
export function parseArgsEmpleado(argv: readonly string[]): ParseArgsEmpleadoResult;
```

Reglas de `parseArgsEmpleado` (**PURA**: recibe `argv`, no lo lee):
1. Primer argumento posicional que no empiece con `--` → `empleadoId`. Ausente → `ok:false` con el uso.
2. No matchea `ID_REGEX` → `ok:false` con el uso y el motivo.
3. `--rotar` presente en cualquier posición → `modo: "rotar"`; si no → `"alta"`.
4. Flag desconocida (`--` seguido de otra cosa) → `ok:false`. Una flag mal escrita en un comando que **crea credenciales** no puede caer en silencio al modo por defecto.

**`main()` — secuencia exacta:**

```
1. parsed = parseArgsEmpleado(process.argv.slice(2))
   !ok → stderr(mensaje); exit(1)
2. password = await leerPasswordDeStdin()
     · `node:readline` sobre `process.stdin`, UNA línea, cero dependencias.
     · El prompt va a **stderr**, no a stdout: así `echo "$PASS" | npm run empleados:crear -- ana`
       y una redirección de stdout siguen siendo limpias.
     · Vacía o solo espacios → stderr("La contraseña no puede estar vacía"); exit(1)
     · ★ NUNCA por `argv` (ADR 33 punto 2): `argv` queda en el historial del shell y en la
       tabla de procesos, visible para cualquier `ps` mientras el proceso viva. ★
     · Residual declarado: la línea tipeada SE VE en la terminal (R14, aceptado por el
       checkpoint) — apagar el eco pide modo raw y no vale la pena acá.
3. hash = hashPassword(password)          ← adaptador de crypto (§4)
4. db = openDatabase("data/harness.db")   ← corre 0005 y 0006 si faltan
5. try {
     ahora = new Date().toISOString()
     modo "alta"  → insertCredencialEmpleado(db, { empleadoId, passwordHash: hash, ahora })
                    catch CredencialEmpleadoDuplicadaError → stderr("Ya existe...") ; exit(1)
                    ★ NO pisa el hash existente (ADR 33 punto 1) ★
                    stdout("Empleado <id> creado.")
     modo "rotar" → r = updateCredencialEmpleado(db, {...})
                    undefined → stderr("No existe el empleado <id>.") ; exit(1)
                    stdout("Contraseña de <id> rotada.")   ← created_at intacto, updated_at nuevo
   } finally { db.close() }
```

**Ningún mensaje de este proceso imprime la contraseña ni el hash.** El hash es un secreto derivado; imprimirlo en stdout lo mandaría a los logs de cualquier CI que corra el comando.

`package.json` gana **una sola línea**: `"empleados:crear": "tsx src/empleados.ts"`. `dependencies` y `devDependencies` quedan **idénticas** (verificado: `engines.node >= 20`, sin ninguna dependencia de hashing).

---

## 8. Wiring en `main.ts` — qué cambia exactamente y en qué orden

Cinco cambios, ninguno reordena el arranque existente. El paso 5b (adaptador web) **queda donde está** y `startWebServer` sigue recibiendo exactamente lo mismo.

**(1) En `startHarness()`, junto a `resolveVentasConfig` (`:150-156`)** — misma clase "aborta", mismo formato de error:

```ts
const authConfigResult = resolveAuthConfig(process.env);
if (!authConfigResult.ok) {
  throw new HarnessBootstrapError(
    `Configuración de autenticación inválida:\n  - ${authConfigResult.errores.join("\n  - ")}`,
  );
}
const authConfig = authConfigResult.config;
```

`StartupResult` gana `readonly authConfig: AuthConfig` y la desestructuración de `:215` gana `authConfig`. Motivo de ponerlo acá y no más abajo: la validación de configuración es un paso de arranque, no un fallback en runtime — argumento textual del ADR 17 de Hito 4, ya aplicado a `ventasConfig`.

**(2) `onSubmit` (`:232`) NO cambia.** Sigue siendo `buildOnSubmit(caso.id, memory, hooks, agents, undefined, createKnowledge(caso.id))`. El camino conversacional de Hito 1 no se toca.

**(3) `onSoporte` (`:315`) se MUEVE hacia arriba**, del bloque 5b al final del bloque 5b pero **antes** del punto (4). Hoy ya se arma una sola vez y se pasa a `startWebServer`; ahora **se comparte**: la misma constante alimenta al servidor web y al dispatcher. `buildOnSoporte` no se modifica y `createKnowledge` no se duplica (Success Criteria de la propuesta).

**(4) Nuevo bloque 5c, entre el bloque web y el mount de la TUI:**

```ts
const onComandoEmpleado = buildOnComandoEmpleado({
  onSubmit,
  onSoporte,
  db,
  ventasConfig,
  authConfig,
  verificarPassword,          // ← import de "./adapters/crypto/password.js"
});
```

Es el **único** import nuevo de un adaptador en `main.ts`, y es el movimiento que el ADR 30 describe: el núcleo no importa el adaptador, el composition root los une — igual que hoy inyecta `randomUUID` como `newId` en `buildOnVenta`.

**(5) El mount (`:341`) cambia una palabra:**

```ts
const tui = startTui(onComandoEmpleado);     // era: startTui(onSubmit)
```

`startTui` sigue recibiendo un `SubmitPromptHandler`. **Cero cambios en `tui-port.ts` (salvo el comentario del ADR 21), `App.tsx` y `start-tui.tsx`.** El `finally` de cierre (`:343-385`) **no cambia**: el dispatcher no abre ningún recurso propio — sus dos ranuras mueren con el proceso (ADR 31 punto 4, R8).

**Rollback en caliente** (Rollback Plan de la propuesta): revertir el punto (5) a `startTui(onSubmit)` es **una línea**, y sin el envoltorio ningún comando existe —tampoco `/login`— y la TUI se comporta exactamente como en `v1.3.0`.

---

## 9. Logging — trece eventos nuevos, cero cambios de contrato

`logTurnEvent(casoId, event, fields?)` (`turn-logger.ts:212-218`) no cambia. Solo se amplía su module doc con la lista, mismo criterio que Hitos 2, 3 y 4.

| Evento | Correlación | Campos | Emisor |
|---|---|---|---|
| `comando-empleado-recibido` | `tui-comando` | `tipo` | dispatcher §6.3-5 |
| `comando-desconocido` | `tui-comando` | `comando` (**solo el primer token**) | dispatcher §6.4-8 |
| `login-exitoso` | `auth` | `empleadoId`, `expiraEn` | `resolverLogin` |
| `login-fallido` | `auth` | `empleadoId`, `motivo` (`inexistente`\|`password`) | `resolverLogin` |
| `logout` | `tui-comando` | `empleadoId` | dispatcher |
| `sesion-expirada` | `tui-comando` | `empleadoId` | dispatcher §6.3-1 |
| `comando-privilegiado-sin-sesion` | `tui-comando` | `tipo` | dispatcher §6.3-6 |
| `accion-empleado-sin-sesion` | `tui-comando` | `comando` | dispatcher §6.4-3/4 |
| `accion-empleado-registrada` | `tui-comando` | `comando`, `resultado` | helper §6.5 |
| `accion-empleado-registro-fallido` | `tui-comando` | `comando`, `message` | helper §6.5 (ADR 40) |
| `reembolso-listado` | `tui-comando` | `accion`, `cantidad` | caso de uso §3.7-B |
| `reembolso-resolucion-solicitada` | `casoId` de la venta | `accion`, `ventaId`, `monto` | caso de uso §3.7-D |
| `reembolso-escalacion-aprobada` / `-rechazada` / `-reabierta` | `casoId` de la venta | `ventaId`, `monto`, `empleadoId` | caso de uso §3.7-E |
| `reembolso-resolucion-no-aplicable` | `casoId` o `tui-comando` | `accion`, `ventaId`, `motivo` | caso de uso §3.7-C/E |
| `comando-soporte-fallido` | `tui-comando` | `message` | dispatcher §6.4-3c |

**★ Invariante negativo, con test propio: ningún evento de esta tabla lleva la contraseña, ni un prefijo, ni su longitud, ni el `token_confirmacion`, ni el texto de una consulta de soporte, ni el motivo del cliente. ★** El único campo que se le parece es `empleadoId`, que es un identificador, no un secreto.

---

## 10. Plan de testing — TDD estricto (`strict_tdd: true`)

Regla, sin excepciones para este change: **el test se escribe antes que la implementación** (red → green → refactor), y **ningún test llama al modelo, abre un puerto ni deriva una clave scrypt real fuera de §10.3**.

### 10.1 Puro, sin base de datos, sin scrypt (`vi.fn()` y relojes fijos)

Molde: `procesar-devolucion.test.ts` (`makeStore` con `vi.fn()` completo, `now` fijo, test explícito de sincronía).

| Archivo de test | Casos obligatorios |
|---|---|
| `core/commands/comando-empleado.test.ts` | Texto sin `/` → `undefined` (incluido `"hola"`, `""`, `"  hola"`). Los ocho tipos parseados con argumentos típicos. `/soporte` con consulta multi-palabra. `/devolucion tok` sin motivo → `motivo` **ausente** (no `""`). `/devolucion tok se rompió todo` → motivo = resto entero. `/aprobar-reembolso` sin id → `ventaId` ausente. Comando desconocido → `ayuda/desconocido` y **`comando` es solo el primer token**. `/login ana` (falta password) → `ayuda/argumentos`. **`/login ana mi pass larga` → password `"mi pass larga"`** (ADR 34). **`/login ana  pass  ` → password `"pass"`** (límite del `trim`, R4). **★ Test de fuga: para `"/logni ana secreto"`, `JSON.stringify(resultado)` NO contiene `"secreto"` ★**. `formatearAyuda` lista los ocho. |
| `core/auth/sesion.test.ts` | `undefined` → `false`. `expiraEn` ausente → `true` con cualquier `ahora`. `T+29m` → `true`, `T+31m` → `false`, **`ahora === expiraEn` → `false`**. `calcularExpiraEn(t, 0)` → `undefined`; `calcularExpiraEn(t, 30)` → ISO exacto. |
| `core/auth/auth-config.test.ts` | Ausente → 30. `""` → 30. `"0"` → 0 (sin expiración). `"45"` → 45. `"abc"`, `"-1"`, `"1.5"` → `ok:false` con el nombre de la variable y el valor. **No lanza nunca.** |
| `core/auth/login.test.ts` | `buscarCredencial` → `undefined` ⇒ `invalida`, **`verificarPassword` NO se llamó**. `verificarPassword` mockeado a `false` ⇒ `invalida`, sin sesión. A `true` ⇒ `exitosa` con `expiraEn` derivado del `now` fijo y del `ttlMinutos`. `ttlMinutos: 0` ⇒ sesión sin `expiraEn`. **★ La contraseña llega a `verificarPassword` y a ningún otro lado: se inspeccionan TODAS las llamadas a `logEvent` ★**. **Test de sincronía**: el resultado es un valor, no una promesa. |
| `core/ventas/resolver-escalacion-reembolso.test.ts` | Sin `ventaId` ⇒ `listado`, y **ningún método de escritura del store fue llamado** (`expect(store.aprobar...).not.toHaveBeenCalled()`). Con `ventaId` inexistente ⇒ `no_aplicable/no_encontrada`. `confirmado:false` ⇒ `requiere_confirmacion` y **cero escrituras**. `confirmado:true` ⇒ el método CAS **correcto** por acción, con `{ventaId, casoId, empleadoId, accionId, ahora}` exactos. CAS → `undefined` ⇒ `no_aplicable/cas`. Reabrir usa `listarReembolsosRechazados` y **nunca** `listarReembolsosPendientes`. **Test de sincronía.** |
| `core/ventas/procesar-devolucion.test.ts` (**existente, se amplía**) | Los tests actuales **siguen pasando sin cambios de comportamiento**. Nuevos: cada rama devuelve los `ventaId`/`casoId` esperados, y la rama de token inexistente los devuelve **ausentes**. |
| `core/ventas/reporte.test.ts` (**existente, se toca**) | La nota nueva no dice "SQL manual", no describe el rechazo como irreversible y **no dice que la identidad se toma de la configuración** (ADR 26 enmienda rev. 3). Caso borde: una venta `reembolso_rechazado` **no** suma a `ventasConReembolso` (ADR 23). |
| `empleados.test.ts` (solo `parseArgsEmpleado`) | `["ana"]` → alta. `["ana","--rotar"]` → rotar. `["--rotar","ana"]` → rotar (orden libre). `[]` → uso. `["--rotar"]` → uso. `["ana bad"]`, `["--ana"]`, `["ana","--rotr"]` → uso. **Importar el módulo NO abre la base** (guard `isMainModule`). |

### 10.2 Dispatcher, con dobles (sin base, sin SDK, sin scrypt)

`build-on-comando-empleado.test.ts` — el archivo más grande del change:

- **★ Delegación intacta ★**: `"hola"` llega a `onSubmit` con el string **idéntico** y con el mismo `onAgentResolved`; el resultado se devuelve **sin tocar**. Un `onSubmit` espía verifica argumento por argumento.
- `/ayuda`, comando desconocido y argumentos faltantes: `agentLabel === "sistema"`, **cero** llamadas al store, a `registrarAccion` y a `onSoporte`.
- **Sin sesión**: los tres privilegiados responden pidiendo `/login`, con `comando-privilegiado-sin-sesion` y **cero escrituras**; `/soporte` y `/devolucion` **funcionan igual** y **no dejan fila**, con `accion-empleado-sin-sesion`.
- **Con sesión**: `/soporte` y `/devolucion` dejan fila con el `empleado_id` **de la sesión**.
- **`/login`**: exitoso deja fila `('/login','exitosa')` con `venta_id`/`caso_id` en `NULL`; fallido **no** deja fila y responde el **mismo** mensaje que un id inexistente.
- **★ Fuga de secretos ★**: tras un `/login` exitoso y uno fallido, `JSON.stringify` de **todas** las filas escritas y de **todos** los eventos emitidos **no contiene** la contraseña, ni un prefijo de 3 caracteres, ni su longitud. Ídem con el `token_confirmacion` tras un `/devolucion`.
- **Dos pasos**: primer `/aprobar-reembolso v-1` ⇒ eco con el monto y **cero escrituras** (`vi.fn()` verificado); segundo ⇒ ejecuta **una** vez.
- **La confirmación no sobrevive** a: `/logout`, `/login` de otro empleado, `/login` fallido, expiración de la sesión (reloj avanzado), expiración propia (2 min), y **su propia ejecución** (un tercer comando idéntico vuelve a pedir confirmación).
- **Confirmación cruzada**: preparo `v-1`, preparo `v-2`, confirmo `v-1` ⇒ **eco**, no ejecución.
- **Acción cruzada**: preparo aprobar `v-1`, escribo rechazar `v-1` ⇒ eco del rechazo, la aprobación **no** ocurre.
- **ADR 40**: con un `registrarAccion` que lanza, `/devolucion` **igual responde su resultado normal** y se emite `accion-empleado-registro-fallido`.
- **Ningún test de este archivo llama al modelo**: `onSoporte` es un doble.

### 10.3 Contra scrypt real (único lugar donde se deriva una clave)

`adapters/crypto/password.test.ts`:

- Ida y vuelta: `verificarPassword(p, hashPassword(p))` → `true`.
- Contraseña equivocada → `false`.
- **Dos hashes de la misma contraseña son distintos** (salt por fila) y **ambos validan**.
- Formato: seis campos, `scrypt`, `N/r/p` = los constantes, salt de 16 B y clave de 32 B tras decodificar base64.
- Hash corrupto: `""`, `"scrypt$1$2$3"` (pocos campos), algoritmo `"bcrypt$..."`, `N` no numérico, **`N` enorme (guarda de `maxmem`)**, base64 basura, clave vacía, clave truncada un byte → **`false` en todos, sin lanzar**.
- Contraseña vacía y contraseña de 1 KB → no lanzan.
- Es el **único** archivo de test que paga el costo del KDF, y son ~10 derivaciones.

### 10.4 Contra SQLite en memoria (`new Database(":memory:")` + `runMigrations`)

`adapters/memory/repository.test.ts` (existente, se amplía) — molde de los tests de CAS de Hito 4:

- **Migraciones**: tras `runMigrations`, `registro_acciones_empleado` y `credenciales_empleado` existen con las columnas exactas; correr las migraciones **dos veces** es idempotente.
- **Atomicidad de los tres CAS**: sobre una venta `reembolso_pendiente`, `aprobarEscalacionReembolso` deja venta `reembolsada` + caso `resuelto` + **una** fila, en una sola transacción. Con un `casoId` inexistente, `updateCaso` lanza `CasoNotFoundError` y **la venta NO cambió de estado y NO hay fila** (la transacción revirtió).
- **CAS que no matchea**: sobre una venta `confirmada`, los tres devuelven `undefined` y **no escriben nada** — ni caso, ni fila.
- **Reapertura**: `reembolso_rechazado → reembolso_pendiente`, caso de vuelta a `pendiente_aprobacion_humana` **con el mismo `caso_id`**, y la venta vuelve a aparecer en `listEscalacionesReembolso({estado:'reembolso_pendiente'})`.
- **`reembolsada` es terminal**: `reabrirEscalacionReembolso` sobre ella → `undefined`, sin fila.
- **Doble aprobación**: la segunda → `undefined`, sin segunda fila de registro **desde el CAS** (la fila `no_aplicable` la escribe el dispatcher, no esta capa).
- **Listado**: orden por `rechazada_at DESC` para rechazados y `confirmed_at ASC` para pendientes; `limite` respetado; **filtro por `ventaId` encuentra la fila 21 de 25** (el bug que el ADR 38 cierra); `reaperturasPrevias` cuenta exactamente las filas `reabierta`; `rechazadaPor`/`rechazadaAt` son los del **último** rechazo.
- **Credenciales**: alta → fila con `created_at === updated_at`; alta repetida → `CredencialEmpleadoDuplicadaError` y **el hash previo intacto**; rotación → `password_hash` y `updated_at` nuevos, `created_at` **intacto**; rotación de un id inexistente → `undefined`.
- **★ Ninguna fila de `registro_acciones_empleado` contiene un `token_confirmacion`, una contraseña, el texto de una consulta ni un motivo de cliente ★** — test explícito sobre el ciclo completo, no implícito.
- **Ciclo end-to-end de auditoría**: `escalada → rechazada por ana → reabierta por beto → aprobada por ana` deja **cuatro** filas legibles en orden por `ocurrido_at`, con los `empleado_id` correctos, y la venta termina en `reembolsada`.

### 10.5 Lo que NO se testea, y por qué

- `src/main.ts`: ningún test lo importa (su propio module doc lo explica — dispararía `bootstrapHarness`/`openDatabase` reales). Su wiring se verifica **manualmente**, end-to-end, en el entregable del change.
- El I/O de `src/empleados.ts` (`stdin`, `openDatabase`): solo `parseArgsEmpleado` se testea, **exactamente** como `reporte-mensual.test.ts` hace con `parsePeriodo`. El resto es la verificación manual del entregable.
- La TUI real (`App.tsx`, `start-tui.tsx`): **no se tocan**, así que sus tests existentes son la garantía de no-regresión.

---

## 11. Orden de implementación recomendado para `sdd-tasks`

Análisis de dependencias **reales** (no del orden en que la propuesta enumera las piezas). El orden que el encargo anticipaba es casi correcto; **tres correcciones**, con su motivo:

> **(a) El adaptador de crypto va PRIMERO, no después de los casos de uso.** No depende de ningún contrato: `verificarPassword` se inyecta por su **forma estructural** `(string, string) => boolean`, no por un tipo importado. Es el archivo con más bordes por cubrir y el único que paga scrypt real; tenerlo verde temprano quita riesgo del camino crítico.
>
> **(b) El entrypoint de provisioning va ANTES del dispatcher, no al final.** No depende del dispatcher en absoluto (depende de crypto + repository + migraciones), y **sin él no hay ninguna credencial en la base**, así que el dispatcher no se puede demostrar end-to-end. Ponerlo último obliga a fabricar una credencial a mano para probar `/login` — exactamente el `SQL manual` que este change existe para eliminar.
>
> **(c) La nota del reporte (`NOTA_ESCALACION_FUERA_DE_BANDA`) va ÚLTIMA, no en el medio.** Es la única pieza cuya corrección depende de que las **otras** ya existan: mergeada antes que los comandos, el reporte mentiría en la dirección opuesta (prometería una vía de producto que todavía no está). El ADR 26 pide que la nota sea verdadera **el día del merge**, no antes.

**Fase 1 — Cimientos sin dependencias** (cuatro tareas en paralelo real):
1. `migrations/0005_registro_acciones_empleado.ts` + append en `index.ts`.
2. `migrations/0006_credenciales_empleado.ts` + append en `index.ts`.
3. `src/adapters/crypto/password.ts` **(a)**.
4. `src/core/commands/comando-empleado.ts` (parser + descriptores).

**Fase 2 — Contratos de puerto y vocabulario** (dependen solo de tipos):
5. `src/core/commands/registro-acciones-contract.ts`.
6. `src/core/auth/credenciales-contract.ts` + `sesion.ts` + `auth-config.ts`.
7. `src/core/ventas/ventas-contract.ts`: sexto estado, `CASO_ESTADO_RESUELTO`, `EscalacionListada`, `ResolucionEscalacionInput`, los cinco métodos de puerto. **Bloquea 8, 10 y 11.**

**Fase 3 — Casos de uso puros** (dependen de la fase 2, no del adaptador):
8. `src/core/auth/login.ts`.
9. `src/core/ventas/procesar-devolucion.ts` — solo el retorno.
10. `src/core/ventas/resolver-escalacion-reembolso.ts`.

**Fase 4 — Adaptador de memoria** (depende de las migraciones y de nada del núcleo):
11. `repository.ts`: `listEscalacionesReembolso`, `insertAccionEmpleado` (+ el lector de test), los tres CAS transaccionales, las tres de credenciales.

**Fase 5 — Provisioning, ya demostrable** **(b)**:
12. `src/empleados.ts` + script en `package.json`. **Primer entregable verificable del change**: se crea un empleado y se comprueba que el hash no es la contraseña.

**Fase 6 — Store y dispatcher**:
13. `build-on-venta.ts`: ampliar `createVentaStore` con los cinco closures (**ADR 41 — corrección a la tabla de archivos de la propuesta, que no lo listaba**). `buildOnVenta` no cambia.
14. `src/build-on-comando-empleado.ts`, el archivo más grande. Depende de **todo** lo anterior menos 12.

**Fase 7 — Wiring y cierre**:
15. `src/main.ts`: los cinco cambios de §8.
16. `tui-port.ts` (comentario del ensanche de `agentLabel`) + `turn-logger.ts` (module doc con los eventos) + `core/config/env.ts` (module doc: `SESION_TTL_MINUTOS`; **`EMPLEADO_ID` no aparece**).
17. `reporte.ts` + `reporte.test.ts`: la nota nueva y el caso borde de `ventasConReembolso` **(c)**.

**Nota para el forecast de carga de revisión de `sdd-tasks`**: son ~17 unidades de trabajo sobre ~20 archivos, muy por encima de las 400 líneas de un PR. El corte natural, si se encadenan PRs, es **Fase 1-5 (autenticación y provisioning) / Fase 6-7 (comandos y cierre de R3)** — el mismo orden que R9 punto 14 de la propuesta ya anticipaba ("si se parte, el orden es autenticación primero: los comandos privilegiados no pueden shippear sin ella"). El checkpoint decidió **no** partir el change en dos entregas de versión; eso no impide partir la **revisión** en dos PRs encadenados sobre la misma rama.

---

## 12. Correcciones a la propuesta que este diseño introduce

Se listan explícitamente para que el checkpoint y el Reviewer no las descubran leyendo el diff:

| # | Qué dice la propuesta | Qué corrige este diseño | Por qué |
|---|---|---|---|
| 1 | La tabla de archivos **no lista** `src/build-on-venta.ts` | **Sí se modifica**: `createVentaStore` gana los cinco closures | Es la única implementación de `VentaStorePort`; sin ampliarla el proyecto no compila. `buildOnVenta` y los handlers web no cambian (ADR 41) |
| 2 | "se busca la venta en ese mismo listado (sin método nuevo de lectura por id)" | `listEscalacionesReembolso` acepta un **filtro opcional por `ventaId`** | Con el listado acotado a 20, la venta 21 sería inencontrable por id. No es un `buscarVentaPorId`: `estado` es obligatorio y solo admite los dos estados de escalación (ADR 38) |
| 3 | R4: "una contraseña con espacios no se puede tipear" **y** "el parser toma el resto de línea como contraseña" | Espacios **internos** sí; espacios en los **bordes** no (`trim`) | Las dos frases se contradecían; se elige la lectura que hace el comando usable y se testea el límite exacto (ADR 34) |
| 4 | El ADR 27 no dice qué pasa si la escritura no transaccional falla | Contrato explícito: el dispatcher la envuelve y degrada a evento | R10 acepta el efecto sin fila; no acepta mentirle al operador sobre si el efecto ocurrió (ADR 40) |
| 5 | "parámetros serios" de scrypt | `N=16384, r=8, p=1, clave 32 B, salt 16 B` + guarda de `maxmem` al verificar | Un formato que lee sus parámetros del propio hash es un vector de DoS para R16 si no se validan (ADR 35) |

**Descubrimiento adicional, sin efecto en el diseño**: `getVentaById` **ya existe** en `repository.ts:835` (Hito 4, para la página pública de confirmación). No se usa, no se expone en ningún puerto de este change y no cambia el argumento del ADR 22 — que es sobre qué credencial autoriza el camino de devolución, no sobre qué funciones existen en el adaptador. Se anota para que nadie lo lea como una contradicción con la frase "no hay `buscarVentaPorId` en ninguna parte de este change".

---

## 13. Riesgos y preguntas abiertas

**Riesgos que este diseño introduce o precisa** (los R1-R16 de la propuesta siguen vigentes tal como están):

- **El dispatcher es el archivo más grande del change** y concentra el estado mutable, el ruteo de ocho comandos y la regla de identidad. Mitigación: las dos ranuras son privadas, el orden de evaluación es fijo y explícito (§6.3), y la tabla de bordes de §6.4 se traduce 1:1 a tests.
- **`/soporte` es el único comando asíncrono**, y su fallo puede ocurrir antes de que exista un `casoId`. En ese caso no se escribe fila (§6.4-3c). Es el único hueco de auditoría **nuevo** que este diseño agrega a R10, y es minúsculo: solo cubre el fallo de `createCaso`.
- **Dos lectores de `ventas` en `reembolso_pendiente` con SQL parecido** (`listVentasEnReembolsoPendiente` del reporte y `listEscalacionesReembolso`). Deliberado (ADR 38), pero es el tipo de duplicación que hay que revisar si mañana aparece un tercer lector.

**Preguntas abiertas**: ninguna bloqueante. El checkpoint humano ya resolvió las tres que la propuesta dejaba abiertas (R14 → se acepta el eco; R9 → un solo change `v1.4.0`; R1/R12/R16 → residual aceptado). Las cinco correcciones de §12 son de nivel diseño y **no reabren ningún ADR**: no cambian el alcance, el esquema, la clasificación público/privilegiado ni el modelo de identidad. Se declaran para revisión, no para decisión.
