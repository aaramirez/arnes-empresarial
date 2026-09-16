# Diseño técnico: Aprobación conversacional HITL — ejecutar el ADR 151 y cerrar R7

**Change**: `aprobacion-conversacional-hitl` · **Propuesta**: `openspec/changes/aprobacion-conversacional-hitl/proposal.md` (ADR 206-211, R1-R11, RD-98 a RD-104).

**Numeración verificada en esta fase** (`Grep`/`Read` sobre `openspec/`, `src/`, `docs/`): el techo real que la propuesta fijó es **ADR 211** y **RD-104**; el único archivo del repo que menciona `ADR 206`-`ADR 211` es la propia propuesta. Este diseño abre en **ADR 212** y en **R12** (la propuesta cerró en **R11**). No se abren RD nuevas: las seis que quedaban (**RD-98, 99, 100, 101, 103, 104**) se resuelven acá con mecanismo.

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo. Misma nota que ya dejaron escrita `operaciones-negocio-conversacionales`, `autorizacion-empleado`, `chat-web-empleado` y la propia propuesta de este change. **Toda afirmación de abajo está verificada por `Read`/`Grep` con archivo:línea, contra el árbol de `hito/v3.9-chat-web-empleado` — o sea, con v3.9 YA presente** (ver §0.2, que es lo que cambia el diseño respecto de lo que la propuesta pudo ver).

---

## 0. Correcciones al encargo y a la notación de la propuesta

Tres cosas hay que decir antes de diseñar nada, porque una lectura literal de la propuesta produciría una regresión de seguridad, otra apunta a un archivo que no existe, y la tercera es alcance que la propuesta no vio.

### 0.1 ★ `confirmado` **NO es un campo del schema de las dos operaciones nuevas**

La propuesta escribe, tres veces, `resolver_reembolso { ventaId?, accion, confirmado }` y `resolver_solicitud { solicitudId?, accion, confirmado }` (`proposal.md:120`, ADR 206 pto 1, `:201`). **Leído literal, eso viola un invariante vigente y explícito del repo**:

- `operaciones-contract.ts:118-123`: *"El schema de la tool **NUNCA** tiene un campo `confirmado` — es **inexpresable por el modelo, en cualquier operación** (mismo criterio 'inexpresable, no testeado' que `definicion-skills` ADR 108 y `autorizacion-empleado` ADR 159). `confirmado` lo decide **EXCLUSIVAMENTE** el composition root, comparando contra el estado de este puerto."*
- `validar-operacion.ts:18-21`: *"`empleadoId`/`vendedorId`/`solicitanteId`/`sesion`/`confirmado` **NUNCA** aparecen en ninguna fila de `CAMPOS_POR_OPERACION`"*.
- Verificado en el código: `CAMPOS_POR_OPERACION["cancelar_solicitud_interna"] = ["operacion", "solicitudId"]` (`:29`) — la operación con confirmación en dos pasos **no tiene** `confirmado` en su whitelist, y el objeto zod plano (`adapters/operaciones/index.ts:67-82`) tampoco lo declara.

**Cómo se lee entonces la notación de la propuesta, que es lo que quiso decir**: `{ ventaId?, accion, confirmado }` describe el **input de la función pura** `resolverEscalacionReembolso` (`resolver-escalacion-reembolso.ts:119-124`, que sí tiene `confirmado: boolean`), **no** el schema de la tool. El `confirmado` lo calcula el dispatcher desde `ConfirmacionOperacionPort.estaConfirmada(...)`, exactamente como `ejecutarCancelarSolicitud` ya lo hace (`ejecutar-operacion.ts:253`).

**Este diseño fija**: el schema de `resolver_reembolso` es `{ operacion, accion, ventaId? }` y el de `resolver_solicitud` es `{ operacion, accion, solicitudId? }`. **Cero campos `confirmado`.** El requirement vigente `herramienta-operaciones-negocio/spec.md:47-54` (*"La única operación con `confirmado: boolean` es `cancelar_solicitud_interna`"* ⇒ *"pasan a ser tres"*) se lee sobre **el parámetro de la función pura y el flujo de dos pasos**, no sobre un campo de schema que hoy no existe en ninguna operación. **Instrucción para `sdd-spec`: redactar ese delta explícitamente sobre "el mecanismo de confirmación en dos pasos", nunca sobre "un campo `confirmado` en el schema"** — si el delta queda ambiguo, un `apply` apurado agrega el campo y derriba un invariante que lleva tres changes en pie.

### 0.2 ★ v3.9 ya está en la rama, y **le agregó un llamador a `consumir()` que la propuesta no pudo ver**

La propuesta escribió R10 (*"solapamiento con `chat-web-empleado`, que NO está mergeado"*) y recomendó *"v3.9 primero"*. **Ese orden ya ocurrió**: la rama actual es `hito/v3.9-chat-web-empleado` con el trabajo de v3.9 aplicado, y `POST /logout` existe. Verificado:

```
src/adapters/web/server.ts:795   confirmacionOperacionesStore.paraEmpleado(sesion.empleadoId).consumir();
```

`handleLogout` (ADR 202 pto 2 de v3.9) usa `consumir()` con su semántica de **ranura única**: *"limpiá la confirmación pendiente de este empleado"*, en singular. **Con multi-slot esa llamada deja de significar lo que dice** — un `consumir()` sin llave no puede saber cuál de N ranuras borrar, y borrar sólo una dejaría las otras vivas después de un logout, contradiciendo el ADR 202 pto 3 (*"el logout limpia las tres piezas de estado"*).

Consecuencia de alcance: **`src/adapters/web/server.ts` entra al diff de este change**, y no figura en el *Affected Areas* de la propuesta. Es una línea, pero es una línea del camino del logout. Ver **ADR 214 pto 4** y **R12**.

### 0.3 Dos correcciones menores de *Affected Areas*, verificadas

| Fila de la propuesta | Qué dice la verificación |
|---|---|
| `src/build-on-operaciones-empleado.ts` — *"Modified: cableado de `rolPort` hacia las dos operaciones nuevas"* | ★ **Sin cambio.** `rolPort` ya está construido (`:136-149`) y ya viaja dentro de `ejecutarDeps` (`:154-169`, campo `rolPort` en `:164`). El dispatcher arma `ResolverEscalacionDeps`/`ResolverSolicitudDeps` **desde `deps`**, inline, como ya hace `ejecutarCancelarSolicitud` (`ejecutar-operacion.ts:231-237`). **No hay una sola línea que agregar acá** — y que no la haya es la prueba de la Aclaración 2 pto 1: el gate viene gratis. |
| *"Prompt del agente conversacional de empleado \| Modified"* (una fila) | ★ **Son CUATRO superficies, no una**, y las cuatro enumeran las operaciones: `INSTRUCCION_OPERACIONES_EMPLEADO` (`core/agents/definitions.ts:201-210`), `buildOperacionesEmpleadoPrompt` (`core/ventas/soporte-prompt.ts:97-111`, **duplicación intencional declarada** en su doc `:89-93`), `OPERACIONES_TOOL_DESCRIPTION` (`adapters/operaciones/index.ts:84-91`) y las **skills** (`.claude/skills/*/SKILL.md`, seis hoy). Ver **ADR 220**. |

Y una corrección al catálogo de documentación stale del encargo: **son cuatro lugares, no dos**. Además de `docs/ARC42_Harness_Empresarial.md:567` y `comando-empleado.test.ts:719`, afirman que el ADR 151 sigue bloqueado o que R7 sigue abierta:

- `docs/ARC42_Harness_Empresarial.md:557` — *"…y **no aplica a la escalación de reembolso** (ver Deuda 5, R7)"*. **Este change lo vuelve falso** (ADR 211).
- `src/core/commands/comando-empleado.ts:175-177` — *"Los cinco `/aprobar-*`/`/rechazar-*`/`/reabrir-*` **NO bajan**: el ADR 151 los declaró candidatos a conversación pero su ejecución sigue **BLOQUEADA** por el checkpoint"*, en el doc-comment de `DESCRIPTORES` mismo. Es el lugar más engañoso de los cuatro, porque está **adentro del archivo que el change edita**.

---

## 1. Qué NO se reabre acá

Fijado por el checkpoint vía ADR 206-211 y consumido como dado: dos operaciones consolidadas con `accion` discriminada (206), el gate de rol heredado por delegación y **prohibido reimplementarlo en el dispatcher** (207), el modo listado como afordancia de primera clase sin gate de rol (208), la ranura multi-slot por `(empleadoId, dominio, itemId)` con el predicado `origenCasoId !== casoIdActual` **intacto** (209), la baja total y simultánea de los cinco comandos (210), y el cierre de R7 con `venta.vendedorId === sesion.empleadoId` dentro de `resolverEscalacionReembolso` (211).

Este documento **elige mecanismos**; no negocia esos invariantes. Y las dos reglas duras del repo atraviesan todo: `src/core/` nunca importa de `src/adapters/*`, y ningún adaptador importa de otro adaptador (`AGENTS.md`).

---

## 2. Resumen de la arquitectura elegida

Cinco decisiones, en una frase cada una:

1. **La ranura multi-slot es un `Map` de `Map`s** — externo por `empleadoId` **crudo** (nunca concatenado), interno por `` `${dominio}:${itemId}` ``. El aislamiento entre empleados deja de depender de un separador de strings y pasa a ser estructural. **ADR 212.**
2. **`accion` NO entra en la llave; entra en el PREDICADO.** Dos intenciones contradictorias sobre el mismo ítem no son dos ranuras que conviven: la nueva **reemplaza** a la vieja y **exige su propia confirmación**. Sin esto, *"rechazá V1"* seguido de *"aprobá V1"* ejecutaría la aprobación **sin eco y sin confirmación**. **ADR 213** — es el hallazgo de seguridad de esta fase.
3. **`cancelar_solicitud_interna` MIGRA, no convive** — y `cancelacion-solicitud-interna/spec.md` **sobrevive sin delta**, verificado leyendo: sus dos requirements sobre la ranura ya están `REMOVED` desde v3.6 y los tres que quedan están redactados sobre el efecto. La migración obliga a **un método nuevo en el store del adaptador** (`limpiarEmpleado`) para que el logout de v3.9 siga limpiando todo. **ADR 214.**
4. **La prohibición de autoaprobación de reembolso se traduce con un texto calcado del que ya existe para solicitudes**, con la misma forma gramatical y la misma distinción explícita frente al rechazo por rol. **ADR 216.**
5. **La auditoría reusa los cinco literales existentes** (`/aprobar-reembolso`, …) — y no por gusto: `repository.ts` ya los escribe **hardcodeados dentro de la transacción del CAS** (`:1485,1499,1513,2237,2251`), así que acuñar `operacion:*` produciría un rastro donde la **misma** operación escribe **dos** literales distintos según cómo termine. **ADR 218.**

Más dos hallazgos que la propuesta no anticipó y que el diseño tiene que cerrar: el **objeto zod plano no alcanza** para dos operaciones que comparten el nombre `accion` con uniones distintas (**ADR 217**), y el **techo natural de la ranura desaparece** al pasar de una a N (**ADR 214 pto 3**).

### 2.1 El mapa de piezas

```
                      ┌─ tool schema (zod plano, adapters/operaciones/index.ts)
  modelo ──accion,id?─┤
                      └─ validarOperacion  (whitelist estricta + ★ enum por operación, ADR 217)
                                 │
                                 ▼
      ejecutar-operacion.ts   ← ★ CERO lógica de autorización (ADR 207, test mecánico)
          │
          ├─ estaConfirmada({dominio, itemId, accion}, empleadoId, casoIdActual)   ← ADR 212/213
          │        └─► confirmacion-operaciones-store.ts   Map<empleadoId, Map<`dom:item`, Pendiente>>
          │
          └─ delega ──► resolverEscalacionReembolso / resolverSolicitudInterna
                              │  listado → no_encontrada → !confirmado → ROL → ★ AUTOAPROBACIÓN → CAS
                              └─ traduce el Result a texto  (y sólo eso)
```

---

## 3. ADR 212 (RD-98): el multi-slot es un **`Map` de `Map`s**, externo por `empleadoId` crudo

**Contexto.** Hoy: `const pendientes = new Map<string, ConfirmacionPendiente>()` indexado por `empleadoId` (`confirmacion-operaciones-store.ts:60`), con la propiedad declarada en `:55`: *"Ranura propia de `empleadoId` — N empleados concurrentes nunca se pisan"*. El ADR 209 pto 4 exige que esa propiedad **no se debilite** y que los **dos** chequeos (llave + predicado) **no se colapsen en uno**.

**Decisión**:

1. **Estructura**: `Map<empleadoId, Map<llaveInterna, ConfirmacionPendiente>>`, con `llaveInterna = ` `` `${dominio}:${itemId}` ``.
2. ★ **El `empleadoId` nunca se concatena.** Es la llave cruda del `Map` externo, igual que hoy. Esto importa y es la razón por la que se descarta la tupla serializada plana: en `` `${empleadoId}:${dominio}:${itemId}` ``, el aislamiento entre empleados —que es **la** frontera de seguridad de esta pieza— quedaría a merced de que ningún `empleadoId` contenga el separador. Un `empleadoId` es un string opaco que entra por `POST /login` y por `/crear-empleado`; **defender una frontera de seguridad con una convención de escapado es exactamente lo que el ADR 98 pto 4 del repo llama "un `if` que se borra en un refactor distraído"**. Con el `Map` anidado, **la colisión entre empleados es inexpresable**, no improbable.
3. **La llave interna sí concatena, y es demostrablemente libre de colisión**: `dominio` es una unión cerrada de **dos** literales (`"reembolso"`, `"solicitud"`), ninguno de los cuales contiene `:`. Entonces el corte en el primer `:` es no ambiguo y `` `${d1}:${i1}` === `${d2}:${i2}` `` implica `d1 === d2 ∧ i1 === i2`. Se prueba en una línea y se testea con un caso donde `itemId` contiene `:`.
4. ★ **El vocabulario de `dominio` NO se inventa: se reusa.** `build-on-comando-empleado.ts:272-299` (ADR 55) ya tiene la unión discriminada `dominio: "reembolso" | "solicitud" | "propuesta"` para la ranura única de la TUI. Acá se usan **los dos primeros literales, con el mismo significado**. `"propuesta"` no entra: no hay operación conversacional de propuesta, y un tercer valor sin escritor sería un miembro de unión que existe "para que compile" — el mismo defecto que ese archivo documenta en `:264-270` y que acá no hay motivo para repetir.
5. **Los dos chequeos siguen siendo dos** (ADR 209 pto 4): el `Map` externo escopa por `empleadoId`, **y además** `coincideConfirmacionConversacional` sigue comparando `pendiente.empleadoId === empleadoIdVerificado` (`:49`, sin tocar). No se colapsan.
6. **El predicado `origenCasoId !== casoIdActual` (`:50`) no cambia ni una letra**, y su doc-comment (`:31-38`, ADR 166 pto 3, arc42 `:566`) tampoco. Cambia **la llave con la que se llega a la ranura**, nunca la pregunta que se le hace.
7. **`crearConfirmacionOperacionesStore()` sigue sin dependencias** — sin reloj, sin `newId`. Ver ADR 214 pto 3 para por qué no se le inyecta un `now`.

**Alternativas consideradas**:

| Opción | Costo | Por qué se rechaza |
|---|---|---|
| **Tupla serializada plana** `` Map<`${empleadoId}:${dominio}:${itemId}`, …> `` | La más chica (un `Map`, un `delete`) | ★ Pone el aislamiento entre empleados —la propiedad de `:55`— a depender de un separador, y vuelve `limpiarEmpleado` (ADR 214 pto 4) un **barrido con prefijo** sobre las confirmaciones de **todos** los empleados. Dos defectos por ahorrar un `Map` |
| **`Map<empleadoId, ConfirmacionPendiente[]>`** (array) | Similar | El borrado y el reemplazo pasan a ser `findIndex`+`splice`; el "una ranura por llave" deja de ser una propiedad del tipo y pasa a ser una que hay que sostener con código. **El tipo debe hacer imposible lo imposible** (ADR 206 alternativa 2, mismo criterio) |
| **`Map<empleadoId, Map<dominio, Map<itemId, …>>>`** (tres niveles) | Un nivel más | Elimina la concatenación del todo, pero a cambio de tres `get` encadenados con dos guardas de `undefined` en cada método, y de un borrado que tiene que podar mapas internos vacíos para no fugar. La concatenación de la llave interna ya es libre de colisión **por demostración** (pto 3): pagar un nivel de indirección por una garantía que ya se tiene es complejidad sin contrapartida |
| **Persistir las confirmaciones pendientes** | Migración + puerto de escritura | Ya rechazada por el ADR 209 alternativas. Es estado de conversación, no de negocio: perderlo cuesta **repetir el pedido**, nunca una operación |

**Consecuencias**: el store pasa de ~82 a ~150 líneas, con dos funciones auxiliares privadas (`llaveInterna`, `ranuraDe`). Su encabezado —que hoy explica *"acá solo existe UN flujo de confirmación, así que no hace falta el campo `dominio`/`accion`"* (`:9-14`)— **se reescribe**: esa premisa deja de valer y el archivo tiene que decir por qué.

---

## 4. ADR 213 (RD-98, parte 2) ★: **`accion` va en el PREDICADO, no en la llave** — y sin esto hay un hueco real

**Contexto — el hallazgo.** El ADR 209 pto 1 fija la llave en `(empleadoId, dominio, itemId)`. `accion` no está. La pregunta que la propuesta no se hizo: **¿qué pasa si el empleado pide dos acciones distintas sobre el mismo ítem?**

Con `accion` ausente de la llave **y** del predicado, la secuencia es:

| Turno | Pedido del empleado | Ranura `(E, reembolso, V1)` | Qué pasa |
|---|---|---|---|
| 1 (`caso A`) | *"rechazá el reembolso de V1"* | se crea con `origenCasoId = A` | eco: *"vas a **rechazar**…"* |
| 2 (`caso B`) | *"mejor aprobalo"* | existe, `A !== B` ⇒ `estaConfirmada` **`true`** | ★ **el dispatcher invoca con `accion: "aprobar"`, `confirmado: true` — y APRUEBA, sin eco, sin confirmación** |

El empleado confirmó **rechazar** y el sistema **aprobó**. No es un caso rebuscado: es el **R6** de la propuesta (*"el modelo elige mal la `accion`"*) convertido de riesgo de UX en **pérdida del único control de deliberación del camino del dinero** — el mismo control que el ADR 151 pto 6 declaró como *"el ÚNICO, sin el comando explícito"*.

**Y el precedente ya resolvió esto**: la ranura única de la TUI compara `accion` en su predicado de coincidencia, verificado literal — `build-on-comando-empleado.ts:1113-1118`, cuarta condición: `confirmacionPendiente.accion === accion`. El multi-slot **no puede quedar más permisivo que la ranura que reemplaza**.

**Decisión**:

1. **La llave es `(empleadoId, dominio, itemId)`, tal como el ADR 209 pto 1 la fijó — no se reabre.**
2. ★ **`accion` se guarda en `ConfirmacionPendiente` y se compara en el predicado**, como cuarta condición, al lado de las tres que ya están (`itemId`, `empleadoId`, `origenCasoId !== casoIdActual`). Molde literal: `build-on-comando-empleado.ts:1117`.
3. **Consecuencia deseada del pto 1 + pto 2**: un pedido con otra `accion` sobre el mismo ítem **no coincide** ⇒ el dispatcher va por la rama `!confirmado` ⇒ `resolver*` devuelve `requiere_confirmacion` ⇒ `marcarPendiente` **sobreescribe** la ranura (misma llave) con la `accion` nueva y su propio `origenCasoId`. **La intención nueva reemplaza a la vieja y se gana su propia confirmación.** Nunca quedan dos intenciones contradictorias vivas sobre el mismo ítem.
4. **Falla cerrado en los dos sentidos**: si el modelo cambia de `accion` por error, lo peor que pasa es que el empleado ve un eco de más; si el empleado cambia de idea, ve el eco correcto de la acción nueva.
5. **Tipo de `accion` en el puerto**: `operaciones-contract.ts` **no tiene imports** (invariante declarado en su doc `:3-7`), así que no puede importar `AccionEscalacion`/`AccionSolicitud`. Se declara localmente `AccionConfirmable = "aprobar" | "rechazar" | "reabrir" | "cancelar"`, con doc-comment que nombra la duplicación deliberada — **mismo criterio que ese archivo ya aplica a `DecisionVentaModelo`** (`:57-58`, duplicado local de la unión del núcleo).

**Alternativas consideradas**:

- **Meter `accion` en la llave** (`(empleadoId, dominio, itemId, accion)`): **rechazada, y es la alternativa seria.** Cierra el hueco igual de bien, pero deja **dos ranuras contradictorias vivas** sobre el mismo ítem: *"rechazá V1"* (ranura A) → *"aprobá V1"* (ranura B) → el empleado se arrepiente y repite *"rechazá V1"* ⇒ **la ranura A, creada tres turnos atrás y ya olvidada, coincide y ejecuta**. Prefiero que el ítem tenga **una sola intención pendiente por vez**, que es como piensa la persona que está del otro lado. Además contradiría la llave que el ADR 209 pto 1 ya fijó.
- **Dejar `accion` fuera de llave y de predicado, y confiar en el prompt** para que el modelo no cambie de acción: **rechazada sin discusión.** Es el modo de falla del ADR 180 pto 3 (*"pedirle al modelo que no revele datos personales"*) aplicado al camino del dinero. La propuesta ya lo dijo en RD-100: *"las líneas de seguridad del prompt son necesarias y NUNCA suficientes"*.

**Consecuencias**: `ConfirmacionOperacionPort` cambia de forma **más allá del renombre** que el ADR 209 pto 3 pedía — gana `dominio` y `accion`. Es un puerto de uso exclusivo del canal conversacional (R8 de la propuesta lo verificó), con **cuatro call sites de producción en todo el repo**, verificados por `Grep`: `ejecutar-operacion.ts:253,268,278` y `server.ts:795`.

---

## 5. ADR 214 (RD-99): `cancelar_solicitud_interna` **migra**, la spec sobrevive sin delta, y el logout necesita un método nuevo

**Contexto.** RD-99 preguntaba dos cosas: si migra o convive, y si `cancelacion-solicitud-interna/spec.md` necesita delta.

**Decisión**:

1. ★ **Migra. Cero convivencia.** Mantener dos mecanismos de confirmación para tres operaciones del mismo canal sería exactamente el defecto que el ADR 210 usó para rechazar la ventana de transición de los comandos: *"dos superficies con dos mecanismos de confirmación distintos, o sea dos veces la superficie de auditoría y de test para el mismo efecto"*. Y el riesgo estructural del change (**R4**) se **reduce** migrando, no conviviendo: con una sola ranura, la suite vigente de `cancelar_solicitud_interna` **es** la red de seguridad del multi-slot. Con dos, el camino viejo queda verde mientras el nuevo se rompe en silencio.
2. ★ **`cancelacion-solicitud-interna/spec.md` NO lleva delta — verificado leyendo, no razonando.** La versión vigente es `openspec/changes/operaciones-negocio-conversacionales/specs/cancelacion-solicitud-interna/spec.md`, y ahí: los **dos** requirements que eran exhaustivos sobre la ranura ya están **`REMOVED`** desde v3.6 (`:7-13`: el descriptor `/cancelar-solicitud` y *"Confirmación en dos pasos reusando `manejarResolucionSolicitud`"*), y el único `MODIFIED` que queda (`:17-31`) está redactado **sobre el efecto** (`solicitud.solicitanteId === sesion.empleadoId`, *"un tercero recibe un rechazo sin que el `detalle` aparezca en la respuesta"*) — **no menciona la ranura en ninguna parte**. Sobrevive intacto. El contrato de la confirmación vive en `herramienta-operaciones-negocio` (donde v3.6 mandó RD-71) y ahora, generalizado, en la capability nueva `confirmacion-operaciones-multislot`. **El gate del checkpoint —"si el delta resultante es más PERMISIVO, parar"— no se dispara: no hay delta, y el mecanismo nuevo es estrictamente MÁS restrictivo** (la ranura deja de ser pisable por otro dominio/ítem, y ahora también compara `accion`, ADR 213).
3. ★ **Techo por empleado — la ranura única era su propio recolector de basura, y eso se pierde.** Hoy un empleado no puede acumular: cada `marcarPendiente` pisa el anterior (`:74`). Con multi-slot puede acumular N. Decisión: `CONFIRMACIONES_PENDIENTES_MAX = 8` por empleado; al insertar la novena, **se evicta la más vieja** (el `Map` de JS conserva orden de inserción: `ranura.delete(ranura.keys().next().value)`). **Rota, nunca rechaza** — mismo criterio que el ADR 197 pto 1 de v3.9 fijó para la conversación, y por el mismo motivo: una política interna no puede dejar al empleado sin canal. Perder una ranura vieja cuesta **repetir el pedido**, nunca una operación (falla cerrado). **Sin TTL**: agregarlo obligaría a inyectar un reloj en un store que hoy no tiene dependencias (`crearConfirmacionOperacionesStore()`), y sumaría un **segundo** concepto de vencimiento a una pieza cuyo invariante es de **turnos**, no de tiempo (*"un turno posterior y distinto"*, arc42 `:566`). El TTL de 2 minutos de la TUI (`build-on-comando-empleado.ts:254`) vive donde vive porque ahí no hay `origenCasoId`.
4. ★ **El logout de v3.9 obliga a un método nuevo en el store del ADAPTADOR** (§0.2). `handleLogout` hace hoy `paraEmpleado(sesion.empleadoId).consumir()` (`server.ts:795`), que con multi-slot ya no puede significar *"limpiá todo lo de este empleado"* — `consumir` pasa a recibir la llave del ítem. Se agrega **`limpiarEmpleado(empleadoId): void`** a `ConfirmacionOperacionesStore` (la interfaz del **adaptador**, `confirmacion-operaciones-store.ts:54-57`), y `handleLogout` pasa a llamarla. Dos propiedades que lo hacen la forma correcta:
   - **No va en el puerto del núcleo.** `ConfirmacionOperacionPort` direcciona **una ranura**; el ciclo de vida de **todas** las de un empleado es asunto del adaptador y del logout. Meter un "borrá todo" en el puerto le daría al dispatcher un método que no debe poder invocar.
   - **Es `pendientes.delete(empleadoId)`, O(1)**, gracias a que el `Map` externo está indexado por `empleadoId` crudo (ADR 212 pto 2). Con la tupla plana sería un barrido con prefijo sobre todas las confirmaciones de todos los empleados.
   - **Idempotente**: borra exista o no, mismo criterio que `SesionEmpleadoStore.eliminar` (ADR 202 pto 1) y que `buscar` documenta en `sesion-empleado-store.ts:13-16`.
   - **El orden de composición del ADR 202 pto 2 no se altera** (`buscar` → limpiar confirmación → `conversacionStore.eliminar` → `sesionStore.eliminar`): cambia **una llamada**, no la secuencia. **Instrucción para `sdd-apply`: el doc-comment de `handleLogout` (`server.ts:778-785`) nombra `confirmacion.consumir()` literalmente — hay que actualizarlo en el mismo commit.**
5. **`turno-empleado-autenticado` no lleva delta** — verificado el criterio, no el archivo completo: sus requirements son de seguridad del turno (qué herramienta llega a qué turno, que `/soporte` nunca la tenga). Este change agrega **operaciones dentro de la herramienta**, no herramientas dentro del turno. **Instrucción para `sdd-spec`: confirmarlo leyendo `chat-web-empleado/specs/turno-empleado-autenticado/spec.md` (versión vigente) y, si alguno enumera operaciones de forma exhaustiva, el delta es sólo ese conteo.**

**Alternativas consideradas**:

- **Convivencia**: rechazada por el pto 1.
- **`consumir()` sin argumentos que borre todas las ranuras del empleado**, para no tocar `server.ts`: **rechazada, y es la tentación de ahorro.** Volvería el `consumir()` de `ejecutar-operacion.ts:278` —que corre **antes de ejecutar** una cancelación— en un borrado de las confirmaciones pendientes de **otros** ítems. Ahorrar una línea en el logout a cambio de un efecto lateral en el camino del dinero es un intercambio que no cierra.
- **Evicción por TTL en vez de por techo**: rechazada por el pto 3.

---

## 6. ADR 215: la unión de reembolso gana `autoaprobacion_prohibida` con **`itemId`**, y `no_autorizado` **conserva `ventaId`**

**Contexto.** `ResolverEscalacionResult` (`resolver-escalacion-reembolso.ts:52-68`) tiene cinco miembros; el de rechazo por rol usa **`ventaId`** (`:68`). El ADR 211 pto 5 fija la forma del miembro nuevo como `{ resultado: "autoaprobacion_prohibida", accion, itemId, casoId }` — **`itemId`, no `ventaId`**, alineado con el ADR 159 (`autorizacion-empleado/design.md:144`), con `ResolverSolicitudResult` (`resolver-solicitud-interna.ts:61-79`, que usa `itemId` en sus cuatro miembros) y con el renombre del ADR 209 pto 3.

**Decisión**:

1. **El miembro nuevo usa `itemId`**, literal, como el ADR 211 pto 5 lo fijó. No se reinterpreta.
2. ★ **`no_autorizado` conserva `ventaId` y NO se toca.** Unificarlo a `itemId` sería *"más prolijo"* y **violaría el Success Criterion de la propuesta** (*"el diff de `resolver-escalacion-reembolso.ts` está ACOTADO a: condición, miembro de unión, evento de log"*), arrastrando además a `build-on-comando-empleado.ts:1162` y a sus tests. **Un diff acotado que el Reviewer puede leer de una mirada vale más que una asimetría de nombres de dos miembros de una unión.**
3. **La asimetría queda declarada acá, no descubierta en review**: dentro de `ResolverEscalacionResult` conviven `no_autorizado.ventaId` y `autoaprobacion_prohibida.itemId`, y el dispatcher lee **el campo que corresponde a cada rama** — el `switch` discriminado hace que confundirlos sea un error de compilación, no un bug.
4. **Unificar a `itemId` toda la unión de reembolso es un refactor mecánico propio**, de valor real y riesgo casi nulo, que **este** change no hace. Se deja nombrado, sin RD y sin ADR nuevo: es trabajo de higiene, no una decisión pendiente.
5. **El evento de log es `reembolso-autoaprobacion-rechazada`**, molde literal de `solicitud-autoaprobacion-rechazada` (`resolver-solicitud-interna.ts:230-234`), con los mismos campos `{ accion, ventaId, empleadoId }` que los otros eventos de este archivo ya usan (`:146,151,156`) — **el evento usa `ventaId`** porque es el vocabulario de logging de este módulo; `itemId` es vocabulario del `Result`. Escrito con `logEvent(venta.casoId, …)`, igual que el rechazo por rol.

**La forma exacta del bloque, para que `sdd-tasks` corte y `sdd-apply` no improvise** — va **inmediatamente después** del gate de rol (`:155-158`), antes del `resolucionInput`:

```ts
if (venta.vendedorId === sesion.empleadoId) {
  logEvent(venta.casoId, "reembolso-autoaprobacion-rechazada", { accion, ventaId, empleadoId: sesion.empleadoId });
  return { resultado: "autoaprobacion_prohibida", accion, itemId: ventaId, casoId: venta.casoId };
}
```

**Siete líneas de producción, más el miembro de unión (6) y la actualización del encabezado de secuencia `:94-116` (que enumera las ramas A-F y necesita una E-bis).** Nada más. **Todo lo demás en el diff de ese archivo es alcance filtrado** (Success Criteria de la propuesta).

---

## 7. ADR 216 (RD-101): texto exacto de la prohibición de autoaprobación de reembolso

**Contexto.** RD-101 pide el texto que ve el empleado, con el tono del que ya existe para solicitudes, y **si distingue explícitamente "no podés resolver tu propia venta" de "no tenés rol"**.

Los tres textos vigentes, verificados literal en `build-on-comando-empleado.ts`:

| Situación | Texto vigente | Línea |
|---|---|---|
| Rol insuficiente, reembolso | `No estás autorizado para ${accion} esa escalación de reembolso: se requiere rol elevado.` | `:1168` |
| Rol insuficiente, solicitud | `No estás autorizado para ${accion} esa solicitud: se requiere rol elevado.` | `:1329` |
| **Autoaprobación, solicitud** | **`No podés ${accion} tu propia solicitud, aunque tengas rol elevado.`** | `:1336` |

**Decisión**:

1. ★ **Texto literal, en el dispatcher conversacional**:

   ```
   No podés ${accion} el reembolso de tu propia venta, aunque tengas rol elevado.
   ```

   Con `accion ∈ {aprobar, rechazar, reabrir}` sustituida verbatim. Las tres flexiones leen naturalmente en Rioplatense: *"No podés **aprobar** el reembolso de tu propia venta…"*, *"…**rechazar**…"*, *"…**reabrir**…"*.
2. **Calca la estructura del de solicitudes, palabra por palabra**: `No podés` + acción + **el objeto poseído** + `, aunque tengas rol elevado.` Lo único que cambia es el objeto (`tu propia solicitud` → `el reembolso de tu propia venta`), porque el objeto **es** la diferencia de dominio. **No se inventa un registro nuevo para un mensaje hermano de uno que ya existe.**
3. ★ **SÍ distingue de "no tenés rol", y a propósito** (la pregunta explícita de RD-101). Las dos frases son distintas en gramática y en contenido:
   - `No estás autorizado para X: se requiere rol elevado.` ⇒ *"esto no es para vos, todavía"* — accionable (pedí el rol).
   - `No podés X el reembolso de tu propia venta, aunque tengas rol elevado.` ⇒ *"esto no es para vos, nunca, y no es por tu rol"* — **el `aunque tengas rol elevado` corta de raíz el pedido de escalar privilegios**, que es la reacción natural a un rechazo de autorización.
   Confundirlos mandaría al empleado a pedir un rol que no le va a servir, y al administrador a concedérselo pensando que resuelve algo. **Es la misma razón por la que el ADR 159 fijó el orden de evaluación** (rol primero, autoaprobación después): *"decide qué mensaje ve cada actor"*.
4. **No filtra nada que el actor no supiera** (criterio del ADR 159, `autorizacion-empleado/design.md:131-134`): es **su propia** venta, cuyo id él mismo acaba de nombrar. El mensaje no menciona `vendedorId`, ni monto, ni cliente, ni `casoId`.
5. **El mensaje del rechazo por rol en reembolso se reusa literal** del texto de la TUI (`:1168`), sin reescribirlo: la superficie cambia de terminal a chat, el veredicto no.
6. **Ninguno de los dos textos incluye el `empleadoId`.** La fila de auditoría sí lo lleva (`registrar()` lo agrega desde `sesion`, `ejecutar-operacion.ts:204`); el texto que ve el modelo, no.

**Alternativas consideradas**:

- **Un texto genérico compartido por los dos dominios** (*"No podés resolver lo tuyo"*): **rechazada.** Son dos requirements hermanos sobre **funciones distintas** con **predicados sobre campos distintos** (`solicitanteId` vs. `vendedorId`) — la propuesta ya instruyó a `sdd-spec` a no fusionarlos, y el texto no debería fusionar lo que la spec separa. Además pierde el dato que le sirve al empleado: **cuál** de sus cosas es.
- **Explicar el mecanismo** (*"…porque esta venta fue registrada con tu usuario"*): **rechazada.** Es cierto pero es una invitación a buscarle la vuelta, y adelanta un detalle de implementación (que `vendedorId` sale de la sesión) que puede cambiar. El veredicto se comunica; el mecanismo vive en el arc42.

---

## 8. ADR 217 ★ (hallazgo de esta fase): el objeto zod plano **no alcanza** para dos operaciones que comparten `accion`

**Contexto — verificado, no supuesto.** El borde MCP usa **un objeto zod plano con todos los campos posibles, todos opcionales** (`adapters/operaciones/index.ts:66-82`), y la validación estricta real es `validarOperacion` (`validar-operacion.ts`, whitelist por operación). Ese reparto funciona hoy porque **`decision` pertenece a una sola operación** (`:70`, `z.enum(["confirmar","rechazar"])`).

**`accion` rompe la premisa: la comparten dos operaciones con uniones DISTINTAS** — `aprobar|rechazar|reabrir` para reembolso, `aprobar|rechazar` para solicitud. Un `z.enum` plano tiene que aceptar la unión de las dos, y `validarOperacion` **no valida valores de enum**: para todo campo no numérico sólo chequea `typeof valor === "string"` y largo ≤ 256 (`:129`). Entonces, sin trabajo nuevo:

- `resolver_solicitud { accion: "reabrir" }` **pasa las dos validaciones**, llega a `resolverSolicitudInterna` con una `accion` que no es miembro de `AccionSolicitud`, cae en el `default` del `switch` exhaustivo y **lanza** (`resolver-solicitud-interna.ts:126-129`). Lo atrapa el `catch` global de `ejecutarOperacion` (`:468`) y degrada a *"error interno"* — **falla cerrado, pero por accidente y con el mensaje equivocado**, y deja un `operacion-fallida` en el log que parece un bug del arnés.
- Peor de intención: si el `z.enum` plano incluyera `"cancelar"`, `resolver_solicitud { accion: "cancelar" }` sería **una segunda vía de cancelar** que esquiva el flujo de `cancelar_solicitud_interna`. Hoy no existe ese valor en ningún enum del borde, y **tiene que seguir sin existir**.

**Decisión**:

1. **`validar-operacion.ts` gana una cuarta tabla**, hermana de las tres que ya tiene (`CAMPOS_POR_OPERACION`, `CAMPOS_REQUERIDOS_POR_OPERACION`, `CAMPOS_NUMERICOS_POR_OPERACION`):

   ```ts
   const VALORES_PERMITIDOS_POR_OPERACION: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
     resolver_decision_venta: { decision: ["confirmar", "rechazar"] },
     procesar_devolucion: {},
     crear_solicitud_interna: {},
     cancelar_solicitud_interna: {},
     registrar_venta: {},
     consultar_reporte_comisiones: {},
     resolver_reembolso: { accion: ["aprobar", "rechazar", "reabrir"] },
     // ★ "cancelar" NUNCA acá: cancelar es autoservicio y tiene su propia
     //   operación, con chequeo de dueño en vez de gate de rol.
     resolver_solicitud: { accion: ["aprobar", "rechazar"] },
   };
   ```

   Más una cláusula en el `some(...)` existente (`:118-130`): si el campo tiene fila en esta tabla y su valor no está en la lista ⇒ rechaza.
2. ★ **`decision` entra a la tabla aunque hoy zod ya la cubra.** Es aditivo y **no cambia ningún comportamiento observable** (zod rechaza antes), pero cierra una dependencia que el propio módulo declara inaceptable en su doc: *"una whitelist de seguridad no puede depender de una resolución de módulos ajena"* (`:11-16`). Hoy la validación estricta **sí** dependía de zod para `decision`. Que este change lo note y lo cierre es gratis.
3. **El objeto zod plano suma dos campos**: `accion: z.enum(["aprobar","rechazar","reabrir"]).optional()` y `ventaId: z.string().optional()`. **Dos capas, dos garantías** — el borde acota la forma, la whitelist acota el significado por operación. Es el mismo reparto que el ADR 163 pto 3 fijó; acá recién se vuelve necesario.
4. **`OPERACIONES_NEGOCIO` pasa de seis a ocho entradas** (`operaciones-contract.ts:48-55`), y con eso `z.enum(OPERACIONES_NEGOCIO)` acepta las dos nuevas sin tocar el adaptador más allá del pto 3.
5. **Test obligatorio en negativo**, y es el que justifica el ADR entero: `resolver_solicitud { accion: "reabrir" }` ⇒ `validarOperacion` devuelve `undefined` ⇒ **`deps.ejecutar` no se invoca** y ninguna función determinista se toca. Ídem `resolver_solicitud { accion: "cancelar" }`. **Sin estos dos casos, el cruce de dominios queda cubierto por un `throw` accidental.**

**Alternativas consideradas**:

- **Dos campos distintos en el schema plano** (`accionReembolso`, `accionSolicitud`): **rechazada.** Duplica el vocabulario que el ADR 206 pto 1 consolidó, y le da al modelo dos nombres casi iguales — el defecto que ese mismo ADR usó para rechazar las cinco operaciones separadas.
- **Validar la `accion` en el dispatcher, dentro de cada rama**: **rechazada.** Movería una validación de whitelist al lugar donde vive el dispatch, que es justo lo que `validar-operacion.ts` existe para evitar. Y dejaría el rechazo sin el `REJECTION_TEXT` estandarizado del adaptador (`index.ts:57`).
- **Confiar en el `throw` del `switch` exhaustivo**: **rechazada.** Falla cerrado por casualidad, no por diseño, y le miente al operador en el log.

---

## 9. ADR 218 (RD-104): la auditoría **reusa los cinco literales**, y no es una elección de estilo

**Contexto.** RD-104 preguntaba si se reusan `/aprobar-reembolso`, …, o si se acuñan `operacion:*` (molde ADR 188 pto 6/7, que los acuñó para `registrar_venta` y `resolver_decision_venta`).

**La verificación decide la pregunta, no el gusto.** El literal del **camino feliz** no lo escribe el dispatcher: lo escribe la transacción del CAS, **hardcodeado en el repositorio**:

```
repository.ts:1485   comando: "/aprobar-reembolso"    resultado: "aprobada"
repository.ts:1499   comando: "/rechazar-reembolso"   resultado: "rechazada"
repository.ts:1513   comando: "/reabrir-reembolso"    resultado: "reabierta"
repository.ts:2237   comando: "/aprobar-solicitud"    resultado: "aprobada"
repository.ts:2251   comando: "/rechazar-solicitud"   resultado: "rechazada"
```

Y el contrato lo declara: *"Las filas de una resolución EXITOSA de los TRES comandos de resolución NO pasan por acá: viajan dentro de la transacción del CAS"* (`registro-acciones-contract.ts:86-88`).

**Decisión**:

1. ★ **Se reusan los cinco literales existentes.** Acuñar `operacion:resolver_reembolso` para los intentos rechazados produciría un rastro donde **la misma operación escribe dos literales distintos según cómo termine** — `/aprobar-reembolso` si el CAS aplica, `operacion:*` si la rechaza el rol. Un auditor que filtre por `/aprobar-reembolso` **perdería exactamente los intentos rechazados**, que son las filas que más importan. Cambiar el literal del camino feliz para emparejar sería tocar `repository.ts`: alcance filtrado, y además reescribiría la semántica de las filas históricas.
2. **El precedente es exacto, no analógico.** El criterio del ADR 188 es *"`operacion:` **sólo** para operaciones **sin comando de TUI ancestro**"* (`registro-acciones-contract.ts:26-28`). Las cinco de este change **tienen** ancestro — el que se está dando de baja. Y v3.6 ya resolvió el caso idéntico: `/devolucion`, `/solicitar` y `/cancelar-solicitud` fueron dados de baja **y sus literales se conservaron** para la versión conversacional (`ejecutar-operacion.ts:297,426,445`; requirement vigente `herramienta-operaciones-negocio/spec.md:88-95`).
3. **Mapeo `accion` → literal**, dos tablas de módulo en `ejecutar-operacion.ts`, molde de `EVENTO_SOLICITUD_APLICADA` (`resolver-solicitud-interna.ts:101-105`) y de `ACCION_ESCALACION_INFO` (`build-on-comando-empleado.ts:439-444`):

   ```ts
   const COMANDO_POR_ACCION_REEMBOLSO: Record<AccionEscalacion, string> = {
     aprobar: COMANDO_APROBAR_REEMBOLSO, rechazar: COMANDO_RECHAZAR_REEMBOLSO, reabrir: COMANDO_REABRIR_REEMBOLSO,
   };
   const COMANDO_POR_ACCION_SOLICITUD: Record<"aprobar" | "rechazar", string> = {
     aprobar: COMANDO_APROBAR_SOLICITUD, rechazar: COMANDO_RECHAZAR_SOLICITUD,
   };
   ```
4. ★ **Cero constantes nuevas en `registro-acciones-contract.ts`.** Los cinco `COMANDO_*` (`:11-16`) y los seis `RESULTADO_*` que hacen falta (`APROBADA`, `RECHAZADA`, `REABIERTA`, `NO_APLICABLE`, `NO_AUTORIZADO`, `AUTOAPROBACION_PROHIBIDA`, `:38-47`) **ya existen todos**. El único cambio en ese archivo es de **comentario**: los de `:46-47` enumeran para qué comandos vale cada resultado y hoy dicen *"(autorizacion-empleado, ADR 161)"* sobre los cinco de TUI; hay que anotar que ahora llegan también por el canal conversacional. **Es documentación, no contrato.**
5. **Qué ramas escriben fila desde el dispatcher** — el reparto queda así, y es verificable:

   | Rama del `Result` | ¿Escribe el dispatcher? | Por qué |
   |---|---|---|
   | `aplicada` | **No** | La transacción del CAS ya la escribió (`repository.ts`). Escribirla acá la **duplicaría** — mismo hallazgo 1 del ADR 188 |
   | `no_autorizado` | **Sí**, `RESULTADO_NO_AUTORIZADO` | No hubo transacción. Molde literal `build-on-comando-empleado.ts:1159-1167` |
   | `autoaprobacion_prohibida` | **Sí**, `RESULTADO_AUTOAPROBACION_PROHIBIDA` | Ídem, molde `:1331-1337`. ★ **Ahora en los dos dominios** |
   | `no_aplicable` con `motivo: "cas"` **y** `casoId` definido | **Sí**, `RESULTADO_NO_APLICABLE` | CAS perdido: la transacción no matcheó, no escribió nada. Molde `ejecutar-operacion.ts:295-302` |
   | `no_aplicable` con `motivo: "no_encontrada"` | **No** | No hay `casoId` que correlacionar — la función misma lo documenta (`resolver-escalacion-reembolso.ts:103-104`, *"NO escribe fila"*) |
   | `requiere_confirmacion` | **No** | Cero escrituras, por definición (rama D, `:106-107`) |
   | `listado` | **No** — ver pto 6 | |
6. ★ **El listado NO escribe fila de auditoría.** El ADR 208 pto 3 dejó la pregunta abierta (*"si `sdd-design` concluye que listar pendientes es 'divulgar' y merece fila, es RD-104"*). **Decisión: no la merece, y el criterio ya está escrito en el repo.** El requirement vigente dice *"cada operación que **muta estado o divulga datos sensibles**"* (`herramienta-operaciones-negocio/spec.md:90`), y el caso comparable ya fue resuelto: `consultar_reporte_comisiones` **sí** deja fila (`/reporte-comisiones`, `resultado: "atendida"`) porque divulga **comisiones de todos los vendedores**, dato que su propio requirement marca como sensible. El listado de escalaciones devuelve `ventaId`, `clienteId`, `monto` y `casoId` de ventas **en proceso de reembolso**: es el mismo conjunto que el eco de confirmación —que **tampoco** escribe fila— y el mismo que la TUI listaba sin fila desde v1.4. **Agregar fila acá sería resolver R5 (el listado sin gate de rol) a medias y por la puerta de atrás**: registrar prolijamente un acceso que seguimos permitiendo. El `logEvent("tui-comando", "reembolso-listado", …)` que ya existe (`:138`) es la traza correcta para eso. **R5 se mantiene como está — declarada, no agravada, no resuelta** (decisión del checkpoint, punto 2 de la propuesta).
7. **`registro-acciones-empleado` NO lleva delta** (la propuesta la marcaba *"candidata, a verificar leyendo"*): al no acuñarse literales nuevos ni valores de `resultado` nuevos, ningún requisito exhaustivo sobre el vocabulario queda incompleto. **Instrucción para `sdd-spec`: confirmarlo leyendo la versión vigente (`comandos-administracion-empleados/specs/registro-acciones-empleado/spec.md`) y, si tiene un requirement exhaustivo sobre *qué canal* escribe cada literal, ahí sí hay un delta de una línea.**

---

## 10. ADR 219 (RD-103): el listado entra en la memoria, y un id viejo **es seguro por construcción**

**Contexto.** RD-103: con la memoria conversacional de v3.9, ¿el listado entra al historial y una referencia deíctica posterior resuelve contra él, o hay que re-listar? ¿Y si el listado cambió entre el mensaje N y el N+1 — *"el id que el modelo recuerda puede haber dejado de ser resoluble"*?

**Respuesta verificada a la primera mitad: sí, entra.** El texto del listado es el `CallToolResult` de la tool, que el SDK guarda en su sesión; v3.9 hace que el mensaje N+1 retome esa sesión vía `options.resume` (`chat-web-empleado/design.md:§1`, `build-on-operaciones-empleado.ts:198-214`). **El modelo del mensaje N+1 ve el listado del mensaje N.** No hay que construir nada para eso.

**Decisión**:

1. **No se fuerza re-listar.** Un id recordado de un listado propio **es un id que el modelo recibió**, no uno que inventó — que es exactamente lo que el ADR 208 pto 2 exige. La memoria no debilita esa propiedad: la extiende.
2. ★ **La staleness es estructuralmente inocua, y se puede demostrar en tres capas independientes** — por eso no hace falta política de frescura:

   | Capa | Qué hace | Dónde |
   |---|---|---|
   | 1 | El paso `!confirmado` **relee** el ítem con filtro **por estado**, nunca un lector por id suelto (ADR 38) | `resolver-escalacion-reembolso.ts:142`, `resolver-solicitud-interna.ts:186` |
   | 2 | El paso `confirmado: true` **vuelve a releer**, otra vez con filtro por estado — son dos invocaciones distintas de la función | `ejecutar-operacion.ts`, molde `:256`/`:279` |
   | 3 | El CAS mismo es `UPDATE … WHERE estado = … RETURNING`; si alguien resolvió en el medio, devuelve `undefined` ⇒ `no_aplicable/cas` | `repository.ts`, vía `aplicarCas` |

   Un id que dejó de estar pendiente produce `no_aplicable` con el texto *"no hay ninguna venta X en ese estado"*, **nunca** una escritura equivocada. Falla cerrado tres veces seguidas.
3. ★ **El control real contra el id equivocado no es la frescura del listado: es el ECO.** El paso de confirmación le muestra al empleado `ventaId`, `monto`, `clienteId` y `casoId` **releídos del store en ese instante** (`requiere_confirmacion` devuelve la `EscalacionListada` completa, `:54`). Si el modelo trajo un id viejo o el de otro cliente, el empleado lo ve **antes** de confirmar. Es el mismo argumento con el que el ADR 151 pto 6 dijo que el doble paso es el único control de deliberación: **acá es también el control de identidad del ítem.**
4. **Techo de listado**: se reusa `LIMITE_LISTADO_ESCALACIONES` (`:136`) y `LIMITE_LISTADO_SOLICITUDES` (`:169`), **20 cada uno**, pasando por el default de `deps.limiteListado`. **No se inventa un techo nuevo** (ADR 208 pto 5).
5. **La skill instruye a re-listar sólo cuando la referencia del empleado es ambigua o vieja**, no siempre (ADR 220 pto 4). Forzar re-listar en cada turno gastaría una invocación de tool para resolver un problema que las tres capas del pto 2 ya cierran.
6. **La rotación de conversación de v3.9 (ADR 197: inactividad, techo de 40 turnos, logout) borra el listado del contexto sin avisar**, y con él los ids. Consecuencia benigna: el modelo tiene que volver a listar, que es la salida correcta. **Se nombra para que no se lea como un bug** en la evidencia manual.

---

## 11. ADR 220 (RD-100): las **cuatro** superficies de prompt, y dos skills nuevas

**Contexto.** RD-100 pide la instrucción exacta: cuándo ofrecer listado, cómo pedir confirmación, y **cómo NO inferir `confirmado: true` ni una `accion` de una frase ambigua** (requirement vigente `herramienta-operaciones-negocio/spec.md:47-54`). Con la advertencia que la propuesta dejó escrita: *"las líneas de seguridad del prompt son necesarias y NUNCA suficientes"*.

**Decisión**:

1. **Las cuatro superficies se tocan, y cada una dice lo suyo** (§0.3):

   | Superficie | Qué cambia | Estimación |
   |---|---|---|
   | `INSTRUCCION_OPERACIONES_EMPLEADO` (`definitions.ts:201-210`) | La enumeración de qué resuelve la herramienta suma *"resolver escalaciones de reembolso y solicitudes internas que te toque validar"*. **La frase de confirmación (`:207-210`) NO se toca** — ya dice exactamente lo que hace falta | ~4 líneas |
   | `buildOperacionesEmpleadoPrompt` (`soporte-prompt.ts:97-111`) | Ídem, **duplicado a propósito** — su doc `:89-93` declara que este módulo no importa nada, mismo criterio que `sesion.ts`. **No se refactoriza a una constante compartida en este change** | ~4 líneas |
   | `OPERACIONES_TOOL_DESCRIPTION` (`adapters/operaciones/index.ts:84-91`) | Ídem en la enumeración, más una frase sobre `accion` (pto 3) | ~5 líneas |
   | `.claude/skills/` | **Dos skills nuevas** (pto 4) | ~2 × 55 líneas |
2. ★ **La instrucción sobre `accion` es tan importante como la de `confirmado`, y es nueva.** El requirement vigente sólo habla de no inferir `confirmado`. Con `accion` discriminada hay un segundo valor que el modelo puede sacar de una frase ambigua, y **con peores consecuencias** (aprobar en vez de rechazar es irreversible; confirmar de más al menos exige un turno). Texto para las tres superficies de prompt:

   > *"Cuando el empleado te pida resolver un reembolso o una solicitud, la acción (`aprobar`, `rechazar` o `reabrir`) tiene que salir de una frase **inequívoca** del empleado. Si dice algo ambiguo —'resolvelo', 'dale', 'hacé lo que corresponda', 'fijate vos'— **preguntá cuál de las acciones quiere** en vez de elegir una. Nunca elegís vos la acción, ni la deducís del contexto, ni del dictamen, ni de lo que parezca más razonable."*

   El *"ni del dictamen"* no es adorno: las solicitudes internas llevan un `dictamen` producido por un subagente validador (`solicitudes-contract.ts:65`), y ese texto está **a la vista del modelo** en el listado. Sin la línea, *"resolvé la solicitud S1"* con un dictamen favorable es una invitación a aprobar.
3. **La instrucción de confirmación se conserva literal, sin reescribir**, y cubre a las tres operaciones por igual: *"Si la herramienta te devuelve un pedido de confirmación, comunicáselo al empleado tal cual y esperá su respuesta explícita en un mensaje nuevo antes de volver a invocar la misma operación: nunca decidas vos que ya quedó confirmado"* (`definitions.ts:207-210`). **Reescribirla para "adaptarla" sería tocar el texto que protege `cancelar_solicitud_interna` hoy.**
4. **Dos skills nuevas, moldeadas byte a byte sobre `cancelar-solicitud/SKILL.md`** — que es la única de las seis existentes con flujo de dos pasos, y cuya estructura (Paso 1 listado / Paso 2 eco / Paso 3 **esperar un mensaje NUEVO** / Herramientas) ya está probada:

   - `.claude/skills/resolver-reembolso/SKILL.md` — `description`: *"Cuando el empleado quiera aprobar, rechazar o reabrir una escalación de reembolso pendiente de validación."*
   - `.claude/skills/resolver-solicitud/SKILL.md` — `description`: *"Cuando el empleado quiera aprobar o rechazar una solicitud interna de otro empleado que le toque validar."*

   Con **tres** desviaciones deliberadas del molde, todas por lo que este dominio tiene y `cancelar` no:
   - **Paso 0 nuevo — la acción antes que el id**: pedir la acción inequívoca (pto 2) **antes** de listar, porque el listado de reembolso **depende de la acción** (`reabrir` lista rechazados, `aprobar`/`rechazar` listan pendientes — `resolver-escalacion-reembolso.ts:75-77`). Pedir un listado con la acción equivocada muestra el conjunto equivocado.
   - **El eco se repite tal cual, con el monto**: la skill instruye a **no resumir ni redondear** el eco que devuelve la herramienta. Es el control de R6 y del ADR 219 pto 3.
   - **Nada sobre rol ni sobre autoaprobación**: la skill **no** anticipa quién puede resolver qué. Si el modelo intentara filtrar por rol antes de invocar, estaría reimplementando el gate en el peor lugar posible — el prompt. **Que el rechazo llegue de la función determinista, siempre.** Mismo espíritu que el ADR 207 pto 1, un nivel más afuera.
5. ★ **Nada de lo anterior es una garantía, y la spec tiene que decirlo.** El requirement se redacta **sobre el efecto verificable** —que la tool **no se invoque con `confirmado: true` en el mismo turno**, cosa que el predicado `origenCasoId !== casoIdActual` hace **estructuralmente imposible** (`confirmacion-operaciones-store.ts:31-38`)— y el prompt se declara como refuerzo. **Instrucción para `sdd-spec`: nunca redactar un requirement cuyo único mecanismo de cumplimiento sea una línea de prompt.** Es la lección literal de `soporte-prompt.ts` que la propuesta mandó tener presente.

---

## 12. Contratos de interfaz

```ts
// src/core/operaciones/operaciones-contract.ts — SIGUE SIN IMPORTS
export const OPERACION_RESOLVER_REEMBOLSO = "resolver_reembolso";
export const OPERACION_RESOLVER_SOLICITUD = "resolver_solicitud";

export const OPERACIONES_NEGOCIO = [ /* …las seis… */,
  OPERACION_RESOLVER_REEMBOLSO, OPERACION_RESOLVER_SOLICITUD ] as const;  // ★ OCHO

/** Elección de operación, NO veredicto (ADR 206 pto 3). Duplicación local
 *  deliberada de `AccionEscalacion`/`AccionSolicitud` — mismo criterio
 *  "sin imports" que `DecisionVentaModelo` (`:57-58`). */
export type AccionReembolsoModelo = "aprobar" | "rechazar" | "reabrir";
/** ★ NUNCA "cancelar": la cancelación es autoservicio y tiene operación propia (ADR 217). */
export type AccionSolicitudModelo = "aprobar" | "rechazar";

/** `ventaId` ausente ⇒ modo listado, sin tocar ninguna ranura (ADR 208). ★ SIN campo `confirmado` (§0.1). */
export interface OperacionResolverReembolso {
  readonly operacion: typeof OPERACION_RESOLVER_REEMBOLSO;
  readonly accion: AccionReembolsoModelo;
  readonly ventaId?: string;
}
export interface OperacionResolverSolicitud {
  readonly operacion: typeof OPERACION_RESOLVER_SOLICITUD;
  readonly accion: AccionSolicitudModelo;
  readonly solicitudId?: string;
}
```

```ts
// src/core/operaciones/operaciones-contract.ts — la ranura, generalizada (ADR 209/212/213)
export const DOMINIO_REEMBOLSO = "reembolso";
export const DOMINIO_SOLICITUD = "solicitud";
/** Vocabulario REUSADO de la ranura única de la TUI (`build-on-comando-empleado.ts:272-299`, ADR 55). */
export type DominioConfirmacion = typeof DOMINIO_REEMBOLSO | typeof DOMINIO_SOLICITUD;
export type AccionConfirmable = "aprobar" | "rechazar" | "reabrir" | "cancelar";

/** Identifica UNA ranura. `dominio` + `itemId` son la LLAVE (ADR 212); `accion` es PREDICADO (ADR 213). */
export interface LlaveConfirmacion {
  readonly dominio: DominioConfirmacion;
  /** ★ `itemId`, no `solicitudId` — ahora también transporta un `ventaId` (ADR 209 pto 3). */
  readonly itemId: string;
  readonly accion: AccionConfirmable;
}

export interface ConfirmacionOperacionPort {
  /** `true` si hay una pendiente de ESTA llave Y ESTA acción que este turno puede confirmar
   *  (`origenCasoId !== casoIdActual`, ADR 166 pto 3 — predicado INTACTO). */
  estaConfirmada(llave: LlaveConfirmacion, empleadoId: string, casoIdActual: string): boolean;
  marcarPendiente(input: LlaveConfirmacion & {
    readonly casoId: string;
    readonly empleadoId: string;
    readonly origenCasoId: string;
  }): void;
  /** Consume UNA ranura. ★ Nunca "todas las del empleado" — eso es `limpiarEmpleado`, y vive en el adaptador (ADR 214 pto 4). */
  consumir(llave: LlaveConfirmacion): void;
}
```

```ts
// src/adapters/web/confirmacion-operaciones-store.ts
/** Map<empleadoId CRUDO, Map<`${dominio}:${itemId}`, ConfirmacionPendiente>> (ADR 212). */
export interface ConfirmacionOperacionesStore {
  /** Ranuras propias de `empleadoId` — N empleados concurrentes nunca se pisan. SIN CAMBIO de firma. */
  paraEmpleado(empleadoId: string): ConfirmacionOperacionPort;
  /** ★ NUEVO (ADR 214 pto 4): borra TODAS las ranuras del empleado. Para `handleLogout`. Idempotente. */
  limpiarEmpleado(empleadoId: string): void;
}
export const CONFIRMACIONES_PENDIENTES_MAX = 8;  // techo por empleado; al superarlo evicta la más vieja
```

```ts
// src/core/ventas/resolver-escalacion-reembolso.ts — ADITIVO, sin cambio de firma (ADR 211 pto 5 / ADR 215)
export type ResolverEscalacionResult =
  | /* …los cinco de hoy, sin tocar — incluido `no_autorizado` con su `ventaId`… */
  | {
      readonly resultado: "autoaprobacion_prohibida";
      readonly accion: AccionEscalacion;
      readonly itemId: string;   // ★ `itemId`, no `ventaId` (ADR 211 pto 5)
      readonly casoId: string;
    };
```

```ts
// src/core/operaciones/validar-operacion.ts — CUARTA tabla (ADR 217), sin imports
const VALORES_PERMITIDOS_POR_OPERACION: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
// + dos filas en CAMPOS_POR_OPERACION / _REQUERIDOS_ / _NUMERICOS_
```

```ts
// src/adapters/operaciones/index.ts — dos campos más en el objeto zod plano
accion: z.enum(["aprobar", "rechazar", "reabrir"]).optional(),
ventaId: z.string().optional(),
```

**Lo que NO cambia de firma, y es verificable por `git diff`**: `paraEmpleado`, `SesionEmpleado`, `RolEmpleadoPort`, `puedeResolverAjeno`, `VentaStorePort`, `SolicitudStorePort`, `EscalacionListada`, `RegistroAccionesEmpleadoPort`, `AccionEmpleado`, `EjecutarOperacionDeps`, `EjecutarOperacionInput`, `ResolverEscalacionDeps`, `ResolverSolicitudDeps`, `resolverSolicitudInterna` (entera), el contrato de `POST /operaciones` y el de `POST /login`.

---

## 13. Flujo de datos — un turno de `resolver_reembolso`, de punta a punta

```
empleado: "aprobá el reembolso de V1"        (mensaje N, casoId = C_N)
  │
  ▼  POST /operaciones  Bearer <token>       [CONTRATO SIN CAMBIO]
server.ts · handleOperaciones
  ├─ sesionStore.buscar(token) ─────────────► SesionEmpleado            (401 si no)
  ├─ confirmacionStore.paraEmpleado(empleadoId) ──► ConfirmacionOperacionPort   [:722 SIN CAMBIO]
  └─ conversacionStore.paraSesion(token) ───► ConversacionEmpleadoPort  [v3.9, SIN CAMBIO]
  ▼
build-on-operaciones-empleado.ts   [★ CERO CAMBIOS — `rolPort` ya está en `ejecutarDeps:164`]
  ▼
adapters/operaciones · tool `operacion_negocio`
  ├─ zod plano: { operacion:"resolver_reembolso", accion:"aprobar", ventaId:"V1" }
  └─ validarOperacion → whitelist de campos + ★ whitelist de VALORES de `accion` (ADR 217)
  ▼
ejecutar-operacion.ts · ejecutarResolverReembolso        ★ CERO lógica de autorización (ADR 207)
  │
  ├─ ventaId === undefined ──► resolverEscalacionReembolso({accion, confirmado:false})
  │                            └─ rama B: LISTADO, cero escrituras ──► texto ──► FIN
  │
  ├─ estaConfirmada({dominio:"reembolso", itemId:"V1", accion:"aprobar"}, empleadoId, C_N)
  │      │
  │      ├─ false ─► resolverEscalacionReembolso({..., confirmado:false})
  │      │            ├─ no_aplicable        ──► texto, sin fila          ──► FIN
  │      │            └─ requiere_confirmacion
  │      │                 └─ marcarPendiente({dominio, itemId, accion, casoId, empleadoId, origenCasoId:C_N})
  │      │                    ──► ECO con monto + cliente + caso           ──► FIN
  │      │
  │      └─ true  ─► consumir({dominio, itemId, accion})    ← ANTES de ejecutar (ADR 36)
  │                  resolverEscalacionReembolso({..., confirmado:true})
  │                     ├─ E   !puedeResolverAjeno      ──► no_autorizado            ──► fila + texto
  │                     ├─ E-bis ★ vendedorId===empleadoId ──► autoaprobacion_prohibida ──► fila + texto
  │                     ├─ F   CAS ok                   ──► aplicada  (fila DENTRO de la txn) ──► texto
  │                     └─ F'  CAS perdido              ──► no_aplicable/cas         ──► fila + texto
  ▼
200 {casoId, respuesta}          [CONTRATO SIN CAMBIO]
```

★ **Dónde NO aparece `puedeResolverAjeno` ni `vendedorId`**: en ningún punto de `ejecutar-operacion.ts`. Es lo que verifica el test mecánico del ADR 207 pto 2 ampliado por el ADR 211.

---

## 14. Archivos — con estimación de líneas para `sdd-tasks`

| Archivo | Acción | Prod | Test | Qué |
|---|---|---|---|---|
| `src/core/operaciones/operaciones-contract.ts` | Modified | ~70 | ~40 | 2 constantes + 2 interfaces + unión a 8 + `LlaveConfirmacion`/`DominioConfirmacion`/`AccionConfirmable` + puerto con 3 firmas nuevas. Test de "sin imports" ya existe: **reverificarlo** |
| `src/adapters/web/confirmacion-operaciones-store.ts` | Modified | ~75 | ~200 | `Map` de `Map`s, `llaveInterna`, techo + evicción, `limpiarEmpleado`, encabezado reescrito |
| `src/adapters/web/server.ts` | Modified | ~3 | ~35 | `handleLogout` pasa a `limpiarEmpleado` + su doc-comment (§0.2) |
| `src/core/operaciones/validar-operacion.ts` | Modified | ~40 | ~85 | 2 filas × 3 tablas + **cuarta tabla** de valores permitidos + cláusula en el `some` |
| `src/adapters/operaciones/index.ts` | Modified | ~12 | ~45 | `accion` + `ventaId` en el zod plano, `OPERACIONES_TOOL_DESCRIPTION` |
| `src/core/ventas/resolver-escalacion-reembolso.ts` | ★ **Modified — ACOTADO** | **~20** | ~130 | Condición (7) + miembro de unión (6) + rama E-bis del encabezado (7). **Nada más: cualquier otra línea es alcance filtrado** |
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | ~165 | ~280 | `ejecutarResolverReembolso` (~80) + `ejecutarResolverSolicitud` (~60) + 2 tablas `accion`→literal + 2 ramas del `switch` + imports |
| `src/core/commands/comando-empleado.ts` | Modified | **−65** | ~35 | −5 descriptores, −5 brazos de la unión, doc-comment `:169-180` y `:380-385` reescritos (★ stale, §0.3) |
| `src/build-on-comando-empleado.ts` | Modified | **−300** | **−250** | Baja de `manejarEscalacion`, `manejarResolucionSolicitud`, sus 5 ramas del `switch`, `ACCION_ESCALACION_INFO`, `ACCION_SOLICITUD_COMANDO`, `formatearEco`/`formatearListado`/`formatearEcoSolicitud`/`formatearListadoSolicitudes`/`MENSAJE_LISTADO_SOLICITUDES_VACIO`, y las ramas `dominio:"reembolso"`/`"solicitud"` de `ConfirmacionPendiente` (quedaría **sólo `"propuesta"`**) |
| `src/core/agents/definitions.ts` | Modified | ~5 | ~15 | `INSTRUCCION_OPERACIONES_EMPLEADO` + línea de `accion` |
| `src/core/ventas/soporte-prompt.ts` | Modified | ~5 | ~15 | Ídem, duplicado deliberado |
| `.claude/skills/resolver-reembolso/SKILL.md` | **New** | ~55 | — | Molde `cancelar-solicitud`, con Paso 0 |
| `.claude/skills/resolver-solicitud/SKILL.md` | **New** | ~50 | — | Ídem |
| `src/core/commands/registro-acciones-contract.ts` | Modified | ~4 | — | **Sólo comentarios** (`:46-47`): cero constantes nuevas |
| `src/core/commands/comando-empleado.test.ts` | Modified | — | ~−25 | ★ El `describe` de `:719` (*"los cinco comandos HITL bloqueados … siguen matcheando"*) **se invierte**: pasa a verificar que NO matchean y caen a `ayuda` |
| `docs/ARC42_...md`, `README.md`, `docs/progreso/v3.10-.../` | Modified/New | ~150 | — | ADR 151 EJECUTADO, **R7 CERRADA con mecanismo + R11 residual**, arc42 `:557` y `:567` corregidos, evidencia manual |
| **`src/core/solicitudes/resolver-solicitud-interna.ts`, `core/auth/*`, `puedeResolverAjeno`, `VentaStorePort`/la query/la proyección, `build-on-operaciones-empleado.ts`, `repository.ts`, las otras 5 deterministas, las 3 puras de reporte, rama `/soporte`, A2A entrante, `package.json`** | **Sin cambio** | **0** | — | ★ **Si aparecen en el diff, el alcance se filtró** |

**Total estimado**: ~+400 prod netas (≈ +765 altas, −365 bajas) + ~+880 test + ~150 docs. **Muy por encima del presupuesto de 400 por PR (R3, Alta).**

### 14.1 Corte sugerido en **`feature-branch-chain`** — cinco slices

El orden respeta el *Approach* de la propuesta (ranura primero, núcleo segundo, dispatcher tercero) y la regla del ADR 210 pto 1: **cada baja viaja en el mismo PR que el alta de su dominio**. `sdd-tasks` hace el corte fino.

| # | Slice | ~Líneas | Verificación autónoma | Rollback |
|---|---|---|---|---|
| 1 | **Ranura multi-slot** + renombre `itemId` + `accion` en el predicado + techo/evicción + `limpiarEmpleado` + `handleLogout` + migración de `cancelar_solicitud_interna` | ~310 | `npm test` **con la suite vigente de `cancelar_solicitud_interna` como red**; regresión de autoconfirmación imposible; logout limpia N ranuras | Volver al `Map<empleadoId, …>`: barato en código, sin residuo (estado de proceso) |
| 2 | ★ **Prohibición de autoaprobación en `resolverEscalacionReembolso`** + miembro de unión + evento + los **dos** escenarios obligatorios | ~150 | El rojo inicial #1 de la propuesta vive acá. Diff de núcleo de **~20 líneas**, legible de una mirada | Quitar condición + miembro. **Reabre R7 — y entonces hay que reabrirla también en arc42 y spec, en el mismo movimiento** |
| 3 | **`resolver_solicitud`** (contrato + whitelist + zod + dispatcher + auditoría) **+ baja de `/aprobar-solicitud` y `/rechazar-solicitud`** | ~380 | Rol base ⇒ `no_autorizado`; autoaprobación ⇒ prohibida; listado con cero escrituras; `DESCRIPTORES` en 15 | Revertible **sin** tocar reembolso |
| 4 | **`resolver_reembolso`** (ídem) **+ baja de los tres `/…-reembolso`** | ~420 | Ídem + ★ los dos escenarios de R7 **por el canal conversacional**; `DESCRIPTORES` en **13** | Revertible **sin** tocar solicitud |
| 5 | **Prompt × 4 superficies + dos skills + arc42/README + evidencia manual** | ~270 | Success Criteria firmados; los **cuatro** lugares stale corregidos | Trivial |

★ **El slice 2 conviene que viaje SOLO**: es el único que toca una función determinista y su valor de review es enteramente *"¿el diff está acotado a lo que el ADR 211 pto 5 enumera?"*. Mezclarlo con el dispatcher lo vuelve invisible.

★ **Los slices 3 y 4 son intercambiables en orden pero NUNCA fusionables**: juntos son ~800 líneas, el doble del presupuesto, y perderían la propiedad de rollback por dominio que el *Rollback Plan* pto 4 de la propuesta pidió explícitamente.

---

## 15. Testing (TDD estricto — `AGENTS.md`: test primero en toda tarea con lógica)

**Los dos rojos iniciales, en el orden que la propuesta fijó** (Success Criteria, último punto):

1. ★ *"el vendedor de una venta, con rol elevado, aprueba el reembolso de su propia venta"* sobre `resolverEscalacionReembolso` — **hoy pasa en verde de la forma equivocada** (la aprobación procede). El rojo se construye asserteando `autoaprobacion_prohibida`, que todavía no es miembro de la unión ⇒ **falla de tipo antes que de aserción**, que es el mejor rojo posible.
2. *"un empleado con rol base aprueba un reembolso por el canal conversacional"* — hoy **no puede ni escribirse**: la operación no existe.

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Unit | **Store multi-slot**: pedir confirmación de un reembolso **no borra** la de una solicitud ni la de otro reembolso; dos empleados concurrentes no se pisan; `itemId` con `:` adentro no colisiona con otra llave (ADR 212 pto 3); techo de 8 evicta la **más vieja**; `limpiarEmpleado` borra N ranuras y es idempotente | Sin reloj, sin dobles — el store no tiene dependencias |
| Unit ★ | **Regresión del invariante**: dos invocaciones con el **mismo `casoIdActual`** no se autoconfirman, corriendo contra la ranura **NUEVA** (ADR 166 pto 3, arc42 `:566`). **Obligatorio** | Molde de `ejecutar-operacion.test.ts` |
| Unit ★ | **ADR 213**: pendiente `(E, reembolso, V1, rechazar)` + pedido `(…, aprobar)` en turno posterior ⇒ `estaConfirmada` **`false`**, la ranura se **sobreescribe** con `aprobar`, y **el CAS no corre**. **Es el test que separa este diseño de un hueco** | Doble de store que falla si recibe una escritura |
| Unit | **`validarOperacion`**: `resolver_solicitud {accion:"reabrir"}` ⇒ `undefined`; `{accion:"cancelar"}` ⇒ `undefined`; clave extra ⇒ `undefined`; `resolver_reembolso` sin `accion` ⇒ `undefined`; **`confirmado` como clave ⇒ `undefined`** (§0.1, regresión) | Función pura |
| Unit ★ | **Núcleo, R7 en los DOS sentidos** (ADR 211 pto 4 — **sin los dos, el criterio no se da por cumplido**): (i) `venta.vendedorId === sesion.empleadoId`, rol elevado, las **tres** acciones ⇒ `autoaprobacion_prohibida`, **cero llamadas a `aprobar/rechazar/reabrirEscalacionReembolso`**; (ii) `vendedorId` externo (molde `POST /ventas`) ⇒ **no dispara** y la resolución procede | Doble de `VentaStorePort` que **lanza** si recibe una escritura |
| Unit | **Orden de evaluación (ADR 159)**: rol base + venta propia ⇒ `no_autorizado`, **no** `autoaprobacion_prohibida`. Es lo que hace que los textos del ADR 216 lleguen al actor correcto | |
| Unit mecánico ★ | **`ejecutar-operacion.ts` no contiene** `autorizacion-resolucion`, `puedeResolverAjeno`, ni `vendedorId` junto a `empleadoId` (ADR 207 pto 2 + ADR 211). Molde ADR 98 pto 3, ya reusado por v3.8 y v3.9 | Aserción sobre la fuente como string |
| Unit mecánico | **El schema NO expone `confirmado`** en ninguna de las ocho operaciones, ni en el zod plano ni en `CAMPOS_POR_OPERACION` (§0.1) | Aserción sobre el objeto |
| Integración | **Dispatcher**: listado sin id ⇒ cero escrituras; eco ⇒ cero escrituras; confirmado ⇒ CAS; **fila de auditoría con el literal correcto por `accion`** en `no_autorizado`, `autoaprobacion_prohibida` y CAS perdido; **camino feliz NO escribe desde el dispatcher** (ADR 218 pto 5) | SQLite en memoria, molde `ejecutar-operacion.test.ts` |
| Integración ★ | **R7 por el canal conversacional, de punta a punta**: `registrar_venta` como E (⇒ `vendedorId = E`), devolución escalada, E con rol elevado invoca `resolver_reembolso{accion:"aprobar"}` y confirma ⇒ **prohibida, cero cambios en `ventas` y `casos`**. Es el escenario que vuelve **real** el control, no de fixture | SQLite en memoria |
| Integración ★ | **El test negativo obligatorio sobre `POST /ventas`**: venta dada de alta por el endpoint externo (sin sesión de empleado, `vendedorId` del payload) ⇒ un administrador **puede** resolver su reembolso. **No negociable** (proposal, Aclaración 3(b)) | `server.test.ts` + SQLite en memoria |
| Integración | **`handleLogout` limpia N ranuras**: dos confirmaciones pendientes de dominios distintos ⇒ tras `POST /logout`, ninguna coincide | Dobles planos de `server.test.ts` |
| Unit | **`DESCRIPTORES` tiene 13**, ninguna transaccional, el **orden relativo de las que quedan no cambió**, y el escenario de `/ayuda` refleja el conteo. ★ El `describe` de `comando-empleado.test.ts:719` **se invierte**: los cinco caen a `{ tipo: "ayuda", motivo: "desconocido" }` | |
| Manual E2E | Listado sin id; resolución confirmada en dos turnos; rechazo por rol base; ★ **rechazo por autoaprobación en CADA dominio**, el de reembolso **sobre una venta dada de alta por el propio canal conversacional**; cambio de `accion` entre turnos (ADR 213) exigiendo eco nuevo | `docs/progreso/v3.10-aprobacion-conversacional-hitl/`, molde `verificacion-manual-tarea-15.md` |

---

## 16. Migración y rollback

**Sin migración.** Cero tablas, columnas, índices y backfill — cerrar R7 no agregó ni una fila de rollback (ADR 211 pto 3/5).

Rollback por capas, de más barato a más caro, **independientes entre sí**:

1. **Prompt, skills y docs** ⇒ borrar dos archivos y revertir cuatro párrafos.
2. **Un dominio completo** (slice 3 **o** 4) ⇒ quitar su operación del contrato, su fila de las cuatro tablas de validación, su rama del dispatcher y **restaurar sus descriptores**. ★ **Lo que NO se puede revertir por separado es una baja de comando sin su alta** — dejaría la operación sin superficie (ADR 210 pto 1).
3. **La prohibición de autoaprobación** ⇒ quitar 13 líneas de `resolver-escalacion-reembolso.ts`. **Sin residuo de datos**, pero ★ **reabre R7**: si se revierte, hay que reabrir la deuda en el arc42 **y** en `reembolso-resolucion-escalacion/spec.md:9` **en el mismo movimiento**, nunca en silencio.
4. **La ranura multi-slot** ⇒ volver al `Map<empleadoId, ConfirmacionPendiente>` y a `consumir()`/`paraEmpleado().consumir()` en el logout. Barato en código; ventana de confusión si hay confirmaciones en vuelo al deploy — **son estado de proceso: un reinicio las borra, y perderlas cuesta repetir el pedido, nunca una operación**.

**Ninguna reversión toca datos de negocio.** El único estado nuevo es la llave de la ranura, que muere con el proceso.

---

## 17. Riesgos nuevos que el diseño descubrió (no anticipados por la propuesta)

| # | Riesgo | Prob. | Tratamiento |
|---|---|---|---|
| **R12** ★ | **`handleLogout` de v3.9 llama a `consumir()` con semántica de ranura única** (`server.ts:795`): con multi-slot, un logout limpiaría una sola ranura o ninguna, rompiendo la garantía del **ADR 202 pto 3** sin que ningún test vigente lo note (hoy nunca hay más de una) | **Alta si se ignora** | ADR 214 pto 4: `limpiarEmpleado` en el store del adaptador + test con **dos** ranuras de dominios distintos. ★ **Es la materialización concreta de la R10 de la propuesta** — el solapamiento con v3.9 existe y ya está en la rama |
| **R13** ★ | **Cambio de `accion` sobre el mismo ítem ejecuta sin confirmación** si `accion` no entra al predicado (§4). Deja el camino del dinero sin su único control de deliberación, **en silencio y en verde** | **Alta si se ignora** | ADR 213: `accion` en `ConfirmacionPendiente` y como cuarta condición del predicado, molde literal de la TUI (`build-on-comando-empleado.ts:1117`). Test dedicado, obligatorio |
| **R14** ★ | **Cruce de dominios por `accion` compartida**: `resolver_solicitud {accion:"reabrir"}` pasa las dos validaciones y **lanza** en un `switch` documentado como exhaustivo, degradando a *"error interno"* y ensuciando el log con un `operacion-fallida` que parece un bug del arnés | Media | ADR 217: cuarta tabla de valores permitidos por operación + dos tests en negativo. **Y `"cancelar"` queda prohibido explícitamente en `resolver_solicitud`**, para que no nazca una segunda vía de cancelar |
| **R15** ★ | **La ranura única era su propio recolector de basura.** Al pasar a N, un empleado acumula confirmaciones pendientes sin techo mientras dure su sesión | Baja-Media | ADR 214 pto 3: techo de 8 con evicción de la más vieja. **Rota, nunca rechaza.** Sin TTL (requeriría inyectar un reloj en un store sin dependencias) |
| **R16** ★ | **El rechazo llega DESPUÉS del eco, no antes** — el gate de rol está en la rama E, posterior al `!confirmado` (`:150-158`). Un empleado con rol base ve *"vas a aprobar el reembolso de V1 por $X"* y recién al confirmar se entera de que no puede; el vendedor ve el eco de **su propia** venta antes del rechazo | Media | **Preexistente desde v3.5** (idéntico en solicitudes, `:210` antes de `:220`), **no introducido acá**. ★ **"Arreglarlo" adelantando el chequeo al dispatcher es exactamente lo que el ADR 207 pto 1 prohíbe** — sería un segundo punto de verdad. La salida legítima sería mover el gate dentro de la función pura, que es **change propio**. Se declara, no se arrastra en silencio |
| **R17** | **La baja de los cinco comandos deja ~300 líneas de código muerto en `build-on-comando-empleado.ts`** (formateadores, tablas de acción, dos ramas de `ConfirmacionPendiente`) que el compilador puede no señalar según la config de `noUnusedLocals` | Media | Barrido explícito en el slice correspondiente, con `ConfirmacionPendiente` reducido a **una sola rama** (`"propuesta"`) como criterio de "quedó limpio". **Si la unión conserva las ramas `reembolso`/`solicitud`, la baja quedó a medias** |

---

## 18. Open Questions para el checkpoint

- [ ] ★ **§0.1 — `confirmado` no es campo del schema.** El diseño corrige la notación de la propuesta para no violar el invariante *"`confirmado` es inexpresable por el modelo"*. **Es una corrección de lectura, no un cambio de decisión**, pero conviene que la ratifiques porque la propuesta lo escribió tres veces con la otra forma.
- [ ] **§0.2 / R12 — `server.ts` entra al diff.** La propuesta no lo lista en *Affected Areas*. Es **una llamada** en `handleLogout`, exigida por el multi-slot. ¿Se acepta la ampliación de alcance, o preferís que `limpiarEmpleado` viaje como change propio? (Recomendación: **acá**; separarlo dejaría un logout que no limpia, o sea la garantía del ADR 202 rota entre dos merges.)
- [ ] ★ **ADR 213 — `accion` en el predicado.** Es la decisión con más consecuencia del documento y **cierra un hueco que la propuesta no vio**. Confirmá que no se lee como reabrir la llave que el ADR 209 pto 1 fijó: **la llave no cambia**, cambia el predicado.
- [ ] **ADR 218 pto 6 — el listado NO deja fila de auditoría.** El ADR 208 pto 3 lo dejó a criterio de esta fase. Decidido que no, con el argumento de que registrar prolijamente un acceso que igual permitimos es resolver **R5** a medias. ¿Lo ratificás, o querés fila?
- [ ] **R16 — el rechazo llega después del eco.** Preexistente desde v3.5 y **estructural** (el gate está tras el `!confirmado`). Se declara y no se toca, porque adelantarlo en el dispatcher viola el ADR 207. ¿Se acepta como limitación declarada, o querés el change propio que mueva el gate dentro de la función pura?
- [ ] **Numeración del hito.** El diseño asume `v3.10.0` y `docs/progreso/v3.10-aprobacion-conversacional-hitl/`, pero eso depende de que v3.9 cierre y taguee primero — que es el estado de la rama actual, no un hecho consumado. **Sigue siendo decisión tuya** (punto 5 de la propuesta).
