# Diseño técnico: Consultas de negocio de sólo lectura para el turno A2A entrante

**Entra con**: [`proposal.md`](proposal.md) (ADR 174-180, checkpoint humano ya resuelto — ver §0) · capabilities nuevas `consultas-negocio-a2a`, `turno-a2a-entrante-solo-lectura` (a verificar/crear por `sdd-spec`) · delta de `solicitud-a2a-entrante` y de `agent-card-a2a` (nombre a confirmar por `sdd-spec`).

**Alcance de este documento**: el *cómo* — resuelve **RD-80 a RD-86** (las siete reservadas por la propuesta) con el código real a la vista, el molde exacto del wrapper MCP, los cuatro puertos angostos, el noveno campo de `BuildOnA2AEntranteDeps`, el test de aislamiento de `mcpServers`, el texto exacto del Agent Card, y el mecanismo concreto de recorte del ADR 180. No es `tasks.md` ni `specs/`.

**Numeración — reverificada, no heredada**: techo real **ADR 180** / **RD-86**, ambos en `proposal.md` de este mismo change (líneas 128-368, sección "Decisiones diferidas a `sdd-design`"). Grep de control sobre `openspec/changes/*` confirma que ningún otro change abrió ADR/RD por encima de eso hasta el momento de esta lectura. **Este diseño abre en ADR 181** y resuelve las siete RD sin dejar ninguna pendiente.

---

## 0. Checkpoint humano — decisiones ya cerradas, no se reabren acá

1. **La promesa "incidentes" del Agent Card se elimina** (RD-84 resuelta en ese sentido: no hay entidad de dominio que la respalde). §6 da el texto exacto.
2. **ADR 98 enmendado a nueve campos** — aprobado. §9 baja el campo a firma y wiring concretos.
3. **R2 (fuga de datos personales) se acepta con el recorte del ADR 180 como mitigación** — no existe identidad por llamador A2A hoy, ni un caller externo concreto nombrado; el arnés expone A2A para demostrar operaciones reales de un requisito del proyecto, no para una integración productiva viva. §7 fija el recorte exacto por operación.

---

## 1. Resumen de la arquitectura elegida

**Un** wrapper MCP nuevo (`mcp__consultas__consultar_negocio`, ADR 178 ya decidido por la propuesta), **cuatro** puertos de lectura (uno reusado, tres nuevos), **una** pieza de lógica pura que orquesta los cuatro y aplica el recorte, **cero** puertos de escritura, **cero** campos de identidad de empleado.

```
 ┌─ Puertos de lectura (core/*, sin imports de adapters/SDK) ───────────────┐
 │  core/ventas/reporte-contract.ts        REPORTE — ReporteStorePort      │
 │    (REUSADO tal cual, ADR 177 pto 3, cero cambios)                       │
 │  core/actividad/consulta-actividad-contract.ts   ★ NUEVO (ADR 187)      │
 │  core/solicitudes/consulta-solicitudes-contract.ts ★ NUEVO (ADR 182)    │
 │  core/ventas/consulta-reembolsos-contract.ts     ★ NUEVO (ADR 182)      │
 └───────────────────────────────────────────────────────────────────────────┘
                     │ ConsultasNegocioToolDeps (bolsa plana, molde KnowledgeToolDeps)
 ┌─ src/core/agents/consultas-negocio-tool.ts ★ NUEVO ──────────────────────┐
 │  CONSULTAS_MCP_SERVER_NAME/TOOL_NAME/TOOL_QUALIFIED_NAME (ADR 182)       │
 │  validarConsultaNegocio(raw) → OperacionConsulta | rechazo (ADR 184)     │
 │  handleConsultaNegocio(input, deps) → texto — NUNCA lanza (molde         │
 │    knowledge-tool.ts §"contrato no negociable")                          │
 │  Recorte ADR 180 vive ACÁ, no en el prompt (§7)                          │
 └───────────────────────────────────────────────────────────────────────────┘
                     │
 ┌─ src/adapters/consultas/index.ts ★ NUEVO, molde adapters/knowledge/ ────┐
 │  createConsultasAdapter({casoId, reporteStore, actividadPort,           │
 │    solicitudesPort, reembolsosPort, logEvent}) → ConsultasNegocioAdapter │
 │  createSdkMcpServer + tool(schema zod plano, ADR 184)                    │
 └───────────────────────────────────────────────────────────────────────────┘
                     │ { mcpServers } — SIN `feedback` (ADR 181)
 ┌─ src/build-on-a2a-entrante.ts (MODIFICADO) ──────────────────────────────┐
 │  BuildOnA2AEntranteDeps: NOVENO campo `createConsultas` (§9)             │
 │  ejecutarTurno: mcpServers = { ...knowledge.mcpServers,                  │
 │                                 ...consultas.mcpServers }                │
 └───────────────────────────────────────────────────────────────────────────┘
                     │
 ┌─ src/main.ts (MODIFICADO) ────────────────────────────────────────────────┐
 │  createConsultas construido LOCAL al bloque de wiring de A2A entrante    │
 │  (NO entra a `StartupResult` — a diferencia de `createKnowledge`, no lo  │
 │  comparte ninguna otra fuente de turnos, §9)                             │
 └───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ADR 181 (RD-80): `ConsultasNegocioAdapter` es `{ mcpServers }` — **sin** `feedback`

**Contexto**. `KnowledgeAdapter` (`adapters/knowledge/index.ts:60-64`) es `{ mcpServers, feedback: KnowledgeFeedbackPort }`. `feedback` existe porque `query_knowledge_base` cita nodos del vault vía un `CitedNodesRecorder` compartido, y `handleTurn` necesita drenarlo después de cerrar el turno (`saveTurnResult`/`discardPendingCitations`, `handle-turn.ts:199,263-301`) — **ese campo es opcional** en `HandleTurnDeps` (`knowledgeFeedback?: KnowledgeFeedbackPort`).

**Decisión**:

1. **`ConsultasNegocioAdapter` tiene un solo campo**: `readonly mcpServers: NonNullable<Options["mcpServers"]>`. Ninguna de las cuatro operaciones cita nodos de un vault ni acumula estado entre el momento en que responde y el cierre del turno — no hay nada que drenar después.
2. **`ejecutarTurno` sigue pasando `knowledgeFeedback: knowledge.feedback` sin cambios** — `consultas` nunca aparece en ese campo. `handleTurn` no gana ningún parámetro nuevo.
3. **Ningún archivo de este change importa `KnowledgeFeedbackPort`.** Es una señal barata y visible en el review de que la superficie nueva no intenta imitar un mecanismo que no necesita.

**Alternativas consideradas**: *replicar `{ mcpServers, feedback }` con un `feedback` no-op* — rechazada, agrega un campo sin consumidor (el vicio que ADR 175 pto 1 ya rechazó tres veces por nombre en este repo) y obligaría a `handleTurn` a invocar dos `feedback` en vez de uno, sin ganancia.

---

## 3. ADR 182 (RD-81): cuatro puertos angostos, **no** un `ConsultasNegocioPort` consolidado — y por qué no hay un `consultas-contract.ts` que los agrupe

**Decisión**:

1. **Se mantienen los cuatro puertos separados** (uno reusado, tres nuevos), mismo criterio del ADR 121/177: cada uno tiene una sola responsabilidad y comparte cero invariantes con los otros tres. Consolidarlos en un `ConsultasNegocioPort` de doce métodos mezclaría cuatro dominios (ventas, actividad, solicitudes, reembolsos) en un contrato — exactamente lo que el ADR 121 ya rechazó para `VentaStorePort`/`ReporteStorePort`.
2. **A diferencia de `knowledge-contract.ts`/`operaciones-contract.ts`, no hay un `consultas-contract.ts`.** Esos dos archivos existen porque *conocimiento* y *operaciones* son, cada uno, UN dominio propio que posee sus constantes (`*_MCP_SERVER_NAME`, `*_TOOL_NAME`). **"Consultas" no es un dominio — es un agregador de lectura de cuatro dominios ajenos.** Inventarle un `consultas-contract.ts` propio crearía un quinto módulo sin responsabilidad de dominio real, solo para alojar tres constantes. Esas constantes se declaran junto a la lógica que las usa: `src/core/agents/consultas-negocio-tool.ts`.
3. **Los tres puertos nuevos, contratos exactos**:

   ```ts
   // src/core/actividad/consulta-actividad-contract.ts — sin imports salvo activity-contract.js
   export interface ActividadResumen {
     readonly estado: ActividadEstado;
     readonly updatedAt: string;
   }
   export interface ConsultaActividadPort {
     buscarPorReferencia(input: {
       readonly proyectoId: string;
       readonly referenciaExterna: string;
     }): ActividadResumen | undefined;
   }
   ```

   ```ts
   // src/core/solicitudes/consulta-solicitudes-contract.ts — sin imports salvo solicitudes-contract.js
   export interface ConsultaSolicitudesPort {
     /** Reusa `listarSolicitudesPendientes` SIN filtro — la A2A entrante no tiene `solicitanteId` que filtrar (ADR 180 pto 1). */
     listarPendientes(): readonly SolicitudInterna[];
   }
   ```

   ```ts
   // src/core/ventas/consulta-reembolsos-contract.ts — sin imports salvo ventas-contract.js (vocabulario de estado)
   export interface ConsultaReembolsosPort {
     /** Cerrado sobre `estado: "reembolso_pendiente"` desde el composition root — el puerto no acepta un `estado` arbitrario. */
     listPendientes(): readonly EscalacionReembolsoRow[];
   }
   ```

4. **Corrección puntual sobre la tabla de la propuesta (Scope, fila "Escalaciones / ventas en reembolso pendiente")**: esa fila cita `listEscalacionesReembolso`, `listVentasEnReembolsoPendiente` **y** `listComisionesPorPeriodo` como delegados de una sola operación. Verificado: **`listComisionesPorPeriodo` no aporta nada a esta operación** — solo lo usa `agruparReporteMensual` para el reporte de comisiones (operación distinta). `listEscalacionesReembolso(db, {estado: "reembolso_pendiente"})` ya es un superconjunto de columnas de `listVentasEnReembolsoPendiente` (mismas filas, más `rechazadaPor`/`rechazadaAt`/`reaperturasPrevias`), así que **`ConsultaReembolsosPort` expone un solo método** y `listVentasEnReembolsoPendiente` queda usado únicamente donde ya estaba: dentro de `ReporteStorePort`, para armar `ReporteMensual.reembolsosPendientes` que `agruparReporteMensual` necesita como input. Se documenta como corrección de diseño contra la propuesta, mismo criterio que `autorizacion-empleado/design.md` (ADR 161) y `operaciones-negocio-conversacionales/design.md` (ADR 164) ya aplicaron sobre sus propias propuestas.
5. **`ConsultasNegocioToolDeps` (bolsa plana, molde `KnowledgeToolDeps`) agrupa los cuatro puertos + `logEvent` + `casoId`** dentro de `consultas-negocio-tool.ts` — es plumbing de inyección de dependencias de la función pura, **no** un puerto ni una fusión semántica: cada campo sigue siendo un colaborador distinto y testeable con su propio doble, exactamente como `KnowledgeToolDeps` agrupa `config`+`recorder`+`runQuery`+`logEvent` sin que eso implique que esos cuatro formen "un solo contrato".

**Alternativas consideradas**: *un `ConsultasNegocioPort` con doce métodos* — rechazada (pto 1). *Cuatro `createXStore` factories en vez de closures inline* — rechazada, ADR 177 pto 4 ya fija el estilo de closures directos sin fábrica, y este change no tiene motivo para desviarse.

---

## 4. ADR 183 (RD-82): sin transacción de snapshot — las cuatro lecturas son independientes entre sí

**Decisión**: **no se envuelve nada en `db.transaction()`.** El ADR 175 pto 5 ya aceptó que las lecturas del turno entrante sean "consistentes-en-el-momento, no transaccionales entre sí" — cada una de las cuatro operaciones de esta tool es, además, **una invocación separada de la tool** (el modelo la llama una vez por pregunta), nunca las cuatro dentro de la misma llamada. No hay un caso de uso real donde el mismo `CallToolResult` necesite dos lecturas atómicas entre sí — a diferencia de `crearCasoConSolicitud` (`build-on-a2a-entrante.ts:274-292`), que sí necesita atomicidad porque las dos escrituras deben aparecer juntas o ninguna. Reabrir esto exigiría, además, decidir una clave de serialización que el ADR 175 ya determinó que no existe (no hay región crítica en lecturas).

**Alternativas consideradas**: *envolver `resolverPeriodoReporte`+`agruparReporteMensual` con sus dos lecturas del `ReporteStorePort` en una transacción de sólo lectura* — rechazada. `better-sqlite3` no tiene modo "solo lectura" nativo distinto de no escribir, y envolver dos `SELECT` en `db.transaction()` no compra nada que SQLite no dé ya por WAL/lectura consistente de una conexión síncrona — sería ceremonia sin efecto observable.

---

## 5. ADR 184 (RD-83): schema plano + validación estricta en el núcleo — mismo molde que `mcp__operaciones__operacion_negocio`

**Contexto**. ADR 178 (propuesta) ya decidió **una** tool. Falta la forma concreta del `tool()`/schema. El sibling `operaciones-negocio-conversacionales` (ADR 163 pto 3) ya resolvió el mismo problema estructural — "una tool, N operaciones" — con un objeto zod plano (todos los campos opcionales a nivel del wrapper) más una validación estricta en el núcleo que exige exactamente los campos de la operación pedida y rechaza claves extra.

**Decisión**:

1. **Se reusa ese molde, sin el `z.discriminatedUnion` de zod.** Introducir dos formas distintas para el mismo problema ("una tool MCP, varias operaciones discriminadas") en el mismo repo sería inconsistencia gratuita — un reviewer que ya conoce `adapters/operaciones/index.ts` reconoce `adapters/consultas/index.ts` de un vistazo.
2. **Schema del wrapper** (`src/adapters/consultas/index.ts`):

   ```ts
   {
     operacion: z.enum([
       "reporte_comisiones", "estado_actividad",
       "solicitudes_pendientes", "reembolsos_pendientes",
     ]),
     periodo: z.string().optional(),         // solo reporte_comisiones
     proyectoId: z.string().optional(),      // solo estado_actividad
     referenciaExterna: z.string().optional(),// solo estado_actividad
   }
   ```

3. **`validarConsultaNegocio(raw)` en el núcleo** (`consultas-negocio-tool.ts`) exige EXACTAMENTE los campos de la fila que corresponde y rechaza cualquier clave extra — mismo criterio de whitelist que `validar-operacion.ts` del hermano y que `definicion-skills` ADR 110 aplicó al frontmatter. `solicitudes_pendientes`/`reembolsos_pendientes` no aceptan ningún campo adicional (ni `periodo` ni `proyectoId`) — es la señal, verificable por test, de que esas dos operaciones no tienen forma de filtrar por identidad porque no reciben ningún parámetro que pudiera intentarlo.
4. **Diferencia deliberada con el schema del hermano**: acá no hay ningún campo `empleadoId`/`solicitanteId`/`token` — ninguna de las cuatro operaciones necesita resolver identidad, porque ninguna es un self-service (ADR 180 pto 1). El único campo "sensible" es `periodo` (formato `YYYY-MM`, revalidado por `resolverPeriodoReporte`, la misma función pura ya testeada).

**Alternativas consideradas**: *`z.discriminatedUnion("operacion", [...])`* — más type-safe a nivel de zod, pero introduce un segundo patrón para el mismo problema en el mismo repo; se anota como mejora futura no bloqueante si `sdd-tasks` la prefiere, pero **el molde plano es el default de este diseño** por consistencia con el hermano.

---

## 6. ADR 185 (RD-84): "incidentes" sale del Agent Card — texto exacto

**Decisión**: no se encontró ninguna entidad de dominio "incidente" con datos consultables (`ACTIVIDAD_TIPO_INCIDENTE` existe como *valor de enum* en `activity-contract.ts:22`, pero **ninguna** actividad de este repo se crea hoy con ese tipo — ADR 5 del hito 3 solo ejercita `pr_review`). Sin fuente real, la palabra sale, tal como fija RD-84.

**Antes** (`agent-card.ts:61-62,80-91`):

```ts
const DESCRIPCION =
  "Arnés de agentes de IA de una empresa. Responde consultas sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas.";
...
const SKILL_CONSULTA_ARNES: AgentCardSkill = {
  ...
  description:
    "Respondé una consulta en lenguaje natural sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas en el arnés. Es una consulta de sólo lectura: el arnés no modifica nada a pedido de un agente externo.",
  tags: ["consulta", "estado", "proyectos", "incidentes", "solo-lectura"],
  examples: [
    "¿En qué estado está la revisión del PR 42 del proyecto X?",
    "¿Qué incidentes abiertos hay hoy?",
    "¿Cuántas ventas quedaron pendientes de confirmación esta semana?",
  ],
};
```

**Después**:

```ts
const DESCRIPCION =
  "Arnés de agentes de IA de una empresa. Responde consultas de sólo lectura sobre el estado de actividades de desarrollo (PRs), solicitudes internas pendientes, el reporte de comisiones por período y los reembolsos pendientes de aprobación.";
...
const SKILL_CONSULTA_ARNES: AgentCardSkill = {
  ...
  description:
    "Respondé una consulta en lenguaje natural sobre el estado de actividades de desarrollo, solicitudes internas pendientes, comisiones por período y reembolsos pendientes de aprobación. Es una consulta de sólo lectura y agregada: el arnés no modifica nada a pedido de un agente externo ni devuelve datos personales de empleados o clientes.",
  tags: ["consulta", "estado", "solicitudes", "solo-lectura"],
  examples: [
    "¿En qué estado está la revisión del PR 42 del proyecto X?",
    "¿Cuántas solicitudes internas quedaron pendientes de aprobación?",
    "¿Cuál fue el total comisionado en el período actual?",
  ],
};
```

**Puntos no negociables de este diff**:

1. **El tag `"incidentes"` también sale** — la propuesta (ADR 179) solo mencionó `DESCRIPCION`/`description`/`examples`, pero `tags` es igual de público en el contrato de descubrimiento A2A que `description`; dejarlo sería la misma promesa sin respaldo, solo en otro campo. Se reemplaza por `"solicitudes"`, que sí mapea a una operación real.
2. **`"solo-lectura"` se conserva literal**, en `tags` y en la frase de `description` (ADR 96 pto 3, ADR 179 pto 3, sin cambio).
3. **`"proyectos"` sale de `tags`** por el mismo criterio del pto 1: la capability real es "actividades por proyecto", no "proyectos" como entidad consultable en sí misma (no hay operación que liste proyectos).
4. **`VERSION`** (`agent-card.ts:64`, hoy `"3.0.0"`): sube a un **minor** por ser una capacidad nueva compatible hacia atrás — valor exacto (`"3.1.0"` sugerido) lo fija el checkpoint junto con el tag de cierre, como ya anticipó ADR 179 pto 4.
5. **El test literal del card** (ADR 96 pto 1) se actualiza en el mismo commit, comparando el objeto completo contra el nuevo literal — nunca un `toContain`.

---

## 7. ADR 186 (RD-85): granularidad exacta del recorte — y por qué `formatearReporteMensual` **no** se reusa para A2A

**Verificación cruzada obligatoria (`operaciones-negocio-conversacionales/design.md`, leído completo)**: ese diseño tiene **cinco** operaciones (`resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `registrar_venta` vía ADR 171) — **ninguna es un reporte de ventas/comisiones de sólo lectura**. No existe, al momento de esta lectura, una "sexta operación" de reporte agregado en el turno de empleado autenticado. El precedente real de "mismo dato, dos superficies con distinto nivel de detalle" **ya existe hoy en `main`**, sin necesidad de inventar uno: `/reporte-comisiones` (TUI/HTTP, empleado autenticado, `build-on-comando-empleado.ts:860-865` + `formatearReporteMensual`) imprime **la tabla completa por vendedor** (`vendedorNombre`, montos individuales) porque corre bajo la sesión de un empleado con credenciales verificadas. Esa superficie **no cambia por este change**.

**El hallazgo que corrige la cita de la propuesta**: el Approach (pieza 2) y la tabla de Scope citan `formatearReporteMensual` como delegado de la operación `reporte_comisiones` de A2A. **Verificado que no se puede reusar tal cual**: `formatearReporteMensual` (`reporte.ts:283-289`) llama a `formatearTablaComparativa` y `formatearSeccionReembolsos`, que imprimen `vendedorNombre` por fila y `clienteId`/`vendedorNombre` por reembolso — exactamente los campos que el test en negativo del ADR 180 pto 4 debe demostrar ausentes. Reusarla produciría una fuga literal en el primer test que se escriba.

**Decisión**:

1. **Se reusa `resolverPeriodoReporte` + `agruparReporteMensual` (agregación pura, sin cambios) — NO `formatearReporteMensual`.** `agruparReporteMensual` ya calcula los totales que hacen falta (`ReporteMensual.totalComisionado`, y por fila `ventasConfirmadas`/`montoVendido`/`ventasConReembolso`) sin que esos totales por sí solos contengan nombre ni id de persona — el dato sensible está en **qué fila pertenece a qué vendedor**, no en los números agregados.
2. **`consultas-negocio-tool.ts` suma esas filas** para producir el texto de A2A — una función NUEVA, pequeña, sin nombre compartido con `formatearReporteMensual` para que no se confundan:

   | Operación | Se agrega/incluye | Se omite explícitamente |
   |---|---|---|
   | `reporte_comisiones` | `periodo`, cantidad de vendedores con ventas (`filas.length`), suma de `ventasConfirmadas`, suma de `montoVendido`, `totalComisionado` (ya viene sumado), suma de `ventasConReembolso` | **Toda la tabla `filas`** (`vendedorId`, `vendedorNombre` por fila) y **todo `reembolsosPendientes`** (esa lista la cubre la operación `reembolsos_pendientes`, no ésta) |
   | `estado_actividad` | `referenciaExterna` y `proyectoId` (ecos de lo que el propio llamador mandó), `estado`, `updatedAt` | `responsableId`, `id` interno de la actividad, `casoId` |
   | `solicitudes_pendientes` | Conteo total, y desglose por `tipo` (`vacaciones`/`gasto`/`reclamo_comision`) — el `estado` no aporta desglose porque el puerto ya filtra `SOLICITUD_ESTADO_PENDIENTE` | `solicitanteId`, `detalle` (texto libre), `id` de cada solicitud |
   | `reembolsos_pendientes` | Conteo total, suma de `monto` | `vendedorId`, `vendedorNombre`, `clienteId`, `ventaId`, `casoId`, `rechazadaPor` |

3. **Excepción parcial deliberada (ADR 180 pto 5, sin cambios)**: `estado_actividad` es la única operación que resuelve **una** entidad puntual, no una enumeración — igual devuelve `estado`/`updatedAt`, nunca `responsableId`.
4. **Tests en negativo, uno por operación con datos sensibles**: dobles de `ReporteStorePort`/`ConsultaSolicitudesPort`/`ConsultaReembolsosPort` que SÍ traen `vendedorNombre`/`clienteId`/`solicitanteId`/`detalle`, y el `assert` es que el texto de salida no los contiene — ni siquiera truncados (un `includes` parcial del nombre también cuenta como fuga).

**Alternativas consideradas**: *Reusar `formatearReporteMensual` y sólo quitarle `vendedorNombre` con una edición* — rechazada explícitamente: **editar `reporte.ts` está fuera de alcance** (Out of Scope de la propuesta, verificable por `git diff` vacío sobre ese archivo) y bifurcar su salida con un flag de "modo A2A" acoplaría una función de dominio general a un concern de una sola superficie externa.

---

## 8. ADR 187 (RD-86): `estado_actividad` acepta **sólo** `(proyectoId, referenciaExterna)` — `getActividadById` no se expone

**Contexto**. `getActividadById` (`repository.ts:465-472`) no está en `ActivityStorePort` — vive suelto en el repositorio, indexado por el `id` interno (UUID) de `actividades`. Ningún contrato público de este repo (Agent Card incluido) expone ese id a un llamador externo.

**Decisión**: **`ConsultaActividadPort.buscarPorReferencia` acepta únicamente `{ proyectoId, referenciaExterna }`**, cerrado sobre `findActividadPorReferencia(db, proyectoId, referenciaExterna)` — el mismo par que ya usa el flujo de webhooks para resolver una actividad existente, y el mismo par que los ejemplos del Agent Card usan ("PR 42 del proyecto X"). `getActividadById` **no se toca ni se expone**: no hay ninguna vía por la que un agente externo pueda conocer el `id` interno para pedirlo, e inventarle un camino sería agregar superficie sin caso de uso (mismo criterio que el ADR 150 pto 2 del hermano).

**Alternativas consideradas**: *aceptar también `actividadId` como alternativa opcional* — rechazada, RD-86 lo planteaba como posibilidad pero no hay ningún flujo de descubrimiento que le dé ese id a un llamador A2A; agregarlo sería una superficie muerta, nunca alcanzable en la práctica.

---

## 9. El noveno campo — firma exacta y wiring

**`src/build-on-a2a-entrante.ts`** (`BuildOnA2AEntranteDeps`, hoy ocho campos, `:82-92`):

```ts
export interface BuildOnA2AEntranteDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  /** NOVENO campo (ADR 174). Réplica en forma de `createKnowledge` — un `ConsultasNegocioAdapter` por caso. */
  readonly createConsultas: (casoId: string) => ConsultasNegocioAdapter;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
}
```

`ejecutarTurno` (mismo archivo, `:166-176`):

```ts
const prompt = buildSolicitudA2APrompt(texto);
const knowledge = createKnowledge(casoId);
const consultas = createConsultas(casoId);

const result = await handleTurn(casoId, prompt, {
  memory,
  hooks,
  candidateAgents: agents,
  ...(logDeps ? { logDeps } : {}),
  mcpServers: { ...knowledge.mcpServers, ...consultas.mcpServers },
  knowledgeFeedback: knowledge.feedback, // sin cambios — `consultas` no tiene feedback (ADR 181)
});
```

**`src/main.ts`**: `createConsultas` **no** entra a `StartupResult` junto a `createKnowledge` — `createKnowledge` vive ahí porque CUATRO fuentes de turno lo comparten (TUI, webhooks, web, A2A); `createConsultas` solo lo consume el bloque de A2A entrante (`:475`), así que se construye LOCAL a ese bloque, igual que `onSoporte`/`buildOnOperacionesEmpleado` se construyen locales a sus propios bloques:

```ts
// Junto al bloque de A2A entrante, antes de buildOnA2AEntrante(...)
const createConsultas = (casoId: string): ConsultasNegocioAdapter =>
  createConsultasAdapter({
    casoId,
    reporteStore: {
      listComisionesPorPeriodo: (periodo) => listComisionesPorPeriodo(db, periodo),
      listVentasEnReembolsoPendiente: () => listVentasEnReembolsoPendiente(db),
    },
    actividadPort: {
      buscarPorReferencia: (input) => {
        const actividad = findActividadPorReferencia(db, input.proyectoId, input.referenciaExterna);
        return actividad ? { estado: actividad.estado, updatedAt: actividad.updatedAt } : undefined;
      },
    },
    solicitudesPort: { listarPendientes: () => listarSolicitudesPendientes(db, {}) },
    reembolsosPort: { listPendientes: () => listEscalacionesReembolso(db, { estado: "reembolso_pendiente" }) },
    logEvent: (event, fields) => logTurnEvent(casoId, event, fields),
  });

const a2aEntrante = buildOnA2AEntrante({ db, memory, hooks, agents, createKnowledge, createConsultas });
```

`doc-comment` de cabecera del módulo (`build-on-a2a-entrante.ts:13-19`) se actualiza citando ADR 174 — sigue diciendo "la escritura es inexpresable por firma", agregando que el noveno campo es una segunda fábrica de LECTURA, no una excepción al invariante.

---

## 10. Test de aislamiento de `mcpServers` (ADR 176) — diseño concreto

Molde exacto de `build-on-a2a-entrante.test.ts` (`handle-turn.js` mockeado entero, `mockedHandleTurn.mock.calls`):

```ts
it("compone mcpServers como la UNIÓN EXACTA de conocimiento + consultas — nunca incluye operaciones", async () => {
  const createKnowledge = () => ({
    mcpServers: { [KNOWLEDGE_MCP_SERVER_NAME]: {} as never },
    feedback: { saveTurnResult: vi.fn(), discardPendingCitations: vi.fn() },
  });
  const createConsultas = () => ({ mcpServers: { [CONSULTAS_MCP_SERVER_NAME]: {} as never } });

  mockedHandleTurn.mockResolvedValue({ responseText: "ok" } as HandleTurnResult);
  const { onSolicitudA2A } = buildOnA2AEntrante({ db, memory, hooks, agents, createKnowledge, createConsultas });
  const { turno } = await onSolicitudA2A({ ...INPUT_BASE, hayCupo: true });
  await turno;

  const depsPasadosAHandleTurn = mockedHandleTurn.mock.calls[0][2];
  // Igualdad de CONJUNTO, nunca `contains` — ADR 176 pto 2.
  expect(Object.keys(depsPasadosAHandleTurn.mcpServers).sort()).toEqual(
    [CONSULTAS_MCP_SERVER_NAME, KNOWLEDGE_MCP_SERVER_NAME].sort(),
  );
  // Escrito para el reviewer del change hermano (ADR 176 pto 4): el nombre
  // del servidor de `operaciones-negocio-conversacionales` NUNCA debe aparecer acá.
  expect(depsPasadosAHandleTurn.mcpServers).not.toHaveProperty("operaciones");
});
```

Complementa (no reemplaza) el test de **lista de imports** ya existente (`:418-442`, ADR 98 pto 3), que gana una aserción **positiva y nombrada** (ADR 174 pto 6, "aditiva, nunca `contains`"):

```ts
expect(importLines).toMatch(/consultas\/index\.js/); // el import nuevo, único y nombrado
```

---

## 11. Componentes — mapa capability → módulos

| Capability | Módulos | ¿1:1? |
|---|---|---|
| `consultas-negocio-a2a` | `core/agents/consultas-negocio-tool.ts` + los 3 `*-consulta-contract.ts` nuevos + `ReporteStorePort` (reusado) + `adapters/consultas/index.ts` | 1:N — cuatro operaciones, un módulo de orquestación |
| `turno-a2a-entrante-solo-lectura` | `build-on-a2a-entrante.ts` (noveno campo + composición de `mcpServers`) + su test de conjunto (§10) + el test de imports (§10) | 1:N — cableado de composición, se verifica distinto de la anterior (mismo criterio `definicion-skills`) |

---

## 12. Archivos — resumen

| Archivo | Acción | Resumen |
|---|---|---|
| `src/core/actividad/consulta-actividad-contract.ts` | Crear | `ConsultaActividadPort` (ADR 182, 187) |
| `src/core/solicitudes/consulta-solicitudes-contract.ts` | Crear | `ConsultaSolicitudesPort` (ADR 182) |
| `src/core/ventas/consulta-reembolsos-contract.ts` | Crear | `ConsultaReembolsosPort` (ADR 182) |
| `src/core/agents/consultas-negocio-tool.ts` | Crear | Constantes MCP + validación estricta (ADR 184) + orquestación + recorte (ADR 186). Nunca lanza |
| `src/adapters/consultas/index.ts` | Crear | `createConsultasAdapter`, molde `adapters/knowledge/index.ts`, schema zod plano (ADR 184) |
| `src/build-on-a2a-entrante.ts` | Modificar | Noveno campo (§9), `mcpServers` compuesto, doc-comment ADR 174 |
| `src/main.ts` | Modificar | `createConsultas` local al bloque de A2A entrante (§9) |
| `src/adapters/a2a/agent-card.ts` | Modificar | `DESCRIPCION`, `description`, `tags`, `examples`, `VERSION` (§6) |
| `src/core/agents/definitions.ts` | Modificar | +1 entrada en `allowedTools` de `CONVERSATIONAL_AGENT` (`mcp__consultas__consultar_negocio`) |
| `src/core/agents/a2a-entrante-prompt.ts` | Modificar | +instrucción de uso de la tool. Línea de sólo-lectura (`:62-64`) sin cambio |
| `src/core/ventas/reporte.ts`, `src/adapters/memory/repository.ts` | **Sin cambio** | Reuso literal — si aparecen en el diff, el alcance se filtró |
| Tests | Nuevo/Modificado | Card literal, imports (aditivo), conjunto de `mcpServers` (§10), recorte en negativo (§7 pto 4) |
| `docs/arc42/`, `README.md` | Modificar | Qué puede responder un agente externo y qué no |

---

## 13. Testing (TDD estricto)

| Archivo | Qué se agrega |
|---|---|
| `consulta-actividad-contract.test.ts`, `consulta-solicitudes-contract.test.ts`, `consulta-reembolsos-contract.test.ts` | Cero imports (molde `*-contract.test.ts`) |
| `consultas-negocio-tool.test.ts` | Las 4 operaciones con dobles de los 4 puertos. Clave extra en cualquier operación ⇒ rechazo. `periodo` inválido ⇒ mensaje de uso (reusa `resolverPeriodoReporte`). **Negativo** (ADR 180 pto 4): dobles con `vendedorNombre`/`clienteId`/`solicitanteId`/`detalle` ⇒ ausentes del texto. Nunca lanza, con un test por camino de falla de cada puerto (molde `handleKnowledgeQuery`) |
| `build-on-a2a-entrante.test.ts` | +test de conjunto exacto de `mcpServers` (§10) +assert aditivo de imports (§10). Regresión: los tests existentes de ADR 98 pto 3 siguen en verde sin relajarse |
| `agent-card.test.ts` | Literal completo actualizado (ADR 96 pto 1) — `tags` sin `"incidentes"`/`"proyectos"`, `examples` nuevos, `VERSION` nueva |
| `definitions.test.ts` | `CONVERSATIONAL_AGENT.allowedTools` pasa a 3 entradas (o 4 si el hermano ya mergeó) |

---

## 14. Migración / Rollout

Sin pasos nuevos respecto de `proposal.md`. Aditivo en el núcleo (puertos, tool, adaptador son archivos nuevos); revertir el cableado (`build-on-a2a-entrante.ts` vuelve a ocho campos, `main.ts` deja de construir `createConsultas`) devuelve el turno entrante a su comportamiento exacto de hoy. **Sin migración de base de datos.**

## 15. Open Questions

Ninguna bloqueante — las siete RD (80 a 86) quedan resueltas en este documento. No bloqueante para `sdd-tasks`: el texto exacto de `examples`/`description` del Agent Card (§6) puede ajustarse por copy sin impacto arquitectónico, siempre que seas cero mención de "incidentes" y que cada ejemplo siga siendo literalmente respondible por una de las cuatro operaciones.

---

**Nota de proceso**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente; esta fase corrió sin herramienta de shell disponible (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), misma limitación ya documentada por `autorizacion-empleado/design.md` y `operaciones-negocio-conversacionales/design.md`. Se compensó con lectura directa e íntegra de: `proposal.md` de este change (completo), `build-on-a2a-entrante.ts` (327 líneas, entero), `adapters/knowledge/knowledge-tool.ts` y `adapters/knowledge/index.ts` (enteros, el molde), `core/ventas/reporte-contract.ts` y `reporte.ts` (enteros), `core/activity/activity-contract.ts` y `core/solicitudes/solicitudes-contract.ts` (enteros), `adapters/memory/repository.ts:440-472,1080-1290` (`getActividadById`, `listComisionesPorPeriodo`, `listVentasEnReembolsoPendiente`, `listEscalacionesReembolso`), `core/agents/definitions.ts` (grep de `allowedTools`/`CONVERSATIONAL_AGENT`), `adapters/a2a/agent-card.ts` (entero), `core/agents/a2a-entrante-prompt.ts` (entero), `main.ts` (grep de `createKnowledge`/wiring de A2A entrante), `build-on-comando-empleado.ts:845-870` (molde de closures inline para `reporteStore`), `build-on-a2a-entrante.test.ts` (grep del mock de `handle-turn.js` y del test de lista de imports), y **`operaciones-negocio-conversacionales/design.md` completo (527 líneas, dos pasadas)** para la verificación cruzada del §7 — **hallazgo de esa lectura**: ese diseño tiene cinco operaciones, ninguna es un reporte de ventas/comisiones de sólo lectura; no existe la "sexta operación" mencionada como hipótesis de partida para esta fase, así que la comparación de trimming se hizo contra el precedente real existente (`/reporte-comisiones` de `build-on-comando-empleado.ts`) en vez de un artefacto que no está en el repo. También `autorizacion-empleado/design.md` (completo, para el formato y el nivel de rigor de este documento). Toda cita de línea corresponde a los archivos tal como existían al momento de esta lectura. Se recomienda correr `graphify update .` una vez persistido este archivo.
