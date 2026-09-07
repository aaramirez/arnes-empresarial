# Propuesta: Escritura delegada del Developer vía worktree aislado (v2.1.0)

**Origen**: [`design.md` §15 de `hito-2.0-delegacion-subagentes`](../hito-2.0-delegacion-subagentes/design.md) (líneas 832-848, ADR **57-61** y RD-9 a RD-15 reservados ahí) · [`exploration.md`](exploration.md) de este change · decisión explícita del **checkpoint humano** · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Blanca 2.1 (Definición y Carga de Agentes), 2.2 (Delegación a Subagentes), ADR 4 (otorgar una herramienta es auto-aprobarla).

**Rama prevista**: `hito/v2.1-escritura-delegada` · **Tag de cierre**: `v2.1.0` · **Carpeta de progreso**: `docs/progreso/v2.1-escritura-delegada/`.

## Aclaración previa: qué es y qué NO es este change

**No es un hito del Plan de Implementación.** El [Plan](../../../docs/Plan_Implementacion_Harness_Empresarial.md) tiene siete hitos y ninguno pide que un subagente escriba código: la línea 315 da el ejemplo del subagente de PRs con `tools: ['Read', 'Grep', 'Glob']` y la línea 324 define el entregable del Hito 5 como *"el mismo caso del Hito 3"*, que es **revisar y comentar** un PR. `hito-2.0` verificó ese texto y **revirtió a read-only** (revisión 3 de su `design.md`), dejando el mecanismo completo documentado en §15 como candidato a `v2.1.0`.

Este change **retoma esa §15 por decisión del checkpoint humano**, no por un requisito del Plan. Por eso no hay una tabla de "casos de uso del Plan" que copiar: el entregable se declara acá, y es uno solo:

> **El Developer produce un diff real, revisable y aplicable con confirmación humana, sin exponer el checkout real a escritura no auditada.**

Todo lo demás de esta propuesta existe para sostener esa frase.

**Tres decisiones que el checkpoint humano ya cerró y esta propuesta NO reabre**:

1. El Developer **sí** escribe código real en `v2.1.0`, vía worktree aislado — exactamente lo que §15 diseñó.
2. El esquema de `delegaciones` con **FK nullable** (ADR 48 de `v2.0.0`) es **precedente aceptado** para cualquier necesidad equivalente acá.
3. Se construye una **tool MCP acotada para correr tests dentro del worktree**. **No** se le otorga `Bash` al Developer, en ninguna forma.

## Dependencia de secuencia (gate duro de `sdd-apply`)

**Esta sección no es una nota al pie: es una precondición de proceso, del mismo rango que el checkpoint humano.**

`sdd-apply` de `v2.1.0` **no arranca** hasta que `hito-2.0-delegacion-subagentes` esté **mergeado a `main`** con su checklist de cierre completo (Reviewer aprobado, entregable demostrado, `docs/progreso/v2.0-delegacion-subagentes/`, tag `v2.0.0`). Tres motivos verificados contra el código real, no supuestos:

| # | Qué depende | Estado real hoy | Consecuencia si se ignora |
|---|---|---|---|
| 1 | Que **cada rol sea su propia llamada a `query()`** con su propio `Options` y por lo tanto su propio `cwd` — eso **es ADR 53** | `InvocarSubagente`, `SUBAGENT_REGISTRY` y `toQueryOptions` por rol **no existen como código**: `src/core/agents/` tiene sólo `definitions.ts` con **un** agente, y `invoke-model.ts` no tiene ningún campo `cwd` | No hay dónde colgar el `cwd` del worktree sin tocar el agente conversacional único — el Implementer de `v2.1.0` tendría que reinventar la infraestructura de `hito-2.0` adentro de este change, duplicándola o contradiciéndola |
| 2 | La numeración de migración | El techo real es `0006_credenciales_empleado.ts`; `0007`/`0008` de `hito-2.0` son planificación, no archivos | Colisión de números y un `index.ts` de migraciones reordenado — justo lo que su convención (`index.ts:14-18`) prohíbe |
| 3 | Que exista el `AgentDefinition` `developer` al que ensancharle tools y `cwd` | Es tarea de `hito-2.0` (tareas 5-6 de su `tasks.md`, **ninguna casilla marcada**) | Este change dejaría de ser una extensión y pasaría a ser una reimplementación parcial de `v2.0.0` |

**Lo que sí puede avanzar ya, en paralelo**: `sdd-propose` (este documento), `sdd-spec`, `sdd-design` y `sdd-tasks`. Ninguno toca código. La condición que arrastran es de **citación**: todo objeto de `hito-2.0` que se nombre acá (`SUBAGENT_REGISTRY`, `InvocarSubagente`, `despacharCadena`, migración `0007`) se cita como **referencia a la especificación de `hito-2.0`, no al código**, y `sdd-design` debe **revalidarlo contra el código real** cuando ese hito cierre.

**Verificación del gate, ejecutable**: `git log main --oneline | grep v2.0` con el merge presente **y** `src/core/agents/subagents.ts` existiendo en `main`. Sin las dos cosas, `sdd-apply` se detiene y reporta `blocked`.

## Intent

`v2.0.0` deja el arnés repartiendo trabajo entre cuatro subagentes, **todos de lectura**. El Developer produce texto: hallazgos, impacto, propuestas en prosa. Un humano después traduce ese texto a código a mano. El salto de valor que falta es el que separa *"un agente que opina sobre el código"* de *"un agente que produce un cambio"*, y el proyecto no lo dio todavía por una razón buena: darle `Write`/`Edit` a un rol que dispara un **webhook**, sin persona presente, sobre el **checkout real**, es exactamente lo que ADR 4 prohíbe — otorgar una herramienta es auto-aprobarla, sin confirmación humana por llamada.

Este change da ese salto **sin levantar la prohibición**: mueve la escritura a un lugar donde no importa que sea auto-aprobada. El Developer escribe en un `git worktree` descartable, el resultado sale de ahí como **un patch de texto persistido**, y el único camino de ese patch al checkout real pasa por **un empleado autenticado confirmando en dos pasos** en la TUI. Lo escrito fuera del worktree no se captura, no se muestra y no se aplica.

La honestidad del argumento importa: **`options.cwd` no es un sandbox de sistema operativo**, y esta propuesta no lo vende como tal (R2). La garantía dura no es el `cwd`, es la **topología**: `git diff` dentro del worktree → confirmación humana → `git apply`. El `cwd` sólo evita el accidente; la topología evita el daño.

## Scope

### In Scope

- **Adaptador `src/adapters/git/`** (nuevo): `config.ts`, `git-cli.ts`, `worktree.ts`, `index.ts`. Mismo patrón de subproceso que `src/adapters/knowledge/graphify-cli.ts` — runner inyectable, `execFile` con argv en array y **nunca** `exec` ni shell, error tipado con `reason` clasificado (ADR 57).
- **Puerto `src/core/agents/worktree-contract.ts`** (nuevo): `WorktreePort` con contrato **asimétrico** (`abrir`/`capturarDiff` fallan ruidosamente; `cerrar` y `barrerHuerfanos` **nunca rechazan**), y `AplicarPatchPort` **separado**, con un único consumidor: el comando TUI (ADR 57, ADR 60).
- **Ciclo de vida del worktree por caso**: `abrir → invocar Developer → capturarDiff` con `cerrar` en un `finally`, más **barrido de huérfanos al arranque** con TTL fijo y configurable (ADR 57).
- **Tool MCP `mcp__worktree__run_tests`** (adaptador nuevo `src/adapters/test-runner/`): corre la suite **dentro del worktree**, sin parámetros, con `execFile` fijado al `cwd` del worktree y salida truncada. **No es `Bash`** (ADR 61).
- **Tabla propia `propuestas_cambio`** con su migración (`NNNN_propuestas_cambio.ts`, número real a resolver contra el estado del repo — ver ADR 58) y sus funciones de `repository.ts`.
- **Núcleo `src/core/propuestas/`** (nuevo): `propuestas-contract.ts`, `resumir-patch.ts` (**pura**), `crear-propuesta-cambio.ts`, `resolver-propuesta-cambio.ts` (**pura y síncrona**, molde literal de `resolverSolicitudInterna`, devolviendo `ResolucionHitlResult` del ADR 50).
- **Tres comandos TUI privilegiados**: `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta`, con el molde exacto de `/aprobar-reembolso` (two-step confirm con eco, ADR 25/36/55) y fila append-only en `registro_acciones_empleado` (ADR 60).
- **`allowedTools` del Developer ensanchado** a `["Read","Glob","Grep","Write","Edit","mcp__worktree__run_tests"]`, entregado **en el mismo acto** que el `cwd` del worktree (ADR 61).
- **El Reviewer juzga el patch persistido**, no el worktree vivo (ADR 59).
- **Interruptor de degradación `HARNESS_ESCRITURA_DELEGADA`** en el composition root, mismo molde que `HARNESS_DELEGACION_ROLES` del ADR 54: `off` ⇒ comportamiento **idéntico a `v2.0.0`**.
- **`.gitignore` gana `.harness/`** y nace **`vitest.config.ts`** con `.harness/**` excluido — hoy no existe ningún archivo de configuración de vitest y su exclusión por defecto **no** cubre ese directorio (R4).
- **`openspec/config.yaml`**: `testing.layers.integration` pasa a `true`. Ya era falso desde Hito 1 (`src/test/integration/` existe con dos archivos), y este change agrega la **primera** prueba que lanza un proceso externo real (`git`).

### Out of Scope

- **`git commit`, `git push`, abrir un PR, o cualquier escritura en el historial** — desde ningún camino, ni siquiera con el Reviewer aprobado. `AGENTS.md` línea 78 es literal: *"El commit y el push los ejecuta siempre el humano"*. "Aplicar" **termina** en `git apply` sobre el working tree (ADR 60).
- **Un sandbox de sistema operativo real** (contenedor, `chroot`, jaula de permisos de FS, límites de proceso). El `cwd` es **anclaje de alcance**, no aislamiento. No se promete lo que no se construye (R2).
- **`Bash` para el Developer**, ni acotado, ni con allowlist, ni "sólo para tests". Una shell evapora el anclaje con un `cd ..` (ADR 61).
- **Resolución automática de conflictos**, `rebase`, `merge`, o reintento del patch contra otra base. Un `git apply --check` que falla devuelve `no_aplicable` con motivo, y ahí termina (ADR 60).
- **Que el Reviewer edite el patch.** Juzga bytes inmutables; si no le gustan, el ciclo se repite desde el Developer (ADR 59).
- **Aplicar propuestas desde el webhook o desde la web pública.** Sólo TUI: `registro_acciones_empleado.empleado_id` es `NOT NULL` por construcción (ADR 28) y un webhook no autentica a un empleado.
- **Varios worktrees concurrentes por caso** o paralelismo entre casos. Uno por delegación, cerrado en el `finally`.
- **Política de quién puede aplicar qué.** Cualquier empleado autenticado, misma limitación aceptada de `v1.4` (ADR 28) y de `v2.0.0`.
- **Unificar la mecánica HITL** de reembolso + solicitud + propuesta. Se comparte el **vocabulario** (ADR 42/50), no el resolvedor — ver ADR 60 punto 5.
- **Tools de calidad además de tests** (`typecheck`, linter, formateo) para el Developer. Una tool, un comando (ADR 61).
- **A2A, delegación anidada, delegación decidida por el modelo.** Siguen fuera, por los mismos ADR 44/45 de `v2.0.0`.
- **Dependencias nuevas en `package.json`.** El adaptador es `execFile("git", …)` crudo: no hay ni habrá `simple-git`/`isomorphic-git`.

## Capabilities

> El repo no tiene `openspec/specs/` — cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. Catálogo verificado de las 17 capabilities ya existentes (Hitos 1.1-1.3, `tui-canal-empleado`, `hito-2.0`): **ninguna colisiona** con los nombres de abajo. En particular `hitl-generico` y `solicitud-interna-hitl` de `hito-2.0` son **otros** capabilities y no se solapan con `propuesta-cambio-hitl`: el primero es vocabulario compartido, el segundo es vacaciones/gastos.

### New Capabilities

- **`propuesta-cambio-hitl`** — *nombre de §15 **confirmado***: persistencia de la propuesta de cambio con su máquina de estados, listado de pendientes, `/ver-propuesta`, two-step confirm de `/aplicar-propuesta` y `/descartar-propuesta`, `git apply` sobre el working tree como límite duro, y fila de auditoría.
- **`escritura-aislada-worktree`**: ciclo de vida del worktree descartable (abrir/capturar/cerrar), contrato asimétrico, barrido de huérfanos con TTL, captura del diff incluyendo archivos nuevos, tope de tamaño del patch, y la tool MCP de test acotada al worktree.

> **Nota para el checkpoint**: §15 anticipaba **una** capability. Propongo **dos** aplicando el criterio que `hito-2.0/design.md` §2 ya usó: el ciclo de vida del worktree tiene requirements que `propuesta-cambio-hitl` no puede reclamar (*"`cerrar` nunca rechaza"*, *"el barrido no tumba el arranque"*, *"la suite corre con el `cwd` del worktree"*) y se verifica con una **categoría de test distinta** (integración contra `git` real). Si el checkpoint prefiere un solo archivo de spec, colapsar `escritura-aislada-worktree` dentro de `propuesta-cambio-hitl` no cambia ninguna decisión de esta propuesta.

### Modified Capabilities

- **`delegacion-subagentes`** (de `hito-2.0`): el requisito *"ningún rol tiene herramientas de escritura"* — hoy con escenario dedicado (*"El Planner no tiene herramientas de escritura"*) y test que asserta que **ninguno** trae `Write`/`Edit` — cambia a: *"sólo el `developer` tiene `Write`/`Edit`, y sólo puede recibirlas junto con el `cwd` de un worktree; **ningún** rol tiene `Bash`, `Agent` ni `Task`"*. Es un **relajamiento acotado y explícito** de una prohibición vigente: tiene que estar escrito en el spec y en el test, no descubierto en el review (R12).
- **`revision-pr-por-roles`** (de `hito-2.0`): el eslabón del Developer pasa de producir texto a producir **un diff capturado y persistido**, y el `material` del Reviewer pasa a ser **el patch persistido** (ADR 59). El veredicto sigue siendo **uno solo** y del Reviewer.

**Sin cambio de spec**: `activity-webhook-turn` (el paso 5 sigue devolviendo el mismo `ActivityTurnOutcome`; los pasos 6-9 no se tocan), `despacho-delegacion` (la cadena y el registro de `delegaciones` no cambian de forma), `hitl-generico`, `solicitud-interna-hitl`, `comando-empleado-tui` y `registro-acciones-empleado` (tres comandos nuevos son **datos** sobre contratos que no cambian — mismo criterio que `hito-2.0` aplicó a sus tres comandos), y todo lo de `v1.x`.

## Decisiones de arquitectura fijadas por esta propuesta (ADR 57-61)

La numeración **continúa exactamente donde `hito-2.0/design.md` la reservó** (línea 842): arc42 (1-2), Hito 2 (3, 3.1, 4), Hito 3 (5-10), Hito 4 (11-20), `v1.4` (21-41), `hito-2.0` propuesta (42-47) y diseño (48-56). Este change abre en el **57**.

### ADR 57: El Developer escribe en un `git worktree` descartable por caso, creado por un adaptador `execFile` con contrato asimétrico y barrido de huérfanos con **TTL de 2 horas**

**Contexto**. El Developer necesita un directorio de trabajo que (a) sea un checkout real del repo, para que `Read`/`Grep`/`Edit` y la suite de tests tengan sentido; (b) no sea el checkout del humano; (c) desaparezca solo. `git worktree` es exactamente esa primitiva y ya está instalada — no hay dependencia que agregar, y `package.json` confirma que no existe ninguna librería de git en el proyecto.

**Decisión**:

1. **Ubicación: `.harness/worktrees/<casoId>-<uuid>/`, dentro del repo.** No en `os.tmpdir()`, y el motivo es técnico, no estético: `node_modules/` está en `.gitignore`, así que **un worktree nunca tiene `node_modules` propio**. Adentro del repo, la resolución de módulos de Node encuentra `<repo>/node_modules` subiendo por directorios padre; fuera del repo, no encuentra nada y la tool de tests del ADR 61 no puede funcionar (R5).
2. **Rama `harness/caso-<casoId>-<uuid>`**, creada desde `HEAD` (`git worktree add -b <rama> <ruta> HEAD`). El prefijo `harness/` es lo que hace **filtrable** el barrido, y la rama **nunca recibe un commit** — es un ancla para no trabajar en `HEAD` detached, nada más.
3. **Adaptador `src/adapters/git/`, molde de `graphify-cli.ts`**: `GitExecFileFn` inyectable (`(file, args, { timeout, cwd })`), `defaultExecFile` sobre `execFile` con `maxBuffer` elevado y `windowsHide`, **jamás `exec` ni `shell: true`**, y `GitCliError` con `reason ∈ {not-found, timeout, exit-code, unknown}` clasificado igual que `classifyFailure`. El tipo del runner se **duplica deliberadamente** en vez de importarse del adaptador de conocimiento: `AGENTS.md` prohíbe que un adaptador importe de otro, y el propio repo ya documentó esa duplicación aceptada cinco veces (`resolvePositiveNumber`, `graphify-cli.ts`/`config.ts:32-39`).
4. **Sin `git(args)` genérico.** El adaptador expone **funciones nombradas** (`abrirWorktree`, `capturarDiff`, `cerrarWorktree`, `barrerHuerfanos`, `verificarPatch`, `aplicarPatch`) y cada una construye su propio argv. No hay ninguna firma por la que el núcleo, un test o un futuro Implementer puedan pasar `commit` o `push`: **la prohibición de `AGENTS.md` línea 78 pasa a ser inexpresable**, y eso se asserta con un test sobre los constructores de argv.
5. **Captura del diff con archivos nuevos incluidos** — el detalle que §15 se saltea y que rompería el entregable: `git diff` **no muestra archivos untracked**, y el Developer con `Write` va a crear archivos. Se captura con `git add --intent-to-add --all` (registra los nuevos como blobs vacíos; **no** es staging de contenido ni commit) seguido de `git diff --binary --no-color --no-ext-diff`, ambos con `cwd` del worktree — que tiene su **propio índice**, separado del checkout real.
6. **Contrato asimétrico, deliberado**: `abrir` y `capturarDiff` **fallan ruidosamente** (criterio de `ActivityStorePort`: sin worktree no hay trabajo, y un diff que no se pudo capturar es trabajo perdido que hay que ver). `cerrar` y `barrerHuerfanos` **nunca rechazan**: degradan a evento (`worktree-cierre-fallido`, `worktree-barrido-fallido`), porque un `finally` que revienta enmascara el error real del `try`, y un barrido que revienta tumba el arranque del arnés por basura de una corrida vieja.
7. **Barrido de huérfanos al arranque, con TTL = `2 horas` (`7_200_000 ms`), configurable por `HARNESS_WORKTREE_TTL_MS`.** Corre en el composition root, no bloqueante. Filtra por **las dos** condiciones (ruta bajo `.harness/worktrees/` **y** rama con prefijo `harness/caso-`) y borra los que superan el TTL medido sobre el mtime del directorio; después `git worktree prune` y `git branch -D` de las ramas huérfanas. **Por qué 2 horas y no menos**: tiene que ser holgadamente mayor que la delegación más larga plausible (un turno de modelo + una corrida de la suite: minutos), porque borrar un worktree **vivo** rompería una corrida en progreso; y holgadamente menor que una jornada, para que la basura de un `SIGKILL` no sobreviva al día. **Por qué configurable y el tope del patch no** (ADR 58): el TTL es un parámetro **operativo** (depende de la máquina y del tamaño del repo), como `GRAPHIFY_TIMEOUT_MS`; el tope del patch es un **invariante de la evidencia**, como `SAVE_RESULT_TIMEOUT_MS`, que el propio código declara *"no configurable por env, a propósito"*.

**Alternativas consideradas**:

- *Copiar el repo a un directorio temporal (`cp -r`)*: **rechazada**. Sin `.git` no hay `git diff`, así que habría que escribir un differ propio; con `.git` copiado, se duplica el repo entero por caso. `git worktree` da las dos cosas gratis y es la primitiva que el problema pide.
- *Worktree fuera del repo (`os.tmpdir()`)*: **rechazada** por el punto 1 — sin `node_modules` alcanzable, la tool de tests del ADR 61 no existe, y la limitación conocida de §15 (*"podría editar pero no correr los tests"*) queda sin resolver.
- *Un solo worktree reusado entre casos*: **rechazada**. El estado del caso anterior contamina el diff del siguiente, y el aislamiento entre delegaciones — la propiedad que `hito-2.0` existe para demostrar — se pierde en el filesystem justo después de haberse ganado en el contexto.

### ADR 58: El diff se persiste en tabla propia `propuestas_cambio`, con **tope de 64 KB y rechazo (no truncado)**, y número de migración resuelto en `sdd-design`

**Contexto**. Lo que el Developer produce tiene máquina de estados, aprobador, motivo de rechazo, índice de listado y una relación 1:N con el caso. Meterlo en una columna de `delegaciones` sería el mismo error que el ADR 43 rechazó con `actividades`: reuso aparente, acoplamiento real.

**Decisión**:

1. **DDL** (`IF NOT EXISTS`, sin `CHECK` sobre `estado` — criterio de todo el esquema: el vocabulario canónico vive en el núcleo, el SQL no lo conoce):

```sql
CREATE TABLE IF NOT EXISTS propuestas_cambio (
  id                TEXT PRIMARY KEY,
  caso_id           TEXT NOT NULL REFERENCES casos(id),
  delegacion_id     TEXT REFERENCES delegaciones(id),   -- nullable, ADR 48
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
```

2. **Columna por columna, con su precedente**:

| Columna | Decisión | Motivo |
|---|---|---|
| `caso_id` | `NOT NULL REFERENCES casos(id)` | `casos` nunca se poda (mismo criterio que `registro_acciones_empleado.caso_id`). Es la correlación que sobrevive a cualquier fallo — argumento textual del ADR 48 |
| `delegacion_id` | **Nullable con FK** | **Precedente ADR 48, ya aprobado por el checkpoint.** El patch **es la evidencia**, y la evidencia no se pierde por una constraint: si la delegación no se pudo completar, o si un futuro camino crea una propuesta sin delegación de origen, la fila igual se persiste. `NULL` acá **significa** "no la originó una delegación" |
| `base_commit` | `NOT NULL` | El SHA desde el que se creó el worktree. Sin él, un `git apply` que falla es indiagnosticable; con él, "la base se movió" es una respuesta (R13) |
| `rama_worktree` | `NOT NULL` | Correlaciona la fila con lo que el barrido del ADR 57 va a borrar |
| `patch` | `TEXT NOT NULL` | Los bytes exactos. El tope **no** se expresa en SQL — SQLite no lo aplicaría; lo pone el núcleo, mismo criterio que `solicitudes_internas.detalle` |
| `patch_bytes`, `archivos`, `lineas_*` | `NOT NULL`, calculadas por `resumirPatch` (**pura**) | El eco de `/aplicar-propuesta` y el listado no deben re-parsear un patch de 64 KB por fila |
| `estado` | `pendiente_aprobacion_humana` \| `aplicada` \| `descartada` \| `no_aplicable` | El primero **es** `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` de `hitl-contract.ts` (ADR 42), igual que en `solicitudes_internas` |
| `motivo` | Nullable | Motivo humano del descarte o motivo técnico (`conflicto`, `tamano`) |
| `resuelta_por`, `resuelta_at` | Nullable, **sin FK** | Precedente de `0005` / ADR 49: una propuesta tiene que sobrevivir a la baja del empleado que la resolvió |

3. **Tope del patch: `PATCH_MAX_BYTES = 65_536` (64 KB), y el exceso se RECHAZA — no se trunca.** Esta es la diferencia de fondo con `TAREA_DELEGADA_MAX_CHARS`: un texto delegado truncado sigue sirviendo; **un patch truncado es un patch corrupto** que `git apply` rechaza, y persistirlo produciría una fila que *parece* aplicable y no lo es — el peor modo de falla posible para esta tabla. Al exceder el tope: se registra la fila con `estado = "no_aplicable"`, `motivo = "tamano"` y **sin `patch`**… salvo que `patch` es `NOT NULL`; por eso la decisión operativa es **no crear fila** y emitir el evento `propuesta-rechazada-por-tamano` con `patchBytes`, cerrando el worktree igual. El trabajo se pierde a propósito: un patch de más de 64 KB no es un cambio revisable, es un incidente.
4. **Por qué 64 KB**: ≈ 1000-1300 líneas de diff, o sea **2,5-3× el presupuesto de review de 400 líneas** que este repo ya usa. Generoso para cualquier rebanada legítima, chico para "el Developer reescribió medio repo".
5. **Numeración de la migración: `NNNN_propuestas_cambio.ts`, resuelta en `sdd-design`/`sdd-apply` contra el estado real del repo.** Hoy el techo verificado es `0006_credenciales_empleado.ts`; con `hito-2.0` aplicado será `0009`. §15 escribió `0009` cuando asumía `0007`/`0008` ya aterrizadas — esta propuesta **no fija el número**, fija la regla: se agrega **al final** de `migrations/index.ts`, sin editar ni reordenar ninguna existente.

### ADR 59: El Reviewer juzga el **patch persistido**, nunca el worktree vivo

**Contexto**. Si el Reviewer inspeccionara el worktree, tres artefactos podrían divergir: lo que el Reviewer leyó, lo que el humano ve en el eco, y lo que `git apply` escribe. Un veredicto sobre un estado que ya no existe no es una revisión.

**Decisión**:

1. La secuencia es **`capturarDiff` → tope (ADR 58) → `INSERT` → `cerrar` (en `finally`) → recién ahí se arma el eslabón del Reviewer**. El worktree ya no existe cuando el Reviewer opina.
2. El `material` del Reviewer se **lee de vuelta de la base** (`obtenerPropuesta(id)`), no de la variable en memoria. Así, por construcción, `propuestas_cambio.patch` son **los mismos bytes** que el Reviewer leyó, que el eco resume y que `git apply` escribe.
3. **Tensión declarada, no escondida**: `construirTareaDelegada` trunca en `TAREA_DELEGADA_MAX_CHARS = 8_000` (invariante ya vigente de `hito-2.0`), y el tope del patch es 65_536. Para un patch grande, **el Reviewer ve una vista truncada**. No se toca el tope de 8 KB (su propio doc-comment lo declara no configurable) y no se baja el del patch a 8 KB (dejaría afuera cualquier cambio de más de ~130 líneas). Se asume así: la condición `patch_bytes > TAREA_DELEGADA_MAX_CHARS` es **derivable** (sin columna nueva), emite el evento `propuesta-revision-parcial`, aparece en el eco del comando, y el veredicto del Reviewer queda declarado como **cota inferior**: el gate real siempre fue el humano leyendo los bytes persistidos. **Si el checkpoint prefiere Reviewer y humano viendo exactamente los mismos bytes siempre, la palanca es bajar `PATCH_MAX_BYTES` a 8 KB** — ver *Qué necesita el checkpoint humano*.
4. El veredicto **sigue siendo uno solo y del Reviewer**, y los pasos 6-9 de `runActivityTurn` **no se tocan** (ADR 47/54 intactos). La propuesta de cambio es un artefacto **adicional**, no un canal alternativo de transición de estado.

### ADR 60: Nada llega al checkout real sin **two-step confirm** en la TUI, y "aplicar" **termina en `git apply`**

**Contexto**. `AGENTS.md` línea 78: *"El commit y el push los ejecuta siempre el humano. Ningún agente corre `git commit` ni `git push` por su cuenta, **ni siquiera con el Reviewer ya aprobado**"*. Y `registro_acciones_empleado.empleado_id` es `NOT NULL` (ADR 28): una acción sin empleado autenticado no es registrable, así que el canal sólo puede ser la TUI.

**Decisión**:

1. **Tres comandos privilegiados**, calcados de `/aprobar-reembolso` / `/rechazar-reembolso`:

| Comando | Uso | Comportamiento |
|---|---|---|
| `/ver-propuesta` | `/ver-propuesta [propuestaId]` | Sin id: lista pendientes (molde de `listarReembolsosPendientes`, con `LIMITE_LISTADO_PROPUESTAS`). Con id: muestra el resumen + el patch **paginado**. **Cero escrituras** |
| `/aplicar-propuesta` | `/aplicar-propuesta <propuestaId>` | 1er paso: eco (id, `base_commit`, archivos, `+N/-M`, aviso de revisión parcial si aplica). 2do paso: aplica |
| `/descartar-propuesta` | `/descartar-propuesta <propuestaId>` | Two-step también: es una transición de estado con auditoría, igual que `/rechazar-reembolso` |

2. **Secuencia exacta de "aplicar"**, con el orden elegido a conciencia: `git apply --check` (**verifica, no muta** — un conflicto no debe quemar el CAS) → CAS `pendiente_aprobacion_humana → aplicada` + `updateCaso` + fila en `registro_acciones_empleado`, **una transacción** (molde de `resolverEscalacionTransaccional`) → `git apply` sobre el working tree. **Sin `git add`, sin `commit`, sin `push`, sin `PR`, sin cambio de rama.** El humano queda con cambios sin stagear y `git status` limpio de sorpresas: revisa y commitea él, como siempre.
3. **RD-13 se hereda, no se reabre**: no hay transacción entre SQLite y el filesystem. Un crash entre el CAS y el `git apply` deja la propuesta `aplicada` sin cambios en el árbol. Se eligió sobre el riesgo opuesto (doble-apply) porque es **detectable** (`git status`) y **reversible** (el patch sigue persistido). Ya estaba aceptado en §15; se documenta, no se re-litiga.
4. **Una sola ranura `confirmacionPendiente`** (ADR 55): la unión discriminada gana `{ dominio: "propuesta"; accion: AccionPropuesta; propuestaId; … }`. No se agrega una tercera ranura, por el mismo motivo del ADR 55: la ranura única **es** la garantía de que hay como mucho una acción destructiva armada por vez.
5. **Este es el tercer dominio HITL — y NO dispara la unificación del ADR 42.** El disparador escrito era *"un tercer dominio cuyo CAS tenga la **misma forma** que uno de los dos existentes"*. La forma **no** es la misma en la dimensión que importa: el desenlace `aplicada` de una propuesta tiene un **efecto fuera de SQLite** (`git apply`), que ni el reembolso ni la solicitud tienen. Unificar arrastraría un efecto de filesystem — y el RD-13 que lo acompaña — a un resolvedor compartido con el camino del dinero. Se comparte el **tipo** `ResolucionHitlResult<PropuestaCambio, AccionPropuesta, PropuestaEstado>` (que es exactamente lo que el ADR 42 quería compartir), y **nada de la mecánica**. El disparador sigue vigente para un cuarto dominio puramente transaccional.

### ADR 61: `allowedTools` del Developer y la tool MCP `mcp__worktree__run_tests` — **nunca `Bash`**, y las tools de escritura se entregan **junto con** el `cwd`

**Contexto**. §15 dejó la limitación abierta: con `Write`/`Edit` pero sin `Bash`, el Developer edita pero no puede correr los tests de lo que escribió. El checkpoint decidió construir la tool MCP acotada. La exploración dejó sin definir su nombre, su comando, y cómo trunca.

**Decisión**:

1. **`allowedTools` final del Developer**: `["Read", "Glob", "Grep", "Write", "Edit", "mcp__worktree__run_tests"]`. **Nunca `Bash`** — en ninguna variante: todo el anclaje descansa en `options.cwd`, y una shell lo evapora con un `cd ..`. Tampoco `Agent`/`Task` (el "un solo nivel de profundidad" de `hito-2.0` sigue siendo estructural), ni `WebFetch`/`WebSearch`. Los otros tres roles **no cambian**: `planner` `["Read","Glob"]`, `reviewer` `["Read"]`, `validador-solicitudes` `[]`.
2. **Las tools de escritura y el `cwd` del worktree se entregan en el mismo acto, o no se entregan.** `SUBAGENT_REGISTRY.developer` queda **byte por byte como en `v2.0.0`** (read-only); una función pura del núcleo devuelve la variante de escritura **junto con** la ruta del worktree, y es el único constructor de esa variante. Así **no se puede escribir código** que le dé `Write` al Developer sin worktree — y eso es un test unitario, no una convención. Con `HARNESS_ESCRITURA_DELEGADA=off` el composition root no llama a ese constructor: el Developer vuelve a ser el de `v2.0.0`, sin tools de escritura y sin `cwd`.
3. **Nombre de la tool: `mcp__worktree__run_tests`** — servidor MCP `worktree`, tool `run_tests`, con las tres constantes (`WORKTREE_MCP_SERVER_NAME`, `WORKTREE_TEST_TOOL_NAME`, `WORKTREE_TEST_TOOL_QUALIFIED_NAME`) en el núcleo, copiando literalmente el patrón ya verificado de `src/core/knowledge/knowledge-contract.ts` (`mcp__knowledge__query_knowledge_base`).
4. **Sin parámetros.** Corre **toda** la suite del worktree. Un argumento de path o de filtro sería superficie de inyección en argv y, peor, permitiría al Developer reportar "verde" habiendo corrido tres tests. Sin parámetros, "la suite pasa" significa una sola cosa.
5. **Comando exacto: `execFile(process.execPath, [<ruta absoluta al entrypoint de vitest en el `node_modules` del checkout principal>, "run", "--reporter=basic"], { cwd: <ruta del worktree>, timeout })`.** Equivale a `vitest run`, que es el `test_command_raw` de `openspec/config.yaml` y el contenido literal del script `test` de `package.json`. **Por qué no `npm test` textual**: `npm` en Windows es `npm.cmd`, y Node ≥20 se niega a lanzar un `.cmd` con `execFile` sin shell — usar shell es exactamente lo que este ADR prohíbe. Se ejecuta el runner directamente y el problema desaparece (R6).
6. **Truncado de salida: `TEST_OUTPUT_MAX_CHARS = 8_000`, conservando la COLA.** Al revés que `construirTareaDelegada`, que conserva la cabeza: en `vitest run` el resumen de fallas está **al final**, así que truncar el final es tirar justo lo que el Developer necesita. Se antepone un marcador `[…salida truncada…]` y **siempre** se devuelven el `exitCode` y la duración, truncado o no.
7. **Timeout `HARNESS_WORKTREE_TEST_TIMEOUT_MS`, default `300_000` (5 min)**, holgado sobre la suite real (~1000 tests unitarios sin red ni proceso externo).
8. **El handler nunca lanza ni rechaza**, en ningún camino — contrato calcado de `handleKnowledgeQuery`. Toda falla se traduce a texto degradado (`"NO SE PUDIERON CORRER LOS TESTS: <motivo>. Decilo explícitamente en tu resultado en vez de afirmar que pasan."`). Un agente que recibe una excepción de tool improvisa; uno que recibe texto explícito, reporta.
9. **Dos adaptadores, cero contacto entre ellos**: `src/adapters/git/` (worktree, diff, apply) y `src/adapters/test-runner/` (servidor MCP). No se importan entre sí — `AGENTS.md` lo prohíbe. El composition root es quien le pasa la ruta del worktree al segundo, que es justamente lo que la regla protege.

## Approach

**Flujo del entregable — de webhook a patch aplicable.**

```
webhook GitHub → … → runActivityTurn pasos 1-4 (SIN CAMBIOS)
   │
   paso 5: despacharRevision  → despacharCadena([planner, developer, reviewer])   (v2.0.0)
   │
   ├─ planner   (Read, Glob)                → plan de revisión                      [sin cambios]
   │
   ├─ developer (Read, Glob, Grep, Write, Edit, mcp__worktree__run_tests)
   │     abrirWorktree(casoId)  → .harness/worktrees/<casoId>-<uuid>, rama harness/caso-…
   │        └─ invocarSubagente(developerConEscritura(worktree), cwd = worktree)   ← ADR 61 pto 2
   │             el Developer edita y corre `mcp__worktree__run_tests` cuantas veces quiera
   │     capturarDiff()  = git add -N -A ; git diff --binary        ← incluye archivos NUEVOS
   │     tope 64 KB → excede: evento + cerrar + sin fila            ← ADR 58
   │     INSERT propuestas_cambio (estado = pendiente_aprobacion_humana)
   │     finally: cerrarWorktree()  (NUNCA rechaza)                 ← ADR 57
   │
   └─ reviewer  (Read)  material = obtenerPropuesta(id).patch       ← ADR 59: bytes persistidos
         └─ emite la ÚNICA línea VEREDICTO:
   │
   pasos 6-9 (SIN CAMBIOS): parseVeredicto → transicionarEstado → updateActividadEstado → mirror

   ─────────────── más tarde, en la TUI, con un humano presente ───────────────
   /ver-propuesta              → lista pendientes / muestra el patch paginado
   /aplicar-propuesta <id>     1er paso → eco (base_commit, archivos, +N/-M, aviso parcial)
                               2do paso → git apply --check → CAS+caso+auditoría (1 tx) → git apply
   /descartar-propuesta <id>   two-step → CAS a `descartada` con motivo + auditoría
```

**Determinismo y no-determinismo, misma línea de corte de siempre**: el arnés decide *quién escribe, dónde y qué se hace con lo escrito*; el modelo decide *qué código*. La topología es determinista y testeable sin modelo; el contenido no.

**Arranque**: `barrerHuerfanos(TTL)` no bloqueante, degradado a evento.

**Testing (TDD estricto)**. Lo puro se testea puro y es la mayor parte: `resumirPatch`, `resolverPropuestaCambio` (síncrona, con test explícito de sincronía, molde de `procesar-devolucion`), los constructores de argv del adaptador (**incluido el test que asserta que ninguno puede emitir `commit`/`push`**), el truncado de salida de tests, el filtro del barrido, y el constructor único de la variante de escritura del Developer. La costura de modelo sigue siendo `InvocarSubagente` (ningún test invoca el modelo real). **La única categoría nueva** es integración contra `git` real en `src/test/integration/` — ese directorio ya existe, pero **ningún test del repo lanza hoy un proceso externo**; este change es el primero, y por eso `openspec/config.yaml` pasa a `integration: true`.

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/adapters/git/` (4 archivos) | **New** | `config.ts`, `git-cli.ts`, `worktree.ts`, `index.ts`. `execFile` inyectable, error tipado, argv nombrados sin `git()` genérico (ADR 57) |
| `src/adapters/test-runner/` (4 archivos) | **New** | Servidor MCP `worktree` con la tool `run_tests`; molde exacto del adaptador de conocimiento (ADR 61) |
| `src/core/agents/worktree-contract.ts` | **New** | `WorktreePort` (asimétrico) + `AplicarPatchPort` (separado) + constantes de nombre de la tool MCP |
| `src/core/propuestas/propuestas-contract.ts` | **New** | Vocabulario, estados, `PropuestaCambio`, `PropuestaStorePort`, `PATCH_MAX_BYTES`, `LIMITE_LISTADO_PROPUESTAS` |
| `src/core/propuestas/resumir-patch.ts` | **New** | **Pura**: archivos, `+N/-M`, bytes |
| `src/core/propuestas/crear-propuesta-cambio.ts` | **New** | Tope, persistencia, evento; degradación por tamaño |
| `src/core/propuestas/resolver-propuesta-cambio.ts` | **New** | **Pura y síncrona**; devuelve `ResolucionHitlResult` (ADR 50/60) |
| `src/core/agents/definitions.ts` | **Modified** | Constructor único de la variante de escritura del `developer`; `SUBAGENT_REGISTRY` **sin cambios** (ADR 61 pto 2) |
| `src/core/agents/subagents.ts` | **Modified** | `InvocarSubagente` acepta `cwd` y `mcpServers` opcionales por invocación |
| `src/core/turn-selector/invoke-model.ts` | **Modified** | `toQueryOptions` propaga `cwd` y `mcpServers` del rol invocado |
| `src/core/activity/cadena-revision.ts` | **Modified** | El eslabón del Developer abre/captura/cierra; el `material` del Reviewer es el patch persistido |
| `src/core/commands/comando-empleado.ts` | **Modified** | Tres descriptores nuevos, los tres `privilegiado: true` |
| `src/core/commands/registro-acciones-contract.ts` | **Modified** | Constantes de comando y `resultado` — datos, sin cambio de contrato |
| `src/adapters/memory/migrations/NNNN_propuestas_cambio.ts` | **New** | DDL del ADR 58; número resuelto contra el estado real del repo |
| `src/adapters/memory/repository.ts` | **Modified** | Alta, obtención, listado y CAS transaccional de `propuestas_cambio` |
| `src/build-on-activity.ts` | **Modified** | Wiring del worktree + interruptor `HARNESS_ESCRITURA_DELEGADA` |
| `src/build-on-comando-empleado.ts` | **Modified** | Tres `case` nuevos; `confirmacionPendiente` gana el dominio `"propuesta"` |
| `src/main.ts` (composition root) | **Modified** | Barrido de huérfanos al arranque, no bloqueante |
| `src/core/logging/turn-logger.ts` | **Modified** | Eventos nuevos — datos, sin cambio de contrato |
| `vitest.config.ts` | **New** | Excluye `.harness/**` del descubrimiento de tests (R4) |
| `.gitignore` | **Modified** | `+ .harness/` |
| `openspec/config.yaml` | **Modified** | `testing.layers.integration: true` |
| `package.json` | — | **Sin dependencias nuevas** |

## Dependencias nuevas

**Ninguna.** `git` es un binario que el proyecto ya exige (es un repo git), el SDK y `better-sqlite3` ya están instalados, y la tool MCP usa el mismo `createSdkMcpServer`/`tool()` del adaptador de conocimiento. **Quinto change consecutivo sin romper la racha de cero dependencias productivas nuevas.**

## Entregables de `v2.1.0` — cobertura

No hay hito del Plan que enumere casos de uso acá (ver *Aclaración previa*), así que los entregables se declaran explícitamente:

| # | Entregable | Cubierto por | ¿En alcance? |
|---|---|---|---|
| 1 | El Developer escribe código real en un worktree descartable, sin tocar el checkout | ADR 57 + ADR 61; capability `escritura-aislada-worktree` | **Sí** |
| 2 | El Developer puede **verificar** lo que escribió corriendo la suite, sin `Bash` | ADR 61 (`mcp__worktree__run_tests`) | **Sí** — resuelve la limitación abierta de §15 |
| 3 | El diff (incluidos archivos nuevos) se captura y se persiste como patch aplicable, con tope | ADR 57 pto 5 + ADR 58 | **Sí** |
| 4 | El Reviewer emite su veredicto sobre **los mismos bytes** que se van a aplicar | ADR 59 | **Sí**, con la cota inferior declarada del pto 3 de ese ADR |
| 5 | Un humano autenticado ve, aplica o descarta la propuesta con confirmación en dos pasos y auditoría | ADR 60; capability `propuesta-cambio-hitl` | **Sí** |
| 6 | "Aplicar" **no** commitea, **no** pushea, **no** abre PR — y eso es inexpresable en el código, no una promesa | ADR 57 pto 4 + ADR 60 pto 2 | **Sí** — verificable por test sobre los constructores de argv |
| 7 | Un `SIGKILL` no deja worktrees ni ramas colgadas para siempre | ADR 57 pto 7 (TTL 2 h) | **Sí** |
| 8 | Rollback a `v2.0.0` exacto con una variable de entorno | `HARNESS_ESCRITURA_DELEGADA=off` | **Sí** |
| — | Sandbox de SO, commit/push/PR, resolución de conflictos | — | **No** — ver *Out of Scope* |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | **Bloqueo de secuencia**: `sdd-apply` arranca antes de que `hito-2.0` esté en `main` y el Implementer termina reinventando ADR 53 | **Alta** | Sección *Dependencia de secuencia* como gate duro, con verificación ejecutable. `sdd-apply` reporta `blocked` si no se cumple |
| R2 | `options.cwd` se lee como **sandbox de SO** y alguien confía de más | **Alta** | Declarado en *Intent*, en *Out of Scope* y en el spec: es **anclaje de alcance**. La garantía dura es la topología (`git diff` → confirm humano → `git apply`); lo escrito afuera no se captura, no se muestra y no se aplica |
| R3 | **Sin transacción SQLite↔filesystem** (RD-13): crash entre el CAS y `git apply` deja `aplicada` sin cambios en el árbol | Med | Riesgo **ya aceptado** en §15 y no reabierto: es detectable (`git status`) y reversible (el patch sigue persistido). Se elige sobre el doble-apply |
| R4 | El worktree bajo `.harness/` **es descubierto por el `vitest run` del checkout principal** — el exclude por defecto de vitest no lo cubre y hoy **no existe ningún `vitest.config.*`** | **Alta** | `vitest.config.ts` nuevo con `.harness/**` excluido **+** `.gitignore`. Es el mismo modo de falla que ya mordió a este repo con `dist/` inflando el conteo de tests |
| R5 | Un worktree **no tiene `node_modules`** (está en `.gitignore`), así que la tool de tests no resuelve nada si el worktree vive fuera del repo | **Alta** | ADR 57 pto 1: worktrees **dentro** del repo, para que la resolución de Node suba a `<repo>/node_modules`. Test de integración que corre la tool de verdad |
| R6 | `execFile("npm", ["test"])` **falla en Windows** (`npm.cmd` no es lanzable sin shell en Node ≥20), y usar shell rompería el ADR 61 | Med | ADR 61 pto 5: se ejecuta `process.execPath` + entrypoint de vitest, equivalente a `vitest run` |
| R7 | Patch que excede 64 KB: se descarta trabajo real del Developer | Med | Aceptado a conciencia (ADR 58 pto 3): un patch de +1000 líneas de diff no es revisable. Queda evento con `patchBytes` para que el humano lo vea y acote la tarea |
| R8 | El `finally` no corre ante `SIGKILL`; y un barrido demasiado agresivo podría borrar un worktree **vivo** de otra instancia del arnés | Med | Doble filtro (ruta + prefijo de rama) y TTL de 2 h, holgadamente mayor que la delegación más larga plausible. `cerrar`/`barrer` nunca rechazan |
| R9 | La numeración de migración y de ADR son **reservas**, no compromisos | Med | ADR 58 pto 5: `NNNN_` con la regla ("al final de `index.ts`, sin reordenar"); `sdd-design` fija el número contra el repo real |
| R10 | Primera prueba del repo que **lanza un proceso externo** (`git`): suite más lenta y potencialmente frágil en otra máquina | Med | Categoría acotada a `src/test/integration/`; todo lo demás (argv, tope, resumen, barrido, truncado) es puro y no toca `git`. `openspec/config.yaml` se corrige en el mismo change |
| R11 | Presupuesto de review: §15 estimó **~930 líneas** y esta propuesta agrega el adaptador de tests | **Alta** | `sdd-tasks` debe forecastear **PRs encadenados**. Corte natural: (a) `src/adapters/git/` + puerto, (b) tabla + núcleo de propuestas + cableado en la cadena, (c) tool MCP de tests, (d) comandos TUI |
| R12 | El spec y el test de `hito-2.0` dicen *"ningún rol tiene herramientas de escritura"*; cambiarlo puede leerse como **regresión de seguridad** si no está escrito | Med | Delta explícita sobre `delegacion-subagentes` (ver *Modified Capabilities*), con el test reescrito a *"sólo `developer`, sólo con worktree, ninguno con `Bash`"*. Se aprueba en el checkpoint, no se descubre en el review |
| R13 | El patch **no aplica** porque `main` se movió desde `base_commit` | Med | `git apply --check` **antes** del CAS ⇒ `no_aplicable` con `motivo = "conflicto"`, sin quemar la propuesta. `base_commit` persistido hace el diagnóstico trivial |
| R14 | El Developer con `Write` escribe **fuera** del worktree por un path absoluto | Baja | No lo evita el `cwd` (R2): lo evita la **topología** — lo escrito afuera nunca entra al patch. Además se verifica en la prueba manual: `git status` del checkout real **limpio** después del ciclo |

## Rollback Plan

1. **En caliente**: `HARNESS_ESCRITURA_DELEGADA=off`. El composition root no llama al constructor de la variante de escritura ni abre worktree: el Developer vuelve a ser **exactamente** el de `v2.0.0` (`["Read","Glob","Grep"]`, sin `cwd`, sin tool de tests) y la cadena de revisión se comporta idéntica. Los tres comandos no se registran en el dispatcher y `/ayuda` no los lista.
2. **Migración**: la tabla es nueva y `IF NOT EXISTS`; no altera ninguna existente ni la lee nadie más. Queda vacía. Ninguna migración anterior se modifica.
3. **Filesystem**: `git worktree list` + `git worktree prune` + `git branch -D 'harness/caso-*'` limpia todo rastro; `.harness/` se puede borrar entero sin consecuencia.
4. **A nivel git**: revertir los commits de `hito/v2.1-escritura-delegada` antes del merge a `main`. Con PRs encadenados (R11), en orden inverso: comandos TUI → tool de tests → propuestas → adaptador git. El adaptador es **aditivo puro** y puede quedarse mergeado sin daño.
5. **Propuestas ya aplicadas**: no necesitan rollback del arnés — son cambios sin stagear en el working tree del humano, que revierte con `git checkout --` o `git stash` como cualquier edición propia. **Esa es la ventaja de haber frenado en `git apply`.**

## Dependencies

- **`hito-2.0-delegacion-subagentes` mergeado a `main`** con checklist de cierre completo y tag `v2.0.0` — **gate duro de `sdd-apply`**, ver *Dependencia de secuencia*. Hoy **no** se cumple: ninguna de sus 25 tareas está marcada.
- `git` disponible en el `PATH` con soporte de `worktree` (≥ 2.5; cualquier instalación moderna).
- Node ≥ 20 (ya declarado en `package.json`) y `vitest` en `node_modules` del checkout principal.
- **Checkpoint humano aprobando esta propuesta** — en particular ADR 57 (TTL), 58 (tope de 64 KB y rechazo en vez de truncado), 59 (revisión parcial del Reviewer), 60 (límite en `git apply`) y 61 (`allowedTools` y la tool MCP), más la delta sobre `delegacion-subagentes` de R12 — **antes** de `sdd-spec`/`sdd-design`.
- `sdd-spec` corre **primero**: `AGENTS.md` pone la especificación antes del diseño, y `propuesta-cambio-hitl` es una capability sin requirements escritos (precondición de proceso que §15 ya anticipaba).

## Success Criteria

- [ ] Un evento de PR con `HARNESS_ESCRITURA_DELEGADA` activo deja **una fila** en `propuestas_cambio` con `estado = pendiente_aprobacion_humana`, `base_commit`, `patch` no vacío y los contadores (`archivos`, `+N/-M`) coincidentes con el patch.
- [ ] El patch persistido **incluye archivos nuevos** creados por el Developer — se verifica con un caso que crea un archivo, no sólo que edita uno.
- [ ] `git apply --check` sobre el patch persistido, en el checkout real, **pasa** sin intervención manual.
- [ ] Después del ciclo completo y **antes** de aplicar, `git status` del checkout real está **limpio** y `.harness/` no contiene ningún worktree (el `finally` cerró).
- [ ] El Developer puede invocar `mcp__worktree__run_tests` dentro del worktree y recibir salida real de `vitest run`; con la suite rota, recibe la cola con las fallas y el `exitCode` distinto de cero.
- [ ] `allowedTools` del Developer **no contiene `Bash`** en ningún camino de código, y ningún rol contiene `Agent`/`Task` — test dedicado.
- [ ] **No existe forma de construir** un `AgentDefinition` de Developer con `Write`/`Edit` sin una ruta de worktree: el constructor único los entrega juntos — test dedicado.
- [ ] **Ningún constructor de argv del adaptador puede emitir `commit`, `push`, `remote` ni `tag`** — test dedicado sobre los builders, no sobre el proceso.
- [ ] `/aplicar-propuesta` exige sesión vigente y confirmación en dos pasos; el 1er paso hace **cero escrituras**; el 2do deja fila en `registro_acciones_empleado` en la **misma transacción** que el CAS.
- [ ] Un patch que excede `PATCH_MAX_BYTES` **no crea fila**, emite el evento con `patchBytes` y cierra el worktree igual.
- [ ] El barrido de arranque borra un worktree fabricado con mtime viejo, **no** borra uno reciente, y **no** tumba el arranque si `git` falla.
- [ ] Con `HARNESS_ESCRITURA_DELEGADA=off`, el bot de PRs se comporta **idéntico a `v2.0.0`**: cero worktrees creados, cero filas en `propuestas_cambio`, mismo veredicto.
- [ ] `npm test` y `npm run typecheck` en verde; **ningún test invoca el modelo real ni abre un puerto de red**; los únicos tests que lanzan un proceso externo viven en `src/test/integration/`.
- [ ] `.harness/` está en `.gitignore` y **excluido** de `vitest.config.ts` — se verifica corriendo la suite con un worktree abierto y confirmando que el conteo de tests no cambia.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v2.1-escritura-delegada/` con evidencia end-to-end (patch real, eco del comando, `git status` antes y después), tag `v2.1.0`.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| `git commit` / `git push` / abrir PR automáticos | **Nunca, mientras `AGENTS.md` línea 78 esté vigente** | *"El commit y el push los ejecuta siempre el humano… ni siquiera con el Reviewer ya aprobado"*. No es una limitación técnica: es una regla del proyecto |
| Sandbox de SO real (contenedor, `chroot`, límites de proceso) | Change futuro, si el arnés llega a correr código no confiable | El `cwd` es anclaje, no aislamiento (R2). Construir un sandbox de verdad es un proyecto propio, y venderlo a medias es peor que no tenerlo |
| `Bash` para el Developer, en cualquier variante | **Nunca** | Una shell evapora el anclaje con `cd ..`. La necesidad concreta (correr tests) se cubre con una tool acotada, sin parámetros |
| Resolución automática de conflictos / rebase del patch | Change futuro con caso real | `git apply --check` que falla ⇒ `no_aplicable` con motivo. Reintentar contra otra base sin política de idempotencia sería peor que fallar |
| Que el Reviewer edite o parchee el patch | Change futuro | ADR 59: juzga bytes inmutables. Un revisor que edita deja de ser revisor |
| Aplicar propuestas desde webhook o web pública | Change futuro con autenticación propia | `registro_acciones_empleado.empleado_id` es `NOT NULL`; un webhook no autentica a un empleado (mismo argumento del ADR 43) |
| Tools de `typecheck`/lint/format para el Developer | Cuando exista evidencia de que los tests solos no alcanzan | Una tool, un comando. Cada tool nueva es superficie auto-aprobada (ADR 4) |
| Varios worktrees en paralelo / cola de escritura por proyecto | Change futuro con volumen real | Uno por delegación, cerrado en el `finally`. Concurrencia sin necesidad trae limpieza, locks y colisiones de rama |
| Política de quién puede aplicar qué (jerarquía, montos, dueños) | Change futuro | Misma limitación aceptada de `v1.4` (ADR 28) y de `v2.0.0`. No se amplía ni se reduce acá |
| Unificar la mecánica HITL de los tres dominios | Cuando aparezca un **cuarto** dominio puramente transaccional | ADR 60 pto 5: este tercer dominio difiere justo en la dimensión que importa (efecto fuera de SQLite) |
| A2A, delegación anidada, delegación decidida por el modelo | Hito 6 / changes futuros | Sin cambios respecto de los ADR 44/45 de `v2.0.0` |

## Qué necesita el checkpoint humano antes de `sdd-spec` / `sdd-design`

1. **ADR 58 — tope del patch en 64 KB, y rechazo en vez de truncado.** Es el número que la exploración dejó totalmente abierto. Si preferís otro, éste es el momento: la palanca tiene consecuencias visibles (ver punto 2).
2. **ADR 59 — el Reviewer puede ver una vista truncada a 8 KB de un patch de hasta 64 KB.** Hay dos salidas y hace falta elegir: **(a)** dejarlo así, con el veredicto declarado como cota inferior y el humano como gate real (lo que propongo); **(b)** bajar `PATCH_MAX_BYTES` a `TAREA_DELEGADA_MAX_CHARS = 8_000` para que Reviewer y humano vean **siempre** los mismos bytes, al costo de rechazar cualquier cambio de más de ~130 líneas de diff.
3. **ADR 57 — TTL de 2 h configurable por `HARNESS_WORKTREE_TTL_MS`.** Lo fijé con criterio (mayor que la delegación más larga plausible, menor que una jornada), pero es un parámetro operativo de tu máquina: si querés otro valor por defecto, decilo ahora y queda en el spec.
4. **R12 — la delta sobre `delegacion-subagentes`.** `v2.0.0` va a cerrar con un spec y un test que dicen *"ningún rol tiene herramientas de escritura"*. Este change los modifica. Es un **relajamiento explícito de una prohibición de seguridad** y tiene que aprobarse acá, no leerse como sorpresa en el review.
5. **Dos capabilities en vez de una.** §15 anticipaba `propuesta-cambio-hitl` sola; propongo separar `escritura-aislada-worktree`. Si preferís un solo spec, se colapsa sin cambiar ninguna decisión.
6. **R11 / estrategia de entrega.** Con ~930-1100 líneas estimadas, el presupuesto de 400 por PR se supera con margen: decidir **PRs encadenados** (corte sugerido: adaptador git → propuestas + tabla → tool de tests → comandos TUI) o uno solo con `size:exception`.
7. **Confirmación del gate de secuencia.** Que quede asentado que `sdd-apply` de este change **no arranca** hasta ver `hito-2.0` mergeado en `main` — no como buena intención, sino como condición verificable.

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (sólo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por las exploraciones y propuestas de Hito 3, Hito 4, `hito-2.0` y la exploración de este mismo change. Se compensó con lectura directa y verificación puntual de cada afirmación citada: `AGENTS.md` (líneas 17, 78, ciclo por hito), `hito-2.0/proposal.md` (ADR 42-47) y `hito-2.0/design.md` completo (ADR 48-56, §5.2 `allowedTools` por rol, §5.3 `TAREA_DELEGADA_MAX_CHARS = 8000`, §6.1-6.2 DDL, §9 tabla de testing, §12 RD-1 a RD-8, §15 líneas 832-848), `src/adapters/knowledge/graphify-cli.ts` (patrón `ExecFileFn`/`execFile`/`GraphifyCliError` completo), `src/adapters/knowledge/index.ts` y `knowledge-tool.ts` (molde de servidor MCP y contrato "nunca lanza"), `src/core/knowledge/knowledge-contract.ts` (`mcp__knowledge__query_knowledge_base`), `openspec/config.yaml` (`test_command`, `test_command_raw`, `integration: false`), `package.json` (`"test": "vitest run"`, `vitest ^4`, `node >=20`, sin librería de git), `.gitignore` (sin `.harness/`, con `node_modules/`), el catálogo completo de 22 archivos de spec de `openspec/changes/*/specs/` (verificación de colisión de nombres), y la existencia de `src/test/integration/` con dos archivos y de **ningún** `vitest.config.*`. Se recomienda que `sdd-design` corra `graphify explain` sobre `worktree-contract`, `propuestas_cambio` y `run_tests` una vez que `hito-2.0` esté aplicado y el grafo actualizado con `graphify update .`.

**Nota de formato**: la skill `sdd-propose` sugiere un tope de 450 palabras para el artefacto. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato completo del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto.
