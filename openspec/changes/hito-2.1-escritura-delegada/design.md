> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió **sin herramienta Bash disponible** (sólo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por `exploration.md`, `proposal.md` y los cuatro archivos de `specs/` de este change, y por todo el linaje `hito-1.2` → `hito-2.0`. Se compensó con lectura directa: `AGENTS.md` completo, `src/adapters/knowledge/{graphify-cli,knowledge-tool,index,config}.ts`, `src/core/knowledge/knowledge-contract.ts`, `src/core/agents/definitions.ts`, `src/core/turn-selector/{invoke-model,handle-turn}.ts`, `src/core/commands/{comando-empleado,registro-acciones-contract}.ts`, `src/build-on-comando-empleado.ts`, `src/main.ts`, `src/adapters/memory/migrations/index.ts`, `0005_registro_acciones_empleado.ts`, `repository.ts` (`updateCaso`, `resolverEscalacionTransaccional`), `openspec/config.yaml`, `package.json`, y `src/test/`. Cada firma citada como "existente" fue verificada contra el archivo real en esta sesión.

# Diseño técnico: Escritura delegada del Developer vía worktree aislado (v2.1.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 57-61, R1-R14) · [`specs/`](specs/) (4 archivos: `propuesta-cambio-hitl`, `escritura-aislada-worktree`, delta `MODIFIED` sobre `delegacion-subagentes`, delta `ADDED` sobre `revision-pr-por-roles`) · [`exploration.md`](exploration.md) · [`hito-2.0-delegacion-subagentes/design.md`](../hito-2.0-delegacion-subagentes/design.md) §5.2, §5.3, §5.4, §6, §15.

**Rama**: `hito/v2.1-escritura-delegada` · **Tag**: `v2.1.0` · **Progreso**: `docs/progreso/v2.1-escritura-delegada/`.

**Numeración de ADR**: la propuesta cerró en el **61**. Este diseño abre en el **62** y llega al **70** — nueve decisiones que aparecieron **al bajar la propuesta a firmas reales** y que ningún ADR 57-61 podía anticipar. Riesgos residuales: **RD-9 a RD-18** (la numeración que `hito-2.0/design.md` §15 dejó reservada; RD-1 a RD-8 son de `v2.0.0` y siguen vigentes).

**Confirmado por el checkpoint humano y NO reabierto por este documento**: tope de patch de 64 KB con **rechazo** (no truncado), aceptando la discrepancia con `TAREA_DELEGADA_MAX_CHARS = 8_000` del Reviewer; el relajamiento del invariante de seguridad de `v2.0.0` a *"ningún rol tiene `Write`/`Edit` fuera de un worktree aislado con su propio `cwd`, entregados en el mismo acto"*; las **dos** capabilities separadas (`propuesta-cambio-hitl`, `escritura-aislada-worktree`); y la delta sobre `revision-pr-por-roles`.

**Resuelto por el checkpoint humano sobre hallazgos de esta fase** (§15 los anota como cerrados, el Reviewer no debe leerlos como abiertos):

- **ADR 63 — `ALTER TABLE registro_acciones_empleado ADD COLUMN propuesta_id` (nullable, aditiva): APROBADO.**
- **RD-12 — la máquina de estados de `propuestas_cambio` es de TRES valores**, no cuatro: `pendiente_aprobacion_humana` / `aplicada` / `descartada`. Se eliminó `no_aplicable` **del estado persistido** en vez de inventarle un escritor. `specs/propuesta-cambio-hitl/spec.md` se corrigió en el mismo acto. **No confundir** con el tag `"no_aplicable"` de `ResolucionHitlResult` (`hitl-contract.ts`, ADR 50), que es el desenlace de una *invocación* del resolvedor, sigue en uso y **no se toca**.

---

## 0. Gate de secuencia — `sdd-apply` NO arranca sin esto

**Esta sección va primero a propósito. No es una nota al pie: es una precondición de proceso del mismo rango que el checkpoint humano.**

Este diseño **no se puede aplicar** hasta que `hito-2.0-delegacion-subagentes` esté **mergeado a `main`** con su checklist de cierre completo y **`src/core/agents/subagents.ts` existiendo ahí como código real**.

**Verificación ejecutable, las tres condiciones juntas** (si falta una, `sdd-apply` se detiene y reporta `blocked`):

| # | Comprobación | Comando | Estado hoy |
|---|---|---|---|
| 1 | El merge de `v2.0.0` está en `main` | `git log main --oneline \| rg v2.0` | **No cumple** |
| 2 | `InvocarSubagente` / `SUBAGENT_REGISTRY` son código, no texto | `test -f src/core/agents/subagents.ts` **y** `rg "SUBAGENT_REGISTRY" src/core/agents/definitions.ts` | **No cumple** — `src/core/agents/` tiene sólo `definitions.ts` con **un** agente (`AGENT_REGISTRY` es un `Map` de una entrada) |
| 3 | Las migraciones de `hito-2.0` aterrizaron | `rg "migration000[78]" src/adapters/memory/migrations/index.ts` | **No cumple** — `index.ts` llega a `migration0006CredencialesEmpleado` (verificado, línea 30) |

**Por qué es duro y no una recomendación**: todo el mecanismo descansa en que *cada rol es su propia llamada a `query()`, con su propio `Options` y por lo tanto su propio `cwd`* — eso **es ADR 53 de `hito-2.0`**. Hoy `toQueryOptions` (`invoke-model.ts:271-294`, leído completo) arma **un único** `Options` para el agente conversacional y **no tiene ningún campo `cwd`**. Sin ADR 53 como código, el Implementer de `v2.1.0` tendría que reinventar la infraestructura de `v2.0.0` adentro de este change, duplicándola o contradiciéndola.

**Regla de citación mientras el gate no se cumpla**: todo objeto de `hito-2.0` que este documento nombre (`SUBAGENT_REGISTRY`, `InvocarSubagente`, `despacharCadena`, `despacharRevisionPorRoles`, `construirTareaDelegada`, `TAREA_DELEGADA_MAX_CHARS`, `ResolucionHitlResult`, migraciones `0007`/`0008`) se cita como **referencia a la especificación de `hito-2.0`, no a código**. El primer paso de `sdd-apply` es **revalidar cada uno contra `main`** y reportar cualquier deriva antes de escribir una línea.

---

## 1. Resumen de la arquitectura elegida

Dos adaptadores nuevos, dos módulos de núcleo nuevos, **cero dependencias nuevas** — quinto change consecutivo sin romper la racha.

```
 ┌───────────────────────── src/core/ (nunca importa de adapters/) ─────────────────────────┐
 │                                                                                          │
 │  agents/worktree-contract.ts     WorktreePort (asimétrico) · BarridoWorktreePort         │
 │      (SIN imports)               AplicarPatchPort (separado) · WORKTREE_TEST_TOOL_*      │
 │                                                                                          │
 │  agents/definitions.ts (mod)     construirDeveloperConEscritura(worktree)                │
 │                                  → { agent, cwd }  ← ÚNICO constructor con Write/Edit    │
 │                                                                                          │
 │  propuestas/propuestas-contract.ts   PropuestaCambio · PropuestaStorePort · PATCH_MAX_BYTES│
 │  propuestas/resumir-patch.ts         resumirPatch() · contarBytesUtf8()   ← PURAS        │
 │  propuestas/crear-propuesta-cambio.ts   tope · persistencia · evento                     │
 │  propuestas/resolver-propuesta-cambio.ts  PURA y SÍNCRONA → ResolucionHitlResult         │
 │                                                                                          │
 └───────▲──────────────────────────────────────────────────────────▲──────────────────────┘
         │                                                          │
 ┌───────┴────────────────────┐                      ┌──────────────┴─────────────────────┐
 │ src/adapters/git/ (5)      │                      │ src/adapters/test-runner/ (4)      │
 │  config.ts   git-cli.ts    │   ¡CERO contacto     │  config.ts   test-runner-cli.ts    │
 │  worktree.ts barrido.ts    │    entre ellos!      │  test-runner-tool.ts  index.ts     │
 │  index.ts                  │   (AGENTS.md)        │  → servidor MCP `worktree`          │
 └────────────────────────────┘                      └────────────────────────────────────┘
         ▲                                                          ▲
         └──────────── src/main.ts · build-on-activity.ts ──────────┘
                       (composition root: el único que los une)
```

**La línea de corte, en una frase**: el arnés decide **quién escribe, dónde, y qué se hace con lo escrito** (determinista, testeable sin modelo y sin red); el modelo decide **qué código** (no determinista, aislado por invocación). Misma línea del ADR 7, aplicada al camino de la escritura.

**La garantía dura NO es `options.cwd`.** Es la **topología**: `git diff` dentro del worktree → tope de 64 KB → fila persistida → confirmación humana en dos pasos → `git apply` sobre el working tree. Lo escrito fuera del worktree **no se captura, no se muestra y no se aplica**. Este documento no vende el `cwd` como sandbox en ningún párrafo (R2).

---

## 2. Mapa capability → módulos de código

| Capability (spec) | Módulos de código reales | ¿1:1? |
|---|---|---|
| `escritura-aislada-worktree` | `src/core/agents/worktree-contract.ts` + `src/adapters/git/*` (5) + `src/adapters/test-runner/*` (4) + el constructor único de `definitions.ts` + `vitest.config.ts` | **1:N.** Es la capability de infraestructura: ciclo de vida, contrato asimétrico, barrido, tool de tests, invariante tools+`cwd` |
| `propuesta-cambio-hitl` | `src/core/propuestas/*` (4) + migración `NNNN` + `repository.ts` + `comando-empleado.ts` + `build-on-comando-empleado.ts` | **1:N**, igual que `solicitud-interna-hitl` en `v2.0.0` y `reembolso-resolucion-escalacion` en `v1.4` |
| `delegacion-subagentes` (delta `MODIFIED`) | `src/core/agents/definitions.ts` (constructor único) + `subagents.ts` (`cwd` opcional) + `invoke-model.ts` (`cwd` propagado) | **1:3**, aceptado — el requirement relajado es **un** comportamiento observable ("sólo el developer, sólo con worktree") repartido en tres archivos |
| `revision-pr-por-roles` (delta `ADDED`) | `src/core/activity/cadena-revision.ts` (eslabón del Developer + material del Reviewer) | **1:1** |

**Cobertura**: los cuatro archivos de spec cubren **todo** lo que este diseño construye, y este diseño no construye nada que los specs no pidan. Verificación requirement por requirement en **§14**.

---

## 3. Decisiones de arquitectura (ADR 62-70)

### ADR 62: `src/adapters/git/` son **CINCO** archivos, no cuatro — `barrido.ts` se separa porque tiene el contrato inverso y toca `node:fs`

**Contexto**. `hito-2.0/design.md` §15 dice *"la misma estructura de cuatro archivos"* de `src/adapters/knowledge/`. La exploración de este change ya corrigió el número: ese directorio tiene **cinco** archivos de producción (`index.ts`, `config.ts`, `cited-nodes.ts`, `knowledge-tool.ts`, `graphify-cli.ts`) — verificado de nuevo acá. La `proposal.md` heredó el "cuatro" en su tabla de componentes.

**Decisión: cinco archivos**, y el quinto no es relleno para igualar el molde:

| Archivo | Responsabilidad | Contrato de fallas |
|---|---|---|
| `config.ts` | `resolveGitConfig(env)`, `resolveWorktreeConfig(env)`, constantes y `resolvePositiveNumber` (duplicación aceptada, ver abajo) | Nunca lanza (best-effort, molde de `knowledge/config.ts:40-49`) |
| `git-cli.ts` | `GitExecFileFn` inyectable, `defaultGitExecFile`, `GitCliError` + `classifyGitFailure`, **y los diez constructores de argv nombrados** | **Lanza `GitCliError` siempre** |
| `worktree.ts` | `abrirWorktree`, `capturarDiff`, `cerrarWorktree`, `verificarPatch`, `aplicarPatch` | **Asimétrico**: las dos primeras propagan; las tres últimas nunca rechazan |
| `barrido.ts` | `barrerHuerfanos` — lista worktrees, filtra por **ruta + prefijo de rama**, mide mtime, borra, `prune`, `branch -D` | **Nunca rechaza**, jamás |
| `index.ts` | Fachada: `createWorktreeAdapter(deps)` → `{ worktree, aplicarPatch, barrido }` | Sin lógica propia |

**Por qué `barrido.ts` es propio y no un export más de `worktree.ts`**, dos motivos independientes:

1. **Es el único módulo del adaptador que importa `node:fs`** (`stat` para el mtime del directorio, `readdir` para enumerar bajo `.harness/worktrees/`). `worktree.ts` habla **sólo** `git`. Mezclarlos haría que un cambio de política de limpieza toque el módulo del que depende la captura del diff.
2. **Contratos opuestos en el mismo archivo son una trampa para el Implementer.** `worktree.ts` ya convive con dos (`abrir` propaga, `cerrar` no); agregar un tercer bloque "nunca rechaza, con su propio `try` por worktree, que además no propaga fallas de `fs`" en el mismo archivo hace que la asimetría deje de ser legible. Un archivo, un contrato dominante.

**Duplicación deliberada del runner**: `GitExecFileFn` **no** se importa de `src/adapters/knowledge/graphify-cli.ts`. `AGENTS.md` prohíbe que un adaptador importe de otro (regla no negociable), y el repo ya documentó esta misma duplicación aceptada cinco veces (`resolvePositiveNumber`, `knowledge/config.ts:32-39`, texto literal *"DELIBERATELY duplicated across 5 adapter config files … AGENTS.md's non-negotiable rule forbids one adapter importing from another"*). Sexta y séptima instancias (`git/` y `test-runner/`), con la misma nota de doc-comment.

**Diferencia real con el molde, no cosmética**: `GitExecFileFn` gana `cwd` en `options` (`{ readonly timeout: number; readonly cwd: string }`). `ExecFileFn` de conocimiento no lo tiene porque siempre corre en el cwd del proceso; acá el `cwd` **es** el mecanismo, así que es obligatorio en el tipo — no opcional. Un `cwd` olvidado es una operación de git contra el checkout real: se hace **inexpresable**, no se documenta.

**Alternativas consideradas**:
- *Cuatro archivos, con el barrido dentro de `worktree.ts`*: **rechazada** por los dos motivos de arriba.
- *Seis archivos, separando los constructores de argv en `git-args.ts`*: **rechazada**. Los argv y su clasificación de error se leen juntos; `graphify-cli.ts` los tiene juntos (159 líneas, legible) y el test de "ningún argv puede emitir `commit`" importa de un solo módulo.

### ADR 63: la migración se numera por **REGLA**, no por número — y el mismo archivo agrega `registro_acciones_empleado.propuesta_id`

**Contexto**. `hito-2.0` propone `0007_delegaciones.ts` y `0008_solicitudes_internas.ts`; §15 escribió `0009_propuestas_cambio` asumiéndolas aplicadas. **Ninguna de las tres existe hoy**: `migrations/index.ts` (leído completo) llega a `migration0006CredencialesEmpleado`. Y la convención de ese archivo (líneas 14-18, literal) dice que las entradas existentes *"never edited or reordered once committed"*.

**Decisión 1 — la regla, no el número**:

> Al momento de `sdd-apply`, sea `M` el prefijo numérico más alto presente en `src/adapters/memory/migrations/index.ts` en `main`. La migración de este change se llama `NNNN_propuestas_cambio.ts` con `NNNN = M + 1`, formateado a cuatro dígitos, y se **agrega al final** del array `migrations`, sin editar ni reordenar ninguna entrada previa.

Con el gate de §0 cumplido, `M = 8` y el archivo será `0009_propuestas_cambio.ts` exportando `migration0009PropuestasCambio`. **Si `hito-2.0` cerrara con una sola migración o con tres, la regla sigue valiendo y el número cambia solo.** `sdd-tasks` debe escribir la tarea con `NNNN`, no con `0009`, y `sdd-apply` resuelve el valor como su primer paso — es el mismo procedimiento que `hito-2.0/design.md` §6.1 aplicó cuando verificó "la última existente es `0006`, así que la numeración correcta es `0007`/`0008`".

**Decisión 2 — la misma migración agrega una columna a `registro_acciones_empleado`.** Hallazgo real al bajar el spec a SQL: `registro_acciones_empleado` (migración `0005`, leída completa) tiene `venta_id TEXT REFERENCES ventas(id)` y `caso_id TEXT REFERENCES casos(id)` — y **nada más**. Una fila de auditoría de `/aplicar-propuesta` no puede meter el `propuestaId` en `venta_id` (la FK a `ventas` fallaría) y **`caso_id` no alcanza**: la relación caso↔propuesta es **1:N** (`proposal.md`, ADR 58 contexto), a diferencia de `solicitudes_internas`, que tiene `UNIQUE(caso_id)` y por eso sí queda identificada por el caso. Una auditoría que no puede decir **cuál** propuesta se aplicó no es auditoría — mismo argumento textual con el que el ADR 48 agregó `caso_id` a `delegaciones`.

```sql
ALTER TABLE registro_acciones_empleado ADD COLUMN propuesta_id TEXT REFERENCES propuestas_cambio(id);
```

Va **después** del `CREATE TABLE propuestas_cambio` en el mismo archivo de migración (la tabla referida tiene que existir). SQLite acepta `ADD COLUMN` con `REFERENCES` **si el default es `NULL`**, que es exactamente el caso. `AccionEmpleado` (núcleo) gana `readonly propuestaId?: string` — **aditivo y opcional**: ningún call site de `v1.4`/`v2.0.0` cambia.

**Alternativas consideradas**:
- *No correlacionar y confiar en `caso_id`*: **rechazada** por el 1:N.
- *Tabla de auditoría propia para propuestas*: **rechazada**. `registro_acciones_empleado` es el registro append-only **único** de acciones de empleado autenticado (ADR 27/28); partirlo por dominio destruye la propiedad que lo hace útil ("todo lo que un empleado hizo, en una tabla").
- *Columna genérica `objeto_id`*: **rechazada**. Perdería las FK reales de `venta_id`/`caso_id` y convertiría la tabla en un almacén poliforme sin integridad referencial.

### ADR 64: `git apply --check` corre en el **dispatcher**, no dentro del resolvedor puro — y `AplicarPatchPort` **nunca rechaza**

**Contexto**. Tres restricciones que chocan: (a) el spec exige el orden `--check` → CAS transaccional → `apply`; (b) `resolverPropuestaCambio` debe ser **pura y síncrona**, molde literal de `resolverEscalacionReembolso` / `resolverSolicitudInterna` (con test explícito de sincronía); (c) `git apply --check` es un subproceso, o sea `async`. No se puede tener las tres si el `--check` vive adentro del resolvedor.

**Decisión**:

1. **El `--check` y el `apply` viven en `build-on-comando-empleado.ts`** (que ya es `async`: su handler devuelve `Promise<TuiTurnResult>`), no en `src/core/propuestas/`. El resolvedor queda **puro y síncrono**, idéntico en forma a sus dos hermanos.
2. **Consecuencia que ahorra un cambio de contrato de `v2.0.0`**: como el conflicto nunca atraviesa el resolvedor, **`MotivoNoAplicableHitl` NO se ensancha**. Ese tipo (`hitl-contract.ts`, ADR 50) sigue siendo exactamente `"no_encontrada" | "cas"`. `conflicto` y `tamano` son vocabulario de **eventos y de la respuesta del comando**, no del genérico HITL. Cero líneas tocadas en `hitl-contract.ts`.
3. **`AplicarPatchPort` nunca rechaza — devuelve resultado etiquetado**, al revés que `WorktreePort.abrir`. Motivo: un `--check` que falla **no es una excepción, es el desenlace normal** del escenario "la base se movió" (R13). Y `aplicar` corre **después** del commit de la transacción: si tirara, el dispatcher perdería la única oportunidad de decirle al humano que el CAS quedó `aplicada` sin cambios en el árbol (RD-13, heredado). Un resultado etiquetado obliga a manejar ese camino; una excepción invita a olvidarlo.
4. **El patch viaja por archivo temporal, no por stdin.** `git apply` recibe `.harness/patches/<propuestaId>.patch`, escrito antes y borrado en un `finally` que nunca rechaza. Motivo técnico: `GitExecFileFn` es `(file, args, options) => Promise<{stdout, stderr}>` — **no tiene stdin en su firma**, y agregárselo obligaría a que todos los dobles de test simulen un `ChildProcess`. Un archivo temporal mantiene el runner inyectable trivialmente falseable, que es la propiedad que hace testeable todo el adaptador. `.harness/` ya está en `.gitignore` (R4) y excluido de vitest.

**Alternativa considerada**: *hacer `resolverPropuestaCambio` `async`*. **Rechazada** — rompe el molde de los dos resolvedores existentes, invalida el test de sincronía que `hito-2.0` estableció como patrón (`procesar-devolucion`), y mete un subproceso adentro de `src/core/`.

### ADR 65: la transacción de resolución toca `casos` **sólo en `updated_at`** — nunca en `estado`

**Contexto**. El spec exige que el CAS, la actualización del `caso` y la fila de auditoría ocurran en **una** transacción (molde de `resolverEscalacionTransaccional`, `repository.ts:1403-1455`). Pero el `caso` de una propuesta es el **caso de la actividad de PR**, cuyo `estado` lo maneja la máquina de `runActivityTurn` pasos 6-9, que los ADR 47/54 declaran intactos — y el ADR 59 punto 4 dice literalmente que *"la propuesta de cambio es un artefacto **adicional**, no un canal alternativo de transición de estado"*.

**Decisión**: dentro de la transacción se llama `updateCaso(db, casoId, { updatedAt: ahora })` — **sin `estado`, sin `tipo`**. Verificado que es expresable: `updateCaso` (`repository.ts:131-145`) usa `SET tipo = COALESCE(@tipo, tipo), estado = COALESCE(@estado, estado), updated_at = @updatedAt`, así que omitir ambos campos deja el estado del caso **exactamente** como estaba y sólo mueve el timestamp.

Esto satisface el requirement al pie de la letra ("actualiza el `caso`") **sin** que aplicar una propuesta pise el veredicto de la revisión de PR. Es la diferencia con `/aprobar-reembolso` (donde el caso **sí** cambia a `resuelto`, porque ese caso existe para el reembolso) y con `/aprobar-solicitud` (ídem). Se documenta en el doc-comment de la función transaccional, para que un futuro Implementer no "arregle" la omisión.

**Alternativa considerada**: *pasar el caso a `resuelto` al aplicar*. **Rechazada**: un PR puede tener su revisión `observada` y una propuesta aplicada — son dos hechos, y colapsarlos haría que aplicar un patch cerrara el caso de una revisión que quizás pidió más cambios.

### ADR 66: `exitCode ≠ 0` de `vitest` **NO** es una falla del adaptador — se invierte la clasificación de `graphify-cli.ts`

**Contexto**. `classifyFailure` de `graphify-cli.ts` (leído completo) mapea *"un `code` numérico distinto de cero"* → `"exit-code"`, o sea **falla**. Para `graphify` es correcto. Para `vitest run` es **exactamente al revés**: exit code 1 significa *"la suite corrió y hay tests rojos"*, que es la respuesta más valiosa que la tool puede darle al Developer. Si se clasificara como falla, el Developer recibiría *"no se pudieron correr los tests"* justo cuando los tests corrieron y lo contradicen — el peor modo de falla posible para esta tool, y contradice el criterio de éxito literal de la propuesta (*"con la suite rota, recibe la cola con las fallas y el `exitCode` distinto de cero"*).

**Decisión**: `TestRunFailureReason` es **`"not-found" | "timeout" | "unknown"`** — sin `"exit-code"`. `runVitest` atrapa el rechazo de `execFile` y, si el error trae un `code` numérico **y** algo de `stdout`/`stderr`, lo devuelve como **resultado exitoso** `{ exitCode, output, durationMs }`. Sólo `ENOENT` (entrypoint de vitest inexistente) y `killed`/`SIGTERM` (timeout) se convierten en `TestRunnerCliError`.

```
error de execFile
   ├─ code === "ENOENT"                        → TestRunnerCliError("not-found")
   ├─ killed === true || signal === "SIGTERM"   → TestRunnerCliError("timeout")
   ├─ typeof code === "number"                  → RESULTADO OK { exitCode: code, output: stdout+stderr }
   └─ resto                                     → TestRunnerCliError("unknown")
```

El orden de las ramas importa y se testea: `ENOENT` antes que `typeof code === "number"` (porque `code` puede ser el string `"ENOENT"`), y `killed` antes que el numérico (un proceso matado por timeout **también** trae `code`).

### ADR 67: el constructor único devuelve un **par tipado** `{ agent, cwd }`, y `cwd` viaja como parámetro **trailing opcional** hasta el SDK

**Contexto**. El spec exige que *"no exista una vía de código que otorgue `Write`/`Edit` al Developer sin ese `cwd` acompañándolo"*, y que sea **verificable por test**, no por convención. Una función `construirDeveloperConEscritura(worktree): AgentDefinition` **no** lo garantiza: devuelve un `AgentDefinition` suelto que cualquiera puede invocar sin `cwd`.

**Decisión**:

1. El constructor devuelve un **par indivisible**, no un `AgentDefinition`:
   ```ts
   export interface InvocacionDeveloperEscritura {
     readonly agent: AgentDefinition;   // developer + Write + Edit + mcp__worktree__run_tests
     readonly cwd: string;              // ruta ABSOLUTA del worktree — nunca opcional
   }
   export function construirDeveloperConEscritura(worktree: WorktreeAbierto): InvocacionDeveloperEscritura;
   ```
2. **Su único parámetro es un `WorktreeAbierto`** (tipo que sólo `WorktreePort.abrir` produce). No hay forma de llamarlo sin un worktree abierto: no acepta un `string`, no tiene default, no tiene sobrecarga.
3. **`SUBAGENT_REGISTRY.developer` queda byte por byte como en `v2.0.0`** (`["Read","Glob","Grep"]`). Los literales `"Write"` y `"Edit"` aparecen **exactamente una vez en todo el repo**: dentro del cuerpo de esta función. Eso es lo que hace el test posible y barato.
4. **Propagación hasta el SDK**: `InvocarSubagente` (`subagents.ts`) gana `readonly cwd?: string` y `readonly mcpServers?: Options["mcpServers"]` en su input; `invokeModel` gana un **séptimo parámetro trailing opcional** `cwd?: string`, y `toQueryOptions` lo asigna incrementalmente (`if (cwd !== undefined) options.cwd = cwd;`) por `exactOptionalPropertyTypes: true`. Es el patrón que este archivo ya justificó dos veces por escrito (doc de `invokeModel`, líneas 305-309: *"an optional trailing parameter — added after `queryFn` instead of migrating this function to a `deps` object — so every … call site keeps compiling unchanged"*). Tipar `mcpServers` en el núcleo con `Options["mcpServers"]` tiene precedente exacto y verificado: `handle-turn.ts:127` ya hace `import type { Options } from "@anthropic-ai/claude-agent-sdk"` (import de **tipo**, erasado en compilación) y `handle-turn.ts:189` declara `readonly mcpServers?: Options["mcpServers"]`.
5. **`worktree-contract.ts` no importa nada** — ni el SDK, ni Node, ni otro módulo del núcleo. Mismo criterio que `knowledge-contract.ts` y `hitl-contract.ts`. Los tipos que necesitan el SDK (`mcpServers`) viven en `subagents.ts`, que ya importa cosas.

**Test que esto habilita** (§10): *"ninguna función exportada por `definitions.ts` distinta de `construirDeveloperConEscritura` devuelve un `allowedTools` que contenga `Write` o `Edit`, y el `developer` de `SUBAGENT_REGISTRY` no los tiene"* — un assert sobre valores, no un grep.

### ADR 68: los bytes del patch se cuentan con una función **pura del núcleo**, no con `Buffer.byteLength`

**Contexto**. `PATCH_MAX_BYTES = 65_536` es un tope en **bytes**, aplicado en el núcleo (ADR 58: *"el tope no se expresa en SQL … lo pone el núcleo"*). Pero `src/core/` **no puede importar de Node** (regla no negociable de `AGENTS.md`), así que `Buffer.byteLength(patch, "utf8")` está prohibido. Y `patch.length` es **incorrecto**: cuenta unidades UTF-16, no bytes — un patch con acentos, nombres de archivo no-ASCII o contenido binario en base64 se mediría corto y podría persistirse por encima del tope real.

**Decisión**: `contarBytesUtf8` es una función **pura, exportada y testeada** de `src/core/propuestas/resumir-patch.ts`, sin imports:

```ts
/** PURA, sin imports de Node. Cuenta bytes UTF-8 de una string UTF-16. */
export function contarBytesUtf8(texto: string): number {
  let bytes = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const code = texto.charCodeAt(i);
    if (code < 0x80) { bytes += 1; }
    else if (code < 0x800) { bytes += 2; }
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < texto.length) {
      bytes += 4;      // par surrogate: un code point de 4 bytes, consume DOS unidades
      i += 1;
    } else { bytes += 3; }   // incluye surrogates huérfanos: 3 bytes (U+FFFD al codificar)
  }
  return bytes;
}
```

Se testea contra `Buffer.byteLength` **desde el test** (que sí puede importar Node) sobre un corpus fijo: ASCII, acentos, CJK, emoji (par surrogate), surrogate huérfano, string vacía. Ese test es la especificación ejecutable de la equivalencia.

**Alternativa considerada**: *`new TextEncoder().encode(t).length`*. **Rechazada**: `TextEncoder` es un global del runtime, no un import — así que no viola la regla — pero **aloca un `Uint8Array` de 64 KB+ por cada patch sólo para descartarlo**, y el conteo se hace en el camino caliente de cada delegación. La función pura no aloca nada y además es directamente testeable.

### ADR 69: el parser gana **una** forma nueva (`id_opcional_propuesta`) y **dos** ramas de `id_mas_resto` — precedente exacto del ADR 56

**Contexto**. `parsearComando` (leído completo) tiene tres formas: `sin_argumentos`, `id_opcional` (que produce literalmente `{ tipo, ventaId }`) e `id_mas_resto` (con una rama por comando: `/soporte`, `/login`, `/devolucion`). El campo del id **está horneado en la forma**: `id_opcional` no puede producir `propuestaId`. `hito-2.0` ya chocó con esto y su ADR 56 resolvió *"el parser gana una forma nueva (`id_opcional_solicitud`), no un campo de configuración"*.

**Decisión** — mismo precedente, mínimo posible:

| Comando | `uso` | `privilegiado` | `forma` | `tipo` | Variante de `ComandoEmpleado` |
|---|---|---|---|---|---|
| `/ver-propuesta` | `/ver-propuesta [propuestaId]` | **`true`** | **`id_opcional_propuesta`** (nueva) | `ver_propuesta` | `{ tipo: "ver_propuesta"; propuestaId?: string }` |
| `/aplicar-propuesta` | `/aplicar-propuesta <propuestaId>` | `true` | `id_mas_resto` (rama nueva) | `aplicar_propuesta` | `{ tipo: "aplicar_propuesta"; propuestaId: string }` |
| `/descartar-propuesta` | `/descartar-propuesta <propuestaId> [motivo]` | `true` | `id_mas_resto` (rama nueva) | `descartar_propuesta` | `{ tipo: "descartar_propuesta"; propuestaId: string; motivo?: string }` |

- Los tres van **antes de `/ayuda`**, que sigue último. `/ayuda` pasa a listar **catorce** (once de `v2.0.0` + tres).
- **`/ver-propuesta` es `privilegiado: true`** aunque no escriba nada. Motivo: muestra el **contenido íntegro de un patch** — código propietario del repo — y el spec de `propuesta-cambio-hitl` sólo garantiza el canal TUI autenticado. `esComandoPrivilegiado` (`comando-empleado.ts:148-150`) es la única fuente de verdad que el guard consulta (`build-on-comando-empleado.ts:449`), así que marcarlo `true` **es** la implementación — cero líneas en el guard.
- **`/aplicar-propuesta` y `/descartar-propuesta` NO reusan una rama compartida.** Cada una tiene la suya, de cuatro líneas, calcadas de la de `/devolucion` (`splitPrimerEspacio` sobre el resto; id ausente ⇒ `ayudaArgumentos`). Compartir la rama obligaría a que ambas variantes llevaran `motivo?`, y un `/aplicar-propuesta <id> "porque sí"` que acepta silenciosamente un motivo que nadie lee es ruido en el tipo.
- El parser **sigue sin imports** (contrato de `comando-empleado.ts:1-6`): `propuestaId` y `motivo` son `string` planos; la validación de existencia es del caso de uso.

### ADR 70: un diff **vacío** es un cuarto desenlace (`sin_cambios`), no una propuesta de cero bytes

**Contexto**. Nada obliga al Developer a escribir. Con `HARNESS_ESCRITURA_DELEGADA` activo, un turno en el que sólo lee produce un `git diff` de **string vacía**. `propuestas_cambio.patch` es `TEXT NOT NULL`, y `''` satisface `NOT NULL` en SQLite — o sea que sin decisión explícita se persistiría una fila `pendiente_aprobacion_humana` con un patch vacío, que aparecería en `/ver-propuesta`, pasaría `git apply --check` (aplicar nada siempre "funciona") y dejaría una fila `aplicada` que no cambió nada. Falla silenciosa con la base en verde.

**Decisión**: `crearPropuestaCambio` tiene **cuatro** desenlaces, y el patch se normaliza con `trim()` antes de evaluarse:

| Desenlace | Cuándo | Efecto |
|---|---|---|
| `"creada"` | `0 < bytes ≤ PATCH_MAX_BYTES` | Fila `pendiente_aprobacion_humana` |
| `"sin_cambios"` | patch vacío tras `trim()` | **Cero filas**, evento `propuesta-sin-cambios`, worktree se cierra igual |
| `"rechazada_por_tamano"` | `bytes > PATCH_MAX_BYTES` | **Cero filas**, evento `propuesta-rechazada-por-tamano` con `patchBytes`, worktree se cierra igual (ADR 58 pto 3) |
| *(propaga)* | el store tira | Falla ruidosa: sin fila no hay evidencia |

En `sin_cambios` y `rechazada_por_tamano` el `material` del Reviewer **no es un patch**: es el texto del Developer más una línea explícita de por qué no hay diff. El ciclo de revisión no se bloquea (ADR 59 pto 4, el veredicto sigue siendo uno solo).

---

## 4. Flujos completos

### 4.1 Camino de escritura — de webhook a fila persistida

```
runActivityTurn pasos 1-4  (SIN CAMBIOS)
   │
   paso 5: despacharRevision → despacharCadena([planner, developer, reviewer])      (v2.0.0)
   │
   ├─ planner  (Read, Glob)  → plan de revisión                                     [sin cambios]
   │
   ├─ developer — ESLABÓN MODIFICADO (cadena-revision.ts)
   │    a. wt = await worktree.abrir({ casoId, id: newId() })      ← PROPAGA si falla
   │       · git rev-parse HEAD                 (cwd = repo)   → wt.baseCommit
   │       · git worktree add -b harness/caso-<casoId>-<uuid> .harness/worktrees/<casoId>-<uuid> HEAD
   │    b. try {
   │         const { agent, cwd } = construirDeveloperConEscritura(wt);   ← ADR 67
   │         resultado = await invocar({ agent, casoId, tareaDelegada, cwd,
   │                                     mcpServers: testRunner.mcpServers })
   │            ↳ el Developer edita y llama mcp__worktree__run_tests las veces que quiera
   │         patch = await worktree.capturarDiff(wt)               ← PROPAGA si falla
   │            · git add --intent-to-add --all   (cwd = wt.ruta)  ← archivos NUEVOS
   │            · git diff --binary --no-color --no-ext-diff (cwd = wt.ruta)
   │         r = crearPropuestaCambio({ casoId, delegacionId, baseCommit, ramaWorktree, patch }, deps)
   │            · trim vacío        → "sin_cambios"          (0 filas)     ← ADR 70
   │            · > 65_536 bytes    → "rechazada_por_tamano"  (0 filas)    ← ADR 58
   │            · si no             → INSERT, estado = pendiente_aprobacion_humana
   │       } finally {
   │         await worktree.cerrar(wt);        ← NUNCA rechaza (git worktree remove --force + branch -D)
   │       }
   │
   └─ reviewer (Read)
        material = store.obtenerPropuesta(id).patch      ← LECTURA DE VUELTA DE LA BASE (ADR 59)
        si patchBytes > TAREA_DELEGADA_MAX_CHARS (8_000):
            construirTareaDelegada trunca (invariante de v2.0.0, NO se toca)
            + evento `propuesta-revision-parcial`
        → emite la ÚNICA línea VEREDICTO:
   │
   pasos 6-9 (SIN CAMBIOS): parseVeredicto → transicionarEstado → updateActividadEstado → mirror
```

**El worktree ya no existe cuando el Reviewer opina.** Es el orden, no una promesa: `cerrar` está en el `finally` del bloque del Developer, que termina **antes** de que `despacharCadena` arme el eslabón siguiente.

### 4.2 Camino de aplicación — TUI, con un humano presente

```
/ver-propuesta                → listarPropuestasPendientes(limite = 20) → texto. CERO escrituras.
/ver-propuesta <id>           → obtenerPropuesta(id) → resumen + patch PAGINADO. CERO escrituras.

/aplicar-propuesta <id>   ── 1er llamado (no hay confirmación pendiente que coincida) ──▶
    resolverPropuestaCambio({ accion: "aplicar", propuestaId, confirmado: false, sesion })
      → "requiere_confirmacion"  ⇒  confirmacionPendiente = { dominio: "propuesta", … }
      → eco: id · baseCommit · N archivos · +A/-E · aviso de revisión parcial si aplica
      CERO escrituras en propuestas_cambio / casos / registro_acciones_empleado.

/aplicar-propuesta <id>   ── 2do llamado (coincide id + acción + empleado, no vencida) ──▶
    confirmacionPendiente = undefined            ← se CONSUME antes de ejecutar (ADR 36)
    p = store.obtenerPropuesta(id)               ← bytes exactos, de la base
    v = await aplicarPatch.verificar(p.patch)    ← git apply --check  (NO muta) — ADR 64
    ├─ v.ok === false  ⇒  evento `propuesta-conflicto` + mensaje al humano.
    │                     La propuesta queda `pendiente_aprobacion_humana`.
    │                     CERO filas de auditoría, CERO cambio de estado (spec, escenario explícito).
    └─ v.ok === true   ⇒  UNA TRANSACCIÓN (resolverPropuestaTransaccional):
                            1. UPDATE propuestas_cambio SET estado='aplicada', resuelta_por, resuelta_at
                               WHERE id=@id AND estado='pendiente_aprobacion_humana'  RETURNING *
                            2. if (!row) return undefined            ← CAS no matchea: NADA más se escribe
                            3. updateCaso(db, casoId, { updatedAt })  ← SÓLO timestamp (ADR 65)
                            4. insertAccionEmpleado({ comando:'/aplicar-propuesta', propuestaId,
                                                      casoId, resultado:'aplicada' })
                          ── commit ──
                          a = await aplicarPatch.aplicar(p.patch)     ← git apply (NUNCA rechaza)
                          ├─ a.ok  ⇒ "Listo: N archivos modificados, sin stagear. Revisá con git status."
                          └─ !a.ok ⇒ evento `propuesta-apply-fallido` + mensaje EXPLÍCITO:
                                     "la propuesta quedó marcada aplicada pero el árbol NO cambió"
                                     (RD-13 heredado, hecho visible en vez de silencioso)

/descartar-propuesta <id> [motivo]  → mismo two-step; la transacción es CAS→'descartada' + motivo
                                      + updateCaso(updatedAt) + fila de auditoría. SIN git.
```

**Sin `git add`, sin `git commit`, sin `git push`, sin PR, sin cambio de rama** — y no como promesa: **no existe un constructor de argv que pueda emitir esos subcomandos** (ADR 57 pto 4, test dedicado en §10).

---

## 5. Núcleo — módulos y firmas

### 5.1 `src/core/agents/worktree-contract.ts` (nuevo) — **sin imports**

```ts
/* Contrato del entorno de trabajo aislado (ADR 57, 61, 62). Sin imports:
 * ni SDK, ni Node, ni otro módulo del núcleo — mismo criterio que
 * `knowledge-contract.ts` y `hitl-contract.ts`. */

/* ── Nombres de la tool MCP (molde literal de knowledge-contract.ts:17-27) ── */
export const WORKTREE_MCP_SERVER_NAME = "worktree";
export const WORKTREE_TEST_TOOL_NAME = "run_tests";
export const WORKTREE_TEST_TOOL_QUALIFIED_NAME =
  `mcp__${WORKTREE_MCP_SERVER_NAME}__${WORKTREE_TEST_TOOL_NAME}` as const;   // "mcp__worktree__run_tests"

/** Prefijo de rama — la mitad FILTRABLE del doble filtro del barrido (ADR 57 pto 7). */
export const WORKTREE_RAMA_PREFIJO = "harness/caso-";

/** Handle de un worktree vivo. Lo produce SÓLO `WorktreePort.abrir`; es el único
 *  parámetro de `construirDeveloperConEscritura` (ADR 67). */
export interface WorktreeAbierto {
  readonly casoId: string;
  /** Ruta ABSOLUTA. `.harness/worktrees/<casoId>-<uuid>` resuelta contra la raíz del repo. */
  readonly ruta: string;
  /** `harness/caso-<casoId>-<uuid>`. NUNCA recibe un commit. */
  readonly rama: string;
  /** SHA de `HEAD` en el momento de abrir. Sin esto, un `apply` fallido es indiagnosticable (R13). */
  readonly baseCommit: string;
}

/**
 * CONTRATO ASIMÉTRICO, DELIBERADO (ADR 57 pto 6) — leer antes de implementar:
 *
 *  · `abrir` y `capturarDiff` FALLAN RUIDOSAMENTE: rechazan con `GitCliError`
 *    (o lo que el adaptador tire) y NO lo atrapan. Criterio de `ActivityStorePort`:
 *    sin worktree no hay trabajo, y un diff que no se pudo capturar es trabajo
 *    PERDIDO que hay que ver, no tragar.
 *
 *  · `cerrar` NUNCA rechaza, bajo NINGUNA circunstancia — ni si el worktree ya
 *    no existe, ni si `git` desapareció del PATH, ni si el disco está lleno.
 *    Tiene su propio `try/catch` interno que degrada a evento
 *    `worktree-cierre-fallido`. Motivo: se invoca desde un `finally`, y un
 *    `finally` que revienta ENMASCARA el error real del `try`.
 */
export interface WorktreePort {
  abrir(input: { readonly casoId: string; readonly id: string }): Promise<WorktreeAbierto>;
  capturarDiff(worktree: WorktreeAbierto): Promise<string>;
  cerrar(worktree: WorktreeAbierto): Promise<void>;
}

export interface BarridoResumen {
  readonly examinados: number;
  readonly borrados: number;
  readonly fallidos: number;
}

/**
 * Barrido de huérfanos al arranque. NUNCA rechaza: un barrido que revienta
 * tumbaría el arranque del arnés por basura de una corrida vieja. Degrada a
 * evento `worktree-barrido-fallido` y devuelve el resumen parcial.
 */
export interface BarridoWorktreePort {
  barrerHuerfanos(input: {
    readonly ttlMs: number;
    /** Inyectado, no `Date.now()` adentro: el test fabrica mtimes viejos y recientes. */
    readonly ahoraMs: number;
  }): Promise<BarridoResumen>;
}

export const MOTIVO_PATCH_CONFLICTO = "conflicto";
export const MOTIVO_PATCH_ERROR_GIT = "error_git";
export type MotivoPatchNoAplicable = typeof MOTIVO_PATCH_CONFLICTO | typeof MOTIVO_PATCH_ERROR_GIT;

export type ResultadoPatch =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: MotivoPatchNoAplicable; readonly detalle?: string };

/**
 * Puerto SEPARADO de `WorktreePort` a propósito (ADR 57 pto 4 + ADR 60): su
 * único consumidor es el comando TUI, y opera sobre el CHECKOUT REAL, no
 * sobre un worktree. Tenerlos juntos invitaría a que la cadena de revisión
 * — que sí tiene un `WorktreePort` — pudiera aplicar un patch sin humano.
 *
 * NUNCA rechaza (ADR 64 pto 3): un `--check` que falla es el desenlace NORMAL
 * de "la base se movió", y `aplicar` corre DESPUÉS del commit de la
 * transacción, donde una excepción perdería la única chance de avisarle al
 * humano que el estado quedó inconsistente (RD-13).
 */
export interface AplicarPatchPort {
  verificar(patch: string): Promise<ResultadoPatch>;
  aplicar(patch: string): Promise<ResultadoPatch>;
}
```

### 5.2 `src/core/agents/definitions.ts` (modificado)

Un único agregado sobre lo que deja `hito-2.0` — **`SUBAGENT_REGISTRY` no se toca**:

```ts
import {
  WORKTREE_TEST_TOOL_QUALIFIED_NAME,
  type WorktreeAbierto,
} from "./worktree-contract.js";            // núcleo → núcleo, igual que knowledge-contract

/** El PAR indivisible. No existe una función que devuelva sólo el `agent` (ADR 67). */
export interface InvocacionDeveloperEscritura {
  readonly agent: AgentDefinition;
  readonly cwd: string;
}

/**
 * ÚNICO constructor de la variante de escritura del Developer (ADR 61 pto 2,
 * ADR 67). Los literales "Write" y "Edit" aparecen UNA sola vez en todo el
 * repo: acá adentro.
 *
 * Su único parámetro es un `WorktreeAbierto` — tipo que sólo
 * `WorktreePort.abrir` produce — así que NO SE PUEDE ESCRIBIR CÓDIGO que le
 * dé `Write`/`Edit` al Developer sin un worktree. Eso es un test unitario,
 * no una convención (§10).
 *
 * Con `HARNESS_ESCRITURA_DELEGADA=off` el composition root simplemente NO
 * llama a esta función: el Developer vuelve a ser, byte por byte, el de
 * `v2.0.0`.
 */
export function construirDeveloperConEscritura(
  worktree: WorktreeAbierto,
): InvocacionDeveloperEscritura {
  const base = getSubagentDefinition(ROL_DEVELOPER);          // ["Read","Glob","Grep"], intacto
  return {
    agent: {
      ...base,
      allowedTools: [...base.allowedTools, "Write", "Edit", WORKTREE_TEST_TOOL_QUALIFIED_NAME],
      systemPrompt: `${base.systemPrompt}\n\n${INSTRUCCION_ESCRITURA_WORKTREE}`,
    },
    cwd: worktree.ruta,
  };
}
```

`INSTRUCCION_ESCRITURA_WORKTREE` (constante del mismo archivo) le dice al Developer, en texto: que trabaja en una **copia descartable**, que **todo lo que escriba fuera de su directorio de trabajo se descarta y no llega a ningún lado**, que debe correr `mcp__worktree__run_tests` antes de dar por terminado, y que **no tiene ni tendrá una shell**. Es prompt, no garantía — la garantía es la topología (R2). Está para reducir el intento, no para sustituir el mecanismo.

`allowedTools` final del Developer con escritura: **`["Read","Glob","Grep","Write","Edit","mcp__worktree__run_tests"]`**. Los otros tres roles **no cambian**: `planner` `["Read","Glob"]`, `reviewer` `["Read"]`, `validador-solicitudes` `[]`. **Ninguno de los cuatro**, con el interruptor en `on` o en `off`, tiene `Bash`, `Agent` ni `Task`.

### 5.3 `src/core/agents/subagents.ts` (modificado) e `invoke-model.ts` (modificado)

```ts
// subagents.ts — dos campos opcionales, aditivos. Ningún call site de v2.0.0 cambia.
export type InvocarSubagente = (input: {
  readonly agent: AgentDefinition;
  readonly casoId: string;
  readonly tareaDelegada: string;
  /** ADR 67: SÓLO se pasa junto con la variante de escritura. */
  readonly cwd?: string;
  /** Servidor MCP `worktree` de esa invocación. Tipo del SDK, import de TIPO
   *  (precedente literal: handle-turn.ts:127,189). */
  readonly mcpServers?: Options["mcpServers"];
}) => Promise<InvocacionSubagenteResult>;
```

```ts
// invoke-model.ts — séptimo parámetro trailing opcional (patrón ya justificado
// por el doc-comment de este mismo archivo, líneas 305-309).
export async function invokeModel(
  agent: AgentDefinition,
  context: AssembledContext,
  prompt: string,
  hookEngine: HookEngine,
  queryFn: QueryFn = query,
  mcpServers?: Options["mcpServers"],
  cwd?: string,                                    // ← NUEVO
): Promise<InvokeModelResult>;

// toQueryOptions: asignación incremental, por `exactOptionalPropertyTypes: true`
if (cwd !== undefined) { options.cwd = cwd; }
```

**Nota de honestidad, obligatoria en el doc-comment de `toQueryOptions`**: `options.cwd` es **anclaje de alcance, no aislamiento de proceso**. No impide un path absoluto. Lo que impide el daño es que sólo se capture, se muestre y se aplique lo que salió del `git diff` **dentro** del worktree.

### 5.4 `src/core/propuestas/propuestas-contract.ts` (nuevo)

Importa **sólo** de `../hitl/hitl-contract.js` (núcleo → núcleo, mismo cruce que `solicitudes-contract.ts`):

```ts
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../hitl/hitl-contract.js";

/**
 * TRES estados, no cuatro (decisión del checkpoint humano sobre RD-12). Un
 * conflicto de `git apply --check` deja la fila INTACTA en `pendiente` y un
 * patch fuera de tope NO crea fila, así que un cuarto valor `no_aplicable`
 * sería vocabulario que promete una transición que ningún camino ejecuta.
 *
 * OJO — NO confundir con el tag `"no_aplicable"` de `ResolucionHitlResult`
 * (`hitl-contract.ts`, ADR 50 de v2.0.0), que SÍ se usa acá y NO se toca: ese
 * describe el desenlace de una INVOCACIÓN del resolvedor (`no_encontrada` /
 * `cas`), no un estado persistido. Mismo nombre, planos distintos.
 */
export const PROPUESTA_ESTADO_PENDIENTE = CASO_ESTADO_PENDIENTE_APROBACION_HUMANA;  // ← HITL (ADR 42)
export const PROPUESTA_ESTADO_APLICADA = "aplicada";
export const PROPUESTA_ESTADO_DESCARTADA = "descartada";
export type PropuestaEstado =
  | typeof PROPUESTA_ESTADO_PENDIENTE
  | typeof PROPUESTA_ESTADO_APLICADA
  | typeof PROPUESTA_ESTADO_DESCARTADA;

/** 64 KB. Tope de RECHAZO, no de truncado (ADR 58 pto 3). NO configurable por env,
 *  a propósito: es un invariante de la evidencia, no un parámetro operativo —
 *  mismo criterio literal que `SAVE_RESULT_TIMEOUT_MS` y `TAREA_DELEGADA_MAX_CHARS`. */
export const PATCH_MAX_BYTES = 65_536;
export const LIMITE_LISTADO_PROPUESTAS = 20;          // espejo de LIMITE_LISTADO_ESCALACIONES
/** Líneas de patch por página de `/ver-propuesta <id>`. */
export const LINEAS_PAGINA_PATCH = 80;

export interface PropuestaCambio {
  readonly id: string;
  readonly casoId: string;
  readonly delegacionId?: string;          // nullable — ADR 48
  readonly baseCommit: string;
  readonly ramaWorktree: string;
  readonly patch: string;
  readonly patchBytes: number;
  readonly archivos: number;
  readonly lineasAgregadas: number;
  readonly lineasEliminadas: number;
  readonly estado: PropuestaEstado;
  readonly motivo?: string;
  readonly resueltaPor?: string;
  readonly resueltaAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrearPropuestaInput {
  readonly id: string; readonly casoId: string; readonly delegacionId?: string;
  readonly baseCommit: string; readonly ramaWorktree: string; readonly patch: string;
  readonly resumen: ResumenPatch; readonly createdAt: string;
}

export interface ResolucionPropuestaInput {
  readonly propuestaId: string; readonly casoId: string; readonly empleadoId: string;
  readonly accionId: string; readonly ahora: string; readonly motivo?: string;
}

/** SÍNCRONO (better-sqlite3), como `VentaStorePort`/`SolicitudStorePort`. Falla RUIDOSAMENTE. */
export interface PropuestaStorePort {
  crearPropuesta(input: CrearPropuestaInput): PropuestaCambio;
  obtenerPropuesta(propuestaId: string): PropuestaCambio | undefined;
  listarPropuestasPendientes(filtro?: {
    readonly propuestaId?: string; readonly limite?: number;
  }): readonly PropuestaCambio[];
  /** CAS + `updateCaso({updatedAt})` + fila de auditoría, UNA transacción (ADR 65). */
  aplicarPropuesta(input: ResolucionPropuestaInput): PropuestaCambio | undefined;
  descartarPropuesta(input: ResolucionPropuestaInput): PropuestaCambio | undefined;
}
```

### 5.5 `src/core/propuestas/resumir-patch.ts` (nuevo) — **PURO, sin imports**

```ts
export interface ResumenPatch {
  readonly patchBytes: number; readonly archivos: number;
  readonly lineasAgregadas: number; readonly lineasEliminadas: number;
}

export function contarBytesUtf8(texto: string): number;      // ADR 68, cuerpo completo arriba

/**
 * PURA. Un solo recorrido por líneas del patch unificado:
 *   · `archivos`          = líneas que empiezan con "diff --git "
 *   · `lineasAgregadas`   = empiezan con "+" y NO con "+++"
 *   · `lineasEliminadas`  = empiezan con "-" y NO con "---"
 *   · `patchBytes`        = contarBytesUtf8(patch)
 * No parsea hunks ni valida el formato: es un RESUMEN para el eco y el
 * listado, no un validador — el validador real es `git apply --check`.
 */
export function resumirPatch(patch: string): ResumenPatch;
```

**Por qué existe**: el eco de `/aplicar-propuesta` y el listado de `/ver-propuesta` no deben re-parsear un patch de 64 KB por fila (ADR 58 pto 2). Se calcula **una vez**, al crear, y se persiste en columnas.

### 5.6 `src/core/propuestas/crear-propuesta-cambio.ts` (nuevo) — **síncrono**

```ts
export type CrearPropuestaResult =
  | { readonly resultado: "creada"; readonly propuesta: PropuestaCambio }
  | { readonly resultado: "sin_cambios" }                                        // ADR 70
  | { readonly resultado: "rechazada_por_tamano"; readonly patchBytes: number }; // ADR 58

export function crearPropuestaCambio(
  input: {
    readonly casoId: string; readonly delegacionId?: string;
    readonly baseCommit: string; readonly ramaWorktree: string; readonly patch: string;
  },
  deps: {
    readonly store: PropuestaStorePort;
    readonly newId: () => string;
    readonly now: () => string;
    readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  },
): CrearPropuestaResult;
```

Orden interno, no negociable: `trim` → `resumirPatch` → **tope** → recién ahí `store.crearPropuesta`. Nunca se persiste primero y se valida después.

### 5.7 `src/core/propuestas/resolver-propuesta-cambio.ts` (nuevo) — **PURO y SÍNCRONO**

Molde literal de `resolverSolicitudInterna` / `resolverEscalacionReembolso`: **cero `await`**, con test explícito de sincronía (molde de `procesar-devolucion`).

```ts
export const ACCION_APLICAR_PROPUESTA = "aplicar";
export const ACCION_DESCARTAR_PROPUESTA = "descartar";
export type AccionPropuesta =
  typeof ACCION_APLICAR_PROPUESTA | typeof ACCION_DESCARTAR_PROPUESTA;

/** El genérico del ADR 50, sin ensanchar `MotivoNoAplicableHitl` (ADR 64 pto 2). */
export type ResolverPropuestaResult =
  ResolucionHitlResult<PropuestaCambio, AccionPropuesta, PropuestaEstado>;

export function resolverPropuestaCambio(
  input: {
    readonly accion: AccionPropuesta;
    readonly propuestaId?: string;
    readonly motivo?: string;
    readonly confirmado: boolean;
    /** `SesionEmpleado`, NO `empleadoId: string` — ADR 37: el invariante
     *  "fue autenticado" se expresa en el TIPO. */
    readonly sesion: SesionEmpleado;
  },
  deps: {
    readonly store: PropuestaStorePort; readonly newId: () => string;
    readonly now: () => string; readonly logEvent: …; readonly limiteListado?: number;
  },
): ResolverPropuestaResult;
```

Desenlaces: sin `propuestaId` ⇒ `"listado"`; con id y `confirmado: false` ⇒ `"requiere_confirmacion"` (o `"no_aplicable"` / `no_encontrada`); con id y `confirmado: true` ⇒ `"aplicada"` con `estadoFinal`, o `"no_aplicable"` / `cas`. **El `git apply --check` no está acá** (ADR 64): cuando este resolvedor corre con `confirmado: true`, la verificación ya pasó.

**Nota sobre el tag `"no_aplicable"`, para que nadie lo confunda con RD-12**: acá es el **resultado de una invocación** — la propuesta no existe (`no_encontrada`) o el CAS no matcheó (`cas`) — y viene del genérico `ResolucionHitlResult` de `hitl-contract.ts`, compartido con reembolsos y solicitudes. **No es un estado persistido**: `propuestas_cambio.estado` sólo toma tres valores y ninguno es `"no_aplicable"`. Que el conflicto de git no atraviese este tipo (ADR 64 pto 2) es lo que hace que las dos decisiones sean independientes: **quitar el cuarto estado no toca `hitl-contract.ts` ni `MotivoNoAplicableHitl` en una sola línea**, y `v2.0.0` queda intacto.

### 5.8 `src/core/activity/cadena-revision.ts` (modificado)

`construirEslabonesRevision` gana un parámetro opcional de escritura. Con él ausente, el comportamiento es **byte por byte el de `v2.0.0`**:

```ts
export interface EscrituraDelegadaDeps {
  readonly worktree: WorktreePort;
  readonly propuestas: PropuestaStorePort;
  readonly testRunnerMcpServers: (worktree: WorktreeAbierto) => Options["mcpServers"];
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: …;
}

/** `escritura` ausente ⇒ cadena de `v2.0.0` sin tocar (interruptor en `off`). */
export async function despacharRevisionPorRoles(
  casoId: string,
  prompt: string,
  deps: DespacharDelegacionDeps,
  escritura?: EscrituraDelegadaDeps,
): Promise<ActivityTurnOutcome>;
```

El `material` del Reviewer sale de `escritura.propuestas.obtenerPropuesta(id).patch` — **lectura de vuelta de la base**, nunca la variable en memoria (ADR 59 pto 2). Si `patchBytes > TAREA_DELEGADA_MAX_CHARS`, se emite `propuesta-revision-parcial` y se deja que `construirTareaDelegada` trunque con su invariante vigente: **`TAREA_DELEGADA_MAX_CHARS` no se toca en este change**.

### 5.9 `comando-empleado.ts` y `registro-acciones-contract.ts` (modificados)

Tres descriptores nuevos (tabla del ADR 69), una forma nueva, dos ramas nuevas. `registro-acciones-contract.ts` suma **datos**: `COMANDO_VER_PROPUESTA = "/ver-propuesta"`, `COMANDO_APLICAR_PROPUESTA = "/aplicar-propuesta"`, `COMANDO_DESCARTAR_PROPUESTA = "/descartar-propuesta"`, `RESULTADO_DESCARTADA = "descartada"` (`RESULTADO_APLICADA`… se reusa `RESULTADO_APROBADA`? **No**: se agrega `RESULTADO_APLICADA = "aplicada"`, porque "aprobada" y "aplicada" son hechos distintos y el registro es lo que un auditor lee). **Único cambio de tipo**: `AccionEmpleado` gana `readonly propuestaId?: string` (ADR 63).

### 5.10 `build-on-comando-empleado.ts` (modificado)

- `ConfirmacionPendiente` (unión discriminada del ADR 55) gana la tercera rama:
  ```ts
  | { readonly dominio: "propuesta"; readonly accion: AccionPropuesta;
      readonly propuestaId: string; readonly casoId: string;
      readonly patchBytes: number; readonly empleadoId: string; readonly expiraEn: string }
  ```
  **Sigue siendo UNA sola ranura** (ADR 55): armar una confirmación de propuesta **pisa** una de reembolso pendiente, y viceversa. Eso *es* la garantía de "como mucho una acción destructiva armada por vez", y está en el spec como escenario.
- Tres `case` nuevos en el `switch` (hoy líneas 455-472) → `manejarVerPropuesta`, `manejarResolucionPropuesta(ACCION_APLICAR_PROPUESTA | ACCION_DESCARTAR_PROPUESTA, …)`.
- `manejarResolucionPropuesta` calca `manejarEscalacion` (líneas 330-408) incluida la escritura **fuera** de transacción sólo en el camino `no_aplicable`/`cas` (líneas 389-403), y agrega los dos `await` de git del ADR 64 alrededor del CAS.
- `/login` y `/logout` siguen purgando la ranura (líneas 241, 273) — sin cambios.

---

## 6. Adaptadores

### 6.1 `src/adapters/git/` (5 archivos, ADR 62)

**`config.ts`**

| Env var | Campo | Default |
|---|---|---|
| `HARNESS_GIT_BIN` | `bin` | `"git"` |
| `HARNESS_GIT_TIMEOUT_MS` | `timeoutMs` | `30_000` |
| `HARNESS_WORKTREE_ROOT` | `worktreeRoot` | `".harness/worktrees"` |
| `HARNESS_WORKTREE_TTL_MS` | `ttlMs` | `7_200_000` (2 h, ADR 57 pto 7) |
| — | `repoRoot` | `process.cwd()` (parámetro, no env — lo fija el composition root) |

`resolvePositiveNumber` duplicada con la nota de doc-comment de siempre. `HARNESS_WORKTREE_ROOT` **no** está en la propuesta y se agrega acá por una razón concreta: el test de integración contra `git` real necesita un repo temporal con su propia raíz de worktrees, y sin esta variable ese test tendría que ensuciar el `.harness/` del repo de verdad.

**`git-cli.ts`**

```ts
export type GitExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly cwd: string },   // ← `cwd` OBLIGATORIO
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export const defaultGitExecFile: GitExecFileFn;   // execFile + maxBuffer 10MB + windowsHide. NUNCA `exec`, NUNCA shell.

export type GitFailureReason = "not-found" | "timeout" | "exit-code" | "unknown";
export class GitCliError extends Error { readonly reason: GitFailureReason; readonly cause: unknown; }
function classifyGitFailure(error: unknown): GitFailureReason;   // idéntico a classifyFailure
```

**Los diez constructores de argv nombrados** — cada uno con su argv fijo, ninguno recibe un subcomando:

```ts
export function buildRevParseHeadArgs(): readonly string[];                          // ["rev-parse","HEAD"]
export function buildWorktreeAddArgs(rama: string, ruta: string): readonly string[]; // ["worktree","add","-b",rama,ruta,"HEAD"]
export function buildIntentToAddArgs(): readonly string[];                           // ["add","--intent-to-add","--all"]
export function buildDiffArgs(): readonly string[];                                  // ["diff","--binary","--no-color","--no-ext-diff"]
export function buildWorktreeRemoveArgs(ruta: string): readonly string[];            // ["worktree","remove","--force",ruta]
export function buildBranchDeleteArgs(rama: string): readonly string[];              // ["branch","-D",rama]
export function buildWorktreeListArgs(): readonly string[];                          // ["worktree","list","--porcelain"]
export function buildWorktreePruneArgs(): readonly string[];                         // ["worktree","prune"]
export function buildApplyCheckArgs(rutaPatch: string): readonly string[];           // ["apply","--check","--whitespace=nowarn",rutaPatch]
export function buildApplyArgs(rutaPatch: string): readonly string[];                // ["apply","--whitespace=nowarn",rutaPatch]

/** Los diez, para el test que asserta que "no commitear" es INEXPRESABLE (§10). */
export const CONSTRUCTORES_ARGV: readonly ((...args: never[]) => readonly string[])[];
export const SUBCOMANDOS_PERMITIDOS = ["rev-parse", "worktree", "add", "diff", "branch", "apply"] as const;
```

**No existe `git(args: string[])`.** El subcomando es un literal en la posición 0 de cada constructor; el input del llamador sólo puede aterrizar en posiciones ≥ 1. `commit`, `push`, `remote` y `tag` no son "algo que no hacemos": son **algo que no hay dónde escribir**.

**`worktree.ts`** — implementa `WorktreePort` y `AplicarPatchPort` sobre los constructores de arriba. `capturarDiff` corre `buildIntentToAddArgs` y después `buildDiffArgs`, **ambos con `cwd = worktree.ruta`** — que tiene su **propio índice**, separado del checkout real (por eso `--intent-to-add` no toca el índice del humano). `cerrar` encadena `worktree remove --force` y `branch -D` dentro de **un solo `try/catch`** que degrada a evento y devuelve `void`.

**`barrido.ts`** — algoritmo exacto:

```
1. salida = git worktree list --porcelain      (cwd = repoRoot) → si falla: evento, return {0,0,0}
2. parsear en registros { worktree <ruta>, branch refs/heads/<rama> }
3. filtrar con LAS DOS condiciones (ADR 57 pto 7):
      ruta.startsWith(resolve(repoRoot, worktreeRoot))   Y   rama.startsWith(WORKTREE_RAMA_PREFIJO)
4. por cada candidato, en su PROPIO try/catch (uno que falla no aborta el resto):
      mtime = (await stat(ruta)).mtimeMs        ← si stat falla: contarlo como fallido, seguir
      si (ahoraMs - mtime) <= ttlMs: dejarlo INTACTO (podría estar VIVO)
      si no: worktree remove --force <ruta> ; branch -D <rama> ; borrados++
5. git worktree prune                          (limpia registros de worktrees ya borrados a mano)
6. return { examinados, borrados, fallidos }
```

**El paso 4 es el que evita el desastre**: sin el TTL, el barrido de una segunda instancia del arnés borraría el worktree **vivo** de la primera. Por eso el TTL es holgadamente mayor que la delegación más larga plausible (un turno de modelo + una corrida de suite: minutos) y holgadamente menor que una jornada.

**`index.ts`** — `createGitAdapter({ config, repoRoot, logEvent, execFileFn? })` → `{ worktree: WorktreePort, aplicarPatch: AplicarPatchPort, barrido: BarridoWorktreePort }`. `execFileFn` con default real, inyectable en test — molde literal de `createKnowledgeAdapter`.

### 6.2 `src/adapters/test-runner/` (4 archivos, ADR 61 + ADR 66)

**`config.ts`**

| Env var | Campo | Default |
|---|---|---|
| `HARNESS_WORKTREE_TEST_TIMEOUT_MS` | `timeoutMs` | `300_000` (5 min) |
| — | `vitestEntrypoint` | `resolve(repoRoot, "node_modules/vitest/vitest.mjs")` |
| — | `TEST_MCP_TIMEOUT_MARGIN_MS` | `5_000` (espejo de `MCP_TIMEOUT_MARGIN_MS`) |

**`test-runner-cli.ts`**

```ts
export type TestExecFileFn = (
  file: string, args: readonly string[],
  options: { readonly timeout: number; readonly cwd: string },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export type TestRunFailureReason = "not-found" | "timeout" | "unknown";   // ← SIN "exit-code" (ADR 66)
export class TestRunnerCliError extends Error { readonly reason: TestRunFailureReason; readonly cause: unknown; }

export interface TestRunResult {
  readonly exitCode: number;      // 0 = verde; ≠ 0 = la suite CORRIÓ y hay rojos
  readonly output: string;        // stdout + stderr, SIN truncar todavía
  readonly durationMs: number;
}

/** `execFile(process.execPath, [entrypoint, "run", "--reporter=basic"], { cwd: worktree, timeout })`.
 *  NUNCA `npm`, NUNCA shell: en Windows `npm` es `npm.cmd` y Node ≥20 se niega a
 *  lanzarlo con `execFile` sin shell — y usar shell es exactamente lo que el ADR 61
 *  prohíbe. Se ejecuta el runner directamente y el problema desaparece (R6). */
export async function runVitest(
  config: TestRunnerConfig, cwd: string, execFileFn?: TestExecFileFn,
): Promise<TestRunResult>;
```

**Truncado por la COLA — algoritmo exacto** (vive en `test-runner-tool.ts`, es puro y se testea solo):

```ts
export const TEST_OUTPUT_MAX_CHARS = 8_000;
export const SALIDA_TRUNCADA_PREFIJO = "[…salida truncada: se conserva el final…]\n";

/**
 * Al REVÉS que `construirTareaDelegada`, que conserva la CABEZA: en
 * `vitest run` el resumen de fallas está al FINAL, así que truncar el final
 * es tirar exactamente lo que el Developer necesita (ADR 61 pto 6).
 *
 * Espejo de `truncateSafely` (knowledge/index.ts:65-77) pero cortando desde
 * el otro lado: ahí el riesgo es terminar en un HIGH surrogate huérfano; acá
 * es EMPEZAR en un LOW surrogate huérfano.
 */
export function truncarConservandoCola(salida: string, maxChars = TEST_OUTPUT_MAX_CHARS): string {
  if (salida.length <= maxChars) { return salida; }                 // corta: se devuelve INTACTA
  const presupuesto = maxChars - SALIDA_TRUNCADA_PREFIJO.length;    // > 0 por construcción
  let inicio = salida.length - presupuesto;
  const LOW_START = 0xdc00, LOW_END = 0xdfff;
  const code = salida.charCodeAt(inicio);
  if (code >= LOW_START && code <= LOW_END) { inicio += 1; }        // no arrancar en medio de un par
  return SALIDA_TRUNCADA_PREFIJO + salida.slice(inicio);
}
```

Invariante testeado: `truncarConservandoCola(s).length <= TEST_OUTPUT_MAX_CHARS` **siempre**, y el resultado **termina con los mismos caracteres** que `s`.

**`test-runner-tool.ts`** — molde literal de `knowledge-tool.ts` (framework-free, sin import del SDK):

```ts
export interface TestRunnerToolTextResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
}

export interface TestRunnerToolDeps {
  readonly casoId: string;
  readonly config: TestRunnerConfig;
  readonly cwd: string;                                        // ruta del worktree
  readonly runTests: (config: TestRunnerConfig, cwd: string) => Promise<TestRunResult>;
  readonly logEvent: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * NUNCA lanza ni rechaza, en NINGÚN camino — incluido un throw SÍNCRONO de un
 * `runTests` mal implementado (por eso el `try/catch` envuelve la llamada, no
 * un `.catch()` sobre la promesa). Contrato calcado de `handleKnowledgeQuery`.
 *
 * SIN PARÁMETROS: corre TODA la suite. Un argumento de path o filtro sería
 * superficie de inyección en argv y, peor, permitiría reportar "verde" habiendo
 * corrido tres tests (ADR 61 pto 4). El esquema zod de `index.ts` es `{}`, así
 * que cualquier argumento que el modelo mande se descarta antes de llegar acá.
 */
export async function handleRunTests(deps: TestRunnerToolDeps): Promise<TestRunnerToolTextResult>;
```

Texto de salida, los tres casos:

| Caso | Texto devuelto |
|---|---|
| `exitCode === 0` | `"TESTS EN VERDE (exit 0, <ms> ms).\n\n<salida truncada por la cola>"` |
| `exitCode !== 0` | `"TESTS EN ROJO (exit <n>, <ms> ms). Arreglá lo que falla antes de dar por terminado tu trabajo.\n\n<salida truncada por la cola>"` |
| `TestRunnerCliError` | `"NO SE PUDIERON CORRER LOS TESTS: <motivo legible>. Decilo explícitamente en tu resultado en vez de afirmar que pasan."` |

**Siempre** se devuelven `exitCode` y duración, truncada la salida o no.

**`index.ts`** — `createTestRunnerAdapter({ casoId, cwd, logEvent, config?, execFileFn? })` → `{ mcpServers }`, con `createSdkMcpServer({ name: WORKTREE_MCP_SERVER_NAME, timeout: timeoutMs + TEST_MCP_TIMEOUT_MARGIN_MS, tools: [tool(WORKTREE_TEST_TOOL_NAME, "<descripción>", {}, () => handleRunTests(deps).then(toCallToolResult))] })`.

**Cero contacto entre los dos adaptadores** (ADR 61 pto 9): `test-runner/` no importa nada de `git/` y viceversa. Es el **composition root** el que le pasa `worktree.ruta` al segundo — que es exactamente lo que la regla de `AGENTS.md` protege.

---

## 7. Persistencia

### 7.1 Migración `NNNN_propuestas_cambio.ts` (nueva — ADR 58 + ADR 63)

> **Número real**: `NNNN = M + 1`, con `M` = prefijo más alto en `migrations/index.ts` de `main` al momento de `sdd-apply`. Con el gate de §0 cumplido: **`0009`**, export `migration0009PropuestasCambio`. Se agrega **al final** del array `migrations`; ninguna entrada existente se edita ni se reordena (convención de `index.ts:14-18`).

```sql
CREATE TABLE IF NOT EXISTS propuestas_cambio (
  id                TEXT PRIMARY KEY,
  caso_id           TEXT NOT NULL REFERENCES casos(id),
  delegacion_id     TEXT REFERENCES delegaciones(id),   -- NULLABLE, precedente ADR 48
  base_commit       TEXT NOT NULL,
  rama_worktree     TEXT NOT NULL,
  patch             TEXT NOT NULL,
  patch_bytes       INTEGER NOT NULL,
  archivos          INTEGER NOT NULL,
  lineas_agregadas  INTEGER NOT NULL,
  lineas_eliminadas INTEGER NOT NULL,
  estado            TEXT NOT NULL,
  motivo            TEXT,
  resuelta_por      TEXT,
  resuelta_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_propuestas_estado ON propuestas_cambio(estado);
CREATE INDEX IF NOT EXISTS idx_propuestas_caso   ON propuestas_cambio(caso_id);

-- ADR 63: la auditoría tiene que poder decir CUÁL propuesta se aplicó.
-- `caso_id` no alcanza: la relación caso↔propuesta es 1:N (a diferencia de
-- `solicitudes_internas`, que tiene UNIQUE(caso_id)). SQLite acepta ADD COLUMN
-- con REFERENCES porque el default es NULL.
ALTER TABLE registro_acciones_empleado ADD COLUMN propuesta_id TEXT REFERENCES propuestas_cambio(id);
```

**Columna por columna, con su precedente**:

| Columna | Decisión | Motivo verificado |
|---|---|---|
| `caso_id` | `NOT NULL REFERENCES casos(id)` | `casos` nunca se poda (mismo criterio que `registro_acciones_empleado.caso_id`, `0005:50`). Es la correlación que sobrevive a cualquier fallo |
| `delegacion_id` | **Nullable con FK** | **Precedente ADR 48, ya aprobado.** El patch **es la evidencia**, y la evidencia no se pierde por una constraint. `NULL` **significa** "no la originó una delegación" |
| `base_commit` | `NOT NULL` | Sin él, un `git apply` que falla es indiagnosticable; con él, "la base se movió" es una respuesta (R13) |
| `rama_worktree` | `NOT NULL` | Correlaciona la fila con lo que el barrido del ADR 57 va a borrar |
| `patch` | `TEXT NOT NULL` | Los bytes exactos. **El tope NO se expresa en SQL** — SQLite no lo aplicaría; lo pone el núcleo (`PATCH_MAX_BYTES`), mismo criterio que `solicitudes_internas.detalle` |
| `patch_bytes`, `archivos`, `lineas_*` | `NOT NULL`, calculadas por `resumirPatch` (pura) | El eco y el listado no deben re-parsear 64 KB por fila |
| `estado` | `TEXT NOT NULL`, **sin `CHECK`**. **Tres** valores reales: `pendiente_aprobacion_humana` \| `aplicada` \| `descartada` | Criterio de TODO el esquema (`casos.estado`, `ventas.estado`, `actividades.estado`, `solicitudes_internas.estado`): el vocabulario canónico vive en el núcleo, el SQL no lo conoce. Que el SQL no declare el enum es también lo que hace que bajar de cuatro a tres valores (RD-12) **no toque el DDL**: el cambio vive entero en `propuestas-contract.ts` |
| `motivo` | Nullable | En `v2.1.0` lo escribe **sólo** `/descartar-propuesta` (motivo humano). `conflicto`/`tamano` son vocabulario de eventos, no de esta columna (ADR 64 pto 2) |
| `resuelta_por`, `resuelta_at` | Nullable, **SIN FK** | Precedente `0005` / ADR 49: una propuesta tiene que sobrevivir a la baja del empleado que la resolvió (la única baja soportada hoy es borrar la credencial, ADR 33) |
| `created_at`, `updated_at` | `NOT NULL` | ISO-8601 UTC, comparado y ordenado lexicográficamente (ADR 16 regla 3) |

**Dos índices, no uno**, a diferencia de `0007`: hay **dos** patrones de lectura reales y distintos — `/ver-propuesta` sin argumento filtra por `estado`, y la evidencia de `docs/progreso/` lee por `caso_id`.

### 7.2 `repository.ts` — funciones nuevas

```ts
export function insertPropuestaCambio(db, input: CrearPropuestaDbInput): PropuestaRow;
export function getPropuestaCambio(db, propuestaId: string): PropuestaRow | undefined;
export function listPropuestasCambio(db, filtro: {
  estado?: string; propuestaId?: string; limite?: number;
}): readonly PropuestaRow[];
export function aplicarPropuestaCambio(db, input: ResolucionPropuestaDbInput): PropuestaRow | undefined;
export function descartarPropuestaCambio(db, input: ResolucionPropuestaDbInput): PropuestaRow | undefined;
```

Las dos últimas comparten un `resolverPropuestaTransaccional(db, input, config)` **privado, calcado de `resolverEscalacionTransaccional`** (`repository.ts:1403-1455`), con el mismo invariante de su línea 1435-1437 (`if (!row) return undefined;` **antes** de tocar nada más):

```ts
const runInTransaction = db.transaction((): PropuestaRow | undefined => {
  const row = db.prepare(
    `UPDATE propuestas_cambio
        SET estado = @estadoDestino, motivo = COALESCE(@motivo, motivo),
            resuelta_por = @empleadoId, resuelta_at = @ahora, updated_at = @ahora
      WHERE id = @propuestaId AND estado = @estadoOrigen
     RETURNING ${PROPUESTA_SELECT_COLUMNS}`).get({…}) as PropuestaSqlRow | undefined;

  if (!row) { return undefined; }                       // ← CAS no matcheó: NADA se escribe

  updateCaso(db, input.casoId, { updatedAt: input.ahora });   // ← SÓLO timestamp (ADR 65)

  insertAccionEmpleado(db, {
    id: input.accionId, empleadoId: input.empleadoId, comando: config.comando,
    propuestaId: input.propuestaId, casoId: input.casoId,     // ← columna nueva (ADR 63)
    resultado: config.resultado, ocurridoAt: input.ahora,
  });

  return rowToPropuesta(row);
});
```

**No existe una transición exitosa sin su fila de auditoría, ni una fila sin su transición.** Es el mismo invariante estructural que `v1.4` estableció y `v2.0.0` replicó.

### 7.3 Composition root

**`build-on-activity.ts`** — el interruptor, molde exacto del ADR 54:

```ts
const escrituraActiva = (process.env.HARNESS_ESCRITURA_DELEGADA ?? "on") !== "off";

const escritura: EscrituraDelegadaDeps | undefined = escrituraActiva
  ? {
      worktree: gitAdapter.worktree,
      propuestas: createPropuestaStore(db),
      testRunnerMcpServers: (wt) =>
        createTestRunnerAdapter({ casoId: wt.casoId, cwd: wt.ruta, logEvent }).mcpServers,
      newId, now, logEvent,
    }
  : undefined;

const despacharRevision: RunActivityTurnDeps["despacharRevision"] =
  delegacionRolesActiva
    ? (casoId, prompt) => despacharRevisionPorRoles(casoId, prompt, delegacionDeps, escritura)
    : (casoId, prompt) => { /* camino de v1.2/v1.4, idéntico */ };
```

Con `HARNESS_ESCRITURA_DELEGADA=off`: `escritura === undefined` ⇒ **no se llama a `construirDeveloperConEscritura`**, no se abre worktree, no se monta el servidor MCP de tests, no se crea fila. El Developer es **exactamente** el de `v2.0.0`. `HARNESS_DELEGACION_ROLES=off` sigue degradando a `v1.4.0`, sin cambios: los dos interruptores son independientes y anidan (roles apagado ⇒ escritura irrelevante).

**`build-on-comando-empleado.ts`** — suma `propuestaStore: PropuestaStorePort` y `aplicarPatch: AplicarPatchPort` a sus deps (ambos inyectables, con default construido desde `db`/`gitAdapter`), tres `case` y los dos handlers de §5.10.

**`src/main.ts`** — el barrido de huérfanos al arranque. **Dónde exactamente**: después del bloque 5 (webhooks) y **antes** del bloque 6 (montar la TUI), con el mismo patrón de bloque propio que ya usan webhooks (líneas 302-312) y web (346-356):

```ts
// 5d. Barrido de worktrees huérfanos (ADR 57 pto 7). NO BLOQUEANTE: `barrerHuerfanos`
//     nunca rechaza por contrato, así que no hay `await` que esperar antes de
//     montar la TUI — un `SIGKILL` de una corrida vieja no puede demorar el
//     arranque de esta. El `.catch()` es la MISMA red de seguridad que este
//     archivo ya pone sobre `webhook.close()` (líneas 425-434), un método que
//     también promete no rechazar: si algún día lo violara, no puede impedir
//     que la TUI arranque.
const gitAdapter = createGitAdapter({ repoRoot: process.cwd(), logEvent, config: gitConfig });
void gitAdapter.barrido
  .barrerHuerfanos({ ttlMs: gitConfig.ttlMs, ahoraMs: Date.now() })
  .catch((error) =>
    logTurnEvent(WORKTREE_LOG_CORRELATION_ID, "worktree-barrido-fallido", {
      message: toErrorMessage(error),
    }),
  );
```

`WORKTREE_LOG_CORRELATION_ID = "worktree"` — mismo patrón que `WEBHOOK_LOG_CORRELATION_ID` / `COMANDO_LOG_CORRELATION_ID`, porque el barrido de arranque **no tiene `casoId`**.

### 7.4 Archivos de configuración del repo

| Archivo | Cambio | Motivo |
|---|---|---|
| `.gitignore` | `+ .harness/` | Verificado: hoy tiene 10 entradas y **ninguna** cubre `.harness/` |
| `vitest.config.ts` | **Nuevo**: `test: { exclude: [...configDefaults.exclude, ".harness/**"] }` | **R4.** Hoy **no existe ningún `vitest.config.*`** en el repo (verificado con `Glob`), y el exclude por defecto de vitest (`node_modules`, `dist`, `.idea`, `.git`, `.cache`) **no** cubre `.harness/`. Es el mismo modo de falla que ya mordió a este repo con `dist/` inflando el conteo de tests |
| `openspec/config.yaml` | `testing.layers.integration: false → true` | Verificado: línea 21. `src/test/integration/` ya existe con **dos** archivos (`assemble-context`, `close-turn`), pero **ninguno lanza un proceso externo**. Este change agrega el primero que sí |

---

## 8. Logging (Concepto Transversal 3)

Eventos nuevos, **sin cambiar el contrato de `logTurnEvent`** — mismo criterio de todos los hitos anteriores:

| Evento | `casoId` | Campos |
|---|---|---|
| `worktree-abierto` | caso real | `rama`, `baseCommit` |
| `worktree-cierre-fallido` | caso real | `rama`, `reason` |
| `worktree-barrido-ok` | `"worktree"` | `examinados`, `borrados`, `fallidos`, `ttlMs` |
| `worktree-barrido-fallido` | `"worktree"` | `message` |
| `tests-worktree-ok` | caso real | `exitCode`, `durationMs`, `outputChars`, `truncado` |
| `tests-worktree-error` | caso real | `reason`, `durationMs` |
| `propuesta-creada` | caso real | `propuestaId`, `patchBytes`, `archivos`, `lineasAgregadas`, `lineasEliminadas` |
| `propuesta-sin-cambios` | caso real | `rama` |
| `propuesta-rechazada-por-tamano` | caso real | `patchBytes`, `topeBytes` |
| `propuesta-revision-parcial` | caso real | `propuestaId`, `patchBytes`, `topeTarea` |
| `propuesta-listada` | `"tui-comando"` | `accion`, `cantidad` |
| `propuesta-resolucion-solicitada` | caso | `accion`, `propuestaId` |
| `propuesta-conflicto` | caso | `propuestaId`, `baseCommit`, `detalleChars` |
| `propuesta-resolucion-no-aplicable` | caso o `"tui-comando"` | `accion`, `propuestaId`, `motivo` |
| `propuesta-aplicada` / `propuesta-descartada` | caso | `propuestaId`, `empleadoId` |
| `propuesta-apply-fallido` | caso | `propuestaId`, `motivo` — **el evento de RD-13 hecho visible** |

**NUNCA se loguea el patch, ni un fragmento**: sólo `patchBytes` y los contadores. Ese texto ya está en la base con su `caso_id`; duplicarlo en el log de un proceso que sostiene una TUI es ruido más superficie de fuga de código propietario. Mismo criterio que `tareaChars` en `v2.0.0` y que `comando-empleado-recibido`, que loguea **sólo `tipo`** (`build-on-comando-empleado.ts:446`). **Tampoco se loguea la salida de los tests**, sólo `outputChars`.

---

## 9. Errores y degradación

| Falla | Comportamiento | Precedente |
|---|---|---|
| `abrir` falla (`git` ausente, disco lleno) | **Propaga**. El Developer no se invoca; la delegación falla como cualquier otra de `v2.0.0` (fila sin `resultado`) | `ActivityStorePort` / ADR 57 pto 6 |
| `capturarDiff` falla | **Propaga**. No se persiste una propuesta vacía o corrupta | ADR 57 pto 6 |
| `cerrar` falla | Evento `worktree-cierre-fallido`, **nunca rechaza**. El barrido de arranque lo recoge más tarde | ADR 57 pto 6 |
| `barrerHuerfanos` falla | Evento `worktree-barrido-fallido`, **nunca rechaza**, el arnés arranca igual | ADR 57 pto 7 |
| Patch vacío | `sin_cambios`, cero filas, evento | **ADR 70** |
| Patch > 64 KB | `rechazada_por_tamano`, cero filas, evento con `patchBytes`, worktree se cierra igual | ADR 58 pto 3 |
| La tool de tests no puede correr | Texto degradado explícito al Developer. **El handler nunca lanza** | `handleKnowledgeQuery` |
| `vitest` devuelve `exitCode ≠ 0` | **NO es falla**: resultado normal con la cola de la salida | **ADR 66** |
| `git apply --check` falla | `propuesta-conflicto`; la propuesta queda `pendiente_aprobacion_humana`; **cero escrituras** (spec, escenario explícito) | R13 / ADR 64 |
| CAS de `/aplicar-propuesta` no matchea | `no_aplicable`/`cas` + fila `no_aplicable` **fuera** de transacción. Nada más se escribe | `v1.4`, líneas 389-403 |
| `git apply` falla **después** del commit | Evento `propuesta-apply-fallido` + mensaje **explícito** al humano: la fila dice `aplicada` y el árbol no cambió. Detectable (`git status`) y reversible (el patch sigue persistido) | **RD-13, heredado y no reabierto** |
| `store.crearPropuesta` falla | **Propaga** (falla ruidosa): sin fila no hay evidencia, y evidencia perdida es peor que trabajo perdido | `ActivityStorePort` |

---

## 10. Estrategia de testing (TDD estricto — `strict_tdd: true`)

**Regla del change**: ningún test invoca el modelo real ni abre un puerto de red. La costura de modelo sigue siendo `InvocarSubagente`. **Tres categorías, y la tercera es nueva para este repo.**

### A. Tests puros (sin dobles, sin I/O) — la mayor parte

| Módulo | Qué se testea | TDD |
|---|---|---|
| `worktree-contract.ts` | valores de `WORKTREE_TEST_TOOL_QUALIFIED_NAME` (`"mcp__worktree__run_tests"`) y `WORKTREE_RAMA_PREFIJO`; **cero imports** (assert sobre el archivo, molde de `hitl-contract`) | Sí |
| `resumir-patch.ts` | `contarBytesUtf8` **contra `Buffer.byteLength`** (ASCII, acentos, CJK, emoji/par surrogate, surrogate huérfano, vacía); `resumirPatch` sobre patches fijados: 1 archivo, N archivos, sólo agregados, sólo borrados, archivo nuevo, patch binario | Sí |
| `propuestas-contract.ts` | `PATCH_MAX_BYTES === 65_536`; `PROPUESTA_ESTADO_PENDIENTE` **es** `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` (no una copia del literal); **el conjunto de estados tiene exactamente TRES elementos y ninguno es `"no_aplicable"`** (RD-12: el test es lo que impide que un futuro Implementer "complete" la máquina con un cuarto valor sin escritor) | Sí |
| `resolver-propuesta-cambio.ts` | **síncrona** (test explícito: la función no devuelve promesa, molde de `procesar-devolucion`); listado / eco / `aplicada` / `no_aplicable`+`no_encontrada` / `no_aplicable`+`cas` — **estos dos últimos son tags de `ResolucionHitlResult`, no estados persistidos**: el `estado` de la fila nunca vale `"no_aplicable"` (RD-12); sin sesión no se llega (el guard es del dispatcher) | Sí |
| `definitions.ts` | **el test estrella**: `construirDeveloperConEscritura(wt)` devuelve `Write`+`Edit`+`mcp__worktree__run_tests` **y** `cwd === wt.ruta`; `SUBAGENT_REGISTRY.developer.allowedTools` **no** cambió respecto de `v2.0.0`; **ninguna** de las cuatro definiciones del registro trae `Write`/`Edit`/`Bash`/`Agent`/`Task`; el par devuelto **no** permite `cwd` vacío | Sí |
| `git-cli.ts` (argv) | **`CONSTRUCTORES_ARGV`: para todo constructor y para entradas adversariales (`"commit"`, `"push"`, `"--exec=x"`, `"; rm -rf /"`, `"--upload-pack=x"`), `argv[0] ∈ SUBCOMANDOS_PERMITIDOS` y ningún elemento es `commit`/`push`/`remote`/`tag`.** Es el test que hace la prohibición de `AGENTS.md` línea 78 **inexpresable**, no documental | Sí |
| `test-runner-tool.ts` (truncado) | `truncarConservandoCola`: salida corta intacta y **sin marcador**; salida larga ⇒ `.length <= 8_000`, empieza con el marcador y **termina igual que la original**; par surrogate en el borde no se parte | Sí |
| `comando-empleado.ts` | los tres comandos nuevos; `/aplicar-propuesta` sin id ⇒ `ayuda/argumentos`; `/descartar-propuesta <id> motivo con espacios` ⇒ `motivo` entero; `esComandoPrivilegiado` **`true` para los tres**; `/ayuda` lista **catorce** | Sí |

### B. Tests con dobles de `ExecFileFn` (mismo patrón que `graphify-cli.test.ts`)

| Módulo | Qué se testea | Doble |
|---|---|---|
| `git-cli.ts` (errores) | `ENOENT` ⇒ `reason: "not-found"`; `killed`/`SIGTERM` ⇒ `"timeout"`; `code` numérico ⇒ `"exit-code"`; resto ⇒ `"unknown"`; **el error nativo nunca cruza el borde** | `GitExecFileFn` fake |
| `worktree.ts` | `abrir` llama `rev-parse` **y después** `worktree add` (spy ordenado) y devuelve `baseCommit`; `capturarDiff` llama `add --intent-to-add` **antes** de `diff`, ambos con `cwd = ruta del worktree`; `abrir`/`capturarDiff` **propagan**; `cerrar` **no rechaza** aunque las dos llamadas de git fallen; `verificar`/`aplicar` traducen la falla a `{ ok: false, motivo }` **sin rechazar** | `GitExecFileFn` fake |
| `barrido.ts` | parseo de `worktree list --porcelain`; **doble filtro**: una ruta fuera de `.harness/worktrees/` **no** se toca aunque su rama tenga el prefijo, y viceversa; mtime viejo ⇒ borra, reciente ⇒ **intacto**; un `stat` que falla no aborta el resto; `git` que falla ⇒ `{0,0,0}` **sin rechazar** | `GitExecFileFn` fake + `stat` inyectado |
| `test-runner-cli.ts` | **ADR 66**: `exitCode 1` con stdout ⇒ **resultado OK**, no error; `ENOENT` ⇒ `"not-found"`; `killed` ⇒ `"timeout"`; el argv es `[entrypoint, "run", "--reporter=basic"]` con `cwd` del worktree y **nunca** contiene `"npm"` | `TestExecFileFn` fake |
| `test-runner-tool.ts` | **nunca lanza**, ni con un `runTests` que tira **sincrónicamente**; los tres textos (verde / rojo / degradado); `exitCode` y duración **siempre** presentes | `runTests` fake |
| `crear-propuesta-cambio.ts` | los cuatro desenlaces; el orden `trim → resumir → tope → store` (el store **no** se llama en `sin_cambios` ni en `rechazada_por_tamano`) | `PropuestaStorePort` fake |
| `cadena-revision.ts` | orden `abrir → invocar → capturar → crear → cerrar` (spy ordenado); `cerrar` se llama **también** cuando `capturarDiff` tira; el `material` del Reviewer sale de `obtenerPropuesta`, **no** de la variable; `patchBytes > 8_000` ⇒ evento `propuesta-revision-parcial` y el ciclo **completa igual**; sin `escritura` ⇒ comportamiento **idéntico a `v2.0.0`** | `InvocarSubagente` + puertos fake |
| `build-on-comando-empleado.ts` | two-step de las dos acciones; **una sola ranura** (armar un reembolso y después una propuesta pisa el pendiente); `/login`/`/logout` la purgan; **1er llamado = cero escrituras**; `--check` que falla ⇒ cero escrituras y estado intacto; `apply` que falla **después** del commit ⇒ mensaje explícito | Puertos fake |
| `invoke-model.ts` | `options.cwd` presente **sólo** cuando se pasa `cwd`; omitido ⇒ `Options` **sin la clave** (`exactOptionalPropertyTypes`) | `queryFn` fake (ya existe) |
| `repository.test.ts` | la migración aplica; `propuesta_id` existe en `registro_acciones_empleado`; `delegacion_id` **NULL funciona** (prueba de que el ADR 48 era necesario acá también); CAS + `updateCaso` + fila, **todo o nada**; **el `estado` del caso NO cambia** (ADR 65 — assert explícito); **rollback** verificable (CAS que no matchea ⇒ ni caso tocado ni fila) | SQLite `:memory:` |
| `build-on-activity.test.ts` | el interruptor bindea el closure correcto en cada valor; con `off` **cero llamadas** a `worktree.abrir` | Doble |

### C. Integración contra `git` real — **categoría NUEVA para este repo**

Vive en `src/test/integration/` (que ya existe, con dos archivos que **no lanzan ningún proceso externo**). Este change agrega el primero que sí. Por eso `openspec/config.yaml` pasa `testing.layers.integration` de `false` a **`true`** — **ese cambio de configuración es parte del diseño, no un detalle de implementación**: declara que el repo pasa a tener una capa de test con dependencias externas (`git` en el `PATH`, `node_modules/vitest` presente), y el Reviewer tiene que poder verlo en el diff.

| Archivo | Qué verifica contra `git` de verdad |
|---|---|
| `worktree.integration.test.ts` | En un repo temporal fabricado en `os.tmpdir()` (`git init` + un commit): `abrir` crea el directorio y la rama; se **crea un archivo nuevo** y `capturarDiff` lo devuelve **como agregado con su contenido** (el escenario que `git diff` solo **no** cubre — es la razón de ser de `--intent-to-add`); `git apply --check` del patch capturado **pasa** contra el repo; `cerrar` deja `git worktree list` con una sola entrada y la rama borrada |
| `barrido.integration.test.ts` | Dos worktrees reales, uno con mtime forzado al pasado (`utimes`) y otro reciente: el barrido borra **el viejo** y deja **el reciente**; con `git` apuntado a un binario inexistente, el barrido **devuelve** en vez de tirar |
| `run-tests.integration.test.ts` | La tool corre `vitest` **de verdad** dentro de un worktree, resolviendo `node_modules` del checkout principal (**R5 verificado, no supuesto**), y devuelve `exitCode 0` con una suite mínima en verde y `≠ 0` con una rota |

**Regla de esta capa**: sólo `git`, sólo `vitest`, **nunca red, nunca el modelo, nunca el `.harness/` del repo real** (usan `HARNESS_WORKTREE_ROOT` apuntado a un temporal). Si `git` no está en el `PATH`, estos tres archivos hacen `skip` con mensaje explícito en vez de fallar — no se rompe la suite de alguien que no tiene git, aunque en este repo eso sea imposible por construcción.

**Excepción de TDD** (`AGENTS.md`, línea 17): la migración es SQL declarativo — se escribe junto a su test de `repository.test.ts`, que **sí** va primero. `vitest.config.ts` y `.gitignore` son scaffolding.

---

## 11. Verificación manual del entregable

1. **`HARNESS_ESCRITURA_DELEGADA` sin definir** (⇒ activo), `HARNESS_DELEGACION_ROLES` activo. Forwarding de un webhook de PR chico.
2. **Durante la corrida**: `ls .harness/worktrees/` muestra **un** directorio y `git worktree list` **dos** entradas. **Después**: cero y una — el `finally` cerró.
3. `SELECT id, base_commit, patch_bytes, archivos, lineas_agregadas, lineas_eliminadas, estado FROM propuestas_cambio WHERE caso_id = ?` ⇒ **una** fila, `pendiente_aprobacion_humana`, contadores coherentes.
4. **`git status` del checkout real: LIMPIO.** Esta comprobación convierte R14 (escritura fuera del worktree por path absoluto) en evidencia, no en promesa.
5. **El caso incluye un archivo nuevo, no sólo uno editado** — se verifica que el patch persistido lo trae completo (ADR 57 pto 5).
6. **`git apply --check` a mano** sobre el patch volcado de la base: pasa.
7. **La tool de tests**: se lee el log `tests-worktree-ok` con `exitCode` y `durationMs` reales; se repite el caso con la suite rota y se verifica que el Developer recibió **la cola** con el resumen de fallas.
8. **TUI**: `/login` → `/ver-propuesta` (lista) → `/ver-propuesta <id>` (patch paginado) → `/aplicar-propuesta <id>` (**eco, cero escrituras** — se verifica con un `SELECT` antes y después) → repetir (aplica) → `git status` muestra los cambios **sin stagear** y `git log` **sin commits nuevos**.
9. `SELECT * FROM registro_acciones_empleado ORDER BY ocurrido_at DESC LIMIT 1` ⇒ fila con `comando='/aplicar-propuesta'`, `propuesta_id` correcto, `empleado_id` no nulo.
10. **Descartar**: otra propuesta, `/descartar-propuesta <id> no me convence` ⇒ `estado='descartada'`, `motivo` guardado, fila de auditoría.
11. **Conflicto (R13)**: se modifica a mano un archivo que el patch toca, se intenta aplicar ⇒ mensaje de conflicto, **estado intacto**, cero filas de auditoría.
12. **Barrido**: se fabrica un worktree, se le fuerza el mtime a hace 3 h, se reinicia el arnés ⇒ desaparece; se repite con mtime reciente ⇒ sobrevive.
13. **Rollback**: `HARNESS_ESCRITURA_DELEGADA=off`, mismo PR ⇒ **cero worktrees, cero filas, mismo veredicto que `v2.0.0`**, y `/ayuda` **no** lista los tres comandos.
14. **R4**: con un worktree abierto, `npm test` reporta **el mismo conteo** de archivos y tests que sin él.
15. **Evidencia** en `docs/progreso/v2.1-escritura-delegada/`: el patch real, el eco del comando, `git status` antes y después, el volcado de las tres tablas, y el log estructurado.

---

## 12. Presupuesto de review — corte de PRs encadenados (R11)

**Recalibración honesta de la estimación previa.** `hito-2.0/design.md` §15 estimó *"~930 líneas adicionales, 3 PRs"* y la propuesta la subió a ~930-1100. Bajado a firmas concretas, ese número **cuenta sólo producción**. Con TDD estricto (cada módulo con su `*.test.ts` colocado) la relación test:producción de este repo es ≈ **1:1**, así que el total real es **~1.900 líneas**. No es alcance nuevo: es la mitad que la estimación previa no contaba. **Con 400 líneas de presupuesto por PR, el corte de 3 PRs no alcanza — son 6.**

| PR | Contenido | Prod. | Test | Total |
|---|---|---|---|---|
| **1** | `worktree-contract.ts` · `git/config.ts` · `git/git-cli.ts` (runner + error + **los 10 argv**) · `vitest.config.ts` · `.gitignore` | ~230 | ~200 | **~430** |
| **2** | `git/worktree.ts` · `git/barrido.ts` · `git/index.ts` · **los 2 tests de integración contra `git` real** · `openspec/config.yaml` | ~250 | ~230 | **~480** |
| **3** | Migración `NNNN` (DDL + `ALTER TABLE`) · `repository.ts` (5 funciones + transaccional privada) · `registro-acciones-contract.ts` | ~200 | ~180 | **~380** |
| **4** | `core/propuestas/*` (4 archivos: contract, `resumir-patch`, `crear`, `resolver`) | ~230 | ~250 | **~480** |
| **5** | `test-runner/*` (4 archivos) · `definitions.ts` (constructor único) · `subagents.ts` · `invoke-model.ts` · test de integración de la tool | ~250 | ~230 | **~480** |
| **6** | `comando-empleado.ts` · `build-on-comando-empleado.ts` · `cadena-revision.ts` · `build-on-activity.ts` · `main.ts` (barrido) | ~280 | ~250 | **~530** |

**Total ≈ 2.780 líneas de diff** (1.440 producción + 1.340 test). Los PR 2, 4, 5 y 6 rozan o pasan las 400; el 6 es el más grande y, si al implementarlo se dispara, el corte natural es **6a** (los tres comandos: parser + dispatcher) y **6b** (cableado de la cadena + composition root + barrido).

**Orden y autonomía** — cada PR es demostrable solo y revertible sin tocar el anterior:

```
1 (aditivo puro: nadie lo consume todavía) ──▶ 2 (git funcionando end-to-end, verificable con el test de integración)
   └──▶ 3 (la tabla existe y se lee/escribe, verificable con repository.test.ts)
          └──▶ 4 (el núcleo de propuestas, verificable sin git ni modelo)
                 └──▶ 5 (el Developer puede escribir y correr tests — verificable con el interruptor)
                        └──▶ 6 (el humano puede ver, aplicar y descartar — ENTREGABLE COMPLETO)
```

**Rollback en orden inverso**: 6 → 5 → 4 → 3 → 2 → 1. **Los PR 1 y 2 son aditivos puros** (nadie los importa hasta el 5/6): pueden quedarse mergeados aunque se reviertan los demás, sin efecto observable. Con `feature-branch-chain`, el PR 1 apunta al tracker `hito/v2.1-escritura-delegada` y cada hijo al inmediato anterior.

---

## 13. Riesgos residuales (RD-9 a RD-18)

Numeración continuando la reserva de `hito-2.0/design.md` §15. RD-1 a RD-8 son de `v2.0.0` y siguen vigentes sin cambios.

| # | Riesgo | Mitigación |
|---|---|---|
| **RD-9** | **Gate de secuencia ignorado**: `sdd-apply` arranca sin `hito-2.0` en `main` y el Implementer reinventa ADR 53 adentro de este change | §0 con verificación ejecutable de **tres** condiciones. `sdd-apply` reporta `blocked`, no "parcial" |
| **RD-10** | `options.cwd` leído como **sandbox de SO** — el riesgo de comunicación, no el técnico | Declarado en §1, §5.3 (doc-comment obligatorio de `toQueryOptions`), §9 y el spec. La garantía es la **topología**; lo escrito afuera no se captura, no se muestra y no se aplica (R14, verificado en §11 paso 4) |
| **RD-11** | **La numeración de migración se hardcodea a `0009`** y `hito-2.0` cierra con otra cantidad de migraciones ⇒ `index.ts` reordenado, lo que su propia convención prohíbe | **ADR 63**: la regla (`M + 1`) es lo que se implementa, no el número. `sdd-tasks` escribe `NNNN`; `sdd-apply` resuelve `M` como su primer paso |
| **RD-12** | **RESUELTO.** El spec pedía una máquina de **cuatro** valores, pero ningún camino de `v2.1.0` persistía el cuarto: un conflicto de `git apply --check` no toca la fila y un exceso de tamaño no crea fila | **Decisión del checkpoint humano: máquina de TRES estados** (`pendiente_aprobacion_humana` / `aplicada` / `descartada`). Se eligió **bajar el vocabulario** en vez de forzar un escritor artificial para el cuarto — un estado que promete una transición que ningún camino ejecuta es peor que no tenerlo. `specs/propuesta-cambio-hitl/spec.md` y §5.4 quedaron alineados; el DDL **no cambia** (nunca tuvo `CHECK`). El tag `"no_aplicable"` de `ResolucionHitlResult` es otra cosa y **no se toca** — ver la nota de §5.4 |
| **RD-13** | **Sin transacción SQLite↔filesystem**: crash o fallo de `git apply` entre el commit del CAS y la escritura del árbol deja `aplicada` sin cambios | **Heredado de §15, no reabierto.** Se elige sobre el doble-apply porque es **detectable** (`git status`) y **reversible** (el patch sigue persistido). **Novedad de este diseño**: `AplicarPatchPort.aplicar` no rechaza, así que el caso deja evento `propuesta-apply-fallido` **y un mensaje explícito al humano** — deja de ser silencioso |
| **RD-14** | **El barrido borra un worktree VIVO** de otra instancia del arnés corriendo en el mismo repo | Doble filtro (ruta **y** prefijo de rama) + TTL de 2 h, holgadamente mayor que la delegación más larga plausible. `cerrar`/`barrer` nunca rechazan. **Limitación aceptada y declarada**: dos instancias concurrentes sobre el mismo checkout no están soportadas — tampoco lo estaban en `v2.0.0` |
| **RD-15** | **El Reviewer ve 8 KB de un patch de hasta 64 KB** (`TAREA_DELEGADA_MAX_CHARS` vs `PATCH_MAX_BYTES`) | **Confirmado por el checkpoint, no reabierto.** El veredicto queda declarado como **cota inferior**; el gate real es el humano leyendo los bytes completos en `/ver-propuesta`. Evento `propuesta-revision-parcial` + aviso en el eco. **Nota nueva**: el tope del Reviewer es en **caracteres** y el del patch en **bytes**, así que la comparación `patchBytes > TAREA_DELEGADA_MAX_CHARS` es una heurística conservadora, no una equivalencia — se documenta en el call site |
| **RD-16** | **`ALTER TABLE registro_acciones_empleado`** toca la tabla append-only más sensible del esquema (ADR 27/28) | Columna **nullable, aditiva, sin default no-NULL**: ninguna fila existente cambia, ningún lector actual la lee, ninguna migración previa se edita. `AccionEmpleado.propuestaId?` es opcional ⇒ cero call sites de `v1.4`/`v2.0.0` tocados. Verificado por `repository.test.ts` |
| **RD-17** | **Primer test del repo que lanza un proceso externo**: suite más lenta y potencialmente frágil en otra máquina o en CI | Categoría acotada a **tres archivos** en `src/test/integration/`, con `skip` explícito si `git` falta. Todo lo demás (argv, tope, resumen, barrido, truncado, contrato) es puro o con doble. `openspec/config.yaml` se corrige en el **mismo** change para que el Reviewer lo vea |
| **RD-18** | **`node_modules` del worktree**: si algún día `node_modules/` dejara de estar en `.gitignore`, o si el proyecto pasara a un gestor con `node_modules` por proyecto (pnpm con `node-linker=isolated`), la resolución desde `.harness/worktrees/<x>/` dejaría de subir al del checkout principal y la tool de tests moriría | El test de integración `run-tests.integration.test.ts` corre `vitest` **de verdad** desde adentro de un worktree: si esa suposición se rompe, **el test se pone rojo**, no el entregable en producción. Es exactamente el caso que un doble de `execFile` no puede atrapar |

---

## 14. Trazabilidad — requirement de spec ↔ diseño

Verificación completa: **los cuatro archivos de spec, requirement por requirement.** No hay requirement sin implementación, ni módulo de este diseño sin requirement que lo pida.

| Spec / Requirement | Dónde se implementa |
|---|---|
| `propuesta-cambio-hitl` · tabla propia con máquina de **3** estados, sin cuarto valor | §7.1 DDL + §5.4 `PropuestaEstado` (tres literales) + **RD-12** (resuelto por el checkpoint) |
| `propuesta-cambio-hitl` · `delegacion_id` nullable, la evidencia no se pierde | §7.1 tabla de columnas (precedente ADR 48) + test de `repository.test.ts` |
| `propuesta-cambio-hitl` · tope de 64 KB con **rechazo**, nunca truncado | §5.6 `crearPropuestaCambio` (`rechazada_por_tamano`, cero filas) + `PATCH_MAX_BYTES` |
| `propuesta-cambio-hitl` · el Reviewer juzga el patch **persistido** | §5.8 (`obtenerPropuesta` en `cadena-revision.ts`) + §4.1 (orden `INSERT → cerrar → Reviewer`) |
| `propuesta-cambio-hitl` · revisión parcial declarada, no rechazo | §5.8 evento `propuesta-revision-parcial`; **RD-15** |
| `propuesta-cambio-hitl` · `/ver-propuesta` es sólo lectura | §5.10 `manejarVerPropuesta` (no toca `store` de escritura) + ADR 69 (`privilegiado: true`) |
| `propuesta-cambio-hitl` · `/aplicar-propuesta`: sesión + two-step + `--check` → tx → `apply` | **ADR 64** + §4.2 (secuencia completa) + §5.10 |
| `propuesta-cambio-hitl` · el `--check` que falla **no quema el CAS** ni deja auditoría | §4.2 rama `v.ok === false` + §9 + test de `build-on-comando-empleado` |
| `propuesta-cambio-hitl` · "aplicar" nunca commitea/pushea/abre PR — **verificable** | **ADR 62** (sin `git()` genérico) + §6.1 `CONSTRUCTORES_ARGV` + §10.A test dedicado |
| `propuesta-cambio-hitl` · `/descartar-propuesta` con motivo y auditoría en una tx | §7.2 `descartarPropuestaCambio` + §5.10 |
| `propuesta-cambio-hitl` · sólo TUI con empleado autenticado resuelve | ADR 69 (`privilegiado: true` ×3) + §7.2 (`insertAccionEmpleado` **dentro** de la tx, `empleado_id NOT NULL`) |
| `propuesta-cambio-hitl` · ranura única `confirmacionPendiente` | §5.10 (tercera rama de la unión, ADR 55) + test "un reembolso pendiente se pisa" |
| `escritura-aislada-worktree` · ciclo `abrir → invocar → capturar → cerrar`, asimétrico | §5.1 `WorktreePort` (contrato en el doc-comment) + §4.1 + §6.1 `worktree.ts` |
| `escritura-aislada-worktree` · el worktree vive **dentro** del repo | §6.1 `config.ts` (`HARNESS_WORKTREE_ROOT` = `.harness/worktrees`) + **RD-18** + test de integración |
| `escritura-aislada-worktree` · la captura incluye archivos **nuevos** | §6.1 `capturarDiff` (`--intent-to-add` → `diff --binary`) + `worktree.integration.test.ts` |
| `escritura-aislada-worktree` · funciones nombradas, nunca `git(args)` | **ADR 62** + §6.1 (10 constructores) + §10.A |
| `escritura-aislada-worktree` · barrido con TTL configurable, no bloqueante | §6.1 `barrido.ts` (algoritmo exacto) + §7.3 `main.ts` bloque 5d + `barrido.integration.test.ts` |
| `escritura-aislada-worktree` · tools de escritura y `cwd` en el **mismo acto** | **ADR 67** + §5.2 `construirDeveloperConEscritura` + §10.A "el test estrella" |
| `escritura-aislada-worktree` · `mcp__worktree__run_tests` sin parámetros | §5.1 constantes + §6.2 (`tool(..., {}, ...)`, esquema zod vacío) |
| `escritura-aislada-worktree` · truncado conservando la **cola** | §6.2 `truncarConservandoCola` (algoritmo completo) + §10.A |
| `escritura-aislada-worktree` · el handler **nunca lanza** | §6.2 `handleRunTests` (molde de `handleKnowledgeQuery`) + §10.B (incluido el throw síncrono) |
| `escritura-aislada-worktree` · el worktree no infla la suite del checkout | §7.4 `vitest.config.ts` (R4) + §11 paso 14 |
| `delegacion-subagentes` (delta) · sólo `developer`, sólo con worktree | **ADR 67** + §5.2 |
| `delegacion-subagentes` (delta) · con el interruptor apagado, Developer = `v2.0.0` | §7.3 (`escritura === undefined` ⇒ no se llama al constructor) + §10.B `build-on-activity.test.ts` |
| `delegacion-subagentes` (delta) · ningún rol tiene `Bash`/`Agent`/`Task` | §5.2 (tabla de `allowedTools`) + §10.A test sobre las cuatro definiciones, con el interruptor en los dos valores |
| `revision-pr-por-roles` (delta) · el material del Reviewer es el patch persistido | §5.8 + §4.1 |
| `revision-pr-por-roles` (delta) · veredicto único aun con vista parcial | §5.8 + **RD-15**; los pasos 6-9 **no se tocan** (ADR 47/54 intactos) |

---

## 15. Preguntas abiertas para el checkpoint humano

> **Cerradas por el checkpoint humano** (anotadas para el Reviewer, no se reabren):
>
> - **ADR 63 — `ALTER TABLE registro_acciones_empleado ADD COLUMN propuesta_id`**: **APROBADO** tal cual está diseñado (columna nullable, aditiva, sin default no-NULL). Ninguna fila existente cambia, ningún lector actual la lee, ninguna migración previa se edita.
> - **RD-12 — el cuarto estado sin escritor**: **RESUELTO bajando la máquina a TRES estados** (`pendiente_aprobacion_humana` / `aplicada` / `descartada`). No se fuerza un escritor artificial y el conflicto de `git apply --check` sigue sin crear ni actualizar fila. `specs/propuesta-cambio-hitl/spec.md` §"Tabla propia" y §5.4 de este documento quedaron alineados en el mismo acto.

> - **ADR 65 — la transacción toca `casos` sólo en `updated_at`**: **CONFIRMADO**. La propuesta es un artefacto adicional dentro del caso, no un canal de transición de estado (coherente con ADR 59 pto 4) — el caso sigue su propio ciclo de vida independiente; aplicar una propuesta no lo cierra.
> - **§12 — el corte es de SEIS PRs, no de tres**: **CONFIRMADO**. `chain_strategy = feature-branch-chain` (mismo criterio que `hito-2.0-delegacion-subagentes`), fijado en `tasks.md`. Cada PR de la cadena apunta al anterior; solo el tracker mergea a `main` al cierre.
> - **ADR 69 — `/ver-propuesta` es `privilegiado: true`**: **CONFIRMADO**. Exige sesión activa igual que aplicar/descartar — mostrar el patch completo es mostrar código propietario, y ningún comando privilegiado de la TUI queda accesible sin autenticar.
> - **ADR 62 — `HARNESS_WORKTREE_ROOT`**: **ACEPTADO** como variable de entorno nueva. Los tests de integración corren contra un directorio configurable separado, no contra el `.harness/` real del repo.

---

**Nota de formato**: la skill `sdd-design` sugiere un tope de 800 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato técnico **completo** del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto, igual que en `exploration.md`, `proposal.md` y los cuatro `specs/`.
