> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase corrió **sin herramienta de shell disponible** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que ya documentaron el `proposal.md` de este change y los `design.md` de `comando-reporte-comisiones` y `comando-cancelar-solicitud`. Se compensó leyendo completos `src/core/agents/a2a-contract.ts` (212 líneas), `src/core/commands/registro-acciones-contract.ts` (77), `src/adapters/memory/migrations/0011_solicitudes_a2a_entrantes.ts`, `0002_idx_sesiones_caso_agente.ts` e `index.ts`, y por rango `src/adapters/memory/repository.ts:2310-2366` y `:2487-2715`, `src/build-on-comando-empleado.ts:255-314, 370-568, 695-731, 1060-1170, 1415-1463`, `src/core/commands/comando-empleado.ts:20-150, 190-380`, `src/core/propuestas/propuestas-contract.ts:40-58`, más `grep` de `EXPLAIN QUERY PLAN` (los **dos** tests precedentes, `repository.test.ts:1526-1546` y `:3111-3135`), `LINEAS_PAGINA_PATCH`, `DelegacionA2AStorePort|PropuestaStorePort` y un `glob` de `src/core/**/*.ts` (**91 archivos**, que fija dónde vive el archivo nuevo).
>
> **Numeración verificada por esta fase, no asumida.** `grep 'ADR (13[4-9]|1[4-9][0-9]|[2-9][0-9][0-9])'` sobre la **raíz entera** del repo: los únicos matches están en el `proposal.md` de este mismo change, cuyo techo es **ADR 138**. `grep 'RD-(6[3-9]|[7-9][0-9]|[1-9][0-9][0-9])'`: ídem, techo **RD-67**. Contra-verificado con dos greps de exclusión (`ADR (139|1[4-9][0-9]|[2-9][0-9][0-9])` y `RD-(6[89]|[7-9][0-9]|[1-9][0-9][0-9])`): **cero matches en ambos**. Este diseño abre en **ADR 139** y resuelve **RD-63 a RD-67** sin abrir RDs nuevas.

# Diseño técnico: `/ver-solicitudes-a2a [a2aTaskId]` — el lector que le faltaba al flujo A2A entrante (v3.4.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 134-138, R1-R8, RD-63 a RD-67) · aprobada por checkpoint humano en sus dos decisiones centrales, **con una revertida**:

- **ADR 136 CONFIRMADO** — puerto de núcleo nuevo en archivo nuevo, **no** el patrón sin puerto de `build-on-a2a-entrante.ts`. **No se reabre.**
- **ADR 134 pto 5 REVERTIDO por el checkpoint** — el comando **SÍ** escribe fila en `registro_acciones_empleado`, armonizando con `comando-reporte-comisiones` y `comando-cancelar-solicitud`. Eso **activa RD-67**, que la propuesta había dejado condicional. Ver **ADR 143**. Los otros cuatro puntos del ADR 134 (molde `/ver-propuesta`, síncrono, sin `createCaso`, sin `confirmacionPendiente`) **siguen vigentes**.

**Rama**: `hito/v3.4-comando-visibilidad-a2a-entrante` · **Tag**: `v3.4.0` (propuesto) · **Progreso**: `docs/progreso/v3.4-comando-visibilidad-a2a-entrante/`.

---

## 1. Resumen de la arquitectura elegida

Primer puerto de núcleo de `solicitudes_a2a_entrantes`, segundo índice de la tabla, y **cero funciones existentes modificadas**: todo es aditivo salvo dos doc-comments y el conteo de descriptores.

```
 ┌── src/core/ (nunca importa de adapters/) ───────────────────────────────┐
 │                                                                         │
 │  agents/a2a-contract.ts            ★ SIN CAMBIOS (ADR 135) — se USA     │
 │                                     `esEstadoTerminal`/`esTaskState-    │
 │                                     Conocido`; la excepción del         │
 │                                     requirement `:31` NO se consume     │
 │                        │ importado por (core → core, legal)             │
 │                        ▼                                                │
 │  agents/a2a-entrante-contract.ts   ★ NUEVO (ADR 139) — hermano de       │
 │                                     `a2a-entrante-prompt.ts`, familia   │
 │                                     `a2a-entrante-*` YA EXISTENTE       │
 │                                     · `SolicitudA2AEntranteStorePort`   │
 │                                     · `SolicitudA2AEntranteVistaEmpleado` │
 │                                     · `EstadoSolicitudA2AEntrante` ★    │
 │                                       (unión discriminada, ADR 141)     │
 │                                     · `TASK_STATES_EN_CURSO` DERIVADO   │
 │                                                                         │
 │  commands/comando-empleado.ts      MODIFICADO · descriptor 18, brazo    │
 │                                     `ver_solicitudes_a2a`, `Forma`      │
 │                                     `"id_opcional_a2a_task"` (ADR 56)   │
 │                                                                         │
 │  commands/registro-acciones-contract.ts  MODIFICADO · +1 constante      │
 │                                     `COMANDO_VER_SOLICITUDES_A2A`.      │
 │                                     CERO `RESULTADO_*` nuevos (ADR 143) │
 └─────────────────────────────────────────────────────────────────────────┘
                                        │ consumido por
 ┌── src/ (composition root) ──────────────────────────────────────────────┐
 │  build-on-comando-empleado.ts      MODIFICADO · `createSolicitudA2A-    │
 │                                     EntranteStore(db)`, `toPortSolicitud│
 │                                     A2AEntrante` ★ (donde vive el guard │
 │                                     de vocabulario), entrada en `Deps`, │
 │                                     `manejarVerSolicitudesA2A`, dos     │
 │                                     formateadores, `case` del switch    │
 │                                                                         │
 │  build-on-a2a-entrante.ts          ★ SIN CAMBIOS — el camino de         │
 │                                     escritura del Hito 7 es inmune      │
 └─────────────────────────────────────────────────────────────────────────┘
                                        │
 ┌── src/adapters/memory/ ─────────────────────────────────────────────────┐
 │  repository.ts    + listSolicitudesA2AEntrantesPorEstado (ADR 140).     │
 │                     `getSolicitudA2AEntrantePorTaskId` se ENVUELVE, no  │
 │                     se toca: CERO SQL nuevo para el modo detalle        │
 │  migrations/0012_idx_solicitudes_a2a_entrantes_estado.ts   ★ NUEVO      │
 │  migrations/index.ts  + una línea · migrations/0011  doc-comment (R2)   │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisiones de arquitectura (ADR 139-143)

### ADR 139 (RD-64): el puerto se llama `SolicitudA2AEntranteStorePort` y vive en `src/core/agents/a2a-entrante-contract.ts` — y la ubicación no es una preferencia, es un precedente verificado

**Contexto**. El ADR 136 fijó *"archivo NUEVO de `src/core/`, no dentro de `a2a-contract.ts`"* y reservó nombre y ubicación. El repo tiene **dos** convenciones de layout en `src/core/`, y hay que elegir con evidencia: dominio propio con directorio (`solicitudes/`, `propuestas/`, `ventas/`, `hitl/`) o archivo dentro de un directorio existente.

**Decisión**. **`src/core/agents/a2a-entrante-contract.ts`**, hermano de `a2a-contract.ts`.

1. **★ La familia `a2a-entrante-*` YA EXISTE en ese directorio, y no la inventa este change.** El glob de `src/core/**/*.ts` (91 archivos) muestra `src/core/agents/a2a-entrante-prompt.ts` (Hito 7, tarea 3): el flujo A2A **entrante** ya tiene su primer archivo de núcleo, con ese prefijo, en ese directorio. Abrir `src/core/a2a-entrante/` para el segundo archivo de la misma familia **partiría en dos** una familia que hoy está junta. El sufijo `-contract.ts` es el mismo de los otros ocho contratos del núcleo.
2. **El nombre del puerto sigue la serie literal, sin abreviar.** `VentaStorePort`, `SolicitudStorePort`, `PropuestaStorePort`, `DelegacionA2AStorePort` ⇒ `SolicitudA2AEntranteStorePort`. Es largo porque la entidad se llama así; abreviarlo a `A2AEntranteStorePort` rompería la correspondencia 1:1 entre el nombre del puerto y el nombre de la fila que devuelve.
3. **★ El tipo del núcleo es MÁS CHICO que `SolicitudA2AEntranteRow`, y cada omisión tiene motivo — no es un espejo por comodidad.** Se omiten **dos** campos a propósito:
   - **`agenteExternoUrl`: R1 deja de ser una regla de disciplina y pasa a ser una imposibilidad estructural.** El campo no existe en el tipo del núcleo ⇒ ningún formateador puede imprimirlo, ni por error ni por un refactor futuro, ni rotularlo "agente". Mismo criterio literal que el ADR 130 de `comando-cancelar-solicitud` (*"No hay campo donde meterlos. La garantía es estructural, no de disciplina"*) y que `AccionEmpleado` (`registro-acciones-contract.ts:41-44`).
   - **`id`** (la PK interna): el comando indexa por `a2aTaskId` en sus dos modos. Un segundo identificador en pantalla sólo invita a tipear el equivocado.
4. **`origenTransporte` SÍ está en el tipo, y el nombre del campo lleva el rótulo puesto.** No se renombra a `agente` ni a `origen` a secas: el nombre del campo es la primera línea de defensa de R1, y el formateador (ADR 142) es la segunda.

**Alternativas consideradas**:

- ***`src/core/a2a-entrante/solicitudes-a2a-entrantes-contract.ts` (directorio nuevo)***: **rechazada por el punto 1.** Es el layout de los dominios de negocio (`solicitudes/`, `ventas/`), y en abstracto es más limpio — pero partiría la familia `a2a-entrante-*` entre dos directorios por un archivo.
- ***Espejo exacto de `SolicitudA2AEntranteRow`***: **rechazada por el punto 3.** Copiar los diez campos "por si acaso" arrastra `agenteExternoUrl` al núcleo y convierte la garantía estructural de R1 en una convención revisable.
- ***Meter el puerto en `a2a-contract.ts`***: ya rechazada por el ADR 136 pto 3. No se reabre.

### ADR 140 (RD-63 / R4 / R7): firma del listado — `IN` con placeholders NOMBRADOS generados en JS, orden `updated_at ASC`, y el `+1` que hace honesto el truncado

**Contexto**. El ADR 137 pto 4 fijó **que** hay índice y **que** la forma del SQL no puede impedir usarlo, con el hallazgo de Reviewer de `listPropuestasCambio` (`repository.ts:2334-2344`) como lección pagada. La bajada a firma tiene **tres** problemas distintos que la propuesta agrupó en uno.

**Decisión** (firma exacta en §3):

1. **★ Los placeholders del `IN` son NOMBRADOS (`@estado0, @estado1, …`), generados en JS — no `?` posicionales.** No es cosmético: el resto de la sentencia usa binds nombrados (`@limite`), y **`better-sqlite3` no permite mezclar parámetros nombrados y posicionales en una misma sentencia**. Un `IN (?, ?)` junto a `LIMIT @limite` no falla en `prepare`: falla en `run`/`all`, o sea en runtime y sólo cuando el listado se ejecuta. Se genera `estados.map((_, i) => "@estado" + i).join(", ")` y el objeto de binds con `Object.fromEntries`.
2. **La cláusula se arma en JS y entra al SQL como igualdad/pertenencia simple** — misma forma que `estadoClausula` (`:2350`), **nunca** un `(@x IS NULL OR estado IN …)`, que es exactamente el patrón que el planner no puede resolver por índice.
3. **`estados` vacío ⇒ corte temprano en JS, sin tocar la base.** `IN ()` es un **error de sintaxis** en SQLite, no una lista vacía. La función devuelve `{ items: [], hayMas: false }` antes del `prepare`. Es una rama de tres líneas y un test.
4. **★ Orden `updated_at ASC`, y la propuesta se equivocó de sentido — vale corregirlo con el argumento a la vista.** RD-63 sugería `updated_at DESC` *"que es lo que un operador buscando huérfanos quiere ver primero"*. **Es al revés.** El huérfano del Hallazgo 2 es una fila cuyo `updated_at` quedó **congelado en la sesión anterior**; una tarea legítimamente en vuelo tiene el `updated_at` **más reciente de todos**. `DESC` pone las vivas arriba y entierra al huérfano abajo. Y el argumento se vuelve dirimente al combinarlo con el `LIMIT`: **con `DESC`, el truncado descarta precisamente las filas más viejas — las únicas que el comando existe para mostrar.** `ASC` trunca por el otro extremo, que es el inofensivo. Además coincide con el orden de `listSolicitudesA2AEntrantesPorCaso` (`:2710`) y `listPropuestasCambio` (`:2357`), que ordenan ascendente.
5. **★ `LIMIT limite + 1` adentro de la función, y devuelve `{ items, hayMas }`.** Con un `LIMIT 20` pelado, recibir 20 filas es indistinguible de *"hay 20"* y de *"hay 200"*, así que **no se puede avisar del truncado sin mentir o sin una segunda query**. Se pide una fila de más, se descarta y se reporta `hayMas: true`. R7 queda cerrado con un `boolean` en vez de un `COUNT(*)` extra.
6. **`LIMITE_LISTADO_A2A_ENTRANTES = 20` vive UNA sola vez, en el contrato del núcleo, y `limite` es OBLIGATORIO en la firma del repositorio.** Desviación consciente del molde: `listPropuestasCambio` tiene un default privado (`LIMITE_LISTADO_PROPUESTAS_DEFAULT`, `:2325`) **duplicando** `LIMITE_LISTADO_PROPUESTAS` (`propuestas-contract.ts:54`) — dos constantes con el mismo `20` que nadie mantiene sincronizadas. **No se copia esa duplicación**: el default lo pone el puerto (que ya importa del núcleo), y el adaptador recibe el número. Se sigue el patrón en todo lo demás.
7. **`estados: readonly TaskState[]` del lado del PUERTO, `readonly string[]` del lado del REPOSITORIO.** El adaptador SQL no conoce el vocabulario del protocolo — es la regla textual de `0011:29-31` (ADR 71 pto 5). La derivación tipada ocurre en el núcleo y llega al SQL como strings.

**Alternativas consideradas**:

- ***`?` posicionales para el `IN`***: **rechazada por el punto 1.** Obligaría a pasar todo a posicional, incluido `LIMIT`, rompiendo el estilo de las otras ocho funciones de la sección.
- ***`estado = @estado` con una query por estado y merge en JS***: **rechazada.** Dos queries y un ordenamiento en memoria para evitar un problema que un `IN` bien armado no tiene.
- ***`COUNT(*)` aparte para saber si hay más***: **rechazada por el punto 5.** Duplica el trabajo del planner para obtener un `boolean`.

### ADR 141 (RD-66 / R5): el guard de vocabulario es **un tipo**, no un `if` — `EstadoSolicitudA2AEntrante` hace que el cast no sea evitable, sino **inexpresable**

**Contexto**. `estado` es `TEXT` sin `CHECK` (`0011:29-31`, ADR 137 pto 5) y `SolicitudA2AEntranteRow.estado` es `string` crudo (`:2554`), pero `esEstadoTerminal` **exige un `TaskState`** (`a2a-contract.ts:74`). R5 exige narrowing con `esTaskStateConocido` y prohíbe el cast. La pregunta real es **dónde** vive esa obligación para que nadie pueda saltearla.

**Decisión**. **El tipo del núcleo NO tiene un campo `estado: TaskState`. Tiene una unión discriminada** (firma en §3):

```ts
export type EstadoSolicitudA2AEntrante =
  | { readonly conocido: true; readonly valor: TaskState }
  | { readonly conocido: false; readonly valor: string };
```

1. **★ El cast deja de ser una tentación y pasa a ser imposible.** Nadie puede llamar `esEstadoTerminal(vista.estado.valor)` sin haber narrowed antes por `conocido === true`: en la otra rama, `valor` es `string` y **el compilador lo rechaza**. Es la misma clase de garantía que el ADR 130 (*"estructural, no de disciplina"*) y que la guarda `never` del ADR 129, pero aplicada a una entrada de datos en vez de a una unión de acciones.
2. **La traducción vive en `toPortSolicitudA2AEntrante`, en `build-on-comando-empleado.ts` — molde exacto de `toPortPropuesta` (`:476-482`) y `toPortSolicitud` (`:407-414`)**, junto a `createSolicitudA2AEntranteStore`. Es el único lugar donde un `string` de la base se convierte en vocabulario del núcleo.
3. **★ Pero NO lanza, y ésa es la diferencia deliberada con el molde.** `toPortSolicitud`/`toPortPropuesta` lanzan (`SolicitudTipoEstadoInvalidoError`/`PropuestaEstadoInvalidoError`) porque traducen la fila que **el CAS acaba de escribir** en un camino de escritura: ahí un valor raro es corrupción y la falla ruidosa es correcta. **Acá el camino es de LECTURA PURA y diagnóstico.** Un `throw` haría que **una** fila corrupta rompa el listado **entero** — es decir, que el comando se apague exactamente en el escenario para el que existe. Un lector de diagnóstico que explota cuando la base está rara es peor que inútil: es engañoso. Se degrada a `conocido: false` y se muestra rotulada.
4. **Una fila con estado desconocido NUNCA aparece en el listado "en curso", y eso sale gratis del SQL.** El `WHERE estado IN (…)` sólo lleva `SUBMITTED`/`WORKING`, que son conocidos por construcción ⇒ la exclusión es estructural, no una regla del formateador. **Es alcanzable por el modo detalle** (`/ver-solicitudes-a2a <id>`), donde se imprime como `estado <valor crudo> (desconocido)`. Ésa es la respuesta completa a RD-66: **fuera del listado, visible por id, rotulada, sin cast y sin throw.**
5. **`TASK_STATES_EN_CURSO` se DERIVA una sola vez, en el contrato nuevo** (ADR 135): `TASK_STATES_CONOCIDOS.filter((e) => !esEstadoTerminal(e))`. Vive en `a2a-entrante-contract.ts`, **no** en `a2a-contract.ts`, que no recibe ni una línea. No es "una lista literal de estados en curso": es una lista **computada** desde la única partición existente, y por eso satisface el Success Criteria.

**Alternativas consideradas**:

- ***`estado: TaskState | undefined` + `estadoCrudo: string`***: **rechazada.** Dos campos donde la información es una sola, y nada impide leer `estadoCrudo` e ignorar el `undefined`. La unión discriminada obliga a mirar los dos casos.
- ***Lanzar `SolicitudA2AEstadoInvalidoError`, molde literal de `toPortSolicitud`***: **rechazada por el punto 3.** Es el molde del repo, y por eso se explicita por qué acá NO aplica: la naturaleza del camino (lectura de diagnóstico) es la que cambia, no el gusto.
- ***Filtrar en JS las filas desconocidas y no mostrarlas nunca***: **rechazada.** Esconder una fila que la base sí tiene es la misma ceguera que este change vino a cerrar, sólo que autoinfligida.

### ADR 142 (RD-65 / R1 / R8): dos formateadores, rótulo explícito de transporte, y el paginado de `formatearResumenPropuesta` se copia **con su tope propio**

**Decisión**.

1. **Listado — una línea por fila**, molde de `formatearLineaPropuesta` (`:1061-1063`):
   `- tarea <a2aTaskId> | estado <estado> | origen de transporte <origenTransporte> | recibida <createdAt> | actualizada <updatedAt>`
   **El rótulo es `origen de transporte`, en texto, nunca `agente` ni `de`** (R1). Vacío ⇒ `"No hay solicitudes A2A entrantes en curso."`. `hayMas === true` ⇒ nota final `[…mostrando las primeras 20; hay más solicitudes en curso…]`, molde literal de la nota de `:1094-1097`.
2. **Detalle** — resumen de una línea + `mensaje_recibido` + `resultado`, **los dos paginados** con la misma mecánica de `formatearResumenPropuesta` (`:1090-1099`) y una **constante propia**, `LINEAS_PAGINA_A2A = 80`, en `a2a-entrante-contract.ts`. **No se reusa `LINEAS_PAGINA_PATCH`** (`propuestas-contract.ts:57`): mismo valor hoy, pero significa *"líneas de un patch de código"* — importarla acá ataría el paginado de una respuesta A2A a una decisión sobre diffs, y el día que una de las dos cambie la otra cambiaría sin que nadie lo pida. **Mismo criterio con el que el ADR 133 rechazó reusar `RESULTADO_RECHAZADA`: el vocabulario se comparte por significado, no por coincidencia de valor.**
3. **`resultado` ausente ⇒ se OMITE la sección entera**, no se imprime vacía ni `null` — mismo binario que el `dictamen` de `formatearLineaSolicitud` (`:567-568`). Ídem `casoId` ausente (la fila `REJECTED` del ADR 90 pto 4).
4. **Id inexistente ⇒ `No existe ninguna solicitud A2A <id>.`**, forma exacta de `manejarVerPropuesta:1124-1126`. **Sin throw.**
5. **`agenteExternoUrl` no aparece por ningún lado — y no porque el formateador se acuerde, sino porque el tipo no lo tiene** (ADR 139 pto 3).

### ADR 143 (RD-67, activado por el checkpoint): fila de auditoría **sin constante `RESULTADO_*` nueva y sin migración**, con `casoId` cuando existe

**Contexto**. El checkpoint revirtió el ADR 134 pto 5: el comando registra. Queda decidir el vocabulario y la granularidad.

**Decisión**.

1. **Una sola constante nueva: `COMANDO_VER_SOLICITUDES_A2A = "/ver-solicitudes-a2a"`**, molde literal de las trece existentes (`registro-acciones-contract.ts:8-20`).
2. **★ CERO `RESULTADO_*` nuevos.** `RESULTADO_ATENDIDA` (`"atendida"`) ya significa exactamente *"el comando resolvió lo que se le pidió"* y es el que `/soporte` y `/consultar-kpi` usan. Es el mismo criterio con el que el ADR 122 de `comando-reporte-comisiones` reusó esa constante, y el opuesto del ADR 133 — que declaró una propia **porque ningún `RESULTADO_*` existente significaba "el autor la retiró"**. Acá sí lo hay. **El vocabulario crece cuando aparece un hecho de negocio nuevo, no cuando aparece un comando nuevo.**
3. **★ Dos resultados, no uno, y el que importa es el segundo.** `RESULTADO_ATENDIDA` en listado y en detalle **encontrado**; **`RESULTADO_NO_APLICABLE`** cuando el `a2aTaskId` no existe. No es simetría decorativa: por el ADR 138 pto 2, lo auditable de este comando es **la divulgación de contenido** (`resultado` de una `COMPLETED` es la respuesta real que el arnés le dio a un tercero). Una auditoría que no distingue *"un administrador leyó el contenido íntegro de una tarea"* de *"un administrador tipeó un id mal"* pierde justamente el dato por el que se decidió auditar.
4. **`casoId` viaja cuando la fila lo tiene** (modo detalle). La columna ya existe y es nullable (`AccionEmpleado.casoId`, usado por `/soporte` en `:779`) ⇒ correlación gratis con el caso del Hito 7, **sin migración**. Modo listado: sin `casoId` (son varias filas, ninguna es "el" caso).
5. **`a2aTaskId` NO se agrega a `AccionEmpleado`.** Sería una columna nueva en `registro_acciones_empleado` y **una segunda migración**, que la propuesta declara en cero. El par `comando` + `ocurridoAt` + `empleadoId` ya identifica el acceso; el id de la tarea vive en el log de eventos del turno.
6. **Vía `registrar(...)`** (`:714-731`), que ya degrada la falla a un evento (ADR 40) y **ya corta si no hay sesión vigente** — con la guarda de privilegio de `:1424` arriba, el camino sin sesión no llega ni a leer. **Cero migraciones**: `comando`/`resultado` son `TEXT` sin `CHECK` (`0005:48`).

---

## 3. Interfaces / firmas concretas

**`src/core/agents/a2a-entrante-contract.ts`** — ★ archivo NUEVO (ADR 139, 141):

```ts
/**
 * Puerto de LECTURA de `solicitudes_a2a_entrantes` (v3.4.0, ADR 136/139).
 * Hermano de `a2a-entrante-prompt.ts`: misma familia, mismo directorio.
 * NO es vocabulario de protocolo — por eso no vive en `a2a-contract.ts`,
 * que este change no toca ni en un doc-comment (ADR 135 pto 3).
 * Importa de `a2a-contract.ts` (core → core, legal por `AGENTS.md`).
 */
import { TASK_STATES_CONOCIDOS, esEstadoTerminal, type TaskState } from "./a2a-contract.js";

/** DERIVADO, no literal (ADR 135). Hoy `[SUBMITTED, WORKING]`; un noveno
 *  estado se clasifica solo y de forma correcta por construcción. */
export const TASK_STATES_EN_CURSO: readonly TaskState[] = TASK_STATES_CONOCIDOS.filter(
  (estado) => !esEstadoTerminal(estado),
);

/** Tope del listado sin argumento — espejo de `LIMITE_LISTADO_PROPUESTAS`.
 *  ÚNICA fuente de verdad: el repositorio NO tiene default propio (ADR 140 pto 6). */
export const LIMITE_LISTADO_A2A_ENTRANTES = 20;

/** Líneas por página de `mensaje_recibido`/`resultado`. PROPIA, no
 *  `LINEAS_PAGINA_PATCH`: mismo valor, otro significado (ADR 142 pto 2). */
export const LINEAS_PAGINA_A2A = 80;

/**
 * ★ EL GUARD DE VOCABULARIO ES ESTE TIPO (ADR 141, R5). `estado` es TEXT sin
 * `CHECK` (`0011:29-31`) y `esEstadoTerminal` exige un `TaskState`: acá el
 * narrowing no es una regla que haya que recordar, es la única forma de
 * obtener un `TaskState`. `esEstadoTerminal(vista.estado.valor)` NO COMPILA
 * sin haber discriminado por `conocido` primero.
 */
export type EstadoSolicitudA2AEntrante =
  | { readonly conocido: true; readonly valor: TaskState }
  | { readonly conocido: false; readonly valor: string };

/**
 * La fila tal como el núcleo la ve. MÁS CHICA que `SolicitudA2AEntranteRow`
 * (`repository.ts:2547`), a propósito (ADR 139 pto 3):
 *  · SIN `agenteExternoUrl` — siempre `NULL` (ADR 89) y R1 se vuelve
 *    ESTRUCTURAL: no hay campo desde donde imprimir una identidad falsa.
 *  · SIN `id` — el comando indexa por `a2aTaskId` en sus dos modos.
 * `origenTransporte` es una DIRECCIÓN DE RED, no una identidad de agente
 * (`0011:18-20`), y el formateador la rotula así (ADR 142 pto 1).
 */
export interface SolicitudA2AEntranteVistaEmpleado {
  readonly a2aTaskId: string;
  readonly estado: EstadoSolicitudA2AEntrante;
  readonly origenTransporte: string;
  readonly casoId?: string;
  readonly mensajeRecibido: string;
  readonly resultado?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `hayMas` sale del `LIMIT limite + 1` (ADR 140 pto 5): sin él no se puede
 *  avisar del truncado sin mentir ni pagar un `COUNT(*)`. */
export interface ListadoSolicitudesA2AEntrantes {
  readonly items: readonly SolicitudA2AEntranteVistaEmpleado[];
  readonly hayMas: boolean;
}

/**
 * SÍNCRONO (ADR 100/134 pto 3: `better-sqlite3` no necesita `Promise`).
 * Sólo LECTURA: el camino de escritura del Hito 7 no pasa por acá y este
 * puerto no puede alcanzarlo.
 */
export interface SolicitudA2AEntranteStorePort {
  /** `estados` vacío ⇒ listado vacío, sin tocar la base (ADR 140 pto 3). */
  listarPorEstados(filtro: {
    readonly estados: readonly TaskState[];
    readonly limite?: number;
  }): ListadoSolicitudesA2AEntrantes;
  /** Envuelve `getSolicitudA2AEntrantePorTaskId` — CERO SQL nuevo (ADR 136). */
  obtenerPorTaskId(a2aTaskId: string): SolicitudA2AEntranteVistaEmpleado | undefined;
}
```

**`src/adapters/memory/repository.ts`** (aditivo — `getSolicitudA2AEntrantePorTaskId` sin tocar):

```ts
export interface ListadoSolicitudesA2AEntrantesRows {
  readonly items: readonly SolicitudA2AEntranteRow[];
  readonly hayMas: boolean;
}

/**
 * Listado por estados, molde de `listPropuestasCambio` (`:2346`) con su misma
 * lección de eficiencia (Reviewer finding, `:2334-2344`): la cláusula se arma
 * en JS y entra al SQL como una PERTENENCIA SIMPLE que
 * `idx_solicitudes_a2a_entrantes_estado` (migración `0012`) sí resuelve con
 * `SEARCH` — NUNCA un `(@x IS NULL OR estado IN ...)`, que el planner no
 * puede resolver por índice. Verificado con `EXPLAIN QUERY PLAN` en el test
 * de este archivo (R4).
 *
 * ★ Placeholders NOMBRADOS y no `?`: `better-sqlite3` NO permite mezclar
 * parámetros nombrados y posicionales en una misma sentencia, y el `LIMIT`
 * ya usa `@limite`. Mezclarlos falla en `all()`, no en `prepare()`.
 *
 * ★ `LIMIT @limite + 1` con descarte de la última: sin la fila extra, recibir
 * `limite` filas es indistinguible de "hay exactamente `limite`" y de "hay
 * cientos", y no se podría avisar del truncado sin mentir (R7).
 *
 * Orden `updated_at ASC`: el huérfano del Hallazgo 2 es la fila cuyo
 * `updated_at` quedó CONGELADO en una sesión anterior; una tarea viva es la
 * más reciente. Con `DESC`, el `LIMIT` descartaría exactamente las filas que
 * el comando existe para mostrar (ADR 140 pto 4).
 *
 * `estados` son `string[]`, no `TaskState[]`: el vocabulario canónico vive en
 * el núcleo y el SQL no lo conoce (`0011:29-31`, ADR 71 pto 5).
 */
export function listSolicitudesA2AEntrantesPorEstado(
  db: Database.Database,
  filtro: { readonly estados: readonly string[]; readonly limite: number },
): ListadoSolicitudesA2AEntrantesRows {
  // `IN ()` es un ERROR DE SINTAXIS en SQLite, no una lista vacía.
  if (filtro.estados.length === 0) {
    return { items: [], hayMas: false };
  }

  const placeholders = filtro.estados.map((_, i) => `@estado${i}`).join(", ");
  const bindsEstados = Object.fromEntries(filtro.estados.map((estado, i) => [`estado${i}`, estado]));

  const rows = db
    .prepare(
      `SELECT ${SOLICITUD_A2A_ENTRANTE_SELECT_COLUMNS}
         FROM solicitudes_a2a_entrantes
        WHERE estado IN (${placeholders})
        ORDER BY updated_at
        LIMIT @limite`,
    )
    .all({ ...bindsEstados, limite: filtro.limite + 1 }) as SolicitudA2AEntranteSqlRow[];

  const hayMas = rows.length > filtro.limite;
  return { items: rows.slice(0, filtro.limite).map(rowToSolicitudA2AEntrante), hayMas };
}
```

**`src/adapters/memory/migrations/0012_idx_solicitudes_a2a_entrantes_estado.ts`** — ★ NUEVO, contenido **exacto** (molde de `0002`):

```ts
/**
 * Segundo índice de `solicitudes_a2a_entrantes` (v3.4.0, ADR 137). El
 * doc-comment de `0011:36-38` justificaba tener un solo índice con "ninguna
 * pantalla ni comando filtra por `estado`" — cierto hasta que
 * `/ver-solicitudes-a2a` lo dejó de ser (R2; ese comentario se corrige en el
 * mismo change). Es lo que las otras dos tablas de flujo ya tienen:
 * `idx_solicitudes_estado` (`0008:59`) e `idx_propuestas_estado` (`0009:79`).
 *
 * No toca `0011`, ya aplicada — migración ADITIVA, por la convención de
 * `migrations/index.ts`. `IF NOT EXISTS` la hace idempotente: sin
 * `ALTER TABLE`, sin backfill, sin reescritura de filas.
 *
 * NO agrega un `CHECK` sobre `estado` y no reabre esa decisión (ADR 71 pto 5,
 * ADR 137 pto 5): un índice acelera búsquedas, no restringe valores. El
 * vocabulario lo valida el núcleo (ADR 141).
 */
export const migration0012IdxSolicitudesA2AEntrantesEstado = {
  id: "0012_idx_solicitudes_a2a_entrantes_estado",
  sql: `
CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_estado ON solicitudes_a2a_entrantes(estado);
`,
};
```

`migrations/index.ts`: un `import` y un elemento **al final** de `migrations` — nunca intercalado (`:20-22`).
`migrations/0011:36-38`: doc-comment reescrito a *"Dos índices: `caso_id` para el volcado por caso (§7.2) y `estado` para `/ver-solicitudes-a2a` (migración `0012`, v3.4.0)"*. **Cero SQL tocado.**

**`src/core/commands/registro-acciones-contract.ts`** (delta — **una** línea, ADR 143):

```ts
export const COMANDO_VER_SOLICITUDES_A2A = "/ver-solicitudes-a2a"; // v3.4.0
// Sin RESULTADO_* nuevo: reusa RESULTADO_ATENDIDA / RESULTADO_NO_APLICABLE.
```

**`src/core/commands/comando-empleado.ts`** (delta — **con** `Forma` nueva, ADR 56):

```ts
// ComandoEmpleado, brazo nuevo antes de `ayuda`:
| { readonly tipo: "ver_solicitudes_a2a"; readonly a2aTaskId?: string }

// Forma: de CINCO a SEIS miembros. El sufijo nombra la ENTIDAD de la clave de
// payload (`a2aTaskId` ⇒ la TAREA A2A), igual que `id_opcional_solicitud`
// nombra `solicitudId`. El `proposal.md` la había anotado `"id_opcional_a2a"`;
// se precisa a `"id_opcional_a2a_task"` por esa correspondencia.
type Forma =
  | "sin_argumentos" | "id_opcional" | "id_mas_resto"
  | "id_opcional_solicitud" | "id_opcional_propuesta" | "id_opcional_a2a_task";

// DESCRIPTORES, antes de /ayuda:
{
  nombre: "/ver-solicitudes-a2a",
  uso: "/ver-solicitudes-a2a [a2aTaskId]",
  ayuda: "Muestra las solicitudes A2A entrantes en curso (o el detalle de una, si se pasa el id de tarea).",
  // `privilegiado: true` — no es una decisión nueva (ADR 138): tercer eslabón
  // del criterio ya escrito para `/ver-propuesta` y `/consultar-kpi`. El
  // `resultado` de una fila COMPLETED es la respuesta real que el arnés le dio
  // a un tercero, construida sobre datos de la empresa.
  privilegiado: true,
  secreto: false,
  forma: "id_opcional_a2a_task",
  tipo: "ver_solicitudes_a2a",
},

// parsearComando — CUARTA rama `id_opcional*`, copia literal de la de
// `id_opcional_propuesta` (`:360-368`) con la clave cambiada. Sin imports,
// sin cast: `as const satisfies` narrowea `descriptor.tipo` al único literal
// de esta forma. NOTA para un change futuro: las cuatro ramas son idénticas
// salvo el nombre de la clave; consolidarlas tocaría código existente y
// probado, y este change es aditivo — no se hace acá.
if (descriptor.forma === "id_opcional_a2a_task") {
  const a2aTaskId = restoLinea === undefined ? undefined : splitPrimerEspacio(restoLinea).primero;
  const tipo = descriptor.tipo;
  return a2aTaskId === undefined ? { tipo } : { tipo, a2aTaskId };
}
```

**`src/build-on-comando-empleado.ts`** (deltas):

```ts
/** ★ Donde vive el guard de vocabulario (ADR 141). A diferencia de
 *  `toPortSolicitud`/`toPortPropuesta`, NO LANZA: éste es un camino de
 *  lectura de diagnóstico, y un throw haría que UNA fila corrupta apague el
 *  listado entero — el comando se rompería justo en el escenario para el que
 *  existe. Degrada a `conocido: false` y el formateador la rotula. */
function toPortSolicitudA2AEntrante(row: SolicitudA2AEntranteRow): SolicitudA2AEntranteVistaEmpleado {
  const estado: EstadoSolicitudA2AEntrante = esTaskStateConocido(row.estado)
    ? { conocido: true, valor: row.estado }
    : { conocido: false, valor: row.estado };
  // `agenteExternoUrl` e `id` NO se copian (ADR 139 pto 3, R1 estructural).
  return {
    a2aTaskId: row.a2aTaskId, estado, origenTransporte: row.origenTransporte,
    ...(row.casoId !== undefined ? { casoId: row.casoId } : {}),
    mensajeRecibido: row.mensajeRecibido,
    ...(row.resultado !== undefined ? { resultado: row.resultado } : {}),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

/** Molde exacto de `createPropuestaStore` (`:494`): delegaciones directas,
 *  sin lógica propia, sólo traducción vía `toPortSolicitudA2AEntrante`. */
export function createSolicitudA2AEntranteStore(db: Database.Database): SolicitudA2AEntranteStorePort {
  return {
    listarPorEstados(filtro) {
      const { items, hayMas } = listSolicitudesA2AEntrantesPorEstado(db, {
        estados: filtro.estados,
        limite: filtro.limite ?? LIMITE_LISTADO_A2A_ENTRANTES,
      });
      return { items: items.map(toPortSolicitudA2AEntrante), hayMas };
    },
    obtenerPorTaskId(a2aTaskId) {
      const row = getSolicitudA2AEntrantePorTaskId(db, a2aTaskId);
      return row ? toPortSolicitudA2AEntrante(row) : undefined;
    },
  };
}

// Deps, junto a `propuestaStore` (`:288-289`):
/** v3.4.0 — default: `createSolicitudA2AEntranteStore(db)` (más abajo). */
readonly solicitudA2AEntranteStore?: SolicitudA2AEntranteStorePort;

/**
 * `/ver-solicitudes-a2a [a2aTaskId]` (v3.4.0, ADR 134). Molde LITERAL de
 * `manejarVerPropuesta` (`:1113-1128`): UN SOLO PASO, SÍNCRONO, sin `await`,
 * sin `createCaso`, y NUNCA lee ni escribe `confirmacionPendiente` — mostrar
 * filas que ya existen es una lectura, punto. `privilegiado: true` ya lo
 * garantizó la guarda del preámbulo (`:1424`): no se duplica acá.
 *
 * ÚNICA diferencia con el molde: `registrar(...)` (ADR 143, revertido por el
 * checkpoint) — `ATENDIDA` cuando hay algo que mostrar, `NO_APLICABLE`
 * cuando el id no existe, para que la auditoría distinga una divulgación de
 * contenido de un id mal tipeado (ADR 138 pto 2).
 */
function manejarVerSolicitudesA2A(
  comando: Extract<ComandoEmpleado, { tipo: "ver_solicitudes_a2a" }>,
  ahora: string,
): TuiTurnResult {
  if (comando.a2aTaskId === undefined) {
    const listado = solicitudA2AEntranteStore.listarPorEstados({ estados: TASK_STATES_EN_CURSO });
    registrar({ comando: COMANDO_VER_SOLICITUDES_A2A, resultado: RESULTADO_ATENDIDA }, ahora);
    return sistema(formatearListadoSolicitudesA2A(listado));
  }

  const vista = solicitudA2AEntranteStore.obtenerPorTaskId(comando.a2aTaskId);
  if (vista === undefined) {
    registrar({ comando: COMANDO_VER_SOLICITUDES_A2A, resultado: RESULTADO_NO_APLICABLE }, ahora);
    return sistema(`No existe ninguna solicitud A2A ${comando.a2aTaskId}.`);
  }
  registrar(
    {
      comando: COMANDO_VER_SOLICITUDES_A2A,
      ...(vista.casoId !== undefined ? { casoId: vista.casoId } : {}),
      resultado: RESULTADO_ATENDIDA,
    },
    ahora,
  );
  return sistema(formatearDetalleSolicitudA2A(vista));
}

// switch (comando.tipo), junto a `ver_propuesta` (`:1451`):
case "ver_solicitudes_a2a":
  return manejarVerSolicitudesA2A(comando, ahora);
```

---

## 4. Flujo de datos

```
"/ver-solicitudes-a2a"                        "/ver-solicitudes-a2a 9f27f1fb-…"
        │                                              │
        ▼                                              ▼
parsearComando (PURO, sin imports) — rama `id_opcional_a2a_task` NUEVA
        │  { tipo: "ver_solicitudes_a2a" }      { tipo, a2aTaskId: "9f27f1fb-…" }
        ▼
guarda de privilegio (`esComandoPrivilegiado` === true, `:1424`)
        │  sin sesión ──▶ "necesita /login"  · CERO lecturas · CERO filas
        ▼
manejarVerSolicitudesA2A (SÍNCRONA · sin createCaso · sin confirmacionPendiente)
        │
   ┌────┴──────────────────────────────┬───────────────────────────────────┐
   │ MODO LISTADO                      │ MODO DETALLE                      │
   ▼                                   ▼                                   │
TASK_STATES_EN_CURSO                 obtenerPorTaskId(id)                   │
 = TASK_STATES_CONOCIDOS                    │                               │
     .filter(!esEstadoTerminal)             ▼                               │
 ★ DERIVADO (ADR 135)             getSolicitudA2AEntrantePorTaskId          │
   = [SUBMITTED, WORKING]          ★ CERO SQL NUEVO — se reusa `:2595`      │
   ⇒ INPUT_REQUIRED y                       │                               │
     AUTH_REQUIRED QUEDAN AFUERA            │ undefined ──▶ "No existe…"    │
   │                                        │            + NO_APLICABLE     │
   ▼                                        ▼                               │
listSolicitudesA2AEntrantesPorEstado   ┌──────────────────────────────┐     │
  WHERE estado IN (@estado0,@estado1)  │ toPortSolicitudA2AEntrante   │     │
  ORDER BY updated_at ASC              │ ★ GUARD DE VOCABULARIO       │     │
  LIMIT 21  (= 20 + 1, R7)             │   esTaskStateConocido(...)   │     │
  ★ SEARCH por idx_…_estado (0012),    │   ⇒ {conocido:true|false}    │     │
    NUNCA SCAN — EXPLAIN en test (R4)  │   SIN cast · SIN throw       │     │
   │                                   │   sin agenteExternoUrl (R1)  │     │
   └──────────────▶ items + hayMas ───▶└──────────────────────────────┘     │
                                        │                                   │
                                        ▼                                   │
                    formatearListadoSolicitudesA2A / …DetalleSolicitudA2A ◀─┘
                    · rótulo "origen de transporte", NUNCA "agente" (R1)
                    · paginado a LINEAS_PAGINA_A2A, nota de truncado (R8)
                    · estado desconocido ⇒ "<valor> (desconocido)"
                                        │
                                        ▼
                    registrar({ comando: "/ver-solicitudes-a2a",
                                casoId?, resultado: atendida|no_aplicable })
                    · vía `:714` — degrada a evento si falla (ADR 40)
                                        ▼
                    { responseText, agentLabel: "sistema" }
```

---

## 5. Cambios de archivo

| Archivo | Acción | Qué cambia |
|---|---|---|
| `src/core/agents/a2a-entrante-contract.ts` | **★ Nuevo (ADR 139/141)** | Puerto, `SolicitudA2AEntranteVistaEmpleado`, `EstadoSolicitudA2AEntrante`, `TASK_STATES_EN_CURSO` derivado, dos constantes |
| `src/adapters/memory/migrations/0012_idx_…_estado.ts` | **Nuevo (ADR 137)** | Un `CREATE INDEX IF NOT EXISTS`. Molde de `0002` |
| `src/adapters/memory/migrations/index.ts` | Modificado | Un `import` + un elemento **al final** del array |
| `src/adapters/memory/migrations/0011_…ts` | **Doc-comment, no DDL** | `:36-38` reescrito (R2). **Cero SQL** |
| `src/adapters/memory/repository.ts` | Modificado (aditivo) | `listSolicitudesA2AEntrantesPorEstado` + `ListadoSolicitudesA2AEntrantesRows`. `getSolicitudA2AEntrantePorTaskId` **sin una línea** |
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor 18, brazo de unión, `Forma` 6.ª, rama de `parsearComando`, **los dos** comentarios de conteo (`:96-99`, `:248-251`) |
| `src/core/commands/registro-acciones-contract.ts` | Modificado | **Una** constante (ADR 143) |
| `src/build-on-comando-empleado.ts` | Modificado | `toPortSolicitudA2AEntrante`, `createSolicitudA2AEntranteStore`, `Deps`, handler, dos formateadores, `case` |
| `src/core/agents/a2a-contract.ts` | **★ Sin cambios (ADR 135)** | Verificable en el diff: cero líneas. Excepción del requirement `:31` **no consumida** |
| `src/build-on-a2a-entrante.ts` · `src/adapters/a2a/server.ts` | **★ Sin cambios** | Camino de escritura del Hito 7 intacto ⇒ cero riesgo de regresión sobre `v3.0.0` |
| `src/core/agents/a2a-entrante-contract.test.ts` | Nuevo | Ver §6 |
| `src/adapters/memory/repository.test.ts` · `src/build-on-comando-empleado.test.ts` · `src/core/commands/comando-empleado.test.ts` | Modificados | Ver §6. **`toHaveLength(15) → (18)` en `:369` y `:435`** (R3) |
| `README.md` · `docs/ARC42_Harness_Empresarial.md` | Modificados | Comando nuevo en el Registro de Comandos y en el flujo A2A entrante; conteo |
| `openspec/changes/…/specs/visibilidad-a2a-entrante/spec.md` | Nuevo | Capability nueva |
| `openspec/changes/…/specs/solicitud-a2a-entrante/spec.md` | Nuevo (delta) | **Acota sin derogar** `:29-41`; **complementa** `:45` (R6) |
| `src/core/propuestas/**` · `src/core/solicitudes/**` · `src/core/ventas/**` · `src/adapters/tui/**` | **Sin cambios** | Blast radius cero |

---

## 6. Estrategia de testing

TDD estricto (rojo → verde → refactor), `strict_tdd: true`. **Todo es lógica de negocio: no aplica ninguna excepción.**

| Capa | Qué se testea | Cómo |
|---|---|---|
| **Unit — derivación (ADR 135, PRIMERO)** | `TASK_STATES_EN_CURSO` es **exactamente** `[SUBMITTED, WORKING]`, y **`INPUT_REQUIRED`/`AUTH_REQUIRED` NO están** (ADR 73 pto 2 — el borde que una lista escrita a mano erraría). Un test recorre los **ocho** `TASK_STATES_CONOCIDOS` y afirma la partición completa | `a2a-entrante-contract.test.ts`. Complemento estático: `grep` de `TASK_STATE_SUBMITTED` sobre los archivos nuevos ⇒ **cero literales** fuera de la derivación |
| **Unit — guard de vocabulario (R5, ADR 141)** | Fila con `estado: "BASURA"` ⇒ `{ conocido: false, valor: "BASURA" }`, **sin throw**. Fila con `TASK_STATE_WORKING` ⇒ `{ conocido: true }`. **Y la aserción estructural**: `expect("agenteExternoUrl" in vista).toBe(false)` y `expect("id" in vista).toBe(false)` (R1 estructural, ADR 139 pto 3) | `build-on-comando-empleado.test.ts`, sobre `createSolicitudA2AEntranteStore` con SQLite real y un `UPDATE` crudo que mete el estado basura |
| **Type-check — el guard como tipo** | Que `esEstadoTerminal(vista.estado.valor)` **no compile** sin discriminar por `conocido` | `npm run typecheck` + un `@ts-expect-error` en el test del contrato: si algún día compila, el test **falla** |
| **Integration — EXPLAIN QUERY PLAN (R4, OBLIGATORIO)** | `SEARCH solicitudes_a2a_entrantes USING INDEX idx_solicitudes_a2a_entrantes_estado` **presente** y `SCAN solicitudes_a2a_entrantes` **ausente**, con el `IN` de **dos** estados | `repository.test.ts`, molde **literal** de `:3111-3135`: monkeypatch temporal de `db.prepare` para capturar el SQL exacto (los placeholders son dinámicos ⇒ **no se puede hardcodear la sentencia**), luego `EXPLAIN QUERY PLAN ${sqlCapturado}` con los binds `{estado0, estado1, limite}`. **Rojo primero si falta la `0012`** |
| **Integration — aridad variable** | El mismo assert de plan con `estados` de **uno** y de **tres** elementos: la propiedad no puede depender de que sean exactamente dos | `repository.test.ts` — es la mitad de R4 que el precedente de igualdad simple **no** cubría |
| **Integration — `estados` vacío** | `{ estados: [] }` ⇒ `{ items: [], hayMas: false }` y **`db.prepare` NO se llama** (spy). Sin este corte, `IN ()` es error de sintaxis | `repository.test.ts` |
| **Integration — filtro y orden** | Ocho filas, una por `TASK_STATE_*`: salen **exactamente dos** (`SUBMITTED`, `WORKING`). Con `updated_at` desordenados, el resultado sale **ascendente** — la más vieja (el huérfano) **primera** | `repository.test.ts`, SQLite real en memoria |
| **Integration — truncado (R7)** | 21 filas en curso, `limite: 20` ⇒ 20 items y `hayMas === true`; 20 filas ⇒ `hayMas === false`. **El borde exacto**, que es donde el `+1` se gana el sueldo | `repository.test.ts` |
| **Integration — migración `0012`** | Correrla **dos veces** no falla (`IF NOT EXISTS`); el índice aparece en `PRAGMA index_list('solicitudes_a2a_entrantes')` junto al de `caso_id` | `repository.test.ts` / test de migraciones existente |
| **Unit — parser** | `esComandoPrivilegiado("ver_solicitudes_a2a") === true`; `/ver-solicitudes-a2a X` ⇒ `{tipo, a2aTaskId:"X"}`; sin id ⇒ `{tipo}`; `COMANDOS` tiene **18**; `Forma` tiene **seis** miembros | `comando-empleado.test.ts`. Los `describe` de `:209-260` recorren `DESCRIPTORES` **dinámicamente** ⇒ el descriptor nuevo entra sin tests nuevos ahí |
| **Integration — R1, el riesgo de producto** | El `responseText` de los **dos** modos **no contiene** `"agente"` como rótulo de origen, **sí contiene** `"origen de transporte"`, y con `agente_externo_url = NULL` (o sea, **todas** las filas) no imprime ni `"null"` ni `""` ni un valor inventado | `build-on-comando-empleado.test.ts` — Success Criteria directo |
| **Integration — detalle** | Id inexistente ⇒ `"No existe ninguna solicitud A2A X."` **sin throw**. Id existente `COMPLETED` ⇒ resumen + `resultado`; `resultado` ausente ⇒ la sección **se omite** (no vacía) |  `build-on-comando-empleado.test.ts`, molde de `:1148-1162` |
| **Integration — paginado (R8)** | `resultado` de `LINEAS_PAGINA_A2A + 15` líneas ⇒ primera página + nota `…de N líneas…`; no aparece la línea `LINEAS_PAGINA_A2A` | `build-on-comando-empleado.test.ts`, molde literal de `:1148-1162` |
| **Integration — el caso del Hallazgo 2** | Fila en `TASK_STATE_WORKING` con `updated_at` viejo ⇒ **aparece primera** en el listado sin argumento. **Es el escenario que motivó el change**, y va también a la evidencia manual | `build-on-comando-empleado.test.ts` |
| **Integration — auditoría (ADR 143)** | Listado ⇒ **una** fila `/ver-solicitudes-a2a`/`atendida`, sin `caso_id`. Detalle encontrado ⇒ `atendida` **con** `caso_id`. Id inexistente ⇒ `no_aplicable`. Sin sesión ⇒ **cero** filas (corta la guarda de `:1424`) | `build-on-comando-empleado.test.ts`, molde de los tests de `/consultar-kpi` |
| **Integration — lo que NO hace (ADR 134)** | Ni `casos` ni `delegaciones_a2a` ganan filas; `confirmacionPendiente` sigue `undefined` después de los dos modos; el handler **no es** `async` | `build-on-comando-empleado.test.ts` + inspección de firma |
| **Regresión — blast radius** | `build-on-a2a-entrante.test.ts` y `a2a-server.integration.test` verdes **sin modificarse ni una línea**; `git diff --stat main -- src/core/agents/a2a-contract.ts` **vacío** | `npm test` completo + el diff |

---

## 7. Migración / rollout · dependencia de ORDEN con los otros dos changes (R3)

**Migración**: **una sola**, `0012`, aditiva e idempotente. Cero dependencias nuevas, cero flags, sin ventana de datos inconsistentes. **Verificar al implementar, no al planificar**: si `comando-reporte-comisiones` o `comando-cancelar-solicitud` abrieran una `0012` antes (hoy los dos declaran *"cero migraciones"*), este change toma `0013` — cambia el nombre del archivo y del `id`, nada más del diseño. Rollback: el de la propuesta, sin cambios (el índice **se deja quieto**; las migraciones son forward-only).

**R3 — dependencia de ORDEN, no de diseño. Verificada contra los tres artefactos, no estimada.** Los tres changes no comparten **una sola función**. La colisión es **textual**:

| Superficie | `comando-reporte-comisiones` | `comando-cancelar-solicitud` | Este change | ¿Conflicta? |
|---|---|---|---|---|
| `DESCRIPTORES`, inserción antes de `/ayuda` | `/reporte-comisiones` | `/cancelar-solicitud` | `/ver-solicitudes-a2a` | **Sí** — mismo hunk, los tres |
| Comentarios de conteo `:96-99` y `:248-251` | 15→16 | 15→16 | 15→16 | **Sí** — mismo par de líneas ×2 |
| `comando-empleado.test.ts:369` y `:435` (`toHaveLength` + títulos *"quince"*) | →16 | →16 | →16 | **Sí** — el más fácil de pasar por alto |
| `ComandoEmpleado`, brazo antes de `ayuda` | `reporte_comisiones` | `cancelar_solicitud` | `ver_solicitudes_a2a` | **Sí** — mismo hunk |
| Tipo `Forma` | **agrega** `id_opcional_periodo` | no lo toca | **agrega** `id_opcional_a2a_task` | **Sí** con reporte-comisiones, no con cancelar |
| `registro-acciones-contract.ts`, cola del bloque `COMANDO_*` | +1 | +2 | **+1** | **Sí** — mismo hunk |
| `switch (comando.tipo)` del dispatcher | `case` al final | `case` junto a solicitud | `case` junto a `ver_propuesta` (`:1451`) | No — hunks distintos |
| `migrations/index.ts` | no lo toca | no lo toca | **+1 al final** | **No — único de los tres** |
| `docs/ARC42`, conteo de comandos | 15→16 | 15→16 | 15→16 | **Sí** |

**Regla operativa, idéntica a la que ya fijaron los otros dos: el ÚLTIMO en mergear rebasa y deja el conteo en 18.** No hay gate duro en ninguna dirección; sí hay una **prohibición**: no mergear dos de estas ramas sin rebase. El `toHaveLength` roto es ruidoso y aceptable; **el comentario de conteo que queda mintiendo no lo atrapa nadie**.

**Herencia explícita, no decisión nueva**: la pregunta abierta del requirement *"los **ocho** comandos"* de `comando-empleado-tui:23,47` va por **tercera** vez al mismo lugar. `comando-reporte-comisiones` la dejó como pregunta 3 de su checkpoint y `comando-cancelar-solicitud` decidió **heredarla**. **Este diseño hace lo mismo: si el checkpoint mandó corregir el conteo, este change suma uno; si mandó no tocarlo, no lo toca. No se decide acá.**

---

## 8. Review Workload Forecast

| Archivo | Impl. | Tests |
|---|---|---|
| `a2a-entrante-contract.ts` (puerto, vista, unión de estado, derivación, 2 constantes) | ~72 | ~55 |
| `repository.ts` (`listSolicitudesA2AEntrantesPorEstado` + tipo de retorno) | ~40 | ~95 |
| `0012_*.ts` · `migrations/index.ts` · `0011` (doc-comment) | ~28 | ~18 |
| `comando-empleado.ts` (descriptor, brazo, `Forma`, rama de parser, 2 conteos) | ~30 | ~32 |
| `registro-acciones-contract.ts` | ~3 | ~4 |
| `build-on-comando-empleado.ts` (`toPort…`, store, `Deps`, handler, 2 formateadores, `case`) | ~88 | ~115 |
| `README.md` · `docs/ARC42_*.md` | ~25 | — |
| `specs/` (capability nueva + delta que acota sin derogar, R6) | ~70 | — |
| **Subtotal** | **~356** | **~319** |
| **Total estimado** | — | **~675 líneas** |

**Decision needed before apply: Yes**
**Chained PRs recommended: Yes**
**400-line budget risk: High**

El estimado supera el presupuesto en ~69% — **el más grande de los tres changes hermanos** (`comando-reporte-comisiones` ~383, `comando-cancelar-solicitud` ~473), y no por casualidad: es el único con **archivo de núcleo nuevo**, **migración** y **dos formateadores**. La partida más incierta es `repository.test.ts`: los tres tests de plan (dos, uno y tres estados) más el borde del truncado pueden crecer.

**Corte recomendado — dos slices, frontera por CAPA:**

- **PR 1 — datos, contrato y traducción (~370 líneas).** Migración `0012` + `index.ts` + doc-comment de `0011`; `a2a-entrante-contract.ts` **completo, con el guard de vocabulario del ADR 141**; `listSolicitudesA2AEntrantesPorEstado`; `toPortSolicitudA2AEntrante` + `createSolicitudA2AEntranteStore` + entrada en `Deps`. Tests: `a2a-entrante-contract`, `repository` (incluidos **los tres** de `EXPLAIN QUERY PLAN` y el del truncado), traducción del store.
  *Verificación*: `npm test` + `npm run typecheck` verdes; el índice presente en `PRAGMA index_list`. *Autonomía*: la capacidad existe y es correcta, pero **inalcanzable desde la TUI** — no hay descriptor, `parsearComando` no produce `ver_solicitudes_a2a` y el switch no tiene `case`. **Cero exposición al usuario ⇒ cero riesgo de R1 en este PR.** *Rollback*: revert; el índice sobrevive y no corrompe nada.
  **Frontera dura**: el guard del ADR 141 va en el PR 1, **no** en el 2. Un PR intermedio con un puerto capaz de devolver un `TaskState` sin narrowing es una invariante a medio construir, aunque nadie la consuma todavía.
- **PR 2 — comando, presentación, auditoría y documentación (~305 líneas).** Descriptor + brazo + `Forma` + rama de parser + los dos conteos; `manejarVerSolicitudesA2A`; los dos formateadores (ADR 142); `COMANDO_VER_SOLICITUDES_A2A` + `registrar(...)` (ADR 143); `case` del switch; README, ARC42, las dos specs.
  *Verificación*: los dos modos end-to-end sobre SQLite real, **el test de R1** (rótulo de transporte) y el del Hallazgo 2 (huérfano visible y primero). *Rollback*: revert ⇒ `/ver-solicitudes-a2a` vuelve al sumidero `ayudaDesconocido` (ADR 34), y los demás comandos se comportan byte por byte igual.

Si el checkpoint prefiere **un solo PR**, hace falta un `size:exception` explícito y registrado antes de `sdd-apply`: el diff no baja de ~600 líneas sin sacar algo del alcance, y lo único recortable (docs + specs, ~95) es justamente lo que R1 y R6 vuelven obligatorio.

---

## 9. Preguntas abiertas

- [ ] **Orden de merge frente a `comando-reporte-comisiones` y `comando-cancelar-solicitud`** (R3, §7): decisión **operativa** del checkpoint, no de diseño. El diseño funciona idéntico en las seis permutaciones; sólo cambia el número del conteo y, si otro change abriera una migración antes, `0012` pasa a `0013`.
- [ ] **Requirement *"los ocho comandos"* de `comando-empleado-tui:23,47`**: **heredada, no reabierta** (§7). Tercer change consecutivo que la acata en vez de decidirla.
- [ ] **Remedio activo sobre el huérfano** (pregunta 3 del checkpoint de la propuesta): sigue **abierta a propósito** y **fuera de alcance**. Este diseño la deja más barata: `cancelarSolicitudA2AEntrante` ya existe y está probada (`repository.ts:2665-2698`), y el puerto de este change ya es el lugar natural donde colgarle un tercer método el día que se decida — **sin tocar nada de lo que este change entrega**.
