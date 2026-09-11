# Propuesta: `/reporte-comisiones [periodo]` — el reporte mensual entra al Registro de Comandos (v3.2.0)

**Origen**: [`openspec/changes/hito-1.3-ventas-comisiones/proposal.md:97-111`](../hito-1.3-ventas-comisiones/proposal.md), **ADR 9** (*"El 'comando' del reporte mensual es un script CLI, no un Registro de Comandos ni un scheduler"*) y su **disparador escrito** en la línea 106. Este change existe porque ese disparador **sonó**, y el propio ADR 9 dice cuándo.

**Rama prevista**: `hito/v3.2-comando-reporte-comisiones` · **Tag de cierre**: `v3.2.0` · **Carpeta de progreso**: `docs/progreso/v3.2-comando-reporte-comisiones/`.

**No es un hito del Plan.** El Plan termina en el Hito 7 (verificado en `definicion-skills/proposal.md:7`, esta misma sesión). Es un change standalone con nombre descriptivo sin prefijo `hito-X.Y`, mismo tratamiento que `tui-canal-empleado` y `definicion-skills`. **`v3.2.0` es propuesta, no fijada**: el número lo pone el checkpoint, igual que en los dos precedentes.

**Numeración verificada, no asumida.** `grep '^### ADR'` sobre **todos** los `proposal.md`/`design.md` de `openspec/changes/*`: el máximo real es **ADR 115** (`definicion-skills/design.md:189`), no 102 ni 107. `grep` de `RD-` sobre todo el repo: el máximo real es **RD-54** (`definicion-skills/design.md:528`). Esta propuesta abre en **ADR 116** y reserva **RD-55 en adelante**. Cruzado además contra `docs/` (máximo citado: ADR 94 en `docs/progreso/v3.0-a2a-servidor/README.md:35`) — nada por encima de 115.

---

## Intent

El ADR 9 rechazó registrar el reporte mensual como comando, y dejó su condición de reversión **escrita en una sola línea** (`proposal.md:106`):

> *"El disparador para construirlo: un **segundo** comando *y* alguien que resuelva comandos por nombre (p. ej. comandos slash en la TUI)."*

Las dos mitades se cumplieron, y con margen: `src/core/commands/comando-empleado.ts` tiene hoy **quince** descriptores (`DESCRIPTORES`, líneas 101-245) y `parsearComando` **es** el resolvedor por nombre (`descriptor = DESCRIPTORES.find((d) => d.nombre === comandoToken)`, línea 318). El "`Map` de una entrada envuelto en ceremonia" que el ADR 9 temía no es lo que se construiría: el registro ya existe, ya tiene guard de privilegio (`esComandoPrivilegiado`, línea 262), ya imprime su propia ayuda (`formatearAyuda`, línea 267) y ya despacha catorce comandos más. **Agregar el reporte cuesta un descriptor y un handler.**

Verificado además que **no hay ninguna otra razón operacional en el ADR 9**: no menciona tamaño de output, ni tiempo de ejecución, ni necesidad de correr sin sesión. Su única consecuencia declarada es *"Operabilidad local intacta (Escenario de calidad 4): el reporte se corre a mano, sin daemon, sin cron"* — y este change **no toca eso**: no agrega scheduler, no agrega daemon, no agrega dependencia. Sigue corriéndose a mano; ahora también desde adentro de la TUI que el empleado ya tiene abierta.

Y hay una segunda razón, de forma. El reporte ya se apoya en dos funciones **100% puras** (`agruparReporteMensual`, `formatearReporteMensual`, `src/core/ventas/reporte.ts:95-147` y `:244-250`: sin DB, sin reloj, sin I/O) y `src/reporte-mensual.ts:93-101` es **solo wiring**. O sea: el trabajo real ya está hecho y ya está en el núcleo. Lo que falta es un segundo consumidor de ese núcleo puro — que es exactamente el caso donde reusar es barato y no reusar es duplicar.

---

## Scope

### In Scope

- **Descriptor `/reporte-comisiones [periodo]` en `DESCRIPTORES`**, `privilegiado: true` (ADR 117), con **forma nueva `id_opcional_periodo`** siguiendo el precedente literal de los ADR 56/69 (*una forma nueva por SHAPE de payload*) — ver ADR 119.
- **Brazo nuevo en `ComandoEmpleado`**: `{ tipo: "reporte_comisiones"; periodo?: string }`, y su rama en `parsearComando`.
- **Handler en `src/build-on-comando-empleado.ts`** — el mismo archivo que ya aloja `manejarSoporte`, `manejarVerPropuesta` y el de `/consultar-kpi`. Lee, agrega, formatea y responde. **Cero escrituras del núcleo.**
- **Reuso literal de las dos funciones puras** (`agruparReporteMensual` + `formatearReporteMensual`) y de los dos lectores del repositorio (`listComisionesPorPeriodo`, `listVentasEnReembolsoPendiente`, `repository.ts:1099` y `:1169`). **Nada se reimplementa.**
- **Resolución del `periodo` por defecto** al mes corriente, con el `now()` **inyectado del dispatcher** — no con `new Date()` adentro del parser, que es puro y sin reloj (ADR 119 pto 3).
- **Fila en `registro_acciones_empleado`** con `COMANDO_REPORTE_COMISIONES` (ADR 117 pto 4). **Sin migración**: `comando` es `TEXT NOT NULL` sin `CHECK` (`0005_registro_acciones_empleado.ts:48`) y `venta_id`/`caso_id` son nullable (`:49-50`).
- **`npm run reporte:mensual` se conserva sin cambios** (ADR 118). Dos vías al mismo reporte, con motivo escrito.
- **README**: hoy **no menciona `reporte:mensual` en ninguna línea** (verificado por `grep`, sólo aparece en `package.json:16`). Este change documenta **las dos** vías y cuándo usar cada una.
- **Delta de spec sobre `reporte-comisiones-mensual`** — obligatorio, no opcional (ver Capabilities).

### Out of Scope

- **Cualquier scheduler, cron o temporizador.** El ADR 9 lo rechazó con un argumento que **sigue intacto** (*"un temporizador de un mes dentro de un proceso de vida corta no dispara nunca"*) y este change no lo reabre. Se cumple la mitad del ADR 9 que tenía condición de reversión escrita; la otra mitad se confirma.
- **Scoping por vendedor** (*"cada vendedor ve sólo su período"*). Verificado a nivel de esquema: `credenciales_empleado` (`0006:32-37`) **no tiene columna de rol** y **no tiene ninguna referencia a `vendedores`** (`0004:40-44`, que a su vez no tiene `empleado_id`). No hay ningún mapa `empleadoId → vendedorId` en la base. Ver ADR 120.
- **Modelo de roles o permisos.** `tui-canal-empleado` lo difirió textual (*"`/login` no dice nada sobre permisos. Autentica, no autoriza… el modelo de roles es Hito 5"*, `proposal.md:357`) y **el Hito 5 no lo construyó** (sus specs son `delegacion-subagentes`, `despacho-delegacion`, `hitl-generico`, `revision-pr-por-roles` —roles de *agente*, no de empleado— y `solicitud-interna-hitl`). Sigue sin existir, y este change no lo inventa.
- **Confirmación en dos pasos.** ADR 119 pto 5, con la cita del ADR 36 vía `hito-2.2-a2a-cliente/proposal.md:290`.
- **Cambiar el formato del reporte, sus columnas, sus anchos o su nota de escalación.** El texto que sale por la TUI es el **mismo string** que sale por el script. Si el layout no entra en el ancho de la terminal, eso es R2 — y se mide, no se rediseña acá.
- **Exportar el reporte a archivo, CSV o cualquier destino que no sea la respuesta de la TUI y el `stdout` del script.** Ya estaba fuera del spec original (`reporte-comisiones-mensual/spec.md:9`) y sigue afuera.
- **Migraciones de base de datos.** Cero. Segundo change consecutivo sin migración.
- **Dependencias nuevas en `package.json`.** Cero. Noveno change consecutivo.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`.

### New Capabilities

**Ninguna.** Este change no introduce un dominio nuevo: cablea uno existente (`reporte-comisiones-mensual`) a un canal existente (`comando-empleado-tui`).

### Modified Capabilities

- **`reporte-comisiones-mensual`** — **delta OBLIGATORIO, y no es una formalidad.** El requirement *"Comando bajo demanda, sin scheduler ni registro"* (`hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual/spec.md:15`) dice textual: *"`npm run reporte:mensual` SHALL ser el único disparador del reporte. El sistema SHALL NOT incluir ningún temporizador, cron **ni Registro de Comandos** que lo dispare automáticamente."* Y su `## Purpose` (línea 9) pone explícitamente *"un Registro de Comandos que resuelva comandos por nombre"* fuera de alcance. **Este change viola la letra de ese requirement y hay que reescribirlo, no rodearlo.** La reescritura tiene que conservar lo que sigue siendo verdadero (**nada dispara el reporte solo**) y corregir lo que deja de serlo (**el script no es el único disparador**). La versión vigente a la que hay que aplicar el delta es esa más el delta de `tui-canal-empleado/specs/reporte-comisiones-mensual/spec.md`.

- **`comando-empleado-tui`** — **`sdd-spec` decide, con el precedente escrito, y esta propuesta se inclina por SÍ.** El requirement *"Reconocimiento y ruteo de los ocho comandos"* (`tui-canal-empleado/specs/comando-empleado-tui/spec.md:23` y `:47`) **ya es falso desde hace tres changes**: Hito 5 (ADR 56) sumó tres comandos, Hito 5.1 (ADR 69) otros tres, Hito 6 (ADR 85) uno más — y **ninguno de los tres escribió un delta sobre esta capability** (verificado por `Glob` sobre `openspec/changes/*/specs/*/`: no existe ningún segundo `comando-empleado-tui/spec.md`). Cada uno puso el requirement del comando nuevo en la spec de **su** capability dueña. Este change puede seguir ese precedente al pie de la letra y no tocarla. La inclinación contraria es barata: **un delta de un requirement** que reemplace *"los ocho comandos"* por *"los comandos del Registro"*, para que el número deje de mentir y no haya que repetir esta discusión en el próximo comando. **Es decisión del checkpoint** (pregunta 3).

---

## Approach

Cuatro piezas, ninguna nueva conceptualmente:

1. **Parser** (`src/core/commands/comando-empleado.ts`) — un descriptor, una `Forma` nueva (`id_opcional_periodo`), un brazo en la unión discriminada y una rama en `parsearComando`, calcada de `id_opcional_propuesta` (líneas 360-368). El módulo sigue **sin un solo import**, como declara su cabecera.
2. **Contrato de registro** (`src/core/commands/registro-acciones-contract.ts`) — una constante `COMANDO_REPORTE_COMISIONES` y, si hace falta, un `RESULTADO_*` (RD-56). Archivo sin imports, igual que el anterior.
3. **Handler** (`src/build-on-comando-empleado.ts`) — resuelve el `periodo` (argumento o `now().slice(0, 7)`), lee por un puerto de sólo lectura, llama a las dos funciones puras y devuelve `{ responseText, agentLabel: "sistema" }`. El dispatcher **ya recibe `db`** (`BuildOnComandoEmpleadoDeps.db`, línea 259) y ya tiene el molde de puertos-con-default-closure (`store`, `registro`, `solicitudStore`, `propuestaStore`, líneas 283-289): el lector del reporte entra como uno más (RD-55).
4. **Composition root** — nada, o casi. El handler no necesita SDK, no necesita red, no necesita config nueva. Es el comando **más barato de cablear** de los quince que ya existen.

**El flujo entero, en una línea**: `/reporte-comisiones 2026-08` → guard de privilegio (ya existe) → handler → dos `SELECT` → `agruparReporteMensual` → `formatearReporteMensual` → `responseText`. Sin `await` al modelo, sin transacción, sin CAS.

---

## Decisiones de arquitectura fijadas por esta propuesta (ADR 116-120)

### ADR 116: El reporte se registra como comando de la TUI — el ADR 9 **no se deroga: se cumple su propia condición**

**Contexto**. El ADR 9 es un ADR vigente que rechazó exactamente esto. Un change que lo ignore es amnesia; un change que lo "derogue" está reescribiendo la historia. Ninguna de las dos es lo que corresponde acá.

**Decisión**:

1. **El ADR 9 dejó una condición de reversión explícita y verificable, y se verificó cumplida.** Sus dos requisitos —*"un **segundo** comando"* y *"alguien que resuelva comandos por nombre (p. ej. comandos slash en la TUI)"*— están los dos en el repo hoy: quince descriptores y `parsearComando` resolviendo por `nombre`. No hay que interpretar nada: el ADR nombró el disparador con ejemplo incluido, y el ejemplo es literalmente lo que se construyó en `v1.4.0`.
2. **La mitad del ADR 9 que NO tenía condición de reversión se conserva intacta.** *"No se agrega un scheduler"* sigue siendo cierto después de este change, con el mismo argumento (`proposal.md:105`). El ADR 9 rechazó **dos** cosas; este change revierte **una**, la que traía instrucciones para revertirse.
3. **El costo que el ADR 9 midió ya no existe.** Midió *"un `Map` de una entrada envuelto en ceremonia"*. El `Map` está construido, testeado, con guard de privilegio y con ayuda autogenerada. El costo marginal real es un descriptor en un array literal y un handler en un archivo que ya tiene trece.
4. **Y hay un costo del status quo que el ADR 9 no podía ver en su momento**: el reporte es la **única** superficie de negocio del arnés que quedó fuera de la TUI. Un gerente que resuelve escalaciones con `/aprobar-reembolso` tiene que salir de la TUI, abrir otra terminal y correr un `npm run` para ver el reporte que **lista esas mismas escalaciones** (`listVentasEnReembolsoPendiente`, el mismo lector que alimenta el listado de `/aprobar-reembolso` sin id). Eso no es una molestia de UX: es la Meta 5 del arc42 (Usabilidad de la interfaz operativa) con un agujero.

**Alternativas consideradas**:

- *Dejarlo como está y documentar mejor el ADR 9*: **rechazada.** El ADR 9 ya está bien documentado — su problema es que su condición se cumplió y nadie la ejecutó. Documentar más no cierra la brecha; la vuelve más visible.
- *Mover el reporte a la TUI y **eliminar** el script*: rechazada por el **ADR 118**, no por este.
- *Exponer el reporte como MCP tool para que el agente conversacional lo invoque*: **rechazada**, y es la misma alternativa que el ADR 8 rechazó para ventas. Un reporte financiero determinista no gana nada con que un modelo decida cuándo dispararlo, y perdería la única propiedad que lo hace auditable (el mismo input produce el mismo string). Además choca con el límite 1 del **ADR 106** (`definicion-skills`): nada del camino del dinero detrás de una decisión del modelo.

**Consecuencias**. Queda cerrada la última brecha declarada del Hito 4 que tenía condición de reversión escrita. Y queda un precedente que vale más que el comando: **un ADR que difiere algo con un disparador nombrado es una deuda con fecha de vencimiento, no una decisión permanente** — se revisa cuando el disparador suena, no cuando alguien se acuerda.

### ADR 117: `privilegiado: true` — y **no es una decisión nueva**: es el criterio de `/ver-propuesta` aplicado a datos financieros

**Contexto**. Ésta es la decisión de superficie de acceso real del change, y hay que tomarla a ojos abiertos: el script actual (`src/reporte-mensual.ts`) corre **sin ninguna sesión** — cualquiera con acceso a la terminal y al archivo `data/harness.db` lo ejecuta. Si el comando fuera `privilegiado: false`, el arnés tendría dos vías igualmente sin autenticar al mismo dato. Si es `true`, el comando exige `/login` y el script no. La asimetría hay que explicarla, no esconderla.

**Decisión**:

1. **`privilegiado: true`.** El criterio ya está escrito, textual, en el propio archivo que hay que editar: `/ver-propuesta` es `privilegiado: true` *"aunque no escriba nada"*, porque *"muestra el contenido íntegro de un patch — código propietario del repo"* (`comando-empleado.ts:196-201`). `/consultar-kpi` lo reafirmó *"no es una decisión nueva: mismo criterio ya escrito para `/ver-propuesta`"* (`:228-231`). **El criterio vigente del repo no es "escribe ⇒ privilegiado", es "expone lo sensible ⇒ privilegiado".** El reporte expone montos vendidos, comisiones por vendedor y un comparativo entre empleados. Es exactamente ese caso.
2. **Y hay un argumento que no es analógico sino directo**: la sección *"Reembolsos pendientes de aprobación"* del reporte se arma con `listVentasEnReembolsoPendiente(db)` — **el mismo lector** que alimenta el listado que `/aprobar-reembolso` imprime cuando se omite el `ventaId`. Ese comando es `privilegiado: true` (`:142`). Un `/reporte-comisiones` público sería una vía **sin login** al listado que la TUI ya gatea **con login**. No es un matiz de criterio: es un bypass de la guarda del ADR 28/32, en el mismo proceso y contra la misma base.
3. **Marcar el descriptor ES la implementación.** `esComandoPrivilegiado` (`:262-264`) lee `DESCRIPTORES` y es la única fuente de verdad del guard del dispatcher (paso 3 del orden fijo del ADR 36). No hay que tocar el guard, no hay que mantener una lista paralela, y un test que afirme `esComandoPrivilegiado("reporte_comisiones") === true` verifica la decisión entera.
4. **Deja fila en `registro_acciones_empleado`.** Con sesión vigente hay un `empleadoId` confiable (ADR 27 enmienda rev. 3: la columna es siempre de una `SesionEmpleado`), así que registrar es gratis y consistente con `/consultar-kpi` (`build-on-comando-empleado.ts:1188`). **Sin migración**: `comando` es `TEXT` sin `CHECK` y las tres FK opcionales quedan nulas.
   ★ **Hallazgo verificado, y hay que decirlo porque afecta la lectura del precedente**: `COMANDO_VER_PROPUESTA` está **definido y nunca usado** — `grep` sobre todo `src/` lo encuentra sólo en `registro-acciones-contract.ts:17` y en su propio test. O sea que `/ver-propuesta`, el precedente más cercano a este comando, **hoy no deja fila**, pese a tener su constante en el vocabulario. El precedente de "privilegiado de solo lectura" es entonces **ambiguo**: `/consultar-kpi` registra, `/ver-propuesta` no. Esta propuesta se alinea con el que registra (es una lectura de datos financieros por un humano identificado; que quede quién y cuándo es el punto entero del ADR 27). **La constante huérfana de `/ver-propuesta` NO se arregla acá** — es drift preexistente de `hito-2.1`, no lo crea este change, y meterlo adentro mezclaría dos cosas. Se reporta al checkpoint (pregunta 4).
5. **La asimetría con el script se acepta y se documenta, no se disimula.** El script sigue sin sesión por el ADR 118, y eso **no** convierte al comando en teatro: el comando protege el canal donde hay una sesión que proteger. Quien puede correr `npm run reporte:mensual` ya tiene acceso de filesystem al `.db` y podría leerlo con `sqlite3` de todas formas — el límite ahí es el sistema operativo, no el arnés. El límite del canal TUI **sí** es del arnés, y es el que este ADR fija. Mismo razonamiento que `tui-canal-empleado` ya escribió sobre su propia superficie (R16, la nota de `reporte.ts:158-171`: *"es una TUI LOCAL con login por empleado, no un portal autenticado"*).

**Alternativas consideradas**:

- *`privilegiado: false`, para que el comando tenga la misma superficie que el script y no haya asimetría*: **rechazada por el punto 2.** Igualar hacia abajo significa abrir sin login, dentro de la TUI, el listado de escalaciones que tres comandos privilegiados ya gatean. La coherencia se logra igualando hacia arriba en el canal que tiene guarda, no bajando la guarda que ya existe.
- *`privilegiado: true` **y** exigir un rol de gerencia*: **rechazada** — el modelo de roles no existe (ADR 120). Sería inventar un sistema de permisos entero para un comando.
- *No registrar la acción, por ser de sólo lectura*: **rechazada por el punto 4**, aunque es defendible y es lo que `/ver-propuesta` hace de hecho. Una consulta que expone el comparativo de comisiones de todos los vendedores es precisamente el tipo de acceso que una auditoría quiere poder reconstruir.

### ADR 118: `npm run reporte:mensual` **convive**, no se deprecia ni se elimina

**Contexto**. Tres opciones: convivir, deprecar con aviso, o eliminar. Cada una toca el Escenario de calidad 4 (Operabilidad local) distinto, y ése es el mismo escenario que el ADR 9 citó como consecuencia.

**Decisión**. **Convive, sin aviso de deprecación y sin cambios de código en `src/reporte-mensual.ts`.** Cuatro motivos, en orden de peso:

1. **El comando TUI es inalcanzable en una base recién creada.** `/reporte-comisiones` es privilegiado (ADR 117) ⇒ exige `/login` ⇒ exige una fila en `credenciales_empleado`, que sólo crea `npm run empleados:crear` (`package.json:17`). En un arnés recién desplegado, con datos migrados y sin ningún empleado provisionado, **el script es la única vía al reporte**. Eliminarlo crearía una dependencia de arranque que hoy no existe.
2. **El script no necesita la TUI montada; el comando sí.** `src/reporte-mensual.ts` es un proceso *de vida corta* (su module doc lo dice y por eso se permite escribir a `stdout`, `:22-26`). El comando corre adentro del proceso de Ink. Un operador en SSH, un `cron` del sistema operativo puesto por el sysadmin fuera del arnés, o un pipe a un archivo, son casos que **sólo** el script cubre. Eso es literalmente la Meta 4 del arc42 (*"debe desplegarse y ejecutarse sin infraestructura adicional"*, línea 54).
3. **El costo de conservarlo es cero.** No se toca ni una línea de `src/reporte-mensual.ts`: las dos vías comparten las **mismas** funciones puras y los **mismos** lectores del repositorio, así que no hay dos implementaciones que puedan divergir. Lo único duplicado sería la resolución del `periodo` — y RD-55 decide si `parsePeriodo` sube al núcleo para que las dos la compartan.
4. **Deprecar sin poder eliminar es la peor de las tres.** Un aviso de deprecación que nadie va a ejecutar (por los puntos 1 y 2) es documentación que envejece mal: dentro de dos changes alguien lee "deprecado" y borra algo que era la única vía de arranque.

**Alternativas consideradas**:

- *Eliminar el script y dejar sólo el comando*: **rechazada por los puntos 1 y 2.** Es la opción que hace más limpio el `package.json` y más frágil el despliegue.
- *Deprecar con aviso en `stderr` y eliminar en un change futuro*: **rechazada por el punto 4**, y porque no hay ningún change futuro planificado que pudiera ejecutar el borrado (el Plan termina en el Hito 7).
- *Hacer que el script **invoque** al comando, para tener una sola vía real*: **rechazada.** Obligaría al script a construir un dispatcher con sesión falsa para pasar el guard de privilegio — o sea, a fabricar una `SesionEmpleado` fuera de `resolverLogin`, que es exactamente el invariante que el ADR 37 se ocupó de cerrar. Reuso aparente, agujero real.

**Consecuencias**. Hay **dos vías al mismo reporte con superficies de acceso distintas**, y eso queda documentado en el README como una decisión, no como un accidente. La regla para el lector: *el script es para operar la máquina; el comando es para operar el negocio.*

### ADR 119: Forma `id_opcional_periodo`, argumento opcional con default resuelto por el handler, **un solo paso sin confirmación**

**Decisión**:

1. **Forma nueva `id_opcional_periodo`, con clave de payload `periodo`.** No es inventar una categoría: el propio archivo documenta el criterio en su cabecera (`comando-empleado.ts:75-86`) — *"Una forma nueva por SHAPE de payload"*, con dos precedentes ya aplicados (`id_opcional_solicitud` del ADR 56, `id_opcional_propuesta` del ADR 69). Reusar `id_opcional` a secas devolvería `{ ventaId }`, que es una mentira de tipos; y meter un campo de configuración en el descriptor obligaría a un cast en el `return` que el comentario de la línea 335-344 explica por qué se evitó.
2. **El argumento es OPCIONAL.** `/reporte-comisiones` sin argumento reporta el mes corriente; `/reporte-comisiones 2026-08` reporta ese período. Es la misma semántica que `parsePeriodo` ya tiene en el script (`reporte-mensual.ts:72-74`), y evita que el comando más consultado exija tipear una fecha.
3. **El default del mes corriente lo resuelve el HANDLER, no el parser.** Es una consecuencia dura, no una preferencia: `parsearComando` es **puro, sin imports y sin reloj** (cabecera del archivo, líneas 1-13). No puede llamar a `new Date()`. El dispatcher ya tiene `now` inyectado con default (`BuildOnComandoEmpleadoDeps.now`, línea 280), así que el handler hace `now().slice(0, 7)` — mismo cálculo, misma zona (UTC, ADR 16 regla 2), y testeable con reloj fijo.
4. **La sintaxis es posicional (`/reporte-comisiones 2026-08`), no `--periodo 2026-08`.** El script usa el flag porque es un CLI de `argv`; el registro de comandos de la TUI **no tiene ninguna forma con flags** en sus quince descriptores, y agregar la primera por un comando sería introducir una gramática nueva para un solo caso. El `uso` del descriptor lo dice literal: `/reporte-comisiones [periodo]`.
5. **UN SOLO PASO, sin confirmación en dos pasos.** Confirmado explícitamente contra la fuente, no asumido: `hito-2.2-a2a-cliente/proposal.md:290` establece que *"la confirmación en dos pasos del ADR 36 existe para escrituras irreversibles con CAS. Una consulta no escribe nada del núcleo, y un eco previo sólo agregaría fricción sin proteger nada"* — y el ADR 85 pto 5 lo aplicó a `/consultar-kpi` con la fórmula *"`confirmacionPendiente` no gana una cuarta rama"*. `/reporte-comisiones` es el caso más claro de los dos: no crea caso, no toca ninguna máquina de estados, no hace un solo `INSERT` de negocio. **La ranura de confirmación del ADR 31/36 queda intacta y no gana ninguna rama.**
6. **Cero cambios de esquema y cero migraciones**, por lo ya verificado en el Scope.

**Alternativas consideradas**:

- *`forma: "id_opcional"` reusando la clave `ventaId`*: **rechazada por el punto 1** — un `periodo` guardado en un campo llamado `ventaId` es el tipo de atajo que el compilador no atrapa y el lector paga.
- *Argumento obligatorio (`forma: "id_mas_resto"` con `periodo` requerido)*: **rechazada por el punto 2.** Devolvería `/ayuda` motivo `"argumentos"` a quien tipeó el comando entero bien, para no calcular una fecha que el proceso ya conoce.
- *Validar `YYYY-MM` dentro del parser con la regex del script*: **no se decide acá, es RD-57.** El parser no puede importar la regex (no tiene imports), aunque sí podría inlinearla. Dónde vive la validación y qué responde un período malformado (`/ayuda` motivo `"argumentos"` vs. un mensaje de uso propio) es una decisión de diseño real, con dos opciones defendibles.

### ADR 120: El reporte es una vista de gerencia, sin scoping por vendedor — y el motivo es de esquema, no de política

**Contexto**. La pregunta legítima: ¿podría un vendedor no-privilegiado consultar sólo su propio período? Suena razonable y sería una feature útil. La respuesta es que hoy **no es expresable**, y conviene decir por qué en vez de dejarlo como una omisión.

**Decisión**. **El comando es exclusivamente la vista comparativa completa, el mismo dato que hoy imprime el script.** Tres hechos verificados, cualquiera de los tres alcanza:

1. **No hay mapa `empleadoId → vendedorId`.** `credenciales_empleado` tiene exactamente cuatro columnas (`empleado_id`, `password_hash`, `created_at`, `updated_at`, `0006:32-37`) y `vendedores` tres (`id`, `nombre`, `created_at`, `0004:40-44`). Ninguna referencia a la otra en ninguna dirección. "Su propio período" no se puede computar: la sesión no sabe qué vendedor es el empleado.
2. **No hay roles.** Ninguna columna de rol, ningún tipo de permiso en el núcleo. `tui-canal-empleado` lo difirió con nombre y apellido (*"el modelo de roles es Hito 5"*, `proposal.md:357`) y el Hito 5 construyó otra cosa. Sin roles, "no-privilegiado ve lo suyo" no tiene sujeto.
3. **El reporte es comparativo por definición.** `agruparReporteMensual` produce filas **ordenadas por `totalComisionado` DESC** y una fila `TOTAL` (`reporte.ts:142-144`, `:204-209`). Filtrarlo a un vendedor no sería "el mismo reporte acotado": sería un reporte distinto, con otra semántica y otro formato, que habría que diseñar. **Es una feature nueva, no un parámetro.**

**Consecuencia y condición de disparo**, escrita para que el próximo lector no tenga que deducirla: *el día que exista un modelo de roles de empleado **y** una relación entre `credenciales_empleado` y `vendedores`, un `/mis-comisiones [periodo]` no-privilegiado es el comando natural siguiente.* Hasta entonces, este comando es de gerencia y punto.

---

## Affected Areas

| Área | Impacto | Qué cambia |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor 16, `Forma` nueva `id_opcional_periodo`, brazo de la unión, rama de `parsearComando`. Sigue **sin imports** |
| `src/core/commands/registro-acciones-contract.ts` | Modificado | `COMANDO_REPORTE_COMISIONES` (+ `RESULTADO_*` si RD-56 lo pide). Sigue **sin imports** |
| `src/build-on-comando-empleado.ts` | Modificado | Handler nuevo + puerto de lectura del reporte con default-closure sobre `db` (RD-55) |
| `src/core/ventas/reporte.ts` | **Sin cambios de comportamiento** | Se **consume** desde un segundo llamador. Posible movida de `parsePeriodo` acá o a un módulo hermano (RD-55) |
| `src/reporte-mensual.ts` | **Sin cambios** | ADR 118. Salvo que RD-55 decida compartir `parsePeriodo`, en cuyo caso pasa a importarla |
| `src/adapters/memory/repository.ts` | **Sin cambios** | `listComisionesPorPeriodo` y `listVentasEnReembolsoPendiente` se reusan tal cual |
| `src/adapters/tui/**` | **Sin cambios** | El adaptador TUI sigue sin saber que existen los comandos (ADR 31) |
| Migraciones | **Sin cambios** | Cero migraciones (verificado contra `0004`, `0005`, `0006`) |
| `package.json` | **Sin cambios** | Sin dependencias nuevas, sin scripts nuevos, `reporte:mensual` intacto |
| `README.md` | Modificado | Hoy **no menciona** `reporte:mensual` (verificado). Documenta las dos vías y cuándo usar cada una |
| `docs/ARC42_Harness_Empresarial.md` | Modificado | Caja Blanca del Registro de Comandos: dieciséis comandos, y el reporte deja de ser el único flujo de negocio fuera de la TUI |

---

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** | **Se lee como una derogación del ADR 9** y el Reviewer lo objeta con razón | Media | ADR 116 completo: el ADR 9 **nombró su propio disparador** y se verifica cumplido con dos hechos citables (`comando-empleado.ts:101-245` y `:318`). La mitad sin condición de reversión (el scheduler) se **confirma**, no se toca |
| **R2** | **El reporte no entra en el ancho de la terminal.** El layout es de ancho fijo: 24+6+13+17+13 + 4 separadores = **77 columnas** (`reporte.ts:151-156`), más el `separador` de `-` del mismo largo. Ink envuelve, y una tabla envuelta es ilegible | **Media — es el riesgo vivo del change** | El ADR 9 **no** mencionó tamaño de output (verificado), así que esto es un riesgo **nuevo** que introduce el canal, no uno heredado. No se mitiga rediseñando el formato (fuera de alcance): se **mide** en la verificación manual del entregable, y si no entra, `sdd-design` decide (RD-58) entre truncar, avisar el ancho mínimo, o aceptar el wrap documentándolo |
| **R3** | **Reporte largo inunda el historial de la TUI** y empuja fuera de pantalla el contexto de la conversación | Baja | Es el mismo `responseText` que cualquier otro comando; el listado de `/aprobar-reembolso` sin id ya puede ser largo y nadie lo reportó como problema. Se observa en la verificación manual |
| **R4** | **La `NOTA_ESCALACION_FUERA_DE_BANDA` se vuelve redundante o rara** leída *dentro* de la TUI: explica cómo resolver escalaciones "desde la TUI local de empleados, tras iniciar sesión con `/login`" a alguien que **ya** está logueado en esa TUI | **Media — cosmético pero real** | No se toca el texto en este change (fuera de alcance: el string es compartido y su redacción actual es un requirement vigente del delta de `tui-canal-empleado`). Se reporta al checkpoint (pregunta 5): si molesta, es un delta de una línea sobre `reporte-comisiones-mensual`, no un rediseño |
| **R5** | **El delta de spec se olvida** y queda un requirement vigente (*"`npm run reporte:mensual` SHALL ser el único disparador"*) que la implementación viola | **Baja — pero sería un hallazgo bloqueante del Reviewer** | Está en Capabilities como **obligatorio**, con la cita y el número de línea, y en Success Criteria como ítem propio |
| **R6** | **Divergencia de `periodo`** entre las dos vías: el script valida `YYYY-MM` con `PERIODO_REGEX` y el comando podría no validar igual | Media | RD-55/RD-57: o `parsePeriodo` sube al núcleo y la comparten, o hay dos validaciones y un test que afirme que aceptan/rechazan lo mismo. **`sdd-design` elige, pero no puede dejarlo sin decidir** |
| **R7** | **Un `periodo` sin datos devuelve una respuesta que parece un error.** `agruparReporteMensual` con cero filas produce `"sin comisiones en el periodo"` (`reporte.ts:188-191`) más la sección de reembolsos | Baja | Es el comportamiento ya especificado y testeado del script (*"nunca una tabla vacía sin explicación"*). El comando hereda el mismo texto — consistencia, no bug. Se verifica con un escenario del spec |

---

## Rollback Plan

**Aditivo y reversible borrando código, sin ningún estado que revertir.** Quitar el descriptor de `DESCRIPTORES`, el brazo de la unión, la rama de `parsearComando`, la `Forma`, la constante del registro y el handler: `parsearComando("/reporte-comisiones …")` vuelve a caer en `ayudaDesconocido` (el sumidero del ADR 34) y los quince comandos restantes se comportan **byte por byte igual**, porque ninguno se toca. `npm run reporte:mensual` no se entera de nada — nunca dependió de esto (ADR 118).

**No hay migración que revertir, no hay tabla nueva, no hay columna nueva, no hay dato persistido con formato nuevo.** Las filas de `registro_acciones_empleado` con `comando = '/reporte-comisiones'` que hubieran quedado son **inertes**: la columna es `TEXT` sin `CHECK` y nadie las consulta por valor. Se conservan como auditoría histórica, que es lo correcto — un registro de auditoría no se limpia porque la feature se revirtió.

A nivel git: revertir los commits de `hito/v3.2-comando-reporte-comisiones` antes del merge a `main`. Rollback en caliente sin deploy: no aplica — es una TUI local, se reinicia el proceso.

---

## Dependencies

- **`v3.0.0` cerrado y mergeado a `main`.** Este change **no reusa código de ningún hito sin mergear**: no toca `src/adapters/a2a/`, no toca `repository.ts`, no crea migración. Ramifica de `main`.
- **Relación con `definicion-skills` (`v3.1.0`): NINGUNA. Verificado, y vale decirlo porque las dos están abiertas al mismo tiempo.** Ese change toca `src/core/skills/`, `invoke-model.ts`, `bootstrap.ts` y `.claude/`; éste toca `src/core/commands/` y `build-on-comando-empleado.ts`. **Cero archivos en común**, así que pueden ordenarse en cualquier secuencia sin gate duro. Si `definicion-skills` va primero, este change tampoco lo contradice: el ADR 106 límite 1 prohíbe *skills* en el camino del dinero, y esto es un **comando**, determinista y sin ninguna tool-call del modelo.
- **Checkpoint humano de `AGENTS.md`** aprobando esta propuesta —en particular **ADR 116** (la relectura del ADR 9), **ADR 117** (`privilegiado: true`) y **ADR 118** (la convivencia)— antes de `sdd-spec`/`sdd-design`.

---

## Success Criteria

- [ ] `/reporte-comisiones` está en `DESCRIPTORES` con `privilegiado: true`, y un test afirma `esComandoPrivilegiado("reporte_comisiones") === true`.
- [ ] Sin sesión vigente, `/reporte-comisiones` responde que hace falta `/login`, con evento `comando-privilegiado-sin-sesion`, **cero lecturas de negocio y cero filas** — mismo comportamiento que los otros privilegiados, sin tocar el guard del dispatcher.
- [ ] `/reporte-comisiones 2026-08` con sesión vigente devuelve **exactamente el mismo string** que `npm run reporte:mensual -- --periodo 2026-08` sobre la misma base. Verificado con un test que compara las dos salidas, no con dos aserciones separadas.
- [ ] `/reporte-comisiones` sin argumento reporta el mes corriente, resuelto con el `now()` **inyectado** — testeado con reloj fijo, sin `new Date()` real.
- [ ] `parsearComando` sigue **sin un solo import** y sin ninguna referencia al reloj.
- [ ] El comando **no escribe nada del núcleo**: un test afirma que después de ejecutarlo, `ventas`, `comisiones` y `casos` quedan idénticas.
- [ ] `confirmacionPendiente` **no gana ninguna rama nueva** (ADR 119 pto 5) — verificable leyendo el tipo.
- [ ] Queda fila en `registro_acciones_empleado` con `comando = '/reporte-comisiones'` y el `empleado_id` de la sesión, **sin migración** y sin `venta_id`/`caso_id`.
- [ ] `/ayuda` lista el comando nuevo con su `uso` de una línea, **sin código nuevo** (sale de `formatearAyuda` sobre `COMANDOS`).
- [ ] `npm run reporte:mensual` sigue funcionando **idéntico**, sin sesión y sin TUI montada, con sus tests actuales en verde y sin modificarlos.
- [ ] El delta de `reporte-comisiones-mensual` corrige el requirement *"único disparador"* **y conserva** el requirement de que nada dispara el reporte solo.
- [ ] README documenta las dos vías y cuándo usar cada una (hoy no documenta ninguna).
- [ ] `npm test` y `npm run typecheck` en verde; **TDD estricto** (red → green → refactor) en el parser, en el handler y en la resolución del `periodo` — todo lógica de negocio.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v3.2-comando-reporte-comisiones/` con la evidencia manual (incluyendo la medición de ancho de R2), tag `v3.2.0`.

---

## Qué necesita el checkpoint humano

1. **El ADR 116 es la decisión a aprobar.** El ADR 9 es un ADR vigente que rechazó exactamente esto. Esta propuesta sostiene que **su propia condición de reversión se cumplió** — no que el ADR estuviera mal. Si no comprás esa lectura, el change no debería avanzar.
2. **El ADR 117 es el que cambia la superficie de acceso real.** `privilegiado: true` significa que el reporte, dentro de la TUI, exige `/login`, mientras el script sigue sin exigir nada. Es una asimetría deliberada y explicada (ADR 117 pto 5), pero es tuya la decisión de aceptarla.
3. **¿Se corrige el requirement "los ocho comandos"?** Está falso desde hace **tres** changes y ninguno lo tocó (precedente verificado). Este change lo vuelve más falso. Corregirlo cuesta un delta de un requirement; no corregirlo sigue el precedente. **Decidilo antes de `sdd-spec`.**
4. **Hallazgo lateral, no lo arregla este change**: `COMANDO_VER_PROPUESTA` está definido en `registro-acciones-contract.ts:17` y **no lo usa nadie** — `/ver-propuesta` no deja fila de auditoría pese a tener su constante. Es drift de `hito-2.1`. ¿Se abre un change chico aparte, o queda anotado?
5. **R4, cosmético pero visible**: la nota de escalaciones del reporte le va a explicar a alguien que **ya está logueado en la TUI** cómo resolver escalaciones "desde la TUI local, tras iniciar sesión con `/login`". Si te molesta, es un delta de una línea; si no, se deja.
6. **Numeración y versión.** `v3.2.0` es propuesta. Y si `definicion-skills` no cierra como `v3.1.0`, este número se corre — no hay dependencia técnica entre los dos changes (Dependencies), sólo de numeración.

## Decisiones reservadas para `sdd-design` (RD-55 en adelante)

| RD | Qué | Por qué no se decide acá |
|---|---|---|
| **RD-55** | **Forma exacta del puerto de lectura** del reporte en `BuildOnComandoEmpleadoDeps` (¿un `ReporteStorePort` con dos métodos? ¿dos funciones sueltas con default-closure sobre `db`?) y si `parsePeriodo` sube al núcleo para compartirse con el script | Exige mirar las firmas reales de los cuatro puertos que ya conviven en ese `Deps` (`store`, `registro`, `solicitudStore`, `propuestaStore`) y elegir el molde consistente. Es bajada a firmas, no alcance |
| **RD-56** | **Qué `resultado` lleva la fila del registro**: reusar `RESULTADO_ATENDIDA` (el de `/soporte` y `/consultar-kpi`) o agregar uno propio (`consultada`) | El vocabulario de `resultado` es una lista de constantes con comentario de quién la usa (`registro-acciones-contract.ts:23-34`). Agregar un valor es barato pero engorda un vocabulario compartido; reusar puede ser impreciso. Se decide con el spec del requirement de auditoría al lado |
| **RD-57** | **Dónde vive la validación de `YYYY-MM` y qué responde un período malformado**: regex inline en el parser + `/ayuda` motivo `"argumentos"`, vs. validación en el handler + mensaje de uso propio | El parser no puede importar (cabecera del archivo), pero sí puede inlinear una regex. Las dos opciones son defendibles y la elección cambia el contrato de respuesta del comando — hay que verla contra la tabla de bordes del dispatcher |
| **RD-58** | **Qué hacer si el reporte no entra en el ancho de la terminal** (R2): aceptar el wrap y documentarlo, truncar, o avisar el ancho mínimo | Depende de una **medición** contra Ink que esta fase no puede hacer. `sdd-design` decide con el dato, no con la estimación |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió **sin herramienta de shell disponible** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), así que no se pudo invocar el binario — misma limitación ya documentada por las propuestas de Hito 3, Hito 4 y `definicion-skills`. Se compensó verificando **cada** afirmación citada contra el archivo y la línea: `src/core/commands/comando-empleado.ts` (completo, 444 líneas), `src/core/commands/registro-acciones-contract.ts` (completo), `src/core/ventas/reporte.ts` (completo), `src/reporte-mensual.ts` (completo), `src/build-on-comando-empleado.ts:240-359`, `src/adapters/memory/migrations/0004`, `0005` y `0006` (definiciones de tabla), `package.json:10-18`, `grep` de `COMANDO_VER_PROPUESTA` sobre todo `src/` (sólo contrato y test — constante huérfana), `grep` de `reporte:mensual` sobre `*.md`/`*.json` (README no lo menciona), `openspec/changes/hito-1.3-ventas-comisiones/proposal.md:55-154` (ADR 7-11), su `specs/reporte-comisiones-mensual/spec.md` (completo), `openspec/changes/tui-canal-empleado/proposal.md:355-404` (ADR 31, 32), su `design.md:105-154` (ADR 36, 37), su `specs/reporte-comisiones-mensual/spec.md` (completo), `grep` de requirements sobre `specs/comando-empleado-tui/spec.md`, `openspec/changes/hito-2.2-a2a-cliente/proposal.md:258-293` (ADR 85 completo, incluida la línea 290), `openspec/changes/definicion-skills/proposal.md` (completo, molde de formato y techo de ADR/RD), `docs/ARC42_Harness_Empresarial.md` (grep de Operabilidad/Escenario 4) y el `grep '^### ADR'` + `grep 'RD-'` sobre `openspec/` y `docs/` que fijan los techos en **ADR 115** y **RD-54**. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` ejecute `graphify explain` sobre `parsearComando`, `build-on-comando-empleado` y `agruparReporteMensual`.
