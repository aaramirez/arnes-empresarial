> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. **Esta fase tampoco tuvo shell** (sólo `Read`/`Grep`/`Glob`/`Write`/`Edit`), así que el binario no se pudo invocar — misma limitación que declararon la exploración y las dos pasadas de la propuesta. Se compensó con lectura directa y completa de: `src/core/agents/definitions.ts` (326 líneas, entero), `src/core/startup/bootstrap.ts` (84 líneas, entero), `src/core/turn-selector/invoke-model.ts:250-440`, `src/core/logging/turn-logger.ts:150-243`, `src/core/hooks/hook-engine.ts:55-113`, `src/core/knowledge/knowledge-contract.ts` (entero), `src/adapters/knowledge/knowledge-tool.ts:31` y `cited-nodes.ts`, `src/main.ts:140-235`, `src/build-on-activity.ts:300-345`, `src/build-on-comando-empleado.ts:684-705`, `src/adapters/git/config.ts:1-45`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2042-2075`, `openspec/config.yaml`, `.gitignore`, y `grep` de `invokeModel(`/`bootstrapHarness`/`process.cwd()`/`from "node:` sobre todo `src/`.

# Diseño técnico: Definición de Skills — Registro de Skills con descubrimiento desde disco (v3.1.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 103-107, R1-R9, RD-45 a RD-48) · arc42 **Deuda 4** (660-664), **Caja Blanca 5** (286-294), **Concepto transversal 5** (506-508), **Objetivo específico 6**.

**Rama**: `hito/v3.1-definicion-skills` · **Tag**: `v3.1.0` (propuesto, lo fija el checkpoint) · **Progreso**: `docs/progreso/v3.1-definicion-skills/`.

**Numeración de ADR — verificada, no asumida.** `grep '^### ADR'` sobre `proposal.md` ⇒ **103, 104, 105, 106, 107**; el techo declarado es el 107. Además se corrió `grep 'ADR 1(0[3-9]|[1-9][0-9])'` sobre **todo el repositorio** para descartar un ADR ≥ 108 escondido en otro change: las **64 coincidencias son todas de `proposal.md`** de este change, ninguna supera 107 (el `design.md` del Hito 7 llega al 102, confirmado). **Este diseño abre en el ADR 108 y cierra en el 115.** Riesgos residuales: la propuesta reservó hasta **RD-48**; los nuevos de esta fase arrancan en **RD-49**.

**Cerrado por la propuesta y NO reabierto acá**: ADR 103 (se construye el cargador; el ADR 8 se enmienda, no se deroga), ADR 104 (descubrimiento desde `.claude/skills/`, `Options.skills` como `string[]` explícito, nunca `'all'`), ADR 105 (`settingSources: ['project']`), ADR 106 (una skill real con tres límites), ADR 107 (`reloadSkills()` y `AgentDefinition.skills` fuera).

**Estado de los specs**: `openspec/changes/definicion-skills/specs/` **no existe todavía** (verificado por `Glob`: la carpeta del change sólo tiene `proposal.md`). Mismo punto del ciclo que el `design.md` del Hito 7. Este diseño se escribe contra las dos capabilities que la propuesta declara — `registro-skills` y `habilitacion-skills-turno` — y contra sus *Success Criteria*. Trazabilidad en §12.

---

## 1. Resumen de la arquitectura elegida

Tres archivos de núcleo nuevos, **cero adaptadores**, **cero dependencias nuevas** (octavo change consecutivo), **cero call sites modificados**, y un directorio `.claude/` que el repo no tenía.

```
 ┌───────────────────── src/core/ (nunca importa de adapters/) ──────────────────────┐
 │                                                                                   │
 │  skills/skill-frontmatter.ts   ★ NUEVO · PURO · CERO IMPORTS (ADR 110)            │
 │                                parsearSkillFrontmatter() · SkillInvalidaError      │
 │                                                                                   │
 │  skills/descubrir-skills.ts    ★ NUEVO · node:fs SÓLO dentro de DEPS_FS (ADR 109) │
 │                                descubrirSkills(base, deps) → ResultadoDescubrimiento│
 │                                DEFAULT_SKILLS_DIR = ".claude/skills"  (relativo)   │
 │                                                                                   │
 │  skills/skills-habilitadas.ts  ★ NUEVO · listarSkillsHabilitadas() memoizado       │
 │                                                                                   │
 │  startup/bootstrap.ts          MODIFICADO · TERCER registro, después de Hooks      │
 │                                HarnessRegistries gana `skills` (ADR 111, 115)      │
 │                                                                                   │
 │  turn-selector/invoke-model.ts MODIFICADO · toQueryOptions emite `skills` y        │
 │                                `settingSources` DENTRO DEL LITERAL (ADR 108)       │
 │                                                                                   │
 │  agents/definitions.ts         MODIFICADO · SÓLO el comentario 82-83               │
 └───────────────────────────────────────────────────────────────────────────────────┘
                                        │
   .claude/skills/citar-conocimiento/SKILL.md   ★ NUEVO — el ÚNICO artefacto de skill
   (ruta fijada por el SDK, no elegible — ADR 104 pto 1; contenido en ADR 112)
```

**La línea de corte, en una frase**: el `SKILL.md` es **contenido** (versionado, revisado por PR, invocable por el modelo); `src/core/skills/` es **el cargador** (código, testeado, que decide qué nombres se habilitan); y `toQueryOptions` es **el único punto donde esa lista se convierte en configuración de un turno**. Ninguno de los tres sabe nada de los otros dos más allá de un `readonly string[]`.

**Lo que NO cambia**: `handleTurn`, `resolveTurn`, `invokeModel` en sus ocho parámetros actuales, los tres composition roots, `AGENT_REGISTRY`, `SUBAGENT_REGISTRY`, `construirDeveloperConEscritura`, ninguna tabla, ninguna migración, ningún adaptador. **`git diff --stat main -- src/adapters/` ⇒ vacío.**

---

## 2. Mapa capability → módulos de código

| Capability (propuesta) | Módulos reales | ¿1:1? |
|---|---|---|
| `registro-skills` | `src/core/skills/skill-frontmatter.ts` + `descubrir-skills.ts` + `skills-habilitadas.ts` + `src/core/startup/bootstrap.ts` + `.claude/skills/citar-conocimiento/SKILL.md` + `src/test/integration/skills.integration.test.ts` | **1:N.** Es la capability **con I/O**: qué carpeta se escanea, qué es un paquete válido, de dónde sale el nombre canónico, qué se rechaza, orden estable, y la semántica de arranque completa |
| `habilitacion-skills-turno` | `src/core/turn-selector/invoke-model.ts` (`toQueryOptions` + `invokeModel`) | **1:1**, y es lo que hace que la separación no sea cosmética: esta capability se verifica **sin tocar el disco**, con los dobles que `invoke-model.test.ts` ya usa |

---

## 3. Decisiones de arquitectura (ADR 108-115)

### ADR 108: `skills` y `settingSources` se emiten **dentro del literal** de `toQueryOptions`, no con un `if` — "la clave nunca queda omitida" pasa a ser **inexpresable**, no testeada

**Contexto**. El ADR 104 pto 4 exige que con cero skills se emita `skills: []` y **nunca** se omita la clave. `toQueryOptions` (`invoke-model.ts:325-350`) construye `options` **incrementalmente**: `resume`, `allowedTools`, `mcpServers` y `cwd` entran cada uno detrás de un `if`, por `exactOptionalPropertyTypes: true`. Copiar ese molde acá sería lo natural y lo **incorrecto**.

**Decisión**:

1. **Las dos claves van en el literal inicial**, junto a `agent` y `agents`:

   ```ts
   const options: Options = {
     agent: agent.id,
     agents: { … },
     settingSources: [...SETTING_SOURCES_DEL_ARNES], // ["project"] — ADR 105
     skills: [...skills],                            // string[] explícito — ADR 104
   };
   ```

   Son las **dos primeras claves incondicionales** que este archivo agrega desde el Hito 1. No hay rama que las pueda saltear, no hay caller que las pueda omitir, no hay `undefined` que las pueda apagar. Es el molde del **ADR 98** del Hito 7 (*"la escritura es inexpresable por firma"*) aplicado a una perilla de configuración: el invariante más importante del change no depende de que alguien escriba el test.
2. **`SETTING_SOURCES_DEL_ARNES = ["project"] as const`**, constante de módulo con nombre, **copiada por spread en cada llamada**. La copia no es paranoia: `Options.settingSources` es `SettingSource[]` **mutable** en el `.d.ts` (línea 2052), y entregarle al SDK un alias de una constante compartida es entregarle la posibilidad de que un turno modifique la configuración del siguiente. Mismo motivo por el que `skills: [...skills]` copia (nuestro tipo es `readonly string[]`, el del SDK es `string[]` — línea 2075) y por el que `allowedTools` ya hacía `[...agent.allowedTools]` (línea 338).
3. **`skills` viaja como NOVENO parámetro trailing de `invokeModel`**, con default `listarSkillsHabilitadas()` — exactamente el molde que `mcpServers` (6º), `subagentes` (7º) y `cwd` (8º) ya establecieron, con la misma promesa escrita en el doc del archivo: *"a caller that omits it gets `options` identical to before"*. **Verificado: los tres call sites de producción quedan sin tocar** — `handle-turn.ts:240` (6 argumentos), `build-on-comando-empleado.ts:698` (4), `build-on-activity.ts:324-336` (8). Cero archivos de composition root modificados.

**Alternativas consideradas**:

- *Threading explícito desde `bootstrapHarness` hasta `invokeModel`*, pasando `skills` por `HandleTurnDeps` y por los cinco `BuildOn*Deps`: **rechazada**. Es la más "limpia" en abstracto y la peor acá: toca seis archivos de hitos cerrados y sus fixtures de test para transportar un `readonly string[]` que **es el mismo en los seis**, y cada archivo tocado es superficie de review de un hito que ya cerró. El repo ya resolvió este exacto problema con `subagentes`: default parameter que llama al registro, cero call sites.
- *Un `if (skills.length > 0)`*, por simetría con `allowedTools`: **rechazada, y es la trampa del change.** `allowedTools` vacío se omite porque omitirlo **no concede nada**; `skills` omitido **no apaga nada** — el `.d.ts` lo dice en negrita propia (línea 2058-2059: *"this is **not** 'skills off'"*). Las dos claves se parecen y significan lo contrario.

### ADR 109: El cargador vive en `src/core/skills/` con `node:fs` **detrás de deps inyectables** (molde `turn-logger.ts`), y la ruta base es un **literal relativo** — nunca `process.cwd()` concatenado, nunca `import.meta.url` (★ **RD-48, parte 1**)

**Contexto**. `AGENTS.md` fija que `src/core/` no importa de `src/adapters/*`. La propuesta pone el cargador en `src/core/` **y** dice que usa `node:fs`. Hay que verificar si eso es legal en este repo antes de escribirlo.

**Decisión**:

1. **Es legal, y hay precedente exacto.** `grep 'from "node:'` sobre `src/core/` devuelve **exactamente dos módulos de producción**: `logging/turn-logger.ts` (`appendFileSync`, `mkdirSync`, `dirname`) y `turn-selector/close-turn.ts` (`randomUUID`). La regla del repo no es *"núcleo sin Node"*, es *"núcleo sin adaptadores y sin SDK"*. `turn-logger.ts` es el molde literal: el I/O real vive en una función exportada (`createFileLogWriter`) que alimenta un objeto `DEFAULT_*_DEPS`, y la función de negocio recibe ese objeto como último parámetro con default. **`descubrir-skills.ts` copia esa estructura, no la inventa.**
2. **`DEFAULT_SKILLS_DIR = ".claude/skills"` — literal relativo**, igual que `DEFAULT_LOG_FILE_PATH = "data/harness.log"` (`turn-logger.ts:224`) y `openDatabase("data/harness.db")` (`main.ts:161`). **Node lo resuelve contra `process.cwd()`, que es exactamente la misma expresión con la que el SDK ancla su propio descubrimiento.** La coincidencia entre la raíz del cargador y la raíz del SDK deja de ser algo que hay que mantener sincronizado: es la misma resolución, hecha dos veces.
3. **Se rechaza anclar a `import.meta.url`** (el molde de `run-tests.integration.test.ts:89`, *"never `process.cwd()`"*), y el motivo es el corazón de **R9**: anclar al módulo garantizaría que el cargador lea el **árbol instalado** mientras el SDK lee `process.cwd()`. Si alguna vez difieren, emitiríamos nombres de skills que el SDK nunca descubrió — pasaríamos de un riesgo *posible* a una divergencia *construida a propósito*. El invariante que necesitamos es *"base del cargador === raíz de descubrimiento del SDK"*, y la única forma de tenerlo **por construcción** es usar la misma expresión. Lo que sí hace `import.meta.url` es servir de **testigo independiente** en el test de §10.D.
4. **La base se inyecta como parámetro con default**, nunca por variable de entorno (ADR 104, alternativa rechazada). Mismo criterio ya escrito en `adapters/git/config.ts:17-20` para `repoRoot`: *"a parameter fixed by the composition root, not an env var — a caller can't override the repo it is running against via the environment"*.
5. **`src/core/skills/` no importa `node:path`.** La composición de rutas (`base` + `/` + directorio + `/SKILL.md`) vive **dentro de `DEPS_FS`**, que es la única frontera con el filesystem. `descubrir-skills.ts` fuera de `DEPS_FS` no conoce separadores ni sistemas de archivos: recibe nombres de directorio y devuelve nombres de skill.

### ADR 110: Frontmatter — **whitelist de exactamente dos campos**, tope **1024**, y `name` **obligatoriamente igual** al nombre del directorio. El validador es **más estricto que el SDK, a propósito** (★ **RD-45 resuelto**)

**Contexto**. La propuesta cerró la investigación (R2): Claude Code trata **todo** el frontmatter como opcional (usa el nombre del directorio si falta `name`, el primer párrafo si falta `description`); el *Agent Skills spec* portable exige `name` + `description`, con `description` topada en **1024** (vs. **1536** combinado con `when_to_use` en la extensión de Claude Code). Lo que queda es una decisión de diseño.

**Decisión**:

1. **La skill de este change declara exactamente dos campos: `name` y `description`.** Son los dos únicos requeridos por el spec portable y los dos únicos que el SDK usa para resolver un nombre en `Options.skills` (`sdk.d.ts:2061-2062`: *"Names match the SKILL.md `name` / directory name"*).
2. **El validador rechaza cualquier campo fuera de esos dos.** No es purismo: es el **ADR 4 aplicado al frontmatter**. Cada campo de extensión (`allowed-tools`, `model`, `context`, `hooks`, `disable-model-invocation`, `user-invocable`) es una perilla de comportamiento del turno, y en este repo una perilla que afecta al turno se concede de a una, con justificación escrita. La whitelist convierte eso en un guard de arranque: **un `SKILL.md` que declare `allowed-tools: Bash(npm test)` aborta el arranque**, en vez de shippear silenciosamente un pedido de herramienta que ningún agente puede satisfacer. El **límite 2 del ADR 106 deja de ser una regla escrita y pasa a ser una excepción mecánica.** Agregar un campo el día que haga falta cuesta una línea en la whitelist y un ADR — que es el costo correcto.
3. **`description` se valida contra el tope portable de 1024**, no contra 1536. Los 512 caracteres que se ceden no cuestan nada (la `description` de la skill de este change son ~180) y compran que todo `SKILL.md` de este repo sea un artefacto **del spec público**, no de una extensión de un producto. Es la misma preferencia por lo estándar con la que el ADR 92 eligió el Agent Card canónico y el ADR 104 pto 3 eligió la lista explícita: cuando el estricto es gratis, se toma el estricto.
4. **`name` DEBE ser idéntico al nombre del directorio que contiene el `SKILL.md`.** El SDK acepta cualquiera de los dos como nombre canónico; nosotros eliminamos la pregunta *"¿cuál eligió?"* exigiendo que no haya dos respuestas posibles. **Corolario gratis**: como los nombres de directorio son únicos dentro de la carpeta, **no puede haber dos skills con el mismo nombre canónico** — el caso "entrada duplicada en el filtro" no necesita un chequeo propio, es imposible por construcción.
5. **El parser es un subconjunto de YAML deliberadamente diminuto**, en su propio archivo **sin imports**: delimitadores `---` en la primera línea y en una línea siguiente, pares `clave: valor` de una línea, valor recortado, sin anidamiento, sin listas, sin comillas obligatorias, sin multilínea. Cualquier otra cosa ⇒ `SkillInvalidaError`. **No entra una dependencia de YAML** (la racha de cero dependencias nuevas del change no se rompe por un archivo de seis líneas) y el módulo se testea con el molde de "cero imports" que ya usan los ocho `*-contract.test.ts` del núcleo.

**Alternativa considerada**: *alinearse con la opcionalidad total del SDK y no validar nada* (todo degrada, ver ADR 111). **Rechazada por el punto 4**: si `name` falta y el SDK cae en el nombre del directorio, nuestro cargador tendría que **replicar esa regla de fallback** para que el filtro y el descubrimiento coincidan. Replicar la heurística ajena es la fuente exacta de R9. Exigir que los dos valores existan y sean iguales elimina la heurística en vez de copiarla.

### ADR 111: La política de fallo corta **exactamente en "existe un `SKILL.md`"** — lo ambiental degrada, lo intencional aborta (★ **RD-46 resuelto**)

**Contexto**. El ADR 105 pto 4 fijó el criterio y su inclinación, y dejó el corte fino a esta fase. Es el **primer registro del arnés que puede fallar al cargar** (los otros tres son constantes en TypeScript) y por lo tanto la primera vez que el arnés puede no levantar por I/O (**R6**).

**Decisión** — la tabla es la política, y `sdd-spec` la escribe como requisitos:

| Situación en disco | Qué pasa | Por qué |
|---|---|---|
| `.claude/skills/` **no existe** | **DEGRADA**: `skills: []`, log `skills-carpeta-ausente`, el arnés arranca | Un clon sin skills es un arnés válido. Un arnés que no levanta por una carpeta opcional es peor que uno sin skills (ADR 105 pto 4, textual) |
| `.claude/skills/` existe y **no tiene subdirectorios** | **DEGRADA**: `skills: []`, log `skills-registro-vacio` | Mismo argumento. Es además el estado del repo **antes** del commit que agrega la skill: el arnés tiene que arrancar en ese commit |
| Un subdirectorio **sin `SKILL.md`** | **SE IGNORA** con log `skill-omitida-sin-skill-md` | Es exactamente lo que hace el SDK. Divergir acá nos haría rechazar lo que el SDK acepta, que es R9 en el otro sentido |
| `SKILL.md` **presente pero ilegible** (permisos, es un directorio, error de I/O que no es "no existe") | **ABORTA** con `HarnessBootstrapError` | Alguien puso ese archivo con intención. Tratar un `EACCES` como "no hay skills" es reportar una configuración rota como una configuración vacía |
| `SKILL.md` **presente e inválido** contra el ADR 110 (sin frontmatter, sin `name`, sin `description`, `description` > 1024, campo fuera de la whitelist, `name` ≠ directorio) | **ABORTA** con `HarnessBootstrapError`, nombrando **archivo y motivo** | **Acá es donde este repo valida más estricto que el SDK, y es una decisión, no un descuido.** El SDK degradaría con su fallback silencioso y el resultado sería un nombre canónico distinto del que el autor escribió — o sea, una entrada de `Options.skills` que **no resuelve a nada**. Y un filtro que no resuelve **es invisible**: la skill simplemente nunca aparece, sin error, sin log, sin síntoma. Ese es precisamente el tipo de fallo silencioso que este change existe para eliminar (Aclaración 2 de la propuesta). Un arranque roto y ruidoso es estrictamente mejor que un turno que corre sin una capacidad que alguien creyó haber entregado |

**Mecánica**, con el vocabulario que ya existe:

1. `descubrirSkills` lanza **`SkillInvalidaError`** — clase propia de `src/core/skills/skill-frontmatter.ts`, con `ruta` y `motivo`. **No lanza `HarnessBootstrapError`**: eso obligaría a `src/core/skills/` a importar de `src/core/startup/`, justo cuando `bootstrap.ts` importa de `src/core/skills/` — un ciclo.
2. **`bootstrapHarness` la envuelve** en `HarnessBootstrapError`, con el molde textual que ese archivo ya usa para el Registro de Agentes (`bootstrap.ts:66-72`: `try { … } catch (error) { throw new HarnessBootstrapError(...) }`). El mensaje resultante — *"No se pudo inicializar el arnés: el Registro de Skills rechazó `.claude/skills/x/SKILL.md`: …"* — cumple lo que la clase promete en su doc: *"the message always embeds the concrete reason so a failure at process start … is still actionable without extra context"*.
3. **`main.ts` no cambia**: su `startHarness()` ya corre dentro del `try` que reporta cualquier `HarnessBootstrapError` a stderr en una línea legible y termina con exit code distinto de cero. El camino de fallo nuevo **reusa el camino de fallo existente**, sin agregar un `catch`.

### ADR 112: La skill concreta es **`citar-conocimiento`**, y el `systemPrompt` de `CONVERSATIONAL_AGENT` **NO se recorta** (★ **RD-47 resuelto**)

**Contexto**. El ADR 106 fija tres límites y manda a esta fase a elegir *"una capacidad hoy embebida en el prompt que se lea mejor como paquete invocable"*. Se leyeron los **seis** `systemPrompt` reales de `definitions.ts` (conversacional, planner, developer, reviewer, validador-solicitudes, y el agregado de escritura del Developer).

**Decisión**:

1. **La skill es `citar-conocimiento`**, en `.claude/skills/citar-conocimiento/SKILL.md`. Empaqueta el **procedimiento de citado** de las respuestas fundadas en la base de conocimiento: cómo se renderiza una cita a partir de las líneas `NODE <label> [src=… loc=… community=…]` que devuelve la tool (formato verificado en `adapters/knowledge/cited-nodes.ts:20` y sus fixtures), qué hacer con `loc=None` (citar sólo `src`), cómo se cita cuando hay varias fuentes, cómo se redacta la respuesta cuando el vault **no** trajo nada, y la prohibición de citar un `src` que no esté en el resultado del turno.
2. **La obligación se queda en el `systemPrompt`; la skill se lleva el procedimiento.** Éste es el punto de diseño, no un detalle de redacción. `definitions.ts:119-123` obliga: *"CITÁ SIEMPRE la fuente"* y *"si la herramienta no devuelve conocimiento disponible, decíselo explícitamente en vez de inventar"*. **Esas dos líneas no se mueven a la skill y no se borran.** Una skill es un camino que **el modelo elige** — es el argumento (b) del ADR 8, vigente y confirmado por el ADR 103 pto 3. Mover una obligación a un paquete opcional la convierte en una sugerencia. Lo que sí es opcional, y por lo tanto sí pertenece a una skill, es el **cómo**: el formato exacto, los casos de borde, el ejemplo. **El prompt dice qué hay que hacer; la skill dice cómo se hace bien.** Consecuencia práctica y deliberada: si la skill nunca se invoca, el comportamiento del arnés es **byte por byte** el de `v3.0.0` — que es también la historia de rollback más limpia posible.
3. **Los tres límites del ADR 106, verificados uno por uno**:
   - **Límite 1 (camino del dinero)**: `citar-conocimiento` no menciona comisiones, reembolsos, confirmación de venta ni escalaciones, no referencia `src/core/ventas/` y no describe ningún cálculo. Verificable con `git diff` (Success Criterion de la propuesta).
   - **Límite 2 (herramientas)**: **la skill no requiere ninguna herramienta.** Opera sobre un resultado que **ya está en el contexto del turno**. Esto no es una casualidad de la elección: es el criterio con el que se eligió. `Options.skills` habilita para **la sesión principal**, y —hallazgo de esta fase, ver ADR 114— la sesión principal a veces la corre un **subagente** (`build-on-activity.ts:324` y `build-on-comando-empleado.ts:698` invocan `invokeModel` con Planner/Developer/Reviewer/Validador como agente principal). Una skill de tool cero es la **única** que no puede fallar en runtime contra ninguno de los seis agentes, sea cual sea su `allowedTools` — incluido el Validador, que tiene `allowedTools: []` literal.
   - **Límite 3 (secretos)**: el archivo contiene formato de citas y ejemplos con rutas de documentación pública del propio repo. Cero credenciales, cero tokens, cero rutas de datos.
4. **Frontmatter completo, con los dos campos del ADR 110**:

   ```markdown
   ---
   name: citar-conocimiento
   description: Formato de citas para respuestas fundadas en la base de conocimiento interna. Usala cuando el turno ya tiene resultados del vault (líneas NODE con src/loc) y hay que escribir la respuesta al empleado citando las fuentes, o cuando el vault no devolvió nada y hay que decirlo sin inventar.
   ---
   ```

   La `description` es lo único que el modelo ve antes de decidir si invoca — por eso nombra **la señal de disparo** (*"el turno ya tiene resultados del vault"*), no la capacidad en abstracto. **~250 caracteres, holgadamente bajo el tope de 1024.**

**Alternativas consideradas**:

- *`rastreo-de-impacto`* (empaquetar el procedimiento del Developer: rastrear call sites y propagación con `Grep`/`Glob`/`Read`, y el formato de hallazgo): **rechazada por el límite 2**, y es la que más costó descartar porque es la más rica. Requiere `Read`/`Glob`/`Grep`, que el Developer sí tiene — pero la habilitación es **de sesión, no de rol** (ADR 107 pto 2 dejó `AgentDefinition.skills` fuera), así que la misma skill quedaría listada en el turno conversacional, cuya única herramienta es la de conocimiento. Sería una skill que el modelo puede elegir y no puede ejecutar: exactamente **R3**. Queda como candidata natural del día que se abra `AgentDefinition.skills` — que es la condición de disparo ya escrita en el ADR 107 pto 2.
- *`dictamen-solicitudes`* (empaquetar el checklist del Validador para solicitudes de vacaciones y gastos): **rechazada por el límite 1.** Tool cero, encaja perfecto en lo mecánico — pero un dictamen sobre una solicitud de **gasto** es el insumo de una aprobación humana que mueve plata, y "reembolsos" está nombrado en el límite 1. La primera skill del proyecto no se para en el borde del ADR 7.
- *`veredicto-de-revision`* (la línea `VEREDICTO: aprobado|observado|resuelto` del Reviewer): **rechazada por redundancia con un formato de una sola línea.** Empaquetar en un archivo con progressive disclosure algo que ya cabe entero en el `systemPrompt` es el YAGNI que el ADR 8 castigó.

### ADR 113: El worktree del Developer ve el `.claude/skills/` de **su rama** y el filtro sale de `main` — se **acepta, se documenta y se testea** (★ **RD-48, parte 2**)

**Contexto**. **R8/R9** de la propuesta. `toQueryOptions` emite `cwd` sólo cuando el caller lo pasa (`invoke-model.ts:345-347`) y el único que lo pasa es el **Developer con escritura**, con `cwd = wt.ruta` (`build-on-activity.ts:409`, vía `construirDeveloperConEscritura`, `definitions.ts:309-325`). Los demás caminos (TUI, webhooks, `/soporte`, A2A entrante, Planner, Reviewer, Validador) omiten `cwd` y el SDK cae en `process.cwd()`.

**Decisión**:

1. **El cargador no tiene, ni va a tener, un parámetro `cwd`.** `descubrirSkills` corre **una vez, en el arranque, contra la base relativa por default** — nunca por turno, nunca por worktree. **La lista de habilitación es la de `main`, siempre.** Igual que el ADR 98 hizo inexpresable la escritura, acá es **inexpresable que una rama influya sobre el filtro**: no hay firma por la que un `wt.ruta` pueda entrar al cargador.
2. **La consecuencia, escrita antes de que alguien la descubra**: durante un turno de Developer con escritura, el SDK descubre `.claude/skills/` **del worktree** (que es un checkout de la rama, y donde `.harness/worktrees/` vive dentro del árbol pero es su propia raíz de repositorio) y lo intersecta con la lista de nombres de `main`. Dos casos, los dos con la respuesta correcta:
   - Skill **agregada** en la rama ⇒ el SDK la descubre, **no está en el filtro**, **no queda habilitada**. Es una **propiedad de seguridad**, no un defecto: *una rama en revisión no puede concederse capacidades nuevas a sí misma.* Es la misma familia del ADR 4 — la concesión es una decisión revisada, y la revisión ocurre cuando el `SKILL.md` llega a `main`.
   - Skill **renombrada o borrada** en la rama ⇒ el nombre de `main` no resuelve, la skill queda muerta para ese turno. Sin error, sin síntoma. Es **RD-51**, aceptado: `Options.skills` es una whitelist, y una whitelist que nombra algo ausente es inerte por definición (`sdk.d.ts:2064-2067`).
3. **El supuesto `process.cwd()` = raíz del repo se testea, no se hereda en silencio.** Es la parte de RD-48 que **no** se acepta sólo con documentación. El repo lo sostiene hoy en cinco lugares (`main.ts:446`, `build-on-activity.ts:401`, `build-on-comando-empleado.ts:678`, `openDatabase("data/harness.db")`, `DEFAULT_LOG_FILE_PATH`) y **ninguno lo verifica**. Este change lo vuelve funcionalmente relevante, así que le pone el primer test: §10.D compara la resolución por `process.cwd()` contra la resolución por `import.meta.url` (testigo independiente, molde `run-tests.integration.test.ts:89`) y **falla en rojo** el día que el arnés se corra desde otro directorio. Una precondición de arranque documentada en un README no avisa; un test sí.
4. **Se documenta en el `README.md`** como precondición operativa, en una línea: *el arnés se ejecuta desde la raíz del repositorio* — junto a las que ya dependen de eso (`data/harness.db`, `data/harness.log`, `repoRoot`).

### ADR 114: **Corrección de hecho al ADR 104 pto 5** — tres agentes SÍ tienen `Read`, y el *"context filter, not a sandbox"* tiene más filo del que la propuesta declaró

**Contexto**. El ADR 104 pto 5 sostiene que el riesgo residual de que los `SKILL.md` sean legibles vía `Read`/`Bash` es bajo porque *"ningún agente del arnés tiene `Read` ni `Bash` en su `allowedTools`… salvo el Developer con escritura"*. **Esta fase lo verificó leyendo `definitions.ts` entero y la mitad es falsa.**

**Decisión** — se corrige el hecho, se conserva la conclusión, y se explica por qué:

1. **El hecho corregido, textual del archivo**: `PLANNER_AGENT.allowedTools = ["Read", "Glob"]` (`:178`), `DEVELOPER_AGENT.allowedTools = ["Read", "Glob", "Grep"]` (`:193`), `REVIEWER_AGENT.allowedTools = ["Read"]` (`:208`). O sea **tres roles con `Read` estático**, no cero, y sin ningún interruptor de por medio. Lo que **sí** es cierto sin matiz: **ningún agente tiene `Bash`**, en ningún estado del interruptor (`Bash` no aparece en ningún `allowedTools` del repo).
2. **Y hay un segundo hecho que la propuesta no tenía**: esos tres roles **corren como agente principal**, no sólo como subagentes delegados — `build-on-activity.ts:324` y `build-on-comando-empleado.ts:698` los pasan como primer argumento de `invokeModel`, o sea que van a `options.agent`. **Por lo tanto `Options.skills` (que el `.d.ts` describe como *"skills to enable for the main session"*) los alcanza.** Es lo que fuerza el límite de tool cero del ADR 112 pto 3.
3. **La conclusión del ADR 104 pto 5 se sostiene igual, por un motivo distinto y mejor.** El motivo original era *"nadie puede leerlos"* y era falso. El motivo real es: **los `SKILL.md` son archivos versionados del repo, y los tres roles que tienen `Read` ya pueden leer cualquier archivo versionado del repo.** Habilitar skills **no agrega ni un archivo legible** a lo que esos roles ya alcanzaban — agrega archivos al repo, que es lo que hace cualquier commit. El delta de exposición es cero.
4. **Lo que sí cambia de rango es el límite 3 del ADR 106** (*"ninguna skill contiene secretos"*): deja de ser una precaución teórica contra un lector que no existe y pasa a ser un invariante con **tres lectores concretos y nombrados**. `sdd-spec` lo escribe como invariante negativo verificable, no como recomendación. Queda como **RD-52**.
5. **El comentario de `definitions.ts:82-83`, que este change ya venía a corregir, se corrige con este hecho adentro** — no alcanza con tachar *"Skills are still not exercised"*: el bloque de "Nota de alcance — herramientas" tiene que dejar de dar a entender que el agente conversacional es el único que importa cuando se razona sobre `allowedTools`.

### ADR 115: El Registro de Skills es el **tercer** paso de `bootstrapHarness` (después de Hooks, sin reordenar nada), y **no existe ningún setter** entre el arranque y el turno

**Contexto**. El arc42 (506-508) lista los cuatro registros sin fijar orden; `bootstrapHarness` ya fijó Agentes → Hooks y explicó por qué (`bootstrap.ts:56-81`). Hay que decidir dónde entra Skills y cómo llega su resultado hasta `toQueryOptions`.

**Decisión**:

1. **Skills es el paso 3, después de Hooks. Los pasos 1 y 2 no se tocan ni se reordenan.** El motivo escrito en el paso 2 del archivo (*"un hook podría necesitar inspeccionar qué agentes existen"*) no aplica al revés: ninguna skill inspecciona hooks ni agentes. Entrar al final es el diff mínimo y no cambia el comportamiento de ninguno de los dos pasos existentes.
2. **`HarnessRegistries` gana `skills: readonly string[]`**, para que el tercer registro sea observable desde el arranque como lo son los otros dos, y para que el arc42 (Concepto transversal 5) describa algo que existe. **Es aditivo**: los seis archivos que hacen `ReturnType<typeof bootstrapHarness>["hooks" | "agents"]` siguen compilando sin tocarse (verificado: `build-on-activity`, `build-on-soporte`, `build-on-comando-empleado`, `build-on-submit`, `build-on-a2a-entrante`, `main.ts`).
3. **No hay setter, no hay singleton mutable, no hay orden temporal que respetar.** `bootstrapHarness` **no le pasa** la lista a `invoke-model.ts`: cada uno llama a la misma función. `listarSkillsHabilitadas()` **memoiza** el resultado de su primer escaneo dentro de su módulo, sin `set` público y sin forma de que otro módulo lo altere. La alternativa —`fijarSkillsHabilitadas(lista)` llamado por el arranque— sería estado global mutable con acoplamiento temporal (un turno antes del arranque devolvería `[]` en silencio) y con fugas entre tests: exactamente lo que `createHookEngine()` existe para evitar (`hook-engine.ts:74-80`).
4. **Actualizado tras la corrección del hallazgo 1 del Reviewer (post-tarea 10): el proceso escanea el disco UNA sola vez, no dos.** La redacción original de este punto asumía dos lecturas independientes (arranque + memo del primer turno) como costo aceptado (**RD-49**). El Reviewer encontró que esas dos lecturas, al ser independientes, rompían además la promesa de fail-fast del ADR 111: un `SKILL.md` que se invalidara entre el arranque y el primer turno no abortaba en el arranque (donde `HarnessBootstrapError` lo protege) sino que explotaba sin envolver a mitad de turno. La corrección (commit `778a196`) unificó ambas lecturas: `bootstrapHarness` ahora llama a `descubrirSkillsHabilitadas()` — la misma función memoizada que `toQueryOptions` consume — en vez de a `descubrirSkills()` directo. El arranque puebla la memo que el turno reutiliza: **un solo `readdirSync`/`readFileSync` por proceso**, y la validación de arranque vuelve a proteger el camino real. **RD-49 queda resuelto**, no solo aceptado.
5. **`listarSkillsHabilitadas(base?, deps?)` usa la memo SÓLO en su forma sin argumentos.** Con cualquier argumento no la lee ni la escribe — así los tests ejercitan la función real sin contaminar ni depender de la memo de proceso, y un único test verifica el cacheo llamando dos veces a la forma sin argumentos.

---

## 4. Flujo completo

```
ARRANQUE (una vez por proceso)
  main.ts:156  bootstrapHarness()
        │  1. listAgents()            (sin cambios)
        │  2. hooks                   (sin cambios)
        └─ 3. descubrirSkills(".claude/skills", DEPS_FS)
                 │
                 ├─ base ausente ──────────────▶ { baseAusente: true, skills: [], omitidos: [] }
                 │                                  log skills-carpeta-ausente ─▶ arranca
                 ├─ subdir sin SKILL.md ───────▶ omitidos += [dir]   log skill-omitida-sin-skill-md
                 ├─ SKILL.md ilegible ─────────▶ throw SkillInvalidaError ──┐
                 └─ SKILL.md válido ───────────▶ parsearSkillFrontmatter()  │
                          │                          │                      │
                          │                          └─ inválido ───────────┤
                          │                                                 ▼
                          │                             bootstrapHarness lo envuelve en
                          │                             HarnessBootstrapError ──▶ main.ts
                          │                             stderr una línea + exit ≠ 0
                          ▼
                    skills ordenadas por nombre (asc)
                    log skills-registro-cargado { cantidad, nombres }
                          │
                          └──▶ HarnessRegistries.skills

TURNO (cualquiera de los seis caminos de entrada — ninguno modificado)
  handleTurn / build-on-activity / build-on-comando-empleado
        └─ invokeModel(agent, ctx, prompt, hooks, …, [cwd], [skills = listarSkillsHabilitadas()])
                 └─ toQueryOptions(…)
                        Options = {
                          agent, agents,
                          settingSources: ["project"],   ◀── SIEMPRE (ADR 105/108)
                          skills: [...],                 ◀── SIEMPRE, aunque sea [] (ADR 104 pto 4)
                          [resume] [allowedTools] [mcpServers] [cwd]   ← sin cambios
                        }
                 └─ queryFn({ prompt, options })
                        SDK descubre desde <cwd o process.cwd()>/.claude/skills/ … raíz del repo
                        ∩ con la lista ⇒ lo habilitado
```

**El invariante negativo del change, leído sobre este diagrama**: no existe ninguna flecha desde el disco del operador hacia `Options`. `settingSources: ["project"]` corta `~/.claude/`; la lista explícita corta lo que el SDK descubra de más; y el cargador lee una ruta relativa fija dentro del árbol versionado.

---

## 5. Módulos nuevos y firmas

### 5.1 `src/core/skills/skill-frontmatter.ts` (★ NUEVO — **PURO, CERO IMPORTS**)

```ts
/** Tope portable del Agent Skills spec (ADR 110 pto 3). NO el 1536 de Claude Code. */
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;

/** Whitelist del ADR 110 pto 2. Agregar un campo acá es una decisión de ADR, no un detalle. */
export const CAMPOS_PERMITIDOS = ["name", "description"] as const;

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

/** Rechazo del cargador. `bootstrapHarness` la envuelve en HarnessBootstrapError (ADR 111 pto 1-2). */
export class SkillInvalidaError extends Error {
  readonly ruta: string;
  readonly motivo: string;
  constructor(ruta: string, motivo: string);
}

/**
 * Parsea el frontmatter de un SKILL.md. TOTAL en su entrada (cualquier string
 * es aceptable como argumento) y ESTRICTA en su resultado: lanza
 * SkillInvalidaError ante frontmatter ausente/no cerrado, línea sin `clave: valor`,
 * campo fuera de CAMPOS_PERMITIDOS, `name` o `description` ausentes o en blanco,
 * o `description` > SKILL_DESCRIPTION_MAX_CHARS. `ruta` viaja sólo para el mensaje.
 */
export function parsearSkillFrontmatter(contenido: string, ruta: string): SkillFrontmatter;
```

### 5.2 `src/core/skills/descubrir-skills.ts` (★ NUEVO — `node:fs` **sólo dentro de `DEPS_FS`**)

```ts
/** Ruta RELATIVA, resuelta contra process.cwd() por Node — igual que "data/harness.log" (ADR 109 pto 2). */
export const DEFAULT_SKILLS_DIR = ".claude/skills";
export const SKILL_FILE_NAME = "SKILL.md";

export interface SkillDescubierta {
  readonly nombre: string;      // === directorio, garantizado por el ADR 110 pto 4
  readonly descripcion: string; // no se emite al SDK; viaja para el log y para el README
}

/** ÚNICA frontera con el filesystem. `undefined` significa "no existe", nunca "falló". */
export interface DescubrirSkillsDeps {
  /** Subdirectorios de `base`, o `undefined` si `base` no existe. Cualquier otro error de I/O: lanza. */
  readonly listarSubdirectorios: (base: string) => readonly string[] | undefined;
  /** Contenido del SKILL.md de `directorio`, o `undefined` si no hay SKILL.md. Cualquier otro error: lanza. */
  readonly leerSkillMd: (base: string, directorio: string) => string | undefined;
}

export interface ResultadoDescubrimiento {
  readonly baseAusente: boolean;
  /** Orden ESTABLE por `nombre` ascendente, nunca el orden del filesystem (ADR 111 / test D). */
  readonly skills: readonly SkillDescubierta[];
  /** Subdirectorios sin SKILL.md, para el log. No es un error. */
  readonly omitidos: readonly string[];
}

export const DEPS_FS: DescubrirSkillsDeps;

/** Lanza SkillInvalidaError según la tabla del ADR 111. Nunca lanza por base ausente ni por carpeta vacía. */
export function descubrirSkills(
  base: string = DEFAULT_SKILLS_DIR,
  deps: DescubrirSkillsDeps = DEPS_FS,
): ResultadoDescubrimiento;
```

### 5.3 `src/core/skills/skills-habilitadas.ts` (★ NUEVO)

```ts
/** Sentinela de correlación para logs sin `caso`, molde de COMANDO_LOG_CORRELATION_ID / WEBHOOK_LOG_CORRELATION_ID. */
export const SKILLS_LOG_CORRELATION_ID = "arranque-skills";

/**
 * Nombres canónicos habilitados para un turno. SIN argumentos: usa (y puebla)
 * la memo de proceso — es la forma que `toQueryOptions` invoca como default.
 * CON cualquier argumento: no lee ni escribe la memo (ADR 115 pto 5).
 * Sólo memoiza el resultado exitoso: si lanza, la próxima llamada reintenta.
 */
export function listarSkillsHabilitadas(
  base?: string,
  deps?: DescubrirSkillsDeps,
): readonly string[];
```

### 5.4 `src/core/startup/bootstrap.ts` (MODIFICADO)

```ts
export interface HarnessRegistries {
  readonly agents: readonly AgentDefinition[];
  readonly hooks: HookEngine;
  readonly skills: readonly string[];   // ★ tercer registro (ADR 115 pto 2)
}

export function bootstrapHarness(
  listAgents: () => readonly AgentDefinition[] = listAgentDefinitions,
  hooks: HookEngine = defaultHookEngine,
  // ★ dos parámetros trailing nuevos, mismo patrón DI-con-default del archivo:
  descubrir: () => ResultadoDescubrimiento = () => descubrirSkills(),
  log: (event: string, fields?: Readonly<Record<string, unknown>>) => void =
    (event, fields) => logTurnEvent(SKILLS_LOG_CORRELATION_ID, event, fields),
): HarnessRegistries;
```

Y el **comentario de cabecera (líneas 5-12) se reescribe**: hoy afirma que *"Registro de Comandos y Registro de Skills son de hitos futuros y no se ejercitan acá"* — falso para Comandos desde `v1.4.0` y falso para Skills desde este change.

### 5.5 `src/core/turn-selector/invoke-model.ts` (MODIFICADO)

```ts
const SETTING_SOURCES_DEL_ARNES = ["project"] as const;   // ADR 105 · ADR 108 pto 2

function toQueryOptions(
  agent: AgentDefinition,
  context: AssembledContext,
  mcpServers?: Options["mcpServers"],
  subagentes: readonly AgentDefinition[] = listSubagentDefinitions(),
  cwd?: string,
  skills: readonly string[] = listarSkillsHabilitadas(),   // ★ 6º
): Options;

export async function invokeModel(
  agent, context, prompt, hookEngine,
  queryFn: QueryFn = query,
  mcpServers?: Options["mcpServers"],
  subagentes: readonly AgentDefinition[] = listSubagentDefinitions(),
  cwd?: string,
  skills: readonly string[] = listarSkillsHabilitadas(),   // ★ 9º trailing
): Promise<InvokeModelResult>;
```

El doc-comment de `toQueryOptions` suma el párrafo obligatorio de honestidad, molde de la nota de `cwd` (líneas 308-316): **`Options.skills` es un filtro de contexto, no un sandbox** — los archivos siguen en disco y son alcanzables por `Read` (ADR 114), y **no se guardan secretos en ellos**.

### 5.6 `.claude/skills/citar-conocimiento/SKILL.md` (★ NUEVO — el único artefacto de skill)

Frontmatter en el ADR 112 pto 4. Cuerpo (~50 líneas de markdown): formato de cita a partir de `NODE <label> [src=… loc=…]`, caso `loc=None`, varias fuentes, respuesta cuando el vault no trajo nada, y la prohibición de citar un `src` ausente del resultado. **Cero bloques de comando, cero rutas de datos, cero credenciales.**

---

## 6. Logging (Concepto Transversal 3)

Cuatro eventos, todos en el arranque, todos con `SKILLS_LOG_CORRELATION_ID`:

| Evento | Cuándo | Campos |
|---|---|---|
| `skills-registro-cargado` | siempre que no aborte | `cantidad`, `nombres` |
| `skills-carpeta-ausente` | base inexistente | `base` |
| `skills-registro-vacio` | base sin subdirectorios | `base` |
| `skill-omitida-sin-skill-md` | uno por subdirectorio omitido | `directorio` |

**Ningún log en el camino del turno**: `toQueryOptions` no loguea. La lista es la misma en todos los turnos del proceso; una línea por turno sería ruido puro.

---

## 7. Estrategia de testing (TDD estricto — `strict_tdd: true`, `npm test`)

**Regla del change**: **ningún test del suite por defecto lee `.claude/skills/` del repo por accidente** — todos inyectan base y deps, salvo los dos de §7.D que lo hacen a propósito y lo declaran. Costuras: `DescubrirSkillsDeps` (disco), el parámetro `skills` de `invokeModel` (turno), y los parámetros `descubrir`/`log` de `bootstrapHarness` (arranque).

### A. Tests puros (sin dobles, sin I/O) — `skill-frontmatter.test.ts`

| Qué se afirma |
|---|
| Frontmatter mínimo válido ⇒ `{ name, description }` con valores recortados |
| **Cero imports** del módulo (assert sobre el archivo, molde de los ocho `*-contract.test.ts`) |
| Sin `---` inicial · `---` sin cerrar · línea sin `:` ⇒ `SkillInvalidaError` con la ruta en el mensaje |
| **`allowed-tools` presente ⇒ `SkillInvalidaError`** — la verificación mecánica del límite 2 del ADR 106 |
| `when_to_use`, `model`, `license`, `metadata` ⇒ cada uno rechazado por la whitelist |
| `name` o `description` ausentes o en blanco ⇒ rechazo |
| `description` de exactamente 1024 ⇒ acepta; de 1025 ⇒ rechaza (**el borde del ADR 110 pto 3, y que NO es 1536**) |

### B. Cargador con `DescubrirSkillsDeps` dobles (sin tocar el disco) — `descubrir-skills.test.ts`

| Qué | Cómo |
|---|---|
| Base ausente | `listarSubdirectorios ⇒ undefined` ⇒ `{ baseAusente: true, skills: [] }`, **no lanza** |
| Base vacía | `⇒ []` ⇒ `skills: []`, `baseAusente: false`, **no lanza** |
| Subdir sin `SKILL.md` | `leerSkillMd ⇒ undefined` ⇒ va a `omitidos`, no a `skills`, **no lanza** |
| `SKILL.md` ilegible | `leerSkillMd` lanza `EACCES` ⇒ `SkillInvalidaError` con el motivo del error original |
| `name` ≠ directorio | ⇒ `SkillInvalidaError` (**ADR 110 pto 4**) |
| **Orden estable** | deps devuelven `["zeta","alfa","medio"]` ⇒ resultado `["alfa","medio","zeta"]`, **nunca el orden del fs** |
| `DEFAULT_SKILLS_DIR` | assert de igualdad con el literal `".claude/skills"` y de que **no es absoluta ni contiene `process.cwd()`** (guarda del ADR 109 pto 2) |

### C. Arranque — `bootstrap.test.ts` (extendido)

| Qué | Cómo |
|---|---|
| Los dos registros viejos | los tests existentes **no se tocan** y siguen verdes (`skills` es aditivo) |
| Orden | `descubrir` doble ⇒ se invoca **después** de `listAgents` y del wiring de hooks |
| Degradación | `descubrir` devuelve `baseAusente: true` ⇒ `registries.skills === []` y **`bootstrapHarness` NO lanza**; log `skills-carpeta-ausente` |
| Omitidos | log `skill-omitida-sin-skill-md` una vez por directorio |
| **Aborto** | `descubrir` lanza `SkillInvalidaError` ⇒ **`HarnessBootstrapError`**, con la ruta y el motivo **dentro del mensaje** |
| Aislamiento | un fallo de skills **no** deja el Registro de Agentes a medio cargar (nada se devuelve) |

### D. Turno, sin I/O — `invoke-model.test.ts` (molde ya existente del archivo)

| Qué se afirma |
|---|
| `options.settingSources` es **exactamente `["project"]`** — nunca `[]`, nunca omitido, **nunca con `"user"`** |
| `options.skills` es `["citar-conocimiento"]` cuando se inyecta esa lista, y es **`[]` cuando se inyecta `[]`** — **la clave presente con array vacío** (ADR 104 pto 4) |
| `"skills" in options` y `"settingSources" in options` ⇒ `true` en **todas** las combinaciones de los otros parámetros |
| `options.skills !== lista inyectada` (es una **copia**, no un alias) e idem `settingSources` entre dos llamadas |
| **`options.skills` NO cambia cuando se pasa `cwd`** — el test que ancla el ADR 113 pto 1: el filtro no deriva del worktree |
| Nunca se emite `'all'` (assert explícito de que el valor no es el string) |
| Ningún call site roto: los ~20 `invokeModel(...)` existentes del archivo siguen compilando y pasando sin cambios |

### E. Integración real con disco — `src/test/integration/skills.integration.test.ts`

1. **Ciclo completo sobre un directorio temporal** (`mkdtempSync`, molde `turn-logger.test.ts`/`db.test.ts`): se planta `<tmp>/.claude/skills/demo/SKILL.md` válido + un subdirectorio sin `SKILL.md` + un directorio hermano **fuera** de `.claude/skills/` ⇒ `descubrirSkills` con `DEPS_FS` **real** devuelve exactamente `["demo"]`. **Es el test que demuestra el invariante negativo**: una skill plantada fuera de la carpeta no aparece (*Success Criterion* de la propuesta).
2. **La skill shippeada existe y es válida**: `descubrirSkills()` con los defaults reales, corrido desde la raíz, encuentra `citar-conocimiento`. Es lo que convierte a la skill en evidencia y no en un archivo suelto (ADR 106 pto 1).
3. **★ El test de RD-48**: `resolve(process.cwd(), DEFAULT_SKILLS_DIR)` **===** `resolve(RAIZ_DESDE_IMPORT_META_URL, DEFAULT_SKILLS_DIR)`. Dos testigos independientes de la misma raíz; se ponen rojos el día que el proceso corra desde otro directorio. **Es la primera verificación del supuesto que el repo sostiene en cinco lugares desde el Hito 1.**
4. **Frontmatter real contra el validador estricto**: el `SKILL.md` entregado pasa `parsearSkillFrontmatter` con la whitelist de dos campos y el tope de 1024 — o sea, el artefacto y su validador se verifican juntos, no cada uno con su propio fixture.

---

## 8. Verificación manual del entregable

1. `npm run build && node dist/main.js` desde la raíz ⇒ log `skills-registro-cargado {cantidad:1, nombres:["citar-conocimiento"]}`.
2. `mv .claude/skills .claude/skills.off` y arrancar ⇒ `skills-carpeta-ausente`, **el arnés levanta igual**, `skills: []`.
3. `mkdir .claude/skills/vacia` (sin `SKILL.md`) ⇒ `skill-omitida-sin-skill-md`, arranca.
4. Agregar `allowed-tools: Bash(npm test)` al `SKILL.md` ⇒ **el arranque aborta**, una línea en stderr con archivo y motivo, exit ≠ 0. **Es la demostración del límite 2 del ADR 106.**
5. Cambiar `name:` a algo distinto del directorio ⇒ aborta, con el motivo exacto.
6. `description` de 1100 caracteres ⇒ aborta (y con 1000, arranca) — **el tope portable elegido, visible**.
7. Turno real desde la TUI con una pregunta de política ⇒ el modelo cita con `src`/`loc`; se verifica en el log que el turno corrió y en la respuesta que la cita tiene el formato del `SKILL.md`.
8. **La prueba de la Aclaración 2**: plantar una skill en `~/.claude/skills/impostora/SKILL.md`, arrancar el arnés y confirmar que **no** queda habilitada (no aparece en el log ni el modelo la lista). Es el entregable entero en un solo gesto.
9. `rg 'settingSources' src/` ⇒ **una sola coincidencia**, en `invoke-model.ts` (hoy son cero — Aclaración 2).
10. `rg 'Skill' src/core/agents/definitions.ts` ⇒ **cero** en `allowedTools` (ADR 107 pto 3, nada que migrar).
11. `git diff --stat main -- src/adapters/` ⇒ **vacío**. `git diff --stat main -- src/core/ventas/` ⇒ **vacío** (ADR 103 pto 5, R4).
12. **Rollback**: revertir el commit de `invoke-model.ts` ⇒ `Options` byte por byte el de `v3.0.0`; el cargador queda como código no invocado y el `SKILL.md` como un archivo que nadie lee.
13. `npm test` y `npm run typecheck` en verde, con el archivo de integración **corriendo**, no `skipped`.
14. Evidencia en `docs/progreso/v3.1-definicion-skills/`: el `Options` volcado de un turno real (con `skills` y `settingSources` visibles), las corridas de los puntos 2-6 y 8, las citas de la doc oficial que cerraron RD-44/RD-45, y la resolución escrita de RD-48.

---

## 9. Presupuesto de review — corte de PRs encadenados

Relación test:producción ≈ 1:1 del repo (TDD estricto).

### Review Workload Forecast

```
Estimated changed lines (additions + deletions): ~1030
Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High
```

| PR | Contenido | Prod. | Test | Total |
|---|---|---|---|---|
| **1** | `core/skills/skill-frontmatter.ts` · `core/skills/descubrir-skills.ts` · `core/skills/skills-habilitadas.ts` + sus tests (A y B) | ~180 | ~200 | **~380** |
| **2** | `core/startup/bootstrap.ts` (tercer registro + política de fallo + comentario 5-12) · `.claude/skills/citar-conocimiento/SKILL.md` · `bootstrap.test.ts` (C) | ~150 | ~110 | **~260** |
| **3** | `core/turn-selector/invoke-model.ts` (`toQueryOptions` + `invokeModel` + doc) · `invoke-model.test.ts` (D) · `test/integration/skills.integration.test.ts` (E) · comentario de `definitions.ts:82-83` · `README.md` · `docs/ARC42_*.md` (Deuda 4 + Caja Blanca 5) | ~170 | ~220 | **~390** |

**Por qué el corte cae ahí**: el PR 1 se revisa preguntando *"¿el cargador lee bien el disco y rechaza lo que tiene que rechazar?"* — es **aditivo puro, nadie lo consume todavía**. El PR 2, *"¿el arnés arranca bien en los cinco escenarios de la tabla del ADR 111, y la skill entregada es válida?"* — demostrable solo, **sin que ningún turno cambie**. El PR 3 es el único que **cambia el comportamiento de un turno**, y por eso va solo y último: es donde el Reviewer tiene que mirar `settingSources` y `skills` con el ADR 105 al lado. **Los tres son revertibles en orden inverso, y revertir sólo el PR 3 devuelve el arnés a `v3.0.0` exacto** (§8 punto 12).

**Estrategia sugerida**: `chain_strategy = feature-branch-chain`, misma que los cuatro changes anteriores. PR 1 apunta al tracker `hito/v3.1-definicion-skills`; cada hijo al inmediato anterior.

---

## 10. Riesgos residuales

### Las cuatro que la propuesta reservó — RESUELTAS

| RD | Resolución |
|---|---|
| **RD-45** | **ADR 110.** Exactamente `name` + `description`; whitelist estricta (cualquier otro campo aborta); tope **portable 1024**, no 1536; `name` obligatoriamente igual al directorio |
| **RD-46** | **ADR 111.** La línea de corte es *"existe un `SKILL.md`"*: carpeta ausente/vacía y subdirectorio sin `SKILL.md` **degradan** con log; `SKILL.md` ilegible o inválido **aborta** con `SkillInvalidaError` → `HarnessBootstrapError`. El repo valida **más estricto que el SDK**, a propósito, porque un filtro que no resuelve es invisible |
| **RD-47** | **ADR 112.** `citar-conocimiento`: procedimiento de citado sobre resultados de la base de conocimiento, **tool cero**, fuera del camino del dinero, sin secretos. El `systemPrompt` conserva la obligación; la skill se lleva el procedimiento |
| **RD-48** | **ADR 109 pto 2-3 + ADR 113.** Base relativa `".claude/skills"` — la misma resolución que usa el SDK, no `import.meta.url`. El desfase del worktree del Developer se **acepta y se documenta** (con su propiedad de seguridad: una rama no se concede skills a sí misma), y el supuesto `process.cwd()` = raíz **se testea** (§7.E.3), no se hereda en silencio |

### Las nuevas — abiertas y declaradas (RD-49 a RD-54)

| RD | Riesgo | Estado |
|---|---|---|
| **RD-49** | ~~Dos escaneos del disco por proceso~~ (arranque + memo del primer turno) | **RESUELTO** (corrección del hallazgo 1 del Reviewer, commit `778a196`, ver ADR 115 pto 4 actualizado). `bootstrapHarness` y `toQueryOptions` comparten ahora la misma memo de `descubrirSkillsHabilitadas()` — un solo escaneo por proceso, y el fail-fast del arranque vuelve a proteger el camino real |
| **RD-50** | **`settingSources: ['project']` carga más que skills**: también cargaría `.claude/settings.json` y un `CLAUDE.md` del repo si existieran | **Declarado.** Verificado en esta fase: el repo **no tiene** `CLAUDE.md` en la raíz ni `.claude/` (`Glob`), y este change crea **sólo** `.claude/skills/`. Riesgo real: el día que alguien agregue `.claude/settings.json`, entra al turno **sin ADR**. Mitigación escrita para el README: cualquier archivo nuevo bajo `.claude/` es configuración de turno y se revisa como tal |
| **RD-51** | **El filtro es whitelist**: una skill renombrada o borrada en una rama de worktree queda muerta para el turno del Developer, **sin error y sin log** | **Aceptado** (ADR 113 pto 2). Es la semántica del `.d.ts` (*"unlisted skills are hidden… rejected by the Skill tool"*). El caso simétrico —skill agregada en la rama— es la propiedad de seguridad deseada |
| **RD-52** | **Tres agentes (`planner`, `developer`, `reviewer`) tienen `Read`** y alcanzan los `SKILL.md` — el ADR 104 pto 5 afirmaba que ninguno lo tenía | **Corregido con ADR 114**, delta de exposición **cero** (ya podían leer cualquier archivo versionado). Eleva el límite 3 del ADR 106 (*"sin secretos"*) a invariante negativo verificable del spec |
| **RD-53** | **La memo no se invalida**: un `SKILL.md` agregado con el proceso vivo no se habilita hasta reiniciar | **Aceptado y consistente** con el ADR 107 pto 1 (`reloadSkills()` fuera de alcance): las skills de este arnés cambian por PR y despliegue, no en runtime |
| **RD-54** | **`citar-conocimiento` queda listada también en turnos de subagentes** que no tienen la tool de conocimiento (Planner, Reviewer, Validador) | **Aceptado.** La habilitación es de sesión, no de rol (ADR 107 pto 2). Como la skill **no requiere ninguna herramienta**, el peor caso es una invocación inútil, nunca un fallo de runtime (ADR 112 pto 3). El acotamiento fino llega con `AgentDefinition.skills`, cuya condición de disparo ya está escrita |

---

## 11. Migración y rollout

**No hay migración.** Segundo change consecutivo sin tabla nueva y sin estado persistido — el rollback es el de la propuesta, intacto: revertir el PR 3 devuelve `Options` a `v3.0.0` byte por byte. No hay feature flag: el ADR 105 pto 1 exige que `settingSources` deje de ser ambiental, y un flag que permita volver al comportamiento ambiental sería reintroducir el bug con un interruptor.

---

## 12. Trazabilidad — capability ↔ diseño

| Requisito esperado (de los *Success Criteria* de la propuesta) | Dónde lo cumple este diseño | Dónde se verifica |
|---|---|---|
| Cargador con base inyectada, sin leer `process.cwd()` ni el disco real en el suite por defecto | §5.2 (`base` + `deps` con default) | §7.B completo |
| `skills` como `string[]` explícito, nunca `'all'`; `settingSources: ['project']` | ADR 108 pto 1-2, §5.5 | §7.D filas 1, 2, 6 |
| Con cero skills, `skills: []` y la clave **nunca omitida** | ADR 108 pto 1 (literal, no `if`) | §7.D filas 2 y 3 |
| El `Options` no depende de skills fuera de `.claude/skills/` del repo | ADR 105 + ADR 109 pto 2 | §7.E.1 y verificación manual §8.8 |
| Base del cargador y `cwd` del SDK apuntan al mismo lugar; supuesto declarado | ADR 109 pto 2-3, ADR 113 | §7.E.3 (**el test de RD-48**) |
| Una skill real con los tres límites + ciclo completo *archivo → descubierto → habilitado* | ADR 112, §5.6 | §7.E.2 y §7.E.4 |
| El arnés arranca con la carpeta ausente y con la carpeta vacía | ADR 111 (tabla) | §7.C filas 3-4, §8.2-3 |
| Comentarios de `definitions.ts:82-83` y `bootstrap.ts:5-12` sin afirmaciones falsas | ADR 114 pto 5, §5.4 | Review del PR 2 y 3 |
| Ninguna skill referencia `src/core/ventas/` ni el camino del dinero | ADR 112 pto 3 | §8.11 (`git diff --stat`) |

---

## 13. Preguntas abiertas para el checkpoint humano — RESUELTAS

Las cuatro se resolvieron en el checkpoint posterior a la tarea 11 (verificación manual completa), antes del cierre del change:

1. **ADR 114 — la propuesta tiene un hecho mal.** El ADR 104 pto 5 (`proposal.md`) dice que ningún agente tiene `Read`; son **tres** (`planner`, `developer`, `reviewer`), y además esos roles **corren como agente principal**, así que `Options.skills` los alcanza. La conclusión de riesgo bajo se sostiene por otro motivo (delta de exposición cero), pero el argumento escrito estaba mal.
   **Resuelto: queda como ADR 114 separado, no como enmienda al ADR 104 de `proposal.md`.** Mismo criterio que el resto del repo usa para corregir documentos de fases anteriores (p. ej. la Caja Blanca 5 del arc42 sobre la ubicación de `src/core/skills/*`, ADR 104 pto 1): la propuesta original queda intacta como registro histórico del proceso — el tutor pide que el repo muestre la construcción paso a paso, hallazgos incluidos — y la corrección vive hacia adelante, en el documento de la fase donde se detectó, con referencia cruzada explícita al punto que corrige (como este mismo párrafo hace).
2. **ADR 110 pto 2 — la whitelist de dos campos es la decisión más opinada del diseño.** Hace que un `SKILL.md` con `allowed-tools` **rompa el arranque**. Es lo que convierte el límite 2 del ADR 106 en un guard mecánico, y es más estricto que el SDK a propósito.
   **Resuelto: se mantiene estricta, sin cambios.** El checkpoint prefiere el guard mecánico verificable por sobre un *warning* logueado — un `allowed-tools` colado en un `SKILL.md` es exactamente el escenario que el límite 2 del ADR 106 existe para impedir, y dejarlo pasar con solo un log es la clase de "regla escrita, no aplicada" que este change se propuso evitar desde el `ADR 110`. Sin impacto en código: ya está implementado así.
3. **ADR 112 — la skill elegida es deliberadamente modesta.** `citar-conocimiento` no le agrega ninguna capacidad al arnés: mejora el **cómo** de una que ya tiene.
   **Resuelto: se acepta como está.** La modestia es la propiedad que la hace segura (tool cero, fuera del camino del dinero, rollback trivial) — exactamente lo que un primer entregable del Registro de Skills necesita para demostrar el mecanismo sin asumir riesgo. La candidata más vistosa (`rastreo-de-impacto`) queda como trabajo futuro explícito, condicionado a que se abra `AgentDefinition.skills` (ADR 107 pto 2) — no es alcance de este change.
4. **ADR 115 pto 4 — dos escaneos de disco por proceso.** Era el precio explícito documentado de no tener un setter global.
   **Resuelto por el código, no solo por decisión.** El Reviewer encontró (hallazgo 1, post-tarea 10) que las dos lecturas independientes no eran solo un costo de performance: rompían el fail-fast del ADR 111, porque el arranque validaba un escaneo que el turno real no consumía. La corrección (commit `778a196`) unificó ambas lecturas en la misma memo de proceso — ver el ADR 115 pto 4 actualizado arriba y **RD-49** en la tabla de riesgos, ambos ya reflejan un solo escaneo.
