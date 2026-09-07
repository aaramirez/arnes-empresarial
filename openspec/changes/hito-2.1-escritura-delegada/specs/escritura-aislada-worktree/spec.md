> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `propuesta-cambio-hitl/spec.md`. Este spec se apoya en `proposal.md` (ADR 57, 61), `exploration.md` de este change, y `src/adapters/knowledge/graphify-cli.ts` / `src/core/knowledge/knowledge-contract.ts` / `src/adapters/knowledge/knowledge-tool.ts` como molde de patrón real ya verificado (runner `execFile` inyectable, error tipado, servidor MCP que nunca lanza). No hay spec previa de esta capability — es un spec completo, no una delta. La propuesta la separó de `propuesta-cambio-hitl` porque tiene requirements que esa capability no puede reclamar (`cerrar` nunca rechaza, el barrido no tumba el arranque, la suite corre con el `cwd` del worktree) y se verifica con una categoría de test distinta (integración contra `git` real).

# Escritura Aislada en Worktree Specification

## Purpose

Capability nueva. Cubre ADR 57 y 61: el ciclo de vida del `git worktree` descartable que le da al Developer un lugar donde escribir código real sin tocar el checkout del humano, su contrato asimétrico (`abrir`/`capturarDiff` fallan ruidosamente, `cerrar`/`barrerHuerfanos` nunca rechazan), la captura del diff incluyendo archivos nuevos, el barrido de huérfanos al arranque, el invariante que ata las herramientas de escritura del Developer al `cwd` del worktree, y la tool MCP `mcp__worktree__run_tests` que le permite correr la suite sin `Bash`.

**Fuera de alcance de este spec**: la persistencia de la propuesta de cambio, su máquina de estados y los comandos TUI que la aplican/descartan — capability `propuesta-cambio-hitl`; **un sandbox de sistema operativo real** (contenedor, `chroot`, límites de proceso) — `options.cwd` es **anclaje de alcance**, no aislamiento de proceso; la garantía dura es la topología (worktree → confirmación humana → `git apply`), no el `cwd` en sí; `Bash` para el Developer, en cualquier variante, acotado o no — una shell evapora el anclaje con `cd ..`; varios worktrees concurrentes por caso o paralelismo entre casos; tools de `typecheck`, lint o formateo (una tool, un comando).

## Requirements

### Requirement: Ciclo `abrir → invocar Developer → capturarDiff → cerrar`, con contrato asimétrico

El sistema SHALL ejecutar el ciclo de vida del worktree en el orden `abrir → invocar Developer con ese `cwd` → capturarDiff`, con `cerrarWorktree` invocado en un `finally`. `abrir` y `capturarDiff` SHALL propagar su error (fallar ruidosamente) cuando no pueden completarse. `cerrar` y `barrerHuerfanos` SHALL NOT rechazar ni lanzar bajo ninguna circunstancia — SHALL degradar a un evento.

#### Scenario: `abrir` falla y el Developer nunca se invoca
- GIVEN `git worktree add` falla (por ejemplo, disco lleno o `git` no encontrado)
- WHEN se intenta abrir el worktree para un caso
- THEN el error se propaga sin capturarse
- AND el Developer no se invoca

#### Scenario: `capturarDiff` falla y el trabajo se reporta como perdido
- GIVEN el Developer completó su turno pero `git diff` falla dentro del worktree
- WHEN se intenta capturar el diff
- THEN el error se propaga sin capturarse, en vez de persistir una propuesta vacía o corrupta

#### Scenario: `cerrar` nunca rechaza, incluso si el worktree ya no existe
- GIVEN el worktree fue borrado externamente antes de llegar al `finally`
- WHEN `cerrarWorktree` se ejecuta
- THEN no lanza ni rechaza — emite el evento `worktree-cierre-fallido` y el flujo continúa

### Requirement: El worktree vive dentro del repo, no en un directorio temporal del sistema operativo

El sistema SHALL crear cada worktree en `.harness/worktrees/<casoId>-<uuid>/`, dentro del repositorio, sobre una rama `harness/caso-<casoId>-<uuid>` creada desde `HEAD`. El sistema SHALL NOT crear worktrees en `os.tmpdir()` ni en ninguna ruta fuera del repositorio, porque la resolución de módulos de Node necesita encontrar `<repo>/node_modules` subiendo por directorios padre para que la tool de tests (ver más abajo) funcione.

#### Scenario: La tool de tests resuelve `node_modules` del checkout principal
- GIVEN un worktree abierto en `.harness/worktrees/<casoId>-<uuid>/`
- WHEN `mcp__worktree__run_tests` intenta resolver el entrypoint de `vitest`
- THEN lo encuentra en `<repo>/node_modules`, sin necesidad de un `node_modules` propio del worktree

#### Scenario: La rama nunca recibe un commit
- GIVEN un worktree abierto sobre la rama `harness/caso-<casoId>-<uuid>`
- WHEN el ciclo completo (abrir → Developer → capturarDiff → cerrar) termina
- THEN esa rama no tiene ningún commit propio — es solo el ancla para no trabajar en `HEAD` detached

### Requirement: La captura del diff incluye archivos nuevos (untracked)

El sistema SHALL capturar el diff ejecutando `git add --intent-to-add --all` seguido de `git diff --binary --no-color --no-ext-diff`, ambos con `cwd` fijado al worktree (que tiene su propio índice, separado del checkout real). El sistema SHALL NOT depender únicamente de `git diff` sin el paso de `--intent-to-add`, porque `git diff` solo no muestra archivos untracked.

#### Scenario: Un archivo nuevo creado por el Developer aparece en el patch
- GIVEN el Developer creó un archivo que no existía antes en el worktree
- WHEN se captura el diff
- THEN el patch resultante incluye ese archivo como agregado, con su contenido completo

#### Scenario: `--intent-to-add` no altera el índice del checkout real
- GIVEN el worktree tiene su propio índice de git, separado del checkout principal
- WHEN se ejecuta `git add --intent-to-add --all` dentro del worktree
- THEN el índice del checkout real (donde trabaja el humano) permanece sin cambios

### Requirement: El adaptador expone funciones nombradas, nunca un `git(args)` genérico

El adaptador SHALL exponer únicamente funciones nombradas (`abrirWorktree`, `capturarDiff`, `cerrarWorktree`, `barrerHuerfanos`, `verificarPatch`, `aplicarPatch`), cada una construyendo su propio argv fijo. El sistema SHALL NOT exponer una función genérica que reciba subcomandos de `git` como parámetro. El runner subyacente SHALL usar `execFile` con argv en array — nunca `exec` ni `shell: true`.

#### Scenario: Ningún constructor de argv puede emitir `commit`, `push`, `remote` ni `tag`
- GIVEN el conjunto completo de funciones exportadas por el adaptador
- WHEN se inspeccionan sus argv construidos
- THEN ninguna puede producir `commit`, `push`, `remote` ni `tag` como subcomando de `git`, para ningún valor de entrada

#### Scenario: Un fallo de `git` no encontrado se clasifica, no se propaga crudo
- GIVEN `git` no está disponible en el `PATH`
- WHEN se invoca cualquier función del adaptador
- THEN el error resultante tiene `reason = "not-found"`, sin dejar fugar el error nativo de `execFile`

### Requirement: Barrido de huérfanos al arranque, con TTL configurable, no bloqueante

El sistema SHALL ejecutar, al arranque, un barrido que filtra worktrees por **ambas** condiciones (ruta bajo `.harness/worktrees/` y rama con prefijo `harness/caso-`) y borra los que superan un TTL medido sobre el mtime del directorio (default `7_200_000` ms / 2 horas, configurable por `HARNESS_WORKTREE_TTL_MS`). El barrido SHALL NOT bloquear el arranque del arnés ni interrumpirlo si falla.

#### Scenario: Un worktree viejo se borra al arrancar
- GIVEN un worktree bajo `.harness/worktrees/` con mtime anterior al TTL vigente
- WHEN el arnés arranca
- THEN ese worktree y su rama `harness/caso-*` se eliminan

#### Scenario: Un worktree reciente no se toca
- GIVEN un worktree bajo `.harness/worktrees/` con mtime dentro del TTL vigente
- WHEN el arnés arranca
- THEN ese worktree permanece intacto

#### Scenario: Un fallo de `git` durante el barrido no tumba el arranque
- GIVEN el barrido encuentra un error al ejecutar `git worktree prune`
- WHEN el arranque continúa
- THEN el arnés termina de arrancar igual, degradando el fallo a un evento `worktree-barrido-fallido`

### Requirement: Las tools de escritura y el `cwd` del worktree se entregan en el mismo acto, o no se entregan

El sistema SHALL construir la variante de escritura del Developer (`allowedTools` con `Write`, `Edit` y `mcp__worktree__run_tests` agregados) exclusivamente junto con la ruta del worktree como `cwd`, mediante un único constructor. El sistema SHALL NOT exponer ninguna vía de código que otorgue `Write`/`Edit` al Developer sin ese `cwd` acompañándolo.

#### Scenario: No existe una construcción de Developer con escritura sin worktree
- GIVEN el conjunto de funciones que construyen la configuración de invocación del Developer
- WHEN se inspeccionan sus firmas
- THEN ninguna puede producir `allowedTools` con `Write`/`Edit` sin también fijar un `cwd` de worktree

#### Scenario: Con el interruptor apagado, el Developer no gana escritura ni `cwd`
- GIVEN `HARNESS_ESCRITURA_DELEGADA=off`
- WHEN el composition root invoca al Developer
- THEN se usa la definición read-only (`Read`, `Glob`, `Grep`), sin `Write`, `Edit`, `mcp__worktree__run_tests` ni `cwd` de worktree

### Requirement: Tool MCP `mcp__worktree__run_tests`, sin parámetros, corre la suite completa fijada al `cwd` del worktree

El sistema SHALL exponer la tool `mcp__worktree__run_tests`, sin parámetros de entrada, que ejecuta la suite completa vía `execFile(process.execPath, [<entrypoint de vitest>, "run", "--reporter=basic"], { cwd: <worktree>, timeout })`. El sistema SHALL NOT invocar `npm`, `Bash` ni ningún intérprete de shell para correr la suite.

#### Scenario: La suite corre dentro del worktree y devuelve resultado real
- GIVEN el Developer invoca `mcp__worktree__run_tests` tras editar un archivo
- WHEN la tool corre
- THEN ejecuta la suite completa dentro del `cwd` del worktree y devuelve `exitCode`, duración y salida real de `vitest run`

#### Scenario: La tool no acepta filtrar por archivo o patrón
- GIVEN el Developer intenta invocar la tool con cualquier argumento
- WHEN la tool procesa la invocación
- THEN corre la suite completa igual, ignorando cualquier intento de acotar el alcance

### Requirement: Salida de la tool truncada a `TEST_OUTPUT_MAX_CHARS`, conservando la cola

El sistema SHALL truncar la salida de `vitest run` a `TEST_OUTPUT_MAX_CHARS` (8 000) conservando el **final** de la salida, anteponiendo un marcador de truncado. El sistema SHALL devolver siempre `exitCode` y duración, truncada la salida o no.

#### Scenario: Salida larga conserva el resumen de fallas al final
- GIVEN `vitest run` produce una salida de más de 8 000 caracteres con el resumen de fallas al final
- WHEN la tool trunca la salida
- THEN el texto devuelto conserva ese resumen final, antecedido por el marcador de truncado, y descarta el inicio

#### Scenario: Salida corta se devuelve intacta
- GIVEN `vitest run` produce una salida de menos de 8 000 caracteres
- WHEN la tool procesa la salida
- THEN se devuelve completa, sin marcador de truncado

### Requirement: El handler de la tool nunca lanza

El sistema SHALL capturar toda falla al intentar correr la suite (binario no encontrado, timeout excedido, worktree inexistente) y devolver texto degradado explícito en vez de lanzar o rechazar hacia el SDK.

#### Scenario: `vitest` no se encuentra
- GIVEN el entrypoint de `vitest` no existe en `node_modules`
- WHEN se invoca la tool
- THEN el handler devuelve un texto que dice explícitamente que los tests no se pudieron correr y el motivo, sin lanzar una excepción

#### Scenario: Timeout excedido se reporta como texto, no como rechazo
- GIVEN la suite excede `HARNESS_WORKTREE_TEST_TIMEOUT_MS`
- WHEN el proceso se corta por timeout
- THEN el handler devuelve texto degradado indicando el timeout, sin que la invocación de la tool rechace

### Requirement: El worktree no es descubierto por la suite de tests del checkout principal

El sistema SHALL excluir `.harness/**` del descubrimiento de tests del checkout principal, de forma que abrir o cerrar un worktree no altere el conteo de archivos o tests que reporta la suite del humano.

#### Scenario: Un worktree abierto no infla el conteo de tests del checkout principal
- GIVEN un worktree abierto bajo `.harness/worktrees/`
- WHEN se corre la suite de tests del checkout principal
- THEN el conteo de archivos y tests descubiertos es el mismo que con ningún worktree abierto

#### Scenario: `.harness/` no se commitea por accidente
- GIVEN un worktree fue creado y luego cerrado
- WHEN se inspecciona el estado de git del checkout principal
- THEN `.harness/` no aparece como contenido rastreable
