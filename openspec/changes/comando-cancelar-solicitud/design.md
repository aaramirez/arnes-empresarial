> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase corrió **sin herramienta de shell disponible** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que ya documentaron la propuesta de este change y el `design.md` de `comando-reporte-comisiones`. Se compensó leyendo completos `src/core/solicitudes/resolver-solicitud-interna.ts` (155 líneas), `src/core/solicitudes/solicitudes-contract.ts` (132), `src/core/hitl/hitl-contract.ts` (56), `src/core/commands/registro-acciones-contract.ts` (77), `src/adapters/memory/migrations/0008_solicitudes_internas.ts`, y por rango `src/adapters/memory/repository.ts:2090-2205`, `src/build-on-comando-empleado.ts:376-448, 530-600, 930-1055, 1440-1455`, `src/core/commands/comando-empleado.ts:20-180, 249-400`, más `grep` de `SolicitudEstado|SOLICITUD_ESTADO_`, `ACCION_SOLICITUD_COMANDO`, `toPortSolicitud|SOLICITUD_ESTADOS`, `aprobarSolicitud|rechazarSolicitud|cancelarSolicitud` sobre todo `src/`, y `COMANDOS|toHaveLength` sobre `comando-empleado.test.ts`.
>
> **Numeración verificada, no asumida.** `grep '^### ADR \d+'` sobre todo `openspec/`: el máximo real es **ADR 128** — lo subió el `proposal.md` de este mismo change (125-128), por encima del ADR 124 de `comando-reporte-comisiones`. `grep 'RD-\d+'` sobre todo el repo: máximo **RD-62**, también de este proposal. Contra-verificado con dos greps de exclusión sobre la raíz (`ADR (129|1[3-9][0-9]|[2-9][0-9][0-9])` y `RD-(6[3-9]|[7-9][0-9]|[1-9][0-9][0-9])`): **cero matches en ambos**. Este diseño abre en **ADR 129** y resuelve **RD-59 a RD-62** sin abrir RDs nuevas.
>
> **★ Segunda ronda de diseño (ADR 144), posterior a la implementación de las tareas 1-13.** Un hallazgo del Reviewer (`code-review` de 8 vertientes + verificación manual del humano) destapó un caso que **ni este `design.md` ni la spec `cancelacion-solicitud-interna` contemplaron**: `/cancelar-solicitud` **sin id**. No es un bug del Implementer —el código hace exactamente lo que estos documentos describían— así que, per `AGENTS.md` (*"devuelve al Implementer, o al Spec Author, si el problema es de diseño y no de código"*), vuelve acá. **Numeración re-verificada en esta segunda ronda, no reusada**: el change `comando-visibilidad-a2a-entrante` (sin commitear, ya en disco) consumió **ADR 134-143** y **RD-63-67**; greps de exclusión `ADR (14[4-9]|1[5-9][0-9]|[2-9][0-9][0-9])` y `RD-(6[8-9]|[7-9][0-9]|[1-9][0-9][0-9])` sobre la raíz: **cero matches**. Por eso el ADR nuevo es **144**, no 134. **No abre RD nueva**: se resuelve entera acá.
>
> **Fuentes verificadas de esta segunda ronda** (además de las de arriba): `src/core/solicitudes/resolver-solicitud-interna.ts` completo **en su estado ya implementado** (203 líneas), `src/core/solicitudes/solicitudes-contract.ts` completo (137), `src/adapters/memory/repository.ts:1939-1941` y `:2068-2097`, `src/build-on-comando-empleado.ts:440-477, 606-634, 1020-1118`, `src/adapters/memory/migrations/0008_solicitudes_internas.ts` completo, `src/core/solicitudes/resolver-solicitud-interna.test.ts:60-105, 217-233`, más `grep` de `listarSolicitudesPendientes`, `formatearListadoSolicitudes|formatearEcoSolicitud|"listado"` y `IS NULL OR` sobre `src/`. Sigue sin herramienta de shell: `graphify` no se pudo invocar (mismo criterio documentado arriba).

# Diseño técnico: `/cancelar-solicitud [solicitudId]` — el solicitante retira su propia solicitud pendiente (v3.3.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 125-128, R1-R7, RD-59 a RD-62) · aprobada por checkpoint humano en sus dos decisiones centrales (**ADR 125** alcance `PENDIENTE`, **ADR 126** el chequeo de dueño fuera de `MotivoNoAplicableHitl`). **No se reabren.**

**Rama**: `hito/v3.3-comando-cancelar-solicitud` · **Tag**: `v3.3.0` (propuesto) · **Progreso**: `docs/progreso/v3.3-comando-cancelar-solicitud/`.

**★ Estado del documento**: los ADR 129-133 están **implementados y commiteados** (tareas 1-13). El **ADR 144** (§2-bis) es una **segunda ronda de diseño posterior**, disparada por un hallazgo del Reviewer sobre un caso que este documento nunca cubrió —`/cancelar-solicitud` **sin id**— y **pendiente de checkpoint humano** antes de implementarse (§10, §11). No reabre ninguno de los ADR 125-133.

---

## 1. Resumen de la arquitectura elegida

Cuarto valor de vocabulario, tercera acción, tercera llamada al privado transaccional que ya existe, **y una corrección de exhaustividad que es prerequisito, no adorno**. Cero migraciones, cero dependencias, cero archivos nuevos de `src/`:

```
 ┌── src/core/ (nunca importa de adapters/) ───────────────────────────────┐
 │                                                                         │
 │  commands/comando-empleado.ts      MODIFICADO · descriptor 16, brazo    │
 │                                     `cancelar_solicitud`. SIN `Forma`   │
 │                                     nueva: reusa `id_opcional_solicitud`│
 │                                                                         │
 │  commands/registro-acciones-contract.ts  MODIFICADO · +2 constantes     │
 │                                     `COMANDO_CANCELAR_SOLICITUD`,       │
 │                                     `RESULTADO_CANCELADA` (ADR 132)     │
 │                                                                         │
 │  solicitudes/solicitudes-contract.ts     MODIFICADO · 4º estado         │
 │                                     `SOLICITUD_ESTADO_CANCELADA` +      │
 │                                     `cancelarSolicitud` en el puerto    │
 │                                                                         │
 │  solicitudes/resolver-solicitud-interna.ts  ★ EL TRABAJO REAL           │
 │                                     · `aplicarCas`: ternario → `switch` │
 │                                       con guarda `never` (ADR 129)      │
 │                                     · evento: 2º ternario → `Record`    │
 │                                     · chequeo de dueño (ADR 126 pto 2)  │
 │                                     · 4ª variante `no_es_dueno` (ADR 130)│
 │                                                                         │
 │  hitl/hitl-contract.ts             ★ SIN CAMBIOS (ADR 126) — cero       │
 │                                     impacto sobre `propuestas`/`ventas` │
 └─────────────────────────────────────────────────────────────────────────┘
                                        │ consumido por
 ┌── src/ (composition root) ──────────────────────────────────────────────┐
 │  build-on-comando-empleado.ts      MODIFICADO · `SOLICITUD_ESTADOS`     │
 │                                     (★ ADR 133, el hallazgo), método    │
 │                                     del store, `ACCION_SOLICITUD_COMANDO│
 │                                     `, rama `no_es_dueno`, `case` nuevo │
 └─────────────────────────────────────────────────────────────────────────┘
                                        │ tercera llamada al mismo privado
 ┌── src/adapters/memory/repository.ts ────────────────────────────────────┐
 │  + cancelarSolicitudInterna (8 líneas) · `resolverSolicitudTransaccional│
 │    ` NO se toca: ni una línea, ni un parámetro nuevo (ADR 131)          │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisiones de arquitectura (ADR 129-133)

### ADR 129 (R5 / RD-62, segunda mitad): `aplicarCas` pasa a `switch` con guarda `never` — y hay un **segundo** ternario con el mismo bug que la propuesta no vio

**Contexto**. La propuesta identificó el ternario de `aplicarCas` (`resolver-solicitud-interna.ts:61-63`) como *"el bug más peligroso del change"*. **Confirmado leyendo el archivo, y hay más**: el mismo patrón aparece **dos veces**.

| # | Línea | Código actual | Qué pasa al agregar el tercer valor |
|---|---|---|---|
| 1 | `:61-63` | `accion === ACCION_APROBAR_SOLICITUD ? store.aprobarSolicitud(input) : store.rechazarSolicitud(input)` | `cancelar` cae en **`rechazarSolicitud`**: la solicitud queda `rechazada`, la fila de auditoría dice `/rechazar-solicitud`. Tipos en verde. **Corrupción de datos silenciosa.** |
| 2 | `:150` | `accion === ACCION_APROBAR_SOLICITUD ? "solicitud-aprobada" : "solicitud-rechazada"` | Una cancelación exitosa emite el evento **`solicitud-rechazada`**. La traza del arnés miente sobre lo que pasó. Tipos en verde. |

Y un tercero, ya seguro por construcción: `ACCION_SOLICITUD_COMANDO` (`build-on-comando-empleado.ts:540`) es un `Record<AccionSolicitud, string>` — al ampliar `AccionSolicitud`, **el compilador exige la clave nueva**. Ese es exactamente el molde correcto, y es el que hay que copiar en los otros dos sitios.

**Decisión**. **`switch` con guarda de exhaustividad (`never`) en `aplicarCas`, y `Record<AccionSolicitud, string>` para el mapeo de eventos.** Firmas exactas en §3. Dos formas distintas a propósito: `aplicarCas` devuelve efectos (una llamada distinta al store por rama) ⇒ `switch`; el evento es un dato por acción ⇒ `Record`, que es exhaustivo sin `default` y sin `throw`.

1. **La guarda `never` es la única que falla en COMPILACIÓN, no en runtime.** Un `default: throw` sin `const _: never = accion` compila igual con un cuarto valor futuro y explota en producción. El `never` convierte el olvido en un error de `tsc --noEmit`, que es donde se descubre gratis.
2. **El `throw` del `default` NO es código muerto ceremonial**: `AccionSolicitud` es una unión de literales, pero `resolverSolicitudInterna` es exportada y podría recibir un valor casteado desde un test o un consumidor futuro. Falla ruidosamente — mismo criterio explícito de `SolicitudStorePort` (*"falla RUIDOSAMENTE"*, `solicitudes-contract.ts:78`) y de `SolicitudTipoEstadoInvalidoError`.
3. **Es un refactor de comportamiento IDÉNTICO y se hace primero, solo.** Convertir los dos ternarios sin agregar todavía `ACCION_CANCELAR_SOLICITUD` deja `resolver-solicitud-interna.test.ts` verde **sin modificar una línea**. Ése es el orden que exige el TDD estricto (§6) y el que fija la frontera del PR 1 (§9).

**Alternativas consideradas**:
- *Dejar el ternario y agregar un `if (accion === ACCION_CANCELAR_SOLICITUD)` antes*: **rechazada** — arregla el síntoma de hoy y deja la trampa armada para el cuarto valor. Es exactamente el descuido que produjo este riesgo.
- *`Record<AccionSolicitud, (store, input) => …>` también para `aplicarCas`*: **rechazada** — un mapa de funciones que reciben el `store` es más indirecto que un `switch` de tres ramas, y pierde el `never` (que es el punto). El `Record` gana donde el valor es un dato inerte (el nombre del evento), no donde es una llamada.

### ADR 130 (RD-59): `no_es_dueno` es una **cuarta variante de nivel superior** de `ResolverSolicitudResult`, deliberadamente **sin campo `item`**

**Contexto**. El ADR 126 ya fijó que el resultado vive fuera de `MotivoNoAplicableHitl`. Quedaba la bajada a firma: cuarta variante propia, o un `no_aplicable` con motivo local.

**Decisión**. **Cuarta variante `{ resultado: "no_es_dueno"; accion; itemId }`**, unida al genérico con `|` (firma en §3). La opción del motivo local **no es viable sin tocar el contrato compartido**: el campo `motivo` de la rama `no_aplicable` está tipado `MotivoNoAplicableHitl` **dentro** de `ResolucionHitlResult` (`hitl-contract.ts:52`). Para meter un motivo local habría que (a) parametrizar el genérico por tipo de motivo —tocar `hitl-contract.ts`, prohibido por el ADR 126—, o (b) declarar una segunda rama con el MISMO discriminante `"no_aplicable"`, lo que ensancha `motivo` a `MotivoNoAplicableHitl | "no_es_dueno"` en todo narrowing por `resultado === "no_aplicable"` — o sea, reintroduce localmente el *"tipo que promete estados imposibles"* que el ADR 126 punto 4 rechaza a nivel compartido. La alternativa barata no es barata: es la misma deuda, mudada de archivo.

1. **★ La variante NO lleva `item`, y ésa es la mitad del valor de esta decisión.** Lleva `itemId: string` (el id que el usuario ya tipeó) y nada más: sin `item`, sin `casoId`, sin `detalle`, sin `solicitanteId` ajeno. **R6 deja de ser una regla de disciplina para pasar a ser una imposibilidad estructural**: el handler no puede filtrar el detalle de una solicitud ajena porque *no tiene de dónde sacarlo*. Mismo criterio que `AccionEmpleado` en `registro-acciones-contract.ts:41-44` (*"No hay campo donde meterlos. La garantía es estructural, no de disciplina"*).
2. **Campos NEUTROS, no de dominio** (`itemId`, no `solicitudId`): coherencia con el ADR 50, aunque la variante sea local — el tipo se lee al lado del genérico y no debe cambiar de convención a mitad de la unión.
3. **Ubicación del chequeo: confirmada tal como la fijó el ADR 126 punto 2**, entre `:118` y `:120`, contra el flujo real leído. `formatearEcoSolicitud` (`build-on-comando-empleado.ts:588-590`) interpola literalmente `solicitud.detalle`, y el eco se arma en `:1014-1022` **inmediatamente después** de recibir `requiere_confirmacion`. Chequear después sería fuga garantizada, no hipotética. Además, al vivir antes del `if (!confirmado)`, el chequeo cubre **los dos pasos** (eco y confirmación) con una sola línea.
4. **El chequeo está GATEADO por acción**: `accion === ACCION_CANCELAR_SOLICITUD && solicitud.solicitanteId !== sesion.empleadoId`. **No es opcional ni cosmético**: sin el gate, `/aprobar-solicitud` y `/rechazar-solicitud` empezarían a exigir propiedad y este change **derogaría** el requirement `solicitud-interna-hitl:72` en vez de acotarlo (R1), que es precisamente lo que la propuesta puso Out of Scope.
5. **Evento**: `logEvent("tui-comando", "solicitud-cancelacion-no-autorizada", { accion, solicitudId, empleadoId: sesion.empleadoId })`. `casoId = "tui-comando"` y no `solicitud.casoId` — mismo criterio que la rama `MOTIVO_NO_ENCONTRADA` (`:112`): el caso es de otro, no hay nada que correlacionar desde este turno. Se loguea **quién intentó**, no **de quién era**.
6. **No escribe fila de registro.** Corte antes de cualquier escritura, mismo molde que `MOTIVO_NO_ENCONTRADA` (`:77`: *"★ NO escribe fila ★"*) y que `manejarConsultarKpi` sin cliente. No hubo efecto de negocio que auditar.

**Alternativas consideradas**:
- *`no_aplicable` con motivo local*: **rechazada por el argumento de tipos de arriba** — imposible sin tocar `hitl-contract.ts` o sin ensanchar `motivo` en todos los narrowings locales.
- *Incluir `item` en la variante "por si el handler lo necesita"*: **rechazada por el punto 1.** El handler no lo necesita (el mensaje sólo usa el id) y tenerlo convierte una garantía estructural en una convención revisable.

### ADR 131 (RD-60 / R2): la cancelación escribe `resuelta_por = <el propio solicitante>` — `resolverSolicitudTransaccional` **no gana un parámetro**

**Contexto**. El privado (`repository.ts:2115-2165`) escribe `resuelta_por = @empleadoId` y `resuelta_at = @ahora` **siempre**, en el mismo `UPDATE` del CAS. La pregunta es si una cancelación llena esas columnas o las deja nulas.

**Decisión**. **Se llenan, con el `empleadoId` de la sesión — que para una cancelación válida es, demostrablemente, el propio `solicitanteId`** (el chequeo del ADR 130 punto 4 corre antes y es la única vía a este CAS). Se reescriben los dos comentarios que quedan falsos: `0008_solicitudes_internas.ts:28-29` y `solicitudes-contract.ts:64`.

1. **La columna no se estira semánticamente: se lee correctamente hoy.** `resuelta_por` responde *"quién cerró esta solicitud"*, y en una cancelación la cerró su autor. El dato que distingue *"un tercero la negó"* de *"el autor la retiró"* **no es esa columna**: es `estado = 'cancelada'` más la fila de auditoría con `comando = '/cancelar-solicitud'`. Ése era el punto entero del ADR 125 al rechazar reusar `rechazada`, y se cumple sin tocar `resuelta_por`.
2. **`NULL` sería estrictamente PEOR para la auditoría, no neutro.** Arrastraría `resuelta_at = NULL`, y entonces *"¿cuándo se cerró?"* deja de tener respuesta en la fila de `solicitudes_internas` (quedaría sólo `updated_at`, que cualquier escritura futura puede pisar). Se rompería además la invariante implícita de hoy: **estado terminal ⇒ `resuelta_at` presente**.
3. **El costo de la alternativa es el argumento entero del Approach.** Dejarlas nulas exige un cuarto campo de `config` (`escribeResuelta: boolean`) o un `UPDATE` bifurcado dentro del privado — o sea, **modificar la función que las tres transiciones comparten**, con `aprobar`/`rechazar` como daño colateral de regresión posible. Se paga un refactor riesgoso en el único punto transaccional del dominio para empeorar la auditoría.

**Alternativas consideradas**:
- *`resuelta_por = NULL` con un `config.escribeResuelta`*: **rechazada por los puntos 2 y 3.**
- *Una columna `cancelada_por` nueva*: **rechazada** — es una migración (que el change declara en cero) para un dato que `resuelta_por` + `estado` + la fila de auditoría ya expresan sin ambigüedad.

### ADR 132 (RD-61 / R4): el mensaje de *"no encontrada"* se **parametriza por acción**; no se agrega ningún lector, filtrado ni sin filtrar

**Contexto**. Cancelar una solicitud ya aprobada devuelve hoy *"No hay ninguna solicitud X pendiente de resolución."* (`build-on-comando-empleado.ts:1008`) — verdadero pero engañoso: al usuario le suena a *"no existe"*. Restricción dura del ADR 125: la solución **no puede** ser un lector sin filtro de estado (derogaría el ADR 38).

**Decisión**. **Se reemplaza el literal por un `Record<AccionSolicitud, (id: string) => string>`**, cuyas entradas `aprobar`/`rechazar` reproducen el string actual **byte por byte** y cuya entrada `cancelar` dice: *"No hay ninguna solicitud X tuya pendiente de cancelación. Si ya fue aprobada o rechazada, no se puede retirar."* Cero lectores nuevos, cero métodos de puerto nuevos, cero SQL.

1. **Ataca la queja real de R4 sin necesitar el dato que R4 parecía pedir.** El usuario no necesita que el arnés le confirme *"existe y ya fue decidida"*; necesita que el mensaje deje de sugerir *"no existe"*. Un texto que nombra el estado terminal como causa posible lo logra **sin leer nada**.
2. **Un mensaje distinto por acción es obligatorio, no opcional.** Cambiar el literal compartido rompería el Success Criteria *"`/aprobar-solicitud` y `/rechazar-solicitud` se comportan idéntico, con sus tests actuales en verde y sin modificarlos"*. El `Record` es la forma más barata de cumplirlo, y —igual que `ACCION_SOLICITUD_COMANDO`— **el compilador exige la clave del cuarto valor futuro** (ADR 129 punto 3).
3. **Y cubre el caso ajeno sin filtrarlo.** El mismo texto sirve para *"la solicitud es de otro y no está pendiente"*: dice *"ninguna solicitud tuya pendiente"*, que es cierto en los dos casos y no revela nada de una solicitud ajena.

**Alternativas consideradas**:
- *`listarSolicitudesResueltasDelSolicitante(solicitanteId)` como método nuevo del puerto*: **rechazada.** Respeta el ADR 38 (filtra por estados terminales, no es un lector por id sin filtro), así que es legal — pero cuesta método de puerto + función de repositorio + `createSolicitudStore` + tests (~80 líneas) y una **segunda** lectura por turno, todo para matizar un mensaje de error. Es exactamente el criterio que `0008:35-38` ya fijó para los índices: *"se agregan cuando exista una lectura que los pida"*.
- *Aceptar el mensaje actual sin tocar nada (opción cero del RD)*: **rechazada** — cuesta 4 líneas arreglarlo y R4 quedaría abierto como deuda de UX conocida y no mitigada.

### ADR 133 (RD-62, primera mitad + hallazgo no previsto): `RESULTADO_CANCELADA` propio, y **`SOLICITUD_ESTADOS` es un tercer sitio que rompe si no se toca**

**Contexto y hallazgo**. `grep` de consumidores de `SolicitudEstado` sobre todo `src/` (R7, que la propuesta reservó a esta fase): **no hay ningún `switch` exhaustivo sobre el estado**, pero hay algo que la propuesta no listó — `build-on-comando-empleado.ts:381`:

```ts
const SOLICITUD_ESTADOS = [SOLICITUD_ESTADO_PENDIENTE, SOLICITUD_ESTADO_APROBADA, SOLICITUD_ESTADO_RECHAZADA] as const;
```

`toPortSolicitud` (`:407-414`) valida **cada fila** contra ese array y **lanza `SolicitudTipoEstadoInvalidoError`** si no matchea. Si se agrega `SOLICITUD_ESTADO_CANCELADA` al contrato y **no** a este array, la primera cancelación exitosa **escribe la transacción entera y después explota al traducir la fila que el CAS devolvió**: base ya modificada, excepción al usuario. Falla ruidosa, no silenciosa, pero **después** de la escritura. Es el tercer sitio del change que hay que tocar por exhaustividad y **no está en el Affected Areas de la propuesta**.

**Decisión**:

1. **`SOLICITUD_ESTADOS` gana `SOLICITUD_ESTADO_CANCELADA`**, y el test que lo cubre se escribe **antes** (§6). Se deja el array como está (literal explícito, no derivado del tipo) para no romper el molde que comparte con `PROPUESTA_ESTADOS`/`SOLICITUD_TIPOS`.
2. **`RESULTADO_CANCELADA = "cancelada"` es constante propia**, no se reusa ninguna existente. A diferencia del ADR 122 de `comando-reporte-comisiones` —donde `RESULTADO_ATENDIDA` ya significaba exactamente lo mismo—, acá **ningún `RESULTADO_*` existente significa "el autor la retiró"**: `RESULTADO_RECHAZADA` significa lo contrario (un tercero la negó) y confundirlos es precisamente el dato que el ADR 125 se negó a perder. El vocabulario crece **cuando aparece un hecho de negocio nuevo**, que es el criterio, no el conteo.
3. **`COMANDO_CANCELAR_SOLICITUD = "/cancelar-solicitud"`**, molde literal de las trece constantes existentes. Sin migración: `comando` y `resultado` son `TEXT` sin `CHECK` (`0005:48`).
4. **Ninguna guarda de exhaustividad más allá de las tres de los ADR 129/132.** Verificado por `grep`: no existe ningún `switch (estado)` ni `Record<SolicitudEstado, …>` en el repo. El único consumidor estructural de `SolicitudEstado` es `SOLICITUD_ESTADOS` (punto 1) y el `estadoFinal` del genérico, que se interpola como texto en `:1033` y **funciona tal cual** con `"cancelada"` (ADR 128 punto 2, confirmado).

---

## 2-bis. Segunda ronda de diseño (ADR 144)

### ADR 144 (hallazgo del Reviewer, R8): `/cancelar-solicitud` **sin id** lista **sólo las propias**, filtrando por `solicitanteId` **en el store** — no en memoria, no en el formateo

**Contexto — el hallazgo, verificado contra el código ya implementado, no sospechado.** `resolverSolicitudInterna` (`resolver-solicitud-interna.ts:139-144`) tiene **una sola rama para las tres acciones** cuando `solicitudId === undefined`:

```ts
if (solicitudId === undefined) {
  const limite = deps.limiteListado ?? LIMITE_LISTADO_SOLICITUDES;
  const items = store.listarSolicitudesPendientes({ limite });   // ← SIN sesion.empleadoId
  logEvent("tui-comando", "solicitud-listada", { accion, cantidad: items.length });
  return { resultado: "listado", accion, items };
}
```

Para `/aprobar-solicitud`/`/rechazar-solicitud` eso es **correcto por diseño**: el requirement `solicitud-interna-hitl:72` (ADR 28 de `v1.4.0`, sin jerarquía de aprobación) dice que cualquier empleado autorizado puede actuar sobre solicitudes ajenas, así que ver el listado completo es la forma de encontrar qué resolver. Para `/cancelar-solicitud` —**el único de los tres que este mismo change restringe al dueño**— reusar ese listado es una **puerta de atrás sobre la garantía que el ADR 130 punto 1 construyó estructuralmente**. Tres daños distintos, en orden de gravedad:

1. **★ Es un bug FUNCIONAL, no sólo una fuga — y éste es el argumento decisivo.** El `LIMIT 20` del SQL (`repository.ts:2090`, `ORDER BY created_at`) se aplica **antes** de cualquier noción de dueño. Con 20+ solicitudes pendientes en la organización, `/cancelar-solicitud` sin id puede devolverle al empleado **cero solicitudes propias aunque tenga varias pendientes** — el comando deja de servir exactamente cuando la organización está ocupada, que es cuando más se lo necesita. Y no hay ningún otro camino en el arnés para descubrir el id de la solicitud propia: `/solicitar` no lista, y `/ayuda` tampoco.
2. **Fuga de datos contra la garantía que este change escribió.** `formatearLineaSolicitud` (`build-on-comando-empleado.ts:612`) interpola `solicitanteId`, `detalle`, `casoId` y `dictamen` de **cada** fila. O sea: un empleado corre `/cancelar-solicitud` sin argumento y ve hasta 20 solicitudes de toda la organización con su detalle completo, aunque sólo pueda cancelar las suyas. El ADR 130 punto 1 hizo de R6 *"una imposibilidad estructural"* en la rama por id (la variante `no_es_dueno` deliberadamente **no** lleva `item`); la rama sin id la rodea por afuera.
3. **Ruido de UX que contradice el propio mensaje del comando.** Cada fila ajena del listado es un callejón sin salida: si el usuario la tipea, recibe *"La solicitud X no es tuya…"*. Un listado que ofrece 19 opciones inválidas y 1 válida no es un listado, es una trampa.

**Por qué esto vuelve al Spec Author y no lo parcha el Implementer.** La implementación **hace exactamente lo que estos documentos decían**: ni `design.md` §3/§4 ni la spec `cancelacion-solicitud-interna` tienen un solo escenario para `/cancelar-solicitud` sin id — el flujo de §4 arranca literalmente en `"/cancelar-solicitud S-7"`, con id. El hueco está en el artefacto, no en el código, y decidir qué ve un empleado sobre solicitudes ajenas es una **decisión de alcance y de contrato de datos**, no una elección de implementación. `AGENTS.md` lo dice textual para el Reviewer (*"devuelve al Implementer, o al Spec Author, si el problema es de diseño y no de código"*) y para el loop de rechazo (*"el spec corregido vuelve a pasar por el checkpoint humano antes de llegar de nuevo al Implementer — no hay atajo"*). Si el Implementer lo hubiera parcheado solo, habría **inventado** una regla de visibilidad que ninguna spec contiene — precisamente lo que el ADR 125 declaró que este change no hace (*"preferimos una capacidad ausente y declarada a una semántica inventada por el implementador"*).

**Decisión**:

1. **`listarSolicitudesPendientes` gana un tercer campo OPCIONAL en su objeto de filtro, `solicitanteId?: string`, aplicado en el SQL.** No es un método nuevo del puerto, no cambia la firma de ninguna llamada existente, no toca `AccionSolicitud`, no toca `ResolverSolicitudResult`, no toca `hitl-contract.ts`. El SQL suma **una línea** con el idioma ya establecido tres veces en el repositorio (`AND (@x IS NULL OR col = @x)`: `repository.ts:1298`, `:2088`, `:2370`).
2. **El filtro se aplica GATEADO POR ACCIÓN**, misma fórmula exacta del ADR 130 punto 4: sólo cuando `accion === ACCION_CANCELAR_SOLICITUD`. `/aprobar-solicitud`/`/rechazar-solicitud` siguen llamando con el argumento **byte por byte idéntico** (`{ limite }`, sin la clave nueva ni con `undefined`), de modo que las aserciones vigentes `toHaveBeenCalledWith({ limite: 20 })` (`resolver-solicitud-interna.test.ts:78`) y `{ limite: 5 }` (`:89`) **siguen verdes sin tocarse**. Esto no es tacañería con los tests: es la evidencia ejecutable de que R1 (no derogar `:72`) sigue vigente después de esta segunda ronda.
3. **★ El filtro se aplica SÓLO a la rama A (listado sin id). La rama B (búsqueda por id) NO se filtra por dueño, y eso es deliberado.** Si se filtrara también por id, una solicitud ajena devolvería lista vacía ⇒ el caso de uso respondería `no_aplicable/MOTIVO_NO_ENCONTRADA` en vez de `no_es_dueno`, que es **exactamente la alternativa que el ADR 126 ya rechazó** (*"devolver `no_aplicable` con `MOTIVO_NO_ENCONTRADA` para no exponer que la solicitud existe"*, rechazada porque *"le devolvería «no existe» a alguien que está mirando la solicitud en pantalla"*). Se deja escrito porque es una **trampa de coherencia real**: un lector futuro puede ver dos llamadas al mismo método, una filtrada y otra no, y "unificarlas" borrando de paso el chequeo de dueño y su rama de mensaje. **Las dos llamadas son distintas a propósito: la A protege un listado, la B alimenta un chequeo que necesita ver lo que va a rechazar.**
4. **El listado vacío gana mensaje propio por acción, molde literal del ADR 132.** Con el filtro puesto, "cero resultados" pasa de ser raro a ser el caso más común (la mayoría de los empleados no tiene nada pendiente), y el texto actual *"No hay solicitudes para listar."* (`build-on-comando-empleado.ts:618`) pasa a sugerir que la organización no tiene ninguna — la **misma** clase de mentira verdadera que el ADR 132 arregló para "no encontrada". Se resuelve con un segundo `Record<AccionSolicitud, string>` cuyas entradas `aprobar`/`rechazar` reproducen el literal actual byte por byte. Cuatro líneas, mismo criterio ya aprobado, y el compilador vuelve a exigir la clave de una acción futura.
5. **El evento `solicitud-listada` gana `soloPropias: true` ÚNICAMENTE en la rama de cancelar**, por spread condicional (`...(soloPropias ? { soloPropias: true } : {})`, idioma ya usado en `rowToSolicitud`, `repository.ts:1950`). Motivo: `resolver-solicitud-interna.test.ts:230` afirma el payload **exacto** `{ accion, cantidad }` para aprobar; agregar la clave incondicionalmente rompería un test que no tiene por qué cambiar. La traza igual queda completa: sin la clave, el listado fue global; con la clave, fue filtrado.
6. **Cero migraciones — y hay que justificarlo, porque `0008:36-39` invita a lo contrario.** Ese comentario dice que los índices por `solicitante_id` *"se agregan cuando exista una lectura que los pida"*, y ahora existe. Aun así **no se agrega**: el predicado indexable de la consulta (`estado = 'pendiente_aprobacion_humana'`, literal fijo, **no** envuelto en `IS NULL OR`) sigue intacto, así que `idx_solicitudes_estado` se sigue usando y el filtro nuevo sólo recorre el conjunto **ya reducido a pendientes**, que es chico por naturaleza del dominio. Es además la lección ya pagada por el repo: el hallazgo de Reviewer de `repository.ts:2348-2349` fue justamente que envolver el predicado del índice en `(@estado IS NULL OR …)` **impide** usarlo. Acá no se toca ese predicado. Si algún día el volumen lo pide, el índice es una migración aditiva independiente de este change.

**Alternativas consideradas**:

- ***Filtrar en memoria dentro del caso de uso*** (`items.filter((s) => s.solicitanteId === sesion.empleadoId)`, sin tocar el puerto): **rechazada, y no por estilo.** (a) **No arregla el daño 1: lo disfraza.** El `LIMIT 20` ya se aplicó en SQL, así que filtrar después puede devolver una lista vacía a alguien que sí tiene solicitudes pendientes — el peor resultado posible, porque *parece* que funcionó. (b) Contradice el ADR 38 ya citado por este change (*"filtro por id, nunca un lector por id sin filtro de estado"*), cuyo criterio es que **el filtro de alcance viaja al SQL**, no que el núcleo recorte lo que el store le trajo de más. (c) Mueve una regla de alcance de datos a la capa que ya tiene la más cara (el núcleo puro) sin ahorrar nada real: el diff en memoria es ~2 líneas, el diff en el store es ~6. **El ahorro es ilusorio y el bug es verdadero.**
- ***Mantener el listado global y ocultar `detalle`/`solicitante` de las ajenas en el formateo*** (Opción B del brief): **rechazada por tres motivos acumulativos.** (a) **No arregla el daño 1 en absoluto**: las filas ajenas siguen consumiendo el `LIMIT 20`, enmascaradas o no. (b) Degrada la garantía de estructural a disciplinaria, invirtiendo el logro del ADR 130 punto 1: el núcleo seguiría **entregando** `detalle` ajeno a través del puerto y la protección pasaría a depender de que nadie toque el formateador — exactamente el *"convención revisable"* que ese ADR rechazó. (c) Un listado de 19 filas enmascaradas e inaccionables más 1 útil es peor UX que el problema original. Lo único que esta opción tiene a favor —no tocar el puerto— vale menos que cualquiera de los tres.
- ***Exigir el id: `/cancelar-solicitud` sin argumento devuelve "indicá el id"***: **rechazada.** Es la más barata (una rama, cero SQL) y sí cierra la fuga, pero **le quita al comando su único mecanismo de descubrimiento**: no hay ningún otro camino en el arnés para que un empleado vea los ids de sus solicitudes pendientes. Obligaría a correr `/aprobar-solicitud` sin id sólo para leer ids — o sea, **empujaría al usuario a la fuga que estamos cerrando**. Además rompería el descriptor ya commiteado (`forma: "id_opcional_solicitud"`, ADR 56) y el requirement de la spec que dice *"lista las pendientes si se omite el id"*.
- ***Un método nuevo del puerto, `listarSolicitudesPendientesDelSolicitante(solicitanteId, limite)***: **rechazada.** Es legal (respeta el ADR 38) y sería la opción correcta si la consulta fuera distinta, pero es **la misma consulta con un predicado más**: duplicaría el SQL, el `SELECT`, el `map(rowToSolicitud)`, la closure de `createSolicitudStore` y su bloque de tests (~60 líneas) para no agregar un campo opcional a un objeto de filtro que **ya existe y ya es opcional en sus dos campos**. Mismo criterio con que el ADR 132 rechazó `listarSolicitudesResueltasDelSolicitante`: un lector nuevo se paga cuando la lectura es nueva, no cuando es la misma con un `AND`.
- ***Extender el filtro por dueño también a `/aprobar-solicitud`/`/rechazar-solicitud`*** ("que cada uno vea sólo lo suyo"): **rechazada, y sería un error de alcance grave.** Derogaría el requirement `solicitud-interna-hitl:72` en vez de acotarlo (R1), dejaría el flujo de validación sin ninguna vía para descubrir qué hay que resolver, y es la feature que la propuesta puso explícitamente Out of Scope y elevó al checkpoint (pregunta 3). **Esta segunda ronda no la reabre.**

**Consecuencias**:

1. **Se toca de nuevo `SolicitudStorePort`, código ya commiteado (tarea 7) — y el costo hay que decirlo, no esconderlo.** Es un campo **opcional** agregado a un objeto de filtro **que ya es opcional entero**: ninguna llamada existente cambia, ninguna implementación del puerto rompe por compilación, y `createSolicitudStore` (`build-on-comando-empleado.ts:461-463`) **no cambia ni una línea** porque ya pasa el `filtro` de largo a `listSolicitudesInternas`. El retrabajo real son ~6 líneas de contrato + ~4 de SQL + ~2 en el fake de `solicitudes-contract.test.ts:187` (que filtra de verdad y debe honrar el campo nuevo). **Es la mínima reapertura posible de esa pieza**, y no reabre su *forma*: sigue habiendo un solo lector, tres métodos CAS y cero métodos nuevos. La frontera dura que sí se respeta sin excepción: **`hitl-contract.ts` sigue con cero líneas modificadas** y `AccionSolicitud` conserva sus tres miembros.
2. **★ Lo que este ADR NO arregla, dicho en voz alta.** Las solicitudes internas **siguen siendo visibles para toda la organización** vía `/aprobar-solicitud`/`/rechazar-solicitud` sin id — con `solicitante` y `detalle` completos. Eso es política vigente y aceptada (ADR 28, requirement `:72`), no un descuido. Este ADR **no hace confidenciales las solicitudes**: cierra la **incoherencia** de que el comando que promete *"sólo el dueño"* fuera también el que muestra lo ajeno. Corolario importante: **el argumento del ADR 126 (alternativa rechazada 3) sigue intacto** —*"cualquier empleado autenticado ya puede listar todas las solicitudes pendientes con `/aprobar-solicitud` sin id"*— así que ese ADR **no se contradice ni se reabre**. Si el checkpoint quiere cerrar la visibilidad global, es una feature propia, con su propio change, y toca `:72`.
3. **La spec deja de tener un hueco.** Hoy `cancelacion-solicitud-interna` no dice nada sobre el caso sin id; después de esta ronda, decirlo pasa a ser obligatorio (ver §11). Sin eso, el próximo lector vuelve a tropezar con lo mismo.
4. **Riesgo nuevo, R8**, incorporado a la tabla de riesgos del change (§11): *"unificar las dos llamadas a `listarSolicitudesPendientes`"*, mitigado por el punto 3 de la decisión más un test que afirma que la búsqueda por id de una solicitud ajena **sigue devolviéndola** (y por lo tanto sigue produciendo `no_es_dueno`, no `no_encontrada`).

---

## 3. Interfaces / firmas concretas

**`src/core/solicitudes/solicitudes-contract.ts`** (delta):

```ts
export const SOLICITUD_ESTADO_CANCELADA = "cancelada"; // v3.3.0, ADR 125
export type SolicitudEstado =
  | typeof SOLICITUD_ESTADO_PENDIENTE
  | typeof SOLICITUD_ESTADO_APROBADA
  | typeof SOLICITUD_ESTADO_RECHAZADA
  | typeof SOLICITUD_ESTADO_CANCELADA;

// SolicitudInterna, comentario reescrito (ADR 131, R2):
/** Escritos por el CAS de `/aprobar-solicitud`/`/rechazar-solicitud`/`/cancelar-solicitud`.
 *  En una cancelación, `resueltaPor` es el propio `solicitanteId` (ADR 131). */
readonly resueltaPor?: string;

// SolicitudStorePort, tercer método CAS:
/**
 * Idéntico a `aprobarSolicitud`, transiciona a `SOLICITUD_ESTADO_CANCELADA`.
 * `input.empleadoId` es SIEMPRE el propio `solicitanteId`: el chequeo de dueño
 * (ADR 126/130) corre en el caso de uso ANTES de llegar acá. Este puerto NO lo
 * revalida — no es su responsabilidad y no tiene la sesión.
 */
cancelarSolicitud(input: ResolucionSolicitudInput): SolicitudInterna | undefined;
```

**`src/core/solicitudes/resolver-solicitud-interna.ts`** — ★ el fix del ternario, firma exacta:

```ts
export const ACCION_CANCELAR_SOLICITUD = "cancelar";
export type AccionSolicitud =
  | typeof ACCION_APROBAR_SOLICITUD
  | typeof ACCION_RECHAZAR_SOLICITUD
  | typeof ACCION_CANCELAR_SOLICITUD;

/**
 * `switch` con guarda de exhaustividad, NO un ternario (ADR 129, R5). Un
 * ternario con tres valores hace que `cancelar` caiga silenciosamente en
 * `rechazarSolicitud` con los tipos en verde: la solicitud queda `rechazada`
 * y la auditoría miente. El `const _exhaustivo: never = accion` convierte
 * cualquier valor futuro sin rama en un error de `tsc --noEmit`.
 */
function aplicarCas(
  store: SolicitudStorePort,
  accion: AccionSolicitud,
  input: ResolucionSolicitudInput,
): SolicitudInterna | undefined {
  switch (accion) {
    case ACCION_APROBAR_SOLICITUD:
      return store.aprobarSolicitud(input);
    case ACCION_RECHAZAR_SOLICITUD:
      return store.rechazarSolicitud(input);
    case ACCION_CANCELAR_SOLICITUD:
      return store.cancelarSolicitud(input);
    default: {
      const _exhaustivo: never = accion;
      throw new Error(`AccionSolicitud no soportada: ${String(_exhaustivo)}`);
    }
  }
}

/** SEGUNDO ternario con el mismo bug (`:150`, ADR 129). `Record` exhaustivo:
 *  una acción nueva sin entrada es error de compilación, sin `default`. */
const EVENTO_SOLICITUD_APLICADA: Record<AccionSolicitud, string> = {
  [ACCION_APROBAR_SOLICITUD]: "solicitud-aprobada",
  [ACCION_RECHAZAR_SOLICITUD]: "solicitud-rechazada",
  [ACCION_CANCELAR_SOLICITUD]: "solicitud-cancelada",
};
// en el camino feliz: logEvent(solicitud.casoId, EVENTO_SOLICITUD_APLICADA[accion], { … })

/** Genérico + lo propio de este dominio (ADR 126 consecuencia, ADR 130).
 *  `hitl-contract.ts` NO se toca. La variante NO lleva `item`: el handler no
 *  puede filtrar el `detalle` de una solicitud ajena porque no lo recibe. */
export type ResolverSolicitudResult =
  | ResolucionHitlResult<SolicitudInterna, AccionSolicitud, SolicitudEstado>
  | {
      readonly resultado: "no_es_dueno";
      readonly accion: AccionSolicitud;
      readonly itemId: string;
    };
```

Chequeo de dueño, **entre `:118` y `:120`** — después de "encontrada", antes de `requiere_confirmacion` (ADR 126 pto 2, ADR 130 pto 3/4):

```ts
  // GATEADO por acción: `/aprobar-solicitud` y `/rechazar-solicitud` conservan
  // intacto el requirement `solicitud-interna-hitl:72` (R1). Acá, antes del
  // `if (!confirmado)`, cubre los DOS pasos con una sola línea.
  if (accion === ACCION_CANCELAR_SOLICITUD && solicitud.solicitanteId !== sesion.empleadoId) {
    logEvent("tui-comando", "solicitud-cancelacion-no-autorizada", {
      accion,
      solicitudId,
      empleadoId: sesion.empleadoId,
    });
    return { resultado: "no_es_dueno", accion, itemId: solicitudId };
  }
```

**`src/adapters/memory/repository.ts`** (aditivo — `resolverSolicitudTransaccional` sin tocar, ADR 131):

```ts
/** CAS `pendiente_aprobacion_humana → cancelada` + `casos.estado → resuelto` + fila `cancelada`. */
export function cancelarSolicitudInterna(
  db: Database.Database,
  input: ResolucionSolicitudDbInput,
): SolicitudRow | undefined {
  return resolverSolicitudTransaccional(db, input, {
    estadoOrigen: "pendiente_aprobacion_humana", // cerradura 2 del ADR 125
    estadoDestino: "cancelada",
    estadoCaso: "resuelto",
    comando: "/cancelar-solicitud",
    resultado: "cancelada",
  });
}
```

**`src/core/commands/registro-acciones-contract.ts`** (delta):

```ts
export const COMANDO_CANCELAR_SOLICITUD = "/cancelar-solicitud"; // v3.3.0
export const RESULTADO_CANCELADA = "cancelada"; // /cancelar-solicitud (ADR 132/133)
```

**`src/core/commands/comando-empleado.ts`** (delta — **sin `Forma` nueva**):

```ts
// ComandoEmpleado, brazo nuevo antes de `consultar_kpi`/`ayuda`:
| { readonly tipo: "cancelar_solicitud"; readonly solicitudId?: string }

// DESCRIPTORES, antes de /ayuda:
{
  nombre: "/cancelar-solicitud",
  uso: "/cancelar-solicitud [solicitudId]",
  ayuda: "Retira una solicitud propia que todavía está pendiente (lista las pendientes si se omite el id).",
  privilegiado: true, // ADR 127
  secreto: false,
  forma: "id_opcional_solicitud", // ADR 56 reusada — el SHAPE `{ solicitudId }` ya existe
  tipo: "cancelar_solicitud",
},
```

`parsearComando` **no gana ni una línea**: la rama `id_opcional_solicitud` (`:349-358`) narrowea `descriptor.tipo` desde `DESCRIPTORES` vía `as const satisfies`, así que absorbe el tercer literal sin cast y sin código nuevo.

**`src/build-on-comando-empleado.ts`** (deltas):

```ts
const SOLICITUD_ESTADOS = [
  SOLICITUD_ESTADO_PENDIENTE, SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_RECHAZADA, SOLICITUD_ESTADO_CANCELADA, // ★ ADR 133 — sin esto, toPortSolicitud lanza DESPUÉS de la transacción
] as const;

// createSolicitudStore:
cancelarSolicitud(input) {
  const row = cancelarSolicitudInterna(db, input);
  return row ? toPortSolicitud(row) : undefined;
},

// ACCION_SOLICITUD_COMANDO — el compilador EXIGE esta clave:
[ACCION_CANCELAR_SOLICITUD]: COMANDO_CANCELAR_SOLICITUD,

/** ADR 132 — `aprobar`/`rechazar` reproducen el literal actual BYTE POR BYTE. */
const MENSAJE_SOLICITUD_NO_ENCONTRADA: Record<AccionSolicitud, (id: string) => string> = {
  [ACCION_APROBAR_SOLICITUD]: (id) => `No hay ninguna solicitud ${id} pendiente de resolución.`,
  [ACCION_RECHAZAR_SOLICITUD]: (id) => `No hay ninguna solicitud ${id} pendiente de resolución.`,
  [ACCION_CANCELAR_SOLICITUD]: (id) =>
    `No hay ninguna solicitud ${id} tuya pendiente de cancelación. Si ya fue aprobada o rechazada, no se puede retirar.`,
};

// manejarResolucionSolicitud — rama nueva en los DOS bloques, ANTES del
// `if (resultado.resultado !== "requiere_confirmacion")` y antes del fallback
// final. En el bloque confirmado es inalcanzable en la práctica (el eco sólo
// se arma para el dueño y la clave incluye `empleadoId`), pero se maneja
// explícito: es más barato que razonarlo en cada revisión.
if (resultado.resultado === "no_es_dueno") {
  return sistema(`La solicitud ${resultado.itemId} no es tuya: sólo quien la creó puede cancelarla.`);
}

// switch (comando.tipo), junto a las otras dos ramas de solicitud:
case "cancelar_solicitud":
  return manejarResolucionSolicitud(ACCION_CANCELAR_SOLICITUD, comando.solicitudId, ahora);
```

`manejarResolucionSolicitud` **no cambia de firma** y su mensaje de éxito (`:1033`) queda intacto: con `estadoFinal = "cancelada"` produce *"Listo: la solicitud S-7 quedó cancelada."* (ADR 128 pto 2, confirmado línea por línea).

### 3-bis. Firmas de la segunda ronda (ADR 144)

**`src/core/solicitudes/solicitudes-contract.ts`** (delta — campo opcional, **no** método nuevo):

```ts
  /**
   * `estado = SOLICITUD_ESTADO_PENDIENTE`, filtrable por id (ADR 38 de `v1.4.0`:
   * nunca un lector por id sin filtro de estado) y, desde ADR 144, por
   * `solicitanteId`. Ese filtro lo usa SÓLO el listado sin id de
   * `/cancelar-solicitud`: la búsqueda POR ID no lo pasa nunca, porque necesita
   * encontrar la solicitud ajena para que el chequeo de dueño devuelva
   * `no_es_dueno` en vez de `no_encontrada` (ADR 126, alternativa rechazada 3).
   * Default `LIMITE_LISTADO_SOLICITUDES`.
   */
  listarSolicitudesPendientes(filtro?: {
    readonly solicitudId?: string;
    readonly solicitanteId?: string; // ★ ADR 144
    readonly limite?: number;
  }): readonly SolicitudInterna[];
```

**`src/adapters/memory/repository.ts`** (`listSolicitudesInternas`, una línea de SQL y un parámetro):

```ts
export function listSolicitudesInternas(
  db: Database.Database,
  filtro: {
    readonly solicitudId?: string;
    readonly solicitanteId?: string; // ★ ADR 144
    readonly limite?: number;
  } = {},
): readonly SolicitudRow[] {
  const rows = db
    .prepare(
      // `estado = '…'` queda como literal FIJO y sin envolver: es el predicado
      // que usa `idx_solicitudes_estado`, y envolverlo en `(@x IS NULL OR …)`
      // lo inutilizaría — lección ya pagada en `listPropuestasCambio` (:2348).
      `SELECT ${SOLICITUD_SELECT_COLUMNS}
         FROM solicitudes_internas
        WHERE estado = 'pendiente_aprobacion_humana'
          AND (@solicitudId IS NULL OR id = @solicitudId)
          AND (@solicitanteId IS NULL OR solicitante_id = @solicitanteId)
        ORDER BY created_at
        LIMIT @limite`,
    )
    .all({
      solicitudId: filtro.solicitudId ?? null,
      solicitanteId: filtro.solicitanteId ?? null,
      limite: filtro.limite ?? LIMITE_LISTADO_SOLICITUDES_DEFAULT,
    }) as SolicitudInternaSqlRow[];
  return rows.map(rowToSolicitud);
}
```

`createSolicitudStore` (`build-on-comando-empleado.ts:461-463`) **no cambia**: ya pasa el `filtro` de largo.

**`src/core/solicitudes/resolver-solicitud-interna.ts`** — rama A, gateada por acción (ADR 144 ptos 2, 3 y 5):

```ts
  if (solicitudId === undefined) {
    const limite = deps.limiteListado ?? LIMITE_LISTADO_SOLICITUDES;
    // GATEADO por acción, misma fórmula del chequeo de dueño (ADR 130 pto 4).
    // `aprobar`/`rechazar` pasan `{ limite }` BYTE POR BYTE como antes — sin la
    // clave nueva, ni siquiera con `undefined`: los tests `:78`/`:89`/`:230`
    // quedan verdes sin tocarse, y ésa es la evidencia de que `:72` no se derogó.
    const soloPropias = accion === ACCION_CANCELAR_SOLICITUD;
    const items = store.listarSolicitudesPendientes(
      soloPropias ? { limite, solicitanteId: sesion.empleadoId } : { limite },
    );
    logEvent("tui-comando", "solicitud-listada", {
      accion,
      cantidad: items.length,
      ...(soloPropias ? { soloPropias: true } : {}),
    });
    return { resultado: "listado", accion, items };
  }
```

La rama B (`:146`) **queda exactamente como está**: `store.listarSolicitudesPendientes({ solicitudId })`, sin `solicitanteId`. Ver ADR 144 punto 3 — es la trampa de coherencia del change.

**`src/build-on-comando-empleado.ts`** (ADR 144 pto 4 — listado vacío por acción, molde del ADR 132):

```ts
/** ADR 144 — `aprobar`/`rechazar` reproducen el literal actual BYTE POR BYTE. */
const MENSAJE_LISTADO_SOLICITUDES_VACIO: Record<AccionSolicitud, string> = {
  [ACCION_APROBAR_SOLICITUD]: "No hay solicitudes para listar.",
  [ACCION_RECHAZAR_SOLICITUD]: "No hay solicitudes para listar.",
  [ACCION_CANCELAR_SOLICITUD]: "No tenés solicitudes pendientes para cancelar.",
};

// `formatearListadoSolicitudes` gana la `accion` como segundo parámetro y la
// usa SÓLO para el caso vacío; la línea por solicitud (`formatearLineaSolicitud`)
// NO cambia — las que se listan son propias, no hay nada que ocultar en ellas.
function formatearListadoSolicitudes(items: readonly SolicitudInterna[], accion: AccionSolicitud): string {
  if (items.length === 0) {
    return MENSAJE_LISTADO_SOLICITUDES_VACIO[accion];
  }
  return items.map(formatearLineaSolicitud).join("\n");
}
```

---

## 4. Flujo de datos

```
"/cancelar-solicitud S-7"  (empleado E, sesión vigente)
        │
        ▼
parsearComando (PURO) ── rama `id_opcional_solicitud` YA EXISTENTE ──▶ { tipo: "cancelar_solicitud", solicitudId: "S-7" }
        │
        ▼
guarda de privilegio (esComandoPrivilegiado === true) ── sin sesión ──▶ "necesita /login" (sin lectura, sin fila)
        │
        ▼
manejarResolucionSolicitud(ACCION_CANCELAR_SOLICITUD, "S-7", ahora)
        │
        ▼
resolverSolicitudInterna  (PURA, SÍNCRONA)
        │
        ├─▶ listarSolicitudesPendientes({solicitudId}) ── vacío ──▶ no_aplicable/no_encontrada
        │        (CERRADURA 1 del ADR 125)                          └─▶ MENSAJE_SOLICITUD_NO_ENCONTRADA.cancelar (ADR 132)
        │                                                                SIN fila, SIN eco
        │ encontrada y PENDIENTE
        ▼
   ★ chequeo de dueño (ADR 130) ── solicitanteId !== E ──▶ { resultado: "no_es_dueno", itemId }
        │                                                    └─▶ "no es tuya…" · SIN eco armado
        │ es el dueño                                             · SIN `item` ⇒ `detalle` INEXPRESABLE (R6)
        ▼
   !confirmado ──▶ requiere_confirmacion ──▶ confirmacionPendiente {dominio:"solicitud", accion:"cancelar", …}
        │                                    └─▶ formatearEcoSolicitud (detalle PROPIO) · CERO escrituras
        │  (segundo "/cancelar-solicitud S-7", clave coincide ⇒ se CONSUME)
        ▼
   aplicarCas → SWITCH (ADR 129) → store.cancelarSolicitud
        │
        ▼
  cancelarSolicitudInterna → resolverSolicitudTransaccional  [UNA transacción]
        │   UPDATE … SET estado='cancelada', resuelta_por=E, resuelta_at=ahora
        │        WHERE id='S-7' AND estado='pendiente_aprobacion_humana'   ← CERRADURA 2
        │   ── no matchea ──▶ undefined, NADA escrito ──▶ no_aplicable/MOTIVO_CAS
        │   updateCaso(caso, 'resuelto')
        │   insertAccionEmpleado('/cancelar-solicitud', resultado='cancelada')
        ▼
  toPortSolicitud ── valida contra SOLICITUD_ESTADOS ★ (ADR 133)
        ▼
  logEvent(casoId, EVENTO_SOLICITUD_APLICADA["cancelar"] = "solicitud-cancelada")
        ▼
{ responseText: "Listo: la solicitud S-7 quedó cancelada.", agentLabel: "sistema" }
```

**Camino SIN id — la rama que faltaba en este diagrama y que el ADR 144 cierra:**

```
"/cancelar-solicitud"  (sin argumento, empleado E)
        │
        ▼
parsearComando ──▶ { tipo: "cancelar_solicitud" }   (solicitudId undefined)
        │
        ▼
guarda de privilegio ── sin sesión ──▶ "necesita /login"
        │
        ▼
resolverSolicitudInterna, rama A ── accion === "cancelar" ──▶ GATE del ADR 144
        │
        ▼
listarSolicitudesPendientes({ limite: 20, solicitanteId: E })   ★ filtro en SQL
        │   WHERE estado='pendiente_aprobacion_humana'
        │     AND (@solicitanteId IS NULL OR solicitante_id = @solicitanteId)
        │     LIMIT 20                                   ← el LIMIT ya no lo comen las ajenas
        ├── 0 filas ──▶ "No tenés solicitudes pendientes para cancelar."   (ADR 144 pto 4)
        ▼
formatearListadoSolicitudes(items, "cancelar") ── SÓLO solicitudes de E
        │   (cada línea lleva detalle/solicitante: son PROPIAS, nada que ocultar)
        ▼
logEvent("tui-comando", "solicitud-listada", { accion, cantidad, soloPropias: true })
        ▼
CERO escrituras · CERO filas de registro
```

Para `accion = "aprobar"`/`"rechazar"` esta misma rama corre **idéntica a hoy**: `{ limite }` sin `solicitanteId`, listado global, evento sin `soloPropias`, mensaje vacío byte por byte igual. Es el requirement `solicitud-interna-hitl:72` funcionando tal cual (R1).

---

## 5. Cambios de archivo

| Archivo | Acción | Qué cambia |
|---|---|---|
| `src/core/solicitudes/resolver-solicitud-interna.ts` | **Modificado — el trabajo real** | `ACCION_CANCELAR_SOLICITUD`, `switch`+`never`, `Record` de eventos, chequeo de dueño, variante `no_es_dueno` |
| `src/core/solicitudes/solicitudes-contract.ts` | Modificado | 4º estado, `cancelarSolicitud`, comentario de `resueltaPor` (ADR 131) |
| `src/core/commands/registro-acciones-contract.ts` | Modificado | `COMANDO_CANCELAR_SOLICITUD`, `RESULTADO_CANCELADA` |
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor 16, brazo de unión, comentario de conteo. **Sin `Forma` nueva, sin tocar `parsearComando`** |
| `src/adapters/memory/repository.ts` | Modificado (aditivo) | `cancelarSolicitudInterna`. `resolverSolicitudTransaccional` **sin una línea de cambio** |
| `src/build-on-comando-empleado.ts` | Modificado | `SOLICITUD_ESTADOS` ★, método del store, `ACCION_SOLICITUD_COMANDO`, `MENSAJE_SOLICITUD_NO_ENCONTRADA`, rama `no_es_dueno`, `case` |
| `src/core/hitl/hitl-contract.ts` | **Sin cambios (ADR 126)** | Verificable en el diff: cero líneas |
| `src/adapters/memory/migrations/0008_solicitudes_internas.ts` | **Comentario, no DDL** | `:28-29` reescrito (ADR 131). Cero SQL |
| `src/core/solicitudes/resolver-solicitud-interna.test.ts` | Modificado | Ver §6 |
| `src/core/solicitudes/solicitudes-contract.test.ts` | Modificado | 4º estado, fake store con `cancelarSolicitud` |
| `src/adapters/memory/repository.test.ts` | Modificado | CAS de cancelación + no-matcheo sobre `aprobada` |
| `src/build-on-comando-empleado.test.ts` | Modificado | Dos pasos, no-dueño, `toPortSolicitud` |
| `src/core/commands/comando-empleado.test.ts` | Modificado | Descriptor, privilegio, parseo, **`toHaveLength(15)` → `(16)` en `:369` y `:435`** (R3) |
| `README.md` · `docs/ARC42_Harness_Empresarial.md` | Modificado | Comando nuevo, flujo de solicitud interna, conteo de comandos |
| `openspec/changes/comando-cancelar-solicitud/specs/cancelacion-solicitud-interna/spec.md` | Nuevo | Capability nueva |
| `openspec/changes/comando-cancelar-solicitud/specs/solicitud-interna-hitl/spec.md` | Nuevo (delta) | **Acota sin derogar** `:72` (R1) |
| `src/core/propuestas/**` · `src/core/ventas/**` · `src/adapters/tui/**` | **Sin cambios** | Blast radius cero |

### 5-bis. Cambios de la segunda ronda (ADR 144) — sobre código YA commiteado

| Archivo | Acción | Qué cambia | Líneas est. |
|---|---|---|---|
| `src/core/solicitudes/solicitudes-contract.ts` | Modificado (reapertura mínima) | `solicitanteId?: string` en el filtro de `listarSolicitudesPendientes` + doc de por qué sólo lo usa la rama A | ~8 |
| `src/adapters/memory/repository.ts` | Modificado (aditivo) | Una cláusula `AND (@solicitanteId IS NULL OR …)` + el parámetro + doc del índice | ~8 |
| `src/core/solicitudes/resolver-solicitud-interna.ts` | **Modificado — el trabajo real de la ronda** | Gate por acción en la rama A, `soloPropias` en el evento, doc de secuencia (A/B) actualizada | ~14 |
| `src/build-on-comando-empleado.ts` | Modificado | `MENSAJE_LISTADO_SOLICITUDES_VACIO` + `formatearListadoSolicitudes(items, accion)` + su call site (`:1042`) | ~12 |
| `src/core/solicitudes/solicitudes-contract.test.ts` | Modificado | El fake de `:187` honra `solicitanteId`; test del filtro combinado | ~20 |
| `src/core/solicitudes/resolver-solicitud-interna.test.ts` | Modificado | Gate por acción en la rama A, evento, **y el test anti-regresión de la rama B** | ~45 |
| `src/adapters/memory/repository.test.ts` | Modificado | SQL real: filtro por solicitante, y **el test del `LIMIT`** (daño 1) | ~40 |
| `src/build-on-comando-empleado.test.ts` | Modificado | End-to-end sin id: sólo propias, `detalle` ajeno ausente, mensaje vacío por acción | ~35 |
| `specs/cancelacion-solicitud-interna/spec.md` · `specs/solicitud-interna-hitl/spec.md` | Modificados | Ver §11 | ~35 |
| `src/core/hitl/hitl-contract.ts` | **Sin cambios** | Sigue en cero líneas, también en esta ronda |
| `src/core/commands/comando-empleado.ts` · `registro-acciones-contract.ts` · `migrations/**` | **Sin cambios** | Ni descriptor, ni vocabulario, ni DDL. **Cero migraciones también acá** (ADR 144 pto 6) |
| **Total estimado de la ronda** | | | **~217** |

---

## 6. Estrategia de testing por categoría

TDD estricto (rojo→verde→refactor), `strict_tdd: true` en `openspec/config.yaml`. **Todo es lógica de negocio: no aplica ninguna excepción.**

| Capa | Qué se testea | Cómo |
|---|---|---|
| **Unit — exhaustividad (R5, PRIMERO)** | Con `accion = "cancelar"`, `cancelarSolicitud` se llama **una vez** y `rechazarSolicitud`/`aprobarSolicitud` **nunca** (`not.toHaveBeenCalled()` sobre los tres spies, en la misma aserción). Y el evento emitido es `solicitud-cancelada`, **no** `solicitud-rechazada` | `resolver-solicitud-interna.test.ts`, store fake con los tres métodos como `vi.fn()`. **Rojo primero contra el ternario actual** — es el test que prueba que el bug era real |
| Unit — refactor previo | Con el `switch` puesto y **sin** `ACCION_CANCELAR_SOLICITUD`, los tests existentes de aprobar/rechazar pasan **sin modificarse** | `npm test` sobre el HEAD del PR 1, antes de ampliar el tipo |
| **Unit — chequeo de dueño (R6)** | Solicitud de `emp-otro`, sesión de `emp-yo`, `confirmado: false` ⇒ `resultado === "no_es_dueno"`, `itemId === solicitudId`; y **el objeto devuelto no tiene `item`** (`expect("item" in resultado).toBe(false)`). Cero llamadas a los tres métodos CAS. Evento `solicitud-cancelacion-no-autorizada` con `casoId === "tui-comando"` | `resolver-solicitud-interna.test.ts`. El chequeo `"item" in resultado` es la aserción que hace de R6 una garantía estructural |
| Unit — gate por acción (R1) | La MISMA solicitud ajena con `accion: "aprobar"` y con `"rechazar"` devuelve `requiere_confirmacion`, **no** `no_es_dueno` | `resolver-solicitud-interna.test.ts`, `describe.each` sobre las dos acciones — evidencia directa de que `:72` no se derogó |
| Unit — contrato | `SolicitudEstado` acepta los **cuatro** literales; `SOLICITUD_ESTADO_CANCELADA === "cancelada"`; el fake store implementa `cancelarSolicitud` (el tipo obliga) | `solicitudes-contract.test.ts`, extendiendo los `describe` de `:41-66` |
| Unit — parser | `esComandoPrivilegiado("cancelar_solicitud") === true`; `/cancelar-solicitud S-7` ⇒ `{tipo, solicitudId}`; sin id ⇒ `{tipo}`; `Forma` conserva **cinco** miembros; `COMANDOS` tiene **16** | `comando-empleado.test.ts`. Los `describe` de `:209-260` ya recorren `DESCRIPTORES` **dinámicamente** por forma ⇒ el descriptor nuevo entra sin tests nuevos ahí |
| **Integration — CAS (ADR 125, ADR 131)** | Sobre `pendiente`: `estado='cancelada'`, caso `resuelto`, **una** fila `/cancelar-solicitud`/`cancelada`, `resuelta_por === solicitanteId`, `resuelta_at === ahora`. Sobre una fila ya `aprobada`: devuelve `undefined` y **las tres tablas quedan idénticas** (snapshot antes/después de `solicitudes_internas`, `casos`, `registro_acciones_empleado`) | `repository.test.ts`, SQLite real en memoria, molde exacto de `:3407-3470` |
| **Integration — el hallazgo (ADR 133)** | Una cancelación exitosa **no lanza `SolicitudTipoEstadoInvalidoError`** al traducir la fila devuelta | `build-on-comando-empleado.test.ts`. Rojo primero si `SOLICITUD_ESTADOS` no se amplía |
| Integration — dos pasos | Primer `/cancelar-solicitud S-7`: eco con el detalle propio, cero escrituras. Segundo: *"Listo: la solicitud S-7 quedó cancelada."*, `confirmacionPendiente === undefined`. Un `/aprobar-solicitud S-7` **no** consume un eco de cancelación pendiente | `build-on-comando-empleado.test.ts`, molde de `:880-940` |
| **Integration — no dueño, tres garantías juntas** | Respuesta explicativa · `confirmacionPendiente` **sin armar** · **el `detalle` ajeno ausente del `responseText`** (`expect(responseText).not.toContain(detalleAjeno)`) · cero filas nuevas | `build-on-comando-empleado.test.ts` — un solo `it` con las cuatro aserciones (Success Criteria) |
| Integration — mensaje por acción (ADR 132) | `/cancelar-solicitud` sobre id inexistente ⇒ texto nuevo; `/aprobar-solicitud` sobre el mismo id ⇒ el texto **actual, byte por byte** | `build-on-comando-empleado.test.ts` |
| Regresión — blast radius | `hitl-contract.test.ts`, `resolver-propuesta-cambio.test.ts` y `resolver-escalacion-reembolso.test.ts` verdes **sin modificarse** | `npm test` completo |
| Type-check | `switch` exhaustivo (`never`), los tres `Record<AccionSolicitud, …>` completos, `parsearComando` sin cast | `npm run typecheck` |

### 6-bis. Testing de la segunda ronda (ADR 144)

| Capa | Qué se testea | Cómo |
|---|---|---|
| **Integration — el daño 1, PRIMERO** | Con **25** solicitudes pendientes ajenas creadas **antes** que la propia (`ORDER BY created_at`), `/cancelar-solicitud` sin id **devuelve la propia**. **Rojo garantizado contra el código actual**: hoy el `LIMIT 20` se la come. Es el test que prueba que el hallazgo era un bug funcional y no una preferencia | `repository.test.ts`, SQLite real. Sin este test el ADR 144 se lee como cosmética |
| **Unit — gate por acción en la rama A (R1)** | `accion: "cancelar"` sin id ⇒ `listarSolicitudesPendientes` llamado con `{ limite, solicitanteId }`; `accion: "aprobar"`/`"rechazar"` ⇒ llamado con **`{ limite }` exacto** (`describe.each`) | `resolver-solicitud-interna.test.ts`. Los tests vigentes `:78`/`:89`/`:230` **no se modifican** — su permanencia en verde es parte de la aserción |
| **Unit — anti-regresión de la rama B (R8)** | Búsqueda **por id** de una solicitud **ajena**: `listarSolicitudesPendientes` se llama con `{ solicitudId }` **sin** `solicitanteId`, y el resultado sigue siendo `no_es_dueno` (**no** `no_aplicable/no_encontrada`) | `resolver-solicitud-interna.test.ts`. Es el candado contra "unificar las dos llamadas" (ADR 144 pto 3) |
| Unit — evento | Rama A de cancelar ⇒ `solicitud-listada` con `soloPropias: true`; de aprobar ⇒ payload **exacto** `{ accion, cantidad }`, sin la clave | `resolver-solicitud-interna.test.ts` |
| Integration — store | `listSolicitudesInternas({ solicitanteId })` devuelve sólo las de ese solicitante y sigue filtrando por `pendiente`; combinado con `{ solicitudId }` no rompe | `repository.test.ts` · fake de `solicitudes-contract.test.ts:187` honrando el campo |
| **Integration — no se filtra detalle ajeno en el listado** | `/cancelar-solicitud` sin id, con solicitudes ajenas pendientes en la base: `responseText` **no contiene** el `detalle` ni el `solicitanteId` ajenos (`not.toContain`) | `build-on-comando-empleado.test.ts` — el espejo, en la rama A, de la garantía que el ADR 130 dio en la rama B |
| Integration — listado vacío por acción | Empleado sin pendientes propias ⇒ *"No tenés solicitudes pendientes para cancelar."*; `/aprobar-solicitud` sin id con la base vacía ⇒ *"No hay solicitudes para listar."* byte por byte | `build-on-comando-empleado.test.ts` |

---

## 7. Registro de auditoría — confirmado

**Camino feliz: fila DENTRO de la transacción**, vía `resolverSolicitudTransaccional` (`insertAccionEmpleado`, `repository.ts:2152-2159`) — `comando = '/cancelar-solicitud'`, `resultado = 'cancelada'`, `caso_id` presente, `empleado_id` de la sesión. **No pasa por `registrar(...)`.**
**`MOTIVO_CAS`** (el CAS no matcheó, con `casoId` conocido): fila `RESULTADO_NO_APLICABLE` **fuera** de transacción, vía la rama existente `:1036-1049` — funciona sin tocarse gracias al `Record` `ACCION_SOLICITUD_COMANDO`.
**Sin fila**: `no_encontrada`, `no_es_dueno`, eco de confirmación, sesión ausente. Ningún efecto de negocio ocurrió.
Cero migraciones: `comando`/`resultado` son `TEXT` sin `CHECK` (`0005:48`).

---

## 8. Migración / rollout · dependencia de orden con `comando-reporte-comisiones` (R3)

**Migración: no aplica.** Cero DDL, cero dependencias, cero flags. Rollback: el de la propuesta, sin cambios.

**R3 — dependencia de ORDEN, no de diseño. Verificada, no estimada.** Los dos changes no comparten una sola función. La colisión es **textual**, en cinco hunks concretos:

| Superficie | `comando-reporte-comisiones` | Este change | ¿Conflicta? |
|---|---|---|---|
| `DESCRIPTORES`, inserción antes de `/ayuda` | descriptor `/reporte-comisiones` | descriptor `/cancelar-solicitud` | **Sí** — mismo hunk |
| Comentario `"Los quince descriptores"` (`:96-99`) y el de `COMANDOS` (`:249-251`) | 15→16 | 15→16 | **Sí** — mismo par de líneas |
| `comando-empleado.test.ts:369` y `:435` (`toHaveLength(15)` + títulos *"quince"*) | →16 | →16 | **Sí** — el conflicto más fácil de pasar por alto |
| `ComandoEmpleado`, brazo antes de `ayuda` | `reporte_comisiones` | `cancelar_solicitud` | **Sí** — mismo hunk |
| `registro-acciones-contract.ts`, cola del bloque `COMANDO_*` | +1 constante | +2 constantes | **Sí** — mismo hunk |
| Tipo `Forma` | **agrega** `id_opcional_periodo` | **no lo toca** | No |
| `switch (comando.tipo)` del dispatcher | `case` al final | `case` junto a los de solicitud (`:1447-1450`) | No — hunks distintos |
| `docs/ARC42`, conteo de comandos | 15→16 | 15→16 | **Sí** |

**Regla operativa: el segundo en mergear rebasa y pone el conteo en 17.** No hay gate duro en ninguna dirección; sí hay una prohibición: **no mergear las dos ramas sin rebase**, porque el conflicto es silencioso en el peor caso (un `toHaveLength(16)` que un merge automático deja pasar con 17 descriptores reales rompe el test, ruidosamente — aceptable; pero el comentario de conteo se queda mintiendo, y eso no lo atrapa nadie).

**Si este change va PRIMERO**: conteo 15→16 acá; `comando-reporte-comisiones` rebasa a 17 y su `design.md §5` (*"Descriptor 16"*) pasa a leerse *"Descriptor 17"* — nota editorial, cero impacto de diseño.
**Si va SEGUNDO**: este change entra con 16→17 en todos los sitios de la tabla, y **hereda** además la decisión del checkpoint sobre el requirement *"los ocho comandos"* de `comando-empleado-tui` (proposal §Capabilities: *"se decide una vez, allá, y acá se acata"*). En ese caso el delta de spec de este change **suma un comando al conteo corregido**, no reabre la pregunta.

---

## 9. Review Workload Forecast

| Archivo | Impl. | Tests |
|---|---|---|
| `resolver-solicitud-interna.ts` (switch+never, Record, chequeo, variante) | ~45 | ~90 |
| `solicitudes-contract.ts` | ~14 | ~20 |
| `repository.ts` | ~12 | ~55 |
| `registro-acciones-contract.ts` · `0008` (comentario) | ~5 | — |
| `build-on-comando-empleado.ts` (SOLICITUD_ESTADOS, store, Records, rama, case) | ~26 | ~85 |
| `comando-empleado.ts` | ~14 | ~25 |
| `README.md` · `docs/ARC42_*.md` | ~22 | — |
| `specs/` (capability nueva + delta que acota sin derogar, R1) | ~60 | — |
| **Subtotal** | **~198** | **~275** |
| **Total estimado** | — | **~473 líneas** |

**Decision needed before apply: Yes**
**Chained PRs recommended: Yes**
**400-line budget risk: High**

El estimado supera el presupuesto en ~18%, y la partida más incierta es `resolver-solicitud-interna.test.ts` (el `describe.each` del gate por acción y las aserciones estructurales de `no_es_dueno` pueden crecer). **No es comparable con `comando-reporte-comisiones` (~383)**: acá hay **cinco** archivos de test tocados en vez de tres, y la superficie de spec es mayor porque el delta de `solicitud-interna-hitl` es obligatorio y argumentativo (R1), no una reescritura de una frase.

**Corte recomendado — dos slices, frontera por capa, no por tipo de contenido**:

- **PR 1 — núcleo + adaptador (~250 líneas).** ADR 129 (los dos ternarios, **primero y solo**, con los tests actuales verdes sin tocar), vocabulario (`SOLICITUD_ESTADO_CANCELADA`, `COMANDO_CANCELAR_SOLICITUD`, `RESULTADO_CANCELADA`), `ACCION_CANCELAR_SOLICITUD`, puerto + `cancelarSolicitudInterna` + `createSolicitudStore` + `SOLICITUD_ESTADOS` (ADR 133), **el chequeo de dueño y la variante `no_es_dueno` completos**, comentarios de `resuelta_por`. Tests: `resolver-solicitud-interna`, `solicitudes-contract`, `repository`.
  *Verificación*: `npm test` + `npm run typecheck` verdes. *Autonomía*: la capacidad existe y está bien guardada, pero **es inalcanzable desde la TUI** — `parsearComando` no produce `cancelar_solicitud` y el dispatcher no tiene `case`. Cero exposición al usuario. *Rollback*: revert, sin datos escritos.
  **Frontera dura**: el chequeo de dueño va en el PR 1, **no** en el 2. Un PR intermedio con un caso de uso capaz de cancelar sin verificar propiedad es una invariante a medio construir, aunque sea inalcanzable.
- **PR 2 — comando, UX y documentación (~225 líneas).** Descriptor + brazo de unión + conteos, rama `no_es_dueno` del handler, `MENSAJE_SOLICITUD_NO_ENCONTRADA` (ADR 132), `case` del switch, README, ARC42, las dos specs. Tests: `comando-empleado`, `build-on-comando-empleado`.
  *Verificación*: los dos pasos end-to-end sobre SQLite real + las tres garantías de no-dueño. *Rollback*: revert ⇒ `/cancelar-solicitud` vuelve al sumidero `ayudaDesconocido` (ADR 34).

Si el checkpoint prefiere **un solo PR**, hace falta un `size:exception` explícito y registrado antes de `sdd-apply`: el diff no baja de ~450 líneas sin sacar algo del alcance, y lo único recortable (docs + specs, ~82) es justamente lo que R1 vuelve obligatorio.

### 9-bis. PR 3 — la segunda ronda (ADR 144)

Los PRs 1 y 2 **ya están implementados y mergeados** (tareas 1-13 commiteadas). El ADR 144 se entrega como **un tercer PR propio**, no como parches sueltos ni como "fix" dentro del cierre:

| Campo | Valor |
|---|---|
| Estimated changed lines | **~217** (§5-bis: ~42 producción, ~140 tests, ~35 specs) |
| 400-line budget risk | **Low** — holgado bajo el presupuesto |
| Chained PRs recommended | No — es un slice único y coherente |
| Base branch | `hito/v3.3-comando-cancelar-solicitud` recreada desde `main`, misma `chain_strategy: stacked-to-main` ya elegida |
| Decision needed before apply | **Sí — checkpoint humano**, ver §11 |

*Autonomía*: el PR es autocontenido y deja el comando **más** restringido que antes; no hay estado intermedio peligroso. *Verificación*: `npm test` + `npm run typecheck`, más los dos tests que nacen rojos (el del `LIMIT` y el del gate por acción). *Rollback*: revert ⇒ vuelve el listado global, sin datos que reparar (ninguna escritura cambia en esta ronda).

**Orden obligatorio: PR 3 va ANTES de la tarea 14** (verificación manual del entregable, hoy la única pendiente). Verificar a mano un comportamiento que ya sabemos que vamos a cambiar es trabajo tirado, y la evidencia de `docs/progreso/v3.3-comando-cancelar-solicitud/` tiene que mostrar el comando **final**, no uno intermedio.

---

## 10. Qué hace falta DESPUÉS de este diseño (no se escribe acá)

Esta fase es sólo diseño: **no** se tocan `specs/` ni `tasks.md`, y nada de esto se implementa sin el **checkpoint humano** (`AGENTS.md`: *"el spec corregido vuelve a pasar por el checkpoint humano antes de llegar de nuevo al Implementer — no hay atajo"*). A alto nivel, lo que la ronda va a necesitar:

**Specs (fase `sdd-spec`)**

1. **`cancelacion-solicitud-interna` — un requirement NUEVO**: *"El listado sin id muestra únicamente las solicitudes propias"*. Escenarios previstos: (a) el listado sin id devuelve sólo las del solicitante; (b) una solicitud ajena pendiente **no** aparece y su `detalle` **no** está en la respuesta; (c) el tope del listado **no** lo consumen solicitudes ajenas (el escenario que captura el daño 1); (d) sin pendientes propias, mensaje propio distinto del genérico.
2. **`cancelacion-solicitud-interna` — un escenario agregado** al requirement vigente *"Sólo el propio solicitante puede cancelar…"*: la búsqueda **por id** de una solicitud ajena **sigue encontrándola** y responde `no_es_dueno`, **no** "no existe" (candado del ADR 144 pto 3 a nivel spec, no sólo a nivel test).
3. **`solicitud-interna-hitl` (delta ya existente) — ampliar el requirement MODIFIED** *"…excepto retirar la propia solicitud"* con la mitad de **visibilidad**: la excepción no cubre sólo *quién puede ejecutar*, también *qué se lista*. Y agregar el escenario simétrico que **fija como requisito** que `/aprobar-solicitud`/`/rechazar-solicitud` **siguen listando todo** — hoy eso está sólo en el código y en un test; si nadie lo escribe, el próximo change "endurece" el listado global creyendo que mejora algo y deroga `:72` sin notarlo.
4. **Sin tocar** `comando-empleado-tui` (el conteo de comandos no cambia) ni ninguna otra capability.

**Tareas (fase `sdd-tasks`)** — cuatro, TDD estricto en las tres primeras, numeradas a continuación de las existentes y **antes** de la tarea 14:

| # | Alcance | Test rojo primero |
|---|---|---|
| A | Puerto + SQL: `solicitanteId?` en el filtro, cláusula en `listSolicitudesInternas`, fake del test de contrato | El del `LIMIT` con 25 ajenas (§6-bis, fila 1) |
| B | Caso de uso: gate por acción en la rama A + `soloPropias` en el evento | Gate por acción (`describe.each`) **y** anti-regresión de la rama B |
| C | Handler: `MENSAJE_LISTADO_SOLICITUDES_VACIO` + `formatearListadoSolicitudes(items, accion)` | End-to-end sin id: sólo propias, `detalle` ajeno ausente, mensaje vacío por acción |
| D | Specs (1-3 de arriba) **y reescritura de la tarea 14**: la verificación manual suma *"`/cancelar-solicitud` sin id lista sólo lo mío"* y *"`/aprobar-solicitud` sin id sigue listando todo"* | Excepción TDD (specs + verificación manual) |

**Riesgo nuevo para la tabla del change**

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R8** | **Alguien "unifica" las dos llamadas a `listarSolicitudesPendientes`** filtrando también la búsqueda por id — con eso, una solicitud ajena responde *"no existe"*, se pierde `no_es_dueno` y queda muerta la variante que el ADR 130 construyó | Media | ADR 144 pto 3 lo deja escrito con su porqué; test anti-regresión dedicado (§6-bis) y escenario de spec propio (punto 2 de arriba). Tres capas, porque el atajo es genuinamente tentador |

---

## 11. Preguntas abiertas

- [ ] **Orden de merge frente a `comando-reporte-comisiones`** (R3, §8): es decisión operativa del checkpoint, no de diseño. El diseño funciona idéntico en las dos direcciones; sólo cambia el número del conteo.
- [ ] **Pregunta 3 del checkpoint de la propuesta** (¿un change futuro cierra *"no podés aprobar tu propia solicitud"*?): sigue abierta a propósito. Este diseño la deja **más fácil de implementar** (el chequeo ya existe, sólo habría que quitarle el gate por acción del ADR 130 pto 4) sin tomarla — hacerlo acá derogaría `solicitud-interna-hitl:72` (R1).
- [ ] **★ ADR 144 — aprobación del checkpoint, bloqueante.** ¿Se acepta reabrir `SolicitudStorePort` por un campo opcional (~8 líneas, sin romper ninguna llamada) para cerrar el listado sin id, y se aprueba el PR 3 **antes** de la tarea 14? Alternativa si la respuesta es no: declarar el listado global de `/cancelar-solicitud` como limitación **conocida y aceptada** en la spec — pero entonces hay que decir también que el comando puede no mostrarle al empleado sus propias solicitudes cuando la organización tiene 20+ pendientes (daño 1), que es una **capacidad rota**, no una concesión de privacidad.
- [ ] **Visibilidad global de solicitudes** (consecuencia 2 del ADR 144): `/aprobar-solicitud` sin id sigue mostrando `solicitante` y `detalle` de toda la organización, por política vigente (ADR 28, requirement `:72`). Si eso incomoda, es un change propio — **este no lo toca**.
