> **Nota de proceso (hook de graphify)**: ejecutor sin herramienta de shell disponible (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación ya documentada por `proposal.md` y `design.md` de este mismo change. Este documento no reabre ninguna decisión (ADR 174-187, RD-80 a RD-86 ya resueltas por checkpoint + `sdd-design`). Compensación: se releyeron completos `proposal.md`, `design.md` (§0-15) y las 5 specs (`consultas-negocio-a2a` nueva, `turno-a2a-entrante-solo-lectura` nueva, `solicitud-a2a-entrante` delta, `servidor-a2a-jsonrpc` delta, `reporte-comisiones-mensual` delta). Se recomienda `graphify update .` tras persistir este archivo.

# Tasks: Consultas de negocio de sólo lectura para el turno A2A entrante (v3.5.0 propuesto)

**Origen** (no se duplica): [`proposal.md`](proposal.md) (ADR 174-180, R1-R9, RD-80 a RD-86) · [`design.md`](design.md) §0-15 (ADR 181-187) · specs: [`consultas-negocio-a2a`](specs/consultas-negocio-a2a/spec.md) (nueva, 4 requirements), [`turno-a2a-entrante-solo-lectura`](specs/turno-a2a-entrante-solo-lectura/spec.md) (nueva, 3 requirements), [`solicitud-a2a-entrante`](specs/solicitud-a2a-entrante/spec.md) (delta, 2 requirements MODIFIED), [`servidor-a2a-jsonrpc`](specs/servidor-a2a-jsonrpc/spec.md) (delta, 1 requirement MODIFIED), [`reporte-comisiones-mensual`](specs/reporte-comisiones-mensual/spec.md) (delta, 1 requirement MODIFIED).

**No es un Hito numerado del Plan** — carpeta descriptiva, mismo tratamiento que `tui-canal-empleado`, `definicion-skills`, `comando-visibilidad-a2a-entrante` y `operaciones-negocio-conversacionales`. Rama prevista `hito/v3.5-consultas-negocio-a2a`; commits usan `(consultas-negocio-a2a-entrante, tarea N)`.

**Metodología**: TDD estricto (`strict_tdd: true`) en toda tarea con lógica de negocio (1-11). **Cuatro excepciones explícitas**: tarea 9 (constante literal de allowedTools, un test de conteo/contenido basta, sin ciclo rojo-verde-refactor propio), tarea 13 (specs ya escritas por `sdd-spec` en fase previa y ya comprometidas — sólo verificación de consistencia), tarea 14 (documentación), tarea 15 (verificación manual, sin código de producción).

---

## Orden de merge y gating obligatorio — leer antes de planificar sprints

Orden de merge fijado por el checkpoint para esta serie: **`autorizacion-empleado` → `operaciones-negocio-conversacionales` → `comandos-administracion-empleados` → este change**. Este change es **el último**, y no es arbitrario: comparte superficie de archivo con `operaciones-negocio-conversacionales` en `src/core/agents/definitions.ts:145` (`allowedTools`), `src/main.ts` (cableado de composition root) y la composición de `mcpServers` de `src/build-on-a2a-entrante.ts` (R3 de `proposal.md`, ADR 176).

**Regla concreta para este documento**: toda tarea que toque `definitions.ts`, `main.ts`, o la composición de `mcpServers` en `build-on-a2a-entrante.ts` queda **GATEADA** — no se abre ni se mergea su PR hasta que `operaciones-negocio-conversacionales` haya mergeado a `main`. No alcanza con que el diseño de este change esté terminado; el gate es sobre el **estado real de `main`**. Motivo explícito, ya escrito en `proposal.md` Dependencies: el test de conjunto exacto de `mcpServers` (ADR 176 pto 2, tarea 8) sólo demuestra algo real si `mcp__operaciones__*` **existe de verdad** en `main` para afirmar su ausencia contra un servidor real — escrito antes, el test afirmaría la ausencia de un servidor hipotético, que es una aserción más débil y no verificable por el reviewer del change hermano.

Esto NO bloquea el resto del change: los puertos de lectura, la lógica pura de la tool y el adaptador MCP (tareas 1-6) son archivos enteramente nuevos, sin superficie compartida, y pueden implementarse y mergearse **ya**, en paralelo a que las otras tres piezas de la serie avancen. Sólo el bloque de cableado (tareas 7-10) espera el merge del hermano.

## Los puntos obligatorios, confirmados con tarea propia

| # | Punto | Dónde en `design.md`/`proposal.md` | Tarea(s) | Por qué no puede quedar implícito |
|---|---|---|---|---|
| 1 | **Whitelist estricta por operación** — clave extra en cualquiera de las 4 variantes se rechaza antes de tocar el núcleo | ADR 184 pto 3 | **Tarea 4** | `solicitudes_pendientes`/`reembolsos_pendientes` no aceptan NINGÚN campo adicional — es la señal, verificable por test, de que esas dos operaciones no tienen forma de filtrar por identidad porque no reciben ningún parámetro que pudiera intentarlo (spec `consultas-negocio-a2a`) |
| 2 | **Recorte de datos personales en negativo, cuatro operaciones** — el texto de salida no contiene `vendedor_nombre`/`vendedorNombre`, `cliente_id`/`clienteId`, `solicitanteId` ni `detalle`, ni siquiera truncados | ADR 180, ADR 186 (§7) | **Tarea 5** | Es **R2**, el riesgo de seguridad principal del change ("Media-Alta" en `proposal.md`). Un `includes` parcial del nombre también cuenta como fuga — el test tiene que ser explícito sobre eso |
| 3 | **La tool nunca lanza ni rechaza, en ningún camino de falla** | Molde `knowledge-tool.ts:11-14`, spec `consultas-negocio-a2a` | **Tarea 5** | Contrato heredado no negociable — un solo camino de falla sin capturar es una excepción no manejada que llega hasta el cliente A2A entrante, expuesto a internet |
| 4 | **`mcpServers` del turno entrante es el conjunto EXACTO `{conocimiento, consultas}`, nunca `contains`** | ADR 176 pto 2, spec `turno-a2a-entrante-solo-lectura` | **Tarea 8** | Es la garantía que "salva" al change hermano (Aclaración 2 de `proposal.md`): si se relaja a `contains`, un refactor distraído que agregue `mcp__operaciones__*` al turno entrante pasaría el test sin que nadie se entere |
| 5 | **`BuildOnA2AEntranteDeps` tiene exactamente nueve campos, ninguno de escritura** | ADR 174, spec `turno-a2a-entrante-solo-lectura` | **Tarea 7** | Es la garantía mecánica del ADR 98 enmendado — verificable por inspección de firma, no por lectura de implementación |
| 6 | **El card no promete nada sin respaldo — "incidentes" y "proyectos" salen de `tags`, no sólo de `description`** | ADR 179, ADR 185 (§6), spec `servidor-a2a-jsonrpc` | **Tarea 11** | `proposal.md` sólo mencionó `DESCRIPCION`/`description`/`examples`; `design.md` §6 corrige explícitamente que `tags` es igual de público en el contrato de descubrimiento A2A — dejarlo sería la misma promesa sin respaldo, en otro campo |
| 7 | **Gate de merge sobre `definitions.ts`/`main.ts`/`mcpServers`** | R3, Dependencies de `proposal.md` | **Tareas 7-10** (todo el PR5) | Ver sección "Orden de merge" arriba — no es una preferencia de estilo, es lo que hace que el test de la tarea 8 sea una prueba real y no una hipótesis |

---

## Suggested Work Units

| Unit | Goal | Tareas | Est. líneas | Base branch (`feature-branch-chain`) |
|---|---|---|---|---|
| 1 | Puertos de lectura: tres contratos nuevos, `ReporteStorePort` reusado | 1-3 | ~85 | `hito/v3.5-consultas-negocio-a2a` (tracker) |
| 2 | Validación estricta de la tool (whitelist ADR 184) | 4 | ~150 | PR1 |
| 3 | Orquestación + recorte de la tool (ADR 180/186), nunca lanza | 5 | ~270 | PR2 |
| 4 | Adaptador MCP (`createConsultasAdapter`, molde `adapters/knowledge/`) | 6 | ~120 | PR3 |
| 5 ⛔ | Cableado: noveno campo, `mcpServers` compuesto + test ADR 176, `allowedTools`, `main.ts` — **GATEADA, ver sección de arriba** | 7-10 | ~115 | PR4 (merge real de `operaciones-negocio-conversacionales` a `main` es precondición externa) |
| 6 | Agent Card, prompt, specs, docs, verificación manual | 11-15 | ~113 | PR5 |

Sólo la rama tracker `hito/v3.5-consultas-negocio-a2a` mergea a `main`, y sólo después de que las seis PR encadenadas mergeen entre sí en orden (feature-branch-chain).

---

## Tareas

### PR1 — Puertos de lectura (tarea 1-3)

1. [x] **`src/core/actividad/consulta-actividad-contract.ts`** (nuevo, ADR 182 pto 3, ADR 187) — `ActividadResumen { estado: ActividadEstado; updatedAt: string }` y `ConsultaActividadPort.buscarPorReferencia({ proyectoId, referenciaExterna }): ActividadResumen | undefined`. Sin imports salvo `activity-contract.js` (tipo `ActividadEstado`). **No expone `getActividadById`** — el `id` interno (UUID) no tiene ningún camino de descubrimiento hacia un llamador A2A externo (ADR 187). Test primero (`consulta-actividad-contract.test.ts`, molde `*-contract.test.ts`): un doble plano que implementa el puerto compila contra la interfaz y, con una actividad simulada, `buscarPorReferencia` devuelve `{estado, updatedAt}` — sin `responsableId` ni `id` en el tipo de retorno (aserción de forma, no sólo de contenido). Cubre spec `turno-a2a-entrante-solo-lectura` requirement "ninguno de los nueve campos es puerto de escritura" (parcial) y spec `consultas-negocio-a2a` operación `estado_actividad`. Comando: `npm test -- consulta-actividad-contract && npm run typecheck`. Commit: `feat(core): agrega ConsultaActividadPort de solo lectura (consultas-negocio-a2a-entrante, tarea 1)`.

2. [x] **`src/core/solicitudes/consulta-solicitudes-contract.ts`** (nuevo, ADR 182 pto 3) — `ConsultaSolicitudesPort.listarPendientes(): readonly SolicitudInterna[]`, reusa `listarSolicitudesPendientes` **sin filtro** — el llamador A2A no tiene `solicitanteId` que filtrar (ADR 180 pto 1). Sin imports salvo `solicitudes-contract.js`. Test primero: doble del puerto devuelve una lista de `SolicitudInterna`; se afirma que la firma **no acepta ningún parámetro** (inspección de aridad de la función, `.length === 0`). Cubre spec `consultas-negocio-a2a` operación `solicitudes_pendientes`. Comando: `npm test -- consulta-solicitudes-contract`. Commit: `feat(core): agrega ConsultaSolicitudesPort sin filtro por identidad (consultas-negocio-a2a-entrante, tarea 2)`.

3. [x] **`src/core/ventas/consulta-reembolsos-contract.ts`** (nuevo, ADR 182 pto 3-4) — `ConsultaReembolsosPort.listPendientes(): readonly EscalacionReembolsoRow[]`, cerrado sobre `estado: "reembolso_pendiente"` desde el composition root — el puerto **no acepta** un `estado` arbitrario. Sin imports salvo `ventas-contract.js` (vocabulario de estado). Corrección de diseño aplicada (ADR 182 pto 4): `listComisionesPorPeriodo` **no** delega en esta operación — sólo la usa `agruparReporteMensual` para `reporte_comisiones`; `listEscalacionesReembolso(db, {estado: "reembolso_pendiente"})` es superconjunto de `listVentasEnReembolsoPendiente` y basta un solo método. Test primero: doble del puerto sin parámetros; se afirma `.length === 0` en la firma. Cubre spec `consultas-negocio-a2a` operación `reembolsos_pendientes`. Comando: `npm test -- consulta-reembolsos-contract`. Commit: `feat(core): agrega ConsultaReembolsosPort cerrado sobre reembolso_pendiente (consultas-negocio-a2a-entrante, tarea 3)`.

**Verificación de cierre de PR1**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/core/ventas/reporte.ts src/adapters/memory/repository.ts` **vacío** (ADR 177, reuso literal — si aparecen en el diff, el alcance se filtró).

### PR2 — Validación estricta de la tool (tarea 4)

4. [x] **`src/core/agents/consultas-negocio-tool.ts`** (nuevo, porción validación, ADR 184) — `CONSULTAS_MCP_SERVER_NAME`/`CONSULTAS_TOOL_NAME`/`CONSULTAS_TOOL_QUALIFIED_NAME` (= `mcp__consultas__consultar_negocio`), `OperacionConsulta` (unión de las 4 formas: `reporte_comisiones{periodo}`, `estado_actividad{proyectoId, referenciaExterna}`, `solicitudes_pendientes{}`, `reembolsos_pendientes{}`), `validarConsultaNegocio(raw): OperacionConsulta | { rechazo: string }` — exige **exactamente** los campos de la fila que corresponde a `raw.operacion` y rechaza cualquier clave extra (whitelist, mismo criterio que `validar-operacion.ts` del hermano y ADR 110 de `definicion-skills`). Depende de las tareas 1-3 sólo por tipos (`ActividadResumen`, etc. — sin acoplar aún). Test primero (`consultas-negocio-tool.test.ts`, arranca acá y crece en la tarea 5):
   - Cada una de las 4 operaciones con **exactamente** sus campos ⇒ acepta.
   - **Punto obligatorio 1**: `solicitudes_pendientes`/`reembolsos_pendientes` con **cualquier** campo extra (`periodo`, `proyectoId`, o uno inventado) ⇒ rechazo, sin tocar ningún puerto.
   - `reporte_comisiones` sin `periodo`, o con `proyectoId` en vez de `periodo` ⇒ rechazo.
   - `estado_actividad` sin `referenciaExterna`, o con `periodo` en vez de `proyectoId`/`referenciaExterna` ⇒ rechazo.
   Cubre spec `consultas-negocio-a2a` requirement "Ningún schema acepta un parámetro que induzca escritura" y la mitad de núcleo de "Un `operacion` fuera del conjunto cerrado se rechaza sin tocar el núcleo". Comando: `npm test -- consultas-negocio-tool`. Commit: `feat(core): agrega validarConsultaNegocio con whitelist estricta por operacion (consultas-negocio-a2a-entrante, tarea 4)`.

**Verificación de cierre de PR2**: `npm test && npm run typecheck` en verde; el archivo nuevo no importa nada de `src/adapters/*` (regla del núcleo).

### PR3 — Orquestación + recorte de la tool (tarea 5)

5. [x] **`src/core/agents/consultas-negocio-tool.ts`** (mismo archivo, porción orquestación, ADR 180/186) — `ConsultasNegocioToolDeps` (bolsa plana: `reporteStore`, `actividadPort`, `solicitudesPort`, `reembolsosPort`, `logEvent`, `casoId` — molde `KnowledgeToolDeps`, cada campo un colaborador testeable con su propio doble) y `handleConsultaNegocio(input, deps): Promise<string>` — **nunca lanza** (molde `knowledge-tool.ts` §"contrato no negociable"), delega en `validarConsultaNegocio` primero, luego en el puerto correspondiente, y aplica el recorte exacto de `design.md` §7 antes de formatear texto. **Función de formateo nueva y sin nombre compartido con `formatearReporteMensual`** — no se reusa esa función para A2A (ADR 186, hallazgo verificado en diseño). Depende de las tareas 1-4. Test primero (continúa `consultas-negocio-tool.test.ts`):
   - Las 4 operaciones con dobles de los 4 puertos ⇒ texto refleja datos reales, no una generalidad.
   - **Punto obligatorio 2 (negativo, ADR 180 pto 4, el más importante del change)**: dobles de `reporteStore`/`solicitudesPort`/`reembolsosPort` que SÍ traen `vendedorNombre`, `clienteId`, `solicitanteId`, `detalle` ⇒ el texto de salida **no** los contiene, ni siquiera truncados (un `includes` parcial del nombre también es fuga). Una actividad con `responsableId` poblado ⇒ el texto no lo contiene.
   - `reporte_comisiones` con `periodo` inválido ⇒ mensaje de uso, reusando `resolverPeriodoReporte` (función pura ya testeada, sin duplicar su validación).
   - `estado_actividad` con `referenciaExterna` inexistente ⇒ texto indicando que no se encontró, sin excepción propagada.
   - **Punto obligatorio 3**: un test por camino de falla de cada uno de los 4 puertos (molde `handleKnowledgeQuery`) — el puerto lanza o rechaza internamente ⇒ `handleConsultaNegocio` **nunca** propaga, siempre devuelve texto.
   - `reporte_comisiones` exitoso: el texto trae `periodo`, `filas.length`, suma de `ventasConfirmadas`/`montoVendido`/`ventasConReembolso`, `totalComisionado` — **sin** la tabla `filas` completa ni `reembolsosPendientes` (esa lista la cubre `reembolsos_pendientes`, operación distinta).
   Cubre spec `consultas-negocio-a2a` completa (los 4 requirements) y spec `reporte-comisiones-mensual` delta ("La consulta A2A reusa las funciones puras sin producir el reporte completo"). Comando: `npm test -- consultas-negocio-tool`. Commit: `feat(core): agrega handleConsultaNegocio con recorte de datos personales y contrato nunca-lanza (consultas-negocio-a2a-entrante, tarea 5)`.

**Verificación de cierre de PR3**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/core/ventas/reporte.ts` **vacío** (se reusa `resolverPeriodoReporte`/`agruparReporteMensual` sin editarlas — `formatearReporteMensual` explícitamente **no** se toca ni se reusa).

### PR4 — Adaptador MCP (tarea 6)

6. [x] **`src/adapters/consultas/index.ts`** (nuevo, molde `src/adapters/knowledge/index.ts`, ADR 178/181/184) — `createConsultasAdapter({ casoId, reporteStore, actividadPort, solicitudesPort, reembolsosPort, logEvent }): ConsultasNegocioAdapter` donde `ConsultasNegocioAdapter = { readonly mcpServers: NonNullable<Options["mcpServers"]> }` — **un solo campo, sin `feedback`** (ADR 181: ninguna operación cita nodos de un vault ni acumula estado que drenar al cerrar el turno). `createSdkMcpServer` + `tool()` con el schema zod plano de ADR 184 (`operacion` enum de 4 valores, `periodo`/`proyectoId`/`referenciaExterna` opcionales a nivel de wrapper), delegando en `handleConsultaNegocio` de la tarea 5. Depende de las tareas 4-5. Test primero (`consultas/index.test.ts`, molde `adapters/knowledge/index.test.ts`):
   - `createConsultasAdapter(...).mcpServers` tiene **exactamente** la clave `CONSULTAS_MCP_SERVER_NAME`.
   - El adaptador devuelto **no tiene** la propiedad `feedback` (`expect("feedback" in adapter).toBe(false)`) — es la mitad estructural del ADR 181.
   - **Mitad de núcleo obligatorio 1, a nivel schema**: `operacion` fuera del enum de 4 valores ⇒ la validación de zod falla **antes** de invocar `handleConsultaNegocio` (spy que confirma cero llamadas).
   - Ningún archivo de este módulo importa `KnowledgeFeedbackPort` (grep de imports, señal barata del ADR 181 pto 3).
   Cubre spec `consultas-negocio-a2a` requirement "Un `operacion` fuera del conjunto cerrado se rechaza sin tocar el núcleo" (mitad de adaptador) y spec `turno-a2a-entrante-solo-lectura` (preparación para la tarea 8: el adaptador expone `mcpServers` con la forma esperada por la composición). Comando: `npm test -- consultas/index && npm run typecheck`. Commit: `feat(adapters): agrega createConsultasAdapter sin feedback, molde adapters/knowledge (consultas-negocio-a2a-entrante, tarea 6)`.

**Verificación de cierre de PR4**: `npm test && npm run typecheck` en verde. **Punto de parada obligatorio**: no continuar a PR5 (tareas 7-10) hasta confirmar en `git log main` que `operaciones-negocio-conversacionales` ya mergeó — ver sección "Orden de merge" al inicio de este documento.

### PR5 ⛔ GATEADA — Cableado (tareas 7-10)

> **No abrir esta PR hasta que `operaciones-negocio-conversacionales` haya mergeado a `main`.** Ver "Orden de merge y gating obligatorio" al inicio del documento — es la precondición externa que hace que la tarea 8 pruebe algo real.

7. [x] **`src/build-on-a2a-entrante.ts`** (modificado, porción firma, ADR 174 §9) — `BuildOnA2AEntranteDeps` gana su **noveno** campo, `readonly createConsultas: (casoId: string) => ConsultasNegocioAdapter`, réplica en forma de `createKnowledge` (`:87-88`). Doc-comment de cabecera del módulo (`:13-19`) actualizado citando ADR 174: sigue diciendo "la escritura es inexpresable por firma", agregando que el noveno campo es una segunda fábrica de LECTURA. Depende de la tarea 6. Test primero (`build-on-a2a-entrante.test.ts`): **punto obligatorio 5** — la firma de `BuildOnA2AEntranteDeps` tiene exactamente nueve campos (inspección de `Object.keys` sobre un objeto que satisface el tipo en un test de tipo, o fixture de deps completo), y ninguno es de los puertos de escritura enumerados en la tabla del ADR 98 pto 2 (`ActivityStorePort`, `ActivityBoardPort`, `escritura`/`WorktreePort`, `ClienteA2APort`, `notifier`, `VentaStorePort`, `SolicitudStorePort`, `KeyedQueue`). Cubre spec `turno-a2a-entrante-solo-lectura` requirement "`BuildOnA2AEntranteDeps` tiene exactamente nueve campos, ninguno de escritura" (ambos escenarios) y spec `solicitud-a2a-entrante` delta escenario "El noveno campo de sólo lectura no reabre el invariante". Comando: `npm test -- build-on-a2a-entrante && npm run typecheck`. Commit: `feat(root): agrega noveno campo createConsultas a BuildOnA2AEntranteDeps (consultas-negocio-a2a-entrante, tarea 7)`.

8. [x] **`src/build-on-a2a-entrante.ts`** (mismo archivo, porción composición de `mcpServers`, ADR 176) — `ejecutarTurno` compone `mcpServers: { ...knowledge.mcpServers, ...consultas.mcpServers }` (`:174`), `knowledgeFeedback: knowledge.feedback` **sin cambios** (`consultas` nunca aparece ahí, ADR 181 pto 2). Depende de la tarea 7. Test primero:
   - **Punto obligatorio 4 (el más sensible de esta PR)**: test de **conjunto exacto** — `Object.keys(mcpServers).sort()` es **exactamente** `[CONSULTAS_MCP_SERVER_NAME, KNOWLEDGE_MCP_SERVER_NAME].sort()`, aserción de **igualdad**, nunca `contains` (molde exacto de `design.md` §10). **Escrito explícitamente contra el servidor real del hermano**: `expect(mcpServers).not.toHaveProperty(<nombre real de mcp\_\_operaciones\_\_ que ya existe en `main` tras su merge>)` — no un nombre hipotético.
   - El test de **lista de imports** heredado (ADR 98 pto 3, `:418-442`) gana una aserción **aditiva y nombrada**: `expect(importLines).toMatch(/consultas\/index\.js/)`, sin relajar el resto a `contains`.
   Cubre spec `turno-a2a-entrante-solo-lectura` requirements "`mcpServers` del turno entrante es exactamente `{conocimiento, consultas}`" (los 3 escenarios, incluido el que ejercita la invocación real del modelo intentando `mcp__operaciones__*`) y "El módulo de composición no gana ningún import de escritura"; spec `solicitud-a2a-entrante` delta escenario "Componer dos servidores MCP no crea una segunda llamada a `handleTurn`". Comando: `npm test -- build-on-a2a-entrante`. Commit: `feat(root): compone mcpServers de conocimiento+consultas y blinda el conjunto exacto contra mcp__operaciones__ (consultas-negocio-a2a-entrante, tarea 8)`.

9. [x] **`src/core/agents/definitions.ts`** (modificado, `:145`, ADR 4) — una entrada nueva, `CONSULTAS_TOOL_QUALIFIED_NAME`, en `CONVERSATIONAL_AGENT.allowedTools`. Queda en tres entradas propias de este change, más las que ya haya sumado el hermano. TDD exception (constante literal) — un test de contenido/conteo basta, sin ciclo propio. Test: `definitions.test.ts` — `allowedTools` **contiene** `CONSULTAS_TOOL_QUALIFIED_NAME` y el conteo total coordina con el estado real de `main` al momento del commit (mismo criterio de coordinación de conteo que la serie viene usando para arrays compartidos). Comando: `npm test -- definitions`. Commit: `feat(core): agrega mcp__consultas__consultar_negocio a allowedTools de CONVERSATIONAL_AGENT (consultas-negocio-a2a-entrante, tarea 9)`.

10. [x] **`src/main.ts`** (modificado, porción wiring de A2A entrante) — `createConsultas` construido **local** al bloque de A2A entrante (no entra a `StartupResult`, a diferencia de `createKnowledge` — sólo lo consume ese bloque, §9 de `design.md`): closures sobre `listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente`/`findActividadPorReferencia`/`listarSolicitudesPendientes`/`listEscalacionesReembolso(db, {estado: "reembolso_pendiente"})`, molde de `build-on-comando-empleado.ts:845-870`. `buildOnA2AEntrante({ ..., createConsultas })`. Depende de las tareas 6-9. Test primero: prueba de integración liviana (o extensión del test existente de arranque) que confirma que `buildOnA2AEntrante` recibe un `createConsultas` que produce un adaptador con `mcpServers` no vacío, sin que `createConsultas` aparezca en el objeto que arma `createKnowledge`/`StartupResult`. Comando: `npm test -- main`. Commit: `feat(root): cablea createConsultas local al bloque de A2A entrante en main.ts (consultas-negocio-a2a-entrante, tarea 10)`.

**Verificación de cierre de PR5**: `npm test && npm run typecheck` en verde; `git diff --stat main -- src/core/ventas/reporte.ts src/adapters/memory/repository.ts src/core/turn-selector/handle-turn.ts` **vacío**; el test de la tarea 8 falla si se inyecta manualmente `mcp__operaciones__*` en un doble (regresión intencional para confirmar que el test protege algo real, no un placeholder).

### PR6 — Agent Card, prompt, specs y documentación (tareas 11-15)

11. [x] **`src/adapters/a2a/agent-card.ts`** (modificado, `:61-62,64,80-91`, ADR 179/185) — `DESCRIPCION`, `SKILL_CONSULTA_ARNES.description`, `tags` (**sale** `"incidentes"` y `"proyectos"`, entra `"solicitudes"`; `"solo-lectura"` se conserva literal) y `examples` (los tres reescritos para ser literalmente respondibles por una de las 4 operaciones — texto exacto en `design.md` §6). `VERSION` sube a un minor (valor exacto lo fija el checkpoint junto al tag de cierre). Depende de la tarea 5 (los `examples` deben ser respondibles por operaciones ya implementadas). Test primero (`agent-card.test.ts`): **punto obligatorio 6** — comparación del objeto completo contra el nuevo literal (ADR 96 pto 1, nunca `toContain`); `tags` no contiene `"incidentes"` ni `"proyectos"`; cada `example` se verifica contra una lista cerrada de las 4 operaciones reales. Cubre spec `servidor-a2a-jsonrpc` delta completo (4 escenarios). Comando: `npm test -- agent-card`. Commit: `feat(adapters): corrige Agent Card a las 4 capacidades reales, retira incidentes y proyectos de tags (consultas-negocio-a2a-entrante, tarea 11)`.

12. [x] **`src/core/agents/a2a-entrante-prompt.ts`** (modificado, `:53-71`, ADR 179) — se agrega la instrucción de **usar `consultar_negocio`** antes de responder con una generalidad (el síntoma que originó el change, "Hallazgo 1"). **La línea de limitación de sólo lectura (`:62-64`) se conserva literal y sin cambio.** Depende de la tarea 6 (referencia el nombre real de la tool). Test primero (`a2a-entrante-prompt.test.ts`): el prompt generado contiene la instrucción nueva de uso de la tool; la línea de sólo-lectura (`:62-64`) sigue byte por byte igual (snapshot/comparación exacta de ese fragmento); la línea "no podés delegar a otro agente" (`:63` según numeración vigente) tampoco cambia. Comando: `npm test -- a2a-entrante-prompt`. Commit: `feat(core): agrega instruccion de uso de consultar_negocio al prompt sintetico entrante (consultas-negocio-a2a-entrante, tarea 12)`.

13. [x] **Verificación de consistencia de los 5 `specs/`** (ya escritos y comprometidos en la fase `sdd-spec` — sin implementación propia en esta tarea) — confirmar contra el código final de las tareas 1-12: `git diff --stat main -- src/core/` para el delta de `solicitud-a2a-entrante` sólo muestra archivos nuevos de las tareas 1-3 y 7 (nunca una edición de `handle-turn.ts`); el delta de `servidor-a2a-jsonrpc` coincide palabra por palabra con el literal actualizado en la tarea 11; el delta de `reporte-comisiones-mensual` sigue siendo verdadero porque la tarea 5 nunca produce el reporte completo. TDD exception (specs, no código; verificación de consistencia, no ciclo rojo-verde). Commit (si hace falta algún ajuste menor de redacción): `docs(specs): confirma consistencia de los 5 specs contra la implementacion final (consultas-negocio-a2a-entrante, tarea 13)`.

14. [x] **`README.md`** **+ `docs/arc42/`** (modificados) — TDD exception (documentación). Documentan qué puede responder un agente externo por A2A entrante (las 4 operaciones) y qué no (cualquier escritura, identidad por llamador). Referencian el gate de merge de la sección de arriba como nota histórica para quien lea el historial de PRs. Commit: `docs: documenta las 4 consultas de negocio de solo lectura del turno A2A entrante (consultas-negocio-a2a-entrante, tarea 14)`.

15. [x] **Verificación manual del entregable** — TDD exception (sin código de producción). Cubre, como mínimo, los **Success Criteria** de `proposal.md`:
    - Las **tres preguntas de `examples`** del Agent Card corregido (tarea 11) se responden con datos reales de negocio, cerrando el "Hallazgo 1" de `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`.
    - `git diff` confirma **nueve** campos en `BuildOnA2AEntranteDeps` y las siete filas de la tabla del ADR 98 pto 2 intactas.
    - `hito-3.0-a2a-servidor/design.md` no aparece en el diff completo del change.
    - El test de conjunto exacto de `mcpServers` (tarea 8) fue ejecutado contra el `mcp__operaciones__*` real de `main` — no un doble hipotético — y falla si se lo inyecta manualmente.
    - `npm test`, typecheck y lint en verde; `src/core/` sigue sin importar de `src/adapters/*`.
    Evidencia en `docs/progreso/v3.5-consultas-negocio-a2a/`. Commit: `docs: evidencia de verificacion manual de las 4 consultas de negocio A2A entrantes (consultas-negocio-a2a-entrante, tarea 15)`.

---

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~852 (prod+test+docs, seis PR encadenadas) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (~85) → PR2 (~150) → PR3 (~270) → PR4 (~120) → PR5 ⛔gateada (~115) → PR6 (~113) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
```

### Reconciliación con `design.md` §12

| Archivo | Tareas | Líneas est. (impl+test) |
|---|---|---|
| `consulta-actividad-contract.ts`, `consulta-solicitudes-contract.ts`, `consulta-reembolsos-contract.ts` | 1-3 | ~85 |
| **Subtotal PR1** | 1-3 | **~85** |
| `consultas-negocio-tool.ts`, porción validación | 4 | ~150 |
| **Subtotal PR2** | 4 | **~150** |
| `consultas-negocio-tool.ts`, porción orquestación + recorte | 5 | ~270 |
| **Subtotal PR3** | 5 | **~270** |
| `adapters/consultas/index.ts` | 6 | ~120 |
| **Subtotal PR4** | 6 | **~120** |
| `build-on-a2a-entrante.ts` (firma + composición + 2 familias de test) | 7-8 | ~80 |
| `definitions.ts` | 9 | ~10 |
| `main.ts` | 10 | ~25 |
| **Subtotal PR5 ⛔** | 7-10 | **~115** |
| `agent-card.ts` (+ test literal) | 11 | ~60 |
| `a2a-entrante-prompt.ts` | 12 | ~18 |
| `specs/` (ya comprometidos, verificación) | 13 | ~0 neto |
| `README.md` + `docs/arc42/` | 14 | ~35 |
| `docs/progreso/` (evidencia) | 15 | ~0 neto en código |
| **Subtotal PR6** | 11-15 | **~113** |
| **Total** | | **~852** |

**Por qué seis PR y no dos (a diferencia de `comando-visibilidad-a2a-entrante`)**: el total estimado (~852) es mayor que el de ese precedente (~675) y, sobre todo, `consultas-negocio-tool.ts` concentra dos responsabilidades densas por separado auditables (whitelist de entrada vs. orquestación+recorte de salida) que juntas superarían el presupuesto de 400 líneas en una sola PR. El corte de `proposal.md` R8 ("(1) puertos+tool pura+tests; (2) adaptador+cableado+ADR176; (3) card+prompt+docs") es el punto de partida; este documento lo subdivide más fino porque (a) el ADR 176 no puede compartir PR con el adaptador sin violar el gate de merge de la sección superior, y (b) la pieza "tool pura" por sí sola ya ronda las 420 líneas repartidas en dos responsabilidades separables.

## Después de la tarea 15

- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este documento, las 5 specs y `design.md`, con atención especial a: **el recorte en negativo del ADR 180** (tarea 5 — es R2, el riesgo de seguridad principal), **la igualdad de conjunto del ADR 176** (tarea 8 — debe fallar contra el nombre real de `mcp__operaciones__*`, no uno hipotético) y **el gate de merge** (confirmar en el historial de PRs que PR5 se abrió después del merge real del hermano).
- Antes de abrir PR5: confirmar en `git log main` que `operaciones-negocio-conversacionales` ya mergeó. Si `comandos-administracion-empleados` también debía preceder a este change y aún no mergeó, PR5 espera igual — el gate de este documento es sobre `operaciones-negocio-conversacionales` específicamente (colisión de archivo verificada), no una regla general de "esperar a todos".
- Si aprueba: checklist de cierre de `AGENTS.md` (Reviewer aprobado, `docs/progreso/v3.5-consultas-negocio-a2a/` completo con las tres preguntas del card respondidas), tag `v3.5.0` (numeración a confirmar por el checkpoint).

---

**Nota de formato**: mismo criterio que `definicion-skills/tasks.md`, `comando-reporte-comisiones/tasks.md`, `comando-cancelar-solicitud/tasks.md` y `comando-visibilidad-a2a-entrante/tasks.md` — se sigue el formato extenso ya establecido por `proposal.md`, las 5 `specs/` y `design.md` de este mismo change, en vez del tope de 530 palabras de la skill `sdd-tasks`.
