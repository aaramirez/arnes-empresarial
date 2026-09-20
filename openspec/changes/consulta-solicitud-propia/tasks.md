> **Nota de proceso**: fase `sdd-tasks` ejecutada sin shell (`Read`/`Grep`/`Glob`/`Write`), así que **no pudo correrse `graphify query`** pese al hook del repo (misma nota que `proposal.md` y `design.md`); recomendado `graphify update .` después de `sdd-apply`. **Reverificado por `Read`/`Grep` en esta fase**: `validar-operacion.ts` con **cuatro** tablas (`CAMPOS_POR_OPERACION` `:25`, `_REQUERIDOS_` `:48`, `_NUMERICOS_` `:86`, `VALORES_PERMITIDOS_` `:114`; `consultar_venta` está en `:44`/`:58`/`:96` y **no** en la cuarta) y "seis claves" en `:152`; `operaciones-contract.ts` "SEIS"/"seis" en `:9` y `:39`; `operaciones-contract.test.ts:54-67` (`toEqual` de 10 + `toHaveLength(10)`); `ejecutar-operacion.ts` `case OPERACION_CONSULTAR_VENTA` `:991`, `default` con `const _exhaustivo: never` `:994-997`, `consultaVentaPropia` requerido `:118`, única `solicitanteId` en el archivo = asignación `:959`; `ejecutar-operacion.test.ts` `makeDeps` `:272-283` (`makeRolPort` con default administrador `:249-250`) y molde del test mecánico `:1389-1395`; `build-on-comando-empleado.ts:362-368` (array privado), `:380` (`SolicitudTipoEstadoInvalidoError`), `:394-401` (`toPortSolicitud`); `solicitudes-contract.ts:41-50`; `repository.ts` (`SolicitudInternaSqlRow` `:2118`, `SOLICITUD_SELECT_COLUMNS` `:2133`, `rowToSolicitud` `:2136`, `listSolicitudesInternas` `:2273`) y `repository.test.ts` (describe de `VENTA_PROPIA_SELECT_COLUMNS` `:893`, imports `aprobarSolicitudInterna`/`cancelarSolicitudInterna` `:26`/`:31`); `build-on-operaciones-empleado.ts` (`toPortVentaPropia` `:123`, closure `:187-193`, `ejecutarDeps` `:201`) y su test (`:431-517`); `adapters/operaciones/index.ts` (`OPERACIONES_TOOL_ZOD_SCHEMA` `:98`, `OPERACIONES_TOOL_DESCRIPTION` `:114`) y `index.test.ts:304-328`; `README.md:328`, `ARC42:611`; última migración `0014`, **`0015` libre**; ningún test enumera skills por nombre. **Falso positivo a NO tocar**: `ejecutar-operacion.ts:572` ("SEIS ramas de `ResolverEscalacionResult`") no cuenta operaciones.
>
> **Formato de commit**: `<tipo>(<scope>): <descripcion> (consulta-solicitud-propia, tarea N)`. Diverge de `openspec/config.yaml` (`(Hito X.Y, tarea N)`) en un punto: este change **no es un hito numerado del Plan**, mismo criterio que `ergonomia-canal-empleado`, `devolucion-sin-token-dos-personas` y `conocimiento-chat-empleado`. `N` es el id jerárquico de la tarea. Scope `root` para `src/build-on-*.ts` (precedente de v3.13 y `chat-web-empleado`). **Formato extenso**, no el tope de 530 palabras de la skill: mismo criterio que el resto de la serie.

# Tasks: `consultar_solicitud` — el solicitante ve el estado y el desenlace de SU solicitud interna desde el chat

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 237-239, R1-R5) · [`design.md`](design.md) (§0.1-0.6, §3-§7 con RD-114/115, §9, §12-§14, R6-R11) · specs: [`consulta-solicitud-empleado`](specs/consulta-solicitud-empleado/spec.md) (nueva, 9 requirements) y [`herramienta-operaciones-negocio`](specs/herramienta-operaciones-negocio/spec.md) (delta: 1 ADDED + 3 MODIFIED + Purpose).

**Rama**: `hito/v3.14-consulta-solicitud-propia`, creada por el humano **después** del checkpoint y **desde `main` tras el merge y tag de v3.12 y el merge de v3.13** (R2, bloqueante duro). Tag previsto `v3.14.0`. Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md). **No es hito completo hasta la tarea 7.2**: cada commit propuesto lleva *"No es hito completo — faltan las tareas [...]"*. Las ramas por slice dependen de `chain_strategy` (ver Forecast); **los mensajes de commit son idénticos en las dos estrategias**.

**Metodología**: TDD estricto (`strict_tdd: true`). Cada capa con lógica: **commit ROJO** (`test`) → **commit VERDE** (`feat`), separados. **Excepciones explícitas**: 1.1 (refactor que preserva comportamiento: el test que fija el array se escribe primero, en el mismo commit, ver la nota de la tarea), 5.7 y 7.1 (verificación manual), 6.1 (skill: contenido conversacional, sin lógica ejecutable) y 6.2 (docs). **El rojo se declara SIEMPRE con `npm test` Y `npm run typecheck`**, y la salida va pegada en el cuerpo del commit rojo (§13.1 del diseño). El de la PR #1 es **de TIPO** (no compila); el de la PR #2 es **de ASERCIÓN** (`toHaveLength(10)`).

**Decisiones ya cerradas, no se reabren**: ADR 237-239, RD-114, RD-115. Las dos decisiones **asumidas — pendientes de checkpoint** (`dictamen` SÍ, `resueltaPor` SÍ como id) **se implementan como están**; el mapa de qué tareas se editan si el checkpoint las cambia está al final.

**Fuera de alcance, sin tarea**: `SolicitudStorePort`, `listarSolicitudesPendientes`, `listSolicitudesInternas`, `cancelar_solicitud_interna`, migraciones, `src/main.ts`, `src/adapters/web/**`, prompts (`definitions.ts`, `soporte-prompt.ts`), `registro-acciones-contract.ts`, `src/core/auth/**`, `package.json`, las skills `cancelar-solicitud`/`solicitud-interna`/`resolver-solicitud`.

---

## Gate G0 — Precondiciones (sin commit; el Implementer las confirma antes de la tarea 1.1)

- [ ] **v3.12 mergeado a `main` y tageado `v3.12.0`** (R2, bloqueante duro) y **`conocimiento-chat-empleado` (v3.13) mergeado** (orden recomendado por el checkpoint; toca `build-on-operaciones-empleado.ts`, su test y `main.ts`). Tras v3.13 los números de línea de `build-on-operaciones-empleado.*` de esta lista **se corrieron**: re-`Grep` de `toPortVentaPropia`/`ejecutarDeps` antes de 5.3-5.4, y `makeBaseDeps` ya trae `createKnowledge`.
- [ ] **Checkpoint humano aprobó** spec + diseño + tareas, **incluida la alineación spec↔diseño** de la sección "Bloqueante" (abajo). Sin eso, no se abre la rama.
- [ ] Línea base verde: `npm test`, `npm run typecheck`, `npm run build` (limpiar `dist/` antes: `vitest` duplica el conteo con `dist/` stale, ver memoria del repo). `Glob` de `src/adapters/memory/migrations/`: última `0014`.
- [ ] **Decisión de entrega** tomada por el humano (Review Workload Guard): `delivery_strategy` y `chain_strategy`. Ver Forecast.

---

# SLICE 1 — PR #1: lectura (núcleo + SQL). No cambia nada observable desde el chat

**Start**: rama del slice 1 creada desde la base que fije `chain_strategy`, con G0 cumplido. **Finish**: commit de 3.2 + verificación de cierre. **Rollback**: `git revert` del slice ⇒ el puerto desaparece sin consumidor; nada se degrada. **1.1 es auto-contenido y puede quedarse** si se revierte el resto (mejora el tipo por su cuenta).

## Fase 1 — Vocabulario compartido, AISLADO (R9, RD-114 pto 1)

**1.1** [ ] **Promover `SOLICITUD_ESTADOS` al contrato del núcleo — su propia tarea y su propio commit, el primero de la PR #1** (`design.md` §14 pto 3, R9). *Test-first, refactor sin cambio de comportamiento.* Archivos: `src/core/solicitudes/solicitudes-contract.ts` (reemplaza la unión manual de `:46-50` por `export const SOLICITUD_ESTADOS = [SOLICITUD_ESTADO_PENDIENTE, …APROBADA, …RECHAZADA, …CANCELADA] as const` + `export type SolicitudEstado = (typeof SOLICITUD_ESTADOS)[number]`); `src/core/solicitudes/solicitudes-contract.test.ts` (test que fija el array: `toEqual` de los cuatro literales en ese orden, y cada uno asignable a `SolicitudEstado`); `src/build-on-comando-empleado.ts` (borra `:362-368`, agrega `SOLICITUD_ESTADOS` al import existente de `solicitudes-contract`; **cero otros cambios**). ~24 líneas. **Excepción declarada a "rojo separado del verde"**: el diseño exige que este commit sea auto-contenido y revertible por separado; el test se escribe primero y su rojo (import inexistente) se pega en el cuerpo del commit, pero test y movimiento viajan juntos. La red de seguridad del comportamiento son los tests vigentes de `toPortSolicitud` (`build-on-comando-empleado.test.ts`, p. ej. `:1834`), que **no se editan**.
**Aceptación**: `npm test -- solicitudes-contract build-on-comando-empleado` y `npm run typecheck` en verde; `git diff main -- src/build-on-comando-empleado.ts` = sólo la baja de `:362-368` y un símbolo más en el import; `git diff main -- src/core/solicitudes/solicitudes-contract.ts` = **sólo** el bloque `:41-50` (ningún hunk dentro de `SolicitudStorePort`). *Si el checkpoint elige el plan B (exportar el array donde está)*: esta tarea se reduce a la palabra `export` y el test 5.3 cubre el vocabulario.
Commit: `refactor(core): promueve SOLICITUD_ESTADOS al contrato del nucleo y deriva SolicitudEstado del array (consulta-solicitud-propia, tarea 1.1)` → *No es hito completo — faltan las tareas 2.1-7.2.*

## Fase 2 — ROJO de TIPO → VERDE: contrato y núcleo puro

**2.1** [ ] ★ **ROJO #1 (de TIPO) — `src/core/solicitudes/consulta-solicitud-propia-contract.test.ts` (nuevo).** *Test-first.* ~45 líneas, molde `src/core/ventas/consulta-venta-contract.test.ts:45-46`: (a) un literal `SolicitudPropia` con **los once campos** y `Object.keys(...).sort()` `toEqual` los once esperados (`solicitudId, solicitanteId, casoId, tipo, detalle, estado, dictamen, dictaminadaAt, resueltaPor, resueltaAt, createdAt`), más un `// @ts-expect-error` sobre un literal con `updatedAt` (garantía **estructural**, ADR 239); (b) `LIMITE_LISTADO_SOLICITUDES_PROPIAS` es `20` (**este test es lo que mantiene honesto el `?? 20` duplicado del adaptador**, RD-114 pto 3 / §0.4); (c) un doble en memoria que implementa `ConsultaSolicitudPropiaPort` compila con las dos firmas exactas (`buscarPorId(id)`, `listarDeSolicitante({solicitanteId, limite?})`).
**Aceptación (rojo declarado con los dos comandos)**: `npm run typecheck` **falla** (`SolicitudPropia`/`ConsultaSolicitudPropiaPort`/`LIMITE_…` no existen) y `npm test -- consulta-solicitud-propia-contract` falla (módulo inexistente). Pegar ambas salidas en el cuerpo.
Commit: `test(core): exige SolicitudPropia de once campos sin updatedAt y ConsultaSolicitudPropiaPort (consulta-solicitud-propia, tarea 2.1)` → *No es hito completo — faltan las tareas 2.2-7.2.*

**2.2** [ ] **VERDE — `src/core/solicitudes/consulta-solicitud-propia-contract.ts` (nuevo, ADR 237/239).** ~55 líneas, contrato **literal de `design.md` §8**: `LIMITE_LISTADO_SOLICITUDES_PROPIAS = 20` (con el doc-comment de la asimetría declarativa), `SolicitudPropia` (once campos), `ConsultaSolicitudPropiaPort`. **Importa SÓLO** `type { SolicitudEstado, SolicitudTipo } from "./solicitudes-contract.js"`.
**Aceptación**: 2.1 en verde; `npm run typecheck` verde; `rg "from " src/core/solicitudes/consulta-solicitud-propia-contract.ts` = un único import, `./solicitudes-contract.js`.
Commit: `feat(core): agrega SolicitudPropia y ConsultaSolicitudPropiaPort, puerto de lectura aparte de SolicitudStorePort (consulta-solicitud-propia, tarea 2.2)` → *No es hito completo — faltan las tareas 2.3-7.2.*

**2.3** [ ] ★ **ROJO — `src/core/solicitudes/consultar-solicitud-propia.test.ts` (nuevo).** *Test-first.* ~130 líneas, molde `consultar-venta-propia.test.ts`, doble en memoria del puerto con `vi.fn()`, **sin BD**: (i) sin id ⇒ `{resultado:"listado", items}` y `listarDeSolicitante` recibe `{ solicitanteId: empleadoId }` **sin `limite`**; (ii) `buscarPorId → undefined` ⇒ `no_encontrada`; (iii) `solicitanteId ≠ empleadoId` ⇒ `no_autorizada`; (iv) coincide ⇒ `detalle`, **para cada uno de los cuatro estados**; (v) ★★ **ajena ≠ no encontrada** (ADR 238): `toEqual` **exacto** `{resultado:"no_autorizada", solicitudId}` — ningún `tipo`/`detalle`/`estado`/`dictamen`/`solicitanteId`/`resueltaPor` en el resultado; (vi) ★ **test mecánico sobre la fuente** (`readFileSync` + `import.meta.url`, molde `ejecutar-operacion.test.ts:1389-1395`): el módulo no contiene `StorePort`, `registrarAccion`, `aprobar`, `rechazar`, `cancelar`, ni `async`/`await`, y su **único** `from` es `./consulta-solicitud-propia-contract.js` (ni `adapters/`). **Los identificadores prohibidos se buscan sobre la fuente SIN comentarios** (o el módulo evita esas palabras en su doc): si no, un doc-comment inocente rompe el test.
**Aceptación (rojo)**: `npm test -- consultar-solicitud-propia` falla en todos los `it` (módulo inexistente) y `npm run typecheck` falla por el mismo motivo. Pegar ambas salidas.
Commit: `test(core): exige las cuatro ramas de consultarSolicitudPropia, ajena distinguible de inexistente y cero escrituras (consulta-solicitud-propia, tarea 2.3)` → *No es hito completo — faltan las tareas 2.4-7.2.*

**2.4** [ ] **VERDE — `src/core/solicitudes/consultar-solicitud-propia.ts` (nuevo, ADR 238).** ~55 líneas: `ConsultarSolicitudPropiaDeps { consulta }`, `ConsultarSolicitudPropiaResult` (cuatro ramas) y `consultarSolicitudPropia(input, deps)` con el gate de **tres líneas de `design.md` §4 pto 2**. **Puro y síncrono**, cero escrituras, cero importación de puertos de escritura. Refactor mínimo dentro del mismo commit sólo si hay duplicación real.
**Aceptación**: 2.3 en verde; `npm test` y `npm run typecheck` verdes (todo el núcleo compila: el puerto aún no tiene consumidor).
Commit: `feat(core): agrega consultarSolicitudPropia, puro y con el gate de propiedad en el nucleo (consulta-solicitud-propia, tarea 2.4)` → *No es hito completo — faltan las tareas 3.1-7.2.*

> **Sub-corte opcional 1A | 1B**: hasta acá (tareas 1.1-2.4, ~309 líneas) el núcleo es **independiente del SQL** (`repository.ts` no importa `src/core/*`). Ver Forecast.

## Fase 3 — Adaptador SQLite (BD en memoria)

**3.1** [ ] ★ **ROJO — `src/adapters/memory/repository.test.ts` (extiende).** *Test-first.* ~90 líneas, nuevo `describe`, junto al de `VENTA_PROPIA_SELECT_COLUMNS` (`:893`), con `openDatabase(":memory:")` y las funciones reales ya importadas en el archivo (`crearSolicitudConCaso`, `aprobarSolicitudInterna`, `rechazarSolicitudInterna`, `cancelarSolicitudInterna`): (i) ★★ `SOLICITUD_PROPIA_SELECT_COLUMNS` **no contiene `updated_at`**, **no contiene `*`** y es **exactamente** el conjunto de las once columnas (test 5 del diseño, el que le da sentido a excluir `updated_at`); (ii) las **sentencias** tampoco usan `SELECT *`: espiar `db.prepare` (`vi.spyOn`) al llamar los dos lectores y asertar sobre el SQL capturado; **si el adaptador no prepara inline, fallback**: `readFileSync` de `repository.ts` y regex `/SELECT\s+\*/i` sobre el tramo entre `export function buscarSolicitudPropiaPorId` y la siguiente `export`; (iii) los **cuatro estados** se leen (una creada, tres resueltas por los caminos reales) con `dictamen`, `resueltaPor`, `resueltaAt` mapeados y **sin `updatedAt`** en la fila devuelta; (iv) orden `created_at DESC`, tope **20 aplicado DESPUÉS del filtro** (25 propias + 30 ajenas más recientes ⇒ exactamente 20, todas propias), vacío ⇒ `[]`; (v) `buscarSolicitudPropiaPorId` **encuentra una AJENA** (no filtra por dueño) y devuelve `undefined` si no existe; (vi) **las dos vistas coexisten** (spec "no cambian"): con una pendiente y una aprobada del mismo solicitante, `listSolicitudesInternas` sigue devolviendo **sólo** la pendiente y `listSolicitudesPropiasDeSolicitante` devuelve ambas.
**Aceptación (rojo)**: los nuevos `it` fallan (símbolos inexistentes) y `npm run typecheck` falla; los tests vigentes del archivo siguen verdes. Pegar ambas salidas.
Commit: `test(adapters/memory): exige lista blanca sin updated_at y lectores de solicitudes propias en los cuatro estados (consulta-solicitud-propia, tarea 3.1)` → *No es hito completo — faltan las tareas 3.2-7.2.*

**3.2** [ ] **VERDE — `src/adapters/memory/repository.ts` (modifica, ADR 239, RD-114 ptos 3-4).** ~70 líneas, **sin importar NADA de `src/core/*`** (el `20` y los nombres van literales): `SOLICITUD_PROPIA_SELECT_COLUMNS` (las once, con el doc-comment restrictivo de `VENTA_PROPIA_SELECT_COLUMNS`), `type SolicitudPropiaSqlRow = Omit<SolicitudInternaSqlRow, "updated_at">`, `interface SolicitudPropiaRow` (camelCase, once campos, `tipo`/`estado` como `string`), `rowToSolicitudPropia` propia (**no reusa `rowToSolicitud`**), `buscarSolicitudPropiaPorId(db, id)` y `listSolicitudesPropiasDeSolicitante(db, {solicitanteId, limite?})`: **una sola sentencia preparada y estática** (`WHERE solicitante_id = @solicitanteId ORDER BY created_at DESC LIMIT @limite`, `limite ?? 20`; **sin filtro por `estados`**). Doc-comment del lector: orden `DESC` **opuesto** al de `listSolicitudesInternas` **a propósito** (historial vs cola de trabajo) y `20` duplicado por la regla hexagonal. **`listSolicitudesInternas` no se toca.**
**Aceptación**: 3.1 en verde; `npm test` y `npm run typecheck` verdes; `git diff main -- src/adapters/memory/repository.ts | rg "^-[^-]"` **vacío** (cero líneas borradas: sólo adiciones) y `rg "^\+.*from " ` sobre ese diff **vacío** (cero imports nuevos).
Commit: `feat(adapters/memory): agrega SOLICITUD_PROPIA_SELECT_COLUMNS y los lectores de solicitudes propias sin filtro de estado (consulta-solicitud-propia, tarea 3.2)` → *No es hito completo — faltan las tareas 4.1-7.2.*

### Verificación de cierre de Slice 1 (sin commit)

`npm test`, `npm run typecheck` y `npm run build` en verde · rojo #1 **de tipo** evidenciado en el cuerpo del commit 2.1 · guardas `git diff main`: **cero** archivos en `src/adapters/memory/migrations/`; **`SolicitudStorePort` intacto** (ningún hunk en `solicitudes-contract.ts` fuera de `:41-50`); `listSolicitudesInternas`/`listarSolicitudesPendientes` sin cambios; **cero** cambios en `src/core/operaciones/`, `src/core/auth/`, `src/main.ts`, `package.json`; hexagonal: `rg "adapters/" src/core/solicitudes/` sin coincidencias y `repository.ts` sin imports nuevos.

---

# SLICE 2 — PR #2: superficie (la operación 11 se enciende)

**Start**: PR #1 mergeada/base disponible (la #2 consume `ConsultaSolicitudPropiaPort` y los dos lectores de la #1). **Finish**: commit de 7.1 + tarea 7.2. **Rollback**: `git revert` ⇒ vuelve a **diez** operaciones y el puerto queda huérfano pero inerte; **orden inverso obligatorio** si ya salió un hermano de la serie (`OPERACIONES_NEGOCIO` es una sola lista `as const`; revertir con doce mergeado no compila).

## Fase 4 — ROJO de ASERCIÓN → VERDE: contrato de la operación y validación

**4.1** [ ] ★ **ROJO #2 (de ASERCIÓN) — `src/core/operaciones/operaciones-contract.test.ts` + `src/core/operaciones/validar-operacion.test.ts`.** *Test-first.* ~50 líneas. **Contrato**: invertir `:54-67` — título *"enumera ONCE operaciones"*, `toEqual` con `OPERACION_CONSULTAR_SOLICITUD` **al final** (tras `OPERACION_CONSULTAR_VENTA`) y `toHaveLength(11)`; un test del tipo `OperacionConsultarSolicitud` (`solicitudId?` opcional, **sin** `accion` ni `confirmado`); el test "sin imports" vigente **se reverifica sin tocarlo**. **Validación** (`validar-operacion.test.ts`): `{operacion}` y `{operacion, solicitudId}` válidos; **cada rechazo va pareado con una aserción positiva en el mismo `it`**, porque hoy una operación desconocida ya se rechaza y un negativo solo **nace verde por la razón equivocada**: `ventaId`, `accion`, `confirmado`, `empleadoId`, `solicitanteId` ⇒ `undefined`. ★ El test estructural de `VALORES_PERMITIDOS_POR_OPERACION` (`describe` `:347`, `it` `:362`; el diseño lo cita como `:360-367`; genérico sobre `CAMPOS_ENUM_LIKE`) **se corre y NO se modifica** (test 14).
**Aceptación (rojo declarado)**: `npm test -- operaciones-contract validar-operacion` falla **exactamente** en el `it` de la enumeración y en los positivos de validación; `npm run typecheck` falla (`OPERACION_CONSULTAR_SOLICITUD`/`OperacionConsultarSolicitud` no existen); el test estructural (`describe` `:347`, `it` `:362`) y el de "sin imports" **siguen verdes**. Pegar ambas salidas.
Commit: `test(core): exige consultar_solicitud como undecima operacion y su whitelist de campos (consulta-solicitud-propia, tarea 4.1)` → *No es hito completo — faltan las tareas 4.2-7.2.*

**4.2** [ ] **VERDE — `src/core/operaciones/operaciones-contract.ts` (modifica, §8/§9 pto 1).** ~16 líneas: `OPERACION_CONSULTAR_SOLICITUD = "consultar_solicitud"` (doc-comment de `design.md` §8), `interface OperacionConsultarSolicitud { operacion; solicitudId? }`, **una entrada AL FINAL** de `OPERACIONES_NEGOCIO` (`:71-82`, tras `OPERACION_CONSULTAR_VENTA`) y **un miembro AL FINAL** de la unión `OperacionNegocio` (`:196-206`) — el `append` es lo que hace trivial el rebase con los hermanos (R11). **Sigue sin un solo `import`.** Los doc-comments "SEIS" de `:9`/`:39` **no se tocan acá** (van en 6.2).
**Aceptación**: los tests de 4.1 sobre el contrato en verde. ★ **Abre la ventana de `typecheck` ROJO esperada** (bisectabilidad): falla `ejecutar-operacion.ts` (`const _exhaustivo: never`, `:995`) hasta 5.2, y luego los archivos de wiring y sus tests hasta 5.4. `npm test` sigue verde salvo los rojos declarados.
Commit: `feat(core): agrega OperacionConsultarSolicitud como undecima entrada del contrato de operaciones (consulta-solicitud-propia, tarea 4.2)` → *No es hito completo — faltan las tareas 4.3-7.2.*

**4.3** [ ] **VERDE — `src/core/operaciones/validar-operacion.ts` (modifica, §0.1).** ~4 líneas: **una fila en las TRES PRIMERAS tablas de las cuatro** — `consultar_solicitud: ["operacion", "solicitudId"]` en `CAMPOS_POR_OPERACION` (junto a `:44`), `[]` en `CAMPOS_REQUERIDOS_POR_OPERACION` (`:58`), `[]` en `CAMPOS_NUMERICOS_POR_OPERACION` (`:96`). ★ **Nada en `VALORES_PERMITIDOS_POR_OPERACION`** (`:114`; `consultar_solicitud` no tiene campo enum-like). El doc "seis claves" de `:152` va en 6.2.
**Aceptación**: los tests de validación de 4.1 en verde; el test estructural (`describe` `:347`, `it` `:362`) sigue verde **sin haberse modificado**; `git diff main -- src/core/operaciones/validar-operacion.ts` = tres filas.
Commit: `feat(core): agrega consultar_solicitud a las tres primeras tablas de validar-operacion (consulta-solicitud-propia, tarea 4.3)` → *No es hito completo — faltan las tareas 5.1-7.2.*

## Fase 5 — Dispatcher, wiring y borde MCP

**5.1** [ ] ★ **ROJO — `src/core/operaciones/ejecutar-operacion.test.ts` (extiende).** *Test-first.* ~130 líneas. Agregar `makeConsultaSolicitudPropia()` (molde `makeConsultaVentaPropia`) y `consultaSolicitudPropia` a `makeDeps` (`:272-283`): el campo **inexistente en el tipo es un rojo de compilación** que prueba que es requerido. Tests: (i) ★ **cero ranura** (`estaConfirmada`/`marcarPendiente`/`consumir` no llamadas) y ★ **cero auditoría** (`registrarAccion` no llamada), **en las cuatro ramas** (id propio, ajeno, inexistente, sin id) — **cada negativo pareado con la aserción del texto devuelto** (hoy cae en `default` "Operación desconocida": un negativo solo nacería verde); (ii) los **cinco textos literales** de `design.md` §7 pto 2, incluidos `No tenés solicitudes internas registradas.`, `No encontré ninguna solicitud ${id}.` y `La solicitud ${id} no es tuya: no puedo mostrarte su estado.`; (iii) ★ **el listado NO contiene el `dictamen` y el detalle SÍ** (un `dictamen` largo y reconocible; RD-115 pto 1); el detalle **omite la línea `Dictamen:` cuando no hay** (RD-115, ver Bloqueante 2) y cierra con `Resuelta por <id> el <fecha>.` sólo si existe; (iv) la respuesta a una ajena **no contiene** `detalle`/`dictamen`/`tipo`/`estado` del doble; (v) el puerto recibe `solicitanteId` = `input.sesion.empleadoId` (nunca del modelo); (vi) ★ **administrador + ajena ⇒ `no_autorizada` y `rolPort.buscarRol` (`vi.fn`) no llamado**; (vii) un doble de `solicitudStore` que **lanza ante cualquier escritura** no se invoca; (viii) ★★ **test mecánico (test 8), nace VERDE — declararlo**: `readFileSync` de `ejecutar-operacion.ts` + `not.toMatch(/solicitanteId\s*===\s*[\w.]*empleadoId/)` y el inverso (molde `:1389-1395`); hoy hay **una sola** `solicitanteId` (`:959`, asignación) ⇒ el regex nace limpio y con dientes potenciales (los dientes se prueban en 5.7).
**Aceptación (rojo)**: fallan (i)-(vii); (viii) pasa; `npm run typecheck` falla (`consultaSolicitudPropia` inexistente en el tipo). Pegar salidas.
Commit: `test(core): exige ejecutarConsultarSolicitud sin ranura ni auditoria y con formatos de listado y detalle (consulta-solicitud-propia, tarea 5.1)` → *No es hito completo — faltan las tareas 5.2-7.2.*

**5.2** [ ] **VERDE — `src/core/operaciones/ejecutar-operacion.ts` (modifica, RD-115).** ~55 líneas: `ejecutarConsultarSolicitud` (~30, síncrona; `empleadoId` sale de `input.sesion`; **cero lógica de alcance**, delega íntegro en `consultarSolicitudPropia`), `formatearLineaSolicitudPropia` y `formatearDetalleSolicitudPropia` (~20, formas exactas de §7 pto 1: **sin `dictamen` ni `detalle` en el listado**), **un `case OPERACION_CONSULTAR_SOLICITUD` AL FINAL del `switch`** (tras `:991`, antes del `default`) y `readonly consultaSolicitudPropia: ConsultaSolicitudPropiaPort` **requerido** en `EjecutarOperacionDeps` (junto a `:118`, nunca opcional, §7 pto 4). Nuevos imports: `import type` de `../solicitudes/consulta-solicitud-propia-contract.js` y `consultarSolicitudPropia` de `../solicitudes/consultar-solicitud-propia.js` (**núcleo → núcleo**, sin adapters). Si `exactOptionalPropertyTypes` protesta con `solicitudId?`, usar el spread condicional que ya usa el archivo (`:946-947`).
**Aceptación**: 5.1 en verde; `ejecutar-operacion.ts` **deja de fallar** en `typecheck`; los tests vigentes del archivo siguen verdes; `rg "solicitanteId" src/core/operaciones/ejecutar-operacion.ts` = **una** ocurrencia (la de `:959`); `rg "adapters/" src/core/operaciones/ejecutar-operacion.ts` sin coincidencias.
Commit: `feat(core): agrega ejecutarConsultarSolicitud que delega el gate en el nucleo, sin ranura ni auditoria (consulta-solicitud-propia, tarea 5.2)` → *No es hito completo — faltan las tareas 5.3-7.2.*

**5.3** [ ] **ROJO — `src/build-on-operaciones-empleado.test.ts` (extiende).** *Test-first.* ~15 líneas, molde `:431-517` (test de `toPortVentaPropia` por el handler) y `:778-792` (`openDatabase(":memory:")` + `createSolicitudStore(db)`): (i) `toPortSolicitudPropia`: una fila con `tipo`/`estado` fuera del vocabulario **degrada la operación y loguea `SolicitudTipoEstadoInvalidoError`** (el **mismo** error que `toPortSolicitud`, RD-114 pto 2; no se declara una variante propia); (ii) ★ **instantánea de tablas idéntica** (spec `herramienta-operaciones-negocio`, "no muta estado"): con solicitudes propias y ajenas en distintos estados, invocar `consultar_solicitud` con id propio, ajeno y sin id deja `solicitudes_internas` (incluido `updated_at`), `casos` y `registro_acciones_empleado` **idénticas**; (iii) camino feliz de punta a punta por el handler contra la BD real. Tras v3.13, el fixture es `makeBaseDeps` (ya con `createKnowledge`).
**Aceptación (rojo)**: fallan (i)-(iii); `npm run typecheck` falla (wiring inexistente / campo requerido sin proveedor). Pegar salidas.
Commit: `test(root): exige el wiring de consultaSolicitudPropia y la instantanea de tablas sin cambios (consulta-solicitud-propia, tarea 5.3)` → *No es hito completo — faltan las tareas 5.4-7.2.*

**5.4** [ ] **VERDE — `src/build-on-operaciones-empleado.ts` (modifica, §9 pto 5).** ~18 líneas: `toPortSolicitudPropia(row): SolicitudPropia` (molde `toPortVentaPropia`, `:123-132`; valida contra `SOLICITUD_TIPOS`/`SOLICITUD_ESTADOS` **importados del núcleo** y lanza `SolicitudTipoEstadoInvalidoError`, ya importable de `./build-on-comando-empleado.js`), closure inline `consultaSolicitudPropia: ConsultaSolicitudPropiaPort` sobre `buscarSolicitudPropiaPorId`/`listSolicitudesPropiasDeSolicitante` (molde `:187-193`) y **una línea** en `ejecutarDeps` (`:201-218`). Sin tocar `src/main.ts` (el closure se arma sobre el `db` que el composition root ya recibe).
**Aceptación**: 5.3 en verde; **`npm test` y `npm run typecheck` verdes por primera vez desde 4.2 (se cierra la ventana roja)**; `git diff main -- src/main.ts` vacío; sin imports nuevos entre adaptadores. *(Plan B de RD-114: el import del array sale de `./build-on-comando-empleado.js`.)*
Commit: `feat(root): cablea consultaSolicitudPropia con toPortSolicitudPropia en el turno de empleado (consulta-solicitud-propia, tarea 5.4)` → *No es hito completo — faltan las tareas 5.5-7.2.*

**5.5** [ ] **ROJO — `src/adapters/operaciones/index.test.ts` (extiende).** *Test-first.* ~15 líneas, molde `:304-328`: (i) `OPERACIONES_TOOL_DESCRIPTION` **contiene** `consultar_solicitud` (**el único rojo real**); (ii) `OPERACIONES_TOOL_ZOD_SCHEMA` acepta `{operacion:"consultar_solicitud"}` y `{operacion, solicitudId}` y ambas **delegan en `ejecutar`** (nacen verdes tras 4.2: `z.enum(OPERACIONES_NEGOCIO)` crece solo); (iii) ★ **el zod plano NO cambia**: `Object.keys(OPERACIONES_TOOL_ZOD_SCHEMA.shape)` fijadas al conjunto vigente (nace verde: invariante).
**Aceptación (rojo)**: sólo (i) falla; (ii)-(iii) pasan — declararlo. Pegar salida.
Commit: `test(adapters/operaciones): exige consultar_solicitud en OPERACIONES_TOOL_DESCRIPTION y el zod plano sin cambios (consulta-solicitud-propia, tarea 5.5)` → *No es hito completo — faltan las tareas 5.6-7.2.*

**5.6** [ ] **VERDE — `src/adapters/operaciones/index.ts` (modifica, §9 pto 4).** ~6 líneas, **SÓLO `OPERACIONES_TOOL_DESCRIPTION`** (`:114-135`): agregar la entrada de `consultar_solicitud` (sólo lectura, `solicitudId` opcional, sin confirmación). **El zod plano no cambia** (`solicitudId: z.string().optional()` ya está en `:74`).
**Aceptación**: 5.5 en verde; `git diff main -- src/adapters/operaciones/index.ts` = sólo el texto de la descripción; `npm test` y `npm run typecheck` verdes.
Commit: `feat(adapters/operaciones): agrega consultar_solicitud a OPERACIONES_TOOL_DESCRIPTION (consulta-solicitud-propia, tarea 5.6)` → *No es hito completo — faltan las tareas 5.7-7.2.*

**5.7** [ ] ★ **Verificación por mutación manual del gate en el dispatcher (§13.3).** *Excepción TDD: el test 8 nació verde y esto prueba que tiene dientes.* Con 5.2 aplicada: (a) agregar **temporalmente** en `ejecutar-operacion.ts`, dentro de `ejecutarConsultarSolicitud`, `if (resultado.solicitud.solicitanteId === input.sesion.empleadoId) { … }` (o equivalente que compare); (b) `npm test -- ejecutar-operacion`: **debe fallar el test (viii) de 5.1**; guardar la salida en rojo; (c) revertir y confirmar `git diff -- src/core/operaciones/ejecutar-operacion.ts` vacío contra el commit de 5.2; (d) repetir `npm test` en verde. *Opcional y barato*: misma idea sobre 3.1 (agregar `updated_at` a `SOLICITUD_PROPIA_SELECT_COLUMNS` ⇒ debe fallar).
**Aceptación**: `docs/progreso/v3.14-consulta-solicitud-propia/verificacion-mutacion-gate-dispatcher.md` con la salida en rojo, la salida en verde tras revertir y la confirmación de `git diff` vacío. **Sin este archivo el ADR 238 pto 3 queda con una aserción decorativa** (instrucción al Reviewer). Lo crea el Implementer al ejecutarla; el Spec Author no.
Commit: `docs: evidencia de verificacion por mutacion del invariante del gate en el dispatcher (consulta-solicitud-propia, tarea 5.7)` → *No es hito completo — faltan las tareas 6.1-7.2.*

> **Sub-corte opcional 2A | 2B**: hasta acá (tareas 4.1-5.7, ~339 líneas) está **todo el código y su evidencia de mutación**; lo que sigue es skill, docs y evidencia manual (~149). Ver Forecast.

## Fase 6 — Skill conversacional y docs

**6.1** [ ] ★ **`.claude/skills/consultar-solicitud/SKILL.md` (nuevo, §10, R7, R8).** *Excepción TDD: contenido conversacional, sin lógica ejecutable.* ~55 líneas, molde `.claude/skills/consultar-venta/SKILL.md` (42 líneas, cinco secciones), auto-descubierta (sin registro en código ni `allowedTools` nuevo). **`description` DISCRIMINANTE** apoyada en el verbo del empleado (*saber / ver / en qué quedó* vs. *retirar / cancelar*), con **desambiguación cruzada explícita contra `cancelar-solicitud`** (y mención de `solicitud-interna`/`resolver-solicitud` como las otras vecinas): *"Cuando el empleado quiera saber en qué quedó una solicitud interna propia —si se la aprobaron o rechazaron, qué dijo el dictamen y cuándo—, o ver el listado de las suyas. Operación de sólo lectura, sin confirmación. Para retirar o cancelar una solicitud, usar `cancelar-solicitud`."* Cuerpo: *Con `solicitudId`* (`{ operacion: "consultar_solicitud", solicitudId }`), *Sin `solicitudId`* (listado), *Solicitud ajena* (comunicar tal cual, **sin inventar una causa**), y ★ **la instrucción propia: "mostrá el `dictamen` tal cual, sin resumirlo ni interpretarlo"** (R8). *Herramientas*: sólo `mcp__operaciones__operacion_negocio`, **nunca** `Read`/`Bash`/`Write`/`Edit`.
**Aceptación (verificada leyendo/ejecutando, no asumida)**: `name: consultar-solicitud` = nombre de carpeta; `description` bajo el tope que valida `core/skills` (≈1000 caracteres, ver `docs/progreso/v3.1-definicion-skills/paso6-*`); nombra `cancelar-solicitud`; contiene la instrucción del dictamen; `git diff main -- .claude/skills/cancelar-solicitud .claude/skills/solicitud-interna .claude/skills/resolver-solicitud` **vacío** (ampliar una vecina en vez de crear ésta **se rechazó**); `npm test` verde (los tests de `skills-habilitadas`/`descubrir-skills` no enumeran por nombre). **La selección por el SDK NO la cubre ningún test: la prueba está en 7.1.**
Commit: `feat(root): agrega la skill consultar-solicitud con desambiguacion contra cancelar-solicitud (consulta-solicitud-propia, tarea 6.1)` → *No es hito completo — faltan las tareas 6.2-7.2.*

**6.2** [ ] **Docs: el conteo diez → once, SOLO como tarea de docs verificada (R5, §0.5, §9.1).** *Excepción TDD: documentación y comentarios.* Archivos: `README.md:328`, `docs/ARC42_Harness_Empresarial.md:611`, doc-comments de `src/core/operaciones/operaciones-contract.ts:9` y `:39` ("SEIS"/"seis" ⇒ once), y `src/core/operaciones/validar-operacion.ts:152` ("mismas seis claves" ⇒ once). ~14 líneas. ★ **Cuidado con la verdad temporal**: `README.md:328` y `ARC42:611` viven en la sección de **v3.12** ("Desde v3.12.0 … llega a diez"); sobrescribir a ciegas falsificaría esa sección. Redactar para que **v3.12 siga diciendo diez y el estado vigente diga once desde v3.14.0 con `consultar_solicitud`** (una frase o un párrafo nuevo). `ejecutar-operacion.ts:572` **no se toca**.
**Aceptación (verificada con `rg`)**: `rg -n "diez" README.md` y `rg -n "diez en total" docs/ARC42_Harness_Empresarial.md`: ninguna afirmación del **estado vigente** dice diez, ninguna afirmación **sobre v3.12** se falsificó; `rg -n "seis|SEIS" src/core/operaciones` deja sólo los falsos positivos (`ejecutar-operacion.ts:572`, `ejecutar-operacion.test.ts:482`); `git diff main -- src/core/operaciones/operaciones-contract.ts src/core/operaciones/validar-operacion.ts` de **esta tarea** contiene **sólo líneas de comentario**; `npm test` y `npm run typecheck` verdes.
Commit: `docs: corrige el conteo de operaciones a once en README, arc42 y los doc-comments del contrato (consulta-solicitud-propia, tarea 6.2)` → *No es hito completo — faltan las tareas 7.1-7.2.*

## Fase 7 — Verificación manual final y cierre

**7.1** [ ] ★ **Verificación manual del entregable + guardas de alcance.** *Excepción TDD: verificación manual de un entregable end-to-end.* Con 1.1-6.2 cerradas. Archivo nuevo `docs/progreso/v3.14-consulta-solicitud-propia/verificacion-manual-tarea-7.1.md`, molde `docs/progreso/v3.12-devolucion-sin-token-dos-personas/verificacion-manual-tarea-27.md` (incluida su sección de método). **Lo crea el Implementer/humano al ejecutarla; el Spec Author no.** Debe contener:
- **(a) Las cuatro frases de selección de skill** (R7; el entregable que más puede fallar y el único sin red): *"¿me aprobaron la solicitud sol-7?"* ⇒ `consultar_solicitud`; *"quiero cancelar sol-7"* ⇒ `cancelar_solicitud_interna`; *"necesito pedir tres días"* ⇒ `crear_solicitud_interna`; *"¿qué solicitudes tengo?"* ⇒ `consultar_solicitud` **sin id**. Resultado observado por frase (operación invocada). **Si alguna falla**: se ajusta la `description` de 6.1 (un commit más) o, si no se puede discriminar, **vuelve al Spec Author**.
- **(b) Los tres desenlaces con DOS cuentas**: una solicitud **aprobada** y una **rechazada** (con `dictamen` y `resueltaPor` visibles y el dictamen mostrado **sin parafrasear**, R8) y el intento sobre una **ajena** ⇒ `no_autorizada`, **sin un solo dato de la ajena** en la respuesta.
- **(c) Cero auditoría end-to-end**: `SELECT COUNT(*) FROM registro_acciones_empleado` **idéntico antes y después** del turno de consulta.
- **(d) Guardas `git diff main`** (salida pegada): **cero migraciones** (`0015` libre); **cero** cambios en `src/core/auth/` (incl. `sesion.ts`), `src/main.ts`, `package.json`/`package-lock.json`, `src/adapters/web/**`, `definitions.ts`, `soporte-prompt.ts`, `registro-acciones-contract.ts`; **`SolicitudStorePort`/`listarSolicitudesPendientes`/`listSolicitudesInternas` intactos**; las tres skills vecinas intactas; `src/core/` sin imports de `src/adapters/*` y `repository.ts` sin imports de `src/core/*`.
- **(e) Suite**: `npm test`, `npm run typecheck`, `npm run build` en verde (con `dist/` limpio).
**Aceptación**: los cinco bloques presentes. Si el entorno no tiene `ANTHROPIC_API_KEY`, el humano ejecuta (a)-(c) y el archivo lo declara igual que la tarea 27 de v3.12. **Sin (a), el entregable funcional NO está demostrado** aunque todos los tests pasen.
Commit: `docs: evidencia de verificacion manual de consultar_solicitud con las cuatro frases y los tres desenlaces (consulta-solicitud-propia, tarea 7.1)` → *No es hito completo — falta la tarea 7.2 (Reviewer, tag).*

**7.2** [ ] **Checklist de cierre (AGENTS.md) — sin código; commit, push, merge y tag los ejecuta el HUMANO.**
- [ ] Reviewer aprobó (`sdd-verify` + `code-review` sin hallazgos bloqueantes), con atención a: el **rojo #1 de tipo** (commit 2.1) y el **rojo #2 de aserción** (4.1) **separados de su verde** y con las salidas de `npm test` **y** `npm run typecheck`; la **mutación de 5.7** (sin ella, rechazar); que el test `:54-67` se **invirtió**, no se borró; y que 1.1 sea un commit aislado.
- [ ] Entregable funcional demostrado de punta a punta (7.1 a-c).
- [ ] `docs/progreso/v3.14-consulta-solicitud-propia/` contiene `verificacion-mutacion-gate-dispatcher.md` y `verificacion-manual-tarea-7.1.md`.
- [ ] Tag `v3.14.0` sobre `main` **tras** el merge (numeración confirmada por el checkpoint).
- [ ] Guardas de 7.1(d) confirmadas por el **Reviewer**, no sólo por el Implementer.
Mensaje sugerido: `docs: cierra v3.14 - consulta de solicitud propia en el chat de empleado` · Rama destino: `main` → *Es hito completo sólo con las cuatro casillas de AGENTS.md marcadas: Reviewer aprobado, entregable demostrado, docs/progreso/ creado, listo para tag v3.14.0.*

---

## Cadena de dependencia y paralelismo

- **Slice 1**: 1.1 es independiente de todo. 2.1→2.2→2.3→2.4 secuenciales (rojo antes que verde). **3.1-3.2 son independientes de 2.x a nivel de archivo** (`repository.ts` no importa `src/core/*`): podrían ir antes o después, se dejan después por lectura. **Nada del Slice 1 se ejecuta en paralelo con otro commit de la misma rama** (un solo escritor).
- **Slice 2** depende de 2.2 (puerto), 2.4 (núcleo), 3.2 (lectores) y de 1.1 (vocabulario en 5.4). 4.1→4.2→4.3 → 5.1→5.2 → 5.3→5.4 → 5.5→5.6 → 5.7. **5.5-5.6 sólo necesitan 4.2** (no dependen de 5.1-5.4) y podrían intercalarse. 5.7 depende de 5.2. 6.1 depende de 4.2 y 5.2 (describe una operación que debe existir). 6.2 depende de 4.2-4.3. 7.1 depende de 1.1-6.2. 7.2 de todo.
- **Ventana de `typecheck` rojo esperada: de 4.2 a 5.4** (el `never` exhaustivo de `ejecutar-operacion.ts` y el campo requerido de `EjecutarOperacionDeps`). Es la propiedad que compra el campo requerido (§14 pto 5): **no existe un estado intermedio silencioso**. Cada commit lo declara.
- **Bottleneck de ownership**: `ejecutar-operacion.ts` (R11) es territorio compartido con los tres hermanos de la serie; la mitigación es `append` al final del `switch` y de `OPERACIONES_NEGOCIO`.

---

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **~940-960** (`additions + deletions`, con tests y docs; **sin** los artefactos de `openspec/changes/consulta-solicitud-propia/`). ~350 producción · ~485 tests · ~90-120 docs y evidencia |
| 400-line budget risk | **High** |
| Chained PRs recommended | Yes |
| Suggested split | **PR #1 (lectura, tareas 1.1-3.2, ~469) → PR #2 (superficie, tareas 4.1-7.2, ~488)**, con sub-cortes opcionales 1A/1B y 2A/2B (abajo) |
| Delivery strategy | `ask-on-risk` (vigente) |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

**El Review Workload Guard exige que el humano decida `delivery_strategy` y `chain_strategy` ANTES de `sdd-apply`. Este documento no decide por él.** Tradeoff en tres líneas:
- **`stacked-to-main`**: cada PR mergea a `main` en orden; iteración rápida y la #1 (inerte) puede mergear sin cerrar la decisión de proyección; costo: la #2 se rebasa sobre `main` y éste queda un tiempo con un puerto sin consumidor.
- **`feature-branch-chain`**: #1 → tracker `hito/v3.14-consulta-solicitud-propia`, #2 → rama de la #1 (`…--slice1-lectura`, `…--slice2-superficie`); sólo el tracker mergea, un único punto de rollback y `main` nunca ve el puerto huérfano; costo: ramas largas y disciplina de retarget (v3.12 la usó, no es vinculante).
- Si el humano prefiere **`size:exception`** (`single-pr`/`exception-ok`), tiene que registrarlo antes de apply; con ~940 líneas no lo recomiendo.

### ★ Reconciliación honesta con `design.md` §12.2

El diseño dice **~375 (PR #1) / ~325 + ~80 (PR #2), ambas bajo 400**. **Sumando las filas de su propia tabla §12 por PR no se reproduce**:

| PR | Filas de §12 (prod + test) | Suma | Diseño §12.2 | Discrepancia |
|---|---|---|---|---|
| #1 | contrato 55+45 · núcleo 55+130 · `solicitudes-contract` 8+10 · `build-on-comando` 6 · `repository` 70+90 | **~469** | ~375 | **+~94**: la #1 supera 400 |
| #2 (código y docs) | `operaciones-contract` 20+20 · `validar` 6+30 · `ejecutar` 55+130 · `build-on-operaciones` 18+15 · `adapters/operaciones` 6+15 · skill 55 · README/arc42 8 | **~378** | ~325 | **+~53** (el ~325 equivale a omitir la skill de ~55) |
| #2 (+ evidencia) | + mutación 5.7 (~30, **no estaba en el diseño**) + verificación manual 7.1 (~80) | **~488** | ~325 + 80 | la #2 supera 400 con la evidencia |
| **Total** | | **~957** | ~940 (§12) / ~780 (§12.2) | §12.2 es inconsistente con §12; **este documento usa §12** |

**Consecuencia**: con el corte de **dos** PRs del diseño, **ninguna de las dos entra en 400 contadas con tests y evidencia**. La carga real de review es menor a la bruta (~485 líneas son tests confirmatorios y la evidencia es markdown), pero **el presupuesto se mide en líneas**. Por eso el orden de las tareas deja **dos sub-cortes contiguos y costeados**, que el humano puede activar sin renumerar (mismo límite de PR #1/#2 como padre):

| Sub-corte | Tareas | ~Líneas | Autonomía |
|---|---|---|---|
| **1A** núcleo puro | 1.1-2.4 | ~309 | Verde solo; puerto sin consumidor |
| **1B** adaptador SQL | 3.1-3.2 | ~160 | Independiente de 1A a nivel de archivo (hexagonal) |
| **2A** código + mutación | 4.1-5.7 | ~339 | Enciende la operación; requiere 1A y 1B |
| **2B** skill + docs + evidencia manual | 6.1-7.1 | ~149 | Sólo docs/contenido; requiere 2A. Es la "tercera PR opcional" de §12.2 ampliada a la skill |

Con los cuatro sub-cortes, todas quedan bajo 400 (309 / 160 / 339 / 149); con **uno solo** (p. ej. 2B aparte) la #1 sigue en ~469. **Recomendación de esta fase, no decisión**: como mínimo separar 1A|1B **o** aceptar `size:exception` sólo para la #1 (mecánica y sin lógica nueva en la mitad de sus líneas). **Antes de mergear un sub-corte, se corre `npm test` y `npm run typecheck`: cada uno deja ambos en verde.**

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Lectura: vocabulario + contrato + núcleo puro + SQL | PR #1 | Start: base tras G0. Finish: 3.2 + verificación de cierre. Rollback: `git revert`, puerto sin consumidor. Base = tracker (`feature-branch-chain`) o `main` (`stacked-to-main`). Tests incluidos |
| 2 | Superficie: operación 11 + validación + dispatcher + wiring + descripción + skill + docs + evidencia | PR #2 | Base = rama de la PR #1 (`feature-branch-chain`) o `main` rebasada tras el merge de la #1. Rollback: `git revert` ⇒ diez operaciones; orden inverso si hay hermano mergeado |

---

## Bloqueante para el checkpoint: dos discrepancias spec ↔ diseño (verificadas leyendo)

`sdd-spec` escribió las specs en paralelo al diseño y **divergen en dos puntos**. Estas tareas **siguen el diseño** (instrucción de esta fase; `design.md` §15 pto 4 dice que la spec debe tener **once** campos y §7 fija RD-115), pero **el Spec Author debe alinear la spec y pasar de nuevo por el checkpoint** (AGENTS.md, regla del loop de rechazo) **antes de `sdd-apply`**, o los tests de 2.1, 3.1 y 5.1 se derivan de un contrato que la spec contradice.

| # | Spec (`consulta-solicitud-empleado/spec.md`) | Diseño | Tareas que se editan si prevalece la spec |
|---|---|---|---|
| **B1** | `:17` y `:110`: **diez** campos; `dictaminadaAt` **excluido** | §5.1: **once** campos; `dictaminadaAt` **entra** | 2.1, 2.2 (interfaz), 3.1, 3.2 (columna y mapper), 5.1 |
| **B2** | `:72` y `:79-82`: sin dictamen la respuesta **lo indica explícitamente** | RD-115 pto 1: la línea `Dictamen:` **se OMITE**, no se escribe "sin dictamen" | 5.1 (un test), 5.2 (una rama del formateador), 6.1 (una frase) |

---

## Mapa de decisiones asumidas — qué tareas se editan si el checkpoint las cambia

| Decisión (asumida hoy) | Si se invierte | Tareas | Costo |
|---|---|---|---|
| `dictamen` SÍ | quitar campo de la interfaz, columna de la lista blanca, línea del formateador, instrucción R8 | 2.1, 2.2, 3.1, 3.2, 5.1, 5.2, 6.1 | ~10 líneas; si se decide **antes** de la PR #1 |
| `resueltaPor` SÍ como id | ídem | mismas | idéntico |
| "estado + fecha y nada más" | caen `dictamen`, `dictaminadaAt` y `resueltaPor` juntos | mismas + delta de spec | ~20 líneas; el change conserva su razón de ser |
| RD-114 pto 1: promover `SOLICITUD_ESTADOS` | plan B: exportar el array donde está | 1.1 (una palabra), 5.4 (import) | −20 líneas |
| RD-114 pto 4: sin filtro `estados` | agregar el parámetro opcional | 2.2, 3.1, 3.2 | ~15 líneas |
| RD-115 pto 1: dos formateadores | uno solo con truncado | 5.1, 5.2 | ~10 líneas |
| Mutación (5.7) y cuatro frases (7.1a) obligatorias | sólo tests escritos | 5.7 se elimina; 7.1 se acota | −~30 líneas; **el Reviewer las exige igual (R7)** |

---

## Riesgos y dependencias

- **Orden de merge**: v3.12 mergeado y tageado (**bloqueante duro**, R2) → v3.13 → **éste**; los dos hermanos siguientes (`visibilidad-a2a-entrante-chat`, `consulta-kpi-a2a-chat`) rebasan encima (conteo 11 → 12 → 13).
- ★ **Cláusula de v3.13 que queda obsoleta**: `openspec/changes/conocimiento-chat-empleado/specs/turno-empleado-autenticado/spec.md:47-54` afirma que `OPERACIONES_NEGOCIO` "conserva sus diez entradas" y el escenario `:52-54` dice *"longitud 10"*. Al llegar a **11** deja de ser verdad. **Decisión de checkpoint pendiente**: acotarla a *"al momento de v3.13"* (edición del Spec Author sobre **otro** change, no una tarea de código de éste). Si no se acota, el archivado de v3.13 y este change se contradicen. La guarda 8c de v3.13 (`operaciones-contract.test.ts` "con diez") es **sólo de v3.13**.
- **Números de línea de wiring** (`build-on-operaciones-empleado.*`, `main.ts`) se corren tras v3.13: re-`Grep` en 5.3-5.4.
- **Tests que nacen verdes por la razón equivocada** (rechazo de claves extra, ceros de ranura/auditoría): mitigado pareándolos con una aserción positiva (4.1, 5.1); los dientes reales se prueban en 5.7.
- **R7 (skill vs `cancelar-solicitud`)**: ningún test cubre la selección; sólo 7.1(a). **R8**: la skill *instruye*, no garantiza que el modelo no parafrasee el dictamen; la única garantía total es no mostrarlo.
- **Verificación manual (7.1)** requiere **dos cuentas** y, para (a)-(c), `ANTHROPIC_API_KEY`; sin ella la ejecuta el humano y el archivo lo declara.
- **Texto temporal en README/arc42 (6.2)**: reemplazo ciego "diez"→"once" falsifica la sección de v3.12.

---

## Reconciliación de tests contra las specs

| Requirement (spec) | Tarea(s) | Estado inicial |
|---|---|---|
| `consulta-solicitud-empleado`: sólo lectura, sin confirmación ni auditoría | 2.3 (cero escrituras), 5.1 (cero ranura/auditoría, doble de store que lanza), 5.3 (instantánea) | Rojo |
| identidad de la sesión, clave extra rechazada, dispatcher sin comparar `solicitanteId` | 4.1, 5.1 (v, viii), 5.7 (dientes) | Rojo / (viii) verde |
| consulta por id en los cuatro estados | 2.3, 3.1 | Rojo |
| detalle con `dictamen` y `resueltaPor` (asumido) | 3.1, 5.1 | Rojo |
| ajena ≠ inexistente, sin filtrar datos, administrador tampoco | 2.3, 5.1 (vi) | Rojo |
| lista blanca de columnas y campos | 2.1, 3.1 | Rojo (de tipo) |
| listado propio, todos los estados, `DESC`, tope 20 tras el filtro | 3.1, 5.1 | Rojo |
| listado vacío con mensaje propio | 5.1 | Rojo |
| cancelación y `SolicitudStorePort` no cambian | 3.1 (vi), guardas de cierre y 7.1(d) | Rojo / guarda |
| `herramienta-operaciones-negocio`: once operaciones, schema `solicitudId?` | 4.1, 5.5 | Rojo (aserción) |
| `herramienta-operaciones-negocio`: no muta estado; sin fila de auditoría | 5.1, 5.3 | Rojo |
| `confirmado` no existe en ningún schema | 4.1 (rechazo de `confirmado` pareado para `consultar_solicitud`; el `it.each` vigente de `validar-operacion.test.ts:138` sólo lo prueba sobre `crear_solicitud_interna`) | Rojo (pareado) |
| Validación manual: skill, tres desenlaces, `COUNT(*)` idéntico | 7.1 | Manual |
