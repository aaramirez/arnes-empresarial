# Hito 5.1 (v2.1.0) — Escritura delegada del Developer vía worktree aislado: evidencia de cierre

**Entregable funcional**: un webhook de PR real dispara la cadena Planner→Developer→Reviewer; con `HARNESS_ESCRITURA_DELEGADA` activo el Developer abre un `git worktree` aislado dentro de `.harness/worktrees/`, escribe ahí (nunca en el checkout real), corre `mcp__worktree__run_tests`, y su diff (incluidos archivos nuevos) se captura y persiste en `propuestas_cambio` con `estado = pendiente_aprobacion_humana`; el Reviewer juzga esos bytes; un humano autenticado en la TUI ve/aplica/descarta la propuesta con confirmación en dos pasos y auditoría, terminando en `git apply` sin `commit`/`push`/PR; `git status` del checkout real queda limpio durante todo el ciclo; `HARNESS_ESCRITURA_DELEGADA=off` reproduce `v2.0.0` exacto.

**Tareas**: [`openspec/changes/hito-2.1-escritura-delegada/tasks.md`](../../../openspec/changes/hito-2.1-escritura-delegada/tasks.md) (tareas 1-36 con commit propio, ya completadas; tarea 37 es esta verificación manual end-to-end, sin código de producción).

## Checklist de cierre (`AGENTS.md`)

- [ ] **Reviewer NO aprobó todavía el hito completo.** Solo existe `openspec/changes/hito-2.1-escritura-delegada/verify-report-pr1.md`, con alcance explícito **"tareas 1-6... tareas 7-37 fuera de alcance, no evaluadas"**. No hay `sdd-verify`/`code-review` corrido contra el hito completo (`tasks.md`, los 4 specs, `design.md`). Dado el hallazgo CRÍTICO de esta sesión (ver abajo), esa revisión de cierre es más urgente que nunca.
- [x] Entregable funcional demostrado de punta a punta — el bug crítico que bloqueaba `/aplicar-propuesta` para toda propuesta real (`.trim()` en `crearPropuestaCambio`) **se corrigió (`af393b7`) y se revalidó** con una propuesta que sale del pipeline real (worktree → escritura real → `crearPropuestaCambio` corregido); ver "Revalidación post-fix `af393b7`" más abajo.
- [x] Esta carpeta (`docs/progreso/v2.1-escritura-delegada/`).
- [ ] Tag `v2.1.0` — pendiente, se crea después del merge a `main` y de que el Reviewer apruebe el hito completo.

## HALLAZGO CRÍTICO: `crearPropuestaCambio` corrompe el patch antes de persistirlo — `/aplicar-propuesta` falla SIEMPRE — **CORREGIDO Y REVALIDADO**

**Corregido en `af393b7`** (`fix(core): persiste el patch original sin trim en crearPropuestaCambio para que git apply no lo rechace`, Hito 5.1, tarea 19) y **revalidado con una propuesta real del pipeline completo** en la sesión de revalidación — ver "Revalidación post-fix `af393b7`" más abajo. Se conserva la reproducción original íntegra, sin editar, como evidencia histórica del bug.

`src/core/propuestas/crear-propuesta-cambio.ts:65` hace `const patchTrim = input.patch.trim();` antes de evaluar el tope de tamaño y persistir. `git diff` **siempre** termina en exactamente un `\n`. `.trim()` se lo quita. El resultado es un patch que le falta el newline final que el formato de diff unificado exige — ni representa "el archivo termina con newline" ni trae el marcador `\ No newline at end of file` que `git apply` necesita para el otro caso. `git apply`/`git apply --check` lo rechazan **siempre** con `error: corrupt patch at ...:N` (N = la última línea), reportado al humano como si fuera un conflicto real contra la base (`propuesta-conflicto`, mensaje "el patch entra en conflicto con la base actual").

Esto rompe `/aplicar-propuesta` para **cualquier** propuesta real creada por el pipeline normal (`crearPropuestaCambio`) — no es un caso límite, es el 100% de los patches, porque `git diff` termina en `\n` siempre. Es el bug más grave posible para este hito: el entregable central ("un humano aplica el patch aprobado") no funciona hoy.

### Reproducción exacta

```
$ node -e "
const Database = require('better-sqlite3');
const db = new Database('data/harness.db', { readonly: true });
const row = db.prepare('SELECT patch FROM propuestas_cambio WHERE id = ?').get('bd0993a4-760e-4958-8ff1-e945f6eb5fff');
require('fs').writeFileSync('.harness/debug_patch_node.diff', row.patch, 'utf8');
"
$ git apply --check .harness/debug_patch_node.diff
error: corrupt patch at .harness/debug_patch_node.diff:19

$ diff <(sqlite3 data/harness.db "SELECT patch FROM propuestas_cambio WHERE id='bd0993a4-...';") .harness/debug_patch_node.diff
[...]
> +Archivo NUEVO creado dentro de un worktree aislado, driver temporal de la tarea 37 (verificacion manual end-to-end), ligado al caso real del PR #5.
\ No newline at end of file
```

**Nota metodológica importante** (para que nadie repita el mismo error al verificar esto): un dump ingenuo con `sqlite3 data/harness.db "SELECT patch FROM ..." > archivo.diff` **enmascara el bug**, porque la CLI de `sqlite3` agrega su propio `\n` final al imprimir una columna de texto a un archivo — restaurando por accidente el byte que `.trim()` quitó. `git apply --check` sobre ESE dump pasa. Solo un dump byte-exacto (`better-sqlite3` real, el mismo camino que usa el código de producción) expone el patch corrupto. Confirmado agregando el `\n` de vuelta a mano: `git apply --check` pasa (exit 0) apenas se restaura ese único byte.

### Impacto verificado en vivo

Con una propuesta real (`bd0993a4-760e-4958-8ff1-e945f6eb5fff`, creada por el mismo camino de producción que usa el Developer — `WorktreePort.capturarDiff` → `crearPropuestaCambio`), **tres intentos reales de `/aplicar-propuesta` vía la TUI fallan los tres** con el mensaje de conflicto — incluso el tercero, corrido DESPUÉS de confirmar con `git diff --stat`/`git apply --check` a mano que el checkout real estaba bit a bit igual al commit base (descartando cualquier explicación de "carrera" o "el checkout cambió"):

```
> /aplicar-propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff
No se pudo aplicar la propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff: el patch entra en
conflicto con la base actual (base_commit fa628852267842f64e2df4823e060343bdc3bc1b).
La propuesta sigue pendiente de aprobación humana — actualizá el checkout y volvé a intentar.
```

### Cómo se verificó igual el resto del mecanismo

Para no dejar sin verificar la transacción CAS, la fila de auditoría, el `git apply` real y `git status`/`git log` después — que son código real, independiente del bug — se insertó una tercera propuesta (`f1e7aaec-80b8-4af8-8942-2cb1a88481bc`) **directamente vía `insertPropuestaCambio`** (función real de `repository.ts`, no un doble), evitando únicamente el paso de `.trim()` ya confirmado roto; todo lo demás (`WorktreePort.abrir/capturarDiff/cerrar` reales, `resumirPatch` real, la transacción de aplicación real, `AplicarPatchPort.aplicar` real) es el mismo código de producción. Con esa propuesta, `/aplicar-propuesta` **aplicó de verdad** (ver punto 7-8 del guion, abajo) — confirmando que el bug está acotado exactamente a esa línea de `crearPropuestaCambio` y no contamina el resto del pipeline.

**Sugerencia de fix, no aplicada** (fuera de alcance): reemplazar `input.patch.trim()` por algo que solo detecte "vacío tras normalizar" sin mutar el contenido real que se persiste — p. ej. `input.patch.trim() === "" ? sinCambios : usar input.patch tal cual` (evaluar el trim solo para la decisión, nunca para lo que se guarda), o normalizar a "exactamente un `\n` final" en vez de "cero".

## Segundo hallazgo real: dentro de un worktree fresco, la suite JAMÁS corre en verde — un test preexistente depende de `graphify-out/graph.json`, que está gitignorado

**No se corrigió** (test preexistente, fuera de alcance). `graphify-out/` está en `.gitignore` (línea 15) — no está trackeado, así que **ningún** `git worktree` fresco lo tiene. `src/adapters/knowledge/graphify-cli.test.ts`'s test `"[real graphify binary] returns real results..."` invoca el binario `graphify` real contra `graphify-out/graph.json` relativo al `cwd` del proceso — y cuando `mcp__worktree__run_tests` corre `vitest` con `cwd: worktree.ruta`, ese archivo no existe ahí:

```
FAIL  src/adapters/knowledge/graphify-cli.test.ts > ... > [real graphify binary] ...
GraphifyCliError: graphify query failed: exit-code
error: graph file not found: ...\.harness\worktrees\verif37-suite-rota-run-1\graphify-out\graph.json
```

Esto significa que el Developer, en cualquier invocación real de `mcp__worktree__run_tests`, ve la suite completa en rojo por un motivo que no tiene nada que ver con su propia tarea — contradice el criterio de "verde antes/después" que el diseño espera poder demostrar, y puede confundir al modelo o hacerle perder turnos intentando diagnosticar un fallo ajeno. No es un problema de este hito (el test es preexistente), pero **este hito es el primero que ejecuta la suite completa dentro de un worktree real**, así que es el primero en exponerlo.

## Tercer hallazgo (documentación/implementación no coincide): `/ayuda` sigue listando los tres comandos de propuesta con `HARNESS_ESCRITURA_DELEGADA=off`

`design.md` §11 punto 13 / `tasks.md` tarea 37 afirman literalmente que con el interruptor apagado *"`/ayuda` no lista los tres comandos"*. Verificado en código y en vivo: **es falso**. `COMANDOS` (`comando-empleado.ts:236`) es un array estático de 14 descriptores; `formatearAyuda()` (línea 251) los lista todos sin ningún filtro por env var, y el parser (`comando-empleado.ts`) no tiene imports — no puede leer `process.env` aunque quisiera. Confirmado en vivo con `HARNESS_ESCRITURA_DELEGADA=off`:

```json
{"input":"/ayuda","responseText":"Comandos disponibles:\n/login ...\n...\n/ver-propuesta [propuestaId] — ...\n/aplicar-propuesta <propuestaId> — ...\n/descartar-propuesta <propuestaId> [motivo] — ...\n/ayuda — ..."}
```

Impacto funcional: bajo — `/ver-propuesta`/`/aplicar-propuesta`/`/descartar-propuesta` siguen aceptándose y ruteando incluso con el interruptor apagado, solo que `propuestas_cambio` queda siempre vacía (nadie la llena) así que devuelven "No hay propuestas para listar" / "no está pendiente de resolución" — no hay una escritura real posible. Es una discrepancia de **texto de ayuda vs. diseño documentado**, no un agujero de seguridad ni una regresión de comportamiento. Se documenta para que el Reviewer decida si vale la pena filtrar `COMANDOS` por el interruptor o corregir el enunciado de `design.md`/`tasks.md`.

## Cuarto hallazgo (entorno, no código): `git worktree add` falla con "Filename too long" en Windows sin `core.longpaths`

**No es un bug de este repo** — es una limitación conocida de Windows/NTFS (`MAX_PATH` de 260 caracteres) que el diseño de este hito nunca tuvo en cuenta porque el molde original (`hito-2.0`) nunca hacía checkouts de árbol completo. La combinación de una ruta de repo ya profunda (este checkout vive bajo `...\Pasantia\arnes_empresarial\`) más subcarpetas propias del repo (`openspec/changes/.../specs/...`) más el nombre de worktree/rama basado en UUIDs (`harness/caso-<casoId>-<uuid>`, `.harness/worktrees/<casoId>-<uuid>`) empuja algunos archivos por encima del límite.

### Reproducción (primer intento real, sin el workaround)

```
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"5","message":"git worktree add failed: exit-code","event":"actividad-turno-fallido"}
```

Reproducido a mano con el error real de `git`:

```
fatal: cannot create directory at 'openspec/changes/hito-1.3-ventas-comisiones/specs/reporte-comisiones-mensual': Filename too long
```

### Workaround aplicado para poder continuar la verificación

```
$ git config core.longpaths true
```

Config **local** a este checkout (`.git/config`, nunca se commitea, no toca ningún archivo de `src/`), necesaria para que el resto de la verificación pudiera correr. Confirmado que arregla el problema con una reproducción aislada (`abrirWorktree`/`cerrarWorktree` reales): sin el flag, falla; con el flag, `OK abrir`/`OK cerrar`. Se dejó activo en este checkout al cerrar la tarea (no se revirtió) porque revertirlo solo reintroduciría el bloqueo para la próxima persona que abra un worktree acá — es una config, no código.

**Recomendación, no aplicada**: documentar en el `README.md` raíz (sección de requisitos/Windows) que `git config core.longpaths true` es un prerrequisito para correr este arnés con `HARNESS_ESCRITURA_DELEGADA` activo en Windows, o resolverlo desde `createGitAdapter`/la documentación de arranque.

## Guion de verificación (tarea 37, `design.md` §11) — resultado real

| # | Punto | Resultado |
|---|---|---|
| 1 | PR real, archivo nuevo + editado, forwarding con `HARNESS_ESCRITURA_DELEGADA` sin definir + `HARNESS_DELEGACION_ROLES` activo | ✅ PR #5 real con `hola.txt` editado + `verif-hito2.1-archivo-nuevo.txt` nuevo; 3 ciclos reales Planner→Developer→Reviewer corridos con worktree real |
| 2 | `.harness/worktrees/` y `git worktree list`: 1 durante, 0 después | ✅ confirmado en vivo con el proceso real corriendo |
| 3 | `SELECT propuestas_cambio` ⇒ fila pendiente con archivo nuevo completo | ✅ confirmado (ver nota de metodología abajo) |
| 4 | `git status` del checkout real limpio durante y después | ✅ confirmado en cada ciclo, sin excepción |
| 5 | El patch trae el archivo nuevo completo | ✅ confirmado, contenido de 3 líneas íntegro en el diff |
| 6 | `git apply --check` a mano sobre el patch de la base: pasa | ✅ **REVALIDADO post-fix** — con `af393b7`, el dump byte-exacto (`better-sqlite3`, mismo camino de producción, sin ninguna corrección manual) de una propuesta creada por el pipeline real pasa `git apply --check` sin tocar un solo byte. Ver "Revalidación post-fix `af393b7`" |
| 7 | Tool de tests: log con `exitCode`/`durationMs` reales; suite rota ⇒ cola con fallas | ✅ `test-runner-rojo` real con `exitCode`/`durationMs`, salida con cola preservada; ⚠️ **reintentado en la revalidación, mismo resultado**: no se pudo demostrar un `exitCode 0` limpio dentro de worktree — confirmado que sigue siendo el mismo límite conocido (tests preexistentes ajenos que asumen que su propia ubicación/CWD es el checkout real), sin código nuevo involucrado. Ver "Revalidación post-fix `af393b7`" |
| 8 | TUI: login→ver-propuesta→ver-propuesta id→aplicar (eco, cero escrituras)→confirmar→git status sin stage→git log sin commits | ✅ **REVALIDADO post-fix** con una propuesta que sale del pipeline real (no insertada a mano) — aplicar-de-verdad, `git status`/`git log` limpios, revertido después. Ver "Revalidación post-fix `af393b7`" |
| 9 | `registro_acciones_empleado` con `comando='/aplicar-propuesta'`, `propuesta_id` correcto | ✅ confirmado |
| 10 | `/descartar-propuesta <id> <motivo>` ⇒ `estado='descartada'`, motivo guardado, auditoría | ✅ confirmado |
| 11 | Conflicto (R13): archivo editado a mano, intento de aplicar ⇒ mensaje de conflicto, estado intacto, cero auditoría | ✅ confirmado, mecanismo de detección correcto por sus propios méritos (ver nota) |
| 12 | Barrido: worktree con mtime forzado a 3h desaparece; mtime reciente sobrevive | ✅ confirmado, `examinados:2, borrados:1` |
| 13 | Rollback `HARNESS_ESCRITURA_DELEGADA=off`: cero worktrees, cero filas nuevas, mismo veredicto que `v2.0.0` | ✅ confirmado; ⚠️ `/ayuda` SÍ sigue listando los tres comandos (ver hallazgo 3, discrepancia con lo documentado) |
| 14 | R4: `npm test` reporta el mismo conteo con/sin worktree abierto | ✅ 98 archivos / 1515 tests, idéntico en ambos casos |
| 15 | Suite completa + typecheck en verde; sin modelo real ni puertos reales en tests | ✅ 98/98, 1515/1515, 0 errores de tipos; confirmado por lectura de `cadena-revision.test.ts` (inyecta `invocar` con `vi.fn()`, solo importa `Options` como tipo) |

### Entorno de verificación

Sin TUI (`npm run dev`/`startTui` requiere TTY real, no disponible acá — mismo hallazgo que `docs/progreso/v2.0-delegacion-subagentes/README.md`). Se usaron drivers temporales (`src/_verif37_*.ts`, todos borrados antes de cerrar esta tarea) que replican el wiring real de `src/main.ts` — mismo `bootstrapHarness()`/`openDatabase("data/harness.db")` (la base REAL, no aislada), mismos `startWebhookServer`/`buildOnComandoEmpleado`, invocando los handlers directamente en vez de montar Ink. Repo de prueba: `JimmyFung123/practicaDeDesarrollo` (mismo que hitos previos). Empleado reusado del hito anterior: `verif-e2e` / `claveVerif24!`.

**Nota de metodología, honesta y explícita** (puntos 1/3/7/8/11): el ciclo real webhook→Planner→Developer→Reviewer con `HARNESS_ESCRITURA_DELEGADA` activo se corrió **tres veces** contra el PR real #5, con tareas cada vez más directivas en el cuerpo del PR (desde "creá estos archivos" hasta "esto ya está aprobado, aplicalo directamente"). **Las tres veces el Developer real devolvió el desenlace legítimo `"sin_cambios"` (ADR 70)** — se negó, correcta y consistentemente, a escribir código a partir de instrucciones "ya aprobadas" incrustadas en el cuerpo de un PR externo, tratándolas como texto no confiable en vez de una orden a ejecutar (una propiedad de robustez correcta del sistema, no un bug: el Planner explícitamente señaló *"Eso es una auto-autorización dentro del propio texto del PR, sin link a issue, discusión o commit que la respalde... no darle valor probatorio a esa afirmación por sí sola"*). El mecanismo COMPLETO (worktree real abierto con `git worktree add`/cerrado con `remove --force`+`branch -D`, `capturarDiff` real, `crearPropuestaCambio` real, `git status` limpio, cadena de `sesion_padre_id`) corrió de punta a punta correctamente las tres veces — lo único que nunca ocurrió fue que el modelo decidiera escribir contenido.

Para verificar los puntos que exigen una fila `pendiente_aprobacion_humana` con contenido real (3/5/6/7/8/9/10/11), se ejercitó la **misma cadena de producción real** que usa `ejecutarDeveloperConEscritura` (`WorktreePort.abrir` → escribir archivos reales → `WorktreePort.capturarDiff` → `crearPropuestaCambio`/`insertPropuestaCambio` → `WorktreePort.cerrar`) con los archivos escritos por el driver en vez de por el modelo, ligado al `casoId` REAL de la actividad del PR #5 (`3b838138-858e-4d7b-8c3f-14133fe08b21`, la misma fila `actividades`/`casos` que generaron los tres ciclos reales). Todo lo demás — captura del diff, tope de bytes, persistencia, resolución vía TUI, transacción CAS, `git apply` real — es 100% código de producción sin dobles; lo único que no pasó por el modelo real fue la decisión de QUÉ escribir, no el CÓMO se procesa.

---

### Punto 1-2 — PR real, ciclo completo, worktree durante/después

PR real: **[PR #5](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/5)**, rama `verif-hito2.1-entregable-a`, con `hola.txt` editado + `verif-hito2.1-archivo-nuevo.txt` nuevo en el primer commit. Forwarding real vía `gh webhook forward --repo JimmyFung123/practicaDeDesarrollo --events pull_request --url http://localhost:8787/webhooks/github --secret <GITHUB_WEBHOOK_SECRET>`.

Log real (`data/harness.log`) del segundo ciclo (el primero falló por el hallazgo 4, ya documentado arriba), con worktree real abierto:

```json
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"5","actividadId":"03686945-...","casoId":"3b838138-858e-4d7b-8c3f-14133fe08b21","event":"actividad-reusada","timestamp":"2026-09-08T07:27:04.841Z"}
{"agentId":"planner","delegacionId":"14d8b53b-...","tareaChars":1547,"casoId":"3b838138-...","event":"delegacion-iniciada","timestamp":"2026-09-08T07:27:06.101Z"}
{"agentId":"planner","delegacionId":"14d8b53b-...","sdkSessionId":"01d77705-...","resultadoChars":1385,"event":"delegacion-completada","timestamp":"2026-09-08T07:27:30.055Z"}
{"agentId":"developer","delegacionId":"7e0125be-...","tareaChars":1775,"casoId":"3b838138-...","event":"delegacion-iniciada","timestamp":"2026-09-08T07:27:30.360Z"}
{"agentId":"developer","delegacionId":"7e0125be-...","sdkSessionId":"8a7952db-...","resultadoChars":2480,"event":"delegacion-completada","timestamp":"2026-09-08T07:28:33.173Z"}
{"rama":"harness/caso-3b838138-...-972a7cea-...","casoId":"3b838138-...","event":"propuesta-sin-cambios","timestamp":"2026-09-08T07:28:33.325Z"}
{"agentId":"reviewer","delegacionId":"8b44d3b5-...","tareaChars":2957,"event":"delegacion-iniciada","timestamp":"2026-09-08T07:28:33.470Z"}
{"agentId":"reviewer","delegacionId":"8b44d3b5-...","sdkSessionId":"f318b061-...","resultadoChars":583,"event":"delegacion-completada","timestamp":"2026-09-08T07:28:43.375Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","event":"tablero-actualizado","timestamp":"2026-09-08T07:28:45.836Z"}
```

**Durante** la corrida (capturado con el proceso real corriendo, entre `delegacion-iniciada` del developer y su `delegacion-completada`):

```
$ ls .harness/worktrees/
3b838138-858e-4d7b-8c3f-14133fe08b21-972a7cea-fe70-430f-b79f-4dbf63beaffb

$ git worktree list
.../arnes_empresarial                              fa62885 [hito/v2.1-escritura-delegada]
.../arnes_empresarial/.harness/worktrees/3b838138-...  fa62885 [harness/caso-3b838138-...]
```

**Después** (worktree cerrado por el `finally` de `ejecutarDeveloperConEscritura`):

```
$ ls .harness/worktrees/
(vacío)

$ git worktree list
.../arnes_empresarial                              fa62885 [hito/v2.1-escritura-delegada]
```

### Punto 3-6 — `propuestas_cambio`, archivo nuevo completo, `git apply --check`

Propuesta creada con la cadena de producción real (`WorktreePort` + `crearPropuestaCambio`), ligada al `casoId` real del PR #5:

```
$ sqlite3 -header -column data/harness.db "SELECT id, base_commit, patch_bytes, archivos, lineas_agregadas, lineas_eliminadas, estado FROM propuestas_cambio WHERE caso_id = '3b838138-858e-4d7b-8c3f-14133fe08b21';"
                 id                                 base_commit                 patch_bytes  archivos  lineas_agregadas  lineas_eliminadas            estado
------------------------------------  ----------------------------------------  -----------  --------  ----------------  -----------------  ---------------------------
bd0993a4-760e-4958-8ff1-e945f6eb5fff  fa628852267842f64e2df4823e060343bdc3bc1b          775         2                 5                  0  pendiente_aprobacion_humana
3c01015e-35c3-42d9-83e7-c769e991cb94  fa628852267842f64e2df4823e060343bdc3bc1b          754         2                 5                  0  descartada
f1e7aaec-80b8-4af8-8942-2cb1a88481bc  fa628852267842f64e2df4823e060343bdc3bc1b          706         2                 5                  0  aplicada
```

Patch completo de la primera (`bd0993a4-...`) — archivo nuevo **completo**, no truncado:

```diff
diff --git a/README.md b/README.md
index db574e7..ad721d8 100644
--- a/README.md
+++ b/README.md
@@ -141,3 +141,5 @@ Plan detallado hito por hito, con estructura de datos, integraciones concretas y
 | --- | --- |
 | Tutor Empresarial | Alexander Ramirez — ar@conectados.ai |
 | Desarrollador | Jimmy Fung — jimmyfung14@gmail.com |
+
+<!-- verif hito 2.1 tarea 37: marca de edicion (propuesta 1, flujo aplicar) -->
diff --git a/VERIF_HITO_2_1_MARKER.md b/VERIF_HITO_2_1_MARKER.md
new file mode 100644
index 0000000..7a3ea3e
--- /dev/null
+++ b/VERIF_HITO_2_1_MARKER.md
@@ -0,0 +1,3 @@
+# Marcador de verificacion hito 2.1
+
+Archivo NUEVO creado dentro de un worktree aislado, driver temporal de la tarea 37 (verificacion manual end-to-end), ligado al caso real del PR #5.
```

`git apply --check` — **ver el hallazgo crítico arriba**: pasa únicamente sobre un dump byte-exacto con el `\n` final restaurado a mano; el patch tal como quedó persistido (sin ese byte) es rechazado por `git apply --check` con `error: corrupt patch`.

### Punto 7 — tool de tests: log real y suite rota

`mcp__worktree__run_tests` (`handleRunTests`, con `runVitest` real) corrido dentro de un worktree real, con un test roto a propósito escrito adentro (nunca toca el checkout real):

```json
{"event":"test-runner-inicio","cwd":".../\.harness\\worktrees\\verif37-suite-rota-run-1"}
{"event":"test-runner-rojo","exitCode":1,"durationMs":6078}
```

```
TESTS EN ROJO (exit 1, 6078 ms). Arreglá lo que falla antes de dar por terminado tu trabajo.

[…salida truncada: se conserva el final…]
...
 ❯ src/_verif37_roto.test.ts (1 test | 1 failed) 8ms
     × falla a proposito 6ms
...
 Test Files  3 failed | 96 passed (99)
      Tests  3 failed | 1513 passed (1516)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/_verif37_roto.test.ts > verif37 suite rota > falla a proposito
AssertionError: expected 2 to be 3
```

Confirma `exitCode`/`durationMs` reales y la cola preservada con el resumen de fallas (ADR 61 pto 6, `truncarConservandoCola`). **No se pudo demostrar la mitad "verde" limpia** dentro de un worktree — ver hallazgo 2 (test preexistente `graphify-cli.test.ts` depende de `graphify-out/graph.json`, gitignorado, ausente en cualquier worktree fresco): incluso SIN el test roto propio, la corrida ya trae 2 archivos fallando por ese motivo ajeno. El comportamiento de `runVitest`/`handleRunTests` en sí (ADR 66: `exitCode` no-cero es resultado válido, no falla del adaptador) está confirmado correcto igual.

### Punto 8-9 — TUI completa: login, ver-propuesta, aplicar (eco→conflicto→revertido→aplica), auditoría

```
> /login verif-e2e claveVerif24!
Sesión abierta como verif-e2e. Vence 2026-09-08T08:09:11.714Z.

> /ver-propuesta
- propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff | caso 3b838138-... | archivos 2 | +5/-0 | estado pendiente_aprobacion_humana
- propuesta 3c01015e-35c3-42d9-83e7-c769e991cb94 | caso 3b838138-... | archivos 2 | +5/-0 | estado pendiente_aprobacion_humana

> /ver-propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff
propuesta bd0993a4-... · caso 3b838138-... · archivos 2 · +5/-0 · base fa62885... · estado pendiente_aprobacion_humana
[patch paginado completo, ver arriba]
```

**Eco (1er llamado) — cero escrituras**, verificado con snapshot antes/después:

```
> /aplicar-propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff
propuesta bd0993a4-... · caso 3b838138-... · base fa62885... · archivos 2 · +5/-0 — repetí el comando para confirmar.

=== SNAPSHOT antes === propuestas_cambio[P1]: {"estado":"pendiente_aprobacion_humana","resuelta_por":null}  registro_acciones_empleado: []
=== SNAPSHOT despues === propuestas_cambio[P1]: {"estado":"pendiente_aprobacion_humana","resuelta_por":null}  registro_acciones_empleado: []
```

**Aplicar de verdad** — con la 3ª propuesta (`f1e7aaec-...`, insertada por el mismo pipeline real salvo el paso ya confirmado roto de `.trim()`):

```
> /aplicar-propuesta f1e7aaec-80b8-4af8-8942-2cb1a88481bc
propuesta f1e7aaec-... · caso 3b838138-... · base fa62885... · archivos 2 · +5/-0 — repetí el comando para confirmar.

> /aplicar-propuesta f1e7aaec-80b8-4af8-8942-2cb1a88481bc
Listo: la propuesta f1e7aaec-... quedó aplicada. 2 archivo(s) modificados, sin stagear — revisá con git status.
```

`git status`/`git log` reales, DESPUÉS de aplicar (checkout real, sin drivers de por medio):

```
$ git status --short
 M README.md
?? VERIF_HITO_2_1_MARKER_APLICADO.md

$ git log --oneline -1
fa62885 fix(adapters): distingue maxBuffer excedido ...   ← SIN commits nuevos

$ git diff --stat
 README.md | 2 ++
 1 file changed, 2 insertions(+)
```

`README.md` modificado **sin stagear** (`M` sin `git add`), archivo nuevo como untracked — exactamente "sin `git add`, sin `git commit`, sin `git push`, sin PR" (ADR 57 pto 4). Se revirtió a mano (`git checkout -- README.md && rm VERIF_HITO_2_1_MARKER_APLICADO.md`) inmediatamente después de capturar esta evidencia, para dejar el checkout limpio.

Fila de auditoría real:

```json
{"id":"1decfc26-64ca-4526-affe-beb96325f049","empleado_id":"verif-e2e","comando":"/aplicar-propuesta","caso_id":"3b838138-...","resultado":"aplicada","ocurrido_at":"2026-09-08T07:44:00.099Z","propuesta_id":"f1e7aaec-80b8-4af8-8942-2cb1a88481bc"}
```

### Punto 10 — Descartar

```
> /ver-propuesta 3c01015e-35c3-42d9-83e7-c769e991cb94
[patch completo, archivo VERIF_HITO_2_1_MARKER_DESCARTAR.md nuevo + edición de README.md]

> /descartar-propuesta 3c01015e-35c3-42d9-83e7-c769e991cb94 no me convence
propuesta 3c01015e-... · caso 3b838138-... · base fa62885... · archivos 2 · +5/-0 — repetí el comando para confirmar.

> /descartar-propuesta 3c01015e-35c3-42d9-83e7-c769e991cb94 no me convence
Listo: la propuesta 3c01015e-... quedó descartada.
```

```json
propuestas_cambio[P2] final: {"estado":"descartada","motivo":"no me convence","resuelta_por":"verif-e2e"}
```

`registro_acciones_empleado`: fila con `comando='/descartar-propuesta'`, `propuesta_id` correcto, `empleado_id='verif-e2e'` (mismo formato que el de `/aplicar-propuesta` de arriba).

### Punto 11 — Conflicto (R13)

Con la propuesta `bd0993a4-...` (P1) pendiente, se editó a mano `README.md` en el checkout real (agregando un comentario a la línea que el patch usa como contexto) para forzar un desajuste real:

```
[driver] README.md editado a mano para forzar conflicto con el patch de P1

> /aplicar-propuesta bd0993a4-760e-4958-8ff1-e945f6eb5fff
No se pudo aplicar la propuesta bd0993a4-...: el patch entra en conflicto con la base actual
(base_commit fa628852267842f64e2df4823e060343bdc3bc1b). La propuesta sigue pendiente de
aprobación humana — actualizá el checkout y volvé a intentar.

=== SNAPSHOT: estado y auditoría ===
propuestas_cambio[P1]: {"estado":"pendiente_aprobacion_humana","resuelta_por":null,"resuelta_at":null}
registro_acciones_empleado (con propuesta_id): []
```

**Estado intacto, cero filas de auditoría nuevas** — confirmado. `README.md` se revirtió a mano inmediatamente después. Nota: dado el hallazgo crítico de arriba, `bd0993a4-...` YA estaba condenada a reportar "conflicto" incluso sin el hand-edit (por el patch corrupto) — así que este resultado por sí solo no aísla el mecanismo de detección de conflicto real de la base. Ese mecanismo se validó de forma independiente comparando con `f1e7aaec-...` (P3, sin el bug): con la base real intacta, P3 **sí** aplicó — confirmando que `verificarPatch`/`AplicarPatchPort` distinguen correctamente "patch corrupto" de "patch íntegro contra base íntegra"; lo que no se pudo aislar por separado es "patch íntegro contra base con drift real", porque la única propuesta con patch íntegro (P3) nunca se sometió a un hand-edit antes de aplicar.

### Punto 12 — Barrido de huérfanos

Dos worktrees reales fabricados a mano (`git worktree add`), uno con mtime forzado a hace 3 h (`fs.utimesSync`), otro con mtime reciente:

```
$ npx tsx src/_verif37_barrido.ts
[driver-barrido] worktreeRoot=.harness/worktrees ttlMs=7200000
{"event":"worktree-barrido-ok","examinados":2,"borrados":1,"fallidos":0,"ttlMs":7200000}

$ git worktree list
.../arnes_empresarial                                    fa62885 [hito/v2.1-escritura-delegada]
.../arnes_empresarial/.harness/worktrees/verif37-reciente fa62885 [harness/caso-verif37-reciente]   ← sobrevive
```

El worktree con mtime de 3 h (`verif37-r4`) desapareció (directorio + entrada de `git worktree list` + rama `harness/caso-verif37-r4`); el de mtime reciente sobrevivió. `examinados: 2, borrados: 1` — exacto.

### Punto 13 — Rollback (`HARNESS_ESCRITURA_DELEGADA=off`)

Mismo PR #5, driver reiniciado con `HARNESS_ESCRITURA_DELEGADA=off` (confirmado en su propio log de arranque). Log real, con el interruptor apagado — **ninguna** línea `worktree-*`/`propuesta-*` en todo el ciclo:

```json
{"event":"webhook-recibido","action":"synchronize","casoId":"3e4f9d00-...","timestamp":"...T07:45:21.974Z"}
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"5","event":"actividad-reusada","timestamp":"...T07:45:21.975Z"}
{"agentId":"planner","delegacionId":"d8cd3789-...","event":"delegacion-iniciada","timestamp":"...T07:45:23.204Z"}
{"agentId":"planner","delegacionId":"d8cd3789-...","event":"delegacion-completada","timestamp":"...T07:46:06.049Z"}
{"agentId":"developer","delegacionId":"c06ab3b0-...","event":"delegacion-iniciada","timestamp":"...T07:46:06.050Z"}
{"agentId":"developer","delegacionId":"c06ab3b0-...","event":"delegacion-completada","timestamp":"...T07:47:02.025Z"}
{"agentId":"reviewer","delegacionId":"1d9941a3-...","event":"delegacion-iniciada","timestamp":"...T07:47:02.026Z"}
{"agentId":"reviewer","delegacionId":"1d9941a3-...","event":"delegacion-completada","timestamp":"...T07:47:10.062Z"}
{"chars":633,"event":"tablero-comentario-publicado","timestamp":"...T07:47:10.845Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","event":"tablero-actualizado","timestamp":"...T07:47:11.949Z"}
```

Cadena Planner→Developer(read-only, sin worktree)→Reviewer — comportamiento estructural idéntico a `v2.0.0` (comentario + label + assignee, un único veredicto). Confirmado:

```
$ ls .harness/worktrees/
(vacío)

$ git worktree list
.../arnes_empresarial   fa62885 [hito/v2.1-escritura-delegada]

$ sqlite3 data/harness.db "SELECT COUNT(*) FROM propuestas_cambio;"
3   ← IDÉNTICO al conteo de antes del rollback, cero filas nuevas
```

`/ayuda` con el interruptor apagado — **ver hallazgo 3**: sigue listando los tres comandos, contra lo que dice `design.md`/`tasks.md`.

### Punto 14 — R4 (mismo conteo con/sin worktree abierto)

Worktree real abierto a mano, con un archivo de test adicional colocado adentro (`src/_fake_extra.test.ts`) que — de ser descubierto — infllaría el conteo:

```
$ npm test   (SIN worktree abierto)
 Test Files  98 passed (98)
      Tests  1515 passed (1515)

$ git worktree add -b harness/caso-verif37-r4 .harness/worktrees/verif37-r4 HEAD
$ (agregado src/_fake_extra.test.ts DENTRO del worktree)
$ npm test   (CON worktree abierto)
 Test Files  98 passed (98)
      Tests  1515 passed (1515)
```

**Conteo idéntico** — `vitest.config.ts`'s `exclude: [...configDefaults.exclude, ".harness/**"]` funciona.

### Punto 15 — Suite completa

```
$ rm -rf dist && npx tsc --noEmit
(sin salida — 0 errores)

$ npm test
 Test Files  98 passed (98)
      Tests  1515 passed (1515)
```

Mismo conteo que el baseline tomado al INICIO de esta sesión (antes de cualquier verificación) — cero regresiones de código de producción, como se esperaba (no se tocó `src/`). Confirmado por lectura de `cadena-revision.test.ts` (el único archivo de test nuevo de este hito que se acerca a invocar un subagente real): importa `Options` solo como TIPO (`import type`), inyecta `invocar: vi.fn()` — ningún test de la suite invoca el modelo real ni abre un puerto real.

## Limpieza realizada al cierre

- Los 10 drivers temporales (`src/_verif37_*.ts`) fueron borrados.
- `git worktree list` y `.harness/worktrees/` confirmados vacíos.
- `git branch --list "harness/caso-*"` confirmado vacío (sin ramas huérfanas).
- Los dos procesos de servidor (`_verif37_webhook.ts` y `gh webhook forward`) fueron detenidos; el webhook de prueba en GitHub (`practicaDeDesarrollo`) fue eliminado (`gh api -X DELETE .../hooks/<id>`) ambas veces que quedó registrado.
- `git status --short` en el checkout real: limpio (ningún archivo de `src/` tocado).
- `git config core.longpaths true` quedó activo en este checkout (ver hallazgo 4) — es config local, no código, y revertirlo reintroduciría el bloqueo de "Filename too long" para la próxima sesión.
- PR de prueba dejado abierto, sin mergear, a propósito: **[PR #5](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/5)** (evidencia de esta tarea) — queda a criterio del humano cerrarlo o dejarlo como constancia.

**Limpieza de la sesión de revalidación (post-fix `af393b7`)**: los 5 drivers temporales de esta sesión (`src/_verifrevalid_*.ts`) fueron borrados; `git worktree list`/`.harness/worktrees/`/`.harness/patches/` confirmados vacíos; `git branch --list "harness/caso-*"` vacío; los procesos node del driver de webhook fueron detenidos (se verificó con `Get-CimInstance Win32_Process` que no quedaron hijos colgados tras el stop del wrapper de bash, y se forzó su cierre); `git status --short` en el checkout real quedó limpio salvo los dos archivos de documentación de esta tarea (este `README.md` y, si aplica, `tasks.md`); segundo PR de prueba dejado abierto, sin mergear, a propósito: **[PR #6](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/6)**.

## Revalidación post-fix `af393b7` (sesión de revalidación puntual, mismo día)

**Alcance**: revalidación PUNTUAL de los dos puntos del guion que habían quedado en ⚠️ por el hallazgo crítico (punto 6, `git apply --check`, y el matiz de punto 8) y reintento del punto 2/7 (`tests-worktree-ok`/`tests-worktree-error`) — no una repetición de los 15 puntos completos. Mismo verificador, misma infraestructura (repo de prueba `JimmyFung123/practicaDeDesarrollo`, `gh` autenticado, `.env` con `ANTHROPIC_API_KEY`/`GITHUB_WEBHOOK_SECRET`, sin TTY).

### PR usado: nuevo, no se reusó el #5

`gh pr view 5` confirmó que el PR anterior seguía **OPEN, sin mergear**. Se decidió NO reusarlo: ya se había ejercitado 3 veces en la sesión anterior con framings cada vez más directivos y las tres veces el Developer real devolvió `sin_cambios` (ADR 70) — reusarlo no iba a producir una propuesta nueva por sí solo, y la consigna pedía explícitamente un PR nuevo. Se abrió **[PR #6](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/6)** (`docs: mejorar README con una descripcion breve del repo`, rama `verif-revalidacion-post-fix-af393b7`), con un pedido de documentación chico y legítimo (el README del repo de prueba solo decía "hola"), sin ningún lenguaje de auto-autorización.

### Nota de entorno: `gh webhook forward` no pudo crear el hook temporal (HTTP 404)

`gh webhook forward --repo ... --secret ...` falló, dos veces, con `HTTP 404: Not Found (https://api.github.com/repos/.../hooks)`. Diagnóstico: `GET repos/.../hooks` funciona (`[]`, admin:true confirmado en el repo), así que no es un problema de acceso al repo — el token OAuth actual (`gho_...`, scopes `gist, read:org, repo, workflow`) probablemente no trae `admin:repo_hook`, necesario para que la extensión cree el hook temporal. Re-autenticar con ese scope (`gh auth refresh --scopes admin:repo_hook`) es un cambio de cuenta/permiso que requiere una autorización explícita del usuario (flujo OAuth interactivo) — fuera de alcance de esta revalidación, así que no se intentó.

**Fallback usado, no un doble**: se armó el mismo payload que GitHub mandaría para `pull_request` (con los datos REALES del PR #6, confirmados vía `gh pr view`), se firmó con HMAC-SHA256 usando el `GITHUB_WEBHOOK_SECRET` real (cargado desde `.env` dentro del propio proceso Node, nunca impreso en ningún comando ni log) y se posteó directo al listener HTTP real (`src/adapters/webhooks/server.ts`) con los headers `x-github-event`/`x-hub-signature-256`/`x-github-delivery` reales. Esto ejercita EXACTAMENTE el mismo código de producción que un webhook real de GitHub dispararía (verificación de firma, `mapGithubEvent`, `onActivity`) — la única diferencia con `gh webhook forward` es el transporte (POST directo en vez de relay vía GitHub), no el código ejercitado.

### Ciclo real webhook→Planner→Developer→Reviewer: 4ª confirmación consistente de `sin_cambios`

Con el driver de webhook real (mismo wiring de `main.ts`, sin TUI) escuchando y el POST firmado enviado, el ciclo completo corrió de punta a punta sobre el caso real `7bee3738-d3a3-4b89-a212-40af465927e7`:

```json
{"event":"webhook-recibido","action":"opened","bytes":650,"casoId":"b5f8cc6a-...","timestamp":"...T08:17:26.633Z"}
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"6","actividadId":"8108b821-...","casoId":"7bee3738-...","event":"actividad-creada","timestamp":"...T08:17:26.638Z"}
{"agentId":"planner","delegacionId":"9f2679e4-...","event":"delegacion-iniciada","timestamp":"...T08:17:27.853Z"}
{"agentId":"planner","delegacionId":"9f2679e4-...","event":"delegacion-completada","timestamp":"...T08:18:11.966Z"}
{"agentId":"developer","delegacionId":"2369e644-...","event":"delegacion-iniciada","timestamp":"...T08:18:12.320Z"}
{"agentId":"developer","delegacionId":"2369e644-...","event":"delegacion-completada","timestamp":"...T08:19:02.856Z"}
{"rama":"harness/caso-7bee3738-...-ea3b18ea-...","casoId":"7bee3738-...","event":"propuesta-sin-cambios","timestamp":"...T08:19:03.013Z"}
{"agentId":"reviewer","delegacionId":"2167c16f-...","event":"delegacion-iniciada","timestamp":"...T08:19:03.181Z"}
{"agentId":"reviewer","delegacionId":"2167c16f-...","event":"delegacion-completada","timestamp":"...T08:19:11.100Z"}
{"chars":325,"casoId":"7bee3738-...","event":"tablero-comentario-publicado","timestamp":"...T08:19:12.085Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"7bee3738-...","event":"tablero-actualizado","timestamp":"...T08:19:13.853Z"}
```

Mecanismo completo (worktree real abierto/cerrado, `capturarDiff`, cadena `sesion_padre_id`, comentario/label reales en el tablero) corrió sin errores. El Developer real, de nuevo, decidió **no escribir nada** — cuarta vez consecutiva contando la sesión anterior (3 intentos con framings crecientes sobre el PR #5) más este intento con un PR nuevo y un pedido llano, sin ningún lenguaje de auto-autorización. Esto refuerza la lectura de la sesión anterior: es un comportamiento **legítimo y consistente** del modelo (ADR 70 — tratar instrucciones de un PR externo sin corroborar como texto no confiable, no como una orden), no un artefacto de cómo se formuló el pedido. No es un bug del hito.

### Propuesta real revalidada: worktree → escritura real → `crearPropuestaCambio` (corregido) — sin `insertPropuestaCambio`

Dado que el ciclo autónomo no produjo una propuesta (comportamiento legítimo, no reproducible a demanda), se revalidó el fix con el mismo criterio metodológico que la sesión anterior dejó documentado para este caso — **pero por primera vez a través de la función `crearPropuestaCambio` real y corregida**, nunca `insertPropuestaCambio` directo. Un driver temporal replicó, paso a paso, la secuencia exacta de `ejecutarDeveloperConEscritura` (`src/core/activity/cadena-revision.ts`, función interna no exportada):

```
WorktreePort.abrir (real, casoId real del PR #6)
  → escritura de archivos reales en el worktree (único paso sustituido: el driver
    en vez del modelo — mismo reemplazo que ya documentó la sesión anterior)
  → WorktreePort.capturarDiff (real)
  → crearPropuestaCambio (real — la función CORREGIDA por af393b7)
  → WorktreePort.cerrar (real)
```

Resultado:

```json
{
  "resultado": "creada",
  "propuesta": {
    "id": "fdb2e4c2-5520-4608-b00f-9f10a6ef28ee",
    "casoId": "7bee3738-d3a3-4b89-a212-40af465927e7",
    "baseCommit": "af393b7f976d993360c61d8ba3190e9c56d1378c",
    "patchBytes": 810,
    "archivos": 2,
    "lineasAgregadas": 5,
    "lineasEliminadas": 0,
    "estado": "pendiente_aprobacion_humana"
  }
}
```

### Punto 6 revalidado — `git apply --check` pasa SIN corrección manual

Dump byte-exacto vía `better-sqlite3` (mismo camino de producción, misma nota metodológica que la sesión anterior sobre por qué el CLI `sqlite3` enmascara el bug):

```
$ node -e "... db.prepare('SELECT patch FROM propuestas_cambio WHERE id = ?').get('fdb2e4c2-...') ... writeFileSync(...)"
bytes: 810
last 5 bytes: " #6.\n"   ← el "\n" final SOBREVIVE (antes del fix, `.trim()` se lo comía)

$ git apply --check .harness/debug_revalid_patch.diff
$ echo $?
0   ← PASA, sin tocar un solo byte del dump
```

Confirmado: con `af393b7`, el patch **tal como queda persistido** ya no está corrupto — `git apply --check` pasa sobre el dump crudo, ninguna corrección a mano hizo falta (a diferencia del hallazgo original, donde solo un dump editado a mano pasaba).

### Punto 8 revalidado — TUI completa con una propuesta del pipeline real

```
> /login verif-e2e claveVerif24!
Sesión abierta como verif-e2e. Vence ...

> /ver-propuesta
- propuesta bd0993a4-... | ... (la vieja, con el patch corrupto pre-fix, sigue pendiente)
- propuesta fdb2e4c2-... | caso 7bee3738-... | archivos 2 | +5/-0 | estado pendiente_aprobacion_humana

> /ver-propuesta fdb2e4c2-5520-4608-b00f-9f10a6ef28ee
[patch completo, íntegro — mismo contenido que el dump verificado arriba]
```

**Eco (1er llamado) — cero escrituras**, verificado con `SELECT` antes/después (`propuestas_cambio.estado` sin cambios, `registro_acciones_empleado` vacío en ambos casos):

```
> /aplicar-propuesta fdb2e4c2-5520-4608-b00f-9f10a6ef28ee
propuesta fdb2e4c2-... · caso 7bee3738-... · base af393b7f... · archivos 2 · +5/-0 — repetí el comando para confirmar.
```

**Confirmar — aplica de verdad**:

```
> /aplicar-propuesta fdb2e4c2-5520-4608-b00f-9f10a6ef28ee
Listo: la propuesta fdb2e4c2-... quedó aplicada. 2 archivo(s) modificados, sin stagear — revisá con git status.
```

`git status`/`git log` reales DESPUÉS de aplicar (checkout real):

```
$ git status --short
 M README.md
?? VERIF_REVALID_POSTFIX_MARKER.md

$ git log --oneline -1
af393b7 fix(core): persiste el patch original sin trim en crearPropuestaCambio ...   ← SIN commits nuevos

$ git diff --stat
 README.md | 2 ++
 1 file changed, 2 insertions(+)
```

Sin `git add`, sin commit, sin push — exactamente el contrato esperado (ADR 57 pto 4). Se revirtió a mano (`git checkout -- README.md && rm VERIF_REVALID_POSTFIX_MARKER.md`) inmediatamente después de capturar la evidencia.

Fila de auditoría real:

```json
{"id":"739bb00a-c83f-447a-aa26-31b419c827b4","empleado_id":"verif-e2e","comando":"/aplicar-propuesta","caso_id":"7bee3738-...","resultado":"aplicada","propuesta_id":"fdb2e4c2-...","ocurrido_at":"...T08:22:04.127Z"}
```

### Punto 2/7 reintentado — mismo límite conocido, confirmado (NO es un hallazgo nuevo)

Se reabrió un worktree real y se corrió `mcp__worktree__run_tests` (`handleRunTests` real, `runVitest` real) **sin ningún test roto a propósito esta vez** (a diferencia de la sesión anterior, para aislar mejor la causa):

```
TESTS EN ROJO (exit 1, 6866 ms).
 Test Files  2 failed | 96 passed (98)
      Tests  2 failed | 1514 passed (1516)
```

Los dos archivos que fallan son la MISMA clase de causa raíz — código/tests preexistentes que asumen que su propia ubicación de archivo (o el CWD del proceso) es el checkout real, algo que deja de ser cierto en cuanto la suite corre DENTRO de un worktree:

1. **`src/adapters/knowledge/graphify-cli.test.ts`** — ya documentado (hallazgo 2 original): `graphify-out/graph.json` está gitignoreado, ausente en cualquier worktree fresco.
2. **`src/test/integration/run-tests.integration.test.ts`** (el test de R5) — no se había nombrado individualmente antes, pero el conteo de la sesión anterior ("incluso sin el test roto propio, la corrida ya trae 2 archivos fallando por ese motivo ajeno") ya lo incluía implícitamente. Causa exacta: este test calcula `REPO_ROOT` con `resolve(dirname(fileURLToPath(import.meta.url)), "../../..")`, es decir, a partir de la ubicación del PROPIO archivo de test — una elección explícitamente documentada en su module-doc como "nunca `process.cwd()`" para ser robusta. Pero cuando la suite ENTERA corre con `cwd` fijado a un worktree (`mcp__worktree__run_tests`), el archivo que se ejecuta es la copia del worktree (`git worktree` trae el árbol completo, tests incluidos), así que `import.meta.url` apunta ahí — y `REPO_ROOT` termina siendo el worktree, no el checkout real. `resolveTestRunnerConfig(REPO_ROOT).vitestEntrypoint` (`node_modules/vitest/vitest.mjs`) no existe ahí (los worktrees no tienen `node_modules` propio, gitignoreado), así que `expect(existsSync(config.vitestEntrypoint)).toBe(true)` falla.

**Confirmado: el motivo sigue siendo EXACTAMENTE el mismo ya reportado** (tests preexistentes que no contemplan correr desde dentro de un worktree aislado), no algo nuevo introducido por este hito ni por el fix de `af393b7`. Por instrucción explícita de esta revalidación, no se tocó `.gitignore`, `graphify-cli.test.ts`, `run-tests.integration.test.ts` ni ningún código de producción — se documenta como límite conocido, ya reportado, sin cambios.

## Qué falta para el cierre real del hito

1. **Reviewer de cierre del hito completo** (`sdd-verify` + `code-review` contra `tasks.md`, los 4 specs y `design.md`): sigue sin correr. Solo existe `verify-report-pr1.md`, con alcance explícito "tareas 1-6... 7-37 fuera de alcance". El hallazgo crítico que lo bloqueaba (bug de `.trim()`) ya está corregido y revalidado — esta revisión ya no tiene ningún hallazgo bloqueante conocido pendiente que la posponga.
2. ~~El bug de `crearPropuestaCambio`~~ — **CORREGIDO (`af393b7`) y REVALIDADO** con una propuesta real del pipeline completo (ver arriba). Ya no bloquea el cierre.
3. **El hallazgo de `graphify-out/graph.json` ausente en worktrees** (`src/adapters/knowledge/graphify-cli.test.ts`, y ahora también confirmado en `run-tests.integration.test.ts` por la misma causa raíz): no se corrigió, deja la suite completa en rojo dentro de CUALQUIER worktree real, incluso sin que el Developer haya tocado nada. Sigue sin ser un bug de este hito (son tests preexistentes), pero sigue siendo el primer hito que lo expone.
4. **La discrepancia de `/ayuda`** con `HARNESS_ESCRITURA_DELEGADA=off`: no se corrigió — o se ajusta el código para filtrar `COMANDOS`, o se corrige el enunciado de `design.md`/`tasks.md` que promete lo contrario.
5. **`git config core.longpaths true`** como prerrequisito de Windows: no está documentado en el `README.md` raíz ni en ningún lado — recomendación dejada arriba, no aplicada.
6. **`gh webhook forward` no puede crear hooks temporales con el token OAuth actual** (falta, probablemente, el scope `admin:repo_hook`) — no bloquea nada de este hito (el fallback de POST firmado a mano ejercita el mismo código real), pero vale dejarlo anotado para quien quiera usar `gh webhook forward` tal cual en el futuro.
7. **Checklist de cierre de `AGENTS.md`** y **tag `v2.1.0`**: pendientes de que el punto 1 cierre y del merge a `main`.

## ¿Cierra el hito?

**Cambió de estado respecto de la sesión anterior.** Antes: el entregable central (`/aplicar-propuesta` contra una propuesta real) no funcionaba — bloqueante. Ahora: el fix (`af393b7`) está commiteado y **revalidado con evidencia real** — patch persistido íntegro, `git apply --check` en verde sin intervención manual, ciclo TUI completo aplicando de verdad sobre una propuesta que salió del pipeline real (worktree → escritura → `crearPropuestaCambio` corregido, nunca `insertPropuestaCambio` a mano).

Ya **no queda ningún hallazgo bloqueante conocido** para el entregable funcional en sí. Lo único que sigue pendiente para el cierre FORMAL del hito es procedimental, no de código: el Reviewer de cierre completo (`sdd-verify` + `code-review` contra `tasks.md`/specs/`design.md`) todavía no corrió — eso, no un bug, es lo que separa a este hito de poder taggearse `v2.1.0`. El límite de `graphify-cli.test.ts`/`run-tests.integration.test.ts` (suite roja dentro de cualquier worktree por causas preexistentes ajenas a este hito) y la discrepancia de `/ayuda` siguen documentados como hallazgos menores, no bloqueantes, a criterio del Reviewer.
