# Propuesta: Autorización de empleado — el modelo mínimo que responde *qué podés*, y la separación de funciones que hoy no existe

**Origen**: **decisión del checkpoint humano** sobre `operaciones-negocio-conversacionales`. Esa propuesta verificó que este repo **no tiene modelo de roles** y levantó el riesgo **R10**; su **ADR 151 pto 8** preguntó explícitamente al stakeholder si la deuda se heredaba o se arreglaba primero. **El checkpoint respondió: se arregla primero**, rechazando la inclinación escrita de aquella propuesta. Este change es ese arreglo.

**Pero no nace del aire, y eso importa para defenderlo**: es una deuda que **el propio repo nombró, ubicó y le asignó dueño**, y el dueño cerró sin hacerla. Tres citas textuales, verificadas en esta fase:

- `tui-canal-empleado/proposal.md:65` — *"**Roles y permisos.** Todo empleado con sesión activa puede ejecutar los tres comandos privilegiados. No hay 'quién puede aprobar qué'; eso es el modelo de autorización de Hito 5 (HITL generalizado). **`/login` responde *quién sos*, no *qué podés*.**"*
- `tui-canal-empleado/proposal.md:586` — *"los ADR 30-33 le entregan a Hito 5 un actor **autenticado** en vez de uno atestado — que es **la pieza que un modelo de autorización necesita antes de poder existir**"*.
- Y la más elocuente, porque está **en el esquema de la base**, no en un documento de planificación — `0006_credenciales_empleado.ts:11-16`: *"★ SIN columna `activo` ★: la desactivación está DIFERIDA (ADR 33 punto 3, R15). Arrastra una política que nadie definió... **y eso es el modelo de autorización de Hito 5**."*

**Hito 5 es `hito-2.0-delegacion-subagentes` (v2.0)** — verificado, no asumido: `docs/Plan_Implementacion_Harness_Empresarial.md:304` lo titula *"Hito 5: Delegación a subagentes"* y `docs/progreso/v2.0-delegacion-subagentes/README.md:1` lo confirma. **Ese hito cerró, entregó el HITL de solicitudes internas… y nunca construyó el modelo de autorización que tenía asignado.** La deuda no se heredó por descuido: se heredó porque su dueño cerró sin ella y nadie volvió a mirar. Este change la cobra.

**Rama prevista**: `hito/v3.5-autorizacion-empleado` (fijada por el checkpoint) · **Carpeta de progreso**: `docs/progreso/v3.5-autorizacion-empleado/`.

**No es un hito del Plan.** Mismo tratamiento que `tui-canal-empleado`, `definicion-skills` y `operaciones-negocio-conversacionales`: carpeta descriptiva sin prefijo `hito-X.Y`. **La versión es decisión del checkpoint**, igual que en los tres precedentes.

**Nombre de la carpeta.** Se eligió `autorizacion-empleado` sobre `modelo-roles-permisos` **porque es el vocabulario que el propio repo ya usa para nombrar lo que falta** —*"el modelo de autorización de Hito 5"*, dos veces, una de ellas en el esquema— y porque hace pareja explícita con la capability existente **`autenticacion-empleado-tui`**, que es la que dejó este hueco. *Autenticación / autorización* es el eje real, y el repo ya lo escribió así.

---

## Aclaración previa 1: el techo real de numeración, **reverificado**

Regrepeado sobre **todo** `openspec/changes/*` con `ADR 1(4[5-9]|[5-9][0-9])` y `RD-(6[5-9]|[7-9][0-9])`. **No se heredó de `operaciones-negocio-conversacionales`**, precisamente porque esa propuesta movió el techo dos veces en una sola sesión y el precedente de `definicion-skills` (que descubrió que el techo real era ADR 102 y no 93) obliga a reverificar:

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **151** | `operaciones-negocio-conversacionales/proposal.md` — fijado por esa misma propuesta y por **ninguna otra**; no hay ADR ≥ 152 en el repo | **ADR 152** |
| **RD** | **RD-74** | ídem | **RD-75** |

## Aclaración previa 2 (★ **hallazgo de mayor impacto**): no hay **nada** sobre lo que construir — **no existe una tabla `empleados`**

La pregunta que esta fase tenía que contestar era *"¿hay algo ya en el esquema —un jefe, un departamento, un flag— sobre lo que un modelo de roles pueda apoyarse, o es desde cero?"*. **Es desde cero, y bastante más desde cero de lo que la pregunta suponía.** Verificado migración por migración sobre las **doce** que declara `src/adapters/memory/migrations/index.ts:30-43` (`0001` a `0012`):

1. ★ **No existe una tabla `empleados`.** No es que exista sin columna de rol: **no existe**. La única tabla que materializa a un empleado es `credenciales_empleado` (`0006`), y tiene **cuatro columnas**, todas de autenticación:

   ```sql
   CREATE TABLE IF NOT EXISTS credenciales_empleado (
     empleado_id   TEXT PRIMARY KEY,
     password_hash TEXT NOT NULL,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );
   ```

   Sin `rol`, sin `permisos`, sin `departamento`, sin `jefe_id`/`supervisor_id`, sin `nombre`, **y ni siquiera `activo`** — esa ausencia está documentada a propósito en el encabezado del archivo (`:11-16`) y es la cita del *Origen*. **No hay ni una columna rol-adyacente en todo el esquema de empleado.**

2. **`vendedores` (`0004:40-44`) NO sirve de base, y confundirlo sería el error caro de este change.** Existe —`id`, `nombre`, `created_at`— pero es **otro espacio de identidades**: `ventas.vendedor_id REFERENCES vendedores(id)`, y **no hay ninguna FK, ninguna columna y ningún código que ligue un `vendedor_id` con un `empleado_id`**. Un vendedor es el actor de una comisión; un empleado es el actor autenticado de una acción. **Son dos poblaciones distintas que casualmente podrían compartir strings.** Apoyar roles sobre `vendedores` ataría autorización a *quién cobra comisión*, que no tiene nada que ver. Ver ADR 152, alternativa rechazada 3.

3. **Las tablas de dominio ya guardan actor, y deliberadamente SIN FK.** `registro_acciones_empleado.empleado_id NOT NULL` (`0005:47`) y `solicitudes_internas.solicitante_id NOT NULL` / `resuelta_por` (`0008:47,53`) son todas **sin FK a `credenciales_empleado`**, por una razón escrita y buena: *"las filas de auditoría tienen que SOBREVIVIR al empleado que las produjo"* (`0005:11-18`), *"una solicitud tiene que SOBREVIVIR al empleado que la pidió"* (`0008:12-17`). **Este change NO reabre esa decisión** — es correcta y es la que hace que el histórico no se pode. Pero fija una restricción real de diseño: **una tabla nueva de roles tampoco puede ser FK-referenciada por el dominio**, y el gate tiene que tolerar un `empleado_id` que ya no tenga fila.

4. ★ **Lo único rol-adyacente que SÍ existe, y es la semilla entera de este change**: `solicitudes_internas` **ya distingue `solicitante_id` de `resuelta_por`** (`0008:47,53`). El esquema **ya sabe** que quien pide y quien resuelve son papeles distintos. Lo que no existe es **nada que impida que sean la misma persona.**

## Aclaración previa 3: la deuda es peor de lo que R10 decía — hoy un empleado puede **aprobar su propia solicitud**

R10 se enunció como *"cualquier empleado autenticado puede aprobar la solicitud de cualquier otro"*. Verificado en esta fase, **es más grave que eso**, y el caso concreto conviene tenerlo escrito porque es el que hace innegociable el change:

- `esAccionAutoservicio(accion)` es **literalmente** `accion === ACCION_CANCELAR_SOLICITUD` (`resolver-solicitud-interna.ts:44-47`), y su comentario dice que es *"única fuente de verdad para el gateo por acción (soloPropias + chequeo de dueño)"*. O sea: **el chequeo de dueño existe SÓLO para `cancelar`.**
- Para `aprobar` y `rechazar` **no hay ningún chequeo**: ni de rol (no existe), ni de dueño. **Nada impide que `sesion.empleadoId === solicitud.solicitanteId`.** Un empleado pide sus vacaciones con `/solicitar` y las aprueba él mismo con `/aprobar-solicitud`, y el sistema escribe su propio `empleadoId` en `resuelta_por` sin objetar.
- `resolverEscalacionReembolso` (`:107-168`) **no tiene ningún gate de autorización, punto.** Leído íntegro: usa `sesion.empleadoId` en `:147` y `:165` y **sólo ahí**, las dos veces para **atribución** (`ResolucionEscalacionInput.empleadoId` y el campo del `logEvent`). Auditoría, no permiso. Sabe **perfectamente quién** aprobó un reembolso; no tiene **ninguna** opinión sobre si podía.

**Esto no es sobre-permisividad: es ausencia de separación de funciones.** Y tiene una consecuencia que conviene decir sin rodeos: **la auditoría de este repo es impecable y completamente inútil como control.** `registro_acciones_empleado` registra con precisión quirúrgica quién aprobó qué — y no hay un solo lugar donde eso se pueda haber impedido. **Auditar sin autorizar es documentar el fraude, no prevenirlo.** Ver ADR 155.

---

## Intent

Este repo autentica bien y **no autoriza en absoluto**. `/login` responde *quién sos* —con scrypt, comparación en tiempo constante y TTL absoluto, todo sólido— y **nada en el sistema responde *qué podés***. La consecuencia operativa, verificada y no supuesta: cualquier empleado con sesión vigente puede aprobar el reembolso escalado de cualquier venta, resolver la solicitud interna de cualquier compañero, **y aprobar la suya propia**.

El requerimiento inmediato es de secuencia: el **ADR 151** de `operaciones-negocio-conversacionales` —mover cinco comandos privilegiados HITL a conversación— está **BLOQUEADO** hasta que esto cierre, por decisión del checkpoint. Pero **el problema no es de aquel change y no hay que venderlo así**: la conversación no crea este agujero, sólo lo vuelve trivialmente alcanzable. El agujero está abierto en el canal de comando desde `v2.0` y seguiría abierto aunque la conversación no existiera.

Lo que hace falta es **lo mínimo que cierra el agujero, y nada más**: una forma de distinguir **quién puede resolver la escalación o la solicitud de OTRO empleado**, más la prohibición de resolverse a uno mismo. No un RBAC, no una matriz de permisos, no límites por monto, no segundo aprobador. Esas cosas son buenas y **el propio repo ya las nombró como diferidas** (`tui-canal-empleado/proposal.md:572`); meterlas acá convertiría un change acotado y verificable en un proyecto.

---

## Scope

### In Scope

- **Modelo de rol de empleado, mínimo y enumerado** (ADR 152): el vocabulario canónico vive en el núcleo, en un contrato sin imports, molde `credenciales-contract.ts` / `ventas-contract.ts`. **Dos papeles, no una matriz**: quien opera sobre lo propio, y quien además resuelve lo ajeno.
- **Persistencia del rol** — migración **`0013`**, aditiva, con `CREATE TABLE IF NOT EXISTS` / columna nueva según **RD-75**. **Es la primera migración del repo que codifica una decisión de seguridad**, y su tratamiento de las filas existentes es el punto más delicado del change: ver **ADR 156**.
- **Puerto de lectura del rol**, molde exacto de `CredencialesEmpleadoPort` (`credenciales-contract.ts:21-23`): **una sola operación, de lectura, síncrona**. El núcleo no sabe de SQL.
- **Gate de autorización real en el núcleo determinista**, en `resolverEscalacionReembolso` y `resolverSolicitudInterna` (ADR 153). Con su variante de resultado tipada —molde de `no_es_dueno` (`resolver-solicitud-interna.ts:55-61`), que ya resolvió el problema de *"rechazar sin filtrar datos del ítem ajeno"* y cuya solución se reusa, no se reinventa.
- ★ **Prohibición de autoaprobación** (ADR 155): `aprobar`/`rechazar` una solicitud interna cuyo `solicitante_id` sea el propio `sesion.empleadoId` se rechaza **incluso si el rol alcanza**. Es separación de funciones, y es **independiente del modelo de roles** — se sostiene sola.
- **Provisioning del rol** en `src/empleados.ts`, que hoy es **el único escritor** de `credenciales_empleado` (`credenciales-contract.ts:14-17`: *"La TUI no puede crear credenciales, y eso es una propiedad del diseño, no un olvido"*). **Esa propiedad se conserva**: el rol se asigna por CLI, no desde la TUI.
- **Los cinco comandos privilegiados HITL pasan a poder fallar por autorización** — `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud` ganan una respuesta de *"no estás autorizado"* distinguible de *"no encontrada"* y de *"necesitás sesión"*.
- **Trazabilidad del rechazo por autorización**: un intento no autorizado **deja fila**. Es el caso en que la auditoría por fin sirve de control (ADR 155).
- **arc42 + README**: qué responde `/login`, qué responde el rol, y que **R10 queda cerrada** con nombre.

### Out of Scope

- **RBAC, tabla de permisos, ACL, permisos por acción, límites por monto, segundo aprobador, flujo de aprobación multinivel.** El propio repo los difirió por nombre (`tui-canal-empleado/proposal.md:572`: *"quién puede aprobar qué, límites por monto, segundo aprobador"*). **Este change entrega el eje que faltaba, no el sistema completo.** Ver ADR 152.
- **Desactivación de empleado (`activo`), límite de intentos de login / rate limiting, política de fortaleza de contraseña, recuperación de contraseña.** ★ **Se nombran explícitamente porque el comentario de `0006:11-16` las empaqueta junto a *"el modelo de autorización de Hito 5"*, y ese empaquetado es el riesgo de alcance número uno de este change.** Se toma **sólo la rebanada de autorización**. La desactivación sigue diferida (ADR 33 pto 3, R15 de `tui-canal-empleado`) con su paliativo vigente: rotar la contraseña.
- **Mover los cinco comandos privilegiados a conversación.** **Eso es el ADR 151 de `operaciones-negocio-conversacionales` y es un change aparte que corre DESPUÉS de éste.** Este change los deja como comandos **y los gatea**. Si se mezclaran, el diff tendría un cambio de canal y un cambio de permisos a la vez — y entonces *"el delta de autorización de aquel change es cero"* dejaría de ser verificable, que es justo lo que lo hacía auditable.
- **Comandos administrativos de TUI para gestionar roles** (`/asignar-rol`, alta de empleados desde la TUI). Diferido por el ADR 150 pto 1 de `operaciones-negocio-conversacionales` y por el ADR 33 de `tui-canal-empleado`. El provisioning por CLI alcanza para cerrar R10.
- ★ **Cualquier cosa que tenga que ver con `revision-pr-por-roles`.** Esa capability existe (`hito-2.0`/`hito-2.1`) y **es de roles de AGENTE** —Planner, Developer, Reviewer, verificado en su `spec.md:7`—, un eje que no se cruza con éste ni una vez. **Se nombra sólo para que nadie lo lea como colisión.**
- **Unificar `vendedores` con `empleado_id`.** Aclaración 2 pto 2. Es una limpieza de modelo de datos legítima y **no es este change**.
- **Agregar FK desde el dominio a la tabla de roles.** Aclaración 2 pto 3: rompería el invariante de supervivencia del histórico.
- **Autorización del adaptador web / de `POST /soporte` / del brazo A2A.** Ejes distintos, ya cubiertos o ya diferidos por sus propios changes.
- **Dependencias nuevas en `package.json`.**

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado por `Glob` en esta fase: **40 archivos**. `autorizacion-empleado` **no colisiona** con ninguno.

### New Capabilities

- **`autorizacion-empleado`** — el modelo y el gate: qué roles existen, dónde vive el rol, cómo llega al punto de decisión, qué se rechaza y con qué variante tipada, la prohibición de autoaprobación, y **los invariantes negativos**: el rol **no** viaja por parámetro de un comando ni de una herramienta; un `empleado_id` sin fila de rol **no** escala a autorizado; el gate **no** filtra datos del ítem ajeno al rechazar (molde `no_es_dueno`).

### Modified Capabilities

- **`autenticacion-empleado-tui`** (`tui-canal-empleado/specs/`) — **delta seguro y nombrado por el propio spec**: su línea de *Fuera de alcance* (`spec.md:9`) dice textual *"roles y permisos sobre qué puede hacer un empleado logueado"*. **Este change es exactamente eso**, así que esa frase deja de ser cierta y hay que moverla.
- **`reembolso-resolucion-escalacion`** (`tui-canal-empleado/specs/`) — gana un requisito de autorización donde hoy no hay ninguno. **Delta seguro**: `resolverEscalacionReembolso` no tenía gate y pasa a tenerlo.
- **`solicitud-interna-hitl`** (`hito-2.0/specs/`, ya modificada por `comando-cancelar-solicitud`) — gana el gate por rol **y** la prohibición de autoaprobación. **Delta seguro.**
- **`cancelacion-solicitud-interna`**, **`comando-empleado-tui`**, **`registro-acciones-empleado`** — **candidatas, a verificar por `sdd-spec` leyendo cada archivo, no razonando desde acá.** Criterio, el mismo que fijó `definicion-skills`: hay delta **sólo si** la spec vigente contiene un requisito que este change vuelve falso. Para `cancelacion-solicitud-interna` la pregunta concreta es si su chequeo de dueño queda **subsumido** por el gate nuevo o **convive** con él — **ADR 154 pto 4 se inclina por convivir, y `sdd-spec` debe confirmarlo contra el texto vigente.**

---

## Approach

Cuatro piezas, en orden de dependencia:

1. **Contrato y persistencia** — el tipo de rol en el núcleo (sin imports), la migración `0013` y el puerto de lectura. Entregable y testeable **solo**, sin cambiar el comportamiento de nadie.
2. **El gate en el núcleo** — `resolverEscalacionReembolso` y `resolverSolicitudInterna` reciben el rol (o el puerto) por `deps` y ganan su variante de rechazo. **TDD estricto: el test rojo es "un empleado sin rol de resolutor aprueba un reembolso ajeno y lo logra", que hoy pasa en verde y debe pasar a fallar.**
3. **La prohibición de autoaprobación** — independiente del paso 2 y verificable por separado.
4. **Cableado y provisioning** — `main.ts`, los cinco despachos de comando, y `src/empleados.ts`.

El corte 1 es entregable sin cambiar comportamiento; **el corte 2-3 es el que cambia la semántica del sistema y es el que el checkpoint tiene que mirar.**

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 152-156)

La numeración continúa el techo real **ADR 151**, reverificado (Aclaración 1). Las decisiones de nivel diseño reservan **RD-75 en adelante**.

### ADR 152: Un **rol enumerado** de dos valores, no un sistema de permisos — se entrega el eje que falta, no el sistema completo

**Contexto**. No hay nada (Aclaración 2). Cuando no hay nada, la tentación es diseñar bien *de una vez*: una tabla `permisos`, una tabla `roles_permisos`, un chequeo genérico `puede(empleado, accion, recurso)`. **Eso sería construir un framework de autorización para un sistema que tiene exactamente dos decisiones que tomar.**

**Decisión**:

1. **El rol es un valor enumerado del núcleo**, con su vocabulario canónico en un contrato sin imports — mismo criterio con el que el repo trata `casos.estado`, `ventas.estado`, `solicitudes.tipo`/`estado`: **`TEXT` abierto sin `CHECK` en SQL, unión de literales en TypeScript**. Está escrito cuatro veces en el esquema (`0004:17-21`, `0005:24-26`, `0008:19-22`): *"el vocabulario canónico vive en el núcleo, el SQL no lo conoce"*. **Este change lo respeta, no lo innova.**
2. **Dos valores, y la frontera es exactamente la de R10**: quien opera **sobre lo propio** y quien además **resuelve lo ajeno**. **RD-76 resuelto por el checkpoint**: los dos valores se llaman **`empleado`** (rol base, ya es el término que usa todo el repo para el actor autenticado) y **`administrador`** (rol elevado, coherente con el vocabulario ya usado en este mismo hilo de decisiones para TUI/comandos administrativos).
3. **La unidad de decisión es *resolver lo ajeno*, no *cada acción*.** Las cinco acciones bloqueadas (`aprobar`/`rechazar`/`reabrir` de escalación, `aprobar`/`rechazar` de solicitud) **comparten exactamente el mismo criterio de autorización**; darles cinco permisos distintos sería cinco veces la superficie para una sola decisión.
4. **Sin `CHECK` en SQL y con `TEXT` abierto, agregar un tercer rol mañana no migra nada.** La extensibilidad se compra gratis con la convención que el repo ya tiene; no hace falta comprarla con una tabla de permisos hoy.

**Alternativas consideradas**:

- *RBAC completo (tablas `roles`, `permisos`, `roles_permisos`, chequeo genérico)*: **rechazada, y es la tentadora.** Es lo correcto para un sistema con muchas acciones y muchos papeles. Acá serían **tres tablas y un motor de evaluación para expresar un booleano**, y cada tabla es una migración, un puerto, un repositorio y un conjunto de tests. **El propio repo ya difirió esto por nombre** (`tui-canal-empleado/proposal.md:572`). Reabrirlo por prolijidad sería exactamente el vicio que los ADR de diferido existen para evitar.
- *Un booleano `puede_resolver` en vez de un rol enumerado*: **rechazada, y por poco.** Es aún más chico y expresa lo mismo hoy. Se descarta porque un booleano **no tiene a dónde crecer sin migrar**: el tercer papel (auditor de solo lectura, aprobador por monto) obliga a una columna nueva, mientras que un `TEXT` abierto absorbe un valor más sin tocar el esquema. **Es el único lugar donde esta propuesta paga algo por el futuro, y cuesta cero.**
- *Derivar el rol de `vendedores`* (*"si es vendedor, opera; si no, resuelve"*): **rechazada, y hay que dejarla nombrada porque es la que parece gratis.** `vendedores` y `credenciales_empleado` **no están ligadas por nada** (Aclaración 2 pto 2). Ataría autorización a *quién cobra comisión* y convertiría un alta de vendedor en una decisión de seguridad silenciosa.
- *Rol por convención en el `empleado_id`* (prefijo `admin_`): **rechazada.** Convierte un string de identidad en un canal de permisos, y `ID_REGEX` (`empleados.ts:36`) es explícitamente *"una guarda de FORMA, no de política"*.

### ADR 153: El gate vive **en el núcleo determinista**, no en el handler — y sí, eso **modifica** las funciones que el change hermano promete no tocar

**Contexto**. Hay dos lugares posibles: la guarda del dispatcher (`build-on-comando-empleado.ts:1714-1718`, donde ya vive el chequeo de sesión) o adentro de las funciones deterministas. **Y hay una tensión que no se puede esconder**: `operaciones-negocio-conversacionales` ADR 145 pto 5 hizo de *"las seis funciones deterministas no se modifican"* un invariante verificable con `git diff`.

**Decisión**:

1. **El gate va adentro de `resolverEscalacionReembolso` y `resolverSolicitudInterna`**, con su variante de resultado tipada. **Razón dirimente, y es del propio repo**: `esAccionAutoservicio` ya está adentro, y su comentario dice que es *"**única fuente de verdad** para el gateo por acción"* (`resolver-solicitud-interna.ts:44`). **Ya existe un gate de autorización en el núcleo.** Poner el segundo en otra capa partiría la autorización en dos lugares.
2. **Y hay una razón más fuerte que la simetría: un gate en el handler se evade cambiando de canal.** Hoy hay comando y HTTP; mañana hay conversación (ése es literalmente el change hermano). **Un gate por canal hay que reimplementarlo —y volver a testear— en cada canal nuevo; un gate en el núcleo se hereda gratis.** Es la única ubicación en la que *"la herramienta no inventa lógica de autorización propia"* (Success Criteria del change hermano) puede ser cierto sin dejar un agujero.
3. ★ **Sobre el invariante del ADR 145 pto 5, sin esconderlo**: ese invariante dice que **`operaciones-negocio-conversacionales` no modifica las funciones**, y su propósito explícito es *"que el cálculo del dinero no se mueva al no-determinismo"*. **Este change no viola ese invariante: lo respeta y lo confirma desde el otro lado.** (a) Son **changes distintos**, y el invariante es sobre el diff de aquél. (b) Lo que este change agrega **no es cálculo**: ni un monto, ni un porcentaje, ni un veredicto cambia de productor — el gate sólo puede **negar**, nunca alterar un resultado. (c) **Es exactamente el tipo de cambio que aquel ADR quería proteger**: lógica determinista, pura, testeable, sin modelo cerca. **Consecuencia de secuencia que hay que decir en voz alta: si este change va primero, el `git diff` del hermano sigue limpio; si va después, el hermano tiene que rebasar sobre funciones ya modificadas.** Es un argumento concreto para el orden de merge — ver *Dependencies* y **R6**.
4. **`esAccionAutoservicio` no se toca ni se subsume.** Sigue siendo la fuente de verdad del gateo de `cancelar`. El gate nuevo es sobre *resolver lo ajeno* y son preguntas distintas — ver ADR 154 pto 4.

**Alternativas consideradas**:

- *Gate en la guarda del dispatcher, junto al de sesión*: **rechazada por el pto 2.** Es el lugar más barato y el más frágil: se evade cambiando de canal, y este proyecto **está agregando un canal ahora mismo**.
- *Gate en un módulo de política aparte que los dos llamen*: **no se descarta, es decisión de diseño — RD-77.** Mejor testabilidad y un solo lugar donde leer la política; a cambio, un archivo más y una indirección. Se decide con el código a la vista.
- *Resignificar `privilegiado` para que signifique "requiere rol de resolutor"*: **rechazada, y es la trampa más peligrosa de este change.** `privilegiado` significa *"exige sesión vigente"* (`comando-empleado.ts:87`) y lo consume **una** guarda. Resignificarlo **cambiaría en silencio el comportamiento de los quince comandos que lo usan** —incluidos `/consultar-kpi`, `/ver-propuesta`, `/ver-solicitudes-a2a`, que son de **solo lectura** y son `privilegiado: true`— y dejaría a todo el mundo sin poder leer un KPI. **El campo no se toca. El concepto nuevo lleva nombre nuevo.**

### ADR 154: El rol **no viaja en `SesionEmpleado`**: se lee por puerto en el momento de la decisión

**Contexto**. La forma obvia es agregar `rol` a `SesionEmpleado` y que viaje con la sesión. `SesionEmpleado` vive en memoria del proceso, **nunca se persiste** (`sesion.ts:1-5`, ADR 31 pto 4) y puede durar tanto como `SESION_TTL_MINUTOS` — **incluso para siempre**, porque `expiraEn` ausente significa *sin expiración* (`sesion.ts:15`, `sesionVigente` devuelve `true` sin mirar el reloj).

**Decisión**:

1. **El rol se lee por puerto en el momento de la decisión, no se cachea en la sesión.** Consecuencia directa y deseada: **quitarle el rol a alguien tiene efecto inmediato**, sin esperar a que caduque una sesión que puede no caducar nunca.
2. **`src/core/auth/sesion.ts` NO se modifica.** Su encabezado declara un invariante fuerte —*"el ÚNICO productor real es `resolverLogin`. Toda función que reciba una `SesionEmpleado` está declarando que su `empleadoId` fue AUTENTICADO"*— y el módulo tiene un test que verifica que **no carga ninguna dependencia** (`sesion.ts:46-53`). **Meterle el rol le agregaría una segunda semántica y probablemente una dependencia**, rompiendo un invariante testeado por una comodidad. **`SesionEmpleado` sigue respondiendo *quién sos*. *Qué podés* lo responde otra cosa, y que sean dos objetos distintos es la decisión, no un accidente.**
3. **El rol NO es parámetro de nada que el usuario o el modelo puedan escribir.** Ni de un comando, ni del schema de la herramienta del change hermano. **Mismo criterio que el ADR 147 pto 1 de aquella propuesta**: lo que no está en el parámetro no se falsifica. **Invariante negativo de spec.**
4. **El gate nuevo convive con `esAccionAutoservicio`, no lo reemplaza**, y el orden de evaluación importa: *"¿es autoservicio?"* y *"¿puede resolver lo ajeno?"* son preguntas distintas y un empleado sin rol de resolutor **debe** poder seguir cancelando su propia solicitud. **El orden exacto y la precedencia de las variantes de rechazo son RD-78.**
5. **Un `empleado_id` sin fila de rol NO escala a autorizado.** Ausencia ⇒ el rol base, nunca el elevado. Se escribe como invariante porque es el modo de falla por defecto y la Aclaración 2 pto 3 garantiza que ese caso **va a ocurrir** (no hay FK; el histórico sobrevive al empleado).

**Alternativas consideradas**:

- *`rol` como campo de `SesionEmpleado`, poblado en `resolverLogin`*: **rechazada por el pto 1-2, y es la que más código ahorra.** Una lectura menos por decisión, cero puertos nuevos en el camino caliente. Se descarta porque **una revocación que no tiene efecto hasta el próximo login no es una revocación**, y con `SESION_TTL_MINUTOS=0` no hay próximo login. Pagar una lectura de una tabla local de cuatro columnas por cada aprobación de reembolso es un precio que ni se mide.
- *Cachear el rol con TTL corto*: **rechazada.** Es la peor de las dos: tiene la complejidad del caché y una ventana de revocación igual.

### ADR 155: La **prohibición de autoaprobación** es parte de este change y **no depende del modelo de roles**

**Contexto**. Aclaración 3: hoy `aprobar`/`rechazar` de solicitud interna **no chequean dueño**, así que un empleado aprueba su propia solicitud. Es un caso distinto de R10 —no es *"resolver lo ajeno sin permiso"*, es *"resolverse a uno mismo"*— y **el ADR 152 no lo cubre**: alguien con rol de resolutor tendría permiso, y seguiría estando mal.

**Decisión**:

1. **`aprobar`/`rechazar` una solicitud con `solicitante_id === sesion.empleadoId` se rechaza, con rol o sin rol.** Separación de funciones. **El esquema ya sabía que quien pide y quien resuelve son papeles distintos** (`solicitudes_internas` tiene las dos columnas, `0008:47,53`); lo único que faltaba era impedir que coincidieran.
2. **Se incluye acá y no se difiere, por tres razones**: (a) es **el mismo agujero** que R10 y partirlo dejaría medio agujero abierto con el change ya cerrado; (b) **no cuesta casi nada** — el dato está en la fila que la función ya leyó, sin puerto nuevo ni lectura nueva; (c) **es el caso que un auditor externo mira primero**, y es la diferencia entre *"el sistema es permisivo"* y *"el sistema permite fraude trivial"*.
3. **No aplica a la escalación de reembolso.** Un reembolso no tiene *solicitante empleado*: `resolverEscalacionReembolso` usa `sesion.empleadoId` sólo para atribución (`:147`, `:165`) y la venta pertenece a un `vendedor_id`, que es **otro espacio de identidades** (Aclaración 2 pto 2). **Inventar ahí una equivalencia `vendedor_id ≡ empleado_id` sería exactamente el error del ADR 152 alternativa 3.** Para reembolsos alcanza el gate por rol. **Si el tutor quiere que un vendedor no apruebe el reembolso de su propia venta, eso necesita PRIMERO ligar las dos identidades, y es otro change** — se nombra como **R7**, no se resuelve acá.
4. **El intento rechazado deja fila de auditoría.** Es el punto donde `registro_acciones_empleado` deja de ser sólo un registro histórico y pasa a ser una señal: *alguien intentó aprobar lo suyo*.

**Alternativas consideradas**:

- *Diferirlo a un change de "separación de funciones"*: **rechazada por el pto 2.**
- *Resolverlo con un rol* (*"el que aprueba no puede pedir"*): **rechazada.** Ataría dos ejes independientes y dejaría a un jefe de área sin poder pedir sus propias vacaciones. **El rol dice qué papel tenés; la separación de funciones dice que no podés ser las dos partes del mismo caso.**

### ADR 156: La migración `0013` asigna a **todos los empleados existentes el rol base** — el sistema queda **cerrado**, y eso es un evento operativo, no un detalle

**Contexto**. La migración tiene que decidir qué pasa con las filas de `credenciales_empleado` que ya existen. **Las dos opciones tienen consecuencias reales y opuestas, y ninguna es neutra.**

**Decisión**:

1. **Todas las filas existentes quedan en el rol BASE.** Default **deny**, no default allow.
2. **Consecuencia inmediata, y hay que decirla sin suavizar: al mergear esto, NADIE puede aprobar un reembolso ni una solicitud hasta que alguien reciba el rol elevado por CLI.** No es un efecto secundario: **es el punto entero del change.** Un default *allow* dejaría a todos con permiso de resolver todo, o sea **exactamente el estado actual**, y el change no habría cambiado nada más que el tipo de dato.
3. **Por eso el provisioning (`src/empleados.ts`) es parte del alcance y no un "después"**, y por eso este change **no se puede mergear sin una nota de operación** que diga qué comando correr y para quién. **Es la primera vez que este repo mergea algo que puede dejar una operación de negocio sin ejecutor.** **Resuelto por el checkpoint**: el primer `administrador` es el propio usuario dueño de este arnés (el pasante), asignado el día del merge — la nota de despliegue de la carpeta de progreso debe nombrar ese `empleado_id` concreto.
4. **`created_at`/`updated_at` mantienen su semántica de `0006`**: *"`created_at` NO se pisa en una rotación; `updated_at` SÍ"* (`0006:18-20`), que es la huella que usa R16 de `tui-canal-empleado`. **Un cambio de rol es un evento auditable con el mismo criterio.** Si el rol vive en una tabla propia (**RD-75**), esa tabla lleva sus propios timestamps con la misma regla.
5. **Aditiva y `IF NOT EXISTS`**, como las doce anteriores. **Sin `CHECK`** sobre el valor del rol (ADR 152 pto 1).

**Alternativas consideradas**:

- *Default allow (todos al rol elevado) y degradar después*: **rechazada, y es la cómoda.** No rompe a nadie el día del merge. Se descarta porque **deja el agujero abierto y lo vuelve invisible**: el sistema *parecería* tener control de acceso mientras se comporta igual que antes, y nadie correría la degradación. **Un control de seguridad que arranca desactivado es peor que no tenerlo, porque miente en la auditoría.**
- *Un empleado semilla con rol elevado, sembrado por la migración*: **rechazada.** Meter una decisión de negocio —*quién manda*— dentro de una migración de esquema, hardcodeada y sin trazabilidad. El alta por CLI ya existe, ya es el único escritor y ya deja `created_at`/`updated_at`.
- *Inferir el rol elevado de quién resolvió algo en el pasado* (mirar `resuelta_por` / `registro_acciones_empleado`): **rechazada, y es la peor disfrazada de inteligente.** Convertiría el **síntoma** de R10 en la **definición** del permiso: quien pudo abusar del agujero quedaría consagrado como autorizado. **Es literalmente blanquear el problema que el change viene a cerrar.**

---

## Affected Areas

| Área | Impacto | Qué cambia |
|---|---|---|
| `src/core/auth/rol-contract.ts` (nombre tentativo) | **Nuevo** | Unión de literales del rol + puerto de lectura. **Sin imports**, molde `credenciales-contract.ts` / `sesion.ts` |
| `src/adapters/memory/migrations/0013_*.ts` | **Nuevo** | Persistencia del rol. Aditiva, `IF NOT EXISTS`, sin `CHECK`. **Forma exacta (columna en `credenciales_empleado` vs. tabla propia) = RD-75.** Default **deny** (ADR 156) |
| `src/adapters/memory/migrations/index.ts` | Modificado | Una línea de import + una entrada al final del array. **Nunca se edita ni reordena lo existente** (`index.ts:20-23`) |
| `src/adapters/memory/repository.ts` | Modificado | Lectura del rol; escritura sólo para el provisioning |
| `src/core/ventas/resolver-escalacion-reembolso.ts` | **Modificado** | ★ Gate de autorización donde hoy **no hay ninguno** (`:107-168` verificado íntegro) + variante de rechazo tipada. **ADR 153 pto 3 explica por qué esto no viola el invariante del change hermano** |
| `src/core/solicitudes/resolver-solicitud-interna.ts` | **Modificado** | Gate por rol para `aprobar`/`rechazar` + **prohibición de autoaprobación** (ADR 155). **`esAccionAutoservicio` (`:44-47`) NO se toca** |
| `src/core/auth/sesion.ts` | **Sin cambios** | **Invariante del ADR 154 pto 2**: `SesionEmpleado` sigue siendo `{ empleadoId, iniciadaEn, expiraEn? }`. Verificable con `git diff` |
| `src/core/commands/comando-empleado.ts` | **Sin cambios esperados** | ★ **El campo `privilegiado` NO se toca ni se resignifica** (ADR 153, alternativa rechazada 3). Los dieciocho descriptores siguen igual |
| `src/build-on-comando-empleado.ts` | Modificado | Los cinco despachos HITL rinden la nueva variante de rechazo. **La guarda de sesión (`:1714-1718`) se conserva sin cambio** — autenticación y autorización quedan como dos chequeos distintos, a propósito |
| `src/empleados.ts` | Modificado | Asignación del rol en alta y un modo para cambiarlo. **Sigue siendo el único escritor de credenciales** (`credenciales-contract.ts:14-17`) |
| `src/main.ts` | Modificado | Composition root: el puerto de rol entra en las `deps` |
| `src/core/ventas/{registrar-venta,confirmar-venta,procesar-devolucion}.ts` | **Sin cambios** | No son operaciones sobre lo ajeno. El gate no las toca |
| `src/adapters/web/server.ts` | **Sin cambios** | Otro eje de autorización, fuera de alcance |
| `docs/ARC42_Harness_Empresarial.md`, `README.md` | Modificado | Autenticación vs. autorización, y **R10 cerrada con nombre** |
| `package.json` | **Sin cambios** | Sin dependencias nuevas |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★ | **El merge deja el sistema sin nadie que pueda aprobar nada** (ADR 156 pto 2): default deny + nadie con rol elevado ⇒ reembolsos y solicitudes pendientes sin ejecutor | **Alta — es CERTEZA si no se opera** | **No es un bug: es el diseño.** Mitigación es **operativa, no técnica**: nota de despliegue en la carpeta de progreso con el comando exacto, y el provisioning **dentro** del alcance (ADR 156 pto 3). **El checkpoint tiene que saber que este merge requiere una acción manual inmediata** — punto 3 de *Qué necesita el checkpoint* |
| **R2** | **El alcance se desborda hacia RBAC**: aparecen permisos por acción, límites por monto, segundo aprobador | **Media-alta** | ADR 152 con sus cuatro alternativas rechazadas y la cita del diferido original (`tui-canal-empleado:572`). **Success Criteria fija el número: dos roles, un eje de decisión.** Si `sdd-design` produce una tabla de permisos, el change se salió de su propia propuesta |
| **R3** | **El alcance se desborda hacia el paquete de `0006`**: desactivación, rate limiting, política de contraseñas, recuperación | **Media** | El comentario de `0006:11-16` empaqueta todo eso con *"el modelo de autorización"* y **por eso está nombrado explícitamente en Out of Scope**, no omitido. Se toma **sólo** la rebanada de autorización |
| **R4** | **Resignificar `privilegiado`** por parecer el lugar natural, rompiendo en silencio los comandos de **solo lectura** que también son `privilegiado: true` (`/consultar-kpi`, `/ver-propuesta`, `/ver-solicitudes-a2a`) | Media | ADR 153 alternativa rechazada 3, elevado a invariante de spec y a línea de *Affected Areas*: **`comando-empleado.ts` sin cambios esperados** |
| **R5** | **Rol cacheado en sesión y revocación sin efecto** — con `SESION_TTL_MINUTOS=0` una sesión no expira nunca (`sesion.ts:15`) | Media | ADR 154 pto 1: lectura por puerto en el momento de la decisión. Requisito de spec con test: **quitar el rol tiene efecto sin re-login** |
| **R6** ★ | **Conflicto de merge con `operaciones-negocio-conversacionales`**: los dos tocan la frontera de identidad de empleado y **los dos tocan `resolver-solicitud-interna.ts`** | **Alta si corren en paralelo sin orden fijado** | Ninguno bloquea al otro, pero el orden **no es indiferente** (ADR 153 pto 3: si este va primero, el `git diff` limpio que aquél promete sigue siendo cierto). **Decisión del checkpoint antes de `sdd-tasks`** — punto 4 de *Qué necesita el checkpoint* |
| **R7** | **La autoaprobación de reembolso queda sin cubrir**: un vendedor podría aprobar el reembolso escalado de **su propia venta** si además tiene rol de resolutor | Baja-media, **declarada** | **Fuera de alcance con motivo verificado, no por omisión** (ADR 155 pto 3): `vendedores` y `credenciales_empleado` **no están ligadas por nada**, y cerrarlo exige primero unificar dos espacios de identidades. **Se documenta en el arc42 como deuda con nombre y condición de disparo escrita**, con el mismo tratamiento que este change le está dando a R10 |
| **R8** | **Las specs de dominio resultan tener requisitos que el gate vuelve falsos** y aparecen deltas no previstos | Media | Declarado en *Modified Capabilities*: tres deltas seguros, tres candidatas a verificar leyendo. No se resuelve por razonamiento desde acá |
| **R9** | **Se confunde con `revision-pr-por-roles`**, que es de roles de **agente** (Planner/Developer/Reviewer, `spec.md:7`) | Baja | Nombrado en Out of Scope. La capability nueva se llama `autorizacion-empleado`, no `roles-*`, justamente para no colisionar en lectura |

---

## Rollback Plan

**Reversible, y el orden de reversión importa al revés que de costumbre: lo barato de revertir es el código, lo delicado es el dato.**

Revertir en caliente = **revertir el commit del gate** (los dos archivos del núcleo): el sistema vuelve a autorizar como hoy —o sea, a no autorizar— y **ninguna operación queda bloqueada**. Es el beneficio de que el gate sólo pueda **negar**: quitarlo nunca deja un estado inválido, sólo vuelve a ser permisivo. `src/core/auth/sesion.ts` no cambió (ADR 154 pto 2), así que **la reversión nunca toca autenticación**.

**La migración `0013` NO se revierte, y es a propósito.** `runMigrations` registra ids aplicados de forma permanente en `schema_migrations` (`migrations/index.ts:20-23`) y el repo **no tiene `down`** en ninguna de sus doce migraciones — no es un olvido, es la convención. **Tampoco hace falta**: la columna o tabla de rol queda huérfana e inerte si el gate se va. **Ningún dato se pierde y ningún dato se corrompe**; en el peor caso queda una tabla que nadie lee. **Si el change se revierte y después se repone, los roles ya asignados siguen ahí** — lo cual, además, hace la reposición barata.

**El riesgo real de rollback no es técnico: es R1 al revés.** Si se revierte el gate **después** de haber degradado a todo el mundo al rol base, el sistema vuelve a ser permisivo y **nadie se entera**, porque el síntoma visible (*"no puedo aprobar"*) desaparece. **Por eso la reversión de este change tiene que quedar registrada como evento operativo**, no sólo como un `git revert`. A nivel git: revertir los commits de la rama antes del merge a `main`.

---

## Dependencies

- **Autenticación de empleado operativa y mergeada** (`src/core/auth/`, `tui-canal-empleado`, `v1.2.0`). **Dependencia dura y ya satisfecha**: sin un actor autenticado no hay a quién autorizar — es textualmente lo que `tui-canal-empleado/proposal.md:586` dijo que le entregaba a Hito 5.
- **El esquema de migraciones vigente** (`0001`-`0012`), para que `0013` sea la siguiente y no colisione. Verificado en esta fase contra `migrations/index.ts:30-43`.
- ★ **Este change NO depende de ningún change no iniciado.** Es deliberadamente el extremo de la cadena: **se escribió para poder empezar de inmediato.** No espera a `operaciones-negocio-conversacionales`, no espera al change de administración del ADR 150 pto 1, y no espera a que se defina ninguna superficie conversacional.
- ⚠️ **Lo que depende de ESTE change**: el **ADR 151** de `operaciones-negocio-conversacionales` —mover `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud` a conversación— está **BLOQUEADO** hasta que éste cierre y mergee, por decisión del checkpoint. **`autorizacion-empleado` cerrado ⇒ ADR 151 desbloqueado** y ejecutable en un change propio. **Es la única condición de disparo escrita de aquel ADR.**
- **Relación con `operaciones-negocio-conversacionales` (el resto de su alcance): NINGUNA de bloqueo, en las dos direcciones.** Aquel change puede avanzar sin éste (su alcance ejecutable no necesita saber el rol de nadie) y éste puede avanzar sin aquél. **Pero se solapan en archivos** —`resolver-solicitud-interna.ts` los dos, más la frontera de identidad de empleado— **así que el orden de merge hay que fijarlo, no descubrirlo** (R6).
- **Checkpoint humano de `AGENTS.md`** aprobando esta propuesta **antes** de `sdd-spec`/`sdd-design` — en particular el **ADR 156** (el sistema queda cerrado al mergear) y el **ADR 152** (dos roles y no un RBAC).

---

## Success Criteria

- [ ] **Existe un rol de empleado persistido**, con vocabulario canónico en el núcleo y **sin `CHECK` en SQL** (ADR 152 pto 1). **Exactamente dos valores** — si hay tres o hay una tabla de permisos, el change se salió de su propuesta (R2).
- [ ] ★ **Un test demuestra el cierre de R10**: un empleado con rol base **NO puede** aprobar/rechazar/reabrir una escalación de reembolso ni aprobar/rechazar una solicitud interna **ajena**, y uno con rol elevado **sí**. **Este test hoy es imposible de escribir porque la distinción no existe — es la prueba de que el change hizo algo.**
- [ ] ★ **Un test demuestra la prohibición de autoaprobación** (ADR 155): un empleado **con rol elevado** no puede aprobar ni rechazar una solicitud cuyo `solicitante_id` sea el propio. **El rol no alcanza para saltearla.**
- [ ] **Un empleado con rol base SIGUE pudiendo cancelar su propia solicitud** (`esAccionAutoservicio` intacto, ADR 154 pto 4). **Es el criterio que impide que el gate se vuelva un candado de más.**
- [ ] **`git diff` demuestra que `src/core/auth/sesion.ts` NO fue modificado** (ADR 154 pto 2) y que **`comando-empleado.ts` no resignificó `privilegiado`** (ADR 153, R4). Los comandos de solo lectura `privilegiado: true` siguen funcionando para cualquier sesión vigente.
- [ ] **El rol no es parámetro de ningún comando ni de ningún schema** (ADR 154 pto 3). Verificado sobre el parser y sobre el contrato de la herramienta del change hermano cuando exista.
- [ ] **Quitarle el rol a un empleado tiene efecto sin re-login** (ADR 154 pto 1, R5), demostrado con una sesión sin `expiraEn`.
- [ ] **Un `empleado_id` sin fila de rol cae al rol base, nunca al elevado** (ADR 154 pto 5).
- [ ] **La migración `0013` es aditiva, `IF NOT EXISTS`, se agrega al FINAL de `migrations` sin editar ninguna entrada previa**, y deja todas las filas existentes en el **rol base** (ADR 156).
- [ ] **Un intento no autorizado deja fila en `registro_acciones_empleado`** con resultado distinguible (ADR 155 pto 4). **Es el criterio que convierte la auditoría en control** (Aclaración 3).
- [ ] **La nota de despliegue existe y dice el comando exacto** para asignar el rol elevado antes de que el merge llegue a un entorno con trabajo pendiente (R1).
- [ ] **R7 (autoaprobación de reembolso por el propio vendedor) queda escrita en el arc42** como deuda con nombre, con su motivo verificado —`vendedores` y `credenciales_empleado` sin ligadura— y su condición de disparo.
- [ ] `npm test` y `npm run typecheck` en verde; **TDD estricto**: el test rojo inicial es *"un empleado cualquiera aprueba un reembolso ajeno"*, **que hoy pasa en verde y debe pasar a fallar**.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, carpeta de progreso con evidencia, tag.

---

## Qué necesita el checkpoint humano

> **Este change introduce el PRIMER control de acceso del proyecto y cambia lo que empleados reales pueden hacer.** Mismo tratamiento que `tui-canal-empleado` cuando introdujo autenticación: **la aprobación humana es bloqueante antes de `sdd-spec`/`sdd-design`.**

1. **El ADR 152 es la decisión de fondo: dos roles, no un sistema de permisos.** Lo que se ratifica es el **recorte**: que la única pregunta de autorización que este sistema tiene hoy es *"¿podés resolver lo ajeno?"*, y que límites por monto, segundo aprobador y permisos por acción **siguen diferidos** —como ya lo estaban por `tui-canal-empleado:572`—. Si el negocio necesita *"hasta 500 aprueba cualquiera, arriba de 500 el jefe"*, **decilo ahora**, porque eso **no** es este change y cambia el modelo entero.
2. ✅ **RD-76 resuelto**: los dos roles se llaman **`empleado`** (base) y **`administrador`** (elevado). Queda así en el esquema, los tests y los mensajes al usuario.
3. ★ **Tenés que saber que este merge CIERRA el sistema (ADR 156).** Al mergear, **nadie puede aprobar un reembolso ni una solicitud hasta que alguien reciba el rol elevado por CLI**. Es intencional —un default *allow* dejaría todo igual y el change no serviría de nada—, pero **es una acción operativa obligatoria el día del merge**, no un detalle de implementación. **Confirmá que lo aceptás y decime quién recibe el rol elevado.**
4. ★ **Orden de merge con `operaciones-negocio-conversacionales` (R6).** Ninguno bloquea al otro, pero se solapan en archivos y **hay un argumento técnico concreto para que este vaya primero** (ADR 153 pto 3): si este cierra antes, el invariante *"las seis funciones deterministas no se modifican"* que aquel change promete verificar con `git diff` **sigue siendo cierto sobre su propio diff**; al revés, aquel change rebasa sobre funciones recién modificadas. **Inclinación: `autorizacion-empleado` primero**, que además es el más chico y es coherente con lo que ya decidiste —si elegiste arreglar roles antes de exponerlos, empezar por el otro lado vacía esa elección. **Decisión tuya antes de `sdd-tasks`.**
5. **R7 queda declarada, no resuelta**: un vendedor con rol elevado podría aprobar el reembolso de **su propia venta**, porque `vendedores` y `credenciales_empleado` no están ligadas por nada (verificado). **Confirmá que la heredás declarada**, o decime si hay que unificar las identidades — que es otro change y bastante más grande.
6. **Numeración y versión.** La versión la pone el checkpoint, como en `tui-canal-empleado`, `definicion-skills` y `operaciones-negocio-conversacionales`.

## Decisiones reservadas para `sdd-design` (RD-75 en adelante)

| RD | Qué | Por qué no se decide acá |
|---|---|---|
| **RD-75** | **Columna `rol` en `credenciales_empleado` vs. tabla propia `roles_empleado`** | La columna es más simple y `credenciales_empleado` ya es la tabla del empleado; la tabla propia separa autenticación de autorización en el esquema (coherente con el ADR 154 pto 2, que las separa en el tipo) y permite más de un rol por empleado sin migrar. **Exige escribir el DDL y ver cuál lectura queda más limpia en el puerto** |
| **RD-76** | ✅ Resuelto: `empleado` (base) / `administrador` (elevado) | — |
| **RD-77** | **Módulo de política aparte vs. gate inline en cada función** | ADR 153 alternativa 3. Un módulo da un solo lugar donde leer la política y mejor testabilidad; inline evita una indirección para dos llamadores. Se decide con las dos funciones a la vista |
| **RD-78** ★ | **Orden de evaluación y precedencia entre los tres chequeos**: sesión vigente, autoservicio/dueño (`esAccionAutoservicio`), rol, y autoaprobación | ADR 154 pto 4 y ADR 155. No es cosmético: **define qué mensaje ve el usuario y cuánta información filtra un rechazo.** El molde `no_es_dueno` ya resolvió *"rechazar sin filtrar el `detalle` del ítem ajeno"* (`resolver-solicitud-interna.ts:51-53`) y ese criterio hay que extenderlo, no reinventarlo |
| **RD-79** | **Forma exacta del modo de asignación de rol en `src/empleados.ts`** (flag `--rol` en el alta, modo nuevo, o comando aparte) y qué pasa al asignar rol a un `empleado_id` inexistente | `parseArgsEmpleado` (`:53-74`) tiene reglas estrictas y testeadas —flag desconocida ⇒ error, nunca caer al default— y la forma nueva tiene que respetarlas. Es diseño de CLI con un test existente que lo constriñe |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (sólo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por Hito 3, Hito 4, `definicion-skills` (`proposal.md:281`) y `operaciones-negocio-conversacionales`. Se compensó con lectura directa y verificación puntual de **cada** afirmación citada: `src/core/auth/sesion.ts:1-60` **íntegro** (`SesionEmpleado` de tres campos, `sesionVigente` devolviendo `true` sin mirar el reloj cuando `expiraEn` está ausente, y el invariante testeado de *cero dependencias* en `:46-53`); `src/core/auth/credenciales-contract.ts:1-23` (puerto de **una** operación de lectura, y el comentario de `:14-17` sobre que la TUI no puede crear credenciales); `src/empleados.ts:1-153` (único escritor, `ID_REGEX` como *"guarda de FORMA, no de política"* en `:36`, `parseArgsEmpleado` en `:53-74`); `src/adapters/memory/migrations/index.ts:30-43` (**las doce migraciones, `0001`-`0012`**, y la convención de no editar ni reordenar); `0006_credenciales_empleado.ts` **íntegro** (las **cuatro** columnas, y su encabezado `:11-20` con *"eso es el modelo de autorización de Hito 5"* y la regla `created_at`/`updated_at`); `0004_vendedores_ventas_comisiones.ts:37-74` (`vendedores` = `id`/`nombre`/`created_at`, **sin ligadura a `empleado_id`**); `0005_registro_acciones_empleado.ts:11-18,42-57` (`empleado_id NOT NULL` **sin FK**, con su motivo escrito); `0008_solicitudes_internas.ts:12-17,41-62` (**`solicitante_id` y `resuelta_por`, sin FK** — la semilla del ADR 155); `src/core/solicitudes/resolver-solicitud-interna.ts:36-61` (`AccionSolicitud`, `esAccionAutoservicio` ⇒ **sólo `cancelar`**, y la variante `no_es_dueno` con su motivo de no filtrar el `detalle`); `src/core/ventas/resolver-escalacion-reembolso.ts:107-168` **íntegro** (**cero gate de autorización**; `sesion.empleadoId` sólo en `:147` y `:165`, las dos veces para atribución); `openspec/changes/tui-canal-empleado/proposal.md:65,572,586` y `specs/autenticacion-empleado-tui/spec.md:9` (los diferidos originales, textuales); `openspec/changes/hito-2.0-delegacion-subagentes/specs/revision-pr-por-roles/spec.md:7` (roles **de agente**, no de empleado); `docs/Plan_Implementacion_Harness_Empresarial.md:304` y `docs/progreso/v2.0-delegacion-subagentes/README.md:1` (**Hito 5 = `hito-2.0`/v2.0**); `Glob` de `openspec/changes/*/specs/*/spec.md` (**40 archivos**, sin colisión de nombre); y el techo de ADR/RD por grep sobre **todo** `openspec/changes/*` (**ADR 151 / RD-74**, ambos fijados por `operaciones-negocio-conversacionales` y por ninguna otra fuente). Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` ejecute `graphify explain` sobre los conceptos nuevos (rol de empleado, gate de autorización, separación de funciones).
