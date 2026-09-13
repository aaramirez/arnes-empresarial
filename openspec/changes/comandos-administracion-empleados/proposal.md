# Propuesta: Comandos de administración de empleados en la TUI — alta y asignación de rol desde el canal de administración, con los otros dos pedidos diferidos por motivo verificado

**Origen**: **requerimiento del tutor (stakeholder de negocio)**, diferido por nombre y con condición de disparo escrita por **dos** changes de esta misma sesión, cuya dependencia dura ya está satisfecha:

- `operaciones-negocio-conversacionales/proposal.md:83` (Out of Scope) y su **ADR 150 pto 1** (`:265`) — textual: *"**Los comandos administrativos nuevos** que el tutor mencionó — alta de empleados, cambio de rol/permisos, configuración del bot de PRs, configuración por usuario. **Explícitamente diferidos a un change separado.**"* Motivo declarado, y es bueno: *"el alta de empleados **crea credenciales**, y eso toca `src/core/auth/` y el hash de passwords — mezclarlo con un change que ya mueve la frontera de autenticación (ADR 146/147) junta dos cambios de seguridad en un diff."* **Condición de disparo: *"este change cerrado y mergeado"*.**
- `autorizacion-empleado/proposal.md:94` (Out of Scope) — textual: *"**Comandos administrativos de TUI para gestionar roles** (`/asignar-rol`, alta de empleados desde la TUI). Diferido por el ADR 150 pto 1... El provisioning por CLI alcanza para cerrar R10."*

**La dependencia que importa NO es la condición de disparo literal, y hay que decirlo con precisión**: `operaciones-negocio-conversacionales` **no está mergeado**. Lo que sí está es lo que este change realmente necesita — **el modelo de rol de `autorizacion-empleado`**, con `design.md` completo y listo para `sdd-tasks`: `roles_empleado` como tabla propia (**ADR 157**), `RolEmpleadoPort` (**ADR 162**), `upsertRolEmpleado` en `repository.ts` y el modo CLI `asignar-rol` (**ADR 160**). Sin eso, *"cambio de rol desde la TUI"* no tiene rol que cambiar. **Ver *Dependencies*, donde esta distinción se convierte en una pregunta concreta de secuenciación para el checkpoint (R6).**

**Y el pedido nuevo del stakeholder en esta sesión de planificación**: que el alta de empleado se haga **desde la TUI** y no invocando un script aparte (`npm run empleados:crear`), porque el plan general ya estableció el reparto de canales — **chat = trabajo transaccional del empleado, TUI = operaciones de administración** — y un alta de empleado es, sin discusión, administración.

**Rama prevista**: `hito/<version>-comandos-administracion-empleados` (a fijar) · **Carpeta de progreso**: `docs/progreso/<version>-comandos-administracion-empleados/`.

**No es un hito del Plan.** Mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `operaciones-negocio-conversacionales` y `autorizacion-empleado`: carpeta descriptiva sin prefijo `hito-X.Y`. **La versión es decisión del checkpoint**, igual que en los cuatro precedentes.

**Nombre de la carpeta.** `comandos-administracion-empleados` y no `comandos-administrativos-tui` **porque, tras la investigación, dos de las cuatro capacidades candidatas se difieren** (ADR 178 y 179) y lo que queda es exactamente *administración de empleados*. Nombrar la carpeta por el alcance que la propuesta prometía antes de verificarlo sería vender más de lo que entrega. Pareja explícita con la capability existente **`comando-empleado-tui`** y con el molde de nombre que el repo ya usa para changes de comando (`comando-cancelar-solicitud`, `comando-reporte-comisiones`, `comando-visibilidad-a2a-entrante`).

---

## Aclaración previa 1: el techo real de numeración, **reverificado por grep sobre todo `openspec/changes/*`**

**No se heredó de ningún texto.** El precedente obliga: `definicion-skills` descubrió que el techo real era ADR 102 y no 93; `operaciones-negocio-conversacionales` movió el techo **cuatro** veces (ADR 151 → 170 → 173) entre su `proposal.md` y su `design.md`; `autorizacion-empleado` lo movió otra vez (ADR 157-162, RD-75 a RD-79). **Regrepeado con `ADR (1[7-9][0-9]|[2-9][0-9][0-9])` y `RD-(7[0-9]|8[0-9]|9[0-9]|1[0-9][0-9])` sobre `proposal.md` + `design.md` + `specs/**` de todos los changes**:

| Serie | Techo real verificado | Dónde | Esta propuesta abre en |
|---|---|---|---|
| **ADR** | **173** | `operaciones-negocio-conversacionales/design.md:245,478-503` — **no** 151 (techo de su `proposal.md`) ni 162 (techo de `autorizacion-empleado/design.md`). No hay ningún ADR ≥ 174 en el repo | **ADR 174** |
| **RD** | **RD-79** | `autorizacion-empleado/proposal.md:324` y `design.md:198,277` — no hay ningún `RD-80` ni superior en el repo | **RD-80** |

## Aclaración previa 2: los **quince** descriptores que quedan, verificados uno por uno — y que **no hay colisión de nombre**

`DESCRIPTORES` (`comando-empleado.ts:138-317`) tiene hoy **dieciocho** entradas, contadas sobre el archivo real (`nombre`/`tipo`/`privilegiado`/`secreto`/`forma`, líneas 139-317). `operaciones-negocio-conversacionales` baja **tres** —y **sólo tres**, porque su ADR 151 quedó **BLOQUEADO** y las otras cinco bajas no se ejecutan (`proposal.md:74,271-293`)—: `/devolucion`, `/solicitar`, `/cancelar-solicitud`. **Quedan quince**:

| # | Comando | `privilegiado` | Rol natural |
|---|---|---|---|
| 1 | `/login` | `false` (`:143`) | autenticación |
| 2 | `/logout` | `false` (`:152`) | autenticación |
| 3 | `/soporte` | `false` (`:161`) | conversación |
| 4-6 | `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` | `true` (`:179,188,197`) | HITL (gateado por `autorizacion-empleado`) |
| 7-8 | `/aprobar-solicitud`, `/rechazar-solicitud` | `true` (`:215,224`) | HITL (ídem) |
| 9-11 | `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta` | `true` (`:238,247,256`) | administración |
| 12 | `/consultar-kpi` | `true` (`:268`) | solo lectura |
| 13 | `/reporte-comisiones` | `true` (`:281`) | solo lectura |
| 14 | `/ver-solicitudes-a2a` | `true` (`:303`) | solo lectura |
| 15 | `/ayuda` | `false` (`:312`) | ayuda, siempre último |

**Convención de nombre verificada**: kebab-case con `/` inicial, mayoría `verbo-sustantivo` (`/aprobar-reembolso`, `/cancelar-solicitud`, `/consultar-kpi`, `/aplicar-propuesta`) y minoría `sustantivo-sustantivo` (`/reporte-comisiones`). **`/crear-empleado` y `/asignar-rol` no colisionan con ninguno de los quince**, y `/crear-empleado` toma su verbo del script que ya existe (`empleados:crear`), no de una invención.

**Convención de orden, y es una regla escrita**: *"Cada tanda nueva va ANTES de `/ayuda`, que sigue último — los descriptores existentes no cambian de orden ni de forma"* (`comando-empleado.ts:134-136`). Este change agrega su tanda en la posición 15-16 y `/ayuda` pasa a la 17.

## Aclaración previa 3 (★ **hallazgo de mayor impacto**): las cuatro capacidades pedidas **no son cuatro**, y dos no se pueden construir honestamente hoy

Se investigó cada una con evidencia, no con inclinación. **El resultado es 2 de 4, y las dos que caen lo hacen por razones distintas y verificadas**:

1. **Alta de empleado desde la TUI — CONSTRUIBLE, y revierte una propiedad del diseño a conciencia.** `credenciales-contract.ts:14-17` dice textual: *"El alta y la rotación viven en otro proceso (`src/empleados.ts`, ADR 33) y no pasan por este puerto: **la TUI no puede crear credenciales, y eso es una propiedad del diseño, no un olvido**."* **El stakeholder pide revertirla, y es su decisión legítima.** Lo que esta propuesta no hace es revertirla en silencio: ver **ADR 174**, y el residual de contraseña visible que arrastra (**R1**, heredero directo de **R14** de `tui-canal-empleado`).

2. **Cambio de rol desde la TUI — CONSTRUIBLE, y es la mitad barata del change** *siempre que `autorizacion-empleado` aterrice primero*: la tabla `roles_empleado`, `upsertRolEmpleado(db, {empleadoId, rol, ahora})` y `ROLES_EMPLEADO` ya están **diseñados al nivel de DDL y de firma** (`autorizacion-empleado/design.md:340-416`). Este change **llama**, no reinventa — ver **ADR 176** y el invariante negativo de *Success Criteria*.

3. ★ **Configuración del bot de PRs desde la TUI — NO se puede hacer honestamente hoy. DIFERIDA (ADR 178).** Dos hallazgos, los dos verificados leyendo el código y no el documento:
   - **El puerto se abre UNA vez, al arranque, y nunca más.** `startWebhookServer` se llama en `main.ts:311`, resuelve `resolveWebhookConfig()` en `webhooks/index.ts:62`, y `isWebhookEnabled(config)` (`webhooks/config.ts:80-83`, literal: *"`config.secret.trim() !== ""`. **Único gate del listener**"*) decide ahí mismo si se hace `startServer` o se devuelve `undefined` con un log `webhook-deshabilitado`. Es exactamente lo que `hito-1.2-bot-revision-prs/proposal.md:61` prometió: *"El listener es **opt-in**: sin `GITHUB_WEBHOOK_SECRET` no se abre ningún puerto"*. **Un comando de TUI en runtime NO puede abrir ni cerrar ese puerto.** Cualquier comando que lo insinuara estaría mintiendo.
   - ★ **Y el hallazgo más grave, que la premisa del pedido no contemplaba: `GITHUB_WEBHOOK_SECRET` y `GITHUB_TOKEN` son secretos RECUPERABLES.** El primero se usa para verificar un HMAC entrante; el segundo, como `Bearer` saliente. **Los dos hay que poder leerlos en claro.** Este repo **no tiene ni un solo precedente de secreto recuperable persistido**: `credenciales_empleado.password_hash` guarda `scrypt$N$r$p$salt$clave` **precisamente porque nunca hace falta recuperarlo** (`credenciales-contract.ts:7-10`), y las quince tablas del esquema no guardan ningún otro secreto. Mover `GITHUB_TOKEN` de `.env` a SQLite **no es una mejora de usabilidad: es un secreto de larga vida en claro, en un archivo que hoy nadie trata como bóveda.** Ver ADR 178.

4. ★ **"Configuración por usuario, sin `.env`" — NO tiene referente verificable en este repo. DIFERIDA por falta de alcance, no por tamaño (ADR 179).** Se buscó, y el resultado es negativo en los tres lugares donde podría estar:
   - **Esquema**: las **quince** tablas de las doce migraciones son `casos`, `sesiones_agente`, `proyectos`, `responsables`, `actividades`, `vendedores`, `ventas`, `comisiones`, `registro_acciones_empleado`, `credenciales_empleado`, `delegaciones`, `solicitudes_internas`, `propuestas_cambio`, `delegaciones_a2a`, `solicitudes_a2a_entrantes`. **Ninguna es de preferencias, settings ni configuración**, ni por usuario ni global.
   - **Configuración**: `src/core/config/env.ts` es el único punto de carga y **enumera en su encabezado todas** las variables del sistema (`:18-58`). **Todas son de proceso, ninguna es por usuario.** Y el propio archivo dice lo contrario de lo que un "config por usuario" necesitaría: *"**`EMPLEADO_ID` does NOT exist as an env var**: employee identity comes exclusively from an authenticated `/login`... **never from configuration**"* (`:54-58`).
   - **El pedido mismo**: *"config del arnés para un usuario"* no nombra **una sola** cosa configurable. La lectura más probable, y la que la evidencia sostiene, es que **es el paraguas de los puntos 1-3** (*"configurar el arnés sin editar `.env` a mano"*) y **no una cuarta capacidad**. Construir un framework genérico de settings para cero settings conocidos sería **infraestructura sin consumidor** — el anti-patrón que este repo ya rechazó por nombre dos veces (`hito-2.2/design.md §15` / ADR 89 pto 1, recitado por ADR 106 y por ADR 150 pto 2). **Necesita scoping del stakeholder antes de tener alcance: punto 4 de *Qué necesita el checkpoint*.**

---

## Intent

Hoy dar de alta un empleado exige **salir del arnés**: abrir otra terminal, correr `npm run empleados:crear -- ana`, tipear la contraseña por `stdin`. Y tras `autorizacion-empleado`, asignar el rol `administrador` exige **lo mismo otra vez** (`empleados:crear -- ana --rol administrador`, ADR 160). El plan general ya decidió el reparto de canales —**chat para el trabajo transaccional del empleado, TUI para administración**— y `operaciones-negocio-conversacionales` lo está ejecutando. **Este change cierra el reparto por el lado de administración**: lo administrativo deja de ser *"un script que hay que acordarse de correr"* y pasa a ser lo que el reparto dice que es, un comando.

Y hay una razón operativa concreta, no estética, que viene de `autorizacion-empleado` y que conviene decir: su **ADR 156 pto 2** deja el sistema **cerrado** el día del merge —*"nadie puede aprobar un reembolso ni una solicitud hasta que alguien reciba el rol elevado por CLI"*— y su **R1** clasifica eso como *"Alta — es CERTEZA si no se opera"*. **Cada vez que hay que sumar un administrador nuevo, hoy hay que volver a la terminal de al lado.** Ese es el costo recurrente que este change elimina.

Lo que **no** es este change: no inventa roles (los toma de `autorizacion-empleado`), no toca el gate del núcleo, no agrega un permiso, no construye una bóveda de secretos y no construye un framework de settings. **De las cuatro capacidades que el ADR 150 pto 1 difirió, entrega dos y explica con evidencia por qué las otras dos no están listas.**

---

## Scope

### In Scope

- **Comando `/crear-empleado <empleadoId> <password>`** (nombre a ratificar, **RD-80**): da de alta una fila en `credenciales_empleado` desde la TUI, con el **mismo hash scrypt y la misma validación de forma** que el CLI (`ID_REGEX`, `empleados.ts:36` — *"guarda de FORMA, no de política"*). **Revierte a conciencia la propiedad de `credenciales-contract.ts:14-17`** — ADR 174.
- **Comando `/asignar-rol <empleadoId> <rol>`**: asigna o cambia el rol entre `empleado` y `administrador`, **llamando al mecanismo de `autorizacion-empleado`** (`upsertRolEmpleado`, `ROLES_EMPLEADO`), **sin duplicar ni reinventar el modelo de rol** — ADR 176.
- ★ **Gate de rol `administrador` sobre los dos comandos nuevos** (ADR 175). **Sin esto el change es un agujero de escalación de privilegio**: cualquier empleado con sesión se auto-asignaría `administrador` y anularía `autorizacion-empleado` entero en una línea. **Es el requisito más importante de este change, y `privilegiado: true` NO alcanza** — ese flag significa *"exige sesión vigente"* (`comando-empleado.ts:87`) y resignificarlo está prohibido por la **R4** de `autorizacion-empleado`.
- ★ **Prohibición de auto-degradación del último administrador** (ADR 175 pto 4): un `administrador` no puede quitarse el rol a sí mismo si es el único. Es el mismo modo de falla que la **R1** de `autorizacion-empleado` —el sistema queda cerrado y sin ejecutor— pero disparado por un comando en vez de por una migración.
- **Puerto de ESCRITURA de rol, separado del de lectura** (ADR 176): `RolEmpleadoPort` (`rol-contract.ts`, ADR 162) es *"UNA sola operación, de LECTURA, síncrona"* y **no se toca**. El escritor es un contrato nuevo.
- **Dos `Forma` nuevas en el parser** (ADR 177), con el precedente que el propio archivo dejó escrito cuatro veces (`id_opcional_solicitud`, `id_opcional_propuesta`, `id_opcional_periodo`, `id_opcional_a2a_task` — *"una forma nueva por SHAPE de payload"*, `comando-empleado.ts:93-113`).
- **`secreto: true` para `/crear-empleado`**, que pasa a ser el **segundo** descriptor con ese flag después de `/login` (`:144`) — y el único donde el secreto es de **otra persona**. Ver **R1**.
- **`/ayuda` refleja los dos comandos nuevos**, y sólo a quien los puede usar (**RD-83**).
- **Fila de auditoría en `registro_acciones_empleado`** por cada alta, cada cambio de rol y **cada rechazo por autorización** — con el mecanismo que **ya existe** (`registrar()` + `RegistroAccionesEmpleadoPort`, `autorizacion-empleado/design.md:287-293`), no uno nuevo.
- **`src/empleados.ts` NO se elimina y NO se deprecia.** Sigue siendo el camino de bootstrap del **primer** administrador (ADR 175 pto 5) y el de rotación de contraseña.
- **arc42 + README**: el reparto de canales completo, y que la propiedad de `credenciales-contract.ts:14-17` cambió con ADR que la nombra.

### Out of Scope

- ★ **Configuración del bot de PRs desde la TUI** (`GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `WEBHOOK_PORT`, `WEBHOOK_PATH`). **Diferida con motivo verificado y condición de disparo escrita — ADR 178.** No es omisión ni pereza: el puerto se abre una vez al arranque y los dos primeros son secretos recuperables sin precedente de persistencia en este repo (Aclaración 3 pto 3).
- ★ **"Configuración por usuario" como capacidad propia.** **Diferida por falta de referente — ADR 179.** No existe ninguna noción de preferencia por usuario en las quince tablas ni en el único punto de carga de config (Aclaración 3 pto 4). **Necesita scoping del stakeholder, no diseño.**
- **Desactivación de empleado (`activo`), borrado de empleado, límite de intentos de login / rate limiting, política de fortaleza de contraseña, recuperación de contraseña.** Siguen diferidas por ADR 33 pto 3 / R15 de `tui-canal-empleado` y por el Out of Scope de `autorizacion-empleado` (`:92`). **Se nombran explícitamente porque un comando de alta de empleado es el imán natural de todas ellas** — es el riesgo de alcance número uno (**R2**).
- **Rotación de contraseña desde la TUI** (`--rotar` equivalente). **Deliberado**: rotar es una operación del **dueño** de la contraseña, no de administración, y traerla acá metería *"un administrador tipea la contraseña nueva de otro"* como flujo normal en vez de como residual acotado (R1). **Condición de disparo: que exista enmascarado en la TUI (RD-81 / R14 de `tui-canal-empleado`).**
- **Un tercer rol, permisos por acción, RBAC, tabla de permisos, límites por monto, segundo aprobador.** `autorizacion-empleado` ADR 152 los difirió con cuatro alternativas rechazadas; este change **consume** ese modelo y no lo amplía. **Si aparece un tercer rol, el change se salió de su propuesta.**
- **Modificar el gate del núcleo** (`resolverEscalacionReembolso`, `resolverSolicitudInterna`, `autorizacion-resolucion.ts`) **ni `esAccionAutoservicio`.** Este change **lee** el rol para un comando; no cambia qué autoriza el núcleo. Verificable con `git diff`.
- **Modificar `src/core/auth/sesion.ts`.** Invariante del ADR 154 pto 2 de `autorizacion-empleado`, que este change **hereda sin matices**: el rol no viaja en la sesión, se lee por puerto en el momento de la decisión.
- **Resignificar el campo `privilegiado`.** **R4** de `autorizacion-empleado`, heredada literal: `/consultar-kpi`, `/ver-propuesta` y `/ver-solicitudes-a2a` son `privilegiado: true` y de **solo lectura**; resignificar el campo dejaría a todo el mundo sin poder leer un KPI.
- **Modificar `tui-port.ts`, `App.tsx` o `start-tui.tsx`** (ADR 21 de `tui-canal-empleado`). **Consecuencia incómoda y declarada: sin tocar eso no hay enmascarado, y la contraseña del alta queda visible en el transcripto.** Ver R1 y RD-81 — **el checkpoint puede decidir levantar ese límite, igual que R14 lo previó.**
- **Exponer estos comandos por conversación o por la herramienta MCP de `operaciones-negocio-conversacionales`.** Son administración y su canal es la TUI, por el reparto que el propio stakeholder fijó. Además: meter *"creá un empleado"* en un turno de modelo pondría la creación de identidad detrás de un paso no determinista.
- **Exponerlos por HTTP / adaptador web / brazo A2A.** Ejes distintos, sin pedido.
- **Dependencias nuevas en `package.json`.** El hash ya existe (`adapters/crypto/password.ts`), el parser ya existe, la tabla ya está diseñada.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado por `Glob` en esta fase. **`administracion-empleados-tui` no colisiona con ninguno.**

### New Capabilities

- **`administracion-empleados-tui`** — los dos comandos: qué crean, qué escriben, en qué orden se evalúan los chequeos, qué responden cuando el empleado ya existe / no existe / el rol es inválido, y **los invariantes negativos, que son el corazón del change**: (a) el rol **no** es parámetro de nada que un empleado sin `administrador` pueda ejecutar; (b) un empleado con rol base que ejecuta cualquiera de los dos **es rechazado y deja fila de auditoría**; (c) la contraseña **nunca** se persiste en claro, **nunca** aparece en una fila de auditoría y **nunca** aparece en un evento del log de turnos — invariante ya establecido y **testeado** por `autenticacion-empleado-tui` (`build-on-comando-empleado.test.ts:524`), que este change **extiende a un segundo comando**; (d) **ningún rol nuevo**: `ROLES_EMPLEADO` sigue teniendo exactamente dos miembros.

### Modified Capabilities

- **`comando-empleado-tui`** (`tui-canal-empleado/specs/`, ya modificada por `comando-reporte-comisiones`, `comando-cancelar-solicitud`, `comando-visibilidad-a2a-entrante` y `operaciones-negocio-conversacionales`) — **delta seguro y por definición**: cambia el conjunto de descriptores (15 → 17), lo que `/ayuda` imprime, y **★ agrega un segundo eje de gateo en el dispatcher** donde hoy sólo hay uno (sesión vigente). Ese segundo eje es novedad de spec, no plomería.
- **`autenticacion-empleado-tui`** (`tui-canal-empleado/specs/`, ya modificada por `autorizacion-empleado`) — **delta seguro, y es el más delicado del change**: su premisa de que el alta de credenciales vive fuera de la TUI **deja de ser cierta**. `sdd-spec` debe localizar la frase exacta, igual que `autorizacion-empleado` hizo con `spec.md:9`.
- **`autorizacion-empleado`** (`autorizacion-empleado/specs/`) — **candidata, a verificar leyendo, no razonando desde acá.** La pregunta concreta: su spec ¿dice que el rol se asigna **únicamente** por CLI? Si el requisito está redactado sobre el **canal**, hay delta; si está sobre el **efecto** (default deny, ausencia ⇒ rol base, lectura por puerto), **no lo hay** y este change sólo agrega un segundo escritor. Criterio fijado por `definicion-skills` y reusado por los dos changes hermanos.
- **`registro-acciones-empleado`** (`tui-canal-empleado/specs/`, ya modificada por `autorizacion-empleado`) — **candidata**: gana dos acciones nuevas y sus resultados. Depende de si su spec enumera acciones de forma exhaustiva.

---

## Approach

Cuatro piezas, en orden de dependencia. **La 1 es prerrequisito de seguridad de la 3, exactamente por el mismo motivo por el que el ADR 146 puso la separación de superficies antes de la concesión.**

1. **El gate de `administrador` en el dispatcher**, con su variante de rechazo y su fila de auditoría. Entregable y testeable **solo**, contra un comando de prueba, antes de que exista ningún comando administrativo real.
2. **El puerto de escritura de rol** y el descriptor + `Forma` de `/asignar-rol`. Toca `roles_empleado`, que ya está diseñada.
3. **El descriptor + `Forma` de `/crear-empleado`** y su escritura a `credenciales_empleado`, reusando el hash que ya existe. **Recién acá, y ya gateado.**
4. **`/ayuda`, arc42, README** y la nota de despliegue.

**TDD estricto — el test rojo inicial es el de la pieza 1**: *"un empleado con rol base ejecuta `/asignar-rol ana administrador` y lo logra"*. **Hoy ese test ni siquiera se puede escribir** porque el comando no existe; el día que exista sin la pieza 1, pasa en verde y el change habrá creado el agujero que `autorizacion-empleado` vino a cerrar.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 174-179)

La numeración continúa el techo real **ADR 173**, reverificado (Aclaración 1). Las decisiones de nivel diseño reservan **RD-80 en adelante**.

### ADR 174: La TUI **pasa a poder crear credenciales** — se revierte una propiedad del diseño a pedido del stakeholder, y lo que se conserva es el invariante que esa propiedad **realmente** protegía

**Contexto.** `credenciales-contract.ts:14-17` es explícito y fue escrito para que nadie lo tomara por descuido: *"la TUI no puede crear credenciales, y eso es una **propiedad del diseño, no un olvido**"*. El ADR 33 de `tui-canal-empleado` la sostuvo con un argumento concreto (`empleados.ts:77-84`): la contraseña entra por `stdin` y **★ NUNCA por `argv` — "`argv` queda en el historial del shell y en la tabla de procesos"**.

**Decisión**:

1. **Se revierte, y el que la revierte es el stakeholder, no esta propuesta.** Un alta de empleado es administración; el reparto de canales ya establecido dice que administración es TUI. **Se deja escrito así de literal para que el próximo lector de `credenciales-contract.ts:14-17` encuentre el ADR que lo cambió y no crea que alguien no lo leyó.**
2. ★ **Se separa qué protegía esa propiedad, porque no es una sola cosa y sólo una se pierde.** El ADR 33 pto 2 protegía **dos** superficies: (a) **el historial del shell y la tabla de procesos** —un `ps` de otro usuario del sistema ve `argv`—, y (b) **la persistencia en claro**. **(b) se conserva íntegro y sin matices**: la contraseña se hashea con el mismo `scrypt$N$r$p$salt$clave` y **nunca** toca una fila de auditoría ni un evento de log — invariante ya **testeado** (`build-on-comando-empleado.test.ts:524`) que este change extiende al comando nuevo. **(a) cambia de forma, no desaparece**: la TUI no es la tabla de procesos —`ps` no ve lo que se tipea en un `<TextInput>`— pero **sí es un transcripto visible**, que es exactamente el residual que `tui-canal-empleado` ya aceptó para `/login` (**R14**). **Lo nuevo, y hay que decirlo sin suavizar, es que el secreto es de OTRA persona.** Ver R1 y RD-81.
3. **El contrato de lectura `CredencialesEmpleadoPort` NO se toca.** Sigue teniendo **una** operación de lectura. El escritor es un contrato aparte, por el mismo criterio del ADR 176 y por el mismo que separó `rol-contract.ts` de `credenciales-contract.ts`.
4. **`src/empleados.ts` sobrevive y no se deprecia**, por tres razones: es el **bootstrap** del primer administrador (ADR 175 pto 5), es el único camino de **rotación** (fuera de alcance acá) y es el que corre **sin TUI** (scripts, CI, recuperación). **Dos escritores de `credenciales_empleado` es una duplicación aceptada a conciencia, y `sdd-design` debe decidir si comparten una función pura o no (RD-82).**

**Alternativas consideradas**:

- *No revertirla y explicarle al tutor que el diseño lo impide*: **rechazada, y por el mismo motivo por el que `operaciones-negocio-conversacionales` rechazó escudarse en el ADR 7**: un ADR es una decisión con contexto, no una excusa. El contexto cambió — cuando se escribió, no existía el reparto de canales ni el rol `administrador` que hace seguro exponerlo.
- *Que `/crear-empleado` **invoque** el script `src/empleados.ts` como subproceso*: **rechazada, y es la que parece gratis.** Metería `child_process` en el camino de un comando de la TUI, tendría que pasarle la contraseña por `stdin` o por `argv` (lo segundo es literalmente lo que el ADR 33 pto 2 prohíbe), y convertiría un error de escritura en un exit code que hay que reinterpretar. Compartir una **función pura** es la forma correcta de no duplicar (RD-82); compartir un **proceso**, no.
- *Que el alta genere una contraseña aleatoria que el admin no tipea, y la muestre una sola vez*: **no se descarta — es RD-81, y es la mejor respuesta conocida a R1.** Evita que el admin elija (y reuse) el secreto de otro, y acota la exposición a un renglón del transcripto en vez de a la tipeada. Se descarta como decisión de propuesta porque **no hay noción de "cambiar contraseña en el primer login"** en este repo y sin ella la contraseña generada es permanente — o sea, arrastra la recuperación de contraseña, que está fuera de alcance por tres changes. **Decisión del checkpoint (punto 2).**

### ADR 175: Los dos comandos exigen rol `administrador` — el **primer gate de autorización fuera del núcleo determinista**, y por qué eso **no** contradice al ADR 153

**Contexto.** El **ADR 153** de `autorizacion-empleado` decidió que el gate vive **en el núcleo determinista y no en el handler**, con un argumento fuerte (pto 2): *"un gate en el handler se evade cambiando de canal... un gate en el núcleo se hereda gratis"*. **Este change necesita un gate y no tiene núcleo determinista donde ponerlo**: `/crear-empleado` y `/asignar-rol` no invocan ninguna de las seis funciones puras — **son escrituras de administración, no operaciones de negocio.**

**Decisión**:

1. **Los dos comandos exigen `rol === "administrador"`, leído por puerto en el momento de la decisión** — mismo criterio del ADR 154 pto 1 de `autorizacion-empleado`: **no se cachea en la sesión**, así que quitarle el rol a alguien tiene efecto sin re-login, incluso con `SESION_TTL_MINUTOS=0`.
2. ★ **Sin esto el change es una escalación de privilegio trivial y anula a `autorizacion-empleado` entero.** Con `/asignar-rol` sin gate, **cualquier empleado con sesión vigente se escribe `administrador` a sí mismo** y a partir de ahí aprueba cualquier reembolso y cualquier solicitud. **Es el modo de falla más caro que este change puede tener y por eso es la pieza 1 del Approach, no la última.**
3. **Por qué esto NO contradice al ADR 153, y hay que argumentarlo en vez de asumirlo.** El ADR 153 decidió dónde va el gate **de una operación de negocio que tiene una función determinista**, y su argumento dirimente era *"ya existe un gate de autorización en el núcleo (`esAccionAutoservicio`); poner el segundo en otra capa partiría la autorización en dos lugares"*. **Acá no hay función determinista que gatear**: la operación **es** la escritura administrativa. El riesgo que el ADR 153 pto 2 quería evitar —*"se evade cambiando de canal"*— **está cerrado por Out of Scope**: estos comandos existen **sólo** en la TUI, no en conversación, no en HTTP, no en A2A. **Si mañana se expusieran por otro canal, el gate tendría que reubicarse, y esa condición queda escrita acá para que no se descubra tarde.** La **política** (qué rol alcanza) debe vivir en el módulo compartido `autorizacion-resolucion.ts` (ADR 158) y no duplicarse en el dispatcher — **la ubicación exacta es RD-84.**
4. ★ **Un `administrador` no puede quitarse el rol a sí mismo si es el único.** Es el mismo modo de falla que la **R1** de `autorizacion-empleado` —el sistema queda cerrado, sin ejecutor y sin forma de reabrirse desde la TUI— sólo que causado por un comando en vez de por la migración `0013`. **No se resuelve con un rol: se resuelve con un chequeo de cardinalidad**, que exige una operación de conteo. **Si `sdd-design` decide que el conteo es caro o ambiguo, la alternativa mínima es prohibir la auto-degradación sin más** (un administrador nunca se degrada a sí mismo; lo degrada otro). **Ver RD-83 y R3.**
5. **El bootstrap sigue siendo CLI, y eso es una consecuencia deseada, no un hueco.** Con default deny (ADR 156) no hay ningún `administrador` al mergear, así que **el primer administrador no puede salir de un comando que exige ser administrador**. `empleados:crear -- <id> --rol administrador` (ADR 160) es y sigue siendo la puerta de bootstrap. **La nota de despliegue de `autorizacion-empleado` (su R1) cubre este change sin cambios.**
6. **Un rechazo por autorización deja fila en `registro_acciones_empleado`**, con el mecanismo que ya existe (`registrar()`, ADR 161) y no uno nuevo. **Es donde la auditoría funciona como control y no como registro** — el punto entero de la Aclaración 3 de `autorizacion-empleado`.

**Alternativas consideradas**:

- *Usar `privilegiado: true` y nada más*: **rechazada, y es la trampa más peligrosa del change.** `privilegiado` significa *"exige sesión vigente"* (`comando-empleado.ts:87`) y lo consume **una** guarda (`build-on-comando-empleado.ts:1714-1718`). Usarlo acá dejaría los dos comandos abiertos a cualquier empleado logueado. **Resignificarlo es peor todavía**: rompería en silencio `/consultar-kpi`, `/ver-propuesta` y `/ver-solicitudes-a2a`, que son `privilegiado: true` y de solo lectura (**R4** de `autorizacion-empleado`). **El campo no se toca. El concepto nuevo lleva nombre nuevo.**
- *Un campo `requiereAdministrador: boolean` en `DescriptorComando`*: **no se descarta — es RD-84.** Es simétrico con `privilegiado`/`secreto`, mantiene el descriptor como única fuente de verdad del gateo (que es lo que `DescriptorInterno.tipo` ya promete, `:125-126`) y hace que el gate sea una guarda genérica en vez de dos `if` inline. A cambio, agrega un campo que quince descriptores tienen que declarar en `false`.
- *Poner el gate en una función determinista nueva del núcleo, sólo para respetar la forma del ADR 153*: **rechazada.** Sería una función pura que no calcula nada, creada para satisfacer la estética de un ADR cuyo argumento (heredar el gate entre canales) **no aplica** a un comando que existe en un solo canal por decisión de alcance.
- *No gatear y confiar en que sólo el dueño del arnés usa la TUI*: **rechazada sin discusión.** Es exactamente el razonamiento *"auditar sin autorizar"* que `autorizacion-empleado` documentó como *"documentar el fraude, no prevenirlo"*.

### ADR 176: El rol se **escribe** por un puerto propio — `RolEmpleadoPort` (ADR 162) **no se toca**, y el modelo de rol **no se reimplementa**

**Contexto.** `rol-contract.ts` (ADR 162) declara literal: *"**UNA sola operación, de LECTURA, síncrona.** `undefined` = ausencia de fila, NUNCA un tercer valor"*, molde exacto de `CredencialesEmpleadoPort`. La escritura hoy existe **sólo** en `repository.ts` (`upsertRolEmpleado`) y la consume **sólo** `src/empleados.ts`.

**Decisión**:

1. **`RolEmpleadoPort` conserva su única operación de lectura.** Agregarle un `asignarRol` convertiría un contrato de lectura en uno mixto y obligaría a que **cada consumidor de lectura** —incluido el gate del núcleo de `autorizacion-empleado`— reciba un puerto que puede escribir. **Es el mismo criterio con el que `credenciales-contract.ts` se quedó en una sola operación y por el que `autorizacion-empleado` no le agregó la escritura pese a tener el mismo pedido.**
2. **El escritor es un contrato nuevo, con una sola operación.** Su forma exacta y dónde vive (`rol-contract.ts` junto al lector, o archivo propio) es **RD-82**.
3. ★ **La implementación llama a `upsertRolEmpleado(db, { empleadoId, rol, ahora })`** (`autorizacion-empleado/design.md:376-379`) — la función que ese change ya especifica al nivel de firma, con `ON CONFLICT(empleado_id) DO UPDATE`, `created_at` sólo en el INSERT y `updated_at` siempre pisado. **Invariante negativo de spec, y es la razón de ser de esta sección: este change NO escribe SQL de roles propio, NO define un segundo vocabulario de rol y NO crea una segunda tabla.** Si `sdd-design` produce un `ROLES_*` nuevo o un `CREATE TABLE`, el change se salió de su propuesta.
4. **`ROLES_EMPLEADO` sigue teniendo exactamente dos miembros.** El comando **valida contra el array**, no contra una lista propia — mismo mecanismo que `ROLES_VALIDOS` en `parseArgsEmpleado` (`design.md:225,246`), que **se generaliza solo** si mañana aparece un tercer rol. **Este change no agrega un rol.**
5. **Asignar rol a un `empleado_id` sin credencial ⇒ error.** Mismo criterio que ADR 160 (segunda mitad de RD-79): *"un rol sin credencial detrás no tiene a quién autenticar"*. **Se reusa el criterio, no se reinventa.**

### ADR 177: Dos descriptores y dos `Forma` nuevas — el parser genérico **no cambia**, y el precedente está escrito cuatro veces en el propio archivo

**Contexto.** `Forma` (`comando-empleado.ts:114-121`) tiene siete variantes, y su comentario (`:93-113`) documenta **cuatro** ampliaciones previas con el mismo criterio: *"Una forma nueva por SHAPE de payload — no un campo de configuración que obligaría a un cast en el `return`"*.

**Decisión**:

1. **Los dos comandos usan el patrón de parseo de `id_mas_resto`** —el de `/login`: primer token + resto— **con clave de payload propia**: `password` para `/crear-empleado`, `rol` para `/asignar-rol`. Por la regla escrita, eso son **dos `Forma` nuevas**, no una reutilización.
2. **El formato del rol NO se valida en el parser.** Se valida contra `ROLES_EMPLEADO` en la capa que decide, igual que `"id_opcional_periodo"` dejó la validación de `periodo` a `resolverPeriodoReporte` (*"El formato de `periodo` NO se valida acá (ADR 123 pto 1) — eso vive en otra capa"*, `:105-108`). **`ID_REGEX` sí se aplica al `empleadoId`, en las dos**, porque es guarda de forma y ya es el criterio del CLI.
3. **`privilegiado: true` en los dos** — necesitan sesión vigente, obviamente. **Y eso NO es el gate de administración**: son dos chequeos distintos que se evalúan en orden (autenticación primero, autorización después), exactamente como `autorizacion-empleado` dejó los cinco comandos HITL.
4. **`secreto: true` sólo para `/crear-empleado`.** Segundo del repo tras `/login`.
5. **La tanda va ANTES de `/ayuda`** (`:134-136`, regla escrita) y **ningún descriptor existente cambia de orden ni de forma.** Verificable con `git diff`.

### ADR 178: Configuración del bot de PRs desde la TUI — **DIFERIDA**, con dos motivos verificados y condición de disparo escrita

**Contexto.** Aclaración 3 pto 3, íntegra. **Dos hechos, los dos leídos del código**: (a) `startWebhookServer` se llama **una** vez, en `main.ts:311`, y `isWebhookEnabled` —*"Único gate del listener"*, `webhooks/config.ts:80`— decide ahí si se abre el puerto o se loguea `webhook-deshabilitado`; (b) `GITHUB_WEBHOOK_SECRET` y `GITHUB_TOKEN` son **secretos recuperables** y este repo **no persiste ningún secreto recuperable** en sus quince tablas.

**Decisión**:

1. **Se difiere entera.** No se construye un comando parcial.
2. ★ **Y se difiere por el segundo motivo, no por el primero.** El primero —que un cambio sólo surtiría efecto al reiniciar— **se podría diseñar honestamente**: un almacén persistido que `resolveWebhookConfig` consultara, y una respuesta de comando que dijera *"queda aplicado al próximo arranque"* (`resolveWebhookConfig` ya recibe su fuente por parámetro, `config.ts:71`, así que técnicamente hay dónde enchufarlo). **Sería feo pero verdadero.** **El segundo motivo es el que bloquea**: mover `GITHUB_TOKEN` de `.env` a SQLite es **crear la primera bóveda de secretos de este repo**, en un archivo (`data/harness.db`) que hoy nadie trata como tal — sin cifrado en reposo, sin rotación, sin política de acceso, y con backups que hoy son copiar un archivo. **Es una decisión de seguridad más grande que todo el resto de este change junto.**
3. **Lo que NO se difiere por esto: nada de este change.** Alta de empleado y asignación de rol no tocan `.env` ni ningún secreto de integración.
4. **Condición de disparo escrita, y son dos, conjuntas**: (a) que exista una decisión tomada sobre **dónde viven los secretos de integración de este arnés** —`.env`, un gestor externo, o una bóveda propia con cifrado en reposo—, y (b) que el requerimiento se exprese sobre **qué** hace falta configurar en caliente, porque hoy el pedido es *"que se pueda desde la TUI"* y no *"que el listener arranque y pare sin reiniciar"*, que son dos changes de tamaño muy distinto.
5. ★ **Alternativa barata que esta propuesta NO incluye pero deja nombrada para el checkpoint**: un comando de **solo lectura** `/estado-bot-prs` que muestre si el listener está escuchando, en qué puerto y en qué path, y si `GITHUB_TOKEN` está presente **sin mostrarlo** — cero escrituras, cero secretos nuevos, y atiende el 80% del dolor real (*"¿está andando?"*). **Se deja fuera del alcance porque no es lo que el stakeholder pidió, y meterlo por iniciativa propia sería exactamente el desborde que este ADR difiere.** Punto 3 de *Qué necesita el checkpoint*.

### ADR 179: "Configuración por usuario" — **DIFERIDA por falta de referente verificable**, no por tamaño

**Contexto.** Aclaración 3 pto 4, íntegra. **Se buscó en los tres lugares y no hay nada**: ninguna de las quince tablas es de settings; `src/core/config/env.ts` enumera **todas** las variables del sistema y **todas son de proceso**; y el mismo archivo declara que la identidad de empleado **nunca** viene de configuración (`:54-58`).

**Decisión**:

1. **No se construye un framework genérico de settings.** Con **cero** settings conocidos, sería **infraestructura sin consumidor** — el anti-patrón que este repo ya rechazó por nombre en `hito-2.2/design.md §15` (ADR 89 pto 1) y recitó en el ADR 106 y en el ADR 150 pto 2.
2. ★ **La hipótesis con más respaldo es que no es una cuarta capacidad.** *"Configuración del arnés para un usuario, sin `.env`"* se lee, con la evidencia a la vista, como **el paraguas de los otros tres pedidos** (*"quiero administrar el arnés sin editar archivos a mano"*) y no como un concepto nuevo. **Si esa lectura es correcta, este change ya entrega dos tercios de la cuarta capacidad y el tercio restante es el ADR 178.**
3. **Se difiere con una pregunta, no con una estimación.** **Condición de disparo: que el stakeholder nombre AL MENOS UNA cosa concreta que hoy sea global y deba ser por usuario.** Con un ejemplo concreto, el diseño es chico y se puede hacer bien; sin ninguno, cualquier diseño es adivinanza. Punto 4 de *Qué necesita el checkpoint*.
4. **Hipótesis candidatas, nombradas para ayudar al stakeholder a contestar y NO como alcance**: `SESION_TTL_MINUTOS` por empleado (hoy global, `auth-config.ts`), idioma/verbosidad de las respuestas de la TUI, o destinatario de notificaciones. **Ninguna está pedida y ninguna entra en este change.**

---

## Affected Areas

| Área | Impacto | Qué cambia |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | **Modificado** | Dos entradas en `DESCRIPTORES` (15 → 17, **antes de `/ayuda`**), dos variantes de `ComandoEmpleado`, dos `Forma` nuevas. ★ **El campo `privilegiado` NO se resignifica** (ADR 175, R4 heredada). Ningún descriptor existente cambia de orden ni de forma |
| `src/core/auth/rol-contract.ts` | **Modificado o acompañado** | Contrato de **escritura** de rol, una sola operación. ★ **`RolEmpleadoPort` (lectura) NO se toca** (ADR 176 pto 1). Ubicación exacta = **RD-82** |
| `src/core/auth/autorizacion-resolucion.ts` (de `autorizacion-empleado`, ADR 158) | **Modificado** | La política *"¿alcanza el rol para administrar?"* vive acá, no duplicada en el dispatcher. **Ubicación exacta = RD-84** |
| `src/build-on-comando-empleado.ts` | **Modificado** | ★ **Segundo eje de gateo**, junto a la guarda de sesión (`:1714-1718`, que **se conserva sin cambio**). Dos despachos nuevos. Fila de auditoría del rechazo vía `registrar()` (ADR 161, mecanismo existente) |
| `src/adapters/memory/repository.ts` | **Modificado** | Sólo si hace falta una operación de **conteo** de administradores (ADR 175 pto 4, RD-83). **`upsertRolEmpleado` e `insertCredencialEmpleado` se reusan, no se reescriben** |
| `src/empleados.ts` | **Sin cambios esperados** | Sigue vivo: bootstrap del primer administrador, rotación, y camino sin TUI (ADR 174 pto 4). **Si comparte una función pura con el comando nuevo, eso es RD-82** |
| `src/core/auth/credenciales-contract.ts` | **Comentario modificado** | ★ El comentario de `:14-17` (*"la TUI no puede crear credenciales"*) **deja de ser cierto** y debe apuntar al ADR 174. **No cambiar este comentario sería dejar una mentira en el contrato** |
| `src/core/auth/sesion.ts` | **Sin cambios** | Invariante heredado del ADR 154 pto 2. Verificable con `git diff` |
| `src/core/{ventas,solicitudes}/resolver-*.ts` | **Sin cambios** | Este change no toca el gate del núcleo ni `esAccionAutoservicio` |
| `src/adapters/webhooks/*`, `src/adapters/board/*`, `src/core/config/env.ts` | **Sin cambios** | **ADR 178: diferido.** Que estas rutas no aparezcan en el `git diff` es el criterio verificable del diferido |
| `src/main.ts` | **Modificado** | Composition root: el puerto de escritura de rol entra en las `deps` |
| `.claude/skills/**` | **Sin cambios** | Estos comandos no son conversacionales (ADR 150 pto 3: cero ediciones en `src/core/skills/`) |
| `docs/ARC42_*.md`, `README.md` | Modificado | Reparto de canales completo; la propiedad de `credenciales-contract.ts` cambió con ADR; los dos diferidos con nombre |
| `package.json` | **Sin cambios** | Sin dependencias nuevas. **El script `empleados:crear` se conserva** |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★ | **La contraseña inicial de OTRO empleado queda visible en el transcripto de la TUI.** Heredero directo de **R14** de `tui-canal-empleado` (*"la TUI no puede enmascarar lo que se tipea"*, ADR 21), pero **agravado**: en `/login` el secreto es del que tipea; acá es de un tercero | **Alta — es CERTEZA si no se decide** | **No es un bug: es la consecuencia de no tocar `tui-port.ts`.** Tres salidas, y **es decisión del checkpoint (punto 2)**: (a) aceptar el residual como R14 lo aceptó, con rotación inmediata por CLI documentada; (b) contraseña generada y mostrada una vez (**RD-81**); (c) levantar el límite del ADR 21 y enmascarar — **que es lo que R14 previó que el checkpoint podía decidir** |
| **R2** | **Desborde hacia el paquete de `0006`**: desactivación, borrado, rate limiting, política de fortaleza, recuperación de contraseña. **Un comando de alta de empleado es el imán natural de todas** | **Alta** | Nombradas una por una en *Out of Scope*, con su diferido de origen (ADR 33 pto 3, R15). **Success Criteria fija el número: dos comandos, dos escrituras, cero conceptos nuevos de ciclo de vida de empleado** |
| **R3** ★ | **Auto-degradación del último administrador deja el sistema cerrado y sin forma de reabrirlo desde la TUI** — el mismo modo de falla que la **R1** de `autorizacion-empleado`, disparado por un comando | Media | ADR 175 pto 4, con un fallback mínimo si el conteo resulta caro (prohibir la auto-degradación sin más). **Salida de emergencia siempre disponible y ya documentada: `empleados:crear -- <id> --rol administrador` por CLI** (ADR 160) |
| **R4** | **Se reimplementa el modelo de rol** en vez de llamar al de `autorizacion-empleado`: un `ROLES_*` propio, un `CREATE TABLE` propio, un segundo vocabulario | Media | ADR 176 ptos 3-4 como invariante negativo de spec, con Success Criterion verificable por `git diff`: **ninguna migración nueva, ninguna constante de rol nueva** |
| **R5** | **Se resignifica `privilegiado`** por parecer el lugar natural del gate, rompiendo en silencio los tres comandos de solo lectura que son `privilegiado: true` | Media | ADR 175 alternativa 1 y ADR 177 pto 3, elevados a línea de *Affected Areas*. **R4 de `autorizacion-empleado`, heredada literal** |
| **R6** ★ | **Dependencia de secuencia con `autorizacion-empleado`, que está en diseño y NO mergeado**: este change consume `roles_empleado`, `ROLES_EMPLEADO`, `upsertRolEmpleado` y `autorizacion-resolucion.ts`, **ninguno de los cuales existe todavía en `main`** | **Alta si se empieza en paralelo** | **Dependencia DURA y de una sola dirección** — ver *Dependencies*. **No es negociable por orden de merge como la R6 de aquel change: acá no hay solapamiento simétrico, hay prerrequisito.** Punto 1 de *Qué necesita el checkpoint* |
| **R7** | **Conflicto de merge con `operaciones-negocio-conversacionales`**: los dos tocan `DESCRIPTORES` y `build-on-comando-empleado.ts`, **aquél quitando tres entradas y éste agregando dos** | **Alta si corren en paralelo** | Mecánico, no semántico — ninguno de los dos toca los descriptores del otro. **Pero el conteo de *Success Criteria* (15 → 17) sólo es cierto si aquél mergea primero.** Si mergea después, este change lo deja en **18 → 20 → 17**. **Hay que fijar el orden, no descubrirlo** |
| **R8** | **El diferido del ADR 178 se lee como "no se pudo" y alguien lo reabre por prolijidad**, metiendo secretos en SQLite | Media | ADR 178 pto 2 dice el motivo real con nombre —**crear la primera bóveda de secretos del repo**— y pto 4 fija dos condiciones de disparo conjuntas. **Se documenta en el arc42 como deuda con nombre**, mismo tratamiento que R7 de `autorizacion-empleado` |
| **R9** | **El ADR 179 se resuelve inventando settings plausibles** en vez de preguntando | Media | ADR 179 pto 4 nombra candidatas **explícitamente marcadas como NO alcance**. La condición de disparo es una pregunta al stakeholder, no una estimación |
| **R10** | **Las specs hermanas resultan tener requisitos redactados sobre el CANAL** (*"el rol se asigna únicamente por CLI"*) y aparecen deltas no previstos | Media | Declarado en *Modified Capabilities*: dos deltas seguros, dos candidatas a verificar leyendo. Criterio fijado por `definicion-skills` y reusado por los dos changes hermanos |

---

## Rollback Plan

**Reversible, y más limpiamente que el de `autorizacion-empleado`, porque este change no cambia la semántica de ninguna decisión existente: sólo agrega dos puertas de entrada a escrituras que ya existían por otro canal.**

Revertir en caliente = **revertir el commit de los dos descriptores**. Los comandos desaparecen de `DESCRIPTORES` y de `/ayuda`; tipearlos cae en la rama `{ tipo: "ayuda", motivo: "desconocido" }` que ya existe (`comando-empleado.ts:348`). **El provisioning vuelve a ser CLI y nada queda bloqueado** — `empleados:crear` nunca dejó de funcionar (ADR 174 pto 4), así que **la reversión no deja ninguna operación de negocio sin ejecutor.** Es la diferencia con la R1 de `autorizacion-empleado` y conviene decirla: allá revertir el gate volvía el sistema permisivo en silencio; **acá revertir sólo quita un atajo.**

**No hay migración que revertir.** Este change **no escribe ninguna** (ADR 176 pto 3, Success Criterion verificable): consume `0013` de `autorizacion-empleado`, que se revierte —o no— con su propio change y bajo su propia regla (el repo no tiene `down`, y no lo necesita).

**El dato creado sobrevive a la reversión, y eso es correcto**: las credenciales y los roles asignados desde la TUI son idénticos a los que habría escrito el CLI —misma tabla, mismo hash, misma función de upsert— así que **quitar el comando no invalida ni una fila**. No hay estado a medias posible: cada comando mapea a **una** escritura sobre **una** tabla (disciplina heredada del ADR 160).

**El riesgo real de rollback es el de R1 y es operativo, no técnico**: si se revierte después de haber creado empleados con contraseñas visibles en un transcripto, **esas contraseñas siguen siendo válidas**. **La reversión tiene que venir acompañada de rotación por CLI de todo empleado creado por este camino**, y eso va en la nota de despliegue, no en el `git revert`. A nivel git: revertir los commits de la rama antes del merge a `main`.

---

## Dependencies

- ★ **`autorizacion-empleado` mergeado. DEPENDENCIA DURA, no negociable, y HOY NO SATISFECHA EN `main`.** Este change consume cuatro artefactos que ese change crea: la tabla `roles_empleado` (migración `0013`, ADR 157), el vocabulario `ROLES_EMPLEADO` (`rol-contract.ts`, ADR 162), la función `upsertRolEmpleado` (`repository.ts`, ADR 162) y el módulo de política `autorizacion-resolucion.ts` (ADR 158). **Sin ellos, `/asignar-rol` no tiene rol que asignar y el gate del ADR 175 no tiene rol que leer.** Su `design.md` está completo y listo para `sdd-tasks`, pero **completo no es mergeado** (R6).
- **La condición de disparo literal del ADR 150 pto 1 es `operaciones-negocio-conversacionales` cerrado y mergeado — y tampoco está satisfecha.** **Se dice en vez de omitirse.** Pero el motivo que ese ADR dio para diferir es *"mezclarlo con un change que ya mueve la frontera de autenticación junta dos cambios de seguridad en un diff"*, **y eso es un argumento contra la MEZCLA, no contra el orden**: escribir este change por separado ya lo satisface en sustancia. **Lo que sí queda vivo de aquel change es el conflicto mecánico sobre `DESCRIPTORES` (R7), que es de orden de merge y no de bloqueo.** **Decisión del checkpoint, punto 1.**
- **Autenticación de empleado operativa y mergeada** (`tui-canal-empleado`, `v1.2.0`) — ya satisfecha. Aporta el hash scrypt, `ID_REGEX`, el dispatcher, `registro_acciones_empleado` y el molde de descriptor.
- **El esquema de migraciones vigente** (`0001`-`0012`) más `0013` de `autorizacion-empleado`. **Este change no agrega ninguna.**
- ★ **Lo que NO depende de este change: nada.** Es hoja del grafo. Ningún ADR abierto en el repo está bloqueado esperándolo. **El ADR 151 de `operaciones-negocio-conversacionales` está bloqueado por `autorizacion-empleado`, no por éste.**
- **Checkpoint humano de `AGENTS.md`** aprobando esta propuesta **antes** de `sdd-spec`/`sdd-design` — en particular el **ADR 174** (se revierte una propiedad escrita del diseño), **R1** (contraseña de terceros visible) y los dos diferidos (**ADR 178** y **179**).

---

## Success Criteria

- [ ] ★ **Un test demuestra que un empleado con rol base NO puede ejecutar `/crear-empleado` ni `/asignar-rol`**, y que uno con `administrador` sí. **Es el test rojo inicial del TDD estricto y la prueba de que este change no abrió el agujero que `autorizacion-empleado` cerró.**
- [ ] ★ **Un test demuestra que un empleado con rol base NO puede auto-asignarse `administrador`** — el caso concreto de escalación de privilegio (ADR 175 pto 2).
- [ ] **Un test demuestra que quitarle el rol a un administrador tiene efecto sin re-login**, con una sesión sin `expiraEn` (ADR 175 pto 1, criterio heredado del ADR 154 pto 1).
- [ ] ★ **Un test demuestra que la contraseña no se persiste en claro, no aparece en ninguna fila de `registro_acciones_empleado` y no aparece en ningún evento del log** — **molde exacto del test que ya existe para `/login`** (`build-on-comando-empleado.test.ts:524`), extendido al comando nuevo (ADR 174 pto 2).
- [ ] **Un test demuestra que el último administrador no puede degradarse a sí mismo** (ADR 175 pto 4, R3).
- [ ] **`git diff` demuestra que el change NO agrega ninguna migración, ningún `CREATE TABLE` y ninguna constante de rol nueva** (ADR 176 ptos 3-4, R4). **`ROLES_EMPLEADO` sigue teniendo exactamente dos miembros.**
- [ ] **`git diff` demuestra que `src/core/auth/sesion.ts` NO fue modificado**, que **`privilegiado` no fue resignificado** (R5) y que **ningún descriptor existente cambió de orden ni de forma** (ADR 177 pto 5).
- [ ] **`DESCRIPTORES` queda en dieciocho entradas**, con los tres nuevos (`/crear-empleado`, `/asignar-rol`, `/estado-bot-prs`) **antes de `/ayuda`**, que sigue último. *(Cuenta partiendo de quince, o sea asumiendo las tres bajas de `operaciones-negocio-conversacionales` ya mergeadas — ver **R7**. `/estado-bot-prs` sumado por decisión de checkpoint, punto 3.)*
- [ ] **Un rechazo por autorización deja fila en `registro_acciones_empleado`** con resultado distinguible, escrita con `registrar()` y **sin ningún método de puerto nuevo** (ADR 175 pto 6 / ADR 161).
- [ ] **`src/empleados.ts` sigue funcionando sin cambios de comportamiento** — el bootstrap del primer administrador por CLI sigue siendo el camino documentado (ADR 175 pto 5).
- [ ] **El comentario de `credenciales-contract.ts:14-17` fue actualizado y apunta al ADR 174.** **Es el criterio que impide dejar una afirmación falsa en un contrato del núcleo.**
- [ ] ★ **`git diff` demuestra que `src/adapters/webhooks/`, `src/adapters/board/` y `src/core/config/env.ts` NO fueron tocados** — **es el criterio verificable de que el diferido del ADR 178 se respetó** y de que ningún secreto se movió a SQLite.
- [ ] **Los dos diferidos (ADR 178 y 179) quedan escritos en el arc42** como deuda con nombre, cada uno con su motivo verificado y su condición de disparo — mismo tratamiento que `autorizacion-empleado` le dio a su R7.
- [ ] **La nota de despliegue dice qué pasa con las contraseñas creadas por TUI** según la salida que el checkpoint elija para R1.
- [ ] `npm test` y `npm run typecheck` en verde; **TDD estricto**.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, carpeta de progreso con evidencia, tag.

---

## Qué necesita el checkpoint humano

> **Este change le da a un comando de TUI la capacidad de crear identidades y de repartir el único privilegio del sistema.** Mismo tratamiento que `tui-canal-empleado` cuando introdujo autenticación y que `autorizacion-empleado` cuando introdujo autorización: **la aprobación humana es bloqueante antes de `sdd-spec`/`sdd-design`.**

1. ★ **Secuenciación (R6 y R7), y es lo primero porque condiciona todo lo demás.** Este change **no puede empezar a implementarse antes de que `autorizacion-empleado` mergee** — consume su tabla, su vocabulario, su función de upsert y su módulo de política. **Sí se puede especificar y diseñar en paralelo.** Y hay una segunda pregunta, aparte: `operaciones-negocio-conversacionales` toca `DESCRIPTORES` quitando tres entradas mientras éste agrega dos; el conflicto es mecánico, pero **el orden hay que fijarlo**. **Inclinación: `autorizacion-empleado` → `operaciones-negocio-conversacionales` → éste**, que es el orden que deja el conteo de descriptores limpio y cada diff auditable. **Decisión tuya antes de `sdd-tasks`.**
2. ★ **R1 / RD-81: la contraseña inicial de otro empleado va a quedar visible en el transcripto de la TUI.** No es un detalle de implementación: es la consecuencia directa de no tocar `tui-port.ts` (ADR 21), y `tui-canal-empleado` ya lo previó en **R14** diciendo textual que *"el checkpoint puede decidir levantar"* ese límite. **Tres salidas y necesito que elijas una**: (a) aceptar el residual, con rotación inmediata por CLI documentada como procedimiento; (b) que el comando **genere** la contraseña y la muestre una sola vez (mejor, pero sin "cambiar en el primer login" queda permanente); (c) **levantar el límite del ADR 21** y enmascarar la entrada en la TUI — que es lo correcto a largo plazo y **agranda este change de forma no trivial**, porque toca el contrato I1.
3. **ADR 178 — confirmá que aceptás el diferido de la configuración del bot de PRs, y decime si querés el paliativo.** El motivo no es el que parece: no es *"habría que reiniciar"* (eso se puede diseñar honestamente), es que **mover `GITHUB_TOKEN` a SQLite crea la primera bóveda de secretos de este repo**, sin cifrado en reposo ni rotación. **Si lo que te duele es no saber si el bot está andando, hay una salida barata que dejé nombrada pero fuera de alcance a propósito: un `/estado-bot-prs` de solo lectura, que no muestra ningún secreto.** Decime si lo querés y lo sumo; **no lo agrego por iniciativa propia porque no es lo que pediste.**
4. ✅ **ADR 179 resuelto por el checkpoint**: "configuración por usuario" **queda cubierto** por `/crear-empleado`, `/asignar-rol` y `/estado-bot-prs` — no es una cuarta capacidad. Se investigó el candidato concreto más cercano ("a quién le llegan las notificaciones") y **no tiene referente real**: `src/adapters/notificaciones/index.ts` hoy notifica al **cliente** (link de confirmación de venta), no al empleado — no existe ningún concepto de notificación al empleado hoy. Construirlo sería una feature nueva de cero, no una config, y **queda fuera de este change** por decisión explícita del checkpoint (no por adivinanza).
5. **ADR 174 — ratificá que revertimos la propiedad escrita.** `credenciales-contract.ts:14-17` dice que la TUI **no puede** crear credenciales y que *"eso es una propiedad del diseño, no un olvido"*. Lo pediste vos y es tu decisión; lo que necesito es que quede **ratificado** para poder cambiar ese comentario con un ADR que lo nombre, en vez de que el próximo lector crea que alguien no lo leyó.
6. **Nombres de los comandos (RD-80).** Inclinación: **`/crear-empleado`** (toma el verbo del script que ya existe, `empleados:crear`) y **`/asignar-rol`** (el nombre que los dos changes hermanos ya usan al diferirlo). Alternativa razonable: `/alta-empleado`, que es el término que usa `empleados.ts` internamente. **Es cosmético pero queda en la UI para siempre.**
7. **Numeración y versión.** La versión la pone el checkpoint, como en los cuatro precedentes.

## Decisiones reservadas para `sdd-design` (RD-80 en adelante)

| RD | Qué | Por qué no se decide acá |
|---|---|---|
| **RD-80** | **Nombres exactos y textos de `uso`/`ayuda`** de los tres descriptores | Cosmético pero permanente; conviene fijarlo con los dieciocho descriptores finales a la vista y el texto de `/ayuda` armado |
| **RD-81** ★ | **Cómo entra la contraseña**: tipeada (residual R14 aceptado), generada y mostrada una vez, o enmascarada levantando el ADR 21 | **Depende de la respuesta del checkpoint (punto 2)** y cambia el tamaño del change: la opción (c) toca el contrato I1 (`tui-port.ts`), que hoy es Out of Scope |
| **RD-82** | **Dónde vive el contrato de escritura de rol** (en `rol-contract.ts` junto al lector, o archivo propio) **y si `/crear-empleado` y `src/empleados.ts` comparten una función pura** de alta | ADR 174 pto 4 y ADR 176 pto 2. El molde de `credenciales-contract.ts`/`rol-contract.ts` sugiere separar lectura de escritura; si comparten un archivo o no se decide con los dos contratos escritos. La duplicación con el CLI es **aceptada**, pero cuánta se comparte exige ver el cuerpo de `main()` de `empleados.ts:98-145` |
| **RD-83** ★ | **Cómo se protege al último administrador** (conteo real vs. prohibir la auto-degradación sin más) **y qué lista `/ayuda` a un empleado sin `administrador`** | ADR 175 pto 4. El conteo pide una operación de repositorio nueva; la prohibición simple no pide nada y cubre el 90%. **Y lo de `/ayuda` no es cosmético: listar un comando que el lector no puede usar es ruido, pero ocultarlo hace que el sistema mienta sobre lo que existe** — el repo ya tuvo esta discusión con `no_es_dueno` y *"rechazar sin filtrar datos del ítem ajeno"* |
| **RD-84** | **Forma del gate en el dispatcher**: campo `requiereAdministrador` en `DescriptorComando` (guarda genérica, simétrico con `privilegiado`/`secreto`) vs. chequeo inline en los dos despachos | ADR 175 alternativa 2. El campo mantiene el descriptor como única fuente de verdad del gateo (`:125-126`) y hace la guarda genérica para comandos futuros; a cambio, quince descriptores declaran `false`. **Se decide con `autorizacion-resolucion.ts` (ADR 158) a la vista**, para no duplicar la política |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. **El ejecutor de esta fase corrió sin herramienta de shell disponible** (sólo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por Hito 3, Hito 4, `definicion-skills` (`proposal.md:281`), `operaciones-negocio-conversacionales` y `autorizacion-empleado` (`proposal.md:328`). Se compensó con lectura directa y verificación puntual de **cada** afirmación citada: `src/core/commands/comando-empleado.ts:80-159` (la interfaz `DescriptorComando` con `privilegiado`/`secreto`, las siete variantes de `Forma` con su comentario `:93-113` sobre *"una forma nueva por SHAPE de payload"*, la regla de orden `:134-136`, y el conteo de **dieciocho** descriptores por grep de `nombre`/`tipo`/`privilegiado` sobre `:139-317`); `src/core/auth/credenciales-contract.ts:1-23` **íntegro** (puerto de una operación de lectura y el comentario `:14-17`); `src/empleados.ts:9-12,30-34,76-109` (contraseña por `stdin`, el **★ ADR 33 pto 2** *"NUNCA por `argv`: `argv` queda en el historial del shell y en la tabla de procesos"*, y el residual R14 *"la línea tipeada SE VE en la terminal"*); `src/core/config/env.ts` **íntegro** (único punto de carga, enumeración completa de variables, y **`EMPLEADO_ID` inexistente** con *"never from configuration"* en `:54-58`); `src/adapters/webhooks/config.ts:20-83` (`resolveWebhookConfig` puro con `env` por parámetro, e `isWebhookEnabled` como *"Único gate del listener"*); `src/adapters/webhooks/index.ts:50-88` (`startWebhookServer` resolviendo config y decidiendo el bind **una sola vez**); `src/main.ts:287,309-318` (`resolveBoardConfig()` y `startWebhookServer` invocados **una vez, al arranque**); grep de `CREATE TABLE IF NOT EXISTS` sobre `migrations/**` (**quince tablas**, ninguna de settings ni preferencias); `openspec/changes/autorizacion-empleado/design.md:198-283` (ADR 160, los tres modos de `parseArgsEmpleado` y el diff exacto), `:287-297` (ADR 161, `registrar()` como mecanismo existente) y `:337-416` (ADR 162, `RolEmpleadoPort` de **una operación de lectura**, `upsertRolEmpleado`, y el DDL de `roles_empleado`); `openspec/changes/autorizacion-empleado/proposal.md` **íntegro** (ADR 152-156, R1/R4/R7, y el Out of Scope `:94` que difiere este change por nombre); `openspec/changes/operaciones-negocio-conversacionales/proposal.md:1-346` (Out of Scope `:83`, **ADR 148** con los dieciocho descriptores, **ADR 150 pto 1** `:265` con la condición de disparo textual, y **ADR 151 BLOQUEADO** `:271-293`, que es lo que deja el conteo en quince y no en diez); `openspec/changes/tui-canal-empleado/proposal.md:55,63,65-66` (ADR 21, ADR 33 y **R14**); `openspec/changes/hito-1.2-bot-revision-prs/proposal.md:20,61,114,147` (config por env y el listener opt-in); y el techo de ADR/RD por grep sobre **todo** `openspec/changes/*` (**ADR 173** en `operaciones-negocio-conversacionales/design.md`, **RD-79** en `autorizacion-empleado`). Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` ejecute `graphify explain` sobre los conceptos nuevos (comando administrativo, gate de rol en el dispatcher, escritor de rol).
