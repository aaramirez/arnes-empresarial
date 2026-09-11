> **Nota de proceso (hook de graphify)**: ejecutor sin herramienta de shell disponible (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que `proposal.md` y `design.md` de este mismo change. Este documento no reabre ninguna decisión (ADR 134-143, RD-63-67 ya resueltas). Compensación: se releyeron completos `proposal.md`, `design.md` (634 líneas) y las dos specs (`visibilidad-a2a-entrante`, `solicitud-a2a-entrante` delta). Se recomienda `graphify update .` tras persistir este archivo.

# Tasks: `/ver-solicitudes-a2a [a2aTaskId]` — visibilidad humana sobre las solicitudes A2A entrantes (v3.4.0)

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 134-138, R1-R8, RD-63 a RD-67) · [`design.md`](design.md) §1-9 (ADR 139-143) · specs: [`visibilidad-a2a-entrante`](specs/visibilidad-a2a-entrante/spec.md) (nueva, 7 requirements), [`solicitud-a2a-entrante`](specs/solicitud-a2a-entrante/spec.md) (delta, 1 requirement MODIFIED + 1 ADDED).

**No es un Hito numerado del Plan** — los commits usan `(comando-visibilidad-a2a-entrante, tarea N)`.

**Metodología**: TDD estricto (`strict_tdd: true`) en toda tarea con lógica de negocio (1-8). **Tres excepciones explícitas**: tarea 6 (constante pura sin comportamiento propio, ejercitada indirectamente por la tarea 8), tarea 9 (specs ya escritas por `sdd-spec`, se commitean), tarea 10 (documentación), tarea 11 (verificación manual, sin código de producción).

**Entrega ya decidida**: `chain_strategy: stacked-to-main`, **2 PRs encadenados**, cada uno mergea a `main` en orden apenas se aprueba (mismo patrón que `definicion-skills` y `comando-cancelar-solicitud`). El corte de `design.md` §8 (datos+contrato+traducción vs. comando+presentación+auditoría+docs) se respeta **sin ajuste**: a diferencia de `comando-cancelar-solicitud`, este change no tiene ningún acoplamiento de compilación que fuerce mover código entre PRs — el puerto nuevo (`SolicitudA2AEntranteStorePort`) es enteramente aditivo y el único campo nuevo de una interfaz existente (`Deps.solicitudA2AEntranteStore?`) es **opcional**, así que no rompe ningún fake existente al agregarse.

## Los 5 puntos obligatorios, confirmados con tarea propia

| # | Punto | Dónde en `design.md` | Tarea(s) | Por qué no puede quedar implícito |
|---|---|---|---|---|
| 1 | **R4 — `EXPLAIN QUERY PLAN`**, aridad variable (uno y tres estados, no sólo dos) | ADR 140 pto 1-2, §6 filas "EXPLAIN QUERY PLAN" y "aridad variable" | **Tarea 3** | El precedente de `listPropuestasCambio` sólo resolvió la igualdad simple; un `IN` de aridad variable es un caso distinto que el Reviewer de ese hallazgo no cubrió. Sin el test con uno y con tres estados, un `IN` que degrada a `SCAN` con tres elementos pasaría con dos y quedaría sin detectar |
| 2 | **R7 — truncado**, borde exacto 20/21, `hayMas` correcto en ambos casos | ADR 140 pto 5, §6 fila "truncado (R7)" | **Tarea 3** | Sin el borde exacto (20 filas ⇒ `hayMas: false`; 21 filas ⇒ 20 items + `hayMas: true`), un `LIMIT` sin el `+1` es indistinguible de "hay exactamente el límite" y de "hay cientos" — el aviso de truncado mentiría o faltaría |
| 3 | **R1 — rótulo de transporte**, nunca "agente"; `agenteExternoUrl` ausente del tipo (`"agenteExternoUrl" in vista === false`) | ADR 139 pto 3 (estructural), ADR 142 pto 1 (texto) | **Tarea 4** (estructural) + **Tarea 7** (texto de salida) | Es el riesgo de producto del change (Alta prob.). La garantía tiene dos mitades que no pueden quedar la una sin la otra: el tipo no tiene dónde guardar una identidad falsa (tarea 4) **y** el formateador nunca imprime "agente" (tarea 7) — sin las dos, un refactor futuro podría reintroducir la promesa incumplida por cualquiera de los dos lados |
| 4 | **El caso del Hallazgo 2**: fila en `TASK_STATE_WORKING` con `updated_at` viejo aparece **primera** en el listado sin argumento | §6 fila "el caso del Hallazgo 2" | **Tarea 8** (test automatizado) + **Tarea 11** (verificación manual) | Es el escenario que motivó el change completo (`proposal.md` Intent, `evidencia-verificacion-manual.md:128-142`). Un test que sólo verifique "aparece en el listado" sin verificar el **orden** (`updated_at ASC`, ADR 140 pto 4) dejaría pasar un `DESC` invertido — que es precisamente el error que ADR 140 pto 4 corrigió sobre lo que la propia `proposal.md` (RD-63) sugería mal |
| 5 | **R3 — coordinación de orden** con `comando-reporte-comisiones` y `comando-cancelar-solicitud` sobre `DESCRIPTORES`/conteo | `design.md` §7 (tabla de colisión textual) | **Tarea 5** (código) + **Tarea 10** (docs) | Los tres changes tocan el mismo array, el mismo par de comentarios de conteo (`:96-99`, `:248-251`) y el mismo `toHaveLength` de test — mismo patrón ya usado por los otros dos: "el último en mergear rebasa y actualiza el conteo". Sin la nota explícita en la tarea que toca el archivo, el número quedaría hardcodeado contra un estado de `main` que puede haber cambiado entre planificación y ejecución |

## Suggested Work Units

| Unit | Goal | Tasks | Est. líneas | Base branch (`stacked-to-main`) |
|---|---|---|---|---|
| 1 | Datos + contrato + traducción: migración, puerto de núcleo, listado con índice, guard de vocabulario. Capacidad inalcanzable desde la TUI | 1-4 | ~370 | `main` |
| 2 | Comando, presentación, auditoría, docs: descriptor, handler, formateadores, `registrar(...)`, specs, README, ARC42 | 5-11 | ~305 | `main` (con Unit 1 ya mergeada) |

## Tareas

### PR1 — Datos, contrato y traducción (tareas 1-4)

1. [x] **`src/adapters/memory/migrations/0012_idx_solicitudes_a2a_entrantes_estado.ts`** (nuevo) **+ `migrations/index.ts`** (modificado, un `import` + un elemento **al final**) **+ `migrations/0011_solicitudes_a2a_entrantes.ts`** (doc-comment `:36-38` reescrito, **cero SQL tocado**, R2) — molde literal de `0002_idx_sesiones_caso_agente.ts` (ADR 137). Contenido exacto: `CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_estado ON solicitudes_a2a_entrantes(estado);`. Test primero: correr la migración **dos veces** no falla (`IF NOT EXISTS`); el índice aparece en `PRAGMA index_list('solicitudes_a2a_entrantes')` junto al de `caso_id`. Cubre spec `visibilidad-a2a-entrante` requirement "El listado usa índice sobre `estado`..." (infraestructura; el `SEARCH` se verifica en la tarea 3). Comando: `npm test -- repository`. Commit: `feat(adapters/memory): agrega migracion 0012 con indice sobre estado y corrige doc-comment de 0011 (comando-visibilidad-a2a-entrante, tarea 1)`.

2. [x] **`src/core/agents/a2a-entrante-contract.ts`** (★ nuevo, ADR 139/141) — `TASK_STATES_EN_CURSO` (derivado de `TASK_STATES_CONOCIDOS.filter((e) => !esEstadoTerminal(e))`, ADR 135, **sin lista literal**), `LIMITE_LISTADO_A2A_ENTRANTES = 20`, `LINEAS_PAGINA_A2A = 80`, `EstadoSolicitudA2AEntrante` (unión discriminada, ★ el guard de vocabulario del ADR 141), `SolicitudA2AEntranteVista` (**sin** `agenteExternoUrl` ni `id` — R1 estructural, punto 3 de la tabla de arriba), `ListadoSolicitudesA2AEntrantes`, `SolicitudA2AEntranteStorePort`. Importa de `a2a-contract.ts` (core→core, legal), **no lo modifica** (ADR 135 pto 3). Test primero (**PRIMERO de todo el change**, ADR 135): recorre las **ocho** variantes de `TASK_STATES_CONOCIDOS` y afirma que `TASK_STATES_EN_CURSO` es **exactamente** `[SUBMITTED, WORKING]` — `INPUT_REQUIRED`/`AUTH_REQUIRED` **no** están (ADR 73 pto 2). Complemento estático: `grep` de `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING` sobre el archivo nuevo ⇒ **cero** literales fuera de la derivación. Más un test de tipo con `@ts-expect-error`: `esEstadoTerminal(vista.estado.valor)` **no compila** sin discriminar antes por `conocido` — si algún día compila, el test falla. Cubre spec `visibilidad-a2a-entrante` requirements "Sin argumento, lista las solicitudes en curso — el conjunto se DERIVA de `esEstadoTerminal`" (3 escenarios) y "Puerto de lectura nuevo en `src/core/`..." (2 escenarios). Comando: `npm test -- a2a-entrante-contract && npm run typecheck`. Commit: `feat(core): agrega puerto de lectura SolicitudA2AEntranteStorePort en a2a-entrante-contract.ts (comando-visibilidad-a2a-entrante, tarea 2)`.

3. [ ] **`src/adapters/memory/repository.ts`** (modificado, aditivo, ADR 140) — `listSolicitudesA2AEntrantesPorEstado(db, { estados, limite })`, reusando `SOLICITUD_A2A_ENTRANTE_SELECT_COLUMNS` y `rowToSolicitudA2AEntrante` **ya existentes**. Placeholders **nombrados** (`@estado0, @estado1, …`, generados en JS — `better-sqlite3` no permite mezclar nombrados y posicionales en la misma sentencia junto a `@limite`), cláusula armada en JS como pertenencia simple (**nunca** `(@x IS NULL OR estado IN …)`), `estados` vacío ⇒ corte temprano sin tocar la base, `ORDER BY updated_at ASC` (ADR 140 pto 4 — el huérfano tiene el `updated_at` más viejo; `DESC` lo enterraría bajo el `LIMIT`), `LIMIT @limite + 1` con descarte de la última fila ⇒ `{ items, hayMas }`. Depende de la tarea 1 (el índice debe existir para que el plan use `SEARCH`). Test primero — **cinco bloques, todos obligatorios**:
   - ★ **R4 (punto 1 de la tabla)**: `EXPLAIN QUERY PLAN` reporta `SEARCH ... USING INDEX idx_solicitudes_a2a_entrantes_estado` y **ausencia** de `SCAN`, capturando el SQL vía monkeypatch temporal de `db.prepare` (molde literal de `repository.test.ts:3111-3135` — los placeholders son dinámicos, no se puede hardcodear la sentencia), repetido con **uno** y con **tres** estados además del caso de dos — la aridad variable es la mitad de R4 que el precedente de igualdad simple no cubría.
   - `estados: []` ⇒ `{ items: [], hayMas: false }` **y `db.prepare` no se llama** (spy) — `IN ()` es error de sintaxis en SQLite.
   - Ocho filas, una por `TASK_STATE_*` ⇒ salen exactamente `SUBMITTED`/`WORKING`; con `updated_at` desordenados, el resultado sale ascendente (la más vieja primera).
   - ★ **R7 (punto 2 de la tabla)**: 20 filas en curso, `limite: 20` ⇒ `hayMas === false`; **21** filas, `limite: 20` ⇒ 20 items y `hayMas === true` — el borde exacto donde el `+1` se gana el sueldo.
   Cubre spec `visibilidad-a2a-entrante` requirement "El listado usa índice sobre `estado` — `SEARCH`, no `SCAN`" (1 escenario, ampliado con los casos de aridad y truncado no escritos literalmente en la spec pero exigidos por `design.md` §6). Comando: `npm test -- repository`. Commit: `feat(adapters/memory): agrega listSolicitudesA2AEntrantesPorEstado con IN de aridad variable y verificacion EXPLAIN QUERY PLAN (comando-visibilidad-a2a-entrante, tarea 3)`.

4. [ ] **`src/build-on-comando-empleado.ts`** (modificado, porción PR1) — `toPortSolicitudA2AEntrante(row)` (★ donde vive el guard de vocabulario, ADR 141 — `esTaskStateConocido(row.estado)` decide `{conocido:true|false}`, **sin throw**: es un camino de lectura de diagnóstico, no el CAS de escritura de `toPortSolicitud`/`toPortPropuesta`) + `createSolicitudA2AEntranteStore(db)` (molde de `createPropuestaStore`, delega en la tarea 3) + entrada `solicitudA2AEntranteStore?` en `Deps` (**opcional** — sin romper ningún fake existente). Depende de las tareas 2 y 3. Test primero:
   - Fila con `estado: "BASURA"` ⇒ `{ conocido: false, valor: "BASURA" }`, **sin lanzar**. Fila con `TASK_STATE_WORKING` ⇒ `{ conocido: true, valor: "TASK_STATE_WORKING" }`.
   - ★ **R1 estructural (punto 3 de la tabla, mitad de tipo)**: `expect("agenteExternoUrl" in vista).toBe(false)` y `expect("id" in vista).toBe(false)` sobre la vista devuelta — no es una aserción de contenido, es una aserción de **forma**: el campo no existe, así que ningún formateador futuro puede imprimirlo por error.
   - `createSolicitudA2AEntranteStore(db).listarPorEstados(...)` y `.obtenerPorTaskId(...)` sobre SQLite real, ida y vuelta con la tarea 3, sin ninguna dependencia de `better-sqlite3` cuando se testea con un doble plano del puerto.
   Cubre spec `visibilidad-a2a-entrante` requirements "Puerto de lectura nuevo... El puerto es inyectable y testeable sin base de datos" y la mitad estructural de "`origen_transporte` se rotula... — límite honesto, no identidad" (escenario "`agente_externo_url` NULL no se sustituye..."). Comando: `npm test -- build-on-comando-empleado && npm run typecheck`. Commit: `feat(root): agrega toPortSolicitudA2AEntrante y createSolicitudA2AEntranteStore (comando-visibilidad-a2a-entrante, tarea 4)`.

**Verificación de cierre de PR1**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/core/agents/a2a-contract.ts` **vacío** (ADR 135 pto 3, R6); `git diff --stat main -- src/build-on-a2a-entrante.ts src/adapters/a2a/server.ts` **vacío** (camino de escritura del Hito 7 intacto); la capacidad es **inalcanzable desde la TUI** — verificable con `rg 'ver_solicitudes_a2a' src/core/commands/comando-empleado.ts` sin resultados, `parsearComando` todavía no produce ese tipo. **Cero exposición al usuario ⇒ cero riesgo de R1 en este PR**, aunque el guard estructural (tarea 4) ya esté puesto — es la frontera dura que `design.md` §8 fija explícitamente para el ADR 141.

### PR2 — Comando, presentación, auditoría y documentación (tareas 5-11)

5. [ ] **`src/core/commands/comando-empleado.ts`** (modificado, ADR 56/138) — brazo `{ tipo: "ver_solicitudes_a2a"; readonly a2aTaskId?: string }` en `ComandoEmpleado`; `Forma` de **cinco a seis** miembros con `"id_opcional_a2a_task"` (precisado desde el `"id_opcional_a2a"` de `proposal.md`, ver `design.md` §3); descriptor `/ver-solicitudes-a2a [a2aTaskId]` en `DESCRIPTORES` (antes de `/ayuda`), `privilegiado: true`, `secreto: false`; cuarta rama `id_opcional*` en `parsearComando`, copia literal de la de `id_opcional_propuesta` con la clave cambiada — **sin imports, sin cast**. ★ **R3 (punto 5 de la tabla)**: los **dos** comentarios de conteo (`:96-99`, `:248-251`) se actualizan **coordinando el número real con el estado de `main`** al momento de este commit — `comando-reporte-comisiones` y `comando-cancelar-solicitud` tocan el mismo hunk; el último de los tres en mergear deja el conteo en 18. Test primero: `/ver-solicitudes-a2a X` ⇒ `{tipo, a2aTaskId:"X"}`; sin id ⇒ `{tipo}`; `esComandoPrivilegiado("ver_solicitudes_a2a") === true`; `Forma` tiene **seis** miembros; `DESCRIPTORES`/`COMANDOS` cuenta actualizada (`comando-empleado.test.ts:369,435` — `toHaveLength`). Cubre spec `visibilidad-a2a-entrante` requirement "Descriptor `/ver-solicitudes-a2a [a2aTaskId]`, forma `id_opcional_a2a`, privilegiado" (3 escenarios). Comando: `npm test -- comando-empleado`. Commit: `feat(core): agrega descriptor /ver-solicitudes-a2a con forma id_opcional_a2a_task (comando-visibilidad-a2a-entrante, tarea 5)`.

6. [ ] **`src/core/commands/registro-acciones-contract.ts`** (modificado, ADR 143) — `COMANDO_VER_SOLICITUDES_A2A = "/ver-solicitudes-a2a"`, molde literal de las trece constantes existentes. **Cero `RESULTADO_*` nuevos** — reusa `RESULTADO_ATENDIDA`/`RESULTADO_NO_APLICABLE`. TDD exception (constante pura, sin comportamiento propio) — ejercitada indirectamente por la tarea 8. Commit: `feat(core): agrega COMANDO_VER_SOLICITUDES_A2A (comando-visibilidad-a2a-entrante, tarea 6)`.

7. [ ] **`src/build-on-comando-empleado.ts`** (modificado, porción formateadores, ADR 142) — `formatearListadoSolicitudesA2A(listado)` (una línea por fila: `a2aTaskId`, `estado`, **`origen de transporte`**, `createdAt`/`updatedAt`; vacío ⇒ `"No hay solicitudes A2A entrantes en curso."`; `hayMas === true` ⇒ nota de truncado, molde de `:1094-1097`) + `formatearDetalleSolicitudA2A(vista)` (resumen + `mensajeRecibido`/`resultado` paginados a `LINEAS_PAGINA_A2A`, molde de `formatearResumenPropuesta:1090-1099`; `resultado` ausente ⇒ sección **omitida**, no vacía). Depende de la tarea 4 (usa `SolicitudA2AEntranteVista`). Test primero:
   - ★ **R1, mitad de texto (punto 3 de la tabla)**: el `responseText` de los **dos** formateadores **no contiene** la palabra `"agente"` como rótulo de origen, **sí contiene** `"origen de transporte"` — sobre una vista con `origenTransporte` poblado (todas las filas reales, dado que `agenteExternoUrl` ni siquiera existe en el tipo desde la tarea 4).
   - Paginado (R8): `resultado` de `LINEAS_PAGINA_A2A + 15` líneas ⇒ primera página + nota `…de N líneas…`; la línea `LINEAS_PAGINA_A2A + 1` no aparece.
   - `resultado` ausente ⇒ la sección no aparece en el texto (no imprime vacía ni `"undefined"`).
   Cubre spec `visibilidad-a2a-entrante` requirements "`origen_transporte` se rotula como origen de transporte, nunca como 'agente'" (2 escenarios) y la mitad de presentación de "Con `a2aTaskId`, muestra el detalle o 'no existe'" (escenario "Un id existente muestra su detalle completo"). Comando: `npm test -- build-on-comando-empleado`. Commit: `feat(root): agrega formateadores de listado y detalle de solicitudes A2A entrantes (comando-visibilidad-a2a-entrante, tarea 7)`.

8. [ ] **`src/build-on-comando-empleado.ts`** (modificado, porción handler + `case`, ADR 134/143) — `manejarVerSolicitudesA2A` (molde **literal** de `manejarVerPropuesta:1113-1128`: **un solo paso, síncrono, sin `await`, sin `createCaso`, sin `confirmacionPendiente`**) + `registrar(...)` (ADR 143, **revertido por el checkpoint**: `RESULTADO_ATENDIDA` en listado y en detalle encontrado, `RESULTADO_NO_APLICABLE` con id inexistente, `casoId` sólo en modo detalle) + `case "ver_solicitudes_a2a"` en el `switch (comando.tipo)`, junto a `ver_propuesta`. Depende de las tareas 4, 5, 6 y 7. Test primero:
   - **Sin argumento**, `TASK_STATES_EN_CURSO` filtra correctamente a nivel handler (end-to-end sobre SQLite real, complementa la tarea 3 a nivel unidad).
   - ★ **El caso del Hallazgo 2 (punto 4 de la tabla, OBLIGATORIO)**: una fila en `TASK_STATE_WORKING` con `updated_at` **viejo** (simulando una sesión anterior terminada) aparece **primera** en el listado sin argumento — verificando no sólo presencia sino **orden** (`updated_at ASC`, ADR 140 pto 4).
   - Auditoría (ADR 143): listado exitoso ⇒ **una** fila `/ver-solicitudes-a2a`/`atendida` **sin** `casoId`; detalle encontrado ⇒ `atendida` **con** `casoId`; id inexistente ⇒ `no_aplicable`; sin sesión ⇒ **cero** filas (corta en la guarda de privilegio, antes del handler).
   - Lo que **no** hace (ADR 134): `casos` y `delegaciones_a2a` no ganan filas; `confirmacionPendiente` sigue `undefined` después de los dos modos; el handler **no es** `async` (inspección de firma).
   - Id inexistente ⇒ `"No existe ninguna solicitud A2A <id>."` sin throw.
   Cubre spec `visibilidad-a2a-entrante` requirements "Sin argumento, lista..." (extremo end-to-end), "Con `a2aTaskId`, muestra el detalle o 'no existe'" (2 escenarios), "Sin confirmación en dos pasos" (2 escenarios), "Fila de auditoría en `registro_acciones_empleado`" (2 escenarios); spec `solicitud-a2a-entrante` delta ADDED requirement "Una fila huérfana en `WORKING` es observable por un humano" (2 escenarios, incluido "el mecanismo de lectura nunca escribe"). Comando: `npm test -- build-on-comando-empleado && npm run typecheck`. Commit: `feat(root): cablea manejarVerSolicitudesA2A al dispatcher con auditoria y verifica el caso del hallazgo 2 (comando-visibilidad-a2a-entrante, tarea 8)`.

9. [ ] **`openspec/changes/comando-visibilidad-a2a-entrante/specs/visibilidad-a2a-entrante/spec.md`** (nueva) **+ `specs/solicitud-a2a-entrante/spec.md`** (delta) — ya escritas por `sdd-spec`, no llevan implementación propia. Se commitean junto al resto del PR2 verificando consistencia final contra el código de las tareas 1-8: el delta **acota sin derogar** el requirement `:29-41` (confirmar `git diff --stat main -- src/core/` sólo muestra el archivo nuevo de la tarea 2) y **complementa** `:45` sin editarlo (confirmar que el requirement original sigue citado, no modificado). TDD exception (specs, no código). Commit: `docs(specs): agrega visibilidad-a2a-entrante y delta de solicitud-a2a-entrante (comando-visibilidad-a2a-entrante, tarea 9)`.

10. [ ] **`README.md`** **+ `docs/ARC42_Harness_Empresarial.md`** (modificados) — TDD exception (documentación) — documentan `/ver-solicitudes-a2a [a2aTaskId]` en el Registro de Comandos y en el flujo A2A entrante: los dos modos, `privilegiado: true`, el límite honesto de `origen_transporte` (R1), y que el remedio activo sobre el huérfano (cancelar/barrido) queda fuera de alcance. ★ **R3 (punto 5 de la tabla)**: el conteo de la Caja Blanca del Registro de Comandos se coordina con el estado real de `comando-reporte-comisiones`/`comando-cancelar-solicitud` en `main` al momento de este commit — mismo criterio que la tarea 5. Commit: `docs: documenta /ver-solicitudes-a2a en README y arc42 (comando-visibilidad-a2a-entrante, tarea 10)`.

11. [ ] **Verificación manual del entregable** — TDD exception (sin código de producción). Cubre, como mínimo:
   - ★ **El caso del Hallazgo 2 (punto 4 de la tabla, cierre)**: reproducir el escenario documentado en `evidencia-verificacion-manual.md:128-142` — una fila `TASK_STATE_WORKING` que quedó huérfana (proceso terminado por `taskkill /F`) — y confirmar con `/ver-solicitudes-a2a` que aparece, primera, en el listado sin argumento, consultando además `data/harness.db` directamente para corroborar `updated_at`.
   - `/ver-solicitudes-a2a` sobre una fila `COMPLETED` real ⇒ el `responseText` **nunca** dice "agente", siempre "origen de transporte" (R1).
   - `/ver-solicitudes-a2a no-existe` ⇒ mensaje explicativo, sin throw, fila `no_aplicable` en `registro_acciones_empleado`.
   - `git diff --stat main -- src/core/agents/a2a-contract.ts src/build-on-a2a-entrante.ts src/adapters/a2a/server.ts` vacío; `build-on-a2a-entrante.test.ts`/`a2a-server.integration.test` verdes **sin modificarse**.
   - Rollback del commit de la tarea 8 ⇒ `parsearComando("/ver-solicitudes-a2a …")` vuelve a caer en `ayudaDesconocido`, los demás comandos se comportan byte por byte igual.
   - `npm test`/`npm run typecheck` en verde.
   Evidencia en `docs/progreso/v3.4-comando-visibilidad-a2a-entrante/`. Commit: `docs: evidencia de verificacion manual del entregable ver-solicitudes-a2a (comando-visibilidad-a2a-entrante, tarea 11)`.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~675 (`design.md` §8, prod+test+docs+spec) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (~370, tareas 1-4) → PR2 (~305, tareas 5-11) |
| Delivery strategy | Ya resuelta por el checkpoint — 2 PRs encadenados |
| Chain strategy | **`stacked-to-main`** — decisión ya tomada, cada PR mergea a `main` en orden |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Reconciliación con `design.md` §8 — **sin ajuste, a diferencia de `comando-cancelar-solicitud`**

| Archivo | Tareas | Líneas est. (impl+test) |
|---|---|---|
| `0012_*.ts` · `migrations/index.ts` · `0011` (doc-comment) | 1 | ~46 |
| `a2a-entrante-contract.ts` (puerto, vista, unión de estado, derivación, constantes) | 2 | ~127 |
| `repository.ts` (`listSolicitudesA2AEntrantesPorEstado`) | 3 | ~135 |
| `build-on-comando-empleado.ts`, porción PR1 (`toPort…`, store, `Deps`) | 4 | ~62 |
| **Subtotal PR1** | 1-4 | **~370** |
| `comando-empleado.ts` (descriptor, brazo, `Forma`, rama de parser, 2 conteos) | 5 | ~62 |
| `registro-acciones-contract.ts` | 6 | ~7 |
| `build-on-comando-empleado.ts`, porción PR2 (2 formateadores, handler, `registrar`, `case`) | 7, 8 | ~141 |
| `specs/` (capability nueva + delta) | 9 | ~70 |
| `README.md` + `docs/ARC42_*.md` | 10 | ~25 |
| **Subtotal PR2** | 5-11 | **~305** |
| **Total** | | **~675** — igual al total de `design.md` §8 |

**Por qué no hizo falta el mismo tipo de ajuste que `comando-cancelar-solicitud`**: ese change tuvo que mover ~30 líneas de PR2 a PR1 porque `createSolicitudStore` tenía retorno **anotado** (`: SolicitudStorePort`) y un fake **no-`Partial`** en un test existente, así que ampliar la interfaz sin implementar el método en el mismo commit rompía `npm run typecheck` de inmediato. Acá `SolicitudA2AEntranteStorePort` es una interfaz **enteramente nueva** (no se amplía ninguna existente) y el único campo nuevo de una interfaz preexistente (`Deps.solicitudA2AEntranteStore?`) es **opcional** — ningún fake de `Deps` en los tests actuales deja de compilar por su sola presencia. El corte de `design.md` §8 es, por lo tanto, directamente ejecutable tarea por tarea sin mover código entre PRs.

## Después de la tarea 11

- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este documento, las 2 specs y `design.md`, con atención especial a: **el guard de vocabulario del ADR 141 sin throw** (tarea 4 — es la desviación deliberada del molde `toPortSolicitud`/`toPortPropuesta`, hay que verificar que la justificación siga siendo "camino de lectura, no CAS de escritura"), **el orden `updated_at ASC`** (tarea 3/8 — es donde `design.md` corrigió a la propia `proposal.md`), y **R1 en sus dos mitades** (estructural en tarea 4, texto en tarea 7 — ninguna de las dos sola es suficiente).
- Antes de mergear PR1: confirmar con `comando-reporte-comisiones` y `comando-cancelar-solicitud` el orden de merge (R3) — el último en mergear rebasa el conteo de descriptores en las tareas 5 y 10.
- Si aprueba: checklist de cierre de `AGENTS.md` (Reviewer aprobado, `docs/progreso/v3.4-comando-visibilidad-a2a-entrante/` completo con la demostración del Hallazgo 2), tag `v3.4.0` (numeración a confirmar por el checkpoint, depende de que `v3.1.0`/`v3.2.0`/`v3.3.0` cierren en ese orden).

---

**Nota de formato**: mismo criterio que `definicion-skills/tasks.md`, `comando-reporte-comisiones/tasks.md` y `comando-cancelar-solicitud/tasks.md` — se sigue el formato extenso ya establecido por `proposal.md`, las 2 `specs/` y `design.md` de este mismo change, en vez del tope de 530 palabras de la skill `sdd-tasks`.
