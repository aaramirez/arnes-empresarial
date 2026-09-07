# Exploration: Escritura delegada del Developer vía worktree aislado (v2.1.0)

> Nota de herramientas: esta exploración corrió sin `Bash` disponible, así que no se pudo correr `graphify query`/`explain`/`path` pese al hook que lo exige — mismo caso ya documentado por `exploration.md`/`proposal.md`/`design.md` de `hito-2.0-delegacion-subagentes`. Se compensó con `Read`/`Grep`/`Glob` directo sobre el código real.

## Current State

`design.md` §15 de `hito-2.0-delegacion-subagentes` (líneas 832-848) resume completo — pero **no implementado, no especificado formalmente** — un mecanismo para que el rol `developer` escriba código real de forma segura, diseñado durante una revisión intermedia de ese hito y luego sacado de alcance por decisión del checkpoint humano. Verificado el estado real de cada pieza que ese resumen cita:

- **`src/adapters/knowledge/graphify-cli.ts`** (159 líneas leídas completas) — el molde que §15 propone copiar SÍ sigue vigente tal como se describe: `ExecFileFn` inyectable (tipo `(file, args, options) => Promise<{stdout, stderr}>`), `defaultExecFile` usa `execFile` (nunca `exec`, argv como array, sin shell) con `maxBuffer`/`windowsHide`, y `GraphifyCliError` clasifica la causa cruda (`ENOENT`→`not-found`, `killed`/`SIGTERM`→`timeout`, código numérico→`exit-code`, resto→`unknown`) sin dejar fugar el error nativo. Precisión menor: el directorio `src/adapters/knowledge/` tiene **5** archivos de producción (`index.ts`, `config.ts`, `cited-nodes.ts`, `knowledge-tool.ts`, `graphify-cli.ts`), no 4 — el número exacto de §15 ("misma estructura de cuatro archivos") es impreciso, aunque el patrón reusable (inyección + `execFile` + error tipado) es exacto.
- **`openspec/config.yaml`** — confirmado: `testing.layers.integration: false` (línea 21). Sigue así desde Hito 1, tal como dice §15.
- **`.gitignore`** — confirmado: `.harness/` **no** está listado (10 entradas, ninguna coincide). Habrá que agregarlo si v2.1.0 usa ese directorio para worktrees.
- **`AGENTS.md` línea 78** — texto exacto: *"El commit y el push los ejecuta siempre el humano. Ningún agente corre `git commit` ni `git push` por su cuenta, ni siquiera con el Reviewer ya aprobado."* Confirma literalmente el límite que §15 usa para frenar "aplicar" en `git apply`.
- **`src/core/agents/`** — hoy contiene únicamente `definitions.ts` + `definitions.test.ts`, con **un solo agente registrado** (`CONVERSATIONAL_AGENT`, `AGENT_REGISTRY` es un `Map` de una entrada). No existen `planner`/`developer`/`reviewer`/`validador-solicitudes`, ni `SUBAGENT_REGISTRY`, ni el puerto `InvocarSubagente` de ADR 53. `hito-2.0-delegacion-subagentes/tasks.md` (25 tareas) no tiene ninguna casilla marcada — `sdd-apply` no corrió todavía.
- **`src/core/turn-selector/invoke-model.ts`** (357 líneas leídas completas) — `toQueryOptions` hoy arma un único `Options` compartido para el agente conversacional (`agent`, `agents`, `resume?`, `allowedTools?`, `mcpServers?`) — **no existe ningún campo `cwd`** en el código actual, ni una segunda llamada a `query()` por rol. El único punto donde aparece `cwd` en todo `design.md` es dentro de la propia §15 (línea 843) — es un concepto que ADR 53 habilita pero que ningún ADR 48-56 implementa hoy.
- **Migraciones reales aplicadas**: `src/adapters/memory/migrations/` llega hasta `0006_credenciales_empleado.ts` (Hito `tui-canal-empleado`). Las migraciones `0007`/`0008` que `hito-2.0` propone (tabla `delegaciones`, `solicitud_interna`) **tampoco existen todavía como archivos** — son planificación, no código. La `0009_propuestas_cambio` que §15 sugiere asume que 0007/0008 ya aterrizaron.
- **`package.json`** — sin librería de git (`simple-git`, `isomorphic-git`, etc.) entre dependencias. Confirma que el adaptador nuevo tendría que ser `execFile("git", [...])` crudo, igual que `graphify-cli.ts`, no un wrapper de terceros.
- **`src/adapters/`** — no existe `src/adapters/git/`. Sería un directorio nuevo.

## Dependencia de secuencia (hallazgo central)

**v2.1.0 no puede implementarse en código antes de que v2.0.0 esté efectivamente aplicado**, aunque sí puede planificarse (exploración/propuesta/specs/diseño/tareas) en paralelo:

1. El mecanismo completo de worktree descansa en que "cada rol es su propia llamada a `query()`, con su propio `Options` y por lo tanto su propio `cwd`" (`design.md` línea 836). Esa propiedad **es ADR 53**, y ADR 53 hoy es solo texto en `design.md` de `hito-2.0` — el código real (`InvocarSubagente`, `toQueryOptions` por rol, `SUBAGENT_REGISTRY` con `developer`) no existe. Sin eso, no hay dónde colgar un `cwd` de worktree sin tocar el agente conversacional único que existe hoy.
2. La migración `0009_propuestas_cambio` que §15 propone colisiona en número si `0007`/`0008` de `hito-2.0` no se aplican primero — la numeración de migraciones es secuencial y depende del estado real del repo en el momento de aplicar, no del que existía cuando se escribió `design.md`.
3. El `developer` como `AgentDefinition` con `allowedTools: ["Read","Glob","Grep","Write","Edit"]` que §15 asume que existe (para ensancharle el `cwd`) es en sí mismo una tarea de `hito-2.0` (tareas 5-6 según su `tasks.md`), no de v2.1.0.

Esto no es un bloqueo para el trabajo de `sdd-explore`/`sdd-propose`/`sdd-spec`/`sdd-design` de v2.1.0 — pero **sí lo es para `sdd-apply` de v2.1.0**, que debe verificar `hito-2.0-delegacion-subagentes` mergeado a `main` (Reviewer aprobado, checklist de cierre completo) antes de arrancar. Debe quedar como precondición explícita del `design.md` de v2.1.0, no como nota al pie.

## Affected Areas

- `openspec/changes/hito-2.0-delegacion-subagentes/design.md` §15 — punto de partida; ADR 57-61 y RD-9 a RD-15 reservados ahí, a materializar en el `design.md` propio de v2.1.0.
- `src/adapters/knowledge/graphify-cli.ts` — molde de patrón a replicar en `src/adapters/git/` (no se toca, solo se lee como referencia).
- `src/core/agents/definitions.ts` — hoy un solo agente; v2.1.0 depende de que `hito-2.0` lo convierta en registro de 4 roles primero.
- `src/core/turn-selector/invoke-model.ts` (`toQueryOptions`) — hoy sin `cwd`; el mecanismo de v2.1.0 necesitaría que el composition root pueda pasarle `cwd` por rol, algo que solo tiene sentido una vez que exista una llamada a `query()` por rol (ADR 53 real).
- `AGENTS.md` línea 78 — la restricción "sin commit/push/PR" fija el límite duro de "aplicar" en v2.1.0.
- `openspec/config.yaml` — `testing.layers.integration: false` tendría que pasar a `true` si v2.1.0 agrega la categoría de test de integración contra `git` real que §15 anticipa.
- `.gitignore` — falta la entrada `.harness/`.
- `src/adapters/memory/migrations/` — próxima migración disponible depende del estado de `hito-2.0` en el momento de aplicar (hoy el techo real es `0006`).
- `package.json` — sin dependencia de git; el adaptador nuevo sería `execFile` crudo, sin nueva dependencia productiva.

## Approaches

No hay bifurcación real de arquitectura acá — las decisiones de fondo (worktree por caso, tabla propia, patch persistido, two-step confirm TUI, sin `Bash`) ya están tomadas y evaluadas en la revisión 2 de `design.md` de `hito-2.0` (ADR 57-61 reservados). El único fork abierto es de **proceso**, no de diseño:

1. **Abrir ya `openspec/changes/hito-2.1-escritura-delegada/` con exploration.md propio (este documento) y seguir con `sdd-propose`/`sdd-spec`/`sdd-design`/`sdd-tasks` en paralelo a que `hito-2.0` avance por Implementer/Reviewer.**
   - Pros: no se pierde el trabajo de diseño ya hecho en la revisión 2 revertida; el spec propio (`propuesta-cambio-hitl`) puede escribirse ya, ya que `AGENTS.md` exige spec antes de diseño y §15 lo señala como precondición de proceso pendiente.
   - Cons: el `design.md` de v2.1.0 va a citar objetos de código (`AGENT_REGISTRY`/`SUBAGENT_REGISTRY`, `InvocarSubagente`, migración `0007`) que todavía no existen como código real — hay que fijarlos como referencia a la especificación de `hito-2.0`, no al código, y revalidarlos cuando `hito-2.0` cierre.
   - Effort: Low (es la ruta que ya recorrieron los hitos anteriores; el resumen de §15 deja ~80% de las decisiones de arquitectura ya tomadas).

2. **Esperar a que `hito-2.0` esté mergeado a `main` antes de abrir cualquier artefacto de v2.1.0.**
   - Pros: cero riesgo de que el diseño de v2.1.0 quede desalineado con el código real de `hito-2.0` si algo cambia durante su Implementer/Reviewer.
   - Cons: contradice la instrucción explícita del checkpoint humano de retomar v2.1.0 ya; pierde tiempo de pipeline sin necesidad, porque `sdd-propose`/`sdd-spec`/`sdd-design`/`sdd-tasks` no tocan código.
   - Effort: N/A (retrasa el inicio, no cambia el esfuerzo).

**Recomendación**: Approach 1. Planificar ya, pero con la precondición de secuencia (sección anterior) escrita explícitamente en el `design.md` de v2.1.0 como gate de `sdd-apply`, no como nota informal. Es el mismo patrón que este repo ya usa para dependencias entre hitos.

## Risks

- **Bloqueo de secuencia real**: `sdd-apply` de v2.1.0 no debe arrancar hasta que `hito-2.0-delegacion-subagentes` esté mergeado a `main` con ADR 53 como código real (`InvocarSubagente`, `SUBAGENT_REGISTRY` de 4 roles, `toQueryOptions` por rol). Si se ignora, el Implementer de v2.1.0 tendría que reinventar esa infraestructura dentro del propio hito, duplicando/contradiciendo el diseño ya aprobado de `hito-2.0`.
- **Colisión de numeración de migración**: `0009_propuestas_cambio` asume que `0007`/`0008` de `hito-2.0` existen; hay que resolver el número real contra el estado del repo en el momento de aplicar v2.1.0, no fijarlo hoy.
- **`options.cwd` es anclaje de alcance, no sandbox de SO** (ya lo dice §15 línea 843, confirmado sin código que lo contradiga): la garantía dura sigue siendo la topología (`git diff` dentro del worktree → confirm humano → `git apply`), no el aislamiento de proceso. Cualquier especificación de v2.1.0 tiene que dejarlo igual de explícito, no vender `cwd` como sandbox.
- **Sin transacción SQLite↔filesystem** (RD-13 original): un crash entre marcar `aplicada` en `propuestas_cambio` y ejecutar `git apply` deja estado inconsistente pero detectable (`git status`) y reversible (patch persistido) — riesgo aceptado ya, hay que mantenerlo documentado en el spec/design nuevo, no reabrirlo como si fuera nuevo.
- **Categoría de test nueva**: integración contra un proceso `git` real en `src/test/integration/` no existe hoy en este repo (`testing.layers.integration: false`); habilitarla es un cambio de convención de testing que el `design.md` de v2.1.0 debe declarar explícitamente y que puede requerir ajuste de `openspec/config.yaml`.
- **`.harness/` sin ignorar**: si el prototipo usa ese directorio para worktrees antes de actualizar `.gitignore`, hay riesgo real de commitear artefactos de trabajo transitorios.

## Qué falta definir (abierto por §15, con la resolución ya dada por el checkpoint donde aplica)

- **Tool MCP acotada para `npm test` dentro del worktree** — §15 la marca como "alcance adicional a decidir explícitamente". El checkpoint humano ya decidió que SÍ se quiere. Falta especificarla: nombre/namespace de la tool (paralelo a `mcp__knowledge__query_knowledge_base`), qué comando exacto corre (`npm test` vs `vitest run` — `openspec/config.yaml` documenta ambos: `test_command`/`test_command_raw`), cómo captura/trunca stdout largo, y si corre con `execFile` (mismo patrón, nunca `exec`/`Bash`) fijado a `cwd` del worktree.
- **TTL exacto del barrido de huérfanos** al arranque — §15 solo dice "filtrado por el prefijo de rama y un TTL", sin número. Falta fijar el valor (¿minutos? ¿horas?) y si es configurable por variable de entorno (mismo patrón que `HARNESS_DELEGACION_ROLES`).
- **Límite de tamaño del diff/patch persistido** en `propuestas_cambio.patch` — no mencionado en absoluto en §15. Sin tope, un patch gigante (ej. el Developer reescribe medio repo) queda sin capado antes de llegar a la UI del Reviewer/TUI privilegiado.
- **Formato exacto de la tool MCP** (nombre de herramienta, si además necesita `Grep`/`Read` acotados al worktree para que el Reviewer/Developer no se salgan de él, o si eso ya lo cubre `cwd`).
- **Numeración real de migración y de ADR** al momento de aplicar — 0009/ADR 57-61 son reservas, no compromisos; hay que revalidarlas contra el estado real del repo cuando `hito-2.0` cierre, tal como se hizo en esta exploración con `0006` siendo el techo real hoy (no `0008` como asumía el diseño original).
- **Nombre del spec/capability nuevo** — §15 dice `propuesta-cambio-hitl` sin confirmar si ese nombre colisiona con algo ya reservado (`hitl-generico`, `solicitud-interna-hitl` ya existen como specs de `hito-2.0`); conviene revisar el catálogo completo de capabilities antes de fijarlo en `sdd-spec`.

## Ready for Proposal

**Sí, con una condición.** El diseño de fondo (worktree, tabla propia, patch persistido, two-step confirm, sin `Bash`) está sólido y verificado contra el código real actual — `sdd-propose`/`sdd-spec`/`sdd-design`/`sdd-tasks` de v2.1.0 pueden avanzar ya. La condición: el `design.md` de v2.1.0 debe declarar explícitamente la **precondición de secuencia** (arriba) como gate de `sdd-apply`, no dejarla implícita — y `sdd-spec` debe escribir primero el spec de la nueva capability (`AGENTS.md` exige especificación antes de diseño), incorporando la resolución del checkpoint sobre la tool de `npm test`.
